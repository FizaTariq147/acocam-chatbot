/**
 * PM2 process manager config for VPS / Hostinger Node hosting.
 *
 * Usage (on server, from repo root after npm run build && npm run reindex):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 *
 * The app loads .env from repo root via dotenv (see apps/api/src/platform.ts).
 * Set TRUST_PROXY=true when nginx/Caddy terminates HTTPS in front.
 */
module.exports = {
  apps: [
    {
      name: 'acocam-chatbot-api',
      script: 'apps/api/dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 8787,
        HOST: '127.0.0.1',
      },
      error_file: './data/logs/pm2-error.log',
      out_file: './data/logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
