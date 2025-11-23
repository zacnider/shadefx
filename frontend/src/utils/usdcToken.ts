import { ethers, Contract } from 'ethers';
import { JsonRpcSigner } from 'ethers';

// Sepolia USDC address
export const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// USDC ABI (ERC20 standard functions)
const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export const getUSDCToken = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  return new ethers.Contract(USDC_ADDRESS, USDC_ABI, signerOrProvider);
};

export const formatUSDC = (amount: bigint): string => {
  return ethers.formatUnits(amount, 6); // USDC has 6 decimals
};

export const parseUSDC = (amount: string): bigint => {
  return ethers.parseUnits(amount, 6); // USDC has 6 decimals
};

export const checkUSDCAllowance = async (
  provider: ethers.Provider,
  owner: string,
  spender: string
): Promise<bigint> => {
  const usdc = getUSDCToken(provider);
  return await usdc.allowance(owner, spender);
};

export const approveUSDC = async (
  signer: JsonRpcSigner,
  spender: string,
  amount: bigint
): Promise<ethers.ContractTransactionResponse> => {
  const usdc = getUSDCToken(signer);
  return await usdc.approve(spender, amount);
};

export const getUSDCBalance = async (
  provider: ethers.Provider,
  address: string
): Promise<bigint> => {
  const usdc = getUSDCToken(provider);
  return await usdc.balanceOf(address);
};


