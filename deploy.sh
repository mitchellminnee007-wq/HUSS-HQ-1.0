#!/bin/bash
set -e

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_NAME="huss-hq-bot"

echo ""
echo "============================================"
echo "  HUSS HQ Bot — Deployment Script"
echo "============================================"
echo ""

cd "$DEPLOY_DIR"

# ── 1. Check .env exists ──────────────────────────────────────────────────────
echo "[1/4] Checking .env..."
if [ ! -f .env ]; then
  echo ""
  echo "  ERROR: .env file not found in $DEPLOY_DIR"
  echo "  Re-run deploy.ps1 from Windows — it uploads .env automatically."
  echo ""
  exit 1
fi
echo "  .env found."

# ── 2. Install dependencies ───────────────────────────────────────────────────
echo "[2/4] Installing Node dependencies..."
npm install --omit=dev

# ── 3. Register slash commands with Discord ───────────────────────────────────
echo "[3/4] Deploying slash commands..."
node deploy-commands.js

# ── 4. Start or restart bot with PM2 ─────────────────────────────────────────
echo "[4/4] Starting bot with PM2..."
if pm2 describe "$BOT_NAME" > /dev/null 2>&1; then
  pm2 restart "$BOT_NAME"
  echo "  Bot restarted."
else
  pm2 start ecosystem.config.js
  echo "  Bot started."
fi

# ── Persist PM2 across reboots ────────────────────────────────────────────────
pm2 save
STARTUP_CMD=$(pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo" | tail -1)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD"
fi

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
echo ""
pm2 status
