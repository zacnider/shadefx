# ShadeFX Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
# Root directory (Smart Contracts)
npm install

# Frontend directory
cd frontend
npm install
cd ..
```

### 2. Configure Environment Variables

#### Root Directory (.env)
```env
PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
ETHERSCAN_API_KEY=your_etherscan_api_key
FHEVM_RELAYER_URL=http://localhost:8545
```

#### Frontend Directory (.env)
```env
REACT_APP_CONTRACT_ADDRESS=your_deployed_contract_address
REACT_APP_FHEVM_RELAYER_URL=http://localhost:8545
REACT_APP_NETWORK=localhost
```

### 3. Compile Contracts

```bash
npm run compile
```

### 4. Run Tests

```bash
npm test
```

### 5. Deploy Contracts

#### Local Network
```bash
# Terminal 1: Start local node
npx hardhat node

# Terminal 2: Deploy contracts
npm run deploy:localhost
```

#### Sepolia Testnet
```bash
npm run deploy:sepolia
```

### 6. Update Frontend Contract Address

After deployment, update `frontend/.env`:
```env
REACT_APP_CONTRACT_ADDRESS=0x...your_contract_address
```

### 7. Start Frontend

```bash
cd frontend
npm start
```

Frontend will be available at `http://localhost:3000`

## Important Notes

### FHEVM Integration

✅ **FHEVM is fully integrated and operational in this project.**

- **Smart Contract**: Uses `@fhevm/solidity` package with full FHEVM support
  - `FHE.fromExternal()` - Converts external encrypted values to internal
  - `FHE.allowThis()` - Allows contract to decrypt values
  - `FHE.allow()` - Allows specific addresses to decrypt values
  - `FHE.makePubliclyDecryptable()` - Makes values publicly decryptable
- **Frontend**: Uses `@zama-fhe/relayer-sdk` for encryption operations
  - `encryptBool()` - Encrypts boolean values (trade directions)
  - `encrypt()` / `encrypt32()` - Encrypts numeric values (leverage)
- **Network**: Deployed on Sepolia testnet with FHEVM support

### Smart Contract Notes

- The contract uses `@fhevm/solidity` package - properly installed and configured
- FHEVM types (`ebool`, `euint32`, `externalEbool`, `externalEuint32`) are correctly used
- Tested on Sepolia testnet with FHEVM support

### Frontend Notes

- FHEVM Relayer SDK integration is fully functional
- Contract ABI is up to date after contract compilation
- MetaMask configured for Sepolia testnet

## Next Steps

1. **Set up FHEVM Environment**:
   - Install FHEVM SDK
   - Configure FHEVM relayer
   - Test encryption/decryption

2. **Deploy to Testnet**:
   - Deploy contract to FHEVM-compatible testnet
   - Update frontend with contract address
   - Test end-to-end flow

3. **Create Currency Pairs**:
   - Use owner account to create currency pairs
   - Set prediction and result deadlines
   - Test prediction submission

4. **Test Full Flow**:
   - Submit encrypted predictions
   - Declare results as owner
   - Reveal winners
   - Claim rewards

## Troubleshooting

### Contract Compilation Errors
- Check Solidity version compatibility
- Ensure FHEVM package is installed
- Verify import paths

### Frontend Errors
- Check contract address in `.env`
- Verify network configuration
- Ensure MetaMask is connected

### FHEVM Errors
- Verify relayer is running
- Check FHEVM SDK version
- Review FHEVM documentation

## Support

For issues or questions:
- Check [Zama Documentation](https://docs.zama.org/protocol)
- Join [Zama Discord](https://discord.gg/zama)
- Review project documentation in `/docs`

