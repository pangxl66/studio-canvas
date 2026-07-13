import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  boundedInteger,
  getAdminContext,
  json,
  normalizeEmail,
  normalizeUsageEvent,
  sanitizeError,
} from '../_lib/admin';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  try {
    const auth = await getAdminContext(req);
    if ('error' in auth) {
      json(res, auth.error.status, { error: { message: auth.error.message } });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const email = normalizeEmail(url.searchParams.get('email'));
    const limit = boundedInteger(url.searchParams.get('limit'), 80, 1, 200);
    let query = auth.serviceClient
      .from('usage_events')
      .select('user_id,feature,model,input_chars,output_chars,estimated_tokens,quota_cost,status,error_message,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    let filteredProfile: any = null;
    if (email) {
      const { data, error } = await auth.serviceClient
        .from('profiles')
        .select('id,email,display_name,plan')
        .ilike('email', email)
        .maybeSingle();
      if (error) throw new Error(error.message || '读取用户资料失败。');
      filteredProfile = data;
      query = data?.id
        ? query.eq('user_id', data.id)
        : query.eq('user_id', '00000000-0000-0000-0000-000000000000');
    }

    const { data: usageRows, error: usageError } = await query;
    if (usageError) throw new Error(usageError.message || '读取使用记录失败。');

    const profileById = new Map<string, any>();
    if (filteredProfile?.id) {
      profileById.set(filteredProfile.id, filteredProfile);
    } else {
      const userIds = [...new Set((usageRows ?? []).map((row: any) => row.user_id).filter(Boolean))] as string[];
      if (userIds.length) {
        const { data: profiles, error } = await auth.serviceClient
          .from('profiles')
          .select('id,email,display_name,plan')
          .in('id', userIds);
        if (error) throw new Error(error.message || '读取用户资料失败。');
        for (const profile of profiles ?? []) profileById.set(profile.id, profile);
      }
    }

    const events = (usageRows ?? []).map((row: any) => {
      const profile = profileById.get(row.user_id) ?? {};
      return {
        ...normalizeUsageEvent(row),
        source: 'supabase',
        user: {
          displayName: profile.display_name ?? null,
          email: profile.email ?? row.user_id ?? '',
          plan: profile.plan ?? 'free',
          userId: row.user_id ?? '',
        },
      };
    });

    json(res, 200, { email: email || null, events, limit, totalReturned: events.length });
  } catch (error) {
    json(res, 500, { error: { message: sanitizeError(error) || '读取使用记录失败。' } });
  }
}
