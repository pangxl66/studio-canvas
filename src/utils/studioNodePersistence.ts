import type { Edge } from '@xyflow/react';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { normalizeMountedSkillIdsForKind } from '@/services/skillLoader';
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
  const json = JSON.stringify(
    { nodes, edges },
    (_, v) => (typeof v === 'function' ? undefined : v),
  );
  return JSON.parse(json) as { nodes: StudioRFNode[]; edges: Edge[] };
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
  if (node.type === 'shotList' && node.data.type === 'shot_list_node') {
    return {
      ...node,
      data: {
        ...node.data,
        output: normalizeStoryboardOutputValue(node.data.output),
        storyboard_ai_snapshot: normalizeStoryboardOutputValue(node.data.storyboard_ai_snapshot),
      },
    };
  }
  if (node.type === 'storyboardFile' && node.data.type === 'storyboard_file_node') {
    return {
      ...node,
      data: {
        ...node.data,
        output: normalizeStoryboardOutputValue(node.data.output),
      },
    };
  }
  if (node.type === 'imageNode' && node.data.type === 'image_node') {
    return {
      ...node,
      data: {
        ...node.data,
        output: normalizeStoryboardOutputValue(node.data.output),
      },
    };
  }
  if (node.type === 'department' && node.data.type === 'storyboard') {
    return {
      ...node,
      data: {
        ...node.data,
        mounted_skills: normalizeMountedSkillIdsForKind('storyboard', node.data.mounted_skills ?? []),
        output: normalizeStoryboardOutputValue(node.data.output) as StudioNodeData['output'],
      },
    };
  }
  if (
    node.type === 'department' &&
    (node.data.type === 'writing' || node.data.type === 'prompt')
  ) {
    return {
      ...node,
      data: {
        ...node.data,
        mounted_skills: normalizeMountedSkillIdsForKind(node.data.type, node.data.mounted_skills ?? []),
      },
    };
  }
  return node;
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
