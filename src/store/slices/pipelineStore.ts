import type { Department } from '@/types/studio';
import { recoverInterruptedTextPolish } from '@/services/textPolishLifecycle';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;
type ExecutableKind = 'writing' | 'storyboard' | 'prompt';

type PipelineSlice = Pick<
  StudioState,
  | 'startWritingPipeline'
  | 'startStoryboardPipeline'
  | 'runStoryboardFromInput'
  | 'runWritingFromInput'
  | 'startPromptPipeline'
  | 'runPromptFromInput'
  | 'stopNodeTask'
  | 'retryPipeline'
  | 'regenerateNode'
>;

type PipelineSliceDeps = {
  activeTaskAbortControllers: Map<string, AbortController>;
  stopTaskMessage: string;
  deptLabel: (department: Department) => string;
  kindToDepartment: (kind: ExecutableKind) => Department;
};

export function createPipelineStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: PipelineSliceDeps,
): PipelineSlice {
  void set;

  const rerunLabel = (kind: ExecutableKind) => deps.deptLabel(deps.kindToDepartment(kind));

  return {
    startWritingPipeline: (text, position) => {
      const id = get().addDepartmentNode('writing', position);
      get().patchNodeData(id, { input: text }, false);
      get().setActiveNodeId(id);
      get().pushMessage({
        role: 'broadcast',
        text: '编剧节点已开始执行 AI 任务，请稍候。',
        nodeId: id,
      });
      void get().executeNodeTask(id);
      return id;
    },

    startStoryboardPipeline: (position) => {
      const id = get().addDepartmentNode('storyboard', position);
      get().patchNodeData(
        id,
        {
          input: '',
          status: 'NOT_STARTED',
          output: null,
          review_result: null,
          sourceSceneCount: undefined,
        },
        true,
      );
      get().setActiveNodeId(id);
      get().pushMessage({
        role: 'broadcast',
        text: '已创建分镜节点。请先输入剧本文本或连接上游内容，然后开始生成镜头表。',
        nodeId: id,
      });
      return id;
    },

    runStoryboardFromInput: (id) => {
      const node = get().nodes.find((item) => item.id === id);
      if (!node || node.data.type !== 'storyboard') return;
      void get().executeNodeTask(id);
    },

    runWritingFromInput: (id) => {
      const node = get().nodes.find((item) => item.id === id);
      if (!node || node.data.type !== 'writing') return;
      void get().executeNodeTask(id);
    },

    startPromptPipeline: (brief, position) => {
      const id = get().addDepartmentNode('prompt', position);
      get().patchNodeData(id, { input: brief }, false);
      get().setActiveNodeId(id);
      get().pushMessage({
        role: 'broadcast',
        text: 'Prompt 节点已创建，并开始根据当前输入生成提示词。',
        nodeId: id,
      });
      void get().executeNodeTask(id);
      return id;
    },

    runPromptFromInput: (id) => {
      const node = get().nodes.find((item) => item.id === id);
      if (!node || node.data.type !== 'prompt') return;
      void get().executeNodeTask(id);
    },

    stopNodeTask: (nodeId) => {
      const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
      if (!id) {
        get().pushMessage({ role: 'system', text: '当前没有可停止的任务，请先选中正在执行的节点。' });
        return;
      }
      const controller = deps.activeTaskAbortControllers.get(id);
      const node = get().nodes.find((item) => item.id === id);
      if (!controller) {
        if (node?.type === 'textNode' && node.data.status === 'IN_PROGRESS') {
          get().patchNodeData(id, recoverInterruptedTextPolish(node.data), true);
          get().pushMessage({
            role: 'system',
            text: '已清理失去请求连接的文本润色任务，原文已恢复为可编辑状态。',
            nodeId: id,
          });
          return;
        }
        get().pushMessage({
          role: 'system',
          text: '当前节点没有正在执行的任务。',
          nodeId: id,
        });
        return;
      }
      controller.abort();
      if (node?.type === 'textNode' && node.data.status === 'IN_PROGRESS') {
        get().patchNodeData(
          id,
          {
            status: (node.data.raw_text ?? node.data.input ?? '').trim() ? 'APPROVED' : 'NOT_STARTED',
            generation_error: undefined,
            streaming_preview: undefined,
            text_polish_started_at: undefined,
          },
          true,
        );
      }
      get().pushMessage({
        role: 'system',
        text: deps.stopTaskMessage,
        nodeId: id,
      });
    },

    retryPipeline: (id) => {
      const node = get().nodes.find((item) => item.id === id);
      if (!node || node.data.status !== 'REJECTED') return;
      if (
        node.data.type !== 'writing' &&
        node.data.type !== 'storyboard' &&
        node.data.type !== 'prompt'
      ) {
        return;
      }
      get().pushMessage({
        role: 'broadcast',
        text: `${rerunLabel(node.data.type)} 已开始重新生成，正在按当前输入重新执行。`,
        nodeId: id,
      });
      void get().executeNodeTask(id);
    },

    regenerateNode: (id) => {
      const node = get().nodes.find((item) => item.id === id);
      if (!node || node.type !== 'department') return;
      if (
        node.data.type !== 'writing' &&
        node.data.type !== 'storyboard' &&
        node.data.type !== 'prompt'
      ) {
        return;
      }
      if (node.data.status === 'IN_PROGRESS') {
        get().pushMessage({
          role: 'system',
          text: '当前节点正在执行中，请先等待完成或先停止任务。',
          nodeId: id,
        });
        return;
      }
      if (node.data.status === 'REJECTED') {
        get().retryPipeline(id);
        return;
      }
      if (node.data.type === 'storyboard') {
        const child = get().nodes.find(
          (candidate) =>
            candidate.type === 'shotList' &&
            candidate.data.type === 'shot_list_node' &&
            candidate.data.sourceStoryboardNodeId === id,
        );
        const current = child?.data.output;
        const aiSnapshot = child?.data.storyboard_ai_snapshot;
        const hasManualChanges =
          Boolean(current) &&
          (!aiSnapshot || JSON.stringify(current) !== JSON.stringify(aiSnapshot));
        if (child && hasManualChanges) {
          const confirmed = window.confirm(
            '当前分镜表包含手工修改。继续后会先创建一份独立备份，再用新生成结果更新当前分镜表。是否继续？',
          );
          if (!confirmed) return;
          const [backupId] = get().duplicateNodesByIds([child.id]);
          if (backupId) {
            get().patchNodeData(
              backupId,
              {
                label: `${child.data.label} · 重生成备份`,
                sourceStoryboardNodeId: undefined,
                sourceStoryboardFileNodeId: undefined,
              },
              false,
            );
            get().pushMessage({
              role: 'system',
              text: '已创建当前手工分镜表的独立备份，新生成结果不会覆盖该备份。',
              nodeId: backupId,
            });
          }
        }
      }
      get().pushMessage({
        role: 'broadcast',
        text: `${rerunLabel(node.data.type)} 已开始重新生成，正在按当前输入重新执行。`,
        nodeId: id,
      });
      void get().executeNodeTask(id, { force: true });
    },
  };
}
