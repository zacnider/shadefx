import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

// CoinGecko API Configuration
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
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
        logger.warn(`CoinGecko rate limit hit (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
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
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'x-cg-demo-api-key': COINGECKO_API_KEY,
        },
        timeout: 10000,
      });
      
      const prices: CoinPrice[] = [];
      
      for (const coin of TOP_10_COINS) {
        const data = response.data[coin.id];
        if (data && data.usd) {
          prices.push({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price: data.usd,
            priceChange24h: data.usd_24h_change || 0,
            priceChangePercentage24h: data.usd_24h_change || 0,
            marketCap: data.usd_market_cap || 0,
            volume24h: data.usd_24h_vol || 0,
            lastUpdated: new Date().toISOString(),
          });
        }
      }
      
      logger.debug(`Fetched prices for ${prices.length} coins from CoinGecko`);
      return prices;
    } catch (error: any) {
      logger.error(`CoinGecko API failed:`, error.message);
      if (error.response?.data) {
        logger.error(`API Error Response:`, JSON.stringify(error.response.data));
      }
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
      
      const response = await axios.get<CoinMarketData[]>(url, {
        headers: {
          'Accept': 'application/json',
          'x-cg-demo-api-key': COINGECKO_API_KEY,
        },
        timeout: 10000,
      });
      
      logger.debug(`Fetched market data for ${response.data.length} coins from CoinGecko`);
      return response.data;
    } catch (error: any) {
      logger.error(`CoinGecko market data API failed:`, error.message);
      if (error.response?.data) {
        logger.error(`API Error Response:`, JSON.stringify(error.response.data));
      }
      throw new Error(`Failed to fetch market data from CoinGecko: ${error.message}`);
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
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'x-cg-demo-api-key': COINGECKO_API_KEY,
        },
        timeout: 15000,
      });
      
      const historical: HistoricalPrice[] = [];
      
      if (response.data.prices && Array.isArray(response.data.prices)) {
        for (let i = 0; i < response.data.prices.length; i++) {
          const [timestamp, price] = response.data.prices[i];
          const marketCap = response.data.market_caps?.[i]?.[1] || 0;
          const volume24h = response.data.total_volumes?.[i]?.[1] || 0;
          
          historical.push({
            timestamp: timestamp,
            price: price,
            marketCap: marketCap,
            volume24h: volume24h,
          });
        }
      }
      
      logger.debug(`Fetched ${historical.length} historical data points for ${coinId}`);
      return historical;
    } catch (error: any) {
      logger.error(`CoinGecko historical data API failed for ${coinId}:`, error.message);
      if (error.response?.data) {
        logger.error(`API Error Response:`, JSON.stringify(error.response.data));
      }
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
      logger.warn(`Coin ${symbol} not found in top 10 list`);
      return null;
    }
    
    const prices = await getTop10Prices();
    const coinPrice = prices.find(p => p.symbol.toLowerCase() === symbol.toLowerCase());
    return coinPrice?.price || null;
  } catch (error: any) {
    logger.error(`Failed to get price for ${symbol}:`, error.message);
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

