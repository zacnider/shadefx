// CoinGecko API Configuration
const COINGECKO_API_KEY = process.env.REACT_APP_COINGECKO_API_KEY || '';
// Demo API uses standard URL, Pro API uses pro-api.coingecko.com
// Since we're using Demo API, use standard URL
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

// Top 10 cryptocurrencies by market cap
export const TOP_10_COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'tron', symbol: 'TRX', name: 'TRON' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
];

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  marketCap: number;
  volume24h: number;
  lastUpdated: string;
}

export interface CoinMarketData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number | null;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  last_updated: string;
}

export interface HistoricalPrice {
  timestamp: number;
  price: number;
  marketCap: number;
  volume24h: number;
}

/**
 * Retry with exponential backoff for rate limiting
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // If it's a 429 (rate limit) error, wait and retry
      if (error.response?.status === 429 || error.status === 429) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`CoinGecko rate limit hit (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Get current prices for top 10 cryptocurrencies
 */
export async function getTop10Prices(): Promise<CoinPrice[]> {
  return retryWithBackoff(async () => {
    try {
      const coinIds = TOP_10_COINS.map(coin => coin.id).join(',');
      const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
      
      // CoinGecko Demo API authentication
      // According to docs: https://docs.coingecko.com/v3.0.1/reference/authentication
      // Header method is recommended for better security
      // Demo API: Use x-cg-demo-api-key header
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      
      // Add API key as header (recommended method)
      if (COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
      }
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const prices: CoinPrice[] = [];
      
      for (const coin of TOP_10_COINS) {
        const coinData = data[coin.id];
        if (coinData && coinData.usd) {
          prices.push({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price: coinData.usd,
            priceChange24h: coinData.usd_24h_change || 0,
            priceChangePercentage24h: coinData.usd_24h_change || 0,
            marketCap: coinData.usd_market_cap || 0,
            volume24h: coinData.usd_24h_vol || 0,
            lastUpdated: new Date().toISOString(),
          });
        }
      }
      
      return prices;
    } catch (error: any) {
      console.error('CoinGecko API failed:', error.message);
      throw new Error(`Failed to fetch prices from CoinGecko: ${error.message}`);
    }
  });
}

/**
 * Get detailed market data for top 10 cryptocurrencies
 */
export async function getTop10MarketData(): Promise<CoinMarketData[]> {
  return retryWithBackoff(async () => {
    try {
      const coinIds = TOP_10_COINS.map(coin => coin.id).join(',');
      const url = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h`;
      
      // CoinGecko Demo API authentication - use header method (recommended)
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      
      if (COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
      }
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data as CoinMarketData[];
    } catch (error: any) {
      console.error('CoinGecko market data API failed:', error.message);
      throw new Error(`Failed to fetch market data from CoinGecko: ${error.message}`);
    }
  });
}

/**
 * Get OHLC (Open, High, Low, Close) data for a specific coin
 * @param coinId CoinGecko coin ID (e.g., 'bitcoin')
 * @param days Number of days of historical data (1, 7, 30, 90, 180, 365, max)
 */
export async function getOHLCData(
  coinId: string,
  days: number = 7
): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>> {
  return retryWithBackoff(async () => {
    try {
      // Use OHLC endpoint for better candlestick data
      // Determine interval based on days
      let interval = 'daily';
      if (days === 1) {
        interval = 'hourly';
      } else if (days <= 7) {
        interval = 'hourly';
      }
      
      const url = `${COINGECKO_BASE_URL}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
      
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      
      if (COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
      }
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const ohlcData: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = [];
      
      if (Array.isArray(data)) {
        for (const item of data) {
          const [timestamp, open, high, low, close] = item;
          ohlcData.push({
            timestamp: timestamp,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: 0, // OHLC endpoint doesn't return volume
          });
        }
      }
      
      // Also fetch volume data from market_chart
      try {
        const volumeUrl = `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${days <= 1 ? 'hourly' : 'daily'}`;
        const volumeResponse = await fetch(volumeUrl, { headers });
        
        if (volumeResponse.ok) {
          const volumeData = await volumeResponse.json();
          if (volumeData.total_volumes && Array.isArray(volumeData.total_volumes)) {
            // Match volumes with OHLC timestamps (closest match)
            for (let i = 0; i < ohlcData.length; i++) {
              const ohlcTime = ohlcData[i].timestamp;
              // Find closest volume timestamp
              let closestVolume = 0;
              let minDiff = Infinity;
              
              for (const [volTime, vol] of volumeData.total_volumes) {
                const diff = Math.abs(volTime - ohlcTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestVolume = vol;
                }
              }
              
              ohlcData[i].volume = closestVolume;
            }
          }
        }
      } catch (volError) {
        console.warn('Could not fetch volume data:', volError);
      }
      
      return ohlcData;
    } catch (error: any) {
      console.error(`CoinGecko OHLC API failed for ${coinId}:`, error.message);
      throw new Error(`Failed to fetch OHLC data for ${coinId}: ${error.message}`);
    }
  });
}

/**
 * Get historical price data for a specific coin
 * @param coinId CoinGecko coin ID (e.g., 'bitcoin')
 * @param days Number of days of historical data (1, 7, 30, 90, 180, 365, max)
 */
export async function getHistoricalPrices(
  coinId: string,
  days: number = 7
): Promise<HistoricalPrice[]> {
  return retryWithBackoff(async () => {
    try {
      const url = `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${days <= 1 ? 'hourly' : 'daily'}`;
      
      // CoinGecko Demo API authentication - use header method (recommended)
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      
      if (COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
      }
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const historical: HistoricalPrice[] = [];
      
      if (data.prices && Array.isArray(data.prices)) {
        for (let i = 0; i < data.prices.length; i++) {
          const [timestamp, price] = data.prices[i];
          const marketCap = data.market_caps?.[i]?.[1] || 0;
          const volume24h = data.total_volumes?.[i]?.[1] || 0;
          
          historical.push({
            timestamp: timestamp,
            price: price,
            marketCap: marketCap,
            volume24h: volume24h,
          });
        }
      }
      
      return historical;
    } catch (error: any) {
      console.error(`CoinGecko historical data API failed for ${coinId}:`, error.message);
      throw new Error(`Failed to fetch historical data for ${coinId}: ${error.message}`);
    }
  });
}

/**
 * Get price for a specific coin by symbol
 */
export async function getCoinPriceBySymbol(symbol: string): Promise<number | null> {
  try {
    const coin = TOP_10_COINS.find(c => c.symbol.toLowerCase() === symbol.toLowerCase());
    if (!coin) {
      console.warn(`Coin ${symbol} not found in top 10 list`);
      return null;
    }
    
    const prices = await getTop10Prices();
    const coinPrice = prices.find(p => p.symbol.toLowerCase() === symbol.toLowerCase());
    return coinPrice?.price || null;
  } catch (error: any) {
    console.error(`Failed to get price for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Get coin ID by symbol
 */
export function getCoinIdBySymbol(symbol: string): string | null {
  const coin = TOP_10_COINS.find(c => c.symbol.toLowerCase() === symbol.toLowerCase());
  return coin?.id || null;
}

/**
 * Format price with appropriate decimals
 */
export function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 4 });
  } else {
    return price.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
}

/**
 * Format market cap
 */
export function formatMarketCap(marketCap: number): string {
  if (marketCap >= 1e12) {
    return `$${(marketCap / 1e12).toFixed(2)}T`;
  } else if (marketCap >= 1e9) {
    return `$${(marketCap / 1e9).toFixed(2)}B`;
  } else if (marketCap >= 1e6) {
    return `$${(marketCap / 1e6).toFixed(2)}M`;
  } else {
    return `$${marketCap.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
}

/**
 * Format volume
 */
export function formatVolume(volume: number): string {
  if (volume >= 1e9) {
    return `$${(volume / 1e9).toFixed(2)}B`;
  } else if (volume >= 1e6) {
    return `$${(volume / 1e6).toFixed(2)}M`;
  } else {
    return `$${volume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
}

