// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

/**
 * @title IShadeFXPriceOracle
 * @notice Interface for ShadeFXPriceOracle contract
 */
interface IShadeFXPriceOracle {
    struct PairConfig {
        string baseCurrency;
        string quoteCurrency;
        uint256 currentPrice;
        uint256 lastUpdateTime;
        uint256 minCollateral;
        uint256 maxCollateral;
        uint256 maxLeverage;
        uint256 feePercentage;
        bool isActive;
        uint256 maxOpenInterest;
        uint256 totalLongSize;
        uint256 totalShortSize;
        bytes32 pythPriceId;
        string coingeckoId;
    }
    
    function getPrice(string memory pairKey) external view returns (
        uint256 price,
        uint256 lastUpdateTime,
        bool isActive
    );
    
    function getPairConfig(string memory pairKey) external view returns (PairConfig memory);
    
    function getActivePairs() external view returns (string[] memory);
    
    function updatePriceFromPyth(string memory pairKey) external;
    
    function updatePriceFromPythWithData(
        string[] memory pairKeys,
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64[] calldata publishTimes
    ) external payable;
    
    function updatePrice(string memory pairKey, uint256 newPrice) external;
    
    function addPairWithPyth(
        string memory pairKey,
        string memory baseCurrency,
        string memory quoteCurrency,
        bytes32 pythPriceId,
        uint256 maxOpenInterest,
        uint256 maxLeverage
    ) external;
    
    function setPairPythPriceId(string memory pairKey, bytes32 pythPriceId) external;
    
    function setOracle(address _oracleAddress, bool _useChainlinkOracle) external;
    
    function setPythOracle(address _pythOracleAddress, bool _usePythOracle) external;
}

