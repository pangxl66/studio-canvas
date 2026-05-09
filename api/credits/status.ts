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
        monthly_quota: DEFAULT_MONTHLY_QUOTA,
        remaining_quota: DEFAULT_MONTHLY_QUOTA,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ),
  ]);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    json(res, 401, { error: { message: '请先登录。' } });
    return;
  }

  try {
    const { authClient, serviceClient } = getAuthClients(token);
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      json(res, 401, { error: { message: '登录状态已失效，请重新登录。' } });
      return;
    }

    const user = authData.user;
    await ensureUserRows(serviceClient, user);

    const [{ data: profile }, { data: wallet, error: walletError }] = await Promise.all([
      serviceClient.from('profiles').select('plan,email,display_name').eq('id', user.id).maybeSingle(),
      serviceClient
        .from('credit_wallets')
        .select('monthly_quota,remaining_quota,reset_at,updated_at')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (walletError || !wallet) {
      json(res, 500, { error: { message: walletError?.message || '读取额度失败。' } });
      return;
    }

    json(res, 200, {
      displayName: profile?.display_name ?? null,
      email: profile?.email ?? user.email ?? null,
      monthlyQuota: Number(wallet.monthly_quota ?? 0),
      plan: profile?.plan ?? 'free',
      remainingQuota: Number(wallet.remaining_quota ?? 0),
      resetAt: wallet.reset_at ?? null,
      updatedAt: wallet.updated_at ?? null,
      userId: user.id,
    });
  } catch (error) {
    json(res, 500, { error: { message: sanitizeError(error) || '读取额度失败。' } });
  }
}
