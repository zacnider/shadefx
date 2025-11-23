/**
 * Pyth Network Price Updater Service
 * 
 * This service fetches prices from Pyth Network API and updates the PerpDEX contract
 * Runs every 10-30 seconds to keep prices up to date
 * 
 * Gas costs are covered by the backend wallet
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Contract configuration
// Note: After contract splitting, use PRICE_ORACLE_CONTRACT_ADDRESS instead of PERPDEX_CONTRACT_ADDRESS
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

// Pyth Network API (Hermes API for Sepolia)
const PYTH_HERMES_API = 'https://hermes.pyth.network/v2/updates/price/latest';
const PYTH_HERMES_PRICE_API = 'https://hermes.pyth.network/v2/price/latest'; // JSON format for fresh prices

// Update interval (30 seconds)
const UPDATE_INTERVAL = parseInt(process.env.PYTH_UPDATE_INTERVAL || '30000'); // 30 seconds default (balance between freshness and gas costs)

// Known pairs to check (fallback if contract doesn't expose enumeration)
// Backend will automatically discover pairs from contract, but this list helps for initial discovery
// Only accurate pairs (verified against Binance API) are included
const KNOWN_PAIRS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'AVAXUSD' // Only accurate pairs (Pyth vs Binance difference < 5%)
];

interface PairInfo {
  pairKey: string;
  pythPriceId: string;
  publishTime?: number;
}

class PythPriceUpdater {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private isRunning: boolean = false;
  private pairIntervals: Map<string, NodeJS.Timeout> = new Map(); // Each pair has its own interval

  constructor() {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }

    this.provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    
    // Load ABI from artifacts (try PriceOracle first, fallback to PerpDEX for backward compatibility)
    let abiPath = path.join(__dirname, '../../../artifacts/contracts/ShadeFXPriceOracle.sol/ShadeFXPriceOracle.json');
    let abi: any;
    try {
      const abiFile = fs.readFileSync(abiPath, 'utf8');
      abi = JSON.parse(abiFile).abi;
      console.log('✅ Loaded ShadeFXPriceOracle ABI');
    } catch (error) {
      // Fallback: try PerpDEX ABI (for backward compatibility)
      abiPath = path.join(__dirname, '../../../artifacts/contracts/ShadeFXPerpDEX.sol/ShadeFXPerpDEX.json');
      try {
        const abiFile = fs.readFileSync(abiPath, 'utf8');
        abi = JSON.parse(abiFile).abi;
        console.log('⚠️  Loaded ShadeFXPerpDEX ABI (fallback - consider using PriceOracle)');
      } catch (error2) {
        // Final fallback: minimal ABI for required functions
        abi = [
          'function getPairConfig(string memory) external view returns (tuple(string baseCurrency, string quoteCurrency, uint256 currentPrice, uint256 lastUpdateTime, uint256 minCollateral, uint256 maxCollateral, uint256 maxLeverage, uint256 feePercentage, bool isActive, uint256 maxOpenInterest, uint256 totalLongSize, uint256 totalShortSize, bytes32 pythPriceId, string coingeckoId))',
          'function getActivePairs() external view returns (string[] memory)',
          'function updatePriceFromPythWithData(string[] memory pairKeys, bytes[] calldata updateData, bytes32[] calldata priceIds, uint64[] calldata publishTimes) external payable',
          'function forceUpdatePrice(string memory pairKey, uint256 newPrice) external',
          'function pythOracle() external view returns (address)',
          'function owner() external view returns (address)'
        ];
        console.log('⚠️  Using minimal ABI (fallback)');
      }
    }
    
    this.contract = new ethers.Contract(PRICE_ORACLE_CONTRACT_ADDRESS, abi, this.wallet);

    console.log('🚀 Pyth Price Updater initialized');
    console.log(`   Contract: ${PRICE_ORACLE_CONTRACT_ADDRESS}`);
    console.log(`   Wallet: ${this.wallet.address}`);
    console.log(`   Update interval: ${UPDATE_INTERVAL / 1000} seconds`);
    
    // Check if wallet is owner
    this.contract.owner().then((owner: string) => {
      if (owner.toLowerCase() === this.wallet.address.toLowerCase()) {
        console.log('✅ Wallet is contract owner - will use forceUpdatePrice');
      } else {
        console.log(`⚠️  Wallet is not contract owner (owner: ${owner}) - will use updatePriceFromPythWithData`);
      }
    }).catch(() => {
      console.log('⚠️  Could not check owner - will try both methods');
    });
  }

  /**
   * Fetch updateData from Pyth Hermes API
   */
  private async fetchPythUpdateData(priceIds: string[]): Promise<{ updateData: string[]; publishTimes: number[] }> {
    try {
      // Build query string with price IDs
      const queryParams = priceIds.map(id => `ids[]=${id}`).join('&');
      const url = `${PYTH_HERMES_API}?${queryParams}`;

      console.log(`📡 Fetching updateData from Pyth Hermes API for ${priceIds.length} price feeds...`);

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.status} ${response.statusText}`);
      }

      // Pyth Hermes API returns binary data
      // Response format: binary array (base64 encoded bytes[])
      // Read response as arrayBuffer first (binary data)
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Pyth Hermes API returns binary data directly, not JSON
      // Convert to hex string for contract call
      const updateDataHex = '0x' + buffer.toString('hex');
      let updateData: string[] = [updateDataHex]; // Single updateData for all price feeds
      
      // Extract publish times from parsed data if available
      let publishTimes: number[] = [];
      
      // Try to parse as JSON to get publish times (if available)
      try {
        const text = buffer.toString('utf-8');
        const jsonMatch = text.match(/"parsed":\[.*?\]/);
        if (jsonMatch) {
          const parsedData = JSON.parse('{' + jsonMatch[0] + '}');
          if (parsedData.parsed && Array.isArray(parsedData.parsed)) {
            publishTimes = parsedData.parsed.map((item: any) => {
              if (item.price?.publish_time) {
                return parseInt(item.price.publish_time);
              }
              return Math.floor(Date.now() / 1000);
            });
          }
        }
      } catch (e) {
        // If parsing fails, use current time for all
        console.log('   ⚠️  Could not extract publish times from response, using current time');
      }
      
      // If publish times not extracted, use current time for all
      if (publishTimes.length === 0) {
        publishTimes = priceIds.map(() => Math.floor(Date.now() / 1000));
      }
      
      // If publish times not extracted, use current time
      if (publishTimes.length === 0) {
        publishTimes = priceIds.map(() => Math.floor(Date.now() / 1000));
      }
      
      // Ensure arrays match length
      if (updateData.length !== priceIds.length) {
        console.warn(`⚠️  UpdateData length (${updateData.length}) doesn't match priceIds length (${priceIds.length})`);
        // If single updateData for multiple priceIds, duplicate it
        if (updateData.length === 1 && priceIds.length > 1) {
          updateData = priceIds.map(() => updateData[0]);
        }
      }

      console.log(`✅ Fetched ${updateData.length} update data entries`);

      return { updateData, publishTimes };
    } catch (error: any) {
      console.error('❌ Error fetching Pyth updateData:', error.message);
      throw error;
    }
  }

  /**
   * Get all active pairs from contract with Pyth price feeds
   * Uses oracle contract's getActivePairs() function (after contract splitting)
   */
  private async getActivePairs(): Promise<PairInfo[]> {
    try {
      const pairs: PairInfo[] = [];
      
      // Try to use getActivePairs() from oracle contract (new approach after splitting)
      try {
        const activePairKeys = await this.contract.getActivePairs();
        
        for (const pairKey of activePairKeys) {
          try {
            const pairConfig = await this.contract.getPairConfig(pairKey);
            
            // Check if pair is active and has Pyth price ID
            const isActive = pairConfig.isActive;
            const hasPythPriceId = pairConfig.pythPriceId && pairConfig.pythPriceId !== ethers.ZeroHash;
            
            if (isActive && hasPythPriceId) {
              // Convert bytes32 to hex string
              const pythPriceIdHex = ethers.hexlify(pairConfig.pythPriceId);
              
              pairs.push({
                pairKey,
                pythPriceId: pythPriceIdHex,
              });
              
              console.log(`   ✅ Found pair: ${pairKey} (Pyth ID: ${pythPriceIdHex})`);
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
            const hasPythPriceId = pairConfig.pythPriceId && pairConfig.pythPriceId !== ethers.ZeroHash;
            
            if (hasBaseCurrency && isActive && hasPythPriceId) {
              // Convert bytes32 to hex string
              const pythPriceIdHex = ethers.hexlify(pairConfig.pythPriceId);
              
              pairs.push({
                pairKey,
                pythPriceId: pythPriceIdHex,
              });
              
              console.log(`   ✅ Found pair: ${pairKey} (Pyth ID: ${pythPriceIdHex})`);
            }
          } catch (error2: any) {
            // Pair doesn't exist or error reading, skip silently
            continue;
          }
        }
      }

      console.log(`📊 Found ${pairs.length} active pairs with Pyth price feeds`);
      
      if (pairs.length === 0) {
        console.log('⚠️  No pairs found with Pyth price feeds. Make sure:');
        console.log('   1. Pairs are added to contract with addPairWithPyth()');
        console.log('   2. Pairs are marked as active');
        console.log('   3. Pyth price IDs are set correctly');
      }
      
      return pairs;
    } catch (error: any) {
      console.error('❌ Error getting active pairs:', error.message);
      return [];
    }
  }

  /**
   * Update prices for all active pairs
   */
  async updateAllPrices(): Promise<{ success: boolean; updated: number; error?: string }> {
    try {
      const pairs = await this.getActivePairs();
      
      if (pairs.length === 0) {
        console.log('⏭️  No active pairs to update');
        return { success: true, updated: 0 };
      }

      // Update pairs one by one to avoid failing all if one has high deviation
      let successCount = 0;
      let failCount = 0;

      // Check if wallet is owner
      let isOwner = false;
      try {
        const owner = await this.contract.owner();
        isOwner = owner.toLowerCase() === this.wallet.address.toLowerCase();
      } catch {
        // If owner() doesn't exist, assume not owner
      }

      for (const pair of pairs) {
        try {
          // Extract price ID for this pair
          const priceId = pair.pythPriceId;
          
          // Get current pair config to get current price
          const pairConfig = await this.contract.getPairConfig(pair.pairKey);
          const currentPrice = pairConfig.currentPrice;
          
          // Get Pyth oracle address
          const pythOracleAddress = await this.contract.pythOracle();
          const pythAbi = [
            'function getPriceUnsafe(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
            'function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime) price, bool isValid)'
          ];
          const pythContract = new ethers.Contract(pythOracleAddress, pythAbi, this.provider);
          
          // Convert priceId to bytes32 for Pyth contract
          const priceIdBytes32 = priceId.startsWith('0x') ? priceId : '0x' + priceId;
          
          // First, update Pyth price feeds to get fresh data
          // Fetch updateData from Hermes API and update contract
          try {
            const { updateData, publishTimes } = await this.fetchPythUpdateData([priceId]);
            
            if (updateData.length > 0) {
              // Get update fee
              const pythFeeAbi = [
                'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
                'function updatePriceFeedsIfNecessary(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64[] calldata publishTimes) external payable'
              ];
              const pythFeeContract = new ethers.Contract(pythOracleAddress, pythFeeAbi, this.wallet);
              const updateFee = await pythFeeContract.getUpdateFee(updateData);
              
              // Update price feeds (this makes getPriceUnsafe return fresh data)
              const cleanId = priceId.startsWith('0x') ? priceId.slice(2) : priceId;
              const priceIdsBytes32 = ['0x' + cleanId.padStart(64, '0').slice(0, 64)];
              const publishTimesUint64 = [BigInt(publishTimes[0] || Math.floor(Date.now() / 1000))];
              
              const updateTx = await pythFeeContract.updatePriceFeedsIfNecessary(
                updateData,
                priceIdsBytes32,
                publishTimesUint64,
                { value: updateFee }
              );
              await updateTx.wait();
              console.log(`   ✅ Updated Pyth price feed for ${pair.pairKey}`);
            }
          } catch (updateError: any) {
            console.warn(`   ⚠️  Could not update Pyth feed for ${pair.pairKey}: ${updateError.message}`);
            // Continue with potentially stale price
          }
          
          // Get current price from Pyth (now fresh after updatePriceFeedsIfNecessary)
          const pythPrice = await pythContract.getPriceUnsafe(priceIdBytes32);
          
          // Extract price data
          const pythPriceValue = Number(pythPrice.price);
          const pythExpo = Number(pythPrice.expo);
          const pythPublishTime = Number(pythPrice.publishTime);
          const pythConf = Number(pythPrice.conf);
          
          // Check if price is stale (older than 60 seconds)
          const currentTime = Math.floor(Date.now() / 1000);
          const priceAge = currentTime - pythPublishTime;
          
          console.log(`🔍 ${pair.pairKey} Pyth data: price=${pythPriceValue}, expo=${pythExpo}, conf=${pythConf}, publishTime=${pythPublishTime}, age=${priceAge}s`);
          
          if (priceAge > 60) {
            console.warn(`   ⚠️  Price is stale (${priceAge}s old) - but will still update`);
          }
          
          // Convert Pyth price to our format (same logic as PythPriceConverter)
          // Real price = price * 10^expo
          // Contract format = real_price * 10^8 = price * 10^(expo + 8)
          let newPrice: bigint;
          const exponentDiff = 8 + pythExpo;
          
          if (exponentDiff > 0) {
            const multiplier = 10n ** BigInt(exponentDiff);
            newPrice = BigInt(pythPriceValue) * multiplier;
          } else if (exponentDiff < 0) {
            const divisor = 10n ** BigInt(-exponentDiff);
            newPrice = BigInt(pythPriceValue) / divisor;
          } else {
            newPrice = BigInt(pythPriceValue);
          }
          
          const newPriceNumber = Number(newPrice);
          const currentPriceNumber = Number(currentPrice);
          const currentPriceFormatted = currentPriceNumber / 1e8;
          const newPriceFormatted = newPriceNumber / 1e8;
          
          // Calculate real price from Pyth for comparison
          const realPythPrice = pythPriceValue * Math.pow(10, pythExpo);
          
          console.log(`📈 ${pair.pairKey}:`);
          console.log(`   Contract: $${currentPriceFormatted.toFixed(2)} (${currentPriceNumber})`);
          console.log(`   Pyth real: $${realPythPrice.toFixed(2)}`);
          console.log(`   Pyth converted: $${newPriceFormatted.toFixed(2)} (${newPriceNumber})`);
          console.log(`   Diff: $${Math.abs(newPriceFormatted - currentPriceFormatted).toFixed(2)} (${((Math.abs(newPriceFormatted - currentPriceFormatted) / currentPriceFormatted) * 100).toFixed(4)}%)`);

          // Always update if price is different (even by 0.01% - crypto prices change constantly)
          const priceDiff = Math.abs(newPriceNumber - currentPriceNumber);
          const priceTolerance = currentPriceNumber * 0.0001; // 0.01% tolerance for rounding errors only
          
          if (priceDiff <= priceTolerance && priceDiff > 0) {
            console.log(`   ⏭️  Skipping ${pair.pairKey} - price difference too small (diff: $${(priceDiff / 1e8).toFixed(4)})`);
            successCount++; // Count as success since price is already up to date
            continue;
          }

          // Use forceUpdatePrice if owner, otherwise use updatePriceFromPythWithData
          if (isOwner) {
            // Use forceUpdatePrice - no deviation check, no Pyth fee needed
            try {
              // Get current gas price with 20% buffer to avoid "replacement fee too low" errors
              const feeData = await this.provider.getFeeData();
              const gasPrice = feeData.gasPrice ? (feeData.gasPrice * BigInt(120)) / BigInt(100) : undefined;
              
              const tx = await this.contract.forceUpdatePrice(pair.pairKey, newPrice, {
                gasPrice: gasPrice
              });
              
              // Wait for transaction with timeout
              const receipt = await Promise.race([
                tx.wait(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
              ]) as ethers.ContractTransactionReceipt;
              
              if (receipt && receipt.status === 1) {
                // Verify price was actually updated
                const updatedPairConfig = await this.contract.getPairConfig(pair.pairKey);
                const updatedPrice = Number(updatedPairConfig.currentPrice) / 1e8;
                console.log(`✅ Force updated ${pair.pairKey} (gas: ${receipt.gasUsed.toString()}, tx: ${tx.hash}, new price: $${updatedPrice.toFixed(2)})`);
                successCount++;
              } else {
                console.error(`❌ Transaction failed for ${pair.pairKey} (tx: ${tx.hash})`);
                failCount++;
              }
              
              // Wait a bit between transactions to avoid nonce conflicts
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (txError: any) {
              console.error(`❌ Force update failed for ${pair.pairKey}:`, txError.message);
              if (txError.code === 'REPLACEMENT_UNDERPRICED') {
                console.error(`   ⚠️  Gas price too low - will retry with higher price on next cycle`);
              }
              failCount++;
              // Wait even on error to avoid rapid-fire failures
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } else {
            // Fallback to updatePriceFromPythWithData (original method)
            const { updateData, publishTimes } = await this.fetchPythUpdateData([priceId]);

            if (updateData.length === 0) {
              console.log(`⚠️  No updateData received for ${pair.pairKey}`);
              failCount++;
              continue;
            }

            // Get Pyth oracle address
            const pythOracleAddress = await this.contract.pythOracle();
            
            // Get update fee
            const pythFeeAbi = [
              'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
              'function updatePriceFeedsIfNecessary(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64[] calldata publishTimes) external payable'
            ];
            const pythFeeContract = new ethers.Contract(pythOracleAddress, pythFeeAbi, this.wallet);
            const updateFee = await pythFeeContract.getUpdateFee(updateData);

            // Prepare arrays for contract call (single pair)
            const pairKeys = [pair.pairKey];
            const cleanId = priceId.startsWith('0x') ? priceId.slice(2) : priceId;
            const priceIdsBytes32 = ['0x' + cleanId.padStart(64, '0').slice(0, 64)];
            const publishTimesUint64 = [BigInt(publishTimes[0] || Math.floor(Date.now() / 1000))];

            // Estimate gas
            let gasEstimate;
            try {
              gasEstimate = await this.contract.updatePriceFromPythWithData.estimateGas(
                pairKeys,
                updateData,
                priceIdsBytes32,
                publishTimesUint64,
                { value: updateFee }
              );
            } catch (gasError: any) {
              console.error(`❌ Gas estimation failed for ${pair.pairKey}:`, gasError.message);
              failCount++;
              continue;
            }

            // Send transaction
            try {
              // Get current gas price with 20% buffer
              const feeData = await this.provider.getFeeData();
              const gasPrice = feeData.gasPrice ? (feeData.gasPrice * BigInt(120)) / BigInt(100) : undefined;
              
              const tx = await this.contract.updatePriceFromPythWithData(
                pairKeys,
                updateData,
                priceIdsBytes32,
                publishTimesUint64,
                {
                  value: updateFee,
                  gasLimit: gasEstimate * BigInt(120) / BigInt(100), // 20% buffer
                  gasPrice: gasPrice
                }
              );

              // Wait for transaction with timeout
              const receipt = await Promise.race([
                tx.wait(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
              ]) as ethers.ContractTransactionReceipt;

              if (receipt && receipt.status === 1) {
                console.log(`✅ Updated ${pair.pairKey} (gas: ${receipt.gasUsed.toString()})`);
                successCount++;
              } else {
                console.error(`❌ Transaction failed for ${pair.pairKey}`);
                failCount++;
              }
              
              // Wait a bit between transactions to avoid nonce conflicts
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (txError: any) {
              console.error(`❌ Transaction failed for ${pair.pairKey}:`, txError.message);
              if (txError.code === 'REPLACEMENT_UNDERPRICED') {
                console.error(`   ⚠️  Gas price too low - will retry with higher price on next cycle`);
              }
              failCount++;
              // Wait even on error to avoid rapid-fire failures
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } catch (error: any) {
          console.error(`❌ Error updating ${pair.pairKey}:`, error.message);
          failCount++;
        }
      }

      console.log(`📊 Update summary: ${successCount} succeeded, ${failCount} failed`);
      
      return { 
        success: successCount > 0, 
        updated: successCount,
        error: failCount > 0 ? `${failCount} pairs failed` : undefined
      };
    } catch (error: any) {
      console.error('❌ Error updating prices:', error.message);
      if (error.reason) {
        console.error(`   Reason: ${error.reason}`);
      }
      if (error.data) {
        console.error(`   Data: ${error.data}`);
      }
      if (error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
      return { success: false, updated: 0, error: error.message };
    }
  }

  /**
   * Update a single pair's price
   */
  private async updateSinglePair(pair: PairInfo): Promise<void> {
    try {
      // Extract price ID for this pair
      const priceId = pair.pythPriceId;
      
      // Get current pair config to get current price
      const pairConfig = await this.contract.getPairConfig(pair.pairKey);
      const currentPrice = pairConfig.currentPrice;
      
      // Get Pyth oracle address
      const pythOracleAddress = await this.contract.pythOracle();
      const pythAbi = [
        'function getPriceUnsafe(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
        'function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime) price, bool isValid)'
      ];
      const pythContract = new ethers.Contract(pythOracleAddress, pythAbi, this.provider);
      
      // Convert priceId to bytes32 for Pyth contract
      const priceIdBytes32 = priceId.startsWith('0x') ? priceId : '0x' + priceId;
          
      // First, update Pyth price feeds to get fresh data
      // Fetch updateData from Hermes API and update contract
      try {
        const { updateData, publishTimes } = await this.fetchPythUpdateData([priceId]);
        
        if (updateData.length > 0) {
          // Get update fee
          const pythFeeAbi = [
            'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
            'function updatePriceFeedsIfNecessary(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64[] calldata publishTimes) external payable'
          ];
          const pythFeeContract = new ethers.Contract(pythOracleAddress, pythFeeAbi, this.wallet);
          const updateFee = await pythFeeContract.getUpdateFee(updateData);
          
          // Update price feeds (this makes getPriceUnsafe return fresh data)
          const cleanId = priceId.startsWith('0x') ? priceId.slice(2) : priceId;
          const priceIdsBytes32 = ['0x' + cleanId.padStart(64, '0').slice(0, 64)];
          const publishTimesUint64 = [BigInt(publishTimes[0] || Math.floor(Date.now() / 1000))];
          
          const updateTx = await pythFeeContract.updatePriceFeedsIfNecessary(
            updateData,
            priceIdsBytes32,
            publishTimesUint64,
            { value: updateFee }
          );
          await updateTx.wait();
          console.log(`   ✅ Updated Pyth price feed for ${pair.pairKey}`);
        }
      } catch (updateError: any) {
        console.warn(`   ⚠️  Could not update Pyth feed for ${pair.pairKey}: ${updateError.message}`);
        // Continue with potentially stale price
      }
      
      // Get current price from Pyth (now fresh after updatePriceFeedsIfNecessary)
      const pythPrice = await pythContract.getPriceUnsafe(priceIdBytes32);
      
      // Extract price data
      const pythPriceValue = Number(pythPrice.price);
      const pythExpo = Number(pythPrice.expo);
      const pythPublishTime = Number(pythPrice.publishTime);
      const pythConf = Number(pythPrice.conf);
      
      // Check if price is stale (older than 60 seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      const priceAge = currentTime - pythPublishTime;
      
      console.log(`🔍 ${pair.pairKey} Pyth data: price=${pythPriceValue}, expo=${pythExpo}, conf=${pythConf}, publishTime=${pythPublishTime}, age=${priceAge}s`);
      
      if (priceAge > 60) {
        console.warn(`   ⚠️  Price is stale (${priceAge}s old) - but will still update`);
      }
      
      // Convert Pyth price to our format (same logic as PythPriceConverter)
      // Real price = price * 10^expo
      // Contract format = real_price * 10^8 = price * 10^(expo + 8)
      let newPrice: bigint;
      const exponentDiff = 8 + pythExpo;
      
      if (exponentDiff > 0) {
        const multiplier = 10n ** BigInt(exponentDiff);
        newPrice = BigInt(pythPriceValue) * multiplier;
      } else if (exponentDiff < 0) {
        const divisor = 10n ** BigInt(-exponentDiff);
        newPrice = BigInt(pythPriceValue) / divisor;
      } else {
        newPrice = BigInt(pythPriceValue);
      }
      
      const newPriceNumber = Number(newPrice);
      const currentPriceNumber = Number(currentPrice);
      const currentPriceFormatted = currentPriceNumber / 1e8;
      const newPriceFormatted = newPriceNumber / 1e8;
      
      // Calculate real price from Pyth for comparison
      const realPythPrice = pythPriceValue * Math.pow(10, pythExpo);
      
      console.log(`📈 ${pair.pairKey}:`);
      console.log(`   Contract: $${currentPriceFormatted.toFixed(2)} (${currentPriceNumber})`);
      console.log(`   Pyth real: $${realPythPrice.toFixed(2)}`);
      console.log(`   Pyth converted: $${newPriceFormatted.toFixed(2)} (${newPriceNumber})`);
      console.log(`   Diff: $${Math.abs(newPriceFormatted - currentPriceFormatted).toFixed(2)} (${((Math.abs(newPriceFormatted - currentPriceFormatted) / currentPriceFormatted) * 100).toFixed(4)}%)`);

      // Always update if price is different (even by 0.01% - crypto prices change constantly)
      const priceDiff = Math.abs(newPriceNumber - currentPriceNumber);
      const priceTolerance = currentPriceNumber * 0.0001; // 0.01% tolerance for rounding errors only
      
      if (priceDiff <= priceTolerance && priceDiff > 0) {
        console.log(`   ⏭️  Skipping ${pair.pairKey} - price difference too small (diff: $${(priceDiff / 1e8).toFixed(4)})`);
        return;
      }

      // Check if wallet is owner
      let isOwner = false;
      try {
        const owner = await this.contract.owner();
        isOwner = owner.toLowerCase() === this.wallet.address.toLowerCase();
      } catch {
        // If owner() doesn't exist, assume not owner
      }

      // Use forceUpdatePrice if owner, otherwise use updatePriceFromPythWithData
      if (isOwner) {
        // Use forceUpdatePrice - no deviation check, no Pyth fee needed
        try {
          // Get current gas price with 20% buffer to avoid "replacement fee too low" errors
          const feeData = await this.provider.getFeeData();
          const gasPrice = feeData.gasPrice ? (feeData.gasPrice * BigInt(120)) / BigInt(100) : undefined;
          
          const tx = await this.contract.forceUpdatePrice(pair.pairKey, newPrice, {
            gasPrice: gasPrice
          });
          
          // Wait for transaction with timeout
          const receipt = await Promise.race([
            tx.wait(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
          ]) as ethers.ContractTransactionReceipt;
          
          if (receipt && receipt.status === 1) {
            // Verify price was actually updated
            const updatedPairConfig = await this.contract.getPairConfig(pair.pairKey);
            const updatedPrice = Number(updatedPairConfig.currentPrice) / 1e8;
            console.log(`✅ Force updated ${pair.pairKey} (gas: ${receipt.gasUsed.toString()}, tx: ${tx.hash}, new price: $${updatedPrice.toFixed(2)})`);
          } else {
            console.error(`❌ Transaction failed for ${pair.pairKey} (tx: ${tx.hash})`);
          }
        } catch (txError: any) {
          console.error(`❌ Force update failed for ${pair.pairKey}:`, txError.message);
          if (txError.code === 'REPLACEMENT_UNDERPRICED') {
            console.error(`   ⚠️  Gas price too low - will retry with higher price on next cycle`);
          }
        }
      } else {
        // Fallback to updatePriceFromPythWithData (original method)
        const { updateData, publishTimes } = await this.fetchPythUpdateData([priceId]);

        if (updateData.length === 0) {
          console.log(`⚠️  No updateData received for ${pair.pairKey}`);
          return;
        }

        // Get Pyth oracle address
        const pythOracleAddress = await this.contract.pythOracle();
        
        // Get update fee
        const pythFeeAbi = [
          'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
          'function updatePriceFeedsIfNecessary(bytes[] calldata updateData, bytes32[] calldata priceIds, uint64[] calldata publishTimes) external payable'
        ];
        const pythFeeContract = new ethers.Contract(pythOracleAddress, pythFeeAbi, this.wallet);
        const updateFee = await pythFeeContract.getUpdateFee(updateData);

        // Prepare arrays for contract call (single pair)
        const pairKeys = [pair.pairKey];
        const cleanId = priceId.startsWith('0x') ? priceId.slice(2) : priceId;
        const priceIdsBytes32 = ['0x' + cleanId.padStart(64, '0').slice(0, 64)];
        const publishTimesUint64 = [BigInt(publishTimes[0] || Math.floor(Date.now() / 1000))];

        // Estimate gas
        let gasEstimate;
        try {
          gasEstimate = await this.contract.updatePriceFromPythWithData.estimateGas(
            pairKeys,
            updateData,
            priceIdsBytes32,
            publishTimesUint64,
            { value: updateFee }
          );
        } catch (gasError: any) {
          console.error(`❌ Gas estimation failed for ${pair.pairKey}:`, gasError.message);
          return;
        }

        // Get current gas price with 20% buffer
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice ? (feeData.gasPrice * BigInt(120)) / BigInt(100) : undefined;

        const tx = await this.contract.updatePriceFromPythWithData(
          pairKeys,
          updateData,
          priceIdsBytes32,
          publishTimesUint64,
          {
            value: updateFee,
            gasLimit: gasEstimate * BigInt(120) / BigInt(100), // 20% buffer
            gasPrice: gasPrice
          }
        );

        // Wait for transaction with timeout
        const receipt = await Promise.race([
          tx.wait(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
        ]) as ethers.ContractTransactionReceipt;

        if (receipt && receipt.status === 1) {
          console.log(`✅ Updated ${pair.pairKey} (gas: ${receipt.gasUsed.toString()})`);
        } else {
          console.error(`❌ Transaction failed for ${pair.pairKey}`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error updating ${pair.pairKey}:`, error.message);
    }
  }

  /**
   * Start the price updater service
   * Each pair will be updated every 30 seconds, but staggered to avoid all updating at once
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Price updater is already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting Pyth Price Updater service...');
    console.log(`   Each pair will update every ${UPDATE_INTERVAL / 1000} seconds (staggered)`);

    // Get all active pairs
    const pairs = await this.getActivePairs();
    
    if (pairs.length === 0) {
      console.log('⏭️  No active pairs to update');
      return;
    }

    // Start each pair with a staggered delay to avoid all updating at once
    // Spread updates over the interval period
    const staggerDelay = UPDATE_INTERVAL / pairs.length;
    
    pairs.forEach((pair, index) => {
      const delay = index * staggerDelay;
      
      // Initial update after delay
      setTimeout(() => {
        if (this.isRunning) {
          console.log(`🔄 Starting updates for ${pair.pairKey} (every ${UPDATE_INTERVAL / 1000}s)`);
          this.updateSinglePair(pair).catch(err => {
            console.error(`Error updating ${pair.pairKey}:`, err);
          });
        }
      }, delay);
      
      // Then set up interval for this pair
      const interval = setInterval(() => {
        if (this.isRunning) {
          this.updateSinglePair(pair).catch(err => {
            console.error(`Error updating ${pair.pairKey}:`, err);
          });
        }
      }, UPDATE_INTERVAL);
      
      this.pairIntervals.set(pair.pairKey, interval);
    });

    console.log(`✅ Price updater started - ${pairs.length} pairs will update every ${UPDATE_INTERVAL / 1000}s (staggered)`);
  }

  /**
   * Stop the price updater service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Clear all pair intervals
    this.pairIntervals.forEach((interval, pairKey) => {
      clearInterval(interval);
      console.log(`   🛑 Stopped updates for ${pairKey}`);
    });
    this.pairIntervals.clear();

    console.log('🛑 Price updater stopped');
  }
}

// Main execution
if (require.main === module) {
  const updater = new PythPriceUpdater();
  
  // Start the service
  updater.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    updater.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    updater.stop();
    process.exit(0);
  });
}

export default PythPriceUpdater;
