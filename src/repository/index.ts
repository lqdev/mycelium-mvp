// Repository module: SQLite-backed record store (one DB per agent).
// Each write is auto-signed and optionally emits to the firehose.
// Uses node:sqlite (Node.js 22 built-in) — no native compilation required.

import { DatabaseSync } from '../db-sync.js';
import { sha256 } from '@noble/hashes/sha256';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentIdentity,
  AgentRepository,
  Commit,
  Firehose,
  RecordResult,
  RepositoryExport,
  StoredRecord,
} from '../schemas/types.js';
import { canonicalize, didToKeyFragment, signContent, verifySignature } from '../identity/index.js';
import { ImportVerificationError, RecordNotFoundError } from '../errors.js';
import { publish } from '../firehose/index.js';
import { validateRecord } from '../schemas/index.js';

const DATA_DIR = './data';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return Buffer.from(sha256(bytes)).toString('hex');
}

function computeNextRootHash(prevRootHash: string | null, contentHash: string): string {
  if (prevRootHash === null) return contentHash;
  return sha256Hex(prevRootHash + ':' + contentHash);
}

function emitFirehoseEvent(
  repo: AgentRepository,
  operation: 'create' | 'update' | 'delete',
  collection: string,
  rkey: string,
  record: unknown,
): void {
  const { firehose } = repo;
  if (!firehose) return;

  const event = {
    seq: firehose.seq++,
    type: 'commit' as const,
    operation,
    did: repo.did,
    collection,
    rkey,
    record,
    timestamp: new Date().toISOString(),
  };

  publish(firehose, event);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS records (
    uri        TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    rkey       TEXT NOT NULL,
    content    TEXT NOT NULL,
    sig        TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(collection, rkey)
  );

  CREATE TABLE IF NOT EXISTS commits (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    operation      TEXT NOT NULL,
    record_uri     TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    repo_root_hash TEXT NOT NULL,
    timestamp      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
  CREATE INDEX IF NOT EXISTS idx_commits_timestamp  ON commits(timestamp);
`;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create (or reopen) an agent repository.
 * One SQLite database per agent at ./data/{keyFragment}.db
 *
 * @param identity  The agent's identity (used for signing every write)
 * @param firehose  Optional firehose to emit events on write. Pass null/undefined
 *                  for isolated repos (tests, import-verify).
 */
export function createRepository(
  identity: AgentIdentity,
  firehose?: Firehose | null,
): AgentRepository {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const keyFragment = didToKeyFragment(identity.did);
  const dbPath = join(DATA_DIR, `${keyFragment}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);

  return {
    did: identity.did,
    db,
    dbPath,
    identity,
    firehose: firehose ?? null,
  };
}

/** Create an in-memory repository (no file on disk). Useful for tests. */
export function createMemoryRepository(
  identity: AgentIdentity,
  firehose?: Firehose | null,
): AgentRepository {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return {
    did: identity.did,
    db,
    dbPath: ':memory:',
    identity,
    firehose: firehose ?? null,
  };
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Upsert a record into the repository.
 * Signing happens here — callers pass plain content.
 * Emits a firehose event if the repository has one.
 *
 * @throws Never for valid content; may throw on SQLite errors
 */
export function putRecord(
  repo: AgentRepository,
  collection: string,
  rkey: string,
  content: unknown,
): RecordResult {
  const uri = `at://${repo.did}/${collection}/${rkey}`;
  const now = new Date().toISOString();

  // Validate against Zod schema (throws SchemaValidationError on failure)
  validateRecord(collection, content);

  // Sign the content
  const { sig } = signContent(repo.identity, content);
  const contentJson = JSON.stringify(content);
  const contentHash = sha256Hex(canonicalize(content));

  // Determine if create or update
  const existing = repo.db
    .prepare('SELECT 1 FROM records WHERE collection = ? AND rkey = ?')
    .get(collection, rkey);
  const operation: 'create' | 'update' = existing ? 'update' : 'create';

  // Get last commit for root hash chaining
  const lastCommit = repo.db
    .prepare('SELECT repo_root_hash FROM commits ORDER BY seq DESC LIMIT 1')
    .get() as { repo_root_hash: string } | undefined;

  const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

  if (operation === 'create') {
    repo.db
      .prepare(
        'INSERT INTO records (uri, collection, rkey, content, sig, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(uri, collection, rkey, contentJson, sig, now, now);
  } else {
    repo.db
      .prepare('UPDATE records SET content = ?, sig = ?, updated_at = ? WHERE collection = ? AND rkey = ?')
      .run(contentJson, sig, now, collection, rkey);
  }

  const commitResult = repo.db
    .prepare(
      'INSERT INTO commits (operation, record_uri, content_hash, repo_root_hash, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    .run(operation, uri, contentHash, repoRootHash, now);

  const seq = Number(commitResult.lastInsertRowid);

  emitFirehoseEvent(repo, operation, collection, rkey, content);

  return {
    uri,
    cid: contentHash,
    commit: { seq, operation, repoRootHash },
  };
}

/**
 * Retrieve a record by collection and rkey.
 *
 * @throws RecordNotFoundError if the record does not exist
 */
export function getRecord(repo: AgentRepository, collection: string, rkey: string): StoredRecord {
  const row = repo.db
    .prepare('SELECT * FROM records WHERE collection = ? AND rkey = ?')
    .get(collection, rkey) as
    | { uri: string; collection: string; rkey: string; content: string; sig: string; created_at: string; updated_at: string }
    | undefined;

  if (!row) throw new RecordNotFoundError(collection, rkey);

  return {
    uri: row.uri,
    collection: row.collection,
    rkey: row.rkey,
    content: JSON.parse(row.content) as unknown,
    sig: row.sig,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** List all records in a collection. Returns empty array if none. */
export function listRecords(repo: AgentRepository, collection: string): StoredRecord[] {
  const rows = repo.db
    .prepare('SELECT * FROM records WHERE collection = ? ORDER BY created_at ASC')
    .all(collection) as Array<{
      uri: string; collection: string; rkey: string; content: string; sig: string; created_at: string; updated_at: string;
    }>;

  return rows.map((row) => ({
    uri: row.uri,
    collection: row.collection,
    rkey: row.rkey,
    content: JSON.parse(row.content) as unknown,
    sig: row.sig,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Delete a record and append a delete commit to the log.
 *
 * @throws RecordNotFoundError if the record does not exist
 */
export function deleteRecord(repo: AgentRepository, collection: string, rkey: string): void {
  const row = repo.db
    .prepare('SELECT uri FROM records WHERE collection = ? AND rkey = ?')
    .get(collection, rkey) as { uri: string } | undefined;

  if (!row) throw new RecordNotFoundError(collection, rkey);

  const now = new Date().toISOString();
  const contentHash = sha256Hex(''); // Deletion marker

  const lastCommit = repo.db
    .prepare('SELECT repo_root_hash FROM commits ORDER BY seq DESC LIMIT 1')
    .get() as { repo_root_hash: string } | undefined;

  const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

  repo.db.prepare('DELETE FROM records WHERE collection = ? AND rkey = ?').run(collection, rkey);

  repo.db
    .prepare(
      'INSERT INTO commits (operation, record_uri, content_hash, repo_root_hash, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    .run('delete', row.uri, contentHash, repoRootHash, now);

  emitFirehoseEvent(repo, 'delete', collection, rkey, null);
}

/** Return the full commit log in sequence order. */
export function getCommitLog(repo: AgentRepository): Commit[] {
  return repo.db
    .prepare('SELECT * FROM commits ORDER BY seq ASC')
    .all() as Commit[];
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/** Export the full repository to a portable JSON format. */
export function exportRepository(repo: AgentRepository): RepositoryExport {
  const records = repo.db
    .prepare('SELECT * FROM records ORDER BY created_at ASC')
    .all() as Array<{
      uri: string; collection: string; rkey: string; content: string; sig: string;
    }>;

  const commits = getCommitLog(repo);

  const lastCommit = commits[commits.length - 1];
  const finalRootHash = lastCommit ? `sha256-${lastCommit.repo_root_hash}` : 'sha256-empty';

  return {
    did: repo.did,
    exportedAt: new Date().toISOString(),
    records: records.map((r) => ({
      uri: r.uri,
      collection: r.collection,
      rkey: r.rkey,
      content: JSON.parse(r.content) as unknown,
      sig: r.sig,
    })),
    commits,
    finalRootHash,
  };
}

/**
 * Import a repository from an exported snapshot.
 * Verifies:
 *   1. Each record's content hash matches the commit's content_hash
 *   2. Each commit's repo_root_hash chains correctly from the previous
 *   3. All record signatures verify against the DID
 *
 * @throws ImportVerificationError if any check fails
 */
export function importRepository(
  exportData: RepositoryExport,
  identity: AgentIdentity,
  firehose?: Firehose | null,
): AgentRepository {
  // Verify commit chain and signatures before writing anything
  const recordMap = new Map(exportData.records.map((r) => [r.uri, r]));
  let prevRootHash: string | null = null;

  for (const commit of exportData.commits) {
    // Verify content hash
    if (commit.operation !== 'delete') {
      const record = recordMap.get(commit.record_uri);
      if (!record) {
        throw new ImportVerificationError(
          commit.seq,
          `Record not found in export: ${commit.record_uri}`,
        );
      }
      const expectedHash = sha256Hex(canonicalize(record.content));
      if (expectedHash !== commit.content_hash) {
        throw new ImportVerificationError(
          commit.seq,
          `Content hash mismatch for ${commit.record_uri}`,
        );
      }
    }

    // Verify root hash chain
    const expectedRootHash = computeNextRootHash(prevRootHash, commit.content_hash);
    if (expectedRootHash !== commit.repo_root_hash) {
      throw new ImportVerificationError(commit.seq, 'Repo root hash chain broken');
    }
    prevRootHash = commit.repo_root_hash;
  }

  // Verify all record signatures
  for (const record of exportData.records) {
    try {
      verifySignature(exportData.did, record.content, record.sig);
    } catch {
      throw new ImportVerificationError(
        0,
        `Signature verification failed for record ${record.uri}`,
      );
    }
  }

  // All checks passed — create repo and replay records
  const repo = createMemoryRepository(identity, firehose);

  for (const record of exportData.records) {
    const [, , , collection, rkey] = record.uri.split('/'); // at: | '' | did | collection | rkey
    if (collection && rkey) {
      // Bypass putRecord to preserve original content without re-signing
      const now = new Date().toISOString();
      const contentHash = sha256Hex(canonicalize(record.content));
      const lastCommit = repo.db
        .prepare('SELECT repo_root_hash FROM commits ORDER BY seq DESC LIMIT 1')
        .get() as { repo_root_hash: string } | undefined;
      const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

      repo.db
        .prepare(
          'INSERT OR REPLACE INTO records (uri, collection, rkey, content, sig, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(record.uri, collection, rkey, JSON.stringify(record.content), record.sig, now, now);

      repo.db
        .prepare(
          'INSERT INTO commits (operation, record_uri, content_hash, repo_root_hash, timestamp) VALUES (?, ?, ?, ?, ?)',
        )
        .run('create', record.uri, contentHash, repoRootHash, now);
    }
  }

  return repo;
}
