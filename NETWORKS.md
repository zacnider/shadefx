# ShadeFX Network Configuration

## Supported Networks

ShadeFX uses FHEVM (Fully Homomorphic Encryption Virtual Machine) which requires FHEVM-compatible networks. Below are the supported networks:

### 1. Localhost (Development)

**Chain ID**: 1337  
**RPC URL**: `http://127.0.0.1:8545`  
**Use Case**: Local development and testing

**Setup**:
```bash
# Start local Hardhat node with FHEVM support
npx hardhat node
```

**Configuration**:
```typescript
localhost: {
  url: "http://127.0.0.1:8545",
  chainId: 1337,
}
```

### 2. Fhenix Helium Testnet (Recommended for FHEVM)

**Chain ID**: 8008135  
**RPC URL**: `https://api.helium.fhenix.zone`  
**Explorer**: `https://explorer.helium.fhenix.zone`  
**Use Case**: FHEVM testing and development

**Setup**:
1. Get testnet tokens from Fhenix faucet
2. Configure MetaMask for Fhenix Helium testnet
3. Deploy contracts to Fhenix Helium testnet

**Configuration**:
```typescript
fhenix: {
  url: "https://api.helium.fhenix.zone",
  chainId: 8008135,
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
}
```

**FHEVM Contract Address**: `0x0000000000000000000000000000000000000044`

### 2b. Fhenix Nitrogen Testnet (Alternative)

**Chain ID**: Check Fhenix documentation  
**RPC URL**: Check Fhenix documentation  
**Explorer**: `https://explorer.nitrogen.fhenix.zone`  
**Use Case**: Alternative FHEVM testnet

**Note**: Nitrogen testnet bilgileri için Fhenix dokümantasyonunu kontrol edin.

### 3. Sepolia Testnet (Ethereum)

**Chain ID**: 11155111  
**RPC URL**: `https://sepolia.infura.io/v3/YOUR_INFURA_KEY`  
**Use Case**: Standard Ethereum testing (may not support FHEVM natively)

**Note**: Sepolia may not have native FHEVM support. Check Zama documentation for FHEVM-compatible testnets.

**Configuration**:
```typescript
sepolia: {
  url: process.env.SEPOLIA_RPC_URL || "",
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
  chainId: 11155111,
}
```

### 4. FHEVM Custom Network

If you're running a custom FHEVM node:

**Configuration**:
```typescript
fhevm: {
  url: process.env.FHEVM_RPC_URL || "http://localhost:8545",
  chainId: process.env.FHEVM_CHAIN_ID || 1337,
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
}
```

## Network Selection Guide

### For Development
- **Use**: Localhost
- **Why**: Fast, free, full control
- **Setup**: `npx hardhat node`

### For Testing
- **Use**: Fhenix Testnet
- **Why**: Real FHEVM environment, testnet tokens available
- **Setup**: Configure MetaMask, get testnet tokens

### For Production
- **Use**: FHEVM Mainnet (when available)
- **Why**: Production-ready FHEVM network
- **Setup**: Follow Zama's mainnet deployment guide

## FHEVM Requirements

All networks must have:

1. **FHEVM Contract**: Deployed at `0x0000000000000000000000000000000000000044`
2. **Public Key**: Available from FHEVM contract
3. **FHEVM Support**: Network must support FHEVM operations

## MetaMask Configuration

### Fhenix Testnet

1. Open MetaMask
2. Go to Settings → Networks → Add Network
3. Add:
   - **Network Name**: Fhenix Testnet
   - **RPC URL**: `https://api.testnet.fhenix.zone`
   - **Chain ID**: `420` (or latest from docs)
   - **Currency Symbol**: `tFHE` (or check latest)
   - **Block Explorer**: `https://explorer.testnet.fhenix.zone`

### Localhost

1. Open MetaMask
2. Go to Settings → Networks → Add Network
3. Add:
   - **Network Name**: Localhost 8545
   - **RPC URL**: `http://127.0.0.1:8545`
   - **Chain ID**: `1337`
   - **Currency Symbol**: `ETH`

## Environment Variables

### .env (Root)

```env
# Private key for deployment
PRIVATE_KEY=your_private_key_here

# Network RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
FHENIX_RPC_URL=https://api.testnet.fhenix.zone
FHEVM_RPC_URL=http://localhost:8545

# Chain IDs
FHENIX_CHAIN_ID=420
FHEVM_CHAIN_ID=1337

# Etherscan API Key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### frontend/.env

```env
# Contract address (set after deployment)
REACT_APP_CONTRACT_ADDRESS=

# Network configuration
REACT_APP_NETWORK=localhost
REACT_APP_CHAIN_ID=1337

# FHEVM Relayer URL (if using external relayer)
REACT_APP_FHEVM_RELAYER_URL=http://localhost:8545
```

## Deployment Commands

### Localhost
```bash
npm run deploy:localhost
```

### Fhenix Testnet
```bash
npx hardhat run scripts/deploy.ts --network fhenix
```

### Sepolia Testnet
```bash
npm run deploy:sepolia
```

## Network Verification

After deployment, verify your contract:

```bash
# Sepolia
npx hardhat verify --network sepolia CONTRACT_ADDRESS "0.01" "5"

# Fhenix (if supported)
npx hardhat verify --network fhenix CONTRACT_ADDRESS "0.01" "5"
```

## Important Notes

1. **FHEVM Compatibility**: Not all EVM networks support FHEVM. Use FHEVM-compatible networks.

2. **Public Key**: FHEVM requires public key from FHEVM contract at `0x0000000000000000000000000000000000000044`

3. **Testnet Tokens**: Get testnet tokens from faucets:
   - Fhenix: Check Fhenix documentation for faucet
   - Sepolia: https://sepoliafaucet.com/

4. **Network Updates**: Check Zama/Fhenix documentation for latest network information

## Resources

- [Fhenix Documentation](https://docs.fhenix.zone)
- [Zama FHEVM Documentation](https://docs.zama.org/protocol)
- [FHEVM GitHub](https://github.com/zama-ai/fhevm)

## Support

For network-related issues:
- Check network documentation
- Verify FHEVM contract is deployed
- Ensure network supports FHEVM operations
- Contact Zama/Fhenix support

