# fed-tasks.ps1 — Compare task URIs across both federation nodes.
# Same task IDs should appear on both nodes but with DIFFERENT at:// DIDs
# (each node posts to its own PDS). Cross-node overlap proves event propagation.
# Usage: .\scripts\fed-tasks.ps1

param(
  [string]$NodeA = "http://localhost:3000",
  [string]$NodeB = "http://localhost:3001"
)

Write-Host ""
Write-Host "=== Cross-Node Task Comparison ===" -ForegroundColor White

try {
  $a = Invoke-RestMethod "$NodeA/api/tasks" -ErrorAction Stop
  $b = Invoke-RestMethod "$NodeB/api/tasks" -ErrorAction Stop
} catch {
  Write-Host "❌ Could not reach one or both nodes: $_" -ForegroundColor Red
  Write-Host "   Run fed-health.ps1 first." -ForegroundColor DarkRed
  exit 1
}

# Extract DID prefixes from task URIs (the "authority" segment: at://<did>/...)
function Get-Did($uri) {
  if (-not $uri) { return $null }
  return ($uri -split '/')[2]
}

$aDids = ($a | Where-Object { $_.uri } | ForEach-Object { Get-Did $_.uri }) | Select-Object -Unique
$bDids = ($b | Where-Object { $_.uri } | ForEach-Object { Get-Did $_.uri }) | Select-Object -Unique

Write-Host ""
Write-Host "  Node A PDS identity (DID):" -ForegroundColor Cyan
$aDids | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkCyan }
Write-Host "  Node B PDS identity (DID):" -ForegroundColor Cyan
$bDids | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkCyan }

Write-Host ""
Write-Host "  Task status on each node:" -ForegroundColor White

# Build lookup by task ID for both nodes
$aMap = @{}; $a | ForEach-Object { $aMap[$_.id] = $_ }
$bMap = @{}; $b | ForEach-Object { $bMap[$_.id] = $_ }

$allIds = ($a + $b | Select-Object -ExpandProperty id | Sort-Object -Unique)

$crossNodeSeen = 0

foreach ($id in $allIds) {
  $ta = $aMap[$id]
  $tb = $bMap[$id]

  $statusA = if ($ta) { $ta.status.PadRight(10) } else { "(missing)  " }
  $statusB = if ($tb) { $tb.status.PadRight(10) } else { "(missing)  " }

  $didA = if ($ta) { Get-Did $ta.uri } else { "" }
  $didB = if ($tb) { Get-Did $tb.uri } else { "" }

  # Cross-node: both nodes have it but with different DIDs
  $crossNode = $didA -and $didB -and ($didA -ne $didB)
  if ($crossNode) { $crossNodeSeen++ }

  $title = if ($ta) { $ta.title } elseif ($tb) { $tb.title } else { $id }
  $flag  = if ($crossNode) { "✅ cross-node" } else { "" }

  $color = if ($crossNode) { 'Green' } elseif (-not $ta -or -not $tb) { 'Yellow' } else { 'Gray' }
  Write-Host ("    {0,-12} A:{1} B:{2} {3}" -f $id, $statusA, $statusB, $flag) -ForegroundColor $color
}

Write-Host ""
if ($crossNodeSeen -gt 0) {
  Write-Host "✅ $crossNodeSeen task(s) confirmed on both nodes with different PDS DIDs — federation is propagating events." -ForegroundColor Green
} else {
  Write-Host "⚠️  No cross-node task overlap yet. Wait ~30s and try again, or check Jetstream connectivity." -ForegroundColor Yellow
}
Write-Host ""
