import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolvePromptAssetPlaceholders } from '../src/utils/promptAssetRefs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Studio Canvas 2.7 is the local default while 2.6 remains available on disk', () => {
  const v27 = JSON.parse(
    read('src/skills/prompt/studio_canvas_prompt_spec_v2_7_camera_matching.json'),
  );
  const loader = read('src/services/skillLoader.ts');

  assert.equal(v27.version, '2.7.0');
  assert.equal(v27.slot, 'style');
  assert.equal(v27.name, 'Studio Canvas 默认提示词规范·摄影机参数匹配版');
  assert.match(loader, /STUDIO_CANVAS_PROMPT_V27_SKILL_ID/);
  assert.match(loader, /DEFAULT_PROMPT_STYLE_SKILL_ID = STUDIO_CANVAS_PROMPT_V27_SKILL_ID/);
  assert.ok(
    fs.existsSync(
      path.join(root, 'src/skills/prompt/studio_canvas_prompt_spec_v2_6_detailed_mount.json'),
    ),
  );
});

test('Studio Canvas 2.7 contains camera, optics, focus, and continuity matching rules', () => {
  const v27 = JSON.parse(
    read('src/skills/prompt/studio_canvas_prompt_spec_v2_7_camera_matching.json'),
  );
  const instruction = v27.system_instruction;

  for (const required of [
    '【摄影机自动匹配逻辑】',
    '【摄影机机型建议库】',
    'ARRI Alexa LF / Alexa Mini LF',
    'Sony VENICE 2',
    'RED V-RAPTOR XL',
    '【镜头光学体系建议库】',
    'Cooke Anamorphic SF',
    'ARRI Signature Prime',
    '【焦段自动匹配参考】',
    '【光圈与景深自动匹配参考】',
    '【焦点职责写法】',
    '【摄影机参数一致性】',
    '【摄影机·镜头】ARRI Alexa LF机型+',
  ]) {
    assert.ok(instruction.includes(required), `missing V2.7 camera contract: ${required}`);
  }
});

test('Studio Canvas 2.7 has a dedicated runtime, schema, validator, and output format', () => {
  const agents = read('src/agents/promptAgents.ts');
  const brain = read('src/services/agents/PromptBrain.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');
  const engine = read('src/services/PromptEngine.ts');

  assert.match(agents, /studioCanvasV27/);
  assert.match(agents, /assertStudioCanvasV27Card/);
  assert.match(agents, /assertStudioCanvasV27CameraParams/);
  assert.match(agents, /buildPromptUserMessageV27/);
  assert.match(agents, /studio_canvas_v2_7/);
  assert.match(agents, /【摄影机·镜头】摄影机机型\+镜头系列或光学类型\+焦段\+光圈\+景深/);
  assert.match(brain, /V27_FOCUS_INSTRUCTION/);
  assert.match(deptSpec, /PROMPT_DEPT_OUTPUT_SHAPE_V27/);
  assert.match(engine, /STUDIO_CANVAS_PROMPT_V27_SKILL_ID/);
});

test('Studio Canvas 2.7 allows up to 30 mounted execution items', () => {
  const agents = read('src/agents/promptAgents.ts');
  const brain = read('src/services/agents/PromptBrain.ts');
  const loader = read('src/services/skillLoader.ts');

  assert.match(agents, /MAX_STUDIO_CANVAS_V27_MOUNT_ITEMS = 30/);
  assert.match(agents, /versionLabel === '2\.7'/);
  assert.match(agents, /单镜挂载硬上限为30项/);
  assert.match(brain, /V2\.7 单镜挂载硬上限放宽为30项/);
  assert.match(loader, /复杂群像、载具或大型场景可增加至30项/);
  assert.match(loader, /旧版15项限制/);
});

test('V2.7 keeps V2.6 adjacent detailed mount normalization', () => {
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
