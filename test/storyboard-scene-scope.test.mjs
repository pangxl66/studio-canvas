import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  countStoryboardInputScenes,
  hasMultipleStoryboardOutputScenes,
} from '../src/utils/storyboardSceneScope.ts';

test('single-scene prose and section dividers remain one scene', () => {
  assert.equal(countStoryboardInputScenes('客厅里，两个人隔桌对峙。'), 1);
  assert.equal(
    countStoryboardInputScenes('场景：客厅 日\n人物进入。\n---\n摄影要求：缓慢推进。'),
    1,
  );
});

test('explicit screenplay headings are counted before model execution', () => {
  assert.equal(
    countStoryboardInputScenes(
      '第一场 客厅 日\n人物进入。\n第二场 走廊 夜\n人物离开。',
    ),
    2,
  );
  assert.equal(
    countStoryboardInputScenes('INT. ROOM - DAY\nAction.\nEXT. STREET - NIGHT\nAction.'),
    2,
  );
});

test('structured writing payload is counted even when reference context follows it', () => {
  const input = `${JSON.stringify({
    episodes: [],
    scenes: [
      { episodeId: 'ep1', sceneNo: 1, title: '客厅' },
      { episodeId: 'ep1', sceneNo: 2, title: '走廊' },
    ],
  })}\n\n【视觉场景参考图 1】\n图片场景分析：冷色走廊`;
  assert.equal(countStoryboardInputScenes(input), 2);
  assert.equal(
    countStoryboardInputScenes(JSON.stringify({ episodes: [], scenes: [] })),
    0,
  );
});

test('scene-scope diagnostics can detect multiple sceneRef values', () => {
  const baseShot = {
    id: 1,
    type: '中景',
    movement: '固定',
    description: '人物站在门口。',
    content: '',
  };
  assert.equal(
    hasMultipleStoryboardOutputScenes({
      shots: [
        { ...baseShot, sceneRef: 'S1' },
        { ...baseShot, id: 2, sceneRef: 'S1' },
      ],
      narrativeBeats: [],
    }),
    false,
  );
  assert.equal(
    hasMultipleStoryboardOutputScenes({
      shots: [
        { ...baseShot, sceneRef: 'S1' },
        { ...baseShot, id: 2, sceneRef: 'S2' },
      ],
      narrativeBeats: [],
    }),
    true,
  );
});

test('storyboard generation accepts multiple scenes and preserves scene boundaries', () => {
  const executionSource = readFileSync(
    new URL('../src/services/agents/executeTask.ts', import.meta.url),
    'utf8',
  );
  const promptSource = readFileSync(
    new URL('../src/agents/storyboardAgents.ts', import.meta.url),
    'utf8',
  );
  const systemSource = readFileSync(
    new URL('../src/agents/storyboardDeptSpec.ts', import.meta.url),
    'utf8',
  );
  const detailPanelSource = readFileSync(
    new URL('../src/components/DetailPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(executionSource, /storyboardSourceSceneCount > 1/);
  assert.doesNotMatch(executionSource, /hasMultipleStoryboardOutputScenes/);
  assert.match(promptSource, /必须覆盖输入中的全部场次/);
  assert.match(promptSource, /场次切换时 sceneRef 同步切换/);
  assert.match(systemSource, /严格保持原始顺序和场次边界/);
  assert.match(detailPanelSource, /将按原始顺序连续生成/);
  assert.doesNotMatch(detailPanelSource, /storyboardInputSceneCount > 1 \|\|/);
});
