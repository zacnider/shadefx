import { ethers, Contract } from 'ethers';
import { JsonRpcSigner } from 'ethers';

// Load ABI - try artifacts first (development), then public folder (production)
// @ts-ignore - JSON import
let ShadeFXPriceOracleABI: any;
try {
  // Try artifacts first (for development)
  // @ts-ignore
  ShadeFXPriceOracleABI = require('../../artifacts/contracts/ShadeFXPriceOracle.sol/ShadeFXPriceOracle.json');
} catch {
  // Fallback: will be loaded dynamically from public folder
  ShadeFXPriceOracleABI = null;
}

// Price Oracle Contract address
// Fallback to deployed contract address if env var not set
const PRICE_ORACLE_CONTRACT_ADDRESS = 
  process.env.REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS || 
  '0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93'; // Latest deployed address (Sepolia)

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

export const getPriceOracleContract = async (signerOrProvider: JsonRpcSigner | ethers.Provider): Promise<Contract> => {
  if (!PRICE_ORACLE_CONTRACT_ADDRESS) {
    throw new Error('Price Oracle contract address not set. Please set REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS environment variable.');
  }

  // Load ABI if not already loaded
  let abi = ShadeFXPriceOracleABI?.abi;
  if (!abi) {
    try {
      const response = await fetch('/abis/ShadeFXPriceOracle.json');
      const data = await response.json();
      abi = data.abi;
    } catch (err) {
      throw new Error('Failed to load Price Oracle ABI. Please ensure the ABI file exists in public/abis/');
    }
  }

  return new ethers.Contract(PRICE_ORACLE_CONTRACT_ADDRESS, abi, signerOrProvider);
};

export const getPriceOracleContractAddress = (): string => {
  return PRICE_ORACLE_CONTRACT_ADDRESS;
};

/**
 * Get pair configuration from oracle
 */
export async function getPairConfig(provider: ethers.Provider, pairKey: string): Promise<PairConfig> {
  const contract = await getPriceOracleContract(provider);
  const config = await contract.getPairConfig(pairKey);
  
  return {
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
  };
}

/**
 * Get price for a pair
 */
export async function getPrice(provider: ethers.Provider, pairKey: string): Promise<{ price: bigint; lastUpdateTime: bigint; isActive: boolean }> {
  const contract = await getPriceOracleContract(provider);
  const [price, lastUpdateTime, isActive] = await contract.getPrice(pairKey);
  
  return {
    price,
    lastUpdateTime,
    isActive,
  };
}

/**
 * Get all active pairs from oracle
 */
export async function getAllActivePairs(provider: ethers.Provider): Promise<string[]> {
  const contract = await getPriceOracleContract(provider);
  return await contract.getActivePairs();
}

