import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import type {
  StoryboardOutput,
  StudioNodeData,
  TextNodeSemanticRole,
} from '@/types/studio';

export type ResolvedTextNodeRole = Exclude<TextNodeSemanticRole, 'auto'>;

export type TextNodeContextBlock = {
  nodeId: string;
  label: string;
  role: ResolvedTextNodeRole;
  text: string;
};

const PROJECT_LABEL_RE =
  /项目|总规范|全局|基础设定|统一设定|视觉规范|摄影规范|镜头规范|风格规范|约束|project|bible|spec/i;
const STORY_LABEL_RE =
  /剧本|正文|场次|剧情|分镜内容|对白|台词|脚本|story|script|scene/i;
const REFERENCE_LABEL_RE =
  /参考|资料|备注|灵感|reference|note/i;
const PROJECT_CONTENT_RE =
  /(?:画幅|宽银幕|比例|摄影机|镜头体系|焦段|光圈|景深|flare|炫光|镜头光斑|色彩基调|灯光基调|固定光源|日内|日外|夜内|夜外|必须|禁止|统一保持|全片|全局)/i;
const STORY_CONTENT_RE =
  /(?:第.{0,8}场|场景\s*\d+|镜头\s*\d+|人物|角色|动作|对白|台词|内景|外景|INT\.|EXT\.)/i;

function cleanLabel(value: string | undefined): string {
  return (value ?? '文本卡片')
    .replace(/[\r\n【】]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80) || '文本卡片';
}

export function inferTextNodeSemanticRole(
  data: Pick<StudioNodeData, 'label' | 'raw_text' | 'input' | 'text_node_role'>,
): ResolvedTextNodeRole {
  if (data.text_node_role && data.text_node_role !== 'auto') return data.text_node_role;
  const label = cleanLabel(data.label);
  const text = String(data.raw_text ?? data.input ?? '').trim();
  if (PROJECT_LABEL_RE.test(label)) return 'project_constraints';
  if (STORY_LABEL_RE.test(label)) return 'story_content';
  if (REFERENCE_LABEL_RE.test(label)) return 'reference_notes';
  if (PROJECT_CONTENT_RE.test(text) && !STORY_CONTENT_RE.test(text)) return 'project_constraints';
  if (STORY_CONTENT_RE.test(text)) return 'story_content';
  return 'reference_notes';
}

function textNodeBlock(node: StudioRFNode): TextNodeContextBlock | null {
  if (node.type !== 'textNode') return null;
  const text = String(node.data.raw_text ?? node.data.input ?? '').trim();
  if (!text) return null;
  return {
    nodeId: node.id,
    label: cleanLabel(node.data.label),
    role: inferTextNodeSemanticRole(node.data),
    text,
  };
}

function incomingTextNodeIds(textId: string, nodes: StudioRFNode[], edges: Edge[]): string[] {
  return edges
    .filter(
      (edge) =>
        edge.target === textId &&
        (edge.targetHandle == null || edge.targetHandle === 'in'),
    )
    .map((edge) => edge.source)
    .filter((sourceId) => nodes.some((node) => node.id === sourceId && node.type === 'textNode'))
    .sort((a, b) => a.localeCompare(b));
}

function collectFromTextNode(
  textId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
  visited: Set<string>,
  active: Set<string>,
  out: TextNodeContextBlock[],
): void {
  if (visited.has(textId) || active.has(textId)) return;
  active.add(textId);
  for (const upstreamId of incomingTextNodeIds(textId, nodes, edges)) {
    collectFromTextNode(upstreamId, nodes, edges, visited, active, out);
  }
  active.delete(textId);
  visited.add(textId);
  const node = nodes.find((item) => item.id === textId);
  if (!node) return;
  const block = textNodeBlock(node);
  if (block) out.push(block);
}

export function collectTextNodeContextForNode(
  textId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
  options: { includeSelf?: boolean } = {},
): TextNodeContextBlock[] {
  const out: TextNodeContextBlock[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  if (options.includeSelf === false) {
    for (const upstreamId of incomingTextNodeIds(textId, nodes, edges)) {
      collectFromTextNode(upstreamId, nodes, edges, visited, active, out);
    }
  } else {
    collectFromTextNode(textId, nodes, edges, visited, active, out);
  }
  return out;
}

export function collectTextNodeContextForDepartment(
  departmentId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): TextNodeContextBlock[] {
  const directTextIds = edges
    .filter(
      (edge) =>
        edge.target === departmentId &&
        (edge.targetHandle == null || edge.targetHandle === 'in'),
    )
    .map((edge) => edge.source)
    .filter((sourceId) => nodes.some((node) => node.id === sourceId && node.type === 'textNode'))
    .sort((a, b) => a.localeCompare(b));
  const out: TextNodeContextBlock[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const textId of directTextIds) {
    collectFromTextNode(textId, nodes, edges, visited, active, out);
  }
  return out;
}

const ROLE_HEADER: Record<ResolvedTextNodeRole, string> = {
  project_constraints: '项目约束',
  story_content: '分镜正文',
  reference_notes: '参考资料',
};

export function serializeTextNodeContext(blocks: TextNodeContextBlock[]): string {
  return blocks
    .map((block) => `【${ROLE_HEADER[block.role]}｜${block.label}】\n${block.text}`)
    .join('\n\n');
}

export function extractProjectConstraintsFromTaggedText(raw: string): string[] {
  const text = raw.replace(/\r/g, '');
  const pattern =
    /【项目约束｜([^】]+)】\n([\s\S]*?)(?=\n\n【(?:项目约束|分镜正文|参考资料)｜|$)/g;
  const constraints: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const label = cleanLabel(match[1]);
    const body = String(match[2] ?? '').trim();
    if (!body) continue;
    constraints.push(`${label}：${body}`);
  }
  return Array.from(new Set(constraints));
}

function compactConstraintSummary(constraints: string[], maxLength = 900): string {
  const compact = constraints
    .map((constraint) => constraint.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('；');
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 23)).trimEnd()}…（完整约束见 projectConstraints）`;
}

/**
 * 项目约束保持独立根字段，同时在每条镜头 note 中放置精简的跨镜约束标记。
 * 这样 Prompt 可读取完整规范，分镜表也能直接看到该镜头继承了哪些全局规则。
 */
export function applyProjectConstraintsToStoryboardOutput(
  output: StoryboardOutput,
  inputConstraints: string[] = [],
): StoryboardOutput {
  const projectConstraints = Array.from(
    new Set(
      [...(output.projectConstraints ?? []), ...inputConstraints]
        .map((constraint) => constraint.trim())
        .filter(Boolean),
    ),
  );
  if (projectConstraints.length === 0) return output;

  const marker = `项目约束（跨镜）：${compactConstraintSummary(projectConstraints)}`;
  return {
    ...output,
    projectConstraints,
    shots: output.shots.map((shot) => {
      const note = shot.note?.trim() ?? '';
      if (note.includes('项目约束（跨镜）')) return shot;
      return {
        ...shot,
        note: note ? `${note}\n${marker}` : marker,
      };
    }),
  };
}
