# ShadeFX - Confidential Perpetual DEX

## Project Description

ShadeFX is a revolutionary decentralized perpetual futures exchange that combines blockchain technology with Fully Homomorphic Encryption (FHE) to create a truly private and secure trading experience. Built on Ethereum's Sepolia testnet, ShadeFX enables users to trade cryptocurrency pairs with leverage while protecting their trading strategies from front-running and MEV attacks.

## 🎯 What is ShadeFX?

ShadeFX is a next-generation perpetual exchange that addresses one of the biggest challenges in DeFi: front-running and MEV (Maximal Extractable Value) attacks. By leveraging Zama's Fully Homomorphic Encryption Virtual Machine (FHEVM), ShadeFX encrypts trade directions (long/short) before they reach the blockchain, ensuring that trading strategies remain completely private until positions are executed.

### Key Innovation

Unlike traditional DEXs where trade intentions are visible in the mempool, ShadeFX uses FHE to encrypt trade directions on the client side. This encrypted data can be processed by smart contracts without revealing the actual direction, preventing miners, validators, and front-runners from seeing or copying trading strategies.

## 🔒 Core Features

### Privacy-First Trading
- **FHE-Encrypted Positions**: Trade directions are encrypted using Fully Homomorphic Encryption before submission
- **Front-Running Protection**: Your trading strategy remains private until execution
- **MEV Resistance**: Encrypted transactions prevent maximal extractable value attacks

### Advanced Trading Capabilities
- **Leverage Trading**: Trade with 1x to 5x leverage on multiple cryptocurrency pairs
- **Multiple Trading Pairs**: Support for BTC/USD, ETH/USD, SOL/USD, and more
- **Market Orders**: Instant execution at current market prices
- **Limit Orders**: Set target prices for automatic execution with optional expiry times
- **Hedge Positions**: One-click hedging to protect your portfolio from adverse movements

### Professional Trading Interface
- **Real-Time Charts**: Professional TradingView-style candlestick charts with multiple timeframes
- **Technical Indicators**: SMA, EMA, RSI calculations and visualizations
- **Order Book**: Real-time bid/ask depth visualization
- **Price Ticker**: Live price updates with 24-hour change tracking
- **AI-Powered Analysis**: Automated market analysis with trend detection, support/resistance levels, and trading recommendations

### User Experience
- **Embedded Wallet**: No MetaMask required - automatic wallet creation via Privy
- **Responsive Design**: Fully optimized for desktop, tablet, and mobile devices
- **Portfolio Tracking**: Comprehensive dashboard with PnL, win rate, and performance metrics
- **Position Management**: Real-time position tracking with liquidation price monitoring
- **Order History**: Complete history of all trades and orders

## 🏗️ Technology Stack

### Frontend
- **React 18** with TypeScript for type-safe development
- **Tailwind CSS** for modern, responsive styling
- **Lightweight Charts** for professional charting
- **Privy** for embedded wallet authentication
- **Wagmi & Viem** for Ethereum interactions
- **React Query** for efficient data management
- **FHEVM Relayer SDK** for encryption operations

### Smart Contracts
- **Solidity 0.8.27** for contract development
- **FHEVM** for fully homomorphic encryption
- **OpenZeppelin** for security patterns (ReentrancyGuard, Pausable, Ownable)
- **SafeERC20** for secure token transfers

### Backend Services
- **Node.js** with TypeScript
- **Express** for API server
- **PM2** for process management
- **Binance API** integration for real-time price feeds
- **CoinGecko API** as fallback price source

### Infrastructure
- **Envio GraphQL Indexer** for efficient blockchain data querying
- **Hasura** for GraphQL API
- **Nginx** as reverse proxy with SSL
- **Ubuntu Server** for production deployment

## 📊 Architecture Overview

### Smart Contract Layer
- **ShadeFXPerpDEX.sol**: Core perpetual exchange contract managing positions, leverage, and fees
- **ShadeFXPriceOracle.sol**: On-chain price oracle with validation and staleness checks
- **IShadeFXPriceOracle.sol**: Interface for price oracle interactions

### Data Flow
1. User selects trading pair and direction (encrypted with FHE)
2. Encrypted transaction sent to smart contract
3. Contract validates and opens position
4. Envio indexer indexes blockchain events
5. Frontend updates with real-time position data
6. Backend services continuously update price oracle

### Security Features
- **Reentrancy Protection**: OpenZeppelin's ReentrancyGuard
- **Pausable Contract**: Emergency pause functionality
- **Price Validation**: Staleness and deviation checks
- **Liquidation System**: Automatic liquidation for undercollateralized positions
- **Maintenance Margin**: 20% maintenance margin requirement
- **Safe Token Operations**: SafeERC20 for all token transfers

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- MetaMask or embedded wallet (via Privy)
- Access to Ethereum Sepolia testnet
- Test ETH and USDC for trading

### Quick Start
1. Visit https://shadefx.cc
2. Connect your wallet (or use embedded wallet)
3. Swap ETH to USDC in the Swap section
4. Select a trading pair (e.g., BTC/USD)
5. Choose Long or Short direction
6. Set collateral amount and leverage
7. Open your position

## 💼 Use Cases

### For Traders
- **Privacy-Conscious Trading**: Protect your strategies from front-running
- **Leverage Trading**: Amplify your positions with up to 5x leverage
- **Automated Trading**: Set limit orders and let the system execute automatically
- **Portfolio Hedging**: Quickly hedge positions to manage risk

### For Developers
- **FHE Integration**: Learn how to integrate Fully Homomorphic Encryption in DeFi
- **Smart Contract Patterns**: Study security best practices and architecture
- **Real-Time Data**: Understand WebSocket integration and price feed management
- **Indexer Usage**: Learn GraphQL indexing for efficient blockchain queries

## 🔐 Security & Privacy

### Encryption
- Trade directions encrypted with FHE before blockchain submission
- Encryption keys managed securely via FHEVM Relayer SDK
- Public decryption only after position execution (for transparency)

### Smart Contract Security
- Comprehensive access control (owner-only functions)
- Reentrancy protection on all state-changing functions
- Price oracle validation to prevent manipulation
- Automatic liquidation to protect system solvency

### Infrastructure Security
- SSL/TLS encryption for all communications
- Secure environment variable management
- Rate limiting on API endpoints
- CORS policies properly configured

## 📈 Current Status

- **Network**: Ethereum Sepolia Testnet
- **Status**: Active and fully functional
- **Trading Pairs**: BTC/USD, ETH/USD, SOL/USD, and more
- **Leverage**: 1x to 5x
- **Minimum Collateral**: 5 USDC

## 🗺️ Roadmap

### Short Term
- Additional trading pairs
- Enhanced charting features
- Mobile app development
- Advanced order types (stop-loss, take-profit)

### Long Term
- Liquidity pool for fee sharing
- Cross-chain support
- Governance token
- Social trading features
- Advanced analytics dashboard

## 🤝 Contributing

We welcome contributions! Areas where we need help:
- Additional trading pairs
- UI/UX improvements
- Security audits
- Documentation
- Testing

## 📝 License

[Specify your license here]

## 🔗 Links

- **Website**: https://shadefx.cc
- **Documentation**: [Add docs link]
- **GitHub**: [Add GitHub link]
- **Twitter**: [Add Twitter link]
- **Discord**: [Add Discord link]

## 🙏 Acknowledgments

- **Zama** for FHEVM and Fully Homomorphic Encryption technology
- **Binance** for price feed APIs
- **OpenZeppelin** for security patterns
- **Envio** for blockchain indexing solutions

---

## 📄 Short Description (For GitHub/Portfolio)

**ShadeFX** is a privacy-first decentralized perpetual exchange that uses Fully Homomorphic Encryption (FHE) via Zama's FHEVM to protect trading strategies from front-running and MEV attacks. Built on Ethereum Sepolia testnet, it enables leverage trading (1x-5x) on multiple cryptocurrency pairs (BTC/USD, ETH/USD, SOL/USD, etc.) with real-time TradingView-style charts, technical indicators, limit orders with automatic execution, AI-powered market analysis, and comprehensive portfolio tracking. The platform features an embedded wallet system via Privy that requires only email authentication (no MetaMask needed), automatically creates wallets on first login, and provides seamless transaction experience with auto-signed transactions for embedded wallets, real-time confirmation tracking with toast notifications, automatic receipt verification (60s timeout), and clear success/error feedback for all operations including position opening/closing, limit order placement, and hedging. The tech stack includes React 18 with TypeScript, Solidity 0.8.27 with FHEVM, Node.js backend services, Envio GraphQL indexer, and modern Web3 libraries (Wagmi, Viem) for Ethereum interactions. **Live Demo**: https://shadefx.cc

---

## 📱 Ultra-Short Description (For Social Media/Bio)

**ShadeFX** - Privacy-first perpetual DEX with FHE encryption. Trade with 1x-5x leverage on Sepolia. Embedded wallet (email login, no MetaMask), auto-signed transactions, real-time charts, limit orders, AI analysis. https://shadefx.cc

---

## 🔑 Wallet & Transaction Details

### Wallet Connection
- **Method**: Email-based authentication via Privy
- **Wallet Type**: Embedded smart wallet (automatically created)
- **No MetaMask Required**: Works with just email login
- **Network**: Ethereum Sepolia (auto-switches if needed)
- **First Time**: Wallet created automatically on first login

### Transaction Process
1. **User Action**: Click to open/close position or execute order
2. **Encryption**: Trade direction encrypted with FHE on client side
3. **Transaction Signing**: 
   - Embedded wallet: Auto-signed (no popup)
   - External wallet: Requires manual approval
4. **Submission**: Transaction sent to blockchain
5. **Confirmation**: 
   - Real-time status updates via toast notifications
   - Automatic receipt waiting (60s timeout)
   - Success/error feedback displayed
6. **UI Update**: Position/order data refreshed automatically

### Transaction Notifications
- **Pending**: "Transaction submitted, waiting for confirmation..."
- **Success**: "Position opened successfully!" / "Position closed successfully!"
- **Error**: Clear error messages with retry suggestions
- **Timeout**: Automatic fallback with receipt checking

---

**Built with ❤️ for the DeFi community**

*ShadeFX - Where Privacy Meets Trading*
