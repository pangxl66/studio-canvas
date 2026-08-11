import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('scene image analysis extracts grounded environmental motion and lighting triggers', () => {
  const analysis = read('src/services/imageReferenceAnalysis.ts');

  assert.match(analysis, /IMAGE_REFERENCE_ANALYSIS_VERSION = 2/);
  assert.match(analysis, /持续动态：/);
  assert.match(analysis, /情节触发：/);
  assert.match(analysis, /静态锁定：/);
  assert.match(analysis, /灯光默认稳定/);
  assert.match(analysis, /不得用无依据随机闪烁/);
  assert.match(analysis, /镜头耀斑与灯具闪烁不是一回事/);
  assert.match(analysis, /未见可确认的动态源/);
});

test('storyboard generation turns scene motion into selective physical reactions', () => {
  const graphInput = read('src/services/graphInput.ts');
  const storyboardSpec = read('src/agents/storyboardDeptSpec.ts');
  const storyboardRuntime = read('src/agents/storyboardAgents.ts');
  const store = read('src/store/useStudioStore.ts');

  assert.match(graphInput, /场景动态协议/);
  assert.match(graphInput, /灯光触发协议/);
  assert.match(graphInput, /禁止所有元素同时运动/);
  assert.match(storyboardSpec, /持续动态 \/ 情节触发 \/ 静态锁定/);
  assert.match(storyboardSpec, /一个与剧情或镜头任务直接相关的主反应/);
  assert.match(storyboardRuntime, /每镜最多安排一个主要环境反应/);
  assert.match(storyboardRuntime, /固定照明默认稳定/);
  assert.match(store, /imageAnalysisVersion \?\? 0/);
  assert.match(store, /分析空间、环境动态、物理特效与灯光触发条件/);
});
