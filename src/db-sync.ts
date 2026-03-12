// Thin wrapper for node:sqlite that bypasses Vite's static import analysis.
// node:sqlite is experimental and absent from module.builtinModules, so Vite
// fails to resolve static `import ... from 'node:sqlite'` in test mode.
// createRequire() goes through Node.js's native resolver, sidestepping Vite.

import { createRequire } from 'node:module';
import type * as nodeSqliteTypes from 'node:sqlite';

const _sqlite = createRequire(import.meta.url)('node:sqlite') as typeof nodeSqliteTypes;

export const DatabaseSync = _sqlite.DatabaseSync;
