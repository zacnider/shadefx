# ShadeFX Backend Services

Automated backend services for the ShadeFX Perpetual DEX platform. These services handle price updates, limit order execution, and contract maintenance tasks.

## 📋 Overview

The backend consists of multiple microservices that work together to keep the ShadeFX platform running smoothly:

1. **Price Updater Service**: Automatically updates prices for all trading pairs
2. **Limit Order Executor Service**: Monitors and executes pending limit orders
3. **Price API Service**: Provides price data via REST API (optional)

## 🚀 Features

- **Automated Price Updates**: Continuously updates prices for all active trading pairs
- **Limit Order Execution**: Automatically executes limit orders when price conditions are met
- **Multi-Pair Support**: Supports all active trading pairs on the platform
- **Error Handling**: Robust error handling with automatic retries and logging
- **Gas Efficient**: Optimized to minimize gas costs while maintaining price accuracy
- **Production Ready**: PM2 configuration for production deployments

## 📦 Prerequisites

1. **Node.js** (v18 or higher)
2. **npm** or **yarn**
3. **Contract Owner's Private Key**: The private key of the wallet that owns the contract
4. **RPC Endpoint**: Access to an Ethereum RPC endpoint (Sepolia testnet)
5. **Indexer Access** (for limit order executor): GraphQL endpoint for querying on-chain events

## 🛠️ Installation

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Create `.env` file**:
   ```bash
   cp env.example .env
   ```

4. **Configure `.env`**:
   Edit the `.env` file and set the following variables:

   ```env
   # Wallet Configuration
   PRIVATE_KEY=your_private_key_here

   # Network Configuration
   RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_alchemy_api_key_here
   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_alchemy_api_key_here
   CHAIN_ID=11155111

   # Contract Addresses
   CONTRACT_ADDRESS=0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532
   PRICE_ORACLE_CONTRACT_ADDRESS=0x92Fb1C6cc98C837068B661f84864fCcC0CE07d93
   PERPDEX_CONTRACT_ADDRESS=0x8394A0ddC9Ae5B3a0079a1e5799Fd7fBdbBf9532

   # API Configuration
   API_PORT=3002

   # CoinGecko API Key (optional, for additional price data)
   COINGECKO_API_KEY=your_coingecko_api_key_here

   # Indexer Configuration (for limit order executor)
   INDEXER_GRAPHQL_URL=http://localhost:8080/v1/graphql
   HASURA_ADMIN_SECRET=your_hasura_admin_secret_here

   # Update Intervals (in milliseconds)
   PRICE_UPDATE_INTERVAL=30000
   LIMIT_ORDER_EXECUTION_INTERVAL=30000

   # Logging
   LOG_LEVEL=info
   ```

   ⚠️ **Important**: Never commit your `.env` file to version control!

## 🏃 Running the Services

### Price Updater Service

This service automatically updates prices for all trading pairs.

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm start
```

#### Using PM2 (Recommended for Production)
```bash
npm run build
pm2 start ecosystem.config.js --only binance-price-updater
```

### Limit Order Executor Service

This service monitors pending limit orders and executes them when price conditions are met.

#### Development Mode
```bash
npm run dev:executor
```

#### Production Mode
```bash
npm run start:executor
```

#### Using PM2 (Recommended for Production)
```bash
npm run build
pm2 start ecosystem.config.js --only limit-order-executor
```

### Running All Services with PM2

```bash
npm run build
pm2 start ecosystem.config.js
```

This will start both services:
- `binance-price-updater`: Price update service (updates prices for all trading pairs)
- `limit-order-executor`: Limit order execution service (executes pending limit orders)

## 📝 Available Scripts

```bash
# Development
npm run dev              # Start price updater in dev mode (with auto-reload)
npm run dev:executor    # Start limit order executor in dev mode

# Production
npm start               # Start price updater service
npm run start:executor  # Start limit order executor service
npm run start:prod      # Start price updater (compiled)
npm run start:executor:prod  # Start limit order executor (compiled)

# Build
npm run build           # Compile TypeScript to JavaScript

# PM2 Management
pm2 start ecosystem.config.js    # Start all services
pm2 stop all                     # Stop all services
pm2 restart all                  # Restart all services
pm2 logs                         # View logs
pm2 status                       # Check service status
```

## 🔧 Service Configuration

### Price Updater Service

- **Update Interval**: 30 seconds per pair (configurable via `PRICE_UPDATE_INTERVAL`)
- **Contract**: Uses `ShadeFXPriceOracle` contract
- **Network**: Ethereum Sepolia Testnet
- **Function**: Uses `forceUpdatePrice` (owner-only, bypasses deviation checks)

### Limit Order Executor Service

- **Execution Interval**: 30 seconds (configurable via `LIMIT_ORDER_EXECUTION_INTERVAL`)
- **Contract**: Uses `ShadeFXPerpDEX` contract
- **Function**: Uses `executeLimitOrder()` (public function, anyone can call)
- **Data Source**: GraphQL indexer for querying pending orders

## 📊 Monitoring

### PM2 Monitoring

```bash
# View all service logs
pm2 logs

# View specific service logs
pm2 logs binance-price-updater
pm2 logs limit-order-executor

# Check service status
pm2 status

# Monitor resource usage
pm2 monit
```

### Log Files

Logs are written to:
- Standard output: Console
- PM2 logs: `~/.pm2/logs/`

### Health Checks

You can check if services are running:

```bash
# Check if services are running
pm2 list

# Restart a service
pm2 restart binance-price-updater

# Stop a service
pm2 stop limit-order-executor
```

## 🐛 Troubleshooting

### Common Issues

1. **"RPC_URL or SEPOLIA_RPC_URL is required"**
   - Ensure your `.env` file has a valid RPC URL
   - Check that the RPC endpoint is accessible

2. **"PRIVATE_KEY is required"**
   - Ensure your `.env` file contains a valid private key
   - The wallet must have sufficient ETH for gas fees

3. **"Wallet is not contract owner"**
   - The wallet must be the contract owner to use `forceUpdatePrice`
   - Verify the contract address and owner address

4. **"Insufficient gas"**
   - Ensure the wallet has enough ETH for gas fees
   - Check gas prices and adjust if necessary

5. **"No pairs found"**
   - Ensure pairs are added to the contract
   - Verify pairs are marked as active in the contract

6. **"Indexer connection failed"** (Limit Order Executor)
   - Check that the indexer is running
   - Verify `INDEXER_GRAPHQL_URL` is correct
   - Ensure `HASURA_ADMIN_SECRET` is set if required

### Debug Mode

Enable debug logging by setting:
```env
LOG_LEVEL=debug
```

## 🔐 Security Considerations

1. **Private Key Security**:
   - Never commit `.env` files to version control
   - Use environment variables in production
   - Consider using hardware wallets for production

2. **API Keys**:
   - Rotate API keys regularly
   - Use separate keys for development and production
   - Monitor API usage

3. **Network Security**:
   - Use secure RPC endpoints
   - Enable rate limiting if exposing services publicly
   - Use HTTPS for all external communications

## 📦 Production Deployment

### Using PM2

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Start services**:
   ```bash
   pm2 start ecosystem.config.js
   ```

3. **Save PM2 configuration**:
   ```bash
   pm2 save
   ```

4. **Setup PM2 startup script**:
   ```bash
   pm2 startup
   # Follow the instructions to enable PM2 on system startup
   ```

### Environment Variables in Production

Set environment variables in your production environment:
- Use your hosting provider's environment variable system
- Never hardcode secrets in code
- Use secrets management services (AWS Secrets Manager, etc.)

## 📚 Project Structure

```
backend/
├── services/
│   ├── binancePriceUpdater.ts    # Price updater service
│   ├── limitOrderExecutor.ts      # Limit order executor service
│   └── pythPriceUpdater.ts       # Alternative price updater (optional)
├── src/
│   ├── config.ts                  # Configuration management
│   ├── logger.ts                  # Logging utilities
│   └── coingeckoApi.ts            # CoinGecko API client (optional)
├── ecosystem.config.js            # PM2 configuration
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript configuration
└── README.md                      # This file
```

## 🔗 Related Documentation

- [Main Project README](../README.md)
- [FHEVM Encryption Guide](../FHEVM_ENCRYPTION.md)

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check the main project documentation
- Review service logs for error messages

---

**Built for ShadeFX Perpetual DEX** 🚀
