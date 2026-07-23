import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const v23Headings = [
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

test('Studio Canvas 2.3 remains installed beside V1 after the default advances to V2.5', () => {
  const v1 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v1.json'));
  const v23 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_3_production.json'));
  const loader = read('src/services/skillLoader.ts');

  assert.equal(v1.version, '1.0.0');
  assert.equal(v23.version, '2.3.0');
  assert.equal(v23.slot, 'style');
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V1_SKILL_ID = 'prompt\/studio_canvas_prompt_spec_v1'/);
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V23_SKILL_ID = 'prompt\/studio_canvas_prompt_spec_v2_3_production'/);
});

test('Studio Canvas 2.3 declares the production card fields in canonical order', () => {
  const v23 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_3_production.json'));
  const templateStart = v23.system_instruction.indexOf('【固定输出模板】');
  const templateEnd = v23.system_instruction.indexOf('【字段职责边界】');
  const template = v23.system_instruction.slice(templateStart, templateEnd);

  let cursor = -1;
  for (const heading of v23Headings) {
    const index = template.indexOf(`${heading}：`);
    assert.ok(index > cursor, `${heading} must appear once in canonical order`);
    cursor = index;
  }
  assert.doesNotMatch(template, /钉子4行：/);
});

test('Studio Canvas 2.3 has a dedicated runtime profile and validator', () => {
  const agents = read('src/agents/promptAgents.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');

  assert.match(agents, /studioCanvasV23/);
  assert.match(agents, /assertStudioCanvasV23Card/);
  assert.match(agents, /buildPromptUserMessageV23/);
  assert.match(deptSpec, /PROMPT_CARD_V23_SECTION_HEADINGS/);
  assert.match(deptSpec, /PROMPT_DEPT_OUTPUT_SHAPE_V23/);
});

test('Studio Canvas 2.3.1 is installed beside V1 and V2.3 with a shotSegments runtime profile', () => {
  const v231 = JSON.parse(read('src/skills/prompt/studio_canvas_prompt_spec_v2_3_1_segments.json'));
  const loader = read('src/services/skillLoader.ts');
  const agents = read('src/agents/promptAgents.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');

  assert.equal(v231.version, '2.3.1');
  assert.equal(v231.slot, 'style');
  assert.match(v231.system_instruction, /shotSegments/);
  assert.match(v231.system_instruction, /image_prompt/);
  assert.match(v231.system_instruction, /mergedMembers/);
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V231_SEGMENTS_SKILL_ID/);
  assert.match(loader, /studio_canvas_prompt_spec_v2_3_1_segments/);
  assert.match(agents, /studioCanvasV231Segments/);
  assert.match(agents, /validatePromptShotSegments/);
  assert.match(agents, /buildPromptUserMessageV231Segments/);
  assert.match(deptSpec, /PROMPT_DEPT_OUTPUT_SHAPE_V231_SEGMENTS/);
});
