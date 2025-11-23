import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

// Get contract address from environment
const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS ||;

export const config = getDefaultConfig({
  appName: 'ShadeFX',
  projectId: 'shadefx', // You can get a project ID from WalletConnect Cloud
  chains: [sepolia],
  ssr: false, // If your dApp uses server side rendering (SSR)
});

