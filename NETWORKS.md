# ShadeFX Network Configuration

## Supported Networks

ShadeFX uses FHEVM (Fully Homomorphic Encryption Virtual Machine) and is deployed on **Sepolia Testnet**. Below are the supported networks:

### 1. Sepolia Testnet (Production)

**Chain ID**: 11155111  
**RPC URL**: `https://sepolia.infura.io/v3/YOUR_INFURA_KEY`  
**Explorer**: `https://sepolia.etherscan.io`  
**Use Case**: Production deployment with FHEVM support

**Setup**:
1. Get testnet tokens from Sepolia faucet
2. Configure MetaMask for Sepolia testnet
3. Deploy contracts to Sepolia testnet

**Configuration**:
```typescript
sepolia: {
  url: process.env.SEPOLIA_RPC_URL || "",
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
  chainId: 11155111,
}
```

**FHEVM Public Key Address**: `0x0000000000000000000000000000000000000044`  
This address is used to retrieve the FHEVM public key needed for encryption operations.

**Note**: Your contracts use `ZamaEthereumConfig` which automatically handles all FHEVM contract addresses for Sepolia. The addresses below are managed by Zama and configured automatically:

- **FHEVM Executor**: `0x848B0066793BcC60346Da1F49049357399B8D595`
- **ACL Contract**: `0x687820221192C5B662b25367F70076A37bc79b6c`
- **KMS Verifier**: `0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC`
- **Relayer URL**: `https://relayer.testnet.zama.cloud`

### 2. Localhost (Development)

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

## Network Selection Guide

### For Development
- **Use**: Localhost
- **Why**: Fast, free, full control
- **Setup**: `npx hardhat node`

### For Testing/Production
- **Use**: Sepolia Testnet
- **Why**: Real FHEVM environment, testnet tokens available, production-ready
- **Setup**: Configure MetaMask, get testnet tokens, deploy contracts

## FHEVM Requirements

All networks must have:

1. **FHEVM Public Key Address**: `0x0000000000000000000000000000000000000044` - Used to retrieve public key
2. **FHEVM Contracts**: Automatically configured via `ZamaEthereumConfig` in your contracts
3. **FHEVM Support**: Network must support FHEVM operations (Sepolia has full FHEVM support)

## MetaMask Configuration

### Sepolia Testnet

1. Open MetaMask
2. Go to Settings → Networks → Add Network
3. Add:
   - **Network Name**: Sepolia Test Network
   - **RPC URL**: `https://sepolia.infura.io/v3/YOUR_INFURA_KEY`
   - **Chain ID**: `11155111`
   - **Currency Symbol**: `ETH`
   - **Block Explorer**: `https://sepolia.etherscan.io`

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

# Chain IDs
SEPOLIA_CHAIN_ID=11155111

# Etherscan API Key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### frontend/.env

```env
# Contract address (set after deployment)
REACT_APP_CONTRACT_ADDRESS=

# Network configuration
REACT_APP_NETWORK=sepolia
REACT_APP_CHAIN_ID=11155111

# FHEVM Relayer URL (if using external relayer)
REACT_APP_FHEVM_RELAYER_URL=http://localhost:8545
```

## Deployment Commands

### Localhost
```bash
npm run deploy:localhost
```

### Sepolia Testnet
```bash
npm run deploy:sepolia
```

## Network Verification

After deployment, verify your contract:

```bash
# Sepolia
npx hardhat verify --network sepolia CONTRACT_ADDRESS <CONSTRUCTOR_ARGS>
```

## Important Notes

1. **FHEVM Compatibility**: Sepolia testnet supports FHEVM operations through Zama's infrastructure.

2. **Public Key**: FHEVM requires public key from address `0x0000000000000000000000000000000000000044` (automatically retrieved by `ZamaEthereumConfig`)

3. **Testnet Tokens**: Get testnet tokens from faucets:
   - Sepolia: https://sepoliafaucet.com/ or https://faucet.quicknode.com/ethereum/sepolia

4. **Network Updates**: Check Zama documentation for latest network information

## Resources

- [Zama FHEVM Documentation](https://docs.zama.org/protocol)
- [FHEVM GitHub](https://github.com/zama-ai/fhevm)
- [Sepolia Etherscan](https://sepolia.etherscan.io)

## Support

For network-related issues:
- Check network documentation
- Verify FHEVM contract is deployed
- Ensure network supports FHEVM operations
- Contact Zama support
