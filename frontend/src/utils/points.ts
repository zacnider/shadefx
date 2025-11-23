/**
 * Points calculation and formatting utility for Perpetual DEX
 * 
 * Points are calculated in the frontend based on data from the indexer:
 * - Trading volume (collateral * leverage)
 * - Leverage multiplier (1x: 1.0, 2x: 1.1, 3x: 1.2, 4x: 1.3, 5x: 1.5)
 * - Order type multiplier (Market: 1.0, Limit: 1.2)
 * 
 * Rank is calculated in the frontend by sorting all users by totalPoints.
 */

/**
 * Calculate points based on trading volume, leverage, and order type
 * @param volume Trading volume in USDC (6 decimals, as string or bigint)
 * @param leverage Leverage multiplier (1-5)
 * @param orderType Order type ('market' or 'limit')
 * @returns Points earned (6 decimals, as bigint)
 */
export function calculatePoints(
  volume: bigint | string,
  leverage: number,
  orderType: 'market' | 'limit'
): bigint {
  const volumeBigInt = typeof volume === 'string' ? BigInt(volume) : volume;
  
  // Leverage multiplier
  const leverageMultiplier = getLeverageMultiplier(leverage);
  
  // Order type multiplier
  const orderMultiplier = orderType === 'limit' ? 1.2 : 1.0;
  
  // Calculate points (volume * leverageMultiplier * orderMultiplier)
  // Points are stored with same decimals as volume (6 decimals)
  const multiplier = leverageMultiplier * orderMultiplier;
  
  // Multiply by 1000 to preserve precision, then divide
  return (volumeBigInt * BigInt(Math.floor(multiplier * 1000))) / BigInt(1000);
}

/**
 * Get leverage multiplier for points calculation
 * @param leverage Leverage value (1-5)
 * @returns Multiplier value
 */
function getLeverageMultiplier(leverage: number): number {
  const multipliers: Record<number, number> = {
    1: 1.0,
    2: 1.1,
    3: 1.2,
    4: 1.3,
    5: 1.5,
  };
  return multipliers[leverage] || 1.0;
}

/**
 * Calculate trading volume from collateral and leverage
 * @param collateralAmount Collateral amount in USDC (6 decimals, as string or bigint)
 * @param leverage Leverage multiplier
 * @returns Trading volume in USDC (6 decimals, as bigint)
 */
export function calculateVolume(
  collateralAmount: bigint | string,
  leverage: number | string
): bigint {
  const collateralBigInt = typeof collateralAmount === 'string' ? BigInt(collateralAmount) : collateralAmount;
  const leverageNum = typeof leverage === 'string' ? Number(leverage) : leverage;
  return collateralBigInt * BigInt(leverageNum);
}

/**
 * Format points for display
 * Points are stored with 6 decimals (same as USDC)
 * @param points Points value (string or bigint with 6 decimals)
 * @returns Formatted string (e.g., "1.23K", "5.67M", "123.45")
 */
export function formatPoints(points: bigint | string | undefined | null): string {
  if (!points) return '0';
  
  const pointsBigInt = typeof points === 'string' ? BigInt(points) : points;
  const pointsNumber = Number(pointsBigInt) / 1e6; // Convert from 6 decimals
  
  if (pointsNumber >= 1e6) {
    return `${(pointsNumber / 1e6).toFixed(2)}M`;
  } else if (pointsNumber >= 1e3) {
    return `${(pointsNumber / 1e3).toFixed(2)}K`;
  } else {
    return pointsNumber.toFixed(2);
  }
}

