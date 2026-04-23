// DuckDB connection factory + query helpers.
// Used only by the persistence layer — the live simulation uses in-memory stores.

import duckdb from '@duckdb/node-api';

export type DuckDBInstance = InstanceType<typeof duckdb.DuckDBInstance>;
export type DuckDBConnection = Awaited<ReturnType<DuckDBInstance['connect']>>;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS records (
    repo_did     VARCHAR NOT NULL,
    uri          VARCHAR NOT NULL,
    collection   VARCHAR NOT NULL,
    rkey         VARCHAR NOT NULL,
    content      JSON    NOT NULL,
    sig          VARCHAR NOT NULL,
    created_at   VARCHAR NOT NULL,
    updated_at   VARCHAR NOT NULL,
    PRIMARY KEY (repo_did, collection, rkey)
  );

  CREATE TABLE IF NOT EXISTS commits (
    repo_did       VARCHAR NOT NULL,
    seq            BIGINT  NOT NULL,
    operation      VARCHAR NOT NULL,
    record_uri     VARCHAR NOT NULL,
    content_hash   VARCHAR NOT NULL,
    repo_root_hash VARCHAR NOT NULL,
    timestamp      VARCHAR NOT NULL,
    PRIMARY KEY (repo_did, seq)
  );

  CREATE TABLE IF NOT EXISTS firehose_events (
    seq         BIGINT  PRIMARY KEY,
    type        VARCHAR NOT NULL DEFAULT 'commit',
    operation   VARCHAR NOT NULL,
    did         VARCHAR NOT NULL,
    collection  VARCHAR NOT NULL,
    rkey        VARCHAR NOT NULL,
    record      JSON,
    timestamp   VARCHAR NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_collection
    ON firehose_events(collection);
  CREATE INDEX IF NOT EXISTS idx_events_did
    ON firehose_events(did);
  CREATE INDEX IF NOT EXISTS idx_events_col_did
    ON firehose_events(collection, did);

  CREATE TABLE IF NOT EXISTS agent_identities (
    handle       VARCHAR PRIMARY KEY,
    did          VARCHAR NOT NULL,
    plc_did      VARCHAR,
    display_name VARCHAR NOT NULL,
    public_key   VARCHAR NOT NULL,
    private_key  VARCHAR NOT NULL,
    created_at   VARCHAR NOT NULL
  );

  -- Idempotent migration: add plc_did to pre-existing databases
  ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS plc_did VARCHAR;
`;

/**
 * Open (or create) a DuckDB database and apply the Mycelium schema.
 * Pass a file path for persistence, or omit for an in-memory database.
 */
export async function createDuckDB(path?: string): Promise<{
  instance: DuckDBInstance;
  conn: DuckDBConnection;
}> {
  const instance = await duckdb.DuckDBInstance.create(path ?? ':memory:');
  const conn = await instance.connect();
  await conn.run(SCHEMA_SQL);
  return { instance, conn };
}

/** Run a query and return all rows as plain objects. */
export async function queryAll<T = Record<string, unknown>>(
  conn: DuckDBConnection,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const reader = await conn.runAndReadAll(sql, params as never[]);
  return reader.getRowObjects() as T[];
}

/** Run a query and return the first row, or null if no results. */
export async function queryOne<T = Record<string, unknown>>(
  conn: DuckDBConnection,
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await queryAll<T>(conn, sql, params);
  return rows[0] ?? null;
}

/** Execute a statement without reading results (INSERT / UPDATE / DELETE / DDL). */
export async function execute(
  conn: DuckDBConnection,
  sql: string,
  params?: unknown[],
): Promise<void> {
  await conn.run(sql, params as never[]);
}
