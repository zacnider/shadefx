import { ethers } from 'ethers';
import { createInstance, type FhevmInstance, type RelayerEncryptedInput } from '@zama-fhe/relayer-sdk/web';

/**
 * Initialize FHEVM instance
 * @param provider Ethers provider instance
 * @returns FHEVM instance
 */
export const initFHEVM = async (provider: ethers.Provider): Promise<FhevmInstance> => {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  // Get EIP1193 provider from BrowserProvider
  let eip1193Provider: any;
  if (provider instanceof ethers.BrowserProvider) {
    eip1193Provider = (provider as any).provider;
  } else if (typeof window !== 'undefined' && (window as any).ethereum) {
    eip1193Provider = (window as any).ethereum;
  } else {
    throw new Error('No EIP1193 provider available');
  }

  // Use SepoliaConfig for Sepolia
  const { SepoliaConfig } = await import('@zama-fhe/relayer-sdk/web');
  const config = {
    ...SepoliaConfig,
    chainId,
    network: eip1193Provider,
  };

  // Create FHEVM instance using Zama's relayer SDK
  const instance = await createInstance(config);

  return instance;
};

/**
 * Encrypt a value for euint32
 * @param instance FHEVM instance
 * @param value Value to encrypt (should be scaled by 10000)
 * @param contractAddress Contract address
 * @param userAddress User address
 * @returns Encrypted input with handles and proof
 */
export const encrypt32 = async (
  instance: FhevmInstance,
  value: number,
  contractAddress: string,
  userAddress: string
): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }> => {
  // Based on Zama's template: fhevm.createEncryptedInput(contractAddress, userAddress).add32(value).encrypt()
  const encryptedInput = await instance
    .createEncryptedInput(contractAddress, userAddress)
    .add32(value)
    .encrypt();
  
  return {
    handles: encryptedInput.handles,
    inputProof: encryptedInput.inputProof,
  };
};

/**
 * Decrypt an encrypted value
 * @param instance FHEVM instance
 * @param encrypted Encrypted value (bytes32)
 * @param contractAddress Contract address
 * @param signer Ethers signer
 * @returns Decrypted number
 */
export const decrypt = async (
  instance: FhevmInstance,
  encrypted: string,
  contractAddress: string,
  signer: ethers.JsonRpcSigner
): Promise<number> => {
  // Note: Relayer SDK uses userDecrypt with different API
  // This is a placeholder - actual implementation requires keypair and signature
  // For now, throw error to indicate this needs proper implementation
  throw new Error('Decryption using relayer SDK requires proper keypair and signature setup. See Zama documentation.');
};

