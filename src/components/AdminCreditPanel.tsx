import { useState } from 'react';
import {
  fetchAdminCreditDetails,
  fetchAdminUsageEvents,
  updateAdminCredits,
  type AdminCreditDetails,
  type AdminUsageResponse,
} from '@/services/adminCreditService';

interface AdminCreditPanelProps {
  onChanged?: () => void;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function usageLabel(status: string): string {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return status || '-';
}

function sourceLabel(source?: string): string {
  if (source === 'test-invite') return '测试';
  return '正式';
}

export function AdminCreditPanel({ onChanged, onClose }: AdminCreditPanelProps) {
  const [activeTab, setActiveTab] = useState<'credits' | 'usage'>('credits');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('30');
  const [details, setDetails] = useState<AdminCreditDetails | null>(null);
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [usageEmail, setUsageEmail] = useState('');
  const [usageLimit, setUsageLimit] = useState('80');
  const [usageResponse, setUsageResponse] = useState<AdminUsageResponse | null>(null);
  const [usageMessage, setUsageMessage] = useState('');
  const [isUsageBusy, setIsUsageBusy] = useState(false);

  const loadDetails = async (targetEmail = email) => {
    const nextEmail = targetEmail.trim();
    if (!nextEmail) {
      setMessage('请先输入用户邮箱。');
      return;
    }
    setIsBusy(true);
    setMessage('');
    try {
      const nextDetails = await fetchAdminCreditDetails(nextEmail);
      setDetails(nextDetails);
      setEmail(nextDetails.user.email);
      setMessage('已读取用户额度。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取用户额度失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const runAction = async (action: 'add' | 'reset' | 'set') => {
    const nextEmail = email.trim();
    if (!nextEmail) {
      setMessage('请先输入用户邮箱。');
      return;
    }
    const numericAmount = Number.parseInt(amount, 10);
    if (action !== 'reset' && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      setMessage('次数必须是有效整数。');
      return;
    }

    setIsBusy(true);
    setMessage('');
    try {
      const nextDetails = await updateAdminCredits(nextEmail, action, numericAmount);
      setDetails(nextDetails);
      setEmail(nextDetails.user.email);
      setMessage(action === 'reset' ? '已重置为默认额度。' : '额度已更新。');
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新额度失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const loadUsage = async (targetEmail = usageEmail, targetLimit = usageLimit) => {
    const limit = Number.parseInt(targetLimit, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      setUsageMessage('记录条数需要在 1-200 之间。');
      return;
    }

    setIsUsageBusy(true);
    setUsageMessage('');
    try {
      const response = await fetchAdminUsageEvents(targetEmail, limit);
      setUsageResponse(response);
      setUsageMessage(response.email ? '已按邮箱筛选使用记录。' : '已读取最近使用记录。');
    } catch (error) {
      setUsageMessage(error instanceof Error ? error.message : '读取使用记录失败。');
    } finally {
      setIsUsageBusy(false);
    }
  };

  const switchTab = (tab: 'credits' | 'usage') => {
    setActiveTab(tab);
    setMessage('');
    setUsageMessage('');
    if (tab === 'usage' && !usageResponse) {
      void loadUsage();
    }
  };

  return (
    <div className="admin-credit-panel nodrag nopan" role="dialog" aria-modal="true">
      <div className="admin-credit-panel__backdrop" onClick={onClose} />
      <section className="admin-credit-panel__card">
        <header className="admin-credit-panel__header">
          <div>
            <p>ADMIN</p>
            <h2>后台管理</h2>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="admin-credit-panel__tabs" role="tablist" aria-label="后台管理功能">
          <button className={activeTab === 'credits' ? 'is-active' : ''} type="button" onClick={() => switchTab('credits')}>
            额度管理
          </button>
          <button className={activeTab === 'usage' ? 'is-active' : ''} type="button" onClick={() => switchTab('usage')}>
            使用记录
          </button>
        </div>

        {activeTab === 'credits' ? (
          <>
            <div className="admin-credit-panel__controls">
              <label>
                用户邮箱
                <input
                  disabled={isBusy}
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="user@example.com"
                  type="email"
                  value={email}
                />
              </label>
              <label>
                次数
                <input
                  disabled={isBusy}
                  min={0}
                  onChange={(event) => setAmount(event.target.value)}
                  type="number"
                  value={amount}
                />
              </label>
            </div>

            <div className="admin-credit-panel__actions">
              <button disabled={isBusy} type="button" onClick={() => void loadDetails()}>
                查询
              </button>
              <button disabled={isBusy} type="button" onClick={() => void runAction('add')}>
                增加次数
              </button>
              <button disabled={isBusy} type="button" onClick={() => void runAction('set')}>
                设为次数
              </button>
              <button disabled={isBusy} type="button" onClick={() => void runAction('reset')}>
                重置为 30
              </button>
            </div>

            {message ? <p className="admin-credit-panel__message">{message}</p> : null}

            {details ? (
              <>
                <div className="admin-credit-panel__summary">
                  <span>用户：{details.user.email}</span>
                  <strong>
                    {details.wallet.remainingQuota}/{details.wallet.monthlyQuota}
                  </strong>
                  <span>更新时间：{formatDate(details.wallet.updatedAt)}</span>
                </div>

                <div className="admin-credit-panel__usage">
                  <h3>该用户最近调用记录</h3>
                  {details.usageEvents.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>模型</th>
                          <th>状态</th>
                          <th>消耗</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.usageEvents.map((event, index) => (
                          <tr key={`${event.createdAt}-${index}`}>
                            <td>{formatDate(event.createdAt)}</td>
                            <td>{event.model || '-'}</td>
                            <td title={event.errorMessage || undefined}>{usageLabel(event.status)}</td>
                            <td>{event.quotaCost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="admin-credit-panel__empty">暂无调用记录。</p>
                  )}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="admin-credit-panel__controls">
              <label>
                筛选邮箱
                <input
                  disabled={isUsageBusy}
                  inputMode="email"
                  onChange={(event) => setUsageEmail(event.target.value)}
                  placeholder="留空查看全部用户"
                  type="email"
                  value={usageEmail}
                />
              </label>
              <label>
                条数
                <input
                  disabled={isUsageBusy}
                  max={200}
                  min={1}
                  onChange={(event) => setUsageLimit(event.target.value)}
                  type="number"
                  value={usageLimit}
                />
              </label>
            </div>

            <div className="admin-credit-panel__actions">
              <button disabled={isUsageBusy} type="button" onClick={() => void loadUsage()}>
                刷新记录
              </button>
              <button
                disabled={isUsageBusy}
                type="button"
                onClick={() => {
                  setUsageEmail('');
                  setUsageMessage('');
                  void loadUsage('', usageLimit);
                }}
              >
                清空筛选
              </button>
            </div>

            {usageMessage ? <p className="admin-credit-panel__message">{usageMessage}</p> : null}

            <div className="admin-credit-panel__usage">
              <h3>{usageResponse?.email ? `使用记录：${usageResponse.email}` : '全站最近使用记录'}</h3>
              {usageResponse?.events.length ? (
                <table className="admin-credit-panel__usage-table--wide">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>用户</th>
                      <th>功能</th>
                      <th>模型</th>
                      <th>状态</th>
                      <th>消耗</th>
                      <th>字符</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageResponse.events.map((event, index) => (
                      <tr key={`${event.createdAt}-${index}`}>
                        <td>{formatDate(event.createdAt)}</td>
                        <td>
                          <span className="admin-credit-panel__user-email">{event.user.email || '-'}</span>
                          <small>{sourceLabel(event.source)} · {event.user.plan || '-'}</small>
                        </td>
                        <td>{event.feature || '-'}</td>
                        <td>{event.model || '-'}</td>
                        <td title={event.errorMessage || undefined}>{usageLabel(event.status)}</td>
                        <td>{event.quotaCost}</td>
                        <td>
                          {event.inputChars}/{event.outputChars}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="admin-credit-panel__empty">{isUsageBusy ? '正在读取使用记录...' : '暂无使用记录。'}</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
