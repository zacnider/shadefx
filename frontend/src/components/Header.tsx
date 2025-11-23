import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { getContract } from '../utils/contract';
import { ethers } from 'ethers';
import WalletModal from './WalletModal';
import { getUSDCBalance, formatUSDC } from '../utils/usdcToken';

const Header: React.FC = () => {
  const { account, isConnected, provider, connectWallet, ready } = useWallet();
  const [ethBalance, setEthBalance] = useState<string>('0');
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const location = useLocation();
  const [isOwner, setIsOwner] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

  useEffect(() => {
    const checkOwner = async () => {
      if (!isConnected || !provider || !account) {
        setIsOwner(false);
        return;
      }
      try {
        const contract = getContract(provider);
        const owner = await contract.owner();
        setIsOwner(owner.toLowerCase() === account.toLowerCase());
      } catch (err) {
        console.error('Error checking owner:', err);
        setIsOwner(false);
      }
    };
    checkOwner();
  }, [isConnected, provider, account]);

  // Load balances
  useEffect(() => {
    if (!isConnected || !account || !provider) {
      setEthBalance('0');
      setUsdcBalance('0');
      return;
    }

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
        // Suppress RPC errors (Privy RPC may be temporarily unavailable)
        if (error?.message?.includes('HTTP request failed') || 
            error?.message?.includes('Failed to fetch') ||
            error?.code === 'UNKNOWN_ERROR' ||
            error?.message?.includes('could not coalesce error')) {
          // RPC endpoint temporarily unavailable - silently retry on next interval
          return;
        }
        // Only log unexpected errors
        if (process.env.NODE_ENV === 'development') {
          console.error('Error loading balances:', error);
        }
      }
    };

    loadBalances();
    // Refresh balances every 10 seconds
    const interval = setInterval(loadBalances, 10000);
    return () => clearInterval(interval);
  }, [isConnected, account, provider]);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const navItems = React.useMemo(() => {
    const items = [
      { path: '/', label: 'Home' },
      { path: '/predictions', label: 'Trade' },
      { path: '/portfolio', label: 'My Stats' },
      { path: '/leaderboard', label: 'Leaderboard' },
    ];
    
    // Add Admin link only if user is owner
    if (isOwner) {
      items.push({ path: '/admin', label: 'Admin' });
    }
    
    return items;
  }, [isOwner]);

  return (
    <header className="sticky top-0 z-50 bg-dark-900/80 backdrop-blur-xl border-b border-dark-800/50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 group">
            <img 
              src="/logo.png" 
              alt="ShadeFX Logo" 
              className="h-16 w-auto object-contain group-hover:opacity-80 transition-opacity duration-300"
            />
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 ${
                  location.pathname === item.path
                    ? 'bg-primary-600 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-dark-800'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Wallet Section */}
          <div className="flex items-center space-x-3">
            {ready && isConnected && account ? (
              <div className="flex items-center space-x-3">
                {/* Balances */}
                <div className="hidden md:flex items-center space-x-3">
                  <div className="bg-dark-800/50 px-3 py-1.5 rounded-lg border border-dark-700">
                    <div className="text-xs text-gray-400">ETH</div>
                    <div className="text-sm font-semibold text-white">{ethBalance}</div>
                  </div>
                  <div className="bg-dark-800/50 px-3 py-1.5 rounded-lg border border-dark-700">
                    <div className="text-xs text-gray-400">USDC</div>
                    <div className="text-sm font-semibold text-white">{usdcBalance}</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowWalletModal(true)}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
                >
                  <span>Profile</span>
                  <span className="text-xs text-primary-200 font-normal">{formatAddress(account)}</span>
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={!ready}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ready ? 'Connect Wallet' : 'Loading...'}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Wallet Modal */}
      {showWalletModal && (
        <WalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
        />
      )}
    </header>
  );
};

export default Header;
