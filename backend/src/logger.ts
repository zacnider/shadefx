export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel;

  constructor(level: string = 'info') {
    this.level = this.parseLevel(level);
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
      console.log(`[${timestamp}] [${prefix}]`, ...args);
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

export const logger = new Logger(process.env.LOG_LEVEL || 'info');

