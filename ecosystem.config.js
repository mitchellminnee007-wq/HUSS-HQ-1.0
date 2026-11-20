module.exports = {
  apps: [
    {
      name: 'huss-hq-bot',
      script: 'index.js',
      interpreter: process.platform === 'linux' && require('node:fs').existsSync('/opt/huss-node-runtime/bin/node') ? '/opt/huss-node-runtime/bin/node' : 'node',
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
