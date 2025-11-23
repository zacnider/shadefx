// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

// Import Pyth SDK structs
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol" as PythSDK;

/**
 * @title IPyth
 * @notice Pyth Network price feed interface wrapper
 * @dev Uses Pyth SDK interface directly for compatibility
 */
interface IPyth is PythSDK.IPyth {
    // Interface is inherited from Pyth SDK
    // We use getPriceUnsafe or getPriceNoOlderThan for price retrieval
}

