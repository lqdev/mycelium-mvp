# ADR-002: Two-Layer Storage Architecture

## Status

Accepted

## Context

DuckDB's Node.js bindings (`@duckdb/node-api`) are **async-only** — all query methods
return Promises. However, the Mycelium simulation relies on **synchronous cascades** for
correct execution:

```
Mayor.postTask()
  → putRecord()               [sync write]
    → firehose.publish()      [sync broadcast]
      → Agent.handleEvent()   [sync handler]
        → claimTask()
          → putRecord()       [sync write]
            → firehose.publish() [sync broadcast]
              → Mayor.handleClaim()   [sync handler]
                → pendingClaims.set()
                  + setTimeout(processClaimsForTask, 0)
```

The `setTimeout(..., 0)` pattern defers claim processing until all synchronous claim
writes have completed within the current event loop tick. If `putRecord()` were async,
claims would not yet be written when the timeout fires, breaking the ranking logic.

## Decision

Use a **two-layer architecture**:

1. **Live Layer (synchronous)** — Plain JavaScript `Map<string, StoredRecordRow>` and
   `CommitRow[]` for the simulation. All `putRecord`, `getRecord`, `listRecords`
   operations are synchronous Map/Array operations.

2. **Persistence Layer (asynchronous)** — DuckDB write-through. After each synchronous
   in-memory operation, a fire-and-forget async write persists the data to DuckDB.
   Dashboard analytical queries read from DuckDB directly.

```
┌────────────────────────────────┐
│  Simulation (sync)             │
│  Map + Array                   │
└──────────┬─────────────────────┘
           │ fire-and-forget async
┌──────────▼─────────────────────┐
│  DuckDB (async)                │
│  Persistence + Analytics       │
└────────────────────────────────┘
```

## Consequences

### Positive

- Synchronous simulation cascades preserved — no race conditions
- Simulation logic is unchanged from pre-DuckDB implementation
- Tests run without DuckDB (pure in-memory, fast)
- Clear separation: simulation correctness (Map) vs durability (DuckDB)

### Negative

- Dual writes (Map.set + DuckDB INSERT) — negligible overhead for current scale
  (~200 events per simulation run)
- Brief window of inconsistency between in-memory and DuckDB layers
- Two read paths: simulation reads from Map, dashboard reads from DuckDB. Could diverge
  if wiring is incorrect — mitigated by fire-and-forget always running after the Map write
