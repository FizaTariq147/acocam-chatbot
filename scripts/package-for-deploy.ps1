# Package repo for manual deploy (VPS upload, Docker build context check, backup).
# Does NOT include secrets (.env) or node_modules.
# Usage (repo root): .\scripts\package-for-deploy.ps1
# Output: acocam-chatbot-deploy.zip in repo root

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$zipName = "acocam-chatbot-deploy.zip"
$zipPath = Join-Path $root $zipName
$stage = Join-Path $root "dist-deploy"

Write-Host "==> Building packages (required before deploy)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Reindexing knowledge..." -ForegroundColor Cyan
npm run reindex
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Staging deploy folder..." -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

$excludeDirs = @(
  "node_modules", ".git", "dist-deploy", ".venv-ml", "ml\models", "ml\data",
  "data\sessions", "data\analytics", "data\escalations"
)
$excludeFiles = @(".env", ".env.production", ".env.production.local", $zipName)

function Should-Skip {
  param([string]$RelativePath)
  foreach ($d in $excludeDirs) {
    if ($RelativePath -like "$d*") { return $true }
  }
  $leaf = Split-Path $RelativePath -Leaf
  if ($excludeFiles -contains $leaf) { return $true }
  if ($leaf -eq "node_modules") { return $true }
  return $false
}

Get-ChildItem -Path $root -Recurse -Force | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  if (Should-Skip $rel) { return }

  $dest = Join-Path $stage $rel
  if ($_.PSIsContainer) {
    if (-not (Test-Path $dest)) {
      New-Item -ItemType Directory -Path $dest -Force | Out-Null
    }
  } else {
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  }
}

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force
Remove-Item -Recurse -Force $stage

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Created: $zipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host "Includes: built dist/, data/indexes/, tenants/, Dockerfile, render.yaml"
Write-Host "Excluded: .env, node_modules, session/analytics files"
Write-Host ""
Write-Host "Next: see docs/DEPLOY_STEP1_FREE.md (Render Docker Hub path recommended)."
