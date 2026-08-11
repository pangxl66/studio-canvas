import type { Edge } from '@xyflow/react';
import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import {
  getAuthSnapshot,
  isLanDirectAccessEnabled,
  isSaasAuthEnabled,
  isSaasMockEnabled,
} from '@/services/authClient';
import { requestCreditRefresh, spendMockCredit } from '@/services/creditService';
import type { StudioRFNode } from '@/types/reactFlow';
import type { ProjectAspectRatio, StoryboardShot } from '@/types/studio';
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  imageGenerationModelOption,
  resolveImageGenerationModel,
  storyboardGridImageQuality,
  type ImageGenerationModelId,
} from '@/services/imageGenerationModels';
import {
  prioritizeStoryboardReferences,
  type StoryboardConnectedReference,
} from '@/services/storyboardReferenceImages';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';
import {
  STORYBOARD_GRID_MAX_PANELS,
  storyboardGridCanvasSize,
  storyboardGridGeometryInstruction,
  storyboardGridLayout,
  storyboardGridName,
} from '@/utils/storyboardGridLayout';

export {
  STORYBOARD_GRID_MAX_PANELS,
  storyboardGridActionLabel,
  storyboardGridCanvasSize,
  storyboardGridGeometryInstruction,
  storyboardGridLayout,
  storyboardGridName,
} from '@/utils/storyboardGridLayout';

export const STORYBOARD_GRID_IMAGE_MODEL = DEFAULT_IMAGE_GENERATION_MODEL;
export const STORYBOARD_GRID_IMAGE_QUOTA_COST = 3;

export type StoryboardGridShotSource = {
  shot: StoryboardShot;
  sourceNodeId: string;
  sourceLabel: string;
};

export type StoryboardGridSource = {
  shots: StoryboardShot[];
  shotSources: StoryboardGridShotSource[];
  sourceLabels: string[];
  sourceNodeIds: string[];
  totalAvailable: number;
  duplicateCount: number;
};

export type StoryboardGridImageResult = {
  imageDataUrl: string;
  model: string;
  size: string;
  width?: number;
  height?: number;
  referenceImageCount?: number;
};

export type StoryboardGridImageSize =
  | '1024x1024'
  | '1536x1536'
  | '1536x1024'
  | '1024x1536'
  | '1536x864'
  | '864x1536'
  | '1536x576'
  | '576x1536';

export type StoryboardGridPromptOptions = {
  canvas?: 'square' | 'landscape' | 'portrait';
  panelAspectRatio?: ProjectAspectRatio;
  referenceInstruction?: string;
  hasLayoutReference?: boolean;
  layoutReferenceIndex?: number;
  /** Visual execution prompts aligned one-to-one with `shots`; compiled from connected Prompt nodes. */
  panelPrompts?: Array<string | undefined>;
  /** Exact reference-image bindings aligned one-to-one with `shots`. */
  panelReferenceInstructions?: Array<string | undefined>;
};

export type StoryboardGridReferenceImage = {
  dataUrl: string;
  name: string;
  kind: 'character' | 'scene' | 'prop' | 'layout';
  entityId?: string;
  entityName?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asShot(value: unknown, index: number): StoryboardShot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const description = asText(record.description);
  if (!description) return null;
  const rawId = typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : index + 1;
  return {
    id: Math.max(1, Math.floor(rawId)),
    shotNo: asText(record.shotNo) || undefined,
    wireId: asText(record.wireId) || undefined,
    type: asText(record.type) || '中景',
    movement: asText(record.movement) || '固定',
    description,
    content: asText(record.content),
    sceneRef: asText(record.sceneRef) || undefined,
    characters: Array.isArray(record.characters)
      ? record.characters.map(asText).filter(Boolean)
      : undefined,
    props: Array.isArray(record.props) ? record.props.map(asText).filter(Boolean) : undefined,
    action: asText(record.action) || undefined,
    sound: asText(record.sound) || undefined,
    durationSec:
      typeof record.durationSec === 'number' && Number.isFinite(record.durationSec)
        ? Math.max(0, record.durationSec)
        : undefined,
    note: asText(record.note) || undefined,
  };
}

function shotsFromOutput(output: unknown): StoryboardShot[] {
  if (!output || typeof output !== 'object') return [];
  const rawShots = (output as Record<string, unknown>).shots;
  if (!Array.isArray(rawShots)) return [];
  return rawShots.map(asShot).filter((shot): shot is StoryboardShot => shot != null);
}

function sourceLabel(node: StudioRFNode): string {
  return node.data.label?.trim() || (node.type === 'shotList' ? '镜头表' : '分镜表');
}

export function resolveStoryboardGridSource(
  imageNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): StoryboardGridSource {
  const sourceNodeIds: string[] = [];
  const sourceLabels: string[] = [];
  const shotSources: StoryboardGridShotSource[] = [];
  const seenShotKeys = new Set<string>();
  let totalAvailable = 0;

  for (const edge of edges) {
    if (edge.target !== imageNodeId) continue;
    const node = nodes.find((item) => item.id === edge.source);
    if (!node) continue;

    const allShots = shotsFromOutput(node.data.output);
    let incomingShots: StoryboardShot[] = [];
    if (node.type === 'shotList' && node.data.type === 'shot_list_node') {
      const wireId = parseShotListItemOutputHandleId(edge.sourceHandle);
      if (!wireId) continue;
      incomingShots = allShots.filter((shot) => shot.wireId === wireId);
    } else if (
      node.type === 'storyboardFile' ||
      (node.type === 'department' && node.data.type === 'storyboard')
    ) {
      incomingShots = allShots;
    } else {
      continue;
    }

    if (!incomingShots.length) continue;
    if (!sourceNodeIds.includes(node.id)) {
      sourceNodeIds.push(node.id);
      sourceLabels.push(sourceLabel(node));
    }
    totalAvailable += incomingShots.length;
    for (const shot of incomingShots) {
      const key = `${node.id}:${shot.wireId || shot.shotNo || shot.id}`;
      if (seenShotKeys.has(key)) continue;
      seenShotKeys.add(key);
      shotSources.push({ shot, sourceNodeId: node.id, sourceLabel: sourceLabel(node) });
    }
  }

  return {
    shots: shotSources.map((item) => item.shot),
    shotSources,
    sourceLabels,
    sourceNodeIds,
    totalAvailable,
    duplicateCount: Math.max(0, totalAvailable - shotSources.length),
  };
}

function noteField(note: string | undefined, label: '角色' | '道具'): string {
  if (!note) return '';
  const match = note.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`, 'u'));
  return match?.[1]?.trim() ?? '';
}

function compactUnique(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join('、');
}

export function paginateStoryboardGridSources(
  shotSources: StoryboardGridShotSource[],
): StoryboardGridShotSource[][] {
  const pages: StoryboardGridShotSource[][] = [];
  for (let index = 0; index < shotSources.length; index += STORYBOARD_GRID_MAX_PANELS) {
    pages.push(shotSources.slice(index, index + STORYBOARD_GRID_MAX_PANELS));
  }
  return pages;
}

function shotLine(shot: StoryboardShot): string {
  const parts = [
    shot.sceneRef ? `场景=${shot.sceneRef}` : '',
    `景别=${shot.type}`,
    `运镜=${shot.movement}`,
    `画面=${shot.description}`,
    shot.action ? `动作=${shot.action}` : '',
    shot.characters?.length
      ? `角色=${compactUnique(shot.characters)}`
      : noteField(shot.note, '角色')
        ? `角色=${noteField(shot.note, '角色')}`
        : '',
    shot.props?.length
      ? `道具=${compactUnique(shot.props)}`
      : noteField(shot.note, '道具')
        ? `道具=${noteField(shot.note, '道具')}`
        : '',
    shot.note ? `备注=${shot.note.replace(/\s+/gu, ' ').trim()}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

export function buildStoryboardGridPrompt(
  shots: StoryboardShot[],
  extraInstruction = '',
  options: StoryboardGridPromptOptions = {},
): string {
  if (!shots.length) throw new Error('没有可用于生成分镜宫格的镜头信息。');
  if (shots.length > STORYBOARD_GRID_MAX_PANELS) {
    throw new Error(`单张分镜宫格最多包含 ${STORYBOARD_GRID_MAX_PANELS} 个镜头，请先分页。`);
  }
  const scenes = compactUnique(shots.map((shot) => shot.sceneRef || '')) || '以镜头描述为准';
  const characters = compactUnique(
    shots.flatMap((shot) => shot.characters?.length ? shot.characters : [noteField(shot.note, '角色')]),
  ) || '以镜头描述中的人物为准';
  const props = compactUnique(
    shots.flatMap((shot) => shot.props?.length ? shot.props : [noteField(shot.note, '道具')]),
  ) || '以镜头描述中的物件为准';
  const panelCount = shots.length;
  const panels = shots.map((shot, index) => {
    const visualPrompt = options.panelPrompts?.[index]?.trim();
    const panelReferenceInstruction = options.panelReferenceInstructions?.[index]?.trim();
    return [
      `${index + 1}. 【分镜事实】${shotLine(shot)}`,
      panelReferenceInstruction ? `   【本格参考图】${panelReferenceInstruction}` : '',
      visualPrompt ? `   【提示词视觉执行】${visualPrompt}` : '',
    ].filter(Boolean).join('\n');
  });
  const canvasInstruction = panelCount === 6 && options.panelAspectRatio
    ? options.panelAspectRatio === '9:16'
      ? '最终整张图片使用六宫格专属 3:8 竖向画布（2 列 × 3 行）'
      : options.panelAspectRatio === '21:9'
        ? '最终整张图片使用超宽横向安全画布（3 列 × 2 行），每格严格保持 21:9'
        : '最终整张图片使用六宫格专属 8:3 横向画布（3 列 × 2 行）'
    : options.panelAspectRatio === '21:9'
      ? '最终整张图片使用可容纳 21:9 单格的超宽安全画布，所有有效面板严格保持 21:9'
      : options.canvas === 'landscape'
        ? '最终整张图片使用 16:9 横向画布'
      : options.canvas === 'portrait'
        ? '最终整张图片使用 9:16 竖向画布'
        : '最终整张图片使用正方形画布';
  const panelRatioInstruction = options.panelAspectRatio
    ? `硬性画框要求：每一个独立分镜面板都必须是严格 ${options.panelAspectRatio}，不是只有整张宫格总图为 ${options.panelAspectRatio}。禁止正方形或接近正方形的单格；可以在总画布边缘保留整齐的深色电影胶片留白。`
    : '';
  const captionInstruction = [
    '镜头说明标识规范：每个分镜面板底部必须预留一条干净、连续、约占单格高度 20% 的深色半透明说明带。',
    '说明带必须位于本格内部，不跨格、不遮挡人物面部和关键道具；图片模型不要在说明带里自行生成文字、数字或符号，系统会在生成后按分镜表原文叠加准确的镜头号、景别、运镜和画面说明。',
  ].join('');
  const cropSafetyInstruction =
    options.panelAspectRatio === '21:9'
      ? '每个分镜直接按 21:9 超宽银幕安全区构图，主体、人物头部和关键道具必须完整留在中央安全区；渠道使用相近原生尺寸时，只允许裁掉安全区外留白。'
      : options.canvas === 'landscape'
        ? '每个分镜直接按 16:9 横向电影镜头完成构图，主体、人物头部和关键道具必须完整进入画面；不要依赖后期裁切来获得比例。'
        : options.canvas === 'portrait'
          ? '每个分镜直接按 9:16 竖向电影镜头完成构图，主体、人物和关键道具必须完整进入画面；不要依赖后期裁切来获得比例。'
          : '';
  const referenceInstruction = options.referenceInstruction?.trim();

  return [
    `生成一张包含且仅包含 ${panelCount} 个画面的${storyboardGridName(panelCount)}电影分镜图。`,
    referenceInstruction ? `参考图身份硬约束（最高优先级，必须先执行再考虑文字剧情）：\n${referenceInstruction}` : '',
    `${canvasInstruction}。版式：${storyboardGridLayout(panelCount, options.panelAspectRatio)}。阅读顺序为从左到右、从上到下。`,
    panelRatioInstruction,
    captionInstruction,
    options.panelAspectRatio ? storyboardGridGeometryInstruction(panelCount, options.panelAspectRatio) : '',
    options.hasLayoutReference
      ? `布局模板硬约束：参考图 ${options.layoutReferenceIndex ?? 1} 是纯布局模板，只复用其中面板边框的位置、尺寸、留白和比例；不要把模板颜色或空白内容当成场景；布局模板的视觉优先级低于所有场景、角色和道具参考图。`
      : '',
    cropSafetyInstruction,
    `硬性数量要求：只能有 ${panelCount} 个有效画面；每个输入镜头严格对应一个画面；不得重复镜头、不得补齐空位、不得增加建立镜头或特写、不得虚构第 ${panelCount + 1} 个画面。`,
    options.panelPrompts?.some((value) => value?.trim())
      ? '信息职责：分镜事实决定角色、场景、道具、剧情动作和最终结果；提示词视觉执行决定机位、构图、焦点、光线、镜头参数和可见表演。两者冲突时不得改写分镜事实。每格只表现一个最有代表性的目标关键帧，不要把视频时间轴画成多重曝光或同格多阶段动作。'
      : '',
    '连续性要求：所有画面属于同一故事世界；人物面孔、年龄、发型、服装、身材比例保持一致；场景方位、时代、美术风格、关键道具、天气、时间和主光方向保持连续。写实电影质感，构图清晰，细节可信。',
    '除每格底部预留的空白镜头说明带外，画面中禁止出现任何文字、数字、字幕、对白、logo、水印、拼贴标题或界面元素；不要由图片模型伪造镜头标识。',
    `统一场景：${scenes}`,
    `统一角色：${characters}`,
    `统一关键道具：${props}`,
    `${panelCount} 个画面逐一对应如下：`,
    ...panels,
    extraInstruction.trim() ? `附加风格要求：${extraInstruction.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function loadGeneratedImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('生成图片读取失败，无法校正画幅。'));
    image.src = dataUrl;
  });
}

/** Read the provider's real pixel dimensions without cropping or stretching. */
export async function measureStoryboardGridImage(
  result: StoryboardGridImageResult,
): Promise<StoryboardGridImageResult> {
  const image = await loadGeneratedImage(result.imageDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('生成图片没有有效尺寸。');
  return { ...result, size: `${width}x${height}`, width, height };
}

function fitCaptionText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…`;
}

/** Add exact shot-table captions without cropping, splitting, or stretching the generated image. */
export async function addStoryboardPanelCaptions(
  result: StoryboardGridImageResult,
  shots: StoryboardShot[],
  aspectRatio: ProjectAspectRatio,
): Promise<StoryboardGridImageResult> {
  if (!shots.length) return result;
  const image = await loadGeneratedImage(result.imageDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('生成图片没有有效尺寸，无法添加镜头说明。');

  const rows = layoutRows(shots.length, aspectRatio);
  const maxColumns = Math.max(...rows);
  const panelWidth = width / maxColumns;
  const panelHeight = panelWidth * (
    aspectRatio === '9:16' ? 16 / 9 : aspectRatio === '21:9' ? 9 / 21 : 9 / 16
  );
  const gridHeight = panelHeight * rows.length;
  const startY = (height - gridHeight) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法添加镜头说明。');
  context.drawImage(image, 0, 0, width, height);

  let shotIndex = 0;
  rows.forEach((columns, rowIndex) => {
    const rowWidth = columns * panelWidth;
    const startX = (width - rowWidth) / 2;
    for (let column = 0; column < columns && shotIndex < shots.length; column += 1) {
      const shot = shots[shotIndex];
      const x = startX + column * panelWidth;
      const y = startY + rowIndex * panelHeight;
      const inset = Math.max(4, Math.round(Math.min(panelWidth, panelHeight) * 0.018));
      const captionHeight = Math.max(42, Math.round(panelHeight * 0.2));
      const captionY = y + panelHeight - captionHeight;
      const titleSize = Math.max(12, Math.round(panelHeight * 0.045));
      const descriptionSize = Math.max(11, Math.round(panelHeight * 0.039));
      const textWidth = panelWidth - inset * 2;
      const shotNo = shot.shotNo?.trim() || String(shot.id || shotIndex + 1).padStart(2, '0');

      context.fillStyle = 'rgba(3, 7, 18, 0.8)';
      context.fillRect(x, captionY, panelWidth, captionHeight);
      context.fillStyle = '#38bdf8';
      context.fillRect(x, captionY, panelWidth, Math.max(2, Math.round(captionHeight * 0.04)));
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.font = `700 ${titleSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      context.fillStyle = '#f8fafc';
      const title = fitCaptionText(
        context,
        `镜头 ${shotNo} · ${shot.type || '景别未标注'} · ${shot.movement || '固定机位'}`,
        textWidth,
      );
      context.fillText(title, x + inset, captionY + captionHeight * 0.34);
      context.font = `500 ${descriptionSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      context.fillStyle = '#cbd5e1';
      const description = fitCaptionText(context, shot.description?.trim() || '画面说明未填写', textWidth);
      context.fillText(description, x + inset, captionY + captionHeight * 0.72);
      shotIndex += 1;
    }
  });

  return {
    ...result,
    imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
    size: `${width}x${height}`,
    width,
    height,
  };
}

function imageProxyUrl(chatProxyUrl: string | undefined): string {
  const explicit = import.meta.env.VITE_IMAGE_PROXY_URL?.trim();
  if (explicit) return explicit;
  const proxy = chatProxyUrl?.trim();
  if (!proxy) return '/api/images/generate';
  if (/\/api\/llm\/chat\/?$/u.test(proxy)) return proxy.replace(/\/api\/llm\/chat\/?$/u, '/api/images/generate');
  if (/\/chat\/completions\/?$/u.test(proxy)) return proxy.replace(/\/chat\/completions\/?$/u, '/images/generations');
  return proxy;
}

function directImageUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/u, '');
  if (/\/images\/generations$/u.test(base)) return base;
  if (/\/chat\/completions$/u.test(base)) return base.replace(/\/chat\/completions$/u, '/images/generations');
  if (/\/v1$/u.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

function directImageEditUrl(baseUrl: string): string {
  return directImageUrl(baseUrl).replace(/\/images\/generations$/u, '/images/edits');
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/u);
  if (!match) throw new Error('参考图数据格式无效。');
  const binary = window.atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] || 'image/jpeg' });
}

async function compressReferenceImage(
  dataUrl: string,
  kind: StoryboardGridReferenceImage['kind'],
  overrides?: { maxSide?: number; quality?: number },
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('参考图处理已停止。', 'AbortError');
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(new DOMException('参考图处理已停止。', 'AbortError')));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error('参考图读取超时，请检查该图片是否仍然可用。'))),
      30_000,
    );
    image.onload = () => finish(resolve);
    image.onerror = () => finish(() => reject(new Error('参考图读取失败，请重新载入该图片。')));
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = dataUrl;
  });
  if (signal?.aborted) throw new DOMException('参考图处理已停止。', 'AbortError');
  const maxSide = overrides?.maxSide ?? (kind === 'character' ? 1536 : kind === 'prop' ? 1280 : 1024);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理参考图。');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const quality = overrides?.quality ?? (kind === 'character' ? 0.95 : kind === 'prop' ? 0.9 : 0.84);
  const compressed = canvas.toDataURL('image/jpeg', quality);
  image.src = '';
  canvas.width = 1;
  canvas.height = 1;
  return compressed;
}

export async function prepareImageEditReference(
  dataUrl: string,
  name: string,
): Promise<StoryboardGridReferenceImage> {
  return {
    dataUrl: await compressReferenceImage(dataUrl, 'layout', { maxSide: 1536, quality: 0.92 }),
    name,
    kind: 'layout',
  };
}

export async function prepareStoryboardReferenceImages(
  references: StoryboardConnectedReference[],
  maxImages = 8,
  signal?: AbortSignal,
): Promise<StoryboardGridReferenceImage[]> {
  const usable = prioritizeStoryboardReferences(references)
    .filter((reference) => reference.dataUrl)
    .slice(0, maxImages);
  // 大图并行解码会在四张以上参考图时造成明显内存尖峰，甚至让浏览器一直停在 0/1。
  // 顺序处理可稳定释放每张图的解码画布，耗时差异很小。
  const prepared: StoryboardGridReferenceImage[] = [];
  for (const reference of usable) {
    if (signal?.aborted) throw new DOMException('参考图处理已停止。', 'AbortError');
    prepared.push({
      dataUrl: await compressReferenceImage(reference.dataUrl as string, reference.kind, undefined, signal),
      name: reference.name,
      kind: reference.kind,
      entityId: reference.entityId,
      entityName: reference.entityName,
    });
  }
  return prepared;
}

function layoutRows(panelCount: number, aspectRatio: ProjectAspectRatio): number[] {
  if (panelCount <= 3) return [panelCount];
  if (panelCount === 4) return [2, 2];
  if (panelCount === 5) return [3, 2];
  if (panelCount === 6) return aspectRatio === '9:16' ? [2, 2, 2] : [3, 3];
  if (panelCount === 7) return [3, 3, 1];
  if (panelCount === 8) return [3, 3, 2];
  return [3, 3, 3];
}

/** A blank guide sent to the image model so panel geometry is generated, not post-cropped. */
export function createStoryboardLayoutReference(
  panelCount: number,
  aspectRatio: ProjectAspectRatio,
): StoryboardGridReferenceImage {
  const [width, height] = storyboardGridCanvasSize(panelCount, aspectRatio)
    .split('x')
    .map((value) => Number.parseInt(value, 10));
  const rows = layoutRows(panelCount, aspectRatio);
  const maxColumns = Math.max(...rows);
  const panelWidth = width / maxColumns;
  const panelHeight = panelWidth * (
    aspectRatio === '9:16' ? 16 / 9 : aspectRatio === '21:9' ? 9 / 21 : 9 / 16
  );
  const gridHeight = panelHeight * rows.length;
  const startY = (height - gridHeight) / 2;
  const gap = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建分镜布局模板。');
  context.fillStyle = '#05070d';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#f8fafc';
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.004));
  rows.forEach((columns, rowIndex) => {
    const rowWidth = columns * panelWidth;
    const startX = (width - rowWidth) / 2;
    for (let column = 0; column < columns; column += 1) {
      const x = startX + column * panelWidth + gap / 2;
      const y = startY + rowIndex * panelHeight + gap / 2;
      const frameWidth = panelWidth - gap;
      const frameHeight = panelHeight - gap;
      context.fillStyle = '#111827';
      context.fillRect(x, y, frameWidth, frameHeight);
      context.strokeRect(x, y, frameWidth, frameHeight);
    }
  });
  return {
    dataUrl: canvas.toDataURL('image/png'),
    name: `${aspectRatio} ${panelCount} 格分镜布局模板`,
    kind: 'layout',
  };
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error.trim();
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  }
  return fallback;
}

export async function generateStoryboardGridImage(
  prompt: string,
  projectId: string | null,
  signal?: AbortSignal,
  size: StoryboardGridImageSize = '1536x1536',
  referenceImages: StoryboardGridReferenceImage[] = [],
  requestedModel: ImageGenerationModelId = STORYBOARD_GRID_IMAGE_MODEL,
): Promise<StoryboardGridImageResult> {
  const config = getResolvedVisionLlmGatewayConfig();
  if (!config) throw new Error('尚未配置可用的图片模型接口。请先完成模型设置。');
  const model = resolveImageGenerationModel(requestedModel);
  const modelLabel = imageGenerationModelOption(model).label;
  const quality = storyboardGridImageQuality(referenceImages);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Math.max(config.timeoutMs ?? 120_000, 420_000));
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const explicitImageProxyUrl = import.meta.env.VITE_IMAGE_PROXY_URL?.trim();
    const useProxy = Boolean(
      config.proxyUrl || (explicitImageProxyUrl && window.location.protocol !== 'file:'),
    );
    const headers: Record<string, string> = {};
    if (useProxy && isSaasAuthEnabled()) {
      const { session } = await getAuthSnapshot();
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      if ((isSaasMockEnabled() || isLanDirectAccessEnabled()) && session?.user?.email) {
        headers['X-Studio-Mock-Email'] = session.user.email;
      }
    } else if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const url = useProxy
      ? imageProxyUrl(config.proxyUrl)
      : referenceImages.length
        ? directImageEditUrl(config.baseUrl || 'https://api.openai.com')
        : directImageUrl(config.baseUrl || 'https://api.openai.com');
    let body: BodyInit;
    if (useProxy) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        prompt,
        projectId,
        model,
        size,
        quality,
        referenceImages,
      });
    } else if (referenceImages.length) {
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt);
      form.set('n', '1');
      form.set('size', size);
      form.set('quality', quality);
      form.set('output_format', 'jpeg');
      form.set('output_compression', '88');
      referenceImages.forEach((reference, index) => {
        form.append('image', dataUrlToBlob(reference.dataUrl), `reference-${index + 1}.jpg`);
      });
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality: 'medium',
        output_format: 'jpeg',
        output_compression: 88,
      });
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(errorMessage(payload, `图片生成失败（HTTP ${response.status}）。`));

    if (useProxy) {
      const imageDataUrl = typeof payload?.imageDataUrl === 'string' ? payload.imageDataUrl : '';
      if (!imageDataUrl) throw new Error('图片模型未返回可用图像。');
      const confirmedReferenceCount =
        typeof payload?.referenceImageCount === 'number' ? payload.referenceImageCount : null;
      if (referenceImages.length && confirmedReferenceCount == null) {
        throw new Error(`图片代理未确认参考图已传入 ${modelLabel}，已拒绝把结果标记为参考图生成。`);
      }
      if (confirmedReferenceCount != null && confirmedReferenceCount !== referenceImages.length) {
        throw new Error(`计划传入 ${referenceImages.length} 张参考图，但 ${modelLabel} 请求仅确认 ${confirmedReferenceCount} 张。`);
      }
      spendMockCredit(STORYBOARD_GRID_IMAGE_QUOTA_COST);
      if (isSaasAuthEnabled()) requestCreditRefresh();
      return {
        imageDataUrl,
        model: typeof payload?.model === 'string' ? payload.model : model,
        size: typeof payload?.size === 'string' ? payload.size : size,
        width: typeof payload?.width === 'number' ? payload.width : undefined,
        height: typeof payload?.height === 'number' ? payload.height : undefined,
        referenceImageCount: confirmedReferenceCount ?? 0,
      };
    }

    const data = Array.isArray(payload?.data) ? payload.data : [];
    const first = data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null;
    const b64 = typeof first?.b64_json === 'string' ? first.b64_json : '';
    if (!b64) throw new Error('图片模型未返回可用图像。');
    return {
      imageDataUrl: `data:image/jpeg;base64,${b64}`,
      model,
      size,
      referenceImageCount: referenceImages.length,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('图片生成超时或已取消。');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
