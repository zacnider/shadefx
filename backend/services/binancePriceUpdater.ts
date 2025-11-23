/**
 * Binance API Price Updater Service
 * 
 * This service fetches prices from Binance API and updates the PerpDEX contract
 * Runs every 30 seconds to keep prices up to date
 * 
 * Uses forceUpdatePrice (owner-only) to bypass deviation checks
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Contract configuration
const PRICE_ORACLE_CONTRACT_ADDRESS = process.env.PRICE_ORACLE_CONTRACT_ADDRESS || process.env.PERPDEX_CONTRACT_ADDRESS || '0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93';
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Validate required environment variables
if (!SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL or RPC_URL is required in .env file');
}
if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY is required in .env file');
}

// Binance API
const BINANCE_API_BASE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=';

// Update interval (30 seconds)
const UPDATE_INTERVAL = parseInt(process.env.BINANCE_UPDATE_INTERVAL || '30000'); // 30 seconds default

// Known pairs to check (fallback if contract doesn't expose enumeration)
const KNOWN_PAIRS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'MATICUSD', 'LINKUSD', 'UNIUSD', 
  'ATOMUSD', 'ADAUSD', 'AVAXUSD', 'DOTUSD', 'BNBUSD', 'TRXUSD', 
  'XRPUSD', 'DOGEUSD'
];

// Mapping from pair key to Binance symbol
const PAIR_TO_BINANCE_SYMBOL: Record<string, string> = {
  'BTCUSD': 'BTCUSDT',
  'ETHUSD': 'ETHUSDT',
  'SOLUSD': 'SOLUSDT',
  'MATICUSD': 'MATICUSDT',
  'LINKUSD': 'LINKUSDT',
  'UNIUSD': 'UNIUSDT',
  'ATOMUSD': 'ATOMUSDT',
  'ADAUSD': 'ADAUSDT',
  'AVAXUSD': 'AVAXUSDT',
  'DOTUSD': 'DOTUSDT',
  'BNBUSD': 'BNBUSDT',
  'TRXUSD': 'TRXUSDT',
  'XRPUSD': 'XRPUSDT',
  'DOGEUSD': 'DOGEUSDT',
};

interface PairInfo {
  pairKey: string;
  binanceSymbol: string;
}

class BinancePriceUpdater {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private isRunning: boolean = false;
  private pairUpdateIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }

    // Create provider with better error handling and timeout
    this.provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, {
      name: 'sepolia',
      chainId: 11155111,
    });
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    
    // Load ABI from artifacts
    let abiPath = path.join(__dirname, '../../../artifacts/contracts/ShadeFXPriceOracle.sol/ShadeFXPriceOracle.json');
    let abi: any;
    try {
      const abiFile = fs.readFileSync(abiPath, 'utf8');
      abi = JSON.parse(abiFile).abi;
      console.log('✅ Loaded ShadeFXPriceOracle ABI');
    } catch (error) {
      // Fallback: minimal ABI for required functions
      abi = [
        'function getPairConfig(string memory) external view returns (tuple(string baseCurrency, string quoteCurrency, uint256 currentPrice, uint256 lastUpdateTime, uint256 minCollateral, uint256 maxCollateral, uint256 maxLeverage, uint256 feePercentage, bool isActive, uint256 maxOpenInterest, uint256 totalLongSize, uint256 totalShortSize, bytes32 pythPriceId, string coingeckoId))',
        'function getActivePairs() external view returns (string[] memory)',
        'function forceUpdatePrice(string memory pairKey, uint256 newPrice) external',
        'function owner() external view returns (address)'
      ];
      console.log('⚠️  Using minimal ABI (fallback)');
    }
    
    this.contract = new ethers.Contract(PRICE_ORACLE_CONTRACT_ADDRESS, abi, this.wallet);

    console.log('🚀 Binance Price Updater initialized');
    console.log(`   Contract: ${PRICE_ORACLE_CONTRACT_ADDRESS}`);
    console.log(`   Wallet: ${this.wallet.address}`);
    console.log(`   RPC URL: ${SEPOLIA_RPC_URL.replace(/\/v2\/[^\/]+/, '/v2/***')}`);
    console.log(`   Update interval: ${UPDATE_INTERVAL / 1000} seconds`);
  }

  /**
   * Fetch price from Binance API with retry mechanism
   */
  private async fetchBinancePrice(symbol: string, maxRetries: number = 3, retryDelay: number = 1000): Promise<number> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `${BINANCE_API_BASE_URL}${symbol}`;
        
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000), // 10 second timeout
          headers: {
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          // Rate limit handling
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * (attempt + 1) * 2;
            if (attempt < maxRetries) {
              console.warn(`   ⚠️  Rate limited (429) for ${symbol}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { symbol: string; price: string };
        const price = parseFloat(data.price);

        if (isNaN(price) || price <= 0) {
          throw new Error(`Invalid price received: ${data.price}`);
        }

        return price;
      } catch (error: any) {
        lastError = error;
        
        // Timeout or abort - retry
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          if (attempt < maxRetries) {
            console.warn(`   ⚠️  Timeout for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
            continue;
          }
          throw new Error(`Binance API timeout for ${symbol} after ${maxRetries + 1} attempts`);
        }
        
        // Network errors - retry
        if (error.message?.includes('fetch failed') || error.message?.includes('network') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
          if (attempt < maxRetries) {
            console.warn(`   ⚠️  Network error for ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
            continue;
          }
          throw new Error(`Network error for ${symbol}: ${error.message}`);
        }
        
        // Other errors - throw immediately
        if (attempt === maxRetries) {
          throw new Error(`Failed to fetch price from Binance for ${symbol}: ${error.message}`);
        }
      }
    }
    
    throw lastError || new Error(`Failed to fetch price from Binance for ${symbol} after ${maxRetries + 1} attempts`);
  }

  /**
   * Convert Binance price to contract format (scaled by 1e8)
   */
  private convertToContractPrice(price: number): bigint {
    // Contract uses PRICE_PRECISION = 1e8
    // So we multiply by 1e8 to get the scaled price
    return BigInt(Math.floor(price * 1e8));
  }

  /**
   * Get all active pairs from contract
   */
  private async getActivePairs(): Promise<PairInfo[]> {
    try {
      const pairs: PairInfo[] = [];
      
      // Try to use getActivePairs() from oracle contract
      try {
        const activePairKeys = await this.contract.getActivePairs();
        
        for (const pairKey of activePairKeys) {
          try {
            const pairConfig = await this.contract.getPairConfig(pairKey);
            
          // Check if pair is active
            const isActive = pairConfig.isActive;
            const hasBaseCurrency = pairConfig.baseCurrency && pairConfig.baseCurrency.length > 0;
            
            if (isActive && hasBaseCurrency) {
              const binanceSymbol = PAIR_TO_BINANCE_SYMBOL[pairKey];
              if (binanceSymbol) {
                pairs.push({
                  pairKey,
                  binanceSymbol,
                });
                
                console.log(`   ✅ Found pair: ${pairKey} (Binance: ${binanceSymbol})`);
              } else {
                console.warn(`   ⚠️  No Binance symbol mapping for ${pairKey}`);
              }
            }
          } catch (error: any) {
            // Pair config read failed, skip
            continue;
          }
        }
      } catch (error: any) {
        // getActivePairs() not available, fallback to known pairs check
        console.log('   ⚠️  getActivePairs() not available, using fallback method');
        
        // Fallback: Check each known pair
        for (const pairKey of KNOWN_PAIRS) {
          try {
            const pairConfig = await this.contract.getPairConfig(pairKey);
            
            // Check if pair exists (has baseCurrency) and is active
            const hasBaseCurrency = pairConfig.baseCurrency && pairConfig.baseCurrency.length > 0;
            const isActive = pairConfig.isActive;
            
            if (hasBaseCurrency && isActive) {
              const binanceSymbol = PAIR_TO_BINANCE_SYMBOL[pairKey];
              if (binanceSymbol) {
                pairs.push({
                  pairKey,
                  binanceSymbol,
                });
                
                console.log(`   ✅ Found pair: ${pairKey} (Binance: ${binanceSymbol})`);
              }
            }
          } catch (error2: any) {
            // Pair doesn't exist or error reading, skip silently
            continue;
          }
        }
      }

      console.log(`📊 Found ${pairs.length} active pairs`);
      
      if (pairs.length === 0) {
        console.log('⚠️  No active pairs found. Make sure:');
        console.log('   1. Pairs are added to contract');
        console.log('   2. Pairs are marked as active');
      }
      
      return pairs;
    } catch (error: any) {
      console.error('❌ Error getting active pairs:', error.message);
      return [];
    }
  }

  /**
   * Update price for a single pair
   */
  private async updatePairPrice(pair: PairInfo): Promise<void> {
    try {
      const pairKey = pair.pairKey;
      const binanceSymbol = pair.binanceSymbol;

      // Get current price from contract
      const pairConfig = await this.contract.getPairConfig(pairKey);
      const currentPrice = pairConfig.currentPrice;
      const currentPriceNumber = Number(currentPrice) / 1e8;
      const lastUpdateTime = Number(pairConfig.lastUpdateTime);
      
      // Check if price is stale (older than 5 minutes = 300 seconds)
      const now = Math.floor(Date.now() / 1000);
      const priceAge = lastUpdateTime > 0 ? now - lastUpdateTime : Infinity;
      const isStale = priceAge > 300; // 5 minutes
      const PRICE_STALENESS_THRESHOLD = 300; // 5 minutes in seconds

      // Fetch fresh price from Binance
      console.log(`📡 Fetching price from Binance API for ${pairKey} (${binanceSymbol})...`);
      const binancePrice = await this.fetchBinancePrice(binanceSymbol);

      // Convert to contract format
      const newPrice = this.convertToContractPrice(binancePrice);
      const newPriceNumber = Number(newPrice) / 1e8;

      console.log(`📈 ${pairKey}:`);
      console.log(`   Contract: $${currentPriceNumber.toFixed(4)} (${currentPrice})`);
      console.log(`   Last Update: ${lastUpdateTime > 0 ? new Date(lastUpdateTime * 1000).toISOString() : 'Never'}`);
      console.log(`   Price Age: ${Math.floor(priceAge / 60)} min ${priceAge % 60} sec`);
      console.log(`   Is Stale (>5min): ${isStale ? 'YES ⚠️' : 'NO ✅'}`);
      console.log(`   Binance:  $${binancePrice.toFixed(4)}`);
      console.log(`   New:      $${newPriceNumber.toFixed(4)} (${newPrice})`);

      // Check if price changed significantly (avoid unnecessary transactions)
      // BUT: Always update if price is stale (older than 5 minutes)
      const priceDiff = Math.abs(newPriceNumber - currentPriceNumber);
      const priceTolerance = currentPriceNumber * 0.0001; // 0.01% tolerance

      if (!isStale && priceDiff <= priceTolerance && priceDiff > 0) {
        console.log(`   ⏭️  Skipping ${pairKey} - price difference too small (diff: $${priceDiff.toFixed(4)})`);
        return;
      }
      
      if (isStale) {
        console.log(`   🔄 Price is stale, forcing update regardless of price difference`);
      }

      // Update price using forceUpdatePrice (owner-only, no deviation check)
      console.log(`   ⏳ Updating price for ${pairKey}...`);
      
      // Get current gas price and add 20% buffer
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      if (!gasPrice) {
        throw new Error('Could not get gas price');
      }
      const gasPriceWithBuffer = (gasPrice * 120n) / 100n; // 20% buffer

      const tx = await this.contract.forceUpdatePrice(pairKey, newPrice, {
        gasPrice: gasPriceWithBuffer,
      });

      console.log(`   ⏳ Transaction: ${tx.hash}`);
      
      // Wait for transaction with timeout
      const receipt = await Promise.race([
        tx.wait(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), 60000)
        )
      ]);

      console.log(`   ✅ Updated! Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed}`);

    } catch (error: any) {
      const errorMessage = error.message || error.toString() || 'Unknown error';
      console.error(`❌ Error updating ${pair.pairKey}: ${errorMessage}`);
      
      // Log more details for debugging
      if (error.reason) {
        console.error(`   Reason: ${error.reason}`);
      }
      if (error.data) {
        console.error(`   Data: ${error.data}`);
      }
      if (error.code) {
        console.error(`   Code: ${error.code}`);
      }
    }
  }

  /**
   * Start the price updater service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Service is already running');
      return;
    }

    console.log('🚀 Starting Binance Price Updater...');
    
    // Test RPC connection first
    try {
      console.log('📡 Testing RPC connection...');
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`✅ RPC connection successful! Latest block: ${blockNumber}`);
    } catch (error: any) {
      console.error('❌ RPC connection failed:', error.message);
      console.error('   Please check your RPC URL in .env file');
      throw new Error(`RPC connection failed: ${error.message}`);
    }

    // Check if wallet is owner
    try {
      const owner = await this.contract.owner();
      if (owner.toLowerCase() === this.wallet.address.toLowerCase()) {
        console.log('✅ Wallet is contract owner - can use forceUpdatePrice');
      } else {
        console.error(`❌ Wallet is not contract owner (owner: ${owner})`);
        console.error('   forceUpdatePrice requires owner privileges');
        throw new Error('Wallet is not contract owner');
      }
    } catch (error: any) {
      if (error.message.includes('not contract owner')) {
        throw error;
      }
      console.error('❌ Error checking owner:', error.message);
      throw new Error(`Failed to check owner: ${error.message}`);
    }

    this.isRunning = true;

    // Get all active pairs
    const pairs = await this.getActivePairs();

    if (pairs.length === 0) {
      console.log('⚠️  No active pairs found. Service will not start.');
      this.isRunning = false;
      return;
    }

    console.log(`📊 Starting price updates for ${pairs.length} pairs`);
    console.log(`   Update interval: ${UPDATE_INTERVAL / 1000} seconds per pair`);
    console.log(`   Staggered updates: Each pair updates every ${UPDATE_INTERVAL / 1000}s with ${Math.floor(UPDATE_INTERVAL / pairs.length / 1000)}s stagger\n`);

    // Start staggered updates for each pair
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const delay = i * (UPDATE_INTERVAL / pairs.length); // Staggered start

      setTimeout(() => {
        // Initial update
        this.updatePairPrice(pair).catch(console.error);

        // Set up interval for this pair
        const interval = setInterval(async () => {
          if (!this.isRunning) {
            clearInterval(interval);
            return;
          }
          await this.updatePairPrice(pair);
        }, UPDATE_INTERVAL);

        this.pairUpdateIntervals.set(pair.pairKey, interval);
      }, delay);
    }

    console.log('✅ Binance Price Updater started successfully');
  }

  /**
   * Stop the price updater service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️  Service is not running');
      return;
    }

    console.log('🛑 Stopping Binance Price Updater...');
    this.isRunning = false;

    // Clear all intervals
    this.pairUpdateIntervals.forEach(interval => clearInterval(interval));
    this.pairUpdateIntervals.clear();

    console.log('✅ Binance Price Updater stopped');
  }
}

// Main execution
const updater = new BinancePriceUpdater();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await updater.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await updater.stop();
  process.exit(0);
});

// Start the service
updater.start().catch((error) => {
  console.error('❌ Failed to start Binance Price Updater:', error);
  process.exit(1);
});

