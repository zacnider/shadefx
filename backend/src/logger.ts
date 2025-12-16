import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel;
  private logDir: string = '';
  private logFile: string | null = null;

  constructor(level: string = 'info', logFile?: string) {
    this.level = this.parseLevel(level);
    
    // Set up file logging if logFile is provided
    if (logFile) {
      this.logDir = path.dirname(logFile);
      this.logFile = logFile;
      
      // Ensure log directory exists
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    }
  }

  private parseLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
        return LogLevel.INFO;
      case 'warn':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  private log(level: LogLevel, prefix: string, ...args: any[]) {
    if (level >= this.level) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [${prefix}] ${args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ')}\n`;
      
      // Always log to console (existing behavior preserved)
      console.log(`[${timestamp}] [${prefix}]`, ...args);
      
      // Also log to file if configured
      if (this.logFile) {
        try {
          fs.appendFileSync(this.logFile, logMessage, 'utf8');
        } catch (err) {
          // Silently fail if file write fails (don't break existing functionality)
          console.error('Failed to write to log file:', err);
        }
      }
    }
  }

  debug(...args: any[]) {
    this.log(LogLevel.DEBUG, 'DEBUG', ...args);
  }

  info(...args: any[]) {
    this.log(LogLevel.INFO, 'INFO', ...args);
  }

  warn(...args: any[]) {
    this.log(LogLevel.WARN, 'WARN', ...args);
  }

  error(...args: any[]) {
    this.log(LogLevel.ERROR, 'ERROR', ...args);
  }
}

// Default logger (console only, for backward compatibility)
export const logger = new Logger(process.env.LOG_LEVEL || 'info');

// FHEVM logger (with file output)
export const fhevmLogger = new Logger(
  process.env.LOG_LEVEL || 'info',
  path.join(__dirname, '../../logs/fhevm.log')
);

