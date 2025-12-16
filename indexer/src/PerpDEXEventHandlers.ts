// @ts-nocheck
const generated = require("../generated/index.js");
const ShadeFXPerpDEX = generated.ShadeFXPerpDEX || generated;
const BigDecimal = generated.BigDecimal;

const toBigDecimal = (val) => new BigDecimal(val);

// Helper function to get or create UserStats (reuse from EventHandlers.ts pattern)
async function getUserStats(address, context, blockTimestamp) {
  const addressLower = address.toLowerCase();
  const existingStats = await context.UserStats.get(addressLower);
  
  const timestamp = blockTimestamp || BigInt(Math.floor(Date.now() / 1000));
  
  if (existingStats) {
    // Return existing stats - only PerpDEX fields exist now
    return existingStats;
  }
  
  // Create new UserStats with only PerpDEX fields
  return {
    id: addressLower,
    address: addressLower,
    totalPositions: BigInt(0),
    openPositions: BigInt(0),
    totalVolume: BigInt(0),
    totalPerpPnL: BigInt(0),
    totalOrders: BigInt(0),
    lastUpdated: timestamp,
  };
}

// Contract addresses
const NEW_CONTRACT_ADDRESS = "0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532".toLowerCase(); // Latest deployed ShadeFXPerpDEX (after contract splitting)
const OLD_CONTRACT_ADDRESS = "0x0E64d3FAED2D6163B2C6F4eA917fE3d86fE8528E".toLowerCase(); // Previous contract

// Handler for PositionOpened event
console.log('[PerpDEXEventHandlers] Registering PositionOpened handler...');
ShadeFXPerpDEX.PositionOpened.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[PositionOpened] Ignoring event from old contract: ${contractAddress}, positionId: ${event.params.positionId.toString()}`);
    return;
  }
  
  console.log(`[PositionOpened] Handler called! PositionId: ${event.params.positionId.toString()}, Contract: ${contractAddress}`);
  try {
    const { positionId, trader, pairKey, entryPrice, size, collateral, leverage, openingFee } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const traderLower = trader.toLowerCase();
    
    console.log(`[PositionOpened] Processing position ${positionId.toString()} for trader ${traderLower}`);
    
    // Get or create UserStats
    const userStats = await getUserStats(trader, context, timestamp);
    
    // Update UserStats
    userStats.totalPositions = (userStats.totalPositions || BigInt(0)) + BigInt(1);
    userStats.openPositions = (userStats.openPositions || BigInt(0)) + BigInt(1);
    userStats.totalVolume = (userStats.totalVolume || BigInt(0)) + size;
    userStats.lastUpdated = timestamp;
    
    context.UserStats.set(userStats);
    
    // Create Position entity
    const positionIdStr = positionId.toString();
    context.Position.set({
      id: positionIdStr,
      positionId: positionId,
      trader_id: traderLower, // Direct field like Bagless
      pairKey: pairKey,
      entryPrice: entryPrice,
      exitPrice: undefined, // null until closed
      size: size,
      collateral: collateral,
      leverage: leverage,
      timestamp: timestamp,
      closedAt: undefined, // null until closed
      isOpen: true,
      liquidationPrice: BigInt(0), // Will be updated from contract if needed
      openingFee: openingFee,
      closingFee: BigInt(0), // Will be set on close
      pnl: undefined, // null until closed
      pnlPercent: undefined, // null until closed
      direction: null, // Will be set by frontend via mutation
    });
    
    console.log(`[PositionOpened] Position created: ${positionIdStr} for trader ${traderLower}`);
    
    // Try to get direction from OpenInterestUpdated event if available
    // This will be set when frontend calls updateOpenInterest
    // For now, direction is null and will be updated by OpenInterestUpdated event handler
  } catch (error) {
    console.error(`[PositionOpened] ERROR:`, error);
    console.error(`[PositionOpened] Error stack:`, error.stack);
    throw error;
  }
});
console.log('[PerpDEXEventHandlers] PositionOpened handler registered');

// Handler for PositionClosed event
ShadeFXPerpDEX.PositionClosed.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[PositionClosed] Ignoring event from old contract: ${contractAddress}, positionId: ${event.params.positionId.toString()}`);
    return;
  }
  
  try {
    const { positionId, trader, pairKey, exitPrice, pnl, collateralReturned, closingFee } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const traderLower = trader.toLowerCase();
    const positionIdStr = positionId.toString();
    
    // Get existing position
    const position = await context.Position.get(positionIdStr);
    if (!position) {
      console.error(`[PositionClosed] Position not found: ${positionIdStr}`);
      return;
    }
    
    // Update position
    const pnlBigInt = BigInt(pnl.toString()); // Convert int256 to BigInt (handle negative)
    const pnlPercent = position.collateral > BigInt(0) 
      ? toBigDecimal((Number(pnlBigInt) * 100) / Number(position.collateral))
      : toBigDecimal("0");
    
    context.Position.set({
      ...position,
      exitPrice: exitPrice,
      closedAt: timestamp,
      isOpen: false,
      closingFee: closingFee,
      pnl: pnlBigInt,
      pnlPercent: pnlPercent,
      direction: position.direction ?? null, // Explicitly preserve direction to prevent undefined errors
    });
    
    // Update UserStats
    const userStats = await getUserStats(trader, context, timestamp);
    userStats.openPositions = (userStats.openPositions || BigInt(0)) > BigInt(0) 
      ? (userStats.openPositions || BigInt(0)) - BigInt(1) 
      : BigInt(0);
    userStats.totalPerpPnL = (userStats.totalPerpPnL || BigInt(0)) + pnlBigInt;
    userStats.lastUpdated = timestamp;
    
    context.UserStats.set(userStats);
    
    console.log(`[PositionClosed] Position closed: ${positionIdStr}, PnL: ${pnlBigInt.toString()}`);
  } catch (error) {
    console.error(`[PositionClosed] ERROR:`, error);
    throw error;
  }
});

// Handler for PositionLiquidated event
ShadeFXPerpDEX.PositionLiquidated.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[PositionLiquidated] Ignoring event from old contract: ${contractAddress}, positionId: ${event.params.positionId.toString()}`);
    return;
  }
  
  try {
    const { positionId, trader, pairKey, liquidator, liquidationPrice } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const positionIdStr = positionId.toString();
    
    // Get existing position
    const position = await context.Position.get(positionIdStr);
    if (!position) {
      console.error(`[PositionLiquidated] Position not found: ${positionIdStr}`);
      return;
    }
    
    // Update position (similar to closed, but marked as liquidated)
    // Calculate PnL as total loss (collateral - liquidation fee)
    const totalLoss = position.collateral; // Assume total loss on liquidation
    const pnlBigInt = -totalLoss; // Negative PnL
    const pnlPercent = toBigDecimal("-100"); // 100% loss
    
    context.Position.set({
      ...position,
      exitPrice: liquidationPrice,
      closedAt: timestamp,
      isOpen: false,
      closingFee: BigInt(0), // No closing fee on liquidation
      pnl: pnlBigInt,
      pnlPercent: pnlPercent,
      direction: position.direction ?? null, // Explicitly preserve direction to prevent undefined errors
    });
    
    // Update UserStats
    const userStats = await getUserStats(trader, context, timestamp);
    userStats.openPositions = (userStats.openPositions || BigInt(0)) > BigInt(0) 
      ? (userStats.openPositions || BigInt(0)) - BigInt(1) 
      : BigInt(0);
    userStats.totalPerpPnL = (userStats.totalPerpPnL || BigInt(0)) + pnlBigInt;
    userStats.lastUpdated = timestamp;
    
    context.UserStats.set(userStats);
    
    console.log(`[PositionLiquidated] Position liquidated: ${positionIdStr}`);
  } catch (error) {
    console.error(`[PositionLiquidated] ERROR:`, error);
    throw error;
  }
});

// Handler for OrderCreated event
ShadeFXPerpDEX.OrderCreated.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[OrderCreated] Ignoring event from old contract: ${contractAddress}, orderId: ${event.params.orderId.toString()}`);
    return;
  }
  
  try {
    const { orderId, trader, pairKey, orderType, limitPrice, collateralAmount, leverage } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const traderLower = trader.toLowerCase();
    const orderIdStr = orderId.toString();
    
    // Get or create UserStats
    const userStats = await getUserStats(trader, context, timestamp);
    userStats.totalOrders = (userStats.totalOrders || BigInt(0)) + BigInt(1);
    userStats.lastUpdated = timestamp;
    
    context.UserStats.set(userStats);
    
    // Create Order entity
    context.Order.set({
      id: orderIdStr,
      orderId: orderId,
      trader_id: traderLower, // Direct field like Bagless
      pairKey: pairKey,
      orderType: Number(orderType), // 0 = MARKET, 1 = LIMIT
      status: 0, // PENDING
      limitPrice: limitPrice,
      collateralAmount: collateralAmount,
      leverage: leverage,
      timestamp: timestamp,
      expiryTime: BigInt(0), // Will be set from contract if available
      executedAt: undefined, // null until executed
      cancelledAt: undefined, // null until cancelled
      positionId: undefined, // null until executed
      direction: null, // Will be set by frontend via mutation
    });
    
    console.log(`[OrderCreated] Order created: ${orderIdStr} for trader ${traderLower}`);
  } catch (error) {
    console.error(`[OrderCreated] ERROR:`, error);
    throw error;
  }
});

// Handler for OrderExecuted event
ShadeFXPerpDEX.OrderExecuted.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[OrderExecuted] Ignoring event from old contract: ${contractAddress}, orderId: ${event.params.orderId.toString()}`);
    return;
  }
  
  try {
    const { orderId, positionId, trader, pairKey, executionPrice } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const orderIdStr = orderId.toString();
    
    // Get existing order
    const order = await context.Order.get(orderIdStr);
    if (!order) {
      console.error(`[OrderExecuted] Order not found: ${orderIdStr}`);
      return;
    }
    
    // Update order - preserve direction field explicitly to prevent undefined errors
    context.Order.set({
      ...order,
      status: 1, // EXECUTED
      executedAt: timestamp,
      positionId: positionId,
      direction: order.direction ?? null, // Explicitly preserve direction to prevent RescriptSchemaError
    });
    
    console.log(`[OrderExecuted] Order executed: ${orderIdStr}, Position: ${positionId.toString()}`);
  } catch (error) {
    console.error(`[OrderExecuted] ERROR:`, error);
    throw error;
  }
});

// Handler for OrderCancelled event
ShadeFXPerpDEX.OrderCancelled.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[OrderCancelled] Ignoring event from old contract: ${contractAddress}, orderId: ${event.params.orderId.toString()}`);
    return;
  }
  
  try {
    const { orderId, trader, pairKey } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const orderIdStr = orderId.toString();
    
    // Get existing order
    const order = await context.Order.get(orderIdStr);
    if (!order) {
      console.error(`[OrderCancelled] Order not found: ${orderIdStr}`);
      return;
    }
    
    // Update order - preserve direction field explicitly to prevent undefined errors
    // Ensure direction is never undefined - use null if missing
    const directionValue = (order.direction !== undefined && order.direction !== null) ? order.direction : null;
    context.Order.set({
      ...order,
      status: 2, // CANCELLED
      cancelledAt: timestamp,
      direction: directionValue, // Explicitly set to null if undefined to prevent RescriptSchemaError
    });
    
    console.log(`[OrderCancelled] Order cancelled: ${orderIdStr}`);
  } catch (error) {
    console.error(`[OrderCancelled] ERROR:`, error);
    throw error;
  }
});

// Handler for OrderExpired event
ShadeFXPerpDEX.OrderExpired.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[OrderExpired] Ignoring event from old contract: ${contractAddress}, orderId: ${event.params.orderId.toString()}`);
    return;
  }
  
  try {
    const { orderId, trader, pairKey } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    const orderIdStr = orderId.toString();
    
    // Get existing order
    const order = await context.Order.get(orderIdStr);
    if (!order) {
      console.error(`[OrderExpired] Order not found: ${orderIdStr}`);
      return;
    }
    
    // Update order - preserve direction field explicitly to prevent undefined errors
    context.Order.set({
      ...order,
      status: 3, // EXPIRED
      cancelledAt: timestamp, // Use cancelledAt for expiry timestamp
      direction: order.direction ?? null, // Explicitly preserve direction to prevent RescriptSchemaError
    });
    
    console.log(`[OrderExpired] Order expired: ${orderIdStr}`);
  } catch (error) {
    console.error(`[OrderExpired] ERROR:`, error);
    throw error;
  }
});

// Handler for PairAdded event
ShadeFXPerpDEX.PairAdded.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[PairAdded] Ignoring event from old contract: ${contractAddress}, pairKey: ${event.params.pairKey}`);
    return;
  }
  
  try {
    const { pairKey, baseCurrency, quoteCurrency, initialPrice } = event.params;
    const timestamp = BigInt(event.block.timestamp);
    
    // Create or update CurrencyPair
    const existingPair = await context.CurrencyPair.get(pairKey);
    const initialPriceBigInt = BigInt(initialPrice.toString());
    
    if (existingPair) {
      // Update existing pair with initial price if not set
      // Ensure all fields are properly set, never undefined
      const existingPrice = (existingPair.currentPrice !== undefined && existingPair.currentPrice !== null)
        ? BigInt(existingPair.currentPrice.toString())
        : initialPriceBigInt;
      const existingUpdateTime = (existingPair.lastUpdateTime !== undefined && existingPair.lastUpdateTime !== null)
        ? BigInt(existingPair.lastUpdateTime.toString())
        : timestamp;
      
      context.CurrencyPair.set({
        id: existingPair.id,
        pairKey: existingPair.pairKey,
        baseCurrency: existingPair.baseCurrency,
        quoteCurrency: existingPair.quoteCurrency,
        isActive: true,
        createdAt: existingPair.createdAt,
        currentPrice: existingPrice,
        lastUpdateTime: existingUpdateTime,
        priceSource: existingPair.priceSource || "contract",
      });
    } else {
      // Create new pair with initial price
      context.CurrencyPair.set({
        id: pairKey,
        pairKey: pairKey,
        baseCurrency: baseCurrency,
        quoteCurrency: quoteCurrency,
        isActive: true,
        createdAt: timestamp,
        currentPrice: initialPriceBigInt,
        lastUpdateTime: timestamp,
        priceSource: "contract",
      });
    }
    
    console.log(`[PairAdded] Pair added/updated: ${pairKey}, initialPrice: ${initialPrice.toString()}`);
  } catch (error) {
    console.error(`[PairAdded] ERROR:`, error);
    throw error;
  }
});

// Handler for PriceUpdated event
ShadeFXPerpDEX.PriceUpdated.handler(async ({ event, context }) => {
  const contractAddress = event.srcAddress.toLowerCase();
  
  // Only process events from the new contract
  if (contractAddress !== NEW_CONTRACT_ADDRESS) {
    console.log(`[PriceUpdated] Ignoring event from old contract: ${contractAddress}, pairKey: ${event.params.pairKey}`);
    return;
  }
  
  try {
    const { pairKey, newPrice, timestamp } = event.params;
    
    // Validate newPrice exists
    if (!newPrice || newPrice === undefined) {
      console.warn(`[PriceUpdated] newPrice is undefined for ${pairKey}, skipping update`);
      return;
    }
    
    const updateTimestamp = BigInt(timestamp.toString());
    const priceBigInt = BigInt(newPrice.toString());
    
    // Get existing CurrencyPair - wrap in try-catch to handle schema errors
    let existingPair;
    try {
      existingPair = await context.CurrencyPair.get(pairKey);
    } catch (getError) {
      // If there's a schema error (e.g., currentPrice is undefined), skip this update
      console.warn(`[PriceUpdated] Error loading CurrencyPair ${pairKey}:`, getError.message || getError);
      return;
    }
    
    if (!existingPair) {
      // If pair doesn't exist yet, log warning but don't fail
      // It will be created when PairAdded event is emitted
      console.warn(`[PriceUpdated] CurrencyPair not found: ${pairKey}, will be created on PairAdded event`);
      return;
    }
    
    // Update price information
    // Determine price source from transaction (could be binance, pyth, or contract)
    // For now, we'll use "contract" as default, but this could be enhanced
    // by checking transaction data or other indicators
    const priceSource = "contract"; // Could be enhanced to detect binance/pyth
    
    // Ensure all required fields are present and optional fields are null instead of undefined
    // Handle potential undefined values from database
    const existingPrice = (existingPair.currentPrice !== undefined && existingPair.currentPrice !== null)
      ? BigInt(existingPair.currentPrice.toString())
      : priceBigInt; // Use new price if existing is invalid
    
    context.CurrencyPair.set({
      id: existingPair.id,
      pairKey: existingPair.pairKey,
      baseCurrency: existingPair.baseCurrency,
      quoteCurrency: existingPair.quoteCurrency,
      isActive: existingPair.isActive,
      createdAt: existingPair.createdAt,
      currentPrice: priceBigInt, // Always set to BigInt, never undefined
      lastUpdateTime: updateTimestamp,
      priceSource: priceSource,
    });
    
    console.log(`[PriceUpdated] Price updated for ${pairKey}: ${priceBigInt.toString()}, timestamp: ${updateTimestamp.toString()}`);
  } catch (error) {
    console.error(`[PriceUpdated] ERROR:`, error);
    throw error;
  }
});

// Handler for OpenInterestUpdated event
console.log('[PerpDEXEventHandlers] Registering OpenInterestUpdated handler...');
try {
  // Check if event is available in generated code
  if (ShadeFXPerpDEX && ShadeFXPerpDEX.OpenInterestUpdated && typeof ShadeFXPerpDEX.OpenInterestUpdated.handler === 'function') {
    ShadeFXPerpDEX.OpenInterestUpdated.handler(async ({ event, context }) => {
      const contractAddress = event.srcAddress.toLowerCase();
      
      // Only process events from the new contract
      if (contractAddress !== NEW_CONTRACT_ADDRESS) {
        console.log(`[OpenInterestUpdated] Ignoring event from old contract: ${contractAddress}, positionId: ${event.params.positionId.toString()}`);
        return;
      }
      
      try {
        const { positionId, pairKey, isLong, positionSize } = event.params;
        const positionIdStr = positionId.toString();
        
        console.log(`[OpenInterestUpdated] Handler called! PositionId: ${positionIdStr}, isLong: ${isLong}, Contract: ${contractAddress}`);
        
        // Get existing position
        const position = await context.Position.get(positionIdStr);
        if (!position) {
          console.warn(`[OpenInterestUpdated] Position not found: ${positionIdStr}, will be created when PositionOpened event is processed`);
          return;
        }
        
        // Convert boolean isLong to direction string
        const direction = isLong ? 'long' : 'short';
        
        // Update position with direction
        context.Position.set({
          ...position,
          direction: direction,
        });
        
        console.log(`[OpenInterestUpdated] Updated direction for position ${positionIdStr}: ${direction}`);
      } catch (error) {
        console.error(`[OpenInterestUpdated] ERROR:`, error);
        throw error;
      }
    });
    console.log('[PerpDEXEventHandlers] OpenInterestUpdated handler registered');
  } else {
    console.warn('[PerpDEXEventHandlers] OpenInterestUpdated event not available in generated code. Event may not be generated yet.');
  }
} catch (error) {
  console.warn('[PerpDEXEventHandlers] Could not register OpenInterestUpdated handler:', error.message);
  console.warn('[PerpDEXEventHandlers] This is normal on first start. Handler will be available after indexer generates code.');
}

