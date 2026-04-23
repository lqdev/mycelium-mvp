// Async DuckDB persistence layer — module-level singleton.
// Call initPersistence(conn) once at server startup. All write functions
// are fire-and-forget: they never block the synchronous simulation cascade.

import type { DuckDBConnection } from './duckdb.js';
import { execute, queryAll } from './duckdb.js';
import type { CommitRow, FirehoseEvent, StoredRecordRow, AgentIdentity } from '../schemas/types.js';
import { mirrorRecord, mirrorDelete } from '../atproto/pds-bridge.js';

let _conn: DuckDBConnection | null = null;

/** did → handle mapping used to route persistRecord calls to the PDS bridge. */
const _handleByDid = new Map<string, string>();

/** Wire the DuckDB connection. Call once at server startup before starting the simulation. */
export function initPersistence(conn: DuckDBConnection): void {
  _conn = conn;
}

/** Register a did → handle mapping so the PDS bridge knows which session to use. */
export function registerAgentMapping(did: string, handle: string): void {
  _handleByDid.set(did, handle);
}

/** Tear down (for clean shutdown or tests). */
export function shutdownPersistence(): void {
  _conn = null;
  _handleByDid.clear();
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
        `INSERT OR REPLACE INTO commits
           (repo_did, seq, operation, record_uri, content_hash, repo_root_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [repoDid, commit.seq, commit.operation, commit.record_uri, commit.content_hash, commit.repo_root_hash, commit.timestamp],
      );
    } catch (err) {
      console.error('[persistence] record write failed:', err);
    }
  })();

  // Mirror to PDS (env-gated — no-op if PDS_ENDPOINT not set)
  const handle = _handleByDid.get(repoDid);
  if (handle) {
    let content: unknown = row.content;
    try { content = JSON.parse(row.content); } catch { /* use raw */ }
    mirrorRecord(handle, row.collection, row.rkey, content);
  }
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
        `INSERT OR REPLACE INTO commits
           (repo_did, seq, operation, record_uri, content_hash, repo_root_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [repoDid, commit.seq, commit.operation, commit.record_uri, commit.content_hash, commit.repo_root_hash, commit.timestamp],
      );
    } catch (err) {
      console.error('[persistence] record delete failed:', err);
    }
  })();

  // Mirror deletion to PDS (env-gated — no-op if PDS_ENDPOINT not set)
  const handle = _handleByDid.get(repoDid);
  if (handle) mirrorDelete(handle, collection, rkey);
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

/** Load all saved agent identities from DuckDB (returns empty Map if none). */
export async function loadIdentities(): Promise<Map<string, AgentIdentity>> {
  if (!_conn) return new Map();
  const rows = await queryAll<{
    handle: string; did: string; display_name: string;
    public_key: string; private_key: string; created_at: string;
  }>(_conn, 'SELECT * FROM agent_identities');

  const result = new Map<string, AgentIdentity>();
  for (const row of rows) {
    result.set(row.handle, {
      did: row.did,
      handle: row.handle,
      displayName: row.display_name,
      publicKey: Buffer.from(row.public_key, 'hex'),
      privateKey: Buffer.from(row.private_key, 'hex'),
      createdAt: row.created_at,
    });
  }
  return result;
}

/** Upsert an agent identity into DuckDB (fire-and-forget). */
export function saveIdentity(identity: AgentIdentity): void {
  if (!_conn) return;
  const conn = _conn;
  void (async () => {
    try {
      await execute(
        conn,
        `INSERT OR REPLACE INTO agent_identities
           (handle, did, display_name, public_key, private_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          identity.handle,
          identity.did,
          identity.displayName,
          Buffer.from(identity.publicKey).toString('hex'),
          Buffer.from(identity.privateKey).toString('hex'),
          identity.createdAt,
        ],
      );
    } catch (err) {
      console.error('[persistence] identity save failed:', err);
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