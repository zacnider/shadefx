

// Price cache: symbol -> { price: number, source: 'binance' | 'coingecko', timestamp: number }
interface CacheEntry {
  price: number;
  source: 'binance' | 'coingecko';
  timestamp: number;
}
const priceCache = new Map<string, CacheEntry>();
const CACHE_TTL = 8000; // 8 seconds

// Request queue for throttling
interface QueuedRequest {
  symbol: string;
  coingeckoId?: string;
  resolve: (value: { price: number; source: 'binance' | 'coingecko' }) => void;
  reject: (error: Error) => void;
}
const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;
const MAX_REQUESTS_PER_SECOND = 12; // Safe limit (Binance allows 20 req/s)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000 / MAX_REQUESTS_PER_SECOND; // ~83ms between requests

// Mapping from Binance symbol format to CoinGecko coin ID
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  'BTCUSDT': 'bitcoin',
  'ETHUSDT': 'ethereum',
  'BNBUSDT': 'binancecoin',
  'SOLUSDT': 'solana',
  'ADAUSDT': 'cardano',
  'DOTUSDT': 'polkadot',
  'MATICUSDT': 'matic-network',
  'AVAXUSDT': 'avalanche-2',
  'LINKUSDT': 'chainlink',
  'UNIUSDT': 'uniswap',
  'LTCUSDT': 'litecoin',
  'ATOMUSDT': 'cosmos',
  'ALGOUSDT': 'algorand',
  'FILUSDT': 'filecoin',
  'TRXUSDT': 'tron',
  'DOGEUSDT': 'dogecoin',
  'ETCUSDT': 'ethereum-classic',
  'XLMUSDT': 'stellar',
  'VETUSDT': 'vechain',
  'XRPUSDT': 'ripple',
  'BCHUSDT': 'bitcoin-cash',
  'EOSUSDT': 'eos',
  'XMRUSDT': 'monero',
  'DASHUSDT': 'dash',
  'ZECUSDT': 'zcash',
  'AAVEUSDT': 'aave',
  'MKRUSDT': 'maker',
  'COMPUSDT': 'compound-governance-token',
  'SNXUSDT': 'havven',
  'SUSHIUSDT': 'sushi',
  'CRVUSDT': 'curve-dao-token',
  'YFIUSDT': 'yearn-finance',
  '1INCHUSDT': '1inch',
  'BALUSDT': 'balancer',
  'GRTUSDT': 'the-graph',
  'ENJUSDT': 'enjincoin',
  'MANAUSDT': 'decentraland',
  'SANDUSDT': 'the-sandbox',
  'AXSUSDT': 'axie-infinity',
  'GALAUSDT': 'gala',
  'CHZUSDT': 'chiliz',
  'FLOWUSDT': 'flow',
  'ICPUSDT': 'internet-computer',
  'NEARUSDT': 'near',
  'FTMUSDT': 'fantom',
  'HBARUSDT': 'hedera-hashgraph',
  'EGLDUSDT': 'elrond-erd-2',
  'THETAUSDT': 'theta-token',
  'ZILUSDT': 'zilliqa',
  'IOTAUSDT': 'iota',
  'ONTUSDT': 'ontology',
  'QTUMUSDT': 'qtum',
  'NEOUSDT': 'neo',
  'WAVESUSDT': 'waves',
  'ZENUSDT': 'zencash',
  'BATUSDT': 'basic-attention-token',
  'ZRXUSDT': '0x',
  'OMGUSDT': 'omisego',
  'KNCUSDT': 'kyber-network-crystal',
  'RENUSDT': 'republic-protocol',
  'STORJUSDT': 'storj',
  'BANDUSDT': 'band-protocol',
  'KAVAUSDT': 'kava',
  'RUNEUSDT': 'thorchain',
  'OCEANUSDT': 'ocean-protocol',
  'ALPHAUSDT': 'alpha-finance',
  'SKLUSDT': 'skale',
  'SXPUSDT': 'swipe',
  'CTSIUSDT': 'cartesi',
  'DENTUSDT': 'dent',
  'HOTUSDT': 'holo',
  'STMXUSDT': 'storm',
};

export interface CoinGeckoPriceResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change?: number;
    usd_24h_vol?: number;
  };
}

/**
 * Convert Binance symbol to CoinGecko coin ID
 * @param symbol Binance symbol (e.g., "BTCUSDT")
 * @returns CoinGecko coin ID (e.g., "bitcoin") or null if not found
 */
export function convertToCoinGeckoId(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_TO_COINGECKO_ID[upperSymbol] || null;
}

/**
 * Get current price and 24h volume from CoinGecko API
 * @param coinGeckoId CoinGecko coin ID (e.g., "bitcoin", "ethereum")
 * @param maxRetries Maximum number of retries (default: 2)
 * @param retryDelay Delay between retries in ms (default: 1000)
 */
export async function getCoinGeckoPriceWithVolume(
  coinGeckoId: string,
  maxRetries: number = 2,
  retryDelay: number = 1000
): Promise<{ price: number; change24h: number; volume24h: number }> {
  const API_KEY = process.env.REACT_APP_COINGECKO_API_KEY || '';
  if (!API_KEY) {
    throw new Error('REACT_APP_COINGECKO_API_KEY is not set in environment variables');
  }
  const encodedCoinId = encodeURIComponent(coinGeckoId);
  const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${encodedCoinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&x_cg_pro_api_key=${API_KEY}`;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CoinGecko Pro API] Fetching price and volume for ${coinGeckoId}`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * (attempt + 1) * 2;
          if (attempt < maxRetries) {
            console.warn(`[CoinGecko API] Rate limited (429) for ${coinGeckoId}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data: CoinGeckoPriceResponse = await response.json();
      
      if (!data[coinGeckoId] || !data[coinGeckoId].usd) {
        throw new Error(`Invalid price data received for ${coinGeckoId}`);
      }
      
      const price = data[coinGeckoId].usd;
      const change24h = data[coinGeckoId].usd_24h_change || 0;
      const volume24h = data[coinGeckoId].usd_24h_vol || 0;
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price received: ${price}`);
      }
      
      return { price, change24h, volume24h };
    } catch (error: any) {
      lastError = error;
      
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        console.error(`[CoinGecko API] Timeout for ${coinGeckoId} (attempt ${attempt + 1}/${maxRetries + 1})`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      if (error.message?.includes('fetch') || error.message?.includes('network')) {
        console.warn(`[CoinGecko API] Network error for ${coinGeckoId} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }
      }
      
      if (attempt === maxRetries) {
        console.error(`[CoinGecko API] Failed to fetch price and volume for ${coinGeckoId} after ${maxRetries + 1} attempts:`, error);
        throw new Error(`Failed to fetch price from CoinGecko: ${error.message}`);
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch price from CoinGecko after ${maxRetries + 1} attempts`);
}

/**
 * Get current price from CoinGecko API
 * @param symbol Binance symbol (e.g., "BTCUSDT")
 * @param maxRetries Maximum number of retries (default: 2)
 * @param retryDelay Delay between retries in ms (default: 1000)
 */
export async function getCoinGeckoPrice(
  symbol: string,
  maxRetries: number = 2,
  retryDelay: number = 1000
): Promise<number> {
  const coinId = convertToCoinGeckoId(symbol);
  
  if (!coinId) {
    throw new Error(`CoinGecko ID not found for symbol: ${symbol}`);
  }

  const API_KEY = process.env.REACT_APP_COINGECKO_API_KEY || '';
  if (!API_KEY) {
    throw new Error('REACT_APP_COINGECKO_API_KEY is not set in environment variables');
  }
  // Use CoinGecko Pro API
  // Encode coinId to handle special characters
  const encodedCoinId = encodeURIComponent(coinId);
  // Pro API: https://pro-api.coingecko.com/api/v3
  // API key as query parameter: x_cg_pro_api_key
  const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${encodedCoinId}&vs_currencies=usd&x_cg_pro_api_key=${API_KEY}`;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CoinGecko Pro API] Fetching price for ${symbol} (${coinId})`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        // Rate limit (429) - wait longer before retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * (attempt + 1) * 2;
          if (attempt < maxRetries) {
            console.warn(`[CoinGecko API] Rate limited (429) for ${symbol}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data: CoinGeckoPriceResponse = await response.json();
      
      if (!data[coinId] || !data[coinId].usd) {
        throw new Error(`Invalid price data received for ${coinId}`);
      }
      
      const price = data[coinId].usd;
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price received: ${price}`);
      }
      
      return price;
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on timeout or abort
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        console.error(`[CoinGecko API] Timeout for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1})`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch') || error.message?.includes('network')) {
        console.warn(`[CoinGecko API] Network error for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }
      }
      
      // Other errors - log and throw
      if (attempt === maxRetries) {
        console.error(`[CoinGecko API] Failed to fetch price for ${symbol} after ${maxRetries + 1} attempts:`, error);
        throw new Error(`Failed to fetch price from CoinGecko: ${error.message}`);
      }
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError || new Error(`Failed to fetch price from CoinGecko after ${maxRetries + 1} attempts`);
}

/**
 * Get current price from CoinGecko API using coin ID directly
 * @param coinGeckoId CoinGecko coin ID (e.g., "bitcoin", "ethereum")
 * @param maxRetries Maximum number of retries (default: 2)
 * @param retryDelay Delay between retries in ms (default: 1000)
 */
export async function getCoinGeckoPriceById(
  coinGeckoId: string,
  maxRetries: number = 2,
  retryDelay: number = 1000
): Promise<number> {
  const API_KEY = process.env.REACT_APP_COINGECKO_API_KEY || '';
  if (!API_KEY) {
    throw new Error('REACT_APP_COINGECKO_API_KEY is not set in environment variables');
  }
  const encodedCoinId = encodeURIComponent(coinGeckoId);
  const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${encodedCoinId}&vs_currencies=usd&x_cg_pro_api_key=${API_KEY}`;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CoinGecko Pro API] Fetching price for ${coinGeckoId}`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * (attempt + 1) * 2;
          if (attempt < maxRetries) {
            console.warn(`[CoinGecko API] Rate limited (429) for ${coinGeckoId}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data: CoinGeckoPriceResponse = await response.json();
      
      if (!data[coinGeckoId] || !data[coinGeckoId].usd) {
        throw new Error(`Invalid price data received for ${coinGeckoId}`);
      }
      
      const price = data[coinGeckoId].usd;
      
      if (isNaN(price) || price <= 0) {
        throw new Error(`Invalid price received: ${price}`);
      }
      
      return price;
    } catch (error: any) {
      lastError = error;
      
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        console.error(`[CoinGecko API] Timeout for ${coinGeckoId} (attempt ${attempt + 1}/${maxRetries + 1})`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      if (error.message?.includes('fetch') || error.message?.includes('network')) {
        console.warn(`[CoinGecko API] Network error for ${coinGeckoId} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }
      }
      
      if (attempt === maxRetries) {
        console.error(`[CoinGecko API] Failed to fetch price for ${coinGeckoId} after ${maxRetries + 1} attempts:`, error);
        throw new Error(`Failed to fetch price from CoinGecko: ${error.message}`);
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch price from CoinGecko after ${maxRetries + 1} attempts`);
}

/**
 * Process queued requests with throttling
 */
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (!request) break;

    // Throttle: ensure minimum interval between requests
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    // Process request
    try {
      const result = await fetchPriceWithCache(request.symbol, request.coingeckoId);
      request.resolve(result);
    } catch (error: any) {
      request.reject(error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Fetch price with cache check
 */
async function fetchPriceWithCache(
  symbol: string,
  coingeckoId?: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<{ price: number; source: 'binance' | 'coingecko' }> {
  // Check cache first
  const cacheKey = `${symbol}:${coingeckoId || ''}`;
  const cached = priceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Price Cache] Hit for ${symbol} (${cached.source})`);
    }
    return { price: cached.price, source: cached.source };
  }

  // Convert symbol to Binance format first (BTCUSD -> BTCUSDT)
  const { convertToBinanceSymbol } = await import('./binanceWebSocket');
  const binanceSymbol = convertToBinanceSymbol(symbol);
  
  // Try Binance API first (primary)
  try {
    const binancePrice = await getBinancePrice(binanceSymbol, maxRetries, retryDelay);
    const result = { price: binancePrice, source: 'binance' as const };
    
    // Cache the result
    priceCache.set(cacheKey, {
      price: binancePrice,
      source: 'binance',
      timestamp: Date.now(),
    });
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Binance API] Price fetched for ${symbol}: $${binancePrice.toLocaleString()}`);
    }
    return result;
  } catch (binanceError: any) {
    // Binance failed, try CoinGecko as fallback
    console.warn(`[Binance API] Failed for ${symbol}, trying CoinGecko fallback:`, binanceError.message);
    
    try {
      let coinGeckoIdToUse: string;
      
      // Use contract's coingeckoId if provided (preferred), otherwise fallback to mapping
      if (coingeckoId && coingeckoId.length > 0) {
        coinGeckoIdToUse = coingeckoId;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[CoinGecko API] Using contract's coingeckoId: ${coinGeckoIdToUse}`);
        }
      } else {
        // Fallback to mapping (for backward compatibility)
        const mappedId = convertToCoinGeckoId(binanceSymbol);
        if (!mappedId) {
          throw new Error(`CoinGecko ID not found for symbol: ${binanceSymbol} (original: ${symbol})`);
        }
        coinGeckoIdToUse = mappedId;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[CoinGecko API] Using mapped coingeckoId: ${coinGeckoIdToUse}`);
        }
      }
      
      const coinGeckoPrice = await getCoinGeckoPriceById(coinGeckoIdToUse, maxRetries, retryDelay);
      const result = { price: coinGeckoPrice, source: 'coingecko' as const };
      
      // Cache the result
      priceCache.set(cacheKey, {
        price: coinGeckoPrice,
        source: 'coingecko',
        timestamp: Date.now(),
      });
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[CoinGecko API] Fallback price fetched for ${symbol}: $${coinGeckoPrice.toLocaleString()}`);
      }
      return result;
    } catch (coinGeckoError: any) {
      // Both failed
      console.error(`[Price API] Both Binance and CoinGecko failed for ${symbol}`);
      throw new Error(`Failed to fetch price from both Binance and CoinGecko: ${coinGeckoError.message}`);
    }
  }
}

/**
 * Get current price from Binance API (primary) with CoinGecko fallback
 * This is the main function to use for price fetching
 * Uses caching and request queue for throttling
 * @param symbol Symbol (e.g., "BTCUSD")
 * @param coingeckoId Optional CoinGecko ID from contract (e.g., "bitcoin"). If provided, will be used directly for CoinGecko fallback.
 * @param maxRetries Maximum number of retries (default: 3)
 * @param retryDelay Delay between retries in ms (default: 1000)
 */
export async function getPriceWithFallback(
  symbol: string,
  coingeckoId?: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<{ price: number; source: 'binance' | 'coingecko' }> {
  // Check cache first
  const cacheKey = `${symbol}:${coingeckoId || ''}`;
  const cached = priceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Price Cache] Hit for ${symbol} (${cached.source})`);
    }
    return { price: cached.price, source: cached.source };
  }

  // Queue the request for throttling
  return new Promise((resolve, reject) => {
    requestQueue.push({
      symbol,
      coingeckoId,
      resolve,
      reject,
    });
    
    // Start processing queue if not already processing
    processRequestQueue();
  });
}

/**
 * Get current price from Binance API
 * @param symbol Binance symbol (e.g., "BTCUSDT")
 * @param maxRetries Maximum number of retries (default: 2)
 * @param retryDelay Delay between retries in ms (default: 1000)
 */
async function getBinancePrice(
  symbol: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<number> {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Binance API] Fetching price for ${symbol}`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000), // 5 second timeout (reduced from 10s)
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
      
      const data = await response.json() as { symbol: string; price: string };
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
      
      // Other errors - throw to trigger fallback
      if (attempt === maxRetries) {
        throw new Error(`Failed to fetch price from Binance: ${error.message}`);
      }
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError || new Error(`Failed to fetch price from Binance after ${maxRetries + 1} attempts`);
}
