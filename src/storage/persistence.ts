// Async DuckDB persistence layer — module-level singleton.
// Call initPersistence(conn) once at server startup. All write functions
// are fire-and-forget: they never block the synchronous simulation cascade.

import type { DuckDBConnection } from './duckdb.js';
import { execute, queryAll } from './duckdb.js';
import type { CommitRow, FirehoseEvent, StoredRecordRow } from '../schemas/types.js';

let _conn: DuckDBConnection | null = null;

/** Wire the DuckDB connection. Call once at server startup before starting the simulation. */
export function initPersistence(conn: DuckDBConnection): void {
  _conn = conn;
}

/** Tear down (for clean shutdown or tests). */
export function shutdownPersistence(): void {
  _conn = null;
}

// ─── Write helpers ────────────────────────────────────────────────────────────

/** Persist a record upsert + its commit row (fire-and-forget). */
export function persistRecord(
  repoDid: string,
  row: StoredRecordRow,
  commit: CommitRow,
): void {
  if (!_conn) return;
  const conn = _conn;
  void (async () => {
    try {
      await execute(
        conn,
        `INSERT OR REPLACE INTO records
           (repo_did, uri, collection, rkey, content, sig, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [repoDid, row.uri, row.collection, row.rkey, row.content, row.sig, row.created_at, row.updated_at],
      );
      await execute(
        conn,
        `INSERT INTO commits
           (repo_did, seq, operation, record_uri, content_hash, repo_root_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [repoDid, commit.seq, commit.operation, commit.record_uri, commit.content_hash, commit.repo_root_hash, commit.timestamp],
      );
    } catch (err) {
      console.error('[persistence] record write failed:', err);
    }
  })();
}

/** Persist a record deletion + its commit row (fire-and-forget). */
export function persistDeleteRecord(
  repoDid: string,
  collection: string,
  rkey: string,
  commit: CommitRow,
): void {
  if (!_conn) return;
  const conn = _conn;
  void (async () => {
    try {
      await execute(
        conn,
        `DELETE FROM records WHERE repo_did = $1 AND collection = $2 AND rkey = $3`,
        [repoDid, collection, rkey],
      );
      await execute(
        conn,
        `INSERT INTO commits
           (repo_did, seq, operation, record_uri, content_hash, repo_root_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [repoDid, commit.seq, commit.operation, commit.record_uri, commit.content_hash, commit.repo_root_hash, commit.timestamp],
      );
    } catch (err) {
      console.error('[persistence] record delete failed:', err);
    }
  })();
}

/** Persist a firehose event (fire-and-forget). */
export function persistFirehoseEvent(event: FirehoseEvent): void {
  if (!_conn) return;
  const conn = _conn;
  void (async () => {
    try {
      await execute(
        conn,
        `INSERT OR IGNORE INTO firehose_events
           (seq, type, operation, did, collection, rkey, record, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.seq,
          event.type,
          event.operation,
          event.did,
          event.collection,
          event.rkey,
          event.record != null ? JSON.stringify(event.record) : null,
          event.timestamp,
        ],
      );
    } catch (err) {
      console.error('[persistence] firehose write failed:', err);
    }
  })();
}

// ─── Recovery helpers ─────────────────────────────────────────────────────────

/** Load all firehose events from DuckDB ordered by seq (for restart recovery). */
export async function loadFirehoseLog(): Promise<FirehoseEvent[]> {
  if (!_conn) return [];
  const rows = await queryAll<{
    seq: number; type: string; operation: string; did: string;
    collection: string; rkey: string; record: string | null; timestamp: string;
  }>(_conn, 'SELECT * FROM firehose_events ORDER BY seq ASC');

  return rows.map((r) => ({
    seq: Number(r.seq),
    type: r.type as 'commit',
    operation: r.operation as 'create' | 'update' | 'delete',
    did: r.did,
    collection: r.collection,
    rkey: r.rkey,
    record: r.record != null ? JSON.parse(r.record) as unknown : null,
    timestamp: r.timestamp,
  }));
}

/** Return the live DuckDB connection (for dashboard SQL queries). */
export function getConn(): DuckDBConnection | null {
  return _conn;
}