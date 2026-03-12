import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryRepository,
  putRecord,
  getRecord,
  listRecords,
  deleteRecord,
  getCommitLog,
  exportRepository,
  importRepository,
} from './index.js';
import { generateIdentity } from '../identity/index.js';
import { createFirehose } from '../firehose/index.js';
import { RecordNotFoundError, ImportVerificationError } from '../errors.js';
import type { AgentIdentity } from '../schemas/types.js';

// Helper: create a fresh in-memory repo with optional firehose
function makeRepo(identity?: AgentIdentity, withFirehose = false) {
  const id = identity ?? generateIdentity('test.local', 'Test Agent');
  const firehose = withFirehose ? createFirehose() : undefined;
  return { repo: createMemoryRepository(id, firehose), identity: id, firehose };
}

describe('putRecord() — create', () => {
  it('returns a RecordResult with uri, cid, and commit', () => {
    const { repo, identity } = makeRepo();
    const result = putRecord(repo, 'net.test.profile', 'self', {
      did: identity.did,
    });
    expect(result.uri).toBe(`at://${identity.did}/net.test.profile/self`);
    expect(result.cid).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(result.commit.operation).toBe('create');
    expect(result.commit.seq).toBeGreaterThan(0);
  });

  it('stores the record retrievably', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'bar', { value: 42 });
    const stored = getRecord(repo, 'net.test.foo', 'bar');
    expect(stored.content).toEqual({ value: 42 });
  });

  it('stores a cryptographic signature with each record', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'key1', { hello: 'world' });
    const stored = getRecord(repo, 'net.test.foo', 'key1');
    expect(stored.sig).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(stored.sig.length).toBeGreaterThan(80); // Ed25519 sig is 64 bytes → ~86 base64url chars
  });
});

describe('putRecord() — upsert (update)', () => {
  it('updates an existing record without creating a duplicate', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'singleton', { version: 1 });
    const r2 = putRecord(repo, 'net.test.foo', 'singleton', { version: 2 });
    expect(r2.commit.operation).toBe('update');
    const records = listRecords(repo, 'net.test.foo');
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toEqual({ version: 2 });
  });

  it('both create and update appear in commit log', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'x', { v: 1 });
    putRecord(repo, 'net.test.foo', 'x', { v: 2 });
    const log = getCommitLog(repo);
    expect(log).toHaveLength(2);
    expect(log[0]?.operation).toBe('create');
    expect(log[1]?.operation).toBe('update');
  });
});

describe('getRecord()', () => {
  it('throws RecordNotFoundError for missing record', () => {
    const { repo } = makeRepo();
    expect(() => getRecord(repo, 'net.test.foo', 'nonexistent')).toThrow(RecordNotFoundError);
  });
});

describe('listRecords()', () => {
  it('returns empty array for unknown collection', () => {
    const { repo } = makeRepo();
    expect(listRecords(repo, 'net.test.empty')).toEqual([]);
  });

  it('returns all records in a collection', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.cap', 'a', { name: 'A' });
    putRecord(repo, 'net.test.cap', 'b', { name: 'B' });
    putRecord(repo, 'net.test.other', 'c', { name: 'C' }); // different collection
    const caps = listRecords(repo, 'net.test.cap');
    expect(caps).toHaveLength(2);
    expect(caps.map((r) => (r.content as { name: string }).name).sort()).toEqual(['A', 'B']);
  });
});

describe('deleteRecord()', () => {
  it('removes the record and adds a delete commit', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'to-delete', { x: 1 });
    deleteRecord(repo, 'net.test.foo', 'to-delete');
    expect(() => getRecord(repo, 'net.test.foo', 'to-delete')).toThrow(RecordNotFoundError);
    const log = getCommitLog(repo);
    expect(log[log.length - 1]?.operation).toBe('delete');
  });

  it('throws RecordNotFoundError when deleting nonexistent record', () => {
    const { repo } = makeRepo();
    expect(() => deleteRecord(repo, 'net.test.foo', 'ghost')).toThrow(RecordNotFoundError);
  });
});

describe('getCommitLog()', () => {
  it('seq increments monotonically', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'a', {});
    putRecord(repo, 'net.test.foo', 'b', {});
    putRecord(repo, 'net.test.foo', 'c', {});
    const log = getCommitLog(repo);
    expect(log.map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  it('commit chain: each repo_root_hash depends on previous', () => {
    const { repo } = makeRepo();
    putRecord(repo, 'net.test.foo', 'a', { v: 1 });
    putRecord(repo, 'net.test.foo', 'b', { v: 2 });
    const log = getCommitLog(repo);
    expect(log[0]?.repo_root_hash).toBeTruthy();
    expect(log[1]?.repo_root_hash).toBeTruthy();
    expect(log[0]?.repo_root_hash).not.toBe(log[1]?.repo_root_hash);
  });
});

describe('firehose integration', () => {
  it('emits a firehose event on putRecord', () => {
    const id = generateIdentity('test.local', 'Test');
    const firehose = createFirehose();
    const repo = createMemoryRepository(id, firehose);

    const events: unknown[] = [];
    firehose.subscriptions.set('test-sub', {
      id: 'test-sub',
      handler: (e) => events.push(e),
    });

    putRecord(repo, 'net.test.foo', 'item1', { hello: 'world' });
    expect(events).toHaveLength(1);
  });

  it('does not throw when firehose is null', () => {
    const { repo } = makeRepo(undefined, false);
    expect(() => putRecord(repo, 'net.test.foo', 'x', { data: 1 })).not.toThrow();
  });

  it('firehose event seq increments globally', () => {
    const id = generateIdentity('test.local', 'Test');
    const firehose = createFirehose();
    const repo = createMemoryRepository(id, firehose);

    const seqs: number[] = [];
    firehose.subscriptions.set('seq-test', {
      id: 'seq-test',
      handler: (e) => seqs.push(e.seq),
    });

    putRecord(repo, 'net.test.foo', 'a', {});
    putRecord(repo, 'net.test.foo', 'b', {});
    expect(seqs).toEqual([1, 2]);
  });
});

describe('exportRepository() + importRepository()', () => {
  it('exports and imports successfully with matching content', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { repo } = makeRepo(identity);

    putRecord(repo, 'net.test.profile', 'self', { did: identity.did, name: 'Test' });
    putRecord(repo, 'net.test.cap', 'skill-a', { domain: 'frontend' });

    const exported = exportRepository(repo);
    expect(exported.did).toBe(identity.did);
    expect(exported.records).toHaveLength(2);
    expect(exported.finalRootHash).toMatch(/^sha256-/);

    const imported = importRepository(exported, identity);
    const profile = getRecord(imported, 'net.test.profile', 'self');
    expect(profile.content).toEqual({ did: identity.did, name: 'Test' });
  });

  it('throws ImportVerificationError when content hash is tampered', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { repo } = makeRepo(identity);
    putRecord(repo, 'net.test.foo', 'item', { data: 'original' });

    const exported = exportRepository(repo);
    // Tamper with content
    if (exported.records[0]) {
      (exported.records[0] as { content: unknown }).content = { data: 'TAMPERED' };
    }

    expect(() => importRepository(exported, identity)).toThrow(ImportVerificationError);
  });

  it('throws ImportVerificationError when root hash chain is broken', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { repo } = makeRepo(identity);
    putRecord(repo, 'net.test.foo', 'item1', { v: 1 });
    putRecord(repo, 'net.test.foo', 'item2', { v: 2 });

    const exported = exportRepository(repo);
    // Tamper with a commit's repo_root_hash
    if (exported.commits[0]) {
      exported.commits[0].repo_root_hash = 'deadbeef'.repeat(8);
    }

    expect(() => importRepository(exported, identity)).toThrow(ImportVerificationError);
  });
});
