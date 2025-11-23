import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getPerpDEXContract, Order } from '../utils/perpdexContract';
import { getUserOrders, checkIndexerHealth, getCurrencyPairsByKeys } from '../utils/envio';
import { getOrderDirection } from '../utils/positionDirection';
import { toast } from 'react-toastify';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface OrdersProps {
  refreshTrigger?: number; // Optional: trigger refresh when this changes
}

const Orders: React.FC<OrdersProps> = ({ refreshTrigger }) => {
  const { account, signer, provider, isConnected } = useWallet();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<bigint | null>(null);
  const [pairPrices, setPairPrices] = useState<Record<string, bigint>>({});
  const [pairNames, setPairNames] = useState<Record<string, string>>({});
  const loadOrdersRef = useRef<(() => Promise<void>) | null>(null);

  const loadOrders = useCallback(async () => {
    if (!provider || !account) return;

    try {
      setLoading(true);
      
      // Try to load from indexer first (faster)
      const indexerAvailable = await checkIndexerHealth();
      
      if (indexerAvailable) {
        console.log('[Orders] Loading orders from indexer for:', account);
        const indexerOrders = await getUserOrders(account);
        
        // Filter only pending orders (status = 0) and convert to contract format
        // Include orders even if direction is null (will try to get from localStorage)
        const pendingOrders: Order[] = indexerOrders
          .filter(order => Number(order.status) === 0)
          .map(order => ({
            orderId: BigInt(order.orderId),
            trader: account!,
            pairKey: order.pairKey,
            orderType: Number(order.orderType),
            status: Number(order.status),
            limitPrice: BigInt(order.limitPrice),
            collateralAmount: BigInt(order.collateralAmount),
            leverage: BigInt(order.leverage),
            timestamp: BigInt(order.timestamp),
            expiryTime: BigInt(order.expiryTime),
          }));
        
        // Try to update direction in indexer if we have it in localStorage but not in indexer
        for (const order of pendingOrders) {
          const localStorageDirection = getOrderDirection(order.orderId);
          const indexerOrder = indexerOrders.find(o => BigInt(o.orderId) === order.orderId);
          if (localStorageDirection && (!indexerOrder?.direction || indexerOrder.direction === null)) {
            // Update direction in indexer
            try {
              const { setOrderDirection } = await import('../utils/envio');
              await setOrderDirection(order.orderId.toString(), localStorageDirection);
              console.log(`[Orders] Updated direction ${localStorageDirection} for order ${order.orderId.toString()} in indexer`);
            } catch (err) {
              console.warn(`[Orders] Could not update direction in indexer:`, err);
            }
          }
        }
        
        console.log('[Orders] Loaded pending orders from indexer:', pendingOrders.length);
        
        // Load pair names from indexer (pairKey hash -> baseCurrency + quoteCurrency)
        const allPairKeys = new Set<string>();
        pendingOrders.forEach(order => allPairKeys.add(order.pairKey));
        
        const pairMap: Record<string, string> = {};
        const pairKeyToDisplayName: Record<string, string> = {};
        
        if (allPairKeys.size > 0) {
          try {
            const currencyPairs = await getCurrencyPairsByKeys(Array.from(allPairKeys));
            
            currencyPairs.forEach(pair => {
              const displayName = `${pair.baseCurrency}${pair.quoteCurrency}`;
              pairMap[pair.pairKey] = displayName;
              pairKeyToDisplayName[pair.pairKey] = displayName;
            });
            
            // For any pairKeys not found in indexer, try to resolve from contract
            // Order pairKey might be a hash, need to resolve it
            for (const pairKey of Array.from(allPairKeys)) {
              if (!pairMap[pairKey]) {
                try {
                  // Check if pairKey is a hash (starts with 0x and 64 chars)
                  const isHash = pairKey.startsWith('0x') && pairKey.length === 66;
                  
                  if (isHash) {
                    // Try to find matching pair from contract
                    const { getAllPairs } = await import('../utils/perpdexContract');
                    const allPairs = await getAllPairs(provider);
                    
                    for (const pair of allPairs) {
                      const hash = ethers.keccak256(ethers.toUtf8Bytes(pair.pairKey));
                      if (hash.toLowerCase() === pairKey.toLowerCase()) {
                        pairMap[pairKey] = pair.pairKey; // Use the original pairKey string (e.g., "BTCUSD")
                        pairKeyToDisplayName[pairKey] = pair.pairKey;
                        break;
                      }
                    }
                  } else {
                    // pairKey is already a string, use it as-is
                    pairMap[pairKey] = pairKey;
                    pairKeyToDisplayName[pairKey] = pairKey;
                  }
                  
                  // If still not found, use pairKey as fallback
                  if (!pairMap[pairKey]) {
                    pairMap[pairKey] = isHash ? pairKey.substring(0, 8) + '...' : pairKey;
                  }
                } catch (err) {
                  console.warn(`[Orders] Could not resolve pairKey ${pairKey}:`, err);
                  pairMap[pairKey] = pairKey.startsWith('0x') ? pairKey.substring(0, 8) + '...' : pairKey;
                }
              }
            }
            
            console.log('[Orders] Loaded pair names:', pairMap);
            setPairNames(pairMap);
          } catch (err) {
            console.error('[Orders] Error loading pair names:', err);
          }
        }
        
        // Load current prices from CoinGecko Pro API (real-time)
        // Optimize: collect unique pairs first, then fetch prices once per pair
        const prices: Record<string, bigint> = {};
        const uniquePairs = new Set<string>();
        const pairKeyToDisplayNameMap: Record<string, string> = {};
        
        // Collect unique pairs
        for (const order of pendingOrders) {
          const displayName = pairKeyToDisplayName[order.pairKey];
          if (displayName && !uniquePairs.has(displayName)) {
            uniquePairs.add(displayName);
            pairKeyToDisplayNameMap[displayName] = order.pairKey;
          }
        }
        
        // Fetch prices for unique pairs only (cache will handle duplicates)
        try {
          const { getPriceWithFallback } = await import('../utils/coingeckoApi');
          
          const pricePromises = Array.from(uniquePairs).map(async (displayName) => {
            try {
              const result = await getPriceWithFallback(displayName);
              // Convert to contract price format (PRICE_PRECISION = 1e8)
              if (result.price && !isNaN(result.price) && isFinite(result.price) && result.price > 0) {
                const pairKey = pairKeyToDisplayNameMap[displayName];
                prices[pairKey] = BigInt(Math.floor(result.price * 1e8));
              }
            } catch (err) {
              console.warn(`[Orders] Could not load price for ${displayName}:`, err);
              // Fallback to contract price if both APIs fail
              try {
                const contract = await getPerpDEXContract(provider);
                const pairConfig = await contract.pairs(displayName);
                const pairKey = pairKeyToDisplayNameMap[displayName];
                if (pairKey) {
                  prices[pairKey] = pairConfig.currentPrice;
                }
              } catch (contractErr) {
                // Skip if all fail
              }
            }
          });
          
          await Promise.allSettled(pricePromises);
          
          // Apply prices to all orders with the same pairKey
          for (const order of pendingOrders) {
            const displayName = pairKeyToDisplayName[order.pairKey];
            if (displayName && !prices[order.pairKey]) {
              // Try to get from another order with same displayName
              const matchingOrder = pendingOrders.find(o => pairKeyToDisplayName[o.pairKey] === displayName && prices[o.pairKey]);
              if (matchingOrder) {
                prices[order.pairKey] = prices[matchingOrder.pairKey];
              }
            }
          }
        } catch (err) {
          console.error('[Orders] Error loading prices from Binance:', err);
        }
        
        setOrders(pendingOrders);
        setPairPrices(prices);
        setLoading(false);
        return;
      }
      
      // Indexer not available - return empty
      console.warn('[Orders] Indexer not available, cannot load orders');
      setOrders([]);
      setPairPrices({});
      setPairNames({});
    } catch (err: any) {
      console.error('Error loading orders:', err);
      toast.error(`Failed to load orders: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [provider, account]);

  // Store in ref for interval
  loadOrdersRef.current = loadOrders;

  useEffect(() => {
    if (isConnected && account && provider) {
      loadOrders();
      
      // Auto-refresh orders every 5 seconds to keep data up-to-date
      const interval = setInterval(() => {
        if (loadOrdersRef.current) {
          loadOrdersRef.current();
        }
      }, 5000);
      
      return () => clearInterval(interval);
    } else {
      setOrders([]);
    }
  }, [isConnected, account, provider, refreshTrigger, loadOrders]);

  const handleCancelOrder = async (orderId: bigint) => {
    if (!signer || !account) {
      toast.error('Please connect your wallet');
      return;
    }

    try {
      setCancellingOrderId(orderId);
      const contract = await getPerpDEXContract(signer);
      
      const tx = await contract.cancelOrder(orderId);
      toast.info('Transaction submitted. Waiting for confirmation...', { autoClose: 5000 });
      
      await tx.wait();
      toast.success('Order cancelled successfully!');
      
      // Refresh orders
      loadOrders();
    } catch (err: any) {
      console.error('Error cancelling order:', err);
      toast.error(`Failed to cancel order: ${err.message || 'Unknown error'}`);
    } finally {
      setCancellingOrderId(null);
    }
  };

  const formatPrice = (price: bigint): string => {
    // Handle BigInt properly to avoid precision loss
    // PRICE_PRECISION = 1e8
    const PRICE_PRECISION = BigInt(1e8);
    
    // Divide by PRICE_PRECISION using BigInt operations
    const wholePart = price / PRICE_PRECISION;
    const remainder = price % PRICE_PRECISION;
    
    // Convert remainder to decimal part (pad to 8 digits for PRICE_PRECISION)
    const remainderStr = remainder.toString().padStart(8, '0');
    const decimalPart = remainderStr.substring(0, 4); // Take first 4 decimal places
    
    // Combine whole and decimal parts
    const result = `${wholePart.toString()}.${decimalPart}`;
    return parseFloat(result).toFixed(4);
  };

  const formatUSDC = (amount: bigint): string => {
    const amountNum = Number(amount) / 1e6; // USDC has 6 decimals
    return amountNum.toFixed(2);
  };

  const formatTime = (timestamp: bigint): string => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString();
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0:
        return <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">Pending</span>;
      case 1:
        return <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Executed</span>;
      case 2:
        return <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Cancelled</span>;
      case 3:
        return <span className="text-xs px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded">Expired</span>;
      default:
        return <span className="text-xs px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded">Unknown</span>;
    }
  };

  const getOrderTypeBadge = (orderType: number) => {
    return orderType === 0 
      ? <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Market</span>
      : <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Limit</span>;
  };

  if (!isConnected) {
    return (
      <div className="p-4">
        <p className="text-gray-400 text-center text-sm">Please connect your wallet to view orders</p>
      </div>
    );
  }

  if (loading && orders.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">Pending Orders</h3>
          <button
            onClick={loadOrders}
            disabled={loading}
            className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <p className="text-gray-400 text-center text-sm py-4">No pending orders</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">Pending Orders</h3>
        <button
          onClick={loadOrders}
          disabled={loading}
          className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-1">
        {orders.map((order) => {
          const currentPrice = pairPrices[order.pairKey] || order.limitPrice;
          const isLimitOrder = order.orderType === 1;
          const isExpired = Number(order.expiryTime) > 0 && Number(order.expiryTime) * 1000 < Date.now();

          return (
            <div
              key={order.orderId.toString()}
              className="bg-dark-900/50 border border-dark-700 rounded px-2 py-1.5 hover:border-dark-600 transition-colors h-[1.5rem] flex items-center"
            >
              <div className="flex items-center justify-between w-full">
                  <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <span className="text-white font-medium text-xs">{pairNames[order.pairKey] || order.pairKey}</span>
                  <span className="text-xs text-gray-400">#{order.orderId.toString()}</span>
                  {(() => {
                    const direction = getOrderDirection(order.orderId);
                    if (direction === 'long') {
                      return <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Long</span>;
                    } else if (direction === 'short') {
                      return <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Short</span>;
                    }
                    return null;
                  })()}
                  {getOrderTypeBadge(order.orderType)}
                  {getStatusBadge(order.status)}
                  {isLimitOrder && (
                    <>
                      <span className="text-xs text-gray-400">Limit: <span className="text-white">${formatPrice(order.limitPrice)}</span></span>
                      <span className="text-xs text-gray-400">Current: <span className="text-white">${formatPrice(currentPrice)}</span></span>
                    </>
                  )}
                  <span className="text-xs text-gray-400">Size: <span className="text-white">{formatUSDC(order.collateralAmount)}</span></span>
                  <span className="text-xs text-gray-400">{order.leverage.toString()}x</span>
                </div>
                <button
                  onClick={() => handleCancelOrder(order.orderId)}
                  disabled={(cancellingOrderId !== null && cancellingOrderId === order.orderId) || isExpired}
                  className="ml-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Cancel order"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Orders;

