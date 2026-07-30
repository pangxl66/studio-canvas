import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type AuthedUser = {
  id: string;
  email?: string | null;
};

export type AnySupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: AuthedUser | null }; error: { message: string } | null }>;
    admin: {
      getUserById: (id: string) => Promise<any>;
      listUsers: (options: { page: number; perPage: number }) => Promise<any>;
    };
  };
  from: (table: string) => any;
};

export function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function sanitizeError(raw: unknown): string {
  return String(raw ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function describeSupabaseFailure(error: unknown, fallback = '用户数据库暂时不可用。'): string {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown } | null;
  const causeCode = String(candidate?.cause?.code ?? candidate?.code ?? '').trim().toUpperCase();
  const text = sanitizeError(error);
  if (causeCode === 'ENOTFOUND' || /enotfound|getaddrinfo/i.test(text)) {
    return '无法解析用户数据库域名：请检查服务器 SUPABASE_URL 是否属于仍然存在的 Supabase 项目。';
  }
  if (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(causeCode)
    || /fetch failed|network|socket|timed?\s*out|connection/i.test(text)
  ) {
    return '无法连接用户数据库：请检查服务器 SUPABASE_URL、网络和 Supabase 项目状态。';
  }
  return text || fallback;
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function configuredAdminEmails(): string[] {
  return env('ADMIN_EMAILS').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
}

export async function getAdminContext(req: IncomingMessage): Promise<
  | { serviceClient: AnySupabaseClient; user: AuthedUser }
  | { error: { status: number; message: string } }
> {
  const token = getBearerToken(req);
  if (!token) return { error: { status: 401, message: '请先登录。' } };

  const admins = configuredAdminEmails();
  if (!admins.length) {
    return { error: { status: 403, message: '管理员功能未启用：请先配置 ADMIN_EMAILS。' } };
  }

  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return { error: { status: 503, message: '服务器 Supabase 配置不完整。' } };
  }

  try {
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }) as unknown as AnySupabaseClient;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey) as unknown as AnySupabaseClient;
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) {
      return { error: { status: 401, message: '登录状态已失效，请重新登录。' } };
    }

    const email = normalizeEmail(data.user.email);
    if (!email || !admins.includes(email)) {
      return { error: { status: 403, message: '当前账号不是管理员。' } };
    }
    return { serviceClient, user: data.user };
  } catch (error) {
    console.error('Supabase authentication failed', sanitizeError(error), candidateErrorCode(error));
    return { error: { status: 503, message: describeSupabaseFailure(error, '服务器鉴权配置缺失。') } };
  }
}

export function candidateErrorCode(error: unknown): string {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown } | null;
  return String(candidate?.cause?.code ?? candidate?.code ?? '');
}

export function normalizeUsageEvent(row: any) {
  return {
    createdAt: row.created_at ?? null,
    errorMessage: row.error_message ?? null,
    estimatedTokens: Number(row.estimated_tokens ?? 0),
    feature: row.feature ?? '',
    inputChars: Number(row.input_chars ?? 0),
    model: row.model ?? '',
    outputChars: Number(row.output_chars ?? 0),
    quotaCost: Number(row.quota_cost ?? 0),
    status: row.status ?? '',
  };
}

export function emptyUsageSummary() {
  return {
    failedUsage: 0,
    lastUsageAt: null as string | null,
    successUsage: 0,
    totalCost: 0,
    totalUsage: 0,
  };
}
