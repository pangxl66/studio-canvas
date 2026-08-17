import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  getSeedance25ReadableFaceIssues,
  requiresConcreteFacialPerformance,
} from '../src/utils/seedance25PerformanceValidation.ts';
import {
  composeSeedance25PerformanceCard,
  isSeedance25PerformanceEligibleCard,
  seedance25FrozenModuleFingerprint,
} from '../src/utils/seedance25PerformanceComposition.ts';

const root = process.cwd();
const v10Path = path.join(root, 'src/skills/prompt/seedance_2_5_multimodal_film_prompt_v10.json');
const v11Path = path.join(root, 'src/skills/prompt/seedance_2_5_multimodal_film_prompt_v11_performance.json');
const packageRoot = path.join(root, 'src/skills/prompt/seedance-25-eight-dimensional-performance');
const loaderPath = path.join(root, 'src/services/skillLoader.ts');
const agentsPath = path.join(root, 'src/agents/promptAgents.ts');

test('2.5 + 八维表演 is separate and leaves v10 metadata untouched', () => {
  const v10 = JSON.parse(fs.readFileSync(v10Path, 'utf8'));
  const skill = JSON.parse(fs.readFileSync(v11Path, 'utf8'));

  assert.equal(v10.version, '10.0.0');
  assert.equal(v10.name, 'Seedance 2.5 多模态影视提示词 · v10');
  assert.equal(skill.name, 'Seedance 2.5 + 八维表演');
  assert.equal(skill.version, '11.5.1');
  assert.equal(skill.slot, 'style');
  assert.equal(skill.reference_files.length, 6);
  assert.match(skill.system_instruction, /v10 冻结基础卡 \+ 局部模块接管协议/);
  assert.match(skill.system_instruction, /仅生成【表演】与【时间轴】的替换正文/);
  assert.match(skill.system_instruction, /程序化拼接/);
  assert.match(skill.system_instruction, /只作为内部导演计划，不得逐项输出/);
  assert.match(skill.system_instruction, /保留 v10 的时间边界、动作顺序与镜尾事实/);
  assert.match(skill.system_instruction, /至少写出两个不同面部区域的具体可见变化/);
  assert.match(skill.system_instruction, /seedance_2_5_plus_eight_dimensional_performance/);
});

test('empty and no-character shots stay on v10 while acting shots enter the performance module', () => {
  const emptyShot = `【Seedance 2.5｜多模态参考生成】\n\n【时间轴】\n[0.0s–3.0s] 烟雾沿地面缓慢漂移。`;
  const explicitNoSubject = `【Seedance 2.5｜多模态参考生成】\n\n【表演】\n无行动主体，不设计人物表演。\n\n【时间轴】\n[0.0s–3.0s] 灯光稳定。`;
  const actingShot = `【Seedance 2.5｜多模态参考生成】\n\n【表演】\n整体表演保持克制，苏菲主导当前反应。\n\n【时间轴】\n[0.0s–3.0s] 苏菲缓慢抬眼。`;

  assert.equal(isSeedance25PerformanceEligibleCard(emptyShot), false);
  assert.equal(isSeedance25PerformanceEligibleCard(explicitNoSubject), false);
  assert.equal(isSeedance25PerformanceEligibleCard(actingShot), true);
});

test('multi-file package keeps character planning internal and executes acting in the sole timeline', () => {
  const skillMd = fs.readFileSync(path.join(packageRoot, 'SKILL.md'), 'utf8');
  const outputContract = fs.readFileSync(path.join(packageRoot, 'references/output-contract.md'), 'utf8');
  const references = ['eight-dimensions.md', 'facial-au-facs.md', 'body-voice-reactions.md', 'genre-and-emotion.md']
    .map((name) => fs.readFileSync(path.join(packageRoot, 'references', name), 'utf8'))
    .join('\n');

  assert.match(skillMd, /将逐角色八维分析保留在内部/);
  assert.match(skillMd, /【表演】只保留精简的整体表演调性、人物主次、关系/);
  assert.match(skillMd, /【时间轴】成为唯一带时间戳、唯一承载单人表演细节/);
  assert.match(skillMd, /冻结基础卡/);
  assert.match(skillMd, /只生成【表演】和【时间轴】的替换正文/);
  for (const required of ['目标', '潜台词', '触发锚点', '表演弧线', '面部可读性', '镜尾状态']) {
    assert.ok(outputContract.includes(required), `missing planning field: ${required}`);
  }
  assert.match(outputContract, /不得以“角色A：目标：……潜台词：……”的分析卡形式进入最终 seedanceCard/);
  assert.match(outputContract, /【表演】固定结构：精简总则/);
  assert.match(outputContract, /【时间轴】固定结构：角色执行层/);
  assert.match(outputContract, /自然语言面部变化/);
  assert.match(outputContract, /至少两个不同面部区域的具体变化/);
  assert.match(outputContract, /镜尾残留状态/);
  assert.match(outputContract, /视线与头部/);
  assert.match(outputContract, /身体、重心、步幅与手部/);
  assert.match(outputContract, /呼吸、发声、台词状态或停顿/);
  assert.match(outputContract, /最终 seedanceCard 泄漏 AU\/FACS 编号/);
  assert.match(outputContract, /不改变 v10 的挂载、生成规格、摄影机、构图/);
  assert.match(outputContract, /冻结区域指纹/);
  assert.match(outputContract, /"shotModules"/);
  assert.doesNotMatch(outputContract, /"shot_id"/);
  assert.match(outputContract, /不要输出、推断或校验 `shot_id`/);
  assert.doesNotMatch(outputContract, /摄影机或空间响应/);
  assert.match(references, /AU1/);
  assert.match(references, /感知 → 认知延迟 → 第一反应/);
  assert.match(references, /喜剧：人物认真执行目标/);
});

test('loader includes declared Markdown references and composes v10 without aliasing it', () => {
  const source = fs.readFileSync(loaderPath, 'utf8');

  assert.match(source, /reference_files\?: unknown/);
  assert.match(source, /rawTextModules = import\.meta\.glob/);
  assert.match(source, /buildReferencedInstruction/);
  assert.match(source, /SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID/);
  assert.match(source, /SEEDANCE25_PERFORMANCE_PROMPT_V11_SKILL_ID/);
  assert.match(source, /seedance25PerformanceV11\.system_instruction = \[/);
  assert.doesNotMatch(
    source,
    /\[\s*SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID\s*,\s*SEEDANCE25_PERFORMANCE_PROMPT_V11_SKILL_ID\s*\]/,
  );
});

test('runtime freezes v10 and composes only performance and timeline modules', () => {
  const source = fs.readFileSync(agentsPath, 'utf8');

  assert.match(source, /Seedance 2\.5 \+ 八维表演/);
  assert.match(source, /seedance_2_5_plus_eight_dimensional_performance/);
  assert.match(source, /getSeedance25PerformanceV11Issues/);
  assert.match(source, /【表演】出现时间戳；时间戳只能存在于【时间轴】/);
  assert.match(source, /整段只有事件动作，没有可见或可听的八维表演增量/);
  assert.doesNotMatch(source, /第 \$\{index \+ 1\} 段只有事件动作/);
  assert.match(source, /最终提示词泄漏 AU\/FACS 编号；必须翻译为自然语言表演/);
  assert.match(source, /【表演】泄漏逐角色导演分析/);
  assert.match(source, /【表演】过长；这里只保留整体调性、人物主次与关系/);
  assert.match(source, /【表演】没有说明非人主体的替代表演原则/);
  assert.match(source, /【时间轴】保持 v10 已确定的动作顺序、时间边界和段落覆盖/);
  assert.match(source, /不得改变剧情事件、摄影、声音或镜尾事实/);
  assert.match(source, /runSeedance25PerformanceV11Composition/);
  assert.match(source, /applySeedance25PerformanceModules/);
  assert.match(source, /composeSeedance25PerformanceCard/);
  assert.match(source, /shot_id: String\(basePacks\[index\]\.shot_id\)/);
  assert.match(source, /缺少 performance 或 timeline/);
  assert.match(source, /已冻结的 v10 基础 PromptOutput/);
  assert.match(source, /只返回各镜头新的【表演】和【时间轴】正文/);
  assert.match(source, /assertSeedance25PerformanceV11Card/);
});

test('module composition preserves every character outside Performance and Timeline', () => {
  const base = `【Seedance 2.5｜多模态参考生成】

挂载： |@=苏菲| |@=地下船坞|

【生成规格】
时长：3秒

【摄影机 / 镜头】
近景｜平视正拍｜手持呼吸感

【机位与构图】
摄影机正面近景拍摄苏菲。

【起幅】
苏菲低头看向掌心。

【表演】
v10 原始表演。

【时间轴】
[0.0s–3.0s] v10 原始时间轴。

【光学效果】
工业高光只产生轻微 bloom。

【声音 / 对白】
无对白。

【最终落幅】
苏菲看向404。

【高风险限制】
不新增剧情。

【文字与字幕限制】
不生成字幕。`;
  const composed = composeSeedance25PerformanceCard(
    base,
    '整体表演调性保持克制、写实。',
    '[0.0s–1.5s] 苏菲眉间轻收，上眼睑略紧。\n[1.5s–3.0s] 她抬头看向404，唇线压窄，镜尾保持。',
  );

  assert.equal(seedance25FrozenModuleFingerprint(composed), seedance25FrozenModuleFingerprint(base));
  assert.match(composed, /整体表演调性保持克制、写实/);
  assert.match(composed, /眉间轻收/);
  assert.doesNotMatch(composed, /v10 原始表演|v10 原始时间轴/);
});

const closeFaceCard = (timeline) => `【Seedance 2.5｜多模态参考生成】

【生成规格】时长：3秒

【摄影机 / 镜头】近景｜平视正拍｜手持呼吸感

【机位与构图】摄影机正面近景拍摄苏菲，面部清晰可读。

【起幅】苏菲低头看向手心，脸部处于清晰焦点。

【表演】整体表演调性保持克制、写实，苏菲主导当前反应。

【时间轴】${timeline}

【光学效果】浅景深保持面部清晰。

【声音 / 对白】无对白。

【最终落幅】苏菲抬头看向404，面部仍清晰可读。

【高风险限制】不新增动作。

【文字与字幕限制】不生成字幕。`;

test('close readable face rejects generic emotion, gaze, head movement and pauses', () => {
  const timeline =
    '[0.0s–1.4s] 苏菲发现文字看不清，表情紧张，视线停在手心并短暂停顿。\n[1.4s–3.0s] 她缓慢抬头看向404，肩膀保持僵硬，在紧张状态中结束。';
  const card = closeFaceCard(timeline);

  assert.equal(requiresConcreteFacialPerformance(card), true);
  assert.deepEqual(getSeedance25ReadableFaceIssues(card, timeline), [
    '近景/特写中的可读人脸缺少具体表情变化；【时间轴】至少写出两个不同面部区域（如眉部、眼睑、面颊、嘴唇或下颌）的可见变化，不能只写情绪、视线、抬头或停顿',
    '近景/特写镜尾缺少具体面部残留状态；最后一个时间段至少保留一个可见面部区域的明确状态',
  ]);
});

test('close readable face accepts concrete facial evolution and end residue', () => {
  const timeline =
    '[0.0s–1.4s] 苏菲发现文字看不清，眉心由轻微收拢逐渐加深，上眼睑略微绷紧，嘴唇保持闭合。\n[1.4s–3.0s] 她缓慢抬头看向404，眉间仍轻微收紧，下颌略微绷住，在克制的紧张状态中结束。';
  const card = closeFaceCard(timeline);

  assert.equal(requiresConcreteFacialPerformance(card), true);
  assert.deepEqual(getSeedance25ReadableFaceIssues(card, timeline), []);
});

test('non-face closeups and explicitly unreadable faces do not invent facial acting', () => {
  const handCloseup = closeFaceCard('[0.0s–3.0s] 手指缓慢松开文件，呼吸保持克制。').replace(
    /近景｜平视正拍|正面近景拍摄苏菲，面部清晰可读|苏菲低头看向手心，脸部处于清晰焦点|苏菲抬头看向404，面部仍清晰可读/g,
    '手部特写',
  );
  const maskedCloseup = closeFaceCard('[0.0s–3.0s] 她缓慢抬头，呼吸停顿后恢复。').replace(
    '面部清晰可读',
    '全罩头盔遮挡，面部不可读',
  );

  assert.equal(requiresConcreteFacialPerformance(handCloseup), false);
  assert.deepEqual(getSeedance25ReadableFaceIssues(handCloseup, handCloseup), []);
  assert.equal(requiresConcreteFacialPerformance(maskedCloseup), false);
  assert.deepEqual(getSeedance25ReadableFaceIssues(maskedCloseup, maskedCloseup), []);
});
