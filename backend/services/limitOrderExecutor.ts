/**
 * Limit Order Executor Service
 * 
 * This service checks pending limit orders from the indexer and executes them
 * when the price condition is met (based on direction).
 * 
 * Runs every 30 seconds to check and execute pending limit orders
 * 
 * Uses executeLimitOrder() function which is public (anyone can call)
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Contract configuration
const PERPDEX_CONTRACT_ADDRESS = process.env.PERPDEX_CONTRACT_ADDRESS || '0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93';
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Indexer GraphQL endpoint
const INDEXER_GRAPHQL_URL = process.env.INDEXER_GRAPHQL_URL || 'http://localhost:8080/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || '';

// Validate required environment variables
if (!SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL or RPC_URL is required in .env file');
}
if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY is required in .env file');
}

// Execution interval (30 seconds)
const EXECUTION_INTERVAL = parseInt(process.env.LIMIT_ORDER_EXECUTION_INTERVAL || '30000'); // 30 seconds default

// Price precision (1e8)
const PRICE_PRECISION = BigInt(1e8);

interface Order {
  id: string;
  orderId: string;
  pairKey: string;
  limitPrice: string;
  direction: string | null; // "long" or "short"
  status: number; // 0 = PENDING, 1 = EXECUTED, 2 = CANCELLED, 3 = EXPIRED
  orderType: number; // 0 = MARKET, 1 = LIMIT
  expiryTime: string;
}

class LimitOrderExecutor {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private isRunning: boolean = false;
  private executionInterval: NodeJS.Timeout | null = null;

  constructor() {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }

    // Create provider
    this.provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, {
      name: 'sepolia',
      chainId: 11155111,
    });
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    
    // Load ABI from artifacts
    let abiPath = path.join(__dirname, '../../../artifacts/contracts/ShadeFXPerpDEX.sol/ShadeFXPerpDEX.json');
    let abi: any;
    try {
      const abiFile = fs.readFileSync(abiPath, 'utf8');
      abi = JSON.parse(abiFile).abi;
      console.log('✅ Loaded ShadeFXPerpDEX ABI');
    } catch (error) {
      // Fallback: minimal ABI for required functions
      abi = [
        'function executeLimitOrder(uint256 orderId) external',
        'function orders(uint256) external view returns (tuple(uint256 orderId, address trader, string pairKey, uint8 orderType, uint8 status, uint256 limitPrice, uint256 collateralAmount, uint256 leverage, uint256 timestamp, uint256 expiryTime, bytes encryptedDirection))',
        'function getPairOrders(string memory pairKey) external view returns (uint256[] memory)',
      ];
      console.log('⚠️  Using minimal ABI (fallback)');
    }
    
    this.contract = new ethers.Contract(PERPDEX_CONTRACT_ADDRESS, abi, this.wallet);

    console.log('🚀 Limit Order Executor initialized');
    console.log(`   Contract: ${PERPDEX_CONTRACT_ADDRESS}`);
    console.log(`   Wallet: ${this.wallet.address}`);
    console.log(`   Indexer: ${INDEXER_GRAPHQL_URL}`);
  }

  /**
   * Fetch pending limit orders from indexer
   */
  private async fetchPendingLimitOrders(): Promise<Order[]> {
    const query = `query GetPendingLimitOrders {
      Order(
        where: {
          status: {_eq: 0},
          orderType: {_eq: 1}
        },
        order_by: {timestamp: asc},
        limit: 100
      ) {
        id
        orderId
        pairKey
        limitPrice
        direction
        status
        orderType
        expiryTime
      }
    }`;

    try {
      const response = await fetch(INDEXER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(HASURA_ADMIN_SECRET ? { 'x-hasura-admin-secret': HASURA_ADMIN_SECRET } : {}),
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Indexer query failed: ${response.statusText}`);
      }

      const result = await response.json() as { errors?: any[]; data?: { Order?: Order[] } };
      
      if (result.errors) {
        console.error('[LimitOrderExecutor] GraphQL errors:', result.errors);
        return [];
      }

      const orders: Order[] = result.data?.Order || [];
      return orders.filter(order => order.direction !== null); // Only orders with direction
    } catch (error: any) {
      console.error('[LimitOrderExecutor] Error fetching pending orders:', error.message || error);
      return [];
    }
  }

  /**
   * Get current price from contract for a pair
   */
  private async getCurrentPrice(pairKey: string): Promise<bigint | null> {
    try {
      // Try to get price from price oracle contract
      const priceOracleAddress = process.env.PRICE_ORACLE_CONTRACT_ADDRESS || PERPDEX_CONTRACT_ADDRESS;
      const priceOracleAbi = [
        'function getPrice(string memory pairKey) external view returns (uint256 price, uint256 timestamp, uint256 confidence)',
      ];
      const priceOracle = new ethers.Contract(priceOracleAddress, priceOracleAbi, this.provider);
      const [price] = await priceOracle.getPrice(pairKey);
      return price;
    } catch (error: any) {
      console.error(`[LimitOrderExecutor] Error getting price for ${pairKey}:`, error.message || error);
      return null;
    }
  }

  /**
   * Check if price condition is met for an order
   */
  private isPriceConditionMet(order: Order, currentPrice: bigint): boolean {
    if (!order.direction) {
      return false; // Can't check without direction
    }

    const limitPrice = BigInt(order.limitPrice);
    
    if (order.direction === 'long') {
      // Long: execute when current price <= limit price (buy at or below limit)
      return currentPrice <= limitPrice;
    } else if (order.direction === 'short') {
      // Short: execute when current price >= limit price (sell at or above limit)
      return currentPrice >= limitPrice;
    }

    return false;
  }

  /**
   * Execute a limit order
   */
  private async executeOrder(orderId: bigint): Promise<boolean> {
    try {
      console.log(`   🔄 Executing order ${orderId.toString()}...`);
      
      const tx = await this.contract.executeLimitOrder(orderId, {
        gasLimit: 500000, // Set gas limit to avoid estimation issues
      });
      
      const receipt = await tx.wait();
      
      if (receipt && receipt.status === 1) {
        console.log(`   ✅ Order ${orderId.toString()} executed successfully!`);
        return true;
      } else {
        console.error(`   ❌ Order ${orderId.toString()} execution failed (status: ${receipt?.status})`);
        return false;
      }
    } catch (error: any) {
      // Check for specific errors
      if (error.message?.includes('order not pending')) {
        console.log(`   ⏭️  Order ${orderId.toString()} is no longer pending (may have been executed or cancelled)`);
      } else if (error.message?.includes('price too stale')) {
        console.log(`   ⏭️  Order ${orderId.toString()} - price is too stale, skipping`);
      } else if (error.message?.includes('insufficient liquidity')) {
        console.log(`   ⏭️  Order ${orderId.toString()} - insufficient liquidity, skipping`);
      } else {
        console.error(`   ❌ Error executing order ${orderId.toString()}:`, error.message || error);
      }
      return false;
    }
  }

  /**
   * Process pending limit orders
   */
  private async processPendingOrders(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log(`\n[${new Date().toISOString()}] 🔍 Checking pending limit orders...`);

    try {
      // Fetch pending orders from indexer
      const orders = await this.fetchPendingLimitOrders();
      
      if (orders.length === 0) {
        console.log('   ℹ️  No pending limit orders found');
        return;
      }

      console.log(`   📋 Found ${orders.length} pending limit order(s) with direction`);

      // Group orders by pair to batch price fetches
      const ordersByPair = new Map<string, Order[]>();
      for (const order of orders) {
        if (!ordersByPair.has(order.pairKey)) {
          ordersByPair.set(order.pairKey, []);
        }
        ordersByPair.get(order.pairKey)!.push(order);
      }

      let executedCount = 0;
      let skippedCount = 0;

      // Process each pair
      for (const [pairKey, pairOrders] of ordersByPair.entries()) {
        console.log(`\n   📊 Processing ${pairOrders.length} order(s) for ${pairKey}...`);

        // Get current price for this pair
        const currentPrice = await this.getCurrentPrice(pairKey);
        if (!currentPrice) {
          console.log(`   ⚠️  Could not get current price for ${pairKey}, skipping`);
          skippedCount += pairOrders.length;
          continue;
        }

        const currentPriceFormatted = Number(currentPrice) / Number(PRICE_PRECISION);
        console.log(`   💰 Current price: $${currentPriceFormatted.toFixed(4)}`);

        // Check each order
        for (const order of pairOrders) {
          const limitPrice = BigInt(order.limitPrice);
          const limitPriceFormatted = Number(limitPrice) / Number(PRICE_PRECISION);
          const direction = order.direction || 'unknown';

          console.log(`   📋 Order ${order.orderId}: ${direction.toUpperCase()} @ $${limitPriceFormatted.toFixed(4)}`);

          // Check expiry
          const expiryTime = BigInt(order.expiryTime);
          if (expiryTime > 0 && BigInt(Math.floor(Date.now() / 1000)) >= expiryTime) {
            console.log(`   ⏭️  Order ${order.orderId} has expired, skipping`);
            skippedCount++;
            continue;
          }

          // Check price condition
          if (this.isPriceConditionMet(order, currentPrice)) {
            const orderId = BigInt(order.orderId);
            const executed = await this.executeOrder(orderId);
            if (executed) {
              executedCount++;
            } else {
              skippedCount++;
            }
          } else {
            const priceDiff = direction === 'long' 
              ? Number(currentPrice - limitPrice) / Number(PRICE_PRECISION)
              : Number(limitPrice - currentPrice) / Number(PRICE_PRECISION);
            console.log(`   ⏭️  Price condition not met (diff: $${priceDiff.toFixed(4)}), skipping`);
            skippedCount++;
          }
        }
      }

      console.log(`\n   ✅ Execution complete: ${executedCount} executed, ${skippedCount} skipped`);
    } catch (error: any) {
      console.error('[LimitOrderExecutor] Error processing orders:', error.message || error);
    }
  }

  /**
   * Start the executor service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Limit Order Executor is already running');
      return;
    }

    // Test RPC connection
    try {
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`✅ RPC connection OK (block: ${blockNumber})`);
    } catch (error: any) {
      throw new Error(`RPC connection failed: ${error.message || error}`);
    }

    // Test indexer connection
    try {
      const response = await fetch(INDEXER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(HASURA_ADMIN_SECRET ? { 'x-hasura-admin-secret': HASURA_ADMIN_SECRET } : {}),
        },
        body: JSON.stringify({ query: '{ __typename }' }),
      });
      if (!response.ok) {
        throw new Error(`Indexer connection failed: ${response.statusText}`);
      }
      console.log('✅ Indexer connection OK');
    } catch (error: any) {
      console.warn(`⚠️  Indexer connection failed: ${error.message || error}. Will continue but may not fetch orders.`);
    }

    this.isRunning = true;
    console.log(`\n🚀 Starting Limit Order Executor...`);
    console.log(`   Execution interval: ${EXECUTION_INTERVAL / 1000}s`);

    // Process immediately on start
    await this.processPendingOrders();

    // Then process on interval
    this.executionInterval = setInterval(() => {
      this.processPendingOrders();
    }, EXECUTION_INTERVAL);

    console.log('✅ Limit Order Executor started');
  }

  /**
   * Stop the executor service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }

    console.log('🛑 Limit Order Executor stopped');
  }
}

// Helper function to get current price (extracted for reuse)
async function getCurrentPrice(pairKey: string): Promise<bigint | null> {
  try {
    const priceOracleAddress = process.env.PRICE_ORACLE_CONTRACT_ADDRESS || PERPDEX_CONTRACT_ADDRESS;
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, {
      name: 'sepolia',
      chainId: 11155111,
    });
    const priceOracleAbi = [
      'function getPrice(string memory pairKey) external view returns (uint256 price, uint256 timestamp, uint256 confidence)',
    ];
    const priceOracle = new ethers.Contract(priceOracleAddress, priceOracleAbi, provider);
    const [price] = await priceOracle.getPrice(pairKey);
    return price;
  } catch (error: any) {
    console.error(`[getCurrentPrice] Error getting price for ${pairKey}:`, error.message || error);
    return null;
  }
}

// Main execution
if (require.main === module) {
  const executor = new LimitOrderExecutor();
  
  executor.start().catch((error) => {
    console.error('❌ Failed to start Limit Order Executor:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    executor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    executor.stop();
    process.exit(0);
  });
}

export default LimitOrderExecutor;

