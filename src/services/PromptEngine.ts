import type { Edge } from '@xyflow/react';
import { PROMPT_DEPT_AGENT_SYSTEM, PROMPT_DEPT_OUTPUT_SHAPE } from '@/agents/promptDeptSpec';
import {
  STORYBOARD_DEPT_AGENT_SYSTEM,
  STORYBOARD_DEPT_OUTPUT_SHAPE,
} from '@/agents/storyboardDeptSpec';
import { WRITING_DEPT_AGENT_SYSTEM, WRITING_DEPT_OUTPUT_SHAPE } from '@/agents/writingDeptSpec';
import type { StudioRFNode } from '@/types/reactFlow';
import type { NodeKind } from '@/types/studio';
import { appendProjectContextForConsumer } from '@/services/ProjectContext';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';

export type PromptEngineGraphContext = {
  nodes: StudioRFNode[];
  edges: Edge[];
};

export type BuildFinalPromptsResult = {
  combinedSystemPrompt: string;
  combinedUserPrompt: string;
  /** 非致命提示：如无 TEXT_NODE 连入等 */
  warnings: string[];
};

type PipelineKind = Exclude<
  NodeKind,
  'text_node' | 'shot_list_node' | 'storyboard_file_node' | 'prompt_review_node' | 'image_node'
>;

function isPipelineDepartment(node: StudioRFNode): node is StudioRFNode & {
  type: 'department';
  data: { type: PipelineKind };
} {
  return node.type === 'department' && ['writing', 'storyboard', 'prompt'].includes(node.data.type);
}

function departmentBaseSystem(kind: PipelineKind): string {
  if (kind === 'writing') return WRITING_DEPT_AGENT_SYSTEM;
  if (kind === 'storyboard') return STORYBOARD_DEPT_AGENT_SYSTEM;
  return PROMPT_DEPT_AGENT_SYSTEM;
}

function departmentOutputSchema(kind: PipelineKind): string {
  if (kind === 'writing') return WRITING_DEPT_OUTPUT_SHAPE;
  if (kind === 'storyboard') return STORYBOARD_DEPT_OUTPUT_SHAPE;
  return PROMPT_DEPT_OUTPUT_SHAPE;
}

/**
 * 沿 Input 端口（targetHandle `in`）回溯，仅合并 **TEXT_NODE** 的 `raw_text` / `input`。
 * 顺序与 `mergedTextInputForDepartment` 一致（按 source id 排序后拼接）。
 */
export function collectInputFromConnectedTextNodes(
  departmentNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string {
  const incoming = edges.filter(
    (e) => e.target === departmentNodeId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((a, b) => a.source.localeCompare(b.source));
  const parts: string[] = [];
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (src?.type !== 'textNode') continue;
    const t = (src.data.raw_text ?? src.data.input ?? '').trim();
    if (t) parts.push(t);
  }
  return parts.join('\n\n').trim();
}

function appendJsonSchemaConstraint(systemSoFar: string, schema: string): string {
  const footer = [
    '',
    '【输出格式硬性要求】',
    '你必须以纯 JSON 格式输出，参考以下 Schema:',
    schema,
    '除上述 JSON 对象外不要输出任何其他文字（不要使用 markdown 代码围栏，不要前言或后记）。',
  ].join('\n');
  return `${systemSoFar}${footer}`;
}

/**
 * 为部门节点生成接入 LLM 的最终 system / user：
 * - User：Input 侧连线的 TEXT_NODE 正文合并；
 * - System：部门基础指令 + `mounted_skills` 片段 + 末尾 JSON Schema 强制约束。
 */
export function buildFinalPromptsForNode(
  currentNode: StudioRFNode,
  ctx: PromptEngineGraphContext,
): BuildFinalPromptsResult {
  const warnings: string[] = [];

  if (!isPipelineDepartment(currentNode)) {
    warnings.push('当前节点不是编剧/分镜/Prompt 部门节点，未按部门规范组装 System。');
    return {
      combinedSystemPrompt: '',
      combinedUserPrompt: '',
      warnings,
    };
  }

  const kind = currentNode.data.type;
  const mounted = Array.isArray(currentNode.data.mounted_skills) ? currentNode.data.mounted_skills : [];

  const combinedUserPrompt = collectInputFromConnectedTextNodes(currentNode.id, ctx.nodes, ctx.edges);
  if (!combinedUserPrompt) {
    warnings.push('Input 端口未连接 TEXT_NODE 或文本为空；combinedUserPrompt 为空（若需手动正文请连接 TEXT_NODE 或改用节点 data.input 的其它同步逻辑）。');
  }

  const base = departmentBaseSystem(kind);
  const { systemPrompt: withSkills } = resolveAndComposeMountedSkills(kind, base, mounted);
  const withProject =
    kind === 'storyboard' || kind === 'prompt'
      ? appendProjectContextForConsumer(withSkills, kind)
      : withSkills;
  const schema = departmentOutputSchema(kind);
  const combinedSystemPrompt = appendJsonSchemaConstraint(withProject, schema);

  return {
    combinedSystemPrompt,
    combinedUserPrompt,
    warnings,
  };
}
