import { getAuthSnapshot, isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';

export type AdminCreditUsageEvent = {
  createdAt: string | null;
  errorMessage: string | null;
  estimatedTokens: number;
  feature: string;
  inputChars: number;
  model: string;
  outputChars: number;
  quotaCost: number;
  status: string;
};

export type AdminUsageEvent = AdminCreditUsageEvent & {
  source?: string;
  user: {
    displayName: string | null;
    email: string;
    plan: string;
    userId: string;
  };
};

export type AdminCreditDetails = {
  usageEvents: AdminCreditUsageEvent[];
  user: {
    displayName: string | null;
    email: string;
    plan: string;
    userId: string;
  };
  wallet: {
    monthlyQuota: number;
    remainingQuota: number;
    resetAt: string | null;
    updatedAt: string | null;
  };
};

export type AdminUsageResponse = {
  email: string | null;
  events: AdminUsageEvent[];
  limit: number;
  totalReturned: number;
};

export type AdminUserRecord = {
  createdAt: string | null;
  displayName: string | null;
  email: string;
  emailConfirmedAt: string | null;
  failedUsage: number;
  lastSignInAt: string | null;
  lastUsageAt: string | null;
  monthlyQuota: number;
  plan: string;
  projectCount: number;
  provider: string;
  remainingQuota: number;
  source: string;
  status: string;
  successUsage: number;
  totalCost: number;
  totalUsage: number;
  updatedAt: string | null;
  userId: string;
  walletUpdatedAt: string | null;
};

export type AdminUsersResponse = {
  email: string | null;
  limit: number;
  page: number;
  totalAuthUsers: number | null;
  totalReturned: number;
  totalTestInviteUsers: number;
  users: AdminUserRecord[];
};

async function getAccessToken(): Promise<string> {
  if (!isSaasAuthEnabled() || isSaasMockEnabled()) {
    throw new Error('管理员额度管理只在网站登录模式下可用。');
  }

  const { session } = await getAuthSnapshot();
  if (!session?.access_token) {
    throw new Error('请先登录管理员账号。');
  }
  return session.access_token;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | T | null;
  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error?: { message?: string } })
        : null;
    const message =
      errorPayload?.error?.message ? errorPayload.error.message : '管理员额度操作失败。';
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchAdminCreditDetails(email: string): Promise<AdminCreditDetails> {
  const token = await getAccessToken();
  const response = await fetch(`/api/admin/credits?email=${encodeURIComponent(email.trim())}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseJsonResponse<AdminCreditDetails>(response);
}

export async function fetchAdminUsageEvents(email = '', limit = 80): Promise<AdminUsageResponse> {
  const token = await getAccessToken();
  const params = new URLSearchParams();
  if (email.trim()) params.set('email', email.trim());
  params.set('limit', String(limit));
  const response = await fetch(`/api/admin/usage?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseJsonResponse<AdminUsageResponse>(response);
}

export async function fetchAdminUsers(email = '', limit = 80, page = 1): Promise<AdminUsersResponse> {
  const token = await getAccessToken();
  const params = new URLSearchParams();
  if (email.trim()) params.set('email', email.trim());
  params.set('limit', String(limit));
  params.set('page', String(page));
  const response = await fetch(`/api/admin/users?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return parseJsonResponse<AdminUsersResponse>(response);
}

export async function updateAdminCredits(
  email: string,
  action: 'add' | 'reset' | 'set',
  amount?: number,
): Promise<AdminCreditDetails> {
  const token = await getAccessToken();
  const response = await fetch('/api/admin/credits', {
    body: JSON.stringify({ action, amount, email: email.trim() }),
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  return parseJsonResponse<AdminCreditDetails>(response);
}
