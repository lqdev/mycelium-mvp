# fed-stamps.ps1 — Killer signal: prove cross-node reputation stamps.
# Finds agents on Node B that earned stamps for tasks posted by Node A's Mayor,
# and vice versa. A single result row here = full cross-node AT Proto loop proven.
# Usage: .\scripts\fed-stamps.ps1 [-Agent atlas]

param(
  [string]$NodeA  = "http://localhost:3000",
  [string]$NodeB  = "http://localhost:3001",
  [string]$Agent  = ""   # optional: drill into a single agent handle
)

Write-Host ""
Write-Host "=== Cross-Node Reputation Stamps ===" -ForegroundColor White

try {
  $tasksA = Invoke-RestMethod "$NodeA/api/tasks" -ErrorAction Stop
  $tasksB = Invoke-RestMethod "$NodeB/api/tasks" -ErrorAction Stop
  $repA   = Invoke-RestMethod "$NodeA/api/reputation" -ErrorAction Stop
  $repB   = Invoke-RestMethod "$NodeB/api/reputation" -ErrorAction Stop
} catch {
  Write-Host "❌ Could not reach one or both nodes: $_" -ForegroundColor Red
  Write-Host "   Run fed-health.ps1 first." -ForegroundColor DarkRed
  exit 1
}

function Get-Did($uri) {
  if (-not $uri) { return $null }
  return ($uri -split '/')[2]
}

# Collect the DID prefixes used by each node's task URIs
$aDids = ($tasksA | Where-Object { $_.uri } | ForEach-Object { Get-Did $_.uri }) | Select-Object -Unique
$bDids = ($tasksB | Where-Object { $_.uri } | ForEach-Object { Get-Did $_.uri }) | Select-Object -Unique

# ── Per-agent deep dive ────────────────────────────────────────────────────────

function Show-AgentStamps($handle, $nodeLabel, $base, $foreignDids) {
  try {
    $detail = Invoke-RestMethod "$base/api/agents/$handle" -ErrorAction Stop
  } catch {
    Write-Host "    (could not fetch $handle from $nodeLabel)" -ForegroundColor DarkGray
    return 0
  }

  if (-not $detail.stamps -or $detail.stamps.Count -eq 0) {
    Write-Host "    $handle @ $nodeLabel — no stamps yet" -ForegroundColor DarkGray
    return 0
  }

  $crossCount = 0
  foreach ($stamp in $detail.stamps) {
    $did = Get-Did $stamp.taskUri
    $isCross = $foreignDids -contains $did
    if ($isCross) {
      $crossCount++
      Write-Host ("    ✅ {0,-10} @ {1} — stamp for task on FOREIGN node  score={2}  quality={3}" -f `
        $handle, $nodeLabel, $stamp.score, $stamp.quality) -ForegroundColor Green
      Write-Host ("       taskUri: {0}" -f $stamp.taskUri) -ForegroundColor DarkGreen
    }
  }

  if ($crossCount -eq 0) {
    Write-Host ("    {0,-10} @ {1} — {2} stamp(s), all local" -f $handle, $nodeLabel, $detail.stamps.Count) -ForegroundColor DarkGray
  }
  return $crossCount
}

# Handles to check (all 8 agents)
$handles = @("atlas","beacon","cedar","drift","echo","finch","grove","harbor")
if ($Agent) { $handles = @($Agent) }

Write-Host ""
Write-Host "  Searching for agents with cross-node stamps..." -ForegroundColor Cyan
Write-Host ""

$totalCross = 0

foreach ($h in $handles) {
  # Check this agent on Node B — did it earn stamps for Node A tasks?
  $totalCross += Show-AgentStamps $h "Node B" $NodeB $aDids
  # Check this agent on Node A — did it earn stamps for Node B tasks?
  $totalCross += Show-AgentStamps $h "Node A" $NodeA $bDids
}

Write-Host ""
if ($totalCross -gt 0) {
  Write-Host "✅ $totalCross cross-node stamp(s) found — full AT Proto federation loop proven end-to-end!" -ForegroundColor Green
} else {
  Write-Host "⏳ No cross-node stamps yet." -ForegroundColor Yellow
  Write-Host "   This requires tasks to be posted, claimed across nodes, completed, and stamped." -ForegroundColor DarkYellow
  Write-Host "   Wait ~2-3 minutes for the full task lifecycle to complete, then re-run." -ForegroundColor DarkYellow
}
Write-Host ""

# ── Summary table ─────────────────────────────────────────────────────────────

Write-Host "  Reputation summary across both nodes:" -ForegroundColor Cyan
Write-Host ""

$allRep = @()
foreach ($r in $repA) { $allRep += [PSCustomObject]@{ Node="A"; DID=$r.agentDid; Stamps=$r.totalStamps; Score=$r.averageScore } }
foreach ($r in $repB) { $allRep += [PSCustomObject]@{ Node="B"; DID=$r.agentDid; Stamps=$r.totalStamps; Score=$r.averageScore } }

$allRep | Sort-Object Node, Score -Descending | Format-Table -AutoSize
