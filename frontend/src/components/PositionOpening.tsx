import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { useWallets } from '@privy-io/react-auth';
import { useFHEVM } from '../hooks/useFHEVM';
import { getPerpDEXContract, getContractFees, calculateFee } from '../utils/perpdexContract';
import { USDC_ADDRESS, getUSDCToken, getUSDCBalance, formatUSDC } from '../utils/usdcToken';
import { getPriceWithFallback } from '../utils/coingeckoApi';
import { storePositionDirection } from '../utils/positionDirection';
import { setStopLoss } from '../utils/stopLoss';
import { toast } from 'react-toastify';
import PairAnalysis from './PairAnalysis';
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CurrencyDollarIcon,
  BoltIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

interface PositionOpeningProps {
  pairKey: string;
  onPositionOpened?: () => void;
  onPriceSelect?: number; // Selected price from OrderBook (optional)
  hedgePairKey?: string | null; // Pair key for hedge request
  hedgeDirection?: 'long' | 'short' | null; // Direction for hedge request
  onHedgeApplied?: () => void; // Callback when hedge is applied
}

const PositionOpening: React.FC<PositionOpeningProps> = ({
  pairKey,
  onPositionOpened,
  onPriceSelect,
  hedgePairKey,
  hedgeDirection,
  onHedgeApplied,
}) => {
  const { account, signer, provider, isConnected, embeddedWallet } = useWallet();
  const { wallets } = useWallets();
  const { encryptBool, encrypt32, encrypt64, isReady: fhevmReady, error: fhevmError } = useFHEVM(provider || undefined, embeddedWallet);
  
  // Get embedded wallet
  const privyEmbeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  
  // Normalize pairKey: ensure it ends with "USD" (e.g., "BTC" -> "BTCUSD")
  const normalizedPairKey = useMemo(() => {
    return pairKey.toUpperCase().endsWith('USD') 
      ? pairKey.toUpperCase() 
      : `${pairKey.toUpperCase()}USD`;
  }, [pairKey]);
  
  const [direction, setDirection] = useState<'long' | 'short' | null>(null);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [collateral, setCollateral] = useState<string>('5');
  const [leverage, setLeverage] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [expiryTime, setExpiryTime] = useState<number>(0);
  const [stopLossPrice, setStopLossPrice] = useState<string>('');
  const [hedgeEnabled, setHedgeEnabled] = useState(false); // Hedge mode toggle
  const [existingPositions, setExistingPositions] = useState<Array<{ direction: 'long' | 'short' | null }>>([]);
  const [activeTab, setActiveTab] = useState<'trade' | 'analysis'>('trade');
  const lastSelectedPriceRef = useRef<number | null>(null);

  // Handle price selection from OrderBook
  useEffect(() => {
    if (onPriceSelect !== undefined && onPriceSelect !== null) {
      // Only update if this is a new price selection (different from last one)
      if (lastSelectedPriceRef.current !== onPriceSelect) {
        lastSelectedPriceRef.current = onPriceSelect;
        // Set limit price when price is selected from OrderBook
        setLimitPrice(onPriceSelect.toFixed(4));
        // Only switch to limit order type if currently on market
        // Don't force it if user manually switched back to market
        setOrderType((currentOrderType) => {
          if (currentOrderType === 'market') {
            return 'limit';
          }
          return currentOrderType;
        });
      }
    }
  }, [onPriceSelect]); // Only depend on onPriceSelect, not orderType
  const [loading, setLoading] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [usdcApproved, setUsdcApproved] = useState(false);
  const [pairConfig, setPairConfig] = useState<any>(null);
  const [displayPrice, setDisplayPrice] = useState<string>('0.00');
  const [liquidationPrice, setLiquidationPrice] = useState<string>('0');
  const [positionSize, setPositionSize] = useState<number>(0);
  const [openingFee, setOpeningFee] = useState<number>(0);
  const [contractFees, setContractFees] = useState<{ openingFeeBP: number; closingFeeBP: number } | null>(null);

  const MIN_COLLATERAL = 5; // 5 USDC minimum

  // Load contract fees on mount and when provider changes
  useEffect(() => {
    if (provider) {
      getContractFees(provider).then(setContractFees).catch(err => {
        console.warn('[PositionOpening] Could not load contract fees:', err);
        setContractFees({ openingFeeBP: 0, closingFeeBP: 25 }); // Use defaults
      });
    }
  }, [provider]);

  useEffect(() => {
    if (isConnected && provider && account) {
      loadUSDCBalance();
      loadPairConfig();
      loadExistingPositions();
    }
  }, [isConnected, provider, account, normalizedPairKey, signer]);

  // Handle hedge request from OpenPositions component
  useEffect(() => {
    if (hedgePairKey && hedgeDirection) {
      // Normalize hedgePairKey to match normalizedPairKey format
      const normalizedHedgePairKey = hedgePairKey.toUpperCase().endsWith('USD') 
        ? hedgePairKey.toUpperCase() 
        : `${hedgePairKey.toUpperCase()}USD`;
      
      if (normalizedPairKey === normalizedHedgePairKey) {
        // Auto-enable hedge mode and set direction
        setHedgeEnabled(true);
        setDirection(hedgeDirection);
        // Notify parent that hedge is applied
        if (onHedgeApplied) {
          onHedgeApplied();
        }
      }
    }
  }, [hedgePairKey, hedgeDirection, normalizedPairKey, onHedgeApplied]);

  // Load existing positions for this pair to check for hedge
  const loadExistingPositions = async () => {
    if (!provider || !account || !normalizedPairKey) return;

    try {
      const { getUserOpenPositions } = await import('../utils/envio');
      const { checkIndexerHealth } = await import('../utils/envio');
      
      const indexerAvailable = await checkIndexerHealth();
      if (indexerAvailable) {
        const positions = await getUserOpenPositions(account, normalizedPairKey);
        const positionsWithDirection = positions.map(pos => ({
          direction: (pos as any).direction as 'long' | 'short' | null,
        }));
        setExistingPositions(positionsWithDirection);
      } else {
        // Fallback to contract
        const contract = await getPerpDEXContract(provider);
        const positionIds = await contract.getUserPairPositions(account, normalizedPairKey);
        // For now, just check if there are any positions
        // Full direction check would require indexer
        setExistingPositions(positionIds.length > 0 ? [{ direction: null }] : []);
      }
    } catch (error) {
      console.warn('[PositionOpening] Error loading existing positions:', error);
      setExistingPositions([]);
    }
  };


  const loadUSDCBalance = async () => {
    if (!provider || !account) {
      console.log('[USDC Balance] Missing provider or account:', { provider: !!provider, account });
      return;
    }
    
    try {
      // Get chain ID to verify we're on the right network
      const network = await provider.getNetwork();
      console.log('[USDC Balance] Network:', { chainId: network.chainId.toString(), name: network.name });
      
      console.log('[USDC Balance] Loading balance for:', account, 'USDC Address:', USDC_ADDRESS);
      const usdcContract = getUSDCToken(provider);
      
      // Try to get decimals first to verify contract is accessible
      try {
        const decimals = await usdcContract.decimals();
        console.log('[USDC Balance] USDC decimals:', decimals);
      } catch (decimalsError) {
        console.warn('[USDC Balance] Could not get decimals, contract may not exist on this chain:', decimalsError);
      }
      
      const balance = await getUSDCBalance(provider, account);
      const formattedBalance = formatUSDC(balance);
      console.log('[USDC Balance] Raw balance:', balance.toString(), 'Formatted:', formattedBalance, 'USDC');
      setUsdcBalance(formattedBalance);
      
      // Check approval
      const { getPerpDEXContractAddress } = await import('../utils/perpdexContract');
      const perpdexAddress = getPerpDEXContractAddress();
      if (perpdexAddress) {
        const allowance = await usdcContract.allowance(account, perpdexAddress);
        const requiredAmount = ethers.parseUnits(collateral || '0', 6);
        setUsdcApproved(allowance >= requiredAmount);
        console.log('[USDC Balance] Approval check:', { 
          allowance: formatUSDC(allowance), 
          required: formatUSDC(requiredAmount),
          approved: allowance >= requiredAmount
        });
      }
    } catch (error: any) {
      console.error('[USDC Balance] Error loading USDC balance:', error);
      console.error('[USDC Balance] Error details:', {
        message: error.message,
        code: error.code,
        data: error.data,
        reason: error.reason,
        stack: error.stack
      });
      setUsdcBalance('0');
    }
  };

  const loadPairConfig = async () => {
    if (!provider) return;
    
    try {
      const { getPairConfig } = await import('../utils/priceOracleContract');
      let config;
      
      try {
        config = await getPairConfig(provider, normalizedPairKey);
      } catch (err: any) {
        // Pair doesn't exist in oracle contract
        if (err.code === 'CALL_EXCEPTION' || err.message?.includes('revert') || err.message?.includes('missing revert data')) {
          console.error('[Position Opening] Pair does not exist:', normalizedPairKey);
          toast.error(`Pair ${normalizedPairKey} does not exist. Please add it from Admin panel first.`);
          setDisplayPrice('0.00');
          return;
        }
        throw err;
      }
      
      // Check if pair exists (baseCurrency length > 0 means pair exists)
      const pairExists = config && config.baseCurrency && config.baseCurrency.length > 0;
      
      if (!pairExists) {
        console.error('[Position Opening] Pair does not exist:', normalizedPairKey);
        toast.error(`Pair ${normalizedPairKey} does not exist. Please add it from Admin panel first.`);
        setDisplayPrice('0.00');
        return;
      }
      
      // Check if pair is active, if not try to activate by updating price
      if (!config.isActive) {
        console.log('[Position Opening] Pair is not active, attempting to fetch price from CoinGecko...');
        
        // Need signer to update price
        if (!signer) {
          toast.error('Please connect your wallet to activate the pair');
          return;
        }
        
        try {
          // Use contract's coingeckoId if available for better consistency
          const result = await getPriceWithFallback(normalizedPairKey, config.coingeckoId || undefined);
          const binancePrice = result.price;
          
          if (binancePrice && binancePrice > 0 && !isNaN(binancePrice) && isFinite(binancePrice)) {
            // Scale price to PRICE_PRECISION (1e8)
            const scaledPrice = BigInt(Math.floor(binancePrice * 1e8));
            
            // Update price in contract (this will activate the pair)
            try {
              const contractWithSigner = await getPerpDEXContract(signer);
              
              // First check if pair exists by trying to read it from oracle
              const { getPriceOracleContract, getPairConfig } = await import('../utils/priceOracleContract');
              const oracleContract = await getPriceOracleContract(signer);
              try {
                const checkConfig = await getPairConfig(provider, normalizedPairKey);
                if (!checkConfig.baseCurrency || checkConfig.baseCurrency.length === 0) {
                  toast.error(`Pair ${normalizedPairKey} does not exist. Please add it from Admin panel first.`);
                  return;
                }
              } catch (checkError) {
                console.error('[Position Opening] Error checking pair:', checkError);
                toast.error(`Pair ${normalizedPairKey} does not exist. Please add it from Admin panel first.`);
                return;
              }
              
              // Estimate gas first to get better error message
              try {
                await oracleContract.updatePrice.estimateGas(normalizedPairKey, scaledPrice);
              } catch (estimateError: any) {
                console.error('[Position Opening] Gas estimation failed:', estimateError);
                // Try to decode error
                if (estimateError.reason) {
                  toast.error(`Failed to update price: ${estimateError.reason}`);
                } else if (estimateError.data) {
                  toast.error(`Failed to update price: ${estimateError.data}`);
                } else {
                  toast.error('Failed to update price. Pair may not exist or price deviation too high.');
                }
                return;
              }
              
              const tx = await oracleContract.updatePrice(normalizedPairKey, scaledPrice);
              await tx.wait();
              console.log('[Position Opening] Price updated from Binance, pair should be active now:', binancePrice);
              
              // Reload config to get updated price and active status
              config = await getPairConfig(provider, normalizedPairKey);
            } catch (updateError: any) {
              console.error('[Position Opening] Failed to update price in contract:', updateError);
              console.error('[Position Opening] Error details:', {
                message: updateError.message,
                reason: updateError.reason,
                data: updateError.data,
                code: updateError.code
              });
              
              // Better error handling
              if (updateError.reason) {
                toast.error(`Failed to activate pair: ${updateError.reason}`);
              } else if (updateError.message?.includes('pair does not exist')) {
                toast.error(`Pair ${normalizedPairKey} does not exist. Please add it from Admin panel first.`);
              } else if (updateError.message?.includes('deviation')) {
                toast.error('Price deviation too high. Please try again.');
              } else {
                toast.error(`Failed to activate pair: ${updateError.message || 'Unknown error'}`);
              }
              return;
            }
          } else {
            toast.error('Failed to fetch price from Binance. Please try again.');
            return;
          }
        } catch (binanceError: any) {
          console.warn('[Position Opening] Failed to fetch price from Binance:', binanceError);
          toast.error(`Failed to fetch price: ${binanceError.message || 'Unknown error'}`);
          return;
        }
      }
      
      // Update pair config state
      setPairConfig(config);
      
      // Always fetch price from CoinGecko Pro API for display (no contract call needed)
      // Contract price will be checked/updated only when opening a position
      let priceToUse: bigint | null = null;
      const PRICE_PRECISION = BigInt(1e8);
      
      try {
        const { getPriceWithFallback } = await import('../utils/coingeckoApi');
        // Use contract's coingeckoId if available for better consistency (use config, not pairConfig state)
        const result = await getPriceWithFallback(normalizedPairKey, config.coingeckoId || undefined);
        const binancePrice = result.price;
        
        if (binancePrice && binancePrice > 0 && !isNaN(binancePrice) && isFinite(binancePrice)) {
          // Scale price to PRICE_PRECISION (1e8) for display
          const scaledPrice = BigInt(Math.floor(binancePrice * 1e8));
          priceToUse = scaledPrice;
          console.log(`[Position Opening] Using ${result.source} price for display:`, binancePrice);
        }
      } catch (priceError) {
        console.warn('[Position Opening] Failed to fetch price from APIs, using contract price:', priceError);
        // Fallback to contract price if both APIs fail
        if (config.currentPrice && config.currentPrice > BigInt(0)) {
          priceToUse = config.currentPrice;
        }
      }
      
      // Calculate and display price info
      if (priceToUse && priceToUse > BigInt(0)) {
        // Ensure we divide by 1e8 to convert from PRICE_PRECISION to actual price
        const priceValue = Number(priceToUse) / 1e8;
        if (isFinite(priceValue) && !isNaN(priceValue) && priceValue > 0 && priceValue < 1e15) {
          // Validate price is reasonable (less than 1e15 to avoid display issues)
          const formattedPrice = priceValue.toFixed(4);
          console.log('[Position Opening] Setting displayPrice:', formattedPrice, 'from priceToUse:', priceToUse.toString());
          setDisplayPrice(formattedPrice);
          
          // Calculate liquidation price if direction and leverage are set
          if (direction && leverage > 0) {
            calculateLiquidationPrice(priceToUse, direction === 'long', leverage);
          }
        } else {
          console.error('[Position Opening] Invalid price value calculated:', priceValue, 'from priceToUse:', priceToUse.toString());
          setDisplayPrice('0.00');
        }
      } else {
        console.warn('[Position Opening] No valid priceToUse, setting displayPrice to 0.00');
        setDisplayPrice('0.00');
      }
    } catch (error) {
      console.error('Error loading pair config:', error);
    }
  };

  const calculateLiquidationPrice = (entryPrice: bigint, isLong: boolean, leverageValue: number) => {
    // PRICE_PRECISION = 1e8
    const PRICE_PRECISION = BigInt(1e8);
    // MAINTENANCE_MARGIN = 20%
    const MAINTENANCE_MARGIN = 20;
    // marginRatio = (100 - 20) * PRICE_PRECISION / 100 = 80 * PRICE_PRECISION / 100
    const marginRatio = (BigInt(100 - MAINTENANCE_MARGIN) * PRICE_PRECISION) / BigInt(100);
    
    let liqPrice: bigint;
    if (isLong) {
      // Long: liquidationPrice = entryPrice - (entryPrice * marginRatio) / (leverage * PRICE_PRECISION)
      // Formula: entryPrice * (1 - marginRatio / (leverage * PRICE_PRECISION))
      liqPrice = entryPrice - (entryPrice * marginRatio) / (BigInt(leverageValue) * PRICE_PRECISION);
    } else {
      // Short: liquidationPrice = entryPrice + (entryPrice * marginRatio) / (leverage * PRICE_PRECISION)
      // Formula: entryPrice * (1 + marginRatio / (leverage * PRICE_PRECISION))
      liqPrice = entryPrice + (entryPrice * marginRatio) / (BigInt(leverageValue) * PRICE_PRECISION);
    }
    
    const liqPriceValue = Number(liqPrice) / Number(PRICE_PRECISION);
    setLiquidationPrice(liqPriceValue.toFixed(4));
    console.log('[Liquidation Price] Calculated:', {
      entryPrice: Number(entryPrice) / 1e8,
      isLong,
      leverage: leverageValue,
      liquidationPrice: liqPriceValue.toFixed(4)
    });
  };

  // Update liquidation price when direction, leverage, or display price changes
  useEffect(() => {
    if (displayPrice && displayPrice !== '0.00' && direction && leverage > 0) {
      // Use displayPrice (current market price) as entry price for calculation
      const priceNum = parseFloat(displayPrice);
      if (isNaN(priceNum) || !isFinite(priceNum) || priceNum <= 0) {
        setLiquidationPrice('0.00');
        return;
      }
      const entryPrice = BigInt(Math.floor(priceNum * 1e8));
      calculateLiquidationPrice(entryPrice, direction === 'long', leverage);
    } else {
      setLiquidationPrice('0.00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPrice, direction, leverage]);

  // Calculate position size and opening fee (using contract fees)
  useEffect(() => {
    const collateralAmount = parseFloat(collateral) || 0;
    if (isNaN(collateralAmount) || !isFinite(collateralAmount) || collateralAmount < 0) {
      setPositionSize(0);
      return;
    }
    const size = collateralAmount * leverage;
    setPositionSize(size);
    
    // Calculate opening fee from contract (based on collateral, not position size)
    if (contractFees && collateralAmount > 0 && 
        !isNaN(contractFees.openingFeeBP) && isFinite(contractFees.openingFeeBP)) {
      const collateralBigInt = BigInt(Math.floor(collateralAmount * 1e6)); // Convert to 6 decimals
      const openingFeeAmount = calculateFee(collateralBigInt, contractFees.openingFeeBP);
      const openingFeeNum = Number(openingFeeAmount) / 1e6;
      setOpeningFee(openingFeeNum);
    } else {
      setOpeningFee(0);
    }
  }, [collateral, leverage, contractFees]);

  const handleApproveUSDC = async () => {
    console.log('[Approve USDC] Button clicked', { signer: !!signer, account, isConnected });
    
    if (!signer) {
      console.error('[Approve USDC] No signer available');
      toast.error('Wallet not connected. Please connect your wallet.');
      return;
    }
    
    if (!account) {
      console.error('[Approve USDC] No account available');
      toast.error('Account not found. Please connect your wallet.');
      return;
    }
    
    // Check network before proceeding
    if (provider) {
      try {
        const network = await provider.getNetwork();
        const SEPOLIA_CHAIN_ID = 11155111n;
        console.log('[Approve USDC] Current network:', { chainId: network.chainId.toString(), name: network.name });
        
        if (network.chainId !== SEPOLIA_CHAIN_ID) {
          toast.error(`Wrong network! Please switch to Sepolia (Chain ID: ${SEPOLIA_CHAIN_ID}). Current: ${network.chainId}`);
          console.error(`[Approve USDC] Wrong network. Expected Sepolia (${SEPOLIA_CHAIN_ID}), got ${network.chainId}`);
          return;
        }
      } catch (networkError) {
        console.warn('[Approve USDC] Could not check network:', networkError);
      }
    }
    
    try {
      setLoading(true);
      console.log('[Approve USDC] Starting approval...', { account, USDC_ADDRESS });
      
      const usdcAbi = ['function approve(address spender, uint256 amount) returns (bool)'];
      const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer);
      // Use fallback address if env var not set
      const { getPerpDEXContractAddress } = await import('../utils/perpdexContract');
      const perpdexAddress = getPerpDEXContractAddress();
      
      console.log('[Approve USDC] Approving for contract:', perpdexAddress);
      
      // Approve max amount
      const maxApproval = ethers.MaxUint256;
      console.log('[Approve USDC] Sending transaction...');
      const tx = await usdcContract.approve(perpdexAddress, maxApproval);
      console.log('[Approve USDC] Transaction sent:', tx.hash);
      
      toast.info('Transaction submitted, waiting for confirmation...');
      await tx.wait();
      console.log('[Approve USDC] Transaction confirmed');
      
      setUsdcApproved(true);
      toast.success('USDC approval successful');
      loadUSDCBalance(); // Refresh balance and approval status
    } catch (error: any) {
      console.error('[Approve USDC] Error:', error);
      console.error('[Approve USDC] Error details:', {
        message: error.message,
        code: error.code,
        reason: error.reason,
        data: error.data
      });
      
      // Check if error is related to wrong network
      if (error.message?.includes('network') || error.code === 'NETWORK_ERROR' || error.code === 'UNSUPPORTED_OPERATION') {
        toast.error('Network error. Please make sure you are on Sepolia testnet.');
      } else {
        toast.error(`Approval failed: ${error.reason || error.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPosition = async () => {
    if (!signer || !account || !direction || !fhevmReady) {
      toast.error('Please connect wallet and select direction');
      return;
    }

    // Hedge control: Check if user already has a position for this pair
    if (existingPositions.length > 0) {
      const hasSameDirection = existingPositions.some(pos => {
        // If direction is known, check if it matches
        if (pos.direction) {
          return pos.direction === direction;
        }
        // If direction is unknown, we can't determine - allow it
        return false;
      });

      const hasOppositeDirection = existingPositions.some(pos => {
        // If direction is known, check if it's opposite
        if (pos.direction) {
          return pos.direction !== direction;
        }
        // If direction is unknown, we can't determine - allow it
        return false;
      });

      // If user wants to open opposite direction, require hedge mode to be enabled
      if (hasOppositeDirection && !hedgeEnabled) {
        const oppositeDir = direction === 'long' ? 'short' : 'long';
        toast.error(
          `You have an open ${oppositeDir} position for ${normalizedPairKey}. Please enable "Hedge Mode" to open an opposite position.`,
          { autoClose: 5000 }
        );
        return; // Block the transaction
      }

      // If user wants to open same direction, just show a warning but allow it
      if (hasSameDirection && !hedgeEnabled) {
        toast.warning(
          `You already have a ${direction} position for ${normalizedPairKey}. Opening another ${direction} position will increase your exposure.`,
          { autoClose: 4000 }
        );
        // Don't block - allow user to proceed if they want
      }
    }

    // For limit orders, ensure embedded wallet is used
    if (orderType === 'limit') {
      if (!privyEmbeddedWallet) {
        toast.error('Limit orders require Privy embedded wallet. Please connect with email or create an embedded wallet.', { autoClose: 5000 });
        setLoading(false);
        return;
      }
      
      // Ensure we're using the embedded wallet signer
      // Check if current account matches embedded wallet address
      const currentAccount = account?.toLowerCase();
      const embeddedWalletAddress = privyEmbeddedWallet.address?.toLowerCase();
      
      if (!currentAccount || !embeddedWalletAddress || currentAccount !== embeddedWalletAddress) {
        toast.error('Please use your Privy embedded wallet for limit orders. Switch to embedded wallet in your wallet settings.', { autoClose: 5000 });
        setLoading(false);
        return;
      }
      
      // Ensure signer is from embedded wallet provider
      if (!embeddedWallet) {
        toast.error('Embedded wallet provider not available. Please reconnect your wallet.', { autoClose: 5000 });
        setLoading(false);
        return;
      }
      
      console.log('[Position Opening] Using Privy embedded wallet for limit order:', {
        embeddedWalletAddress: privyEmbeddedWallet.address,
        account,
        signerAddress: await signer.getAddress(),
      });
    }

    const collateralAmount = parseFloat(collateral);
    if (isNaN(collateralAmount) || !isFinite(collateralAmount) || collateralAmount <= 0) {
      toast.error('Invalid collateral amount');
      setLoading(false);
      return;
    }
    if (collateralAmount < MIN_COLLATERAL) {
      toast.error(`Minimum collateral is ${MIN_COLLATERAL} USDC`);
      setLoading(false);
      return;
    }

    if (parseFloat(usdcBalance) < collateralAmount) {
      toast.error('Insufficient USDC balance');
      return;
    }

    if (!usdcApproved) {
      toast.error('Please approve USDC first');
      return;
    }

    try {
      setLoading(true);
      console.log('[Position Opening] Starting position opening process...', {
        orderType,
        direction,
        collateral,
        leverage,
        pairKey: normalizedPairKey,
        account
      });

      const contract = await getPerpDEXContract(signer);
      const { getPerpDEXContractAddress } = await import('../utils/perpdexContract');
      const contractAddress = getPerpDEXContractAddress();
      console.log('[Position Opening] Contract address:', contractAddress);
      
      const collateralWei = ethers.parseUnits(collateral, 6); // USDC has 6 decimals
      console.log('[Position Opening] Collateral:', { raw: collateralWei.toString(), formatted: collateral });

      // Encrypt direction (true = Long, false = Short)
      const directionBool = direction === 'long';
      console.log('[Position Opening] Encrypting direction:', directionBool);
      
      let encryptedDirectionInput;
      try {
        encryptedDirectionInput = await encryptBool(directionBool, contractAddress, account);
        console.log('[Position Opening] Direction encryption successful:', {
          handlesCount: encryptedDirectionInput.handles.length,
          handlesLength: encryptedDirectionInput.handles[0]?.length,
          inputProofLength: encryptedDirectionInput.inputProof.length
        });
      } catch (encryptError: any) {
        console.error('[Position Opening] Direction encryption failed:', encryptError);
        toast.error(`Direction encryption failed: ${encryptError.message || 'Unknown error'}`);
        setLoading(false);
        return;
      }
      
      // Encrypt leverage (1-5x)
      console.log('[Position Opening] Encrypting leverage:', leverage);
      let encryptedLeverageInput;
      try {
        encryptedLeverageInput = await encrypt32(leverage, contractAddress, account);
        console.log('[Position Opening] Leverage encryption successful:', {
          handlesCount: encryptedLeverageInput.handles.length,
          handlesLength: encryptedLeverageInput.handles[0]?.length,
          inputProofLength: encryptedLeverageInput.inputProof.length
        });
      } catch (encryptError: any) {
        console.error('[Position Opening] Leverage encryption failed:', encryptError);
        toast.error(`Leverage encryption failed: ${encryptError.message || 'Unknown error'}`);
        setLoading(false);
        return;
      }
      
      // Convert handles[0] to hex strings
      const encryptedDirection = ethers.hexlify(encryptedDirectionInput.handles[0]);
      const inputProofDirection = ethers.hexlify(encryptedDirectionInput.inputProof);
      const encryptedLeverage = ethers.hexlify(encryptedLeverageInput.handles[0]);
      const inputProofLeverage = ethers.hexlify(encryptedLeverageInput.inputProof);
      
      console.log('[Position Opening] Encrypted values prepared:', {
        encryptedDirectionLength: encryptedDirection.length,
        inputProofDirectionLength: inputProofDirection.length,
        encryptedLeverageLength: encryptedLeverage.length,
        inputProofLeverageLength: inputProofLeverage.length
      });

      // Check contract state before sending transaction
      console.log('[Position Opening] Checking contract state...');
      let currentPairConfig: any = null;
      try {
        if (!provider) {
          throw new Error('Provider not available');
        }
        const { getPairConfig } = await import('../utils/priceOracleContract');
        currentPairConfig = await getPairConfig(provider, normalizedPairKey);
        setPairConfig(currentPairConfig);
        console.log('[Position Opening] Pair config:', {
          baseCurrency: currentPairConfig.baseCurrency,
          quoteCurrency: currentPairConfig.quoteCurrency,
          isActive: currentPairConfig.isActive,
          currentPrice: currentPairConfig.currentPrice.toString(),
          lastUpdateTime: currentPairConfig.lastUpdateTime.toString(),
          maxLeverage: currentPairConfig.maxLeverage.toString(),
          priceAge: Date.now() / 1000 - Number(currentPairConfig.lastUpdateTime),
          coingeckoId: currentPairConfig.coingeckoId
        });
        
        // Validate pair config
        if (!currentPairConfig.baseCurrency || currentPairConfig.baseCurrency.length === 0) {
          throw new Error('Pair does not exist in contract');
        }
        
        if (!currentPairConfig.isActive) {
          throw new Error('Pair is not active');
        }
        
        // Check if pair is active
        if (!currentPairConfig.isActive) {
          toast.error('Pair is not active');
          setLoading(false);
          return;
        }
        
        // Check if price is stale and needs update
        // Backend service updates prices regularly, so we only update if price is very stale (>5 minutes)
        const PRICE_STALENESS_THRESHOLD = 5 * 60; // 5 minutes in seconds
        const now = Math.floor(Date.now() / 1000);
        const priceAge = now - Number(currentPairConfig.lastUpdateTime);
        const isPriceStale = priceAge > PRICE_STALENESS_THRESHOLD;
        
        console.log('[Position Opening] Price staleness check:', {
          lastUpdateTime: currentPairConfig.lastUpdateTime.toString(),
          priceAge: priceAge,
          isStale: isPriceStale,
          threshold: PRICE_STALENESS_THRESHOLD
        });
        
        // Check if price is stale - contract requires price to be < 5 minutes old
        // Contract has PRICE_STALENESS = 5 minutes check
        if (isPriceStale) {
          const staleMinutes = Math.floor(priceAge / 60);
          const errorMsg = `Price is too stale (${staleMinutes} minutes old). Contract requires price to be less than 5 minutes old. Please wait for backend service to update the price, or try again in a moment.`;
          console.error('[Position Opening] Price is too stale for contract:', {
            lastUpdateTime: currentPairConfig.lastUpdateTime.toString(),
            priceAge: priceAge,
            staleMinutes: staleMinutes,
            contractRequirement: '5 minutes'
          });
          toast.error(errorMsg, { autoClose: 10000 });
          setLoading(false);
          return;
        }
        
        console.log('[Position Opening] Price is fresh, proceeding with position opening.');
        
        // Check leverage
        if (Number(currentPairConfig.maxLeverage) < leverage) {
          toast.error(`Leverage ${leverage}x exceeds pair maximum of ${currentPairConfig.maxLeverage}x`);
          setLoading(false);
          return;
        }
        
        // Check liquidity
        const liquidityPool = await contract.liquidityPool();
        const positionSize = collateralWei * BigInt(leverage);
        
        // Get opening fee from contract (based on collateral, not position size)
        const openingFeeBP = (contractFees?.openingFeeBP && !isNaN(contractFees.openingFeeBP) && isFinite(contractFees.openingFeeBP)) 
          ? contractFees.openingFeeBP 
          : 0;
        const openingFee = calculateFee(collateralWei, openingFeeBP);
        // Opening fee is deducted from collateral, not from liquidity
        const requiredLiquidity = positionSize;
        
        console.log('[Position Opening] Liquidity check:', {
          availableLiquidity: liquidityPool.availableLiquidity.toString(),
          requiredLiquidity: requiredLiquidity.toString(),
          positionSize: positionSize.toString(),
          openingFee: openingFee.toString()
        });
        
        if (liquidityPool.availableLiquidity < requiredLiquidity) {
          toast.error(`Insufficient liquidity. Available: ${ethers.formatUnits(liquidityPool.availableLiquidity, 6)} USDC, Required: ${ethers.formatUnits(requiredLiquidity, 6)} USDC`);
          setLoading(false);
          return;
        }
      } catch (checkError: any) {
        // Only log detailed error in development mode
        if (process.env.NODE_ENV === 'development') {
          console.error('[Position Opening] Error checking contract state:', checkError);
          console.error('[Position Opening] Error details:', {
            message: checkError.message,
            code: checkError.code,
            reason: checkError.reason,
            data: checkError.data,
            normalizedPairKey
          });
        } else {
          // In production, only log a simple warning
          if (checkError.message?.includes('missing revert data')) {
            console.warn('[Position Opening] RPC connection issue (non-critical)');
          } else {
            console.warn('[Position Opening] Error checking contract state (non-critical):', checkError.message || 'Unknown error');
          }
        }
        
        // If pair doesn't exist, provide helpful error
        if (checkError.code === 'CALL_EXCEPTION' || checkError.message?.includes('missing revert data')) {
          toast.error(`Pair "${normalizedPairKey}" not found in contract. Please select a different pair.`, { autoClose: 10000 });
        } else {
          toast.error(`Failed to check contract state: ${checkError.message || 'Unknown error'}`, { autoClose: 10000 });
        }
        setLoading(false);
        return;
      }

      let tx;
      if (orderType === 'market') {
        // Market order - execute immediately
        console.log('[Position Opening] Creating market order...', {
          normalizedPairKey,
          originalPairKey: pairKey,
          leverage,
          collateral: collateralWei.toString(),
          collateralUSDC: Number(collateralWei) / 1e6
        });
        
        // Estimate gas first to get better error messages
        try {
          console.log('[Position Opening] Estimating gas for createMarketOrder...', {
            normalizedPairKey,
            encryptedDirectionLength: encryptedDirection.length,
            encryptedLeverageLength: encryptedLeverage.length,
            inputProofDirectionLength: inputProofDirection.length,
            inputProofLeverageLength: inputProofLeverage.length,
            leverage,
            collateralWei: collateralWei.toString(),
            collateralUSDC: Number(collateralWei) / 1e6
          });
          
          const estimatedGas = await contract.createMarketOrder.estimateGas(
            normalizedPairKey,
            encryptedDirection,
            encryptedLeverage,
            inputProofDirection,
            inputProofLeverage,
            leverage,
            collateralWei
          );
          
          console.log('[Position Opening] Gas estimation successful:', estimatedGas.toString());
        } catch (estimateError: any) {
          console.error('[Position Opening] Gas estimation failed for market order:', estimateError);
          console.error('[Position Opening] Error details:', {
            message: estimateError.message,
            code: estimateError.code,
            reason: estimateError.reason,
            data: estimateError.data,
            error: estimateError.error,
            stack: estimateError.stack
          });
          
          // Try to extract more detailed error message
          let errorMsg = 'Failed to estimate gas';
          if (estimateError.reason) {
            errorMsg = estimateError.reason;
          } else if (estimateError.message) {
            errorMsg = estimateError.message;
          } else if (estimateError.error?.message) {
            errorMsg = estimateError.error.message;
          } else if (estimateError.data?.message) {
            errorMsg = estimateError.data.message;
          }
          
          // Check for common errors
          if (errorMsg.includes('insufficient liquidity') || errorMsg.includes('liquidity')) {
            errorMsg = 'Insufficient liquidity in the pool. Please try a smaller position size.';
          } else if (errorMsg.includes('price too stale') || errorMsg.includes('stale')) {
            errorMsg = 'Price is too stale (older than 5 minutes). Backend service is updating prices. Please wait a moment and try again.';
          } else if (errorMsg.includes('leverage')) {
            errorMsg = 'Invalid leverage. Please check your leverage setting.';
          } else if (errorMsg.includes('collateral')) {
            errorMsg = 'Invalid collateral amount. Please check your collateral.';
          } else if (errorMsg.includes('pair') || errorMsg.includes('Pair')) {
            errorMsg = 'Pair configuration error. Please try another pair.';
          } else if (errorMsg.includes('missing revert data') || estimateError.code === 'CALL_EXCEPTION') {
            // Try to get more info from the pair config
            const priceAge = currentPairConfig ? (Math.floor(Date.now() / 1000) - Number(currentPairConfig.lastUpdateTime)) : 0;
            if (priceAge > 300) {
              errorMsg = `Price is too stale (${Math.floor(priceAge / 60)} minutes old). Contract requires price to be less than 5 minutes old. Please wait for backend service to update the price.`;
            } else {
              errorMsg = 'Transaction failed. This might be due to: price too stale, insufficient liquidity, or invalid parameters. Please check your inputs and try again.';
            }
          }
          
          toast.error(`Cannot open position: ${errorMsg}`, { autoClose: 10000 });
          setLoading(false);
          return;
        }
        
        // Retry mechanism for Privy embedded wallet authentication issues
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            console.log(`[Position Opening] Attempting transaction (attempt ${retryCount + 1}/${maxRetries})...`);
            
            tx = await contract.createMarketOrder(
              normalizedPairKey,
              encryptedDirection,
              encryptedLeverage,
              inputProofDirection,
              inputProofLeverage,
              leverage,
              collateralWei
            );
            
            // Success - break out of retry loop
            break;
          } catch (txError: any) {
            retryCount++;
            
            // Check if it's an authentication error
            if (txError.message?.includes('wallets/authenticate') || 
                txError.message?.includes('Failed to fetch') ||
                txError.message?.includes('no response') ||
                txError.message?.includes('ERR_OUT_OF_MEMORY')) {
              
              if (retryCount < maxRetries) {
                console.warn(`[Position Opening] Authentication/network error, retrying in ${retryCount * 2} seconds... (attempt ${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryCount * 2000)); // Exponential backoff
                continue;
              } else {
                throw new Error('Wallet authentication failed after multiple attempts. Please refresh the page and try again.');
              }
            } else {
              // Not an authentication error, throw immediately
              throw txError;
            }
          }
        }
        
        if (!tx) {
          throw new Error('Failed to create transaction after retries');
        }
      } else {
        // Limit order
        if (!limitPrice) {
          toast.error('Please enter a limit price');
          setLoading(false);
          return;
        }
        
        // Convert limit price to PRICE_PRECISION (1e8) format
        const PRICE_PRECISION = 1e8;
        const limitPriceNum = parseFloat(limitPrice);
        const currentPriceNum = parseFloat(displayPrice);
        
        if (isNaN(limitPriceNum) || !isFinite(limitPriceNum) || limitPriceNum <= 0) {
          toast.error('Invalid limit price');
          setLoading(false);
          return;
        }
        
        if (isNaN(currentPriceNum) || !isFinite(currentPriceNum) || currentPriceNum <= 0) {
          toast.error('Invalid current price');
          setLoading(false);
          return;
        }
        
        const limitPriceWei = BigInt(Math.floor(limitPriceNum * PRICE_PRECISION));
        
        // Check if limit price is too close to current price (within 1% threshold)
        // Contract executes immediately if price difference is <= 1%
        const priceDiff = Math.abs(limitPriceNum - currentPriceNum);
        const priceThreshold = limitPriceNum * 0.01; // 1% threshold
        
        if (priceDiff <= priceThreshold) {
          toast.warning(
            `Limit price ($${limitPriceNum.toFixed(4)}) is within 1% of current price ($${currentPriceNum.toFixed(4)}). ` +
            `The order may execute immediately. Consider using a market order instead.`,
            { autoClose: 5000 }
          );
          // Still allow the order to proceed, but warn the user
        }
        
        const expiry = expiryTime > 0 ? Math.floor(Date.now() / 1000) + expiryTime * 3600 : 0;
        console.log('[Position Opening] Creating limit order...', {
          limitPrice,
          limitPriceWei: limitPriceWei.toString(),
          currentPrice: currentPriceNum,
          priceDiff,
          priceThreshold,
          expiry
        });
        
        // Estimate gas first to get better error messages
        try {
          // Note: createLimitOrder still uses old signature (without encrypted leverage)
          // TODO: Update contract to support encrypted leverage in limit orders
          await contract.createLimitOrder.estimateGas(
            normalizedPairKey,
            encryptedDirection,
            inputProofDirection,
            limitPriceWei,
            leverage,
            collateralWei,
            expiry
          );
        } catch (estimateError: any) {
          console.error('[Position Opening] Gas estimation failed for limit order:', estimateError);
          const errorMsg = estimateError.reason || estimateError.message || 'Failed to estimate gas';
          toast.error(`Cannot create limit order: ${errorMsg}`);
          setLoading(false);
          return;
        }
        
        // Note: createLimitOrder still uses old signature (without encrypted leverage)
        // TODO: Update contract to support encrypted leverage in limit orders
        tx = await contract.createLimitOrder(
          normalizedPairKey,
          encryptedDirection,
          inputProofDirection,
          limitPriceWei,
          leverage,
          collateralWei,
          expiry
        );
      }

      console.log('[Position Opening] Transaction submitted:', tx.hash);
      toast.info('Transaction submitted, waiting for confirmation...', { autoClose: 5000 });
      
      // Wait for transaction confirmation - CRITICAL for position opening
      let receipt;
      try {
        receipt = await Promise.race([
          tx.wait(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timeout')), 60000))
        ]);
        console.log('[Position Opening] Transaction confirmed:', receipt);
        
        // Check if transaction was successful
        if (receipt && receipt.status === 0) {
          toast.error('Transaction failed. Please try again.', { autoClose: 10000 });
          setLoading(false);
          return;
        }
      } catch (waitError: any) {
        console.error('[Position Opening] Transaction wait failed:', waitError);
        
        // Try to get receipt from transaction hash
        if (tx.hash && provider) {
          try {
            // Wait a bit longer for Privy embedded wallet
            await new Promise(resolve => setTimeout(resolve, 10000));
            receipt = await provider.getTransactionReceipt(tx.hash);
            if (receipt) {
              console.log('[Position Opening] Got receipt from provider:', receipt);
              if (receipt.status === 0) {
                toast.error('Transaction failed. Please try again.', { autoClose: 10000 });
                setLoading(false);
                return;
              }
            } else {
              throw new Error('Receipt not found');
            }
          } catch (receiptError) {
            console.error('[Position Opening] Could not get receipt:', receiptError);
            toast.error('Transaction submitted but confirmation failed. Please check your wallet or try again.', { autoClose: 10000 });
            setLoading(false);
            return;
          }
        } else {
          toast.error('Transaction submission failed. Please try again.', { autoClose: 10000 });
          setLoading(false);
          return;
        }
      }
      
      // If no receipt, fail
      if (!receipt) {
        toast.error('Transaction confirmation failed. Please try again.', { autoClose: 10000 });
        setLoading(false);
        return;
      }
      
      // Extract position ID from PositionOpened event (for market orders)
      // For limit orders, store direction with orderId - will be mapped when order executes
      let positionId: bigint | null = null;
      
      if (orderType === 'market' && direction && receipt && receipt.logs) {
        if (receipt.logs) {
          const contract = await getPerpDEXContract(provider!);
          const iface = contract.interface;
          
          for (const log of receipt.logs) {
            try {
              const parsedLog = iface.parseLog(log);
              if (parsedLog && parsedLog.name === 'PositionOpened') {
                positionId = parsedLog.args.positionId as bigint;
                console.log('[Position Opening] Position ID from event:', positionId.toString());
                break;
              }
            } catch (e) {
              // Not a PositionOpened event, continue
            }
          }
        }
        
        // Store direction in localStorage and indexer if we have positionId
        if (positionId) {
          storePositionDirection(positionId, direction);
          console.log(`[Position Opening] Stored direction ${direction} for position ${positionId.toString()}`);
          
          // Also store direction in indexer
          try {
            const { setPositionDirection } = await import('../utils/envio');
            await setPositionDirection(positionId.toString(), direction);
            console.log(`[Position Opening] Stored direction ${direction} in indexer for position ${positionId.toString()}`);
          } catch (err) {
            console.warn('[Position Opening] Could not store direction in indexer:', err);
          }
          
          // Update open interest in contract (direction is now decrypted)
          if (signer && account) {
            try {
              const contract = await getPerpDEXContract(signer);
              const isLong = direction === 'long';
              console.log(`[Position Opening] Updating open interest for position ${positionId.toString()}, direction: ${direction}`);
              
              // Call updateOpenInterest to correctly track long/short positions
              const updateTx = await contract.updateOpenInterest(positionId, isLong);
              await updateTx.wait();
              console.log(`[Position Opening] Open interest updated successfully for position ${positionId.toString()}`);
            } catch (updateError: any) {
              // Non-critical error - log but don't fail the position opening
              console.warn('[Position Opening] Failed to update open interest (non-critical):', updateError);
            }
          }
          
          // Store stop loss if set (encrypted in contract)
          if (stopLossPrice && stopLossPrice !== '') {
            const stopLossNum = parseFloat(stopLossPrice);
            if (!isNaN(stopLossNum) && stopLossNum > 0 && signer && account && encrypt64) {
              await setStopLoss(positionId, stopLossNum, signer, account, encrypt64);
              console.log(`[Position Opening] Stored encrypted stop loss $${stopLossNum.toFixed(4)} for position ${positionId.toString()}`);
            } else if (!isNaN(stopLossNum) && stopLossNum > 0) {
              // Fallback: store without encryption (localStorage/indexer only)
              await setStopLoss(positionId, stopLossNum);
              console.log(`[Position Opening] Stored stop loss $${stopLossNum.toFixed(4)} for position ${positionId.toString()} (no encryption)`);
            }
          }
        }
      } else if (orderType === 'limit' && direction) {
        // For limit orders, check if order was executed immediately (within 1% threshold)
        // If executed, PositionOpened event will be emitted (but OrderExecuted won't be)
        let orderId: bigint | null = null;
        let positionId: bigint | null = null;
        let orderExecutedImmediately = false;
        
        if (receipt.logs) {
          const contract = await getPerpDEXContract(provider!);
          const iface = contract.interface;
          
          for (const log of receipt.logs) {
            try {
              const parsedLog = iface.parseLog(log);
              if (parsedLog && parsedLog.name === 'OrderCreated') {
                orderId = parsedLog.args.orderId as bigint;
                console.log('[Position Opening] Order ID from event:', orderId.toString());
              } else if (parsedLog && parsedLog.name === 'PositionOpened') {
                // Limit order was executed immediately (within 1% threshold)
                positionId = parsedLog.args.positionId as bigint;
                orderExecutedImmediately = true;
                console.log('[Position Opening] Limit order executed immediately! Position ID:', positionId.toString());
              }
            } catch (e) {
              // Not the event we're looking for, continue
            }
          }
        }
        
        if (orderExecutedImmediately && positionId) {
          // Order was executed immediately, treat it like a market order
          storePositionDirection(positionId, direction);
          console.log(`[Position Opening] Stored direction ${direction} for position ${positionId.toString()} (limit order executed immediately)`);
          
          // Store stop loss if set (encrypted in contract)
          if (stopLossPrice && stopLossPrice !== '') {
            const stopLossNum = parseFloat(stopLossPrice);
            if (!isNaN(stopLossNum) && stopLossNum > 0 && signer && account && encrypt64) {
              await setStopLoss(positionId, stopLossNum, signer, account, encrypt64);
              console.log(`[Position Opening] Stored encrypted stop loss $${stopLossNum.toFixed(4)} for position ${positionId.toString()}`);
            } else if (!isNaN(stopLossNum) && stopLossNum > 0) {
              // Fallback: store without encryption (localStorage/indexer only)
              await setStopLoss(positionId, stopLossNum);
              console.log(`[Position Opening] Stored stop loss $${stopLossNum.toFixed(4)} for position ${positionId.toString()} (no encryption)`);
            }
          }
          
          // Remove order direction from localStorage if it was stored
          if (orderId) {
            try {
              const stored = localStorage.getItem('shadefx_order_directions');
              if (stored) {
                const orderDirections: Record<string, 'long' | 'short'> = JSON.parse(stored);
                delete orderDirections[orderId.toString()];
                localStorage.setItem('shadefx_order_directions', JSON.stringify(orderDirections));
              }
            } catch (e) {
              console.error('Error removing order direction:', e);
            }
          }
          
          // Update open interest in contract (direction is now decrypted)
          if (positionId && direction && signer && account) {
            try {
              const contract = await getPerpDEXContract(signer);
              const isLong = direction === 'long';
              console.log(`[Position Opening] Updating open interest for position ${positionId.toString()}, direction: ${direction}`);
              
              // Call updateOpenInterest to correctly track long/short positions
              const updateTx = await contract.updateOpenInterest(positionId, isLong);
              await updateTx.wait();
              console.log(`[Position Opening] Open interest updated successfully for position ${positionId.toString()}`);
            } catch (updateError: any) {
              // Non-critical error - log but don't fail the position opening
              console.warn('[Position Opening] Failed to update open interest (non-critical):', updateError);
            }
          }
          
          // Update toast message to reflect immediate execution
          toast.success('Position opened (limit order executed immediately)!');
          setLoading(false);
          if (onPositionOpened) {
            onPositionOpened();
          }
        } else if (orderId) {
          // Order is still pending, store direction with orderId
          // When order is executed later, we'll map orderId -> positionId via OrderExecuted event
          try {
            const stored = localStorage.getItem('shadefx_order_directions');
            const orderDirections: Record<string, 'long' | 'short'> = stored ? JSON.parse(stored) : {};
            orderDirections[orderId.toString()] = direction;
            localStorage.setItem('shadefx_order_directions', JSON.stringify(orderDirections));
            console.log(`[Position Opening] Stored direction ${direction} for order ${orderId.toString()}`);
            
            // Also store direction in indexer
            try {
              const { setOrderDirection } = await import('../utils/envio');
              await setOrderDirection(orderId.toString(), direction);
              console.log(`[Position Opening] Stored direction ${direction} in indexer for order ${orderId.toString()}`);
            } catch (err) {
              console.warn('[Position Opening] Could not store direction in indexer:', err);
            }
          } catch (e) {
            console.error('Error storing order direction:', e);
          }
          
          // Show toast for pending limit order
          toast.success('Limit order created successfully!');
          setLoading(false);
          if (onPositionOpened) {
            onPositionOpened();
          }
        } else {
          // Fallback toast
          toast.success('Limit order created successfully!');
          setLoading(false);
          if (onPositionOpened) {
            onPositionOpened();
          }
        }
      } else {
        // This else block should not be reached for market orders (already handled above)
        // But if it is, we still need to handle it gracefully
        // Market order toast (fallback)
        toast.success('Position opened successfully!');
        setLoading(false);
        if (onPositionOpened) {
          onPositionOpened();
        }
      }
      
      // Final check: if we have positionId but haven't updated open interest yet, do it now
      // (This is a safety check in case the market order path didn't handle it)
      if (positionId && direction && signer && account && orderType === 'market') {
        try {
          const contract = await getPerpDEXContract(signer);
          const isLong = direction === 'long';
          console.log(`[Position Opening] Updating open interest for position ${positionId.toString()}, direction: ${direction}`);
          
          // Call updateOpenInterest to correctly track long/short positions
          const updateTx = await contract.updateOpenInterest(positionId, isLong);
          await updateTx.wait();
          console.log(`[Position Opening] Open interest updated successfully for position ${positionId.toString()}`);
        } catch (updateError: any) {
          // Non-critical error - log but don't fail the position opening
          console.warn('[Position Opening] Failed to update open interest (non-critical):', updateError);
        }
      }
      
      // Reset form
      setDirection(null);
      setCollateral('5');
      setLeverage(1);
      setLimitPrice('');
      setExpiryTime(0);
      setHedgeEnabled(false); // Reset hedge mode
      
      // Refresh balance and positions
      loadUSDCBalance();
      loadPairConfig(); // Reload pair config to get updated price
      loadExistingPositions(); // Reload existing positions
      
      // Invalidate cache to ensure new position is visible immediately
      try {
        const { invalidateCache } = await import('../utils/envio');
        invalidateCache('position');
        console.log('[Position Opening] Cache invalidated for positions');
      } catch (cacheError) {
        console.warn('[Position Opening] Could not invalidate cache:', cacheError);
      }
    } catch (error: any) {
      console.error('[Position Opening] Error opening position:', error);
      console.error('[Position Opening] Error details:', {
        message: error.message,
        code: error.code,
        reason: error.reason,
        data: error.data,
        stack: error.stack,
        error: error
      });
      
      // Parse error message for user-friendly display
      let errorMessage = 'Unknown error';
      
      // Check for Privy authentication errors
      if (error.message?.includes('wallets/authenticate') || 
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('no response')) {
        errorMessage = 'Wallet authentication failed. Please try refreshing the page or reconnecting your wallet. If the problem persists, try clearing your browser cache.';
      } 
      // Check for memory errors
      else if (error.message?.includes('ERR_OUT_OF_MEMORY') || 
               error.message?.includes('out of memory')) {
        errorMessage = 'Browser memory error. Please close other tabs, refresh the page, and try again.';
      }
      // Check for transaction replacement errors
      else if (error.code === 'REPLACEMENT_UNDERPRICED' || 
          error.message?.includes('replacement fee too low') ||
          error.message?.includes('replacement transaction underpriced')) {
        errorMessage = 'A transaction with the same nonce is already pending. Please wait for it to complete or increase the gas fee and try again.';
      } 
      // Check for network errors
      else if (error.message?.includes('network') || 
               error.message?.includes('NetworkError') ||
               error.message?.includes('fetch failed')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      }
      else if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      } else if (error.data?.message) {
        errorMessage = error.data.message;
      } else if (error.error?.message) {
        errorMessage = error.error.message;
      } else if (error.error?.reason) {
        errorMessage = error.error.reason;
      }
      
      // Show detailed error in console and toast
      console.error('[Position Opening] Final error message:', errorMessage);
      toast.error(`Failed to open position: ${errorMessage}`, { autoClose: 15000 });
    } finally {
      setLoading(false);
    }
  };

  const maxLeverage = pairConfig?.maxLeverage ? Number(pairConfig.maxLeverage) : 5;

  return (
    <div className="flex flex-col h-full">
      {/* Tab Selection */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('trade')}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'trade'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <BoltIcon className="w-4 h-4" />
          Trade
        </button>
        <button
          onClick={() => setActiveTab('analysis')}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'analysis'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <ChartBarIcon className="w-4 h-4" />
          Analysis
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'analysis' ? (
        <div className="flex-1 overflow-y-auto">
          <PairAnalysis pairKey={normalizedPairKey} />
        </div>
      ) : (
        <>
      {/* Order Type Selection */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => {
            setOrderType('market');
            // Clear limit price when switching to market
            setLimitPrice('');
          }}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
            orderType === 'market'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
            orderType === 'limit'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Limit
        </button>
      </div>

      {/* Hedge Mode Toggle */}
      {existingPositions.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-yellow-400 font-medium">Hedge</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hedgeEnabled}
                onChange={(e) => setHedgeEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
        </div>
      )}

      {/* Direction Selection */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setDirection('long')}
          disabled={loading}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all ${
            direction === 'long'
              ? 'bg-green-600 text-white shadow-lg'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <ArrowTrendingUpIcon className="w-5 h-5 inline mr-2" />
          Long
        </button>
        <button
          onClick={() => setDirection('short')}
          disabled={loading}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all ${
            direction === 'short'
              ? 'bg-red-600 text-white shadow-lg'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <ArrowTrendingDownIcon className="w-5 h-5 inline mr-2" />
          Short
        </button>
      </div>

      {/* Collateral Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Collateral (USDC)
        </label>
        <div className="relative">
          <input
            type="number"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            min={MIN_COLLATERAL}
            step="0.01"
            placeholder="5.00"
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="absolute right-4 top-2.5 text-gray-400 text-sm">USDC</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Min: {MIN_COLLATERAL} USDC | Balance: {parseFloat(usdcBalance).toFixed(2)} USDC
        </p>
      </div>

      {/* Leverage Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Leverage: {leverage}x
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].filter(x => x <= maxLeverage).map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={`flex-1 px-3 py-2 rounded-lg font-medium transition-colors ${
                leverage === lev
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      {/* Limit Price (for limit orders) */}
      {orderType === 'limit' && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Limit Price (USD)
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={displayPrice !== '0' ? displayPrice : '0.00'}
              step="0.01"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Expiry (hours, 0 = no expiry)
            </label>
            <input
              type="number"
              value={expiryTime}
              onChange={(e) => setExpiryTime(parseInt(e.target.value) || 0)}
              min="0"
              placeholder="0"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </>
      )}

      {/* Stop Loss (optional, for all order types) */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Stop Loss (USD) <span className="text-xs text-gray-500">(Optional)</span>
        </label>
        <input
          type="number"
          value={stopLossPrice}
          onChange={(e) => setStopLossPrice(e.target.value)}
          placeholder={displayPrice !== '0' ? `e.g., ${(parseFloat(displayPrice) * 0.95).toFixed(4)}` : '0.00'}
          step="0.0001"
          min="0"
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {stopLossPrice && displayPrice !== '0' && (
          <p className="mt-1 text-xs text-gray-500">
            {direction === 'long' 
              ? `Stop loss will trigger if price falls to $${parseFloat(stopLossPrice).toFixed(4)} or below`
              : direction === 'short'
              ? `Stop loss will trigger if price rises to $${parseFloat(stopLossPrice).toFixed(4)} or above`
              : 'Select direction to see stop loss behavior'
            }
          </p>
        )}
      </div>

      {/* Price Information */}
      {pairConfig && (
        <div className="mb-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Price Information</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Current Price:</span>
              <span className="text-white font-medium">${displayPrice}</span>
            </div>
            {direction && liquidationPrice !== '0' && (
              <div className="flex justify-between">
                <span className="text-gray-400">Liquidation Price:</span>
                <span className={`font-medium ${direction === 'long' ? 'text-red-400' : 'text-green-400'}`}>
                  ${liquidationPrice}
                </span>
              </div>
            )}
            {pairConfig.lastUpdateTime && (
              <div className="flex justify-between">
                <span className="text-gray-400">Price Age:</span>
                <span className="text-white text-xs">
                  {Math.floor((Date.now() / 1000 - Number(pairConfig.lastUpdateTime)) / 60)} min
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Position Summary */}
      {direction && (
        <div className="mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Position Summary</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Position Size:</span>
              <span className="text-white font-medium">{positionSize.toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Opening Fee:</span>
              <span className="text-white font-medium">
                {openingFee.toFixed(4)} USDC ({contractFees ? (contractFees.openingFeeBP / 100).toFixed(3) : '0.000'}%)
              </span>
            </div>
            {pairConfig?.currentPrice && (
              <div className="flex justify-between">
                <span className="text-gray-400">Entry Price:</span>
                <span className="text-white font-medium">${displayPrice}</span>
              </div>
            )}
            {direction && liquidationPrice !== '0' && (
              <div className="flex justify-between">
                <span className="text-gray-400">Liquidation Price:</span>
                <span className={`font-medium ${direction === 'long' ? 'text-red-400' : 'text-green-400'}`}>
                  ${liquidationPrice}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approve USDC Button */}
      {!usdcApproved && (
        <button
          onClick={handleApproveUSDC}
          disabled={loading || !isConnected || !signer || !account}
          className="w-full px-4 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-2"
        >
          {loading ? 'Approving...' : 'Approve USDC'}
        </button>
      )}

      {/* Open Position Button */}
      <button
        onClick={handleOpenPosition}
        disabled={loading || !direction || !usdcApproved || !fhevmReady}
        className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <BoltIcon className="w-5 h-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <BoltIcon className="w-5 h-5" />
            {orderType === 'market' ? 'Open Position' : 'Create Limit Order'}
          </>
        )}
      </button>

      {!fhevmReady && (
        <div className={`text-sm mb-4 p-3 rounded-lg ${fhevmError ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'}`}>
          {fhevmError ? (
            <div>
              <p className="font-semibold mb-1">⚠️ FHEVM Initialization Failed</p>
              <p className="text-xs">{fhevmError}</p>
              <p className="text-xs mt-2 opacity-75">
                {fhevmError?.includes('Please connect') || fhevmError?.includes('No wallet')
                  ? 'Please connect your wallet to use FHEVM features.'
                  : fhevmError?.includes('Could not access wallet provider')
                  ? 'FHEVM initialization failed: Could not access wallet provider. Please try refreshing the page.'
                  : 'Please refresh the page to retry. If the problem persists, the relayer service may be temporarily unavailable.'}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold mb-1">⏳ FHEVM is initializing...</p>
              <p className="text-xs opacity-75">This may take a few seconds. Please wait.</p>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default PositionOpening;


