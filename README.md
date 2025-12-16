# ShadeFX - Privacy-First Perpetual DEX

ShadeFX is a revolutionary decentralized perpetual futures exchange that combines blockchain technology with Fully Homomorphic Encryption (FHE) to create a truly private and secure trading experience. Built on Ethereum's Sepolia testnet, ShadeFX enables users to trade cryptocurrency pairs with leverage while protecting their trading strategies from front-running and MEV attacks.

## 🎯 Project Overview

ShadeFX enables users to:
- Trade perpetual futures with encrypted trade directions using FHEVM
- Protect trading strategies from front-running and MEV attacks
- Trade with leverage (1x to 5x) on multiple cryptocurrency pairs
- Use market orders for instant execution or limit orders for automated trading
- Hedge positions to manage portfolio risk

## 🔒 Key Features

- **FHE-Encrypted Positions**: Trade directions (Long/Short) are encrypted using Fully Homomorphic Encryption before submission
- **Front-Running Protection**: Your trading strategy remains private until execution
- **MEV Resistance**: Encrypted transactions prevent maximal extractable value attacks
- **Leverage Trading**: Trade with 1x to 5x leverage on multiple cryptocurrency pairs
- **Multiple Trading Pairs**: Support for BTC/USD, ETH/USD, SOL/USD, and more

## 🏗️ Architecture

### Smart Contract
- **ShadeFXPerpDEX.sol**: Main perpetual exchange contract handling encrypted positions, leverage trading, and order management
- Built with Solidity 0.8.27 and FHEVM
- Uses `ebool` for encrypted trade directions (Long/Short) and `euint32` for encrypted leverage
- Implements access control, reentrancy protection, and secure position management
- **ShadeFXPriceOracle.sol**: Separate price oracle contract for price management and pair configuration

### Frontend
- **React + TypeScript**: Modern frontend framework
- **FHEVM Relayer SDK**: For encryption/decryption operations
- **Ethers.js**: For blockchain interactions
- **MetaMask Integration**: Wallet connection and transaction signing

## 📋 Prerequisites

- Node.js 18+ and npm
- MetaMask browser extension
- Hardhat for smart contract development
- FHEVM-compatible network (testnet or local)
- FHEVM Solidity library (`fhevm` package)
- FHEVM JavaScript library (`fhevmjs` package)

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd shadefx
```

### 2. Install Dependencies

#### Backend (Smart Contracts)
```bash
npm install
```

#### Frontend
```bash
cd frontend
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
ETHERSCAN_API_KEY=your_etherscan_api_key
FHEVM_RELAYER_URL=http://localhost:8545
```

For frontend, create a `.env` file in the `frontend` directory:

```env
REACT_APP_CONTRACT_ADDRESS=your_deployed_contract_address
REACT_APP_FHEVM_RELAYER_URL=http://localhost:8545
```

### 4. Compile Smart Contracts

```bash
npm run compile
```

### 5. Run Tests

```bash
npm test
```

### 6. Deploy Contracts

#### Local Network
```bash
npx hardhat node
npm run deploy:localhost
```

#### Sepolia Testnet
```bash
npm run deploy:sepolia
```

### 7. Start Frontend

```bash
cd frontend
npm start
```

The frontend will be available at `http://localhost:3000`

## 📖 Usage

### For Users

1. **Connect Wallet**: Click "Connect Wallet" and approve the connection (or use embedded wallet)
2. **Swap ETH to USDC**: In the Swap section, convert ETH to USDC for trading
3. **Open a Position**: 
   - Select a trading pair (e.g., BTC/USD)
   - Choose Long or Short direction
   - Set collateral amount and leverage (1x-5x)
   - Open your position (direction is encrypted with FHE)
4. **Manage Positions**: View open positions, PnL, and liquidation prices
5. **Close Positions**: Close positions manually or set limit orders for automatic execution

### For Contract Owner

1. **Add Trading Pairs**: Add new cryptocurrency pairs to the exchange
2. **Update Prices**: Keep price oracle updated with current market prices
3. **Manage Fees**: Set opening and closing fees
4. **Emergency Controls**: Pause/unpause contract if needed

## 🧪 Testing

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm run test:coverage
```

## 📁 Project Structure

```
shadefx/
├── contracts/
│   ├── ShadeFXPerpDEX.sol   # Main perpetual exchange contract
│   ├── ShadeFXPriceOracle.sol # Price oracle contract
│   ├── IShadeFXPriceOracle.sol # Price oracle interface
│   └── MockERC20.sol        # Mock ERC20 for testing
├── test/
│   └── ShadeFXPerpDEX.test.ts # FHEVM integration tests
├── scripts/
│   └── deploy.ts            # Deployment script
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── contexts/        # React contexts
│   │   ├── hooks/           # Custom hooks
│   │   ├── pages/           # Page components
│   │   └── utils/           # Utility functions
│   └── public/              # Static assets
├── hardhat.config.ts        # Hardhat configuration
├── package.json             # Dependencies
└── README.md                # This file
```

## 🔐 Security Considerations

- Trade directions are encrypted using FHEVM before submission
- Reentrancy protection on all state-changing functions
- Price oracle validation to prevent manipulation
- Automatic liquidation to protect system solvency
- Access control for admin functions
- Emergency pause functionality
- Safe token operations using SafeERC20

## 📝 Smart Contract Functions

### User Functions
- `createMarketOrder(pairKey, encryptedDirection, encryptedLeverage, ...)`: Open a position with encrypted direction and leverage
- `createLimitOrder(pairKey, encryptedDirection, limitPrice, ...)`: Create a limit order with encrypted direction
- `closePositionWithDirection(positionId, isLong)`: Close a position with decrypted direction
- `cancelOrder(orderId)`: Cancel a pending limit order
- `getUserPositions(user)`: Get all positions for a user
- `getUserPairPositions(pairKey, user)`: Get positions for a specific pair

### Admin Functions
- `setOpeningFeeBP(feeBP)`: Set opening fee in basis points
- `setClosingFeeBP(feeBP)`: Set closing fee in basis points
- `setMaxLeverage(leverage)`: Set maximum leverage
- `pause()` / `unpause()`: Emergency pause functionality

## 🌐 Network Support

ShadeFX requires **FHEVM-compatible networks**. Supported networks:

### Recommended Networks

1. **Fhenix Helium Testnet** (Recommended for FHEVM)
   - Chain ID: 8008135
   - RPC URL: `https://api.helium.fhenix.zone`
   - Explorer: `https://explorer.helium.fhenix.zone`
   - Use Case: FHEVM testing and development
   - Deploy: `npm run deploy:fhenix`

2. **Localhost** (Development)
   - Chain ID: 1337
   - RPC URL: `http://127.0.0.1:8545`
   - Use Case: Local development and testing
   - Deploy: `npm run deploy:localhost`

3. **Sepolia** (Ethereum Testnet)
   - Chain ID: 11155111
   - RPC URL: `https://sepolia.infura.io/v3/YOUR_KEY`
   - Use Case: Standard Ethereum testing
   - Note: May not support FHEVM natively
   - Deploy: `npm run deploy:sepolia`

### Network Configuration

See [NETWORKS.md](./NETWORKS.md) for detailed network configuration and setup instructions.

**Important**: FHEVM requires a compatible network with FHEVM contract deployed at `0x0000000000000000000000000000000000000044`.

## 📚 Documentation

- [Architecture Documentation](./docs/ARCHITECTURE.md)
- [API Documentation](./docs/API.md)
- [FHEVM Integration Guide](./FHEVM_INTEGRATION.md)
- [Network Configuration](./NETWORKS.md)
- [Zama Official Guide](./ZAMA_OFFICIAL_GUIDE.md)

## ⚠️ Important: Check Official Documentation

**Always verify information with Zama's official documentation:**

- **FHEVM Documentation**: https://docs.zama.ai/fhevm
- **FHEVM Hardhat Template**: https://github.com/zama-ai/fhevm-hardhat-template
- **Relayer SDK**: https://github.com/zama-ai/relayer-sdk
- **Zama Community**: https://community.zama.org

Package names, versions, import paths, and network information may change. Always check the official sources.

## 🤝 Contributing

This project is part of the Zama Developer Program. Contributions are welcome!

## 📄 License

BSD-3-Clause-Clear

## 🙏 Acknowledgments

- [Zama](https://www.zama.ai/) for FHEVM technology
- [FHEVM](https://github.com/zama-ai/fhevm) for the FHE virtual machine
- [Hardhat](https://hardhat.org/) for the development framework

## 📞 Support

For questions or issues, please refer to:
- Zama Developer Program: https://docs.zama.org/programs/developer-program
- Zama Discord: #developer-program channel
- GitHub Issues: [Create an issue](https://github.com/your-repo/issues)

---

**Note**: This project is in BETA. Terms and features may change based on feedback.

