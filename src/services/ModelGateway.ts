import { safeJsonParse } from '@/services/safeJsonParse';
import { getAuthSnapshot, isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';
import { requestCreditRefresh, spendMockCredit } from '@/services/creditService';

export type ModelGatewayConfig = {
  proxyUrl?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  provider?: 'gpt' | 'deepseek';
  timeoutMs?: number;
};

export type RequestLLMParams = {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  jsonMode: boolean;
  feature?: string;
  maxOutputTokens?: number;
  model?: string;
  signal?: AbortSignal;
};

export type RequestLLMWithImageParams = RequestLLMParams & {
  imageDataUrl: string;
  imageDetail?: 'auto' | 'low' | 'high';
};

export type RequestLLMError = {
  code: string;
  message: string;
  retried: boolean;
};

export type RequestLLMResult =
  | { ok: true; content: string }
  | { ok: false; error: RequestLLMError };

type ChatMessageContentPart = { type?: string; text?: string; content?: string };

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
      reasoning_content?: string | null;
    };
    text?: string | null;
    delta?: {
      content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
    };
  }>;
  message?: { content?: string | null | ChatMessageContentPart | ChatMessageContentPart[] };
  content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
  output_text?: string | null;
  output?: Array<{
    content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
    text?: string | null;
  }>;
  error?: { message?: string; type?: string; code?: string };
};

type StreamChunkJson = {
  choices?: Array<{
    delta?: { content?: string | null | ChatMessageContentPart | ChatMessageContentPart[] };
    message?: { content?: string | null | ChatMessageContentPart | ChatMessageContentPart[] };
    text?: string | null;
  }>;
  output_text?: string | null;
  delta?: string | null;
  content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
  output?: Array<{
    content?: string | null | ChatMessageContentPart | ChatMessageContentPart[];
    text?: string | null;
  }>;
  error?: { message?: string; code?: string; type?: string };
};

const DEFAULT_TIMEOUT_MS = 420_000;
const CHAT_COMPLETIONS_PATH = '/chat/completions';
const PRIMARY_MODEL_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PRIMARY_MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const PRIMARY_MODEL_FAILURE_THRESHOLD = 2;

type ModelFailureState = {
  hits: number[];
  cooldownUntil: number;
};

const modelFailureState = new Map<string, ModelFailureState>();
const USER_ABORT_MESSAGE = '当前任务已停止。';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function joinRelativeUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return CHAT_COMPLETIONS_PATH;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function getGatewayRequestUrl(config: ModelGatewayConfig): string {
  const proxyUrl = config.proxyUrl?.trim();
  if (proxyUrl) {
    if (isAbsoluteHttpUrl(proxyUrl)) return proxyUrl;
    return joinRelativeUrl(proxyUrl);
  }
  const baseUrl = config.baseUrl?.trim() ?? '';
  return `${normalizeOpenAiCompatibleBaseUrl(baseUrl)}${CHAT_COMPLETIONS_PATH}`;
}

export function getGatewayRequestHeaders(config: ModelGatewayConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = config.apiKey?.trim();
  if (!config.proxyUrl && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function getGatewayRequestHeadersForFetch(config: ModelGatewayConfig): Promise<Record<string, string>> {
  const headers = getGatewayRequestHeaders(config);
  if (config.proxyUrl && isSaasAuthEnabled()) {
    const { session } = await getAuthSnapshot();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    if (isSaasMockEnabled() && session?.user?.email) {
      headers['X-Studio-Mock-Email'] = session.user.email;
    }
  }
  return headers;
}

function refreshCreditAfterProxySuccess(config: ModelGatewayConfig): void {
  spendMockCredit(1);
  if (config.proxyUrl && isSaasAuthEnabled()) {
    requestCreditRefresh();
  }
}

function collectContentText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = raw.map((part) => collectContentText(part));
    const joined = parts.join('');
    return joined;
  }
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const text = collectContentText(record.text);
    if (text) return text;
    const content = collectContentText(record.content);
    if (content) return content;
    const outputText = collectContentText(record.output_text);
    if (outputText) return outputText;
  }
  return String(raw);
}

function parseAssistantContent(data: ChatCompletionsResponse): string | null {
  const candidates: unknown[] = [
    data.choices?.[0]?.message?.content,
    data.choices?.[0]?.delta?.content,
    data.choices?.[0]?.text,
    data.message?.content,
    data.content,
    data.output_text,
    data.output,
    data.choices?.[0]?.message?.reasoning_content,
  ];

  for (const candidate of candidates) {
    const text = collectContentText(candidate).trim();
    if (text) return text;
  }
  return null;
}

function normalizeHttpResponseText(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  text = text.replace(/^\)\]\}'\s*\n?/, '').trim();
  return text;
}

function sanitizeGatewayText(raw: string): string {
  return raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/("api[_-]?key"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapNetworkErrorMessage(raw: string): string {
  const text = sanitizeGatewayText(raw);
  if (!text) {
    return '模型请求失败：无法连接到上游服务，请检查网络、代理或接口地址。';
  }
  if (/Failed to fetch/i.test(text)) {
    return '模型请求失败：无法访问上游服务，请检查 Base URL、代理转发或浏览器跨域设置。';
  }
  if (/NetworkError|Load failed|fetch failed/i.test(text)) {
    return '模型请求失败：网络连接中断，请检查当前网络、代理或接口服务是否可达。';
  }
  return `模型请求失败：${text}`;
}

function mapApiErrorMessage(status: number, bodySnippet: string): string | null {
  const text = sanitizeGatewayText(bodySnippet);
  if (!text) return null;

  if (
    status === 400 &&
    /unknown variant [`'"]?image_url|expected [`'"]?text|image[_ -]?url.*expected.*text|does not support.*image|vision.*not supported/i.test(
      text,
    )
  ) {
    return '当前模型通道不支持图片输入：图片节点需要走 GPT/视觉模型。请切换到 GPT，或在服务器配置支持图片理解的 GPT_LLM_MODEL / GPT_LLM_BASE_URL 后重试。';
  }

  if (/^(模型服务|模型请求|无法访问|站内)/.test(text)) {
    return text;
  }
  if (/当前剩余|本次需要|站内次数|站内额度/.test(text) || (status === 402 && /额度不足/.test(text))) {
    return text;
  }
  if (/Concurrency limit exceeded|too many concurrent|concurrency limit|并发.*上限/i.test(text)) {
    return '模型服务并发已达上限：上游当前太忙，请稍后再试。';
  }
  if (/rate limit|too many requests|request limit|请求过于频繁|限流/i.test(text)) {
    return '模型服务限流：请求过于频繁，请稍后再试。';
  }
  if (
    /TokenStatusExhausted|insufficient[_ -]?quota|quota[_ -]?exceeded|quota|credit|billing|balance|prepaid|余额|额度不足|账户.*不足/i.test(
      text,
    ) ||
    status === 402
  ) {
    return '模型服务额度不足：上游模型账户余额或额度不足，请更换可用 Key 或充值后重试。';
  }
  if (/invalid.?api.?key|api key.*invalid|key.*invalid|incorrect api key|authentication|unauthorized|鉴权|认证失败/i.test(text)) {
    return '模型服务鉴权失败：API Key 无效或未正确配置，请检查服务器 .env。';
  }
  if (/permission|forbidden|no permission|access denied|not have access|unsupported_country_region_territory|无权|权限|地区|国家/i.test(text) || status === 403) {
    return '模型服务权限不足：当前 Key 无权访问该模型，或当前服务器地区不被上游支持。';
  }
  if (/model.*not found|unknown model|does not exist|invalid model|模型.*不存在|模型.*无效/i.test(text)) {
    return '模型名称不可用：当前配置的模型不存在或账号未开通，请检查模型设置。';
  }
  if (/context.?length|maximum context|max tokens|too many tokens|token.*exceed|context_length_exceeded|上下文|输入过长/i.test(text)) {
    return '模型输入过长：当前内容超出模型上下文限制，请减少输入或拆分镜头后再试。';
  }
  return null;
}

function mapGatewayMessage(raw: string, status = 0): string {
  return mapApiErrorMessage(status, raw) ?? (sanitizeGatewayText(raw) || '上游服务返回异常。');
}

function isRetryableMessage(raw: string): boolean {
  const text = sanitizeGatewayText(raw);
  return /Concurrency limit exceeded|too many concurrent|rate limit|too many requests|temporarily unavailable|service unavailable|upstream|timeout|timed out|econn|network|fetch/i.test(
    text,
  );
}

function shouldRetryGatewayError(error: RequestLLMError): boolean {
  if (error.code === 'USER_ABORT') return false;
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') return true;
  if (error.code === 'STREAM_ERROR') return isRetryableMessage(error.message);
  if (error.code === 'EMPTY_STREAM' || error.code === 'NO_BODY') return true;
  if (/^HTTP_5\d{2}$/.test(error.code) || error.code === 'HTTP_429') return true;
  return false;
}

function normalizeModelList(models: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const trimmed = model?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function inferredFallbackModels(primaryModel: string, provider?: ModelGatewayConfig['provider']): string[] {
  if (provider === 'deepseek') return [];
  return primaryModel.trim().toLowerCase().includes('gpt-5.5') ? ['gpt-5.4'] : [];
}

function fallbackModelsForConfig(config: ModelGatewayConfig, primaryModel: string): string[] {
  const primaryKey = primaryModel.trim().toLowerCase();
  return normalizeModelList([...(config.fallbackModels ?? []), ...inferredFallbackModels(primaryModel, config.provider)]).filter(
    (model) => model.toLowerCase() !== primaryKey,
  );
}

function modelFailureKey(config: ModelGatewayConfig, primaryModel: string): string {
  return [
    config.provider ?? 'default',
    config.proxyUrl?.trim() || config.baseUrl?.trim() || 'same-origin',
    primaryModel.trim().toLowerCase(),
  ].join('|');
}

function isPrimaryModelCoolingDown(config: ModelGatewayConfig, primaryModel: string): boolean {
  const state = modelFailureState.get(modelFailureKey(config, primaryModel));
  return Boolean(state && state.cooldownUntil > Date.now());
}

function recordPrimaryModelFailure(config: ModelGatewayConfig, primaryModel: string): void {
  const key = modelFailureKey(config, primaryModel);
  const now = Date.now();
  const previous = modelFailureState.get(key);
  const hits = [...(previous?.hits ?? []), now].filter((time) => now - time <= PRIMARY_MODEL_FAILURE_WINDOW_MS);
  modelFailureState.set(key, {
    hits,
    cooldownUntil: hits.length >= PRIMARY_MODEL_FAILURE_THRESHOLD ? now + PRIMARY_MODEL_COOLDOWN_MS : previous?.cooldownUntil ?? 0,
  });
}

function clearPrimaryModelFailures(config: ModelGatewayConfig, primaryModel: string): void {
  modelFailureState.delete(modelFailureKey(config, primaryModel));
}

function modelAttemptPlan(config: ModelGatewayConfig, primaryModel: string): string[] {
  const fallbacks = fallbackModelsForConfig(config, primaryModel);
  if (!fallbacks.length) return [primaryModel];
  return isPrimaryModelCoolingDown(config, primaryModel) ? fallbacks : [primaryModel, ...fallbacks];
}

function markFallbackTried(error: RequestLLMError | null, fallbackModels: string[]): RequestLLMError {
  const base = error ?? {
    code: 'MODEL_FALLBACK_FAILED',
    message: '模型请求失败。',
    retried: true,
  };
  if (!fallbackModels.length) return base;
  return {
    ...base,
    message: `${base.message} 已尝试备用模型 ${fallbackModels.join('、')}，但仍然失败。`,
    retried: true,
  };
}

async function waitBeforeRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parseChatCompletionsResponseBody(text: string): ChatCompletionsResponse | null {
  const normalized = normalizeHttpResponseText(text);
  if (!normalized) return null;

  const tryParse = (input: string): ChatCompletionsResponse | null => {
    const result = safeJsonParse(input);
    if (!result.ok) return null;
    const value = result.value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as ChatCompletionsResponse;
  };

  const direct = tryParse(normalized);
  if (direct) return direct;

  if (/^data:\s*/m.test(normalized) || /\ndata:\s*/.test(normalized)) {
    const chunks: string[] = [];
    let accumulated = '';
    for (const line of normalized.split(/\r?\n/)) {
      const match = line.match(/^data:\s*(.*)$/);
      if (!match) continue;
      const payload = match[1].trim();
      if (!payload || payload === '[DONE]') continue;
      chunks.push(payload);
      const parsed = tryParse(payload) as StreamChunkJson | null;
      if (!parsed) continue;
      accumulated +=
        collectContentText(parsed.choices?.[0]?.delta?.content) ||
        collectContentText(parsed.choices?.[0]?.message?.content) ||
        collectContentText(parsed.choices?.[0]?.text) ||
        collectContentText(parsed.output_text) ||
        collectContentText(parsed.delta) ||
        collectContentText(parsed.content) ||
        collectContentText(parsed.output);
    }
    if (accumulated.trim()) {
      return { choices: [{ message: { content: accumulated } }] };
    }
    const merged = tryParse(chunks.join(''));
    if (merged) return merged;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      const single = tryParse(chunks[index]);
      if (single) return single;
    }
  }

  const start = normalized.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return tryParse(normalized.slice(start, index + 1));
      }
    }
  }
  return null;
}

function mapHttpToFriendly(status: number, bodySnippet: string): string {
  const mapped = mapApiErrorMessage(status, bodySnippet);
  if (mapped) return mapped;
  const snippet = sanitizeGatewayText(bodySnippet);

  if (status === 402) {
    return '模型服务额度不足：上游模型账户余额或额度不足，请更换可用 Key 或充值后重试。';
  }
  if (status === 401 || status === 403) {
    return `模型请求鉴权失败：请检查 Key、代理或上游权限配置。${snippet ? ` 服务端返回：${snippet.slice(0, 240)}` : ''}`;
  }
  if (status === 429) {
    return '模型服务限流：请求过于频繁，请稍后再试。';
  }
  if (status >= 500) {
    return '模型服务暂时不可用：上游服务异常，请稍后再试。';
  }
  if (status === 400) {
    return `模型请求参数无效：请检查模型名、Base URL 或请求格式。${snippet ? ` 服务端返回：${snippet.slice(0, 240)}` : ''}`;
  }
  return `HTTP ${status}${snippet ? ` - ${snippet.slice(0, 200)}` : ''}`;
}

async function requestLLMOnce(
  config: ModelGatewayConfig,
  params: RequestLLMParams,
  model: string,
): Promise<RequestLLMResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = getGatewayRequestUrl(config);

  const body: Record<string, unknown> = {
    model,
    temperature: params.temperature,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
  };
  if (config.proxyUrl && config.provider) {
    body.provider = config.provider;
  }
  if (params.feature?.trim()) {
    body.feature = params.feature.trim();
  }
  if (typeof params.maxOutputTokens === 'number' && Number.isFinite(params.maxOutputTokens) && params.maxOutputTokens > 0) {
    body.max_tokens = Math.floor(params.maxOutputTokens);
  }
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  let abortedByUser = false;
  const onExternalAbort = () => {
    abortedByUser = true;
    controller.abort();
  };
  if (params.signal) {
    if (params.signal.aborted) {
      abortedByUser = true;
      controller.abort();
    } else {
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await getGatewayRequestHeadersForFetch(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text.trim() ? parseChatCompletionsResponseBody(text) ?? {} : {};

    if (!res.ok) {
      const snippet = data.error?.message ?? text;
      return {
        ok: false,
        error: {
          code: `HTTP_${res.status}`,
          message: mapHttpToFriendly(res.status, snippet),
          retried: false,
        },
      };
    }

    if (!text.trim()) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_CONTENT',
          message: '模型请求成功，但响应体为空。',
          retried: false,
        },
      };
    }

    if (!Object.keys(data).length) {
      const snippet = sanitizeGatewayText(text);
      return {
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: `模型服务返回的内容不是合法 JSON。${snippet ? ` 响应片段：${snippet.slice(0, 160)}` : ''}`,
          retried: false,
        },
      };
    }

    const content = parseAssistantContent(data);
    if (content == null) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_CONTENT',
          message: '模型请求成功，但响应中缺少 choices[0].message.content。',
          retried: false,
        },
      };
    }

    refreshCreditAfterProxySuccess(config);
    return { ok: true, content };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const isAbort = name === 'AbortError' || (error instanceof DOMException && error.name === 'AbortError');
    if (isAbort) {
      if (abortedByUser) {
        return {
          ok: false,
          error: {
            code: 'USER_ABORT',
            message: USER_ABORT_MESSAGE,
            retried: false,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `模型请求超时：等待 ${Math.floor(timeoutMs / 1000)} 秒后仍未完成。`,
          retried: false,
        },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        code: 'NETWORK',
        message: mapNetworkErrorMessage(message),
        retried: false,
      },
    };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function requestLLMTextWithRetry(
  config: ModelGatewayConfig,
  params: RequestLLMParams,
  model: string,
): Promise<RequestLLMResult> {
  const first = await requestLLMOnce(config, params, model);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(first.error.code === 'HTTP_429' || first.error.code === 'STREAM_ERROR' ? 1600 : 900, params.signal);
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMOnce(config, params, model);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}

export async function requestLLM(
  config: ModelGatewayConfig,
  params: RequestLLMParams,
): Promise<RequestLLMResult> {
  const model = (params.model ?? config.model)?.trim();
  if (!model) {
    return {
      ok: false,
      error: {
        code: 'MISSING_MODEL',
        message: '未配置模型名称，请在设置或环境变量中补齐。',
        retried: false,
      },
    };
  }

  const attemptPlan = modelAttemptPlan(config, model);
  if (attemptPlan.length > 1 || attemptPlan[0] !== model) {
    let lastFailure: RequestLLMError | null = null;
    const triedFallbackModels: string[] = [];
    for (const attemptModel of attemptPlan) {
      const result = await requestLLMTextWithRetry(config, params, attemptModel);
      if (result.ok) {
        if (attemptModel === model) {
          clearPrimaryModelFailures(config, model);
        }
        return result;
      }
      if (result.error.code === 'USER_ABORT') return result;
      lastFailure = result.error;
      if (attemptModel === model) {
        recordPrimaryModelFailure(config, model);
        if (!shouldRetryGatewayError(result.error)) return result;
      } else {
        triedFallbackModels.push(attemptModel);
      }
    }
    return {
      ok: false,
      error: markFallbackTried(lastFailure, triedFallbackModels),
    };
  }

  const first = await requestLLMOnce(config, params, model);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(first.error.code === 'HTTP_429' || first.error.code === 'STREAM_ERROR' ? 1600 : 900, params.signal);
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMOnce(config, params, model);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}

async function requestLLMWithImageOnce(
  config: ModelGatewayConfig,
  params: RequestLLMWithImageParams,
  model: string,
): Promise<RequestLLMResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = getGatewayRequestUrl(config);
  const imageProvider = config.provider === 'deepseek' ? 'gpt' : config.provider;

  const body: Record<string, unknown> = {
    model,
    temperature: params.temperature,
    messages: [
      { role: 'system', content: params.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: params.userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: params.imageDataUrl,
              ...(params.imageDetail ? { detail: params.imageDetail } : {}),
            },
          },
        ],
      },
    ],
  };
  if (config.proxyUrl && imageProvider) {
    body.provider = imageProvider;
  }
  if (params.feature?.trim()) {
    body.feature = params.feature.trim();
  }
  if (typeof params.maxOutputTokens === 'number' && Number.isFinite(params.maxOutputTokens) && params.maxOutputTokens > 0) {
    body.max_tokens = Math.floor(params.maxOutputTokens);
  }
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  let abortedByUser = false;
  const onExternalAbort = () => {
    abortedByUser = true;
    controller.abort();
  };
  if (params.signal) {
    if (params.signal.aborted) {
      abortedByUser = true;
      controller.abort();
    } else {
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await getGatewayRequestHeadersForFetch(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text.trim() ? parseChatCompletionsResponseBody(text) ?? {} : {};

    if (!res.ok) {
      const snippet = data.error?.message ?? text;
      return {
        ok: false,
        error: {
          code: `HTTP_${res.status}`,
          message: mapHttpToFriendly(res.status, snippet),
          retried: false,
        },
      };
    }

    if (!text.trim()) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_CONTENT',
          message: '模型请求成功，但响应体为空。',
          retried: false,
        },
      };
    }

    if (!Object.keys(data).length) {
      const snippet = sanitizeGatewayText(text);
      return {
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: `模型服务返回的内容不是合法 JSON。${snippet ? ` 响应片段：${snippet.slice(0, 160)}` : ''}`,
          retried: false,
        },
      };
    }

    const content = parseAssistantContent(data);
    if (content == null) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_CONTENT',
          message: '模型请求成功，但响应中缺少 choices[0].message.content。',
          retried: false,
        },
      };
    }

    refreshCreditAfterProxySuccess(config);
    return { ok: true, content };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const isAbort = name === 'AbortError' || (error instanceof DOMException && error.name === 'AbortError');
    if (isAbort) {
      if (abortedByUser) {
        return {
          ok: false,
          error: {
            code: 'USER_ABORT',
            message: USER_ABORT_MESSAGE,
            retried: false,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `模型请求超时：等待 ${Math.floor(timeoutMs / 1000)} 秒后仍未完成。`,
          retried: false,
        },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        code: 'NETWORK',
        message: mapNetworkErrorMessage(message),
        retried: false,
      },
    };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function requestLLMWithImageRetry(
  config: ModelGatewayConfig,
  params: RequestLLMWithImageParams,
  model: string,
): Promise<RequestLLMResult> {
  const first = await requestLLMWithImageOnce(config, params, model);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(first.error.code === 'HTTP_429' || first.error.code === 'STREAM_ERROR' ? 1600 : 900, params.signal);
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMWithImageOnce(config, params, model);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}

export async function requestLLMWithImage(
  config: ModelGatewayConfig,
  params: RequestLLMWithImageParams,
): Promise<RequestLLMResult> {
  const model = (params.model ?? config.model)?.trim();
  if (!model) {
    return {
      ok: false,
      error: {
        code: 'MISSING_MODEL',
        message: '未配置模型名称，请在设置或环境变量中补齐。',
        retried: false,
      },
    };
  }

  const attemptPlan = modelAttemptPlan(config, model);
  if (attemptPlan.length > 1 || attemptPlan[0] !== model) {
    let lastFailure: RequestLLMError | null = null;
    const triedFallbackModels: string[] = [];
    for (const attemptModel of attemptPlan) {
      const result = await requestLLMWithImageRetry(config, params, attemptModel);
      if (result.ok) {
        if (attemptModel === model) {
          clearPrimaryModelFailures(config, model);
        }
        return result;
      }
      if (result.error.code === 'USER_ABORT') return result;
      lastFailure = result.error;
      if (attemptModel === model) {
        recordPrimaryModelFailure(config, model);
        if (!shouldRetryGatewayError(result.error)) return result;
      } else {
        triedFallbackModels.push(attemptModel);
      }
    }
    return {
      ok: false,
      error: markFallbackTried(lastFailure, triedFallbackModels),
    };
  }

  const first = await requestLLMWithImageOnce(config, params, model);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(first.error.code === 'HTTP_429' || first.error.code === 'STREAM_ERROR' ? 1600 : 900, params.signal);
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMWithImageOnce(config, params, model);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}

export type RequestLLMStreamParams = RequestLLMParams & {
  onDelta: (delta: string, accumulated: string) => void;
  onComplete?: (fullText: string) => void;
};

async function requestLLMStreamOnce(
  config: ModelGatewayConfig,
  params: RequestLLMStreamParams,
): Promise<RequestLLMResult> {
  const model = (params.model ?? config.model)?.trim();
  if (!model) {
    return {
      ok: false,
      error: {
        code: 'MISSING_MODEL',
        message: '未配置模型名称，请在设置或环境变量中补齐。',
        retried: false,
      },
    };
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = getGatewayRequestUrl(config);
  const body: Record<string, unknown> = {
    model,
    stream: true,
    temperature: params.temperature,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
  };
  if (config.proxyUrl && config.provider) {
    body.provider = config.provider;
  }
  if (typeof params.maxOutputTokens === 'number' && Number.isFinite(params.maxOutputTokens) && params.maxOutputTokens > 0) {
    body.max_tokens = Math.floor(params.maxOutputTokens);
  }
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  let abortedByUser = false;
  const onExternalAbort = () => {
    abortedByUser = true;
    controller.abort();
  };
  if (params.signal) {
    if (params.signal.aborted) {
      abortedByUser = true;
      controller.abort();
    } else {
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let accumulated = '';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await getGatewayRequestHeadersForFetch(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const snippet = await res.text();
      return {
        ok: false,
        error: {
          code: `HTTP_${res.status}`,
          message: mapHttpToFriendly(res.status, snippet),
          retried: false,
        },
      };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return {
        ok: false,
        error: {
          code: 'NO_BODY',
          message: '模型流式响应不可读，代理或上游可能不支持流式输出。',
          retried: false,
        },
      };
    }

    const decoder = new TextDecoder();
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === 'data: [DONE]') continue;
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        const parsed = safeJsonParse(payload);
        if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;
        const json = parsed.value as StreamChunkJson;
        if (json.error?.message) {
          const rawCode = String(json.error.code ?? '').trim();
          const code =
            rawCode === '429' || /rate.?limit|concurrency/i.test(json.error.message)
              ? 'HTTP_429'
              : rawCode || 'STREAM_ERROR';
          return {
            ok: false,
            error: {
              code,
              message: mapGatewayMessage(json.error.message, 0),
              retried: false,
            },
          };
        }
        const piece = collectContentText(json.choices?.[0]?.delta?.content);
        if (piece) {
          accumulated += piece;
          params.onDelta(piece, accumulated);
        }
      }
    }

    params.onComplete?.(accumulated);

    if (!accumulated.trim()) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_STREAM',
          message: '流式响应结束了，但没有收到任何文本内容。',
          retried: false,
        },
      };
    }

    refreshCreditAfterProxySuccess(config);
    return { ok: true, content: accumulated };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const isAbort = name === 'AbortError' || (error instanceof DOMException && error.name === 'AbortError');
    if (isAbort) {
      if (abortedByUser) {
        return {
          ok: false,
          error: {
            code: 'USER_ABORT',
            message: USER_ABORT_MESSAGE,
            retried: false,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `模型流式请求超时：等待 ${Math.floor(timeoutMs / 1000)} 秒后仍未完成。`,
          retried: false,
        },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        code: 'NETWORK',
        message: mapNetworkErrorMessage(message),
        retried: false,
      },
    };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function requestLLMStreamWithRetry(
  config: ModelGatewayConfig,
  params: RequestLLMStreamParams,
  model: string,
): Promise<RequestLLMResult> {
  const paramsWithModel = { ...params, model };
  const first = await requestLLMStreamOnce(config, paramsWithModel);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(
      first.error.code === 'HTTP_429' || /骞跺彂|闄愭祦/.test(first.error.message) ? 1600 : 900,
      params.signal,
    );
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMStreamOnce(config, paramsWithModel);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}

export async function requestLLMStream(
  config: ModelGatewayConfig,
  params: RequestLLMStreamParams,
): Promise<RequestLLMResult> {
  const model = (params.model ?? config.model)?.trim();
  if (model) {
    const attemptPlan = modelAttemptPlan(config, model);
    if (attemptPlan.length > 1 || attemptPlan[0] !== model) {
      let lastFailure: RequestLLMError | null = null;
      const triedFallbackModels: string[] = [];
      for (const attemptModel of attemptPlan) {
        const result = await requestLLMStreamWithRetry(config, params, attemptModel);
        if (result.ok) {
          if (attemptModel === model) {
            clearPrimaryModelFailures(config, model);
          }
          return result;
        }
        if (result.error.code === 'USER_ABORT') return result;
        lastFailure = result.error;
        if (attemptModel === model) {
          recordPrimaryModelFailure(config, model);
          if (!shouldRetryGatewayError(result.error)) return result;
        } else {
          triedFallbackModels.push(attemptModel);
        }
      }
      return {
        ok: false,
        error: markFallbackTried(lastFailure, triedFallbackModels),
      };
    }
  }

  const first = await requestLLMStreamOnce(config, params);
  if (first.ok) return first;
  if (first.error.code === 'USER_ABORT') return first;
  if (!shouldRetryGatewayError(first.error)) return first;

  try {
    await waitBeforeRetry(
      first.error.code === 'HTTP_429' || /并发|限流/.test(first.error.message) ? 1600 : 900,
      params.signal,
    );
  } catch {
    return {
      ok: false,
      error: {
        code: 'USER_ABORT',
        message: USER_ABORT_MESSAGE,
        retried: false,
      },
    };
  }

  const second = await requestLLMStreamOnce(config, params);
  if (second.ok) return second;
  if (second.error.code === 'USER_ABORT') return second;

  return {
    ok: false,
    error: {
      code: second.error.code,
      message: `${second.error.message} 已自动重试 1 次，但仍然失败。`,
      retried: true,
    },
  };
}
