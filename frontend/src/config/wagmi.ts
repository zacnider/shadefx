import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

// Get contract address from environment
const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS || '0x018f56040fbdd5092a898d0349afE969BDC11A97';

export const config = getDefaultConfig({
  appName: 'ShadeFX',
  projectId: 'shadefx', // You can get a project ID from WalletConnect Cloud
  chains: [sepolia],
  ssr: false, // If your dApp uses server side rendering (SSR)
});

