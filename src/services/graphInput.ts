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
import {
  collectTextNodeContextForDepartment,
  collectTextNodeContextForNode,
  serializeTextNodeContext,
} from '@/utils/textNodeContext';
import {
  buildImageTextAlignmentInstruction,
  inferImageReferenceKind,
  resolveImageReferenceName,
  type NamedTextReference,
} from '@/utils/imageReferenceNaming';
import {
  hasDepartmentInputConnections,
  hasUsableImageReference,
  resolveFreshDepartmentInput,
} from '@/utils/departmentInputFreshness';

export { hasDepartmentInputConnections } from '@/utils/departmentInputFreshness';

export const DEPT_OUTPUT_HANDLE_ID = 'out' as const;

function stringifyPromptShotListPayload(
  shots: StoryboardOutput['shots'],
  narrativeBeats?: string[],
  projectConstraints?: string[],
): string | null {
  try {
    const payload: {
      shots: StoryboardOutput['shots'];
      narrativeBeats?: string[];
      projectConstraints?: string[];
    } = { shots };
    if (narrativeBeats != null) payload.narrativeBeats = narrativeBeats;
    if (projectConstraints?.length) payload.projectConstraints = projectConstraints;
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
  if (picked.length === 1) {
    return stringifyPromptShotListPayload(
      [picked[0]],
      undefined,
      canonical.projectConstraints,
    );
  }
  const merged = mergeStoryboardShotSlice(picked);
  return stringifyPromptShotListPayload([merged], [
    `多镜头组合：${picked.map((shot) => `#${shot.id}`).join(' + ')}`,
  ], canonical.projectConstraints);
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
            projectConstraints: canonical.projectConstraints ?? [],
          });
        }
        return JSON.stringify({
          shots: o.shots,
          narrativeBeats: o.narrativeBeats ?? [],
          projectConstraints: o.projectConstraints ?? [],
        });
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
      const reviewText = seedanceCards || formatPrompt(o).trim();
      // 审核节点只承接并呈现 Prompt 节点已经生成、校验和解析完成的结果。
      // 不在连线阶段重新补挂载、重排 token 或清洗正文，避免破坏当前 Skill 的格式。
      return reviewText || null;
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
          projectConstraints: canonical.projectConstraints ?? [],
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
    return stringifyPromptShotListPayload(
      canonical.shots,
      canonical.narrativeBeats,
      canonical.projectConstraints,
    );
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

export function connectedImageNodesForDepartment(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): StudioRFNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const incoming = edges.filter(
    (e) =>
      e.target === deptId &&
      (e.targetHandle == null || e.targetHandle === 'in') &&
      (e.sourceHandle == null || e.sourceHandle === DEPT_OUTPUT_HANDLE_ID),
  );
  return incoming
    .map((edge) => nodeById.get(edge.source))
    .filter((node): node is StudioRFNode => {
      if (!node) return false;
      return node.type === 'imageNode' && node.data.type === 'image_node';
    });
}

function imageNodeAsStoryboardReferenceText(
  node: StudioRFNode,
  index: number,
  textReferences: NamedTextReference[] = [],
): string | null {
  if (node.type !== 'imageNode' || node.data.type !== 'image_node') return null;
  // A cached summary is only valid while its source image still exists. Without this guard,
  // clearing an image can keep feeding the previous visual analysis into regeneration.
  if (!hasUsableImageReference(node.data)) return null;
  const label = resolveImageReferenceName(node.data, `场景参考图 ${index + 1}`);
  const fileName = node.data.imageFileName?.trim();
  const summary = node.data.imageAnalysisSummary?.trim();
  const referenceKind = inferImageReferenceKind(node.data);
  const alignment = buildImageTextAlignmentInstruction(node.data, textReferences);
  if (referenceKind === 'blocking') {
    return [
      `【场景角色站位图 ${index + 1}】${label}${fileName ? `（原文件：${fileName}）` : ''}`,
      alignment,
      summary
        ? `站位与空间分析：${summary}`
        : '站位与空间分析：待视觉模型读取。必须识别角色相对位置、前中后景、朝向与视线、摄影轴线、出入口、运动方向、动线和可持续到后续镜头的落幅状态。',
      '执行优先级：文本节点决定剧情事实、人物身份与明确动作；站位图决定不冲突部分的空间关系、屏幕方向和连续性。若二者冲突，必须保留文本并在镜头 note 中标记“站位图冲突”。',
      '隔离规则：站位图不得承担角色外观、服装、场景美术和灯光色彩职责；这些信息只能由各自同名角色图、场景图或色表提供。',
    ].join('\n');
  }
  if (referenceKind === 'character' || referenceKind === 'prop' || referenceKind === 'palette') {
    const kindLabel =
      referenceKind === 'character'
        ? '角色参考图'
        : referenceKind === 'prop'
          ? '道具参考图'
          : '灯光色表';
    const analysisLabel =
      referenceKind === 'character'
        ? '角色外观分析'
        : referenceKind === 'prop'
          ? '道具外观分析'
          : '灯光色彩分析';
    return [
      `【${kindLabel} ${index + 1}】${label}${fileName ? `（原文件：${fileName}）` : ''}`,
      alignment,
      summary
        ? `${analysisLabel}：${summary}`
        : `${analysisLabel}：待视觉模型读取。只提取该素材职责范围内可见且与文本不冲突的信息。`,
      '职责隔离：禁止把本图职责之外的人物、场景、道具、构图事件或剧情事实带入其他主体。',
    ].join('\n');
  }
  return [
    `【视觉场景参考图 ${index + 1}】${label}${fileName ? `（${fileName}）` : ''}`,
    alignment,
    summary
      ? `图片场景分析：${summary}`
      : '图片场景分析：待视觉模型读取。执行分镜时必须先识别这张图，再把图中可见的时间地点、空间结构、光影色彩、场景质感、人物/道具/建筑关系，以及具有物理来源的环境动态作为硬约束。',
    '分镜硬约束：后续镜头必须继承参考图的场景基调、空间方向、光影色彩、可见道具/建筑/环境元素与气氛；不得生成与参考图明显冲突的地点、时代、天气、色彩或美术风格。',
    '场景动态协议：将图中信息区分为“持续动态 / 情节触发 / 静态锁定”。每镜按剧情需要最多选择一个主要环境反应，并可保留少量低强度背景运动；烟雾、蒸汽、尘埃、风、水、火花、机械与反射必须遵守来源、气流、重力、惯性、遮挡和衰减规律，禁止所有元素同时运动。',
    '灯光触发协议：固定照明默认保持稳定；只有故障、报警、断电、冲击、设备启动、旋转灯、火焰或移动遮挡等明确原因才能闪烁、扫动或改变亮度，变化必须服务当前情节并写清触发与落幅。镜头耀斑只随摄影机、光源和遮挡相对位置变化，不得当作灯具随机闪烁。',
  ].join('\n');
}

export function isPromptColorReferenceImage(node: StudioRFNode): boolean {
  if (node.type !== 'imageNode' || node.data.type !== 'image_node') return false;
  if (inferImageReferenceKind(node.data) === 'palette') return true;
  if (node.data.imageNodeMode === 'palette') return true;
  if (node.data.imageColorAnalysisSummary?.trim()) return true;
  const metadata = [node.data.label, node.data.imageFileName].filter(Boolean).join(' ');
  return /(?:灯光)?色表|调色板|color\s*(?:chart|palette)|palette/i.test(metadata);
}

function imageNodeAsPromptSceneReferenceText(
  node: StudioRFNode,
  index: number,
  textReferences: NamedTextReference[] = [],
): string | null {
  const storyboardReference = imageNodeAsStoryboardReferenceText(node, index, textReferences);
  if (!storyboardReference) return null;
  return storyboardReference
    .replace(`【视觉场景参考图 ${index + 1}】`, `【Prompt 视觉场景参考图 ${index + 1}】`)
    .replace('执行分镜时必须先识别这张图', '生成提示词前必须先识别这张图')
    .replace('分镜硬约束：后续镜头', '提示词视觉硬约束：当前镜头')
    .replace('每镜按剧情需要', '当前镜头按剧情需要');
}

export function imageNodeAsPromptColorReferenceText(
  node: StudioRFNode,
  index: number,
  textReferences: NamedTextReference[] = [],
): string | null {
  if (node.type !== 'imageNode' || node.data.type !== 'image_node') return null;
  if (!hasUsableImageReference(node.data)) return null;
  if (!isPromptColorReferenceImage(node)) return null;
  const label = resolveImageReferenceName(node.data, `色彩表 ${index + 1}`);
  const fileName = node.data.imageFileName?.trim();
  const summary = node.data.imageColorAnalysisSummary?.trim();
  return [
    `【色彩表参考图 ${index + 1}】${label}${fileName ? `（${fileName}）` : ''}`,
    buildImageTextAlignmentInstruction(node.data, textReferences),
    summary
      ? `色彩与灯光分析：${summary}`
      : '色彩与灯光分析：待视觉模型读取。生成提示词前必须先识别主色底、辅助色、点睛色、冷暖关系、明暗层次、对比度、高光、暗部和光线软硬。',
    '色彩表用途约束：本图只控制“灯光布置与基调”以及 Engine Prompt 中必要的色彩光影结果；不得把图中人物、场景、道具、文字或构图事件带入当前镜头。',
    '挂载约束：色彩表属于“仅作灯光与色彩参考”，禁止进入挂载，禁止替换源分镜中的角色、场景、道具和剧情事实。',
  ].join('\n');
}

export function mergedTextInputForDepartment(
  deptId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const consumerNode = nodeById.get(deptId);
  const consumerKind: NodeKind | null =
    consumerNode?.type === 'department' ? consumerNode.data.type : null;
  const incoming = edges.filter(
    (e) => e.target === deptId && (e.targetHandle === 'in' || e.targetHandle == null),
  );
  const sorted = [...incoming].sort((x, y) => x.source.localeCompare(y.source));

  const hasPromptShotListSource =
    consumerKind === 'prompt' &&
    sorted.some((e) => {
      const src = nodeById.get(e.source);
      return (
        src?.type === 'shotList' &&
        src.data.type === 'shot_list_node' &&
        parseShotListItemOutputHandleId(e.sourceHandle) != null
      );
    });

  const promptShotSelections = new Map<string, string[]>();
  const parts: string[] = [];
  const imageRefs =
    consumerKind === 'storyboard' || consumerKind === 'prompt'
      ? connectedImageNodesForDepartment(deptId, nodes, edges)
      : [];
  const textContextBlocks = collectTextNodeContextForDepartment(deptId, nodes, edges);
  const textContext = serializeTextNodeContext(textContextBlocks);
  if (textContext) {
    parts.push(
      [
        '【串联文本输入协议】“项目约束”是跨镜硬约束；“分镜正文”提供剧情、人物与动作；“参考资料”仅作补充，不得覆盖前两者。',
        textContext,
      ].join('\n'),
    );
  }
  for (const e of sorted) {
    const src = nodeById.get(e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      continue;
    } else if (src.type === 'imageNode') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const index = Math.max(0, imageRefs.findIndex((item) => item.id === src.id));
      const block =
        consumerKind === 'storyboard'
          ? imageNodeAsStoryboardReferenceText(src, index, textContextBlocks)
          : consumerKind === 'prompt'
            ? isPromptColorReferenceImage(src)
              ? imageNodeAsPromptColorReferenceText(src, index, textContextBlocks)
              : imageNodeAsPromptSceneReferenceText(src, index, textContextBlocks)
            : null;
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'storyboardFile') {
      if (e.sourceHandle != null && e.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
      const block = departmentAssetAsInputText(src.data, consumerKind);
      if (block != null && block.length > 0) parts.push(block);
    } else if (src.type === 'shotList') {
      if (src.data.type !== 'shot_list_node') continue;
      const parentId = src.data.sourceStoryboardNodeId;
      const parent = parentId
        ? nodeById.get(parentId)
        : null;
      if (
        parent?.type === 'department' &&
        parent.data.type === 'storyboard' &&
        parent.data.status !== 'APPROVED'
      ) {
        continue;
      }
      const pickedWireId = parseShotListItemOutputHandleId(e.sourceHandle);
      if (consumerKind === 'prompt' && pickedWireId) {
        const bucket = promptShotSelections.get(src.id) ?? [];
        if (!bucket.includes(pickedWireId)) bucket.push(pickedWireId);
        promptShotSelections.set(src.id, bucket);
      }
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
      const src = nodeById.get(shotListNodeId);
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
  const serialized = serializeTextNodeContext(
    collectTextNodeContextForDepartment(deptId, nodes, edges),
  );
  return serialized || null;
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
  const textContext = serializeTextNodeContext(
    collectTextNodeContextForNode(textId, nodes, edges, { includeSelf: false }),
  );
  if (textContext) parts.push(textContext);
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      continue;
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
  const textContext = serializeTextNodeContext(
    collectTextNodeContextForDepartment(reviewNodeId, nodes, edges),
  );
  if (textContext) parts.push(textContext);
  for (const e of sorted) {
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    if (src.type === 'textNode') {
      continue;
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
  const departmentNode = nodes.find((node) => node.id === deptId);
  const preferManualInput =
    departmentNode?.type === 'department' && departmentNode.data.inputSource === 'manual';
  // Once a graph input is connected it is the source of truth, including the empty state.
  // Falling back here resurrects the department's previously persisted graph snapshot after
  // an upstream text/image is cleared or removed.
  return resolveFreshDepartmentInput(
    merged,
    fallbackInput ?? '',
    hasDepartmentInputConnections(deptId, edges),
    preferManualInput,
  );
}
