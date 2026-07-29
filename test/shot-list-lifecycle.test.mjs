import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  makeShotListItemOutputHandleId,
  reconcileShotListOutputEdges,
} from '../src/utils/shotListWire.ts';
import {
  findRecoverableStoryboardShotListId,
  storyboardLegacyStatePatch,
} from '../src/utils/storyboardLegacyRecovery.ts';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

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

test('storyboard generation completes without review UI and opens the shot list', () => {
  const store = read('src/store/useStudioStore.ts');
  const department = read('src/components/DepartmentNode.tsx');
  const detail = read('src/components/DetailPanel.tsx');
  const embedded = read('src/components/ShotListEmbeddedEditor.tsx');
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.match(store, /kind === 'storyboard'\s*\?\s*'APPROVED'/);
  assert.equal(store.includes('分镜部已生成完成，分解表节点已自动打开'), true);
  assert.match(store, /storyboardShotListId = get\(\)\.ensureShotListForStoryboard\(nodeId\)/);
  assert.match(store, /get\(\)\.focusNode\(storyboardShotListId, \{ openDetail: true \}\)/);
  assert.match(store, /return existingId/);
  assert.match(store, /return slId/);
  assert.match(department, /const supportsReview = data\.type === 'writing'/);
  assert.match(detail, /const supportsReview = node\.type === 'writing'/);
  assert.equal(detail.includes('分镜生成进度 · 校验整理'), true);
  assert.equal(detail.includes('正在校验镜头结构并准备分解表节点'), true);
  assert.match(store, /\.\.\.afterEmployee,\s*status: finalStatus/);
  assert.doesNotMatch(store, /patchNodeData\(nodeId, afterEmployee, true\)/);
  assert.match(
    detail,
    /node\.status !== 'IN_PROGRESS'[\s\S]*node\.generation_phase !== 'leader'[\s\S]*status: 'APPROVED'/,
  );
  assert.match(
    persistence,
    /status: hasOutput \? preservedStatus : 'NOT_STARTED',[\s\S]*generation_phase: undefined/,
  );
  assert.equal(detail.includes('运行分镜员工与总监流水线'), false);
  assert.equal(detail.includes('aria-label="总监审核建议"'), false);
  assert.equal(detail.includes('打开分解表节点'), true);
  assert.doesNotMatch(embedded, /ShotListCanvasDecisionStrip/);
  assert.equal(existsSync(join(root, 'src/components/ShotListCanvasDecisionStrip.tsx')), false);
  assert.equal(existsSync(join(root, 'src/components/detailPanel/ShotListReviewDecisionBar.tsx')), false);
});

test('manual storyboard edits are backed up before regeneration', () => {
  const pipeline = read('src/store/slices/pipelineStore.ts');

  assert.equal(pipeline.includes('当前分镜表包含手工修改'), true);
  assert.match(pipeline, /duplicateNodesByIds\(\[child\.id\]\)/);
  assert.equal(pipeline.includes('重生成备份'), true);
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
});
