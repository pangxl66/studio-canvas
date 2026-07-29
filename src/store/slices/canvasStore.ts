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
      set((state) => {
        let selectionChanged = state.selectedNodeId !== id;
        const nodes = state.nodes.map((node) => {
          const selected = id != null && node.id === id;
          if (node.selected === selected) return node;
          selectionChanged = true;
          return { ...node, selected };
        });
        if (!selectionChanged) return state;
        return {
          selectedNodeId: id,
          nodes,
        };
      }),

    setDetailOpen: (open) => set({ detailOpen: open }),

    setActiveNodeId: (id) => set({ activeNodeId: id }),

    consumeFitRequest: () => set({ requestFitNodeId: null }),

    focusNode: (id, opts) => {
      set((state) => {
        const target = state.nodes.find((node) => node.id === id);
        const promptOwnsItsControls =
          target?.type === 'department' && target.data.type === 'prompt';
        const detailOpen = opts?.openDetail !== false && !promptOwnsItsControls;
        let selectionChanged = state.selectedNodeId !== id;
        const nodes = state.nodes.map((node) => {
          const selected = node.id === id;
          if (node.selected === selected) return node;
          selectionChanged = true;
          return { ...node, selected };
        });
        if (
          !selectionChanged &&
          state.detailOpen === detailOpen &&
          state.activeNodeId === id
        ) {
          return state;
        }
        return {
          selectedNodeId: id,
          detailOpen,
          activeNodeId: id,
          nodes: selectionChanged ? nodes : state.nodes,
        };
      });
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
