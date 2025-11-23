/**
 * Envio Indexer GraphQL Client
 * 
 * The Envio indexer provides a GraphQL API via Hasura at http://localhost:8080/v1/graphql
 */

// Always use localhost for development - production URL (https://shadefx.cc/graphql) has different schema
// To use production, set REACT_APP_USE_PRODUCTION_INDEXER=true or load from window.__ENV__
const getEnvVar = (key: string, defaultValue: string): string => {
  // Check window.__ENV__ first (set by env-config.js in production)
  if (typeof window !== 'undefined' && (window as any).__ENV__) {
    const value = (window as any).__ENV__[key];
    if (value) return value;
  }
  // Fallback to process.env
  return process.env[key] || defaultValue;
};

const USE_PRODUCTION = getEnvVar('REACT_APP_USE_PRODUCTION_INDEXER', 'false').toLowerCase() === 'true';
// Envio indexer uses Hasura for GraphQL endpoint
const ENVIO_GRAPHQL_URL = USE_PRODUCTION
  ? (getEnvVar('REACT_APP_ENVIO_GRAPHQL_URL', 'https://shadefx.cc/graphql'))
  : 'http://localhost:8080/v1/graphql'; // Hasura GraphQL endpoint
const HASURA_ADMIN_SECRET = getEnvVar('REACT_APP_HASURA_ADMIN_SECRET', 'testing');

console.log('[envio.ts] Using GraphQL URL:', ENVIO_GRAPHQL_URL);

export interface UserStats {
  id: string;
  address: string;
  totalPoints: string;
  totalWon: string;
  totalLost: string;
  totalPredictions: string;
  winRate: string;
  totalStaked: string;
  totalPnL: string;
  totalClaimed: string;
  currentWinStreak: string;
  longestWinStreak: string;
  // PerpDEX Statistics
  totalPositions?: string;
  openPositions?: string;
  totalVolume?: string;  // Total trading volume in USDC
  totalPerpPnL?: string; // Total PnL from PerpDEX (can be negative)
  totalOrders?: string;
  perpDexPoints?: string; // Points earned from PerpDEX only
  rank?: number; // Global rank based on totalPoints
}

export interface RoundInfo {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  startPrice: string;
  endPrice: string;
  resultDeclared: boolean;
  predictionDeadline: string;
}

export interface Prediction {
  id: string;
  currencyPair: string;
  roundId: string;
  stakeAmount: string;
  isWinner: boolean;
  rewardClaimed: boolean;
  rewardAmount: string;
  timestamp: string;
  pointsAwarded: string;
  round?: RoundInfo;
}

export interface Round {
  id: string;
  currencyPair: string;
  roundId: string;
  totalPredictions: string;
  totalLongPredictions: string;
  totalShortPredictions: string;
  totalRewardPool: string;
  resultDeclared: boolean;
  createdAt: string;
}

/**
 * Execute a GraphQL query against the Envio indexer
 */
export async function graphqlQuery<T>(query: string, variables?: Record<string, any>): Promise<T> {
  // Trim query string but preserve GraphQL formatting
  const cleanedQuery = query.trim();
  
  const response = await fetch(ENVIO_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Envio indexer doesn't use Hasura admin secret, but keep it for backward compatibility
      ...(HASURA_ADMIN_SECRET && ENVIO_GRAPHQL_URL.includes('hasura') ? { 'x-hasura-admin-secret': HASURA_ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({ query: cleanedQuery, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GraphQL query failed: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    // Only log detailed errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[graphqlQuery] GraphQL errors:', result.errors);
      console.error('[graphqlQuery] Query:', cleanedQuery);
      console.error('[graphqlQuery] Variables:', variables);
    }
    // Extract error message for better debugging
    const errorMessage = result.errors[0]?.message || JSON.stringify(result.errors);
    throw new Error(`GraphQL errors: ${errorMessage}`);
  }

  return result.data;
}

/**
 * Execute a GraphQL mutation against the Envio indexer (for updates)
 */
export async function graphqlMutation<T>(mutation: string, variables?: Record<string, any>): Promise<T> {
  const cleanedMutation = mutation.trim();
  
  const response = await fetch(ENVIO_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query: cleanedMutation, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GraphQL mutation failed: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    console.error('[graphqlMutation] GraphQL errors:', result.errors);
    console.error('[graphqlMutation] Mutation:', cleanedMutation);
    console.error('[graphqlMutation] Variables:', variables);
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

/**
 * Set stop loss price for a position in the indexer
 */
export async function setStopLossPrice(positionId: string, stopLossPrice: bigint | null): Promise<boolean> {
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[setStopLossPrice] ENVIO_GRAPHQL_URL not configured');
    return false;
  }

  try {
    // Use Hasura's update mutation syntax
    // Note: stopLossPrice is numeric type in Hasura, not BigInt
    const mutation = `mutation SetStopLossPrice($positionId: String!, $stopLossPrice: numeric) {
      update_Position(where: {id: {_eq: $positionId}}, _set: {stopLossPrice: $stopLossPrice}) {
        affected_rows
      }
    }`;

    const variables = {
      positionId,
      stopLossPrice: stopLossPrice !== null ? stopLossPrice.toString() : null,
    };

    const data = await graphqlMutation<{ update_Position: { affected_rows: number } }>(mutation, variables);
    
      if (data.update_Position?.affected_rows > 0) {
      console.log(`[setStopLossPrice] Successfully set stop loss for position ${positionId}`);
      // Invalidate cache for positions
      invalidateCache('position');
      return true;
    } else {
      console.warn(`[setStopLossPrice] No rows affected for position ${positionId}`);
      return false;
    }
  } catch (error) {
    console.error('[setStopLossPrice] Error setting stop loss:', error);
    return false;
  }
}

/**
 * Set direction for a position in the indexer
 * Direction is encrypted in the contract, so we store it in the indexer from the frontend
 * when the position is opened (since we know the direction at that time)
 */
/**
 * Set order direction in indexer (for limit orders)
 */
export async function setOrderDirection(orderId: string, direction: 'long' | 'short'): Promise<boolean> {
  // Check if Envio indexer is available
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[setOrderDirection] ENVIO_GRAPHQL_URL not configured');
    return false;
  }

  // Check if indexer is healthy
  try {
    const isHealthy = await checkIndexerHealth();
    if (!isHealthy) {
      console.warn('[setOrderDirection] Indexer not available, skipping direction update');
      return false;
    }
  } catch (error) {
    console.warn('[setOrderDirection] Could not check indexer health:', error);
    return false;
  }

  // Use Hasura mutation to update Order direction
  const mutation = `mutation SetOrderDirection($orderId: String!, $direction: String!) {
    update_Order(where: {id: {_eq: $orderId}}, _set: {direction: $direction}) {
      affected_rows
    }
  }`;

  try {
    const variables = { orderId, direction };
    const data = await graphqlMutation<{ update_Order: { affected_rows: number } }>(mutation, variables);
    
    if (data.update_Order && data.update_Order.affected_rows > 0) {
      console.log(`[setOrderDirection] Successfully set direction ${direction} for order ${orderId}`);
      return true;
    } else {
      console.warn(`[setOrderDirection] No rows affected for order ${orderId} - order may not exist in indexer yet`);
      return false;
    }
  } catch (error) {
    // Non-critical error - log but don't fail
    console.error('[setOrderDirection] Error setting direction:', error);
    return false;
  }
}

export async function setPositionDirection(positionId: string, direction: 'long' | 'short'): Promise<boolean> {
  if (!ENVIO_GRAPHQL_URL) {
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('[setPositionDirection] ENVIO_GRAPHQL_URL not configured');
    }
    return false;
  }

  // Check if indexer is available first (use cached result)
  const indexerAvailable = await checkIndexerHealth();
  if (!indexerAvailable) {
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('[setPositionDirection] Indexer not available, skipping direction update');
    }
    return false;
  }

  try {
    // Use Hasura's update mutation syntax
    // Direction is a String type in Hasura
    const mutation = `mutation SetPositionDirection($positionId: String!, $direction: String!) {
      update_Position(where: {id: {_eq: $positionId}}, _set: {direction: $direction}) {
        affected_rows
      }
    }`;

    const variables = {
      positionId,
      direction,
    };

    const data = await graphqlMutation<{ update_Position: { affected_rows: number } }>(mutation, variables);
    
    if (data.update_Position?.affected_rows > 0) {
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[setPositionDirection] Successfully set direction ${direction} for position ${positionId}`);
      }
      // Invalidate cache for positions
      invalidateCache('position');
      return true;
    } else {
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[setPositionDirection] No rows affected for position ${positionId} - position may not exist in indexer yet`);
      }
      return false;
    }
  } catch (error) {
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[setPositionDirection] Error setting direction:', error);
    }
    return false;
  }
}

/**
 * Get user statistics by address
 */
export async function getUserStats(address: string): Promise<UserStats | null> {
  // Try both id and address fields since indexer might use either
  const query = `query GetUserStats($address: String!) {
      UserStats(where: {_or: [{id: {_eq: $address}}, {address: {_eq: $address}}]}) {
      id
      address
      totalPositions
      openPositions
      totalVolume
      totalPerpPnL
      totalOrders
      totalPoints
      perpDexPoints
      rank
    }
  }`;

  try {
    const lowerAddress = address.toLowerCase();
    console.log('[getUserStats] Fetching stats for:', lowerAddress);
    const data = await graphqlQuery<{ UserStats: UserStats[] }>(query, {
      address: lowerAddress,
    });

    console.log('[getUserStats] Query result:', data);
    const userStats = data.UserStats?.[0] || null;
    if (userStats) {
      console.log('[getUserStats] Found user stats:', {
        totalVolume: userStats.totalVolume,
        totalPerpPnL: userStats.totalPerpPnL,
        totalPositions: userStats.totalPositions,
        openPositions: userStats.openPositions,
        totalOrders: userStats.totalOrders,
      });
    } else {
      console.log('[getUserStats] No user stats found for address:', lowerAddress);
    }
    return userStats;
  } catch (error) {
    console.error('[getUserStats] Error fetching user stats:', error);
    return null;
  }
}

/**
 * Get user predictions
 */
export async function getUserPredictions(address: string): Promise<Prediction[]> {
  // Try querying through UserStats relationship (predictor is a relationship to UserStats)
  const query = `
    query GetUserPredictions($address: String!) {
      UserStats(where: {id: {_eq: $address}}, limit: 1) {
        predictions(order_by: {timestamp: desc}, limit: 100) {
          id
          currencyPair
          roundId
          stakeAmount
          isWinner
          rewardClaimed
          rewardAmount
          timestamp
          pointsAwarded
          round {
            id
            baseCurrency
            quoteCurrency
            startPrice
            endPrice
            resultDeclared
            predictionDeadline
          }
        }
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ UserStats: Array<{ predictions: Prediction[] }> }>(query, {
      address: address.toLowerCase(),
    });

    console.log('[getUserPredictions] Query result:', data);
    const predictions = data.UserStats?.[0]?.predictions || [];
    console.log(`[getUserPredictions] Found ${predictions.length} predictions for ${address}`);
    return predictions;
  } catch (error: any) {
    console.error('Error fetching user predictions:', error);
    console.error('Full error details:', error.message || error);
    
    // Fallback: Try direct Prediction query with nested where clause
    try {
          const fallbackQuery = `
            query GetUserPredictionsFallback($address: String!) {
              Prediction(
                where: {predictor: {id: {_eq: $address}}}
                order_by: {timestamp: desc}
                limit: 100
              ) {
                id
                currencyPair
                roundId
                stakeAmount
                isWinner
                rewardClaimed
                rewardAmount
                timestamp
                pointsAwarded
                round {
                  id
                  baseCurrency
                  quoteCurrency
                  startPrice
                  endPrice
                  resultDeclared
                  predictionDeadline
                }
              }
            }
          `;
      
      const fallbackData = await graphqlQuery<{ Prediction: Prediction[] }>(fallbackQuery, {
        address: address.toLowerCase(),
      });
      
      console.log(`[getUserPredictions] Fallback found ${fallbackData.Prediction?.length || 0} predictions`);
      return fallbackData.Prediction || [];
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * Get all unique trader addresses from Position and Order tables
 */
async function getAllTraders(): Promise<string[]> {
  if (!ENVIO_GRAPHQL_URL) {
    return [];
  }

  try {
    // Get unique traders from Position table
    const positionQuery = `query GetAllTradersFromPositions {
      Position(distinct_on: trader_id, limit: 1000) {
        trader_id
      }
    }`;

    // Get unique traders from Order table
    const orderQuery = `query GetAllTradersFromOrders {
      Order(distinct_on: trader_id, limit: 1000) {
        trader_id
      }
    }`;

    const [positionData, orderData] = await Promise.all([
      graphqlQuery<{ Position: Array<{ trader_id: string }> }>(positionQuery).catch(() => ({ Position: [] })),
      graphqlQuery<{ Order: Array<{ trader_id: string }> }>(orderQuery).catch(() => ({ Order: [] })),
    ]);

    const tradersSet = new Set<string>();
    positionData.Position?.forEach(p => {
      if (p.trader_id) tradersSet.add(p.trader_id.toLowerCase());
    });
    orderData.Order?.forEach(o => {
      if (o.trader_id) tradersSet.add(o.trader_id.toLowerCase());
    });

    return Array.from(tradersSet);
  } catch (error) {
    console.error('[getAllTraders] Error fetching traders:', error);
    return [];
  }
}

/**
 * Get leaderboard (top users by points or PerpDEX volume)
 */
export async function getLeaderboard(limit: number = 100, sortBy: 'volume' | 'pnl' | 'points' = 'volume'): Promise<UserStats[]> {
  let orderBy: string;
  
  switch (sortBy) {
    case 'pnl':
      orderBy = 'totalPerpPnL: desc_nulls_last';
      break;
    case 'points':
      orderBy = 'totalPoints: desc_nulls_last';
      break;
    default: // volume
      orderBy = 'totalVolume: desc_nulls_last';
  }
  
  const query = `query GetLeaderboard($limit: Int!) {
    UserStats(order_by: {${orderBy}}, limit: $limit) {
      id
      address
      totalPositions
      openPositions
      totalVolume
      totalPerpPnL
      totalOrders
      totalPoints
      perpDexPoints
      rank
    }
  }`;

  try {
    const data = await graphqlQuery<{ UserStats: UserStats[] }>(query, { limit });
    const userStats = data.UserStats || [];

    // If UserStats is empty, try to get traders from Position/Order tables
    if (userStats.length === 0) {
      console.log('[getLeaderboard] UserStats is empty, fetching traders from Position/Order tables');
      const traders = await getAllTraders();
      console.log('[getLeaderboard] Found', traders.length, 'traders from Position/Order tables');
      
      // Return empty array - Leaderboard will calculate from positions/orders
      return [];
    }

    return userStats;
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    // Try fallback: get traders from Position/Order
    try {
      const traders = await getAllTraders();
      console.log('[getLeaderboard] Fallback: Found', traders.length, 'traders');
      return [];
    } catch (fallbackError) {
      console.error('[getLeaderboard] Fallback also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * Get user's closed positions from Envio indexer (with caching)
 */
export async function getUserClosedPositions(address: string, pairKey?: string, limit: number = 50): Promise<Position[]> {
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[getUserClosedPositions] ENVIO_GRAPHQL_URL not configured');
    return [];
  }

  const cacheKey = `closed_positions_${address.toLowerCase()}_${pairKey || 'all'}`;
  const cached = getCached<Position[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const query = `query GetUserClosedPositions($address: String!${pairKey ? ', $pairKey: String!' : ''}, $limit: Int!) {
    Position(where: {trader_id: {_eq: $address}, isOpen: {_eq: false}${pairKey ? ', pairKey: {_eq: $pairKey}' : ''}}, order_by: {closedAt: desc}, limit: $limit) {
      id
      positionId
      pairKey
      entryPrice
      exitPrice
      size
      collateral
      leverage
      timestamp
      closedAt
      isOpen
      liquidationPrice
      openingFee
      closingFee
      pnl
      pnlPercent
      stopLossPrice
      direction
    }
  }`;

  try {
    const variables: any = { address: address.toLowerCase(), limit };
    if (pairKey) variables.pairKey = pairKey;
    
    console.log('[getUserClosedPositions] Fetching closed positions for:', address.toLowerCase());
    const data = await graphqlQuery<{ Position: Position[] }>(query, variables);
    const positions = data.Position || [];
    
    console.log(`[getUserClosedPositions] Found ${positions.length} closed positions`);
    setCache(cacheKey, positions);
    
    return positions;
  } catch (error) {
    console.error('[getUserClosedPositions] Error fetching closed positions:', error);
    return [];
  }
}

/**
 * Get user's order history from Envio indexer (with caching)
 */
export async function getUserOrderHistory(address: string, pairKey?: string, limit: number = 50): Promise<Order[]> {
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[getUserOrderHistory] ENVIO_GRAPHQL_URL not configured');
    return [];
  }

  const cacheKey = `order_history_${address.toLowerCase()}_${pairKey || 'all'}`;
  const cached = getCached<Order[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const query = `query GetUserOrderHistory($address: String!${pairKey ? ', $pairKey: String!' : ''}, $limit: Int!) {
    Order(where: {trader_id: {_eq: $address}${pairKey ? ', pairKey: {_eq: $pairKey}' : ''}}, order_by: {timestamp: desc}, limit: $limit) {
      id
      orderId
      pairKey
      orderType
      status
      limitPrice
      collateralAmount
      leverage
      timestamp
      expiryTime
      executedAt
      cancelledAt
      positionId
    }
  }`;

  try {
    const variables: any = { address: address.toLowerCase(), limit };
    if (pairKey) variables.pairKey = pairKey;
    
    console.log('[getUserOrderHistory] Fetching order history for:', address.toLowerCase());
    const data = await graphqlQuery<{ Order: Order[] }>(query, variables);
    const orders = data.Order || [];
    
    console.log(`[getUserOrderHistory] Found ${orders.length} orders`);
    setCache(cacheKey, orders);
    
    return orders;
  } catch (error) {
    console.error('[getUserOrderHistory] Error fetching order history:', error);
    return [];
  }
}

/**
 * Get rounds for a currency pair
 */
export async function getRoundsForPair(pairKey: string, limit: number = 10): Promise<Round[]> {
  const query = `
    query GetRoundsForPair($pairKey: String!, $limit: Int!) {
      Round(
        where: {currencyPair: {_eq: $pairKey}}
        order_by: {createdAt: desc}
        limit: $limit
      ) {
        id
        currencyPair
        roundId
        totalPredictions
        totalLongPredictions
        totalShortPredictions
        totalRewardPool
        resultDeclared
        createdAt
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ Round: Round[] }>(query, { pairKey, limit });

    return data.Round || [];
  } catch (error) {
    console.error('Error fetching rounds:', error);
    return [];
  }
}

/**
 * Check if Envio indexer is available
 */
// Cache for indexer health check (5 minutes)
let indexerHealthCache: { available: boolean; timestamp: number } | null = null;
const INDEXER_HEALTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function checkIndexerHealth(): Promise<boolean> {
  if (!ENVIO_GRAPHQL_URL) {
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('[checkIndexerHealth] ENVIO_GRAPHQL_URL not configured');
    }
    return false;
  }

  // Check cache first
  if (indexerHealthCache && Date.now() - indexerHealthCache.timestamp < INDEXER_HEALTH_CACHE_TTL) {
    return indexerHealthCache.available;
  }
  
  try {
    const query = `query { __typename }`;
    const result = await graphqlQuery<{ __typename: string }>(query);
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[checkIndexerHealth] Indexer is available');
    }
    indexerHealthCache = { available: true, timestamp: Date.now() };
    return true;
  } catch (error: any) {
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('[checkIndexerHealth] Indexer not available:', error.message);
    }
    indexerHealthCache = { available: false, timestamp: Date.now() };
    return false;
  }
}

// PerpDEX Interfaces
export interface Position {
  id: string;
  positionId: string;
  pairKey: string;
  entryPrice: string;
  exitPrice: string | null;
  size: string;
  collateral: string;
  leverage: string;
  timestamp: string;
  closedAt: string | null;
  isOpen: boolean;
  liquidationPrice: string;
  openingFee: string;
  closingFee: string;
  pnl: string | null;
  pnlPercent: string | null;
  stopLossPrice: string | null;
  direction: string | null; // "long" or "short"
}

export interface Order {
  id: string;
  orderId: string;
  pairKey: string;
  orderType: number;
  status: number;
  limitPrice: string;
  collateralAmount: string;
  leverage: string;
  timestamp: string;
  expiryTime: string;
  executedAt: string | null;
  cancelledAt: string | null;
  positionId: string | null;
  direction?: string | null; // "long" or "short", null if not set
}

// Simple in-memory cache for positions and orders (5 second TTL)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalidate cache for a specific key or all cache
 */
export function invalidateCache(pattern?: string): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  
  // Invalidate all keys matching pattern
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
}

/**
 * Get user's open positions from Envio indexer (with caching)
 */
export async function getUserOpenPositions(address: string, pairKey?: string): Promise<Position[]> {
  // Check if Envio indexer is available
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[getUserOpenPositions] ENVIO_GRAPHQL_URL not configured');
    return [];
  }

  // Check cache first
  const cacheKey = `positions_${address.toLowerCase()}_${pairKey || 'all'}`;
  const cached = getCached<Position[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Optimized query using indexed fields
  const query = `query GetUserOpenPositions($address: String!${pairKey ? ', $pairKey: String!' : ''}) {
    Position(where: {trader_id: {_eq: $address}, isOpen: {_eq: true}${pairKey ? ', pairKey: {_eq: $pairKey}' : ''}}, order_by: {timestamp: desc}, limit: 100) {
      id
      positionId
      pairKey
      entryPrice
      exitPrice
      size
      collateral
      leverage
      timestamp
      closedAt
      isOpen
      liquidationPrice
      openingFee
      closingFee
      pnl
      pnlPercent
      stopLossPrice
      direction
    }
  }`;

  try {
    const variables: any = { address: address.toLowerCase() };
    if (pairKey) variables.pairKey = pairKey;
    
    const data = await graphqlQuery<{ Position: Position[] }>(query, variables);
    const positions = data.Position || [];
    
    // Cache the result
    setCache(cacheKey, positions);
    
    return positions;
  } catch (error: any) {
    // Only log error in development mode
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching open positions:', error);
    }
    return [];
  }
}

/**
 * Get user's orders from Envio indexer (with caching and optimized query)
 */
export async function getUserOrders(address: string, pairKey?: string): Promise<Order[]> {
  // Check if Envio indexer is available
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[getUserOrders] ENVIO_GRAPHQL_URL not configured');
    return [];
  }

  // Check cache first
  const cacheKey = `orders_${address.toLowerCase()}_${pairKey || 'all'}`;
  const cached = getCached<Order[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Optimized query using indexed fields
  const query = `query GetUserOrders($address: String!${pairKey ? ', $pairKey: String!' : ''}) {
    Order(where: {trader_id: {_eq: $address}${pairKey ? ', pairKey: {_eq: $pairKey}' : ''}}, order_by: {timestamp: desc}, limit: 100) {
      id
      orderId
      pairKey
      orderType
      status
      limitPrice
      collateralAmount
      leverage
      timestamp
      expiryTime
      executedAt
      cancelledAt
      positionId
      direction
    }
  }`;

  try {
    const variables: any = { address: address.toLowerCase() };
    if (pairKey) variables.pairKey = pairKey;
    
    const data = await graphqlQuery<{ Order: Order[] }>(query, variables);
    const orders = data.Order || [];
    
    // Cache the result
    setCache(cacheKey, orders);
    
    return orders;
  } catch (error) {
    // Only log error in development mode
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching orders:', error);
    }
    return [];
  }
}

/**
 * Get all active pairs from Envio indexer (with caching)
 */
export async function getAllPairsFromIndexer(): Promise<Array<{ pairKey: string; isActive: boolean; baseCurrency?: string; quoteCurrency?: string }>> {
  // Check if Envio indexer is available
  if (!ENVIO_GRAPHQL_URL) {
    console.warn('[getAllPairsFromIndexer] ENVIO_GRAPHQL_URL not configured');
    return [];
  }

  // Check cache first
  const cacheKey = 'all_pairs';
  const cached = getCached<Array<{ pairKey: string; isActive: boolean; baseCurrency?: string; quoteCurrency?: string }>>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const query = `query GetAllPairs {
    CurrencyPair(where: {isActive: {_eq: true}}, order_by: {pairKey: asc}) {
      id
      pairKey
      isActive
      baseCurrency
      quoteCurrency
    }
  }`;

  try {
    const data = await graphqlQuery<{ CurrencyPair: Array<{ pairKey: string; isActive: boolean; baseCurrency: string; quoteCurrency: string }> }>(query);
    const pairs = data.CurrencyPair || [];
    
    // Cache the result
    setCache(cacheKey, pairs);
    
    return pairs;
  } catch (error) {
    // Only log error in development mode
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching pairs:', error);
    }
    return [];
  }
}

/**
 * Get CurrencyPair details for specific pairKeys (with price information)
 */
export async function getCurrencyPairsByKeys(pairKeys: string[]): Promise<Array<{ 
  pairKey: string; 
  baseCurrency: string; 
  quoteCurrency: string;
  currentPrice?: string;
  lastUpdateTime?: string;
  priceSource?: string;
}>> {
  if (!ENVIO_GRAPHQL_URL || pairKeys.length === 0) {
    return [];
  }

  const cacheKey = `currency_pairs_${pairKeys.sort().join('_')}`;
  const cached = getCached<Array<{ pairKey: string; baseCurrency: string; quoteCurrency: string; currentPrice?: string; lastUpdateTime?: string; priceSource?: string }>>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const query = `query GetCurrencyPairs($pairKeys: [String!]!) {
    CurrencyPair(where: {pairKey: {_in: $pairKeys}}) {
      pairKey
      baseCurrency
      quoteCurrency
      currentPrice
      lastUpdateTime
      priceSource
    }
  }`;

  try {
    const data = await graphqlQuery<{ CurrencyPair: Array<{ 
      pairKey: string; 
      baseCurrency: string; 
      quoteCurrency: string;
      currentPrice?: string;
      lastUpdateTime?: string;
      priceSource?: string;
    }> }>(query, {
      pairKeys,
    });
    const pairs = data.CurrencyPair || [];
    
    setCache(cacheKey, pairs);
    return pairs;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching CurrencyPair details:', error);
    }
    return [];
  }
}

