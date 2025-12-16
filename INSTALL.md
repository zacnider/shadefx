# ShadeFX Installation Guide

## Prerequisites

- Node.js 18+ and npm
- MetaMask browser extension
- Git

## Step 1: Install Dependencies

### Backend (Smart Contracts)

```bash
# Navigate to project root
cd shadefx

# Install dependencies
npm install
```

### Frontend

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install
```

## Step 2: Install FHEVM Dependencies

### Backend

The FHEVM Solidity library should be installed automatically with `npm install`. If not:

```bash
npm install fhevm
```

### Frontend

The fhevmjs library should be installed automatically. If not:

```bash
cd frontend
npm install fhevmjs
```

## Step 3: Configure Environment Variables

### Backend (.env)

Create a `.env` file in the root directory:

```env
# Private key for deployment (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
LOCALHOST_RPC_URL=http://127.0.0.1:8545

# Etherscan API Key for contract verification
ETHERSCAN_API_KEY=your_etherscan_api_key

# FHEVM Relayer URL (if using external relayer)
FHEVM_RELAYER_URL=http://localhost:8545
```

### Frontend (.env)

Create a `.env` file in the `frontend` directory:

```env
# Contract address (set after deployment)
REACT_APP_CONTRACT_ADDRESS=

# FHEVM Relayer URL
REACT_APP_FHEVM_RELAYER_URL=http://localhost:8545

# Network configuration
REACT_APP_NETWORK=localhost
```

## Step 4: Compile Contracts

```bash
# From project root
npm run compile
```

## Step 5: Run Tests

```bash
# From project root
npm test
```

## Step 6: Deploy Contracts

### Local Network

```bash
# Terminal 1: Start local Hardhat node
npx hardhat node

# Terminal 2: Deploy contracts
npm run deploy:localhost
```

After deployment, copy the contract address and update `frontend/.env`:

```env
REACT_APP_CONTRACT_ADDRESS=0x...your_contract_address
```

### Sepolia Testnet

```bash
npm run deploy:sepolia
```

## Step 7: Start Frontend

```bash
cd frontend
npm start
```

The frontend will be available at `http://localhost:3000`

## Step 8: Create Currency Pair (Optional)

After deployment, you can create a currency pair:

```bash
# Set environment variables
export CONTRACT_ADDRESS=0x...your_contract_address
export CURRENCY_PAIR_KEY=EURUSD
export BASE_CURRENCY=EUR
export QUOTE_CURRENCY=USD

# Run script
npx hardhat run scripts/createPair.ts --network localhost
```

## Troubleshooting

### Contract Compilation Errors

- Ensure Solidity version is 0.8.24
- Check that FHEVM package is installed: `npm list fhevm`
- Verify import paths in `contracts/ShadeFX.sol`

### Frontend Errors

- Check that contract address is set in `frontend/.env`
- Verify network configuration
- Ensure MetaMask is connected to the correct network

### FHEVM Errors

- Verify FHEVM relayer is running (if using external relayer)
- Check fhevmjs version: `npm list fhevmjs`
- Review FHEVM documentation: https://docs.zama.org/protocol

## Next Steps

1. **Test the Application**:
   - Connect MetaMask
   - Create a currency pair (as owner)
   - Submit a prediction
   - Declare result (as owner)
   - Claim reward (if winner)

2. **Deploy to Testnet**:
   - Deploy to FHEVM-compatible testnet
   - Update frontend with testnet contract address
   - Test end-to-end flow

3. **Prepare for Submission**:
   - Complete all features
   - Write comprehensive tests
   - Create demo video
   - Update documentation

## Support

For issues or questions:
- Check [Zama Documentation](https://docs.zama.org/protocol)
- Join [Zama Discord](https://discord.gg/zama)
- Review project documentation in `/docs`

