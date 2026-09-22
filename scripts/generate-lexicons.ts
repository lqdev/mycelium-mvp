import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { glob } from 'node:fs/promises';

const schemas = (await Array.fromAsync(glob('lexicons/**/*.json')))
  .filter((file) => !file.includes('\\auth\\') && !file.includes('/auth/'))
  .sort();
if (schemas.length === 0) throw new Error('No Lexicon JSON files found');

const cli = resolve('node_modules/@atproto/lex-cli/bin.js');
execFileSync(process.execPath, [
  cli,
  'gen-api',
  '--yes',
  'src/protocol/generated',
  ...schemas,
], { stdio: 'inherit' });
