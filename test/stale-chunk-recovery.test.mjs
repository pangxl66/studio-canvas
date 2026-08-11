import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');

test('a stale lazy-loaded module refreshes the current build once without entering a reload loop', () => {
  assert.match(main, /vite:preloadError/);
  assert.match(main, /Failed to fetch dynamically imported module/);
  assert.match(main, /unhandledrejection/);
  assert.match(main, /STALE_CHUNK_RELOAD_GUARD_MS\s*=\s*30_000/);
  assert.match(main, /sessionStorage\.setItem\(STALE_CHUNK_RELOAD_KEY/);
  assert.match(main, /window\.location\.reload\(\)/);
});
