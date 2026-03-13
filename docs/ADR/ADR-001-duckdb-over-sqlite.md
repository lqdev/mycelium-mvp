# ADR-001: DuckDB over SQLite for Persistence and Analytics

## Status

Accepted

## Context

The Mycelium MVP used Node.js's experimental `node:sqlite` module for per-agent record
storage. This had several issues:

1. **Experimental API** — `node:sqlite` is not yet stable and required a `createRequire()`
   hack (`db-sync.ts`) to work around Vite's inability to resolve the module.
2. **No persistence for firehose** — The event log (firehose) was an in-memory array.
   All simulation data was lost on server restart.
3. **O(n) dashboard queries** — Every dashboard API call scanned the entire firehose
   array in JavaScript to find matching events.
4. **No export capability** — No way to snapshot simulation data for external analysis.

### Options Considered

1. **SQLite (keep/expand)** — Already in use but experimental. Would need `better-sqlite3`
   for stability, adding a native dependency anyway. Row-oriented storage is suboptimal
   for the analytical scan patterns our dashboard uses.

2. **DuckDB** — Columnar, OLAP-optimised. Native JSON support (`json_extract`). Parquet
   export built-in. Active Node.js client (`@duckdb/node-api`). Designed for the
   analytical query patterns our dashboard uses.

3. **PostgreSQL** — Overkill for an MVP. Requires a separate server process; no embedded
   mode.

## Decision

Replace `node:sqlite` with **DuckDB** (`@duckdb/node-api`) for all persistence and
analytical query needs.

- Agent repositories use in-memory `Map` + `Array` for the synchronous simulation layer,
  with async DuckDB write-through for persistence.
- Firehose events persist to DuckDB, enabling SQL queries and Parquet export.
- Dashboard detail endpoints query DuckDB directly instead of scanning JavaScript arrays.

See [ADR-002](./ADR-002-two-layer-storage.md) for why the two-layer architecture is
necessary.

## Consequences

### Positive

- Firehose data survives server restarts
- Dashboard queries are indexed SQL (O(log n) vs O(n))
- Native JSON querying eliminates manual deserialization
- Parquet export enables external analysis (Python, Jupyter, DuckDB CLI, etc.)
- Eliminates the `db-sync.ts` hack and `node:sqlite` dependency

### Negative

- New dependency: `@duckdb/node-api` (~30 MB native binary)
- Dual-write overhead (in-memory + async DuckDB)
- Brief window of inconsistency: if the server crashes between an in-memory write and
  the async DuckDB persist, that write is lost. Acceptable for MVP.
