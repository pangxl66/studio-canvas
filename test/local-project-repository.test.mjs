import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLocalProjectRepository } = require('../server/local-project-repository.cjs');

function snapshot(savedAt, overrides = {}) {
  return {
    version: 1,
    savedAt,
    projectId: 'project_disk_test',
    projectName: '磁盘恢复测试',
    nodes: [{ id: `node-${savedAt}` }],
    edges: [],
    ...overrides,
  };
}

test('disk project repository survives restart, rejects stale heads, and retains history', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-repository-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempBase));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const repository = createLocalProjectRepository({
    rootDirectory: tempRoot,
    historyLimit: 2,
  });
  await repository.saveSnapshot(snapshot(100));
  await repository.saveSnapshot(snapshot(200));
  await repository.saveSnapshot(snapshot(300));
  await repository.saveSnapshot(snapshot(301, {
    nodes: [{ id: 'node-300' }],
  }));

  const staleResult = await repository.saveSnapshot(snapshot(250));
  assert.equal(staleResult.stale, true);
  assert.equal(repository.readSnapshot('project_disk_test').savedAt, 301);
  assert.equal(repository.listVersions('project_disk_test').length, 2);
  const latestVersion = repository.listVersions('project_disk_test')[0];
  assert.equal(repository.readVersion('project_disk_test', latestVersion.id).savedAt, 300);
  assert.throws(
    () => repository.readVersion('project_disk_test', '../active'),
    /Invalid local project version id/,
  );

  const restartedRepository = createLocalProjectRepository({
    rootDirectory: tempRoot,
    historyLimit: 2,
  });
  assert.equal(restartedRepository.readActiveSnapshot().savedAt, 301);
  assert.equal(restartedRepository.listProjects()[0].projectName, '磁盘恢复测试');
});

test('disk repository recovers the previous head after an interrupted replacement', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-interrupted-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempBase));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const repository = createLocalProjectRepository({ rootDirectory: tempRoot });
  await repository.saveSnapshot(snapshot(400));
  const headPath = path.join(tempRoot, 'project_disk_test', 'head.json');
  fs.renameSync(headPath, `${headPath}.previous`);

  assert.equal(repository.readSnapshot('project_disk_test').savedAt, 400);
  assert.equal(fs.existsSync(headPath), true);
  assert.equal(fs.existsSync(`${headPath}.previous`), false);
});

test('disk repository repairs a corrupted head from the newest intact history version', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-corrupt-head-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempBase));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const repository = createLocalProjectRepository({ rootDirectory: tempRoot });
  await repository.saveSnapshot(snapshot(500));
  await repository.saveSnapshot(snapshot(600));
  const headPath = path.join(tempRoot, 'project_disk_test', 'head.json');
  fs.writeFileSync(headPath, '{broken json', 'utf8');

  assert.equal(repository.readSnapshot('project_disk_test').savedAt, 600);
  assert.equal(JSON.parse(fs.readFileSync(headPath, 'utf8')).savedAt, 600);
});

test('disk repository externalizes embedded images and indexes compact versions', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-assets-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempBase));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const repository = createLocalProjectRepository({ rootDirectory: tempRoot });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const imageDataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  await repository.saveSnapshot(snapshot(700, {
    nodes: [{
      id: 'image-node',
      data: {
        imageDataUrl,
      },
    }],
  }));

  const restored = repository.readSnapshot('project_disk_test');
  assert.equal(restored.nodes[0].data.imageDataUrl, undefined);
  assert.match(restored.nodes[0].data.imageAssetId, /^sha256_[a-f0-9]{64}$/);
  const asset = repository.readAsset(restored.nodes[0].data.imageAssetId);
  assert.deepEqual(asset.buffer, bytes);
  assert.equal(repository.listVersions('project_disk_test').length, 1);
  assert.equal(
    fs.existsSync(path.join(tempRoot, 'project_disk_test', 'versions-index.json')),
    true,
  );
});

test('a later stale tab cannot overwrite a newer project head', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-conflict-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempBase));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const repository = createLocalProjectRepository({ rootDirectory: tempRoot });
  await repository.saveSnapshot(snapshot(100));
  const fresh = await repository.saveSnapshot(snapshot(200), { expectedSavedAt: 100 });
  const staleTab = await repository.saveSnapshot(
    snapshot(300, { nodes: [{ id: 'stale-tab-node' }] }),
    { expectedSavedAt: 100 },
  );

  assert.equal(fresh.conflict, undefined);
  assert.equal(staleTab.conflict, true);
  assert.equal(staleTab.expectedSavedAt, 100);
  assert.equal(staleTab.savedAt, 200);
  assert.equal(repository.readSnapshot('project_disk_test').savedAt, 200);
  assert.equal(repository.readSnapshot('project_disk_test').nodes[0].id, 'node-200');
});
