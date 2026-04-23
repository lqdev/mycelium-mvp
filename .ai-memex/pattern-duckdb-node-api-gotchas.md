---
title: "Pattern: @duckdb/node-api Gotchas in Node.js"
description: "Three non-obvious pitfalls when using @duckdb/node-api: wrong close API, BIGINT type coercion, and async instance lifecycle."
entry_type: pattern
published_date: "2026-04-22 20:06 CDT"
last_updated_date: "2026-04-22 20:06 CDT"
tags: "typescript, javascript, databases, patterns"
related_skill: ""
source_project: "mycelium-mvp"
---

## Discovery

During a migration from `node:sqlite` to `@duckdb/node-api` in a Node.js simulation
project, three non-obvious bugs were found — none of which produce loud errors, making
them easy to ship silently:

1. Calling `.close()` on a `DuckDBInstance` throws at runtime (method doesn't exist)
2. `BIGINT` columns returned by `getRowObjects()` are JS `bigint`, not `number`
3. Dropping the `DuckDBInstance` reference immediately after calling `connect()` risks GC
   collecting it while async writes are still in-flight

All three were caught by combining a rubber-duck code review pass with a comprehensive
test suite that exercised the actual DuckDB runtime, not just mocks.

## Root Cause

### 1. `closeSync()` not `close()`

`DuckDBInstance` only exposes a synchronous close method:

```typescript
// node_modules/@duckdb/node-api/lib/DuckDBInstance.d.ts
export declare class DuckDBInstance {
  static create(path?: string, options?: Record<string, string>): Promise<DuckDBInstance>;
  connect(): Promise<DuckDBConnection>;
  closeSync(): void;  // ← only this, no async close()
}
```

Calling `instance.close()` fails at runtime with "not a function". TypeScript won't
catch this if the variable is typed as the inferred return of `createDuckDB()`.

### 2. BIGINT → JS `bigint`

DuckDB's `BIGINT` SQL type maps to JavaScript's native `bigint` primitive when reading
rows via `getRowObjects()`. Any column declared as `BIGINT` in the schema comes back as
`42n`, not `42`. Arithmetic with mixed `number` and `bigint` throws a TypeError:

```
TypeError: Cannot mix BigInt and other types, use explicit conversions
```

Type annotations like `seq: number` on the query result are TypeScript lies — they have
no runtime effect.

### 3. Instance lifecycle / GC risk

`createDuckDB()` returns `{ instance, conn }`. If you destructure only `conn` and discard
`instance`, the `DuckDBInstance` becomes unreachable. In theory, GC could collect it while
the connection is still active and async writes are in-flight. In practice this is most
dangerous in fire-and-forget write patterns where errors are silently swallowed.

## Solution

### Fix 1: Use `closeSync()`

```typescript
// ✅ correct
instance.closeSync();

// ❌ wrong — throws "not a function"
instance.close();
```

In graceful shutdown handlers:

```typescript
process.on('SIGINT', () => {
  shutdownPersistence();   // null out the connection reference
  instance.closeSync();    // close the underlying database
  process.exit(0);
});
```

### Fix 2: Coerce BIGINT with `Number()`

When reading BIGINT columns that you need as JavaScript `number`, wrap with `Number()`:

```typescript
const rows = await queryAll<{ seq: bigint; ... }>(_conn, 'SELECT * FROM firehose_events ORDER BY seq ASC');

return rows.map((r) => ({
  seq: Number(r.seq),   // ← coerce bigint → number (safe if seq < 2^53)
  ...
}));
```

Only safe when values fit within `Number.MAX_SAFE_INTEGER` (2^53 − 1 ≈ 9 quadrillion).
For sequence counters and timestamps this is always fine. For cryptographic IDs, keep as
`bigint` end-to-end.

Alternatively, stay `bigint` throughout your types — but this leaks into every consumer.

### Fix 3: Retain the instance reference

Store `DuckDBInstance` in a long-lived object (module scope, server state, etc.):

```typescript
interface DemoState {
  dbInstance: DuckDBInstance;  // ← keep alive for the process lifetime
  conn: DuckDBConnection;
  // ...
}

const { instance: dbInstance, conn } = await createDuckDB('./data/app.duckdb');
initPersistence(conn);
return { dbInstance, conn, /* ... */ };
```

## Prevention

- **Always verify DuckDB API by reading the `.d.ts` files** in `node_modules/@duckdb/node-api/lib/`
  before calling any lifecycle methods. The TypeScript types are the ground truth.

- **Write runtime tests against a real in-memory DuckDB** (`createDuckDB()` with no path).
  Mocking DuckDB hides type coercion bugs. A real DB will surface the `bigint` mismatch
  immediately.

- **Type your query results with `bigint` for BIGINT columns**, then coerce explicitly:
  ```typescript
  // explicit about what the DB returns
  const rows = await queryAll<{ seq: bigint }>(...);
  // explicit about what the app wants
  return rows.map(r => ({ seq: Number(r.seq) }));
  ```

- **Use `pool: 'forks'` in vitest** when testing DuckDB (native addon). Worker threads
  don't work reliably with native binaries; forks give each test file a clean process.
