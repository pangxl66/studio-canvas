import assert from 'node:assert/strict';
import test from 'node:test';
import {
  promptAssetRefsFromApproved,
  resolvePromptAssetPlaceholders,
  sanitizePromptAssetIds,
  sanitizePromptAssetPlaceholders,
} from '../src/utils/promptAssetRefs.ts';

test('missing approved assets use empty arrays instead of internal placeholders', () => {
  assert.deepEqual(promptAssetRefsFromApproved([]), {
    character_asset_ids: [],
    scene_asset_ids: [],
  });
});

test('legacy mount placeholders resolve to known storyboard entity names', () => {
  assert.equal(
    resolvePromptAssetPlaceholders(
      '挂载：|@=PENDING_CHAR_FROM_ASSET_SYSTEM| |@=PENDING_SCENE_FROM_ASSET_SYSTEM|',
      { characterNames: ['苟天'], sceneNames: ['动力舱'] },
    ),
    '挂载：|@=苟天| |@=动力舱|',
  );
});

test('internal asset placeholders never reach review text or downstream ids', () => {
  assert.equal(
    sanitizePromptAssetPlaceholders(
      '【分镜1-6 | 15秒】\n挂载：|@=PENDING_CHAR_FROM_ASSET_SYSTEM| |@=PENDING_SCENE_FROM_ASSET_SYSTEM|\n相机位置：高处俯拍。',
    ),
    '【分镜1-6 | 15秒】\n挂载：无\n相机位置：高处俯拍。',
  );
  assert.deepEqual(
    sanitizePromptAssetIds([
      'PENDING_CHAR_FROM_ASSET_SYSTEM',
      'character:gu-tian:v1',
      'PENDING_SCENE_FROM_ASSET_SYSTEM',
    ]),
    ['character:gu-tian:v1'],
  );
});
