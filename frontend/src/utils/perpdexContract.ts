import { ethers, Contract } from 'ethers';
import { JsonRpcSigner } from 'ethers';

// Load ABI - try artifacts first (development), then public folder (production)
// @ts-ignore - JSON import
let ShadeFXPerpDEXABI: any;
try {
  // Try artifacts first (for development)
  // @ts-ignore
  ShadeFXPerpDEXABI = require('../../artifacts/contracts/ShadeFXPerpDEX.sol/ShadeFXPerpDEX.json');
} catch {
  // Fallback: will be loaded dynamically from public folder
  ShadeFXPerpDEXABI = null;
}

// PerpDEX Contract address
// Fallback to deployed contract address if env var not set
const PERPDEX_CONTRACT_ADDRESS = 
  process.env.REACT_APP_PERPDEX_CONTRACT_ADDRESS || 
  '0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532'; // Latest deployed address (Sepolia) - After contract splitting

// Debug: Log environment variable (only in development)
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  console.log('[PerpDEX] Environment check:', {
    'process.env.REACT_APP_PERPDEX_CONTRACT_ADDRESS': process.env.REACT_APP_PERPDEX_CONTRACT_ADDRESS,
    'PERPDEX_CONTRACT_ADDRESS': PERPDEX_CONTRACT_ADDRESS,
    'All REACT_APP vars': Object.keys(process.env).filter(k => k.startsWith('REACT_APP_'))
  });
}

export interface Position {
  positionId: bigint;
  trader: string;
  pairKey: string;
  entryPrice: bigint;
  size: bigint;
  collateral: bigint;
  leverage: bigint;
  timestamp: bigint;
  isOpen: boolean;
  liquidationPrice: bigint;
  openingFee: bigint;
  closingFee: bigint;
}

export interface Order {
  orderId: bigint;
  trader: string;
  pairKey: string;
  orderType: number; // 0 = MARKET, 1 = LIMIT
  status: number; // 0 = PENDING, 1 = EXECUTED, 2 = CANCELLED, 3 = EXPIRED
  limitPrice: bigint;
  collateralAmount: bigint;
  leverage: bigint;
  timestamp: bigint;
  expiryTime: bigint;
}

export const getPerpDEXContract = async (signerOrProvider: JsonRpcSigner | ethers.Provider): Promise<Contract> => {
  if (!PERPDEX_CONTRACT_ADDRESS) {
    throw new Error('PerpDEX contract address not set. Please set REACT_APP_PERPDEX_CONTRACT_ADDRESS environment variable.');
  }

  // Load ABI if not already loaded
  let abi = ShadeFXPerpDEXABI?.abi;
  if (!abi) {
    try {
      const response = await fetch('/abis/ShadeFXPerpDEX.json');
      const data = await response.json();
      abi = data.abi;
    } catch (err) {
      throw new Error('Failed to load PerpDEX ABI. Please ensure the ABI file exists in public/abis/');
    }
  }

  return new ethers.Contract(PERPDEX_CONTRACT_ADDRESS, abi, signerOrProvider);
};

export const getPerpDEXContractAddress = (): string => {
  return PERPDEX_CONTRACT_ADDRESS;
};

/**
 * Get opening and closing fees from contract
 * @param provider Ethers provider
 * @returns Object with openingFeeBP and closingFeeBP (basis points)
 */
export async function getContractFees(provider: ethers.Provider): Promise<{ openingFeeBP: number; closingFeeBP: number }> {
  try {
    const contract = await getPerpDEXContract(provider);
    // openingFeeBP and closingFeeBP are public variables
    // In ethers.js v6, public variables are accessed as functions (getters)
    // Try function call first, then fallback to property access if needed
    let openingFeeBP: bigint;
    let closingFeeBP: bigint;
    
    try {
      openingFeeBP = await contract.openingFeeBP();
      closingFeeBP = await contract.closingFeeBP();
    } catch (funcError: any) {
      // If function call fails, try property access (some ABI versions might differ)
      try {
        openingFeeBP = (contract as any).openingFeeBP;
        closingFeeBP = (contract as any).closingFeeBP;
      } catch (propError) {
        // If both fail, use defaults
        throw funcError;
      }
    }
    
    return {
      openingFeeBP: Number(openingFeeBP),
      closingFeeBP: Number(closingFeeBP),
    };
  } catch (error) {
    // Silently return defaults if contract call fails (reduce console spam)
    return {
      openingFeeBP: 0, // 0% default
      closingFeeBP: 25, // 0.025% default
    };
  }
}

/**
 * Calculate fee amount from collateral and basis points
 * @param collateral Collateral amount (in USDC, 6 decimals)
 * @param feeBP Fee in basis points (e.g., 25 = 0.025%)
 * @returns Fee amount (in USDC, 6 decimals)
 */
export function calculateFee(collateral: bigint, feeBP: number): bigint {
  // Fee = (collateral * feeBP) / 10000
  // Validate feeBP to prevent NaN errors
  if (isNaN(feeBP) || !isFinite(feeBP) || feeBP < 0) {
    return BigInt(0);
  }
  return (collateral * BigInt(Math.floor(feeBP))) / BigInt(10000);
}

export interface PairConfig {
  baseCurrency: string;
  quoteCurrency: string;
  currentPrice: bigint;
  lastUpdateTime: bigint;
  minCollateral: bigint;
  maxCollateral: bigint;
  maxLeverage: bigint;
  feePercentage: bigint;
  isActive: boolean;
  maxOpenInterest: bigint;
  totalLongSize: bigint;
  totalShortSize: bigint;
  pythPriceId: string;
  coingeckoId: string;
}

export interface PairInfo {
  pairKey: string;
  config: PairConfig;
}

/**
 * Known trading pairs (will be dynamically loaded from contract)
 * Only accurate pairs (verified against Binance API) are included
 */
const KNOWN_PAIRS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'AVAXUSD' // Only accurate pairs (Pyth vs Binance difference < 5%)
];

/**
 * Inaccurate pairs to filter out (Pyth vs Binance difference > 5%)
 * These pairs will be excluded from the frontend display
 */
const INACCURATE_PAIRS = [
  'DOTUSD', 'BNBUSD', 'XRPUSD', 'DOGEUSD', 'TRXUSD', 
  'MATICUSD', 'LINKUSD', 'UNIUSD', 'ATOMUSD', 'ADAUSD'
];

// Cache for getAllPairs to reduce RPC calls
let pairsCache: { pairs: PairInfo[]; timestamp: number } | null = null;
const PAIRS_CACHE_TTL = 60000; // 60 seconds cache (reduce RPC calls)

/**
 * Get all active pairs from the oracle contract
 * After contract splitting, pairs are managed by the price oracle contract
 */
export const getAllPairs = async (provider: ethers.Provider, useCache = true): Promise<PairInfo[]> => {
  // Return cached pairs if available and fresh
  if (useCache && pairsCache && (Date.now() - pairsCache.timestamp) < PAIRS_CACHE_TTL) {
    return pairsCache.pairs;
  }
  
  try {
    // Import price oracle contract utilities
    const { getPriceOracleContract, getAllActivePairs, getPairConfig } = await import('./priceOracleContract');
    
    console.log('[getAllPairs] Starting to load pairs from oracle contract...');
    
    // Get all active pair keys from oracle
    const activePairKeys = await getAllActivePairs(provider);
    
    const pairs: PairInfo[] = [];
    
    // Fetch config for each active pair
    for (const pairKey of activePairKeys) {
      try {
        const config = await getPairConfig(provider, pairKey);
        
        if (config && config.isActive) {
          pairs.push({
            pairKey,
            config: {
              baseCurrency: config.baseCurrency,
              quoteCurrency: config.quoteCurrency,
              currentPrice: config.currentPrice,
              lastUpdateTime: config.lastUpdateTime,
              minCollateral: config.minCollateral,
              maxCollateral: config.maxCollateral,
              maxLeverage: config.maxLeverage,
              feePercentage: config.feePercentage,
              isActive: config.isActive,
              maxOpenInterest: config.maxOpenInterest,
              totalLongSize: config.totalLongSize,
              totalShortSize: config.totalShortSize,
              pythPriceId: config.pythPriceId,
              coingeckoId: config.coingeckoId,
            },
          });
        }
      } catch (err: any) {
        // Skip invalid pair
        if (process.env.NODE_ENV === 'development') {
          console.debug(`[getAllPairs] Error loading pair ${pairKey}:`, err.message);
        }
      }
    }
    
    // Fallback: If oracle returns no pairs, check known pairs
    if (pairs.length === 0) {
      console.log('[getAllPairs] No pairs from oracle, checking known pairs...');
      for (const pairKey of KNOWN_PAIRS) {
        try {
          const config = await getPairConfig(provider, pairKey);
          if (config && config.isActive) {
            pairs.push({
              pairKey,
              config: {
                baseCurrency: config.baseCurrency,
                quoteCurrency: config.quoteCurrency,
                currentPrice: config.currentPrice,
                lastUpdateTime: config.lastUpdateTime,
                minCollateral: config.minCollateral,
                maxCollateral: config.maxCollateral,
                maxLeverage: config.maxLeverage,
                feePercentage: config.feePercentage,
                isActive: config.isActive,
                maxOpenInterest: config.maxOpenInterest,
                totalLongSize: config.totalLongSize,
                totalShortSize: config.totalShortSize,
                pythPriceId: config.pythPriceId,
                coingeckoId: config.coingeckoId,
              },
            });
          }
        } catch (err: any) {
          // Skip non-existent pair
        }
      }
    }
    
    // Sort pairs by pairKey
    pairs.sort((a, b) => a.pairKey.localeCompare(b.pairKey));
    
    // Cache the result
    pairsCache = { pairs, timestamp: Date.now() };
    
    console.log(`[getAllPairs] Loaded ${pairs.length} pairs from oracle contract`);
    return pairs;
  } catch (err: any) {
    console.error('[getAllPairs] Error loading pairs from oracle contract:', err);
    // Return cached pairs if available, even if stale
    if (pairsCache) {
      console.log('[getAllPairs] Returning cached pairs due to error');
      return pairsCache.pairs;
    }
    return [];
  }
};

