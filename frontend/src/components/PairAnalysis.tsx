/**
 * Pair Analysis Component
 * Displays technical analysis for a trading pair
 */

import React, { useState, useEffect } from 'react';
import { analyzePair, PairAnalysis as PairAnalysisType } from '../utils/indicatorAnalysis';
import { 
  ArrowTrendingUpIcon, 
  ArrowTrendingDownIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface PairAnalysisProps {
  pairKey: string;
}

const PairAnalysis: React.FC<PairAnalysisProps> = ({ pairKey }) => {
  const [analysis, setAnalysis] = useState<PairAnalysisType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalysis = async () => {
      if (!pairKey) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const result = await analyzePair(pairKey);
        setAnalysis(result);
      } catch (err: any) {
        console.error('[PairAnalysis] Error analyzing pair:', err);
        setError(err.message || 'Failed to analyze pair');
      } finally {
        setLoading(false);
      }
    };

    loadAnalysis();
  }, [pairKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-2"></div>
          <p className="text-sm text-gray-400">Analyzing {pairKey}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-sm text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="p-4 bg-gray-800/50 rounded-lg">
        <p className="text-sm text-gray-400">No analysis available</p>
      </div>
    );
  }

  const { trend, recommendation, indicators, supportResistance, currentPrice, priceChange24h } = analysis;

  return (
    <div className="space-y-4">
      {/* Trend Card */}
      <div className={`p-4 rounded-lg border-2 ${
        trend.trend === 'bullish' 
          ? 'bg-green-500/10 border-green-500/30' 
          : trend.trend === 'bearish'
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-gray-500/10 border-gray-500/30'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {trend.trend === 'bullish' ? (
              <ArrowTrendingUpIcon className="w-6 h-6 text-green-400" />
            ) : trend.trend === 'bearish' ? (
              <ArrowTrendingDownIcon className="w-6 h-6 text-red-400" />
            ) : (
              <ChartBarIcon className="w-6 h-6 text-gray-400" />
            )}
            <h3 className="text-lg font-bold text-white">
              {trend.trend === 'bullish' ? '🟢 Bullish' : trend.trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral'} Trend
            </h3>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400">Confidence</p>
            <p className="text-xl font-bold text-white">{trend.confidence}%</p>
          </div>
        </div>
        <div className="mt-2">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-400">Strength: {trend.strength}</span>
            <span className="text-white">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {priceChange24h !== 0 && (
            <p className={`text-xs ${priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}% (24h)
            </p>
          )}
        </div>
      </div>

      {/* Indicators Grid */}
      <div className="grid grid-cols-2 gap-2">
        {indicators.rsi !== null && (
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">RSI</p>
            <p className="text-lg font-bold text-white">{indicators.rsi.toFixed(1)}</p>
            <p className="text-xs text-gray-500">
              {indicators.rsi > 70 ? 'Overbought' : indicators.rsi < 30 ? 'Oversold' : 'Neutral'}
            </p>
          </div>
        )}
        
        {indicators.sma20 !== null && (
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">SMA 20</p>
            <p className="text-lg font-bold text-white">${indicators.sma20.toFixed(2)}</p>
            <p className="text-xs text-gray-500">
              {currentPrice > indicators.sma20 ? '↑ Above' : '↓ Below'}
            </p>
          </div>
        )}
        
        {indicators.sma50 !== null && (
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">SMA 50</p>
            <p className="text-lg font-bold text-white">${indicators.sma50.toFixed(2)}</p>
            <p className="text-xs text-gray-500">
              {currentPrice > indicators.sma50 ? '↑ Above' : '↓ Below'}
            </p>
          </div>
        )}
        
        {indicators.ema20 !== null && (
          <div className="p-3 bg-gray-800/50 rounded-lg">
            <p className="text-xs text-gray-400 mb-1">EMA 20</p>
            <p className="text-lg font-bold text-white">${indicators.ema20.toFixed(2)}</p>
            <p className="text-xs text-gray-500">
              {indicators.ema50 && indicators.ema20 > indicators.ema50 ? '↑ Bullish' : '↓ Bearish'}
            </p>
          </div>
        )}
      </div>

      {/* Recommendation Card */}
      <div className={`p-4 rounded-lg border ${
        recommendation.action === 'long'
          ? 'bg-green-500/10 border-green-500/30'
          : recommendation.action === 'short'
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-gray-500/10 border-gray-500/30'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-white">🎯 Recommendation</h3>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            recommendation.riskLevel === 'low'
              ? 'bg-green-500/20 text-green-400'
              : recommendation.riskLevel === 'medium'
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-red-500/20 text-red-400'
          }`}>
            {recommendation.riskLevel.toUpperCase()} Risk
          </span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Action:</span>
            <span className={`font-bold ${
              recommendation.action === 'long' ? 'text-green-400' : 
              recommendation.action === 'short' ? 'text-red-400' : 
              'text-gray-400'
            }`}>
              {recommendation.action.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Leverage:</span>
            <span className="font-bold text-white">{recommendation.leverage}x</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Confidence:</span>
            <span className="font-bold text-white">{recommendation.confidence}%</span>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-700">
            <p className="text-xs text-gray-400">{recommendation.reasoning}</p>
          </div>
        </div>
      </div>

      {/* Support/Resistance */}
      {(supportResistance.support.length > 0 || supportResistance.resistance.length > 0) && (
        <div className="p-4 bg-gray-800/50 rounded-lg">
          <h3 className="text-sm font-bold text-white mb-3">📉 Support / Resistance</h3>
          <div className="space-y-2">
            {supportResistance.support.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Support Levels:</p>
                <div className="space-y-1">
                  {supportResistance.support.slice(0, 3).map((level, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-green-400">${level.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="text-gray-500">
                        {((level / currentPrice - 1) * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {supportResistance.resistance.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1 mt-3">Resistance Levels:</p>
                <div className="space-y-1">
                  {supportResistance.resistance.slice(0, 3).map((level, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-red-400">${level.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="text-gray-500">
                        +{((level / currentPrice - 1) * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis Text */}
      <div className="p-4 bg-gray-800/50 rounded-lg">
        <h3 className="text-sm font-bold text-white mb-2">📝 Analysis</h3>
        <div className="text-xs text-gray-300 whitespace-pre-line leading-relaxed">
          {analysis.analysis}
        </div>
      </div>

      {/* Warning */}
      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-400">
            This analysis is for informational purposes only and should not be considered as financial advice. Always do your own research and trade responsibly.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PairAnalysis;

