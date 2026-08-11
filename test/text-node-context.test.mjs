import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyProjectConstraintsToStoryboardOutput,
  buildProjectConstraintExecutionChecklist,
  collectTextNodeContextForDepartment,
  collectTextNodeContextForNode,
  dedupeProjectConstraints,
  extractProjectConstraintsFromTaggedText,
  inferTextNodeSemanticRole,
  serializeTextNodeContext,
} from '../src/utils/textNodeContext.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function textNode(id, label, text, role = 'auto') {
  return {
    id,
    type: 'textNode',
    position: { x: 0, y: 0 },
    data: {
      id,
      type: 'text_node',
      label,
      raw_text: text,
      input: text,
      text_node_role: role,
    },
  };
}

function departmentNode(id, kind = 'storyboard') {
  return {
    id,
    type: 'department',
    position: { x: 0, y: 0 },
    data: { id, type: kind, label: kind },
  };
}

function edge(id, source, target) {
  return { id, source, target, sourceHandle: 'out', targetHandle: 'in' };
}

test('classifies project rules separately from storyboard body', () => {
  assert.equal(
    inferTextNodeSemanticRole({
      label: '项目总规范',
      raw_text: '日内树林，宽银幕，横向 flare，禁止现代物件。',
      input: '',
      text_node_role: 'auto',
    }),
    'project_constraints',
  );
  assert.equal(
    inferTextNodeSemanticRole({
      label: '第 1 场正文',
      raw_text: '人物穿过树林，停下观察。',
      input: '',
      text_node_role: 'auto',
    }),
    'story_content',
  );
});

test('resolves a chained text graph upstream-first without overwriting local bodies', () => {
  const nodes = [
    textNode(
      'rules',
      '摄影总规范',
      '日内树林；2.39:1 宽银幕；使用镜头产生的横向 flare；光斑轻微闪烁。',
      'project_constraints',
    ),
    textNode(
      'story',
      '分镜正文',
      '角色沿林间小径前行，听见枝叶异响后停步。',
      'story_content',
    ),
    departmentNode('storyboard'),
  ];
  const edges = [
    edge('rules-to-story', 'rules', 'story'),
    edge('story-to-board', 'story', 'storyboard'),
  ];

  const blocks = collectTextNodeContextForDepartment('storyboard', nodes, edges);
  assert.deepEqual(
    blocks.map((block) => [block.nodeId, block.role, block.text]),
    [
      [
        'rules',
        'project_constraints',
        '日内树林；2.39:1 宽银幕；使用镜头产生的横向 flare；光斑轻微闪烁。',
      ],
      ['story', 'story_content', '角色沿林间小径前行，听见枝叶异响后停步。'],
    ],
  );

  const serialized = serializeTextNodeContext(blocks);
  assert.match(serialized, /【项目约束｜摄影总规范】/);
  assert.match(serialized, /【分镜正文｜分镜正文】/);
  assert.equal(nodes[1].data.raw_text, '角色沿林间小径前行，听见枝叶异响后停步。');
});

test('deduplicates shared ancestors and remains safe for legacy cyclic graphs', () => {
  const nodes = [
    textNode('a', '项目约束', '16:9，日外。', 'project_constraints'),
    textNode('b', '正文 B', '人物进入树林。', 'story_content'),
    textNode('c', '正文 C', '人物抬头。', 'story_content'),
    departmentNode('storyboard'),
  ];
  const edges = [
    edge('a-b', 'a', 'b'),
    edge('a-c', 'a', 'c'),
    edge('b-c', 'b', 'c'),
    edge('c-a-legacy-cycle', 'c', 'a'),
    edge('c-board', 'c', 'storyboard'),
  ];

  const blocks = collectTextNodeContextForDepartment('storyboard', nodes, edges);
  assert.equal(new Set(blocks.map((block) => block.nodeId)).size, blocks.length);
  assert.deepEqual(new Set(blocks.map((block) => block.nodeId)), new Set(['a', 'b', 'c']));

  const upstreamOnly = collectTextNodeContextForNode('c', nodes, edges, { includeSelf: false });
  assert.ok(upstreamOnly.length <= 3);
});

test('extracts structured project constraints from the tagged transport protocol', () => {
  const tagged = [
    '【项目约束｜项目总规范】',
    '日内树林；2.39:1；横向 flare。',
    '',
    '【分镜正文｜第 1 场】',
    '角色穿过树林。',
  ].join('\n');

  assert.deepEqual(extractProjectConstraintsFromTaggedText(tagged), [
    '项目总规范：日内树林；2.39:1；横向 flare。',
  ]);
});

test('keeps full project constraints at the storyboard root and marks every shot note', () => {
  const output = applyProjectConstraintsToStoryboardOutput(
    {
      shots: [
        { id: '1', description: '人物进入树林。' },
        { id: '2', description: '人物停下。', note: '保持屏幕方向。' },
      ],
      narrativeBeats: [],
    },
    ['项目总规范：日内树林；2.39:1 宽银幕；横向 flare 轻微闪烁。'],
  );

  assert.deepEqual(output.projectConstraints, [
    '项目总规范：日内树林；2.39:1 宽银幕；横向 flare 轻微闪烁。',
  ]);
  assert.match(output.shots[0].note, /项目约束（跨镜）/);
  assert.match(output.shots[1].note, /保持屏幕方向。[\s\S]*2\.39:1 宽银幕/);
});

test('prefers the authoritative input block over model-split duplicate constraints', () => {
  const fullInput =
    '文本卡片 · 8c65：人物越认真，事情越荒唐。\n\n表演保持真人电影动作逻辑，突出停顿和错愕。';
  const output = applyProjectConstraintsToStoryboardOutput(
    {
      shots: [
        {
          id: '1',
          description: '机器人严肃面对荒唐结果。',
          note: '喜剧来自真实反应。\n项目约束（跨镜）：旧的重复约束。',
        },
      ],
      narrativeBeats: [],
      projectConstraints: [
        '人物越认真，事情越荒唐。',
        '表演保持真人电影动作逻辑，突出停顿和错愕。',
      ],
    },
    [fullInput],
  );

  assert.deepEqual(output.projectConstraints, [fullInput]);
  assert.equal((output.shots[0].note.match(/项目约束（跨镜）/g) ?? []).length, 1);
  assert.doesNotMatch(output.shots[0].note, /旧的重复约束/);
});

test('preserves an independent model constraint and builds an atomic execution checklist', () => {
  assert.deepEqual(
    dedupeProjectConstraints(
      ['画幅比例：21:9；按超宽银幕构图。'],
      ['喜剧规范：人物越认真，事情越荒唐。'],
    ),
    [
      '喜剧规范：人物越认真，事情越荒唐。',
      '画幅比例：21:9；按超宽银幕构图。',
    ],
  );

  const checklist = buildProjectConstraintExecutionChecklist([
    '喜剧规范：人物越认真，事情越荒唐；表演保持真人电影逻辑。',
  ]);
  assert.match(checklist, /C1\. 喜剧规范：人物越认真，事情越荒唐/);
  assert.match(checklist, /C2\. 表演保持真人电影逻辑/);
});

test('collapses legacy model-split constraints when the complete source block was saved last', () => {
  const constraints = dedupeProjectConstraints([
    '人物越认真，事情越荒唐。',
    '表演保持真人电影逻辑，突出停顿和错愕。',
    '文本卡片 · 8c65：人物越认真，事情越荒唐。\n\n表演保持真人电影逻辑，突出停顿和错愕。',
  ]);
  assert.deepEqual(constraints, [
    '文本卡片 · 8c65：人物越认真，事情越荒唐。\n\n表演保持真人电影逻辑，突出停顿和错愕。',
  ]);
});

test('store and prompt transport preserve semantic chaining instead of replacing text nodes', () => {
  const store = read('src/store/useStudioStore.ts');
  const graphInput = read('src/services/graphInput.ts');
  const storyboardAgent = read('src/agents/storyboardAgents.ts');
  const promptAgent = read('src/agents/promptAgents.ts');
  const connectionRules = read('src/utils/studioConnectionRules.ts');

  assert.doesNotMatch(
    store,
    /patchNodeData\([^)]*,\s*\{\s*raw_text:\s*m,\s*input:\s*m\s*\}/s,
  );
  assert.match(graphInput, /collectTextNodeContextForDepartment/);
  assert.match(graphInput, /projectConstraints:\s*canonical\.projectConstraints/);
  assert.match(storyboardAgent, /extractProjectConstraintsFromTaggedText/);
  assert.match(storyboardAgent, /项目约束逐项执行清单/);
  assert.match(storyboardAgent, /约束落实：C编号/);
  assert.match(promptAgent, /【上游项目约束｜必须继承】/);
  assert.match(connectionRules, /wouldCreateTextChainCycle/);
  assert.match(connectionRules, /return \['text_node', 'storyboard', 'prompt'\]/);
});
