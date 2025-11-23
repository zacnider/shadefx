import { ethers, Contract } from 'ethers';
import { JsonRpcSigner } from 'ethers';

// Contract ABI - Updated for ebool system
// Note: externalEbool is encoded as bytes in the ABI
const SHADEFX_ABI = [
  // Prediction functions
  // Note: externalEbool is encoded as bytes32 in the ABI (not bytes)
  // According to FHEVM documentation, externalEbool/externalEuintXX are bytes32
  'function submitPrediction(string memory currencyPairKey, bytes32 encryptedPrediction, bytes calldata inputProof) external payable',
  'function declareResult(string memory currencyPairKey, bytes32 encryptedRealValue, uint256 endPrice, bytes calldata inputProof) external',
  'function checkWinner(string memory currencyPairKey, address userAddress) external view returns (bool)',
  'function revealWinners(string memory currencyPairKey, address[] calldata winners, address[] calldata longWinners, address[] calldata shortWinners) external',
  'function claimReward(string memory currencyPairKey) external',
  
  // View functions
  'function getPredictionCount(string memory currencyPairKey) external view returns (uint256)',
  'function getRewardPool(string memory currencyPairKey) external view returns (uint256)',
  'function getActivePairs() external view returns (string[] memory)',
  'function getPredictionStats(string memory currencyPairKey) external view returns (uint256 totalPredictions, uint256 longPredictions, uint256 shortPredictions)',
  'function rounds(string memory currencyPairKey) external view returns (uint256 roundId, tuple(string baseCurrency, string quoteCurrency, uint256 startPrice, uint256 endPrice, bool isActive, uint256 predictionDeadline, uint256 minStakeAmount, uint256 rewardFeePercentage) pair, bool resultDeclared, uint256 totalPredictions, uint256 totalLongPredictions, uint256 totalShortPredictions, uint256 totalRewardPool, uint256 rewardPoolSnapshot)',
  
  // Owner functions
  'function createCurrencyPair(string memory currencyPairKey, string memory baseCurrency, string memory quoteCurrency, uint256 startPrice, uint256 predictionDeadline, uint256 pairMinStakeAmount, uint256 pairRewardFeePercentage) external',
  'function setPairMinStakeAmount(string memory currencyPairKey, uint256 _minStakeAmount) external',
  'function setPairRewardFeePercentage(string memory currencyPairKey, uint256 _rewardFeePercentage) external',
  'function updatePairDeadline(string memory currencyPairKey, uint256 predictionDeadline) external',
  'function startNewRound(string memory currencyPairKey, uint256 startPrice, uint256 predictionDeadline) external',
  'function setMinStakeAmount(uint256 _minStakeAmount) external',
  'function setRewardFeePercentage(uint256 _rewardFeePercentage) external',
  
  // Public variables
  'function owner() external view returns (address)',
  'function minStakeAmount() external view returns (uint256)',
  'function rewardFeePercentage() external view returns (uint256)',
  
  // Events
  'event PredictionSubmitted(string indexed currencyPair, address indexed predictor, uint256 timestamp)',
  'event ResultDeclared(string indexed currencyPair, uint256 timestamp)',
  'event WinnerRevealed(string indexed currencyPair, address indexed winner, uint256 reward)',
  'event RewardClaimed(string indexed currencyPair, address indexed claimer, uint256 amount)',
  'event CurrencyPairCreated(string indexed currencyPair, string baseCurrency, string quoteCurrency, uint256 predictionDeadline)',
];

// Contract address - This should be set based on your deployment
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x018f56040fbdd5092a898d0349afE969BDC11A97';

export const getContract = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  if (!CONTRACT_ADDRESS) {
    throw new Error('Contract address not set. Please set REACT_APP_CONTRACT_ADDRESS environment variable.');
  }

  return new ethers.Contract(CONTRACT_ADDRESS, SHADEFX_ABI, signerOrProvider);
};

export const getContractAddress = (): string => {
  return CONTRACT_ADDRESS;
};
