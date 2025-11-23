import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '../contexts/WalletContext';
import { XMarkIcon, DocumentDuplicateIcon, CheckIcon, QrCodeIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { QRCodeSVG } from 'qrcode.react';
import { ethers } from 'ethers';
import { getUSDCBalance, formatUSDC, parseUSDC, getUSDCToken } from '../utils/usdcToken';
import { toast } from 'react-toastify';
import { getUSDCQuote, getETHQuote, swapETHToUSDC, swapUSDCToETH } from '../utils/uniswapSwap';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const { account, provider, signer, embeddedWallet, disconnectWallet } = useWallet();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [ethBalance, setEthBalance] = useState<string>('0');
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [loading, setLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState({ eth: '', usdc: '' });
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawToken, setWithdrawToken] = useState<'eth' | 'usdc'>('eth');
  
  // Swap state
  const [swapAmount, setSwapAmount] = useState({ eth: '', usdc: '' });
  const [swapDirection, setSwapDirection] = useState<'eth-to-usdc' | 'usdc-to-eth'>('eth-to-usdc');
  const [swapQuote, setSwapQuote] = useState<string | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Load balances
  useEffect(() => {
    if (!isOpen || !account || !provider) return;

    const loadBalances = async () => {
      try {
        // Load ETH balance
        const ethBalanceWei = await provider.getBalance(account);
        const ethBalanceFormatted = ethers.formatEther(ethBalanceWei);
        setEthBalance(parseFloat(ethBalanceFormatted).toFixed(4));

        // Load USDC balance
        const usdcBalanceWei = await getUSDCBalance(provider, account);
        const usdcBalanceFormatted = formatUSDC(usdcBalanceWei);
        setUsdcBalance(parseFloat(usdcBalanceFormatted).toFixed(2));
      } catch (error: any) {
        // Suppress network changed errors (normal when switching from mainnet to Sepolia)
        if (error?.code === 'NETWORK_ERROR' && error?.message?.includes('network changed')) {
          // This is expected when switching networks, ignore it
          return;
        }
        console.error('Error loading balances:', error);
      }
    };

    loadBalances();
    // Refresh balances every 5 seconds when modal is open
    const interval = setInterval(loadBalances, 5000);
    return () => clearInterval(interval);
  }, [isOpen, account, provider]);

  const handleWithdraw = async () => {
    if (!signer || !account || !provider) {
      toast.error('Wallet not connected');
      return;
    }

    if (!withdrawAddress || !ethers.isAddress(withdrawAddress)) {
      toast.error('Invalid recipient address');
      return;
    }

    setLoading(true);

    try {
      if (withdrawToken === 'eth') {
        const amount = withdrawAmount.eth;
        if (!amount || parseFloat(amount) <= 0) {
          toast.error('Invalid ETH amount');
          setLoading(false);
          return;
        }

        const amountWei = ethers.parseEther(amount);
        const balanceWei = await provider.getBalance(account);
        
        if (amountWei > balanceWei) {
          toast.error('Insufficient ETH balance');
          setLoading(false);
          return;
        }

        // Send ETH
        const tx = await signer.sendTransaction({
          to: withdrawAddress,
          value: amountWei,
        });

        toast.info(`Withdrawing ${amount} ETH...`, { autoClose: 3000 });
        await tx.wait();
        toast.success(`Successfully withdrew ${amount} ETH to ${withdrawAddress.slice(0, 6)}...${withdrawAddress.slice(-4)}`);
        
        setWithdrawAmount({ ...withdrawAmount, eth: '' });
        setWithdrawAddress('');
        
        // Reload balances
        const ethBalanceWei = await provider.getBalance(account);
        const ethBalanceFormatted = ethers.formatEther(ethBalanceWei);
        setEthBalance(parseFloat(ethBalanceFormatted).toFixed(4));
      } else {
        const amount = withdrawAmount.usdc;
        if (!amount || parseFloat(amount) <= 0) {
          toast.error('Invalid USDC amount');
          setLoading(false);
          return;
        }

        if (!provider) {
          toast.error('Provider not available');
          setLoading(false);
          return;
        }

        const amountWei = parseUSDC(amount);
        const balanceWei = await getUSDCBalance(provider, account);
        
        if (amountWei > balanceWei) {
          toast.error('Insufficient USDC balance');
          setLoading(false);
          return;
        }

        // Transfer USDC
        const usdcContract = getUSDCToken(signer);
        const tx = await usdcContract.transfer(withdrawAddress, amountWei);
        
        toast.info(`Withdrawing ${amount} USDC...`, { autoClose: 3000 });
        await tx.wait();
        toast.success(`Successfully withdrew ${amount} USDC to ${withdrawAddress.slice(0, 6)}...${withdrawAddress.slice(-4)}`);
        
        setWithdrawAmount({ ...withdrawAmount, usdc: '' });
        setWithdrawAddress('');
        
        // Reload balances
        const usdcBalanceWei = await getUSDCBalance(provider, account);
        const usdcBalanceFormatted = formatUSDC(usdcBalanceWei);
        setUsdcBalance(parseFloat(usdcBalanceFormatted).toFixed(2));
      }
    } catch (error: any) {
      console.error('Withdraw error:', error);
      toast.error(error.message || 'Withdraw failed');
    } finally {
      setLoading(false);
    }
  };

  // Get swap quote
  useEffect(() => {
    if (!isOpen || !account || !provider) {
      setSwapQuote(null);
      setQuoteLoading(false);
      return;
    }

    const getQuote = async () => {
      if (swapDirection === 'eth-to-usdc' && swapAmount.eth && parseFloat(swapAmount.eth) > 0) {
        setQuoteLoading(true);
        try {
          const quote = await getUSDCQuote(provider, swapAmount.eth);
          setSwapQuote(quote);
        } catch (error) {
          console.error('Error getting quote:', error);
          setSwapQuote(null);
        } finally {
          setQuoteLoading(false);
        }
      } else if (swapDirection === 'usdc-to-eth' && swapAmount.usdc && parseFloat(swapAmount.usdc) > 0) {
        setQuoteLoading(true);
        try {
          const quote = await getETHQuote(provider, swapAmount.usdc);
          setSwapQuote(quote);
        } catch (error) {
          console.error('Error getting quote:', error);
          setSwapQuote(null);
        } finally {
          setQuoteLoading(false);
        }
      } else {
        setSwapQuote(null);
        setQuoteLoading(false);
      }
    };

    const timeoutId = setTimeout(getQuote, 500); // Debounce
    return () => clearTimeout(timeoutId);
  }, [isOpen, account, provider, swapDirection, swapAmount.eth, swapAmount.usdc]);

  const handleSwap = async () => {
    if (!signer || !account || !provider) {
      toast.error('Wallet not connected');
      return;
    }

    setSwapLoading(true);

    try {
      if (swapDirection === 'eth-to-usdc') {
        const amount = swapAmount.eth;
        if (!amount || parseFloat(amount) <= 0) {
          toast.error('Invalid ETH amount');
          setSwapLoading(false);
          return;
        }

        const balanceWei = await provider.getBalance(account);
        const amountWei = ethers.parseEther(amount);
        
        if (amountWei > balanceWei) {
          toast.error('Insufficient ETH balance');
          setSwapLoading(false);
          return;
        }

        toast.info(`Swapping ${amount} ETH to USDC...`, { autoClose: 3000 });
        const tx = await swapETHToUSDC(signer, amount);
        await tx.wait();
        toast.success(`Successfully swapped ${amount} ETH to USDC`);
        
        setSwapAmount({ ...swapAmount, eth: '' });
        setSwapQuote(null);
        
        // Reload balances
        const ethBalanceWei = await provider.getBalance(account);
        const ethBalanceFormatted = ethers.formatEther(ethBalanceWei);
        setEthBalance(parseFloat(ethBalanceFormatted).toFixed(4));
        
        const usdcBalanceWei = await getUSDCBalance(provider, account);
        const usdcBalanceFormatted = formatUSDC(usdcBalanceWei);
        setUsdcBalance(parseFloat(usdcBalanceFormatted).toFixed(2));
      } else {
        const amount = swapAmount.usdc;
        if (!amount || parseFloat(amount) <= 0) {
          toast.error('Invalid USDC amount');
          setSwapLoading(false);
          return;
        }

        if (!provider) {
          toast.error('Provider not available');
          setSwapLoading(false);
          return;
        }

        const amountWei = parseUSDC(amount);
        const balanceWei = await getUSDCBalance(provider, account);
        
        if (amountWei > balanceWei) {
          toast.error('Insufficient USDC balance');
          setSwapLoading(false);
          return;
        }

        // Note: swapUSDCToETH function handles Permit2 approval internally
        // No need to approve here as it's done in the swap function

        toast.info(`Swapping ${amount} USDC to ETH...`, { autoClose: 3000 });
        const tx = await swapUSDCToETH(signer, amount);
        // Note: swapUSDCToETH automatically unwraps WETH to ETH after swap
        await tx.wait();
        toast.success(`Successfully swapped ${amount} USDC to ETH`);
        
        setSwapAmount({ ...swapAmount, usdc: '' });
        setSwapQuote(null);
        
        // Reload balances
        const ethBalanceWei = await provider.getBalance(account);
        const ethBalanceFormatted = ethers.formatEther(ethBalanceWei);
        setEthBalance(parseFloat(ethBalanceFormatted).toFixed(4));
        
        const usdcBalanceWei = await getUSDCBalance(provider, account);
        const usdcBalanceFormatted = formatUSDC(usdcBalanceWei);
        setUsdcBalance(parseFloat(usdcBalanceFormatted).toFixed(2));
      }
    } catch (error: any) {
      console.error('Swap error:', error);
      toast.error(error.message || 'Swap failed');
    } finally {
      setSwapLoading(false);
    }
  };

  if (!mounted || !isOpen || !account) return null;

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const copyAddress = async () => {
    if (account) {
      try {
        await navigator.clipboard.writeText(account);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy address:', err);
      }
    }
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    onClose();
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8" 
      onClick={onClose}
      style={{ zIndex: 99999 }}
    >
      <div 
        className="relative bg-dark-900 border border-dark-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 my-auto" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-800">
          <h2 className="text-xl font-semibold text-white">Wallet</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Wallet Address
            </label>
            <div className="flex items-center space-x-2 bg-dark-800 rounded-lg p-4">
              <code className="flex-1 text-white font-mono text-sm break-all">
                {account}
              </code>
              <button
                onClick={copyAddress}
                className="p-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <CheckIcon className="h-5 w-5 text-green-400" />
                ) : (
                  <DocumentDuplicateIcon className="h-5 w-5" />
                )}
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {formatAddress(account)}
            </div>
          </div>

          {/* QR Code */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-400">
                QR Code
              </label>
              <button
                onClick={() => setShowQR(!showQR)}
                className="flex items-center space-x-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
              >
                <QrCodeIcon className="h-4 w-4" />
                <span>{showQR ? 'Hide' : 'Show'} QR Code</span>
              </button>
            </div>
            {showQR && (
              <div className="flex justify-center bg-white p-4 rounded-lg">
                <QRCodeSVG value={account} size={200} level="H" />
              </div>
            )}
          </div>

          {/* Balances */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-dark-800 rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">ETH Balance</div>
              <div className="text-lg font-semibold text-white">{ethBalance} ETH</div>
            </div>
            <div className="bg-dark-800 rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">USDC Balance</div>
              <div className="text-lg font-semibold text-white">{usdcBalance} USDC</div>
            </div>
          </div>

          {/* Swap Section */}
          <div className="bg-dark-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Swap</h3>
              <ArrowPathIcon className="h-5 w-5 text-gray-400" />
            </div>
            
            {/* Swap Direction */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSwapDirection('eth-to-usdc');
                  setSwapAmount({ ...swapAmount, usdc: '' });
                  setSwapQuote(null);
                }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  swapDirection === 'eth-to-usdc'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:text-white'
                }`}
              >
                ETH → USDC
              </button>
              <button
                onClick={() => {
                  setSwapDirection('usdc-to-eth');
                  setSwapAmount({ ...swapAmount, eth: '' });
                  setSwapQuote(null);
                }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  swapDirection === 'usdc-to-eth'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:text-white'
                }`}
              >
                USDC → ETH
              </button>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Amount ({swapDirection === 'eth-to-usdc' ? 'ETH' : 'USDC'})
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={swapDirection === 'eth-to-usdc' ? swapAmount.eth : swapAmount.usdc}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (swapDirection === 'eth-to-usdc') {
                      setSwapAmount({ ...swapAmount, eth: value, usdc: '' });
                    } else {
                      setSwapAmount({ ...swapAmount, usdc: value, eth: '' });
                    }
                  }}
                  placeholder="0.0"
                  className="w-full bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={() => {
                    const maxAmount = swapDirection === 'eth-to-usdc' ? ethBalance : usdcBalance;
                    if (swapDirection === 'eth-to-usdc') {
                      setSwapAmount({ ...swapAmount, eth: maxAmount, usdc: '' });
                    } else {
                      setSwapAmount({ ...swapAmount, usdc: maxAmount, eth: '' });
                    }
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-primary-400 hover:text-primary-300 bg-dark-800 rounded"
                >
                  MAX
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Balance: {swapDirection === 'eth-to-usdc' ? ethBalance : usdcBalance} {swapDirection === 'eth-to-usdc' ? 'ETH' : 'USDC'}
              </div>
            </div>

            {/* Quote Display - Always show if amount is entered */}
            {((swapDirection === 'eth-to-usdc' && swapAmount.eth) || (swapDirection === 'usdc-to-eth' && swapAmount.usdc)) && (
              <div className="bg-dark-900/50 border border-dark-700 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">You will receive (estimated)</div>
                {quoteLoading ? (
                  <div className="text-sm text-gray-500">Calculating quote...</div>
                ) : swapQuote ? (
                  <div className="text-lg font-semibold text-white">
                    {parseFloat(swapQuote).toFixed(swapDirection === 'eth-to-usdc' ? 2 : 6)} {swapDirection === 'eth-to-usdc' ? 'USDC' : 'ETH'}
                  </div>
                ) : (
                  <div className="text-sm text-yellow-400">
                    Quote unavailable - swap will proceed without slippage protection
                  </div>
                )}
              </div>
            )}

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={swapLoading || !swapAmount[swapDirection === 'eth-to-usdc' ? 'eth' : 'usdc'] || parseFloat(swapAmount[swapDirection === 'eth-to-usdc' ? 'eth' : 'usdc']) <= 0}
              className="w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-dark-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {swapLoading ? 'Swapping...' : `Swap ${swapDirection === 'eth-to-usdc' ? 'ETH → USDC' : 'USDC → ETH'}`}
            </button>
          </div>

          {/* Withdraw Section */}
          <div className="bg-dark-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Withdraw</h3>
              <ArrowDownTrayIcon className="h-5 w-5 text-gray-400" />
            </div>
            
            {/* Token Selection */}
            <div className="flex gap-2">
              <button
                onClick={() => setWithdrawToken('eth')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  withdrawToken === 'eth'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:text-white'
                }`}
              >
                ETH
              </button>
              <button
                onClick={() => setWithdrawToken('usdc')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  withdrawToken === 'usdc'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-gray-400 hover:text-white'
                }`}
              >
                USDC
              </button>
            </div>

            {/* Recipient Address */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Recipient Address</label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder="0x..."
                className="w-full bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Amount ({withdrawToken.toUpperCase()})</label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={withdrawToken === 'eth' ? withdrawAmount.eth : withdrawAmount.usdc}
                  onChange={(e) => {
                    const value = e.target.value;
                    setWithdrawAmount({
                      ...withdrawAmount,
                      [withdrawToken]: value,
                    });
                  }}
                  placeholder="0.0"
                  className="w-full bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 pr-16 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={() => {
                    const maxAmount = withdrawToken === 'eth' ? ethBalance : usdcBalance;
                    setWithdrawAmount({
                      ...withdrawAmount,
                      [withdrawToken]: maxAmount,
                    });
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-primary-400 hover:text-primary-300 bg-dark-800 rounded"
                >
                  MAX
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Balance: {withdrawToken === 'eth' ? ethBalance : usdcBalance} {withdrawToken.toUpperCase()}
              </div>
            </div>

            {/* Withdraw Button */}
            <button
              onClick={handleWithdraw}
              disabled={loading || !withdrawAddress || !withdrawAmount[withdrawToken]}
              className="w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-dark-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Processing...' : `Withdraw ${withdrawToken.toUpperCase()}`}
            </button>
          </div>

          {/* Deposit Info */}
          <div className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-primary-400 mb-2">
              Deposit Instructions
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Send ETH or USDC to this address to start trading. Make sure you're on Sepolia testnet.
            </p>
            <div className="space-y-2 text-xs text-gray-500">
              <div>• Network: Sepolia Testnet</div>
              <div>• Chain ID: 11155111</div>
              <div>• Supported Tokens: ETH, USDC</div>
            </div>
          </div>

          {/* Wallet Type */}
          {embeddedWallet && (
            <div className="bg-dark-800 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-400 mb-1">
                Wallet Type
              </div>
              <div className="text-white font-semibold">
                {embeddedWallet.walletClientType === 'privy' ? 'Smart Wallet (Privy)' : 'External Wallet'}
              </div>
              {embeddedWallet.walletClientType === 'privy' && (
                <div className="mt-2 text-xs text-gray-500">
                  Auto-signed transactions enabled (no popups)
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-3">
            <button
              onClick={handleDisconnect}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              Disconnect
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default WalletModal;

