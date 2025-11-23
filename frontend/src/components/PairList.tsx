import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { getAllPairs } from '../utils/perpdexContract';
import { getPriceWithFallback } from '../utils/coingeckoApi';
import { convertToBinanceSymbol } from '../utils/binanceWebSocket';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface PairInfo {
  pairKey: string;
  displayName: string;
  isActive: boolean;
  price: number | null; // Binance price
}

interface PairListProps {
  selectedPair?: string;
  onPairSelect?: (pairKey: string) => void;
}

const PairList: React.FC<PairListProps> = ({ selectedPair, onPairSelect }) => {
  const { provider, isConnected } = useWallet();
  const [pairs, setPairs] = useState<PairInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const priceUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isConnected && provider) {
      loadPairs();
    }
  }, [isConnected, provider]);

  useEffect(() => {
    if (pairs.length > 0) {
      // Update prices every 30 seconds from Binance (reduced frequency to avoid timeout)
      priceUpdateIntervalRef.current = setInterval(() => {
        updatePrices();
      }, 30000); // 30 seconds instead of 5 seconds
      
      return () => {
        if (priceUpdateIntervalRef.current) {
          clearInterval(priceUpdateIntervalRef.current);
        }
      };
    }
  }, [pairs.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadPairs = async () => {
    try {
      setLoading(true);
      
      // Load pairs from contract (not from indexer)
      if (!provider) {
        setPairs([]);
        return;
      }
      
      const contractPairs = await getAllPairs(provider);
      
      // First, set pairs with contract prices (immediate display)
      const pairsWithContractPrices: PairInfo[] = contractPairs.map((pair) => {
        const displayName = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
        return {
          pairKey: pair.pairKey,
          displayName: displayName,
          isActive: pair.config.isActive,
          price: Number(pair.config.currentPrice) / 1e8, // Use contract price initially
        };
      });
      
      setPairs(pairsWithContractPrices);
      
      // Then, update prices from Binance in batches (to avoid timeout)
      const BATCH_SIZE = 3; // Process 3 pairs at a time
      const pairsWithBinancePrices: PairInfo[] = [];
      
      for (let i = 0; i < contractPairs.length; i += BATCH_SIZE) {
        const batch = contractPairs.slice(i, i + BATCH_SIZE);
        
        const batchResults = await Promise.allSettled(
          batch.map(async (pair) => {
            const displayName = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
            try {
              // Use contract's coingeckoId if available for better consistency
              const result = await getPriceWithFallback(displayName, pair.config.coingeckoId || undefined);
              return {
                pairKey: pair.pairKey,
                displayName: displayName,
                isActive: pair.config.isActive,
                price: result.price,
              };
            } catch (err) {
              console.warn(`[PairList] Could not load price for ${displayName}:`, err);
              // Use contract price as fallback
              return {
                pairKey: pair.pairKey,
                displayName: displayName,
                isActive: pair.config.isActive,
                price: Number(pair.config.currentPrice) / 1e8,
              };
            }
          })
        );
        
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            pairsWithBinancePrices.push(result.value);
          } else {
            // If batch failed, use contract price
            const pair = batch[batchResults.indexOf(result)];
            if (pair) {
              const displayName = `${pair.config.baseCurrency}${pair.config.quoteCurrency}`;
              pairsWithBinancePrices.push({
                pairKey: pair.pairKey,
                displayName: displayName,
                isActive: pair.config.isActive,
                price: Number(pair.config.currentPrice) / 1e8,
              });
            }
          }
        });
        
        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < contractPairs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      setPairs(pairsWithBinancePrices);
    } catch (err: any) {
      console.error('Error loading pairs:', err);
    } finally {
      setLoading(false);
    }
  };

  const updatePrices = async () => {
    if (pairs.length === 0 || !provider) return;
    
    try {
      // Load contract pairs to get coingeckoId
      const contractPairs = await getAllPairs(provider);
      
      // Create a map for quick lookup
      const pairConfigMap = new Map<string, string | undefined>();
      for (const pair of contractPairs) {
        pairConfigMap.set(pair.pairKey, pair.config.coingeckoId || undefined);
      }
      
      // Update prices in batches to avoid timeout
      const BATCH_SIZE = 3;
      const updatedPairs = [...pairs];
      
      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        
        await Promise.allSettled(
          batch.map(async (pair, index) => {
            if (!pair.displayName || pair.displayName.includes('...')) return;
            
            try {
              // Get coingeckoId from contract pairs map
              const coingeckoId = pairConfigMap.get(pair.pairKey);
              // Use contract's coingeckoId if available for better consistency
              const result = await getPriceWithFallback(pair.displayName, coingeckoId);
              updatedPairs[i + index] = { ...pair, price: result.price };
            } catch (err) {
              // Keep existing price on error
              console.warn(`[PairList] Could not update price for ${pair.displayName}:`, err);
            }
          })
        );
        
        // Small delay between batches
        if (i + BATCH_SIZE < pairs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      setPairs(updatedPairs);
    } catch (err) {
      console.warn('[PairList] Error updating prices:', err);
    }
  };

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'N/A';
    return price.toFixed(4);
  };

  const selectedPairInfo = pairs.find(p => p.pairKey === selectedPair);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-dark-800/50 border border-dark-700 rounded-lg px-4 py-2.5 flex items-center justify-between hover:bg-dark-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-white font-medium text-sm">
            {selectedPairInfo ? selectedPairInfo.displayName : 'Select Pair'}
          </span>
          {selectedPairInfo && selectedPairInfo.isActive && (
            <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Active</span>
          )}
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-dark-900/95 backdrop-blur-xl border border-dark-700 rounded-lg shadow-2xl z-50 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-gray-400 text-sm text-center">Loading pairs...</div>
          ) : pairs.length === 0 ? (
            <div className="p-4 text-gray-400 text-sm text-center">No pairs available</div>
          ) : (
            <div className="py-2">
              {pairs.map((pair) => (
                <button
                  key={pair.pairKey}
                  onClick={() => {
                    onPairSelect?.(pair.pairKey);
                    setIsOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left hover:bg-dark-800 transition-colors flex items-center justify-between ${
                    selectedPair === pair.pairKey
                      ? 'bg-primary-500/10 border-l-2 border-primary-500'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{pair.displayName}</span>
                    {pair.isActive ? (
                      <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Active</span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded">Inactive</span>
                    )}
                  </div>
                  {pair.price !== null && (
                    <span className="text-xs text-gray-400">${formatPrice(pair.price)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PairList;
