#!/bin/bash
set -e

REPO_URL="https://github.com/mitchellminnee007-wq/HUSS-HQ-1.0.git"
DEPLOY_DIR="$HOME/HUSS-HQ-1.0"
BOT_NAME="huss-hq-bot"

echo ""
echo "============================================"
echo "  HUSS HQ Bot — Deployment Script"
echo "============================================"
echo ""

# ── 1. Clone or pull latest code ─────────────────────────────────────────────
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "[1/5] Pulling latest changes from GitHub..."
  git -C "$DEPLOY_DIR" pull
else
  echo "[1/5] Cloning repository..."
  git clone "$REPO_URL" "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

# ── 2. Check .env exists ──────────────────────────────────────────────────────
echo "[2/5] Checking .env..."
if [ ! -f .env ]; then
  echo ""
  echo "  ERROR: .env file not found in $DEPLOY_DIR"
  echo "  Upload it with:"
  echo "    scp .env root@37.97.169.128:$DEPLOY_DIR/.env"
  echo ""
  exit 1
fi
echo "  .env found."

# ── 3. Install dependencies ───────────────────────────────────────────────────
echo "[3/5] Installing Node dependencies..."
npm install --omit=dev

# ── 4. Register slash commands with Discord ───────────────────────────────────
echo "[4/5] Deploying slash commands..."
node deploy-commands.js

# ── 5. Start or restart bot with PM2 ─────────────────────────────────────────
echo "[5/5] Starting bot with PM2..."
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
