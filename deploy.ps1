# deploy.ps1 — Run this from the HUSS-HQ-1.0 folder on Windows
# Usage: .\deploy.ps1
# Requires: OpenSSH (built into Windows 10/11)

$VPS      = "root@37.97.169.128"
$REMOTE   = "/root/HUSS-HQ-1.0"
$EnvFile  = Join-Path $PSScriptRoot ".env"
$Script   = Join-Path $PSScriptRoot "deploy.sh"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  HUSS HQ Bot — Windows Deploy Script"      -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Verify local .env exists ──────────────────────────────────────────────────
if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found at $EnvFile. Aborting."
    exit 1
}

# ── Upload .env and deploy.sh to VPS ─────────────────────────────────────────
Write-Host "[1/3] Uploading .env and deploy.sh to VPS..." -ForegroundColor Yellow
scp "$EnvFile" "${VPS}:${REMOTE}/.env"
if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed for .env"; exit 1 }

scp "$Script" "${VPS}:${REMOTE}/deploy.sh"
if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed for deploy.sh"; exit 1 }

# ── Make deploy.sh executable and run it ─────────────────────────────────────
Write-Host "[2/3] Running deploy.sh on VPS..." -ForegroundColor Yellow
ssh $VPS "chmod +x ${REMOTE}/deploy.sh && bash ${REMOTE}/deploy.sh"
if ($LASTEXITCODE -ne 0) { Write-Error "Remote deploy failed."; exit 1 }

Write-Host ""
Write-Host "[3/3] Done!" -ForegroundColor Green
Write-Host ""
