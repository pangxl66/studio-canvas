import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolvePromptAssetPlaceholders } from '../src/utils/promptAssetRefs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const canonicalHeadings = [
  '挂载',
  '相机位置',
  '相机朝向',
  '角色朝向',
  '构图锚点',
  '灯光布置与基调',
  '起幅',
  '落幅',
  '连续性约束',
  '提示词',
  '摄影机动态参数',
  '镜头参数',
  '插针 / 甩拍 / 慢镜头',
  '表演建议',
  '主体钉子',
  '连续性钉子',
  '镜头钉子',
  '结果钉子',
];

test('Studio Canvas 2.6 remains installed for rollback after 2.7 becomes default', () => {
  const v26 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_6_detailed_mount.json'));
  const loader = read('src/services/skillLoader.ts');

  assert.equal(v26.version, '2.6.0');
  assert.equal(v26.slot, 'style');
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V26_SKILL_ID/);
  assert.match(loader, /DEFAULT_PROMPT_STYLE_SKILL_ID = STUDIO_CANVAS_PROMPT_V27_SKILL_ID/);
  assert.match(
    loader,
    /\[STUDIO_CANVAS_PROMPT_V26_SKILL_ID, DEFAULT_PROMPT_STYLE_SKILL_ID\]/,
  );
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V25_SKILL_ID/);
  assert.ok(fs.existsSync(path.join(root, 'src/skills/prompt/studio_canvas_prompt_spec_v2_5_validation.json')));
});

test('Studio Canvas 2.6 keeps the canonical card and detailed mount contract', () => {
  const v26 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_6_detailed_mount.json'));
  const instruction = v26.system_instruction;
  const template = instruction.slice(
    instruction.indexOf('【固定输出模板】'),
    instruction.indexOf('【字段职责边界】'),
  );

  let cursor = -1;
  for (const heading of canonicalHeadings) {
    const index = template.indexOf(`${heading}：`);
    assert.ok(index > cursor, `${heading} must appear in canonical order`);
    cursor = index;
  }

  for (const required of [
    '|@=角色A||@=关键道具B||@=场景C||@=固定光源D|',
    '一般单镜建议挂载5至12项',
    '复杂群像、载具或大型场景可增加至15项',
    '关键场景结构',
    '固定实景光源',
    '环境物',
    '声音触发',
  ]) {
    assert.ok(instruction.includes(required), `missing V2.6 contract: ${required}`);
  }
});

test('Studio Canvas 2.6 has a dedicated runtime mode, validator, and output format', () => {
  const agents = read('src/agents/promptAgents.ts');
  const brain = read('src/services/agents/PromptBrain.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');

  assert.match(agents, /studioCanvasV26/);
  assert.match(agents, /assertStudioCanvasV26Card/);
  assert.match(agents, /buildPromptUserMessageV26/);
  assert.match(agents, /studio_canvas_v2_6/);
  assert.match(brain, /V26_FOCUS_INSTRUCTION/);
  assert.match(deptSpec, /PROMPT_DEPT_OUTPUT_SHAPE_V26/);
});

test('V2.6 mount normalization uses adjacent tokens without spaces', () => {
  const card = [
    '【分镜1 | 5秒】',
    '挂载：|@=角色A||@=交互道具|',
    '相机位置：平视。',
  ].join('\n');
  const normalized = resolvePromptAssetPlaceholders(
    card,
    {
      sceneNames: ['主场景'],
      soundNames: ['金属刮擦声'],
    },
    { mountSeparator: '' },
  );

  assert.match(
    normalized,
    /挂载：\|@=角色A\|\|@=交互道具\|\|@=主场景\|\|@=金属刮擦声\|/,
  );
});
