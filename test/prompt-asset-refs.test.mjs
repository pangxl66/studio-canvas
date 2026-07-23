import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferPromptCharacterNames,
  inferPromptSceneNames,
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

test('structured prompt dimensions conservatively recover character and scene names', () => {
  assert.deepEqual(
    inferPromptCharacterNames('苟天，男性角色，画面中保持警觉'),
    ['苟天'],
  );
  assert.deepEqual(
    inferPromptCharacterNames('老和尚、小和尚（两人身份稳定）'),
    ['老和尚', '小和尚'],
  );
  assert.deepEqual(
    inferPromptCharacterNames('老和尚与小和尚隔灯对坐'),
    ['老和尚', '小和尚'],
  );
  assert.deepEqual(
    inferPromptSceneNames('动力舱（右侧环形机组、左侧控制台）'),
    ['动力舱'],
  );
});

test('known storyboard entities repair a legacy empty mount line and include props', () => {
  assert.equal(
    resolvePromptAssetPlaceholders(
      '【分镜1-6 | 15秒】\n挂载：无\n相机位置：高处俯拍。',
      {
        characterNames: ['苟天'],
        propNames: ['扳手', '制服布条'],
        sceneNames: ['动力舱'],
      },
    ),
    '【分镜1-6 | 15秒】\n挂载：|@=苟天| |@=扳手| |@=制服布条| |@=动力舱|\n相机位置：高处俯拍。',
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
