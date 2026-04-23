#!/usr/bin/env tsx
// Run a SQL query against the local DuckDB file and print results.
// Usage: npm run query "<SQL>"
// Example: npm run query "SELECT did, collection, COUNT(*) FROM firehose_events GROUP BY 1,2"

import { createDuckDB, queryAll } from '../src/storage/duckdb.js';

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('Usage: npm run query "<SQL>"');
  console.error('');
  console.error('Example queries:');
  console.error('  npm run query "SELECT * FROM agent_identities"');
  console.error('  npm run query "SELECT collection, COUNT(*) FROM firehose_events GROUP BY 1"');
  console.error('  npm run query "SELECT * FROM records ORDER BY created_at DESC LIMIT 10"');
  process.exit(1);
}

const { instance, conn } = await createDuckDB('./data/mycelium.duckdb');
try {
  const rows = await queryAll(conn, sql);
  if (rows.length === 0) {
    console.log('(no rows returned)');
  } else {
    console.table(rows);
    console.log(`${rows.length} row(s)`);
  }
} catch (err) {
  console.error('Query error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await instance.close();
}
