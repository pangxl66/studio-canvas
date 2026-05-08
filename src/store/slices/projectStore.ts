import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  normalizeRestoredStudioNode,
  rebindStudioNodeRuntimeHandlers,
} from '@/utils/studioNodePersistence';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type ProjectSlice = Pick<
  StudioState,
  'setCurrentProjectMeta' | 'createNewProject' | 'hydrateProject'
>;

type ProjectSliceDeps = {
  uid: (prefix: string) => string;
  nextProjectName: (projectName?: string | null) => string;
  pushUndoSnapshot: (set: StudioSet) => void;
};

export function createProjectStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: ProjectSliceDeps,
): ProjectSlice {
  return {
    setCurrentProjectMeta: (projectId, projectName) => {
      set({
        currentProjectId: projectId,
        currentProjectName: deps.nextProjectName(projectName),
      });
    },

    createNewProject: (projectName) => {
      const nextProjectId = deps.uid('project');
      const nextName = deps.nextProjectName(projectName);
      deps.pushUndoSnapshot(set);
      set({
        nodes: [],
        edges: [],
        assets: [],
        messages: [],
        currentProjectId: nextProjectId,
        currentProjectName: nextName,
        selectedNodeId: null,
        activeNodeId: null,
        detailOpen: false,
        requestFitNodeId: null,
        shotListSelectedWiresByNodeId: {},
        workflowAgentSession: null,
      });
      get().pushMessage({
        role: 'broadcast',
        text: `已新建项目「${nextName}」。`,
      });
      return nextProjectId;
    },

    hydrateProject: (nodes: StudioRFNode[], edges: Edge[], opts) => {
      const normalized = nodes.map(normalizeRestoredStudioNode);
      const api = {
        executeNodeTask: (id: string) => get().executeNodeTask(id),
        focusNode: (id: string, o?: { openDetail?: boolean }) => get().focusNode(id, o),
        removeNodesByIds: (ids: string[]) => get().removeNodesByIds(ids),
      };
      const bound = rebindStudioNodeRuntimeHandlers(normalized, api);
      const cleaned: StudioRFNode[] = bound.map((node) => ({
        ...node,
        selected: false,
        dragging: false,
      }));
      set({
        nodes: cleaned,
        edges,
        assets: [],
        messages: [],
        selectedNodeId: null,
        activeNodeId: null,
        detailOpen: false,
        requestFitNodeId: null,
        shotListSelectedWiresByNodeId: {},
        currentProjectId: opts?.projectId ?? null,
        currentProjectName: deps.nextProjectName(opts?.projectName),
        workflowAgentSession: null,
      });
      get().reconcileShotListGraphBindings();
      get().pushMessage({
        role: 'broadcast',
        text:
          opts?.broadcastText ??
          `已恢复项目，包含 ${nodes.length} 个节点、${edges.length} 条连线。`,
      });
    },
  };
}
