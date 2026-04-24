# fed-stamps.ps1 — Killer signal: prove cross-node reputation stamps.
# Finds agents on Node B that earned stamps from Node A's Mayor (and vice versa)
# by querying each node's DuckDB via /api/sql. A single result row here = full
# cross-node AT Proto federation loop proven end-to-end.
# Usage: .\scripts\fed-stamps.ps1 [-NodeA http://localhost:3000] [-NodeB http://localhost:3001]

param(
  [string]$NodeA  = "http://localhost:3000",
  [string]$NodeB  = "http://localhost:3001"
)

function Invoke-SqlQuery($base, $sql) {
  $enc = [Uri]::EscapeDataString($sql)
  try {
    return (Invoke-RestMethod "$base/api/sql?q=$enc" -ErrorAction Stop).rows
  } catch {
    return $null
  }
}

Write-Host ""
Write-Host "=== Cross-Node Reputation Stamps ===" -ForegroundColor White

# ── Get agent DID lists from each node ───────────────────────────────────────
try {
  $agentsA = Invoke-RestMethod "$NodeA/api/agents" -ErrorAction Stop
  $agentsB = Invoke-RestMethod "$NodeB/api/agents" -ErrorAction Stop
} catch {
  Write-Host "❌ Could not reach one or both nodes: $_" -ForegroundColor Red
  exit 1
}

$didsA = $agentsA | ForEach-Object { $_.did } | Where-Object { $_ }
$didsB = $agentsB | ForEach-Object { $_.did } | Where-Object { $_ }

if (-not $didsB) {
  Write-Host "❌ Node B has no agents — is the worker stack running?" -ForegroundColor Red
  exit 1
}

Write-Host ""
if ($didsA) { Write-Host "  Node A agents: $($didsA.Count)" -ForegroundColor DarkGray }
else         { Write-Host "  Node A agents: 0 (orchestrator-only mode)" -ForegroundColor DarkGray }
Write-Host "  Node B agents: $($didsB.Count)" -ForegroundColor DarkGray
Write-Host ""

# ── Query Node A's DB for stamps issued to Node B agents ─────────────────────
$didListB = ($didsB | ForEach-Object { "'$_'" }) -join ","
$qA = "SELECT json_extract_string(content, '`$.subjectDid') as recipientDid, json_extract_string(content, '`$.taskUri') as taskUri, json_extract_string(content, '`$.overallScore') as score FROM records WHERE collection = 'network.mycelium.reputation.stamp' AND json_extract_string(content, '`$.subjectDid') IN ($didListB)"
$crossFromA = Invoke-SqlQuery $NodeA $qA

# ── Query Node B's DB for stamps issued to Node A agents (if Node A has agents)
$crossFromB = $null
if ($didsA) {
  $didListA = ($didsA | ForEach-Object { "'$_'" }) -join ","
  $qB = "SELECT json_extract_string(content, '`$.subjectDid') as recipientDid, json_extract_string(content, '`$.taskUri') as taskUri, json_extract_string(content, '`$.overallScore') as score FROM records WHERE collection = 'network.mycelium.reputation.stamp' AND json_extract_string(content, '`$.subjectDid') IN ($didListA)"
  $crossFromB = Invoke-SqlQuery $NodeB $qB
}

# ── Build handle lookup maps ──────────────────────────────────────────────────
$handleByDid = @{}
foreach ($a in $agentsA) { if ($a.did) { $handleByDid[$a.did] = "$($a.handle)@A" } }
foreach ($b in $agentsB) { if ($b.did) { $handleByDid[$b.did] = "$($b.handle)@B" } }

# ── Display results ───────────────────────────────────────────────────────────
$totalCross = 0

if ($crossFromA -and $crossFromA.Count -gt 0) {
  Write-Host "  ✅ Node A's Mayor stamped Node B agents — cross-node stamps:" -ForegroundColor Green
  Write-Host ""
  foreach ($row in $crossFromA) {
    $label = if ($handleByDid[$row.recipientDid]) { $handleByDid[$row.recipientDid] } else { $row.recipientDid.Substring(0,20) + "…" }
    Write-Host ("    ✅ {0,-18}  score={1,-6}  task={2}" -f $label, $row.score, ($row.taskUri -replace 'at://did:key:[^/]+/', '…/')) -ForegroundColor Green
    $totalCross++
  }
  Write-Host ""
}

if ($crossFromB -and $crossFromB.Count -gt 0) {
  Write-Host "  ✅ Node B's Mayor stamped Node A agents — cross-node stamps:" -ForegroundColor Green
  Write-Host ""
  foreach ($row in $crossFromB) {
    $label = if ($handleByDid[$row.recipientDid]) { $handleByDid[$row.recipientDid] } else { $row.recipientDid.Substring(0,20) + "…" }
    Write-Host ("    ✅ {0,-18}  score={1,-6}  task={2}" -f $label, $row.score, ($row.taskUri -replace 'at://did:key:[^/]+/', '…/')) -ForegroundColor Green
    $totalCross++
  }
  Write-Host ""
}

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

$repA = Invoke-SqlQuery $NodeA "SELECT json_extract_string(content, '`$.subjectDid') as agentDid, CAST(COUNT(*) AS VARCHAR) as stamps, CAST(AVG(CAST(json_extract_string(content, '`$.overallScore') AS FLOAT)) AS VARCHAR) as avgScore FROM records WHERE collection = 'network.mycelium.reputation.stamp' GROUP BY agentDid ORDER BY stamps DESC LIMIT 10"
$repB = Invoke-SqlQuery $NodeB "SELECT json_extract_string(content, '`$.subjectDid') as agentDid, CAST(COUNT(*) AS VARCHAR) as stamps, CAST(AVG(CAST(json_extract_string(content, '`$.overallScore') AS FLOAT)) AS VARCHAR) as avgScore FROM records WHERE collection = 'network.mycelium.reputation.stamp' GROUP BY agentDid ORDER BY stamps DESC LIMIT 10"

$allRep = @()
if ($repA) { foreach ($r in $repA) { $handle = if ($handleByDid[$r.agentDid]) { $handleByDid[$r.agentDid] } else { $r.agentDid.Substring(0,16) + "…" }; $allRep += [PSCustomObject]@{ IssuedBy="Node A Mayor"; Recipient=$handle; Stamps=$r.stamps; AvgScore=[math]::Round([float]$r.avgScore,1) } } }
if ($repB) { foreach ($r in $repB) { $handle = if ($handleByDid[$r.agentDid]) { $handleByDid[$r.agentDid] } else { $r.agentDid.Substring(0,16) + "…" }; $allRep += [PSCustomObject]@{ IssuedBy="Node B Mayor"; Recipient=$handle; Stamps=$r.stamps; AvgScore=[math]::Round([float]$r.avgScore,1) } } }

$allRep | Format-Table -AutoSize
