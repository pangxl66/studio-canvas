import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type AuthedUser = {
  id: string;
  email?: string | null;
};

type ChatMessage = {
  role?: string;
  content?: unknown;
};

type ChatRequestBody = {
  feature?: string;
  projectId?: string | null;
  model?: string;
  stream?: boolean;
  temperature?: number;
  messages?: ChatMessage[];
  max_tokens?: number;
  maxOutputTokens?: number;
  response_format?: unknown;
};

type LlmUsageInsert = {
  user_id: string;
  project_id?: string | null;
  feature: string;
  model?: string;
  input_chars: number;
  output_chars: number;
  estimated_tokens: number;
  quota_cost: number;
  status: 'success' | 'failed';
  error_message?: string;
};

type AnySupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: AuthedUser | null }; error: { message: string } | null }>;
  };
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

type QuotaRpcRow = {
  ok?: boolean;
  remaining_quota?: number;
};

type QuotaReservation =
  | { ok: true; remaining: number }
  | { ok: false; message: string; remaining: number };

const MAX_INPUT_CHARS = 80_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = 'gpt-5.5';
const CHAT_COMPLETIONS_PATH = '/chat/completions';

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
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

function getUpstreamUrl(): string {
  const proxyUrl = env('LLM_PROXY_URL');
  if (proxyUrl) return proxyUrl;
  const baseUrl = env('LLM_BASE_URL');
  if (!baseUrl) return '';
  return `${normalizeBaseUrl(baseUrl)}${CHAT_COMPLETIONS_PATH}`;
}

function sanitizeError(raw: unknown): string {
  return String(raw ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/("api[_-]?key"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function readBody(req: IncomingMessage): Promise<ChatRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as ChatRequestBody;
}

function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function bodyInputChars(body: ChatRequestBody): number {
  return JSON.stringify(body.messages ?? []).length;
}

function extractOutputChars(rawText: string): number {
  try {
    const parsed = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.length;
  } catch {
    // Fall back to raw response length.
  }
  return rawText.length;
}

function estimateTokens(inputChars: number, outputChars: number): number {
  return Math.ceil((inputChars + outputChars) / 2);
}

function quotaCostForFeature(feature: string, body: ChatRequestBody): number {
  if (feature === 'prompt-generate-multi') return 2;
  if (feature === 'prompt-review') return 1;
  if (feature === 'text-polish') return 1;
  if ((body.messages?.length ?? 0) > 2) return 2;
  return 1;
}

function configuredModelForFeature(feature?: string): string {
  const normalizedFeature = feature?.trim() ?? '';
  if (normalizedFeature === 'text-polish') {
    return env('LLM_FAST_MODEL') || env('LLM_MODEL');
  }
  if (normalizedFeature === 'prompt-review') {
    return env('LLM_DEEP_MODEL') || env('LLM_MODEL');
  }
  return env('LLM_MODEL');
}

function normalizeModel(model?: string, feature?: string): string {
  return configuredModelForFeature(feature) || model?.trim() || DEFAULT_MODEL;
}

function buildUpstreamBody(body: ChatRequestBody): Record<string, unknown> {
  const maxTokens = body.max_tokens ?? body.maxOutputTokens;
  const upstreamBody: Record<string, unknown> = {
    messages: body.messages,
    model: normalizeModel(body.model, body.feature),
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.35,
  };
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    upstreamBody.max_tokens = Math.floor(maxTokens);
  }
  if (body.response_format) {
    upstreamBody.response_format = body.response_format;
  }
  return upstreamBody;
}

function validateRequestBody(body: ChatRequestBody): string | null {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return '请求缺少 messages。';
  }
  if (body.messages.some((message) => typeof message.role !== 'string')) {
    return 'messages 中存在无效 role。';
  }
  const inputChars = bodyInputChars(body);
  if (inputChars > MAX_INPUT_CHARS) {
    return `单次输入过长，当前约 ${inputChars} 字符，上限 ${MAX_INPUT_CHARS}。`;
  }
  return null;
}

function getAuthClients(token: string): { authClient: AnySupabaseClient; serviceClient: AnySupabaseClient } {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Server Supabase env is missing.');
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }) as unknown as AnySupabaseClient,
    serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey) as unknown as AnySupabaseClient,
  };
}

async function ensureUserRows(serviceClient: AnySupabaseClient, user: AuthedUser): Promise<void> {
  await Promise.all([
    serviceClient.from('profiles').upsert(
      {
        id: user.id,
        email: user.email ?? null,
      },
      { onConflict: 'id' },
    ),
    serviceClient.from('credit_wallets').upsert(
      {
        user_id: user.id,
        monthly_quota: 50,
        remaining_quota: 50,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ),
  ]);
}

function firstRpcRow(data: unknown): QuotaRpcRow | null {
  if (Array.isArray(data)) {
    return (data[0] as QuotaRpcRow | undefined) ?? null;
  }
  if (data && typeof data === 'object') {
    return data as QuotaRpcRow;
  }
  return null;
}

async function reserveQuota(
  serviceClient: AnySupabaseClient,
  userId: string,
  quotaCost: number,
): Promise<QuotaReservation> {
  const { data, error } = await serviceClient.rpc('reserve_credit_quota', {
    p_cost: quotaCost,
    p_user_id: userId,
  });

  if (error) {
    console.warn('Credit reservation RPC failed', sanitizeError(error.message));
    return {
      ok: false,
      message: '站内次数预扣失败，请更新 Supabase SQL 后重试。',
      remaining: 0,
    };
  }

  const row = firstRpcRow(data);
  const remaining = Number(row?.remaining_quota ?? 0);
  if (!row?.ok) {
    return {
      ok: false,
      message: `额度不足，当前剩余 ${remaining} 次，本次需要 ${quotaCost} 次。`,
      remaining,
    };
  }

  return { ok: true, remaining };
}

async function writeUsage(serviceClient: AnySupabaseClient, usage: LlmUsageInsert): Promise<void> {
  await serviceClient.from('usage_events').insert(usage);
}

async function refundQuota(serviceClient: AnySupabaseClient, userId: string, quotaCost: number): Promise<void> {
  const { error } = await serviceClient.rpc('refund_credit_quota', {
    p_cost: quotaCost,
    p_user_id: userId,
  });
  if (error) {
    console.warn('Credit refund failed', sanitizeError(error.message));
  }
}

async function callUpstream(body: ChatRequestBody): Promise<Response> {
  const upstreamUrl = getUpstreamUrl();
  const apiKey = env('LLM_API_KEY');
  if (!upstreamUrl || !apiKey) {
    throw new Error('LLM upstream env is missing.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildUpstreamBody(body)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  let body: ChatRequestBody;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }

  const validationError = validateRequestBody(body);
  if (validationError) {
    json(res, 400, { error: { message: validationError } });
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    json(res, 401, { error: { message: '请先登录后再生成。' } });
    return;
  }

  let userId = '';
  let serviceClient: AnySupabaseClient;
  try {
    const clients = getAuthClients(token);
    serviceClient = clients.serviceClient;
    const { data, error } = await clients.authClient.auth.getUser();
    if (error || !data.user) {
      json(res, 401, { error: { message: '登录状态已失效，请重新登录。' } });
      return;
    }
    userId = data.user.id;
    await ensureUserRows(serviceClient, data.user);
  } catch (error) {
    json(res, 500, { error: { message: sanitizeError(error) || '服务器鉴权配置缺失。' } });
    return;
  }

  const feature = body.feature?.trim() || 'llm-chat';
  const quotaCost = quotaCostForFeature(feature, body);
  const inputChars = bodyInputChars(body);
  const model = normalizeModel(body.model, feature);

  console.log(
    'LLM chat request received',
    JSON.stringify({
      feature,
      model,
      requestedModel: body.model?.trim() || null,
      inputChars,
    }),
  );

  const quotaReservation = await reserveQuota(serviceClient, userId, quotaCost);
  if (quotaReservation.ok === false) {
    console.warn(
      'LLM quota reservation failed',
      JSON.stringify({
        feature,
        model,
        quotaCost,
        remaining: quotaReservation.remaining,
        message: sanitizeError(quotaReservation.message),
      }),
    );
    await writeUsage(serviceClient, {
      user_id: userId,
      project_id: body.projectId ?? null,
      feature,
      model,
      input_chars: inputChars,
      output_chars: 0,
      estimated_tokens: estimateTokens(inputChars, 0),
      quota_cost: 0,
      status: 'failed',
      error_message: quotaReservation.message,
    });
    json(res, 402, { error: { message: quotaReservation.message } });
    return;
  }

  try {
    const upstreamResponse = await callUpstream(body);
    const rawText = await upstreamResponse.text();
    const outputChars = extractOutputChars(rawText);
    const isOk = upstreamResponse.ok;

    await writeUsage(serviceClient, {
      user_id: userId,
      project_id: body.projectId ?? null,
      feature,
      model,
      input_chars: inputChars,
      output_chars: isOk ? outputChars : 0,
      estimated_tokens: estimateTokens(inputChars, isOk ? outputChars : 0),
      quota_cost: isOk ? quotaCost : 0,
      status: isOk ? 'success' : 'failed',
      error_message: isOk ? undefined : sanitizeError(rawText),
    });

    if (!isOk) {
      console.warn(
        'LLM upstream failed',
        JSON.stringify({
          status: upstreamResponse.status,
          model,
          feature,
          body: sanitizeError(rawText),
        }),
      );
      await refundQuota(serviceClient, userId, quotaCost);
    }

    res.statusCode = upstreamResponse.status;
    res.setHeader(
      'content-type',
      upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    );
    res.setHeader('cache-control', 'no-store');
    res.end(rawText);
  } catch (error) {
    await refundQuota(serviceClient, userId, quotaCost);
    const errorMessage =
      error instanceof Error && error.name === 'AbortError'
        ? '模型请求超时，请稍后重试。'
        : sanitizeError(error) || '模型请求失败。';
    await writeUsage(serviceClient, {
      user_id: userId,
      project_id: body.projectId ?? null,
      feature,
      model,
      input_chars: inputChars,
      output_chars: 0,
      estimated_tokens: estimateTokens(inputChars, 0),
      quota_cost: 0,
      status: 'failed',
      error_message: errorMessage,
    });
    json(res, 502, { error: { message: errorMessage } });
  }
}
