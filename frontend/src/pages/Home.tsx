import React from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { 
  LockClosedIcon, 
  BoltIcon, 
  ChartBarIcon, 
  ArrowPathIcon,
  WalletIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CurrencyDollarIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

const Home: React.FC = () => {
  const { isConnected } = useWallet();

  const features = [
    {
      icon: <LockClosedIcon className="w-8 h-8" />,
      title: 'FHE Encrypted Trading',
      description: 'Trade directions are encrypted with Zama FHE. Your positions remain private until opened, protecting against front-running.',
    },
    {
      icon: <BoltIcon className="w-8 h-8" />,
      title: 'Leverage Trading',
      description: 'Trade with 1x-5x leverage. Open positions with USDC collateral and maximize your trading potential.',
    },
    {
      icon: <ArrowPathIcon className="w-8 h-8" />,
      title: 'Limit Orders',
      description: 'Set limit prices for automatic execution. Optional expiry times give you full control over your trading strategy.',
    },
  ];

  const steps = [
    { 
      number: 1, 
      title: 'Connect Embedded Wallet', 
      description: 'Transfer ETH to your embedded wallet. Your wallet is automatically created via Privy.',
      icon: <WalletIcon className="w-6 h-6" />
    },
    { 
      number: 2, 
      title: 'Swap ETH to USDC', 
      description: 'Swap ETH → USDC in the Swap section. Check your USDC balance after the swap.',
      icon: <ArrowPathIcon className="w-6 h-6" />
    },
    { 
      number: 3, 
      title: 'Open Position', 
      description: 'Select pair (BTCUSD, ETHUSD, etc.), choose Long/Short (encrypted with FHE), enter collateral (USDC), select leverage (1x-5x), and open position.',
      icon: <ArrowTrendingUpIcon className="w-6 h-6" />
    },
    { 
      number: 4, 
      title: 'Manage Position', 
      description: 'View positions in Open Positions tab. Track real-time PnL. Close your position when ready.',
      icon: <ChartBarIcon className="w-6 h-6" />
    },
    { 
      number: 5, 
      title: 'Limit Orders (Optional)', 
      description: 'Set limit price and optional expiry time. Position automatically opens when order executes at your target price.',
      icon: <ClockIcon className="w-6 h-6" />
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
          ShadeFX
        </h1>
        <p className="text-xl md:text-2xl text-gray-400 mb-4">
          Confidential Perpetual DEX
        </p>
        {/* Sepolia Testnet Badge */}
        <div className="inline-flex items-center px-4 py-2 mb-6 bg-yellow-500/20 border border-yellow-500/50 rounded-full">
          <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2 animate-pulse"></span>
          <span className="text-sm font-medium text-yellow-400">Sepolia Testnet</span>
        </div>
        <p className="max-w-3xl mx-auto text-lg text-gray-300 mb-8 leading-relaxed">
          Trade cryptocurrency pairs with encrypted positions using <span className="text-primary-400 font-semibold">Zama FHE</span> (Fully Homomorphic Encryption).
          Your trade directions remain private until positions are opened, protecting against front-running and preserving your trading strategy.
        </p>
        <p className="max-w-2xl mx-auto text-sm text-gray-400 mb-8 italic">
          Currently active on Sepolia Testnet. Production launch coming soon.
        </p>

        {isConnected ? (
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/predictions"
              className="btn-primary inline-flex items-center justify-center"
            >
              Start Trading
            </Link>
            <Link
              to="/portfolio"
              className="btn-secondary inline-flex items-center justify-center"
            >
              View My Stats
            </Link>
            <Link
              to="/leaderboard"
              className="btn-secondary inline-flex items-center justify-center"
            >
              Leaderboard
            </Link>
          </div>
        ) : (
          <div className="inline-flex items-center px-6 py-3 bg-dark-800 rounded-xl border border-dark-700">
            <p className="text-gray-300">Please connect your wallet to get started</p>
          </div>
        )}
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {features.map((feature, index) => (
          <div
            key={index}
            className="card-glass p-6 hover:scale-105 transition-all duration-300 group"
          >
            <div className="w-12 h-12 bg-gradient-to-br from-primary-600 to-primary-700 rounded-xl flex items-center justify-center text-white mb-4 group-hover:shadow-lg group-hover:shadow-primary-500/50 transition-all duration-300">
              {feature.icon}
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
          </div>
        ))}
      </div>

      {/* How It Works */}
      <div className="mt-16">
        <h2 className="text-3xl font-bold text-white text-center mb-4">How It Works</h2>
        <p className="text-center text-gray-400 mb-12 max-w-2xl mx-auto">
          Get started with ShadeFX Perpetual DEX in 5 simple steps. Trade with USDC collateral and pay fees in ETH.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {steps.map((step, index) => (
            <div
              key={index}
              className="card-glass p-6 text-center relative hover:scale-105 transition-all duration-300 group"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4 shadow-lg group-hover:shadow-primary-500/50 transition-all duration-300">
                {step.number}
              </div>
              <div className="w-12 h-12 mx-auto mb-3 text-primary-400 opacity-70 group-hover:opacity-100 transition-opacity">
                {step.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Home;
