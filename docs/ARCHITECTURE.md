# ShadeFX Architecture Documentation

## Overview

ShadeFX is built on a decentralized architecture using FHEVM (Fully Homomorphic Encryption Virtual Machine) to enable private perpetual futures trading. The system consists of three main components:

1. **Smart Contract Layer**: Handles encrypted positions, leverage trading, and order management
2. **Frontend Layer**: User interface for trading and portfolio management
3. **FHEVM Layer**: Provides encryption/decryption capabilities for trade directions

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
│  │         ShadeFXPerpDEX Smart Contract                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│   │
│  │  │  Positions   │  │    Orders    │  │   Liquidity  ││   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘│   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │      ShadeFXPriceOracle Contract                       │   │
│  │  ┌──────────────┐  ┌──────────────┐                   │   │
│  │  │ Price Feeds  │  │ Pair Config  │                   │   │
│  │  └──────────────┘  └──────────────┘                   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Smart Contract Architecture

### Core Components

#### 1. Data Structures

```solidity
struct Position {
    uint256 positionId;
    address trader;
    string pairKey;
    ebool encryptedDirection;      // FHE encrypted: true = Long, false = Short
    euint32 encryptedLeverage;     // FHE encrypted leverage (1-5x)
    euint64 encryptedStopLoss;     // FHE encrypted stop loss price
    uint256 entryPrice;
    uint256 size;
    uint256 collateral;
    uint256 leverage;
    uint256 timestamp;
    bool isOpen;
    uint256 liquidationPrice;
}

struct Order {
    uint256 orderId;
    address trader;
    string pairKey;
    OrderType orderType;           // MARKET or LIMIT
    OrderStatus status;            // PENDING, EXECUTED, CANCELLED, EXPIRED
    ebool encryptedDirection;      // FHE encrypted direction
    uint256 limitPrice;
    uint256 collateralAmount;
    uint256 leverage;
    uint256 timestamp;
    uint256 expiryTime;
}
```

#### 2. State Management

- **Positions Mapping**: `mapping(uint256 => Position)` - Stores positions by ID
- **User Positions**: `mapping(address => uint256[])` - User's position IDs
- **Orders Mapping**: `mapping(uint256 => Order)` - Stores orders by ID
- **Liquidity Pool**: Manages available liquidity for trading
- **Access Control**: Owner-only functions for admin operations

#### 3. Workflow

```
1. User selects trading pair and direction
   └─> Direction encrypted with FHE on client side
   └─> Encrypted transaction sent to contract

2. Contract receives encrypted direction
   └─> Validates collateral and leverage
   └─> Opens position with encrypted direction
   └─> Makes direction publicly decryptable (for open interest tracking)

3. Position management
   └─> User can close position manually
   └─> System can liquidate undercollateralized positions
   └─> PnL calculated based on price movements

4. Limit orders
   └─> User creates limit order with encrypted direction
   └─> Order executes automatically when price condition met
   └─> Position opened with same encrypted direction
```

## FHEVM Integration

### Encryption Flow

1. **Frontend**: User selects Long or Short direction
2. **FHEVM SDK**: Encrypts direction as `ebool` using Relayer SDK
3. **Smart Contract**: Receives encrypted direction as `externalEbool`
4. **Storage**: Encrypted direction stored as `ebool` in position

### Decryption Flow

1. **Position Opening**: Direction made publicly decryptable for open interest tracking
2. **Frontend**: Can decrypt direction after position is opened
3. **Liquidation**: System can decrypt direction for liquidation logic

### Key Operations

- **Encryption**: `FHE.fromExternal(externalEbool, inputProof)` - Convert external encrypted value to internal
- **Permission**: `FHE.allowThis(ebool)` - Allow contract to decrypt
- **Public Decryption**: `FHE.makePubliclyDecryptable(ebool)` - Make value publicly decryptable

## Frontend Architecture

### Component Structure

```
src/
├── components/
│   ├── PositionOpening.tsx    # Open new positions
│   ├── OpenPositions.tsx      # View and manage positions
│   ├── Orders.tsx             # Limit orders management
│   ├── PriceChart.tsx         # TradingView-style charts
│   └── OrderBook.tsx          # Order book visualization
├── contexts/
│   └── WalletContext.tsx      # Wallet state management
├── hooks/
│   ├── useFHEVM.ts           # FHEVM encryption/decryption
│   └── useIntentExecutor.ts  # Intent-based trading
├── pages/
│   ├── Home.tsx              # Landing page
│   ├── Predictions.tsx       # Trading interface
│   ├── Portfolio.tsx         # Portfolio management
│   └── Leaderboard.tsx       # Trading leaderboard
└── utils/
    ├── contract.ts           # Contract interaction utilities
    ├── priceApi.ts           # Price feed integration
    └── fhevm.ts              # FHEVM utilities
```

### State Management

- **Wallet Context**: Manages wallet connection and account state
- **FHEVM Hook**: Handles encryption/decryption operations
- **React Query**: Manages server state and caching
- **GraphQL**: Envio indexer for efficient blockchain queries

### User Flow

```
1. User connects wallet (or uses embedded wallet)
   └─> WalletContext initializes
   └─> FHEVM hook initializes

2. User navigates to Trading page
   └─> Trading pairs loaded from indexer
   └─> Real-time price feeds connected

3. User opens position
   └─> Direction encrypted using FHEVM
   └─> Transaction sent to contract
   └─> Position stored with encrypted direction

4. User manages positions
   └─> View open positions and PnL
   └─> Close positions manually
   └─> Set limit orders

5. System manages positions
   └─> Automatic liquidation for undercollateralized positions
   └─> Limit order execution when price conditions met
```

## Security Architecture

### Encryption Security

- **FHE Encryption**: Trade directions encrypted before submission
- **Private Keys**: Never exposed to frontend or contract
- **Encrypted Storage**: Directions stored as `ebool` (encrypted)
- **Public Decryption**: Directions become publicly decryptable after opening (for transparency and liquidation)

### Access Control

- **Owner Functions**: Only contract owner can:
  - Add trading pairs
  - Update price oracle
  - Set fees
  - Pause/unpause contract

- **User Functions**: Any user can:
  - Open positions
  - Close positions
  - Create limit orders
  - Cancel orders

### Smart Contract Security

- **Reentrancy Protection**: All state-changing functions protected
- **Input Validation**: All inputs validated
- **Price Validation**: Staleness and deviation checks
- **Liquidation System**: Automatic liquidation for undercollateralized positions
- **Safe Token Operations**: SafeERC20 for all token transfers

## Data Flow

### Position Opening

```
User Input → Frontend Validation → FHEVM Encryption → 
Smart Contract → Encrypted Storage → Position Opened → Event Emission
```

### Position Closing

```
User Action → Smart Contract → Direction Decryption → 
PnL Calculation → Collateral Return → Position Closed → Event Emission
```

### Limit Order Execution

```
Price Update → Keeper/Backend → Check Limit Orders → 
Price Condition Met → Execute Order → Position Opened → Event Emission
```

### Liquidation

```
Price Update → Check Positions → Calculate Margin → 
Undercollateralized → Liquidate Position → Event Emission
```

## Scalability Considerations

### Current Limitations

- **Gas Costs**: FHE operations are gas-intensive
- **Storage**: Encrypted values require more storage
- **Network**: Requires FHEVM-compatible network (Sepolia with Zama Gateway)

### Future Improvements

- **Batch Operations**: Batch limit order execution
- **Optimized Storage**: Use compression for encrypted values
- **Layer 2**: Deploy on FHEVM-compatible L2 solutions
- **Cross-Chain**: Support for multiple FHEVM networks

## Testing Architecture

### Unit Tests

- **Contract Functions**: Test individual functions
- **Access Control**: Test owner vs user permissions
- **Edge Cases**: Test boundary conditions
- **FHEVM Operations**: Test encryption/decryption flows

### Integration Tests

- **End-to-End Flow**: Test complete trading flow
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

- **Testnet**: Ethereum Sepolia with Zama Gateway
- **Contract**: Deployed and verified
- **Frontend**: Hosted on Vercel/Netlify
- **FHEVM Relayer**: Zama Gateway service
- **Indexer**: Envio GraphQL indexer

## Monitoring and Analytics

### Events

- `PositionOpened`: When user opens a position
- `PositionClosed`: When position is closed
- `OrderCreated`: When limit order is created
- `OrderExecuted`: When limit order executes
- `PositionLiquidated`: When position is liquidated

### Metrics

- Total open positions
- Total open interest (long/short)
- Trading volume
- Liquidation events
- Average position size

## Future Enhancements

1. **Advanced Order Types**: Stop-loss, take-profit orders
2. **Cross-Margin**: Shared margin across positions
3. **Governance**: DAO-based governance for settings
4. **Mobile App**: Native mobile application
5. **Social Trading**: Copy trading features
