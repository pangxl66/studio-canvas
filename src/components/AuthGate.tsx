import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { CreditStatusPill } from '@/components/CreditStatusPill';
import {
  getAuthSnapshot,
  getSupabaseClient,
  isSaasAuthEnabled,
  isSaasMockEnabled,
  sendLoginCode,
  signOut,
  STUDIO_AUTH_MOCK_EVENT,
  verifyLoginCode,
} from '@/services/authClient';

interface AuthGateProps {
  children: ReactNode;
}

function userLabel(user: User | null): string {
  return user?.email ?? '已登录用户';
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSaasAuthEnabled());
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isSaasAuthEnabled()) {
      return;
    }

    const client = getSupabaseClient();
    let isMounted = true;
    const syncAuthSnapshot = () => {
      void getAuthSnapshot().then((snapshot) => {
        if (isMounted) {
          setSession(snapshot.session);
        }
      });
    };

    getAuthSnapshot()
      .then((snapshot) => {
        if (!isMounted) return;
        setSession(snapshot.session);
      })
      .catch((error) => {
        if (!isMounted) return;
        setMessage(error instanceof Error ? error.message : '读取登录状态失败。');
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const { data } =
      client?.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
      }) ?? {};
    window.addEventListener(STUDIO_AUTH_MOCK_EVENT, syncAuthSnapshot);

    return () => {
      isMounted = false;
      data?.subscription.unsubscribe();
      window.removeEventListener(STUDIO_AUTH_MOCK_EVENT, syncAuthSnapshot);
    };
  }, []);

  if (!isSaasAuthEnabled()) {
    return <>{children}</>;
  }

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) {
      setMessage('请输入邮箱。');
      return;
    }

    setIsSubmitting(true);
    setMessage('');
    try {
      await sendLoginCode(nextEmail);
      setCodeSentTo(nextEmail);
      setVerificationCode('');
      setMessage(isSaasMockEnabled() ? '测试登录已启用，输入任意验证码即可进入。' : '验证码已发送，请到邮箱里查看。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送验证码失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = codeSentTo || email.trim();
    const nextCode = verificationCode.trim();
    if (!nextEmail) {
      setMessage('请先填写邮箱。');
      return;
    }
    if (!nextCode) {
      setMessage('请输入邮箱验证码。');
      return;
    }

    setIsSubmitting(true);
    setMessage('');
    try {
      const nextSession = await verifyLoginCode(nextEmail, nextCode);
      if (nextSession) {
        setSession(nextSession);
      } else {
        const snapshot = await getAuthSnapshot();
        setSession(snapshot.session);
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '验证码验证失败。');
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '退出登录失败。');
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

  if (!session) {
    return (
      <main className="auth-gate">
        <section className="auth-card">
          <p className="auth-card__eyebrow">Studio Canvas Cloud</p>
          <h1 className="auth-card__title">登录后进入在线工作区</h1>
          <p className="auth-card__copy">
            网站版会把工程保存到云端，并通过后端代理安全调用 LLM。现在使用邮箱验证码登录：先接收验证码，再输入验证码进入工作区。
          </p>

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
              type="email"
              value={email}
            />
            <button className="auth-card__button" disabled={isSubmitting} type="submit">
              {isSubmitting ? '正在发送...' : codeSentTo ? '重新发送验证码' : '发送验证码'}
            </button>
          </form>

          {codeSentTo ? (
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

          {message ? <p className="auth-card__message">{message}</p> : null}

          <p className="auth-card__hint">
            如果还没有 Supabase 项目，请先按文档执行 <code>docs/supabase-schema.sql</code> 并配置{' '}
            <code>VITE_SUPABASE_URL</code> 与 <code>VITE_SUPABASE_ANON_KEY</code>。
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="auth-session-pill nodrag nopan">
        <span>{userLabel(session.user)}</span>
        <button disabled={isSubmitting} type="button" onClick={() => void handleSignOut()}>
          退出
        </button>
      </div>
      <CreditStatusPill />
      {message ? <div className="auth-session-toast">{message}</div> : null}
      {children}
    </>
  );
}
