# FHEVM Integration Guide

## Overview

ShadeFX uses real FHEVM (Fully Homomorphic Encryption Virtual Machine) integration for encrypted perpetual futures trading. Trade directions (Long/Short) are encrypted before submission to protect trading strategies from front-running and MEV attacks. This document explains how FHEVM is integrated into the project.

## Smart Contract Integration

### Package

The smart contract uses the `@fhevm/solidity` library:

```solidity
import {FHE, ebool, externalEbool, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
```

### Key Components

1. **Encrypted Types**:
   - `ebool`: Encrypted boolean (internal)
   - `externalEbool`: Encrypted boolean (external/calldata)
   - `euint32`: Encrypted unsigned 32-bit integer (internal)
   - `externalEuint32`: Encrypted unsigned 32-bit integer (external/calldata)

2. **FHE Library Functions**:
   - `FHE.fromExternal(externalEbool, inputProof)`: Convert external encrypted value to internal
   - `FHE.allowThis(ebool)`: Allow contract to decrypt the value
   - `FHE.allow(ebool, address)`: Allow specific address to decrypt the value
   - `FHE.makePubliclyDecryptable(ebool)`: Make value publicly decryptable

### Usage in ShadeFXPerpDEX Contract

#### Opening Positions with Encrypted Direction

```solidity
function createMarketOrder(
    string memory pairKey,
    externalEbool encryptedDirection,
    externalEuint32 encryptedLeverage,
    bytes calldata inputProofDirection,
    bytes calldata inputProofLeverage,
    uint256 leverage,
    uint256 collateralAmount
) external {
    // Convert external encrypted values to internal
    ebool direction = FHE.fromExternal(encryptedDirection, inputProofDirection);
    euint32 leverageEncrypted = FHE.fromExternal(encryptedLeverage, inputProofLeverage);
    
    // Allow contract and user to decrypt
    FHE.allowThis(direction);
    FHE.allow(direction, msg.sender);
    FHE.allowThis(leverageEncrypted);
    FHE.allow(leverageEncrypted, msg.sender);
    
    // Make direction publicly decryptable for open interest tracking
    FHE.makePubliclyDecryptable(direction);
    
    // Store encrypted direction in position
    positions[positionId].encryptedDirection = direction;
    positions[positionId].encryptedLeverage = leverageEncrypted;
}
```

#### Creating Limit Orders with Encrypted Direction

```solidity
function createLimitOrder(
    string memory pairKey,
    externalEbool encryptedDirection,
    bytes calldata inputProof,
    uint256 limitPrice,
    uint256 leverage,
    uint256 collateralAmount,
    uint256 expiryTime
) external {
    // Convert external encrypted direction to internal
    ebool direction = FHE.fromExternal(encryptedDirection, inputProof);
    
    // Allow contract and user to decrypt
    FHE.allowThis(direction);
    FHE.allow(direction, msg.sender);
    
    // Store encrypted direction in order
    orders[orderId].encryptedDirection = direction;
}
```

## Frontend Integration

### Package

The frontend uses the `@zama-fhe/relayer-sdk` package:

```typescript
import { createRelayerClient } from '@zama-fhe/relayer-sdk/web';
```

### Initialization

```typescript
// Initialize FHEVM relayer client
const client = await createRelayerClient({
  chainId: 11155111, // Sepolia
  gatewayUrl: 'https://gateway.fhevm.zama.ai',
});
```

### Encryption

```typescript
// Encrypt a boolean value (for direction)
const encrypted = await client.encryptBool(
  true, // Long = true, Short = false
  contractAddress,
  userAddress
);

// Encrypt a uint32 value (for leverage)
const encryptedLeverage = await client.encrypt32(
  2, // Leverage value
  contractAddress,
  userAddress
);
```

### Decryption

```typescript
// Decrypt an encrypted value (requires permission)
const decrypted = await client.decrypt(
  encryptedHandle,
  contractAddress,
  signer
);
```

### Usage in ShadeFX Frontend

#### useFHEVM Hook

The `useFHEVM` hook provides encryption/decryption functionality:

```typescript
const { encrypt, decrypt, isReady } = useFHEVM(provider);
```

#### Opening Positions

```typescript
// Encrypt direction (true = Long, false = Short)
const directionBool = direction === 'long';
const encryptedDirection = await encryptBool(
  directionBool,
  contractAddress,
  account
);

// Encrypt leverage (1-5x)
const encryptedLeverage = await encrypt32(
  leverage,
  contractAddress,
  account
);

// Format for contract
const encryptedValue = ethers.hexlify(encryptedDirection.handles[0]);
const encryptedLeverageValue = ethers.hexlify(encryptedLeverage.handles[0]);
const inputProof = ethers.hexlify(encryptedDirection.inputProof);
const leverageProof = ethers.hexlify(encryptedLeverage.inputProof);

// Submit to contract
await contract.createMarketOrder(
  pairKey,
  encryptedValue,
  encryptedLeverageValue,
  inputProof,
  leverageProof,
  leverage,
  collateralAmount
);
```

## FHEVM Contract Address

The FHEVM contract is typically deployed at:

```
0x0000000000000000000000000000000000000044
```

This contract provides the public key needed for FHEVM initialization.

## Network Requirements

FHEVM requires a compatible network. Currently supported networks:

- **Localhost**: For development (requires FHEVM node)
- **FHEVM Testnet**: For testing
- **FHEVM Mainnet**: For production (when available)

## Public Key Retrieval

The public key is retrieved from the FHEVM contract:

```typescript
const publicKey = await provider.call({
  to: '0x0000000000000000000000000000000000000044',
  data: '0x',
});
```

## Value Types

ShadeFX uses different encrypted types for different purposes:

- **Trade Direction**: `ebool` (true = Long, false = Short)
- **Leverage**: `euint32` (1-5x leverage multiplier)
- **Stop Loss**: `euint64` (optional encrypted stop loss price)

No scaling is needed for boolean values. Leverage values are integers (1-5), so no scaling required.

## Security Considerations

1. **Encryption**: Trade directions are encrypted before submission to prevent front-running
2. **Privacy**: Trading strategies remain private until positions are executed
3. **MEV Protection**: Encrypted transactions prevent maximal extractable value attacks
4. **Public Decryption**: Directions become publicly decryptable after position opening (for open interest tracking and liquidation)

## Testing

### Mock FHEVM

For testing, you can use FHEVM mocks:

```typescript
import { fhevmMocks } from 'fhevmjs/mocks';
```

### Test Scenarios

1. **Encryption Test**: Verify trade directions are encrypted correctly
2. **Position Opening Test**: Verify encrypted positions can be opened
3. **Limit Order Test**: Verify encrypted limit orders work correctly
4. **Decryption Test**: Verify directions can be decrypted after position opening
5. **Integration Test**: Test end-to-end trading flow

## Troubleshooting

### Common Issues

1. **FHEVM Not Initialized**:
   - Check that provider is connected
   - Verify FHEVM contract address
   - Check network compatibility

2. **Encryption Errors**:
   - Verify value is within euint32 range (0 to 2^32 - 1)
   - Check value scaling (multiply by 10000)
   - Verify FHEVM instance is ready

3. **Contract Errors**:
   - Verify FHEVM imports are correct
   - Check contract compilation
   - Verify network compatibility

## Resources

- [FHEVM Documentation](https://docs.zama.org/protocol)
- [FHEVM GitHub](https://github.com/zama-ai/fhevm)
- [FHEVM Solidity Guide](https://docs.zama.org/protocol/solidity-guides)
- [FHEVM JavaScript SDK](https://github.com/zama-ai/fhevmjs)

## Support

For FHEVM-related issues:
- Check [Zama Documentation](https://docs.zama.org/protocol)
- Join [Zama Discord](https://discord.gg/zama)
- Review [FHEVM Examples](https://github.com/zama-ai/fhevm/tree/main/examples)

