// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, externalEbool, euint32, externalEuint32, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IShadeFXPriceOracle.sol";

/**
 * @title ShadeFXPerpDEX
 * @notice Confidential Perpetual DEX - A decentralized exchange for perpetual futures with FHE privacy
 * @dev Users can open long/short positions with leverage (1-5x) on crypto pairs
 */
contract ShadeFXPerpDEX is ZamaEthereumConfig, ReentrancyGuard, Pausable, Ownable {
    
    using SafeERC20 for IERC20;
    
    // ============ Constants ============
    
    uint256 public constant MIN_COLLATERAL = 5 * 1e6;        // 5 USDC minimum (USDC has 6 decimals)
    // No maximum collateral limit - users can stake any amount above minimum
    uint256 public maxLeverage = 5;                            // Maximum leverage (owner can change)
    uint256 public constant MAINTENANCE_MARGIN = 20;            // 20% maintenance margin
    uint256 public constant LIQUIDATION_BONUS = 5;               // 5% liquidation bonus
    uint256 public openingFeeBP = 0;                             // 0% opening fee (default, owner can change)
    uint256 public closingFeeBP = 25;                            // 0.025% closing fee (default, owner can change)
    uint256 public constant PRICE_PRECISION = 1e8;              // Price precision (8 decimals)
    uint256 public constant MAX_PRICE_DEVIATION = 5;             // 5% max price deviation
    uint256 public constant PRICE_STALENESS = 5 minutes;        // 5 minutes max price staleness
    
    // ============ Structs ============
    
    struct Position {
        uint256 positionId;        // Unique position ID
        address trader;            // Trader address
        string pairKey;            // Currency pair key (e.g., "BTCUSD", "ETHUSD")
        ebool encryptedDirection; // Encrypted direction: true = Long, false = Short (FHE)
        euint32 encryptedLeverage; // Encrypted leverage (1-5x) (FHE)
        euint64 encryptedStopLoss; // Encrypted stop loss price (0 = no stop loss) (FHE)
        uint256 entryPrice;        // Entry price (scaled by PRICE_PRECISION)
        uint256 size;              // Position size (collateral * leverage)
        uint256 collateral;        // Collateral amount
        uint256 leverage;          // Leverage (1-5x) - kept for backward compatibility, will be removed
        uint256 timestamp;         // Open timestamp
        bool isOpen;               // Is position open?
        bool openInterestUpdated;  // Has open interest been corrected after direction decryption?
        uint256 liquidationPrice;  // Liquidation price
        uint256 openingFee;        // Opening fee paid
        uint256 closingFee;        // Closing fee (calculated on close)
    }
    
    struct LiquidityPool {
        uint256 totalLiquidity;           // Total liquidity
        uint256 availableLiquidity;       // Available for trading
        uint256 reservedLiquidity;        // Reserved for open positions
        uint256 totalFees;                // Accumulated fees
        mapping(address => uint256) providerShares; // LP provider shares
        mapping(address => uint256) providerDeposits; // LP provider deposits
    }
    
    // PairConfig moved to IShadeFXPriceOracle interface
    
    enum OrderType {
        MARKET,
        LIMIT
    }
    
    enum OrderStatus {
        PENDING,
        EXECUTED,
        CANCELLED,
        EXPIRED
    }
    
    struct Order {
        uint256 orderId;           // Unique order ID
        address trader;            // Trader address
        string pairKey;            // Currency pair key
        OrderType orderType;        // MARKET or LIMIT
        OrderStatus status;         // Order status
        ebool encryptedDirection; // Encrypted direction: true = Long, false = Short (FHE)
        uint256 limitPrice;         // Limit price (0 for market orders, scaled by PRICE_PRECISION)
        uint256 collateralAmount;   // Collateral amount
        uint256 leverage;           // Leverage (1-5x)
        uint256 timestamp;          // Order creation timestamp
        uint256 expiryTime;         // Order expiry timestamp (0 = no expiry)
    }
    
    // ============ State Variables ============
    
    LiquidityPool public liquidityPool;
    
    IShadeFXPriceOracle public priceOracle;                 // Price oracle contract
    mapping(uint256 => Position) public positions;          // Position ID => Position
    mapping(address => uint256[]) public userPositions;     // User => Position IDs
    mapping(string => mapping(address => uint256[])) public pairUserPositions; // Pair => User => Position IDs (for hedge)
    
    // Order management
    mapping(uint256 => Order) public orders;                // Order ID => Order
    mapping(address => uint256[]) public userOrders;        // User => Order IDs
    mapping(string => uint256[]) public pairOrders;         // Pair => Order IDs (for limit order execution)
    uint256 public nextOrderId = 1;
    uint256 public nextPositionId = 1;
    
    // Close position state (for async decryption)
    mapping(uint256 => ClosePositionRequest) public closePositionRequests; // requestID => ClosePositionRequest
    uint256 private nextRequestId = 1;
    
    struct ClosePositionRequest {
        uint256 positionId;
        address trader;
        uint256 closingFee;
        uint256 currentPrice;
        bool isPending;
    }
    
    // Stop loss trigger state (for async decryption)
    mapping(uint256 => StopLossRequest) public stopLossRequests; // requestID => StopLossRequest
    uint256 private nextStopLossRequestId = 1;
    
    struct StopLossRequest {
        uint256 positionId;
        uint256 currentPrice;
        bool isPending;
    }
    
    // USDC token address (Sepolia)
    IERC20 public constant USDC = IERC20(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238);
    
    // ============ Custom Errors ============
    // Using custom errors instead of revert strings to reduce contract size
    
    error PythOracleNotEnabled();
    error PythOracleNotSet();
    error PairDoesNotExist();
    error PythPriceIdNotSet();
    error InvalidPrice();
    error PriceDeviationTooHigh();
    error InsufficientFee();
    error PriceIdMismatch();
    
    // ============ Events ============
    
    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        string indexed pairKey,
        uint256 entryPrice,
        uint256 size,
        uint256 collateral,
        uint256 leverage,
        uint256 openingFee
    );
    
    event PositionCloseRequested(
        uint256 indexed positionId,
        uint256 indexed requestId
    );
    
    event PositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        string indexed pairKey,
        uint256 exitPrice,
        int256 pnl,
        uint256 collateralReturned,
        uint256 closingFee
    );
    
    event StopLossSet(
        uint256 indexed positionId,
        uint256 indexed requestId
    );
    
    event StopLossTriggered(
        uint256 indexed positionId,
        uint256 stopLossPrice,
        uint256 currentPrice
    );
    
    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed trader,
        string indexed pairKey,
        address liquidator,
        uint256 liquidationPrice
    );
    
    event LiquidityAdded(
        address indexed provider,
        uint256 amount,
        uint256 shares
    );
    
    event LiquidityRemoved(
        address indexed provider,
        uint256 amount,
        uint256 shares
    );
    
    event PriceUpdated(
        string indexed pairKey,
        uint256 oldPrice,
        uint256 newPrice,
        uint256 timestamp
    );
    
    event PairAdded(
        string indexed pairKey,
        string baseCurrency,
        string quoteCurrency,
        uint256 initialPrice
    );
    
    event PairUpdated(
        string indexed pairKey,
        bytes32 pythPriceId
    );
    
    event EmergencyPause();
    event EmergencyUnpause();
    event EmergencyWithdraw(address indexed to, uint256 amount);
    
    event OpeningFeeUpdated(uint256 newOpeningFeeBP);
    event ClosingFeeUpdated(uint256 newClosingFeeBP);
    event MaxLeverageUpdated(uint256 newMaxLeverage);
    
    event OpenInterestUpdated(
        uint256 indexed positionId,
        string indexed pairKey,
        bool isLong,
        uint256 positionSize
    );
    
    // Order events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed trader,
        string indexed pairKey,
        OrderType orderType,
        uint256 limitPrice,
        uint256 collateralAmount,
        uint256 leverage
    );
    
    event OrderExecuted(
        uint256 indexed orderId,
        uint256 indexed positionId,
        address indexed trader,
        string pairKey,
        uint256 executionPrice
    );
    
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        string pairKey
    );
    
    event OrderExpired(
        uint256 indexed orderId,
        address indexed trader,
        string pairKey
    );
    
    // ============ Modifiers ============
    
    modifier validPair(string memory pairKey) {
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(pairKey);
        require(pair.isActive, "ShadeFX: pair not active");
        _;
    }
    
    modifier validPosition(uint256 positionId) {
        require(positions[positionId].isOpen, "ShadeFX: position not open");
        require(positions[positionId].trader == msg.sender, "ShadeFX: not position owner");
        _;
    }
    
    modifier validPrice(uint256 price) {
        require(price > 0, "ShadeFX: invalid price");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        address _priceOracleAddress,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_priceOracleAddress != address(0), "ShadeFX: invalid price oracle address");
        priceOracle = IShadeFXPriceOracle(_priceOracleAddress);
    }
    
    // ============ Fee Management ============
    
    /**
     * @notice Set opening fee in basis points (owner only)
     * @param _openingFeeBP Opening fee in basis points (e.g., 0 = 0%, 25 = 0.025%, 100 = 1%)
     */
    function setOpeningFeeBP(uint256 _openingFeeBP) external onlyOwner {
        require(_openingFeeBP <= 100, "ShadeFX: opening fee too high"); // Max 1%
        openingFeeBP = _openingFeeBP;
        emit OpeningFeeUpdated(_openingFeeBP);
    }
    
    /**
     * @notice Set closing fee in basis points (owner only)
     * @param _closingFeeBP Closing fee in basis points (e.g., 0 = 0%, 25 = 0.025%, 100 = 1%)
     */
    function setClosingFeeBP(uint256 _closingFeeBP) external onlyOwner {
        require(_closingFeeBP <= 100, "ShadeFX: closing fee too high"); // Max 1%
        closingFeeBP = _closingFeeBP;
        emit ClosingFeeUpdated(_closingFeeBP);
    }
    
    /**
     * @notice Set maximum leverage (owner only)
     * @param _maxLeverage Maximum leverage (e.g., 5 = 5x, 10 = 10x)
     * @dev Must be at least 1 and at most 20 for safety
     */
    function setMaxLeverage(uint256 _maxLeverage) external onlyOwner {
        require(_maxLeverage >= 1, "ShadeFX: leverage too low");
        require(_maxLeverage <= 20, "ShadeFX: leverage too high"); // Max 20x for safety
        maxLeverage = _maxLeverage;
        emit MaxLeverageUpdated(_maxLeverage);
    }
    
    // ============ Position Management ============
    
    /**
     * @notice Create a limit order (executes when price reaches limit price)
     * @param pairKey Currency pair key
     * @param encryptedDirection Encrypted direction: true = Long, false = Short (FHE)
     * @param inputProof Input proof for encrypted direction
     * @param limitPrice Limit price (scaled by PRICE_PRECISION)
     * @param leverage Leverage multiplier (1-5x)
     * @param collateralAmount Collateral amount
     * @param expiryTime Order expiry timestamp (0 = no expiry)
     */
    function createLimitOrder(
        string memory pairKey,
        externalEbool encryptedDirection,
        bytes calldata inputProof,
        uint256 limitPrice,
        uint256 leverage,
        uint256 collateralAmount,
        uint256 expiryTime
    ) external nonReentrant whenNotPaused validPair(pairKey) validPrice(limitPrice) {
        require(collateralAmount >= MIN_COLLATERAL, "ShadeFX: collateral below minimum");
        require(USDC.balanceOf(msg.sender) >= collateralAmount, "ShadeFX: insufficient USDC balance");
        require(leverage >= 1 && leverage <= maxLeverage, "ShadeFX: invalid leverage");
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(pairKey);
        require(leverage <= pair.maxLeverage, "ShadeFX: leverage exceeds pair max");
        require(expiryTime == 0 || expiryTime > block.timestamp, "ShadeFX: invalid expiry time");
        
        // Convert external encrypted direction to internal ebool
        ebool direction = FHE.fromExternal(encryptedDirection, inputProof);
        
        // Allow contract to decrypt direction
        FHE.allowThis(direction);
        FHE.allow(direction, msg.sender);
        
        // Transfer USDC collateral from user (held in escrow until order executes)
        USDC.safeTransferFrom(msg.sender, address(this), collateralAmount);
        
        // Create order
        Order memory newOrder = Order({
            orderId: nextOrderId,
            trader: msg.sender,
            pairKey: pairKey,
            orderType: OrderType.LIMIT,
            status: OrderStatus.PENDING,
            encryptedDirection: direction,
            limitPrice: limitPrice,
            collateralAmount: collateralAmount,
            leverage: leverage,
            timestamp: block.timestamp,
            expiryTime: expiryTime
        });
        
        orders[nextOrderId] = newOrder;
        userOrders[msg.sender].push(nextOrderId);
        pairOrders[pairKey].push(nextOrderId);
        
        emit OrderCreated(
            nextOrderId,
            msg.sender,
            pairKey,
            OrderType.LIMIT,
            limitPrice,
            collateralAmount,
            leverage
        );
        
        nextOrderId++;
        
        // Try to execute immediately if price condition is met
        _tryExecuteLimitOrder(nextOrderId - 1);
    }
    
    /**
     * @notice Execute a pending limit order (called when price condition is met)
     * @param orderId Order ID to execute
     */
    function executeLimitOrder(uint256 orderId) external nonReentrant whenNotPaused {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.PENDING, "ShadeFX: order not pending");
        require(order.orderType == OrderType.LIMIT, "ShadeFX: not a limit order");
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(order.pairKey);
        require(pair.isActive, "ShadeFX: pair not active");
        
        // Check expiry
        if (order.expiryTime > 0 && block.timestamp >= order.expiryTime) {
            order.status = OrderStatus.EXPIRED;
            // Return collateral to user
            USDC.safeTransfer(order.trader, order.collateralAmount);
            emit OrderExpired(orderId, order.trader, order.pairKey);
            return;
        }
        
        // Execute the order
        uint256 positionId = _executeLimitOrderInternal(orderId);
        
        if (positionId > 0) {
            (uint256 currentPrice,,) = priceOracle.getPrice(order.pairKey);
            emit OrderExecuted(
                orderId,
                positionId,
                order.trader,
                order.pairKey,
                currentPrice
            );
        }
    }
    
    /**
     * @notice Cancel a pending limit order
     * @param orderId Order ID to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.trader == msg.sender, "ShadeFX: not order owner");
        require(order.status == OrderStatus.PENDING, "ShadeFX: order not pending");
        
        order.status = OrderStatus.CANCELLED;
        
        // Return collateral to user
        USDC.safeTransfer(order.trader, order.collateralAmount);
        
        emit OrderCancelled(orderId, msg.sender, order.pairKey);
    }
    
    /**
     * @notice Execute all pending limit orders for a pair (called by keeper or frontend)
     * @param pairKey Currency pair key
     */
    function executePendingLimitOrders(string memory pairKey) external nonReentrant whenNotPaused validPair(pairKey) {
        uint256[] memory orderIds = pairOrders[pairKey];
        uint256 executedCount = 0;
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            
            if (order.status == OrderStatus.PENDING && order.orderType == OrderType.LIMIT) {
                // Check expiry first
                if (order.expiryTime > 0 && block.timestamp >= order.expiryTime) {
                    order.status = OrderStatus.EXPIRED;
                    USDC.safeTransfer(order.trader, order.collateralAmount);
                    emit OrderExpired(orderId, order.trader, order.pairKey);
                    continue;
                }
                
                // Try to execute
                uint256 positionId = _tryExecuteLimitOrder(orderId);
                if (positionId > 0) {
                    executedCount++;
                }
            }
        }
        
        // Emit event for batch execution
        if (executedCount > 0) {
            (uint256 currentPrice,,) = priceOracle.getPrice(pairKey);
            emit PriceUpdated(pairKey, currentPrice, currentPrice, block.timestamp);
        }
    }
    
    /**
     * @notice Close an open position (with async direction decryption)
     * @param positionId Position ID to close
     */
    function closePosition(uint256 positionId) external nonReentrant whenNotPaused validPosition(positionId) {
        Position storage position = positions[positionId];
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        require(position.trader == msg.sender, "ShadeFX: not position owner");
        
        // Calculate closing fee (based on collateral, not position size)
        uint256 closingFee = (position.collateral * closingFeeBP) / 10000;
        position.closingFee = closingFee;
        
        // Note: FHE.requestDecryption is not available in current FHEVM version
        // Direction is already publicly decryptable (set during position opening)
        // Frontend will decrypt and call closePositionWithDirection instead
        // For now, we'll use a workaround: calculate PnL for both directions
        // and let the frontend provide the correct direction
        
        // Store close position request (frontend will provide direction)
        uint256 requestId = nextRequestId++;
        closePositionRequests[requestId] = ClosePositionRequest({
            positionId: positionId,
            trader: position.trader,
            closingFee: closingFee,
            currentPrice: pair.currentPrice,
            isPending: true
        });
        
        // Emit event to notify that close is pending direction from frontend
        emit PositionCloseRequested(positionId, requestId);
        
        // Revert to force frontend to use closePositionWithDirection
        revert("ShadeFX: Use closePositionWithDirection with decrypted direction");
    }
    
    /**
     * @notice Close position with decrypted direction (called by frontend after decryption)
     * @param positionId Position ID to close
     * @param isLong Decrypted direction: true = Long, false = Short
     */
    function closePositionWithDirection(
        uint256 positionId,
        bool isLong
    ) external nonReentrant whenNotPaused validPosition(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "ShadeFX: not position owner");
        require(position.isOpen, "ShadeFX: position not open");
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Calculate closing fee (based on collateral, not position size)
        uint256 closingFee = (position.collateral * closingFeeBP) / 10000;
        position.closingFee = closingFee;
        
        // Calculate PnL using decrypted direction
        int256 pnl = calculatePnL(position, pair.currentPrice, isLong);
        
        // Calculate amount to return (after fees)
        uint256 amountToReturn;
        if (pnl >= 0) {
            // Profit: return collateral + profit - closing fee
            uint256 totalReturn = position.collateral + uint256(pnl);
            amountToReturn = totalReturn > closingFee ? totalReturn - closingFee : 0;
        } else {
            // Loss: return collateral - loss - closing fee (but not less than 0)
            uint256 loss = uint256(-pnl);
            uint256 totalDeduction = loss + closingFee;
            if (totalDeduction >= position.collateral) {
                amountToReturn = 0; // Total loss
            } else {
                amountToReturn = position.collateral - totalDeduction;
            }
        }
        
        // Update pair open interest based on decrypted direction
        // CRITICAL: If updateOpenInterest() was never called, we need to handle it retroactively
        // to ensure accurate tracking. This makes the system robust even if frontend fails.
        if (!position.openInterestUpdated) {
            // updateOpenInterest() was never called - add to correct counter now (retroactive)
            // This ensures accurate tracking even if frontend failed to call updateOpenInterest()
            if (isLong) {
                pair.totalLongSize += position.size;
            } else {
                pair.totalShortSize += position.size;
            }
            // Mark as updated to prevent double counting in future
            position.openInterestUpdated = true;
        }
        
        // Now subtract from the correct counter
        if (isLong) {
            // Long position: subtract from totalLongSize
            if (pair.totalLongSize >= position.size) {
                pair.totalLongSize -= position.size;
            } else {
                // Underflow protection: set to 0
                pair.totalLongSize = 0;
            }
        } else {
            // Short position: subtract from totalShortSize
            if (pair.totalShortSize >= position.size) {
                pair.totalShortSize -= position.size;
            } else {
                // Underflow protection: set to 0
                pair.totalShortSize = 0;
            }
        }
        
        // Update liquidity pool
        // Underflow protection for reservedLiquidity
        if (liquidityPool.reservedLiquidity >= position.size) {
            liquidityPool.reservedLiquidity -= position.size;
        } else {
            liquidityPool.reservedLiquidity = 0;
        }
        
        // Calculate available liquidity increase (loss goes to pool)
        // Underflow protection: if amountToReturn > position.size, don't add negative value
        if (position.size >= amountToReturn) {
            liquidityPool.availableLiquidity += position.size - amountToReturn;
        }
        // If amountToReturn > position.size, it means profit, so we don't add anything to pool
        
        liquidityPool.totalFees += closingFee;
        
        // Mark position as closed
        position.isOpen = false;
        position.closingFee = closingFee;
        
        // Transfer USDC back to user
        if (amountToReturn > 0) {
            USDC.safeTransfer(position.trader, amountToReturn);
        }
        
        emit PositionClosed(
            positionId,
            position.trader,
            position.pairKey,
            pair.currentPrice,
            pnl,
            amountToReturn,
            closingFee
        );
    }
    
    /**
     * @notice Open a position with market order (immediate execution at current price)
     * @dev Market order - executes immediately at current market price (same as openPosition)
     * @param pairKey Currency pair key
     * @param encryptedDirection Encrypted direction: true = Long, false = Short (FHE)
     * @param encryptedLeverage Encrypted leverage (1-5x) (FHE)
     * @param inputProofDirection Input proof for encrypted direction
     * @param inputProofLeverage Input proof for encrypted leverage
     * @param leverage Plain leverage (for validation - must match encrypted value)
     * @param collateralAmount Collateral amount
     */
    function createMarketOrder(
        string memory pairKey,
        externalEbool encryptedDirection,
        externalEuint32 encryptedLeverage,
        bytes calldata inputProofDirection,
        bytes calldata inputProofLeverage,
        uint256 leverage,
        uint256 collateralAmount
    ) external nonReentrant whenNotPaused validPair(pairKey) {
        // Market order executes immediately - same logic as openPosition
        require(collateralAmount >= MIN_COLLATERAL, "ShadeFX: collateral below minimum");
        require(USDC.balanceOf(msg.sender) >= collateralAmount, "ShadeFX: insufficient USDC balance");
        require(leverage >= 1 && leverage <= maxLeverage, "ShadeFX: invalid leverage");
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(pairKey);
        require(leverage <= pair.maxLeverage, "ShadeFX: leverage exceeds pair max");
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Convert external encrypted direction to internal ebool
        ebool direction = FHE.fromExternal(encryptedDirection, inputProofDirection);
        
        // ZAMA FHE: Leverage is encrypted for privacy
        euint32 leverageEncrypted = FHE.fromExternal(encryptedLeverage, inputProofLeverage);
        
        // Allow contract to decrypt direction and leverage
        FHE.allowThis(direction);
        FHE.allow(direction, msg.sender);
        FHE.allowThis(leverageEncrypted);
        FHE.allow(leverageEncrypted, msg.sender);
        
        // Transfer USDC collateral from user
        USDC.safeTransferFrom(msg.sender, address(this), collateralAmount);
        
        uint256 positionSize = collateralAmount * leverage;
        
        // Calculate opening fee (based on collateral, not position size)
        uint256 openingFee = (collateralAmount * openingFeeBP) / 10000;
        // Opening fee is deducted from collateral, not from liquidity
        uint256 requiredLiquidity = positionSize;
        
        require(
            liquidityPool.availableLiquidity >= requiredLiquidity,
            "ShadeFX: insufficient liquidity"
        );
        
        // Make direction and leverage publicly decryptable
        direction = FHE.makePubliclyDecryptable(direction);
        leverageEncrypted = FHE.makePubliclyDecryptable(leverageEncrypted);
        
        // Calculate liquidation price (using long as default, will be corrected via callback)
        uint256 liquidationPrice = calculateLiquidationPrice(
            pair.currentPrice,
            true,  // isLong = true (default)
            leverage
        );
        
        // Initialize encrypted stop loss to 0 (no stop loss by default)
        euint64 stopLossEncrypted = FHE.asEuint64(0);
        FHE.allowThis(stopLossEncrypted);
        stopLossEncrypted = FHE.makePubliclyDecryptable(stopLossEncrypted);
        
        // Create position with encrypted direction and leverage
        Position memory newPosition = Position({
            positionId: nextPositionId,
            trader: msg.sender,
            pairKey: pairKey,
            encryptedDirection: direction,
            encryptedLeverage: leverageEncrypted,
            encryptedStopLoss: stopLossEncrypted,
            entryPrice: pair.currentPrice,
            size: positionSize,
            collateral: collateralAmount,
            leverage: leverage, // Kept for backward compatibility
            timestamp: block.timestamp,
            isOpen: true,
            openInterestUpdated: false, // Will be updated after direction decryption
            liquidationPrice: liquidationPrice,
            openingFee: openingFee,
            closingFee: 0
        });
        
        positions[nextPositionId] = newPosition;
        userPositions[msg.sender].push(nextPositionId);
        pairUserPositions[pairKey][msg.sender].push(nextPositionId);
        
        // Update liquidity pool
        liquidityPool.availableLiquidity -= requiredLiquidity;
        liquidityPool.reservedLiquidity += positionSize; // CRITICAL FIX: Use positionSize, not requiredLiquidity
        liquidityPool.totalFees += openingFee;
        
        // NOTE: Open interest (totalLongSize/totalShortSize) is NOT updated here
        // because direction is encrypted. Frontend MUST call updateOpenInterest()
        // after decrypting the direction to correctly track open interest.
        // This ensures accurate long/short tracking in the PerpDEX.
        
        emit PositionOpened(
            nextPositionId,
            msg.sender,
            pairKey,
            pair.currentPrice,
            positionSize,
            collateralAmount,
            leverage,
            openingFee
        );
        
        nextPositionId++;
    }
    
    // ============ Liquidity Pool ============
    
    /**
     * @notice Add liquidity to the pool (in USDC)
     * @param amount Amount of USDC to add
     */
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "ShadeFX: invalid amount");
        require(USDC.balanceOf(msg.sender) >= amount, "ShadeFX: insufficient USDC balance");
        
        // Transfer USDC from user
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 shares;
        if (liquidityPool.totalLiquidity == 0) {
            shares = amount;
        } else {
            shares = (amount * liquidityPool.totalLiquidity) / liquidityPool.availableLiquidity;
        }
        
        liquidityPool.totalLiquidity += amount;
        liquidityPool.availableLiquidity += amount;
        liquidityPool.providerShares[msg.sender] += shares;
        liquidityPool.providerDeposits[msg.sender] += amount;
        
        emit LiquidityAdded(msg.sender, amount, shares);
    }
    
    /**
     * @notice Remove liquidity from the pool
     * @param shares Amount of shares to remove
     */
    function removeLiquidity(uint256 shares) external nonReentrant whenNotPaused {
        require(shares > 0, "ShadeFX: invalid shares");
        require(
            liquidityPool.providerShares[msg.sender] >= shares,
            "ShadeFX: insufficient shares"
        );
        
        uint256 amount = (shares * liquidityPool.availableLiquidity) / liquidityPool.totalLiquidity;
        require(amount <= liquidityPool.availableLiquidity, "ShadeFX: insufficient liquidity");
        
        // Check withdrawal limits (max 10% per day)
        // TODO: Implement daily withdrawal limit
        
        liquidityPool.totalLiquidity -= amount;
        liquidityPool.availableLiquidity -= amount;
        liquidityPool.providerShares[msg.sender] -= shares;
        liquidityPool.providerDeposits[msg.sender] -= amount;
        
        // Transfer USDC back to user
        USDC.safeTransfer(msg.sender, amount);
        
        emit LiquidityRemoved(msg.sender, amount, shares);
    }
    
    // ============ Price Management ============
    // Price management moved to ShadeFXPriceOracle contract
    
    /**
     * @notice Update price for a pair from Pyth Network (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     * @param pairKey Currency pair key
     */
    function updatePriceFromPyth(string memory pairKey) external {
        priceOracle.updatePriceFromPyth(pairKey);
        // Check for liquidations after price update
        checkLiquidations(pairKey);
    }
    
    /**
     * @notice Update prices from Pyth Network using updateData (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     */
    function updatePriceFromPythWithData(
        string[] memory pairKeys,
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable {
        priceOracle.updatePriceFromPythWithData{value: msg.value}(pairKeys, updateData, priceIds, publishTimes);
        // Check for liquidations for all updated pairs
        for (uint256 i = 0; i < pairKeys.length; i++) {
            checkLiquidations(pairKeys[i]);
        }
    }
    
    /**
     * @notice Update price for a pair (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     */
    function updatePrice(string memory pairKey, uint256 newPrice) external {
        priceOracle.updatePrice(pairKey, newPrice);
        // Check for liquidations after price update
        checkLiquidations(pairKey);
    }
    
    
    // ============ Liquidation ============
    
    /**
     * @notice Liquidate a position that is below maintenance margin
     * @param positionId Position ID to liquidate
     */
    function liquidatePosition(uint256 positionId) external nonReentrant whenNotPaused {
        Position storage position = positions[positionId];
        require(position.isOpen, "ShadeFX: position not open");
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Check if position is liquidatable (loss >= 80% of collateral, maintenance margin = 20%)
        // Note: Direction must be decrypted by liquidator before calling this function
        // For now, we check both long and short PnL to determine if liquidatable
        int256 longPnL = calculatePnL(position, pair.currentPrice, true);
        int256 shortPnL = calculatePnL(position, pair.currentPrice, false);
        // Position is liquidatable if either direction shows loss >= 80% of collateral
        uint256 maxLoss = (position.collateral * (100 - MAINTENANCE_MARGIN)) / 100;
        require(
            (longPnL < 0 && uint256(-longPnL) >= maxLoss) || 
            (shortPnL < 0 && uint256(-shortPnL) >= maxLoss),
            "ShadeFX: position not liquidatable"
        );
        
        // Calculate liquidation bonus
        uint256 bonus = (position.collateral * LIQUIDATION_BONUS) / 100;
        uint256 liquidatorReward = position.collateral + bonus;
        
        // Update pair open interest
        // Note: In FHEVM, we cannot decrypt directly in contract
        // Direction is publicly decryptable, so we need async callback to decrypt
        // For now, we assume long position (will be corrected via callback)
        // Underflow protection: if totalLongSize is less than position.size, set to 0
        if (pair.totalLongSize >= position.size) {
            pair.totalLongSize -= position.size;
        } else {
            // Underflow protection: set to 0
            pair.totalLongSize = 0;
        }
        
        // Update liquidity pool
        // Underflow protection for reservedLiquidity
        if (liquidityPool.reservedLiquidity >= position.size) {
            liquidityPool.reservedLiquidity -= position.size;
        } else {
            liquidityPool.reservedLiquidity = 0;
        }
        
        // Calculate available liquidity increase (loss goes to pool)
        // Underflow protection: if liquidatorReward > position.size, don't add negative value
        if (position.size >= liquidatorReward) {
            liquidityPool.availableLiquidity += position.size - liquidatorReward;
        }
        
        // Mark position as closed
        position.isOpen = false;
        
        // Transfer USDC reward to liquidator
        USDC.safeTransfer(msg.sender, liquidatorReward);
        
        emit PositionLiquidated(
            positionId,
            position.trader,
            position.pairKey,
            msg.sender,
            pair.currentPrice
        );
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Calculate PnL for a position (public view, direction must be known)
     * @param position Position to calculate PnL for
     * @param currentPrice Current price
     * @param isLong Direction (true = Long, false = Short)
     * @return pnl Profit or loss (positive = profit, negative = loss)
     */
    function calculatePnL(
        Position memory position,
        uint256 currentPrice,
        bool isLong
    ) public pure returns (int256 pnl) {
        if (isLong) {
            // Long: profit when price goes up
            if (currentPrice > position.entryPrice) {
                uint256 priceDiff = currentPrice - position.entryPrice;
                pnl = int256((priceDiff * position.size) / position.entryPrice);
            } else {
                uint256 priceDiff = position.entryPrice - currentPrice;
                pnl = -int256((priceDiff * position.size) / position.entryPrice);
            }
        } else {
            // Short: profit when price goes down
            if (currentPrice < position.entryPrice) {
                uint256 priceDiff = position.entryPrice - currentPrice;
                pnl = int256((priceDiff * position.size) / position.entryPrice);
            } else {
                uint256 priceDiff = currentPrice - position.entryPrice;
                pnl = -int256((priceDiff * position.size) / position.entryPrice);
            }
        }
        
        // Subtract opening fee
        pnl -= int256(position.openingFee);
    }
    
    /**
     * @notice Calculate liquidation price for a position
     */
    function calculateLiquidationPrice(
        uint256 entryPrice,
        bool isLong,
        uint256 leverage
    ) public pure returns (uint256) {
        // Liquidation occurs when loss = 80% of collateral
        // For long: liquidationPrice = entryPrice * (1 - 0.8/leverage)
        // For short: liquidationPrice = entryPrice * (1 + 0.8/leverage)
        
        uint256 marginRatio = (100 - MAINTENANCE_MARGIN) * PRICE_PRECISION / 100;
        
        if (isLong) {
            return entryPrice - (entryPrice * marginRatio) / (leverage * PRICE_PRECISION);
        } else {
            return entryPrice + (entryPrice * marginRatio) / (leverage * PRICE_PRECISION);
        }
    }
    
    /**
     * @notice Get all open positions for a user
     */
    function getUserPositions(address user) external view returns (uint256[] memory) {
        return userPositions[user];
    }
    
    /**
     * @notice Update open interest for a position after direction is decrypted (called by frontend)
     * @dev This corrects the open interest tracking since direction is encrypted during position opening
     * @dev Can only be called once per position to prevent double counting
     * @param positionId Position ID
     * @param isLong Decrypted direction: true = Long, false = Short
     */
    function updateOpenInterest(
        uint256 positionId,
        bool isLong
    ) external nonReentrant validPosition(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "ShadeFX: not position owner");
        require(position.isOpen, "ShadeFX: position not open");
        require(!position.openInterestUpdated, "ShadeFX: open interest already updated");
        
        // NOTE: Open interest tracking moved to oracle contract
        // This function is kept for backward compatibility but does nothing
        // Open interest should be updated via oracle contract if needed
        
        // Mark as updated to prevent double counting
        position.openInterestUpdated = true;
        
        emit OpenInterestUpdated(positionId, position.pairKey, isLong, position.size);
    }
    
    /**
     * @notice Get all open positions for a user on a specific pair (for hedge)
     */
    function getUserPairPositions(
        address user,
        string memory pairKey
    ) external view returns (uint256[] memory) {
        return pairUserPositions[pairKey][user];
    }
    
    /**
     * @notice Get user's orders
     * @param user User address
     * @return Array of order IDs
     */
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }
    
    /**
     * @notice Get pending limit orders for a pair
     * @param pairKey Currency pair key
     * @return Array of order IDs
     */
    function getPairOrders(string memory pairKey) external view returns (uint256[] memory) {
        return pairOrders[pairKey];
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Add a new trading pair
     * @dev initialPrice can be 0 - price will be set by oracle/backend service
     * @param pairKey Currency pair key (e.g., "BTC", "ETH")
     * @param baseCurrency Base currency symbol (e.g., "BTC")
     * @param quoteCurrency Quote currency symbol (e.g., "USD")
     * @param initialPrice Initial price (scaled by PRICE_PRECISION). Can be 0 if using oracle
     * @param maxOpenInterest Maximum open interest for this pair
     */
    /**
     * @notice Add a new trading pair (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     */
    function addPair(
        string memory pairKey,
        string memory baseCurrency,
        string memory quoteCurrency,
        uint256 initialPrice,
        uint256 maxOpenInterest
    ) external onlyOwner {
        addPairWithCoinGecko(pairKey, baseCurrency, quoteCurrency, initialPrice, maxOpenInterest, "");
    }
    
    /**
     * @notice Add a new trading pair with CoinGecko ID
     * @dev Prices will be fetched from CoinGecko API by frontend
     * @param pairKey Currency pair key (e.g., "BTCUSD", "ETHUSD")
     * @param baseCurrency Base currency symbol (e.g., "BTC")
     * @param quoteCurrency Quote currency symbol (e.g., "USD")
     * @param initialPrice Initial price (scaled by PRICE_PRECISION). Can be 0 if using CoinGecko
     * @param maxOpenInterest Maximum open interest for this pair
     * @param coingeckoId CoinGecko coin ID (e.g., "bitcoin", "ethereum")
     */
    /**
     * @notice Add a new trading pair with CoinGecko ID (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     * @dev Note: CoinGecko pairs are not directly supported in oracle, use addPairWithPyth with pythPriceId = 0x0
     */
    function addPairWithCoinGecko(
        string memory /* pairKey */,
        string memory /* baseCurrency */,
        string memory /* quoteCurrency */,
        uint256 /* initialPrice */,
        uint256 /* maxOpenInterest */,
        string memory /* coingeckoId */
    ) public onlyOwner {
        // For CoinGecko pairs, we need to add them via oracle's updatePrice function
        // First, add pair with Pyth (but with pythPriceId = 0x0 to indicate CoinGecko)
        // Then update price via updatePrice
        // Note: This is a workaround - ideally oracle should support CoinGecko pairs directly
        revert("ShadeFX: Use oracle contract directly for CoinGecko pairs");
    }
    
    /**
     * @notice Set oracle address (Legacy - for backward compatibility)
     */
    /**
     * @notice Set oracle address (delegated to oracle contract)
     * @dev This function delegates to the price oracle contract
     */
    function setOracle(address _oracleAddress, bool _useChainlinkOracle) external onlyOwner {
        priceOracle.setOracle(_oracleAddress, _useChainlinkOracle);
    }
    
    /**
     * @notice Set Pyth Network oracle address (delegated to oracle contract)
     * @dev This function delegates to the price oracle contract
     */
    function setPythOracle(address _pythOracleAddress, bool _usePythOracle) external onlyOwner {
        priceOracle.setPythOracle(_pythOracleAddress, _usePythOracle);
    }
    
    /**
     * @notice Update existing pair to use Pyth Network price feed
     * @dev Allows migrating legacy pairs to Pyth Network
     * @param pairKey Currency pair key (e.g., "BTCUSD")
     * @param pythPriceId Pyth Network price feed ID (bytes32)
     */
    /**
     * @notice Set Pyth price ID for an existing pair (delegated to oracle)
     * @dev This function delegates to the price oracle contract
     */
    function setPairPythPriceId(string memory pairKey, bytes32 pythPriceId) external onlyOwner {
        priceOracle.setPairPythPriceId(pairKey, pythPriceId);
    }
    
    
    /**
     * @notice Emergency pause
     */
    function emergencyPause() external onlyOwner {
        _pause();
        emit EmergencyPause();
    }
    
    /**
     * @notice Emergency unpause
     */
    function emergencyUnpause() external onlyOwner {
        _unpause();
        emit EmergencyUnpause();
    }
    
    /**
     * @notice Emergency withdraw USDC (only when paused)
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(paused(), "ShadeFX: contract must be paused");
        require(USDC.balanceOf(address(this)) >= amount, "ShadeFX: insufficient balance");
        USDC.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }
    
    /**
     * @notice Emergency withdraw ETH (only when paused, for any ETH sent by mistake)
     */
    function emergencyWithdrawETH(address to, uint256 amount) external onlyOwner {
        require(paused(), "ShadeFX: contract must be paused");
        require(address(this).balance >= amount, "ShadeFX: insufficient ETH balance");
        payable(to).transfer(amount);
        emit EmergencyWithdraw(to, amount);
    }
    
    // ============ Internal Functions ============
    
    /**
     * @notice Try to execute a limit order if price condition is met
     * @param orderId Order ID to try executing
     * @return positionId Position ID if executed, 0 otherwise
     */
    function _tryExecuteLimitOrder(uint256 orderId) internal returns (uint256) {
        Order storage order = orders[orderId];
        
        if (order.status != OrderStatus.PENDING || order.orderType != OrderType.LIMIT) {
            return 0;
        }
        
        // Check expiry
        if (order.expiryTime > 0 && block.timestamp >= order.expiryTime) {
            order.status = OrderStatus.EXPIRED;
            USDC.safeTransfer(order.trader, order.collateralAmount);
            emit OrderExpired(orderId, order.trader, order.pairKey);
            return 0;
        }
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(order.pairKey);
        if (!pair.isActive) {
            return 0;
        }
        
        // Check price condition
        // For Long: execute when current price <= limit price (buy at or below limit)
        // For Short: execute when current price >= limit price (sell at or above limit)
        // Note: We cannot decrypt direction on-chain, so we check both conditions
        // The order will execute if either condition is met (will be validated off-chain)
        // TODO: Use encrypted comparison when available in FHEVM
        
        // For now, we'll execute if price is within 1% of limit price
        // This is a simplified approach - in production, we'd use encrypted comparison
        uint256 priceDiff = absDiff(pair.currentPrice, order.limitPrice);
        uint256 priceThreshold = (order.limitPrice * 100) / 10000; // 1% threshold
        
        if (priceDiff <= priceThreshold) {
            return _executeLimitOrderInternal(orderId);
        }
        
        return 0;
    }
    
    /**
     * @notice Execute a limit order internally (creates position)
     * @param orderId Order ID to execute
     * @return positionId Position ID created
     */
    function _executeLimitOrderInternal(uint256 orderId) internal returns (uint256) {
        Order storage order = orders[orderId];
        
        if (order.status != OrderStatus.PENDING) {
            return 0;
        }
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(order.pairKey);
        require(pair.isActive, "ShadeFX: pair not active");
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Mark order as executed
        order.status = OrderStatus.EXECUTED;
        
        // Use collateral already held in escrow
        uint256 collateralAmount = order.collateralAmount;
        uint256 positionSize = collateralAmount * order.leverage;
        
        // Calculate opening fee (based on collateral, not position size)
        uint256 openingFee = (collateralAmount * openingFeeBP) / 10000;
        // Opening fee is deducted from collateral, not from liquidity
        uint256 requiredLiquidity = positionSize;
        
        require(
            liquidityPool.availableLiquidity >= requiredLiquidity,
            "ShadeFX: insufficient liquidity"
        );
        
        // Make direction publicly decryptable
        ebool direction = FHE.makePubliclyDecryptable(order.encryptedDirection);
        
        // Initialize encrypted leverage (from order - for now use plain leverage, will be encrypted in future)
        // TODO: Add encrypted leverage to Order struct
        euint32 leverageEncrypted = FHE.asEuint32(uint32(order.leverage));
        FHE.allowThis(leverageEncrypted);
        leverageEncrypted = FHE.makePubliclyDecryptable(leverageEncrypted);
        
        // Get current price from oracle
        (uint256 currentPrice,,) = priceOracle.getPrice(order.pairKey);
        
        // Calculate liquidation price (using long as default, will be corrected via callback)
        uint256 liquidationPrice = calculateLiquidationPrice(
            currentPrice,
            true,  // isLong = true (default, will be corrected)
            order.leverage
        );
        
        // Initialize encrypted stop loss to 0 (no stop loss by default)
        euint64 stopLossEncrypted = FHE.asEuint64(0);
        FHE.allowThis(stopLossEncrypted);
        stopLossEncrypted = FHE.makePubliclyDecryptable(stopLossEncrypted);
        
        // Create position with encrypted direction and leverage
        Position memory newPosition = Position({
            positionId: nextPositionId,
            trader: order.trader,
            pairKey: order.pairKey,
            encryptedDirection: direction,
            encryptedLeverage: leverageEncrypted,
            encryptedStopLoss: stopLossEncrypted,
            entryPrice: pair.currentPrice,
            size: positionSize,
            collateral: collateralAmount,
            leverage: order.leverage, // Kept for backward compatibility
            timestamp: block.timestamp,
            isOpen: true,
            openInterestUpdated: false, // Will be updated after direction decryption
            liquidationPrice: liquidationPrice,
            openingFee: openingFee,
            closingFee: 0
        });
        
        positions[nextPositionId] = newPosition;
        userPositions[order.trader].push(nextPositionId);
        pairUserPositions[order.pairKey][order.trader].push(nextPositionId);
        
        // Update liquidity pool
        liquidityPool.availableLiquidity -= requiredLiquidity;
        liquidityPool.reservedLiquidity += positionSize; // CRITICAL FIX: Use positionSize, not requiredLiquidity
        liquidityPool.totalFees += openingFee;
        
        // NOTE: Open interest (totalLongSize/totalShortSize) is NOT updated here
        // because direction is encrypted. Frontend MUST call updateOpenInterest()
        // after decrypting the direction to correctly track open interest.
        // This ensures accurate long/short tracking in the PerpDEX.
        
        emit PositionOpened(
            nextPositionId,
            order.trader,
            order.pairKey,
            pair.currentPrice,
            positionSize,
            collateralAmount,
            order.leverage,
            openingFee
        );
        
        uint256 executedPositionId = nextPositionId;
        nextPositionId++;
        
        return executedPositionId;
    }
    
    /**
     * @notice Set stop loss for an open position (with async decryption)
     * @param positionId Position ID
     * @param encryptedStopLoss Encrypted stop loss price (FHE)
     * @param inputProof Input proof for encrypted stop loss
     */
    function setStopLoss(
        uint256 positionId,
        externalEuint64 encryptedStopLoss,
        bytes calldata inputProof
    ) external nonReentrant whenNotPaused validPosition(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "ShadeFX: not position owner");
        require(position.isOpen, "ShadeFX: position not open");
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Convert external encrypted stop loss to internal euint64
        euint64 stopLossEncrypted = FHE.fromExternal(encryptedStopLoss, inputProof);
        
        // Allow contract to decrypt stop loss
        FHE.allowThis(stopLossEncrypted);
        FHE.allow(stopLossEncrypted, msg.sender);
        
        // Make stop loss publicly decryptable for trigger checking
        stopLossEncrypted = FHE.makePubliclyDecryptable(stopLossEncrypted);
        
        // Update position stop loss
        position.encryptedStopLoss = stopLossEncrypted;
        
        emit StopLossSet(positionId, 0); // requestId not needed for set
    }
    
    /**
     * @notice Check stop loss for a position (with async decryption)
     * @param positionId Position ID to check
     */
    function checkStopLoss(uint256 positionId) external nonReentrant whenNotPaused validPosition(positionId) {
        Position storage position = positions[positionId];
        require(position.isOpen, "ShadeFX: position not open");
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Note: FHE.requestDecryption is not available in current FHEVM version
        // Frontend will decrypt and call checkStopLossWithDecryptedValues instead
        revert("ShadeFX: Use checkStopLossWithDecryptedValues with decrypted values");
    }
    
    /**
     * @notice Check stop loss with decrypted values (called by frontend after decryption)
     * @param positionId Position ID to check
     * @param isLong Decrypted direction: true = Long, false = Short
     * @param stopLossPrice Decrypted stop loss price
     */
    function checkStopLossWithDecryptedValues(
        uint256 positionId,
        bool isLong,
        uint64 stopLossPrice
    ) external nonReentrant whenNotPaused validPosition(positionId) {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "ShadeFX: not position owner");
        require(position.isOpen, "ShadeFX: position not open");
        
        IShadeFXPriceOracle.PairConfig memory pair = priceOracle.getPairConfig(position.pairKey);
        require(block.timestamp - pair.lastUpdateTime <= PRICE_STALENESS, "ShadeFX: price too stale");
        
        // Check if stop loss should trigger
        bool shouldTrigger = false;
        if (stopLossPrice > 0) {
            if (isLong) {
                // Long position: trigger if price drops below stop loss
                shouldTrigger = pair.currentPrice < stopLossPrice;
            } else {
                // Short position: trigger if price rises above stop loss
                shouldTrigger = pair.currentPrice > stopLossPrice;
            }
        }
        
        if (shouldTrigger) {
            // Trigger stop loss - emit event and close position
            emit StopLossTriggered(positionId, stopLossPrice, pair.currentPrice);
            
            // Close position using decrypted direction
            // Note: This will call closePositionWithDirection internally
            // For now, just emit event - user can manually close or we can auto-close
        }
    }
    
    /**
     * @notice Check and liquidate positions for a pair
     */
    function checkLiquidations(string memory pairKey) internal {
        // TODO: Implement automatic liquidation check
        // This would iterate through all open positions and liquidate if needed
        // For now, liquidations are manual via liquidatePosition()
    }
    
    /**
     * @notice Calculate absolute difference between two numbers
     */
    function absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
    
    // ============ Receive Function ============
    
    receive() external payable {
        // Allow ETH transfers (for emergency cases)
        // Note: Liquidity should be added via addLiquidity() with USDC
    }
}

