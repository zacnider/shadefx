/**
 * Order Optimizer - Gas and timing optimization for orders
 */

import { ethers } from 'ethers';
import { getPerpDEXContract } from './perpdexContract';

export interface OptimizedOrder {
  gasEstimate: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  recommendedGasLimit: bigint;
  estimatedCost: string; // In ETH
  timing: 'optimal' | 'high_traffic' | 'low_traffic';
}

/**
 * Optimize gas for a transaction
 */
export async function optimizeGas(
  provider: ethers.Provider,
  contractAddress: string,
  functionName: string,
  params: any[]
): Promise<OptimizedOrder> {
  try {
    const contract = await getPerpDEXContract(provider);
    const functionFragment = contract.interface.getFunction(functionName);
    
    if (!functionFragment) {
      throw new Error(`Function ${functionName} not found in contract`);
    }

    // Estimate gas
    let gasEstimate: bigint;
    try {
      gasEstimate = await contract[functionName].estimateGas(...params);
    } catch (error: any) {
      console.warn('[OrderOptimizer] Gas estimation failed:', error);
      // Use default gas limit based on function type
      gasEstimate = getDefaultGasLimit(functionName);
    }

    // Get current gas price (with fallback for RPC failures)
    let feeData;
    let gasPrice: bigint;
    let maxFeePerGas: bigint | undefined;
    let maxPriorityFeePerGas: bigint | undefined;
    
    try {
      feeData = await provider.getFeeData();
      gasPrice = feeData.gasPrice || BigInt(0);
      maxFeePerGas = feeData.maxFeePerGas || undefined;
      maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || undefined;
    } catch (feeError: any) {
      console.warn('[OrderOptimizer] Failed to get fee data, using defaults:', feeError);
      // Use default gas price for Sepolia (typically 1-2 gwei)
      gasPrice = ethers.parseUnits('2', 'gwei');
      maxFeePerGas = undefined;
      maxPriorityFeePerGas = undefined;
    }

    // Add 20% buffer to gas estimate
    const recommendedGasLimit = (gasEstimate * BigInt(120)) / BigInt(100);

    // Calculate estimated cost
    const estimatedCostWei = recommendedGasLimit * (maxFeePerGas || gasPrice);
    const estimatedCostEth = ethers.formatEther(estimatedCostWei);

    // Determine timing based on gas price
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
    let timing: 'optimal' | 'high_traffic' | 'low_traffic' = 'optimal';
    if (gasPriceGwei > 50) {
      timing = 'high_traffic';
    } else if (gasPriceGwei < 10) {
      timing = 'low_traffic';
    }

    return {
      gasEstimate,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      recommendedGasLimit,
      estimatedCost: estimatedCostEth,
      timing,
    };
  } catch (error: any) {
    console.error('[OrderOptimizer] Error optimizing gas:', error);
    // Return fallback values instead of throwing
    const defaultGasLimit = getDefaultGasLimit(functionName);
    return {
      gasEstimate: defaultGasLimit,
      gasPrice: ethers.parseUnits('2', 'gwei'), // Default Sepolia gas price
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      recommendedGasLimit: (defaultGasLimit * BigInt(120)) / BigInt(100), // Add 20% buffer
      estimatedCost: '0.001', // Rough estimate
      timing: 'optimal',
    };
  }
}

/**
 * Get default gas limit for a function (fallback if estimation fails)
 */
function getDefaultGasLimit(functionName: string): bigint {
  const defaults: Record<string, bigint> = {
    createMarketOrder: BigInt(500000),
    createLimitOrder: BigInt(300000),
    closePositionWithDirection: BigInt(400000),
    updatePrice: BigInt(100000),
    setStopLoss: BigInt(200000),
    setTakeProfit: BigInt(200000),
    partialClosePosition: BigInt(400000),
    addToPosition: BigInt(300000),
  };

  return defaults[functionName] || BigInt(300000);
}

/**
 * Check if current timing is optimal for transaction
 */
export async function checkOptimalTiming(provider: ethers.Provider): Promise<{
  isOptimal: boolean;
  gasPriceGwei: number;
  recommendation: string;
}> {
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));

    let isOptimal = true;
    let recommendation = 'Current gas prices are optimal.';

    if (gasPriceGwei > 50) {
      isOptimal = false;
      recommendation = 'Gas prices are high. Consider waiting a few minutes.';
    } else if (gasPriceGwei < 10) {
      isOptimal = true;
      recommendation = 'Gas prices are low. Good time to execute.';
    }

    return {
      isOptimal,
      gasPriceGwei,
      recommendation,
    };
  } catch (error: any) {
    console.error('[OrderOptimizer] Error checking timing:', error);
    return {
      isOptimal: true,
      gasPriceGwei: 0,
      recommendation: 'Unable to check gas prices.',
    };
  }
}

/**
 * Check price staleness before executing order
 */
export async function checkPriceStaleness(
  provider: ethers.Provider,
  pairKey: string
): Promise<{
  isStale: boolean;
  lastUpdateTime: number;
  stalenessSeconds: number;
  recommendation: string;
}> {
  try {
    const contract = await getPerpDEXContract(provider);
    const pairConfig = await contract.pairs(pairKey);
    const lastUpdateTime = Number(pairConfig.lastUpdateTime);
    const currentTime = Math.floor(Date.now() / 1000);
    const stalenessSeconds = currentTime - lastUpdateTime;

    // Price is considered stale if older than 5 minutes (300 seconds)
    const isStale = stalenessSeconds > 300;

    let recommendation = 'Price is fresh.';
    if (isStale) {
      recommendation = 'Price is stale. The contract will update the price before executing your order.';
    }

    return {
      isStale,
      lastUpdateTime,
      stalenessSeconds,
      recommendation,
    };
  } catch (error: any) {
    console.error('[OrderOptimizer] Error checking price staleness:', error);
    return {
      isStale: false,
      lastUpdateTime: 0,
      stalenessSeconds: 0,
      recommendation: 'Unable to check price staleness.',
    };
  }
}

