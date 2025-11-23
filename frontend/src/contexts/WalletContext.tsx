import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { usePrivy, useWallets, useLinkAccount } from '@privy-io/react-auth';
import { useAccount, useChainId, useWalletClient, useSwitchChain } from 'wagmi';
import { sepolia } from 'wagmi/chains';

interface WalletContextType {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string | null;
  chainId: number | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  isConnected: boolean;
  isLoading: boolean;
  ready: boolean;
  user: any;
  wallets: any[];
  embeddedWallet: any;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { linkWallet } = useLinkAccount();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient, isLoading } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  
  // Sepolia chain ID
  const SEPOLIA_CHAIN_ID = 11155111;

  // Get embedded wallet (smart wallet) - prioritize embedded wallet
  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  const externalWallet = wallets.find(w => w.walletClientType !== 'privy');
  
  // Prioritize embedded wallet address over external wallet
  const primaryWallet = embeddedWallet || externalWallet;
  const primaryAddress = primaryWallet?.address || address;

  // Check and switch to Sepolia if needed
  useEffect(() => {
    const checkAndSwitchNetwork = async () => {
      if (!ready || !authenticated || !primaryAddress) return;
      
      try {
        let currentChainId: number | null = chainId;
        
        // Get actual chainId from provider if available
        if (embeddedWallet) {
          try {
            const ethereumProvider = await embeddedWallet.getEthereumProvider();
            const providerChainId = await ethereumProvider.request({ method: 'eth_chainId' });
            currentChainId = parseInt(providerChainId as string, 16);
            console.log(`[WalletContext] Provider chainId: ${currentChainId} (from embedded wallet)`);
          } catch (err) {
            console.warn('[WalletContext] Could not get chainId from provider:', err);
          }
        }
        
        if (currentChainId && currentChainId !== SEPOLIA_CHAIN_ID) {
          console.log(`[WalletContext] Current chainId: ${currentChainId}, switching to Sepolia (${SEPOLIA_CHAIN_ID})...`);
          try {
            if (embeddedWallet) {
              // Try multiple methods to switch chain
              try {
                // Method 1: Use switchChain if available
                if (typeof embeddedWallet.switchChain === 'function') {
                  await embeddedWallet.switchChain(SEPOLIA_CHAIN_ID);
                  console.log('[WalletContext] Switched to Sepolia using embeddedWallet.switchChain()');
                } else {
                  // Method 2: Use provider's wallet_switchEthereumChain
                  const ethereumProvider = await embeddedWallet.getEthereumProvider();
                  await ethereumProvider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
                  });
                  console.log('[WalletContext] Switched to Sepolia using wallet_switchEthereumChain');
                }
              } catch (switchError: any) {
                // If chain not added, try to add it
                if (switchError.code === 4902 || switchError.message?.includes('not added')) {
                  console.log('[WalletContext] Sepolia not added, adding network...');
                  const ethereumProvider = await embeddedWallet.getEthereumProvider();
                  await ethereumProvider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                      chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
                      chainName: 'Sepolia',
                      nativeCurrency: {
                        name: 'ETH',
                        symbol: 'ETH',
                        decimals: 18,
                      },
                      rpcUrls: ['https://sepolia.infura.io/v3/'],
                      blockExplorerUrls: ['https://sepolia.etherscan.io'],
                    }],
                  });
                  console.log('[WalletContext] Added Sepolia network');
                } else {
                  throw switchError;
                }
              }
            } else if (switchChain) {
              // Use wagmi's switchChain for external wallets
              await switchChain({ chainId: SEPOLIA_CHAIN_ID });
              console.log('[WalletContext] Switched to Sepolia using wagmi');
            }
          } catch (error: any) {
            console.error('[WalletContext] Error switching network:', error);
            console.error('[WalletContext] Error details:', {
              message: error.message,
              code: error.code,
              data: error.data
            });
            // Don't block provider initialization if switch fails
          }
        }
      } catch (error: any) {
        console.error('[WalletContext] Error in checkAndSwitchNetwork:', error);
      }
    };

    checkAndSwitchNetwork();
  }, [ready, authenticated, primaryAddress, chainId, embeddedWallet, switchChain]);

  // Create ethers provider from Privy wallet
  useEffect(() => {
    const initProvider = async () => {
      if (ready && authenticated && primaryAddress) {
        try {
          // Check if we're on the correct network
          if (chainId && chainId !== SEPOLIA_CHAIN_ID) {
            console.warn(`[WalletContext] Warning: Not on Sepolia network. Current chainId: ${chainId}, Expected: ${SEPOLIA_CHAIN_ID}`);
          }

          let browserProvider: ethers.BrowserProvider;
          let signerInstance: ethers.JsonRpcSigner;

          // Prioritize embedded wallet provider
          if (embeddedWallet) {
            console.log('[WalletContext] Using embedded wallet provider');
            // Use Privy's embedded wallet getEthereumProvider method
            const ethereumProvider = await embeddedWallet.getEthereumProvider();
            browserProvider = new ethers.BrowserProvider(ethereumProvider);
            
            // Verify network
            const network = await browserProvider.getNetwork();
            console.log('[WalletContext] Provider network:', { chainId: network.chainId.toString(), name: network.name });
            
            if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
              console.warn(`[WalletContext] Provider is not on Sepolia. ChainId: ${network.chainId}, Expected: ${SEPOLIA_CHAIN_ID}`);
            }
            
            // Get signer from provider
            try {
              if (primaryAddress && ethers.isAddress(primaryAddress)) {
                signerInstance = await browserProvider.getSigner(primaryAddress);
              } else {
                signerInstance = await browserProvider.getSigner();
              }
            } catch (signerError: any) {
              console.warn('Warning: Could not get signer with address, trying without address:', signerError);
              signerInstance = await browserProvider.getSigner();
            }
          } else if (externalWallet && walletClient) {
            console.log('[WalletContext] Using external wallet provider');
            // Fallback to external wallet if no embedded wallet
            const ethereumProvider = walletClient as any;
            browserProvider = new ethers.BrowserProvider(ethereumProvider);
            try {
              if (primaryAddress && ethers.isAddress(primaryAddress)) {
                signerInstance = await browserProvider.getSigner(primaryAddress);
              } else {
                signerInstance = await browserProvider.getSigner();
              }
            } catch (signerError: any) {
              console.warn('Warning: Could not get signer with address, trying without address:', signerError);
              signerInstance = await browserProvider.getSigner();
            }
          } else {
            console.warn('[WalletContext] No wallet available');
            setProvider(null);
            setSigner(null);
            return;
          }
          
          console.log('[WalletContext] Provider initialized:', {
            walletType: embeddedWallet ? 'embedded' : 'external',
            address: primaryAddress
          });
          
          setProvider(browserProvider);
          setSigner(signerInstance);
        } catch (error) {
          console.error('Error initializing provider:', error);
          setProvider(null);
          setSigner(null);
        }
      } else {
        setProvider(null);
        setSigner(null);
      }
    };

    initProvider();
  }, [ready, authenticated, primaryAddress, embeddedWallet, externalWallet, walletClient]);

  const connectWallet = async () => {
    if (!ready) {
      console.log('Privy is not ready yet');
      return;
    }
    
    // Check if user is already fully connected (authenticated AND has address)
    if (authenticated && primaryAddress && isConnected) {
      console.log('Already connected:', primaryAddress, 'Wallet type:', embeddedWallet ? 'Embedded' : 'External');
      return;
    }
    
    try {
      console.log('Connecting wallet...', { 
        ready, 
        authenticated, 
        address, 
        primaryAddress,
        embeddedWallet: embeddedWallet?.address,
        externalWallet: externalWallet?.address,
        isConnected, 
        walletsCount: wallets.length 
      });
      
      // If user is authenticated but no wallet connected, embedded wallet should be created automatically
      // If not, try to link wallet or re-login
      if (authenticated && !primaryAddress) {
        console.log('User authenticated but no wallet. Waiting for embedded wallet creation...');
        // Embedded wallet should be created automatically on login
        // If it's not created, wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check again if wallet was created
        const updatedWallets = wallets;
        const updatedEmbeddedWallet = updatedWallets.find(w => w.walletClientType === 'privy');
        
        if (!updatedEmbeddedWallet) {
          console.log('Embedded wallet not created automatically. Trying linkWallet()...');
          try {
            await linkWallet();
            console.log('Privy linkWallet completed');
          } catch (linkError: any) {
            console.error('linkWallet failed, trying login again:', linkError);
            // If linkWallet fails, logout and login again
            await logout();
            await login();
            console.log('Re-login completed');
          }
        }
      } else if (!authenticated) {
        // User not authenticated, use login()
        console.log('User not authenticated. Using login()...');
        try {
          await login();
          console.log('Privy login completed');
        } catch (loginError: any) {
          console.error('Login failed:', loginError);
          throw loginError;
        }
      }
    } catch (error: any) {
      console.error('Error connecting wallet:', error);
      // Don't throw - let Privy handle the error
    }
  };

  const disconnectWallet = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  };

  const value: WalletContextType = {
    provider,
    signer,
    account: primaryAddress || null, // Use primary wallet address (embedded wallet prioritized)
    chainId: chainId || null,
    connectWallet,
    disconnectWallet,
    isConnected: authenticated && isConnected && !!primaryAddress,
    isLoading: !ready || isLoading,
    ready,
    user,
    wallets,
    embeddedWallet,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
