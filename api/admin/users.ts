import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  boundedInteger,
  candidateErrorCode,
  describeSupabaseFailure,
  emptyUsageSummary,
  getAdminContext,
  json,
  normalizeEmail,
  sanitizeError,
  type AnySupabaseClient,
} from '../_lib/admin';

async function fetchAuthUsersByProfiles(serviceClient: AnySupabaseClient, profiles: any[]) {
  return Promise.all(profiles.filter((profile) => profile?.id).map(async (profile) => {
    try {
      const { data, error } = await serviceClient.auth.admin.getUserById(profile.id);
      if (!error && data?.user) return data.user;
    } catch {
      // Profile metadata remains enough to show the row when Auth Admin lookup fails.
    }
    return {
      id: profile.id,
      email: profile.email,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    };
  }));
}

function userStatus(user: any): string {
  if (user?.banned_until) return 'banned';
  if (user?.email_confirmed_at || user?.confirmed_at) return 'active';
  return 'pending';
}

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
    const page = boundedInteger(url.searchParams.get('page'), 1, 1, 10_000);
    let authUsers: any[] = [];
    let profileRows: any[] = [];
    let totalAuthUsers: number | null = null;

    if (email) {
      const { data, error, count } = await auth.serviceClient
        .from('profiles')
        .select('id,email,display_name,plan,created_at,updated_at', { count: 'exact' })
        .ilike('email', `%${email}%`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message || '读取用户列表失败。');
      profileRows = data ?? [];
      totalAuthUsers = count ?? profileRows.length;
      authUsers = await fetchAuthUsersByProfiles(auth.serviceClient, profileRows);
    } else {
      const { data, error } = await auth.serviceClient.auth.admin.listUsers({ page, perPage: limit });
      if (error) throw new Error(error.message || '读取注册用户失败。');
      authUsers = data?.users ?? [];
      totalAuthUsers = data?.total ?? authUsers.length;
    }

    const userIds = [...new Set(authUsers.map((user) => user.id).filter(Boolean))] as string[];
    const emptyResult = { data: [], error: null };
    const [profilesResult, walletsResult, usageResult, projectsResult] = userIds.length
      ? await Promise.all([
          email
            ? Promise.resolve({ data: profileRows, error: null })
            : auth.serviceClient.from('profiles').select('id,email,display_name,plan,created_at,updated_at').in('id', userIds),
          auth.serviceClient.from('credit_wallets').select('user_id,monthly_quota,remaining_quota,reset_at,updated_at').in('user_id', userIds),
          auth.serviceClient.from('usage_events').select('user_id,status,quota_cost,created_at').in('user_id', userIds).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit * 80, 1000), 5000)),
          auth.serviceClient.from('projects').select('user_id,updated_at').in('user_id', userIds).limit(Math.min(Math.max(limit * 40, 1000), 5000)),
        ])
      : [emptyResult, emptyResult, emptyResult, emptyResult];

    if (profilesResult.error) throw new Error(profilesResult.error.message || '读取用户资料失败。');
    if (walletsResult.error) throw new Error(walletsResult.error.message || '读取用户点数失败。');
    if (usageResult.error) throw new Error(usageResult.error.message || '读取用户使用统计失败。');
    if (projectsResult.error) throw new Error(projectsResult.error.message || '读取用户项目统计失败。');

    const profileById = new Map((profilesResult.data ?? []).map((row: any) => [row.id, row]));
    const walletById = new Map((walletsResult.data ?? []).map((row: any) => [row.user_id, row]));
    const usageById = new Map(userIds.map((id) => [id, emptyUsageSummary()]));
    for (const event of usageResult.data ?? []) {
      const summary = usageById.get(event.user_id);
      if (!summary) continue;
      if (!summary.lastUsageAt && event.created_at) summary.lastUsageAt = event.created_at;
      summary.totalUsage += 1;
      summary.totalCost += Number(event.quota_cost ?? 0);
      if (event.status === 'success') summary.successUsage += 1;
      if (event.status === 'failed') summary.failedUsage += 1;
    }
    const projectCountById = new Map<string, number>();
    for (const project of projectsResult.data ?? []) {
      projectCountById.set(project.user_id, (projectCountById.get(project.user_id) ?? 0) + 1);
    }

    const users = authUsers.map((user) => {
      const profile: any = profileById.get(user.id) ?? {};
      const wallet: any = walletById.get(user.id) ?? {};
      const usage = usageById.get(user.id) ?? emptyUsageSummary();
      return {
        createdAt: user.created_at ?? profile.created_at ?? null,
        displayName: profile.display_name ?? user.user_metadata?.name ?? null,
        email: normalizeEmail(profile.email ?? user.email) || user.id,
        emailConfirmedAt: user.email_confirmed_at ?? user.confirmed_at ?? null,
        failedUsage: usage.failedUsage,
        lastSignInAt: user.last_sign_in_at ?? null,
        lastUsageAt: usage.lastUsageAt,
        monthlyQuota: Number(wallet.monthly_quota ?? 0),
        plan: profile.plan ?? 'free',
        projectCount: projectCountById.get(user.id) ?? 0,
        provider: user.app_metadata?.provider ?? 'email',
        remainingQuota: Number(wallet.remaining_quota ?? 0),
        source: 'supabase',
        status: userStatus(user),
        successUsage: usage.successUsage,
        totalCost: usage.totalCost,
        totalUsage: usage.totalUsage,
        updatedAt: profile.updated_at ?? user.updated_at ?? null,
        userId: user.id,
        walletUpdatedAt: wallet.updated_at ?? null,
      };
    });

    json(res, 200, {
      email: email || null,
      limit,
      page,
      totalAuthUsers,
      totalReturned: users.length,
      totalTestInviteUsers: 0,
      users,
    });
  } catch (error) {
    console.error('Admin user list read failed', sanitizeError(error), candidateErrorCode(error));
    json(res, 503, { error: { message: describeSupabaseFailure(error, '读取用户列表失败。') } });
  }
}
