import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getContract } from '../utils/contract';
import {
  TrophyIcon,
  WalletIcon,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

const Results: React.FC = () => {
  const { account, signer, provider, isConnected } = useWallet();
  const [currencyPairs, setCurrencyPairs] = useState<string[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>('');
  const [predictionCount, setPredictionCount] = useState<number>(0);
  const [rewardPool, setRewardPool] = useState<string>('0');
  const [isWinner, setIsWinner] = useState<boolean>(false);
  const [resultDeclared, setResultDeclared] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected && provider) {
      loadCurrencyPairs();
    }
  }, [isConnected, provider]);

  useEffect(() => {
    if (selectedPair && provider) {
      loadPairData();
    }
  }, [selectedPair, provider]);

  const loadCurrencyPairs = async () => {
    if (!provider) return;
    try {
      const contract = getContract(provider);
      const pairs = await contract.getActivePairs();
      setCurrencyPairs(pairs);
      if (pairs.length > 0) {
        setSelectedPair(pairs[0]);
      }
    } catch (err) {
      console.error('Error loading currency pairs:', err);
    }
  };

  const loadPairData = async () => {
    if (!provider || !selectedPair) return;
    try {
      const contract = getContract(provider);
      const count = await contract.getPredictionCount(selectedPair);
      const pool = await contract.getRewardPool(selectedPair);
      const round = await contract.rounds(selectedPair);
      
      setPredictionCount(Number(count));
      setRewardPool(ethers.formatEther(pool));
      setResultDeclared(round.resultDeclared);
      
      if (account) {
        try {
          const winner = await contract.checkWinner(selectedPair, account);
          setIsWinner(winner);
        } catch (err) {
          setIsWinner(false);
        }
      }
    } catch (err) {
      console.error('Error loading pair data:', err);
    }
  };

  const handleClaimReward = async () => {
    if (!signer || !selectedPair || !account) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const contract = getContract(signer);
      const tx = await contract.claimReward(selectedPair);
      await tx.wait();
      setSuccess('Reward claimed successfully!');
      loadPairData();
    } catch (err: any) {
      console.error('Error claiming reward:', err);
      setError(err.message || 'Failed to claim reward');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="card-glass p-12 text-center">
          <WalletIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400">Please connect your wallet to view results.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="card-glass p-8">
        <div className="flex items-center gap-3 mb-6">
          <TrophyIcon className="w-10 h-10 text-primary-500" />
          <div>
            <h2 className="text-3xl font-bold text-white">Results & Rewards</h2>
            <p className="text-gray-400">Check your prediction results and claim rewards</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Currency Pair Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Currency Pair
            </label>
            <select
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="input-field"
            >
              <option value="">Select a currency pair</option>
              {currencyPairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pair}
                </option>
              ))}
            </select>
          </div>

          {/* Results Info */}
          {selectedPair && (
            <div className="card-glass p-6 bg-dark-800/50 border-dark-700">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Total Predictions</p>
                  <p className="text-2xl font-bold text-white">{predictionCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Reward Pool</p>
                  <p className="text-2xl font-bold text-white">{rewardPool} ETH</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Result Declared</p>
                  <div className="flex items-center gap-2 mt-1">
                    {resultDeclared ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm font-medium">
                        <CheckCircleIcon className="w-4 h-4" />
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-500/10 border border-gray-500/20 rounded-lg text-gray-400 text-sm font-medium">
                        <XCircleIcon className="w-4 h-4" />
                        No
                      </span>
                    )}
                  </div>
                </div>
                {account && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Your Status</p>
                    <div className="mt-1">
                      {isWinner ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm font-semibold">
                          <TrophyIcon className="w-4 h-4" />
                          Winner! 🎉
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-500/10 border border-gray-500/20 rounded-lg text-gray-400 text-sm font-medium">
                          <XCircleIcon className="w-4 h-4" />
                          Not a winner
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Alerts */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 text-green-500" />
              <p className="text-sm text-green-500">{success}</p>
            </div>
          )}

          {/* Claim Reward Button */}
          {selectedPair && isWinner && resultDeclared && (
            <button
              onClick={handleClaimReward}
              disabled={loading}
              className="btn-primary w-full py-4 text-lg flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Claiming...
                </>
              ) : (
                <>
                  <TrophyIcon className="w-5 h-5" />
                  Claim Reward
                </>
              )}
            </button>
          )}

          {selectedPair && !resultDeclared && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
              <p className="text-sm text-blue-500">
                Results have not been declared yet. Please wait for the owner to declare results.
              </p>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-8 p-6 bg-dark-800/50 border border-dark-700 rounded-xl">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <InformationCircleIcon className="w-5 h-5 text-primary-500" />
            How it works:
          </h3>
          <ul className="space-y-2 text-sm text-gray-400">
            <li className="flex items-start gap-2">
              <span className="text-primary-500 mt-1">•</span>
              <span>Results are declared by the contract owner after the prediction deadline</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-500 mt-1">•</span>
              <span>Only correct predictions are revealed when results are declared</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-500 mt-1">•</span>
              <span>Winners share the reward pool proportionally</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary-500 mt-1">•</span>
              <span>You can claim your reward if you're a winner</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Results;
