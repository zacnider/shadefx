/**
 * Server Logger Utility
 * 
 * Sends FHEVM logs to the backend log server.
 * Only sends logs with source: "FHEVM".
 * Fails silently if server is unavailable (doesn't break frontend).
 */

const LOG_SERVER_URL = process.env.REACT_APP_LOG_SERVER_URL || 
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://localhost:3001');

interface FHEVMLogEntry {
  level: 'info' | 'error' | 'warn' | 'debug';
  source: 'FHEVM';
  userAddress?: string;
  action: string;
  message: string;
  data?: any;
}

/**
 * Send FHEVM log to server
 * Fails silently if server is unavailable
 */
export async function sendFHEVMLog(entry: FHEVMLogEntry): Promise<void> {
  // Only send FHEVM logs
  if (entry.source !== 'FHEVM') {
    return;
  }

  try {
    // Log the attempt (for debugging)
    console.log('[ServerLogger] Sending FHEVM log to:', `${LOG_SERVER_URL}/api/logs/fhevm`, entry.action);
    
    const response = await fetch(`${LOG_SERVER_URL}/api/logs/fhevm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(entry),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[ServerLogger] Failed to send log to server:', response.status, errorText);
    } else {
      console.log('[ServerLogger] Log sent successfully:', entry.action);
    }
  } catch (error: any) {
    // Log error for debugging (but don't break frontend)
    console.error('[ServerLogger] Could not send log to server:', error?.message || error, 'URL:', LOG_SERVER_URL);
  }
}

/**
 * Helper functions for common FHEVM log actions
 */
export const fhevmLog = {
  init: (message: string, data?: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'info',
      source: 'FHEVM',
      userAddress,
      action: 'init',
      message,
      data,
    });
  },

  encryptBool: (message: string, data?: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'info',
      source: 'FHEVM',
      userAddress,
      action: 'encryptBool',
      message,
      data,
    });
  },

  encrypt32: (message: string, data?: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'info',
      source: 'FHEVM',
      userAddress,
      action: 'encrypt32',
      message,
      data,
    });
  },

  encrypt64: (message: string, data?: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'info',
      source: 'FHEVM',
      userAddress,
      action: 'encrypt64',
      message,
      data,
    });
  },

  error: (message: string, error: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'error',
      source: 'FHEVM',
      userAddress,
      action: 'error',
      message,
      data: {
        error: error?.message || String(error),
        stack: error?.stack,
      },
    });
  },

  warn: (message: string, data?: any, userAddress?: string) => {
    sendFHEVMLog({
      level: 'warn',
      source: 'FHEVM',
      userAddress,
      action: 'warn',
      message,
      data,
    });
  },
};

