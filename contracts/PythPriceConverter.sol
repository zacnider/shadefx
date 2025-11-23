// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title PythPriceConverter
 * @notice Library for converting Pyth Network prices to contract format
 * @dev This library reduces contract size by extracting price conversion logic
 */
library PythPriceConverter {
    uint256 public constant PRICE_PRECISION = 1e8;
    
    /**
     * @notice Convert Pyth price to contract format (PRICE_PRECISION = 1e8)
     * @param pythPrice Pyth price struct
     * @return convertedPrice Price in contract format (scaled by PRICE_PRECISION)
     */
    function convertPythPrice(PythStructs.Price memory pythPrice) internal pure returns (uint256 convertedPrice) {
        // Convert Pyth price to our format
        // Pyth price format: price (int64) * 10^expo (int32)
        // Our format: price * 10^8 (PRICE_PRECISION)
        // 
        // Example: If Pyth gives price=848220000000, expo=-8
        // Real price = 848220000000 * 10^-8 = 8482.2 USD
        // We want: 8482.2 * 10^8 = 848220000000 (scaled by 1e8)
        //
        // Formula: 
        //   Real price = price * 10^expo
        //   Contract format = real_price * 10^8 = price * 10^expo * 10^8 = price * 10^(expo + 8)
        // 
        // If expo = -8: convertedPrice = price * 10^(-8 + 8) = price * 10^0 = price ✅
        
        int32 expo = pythPrice.expo;
        int256 price = pythPrice.price;
        
        require(price > 0, "PythPriceConverter: price must be positive");
        
        // Calculate the exponent difference
        // Real price = price * 10^expo
        // Contract format = real_price * 10^8 = price * 10^(expo + 8)
        int256 exponentDiff = int256(8) + int256(expo);
        
        if (exponentDiff > 0) {
            // Need to multiply
            uint256 multiplier = uint256(10 ** uint256(exponentDiff));
            convertedPrice = uint256(price) * multiplier;
        } else if (exponentDiff < 0) {
            // Need to divide
            uint256 divisor = uint256(10 ** uint256(-exponentDiff));
            convertedPrice = uint256(price) / divisor;
        } else {
            // Already correct scale (expo = -8)
            convertedPrice = uint256(price);
        }
        
        require(convertedPrice > 0, "PythPriceConverter: invalid price");
    }
}

