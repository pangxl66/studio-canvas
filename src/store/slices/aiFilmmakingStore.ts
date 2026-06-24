import { getResolvedLlmGatewayConfig, getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import {
  buildAiFilmmakingSystemPrompt,
  buildCharacterSheetUserPrompt,
  buildSeedanceVideoUserPrompt,
  buildStoryboardGridUserPrompt,
  stripAiFilmmakingPromptWrapper,
  type AiFilmStoryboardSkillPrompt,
  type AiFilmmakingPromptNodeKind,
  type AiFilmmakingSourceSummary,
  type AiFilmmakingVideoMode,
} from '@/services/aiFilmmakingPrompts';
import { DEFAULT_STORYBOARD_SKILL_ID, getSkillById } from '@/services/skillLoader';
import { requestLLM, requestLLMWithImage } from '@/services/ModelGateway';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StoryboardOutput, StoryboardShot, StudioNodeData } from '@/types/studio';
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
};

type FilmPromptSource = {
  summary: AiFilmmakingSourceSummary;
  images: ImageReference[];
  primaryImage?: ImageReference;
  videoMode?: AiFilmmakingVideoMode;
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

function imageRefFromNode(node: StudioRFNode): ImageReference | null {
  if (node.type !== 'imageNode') return null;
  const label = node.data.imageFileName?.trim() || node.data.label?.trim() || '图片参考';
  return {
    nodeId: node.id,
    label,
    dataUrl: node.data.imageDataUrl,
    role: imageRoleFromLabel(label),
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
  return { text, shotCount: picked.shots.length };
}

function collectFilmPromptSource(
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
  const images: ImageReference[] = [];

  for (const source of sources) {
    const shotListFullOutput =
      source.node.type === 'shotList' &&
      source.node.data.type === 'shot_list_node' &&
      parseShotListItemOutputHandleId(source.sourceHandle) == null;
    if (shotListFullOutput) continue;

    const storyboardOutput = storyboardOutputFromNode(source.node);
    if (storyboardOutput) {
      const scopedStoryboardHandle = parseShotListItemOutputHandleId(source.sourceHandle) != null;
      const tableBlock = formatStoryboardTableForGrid(source.node, storyboardOutput, source.sourceHandle);
      if (tableBlock) {
        storyboardTables.push(tableBlock.text);
        storyboardPanelCount += tableBlock.shotCount;
        continue;
      }
      if (scopedStoryboardHandle) continue;
    }

    const image = imageRefFromNode(source.node);
    if (image) {
      images.push(image);
      continue;
    }

    const text = textFromNode(source.node);
    if (!text) continue;

    if (source.node.type === 'aiFilmCharacter' || source.node.data.type === 'film_character_node') {
      characterPrompts.push(text);
    } else if (source.node.type === 'aiFilmStoryboard' || source.node.data.type === 'film_storyboard_node') {
      storyboardPrompts.push(text);
    } else {
      textBlocks.push(text);
    }
  }

  const storyboardImages = images.filter((image) => image.role === 'storyboard');
  const characterImages = images.filter((image) => image.role === 'character');
  const unknownImages = images.filter((image) => image.role === 'unknown');
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
      ? images.find((image) => image.dataUrl)
      : videoMode === 'B' || videoMode === 'C'
        ? [...storyboardImages, ...unknownImages, ...characterImages].find((image) => image.dataUrl)
        : [...characterImages, ...unknownImages].find((image) => image.dataUrl);

  const summary: AiFilmmakingSourceSummary = {
    textBlocks,
    characterPrompts,
    storyboardPrompts,
    storyboardTables,
    storyboardPanelCount: storyboardPanelCount > 0 ? storyboardPanelCount : undefined,
    imageLabels: images.map((image) => image.label),
    storyboardImageLabels: storyboardImages.map((image) => image.label),
    characterImageLabels: characterImages.map((image) => image.label),
  };

  return { summary, images, primaryImage, videoMode };
}

function resolveFilmStoryboardSkill(data: StudioNodeData): ResolvedFilmStoryboardSkill | undefined {
  const rawId =
    typeof data.film_storyboard_skill_id === 'string' && data.film_storyboard_skill_id.trim()
      ? data.film_storyboard_skill_id.trim()
      : DEFAULT_STORYBOARD_SKILL_ID;
  const skill = getSkillById(rawId) ?? getSkillById(DEFAULT_STORYBOARD_SKILL_ID);
  if (!skill || skill.folder !== 'storyboard') return undefined;
  return {
    id: skill.id,
    name: skill.name,
    instruction: skill.system_instruction,
  };
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
  return buildSeedanceVideoUserPrompt(source.summary, source.videoMode ?? 'A');
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
  return '请先连接文本、角色设定、影视分镜或图片参考，再生成视频提示词。';
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

      if (!hasUsableSource(kind, source)) {
        const message = sourceMissingMessage(kind);
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
              : `影视分镜提示词节点正在调用 LLM，自动识别为 ${source.videoMode ?? 'A'} 模式。`,
        nodeId,
      });

      try {
        const hasImage = Boolean(source.primaryImage?.dataUrl);
        const requestConfig = hasImage ? getResolvedVisionLlmGatewayConfig() ?? config : config;
        const systemPrompt = buildAiFilmmakingSystemPrompt(
          kind,
          storyboardSkill,
          source.summary.storyboardPanelCount,
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
              videoMode: kind === 'film_video_prompt_node' ? source.videoMode : undefined,
              storyboardSkillId: kind === 'film_storyboard_node' ? storyboardSkill?.id : undefined,
              storyboardPanelCount:
                kind === 'film_storyboard_node' ? source.summary.storyboardPanelCount : undefined,
              sourceImageCount: source.images.length,
            },
            streaming_preview: undefined,
            generation_error: undefined,
          },
          true,
        );
        get().pushMessage({
          role: 'broadcast',
          text:
            kind === 'film_video_prompt_node'
              ? `影视分镜提示词已生成，模式：${source.videoMode ?? 'A'}。`
              : 'AI Filmmaking 提示词已生成并写回节点。',
          nodeId,
        });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
