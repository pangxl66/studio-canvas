import { getResolvedLlmGatewayConfig, getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import {
  buildAiFilmmakingSystemPrompt,
  buildCharacterSheetUserPrompt,
  buildStoryboardGridUserPrompt,
  normalizeStoryboardAspectRatio,
  stripAiFilmmakingPromptWrapper,
  type AiFilmStoryboardSkillPrompt,
  type AiFilmmakingPromptNodeKind,
  type AiFilmmakingSourceSummary,
  type AiFilmmakingStoryboardAspectRatio,
  type AiFilmmakingVideoMode,
} from '@/services/aiFilmmakingPrompts';
import {
  DEFAULT_STORYBOARD_SKILL_ID,
  DEFAULT_VIDEO_PROMPT_SKILL_ID,
  getSkillById,
  normalizeFilmStoryboardSkillId,
  normalizeFilmVideoPromptSkillId,
} from '@/services/skillLoader';
import {
  VIDEO_PROMPT_PREVIEW_MAX_CHARS,
  buildVideoPromptAnalysisSystemPrompt,
  buildVideoPromptAnalysisUserPrompt,
  buildVideoPromptCompositionUserPrompt,
  hashVideoPromptSource,
  parseVideoPromptImageAnalysis,
  resolveVideoPromptDurationSec,
  validateVideoPromptText,
} from '@/services/videoPromptSpec';
import type { StudioRFNode } from '@/types/reactFlow';
import type {
  StoryboardGridPanelMapping,
  StoryboardOutput,
  StoryboardShot,
  StudioNodeData,
} from '@/types/studio';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type AiFilmmakingSlice = Pick<StudioState, 'runAiFilmmakingNode'>;

type AiFilmmakingSliceDeps = {
  activeTaskAbortControllers: Map<string, AbortController>;
  stopTaskMessage: string;
};

type ImageReference = {
  nodeId: string;
  label: string;
  dataUrl?: string;
  role: 'character' | 'storyboard' | 'unknown';
  signature: string;
  panelCount?: number;
  panels?: StoryboardGridPanelMapping[];
};

export type FilmPromptSource = {
  summary: AiFilmmakingSourceSummary;
  images: ImageReference[];
  primaryImage?: ImageReference;
  videoMode?: AiFilmmakingVideoMode;
  sourceSignature: string;
  panelMappingText: string;
};

type IncomingSource = {
  node: StudioRFNode;
  sourceHandle: string | null | undefined;
};

type ResolvedFilmStoryboardSkill = AiFilmStoryboardSkillPrompt & {
  id: string;
};

type StoryboardGridTableBlock = {
  text: string;
  shotCount: number;
  durationSec: number;
};

type ResolvedFilmVideoPromptSkill = {
  id: string;
  name: string;
  version: string;
  instruction: string;
};

function featureSafeId(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, '_');
}

export const FILM_INPUT_HANDLE_ID = 'in';
export const FILM_OUTPUT_HANDLE_ID = 'out';

function textFromGeneratedPrompt(data: StudioNodeData): string {
  if (typeof data.raw_text === 'string' && data.raw_text.trim()) return data.raw_text.trim();
  if (typeof data.input === 'string' && data.input.trim()) return data.input.trim();
  const output = data.output;
  if (output && typeof output === 'object' && typeof (output as { text?: unknown }).text === 'string') {
    return (output as { text: string }).text.trim();
  }
  return '';
}

function textFromNode(node: StudioRFNode): string {
  if (node.type === 'textNode') return (node.data.raw_text ?? node.data.input ?? '').trim();
  if (
    node.type === 'aiFilmCharacter' ||
    node.type === 'aiFilmStoryboard' ||
    node.type === 'aiFilmVideoPrompt' ||
    node.data.type === 'prompt_review_node'
  ) {
    return textFromGeneratedPrompt(node.data);
  }
  if (node.type === 'department' && node.data.output && typeof node.data.output === 'object') {
    try {
      return JSON.stringify(node.data.output, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function imageRoleFromLabel(label: string): ImageReference['role'] {
  const normalized = label.toLowerCase();
  if (/九宫格|9\s*宫格|分镜|storyboard|grid|panel|board/.test(normalized)) return 'storyboard';
  if (/角色|character|sheet|reference|人物|cast/.test(normalized)) return 'character';
  return 'unknown';
}

function compactImageDataFingerprint(dataUrl?: string): string {
  if (!dataUrl) return '';
  return hashVideoPromptSource([
    String(dataUrl.length),
    dataUrl.slice(0, 96),
    dataUrl.slice(-96),
  ]);
}

function imageRefFromNode(node: StudioRFNode, nodes: StudioRFNode[]): ImageReference | null {
  if (node.type !== 'imageNode') return null;
  const label = node.data.imageFileName?.trim() || node.data.label?.trim() || '图片参考';
  const storyboardParentId = node.data.generatedFromStoryboardNodeId;
  const storyboardParent = storyboardParentId
    ? nodes.find((candidate) => candidate.id === storyboardParentId && candidate.type === 'aiFilmStoryboard')
    : undefined;
  const storyboardPage = storyboardParent?.data.storyboardGridImages?.find(
    (page) => page.pageIndex === node.data.generatedStoryboardPageIndex,
  );
  const role =
    node.data.imageDisplayMode === 'storyboard-output' || storyboardParentId
      ? 'storyboard'
      : imageRoleFromLabel(label);
  return {
    nodeId: node.id,
    label,
    dataUrl: node.data.imageDataUrl,
    role,
    signature: hashVideoPromptSource([
      node.id,
      node.data.imageAssetId ?? '',
      node.data.imageFileName ?? '',
      String(node.data.imageGenerationCompletedAt ?? node.data.imageEditCompletedAt ?? ''),
      compactImageDataFingerprint(node.data.imageDataUrl),
    ]),
    panelCount:
      storyboardPage?.panelCount ??
      (node.data.imageGenerationSourceShotIds?.length || undefined),
    panels: storyboardPage?.panels,
  };
}

function collectIncomingSources(nodeId: string, nodes: StudioRFNode[], edges: StudioState['edges']): IncomingSource[] {
  const incoming = edges.filter(
    (edge) =>
      edge.target === nodeId &&
      (edge.targetHandle == null || edge.targetHandle === FILM_INPUT_HANDLE_ID),
  );
  return incoming
    .map((edge) => {
      const node = nodes.find((item) => item.id === edge.source);
      return node ? { node, sourceHandle: edge.sourceHandle } : null;
    })
    .filter((source): source is IncomingSource => Boolean(source));
}

function storyboardOutputFromNode(node: StudioRFNode): StoryboardOutput | null {
  if (
    (node.type === 'department' && node.data.type === 'storyboard') ||
    (node.type === 'shotList' && node.data.type === 'shot_list_node') ||
    (node.type === 'storyboardFile' && node.data.type === 'storyboard_file_node')
  ) {
    return tryParseStoryboardOutput(node.data.output);
  }
  return null;
}

function pickStoryboardOutputByHandle(
  output: StoryboardOutput,
  sourceHandle?: string | null,
): StoryboardOutput | null {
  const wireId = parseShotListItemOutputHandleId(sourceHandle);
  if (wireId) {
    const generatedSeed = wireId.match(/^shotwire_(.+)_[a-z0-9]+$/i)?.[1];
    const candidates = new Set(
      [wireId, generatedSeed]
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    );
    const shot = output.shots.find((item) => {
      const itemWireId = item.wireId?.trim();
      const itemId = String(item.id).trim();
      const itemShotNo = item.shotNo?.trim();
      return (
        (itemWireId != null && candidates.has(itemWireId)) ||
        candidates.has(itemId) ||
        (itemShotNo != null && candidates.has(itemShotNo))
      );
    });
    return shot ? { shots: [shot], narrativeBeats: [] } : null;
  }
  if (sourceHandle != null && sourceHandle !== 'out') return null;
  return output;
}

function formatStoryboardShotForGrid(shot: StoryboardShot): string {
  const merged =
    Array.isArray(shot.mergedMembers) && shot.mergedMembers.length > 0
      ? `\n    mergedMembers: ${shot.mergedMembers
          .map((member) => `#${member.id} ${member.type} ${member.movement} ${member.description}`.trim())
          .join(' / ')}`
      : '';
  return [
    `#${shot.id}${shot.shotNo ? ` (${shot.shotNo})` : ''}`,
    shot.sceneRef ? `scene: ${shot.sceneRef}` : '',
    `shotSize: ${shot.type || 'medium shot'}`,
    `cameraMove: ${shot.movement || 'static'}`,
    shot.durationSec != null ? `durationSec: ${shot.durationSec}` : '',
    shot.description ? `image: ${shot.description}` : '',
    shot.action ? `action: ${shot.action}` : '',
    shot.content ? `dialogue/content: ${shot.content}` : '',
    shot.sound ? `sound: ${shot.sound}` : '',
    shot.note ? `note: ${shot.note}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
    .concat(merged);
}

function formatStoryboardTableForGrid(
  node: StudioRFNode,
  output: StoryboardOutput,
  sourceHandle?: string | null,
): StoryboardGridTableBlock | null {
  const picked = pickStoryboardOutputByHandle(output, sourceHandle);
  if (!picked?.shots?.length) return null;
  const label = node.data.label?.trim() || node.id;
  const singleShotScope = parseShotListItemOutputHandleId(sourceHandle) != null;
  const beats = !singleShotScope && picked.narrativeBeats?.length
    ? `Narrative beats:\n${picked.narrativeBeats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')}`
    : '';
  const text = [
    `Source storyboard table: ${label}`,
    singleShotScope
      ? 'Scope: one selected storyboard shot output.'
      : `Scope: full storyboard table, ${picked.shots.length} shots.`,
    beats,
    `Shots:\n${picked.shots.map(formatStoryboardShotForGrid).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const durationSec = picked.shots.reduce(
    (sum, shot) => sum + (typeof shot.durationSec === 'number' && Number.isFinite(shot.durationSec) ? Math.max(0, shot.durationSec) : 0),
    0,
  );
  return { text, shotCount: picked.shots.length, durationSec };
}

export function collectFilmPromptSource(
  nodeId: string,
  kind: AiFilmmakingPromptNodeKind,
  nodes: StudioRFNode[],
  edges: StudioState['edges'],
): FilmPromptSource {
  const sources = collectIncomingSources(nodeId, nodes, edges);
  const textBlocks: string[] = [];
  const characterPrompts: string[] = [];
  const storyboardPrompts: string[] = [];
  const storyboardTables: string[] = [];
  let storyboardPanelCount = 0;
  let storyboardDurationSec = 0;
  const images: ImageReference[] = [];
  const imageIds = new Set<string>();
  const tableKeys = new Set<string>();

  const addStoryboardTable = (
    sourceNode: StudioRFNode,
    sourceHandle?: string | null,
  ): boolean => {
    const output = storyboardOutputFromNode(sourceNode);
    if (!output) return false;
    const key = `${sourceNode.id}:${sourceHandle ?? 'out'}`;
    if (tableKeys.has(key)) return true;
    const tableBlock = formatStoryboardTableForGrid(sourceNode, output, sourceHandle);
    if (!tableBlock) return false;
    tableKeys.add(key);
    storyboardTables.push(tableBlock.text);
    storyboardPanelCount += tableBlock.shotCount;
    storyboardDurationSec += tableBlock.durationSec;
    return true;
  };

  const addImageReference = (sourceNode: StudioRFNode): ImageReference | null => {
    const image = imageRefFromNode(sourceNode, nodes);
    if (!image || imageIds.has(image.nodeId)) return image;
    imageIds.add(image.nodeId);
    images.push(image);
    if (image.role === 'storyboard' && image.panelCount) {
      storyboardPanelCount = image.panelCount;
    }
    return image;
  };

  const addStoryboardParentContext = (storyboardNode: StudioRFNode) => {
    const prompt = textFromGeneratedPrompt(storyboardNode.data);
    if (prompt && !storyboardPrompts.includes(prompt)) storyboardPrompts.push(prompt);
    for (const outputImageNodeId of storyboardNode.data.storyboardOutputImageNodeIds ?? []) {
      const outputImageNode = nodes.find((candidate) => candidate.id === outputImageNodeId);
      if (outputImageNode) addImageReference(outputImageNode);
    }
    for (const upstream of collectIncomingSources(storyboardNode.id, nodes, edges)) {
      addStoryboardTable(upstream.node, upstream.sourceHandle);
    }
  };

  for (const source of sources) {
    const shotListFullOutput =
      source.node.type === 'shotList' &&
      source.node.data.type === 'shot_list_node' &&
      parseShotListItemOutputHandleId(source.sourceHandle) == null;
    if (shotListFullOutput) continue;

    const storyboardOutput = storyboardOutputFromNode(source.node);
    if (storyboardOutput) {
      const scopedStoryboardHandle = parseShotListItemOutputHandleId(source.sourceHandle) != null;
      if (addStoryboardTable(source.node, source.sourceHandle)) continue;
      if (scopedStoryboardHandle) continue;
    }

    const image = addImageReference(source.node);
    if (image) {
      if (image.role === 'storyboard' && source.node.data.generatedFromStoryboardNodeId) {
        const parent = nodes.find(
          (candidate) => candidate.id === source.node.data.generatedFromStoryboardNodeId,
        );
        if (parent?.type === 'aiFilmStoryboard') addStoryboardParentContext(parent);
      }
      continue;
    }

    if (source.node.type === 'aiFilmStoryboard' || source.node.data.type === 'film_storyboard_node') {
      addStoryboardParentContext(source.node);
      continue;
    }

    const text = textFromNode(source.node);
    if (!text) continue;

    if (source.node.type === 'aiFilmCharacter' || source.node.data.type === 'film_character_node') {
      characterPrompts.push(text);
    } else {
      textBlocks.push(text);
    }
  }

  const characterImages = images.filter((image) => image.role === 'character');
  const storyboardImages = images.filter((image) => image.role === 'storyboard');
  const unknownImages = images.filter((image) => image.role === 'unknown');
  const orderedImages = [...characterImages, ...storyboardImages, ...unknownImages];
  const sourceText = [...textBlocks, ...characterPrompts, ...storyboardPrompts, ...storyboardTables].join('\n');

  const hasStoryboardSource =
    storyboardPrompts.length > 0 ||
    storyboardTables.length > 0 ||
    storyboardImages.length > 0 ||
    /Panel\s*1|3x3|3\s*x\s*3|九宫格|分镜图|storyboard grid/i.test(sourceText);
  const hasCharacterSource =
    characterPrompts.length > 0 ||
    characterImages.length > 0 ||
    /character sheet|角色设定|角色参考|人物参考/i.test(sourceText);
  const hasMultipleUnknownImages = unknownImages.length >= 2;
  const videoMode: AiFilmmakingVideoMode =
    kind !== 'film_video_prompt_node'
      ? 'A'
      : (hasStoryboardSource || hasMultipleUnknownImages) && hasCharacterSource
        ? 'C'
        : hasStoryboardSource
          ? 'B'
          : 'A';

  const primaryImage =
    kind === 'film_character_node'
      ? orderedImages.find((image) => image.dataUrl)
      : videoMode === 'B' || videoMode === 'C'
        ? [...storyboardImages, ...unknownImages, ...characterImages].find((image) => image.dataUrl)
        : [...characterImages, ...unknownImages].find((image) => image.dataUrl);

  if (primaryImage?.panelCount) storyboardPanelCount = primaryImage.panelCount;
  const panelMappingText = primaryImage?.panels?.length
    ? [...primaryImage.panels]
        .sort((a, b) => a.panelIndex - b.panelIndex)
        .map((panel) =>
          `Panel ${panel.panelIndex} -> shot ${panel.shotNo?.trim() || panel.shotId} (${panel.sourceLabel})`,
        )
        .join('\n')
    : '';
  const sourceSignature = hashVideoPromptSource([
    ...orderedImages.map((image) => `${image.nodeId}:${image.signature}:${image.role}`),
    sourceText,
    panelMappingText,
  ]);

  const summary: AiFilmmakingSourceSummary = {
    textBlocks,
    characterPrompts,
    storyboardPrompts,
    storyboardTables,
    storyboardPanelCount: storyboardPanelCount > 0 ? storyboardPanelCount : undefined,
    storyboardDurationSec: storyboardDurationSec > 0 ? storyboardDurationSec : undefined,
    imageLabels: orderedImages.map((image) => image.label),
    storyboardImageLabels: storyboardImages.map((image) => image.label),
    characterImageLabels: characterImages.map((image) => image.label),
  };

  return {
    summary,
    images: orderedImages,
    primaryImage,
    videoMode,
    sourceSignature,
    panelMappingText,
  };
}

function resolveFilmStoryboardSkill(data: StudioNodeData): ResolvedFilmStoryboardSkill | undefined {
  const rawId = normalizeFilmStoryboardSkillId(data.film_storyboard_skill_id);
  const skill = getSkillById(rawId) ?? getSkillById(DEFAULT_STORYBOARD_SKILL_ID);
  if (!skill || skill.folder !== 'storyboard') return undefined;
  return {
    id: skill.id,
    name: skill.name,
    instruction: skill.system_instruction,
  };
}

function resolveFilmVideoPromptSkill(data: StudioNodeData): ResolvedFilmVideoPromptSkill {
  const rawId = normalizeFilmVideoPromptSkillId(data.film_video_prompt_skill_id);
  const skill = getSkillById(rawId) ?? getSkillById(DEFAULT_VIDEO_PROMPT_SKILL_ID);
  if (!skill || skill.folder !== 'video_prompt') {
    throw new Error('未找到可用的独立视频提示词 Skill。');
  }
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    instruction: skill.system_instruction,
  };
}

function resolveFilmStoryboardAspectRatio(data: StudioNodeData): AiFilmmakingStoryboardAspectRatio {
  return normalizeStoryboardAspectRatio(data.film_storyboard_aspect_ratio);
}

function statusText(
  kind: AiFilmmakingPromptNodeKind,
  mode?: AiFilmmakingVideoMode,
  storyboardSkillName?: string,
  storyboardPanelCount?: number,
): string {
  if (kind === 'film_character_node') return 'LLM 正在按角色参考表规范生成角色设定提示词...';
  if (kind === 'film_storyboard_node') {
    const panelLabel = storyboardPanelCount ? `${storyboardPanelCount}宫格` : '分镜宫格';
    return `LLM 正在按${storyboardSkillName ? `「${storyboardSkillName}」` : ''}分镜 Skill 生成${panelLabel}提示词...`;
  }
  return `LLM 正在按 Seedance 2.0 ${mode ?? 'A'} 模式生成视频提示词...`;
}

function buildUserPrompt(
  kind: AiFilmmakingPromptNodeKind,
  source: FilmPromptSource,
  storyboardSkill?: ResolvedFilmStoryboardSkill,
): string {
  if (kind === 'film_character_node') {
    return buildCharacterSheetUserPrompt(source.summary, Boolean(source.primaryImage?.dataUrl));
  }
  if (kind === 'film_storyboard_node') {
    return buildStoryboardGridUserPrompt(source.summary, storyboardSkill);
  }
  throw new Error('视频提示词节点必须通过九宫格图片分析流程执行。');
}

function hasUsableSource(kind: AiFilmmakingPromptNodeKind, source: FilmPromptSource): boolean {
  if (kind === 'film_storyboard_node') {
    return (
      source.summary.textBlocks.some(Boolean) ||
      source.summary.characterPrompts.some(Boolean) ||
      source.summary.storyboardPrompts.some(Boolean) ||
      source.summary.storyboardTables.some(Boolean)
    );
  }
  if (kind === 'film_video_prompt_node') {
    return Boolean(source.primaryImage?.dataUrl && source.primaryImage.role === 'storyboard');
  }
  return (
    source.summary.textBlocks.some(Boolean) ||
    source.summary.characterPrompts.some(Boolean) ||
    source.summary.storyboardPrompts.some(Boolean) ||
    source.summary.storyboardTables.some(Boolean) ||
    source.images.length > 0
  );
}

function sourceMissingMessage(kind: AiFilmmakingPromptNodeKind): string {
  if (kind === 'film_character_node') {
    return '请先连接图片节点或文本节点，再生成角色设定。';
  }
  if (kind === 'film_storyboard_node') {
    return '请先连接文本节点或分镜表镜头输出，再生成分镜宫格提示词。';
  }
  return '请先生成九宫格图片，再把影视分镜图节点或其右侧九宫格图片节点连接到视频提示词。';
}

function maxOutputTokensFor(kind: AiFilmmakingPromptNodeKind): number {
  if (kind === 'film_character_node') return 2200;
  if (kind === 'film_storyboard_node') return 4400;
  return 5600;
}

export function createAiFilmmakingStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: AiFilmmakingSliceDeps,
): AiFilmmakingSlice {
  void set;

  return {
    runAiFilmmakingNode: async (nodeId) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (
        !node ||
        (node.type !== 'aiFilmCharacter' &&
          node.type !== 'aiFilmStoryboard' &&
          node.type !== 'aiFilmVideoPrompt')
      ) {
        return;
      }
      const kind = node.data.type as AiFilmmakingPromptNodeKind;
      const source = collectFilmPromptSource(nodeId, kind, get().nodes, get().edges);
      const storyboardSkill = kind === 'film_storyboard_node' ? resolveFilmStoryboardSkill(node.data) : undefined;
      const storyboardAspectRatio =
        kind === 'film_storyboard_node' ? resolveFilmStoryboardAspectRatio(node.data) : undefined;
      if (storyboardAspectRatio) {
        source.summary.storyboardAspectRatio = storyboardAspectRatio;
      }

      if (!hasUsableSource(kind, source)) {
        const message = sourceMissingMessage(kind);
        get().patchNodeData(nodeId, { generation_error: message }, true);
        get().pushMessage({ role: 'system', text: message, nodeId });
        return;
      }
      const connectedStoryboardImages = source.images.filter(
        (image) => image.role === 'storyboard' && image.dataUrl,
      );
      if (kind === 'film_video_prompt_node' && connectedStoryboardImages.length > 1) {
        const message = '当前连接包含多张分镜宫格。请从需要处理的单张九宫格图片节点创建视频提示词，一页对应一条视频提示词。';
        get().patchNodeData(nodeId, { generation_error: message }, true);
        get().pushMessage({ role: 'system', text: message, nodeId });
        return;
      }

      const config = getResolvedLlmGatewayConfig();
      if (!config) {
        const message = '未配置可用模型网关。请先在设置里填写代理 URL 或 Base URL / API Key。';
        get().patchNodeData(nodeId, { generation_error: message }, true);
        get().pushMessage({ role: 'system', text: message, nodeId });
        return;
      }

      deps.activeTaskAbortControllers.get(nodeId)?.abort();
      const controller = new AbortController();
      deps.activeTaskAbortControllers.set(nodeId, controller);
      get().setActiveNodeId(nodeId);
      get().patchNodeData(
        nodeId,
        {
          status: 'IN_PROGRESS',
          generation_error: undefined,
          streaming_preview: statusText(
            kind,
            source.videoMode,
            storyboardSkill?.name,
            source.summary.storyboardPanelCount,
          ),
        },
        true,
      );
      get().pushMessage({
        role: 'broadcast',
        text:
          kind === 'film_character_node'
            ? '角色设定节点正在调用 LLM 生成角色参考表提示词。'
            : kind === 'film_storyboard_node'
              ? `影视分镜节点正在调用 LLM，使用 Skill：${storyboardSkill?.name ?? '默认分镜'}。`
              : `视频提示词节点正在读取最终九宫格图片，并按 ${source.videoMode ?? 'B'} 模式分析表演与动作接力。`,
        nodeId,
      });

      try {
        const { requestLLM, requestLLMStream, requestLLMWithImage } = await import('@/services/ModelGateway');
        if (kind === 'film_video_prompt_node') {
          const primaryImage = source.primaryImage;
          if (!primaryImage?.dataUrl) {
            throw new Error(sourceMissingMessage(kind));
          }
          const videoPromptSkill = resolveFilmVideoPromptSkill(node.data);
          const expectedPanelCount = Math.max(
            1,
            Math.min(
              9,
              Math.round(primaryImage.panelCount ?? source.summary.storyboardPanelCount ?? 9),
            ),
          );
          const storyboardFacts = [
            ...source.summary.storyboardTables,
            ...source.summary.storyboardPrompts,
            ...source.summary.textBlocks,
          ]
            .filter(Boolean)
            .join('\n\n---\n\n');
          const visionConfig = getResolvedVisionLlmGatewayConfig() ?? config;
          get().patchNodeData(
            nodeId,
            {
              streaming_preview: `阶段 1/3 · 正在读取九宫格图片并分析 ${expectedPanelCount} 个面板的构图、表演与动作接力…`,
            },
            true,
          );
          const analysisResult = await requestLLMWithImage(visionConfig, {
            imageDataUrl: primaryImage.dataUrl,
            imageDetail: 'high',
            systemPrompt: buildVideoPromptAnalysisSystemPrompt(expectedPanelCount),
            userPrompt: buildVideoPromptAnalysisUserPrompt({
              imageLabel: primaryImage.label,
              expectedPanelCount,
              panelMappingText: source.panelMappingText,
              storyboardFacts,
            }),
            temperature: 0.12,
            jsonMode: true,
            feature: `ai-filmmaking-video-analysis-${featureSafeId(videoPromptSkill.id)}`,
            maxOutputTokens: 6200,
            signal: controller.signal,
          });
          if (!analysisResult.ok) {
            if (analysisResult.error.code === 'USER_ABORT') {
              get().patchNodeData(
                nodeId,
                { status: 'APPROVED', streaming_preview: undefined, generation_error: undefined },
                true,
              );
              return;
            }
            throw new Error(analysisResult.error.message);
          }
          const analysis = parseVideoPromptImageAnalysis(analysisResult.content, {
            expectedPanelCount,
            sourceImageNodeId: primaryImage.nodeId,
            sourceImageSignature: primaryImage.signature,
          });
          const durationIsExplicit = Boolean(
            node.data.film_video_prompt_duration_source === 'node' ||
              (node.data.film_video_prompt_duration_source == null &&
                Number.isFinite(Number(node.data.film_video_prompt_duration_sec)) &&
                Number(node.data.film_video_prompt_duration_sec) > 0 &&
                Number(node.data.film_video_prompt_duration_sec) !== 15),
          );
          const durationSec = resolveVideoPromptDurationSec(
            durationIsExplicit ? node.data.film_video_prompt_duration_sec : undefined,
            source.summary.storyboardDurationSec,
          );
          const referenceImages = [
            ...source.images.filter((image) => image.role === 'character' && image.dataUrl),
            primaryImage,
          ].filter(
            (image, index, all) => all.findIndex((candidate) => candidate.nodeId === image.nodeId) === index,
          );
          const mode: 'B' | 'C' = referenceImages.some((image) => image.role === 'character') ? 'C' : 'B';
          const imageReferenceLines = referenceImages.map(
            (image, index) =>
              `@image${index + 1}: ${image.label} — ${image.role === 'storyboard' ? '按连续分镜面板读取' : '角色身份参考'}`,
          );
          get().patchNodeData(
            nodeId,
            {
              film_video_prompt_analysis: analysis,
              film_video_prompt_source_signature: source.sourceSignature,
              film_video_prompt_source_image_node_ids: referenceImages.map((image) => image.nodeId),
              film_video_prompt_duration_sec: durationIsExplicit
                ? node.data.film_video_prompt_duration_sec
                : undefined,
              film_video_prompt_duration_source: durationIsExplicit ? 'node' : 'auto',
              streaming_preview: `阶段 2/3 · 已识别 ${analysis.panels.length} 个面板。正在按「${videoPromptSkill.name}」生成逐段表演、运镜、声音与结束状态…`,
            },
            true,
          );

          let lastPreviewAt = 0;
          const compositionResult = await requestLLMStream(config, {
            systemPrompt: videoPromptSkill.instruction,
            userPrompt: buildVideoPromptCompositionUserPrompt({
              analysis,
              mode,
              durationSec,
              imageReferenceLines,
              storyboardFacts,
              sourceDurationSec: source.summary.storyboardDurationSec,
            }),
            temperature: 0.22,
            jsonMode: false,
            feature: `ai-filmmaking-video-compose-${featureSafeId(videoPromptSkill.id)}`,
            maxOutputTokens: maxOutputTokensFor(kind),
            signal: controller.signal,
            onDelta: (_delta, accumulated) => {
              const now = Date.now();
              if (now - lastPreviewAt < 160 && accumulated.length > 0) return;
              lastPreviewAt = now;
              const preview = accumulated.slice(-VIDEO_PROMPT_PREVIEW_MAX_CHARS);
              get().patchNodeData(
                nodeId,
                { streaming_preview: `阶段 2/3 · 流式生成视频提示词…\n\n${preview}` },
                false,
              );
            },
          });
          if (!compositionResult.ok) {
            if (compositionResult.error.code === 'USER_ABORT') {
              get().patchNodeData(
                nodeId,
                { status: 'APPROVED', streaming_preview: undefined, generation_error: undefined },
                true,
              );
              return;
            }
            throw new Error(compositionResult.error.message);
          }

          let prompt = stripAiFilmmakingPromptWrapper(compositionResult.content);
          let validationIssues = validateVideoPromptText(prompt, expectedPanelCount);
          if (validationIssues.length > 0) {
            get().patchNodeData(
              nodeId,
              {
                streaming_preview: `阶段 3/3 · 正在修复视频提示词：${validationIssues.join(' ')}`,
              },
              true,
            );
            const repairResult = await requestLLM(config, {
              systemPrompt: `${videoPromptSkill.instruction}\n\nThe previous draft failed validation. Repair it without changing source facts. Return only the complete corrected prompt.`,
              userPrompt: [
                `Validation issues:\n${validationIssues.map((issue) => `- ${issue}`).join('\n')}`,
                '',
                'Previous draft:',
                prompt,
              ].join('\n'),
              temperature: 0.08,
              jsonMode: false,
              feature: `ai-filmmaking-video-repair-${featureSafeId(videoPromptSkill.id)}`,
              maxOutputTokens: maxOutputTokensFor(kind),
              signal: controller.signal,
            });
            if (!repairResult.ok) {
              if (repairResult.error.code === 'USER_ABORT') return;
              throw new Error(repairResult.error.message);
            }
            prompt = stripAiFilmmakingPromptWrapper(repairResult.content);
            validationIssues = validateVideoPromptText(prompt, expectedPanelCount);
            if (validationIssues.length > 0) {
              throw new Error(`视频提示词校验失败：${validationIssues.join(' ')}`);
            }
          }

          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              input: prompt,
              raw_text: prompt,
              output: {
                text: prompt,
                aiFilmmakingKind: kind,
                videoMode: mode,
                videoPromptSkillId: videoPromptSkill.id,
                videoPromptSkillVersion: videoPromptSkill.version,
                durationSec,
                storyboardPanelCount: expectedPanelCount,
                sourceImageCount: referenceImages.length,
                sourceImageNodeIds: referenceImages.map((image) => image.nodeId),
                sourceSignature: source.sourceSignature,
                imageAnalysis: analysis,
              },
              film_video_prompt_analysis: analysis,
              film_video_prompt_skill_id: videoPromptSkill.id,
              film_video_prompt_source_signature: source.sourceSignature,
              film_video_prompt_source_image_node_ids: referenceImages.map((image) => image.nodeId),
              streaming_preview: undefined,
              generation_error: undefined,
            },
            true,
          );
          get().pushMessage({
            role: 'broadcast',
            text: `视频提示词已生成：${expectedPanelCount} 个面板，${durationSec} 秒，包含逐段表演与动作接力。`,
            nodeId,
          });
          return;
        }
        const hasImage = Boolean(source.primaryImage?.dataUrl);
        const requestConfig = hasImage ? getResolvedVisionLlmGatewayConfig() ?? config : config;
        const systemPrompt = buildAiFilmmakingSystemPrompt(
          kind,
          storyboardSkill,
          source.summary.storyboardPanelCount,
          storyboardAspectRatio,
        );
        const userPrompt = buildUserPrompt(kind, source, storyboardSkill);
        const result =
          hasImage && source.primaryImage?.dataUrl
            ? await requestLLMWithImage(requestConfig, {
                imageDataUrl: source.primaryImage.dataUrl,
                imageDetail: 'auto',
                systemPrompt,
                userPrompt,
                temperature: 0.24,
                jsonMode: false,
                feature: `ai-filmmaking-${kind}${storyboardSkill ? `-${featureSafeId(storyboardSkill.id)}` : ''}`,
                maxOutputTokens: maxOutputTokensFor(kind),
                signal: controller.signal,
              })
            : await requestLLM(config, {
                systemPrompt,
                userPrompt,
                temperature: kind === 'film_character_node' ? 0.2 : 0.28,
                jsonMode: false,
                feature: `ai-filmmaking-${kind}${storyboardSkill ? `-${featureSafeId(storyboardSkill.id)}` : ''}`,
                maxOutputTokens: maxOutputTokensFor(kind),
                signal: controller.signal,
              });

        if (!result.ok) {
          if (result.error.code === 'USER_ABORT') {
            get().patchNodeData(
              nodeId,
              { status: 'APPROVED', streaming_preview: undefined, generation_error: undefined },
              true,
            );
            return;
          }
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              streaming_preview: undefined,
              generation_error: result.error.message,
            },
            true,
          );
          get().pushMessage({ role: 'system', text: result.error.message, nodeId });
          return;
        }

        const prompt = stripAiFilmmakingPromptWrapper(result.content);
        if (!prompt) {
          const message = '模型没有返回可写入的提示词。';
          get().patchNodeData(
            nodeId,
            { status: 'APPROVED', streaming_preview: undefined, generation_error: message },
            true,
          );
          get().pushMessage({ role: 'system', text: message, nodeId });
          return;
        }

        get().patchNodeData(
          nodeId,
          {
            status: 'APPROVED',
            input: prompt,
            raw_text: prompt,
            output: {
              text: prompt,
              aiFilmmakingKind: kind,
              storyboardSkillId: kind === 'film_storyboard_node' ? storyboardSkill?.id : undefined,
              storyboardPanelCount:
                kind === 'film_storyboard_node' ? source.summary.storyboardPanelCount : undefined,
              storyboardAspectRatio: kind === 'film_storyboard_node' ? storyboardAspectRatio : undefined,
              sourceImageCount: source.images.length,
            },
            streaming_preview: undefined,
            generation_error: undefined,
          },
          true,
        );
        get().pushMessage({
          role: 'broadcast',
          text: 'AI Filmmaking 提示词已生成并写回节点。',
          nodeId,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          get().patchNodeData(
            nodeId,
            { status: 'APPROVED', streaming_preview: undefined, generation_error: undefined },
            true,
          );
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        get().patchNodeData(
          nodeId,
          { status: 'APPROVED', streaming_preview: undefined, generation_error: message },
          true,
        );
        get().pushMessage({ role: 'system', text: message, nodeId });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
