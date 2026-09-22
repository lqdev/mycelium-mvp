import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const files = (await Array.fromAsync(glob('lexicons/**/*.json'))).sort();
if (files.length === 0) {
  throw new Error('No Lexicon JSON files found');
}

const ids = new Set<string>();
for (const file of files) {
  const document = JSON.parse(await readFile(file, 'utf8')) as {
    lexicon?: number;
    id?: string;
    defs?: Record<string, { type?: string; record?: unknown; permissions?: unknown }>;
  };
  if (document.lexicon !== 1 || !document.id || !document.defs || Object.keys(document.defs).length === 0) {
    throw new Error(`${file} is not a Lexicon 1 document with definitions`);
  }
  if (ids.has(document.id)) throw new Error(`Duplicate Lexicon id: ${document.id}`);
  ids.add(document.id);

  const main = document.defs.main;
  if (main) {
    if (main.type === 'record' && !main.record) {
      throw new Error(`${file} record Lexicon is missing defs.main.record`);
    }
    if (main.type === 'permission-set' && !main.permissions) {
      throw new Error(`${file} permission-set is missing defs.main.permissions`);
    }
  }
  if (!document.id.startsWith('me.lqdev.mycelium.')) {
    throw new Error(`${file} is outside the Mycelium namespace`);
  }
}

console.log(`Validated ${files.length} Lexicon documents`);
