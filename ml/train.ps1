# ACOCAM local training pipeline (Windows PowerShell)
# Run from repo root with .venv-ml activated:
#   .\ml\train.ps1
#   .\ml\train.ps1 -Cpu -Small -Epochs 2
#   .\ml\train.ps1 -PrepareOnly
#   .\ml\train.ps1 -Serve

param(
  [switch]$PrepareOnly,
  [switch]$TrainOnly,
  [switch]$Serve,
  [switch]$Cpu,
  [switch]$Small,
  [double]$Epochs = 0,
  [int]$BatchSize = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:VIRTUAL_ENV) {
  Write-Host "Tip: activate the ML venv first: .\.venv-ml\Scripts\Activate.ps1" -ForegroundColor Yellow
}

$argsList = @("ml/train_pipeline.py")
if ($PrepareOnly) { $argsList += "--prepare-only" }
if ($TrainOnly) { $argsList += "--train-only" }
if ($Serve) { $argsList += "--serve" }
if ($Cpu) { $argsList += "--cpu" }
if ($Small) { $argsList += "--small" }
if ($Epochs -gt 0) { $argsList += @("--epochs", "$Epochs") }
if ($BatchSize -gt 0) { $argsList += @("--batch-size", "$BatchSize") }

Write-Host "python $($argsList -join ' ')" -ForegroundColor Cyan
python @argsList
