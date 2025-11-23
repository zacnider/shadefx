/**
 * Binance REST API Integration
 * Public market data - no API key required
 * Rate limit: 1200 requests per minute
 */

import { convertToBinanceSymbol } from './binanceWebSocket';

export interface BinanceKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

/**
 * Get current price for a symbol with retry mechanism
 * For fallback to CoinGecko, use getPriceWithFallback from coingeckoApi instead
 * @param symbol Symbol (e.g., "BTCUSD")
 * @param maxRetries Maximum number of retries (default: 2)
 * @param retryDelay Delay between retries in ms (default: 1000)
 * @param useFallback Whether to use CoinGecko as fallback (default: false to avoid circular dependency)
 */
export async function getBinancePrice(
  symbol: string,
  maxRetries: number = 2,
  retryDelay: number = 1000,
  useFallback: boolean = false
): Promise<number> {
  const binanceSymbol = convertToBinanceSymbol(symbol);
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(10000), // 10 second timeout (increased from 5s)
      });
      
      if (!response.ok) {
        // Rate limit (429) - wait longer before retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * (attempt + 1) * 2;
          if (attempt < maxRetries) {
            console.warn(`[Binance API] Rate limited (429) for ${symbol}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
      }
      
      const data: BinanceTickerPrice = await response.json();
      const price = parseFloat(data.price);
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price received: ${data.price}`);
      }
      
      return price;
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on timeout or abort
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        console.error(`[Binance API] Timeout for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1})`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch') || error.message?.includes('network')) {
        console.warn(`[Binance API] Network error for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }
      }
      
      // Other errors - log and throw
      if (attempt === maxRetries) {
        console.error(`[Binance API] Failed to fetch price for ${symbol} after ${maxRetries + 1} attempts:`, error);
        throw new Error(`Failed to fetch price from Binance: ${error.message}`);
      }
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError || new Error(`Failed to fetch price from Binance after ${maxRetries + 1} attempts`);
}

/**
 * Get historical kline (candlestick) data
 * @param symbol Symbol (e.g., "BTCUSD")
 * @param interval Kline interval: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 * @param limit Number of klines to return (max 1000)
 * @param startTime Optional start time (milliseconds)
 * @param endTime Optional end time (milliseconds)
 */
export async function getBinanceKlines(
  symbol: string,
  interval: string = '1d',
  limit: number = 500,
  startTime?: number,
  endTime?: number
): Promise<BinanceKline[]> {
  const binanceSymbol = convertToBinanceSymbol(symbol);
  let url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
  
  if (startTime) {
    url += `&startTime=${startTime}`;
  }
  if (endTime) {
    url += `&endTime=${endTime}`;
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }
    
    const data: any[][] = await response.json();
    return data.map((kline) => ({
      openTime: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
      closeTime: kline[6],
      quoteVolume: parseFloat(kline[7]),
      trades: kline[8],
      takerBuyBaseVolume: parseFloat(kline[9]),
      takerBuyQuoteVolume: parseFloat(kline[10]),
    }));
  } catch (error: any) {
    console.error(`[Binance API] Failed to fetch klines for ${symbol}:`, error);
    throw new Error(`Failed to fetch klines from Binance: ${error.message}`);
  }
}

/**
 * Get historical klines for a specific timeframe
 * Maps timeframe to Binance interval and calculates limit
 * Handles pagination if limit exceeds 1000 (Binance max per request)
 */
export async function getBinanceHistoricalKlines(
  symbol: string,
  timeframe: '5m' | '30m' | '1h' | '12h' | '1d',
  days: number = 7
): Promise<BinanceKline[]> {
  // Map timeframe to Binance interval
  const intervalMap: Record<string, string> = {
    '5m': '5m',
    '30m': '30m',
    '1h': '1h',
    '12h': '12h',
    '1d': '1d',
  };
  
  const interval = intervalMap[timeframe] || '1d';
  
  // Calculate total number of klines needed
  // For 5m: 12 per hour * 24 hours * days = 288 * days
  // For 30m: 2 per hour * 24 hours * days = 48 * days
  // For 1h: 24 per day * days
  // For 12h: 2 per day * days
  // For 1d: 1 per day * days
  const totalKlinesNeeded: Record<string, number> = {
    '5m': 288 * days,
    '30m': 48 * days,
    '1h': 24 * days,
    '12h': 2 * days,
    '1d': days,
  };
  
  const totalNeeded = totalKlinesNeeded[interval] || 500;
  
  // Calculate start time (days ago)
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);
  
  // Binance max limit per request is 1000
  const MAX_LIMIT = 1000;
  const allKlines: BinanceKline[] = [];
  
  // If we need more than 1000 klines, make multiple requests
  if (totalNeeded > MAX_LIMIT) {
    let currentStartTime = startTime;
    let remainingKlines = totalNeeded;
    
    while (remainingKlines > 0 && allKlines.length < totalNeeded) {
      const limit = Math.min(MAX_LIMIT, remainingKlines);
      const klines = await getBinanceKlines(symbol, interval, limit, currentStartTime, endTime);
      
      if (klines.length === 0) {
        break; // No more data available
      }
      
      // Add klines (avoid duplicates by checking openTime)
      const existingTimes = new Set(allKlines.map(k => k.openTime));
      klines.forEach(k => {
        if (!existingTimes.has(k.openTime)) {
          allKlines.push(k);
        }
      });
      
      // Update start time for next request (use last kline's close time + 1ms)
      // This ensures we get the next candle after the last one
      if (klines.length > 0) {
        const lastKline = klines[klines.length - 1];
        currentStartTime = lastKline.closeTime + 1;
      } else {
        break; // No more data
      }
      
      remainingKlines -= klines.length;
      
      // If we got fewer klines than requested, we've reached the end
      if (klines.length < limit) {
        break;
      }
      
      // Small delay to avoid rate limiting (Binance allows 1200 req/min)
      if (remainingKlines > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Sort by openTime to ensure chronological order (should already be sorted, but just in case)
    allKlines.sort((a, b) => a.openTime - b.openTime);
    
    // Remove duplicates (by openTime) just to be safe
    const uniqueKlines: BinanceKline[] = [];
    const seenTimes = new Set<number>();
    for (const kline of allKlines) {
      if (!seenTimes.has(kline.openTime)) {
        seenTimes.add(kline.openTime);
        uniqueKlines.push(kline);
      }
    }
    
    return uniqueKlines;
  } else {
    // Single request is enough
    return getBinanceKlines(symbol, interval, totalNeeded, startTime, endTime);
  }
}

