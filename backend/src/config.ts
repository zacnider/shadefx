import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Network
  rpcUrl: process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || '',
  chainId: parseInt(process.env.CHAIN_ID || '11155111'),
  
  // Wallet
  privateKey: process.env.PRIVATE_KEY || '',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate required config
if (!config.privateKey) {
  throw new Error('PRIVATE_KEY is required in .env file');
}
if (!config.rpcUrl) {
  throw new Error('RPC_URL or SEPOLIA_RPC_URL is required in .env file');
}

