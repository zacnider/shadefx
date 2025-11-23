import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { getAllPairs } from '../utils/perpdexContract';
import { getCoinGeckoPriceWithVolume, convertToCoinGeckoId } from '../utils/coingeckoApi';

interface TickerItem {
  pairKey: string;
  pairName: string;
  price: number;
  change24h: number;
  volume24h: number;
  coingeckoId?: string;
}

interface PriceTickerProps {
  onPairClick?: (pairKey: string) => void;
}

const PriceTicker: React.FC<PriceTickerProps> = ({ onPairClick }) => {
  const { provider } = useWallet();
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const tickerRef = useRef<HTMLDivElement>(null);

  // Load pairs and prices
  useEffect(() => {
    if (!provider) return;
    
    const loadTickerData = async () => {
      try {
        setIsLoading(true);
        const pairs = await getAllPairs(provider, true);
        
        // Filter active pairs and limit to top 20 most liquid
        const activePairs = pairs
          .filter(pair => pair.config?.isActive && pair.config?.baseCurrency)
          .slice(0, 20);

        // Fetch prices and volumes for all pairs
        const tickerData: TickerItem[] = [];
        
        for (const pair of activePairs) {
          try {
            const pairKey = pair.pairKey;
            const pairName = pair.config?.baseCurrency 
              ? `${pair.config.baseCurrency}/USD`
              : pairKey.substring(0, 8) + '...';
            
            // Get CoinGecko ID
            let coinGeckoId: string | undefined = pair.config?.coingeckoId;
            if (!coinGeckoId) {
              // Try to convert from symbol
              const { convertToBinanceSymbol } = await import('../utils/binanceWebSocket');
              const binanceSymbol = convertToBinanceSymbol(pairKey);
              const mappedId = convertToCoinGeckoId(binanceSymbol);
              coinGeckoId = mappedId || undefined;
            }

            if (coinGeckoId) {
              try {
                const { price, change24h, volume24h } = await getCoinGeckoPriceWithVolume(coinGeckoId);
                tickerData.push({
                  pairKey,
                  pairName,
                  price,
                  change24h,
                  volume24h,
                  coingeckoId: coinGeckoId,
                });
              } catch (error) {
                console.warn(`[PriceTicker] Failed to fetch data for ${pairName}:`, error);
              }
            }
          } catch (error) {
            console.warn(`[PriceTicker] Error processing pair ${pair.pairKey}:`, error);
          }
        }

        setTickerItems(tickerData);
        setIsLoading(false);
      } catch (error) {
        console.error('[PriceTicker] Error loading ticker data:', error);
        setIsLoading(false);
      }
    };

    loadTickerData();
    
    // Refresh every 15 seconds
    const interval = setInterval(loadTickerData, 15000);
    
    return () => clearInterval(interval);
  }, [provider]);

  // Format price
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (price >= 1) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    } else {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`;
    }
  };

  // Format volume
  const formatVolume = (volume: number): string => {
    if (volume >= 1e9) {
      return `$${(volume / 1e9).toFixed(2)}B`;
    } else if (volume >= 1e6) {
      return `$${(volume / 1e6).toFixed(2)}M`;
    } else if (volume >= 1e3) {
      return `$${(volume / 1e3).toFixed(2)}K`;
    } else {
      return `$${volume.toFixed(2)}`;
    }
  };

  // Duplicate items for seamless scrolling
  const duplicatedItems = [...tickerItems, ...tickerItems];

  if (isLoading && tickerItems.length === 0) {
    return (
      <div className="w-full h-12 bg-dark-900/80 border-b border-dark-700 flex items-center px-4">
        <div className="text-gray-400 text-sm">Loading ticker...</div>
      </div>
    );
  }

  if (tickerItems.length === 0) {
    return null;
  }

  return (
    <div 
      className="w-full h-12 bg-dark-900/80 border-b border-dark-700 overflow-hidden relative"
      onMouseEnter={() => {
        if (tickerRef.current) {
          tickerRef.current.style.animationPlayState = 'paused';
        }
      }}
      onMouseLeave={() => {
        if (tickerRef.current) {
          tickerRef.current.style.animationPlayState = 'running';
        }
      }}
    >
      <div
        ref={tickerRef}
        className="flex items-center h-full"
        style={{
          animation: `scroll ${tickerItems.length * 3}s linear infinite`,
          width: 'max-content',
        }}
      >
        {duplicatedItems.map((item, index) => (
          <div
            key={`${item.pairKey}-${index}`}
            className="flex items-center gap-4 px-6 cursor-pointer hover:bg-dark-800/50 transition-colors h-full"
            onClick={() => onPairClick?.(item.pairKey)}
          >
            <span className="text-white font-semibold text-sm whitespace-nowrap">
              {item.pairName}
            </span>
            <span className="text-white text-sm whitespace-nowrap">
              {formatPrice(item.price)}
            </span>
            <span
              className={`text-sm font-medium whitespace-nowrap ${
                item.change24h >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {item.change24h >= 0 ? '↑' : '↓'} {Math.abs(item.change24h).toFixed(2)}%
            </span>
            <span className="text-gray-400 text-xs whitespace-nowrap">
              Vol: {formatVolume(item.volume24h)}
            </span>
            <div className="w-px h-6 bg-dark-700" />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
};

export default PriceTicker;

