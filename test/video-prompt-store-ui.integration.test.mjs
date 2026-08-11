import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { createServer } from 'vite';

const memoryStorage = new Map();
const localStorageMock = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
  removeItem: (key) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  key: (index) => [...memoryStorage.keys()][index] ?? null,
  get length() {
    return memoryStorage.size;
  },
};

let vite;
let useStudioStore;
let collectFilmPromptSource;
let AiFilmVideoPromptNode;
let normalizeRestoredStudioNode;

function makeGraph() {
  const shotList = {
    id: 'shot-list-1',
    type: 'shotList',
    position: { x: 0, y: 0 },
    data: {
      id: 'shot-list-1',
      type: 'shot_list_node',
      status: 'APPROVED',
      label: '分镜表',
      output: {
        shots: [
          { id: 1, shotNo: 'S1', type: '中景', movement: '缓慢前推', durationSec: 4, description: '人物看向舱门', action: '屏息后抬眼' },
          { id: 2, shotNo: 'S2', type: '近景', movement: '固定', durationSec: 5, description: '手靠近控制杆', action: '手指停住' },
        ],
        narrativeBeats: ['察觉', '决定'],
      },
    },
  };
  const storyboard = {
    id: 'storyboard-grid-1',
    type: 'aiFilmStoryboard',
    position: { x: 400, y: 0 },
    data: {
      id: 'storyboard-grid-1',
      type: 'film_storyboard_node',
      status: 'APPROVED',
      label: '影视分镜图',
      raw_text: '两格连续分镜绘图提示词',
      storyboardOutputImageNodeIds: ['rendered-grid-1'],
      storyboardGridImages: [{
        id: 'page-1',
        pageIndex: 1,
        totalPages: 1,
        panelCount: 2,
        panels: [
          { panelIndex: 1, shotId: '1', shotNo: 'S1', sourceLabel: '分镜表', sourceNodeId: 'shot-list-1' },
          { panelIndex: 2, shotId: '2', shotNo: 'S2', sourceLabel: '分镜表', sourceNodeId: 'shot-list-1' },
        ],
      }],
    },
  };
  const image = {
    id: 'rendered-grid-1',
    type: 'imageNode',
    position: { x: 850, y: 0 },
    data: {
      id: 'rendered-grid-1',
      type: 'image_node',
      status: 'APPROVED',
      label: '九宫格输出第1页',
      imageFileName: 'storyboard-grid-1.jpg',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      imageDisplayMode: 'storyboard-output',
      generatedFromStoryboardNodeId: 'storyboard-grid-1',
      generatedStoryboardPageIndex: 1,
      imageGenerationSourceShotIds: ['1', '2'],
      imageGenerationCompletedAt: 100,
    },
  };
  const analysis = {
    readingOrder: '从左到右',
    sceneSummary: '舱室内两格连续动作',
    globalVisualLock: '人物和灯光不变',
    performanceBaseline: '屏息、克制、视线先行',
    spatialContinuity: '人物始终在控制台左侧',
    panels: [
      { panelIndex: 1, visualSummary: '人物看门', camera: '中景', performance: '先屏息再抬眼', gaze: '看门', bodyLanguage: '重心后移', handAction: '手垂下', startState: '低头', endState: '抬眼', continuity: '继承站位' },
      { panelIndex: 2, visualSummary: '手靠近控制杆', camera: '近景', performance: '手指靠近后停住', gaze: '看控制杆', bodyLanguage: '肩膀收紧', handAction: '右手停在杆前', startState: '抬眼', endState: '手指停住', continuity: '继承右手状态' },
    ],
    uncertainties: [],
    sourceImageNodeId: 'rendered-grid-1',
    sourceImageSignature: 'old-image-signature',
    analyzedAt: 100,
  };
  const video = {
    id: 'video-prompt-1',
    type: 'aiFilmVideoPrompt',
    position: { x: 1300, y: 0 },
    data: {
      id: 'video-prompt-1',
      type: 'film_video_prompt_node',
      department: 'FILM_VIDEO_PROMPT',
      status: 'APPROVED',
      label: '视频提示词',
      raw_text: 'REFERENCE\n旧结果',
      output: { text: 'REFERENCE\n旧结果', videoMode: 'B' },
      film_video_prompt_duration_sec: 9,
      film_video_prompt_analysis: analysis,
      film_video_prompt_source_signature: 'outdated-source-signature',
    },
  };
  const edges = [
    { id: 'shot-to-storyboard', source: shotList.id, target: storyboard.id },
    { id: 'storyboard-to-image', source: storyboard.id, target: image.id },
    { id: 'image-to-video', source: image.id, target: video.id, targetHandle: 'in' },
  ];
  return { nodes: [shotList, storyboard, image, video], edges, video };
}

before(async () => {
  globalThis.localStorage = localStorageMock;
  globalThis.window = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:4173' },
  };
  vite = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ useStudioStore } = await vite.ssrLoadModule('/src/store/useStudioStore.ts'));
  ({ collectFilmPromptSource } = await vite.ssrLoadModule('/src/store/slices/aiFilmmakingStore.ts'));
  ({ AiFilmVideoPromptNode } = await vite.ssrLoadModule('/src/components/AiFilmmakingNode.tsx'));
  ({ normalizeRestoredStudioNode } = await vite.ssrLoadModule('/src/utils/studioNodePersistence.ts'));
});

beforeEach(() => {
  memoryStorage.clear();
  useStudioStore.setState({ nodes: [], edges: [], assets: [], messages: [], undoStack: [] });
});

after(async () => {
  await vite?.close();
});

test('real graph traversal resolves the rendered grid, panel mapping and upstream duration', () => {
  const { nodes, edges } = makeGraph();
  const source = collectFilmPromptSource('video-prompt-1', 'film_video_prompt_node', nodes, edges);

  assert.equal(source.primaryImage?.nodeId, 'rendered-grid-1');
  assert.equal(source.primaryImage?.role, 'storyboard');
  assert.equal(source.summary.storyboardPanelCount, 2);
  assert.equal(source.summary.storyboardDurationSec, 9);
  assert.match(source.panelMappingText, /Panel 1 -> shot S1/);
  assert.match(source.summary.storyboardTables[0], /屏息后抬眼/);
});

test('legacy saved 15-second defaults migrate back to automatic upstream duration', () => {
  const legacy = {
    id: 'legacy-video-prompt',
    type: 'aiFilmVideoPrompt',
    position: { x: 0, y: 0 },
    data: {
      id: 'legacy-video-prompt',
      type: 'film_video_prompt_node',
      status: 'APPROVED',
      film_video_prompt_duration_sec: 15,
    },
  };
  const restored = normalizeRestoredStudioNode(legacy);
  assert.equal(restored.data.film_video_prompt_duration_sec, undefined);
  assert.equal(restored.data.film_video_prompt_duration_source, 'auto');

  const explicit = normalizeRestoredStudioNode({
    ...legacy,
    data: {
      ...legacy.data,
      film_video_prompt_duration_sec: 25,
      film_video_prompt_duration_source: 'node',
    },
  });
  assert.equal(explicit.data.film_video_prompt_duration_sec, 25);
  assert.equal(explicit.data.film_video_prompt_duration_source, 'node');
});

test('real video prompt node UI keeps controls and exposes stale source plus acting analysis', () => {
  const { nodes, edges, video } = makeGraph();
  useStudioStore.setState({ nodes, edges });
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    const html = renderToStaticMarkup(
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(AiFilmVideoPromptNode, {
          id: video.id,
          type: video.type,
          data: video.data,
          selected: true,
          draggable: true,
          zIndex: 1,
          isConnectable: true,
        }),
      ),
    );
    assert.match(html, /视频规范/);
    assert.match(html, /九宫格动态表演 · Seedance 2.0/);
    assert.match(html, /总时长/);
    assert.match(html, /value="9"/);
    assert.match(html, /表演与动作接力分析/);
    assert.match(html, /上游图片或分镜已变化，请重新分析/);
    assert.match(html, /更新视频提示词/);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});
