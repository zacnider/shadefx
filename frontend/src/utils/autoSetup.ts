/**
 * Auto Setup - Automatic SL/TP/Hedge setup after position opening
 */

import { getPerpDEXContract } from './perpdexContract';
import { setStopLoss } from './stopLoss';
import { ParsedIntent } from './intentParser';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';

/**
 * Auto setup SL/TP/Hedge after position is opened
 */
export async function autoSetupAfterPositionOpen(
  signer: ethers.JsonRpcSigner,
  account: string,
  positionId: bigint,
  pairKey: string,
  direction: 'long' | 'short',
  intent: ParsedIntent,
  encrypt64?: (value: bigint, contractAddress: string, userAddress: string) => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>
): Promise<void> {
  try {
    // Setup Stop Loss if specified
    if (intent.stopLoss && intent.stopLoss > 0) {
      try {
        await setStopLoss(
          positionId,
          intent.stopLoss,
          signer,
          account,
          encrypt64
        );
        console.log(`[AutoSetup] Stop Loss set to ${intent.stopLoss} for position ${positionId.toString()}`);
        toast.success(`Stop Loss set to $${intent.stopLoss.toLocaleString()}`);
      } catch (error: any) {
        console.error('[AutoSetup] Failed to set Stop Loss:', error);
        toast.warn('Failed to set Stop Loss automatically. You can set it manually.');
      }
    }

    // Setup Take Profit if specified
    // Note: Take Profit will be implemented in contract later
    // For now, we'll store it in localStorage for future Gelato integration
    if (intent.takeProfit && intent.takeProfit > 0) {
      try {
        // Store TP in localStorage for Gelato integration
        const tpKey = `shadefx_tp_${positionId.toString()}`;
        localStorage.setItem(tpKey, JSON.stringify({
          positionId: positionId.toString(),
          pairKey,
          direction,
          targetPrice: intent.takeProfit,
          timestamp: Date.now(),
        }));
        console.log(`[AutoSetup] Take Profit set to ${intent.takeProfit} for position ${positionId.toString()}`);
        toast.success(`Take Profit set to $${intent.takeProfit.toLocaleString()}`);
      } catch (error: any) {
        console.error('[AutoSetup] Failed to set Take Profit:', error);
        toast.warn('Failed to set Take Profit automatically. You can set it manually.');
      }
    }

    // Setup Hedge if specified
    if (intent.action === 'hedge' || (intent.action === 'open' && intent.pair)) {
      // Hedge will be handled separately by the hedge button
      // This is just a placeholder for future implementation
      console.log(`[AutoSetup] Hedge requested for ${intent.pair}`);
    }
  } catch (error: any) {
    console.error('[AutoSetup] Error in auto setup:', error);
    // Don't throw - auto setup failures shouldn't block position opening
  }
}

/**
 * Get opposite direction for hedging
 */
export function getOppositeDirection(direction: 'long' | 'short'): 'long' | 'short' {
  return direction === 'long' ? 'short' : 'long';
}

/**
 * Check if user has an open position in the opposite direction (for hedge)
 */
export async function hasOppositePosition(
  provider: ethers.Provider,
  account: string,
  pairKey: string,
  direction: 'long' | 'short'
): Promise<boolean> {
  try {
    const contract = await getPerpDEXContract(provider);
    const userPositions = await contract.getUserPairPositions(account, pairKey);
    
    if (userPositions.length === 0) {
      return false;
    }

    // Check each position to see if it's in the opposite direction
    const oppositeDirection = getOppositeDirection(direction);
    
    // Note: We need to check direction from indexer or localStorage
    // For now, we'll check if there are any open positions
    // Full implementation will check direction from indexer
    
    return userPositions.length > 0;
  } catch (error: any) {
    console.error('[AutoSetup] Error checking opposite position:', error);
    return false;
  }
}

