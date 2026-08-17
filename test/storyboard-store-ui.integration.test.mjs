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
let normalizeRestoredStudioNode;
let ShotListEmbeddedEditor;
let buildMagnetConnection;
let isStudioConnectionAllowed;
let connectionMenuPicksForPicker;
let makeShotListItemOutputHandleId;
let mergedTextInputForDepartment;

function sampleOutput(prefix = '初始', count = 2) {
  return {
    shots: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      wireId: `wire_${prefix}_${index + 1}`,
      sceneRef: 'S1',
      type: '中景',
      movement: '固定',
      durationSec: 3,
      description: `${prefix}描述${index + 1}`,
      content: '',
    })),
    narrativeBeats: ['蓄势', '爆发'],
  };
}

function resetStore() {
  useStudioStore.setState({
    nodes: [],
    edges: [],
    assets: [],
    messages: [],
    undoStack: [],
    activeNodeId: null,
    selectedNodeId: null,
    detailOpen: false,
  });
}

function createStoryboardWithTable(output = sampleOutput()) {
  const store = useStudioStore.getState();
  const storyboardId = store.addDepartmentNode('storyboard');
  useStudioStore.setState((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === storyboardId
        ? {
            ...node,
            data: {
              ...node.data,
              status: 'APPROVED',
              output,
              storyboard_ai_snapshot: structuredClone(output),
            },
          }
        : node,
    ),
  }));
  const shotListId = useStudioStore.getState().ensureShotListForStoryboard(storyboardId);
  assert.ok(shotListId);
  return { storyboardId, shotListId };
}

before(async () => {
  globalThis.localStorage = localStorageMock;
  globalThis.window = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    confirm: () => true,
    alert: () => undefined,
    location: {
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:4173',
    },
  };
  vite = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  ({ useStudioStore } = await vite.ssrLoadModule('/src/store/useStudioStore.ts'));
  ({ normalizeRestoredStudioNode } = await vite.ssrLoadModule(
    '/src/utils/studioNodePersistence.ts',
  ));
  ({ ShotListEmbeddedEditor } = await vite.ssrLoadModule(
    '/src/components/ShotListEmbeddedEditor.tsx',
  ));
  ({ buildMagnetConnection, connectionMenuPicksForPicker, isStudioConnectionAllowed } = await vite.ssrLoadModule(
    '/src/utils/studioConnectionRules.ts',
  ));
  ({ makeShotListItemOutputHandleId } = await vite.ssrLoadModule(
    '/src/utils/shotListWire.ts',
  ));
  ({ mergedTextInputForDepartment } = await vite.ssrLoadModule(
    '/src/services/graphInput.ts',
  ));
});

beforeEach(() => {
  memoryStorage.clear();
  resetStore();
});

after(async () => {
  await vite?.close();
});

test('real store reuses one storyboard table instead of creating duplicate children', () => {
  const { storyboardId, shotListId } = createStoryboardWithTable();
  const secondId = useStudioStore.getState().ensureShotListForStoryboard(storyboardId);
  assert.equal(secondId, shotListId);

  const state = useStudioStore.getState();
  const childNodes = state.nodes.filter(
    (node) =>
      node.type === 'shotList' &&
      node.data.type === 'shot_list_node' &&
      node.data.sourceStoryboardNodeId === storyboardId,
  );
  const relationEdges = state.edges.filter(
    (edge) => edge.source === storyboardId && edge.target === shotListId,
  );
  assert.equal(childNodes.length, 1);
  assert.equal(relationEdges.length, 1);
});

test('Prompt graph input routes ordinary images to scene recognition and palettes to color analysis', () => {
  const promptNode = {
    id: 'prompt-1',
    type: 'department',
    position: { x: 0, y: 0 },
    data: { id: 'prompt-1', type: 'prompt', status: 'NOT_STARTED', input: '', output: null },
  };
  const sceneImage = {
    id: 'scene-image',
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      id: 'scene-image',
      type: 'image_node',
      status: 'APPROVED',
      imageNodeMode: 'asset',
      imageDataUrl: 'data:image/png;base64,AA==',
      imageFileName: '地下船坞.png',
      imageAnalysisSummary: '地下船坞，舱门位于画面右侧，地面有低位蒸汽。',
    },
  };
  const paletteImage = {
    id: 'palette-image',
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      id: 'palette-image',
      type: 'image_node',
      status: 'APPROVED',
      imageNodeMode: 'palette',
      imageDataUrl: 'data:image/png;base64,AA==',
      imageFileName: '地下船坞色表.png',
      imageColorAnalysisSummary: '冷蓝主色，琥珀色点光。',
    },
  };
  const makeEdge = (source) => ({
    id: `${source}-prompt`,
    source,
    sourceHandle: 'out',
    target: 'prompt-1',
    targetHandle: 'in',
  });

  const sceneInput = mergedTextInputForDepartment(
    'prompt-1',
    [promptNode, sceneImage],
    [makeEdge('scene-image')],
  );
  assert.match(sceneInput, /【Prompt 视觉场景参考图 1】/);
  assert.match(sceneInput, /舱门位于画面右侧/);
  assert.doesNotMatch(sceneInput, /【色彩表参考图/);

  const paletteInput = mergedTextInputForDepartment(
    'prompt-1',
    [promptNode, paletteImage],
    [makeEdge('palette-image')],
  );
  assert.match(paletteInput, /【色彩表参考图 1】/);
  assert.match(paletteInput, /冷蓝主色/);
  assert.doesNotMatch(paletteInput, /【Prompt 视觉场景参考图/);
});

test('real store restores the structural storyboard-to-table edge after it is removed', () => {
  const { storyboardId, shotListId } = createStoryboardWithTable();
  const initialEdge = useStudioStore
    .getState()
    .edges.find((edge) => edge.source === storyboardId && edge.target === shotListId);
  assert.ok(initialEdge);
  assert.equal(initialEdge.sourceHandle, 'shot-list-link');
  assert.equal(initialEdge.targetHandle, 'shot-list-parent');
  assert.equal(initialEdge.deletable, false);
  assert.equal(initialEdge.selectable, false);
  assert.equal(initialEdge.style?.strokeDasharray, '6 4');

  useStudioStore.getState().onEdgesChange([{ type: 'remove', id: initialEdge.id }]);

  const restoredState = useStudioStore.getState();
  const restoredEdge = restoredState.edges.find(
    (edge) => edge.source === storyboardId && edge.target === shotListId,
  );
  assert.ok(restoredEdge);
  assert.equal(restoredEdge.sourceHandle, 'shot-list-link');
  assert.equal(restoredEdge.targetHandle, 'shot-list-parent');
  assert.equal(restoredEdge.deletable, false);
  assert.equal(restoredEdge.selectable, false);
  assert.equal(restoredEdge.style?.strokeDasharray, '6 4');
  assert.equal(
    restoredState.nodes.find((node) => node.id === shotListId)?.data.sourceStoryboardNodeId,
    storyboardId,
  );
});

test('real store upgrades a legacy direct storyboard-table edge to the dashed structural edge', () => {
  const { storyboardId, shotListId } = createStoryboardWithTable();
  useStudioStore.setState((state) => ({
    edges: state.edges.map((edge) =>
      edge.source === storyboardId && edge.target === shotListId
        ? {
            ...edge,
            sourceHandle: null,
            targetHandle: null,
            animated: false,
            deletable: true,
            selectable: true,
            style: undefined,
          }
        : edge,
    ),
  }));

  useStudioStore.getState().reconcileShotListGraphBindings();

  const relationEdges = useStudioStore
    .getState()
    .edges.filter((edge) => edge.source === storyboardId && edge.target === shotListId);
  assert.equal(relationEdges.length, 1);
  assert.equal(relationEdges[0].sourceHandle, 'shot-list-link');
  assert.equal(relationEdges[0].targetHandle, 'shot-list-parent');
  assert.equal(relationEdges[0].animated, true);
  assert.equal(relationEdges[0].deletable, false);
  assert.equal(relationEdges[0].selectable, false);
  assert.equal(relationEdges[0].style?.strokeDasharray, '6 4');
});

test('real store reclaims the matching detached table from projects saved after the old bug', () => {
  const { storyboardId, shotListId } = createStoryboardWithTable();
  useStudioStore.setState((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === shotListId
        ? {
            ...node,
            data: {
              ...node.data,
              sourceStoryboardNodeId: undefined,
              sourceStoryboardFileNodeId: undefined,
            },
          }
        : node,
    ),
    edges: state.edges.filter(
      (edge) => !(edge.source === storyboardId && edge.target === shotListId),
    ),
  }));

  const recoveredId = useStudioStore
    .getState()
    .ensureShotListForStoryboard(storyboardId);
  assert.equal(recoveredId, shotListId);

  const state = useStudioStore.getState();
  assert.equal(
    state.nodes.filter((node) => node.type === 'shotList').length,
    1,
  );
  assert.equal(
    state.nodes.find((node) => node.id === shotListId)?.data.sourceStoryboardNodeId,
    storyboardId,
  );
  const relation = state.edges.find(
    (edge) => edge.source === storyboardId && edge.target === shotListId,
  );
  assert.ok(relation);
  assert.equal(relation.sourceHandle, 'shot-list-link');
  assert.equal(relation.targetHandle, 'shot-list-parent');
  assert.equal(relation.deletable, false);
  assert.equal(relation.selectable, false);
});

test('real store keeps the storyboard table authoritative until an explicit regeneration sync', () => {
  const { storyboardId, shotListId } = createStoryboardWithTable();
  const edited = sampleOutput('分镜表编辑');
  useStudioStore.getState().patchShotListNodeOutput(shotListId, edited, true);

  const mirroredParent = useStudioStore
    .getState()
    .nodes.find((node) => node.id === storyboardId);
  assert.equal(mirroredParent?.data.output.shots[0].description, '分镜表编辑描述1');

  const parentOnlyChange = sampleOutput('父节点外部修改');
  useStudioStore
    .getState()
    .patchNodeData(storyboardId, { output: parentOnlyChange }, false);
  useStudioStore.getState().syncShotListNodesFromStoryboard(storyboardId);

  const preservedChild = useStudioStore
    .getState()
    .nodes.find((node) => node.id === shotListId);
  assert.equal(preservedChild?.data.output.shots[0].description, '分镜表编辑描述1');

  useStudioStore
    .getState()
    .syncShotListNodesFromStoryboard(storyboardId, { force: true });
  const regeneratedChild = useStudioStore
    .getState()
    .nodes.find((node) => node.id === shotListId);
  assert.equal(regeneratedChild?.data.output.shots[0].description, '父节点外部修改描述1');
});

test('real persistence recovery removes interrupted storyboard runtime state', () => {
  const output = sampleOutput('恢复');
  const recovered = normalizeRestoredStudioNode({
    id: 'storyboard_restore',
    type: 'department',
    position: { x: 0, y: 0 },
    data: {
      id: 'storyboard_restore',
      type: 'storyboard',
      department: 'STORYBOARD',
      status: 'IN_PROGRESS',
      input: '第一场 客厅 日',
      output,
      review_result: '旧审核意见',
      ai_review_feedback: '旧 Leader 意见',
      generation_phase: 'leader',
      streaming_preview: '旧运行状态',
      version: 1,
      label: '分镜部',
    },
  });
  assert.equal(recovered.data.status, 'APPROVED');
  assert.equal(recovered.data.generation_phase, undefined);
  assert.ok(!recovered.data.streaming_preview);
  assert.equal(recovered.data.ai_review_feedback, null);
});

test('real persistence recovery clears orphaned film storyboard drawing state', () => {
  const recovered = normalizeRestoredStudioNode({
    id: 'film_storyboard_restore',
    type: 'aiFilmStoryboard',
    position: { x: 0, y: 0 },
    data: {
      id: 'film_storyboard_restore',
      type: 'film_storyboard_node',
      department: 'AI_FILMMAKING',
      status: 'APPROVED',
      input: '',
      output: { storyboardImages: [] },
      imageGenerationStatus: 'generating',
      imageGenerationPhase: 'requesting_model',
      imageGenerationCompletedPages: 0,
      imageGenerationTotalPages: 1,
      version: 1,
      label: '影视分镜图',
    },
  });
  assert.equal(recovered.data.imageGenerationStatus, 'idle');
  assert.equal(recovered.data.imageGenerationPhase, undefined);
  assert.equal(recovered.data.imageGenerationCompletedPages, undefined);
  assert.equal(recovered.data.imageGenerationTotalPages, undefined);
  assert.equal(recovered.data.status, 'APPROVED');
  assert.match(recovered.data.generation_error, /被中断/);
});

test('real UI rendering windows a large storyboard table instead of mounting every row', () => {
  const output = sampleOutput('虚拟行', 40);
  const data = {
    id: 'shotlist_virtual',
    type: 'shot_list_node',
    department: 'SHOT_LIST',
    status: 'APPROVED',
    input: '',
    output,
    review_result: null,
    version: 1,
    label: '分镜表',
  };
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    const html = renderToStaticMarkup(
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(ShotListEmbeddedEditor, {
          id: 'shotlist_virtual',
          data,
          viewportHeight: 560,
        }),
      ),
    );
    assert.match(html, /虚拟行描述1/);
    assert.doesNotMatch(html, /虚拟行描述30/);
    assert.match(html, /shot-list-canvas__virtual-spacer/);
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});

test('real connection rules resolve a shot-list fallback drag to the Prompt input', () => {
  const nodes = [
    {
      id: 'shot-list',
      type: 'shotList',
      position: { x: 0, y: 0 },
      data: { type: 'shot_list_node', status: 'APPROVED' },
    },
    {
      id: 'prompt',
      type: 'department',
      position: { x: 600, y: 0 },
      data: { type: 'prompt', status: 'NOT_STARTED' },
    },
  ];
  const connection = buildMagnetConnection(
    {
      nodeId: 'shot-list',
      handleId: makeShotListItemOutputHandleId('wire-a'),
      handleType: 'source',
    },
    'prompt',
    nodes,
  );

  assert.deepEqual(connection, {
    source: 'shot-list',
    target: 'prompt',
    sourceHandle: makeShotListItemOutputHandleId('wire-a'),
    targetHandle: 'in',
  });
  assert.equal(isStudioConnectionAllowed(connection, nodes, []), true);
});

test('multi-selection output exposes only common downstream choices', () => {
  const nodes = [
    {
      id: 'image-a',
      type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { type: 'image_node', status: 'APPROVED' },
    },
    {
      id: 'image-b',
      type: 'imageNode',
      position: { x: 0, y: 300 },
      data: { type: 'image_node', status: 'APPROVED' },
    },
  ];
  const picks = connectionMenuPicksForPicker(
    {
      fromNodeId: 'image-a',
      fromNodeIds: ['image-a', 'image-b'],
      fromHandleId: 'out',
      fromHandleType: 'source',
      screenX: 0,
      screenY: 0,
      flowX: 0,
      flowY: 0,
    },
    nodes,
  );

  assert.ok(picks.includes('text_node'));
  assert.ok(picks.includes('image_node'));
  assert.ok(picks.includes('film_video_prompt_node'));
  assert.equal(picks.includes('video_node'), false);
});

test('image nodes can feed an image edit node without allowing a cycle', () => {
  const nodes = [
    {
      id: 'image-a',
      type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { type: 'image_node', status: 'APPROVED' },
    },
    {
      id: 'image-b',
      type: 'imageNode',
      position: { x: 500, y: 0 },
      data: { type: 'image_node', status: 'NOT_STARTED' },
    },
  ];
  const forward = {
    source: 'image-a',
    target: 'image-b',
    sourceHandle: 'out',
    targetHandle: 'in',
  };
  assert.equal(isStudioConnectionAllowed(forward, nodes, []), true);
  assert.equal(
    isStudioConnectionAllowed(
      { ...forward, source: 'image-b', target: 'image-a' },
      nodes,
      [{ id: 'edge-a-b', ...forward }],
    ),
    false,
  );
});

test('real regenerate action backs up manual edits and starts without a native confirm', async () => {
  localStorage.setItem(
    'studio_canvas_llm_settings_v7',
    JSON.stringify({
      proxyUrl: '',
      baseUrl: 'https://mock.local/v1',
      apiKey: 'test',
      mode: 'deep',
      deepModel: 'mock-model',
      timeoutMs: 420_000,
      pipelineMode: 'model',
    }),
  );
  const { storyboardId, shotListId } = createStoryboardWithTable();
  useStudioStore
    .getState()
    .patchNodeData(storyboardId, { input: '第一场 客厅 夜\n人物进入。' }, false);
  useStudioStore
    .getState()
    .patchShotListNodeOutput(shotListId, sampleOutput('手工修改'), true);

  const originalFetch = globalThis.fetch;
  const originalConfirm = globalThis.window.confirm;
  let fetchCalls = 0;
  globalThis.window.confirm = () => {
    throw new Error('regeneration must not use a native confirm');
  };
  globalThis.fetch = (_url, init = {}) => {
    fetchCalls += 1;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort, { once: true });
    });
  };

  try {
    useStudioStore.getState().regenerateNode(storyboardId);
    for (let index = 0; index < 100 && fetchCalls === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fetchCalls, 1);
    assert.equal(
      useStudioStore.getState().nodes.find((node) => node.id === storyboardId)?.data.status,
      'IN_PROGRESS',
    );
    const backups = useStudioStore.getState().nodes.filter(
      (node) =>
        node.type === 'shotList' &&
        node.id !== shotListId &&
        node.data.label?.includes('重生成备份'),
    );
    assert.equal(backups.length, 1);
    assert.equal(backups[0].data.sourceStoryboardNodeId, undefined);

    useStudioStore.getState().stopNodeTask(storyboardId);
    for (let index = 0; index < 100; index += 1) {
      const status = useStudioStore
        .getState()
        .nodes.find((node) => node.id === storyboardId)?.data.status;
      if (status !== 'IN_PROGRESS') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    useStudioStore.getState().stopNodeTask(storyboardId);
    globalThis.fetch = originalFetch;
    globalThis.window.confirm = originalConfirm;
  }
});

test('real store stop action aborts an in-flight storyboard model request', async () => {
  localStorage.setItem(
    'studio_canvas_llm_settings_v7',
    JSON.stringify({
      proxyUrl: '',
      baseUrl: 'https://mock.local/v1',
      apiKey: 'test',
      mode: 'deep',
      deepModel: 'mock-model',
      timeoutMs: 420_000,
      pipelineMode: 'model',
    }),
  );
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (_url, init = {}) => {
    fetchCalls += 1;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort, { once: true });
    });
  };

  try {
    const storyboardId = useStudioStore.getState().addDepartmentNode('storyboard');
    useStudioStore
      .getState()
      .patchNodeData(storyboardId, { input: '第一场 客厅 日\n人物进入。' }, false);
    const task = useStudioStore.getState().executeNodeTask(storyboardId);
    for (let index = 0; index < 100 && fetchCalls === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fetchCalls, 1);
    assert.equal(
      useStudioStore.getState().nodes.find((node) => node.id === storyboardId)?.data.status,
      'IN_PROGRESS',
    );

    useStudioStore.getState().stopNodeTask(storyboardId);
    await task;
    const stopped = useStudioStore
      .getState()
      .nodes.find((node) => node.id === storyboardId);
    assert.equal(stopped?.data.status, 'NOT_STARTED');
    assert.equal(stopped?.data.generation_error, '当前任务已停止。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
