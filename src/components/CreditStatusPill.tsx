import { useCallback, useEffect, useState } from 'react';
import { AdminCreditPanel } from '@/components/AdminCreditPanel';
import {
  fetchCreditStatus,
  STUDIO_CREDIT_REFRESH_EVENT,
  type CreditStatus,
} from '@/services/creditService';

const RECHARGE_WECHAT_ID = 'hb1115686003';

function quotaText(status: CreditStatus | null): string {
  if (!status) {
    return '...';
  }
  return String(status.remainingQuota);
}

function isAdminToolsEnabled(): boolean {
  const raw = (import.meta.env.VITE_ADMIN_TOOLS ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function CreditStatusPill() {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isRechargePanelOpen, setIsRechargePanelOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const adminToolsEnabled = isAdminToolsEnabled() || Boolean(status?.isAdmin);

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

  const copyRechargeWechatId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(RECHARGE_WECHAT_ID);
      setCopyMessage('已复制微信号。');
    } catch {
      setCopyMessage('复制失败，请手动复制微信号。');
    }
  }, []);

  return (
    <>
      <div className="credit-status-pill nodrag nopan" title={error || '当前账号剩余额度'}>
        <button
          className="credit-status-pill__recharge"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setCopyMessage('');
            setIsRechargePanelOpen(true);
          }}
        >
          充值
        </button>
        <span className="credit-status-pill__label">额度</span>
        <strong>{isLoading && !status ? '...' : quotaText(status)}</strong>
        {adminToolsEnabled ? (
          <button
            className="credit-status-pill__admin"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsAdminPanelOpen(true);
            }}
          >
            管理
          </button>
        ) : null}
        {error ? <span className="credit-status-pill__error">!</span> : null}
      </div>
      {isAdminPanelOpen ? (
        <AdminCreditPanel onChanged={() => void refresh()} onClose={() => setIsAdminPanelOpen(false)} />
      ) : null}
      {isRechargePanelOpen ? (
        <div className="recharge-panel nodrag nopan" role="dialog" aria-modal="true" aria-label="充值额度">
          <div className="recharge-panel__backdrop" onClick={() => setIsRechargePanelOpen(false)} />
          <section className="recharge-panel__card">
            <header className="recharge-panel__header">
              <div>
                <p>RECHARGE</p>
                <h2>充值额度</h2>
              </div>
              <button type="button" onClick={() => setIsRechargePanelOpen(false)}>
                关闭
              </button>
            </header>
            <div className="recharge-panel__contact">
              <span>线上充值添加 VX</span>
              <strong>{RECHARGE_WECHAT_ID}</strong>
              <button type="button" onClick={() => void copyRechargeWechatId()}>
                复制
              </button>
            </div>
            <p className="recharge-panel__note">添加时请备注登录邮箱，方便核对额度。</p>
            {copyMessage ? <p className="recharge-panel__message">{copyMessage}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
