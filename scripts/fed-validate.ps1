# fed-validate.ps1 — Run all federation validation checks in sequence.
# Usage: .\scripts\fed-validate.ps1

param(
  [string]$NodeA = "http://localhost:3000",
  [string]$NodeB = "http://localhost:3001"
)

$root = Split-Path $PSScriptRoot -Parent
$scripts = $PSScriptRoot

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   Mycelium Federation Validation Suite   ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Magenta

Write-Host ""
Write-Host "Step 1/4 — Health" -ForegroundColor White
& "$scripts\fed-health.ps1"    -NodeA $NodeA -NodeB $NodeB

Write-Host ""
Write-Host "Step 2/4 — Task propagation" -ForegroundColor White
& "$scripts\fed-tasks.ps1"     -NodeA $NodeA -NodeB $NodeB

Write-Host ""
Write-Host "Step 3/4 — Firehose event streams" -ForegroundColor White
& "$scripts\fed-firehose.ps1"  -NodeA $NodeA -NodeB $NodeB

Write-Host ""
Write-Host "Step 4/4 — Cross-node reputation stamps (killer signal)" -ForegroundColor White
& "$scripts\fed-stamps.ps1"    -NodeA $NodeA -NodeB $NodeB
