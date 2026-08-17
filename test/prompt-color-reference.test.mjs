import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('image nodes can feed Prompt nodes as color tables', () => {
  const rules = read('src/utils/studioConnectionRules.ts');
  const graphInput = read('src/services/graphInput.ts');
  const inputWire = read('src/utils/departmentInputWire.ts');

  assert.match(
    rules,
    /a\.type === 'imageNode' && b\.type === 'department' && b\.data\.type === 'prompt'/,
  );
  assert.match(graphInput, /imageNodeAsPromptColorReferenceText/);
  assert.match(graphInput, /【色彩表参考图/);
  assert.match(graphInput, /禁止进入挂载/);
  assert.match(inputWire, /target\.data\.type === 'prompt'/);
});

test('ordinary images feed Prompt through storyboard-grade scene recognition', () => {
  const graphInput = read('src/services/graphInput.ts');
  const store = read('src/store/useStudioStore.ts');
  const deptSpec = read('src/agents/promptDeptSpec.ts');

  assert.match(graphInput, /isPromptColorReferenceImage/);
  assert.match(graphInput, /imageNodeAsPromptSceneReferenceText/);
  assert.match(graphInput, /【Prompt 视觉场景参考图/);
  assert.match(store, /consumerKind: 'prompt'/);
  assert.match(store, /analyzedSceneReferences/);
  assert.match(store, /analyzeImageReference/);
  assert.match(deptSpec, /PROMPT_SCENE_REFERENCE_RULE/);
  assert.match(deptSpec, /空间结构与方向、角色\/道具\/建筑关系/);
  assert.match(deptSpec, /持续动态、情节触发和静态锁定/);
});

test('Prompt execution analyzes and caches color references separately from scene analysis', () => {
  const store = read('src/store/useStudioStore.ts');
  const types = read('src/types/studio.ts');
  const analysis = read('src/services/promptColorReferenceAnalysis.ts');
  const imageNode = read('src/components/ImageTableNode.tsx');

  assert.match(store, /preparePromptColorReferencesForExecution/);
  assert.match(store, /analyzePromptColorReference/);
  assert.match(types, /imageColorAnalysisSummary\?: string/);
  assert.match(imageNode, /imageColorAnalysisSummary: undefined/);
  assert.match(analysis, /主色底、辅助色、点睛色/);
  assert.match(analysis, /无来源的 RGB、HEX、色温、光比、百分比/);
});

test('Prompt rules constrain color tables to lighting and engine-prompt color results', () => {
  const deptSpec = read('src/agents/promptDeptSpec.ts');
  const agents = read('src/agents/promptAgents.ts');

  assert.match(deptSpec, /PROMPT_COLOR_TABLE_RULE/);
  assert.match(deptSpec, /优先落实到“灯光布置与基调”/);
  assert.match(deptSpec, /图中对象不得进入挂载/);
  assert.match(agents, /PROMPT_COLOR_TABLE_RULE/);
});
