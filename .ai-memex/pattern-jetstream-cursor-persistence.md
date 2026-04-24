---
title: "Pattern: Jetstream Cursor Persistence for Gapless AT Proto Federation"
description: "How to resume Jetstream consumption from the last-known position on restart without replaying history that triggers live side-effects."
entry_type: pattern
published_date: "2026-04-23 19:28 CDT"
last_updated_date: "2026-04-23 19:28 CDT"
tags: "typescript, architecture, patterns, api"
related_skill: ""
source_project: "mycelium-mvp"
---

## Discovery

Mycelium's federation layer consumes an AT Protocol Jetstream relay to observe task events
from peer nodes. After implementing the consumer we needed restart resilience: if the process
restarts, it should replay only missed events rather than the full event history.

The naive fix — `cursor=0` on every connect — causes a full history replay, which re-triggers
live business logic: agents re-claim already-assigned tasks, tasks transition to invalid states,
and the wanted-board's state machine rejects the duplicate operations (or worse, silently
accepts them and creates duplicates).

A second issue emerged during cross-node execution: when Node B's agent completes a task
originally posted by Node A's Mayor, there is no local `AgentRepository` for that Mayor on
Node B. The `startTask()` call (which transitions `assigned → in_progress`) was guarded by
`if (!mayorRepo) return` — silently dropping all cross-node completions.

## Root Cause

**Cursor=0 danger**: Jetstream treats `cursor=0` as "replay from the beginning of time." On
first connect this is unnecessary (live tail is safe and correct). On restart this is
destructive (full replay re-runs all business logic). The safe cursor value for first connect
is `undefined` (no `?cursor` query param), which starts a live tail.

**Cross-node state machine gap**: The task state machine's `VALID_TRANSITIONS` only allowed
`assigned → in_progress`. Cross-node agents skip `startTask` (no local Mayor repo), so they
need to go directly from `assigned → completed`. Without this transition, `handleCompletion`
silently returns early and the task is permanently stuck.

## Solution

### 1. Module-level cursor tracking in `jetstream.ts`

```typescript
let _cursor: number | undefined;
let _onCursor: ((timeUs: number) => void) | undefined;

// In handleMessage(), after publish():
_cursor = data.time_us;
_onCursor?.(data.time_us);

// In connect(), build URL conditionally:
const url = _cursor !== undefined ? `${_endpoint}?cursor=${_cursor}` : _endpoint;

// In shutdownJetstream(), reset state:
_cursor = undefined;
_onCursor = undefined;

// Updated signature:
export function initJetstream(
  endpoint: string,
  firehose: Firehose,
  localPlcDids: Set<string>,
  cursor?: number,       // undefined = live tail (safe first connect)
  onCursor?: (timeUs: number) => void,
): void
```

The in-memory cursor also handles reconnects within the same process automatically —
`_cursor` is already set, so reconnect does a delta replay from last position.

### 2. Persistence layer (`persistence.ts` + `duckdb.ts`)

```typescript
// DuckDB schema
CREATE TABLE IF NOT EXISTS jetstream_cursors (
  endpoint  VARCHAR PRIMARY KEY,
  cursor_us BIGINT  NOT NULL,
  updated_at VARCHAR NOT NULL
);

// Save (fire-and-forget, same pattern as other persistence calls)
export function saveJetstreamCursor(endpoint: string, timeUs: number): void {
  getConn().run(
    `INSERT OR REPLACE INTO jetstream_cursors VALUES (?, ?, ?)`,
    endpoint, timeUs, new Date().toISOString(),
  );
}

// Load on startup
export async function loadJetstreamCursor(endpoint: string): Promise<number | null> {
  const rows = await getConn().all(
    `SELECT cursor_us FROM jetstream_cursors WHERE endpoint = ?`,
    endpoint,
  );
  return rows.length ? (rows[0].cursor_us as number) : null;
}
```

### 3. Startup integration (`server.ts`)

```typescript
const jetstreamEndpoint = process.env.JETSTREAM_ENDPOINT;
if (jetstreamEndpoint) {
  const savedCursor = await loadJetstreamCursor(jetstreamEndpoint);
  initJetstream(
    jetstreamEndpoint,
    firehose,
    localPlcDids,
    savedCursor ?? undefined,   // null → undefined = live tail on first run
    (timeUs) => saveJetstreamCursor(jetstreamEndpoint, timeUs),
  );
}
```

### 4. Cross-node state machine fix (`wanted-board.ts`)

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  // ...
  // 'completed' is valid from 'assigned' for cross-node federation: a remote agent
  // may complete without a local startTask() (no Mayor repo access across nodes).
  assigned: ['in_progress', 'completed'],
  // ...
};
```

### 5. Cross-node engine guard (`engine.ts`)

```typescript
// Old (drops cross-node completions):
if (!mayorRepo) return;
try { startTask(mayorRepo, taskUri); } catch { return; }

// New (skip startTask for cross-node, still execute):
if (mayorRepo) {
  try { startTask(mayorRepo, taskUri); } catch { return; }
}
// Cross-node: skip startTask, still execute (assigned → completed is valid)
```

## Prevention

- **Never pass `cursor=0`** to Jetstream on first connect. Use `undefined` (no param) to
  start a live tail. Reserve cursor values for restart replay.
- **Test the `?cursor=N` URL param** explicitly — it's easy to accidentally always append
  the param (even when 0/undefined) and trigger unintended replay.
- **When adding cross-node state transitions**, audit the full state machine. Every path that
  skips a step (e.g., skipping `startTask` on a foreign Mayor) needs a corresponding
  `VALID_TRANSITIONS` entry, or completions will be silently dropped with no error logged.
- **Persist cursors per endpoint** (not globally) so multi-node setups each track their own
  position independently.
