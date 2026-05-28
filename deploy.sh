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
echo "[1/6] Checking .env..."
if [ ! -f .env ]; then
  echo ""
  echo "  ERROR: .env file not found in $DEPLOY_DIR"
  echo "  Re-run deploy.ps1 from Windows — it uploads .env automatically."
  echo ""
  exit 1
fi
echo "  .env found."

# ── 2. Install Node.js 20 LTS (if not present) ───────────────────────────────
echo "[2/6] Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  Node.js not found. Installing via NodeSource..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  else
    echo "  ERROR: No supported package manager found (apt/dnf/yum)."
    exit 1
  fi
  echo "  Node.js $(node --version) installed."
else
  echo "  Node.js $(node --version) already installed."
fi

# ── 3. Install PM2 (if not present) ──────────────────────────────────────────
echo "[3/6] Checking PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "  PM2 not found. Installing..."
  npm install -g pm2
  echo "  PM2 $(pm2 --version) installed."
else
  echo "  PM2 $(pm2 --version) already installed."
fi

# ── 4. Install Node dependencies ─────────────────────────────────────────────
echo "[4/6] Installing Node dependencies..."
npm install --omit=dev

# ── 5. Register slash commands with Discord ───────────────────────────────────
echo "[5/6] Deploying slash commands..."
node deploy-commands.js

# ── 6. Start or restart bot with PM2 ─────────────────────────────────────────
echo "[6/6] Starting bot with PM2..."
if pm2 describe "$BOT_NAME" > /dev/null 2>&1; then
  pm2 restart "$BOT_NAME"
  echo "  Bot restarted."
else
  pm2 start ecosystem.config.js
  echo "  Bot started."
fi

# ── Persist PM2 across reboots ────────────────────────────────────────────────
pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
echo ""
pm2 status
