import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildImageShotExtractionSystemPrompt,
  buildImageShotExtractionUserPrompt,
  buildStoryboardSkillImageAnalysisSystemPrompt,
  buildStoryboardSkillImageAnalysisUserPrompt,
  imageTaskLabel,
} from '../src/services/textImageTaskPrompts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const references = [
  {
    label: '参考画面',
    fileName: 'shot-01.png',
    summary: '人物站在走廊左侧，右侧为冷色窗光。',
  },
];

test('current-shot extraction is factual and explicitly forbids next-shot invention', () => {
  const system = buildImageShotExtractionSystemPrompt();
  const user = buildImageShotExtractionUserPrompt('角色名为阿青', references, '核对站位');

  assert.match(system, /禁止推算下一镜/);
  assert.match(system, /静态单帧无法确认运镜/);
  assert.match(system, /【连续性锚点】/);
  assert.match(system, /【不确定项】/);
  assert.match(user, /本任务到当前帧为止，不推演后续镜头/);
  assert.match(user, /shot-01\.png/);
  assert.match(user, /角色名为阿青/);
  assert.match(user, /核对站位/);
});

test('storyboard Skill analysis uses the selected method without generating a new shot', () => {
  const system = buildStoryboardSkillImageAnalysisSystemPrompt(
    '徐克风格导演分镜',
    '先场面，后镜头；先分析空间与力量关系。',
  );
  const user = buildStoryboardSkillImageAnalysisUserPrompt('', references, '关注高低差');

  assert.match(system, /当前分镜 Skill：徐克风格导演分镜/);
  assert.match(system, /先场面，后镜头/);
  assert.match(system, /不是从当前画面推算下一镜/);
  assert.match(system, /【场面命题】/);
  assert.match(system, /【机制判断】/);
  assert.match(system, /【英雄画面】/);
  assert.match(user, /仅分析图片内容，不推算下一镜/);
  assert.match(user, /关注高低差/);
});

test('text-node UI exposes three explicit image tasks and defaults to extraction', () => {
  const node = read('src/components/TextNode.tsx');
  const store = read('src/store/slices/textStore.ts');
  const studio = read('src/store/useStudioStore.ts');

  assert.equal(imageTaskLabel('extract_shot'), '提取当前分镜');
  assert.equal(imageTaskLabel('skill_analysis'), '分镜 Skill 分析');
  assert.equal(imageTaskLabel('continue_shot'), '下一镜推算');
  assert.match(studio, /text_image_task_mode:\s*'extract_shot'/);
  assert.match(node, />\s*提取当前分镜\s*</);
  assert.match(node, />\s*分镜 Skill 分析\s*</);
  assert.match(node, />\s*下一镜推算\s*</);
  assert.match(node, /连线只挂载图片，点击生成后才执行所选任务/);
  assert.match(store, /feature:\s*[\s\S]*?'image-storyboard-skill-analysis'/);
  assert.match(store, /'image-next-shot'/);
  assert.match(store, /'image-shot-extraction'/);
});
