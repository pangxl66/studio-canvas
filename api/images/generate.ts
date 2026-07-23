import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import runtimeDefaults from '../../shared/runtime-defaults.json';

type ImageRequestBody = {
  prompt?: string;
  projectId?: string | null;
  quality?: 'low' | 'medium' | 'high';
  size?: string;
  referenceImages?: Array<{
    dataUrl?: string;
    name?: string;
    kind?: 'character' | 'scene' | 'prop' | 'layout';
    entityId?: string;
    entityName?: string;
  }>;
};

type AuthedUser = { id: string; email?: string | null };
type AnySupabaseClient = {
  auth: { getUser: () => Promise<{ data: { user: AuthedUser | null }; error: { message: string } | null }> };
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

const MODEL = process.env.IMAGE_MODEL?.trim() || 'gpt-image-2';
const QUOTA_COST = 3;
const TIMEOUT_MS = 420_000;
const ALLOWED_SIZES = new Set([
  '1024x1024',
  '1536x1536',
  '1536x1024',
  '1024x1536',
  '1536x864',
  '864x1536',
  '1536x576',
  '576x1536',
]);

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sanitizeError(value: unknown): string {
  return String(value ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function readBody(req: IncomingMessage): Promise<ImageRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? (JSON.parse(raw) as ImageRequestBody) : {};
}

function bearerToken(req: IncomingMessage): string {
  const raw = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  return raw?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
}

function getAuthClients(token: string): { authClient: AnySupabaseClient; serviceClient: AnySupabaseClient } {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) throw new Error('Server Supabase env is missing.');
  return {
    authClient: createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }) as unknown as AnySupabaseClient,
    serviceClient: createClient(url, serviceKey) as unknown as AnySupabaseClient,
  };
}

async function ensureUserRows(client: AnySupabaseClient, user: AuthedUser): Promise<void> {
  await Promise.all([
    client.from('profiles').upsert({ id: user.id, email: user.email ?? null }, { onConflict: 'id' }),
    client.from('credit_wallets').upsert(
      {
        user_id: user.id,
        monthly_quota: runtimeDefaults.defaultMonthlyQuota,
        remaining_quota: runtimeDefaults.defaultMonthlyQuota,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ),
  ]);
}

async function reserveQuota(client: AnySupabaseClient, userId: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await client.rpc('reserve_credit_quota', { p_cost: QUOTA_COST, p_user_id: userId });
  if (error) return { ok: false, message: '站内次数预扣失败，请更新 Supabase SQL 后重试。' };
  const row = Array.isArray(data) ? data[0] : data;
  const remaining = Number(row?.remaining_quota ?? 0);
  return row?.ok
    ? { ok: true, message: '' }
    : { ok: false, message: `额度不足，当前剩余 ${remaining} 次，本次需要 ${QUOTA_COST} 次。` };
}

async function refundQuota(client: AnySupabaseClient, userId: string): Promise<void> {
  const { error } = await client.rpc('refund_credit_quota', { p_cost: QUOTA_COST, p_user_id: userId });
  if (error) console.warn('Image credit refund failed', sanitizeError(error.message));
}

async function writeUsage(
  client: AnySupabaseClient,
  userId: string,
  body: ImageRequestBody,
  inputChars: number,
  status: 'success' | 'failed',
  message?: string,
): Promise<void> {
  await client.from('usage_events').insert({
    user_id: userId,
    project_id: body.projectId ?? null,
    feature: 'storyboard-grid-image',
    model: MODEL,
    input_chars: inputChars,
    output_chars: 0,
    estimated_tokens: Math.ceil(inputChars / 2),
    quota_cost: status === 'success' ? QUOTA_COST : 0,
    status,
    error_message: message,
  });
}

function imageUpstreamUrl(edit = false): string {
  const raw = env('IMAGE_BASE_URL') || env('GPT_LLM_BASE_URL') || env('LLM_BASE_URL') || env('LLM_PROXY_URL');
  if (!raw) return '';
  const base = raw.replace(/\/+$/u, '');
  const endpoint = edit ? 'edits' : 'generations';
  if (/\/images\/(?:generations|edits)$/u.test(base)) return base.replace(/\/images\/(?:generations|edits)$/u, `/images/${endpoint}`);
  if (/\/chat\/completions$/u.test(base)) return base.replace(/\/chat\/completions$/u, `/images/${endpoint}`);
  if (/\/v1$/u.test(base)) return `${base}/images/${endpoint}`;
  return `${base}/v1/images/${endpoint}`;
}

function referenceBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/u);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) return null;
  return new Blob([bytes], { type: match[1] || 'image/jpeg' });
}

function imageRequestBody(body: ImageRequestBody, prompt: string, size: string, quality: string): {
  body: BodyInit;
  headers: Record<string, string>;
  edit: boolean;
  referenceImageCount: number;
} {
  const references = Array.isArray(body.referenceImages) ? body.referenceImages.slice(0, 16) : [];
  const blobs = references
    .map((reference) => referenceBlob(reference.dataUrl?.trim() ?? ''))
    .filter((blob): blob is Blob => blob != null);
  if (!blobs.length) {
    if (references.length) throw new Error('参考图读取失败，已停止生成，避免静默退化为纯文本生图。');
    return {
      edit: false,
      referenceImageCount: 0,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size,
        quality,
        output_format: 'jpeg',
        output_compression: 88,
      }),
    };
  }
  const form = new FormData();
  form.set('model', MODEL);
  form.set('prompt', prompt);
  form.set('n', '1');
  form.set('size', size);
  form.set('quality', quality);
  form.set('output_format', 'jpeg');
  form.set('output_compression', '88');
  blobs.forEach((blob, index) => form.append('image[]', blob, `reference-${index + 1}.jpg`));
  if (blobs.length !== references.length) {
    throw new Error(`有 ${references.length - blobs.length} 张参考图读取失败，已停止生成。`);
  }
  return { edit: true, headers: {}, body: form, referenceImageCount: blobs.length };
}

function upstreamKey(): string {
  return env('IMAGE_API_KEY') || env('GPT_LLM_API_KEY') || env('LLM_API_KEY');
}

function upstreamMessage(status: number, raw: string): string {
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message || parsed.message || raw;
  } catch {
    // Keep raw upstream response.
  }
  const safe = sanitizeError(detail);
  if (status === 401) return '图片模型鉴权失败，请检查服务器中的现有 API Key。';
  if (status === 403) return '当前 API Key 没有 gpt-image-2 的访问权限。';
  if (status === 429) return '图片模型请求过于频繁或额度不足，请稍后重试。';
  if (status >= 500) return '图片模型服务暂时不可用，请稍后重试。';
  return `图片生成失败（HTTP ${status}）${safe ? `：${safe}` : '。'}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  let body: ImageRequestBody;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }
  const prompt = body.prompt?.trim() ?? '';
  if (!prompt || prompt.length > 32_000) {
    sendJson(res, 400, { error: { message: '图片提示词不能为空，且不能超过 32000 字符。' } });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: { message: '请先登录后再生成。' } });
    return;
  }

  let userId = '';
  let client: AnySupabaseClient;
  try {
    const clients = getAuthClients(token);
    client = clients.serviceClient;
    const { data, error } = await clients.authClient.auth.getUser();
    if (error || !data.user) {
      sendJson(res, 401, { error: { message: '登录状态已失效，请重新登录。' } });
      return;
    }
    userId = data.user.id;
    await ensureUserRows(client, data.user);
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '服务器鉴权配置缺失。' } });
    return;
  }

  const reservation = await reserveQuota(client, userId);
  if (!reservation.ok) {
    await writeUsage(client, userId, body, prompt.length, 'failed', reservation.message);
    sendJson(res, 402, { error: { message: reservation.message } });
    return;
  }

  try {
    const apiKey = upstreamKey();
    const size = ALLOWED_SIZES.has(body.size ?? '') ? body.size as string : '1536x1536';
    const quality = body.quality === 'low' || body.quality === 'high' ? body.quality : 'medium';
    const request = imageRequestBody(body, prompt, size, quality);
    const url = imageUpstreamUrl(request.edit);
    if (!url || !apiKey) throw new Error('Image upstream env is missing.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, ...request.headers },
        body: request.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const raw = await response.text();
    if (!response.ok) {
      const message = upstreamMessage(response.status, raw);
      await refundQuota(client, userId);
      await writeUsage(client, userId, body, prompt.length, 'failed', message);
      sendJson(res, response.status, { error: { message, upstreamStatus: response.status } });
      return;
    }
    const payload = JSON.parse(raw) as { data?: Array<{ b64_json?: string }> };
    const b64 = payload.data?.[0]?.b64_json?.trim() ?? '';
    if (!b64) throw new Error('图片模型未返回 b64_json。');
    await writeUsage(client, userId, body, prompt.length, 'success');
    sendJson(res, 200, {
      imageDataUrl: `data:image/jpeg;base64,${b64}`,
      model: MODEL,
      size,
      referenceImageCount: request.referenceImageCount,
    });
  } catch (error) {
    await refundQuota(client, userId);
    const message = error instanceof Error && error.name === 'AbortError'
      ? '图片生成超时，请稍后重试。'
      : sanitizeError(error).includes('upstream env')
        ? '图片模型未配置：将使用现有 LLM_API_KEY，但还需要可用的 LLM_BASE_URL。'
        : sanitizeError(error) || '图片生成失败。';
    await writeUsage(client, userId, body, prompt.length, 'failed', message);
    sendJson(res, 502, { error: { message } });
  }
}
