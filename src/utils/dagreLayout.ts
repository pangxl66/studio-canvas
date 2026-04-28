import dagre from 'dagre';
import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';

const DEPT_W = 280;
const DEPT_H = 240;
const TEXT_W = 280;
const TEXT_H = 340;
const SHOT_LIST_W = 800;
const SHOT_LIST_H = 420;

function nodeSize(n: StudioRFNode): { width: number; height: number } {
  if (n.type === 'textNode') return { width: TEXT_W, height: TEXT_H };
  if (n.type === 'shotList') {
    return {
      width:
        typeof n.data.canvasWidth === 'number' && Number.isFinite(n.data.canvasWidth)
          ? n.data.canvasWidth
          : SHOT_LIST_W,
      height:
        typeof n.data.canvasHeight === 'number' && Number.isFinite(n.data.canvasHeight)
          ? n.data.canvasHeight
          : SHOT_LIST_H,
    };
  }
  return { width: DEPT_W, height: DEPT_H };
}

/**
 * 使用 Dagre 按边方向做层级排布（左→右），返回带新 position 的节点列表。
 */
export function layoutStudioNodesWithDagre(
  nodes: StudioRFNode[],
  edges: Edge[],
): StudioRFNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    ranksep: 100,
    nodesep: 48,
    marginx: 64,
    marginy: 64,
  });

  for (const n of nodes) {
    const { width, height } = nodeSize(n);
    g.setNode(n.id, { width, height });
  }

  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const { width, height } = nodeSize(n);
    return {
      ...n,
      position: {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
      },
    };
  });
}
