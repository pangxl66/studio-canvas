import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoryboardPanelReferenceInstruction,
  buildStoryboardReferenceInstruction,
  resolveStoryboardReferenceContext,
  selectStoryboardReferencesForShots,
} from '../src/services/storyboardReferenceImages.ts';

const baseData = (id, type, label, output = null) => ({
  id,
  type,
  department: 'IMAGE',
  status: 'APPROVED',
  input: '',
  output,
  review_result: null,
  version: 1,
  label,
});

test('connected images can bind to direct script breakdown entities', () => {
  const nodes = [
    {
      id: 'film',
      type: 'aiFilmStoryboard',
      position: { x: 0, y: 0 },
      data: baseData('film', 'film_storyboard_node', '影视分镜'),
    },
    {
      id: 'image-1',
      type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { ...baseData('image-1', 'image_node', '林默角色参考'), imageDataUrl: 'data:image/jpeg;base64,YQ==' },
    },
    {
      id: 'cast',
      type: 'scriptAnalyzer',
      position: { x: 0, y: 0 },
      data: baseData('cast', 'script_character_node', '角色分析', {
        module: 'script_characters',
        characters: [{ id: 'char-1', name: '林默', sceneNos: [1, 2] }],
      }),
    },
  ];
  const edges = [
    { id: 'e1', source: 'image-1', target: 'film' },
    { id: 'e2', source: 'cast', target: 'film' },
  ];

  const initial = resolveStoryboardReferenceContext('film', nodes, edges);
  assert.equal(initial.references.length, 1);
  assert.equal(initial.references[0].kind, 'character');
  assert.equal(initial.entities[0].name, '林默');

  const bound = resolveStoryboardReferenceContext('film', nodes, edges, [
    { imageNodeId: 'image-1', name: '男主林默', kind: 'character', entityId: 'char-1', entityName: '林默' },
  ]);
  assert.equal(bound.references[0].name, '男主林默');
  assert.equal(bound.references[0].entityName, '林默');
  assert.match(buildStoryboardReferenceInstruction(bound.references), /参考图 1：角色「男主林默」/);
  assert.match(buildStoryboardReferenceInstruction(bound.references, 2), /参考图 2：角色「男主林默」/);
  assert.match(buildStoryboardReferenceInstruction(bound.references), /对应分解表「林默」/);
  assert.match(buildStoryboardReferenceInstruction(bound.references), /同一张脸/);
  assert.match(buildStoryboardReferenceInstruction(bound.references), /若文字描述与参考图外观冲突，以参考图为准/);
});

test('character references are sent before scenes while scene constraints remain strict', () => {
  const references = [
    {
      imageNodeId: 'character-image',
      sourceLabel: '老和尚',
      dataUrl: 'data:image/jpeg;base64,YQ==',
      kind: 'character',
      name: '老和尚',
      entityName: '老和尚',
    },
    {
      imageNodeId: 'scene-image',
      sourceLabel: '禅房-傍晚',
      dataUrl: 'data:image/jpeg;base64,Yg==',
      kind: 'scene',
      name: '禅房-傍晚',
      entityName: '禅房-傍晚',
    },
  ];
  const instruction = buildStoryboardReferenceInstruction(references);
  assert.ok(instruction.indexOf('参考图 1：角色「老和尚」') < instruction.indexOf('参考图 2：场景「禅房-傍晚」'));
  assert.match(instruction, /无论大全景、中景、近景或特写/);
  assert.match(instruction, /禁止另造相似场景/);
});

test('page references keep matching characters first and panel instructions bind exact image numbers', () => {
  const references = [
    {
      imageNodeId: 'other-character',
      sourceLabel: '小和尚',
      dataUrl: 'data:image/jpeg;base64,YQ==',
      kind: 'character',
      name: '小和尚',
      entityName: '小和尚',
    },
    {
      imageNodeId: 'main-character',
      sourceLabel: '老和尚',
      dataUrl: 'data:image/jpeg;base64,Yg==',
      kind: 'character',
      name: '老和尚',
      entityName: '老和尚',
    },
    {
      imageNodeId: 'scene',
      sourceLabel: '禅房-傍晚',
      dataUrl: 'data:image/jpeg;base64,Yw==',
      kind: 'scene',
      name: '禅房-傍晚',
      entityName: '禅房-傍晚',
    },
  ];
  const shots = [{
    id: 1,
    type: '近景',
    movement: '固定',
    description: '老和尚在禅房内捻动念珠。',
    content: '',
    sceneRef: '禅房-傍晚',
    characters: ['老和尚'],
  }];
  const selected = selectStoryboardReferencesForShots(references, shots);
  assert.deepEqual(selected.map((reference) => reference.name), ['老和尚', '禅房-傍晚']);
  const panelInstruction = buildStoryboardPanelReferenceInstruction(shots[0], selected);
  assert.match(panelInstruction, /角色「老和尚」必须使用参考图1/);
  assert.match(panelInstruction, /场景「禅房-傍晚」必须使用参考图2/);
  assert.match(panelInstruction, /禁止换脸/);
});

test('script package contributes scene, character and prop choices', () => {
  const nodes = [
    { id: 'film', type: 'aiFilmStoryboard', position: { x: 0, y: 0 }, data: baseData('film', 'film_storyboard_node', '影视分镜') },
    {
      id: 'package',
      type: 'scriptOutput',
      position: { x: 0, y: 0 },
      data: baseData('package', 'script_output_node', '拆解汇总', {
        module: 'script_package',
        scenes: [{ id: 's1', sceneNo: 1, title: '旧仓库', location: '码头旧仓库' }],
        characters: [{ id: 'c1', name: '林默', sceneNos: [1] }],
        props: [{ id: 'p1', name: '铜钥匙', category: '关键道具' }],
      }),
    },
  ];
  const context = resolveStoryboardReferenceContext('film', nodes, [
    { id: 'e1', source: 'package', target: 'film' },
  ]);
  assert.deepEqual(context.entities.map((entity) => entity.kind), ['character', 'scene', 'prop']);
  assert.deepEqual(context.entities.map((entity) => entity.name), ['林默', '旧仓库', '铜钥匙']);
});

test('connected storyboard table contributes scene, character and prop choices', () => {
  const nodes = [
    { id: 'film', type: 'aiFilmStoryboard', position: { x: 0, y: 0 }, data: baseData('film', 'film_storyboard_node', '影视分镜') },
    {
      id: 'shots',
      type: 'shotList',
      position: { x: 0, y: 0 },
      data: baseData('shots', 'shot_list_node', '分镜表', {
        shots: [
          { id: 1, description: '老者手持佛珠', sceneRef: '寺庙禅房', note: '角色:老者、少年\n道具:佛珠' },
          { id: 2, description: '少年抬头', sceneRef: '寺庙禅房', note: '角色:少年' },
        ],
      }),
    },
  ];
  const context = resolveStoryboardReferenceContext('film', nodes, [
    { id: 'e1', source: 'shots', target: 'film' },
  ]);
  assert.equal(context.entitySource, 'connected');
  assert.deepEqual(context.entities.map((entity) => entity.name), ['老者', '少年', '寺庙禅房', '佛珠']);
});

test('ready project breakdown is discovered when it is not directly connected', () => {
  const nodes = [
    { id: 'film', type: 'aiFilmStoryboard', position: { x: 0, y: 0 }, data: baseData('film', 'film_storyboard_node', '影视分镜') },
    {
      id: 'cast',
      type: 'scriptAnalyzer',
      position: { x: 0, y: 0 },
      data: baseData('cast', 'script_character_node', '角色分析', {
        module: 'script_characters',
        characters: [{ id: 'c1', name: '林默', sceneNos: [1] }],
      }),
    },
  ];
  const context = resolveStoryboardReferenceContext('film', nodes, []);
  assert.equal(context.entitySource, 'project');
  assert.equal(context.entities[0].name, '林默');
});

test('characters are recovered from storyboard descriptions and dialogue when the role column was not preserved', () => {
  const nodes = [
    { id: 'film', type: 'aiFilmStoryboard', position: { x: 0, y: 0 }, data: baseData('film', 'film_storyboard_node', '影视分镜') },
    {
      id: 'shots',
      type: 'shotList',
      position: { x: 0, y: 0 },
      data: baseData('shots', 'shot_list_node', '分镜表', {
        shots: [
          { id: 1, description: '老者在烛火旁缓缓拨动佛珠', sceneRef: '禅房-傍晚' },
          { id: 2, description: '少年抬头望向老者', content: '少年：师父，我明白了。', sceneRef: '禅房-傍晚' },
          { id: 3, description: '老者点头，少年沉默', sceneRef: '禅房-傍晚' },
        ],
      }),
    },
  ];
  const context = resolveStoryboardReferenceContext('film', nodes, [
    { id: 'e1', source: 'shots', target: 'film' },
  ]);
  const characters = context.entities.filter((entity) => entity.kind === 'character').map((entity) => entity.name);
  const props = context.entities.filter((entity) => entity.kind === 'prop').map((entity) => entity.name);
  assert.deepEqual(characters, ['老者', '少年']);
  assert.deepEqual(props, ['佛珠']);
});

test('props are recovered from object actions even when the prop column was not preserved', () => {
  const nodes = [
    { id: 'film', type: 'aiFilmStoryboard', position: { x: 0, y: 0 }, data: baseData('film', 'film_storyboard_node', '影视分镜') },
    {
      id: 'shots',
      type: 'shotList',
      position: { x: 0, y: 0 },
      data: baseData('shots', 'shot_list_node', '分镜表', {
        shots: [{ id: 1, description: '少年从怀中掏出铜钥匙，递给老者', sceneRef: '禅房-傍晚' }],
      }),
    },
  ];
  const context = resolveStoryboardReferenceContext('film', nodes, [{ id: 'e1', source: 'shots', target: 'film' }]);
  assert.deepEqual(context.entities.filter((entity) => entity.kind === 'prop').map((entity) => entity.name), ['铜钥匙']);
});
