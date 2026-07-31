import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  hasSameShotListWireTopology,
  makeShotListItemOutputHandleId,
  reconcileShotListOutputEdges,
} from '../src/utils/shotListWire.ts';
import {
  findRecoverableStoryboardShotListId,
  storyboardLegacyStatePatch,
} from '../src/utils/storyboardLegacyRecovery.ts';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('shot-list root leaves row output handle events available to React Flow', () => {
  const editor = read('src/components/ShotListEmbeddedEditor.tsx');
  const connectEndBinder = read('src/components/ConnectEndBinder.tsx');
  const canvas = read('src/components/StudioCanvas.tsx');
  const styles = read('src/index.css');
  const rootTag =
    editor.match(
      /<div\s+className="shot-list-canvas__root nodrag nopan nowheel"[\s\S]*?>/,
    )?.[0] ?? '';

  assert.ok(rootTag);
  assert.doesNotMatch(rootTag, /onPointerDown|onMouseDown/);
  assert.match(rootTag, /onContextMenu=\{openShotListContextMenu\}/);
  assert.match(connectEndBinder, /cs\.toNode\.id !== fromNode\.id/);
  assert.match(canvas, /connectionLineStyle=\{STUDIO_CONNECTION_LINE_STYLE\}/);
  assert.match(styles, /\.shot-list-canvas__row-handle\s*\{[\s\S]*?width: 40px !important;/);
  assert.match(styles, /\.shot-list-canvas__row-handle\s*\{[\s\S]*?touch-action: none;/);
  assert.match(editor, /onMouseDown=\{\(event\) =>\s*onManualConnectionStart/);
  assert.match(editor, /document\.addEventListener\('mousemove', onMouseMove\)/);
  assert.match(editor, /buildMagnetConnection\(started, targetId, state\.nodes\)/);
  assert.match(editor, /state\.onConnect\(connection\)/);
  assert.match(editor, /shot-list-canvas__manual-connection-layer/);
  assert.match(styles, /\.shot-list-canvas__manual-connection-layer\s*\{[\s\S]*?pointer-events: none;/);
});

test('merged shots migrate old output edges and remove duplicates', () => {
  const a = { id: 1, wireId: 'wire-a', type: '近景', movement: '固定', description: 'A', content: '' };
  const b = { id: 2, wireId: 'wire-b', type: '近景', movement: '固定', description: 'B', content: '' };
  const merged = {
    id: 1,
    wireId: 'wire-merged',
    type: '近景',
    movement: '固定',
    description: 'A；B',
    content: '',
    mergedMembers: [a, b],
  };
  const edges = [
    {
      id: 'edge-a',
      source: 'shot-list',
      target: 'prompt',
      sourceHandle: makeShotListItemOutputHandleId('wire-a'),
      targetHandle: 'in',
    },
    {
      id: 'edge-b',
      source: 'shot-list',
      target: 'prompt',
      sourceHandle: makeShotListItemOutputHandleId('wire-b'),
      targetHandle: 'in',
    },
  ];

  const result = reconcileShotListOutputEdges(edges, 'shot-list', [a, b], [merged]);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].sourceHandle, makeShotListItemOutputHandleId('wire-merged'));
  assert.equal(result.migratedCount, 2);
  assert.equal(result.removedCount, 1);
});

test('deleted shots remove their stale output edges', () => {
  const shot = { id: 1, wireId: 'wire-a', type: '近景', movement: '固定', description: 'A', content: '' };
  const edges = [
    {
      id: 'edge-a',
      source: 'shot-list',
      target: 'prompt',
      sourceHandle: makeShotListItemOutputHandleId('wire-a'),
      targetHandle: 'in',
    },
  ];

  const result = reconcileShotListOutputEdges(edges, 'shot-list', [shot], []);
  assert.deepEqual(result.edges, []);
  assert.equal(result.removedCount, 1);
});

test('ordinary shot field edits preserve output wire topology', () => {
  const previous = [
    { id: 1, wireId: 'wire-a', type: '近景', movement: '固定', description: 'A', content: '' },
    { id: 2, wireId: 'wire-b', type: '近景', movement: '固定', description: 'B', content: '' },
  ];
  const edited = [
    previous[0],
    { ...previous[1], description: 'B edited', note: 'manual note' },
  ];
  assert.equal(hasSameShotListWireTopology(previous, edited), true);
  assert.equal(hasSameShotListWireTopology(previous, edited.slice(0, 1)), false);

  const merged = [
    {
      ...previous[0],
      wireId: 'wire-merged',
      mergedMembers: previous,
    },
  ];
  assert.equal(hasSameShotListWireTopology(previous, merged), false);
});

test('storyboard generation completes without review UI and opens the shot list', () => {
  const store = read('src/store/useStudioStore.ts');
  const department = read('src/components/DepartmentNode.tsx');
  const detail = read('src/components/DetailPanel.tsx');
  const embedded = read('src/components/ShotListEmbeddedEditor.tsx');
  const persistence = read('src/utils/studioNodePersistence.ts');
  const generationPreview = read('src/utils/generationPreview.ts');

  assert.match(store, /kind === 'storyboard'\s*\?\s*'APPROVED'/);
  assert.equal(store.includes('分镜部已生成完成，分镜表节点已自动打开'), true);
  assert.match(store, /storyboardShotListId = get\(\)\.ensureShotListForStoryboard\(nodeId\)/);
  assert.match(store, /get\(\)\.focusNode\(storyboardShotListId, \{ openDetail: true \}\)/);
  assert.match(store, /return existingId/);
  assert.match(store, /return slId/);
  assert.match(department, /const supportsReview = data\.type === 'writing'/);
  assert.match(detail, /const supportsReview = node\.type === 'writing'/);
  assert.match(detail, /storyboardGenerationPhaseCopy\(node\.generation_phase\)/);
  assert.equal(generationPreview.includes('分镜生成进度 · 校验结构'), true);
  assert.equal(generationPreview.includes('正在同步并打开分镜表节点'), true);
  assert.match(store, /\.\.\.afterEmployee,\s*status: finalStatus/);
  assert.doesNotMatch(store, /patchNodeData\(nodeId, afterEmployee, true\)/);
  assert.doesNotMatch(
    detail,
    /node\.generation_phase !== 'leader'[\s\S]*status: 'APPROVED'/,
  );
  assert.match(detail, /if \(isPipe && node\.status === 'IN_PROGRESS'\)/);
  assert.match(
    persistence,
    /status: hasOutput \? preservedStatus : 'NOT_STARTED',[\s\S]*generation_phase: undefined/,
  );
  assert.equal(detail.includes('运行分镜员工与总监流水线'), false);
  assert.equal(detail.includes('aria-label="总监审核建议"'), false);
  assert.equal(detail.includes('打开分镜表节点'), true);
  assert.doesNotMatch(embedded, /ShotListCanvasDecisionStrip/);
  assert.equal(existsSync(join(root, 'src/components/ShotListCanvasDecisionStrip.tsx')), false);
  assert.equal(existsSync(join(root, 'src/components/detailPanel/ShotListReviewDecisionBar.tsx')), false);
});

test('manual storyboard edits are backed up before regeneration', () => {
  const pipeline = read('src/store/slices/pipelineStore.ts');

  assert.match(pipeline, /duplicateNodesByIds\(\[child\.id\]\)/);
  assert.equal(pipeline.includes('重生成备份'), true);
  assert.doesNotMatch(pipeline, /window\.confirm/);
  assert.match(pipeline, /executeNodeTask\(id, \{ force: true \}\)/);
});

test('legacy storyboard review and generation state is removed on restore', () => {
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.deepEqual(storyboardLegacyStatePatch(true), {
    status: 'APPROVED',
    review_result: null,
    ai_review_feedback: null,
    leader_review_suggested_pass: undefined,
    generation_phase: undefined,
    streaming_preview: undefined,
  });
  assert.deepEqual(storyboardLegacyStatePatch(false), {
    status: 'NOT_STARTED',
    review_result: null,
    ai_review_feedback: null,
    leader_review_suggested_pass: undefined,
    generation_phase: undefined,
    streaming_preview: undefined,
  });
  assert.match(persistence, /storyboardLegacyStatePatch\(hasStoryboardOutput\)/);
  assert.match(persistence, /generation_error: hasStoryboardOutput \? undefined/);
});

test('restore reuses and reconnects a legacy shot-list child before creating one', () => {
  const projectStore = read('src/store/slices/projectStore.ts');
  const studioStore = read('src/store/useStudioStore.ts');
  const nodes = [
    { id: 'storyboard', type: 'department', data: { type: 'storyboard' } },
    {
      id: 'shot-list-metadata',
      type: 'shotList',
      data: { type: 'shot_list_node', sourceStoryboardNodeId: 'storyboard' },
    },
    { id: 'shot-list-wired', type: 'shotList', data: { type: 'shot_list_node' } },
  ];

  assert.equal(
    findRecoverableStoryboardShotListId('storyboard', nodes, [], 'shot-list-link'),
    'shot-list-metadata',
  );
  assert.equal(
    findRecoverableStoryboardShotListId(
      'storyboard',
      nodes,
      [{ source: 'storyboard', target: 'shot-list-wired', sourceHandle: 'shot-list-link' }],
      'shot-list-link',
    ),
    'shot-list-wired',
  );
  assert.equal(
    findRecoverableStoryboardShotListId(
      'storyboard',
      nodes,
      [{ source: 'storyboard', target: 'shot-list-wired', sourceHandle: null }],
      'shot-list-link',
    ),
    'shot-list-metadata',
  );
  assert.match(projectStore, /const childId = get\(\)\.ensureShotListForStoryboard\(node\.id\)/);
  assert.doesNotMatch(projectStore, /if \(hasShotListChild\) continue/);
  assert.match(studioStore, /findRecoverableStoryboardShotListId\(/);
  assert.match(studioStore, /sourceStoryboardNodeId: storyboardNodeId/);
  assert.match(studioStore, /return existingId/);
  assert.match(studioStore, /hasSameShotListWireTopology\(previousShots, output\.shots\)/);
  const downstreamRefresh = studioStore.match(
    /function refreshDownstreamAfterDepartmentOutputChange\([\s\S]*?\n}\n\nfunction edgeIdentity/,
  )?.[0] ?? '';
  assert.doesNotMatch(downstreamRefresh, /resyncConsumersAfterEdgeMutation/);
  const editor = read('src/components/ShotListEmbeddedEditor.tsx');
  assert.match(editor, /const ShotCanvasRow = memo\(/);
  assert.match(editor, /key=\{sh\.wireId \?\? sh\.id\}/);
});
