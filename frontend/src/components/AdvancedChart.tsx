import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickData, 
  HistogramData,
  LineData, 
  Time,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
} from 'lightweight-charts';
import { Position } from '../utils/perpdexContract';
import { 
  BinanceWebSocket, 
  getBinanceTickerStream, 
  getBinanceKlineStream,
  parseBinanceTicker,
  parseBinanceKline,
  convertToBinanceSymbol
} from '../utils/binanceWebSocket';
import { getBinanceHistoricalKlines } from '../utils/binanceApi';

export type IndicatorType = 'SMA20' | 'SMA50' | 'SMA100' | 'EMA20' | 'EMA50' | 'RSI' | 'MACD' | 'BB';

interface AdvancedChartProps {
  symbol: string; // e.g., 'BTC', 'ETH'
  pairKey?: string; // Optional pair key for PerpDEX
  height?: number;
  showVolume?: boolean;
  timeframe?: '5m' | '30m' | '1h' | '12h' | '1d';
  onTimeframeChange?: (timeframe: '5m' | '30m' | '1h' | '12h' | '1d') => void;
  positions?: Position[]; // Optional: positions to show entry price markers for
}

const AdvancedChart: React.FC<AdvancedChartProps> = ({
  symbol,
  pairKey,
  height = 500,
  showVolume = true,
  timeframe: initialTimeframe = '5m',
  onTimeframeChange,
  positions = [],
}) => {
  const [timeframe, setTimeframe] = useState<'5m' | '30m' | '1h' | '12h' | '1d'>(initialTimeframe);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const entryPriceLinesRef = useRef<Map<bigint, ISeriesApi<'Line'>>>(new Map());
  const indicatorsRef = useRef<Map<IndicatorType, ISeriesApi<'Line'>>>(new Map());
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorType>>(new Set());
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const indicatorMenuRef = useRef<HTMLDivElement>(null);
  
  // Close indicator menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(event.target as Node)) {
        setShowIndicatorMenu(false);
      }
    };
    
    if (showIndicatorMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showIndicatorMenu]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState<number | null>(null);
  const [containerHeight, setContainerHeight] = useState<number>(height || 500);
  const tickerWsRef = useRef<BinanceWebSocket | null>(null);
  const klineWsRef = useRef<BinanceWebSocket | null>(null);

  // Normalize symbol: extract base currency from pair (e.g., "BTCUSD" -> "BTC", "BTC" -> "BTC")
  const normalizedSymbol = useMemo(() => {
    return symbol.toUpperCase().endsWith('USD') 
      ? symbol.toUpperCase().replace('USD', '')
      : symbol.toUpperCase();
  }, [symbol]);

  // Map timeframe to days for historical data
  // More days for longer timeframes to show more history
  const timeframeToDays: Record<string, number> = {
    '5m': 7,    // 7 days = ~2000 candles (enough for 5m chart)
    '30m': 30,  // 30 days = ~1440 candles (enough for 30m chart)
    '1h': 90,   // 90 days = ~2160 candles (enough for 1h chart)
    '12h': 180, // 180 days = ~360 candles (enough for 12h chart)
    '1d': 365,  // 365 days = 365 candles (1 year of daily data)
  };

  // Measure container height dynamically
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const updateHeight = () => {
      if (chartContainerRef.current) {
        // Get the chart container's parent (the flex-1 div)
        const chartWrapper = chartContainerRef.current.parentElement;
        if (chartWrapper) {
          // Use the full available height of the wrapper
          const newHeight = chartWrapper.clientHeight;
          setContainerHeight(Math.max(newHeight, 300)); // Minimum 300px
        }
      }
    };
    
    updateHeight();
    const resizeObserver = new ResizeObserver(updateHeight);
    if (chartContainerRef.current.parentElement) {
      resizeObserver.observe(chartContainerRef.current.parentElement);
    }
    
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Use dynamic height if height prop is undefined, otherwise use prop
    const chartHeight = height !== undefined ? height : containerHeight;

    // Create chart with dark theme
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { 
          color: '#1f2937',
          style: 1, // Solid
        },
        horzLines: { 
          color: '#1f2937',
          style: 1, // Solid
        },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#374151',
        rightOffset: 5,
        barSpacing: 8,
        fixLeftEdge: false,
        fixRightEdge: true,
        visible: true,
        ticksVisible: true,
      },
      rightPriceScale: {
        borderColor: '#374151',
        scaleMargins: {
          top: 0.05,
          bottom: 0.2, // Space for time scale - reduced for better visibility
        },
      },
      crosshair: {
        mode: 0, // Normal
        vertLine: {
          color: '#6366f1',
          width: 1,
          style: 2, // Dashed
        },
        horzLine: {
          color: '#6366f1',
          width: 1,
          style: 2, // Dashed
        },
      },
    });

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    }) as ISeriesApi<'Candlestick'>;

    candlestickSeriesRef.current = candlestickSeries;

    // Create volume series if enabled
    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#6366f1',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      }) as ISeriesApi<'Histogram'>;

      volumeSeriesRef.current = volumeSeries;

      // Configure price scale for volume after series is added
      // Use setTimeout to ensure price scale is ready
      setTimeout(() => {
        try {
          const volumeScale = chart.priceScale('volume');
          if (volumeScale) {
            volumeScale.applyOptions({
              scaleMargins: {
                top: 0.8,
                bottom: 0,
              },
            });
          }
        } catch (err) {
          // Price scale might not be ready yet, ignore error
          console.warn('Could not configure volume price scale:', err);
        }
      }, 100);
    }

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        try {
          const currentHeight = height !== undefined ? height : containerHeight;
          chartRef.current.applyOptions({ 
            width: chartContainerRef.current.clientWidth,
            height: currentHeight
          });
        } catch (e) {
          // Chart might be disposed, ignore error
          console.warn('[AdvancedChart] Error resizing chart:', e);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      // Set chart ref to null first to prevent further access
      const chartToRemove = chartRef.current;
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      
      // Clean up entry price lines
      entryPriceLinesRef.current.forEach((line) => {
        try {
          if (chartToRemove) {
            chartToRemove.removeSeries(line);
          }
        } catch (e) {
          // Ignore errors during cleanup
        }
      });
      entryPriceLinesRef.current.clear();
      
      // Clean up indicators
      indicatorsRef.current.forEach((indicator) => {
        try {
          if (chartToRemove) {
            chartToRemove.removeSeries(indicator);
          }
        } catch (e) {
          // Ignore errors
        }
      });
      indicatorsRef.current.clear();
      
      // Clean up WebSocket connections
      if (tickerWsRef.current) {
        try {
          tickerWsRef.current.disconnect();
        } catch (e) {
          console.warn('[AdvancedChart] Error disconnecting ticker WebSocket:', e);
        }
        tickerWsRef.current = null;
      }
      if (klineWsRef.current) {
        try {
          klineWsRef.current.disconnect();
        } catch (e) {
          console.warn('[AdvancedChart] Error disconnecting kline WebSocket:', e);
        }
        klineWsRef.current = null;
      }
      
      // Remove chart last
      if (chartToRemove) {
        try {
          chartToRemove.remove();
        } catch (e) {
          // Chart might already be removed
          console.warn('[AdvancedChart] Error removing chart:', e);
        }
      }
    };
  }, [normalizedSymbol, height, showVolume, containerHeight]);

  // Calculate indicators
  const calculateSMA = (candles: CandlestickData[], period: number): LineData[] => {
    const smaData: LineData[] = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      smaData.push({
        time: candles[i].time,
        value: sum / period,
      });
    }
    return smaData;
  };

  const calculateEMA = (candles: CandlestickData[], period: number): LineData[] => {
    const emaData: LineData[] = [];
    const multiplier = 2 / (period + 1);
    let ema = candles[period - 1].close;
    
    emaData.push({
      time: candles[period - 1].time,
      value: ema,
    });
    
    for (let i = period; i < candles.length; i++) {
      ema = (candles[i].close - ema) * multiplier + ema;
      emaData.push({
        time: candles[i].time,
        value: ema,
      });
    }
    return emaData;
  };

  const calculateRSI = (candles: CandlestickData[], period: number = 14): LineData[] => {
    const rsiData: LineData[] = [];
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    if (gains.length < period) return rsiData;
    
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < candles.length; i++) {
      if (avgLoss === 0) {
        rsiData.push({ time: candles[i].time, value: 100 });
      } else {
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiData.push({ time: candles[i].time, value: rsi });
      }
      
      avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    }
    
    return rsiData;
  };

  const updateIndicators = useCallback((candles: CandlestickData[]) => {
    if (!chartRef.current || !candlestickSeriesRef.current) return;
    
    const chart = chartRef.current;
    
    // Check if chart is still valid
    try {
      chart.timeScale();
    } catch (e) {
      // Chart is disposed, return early
      return;
    }
    
    // Remove inactive indicators
    indicatorsRef.current.forEach((indicator, indicatorType) => {
      if (!activeIndicators.has(indicatorType)) {
        try {
          chart.removeSeries(indicator);
          indicatorsRef.current.delete(indicatorType);
        } catch (e) {
          // Ignore errors
        }
      }
    });
    
    // Add/update active indicators
    activeIndicators.forEach((indicatorType) => {
      let data: LineData[] = [];
      let color = '#8b5cf6';
      let title = '';
      
      switch (indicatorType) {
        case 'SMA20':
          if (candles.length >= 20) {
            data = calculateSMA(candles, 20);
            color = '#8b5cf6';
            title = 'SMA 20';
          }
          break;
        case 'SMA50':
          if (candles.length >= 50) {
            data = calculateSMA(candles, 50);
            color = '#3b82f6';
            title = 'SMA 50';
          }
          break;
        case 'SMA100':
          if (candles.length >= 100) {
            data = calculateSMA(candles, 100);
            color = '#06b6d4';
            title = 'SMA 100';
          }
          break;
        case 'EMA20':
          if (candles.length >= 20) {
            data = calculateEMA(candles, 20);
            color = '#f59e0b';
            title = 'EMA 20';
          }
          break;
        case 'EMA50':
          if (candles.length >= 50) {
            data = calculateEMA(candles, 50);
            color = '#ef4444';
            title = 'EMA 50';
          }
          break;
        case 'RSI':
          if (candles.length >= 15) {
            data = calculateRSI(candles, 14);
            color = '#10b981';
            title = 'RSI';
          }
          break;
      }
      
      if (data.length > 0) {
        if (indicatorsRef.current.has(indicatorType)) {
          // Update existing indicator
          indicatorsRef.current.get(indicatorType)!.setData(data);
        } else {
          // Create new indicator
          const series = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lineStyle: 0, // Solid
            title,
            priceLineVisible: false,
            lastValueVisible: true,
            priceScaleId: indicatorType === 'RSI' ? 'rsi' : undefined,
            priceFormat: indicatorType === 'RSI' ? undefined : {
              type: 'price',
              precision: 4,
              minMove: 0.0001,
            },
          }) as ISeriesApi<'Line'>;
          
          series.setData(data);
          indicatorsRef.current.set(indicatorType, series);
          
          // Configure RSI scale (0-100)
          if (indicatorType === 'RSI' && chart.priceScale('rsi')) {
            chart.priceScale('rsi')!.applyOptions({
              scaleMargins: {
                top: 0.8,
                bottom: 0,
              },
            });
          }
        }
      }
    });
  }, [activeIndicators]);

  // Update indicators when activeIndicators changes
  useEffect(() => {
    if (candlestickSeriesRef.current && chartRef.current) {
      // Trigger indicator update by getting current candle data
      const currentData = candlestickSeriesRef.current.data();
      if (currentData && currentData.length > 0) {
        updateIndicators(currentData as CandlestickData[]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators]);

  // Add entry price markers for positions
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current) {
      // Remove all existing entry price lines if chart is not available
      entryPriceLinesRef.current.forEach((line) => {
        try {
          if (chartRef.current) {
            chartRef.current.removeSeries(line);
          }
        } catch (e) {
          // Ignore errors
        }
      });
      entryPriceLinesRef.current.clear();
      return;
    }

    // Check if chart is still valid
    let chart: IChartApi;
    try {
      chart = chartRef.current;
      chart.timeScale(); // Test if chart is disposed
    } catch (e) {
      // Chart is disposed, return early
      return;
    }
    
    if (positions.length === 0) {
      // Remove all existing entry price lines if no positions
      entryPriceLinesRef.current.forEach((line) => {
        try {
          chart.removeSeries(line);
        } catch (e) {
          // Ignore errors
        }
      });
      entryPriceLinesRef.current.clear();
      return;
    }
    const normalizedPairKey = pairKey 
      ? (pairKey.toUpperCase().endsWith('USD') ? pairKey.toUpperCase() : `${pairKey.toUpperCase()}USD`)
      : undefined;

    // Filter positions for this pair (or show all if no pairKey filter)
    const relevantPositions = normalizedPairKey
      ? positions.filter(p => {
          const posPairKey = p.pairKey.toUpperCase().endsWith('USD') 
            ? p.pairKey.toUpperCase() 
            : `${p.pairKey.toUpperCase()}USD`;
          return posPairKey === normalizedPairKey && p.isOpen;
        })
      : positions.filter(p => p.isOpen);

    // Remove lines for positions that no longer exist
    const currentPositionIds = new Set(relevantPositions.map(p => p.positionId.toString()));
    entryPriceLinesRef.current.forEach((line, positionId) => {
      if (!currentPositionIds.has(positionId.toString())) {
        try {
          // Check if chart is still valid before removing series
          try {
            chart.timeScale();
            chart.removeSeries(line);
          } catch (e) {
            // Chart is disposed, just remove from map
          }
          entryPriceLinesRef.current.delete(positionId);
        } catch (e) {
          // Ignore errors
        }
      }
    });

    // Add or update lines for current positions
    relevantPositions.forEach((position) => {
      try {
        // Check if chart is still valid
        chart.timeScale();
      } catch (e) {
        // Chart is disposed, return early
        return;
      }
      
      const entryPrice = Number(position.entryPrice) / 1e8; // PRICE_PRECISION = 1e8
      const positionId = position.positionId;
      
      if (entryPriceLinesRef.current.has(positionId)) {
        // Update existing line
        const line = entryPriceLinesRef.current.get(positionId)!;
        try {
          const now = Math.floor(Date.now() / 1000);
          const startTime = Number(position.timestamp);
          line.setData([
            { time: startTime as Time, value: entryPrice },
            { time: now as Time, value: entryPrice },
          ]);
        } catch (e) {
          // Line might be disposed, remove from map
          entryPriceLinesRef.current.delete(positionId);
        }
      } else {
        // Create new line
        try {
          const lineSeries = chart.addSeries(LineSeries, {
          color: '#6366f1',
          lineWidth: 2,
          lineStyle: 1, // Solid
          title: `Entry #${positionId.toString()}`,
          priceLineVisible: true,
          lastValueVisible: true,
          priceFormat: {
            type: 'price',
            precision: 4,
            minMove: 0.0001,
          },
        }) as ISeriesApi<'Line'>;

          const now = Math.floor(Date.now() / 1000);
          const startTime = Number(position.timestamp);
          lineSeries.setData([
            { time: startTime as Time, value: entryPrice },
            { time: now as Time, value: entryPrice },
          ]);

          entryPriceLinesRef.current.set(positionId, lineSeries);
        } catch (e) {
          // Chart might be disposed, ignore error
          console.warn('[AdvancedChart] Error adding entry price line:', e);
        }
      }
    });
  }, [positions, pairKey]);

  // Load historical data
  useEffect(() => {
    if (!candlestickSeriesRef.current || !chartRef.current) return;

    const loadHistoricalData = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log('[AdvancedChart] Loading historical data for:', normalizedSymbol, timeframe);
        const days = timeframeToDays[timeframe] || 7;
        
        // Use Binance REST API for historical data
        const klines = await getBinanceHistoricalKlines(normalizedSymbol, timeframe, days);
        console.log('[AdvancedChart] Received', klines.length, 'klines from Binance');

        if (klines.length === 0) {
          throw new Error('No historical data available');
        }

        const candles: CandlestickData[] = [];
        const volumes: HistogramData[] = [];

        // Convert Binance klines to chart format
        for (const kline of klines) {
          const timestamp = Math.floor(kline.openTime / 1000);
          candles.push({
            time: timestamp as Time,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
          });
          
          if (showVolume && volumeSeriesRef.current && kline.volume > 0) {
            volumes.push({
              time: timestamp as Time,
              value: kline.volume,
              color: kline.close >= kline.open ? '#10b981' : '#ef4444',
            });
          }
        }

        console.log('[AdvancedChart] Converted to', candles.length, 'candles');

        // Set data on chart
        if (candlestickSeriesRef.current) {
          candlestickSeriesRef.current.setData(candles);
          console.log('[AdvancedChart] Set candles data on chart');
        }

        if (showVolume && volumeSeriesRef.current && volumes.length > 0) {
          volumeSeriesRef.current.setData(volumes);
          console.log('[AdvancedChart] Set volume data on chart');
        }

        // Update indicators with historical data
        if (activeIndicators.size > 0 && updateIndicators) {
          updateIndicators(candles);
        }

        // Set initial price from last candle
        if (candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          setCurrentPrice(lastCandle.close);
          if (candles.length > 1) {
            const firstCandle = candles[0];
            const change = lastCandle.close - firstCandle.close;
            const changePercent = firstCandle.close > 0 ? (change / firstCandle.close) * 100 : 0;
            setPriceChange(change);
            setPriceChangePercent(changePercent);
          }
        }

        setLoading(false);
      } catch (err: any) {
        console.error('[AdvancedChart] Error loading historical data:', err);
        setError(err.message || 'Failed to load historical data');
        setLoading(false);
        
        // Don't dispose chart on error, just show error message
        // Chart will remain visible with previous data
      }
    };

    // Only load if chart is ready
    if (chartRef.current && candlestickSeriesRef.current) {
      loadHistoricalData();
    }
  }, [normalizedSymbol, timeframe, showVolume]);

  // WebSocket for real-time updates
  useEffect(() => {
    // Wait for chart to be ready before connecting WebSocket
    if (!candlestickSeriesRef.current || !chartRef.current) {
      // Retry mechanism: check every 200ms, max 10 times (2 seconds total)
      let retryCount = 0;
      const maxRetries = 10;
      const retryInterval = 200;
      
      const checkChart = setInterval(() => {
        retryCount++;
        if (candlestickSeriesRef.current && chartRef.current) {
          // Chart is ready, clear interval and trigger useEffect again
          clearInterval(checkChart);
          if (process.env.NODE_ENV === 'development') {
            console.log('[AdvancedChart] Chart ready after', retryCount * retryInterval, 'ms');
          }
        } else if (retryCount >= maxRetries) {
          // Max retries reached, give up
          clearInterval(checkChart);
          if (process.env.NODE_ENV === 'development') {
            console.warn('[AdvancedChart] Chart not ready after', maxRetries * retryInterval, 'ms, giving up');
          }
        }
      }, retryInterval);
      
      return () => clearInterval(checkChart);
    }

    // Disconnect existing connections safely
    if (tickerWsRef.current) {
      try {
        tickerWsRef.current.disconnect();
      } catch (e) {
        console.warn('[AdvancedChart] Error disconnecting ticker WebSocket:', e);
      }
      tickerWsRef.current = null;
    }
    if (klineWsRef.current) {
      try {
        klineWsRef.current.disconnect();
      } catch (e) {
        console.warn('[AdvancedChart] Error disconnecting kline WebSocket:', e);
      }
      klineWsRef.current = null;
    }

    // Map timeframe to Binance kline interval
    const intervalMap: Record<string, string> = {
      '5m': '5m',
      '30m': '30m',
      '1h': '1h',
      '12h': '12h',
      '1d': '1d',
    };
    const binanceInterval = intervalMap[timeframe] || '1h';

    // Connect ticker WebSocket for current price
    const tickerWs = new BinanceWebSocket(getBinanceTickerStream(normalizedSymbol));
    
    // Log WebSocket connection status
    tickerWs.onOpen(() => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AdvancedChart] Ticker WebSocket connected for', normalizedSymbol);
      }
    });
    
    tickerWs.onError((error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AdvancedChart] Ticker WebSocket error:', error);
      }
    });
    
    tickerWs.onMessage((data) => {
      try {
        // Check if chart is still valid before updating state
        if (!chartRef.current || !candlestickSeriesRef.current) return;
        
        // Verify chart is not disposed
        try {
          chartRef.current.timeScale();
        } catch (e) {
          // Chart is disposed, don't update
          return;
        }
        
        const ticker = parseBinanceTicker(data);
        setCurrentPrice(ticker.price);
        setPriceChange(ticker.priceChange);
        setPriceChangePercent(ticker.priceChangePercent);
        
        if (process.env.NODE_ENV === 'development') {
          // Log price updates occasionally (every 10th update to avoid spam)
          if (Math.random() < 0.1) {
            console.log('[AdvancedChart] Price update:', ticker.price, 'for', normalizedSymbol);
          }
        }
      } catch (error) {
        console.error('[AdvancedChart] Error processing ticker:', error);
      }
    });
    tickerWs.connect();
    tickerWsRef.current = tickerWs;

    // Connect kline WebSocket for real-time candlestick updates
    const klineWs = new BinanceWebSocket(getBinanceKlineStream(normalizedSymbol, binanceInterval));
    
    // Log WebSocket connection status
    klineWs.onOpen(() => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AdvancedChart] Kline WebSocket connected for', normalizedSymbol, 'interval', binanceInterval);
      }
    });
    
    klineWs.onError((error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AdvancedChart] Kline WebSocket error:', error);
      }
    });
    
    klineWs.onMessage((data) => {
      try {
        // Check if chart and series are still valid
        if (!chartRef.current || !candlestickSeriesRef.current) return;
        
        // Verify chart is not disposed
        try {
          chartRef.current.timeScale();
        } catch (e) {
          // Chart is disposed, return early
          return;
        }
        
        const kline = parseBinanceKline(data);
        
        if (candlestickSeriesRef.current) {
          const timestamp = Math.floor(kline.openTime / 1000);
          const candle: CandlestickData = {
            time: timestamp as Time,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
          };
          
          // Get current candles to check if this is a new candle or update to existing
          const currentData = candlestickSeriesRef.current.data();
          const currentCandles = currentData.filter(
            (item): item is CandlestickData => 
              'open' in item && 'high' in item && 'low' in item && 'close' in item
          );
          
          // Check if this candle already exists (same timestamp)
          const existingCandleIndex = currentCandles.findIndex(c => c.time === candle.time);
          
          if (existingCandleIndex >= 0) {
            // Update existing candle (real-time update within same period)
            candlestickSeriesRef.current.update(candle);
          } else {
            // New candle - check if we need to close previous candle
            // Get the last candle
            if (currentCandles.length > 0) {
              const lastCandle = currentCandles[currentCandles.length - 1];
              // If new candle's time is after last candle's time, add it
              // Otherwise, it might be a missing historical candle - add it anyway
              if (candle.time > lastCandle.time) {
                // Normal case: new candle after last one
                candlestickSeriesRef.current.update(candle);
              } else {
                // Historical candle or out-of-order: insert it
                // Get all candles up to this time, add new one, then add remaining
                const beforeCandle = currentCandles.filter(c => c.time < candle.time);
                const afterCandle = currentCandles.filter(c => c.time > candle.time);
                const updatedCandles = [...beforeCandle, candle, ...afterCandle];
                candlestickSeriesRef.current.setData(updatedCandles);
              }
            } else {
              // No existing candles, just add this one
              candlestickSeriesRef.current.update(candle);
            }
          }
          
          // Update volume
          if (showVolume && volumeSeriesRef.current) {
            const volume: HistogramData = {
              time: timestamp as Time,
              value: kline.volume,
              color: kline.close >= kline.open ? '#10b981' : '#ef4444',
            };
            volumeSeriesRef.current.update(volume);
          }
          
          // Update indicators when candle is closed
          if (kline.isClosed && activeIndicators.size > 0 && updateIndicators) {
            // Get updated candles list
            const updatedData = candlestickSeriesRef.current.data();
            const updatedCandles = updatedData.filter(
              (item): item is CandlestickData => 
                'open' in item && 'high' in item && 'low' in item && 'close' in item
            );
            updateIndicators(updatedCandles);
          }
          
          // Update current price from latest candle
          setCurrentPrice(kline.close);
        }
      } catch (error) {
        console.error('[AdvancedChart] Error processing kline:', error);
      }
    });
    klineWs.connect();
    klineWsRef.current = klineWs;

    return () => {
      // Cleanup WebSocket connections
      try {
        if (tickerWsRef.current) {
          tickerWsRef.current.disconnect();
          tickerWsRef.current = null;
        }
      } catch (e) {
        console.warn('[AdvancedChart] Error cleaning up ticker WebSocket:', e);
      }
      try {
        if (klineWsRef.current) {
          klineWsRef.current.disconnect();
          klineWsRef.current = null;
        }
      } catch (e) {
        console.warn('[AdvancedChart] Error cleaning up kline WebSocket:', e);
      }
    };
  }, [normalizedSymbol, timeframe, showVolume]);

  return (
    <div className="w-full h-full flex flex-col" style={{ padding: 0, margin: 0 }}>
      {/* Compact Price Info Header */}
      <div className="mb-1 px-2 py-1 bg-dark-800/50 border border-dark-700 rounded flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold text-white">
              {normalizedSymbol}/USD
            </h3>
            {loading ? (
              <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : currentPrice !== null ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                </span>
                {priceChangePercent !== null && (
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      priceChangePercent >= 0 
                        ? 'text-green-400 bg-green-500/10' 
                        : 'text-red-400 bg-red-500/10'
                    }`}
                  >
                    {priceChangePercent >= 0 ? '+' : ''}
                    {priceChangePercent.toFixed(2)}%
                  </span>
                )}
              </div>
            ) : error ? (
              <div className="text-xs text-red-400">{error}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {/* Indicator selector */}
            <div className="relative" ref={indicatorMenuRef}>
              <button
                onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                className={`px-2 py-0.5 text-xs font-medium bg-dark-900 rounded transition-colors ${
                  activeIndicators.size > 0
                    ? 'text-primary-400 border border-primary-500/50'
                    : 'text-gray-400 hover:text-white hover:bg-dark-800'
                }`}
              >
                Indicators {activeIndicators.size > 0 && `(${activeIndicators.size})`}
              </button>
              {showIndicatorMenu && (
                <div className="absolute top-full right-0 mt-1 bg-dark-900 border border-dark-700 rounded-lg shadow-xl z-50 p-2 min-w-[180px]">
                  <div className="text-xs font-semibold text-gray-400 mb-2 px-2">Moving Averages</div>
                  {(['SMA20', 'SMA50', 'SMA100', 'EMA20', 'EMA50'] as IndicatorType[]).map((indicator) => (
                    <label key={indicator} className="flex items-center gap-2 px-2 py-1 hover:bg-dark-800 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeIndicators.has(indicator)}
                        onChange={(e) => {
                          const newSet = new Set(activeIndicators);
                          if (e.target.checked) {
                            newSet.add(indicator);
                          } else {
                            newSet.delete(indicator);
                          }
                          setActiveIndicators(newSet);
                        }}
                        className="w-3 h-3 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-xs text-white">{indicator}</span>
                    </label>
                  ))}
                  <div className="border-t border-dark-700 my-2"></div>
                  <div className="text-xs font-semibold text-gray-400 mb-2 px-2">Oscillators</div>
                  {(['RSI'] as IndicatorType[]).map((indicator) => (
                    <label key={indicator} className="flex items-center gap-2 px-2 py-1 hover:bg-dark-800 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeIndicators.has(indicator)}
                        onChange={(e) => {
                          const newSet = new Set(activeIndicators);
                          if (e.target.checked) {
                            newSet.add(indicator);
                          } else {
                            newSet.delete(indicator);
                          }
                          setActiveIndicators(newSet);
                        }}
                        className="w-3 h-3 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-xs text-white">{indicator}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {/* Timeframe selector */}
            <div className="flex gap-0.5 bg-dark-900 rounded p-0.5">
              {(['5m', '30m', '1h', '12h', '1d'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => {
                    setTimeframe(tf);
                    onTimeframeChange?.(tf);
                  }}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-dark-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0" style={{ padding: 0, margin: 0 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900/50 rounded-lg z-10">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-primary-500 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-400 text-sm">Loading chart data...</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900/50 rounded-lg z-10">
            <div className="text-center p-4">
              <p className="text-red-400 mb-2">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="text-sm text-primary-400 hover:text-primary-300"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" style={{ minHeight: '300px', padding: 0, margin: 0 }} />
      </div>
    </div>
  );
};

export default AdvancedChart;

