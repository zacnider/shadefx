import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getLeaderboard, checkIndexerHealth, UserStats, getUserClosedPositions, getUserOpenPositions, getUserOrderHistory, graphqlQuery } from '../utils/envio';
import { formatPoints, calculatePoints, calculateVolume } from '../utils/points';
import RankBadge from '../components/RankBadge';
import {
  TrophyIcon,
  UserIcon,
  WalletIcon,
  ArrowTrendingUpIcon,
  StarIcon,
} from '@heroicons/react/24/outline';

interface LeaderboardEntry {
  rank: number;
  address: string;
  shortenedAddress: string;
  // PerpDEX data only
  totalVolume: string;
  totalPerpPnL: string;
  totalPositions: number;
  openPositions: number;
  totalOrders: number;
  totalPoints: string;
  globalRank?: number | null;
}

const Leaderboard: React.FC = () => {
  const { account, provider, isConnected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [indexerAvailable, setIndexerAvailable] = useState(false);
  const [sortBy, setSortBy] = useState<'volume' | 'pnl' | 'points'>('volume');

  useEffect(() => {
    if (isConnected && provider) {
      loadLeaderboard();
    }
  }, [isConnected, provider, account, sortBy]);

  const shortenAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const loadLeaderboard = async () => {
    if (!provider) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Check if indexer is available
      const indexerHealth = await checkIndexerHealth();
      setIndexerAvailable(indexerHealth);
      
      if (indexerHealth) {
        // Get top 100 users by volume (to calculate points)
        let userStatsList = await getLeaderboard(100, 'volume');
        
        console.log('[Leaderboard] Fetched userStatsList:', userStatsList.length, 'users');
        
        // If UserStats is empty, get unique traders from Position/Order tables
        if (userStatsList.length === 0) {
          console.log('[Leaderboard] UserStats empty, fetching traders from Position/Order tables');
          
          // Get all unique traders from Position and Order tables
          // Fetch all positions and orders, then extract unique traders
          const positionQuery = `query GetAllTradersFromPositions {
            Position(limit: 1000, order_by: {timestamp: desc}) {
              trader_id
            }
          }`;
          
          const orderQuery = `query GetAllTradersFromOrders {
            Order(limit: 1000, order_by: {timestamp: desc}) {
              trader_id
            }
          }`;
          
          try {
            const [positionData, orderData] = await Promise.all([
              graphqlQuery<{ Position: Array<{ trader_id: string }> }>(positionQuery).catch(() => ({ Position: [] })),
              graphqlQuery<{ Order: Array<{ trader_id: string }> }>(orderQuery).catch(() => ({ Order: [] })),
            ]);
            
            const tradersSet = new Set<string>();
            positionData.Position?.forEach(p => {
              if (p.trader_id) tradersSet.add(p.trader_id.toLowerCase());
            });
            orderData.Order?.forEach(o => {
              if (o.trader_id) tradersSet.add(o.trader_id.toLowerCase());
            });
            
            const uniqueTraders = Array.from(tradersSet);
            console.log('[Leaderboard] Found', uniqueTraders.length, 'unique traders from Position/Order');
            
            if (uniqueTraders.length === 0) {
              setError('No users found. Make sure you have opened positions or orders.');
              setLoading(false);
              return;
            }
            
            // Create UserStats-like objects from trader addresses
            userStatsList = uniqueTraders.slice(0, 100).map(address => ({
              id: address,
              address: address,
              // Prediction Market fields (not used in PerpDEX, set to defaults)
              totalPoints: '0',
              totalWon: '0',
              totalLost: '0',
              totalPredictions: '0',
              winRate: '0',
              totalStaked: '0',
              totalPnL: '0',
              totalClaimed: '0',
              currentWinStreak: '0',
              longestWinStreak: '0',
              // PerpDEX Statistics (will be calculated)
              totalPositions: undefined,
              openPositions: undefined,
              totalVolume: undefined,
              totalPerpPnL: undefined,
              totalOrders: undefined,
              perpDexPoints: undefined,
              rank: undefined,
            }));
          } catch (tradersError) {
            console.error('[Leaderboard] Error fetching traders:', tradersError);
            setError('Failed to load leaderboard data. Please try again later.');
            setLoading(false);
            return;
          }
        }
        
        // Calculate points for each user from their positions and orders
        const entriesWithPoints = await Promise.all(
          userStatsList.map(async (userStats) => {
            const userAddress = userStats.address || userStats.id;
            
            // Fetch user's positions and orders
            const [closedPositions, openPositions, orders] = await Promise.all([
              getUserClosedPositions(userAddress, undefined, 200),
              getUserOpenPositions(userAddress),
              getUserOrderHistory(userAddress, undefined, 1000),
            ]);
            
            // Calculate total points
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
            
            // Calculate volume from positions if UserStats doesn't have it
            let userVolume = BigInt(0);
            for (const position of allPositions) {
              userVolume += calculateVolume(position.collateral, position.leverage);
            }
            
            // Calculate PnL from closed positions if UserStats doesn't have it
            let userPnL = BigInt(0);
            for (const position of closedPositions) {
              if (position.pnl) {
                try {
                  userPnL += BigInt(position.pnl);
                } catch {
                  // Ignore if pnl is not valid
                }
              }
            }
            
            return {
              address: userAddress,
              shortenedAddress: shortenAddress(userAddress),
              totalVolume: userStats.totalVolume 
                ? ethers.formatUnits(userStats.totalVolume, 6) 
                : ethers.formatUnits(userVolume, 6),
              totalPerpPnL: userStats.totalPerpPnL 
                ? ethers.formatUnits(userStats.totalPerpPnL, 6) 
                : ethers.formatUnits(userPnL, 6),
              totalPositions: Number(userStats.totalPositions) || allPositions.length,
              openPositions: Number(userStats.openPositions) || openPositions.length,
              totalOrders: Number(userStats.totalOrders) || orders.length,
              totalPoints: totalPoints.toString(),
            };
          })
        );
        
        // Sort entries based on sortBy
        let sortedEntries: typeof entriesWithPoints;
        switch (sortBy) {
          case 'pnl':
            sortedEntries = entriesWithPoints.sort((a, b) => 
              parseFloat(b.totalPerpPnL) - parseFloat(a.totalPerpPnL)
            );
            break;
          case 'points':
            sortedEntries = entriesWithPoints.sort((a, b) => 
              BigInt(b.totalPoints) > BigInt(a.totalPoints) ? 1 : -1
            );
            break;
          default: // volume
            sortedEntries = entriesWithPoints.sort((a, b) => 
              parseFloat(b.totalVolume) - parseFloat(a.totalVolume)
            );
        }
        
        // Add rank to entries
        const entries: LeaderboardEntry[] = sortedEntries.map((entry, index) => ({
          rank: index + 1,
          ...entry,
          globalRank: index + 1, // Rank based on current sort
        }));
        
        setLeaderboard(entries);
        
        // Find user's rank
        if (account) {
          const userEntry = entries.find(e => 
            e.address.toLowerCase() === account.toLowerCase()
          );
          setUserRank(userEntry ? userEntry.rank : null);
        }
      } else {
        // Fallback: Show empty leaderboard with message
        setLeaderboard([]);
        setError('Envio indexer is not available. Leaderboard data requires the indexer to be running.');
      }
    } catch (err: any) {
      console.error('Error loading leaderboard:', err);
      setError(err.message || 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
          <TrophyIcon className="w-8 h-8 text-yellow-500" />
          Leaderboard
        </h1>
        <p className="text-gray-400 mb-4">Top traders ranked by performance</p>
        
        {/* Sort Options */}
        {indexerAvailable && (
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('volume')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                sortBy === 'volume'
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-800 text-gray-400 hover:text-white'
              }`}
            >
              By Volume
            </button>
            <button
              onClick={() => setSortBy('pnl')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                sortBy === 'pnl'
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-800 text-gray-400 hover:text-white'
              }`}
            >
              By PnL
            </button>
            <button
              onClick={() => setSortBy('points')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                sortBy === 'points'
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-800 text-gray-400 hover:text-white'
              }`}
            >
              By Points
            </button>
          </div>
        )}
      </div>

      {/* User Rank Card */}
      {isConnected && account && userRank !== null && (
        <div className="card-glass p-6 mb-8 border-2 border-primary-500/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400 mb-1">Your Rank</p>
              <p className="text-3xl font-bold text-primary-500">#{userRank}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400 mb-1">Address</p>
              <p className="text-white font-mono">{shortenAddress(account)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="card-glass p-6">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            <p className="text-gray-400 mt-2">Loading leaderboard...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-4">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        {!loading && leaderboard.length === 0 && (
          <div className="text-center py-12">
            <TrophyIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-400 mb-2">No leaderboard data available yet.</p>
            <p className="text-sm text-gray-500">
              Leaderboard will be populated once the Envio indexer is set up.
            </p>
          </div>
        )}

        {!loading && leaderboard.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Rank</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Address</th>
                  {sortBy === 'volume' && (
                    <>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Volume</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Points</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Open Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Orders</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total PnL</th>
                    </>
                  )}
                  {sortBy === 'pnl' && (
                    <>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total PnL</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Volume</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Points</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Open Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Orders</th>
                    </>
                  )}
                  {sortBy === 'points' && (
                    <>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Points</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Volume</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Open Positions</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total Orders</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Total PnL</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const isUser = account && entry.address.toLowerCase() === account.toLowerCase();
                  return (
                    <tr
                      key={entry.address}
                      className={`border-b border-dark-700/50 hover:bg-dark-800/50 ${
                        isUser ? 'bg-primary-500/10' : ''
                      }`}
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          {entry.globalRank && entry.globalRank <= 3 && (
                            <RankBadge rank={entry.globalRank} size="sm" />
                          )}
                          <span className={`font-bold ${isUser ? 'text-primary-500' : 'text-white'}`}>
                            #{entry.rank}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`font-mono ${isUser ? 'text-primary-500' : 'text-white'}`}>
                          {entry.shortenedAddress}
                        </span>
                      </td>
                      {sortBy === 'volume' && (
                        <>
                          <td className="py-4 px-4 text-right">
                            <span className="text-blue-500 font-semibold">
                              {parseFloat(entry.totalVolume).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-yellow-500 font-semibold">
                              {formatPoints(entry.totalPoints)}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-primary-500 font-semibold">
                            {entry.openPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalOrders}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className={`font-semibold ${
                              parseFloat(entry.totalPerpPnL) >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {parseFloat(entry.totalPerpPnL) >= 0 ? '+' : ''}
                              {parseFloat(entry.totalPerpPnL).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                        </>
                      )}
                      {sortBy === 'pnl' && (
                        <>
                          <td className="py-4 px-4 text-right">
                            <span className={`font-semibold ${
                              parseFloat(entry.totalPerpPnL) >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {parseFloat(entry.totalPerpPnL) >= 0 ? '+' : ''}
                              {parseFloat(entry.totalPerpPnL).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-blue-500 font-semibold">
                              {parseFloat(entry.totalVolume).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-yellow-500 font-semibold">
                              {formatPoints(entry.totalPoints)}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-primary-500 font-semibold">
                            {entry.openPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalOrders}
                          </td>
                        </>
                      )}
                      {sortBy === 'points' && (
                        <>
                          <td className="py-4 px-4 text-right">
                            <span className="text-yellow-500 font-semibold">
                              {formatPoints(entry.totalPoints)}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-blue-500 font-semibold">
                              {parseFloat(entry.totalVolume).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-primary-500 font-semibold">
                            {entry.openPositions}
                          </td>
                          <td className="py-4 px-4 text-right text-gray-400">
                            {entry.totalOrders}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className={`font-semibold ${
                              parseFloat(entry.totalPerpPnL) >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {parseFloat(entry.totalPerpPnL) >= 0 ? '+' : ''}
                              {parseFloat(entry.totalPerpPnL).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Info Message */}
        {!indexerAvailable && (
          <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/50 rounded-lg">
            <p className="text-sm text-yellow-400">
              ⚠️ <strong>Note:</strong> Envio indexer is not available. Leaderboard data requires the indexer to be running.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;

