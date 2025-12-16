# ShadeFX PerpDEX Deployment Guide

## 🚀 Deployment Guide

This guide contains all the steps required to deploy ShadeFX PerpDEX contracts.

## 📋 Prerequisites

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file:

```env
# Private key for deployment (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key

# Etherscan API Key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key

# Optional: Mnemonic for hardhat network
MNEMONIC=test test test test test test test test test test test junk
```

### 3. Compile Contracts

```bash
npm run compile
```

This command:
- Compiles the contracts
- Generates TypeChain types
- Creates artifacts

## 🧪 Testing

### Test on Localhost

```bash
# Terminal 1: Start Hardhat node
npm run chain

# Terminal 2: Run tests
npm test
```

### Test on Sepolia

```bash
npm run test:sepolia
```

## 📦 Deployment Operations

### Overview

ShadeFX PerpDEX consists of two contracts that must be deployed in order:

1. **ShadeFXPriceOracle** - Price management and pair configuration
2. **ShadeFXPerpDEX** - Position, order, and liquidity management

**Important:** The Price Oracle must be deployed first, as PerpDEX depends on it.

### 1. Deploy to Localhost

```bash
# Terminal 1: Start Hardhat node
npm run chain

# Terminal 2: Deploy both contracts
npm run deploy:localhost
```

Or deploy individually:

```bash
# Deploy Price Oracle first
npx hardhat deploy --network localhost --tags ShadeFXPriceOracle

# Then deploy PerpDEX
npx hardhat deploy --network localhost --tags ShadeFXPerpDEX
```

**Expected Output:**
```
=== Deployment Summary ===
Contract Name: ShadeFXPriceOracle
Contract Address: 0x...
Deployer: 0x...
Network: localhost
Chain ID: 31337

=== Deployment Summary ===
Contract Name: ShadeFXPerpDEX
Contract Address: 0x...
Price Oracle Address: 0x...
Deployer: 0x...
Network: localhost
Chain ID: 31337

=== Deployment Info (for frontend .env) ===
REACT_APP_PERPDEX_CONTRACT_ADDRESS=0x...
REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS=0x...
REACT_APP_NETWORK=localhost
REACT_APP_CHAIN_ID=31337
```

### 2. Deploy to Sepolia Testnet

```bash
npm run deploy:sepolia
```

Or deploy individually:

```bash
# Deploy Price Oracle first
npx hardhat deploy --network sepolia --tags ShadeFXPriceOracle

# Then deploy PerpDEX
npx hardhat deploy --network sepolia --tags ShadeFXPerpDEX
```

**Requirements:**
- `PRIVATE_KEY` and `SEPOLIA_RPC_URL` must be set in `.env` file
- You must have Sepolia testnet tokens


## 🔧 Post-Deployment Operations

### 1. Add Currency Pairs

After deployment, you need to add trading pairs to the Price Oracle:

```bash
# Set environment variables
export CONTRACT_ADDRESS=0x...your_oracle_address
export CURRENCY_PAIR_KEY=BTCUSD
export BASE_CURRENCY=BTC
export QUOTE_CURRENCY=USD

# Run the script
npx hardhat run scripts/addCurrencyPair.ts --network sepolia
```

Or add multiple pairs at once:

```bash
npm run add-all-pairs
```

### 2. Update Prices

After adding pairs, update prices from Pyth Network:

```bash
npm run update-prices
```

Or set up automatic price updates:

```bash
npm run auto-update-prices:continuous
```

### 3. Contract Verification (Sepolia)

Verify the Price Oracle:

```bash
npx hardhat verify --network sepolia <ORACLE_ADDRESS> \
  "0x0000000000000000000000000000000000000000" \
  false \
  "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21" \
  true \
  <OWNER_ADDRESS>
```

Verify PerpDEX:

```bash
npx hardhat verify --network sepolia <PERPDEX_ADDRESS> \
  <ORACLE_ADDRESS> \
  <OWNER_ADDRESS>
```

**Requirements:**
- `ETHERSCAN_API_KEY` must be set in `.env` file

### 4. Update Frontend

After deployment, update the frontend `.env` file:

```env
REACT_APP_PERPDEX_CONTRACT_ADDRESS=0x...your_deployed_perpdex_address
REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS=0x...your_deployed_oracle_address
REACT_APP_NETWORK=localhost  # or sepolia
REACT_APP_CHAIN_ID=31337     # or 11155111, 8008135
```

## 📝 Deployment Scripts

### deploy/003_deploy_price_oracle.ts

Deploys the ShadeFXPriceOracle contract.

**Constructor Parameters:**
- `_oracleAddress`: Legacy oracle address (ZeroAddress)
- `_useChainlinkOracle`: false
- `_pythOracleAddress`: `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` (Sepolia Pyth)
- `_usePythOracle`: true
- `initialOwner`: Deployer address

### deploy/003_deploy_perpdex.ts

Deploys the ShadeFXPerpDEX contract.

**Constructor Parameters:**
- `_priceOracleAddress`: Deployed oracle address (from previous step)
- `initialOwner`: Deployer address

**Dependencies:**
- Requires `ShadeFXPriceOracle` to be deployed first

## ✅ Deployment Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created and filled
- [ ] Contracts compiled (`npm run compile`)
- [ ] Tests passed (`npm test`)
- [ ] Connected to network
- [ ] Testnet tokens obtained (for testnet)
- [ ] Price Oracle deployed (`npm run deploy:localhost` or `deploy:sepolia`)
- [ ] PerpDEX deployed (`npm run deploy:localhost` or `deploy:sepolia`)
- [ ] Contract addresses added to frontend
- [ ] Currency pairs added to Oracle
- [ ] Prices updated from Pyth Network
- [ ] Contracts verified (optional, for Sepolia)

## 🔍 Post-Deployment Verification

### 1. Verify Contract Addresses

```bash
# Contract addresses will be shown in deployment output
# Or check deployments/ directory
```

### 2. Test Contract Functions

```bash
# Using Hardhat console
npx hardhat console --network localhost

# Get contract instances
const PriceOracle = await ethers.getContractFactory("ShadeFXPriceOracle");
const oracle = await PriceOracle.attach("0x...oracle_address");

const PerpDEX = await ethers.getContractFactory("ShadeFXPerpDEX");
const perpDEX = await PerpDEX.attach("0x...perpdex_address");

# Test functions
await oracle.owner();
await perpDEX.owner();
await perpDEX.priceOracle();
```

### 3. Test Frontend

```bash
cd frontend
npm install
npm start
```

In the frontend:
1. Connect your wallet
2. Verify contract addresses are correct
3. View available trading pairs
4. Test creating a position (Long/Short)
5. Test creating a limit order

## ⚠️ Important Notes

1. **Private Key Security**: Never commit `.env` file
2. **Testnet Tokens**: Ensure you have sufficient tokens for deployment
3. **Network Selection**: 
   - **Development**: Localhost
   - **Testing/Production**: Sepolia Testnet
4. **FHEVM Requirements**: Use FHEVM-compatible network
5. **Contract Verification**: You can verify contracts on Etherscan for Sepolia
6. **Deployment Order**: Price Oracle must be deployed before PerpDEX
7. **USDC Token**: PerpDEX requires a USDC token address. For testnet, deploy a mock ERC20 or use an existing testnet USDC.

## 🆘 Troubleshooting

### Compilation Error

```bash
# Clear cache
npm run clean

# Recompile
npm run compile
```

### Deployment Error

- Ensure private key is correct
- Ensure RPC URL is correct
- Ensure you have sufficient tokens on the network
- Ensure chain ID is correct
- Ensure Price Oracle is deployed before PerpDEX

### Test Error

- Ensure Hardhat node is running (for localhost)
- Ensure FHEVM plugin is installed
- Ensure test files check `fhevm.isMock`

### Price Update Error

- Ensure Pyth Oracle address is correct for the network
- Ensure pairs are added to Oracle before updating prices
- Ensure Oracle has permission to update prices

## 📚 Resources

- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [Hardhat Deploy Documentation](https://github.com/wighawag/hardhat-deploy)
- [Pyth Network Documentation](https://docs.pyth.network)

