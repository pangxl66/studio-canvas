import { mergedTextInputForDepartment } from '@/services/graphInput';
import { flushShotListPendingEdits } from '@/utils/shotListPendingEdits';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type ShotListSlice = Pick<
  StudioState,
  'setShotListSelectedWires' | 'refreshPromptInputsFromShotList'
>;

export function createShotListStoreSlice(set: StudioSet, get: StudioGet): ShotListSlice {
  return {
    setShotListSelectedWires: (nodeId, wireIds) =>
      set((state) => {
        const prev = state.shotListSelectedWiresByNodeId[nodeId] ?? [];
        if (
          prev.length === wireIds.length &&
          prev.every((wireId, index) => wireId === wireIds[index])
        ) {
          return state;
        }
        if (wireIds.length === 0) {
          if (!(nodeId in state.shotListSelectedWiresByNodeId)) return state;
          const next = { ...state.shotListSelectedWiresByNodeId };
          delete next[nodeId];
          return { shotListSelectedWiresByNodeId: next };
        }
        return {
          shotListSelectedWiresByNodeId: {
            ...state.shotListSelectedWiresByNodeId,
            [nodeId]: wireIds,
          },
        };
      }),

    refreshPromptInputsFromShotList: (shotListId) => {
      flushShotListPendingEdits(shotListId);
      const { nodes, edges } = get();
      const shotListNode = nodes.find((node) => node.id === shotListId);
      if (!shotListNode || shotListNode.type !== 'shotList' || shotListNode.data.type !== 'shot_list_node') {
        return [];
      }

      const promptIds = [
        ...new Set(
          edges
            .filter((edge) => edge.source === shotListId)
            .map((edge) => {
              const target = nodes.find((node) => node.id === edge.target);
              return target?.type === 'department' && target.data.type === 'prompt' ? target.id : null;
            })
            .filter(Boolean) as string[],
        ),
      ];

      if (promptIds.length === 0) {
        get().pushMessage({
          role: 'system',
          text: '当前镜头表还没有连接下游 Prompt 节点。',
          nodeId: shotListId,
        });
        return [];
      }

      const skippedPromptIds: string[] = [];
      for (const promptId of promptIds) {
        const promptNode = get().nodes.find((node) => node.id === promptId);
        if (!promptNode || promptNode.type !== 'department' || promptNode.data.type !== 'prompt') continue;
        if (promptNode.data.status === 'IN_PROGRESS') {
          skippedPromptIds.push(promptId);
          continue;
        }
        const merged = mergedTextInputForDepartment(promptId, get().nodes, get().edges);
        const staleReason =
          promptNode.data.output && typeof promptNode.data.output === 'object'
            ? '镜头表已更新到当前 Prompt 输入；现有 Prompt 结果仍是旧版本，请点击重新生成。'
            : null;
        get().patchNodeData(
          promptId,
          {
            input: merged ?? promptNode.data.input,
            inputSource: 'graph',
            output_stale_reason: staleReason,
          },
          false,
        );
      }

      const syncedCount = promptIds.length - skippedPromptIds.length;
      get().pushMessage({
        role: 'broadcast',
        text:
          syncedCount > 0
            ? `已把镜头表最新内容同步到 ${syncedCount} 个下游 Prompt 输入；如已有旧结果，请重新生成。`
            : '下游 Prompt 当前正在执行中，暂未覆盖其本轮输入。',
        nodeId: shotListId,
      });
      if (skippedPromptIds.length > 0) {
        for (const promptId of skippedPromptIds) {
          get().pushMessage({
            role: 'system',
            text: '该 Prompt 正在执行中，已跳过本次同步；请等待完成后再重新同步。',
            nodeId: promptId,
          });
        }
      }
      return promptIds;
    },
  };
}
