import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { createWalletClient, custom, type WalletClient } from 'viem';
import { sepolia } from 'viem/chains';
import { initSDK, createInstance, type FhevmInstance, type RelayerEncryptedInput, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';

interface EncryptedInput {
  handles: Uint8Array[];
  inputProof: Uint8Array;
}

interface FHEVMHook {
  encrypt: (value: number, contractAddress: string, userAddress: string) => Promise<EncryptedInput>; // encrypt32 (for euint32)
  encryptBool: (value: boolean, contractAddress: string, userAddress: string) => Promise<EncryptedInput>;
  encrypt32: (value: number, contractAddress: string, userAddress: string) => Promise<EncryptedInput>; // For euint32 (leverage)
  encrypt64: (value: bigint, contractAddress: string, userAddress: string) => Promise<EncryptedInput>; // For euint64 (stop loss)
  decrypt: (encrypted: string, contractAddress: string, signer: ethers.JsonRpcSigner) => Promise<number>;
  isReady: boolean;
  error: string | null;
  instance: FhevmInstance | null;
}

/**
 * FHEVM Hook for encryption/decryption operations
 * Uses @zama-fhe/relayer-sdk for FHE operations
 * 
 * Note: For frontend, we use relayer SDK. For tests, use hardhat plugin.
 */
export const useFHEVM = (provider?: ethers.Provider, embeddedWallet?: any): FHEVMHook => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  useEffect(() => {
    const initializeFHEVM = async (attempt: number = 0) => {
      try {
        // Priority order:
        // 1. Privy embedded wallet (if available) - most reliable for Privy users
        // 2. window.ethereum (wallet extensions like MetaMask)
        // 3. Extract from ethers provider (fallback)
        let ethereumProvider: any = null;
        
        // Priority 1: Privy embedded wallet (direct access)
        if (embeddedWallet) {
          try {
            const privyProvider = await embeddedWallet.getEthereumProvider();
            if (privyProvider && privyProvider.request) {
              ethereumProvider = privyProvider;
              console.log('✅ Using Privy embedded wallet provider for FHEVM (direct access)');
            }
          } catch (privyErr) {
            console.warn('⚠️ Could not get Privy embedded wallet provider:', privyErr);
          }
        }
        
        // Priority 2: window.ethereum (wallet extensions)
        if (!ethereumProvider && typeof window !== 'undefined' && (window as any).ethereum) {
          ethereumProvider = (window as any).ethereum;
          console.log('✅ Using window.ethereum provider for FHEVM');
        }
        
        // Priority 3: Extract from ethers provider (fallback)
        if (!ethereumProvider && provider) {
          try {
            const browserProvider = provider as any;
            // Privy's embedded wallet provider might be accessible via provider.provider
            if (browserProvider.provider && browserProvider.provider.request) {
              ethereumProvider = browserProvider.provider;
              console.log('✅ Using Privy embedded wallet provider for FHEVM (extracted from ethers provider)');
            }
          } catch (providerErr) {
            console.warn('⚠️ Could not extract EIP1193 provider from ethers provider:', providerErr);
          }
        }
        
        if (ethereumProvider && ethereumProvider.request) {
          // Step 1: Initialize SDK and load WASM (required before creating instance)
          try {
            await initSDK();
            console.log('✅ FHEVM SDK initialized (WASM loaded)');
          } catch (initError: any) {
            console.error('FHEVM SDK initialization error:', initError);
            setError('Failed to initialize FHEVM SDK. WASM loading failed.');
            setIsReady(false);
            return;
          }

          // Step 2: Get network info and verify we're on Sepolia
          // Use the provider we found (either window.ethereum or Privy provider)
          const browserProvider = new ethers.BrowserProvider(ethereumProvider);
          const network = await browserProvider.getNetwork();
          const chainId = Number(network.chainId);
          
          // CRITICAL: FHEVM requires Sepolia network (Chain ID: 11155111)
          const SEPOLIA_CHAIN_ID = 11155111;
          if (chainId !== SEPOLIA_CHAIN_ID) {
            const errorMsg = `FHEVM requires Sepolia network (Chain ID: ${SEPOLIA_CHAIN_ID}), but current network is ${network.name} (Chain ID: ${chainId}). Please switch to Sepolia network.`;
            console.error('❌ FHEVM network mismatch:', errorMsg);
            setError(errorMsg);
            setIsReady(false);
            return;
          }
          
          console.log('✅ Network verified: Sepolia (Chain ID:', chainId, ')');
          
          // Step 3: Create FHEVM instance with SepoliaConfig
          // According to documentation: https://docs.zama.ai/protocol/sdk-guides/initialization
          // SepoliaConfig should include relayerUrl: "https://relayer.testnet.zama.cloud"
          // IMPORTANT: network must be EIP1193 provider for transaction requests
          // The relayer SDK uses this to send transactions to the wallet
          
          // IMPORTANT: The network parameter must be the raw EIP1193 provider object
          // NOT an ethers.BrowserProvider or any wrapped version
          // The relayer SDK needs direct access to provider.request() for transaction requests
          // 
          // CRITICAL: Multiple wallet extensions may wrap window.ethereum, causing issues
          // We need to find the actual MetaMask provider (or the primary provider)
          // OR use Privy embedded wallet provider if available
          let actualEthereumProvider = ethereumProvider;
          
          // CRITICAL: According to Zama documentation, network parameter must be EIP1193 provider for transaction sending
          // The relayer SDK uses network.request('eth_sendTransaction', ...) internally
          // We must find the actual MetaMask provider, not a wrapper
          // 
          // Strategy:
          // 1. First, try to find MetaMask directly (isMetaMask = true)
          // 2. If not found, check providers array for MetaMask
          // 3. If still not found, use the first provider (fallback)
          // 4. If all else fails, use the original provider
          
          // Try to find MetaMask provider specifically (most reliable for transaction requests)
          // MetaMask usually sets window.ethereum.isMetaMask = true
          if (ethereumProvider && (ethereumProvider as any).isMetaMask) {
            actualEthereumProvider = ethereumProvider;
            console.log('✅ Found MetaMask provider directly');
          } else if (ethereumProvider && (ethereumProvider as any).providers && Array.isArray((ethereumProvider as any).providers)) {
            // Some wallets expose multiple providers (e.g., when multiple extensions are installed)
            const providers = (ethereumProvider as any).providers;
            // Ensure providers is an array and has length
            if (providers && providers.length > 0) {
              // Try to find MetaMask in the providers array
              const metaMaskProvider = providers.find((p: any) => p && p.isMetaMask);
              if (metaMaskProvider) {
                actualEthereumProvider = metaMaskProvider;
                console.log('✅ Found MetaMask provider in providers array');
              } else {
                // Use the first provider if MetaMask not found
                // This is a fallback - may not work for transaction sending
                actualEthereumProvider = providers[0];
                console.log('⚠️ MetaMask not found in providers array, using first provider:', providers[0]);
              }
            } else {
              console.warn('⚠️ Providers array is empty, using original provider');
            }
          } else if (ethereumProvider && (ethereumProvider as any).provider) {
            // Try to unwrap if it's a single wrapper
            // This is a fallback - may not work for transaction sending
            actualEthereumProvider = (ethereumProvider as any).provider;
            console.log('⚠️ Found wrapped ethereum provider, attempting to unwrap');
          } else {
            // Last resort: use the original provider
            // This may not work if it's a wrapper
            actualEthereumProvider = ethereumProvider;
            console.log('⚠️ Using original provider (may not work for transaction sending)');
          }
          
          // Ensure the provider has the request method
          if (!actualEthereumProvider || !actualEthereumProvider.request) {
            throw new Error('window.ethereum.request is not available. Please check your wallet connection.');
          }
          
          // Test that the provider can actually send transactions
          try {
            const testAccounts = await actualEthereumProvider.request({ method: 'eth_accounts' });
            console.log('✅ Provider is accessible, accounts:', testAccounts);
            
            // Test that request method works for transaction-like calls
            const testChainId = await actualEthereumProvider.request({ method: 'eth_chainId' });
            console.log('✅ Provider chainId:', testChainId);
          } catch (testErr: any) {
            console.warn('⚠️ Warning: Provider test failed:', testErr);
          }
          
          // Use viem to create a wallet client for better provider management
          // This ensures proper transaction handling
          try {
            const walletClient = createWalletClient({
              chain: sepolia,
              transport: custom(actualEthereumProvider),
            });
            console.log('✅ Viem wallet client created successfully');
          } catch (viemError: any) {
            console.warn('⚠️ Warning: Could not create viem wallet client:', viemError);
            // Continue anyway - relayer SDK will use window.ethereum directly
          }
          
          // According to Zama documentation: https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer/initialization
          // network parameter can be either:
          // 1. RPC URL string (e.g., 'https://eth-sepolia.public.blastapi.io')
          // 2. EIP1193 provider (e.g., window.ethereum)
          // For transaction sending, we need EIP1193 provider
          // CRITICAL: The relayer SDK uses network.request('eth_sendTransaction', ...) for transaction requests
          // According to documentation examples, network should be set twice:
          // 1. First in the config object: { ...SepoliaConfig, network: window.ethereum }
          // 2. Then explicitly: config.network = window.ethereum
          // This ensures the network parameter is correctly set for transaction sending
          // CRITICAL: According to Zama SDK source code, SepoliaConfig has:
          // - relayerUrl: 'https://relayer.testnet.zama.org'
          // - gatewayChainId: 10901
          // We must use SepoliaConfig values and override network with window.ethereum
          const config = {
            ...SepoliaConfig,
            chainId: chainId,
            // CRITICAL: network must be the raw window.ethereum object (EIP1193 provider)
            // The relayer SDK uses this directly to call network.request('eth_sendTransaction', ...)
            // According to documentation, network can be EIP1193 provider for transaction sending
            network: actualEthereumProvider, // Raw EIP1193 provider - MUST be window.ethereum directly
          };
          
          // IMPORTANT: According to Zama documentation examples (relayer.md line 301-302, 425-426),
          // network should be set twice to ensure it's correctly configured:
          // 1. First in the config object (already done above)
          // 2. Then explicitly override it (this ensures SepoliaConfig's network is overridden)
          config.network = actualEthereumProvider;
          
          // Log the actual config values from SepoliaConfig
          console.log('Using SepoliaConfig values:', {
            relayerUrl: config.relayerUrl,
            gatewayChainId: config.gatewayChainId,
            chainId: config.chainId,
          });
          
          // Verify relayer URL is accessible (non-blocking)
          if (config.relayerUrl) {
            try {
              const relayerBaseUrl = config.relayerUrl.replace(/\/$/, ''); // Remove trailing slash
              const healthUrl = `${relayerBaseUrl}/health`;
              console.log('Checking relayer health at:', healthUrl);
              const relayerHealthCheck = await fetch(healthUrl, { 
                method: 'GET',
                signal: AbortSignal.timeout(5000) // 5 second timeout
              });
              console.log('Relayer health check status:', relayerHealthCheck.status);
            } catch (healthErr: any) {
              console.warn('⚠️ Relayer health check failed (this is not critical, relayer may not have /health endpoint):', healthErr.message);
            }
          }
          
          // Verify that network is the raw ethereum provider
          if (config.network !== actualEthereumProvider) {
            console.warn('WARNING: network config might not be the raw ethereum provider');
          }
          
          // Additional verification: ensure network has request method
          if (!config.network || !(config.network as any).request) {
            throw new Error('Network provider does not have request method. Cannot send transactions.');
          }
          
          console.log('FHEVM Config:', {
            chainId: config.chainId,
            relayerUrl: config.relayerUrl,
            hasNetwork: !!config.network,
            hasRequest: !!(config.network as any)?.request,
            isRawEthereum: config.network === actualEthereumProvider,
            networkType: typeof config.network,
            providerType: typeof actualEthereumProvider,
          });
          
          try {
            console.log('Creating FHEVM instance with config:', {
              chainId: config.chainId,
              relayerUrl: config.relayerUrl,
              network: 'window.ethereum',
            });
            
            // Add timeout to createInstance call (30 seconds)
            const createInstancePromise = createInstance(config);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('FHEVM instance creation timeout (30s). Relayer may be unavailable.')), 30000);
            });
            
            const fhevmInstance = await Promise.race([createInstancePromise, timeoutPromise]) as FhevmInstance;
            setInstance(fhevmInstance);
            setIsReady(true);
            setError(null);
            setRetryCount(0);
            console.log('✅ FHEVM instance created successfully');
          } catch (fhevmError: any) {
            // Only log detailed error in development mode
            if (process.env.NODE_ENV === 'development') {
              console.error(`FHEVM instance creation error (attempt ${attempt + 1}/${maxRetries}):`, fhevmError);
              console.error('Error details:', {
                message: fhevmError.message,
                stack: fhevmError.stack,
                name: fhevmError.name,
                code: fhevmError.code,
                data: fhevmError.data,
                transaction: fhevmError.transaction,
              });
            } else {
              // In production, only log a simple warning
              console.warn(`FHEVM initialization issue (attempt ${attempt + 1}/${maxRetries}):`, fhevmError.message);
            }
            
            // Retry logic for transient errors
            const isRetryableError = 
              fhevmError.message?.includes('missing revert data') || 
              fhevmError.message?.includes('timeout') ||
              fhevmError.message?.includes('fetch') ||
              fhevmError.message?.includes('network') ||
              fhevmError.code === 'CALL_EXCEPTION';
            
            if (isRetryableError && attempt < maxRetries - 1) {
              const retryDelay = (attempt + 1) * 2000; // 2s, 4s, 6s
              console.log(`⏳ Retrying FHEVM initialization in ${retryDelay}ms... (attempt ${attempt + 2}/${maxRetries})`);
              setRetryCount(attempt + 1);
              setTimeout(() => {
                initializeFHEVM(attempt + 1);
              }, retryDelay);
              return; // Don't set error yet, wait for retry
            }
            
            // Provide more helpful error messages
            let errorMessage = `FHEVM initialization failed: ${fhevmError.message}`;
            
            // Check for specific error types
            if (fhevmError.message?.includes('missing revert data') || fhevmError.code === 'CALL_EXCEPTION') {
              // This usually means the contract call failed - could be network issue or wrong chain
              if (fhevmError.transaction?.to === '0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A') {
                // KMS contract call failed
                errorMessage = 'FHEVM Gateway contract call failed. Please ensure you are connected to Sepolia network (Chain ID: 11155111) and try again. If the problem persists, the FHEVM Gateway service may be temporarily unavailable.';
              } else {
                errorMessage = 'FHEVM contract call failed. Please ensure you are connected to Sepolia network (Chain ID: 11155111) and try refreshing the page.';
              }
            } else if (fhevmError.message?.includes('Bad JSON') || fhevmError.message?.includes('Bad JSON')) {
              errorMessage = 'FHEVM Relayer Error: Unable to communicate with relayer service. The relayer may be temporarily unavailable. Please try again in a few moments. If the problem persists, check your network connection.';
            } else if (fhevmError.message?.includes('timeout')) {
              errorMessage = 'FHEVM initialization timeout: The relayer service did not respond in time. Please check your network connection and try again.';
            } else if (fhevmError.message?.includes('fetch') || fhevmError.message?.includes('network')) {
              errorMessage = 'FHEVM Network Error: Unable to reach relayer service. Please check your internet connection.';
            }
            
            setError(errorMessage);
            setIsReady(false);
          }
        } else {
          // No EIP1193 provider available
          // This should not happen if Privy embedded wallet is properly configured
          // Only show error if we truly have no wallet connection
          if (!embeddedWallet && !provider) {
            // No wallet at all - user needs to connect
            setError('Please connect your wallet to use FHEVM features.');
            setIsReady(false);
            console.warn('⚠️ FHEVM initialization skipped: No wallet connected.');
          } else {
            // We have a wallet but couldn't extract EIP1193 provider
            // This is a technical issue, not a user issue
            setError('FHEVM initialization failed: Could not access wallet provider. Please try refreshing the page.');
            setIsReady(false);
            console.error('❌ FHEVM initialization failed: Wallet available but EIP1193 provider not accessible.');
          }
        }
      } catch (err: any) {
        console.error('Error initializing FHEVM:', err);
        setError(err.message || 'Failed to initialize FHEVM');
        setIsReady(false);
      }
    };

    initializeFHEVM(0);
  }, [provider, embeddedWallet]);

  const encrypt = useCallback(async (
    value: number,
    contractAddress: string,
    userAddress: string
  ): Promise<EncryptedInput> => {
    if (!instance || !isReady) {
      throw new Error('FHEVM is not ready');
    }

    try {
      // Create encrypted input using FHEVM instance
      // Based on Zama's template: fhevm.createEncryptedInput(contractAddress, userAddress).add32(value).encrypt()
      const encryptedInput = await instance
        .createEncryptedInput(contractAddress, userAddress)
        .add32(value)
        .encrypt();
      
      return {
        handles: encryptedInput.handles,
        inputProof: encryptedInput.inputProof,
      };
    } catch (err: any) {
      console.error('Error encrypting value:', err);
      throw new Error('Failed to encrypt value: ' + err.message);
    }
  }, [instance, isReady]);

  const encryptBool = useCallback(async (
    value: boolean,
    contractAddress: string,
    userAddress: string
  ): Promise<EncryptedInput> => {
    if (!instance || !isReady) {
      throw new Error('FHEVM is not ready');
    }

    try {
      // Create encrypted input for boolean (Up/Down)
      // Based on Zama's template: fhevm.createEncryptedInput(contractAddress, userAddress).addBool(value).encrypt()
      // Note: encrypt() will trigger a transaction request from the relayer for input proof
      // The relayer SDK uses the network provider from the instance config (set during initialization)
      // This works with both MetaMask (window.ethereum) and Privy embedded wallets
      console.log('Encrypting boolean value:', value, 'for contract:', contractAddress, 'user:', userAddress);
      
      const buffer = instance.createEncryptedInput(contractAddress, userAddress);
      buffer.addBool(value);
      
      // The relayer SDK will use the provider from the instance config to send the transaction
      // No need to check window.ethereum - the instance was already initialized with the correct provider
      console.log('Calling encrypt() - this will trigger a transaction request via relayer...');
      
      const encryptedInput = await buffer.encrypt();
      
      console.log('Encryption successful, handles:', encryptedInput.handles.length);
      return {
        handles: encryptedInput.handles,
        inputProof: encryptedInput.inputProof,
      };
    } catch (err: any) {
      console.error('Error encrypting boolean:', err);
      
      // Preserve the original error message for better debugging
      if (err.message?.includes('Rejected') || err.message?.includes('Transaction rejected') || err.message?.includes('User rejected')) {
        throw new Error('Encryption transaction was rejected. Please approve the transaction in your wallet when it appears.');
      } else if (err.message?.includes('Bad status')) {
        throw new Error('Encryption failed: ' + (err.message || 'Unknown error'));
      } else if (err.message?.includes('Bad JSON') || err.message?.includes('Bad JSON')) {
        // Relayer response parsing error - could be network issue or relayer down
        throw new Error('FHEVM Relayer error: Unable to communicate with relayer. Please check your network connection and try again. If the problem persists, the relayer service may be temporarily unavailable.');
      } else {
        throw new Error('Failed to encrypt boolean: ' + (err.message || 'Unknown error'));
      }
    }
  }, [instance, isReady]);

  const decrypt = useCallback(async (
    encrypted: string,
    contractAddress: string,
    signer: ethers.JsonRpcSigner
  ): Promise<number> => {
    if (!instance || !isReady) {
      throw new Error('FHEVM is not ready');
    }

    try {
      // Note: Relayer SDK uses userDecrypt with different API than hardhat plugin
      // For now, this is a placeholder - actual implementation depends on relayer SDK API
      // Based on Zama's relayer SDK, userDecrypt requires keypair, signature, etc.
      // This is more complex than hardhat plugin's userDecryptEuint
      
      // TODO: Implement proper decryption using relayer SDK's userDecrypt API
      // For now, throw error to indicate this needs proper implementation
      throw new Error('Decryption using relayer SDK requires proper keypair and signature setup. See Zama documentation.');
      
      // Example (commented out - needs proper implementation):
      // const keypair = instance.generateKeypair();
      // const eip712 = instance.createEIP712(...);
      // const result = await instance.userDecrypt(...);
      // return Number(result[encrypted]);
    } catch (err: any) {
      console.error('Error decrypting value:', err);
      throw new Error('Failed to decrypt value: ' + err.message);
    }
  }, [instance, isReady]);

  const encrypt32 = useCallback(async (
    value: number,
    contractAddress: string,
    userAddress: string
  ): Promise<EncryptedInput> => {
    if (!instance || !isReady) {
      throw new Error('FHEVM is not ready');
    }

    try {
      // Create encrypted input for uint32 (leverage: 1-5)
      const encryptedInput = await instance
        .createEncryptedInput(contractAddress, userAddress)
        .add32(value)
        .encrypt();
      
      return {
        handles: encryptedInput.handles,
        inputProof: encryptedInput.inputProof,
      };
    } catch (err: any) {
      console.error('Error encrypting uint32 value:', err);
      if (err.message?.includes('Bad JSON') || err.message?.includes('Bad JSON')) {
        throw new Error('FHEVM Relayer error: Unable to communicate with relayer. Please check your network connection and try again.');
      }
      throw new Error('Failed to encrypt uint32 value: ' + err.message);
    }
  }, [instance, isReady]);

  const encrypt64 = useCallback(async (
    value: bigint,
    contractAddress: string,
    userAddress: string
  ): Promise<EncryptedInput> => {
    if (!instance || !isReady) {
      throw new Error('FHEVM is not ready');
    }

    try {
      // Create encrypted input for uint64 (stop loss price)
      // Convert bigint to number (should be safe for price values)
      const valueNumber = Number(value);
      if (valueNumber > Number.MAX_SAFE_INTEGER) {
        throw new Error('Value too large for uint64 encryption');
      }
      
      const encryptedInput = await instance
        .createEncryptedInput(contractAddress, userAddress)
        .add64(valueNumber)
        .encrypt();
      
      return {
        handles: encryptedInput.handles,
        inputProof: encryptedInput.inputProof,
      };
    } catch (err: any) {
      console.error('Error encrypting uint64 value:', err);
      if (err.message?.includes('Bad JSON') || err.message?.includes('Bad JSON')) {
        throw new Error('FHEVM Relayer error: Unable to communicate with relayer. Please check your network connection and try again.');
      }
      throw new Error('Failed to encrypt uint64 value: ' + err.message);
    }
  }, [instance, isReady]);

  return {
    encrypt,
    encryptBool,
    encrypt32,
    encrypt64,
    decrypt,
    isReady,
    error,
    instance,
  };
};
