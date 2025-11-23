module.exports = {
  apps: [
    {
      name: 'binance-price-updater',
      script: 'ts-node',
      args: 'services/binancePriceUpdater.ts',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        BINANCE_UPDATE_INTERVAL: '30000', // 30 seconds
      },
      error_file: './logs/binance-updater-error.log',
      out_file: './logs/binance-updater-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'limit-order-executor',
      script: 'ts-node',
      args: 'services/limitOrderExecutor.ts',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        LIMIT_ORDER_EXECUTION_INTERVAL: '30000', // 30 seconds
      },
      error_file: './logs/limit-order-executor-error.log',
      out_file: './logs/limit-order-executor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    }
  ]
};

