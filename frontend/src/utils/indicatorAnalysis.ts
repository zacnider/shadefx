/**
 * Technical Indicator Analysis
 * Calculates indicators and provides trading analysis
 */

import { getBinanceHistoricalKlines, BinanceKline } from './binanceApi';
import { getPriceWithFallback } from './coingeckoApi';

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  ema20: number | null;
  ema50: number | null;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
}

export interface TrendAnalysis {
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
  strength: 'strong' | 'moderate' | 'weak';
}

export interface SupportResistance {
  support: number[];
  resistance: number[];
  keyLevels: Array<{ price: number; type: 'support' | 'resistance' | 'neutral'; strength: number }>;
}

export interface TradingRecommendation {
  action: 'long' | 'short' | 'neutral';
  leverage: number; // 1-5
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number; // 0-100
  reasoning: string;
}

export interface PairAnalysis {
  pairKey: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  indicators: IndicatorValues;
  trend: TrendAnalysis;
  recommendation: TradingRecommendation;
  supportResistance: SupportResistance;
  analysis: string;
}

/**
 * Convert BinanceKline to CandlestickData
 */
function convertKlinesToCandles(klines: BinanceKline[]): CandlestickData[] {
  return klines.map(k => ({
    time: Math.floor(k.openTime / 1000),
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  }));
}

/**
 * Calculate SMA (Simple Moving Average)
 */
function calculateSMA(candles: CandlestickData[], period: number): number | null {
  if (candles.length < period) return null;
  const recent = candles.slice(-period);
  const sum = recent.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(candles: CandlestickData[], period: number): number | null {
  if (candles.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  let ema = candles[period - 1].close;
  
  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(candles: CandlestickData[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  if (gains.length < period) return null;
  
  let avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}

/**
 * Calculate all indicators
 */
export async function calculateAllIndicators(
  pairKey: string,
  currentPrice?: number
): Promise<IndicatorValues> {
  // Fetch historical data (1h interval, 30 days for better accuracy)
  const klines = await getBinanceHistoricalKlines(pairKey, '1h', 30);
  const candles = convertKlinesToCandles(klines);
  
  if (candles.length === 0) {
    throw new Error('No historical data available');
  }
  
  // Get current price if not provided
  let price = currentPrice;
  let priceChange24h = 0;
  let volume24h = 0;
  
  if (!price) {
    try {
      const priceResult = await getPriceWithFallback(pairKey);
      price = priceResult.price;
    } catch (error) {
      // Use last candle close price as fallback
      price = candles[candles.length - 1].close;
    }
  }
  
  // Calculate 24h change (compare with 24 candles ago for 1h interval)
  if (candles.length >= 24) {
    const price24hAgo = candles[candles.length - 24].close;
    priceChange24h = ((price - price24hAgo) / price24hAgo) * 100;
  }
  
  // Calculate 24h volume
  if (candles.length >= 24) {
    volume24h = candles.slice(-24).reduce((sum, c) => sum + c.volume, 0);
  }
  
  return {
    rsi: calculateRSI(candles, 14),
    sma20: calculateSMA(candles, 20),
    sma50: calculateSMA(candles, 50),
    sma100: calculateSMA(candles, 100),
    ema20: calculateEMA(candles, 20),
    ema50: calculateEMA(candles, 50),
    currentPrice: price,
    priceChange24h,
    volume24h,
  };
}

/**
 * Analyze trend based on indicators
 */
export function analyzeTrend(indicators: IndicatorValues): TrendAnalysis {
  let bullishSignals = 0;
  let bearishSignals = 0;
  let totalSignals = 0;
  
  const { currentPrice, sma20, sma50, sma100, ema20, ema50, rsi } = indicators;
  
  // Price vs Moving Averages
  if (sma20 && currentPrice > sma20) bullishSignals++;
  else if (sma20 && currentPrice < sma20) bearishSignals++;
  if (sma20) totalSignals++;
  
  if (sma50 && currentPrice > sma50) bullishSignals++;
  else if (sma50 && currentPrice < sma50) bearishSignals++;
  if (sma50) totalSignals++;
  
  if (sma100 && currentPrice > sma100) bullishSignals++;
  else if (sma100 && currentPrice < sma100) bearishSignals++;
  if (sma100) totalSignals++;
  
  // EMA comparison
  if (ema20 && ema50 && ema20 > ema50) bullishSignals++;
  else if (ema20 && ema50 && ema20 < ema50) bearishSignals++;
  if (ema20 && ema50) totalSignals++;
  
  // SMA comparison
  if (sma20 && sma50 && sma20 > sma50) bullishSignals++;
  else if (sma20 && sma50 && sma20 < sma50) bearishSignals++;
  if (sma20 && sma50) totalSignals++;
  
  // RSI analysis
  if (rsi !== null) {
    if (rsi > 70) bearishSignals++; // Overbought
    else if (rsi < 30) bullishSignals++; // Oversold
    else if (rsi > 50) bullishSignals++; // Bullish momentum
    else bearishSignals++; // Bearish momentum
    totalSignals++;
  }
  
  // Calculate confidence
  const bullishRatio = totalSignals > 0 ? bullishSignals / totalSignals : 0.5;
  const bearishRatio = totalSignals > 0 ? bearishSignals / totalSignals : 0.5;
  
  let trend: 'bullish' | 'bearish' | 'neutral';
  let confidence: number;
  
  if (bullishRatio > 0.6) {
    trend = 'bullish';
    confidence = Math.round(bullishRatio * 100);
  } else if (bearishRatio > 0.6) {
    trend = 'bearish';
    confidence = Math.round(bearishRatio * 100);
  } else {
    trend = 'neutral';
    confidence = 50;
  }
  
  // Determine strength
  let strength: 'strong' | 'moderate' | 'weak';
  if (confidence >= 75) strength = 'strong';
  else if (confidence >= 60) strength = 'moderate';
  else strength = 'weak';
  
  return { trend, confidence, strength };
}

/**
 * Calculate support and resistance levels
 */
export function calculateSupportResistance(
  candles: CandlestickData[],
  currentPrice: number
): SupportResistance {
  if (candles.length < 20) {
    return { support: [], resistance: [], keyLevels: [] };
  }
  
  // Use recent 50 candles for better accuracy
  const recentCandles = candles.slice(-50);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  
  // Find local highs (resistance) and lows (support)
  const resistance: number[] = [];
  const support: number[] = [];
  const keyLevels: Array<{ price: number; type: 'support' | 'resistance' | 'neutral'; strength: number }> = [];
  
  // Simple approach: use recent highs and lows
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const priceRange = maxHigh - minLow;
  
  // Resistance levels (above current price)
  const resistance1 = maxHigh;
  const resistance2 = currentPrice + (priceRange * 0.1);
  const resistance3 = currentPrice + (priceRange * 0.2);
  
  if (resistance1 > currentPrice) resistance.push(resistance1);
  if (resistance2 > currentPrice && resistance2 < resistance1) resistance.push(resistance2);
  if (resistance3 > currentPrice && resistance3 < resistance2) resistance.push(resistance3);
  
  // Support levels (below current price)
  const support1 = minLow;
  const support2 = currentPrice - (priceRange * 0.1);
  const support3 = currentPrice - (priceRange * 0.2);
  
  if (support1 < currentPrice) support.push(support1);
  if (support2 < currentPrice && support2 > support1) support.push(support2);
  if (support3 < currentPrice && support3 > support2) support.push(support3);
  
  // Create key levels
  support.forEach(price => {
    keyLevels.push({
      price,
      type: 'support',
      strength: price === support1 ? 0.9 : price === support2 ? 0.7 : 0.5,
    });
  });
  
  resistance.forEach(price => {
    keyLevels.push({
      price,
      type: 'resistance',
      strength: price === resistance1 ? 0.9 : price === resistance2 ? 0.7 : 0.5,
    });
  });
  
  // Sort by price
  keyLevels.sort((a, b) => a.price - b.price);
  
  return { support, resistance, keyLevels };
}

/**
 * Generate trading recommendation
 */
export function generateRecommendation(
  indicators: IndicatorValues,
  trend: TrendAnalysis
): TradingRecommendation {
  const { rsi, currentPrice, sma20, sma50, ema20, ema50 } = indicators;
  
  let action: 'long' | 'short' | 'neutral' = 'neutral';
  let leverage = 1;
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  let confidence = trend.confidence;
  const reasoning: string[] = [];
  
  // Determine action based on trend
  if (trend.trend === 'bullish' && trend.confidence >= 60) {
    action = 'long';
    reasoning.push('Bullish trend detected');
    
    // Leverage based on confidence
    if (trend.confidence >= 80) leverage = 3;
    else if (trend.confidence >= 70) leverage = 2;
    else leverage = 1;
  } else if (trend.trend === 'bearish' && trend.confidence >= 60) {
    action = 'short';
    reasoning.push('Bearish trend detected');
    
    // Leverage based on confidence
    if (trend.confidence >= 80) leverage = 3;
    else if (trend.confidence >= 70) leverage = 2;
    else leverage = 1;
  } else {
    action = 'neutral';
    reasoning.push('Neutral trend - wait for clearer signals');
    leverage = 1;
  }
  
  // Risk assessment
  if (rsi !== null) {
    if (rsi > 70 || rsi < 30) {
      riskLevel = 'high';
      reasoning.push('RSI indicates overbought/oversold conditions');
    } else if (rsi > 60 || rsi < 40) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }
  }
  
  // Moving average alignment
  if (sma20 && sma50 && currentPrice) {
    if (action === 'long' && currentPrice < sma20) {
      riskLevel = 'high';
      reasoning.push('Price below short-term MA - higher risk');
    } else if (action === 'short' && currentPrice > sma20) {
      riskLevel = 'high';
      reasoning.push('Price above short-term MA - higher risk');
    }
  }
  
  // Adjust confidence based on risk
  if (riskLevel === 'high') confidence = Math.max(confidence - 10, 30);
  if (riskLevel === 'low') confidence = Math.min(confidence + 5, 95);
  
  // Build reasoning string
  let reasoningText = reasoning.join('. ');
  if (reasoningText.length === 0) {
    reasoningText = 'Mixed signals - proceed with caution';
  }
  
  return {
    action,
    leverage: Math.min(leverage, 5), // Max 5x
    riskLevel,
    confidence,
    reasoning: reasoningText,
  };
}

/**
 * Generate analysis text
 */
export function generateAnalysisText(
  pairKey: string,
  indicators: IndicatorValues,
  trend: TrendAnalysis,
  recommendation: TradingRecommendation
): string {
  const { currentPrice, rsi, sma20, sma50, ema20, ema50, priceChange24h } = indicators;
  
  const parts: string[] = [];
  
  // Price summary
  parts.push(`Current price: $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (priceChange24h !== 0) {
    parts.push(`24h change: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`);
  }
  
  // Trend analysis
  parts.push(`\nTrend: ${trend.trend.toUpperCase()} (${trend.confidence}% confidence, ${trend.strength})`);
  
  // Indicator summary
  const indicatorParts: string[] = [];
  if (rsi !== null) {
    let rsiStatus = 'Neutral';
    if (rsi > 70) rsiStatus = 'Overbought';
    else if (rsi < 30) rsiStatus = 'Oversold';
    else if (rsi > 50) rsiStatus = 'Bullish';
    else rsiStatus = 'Bearish';
    indicatorParts.push(`RSI: ${rsi.toFixed(1)} (${rsiStatus})`);
  }
  
  if (sma20 && currentPrice) {
    indicatorParts.push(`SMA20: $${sma20.toFixed(2)} (Price ${currentPrice > sma20 ? 'above' : 'below'})`);
  }
  
  if (sma50 && currentPrice) {
    indicatorParts.push(`SMA50: $${sma50.toFixed(2)} (Price ${currentPrice > sma50 ? 'above' : 'below'})`);
  }
  
  if (ema20 && ema50) {
    indicatorParts.push(`EMA20/50: ${ema20 > ema50 ? 'Bullish' : 'Bearish'} crossover`);
  }
  
  if (indicatorParts.length > 0) {
    parts.push(`\nIndicators:\n${indicatorParts.join('\n')}`);
  }
  
  // Recommendation
  parts.push(`\nRecommendation: ${recommendation.action.toUpperCase()} (${recommendation.leverage}x leverage)`);
  parts.push(`Risk Level: ${recommendation.riskLevel.toUpperCase()}`);
  parts.push(`Confidence: ${recommendation.confidence}%`);
  parts.push(`\nReasoning: ${recommendation.reasoning}`);
  
  return parts.join('\n');
}

/**
 * Main function: Analyze pair
 */
export async function analyzePair(pairKey: string): Promise<PairAnalysis> {
  // Calculate indicators
  const indicators = await calculateAllIndicators(pairKey);
  
  // Fetch candles for support/resistance
  const klines = await getBinanceHistoricalKlines(pairKey, '1h', 30);
  const candles = convertKlinesToCandles(klines);
  
  // Analyze trend
  const trend = analyzeTrend(indicators);
  
  // Calculate support/resistance
  const supportResistance = calculateSupportResistance(candles, indicators.currentPrice);
  
  // Generate recommendation
  const recommendation = generateRecommendation(indicators, trend);
  
  // Generate analysis text
  const analysis = generateAnalysisText(pairKey, indicators, trend, recommendation);
  
  return {
    pairKey,
    currentPrice: indicators.currentPrice,
    priceChange24h: indicators.priceChange24h,
    volume24h: indicators.volume24h,
    indicators,
    trend,
    recommendation,
    supportResistance,
    analysis,
  };
}

