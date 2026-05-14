import { getSupabaseClient, isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';

export const STUDIO_CREDIT_REFRESH_EVENT = 'studio-credit-refresh';

export type CreditStatus = {
  displayName: string | null;
  email: string | null;
  isAdmin?: boolean;
  monthlyQuota: number;
  plan: string;
  remainingQuota: number;
  resetAt: string | null;
  updatedAt: string | null;
  userId: string;
};

const MOCK_CREDIT_KEY = 'studio_canvas_saas_mock_credit_v1';
const DEFAULT_MOCK_MONTHLY_QUOTA = 30;

function readMockCredit(): CreditStatus {
  try {
    const raw = localStorage.getItem(MOCK_CREDIT_KEY);
    if (raw) {
      return JSON.parse(raw) as CreditStatus;
    }
  } catch {
    // Fall back to default mock credit.
  }

  const nextStatus: CreditStatus = {
    displayName: 'Local Mock',
    email: 'mock@studio.local',
    monthlyQuota: DEFAULT_MOCK_MONTHLY_QUOTA,
    plan: 'trial',
    remainingQuota: DEFAULT_MOCK_MONTHLY_QUOTA,
    resetAt: null,
    updatedAt: new Date().toISOString(),
    userId: 'mock-user-local',
  };
  localStorage.setItem(MOCK_CREDIT_KEY, JSON.stringify(nextStatus));
  return nextStatus;
}

function writeMockCredit(status: CreditStatus): void {
  localStorage.setItem(MOCK_CREDIT_KEY, JSON.stringify(status));
}

export function requestCreditRefresh(): void {
  window.dispatchEvent(new Event(STUDIO_CREDIT_REFRESH_EVENT));
}

export function spendMockCredit(cost = 1): void {
  if (!isSaasMockEnabled()) return;
  const current = readMockCredit();
  writeMockCredit({
    ...current,
    remainingQuota: Math.max(0, current.remainingQuota - cost),
    updatedAt: new Date().toISOString(),
  });
  requestCreditRefresh();
}

export async function fetchCreditStatus(): Promise<CreditStatus | null> {
  if (!isSaasAuthEnabled()) {
    return null;
  }

  if (isSaasMockEnabled()) {
    return readMockCredit();
  }

  const session = (await getSupabaseClient()?.auth.getSession())?.data.session;
  if (!session?.access_token) {
    return null;
  }

  const response = await fetch('/api/credits/status', {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | CreditStatus
    | null;

  if (!response.ok) {
    const message =
      payload && 'error' in payload && payload.error?.message ? payload.error.message : '读取额度失败。';
    throw new Error(message);
  }

  return payload as CreditStatus;
}
