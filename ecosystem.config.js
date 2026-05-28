module.exports = {
  apps: [
    {
      name: 'huss-hq-bot',
      script: 'index.js',
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
