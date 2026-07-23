import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildStoryboardGridSourceFromPromptSource,
  compilePromptPackForStoryboardImage,
  matchStoryboardPrompts,
  normalizeStoryboardPromptShotId,
  resolveStoryboardPromptSource,
} from '../src/services/storyboardPromptInputs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function shotSource(id, overrides = {}) {
  return {
    sourceNodeId: 'storyboard-1',
    sourceLabel: '分镜表',
    shot: {
      id,
      type: '近景',
      movement: '固定',
      description: `镜头${id}画面`,
      content: '',
      ...overrides,
    },
  };
}

function promptPack(shotId, marker = shotId) {
  return {
    shot_id: shotId,
    prompt: `外层执行提示${marker}`,
    negative_prompt: 'subtitle, ui, watermark',
    seedanceCard: [
      `【分镜${shotId} | 5秒】`,
      '挂载：|@=老和尚||@=禅房|',
      '相机位置：室内中景平视。',
      '相机朝向：沿人物视线轴看向门外。',
      '角色朝向：身体朝前，视线看向门外。',
      '构图锚点：前景门框，中景人物，后景窗户，焦点落在双眼。',
      '灯光布置与基调：油灯暖光作为主光，窗外冷光压暗背景。',
      '起幅：人物低头静止。',
      '落幅：人物完成抬眼，焦点停在双眼。',
      '连续性约束：保持身份、站位和光源方向。',
      `提示词：关键画面执行${marker}，人物缓慢抬眼看向门外。`,
      '摄影机动态参数：总时长5秒；0至5秒轻微前推。',
      '镜头参数：16:9，50mm，中浅景深。',
      '插针 / 甩拍 / 慢镜头：无',
      '表演建议：呼吸克制，肩颈稳定。',
      '主体钉子：人物身份不得改变。',
      '连续性钉子：视线方向保持一致。',
      '镜头钉子：焦点最终落在双眼。',
      '结果钉子：落幅必须看到完成抬眼。',
    ].join('\n'),
  };
}

function promptSource(packs) {
  return {
    sourceNodeIds: ['prompt-1'],
    sourceLabels: ['提示词节点'],
    shotPrompts: packs,
    entries: packs.map((pack) => ({ pack, sourceNodeId: 'prompt-1' })),
    sourceSignature: 'prompt-signature',
  };
}

test('Studio Card compilation keeps decisive visual controls and drops video timing', () => {
  const compiled = compilePromptPackForStoryboardImage(promptPack('01'));
  assert.match(compiled, /画面执行=关键画面执行01/);
  assert.match(compiled, /机位=室内中景平视/);
  assert.match(compiled, /构图=前景门框，中景人物，后景窗户/);
  assert.match(compiled, /目标关键帧=人物完成抬眼/);
  assert.match(compiled, /结果验收=落幅必须看到完成抬眼/);
  assert.doesNotMatch(compiled, /0至5秒/);
  assert.doesNotMatch(compiled, /摄影机动态参数/);
});

test('shot prompts match storyboard shots by shot number before array order', () => {
  const shots = [
    shotSource(1, { shotNo: 'S1-01' }),
    shotSource(2, { shotNo: 'S1-02' }),
  ];
  const source = promptSource([promptPack('S1-02', 'B'), promptPack('S1-01', 'A')]);
  const resolved = matchStoryboardPrompts(shots, source);
  assert.equal(resolved.matchedCount, 2);
  assert.deepEqual(resolved.matches.map((match) => match.promptPack?.shot_id), ['S1-01', 'S1-02']);
  assert.deepEqual(resolved.matches.map((match) => match.mode), ['id', 'id']);
  assert.equal(resolved.orderFallbackCount, 0);
});

test('equal unique lists can fall back to order but duplicate ids remain unresolved', () => {
  const shots = [shotSource(1), shotSource(2)];
  const ordered = matchStoryboardPrompts(shots, promptSource([promptPack('A'), promptPack('B')]));
  assert.equal(ordered.matchedCount, 2);
  assert.equal(ordered.orderFallbackCount, 2);

  const duplicated = matchStoryboardPrompts(shots, promptSource([promptPack('A'), promptPack('A')]));
  assert.equal(duplicated.matchedCount, 0);
  assert.deepEqual(duplicated.duplicatePromptIds, ['a']);
});

test('prompt signature changes when the matched Engine Prompt changes', () => {
  const shots = [shotSource(1)];
  const first = matchStoryboardPrompts(shots, promptSource([promptPack('1', 'first')]));
  const second = matchStoryboardPrompts(shots, promptSource([promptPack('1', 'second')]));
  assert.notEqual(first.signature, second.signature);
});

test('only directly connected Prompt outputs are collected for the storyboard node', () => {
  const pack = promptPack('1');
  const nodes = [
    {
      id: 'prompt-1',
      type: 'department',
      data: { type: 'prompt', label: 'V2.3提示词', version: 3, output: { shotPrompts: [pack] } },
    },
    {
      id: 'prompt-unconnected',
      type: 'department',
      data: { type: 'prompt', output: { shotPrompts: [promptPack('2')] } },
    },
  ];
  const edges = [{ source: 'prompt-1', target: 'film-storyboard-1' }];
  const source = resolveStoryboardPromptSource('film-storyboard-1', nodes, edges);
  assert.deepEqual(source.sourceNodeIds, ['prompt-1']);
  assert.equal(source.shotPrompts.length, 1);
  assert.equal(source.shotPrompts[0].shot_id, '1');
});

test('one combined prompt expands shotSegments into one visual prompt per storyboard shot', () => {
  const combined = {
    ...promptPack('1-2', 'combined-video'),
    shotSegments: [
      {
        shot_id: '1',
        start_sec: 0,
        end_sec: 2,
        shot_type: '大全景',
        camera: '门外固定低机位。',
        composition: '门框压前景，人物位于室内纵深。',
        lighting: '门外冷光与室内油灯暖光对切。',
        action: '门扇微晃，两人保持静止。',
        keyframe: '门框内完整看见一老一少与油灯。',
        image_prompt: '16:9大全景静态关键帧，从门外窥入禅房，一老一少与油灯同框。',
      },
      {
        shot_id: '2',
        start_sec: 2,
        end_sec: 5,
        shot_type: '中远景',
        camera: '低位进入门内，沿原观察轴。',
        composition: '油灯隔开两位人物。',
        lighting: '暖光托住人物，背景保留冷暗层次。',
        action: '老人讲述，小和尚跪坐聆听。',
        keyframe: '两人关系、站位和油灯位置清晰可读。',
        image_prompt: '16:9中远景静态关键帧，两名僧人隔着油灯错位对坐。',
      },
    ],
  };
  const nodes = [
    {
      id: 'prompt-combined',
      type: 'department',
      data: { type: 'prompt', label: 'V2.3.1组合提示词', output: { shotPrompts: [combined] } },
    },
  ];
  const edges = [{ source: 'prompt-combined', target: 'film-storyboard-1' }];
  const source = resolveStoryboardPromptSource('film-storyboard-1', nodes, edges);
  assert.equal(source.shotPrompts.length, 1, 'the video prompt remains one combined card');
  assert.equal(source.entries.length, 2, 'the image consumer receives two static slices');

  const resolved = matchStoryboardPrompts([shotSource(1), shotSource(2)], source);
  assert.equal(resolved.matchedCount, 2);
  assert.deepEqual(resolved.matches.map((match) => match.promptPack?.shot_id), ['1', '2']);
  assert.match(resolved.matches[0].visualPrompt, /16:9大全景静态关键帧/);
  assert.match(resolved.matches[1].visualPrompt, /两名僧人隔着油灯错位对坐/);
  assert.doesNotMatch(resolved.matches[0].visualPrompt, /start_sec|0至2秒|摄影机动态参数/);
});

test('Prompt-only storyboard input creates virtual grid shots from every static prompt segment', () => {
  const combined = {
    ...promptPack('1-2', 'combined-video'),
    dimensions: {
      场景: '禅房',
      角色: '老和尚、小和尚',
      动作: '隔灯对坐',
      镜头: '中远景',
      运镜: '固定机位',
    },
    shotSegments: [
      {
        shot_id: '1',
        start_sec: 0,
        end_sec: 2,
        shot_type: '大全景',
        camera: '门外固定低机位。',
        composition: '门框压前景，人物位于室内纵深。',
        lighting: '门外冷光与室内油灯暖光对切。',
        action: '门扇微晃，两人保持静止。',
        keyframe: '门框内完整看见一老一少与油灯。',
        image_prompt: '16:9大全景静态关键帧，从门外窥入禅房。',
      },
      {
        shot_id: '2',
        start_sec: 2,
        end_sec: 5,
        shot_type: '中远景',
        camera: '低位进入门内，沿原观察轴。',
        composition: '油灯隔开两位人物。',
        lighting: '暖光托住人物，背景保留冷暗层次。',
        action: '老人讲述，小和尚跪坐聆听。',
        keyframe: '两人关系、站位和油灯位置清晰可读。',
        image_prompt: '16:9中远景静态关键帧，两名僧人隔灯对坐。',
      },
    ],
  };
  const nodes = [
    {
      id: 'prompt-only',
      type: 'department',
      data: { type: 'prompt', label: '直连提示词', output: { shotPrompts: [combined] } },
    },
  ];
  const edges = [{ source: 'prompt-only', target: 'film-storyboard-1' }];
  const promptInput = resolveStoryboardPromptSource('film-storyboard-1', nodes, edges);
  const gridSource = buildStoryboardGridSourceFromPromptSource(promptInput);
  const resolved = matchStoryboardPrompts(gridSource.shotSources, promptInput);

  assert.equal(gridSource.shots.length, 2);
  assert.deepEqual(gridSource.sourceNodeIds, ['prompt-only']);
  assert.deepEqual(gridSource.shots.map((shot) => shot.shotNo), ['1', '2']);
  assert.equal(gridSource.shots[0].description, '门框内完整看见一老一少与油灯。');
  assert.equal(gridSource.shots[0].sceneRef, '禅房');
  assert.deepEqual(gridSource.shots[0].characters, ['老和尚', '小和尚']);
  assert.equal(resolved.matchedCount, 2);
  assert.match(resolved.matches[1].visualPrompt, /两名僧人隔灯对坐/);
});

test('Prompt-only storyboard input also supports ordinary shot prompts without segments', () => {
  const input = promptSource([promptPack('A'), promptPack('B')]);
  const gridSource = buildStoryboardGridSourceFromPromptSource(input);
  const resolved = matchStoryboardPrompts(gridSource.shotSources, input);

  assert.equal(gridSource.shots.length, 2);
  assert.equal(gridSource.shots[0].description, '人物完成抬眼，焦点停在双眼。');
  assert.equal(resolved.matchedCount, 2);
});

test('a connected Prompt node without output is still reported instead of silently falling back', () => {
  const nodes = [
    { id: 'prompt-empty', type: 'department', data: { type: 'prompt', label: '待生成 Prompt', output: null } },
  ];
  const edges = [{ source: 'prompt-empty', target: 'film-storyboard-1' }];
  const source = resolveStoryboardPromptSource('film-storyboard-1', nodes, edges);
  assert.deepEqual(source.sourceNodeIds, ['prompt-empty']);
  assert.equal(source.shotPrompts.length, 0);
});

test('shot id normalization tolerates storyboard labels and spacing', () => {
  assert.equal(normalizeStoryboardPromptShotId(' 分镜 S1_01 '), 's1-1');
  assert.equal(normalizeStoryboardPromptShotId('01'), '1');
});

test('film storyboard connection and image prompt contracts include Prompt inputs', () => {
  const rules = read('src/utils/studioConnectionRules.ts');
  const gridService = read('src/services/storyboardGridImage.ts');
  const component = read('src/components/AiFilmmakingNode.tsx');
  assert.match(rules, /a\.data\.type === 'prompt' && b\.type === 'aiFilmStoryboard'/);
  assert.match(gridService, /panelPrompts/);
  assert.match(gridService, /panelReferenceInstructions/);
  assert.match(gridService, /【提示词视觉执行】/);
  assert.match(gridService, /【本格参考图】/);
  assert.match(component, /resolveStoryboardPromptSource/);
  assert.match(component, /imageGenerationPromptSignature/);
});
