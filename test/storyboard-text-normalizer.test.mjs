import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildStoryboardTextNormalizerSystemPrompt,
  buildStoryboardTextNormalizerUserPrompt,
  buildStoryboardTextNormalizerRepairPrompt,
  STORYBOARD_TEXT_NORMALIZER_SKILL_ID,
  STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION,
  validateStoryboardTextNormalizerOutput,
} from '../src/services/storyboardTextNormalizer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('storyboard normalizer preserves production facts and emits the fixed execution format', () => {
  const system = buildStoryboardTextNormalizerSystemPrompt();

  assert.equal(STORYBOARD_TEXT_NORMALIZER_SKILL_ID, 'storyboard-shot-normalizer-zh');
  assert.equal(STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION, '1.0.1');
  assert.match(system, /已加载 Skill/);
  assert.match(system, /不改剧情、不改数据、不做过度创作/);
  assert.match(system, /镜号、制作编号、时长/);
  assert.match(system, /起始状态—动作过程—结果\/反应/);
  assert.match(system, /镜头在……状态下结束/);
  assert.match(system, /# 01场｜夜｜内/);
  assert.match(system, /### 镜头10｜WGZR_01_0100｜时长：2秒/);
  assert.match(system, /焦段、镜头毫米数、光圈、ISO、快门、机型/);
  assert.match(system, /识别待确认/);
  assert.match(system, /不新增音乐、旁白或台词/);
  assert.match(system, /没有台词时不显示台词字段/);
  assert.match(system, /不得强行写“无”/);
  assert.match(system, /手持呼吸感/);
  assert.match(system, /## 待确认项/);
  assert.match(system, /每个镜头通常写 3 至 5 个短段落/);
});

test('image-connected normalization reads all supplied references without inventing later shots', () => {
  const user = buildStoryboardTextNormalizerUserPrompt(
    '镜头2，3秒，角色回头。',
    [
      { label: '第一页', fileName: 'sheet-01.png' },
      { label: '第二页', fileName: 'sheet-02.png', summary: '镜号 3 至 5' },
    ],
    '保留制作编号',
  );

  assert.match(user, /先逐张读取/);
  assert.match(user, /sheet-01\.png/);
  assert.match(user, /sheet-02\.png/);
  assert.match(user, /按镜号\/制作编号排序/);
  assert.match(user, /不要根据图片续写下一镜/);
  assert.match(user, /镜头2，3秒，角色回头/);
  assert.match(user, /保留制作编号/);
});

test('normalizer validates the execution format and creates a fact-preserving repair request', () => {
  const valid = [
    '# 01场｜夜｜内',
    '### 镜头10｜WGZR_01_0100｜时长：2秒',
    '**场景：翱天舱室**',
    '**近景｜低机位仰拍｜固定**',
    '摄影机位于闹铃附近低位。',
    '人物伸手按下按钮。',
    '镜头在手停留于按钮上的状态下结束。',
  ].join('\n');
  assert.deepEqual(validateStoryboardTextNormalizerOutput(valid), { ok: true, issues: [] });

  const invalid = '镜头10：人物按下按钮。';
  const result = validateStoryboardTextNormalizerOutput(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length >= 2);
  const repair = buildStoryboardTextNormalizerRepairPrompt(invalid, result.issues);
  assert.match(repair, /不得新增、删除、合并或拆分镜头/);
  assert.match(repair, /镜头10：人物按下按钮/);
});

test('text node and gateway wire storyboard normalization plus ordered multi-image vision', () => {
  const node = read('src/components/TextNode.tsx');
  const store = read('src/store/slices/textStore.ts');
  const gateway = read('src/services/ModelGateway.ts');
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.match(node, />\s*分镜规范\s*</);
  assert.match(node, /onImageTaskModeChange\('normalize_storyboard'\)/);
  assert.match(store, /buildStoryboardTextNormalizerSystemPrompt/);
  assert.match(store, /imageDataUrls:\s*readableImageUrls/);
  assert.match(store, /slice\(0, 8\)/);
  assert.match(store, /'text-storyboard-normalize'/);
  assert.match(store, /storyboard-normalize-format-repair/);
  assert.match(store, /validateStoryboardTextNormalizerOutput/);
  assert.match(gateway, /imageDataUrls\.map\(\(url\)/);
  assert.match(persistence, /imageMode === 'normalize_storyboard'/);
  assert.match(persistence, /text_polish_mode === 'storyboard'/);
});
