---
title: "Pattern: @duckdb/node-api Gotchas in Node.js"
description: "Five non-obvious pitfalls when using @duckdb/node-api: wrong close API, BIGINT type coercion, async instance lifecycle, JSON ->> operator in WHERE clauses, and COUNT(*) aggregate BigInt."
entry_type: pattern
published_date: "2026-04-22 20:06 CDT"
last_updated_date: "2026-04-24 11:30 CDT"
tags: "typescript, javascript, databases, patterns"
related_skill: ""
source_project: "mycelium-mvp"
---

## Discovery

During a migration from `node:sqlite` to `@duckdb/node-api` in a Node.js simulation
project, five non-obvious bugs were found — none of which produce loud errors, making
them easy to ship silently:

1. Calling `.close()` on a `DuckDBInstance` throws at runtime (method doesn't exist)
2. `BIGINT` columns returned by `getRowObjects()` are JS `bigint`, not `number`
3. Dropping the `DuckDBInstance` reference immediately after calling `connect()` risks GC
   collecting it while async writes are still in-flight
4. The `->>` JSON extraction operator is misinterpreted as bitwise right shift in WHERE/IN clauses
5. `COUNT(*)` and other aggregate functions return JS `bigint`, breaking JSON serialization

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

### 4. `->>` JSON extraction operator in WHERE / IN clauses

DuckDB supports `column->>'$.field'` for JSON text extraction in SELECT lists. **In WHERE
clauses and IN expressions, the parser misinterprets `>>` as the bitwise right-shift operator.**
The result is a silent type cast attempt that fails:

```
Failed to cast value to numerical: "did:key:z6Mk..."
```

The error message is deeply confusing — it looks like a schema type mismatch, not a SQL
operator precedence problem.

**The gotcha:** `->>` works in SELECT but breaks in WHERE/IN on the same query.

```sql
-- ✅ works fine in SELECT
SELECT content->>'$.subjectDid' AS subject FROM stamps;

-- ❌ silently fails in WHERE — DuckDB reads >> as bitwise right-shift
SELECT * FROM stamps WHERE content->>'$.subjectDid' = 'did:key:z6Mk...';

-- ✅ correct: use json_extract_string() in WHERE/IN
SELECT * FROM stamps WHERE json_extract_string(content, '$.subjectDid') = 'did:key:z6Mk...';

-- ✅ also correct in IN expressions
SELECT * FROM stamps
WHERE json_extract_string(content, '$.subjectDid') IN ('did:key:abc', 'did:key:xyz');
```

### 5. `COUNT(*)` and aggregate functions return JS `bigint`

DuckDB's aggregate functions (`COUNT(*)`, `SUM()`, `MAX()`, etc.) return JavaScript `bigint`
values, not `number`. Unlike schema-declared BIGINT columns (gotcha #2), this applies even to
small counts that would fit in a regular integer.

**Symptom:** When the query result is serialized to JSON (e.g., via `res.json()` in Express
or `JSON.stringify()`), it throws:

```
TypeError: Do not know how to serialize a BigInt
```

**Fix:** Cast to a text type in the SQL query itself:

```sql
-- ❌ returns bigint — breaks JSON.stringify
SELECT COUNT(*) AS stamp_count FROM stamps WHERE ...;

-- ✅ returns string — safe for JSON serialization
SELECT CAST(COUNT(*) AS VARCHAR) AS stamp_count FROM stamps WHERE ...;

-- ✅ or cast to INTEGER if you need numeric arithmetic in JS
SELECT CAST(COUNT(*) AS INTEGER) AS stamp_count FROM stamps WHERE ...;
```

The safest default for any `/api/sql` pass-through endpoint: cast all aggregate results to
`VARCHAR` or `INTEGER` explicitly rather than relying on the default type.

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

### Fix 4: Use `json_extract_string()` in WHERE clauses

```typescript
// Build WHERE clause for cross-node stamp detection:
const didList = agentDids.map(d => `'${d}'`).join(', ');

// ❌ WRONG — ->> parsed as bitwise shift in WHERE/IN context
const bad = `WHERE content->>'$.subjectDid' IN (${didList})`;

// ✅ CORRECT — use json_extract_string() in all WHERE/IN positions
const good = `WHERE json_extract_string(content, '$.subjectDid') IN (${didList})`;
```

This applies to all nested JSON fields:
- `json_extract_string(content, '$.taskUri')` — text
- `json_extract(content, '$.score')` — for non-string values

### Fix 5: CAST aggregates before serialization

```sql
-- For REST API / JSON endpoints, always cast aggregates explicitly:
SELECT
  json_extract_string(content, '$.subjectDid') AS agent,
  CAST(COUNT(*) AS VARCHAR)                    AS stampCount,
  CAST(AVG(CAST(json_extract(content, '$.overallScore') AS DOUBLE)) AS VARCHAR) AS avgScore
FROM stamps
GROUP BY json_extract_string(content, '$.subjectDid');
```

Or handle in the TypeScript layer:

```typescript
// If you can't change the SQL (e.g., user-submitted queries):
function sanitizeForJson(obj: unknown): unknown {
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeForJson);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitizeForJson(v)])
    );
  }
  return obj;
}
res.json(sanitizeForJson(rows));
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

- **Never use `->>` in WHERE or IN clauses.** It works in SELECT but DuckDB's parser
  interprets it as bitwise right shift in boolean/comparison contexts. Always use
  `json_extract_string(col, '$.field')` in WHERE clauses, even when `->>` works in SELECT.

- **Always CAST aggregate return values in SQL queries exposed as JSON.**
  Use `CAST(COUNT(*) AS VARCHAR)` (or `CAST(... AS INTEGER)`) in any query whose result
  will be serialized to JSON — either in a REST API or `JSON.stringify`. Never rely on
  implicit numeric type from aggregates.
