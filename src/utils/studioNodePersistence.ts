import type { Edge } from '@xyflow/react';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import {
  DEFAULT_STORYBOARD_SKILL_ID,
  normalizeFilmStoryboardSkillId,
  normalizeMountedSkillIdsForKind,
} from '@/services/skillLoader';
import type { StoryboardOutput, StudioNodeData } from '@/types/studio';
import type { StudioRFNode } from '@/types/reactFlow';

/** 持久化恢复后由 store 注入，供节点 / 右键菜单调用；勿依赖 JSON 往返保留 */
export type StudioPersistenceRuntimeApi = {
  executeNodeTask: (id: string) => Promise<void>;
  focusNode: (id: string, opts?: { openDetail?: boolean }) => void;
  removeNodesByIds: (ids: string[]) => void;
};

/** 深度剔除函数与 undefined，得到可 JSON 化的纯数据（避免误挂在 data 上的方法进入存档） */
export function stripFunctionsDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return undefined as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripFunctionsDeep(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === 'function') continue;
    out[key] = stripFunctionsDeep(v);
  }
  return out as T;
}

/**
 * 与 JSON.stringify 配合：写入文件 / IndexedDB 前再走一遍，确保函数、Symbol 等不会污染存档。
 */
export function toPersistableNodesAndEdges(
  nodes: StudioRFNode[],
  edges: Edge[],
): { nodes: StudioRFNode[]; edges: Edge[] } {
  const safeNodes = nodes.map((node) => ({ ...node, data: normalizeTransientNodeData(node.data) }));
  const json = JSON.stringify(
    { nodes: safeNodes, edges },
    (_, v) => (typeof v === 'function' ? undefined : v),
  );
  return JSON.parse(json) as { nodes: StudioRFNode[]; edges: Edge[] };
}

function normalizeTransientNodeData(data: StudioNodeData): StudioNodeData {
  if (data.status !== 'IN_PROGRESS') return data;
  const hasOutput = data.output != null;
  return {
    ...data,
    status: hasOutput ? 'APPROVED' : 'NOT_STARTED',
    generation_error: '',
    streaming_preview: '',
    review_result: hasOutput ? data.review_result || '上一次运行被中断，已保留已有结果。' : '上一次运行被中断，请重新运行。',
  };
}

/** 统一分镜表 / 分镜部门的 output 与 snapshot：补全 shots、narrativeBeats，支持历史上误存成字符串的 JSON */
export function normalizeStoryboardOutputValue(raw: unknown): StoryboardOutput | null {
  if (raw == null || raw === '') return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = tryParseStoryboardOutput(v);
  if (!parsed) return null;
  return {
    shots: Array.isArray(parsed.shots) ? parsed.shots : [],
    narrativeBeats: Array.isArray(parsed.narrativeBeats) ? parsed.narrativeBeats : [],
  };
}

/** 从磁盘 / IDB 读入后：规范化镜头表与分镜 output，保证表格数组完整可渲染 */
export function normalizeRestoredStudioNode(node: StudioRFNode): StudioRFNode {
  const safeNode = { ...node, data: normalizeTransientNodeData(node.data) };
  if (safeNode.type === 'shotList' && safeNode.data.type === 'shot_list_node') {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        output: normalizeStoryboardOutputValue(safeNode.data.output),
        storyboard_ai_snapshot: normalizeStoryboardOutputValue(safeNode.data.storyboard_ai_snapshot),
      },
    };
  }
  if (safeNode.type === 'storyboardFile' && safeNode.data.type === 'storyboard_file_node') {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        output: normalizeStoryboardOutputValue(safeNode.data.output),
      },
    };
  }
  if (safeNode.type === 'imageNode' && safeNode.data.type === 'image_node') {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        output: normalizeStoryboardOutputValue(safeNode.data.output),
      },
    };
  }
  if (safeNode.type === 'videoNode' && safeNode.data.type === 'video_node') {
    return safeNode;
  }
  if (safeNode.type === 'aiFilmStoryboard' && safeNode.data.type === 'film_storyboard_node') {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        film_storyboard_skill_id: normalizeFilmStoryboardSkillId(safeNode.data.film_storyboard_skill_id),
      },
    };
  }
  if (safeNode.type === 'department' && safeNode.data.type === 'storyboard') {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        mounted_skills: normalizeMountedSkillIdsForKind(
          'storyboard',
          safeNode.data.mounted_skills ?? [DEFAULT_STORYBOARD_SKILL_ID],
        ),
        output: normalizeStoryboardOutputValue(safeNode.data.output) as StudioNodeData['output'],
      },
    };
  }
  if (
    safeNode.type === 'department' &&
    (safeNode.data.type === 'writing' || safeNode.data.type === 'prompt')
  ) {
    return {
      ...safeNode,
      data: {
        ...safeNode.data,
        mounted_skills: normalizeMountedSkillIdsForKind(safeNode.data.type, safeNode.data.mounted_skills ?? []),
      },
    };
  }
  return safeNode;
}

/**
 * 去掉 data 上残留函数后，按节点类型重新挂载 onExecute / onDelete（JSON 无法保存函数，须在载入后绑定）。
 */
export function rebindStudioNodeRuntimeHandlers(
  nodes: StudioRFNode[],
  api: StudioPersistenceRuntimeApi,
): StudioRFNode[] {
  return nodes.map((node) => {
    const id = node.id;
    const data = stripFunctionsDeep(node.data) as StudioNodeData;
    delete data.onExecute;
    delete data.onDelete;

    data.onDelete = () => api.removeNodesByIds([id]);

    if (
      node.type === 'department' &&
      (data.type === 'writing' || data.type === 'storyboard' || data.type === 'prompt')
    ) {
      data.onExecute = () => {
        api.focusNode(id, { openDetail: true });
        return api.executeNodeTask(id);
      };
    }

    return { ...node, data };
  });
}
