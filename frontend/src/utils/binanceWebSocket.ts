/**
 * Binance WebSocket API Integration
 * Public market data - no API key required
 */

export interface BinanceTicker {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol (e.g., "BTCUSDT")
  c: string; // Last price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Volume
  q: string; // Quote volume
  p: string; // Price change
  P: string; // Price change percent
  w: string; // Weighted average price
  x: string; // First trade price
  Q: string; // Last quantity
}

export interface BinanceKline {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number; // Kline start time
    T: number; // Kline close time
    s: string; // Symbol
    i: string; // Interval
    f: number; // First trade ID
    L: number; // Last trade ID
    o: string; // Open price
    c: string; // Close price
    h: string; // High price
    l: string; // Low price
    v: string; // Volume
    n: number; // Number of trades
    x: boolean; // Is this kline closed?
    q: string; // Quote asset volume
    V: string; // Taker buy base asset volume
    Q: string; // Taker buy quote asset volume
  };
}

/**
 * Convert symbol to Binance format (e.g., "BTCUSD" -> "BTCUSDT")
 */
export const convertToBinanceSymbol = (symbol: string): string => {
  // Remove "USD" and add "USDT" for Binance
  const base = symbol.toUpperCase().replace('USD', '');
  return `${base}USDT`;
};

/**
 * Create Binance WebSocket URL for ticker stream
 */
export const getBinanceTickerStream = (symbol: string): string => {
  const binanceSymbol = convertToBinanceSymbol(symbol);
  return `wss://stream.binance.com:9443/ws/${binanceSymbol.toLowerCase()}@ticker`;
};

/**
 * Create Binance WebSocket URL for kline (candlestick) stream
 */
export const getBinanceKlineStream = (symbol: string, interval: string = '1m'): string => {
  const binanceSymbol = convertToBinanceSymbol(symbol);
  return `wss://stream.binance.com:9443/ws/${binanceSymbol.toLowerCase()}@kline_${interval}`;
};

/**
 * Create Binance WebSocket URL for combined streams (multiple symbols/intervals)
 */
export const getBinanceCombinedStream = (streams: string[]): string => {
  const streamNames = streams.join('/');
  return `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
};

/**
 * Create Binance WebSocket URL for depth (orderbook) stream
 * @param symbol Symbol (e.g., "BTCUSD")
 * @param levels Depth levels (5, 10, or 20)
 */
export const getBinanceDepthStream = (symbol: string, levels: number = 20): string => {
  const binanceSymbol = convertToBinanceSymbol(symbol);
  return `wss://stream.binance.com:9443/ws/${binanceSymbol.toLowerCase()}@depth${levels}@100ms`;
};

/**
 * Parse Binance ticker data
 */
export const parseBinanceTicker = (data: BinanceTicker) => {
  return {
    symbol: data.s,
    price: parseFloat(data.c),
    openPrice: parseFloat(data.o),
    highPrice: parseFloat(data.h),
    lowPrice: parseFloat(data.l),
    volume: parseFloat(data.v),
    quoteVolume: parseFloat(data.q),
    priceChange: parseFloat(data.p),
    priceChangePercent: parseFloat(data.P),
    weightedAvgPrice: parseFloat(data.w),
    timestamp: data.E,
  };
};

/**
 * Parse Binance kline data
 */
export const parseBinanceKline = (data: BinanceKline) => {
  const k = data.k;
  return {
    symbol: k.s,
    openTime: k.t,
    closeTime: k.T,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
    quoteVolume: parseFloat(k.q),
    trades: k.n,
    isClosed: k.x,
    timestamp: data.E,
  };
};

/**
 * Create WebSocket connection with reconnection logic
 */
export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity; // Unlimited reconnection attempts
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000; // Max 30 seconds between attempts
  private isManualClose = false;
  private onMessageCallback?: (data: any) => void;
  private onErrorCallback?: (error: Event) => void;
  private onOpenCallback?: () => void;
  private onCloseCallback?: () => void;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManualClose = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Binance WebSocket] Connected:', this.url);
      }
      this.reconnectAttempts = 0;
      this.onOpenCallback?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessageCallback?.(data);
      } catch (error) {
        console.error('[Binance WebSocket] Error parsing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      // WebSocket errors are often network-related and can be safely ignored
      // They will trigger onclose and reconnect automatically
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Binance WebSocket] Connection error (will reconnect):', error);
      }
      this.onErrorCallback?.(error);
    };

    this.ws.onclose = () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Binance WebSocket] Closed');
      }
      this.onCloseCallback?.();
      
      if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(
          this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
          this.maxReconnectDelay
        );
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Binance WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        }
        setTimeout(() => this.connect(), delay);
      } else if (!this.isManualClose) {
        // Should not happen with Infinity, but keep for safety
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Binance WebSocket] Max reconnection attempts reached');
        }
      }
    };
  }

  disconnect() {
    this.isManualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(callback: (data: any) => void) {
    this.onMessageCallback = callback;
  }

  onError(callback: (error: Event) => void) {
    this.onErrorCallback = callback;
  }

  onOpen(callback: () => void) {
    this.onOpenCallback = callback;
  }

  onClose(callback: () => void) {
    this.onCloseCallback = callback;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}


