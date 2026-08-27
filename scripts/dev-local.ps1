# OneDrive-safe local dev for Everything Warframe.
# Copies the repo to %LOCALAPPDATA%\EverythingWarframe-dev (outside OneDrive sync)
# and runs npm start there. Avoids Vite/Electron EPERM locks from file sync.
#
# Usage (from repo root or anywhere):
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-local.ps1
#   npm run dev:local

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Dest = Join-Path $env:LOCALAPPDATA 'EverythingWarframe-dev'

Write-Host "Source: $RepoRoot"
Write-Host "Dest:   $Dest"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# Mirror source → local copy. Exclude heavy/generated dirs (reinstall deps in dest).
$excludeDirs = @(
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  '.git',
  '.vite',
  'coverage'
)

$xdArgs = @()
foreach ($d in $excludeDirs) {
  $xdArgs += '/XD'
  $xdArgs += $d
}

& robocopy $RepoRoot $Dest /MIR /NFL /NDL /NJH /NJS /nc /ns /np @xdArgs
# robocopy exit codes 0–7 are success-ish
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

Set-Location $Dest

if (-not (Test-Path (Join-Path $Dest 'node_modules'))) {
  Write-Host 'Installing dependencies in local copy…'
  npm install
} else {
  Write-Host 'node_modules present — skip npm install (delete it to force refresh)'
}

Write-Host 'Starting Everything Warframe from local (non-OneDrive) path…'
npm start
