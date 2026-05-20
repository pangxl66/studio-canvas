import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';

const DEPRECATED_SCRIPT_FLOW_NODE_TYPES = new Set<StudioRFNode['type']>([
  'scriptInput',
  'scriptAnalyzer',
  'scriptOutput',
]);

export function isDeprecatedScriptFlowNode(node: Pick<StudioRFNode, 'type'>): boolean {
  return DEPRECATED_SCRIPT_FLOW_NODE_TYPES.has(node.type as StudioRFNode['type']);
}

export function removeDeprecatedScriptNodes(
  nodes: StudioRFNode[],
  edges: Edge[],
): { nodes: StudioRFNode[]; edges: Edge[]; removedIds: string[] } {
  const removedIds = nodes.filter(isDeprecatedScriptFlowNode).map((node) => node.id);
  if (removedIds.length === 0) {
    return { nodes, edges, removedIds };
  }
  const removed = new Set(removedIds);
  return {
    nodes: nodes.filter((node) => !removed.has(node.id)),
    edges: edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
    removedIds,
  };
}
