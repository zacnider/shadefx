/**
 * AI Agent Input Component - Natural language interface for trading
 */

import React, { useState, useRef, useEffect } from 'react';
import { useIntentExecutor } from '../hooks/useIntentExecutor';
import { parseIntent, validateIntent } from '../utils/intentParser';
import { SparklesIcon, ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

interface AIAgentInputProps {
  onPositionOpened?: (positionId: bigint) => void;
  onPositionClosed?: (positionId: bigint) => void;
  pairKey?: string; // Pre-fill pair if provided
}

const AIAgentInput: React.FC<AIAgentInputProps> = ({
  onPositionOpened,
  onPositionClosed,
  pairKey,
}) => {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { executeIntent, executing } = useIntentExecutor();

  // Example suggestions (English only)
  const exampleSuggestions = [
    'Long BTC 3x',
    'Short ETH 2x',
    'Close BTC position',
    'Set stop loss for BTC at 50000',
    'Set take profit for BTC at 60000',
    'Hedge BTC',
    'Long BTC 3x with stop loss 50000 and take profit 60000',
    'Close 50% of BTC position',
    'Add 100 USDC to BTC position',
  ];

  useEffect(() => {
    // Pre-fill pair if provided
    if (pairKey) {
      const basePair = pairKey.replace('USD', '');
      setInput(`Long ${basePair} `);
    }
  }, [pairKey]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Show suggestions if input is empty or starts with common patterns
    if (value.length === 0 || value.length < 3) {
      setSuggestions(exampleSuggestions);
      setShowSuggestions(true);
    } else {
      // Filter suggestions based on input
      const filtered = exampleSuggestions.filter(s => 
        s.toLowerCase().includes(value.toLowerCase())
      );
      setSuggestions(filtered.length > 0 ? filtered : exampleSuggestions);
      setShowSuggestions(true);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!input.trim()) {
      toast.error('Please enter a command');
      return;
    }

    // Parse and validate intent before executing
    const intent = parseIntent(input);
    const validation = validateIntent(intent);

    if (!validation.valid) {
      toast.error(validation.errors[0] || 'Could not understand the command');
      return;
    }

    // Show preview
    const preview = getIntentPreview(intent);
    if (preview) {
      toast.info(preview, { autoClose: 3000 });
    }

    // Execute intent
    try {
      const result = await executeIntent(input, {
        onPositionOpened,
        onPositionClosed,
      });

      if (result.success) {
        toast.success(result.message || 'Operation completed successfully');
        setInput(''); // Clear input on success
        setShowSuggestions(false);
      } else {
        const errorMsg = result.message || 'Operation failed';
        toast.error(typeof errorMsg === 'string' ? errorMsg : 'Operation failed. Please try again.');
      }
    } catch (error: any) {
      console.error('[AIAgentInput] Error executing intent:', error);
      const errorMsg = error?.message || error?.reason || 'Failed to execute command. Please try again.';
      toast.error(typeof errorMsg === 'string' ? errorMsg : 'Failed to execute command. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="relative w-full">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <div className="absolute left-3 text-primary-400">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Delay to allow suggestion click
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            placeholder="Example: Long BTC 3x, Close ETH, Set stop loss for BTC at 50000..."
            className="w-full pl-10 pr-12 py-3 bg-dark-800 border border-dark-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            disabled={executing}
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput('');
                setShowSuggestions(false);
              }}
              className="absolute right-12 text-gray-400 hover:text-white"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
          <button
            type="submit"
            disabled={executing || !input.trim()}
            className="absolute right-2 p-2 bg-primary-500 hover:bg-primary-600 disabled:bg-dark-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {executing ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <ArrowRightIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-dark-800 border border-dark-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          <div className="p-2 text-xs text-gray-400 border-b border-dark-700">
            Example commands:
          </div>
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-dark-700 hover:text-white transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Intent preview */}
      {input && !executing && (() => {
        const intent = parseIntent(input);
        if (intent.action !== 'unknown') {
          const preview = getIntentPreview(intent);
          if (preview) {
            return (
              <div className="mt-2 px-3 py-2 bg-primary-500/10 border border-primary-500/30 rounded-lg text-xs text-primary-400">
                {preview}
              </div>
            );
          }
        }
        return null;
      })()}
    </div>
  );
};

/**
 * Get human-readable preview of intent
 */
function getIntentPreview(intent: ReturnType<typeof parseIntent>): string | null {
  switch (intent.action) {
    case 'open':
      return `Open: ${intent.direction === 'long' ? 'Long' : 'Short'} ${intent.pair} ${intent.leverage}x${intent.collateral ? ` (${intent.collateral} USDC)` : ''}${intent.stopLoss ? `, SL: $${intent.stopLoss.toLocaleString()}` : ''}${intent.takeProfit ? `, TP: $${intent.takeProfit.toLocaleString()}` : ''}`;
    case 'close':
      return `Close: ${intent.pair} position`;
    case 'partialClose':
      return `Partial Close: ${intent.closePercentage}% of ${intent.pair} position`;
    case 'setStopLoss':
      return `Stop Loss: ${intent.pair} at $${intent.stopLoss?.toLocaleString()}`;
    case 'setTakeProfit':
      return `Take Profit: ${intent.pair} at $${intent.takeProfit?.toLocaleString()}`;
    case 'hedge':
      return `Hedge: Open opposite position for ${intent.pair}`;
    case 'addToPosition':
      return `Add: ${intent.additionalCollateral} USDC to ${intent.pair} position`;
    default:
      return null;
  }
}

export default AIAgentInput;

