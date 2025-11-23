import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';
import { createConfig } from '@privy-io/wagmi';

export const PRIVY_APP_ID = 'cmhw7oti70083kz0caoaaruic';

export const privyConfig = {
  // Login methods - only email
  loginMethods: ['email'] as ('email')[],
  
  // Appearance
  appearance: {
    theme: 'dark' as const,
    accentColor: '#6366f1' as const, // Primary color
    logo: '/logo.png',
  },
  
  // Embedded wallet settings
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'all-users' as const, // Create embedded wallet for all users (email or wallet login)
      // Require embedded wallet for email login
      // External wallets are only available for wallet login method
    },
    requireUserPasswordOnCreate: false,
    noPromptOnSignature: true, // Automatically sign transactions without popup (only for embedded wallet)
    showWalletUIs: false, // Disable wallet confirmation modals for smoother UX (transactions will be auto-signed)
  },
  
  // External wallet configuration removed
  // Privy handles external wallets automatically based on login method
  // Email login will only create embedded wallet
  // Wallet login will allow external wallet connections
  
  // Legal
  legal: {
    termsAndConditionsUrl: 'https://shadefx.cc/terms',
    privacyPolicyUrl: 'https://shadefx.cc/privacy',
  },
  
  // Additional settings for better compatibility
  mfa: {
    noPromptOnMfaRequired: false,
  },
};

// Create Privy Wagmi config
// Note: Privy handles RPC internally, we just need to specify the chain
export const wagmiConfig = createConfig({
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(), // Privy will use its own RPC endpoint
  },
});

