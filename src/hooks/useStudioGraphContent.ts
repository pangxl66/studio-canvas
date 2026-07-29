import { useStudioStore, type StudioState } from '@/store/useStudioStore';
import type { StudioRFNode } from '@/types/reactFlow';

let cachedSourceNodes: StudioRFNode[] | null = null;
let cachedGraphContentNodes: StudioRFNode[] | null = null;

function selectStudioGraphContentNodes(state: StudioState): StudioRFNode[] {
  const next = state.nodes;
  if (cachedSourceNodes === next && cachedGraphContentNodes) {
    return cachedGraphContentNodes;
  }

  cachedSourceNodes = next;
  if (
    cachedGraphContentNodes &&
    cachedGraphContentNodes.length === next.length &&
    cachedGraphContentNodes.every(
      (node, index) =>
        node.id === next[index]?.id &&
        node.type === next[index]?.type &&
        node.data === next[index]?.data,
    )
  ) {
    return cachedGraphContentNodes;
  }

  cachedGraphContentNodes = next;
  return next;
}

/**
 * Returns a stable graph-content snapshot when only React Flow presentation
 * fields (position, selection, measured size, dragging) changed.
 *
 * Consumers of this hook must only read node id/type/data. This prevents every
 * text, image and filmmaking node from recomputing its upstream graph on every
 * pointer-move while another node is being dragged.
 */
export function useStudioGraphContentNodes(): StudioRFNode[] {
  return useStudioStore(selectStudioGraphContentNodes);
}
