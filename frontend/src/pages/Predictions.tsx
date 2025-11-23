import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import AdvancedChart from '../components/AdvancedChart';
import OpenPositions from '../components/OpenPositions';
import PositionHistory from '../components/PositionHistory';
import Orders from '../components/Orders';
import PositionOpening from '../components/PositionOpening';
import PairList from '../components/PairList';
import OrderBook from '../components/OrderBook';
import PriceTicker from '../components/PriceTicker';
import { getPerpDEXContract, Position, getAllPairs } from '../utils/perpdexContract';
import { getUserOpenPositions, checkIndexerHealth } from '../utils/envio';
import {
  LockClosedIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

interface PredictionsProps {
  selectedPair: string;
  onPairSelect: (pairKey: string) => void;
}

const Predictions: React.FC<PredictionsProps> = ({ selectedPair, onPairSelect }) => {
  const { isConnected, provider, account, signer } = useWallet();
  const [positionsRefreshTrigger, setPositionsRefreshTrigger] = useState(0);
  const [selectedLimitPrice, setSelectedLimitPrice] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'open' | 'history' | 'orders'>('open');
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [isLoadingPairs, setIsLoadingPairs] = useState(true);
  const [hedgePairKey, setHedgePairKey] = useState<string | null>(null);
  const [hedgeDirection, setHedgeDirection] = useState<'long' | 'short' | null>(null);

  // Normalize selectedPair: ensure it ends with "USD" (e.g., "BTC" -> "BTCUSD")
  const normalizedSelectedPair = selectedPair 
    ? (selectedPair.toUpperCase().endsWith('USD') ? selectedPair.toUpperCase() : `${selectedPair.toUpperCase()}USD`)
    : undefined;

  // Price updates are now handled only when opening/closing positions
  // This avoids transaction conflicts and reduces gas costs

  const handlePositionOpened = () => {
    // Trigger positions refresh
    setPositionsRefreshTrigger(prev => prev + 1);
    // Load positions for chart markers
    loadOpenPositions();
  };

  const loadOpenPositions = async () => {
    if (!provider || !account) return;
    
    try {
      // Try to use indexer first (faster and more reliable)
      const indexerAvailable = await checkIndexerHealth();
      
      if (indexerAvailable) {
        try {
          const indexerPositions = await getUserOpenPositions(account);
          const positions: Position[] = indexerPositions.map(ip => ({
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
          
          setOpenPositions(positions);
          return; // Successfully loaded from indexer
        } catch (indexerError) {
          console.warn('[Predictions] Indexer failed, falling back to contract:', indexerError);
          // Fall through to contract loading
        }
      }
      
      // Fallback to contract if indexer not available or failed
      const contract = await getPerpDEXContract(provider);
      const positionIds: bigint[] = await contract.getUserPositions(account);
      const positions: Position[] = [];

      for (const positionId of positionIds) {
        try {
          const position = await contract.positions(positionId);
          if (position.isOpen) {
            positions.push({
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
          }
        } catch (err: any) {
          // Position might not exist anymore (deleted/closed), skip silently
          // Only log in development mode
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[Predictions] Position ${positionId} not found or error loading:`, err.message || err);
          }
        }
      }

      setOpenPositions(positions);
    } catch (err) {
      console.error('[Predictions] Error loading open positions:', err);
    }
  };

  useEffect(() => {
    if (isConnected && account && provider) {
      loadOpenPositions();
    }
  }, [isConnected, account, provider, positionsRefreshTrigger]);

  // Auto-select BTC as default pair if no pair is selected (with cache optimization)
  useEffect(() => {
    if (isConnected && provider && !selectedPair) {
      const autoSelectPair = async () => {
        try {
          setIsLoadingPairs(true);
          // Use cache for faster loading (60s TTL)
          const pairs = await getAllPairs(provider, true);
          const activePairs = pairs.filter(p => p.config?.isActive);
          
          // First, try to find BTCUSD or BTC
          const btcPair = activePairs.find(p => 
            p.pairKey.toUpperCase() === 'BTCUSD' || 
            p.pairKey.toUpperCase() === 'BTC'
          );
          
          if (btcPair) {
            onPairSelect(btcPair.pairKey);
          } else if (activePairs.length > 0) {
            // If BTC not found, select first active pair
            onPairSelect(activePairs[0].pairKey);
          }
        } catch (err) {
          console.error('Error auto-selecting pair:', err);
        } finally {
          setIsLoadingPairs(false);
        }
      };
      autoSelectPair();
    } else if (!isConnected || !provider) {
      setIsLoadingPairs(false);
    }
  }, [isConnected, provider, selectedPair, onPairSelect]);

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="card-glass p-12 text-center">
          <LockClosedIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400">Please connect your wallet to view trading charts and positions.</p>
        </div>
      </div>
    );
  }

  if (!selectedPair) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="card-glass p-12 text-center">
          {isLoadingPairs ? (
            <>
              {/* Modern Loading Spinner */}
              <div className="flex justify-center mb-6">
                <div className="relative w-16 h-16">
                  <div className="absolute top-0 left-0 w-full h-full border-4 border-primary-500/20 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-full h-full border-4 border-transparent border-t-primary-500 rounded-full animate-spin"></div>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Loading Trading Pairs</h2>
              <p className="text-gray-400">Please wait while we load available trading pairs...</p>
            </>
          ) : (
            <>
              <InformationCircleIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Select a Trading Pair</h2>
              <p className="text-gray-400">Please select a trading pair from the left panel to view charts and open positions.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[calc(100vh-5rem)] px-2 sm:px-4 lg:px-6 py-4 flex flex-col gap-4">
      {/* Price Ticker - Above everything */}
      <PriceTicker onPairClick={onPairSelect} />
      
      {/* Main Section: Chart/OrderBook/Activity on left, Trade on right */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left Side: Chart, OrderBook and Activity */}
        <div className="flex-[0.75] lg:flex-[0.75] flex flex-col gap-4">
          {/* Top Row: Chart and OrderBook */}
          <div className="flex flex-col lg:flex-row gap-4 min-h-[70vh] flex-shrink-0">
            {/* Chart */}
            <div className="flex-[0.8] lg:flex-[0.8] flex flex-col min-h-0 flex-shrink-0">
              <div className="card-glass p-2 flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Pair Selector - Above Chart */}
                <div className="mb-1 flex-shrink-0">
                  <PairList
                    selectedPair={normalizedSelectedPair || selectedPair}
                    onPairSelect={onPairSelect}
                  />
                </div>
                
                {/* Chart - Full height, no padding */}
                <div className="flex-1 min-h-0" style={{ padding: 0, margin: 0 }}>
                  <AdvancedChart
                    symbol={normalizedSelectedPair || selectedPair}
                    pairKey={normalizedSelectedPair || selectedPair}
                    height={undefined}
                    showVolume={true}
                    timeframe="5m"
                    positions={openPositions}
                  />
                </div>
              </div>
            </div>

            {/* OrderBook */}
            <div className="flex-[0.2] lg:flex-[0.2] flex flex-col min-h-0 flex-shrink-0">
              <OrderBook
                symbol={normalizedSelectedPair || selectedPair}
                maxLevels={15}
                onPriceSelect={(price) => {
                  setSelectedLimitPrice(price);
                }}
              />
            </div>
          </div>

          {/* Bottom: Trader Activity */}
          <div className="flex flex-col">
            <div className="bg-dark-800/50 border border-dark-700 rounded-lg flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-dark-700 flex-shrink-0">
                <button
                  onClick={() => setActiveTab('open')}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                    activeTab === 'open'
                      ? 'bg-dark-900 text-primary-400 border-b-2 border-primary-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Open
                </button>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                    activeTab === 'orders'
                      ? 'bg-dark-900 text-primary-400 border-b-2 border-primary-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Orders
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                    activeTab === 'history'
                      ? 'bg-dark-900 text-primary-400 border-b-2 border-primary-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  History
                </button>
              </div>
              
              {/* Tab Content */}
              <div>
                {activeTab === 'open' ? (
                  <OpenPositions 
                    pairKey={normalizedSelectedPair || selectedPair} 
                    refreshTrigger={positionsRefreshTrigger}
                    onHedgeRequest={(pairKey, oppositeDirection) => {
                      setHedgePairKey(pairKey);
                      setHedgeDirection(oppositeDirection);
                      onPairSelect(pairKey); // Switch to the pair
                      // Switch to trade panel (right side) - this will be handled by PositionOpening component
                    }}
                  />
                ) : activeTab === 'orders' ? (
                  <Orders refreshTrigger={positionsRefreshTrigger} />
                ) : (
                  <PositionHistory pairKey={normalizedSelectedPair || selectedPair} refreshTrigger={positionsRefreshTrigger} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Trade Panel - Full Height */}
        <div className="flex-[0.25] lg:flex-[0.25] flex flex-col min-h-0">
          <div className="card-glass p-3 sm:p-4 lg:p-6 flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex flex-col h-full min-h-0">
              {/* Pair Info */}
              <div className="mb-3 flex-shrink-0">
                <h2 className="text-lg sm:text-xl font-bold text-white mb-1">
                  {normalizedSelectedPair || selectedPair}
                </h2>
                <p className="text-xs text-gray-400">
                  Perpetual DEX Trading
                </p>
              </div>

              {/* Position Opening Interface */}
              <div className="flex-1 overflow-y-auto min-h-0">
              <PositionOpening
                hedgePairKey={hedgePairKey}
                hedgeDirection={hedgeDirection}
                onHedgeApplied={() => {
                  setHedgePairKey(null);
                  setHedgeDirection(null);
                }}
                pairKey={normalizedSelectedPair || selectedPair}
                onPositionOpened={handlePositionOpened}
                onPriceSelect={selectedLimitPrice ?? undefined}
              />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Predictions;
