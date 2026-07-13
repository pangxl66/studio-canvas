import type { Edge } from '@xyflow/react';
import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { getAuthSnapshot, isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';
import { requestCreditRefresh, spendMockCredit } from '@/services/creditService';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StoryboardShot } from '@/types/studio';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';

export const STORYBOARD_GRID_IMAGE_MODEL = 'gpt-image-2';
export const STORYBOARD_GRID_IMAGE_QUOTA_COST = 3;
export const STORYBOARD_GRID_MAX_SHOTS = 9;

export type StoryboardGridSource = {
  shots: StoryboardShot[];
  sourceLabels: string[];
  sourceNodeIds: string[];
  totalAvailable: number;
};

export type StoryboardGridImageResult = {
  imageDataUrl: string;
  model: string;
  size: string;
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
  const selected: StoryboardShot[] = [];
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
      if (selected.length >= STORYBOARD_GRID_MAX_SHOTS) break;
      const key = `${node.id}:${shot.wireId || shot.shotNo || shot.id}`;
      const duplicate = selected.some(
        (item) => `${node.id}:${item.wireId || item.shotNo || item.id}` === key,
      );
      if (!duplicate) selected.push(shot);
    }
  }

  return { shots: selected, sourceLabels, sourceNodeIds, totalAvailable };
}

function noteField(note: string | undefined, label: '角色' | '道具'): string {
  if (!note) return '';
  const match = note.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`, 'u'));
  return match?.[1]?.trim() ?? '';
}

function compactUnique(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join('、');
}

const PANEL_COVERAGE = [
  '建立镜头：交代完整场景、空间方向与人物站位',
  '人物全身或中景：清楚呈现角色造型、服装和主要道具',
  '角色近景：突出表情、视线和情绪变化',
  '关键道具特写：表现材质、使用痕迹及其与剧情的关系',
  '动作镜头：呈现角色互动、动作方向和力量关系',
  '越肩或主观视角：保持空间轴线和角色关系',
  '环境细节：补充建筑、陈设、天气与光影气氛',
  '戏剧高潮：选择最有张力的瞬间和电影化构图',
  '连续性总览：总结场景、角色、道具和色彩关系',
] as const;

function shotLine(shot: StoryboardShot): string {
  const parts = [
    shot.sceneRef ? `场景=${shot.sceneRef}` : '',
    `景别=${shot.type}`,
    `运镜=${shot.movement}`,
    `画面=${shot.description}`,
    shot.action ? `动作=${shot.action}` : '',
    noteField(shot.note, '角色') ? `角色=${noteField(shot.note, '角色')}` : '',
    noteField(shot.note, '道具') ? `道具=${noteField(shot.note, '道具')}` : '',
    shot.note ? `备注=${shot.note.replace(/\s+/gu, ' ').trim()}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

export function buildStoryboardGridPrompt(shots: StoryboardShot[], extraInstruction = ''): string {
  if (!shots.length) throw new Error('没有可用于生成九宫格的分镜信息。');
  const selected = shots.slice(0, STORYBOARD_GRID_MAX_SHOTS);
  const scenes = compactUnique(selected.map((shot) => shot.sceneRef || '')) || '以镜头描述为准';
  const characters = compactUnique(selected.map((shot) => noteField(shot.note, '角色'))) || '以镜头描述中的人物为准';
  const props = compactUnique(selected.map((shot) => noteField(shot.note, '道具'))) || '以镜头描述中的物件为准';
  const panels = PANEL_COVERAGE.map((coverage, index) => {
    const shot = selected[index % selected.length];
    return `${index + 1}. ${coverage}。来源镜头：${shotLine(shot)}`;
  });

  return [
    '生成一张严格的 3×3 九宫格电影概念分镜图。正方形画布，九个等宽等高面板，阅读顺序为从左到右、从上到下。面板之间使用细窄且统一的间距。',
    '硬性视觉要求：九格必须属于同一故事世界；人物面孔、年龄、发型、服装、身材比例保持一致；场景方位、时代、美术风格、关键道具、天气、时间和主光方向保持连续。写实电影质感，构图清晰，细节可信。',
    '禁止出现任何文字、数字、字幕、镜头编号、对白、logo、水印、拼贴标题或界面元素；不要把九宫格画成带文字的 storyboard 模板。',
    `统一场景：${scenes}`,
    `统一角色：${characters}`,
    `统一关键道具：${props}`,
    '九个面板内容：',
    ...panels,
    extraInstruction.trim() ? `附加风格要求：${extraInstruction.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
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
): Promise<StoryboardGridImageResult> {
  const config = getResolvedVisionLlmGatewayConfig();
  if (!config) throw new Error('尚未配置可用的图片模型接口。请先完成模型设置。');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Math.max(config.timeoutMs ?? 120_000, 420_000));
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const useProxy = Boolean(config.proxyUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (useProxy && isSaasAuthEnabled()) {
      const { session } = await getAuthSnapshot();
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      if (isSaasMockEnabled() && session?.user?.email) headers['X-Studio-Mock-Email'] = session.user.email;
    } else if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const url = useProxy
      ? imageProxyUrl(config.proxyUrl)
      : directImageUrl(config.baseUrl || 'https://api.openai.com');
    const body = useProxy
      ? { prompt, projectId, size: '1536x1536', quality: 'medium' }
      : {
          model: STORYBOARD_GRID_IMAGE_MODEL,
          prompt,
          n: 1,
          size: '1536x1536',
          quality: 'medium',
          output_format: 'jpeg',
          output_compression: 88,
        };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(errorMessage(payload, `图片生成失败（HTTP ${response.status}）。`));

    if (useProxy) {
      const imageDataUrl = typeof payload?.imageDataUrl === 'string' ? payload.imageDataUrl : '';
      if (!imageDataUrl) throw new Error('图片模型未返回可用图像。');
      spendMockCredit(STORYBOARD_GRID_IMAGE_QUOTA_COST);
      if (isSaasAuthEnabled()) requestCreditRefresh();
      return {
        imageDataUrl,
        model: typeof payload?.model === 'string' ? payload.model : STORYBOARD_GRID_IMAGE_MODEL,
        size: typeof payload?.size === 'string' ? payload.size : '1536x1536',
      };
    }

    const data = Array.isArray(payload?.data) ? payload.data : [];
    const first = data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null;
    const b64 = typeof first?.b64_json === 'string' ? first.b64_json : '';
    if (!b64) throw new Error('图片模型未返回可用图像。');
    return {
      imageDataUrl: `data:image/jpeg;base64,${b64}`,
      model: STORYBOARD_GRID_IMAGE_MODEL,
      size: '1536x1536',
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('图片生成超时或已取消。');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
