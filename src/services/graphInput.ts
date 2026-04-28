/**
 * 部门 Input 端口：沿连线合并 TEXT_NODE / 上游部门 Output 文本。
 * 与画布 DepartmentNode 右侧 Output 句柄 id 一致。
 */
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import type { NodeKind, PromptOutput, StoryboardOutput, StudioNodeData, WritingOutput } from '@/types/studio';
import { formatPrompt, formatSeedanceCards } from '@/utils/promptFormat';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';
import { mergeStoryboardShotSlice } from '@/utils/storyboardSeedance';

export const DEPT_OUTPUT_HANDLE_ID = 'out' as const;

function stringifyPromptShotListPayload(
  shots: StoryboardOutput['shots'],
  narrativeBeats?: string[],
): string | null {
  try {
    const payload: { shots: StoryboardOutput['shots']; narrativeBeats?: string[] } = { shots };
    if (narrativeBeats != null) payload.narrativeBeats = narrativeBeats;
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function buildPromptSelectionFromShotList(
  data: StudioNodeData,
  selectedWireIds: string[],
): string | null {
  if (data.type !== 'shot_list_node') return null;
  const canonical = tryParseStoryboardOutput(data.output);
  if (!canonical?.shots?.length) return null;
  const picked = canonical.shots.filter((shot) => selectedWireIds.includes(shot.wireId ?? ''));
  if (picked.length === 0) return null;
  if (picked.length === 1) return stringifyPromptShotListPayload([picked[0]]);
  const merged = mergeStoryboardShotSlice(picked);
  return stringifyPromptShotListPayload([merged], [
    `多镜头组合：${picked.map((shot) => `#${shot.id}`).join(' + ')}`,
  ]);
}

/** 将上游部门节点的 `output` 转为可写入下游 `input` 的纯文本 */
export function departmentAssetAsInputText(
  data: StudioNodeData,
  consumer: NodeKind | null = null,
): string | null {
  /** 仅已通过终审的部门产出可经 Output 端口供下游合并（未 APPROVED 不向外输出资产） */
  if (data.type === 'writing' || data.type === 'storyboard' || data.type === 'prompt') {
    const promptReviewCanReadDraft = data.type === 'prompt' && consumer === 'prompt_review_node';
    if (data.status !== 'APPROVED' && !promptReviewCanReadDraft) return null;
  }
  if (!data.output || typeof data.output !== 'object') return null;
  if (data.type === 'writing') {
    const o = data.output as WritingOutput;
    if (!Array.isArray(o.episodes) || !Array.isArray(o.scenes)) return null;
    /** 分镜节点连接编剧时：传递结构化 scenes，供分镜 AI 识别 output_data.scenes */
    if (consumer === 'storyboard') {
      try {
        return JSON.stringify({
          scenes: o.scenes,
          episodes: o.episodes,
          plannedEpisodeCount: o.plannedEpisodeCount,
        });
      } catch {
        return null;
      }
    }
    const lines: string[] = [];
    for (const ep of o.episodes) {
      lines.push(`【${ep.title}】${ep.summary}`);
    }
    for (const sc of o.scenes) {
      const en = sc.episodeNo != null ? `第${sc.episodeNo}集` : '';
      const conflict = sc.coreConflict ?? sc.beat ?? '';
      const roles = sc.characters?.length ? `｜角色：${sc.characters.join('、')}` : '';
      lines.push(`${en}场${sc.sceneNo} ${sc.title}：${conflict}${roles}`);
    }
    return lines.join('\n') || null;
  }
  if (data.type === 'storyboard') {
    const o = data.output as StoryboardOutput;
    if (!Array.isArray(o.shots)) return null;
    if (consumer === 'prompt') {
      try {
        /** 规范化为与分镜表 UI 一致的协议字段，确保含用户手改后的 description / content */
        const canonical = tryParseStoryboardOutput(data.output);
        if (canonical) {
          return JSON.stringify({
            shots: canonical.shots,
            narrativeBeats: canonical.narrativeBeats ?? [],
          });
        }
        return JSON.stringify({ shots: o.shots, narrativeBeats: o.narrativeBeats ?? [] });
      } catch {
        return null;
      }
    }
    const lines = o.shots.map((s) => {
      const vis = s.description ?? '';
      return `镜头${s.id} ${vis}`.trim();
    });
    return lines.filter(Boolean).join('\n\n') || null;
  }
  if (data.type === 'prompt') {
    const o = data.output as PromptOutput;
    if (typeof o.userTemplate !== 'string') return null;
    if (consumer === 'prompt_review_node') {
      const seedanceCards =
        Array.isArray(o.shotPrompts) && o.shotPrompts.length > 0
          ? formatSeedanceCards(o.shotPrompts, null).trim()
          : '';
      return seedanceCards || formatPrompt(o).trim() || null;
    }
    const shotBlock =
      Array.isArray(o.shotPrompts) && o.shotPrompts.length > 0
        ? o.shotPrompts
            .map(
              (sp) =>
                `[${sp.shot_id}]\nprompt: ${sp.prompt}\nnegative_prompt: ${sp.negative_prompt}`,
            )
            .join('\n\n')
        : '';
    const parts = [
      o.userTemplate,
      shotBlock ? `shotPrompts:\n${shotBlock}` : '',
      typeof o.system === 'string' && o.system ? `system:\n${o.system}` : '',
      o.negative ? `negative:\n${o.negative}` : '',
    ].filter(Boolean);
    return parts.join('\n\n') || null;
  }
  /** 镜头表子节点：与分镜同结构的最终手改版本，供 Prompt 解析（不依赖父分镜终审态） */
  if (data.type === 'storyboard_file_node') {
    const canonical = tryParseStoryboardOutput(data.output);
    if (!canonical?.shots?.length) return null;
    if (consumer === 'prompt') {
      try {
        return JSON.stringify({
          shots: canonical.shots,
          narrativeBeats: canonical.narrativeBeats ?? [],
        });
      } catch {
        return null;
      }
    }
    return canonical.shots.map((shot) => `镜头${shot.id} ${shot.description}`).join('\n\n');
  }
  if (data.type === 'shot_list_node') {
    if (consumer !== 'prompt') return null;
    const canonical = tryParseStoryboardOutput(data.output);
    if (!canonical?.shots?.length) return null;
    return stringifyPromptShotListPayload(canonical.shots);
  }
  if (data.type === 'prompt_review_node') {
    const text =
      typeof data.output === 'object' && data.output && typeof (data.output as { text?: unknown }).text === 'string'
        ? (data.output as { text: string }).text
        : (data.raw_text ?? data.input ?? '');
    return text.trim() || null;
  }
  return null;
}

export function mergedTextInputForDepartment(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const consumerNode = nodes.find((n) => n.id === deptId);
  const consumerKind: NodeKind | null =
    consumerNode?.type === 'department' ? consumerNode.data.type : null;
  const incoming = edges.filter(
    (e) => e.target === deptId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((x, y) => x.source.localeCompare(y.source));

  const hasPromptShotListSource =
    consumerKind === 'prompt' &&
    sorted.some((e) => {
      const src = nodes.find((n) => n.id === e.source);
      return (
        src?.type === 'shotList' &&
        src.data.type === 'shot_list_node' &&
        (e.sourceHandle == null ||
          e.sourceHandle === DEPT_OUTPUT_HANDLE_ID ||
          parseShotListItemOutputHandleId(e.sourceHandle) != null)
      );
    });

  const promptShotSelections = new Map<string, string[]>();
  const parts: string[] = [];
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      parts.push(src.data.raw_text ?? src.data.input ?? '');
    } else if (src.type === 'storyboardFile') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, consumerKind);
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'shotList') {
      if (src.data.type !== 'shot_list_node') continue;
      const pickedWireId = parseShotListItemOutputHandleId(e.sourceHandle);
      if (consumerKind === 'prompt' && pickedWireId) {
        const bucket = promptShotSelections.get(src.id) ?? [];
        if (!bucket.includes(pickedWireId)) bucket.push(pickedWireId);
        promptShotSelections.set(src.id, bucket);
        continue;
      }
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, consumerKind);
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'department') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      if (hasPromptShotListSource && src.data.type === 'storyboard') continue;
      const block = departmentAssetAsInputText(src.data, consumerKind);
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'promptReview') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, consumerKind);
      if (block != null && block.length > 0) parts.push(block);
    }
  }
  if (consumerKind === 'prompt' && promptShotSelections.size > 0) {
    for (const [shotListNodeId, selectedWireIds] of promptShotSelections) {
      const src = nodes.find((n) => n.id === shotListNodeId);
      if (!src || src.type !== 'shotList') continue;
      const block = buildPromptSelectionFromShotList(src.data, selectedWireIds);
      if (block != null && block.length > 0) parts.push(block);
    }
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

/** 仅合并连入编剧（等）部门 Input 的 TEXT_NODE 文本，供「对比模式」左侧小说原文 */
export function mergedTextNodeSourcesForDepartment(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const incoming = edges.filter(
    (e) => e.target === deptId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((x, y) => x.source.localeCompare(y.source));
  const parts: string[] = [];
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src || src.type !== 'textNode') continue;
    parts.push(src.data.raw_text ?? src.data.input ?? '');
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

export function mergedUpstreamForTextNode(
  textId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const incoming = edges.filter(
    (e) => e.target === textId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((a, b) => a.source.localeCompare(b.source));
  const parts: string[] = [];
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      parts.push(src.data.raw_text ?? src.data.input ?? '');
    } else if (src.type === 'storyboardFile') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, 'text_node');
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'department') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, 'text_node');
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'promptReview') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, 'text_node');
      if (block != null && block.length > 0) parts.push(block);
    }
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

export function mergedUpstreamForPromptReviewNode(
  reviewNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const incoming = edges.filter(
    (e) => e.target === reviewNodeId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((a, b) => a.source.localeCompare(b.source));
  const parts: string[] = [];
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      const text = src.data.raw_text ?? src.data.input ?? '';
      if (text.trim()) parts.push(text);
    } else if (src.type === 'department') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, 'prompt_review_node');
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'promptReview') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, 'prompt_review_node');
      if (block != null && block.length > 0) parts.push(block);
    }
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

/** 面板/校验用：有连入则取合并文本，否则用节点当前 input（无连线时保留手动正文） */
export function resolveDepartmentTaskText(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
  fallbackInput: string,
): string {
  const merged = mergedTextInputForDepartment(deptId, nodes, edges);
  if (merged !== null) return merged.trim();
  return (fallbackInput ?? '').trim();
}

/**
 * 流水线执行专用：只要 Input 端口能合并出文本（TEXT_NODE / 上游部门），始终使用连线侧最新内容，
 * 不因「手动粘贴」而忽略已连接的 TEXT_NODE。
 */
export function resolveDepartmentExecutionInput(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
  fallbackInput: string,
): string {
  const merged = mergedTextInputForDepartment(deptId, nodes, edges);
  if (merged !== null && merged.trim() !== '') return merged.trim();
  return (fallbackInput ?? '').trim();
}
