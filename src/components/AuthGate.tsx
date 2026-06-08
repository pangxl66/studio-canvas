import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { CreditStatusPill } from '@/components/CreditStatusPill';
import {
  checkActivatedTestInviteEmail,
  getAuthSnapshot,
  getSupabaseClient,
  hasActivatedTestInviteEmail,
  isSaasAuthEnabled,
  isSaasMockEnabled,
  sendLoginCode,
  signInWithTestInvite,
  signOut,
  STUDIO_AUTH_MOCK_EVENT,
  verifyLoginCode,
} from '@/services/authClient';

interface AuthGateProps {
  children: ReactNode;
}

const SEND_CODE_COOLDOWN_SECONDS = 60;

function userLabel(user: User | null): string {
  return user?.email ?? '已登录用户';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function getLoginErrorMessage(error: unknown, fallback: string): string {
  const rawMessage = getErrorMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();

  if (normalizedMessage.includes('email rate limit')) {
    return '邮箱验证码发送太频繁了，请稍后再试。正式上线建议配置 Supabase 自定义 SMTP，避免内置邮件额度限制。';
  }
  if (normalizedMessage.includes('otp') || normalizedMessage.includes('token')) {
    return '验证码无效或已过期，请重新发送验证码。';
  }

  return rawMessage || fallback;
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSaasAuthEnabled());
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [authMode, setAuthMode] = useState<'email' | 'invite'>('email');
  const [codeSentTo, setCodeSentTo] = useState('');
  const [sendCooldown, setSendCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingInviteActivation, setIsCheckingInviteActivation] = useState(false);
  const [serverActivatedInviteEmail, setServerActivatedInviteEmail] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setSendCooldown((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sendCooldown]);

  useEffect(() => {
    if (!isSaasAuthEnabled()) return;

    const client = getSupabaseClient();
    let isMounted = true;

    const syncAuthSnapshot = () => {
      void getAuthSnapshot().then((snapshot) => {
        if (isMounted) setSession(snapshot.session);
      });
    };

    getAuthSnapshot()
      .then((snapshot) => {
        if (isMounted) setSession(snapshot.session);
      })
      .catch((error) => {
        if (isMounted) setMessage(getLoginErrorMessage(error, '读取登录状态失败。'));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    const { data } =
      client?.auth.onAuthStateChange((_event, nextSession) => {
        if (nextSession) {
          setSession(nextSession);
        } else {
          syncAuthSnapshot();
        }
      }) ?? {};

    window.addEventListener(STUDIO_AUTH_MOCK_EVENT, syncAuthSnapshot);

    return () => {
      isMounted = false;
      data?.subscription?.unsubscribe();
      window.removeEventListener(STUDIO_AUTH_MOCK_EVENT, syncAuthSnapshot);
    };
  }, []);

  useEffect(() => {
    const normalizedEmail = email.trim().toLowerCase();
    if (authMode !== 'invite' || !normalizedEmail || !normalizedEmail.includes('@')) {
      setServerActivatedInviteEmail('');
      setIsCheckingInviteActivation(false);
      return;
    }

    if (hasActivatedTestInviteEmail(normalizedEmail)) {
      setServerActivatedInviteEmail(normalizedEmail);
      setIsCheckingInviteActivation(false);
      return;
    }

    let isCancelled = false;
    setIsCheckingInviteActivation(true);
    const timer = window.setTimeout(() => {
      void checkActivatedTestInviteEmail(normalizedEmail)
        .then((activated) => {
          if (!isCancelled) setServerActivatedInviteEmail(activated ? normalizedEmail : '');
        })
        .finally(() => {
          if (!isCancelled) setIsCheckingInviteActivation(false);
        });
    }, 350);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [authMode, email]);

  if (!isSaasAuthEnabled()) {
    return <>{children}</>;
  }

  const currentUser = session?.user ?? null;

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || sendCooldown > 0) return;

    setIsSubmitting(true);
    setMessage('');

    try {
      if (await checkActivatedTestInviteEmail(email)) {
        const nextSession = await signInWithTestInvite(email, '');
        setSession(nextSession);
        setCodeSentTo('');
        setVerificationCode('');
        setMessage('');
        return;
      }
      await sendLoginCode(email);
      setCodeSentTo(email.trim());
      setVerificationCode('');
      setSendCooldown(SEND_CODE_COOLDOWN_SECONDS);
      setMessage(isSaasMockEnabled() ? '测试登录已启用，输入任意验证码即可进入。' : '验证码已发送，请到邮箱查看后填入。');
    } catch (error) {
      setSendCooldown(SEND_CODE_COOLDOWN_SECONDS);
      setMessage(getLoginErrorMessage(error, '验证码发送失败。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setMessage('');

    try {
      const nextSession = await verifyLoginCode(codeSentTo || email, verificationCode);
      setSession(nextSession);
      setMessage('');
      setVerificationCode('');
    } catch (error) {
      setMessage(getLoginErrorMessage(error, '验证码验证失败。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEmail = String(formData.get('email') || email).trim();
    const nextInviteCode = String(formData.get('inviteCode') || inviteCode).trim();

    setIsSubmitting(true);
    setMessage('');

    try {
      setEmail(nextEmail);
      setInviteCode(nextInviteCode);
      const nextSession = await signInWithTestInvite(nextEmail, nextInviteCode);
      setSession(nextSession);
      setInviteCode('');
      setMessage('');
    } catch (error) {
      setMessage(getLoginErrorMessage(error, '测试邀请码登录失败。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);
    setMessage('');
    try {
      await signOut();
      setSession(null);
      setCodeSentTo('');
      setVerificationCode('');
      setInviteCode('');
    } catch (error) {
      setMessage(getLoginErrorMessage(error, '退出登录失败。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="auth-gate">
        <section className="auth-card auth-card--compact">
          <p className="auth-card__eyebrow">Studio Canvas Cloud</p>
          <h1 className="auth-card__title">正在检查登录状态</h1>
          <p className="auth-card__copy">马上就好，我们先确认你的在线工作区。</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    const canSendCode = !isSubmitting && sendCooldown <= 0;
    const hasSentCode = Boolean(codeSentTo);
    const normalizedInviteEmail = email.trim().toLowerCase();
    const inviteAlreadyActivated =
      authMode === 'invite' &&
      Boolean(
        normalizedInviteEmail &&
          (hasActivatedTestInviteEmail(normalizedInviteEmail) || serverActivatedInviteEmail === normalizedInviteEmail),
      );

    return (
      <main className="auth-gate">
        <section className="auth-card">
          <p className="auth-card__eyebrow">Studio Canvas Cloud</p>
          <h1 className="auth-card__title">登录后进入在线工作区</h1>

          <div className="auth-card__mode-tabs" role="tablist" aria-label="登录方式">
            <button
              aria-selected={authMode === 'email'}
              className={`auth-card__mode-tab ${authMode === 'email' ? 'is-active' : ''}`}
              onClick={() => {
                setAuthMode('email');
                setMessage('');
              }}
              role="tab"
              type="button"
            >
              邮箱验证码
            </button>
            <button
              aria-selected={authMode === 'invite'}
              className={`auth-card__mode-tab ${authMode === 'invite' ? 'is-active' : ''}`}
              onClick={() => {
                setAuthMode('invite');
                setMessage('');
              }}
              role="tab"
              type="button"
            >
              测试邀请码
            </button>
          </div>

          {authMode === 'email' ? (
            <>
              <form className="auth-card__form" onSubmit={handleSendCode}>
                <label className="auth-card__label" htmlFor="studio-auth-email">
                  邮箱
                </label>
                <input
                  autoComplete="email"
                  className="auth-card__input"
                  disabled={isSubmitting}
                  id="studio-auth-email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
                <button className="auth-card__button" disabled={!canSendCode} type="submit">
                  {isSubmitting ? '正在发送...' : sendCooldown > 0 ? `${sendCooldown} 秒后可重发` : hasSentCode ? '重新发送验证码' : '发送验证码'}
                </button>
              </form>

              {hasSentCode ? (
                <form className="auth-card__form auth-card__form--verify" onSubmit={handleVerifyCode}>
                  <label className="auth-card__label" htmlFor="studio-auth-code">
                    验证码
                  </label>
                  <input
                    autoComplete="one-time-code"
                    className="auth-card__input auth-card__input--code"
                    disabled={isSubmitting}
                    id="studio-auth-code"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\s/g, ''))}
                    placeholder="输入邮箱验证码"
                    required
                    value={verificationCode}
                  />
                  <button className="auth-card__button" disabled={isSubmitting} type="submit">
                    {isSubmitting ? '正在验证...' : '验证并进入'}
                  </button>
                  <button
                    className="auth-card__secondary-button"
                    disabled={isSubmitting}
                    type="button"
                    onClick={() => {
                      setCodeSentTo('');
                      setVerificationCode('');
                      setMessage('');
                    }}
                  >
                    换一个邮箱
                  </button>
                </form>
              ) : null}
            </>
          ) : null}

          {authMode === 'invite' ? (
            <>
              <form className="auth-card__form" onSubmit={handleTestInvite}>
                <label className="auth-card__label" htmlFor="studio-invite-email">
                  邮箱
                </label>
                <input
                  autoComplete="email"
                  className="auth-card__input"
                  disabled={isSubmitting}
                  id="studio-invite-email"
                  inputMode="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
                <label className="auth-card__label" htmlFor="studio-test-invite-code">
                  测试邀请码
                </label>
                <input
                  autoComplete="off"
                  className="auth-card__input auth-card__input--code"
                  disabled={isSubmitting || inviteAlreadyActivated}
                  id="studio-test-invite-code"
                  name="inviteCode"
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="输入测试邀请码"
                  type="password"
                  value={inviteCode}
                />
                {isCheckingInviteActivation ? <p className="auth-card__inline-note">正在检查该邮箱是否已激活...</p> : null}
                {inviteAlreadyActivated ? <p className="auth-card__inline-note">该邮箱已激活，不需要再次输入激活码。</p> : null}
                <button className="auth-card__button" disabled={isSubmitting} type="submit">
                  {isSubmitting
                    ? '正在进入...'
                    : isCheckingInviteActivation
                      ? '正在检查邮箱...'
                      : inviteAlreadyActivated
                        ? '进入已激活账号'
                        : '使用测试邀请码进入'}
                </button>
              </form>
              <p className="auth-card__hint">测试入口用于临时给朋友体验，不占用邮箱验证码额度；测试用户暂不支持云端保存工程。</p>
            </>
          ) : null}

          {message ? <p className="auth-card__message">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="auth-topbar-account nodrag nopan">
        <div className="auth-session-pill">
          <span>{userLabel(currentUser)}</span>
          <button disabled={isSubmitting} type="button" onClick={() => void handleSignOut()}>
            退出
          </button>
        </div>
        <CreditStatusPill />
      </div>
      {message ? <div className="auth-session-toast">{message}</div> : null}
      {children}
    </>
  );
}
