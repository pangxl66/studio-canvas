import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const saasMock = import.meta.env.VITE_SAAS_MOCK?.trim().toLowerCase() ?? '';
const MOCK_AUTH_KEY = 'studio_canvas_saas_mock_auth_v1';
const ACTIVATED_TEST_INVITE_AUTH_KEY = 'studio_canvas_saas_test_invite_activations_v1';

export const STUDIO_AUTH_MOCK_EVENT = 'studio-auth-mock-change';

let cachedClient: SupabaseClient | null = null;

function normalizeSupabaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (raw.startsWith('/')) {
    const pathUrl = raw.replace(/\/+$/, '') || '/';
    if (typeof window !== 'undefined') {
      return new URL(pathUrl, window.location.origin).toString().replace(/\/+$/, '');
    }
    return pathUrl;
  }
  return `https://${raw}`.replace(/\/+$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);

export type AuthSnapshot = {
  session: Session | null;
  user: User | null;
};

type StoredLocalAuth = {
  accessToken?: string;
  activatedAt?: string;
  email: string;
  refreshToken?: string;
};

type StoredTestInviteAuths = Record<string, StoredLocalAuth>;

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.studioLicense?.isDesktop);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function isSaasMockEnabled(): boolean {
  return !isDesktopRuntime() && (saasMock === '1' || saasMock === 'true' || saasMock === 'yes');
}

export function isSaasHostedMode(): boolean {
  return !isDesktopRuntime() && isSupabaseConfigured() && !isSaasMockEnabled();
}

export function isSaasAuthEnabled(): boolean {
  return isSaasHostedMode() || isSaasMockEnabled();
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSaasHostedMode()) return null;
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return cachedClient;
}

function readStoredLocalAuth(): StoredLocalAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MOCK_AUTH_KEY);
    if (!raw) return null;
    if (!raw.trim().startsWith('{')) return { email: raw };
    const parsed = JSON.parse(raw) as StoredLocalAuth;
    return parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeInviteCode(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function readActivatedTestInviteAuths(): StoredTestInviteAuths {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ACTIVATED_TEST_INVITE_AUTH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTestInviteAuths;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readActivatedTestInviteAuth(email: string): StoredLocalAuth | null {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const stored = readActivatedTestInviteAuths()[normalizedEmail];
  return stored?.accessToken ? stored : null;
}

function writeActivatedTestInviteAuth(email: string, accessToken?: string, refreshToken?: string): void {
  if (!accessToken) return;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const stored = readActivatedTestInviteAuths();
  stored[normalizedEmail] = {
    accessToken,
    activatedAt: new Date().toISOString(),
    email: normalizedEmail,
    refreshToken,
  };
  window.localStorage.setItem(ACTIVATED_TEST_INVITE_AUTH_KEY, JSON.stringify(stored));
}

function writeStoredLocalAuth(email: string, accessToken?: string, refreshToken?: string): void {
  window.localStorage.setItem(MOCK_AUTH_KEY, JSON.stringify({ email, accessToken, refreshToken }));
  window.dispatchEvent(new Event(STUDIO_AUTH_MOCK_EVENT));
}

function clearStoredLocalAuth(): void {
  window.localStorage.removeItem(MOCK_AUTH_KEY);
  window.dispatchEvent(new Event(STUDIO_AUTH_MOCK_EVENT));
}

function buildMockAuthSnapshot(
  email: string,
  accessToken = 'mock-access-token',
  refreshToken = 'mock-refresh-token',
): AuthSnapshot {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    app_metadata: { provider: accessToken.startsWith('test-invite.') ? 'test-invite' : 'mock' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email,
    id: accessToken.startsWith('test-invite.') ? `test-invite-${email}` : 'mock-user-local',
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    user_metadata: accessToken.startsWith('test-invite.') ? { testInvite: true } : {},
  } as unknown as User;

  const session = {
    access_token: accessToken,
    expires_at: now + 60 * 60 * 24 * 30,
    expires_in: 60 * 60 * 24 * 30,
    refresh_token: refreshToken,
    token_type: 'bearer',
    user,
  } as unknown as Session;

  return { session, user };
}

function getMockAuthSnapshot(): AuthSnapshot {
  const stored = readStoredLocalAuth();
  return stored ? buildMockAuthSnapshot(stored.email, stored.accessToken, stored.refreshToken) : { session: null, user: null };
}

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  const localSnapshot = getMockAuthSnapshot();
  if (localSnapshot.session) return localSnapshot;

  if (isSaasMockEnabled()) return localSnapshot;

  const client = getSupabaseClient();
  if (!client) return { session: null, user: null };

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return { session: data.session, user: data.session?.user ?? null };
}

export async function getTestInviteStatus(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/test-invite', { headers: { accept: 'application/json' } });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.enabled);
  } catch {
    return false;
  }
}

export function hasActivatedTestInviteEmail(email: string): boolean {
  return Boolean(readActivatedTestInviteAuth(email));
}

export async function signInWithTestInvite(email: string, inviteCode: string): Promise<Session | null> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeInviteCode(inviteCode) || ' ';

  const activatedAuth = readActivatedTestInviteAuth(normalizedEmail);
  if (normalizedEmail && !normalizedCode.trim() && activatedAuth) {
    writeStoredLocalAuth(
      activatedAuth.email || normalizedEmail,
      activatedAuth.accessToken,
      activatedAuth.refreshToken || `test-invite-refresh-${Date.now()}`,
    );
    return getMockAuthSnapshot().session;
  }

  if (!normalizedEmail) throw new Error('请输入邮箱。');
  if (!normalizedCode) throw new Error('请输入测试邀请码。');

  const response = await fetch('/api/auth/test-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail, inviteCode: normalizedCode }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || '测试邀请码验证失败。');
  }

  const nextEmail = normalizeEmail(data?.email || normalizedEmail);
  const nextRefreshToken = `test-invite-refresh-${Date.now()}`;
  writeStoredLocalAuth(nextEmail, data?.accessToken, nextRefreshToken);
  writeActivatedTestInviteAuth(nextEmail, data?.accessToken, nextRefreshToken);
  return getMockAuthSnapshot().session;
}

export async function sendLoginCode(email: string): Promise<void> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) throw new Error('请输入邮箱。');

  if (isSaasMockEnabled()) return;

  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase 尚未配置，无法登录。');

  const { error } = await client.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) throw error;
}

export async function verifyLoginCode(email: string, token: string): Promise<Session | null> {
  const normalizedEmail = email.trim();
  const normalizedToken = token.trim();

  if (isSaasMockEnabled()) {
    if (!normalizedEmail || !normalizedToken) throw new Error('请输入邮箱和验证码。');
    writeStoredLocalAuth(normalizedEmail);
    return getMockAuthSnapshot().session;
  }

  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase 尚未配置，无法登录。');

  const { data, error } = await client.auth.verifyOtp({
    email: normalizedEmail,
    token: normalizedToken,
    type: 'email',
  });

  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  clearStoredLocalAuth();

  if (isSaasMockEnabled()) return;

  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}
