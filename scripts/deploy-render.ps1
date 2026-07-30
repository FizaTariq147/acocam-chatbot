# Render.com deploy helper (Docker Hub path, no GitHub).
# Usage: .\scripts\deploy-render.ps1
#        .\scripts\deploy-render.ps1 -DockerHubUser yourname

param(
  [string]$DockerHubUser = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "`n==> ACOCAM chatbot — Render deploy prep`n" -ForegroundColor Cyan

Write-Host "1. Production checklist..." -ForegroundColor Yellow
npm run check:prod
if ($LASTEXITCODE -ne 0) {
  Write-Host "Fix .env first, then re-run." -ForegroundColor Red
  exit 1
}

Write-Host "`n2. Render environment variables (copy to dashboard):" -ForegroundColor Yellow
node scripts/render-env-export.mjs

Write-Host "3. Docker check..." -ForegroundColor Yellow
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host @"

Docker is NOT installed. Choose one:

  A) Install Docker Desktop (recommended for no-GitHub deploy):
     https://www.docker.com/products/docker-desktop/
     Restart PC, then re-run: .\scripts\deploy-render.ps1

  B) Render builds from GitHub (no local Docker):
     Push repo to a PRIVATE GitHub repo, connect on render.com,
     set Runtime=Docker, Dockerfile=./Dockerfile, Plan=Free.
     See docs/RENDER_LIVE_NOW.md

"@ -ForegroundColor Red
  exit 1
}

if (-not $DockerHubUser) {
  $DockerHubUser = Read-Host "Docker Hub username"
}
if (-not $DockerHubUser.Trim()) {
  Write-Host "Docker Hub username required." -ForegroundColor Red
  exit 1
}

$image = "$DockerHubUser/acocam-chatbot-api:latest"
Write-Host "`n4. Building image: $image" -ForegroundColor Yellow
Write-Host "   (first build may take 5-10 minutes)`n" -ForegroundColor Gray

docker build -t $image .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n5. Push to Docker Hub (login if prompted)..." -ForegroundColor Yellow
docker push $image
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host @"

==> Image pushed successfully!

Next — Render Dashboard (no credit card for Free plan):
  1. https://dashboard.render.com → New + → Web Service
  2. Deploy an existing image from a registry
  3. Image: docker.io/$image
  4. Instance type: Free
  5. Health check path: /v1/health
  6. Paste env vars from step 2 above (mark _KEY vars as Secret)
  7. Create Web Service

Test after deploy:
  Invoke-RestMethod https://YOUR-SERVICE.onrender.com/v1/health

Full guide: docs/RENDER_LIVE_NOW.md

"@ -ForegroundColor Green
