import { useCallback, useEffect, useState } from 'react';
import {
  fetchCreditStatus,
  STUDIO_CREDIT_REFRESH_EVENT,
  type CreditStatus,
} from '@/services/creditService';

function planLabel(plan: string): string {
  if (plan === 'pro') return 'Pro';
  if (plan === 'personal') return '个人版';
  if (plan === 'trial') return '试用';
  return 'Free';
}

function quotaText(status: CreditStatus | null): string {
  if (!status) {
    return '额度读取中';
  }
  return `${status.remainingQuota}/${status.monthlyQuota}`;
}

export function CreditStatusPill() {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextStatus = await fetchCreditStatus();
      setStatus(nextStatus);
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取额度失败。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    const intervalId = window.setInterval(() => void refresh(), 60_000);

    window.addEventListener('focus', onFocus);
    window.addEventListener(STUDIO_CREDIT_REFRESH_EVENT, onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(STUDIO_CREDIT_REFRESH_EVENT, onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return (
    <div className="credit-status-pill nodrag nopan" title={error || '当前账号剩余额度'}>
      <span className="credit-status-pill__label">{status ? planLabel(status.plan) : 'Quota'}</span>
      <strong>{isLoading && !status ? '...' : quotaText(status)}</strong>
      {error ? <span className="credit-status-pill__error">!</span> : null}
    </div>
  );
}
