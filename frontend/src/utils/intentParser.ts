/**
 * Intent Parser - Advanced Regex/rule-based natural language processing
 * Supports English for position opening, closing, and management
 * Comprehensive command understanding with pair validation and fuzzy matching
 */

export interface ParsedIntent {
  action: 'open' | 'close' | 'setStopLoss' | 'setTakeProfit' | 'hedge' | 'partialClose' | 'addToPosition' | 'unknown';
  pair?: string;
  direction?: 'long' | 'short';
  leverage?: number;
  collateral?: number;
  stopLoss?: number;
  takeProfit?: number;
  closePercentage?: number; // For partial close (1-100)
  additionalCollateral?: number; // For add to position
  confidence: number; // 0-1, how confident we are in the parsing
  originalText: string;
}

// Pair name mappings for fuzzy matching
const PAIR_ALIASES: Record<string, string> = {
  // Full names
  'bitcoin': 'BTC',
  'ethereum': 'ETH',
  'solana': 'SOL',
  'cardano': 'ADA',
  'polkadot': 'DOT',
  'chainlink': 'LINK',
  'uniswap': 'UNI',
  'avalanche': 'AVAX',
  'cosmos': 'ATOM',
  'algorand': 'ALGO',
  'filecoin': 'FIL',
  'litecoin': 'LTC',
  'tron': 'TRX',
  'stellar': 'XLM',
  'ripple': 'XRP',
  'dogecoin': 'DOGE',
  'vechain': 'VET',
  'binancecoin': 'BNB',
  'ethereum-classic': 'ETC',
  
  // Common variations
  'btc': 'BTC',
  'eth': 'ETH',
  'sol': 'SOL',
  'ada': 'ADA',
  'dot': 'DOT',
  'link': 'LINK',
  'uni': 'UNI',
  'avax': 'AVAX',
  'atom': 'ATOM',
  'algo': 'ALGO',
  'fil': 'FIL',
  'ltc': 'LTC',
  'trx': 'TRX',
  'xlm': 'XLM',
  'xrp': 'XRP',
  'doge': 'DOGE',
  'vet': 'VET',
  'bnb': 'BNB',
  'etc': 'ETC',
};

/**
 * Fuzzy match pair name (e.g., "Bitcoin" → "BTC", "Ethereum" → "ETH")
 */
function fuzzyMatchPair(input: string): string | null {
  const normalized = input.toLowerCase().trim();
  
  // Direct match
  if (PAIR_ALIASES[normalized]) {
    return PAIR_ALIASES[normalized];
  }
  
  // Partial match (e.g., "bitcoin" contains "btc")
  for (const [alias, symbol] of Object.entries(PAIR_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return symbol;
    }
  }
  
  // If input is already a valid symbol (3-4 uppercase letters), use it
  if (/^[A-Z]{2,5}$/.test(input.toUpperCase())) {
    return input.toUpperCase();
  }
  
  return null;
}

/**
 * Normalize pair name (e.g., "BTC" -> "BTCUSD", "btc" -> "BTCUSD")
 */
function normalizePair(pair: string): string {
  // First try fuzzy matching
  const fuzzyMatched = fuzzyMatchPair(pair);
  const baseSymbol = fuzzyMatched || pair.toUpperCase();
  
  // Remove "USD" if already present
  const base = baseSymbol.replace(/USD$/, '');
  // Add "USD" if not present
  return base.endsWith('USD') ? base : `${base}USD`;
}

/**
 * Extract all numbers from text (for flexible parameter extraction)
 */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  return matches ? matches.map(m => parseFloat(m)) : [];
}

/**
 * Extract direction from text
 */
function extractDirection(text: string): 'long' | 'short' {
  const normalized = text.toLowerCase();
  if (normalized.includes('long') || normalized.includes('buy')) {
    return 'long';
  }
  if (normalized.includes('short') || normalized.includes('sell')) {
    return 'short';
  }
  // Default to long if not specified
  return 'long';
}

/**
 * Extract leverage from text (looks for "3x", "3 x", "leverage 3", etc.)
 */
function extractLeverage(text: string): number | null {
  // Pattern 1: "3x", "3 x", "3X"
  const xPattern = /(\d+(?:\.\d+)?)\s*x/i;
  const xMatch = text.match(xPattern);
  if (xMatch) {
    return parseInt(xMatch[1], 10);
  }
  
  // Pattern 2: "leverage 3", "3x leverage"
  const leveragePattern = /(?:leverage|lev)\s*(\d+(?:\.\d+)?)/i;
  const leverageMatch = text.match(leveragePattern);
  if (leverageMatch) {
    return parseInt(leverageMatch[1], 10);
  }
  
  return null;
}

/**
 * Extract collateral from text (looks for "50 USDC", "50 dollar", etc.)
 */
function extractCollateral(text: string): number | null {
  // Pattern: "50 USDC", "50 dollar", "50 collateral"
  const collateralPattern = /(\d+(?:\.\d+)?)\s*(?:usdc|dollar|dollars|collateral)/i;
  const collateralMatch = text.match(collateralPattern);
  if (collateralMatch) {
    return parseFloat(collateralMatch[1]);
  }
  return null;
}

/**
 * Extract stop loss from text (looks for "stop loss 50000", "SL 50000", etc.)
 */
function extractStopLoss(text: string): number | null {
  // Pattern 1: "stop loss 50000", "stop loss at 50000"
  const slPattern1 = /(?:stop\s+loss|sl)\s+(?:at\s+)?(\d+(?:\.\d+)?)/i;
  const slMatch1 = text.match(slPattern1);
  if (slMatch1) {
    return parseFloat(slMatch1[1]);
  }
  
  // Pattern 2: "SL: 50000"
  const slPattern2 = /sl\s*:\s*(\d+(?:\.\d+)?)/i;
  const slMatch2 = text.match(slPattern2);
  if (slMatch2) {
    return parseFloat(slMatch2[1]);
  }
  
  return null;
}

/**
 * Extract take profit from text (looks for "take profit 60000", "TP 60000", etc.)
 */
function extractTakeProfit(text: string): number | null {
  // Pattern 1: "take profit 60000", "take profit at 60000"
  const tpPattern1 = /(?:take\s+profit|tp)\s+(?:at\s+)?(\d+(?:\.\d+)?)/i;
  const tpMatch1 = text.match(tpPattern1);
  if (tpMatch1) {
    return parseFloat(tpMatch1[1]);
  }
  
  // Pattern 2: "TP: 60000"
  const tpPattern2 = /tp\s*:\s*(\d+(?:\.\d+)?)/i;
  const tpMatch2 = text.match(tpPattern2);
  if (tpMatch2) {
    return parseFloat(tpMatch2[1]);
  }
  
  return null;
}

/**
 * Extract pair from text (supports fuzzy matching)
 */
function extractPair(text: string): string | null {
  // Try to find a pair symbol/name in the text
  // Common patterns: "BTC", "Bitcoin", "ETH", "Ethereum", etc.
  
  // Pattern 1: Direct symbol match (3-5 uppercase letters, possibly followed by "USD")
  const symbolPattern = /\b([A-Z]{2,5})(?:USD)?\b/;
  const symbolMatch = text.match(symbolPattern);
  if (symbolMatch) {
    return normalizePair(symbolMatch[1]);
  }
  
  // Pattern 2: Common coin names (Bitcoin, Ethereum, etc.)
  const coinNames = Object.keys(PAIR_ALIASES);
  for (const coinName of coinNames) {
    const regex = new RegExp(`\\b${coinName}\\b`, 'i');
    if (regex.test(text)) {
      const symbol = PAIR_ALIASES[coinName];
      return normalizePair(symbol);
    }
  }
  
  // Pattern 3: Look for common trading pair patterns
  const pairPattern = /\b(\w+)\s*(?:\/|\s+)?(?:USD|USDT)?\b/i;
  const pairMatch = text.match(pairPattern);
  if (pairMatch) {
    const potentialPair = pairMatch[1];
    const fuzzyMatched = fuzzyMatchPair(potentialPair);
    if (fuzzyMatched) {
      return normalizePair(fuzzyMatched);
    }
  }
  
  return null;
}

/**
 * Parse user intent from natural language input (English only)
 * Advanced pattern matching with flexible parameter extraction
 */
export function parseIntent(input: string): ParsedIntent {
  const normalizedInput = input.trim().toLowerCase();
  const originalInput = input.trim();
  
  // Base intent structure
  const intent: ParsedIntent = {
    action: 'unknown',
    confidence: 0,
    originalText: originalInput,
  };

  // ========== OPEN POSITION PATTERNS ==========
  
  // Pattern 1: "Open long BTC 3x", "Open short ETH 2x"
  if (normalizedInput.match(/^open\s+(?:long|short|buy|sell)/i)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.95;
      return intent;
    }
  }
  
  // Pattern 2: "Long BTC 3x", "Short ETH 2x", "Buy BTC 3x", "Sell ETH 2x"
  if (normalizedInput.match(/^(?:long|short|buy|sell)\s+\w+/i)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.95;
      return intent;
    }
  }
  
  // Pattern 3: "BTC 3x long", "ETH 2x short"
  if (normalizedInput.match(/\w+\s+\d+x\s+(?:long|short)/i)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.95;
      return intent;
    }
  }
  
  // Pattern 4: "Go long on BTC with 3x leverage"
  if (normalizedInput.match(/go\s+(?:long|short)/i)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.9;
      return intent;
    }
  }
  
  // Pattern 5: "I want to open a long position on BTC with 3x leverage"
  if (normalizedInput.match(/(?:i\s+want\s+to|i\s+would\s+like\s+to)\s+(?:open|create|enter)/i)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.9;
      return intent;
    }
  }
  
  // Pattern 6: Comprehensive open with all parameters
  // "Open 3x long BTC with 50 USDC, stop loss 50000, take profit 60000"
  if (normalizedInput.match(/(?:open|long|short|buy|sell)/i) && extractLeverage(originalInput)) {
    const pair = extractPair(originalInput);
    const direction = extractDirection(originalInput);
    const leverage = extractLeverage(originalInput);
    const collateral = extractCollateral(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (pair && leverage) {
      intent.action = 'open';
      intent.pair = pair;
      intent.direction = direction;
      intent.leverage = leverage;
      intent.collateral = collateral || undefined;
      intent.stopLoss = stopLoss || undefined;
      intent.takeProfit = takeProfit || undefined;
      intent.confidence = 0.95;
      return intent;
    }
  }

  // ========== CLOSE POSITION PATTERNS ==========
  
  // Pattern 7: "Close BTC", "Close my BTC position", "Exit BTC"
  if (normalizedInput.match(/^(?:close|exit)\s+/i)) {
    const pair = extractPair(originalInput);
    const closePercentage = normalizedInput.match(/(\d+)%/);
    
    if (closePercentage) {
      intent.action = 'partialClose';
      intent.pair = pair || undefined;
      intent.closePercentage = parseInt(closePercentage[1], 10);
      intent.confidence = 0.9;
      return intent;
    } else if (pair) {
      intent.action = 'close';
      intent.pair = pair;
      intent.confidence = 0.9;
      return intent;
    } else if (normalizedInput.match(/close\s+all/i)) {
      intent.action = 'close';
      intent.confidence = 0.85;
      return intent;
    }
  }
  
  // Pattern 8: "Partially close BTC 50%"
  if (normalizedInput.match(/(?:partially\s+)?(?:close|exit)\s+(\d+)%/i)) {
    const match = normalizedInput.match(/(?:partially\s+)?(?:close|exit)\s+(\d+)%/i);
    const pair = extractPair(originalInput);
    if (match) {
      intent.action = 'partialClose';
      intent.closePercentage = parseInt(match[1], 10);
      intent.pair = pair || undefined;
      intent.confidence = 0.9;
      return intent;
    }
  }

  // ========== STOP LOSS PATTERNS ==========
  
  // Pattern 9: "Set stop loss for BTC at 50000", "SL BTC 50000"
  if (normalizedInput.match(/(?:set\s+)?(?:stop\s+loss|sl)/i)) {
    const pair = extractPair(originalInput);
    const stopLoss = extractStopLoss(originalInput);
    
    if (stopLoss) {
      intent.action = 'setStopLoss';
      intent.pair = pair || undefined;
      intent.stopLoss = stopLoss;
      intent.confidence = 0.9;
      return intent;
    }
  }

  // ========== TAKE PROFIT PATTERNS ==========
  
  // Pattern 10: "Set take profit for BTC at 60000", "TP BTC 60000"
  if (normalizedInput.match(/(?:set\s+)?(?:take\s+profit|tp)/i)) {
    const pair = extractPair(originalInput);
    const takeProfit = extractTakeProfit(originalInput);
    
    if (takeProfit) {
      intent.action = 'setTakeProfit';
      intent.pair = pair || undefined;
      intent.takeProfit = takeProfit;
      intent.confidence = 0.9;
      return intent;
    }
  }

  // ========== HEDGE PATTERNS ==========
  
  // Pattern 11: "Hedge BTC", "Create hedge for BTC"
  if (normalizedInput.match(/(?:create\s+|open\s+)?(?:hedge|hedging)/i)) {
    const pair = extractPair(originalInput);
    
    if (pair) {
      intent.action = 'hedge';
      intent.pair = pair;
      intent.confidence = 0.85;
      return intent;
    }
  }

  // ========== ADD TO POSITION PATTERNS ==========
  
  // Pattern 12: "Add 100 USDC to BTC position"
  if (normalizedInput.match(/(?:add|increase)/i)) {
    const collateral = extractCollateral(originalInput);
    const pair = extractPair(originalInput);
    
    if (collateral) {
      intent.action = 'addToPosition';
      intent.additionalCollateral = collateral;
      intent.pair = pair || undefined;
      intent.confidence = 0.85;
      return intent;
    }
  }

  // If no pattern matches, return unknown
  return intent;
}

/**
 * Validate parsed intent
 */
export function validateIntent(intent: ParsedIntent): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (intent.action === 'unknown') {
    errors.push('Could not understand the command. Please try rephrasing. Examples: "Long BTC 3x", "Close ETH", "Set stop loss for BTC at 50000"');
    return { valid: false, errors };
  }

  if (intent.action === 'open') {
    if (!intent.pair) {
      errors.push('Please specify a trading pair (e.g., BTC, ETH, Bitcoin, Ethereum).');
    }
    if (!intent.direction) {
      errors.push('Please specify direction (long or short).');
    }
    if (!intent.leverage || intent.leverage < 1 || intent.leverage > 5) {
      errors.push('Leverage must be between 1x and 5x.');
    }
    if (intent.collateral && intent.collateral < 5) {
      errors.push('Minimum collateral is 5 USDC.');
    }
  }

  if (intent.action === 'close' || intent.action === 'partialClose') {
    if (!intent.pair && intent.action === 'close') {
      errors.push('Please specify a trading pair to close.');
    }
    if (intent.action === 'partialClose' && (!intent.closePercentage || intent.closePercentage < 1 || intent.closePercentage > 100)) {
      errors.push('Close percentage must be between 1% and 100%.');
    }
  }

  if (intent.action === 'setStopLoss' || intent.action === 'setTakeProfit') {
    if (!intent.pair) {
      errors.push('Please specify a trading pair.');
    }
    if (intent.action === 'setStopLoss' && !intent.stopLoss) {
      errors.push('Please specify a stop loss price.');
    }
    if (intent.action === 'setTakeProfit' && !intent.takeProfit) {
      errors.push('Please specify a take profit price.');
    }
  }

  if (intent.action === 'hedge') {
    if (!intent.pair) {
      errors.push('Please specify a trading pair for hedging.');
    }
  }

  if (intent.action === 'addToPosition') {
    if (!intent.pair) {
      errors.push('Please specify a trading pair.');
    }
    if (!intent.additionalCollateral || intent.additionalCollateral < 5) {
      errors.push('Additional collateral must be at least 5 USDC.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
