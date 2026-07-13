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
