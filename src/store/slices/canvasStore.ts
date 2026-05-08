import { layoutStudioNodesWithDagre } from '@/utils/dagreLayout';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type CanvasSlice = Pick<
  StudioState,
  | 'setSelected'
  | 'setDetailOpen'
  | 'setActiveNodeId'
  | 'consumeFitRequest'
  | 'focusNode'
  | 'repositionNodes'
  | 'layoutCanvasWithDagre'
>;

export function createCanvasStoreSlice(set: StudioSet, get: StudioGet): CanvasSlice {
  return {
    setSelected: (id) =>
      set((state) => ({
        selectedNodeId: id,
        nodes: state.nodes.map((node) => ({
          ...node,
          selected: id != null && node.id === id,
        })),
      })),

    setDetailOpen: (open) => set({ detailOpen: open }),

    setActiveNodeId: (id) => set({ activeNodeId: id }),

    consumeFitRequest: () => set({ requestFitNodeId: null }),

    focusNode: (id, opts) => {
      const openDetail = opts?.openDetail !== false;
      set((state) => ({
        selectedNodeId: id,
        detailOpen: openDetail,
        activeNodeId: id,
        nodes: state.nodes.map((node) => ({ ...node, selected: node.id === id })),
      }));
    },

    repositionNodes: (patches) => {
      const ids = Object.keys(patches);
      if (ids.length === 0) return;
      set((state) => ({
        nodes: state.nodes.map((node) => {
          const patch = patches[node.id];
          if (!patch) return node;
          return {
            ...node,
            position: { x: patch.x, y: patch.y },
            selected: patch.selected ?? node.selected,
            dragging: false,
          };
        }),
      }));
    },

    layoutCanvasWithDagre: () => {
      const { nodes, edges } = get();
      const next = layoutStudioNodesWithDagre(nodes, edges);
      set({ nodes: next });
      get().pushMessage({ role: 'broadcast', text: '已按 Dagre 重新整理画布布局。' });
    },
  };
}
