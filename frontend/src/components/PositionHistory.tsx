import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getPerpDEXContract, Position, getContractFees, calculateFee } from '../utils/perpdexContract';
import { getUserClosedPositions, checkIndexerHealth, getCurrencyPairsByKeys } from '../utils/envio';
import { getPositionDirections, storePositionDirection } from '../utils/positionDirection';
import { toast } from 'react-toastify';

interface PositionHistoryProps {
  pairKey?: string;
  refreshTrigger?: number;
}

const PositionHistory: React.FC<PositionHistoryProps> = ({ pairKey, refreshTrigger }) => {
  const { account, provider, isConnected } = useWallet();
  const [contractFees, setContractFees] = useState<{ openingFeeBP: number; closingFeeBP: number } | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [pairPrices, setPairPrices] = useState<Record<string, bigint>>({});
  const [positionDirections, setPositionDirections] = useState<Map<bigint, 'long' | 'short'>>(new Map());
  const [pairKeyToDisplayName, setPairKeyToDisplayName] = useState<Record<string, string>>({});
  const [exitPrices, setExitPrices] = useState<Record<string, bigint>>({});
  const [indexerPositionsData, setIndexerPositionsData] = useState<Array<{positionId: string; pnl: string | null; exitPrice: string | null; direction: string | null}>>([]);
  
  // Load exitPrices from localStorage (fallback when indexer is not available)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('shadefx_position_exit_prices');
      if (stored) {
        const exitPricesMap: Record<string, bigint> = {};
        const parsed = JSON.parse(stored);
        for (const [positionId, exitPrice] of Object.entries(parsed)) {
          exitPricesMap[positionId] = BigInt(exitPrice as string);
        }
        setExitPrices(exitPricesMap);
        console.log('[PositionHistory] Loaded exitPrices from localStorage:', Object.keys(exitPricesMap).length);
      }
    } catch (e) {
      console.error('[PositionHistory] Error loading exitPrices from localStorage:', e);
    }
  }, []);

  // Load contract fees on mount and when provider changes
  useEffect(() => {
    if (provider) {
      getContractFees(provider).then(setContractFees).catch(err => {
        console.warn('[PositionHistory] Could not load contract fees:', err);
        setContractFees({ openingFeeBP: 0, closingFeeBP: 25 }); // Use defaults
      });
    }
  }, [provider]);

  useEffect(() => {
    if (isConnected && account && provider) {
      loadPositionHistory();
    } else {
      setPositions([]);
    }
  }, [isConnected, account, provider, refreshTrigger]);

  const loadPositionHistory = async () => {
    if (!provider || !account) return;

    try {
      setLoading(true);
      
      const indexerAvailable = await checkIndexerHealth();
      
      if (indexerAvailable) {
        console.log('[PositionHistory] Loading closed positions from indexer for:', account);
        const indexerPositions = await getUserClosedPositions(account, undefined, 200);
        
        // Store indexer positions data for PnL and direction lookup
        const indexerData = indexerPositions.map(pos => ({
          positionId: pos.positionId,
          pnl: pos.pnl,
          exitPrice: pos.exitPrice,
          direction: pos.direction, // Include direction from indexer
        }));
        setIndexerPositionsData(indexerData);
        
        const exitPricesMap: Record<string, bigint> = {};
        const closedPositions: Position[] = indexerPositions.map(pos => {
          const positionIdStr = pos.positionId;
          if (pos.exitPrice) {
            exitPricesMap[positionIdStr] = BigInt(pos.exitPrice);
          }
          return {
            positionId: BigInt(pos.positionId),
            trader: account!,
            pairKey: pos.pairKey,
            entryPrice: BigInt(pos.entryPrice),
            size: BigInt(pos.size),
            collateral: BigInt(pos.collateral),
            leverage: BigInt(pos.leverage),
            timestamp: BigInt(pos.timestamp),
            isOpen: false,
            liquidationPrice: BigInt(pos.liquidationPrice),
            openingFee: BigInt(pos.openingFee),
            closingFee: BigInt(pos.closingFee),
          };
        });
        
        console.log('[PositionHistory] Loaded closed positions from indexer:', closedPositions.length);
        
        const prices: Record<string, bigint> = {};
        const pairKeyToDisplayNameMap: Record<string, string> = {};
        
        const allPairKeys = Array.from(new Set(closedPositions.map(pos => pos.pairKey)));
        
        // Load pair names from indexer (faster)
        if (allPairKeys.length > 0) {
          try {
            const currencyPairs = await getCurrencyPairsByKeys(allPairKeys);
            
            currencyPairs.forEach(pair => {
              const displayName = `${pair.baseCurrency}${pair.quoteCurrency}`;
              pairKeyToDisplayNameMap[pair.pairKey] = displayName;
            });
            
            // For any pairKeys not found in indexer, try contract as fallback
            for (const pairKeyHash of allPairKeys) {
              if (!pairKeyToDisplayNameMap[pairKeyHash]) {
                try {
                  const contract = await getPerpDEXContract(provider);
                  const { getAllPairs } = await import('../utils/perpdexContract');
                  const allPairs = await getAllPairs(provider);
                  
                  for (const pair of allPairs) {
                    const hash = ethers.keccak256(ethers.toUtf8Bytes(pair.pairKey));
                    if (hash.toLowerCase() === pairKeyHash.toLowerCase()) {
                      pairKeyToDisplayNameMap[pairKeyHash] = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
                      break;
                    }
                  }
                  
                  // Last resort: try direct contract call
                  if (!pairKeyToDisplayNameMap[pairKeyHash]) {
                    const pairConfig = await contract.pairs(pairKeyHash);
                    if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                      pairKeyToDisplayNameMap[pairKeyHash] = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                    } else {
                      pairKeyToDisplayNameMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
                    }
                  }
                } catch (err: any) {
                  pairKeyToDisplayNameMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
                }
              }
            }
          } catch (err) {
            console.error('[PositionHistory] Error loading pair names from indexer:', err);
            // Last resort: use truncated pairKey
            allPairKeys.forEach(pairKey => {
              if (!pairKeyToDisplayNameMap[pairKey]) {
                pairKeyToDisplayNameMap[pairKey] = pairKey.substring(0, 8) + '...';
              }
            });
          }
        }
        
        // Load prices from CoinGecko Pro API (real-time)
        // Optimize: collect unique pairs first, then fetch prices once per pair
        if (allPairKeys.length > 0) {
          try {
            const { getPriceWithFallback } = await import('../utils/coingeckoApi');
            const uniquePairs = new Set<string>();
            const pairKeyHashToDisplayNameMap: Record<string, string> = {};
            
            // Collect unique pairs
            for (const pairKeyHash of allPairKeys) {
              const displayName = pairKeyToDisplayNameMap[pairKeyHash];
              if (displayName && !displayName.includes('...') && !uniquePairs.has(displayName)) {
                uniquePairs.add(displayName);
                pairKeyHashToDisplayNameMap[displayName] = pairKeyHash;
              }
            }
            
            // Fetch prices for unique pairs only (cache will handle duplicates)
            const pricePromises = Array.from(uniquePairs).map(async (displayName) => {
              try {
                const result = await getPriceWithFallback(displayName);
                // Convert to contract price format (PRICE_PRECISION = 1e8)
                if (result.price && !isNaN(result.price) && isFinite(result.price) && result.price > 0) {
                  const pairKeyHash = pairKeyHashToDisplayNameMap[displayName];
                  if (pairKeyHash) {
                    prices[pairKeyHash] = BigInt(Math.floor(result.price * 1e8));
                  }
                }
              } catch (err) {
                console.warn(`[PositionHistory] Could not load price for ${displayName}:`, err);
                // Fallback to contract price if both APIs fail
                try {
                  const contract = await getPerpDEXContract(provider);
                  const pairConfig = await contract.pairs(displayName);
                  if (pairConfig && pairConfig.currentPrice) {
                    const pairKeyHash = pairKeyHashToDisplayNameMap[displayName];
                    if (pairKeyHash) {
                      prices[pairKeyHash] = pairConfig.currentPrice;
                    }
                  }
                } catch (contractErr) {
                  // Skip if all fail
                }
              }
            });
            
            await Promise.allSettled(pricePromises);
            
            // Apply prices to all pairKeys with the same displayName
            for (const pairKeyHash of allPairKeys) {
              const displayName = pairKeyToDisplayNameMap[pairKeyHash];
              if (displayName && !displayName.includes('...') && !prices[pairKeyHash]) {
                // Try to get from another pairKey with same displayName
                const matchingPairKey = allPairKeys.find(pk => pairKeyToDisplayNameMap[pk] === displayName && prices[pk]);
                if (matchingPairKey) {
                  prices[pairKeyHash] = prices[matchingPairKey];
                }
              }
            }
          } catch (err) {
            console.error('[PositionHistory] Error loading prices from CoinGecko:', err);
          }
        }
        
        // Load directions from localStorage - same approach as OpenPositions
        const loadedPositionIds: bigint[] = closedPositions.map(p => p.positionId);
        console.log('[PositionHistory] Loading directions for position IDs (indexer):', loadedPositionIds.map(id => id.toString()));
        console.log('[PositionHistory] Position ID details:', closedPositions.map(p => ({ 
          id: p.positionId.toString(), 
          type: typeof p.positionId,
          isBigInt: typeof p.positionId === 'bigint'
        })));
        
        const directions = getPositionDirections(loadedPositionIds);
        console.log('[PositionHistory] Loaded directions from localStorage (indexer):', Array.from(directions.entries()).map(([id, dir]) => ({ id: id.toString(), direction: dir })));
        
        // Check localStorage directly for debugging
        try {
          const stored = localStorage.getItem('shadefx_position_directions');
          if (stored) {
            const storedDirections: Record<string, 'long' | 'short'> = JSON.parse(stored);
            console.log('[PositionHistory] All stored direction keys in localStorage:', Object.keys(storedDirections));
            console.log('[PositionHistory] Looking for these position IDs:', loadedPositionIds.map(id => id.toString()));
            
            // Check each position ID individually
            loadedPositionIds.forEach(id => {
              const idStr = id.toString();
              const found = storedDirections[idStr];
              console.log(`[PositionHistory] Position ${idStr}: ${found ? `Found direction: ${found}` : 'NOT FOUND in localStorage'}`);
            });
          } else {
            console.log('[PositionHistory] No directions stored in localStorage');
          }
        } catch (err) {
          console.error('[PositionHistory] Error checking localStorage:', err);
        }
        
        setPositions(closedPositions);
        setPairPrices(prices);
        setPositionDirections(directions);
        setPairKeyToDisplayName(pairKeyToDisplayNameMap);
        setExitPrices(exitPricesMap);
        return;
      }
      
      console.log('[PositionHistory] Indexer not available, loading from contract for:', account);
      
      // Try to get indexer data even if indexer health check failed (might be temporary issue)
      let indexerData: Array<{positionId: string; pnl: string | null; exitPrice: string | null; direction: string | null}> = [];
      try {
        const indexerPositions = await getUserClosedPositions(account, undefined, 200);
        indexerData = indexerPositions.map(pos => ({
          positionId: pos.positionId,
          pnl: pos.pnl,
          exitPrice: pos.exitPrice,
          direction: pos.direction, // Include direction from indexer
        }));
        setIndexerPositionsData(indexerData);
      } catch (err) {
        console.warn('[PositionHistory] Could not load indexer data for PnL:', err);
      }
      
      const contract = await getPerpDEXContract(provider);
      
      let positionIds: bigint[] = [];
      try {
        positionIds = await contract.getUserPositions(account);
        console.log('[PositionHistory] Found position IDs:', positionIds.map(id => id.toString()));
      } catch (err: any) {
        console.error('[PositionHistory] Error getting user positions:', err);
        setPositions([]);
        setPairPrices({});
        setLoading(false);
        return;
      }
      
      const allPositions: Position[] = [];
      const prices: Record<string, bigint> = {};

      for (const positionId of positionIds) {
        try {
          const position = await contract.positions(positionId);
          allPositions.push({
            positionId: position.positionId,
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

          if (!prices[position.pairKey]) {
            try {
              const pairConfig = await contract.pairs(position.pairKey);
              if (pairConfig && pairConfig.currentPrice) {
                prices[position.pairKey] = pairConfig.currentPrice;
              }
            } catch (err: any) {
              if (process.env.NODE_ENV === 'development') {
                console.warn(`[PositionHistory] Could not load price for pair ${position.pairKey}:`, err.message || err);
              }
            }
          }
        } catch (err) {
          console.error(`Error loading position ${positionId}:`, err);
        }
      }

      allPositions.sort((a, b) => {
        const timeA = Number(a.timestamp);
        const timeB = Number(b.timestamp);
        return timeB - timeA;
      });

      console.log('[PositionHistory] Loaded positions:', allPositions.length);
      
      const pairKeyToDisplayNameMap: Record<string, string> = {};
      const allPairKeys = new Set<string>();
      allPositions.forEach(pos => allPairKeys.add(pos.pairKey));
      
      // Load pair names from contract (primary source for contract fallback)
      if (allPairKeys.size > 0 && provider) {
        try {
          // Load all active pairs from contract and create hash -> name mapping
          const { getAllPairs } = await import('../utils/perpdexContract');
          const allPairs = await getAllPairs(provider);
          
          // Create mapping: hash(pairKey) -> { baseCurrency, quoteCurrency }
          const pairKeyToInfo = new Map<string, { baseCurrency: string; quoteCurrency: string }>();
          
          for (const pair of allPairs) {
            // Hash the pairKey string to match indexer format
            const pairKeyHash = ethers.keccak256(ethers.toUtf8Bytes(pair.pairKey));
            pairKeyToInfo.set(pairKeyHash.toLowerCase(), {
              baseCurrency: pair.config.baseCurrency,
              quoteCurrency: pair.config.quoteCurrency,
            });
          }
          
          // Map indexer pairKeys (hashes) to contract pair info
          for (const pairKeyHash of Array.from(allPairKeys)) {
            const pairInfo = pairKeyToInfo.get(pairKeyHash.toLowerCase());
            if (pairInfo) {
              const displayName = `${pairInfo.baseCurrency}${pairInfo.quoteCurrency}`;
              pairKeyToDisplayNameMap[pairKeyHash] = displayName;
              console.log(`[PositionHistory] Contract fallback: Loaded pair ${displayName} for ${pairKeyHash.substring(0, 8)}...`);
            } else {
              // Fallback: try direct contract call
              try {
                const pairConfig = await contract.pairs(pairKeyHash);
                if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                  const displayName = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                  pairKeyToDisplayNameMap[pairKeyHash] = displayName;
                } else {
                  pairKeyToDisplayNameMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
                }
              } catch (err: any) {
                pairKeyToDisplayNameMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
              }
            }
          }
        } catch (err) {
          console.error('[PositionHistory] Error loading pair names from contract:', err);
          // Last resort: use truncated pairKey
          Array.from(allPairKeys).forEach(pairKey => {
            pairKeyToDisplayNameMap[pairKey] = pairKey.substring(0, 8) + '...';
          });
        }
      }
      
      const loadedPositionIds: bigint[] = allPositions.map(p => p.positionId);
      console.log('[PositionHistory] Loading directions for position IDs (contract):', loadedPositionIds.map(id => id.toString()));
      
      // Try to recover directions from OrderExecuted events if not found in localStorage
      const directions = getPositionDirections(loadedPositionIds);
      console.log('[PositionHistory] Loaded directions from localStorage (contract):', Array.from(directions.entries()).map(([id, dir]) => ({ id: id.toString(), direction: dir })));
      
      // Check if we need to recover directions from past OrderExecuted events
      const missingDirections = loadedPositionIds.filter(id => !directions.has(id));
      if (missingDirections.length > 0 && provider) {
        console.log('[PositionHistory] Attempting to recover directions for positions (contract):', missingDirections.map(id => id.toString()));
        try {
          // Query past OrderExecuted events for these positions
          // Limit to last 10,000 blocks to avoid RPC limit (Privy RPC has 10k block limit)
          const filter = contract.filters.OrderExecuted(null, null, account, null, null);
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 10000); // Last 10,000 blocks
          const events = await contract.queryFilter(filter, fromBlock, 'latest');
          
          // Map orderId -> positionId from events
          const orderToPositionMap = new Map<string, bigint>();
          events.forEach(event => {
            if ('args' in event && event.args) {
              const orderId = event.args.orderId as bigint;
              const positionId = event.args.positionId as bigint;
              orderToPositionMap.set(orderId.toString(), positionId);
            }
          });
          
          // Check if we have order directions stored
          const orderStored = localStorage.getItem('shadefx_order_directions');
          if (orderStored) {
            const orderDirections: Record<string, 'long' | 'short'> = JSON.parse(orderStored);
            orderToPositionMap.forEach((positionId, orderIdStr) => {
              if (missingDirections.includes(positionId) && orderDirections[orderIdStr]) {
                const direction = orderDirections[orderIdStr];
                storePositionDirection(positionId, direction);
                directions.set(positionId, direction);
                console.log(`[PositionHistory] Recovered direction ${direction} for position ${positionId.toString()} from order ${orderIdStr} (contract)`);
              }
            });
          }
        } catch (err: any) {
          // Silently fail - this is a recovery mechanism, not critical
          if (process.env.NODE_ENV === 'development') {
            console.warn('[PositionHistory] Could not recover directions from events (non-critical):', err.message || err);
          }
        }
      }
      
      console.log('[PositionHistory] Final directions (contract):', Array.from(directions.entries()).map(([id, dir]) => ({ id: id.toString(), direction: dir })));
      
      setPositions(allPositions);
      setPairPrices(prices);
      setPositionDirections(directions);
      setPairKeyToDisplayName(pairKeyToDisplayNameMap);
    } catch (err: any) {
      console.error('Error loading position history:', err);
      toast.error(`Failed to load position history: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: bigint): string => {
    const priceNum = Number(price) / 1e8;
    return priceNum.toFixed(4);
  };

  if (!isConnected) {
    return (
      <div className="p-4">
        <p className="text-gray-400 text-center text-sm">Please connect your wallet to view position history</p>
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

  const closedPositions = positions.filter(p => !p.isOpen);

  if (positions.length === 0 || closedPositions.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Position History</h3>
          <button
            onClick={loadPositionHistory}
            disabled={loading}
            className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <p className="text-gray-400 text-center text-sm py-4">
          {positions.length === 0 ? 'No position history' : 'No closed positions'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Position History</h3>
        <button
          onClick={loadPositionHistory}
          disabled={loading}
          className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Compact Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left py-2 px-2 text-gray-400 font-medium">Pair</th>
              <th className="text-left py-2 px-2 text-gray-400 font-medium">Direction</th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">Entry</th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">Exit</th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">Size</th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">Leverage</th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">PnL</th>
            </tr>
          </thead>
          <tbody>
            {closedPositions.map((position) => {
              const entryPrice = typeof position.entryPrice === 'bigint' ? position.entryPrice : BigInt(position.entryPrice);
              const positionId = typeof position.positionId === 'bigint' ? position.positionId : BigInt(position.positionId);
              const positionIdStr = position.positionId.toString();
              
              // Use exitPrice from indexer if available (most accurate)
              // If indexer doesn't have exitPrice, we cannot reliably determine it
              // DO NOT use current price or entry price as fallback - they are incorrect
              const indexerPosition = indexerPositionsData.find(ip => ip.positionId === positionIdStr);
              let exitPrice: bigint;
              
              if (indexerPosition?.exitPrice) {
                // Indexer has exitPrice - use it (this is the actual closing price from contract)
                exitPrice = BigInt(indexerPosition.exitPrice);
              } else if (exitPrices[positionIdStr]) {
                // Fallback: use exitPrice from event listener (if position was closed in this session)
                exitPrice = exitPrices[positionIdStr];
              } else {
                // No exitPrice available - this should not happen for closed positions
                // Use entryPrice as last resort (will show incorrect exit price, but PnL from indexer is still correct)
                console.warn(`[PositionHistory] No exitPrice found for position ${positionIdStr}, using entryPrice as fallback`);
                exitPrice = entryPrice;
              }
              const exitPriceNum = Number(exitPrice) / 1e8;
              const entryPriceNum = Number(entryPrice) / 1e8;
              
              // Try to get direction from indexer first, then from localStorage
              // Do NOT infer direction from price comparison - it's unreliable
              // Direction must be stored when position is opened
              let direction = indexerPosition?.direction || (position as any).direction || positionDirections.get(positionId);
              
              // If direction is still not found, we cannot determine it reliably
              // Leave it as null/undefined - the UI will show "Unknown" or "-"
              
              // Try to use PnL from indexer first (most accurate, includes fees)
              // Indexer Position interface has pnl field, but contract Position doesn't
              // Check if we're using indexer data by checking if position has pnlPercent field
              let pnl = 0;
              let pnlPercent = 0;
              
              // Check if position has pnl from indexer (from envio.ts Position interface)
              if (indexerPosition?.pnl) {
                // Use PnL from indexer (contract-calculated, includes fees)
                pnl = parseFloat(indexerPosition.pnl) / 1e6; // USDC has 6 decimals
                const collateralNum = Number(typeof position.collateral === 'bigint' ? position.collateral : BigInt(position.collateral)) / 1e6;
                pnlPercent = collateralNum > 0 ? (pnl / collateralNum) * 100 : 0;
              } else {
                // Fallback: calculate PnL from direction (with fees)
                // For closed positions, deduct both opening and closing fees
                const openingFeeBP = contractFees?.openingFeeBP ?? 0;
                const closingFeeBP = contractFees?.closingFeeBP ?? 25;
                
                const sizeNum = Number(typeof position.size === 'bigint' ? position.size : BigInt(position.size)) / 1e6;
                const collateralNum = Number(typeof position.collateral === 'bigint' ? position.collateral : BigInt(position.collateral)) / 1e6;
                
                // Calculate fees based on collateral (not position size)
                const collateralBigInt = BigInt(Math.floor(collateralNum * 1e6)); // Convert to 6 decimals
                const openingFee = Number(calculateFee(collateralBigInt, openingFeeBP)) / 1e6;
                const closingFee = Number(calculateFee(collateralBigInt, closingFeeBP)) / 1e6;
                const totalFees = openingFee + closingFee;
                
                if (direction === 'long') {
                  pnl = ((exitPriceNum - entryPriceNum) / entryPriceNum) * sizeNum - totalFees;
                } else if (direction === 'short') {
                  pnl = ((entryPriceNum - exitPriceNum) / entryPriceNum) * sizeNum - totalFees;
                } else {
                  const longPnL = ((exitPriceNum - entryPriceNum) / entryPriceNum) * sizeNum - totalFees;
                  const shortPnL = ((entryPriceNum - exitPriceNum) / entryPriceNum) * sizeNum - totalFees;
                  pnl = Math.abs(longPnL) > Math.abs(shortPnL) ? longPnL : shortPnL;
                }
                
                pnlPercent = collateralNum > 0 ? (pnl / collateralNum) * 100 : 0;
              }
              
              const isProfit = pnl >= 0;
              
              const pairDisplayName = pairKeyToDisplayName[position.pairKey] || position.pairKey?.substring(0, 8) + '...' || 'Unknown';
              
              // Format size and leverage
              const size = typeof position.size === 'bigint' ? position.size : BigInt(position.size);
              const sizeNum = Number(size) / 1e6; // USDC has 6 decimals
              const leverage = typeof position.leverage === 'bigint' ? position.leverage : BigInt(position.leverage);

              return (
                <tr key={position.positionId.toString()} className="border-b border-dark-800/50 hover:bg-dark-900/30 transition-colors">
                  <td className="py-2 px-2 text-white font-medium">{pairDisplayName}</td>
                  <td className="py-2 px-2">
                    {direction ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                        direction === 'long' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {direction === 'long' ? 'Long' : 'Short'}
                      </span>
                    ) : (
                      <span className="text-gray-500 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-white text-right">${formatPrice(entryPrice)}</td>
                  <td className="py-2 px-2 text-white text-right">${formatPrice(exitPrice)}</td>
                  <td className="py-2 px-2 text-white text-right">{sizeNum.toFixed(2)} USDC</td>
                  <td className="py-2 px-2 text-white text-right">{leverage.toString()}x</td>
                  <td className={`py-2 px-2 text-right font-semibold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {isProfit ? '+' : ''}${pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PositionHistory;
