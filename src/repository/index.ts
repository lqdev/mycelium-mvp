// Repository module: in-memory record store (one store per agent).
// Each write is auto-signed and optionally emits to the firehose.

import { sha256 } from '@noble/hashes/sha256';
import type {
  AgentIdentity,
  AgentRepository,
  CommitRow,
  Firehose,
  InMemoryStore,
  RecordResult,
  RepositoryExport,
  StoredRecord,
  StoredRecordRow,
} from '../schemas/types.js';
import { canonicalize, signContent, verifySignature } from '../identity/index.js';
import { ImportVerificationError, RecordNotFoundError } from '../errors.js';
import { publish } from '../firehose/index.js';
import { validateRecord } from '../schemas/index.js';
import { persistRecord, persistDeleteRecord } from '../storage/persistence.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return Buffer.from(sha256(bytes)).toString('hex');
}

function computeNextRootHash(prevRootHash: string | null, contentHash: string): string {
  if (prevRootHash === null) return contentHash;
  return sha256Hex(prevRootHash + ':' + contentHash);
}

function recordKey(collection: string, rkey: string): string {
  return `${collection}\0${rkey}`;
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

// ─── Factory ──────────────────────────────────────────────────────────────────

function createStore(): InMemoryStore {
  return { records: new Map(), commits: [], seq: 0 };
}

/**
 * Create an in-memory repository.
 * Used for all current code paths — tests, demo, dashboard.
 */
export function createMemoryRepository(
  identity: AgentIdentity,
  firehose?: Firehose | null,
): AgentRepository {
  return {
    did: identity.did,
    store: createStore(),
    identity,
    firehose: firehose ?? null,
  };
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Upsert a record into the repository.
 * Signing happens here — callers pass plain content.
 * Emits a firehose event if the repository has one.
 */
export function putRecord(
  repo: AgentRepository,
  collection: string,
  rkey: string,
  content: unknown,
): RecordResult {
  const uri = `at://${repo.did}/${collection}/${rkey}`;
  const now = new Date().toISOString();

  validateRecord(collection, content);

  const { sig } = signContent(repo.identity, content);
  const contentJson = JSON.stringify(content);
  const contentHash = sha256Hex(canonicalize(content));

  const key = recordKey(collection, rkey);
  const existing = repo.store.records.has(key);
  const operation: 'create' | 'update' = existing ? 'update' : 'create';

  const lastCommit = repo.store.commits[repo.store.commits.length - 1];
  const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

  if (operation === 'create') {
    repo.store.records.set(key, {
      uri, collection, rkey, content: contentJson, sig,
      created_at: now, updated_at: now,
    });
  } else {
    const prev = repo.store.records.get(key)!;
    repo.store.records.set(key, { ...prev, content: contentJson, sig, updated_at: now });
  }

  const seq = ++repo.store.seq;
  repo.store.commits.push({
    seq, operation, record_uri: uri,
    content_hash: contentHash, repo_root_hash: repoRootHash, timestamp: now,
  });

  emitFirehoseEvent(repo, operation, collection, rkey, content);

  // Async write-through to DuckDB (fire-and-forget, never blocks simulation)
  persistRecord(repo.did, repo.store.records.get(key)!, repo.store.commits[repo.store.commits.length - 1]);

  return { uri, cid: contentHash, commit: { seq, operation, repoRootHash } };
}

/**
 * Retrieve a record by collection and rkey.
 *
 * @throws RecordNotFoundError if the record does not exist
 */
export function getRecord(repo: AgentRepository, collection: string, rkey: string): StoredRecord {
  const row = repo.store.records.get(recordKey(collection, rkey));
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

/** List all records in a collection, ordered by creation time. */
export function listRecords(repo: AgentRepository, collection: string): StoredRecord[] {
  const rows: StoredRecordRow[] = [];
  for (const row of repo.store.records.values()) {
    if (row.collection === collection) rows.push(row);
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));

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
  const key = recordKey(collection, rkey);
  const row = repo.store.records.get(key);
  if (!row) throw new RecordNotFoundError(collection, rkey);

  const now = new Date().toISOString();
  const contentHash = sha256Hex(''); // Deletion marker

  const lastCommit = repo.store.commits[repo.store.commits.length - 1];
  const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

  repo.store.records.delete(key);

  const seq = ++repo.store.seq;
  repo.store.commits.push({
    seq, operation: 'delete', record_uri: row.uri,
    content_hash: contentHash, repo_root_hash: repoRootHash, timestamp: now,
  });

  emitFirehoseEvent(repo, 'delete', collection, rkey, null);

  // Async write-through to DuckDB (fire-and-forget, never blocks simulation)
  persistDeleteRecord(repo.did, collection, rkey, repo.store.commits[repo.store.commits.length - 1]);
}

/** Return the full commit log in sequence order. */
export function getCommitLog(repo: AgentRepository): CommitRow[] {
  return [...repo.store.commits];
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/** Export the full repository to a portable JSON format. */
export function exportRepository(repo: AgentRepository): RepositoryExport {
  const records: Array<{ uri: string; collection: string; rkey: string; content: unknown; sig: string }> = [];
  for (const row of repo.store.records.values()) {
    records.push({
      uri: row.uri,
      collection: row.collection,
      rkey: row.rkey,
      content: JSON.parse(row.content) as unknown,
      sig: row.sig,
    });
  }
  records.sort((a, b) => a.uri.localeCompare(b.uri));

  const commits = getCommitLog(repo);
  const lastCommit = commits[commits.length - 1];
  const finalRootHash = lastCommit ? `sha256-${lastCommit.repo_root_hash}` : 'sha256-empty';

  return { did: repo.did, exportedAt: new Date().toISOString(), records, commits, finalRootHash };
}

/**
 * Import a repository from an exported snapshot.
 * Verifies:
 *   1. Each record content hash matches the commit content_hash
 *   2. Each commit repo_root_hash chains correctly from the previous
 *   3. All record signatures verify against the DID
 *
 * @throws ImportVerificationError if any check fails
 */
export function importRepository(
  exportData: RepositoryExport,
  identity: AgentIdentity,
  firehose?: Firehose | null,
): AgentRepository {
  const recordMap = new Map(exportData.records.map((r) => [r.uri, r]));
  let prevRootHash: string | null = null;

  for (const commit of exportData.commits) {
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

    const expectedRootHash = computeNextRootHash(prevRootHash, commit.content_hash);
    if (expectedRootHash !== commit.repo_root_hash) {
      throw new ImportVerificationError(commit.seq, 'Repo root hash chain broken');
    }
    prevRootHash = commit.repo_root_hash;
  }

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

  const repo = createMemoryRepository(identity, firehose);

  for (const record of exportData.records) {
    const [, , , collection, rkey] = record.uri.split('/'); // at: | '' | did | collection | rkey
    if (collection && rkey) {
      const now = new Date().toISOString();
      const contentHash = sha256Hex(canonicalize(record.content));
      const lastCommit = repo.store.commits[repo.store.commits.length - 1];
      const repoRootHash = computeNextRootHash(lastCommit?.repo_root_hash ?? null, contentHash);

      const key = recordKey(collection, rkey);
      repo.store.records.set(key, {
        uri: record.uri, collection, rkey,
        content: JSON.stringify(record.content), sig: record.sig,
        created_at: now, updated_at: now,
      });

      const seq = ++repo.store.seq;
      repo.store.commits.push({
        seq, operation: 'create', record_uri: record.uri,
        content_hash: contentHash, repo_root_hash: repoRootHash, timestamp: now,
      });
    }
  }

  return repo;
}