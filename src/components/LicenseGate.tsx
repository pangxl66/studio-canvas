import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { LicenseStatus, StudioLicenseApi } from '@/types/license';

interface LicenseGateProps {
  children: ReactNode;
}

function getDesktopLicenseApi(): StudioLicenseApi | undefined {
  return window.studioLicense?.isDesktop ? window.studioLicense : undefined;
}

function formatDateTime(value?: string) {
  if (!value) {
    return '永久';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function LicenseGate({ children }: LicenseGateProps) {
  const api = getDesktopLicenseApi();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState('');

  useEffect(() => {
    if (!api) {
      return;
    }

    let isMounted = true;
    api
      .getStatus()
      .then((nextStatus) => {
        if (isMounted) {
          setStatus(nextStatus);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLocalMessage('读取本机授权状态失败，请重新打开应用。');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [api]);

  if (!api) {
    return <>{children}</>;
  }

  if (!status && !localMessage) {
    return (
      <main className="license-gate">
        <section className="license-card license-card--compact">
          <p className="license-card__eyebrow">Studio Canvas 桌面版</p>
          <h1 className="license-card__title">正在检查本机授权</h1>
          <p className="license-card__copy">稍等一下，我们先确认这台设备是否已经激活。</p>
        </section>
      </main>
    );
  }

  if (status?.active) {
    return <>{children}</>;
  }

  const handleActivate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextLicenseKey = licenseKey.trim();
    if (!nextLicenseKey) {
      setLocalMessage('请输入授权码。');
      return;
    }

    setIsBusy(true);
    setLocalMessage('');

    try {
      const nextStatus = await api.activate(nextLicenseKey);
      setStatus(nextStatus);
      setLocalMessage(nextStatus.message || (nextStatus.active ? '授权激活成功。' : '授权激活失败。'));
    } catch {
      setLocalMessage('授权激活请求失败，请稍后重试。');
    } finally {
      setIsBusy(false);
    }
  };

  const message = localMessage || status?.message;
  const canUseDevelopmentKey = status?.devUnlockAvailable && !status.configured;

  return (
    <main className="license-gate">
      <section className="license-card">
        <div className="license-card__header">
          <p className="license-card__eyebrow">Studio Canvas 桌面版</p>
          <span className="license-card__badge">
            {status?.mode === 'development' ? '开发测试' : '需要激活'}
          </span>
        </div>

        <h1 className="license-card__title">输入授权码解锁完整工具</h1>
        <p className="license-card__copy">
          授权会绑定当前设备。激活后，本机将保存授权状态，之后打开桌面版会直接进入画布。
        </p>

        <form className="license-card__form" onSubmit={handleActivate}>
          <label className="license-card__label" htmlFor="studio-license-key">
            授权码
          </label>
          <input
            autoComplete="off"
            className="license-card__input"
            disabled={isBusy}
            id="studio-license-key"
            onChange={(event) => setLicenseKey(event.target.value)}
            placeholder="例如：SC-XXXX-XXXX-XXXX"
            spellCheck={false}
            value={licenseKey}
          />
          <button className="license-card__button" disabled={isBusy} type="submit">
            {isBusy ? '正在激活...' : '激活桌面版'}
          </button>
        </form>

        {message ? <p className="license-card__message">{message}</p> : null}

        <dl className="license-card__meta">
          <div>
            <dt>设备码</dt>
            <dd>{status?.deviceId || '读取中'}</dd>
          </div>
          <div>
            <dt>授权服务</dt>
            <dd>{status?.configured ? '已配置' : '未配置'}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>{formatDateTime(status?.expiresAt)}</dd>
          </div>
        </dl>

        {canUseDevelopmentKey ? (
          <p className="license-card__hint">
            当前是本机开发模式，可使用测试码 <code>SC-DEV-LOCAL</code> 验证激活流程。正式打包时需要配置授权服务地址。
          </p>
        ) : (
          <p className="license-card__hint">
            如果你已经购买但无法激活，把设备码发给发行方，我们可以帮助你检查授权状态。
          </p>
        )}
      </section>
    </main>
  );
}
