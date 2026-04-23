#!/usr/bin/env tsx
// Clears the data/ directory for a fresh start.
// Usage: npm run reset

import { rmSync, existsSync } from 'node:fs';

const dataDir = './data';
if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log('✅ Cleared data/ — next run will start fresh.');
} else {
  console.log('ℹ️  data/ does not exist — nothing to clear.');
}
