/**
 * Utility functions to store and retrieve stop loss prices for positions
 * Stop loss is stored in the contract (encrypted), indexer, and localStorage as fallback
 */

import { setStopLossPrice as setIndexerStopLoss, graphqlQuery } from './envio';
import { getPerpDEXContract } from './perpdexContract';
import { ethers } from 'ethers';

const STORAGE_KEY = 'shadefx_stop_losses';

interface StopLossData {
  [positionId: string]: {
    price: number; // Stop loss price in USD
    createdAt: number; // Timestamp when stop loss was set
  };
}

/**
 * Store stop loss price for a position (saves to contract encrypted, indexer, and localStorage)
 * @param positionId Position ID
 * @param price Stop loss price in USD
 * @param signer Optional signer for contract transaction (if provided, will encrypt and send to contract)
 * @param account Optional account address for encryption
 * @param encrypt64 Optional encrypt64 function from useFHEVM hook
 */
export const setStopLoss = async (
  positionId: bigint, 
  price: number,
  signer?: ethers.JsonRpcSigner,
  account?: string,
  encrypt64?: (value: bigint, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>
): Promise<void> => {
  try {
    // Convert price to PRICE_PRECISION (1e8) for contract and indexer
    const scaledPrice = BigInt(Math.floor(price * 1e8));
    
    // If signer, account, and encrypt64 are provided, send encrypted stop loss to contract
    if (signer && account && encrypt64) {
      try {
        const contract = await getPerpDEXContract(signer);
        const contractAddress = await contract.getAddress();
        
        // Encrypt stop loss price
        const encryptedInput = await encrypt64(scaledPrice, contractAddress, account);
        const encryptedStopLoss = ethers.hexlify(encryptedInput.handles[0]);
        const inputProof = ethers.hexlify(encryptedInput.inputProof);
        
        // Call contract setStopLoss function
        const tx = await contract.setStopLoss(positionId, encryptedStopLoss, inputProof);
        await tx.wait();
        
        console.log(`[StopLoss] Saved encrypted stop loss to contract for position ${positionId.toString()}: $${price.toFixed(4)}`);
      } catch (contractError: any) {
        console.warn('[StopLoss] Failed to save to contract, continuing with indexer/localStorage:', contractError);
        // Continue to indexer/localStorage fallback
      }
    }
    
    // Try to save to indexer
    try {
      const success = await setIndexerStopLoss(positionId.toString(), scaledPrice);
      if (success) {
        console.log(`[StopLoss] Saved stop loss to indexer for position ${positionId.toString()}: $${price.toFixed(4)}`);
      }
    } catch (indexerError) {
      console.warn('[StopLoss] Failed to save to indexer:', indexerError);
    }
    
    // Always save to localStorage as backup
    const stored = localStorage.getItem(STORAGE_KEY);
    const stopLosses: StopLossData = stored ? JSON.parse(stored) : {};
    stopLosses[positionId.toString()] = {
      price,
      createdAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stopLosses));
    console.log(`[StopLoss] Set stop loss (localStorage) for position ${positionId.toString()}: $${price.toFixed(4)}`);
  } catch (error) {
    console.error('Error storing stop loss:', error);
  }
};

/**
 * Get stop loss price for a position (from indexer if available, fallback to localStorage)
 * Note: This function should be called with position data from indexer when possible
 */
export const getStopLoss = (positionId: bigint, indexerStopLossPrice?: string | null): number | null => {
  // If indexer provides stop loss price, use it
  if (indexerStopLossPrice !== undefined && indexerStopLossPrice !== null) {
    const price = BigInt(indexerStopLossPrice);
    return Number(price) / 1e8; // Convert from PRICE_PRECISION
  }
  
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const stopLosses: StopLossData = JSON.parse(stored);
    const stopLoss = stopLosses[positionId.toString()];
    return stopLoss ? stopLoss.price : null;
  } catch (error) {
    console.error('Error getting stop loss:', error);
    return null;
  }
};

/**
 * Get all stop losses
 */
export const getAllStopLosses = (): Map<bigint, number> => {
  const stopLosses = new Map<bigint, number>();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return stopLosses;
    const stopLossesData: StopLossData = JSON.parse(stored);
    Object.entries(stopLossesData).forEach(([positionIdStr, data]) => {
      stopLosses.set(BigInt(positionIdStr), data.price);
    });
  } catch (error) {
    console.error('Error getting all stop losses:', error);
  }
  return stopLosses;
};

/**
 * Remove stop loss for a position (when position is closed)
 */
export const removeStopLoss = async (positionId: bigint): Promise<void> => {
  try {
    // Try to remove from indexer first
    try {
      await setIndexerStopLoss(positionId.toString(), null);
      console.log(`[StopLoss] Removed stop loss from indexer for position ${positionId.toString()}`);
    } catch (indexerError) {
      console.warn('[StopLoss] Failed to remove from indexer:', indexerError);
    }
    
    // Also remove from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const stopLosses: StopLossData = JSON.parse(stored);
    delete stopLosses[positionId.toString()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stopLosses));
    console.log(`[StopLoss] Removed stop loss (localStorage) for position ${positionId.toString()}`);
  } catch (error) {
    console.error('Error removing stop loss:', error);
  }
};

/**
 * Update stop loss price for a position
 */
export const updateStopLoss = async (positionId: bigint, newPrice: number): Promise<void> => {
  await setStopLoss(positionId, newPrice);
};

/**
 * Check if stop loss should be triggered
 * @param positionId Position ID
 * @param currentPrice Current market price
 * @param direction Position direction ('long' or 'short')
 * @returns true if stop loss should be triggered
 */
export const shouldTriggerStopLoss = (
  positionId: bigint,
  currentPrice: number,
  direction: 'long' | 'short',
  indexerStopLossPrice?: string | null
): boolean => {
  const stopLossPrice = getStopLoss(positionId, indexerStopLossPrice);
  if (!stopLossPrice) return false;

  if (direction === 'long') {
    // Long position: trigger if price falls below stop loss
    return currentPrice <= stopLossPrice;
  } else {
    // Short position: trigger if price rises above stop loss
    return currentPrice >= stopLossPrice;
  }
};

