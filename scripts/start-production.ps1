# Local production boot — build, reindex, verify logistics API, start server.
# Usage (from repo root): .\scripts\start-production.ps1
# Does NOT push to GitHub.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Building packages..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Reindexing knowledge..." -ForegroundColor Cyan
npm run reindex
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Checking logistics API..." -ForegroundColor Cyan
npm run check:acocam-api
if ($LASTEXITCODE -ne 0) {
  Write-Host "WARN: Logistics API check failed — chat FAQ works; tracking/quotes may fail." -ForegroundColor Yellow
}

if (-not (Test-Path ".env")) {
  Write-Host "WARN: No .env file. Copy env.production.example to .env and set live keys." -ForegroundColor Yellow
}

Write-Host "==> Starting chatbot API..." -ForegroundColor Green
npm run start
