import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { useWallets } from '@privy-io/react-auth';
import { useFHEVM } from '../hooks/useFHEVM';
import { getPerpDEXContract, getContractFees, calculateFee } from '../utils/perpdexContract';
import { getUserOpenPositions, Position as EnvioPosition, checkIndexerHealth, getCurrencyPairsByKeys } from '../utils/envio';
import { Position } from '../utils/perpdexContract';
import { getPositionDirections, storePositionDirectionFromOrder, storePositionDirection } from '../utils/positionDirection';
import { getAllStopLosses, shouldTriggerStopLoss, removeStopLoss, getStopLoss } from '../utils/stopLoss';
import { USDC_ADDRESS, getUSDCToken, getUSDCBalance, formatUSDC } from '../utils/usdcToken';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import { getPriceWithFallback } from '../utils/coingeckoApi';
import { convertToBinanceSymbol } from '../utils/binanceWebSocket';
// WebSocket disabled - using contract prices instead
// import { BinanceWebSocket, getBinanceTickerStream, parseBinanceTicker } from '../utils/binanceWebSocket';

interface OpenPositionsProps {
  pairKey?: string; // Optional: filter by pair
  refreshTrigger?: number; // Optional: trigger refresh when this changes
  onHedgeRequest?: (pairKey: string, oppositeDirection: 'long' | 'short') => void;
}

const OpenPositions: React.FC<OpenPositionsProps> = ({ pairKey, refreshTrigger, onHedgeRequest }) => {
  const { account, signer, provider, isConnected, embeddedWallet } = useWallet();
  const { wallets } = useWallets();
  const { encryptBool, encrypt32, isReady: fhevmReady } = useFHEVM(provider || undefined, embeddedWallet);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<bigint | null>(null);
  const [hedgingPositionId, setHedgingPositionId] = useState<bigint | null>(null);
  const [pairPrices, setPairPrices] = useState<Record<string, bigint>>({});
  const [pairNames, setPairNames] = useState<Record<string, string>>({}); // pairKey -> displayName (e.g., "BTCUSD")
  const [positionDirections, setPositionDirections] = useState<Map<bigint, 'long' | 'short'>>(new Map());
  const [stopLossPrices, setStopLossPrices] = useState<Map<bigint, string | null>>(new Map()); // positionId -> stopLossPrice from indexer
  const [contractFees, setContractFees] = useState<{ openingFeeBP: number; closingFeeBP: number } | null>(null); // Contract fees cache
  const [hedgeEnabled, setHedgeEnabled] = useState<Map<bigint, boolean>>(new Map()); // positionId -> hedge enabled
  // Price cache: pairKeyHash -> { price: bigint, timestamp: number }
  const priceCacheRef = useRef<Map<string, { price: bigint; timestamp: number }>>(new Map());
  // WebSocket disabled - using contract prices instead
  // const wsConnectionsRef = useRef<Map<string, BinanceWebSocket>>(new Map());
  const wsConnectionsRef = useRef<Map<string, any>>(new Map()); // Placeholder for cleanup
  const stopLossCheckRef = useRef<Map<bigint, boolean>>(new Map()); // Track which positions already triggered stop loss
  const loadOpenPositionsRef = useRef<(() => Promise<void>) | null>(null);
  const priceUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const positionsRef = useRef<Position[]>([]); // Keep current positions in ref for interval

  // Normalize pairKey: ensure it ends with "USD" (e.g., "BTC" -> "BTCUSD")
  const normalizedPairKey = pairKey 
    ? (pairKey.toUpperCase().endsWith('USD') ? pairKey.toUpperCase() : `${pairKey.toUpperCase()}USD`)
    : undefined;

  // Check stop losses for positions
  const checkStopLosses = async (pairKey: string, currentPrice: number) => {
    if (!signer || !account || !provider) return;
    
    try {
      // Get positions for this pair
      const pairPositions = positions.filter(p => p.pairKey === pairKey);
      
      for (const position of pairPositions) {
        const direction = positionDirections.get(position.positionId);
        if (!direction) continue;
        
        // Check if stop loss already triggered for this position
        if (stopLossCheckRef.current.get(position.positionId)) {
          continue; // Already triggered, skip
        }
        
        // Get stop loss price from indexer or localStorage
        const indexerStopLoss = stopLossPrices.get(position.positionId);
        
        // Check if stop loss should be triggered
        if (shouldTriggerStopLoss(position.positionId, currentPrice, direction, indexerStopLoss)) {
          console.log(`[OpenPositions] Stop loss triggered for position ${position.positionId.toString()} at $${currentPrice.toFixed(4)}`);
          stopLossCheckRef.current.set(position.positionId, true);
          
          // Show notification
          toast.warning(
            `Stop loss triggered for position ${position.positionId.toString()} at $${currentPrice.toFixed(4)}`,
            { autoClose: 5000 }
          );
          
          // Automatically close the position
          try {
            await handleClosePosition(position.positionId);
            // Remove stop loss after closing
            await removeStopLoss(position.positionId);
            stopLossCheckRef.current.delete(position.positionId);
          } catch (error) {
            console.error(`[OpenPositions] Error closing position ${position.positionId.toString()} via stop loss:`, error);
            toast.error(`Failed to close position ${position.positionId.toString()} via stop loss`);
            // Reset flag so it can be retried
            stopLossCheckRef.current.delete(position.positionId);
          }
        }
      }
    } catch (error) {
      console.error('[OpenPositions] Error checking stop losses:', error);
    }
  };

  // Load contract fees on mount and when provider changes
  useEffect(() => {
    if (provider) {
      getContractFees(provider).then(setContractFees).catch(err => {
        console.warn('[OpenPositions] Could not load contract fees:', err);
        setContractFees({ openingFeeBP: 0, closingFeeBP: 25 }); // Use defaults
      });
    }
  }, [provider]);

  // WebSocket connections disabled - using contract prices instead
  // Note: pairKey is a hash (e.g., 0x7404e3d104...), not a Binance symbol (e.g., BTCUSDT)
  // Binance WebSocket requires real pair names, but we only have hashes
  // Prices are loaded from contract every 10 seconds via auto-refresh instead
  useEffect(() => {
    // Cleanup any existing WebSocket connections on mount
    if (wsConnectionsRef.current) {
      wsConnectionsRef.current.forEach((ws: any) => {
        if (ws && typeof ws.disconnect === 'function') {
          ws.disconnect();
        }
      });
      wsConnectionsRef.current.clear();
    }
  }, []);

  // Helper function to load prices from contract and Binance (parallel, use more recent, with cache)
  const loadPricesFromContract = useCallback(async (pairKeys: string[]): Promise<{ prices: Record<string, bigint>; pairNames: Record<string, string> }> => {
    const prices: Record<string, bigint> = {};
    const pairNameMap: Record<string, string> = {};
    const PRICE_CACHE_TTL = 10000; // 10 seconds cache TTL - reduce API calls
    const now = Date.now();
    
    if (pairKeys.length === 0 || !provider) {
      return { prices, pairNames: pairNameMap };
    }
    
    // Check cache first
    const uncachedPairKeys: string[] = [];
    for (const pairKeyHash of pairKeys) {
      const cached = priceCacheRef.current.get(pairKeyHash);
      if (cached && (now - cached.timestamp) < PRICE_CACHE_TTL) {
        prices[pairKeyHash] = cached.price;
        // Still need to get pair name
        uncachedPairKeys.push(pairKeyHash);
      } else {
        uncachedPairKeys.push(pairKeyHash);
      }
    }
    
    // If all prices are cached, still need to get pair names
    if (uncachedPairKeys.length === 0 && pairKeys.length > 0) {
      // Get pair names only
      try {
        const contract = await getPerpDEXContract(provider);
        const { getAllPairs } = await import('../utils/perpdexContract');
        const allPairs = await getAllPairs(provider);
        
        for (const pair of allPairs) {
          const pairKeyString = pair.pairKey; // e.g., "BTCUSD"
          const pairKeyHash = ethers.keccak256(ethers.toUtf8Bytes(pairKeyString));
          const displayName = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
          
          // Check if any pairKey matches (either string or hash)
          for (const pairKey of pairKeys) {
            if (pairKey === pairKeyString || pairKey.toLowerCase() === pairKeyHash.toLowerCase()) {
              pairNameMap[pairKey] = displayName;
            }
          }
        }
      } catch (err) {
        console.error('[OpenPositions] Error loading pair names:', err);
      }
      
      return { prices, pairNames: pairNameMap };
    }
    
    try {
      const contract = await getPerpDEXContract(provider);
      const { getAllPairs } = await import('../utils/perpdexContract');
      const allPairs = await getAllPairs(provider);
      
      // Create mapping: both string pairKey and hash -> { baseCurrency, quoteCurrency, currentPrice, lastUpdateTime, coingeckoId }
      // NOTE: Indexer returns pairKey as string (e.g., "BTCUSD"), not hash
      const pairKeyToInfo = new Map<string, { baseCurrency: string; quoteCurrency: string; currentPrice: bigint; lastUpdateTime: bigint; coingeckoId?: string }>();
      
      for (const pair of allPairs) {
        const pairKeyString = pair.pairKey; // e.g., "BTCUSD"
        const pairKeyHash = ethers.keccak256(ethers.toUtf8Bytes(pairKeyString));
        const pairInfo = {
          baseCurrency: pair.config.baseCurrency,
          quoteCurrency: pair.config.quoteCurrency,
          currentPrice: pair.config.currentPrice,
          lastUpdateTime: pair.config.lastUpdateTime || BigInt(0),
          coingeckoId: pair.config.coingeckoId || undefined,
        };
        // Map both string and hash for flexibility
        pairKeyToInfo.set(pairKeyString, pairInfo);
        pairKeyToInfo.set(pairKeyHash.toLowerCase(), pairInfo);
      }
      
      // First, collect all unique display names and their pairKeys
      const uniquePairs = new Map<string, { pairKeys: string[]; coingeckoId?: string; pairInfo?: any }>();
      
      // Map pairKeys (can be strings from indexer or hashes from contract) to contract pair info
      for (const pairKey of pairKeys) {
        // Check if pairKey is a hash or a string
        const isHash = pairKey.startsWith('0x') && pairKey.length === 66;
        const lookupKey = isHash ? pairKey.toLowerCase() : pairKey;
        const pairInfo = pairKeyToInfo.get(lookupKey);
        if (pairInfo) {
          // Set pair name
          const displayName = `${pairInfo.baseCurrency}${pairInfo.quoteCurrency}`;
          pairNameMap[pairKey] = displayName;
          
          // Group by unique displayName
          if (!uniquePairs.has(displayName)) {
            uniquePairs.set(displayName, {
              pairKeys: [],
              coingeckoId: pairInfo.coingeckoId,
              pairInfo,
            });
          }
          uniquePairs.get(displayName)!.pairKeys.push(pairKey);
        } else {
          // Fallback: try direct contract call (pairKey might be a string from indexer)
          try {
            // Contract expects string pairKey, not hash
            const contractPairKey = isHash ? undefined : pairKey;
            if (contractPairKey) {
              const { getPairConfig } = await import('../utils/priceOracleContract');
              const pairConfig = await getPairConfig(provider, contractPairKey);
              if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                const displayName = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                pairNameMap[pairKey] = displayName;
                
                // Group by unique displayName
                if (!uniquePairs.has(displayName)) {
                  uniquePairs.set(displayName, {
                    pairKeys: [],
                    coingeckoId: pairConfig.coingeckoId,
                  });
                }
                uniquePairs.get(displayName)!.pairKeys.push(pairKey);
              } else {
                pairNameMap[pairKey] = pairKey.substring(0, 8) + '...';
              }
            } else {
              pairNameMap[pairKey] = pairKey.substring(0, 8) + '...';
            }
          } catch (err: any) {
            // Last resort: use pairKey as-is or truncated
            pairNameMap[pairKey] = isHash ? pairKey.substring(0, 8) + '...' : pairKey;
          }
        }
      }
      
      // Fetch prices for unique pairs only (cache will handle duplicates)
      const priceMap = new Map<string, number>();
      const { getPriceWithFallback } = await import('../utils/coingeckoApi');
      
      const uniquePricePromises = Array.from(uniquePairs.entries()).map(async ([displayName, pairData]) => {
        try {
          const result = await getPriceWithFallback(displayName, pairData.coingeckoId);
          priceMap.set(displayName, result.price);
        } catch (priceError) {
          console.warn(`[OpenPositions] Price fetch failed for ${displayName}:`, priceError);
        }
      });
      
      await Promise.allSettled(uniquePricePromises);
      
      // Prepare data for parallel fetching (contract prices)
      const pricePromises: Array<Promise<{ pairKey: string; contractPrice: bigint; contractTime: bigint; binancePrice?: number; displayName: string }>> = [];
      
      for (const pairKey of pairKeys) {
        const isHash = pairKey.startsWith('0x') && pairKey.length === 66;
        const lookupKey = isHash ? pairKey.toLowerCase() : pairKey;
        const pairInfo = pairKeyToInfo.get(lookupKey);
        if (pairInfo) {
          const displayName = `${pairInfo.baseCurrency}${pairInfo.quoteCurrency}`;
          
          // Create promise for contract price only (API price already fetched)
          const pricePromise = (async () => {
            const contractPairKey = isHash ? undefined : pairKey;
            let contractPrice: bigint;
            let contractTime: bigint;
            
            if (contractPairKey) {
              const { getPrice } = await import('../utils/priceOracleContract');
              const priceInfo = await getPrice(provider, contractPairKey);
              contractPrice = priceInfo.price;
              contractTime = priceInfo.lastUpdateTime || BigInt(0);
            } else {
              contractPrice = pairInfo.currentPrice;
              contractTime = pairInfo.lastUpdateTime;
            }
            
            const binancePrice = priceMap.get(displayName);
            
            return {
              pairKey,
              contractPrice,
              contractTime,
              binancePrice,
              displayName,
            };
          })();
          
          pricePromises.push(pricePromise);
        } else {
          // Fallback: try direct contract call
          try {
            const contractPairKey = isHash ? undefined : pairKey;
            if (contractPairKey) {
              const { getPairConfig, getPrice } = await import('../utils/priceOracleContract');
              const pairConfig = await getPairConfig(provider, contractPairKey);
              if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                const displayName = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                
                const pricePromise = (async () => {
                  const priceInfo = await getPrice(provider, contractPairKey);
                  const contractPrice = priceInfo.price;
                  const contractTime = priceInfo.lastUpdateTime || BigInt(0);
                  const binancePrice = priceMap.get(displayName);
                  
                  return {
                    pairKey,
                    contractPrice,
                    contractTime,
                    binancePrice,
                    displayName,
                  };
                })();
                
                pricePromises.push(pricePromise);
              }
            }
          } catch (err: any) {
            // Skip
          }
        }
      }
      
      // Wait for all price fetches in parallel
      const priceResults = await Promise.allSettled(pricePromises);
      
      // Process results: use more recent price (Binance if available and contract price is stale)
      const PRICE_STALENESS = 5 * 60; // 5 minutes in seconds
      const nowBigInt = BigInt(Math.floor(Date.now() / 1000));
      
      for (const result of priceResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { pairKey, contractPrice, contractTime, binancePrice, displayName } = result.value;
          
          // Check if contract price is stale (older than 5 minutes)
          const contractAge = Number(nowBigInt - contractTime);
          const isContractStale = contractAge > PRICE_STALENESS;
          
          let finalPrice: bigint;
          
          // Always prefer CoinGecko price if available (real-time, more accurate)
          // Only fallback to contract price if CoinGecko fails
          if (binancePrice && binancePrice > 0 && !isNaN(binancePrice) && isFinite(binancePrice)) {
            // Use CoinGecko price (always more recent and accurate)
            finalPrice = BigInt(Math.floor(binancePrice * 1e8)); // Scale to PRICE_PRECISION
            if (process.env.NODE_ENV === 'development') {
              console.log(`[OpenPositions] Using CoinGecko price for ${displayName}: $${binancePrice}`);
            }
          } else {
            // CoinGecko failed or unavailable, use contract price as fallback
            finalPrice = contractPrice;
            if (process.env.NODE_ENV === 'development') {
              console.log(`[OpenPositions] Using contract price for ${displayName} (CoinGecko unavailable)`);
            }
          }
          
          // Store in cache (use original pairKey, can be string or hash)
          prices[pairKey] = finalPrice;
          priceCacheRef.current.set(pairKey, { price: finalPrice, timestamp: now });
        }
      }
    } catch (err) {
      console.error('[OpenPositions] Error loading prices from contract:', err);
    }
    
    return { prices, pairNames: pairNameMap };
  }, [provider]);

  useEffect(() => {
    if (!isConnected || !account || !provider) {
      setPositions([]);
      setPairNames({});
      return;
    }

    // Define loadOpenPositions inside useEffect to avoid circular dependency
    const loadOpenPositionsFn = async () => {
      if (!provider || !account) return;

      try {
        setLoading(true);
        
        // Load open positions from indexer (faster, real-time data)
        // Load positions from indexer
        
        const indexerAvailable = await checkIndexerHealth();
        let openPositions: Position[] = [];
        
        if (indexerAvailable) {
          // Get open positions from indexer (preferred - faster)
          try {
            const indexerPositions = await getUserOpenPositions(account);
            // Convert indexer positions to contract Position format
            openPositions = indexerPositions.map(ip => ({
              positionId: BigInt(ip.positionId),
              trader: account!,
              pairKey: ip.pairKey,
              entryPrice: BigInt(ip.entryPrice),
              size: BigInt(ip.size),
              collateral: BigInt(ip.collateral),
              leverage: BigInt(ip.leverage),
              timestamp: BigInt(ip.timestamp),
              isOpen: ip.isOpen,
              liquidationPrice: BigInt(ip.liquidationPrice),
              openingFee: BigInt(ip.openingFee),
              closingFee: BigInt(ip.closingFee),
            }));
            console.log('[OpenPositions] Loaded', openPositions.length, 'positions from indexer');
          } catch (indexerError) {
            console.warn('[OpenPositions] Indexer error, falling back to contract:', indexerError);
            // Fall through to contract fallback
          }
        }
        
        // Fallback: Load positions directly from contract if indexer unavailable or failed
        if (openPositions.length === 0) {
          console.log('[OpenPositions] Loading positions from contract (indexer unavailable or empty)');
          try {
            const contract = await getPerpDEXContract(provider);
            const positionIds = await contract.getUserPositions(account);
            console.log('[OpenPositions] Found', positionIds.length, 'position IDs from contract');
            
            // Load each position from contract
            for (const positionId of positionIds) {
              try {
                const position = await contract.positions(positionId);
                // Only include open positions
                if (position.isOpen && position.trader.toLowerCase() === account!.toLowerCase()) {
                  openPositions.push({
                    positionId,
                    trader: position.trader,
                    pairKey: position.pairKey,
                    entryPrice: position.entryPrice,
                    size: position.size,
                    collateral: position.collateral,
                    leverage: position.leverage,
                    timestamp: position.timestamp,
                    isOpen: position.isOpen,
                    liquidationPrice: position.liquidationPrice,
                    openingFee: position.openingFee,
                    closingFee: position.closingFee,
                  });
                }
              } catch (posError: any) {
                // Only log in development mode - these are often just closed positions
                if (process.env.NODE_ENV === 'development') {
                  console.warn(`[OpenPositions] Error loading position ${positionId}:`, posError);
                }
              }
            }
            console.log('[OpenPositions] Loaded', openPositions.length, 'open positions from contract');
          } catch (contractError: any) {
            // Only log detailed error in development mode
            if (process.env.NODE_ENV === 'development') {
              console.error('[OpenPositions] Error loading positions from contract:', contractError);
            } else {
              // In production, only log a simple warning
              if (contractError.message?.includes('missing revert data')) {
                console.warn('[OpenPositions] RPC connection issue (non-critical)');
              } else {
                console.warn('[OpenPositions] Error loading positions (non-critical):', contractError.message || 'Unknown error');
              }
            }
            // Don't clear positions on error - keep existing data
            setLoading(false);
            return;
          }
        }

        // Get unique pair keys
        // NOTE: Indexer returns pairKey as string (e.g., "BTCUSD"), not hash
        const allPairKeys = Array.from(new Set(openPositions.map(p => p.pairKey)));
        console.log('[OpenPositions] Unique pair keys from indexer:', allPairKeys);
        
        // Load pair names from indexer (faster) and prices from Binance API (real-time)
        const pairNameMap: Record<string, string> = {};
        
        if (allPairKeys.length > 0) {
          try {
            // Try to load pair names from indexer first
            const indexerAvailable = await checkIndexerHealth();
            if (indexerAvailable) {
              try {
                const { getCurrencyPairsByKeys } = await import('../utils/envio');
                // Indexer pairKey is already a string (e.g., "BTCUSD"), not a hash
                const currencyPairs = await getCurrencyPairsByKeys(allPairKeys);
                console.log('[OpenPositions] Loaded', currencyPairs.length, 'currency pairs from indexer');
                currencyPairs.forEach(pair => {
                  pairNameMap[pair.pairKey] = `${pair.baseCurrency}${pair.quoteCurrency}`;
                });
              } catch (err) {
                console.warn('[OpenPositions] Error loading pair names from indexer:', err);
              }
            }
            
            // For any pairKeys not found in indexer, try contract
            // Check if pairKey is a hash (starts with 0x and 64 chars) or a string
            for (const pairKey of allPairKeys) {
              if (!pairNameMap[pairKey]) {
                try {
                  // Check if pairKey is a hash (from contract) or a string (from indexer)
                  const isHash = pairKey.startsWith('0x') && pairKey.length === 66;
                  
                  if (isHash) {
                    // It's a hash, need to find the matching pair from contract
                    const { getAllPairs } = await import('../utils/perpdexContract');
                    const allPairs = await getAllPairs(provider);
                    
                    for (const pair of allPairs) {
                      const hash = ethers.keccak256(ethers.toUtf8Bytes(pair.pairKey));
                      if (hash.toLowerCase() === pairKey.toLowerCase()) {
                        pairNameMap[pairKey] = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
                        break;
                      }
                    }
                    
                    // Last resort: try direct contract call with hash
                    if (!pairNameMap[pairKey]) {
                      const { getPairConfig } = await import('../utils/priceOracleContract');
                      const pairConfig = await getPairConfig(provider, pairKey);
                      if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                        pairNameMap[pairKey] = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                      } else {
                        pairNameMap[pairKey] = pairKey.substring(0, 8) + '...';
                      }
                    }
                  } else {
                    // It's already a string (from indexer), try direct oracle call
                    try {
                      const { getPairConfig } = await import('../utils/priceOracleContract');
                      const pairConfig = await getPairConfig(provider, pairKey);
                      if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                        pairNameMap[pairKey] = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                      } else {
                        // Use pairKey as-is if it looks like a valid pair name (e.g., "BTCUSD")
                        pairNameMap[pairKey] = pairKey;
                      }
                    } catch (err: any) {
                      // Use pairKey as-is if contract call fails
                      pairNameMap[pairKey] = pairKey;
                    }
                  }
                } catch (err: any) {
                  // Fallback: use pairKey as-is
                  pairNameMap[pairKey] = pairKey;
                }
              }
            }
          } catch (err) {
            console.error('[OpenPositions] Error loading pair names:', err);
          }
        }
        
        // First, set positions with entry prices (immediate display for fast initial load)
        console.log('[OpenPositions] Setting', openPositions.length, 'positions in state');
        console.log('[OpenPositions] Pair names loaded:', Object.keys(pairNameMap).length);
        setPositions(openPositions);
        positionsRef.current = openPositions; // Update ref
        setPairNames(prev => ({ ...prev, ...pairNameMap })); // Set pair names immediately
        
        // Load directions from indexer (primary source) - fallback to localStorage
        const directions = new Map<bigint, 'long' | 'short'>();
        try {
          const indexerAvailable = await checkIndexerHealth();
          if (indexerAvailable && openPositions.length > 0) {
            // Load positions from indexer to get directions
            const indexerPositions = await getUserOpenPositions(account);
            indexerPositions.forEach((ip) => {
              if (ip.direction && (ip.direction === 'long' || ip.direction === 'short')) {
                const posId = BigInt(ip.positionId);
                directions.set(posId, ip.direction as 'long' | 'short');
                console.log(`[OpenPositions] Loaded direction ${ip.direction} for position ${ip.positionId} from indexer`);
              }
            });
            console.log(`[OpenPositions] Loaded ${directions.size} directions from indexer`);
          }
        } catch (err) {
          console.warn('[OpenPositions] Could not load directions from indexer:', err);
        }
        
        // Fallback to localStorage for any positions not found in indexer
        const localStorageDirections = getPositionDirections(openPositions.map(p => p.positionId));
        localStorageDirections.forEach((dir, posId) => {
          if (!directions.has(posId)) {
            directions.set(posId, dir);
            console.log(`[OpenPositions] Using direction ${dir} for position ${posId.toString()} from localStorage (fallback)`);
          }
        });
        
        setPositionDirections(directions);
        
        // Load stop losses from indexer if available
        const stopLossMap = new Map<bigint, string | null>();
        try {
          const indexerAvailable = await checkIndexerHealth();
          if (indexerAvailable && openPositions.length > 0) {
            const indexerPositions = await getUserOpenPositions(account);
            indexerPositions.forEach((ip) => {
              const posId = BigInt(ip.positionId);
              stopLossMap.set(posId, ip.stopLossPrice || null);
            });
          }
        } catch (err) {
          console.warn('[OpenPositions] Could not load stop losses from indexer:', err);
        }
        setStopLossPrices(stopLossMap);
        
        // Then, load current prices from CoinGecko Pro API (real-time) - this updates after initial render
        // This ensures fast initial load, then prices update
        try {
          const { prices } = await loadPricesFromContract(allPairKeys);
          setPairPrices(prev => {
            // Merge prices, ensuring all pairKeys are updated
            const updated = { ...prev };
            let hasUpdates = false;
            for (const pairKey of allPairKeys) {
              if (prices[pairKey]) {
                updated[pairKey] = prices[pairKey];
                hasUpdates = true;
              }
            }
            if (hasUpdates) {
              console.log('[OpenPositions] Prices loaded for', Object.keys(prices).length, 'pairs');
            }
            return updated;
          });
        } catch (priceError) {
          console.warn('[OpenPositions] Error loading prices (non-critical):', priceError);
          // Continue without prices - positions will still be displayed with entry prices
        }
        
        // Update positions ref
        positionsRef.current = openPositions;
        
        // Start price update interval after positions are loaded
        if (priceUpdateIntervalRef.current) {
          clearInterval(priceUpdateIntervalRef.current);
        }
        priceUpdateIntervalRef.current = setInterval(async () => {
          if (!provider || !account) return;
          
          // Get current positions from ref
          const currentPositions = positionsRef.current;
          if (currentPositions.length === 0) return;
          
          try {
            const allPairKeys = Array.from(new Set(currentPositions.map(p => p.pairKey)));
            if (allPairKeys.length === 0) return;
            
            // Silently update prices (reduce console spam)
            const { prices: updatedPrices } = await loadPricesFromContract(allPairKeys);
            
            setPairPrices(prev => {
              const updated = { ...prev };
              for (const pairKey of allPairKeys) {
                if (updatedPrices[pairKey]) {
                  updated[pairKey] = updatedPrices[pairKey];
                }
              }
              return updated;
            });
          } catch (err) {
            console.warn('[OpenPositions] Interval: Error updating prices:', err);
          }
        }, 15000); // 15 seconds - reduced frequency to avoid rate limits
      } catch (err: any) {
        console.error('Error loading open positions:', err);
        toast.error(`Failed to load positions: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    // Store in ref for interval
    loadOpenPositionsRef.current = loadOpenPositionsFn;
    
    // Load positions immediately
    loadOpenPositionsFn();
    
    // Refresh positions every 5 seconds (balance between real-time updates and performance)
    const interval = setInterval(() => {
      if (loadOpenPositionsRef.current) {
        loadOpenPositionsRef.current();
      }
    }, 10000); // 10 seconds - reduced frequency to avoid rate limits
      
      // Listen for OrderExecuted events to map order direction to position
      const setupEventListeners = async () => {
        try {
          const contract = await getPerpDEXContract(provider);
          
          // Listen for OrderExecuted events
          contract.on('OrderExecuted', async (orderId, positionId, trader, pairKey, executionPrice) => {
            if (trader.toLowerCase() === account.toLowerCase()) {
              // OrderExecuted event received
              
              // Map order direction to position
              storePositionDirectionFromOrder(orderId, positionId);
              
              // Get direction and update open interest
              (async () => {
                try {
                  const { getOrderDirection } = await import('../utils/positionDirection');
                  const { setPositionDirection } = await import('../utils/envio');
                  const direction = getOrderDirection(orderId);
                  if (direction) {
                    await setPositionDirection(positionId.toString(), direction);
                    // Direction stored in indexer
                    
                    // Update open interest in contract (direction is now known)
                    if (signer && account) {
                      try {
                        const contract = await getPerpDEXContract(signer);
                        const isLong = direction === 'long';
                        console.log(`[OpenPositions] Updating open interest for position ${positionId.toString()}, direction: ${direction}`);
                        
                        // Call updateOpenInterest to correctly track long/short positions
                        const updateTx = await contract.updateOpenInterest(positionId, isLong);
                        await updateTx.wait();
                        console.log(`[OpenPositions] Open interest updated successfully for position ${positionId.toString()}`);
                      } catch (updateError: any) {
                        // Non-critical error - log but don't fail
                        console.warn('[OpenPositions] Failed to update open interest (non-critical):', updateError);
                      }
                    }
                  }
                } catch (err) {
                  console.warn('[OpenPositions] Could not store direction in indexer:', err);
                }
              })();
              
              // Refresh positions immediately after event
              setTimeout(() => {
                // Refreshing positions after event
                if (loadOpenPositionsRef.current) {
                  loadOpenPositionsRef.current();
                }
              }, 1000);
            }
          });
          
          // Listen for PositionClosed events to store exitPrice (for when indexer is not available)
          contract.on('PositionClosed', async (positionId, trader, pairKey, exitPrice, pnl, collateralReturned, closingFee) => {
            if (trader.toLowerCase() === account.toLowerCase()) {
              console.log(`[OpenPositions] PositionClosed event received for position ${positionId.toString()}, exitPrice: ${exitPrice.toString()}`);
              
              // Store exitPrice in localStorage (fallback when indexer is not available)
              try {
                const stored = localStorage.getItem('shadefx_position_exit_prices');
                const exitPrices: Record<string, string> = stored ? JSON.parse(stored) : {};
                exitPrices[positionId.toString()] = exitPrice.toString();
                localStorage.setItem('shadefx_position_exit_prices', JSON.stringify(exitPrices));
                console.log(`[OpenPositions] Stored exitPrice for position ${positionId.toString()}: ${exitPrice.toString()}`);
              } catch (e) {
                console.error('[OpenPositions] Error storing exitPrice:', e);
              }
              
              // Refresh positions after a short delay
              setTimeout(() => {
                if (loadOpenPositionsRef.current) {
                  loadOpenPositionsRef.current();
                }
              }, 2000);
            }
          });
          
          // Listen for PositionOpened events (immediate refresh when position is opened)
          contract.on('PositionOpened', async (positionId, trader, pairKey, entryPrice, size, collateral, leverage) => {
            if (trader.toLowerCase() === account.toLowerCase()) {
              // PositionOpened event received
              console.log(`[OpenPositions] PositionOpened event received for position ${positionId.toString()}`);
              
              // Store direction in indexer (event-based approach - more reliable)
              // Wait a bit for indexer to process the PositionOpened event and create the Position record
              setTimeout(async () => {
                try {
                  const { getPositionDirection } = await import('../utils/positionDirection');
                  const { setPositionDirection } = await import('../utils/envio');
                  
                  // Get direction from localStorage (stored when position was opened)
                  const direction = getPositionDirection(positionId);
                  
                  if (direction) {
                    // Try to store direction in indexer (retry a few times if needed)
                    let retries = 3;
                    let success = false;
                    
                    while (retries > 0 && !success) {
                      try {
                        success = await setPositionDirection(positionId.toString(), direction);
                        if (success) {
                          if (process.env.NODE_ENV === 'development') {
                            console.log(`[OpenPositions] Successfully stored direction ${direction} in indexer for position ${positionId.toString()} (via PositionOpened event)`);
                          }
                        } else {
                          // Only log in development
                          if (process.env.NODE_ENV === 'development') {
                            console.warn(`[OpenPositions] Failed to store direction in indexer for position ${positionId.toString()} (attempt ${4 - retries}/3)`);
                          }
                          // Wait 1 second before retry
                          await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                      } catch (err) {
                        // Only log in development
                        if (process.env.NODE_ENV === 'development') {
                          console.warn(`[OpenPositions] Error storing direction in indexer (attempt ${4 - retries}/3):`, err);
                        }
                        // Wait 1 second before retry
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      }
                      retries--;
                    }
                    
                    if (!success && process.env.NODE_ENV === 'development') {
                      console.warn(`[OpenPositions] Could not store direction in indexer after 3 attempts for position ${positionId.toString()}`);
                    }
                  } else {
                    console.warn(`[OpenPositions] No direction found in localStorage for position ${positionId.toString()} - cannot store in indexer`);
                  }
                } catch (err) {
                  console.error('[OpenPositions] Error in PositionOpened event handler:', err);
                }
              }, 2000); // Wait 2 seconds for indexer to process the event
              
              // Refresh positions immediately
              setTimeout(() => {
                if (loadOpenPositionsRef.current) {
                  loadOpenPositionsRef.current();
                }
              }, 500);
            }
          });
        } catch (err) {
          console.error('Error setting up event listeners:', err);
        }
      };
      
      setupEventListeners();
      
      // Separate interval for price updates (more frequent than position refresh)
      // Update prices every 3 seconds for real-time PnL updates
      const updatePricesOnly = async () => {
        if (!provider || !account) return;
        
        // Use current positions from state (not from closure)
        const currentPositions = positions;
        if (currentPositions.length === 0) return;
        
        try {
          const allPairKeys = Array.from(new Set(currentPositions.map(p => p.pairKey)));
          if (allPairKeys.length === 0) return;
          
          // Updating prices
          const { prices } = await loadPricesFromContract(allPairKeys);
          
          setPairPrices(prev => {
            // Merge prices, ensuring all pairKeys are updated
            const updated = { ...prev };
            let hasUpdates = false;
            for (const pairKey of allPairKeys) {
              if (prices[pairKey]) {
                updated[pairKey] = prices[pairKey];
                hasUpdates = true;
              }
            }
            if (hasUpdates) {
              // Prices updated
            }
            return updated;
          });
        } catch (err) {
          console.warn('[OpenPositions] Error updating prices:', err);
        }
      };
      
      // Start price update interval (only if positions exist)
      if (positions.length > 0) {
        priceUpdateIntervalRef.current = setInterval(updatePricesOnly, 15000); // Update prices every 15 seconds - reduced frequency to avoid rate limits
      }
      
      return () => {
        clearInterval(interval);
        if (priceUpdateIntervalRef.current) {
          clearInterval(priceUpdateIntervalRef.current);
        }
        // Clean up event listeners
        if (provider) {
          getPerpDEXContract(provider).then(contract => {
            contract.removeAllListeners('OrderExecuted');
            contract.removeAllListeners('PositionOpened');
          }).catch(() => {});
        }
      };
  }, [isConnected, account, provider, refreshTrigger, loadPricesFromContract, positions.length]); // Added positions.length to update interval when positions change

  const handleHedgePosition = async (position: Position, direction: 'long' | 'short') => {
    if (!signer || !account || !fhevmReady || !provider) {
      toast.error('Please connect wallet and wait for FHEVM to initialize');
      return;
    }

    if (hedgingPositionId === position.positionId) {
      return; // Already processing
    }

    try {
      setHedgingPositionId(position.positionId);
      // Calculate required collateral: size / leverage
      const size = typeof position.size === 'bigint' ? position.size : BigInt(position.size);
      const leverage = typeof position.leverage === 'bigint' ? position.leverage : BigInt(position.leverage);
      const requiredCollateral = size / leverage;
      
      // Check USDC balance
      const usdcBalance = await getUSDCBalance(provider, account);
      if (usdcBalance < requiredCollateral) {
        const requiredFormatted = formatUSDC(requiredCollateral);
        const balanceFormatted = formatUSDC(usdcBalance);
        toast.error(
          `Insufficient USDC balance. Required: ${requiredFormatted} USDC, Available: ${balanceFormatted} USDC`,
          { autoClose: 8000 }
        );
        return;
      }

      // Check USDC approval
      const contract = await getPerpDEXContract(signer);
      const contractAddress = await contract.getAddress();
      const usdcContract = getUSDCToken(provider);
      const allowance = await usdcContract.allowance(account, contractAddress);
      
      if (allowance < requiredCollateral) {
        toast.info('Approving USDC...', { autoClose: 3000 });
        const approveTx = await usdcContract.approve(contractAddress, ethers.MaxUint256);
        await approveTx.wait();
        toast.success('USDC approved!', { autoClose: 2000 });
      }

      // Encrypt direction
      const directionBool = direction === 'long';
      const encryptedDirectionInput = await encryptBool(directionBool, contractAddress, account);
      const encryptedDirection = ethers.hexlify(encryptedDirectionInput.handles[0]);
      const inputProofDirection = ethers.hexlify(encryptedDirectionInput.inputProof);

      // Encrypt leverage
      const leverageNum = Number(leverage);
      const encryptedLeverageInput = await encrypt32(leverageNum, contractAddress, account);
      const encryptedLeverage = ethers.hexlify(encryptedLeverageInput.handles[0]);
      const inputProofLeverage = ethers.hexlify(encryptedLeverageInput.inputProof);

      // Get pairKey (might be hash or string)
      let pairKey = position.pairKey;
      const isHash = pairKey.startsWith('0x') && pairKey.length === 66;
      
      // If pairKey is a hash, we need to find the string pairKey
      if (isHash) {
        const { getAllPairs } = await import('../utils/perpdexContract');
        const allPairs = await getAllPairs(provider);
        for (const pair of allPairs) {
          const hash = ethers.keccak256(ethers.toUtf8Bytes(pair.pairKey));
          if (hash.toLowerCase() === pairKey.toLowerCase()) {
            pairKey = pair.pairKey;
            break;
          }
        }
      }

      toast.info('Opening hedge position...', { autoClose: 3000 });

      // Create market order for hedge
      const tx = await contract.createMarketOrder(
        pairKey,
        encryptedDirection,
        encryptedLeverage,
        inputProofDirection,
        inputProofLeverage,
        leverageNum,
        requiredCollateral
      );

      toast.info('Transaction submitted, waiting for confirmation...', { autoClose: 5000 });
      const receipt = await tx.wait();

      if (receipt && receipt.status === 1) {
        // Extract position ID from event
        let hedgePositionId: bigint | null = null;
        if (receipt.logs) {
          const iface = contract.interface;
          for (const log of receipt.logs) {
            try {
              const parsedLog = iface.parseLog(log);
              if (parsedLog && parsedLog.name === 'PositionOpened') {
                hedgePositionId = parsedLog.args.positionId as bigint;
                break;
              }
            } catch (e) {
              // Not a PositionOpened event, continue
            }
          }
        }

        if (hedgePositionId) {
          // Store direction
          storePositionDirection(hedgePositionId, direction);
          
          // Update open interest
          const isLong = direction === 'long';
          const updateTx = await contract.updateOpenInterest(hedgePositionId, isLong);
          await updateTx.wait();

          // Store direction in indexer
          try {
            const { setPositionDirection } = await import('../utils/envio');
            await setPositionDirection(hedgePositionId.toString(), direction);
          } catch (err) {
            console.warn('[OpenPositions] Could not store direction in indexer:', err);
          }
        }

        toast.success(`Hedge position opened successfully! Position ID: ${hedgePositionId?.toString() || 'N/A'}`);
        
        // Refresh positions
        if (loadOpenPositionsRef.current) {
          await loadOpenPositionsRef.current();
        }
      } else {
        toast.error('Transaction failed');
      }
    } catch (error: any) {
      console.error('[OpenPositions] Error opening hedge position:', error);
      const errorMsg = error.reason || error.message || 'Unknown error';
      toast.error(`Failed to open hedge position: ${errorMsg}`);
    } finally {
      setHedgingPositionId(null);
    }
  };

  const handleClosePosition = async (positionId: bigint) => {
    // Get direction from indexer (primary source) - fallback to localStorage
    let direction: 'long' | 'short' | null = null;
    
    // Try indexer first
    try {
      const indexerAvailable = await checkIndexerHealth();
      if (indexerAvailable && account) {
        const indexerPositions = await getUserOpenPositions(account);
        const indexerPosition = indexerPositions.find(ip => ip.positionId === positionId.toString());
        if (indexerPosition?.direction && (indexerPosition.direction === 'long' || indexerPosition.direction === 'short')) {
          direction = indexerPosition.direction as 'long' | 'short';
          console.log(`[OpenPositions] Loaded direction ${direction} for position ${positionId.toString()} from indexer`);
        }
      }
    } catch (err) {
      console.warn('[OpenPositions] Could not load direction from indexer:', err);
    }
    
    // Fallback to localStorage if not found in indexer
    if (!direction) {
      const directions = getPositionDirections([positionId]);
      direction = directions.get(positionId) || null;
      if (direction) {
        console.log(`[OpenPositions] Using direction ${direction} for position ${positionId.toString()} from localStorage (fallback)`);
      }
    }
    
    // Fallback to state (if already loaded)
    if (!direction) {
      direction = positionDirections.get(positionId) || null;
      if (direction) {
        console.log(`[OpenPositions] Using direction ${direction} for position ${positionId.toString()} from state (fallback)`);
      }
    }
    
    if (!signer || !account || !provider) {
      toast.error('Please connect your wallet');
      return;
    }

    // If direction still not found, try to determine from contract by testing both directions
    if (!direction) {
      console.warn(`[OpenPositions] Direction not found for position ${positionId.toString()}, trying to determine from contract...`);
      
      try {
        const contractReadOnly = await getPerpDEXContract(provider);
        const contractForEstimate = await getPerpDEXContract(signer);
        
        // Try to estimate gas for both directions - the correct one will succeed
        // First, get position info
        const position = await contractReadOnly.positions(positionId);
        const actualPairKey = position.pairKey;
        
        // Get current price and update if stale
        const { getPriceWithFallback } = await import('../utils/coingeckoApi');
        const priceResult = await getPriceWithFallback(actualPairKey);
        if (priceResult.price && priceResult.price > 0) {
          const scaledPrice = BigInt(Math.floor(priceResult.price * 1e8));
          try {
            const updateTx = await contractForEstimate.updatePrice(actualPairKey, scaledPrice, {
              gasLimit: BigInt(100000),
            });
            await updateTx.wait();
          } catch (updateError) {
            console.warn('[OpenPositions] Price update failed, continuing anyway:', updateError);
          }
        }
        
        // Try to estimate gas for long direction
        let longEstimateSuccess = false;
        try {
          await contractForEstimate.closePositionWithDirection.estimateGas(positionId, true);
          longEstimateSuccess = true;
          console.log(`[OpenPositions] Gas estimation succeeded for LONG direction`);
        } catch (longError: any) {
          console.log(`[OpenPositions] Gas estimation failed for LONG: ${longError.reason || longError.message}`);
        }
        
        // Try to estimate gas for short direction
        let shortEstimateSuccess = false;
        try {
          await contractForEstimate.closePositionWithDirection.estimateGas(positionId, false);
          shortEstimateSuccess = true;
          console.log(`[OpenPositions] Gas estimation succeeded for SHORT direction`);
        } catch (shortError: any) {
          console.log(`[OpenPositions] Gas estimation failed for SHORT: ${shortError.reason || shortError.message}`);
        }
        
        // Determine direction based on which estimation succeeded
        if (longEstimateSuccess && !shortEstimateSuccess) {
          direction = 'long';
          console.log(`[OpenPositions] Determined direction as LONG from contract gas estimation`);
        } else if (shortEstimateSuccess && !longEstimateSuccess) {
          direction = 'short';
          console.log(`[OpenPositions] Determined direction as SHORT from contract gas estimation`);
        } else if (longEstimateSuccess && shortEstimateSuccess) {
          // Both succeeded - this shouldn't happen, but default to long
          direction = 'long';
          console.warn(`[OpenPositions] Both directions succeeded in gas estimation, defaulting to LONG`);
        } else {
          // Both failed - show error
          toast.error('Could not determine position direction from contract. Please try refreshing the page or contact support.', { autoClose: 10000 });
          console.error(`[OpenPositions] Could not determine direction for position ${positionId.toString()} from contract gas estimation`);
          setClosingPositionId(null);
          return;
        }
        
        // Store the determined direction for future use
        if (direction) {
          const { storePositionDirection } = await import('../utils/positionDirection');
          storePositionDirection(positionId, direction);
          console.log(`[OpenPositions] Stored determined direction ${direction} for position ${positionId.toString()}`);
          
          // Also try to store in indexer
          try {
            const { setPositionDirection } = await import('../utils/envio');
            await setPositionDirection(positionId.toString(), direction);
            console.log(`[OpenPositions] Stored determined direction ${direction} in indexer for position ${positionId.toString()}`);
          } catch (err) {
            console.warn('[OpenPositions] Could not store determined direction in indexer:', err);
          }
        }
      } catch (contractError: any) {
        toast.error('Could not determine position direction from contract. Please try refreshing the page or contact support if the issue persists.', { autoClose: 10000 });
        console.error(`[OpenPositions] Could not determine direction for position ${positionId.toString()} from contract:`, contractError);
        setClosingPositionId(null);
        return;
      }
    }
    
    if (!direction) {
      toast.error('Could not determine position direction. Please try refreshing the page or contact support if the issue persists.', { autoClose: 10000 });
      console.error(`[OpenPositions] Could not determine direction for position ${positionId.toString()} after all attempts`);
      setClosingPositionId(null);
      return;
    }
    
    const isLong = direction === 'long';

    try {
      setClosingPositionId(positionId);
      const contract = await getPerpDEXContract(signer);
      const contractReadOnly = await getPerpDEXContract(provider);
      
      // First, verify the position exists and is open
      let position;
      try {
        position = await contractReadOnly.positions(positionId);
      } catch (posError: any) {
        console.error('[OpenPositions] Error fetching position:', posError);
        
        // Check if it's a "missing revert data" error (position doesn't exist in contract)
        if (posError.code === 'CALL_EXCEPTION' || posError.message?.includes('missing revert data')) {
          toast.error('Position not found in contract. It may have been closed or does not exist.', { autoClose: 10000 });
          setClosingPositionId(null);
          // Reload positions to update the list
          if (refreshTrigger !== undefined) {
            // Trigger refresh by updating a state that causes useEffect to reload
          }
          return;
        }
        
        toast.error('Failed to fetch position data. Please try again.', { autoClose: 10000 });
        setClosingPositionId(null);
        return;
      }
      
      if (!position.isOpen) {
        toast.error('Position is already closed');
        return;
      }
      
      if (position.trader.toLowerCase() !== account.toLowerCase()) {
        toast.error('You are not the owner of this position');
        return;
      }
      
      // IMPORTANT: position.pairKey from contract is a STRING (e.g., "BTCUSD"), not a hash
      const actualPairKey = position.pairKey; // This is a string like "BTCUSD"
      
      // Store pair config in outer scope for use in pre-close check
      let pairConfigBeforeUpdate: any;
      
      try {
        // Get current price from contract (same as position opening)
        // Backend service updates prices every 20 seconds, so we use contract's current price
        try {
          pairConfigBeforeUpdate = await contractReadOnly.pairs(actualPairKey);
        } catch (pairError: any) {
          // If contract.pairs fails, try to get from getAllPairs
          console.warn('[OpenPositions] pairs() call failed, trying getAllPairs fallback:', pairError);
          try {
            const { getAllPairs } = await import('../utils/perpdexContract');
            const allPairs = await getAllPairs(provider);
            const foundPair = allPairs.find(p => p.pairKey === actualPairKey);
            if (foundPair) {
              // Create a mock pairConfig from getAllPairs result
              pairConfigBeforeUpdate = {
                currentPrice: foundPair.config.currentPrice || BigInt(0),
                lastUpdateTime: foundPair.config.lastUpdateTime || BigInt(0),
                baseCurrency: foundPair.config.baseCurrency,
                quoteCurrency: foundPair.config.quoteCurrency
              };
            } else {
              throw new Error(`Pair ${actualPairKey} not found in contract`);
            }
          } catch (fallbackError) {
            console.error('[OpenPositions] Failed to get pair config from getAllPairs:', fallbackError);
            toast.error(`Failed to fetch pair configuration for ${actualPairKey}. Cannot close position.`, { autoClose: 10000 });
            setClosingPositionId(null);
            return;
          }
        }
        
        const currentPriceBeforeUpdate = Number(pairConfigBeforeUpdate.currentPrice) / 1e8;
        const lastUpdateTimeBeforeUpdate = Number(pairConfigBeforeUpdate.lastUpdateTime);
        const currentTime = Math.floor(Date.now() / 1000);
        const timeSinceUpdateBefore = currentTime - lastUpdateTimeBeforeUpdate;
        const PRICE_STALENESS_SECONDS = 300; // 5 minutes (contract constant)

        console.log('[OpenPositions] Price check from contract:', {
          contractPrice: currentPriceBeforeUpdate,
          timeSinceUpdate: `${timeSinceUpdateBefore}s`,
          isStale: timeSinceUpdateBefore > PRICE_STALENESS_SECONDS,
          lastUpdateTime: lastUpdateTimeBeforeUpdate
        });

        // Check if price is stale - contract requires price to be < 5 minutes old
        // Backend service updates prices every 20 seconds, so prices should be fresh
        // If price is stale, we cannot close position (same as position opening)
        if (timeSinceUpdateBefore > PRICE_STALENESS_SECONDS) {
          const staleMinutes = Math.floor(timeSinceUpdateBefore / 60);
          const errorMsg = `Price is too stale (${staleMinutes} minutes old). Contract requires price to be less than 5 minutes old. Please wait for backend service to update the price, or try again in a moment.`;
          console.error('[OpenPositions] Price is too stale for contract:', {
            lastUpdateTime: lastUpdateTimeBeforeUpdate,
            timeSinceUpdate: timeSinceUpdateBefore,
            staleMinutes: staleMinutes,
            contractRequirement: '5 minutes'
          });
          toast.error(errorMsg, { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }

        // Use contract's current price (no need to update - backend service handles it)
        console.log('[OpenPositions] Using contract price for closing position:', {
          price: currentPriceBeforeUpdate,
          timeSinceUpdate: `${timeSinceUpdateBefore}s`,
          isFresh: timeSinceUpdateBefore <= PRICE_STALENESS_SECONDS
        });
      } catch (priceCheckError: any) {
        console.error('[OpenPositions] Error checking price from contract:', priceCheckError);
        toast.error(`Failed to check price from contract: ${priceCheckError.message || 'Unknown error'}. Cannot close position.`, { autoClose: 10000 });
        setClosingPositionId(null);
        return;
      }

      // Close the position - estimate gas first to ensure we have enough
      let tx;
      try {
        // MANUAL PRE-CHECKS BEFORE GAS ESTIMATION (to get better revert reasons)
        const positionCheck = await contractReadOnly.positions(positionId);
        if (!positionCheck.isOpen) {
          toast.error('Position is already closed.', { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }
        if (positionCheck.trader.toLowerCase() !== account.toLowerCase()) {
          toast.error('You are not the owner of this position.', { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }
        // Re-check price staleness using contract's current price
        let pairConfigCurrent;
        try {
          pairConfigCurrent = await contractReadOnly.pairs(actualPairKey);
        } catch (pairError: any) {
          // If contract.pairs fails, use the previous pairConfigBeforeUpdate as fallback
          console.warn('[OpenPositions] pairs() call failed in pre-close check, using previous config:', pairError);
          pairConfigCurrent = pairConfigBeforeUpdate;
        }
        
        const lastUpdateTimeCurrent = Number(pairConfigCurrent.lastUpdateTime);
        const currentTimeCurrent = Math.floor(Date.now() / 1000);
        const timeSinceUpdateCurrent = currentTimeCurrent - lastUpdateTimeCurrent;
        const PRICE_STALENESS_SECONDS = 300; // 5 minutes

        console.log('[OpenPositions] Pre-close check (position & price):', {
          positionId: positionId.toString(),
          isOpen: positionCheck.isOpen,
          trader: positionCheck.trader,
          account: account,
          isOwner: positionCheck.trader.toLowerCase() === account.toLowerCase(),
          pairKey: positionCheck.pairKey,
          lastUpdateTime: lastUpdateTimeCurrent,
          currentTime: currentTimeCurrent,
          timeSinceUpdate: `${timeSinceUpdateCurrent}s`,
          isStale: timeSinceUpdateCurrent > PRICE_STALENESS_SECONDS,
          isLong: isLong,
          direction: direction
        });

        if (timeSinceUpdateCurrent > PRICE_STALENESS_SECONDS) {
          toast.error('Price is too stale even after update. Please refresh and try again.', { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }

        // Try to call the function directly (static call) to get better error message
        try {
          // Use staticCall (ethers v6) to simulate the transaction and get revert reason
          await contract.closePositionWithDirection.staticCall(positionId, isLong);
        } catch (staticCallError: any) {
          console.error('[OpenPositions] Static call failed (this helps identify the issue):', staticCallError);
          let staticErrorMsg = 'Unknown error';
          if (staticCallError.reason) {
            staticErrorMsg = staticCallError.reason;
          } else if (staticCallError.data) {
            try {
              const iface = contract.interface;
              // Try to decode as Error(string) first
              try {
                const reason = iface.decodeErrorResult('Error(string)', staticCallError.data);
                if (reason && reason[0]) {
                  staticErrorMsg = reason[0];
                }
              } catch (e) {
                // Try parseError for custom errors
                const decodedError = iface.parseError(staticCallError.data);
                if (decodedError) {
                  staticErrorMsg = decodedError.name + (decodedError.args.length > 0 ? ': ' + decodedError.args.join(', ') : '');
                }
              }
            } catch (decodeErr) {
              staticErrorMsg = `Contract reverted: ${staticCallError.data.substring(0, 100)}...`;
            }
          } else if (staticCallError.message) {
            staticErrorMsg = staticCallError.message;
          }
          toast.error(`Cannot close position: ${staticErrorMsg}`, { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }

        // Estimate gas for closePositionWithDirection
        let closeGasLimit: bigint;
        try {
          closeGasLimit = await contract.closePositionWithDirection.estimateGas(positionId, isLong);
          closeGasLimit = (closeGasLimit * BigInt(130)) / BigInt(100); // Add 30% buffer
          console.log('[OpenPositions] Gas estimate for closePositionWithDirection:', closeGasLimit.toString());
        } catch (estimateError: any) {
          console.error('[OpenPositions] closePositionWithDirection gas estimation failed:', estimateError);
          if (process.env.NODE_ENV === 'development') {
            console.error('[OpenPositions] Full error object:', JSON.stringify(estimateError, null, 2));
          }
          let errorMsg = 'Unknown error during gas estimation';
          if (estimateError.reason) {
            errorMsg = estimateError.reason;
          } else if (estimateError.message?.includes('missing revert data')) {
            errorMsg = 'RPC connection issue. Please check your network connection and try again.';
          } else if (estimateError.data) {
            try {
              const iface = contract.interface;
              // Try to decode as Error(string)
              try {
                const reason = iface.decodeErrorResult('Error(string)', estimateError.data);
                if (reason && reason[0]) {
                  errorMsg = reason[0];
                }
              } catch (e) {
                // Try parseError for custom errors
                try {
                  const decodedError = iface.parseError(estimateError.data);
                  if (decodedError) {
                    errorMsg = decodedError.name + (decodedError.args.length > 0 ? ': ' + decodedError.args.join(', ') : '');
                  }
                } catch (parseErr) {
                  // If parsing fails, use a generic message
                  errorMsg = 'Contract reverted during gas estimation. Please check position status and try again.';
                }
              }
            } catch (decodeErr) {
              // Fallback to raw data or message if decoding fails
              errorMsg = `Contract reverted: ${estimateError.data.substring(0, 100)}...` || estimateError.message;
            }
          } else if (estimateError.message) {
            errorMsg = estimateError.message;
          }
          toast.error(`Cannot close position (gas estimation): ${errorMsg}`, { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }
        
        // Send transaction for closePositionWithDirection
        tx = await contract.closePositionWithDirection(positionId, isLong, {
          gasLimit: closeGasLimit
        });
        
        toast.info('Close position transaction submitted, waiting for confirmation...', { autoClose: 5000 });
        
        // Wait for transaction confirmation - CRITICAL for position closing
        let receipt;
        try {
          receipt = await Promise.race([
            tx.wait(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timeout')), 60000))
          ]);
          
          // Check if transaction was successful
          if (receipt && receipt.status === 0) {
            toast.error('Transaction failed. Position was not closed.', { autoClose: 10000 });
            setClosingPositionId(null);
            return;
          }
          
          toast.success('Position closed successfully!');
        } catch (waitError: any) {
          console.error('[OpenPositions] Close transaction wait failed:', waitError);
          
          // Try to get receipt from transaction hash
          if (tx.hash && provider) {
            try {
              await new Promise(resolve => setTimeout(resolve, 10000)); // Longer wait for Privy
              receipt = await provider.getTransactionReceipt(tx.hash);
              if (receipt && receipt.status === 1) {
                toast.success('Position closed successfully (receipt confirmed)! ');
              } else {
                toast.error('Close position transaction failed or not found. Please check your wallet.', { autoClose: 10000 });
                setClosingPositionId(null);
                return;
              }
            } catch (receiptError) {
              console.error('[OpenPositions] Could not get receipt for close transaction:', receiptError);
              toast.error('Close transaction submitted but confirmation failed. Please check your wallet or try again.', { autoClose: 10000 });
              setClosingPositionId(null);
              return;
            }
          } else {
            toast.error('Close transaction submission failed. Please try again.', { autoClose: 10000 });
            setClosingPositionId(null);
            return;
          }
        }
        
        // If no receipt, fail
        if (!receipt) {
          toast.error('Transaction confirmation failed. Please try again.', { autoClose: 10000 });
          setClosingPositionId(null);
          return;
        }
        
        // Remove position direction from localStorage
        const stored = localStorage.getItem('shadefx_position_directions');
        if (stored) {
          try {
            const directions: Record<string, 'long' | 'short'> = JSON.parse(stored);
            delete directions[positionId.toString()];
            localStorage.setItem('shadefx_position_directions', JSON.stringify(directions));
          } catch (e) {
            console.error('Error removing position direction:', e);
          }
        }
        
        // Remove stop loss
        removeStopLoss(positionId);
        stopLossCheckRef.current.delete(positionId);
        
        // Reload positions
        if (loadOpenPositionsRef.current) {
          await loadOpenPositionsRef.current();
        }
      } catch (err: any) {
        console.error('[OpenPositions] Error in handleClosePosition (close position catch):', err);
        let errorMessage = 'Failed to close position';
        if (err.reason) {
          errorMessage = err.reason;
        } else if (err.message) {
          errorMessage = err.message;
        } else if (err.error?.message) {
          errorMessage = err.error.message;
        } else if (err.error?.reason) {
          errorMessage = err.error.reason;
        } else if (err.data?.message) {
          errorMessage = err.data.message;
        }
        
        // Only show critical errors if not already handled by inner catches
        if (closingPositionId === positionId) { // Check if we are still in the process of closing this position
          if (!errorMessage.includes('price too stale') && 
              !errorMessage.includes('position not open') &&
              !errorMessage.includes('not position owner')) {
            toast.error(`Error: ${errorMessage}`, { autoClose: 10000 });
          }
        }
      }
    } catch (err: any) {
      console.error('[OpenPositions] Error in handleClosePosition (outer catch):', err);
      let errorMessage = 'Failed to close position';
      if (err.reason) {
        errorMessage = err.reason;
      } else if (err.message) {
        errorMessage = err.message;
      } else if (err.error?.message) {
        errorMessage = err.error.message;
      } else if (err.error?.reason) {
        errorMessage = err.error.reason;
      } else if (err.data?.message) {
        errorMessage = err.data.message;
      }
      
      // Only show critical errors if not already handled by inner catches
      if (closingPositionId === positionId) {
        if (!errorMessage.includes('price too stale') && 
            !errorMessage.includes('position not open') &&
            !errorMessage.includes('not position owner')) {
          toast.error(`Error: ${errorMessage}`, { autoClose: 10000 });
        }
      }
    } finally {
      setClosingPositionId(null);
    }
  };

  const calculatePnL = (position: Position, currentPrice: bigint, direction?: 'long' | 'short', fees?: { openingFeeBP: number; closingFeeBP: number }): { pnl: number; pnlPercent: number; isProfit: boolean } => {
    // Scale values correctly - match contract calculation exactly
    // Prices are in PRICE_PRECISION (1e8)
    const PRICE_PRECISION = 1e8;
    const entryPriceBigInt = position.entryPrice;
    const currentPriceBigInt = currentPrice;
    
    // USDC amounts are in 6 decimals
    const USDC_DECIMALS = 1e6;
    const sizeBigInt = position.size;
    const collateral = Number(position.collateral) / USDC_DECIMALS;
    const openingFeeBigInt = position.openingFee || BigInt(0);

    // Calculate PnL using contract's exact formula: (priceDiff * size) / entryPrice
    // Contract formula: pnl = int256((priceDiff * position.size) / position.entryPrice) - openingFee
    let pnlBigInt: bigint;
    
    if (direction === 'long') {
      // Long: profit when currentPrice > entryPrice
      if (currentPriceBigInt > entryPriceBigInt) {
        const priceDiff = currentPriceBigInt - entryPriceBigInt;
        pnlBigInt = (priceDiff * sizeBigInt) / entryPriceBigInt;
      } else {
        const priceDiff = entryPriceBigInt - currentPriceBigInt;
        pnlBigInt = -(priceDiff * sizeBigInt) / entryPriceBigInt;
      }
    } else if (direction === 'short') {
      // Short: profit when currentPrice < entryPrice
      if (currentPriceBigInt < entryPriceBigInt) {
        const priceDiff = entryPriceBigInt - currentPriceBigInt;
        pnlBigInt = (priceDiff * sizeBigInt) / entryPriceBigInt;
      } else {
        const priceDiff = currentPriceBigInt - entryPriceBigInt;
        pnlBigInt = -(priceDiff * sizeBigInt) / entryPriceBigInt;
      }
    } else {
      // Fallback: if direction is unknown, try both and use the one with larger absolute value
      // Try long first
      let longPnL: bigint;
      if (currentPriceBigInt > entryPriceBigInt) {
        const priceDiff = currentPriceBigInt - entryPriceBigInt;
        longPnL = (priceDiff * sizeBigInt) / entryPriceBigInt;
      } else {
        const priceDiff = entryPriceBigInt - currentPriceBigInt;
        longPnL = -(priceDiff * sizeBigInt) / entryPriceBigInt;
      }
      
      // Try short
      let shortPnL: bigint;
      if (currentPriceBigInt < entryPriceBigInt) {
        const priceDiff = entryPriceBigInt - currentPriceBigInt;
        shortPnL = (priceDiff * sizeBigInt) / entryPriceBigInt;
      } else {
        const priceDiff = currentPriceBigInt - entryPriceBigInt;
        shortPnL = -(priceDiff * sizeBigInt) / entryPriceBigInt;
      }
      
      // Use the one with larger absolute value
      const longPnLAbs = longPnL < 0 ? -longPnL : longPnL;
      const shortPnLAbs = shortPnL < 0 ? -shortPnL : shortPnL;
      pnlBigInt = longPnLAbs > shortPnLAbs ? longPnL : shortPnL;
    }
    
    // Subtract opening fee (contract does this)
    pnlBigInt = pnlBigInt - openingFeeBigInt;
    
    // Convert to number (USDC has 6 decimals)
    const pnl = Number(pnlBigInt) / USDC_DECIMALS;
    const isProfit = pnl > 0;
    
    // Calculate percentage based on collateral
    const pnlPercent = collateral > 0 ? (pnl / collateral) * 100 : 0;

    return { pnl, pnlPercent, isProfit };
  };

  const formatPrice = (price: bigint): string => {
    const priceNum = Number(price) / 1e8; // PRICE_PRECISION = 1e8
    return priceNum.toFixed(4);
  };

  const formatUSDC = (amount: bigint): string => {
    const amountNum = Number(amount) / 1e6; // USDC has 6 decimals
    return amountNum.toFixed(2);
  };

  const formatTime = (timestamp: bigint): string => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString();
  };

  // Calculate liquidation price based on direction (contract uses default long price)
  const calculateLiquidationPrice = (position: Position, direction?: 'long' | 'short'): bigint => {
    // PRICE_PRECISION = 1e8
    const PRICE_PRECISION = BigInt(1e8);
    // MAINTENANCE_MARGIN = 20%
    const MAINTENANCE_MARGIN = 20;
    // marginRatio = (100 - 20) * PRICE_PRECISION / 100 = 80 * PRICE_PRECISION / 100
    const marginRatio = (BigInt(100 - MAINTENANCE_MARGIN) * PRICE_PRECISION) / BigInt(100);
    
    const entryPrice = position.entryPrice;
    const leverage = position.leverage;
    
    // If direction is unknown, return contract's liquidation price
    if (!direction) {
      return position.liquidationPrice;
    }
    
    let liqPrice: bigint;
    if (direction === 'long') {
      // Long: liquidationPrice = entryPrice - (entryPrice * marginRatio) / (leverage * PRICE_PRECISION)
      liqPrice = entryPrice - (entryPrice * marginRatio) / (leverage * PRICE_PRECISION);
    } else {
      // Short: liquidationPrice = entryPrice + (entryPrice * marginRatio) / (leverage * PRICE_PRECISION)
      liqPrice = entryPrice + (entryPrice * marginRatio) / (leverage * PRICE_PRECISION);
    }
    
    return liqPrice;
  };

  if (!isConnected) {
    return (
      <div className="p-4">
        <p className="text-gray-400 text-center text-sm">Please connect your wallet to view open positions</p>
      </div>
    );
  }

  if (loading && positions.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Open Positions</h3>
          <button
            onClick={() => {
              if (loadOpenPositionsRef.current) {
                loadOpenPositionsRef.current();
              }
            }}
            disabled={loading}
            className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <p className="text-gray-400 text-center text-sm py-4">No open positions</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Open Positions</h3>
        <button
          onClick={() => {
            if (loadOpenPositionsRef.current) {
              loadOpenPositionsRef.current();
            }
          }}
          disabled={loading}
          className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {positions.map((position) => {
          // Use CoinGecko price if available, otherwise use entry price (fallback)
          // This ensures PnL is calculated with real-time prices
          const currentPrice = pairPrices[position.pairKey] || position.entryPrice;
          const direction = positionDirections.get(position.positionId);
          
          // Calculate PnL with current price (use entry price if real-time price not available)
          // Always calculate PnL, even if price hasn't loaded yet (will show 0 initially)
          const { pnl, pnlPercent, isProfit } = calculatePnL(position, currentPrice, direction, contractFees || undefined);
          // Recalculate liquidation price based on actual direction
          const actualLiquidationPrice = calculateLiquidationPrice(position, direction);
          // Get stop loss from indexer data (if available) or localStorage
          const indexerStopLoss = stopLossPrices.get(position.positionId);
          const stopLossPrice = getStopLoss(position.positionId, indexerStopLoss);

          return (
            <div
              key={position.positionId.toString()}
              className="bg-dark-900/50 border border-dark-700 rounded-lg p-3 hover:border-dark-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-white font-semibold text-xs">{pairNames[position.pairKey] || position.pairKey}</span>
                    <span className="text-xs text-gray-400">#{position.positionId.toString()}</span>
                    {(() => {
                      const direction = positionDirections.get(position.positionId);
                      if (direction === 'long') {
                        return <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Long</span>;
                      } else if (direction === 'short') {
                        return <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Short</span>;
                      }
                      return null;
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Entry:</span>
                      <span className="text-white">${formatPrice(position.entryPrice)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Current:</span>
                      <span className="text-white">${formatPrice(currentPrice)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Size:</span>
                      <span className="text-white">{formatUSDC(position.size)} USDC</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Leverage:</span>
                      <span className="text-white">{position.leverage.toString()}x</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Collateral:</span>
                      <span className="text-white">{formatUSDC(position.collateral)} USDC</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">Opened:</span>
                      <span className="text-white text-xs">{formatTime(position.timestamp)}</span>
                    </div>
                  </div>
                </div>
                <div className="ml-4 text-right">
                  <div className={`text-sm font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {isProfit ? '+' : ''}${pnl.toFixed(2)} USDC
                  </div>
                  <div className={`text-xs ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    ({isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%)
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-dark-700">
                <div className="text-xs text-gray-400">
                  <span>Liquidation: </span>
                  <span className="text-yellow-400">${formatPrice(actualLiquidationPrice)}</span>
                </div>
                <div className="flex gap-2">
                  {direction && (
                    <button
                      onClick={() => {
                        const oppositeDirection = direction === 'long' ? 'short' : 'long';
                        handleHedgePosition(position, oppositeDirection);
                      }}
                      disabled={!fhevmReady || loading || hedgingPositionId === position.positionId}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                      title="Open opposite position with same size"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <span>{hedgingPositionId === position.positionId ? 'Opening...' : 'Hedge'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleClosePosition(position.positionId)}
                    disabled={closingPositionId === position.positionId}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {closingPositionId === position.positionId ? (
                      <>
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Closing...</span>
                      </>
                    ) : (
                      <>
                        <XMarkIcon className="h-3 w-3" />
                        <span>Close</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OpenPositions;

