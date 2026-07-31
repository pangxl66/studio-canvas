import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseStudioProjectRestoreCandidate } from '../src/services/studioProjectRestorePolicy.ts';

function payload(overrides = {}) {
  return {
    version: 1,
    savedAt: 100,
    nodes: [{ id: 'node-1' }],
    edges: [],
    projectId: 'project-a',
    projectName: 'Project A',
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    ...payload(overrides),
    updatedAt: overrides.updatedAt ?? 100,
    source: 'workspace',
  };
}

test('newer same-project autosave wins over workspace record', () => {
  const restored = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A', source: 'workspace' },
    activeRecord: record({ updatedAt: 200 }),
    autosave: payload({ savedAt: 201 }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(restored?.source, 'autosave');
  assert.match(restored?.broadcastText ?? '', /自动存档/);
});

test('autosave for another project does not replace the active workspace', () => {
  const restored = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A', source: 'workspace' },
    activeRecord: record({ updatedAt: 200 }),
    autosave: payload({ projectId: 'project-b', projectName: 'Project B', savedAt: 500 }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(restored?.source, 'workspace');
  assert.equal(restored?.projectName, 'Project A');
});

test('empty records do not produce a restore candidate', () => {
  const restored = chooseStudioProjectRestoreCandidate({
    activeRef: null,
    activeRecord: null,
    autosave: payload({ nodes: [], edges: [] }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(restored, null);
});

test('newer disk snapshot wins and an older disk snapshot never rolls the project back', () => {
  const newerDisk = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A' },
    activeRecord: record({ updatedAt: 200 }),
    autosave: payload({ savedAt: 201 }),
    diskSnapshot: payload({ savedAt: 250 }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(newerDisk?.source, 'disk');
  assert.match(newerDisk?.broadcastText ?? '', /磁盘工程库/);

  const olderDisk = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A' },
    activeRecord: record({ updatedAt: 300 }),
    autosave: null,
    diskSnapshot: payload({ savedAt: 250 }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(olderDisk?.source, 'workspace');
});

test('newer same-project session recovery draft wins after refresh', () => {
  const restored = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A' },
    activeRecord: record({ updatedAt: 200 }),
    autosave: payload({ savedAt: 201 }),
    diskSnapshot: payload({ savedAt: 202 }),
    recoveryDraft: payload({
      savedAt: 203,
      nodes: [{ id: 'refresh-only-node' }],
    }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(restored?.source, 'recovery');
  assert.equal(restored?.payload.nodes[0].id, 'refresh-only-node');
  assert.match(restored?.broadcastText ?? '', /刷新前的临时工作稿/);
});

test('session recovery draft from another project is ignored', () => {
  const restored = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project-a', projectName: 'Project A' },
    activeRecord: record({ updatedAt: 200 }),
    autosave: null,
    recoveryDraft: payload({
      projectId: 'project-b',
      savedAt: 999,
      nodes: [{ id: 'wrong-project-node' }],
    }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(restored?.source, 'workspace');
  assert.equal(restored?.projectName, 'Project A');
});
