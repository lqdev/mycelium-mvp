import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDuckDB,
  queryAll,
  queryOne,
  execute,
  type DuckDBInstance,
  type DuckDBConnection,
} from './duckdb.js';
import {
  initPersistence,
  shutdownPersistence,
  persistRecord,
  persistDeleteRecord,
  persistFirehoseEvent,
  loadFirehoseLog,
  loadIdentities,
  saveIdentity,
  getConn,
} from './persistence.js';
import type { AgentIdentity, CommitRow, FirehoseEvent, StoredRecordRow } from '../schemas/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Let fire-and-forget async writes complete before asserting. */
async function flush(ms = 80): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeRecordRow(overrides: Partial<StoredRecordRow> = {}): StoredRecordRow {
  return {
    uri: 'at://did:key:z6MkTest/net.test.foo/item1',
    collection: 'net.test.foo',
    rkey: 'item1',
    content: '{"hello":"world"}',
    sig: 'abc123sig',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCommitRow(overrides: Partial<CommitRow> = {}): CommitRow {
  return {
    seq: 1,
    operation: 'create',
    record_uri: 'at://did:key:z6MkTest/net.test.foo/item1',
    content_hash: 'abc123hash',
    repo_root_hash: 'def456root',
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFirehoseEvent(overrides: Partial<FirehoseEvent> = {}): FirehoseEvent {
  return {
    seq: 1,
    type: 'commit',
    operation: 'create',
    did: 'did:key:z6MkTest',
    collection: 'net.test.foo',
    rkey: 'item1',
    record: { hello: 'world' },
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── createDuckDB ─────────────────────────────────────────────────────────────

describe('createDuckDB()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  afterEach(() => {
    instance?.closeSync();
  });

  it('creates an in-memory database with all three tables', async () => {
    ({ instance, conn } = await createDuckDB());
    const tables = await queryAll<{ table_name: string }>(
      conn,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    const names = tables.map((t) => t.table_name).sort();
    expect(names).toContain('commits');
    expect(names).toContain('firehose_events');
    expect(names).toContain('records');
  });

  it('creates the firehose_events indexes', async () => {
    ({ instance, conn } = await createDuckDB());
    const indexes = await queryAll<{ index_name: string }>(
      conn,
      "SELECT index_name FROM duckdb_indexes() WHERE table_name = 'firehose_events' ORDER BY index_name",
    );
    const names = indexes.map((i) => i.index_name);
    expect(names).toContain('idx_events_collection');
    expect(names).toContain('idx_events_did');
    expect(names).toContain('idx_events_col_did');
  });

  it('applying schema SQL twice does not throw (IF NOT EXISTS guards)', async () => {
    ({ instance, conn } = await createDuckDB());
    // Running the schema again (as createDuckDB does internally) must be safe
    await expect(
      conn.run(`CREATE TABLE IF NOT EXISTS records (
        repo_did VARCHAR NOT NULL, uri VARCHAR NOT NULL, collection VARCHAR NOT NULL,
        rkey VARCHAR NOT NULL, content JSON NOT NULL, sig VARCHAR NOT NULL,
        created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL,
        PRIMARY KEY (repo_did, collection, rkey)
      )`),
    ).resolves.not.toThrow();
  });
});

// ─── queryAll ─────────────────────────────────────────────────────────────────

describe('queryAll()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
  });

  afterEach(() => {
    instance.closeSync();
  });

  it('returns an empty array when the table is empty', async () => {
    const rows = await queryAll(conn, 'SELECT * FROM records');
    expect(rows).toEqual([]);
  });

  it('returns all inserted rows', async () => {
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (1, 'create', 'did:key:z6Mk', 'net.test.a', 'r1', '2024-01-01T00:00:00Z')`);
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (2, 'create', 'did:key:z6Mk', 'net.test.b', 'r2', '2024-01-01T00:00:01Z')`);
    const rows = await queryAll(conn, 'SELECT * FROM firehose_events ORDER BY seq');
    expect(rows).toHaveLength(2);
  });

  it('supports parameterized queries', async () => {
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (1, 'create', 'did:key:z6Mk', 'net.test.foo', 'r1', '2024-01-01T00:00:00Z')`);
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (2, 'create', 'did:key:z6Mk', 'net.test.bar', 'r2', '2024-01-01T00:00:00Z')`);
    const rows = await queryAll(conn, 'SELECT * FROM firehose_events WHERE collection = $1', ['net.test.foo']);
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>).collection).toBe('net.test.foo');
  });
});

// ─── queryOne ─────────────────────────────────────────────────────────────────

describe('queryOne()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
  });

  afterEach(() => {
    instance.closeSync();
  });

  it('returns null when no rows match', async () => {
    const row = await queryOne(conn, 'SELECT * FROM records WHERE repo_did = $1', ['nonexistent']);
    expect(row).toBeNull();
  });

  it('returns the first row when results exist', async () => {
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (7, 'create', 'did:key:z6Mk', 'net.test.foo', 'r1', '2024-01-01T00:00:00Z')`);
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (8, 'create', 'did:key:z6Mk', 'net.test.foo', 'r2', '2024-01-01T00:00:01Z')`);
    const row = await queryOne<{ collection: string }>(conn, 'SELECT collection FROM firehose_events ORDER BY seq');
    expect(row).not.toBeNull();
    expect(row!.collection).toBe('net.test.foo');
  });
});

// ─── execute ──────────────────────────────────────────────────────────────────

describe('execute()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
  });

  afterEach(() => {
    instance.closeSync();
  });

  it('inserts a row that is subsequently readable', async () => {
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (1, 'create', 'did:key:z6Mk', 'net.test.foo', 'r1', '2024-01-01T00:00:00Z')`);
    const rows = await queryAll(conn, 'SELECT * FROM firehose_events');
    expect(rows).toHaveLength(1);
  });

  it('deletes a row that was previously inserted', async () => {
    await execute(conn, `INSERT INTO firehose_events (seq, operation, did, collection, rkey, timestamp) VALUES (1, 'create', 'did:key:z6Mk', 'net.test.foo', 'r1', '2024-01-01T00:00:00Z')`);
    await execute(conn, 'DELETE FROM firehose_events WHERE seq = $1', [1]);
    const rows = await queryAll(conn, 'SELECT * FROM firehose_events');
    expect(rows).toHaveLength(0);
  });
});

// ─── persistence lifecycle ────────────────────────────────────────────────────

describe('persistence lifecycle', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    shutdownPersistence();
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('getConn() returns null before initPersistence', () => {
    expect(getConn()).toBeNull();
  });

  it('getConn() returns the conn passed to initPersistence', () => {
    initPersistence(conn);
    expect(getConn()).toBe(conn);
  });

  it('getConn() returns null after shutdownPersistence', () => {
    initPersistence(conn);
    shutdownPersistence();
    expect(getConn()).toBeNull();
  });
});

// ─── persistRecord ────────────────────────────────────────────────────────────

describe('persistRecord() — fire-and-forget', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    initPersistence(conn);
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('is a no-op when persistence is not initialized (does not throw)', () => {
    shutdownPersistence();
    expect(() => persistRecord('did:key:z6MkTest', makeRecordRow(), makeCommitRow())).not.toThrow();
  });

  it('writes a record row and a commit row', async () => {
    persistRecord('did:key:z6MkTest', makeRecordRow(), makeCommitRow());
    await flush();

    expect(await queryAll(conn, 'SELECT * FROM records')).toHaveLength(1);
    expect(await queryAll(conn, 'SELECT * FROM commits')).toHaveLength(1);
  });

  it('stores the correct repo_did and collection', async () => {
    persistRecord('did:key:z6MkTest', makeRecordRow(), makeCommitRow());
    await flush();

    const row = await queryOne<{ repo_did: string; collection: string }>(conn, 'SELECT repo_did, collection FROM records');
    expect(row!.repo_did).toBe('did:key:z6MkTest');
    expect(row!.collection).toBe('net.test.foo');
  });

  it('upserts on duplicate primary key — record count stays 1', async () => {
    persistRecord('did:key:z6MkTest', makeRecordRow({ content: '{"v":1}' }), makeCommitRow({ seq: 1 }));
    await flush();
    persistRecord('did:key:z6MkTest', makeRecordRow({ content: '{"v":2}', updated_at: '2024-01-02T00:00:00.000Z' }), makeCommitRow({ seq: 2 }));
    await flush();

    const records = await queryAll<{ content: string }>(conn, 'SELECT content FROM records');
    expect(records).toHaveLength(1);
    const parsed = JSON.parse(records[0]!.content) as { v: number };
    expect(parsed.v).toBe(2);
  });

  it('writes two different repo DIDs independently', async () => {
    persistRecord('did:key:z6MkA', makeRecordRow({ uri: 'at://did:key:z6MkA/net.test.foo/item1' }), makeCommitRow({ seq: 1 }));
    persistRecord('did:key:z6MkB', makeRecordRow({ uri: 'at://did:key:z6MkB/net.test.foo/item1' }), makeCommitRow({ seq: 1 }));
    await flush();

    expect(await queryAll(conn, 'SELECT * FROM records')).toHaveLength(2);
    expect(await queryAll(conn, 'SELECT * FROM commits')).toHaveLength(2);
  });
});

// ─── persistDeleteRecord ──────────────────────────────────────────────────────

describe('persistDeleteRecord() — fire-and-forget', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    initPersistence(conn);
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('removes the record row and appends a delete commit', async () => {
    persistRecord('did:key:z6MkTest', makeRecordRow(), makeCommitRow({ seq: 1 }));
    await flush();
    persistDeleteRecord('did:key:z6MkTest', 'net.test.foo', 'item1', makeCommitRow({ seq: 2, operation: 'delete' }));
    await flush();

    expect(await queryAll(conn, 'SELECT * FROM records')).toHaveLength(0);
    const commits = await queryAll<{ operation: string }>(conn, 'SELECT operation FROM commits ORDER BY seq');
    expect(commits).toHaveLength(2);
    expect(commits[1]!.operation).toBe('delete');
  });

  it('is a no-op when persistence is not initialized (does not throw)', () => {
    shutdownPersistence();
    expect(() =>
      persistDeleteRecord('did:key:z6MkTest', 'net.test.foo', 'item1', makeCommitRow({ seq: 1, operation: 'delete' })),
    ).not.toThrow();
  });
});

// ─── persistFirehoseEvent ─────────────────────────────────────────────────────

describe('persistFirehoseEvent() — fire-and-forget', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    initPersistence(conn);
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('writes an event with a JSON record payload', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, record: { hello: 'world' } }));
    await flush();

    const events = await queryAll<{ record: string | null }>(conn, 'SELECT record FROM firehose_events');
    expect(events).toHaveLength(1);
    expect(events[0]!.record).not.toBeNull();
    const parsed = JSON.parse(events[0]!.record!) as unknown;
    expect(parsed).toEqual({ hello: 'world' });
  });

  it('writes a null record for delete events', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, operation: 'delete', record: null }));
    await flush();

    const events = await queryAll<{ record: string | null }>(conn, 'SELECT record FROM firehose_events');
    expect(events[0]!.record).toBeNull();
  });

  it('ignores duplicate seq values (INSERT OR IGNORE)', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, collection: 'net.test.first' }));
    await flush(); // ensure first write commits before the duplicate is attempted
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, collection: 'net.test.second' }));
    await flush();

    const events = await queryAll<{ collection: string }>(conn, 'SELECT collection FROM firehose_events');
    expect(events).toHaveLength(1);
    expect(events[0]!.collection).toBe('net.test.first');
  });

  it('is a no-op when persistence is not initialized (does not throw)', () => {
    shutdownPersistence();
    expect(() => persistFirehoseEvent(makeFirehoseEvent())).not.toThrow();
  });
});

// ─── loadFirehoseLog ──────────────────────────────────────────────────────────

describe('loadFirehoseLog()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    initPersistence(conn);
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('returns an empty array when persistence is not initialized', async () => {
    shutdownPersistence();
    await expect(loadFirehoseLog()).resolves.toEqual([]);
  });

  it('returns an empty array when no events exist', async () => {
    await expect(loadFirehoseLog()).resolves.toEqual([]);
  });

  it('returns events ordered by seq ascending', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 3, collection: 'net.test.c' }));
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, collection: 'net.test.a' }));
    persistFirehoseEvent(makeFirehoseEvent({ seq: 2, collection: 'net.test.b' }));
    await flush();

    const events = await loadFirehoseLog();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('deserializes all fields with correct types', async () => {
    const ts = '2024-06-15T12:00:00.000Z';
    persistFirehoseEvent(makeFirehoseEvent({ seq: 42, did: 'did:key:z6MkABC', timestamp: ts, operation: 'update' }));
    await flush();

    const [event] = await loadFirehoseLog();
    expect(event).toBeDefined();
    expect(event!.seq).toBe(42);
    expect(event!.type).toBe('commit');
    expect(event!.operation).toBe('update');
    expect(event!.did).toBe('did:key:z6MkABC');
    expect(event!.timestamp).toBe(ts);
  });

  it('deserializes the record JSON field back to an object', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, record: { hello: 'world', n: 42 } }));
    await flush();

    const [event] = await loadFirehoseLog();
    expect(event!.record).toEqual({ hello: 'world', n: 42 });
  });

  it('preserves null record for delete events', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 1, operation: 'delete', record: null }));
    await flush();

    const [event] = await loadFirehoseLog();
    expect(event!.record).toBeNull();
  });

  it('round-trips the last seq — usable as firehose recovery cursor', async () => {
    persistFirehoseEvent(makeFirehoseEvent({ seq: 10 }));
    persistFirehoseEvent(makeFirehoseEvent({ seq: 20 }));
    persistFirehoseEvent(makeFirehoseEvent({ seq: 30 }));
    await flush();

    const events = await loadFirehoseLog();
    const lastSeq = events[events.length - 1]!.seq;
    expect(lastSeq + 1).toBe(31); // next seq after recovery
  });
});

// ─── loadIdentities / saveIdentity ───────────────────────────────────────────

function makeIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    did: 'did:key:z6MkTestAgent',
    handle: 'test-agent.mycelium.local',
    displayName: 'Test Agent',
    publicKey: new Uint8Array(32).fill(1),
    privateKey: new Uint8Array(32).fill(2),
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('loadIdentities() / saveIdentity()', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    ({ instance, conn } = await createDuckDB());
    initPersistence(conn);
  });

  afterEach(() => {
    shutdownPersistence();
    instance.closeSync();
  });

  it('returns empty Map when no identities saved', async () => {
    const result = await loadIdentities();
    expect(result.size).toBe(0);
  });

  it('returns empty Map when persistence is not initialized', async () => {
    shutdownPersistence();
    const result = await loadIdentities();
    expect(result.size).toBe(0);
  });

  it('saveIdentity() is a no-op when persistence is not initialized (does not throw)', () => {
    shutdownPersistence();
    expect(() => saveIdentity(makeIdentity())).not.toThrow();
  });

  it('round-trips an identity: save then load', async () => {
    const identity = makeIdentity();
    saveIdentity(identity);
    await flush();

    const loaded = await loadIdentities();
    expect(loaded.size).toBe(1);
    const saved = loaded.get(identity.handle);
    expect(saved).toBeDefined();
    expect(saved!.did).toBe(identity.did);
    expect(saved!.handle).toBe(identity.handle);
    expect(saved!.displayName).toBe(identity.displayName);
    expect(saved!.createdAt).toBe(identity.createdAt);
    expect(saved!.plcDid).toBeUndefined();
  });

  it('round-trips plcDid when set', async () => {
    const identity = makeIdentity({ plcDid: 'did:plc:testplcabc123' });
    saveIdentity(identity);
    await flush();

    const loaded = await loadIdentities();
    expect(loaded.get(identity.handle)?.plcDid).toBe('did:plc:testplcabc123');
  });

  it('preserves plcDid through upsert (second save with plcDid set)', async () => {
    const identity = makeIdentity();
    saveIdentity(identity);
    await flush();
    identity.plcDid = 'did:plc:updatedplc456';
    saveIdentity(identity);
    await flush();

    const loaded = await loadIdentities();
    expect(loaded.get(identity.handle)?.plcDid).toBe('did:plc:updatedplc456');
  });

  it('preserves public and private key bytes across round-trip', async () => {
    const identity = makeIdentity({
      publicKey: new Uint8Array([10, 20, 30]),
      privateKey: new Uint8Array([40, 50, 60]),
    });
    saveIdentity(identity);
    await flush();

    const loaded = (await loadIdentities()).get(identity.handle)!;
    expect(Array.from(loaded.publicKey)).toEqual([10, 20, 30]);
    expect(Array.from(loaded.privateKey)).toEqual([40, 50, 60]);
  });

  it('upserts on duplicate handle (last write wins)', async () => {
    const id1 = makeIdentity({ did: 'did:key:z6MkFirst' });
    const id2 = makeIdentity({ did: 'did:key:z6MkSecond' });
    saveIdentity(id1);
    await flush();
    saveIdentity(id2);
    await flush();

    const loaded = await loadIdentities();
    expect(loaded.size).toBe(1);
    expect(loaded.get(id1.handle)!.did).toBe('did:key:z6MkSecond');
  });

  it('loads multiple identities keyed by handle', async () => {
    saveIdentity(makeIdentity({ handle: 'agent-a.mycelium.local', did: 'did:key:z6MkA' }));
    saveIdentity(makeIdentity({ handle: 'agent-b.mycelium.local', did: 'did:key:z6MkB' }));
    await flush();

    const loaded = await loadIdentities();
    expect(loaded.size).toBe(2);
    expect(loaded.get('agent-a.mycelium.local')!.did).toBe('did:key:z6MkA');
    expect(loaded.get('agent-b.mycelium.local')!.did).toBe('did:key:z6MkB');
  });
});
