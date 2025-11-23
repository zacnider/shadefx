/**
 * useIntentExecutor Hook - Execute parsed intents
 */

import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { ParsedIntent, parseIntent, validateIntent } from '../utils/intentParser';
import { optimizeGas, checkOptimalTiming, checkPriceStaleness } from '../utils/orderOptimizer';
import { autoSetupAfterPositionOpen } from '../utils/autoSetup';
import { getPerpDEXContract } from '../utils/perpdexContract';
import { toast } from 'react-toastify';
import { useFHEVM } from './useFHEVM';

export interface IntentExecutionResult {
  success: boolean;
  message: string;
  positionId?: bigint;
  transactionHash?: string;
}

export function useIntentExecutor() {
  const { account, signer, provider, isConnected, embeddedWallet } = useWallet();
  const { encryptBool, encrypt32, encrypt64, isReady: fhevmReady } = useFHEVM(provider || undefined, embeddedWallet);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<IntentExecutionResult | null>(null);

  const executeIntent = useCallback(async (
    input: string,
    options?: {
      onPositionOpened?: (positionId: bigint) => void;
      onPositionClosed?: (positionId: bigint) => void;
    }
  ): Promise<IntentExecutionResult> => {
    if (!isConnected || !signer || !account || !provider) {
      const result = {
        success: false,
        message: 'Please connect your wallet first.',
      };
      setLastResult(result);
      return result;
    }

    if (!fhevmReady) {
      const result = {
        success: false,
        message: 'FHEVM is not ready. Please wait...',
      };
      setLastResult(result);
      return result;
    }

    setExecuting(true);
    setLastResult(null);

    try {
      // Parse intent
      const intent = parseIntent(input);
      
      // Validate intent
      const validation = validateIntent(intent);
      if (!validation.valid) {
        const result = {
          success: false,
          message: validation.errors.join(' '),
        };
        setLastResult(result);
        return result;
      }

      // Execute based on action
      let result: IntentExecutionResult;
      switch (intent.action) {
        case 'open':
          result = await executeOpenPosition(intent, signer, account, provider, encryptBool, encrypt32, encrypt64, options);
          break;
        
        case 'close':
          result = await executeClosePosition(intent, signer, account, provider, options);
          break;
        
        case 'partialClose':
          result = await executePartialClose(intent, signer, account, provider, options);
          break;
        
        case 'setStopLoss':
          result = await executeSetStopLoss(intent, signer, account, encrypt64);
          break;
        
        case 'setTakeProfit':
          result = await executeSetTakeProfit(intent, signer, account);
          break;
        
        case 'hedge':
          result = await executeHedge(intent, signer, account, provider, encryptBool, encrypt32, encrypt64, options);
          break;
        
        case 'addToPosition':
          result = await executeAddToPosition(intent, signer, account, provider, options);
          break;
        
        default:
          result = {
            success: false,
            message: 'Could not understand the intent. Please try rephrasing.',
          };
      }
      
      setLastResult(result);
      return result;
    } catch (error: any) {
      console.error('[useIntentExecutor] Error executing intent:', error);
      
      // Extract error message safely
      let errorMessage = 'Failed to execute intent.';
      if (error?.reason && typeof error.reason === 'string') {
        errorMessage = error.reason;
      } else if (error?.message && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (error?.error?.message && typeof error.error.message === 'string') {
        errorMessage = error.error.message;
      } else if (error?.error?.reason && typeof error.error.reason === 'string') {
        errorMessage = error.error.reason;
      } else if (error?.data?.message && typeof error.data.message === 'string') {
        errorMessage = error.data.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        // Last resort: try to stringify, but limit length
        try {
          const errorStr = JSON.stringify(error);
          errorMessage = errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
        } catch {
          errorMessage = 'Unknown error occurred. Please try again.';
        }
      }
      
      const result = {
        success: false,
        message: errorMessage,
      };
      setLastResult(result);
      return result;
    } finally {
      setExecuting(false);
    }
  }, [isConnected, signer, account, provider, fhevmReady, encryptBool, encrypt32, encrypt64]);

  return {
    executeIntent,
    executing,
    lastResult,
  };
}

// Helper functions for each action type

async function executeOpenPosition(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  provider: ethers.Provider,
  encryptBool: (value: boolean, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  encrypt32: (value: number, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  encrypt64: (value: bigint, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  options?: { onPositionOpened?: (positionId: bigint) => void }
): Promise<IntentExecutionResult> {
  if (!intent.pair || !intent.direction || !intent.leverage) {
    return { success: false, message: 'Missing required parameters for opening position.' };
  }

  try {
    const contract = await getPerpDEXContract(signer);
    const contractAddress = await contract.getAddress();
    
    // Optimize gas (with fallback for RPC failures)
    let gasOptimization;
    try {
      gasOptimization = await optimizeGas(provider, contractAddress, 'createMarketOrder', []);
    } catch (gasError: any) {
      console.warn('[IntentExecutor] Gas optimization failed, using defaults:', gasError);
      // Use fallback gas limit
      gasOptimization = {
        gasEstimate: BigInt(500000),
        gasPrice: BigInt(0),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        recommendedGasLimit: BigInt(600000), // 500k + 20% buffer
        estimatedCost: '0.001',
        timing: 'optimal' as const,
      };
    }
    
    // Check price staleness (non-blocking, just for info)
    try {
      const priceCheck = await checkPriceStaleness(provider, intent.pair);
      if (priceCheck.isStale) {
        // Price will be updated automatically by the contract
        console.log('[IntentExecutor] Price is stale, will be updated before opening position');
      }
    } catch (priceError: any) {
      console.warn('[IntentExecutor] Price staleness check failed (non-critical):', priceError);
      // Continue anyway, price will be updated before opening
    }

    // Encrypt direction and leverage
    const directionBool = intent.direction === 'long';
    const encryptedDirectionInput = await encryptBool(directionBool, contractAddress, account);
    const encryptedLeverageInput = await encrypt32(intent.leverage, contractAddress, account);
    
    // Convert handles[0] to hex strings (as expected by contract)
    // Note: contract expects bytes (not bytes[]), so we use handles[0] directly
    const encryptedDirection = ethers.hexlify(encryptedDirectionInput.handles[0]);
    const inputProofDirection = ethers.hexlify(encryptedDirectionInput.inputProof);
    const encryptedLeverage = ethers.hexlify(encryptedLeverageInput.handles[0]);
    const inputProofLeverage = ethers.hexlify(encryptedLeverageInput.inputProof);

    // Collateral amount (default to 5 USDC if not specified)
    const collateralAmount = intent.collateral || 5;
    const collateralWei = ethers.parseUnits(collateralAmount.toString(), 6); // USDC has 6 decimals

    // Update price first (required by contract)
    const { getPriceWithFallback } = await import('../utils/coingeckoApi');
    const priceResult = await getPriceWithFallback(intent.pair);
    if (!priceResult.price || priceResult.price <= 0) {
      return { success: false, message: 'Failed to fetch current price.' };
    }

    const scaledPrice = BigInt(Math.floor(priceResult.price * 1e8));
    
    // Update price with timeout and retry
    let updateTx;
    let updateReceipt;
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        updateTx = await contract.updatePrice(intent.pair, scaledPrice, {
          gasLimit: BigInt(100000),
        });
        
        // Wait with timeout (30 seconds)
        const waitPromise = updateTx.wait();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), 30000)
        );
        
        updateReceipt = await Promise.race([waitPromise, timeoutPromise]) as ethers.ContractTransactionReceipt;
        break; // Success, exit retry loop
      } catch (error: any) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error('[IntentExecutor] Price update failed after retries:', error);
          // Try to get receipt from provider if transaction was sent
          if (updateTx?.hash) {
            try {
              await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s for Privy
              updateReceipt = await provider.getTransactionReceipt(updateTx.hash);
              if (updateReceipt && updateReceipt.status === 1) {
                console.log('[IntentExecutor] Retrieved receipt from provider after timeout');
                break;
              } else {
                return { success: false, message: 'Price update transaction failed. Please try again.' };
              }
            } catch (receiptError) {
              console.error('[IntentExecutor] Failed to get receipt:', receiptError);
              return { success: false, message: 'Price update failed. Please try again.' };
            }
          }
          if (!updateReceipt) {
            return { success: false, message: 'Price update failed. Please try again.' };
          }
        } else {
          console.log(`[IntentExecutor] Price update retry ${retryCount}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s before retry
        }
      }
    }

    // Wait for block confirmation to ensure lastUpdateTime is updated
    if (updateReceipt) {
      console.log('[IntentExecutor] Waiting 2 seconds for block confirmation after price update...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Estimate gas first to get better error messages
    let estimatedGas: bigint;
    try {
      console.log('[IntentExecutor] Estimating gas for createMarketOrder...', {
        pair: intent.pair,
        leverage: intent.leverage,
        collateral: collateralWei.toString(),
        collateralUSDC: Number(collateralWei) / 1e6
      });
      
      estimatedGas = await contract.createMarketOrder.estimateGas(
        intent.pair,
        encryptedDirection,
        encryptedLeverage,
        inputProofDirection,
        inputProofLeverage,
        intent.leverage,
        collateralWei
      );
      
      // Add 20% buffer
      estimatedGas = (estimatedGas * BigInt(120)) / BigInt(100);
      console.log('[IntentExecutor] Gas estimation successful:', estimatedGas.toString());
    } catch (estimateError: any) {
      console.error('[IntentExecutor] Gas estimation failed:', estimateError);
      
      // Try to extract detailed error message
      let errorMsg = 'Failed to estimate gas';
      if (estimateError.reason) {
        errorMsg = estimateError.reason;
      } else if (estimateError.message) {
        errorMsg = estimateError.message;
      } else if (estimateError.error?.message) {
        errorMsg = estimateError.error.message;
      }
      
      // Check for common errors
      if (errorMsg.includes('insufficient liquidity') || errorMsg.includes('liquidity')) {
        errorMsg = 'Insufficient liquidity in the pool. Please try a smaller position size.';
      } else if (errorMsg.includes('price too stale') || errorMsg.includes('stale')) {
        errorMsg = 'Price is too stale. Please wait a moment and try again.';
      } else if (errorMsg.includes('leverage')) {
        errorMsg = 'Invalid leverage. Please check your leverage setting.';
      } else if (errorMsg.includes('collateral')) {
        errorMsg = 'Invalid collateral amount. Please check your collateral.';
      } else if (errorMsg.includes('pair') || errorMsg.includes('Pair')) {
        errorMsg = 'Pair configuration error. Please try another pair.';
      }
      
      return { success: false, message: errorMsg };
    }

    // Create market order
    const tx = await contract.createMarketOrder(
      intent.pair,
      encryptedDirection,
      encryptedLeverage,
      inputProofDirection,
      inputProofLeverage,
      intent.leverage,
      collateralWei,
      {
        gasLimit: estimatedGas,
      }
    );

    const receipt = await tx.wait();
    
    // Check if transaction was successful
    if (!receipt || receipt.status === 0) {
      return { 
        success: false, 
        message: 'Transaction failed. Please check your balance and try again.' 
      };
    }
    
    // Extract position ID from event
    let positionId: bigint | null = null;
    if (receipt && receipt.logs) {
      const iface = contract.interface;
      for (const log of receipt.logs) {
        try {
          const parsedLog = iface.parseLog(log);
          if (parsedLog && parsedLog.name === 'PositionOpened') {
            positionId = parsedLog.args.positionId as bigint;
            break;
          }
        } catch (e) {
          // Not a PositionOpened event
        }
      }
    }

    if (positionId) {
      // Store direction in localStorage and indexer (CRITICAL for position closing)
      try {
        const { storePositionDirection } = await import('../utils/positionDirection');
        storePositionDirection(positionId, intent.direction);
        console.log(`[IntentExecutor] Stored direction ${intent.direction} for position ${positionId.toString()}`);
        
        // Also store direction in indexer
        try {
          const { setPositionDirection } = await import('../utils/envio');
          await setPositionDirection(positionId.toString(), intent.direction);
          console.log(`[IntentExecutor] Stored direction ${intent.direction} in indexer for position ${positionId.toString()}`);
        } catch (err) {
          console.warn('[IntentExecutor] Could not store direction in indexer:', err);
        }
      } catch (dirError) {
        console.error('[IntentExecutor] Error storing direction:', dirError);
        // Continue anyway - direction storage is important but not critical for opening
      }
      
      // Update open interest in contract (direction is now decrypted)
      try {
        const contract = await getPerpDEXContract(signer);
        const isLong = intent.direction === 'long';
        console.log(`[IntentExecutor] Updating open interest for position ${positionId.toString()}, direction: ${intent.direction}`);
        
        // Call updateOpenInterest to correctly track long/short positions
        const updateTx = await contract.updateOpenInterest(positionId, isLong);
        await updateTx.wait();
        console.log(`[IntentExecutor] Open interest updated successfully for position ${positionId.toString()}`);
      } catch (updateError: any) {
        // Non-critical error - log but don't fail the position opening
        console.warn('[IntentExecutor] Failed to update open interest (non-critical):', updateError);
      }
      
      // Auto setup SL/TP/Hedge
      await autoSetupAfterPositionOpen(
        signer,
        account,
        positionId,
        intent.pair,
        intent.direction,
        intent,
        encrypt64
      );

      if (options?.onPositionOpened) {
        options.onPositionOpened(positionId);
      }
    }

    return {
      success: true,
      message: `Position opened successfully!`,
      positionId: positionId || undefined,
      transactionHash: receipt?.hash,
    };
  } catch (error: any) {
    console.error('[IntentExecutor] Error opening position:', error);
    
    // Extract error message safely
    let errorMessage = 'Failed to open position.';
    if (error?.reason && typeof error.reason === 'string') {
      errorMessage = error.reason;
    } else if (error?.message && typeof error.message === 'string') {
      errorMessage = error.message;
    } else if (error?.error?.message && typeof error.error.message === 'string') {
      errorMessage = error.error.message;
    } else if (error?.error?.reason && typeof error.error.reason === 'string') {
      errorMessage = error.error.reason;
    } else if (error?.data?.message && typeof error.data.message === 'string') {
      errorMessage = error.data.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else {
      // Last resort: try to stringify, but limit length
      try {
        const errorStr = JSON.stringify(error);
        errorMessage = errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
      } catch {
        errorMessage = 'Unknown error occurred. Please try again.';
      }
    }
    
    return {
      success: false,
      message: errorMessage,
    };
  }
}

async function executeClosePosition(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  provider: ethers.Provider,
  options?: { onPositionClosed?: (positionId: bigint) => void }
): Promise<IntentExecutionResult> {
  // This will be handled by OpenPositions component
  // For now, return a message
  return {
    success: false,
    message: 'Please use the "Close" button on your open positions to close a position.',
  };
}

async function executePartialClose(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  provider: ethers.Provider,
  options?: { onPositionClosed?: (positionId: bigint) => void }
): Promise<IntentExecutionResult> {
  // Will be implemented when partial close is added to contract
  return {
    success: false,
    message: 'Partial close feature is coming soon.',
  };
}

async function executeSetStopLoss(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  encrypt64: (value: bigint, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>
): Promise<IntentExecutionResult> {
  // This will be handled by the stop loss component
  return {
    success: false,
    message: 'Please use the Stop Loss settings on your position to set stop loss.',
  };
}

async function executeSetTakeProfit(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string
): Promise<IntentExecutionResult> {
  // Will be implemented when take profit is added to contract
  return {
    success: false,
    message: 'Take Profit feature is coming soon.',
  };
}

async function executeHedge(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  provider: ethers.Provider,
  encryptBool: (value: boolean, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  encrypt32: (value: number, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  encrypt64: (value: bigint, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>,
  options?: { onPositionOpened?: (positionId: bigint) => void }
): Promise<IntentExecutionResult> {
  // Hedge will open a position in the opposite direction
  // This will be handled by the hedge button in OpenPositions component
  return {
    success: false,
    message: 'Please use the "Hedge" button on your open positions to create a hedge.',
  };
}

async function executeAddToPosition(
  intent: ParsedIntent,
  signer: ethers.JsonRpcSigner,
  account: string,
  provider: ethers.Provider,
  options?: { onPositionOpened?: (positionId: bigint) => void }
): Promise<IntentExecutionResult> {
  // Will be implemented when add to position is added to contract
  return {
    success: false,
    message: 'Add to Position feature is coming soon.',
  };
}

