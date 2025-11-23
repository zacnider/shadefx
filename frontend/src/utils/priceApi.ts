/**
 * Price API Utility
 * 
 * Fetches real-time currency exchange rates from free APIs
 * Used for displaying current prices and getting result values
 */

// FXRatesAPI.com - Professional exchange rate API
const FXRATES_API_URL = 'https://api.fxratesapi.com/latest';
const FXRATES_API_KEY = process.env.REACT_APP_FXRATES_API_KEY || '';

/**
 * Get exchange rate for a currency pair from FXRatesAPI.com
 * @param baseCurrency Base currency (e.g., 'EUR')
 * @param quoteCurrency Quote currency (e.g., 'USD')
 * @returns Exchange rate (e.g., 1.10 for EUR/USD = 1.10)
 */
export const getExchangeRate = async (
  baseCurrency: string,
  quoteCurrency: string
): Promise<number> => {
  try {
    // FXRatesAPI.com endpoint: /latest?base=EUR&symbols=USD
    const url = `${FXRATES_API_URL}?base=${baseCurrency}&symbols=${quoteCurrency}`;
    const response = await fetch(url, {
      headers: {
        'apikey': FXRATES_API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`FXRatesAPI failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for rate in response
    if (data.rates && data.rates[quoteCurrency]) {
      const rate = data.rates[quoteCurrency];
      return rate;
    }
    
    // Alternative: Check if data is in different format
    if (data.data && data.data[quoteCurrency]) {
      const rate = data.data[quoteCurrency];
      return rate;
    }
    
    throw new Error(`Exchange rate not found in API response`);
  } catch (error: any) {
    console.error(`FXRatesAPI failed for ${baseCurrency}/${quoteCurrency}:`, error.message);
    throw new Error(`Failed to fetch exchange rate from FXRatesAPI: ${error.message}`);
  }
};

/**
 * Get multiple exchange rates at once
 * @param baseCurrency Base currency
 * @param quoteCurrencies Array of quote currencies
 * @returns Object with rates for each quote currency
 */
export const getMultipleRates = async (
  baseCurrency: string,
  quoteCurrencies: string[]
): Promise<Record<string, number>> => {
  try {
    // FXRatesAPI.com endpoint: /latest?base=EUR&symbols=USD,GBP,JPY
    const symbols = quoteCurrencies.join(',');
    const url = `${FXRATES_API_URL}?base=${baseCurrency}&symbols=${symbols}`;
    const response = await fetch(url, {
      headers: {
        'apikey': FXRATES_API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`FXRatesAPI failed: ${response.statusText}`);
    }

    const data = await response.json();
    const rates: Record<string, number> = {};

    // Check for rates in response
    if (data.rates) {
      quoteCurrencies.forEach((quote) => {
        if (data.rates[quote]) {
          rates[quote] = data.rates[quote];
        }
      });
    }
    
    // Alternative: Check if data is in different format
    if (data.data) {
      quoteCurrencies.forEach((quote) => {
        if (data.data[quote]) {
          rates[quote] = data.data[quote];
        }
      });
    }

    if (Object.keys(rates).length > 0) {
      return rates;
    }
    
    throw new Error(`No rates found in API response`);
  } catch (error: any) {
    console.error(`FXRatesAPI failed for ${baseCurrency}:`, error.message);
    throw new Error(`Failed to fetch rates from FXRatesAPI: ${error.message}`);
  }
};

/**
 * Format exchange rate for display
 * @param rate Exchange rate
 * @param decimals Number of decimal places (default: 4)
 * @returns Formatted rate string
 */
export const formatRate = (rate: number, decimals: number = 4): string => {
  return rate.toFixed(decimals);
};

/**
 * Scale rate for FHEVM (multiply by 10000)
 * Example: 1.2345 -> 12345
 * @param rate Exchange rate
 * @returns Scaled rate as integer
 */
export const scaleRateForFHEVM = (rate: number): number => {
  return Math.round(rate * 10000);
};

/**
 * Unscale rate from FHEVM (divide by 10000)
 * Example: 12345 -> 1.2345
 * @param scaledRate Scaled rate as integer
 * @returns Original rate
 */
export const unscaleRateFromFHEVM = (scaledRate: number): number => {
  return scaledRate / 10000;
};

/**
 * Get start price for a currency pair from contract
 * @param contract Contract instance
 * @param currencyPairKey Currency pair key
 * @returns Start price (unscaled)
 */
export const getStartPrice = async (
  contract: any,
  currencyPairKey: string
): Promise<number> => {
  try {
    const round = await contract.rounds(currencyPairKey);
    const startPriceScaled = Number(round.pair.startPrice);
    return unscaleRateFromFHEVM(startPriceScaled);
  } catch (error) {
    console.error('Error getting start price:', error);
    throw error;
  }
};

