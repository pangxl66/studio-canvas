import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canTransitionPipelineStatus,
  getLatestApprovedWritingAsset,
  getLatestApprovedWritingBundle,
  normalizePromptDepartmentStatus,
  PROMPT_GENERATED_STATUS,
} from '../src/store/workflow.ts';

test('pipeline state machine only accepts declared transitions', () => {
  assert.equal(canTransitionPipelineStatus('NOT_STARTED', 'IN_PROGRESS', 'writing'), true);
  assert.equal(canTransitionPipelineStatus('NOT_STARTED', 'APPROVED', 'writing'), false);
  assert.equal(canTransitionPipelineStatus('IN_PROGRESS', 'APPROVED', 'writing'), false);
  assert.equal(canTransitionPipelineStatus('IN_PROGRESS', 'APPROVED', 'prompt'), false);
  assert.equal(canTransitionPipelineStatus('IN_PROGRESS', PROMPT_GENERATED_STATUS, 'prompt'), true);
  assert.equal(canTransitionPipelineStatus('APPROVED', 'IN_PROGRESS', 'prompt'), false);
  assert.equal(canTransitionPipelineStatus('REJECTED', 'NOT_STARTED', 'storyboard'), true);
});

test('legacy Prompt approval state migrates to generated waiting-review state', () => {
  assert.equal(normalizePromptDepartmentStatus('APPROVED'), PROMPT_GENERATED_STATUS);
  assert.equal(normalizePromptDepartmentStatus('IN_PROGRESS'), 'IN_PROGRESS');
  assert.equal(normalizePromptDepartmentStatus('REJECTED'), 'REJECTED');
});

test('latest approved writing bundle preserves asset audit metadata', () => {
  const older = {
    department: 'WRITING',
    nodeId: 'writing-old',
    version: 1,
    createdAt: 100,
    payload: { episodes: [], scenes: [{ id: 'scene-old' }] },
  };
  const latest = {
    department: 'WRITING',
    nodeId: 'writing-new',
    version: 3,
    createdAt: 300,
    payload: { episodes: [], scenes: [{ id: 'scene-new' }] },
  };
  const unrelated = {
    department: 'STORYBOARD',
    nodeId: 'storyboard-newer',
    version: 1,
    createdAt: 500,
    payload: {},
  };

  const bundle = getLatestApprovedWritingBundle([older, unrelated, latest]);
  assert.equal(bundle?.assetNodeId, 'writing-new');
  assert.equal(bundle?.assetVersion, 3);
  assert.equal(bundle?.registeredAt, 300);
  assert.equal(bundle?.script.scenes[0].id, 'scene-new');
  assert.equal(getLatestApprovedWritingAsset([older, latest])?.scenes[0].id, 'scene-new');
});

test('invalid writing payload is never exposed downstream', () => {
  const invalid = {
    department: 'WRITING',
    nodeId: 'writing-invalid',
    version: 1,
    createdAt: 100,
    payload: { episodes: [], scenes: [] },
  };
  assert.equal(getLatestApprovedWritingBundle([invalid]), null);
});
