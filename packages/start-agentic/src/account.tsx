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
      <button className="text-left font-semibold text-emerald-800" type="button" onClick={() => void session.logout()}>
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
    <div>
      <p className="eyebrow">Provider-neutral identity</p>
      <h1>{props.title ?? 'Account security'}</h1>
      <p>
        {props.description
          ?? 'Verification, recovery, MFA, and session credentials remain behind the framework identity boundary.'}
      </p>
      <section aria-label="Identity">
        <h2>Identity</h2>
        <p>{account?.identity.subject ?? 'Loading account…'}</p>
        <p>{account?.authenticationMethods.join(', ')}</p>
      </section>
      <section aria-label="Sessions">
        <h2>Sessions</h2>
        {sessions.map((session) => (
          <p key={session.id}>
            {session.current ? 'Current session' : session.id}
            {' · '}
            {session.authenticationMethods.join(', ')}
            {session.current || !account?.capabilities.sessionRevocation
              ? null
              : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void revoke(session.id)}
                >
                  Revoke
                </button>
              )}
          </p>
        ))}
      </section>
      <section aria-label="Multi-factor authentication">
        <h2>Multi-factor authentication</h2>
        {account?.mfa.map((method) => (
          <p key={method.id}>{method.label ?? method.kind}</p>
        ))}
        {account?.capabilities.mfaEnrollment ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => void enroll('totp')}
            >
              Add authenticator app
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void enroll('webauthn')}
            >
              Add security key
            </button>
          </>
        ) : (
          <p>
            Multi-factor enrollment is not available in this identity profile.
          </p>
        )}
      </section>
      <section aria-label="Account recovery">
        <h2>Verification and recovery</h2>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void beginRecovery('verify');
          }}
        >
          <label htmlFor="account-recovery-email">Email</label>
          <input
            id="account-recovery-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <button
            type="submit"
            disabled={
              pending
              || !email.trim()
              || !account?.capabilities.verification
            }
          >
            Verify email
          </button>
          <button
            type="button"
            disabled={
              pending
              || !email.trim()
              || !account?.capabilities.recovery
            }
            onClick={() => void beginRecovery('recover')}
          >
            Recover account
          </button>
        </form>
      </section>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function identityErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}
