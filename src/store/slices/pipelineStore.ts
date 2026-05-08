import type { Department } from '@/types/studio';
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
      if (!controller) {
        get().pushMessage({
          role: 'system',
          text: '当前节点没有正在执行的任务。',
          nodeId: id,
        });
        return;
      }
      controller.abort();
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
      get().pushMessage({
        role: 'broadcast',
        text: `${rerunLabel(node.data.type)} 已开始重新生成，正在按当前输入重新执行。`,
        nodeId: id,
      });
      void get().executeNodeTask(id, { force: true });
    },
  };
}
