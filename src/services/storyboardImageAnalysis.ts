import { getLlmSettingsFormDefaults, getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import {
  getGatewayRequestHeaders,
  getGatewayRequestUrl,
  requestLLM,
} from '@/services/ModelGateway';
import { safeJsonParse } from '@/services/safeJsonParse';
import type { StoryboardOutput, StoryboardShot } from '@/types/studio';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

type ImageStoryboardRow = {
  id?: number | string;
  shotNo?: number | string;
  type?: string;
  movement?: string;
  description?: string;
  content?: string;
  sceneRef?: string;
  action?: string;
  sound?: string;
  note?: string;
  durationSec?: number | string;
};

type ImageStoryboardResponse = {
  sheetTitle?: string;
  summary?: string;
  shots?: ImageStoryboardRow[];
  rows?: ImageStoryboardRow[];
  table?: ImageStoryboardRow[];
  items?: ImageStoryboardRow[];
  data?: ImageStoryboardRow[];
};

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string; content?: string }> | null;
    };
  }>;
  error?: { message?: string; type?: string; code?: string };
};

const MAX_IMAGE_STORYBOARD_SHOTS = 300;
const IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS = 16_000;

function asText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const direct = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const matches = String(value ?? '').match(/\d+/g);
  if (!matches?.length) return fallback;
  const last = Number.parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(last) && last > 0 ? last : fallback;
}

function parseDurationSec(value: unknown): number | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const direct = Number.parseFloat(text);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return undefined;
  const parsed = Number.parseFloat(matches[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeFieldKey(key: string): string {
  return key.replace(/\s+/g, '').replace(/[：:]/g, '').trim().toLowerCase();
}

function pickField(source: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const direct = source[alias];
    if (direct != null && `${direct}`.trim()) return direct;
  }
  const normalizedAliasSet = new Set(aliases.map((alias) => normalizeFieldKey(alias)));
  for (const [key, value] of Object.entries(source)) {
    if (!normalizedAliasSet.has(normalizeFieldKey(key))) continue;
    if (value != null && `${value}`.trim()) return value;
  }
  return undefined;
}

function asStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function normalizeImageStoryboardRow(raw: unknown): ImageStoryboardRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const noteValue = pickField(source, ['note', '备注', '补充说明']);
  const soundValue = pickField(source, ['sound', '音效', '声音']);
  return {
    id: asStringOrNumber(pickField(source, ['id', '序号', '编号', 'index'])),
    shotNo: asStringOrNumber(pickField(source, ['shotNo', 'shot_no', 'shotId', '镜头号', '镜号', '镜头编号'])),
    type: typeof pickField(source, ['type', '景别']) === 'string' ? String(pickField(source, ['type', '景别'])) : undefined,
    movement:
      typeof pickField(source, ['movement', 'cameraMovement', '镜头运动', '运镜', '镜头运动方式']) === 'string'
        ? String(pickField(source, ['movement', 'cameraMovement', '镜头运动', '运镜', '镜头运动方式']))
        : undefined,
    description:
      typeof pickField(source, ['description', '制作内容文字描述', '制作内容描述', '制作内容', '画面描述', '内容描述']) === 'string'
        ? String(pickField(source, ['description', '制作内容文字描述', '制作内容描述', '制作内容', '画面描述', '内容描述']))
        : undefined,
    content:
      typeof pickField(source, ['content', 'dialogue', '台词', '对白']) === 'string'
        ? String(pickField(source, ['content', 'dialogue', '台词', '对白']))
        : undefined,
    sceneRef:
      typeof pickField(source, ['sceneRef', 'scene', '场次', '场景']) === 'string'
        ? String(pickField(source, ['sceneRef', 'scene', '场次', '场景']))
        : undefined,
    action:
      typeof pickField(source, ['action', '动作', '动作调度']) === 'string'
        ? String(pickField(source, ['action', '动作', '动作调度']))
        : undefined,
    sound: typeof soundValue === 'string' ? String(soundValue) : undefined,
    note: typeof noteValue === 'string' ? String(noteValue) : undefined,
    durationSec: asStringOrNumber(pickField(source, ['durationSec', 'duration', '时长', '秒数', '帧数'])),
  };
}

function extractRawRows(data: ImageStoryboardResponse): unknown[] {
  const candidates = [data.shots, data.rows, data.table, data.items, data.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

function normalizeShot(row: ImageStoryboardRow, index: number): StoryboardShot | null {
  const id = parsePositiveInt(row.id ?? row.shotNo, index + 1);
  const shotNo = asText(row.shotNo);
  const description = asText(row.description);
  const content = asText(row.content);
  const sceneRef = asText(row.sceneRef);
  const action = asText(row.action);
  const sound = asText(row.sound);
  const note = asText(row.note);
  const movement = asText(row.movement) || '固定';
  const type = asText(row.type) || '中景';
  if (!description && !content && !action && !sound && !note) return null;
  return {
    id,
    shotNo: shotNo || undefined,
    wireId: createStoryboardShotWireId(id),
    type,
    movement,
    description: description || action || note,
    content,
    sceneRef: sceneRef || undefined,
    action: action || undefined,
    sound: sound || undefined,
    durationSec: parseDurationSec(row.durationSec),
    note: note || undefined,
  };
}

function buildNarrativeBeats(shots: StoryboardShot[], title?: string): string[] {
  const scenes = [...new Set(shots.map((shot) => shot.sceneRef?.trim()).filter(Boolean))];
  if (scenes.length > 0) {
    return scenes.map((scene, index) => `场次 ${index + 1}：${scene}`);
  }
  if (title?.trim()) {
    return [`已从图片表格解析出 ${shots.length} 条镜头，来源：${title.trim()}`];
  }
  return [`已从图片表格解析出 ${shots.length} 条镜头。`];
}

function buildSystemPrompt(): string {
  return [
    'You are an image-table-to-storyboard extractor.',
    'Read the image and normalize the visible table into our internal storyboard schema.',
    'Do not insist on reproducing the original column names exactly; instead map them semantically.',
    'Only use content that is clearly visible in the image. Do not invent hidden rows or missing text.',
    'If a cell is partially readable, prefer a shorter clean phrase over a broken fragment.',
    'Return a single JSON object with keys: sheetTitle, summary, shots.',
    'shots must be an array of objects using only these keys:',
    'id, shotNo, type, movement, description, content, sceneRef, action, sound, note, durationSec',
    'Field mapping rules:',
    '- shotNo: 镜头号 / 镜号 / shot id',
    '- type: 景别',
    '- movement: 镜头运动 / 运镜',
    '- description: 制作内容描述 / 画面描述 / 内容描述',
    '- content: 台词 / 对白',
    '- sceneRef: 场次 / 场景',
    '- action: 动作 / 调度',
    '- sound: 音效 / 声音提示',
    '- note: 备注 / 补充说明',
    '- durationSec: 帧数 / 秒数 / 时长 if confidently inferable',
    'Do not output markdown. Do not wrap in code fences. Output JSON only.',
  ].join('\n');
}

function buildUserPrompt(): string {
  return [
    'Please analyze this storyboard table image and convert the visible rows into the normalized storyboard JSON schema.',
    `Keep as many visible rows as possible, up to ${MAX_IMAGE_STORYBOARD_SHOTS} rows in source order.`,
    'If the source table format is non-standard, still map by meaning into the target fields.',
    'Never output explanations. JSON only.',
  ].join('\n');
}

function buildRepairPrompt(originalPrompt: string, rawContent: string): string {
  return [
    'The previous output was not valid JSON.',
    'Rewrite it into one strict JSON object only.',
    'Do not add explanations. Do not add markdown.',
    '',
    '[Original task]',
    originalPrompt,
    '',
    '[Previous output]',
    rawContent.trim().slice(0, 24_000) || '(empty)',
    '',
    '[Required JSON shape]',
    '{"sheetTitle":"","summary":"","shots":[{"id":"","shotNo":"","type":"","movement":"","description":"","content":"","sceneRef":"","action":"","sound":"","note":"","durationSec":""}]}',
  ].join('\n');
}

function buildStructuredFallbackPrompt(): string {
  return [
    'If strict JSON is unstable, output a normalized markdown table instead.',
    'Do not add prose around the table.',
    `Keep as many visible rows as possible, up to ${MAX_IMAGE_STORYBOARD_SHOTS} rows in source order.`,
    'You may optionally output:',
    '[sheetTitle] 表格标题',
    '[summary] 一句话概括识别结果',
    'Then output a markdown table with semantic columns such as:',
    '| 序号 | 镜头号 | 景别 | 镜头运动 | 制作内容描述 | 台词 | 场次 | 动作 | 音效 | 备注 | 时长 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 89 | LCFR_01_0540 | 中景 | 手持固定机位 | 黑牡丹看到了让汉被杀，瞳孔一缩，立刻起身。 |  | 第一场 | 起身 |  |  |  |',
    'If some columns are absent in the image, leave them blank but keep the row readable.',
  ].join('\n');
}

function extractMessageText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as ChatCompletionsResponse;
  const raw = root.choices?.[0]?.message?.content;
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  return raw
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
      }
      return '';
    })
    .join('');
}

function extractBalancedJsonObject(raw: string): string | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function tryParseResponseJson(raw: string): ImageStoryboardResponse | null {
  const direct = safeJsonParse(raw);
  if (direct.ok && direct.value && typeof direct.value === 'object' && !Array.isArray(direct.value)) {
    return direct.value as ImageStoryboardResponse;
  }
  const balanced = extractBalancedJsonObject(raw);
  if (!balanced) return null;
  const recovered = safeJsonParse(balanced);
  if (!recovered.ok || !recovered.value || typeof recovered.value !== 'object' || Array.isArray(recovered.value)) {
    return null;
  }
  return recovered.value as ImageStoryboardResponse;
}

function parseDelimitedRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if (line.includes('|')) {
    return line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell, index, arr) => !(index === 0 && cell === '') && !(index === arr.length - 1 && cell === ''));
  }
  return [];
}

function looksLikeDividerRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function normalizeHeaderCell(cell: string): string {
  return cell.replace(/\s+/g, '').replace(/[：:]/g, '').trim().toLowerCase();
}

function resolveHeaderRole(header: string): keyof ImageStoryboardRow | 'index' | null {
  const normalized = normalizeHeaderCell(header);
  if (!normalized) return null;
  if (['序号', '编号', '行号', 'index'].includes(normalized)) return 'index';
  if (['镜头号', '镜号', '镜头编号', 'shotno', 'shotid'].includes(normalized)) return 'shotNo';
  if (['景别', 'type'].includes(normalized)) return 'type';
  if (['镜头运动', '运镜', 'movement', '镜头运动方式'].includes(normalized)) return 'movement';
  if (
    ['制作内容文字描述', '制作内容描述', '制作内容', '画面描述', '内容描述', 'description', '内容', '制作内容说明'].includes(
      normalized,
    )
  ) {
    return 'description';
  }
  if (['台词', '对白', 'content'].includes(normalized)) return 'content';
  if (['场次', '场景', 'sceneref'].includes(normalized)) return 'sceneRef';
  if (['动作', 'action'].includes(normalized)) return 'action';
  if (['音效', 'sound'].includes(normalized)) return 'sound';
  if (['备注', 'note'].includes(normalized)) return 'note';
  if (['帧数', '时长', '秒数', 'duration', 'durationsec'].includes(normalized)) return 'durationSec';
  return null;
}

function parseMarkdownTable(raw: string): ImageStoryboardResponse | null {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tableLines = lines.filter((line) => line.includes('|'));
  if (tableLines.length < 3) return null;

  let headerIndex = -1;
  let headerCells: string[] = [];
  for (let index = 0; index < tableLines.length; index += 1) {
    const cells = parseDelimitedRow(tableLines[index]);
    if (cells.length < 4) continue;
    const hitCount = cells.map(resolveHeaderRole).filter(Boolean).length;
    if (hitCount >= 3) {
      headerIndex = index;
      headerCells = cells;
      break;
    }
  }
  if (headerIndex < 0) return null;

  const columnRoles = headerCells.map(resolveHeaderRole);
  const rows: ImageStoryboardRow[] = [];
  for (const line of tableLines.slice(headerIndex + 1)) {
    const cells = parseDelimitedRow(line);
    if (cells.length < 2 || looksLikeDividerRow(cells)) continue;
    const row: ImageStoryboardRow = {};
    columnRoles.forEach((role, index) => {
      if (!role || role === 'index') return;
      row[role] = cells[index] ?? '';
    });
    if (Object.values(row).some((value) => asText(value))) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return null;
  return {
    summary: `已按 markdown 表格识别 ${rows.length} 条镜头。`,
    shots: rows,
  };
}

function parseStructuredFallback(raw: string): ImageStoryboardResponse | null {
  const text = raw.replace(/\r/g, '').trim();
  if (!text) return null;

  const markdownTable = parseMarkdownTable(text);
  if (markdownTable) return markdownTable;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const sheetTitle =
    lines.find((line) => /^\[sheettitle\]/i.test(line))?.replace(/^\[sheettitle\]\s*/i, '') ?? '';
  const summary =
    lines.find((line) => /^\[summary\]/i.test(line))?.replace(/^\[summary\]\s*/i, '') ?? '';

  let rowsStart = lines.findIndex((line) => /^\[shots\]$/i.test(line));
  if (rowsStart >= 0) rowsStart += 1;
  if (rowsStart < 0) {
    rowsStart = lines.findIndex((line) => /\|\s*(序号|镜头号|shotno)\s*\|/i.test(line));
  }
  if (rowsStart < 0) return null;

  const rows: ImageStoryboardRow[] = [];
  for (const line of lines.slice(rowsStart)) {
    if (/^\[sheettitle\]|\[summary\]|\[shots\]$/i.test(line)) continue;
    const cells = parseDelimitedRow(line);
    if (cells.length < 4 || looksLikeDividerRow(cells)) continue;
    if (/^(序号|镜头号|shotno)$/i.test(cells[0])) continue;
    rows.push({
      shotNo: cells[0] ?? '',
      type: cells[1] ?? '',
      movement: cells[2] ?? '',
      description: cells[3] ?? '',
      content: cells[4] ?? '',
      sceneRef: cells[5] ?? '',
      action: cells[6] ?? '',
      sound: cells[7] ?? '',
      note: cells[8] ?? '',
      durationSec: cells[9] ?? '',
    });
  }

  if (rows.length === 0) return parseMarkdownTable(text);
  return { sheetTitle, summary, shots: rows };
}

async function requestImageAnalysis(params: {
  model: string;
  imageDataUrl: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const gateway = getResolvedLlmGatewayConfig();
  if (!gateway) {
    throw new Error('未配置可用模型网关。请先填写代理 URL，或配置 Base URL 与 API Key。');
  }

  const url = getGatewayRequestUrl(gateway);
  let lastErrorText = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: getGatewayRequestHeaders(gateway),
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        temperature: 0.1,
        max_tokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS,
        ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: params.systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: params.userPrompt },
              { type: 'image_url', image_url: { url: params.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const raw = await response.text();
    if (response.ok) {
      const outer = safeJsonParse(raw);
      if (!outer.ok) return raw;
      return extractMessageText(outer.value) || raw;
    }

    lastErrorText = raw;
    if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      continue;
    }
    throw new Error(`图片解析请求失败：HTTP ${response.status} ${raw.slice(0, 200)}`.trim());
  }

  throw new Error(`图片解析请求失败：${lastErrorText.slice(0, 200)}`.trim());
}

async function repairResponseJson(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  rawContent: string;
  signal?: AbortSignal;
}): Promise<ImageStoryboardResponse | null> {
  const gateway = getResolvedLlmGatewayConfig();
  if (!gateway) return null;

  const result = await requestLLM(gateway, {
    model: params.model,
    systemPrompt: params.systemPrompt,
    userPrompt: buildRepairPrompt(params.userPrompt, params.rawContent),
    jsonMode: true,
    temperature: 0.1,
    maxOutputTokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS,
    signal: params.signal,
  });

  if (!result.ok) return null;
  return tryParseResponseJson(result.content);
}

async function repairFallbackStructuredContent(params: {
  model: string;
  systemPrompt: string;
  rawContent: string;
  signal?: AbortSignal;
}): Promise<ImageStoryboardResponse | null> {
  const gateway = getResolvedLlmGatewayConfig();
  if (!gateway) return null;

  const repairPrompt = [
    '请把下面这段“图片表格识别结果”整理成合法 JSON。',
    '不要解释，不要 markdown，不要补剧情。',
    '只输出一个 JSON 对象，字段固定为：sheetTitle, summary, shots。',
    'shots 中每项字段固定为：id, shotNo, type, movement, description, content, sceneRef, action, sound, note, durationSec。',
    '',
    '[待整理内容]',
    params.rawContent.trim().slice(0, 48_000) || '(empty)',
  ].join('\n');

  const result = await requestLLM(gateway, {
    model: params.model,
    systemPrompt: params.systemPrompt,
    userPrompt: repairPrompt,
    jsonMode: true,
    temperature: 0.1,
    maxOutputTokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS,
    signal: params.signal,
  });

  if (!result.ok) return null;
  return tryParseResponseJson(result.content);
}

export async function analyzeStoryboardImageToOutput(params: {
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<{ storyboard: StoryboardOutput; summary: string; sheetTitle: string }> {
  const gateway = getResolvedLlmGatewayConfig();
  if (!gateway) {
    throw new Error('未配置可用模型网关。请先填写代理 URL，或配置 Base URL 与 API Key。');
  }

  const settings = getLlmSettingsFormDefaults();
  const model = settings.deepModel?.trim() || gateway.model?.trim();
  if (!model) {
    throw new Error('未配置可用的 Deep 模型，暂时无法解析图片表格。');
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = gateway.timeoutMs ?? 180_000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const debugSteps: string[] = [];

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt();

    const rawContent = await requestImageAnalysis({
      model,
      imageDataUrl: params.imageDataUrl,
      systemPrompt,
      userPrompt,
      jsonMode: true,
      signal: controller.signal,
    });
    debugSteps.push('首轮图片识别已返回内容');

    let data = tryParseResponseJson(rawContent);
    debugSteps.push(data ? '首轮 JSON 解析成功' : '首轮 JSON 解析失败');

    if (!data) {
      data = await repairResponseJson({
        model,
        systemPrompt,
        userPrompt,
        rawContent,
        signal: controller.signal,
      });
      debugSteps.push(data ? 'JSON 修复成功' : 'JSON 修复失败');
    }

    let fallbackRaw = '';

    if (!data) {
      fallbackRaw = await requestImageAnalysis({
        model,
        imageDataUrl: params.imageDataUrl,
        systemPrompt,
        userPrompt: buildStructuredFallbackPrompt(),
        jsonMode: false,
        signal: controller.signal,
      });
      debugSteps.push('已拿到结构化表格回退内容');
      data = parseStructuredFallback(fallbackRaw);
      debugSteps.push(data ? '结构化表格回退解析成功' : '结构化表格回退解析失败');
    }

    if (!data && fallbackRaw) {
      data = await repairFallbackStructuredContent({
        model,
        systemPrompt,
        rawContent: fallbackRaw,
        signal: controller.signal,
      });
      debugSteps.push(data ? '表格文本二次整理成功' : '表格文本二次整理失败');
    }

    if (!data) {
      throw new Error(`图片解析失败：模型返回内容无法整理成镜头结构。诊断：${debugSteps.join(' -> ')}`);
    }

    const normalizedShots = extractRawRows(data)
      .map((row) => normalizeImageStoryboardRow(row))
      .map((shot, index) => normalizeShot(shot, index))
      .filter((shot): shot is StoryboardShot => shot != null)
      .slice(0, MAX_IMAGE_STORYBOARD_SHOTS);

    if (normalizedShots.length === 0) {
      throw new Error(asText(data.summary) || `未能从图片中识别出有效镜头行。诊断：${debugSteps.join(' -> ')}`);
    }

    return {
      storyboard: {
        shots: normalizedShots,
        narrativeBeats: buildNarrativeBeats(normalizedShots, asText(data.sheetTitle)),
      },
      summary: asText(data.summary) || `已识别 ${normalizedShots.length} 条镜头。`,
      sheetTitle: asText(data.sheetTitle) || '图片表格',
    };
  } catch (error) {
    if (controller.signal.aborted && params.signal?.aborted) {
      throw new Error('图片解析已取消。');
    }
    if (controller.signal.aborted) {
      throw new Error('图片解析超时，请稍后重试。');
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 503|temporarily unavailable|Service temporarily unavailable/i.test(message)) {
      throw new Error(`图片解析失败：上游识别服务暂时不可用，请稍后再试。诊断：${debugSteps.join(' -> ') || '接口请求未成功'}`);
    }
    throw new Error(message);
  } finally {
    window.clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
