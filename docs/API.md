# ShadeFX API Documentation

## Smart Contract API

### Contract: ShadeFX

**Address**: Deployed contract address (set in environment variables)

### Events

#### PredictionSubmitted
```solidity
event PredictionSubmitted(
    string indexed currencyPair,
    address indexed predictor,
    uint256 timestamp
);
```
Emitted when a user submits a prediction.

#### ResultDeclared
```solidity
event ResultDeclared(
    string indexed currencyPair,
    uint256 timestamp
);
```
Emitted when the owner declares the result.

#### WinnerRevealed
```solidity
event WinnerRevealed(
    string indexed currencyPair,
    address indexed winner,
    uint256 reward
);
```
Emitted when a winner is revealed.

#### RewardClaimed
```solidity
event RewardClaimed(
    string indexed currencyPair,
    address indexed claimer,
    uint256 amount
);
```
Emitted when a winner claims their reward.

#### CurrencyPairCreated
```solidity
event CurrencyPairCreated(
    string indexed currencyPair,
    string baseCurrency,
    string quoteCurrency,
    uint256 predictionDeadline
);
```
Emitted when a new currency pair is created.

---

## User Functions

### submitPrediction

Submit an encrypted currency rate prediction.

```solidity
function submitPrediction(
    string memory currencyPairKey,
    inEuint32 calldata encryptedPrediction
) external payable
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier (e.g., "EURUSD")
- `encryptedPrediction` (inEuint32): The encrypted prediction value (scaled by 10000)

**Payable:** Yes - Must send at least `minStakeAmount` ETH

**Requirements:**
- Currency pair must be active
- Current time must be before prediction deadline
- User must not have already submitted a prediction for this pair
- Stake amount must be at least `minStakeAmount`

**Events:**
- `PredictionSubmitted`

**Example:**
```javascript
const encryptedPrediction = await fhevm.encrypt(12345); // 1.2345 scaled by 10000
await contract.submitPrediction("EURUSD", encryptedPrediction, {
  value: ethers.parseEther("0.01")
});
```

---

### checkWinner

Check if a user is a winner for a specific currency pair.

```solidity
function checkWinner(
    string memory currencyPairKey,
    address userAddress
) external view returns (bool isWinner)
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier
- `userAddress` (address): The address to check

**Returns:**
- `isWinner` (bool): True if the user is a winner

**Requirements:**
- Result must be declared
- User must have submitted a prediction

**Example:**
```javascript
const isWinner = await contract.checkWinner("EURUSD", userAddress);
```

---

### claimReward

Claim reward if the caller is a winner.

```solidity
function claimReward(string memory currencyPairKey) external
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier

**Requirements:**
- Result must be declared
- Caller must be a winner
- Caller must not have already claimed the reward

**Events:**
- `RewardClaimed`

**Example:**
```javascript
await contract.claimReward("EURUSD");
```

---

### getPredictionCount

Get the total number of predictions for a currency pair.

```solidity
function getPredictionCount(string memory currencyPairKey) 
    external view returns (uint256 count)
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier

**Returns:**
- `count` (uint256): Total number of predictions

**Example:**
```javascript
const count = await contract.getPredictionCount("EURUSD");
```

---

### getRewardPool

Get the total reward pool for a currency pair.

```solidity
function getRewardPool(string memory currencyPairKey) 
    external view returns (uint256 pool)
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier

**Returns:**
- `pool` (uint256): Total reward pool in wei

**Example:**
```javascript
const pool = await contract.getRewardPool("EURUSD");
const poolInEth = ethers.formatEther(pool);
```

---

### getActivePairs

Get all active currency pairs.

```solidity
function getActivePairs() external view returns (string[] memory pairs)
```

**Returns:**
- `pairs` (string[]): Array of active currency pair keys

**Example:**
```javascript
const pairs = await contract.getActivePairs();
```

---

## Admin Functions

### createCurrencyPair

Create a new currency pair round (owner only).

```solidity
function createCurrencyPair(
    string memory currencyPairKey,
    string memory baseCurrency,
    string memory quoteCurrency,
    uint256 predictionDeadline,
    uint256 resultDeadline
) external onlyOwner
```

**Parameters:**
- `currencyPairKey` (string): Unique identifier for the currency pair
- `baseCurrency` (string): Base currency symbol (e.g., "EUR")
- `quoteCurrency` (string): Quote currency symbol (e.g., "USD")
- `predictionDeadline` (uint256): Unix timestamp when predictions close
- `resultDeadline` (uint256): Unix timestamp when results must be declared

**Requirements:**
- Caller must be owner
- Currency pair must not already exist
- Prediction deadline must be in the future
- Result deadline must be after prediction deadline

**Events:**
- `CurrencyPairCreated`

**Example:**
```javascript
const predictionDeadline = Math.floor(Date.now() / 1000) + 86400; // 1 day
const resultDeadline = predictionDeadline + 86400; // 2 days
await contract.createCurrencyPair(
  "EURUSD",
  "EUR",
  "USD",
  predictionDeadline,
  resultDeadline
);
```

---

### declareResult

Declare the real exchange rate result (owner only).

```solidity
function declareResult(
    string memory currencyPairKey,
    inEuint32 calldata encryptedRealValue
) external onlyOwner
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier
- `encryptedRealValue` (inEuint32): The encrypted real exchange rate value

**Requirements:**
- Caller must be owner
- Prediction deadline must have passed
- Result deadline must not have passed
- Result must not already be declared

**Events:**
- `ResultDeclared`

**Example:**
```javascript
const encryptedRealValue = await fhevm.encrypt(12350); // 1.2350 scaled by 10000
await contract.declareResult("EURUSD", encryptedRealValue);
```

---

### revealWinners

Reveal winners for a currency pair (owner only).

```solidity
function revealWinners(
    string memory currencyPairKey,
    address[] calldata winners
) external onlyOwner
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier
- `winners` (address[]): Array of winner addresses

**Requirements:**
- Caller must be owner
- Result must be declared
- All addresses must have submitted predictions

**Events:**
- `WinnerRevealed` (for each winner)

**Example:**
```javascript
const winners = [address1, address2, address3];
await contract.revealWinners("EURUSD", winners);
```

---

### setMinStakeAmount

Update the minimum stake amount (owner only).

```solidity
function setMinStakeAmount(uint256 _minStakeAmount) external onlyOwner
```

**Parameters:**
- `_minStakeAmount` (uint256): New minimum stake amount in wei

**Requirements:**
- Caller must be owner

**Example:**
```javascript
await contract.setMinStakeAmount(ethers.parseEther("0.02"));
```

---

### setRewardFeePercentage

Update the reward fee percentage (owner only).

```solidity
function setRewardFeePercentage(uint256 _rewardFeePercentage) external onlyOwner
```

**Parameters:**
- `_rewardFeePercentage` (uint256): New fee percentage (e.g., 5 = 5%)

**Requirements:**
- Caller must be owner
- Fee percentage must not exceed 20%

**Example:**
```javascript
await contract.setRewardFeePercentage(10); // 10%
```

---

### emergencyWithdraw

Emergency withdraw all funds (owner only).

```solidity
function emergencyWithdraw() external onlyOwner
```

**Requirements:**
- Caller must be owner

**Example:**
```javascript
await contract.emergencyWithdraw();
```

---

## View Functions

### owner

Get the contract owner address.

```solidity
function owner() external view returns (address)
```

**Returns:**
- `address`: Owner address

---

### minStakeAmount

Get the minimum stake amount.

```solidity
function minStakeAmount() external view returns (uint256)
```

**Returns:**
- `uint256`: Minimum stake amount in wei

---

### rewardFeePercentage

Get the reward fee percentage.

```solidity
function rewardFeePercentage() external view returns (uint256)
```

**Returns:**
- `uint256`: Fee percentage (e.g., 5 = 5%)

---

### rounds

Get round information for a currency pair.

```solidity
function rounds(string memory currencyPairKey) 
    external view returns (
        uint256 roundId,
        CurrencyPair memory pair,
        bool resultDeclared,
        uint256 totalPredictions,
        uint256 totalRewardPool
    )
```

**Parameters:**
- `currencyPairKey` (string): The currency pair identifier

**Returns:**
- `roundId` (uint256): Round ID
- `pair` (CurrencyPair): Currency pair information
- `resultDeclared` (bool): Whether result is declared
- `totalPredictions` (uint256): Total number of predictions
- `totalRewardPool` (uint256): Total reward pool in wei

---

## Frontend API

### Wallet Context

#### connectWallet()
Connect the user's MetaMask wallet.

```typescript
const { connectWallet } = useWallet();
await connectWallet();
```

#### disconnectWallet()
Disconnect the wallet.

```typescript
const { disconnectWallet } = useWallet();
disconnectWallet();
```

#### Properties
- `account`: Connected account address
- `isConnected`: Whether wallet is connected
- `chainId`: Current chain ID
- `signer`: Ethers.js signer instance

---

### FHEVM Hook

#### encrypt(value)
Encrypt a value using FHEVM.

```typescript
const { encrypt } = useFHEVM();
const encrypted = await encrypt(12345); // Scaled value
```

**Parameters:**
- `value` (number): Value to encrypt (should be scaled by 10000)

**Returns:**
- `encrypted` (any): Encrypted value

#### decrypt(encrypted)
Decrypt an encrypted value.

```typescript
const { decrypt } = useFHEVM();
const decrypted = await decrypt(encrypted);
```

**Parameters:**
- `encrypted` (any): Encrypted value

**Returns:**
- `decrypted` (number): Decrypted value

#### Properties
- `isReady`: Whether FHEVM is ready
- `error`: Error message if any

---

## Error Codes

### Common Errors

- `"ShadeFX: caller is not the owner"`: Function requires owner privileges
- `"ShadeFX: currency pair not active"`: Currency pair does not exist or is inactive
- `"ShadeFX: prediction deadline passed"`: Cannot submit prediction after deadline
- `"ShadeFX: stake amount too low"`: Stake amount below minimum
- `"ShadeFX: prediction already submitted"`: User already submitted for this pair
- `"ShadeFX: result not declared yet"`: Result must be declared first
- `"ShadeFX: not a winner"`: User is not a winner
- `"ShadeFX: reward already claimed"`: Reward already claimed

---

## Rate Limiting

No rate limiting is implemented in the smart contract. Gas costs naturally limit transaction frequency.

---

## Best Practices

1. **Encryption**: Always encrypt predictions before submission
2. **Validation**: Validate inputs on frontend before submission
3. **Error Handling**: Handle all possible errors gracefully
4. **Gas Estimation**: Estimate gas before sending transactions
5. **Event Listening**: Listen to events for real-time updates
6. **Deadline Awareness**: Check deadlines before submitting predictions

---

## Examples

### Complete Prediction Flow

```javascript
// 1. Connect wallet
await connectWallet();

// 2. Get contract instance
const contract = getContract(signer);

// 3. Encrypt prediction
const predictionValue = 1.2345;
const scaledValue = Math.floor(predictionValue * 10000); // 12345
const encrypted = await fhevm.encrypt(scaledValue);

// 4. Submit prediction
const tx = await contract.submitPrediction("EURUSD", encrypted, {
  value: ethers.parseEther("0.01")
});
await tx.wait();

// 5. Check winner status (after result declared)
const isWinner = await contract.checkWinner("EURUSD", account);

// 6. Claim reward (if winner)
if (isWinner) {
  const claimTx = await contract.claimReward("EURUSD");
  await claimTx.wait();
}
```

