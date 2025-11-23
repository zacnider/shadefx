# ShadeFX - Confidential Perpetual DEX

A decentralized perpetual futures exchange built on Ethereum with **Fully Homomorphic Encryption (FHE)** privacy features. ShadeFX enables users to trade perpetual futures with encrypted position data, ensuring complete privacy for trading strategies and positions.

## 🌟 Features

- **Confidential Trading**: Positions, leverage, and stop-loss orders are encrypted using FHEVM (Fully Homomorphic Encryption Virtual Machine)
- **Perpetual Futures**: Trade long/short positions on cryptocurrency pairs with up to 5x leverage
- **Real-time Price Feeds**: Integrated with Pyth Network and Binance API for accurate price updates
- **Limit Orders**: Place limit orders with encrypted direction and price conditions
- **Liquidation System**: Automated liquidation mechanism with maintenance margin requirements
- **Open Interest Tracking**: Real-time tracking of total open interest per pair
- **Modern Frontend**: React-based UI with real-time charts and order book visualization
- **Automated Backend**: Price updater services and limit order executor

## 🏗️ Architecture

The project consists of three main components:

1. **Smart Contracts** (`contracts/`): Solidity contracts deployed on Sepolia testnet
   - `ShadeFXPerpDEX.sol`: Main perpetual DEX contract with FHE privacy
   - `ShadeFXPriceOracle.sol`: Price oracle contract for price feeds
   - `PythPriceConverter.sol`: Pyth Network price converter

2. **Frontend** (`frontend/`): React application with TypeScript
   - Real-time price charts
   - Position management
   - Order book visualization
   - Wallet integration (MetaMask, Privy)

3. **Backend** (`backend/`): Node.js/TypeScript services
   - Binance price updater
   - Pyth Network price updater
   - Limit order executor
   - GraphQL indexer integration

## 🛠️ Technology Stack

### Smart Contracts
- **Solidity** ^0.8.27
- **FHEVM** (Zama Network) for encrypted computations
- **OpenZeppelin** for security patterns
- **Pyth Network** for price feeds
- **Hardhat** for development and deployment

### Frontend
- **React** 18.2
- **TypeScript**
- **Wagmi** & **Viem** for Ethereum interactions
- **RainbowKit** for wallet connection
- **Privy** for authentication
- **TailwindCSS** for styling
- **Lightweight Charts** for price visualization

### Backend
- **Node.js** with **TypeScript**
- **Ethers.js** v6 for blockchain interactions
- **Express** for API server
- **Axios** for HTTP requests
- **PM2** for process management

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 18.x
- **npm** >= 9.x or **yarn**
- **Git**
- **MetaMask** or compatible Web3 wallet
- **Alchemy** or **Infura** account (for RPC endpoint)
- **CoinGecko API** key (optional, for additional price data)
- **Pyth Network** access (for price feeds)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd shadefx
```

### 2. Install Root Dependencies

```bash
npm install
```

### 3. Setup Environment Variables

#### Backend Environment

Create `backend/.env` file:

```bash
cd backend
cp env.example .env
```

Edit `.env` and add your configuration:

```env
# Wallet Configuration
PRIVATE_KEY=your_private_key_here

# Network Configuration
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_alchemy_api_key_here
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_alchemy_api_key_here
CHAIN_ID=11155111

# Contract Addresses
CONTRACT_ADDRESS=0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532
PRICE_ORACLE_CONTRACT_ADDRESS=0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93
PERPDEX_CONTRACT_ADDRESS=0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532

# API Configuration
API_PORT=3002

# CoinGecko API Key (for backend price fetching)
COINGECKO_API_KEY=your_coingecko_api_key_here

# Indexer Configuration
INDEXER_GRAPHQL_URL=http://localhost:8080/v1/graphql
HASURA_ADMIN_SECRET=your_hasura_admin_secret_here

# Update Intervals (in milliseconds)
BINANCE_UPDATE_INTERVAL=30000
PYTH_UPDATE_INTERVAL=30000
LIMIT_ORDER_EXECUTION_INTERVAL=30000

# Logging
LOG_LEVEL=info
```

#### Frontend Environment

Create `frontend/.env` file:

```bash
cd frontend
cp env.example .env
```

Edit `.env` and add your configuration:

```env
# React App Environment Variables
# Note: All React environment variables must start with REACT_APP_

# Network Configuration
REACT_APP_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_alchemy_api_key_here
REACT_APP_CHAIN_ID=11155111

# Contract Addresses
REACT_APP_CONTRACT_ADDRESS=0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532
REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS=0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93

# API Keys
REACT_APP_COINGECKO_API_KEY=your_coingecko_api_key_here
REACT_APP_FXRATES_API_KEY=your_fxrates_api_key_here

# Indexer Configuration
REACT_APP_INDEXER_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

### 4. Compile Smart Contracts

```bash
# From root directory
npm run compile
```

This will:
- Compile Solidity contracts
- Generate TypeScript types in `types/` directory
- Create contract artifacts in `artifacts/`

### 5. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 6. Install Backend Dependencies

```bash
cd backend
npm install
```

## 🏃 Running the Application

### Start Local Hardhat Node (Optional)

For local development:

```bash
npm run chain
```

### Deploy Contracts (Sepolia Testnet)

```bash
# Deploy to Sepolia
npm run deploy:sepolia
```

### Start Backend Services

#### Price Updater Service

```bash
cd backend
npm run start
# or for development with auto-reload
npm run dev
```

#### Limit Order Executor Service

```bash
cd backend
npm run start:executor
# or for development
npm run dev:executor
```

#### Production Mode (with PM2)

```bash
cd backend
npm run build
pm2 start ecosystem.config.js
```

### Start Frontend

```bash
cd frontend
npm start
```

The frontend will be available at `http://localhost:3000`

## 📝 Available Scripts

### Root Directory

```bash
# Compile contracts
npm run compile

# Run tests
npm test

# Deploy to Sepolia
npm run deploy:sepolia

# Add currency pair
npm run add-pair

# Update prices from Pyth
npm run update-prices

# Type checking and linting
npm run lint
npm run prettier:check
```

### Backend Scripts

```bash
# Start price updater
npm run start

# Start limit order executor
npm run start:executor

# Build TypeScript
npm run build

# Development mode with auto-reload
npm run dev
npm run dev:executor
```

### Frontend Scripts

```bash
# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test
```

## 🔐 Security Considerations

### Environment Variables

⚠️ **Never commit `.env` files to version control!**

- All sensitive keys are stored in `.env` files
- `.env` files are already in `.gitignore`
- Use `.env.example` files as templates

### Private Keys

- Use a dedicated wallet for backend services
- Never use your main wallet's private key
- Consider using hardware wallets for production

### API Keys

- Rotate API keys regularly
- Use separate keys for development and production
- Monitor API usage to detect unauthorized access

## 🧪 Testing

### Run Contract Tests

```bash
npm test
```

### Run Tests on Sepolia

```bash
npm run test:sepolia
```

### Coverage Report

```bash
npm run coverage
```

## 📦 Deployment

### Contract Deployment

1. Ensure you have Sepolia ETH in your wallet
2. Set up environment variables in `backend/.env`
3. Deploy contracts:

```bash
npm run deploy:sepolia
```

4. Verify contracts on Etherscan:

```bash
npm run verify:sepolia
```

### Frontend Deployment

Build the frontend:

```bash
cd frontend
npm run build
```

Deploy the `build/` directory to your hosting service (Vercel, Netlify, etc.)

### Backend Deployment

1. Build the backend:

```bash
cd backend
npm run build
```

2. Use PM2 for production:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🏛️ Contract Architecture

### Main Contracts

- **ShadeFXPerpDEX**: Main perpetual DEX contract
  - Position management (open/close)
  - Encrypted position data (FHE)
  - Leverage (1-5x)
  - Liquidation system
  - Limit orders

- **ShadeFXPriceOracle**: Price oracle contract
  - Price updates from Pyth Network
  - Price deviation checks
  - Price staleness validation

- **PythPriceConverter**: Pyth Network integration
  - Price feed conversion
  - Price ID mapping

### Key Features

- **Encrypted Positions**: Position direction, leverage, and stop-loss are encrypted using FHEVM
- **Leverage**: Up to 5x leverage (configurable)
- **Maintenance Margin**: 20% maintenance margin requirement
- **Liquidation Bonus**: 5% bonus for liquidators
- **Price Precision**: 8 decimal places (1e8)
- **Max Price Deviation**: 5% maximum deviation from oracle price

## 🔄 Price Update System

The system supports multiple price feed sources:

1. **Pyth Network**: Primary price feed (recommended)
2. **Binance API**: Secondary price feed
3. **CoinGecko API**: Fallback price feed

Backend services automatically update prices every 30 seconds.

## 📊 Indexer Integration

The project includes a GraphQL indexer (Envio) for querying on-chain events:

- Position opened/closed events
- Order created/executed/cancelled events
- Price update events
- Pair addition events

Set up the indexer separately and configure `INDEXER_GRAPHQL_URL` in your environment variables.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use Prettier for code formatting
- Follow ESLint rules
- Write tests for new features
- Update documentation as needed

## 📄 License

This project is licensed under the **BSD-3-Clause-Clear** License.

## 🔗 Links

- **Zama Network**: https://www.zama.ai/
- **FHEVM Documentation**: https://docs.zama.ai/fhevm
- **Pyth Network**: https://pyth.network/
- **Hardhat**: https://hardhat.org/

## ⚠️ Disclaimer

This is experimental software. Use at your own risk. The contracts are deployed on Sepolia testnet for testing purposes only.

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check the documentation in `docs/` directory
- Review contract comments in `contracts/` directory

---

**Built with ❤️ using FHEVM and Zama Network**

