export type LegacyStoryboardStatePatch = {
  status: 'APPROVED' | 'NOT_STARTED';
  review_result: null;
  ai_review_feedback: null;
  leader_review_suggested_pass: undefined;
  generation_phase: undefined;
  streaming_preview: undefined;
};

export function storyboardLegacyStatePatch(hasOutput: boolean): LegacyStoryboardStatePatch {
  return {
    status: hasOutput ? 'APPROVED' : 'NOT_STARTED',
    review_result: null,
    ai_review_feedback: null,
    leader_review_suggested_pass: undefined,
    generation_phase: undefined,
    streaming_preview: undefined,
  };
}

type RecoveryNode = {
  id: string;
  type?: string;
  data?: {
    type?: string;
    sourceStoryboardNodeId?: string;
  };
};

type RecoveryEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

function isShotListNode(node: RecoveryNode | undefined): boolean {
  return node?.type === 'shotList' && node.data?.type === 'shot_list_node';
}

/**
 * Recovers the most likely existing shot-list child before creating a new one.
 * Preference order: canonical edge, persisted parent metadata, then a legacy
 * direct edge whose handle was omitted or renamed by an older build.
 */
export function findRecoverableStoryboardShotListId(
  storyboardNodeId: string,
  nodes: readonly RecoveryNode[],
  edges: readonly RecoveryEdge[],
  canonicalSourceHandle: string,
): string | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const canonicalEdge = edges.find(
    (edge) =>
      edge.source === storyboardNodeId &&
      edge.sourceHandle === canonicalSourceHandle &&
      isShotListNode(nodesById.get(edge.target)),
  );
  if (canonicalEdge) return canonicalEdge.target;

  const metadataChild = nodes.find(
    (node) =>
      isShotListNode(node) &&
      node.data?.sourceStoryboardNodeId === storyboardNodeId,
  );
  if (metadataChild) return metadataChild.id;

  return edges.find(
    (edge) =>
      edge.source === storyboardNodeId &&
      isShotListNode(nodesById.get(edge.target)),
  )?.target;
}
