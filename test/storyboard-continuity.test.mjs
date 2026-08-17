import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let assertStoryboardOutput;
let auditStoryboardShotContinuity;
let buildStoryboardGridPrompt;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  ({ assertStoryboardOutput } = await vite.ssrLoadModule('/src/agents/storyboardAgents.ts'));
  ({ auditStoryboardShotContinuity } = await vite.ssrLoadModule('/src/utils/storyboardContinuity.ts'));
  ({ buildStoryboardGridPrompt } = await vite.ssrLoadModule('/src/services/storyboardGridImage.ts'));
});

after(async () => {
  await vite?.close();
});

test('legacy storyboard data receives a conservative continuity ledger and spatial map', () => {
  const output = assertStoryboardOutput({
    shots: [
      {
        id: 1,
        sceneRef: 'S1',
        type: '中景',
        movement: '固定',
        description: '苏菲站在舱门左侧。',
        content: '',
        characters: ['苏菲'],
      },
      {
        id: 2,
        sceneRef: 'S1',
        type: '近景',
        movement: '跟拍',
        description: '苏菲向舱门移动。',
        content: '',
        characters: ['苏菲'],
      },
    ],
  });

  assert.equal(output.shots[1].continuity.inheritsFromShotId, 1);
  assert.equal(output.shots[1].continuity.inferred, true);
  assert.equal(output.shots[0].continuity.startState.characters[0].name, '苏菲');
  assert.equal(output.sceneSpatialMaps[0].sceneRef, 'S1');
  assert.equal(output.sceneSpatialMaps[0].inferred, true);
});

test('storyboard parser recovers non-empty shots from common gateway wrappers and aliases', () => {
  const output = assertStoryboardOutput({
    shots: [],
    result: {
      storyboard: {
        shot_list: [
          {
            id: 1,
            sceneRef: 'S1',
            type: '中景',
            movement: '固定',
            description: '苏菲站在舱门左侧。',
            content: '',
          },
        ],
        narrative_beats: ['建立空间'],
      },
    },
  });

  assert.equal(output.shots.length, 1);
  assert.equal(output.shots[0].description, '苏菲站在舱门左侧。');
  assert.deepEqual(output.narrativeBeats, ['建立空间']);
});

test('continuity audit catches an unexplained camera-side and world-position jump', () => {
  const output = assertStoryboardOutput({
    sceneSpatialMaps: [{ sceneRef: 'S1', anchors: ['舱门左侧', '舱门右侧'] }],
    shots: [
      {
        id: 1,
        sceneRef: 'S1',
        type: '中景',
        movement: '固定',
        description: '苏菲停在舱门左侧。',
        content: '',
        continuity: {
          transition: 'establishing',
          startState: { cameraSide: '轴线南侧', characters: [{ name: '苏菲', worldPosition: '舱门左侧' }] },
          endState: { cameraSide: '轴线南侧', characters: [{ name: '苏菲', worldPosition: '舱门左侧' }] },
        },
      },
      {
        id: 2,
        sceneRef: 'S1',
        type: '近景',
        movement: '固定',
        description: '苏菲继续停留。',
        content: '',
        continuity: {
          inheritsFromShotId: 1,
          transition: 'continuous',
          startState: { cameraSide: '轴线北侧', characters: [{ name: '苏菲', worldPosition: '舱门右侧' }] },
          endState: { cameraSide: '轴线北侧', characters: [{ name: '苏菲', worldPosition: '舱门右侧' }] },
        },
      },
    ],
  });

  const audit = auditStoryboardShotContinuity(output.shots[1], output.shots[0]);
  assert.equal(audit.severity, 'warning');
  assert.match(audit.issues.join('\n'), /机位侧不连续/);
  assert.match(audit.issues.join('\n'), /场景位置跳变/);
});

test('storyboard grid prompt carries structured start and end state into image generation', () => {
  const output = assertStoryboardOutput({
    shots: [{
      id: 1,
      sceneRef: 'S1',
      type: '中景',
      movement: '固定',
      description: '苏菲走向舱门。',
      content: '',
      continuity: {
        transition: 'continuous',
        startState: {
          cameraSide: '轴线南侧',
          characters: [{ name: '苏菲', worldPosition: '操作台', screenPosition: '画左' }],
        },
        endState: {
          cameraSide: '轴线南侧',
          characters: [{ name: '苏菲', worldPosition: '舱门', screenPosition: '画中' }],
        },
      },
    }],
  });
  const prompt = buildStoryboardGridPrompt(output.shots, '', { panelAspectRatio: '16:9' });
  assert.match(prompt, /起始\[/);
  assert.match(prompt, /操作台/);
  assert.match(prompt, /结束\[/);
  assert.match(prompt, /舱门/);
});
