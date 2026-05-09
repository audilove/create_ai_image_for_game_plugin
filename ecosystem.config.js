module.exports = {
  apps: [
    {
      name: 'gen-image-bot',
      script: 'bin/bot.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        TELEGRAM_DROP_PENDING: '1',
      },
      out_file: 'logs/bot-out.log',
      error_file: 'logs/bot-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
