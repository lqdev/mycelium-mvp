# fed-health.ps1 — Quick sanity check: are both federation nodes up and active?
# Usage: .\scripts\fed-health.ps1

param(
  [string]$NodeA = "http://localhost:3000",
  [string]$NodeB = "http://localhost:3001"
)

function Check-Node($label, $base) {
  try {
    $s = Invoke-RestMethod "$base/api/status" -ErrorAction Stop
    Write-Host ""
    Write-Host "  $label ($base)" -ForegroundColor Cyan
    Write-Host "    Tasks posted   : $($s.tasksPosted) / $($s.tasksTotal)" -ForegroundColor $(if ($s.tasksPosted -gt 0) { 'Green' } else { 'Yellow' })
    Write-Host "    Tasks accepted : $($s.tasksAccepted)" -ForegroundColor $(if ($s.tasksAccepted -gt 0) { 'Green' } else { 'Yellow' })
    Write-Host "    Firehose events: $($s.firehoseEvents)" -ForegroundColor $(if ($s.firehoseEvents -gt 0) { 'Green' } else { 'Yellow' })
    Write-Host "    Agents         : $($s.agents)"
    return $true
  } catch {
    Write-Host ""
    Write-Host "  $label ($base) — UNREACHABLE" -ForegroundColor Red
    Write-Host "    $_" -ForegroundColor DarkRed
    return $false
  }
}

Write-Host ""
Write-Host "=== Federation Health ===" -ForegroundColor White
$aOk = Check-Node "Node A" $NodeA
$bOk = Check-Node "Node B" $NodeB
Write-Host ""

if ($aOk -and $bOk) {
  Write-Host "✅ Both nodes reachable. Run fed-tasks.ps1 or fed-stamps.ps1 next." -ForegroundColor Green
} elseif (-not $aOk -and -not $bOk) {
  Write-Host "❌ Neither node is up. Run: docker compose -f docker-compose.federation.yml up --build" -ForegroundColor Red
} else {
  Write-Host "⚠️  One node is down. Check docker compose logs." -ForegroundColor Yellow
}
Write-Host ""
