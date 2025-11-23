import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getUserStats, checkIndexerHealth, getUserClosedPositions, getUserOpenPositions, getUserOrderHistory, Position, Order, getCurrencyPairsByKeys, getLeaderboard } from '../utils/envio';
import { getContractFees, calculateFee } from '../utils/perpdexContract';
import { formatPoints, calculatePoints, calculateVolume } from '../utils/points';
import RankBadge from '../components/RankBadge';
import {
  WalletIcon,
  TrophyIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CheckCircleIcon,
  StarIcon,
} from '@heroicons/react/24/outline';


const Portfolio: React.FC = () => {
  const { account, provider, isConnected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [indexerAvailable, setIndexerAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'orders'>('positions');
  const [pairNames, setPairNames] = useState<Record<string, string>>({});
  const [contractFees, setContractFees] = useState<{ openingFeeBP: number; closingFeeBP: number } | null>(null);
  const [stats, setStats] = useState({
    // PerpDEX Statistics only
    totalVolume: '0',
    totalPerpPnL: '0',
    totalPositions: 0,
    openPositions: 0,
    totalOrders: 0,
    totalPoints: '0',
    rank: null as number | null,
  });

  // Load contract fees on mount and when provider changes
  useEffect(() => {
    if (provider) {
      getContractFees(provider).then(setContractFees).catch(err => {
        console.warn('[Portfolio] Could not load contract fees:', err);
        setContractFees({ openingFeeBP: 0, closingFeeBP: 25 }); // Use defaults
      });
    }
  }, [provider]);

  useEffect(() => {
    if (isConnected && provider && account) {
      loadPortfolio();
    }
  }, [isConnected, provider, account]);

  const loadPortfolio = async () => {
    if (!provider || !account) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Check if indexer is available
      console.log('[Portfolio] Checking indexer health...');
      const indexerHealth = await checkIndexerHealth();
      console.log('[Portfolio] Indexer health check result:', indexerHealth);
      setIndexerAvailable(indexerHealth);
      
      if (!indexerHealth) {
        console.warn('[Portfolio] Indexer is not available. Portfolio data will not be loaded.');
        setError('Indexer is not available. Please make sure the Envio indexer is running on http://localhost:8080');
        setLoading(false);
        return;
      }
      
      if (indexerHealth) {
        // Use Envio indexer for data
        console.log('[Portfolio] Indexer is available, fetching PerpDEX data for address:', account);
        const [userStatsData, closedPositions, openPositions, orders] = await Promise.all([
          getUserStats(account),
          getUserClosedPositions(account, undefined, 200), // Increase limit for closed positions
          getUserOpenPositions(account), // Get open positions for points calculation
          getUserOrderHistory(account, undefined, 1000), // Increase limit to show all orders
        ]);
        
        console.log('[Portfolio] Results:', {
          userStats: userStatsData,
          closedPositions: closedPositions.length,
          openPositions: openPositions.length,
          orders: orders.length,
        });
        
        setClosedPositions(closedPositions);
        setOrderHistory(orders);
        
        // Calculate points from positions and orders
        let totalPoints = BigInt(0);
        
        // Calculate points from all positions (both open and closed)
        // Positions are opened via market orders, so orderType = 'market'
        const allPositions = [...closedPositions, ...openPositions];
        for (const position of allPositions) {
          const volume = calculateVolume(position.collateral, position.leverage);
          const leverage = Number(position.leverage);
          const points = calculatePoints(volume, leverage, 'market');
          totalPoints += points;
        }
        
        // Calculate points from executed limit orders
        // OrderType: 0 = MARKET, 1 = LIMIT
        // Status: 0 = PENDING, 1 = EXECUTED, 2 = CANCELLED, 3 = EXPIRED
        for (const order of orders) {
          if (order.status === 1 && order.orderType === 1 && order.executedAt) { // EXECUTED LIMIT ORDER
            const volume = calculateVolume(order.collateralAmount, order.leverage);
            const leverage = Number(order.leverage);
            const points = calculatePoints(volume, leverage, 'limit');
            totalPoints += points;
          }
        }
        
        // Load pair names from contract (primary source)
        try {
          const allPairKeys = new Set<string>();
          allPositions.forEach(p => allPairKeys.add(p.pairKey));
          orders.forEach(o => allPairKeys.add(o.pairKey));
          
          if (allPairKeys.size > 0 && provider) {
            const pairMap: Record<string, string> = {};
            
            try {
              // Load all active pairs from contract and create hash -> name mapping
              const { getPerpDEXContract, getAllPairs } = await import('../utils/perpdexContract');
              const contract = await getPerpDEXContract(provider);
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
                  pairMap[pairKeyHash] = displayName;
                  console.log(`[Portfolio] Loaded pair ${displayName} for ${pairKeyHash.substring(0, 8)}...`);
                } else {
                  // Fallback: try direct contract call
                  try {
                    const pairConfig = await contract.pairs(pairKeyHash);
                    if (pairConfig && pairConfig.baseCurrency && pairConfig.quoteCurrency) {
                      const displayName = `${pairConfig.baseCurrency}${pairConfig.quoteCurrency}`;
                      pairMap[pairKeyHash] = displayName;
                    } else {
                      pairMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
                    }
                  } catch (err: any) {
                    pairMap[pairKeyHash] = pairKeyHash.substring(0, 8) + '...';
                  }
                }
              }
              
              console.log('[Portfolio] Loaded pair names from contract:', pairMap);
              setPairNames(pairMap);
            } catch (contractErr) {
              console.warn('[Portfolio] Could not load pair names from contract:', contractErr);
              // Last resort: use truncated pairKey
              Array.from(allPairKeys).forEach(pairKey => {
                pairMap[pairKey] = pairKey.substring(0, 8) + '...';
              });
              setPairNames(pairMap);
            }
          }
        } catch (err) {
          console.error('[Portfolio] Error loading pair names:', err);
        }
        
        // Calculate stats from actual data to ensure consistency
        const formatUSDC = (value: string) => {
          try {
            return ethers.formatUnits(value || '0', 6);
          } catch {
            return '0';
          }
        };
        
        // Calculate rank by getting top users and comparing points
        // Get top 100 users to calculate rank (optimized - only top users)
        let userRank: number | null = null;
        try {
          const topUsers = await getLeaderboard(100, 'volume');
          const userPointsMap = new Map<string, bigint>();
          
          // Calculate points for top users (including current user)
          const userPointsPromises = topUsers.map(async (userStats) => {
            const userAddress = userStats.address || userStats.id;
            const [userClosedPositions, userOpenPositions, userOrders] = await Promise.all([
              getUserClosedPositions(userAddress, undefined, 200),
              getUserOpenPositions(userAddress),
              getUserOrderHistory(userAddress, undefined, 1000),
            ]);
            
            let userTotalPoints = BigInt(0);
            const allUserPositions = [...userClosedPositions, ...userOpenPositions];
            for (const position of allUserPositions) {
              const volume = calculateVolume(position.collateral, position.leverage);
              const leverage = Number(position.leverage);
              const points = calculatePoints(volume, leverage, 'market');
              userTotalPoints += points;
            }
            
            for (const order of userOrders) {
              if (order.status === 1 && order.orderType === 1 && order.executedAt) {
                const volume = calculateVolume(order.collateralAmount, order.leverage);
                const leverage = Number(order.leverage);
                const points = calculatePoints(volume, leverage, 'limit');
                userTotalPoints += points;
              }
            }
            
            userPointsMap.set(userAddress.toLowerCase(), userTotalPoints);
            return { address: userAddress, points: userTotalPoints };
          });
          
          await Promise.all(userPointsPromises);
          
          // Add current user's points if not in top 100
          if (!userPointsMap.has(account.toLowerCase())) {
            userPointsMap.set(account.toLowerCase(), totalPoints);
          }
          
          // Sort by points and find rank
          const sortedUsers = Array.from(userPointsMap.entries())
            .sort((a, b) => (b[1] > a[1] ? 1 : -1));
          
          const rankIndex = sortedUsers.findIndex(([addr]) => addr === account.toLowerCase());
          userRank = rankIndex >= 0 ? rankIndex + 1 : null;
        } catch (rankError) {
          console.warn('[Portfolio] Error calculating rank:', rankError);
          // Rank calculation failed, continue without rank
        }
        
        // Calculate volume and stats from positions and orders if UserStats is not available
        // Otherwise use UserStats for consistency
        let calculatedVolume = BigInt(0);
        let calculatedPnL = BigInt(0);
        
        // Calculate volume from positions
        for (const position of allPositions) {
          const volume = calculateVolume(position.collateral, position.leverage);
          calculatedVolume += volume;
          
          // Add PnL if available (for closed positions)
          if (position.pnl && position.isOpen === false) {
            try {
              calculatedPnL += BigInt(position.pnl);
            } catch {
              // Ignore if pnl is not a valid number
            }
          }
        }
        
        // Use UserStats if available, otherwise calculate from positions/orders
        const statsData = userStatsData ? {
          totalVolume: formatUSDC(userStatsData.totalVolume || '0'),
          totalPerpPnL: formatUSDC(userStatsData.totalPerpPnL || '0'),
          totalPositions: Number(userStatsData.totalPositions) || allPositions.length,
          openPositions: Number(userStatsData.openPositions) || openPositions.length,
          totalOrders: Number(userStatsData.totalOrders) || orders.length,
          totalPoints: totalPoints.toString(), // Calculated from positions and orders
          rank: userRank, // Calculated from all users' points
        } : {
          // Fallback: Calculate from positions and orders
          totalVolume: ethers.formatUnits(calculatedVolume, 6),
          totalPerpPnL: ethers.formatUnits(calculatedPnL, 6),
          totalPositions: allPositions.length,
          openPositions: openPositions.length,
          totalOrders: orders.length,
          totalPoints: totalPoints.toString(), // Calculated from positions and orders
          rank: userRank, // Calculated from all users' points
        };
        
        console.log('[Portfolio] Setting stats:', {
          ...statsData,
          calculatedPoints: totalPoints.toString(),
          actualClosedPositions: closedPositions.length,
          actualOpenPositions: openPositions.length,
          actualOrders: orders.length,
        });
        setStats(statsData);
      } else {
        // Indexer not available - show empty state
        console.warn('[Portfolio] Indexer is not available');
        setStats({
          totalVolume: '0',
          totalPerpPnL: '0',
          totalPositions: 0,
          openPositions: 0,
          totalOrders: 0,
          totalPoints: '0',
          rank: null,
        });
      }
    } catch (err: any) {
      console.error('Error loading portfolio:', err);
      setError(err.message || 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };


  if (!isConnected) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="card-glass p-12 text-center">
          <WalletIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400">Please connect your wallet to view your portfolio.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Portfolio</h1>
        <p className="text-gray-400">Track your PerpDEX trading performance</p>
      </div>

      {/* PerpDEX Stats */}
      {indexerAvailable && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">PerpDEX Trading Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Total Volume</p>
                  <CurrencyDollarIcon className="w-5 h-5 text-blue-500" />
                </div>
                <p className="text-2xl font-bold text-blue-500">
                  {parseFloat(stats.totalVolume).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                </p>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Total PnL</p>
                  {parseFloat(stats.totalPerpPnL) >= 0 ? (
                    <ArrowTrendingUpIcon className="w-5 h-5 text-green-500" />
                  ) : (
                    <ArrowTrendingDownIcon className="w-5 h-5 text-red-500" />
                  )}
                </div>
                <p className={`text-2xl font-bold ${
                  parseFloat(stats.totalPerpPnL) >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {parseFloat(stats.totalPerpPnL) >= 0 ? '+' : ''}
                  {parseFloat(stats.totalPerpPnL).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                </p>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Total Points</p>
                  <StarIcon className="w-5 h-5 text-yellow-500" />
                </div>
                <p className="text-2xl font-bold text-yellow-500">
                  {formatPoints(stats.totalPoints)}
                </p>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Global Rank</p>
                  <TrophyIcon className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex items-center">
                  <p className="text-2xl font-bold text-purple-500">
                    {stats.rank ? `#${stats.rank}` : 'Unranked'}
                  </p>
                  {stats.rank && stats.rank <= 3 && (
                    <RankBadge rank={stats.rank} size="md" />
                  )}
                </div>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Total Positions</p>
                  <ClockIcon className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-2xl font-bold text-white">{stats.totalPositions}</p>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Open Positions</p>
                  <CheckCircleIcon className="w-5 h-5 text-primary-500" />
                </div>
                <p className="text-2xl font-bold text-primary-500">{stats.openPositions}</p>
              </div>

              <div className="card-glass p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">Total Orders</p>
                  <TrophyIcon className="w-5 h-5 text-purple-500" />
                </div>
                <p className="text-2xl font-bold text-purple-500">{stats.totalOrders}</p>
              </div>
            </div>
          </div>
      )}

      {/* Tabs for different sections */}
      {indexerAvailable && (
        <div className="card-glass p-6">
          <div className="flex gap-4 mb-6 border-b border-dark-700">
            <button
              onClick={() => setActiveTab('positions')}
              className={`pb-3 px-4 font-semibold transition-colors ${
                activeTab === 'positions'
                  ? 'text-primary-500 border-b-2 border-primary-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Closed Positions ({closedPositions.length})
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`pb-3 px-4 font-semibold transition-colors ${
                activeTab === 'orders'
                  ? 'text-primary-500 border-b-2 border-primary-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Order History ({orderHistory.length})
            </button>
          </div>

          {/* Closed Positions Tab */}
          {activeTab === 'positions' && (
            <>
              <h2 className="text-xl font-bold text-white mb-6">Closed Positions</h2>
              {loading && (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                  <p className="text-gray-400 mt-2">Loading positions...</p>
                </div>
              )}
              {!loading && closedPositions.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircleIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-400">No closed positions found.</p>
                </div>
              )}
              {!loading && closedPositions.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-dark-700">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Pair</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Direction</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Entry Price</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Exit Price</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Size</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Leverage</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">PnL</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Closed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedPositions.map((position) => {
                        const entryPrice = parseFloat(position.entryPrice) / 1e8;
                        const exitPrice = position.exitPrice ? parseFloat(position.exitPrice) / 1e8 : entryPrice; // Use exitPrice from indexer, fallback to entryPrice
                        const size = parseFloat(position.size) / 1e6;
                        const collateral = parseFloat(position.collateral) / 1e6;
                        const closedAt = position.closedAt ? new Date(Number(position.closedAt) * 1000).toLocaleString() : '-';
                        
                        const pairDisplayName = pairNames[position.pairKey] || position.pairKey;
                        const direction = position.direction || null;
                        
                        // Calculate PnL: use indexer PnL if available (includes fees), otherwise calculate from prices
                        let pnl = 0;
                        let pnlPercent = 0;
                        
                        if (position.pnl) {
                          // Use PnL from indexer (contract-calculated, includes fees)
                          pnl = parseFloat(position.pnl) / 1e6; // USDC has 6 decimals
                          pnlPercent = collateral > 0 ? (pnl / collateral) * 100 : 0;
                        } else {
                          // Fallback: calculate PnL from direction and prices (with fees)
                          // For closed positions, deduct both opening and closing fees
                          const openingFeeBP = contractFees?.openingFeeBP ?? 0;
                          const closingFeeBP = contractFees?.closingFeeBP ?? 25;
                          
                          // Calculate fees based on collateral (not position size)
                          const collateralBigInt = BigInt(Math.floor(collateral * 1e6)); // Convert to 6 decimals
                          const openingFee = Number(calculateFee(collateralBigInt, openingFeeBP)) / 1e6;
                          const closingFee = Number(calculateFee(collateralBigInt, closingFeeBP)) / 1e6;
                          const totalFees = openingFee + closingFee;
                          
                          if (direction === 'long') {
                            // Long: profit when exitPrice > entryPrice
                            pnl = ((exitPrice - entryPrice) / entryPrice) * size - totalFees;
                          } else if (direction === 'short') {
                            // Short: profit when exitPrice < entryPrice
                            pnl = ((entryPrice - exitPrice) / entryPrice) * size - totalFees;
                          } else {
                            // Unknown direction: calculate both and use the one with larger absolute value
                            const longPnL = ((exitPrice - entryPrice) / entryPrice) * size - totalFees;
                            const shortPnL = ((entryPrice - exitPrice) / entryPrice) * size - totalFees;
                            pnl = Math.abs(longPnL) > Math.abs(shortPnL) ? longPnL : shortPnL;
                          }
                          pnlPercent = collateral > 0 ? (pnl / collateral) * 100 : 0;
                        }
                        
                        return (
                          <tr key={position.id} className="border-b border-dark-700/50 hover:bg-dark-800/50">
                            <td className="py-4 px-4">
                              <span className="text-white font-medium">{pairDisplayName}</span>
                            </td>
                            <td className="py-4 px-4">
                              {direction ? (
                                <span className={`inline-block px-2 py-1 rounded text-xs ${
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
                            <td className="py-4 px-4">
                              <span className="text-white">${entryPrice.toFixed(4)}</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">${exitPrice.toFixed(4)}</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">{size.toFixed(2)} USDC</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">{position.leverage}x</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className={`font-semibold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-gray-400 text-sm">{closedAt}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Order History Tab */}
          {activeTab === 'orders' && (
            <>
              <h2 className="text-xl font-bold text-white mb-6">Order History</h2>
              {loading && (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                  <p className="text-gray-400 mt-2">Loading orders...</p>
                </div>
              )}
              {!loading && orderHistory.length === 0 && (
                <div className="text-center py-12">
                  <ClockIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-400">No orders found.</p>
                </div>
              )}
              {!loading && orderHistory.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-dark-700">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Pair</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Type</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Status</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Limit Price</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Collateral</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Leverage</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderHistory.map((order) => {
                        const orderType = order.orderType === 0 ? 'MARKET' : 'LIMIT';
                        const statusMap: Record<number, string> = {
                          0: 'PENDING',
                          1: 'EXECUTED',
                          2: 'CANCELLED',
                          3: 'EXPIRED',
                        };
                        const status = statusMap[order.status] || 'UNKNOWN';
                        
                        // Format limit price properly (handle BigInt/string to avoid precision loss)
                        const formatPrice = (price: string | bigint): string => {
                          try {
                            const PRICE_PRECISION = BigInt(1e8);
                            const priceBigInt = typeof price === 'string' ? BigInt(price) : price;
                            const wholePart = priceBigInt / PRICE_PRECISION;
                            const remainder = priceBigInt % PRICE_PRECISION;
                            const remainderStr = remainder.toString().padStart(8, '0');
                            // Take first 4 decimal places and remove trailing zeros
                            const decimalPart = remainderStr.substring(0, 4).replace(/0+$/, '');
                            if (decimalPart === '') {
                              return wholePart.toString();
                            }
                            return `${wholePart.toString()}.${decimalPart}`;
                          } catch (err) {
                            // Fallback to simple division if BigInt conversion fails
                            const priceNum = typeof price === 'string' ? parseFloat(price) : Number(price);
                            return (priceNum / 1e8).toFixed(4).replace(/\.?0+$/, '');
                          }
                        };
                        
                        const limitPriceFormatted = formatPrice(order.limitPrice);
                        const collateral = parseFloat(order.collateralAmount) / 1e6;
                        const createdAt = new Date(Number(order.timestamp) * 1000).toLocaleString();
                        const pairDisplayName = pairNames[order.pairKey] || order.pairKey;
                        
                        return (
                          <tr key={order.id} className="border-b border-dark-700/50 hover:bg-dark-800/50">
                            <td className="py-4 px-4">
                              <span className="text-white font-medium">{pairDisplayName}</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-1 rounded text-xs ${
                                orderType === 'MARKET' ? 'bg-blue-500/20 text-blue-500' : 'bg-purple-500/20 text-purple-500'
                              }`}>
                                {orderType}
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-1 rounded text-xs ${
                                status === 'EXECUTED' ? 'bg-green-500/20 text-green-500' :
                                status === 'CANCELLED' ? 'bg-red-500/20 text-red-500' :
                                status === 'EXPIRED' ? 'bg-yellow-500/20 text-yellow-500' :
                                'bg-gray-500/20 text-gray-500'
                              }`}>
                                {status}
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">${limitPriceFormatted}</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">{collateral.toFixed(2)} USDC</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-white">{order.leverage}x</span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-gray-400 text-sm">{createdAt}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Info Message */}
      {!indexerAvailable && (
        <div className="card-glass p-6">
          <div className="text-center py-12">
            <WalletIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-400 mb-2">Envio indexer is not available</p>
            <p className="text-sm text-gray-500">
              Portfolio data requires the Envio indexer to be running.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;

