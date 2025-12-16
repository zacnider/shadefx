# ShadeFX API Documentation

## Smart Contract API

### Contract: ShadeFXPerpDEX

**Address**: Deployed contract address (set in environment variables)

### Events

#### PositionOpened
```solidity
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
```
Emitted when a user opens a new position.

#### PositionClosed
```solidity
event PositionClosed(
    uint256 indexed positionId,
    address indexed trader,
    string indexed pairKey,
    uint256 exitPrice,
    int256 pnl,
    uint256 collateralReturned,
    uint256 closingFee
);
```
Emitted when a position is closed.

#### OrderCreated
```solidity
event OrderCreated(
    uint256 indexed orderId,
    address indexed trader,
    string indexed pairKey,
    OrderType orderType,
    uint256 limitPrice,
    uint256 collateralAmount,
    uint256 leverage
);
```
Emitted when a limit order is created.

#### OrderExecuted
```solidity
event OrderExecuted(
    uint256 indexed orderId,
    uint256 indexed positionId,
    address indexed trader,
    string pairKey,
    uint256 executionPrice
);
```
Emitted when a limit order is executed.

#### PositionLiquidated
```solidity
event PositionLiquidated(
    uint256 indexed positionId,
    address indexed trader,
    string indexed pairKey,
    address liquidator,
    uint256 liquidationPrice
);
```
Emitted when a position is liquidated.

---

## User Functions

### createMarketOrder

Open a position with market order (immediate execution).

```solidity
function createMarketOrder(
    string memory pairKey,
    externalEbool encryptedDirection,
    externalEuint32 encryptedLeverage,
    bytes calldata inputProofDirection,
    bytes calldata inputProofLeverage,
    uint256 leverage,
    uint256 collateralAmount
) external
```

**Parameters:**
- `pairKey` (string): The trading pair identifier (e.g., "BTCUSD")
- `encryptedDirection` (externalEbool): FHE encrypted direction (true = Long, false = Short)
- `encryptedLeverage` (externalEuint32): FHE encrypted leverage (1-5x)
- `inputProofDirection` (bytes): Input proof for encrypted direction
- `inputProofLeverage` (bytes): Input proof for encrypted leverage
- `leverage` (uint256): Plain leverage value (must match encrypted value)
- `collateralAmount` (uint256): Collateral amount in USDC (6 decimals)

**Requirements:**
- Pair must be active
- Collateral must be at least MIN_COLLATERAL (5 USDC)
- Leverage must be between 1 and maxLeverage (5x)
- User must have sufficient USDC balance
- Price must not be stale

**Events:**
- `PositionOpened`

**Example:**
```javascript
const encryptedDirection = await encryptBool(true); // Long
const encryptedLeverage = await encrypt32(2); // 2x leverage
await contract.createMarketOrder(
  "BTCUSD",
  encryptedDirection.handles[0],
  encryptedLeverage.handles[0],
  encryptedDirection.inputProof,
  encryptedLeverage.inputProof,
  2,
  ethers.parseUnits("10", 6) // 10 USDC
);
```

---

### createLimitOrder

Create a limit order (executes when price reaches limit price).

```solidity
function createLimitOrder(
    string memory pairKey,
    externalEbool encryptedDirection,
    bytes calldata inputProof,
    uint256 limitPrice,
    uint256 leverage,
    uint256 collateralAmount,
    uint256 expiryTime
) external
```

**Parameters:**
- `pairKey` (string): The trading pair identifier
- `encryptedDirection` (externalEbool): FHE encrypted direction
- `inputProof` (bytes): Input proof for encrypted direction
- `limitPrice` (uint256): Limit price (scaled by PRICE_PRECISION = 1e8)
- `leverage` (uint256): Leverage multiplier (1-5x)
- `collateralAmount` (uint256): Collateral amount in USDC
- `expiryTime` (uint256): Order expiry timestamp (0 = no expiry)

**Requirements:**
- Pair must be active
- Collateral must be at least MIN_COLLATERAL
- Leverage must be valid
- User must have sufficient USDC balance

**Events:**
- `OrderCreated`

**Example:**
```javascript
const limitPrice = 50000 * 1e8; // $50,000
const encryptedDirection = await encryptBool(false); // Short
await contract.createLimitOrder(
  "BTCUSD",
  encryptedDirection.handles[0],
  encryptedDirection.inputProof,
  limitPrice,
  3, // 3x leverage
  ethers.parseUnits("20", 6), // 20 USDC
  0 // No expiry
);
```

---

### closePositionWithDirection

Close an open position.

```solidity
function closePositionWithDirection(
    uint256 positionId,
    bool isLong
) external
```

**Parameters:**
- `positionId` (uint256): Position ID to close
- `isLong` (bool): Decrypted direction (true = Long, false = Short)

**Requirements:**
- Position must be open
- Caller must be position owner
- Price must not be stale

**Events:**
- `PositionClosed`

**Example:**
```javascript
await contract.closePositionWithDirection(1, true); // Close long position
```

---

### cancelOrder

Cancel a pending limit order.

```solidity
function cancelOrder(uint256 orderId) external
```

**Parameters:**
- `orderId` (uint256): Order ID to cancel

**Requirements:**
- Order must be pending
- Caller must be order owner

**Events:**
- `OrderCancelled`

**Example:**
```javascript
await contract.cancelOrder(1);
```

---

### getUserPositions

Get all position IDs for a user.

```solidity
function getUserPositions(address user) 
    external view returns (uint256[] memory)
```

**Parameters:**
- `user` (address): User address

**Returns:**
- `uint256[]`: Array of position IDs

**Example:**
```javascript
const positionIds = await contract.getUserPositions(userAddress);
```

---

### getUserPairPositions

Get position IDs for a specific pair and user.

```solidity
function getUserPairPositions(
    string memory pairKey,
    address user
) external view returns (uint256[] memory)
```

**Parameters:**
- `pairKey` (string): Trading pair identifier
- `user` (address): User address

**Returns:**
- `uint256[]`: Array of position IDs

---

### positions

Get position information.

```solidity
function positions(uint256 positionId) 
    external view returns (Position memory)
```

**Parameters:**
- `positionId` (uint256): Position ID

**Returns:**
- `Position`: Position struct with all position data

---

## Admin Functions

### setOpeningFeeBP

Set opening fee in basis points (owner only).

```solidity
function setOpeningFeeBP(uint256 _openingFeeBP) external onlyOwner
```

**Parameters:**
- `_openingFeeBP` (uint256): Opening fee in basis points (e.g., 25 = 0.025%)

**Requirements:**
- Caller must be owner
- Fee must not exceed 100 (1%)

---

### setClosingFeeBP

Set closing fee in basis points (owner only).

```solidity
function setClosingFeeBP(uint256 _closingFeeBP) external onlyOwner
```

**Parameters:**
- `_closingFeeBP` (uint256): Closing fee in basis points

**Requirements:**
- Caller must be owner
- Fee must not exceed 100 (1%)

---

### setMaxLeverage

Set maximum leverage (owner only).

```solidity
function setMaxLeverage(uint256 _maxLeverage) external onlyOwner
```

**Parameters:**
- `_maxLeverage` (uint256): Maximum leverage (1-20x)

**Requirements:**
- Caller must be owner
- Leverage must be between 1 and 20

---

### pause / unpause

Emergency pause/unpause functionality (owner only).

```solidity
function pause() external onlyOwner
function unpause() external onlyOwner
```

---

## View Functions

### maxLeverage

Get maximum leverage.

```solidity
function maxLeverage() external view returns (uint256)
```

### openingFeeBP

Get opening fee in basis points.

```solidity
function openingFeeBP() external view returns (uint256)
```

### closingFeeBP

Get closing fee in basis points.

```solidity
function closingFeeBP() external view returns (uint256)
```

### MIN_COLLATERAL

Get minimum collateral amount.

```solidity
function MIN_COLLATERAL() external view returns (uint256)
```

---

## Price Oracle API

### Contract: ShadeFXPriceOracle

### getPrice

Get current price for a trading pair.

```solidity
function getPrice(string memory pairKey) 
    external view returns (
        uint256 price,
        uint256 lastUpdateTime,
        bool isActive
    )
```

### getPairConfig

Get pair configuration.

```solidity
function getPairConfig(string memory pairKey) 
    external view returns (PairConfig memory)
```

---

## Frontend API

### Wallet Context

#### connectWallet()
Connect the user's wallet (MetaMask or embedded wallet).

```typescript
const { connectWallet } = useWallet();
await connectWallet();
```

#### Properties
- `account`: Connected account address
- `isConnected`: Whether wallet is connected
- `chainId`: Current chain ID
- `signer`: Ethers.js signer instance
- `embeddedWallet`: Embedded wallet instance (if using Privy)

---

### FHEVM Hook

#### encryptBool(value, contractAddress, userAddress)
Encrypt a boolean value using FHEVM.

```typescript
const { encryptBool } = useFHEVM();
const encrypted = await encryptBool(
  true, // Long = true, Short = false
  contractAddress,
  userAddress
);
```

#### encrypt32(value, contractAddress, userAddress)
Encrypt a uint32 value using FHEVM.

```typescript
const { encrypt32 } = useFHEVM();
const encrypted = await encrypt32(
  2, // Leverage value
  contractAddress,
  userAddress
);
```

#### Properties
- `isReady`: Whether FHEVM is ready
- `error`: Error message if any

---

## Error Codes

### Common Errors

- `"ShadeFX: caller is not the owner"`: Function requires owner privileges
- `"ShadeFX: pair not active"`: Trading pair does not exist or is inactive
- `"ShadeFX: collateral below minimum"`: Collateral below MIN_COLLATERAL (5 USDC)
- `"ShadeFX: insufficient USDC balance"`: User doesn't have enough USDC
- `"ShadeFX: invalid leverage"`: Leverage outside valid range
- `"ShadeFX: insufficient liquidity"`: Not enough liquidity in pool
- `"ShadeFX: price too stale"`: Price hasn't been updated recently
- `"ShadeFX: position not open"`: Position is already closed
- `"ShadeFX: not position owner"`: Caller is not the position owner

---

## Best Practices

1. **Encryption**: Always encrypt trade directions before submission
2. **Validation**: Validate inputs on frontend before submission
3. **Error Handling**: Handle all possible errors gracefully
4. **Gas Estimation**: Estimate gas before sending transactions
5. **Event Listening**: Listen to events for real-time updates
6. **Price Checks**: Verify price is not stale before opening positions
7. **Liquidation Awareness**: Monitor liquidation prices for open positions

---

## Examples

### Complete Trading Flow

```javascript
// 1. Connect wallet
await connectWallet();

// 2. Get contract instance
const contract = getContract(signer);

// 3. Encrypt direction and leverage
const encryptedDirection = await encryptBool(true); // Long
const encryptedLeverage = await encrypt32(2); // 2x leverage

// 4. Open position
const tx = await contract.createMarketOrder(
  "BTCUSD",
  encryptedDirection.handles[0],
  encryptedLeverage.handles[0],
  encryptedDirection.inputProof,
  encryptedLeverage.inputProof,
  2,
  ethers.parseUnits("10", 6) // 10 USDC
);
await tx.wait();

// 5. Get position info
const position = await contract.positions(1);

// 6. Close position (after decryption)
const isLong = await decryptDirection(position.encryptedDirection);
await contract.closePositionWithDirection(1, isLong);
```

---

## GraphQL API (Envio Indexer)

### Query Positions

```graphql
query GetPositions($trader: String!) {
  positions(where: { trader: $trader, isOpen: true }) {
    positionId
    trader
    pairKey
    entryPrice
    size
    collateral
    leverage
    timestamp
  }
}
```

### Query Orders

```graphql
query GetOrders($trader: String!) {
  orders(where: { trader: $trader, status: PENDING }) {
    orderId
    pairKey
    limitPrice
    collateralAmount
    leverage
    timestamp
  }
}
```
