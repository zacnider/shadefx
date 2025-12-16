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

### 8. Connect Wallet

1. Open `http://localhost:3000` in your browser
2. Click "Connect Wallet" and select:
   - **MetaMask**: For external wallet connection
   - **Email**: For embedded wallet (automatic wallet creation)
3. If using MetaMask with localhost:
   - Add Hardhat network to MetaMask:
     * **Network Name**: Hardhat Local
     * **RPC URL**: `http://127.0.0.1:8545`
     * **Chain ID**: `31337`
     * **Currency Symbol**: `ETH`
4. For Sepolia testnet:
   - Ensure you're on Sepolia network
   - Get test ETH and USDC from faucets

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

### Quick Start

Run all tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run coverage
```

### Test Overview

ShadeFX includes comprehensive FHEVM integration tests:

- **FHEVM Integration Tests**: Tests encrypted position opening (Long/Short) with encrypted leverage
- **Market Order Tests**: Tests immediate execution with FHEVM encryption
- **Limit Order Tests**: Tests limit orders with encrypted directions
- **Position Management**: Tests position closing, PnL calculation, and liquidation
- **Admin Functions**: Tests fee setting, leverage limits, and pause functionality

### Understanding FHEVM Tests

Tests use Hardhat's FHEVM mock environment, which simulates FHEVM operations without requiring a real FHEVM network.

**Example test flow:**
1. User encrypts direction (Long/Short) and leverage using FHEVM
2. Encrypted values are sent to the contract
3. Contract processes encrypted values using FHEVM functions
4. Position is created successfully

**Run specific tests:**
```bash
# Run only FHEVM encryption tests
npm test -- --grep "FHEVM Encryption"

# Run only market order tests
npm test -- --grep "Market Orders"
```

### Detailed Testing Guide

For detailed testing instructions, see [TESTING.md](./TESTING.md).

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

## 🔒 FHEVM Integration Status

**✅ FHEVM is fully integrated and operational in this project.**

### Smart Contract Integration
- **Fully Implemented**: All FHEVM functions are actively used:
  - `FHE.fromExternal()` - Converts external encrypted values to internal encrypted types
  - `FHE.allowThis()` - Allows contract to decrypt values
  - `FHE.allow()` - Allows specific addresses to decrypt values
  - `FHE.makePubliclyDecryptable()` - Makes values publicly decryptable (used after position opening)
- **Encrypted Types Used**:
  - `ebool` - Encrypted boolean for trade directions (Long/Short)
  - `euint32` - Encrypted 32-bit integer for leverage
  - `euint64` - Encrypted 64-bit integer for stop loss
  - `externalEbool`, `externalEuint32`, `externalEuint64` - External encrypted types for function parameters

### Frontend Integration
- **Fully Implemented**: Encryption operations are fully functional:
  - `encryptBool()` - Encrypts boolean values (trade directions)
  - `encrypt()` / `encrypt32()` - Encrypts numeric values (leverage)
  - Uses `@zama-fhe/relayer-sdk` for all encryption operations
  - Connects to Zama Gateway via relayer for FHE operations

### How It Works
1. **User selects trade direction** (Long/Short) and leverage in the frontend
2. **Frontend encrypts** the direction and leverage using FHEVM Relayer SDK
3. **Encrypted values are sent** to the smart contract as `externalEbool` and `externalEuint32`
4. **Contract processes** encrypted values using FHEVM library functions
5. **After position opening**, values are made publicly decryptable for transparency and liquidation purposes

**Note**: The `decrypt()` function in the frontend is not used because the contract uses `makePubliclyDecryptable()` to handle decryption on-chain. This is the correct approach for this use case.

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

ShadeFX is deployed on **Sepolia Testnet** with FHEVM support. Supported networks:

### Production Network

1. **Sepolia Testnet** (Primary Network)
   - Chain ID: 11155111
   - RPC URL: `https://sepolia.infura.io/v3/YOUR_KEY`
   - Explorer: `https://sepolia.etherscan.io`
   - Use Case: Production deployment with FHEVM support
   - Deploy: `npm run deploy:sepolia`

### Development Network

2. **Localhost** (Development)
   - Chain ID: 1337
   - RPC URL: `http://127.0.0.1:8545`
   - Use Case: Local development and testing
   - Deploy: `npm run deploy:localhost`

### Network Configuration

See [NETWORKS.md](./NETWORKS.md) for detailed network configuration and setup instructions.

**Important**: ShadeFX is deployed on Sepolia testnet with FHEVM support. FHEVM contract is deployed at `0x0000000000000000000000000000000000000044`.

## 📚 Documentation

- [Architecture Documentation](./docs/ARCHITECTURE.md)
- [API Documentation](./docs/API.md)
- [FHEVM Integration Guide](./FHEVM_INTEGRATION.md)
- [Testing Guide](./TESTING.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Network Configuration](./NETWORKS.md)
- [Zama FHE Usage](./ZAMA_FHE_USAGE.md)
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

This project is licensed under the **BSD-3-Clause-Clear License**. See the [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- [Zama](https://www.zama.ai/) for FHEVM technology
- [FHEVM](https://github.com/zama-ai/fhevm) for the FHE virtual machine
- [Hardhat](https://hardhat.org/) for the development framework

## 🔧 Troubleshooting

### Common Issues

#### FHEVM Not Initialized

**Problem**: FHEVM hook shows "FHEVM is initializing..." and never completes.

**Solutions**:
1. Check that you're connected to Sepolia testnet
2. Ensure wallet is connected (MetaMask or embedded wallet)
3. Refresh the page
4. Check browser console for errors
5. Verify Zama Gateway is accessible

#### Transaction Fails with "Insufficient USDC"

**Problem**: Transaction fails even though you have USDC.

**Solutions**:
1. Check USDC balance (must be at least 5 USDC)
2. Ensure USDC is approved for contract spending
3. Try approving USDC again
4. Check that you're using Sepolia USDC (not mainnet)

#### Position Not Opening

**Problem**: Click "Open Position" but nothing happens.

**Solutions**:
1. Wait for FHEVM to initialize (check status indicator)
2. Ensure all fields are filled (direction, leverage, collateral)
3. Check browser console for errors
4. Verify wallet is connected
5. Check network connection

#### Price Not Updating

**Problem**: Price feed shows stale data.

**Solutions**:
1. Refresh the page
2. Check backend service is running
3. Verify price oracle contract is updated
4. Check network connection

#### MetaMask Connection Issues

**Problem**: MetaMask doesn't connect or shows errors.

**Solutions**:
1. Clear MetaMask cache: Settings → Advanced → Reset Account
2. Add Sepolia network manually if needed
3. Ensure MetaMask extension is enabled
4. Try disconnecting and reconnecting
5. Restart browser if issues persist

#### Embedded Wallet Not Working

**Problem**: Embedded wallet (Privy) doesn't create wallet.

**Solutions**:
1. Check email verification
2. Clear browser cache and cookies
3. Try incognito mode
4. Check Privy configuration
5. Verify network connection

### Getting Help

If you encounter issues not listed here:

1. **Check Documentation**: Review [FHEVM_INTEGRATION.md](./FHEVM_INTEGRATION.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
2. **GitHub Issues**: Open an issue on GitHub with:
   - Error messages
   - Steps to reproduce
   - Browser/OS information
   - Console logs
3. **Zama Discord**: Ask in #developer-program channel
4. **Email**: Contact project maintainers

## 📞 Support

For questions or issues, please refer to:
- **Live Demo**: https://shadefx.cc
- **Zama Developer Program**: https://docs.zama.org/programs/developer-program
- **Zama Discord**: #developer-program channel
- **GitHub Issues**: [Create an issue](https://github.com/your-repo/issues)

---

**Note**: This project is in BETA. Terms and features may change based on feedback.

