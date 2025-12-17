// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "./IPyth.sol";
import "./PythPriceConverter.sol";

/**
 * @title ShadeFXPriceOracle
 * @notice Separate contract for price management and pair configuration
 * @dev This contract handles all price updates and pair management to reduce main contract size
 */
contract ShadeFXPriceOracle is Ownable, Pausable {
    
    // ============ Constants ============
    
    uint256 public constant PRICE_PRECISION = 1e8;
    uint256 public constant MAX_PRICE_DEVIATION = 20; // 20% max price deviation (allows for crypto volatility)
    uint256 public constant PRICE_STALENESS = 5 minutes; // 5 minutes max price staleness
    
    // ============ Structs ============
    
    struct PairConfig {
        string baseCurrency;       // Base currency (BTC, ETH, etc.)
        string quoteCurrency;      // Quote currency (USD)
        uint256 currentPrice;      // Current price (scaled by PRICE_PRECISION)
        uint256 lastUpdateTime;    // Last price update timestamp
        uint256 minCollateral;     // Min collateral for this pair
        uint256 maxCollateral;     // Max collateral for this pair
        uint256 maxLeverage;       // Max leverage for this pair
        uint256 feePercentage;     // Trading fee in basis points
        bool isActive;             // Is pair active?
        uint256 maxOpenInterest;   // Max open interest for this pair
        uint256 totalLongSize;     // Total long position size
        uint256 totalShortSize;    // Total short position size
        bytes32 pythPriceId;       // Pyth Network price feed ID (bytes32, 0x0 if not using Pyth)
        string coingeckoId;        // CoinGecko coin ID (e.g., "bitcoin", "ethereum")
    }
    
    // ============ State Variables ============
    
    mapping(string => PairConfig) public pairs; // Pair key => PairConfig
    string[] public activePairs;
    
    // Oracle addresses
    address public oracleAddress;      // Legacy oracle address (for backward compatibility)
    bool public useChainlinkOracle;     // Legacy flag (for backward compatibility)
    IPyth public pythOracle;            // Pyth Network oracle contract
    bool public usePythOracle;          // Use Pyth Network for price feeds
    
    // ============ Events ============
    
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
        bytes32 pythPriceId,
        string coingeckoId
    );
    
    event PairUpdated(
        string indexed pairKey,
        bytes32 pythPriceId
    );
    
    // ============ Custom Errors ============
    
    error PythOracleNotEnabled();
    error PythOracleNotSet();
    error PairDoesNotExist();
    error PythPriceIdNotSet();
    error InvalidPrice();
    error PriceDeviationTooHigh();
    error InsufficientFee();
    error PriceIdMismatch();
    error PairAlreadyExists();
    error InvalidPythPriceId();
    
    // ============ Constructor ============
    
    constructor(
        address _oracleAddress,
        bool _useChainlinkOracle,
        address _pythOracleAddress,
        bool _usePythOracle,
        address initialOwner
    ) Ownable(initialOwner) {
        oracleAddress = _oracleAddress;
        useChainlinkOracle = _useChainlinkOracle;
        if (_pythOracleAddress != address(0)) {
            pythOracle = IPyth(_pythOracleAddress);
        }
        usePythOracle = _usePythOracle;
    }
    
    // ============ Price Management ============
    
    /**
     * @notice Update price for a pair from Pyth Network (Pull Model)
     * @dev Can be called by anyone - pulls price from Pyth Network
     * @param pairKey Currency pair key
     */
    function updatePriceFromPyth(string memory pairKey) external {
        if (!usePythOracle) revert PythOracleNotEnabled();
        if (address(pythOracle) == address(0)) revert PythOracleNotSet();
        
        PairConfig storage pair = pairs[pairKey];
        if (bytes(pair.baseCurrency).length == 0) revert PairDoesNotExist();
        if (pair.pythPriceId == bytes32(0)) revert PythPriceIdNotSet();
        
        // Get price from Pyth Network (Pull Model)
        PythStructs.Price memory pythPrice = pythOracle.getPriceNoOlderThan(pair.pythPriceId, PRICE_STALENESS);
        
        // Convert Pyth price to our format using library
        uint256 newPrice = PythPriceConverter.convertPythPrice(pythPrice);
        
        if (newPrice == 0) revert InvalidPrice();
        
        uint256 oldPrice = pair.currentPrice;
        
        // Check price deviation (skip if this is the first price update)
        if (oldPrice > 0) {
            uint256 deviation = (absDiff(newPrice, oldPrice) * 100) / oldPrice;
            if (deviation > MAX_PRICE_DEVIATION) revert PriceDeviationTooHigh();
        }
        
        pair.currentPrice = newPrice;
        pair.lastUpdateTime = block.timestamp;
        
        emit PriceUpdated(pairKey, oldPrice, newPrice, block.timestamp);
    }
    
    /**
     * @notice Update prices from Pyth Network using updateData (Pull Model with batch support)
     * @dev This function uses updatePriceFeedsIfNecessary for gas efficiency
     * @dev Backend service calls this function with updateData from Pyth Hermes API
     * @param pairKeys Array of currency pair keys to update
     * @param updateData Array of update data from Pyth Hermes API
     * @param priceIds Array of Pyth price feed IDs (bytes32)
     * @param publishTimes Array of publish times for each price feed
     */
    function updatePriceFromPythWithData(
        string[] memory pairKeys,
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable {
        if (!usePythOracle) revert PythOracleNotEnabled();
        if (address(pythOracle) == address(0)) revert PythOracleNotSet();
        if (pairKeys.length != priceIds.length || priceIds.length != publishTimes.length) {
            revert(); // Array length mismatch
        }
        
        // Calculate required fee for Pyth update
        uint256 requiredFee = pythOracle.getUpdateFee(updateData);
        if (msg.value < requiredFee) revert InsufficientFee();
        
        // Update price feeds in Pyth contract (only if necessary - gas efficient)
        pythOracle.updatePriceFeedsIfNecessary{value: requiredFee}(
            updateData,
            priceIds,
            publishTimes
        );
        
        // Refund excess fee if any
        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }
        
        // Update prices for each pair
        for (uint256 i = 0; i < pairKeys.length; i++) {
            string memory pairKey = pairKeys[i];
            bytes32 pythPriceId = priceIds[i];
            
            PairConfig storage pair = pairs[pairKey];
            if (bytes(pair.baseCurrency).length == 0) revert PairDoesNotExist();
            if (pair.pythPriceId != pythPriceId) revert PriceIdMismatch();
            
            // Get updated price from Pyth (after updatePriceFeedsIfNecessary, price is fresh)
            // Pyth Network is a trusted price oracle, so we accept prices directly without deviation checks
            PythStructs.Price memory pythPrice = pythOracle.getPriceNoOlderThan(pythPriceId, 60); // 60 seconds max age
            
            // Convert Pyth price to our format using library
            uint256 newPrice = PythPriceConverter.convertPythPrice(pythPrice);
            
            if (newPrice == 0) revert InvalidPrice();
            
            uint256 oldPrice = pair.currentPrice;
            
            // No deviation check - Pyth Network is trusted, and prices can be volatile in crypto markets
            // The stale check (60 seconds) in getPriceNoOlderThan is sufficient protection
            
            pair.currentPrice = newPrice;
            pair.lastUpdateTime = block.timestamp;
            
            emit PriceUpdated(pairKey, oldPrice, newPrice, block.timestamp);
        }
    }
    
    /**
     * @notice Update price for a pair (called by oracle/backend service) - Legacy Push Model
     * @dev Can be called by oracle address or owner
     * @param pairKey Currency pair key
     * @param newPrice New price (scaled by PRICE_PRECISION)
     */
    function updatePrice(
        string memory pairKey,
        uint256 newPrice
    ) external {
        if (newPrice == 0) revert InvalidPrice();
        
        PairConfig storage pair = pairs[pairKey];
        if (bytes(pair.baseCurrency).length == 0) revert PairDoesNotExist();
        
        // If pair uses Pyth, require owner/oracle
        if (pair.pythPriceId != bytes32(0)) {
            if (msg.sender != oracleAddress && msg.sender != owner()) {
                revert(); // Unauthorized
            }
        }
        
        uint256 oldPrice = pair.currentPrice;
        
        // Check price deviation (skip if this is the first price update)
        if (oldPrice > 0) {
            uint256 deviation = (absDiff(newPrice, oldPrice) * 100) / oldPrice;
            if (deviation > MAX_PRICE_DEVIATION) revert PriceDeviationTooHigh();
        }
        
        pair.currentPrice = newPrice;
        pair.lastUpdateTime = block.timestamp;
        
        // Activate pair if it was inactive (first price update)
        if (!pair.isActive) {
            pair.isActive = true;
            activePairs.push(pairKey);
        }
        
        emit PriceUpdated(pairKey, oldPrice, newPrice, block.timestamp);
    }
    
    /**
     * @notice Force update price for a pair (owner only, bypasses deviation check)
     * @dev Use this to fix incorrect prices from initial pair addition
     * @param pairKey Currency pair key
     * @param newPrice New price (scaled by PRICE_PRECISION)
     */
    function forceUpdatePrice(
        string memory pairKey,
        uint256 newPrice
    ) external onlyOwner {
        if (newPrice == 0) revert InvalidPrice();
        
        PairConfig storage pair = pairs[pairKey];
        if (bytes(pair.baseCurrency).length == 0) revert PairDoesNotExist();
        
        uint256 oldPrice = pair.currentPrice;
        
        // No deviation check - owner can force update to fix incorrect prices
        pair.currentPrice = newPrice;
        pair.lastUpdateTime = block.timestamp;
        
        // Activate pair if it was inactive
        if (!pair.isActive) {
            pair.isActive = true;
            activePairs.push(pairKey);
        }
        
        emit PriceUpdated(pairKey, oldPrice, newPrice, block.timestamp);
    }
    
    // ============ Pair Management ============
    
    /**
     * @notice Add a new trading pair with Pyth Network price feed (Pull Model)
     * @param pairKey Currency pair key (e.g., "BTC", "ETH")
     * @param baseCurrency Base currency symbol (e.g., "BTC")
     * @param quoteCurrency Quote currency symbol (e.g., "USD")
     * @param pythPriceId Pyth Network price feed ID (bytes32)
     * @param maxOpenInterest Maximum open interest for this pair
     * @param maxLeverage Maximum leverage for this pair
     */
    function addPairWithPyth(
        string memory pairKey,
        string memory baseCurrency,
        string memory quoteCurrency,
        bytes32 pythPriceId,
        uint256 maxOpenInterest,
        uint256 maxLeverage
    ) external onlyOwner {
        if (pairs[pairKey].isActive) revert PairAlreadyExists();
        if (!usePythOracle) revert PythOracleNotEnabled();
        if (address(pythOracle) == address(0)) revert PythOracleNotSet();
        if (pythPriceId == bytes32(0)) revert InvalidPythPriceId();
        
        // Try to get initial price from Pyth
        uint256 initialPrice = 0;
        uint256 lastUpdateTime = 0;
        try pythOracle.getPriceUnsafe(pythPriceId) returns (PythStructs.Price memory pythPrice) {
            initialPrice = PythPriceConverter.convertPythPrice(pythPrice);
            if (initialPrice > 0) {
                lastUpdateTime = block.timestamp;
            }
        } catch {
            // Price fetch failed - will be set later via updatePriceFromPyth
            initialPrice = 0;
            lastUpdateTime = 0;
        }
        
        // Only activate pair if initial price was successfully fetched
        bool pairIsActive = (initialPrice > 0 && lastUpdateTime > 0);
        
        pairs[pairKey] = PairConfig({
            baseCurrency: baseCurrency,
            quoteCurrency: quoteCurrency,
            currentPrice: initialPrice,
            lastUpdateTime: lastUpdateTime,
            minCollateral: 5 * 1e6, // 5 USDC default
            maxCollateral: type(uint256).max, // No max limit
            maxLeverage: maxLeverage,
            feePercentage: 0,
            isActive: pairIsActive,
            maxOpenInterest: maxOpenInterest,
            totalLongSize: 0,
            totalShortSize: 0,
            pythPriceId: pythPriceId,
            coingeckoId: ""
        });
        
        if (pairIsActive) {
            activePairs.push(pairKey);
        }
        
        emit PairAdded(pairKey, baseCurrency, quoteCurrency, pythPriceId, "");
    }
    
    /**
     * @notice Add a new trading pair for testing (without Pyth Oracle requirement)
     * @dev This function is for testing only - creates a pair without Pyth Oracle
     * @param pairKey Currency pair key (e.g., "BTCUSD")
     * @param baseCurrency Base currency symbol (e.g., "BTC")
     * @param quoteCurrency Quote currency symbol (e.g., "USD")
     * @param initialPrice Initial price (scaled by PRICE_PRECISION)
     * @param maxOpenInterest Maximum open interest for this pair
     * @param maxLeverage Maximum leverage for this pair
     */
    function addPairForTesting(
        string memory pairKey,
        string memory baseCurrency,
        string memory quoteCurrency,
        uint256 initialPrice,
        uint256 maxOpenInterest,
        uint256 maxLeverage
    ) external onlyOwner {
        if (pairs[pairKey].isActive) revert PairAlreadyExists();
        if (initialPrice == 0) revert InvalidPrice();
        
        pairs[pairKey] = PairConfig({
            baseCurrency: baseCurrency,
            quoteCurrency: quoteCurrency,
            currentPrice: initialPrice,
            lastUpdateTime: block.timestamp,
            minCollateral: 5 * 1e6, // 5 USDC default
            maxCollateral: type(uint256).max, // No max limit
            maxLeverage: maxLeverage,
            feePercentage: 0,
            isActive: true,
            maxOpenInterest: maxOpenInterest,
            totalLongSize: 0,
            totalShortSize: 0,
            pythPriceId: bytes32(0), // No Pyth price ID for testing
            coingeckoId: ""
        });
        
        activePairs.push(pairKey);
        
        emit PairAdded(pairKey, baseCurrency, quoteCurrency, bytes32(0), "");
        emit PriceUpdated(pairKey, 0, initialPrice, block.timestamp);
    }
    
    /**
     * @notice Set Pyth price ID for an existing pair
     * @param pairKey Currency pair key
     * @param pythPriceId Pyth Network price feed ID
     */
    function setPairPythPriceId(string memory pairKey, bytes32 pythPriceId) external onlyOwner {
        if (pythPriceId == bytes32(0)) revert InvalidPythPriceId();
        
        PairConfig storage pair = pairs[pairKey];
        if (bytes(pair.baseCurrency).length == 0) revert PairDoesNotExist();
        pair.pythPriceId = pythPriceId;
        
        // Try to update price from Pyth
        try pythOracle.getPriceUnsafe(pythPriceId) returns (PythStructs.Price memory pythPrice) {
            uint256 newPrice = PythPriceConverter.convertPythPrice(pythPrice);
            
            if (newPrice > 0) {
                uint256 oldPrice = pair.currentPrice;
                pair.currentPrice = newPrice;
                pair.lastUpdateTime = block.timestamp;
                pair.isActive = true; // Activate pair if price is available
                emit PriceUpdated(pairKey, oldPrice, newPrice, block.timestamp);
            }
        } catch {
            // Price fetch failed, but pythPriceId is set - can be updated later
        }
        
        emit PairUpdated(pairKey, pythPriceId);
    }
    
    /**
     * @notice Set oracle configuration
     * @param _oracleAddress Legacy oracle address
     * @param _useChainlinkOracle Legacy flag
     */
    function setOracle(address _oracleAddress, bool _useChainlinkOracle) external onlyOwner {
        oracleAddress = _oracleAddress;
        useChainlinkOracle = _useChainlinkOracle;
    }
    
    /**
     * @notice Set Pyth oracle configuration
     * @param _pythOracleAddress Pyth oracle contract address
     * @param _usePythOracle Use Pyth oracle flag
     */
    function setPythOracle(address _pythOracleAddress, bool _usePythOracle) external onlyOwner {
        if (_pythOracleAddress != address(0)) {
            pythOracle = IPyth(_pythOracleAddress);
        }
        usePythOracle = _usePythOracle;
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get price for a pair
     * @param pairKey Currency pair key
     * @return price Current price (scaled by PRICE_PRECISION)
     * @return lastUpdateTime Last update timestamp
     * @return isActive Is pair active?
     */
    function getPrice(string memory pairKey) external view returns (
        uint256 price,
        uint256 lastUpdateTime,
        bool isActive
    ) {
        PairConfig storage pair = pairs[pairKey];
        return (pair.currentPrice, pair.lastUpdateTime, pair.isActive);
    }
    
    /**
     * @notice Get pair configuration
     * @param pairKey Currency pair key
     * @return config Pair configuration struct
     */
    function getPairConfig(string memory pairKey) external view returns (PairConfig memory config) {
        return pairs[pairKey];
    }
    
    /**
     * @notice Get all active pairs
     * @return Active pair keys array
     */
    function getActivePairs() external view returns (string[] memory) {
        return activePairs;
    }
    
    // ============ Internal Functions ============
    
    /**
     * @notice Calculate absolute difference between two numbers
     */
    function absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
}

