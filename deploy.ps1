# deploy.ps1 — Run this from the HUSS-HQ-1.0 folder on Windows
# Usage: .\deploy.ps1
# Requires: OpenSSH + tar (both built into Windows 10/11)

$VPS        = "root@37.97.169.128"
$REMOTE     = "/root/HUSS-HQ-1.0"
$ProjectDir = $PSScriptRoot
$TarPath    = Join-Path $env:TEMP "huss-hq-deploy.tar.gz"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  HUSS HQ Bot — Windows Deploy Script"      -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Verify local .env exists ──────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $ProjectDir ".env"))) {
    Write-Error ".env not found in $ProjectDir. Aborting."
    exit 1
}

# ── Pack project into a tar (excluding node_modules and .git) ─────────────────
Write-Host "[1/4] Creating archive (excluding node_modules / .git)..." -ForegroundColor Yellow
if (Test-Path $TarPath) { Remove-Item $TarPath -Force }
tar -czf $TarPath `
    --exclude="./node_modules" `
    --exclude="./.git" `
    -C $ProjectDir .
if ($LASTEXITCODE -ne 0) { Write-Error "tar failed."; exit 1 }

# ── Upload archive to VPS ─────────────────────────────────────────────────────
Write-Host "[2/4] Uploading archive to VPS..." -ForegroundColor Yellow
scp $TarPath "${VPS}:/tmp/huss-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Write-Error "SCP upload failed."; exit 1 }
Remove-Item $TarPath -Force

# ── Extract on VPS and run deploy.sh ─────────────────────────────────────────
Write-Host "[3/4] Extracting and deploying on VPS..." -ForegroundColor Yellow
ssh $VPS "mkdir -p $REMOTE && rm -rf $REMOTE/features $REMOTE/commands && tar -xzf /tmp/huss-deploy.tar.gz -C $REMOTE && rm -f /tmp/huss-deploy.tar.gz && sed -i 's/\r//' $REMOTE/deploy.sh && bash $REMOTE/deploy.sh"
if ($LASTEXITCODE -ne 0) { Write-Error "Remote deploy failed."; exit 1 }

Write-Host ""
Write-Host "[4/4] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "To deploy commands globally (all servers):" -ForegroundColor Cyan
Write-Host "  1. Remove or leave GUILD_ID empty in .env"  -ForegroundColor White
Write-Host "  2. Run: node deploy-commands.js"            -ForegroundColor White
Write-Host "  3. Ensure 'Public Bot' is ON in the Discord Developer Portal" -ForegroundColor White
Write-Host "  4. Use /invite in Discord to get the shareable invite link"   -ForegroundColor White
Write-Host ""
