import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'src/utils/staleChunkRecovery.ts'), 'utf8');
const studioStore = fs.readFileSync(path.join(root, 'src/store/useStudioStore.ts'), 'utf8');

test('a stale lazy-loaded module refreshes the current build once without entering a reload loop', () => {
  assert.match(main, /vite:preloadError/);
  assert.match(main, /unhandledrejection/);
  assert.match(recovery, /Failed to fetch dynamically imported module/);
  assert.match(recovery, /STALE_CHUNK_RELOAD_GUARD_MS\s*=\s*30_000/);
  assert.match(recovery, /sessionStorage\.setItem\(STALE_CHUNK_RELOAD_KEY/);
  assert.match(recovery, /window\.location\.reload\(\)/);
});

test('caught storyboard image analysis imports also recover the current build and preserve the current host', () => {
  assert.match(studioStore, /reloadAfterStaleChunk\(error\)/);
  assert.match(studioStore, /所需资源已更新，正在刷新当前页面并恢复工作区/);
  assert.doesNotMatch(recovery, /window\.location\.(?:assign|replace)\([^)]*127\.0\.0\.1/);
});
