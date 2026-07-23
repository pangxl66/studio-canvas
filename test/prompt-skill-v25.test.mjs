import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('Studio Canvas 2.5 is installed as the default without removing older versions', () => {
  const v25 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_5_validation.json'));
  const loader = read('src/services/skillLoader.ts');

  assert.equal(v25.version, '2.5.0');
  assert.equal(v25.slot, 'style');
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V25_SKILL_ID/);
  assert.match(loader, /DEFAULT_PROMPT_STYLE_SKILL_ID = STUDIO_CANVAS_PROMPT_V25_SKILL_ID/);
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V1_SKILL_ID/);
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V23_SKILL_ID/);
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V231_SEGMENTS_SKILL_ID/);
});

test('Studio Canvas 2.5 preserves the canonical card and declares all validation protocols', () => {
  const v25 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_5_validation.json'));
  const instruction = v25.system_instruction;
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
    'HARD 硬锁',
    'SOFT 软锁',
    'AUTO 自动',
    '数字与精度来源协议',
    '可见性矩阵',
    '单镜执行预算',
    '视频引擎能力档案',
    '挂载采用唯一规范',
  ]) {
    assert.match(instruction, new RegExp(required));
  }

  const selfTest = instruction.split('【静默自检】')[1] ?? '';
  const checks = [...selfTest.matchAll(/^(\d+)\./gm)].map((match) => Number(match[1]));
  assert.equal(checks.length, 35);
  assert.deepEqual(checks, Array.from({ length: 35 }, (_, index) => index + 1));
});

test('Studio Canvas 2.5 has a dedicated runtime mode, validator, and output format', () => {
  const agents = read('src/agents/promptAgents.ts');
  const brain = read('src/services/agents/PromptBrain.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');

  assert.match(agents, /studioCanvasV25/);
  assert.match(agents, /assertStudioCanvasV25Card/);
  assert.match(agents, /buildPromptUserMessageV25/);
  assert.match(agents, /studio_canvas_v2_5/);
  assert.match(brain, /V25_FOCUS_INSTRUCTION/);
  assert.match(deptSpec, /PROMPT_DEPT_OUTPUT_SHAPE_V25/);
});
