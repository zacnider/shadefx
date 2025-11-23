// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoterV2.sol";

/**
 * @title UniswapSwap
 * @notice ETH ↔ USDC swap using Uniswap V3 at real market prices
 * @dev Uses Uniswap V3 router for best price execution
 * Sepolia USDC: 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238
 */
contract UniswapSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // Sepolia USDC address
    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    
    // Uniswap V3 SwapRouter (Sepolia - same address as mainnet)
    ISwapRouter public constant SWAP_ROUTER = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    
    // Uniswap V3 Quoter V2 (Sepolia - same address as mainnet)
    IQuoterV2 public constant QUOTER_V2 = IQuoterV2(0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a);
    
    // WETH address (Sepolia)
    address public constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    
    // Uniswap V3 Pool Fee Tier (0.3% = 3000)
    uint24 public constant POOL_FEE = 3000;
    
    // Events
    event ETHToUSDC(address indexed user, uint256 ethAmount, uint256 usdcAmount);
    event USDCToETH(address indexed user, uint256 usdcAmount, uint256 ethAmount);
    event SwapFailed(address indexed user, string reason);
    
    constructor(address initialOwner) Ownable(initialOwner) {}
    
    /**
     * @notice Swap ETH to USDC using Uniswap V3
     * @param amountOutMinimum Minimum USDC amount to receive (slippage protection)
     * @param deadline Transaction deadline
     * @return usdcAmount Amount of USDC received
     */
    function swapETHToUSDC(
        uint256 amountOutMinimum,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 usdcAmount) {
        require(msg.value > 0, "UniswapSwap: invalid ETH amount");
        require(deadline >= block.timestamp, "UniswapSwap: deadline passed");
        
        // Prepare swap parameters
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: WETH,
            tokenOut: USDC,
            fee: POOL_FEE,
            recipient: msg.sender,
            deadline: deadline,
            amountIn: msg.value,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });
        
        // Execute swap (ETH is automatically wrapped to WETH by router)
        try SWAP_ROUTER.exactInputSingle{value: msg.value}(params) returns (uint256 amountOut) {
            usdcAmount = amountOut;
            emit ETHToUSDC(msg.sender, msg.value, usdcAmount);
        } catch Error(string memory reason) {
            emit SwapFailed(msg.sender, reason);
            revert(reason);
        } catch {
            emit SwapFailed(msg.sender, "Unknown error");
            revert("UniswapSwap: swap failed");
        }
    }
    
    /**
     * @notice Swap USDC to ETH using Uniswap V3
     * @param usdcAmount Amount of USDC to swap
     * @param amountOutMinimum Minimum ETH amount to receive (slippage protection)
     * @param deadline Transaction deadline
     * @return ethAmount Amount of ETH received
     */
    function swapUSDCToETH(
        uint256 usdcAmount,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external nonReentrant returns (uint256 ethAmount) {
        require(usdcAmount > 0, "UniswapSwap: invalid USDC amount");
        require(deadline >= block.timestamp, "UniswapSwap: deadline passed");
        require(IERC20(USDC).balanceOf(msg.sender) >= usdcAmount, "UniswapSwap: insufficient USDC balance");
        
        // Transfer USDC from user
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), usdcAmount);
        
        // Approve router to spend USDC
        // Note: OpenZeppelin 5.x deprecated safeApprove, use safeIncreaseAllowance instead
        IERC20 token = IERC20(USDC);
        token.safeIncreaseAllowance(address(SWAP_ROUTER), usdcAmount);
        
        // Prepare swap parameters
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: USDC,
            tokenOut: WETH,
            fee: POOL_FEE,
            recipient: address(this), // Receive WETH here, then unwrap
            deadline: deadline,
            amountIn: usdcAmount,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });
        
        // Execute swap
        try SWAP_ROUTER.exactInputSingle(params) returns (uint256 wethAmount) {
            // Unwrap WETH to ETH
            IWETH(WETH).withdraw(wethAmount);
            
            // Transfer ETH to user
            payable(msg.sender).transfer(wethAmount);
            
            ethAmount = wethAmount;
            emit USDCToETH(msg.sender, usdcAmount, ethAmount);
        } catch Error(string memory reason) {
            // Refund USDC on failure
            IERC20(USDC).safeTransfer(msg.sender, usdcAmount);
            emit SwapFailed(msg.sender, reason);
            revert(reason);
        } catch {
            // Refund USDC on failure
            IERC20(USDC).safeTransfer(msg.sender, usdcAmount);
            emit SwapFailed(msg.sender, "Unknown error");
            revert("UniswapSwap: swap failed");
        }
    }
    
    /**
     * @notice Get quote for ETH to USDC swap using Quoter V2
     * @param ethAmount Amount of ETH to swap
     * @return usdcAmount Estimated USDC amount
     */
    function getUSDCForETH(uint256 ethAmount) external returns (uint256 usdcAmount) {
        require(ethAmount > 0, "UniswapSwap: invalid amount");
        
        // Prepare quote parameters
        IQuoterV2.QuoteExactInputSingleParams memory params = IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: WETH,
            tokenOut: USDC,
            amountIn: ethAmount,
            fee: POOL_FEE,
            sqrtPriceLimitX96: 0
        });
        
        // Get quote
        try QUOTER_V2.quoteExactInputSingle(params) returns (
            uint256 amountOut,
            uint160,
            uint32,
            uint256
        ) {
            usdcAmount = amountOut;
        } catch {
            // If quote fails, return 0
            usdcAmount = 0;
        }
    }
    
    /**
     * @notice Get quote for USDC to ETH swap using Quoter V2
     * @param usdcAmount Amount of USDC to swap
     * @return ethAmount Estimated ETH amount
     */
    function getETHForUSDC(uint256 usdcAmount) external returns (uint256 ethAmount) {
        require(usdcAmount > 0, "UniswapSwap: invalid amount");
        
        // Prepare quote parameters
        IQuoterV2.QuoteExactInputSingleParams memory params = IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: USDC,
            tokenOut: WETH,
            amountIn: usdcAmount,
            fee: POOL_FEE,
            sqrtPriceLimitX96: 0
        });
        
        // Get quote
        try QUOTER_V2.quoteExactInputSingle(params) returns (
            uint256 amountOut,
            uint160,
            uint32,
            uint256
        ) {
            ethAmount = amountOut;
        } catch {
            // If quote fails, return 0
            ethAmount = 0;
        }
    }
    
    /**
     * @notice Emergency withdraw USDC (only owner)
     */
    function emergencyWithdrawUSDC(uint256 amount) external onlyOwner {
        IERC20(USDC).safeTransfer(owner(), amount);
    }
    
    /**
     * @notice Emergency withdraw ETH (only owner)
     */
    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        payable(owner()).transfer(amount);
    }
    
    receive() external payable {}
}

// Minimal WETH interface for unwrapping
interface IWETH {
    function withdraw(uint256) external;
    function deposit() external payable;
}
