import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type AuthedUser = {
  id: string;
  email?: string | null;
};

type AnySupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: AuthedUser | null }; error: { message: string } | null }>;
  };
  from: (table: string) => any;
};

const DEFAULT_MONTHLY_QUOTA = 20;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sanitizeError(raw: unknown): string {
  return String(raw ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
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
    }) as AnySupabaseClient,
    serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey) as AnySupabaseClient,
  };
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function configuredAdminEmails(): string[] {
  return env('ADMIN_EMAILS').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
}

async function getAdminContext(req: IncomingMessage): Promise<
  | { serviceClient: AnySupabaseClient; user: AuthedUser }
  | { error: { status: number; message: string } }
> {
  const token = getBearerToken(req);
  if (!token) return { error: { status: 401, message: '请先登录。' } };

  const admins = configuredAdminEmails();
  if (!admins.length) {
    return { error: { status: 403, message: '管理员功能未启用：请先在服务器环境变量配置 ADMIN_EMAILS。' } };
  }

  const { authClient, serviceClient } = getAuthClients(token);
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    return { error: { status: 401, message: '登录状态已失效，请重新登录。' } };
  }

  const email = normalizeEmail(data.user.email);
  if (!email || !admins.includes(email)) {
    return { error: { status: 403, message: '当前账号不是管理员，无法管理额度。' } };
  }

  return { serviceClient, user: data.user };
}

function normalizeUsageEvent(row: any) {
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

async function readAdminCreditDetails(serviceClient: AnySupabaseClient, email: string): Promise<any> {
  const normalizedEmail = normalizeEmail(email);
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id,email,display_name,plan')
    .ilike('email', normalizedEmail)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message || '读取用户资料失败。');
  if (!profile?.id) return { notFound: true };

  const { data: wallet, error: walletError } = await serviceClient
    .from('credit_wallets')
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (walletError) throw new Error(walletError.message || '读取用户额度失败。');

  let nextWallet = wallet;
  if (!nextWallet) {
    const { error: createWalletError } = await serviceClient.from('credit_wallets').upsert(
      {
        monthly_quota: DEFAULT_MONTHLY_QUOTA,
        remaining_quota: DEFAULT_MONTHLY_QUOTA,
        user_id: profile.id,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    if (createWalletError) throw new Error(createWalletError.message || '创建用户额度失败。');
    const { data: createdWallet, error: readCreatedError } = await serviceClient
      .from('credit_wallets')
      .select('monthly_quota,remaining_quota,reset_at,updated_at')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (readCreatedError || !createdWallet) throw new Error(readCreatedError?.message || '读取新额度失败。');
    nextWallet = createdWallet;
  }

  const { data: usageEvents, error: usageError } = await serviceClient
    .from('usage_events')
    .select('feature,model,input_chars,output_chars,estimated_tokens,quota_cost,status,error_message,created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (usageError) throw new Error(usageError.message || '读取调用记录失败。');

  return {
    usageEvents: (usageEvents ?? []).map(normalizeUsageEvent),
    user: {
      displayName: profile.display_name ?? null,
      email: profile.email ?? normalizedEmail,
      plan: profile.plan ?? 'free',
      userId: profile.id,
    },
    wallet: {
      monthlyQuota: Number(nextWallet.monthly_quota ?? 0),
      remainingQuota: Number(nextWallet.remaining_quota ?? 0),
      resetAt: nextWallet.reset_at ?? null,
      updatedAt: nextWallet.updated_at ?? null,
    },
  };
}

function readCreditAmount(value: unknown): number | null {
  const amount = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999) return null;
  return amount;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  try {
    const auth = await getAdminContext(req);
    if ('error' in auth) {
      json(res, auth.error.status, { error: { message: auth.error.message } });
      return;
    }

    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const email = normalizeEmail(url.searchParams.get('email'));
      if (!email) {
        json(res, 400, { error: { message: '请输入要查询的用户邮箱。' } });
        return;
      }
      const details = await readAdminCreditDetails(auth.serviceClient, email);
      if (details.notFound) {
        json(res, 404, { error: { message: '未找到该邮箱用户。请确认对方已经登录过一次。' } });
        return;
      }
      json(res, 200, details);
      return;
    }

    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const action = String(body.action ?? '').trim();
    if (!email) {
      json(res, 400, { error: { message: '请输入要操作的用户邮箱。' } });
      return;
    }

    const details = await readAdminCreditDetails(auth.serviceClient, email);
    if (details.notFound) {
      json(res, 404, { error: { message: '未找到该邮箱用户。请确认对方已经登录过一次。' } });
      return;
    }

    const currentMonthly = Number(details.wallet.monthlyQuota ?? 0);
    const currentRemaining = Number(details.wallet.remainingQuota ?? 0);
    let nextMonthly = currentMonthly;
    let nextRemaining = currentRemaining;

    if (action === 'reset') {
      nextMonthly = DEFAULT_MONTHLY_QUOTA;
      nextRemaining = DEFAULT_MONTHLY_QUOTA;
    } else if (action === 'add') {
      const amount = readCreditAmount(body.amount);
      if (!amount) {
        json(res, 400, { error: { message: '增加次数必须是 1-9999 的整数。' } });
        return;
      }
      nextMonthly = currentMonthly + amount;
      nextRemaining = currentRemaining + amount;
    } else if (action === 'set') {
      const amount = readCreditAmount(body.amount);
      if (amount === null) {
        json(res, 400, { error: { message: '设置次数必须是 0-9999 的整数。' } });
        return;
      }
      nextMonthly = amount;
      nextRemaining = amount;
    } else {
      json(res, 400, { error: { message: '未知操作，请使用 add、reset 或 set。' } });
      return;
    }

    const { error: updateError } = await auth.serviceClient
      .from('credit_wallets')
      .update({
        monthly_quota: nextMonthly,
        remaining_quota: nextRemaining,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', details.user.userId);
    if (updateError) {
      json(res, 500, { error: { message: updateError.message || '更新额度失败。' } });
      return;
    }

    const nextDetails = await readAdminCreditDetails(auth.serviceClient, email);
    json(res, 200, nextDetails);
  } catch (error) {
    json(res, 500, { error: { message: sanitizeError(error) || '管理员额度操作失败。' } });
  }
}
