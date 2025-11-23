import { ethers, Contract } from 'ethers';
import { JsonRpcSigner } from 'ethers';

// Uniswap Universal Router (Sepolia)
export const UNISWAP_UNIVERSAL_ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
// Permit2 address (same on all networks)
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// Permit2 ABI (minimal functions needed)
const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function nonces(address owner, address token) view returns (uint256)',
];

// EIP-712 domain for Permit2
const PERMIT2_DOMAIN = {
  name: 'Permit2',
  chainId: 11155111, // Sepolia
  verifyingContract: PERMIT2_ADDRESS,
};

// Permit2 permit types for EIP-712
const PERMIT_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
};
// Uniswap V3 SwapRouter (backup, Sepolia - same as mainnet)
export const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
// Uniswap V3 Quoter V2 (Sepolia - same as mainnet)
export const UNISWAP_V3_QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
// WETH address (Sepolia)
export const WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
// USDC address (Sepolia)
export const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
// Pool fee tier (0.3% = 3000)
export const POOL_FEE = 3000;

// Uniswap Universal Router ABI
const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) payable',
];

// Uniswap V3 SwapRouter ABI (minimal functions needed)
const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)',
];

// Uniswap V3 Quoter V2 ABI
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// WETH ABI (for unwrapping)
const WETH_ABI = [
  'function withdraw(uint256) external',
  'function deposit() external payable',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

export const getUniversalRouter = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  return new ethers.Contract(UNISWAP_UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_ABI, signerOrProvider);
};

export const getSwapRouter = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  return new ethers.Contract(UNISWAP_V3_ROUTER, SWAP_ROUTER_ABI, signerOrProvider);
};

export const getQuoter = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  return new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_ABI, signerOrProvider);
};

export const getWETH = (signerOrProvider: JsonRpcSigner | ethers.Provider): Contract => {
  return new ethers.Contract(WETH_ADDRESS, WETH_ABI, signerOrProvider);
};

/**
 * Get quote for ETH to USDC swap using Uniswap V3 Quoter
 */
export const getUSDCQuote = async (
  provider: ethers.Provider,
  ethAmount: string
): Promise<string | null> => {
  try {
    if (!ethAmount || parseFloat(ethAmount) <= 0) return null;
    
    const quoter = getQuoter(provider);
    const ethAmountWei = ethers.parseEther(ethAmount);
    
    // Quote ETH (WETH) to USDC (read-only call)
    const quoteResult = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: WETH_ADDRESS,
      tokenOut: USDC_ADDRESS,
      fee: POOL_FEE,
      amountIn: ethAmountWei,
      sqrtPriceLimitX96: 0,
    });
    
    const usdcAmountWei = quoteResult[0]; // First return value is amountOut
    
    if (usdcAmountWei === BigInt(0)) return null;
    
    // USDC has 6 decimals
    return ethers.formatUnits(usdcAmountWei, 6);
  } catch (error) {
    console.error('Error getting USDC quote:', error);
    return null;
  }
};

/**
 * Get quote for USDC to ETH swap using Uniswap V3 Quoter
 */
export const getETHQuote = async (
  provider: ethers.Provider,
  usdcAmount: string
): Promise<string | null> => {
  try {
    if (!usdcAmount || parseFloat(usdcAmount) <= 0) return null;
    
    const quoter = getQuoter(provider);
    const usdcAmountWei = ethers.parseUnits(usdcAmount, 6); // USDC has 6 decimals
    
    // Quote USDC to ETH (WETH) (read-only call)
    const quoteResult = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: USDC_ADDRESS,
      tokenOut: WETH_ADDRESS,
      fee: POOL_FEE,
      amountIn: usdcAmountWei,
      sqrtPriceLimitX96: 0,
    });
    
    const ethAmountWei = quoteResult[0]; // First return value is amountOut
    
    if (ethAmountWei === BigInt(0)) return null;
    
    return ethers.formatEther(ethAmountWei);
  } catch (error) {
    console.error('Error getting ETH quote:', error);
    return null;
  }
};

/**
 * Swap ETH to USDC using Uniswap Universal Router
 * Wraps ETH to WETH and swaps in a single transaction
 */
export const swapETHToUSDC = async (
  signer: JsonRpcSigner,
  ethAmount: string,
  slippageTolerance: number = 0.5 // 0.5% default slippage
): Promise<ethers.ContractTransactionResponse> => {
  const router = getUniversalRouter(signer);
  const provider = await signer.provider;
  const ethAmountWei = ethers.parseEther(ethAmount);
  const userAddress = await signer.getAddress();
  
  let amountOutMinimum = BigInt(0);
  
  // Try to get quote, but if it fails, use 0 as minimum (no slippage protection)
  try {
    const quoter = getQuoter(provider);
    const quoteResult = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: WETH_ADDRESS,
      tokenOut: USDC_ADDRESS,
      fee: POOL_FEE,
      amountIn: ethAmountWei,
      sqrtPriceLimitX96: 0,
    });
    
    const usdcAmountWei = quoteResult[0];
    amountOutMinimum = (usdcAmountWei * BigInt(Math.floor((100 - slippageTolerance) * 100))) / BigInt(10000);
  } catch (error) {
    console.warn('Could not get quote, proceeding with minimum amount 0 (no slippage protection):', error);
    // amountOutMinimum stays 0
  }
  
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  
  // Command 1: WRAP_ETH (0x0b)
  // Parameters: (address recipient, uint256 amount)
  // recipient: Universal Router address (router receives WETH to use in swap)
  // ADDRESS_THIS = 0x0000000000000000000000000000000000000002 (special address meaning "this contract")
  const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';
  const wrapInput = abiCoder.encode(
    ['address', 'uint256'],
    [ADDRESS_THIS, ethAmountWei] // Router receives WETH
  );
  
  // Command 2: V3_SWAP_EXACT_IN (0x00)
  // Parameters: (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
  // Path: WETH -> USDC (fee: 3000)
  // payerIsUser = false means router pays from its WETH balance (from WRAP_ETH)
  const pathEncoded = ethers.solidityPacked(
    ['address', 'uint24', 'address'],
    [WETH_ADDRESS, POOL_FEE, USDC_ADDRESS]
  );
  
  const swapInput = abiCoder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [userAddress, ethAmountWei, amountOutMinimum, pathEncoded, false] // payerIsUser = false (router pays WETH)
  );
  
  // Commands: 0x0b (WRAP_ETH) + 0x00 (V3_SWAP_EXACT_IN)
  const commands = '0x0b00';
  const inputs = [wrapInput, swapInput];
  
  console.log('Universal Router swap params:', {
    commands,
    inputs: inputs.map(i => i.slice(0, 50) + '...'),
    deadline,
    value: ethAmountWei.toString()
  });
  
  return await router.execute(commands, inputs, deadline, { value: ethAmountWei });
};

/**
 * Swap USDC to ETH using Uniswap Universal Router
 * Swaps USDC to WETH, then unwraps WETH to ETH in a single transaction
 */
export const swapUSDCToETH = async (
  signer: JsonRpcSigner,
  usdcAmount: string,
  slippageTolerance: number = 0.5 // 0.5% default slippage
): Promise<ethers.ContractTransactionResponse> => {
  const router = getUniversalRouter(signer);
  const provider = await signer.provider;
  const usdcAmountWei = ethers.parseUnits(usdcAmount, 6); // USDC has 6 decimals
  const userAddress = await signer.getAddress();
  
  let amountOutMinimum = BigInt(0);
  
  // Try to get quote, but if it fails, use 0 as minimum (no slippage protection)
  try {
    const quoter = getQuoter(provider);
    const quoteResult = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: USDC_ADDRESS,
      tokenOut: WETH_ADDRESS,
      fee: POOL_FEE,
      amountIn: usdcAmountWei,
      sqrtPriceLimitX96: 0,
    });
    
    const ethAmountWei = quoteResult[0];
    amountOutMinimum = (ethAmountWei * BigInt(Math.floor((100 - slippageTolerance) * 100))) / BigInt(10000);
  } catch (error) {
    console.warn('Could not get quote, proceeding with minimum amount 0 (no slippage protection):', error);
    // amountOutMinimum stays 0
  }
  
  // Approve USDC to Permit2 (Universal Router uses Permit2 for token transfers)
  // Universal Router requires Permit2 approval for ERC20 token transfers
  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    ['function approve(address spender, uint256 amount) returns (bool)', 'function allowance(address owner, address spender) view returns (uint256)'],
    signer
  );
  
  // Step 1: Approve USDC token to Permit2 contract
  const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const permit2TokenAllowance = await usdcContract.allowance(userAddress, PERMIT2_ADDRESS);
  
  if (permit2TokenAllowance < usdcAmountWei) {
    console.log('Approving USDC token to Permit2...');
    const approveTx = await usdcContract.approve(PERMIT2_ADDRESS, MAX_UINT256);
    await approveTx.wait();
    console.log('USDC token approved to Permit2');
  }
  
  // Step 2: Sign Permit2 permit for Universal Router
  // Universal Router requires Permit2 permit signature for token transfers
  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
  const MAX_UINT160 = '0xffffffffffffffffffffffffffffffffffffffff';
  const MAX_UINT48 = '0xffffffffffff'; // Max expiration (far future)
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const sigDeadline = deadline;
  
  // Get nonce for Permit2
  let nonce = BigInt(0);
  try {
    nonce = await permit2Contract.nonces(userAddress, USDC_ADDRESS);
  } catch (error) {
    console.warn('Error getting nonce, using 0:', error);
  }
  
  // Check if Permit2 approval exists and is valid
  let needsPermit = true;
  try {
    const permit2Allowance = await permit2Contract.allowance(userAddress, USDC_ADDRESS, UNISWAP_UNIVERSAL_ROUTER);
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    if (permit2Allowance.amount >= usdcAmountWei && permit2Allowance.expiration > currentTime) {
      needsPermit = false;
      console.log('Permit2 allowance already exists and is valid');
    }
  } catch (error) {
    console.warn('Error checking Permit2 allowance:', error);
  }
  
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';
  const MSG_SENDER = '0x0000000000000000000000000000000000000001';
  
  let commands = '';
  let inputs: string[] = [];
  
  if (needsPermit) {
    // Step 2a: Sign Permit2 permit (EIP-712)
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + BigInt(365 * 24 * 60 * 60); // 1 year
    
    const permitMessage = {
      details: {
        token: USDC_ADDRESS,
        amount: MAX_UINT160, // Max amount
        expiration: expiration.toString(),
        nonce: nonce.toString(),
      },
      spender: UNISWAP_UNIVERSAL_ROUTER,
      sigDeadline: sigDeadline.toString(),
    };
    
    // Sign EIP-712 permit
    const permitSignature = await (signer as any).signTypedData(
      PERMIT2_DOMAIN,
      { PermitSingle: PERMIT_TYPES.PermitSingle, PermitDetails: PERMIT_TYPES.PermitDetails },
      permitMessage
    );
    
    // Command 1: PERMIT2_PERMIT (0x0a)
    // Parameters: (PermitSingle permit, bytes signature)
    // PermitSingle struct: { details: { token, amount, expiration, nonce }, spender, sigDeadline }
    const permitInput = abiCoder.encode(
      ['tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)', 'bytes'],
      [
        [
          [USDC_ADDRESS, MAX_UINT160, expiration, nonce],
          UNISWAP_UNIVERSAL_ROUTER,
          sigDeadline,
        ],
        permitSignature,
      ]
    );
    
    commands = '0x0a';
    inputs.push(permitInput);
  }
  
  // Command: V3_SWAP_EXACT_IN (0x00)
  // Parameters: (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
  // Path: USDC -> WETH (fee: 3000)
  // recipient: ADDRESS_THIS (router receives WETH to unwrap)
  // payerIsUser = true (user pays USDC via Permit2)
  const pathEncoded = ethers.solidityPacked(
    ['address', 'uint24', 'address'],
    [USDC_ADDRESS, POOL_FEE, WETH_ADDRESS]
  );
  
  const swapInput = abiCoder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [ADDRESS_THIS, usdcAmountWei, amountOutMinimum, pathEncoded, true] // payerIsUser = true (user pays USDC)
  );
  
  // Command: UNWRAP_WETH (0x0c)
  // Parameters: (address recipient, uint256 amountMin)
  // recipient: MSG_SENDER (user receives ETH)
  // amountMin: 0 (unwrap all WETH)
  const unwrapInput = abiCoder.encode(
    ['address', 'uint256'],
    [MSG_SENDER, 0] // Unwrap all WETH to ETH, send to user
  );
  
  // Commands: PERMIT2_PERMIT (if needed) + V3_SWAP_EXACT_IN + UNWRAP_WETH
  commands = needsPermit ? '0x0a000c' : '0x000c';
  inputs.push(swapInput, unwrapInput);
  
  console.log('Universal Router USDC->ETH swap params:', {
    commands,
    inputs: inputs.map(i => i.slice(0, 50) + '...'),
    deadline,
  });
  
  return await router.execute(commands, inputs, deadline);
};

