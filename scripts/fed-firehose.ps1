# fed-firehose.ps1 — Compare live event streams on both federation nodes.
# Shows event counts by collection and samples recent cross-node events.
# Usage: .\scripts\fed-firehose.ps1 [-Tail 20]

param(
  [string]$NodeA = "http://localhost:3000",
  [string]$NodeB = "http://localhost:3001",
  [int]$Tail     = 10   # recent events to show per node
)

Write-Host ""
Write-Host "=== Federation Firehose Comparison ===" -ForegroundColor White

try {
  $fhA = Invoke-RestMethod "$NodeA/api/firehose" -ErrorAction Stop
  $fhB = Invoke-RestMethod "$NodeB/api/firehose" -ErrorAction Stop
} catch {
  Write-Host "❌ Could not reach one or both nodes: $_" -ForegroundColor Red
  Write-Host "   Run fed-health.ps1 first." -ForegroundColor DarkRed
  exit 1
}

function Show-EventCounts($label, $fh) {
  Write-Host ""
  Write-Host "  $label — $($fh.total) total events (showing last $($fh.events.Count)):" -ForegroundColor Cyan
  $fh.events |
    Group-Object collection |
    Sort-Object Count -Descending |
    ForEach-Object {
      $bar = "#" * [Math]::Min($_.Count, 40)
      Write-Host ("    {0,-45} {1,4}  {2}" -f $_.Name, $_.Count, $bar)
    }
}

Show-EventCounts "Node A" $fhA
Show-EventCounts "Node B" $fhB

# ── Recent events ─────────────────────────────────────────────────────────────

function Show-RecentEvents($label, $fh, $n) {
  Write-Host ""
  Write-Host "  $label — last $n events:" -ForegroundColor Cyan
  $fh.events |
    Select-Object -Last $n |
    ForEach-Object {
      $ts   = if ($_.timestamp) { [datetime]::Parse($_.timestamp).ToString("HH:mm:ss") } else { "??:??:??" }
      $coll = ($_.collection -replace "network\.mycelium\.", "").PadRight(24)
      $did  = if ($_.did) { $_.did.Substring(0, [Math]::Min(24, $_.did.Length)) } else { "" }
      Write-Host ("    {0}  {1}  {2}" -f $ts, $coll, $did) -ForegroundColor Gray
    }
}

Show-RecentEvents "Node A" $fhA $Tail
Show-RecentEvents "Node B" $fhB $Tail

# ── Cross-node detection ──────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Cross-node event detection:" -ForegroundColor Cyan

# DIDs seen on each node's events (actors posting events)
$aDids = ($fhA.events | Where-Object { $_.did } | Select-Object -ExpandProperty did | Select-Object -Unique)
$bDids = ($fhB.events | Where-Object { $_.did } | Select-Object -ExpandProperty did | Select-Object -Unique)

# DIDs that appear on one node but came from the other node's PDS
$bActorsOnA = $aDids | Where-Object { $bDids -contains $_ }
$aActorsOnB = $bDids | Where-Object { $aDids -contains $_ }

if ($bActorsOnA.Count -gt 0) {
  Write-Host ""
  Write-Host "  ✅ Node B actors seen in Node A's firehose ($($bActorsOnA.Count) DID(s)):" -ForegroundColor Green
  $bActorsOnA | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGreen }
}

if ($aActorsOnB.Count -gt 0) {
  Write-Host ""
  Write-Host "  ✅ Node A actors seen in Node B's firehose ($($aActorsOnB.Count) DID(s)):" -ForegroundColor Green
  $aActorsOnB | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGreen }
}

if ($bActorsOnA.Count -eq 0 -and $aActorsOnB.Count -eq 0) {
  Write-Host ""
  Write-Host "  ⏳ No cross-node DIDs in firehose yet — Jetstream may still be syncing." -ForegroundColor Yellow
  Write-Host "     Wait ~60s and re-run, or check: docker compose -f docker-compose.federation.yml logs jetstream-a" -ForegroundColor DarkYellow
}

Write-Host ""
