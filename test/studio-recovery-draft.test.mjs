import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearStudioRecoveryDraft,
  compactStudioRecoveryDraft,
  mergeStudioRecoveryDraftVisuals,
  readStudioRecoveryDraft,
  STUDIO_SESSION_RECOVERY_DRAFT_KEY,
  writeStudioRecoveryDraft,
} from '../src/services/studioProjectRecoveryDraft.ts';

const values = new Map();
globalThis.sessionStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
};

function payload(overrides = {}) {
  return {
    version: 1,
    savedAt: 200,
    projectId: 'project-a',
    projectName: 'Project A',
    nodes: [
      {
        id: 'text-new',
        type: 'textNode',
        position: { x: 10, y: 20 },
        data: {
          id: 'text-new',
          type: 'text_node',
          label: '刷新前新增节点',
          raw_text: '未正式保存的文字',
          input: '未正式保存的文字',
        },
      },
    ],
    edges: [],
    ...overrides,
  };
}

test('session recovery draft survives reload without becoming a formal project save', () => {
  sessionStorage.clear();
  const draft = payload();
  assert.equal(writeStudioRecoveryDraft(draft), 'full');
  assert.deepEqual(readStudioRecoveryDraft(), draft);
  assert.ok(sessionStorage.getItem(STUDIO_SESSION_RECOVERY_DRAFT_KEY));
  clearStudioRecoveryDraft();
  assert.equal(readStudioRecoveryDraft(), null);
});

test('large inline images are omitted from the compact draft', () => {
  const largeImage = `data:image/png;base64,${'a'.repeat(1_600_000)}`;
  const draft = payload({
    nodes: [
      {
        id: 'image-1',
        type: 'imageNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'image-1',
          type: 'image_node',
          label: '大图',
          imageDataUrl: largeImage,
        },
      },
    ],
  });
  const compact = compactStudioRecoveryDraft(draft);
  assert.equal(compact.nodes[0].data.imageDataUrl, undefined);
  assert.equal(compact.nodes[0].data.label, '大图');
  assert.equal(writeStudioRecoveryDraft(draft), 'compact');
});

test('compact draft restores saved visual payloads while keeping newer graph data', () => {
  const draft = payload({
    nodes: [
      {
        id: 'image-1',
        type: 'imageNode',
        position: { x: 333, y: 444 },
        data: {
          id: 'image-1',
          type: 'image_node',
          label: '刷新前改名',
        },
      },
    ],
  });
  const base = payload({
    savedAt: 100,
    nodes: [
      {
        id: 'image-1',
        type: 'imageNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'image-1',
          type: 'image_node',
          label: '旧名称',
          imageDataUrl: 'data:image/png;base64,saved',
        },
      },
    ],
  });

  const merged = mergeStudioRecoveryDraftVisuals(draft, [base]);
  assert.deepEqual(merged.nodes[0].position, { x: 333, y: 444 });
  assert.equal(merged.nodes[0].data.label, '刷新前改名');
  assert.equal(
    merged.nodes[0].data.imageDataUrl,
    'data:image/png;base64,saved',
  );
});
