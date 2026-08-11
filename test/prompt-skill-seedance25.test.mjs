import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Seedance 2.5 v10 preserves the complete supplied Skill and removes the combination threshold', () => {
  const skill = JSON.parse(read('src/skills/prompt/seedance_2_5_multimodal_film_prompt_v10.json'));
  assert.equal(skill.name, 'Seedance 2.5 多模态影视提示词 · v10');
  assert.equal(skill.version, '10.0.0');
  assert.equal(skill.slot, 'style');
  assert.ok(skill.system_instruction.length > 29000);
  assert.match(skill.system_instruction, /# 81\. 最终硬规则/);
  assert.match(skill.system_instruction, /挂载： \|@=参考名1\| \|@=参考名2\|/);
  assert.match(skill.system_instruction, /自动表演设计器/);
  assert.match(skill.system_instruction, /真实摄影器材合法性检查/);
  assert.match(skill.system_instruction, /版本：v10｜解除15秒组合限制版/);
  assert.match(skill.system_instruction, /多镜头组合不设置15秒最低时长/);
  assert.match(skill.system_instruction, /不得再以“是否达到15秒”作为组合判断条件/);
  assert.match(skill.system_instruction, /总时长不是是否进入多镜头组合模式的门槛/);
  assert.match(skill.system_instruction, /不设固定秒数上限，也不使用固定默认秒数/);
  assert.doesNotMatch(skill.system_instruction, /(?:至少|必须达到|达到)\s*15\s*秒(?:才|方可)/);
  assert.doesNotMatch(skill.system_instruction, /回退\s*15/);
});

test('Prompt runtime selects a dedicated Seedance 2.5 structure and validator', () => {
  const agents = read('src/agents/promptAgents.ts');
  const loader = read('src/services/skillLoader.ts');
  assert.match(agents, /seedance25Multimodal/);
  assert.match(agents, /SEEDANCE25_MULTIMODAL_OUTPUT_SHAPE/);
  assert.match(agents, /assertSeedance25MultimodalCard/);
  assert.match(agents, /buildPromptUserMessageSeedance25/);
  assert.match(agents, /seedance_2_5_multimodal_film_v10/);
  assert.match(agents, /不设固定秒数上限，也不使用固定默认秒数/);
  assert.match(agents, /多镜头组合不设 15 秒最低门槛/);
  assert.match(loader, /seedance_2_5_multimodal_film_prompt_v10/);
  assert.match(loader, /Seedance 2\.5 时长与组合协议｜最终覆盖/);
});
