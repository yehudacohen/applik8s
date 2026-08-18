import {
  type ApplicationIdentityAccountView,
  type ApplicationIdentityClient,
  type ApplicationIdentitySessionDeviceView,
  createApplicationIdentityClient,
} from '@applik8s/identity/client';
import {
  useApplicationIdentityClient,
  useApplicationIdentitySession,
} from '@applik8s/react/identity';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface AgenticAccountSettingsProps {
  /**
   * Overrides the framework browser client for a custom transport or test.
   * Ordinary applications should omit this property.
   */
  readonly client?: ApplicationIdentityClient;
  readonly title?: string;
  readonly description?: ReactNode;
}

export interface AgenticAccountSessionProps {
  readonly loginLabel?: string;
  readonly registrationLabel?: string;
  readonly defaultMode?: 'login' | 'register';
  readonly signedInHref?: string;
  readonly signedOutHref?: string;
}

/** Maintained sign-in, registration, session restoration, and logout surface. */
export function AgenticAccountSession(
  props: AgenticAccountSessionProps = {},
): ReactNode {
  const client = useApplicationIdentityClient();
  const session = useApplicationIdentitySession();
  const [mode, setMode] = useState<'login' | 'register'>(
    props.defaultMode ?? 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (session.phase === 'loading') {
    return <span aria-label="Account session">Checking session…</span>;
  }
  if (
    session.phase === 'error'
    || !session.data?.authenticated
    || !session.data.principal
  ) {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setPending(true);
      setError(undefined);
      try {
        const flow = await client.beginFlow(mode, { email });
        const transition = flow.allowedTransitions.includes('password')
          ? 'password'
          : flow.allowedTransitions[0];
        if (!transition) {
          throw new Error(
            'The identity provider offered no admissible authentication transition.',
          );
        }
        await client.transitionFlow(flow.id, transition, { email, password });
        await session.refresh();
        if (props.signedInHref) {
          globalThis.location?.assign(props.signedInHref);
        }
      } catch (cause) {
        setError(identityErrorMessage(cause, 'Authentication failed.'));
      } finally {
        setPending(false);
      }
    }

    return (
      <form aria-label="Account session" className="grid gap-3" onSubmit={submit}>
        <strong>
          {mode === 'login'
            ? props.loginLabel ?? 'Sign in'
            : props.registrationLabel ?? 'Create account'}
        </strong>
        <label htmlFor="account-email">Email</label>
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
        />
        <label htmlFor="account-password">Password</label>
        <input
          id="account-password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        <button className="button-link border-0" type="submit" disabled={pending}>
          {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
        <button
          className="bg-transparent text-sm font-semibold text-emerald-800"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Need an account?' : 'Already registered?'}
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </form>
    );
  }
  return (
    <span aria-label="Account session" className="grid gap-2 text-xs text-stone-600">
      Signed in as <strong className="truncate text-stone-900">{session.data.principal.identity.subject}</strong>
      <button className="text-left font-semibold text-emerald-800" type="button" onClick={() => void session.logout().then(() => globalThis.location?.assign(props.signedOutHref ?? '/sign-in'))}>
        Sign out
      </button>
    </span>
  );
}

/**
 * Maintained, provider-neutral account security surface for Agentic Start.
 *
 * Applications own the route and surrounding product design. Applik8s owns
 * identity protocol calls, recovery, MFA enrollment, and session revocation.
 */
export function AgenticAccountSettings(
  props: AgenticAccountSettingsProps = {},
): ReactNode {
  const defaultClient = useMemo(
    () => props.client ?? createApplicationIdentityClient(),
    [props.client],
  );
  const [account, setAccount] = useState<ApplicationIdentityAccountView>();
  const [sessions, setSessions] =
    useState<readonly ApplicationIdentitySessionDeviceView[]>([]);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      defaultClient.account({ signal: controller.signal }),
      defaultClient.sessions({ signal: controller.signal }),
    ])
      .then(([nextAccount, nextSessions]) => {
        setAccount(nextAccount);
        setSessions(nextSessions);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(identityErrorMessage(
            cause,
            'Sign in to manage account security.',
          ));
        }
      });
    return () => controller.abort();
  }, [defaultClient]);

  async function beginRecovery(kind: 'verify' | 'recover') {
    setPending(true);
    setError(undefined);
    try {
      const flow = await defaultClient.beginFlow(kind, { email });
      if (flow.continuationUri) {
        globalThis.location.assign(flow.continuationUri);
        return;
      }
      setNotice(`${kind === 'verify' ? 'Verification' : 'Recovery'} started.`);
    } catch (cause) {
      setError(identityErrorMessage(
        cause,
        'The identity provider could not start this flow.',
      ));
    } finally {
      setPending(false);
    }
  }

  async function enroll(method: 'totp' | 'webauthn') {
    setPending(true);
    setError(undefined);
    try {
      const enrollment = await defaultClient.beginMfa(method);
      const continuation = enrollment.setup?.challenge;
      if (continuation?.startsWith('http')) {
        globalThis.location.assign(continuation);
        return;
      }
      setNotice(`Continue ${method} enrollment with your authenticator.`);
    } catch (cause) {
      setError(identityErrorMessage(
        cause,
        'Multi-factor enrollment is not available.',
      ));
    } finally {
      setPending(false);
    }
  }

  async function revoke(sessionId: string) {
    setPending(true);
    setError(undefined);
    try {
      setSessions(await defaultClient.revokeSession(sessionId));
    } catch (cause) {
      setError(identityErrorMessage(
        cause,
        'The session could not be revoked.',
      ));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="agentic-account-settings">
      <header className="agentic-account-intro">
        <p className="eyebrow">Provider-neutral identity</p>
        <h2>{props.title ?? 'Account security'}</h2>
        <p>
          {props.description
            ?? 'Verification, recovery, MFA, and session credentials remain behind the framework identity boundary.'}
        </p>
      </header>
      <section className="agentic-account-section" aria-label="Identity">
        <h2>Identity</h2>
        <dl className="agentic-account-facts">
          <div><dt>Signed in as</dt><dd>{account?.identity.subject ?? 'Loading account…'}</dd></div>
          <div><dt>Authentication</dt><dd>{account?.authenticationMethods.map(identityMethodLabel).join(', ') || 'Provider managed'}</dd></div>
        </dl>
      </section>
      <section className="agentic-account-section" aria-label="Sessions">
        <h2>Sessions</h2>
        <div className="agentic-account-list">
          {sessions.length === 0 ? <p>{account ? 'No active sessions were reported.' : 'Loading sessions…'}</p> : null}
          {sessions.map((session) => (
            <div className="agentic-account-list-item" key={session.id}>
              <div><strong>{session.current ? 'Current session' : 'Active session'}</strong><p>{session.authenticationMethods.map(identityMethodLabel).join(', ') || 'Provider managed'}</p></div>
              {session.current || !account?.capabilities.sessionRevocation
                ? <span className="agentic-account-state">{session.current ? 'This device' : 'Managed by provider'}</span>
                : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void revoke(session.id)}
                  >
                    Revoke
                  </button>
                )}
            </div>
          ))}
        </div>
      </section>
      <section className="agentic-account-section" aria-label="Multi-factor authentication">
        <h2>Multi-factor authentication</h2>
        {account?.mfa.length ? <div className="agentic-account-list">{account.mfa.map((method) => (
          <div className="agentic-account-list-item" key={method.id}><strong>{method.label ?? method.kind}</strong><span className="agentic-account-state">Enrolled</span></div>
        ))}</div> : null}
        {account?.capabilities.mfaEnrollment ? (
          <>
            <p>Add another factor without exposing provider-specific enrollment flows to application code.</p>
            <div className="agentic-account-actions">
              <button type="button" disabled={pending} onClick={() => void enroll('totp')}>Add authenticator app</button>
              <button type="button" disabled={pending} onClick={() => void enroll('webauthn')}>Add security key</button>
            </div>
          </>
        ) : account ? (
          <p>
            This identity profile does not offer multi-factor enrollment. Production profiles can expose authenticator and security-key enrollment here.
          </p>
        ) : <p>Loading multi-factor capabilities…</p>}
      </section>
      <section className="agentic-account-section" aria-label="Account recovery">
        <h2>Verification and recovery</h2>
        {account && (account.capabilities.verification || account.capabilities.recovery) ? (
          <form
            className="agentic-account-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void beginRecovery('verify');
            }}
          >
            <label htmlFor="account-recovery-email">Account email</label>
            <input id="account-recovery-email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <div className="agentic-account-actions">
              {account.capabilities.verification ? <button type="submit" disabled={pending || !email.trim()}>Verify email</button> : null}
              {account.capabilities.recovery ? <button type="button" disabled={pending || !email.trim()} onClick={() => void beginRecovery('recover')}>Recover account</button> : null}
            </div>
          </form>
        ) : account ? (
          <p>
            Email verification and account recovery are intentionally unavailable for the credential-free Starter identity. Select a managed identity profile to enable these flows.
          </p>
        ) : <p>Loading verification and recovery capabilities…</p>}
      </section>
      {notice ? <p className="agentic-account-notice" role="status">{notice}</p> : null}
      {error ? <p className="agentic-account-error" role="alert">{error}</p> : null}
    </div>
  );
}

function identityErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}

function identityMethodLabel(method: string): string {
  switch (method) {
    case 'deterministic-starter': return 'Local development identity';
    case 'password': return 'Password';
    case 'totp': return 'Authenticator app';
    case 'webauthn': return 'Security key or passkey';
    default: return method
      .split(/[-_]/u)
      .filter(Boolean)
      .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ');
  }
}
