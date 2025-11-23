/**
 * Utility functions to store and retrieve position direction (long/short)
 * Since direction is encrypted in the contract, we store it locally when opening a position
 */

const STORAGE_KEY = 'shadefx_position_directions';

interface PositionDirection {
  [positionId: string]: 'long' | 'short';
}

/**
 * Store direction for a position
 */
export const storePositionDirection = (positionId: bigint, direction: 'long' | 'short'): void => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const directions: PositionDirection = stored ? JSON.parse(stored) : {};
    directions[positionId.toString()] = direction;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(directions));
  } catch (error) {
    console.error('Error storing position direction:', error);
  }
};

/**
 * Get direction for a position
 */
export const getPositionDirection = (positionId: bigint): 'long' | 'short' | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const directions: PositionDirection = JSON.parse(stored);
    return directions[positionId.toString()] || null;
  } catch (error) {
    console.error('Error getting position direction:', error);
    return null;
  }
};

/**
 * Get directions for multiple positions
 */
export const getPositionDirections = (positionIds: bigint[]): Map<bigint, 'long' | 'short'> => {
  const directions = new Map<bigint, 'long' | 'short'>();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.log('[getPositionDirections] No stored directions found in localStorage');
      return directions;
    }
    const storedDirections: PositionDirection = JSON.parse(stored);
    console.log('[getPositionDirections] Stored directions keys:', Object.keys(storedDirections));
    console.log('[getPositionDirections] Looking for position IDs:', positionIds.map(id => id.toString()));
    positionIds.forEach((id) => {
      const idStr = id.toString();
      const direction = storedDirections[idStr];
      if (direction) {
        directions.set(id, direction);
        console.log(`[getPositionDirections] Found direction ${direction} for position ${idStr}`);
      } else {
        console.log(`[getPositionDirections] No direction found for position ${idStr}`);
      }
    });
  } catch (error) {
    console.error('Error getting position directions:', error);
  }
  return directions;
};

/**
 * Remove direction for a position (when position is closed)
 */
export const removePositionDirection = (positionId: bigint): void => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const directions: PositionDirection = JSON.parse(stored);
    delete directions[positionId.toString()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(directions));
  } catch (error) {
    console.error('Error removing position direction:', error);
  }
};

/**
 * Store direction for a position from order execution
 * When a limit order is executed, map orderId -> positionId
 */
export const storePositionDirectionFromOrder = (orderId: bigint, positionId: bigint): void => {
  try {
    // Get direction from order
    const orderStored = localStorage.getItem('shadefx_order_directions');
    if (!orderStored) return;
    
    const orderDirections: Record<string, 'long' | 'short'> = JSON.parse(orderStored);
    const direction = orderDirections[orderId.toString()];
    
    if (direction) {
      // Store direction for position
      storePositionDirection(positionId, direction);
      
      // Remove from order directions
      delete orderDirections[orderId.toString()];
      localStorage.setItem('shadefx_order_directions', JSON.stringify(orderDirections));
      
      console.log(`[PositionDirection] Mapped order ${orderId.toString()} -> position ${positionId.toString()} with direction ${direction}`);
    }
  } catch (error) {
    console.error('Error storing position direction from order:', error);
  }
};

/**
 * Get direction for an order
 */
export const getOrderDirection = (orderId: bigint): 'long' | 'short' | null => {
  try {
    const stored = localStorage.getItem('shadefx_order_directions');
    if (!stored) return null;
    const orderDirections: Record<string, 'long' | 'short'> = JSON.parse(stored);
    return orderDirections[orderId.toString()] || null;
  } catch (error) {
    console.error('Error getting order direction:', error);
    return null;
  }
};

