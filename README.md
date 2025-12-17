# ShadeFX - Privacy-First Perpetual DEX

ShadeFX is a revolutionary decentralized perpetual futures exchange that combines blockchain technology with Fully Homomorphic Encryption (FHE) to create a truly private and secure trading experience. Built on Ethereum's Sepolia testnet, ShadeFX enables users to trade cryptocurrency pairs with leverage while protecting their trading strategies from front-running and MEV attacks.

**🚀 No Wallet Extension Needed!** ShadeFX uses Privy for email login with embedded wallets - just enter your email and start trading!

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
- **Privy Authentication**: Email login with embedded wallets (no MetaMask needed!)
- **FHEVM Relayer SDK**: For encryption/decryption operations
- **Ethers.js**: For blockchain interactions
- **Wagmi + Viem**: For Ethereum interactions
- **Embedded Wallet**: Privy-managed wallet that works seamlessly with FHEVM

## 📋 Prerequisites

- Node.js 18+ and npm
- **No wallet extension needed!** ShadeFX uses Privy for email login with embedded wallets
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

ShadeFX uses **Privy** for wallet authentication, which supports **email login with embedded wallets**. This means you don't need MetaMask or any external wallet to get started!

1. Open `http://localhost:3000` in your browser
2. Click **"Connect Wallet"** button
3. **Privy Modal** will open with login options:
   - **Email Login** (Recommended): 
     - Enter your email address
     - Verify email with code sent to your inbox
     - Privy automatically creates an **embedded wallet** for you
     - No MetaMask or external wallet needed!
   - **Wallet Login** (Optional):
     - Connect MetaMask or other external wallets
     - Only available if you have a wallet extension installed
4. After login:
   - Your embedded wallet is automatically created
   - You're connected to Sepolia testnet
   - You can start trading immediately
5. For Sepolia testnet:
   - Get test ETH from [Sepolia Faucet](https://sepoliafaucet.com/)
   - Get test USDC from [USDC Faucet](https://faucet.circle.com/) (if available)
   - Or swap ETH to USDC in the Swap section

**Note**: The embedded wallet is managed by Privy and works seamlessly with FHEVM encryption. All transactions are automatically signed without popups for better UX.

## 📖 Usage

### For Users

1. **Connect Wallet**: 
   - Click **"Connect Wallet"** button
   - **Privy modal** opens - choose **Email Login**
   - Enter your email and verify with code
   - Privy automatically creates an **embedded wallet** for you
   - No MetaMask needed! The embedded wallet works seamlessly with FHEVM
2. **Swap ETH to USDC**: In the Swap section, convert ETH to USDC for trading
3. **Open a Position**: 
   - Select a trading pair (e.g., BTC/USD)
   - Choose Long or Short direction
   - Set collateral amount and leverage (1x-5x)
   - Open your position (direction is encrypted with FHE)
4. **Manage Positions**: View open positions, PnL, and liquidation prices
5. **Close Positions**: Close positions manually or set limit orders for automatic execution

**Wallet Features:**
- ✅ **Email Login**: No wallet extension needed
- ✅ **Embedded Wallet**: Automatically created and managed by Privy
- ✅ **Auto-Sign**: Transactions are automatically signed (no popups)
- ✅ **FHEVM Compatible**: Works seamlessly with FHE encryption
- ✅ **Sepolia Ready**: Automatically connected to Sepolia testnet

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
- [Privacy Story](./PRIVACY_STORY.md) - **NEW**: Detailed explanation of our privacy model
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

#### Privy Email Login Issues

**Problem**: Email login doesn't work or embedded wallet isn't created.

**Solutions**:
1. **Check Email Verification**: 
   - Make sure you received the verification code
   - Check spam folder if code doesn't arrive
   - Request a new code if expired
2. **Clear Browser Cache**: 
   - Clear cookies and cache for shadefx.cc
   - Try incognito mode
3. **Check Privy Status**: 
   - Visit [Privy Status Page](https://status.privy.io/)
   - Ensure Privy service is operational
4. **Network Issues**: 
   - Check internet connection
   - Try refreshing the page
   - Wait a few seconds and try again
5. **Browser Compatibility**: 
   - Use Chrome, Firefox, or Edge (latest versions)
   - Disable ad blockers temporarily

#### Embedded Wallet Not Created

**Problem**: Email login succeeds but embedded wallet isn't created.

**Solutions**:
1. Wait a few seconds - wallet creation may take 2-3 seconds
2. Refresh the page after login
3. Check browser console for errors
4. Try logging out and logging in again
5. Clear browser cache and cookies

#### External Wallet Connection (Optional)

**Problem**: Want to use MetaMask instead of email login.

**Solutions**:
1. Install MetaMask browser extension
2. Click "Connect Wallet" → Privy modal opens
3. Select "Connect Wallet" option in Privy modal
4. Choose MetaMask from the list
5. Approve connection in MetaMask popup

**Note**: Email login with embedded wallet is recommended for better UX and FHEVM compatibility.

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

