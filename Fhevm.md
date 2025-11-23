# FHEVM Encryption in ShadeFX

This document explains how **Fully Homomorphic Encryption (FHE)** is integrated into ShadeFX using Zama Network's FHEVM (FHE Virtual Machine) to provide privacy for trading positions and strategies.

## 🔐 Overview

ShadeFX uses FHEVM to encrypt sensitive trading data on-chain, ensuring that trading strategies, position directions, leverage, and stop-loss orders remain private while still allowing the smart contract to perform necessary computations.

## 🛡️ What is Encrypted?

### 1. Position Direction (`ebool`)
**What:** Whether a position is **Long** (buy) or **Short** (sell)

**Type:** `ebool` (encrypted boolean)
- `true` = Long position
- `false` = Short position

**Why Encrypted:**
- Hides trading strategy from other traders
- Prevents front-running based on position direction
- Protects competitive trading information

**Location in Contract:**
```solidity
struct Position {
    ebool encryptedDirection; // Encrypted: true = Long, false = Short
    // ... other fields
}
```

**Frontend Usage:**
```typescript
// Encrypt direction before opening position
const encryptedDirectionInput = await encryptBool(
    direction === 'long', // true for long, false for short
    contractAddress,
    userAddress
);
```

---

### 2. Position Leverage (`euint32`)
**What:** The leverage multiplier for a position (1x to 5x)

**Type:** `euint32` (encrypted unsigned 32-bit integer)
- Range: 1 to 5
- Represents how much the position size is multiplied

**Why Encrypted:**
- Leverage reveals risk appetite and trading strategy
- High leverage positions could be targeted by liquidators
- Protects trading capital allocation strategy

**Location in Contract:**
```solidity
struct Position {
    euint32 encryptedLeverage; // Encrypted leverage (1-5x)
    // ... other fields
}
```

**Frontend Usage:**
```typescript
// Encrypt leverage (1-5) before opening position
const encryptedLeverageInput = await encrypt32(
    leverage, // 1, 2, 3, 4, or 5
    contractAddress,
    userAddress
);
```

---

### 3. Stop Loss Price (`euint64`)
**What:** The price at which a position should be automatically closed to limit losses

**Type:** `euint64` (encrypted unsigned 64-bit integer)
- Scaled by `PRICE_PRECISION` (1e8)
- `0` means no stop loss is set

**Why Encrypted:**
- Stop loss prices reveal risk management strategy
- Could be exploited by market manipulators
- Protects trading exit strategy

**Location in Contract:**
```solidity
struct Position {
    euint64 encryptedStopLoss; // Encrypted stop loss price (0 = no stop loss)
    // ... other fields
}
```

**Frontend Usage:**
```typescript
// Encrypt stop loss price (scaled by PRICE_PRECISION)
const stopLossScaled = BigInt(Math.floor(stopLossPrice * 1e8));
const encryptedStopLossInput = await encrypt64(
    stopLossScaled,
    contractAddress,
    userAddress
);
```

---

### 4. Limit Order Direction (`ebool`)
**What:** The direction for limit orders (Long or Short)

**Type:** `ebool` (encrypted boolean)
- Same as position direction
- Used when creating limit orders

**Why Encrypted:**
- Hides pending trading intentions
- Prevents front-running of limit orders
- Protects order book strategy

**Location in Contract:**
```solidity
struct Order {
    ebool encryptedDirection; // Encrypted: true = Long, false = Short
    // ... other fields
}
```

**Frontend Usage:**
```typescript
// Encrypt direction for limit order
const encryptedDirectionInput = await encryptBool(
    direction === 'long',
    contractAddress,
    userAddress
);
```

---

## 🔄 How Encryption Works

### Encryption Flow

1. **Frontend Encryption:**
   ```typescript
   // User selects: Long position, 3x leverage, $50,000 stop loss
   
   // Step 1: Encrypt direction
   const encryptedDirection = await encryptBool(true, contractAddress, userAddress);
   
   // Step 2: Encrypt leverage
   const encryptedLeverage = await encrypt32(3, contractAddress, userAddress);
   
   // Step 3: Encrypt stop loss
   const stopLossScaled = BigInt(50000 * 1e8);
   const encryptedStopLoss = await encrypt64(stopLossScaled, contractAddress, userAddress);
   ```

2. **Smart Contract Receives Encrypted Data:**
   ```solidity
   function openPosition(
       externalEbool encryptedDirection,
       externalEuint32 encryptedLeverage,
       // ... other parameters
   ) external {
       // Convert external encrypted values to internal FHE types
       ebool direction = FHE.fromExternal(encryptedDirection, inputProof);
       euint32 leverage = FHE.fromExternal(encryptedLeverage, inputProof);
       
       // Make decryptable by contract (for computations)
       direction = FHE.makePubliclyDecryptable(direction);
       leverage = FHE.makePubliclyDecryptable(leverage);
       
       // Store encrypted in position
       positions[positionId] = Position({
           encryptedDirection: direction,
           encryptedLeverage: leverage,
           // ...
       });
   }
   ```

3. **On-Chain Storage:**
   - Encrypted values are stored on-chain in encrypted form
   - Only the contract can decrypt them for computations
   - Other users cannot see the actual values

---

## 🔓 Decryption Process

### When Decryption Happens

Encrypted values are decrypted by the contract when needed for:

1. **Position Closing:**
   - Direction must be decrypted to calculate PnL correctly
   - Leverage is used to calculate position size

2. **Liquidation Checks:**
   - Direction and leverage are needed to determine liquidation price
   - Stop loss is checked against current price

3. **Open Interest Updates:**
   - Direction must be decrypted to update long/short open interest
   - This happens after position opening via `updateOpenInterest()`

### Decryption in Contract

```solidity
// Decrypt direction for position closing
ebool direction = FHE.makePubliclyDecryptable(position.encryptedDirection);
// Contract can now use the decrypted value for calculations
```

**Note:** Decryption happens on-chain, but the decrypted values are only used internally by the contract. They are not exposed to external callers.

---

## 🛠️ Technical Implementation

### FHEVM Types Used

| Type | Purpose | Range | Example |
|------|---------|-------|---------|
| `ebool` | Encrypted boolean | `true` / `false` | Position direction |
| `euint32` | Encrypted 32-bit integer | 0 to 4,294,967,295 | Leverage (1-5) |
| `euint64` | Encrypted 64-bit integer | 0 to 18,446,744,073,709,551,615 | Stop loss price |

### Frontend Encryption Functions

```typescript
// From useFHEVM hook
interface FHEVMHook {
  encryptBool: (value: boolean, contractAddress: string, userAddress: string) => Promise<EncryptedInput>;
  encrypt32: (value: number, contractAddress: string, userAddress: string) => Promise<EncryptedInput>;
  encrypt64: (value: bigint, contractAddress: string, userAddress: string) => Promise<EncryptedInput>;
}
```

### Contract FHE Operations

```solidity
// Import FHE types and functions
import {FHE, ebool, externalEbool, euint32, externalEuint32, euint64, externalEuint64} 
    from "@fhevm/solidity/lib/FHE.sol";

// Convert external encrypted input to internal FHE type
ebool direction = FHE.fromExternal(encryptedDirection, inputProof);

// Allow contract to use encrypted value
FHE.allowThis(direction);
FHE.allow(direction, msg.sender);

// Make decryptable for computations
direction = FHE.makePubliclyDecryptable(direction);
```

---

## 🔒 Security Benefits

### Privacy Protection

1. **Trading Strategy Privacy:**
   - Other traders cannot see your position direction
   - Leverage and stop loss remain hidden
   - Prevents strategy copying

2. **Front-Running Prevention:**
   - Encrypted limit orders prevent front-running
   - Market makers cannot see pending orders
   - Reduces MEV (Maximal Extractable Value) attacks

3. **Competitive Advantage:**
   - Large positions remain private
   - Risk management strategies are hidden
   - Trading capital allocation is protected

### On-Chain Privacy

- **Blockchain Transparency:** While blockchain is public, encrypted values appear as random bytes
- **Contract Computations:** Contract can perform operations on encrypted data without decrypting
- **Selective Decryption:** Only the contract can decrypt when needed for calculations

---

## 📊 What is NOT Encrypted

For transparency and functionality, the following data is **public**:

1. **Position ID:** Unique identifier (public for tracking)
2. **Trader Address:** Wallet address (public for ownership)
3. **Pair Key:** Trading pair (e.g., "BTCUSD") - public
4. **Entry Price:** Entry price - public (needed for PnL calculations)
5. **Position Size:** Total position size - public (needed for liquidity)
6. **Collateral:** Collateral amount - public (needed for margin checks)
7. **Timestamp:** Position open time - public
8. **Liquidation Price:** Calculated liquidation price - public

**Why These Are Public:**
- Required for contract functionality
- Needed for liquidation mechanisms
- Essential for open interest tracking
- Transparent for audit and verification

---

## 🚀 Usage Examples

### Opening an Encrypted Position

```typescript
// 1. User selects: Long, 3x leverage, $50,000 stop loss
const direction = 'long';
const leverage = 3;
const stopLoss = 50000;

// 2. Encrypt sensitive data
const encryptedDirection = await encryptBool(
    direction === 'long',
    contractAddress,
    userAddress
);

const encryptedLeverage = await encrypt32(
    leverage,
    contractAddress,
    userAddress
);

const encryptedStopLoss = await encrypt64(
    BigInt(stopLoss * 1e8),
    contractAddress,
    userAddress
);

// 3. Send to contract
await contract.openPosition(
    encryptedDirection.handles[0],
    encryptedDirection.inputProof,
    encryptedLeverage.handles[0],
    encryptedLeverage.inputProof,
    // ... other parameters
);
```

### Setting Encrypted Stop Loss

```typescript
// Encrypt stop loss price
const stopLossScaled = BigInt(stopLossPrice * 1e8);
const encryptedStopLoss = await encrypt64(
    stopLossScaled,
    contractAddress,
    userAddress
);

// Update position
await contract.setStopLoss(
    positionId,
    encryptedStopLoss.handles[0],
    encryptedStopLoss.inputProof
);
```

---

## 🔧 FHEVM Configuration

### Network Requirements

- **Network:** Sepolia Testnet (Chain ID: 11155111)
- **Relayer:** Zama Network Relayer (`https://relayer.testnet.zama.cloud`)
- **Gateway:** FHEVM Gateway Contract

### Frontend Setup

```typescript
import { useFHEVM } from './hooks/useFHEVM';

const { encryptBool, encrypt32, encrypt64, isReady, error } = useFHEVM(
    provider,
    embeddedWallet
);

// Wait for FHEVM to initialize
if (!isReady) {
    return <div>Initializing FHEVM...</div>;
}
```

### Contract Setup

```solidity
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ShadeFXPerpDEX is ZamaEthereumConfig {
    // Contract automatically configured for FHEVM
}
```

---

## 📚 Additional Resources

- **Zama Network:** https://www.zama.ai/
- **FHEVM Documentation:** https://docs.zama.ai/fhevm
- **Relayer SDK:** https://docs.zama.ai/protocol/sdk-guides
- **FHE Types:** https://docs.zama.ai/fhevm/types

---

## ⚠️ Important Notes

1. **Decryption Timing:** Encrypted values are decrypted on-chain when needed for computations. The decrypted values are only used internally by the contract.

2. **Gas Costs:** FHE operations have higher gas costs than plain operations. This is the trade-off for privacy.

3. **Relayer Dependency:** Frontend encryption requires connection to Zama Network Relayer. Ensure the relayer is accessible.

4. **Network Requirement:** FHEVM currently only works on Sepolia testnet. Mainnet support is coming.

5. **Input Proofs:** Each encrypted input requires an input proof that must be generated by the relayer. This requires a transaction approval.

---

## 🎯 Summary

ShadeFX uses FHEVM to encrypt:
- ✅ **Position Direction** (Long/Short)
- ✅ **Position Leverage** (1-5x)
- ✅ **Stop Loss Price**
- ✅ **Limit Order Direction**

This ensures that trading strategies and risk management remain private while still allowing the smart contract to perform necessary computations for position management, liquidation, and PnL calculations.

**Privacy + Functionality = Confidential Trading** 🔐

