import React, { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickData, 
  LineData, 
  Time,
  CandlestickSeries,
  LineSeries
} from 'lightweight-charts';
import { getExchangeRate } from '../utils/priceApi';

interface PriceChartProps {
  pairKey: string;
  base: string;
  quote: string;
  startPrice: number;
  updateInterval?: number; // Update interval in seconds (default: 10)
}

const PriceChart: React.FC<PriceChartProps> = ({
  pairKey,
  base,
  quote,
  startPrice,
  updateInterval = 10,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState<number | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Create candlestick series
    // Use v5 API with series classes
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    }) as ISeriesApi<'Candlestick'>;

    // Add start price line
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: 2, // Dashed
      title: 'Start Price',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    }) as ISeriesApi<'Line'>;

    // Initialize with start price
    const now = Math.floor(Date.now() / 1000);
    const initialData: CandlestickData[] = [
      {
        time: (now - 3600) as Time, // 1 hour ago
        open: startPrice,
        high: startPrice,
        low: startPrice,
        close: startPrice,
      },
      {
        time: now as Time,
        open: startPrice,
        high: startPrice,
        low: startPrice,
        close: startPrice,
      },
    ];

    candlestickSeries.setData(initialData);
    lineSeries.setData([
      { time: (now - 3600) as Time, value: startPrice },
      { time: now as Time, value: startPrice },
    ]);

    chartRef.current = chart;
    seriesRef.current = candlestickSeries as ISeriesApi<'Candlestick'>;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        try {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        } catch (e) {
          // Chart might be disposed, ignore error
          console.warn('[PriceChart] Error resizing chart:', e);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      // Set refs to null first to prevent further access
      const chartToRemove = chartRef.current;
      chartRef.current = null;
      seriesRef.current = null;
      
      // Remove chart
      if (chartToRemove) {
        try {
          chartToRemove.remove();
        } catch (e) {
          // Chart might already be removed
          console.warn('[PriceChart] Error removing chart:', e);
        }
      }
    };
  }, [pairKey, base, quote, startPrice]);

  // Fetch and update price
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const fetchPrice = async () => {
      try {
        // Check if chart and series are still valid
        if (!seriesRef.current || !chartRef.current) return;
        
        // Verify chart is not disposed
        try {
          chartRef.current.timeScale();
        } catch (e) {
          // Chart is disposed, return early
          return;
        }
        
        const price = await getExchangeRate(base, quote);
        
        // Check again after async operation
        if (!seriesRef.current || !chartRef.current) return;
        
        setCurrentPrice(price);
        
        const change = price - startPrice;
        const changePercent = startPrice > 0 ? (change / startPrice) * 100 : 0;
        setPriceChange(change);
        setPriceChangePercent(changePercent);

        // Update chart with new price
        const now = Math.floor(Date.now() / 1000);
        const newCandle: CandlestickData = {
          time: now as Time,
          open: price,
          high: price,
          low: price,
          close: price,
        };

        // Get last candle or create new one
        if (!seriesRef.current) return;
        
        try {
          const lastCandle = seriesRef.current.data().slice(-1)[0];
          if (lastCandle && 'open' in lastCandle) {
            // Update last candle
            const updatedCandle: CandlestickData = {
              time: lastCandle.time,
              open: lastCandle.open,
              high: Math.max(lastCandle.high, price),
              low: Math.min(lastCandle.low, price),
              close: price,
            };
            seriesRef.current.update(updatedCandle);
          } else {
            seriesRef.current.setData([newCandle]);
          }
        } catch (e) {
          // Series might be disposed, ignore error
          console.warn('[PriceChart] Error updating candle:', e);
        }
      } catch (error) {
        console.error('Error fetching price:', error);
      }
    };

    // Initial fetch
    fetchPrice();

    // Set up interval
    const interval = setInterval(fetchPrice, updateInterval * 1000);

    return () => clearInterval(interval);
  }, [base, quote, startPrice, updateInterval]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Price Info */}
      <div className="mb-4 p-4 bg-dark-800/50 border border-dark-700 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {base}/{quote}
            </h3>
            {currentPrice !== null && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold text-white">
                  {currentPrice.toFixed(4)}
                </span>
                {priceChangePercent !== null && (
                  <span
                    className={`text-sm font-medium ${
                      priceChangePercent >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {priceChangePercent >= 0 ? '+' : ''}
                    {priceChangePercent.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Start Price</p>
            <p className="text-sm font-medium text-gray-300">{startPrice.toFixed(4)}</p>
            {priceChange !== null && (
              <p
                className={`text-xs mt-1 ${
                  priceChange >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {priceChange >= 0 ? '+' : ''}
                {priceChange.toFixed(4)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} className="flex-1 min-h-[500px]" />
    </div>
  );
};

export default PriceChart;

