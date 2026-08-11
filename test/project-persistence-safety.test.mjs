import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('project snapshot writes are serialized and update the active project atomically', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');
  assert.match(persistence, /let studioProjectWriteQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(persistence, /function queueStudioProjectSnapshot/);
  assert.match(persistence, /\.then\(\(\) => putStudioProjectSnapshotNow\(payload\)\)/);
  assert.match(persistence, /externalizeStudioProjectImages\(payload\)/);
  assert.match(persistence, /store\.put\(compactPayload, STUDIO_IDB_AUTOSAVE_KEY\)/);
  assert.match(persistence, /store\.put\(record, projectKey\(compactPayload\.projectId\)\)/);
  assert.match(persistence, /STUDIO_IDB_ACTIVE_PROJECT_KEY/);
});

test('project switching flushes the current snapshot before replacing the canvas', () => {
  const menu = read('src/components/StudioProjectMenu.tsx');
  const canvas = read('src/components/StudioCanvas.tsx');
  assert.match(menu, /await persistence\.flushCurrentProjectSnapshot\(\)/);
  assert.match(menu, /打开工程失败，当前画布未被替换/);
  assert.match(canvas, /await queueStudioProjectSnapshot\(/);
  assert.match(canvas, /画布未被替换/);
});

test('local project management exposes save state, all projects, and a recovery export', () => {
  const menu = read('src/components/StudioProjectMenu.tsx');
  const persistence = read('src/services/studioProjectPersistence.ts');
  assert.match(menu, /全部本地工程/);
  assert.doesNotMatch(menu, /MAX_RECENT_PROJECTS/);
  assert.match(menu, /导出全部恢复包/);
  assert.match(menu, /打开工程文件 \/ 恢复包/);
  assert.match(menu, /studio-project-hub__save-state/);
  assert.match(persistence, /createStudioProjectRecoveryBundle/);
  assert.match(persistence, /importStudioProjectRecoveryBundle/);
  assert.match(persistence, /storedTimestamp\(current\) > storedTimestamp\(entry\.value\)/);
  assert.match(persistence, /store\.getAllKeys\(\)/);
  assert.match(persistence, /store\.getAll\(\)/);
});

test('local Vite origins are pinned so browser storage does not silently split by port', () => {
  const viteConfig = read('vite.config.ts');
  assert.match(viteConfig, /host: '127\.0\.0\.1'/);
  assert.match(viteConfig, /port: 4173/);
  assert.match(viteConfig, /strictPort: true/);
  assert.match(viteConfig, /configurePreviewServer/);
  assert.match(viteConfig, /attachLocalApi\(server\)/);
});

test('local projects are mirrored to a loopback-only disk repository outside the source tree', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');
  const diskService = read('src/services/localProjectDiskService.ts');
  const server = read('server/index.cjs');
  assert.match(persistence, /saveStudioProjectSnapshotToDisk\(compactPayload\)/);
  assert.match(persistence, /STUDIO_IDB_ASSET_STORE/);
  assert.match(persistence, /hydrateStudioProjectPayloadImages/);
  assert.match(diskService, /\/api\/local-project-assets/);
  assert.match(diskService, /\/api\/local-projects\/snapshot/);
  assert.match(diskService, /getActiveDiskProjectSnapshot/);
  assert.match(server, /function isLoopbackRequest/);
  assert.match(server, /LOCALAPPDATA/);
  assert.match(server, /'Studio Canvas', 'projects'/);
  assert.match(server, /migrateLegacyLocalProjectData/);
});

test('image assets restore once and use bounded parallel IO', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');

  assert.match(persistence, /const IMAGE_ASSET_IO_CONCURRENCY = 2/);
  assert.match(persistence, /const IMAGE_ASSET_MEMORY_CACHE_MAX_BYTES = 160 \* 1024 \* 1024/);
  assert.match(persistence, /const studioImageAssetMemoryCache = new Map/);
  assert.match(persistence, /while \(\s*studioImageAssetMemoryCacheBytes > IMAGE_ASSET_MEMORY_CACHE_MAX_BYTES/);
  assert.match(persistence, /if \(!missingAssetIds\.length\) return assets/);
  assert.match(persistence, /const pendingImageAssetRestores = new Map/);
  assert.match(persistence, /async function mapWithConcurrency/);
  assert.match(persistence, /const pending = pendingImageAssetRestores\.get\(assetId\)/);
  assert.match(persistence, /const missingAssetIds = \[\.\.\.assetIds\]\.filter/);
  assert.match(persistence, /restoreStudioImageAssetFromDisk/);
  assert.doesNotMatch(persistence, /for \(const assetId of assetIds\)/);
  assert.doesNotMatch(persistence, /for \(const record of records\) \{\s*await saveLocalProjectImageAsset/);
});

test('editing baselines and palette source images are externalized with the main image', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');
  const studioTypes = read('src/types/studio.ts');
  const repository = read('server/local-project-repository.cjs');

  for (const field of [
    'imageDataUrl',
    'imageEditBaseDataUrl',
    'imagePaletteSourceDataUrl',
  ]) {
    assert.match(persistence, new RegExp(`dataUrlKey: '${field}'`));
    assert.match(repository, new RegExp(`'${field}'`));
  }
  assert.match(studioTypes, /imageEditBaseAssetId\?: string/);
  assert.match(studioTypes, /imagePaletteSourceAssetId\?: string/);
  assert.match(persistence, /EMBEDDED_IMAGE_FIELD_SPECS/);
  assert.match(persistence, /output\[spec\.dataUrlKey\] = asset\.dataUrl/);
});

test('an unavailable optional disk mirror does not invalidate a completed IndexedDB save', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');
  const diskService = read('src/services/localProjectDiskService.ts');
  assert.match(diskService, /class LocalProjectDiskUnavailableError extends Error/);
  assert.match(diskService, /contentType\.includes\('application\/json'\)/);
  assert.match(persistence, /if \(isLocalProjectDiskUnavailableError\(error\)\)/);
  assert.match(persistence, /the IndexedDB project snapshot was saved/);
});

test('a stale browser tab is rejected before it can replace either project snapshot', () => {
  const persistence = read('src/services/studioProjectPersistence.ts');
  const diskService = read('src/services/localProjectDiskService.ts');
  const server = read('server/index.cjs');
  const saveFunction = persistence.slice(
    persistence.indexOf('async function putStudioProjectSnapshotNow'),
    persistence.indexOf('/**\n * Serializes every project snapshot write.'),
  );
  const conflictGuard = saveFunction.indexOf('if (isLocalProjectDiskConflictError(error))');
  const indexedDbWrite = saveFunction.indexOf('const db = await openStudioIdb()');

  assert.match(diskService, /knownDiskHeadSavedAt/);
  assert.match(diskService, /expectedSavedAt/);
  assert.match(diskService, /class LocalProjectDiskConflictError extends Error/);
  assert.match(server, /expectedSavedAt: hasExpectedSavedAt \? expectedSavedAt : null/);
  assert.match(server, /sendJson\(res, 409/);
  assert.ok(conflictGuard >= 0 && conflictGuard < indexedDbWrite);
});

test('project history can list and restore immutable disk versions', () => {
  const menu = read('src/components/StudioProjectMenu.tsx');
  const diskService = read('src/services/localProjectDiskService.ts');
  const repository = read('server/local-project-repository.cjs');
  assert.match(menu, /版本历史/);
  assert.match(menu, /restoreProjectVersion/);
  assert.match(menu, /await persistence\.flushCurrentProjectSnapshot\(\)/);
  assert.match(menu, /await queueStudioProjectSnapshot\(restoredSnapshot\)/);
  assert.match(diskService, /listDiskProjectVersions/);
  assert.match(diskService, /getDiskProjectVersionSnapshot/);
  assert.match(repository, /readLatestValidVersion/);
  assert.match(repository, /atomicWriteJson\(headPath\(projectId\), fallback\)/);
  assert.match(repository, /Invalid local project version id/);
});
