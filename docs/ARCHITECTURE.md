# ShadeFX Architecture Documentation

## Overview

ShadeFX is built on a decentralized architecture using FHEVM (Fully Homomorphic Encryption Virtual Machine) to enable private currency rate predictions. The system consists of three main components:

1. **Smart Contract Layer**: Handles encrypted predictions, result declaration, and reward distribution
2. **Frontend Layer**: User interface for interacting with the smart contract
3. **FHEVM Layer**: Provides encryption/decryption capabilities

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   React UI   │  │  FHEVM SDK   │  │  Ethers.js   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Encrypted Transactions
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Blockchain Layer (FHEVM)                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              ShadeFX Smart Contract                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│   │
│  │  │  Predictions │  │   Results    │  │   Rewards    ││   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Smart Contract Architecture

### Core Components

#### 1. Data Structures

```solidity
struct CurrencyPair {
    string baseCurrency;
    string quoteCurrency;
    bool isActive;
    uint256 predictionDeadline;
    uint256 resultDeadline;
}

struct Prediction {
    euint32 encryptedPrediction;  // FHE encrypted value
    address predictor;
    uint256 timestamp;
    bool isWinner;
    bool rewardClaimed;
}

struct Round {
    uint256 roundId;
    CurrencyPair pair;
    euint32 encryptedRealValue;
    bool resultDeclared;
    uint256 totalPredictions;
    uint256 totalRewardPool;
    mapping(address => Prediction) predictions;
    address[] predictors;
}
```

#### 2. State Management

- **Rounds Mapping**: `mapping(string => Round)` - Stores rounds by currency pair key
- **Active Pairs**: `string[]` - List of active currency pairs
- **Access Control**: Owner-only functions for admin operations

#### 3. Workflow

```
1. Owner creates currency pair round
   └─> Sets prediction deadline and result deadline

2. Users submit encrypted predictions
   └─> Predictions stored as euint32 (FHE encrypted)
   └─> Stake amount added to reward pool

3. Owner declares result
   └─> Real value encrypted and stored
   └─> resultDeclared flag set to true

4. Owner reveals winners
   └─> Winners marked based on encrypted comparison
   └─> isWinner flag set for winners

5. Winners claim rewards
   └─> Reward calculated and distributed
   └─> Fee sent to owner
```

## FHEVM Integration

### Encryption Flow

1. **Frontend**: User enters prediction value
2. **FHEVM SDK**: Encrypts value using FHEVM Relayer
3. **Smart Contract**: Receives encrypted value as `inEuint32`
4. **Storage**: Encrypted value stored as `euint32`

### Decryption Flow

1. **Smart Contract**: Compares encrypted values using `TFHE.eq()`
2. **Owner**: Reveals winners based on comparison results
3. **Frontend**: Winners can view their status and claim rewards

### Key Operations

- **Encryption**: `TFHE.asEuint32(inEuint32)` - Convert external encrypted value to internal
- **Comparison**: `TFHE.eq(euint32, euint32)` - Compare encrypted values
- **Decryption**: Only performed for winners after result declaration

## Frontend Architecture

### Component Structure

```
src/
├── components/
│   └── Header.tsx          # Navigation and wallet connection
├── contexts/
│   └── WalletContext.tsx   # Wallet state management
├── hooks/
│   └── useFHEVM.ts         # FHEVM encryption/decryption
├── pages/
│   ├── Home.tsx            # Landing page
│   ├── Predictions.tsx     # Prediction submission
│   └── Results.tsx         # Results and rewards
└── utils/
    └── contract.ts         # Contract interaction utilities
```

### State Management

- **Wallet Context**: Manages wallet connection and account state
- **FHEVM Hook**: Handles encryption/decryption operations
- **React Query**: Manages server state and caching

### User Flow

```
1. User connects wallet
   └─> WalletContext initializes

2. User navigates to Predictions page
   └─> FHEVM hook initializes
   └─> Currency pairs loaded

3. User submits prediction
   └─> Value encrypted using FHEVM
   └─> Transaction sent to contract
   └─> Prediction stored encrypted

4. User checks results
   └─> Contract queried for winner status
   └─> Reward pool displayed

5. Winner claims reward
   └─> Transaction sent to contract
   └─> Reward distributed
```

## Security Architecture

### Encryption Security

- **FHE Encryption**: All predictions encrypted before submission
- **Private Keys**: Never exposed to frontend or contract
- **Encrypted Storage**: Predictions stored as `euint32` (encrypted)

### Access Control

- **Owner Functions**: Only contract owner can:
  - Create currency pairs
  - Declare results
  - Reveal winners
  - Update settings

- **User Functions**: Any user can:
  - Submit predictions
  - Check winner status
  - Claim rewards (if winner)

### Smart Contract Security

- **Reentrancy Protection**: Secure reward distribution
- **Input Validation**: All inputs validated
- **Deadline Enforcement**: Predictions and results respect deadlines
- **Fee Mechanism**: Configurable fee percentage (max 20%)

## Data Flow

### Prediction Submission

```
User Input → Frontend Validation → FHEVM Encryption → 
Smart Contract → Encrypted Storage → Event Emission
```

### Result Declaration

```
Owner Input → FHEVM Encryption → Smart Contract → 
Encrypted Storage → Result Declared → Event Emission
```

### Winner Reveal

```
Owner Action → Smart Contract → Encrypted Comparison → 
Winner Marking → Event Emission
```

### Reward Claiming

```
Winner Action → Smart Contract → Winner Verification → 
Reward Calculation → Distribution → Event Emission
```

## Scalability Considerations

### Current Limitations

- **Gas Costs**: FHE operations are gas-intensive
- **Storage**: Encrypted values require more storage
- **Network**: Requires FHEVM-compatible network

### Future Improvements

- **Batch Operations**: Batch winner reveals
- **Optimized Storage**: Use compression for encrypted values
- **Layer 2**: Deploy on FHEVM-compatible L2 solutions

## Testing Architecture

### Unit Tests

- **Contract Functions**: Test individual functions
- **Access Control**: Test owner vs user permissions
- **Edge Cases**: Test boundary conditions

### Integration Tests

- **End-to-End Flow**: Test complete prediction flow
- **FHEVM Mocking**: Mock FHEVM operations for testing
- **Event Testing**: Verify event emissions

### Frontend Tests

- **Component Tests**: Test React components
- **Hook Tests**: Test custom hooks
- **Integration Tests**: Test user flows

## Deployment Architecture

### Development

- **Local Network**: Hardhat local node
- **FHEVM Mock**: Mock FHEVM for testing
- **Frontend**: Local development server

### Production

- **Testnet**: Sepolia or FHEVM testnet
- **Contract**: Deployed and verified
- **Frontend**: Hosted on IPFS or traditional hosting
- **FHEVM Relayer**: External relayer service

## Monitoring and Analytics

### Events

- `PredictionSubmitted`: When user submits prediction
- `ResultDeclared`: When owner declares result
- `WinnerRevealed`: When winner is revealed
- `RewardClaimed`: When winner claims reward

### Metrics

- Total predictions per round
- Reward pool size
- Winner count
- Average stake amount

## Future Enhancements

1. **Multi-Round Support**: Support multiple concurrent rounds
2. **Advanced Analytics**: Prediction statistics and trends
3. **Governance**: DAO-based governance for settings
4. **Cross-Chain**: Support for multiple FHEVM networks
5. **Mobile App**: Native mobile application

