import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const saasMock = import.meta.env.VITE_SAAS_MOCK?.trim().toLowerCase() ?? '';
const MOCK_AUTH_KEY = 'studio_canvas_saas_mock_auth_v1';

export const STUDIO_AUTH_MOCK_EVENT = 'studio-auth-mock-change';

let cachedClient: SupabaseClient | null = null;

export type AuthSnapshot = {
  session: Session | null;
  user: User | null;
};

export function isDesktopRuntime(): boolean {
  return Boolean(window.studioLicense?.isDesktop);
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
  if (!isSupabaseConfigured()) {
    return null;
  }

  cachedClient ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return cachedClient;
}

function buildMockAuthSnapshot(email: string): AuthSnapshot {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email,
    id: 'mock-user-local',
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    user_metadata: {},
  } as unknown as User;
  const session = {
    access_token: 'mock-access-token',
    expires_at: now + 60 * 60 * 24 * 30,
    expires_in: 60 * 60 * 24 * 30,
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    user,
  } as unknown as Session;
  return { session, user };
}

function getMockAuthSnapshot(): AuthSnapshot {
  try {
    const email = localStorage.getItem(MOCK_AUTH_KEY);
    return email ? buildMockAuthSnapshot(email) : { session: null, user: null };
  } catch {
    return { session: null, user: null };
  }
}

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  if (isSaasMockEnabled()) {
    return getMockAuthSnapshot();
  }

  const client = getSupabaseClient();
  if (!client) {
    return { session: null, user: null };
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }

  return {
    session: data.session,
    user: data.session?.user ?? null,
  };
}

export async function sendLoginLink(email: string): Promise<void> {
  if (isSaasMockEnabled()) {
    localStorage.setItem(MOCK_AUTH_KEY, email.trim());
    window.dispatchEvent(new Event(STUDIO_AUTH_MOCK_EVENT));
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase 尚未配置，无法登录。');
  }

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOut(): Promise<void> {
  if (isSaasMockEnabled()) {
    localStorage.removeItem(MOCK_AUTH_KEY);
    window.dispatchEvent(new Event(STUDIO_AUTH_MOCK_EVENT));
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
}
