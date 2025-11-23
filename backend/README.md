# ShadeFX Backend - Binance Price Updater Service

This service automatically updates prices for all trading pairs in the ShadeFX PerpDEX contract using Binance API price feeds.

## Features

- **Automated Price Updates**: Fetches prices from Binance API and updates the Price Oracle contract every 30 seconds
- **Multi-Pair Support**: Automatically discovers and updates all active pairs (14 pairs supported)
- **Owner-Only Updates**: Uses `forceUpdatePrice` function (bypasses deviation checks)
- **Gas Efficient**: Only updates when price changes significantly (>0.01% difference)
- **Error Handling**: Robust error handling with automatic retries

## Prerequisites

1. **Node.js** (v18 or higher)
2. **Contract Owner's Private Key**: The private key of the wallet that owns the contract (required for `forceUpdatePrice`)

## Setup

1. **Navigate to the `backend` directory**:
   ```bash
   cd backend
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Create `.env` file**:
   ```bash
   cp .env.example .env
   ```

4. **Configure `.env`**:
   Open the newly created `.env` file and set the following variables:

   - `SEPOLIA_RPC_URL` or `RPC_URL`: The RPC URL for the Sepolia network (e.g., Alchemy or Infura)
   - `PRIVATE_KEY`: The private key of the contract owner's wallet. This wallet must be the contract owner to use `forceUpdatePrice`. **Keep this secure!**
   - `PRICE_ORACLE_CONTRACT_ADDRESS`: The address of your deployed `ShadeFXPriceOracle` contract on Sepolia
   - `BINANCE_UPDATE_INTERVAL`: Update interval in milliseconds (default: `30000` = 30 seconds)

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Using PM2 (Recommended for Production)

```bash
pm2 start ecosystem.config.js
```

## Service Details

- **Update Interval**: 30 seconds per pair (configurable via `BINANCE_UPDATE_INTERVAL`)
- **Contract**: Uses `ShadeFXPriceOracle` contract
- **Price Source**: Binance API (`https://api.binance.com/api/v3/ticker/price`)
- **Network**: Ethereum Sepolia Testnet
- **Supported Pairs**: BTCUSD, ETHUSD, SOLUSD, MATICUSD, LINKUSD, UNIUSD, ATOMUSD, ADAUSD, AVAXUSD, DOTUSD, BNBUSD, TRXUSD, XRPUSD, DOGEUSD

## Monitoring

The service logs all operations to the console. For production, logs are written to:
- `./logs/binance-updater-out.log` (standard output)
- `./logs/binance-updater-error.log` (errors)

You can also use the `check-service.sh` script:
```bash
./check-service.sh status    # Check service status
./check-service.sh logs      # View recent logs
./check-service.sh errors    # View errors
./check-service.sh restart   # Restart service
```

## Troubleshooting

- **"No pairs found"**: Ensure pairs are added to the contract and marked as active
- **"Wallet is not contract owner"**: The wallet must be the contract owner to use `forceUpdatePrice`
- **"Insufficient gas"**: Ensure the wallet has enough ETH for gas fees
- **"Binance API timeout"**: Check internet connection and Binance API status

## Migration from Pyth Network

This service replaced the previous Pyth Network price updater due to inaccurate prices. The new service:
- Uses Binance API (free, reliable, accurate)
- No Pyth Network fees (gas savings)
- Uses `forceUpdatePrice` (owner-only, no deviation checks)
- Simpler architecture
