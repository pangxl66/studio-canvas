import { getResolvedLlmGatewayConfig, getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import {
  buildAiFilmmakingSystemPrompt,
  buildCharacterSheetUserPrompt,
  buildSeedanceVideoUserPrompt,
  buildStoryboardGridUserPrompt,
  stripAiFilmmakingPromptWrapper,
  type AiFilmmakingPromptNodeKind,
  type AiFilmmakingSourceSummary,
  type AiFilmmakingVideoMode,
} from '@/services/aiFilmmakingPrompts';
import { requestLLM, requestLLMWithImage } from '@/services/ModelGateway';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StudioNodeData } from '@/types/studio';
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

function collectIncomingSources(nodeId: string, nodes: StudioRFNode[], edges: StudioState['edges']): StudioRFNode[] {
  const incoming = edges.filter(
    (edge) =>
      edge.target === nodeId &&
      (edge.targetHandle == null || edge.targetHandle === FILM_INPUT_HANDLE_ID),
  );
  return incoming
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is StudioRFNode => Boolean(node));
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
  const images: ImageReference[] = [];

  for (const source of sources) {
    const image = imageRefFromNode(source);
    if (image) {
      images.push(image);
      continue;
    }

    const text = textFromNode(source);
    if (!text) continue;

    if (source.type === 'aiFilmCharacter' || source.data.type === 'film_character_node') {
      characterPrompts.push(text);
    } else if (source.type === 'aiFilmStoryboard' || source.data.type === 'film_storyboard_node') {
      storyboardPrompts.push(text);
    } else {
      textBlocks.push(text);
    }
  }

  const storyboardImages = images.filter((image) => image.role === 'storyboard');
  const characterImages = images.filter((image) => image.role === 'character');
  const unknownImages = images.filter((image) => image.role === 'unknown');
  const sourceText = [...textBlocks, ...characterPrompts, ...storyboardPrompts].join('\n');

  const hasStoryboardSource =
    storyboardPrompts.length > 0 ||
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
    imageLabels: images.map((image) => image.label),
    storyboardImageLabels: storyboardImages.map((image) => image.label),
    characterImageLabels: characterImages.map((image) => image.label),
  };

  return { summary, images, primaryImage, videoMode };
}

function statusText(kind: AiFilmmakingPromptNodeKind, mode?: AiFilmmakingVideoMode): string {
  if (kind === 'film_character_node') return 'LLM 正在按角色参考表规范生成角色设定提示词...';
  if (kind === 'film_storyboard_node') return 'LLM 正在按 9 宫格影视分镜规范生成提示词...';
  return `LLM 正在按 Seedance 2.0 ${mode ?? 'A'} 模式生成视频提示词...`;
}

function buildUserPrompt(kind: AiFilmmakingPromptNodeKind, source: FilmPromptSource): string {
  if (kind === 'film_character_node') {
    return buildCharacterSheetUserPrompt(source.summary, Boolean(source.primaryImage?.dataUrl));
  }
  if (kind === 'film_storyboard_node') {
    return buildStoryboardGridUserPrompt(source.summary);
  }
  return buildSeedanceVideoUserPrompt(source.summary, source.videoMode ?? 'A');
}

function hasUsableSource(kind: AiFilmmakingPromptNodeKind, source: FilmPromptSource): boolean {
  if (kind === 'film_storyboard_node') {
    return source.summary.textBlocks.some(Boolean) || source.summary.characterPrompts.some(Boolean);
  }
  return (
    source.summary.textBlocks.some(Boolean) ||
    source.summary.characterPrompts.some(Boolean) ||
    source.summary.storyboardPrompts.some(Boolean) ||
    source.images.length > 0
  );
}

function sourceMissingMessage(kind: AiFilmmakingPromptNodeKind): string {
  if (kind === 'film_character_node') {
    return '请先连接图片节点或文本节点，再生成角色设定。';
  }
  if (kind === 'film_storyboard_node') {
    return '请先连接文本节点，再生成九宫格分镜提示词。';
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
          streaming_preview: statusText(kind, source.videoMode),
        },
        true,
      );
      get().pushMessage({
        role: 'broadcast',
        text:
          kind === 'film_character_node'
            ? '角色设定节点正在调用 LLM 生成角色参考表提示词。'
            : kind === 'film_storyboard_node'
              ? '影视分镜节点正在调用 LLM 生成九宫格分镜提示词。'
              : `影视分镜提示词节点正在调用 LLM，自动识别为 ${source.videoMode ?? 'A'} 模式。`,
        nodeId,
      });

      try {
        const hasImage = Boolean(source.primaryImage?.dataUrl);
        const requestConfig = hasImage ? getResolvedVisionLlmGatewayConfig() ?? config : config;
        const systemPrompt = buildAiFilmmakingSystemPrompt(kind);
        const userPrompt = buildUserPrompt(kind, source);
        const result =
          hasImage && source.primaryImage?.dataUrl
            ? await requestLLMWithImage(requestConfig, {
                imageDataUrl: source.primaryImage.dataUrl,
                imageDetail: 'auto',
                systemPrompt,
                userPrompt,
                temperature: 0.24,
                jsonMode: false,
                feature: `ai-filmmaking-${kind}`,
                maxOutputTokens: maxOutputTokensFor(kind),
                signal: controller.signal,
              })
            : await requestLLM(config, {
                systemPrompt,
                userPrompt,
                temperature: kind === 'film_character_node' ? 0.2 : 0.28,
                jsonMode: false,
                feature: `ai-filmmaking-${kind}`,
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
