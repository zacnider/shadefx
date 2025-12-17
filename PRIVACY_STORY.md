# ShadeFX Privacy Story - FHEVM Encryption Strategy

## 🔒 Overview

ShadeFX uses **Fully Homomorphic Encryption (FHE)** via Zama FHEVM to protect user trading strategies from front-running and MEV attacks. This document explains our privacy model, why we use `makePubliclyDecryptable()`, and the trade-offs we've made to balance privacy with functionality.

---

## 🎯 Privacy Goals

### **Primary Goal: Front-Running Protection**

The main privacy goal of ShadeFX is to **prevent front-running attacks** during transaction submission. When a user submits a trade:

1. ✅ **Transaction is encrypted** - Direction, leverage, and stop loss are encrypted
2. ✅ **Mempool is private** - Other users cannot see the trade direction before execution
3. ✅ **No MEV extraction** - Bots cannot front-run large positions
4. ✅ **Strategy protection** - Trading strategies remain hidden until position opens

### **Secondary Goal: System Functionality**

After a position is opened, certain information must be visible for:
- **Liquidation checks** - System needs to know direction to calculate liquidation price
- **Open interest tracking** - Long/short positions must be tracked separately
- **Stop loss triggers** - Stop loss prices must be comparable with current prices
- **PnL calculations** - Profit/loss calculations require direction information

---

## 🔐 Encryption Flow

### **Phase 1: Transaction Submission (PRIVATE)**

```
User Input (Long/Short, Leverage, Stop Loss)
    ↓
Frontend Encryption (FHEVM SDK)
    ↓
encryptedDirection (ebool)
encryptedLeverage (euint32)
encryptedStopLoss (euint64)
    ↓
Transaction Submitted to Blockchain
    ↓
✅ PRIVATE: No one can see the values
```

**What's Encrypted:**
- Trade direction (Long/Short) → `ebool`
- Leverage (1-5x) → `euint32`
- Stop loss price → `euint64`

**Privacy Level:** 🔒 **FULL PRIVACY**
- Values are encrypted on-chain
- Only the user and contract can decrypt (with permissions)
- Front-running is prevented

### **Phase 2: Position Opening (TRANSITION)**

```
Contract Receives Encrypted Values
    ↓
FHE.fromExternal() → Convert to internal types
    ↓
FHE.allowThis() → Contract can decrypt
FHE.allow() → User can decrypt
    ↓
Position Created
    ↓
FHE.makePubliclyDecryptable() → Everyone can decrypt
    ↓
⚠️ PRIVACY TRANSITION: Values become publicly decryptable
```

**Why `makePubliclyDecryptable()`?**
- Required for liquidation system
- Required for open interest tracking
- Required for stop loss comparison
- Required for PnL calculations

**Privacy Level:** ⚠️ **CONDITIONAL PRIVACY**
- Values are still encrypted on-chain
- But anyone can decrypt them (publicly decryptable)
- Privacy is maintained during transaction submission
- Transparency is enabled after position opens

### **Phase 3: Position Management (PUBLIC)**

```
Position is Open
    ↓
Direction, Leverage, Stop Loss are Publicly Decryptable
    ↓
✅ PUBLIC: Anyone can decrypt and see the values
```

**Privacy Level:** 📊 **TRANSPARENT**
- Values can be decrypted by anyone
- Required for system operations
- Enables liquidation, tracking, and calculations

---

## 🤔 Why This Privacy Model?

### **The Trade-Off**

We've chosen a **"Privacy During Submission, Transparency After Opening"** model because:

#### ✅ **Advantages:**
1. **Front-Running Protection** - The critical privacy window is during transaction submission
2. **System Functionality** - Liquidation, tracking, and calculations require decrypted values
3. **User Control** - Users can see their positions and manage them
4. **Transparency** - Open positions are transparent, which builds trust

#### ⚠️ **Trade-Offs:**
1. **Post-Opening Visibility** - Once a position is open, direction is visible
2. **No Permanent Privacy** - Values are not permanently encrypted
3. **Transparency Requirement** - System operations require decrypted values

### **Alternative Approaches (Not Used)**

#### ❌ **Option 1: Permanent Encryption**
- Keep values encrypted forever
- **Problem**: Cannot perform liquidation, tracking, or calculations
- **Result**: System would not function

#### ❌ **Option 2: No Encryption**
- Don't encrypt at all
- **Problem**: Front-running attacks possible
- **Result**: Users' strategies exposed

#### ✅ **Option 3: Our Approach (Hybrid)**
- Encrypt during submission (privacy)
- Decrypt after opening (functionality)
- **Result**: Best balance of privacy and functionality

---

## 📊 Privacy Timeline

### **Timeline of Privacy States**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER PREPARES TRADE                                       │
│    Privacy: 🔒 FULL (Local, not on-chain)                    │
│    Status: User selects direction, leverage, stop loss       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. FRONTEND ENCRYPTS                                         │
│    Privacy: 🔒 FULL (Encryption happens locally)            │
│    Status: FHEVM SDK encrypts values                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. TRANSACTION SUBMITTED                                     │
│    Privacy: 🔒 FULL (Encrypted on-chain)                    │
│    Status: Transaction in mempool, encrypted                 │
│    ⚠️ CRITICAL PRIVACY WINDOW: Front-running prevented        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. TRANSACTION CONFIRMED                                     │
│    Privacy: 🔒 FULL (Still encrypted)                        │
│    Status: Transaction confirmed, values still encrypted     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. POSITION OPENS                                            │
│    Privacy: ⚠️ TRANSITION (makePubliclyDecryptable called)   │
│    Status: Position created, values become decryptable       │
│    Reason: Required for liquidation, tracking, calculations  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. POSITION OPEN                                             │
│    Privacy: 📊 TRANSPARENT (Publicly decryptable)            │
│    Status: Anyone can decrypt and see values                 │
│    Reason: System operations require decrypted values        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Detailed Privacy Analysis

### **1. Trade Direction (Long/Short)**

#### **Encryption:**
- **Type**: `ebool` (encrypted boolean)
- **Value**: `true` = Long, `false` = Short
- **Encryption Location**: Frontend (`useFHEVM.ts`)
- **On-Chain Storage**: `Position.encryptedDirection`

#### **Privacy States:**

| Phase | Privacy | Who Can See? | Why? |
|-------|---------|--------------|------|
| **Transaction Submission** | 🔒 FULL | No one | Prevents front-running |
| **Position Opening** | ⚠️ TRANSITION | Contract + User | Position creation |
| **Position Open** | 📊 TRANSPARENT | Everyone | Liquidation, tracking |

#### **Why `makePubliclyDecryptable()`?**
- **Liquidation System**: Needs to know if position is Long or Short to calculate liquidation price
- **Open Interest Tracking**: Must track total Long vs. Short positions separately
- **PnL Calculations**: Profit/loss depends on direction

### **2. Leverage (1-5x)**

#### **Encryption:**
- **Type**: `euint32` (encrypted 32-bit integer)
- **Value**: 1 to 5 (leverage multiplier)
- **Encryption Location**: Frontend (`useFHEVM.ts`)
- **On-Chain Storage**: `Position.encryptedLeverage`

#### **Privacy States:**

| Phase | Privacy | Who Can See? | Why? |
|-------|---------|--------------|------|
| **Transaction Submission** | 🔒 FULL | No one | Prevents front-running |
| **Position Opening** | ⚠️ TRANSITION | Contract + User | Position creation |
| **Position Open** | 📊 TRANSPARENT | Everyone | Liquidation calculations |

#### **Why `makePubliclyDecryptable()`?**
- **Liquidation Calculations**: Leverage affects liquidation price
- **Risk Management**: System needs to know leverage for risk assessment
- **Position Size**: Position size = collateral × leverage

### **3. Stop Loss**

#### **Encryption:**
- **Type**: `euint64` (encrypted 64-bit integer)
- **Value**: Stop loss price (0 = no stop loss)
- **Encryption Location**: Frontend (`useFHEVM.ts`)
- **On-Chain Storage**: `Position.encryptedStopLoss`

#### **Privacy States:**

| Phase | Privacy | Who Can See? | Why? |
|-------|---------|--------------|------|
| **Transaction Submission** | 🔒 FULL | No one | Prevents front-running |
| **Stop Loss Set** | ⚠️ TRANSITION | Contract + User | Stop loss setting |
| **Stop Loss Active** | 📊 TRANSPARENT | Everyone | Stop loss comparison |

#### **Why `makePubliclyDecryptable()`?**
- **Stop Loss Comparison**: System needs to compare stop loss price with current price
- **Trigger Mechanism**: Stop loss triggers require price comparison
- **Note**: Currently uses decrypted comparison (see "Encrypted Stop Loss Comparison" section)

---

## 🛡️ Security Guarantees

### **What FHEVM Provides:**

1. **Zero-Knowledge Proof (ZKPoK)**
   - Validates encrypted inputs
   - Prevents replay attacks
   - Guarantees input authenticity

2. **Homomorphic Operations**
   - Encrypted values can be processed without decryption
   - Enables on-chain computations on encrypted data

3. **Access Control**
   - `FHE.allowThis()` - Contract can decrypt
   - `FHE.allow()` - Specific addresses can decrypt
   - `FHE.makePubliclyDecryptable()` - Everyone can decrypt

### **What We Protect:**

✅ **Transaction Submission Privacy**
- Direction, leverage, stop loss are encrypted during submission
- Front-running is prevented
- MEV attacks are mitigated

✅ **User Control**
- Users can decrypt their own positions
- Users can manage their positions
- Users can see their PnL

⚠️ **Post-Opening Transparency**
- Positions are transparent after opening
- Required for system operations
- Enables liquidation and tracking

---

## 📈 Comparison with Other Privacy Models

### **ShadeFX vs. Other Approaches**

| Approach | Privacy During Submission | Privacy After Opening | System Functionality |
|---------|--------------------------|----------------------|---------------------|
| **ShadeFX (Hybrid)** | ✅ Full | ⚠️ Transparent | ✅ Full |
| **Permanent Encryption** | ✅ Full | ✅ Full | ❌ Limited |
| **No Encryption** | ❌ None | ❌ None | ✅ Full |

**Conclusion**: ShadeFX's hybrid approach provides the best balance of privacy and functionality.

---

## 🎯 Privacy Use Cases

### **Use Case 1: Large Position Opening**

**Scenario**: User wants to open a large Long position (1000 USDC, 5x leverage)

**Without FHEVM:**
1. ❌ Transaction visible in mempool
2. ❌ Bots see large Long position
3. ❌ Front-running possible
4. ❌ Price manipulation risk

**With ShadeFX FHEVM:**
1. ✅ Transaction encrypted in mempool
2. ✅ Bots cannot see direction
3. ✅ Front-running prevented
4. ✅ Position opens at fair price

**Privacy Protection**: 🔒 **FULL** during submission

### **Use Case 2: Strategy Protection**

**Scenario**: User has a trading strategy (e.g., "Buy when price drops 5%")

**Without FHEVM:**
1. ❌ Strategy visible in mempool
2. ❌ Bots can copy strategy
3. ❌ Strategy becomes less effective

**With ShadeFX FHEVM:**
1. ✅ Strategy encrypted during submission
2. ✅ Bots cannot see strategy
3. ✅ Strategy remains effective

**Privacy Protection**: 🔒 **FULL** during submission

### **Use Case 3: Position Management**

**Scenario**: User wants to check PnL and manage position

**With ShadeFX:**
1. ✅ Position is transparent after opening
2. ✅ User can see PnL
3. ✅ User can manage position
4. ✅ System can liquidate if needed

**Privacy Trade-Off**: ⚠️ **TRANSPARENT** after opening (required for functionality)

---

## 🔮 Future Privacy Enhancements

### **Potential Improvements:**

1. **Encrypted Stop Loss Comparison**
   - Use `FHE.lt()` and `FHE.gt()` for encrypted comparisons
   - Keep stop loss encrypted during comparison
   - **Status**: Not implemented (see "Encrypted Stop Loss Comparison" section)

2. **Delayed Decryption**
   - Delay `makePubliclyDecryptable()` call
   - Keep values encrypted longer
   - **Trade-off**: More complex liquidation system

3. **Selective Decryption**
   - Only decrypt what's needed
   - Keep other values encrypted
   - **Trade-off**: More complex system

---

## 📝 Summary

### **ShadeFX Privacy Model:**

1. ✅ **Full Privacy During Submission**
   - Direction, leverage, stop loss are encrypted
   - Front-running is prevented
   - MEV attacks are mitigated

2. ⚠️ **Transparency After Opening**
   - Values become publicly decryptable
   - Required for system operations
   - Enables liquidation, tracking, calculations

3. 🎯 **Best Balance**
   - Privacy when it matters most (submission)
   - Functionality when needed (operations)
   - User control and transparency

### **Key Takeaway:**

**ShadeFX protects your trading strategy during the critical window (transaction submission) while enabling system functionality after position opening. This hybrid approach provides the best balance of privacy and functionality for a perpetual DEX.**

---

## 📚 Related Documentation

- [ZAMA_FHE_USAGE.md](./ZAMA_FHE_USAGE.md) - Detailed FHEVM usage
- [FHEVM_INTEGRATION.md](./FHEVM_INTEGRATION.md) - Technical integration details
- [README.md](./README.md) - Project overview
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System architecture

---

**Last Updated**: 2025-12-17
**Status**: Production-ready privacy model

