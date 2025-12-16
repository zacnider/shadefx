# Zama FHE Usage - ShadeFX Project

## Overview

ShadeFX project uses **Zama FHEVM (Fully Homomorphic Encryption Virtual Machine)** to perform encrypted computations on the blockchain. This allows users' sensitive data (trade direction and leverage) to be stored and processed in encrypted form.

**Note**: The project is now fully focused on **Perpetual DEX**. Prediction Market is no longer used.

## Encrypted Data

### **Perpetual DEX (ShadeFXPerpDEX.sol)**

#### Encrypted Data 1: **Trade Direction (Long/Short)**
- **Type**: `ebool` (encrypted boolean)
- **Values**: 
  - `true` = Long (Bullish position)
  - `false` = Short (Bearish position)

#### Encrypted Data 2: **Leverage (1-5x)**
- **Type**: `euint32` (encrypted unsigned 32-bit integer)
- **Values**: 1 to 5 (leverage multiplier)

#### 🔓 Privacy Status: **REVEALED - Publicly Decryptable After Position Opening**
- `FHE.allowThis(direction)` → Contract can decrypt
- `FHE.allow(direction, msg.sender)` → Sender can decrypt
- `FHE.makePubliclyDecryptable(direction)` → **Called immediately after position opening** → Everyone can decrypt
- **Result**: 
  - ✅ **Before position opening**: Encrypted (prevents front-running)
  - ⚠️ **After position opening**: `makePubliclyDecryptable()` is called → Everyone can see
  - **Why**: Required for open interest tracking and liquidation

#### Usage Locations:

1. **`createMarketOrder()` - Market Order**
   ```solidity
   function createMarketOrder(
       string memory pairKey,
       externalEbool encryptedDirection,      // FHE encrypted direction
       externalEuint32 encryptedLeverage,    // FHE encrypted leverage
       bytes calldata inputProofDirection,   // ZKPoK proof for direction
       bytes calldata inputProofLeverage,    // ZKPoK proof for leverage
       uint256 leverage,                      // Plain leverage (must match encrypted)
       uint256 collateralAmount
   )
   ```
   - User encrypts Long/Short direction and leverage in the frontend
   - Encrypted direction and leverage are sent to the contract
   - Inside the contract, `FHE.fromExternal()` converts to internal `ebool` and `euint32`
   - `FHE.allowThis()` and `FHE.allow()` grant decryption permissions
   - **Immediately after position opening**, `FHE.makePubliclyDecryptable()` is called for both → Everyone can see (required for open interest tracking and liquidation)

2. **`createLimitOrder()` - Limit Order**
   ```solidity
   function createLimitOrder(
       string memory pairKey,
       externalEbool encryptedDirection,  // FHE encrypted direction
       bytes calldata inputProof,
       uint256 limitPrice,
       uint256 leverage,
       uint256 collateralAmount,
       uint256 expiryTime
   )
   ```
   - When limit order is created, direction is stored encrypted
   - Leverage is stored as plain value (not encrypted in limit orders)
   - **When order executes** (position opens), `makePubliclyDecryptable()` is called → Everyone can see

3. **`executeLimitOrder()` - Limit Order Execution**
   - When limit order executes, encrypted direction is used
   - Position opens and `makePubliclyDecryptable()` is called immediately

#### Why Encrypt?
- **Front-running Prevention**: Direction and leverage remain hidden before position opening, preventing other users from seeing large positions before they're opened
- **Strategy Protection**: Trading strategies remain hidden until position is opened
- **Note**: Immediately after position opening, `makePubliclyDecryptable()` is called, making direction and leverage publicly visible (required for open interest tracking and liquidation)

## Frontend FHE Usage

### 1. **FHEVM Hook (`useFHEVM.ts`)**

```typescript
const { encryptBool, encrypt32, isReady: fhevmReady } = useFHEVM(provider);
```

**Features:**
- `encryptBool(value, contractAddress, userAddress)`: Encrypts boolean values
- `encrypt(value, contractAddress, userAddress)`: Encrypts numeric values
- `encrypt32(value, contractAddress, userAddress)`: Encrypts 32-bit integers (for leverage)
- `decrypt(encrypted, contractAddress, signer)`: Decrypts encrypted values (not used in practice)

**SDK Used:**
- `@zama-fhe/relayer-sdk/web` - Zama's web SDK
- Configured for Sepolia testnet
- Connects to Gateway via relayer

### 2. **Position Opening (`PositionOpening.tsx`)**

```typescript
// Encrypt direction (true = Long, false = Short)
const directionBool = direction === 'long';
const encryptedDirection = await encryptBool(directionBool, contractAddress, account);

// Encrypt leverage (1-5x)
const encryptedLeverage = await encrypt32(leverage, contractAddress, account);

// Format for contract
const encryptedDirectionValue = ethers.hexlify(encryptedDirection.handles[0]);
const encryptedLeverageValue = ethers.hexlify(encryptedLeverage.handles[0]);
const directionProof = ethers.hexlify(encryptedDirection.inputProof);
const leverageProof = ethers.hexlify(encryptedLeverage.inputProof);

// Submit to contract
await contract.createMarketOrder(
    pairKey,
    encryptedDirectionValue,  // externalEbool
    encryptedLeverageValue,    // externalEuint32
    directionProof,           // bytes calldata
    leverageProof,            // bytes calldata
    leverage,                 // uint256 (plain value, must match encrypted)
    collateralAmount
);
```

## FHE Operation Flow

### 1. **Encryption (Frontend)**
```
User Input (Long/Short + Leverage) 
    ↓
FHEVM SDK Encryption
    ↓
encryptedDirection (bytes32) + encryptedLeverage (bytes32) + inputProofs (bytes)
    ↓
Contract Submission
```

### 2. **Contract Processing**
```
externalEbool (direction) + externalEuint32 (leverage)
    ↓
FHE.fromExternal() → ebool + euint32 (internal)
    ↓
FHE.allowThis() → Contract can decrypt
    ↓
FHE.allow() → User can decrypt
    ↓
FHE.makePubliclyDecryptable() → Everyone can decrypt (called after position opens)
```

### 3. **Decryption (Off-chain)**
```
ebool + euint32 (encrypted)
    ↓
Coprocessor (Off-chain FHE computation)
    ↓
Decrypted Values (plaintext)
```

## FHE Usage Benefits

### ✅ **Privacy**
- Trade direction and leverage are encrypted
- Only authorized parties can decrypt
- Front-running protection until position opens

### ✅ **Security**
- Zero-Knowledge Proof (ZKPoK) validation
- Prevents replay attacks
- Guarantees input validation

### ✅ **Decentralization**
- Coprocessors operate in a decentralized manner
- Gateway coordinates operations
- KMS (Key Management Service) uses threshold MPC for security

## FHE Usage Limitations

### ⚠️ **Current Limitations**

1. **No On-chain Decryption**
   - Cannot decrypt directly in contract
   - `FHE.makePubliclyDecryptable()` requires async callback
   - Callback must be used for open interest tracking

2. **Encrypted Comparison Challenges**
   - In `calculatePnLEncrypted()` function, direction is unknown
   - Both long and short PnL are calculated
   - Encrypted comparison should be used (TODO)

3. **Performance**
   - FHE operations are performed on off-chain coprocessors
   - On-chain operations only create handles
   - Actual computation happens off-chain

## FHE Usage Summary

| Feature | Value |
|---------|-------|
| **Encrypted Data 1** | Trade Direction (Long/Short) |
| **Encrypted Data 2** | Leverage (1-5x) |
| **FHE Types** | `ebool`, `euint32` |
| **Encryption Location** | Frontend (`PositionOpening.tsx`) |
| **Contract Functions** | `createMarketOrder()`, `createLimitOrder()` |
| **Decryption Permissions** | `FHE.allowThis()`, `FHE.allow()` |
| **Public Decryption** | `FHE.makePubliclyDecryptable()` (for open interest) |
| **Network** | Sepolia Testnet |

## Network Configuration

ShadeFX is deployed on **Sepolia Testnet** with FHEVM support:

- **FHEVM Public Key Address**: `0x0000000000000000000000000000000000000044`
- **Relayer URL**: `https://relayer.testnet.zama.cloud`
- **FHEVM Contracts**: Automatically configured via `ZamaEthereumConfig`

## Conclusion

ShadeFX project uses Zama FHEVM to:
- ✅ Encrypt trade directions and leverage (Perpetual DEX)
- ✅ Protect user privacy
- ✅ Prevent front-running
- ✅ Protect trading strategies

FHE enables operations on confidential data on the blockchain, adding an important privacy layer to the project. The encryption protects sensitive information until positions are opened, after which data becomes publicly decryptable for transparency and system operations.
