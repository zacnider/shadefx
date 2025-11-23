import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BinanceWebSocket, getBinanceDepthStream, convertToBinanceSymbol } from '../utils/binanceWebSocket';
import { useWallet } from '../contexts/WalletContext';
import { getPerpDEXContract, Order } from '../utils/perpdexContract';
import { getOrderDirection } from '../utils/positionDirection';

interface OrderBookProps {
  symbol: string; // e.g., 'BTCUSD'
  maxLevels?: number; // Maximum number of bid/ask levels to display
  onPriceSelect?: (price: number) => void; // Callback when a price level is clicked
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

interface BinanceDepthUpdate {
  e?: string; // Event type (optional for snapshot)
  E?: number; // Event time
  s?: string; // Symbol
  U?: number; // First update ID (for incremental updates)
  u?: number; // Final update ID (for incremental updates)
  lastUpdateId?: number; // Last update ID (for snapshot)
  b: [string, string][]; // Bids [price, quantity]
  a: [string, string][]; // Asks [price, quantity]
}

const OrderBook: React.FC<OrderBookProps> = ({ symbol, maxLevels = 15, onPriceSelect }) => {
  const { account, provider, isConnected } = useWallet();
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [asks, setAsks] = useState<OrderBookLevel[]>([]);
  const [spread, setSpread] = useState<number>(0);
  const [spreadPercent, setSpreadPercent] = useState<number>(0);
  const wsRef = useRef<BinanceWebSocket | null>(null);
  const bidsMapRef = useRef<Map<number, number>>(new Map());
  const asksMapRef = useRef<Map<number, number>>(new Map());
  const userOrdersRef = useRef<Map<number, { price: number; quantity: number; direction: 'long' | 'short' }>>(new Map());
  const lastUpdateIdRef = useRef<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastWebSocketMessageRef = useRef<number>(Date.now());
  const isWebSocketConnectedRef = useRef<boolean>(false);

  // Helper function to update orderbook display
  const updateOrderBookDisplay = useCallback(() => {
    // Create combined maps with Binance data + user orders
    const combinedBidsMap = new Map(bidsMapRef.current);
    const combinedAsksMap = new Map(asksMapRef.current);

    // Add user orders to appropriate side
    userOrdersRef.current.forEach((order) => {
      if (order.direction === 'long') {
        // Long order = buy order = bid
        const existingQuantity = combinedBidsMap.get(order.price) || 0;
        combinedBidsMap.set(order.price, existingQuantity + order.quantity);
      } else if (order.direction === 'short') {
        // Short order = sell order = ask
        const existingQuantity = combinedAsksMap.get(order.price) || 0;
        combinedAsksMap.set(order.price, existingQuantity + order.quantity);
      }
    });

    // Convert maps to sorted arrays
    const bidsArray: OrderBookLevel[] = [];
    const asksArray: OrderBookLevel[] = [];
    
    let bidsTotal = 0;
    let asksTotal = 0;

    // Process bids (descending price)
    const sortedBids = Array.from(combinedBidsMap.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, maxLevels);
    
    sortedBids.forEach(([price, quantity]) => {
      bidsTotal += quantity;
      bidsArray.push({ price, quantity, total: bidsTotal });
    });

    // Process asks (ascending price)
    const sortedAsks = Array.from(combinedAsksMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, maxLevels);
    
    sortedAsks.forEach(([price, quantity]) => {
      asksTotal += quantity;
      asksArray.push({ price, quantity, total: asksTotal });
    });

    setBids(bidsArray);
    setAsks(asksArray);

    // Calculate spread
    if (bidsArray.length > 0 && asksArray.length > 0) {
      const bestBid = bidsArray[0].price;
      const bestAsk = asksArray[0].price;
      const spreadValue = bestAsk - bestBid;
      const spreadPercentValue = ((spreadValue / bestBid) * 100);
      setSpread(spreadValue);
      setSpreadPercent(spreadPercentValue);
    }
  }, [maxLevels]);

  // Load user's pending limit orders from indexer first, then contract
  const loadUserOrders = useCallback(async () => {
    if (!isConnected || !account || !provider || !symbol) {
      userOrdersRef.current.clear();
      updateOrderBookDisplay();
      return;
    }

    try {
      // Try indexer first
      const { checkIndexerHealth, getUserOrders } = await import('../utils/envio');
      const indexerAvailable = await checkIndexerHealth();
      
      if (indexerAvailable) {
        try {
          const indexerOrders = await getUserOrders(account);
          const normalizedSymbol = symbol.toUpperCase().endsWith('USD') 
            ? symbol.toUpperCase() 
            : `${symbol.toUpperCase()}USD`;
          
          // Filter pending limit orders for this pair
          const pendingOrders = indexerOrders.filter(order => {
            const status = Number(order.status);
            const orderType = Number(order.orderType);
            return status === 0 && orderType === 1 && order.pairKey === normalizedSymbol;
          });
          
          userOrdersRef.current.clear();
          
          for (const order of pendingOrders) {
            const { getOrderDirection } = await import('../utils/positionDirection');
            const direction = getOrderDirection(BigInt(order.orderId));
            if (direction) {
              const price = Number(order.limitPrice) / 1e8;
              const quantity = Number(order.collateralAmount) / 1e6;
              userOrdersRef.current.set(Number(order.orderId), {
                price,
                quantity,
                direction,
              });
            }
          }
          
          updateOrderBookDisplay();
          return;
        } catch (indexerError) {
          console.warn('[OrderBook] Indexer failed, falling back to contract:', indexerError);
        }
      }
      
      // Fallback to contract
      const contract = await getPerpDEXContract(provider);
      let orderIds: bigint[] = [];
      try {
        orderIds = await contract.getUserOrders(account);
      } catch (err: any) {
        // Only log error in development mode - this is often just "no orders" or RPC issue
        if (process.env.NODE_ENV === 'development') {
          console.warn('[OrderBook] Error getting user orders (non-critical):', err);
        }
        // If getUserOrders fails, return empty (user may have no orders)
        userOrdersRef.current.clear();
        updateOrderBookDisplay();
        return;
      }
      
      const normalizedSymbol = symbol.toUpperCase().endsWith('USD') 
        ? symbol.toUpperCase() 
        : `${symbol.toUpperCase()}USD`;

      userOrdersRef.current.clear();

      for (const orderId of orderIds) {
        try {
          const order = await contract.orders(orderId);
          const status = typeof order.status === 'bigint' ? Number(order.status) : order.status;
          const orderType = typeof order.orderType === 'bigint' ? Number(order.orderType) : order.orderType;

          // Only process pending limit orders for this pair
          if (status === 0 && orderType === 1 && order.pairKey === normalizedSymbol && order.limitPrice > 0) {
            const direction = getOrderDirection(orderId);
            if (direction) {
              const price = Number(order.limitPrice) / 1e8; // PRICE_PRECISION = 1e8
              const quantity = Number(order.collateralAmount) / 1e6; // USDC_DECIMALS = 1e6
              
              // Use orderId as key to avoid duplicates
              userOrdersRef.current.set(Number(orderId), {
                price,
                quantity,
                direction,
              });
            }
          }
        } catch (err) {
          console.error(`[OrderBook] Error loading order ${orderId}:`, err);
        }
      }

      // Update display after loading user orders
      updateOrderBookDisplay();
    } catch (err) {
      console.error('[OrderBook] Error loading user orders:', err);
    }
  }, [isConnected, account, provider, symbol, updateOrderBookDisplay]);

  useEffect(() => {
    // Load user orders
    loadUserOrders();
    
    // Refresh user orders every 10 seconds
    const interval = setInterval(loadUserOrders, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [loadUserOrders]);

  useEffect(() => {
    // Clear previous data
    bidsMapRef.current.clear();
    asksMapRef.current.clear();
    lastUpdateIdRef.current = 0;
    setBids([]);
    setAsks([]);

    // Disconnect existing connection
    if (wsRef.current) {
      try {
        wsRef.current.disconnect();
      } catch (e) {
        console.warn('[OrderBook] Error disconnecting WebSocket:', e);
      }
      wsRef.current = null;
    }

    // First, fetch snapshot from REST API
    const loadSnapshot = async () => {
      try {
        const binanceSymbol = convertToBinanceSymbol(symbol);
        const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol.toUpperCase()}&limit=20`);
        const snapshot = await response.json();
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[OrderBook] Fetched snapshot from REST API:', snapshot);
        }
        
        if (snapshot.bids && Array.isArray(snapshot.bids)) {
          snapshot.bids.forEach(([priceStr, quantityStr]: [string, string]) => {
            const price = parseFloat(priceStr);
            const quantity = parseFloat(quantityStr);
            if (quantity > 0) {
              bidsMapRef.current.set(price, quantity);
            }
          });
        }
        
        if (snapshot.asks && Array.isArray(snapshot.asks)) {
          snapshot.asks.forEach(([priceStr, quantityStr]: [string, string]) => {
            const price = parseFloat(priceStr);
            const quantity = parseFloat(quantityStr);
            if (quantity > 0) {
              asksMapRef.current.set(price, quantity);
            }
          });
        }
        
        lastUpdateIdRef.current = snapshot.lastUpdateId || 0;
        if (process.env.NODE_ENV === 'development') {
          console.log('[OrderBook] Snapshot loaded:', {
            bids: bidsMapRef.current.size,
            asks: asksMapRef.current.size,
            lastUpdateId: lastUpdateIdRef.current
          });
        }
        
        // Update display after loading snapshot
        updateOrderBookDisplay();
      } catch (error) {
        console.error('[OrderBook] Error loading snapshot:', error);
      }
    };
    
    // Fallback polling mechanism: fetch depth from REST API every 5 seconds
    // if WebSocket is not connected or hasn't received messages recently
    const startPolling = () => {
      // Clear existing polling interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      // Poll every 5 seconds
      pollingIntervalRef.current = setInterval(async () => {
        // Check if WebSocket is connected and receiving messages
        const timeSinceLastMessage = Date.now() - lastWebSocketMessageRef.current;
        const isWebSocketActive = isWebSocketConnectedRef.current && timeSinceLastMessage < 10000; // 10 seconds threshold
        
        if (!isWebSocketActive) {
          // WebSocket is not active, use polling as fallback
          if (process.env.NODE_ENV === 'development') {
            console.log('[OrderBook] WebSocket inactive, using polling fallback');
          }
          await loadSnapshot();
        }
      }, 5000); // Poll every 5 seconds
    };
    
    // Start polling
    startPolling();

    // Load snapshot first
    loadSnapshot();

    try {
      const wsUrl = getBinanceDepthStream(symbol);
      if (process.env.NODE_ENV === 'development') {
        console.log('[OrderBook] Connecting to Binance depth stream:', wsUrl);
      }
      const ws = new BinanceWebSocket(wsUrl);
      
      // Track WebSocket connection status
      ws.onOpen(() => {
        isWebSocketConnectedRef.current = true;
        lastWebSocketMessageRef.current = Date.now();
        if (process.env.NODE_ENV === 'development') {
          console.log('[OrderBook] WebSocket connected for', symbol);
        }
      });
      
      ws.onClose(() => {
        isWebSocketConnectedRef.current = false;
        if (process.env.NODE_ENV === 'development') {
          console.log('[OrderBook] WebSocket closed for', symbol);
        }
      });

      ws.onMessage((data: BinanceDepthUpdate) => {
        try {
          // Update last message timestamp
          lastWebSocketMessageRef.current = Date.now();
          
          // Binance depth stream only sends incremental updates
          // We already loaded snapshot from REST API
          if (data.U !== undefined && data.u !== undefined) {
            // Skip updates that are older than our snapshot
            if (data.U <= lastUpdateIdRef.current && lastUpdateIdRef.current !== 0) {
              // This is an old update, skip it
              return;
            }
            
            // Update lastUpdateId
            lastUpdateIdRef.current = data.u;

            // Update bids from incremental update
            if (data.b && Array.isArray(data.b)) {
              data.b.forEach(([priceStr, quantityStr]) => {
                const price = parseFloat(priceStr);
                const quantity = parseFloat(quantityStr);
                
                if (quantity === 0) {
                  // Remove level if quantity is 0
                  bidsMapRef.current.delete(price);
                } else {
                  // Update level (incremental update)
                  bidsMapRef.current.set(price, quantity);
                }
              });
            }

            // Update asks from incremental update
            if (data.a && Array.isArray(data.a)) {
              data.a.forEach(([priceStr, quantityStr]) => {
                const price = parseFloat(priceStr);
                const quantity = parseFloat(quantityStr);
                
                if (quantity === 0) {
                  // Remove level if quantity is 0
                  asksMapRef.current.delete(price);
                } else {
                  // Update level (incremental update)
                  asksMapRef.current.set(price, quantity);
                }
              });
            }

            // Update display with combined Binance + user orders
            updateOrderBookDisplay();
            
            if (process.env.NODE_ENV === 'development') {
              // Log occasionally to avoid spam
              if (Math.random() < 0.05) {
                console.log('[OrderBook] Depth update received for', symbol);
              }
            }
          }
        } catch (error) {
          console.error('[OrderBook] Error processing depth update:', error, data);
        }
      });

      ws.onError((error) => {
        // WebSocket errors are handled by reconnection logic
        // Only log in development mode
        if (process.env.NODE_ENV === 'development') {
          console.warn('[OrderBook] WebSocket connection error (will reconnect):', error);
        }
      });

      ws.connect();
      wsRef.current = ws;
    } catch (error) {
      console.error('[OrderBook] Failed to create WebSocket:', error);
    }

    return () => {
      // Clear polling interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      // Disconnect WebSocket
      if (wsRef.current) {
        try {
          wsRef.current.disconnect();
        } catch (e) {
          console.warn('[OrderBook] Error cleaning up WebSocket:', e);
        }
        wsRef.current = null;
      }
      
      // Reset connection status
      isWebSocketConnectedRef.current = false;
    };
  }, [symbol, maxLevels, updateOrderBookDisplay]);

  const formatPrice = (price: number): string => {
    return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  };

  const formatQuantity = (quantity: number): string => {
    if (quantity >= 1000) {
      return quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return quantity.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const getMaxTotal = (): number => {
    const maxBidTotal = bids.length > 0 ? bids[bids.length - 1]?.total || 0 : 0;
    const maxAskTotal = asks.length > 0 ? asks[asks.length - 1]?.total || 0 : 0;
    return Math.max(maxBidTotal, maxAskTotal);
  };

  const maxTotal = getMaxTotal();

  return (
    <div className="h-full flex flex-col bg-dark-900/50 border border-dark-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-dark-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white">Order Book</h3>
          {spread > 0 && (
            <div className="text-xs text-gray-400">
              Spread: <span className="text-white">{formatPrice(spread)}</span>
              {' '}(<span className={spreadPercent < 0.1 ? 'text-green-400' : 'text-yellow-400'}>
                {spreadPercent.toFixed(3)}%
              </span>)
            </div>
          )}
        </div>
      </div>

      {/* Order Book Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Asks (Sell Orders) - Red */}
        <div className="flex flex-col-reverse">
          {asks.map((ask, index) => {
            const widthPercent = maxTotal > 0 ? (ask.total / maxTotal) * 100 : 0;
            return (
              <div
                key={`ask-${ask.price}-${index}`}
                className={`relative px-3 py-0.5 transition-colors ${
                  onPriceSelect ? 'cursor-pointer hover:bg-dark-800/70 active:bg-dark-800' : 'hover:bg-dark-800/50'
                }`}
                onClick={() => onPriceSelect?.(ask.price)}
                title={onPriceSelect ? `Click to set limit price: $${formatPrice(ask.price)}` : undefined}
              >
                <div
                  className="absolute inset-0 bg-red-500/10"
                  style={{ width: `${widthPercent}%`, right: 0 }}
                />
                <div className="relative flex items-center justify-between text-xs">
                  <span className="text-red-400 font-medium">{formatPrice(ask.price)}</span>
                  <span className="text-gray-300">{formatQuantity(ask.quantity)}</span>
                  <span className="text-gray-500">{formatQuantity(ask.total)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Spread */}
        {bids.length > 0 && asks.length > 0 && (
          <div className="px-3 py-1 border-y border-dark-700 bg-dark-800/30 flex items-center justify-between text-xs">
            <span className="text-gray-400">Spread</span>
            <span className="text-white font-medium">{formatPrice(spread)}</span>
            <span className={`font-medium ${spreadPercent < 0.1 ? 'text-green-400' : 'text-yellow-400'}`}>
              {spreadPercent.toFixed(3)}%
            </span>
          </div>
        )}

        {/* Bids (Buy Orders) - Green */}
        <div className="flex flex-col">
          {bids.map((bid, index) => {
            const widthPercent = maxTotal > 0 ? (bid.total / maxTotal) * 100 : 0;
            return (
              <div
                key={`bid-${bid.price}-${index}`}
                className={`relative px-3 py-0.5 transition-colors ${
                  onPriceSelect ? 'cursor-pointer hover:bg-dark-800/70 active:bg-dark-800' : 'hover:bg-dark-800/50'
                }`}
                onClick={() => onPriceSelect?.(bid.price)}
                title={onPriceSelect ? `Click to set limit price: $${formatPrice(bid.price)}` : undefined}
              >
                <div
                  className="absolute inset-0 bg-green-500/10"
                  style={{ width: `${widthPercent}%`, left: 0 }}
                />
                <div className="relative flex items-center justify-between text-xs">
                  <span className="text-green-400 font-medium">{formatPrice(bid.price)}</span>
                  <span className="text-gray-300">{formatQuantity(bid.quantity)}</span>
                  <span className="text-gray-500">{formatQuantity(bid.total)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {bids.length === 0 && asks.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-400 text-xs">Loading order book...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderBook;

