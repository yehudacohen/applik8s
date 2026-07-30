import {
  createApplicationIdentityClient,
  type ApplicationIdentityAccountView,
  type ApplicationIdentityClient,
  type ApplicationIdentityClientOptions,
  type ApplicationIdentityFlowView,
  type ApplicationIdentitySessionView,
  type ApplicationOAuthClientCredential,
  type ApplicationOAuthClientView,
  type ApplicationOAuthConsentView,
  type ApplicationPreAuthenticationFlowKind,
} from '@applik8s/identity/client';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const ApplicationIdentityClientContext = createContext<ApplicationIdentityClient | undefined>(undefined);

export interface ApplicationIdentityProviderProps extends ApplicationIdentityClientOptions {
  readonly client?: ApplicationIdentityClient;
  readonly children?: ReactNode;
}

/** Router-independent provider for the browser-safe identity seam. */
export function ApplicationIdentityProvider(props: ApplicationIdentityProviderProps): ReactNode {
  const client = useMemo(
    () => props.client ?? createApplicationIdentityClient(props),
    [props.baseUrl, props.client, props.credentials, props.fetch, props.maxResponseBytes],
  );
  return createElement(ApplicationIdentityClientContext.Provider, { value: client }, props.children);
}

export function useApplicationIdentityClient(): ApplicationIdentityClient {
  const client = useContext(ApplicationIdentityClientContext);
  if (!client) throw new Error('useApplicationIdentityClient requires an ApplicationIdentityProvider.');
  return client;
}

export interface ApplicationIdentityResourceState<T> {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly data?: T;
  readonly error?: Error;
  readonly refresh: () => Promise<T>;
}

export interface ApplicationIdentitySessionState extends ApplicationIdentityResourceState<ApplicationIdentitySessionView> {
  readonly logout: () => Promise<ApplicationIdentitySessionView>;
}

export function useApplicationIdentitySession(): ApplicationIdentitySessionState {
  const client = useApplicationIdentityClient();
  const resource = useIdentityResource(() => client.session(), [client]);
  const logout = useCallback(async () => {
    const session = await client.logout();
    resource.replace(session);
    return session;
  }, [client, resource]);
  return useMemo(() => ({ ...resource.state, logout }), [logout, resource.state]);
}

export interface ApplicationIdentityAccountState extends ApplicationIdentityResourceState<ApplicationIdentityAccountView> {
  readonly update: (input: Readonly<Record<string, unknown>>) => Promise<ApplicationIdentityAccountView>;
  readonly removeMfa: (methodId: string) => Promise<ApplicationIdentityAccountView>;
}

export function useApplicationIdentityAccount(): ApplicationIdentityAccountState {
  const client = useApplicationIdentityClient();
  const resource = useIdentityResource(() => client.account(), [client]);
  const update = useCallback(async (input: Readonly<Record<string, unknown>>) => {
    const account = await client.updateAccount(input);
    resource.replace(account);
    return account;
  }, [client, resource]);
  const removeMfa = useCallback(async (methodId: string) => {
    const account = await client.removeMfa(methodId);
    resource.replace(account);
    return account;
  }, [client, resource]);
  return useMemo(() => ({ ...resource.state, update, removeMfa }), [removeMfa, resource.state, update]);
}

export interface ApplicationIdentityFlowState {
  readonly flow?: ApplicationIdentityFlowView;
  readonly pending: boolean;
  readonly error?: Error;
  readonly begin: (
    input?: Readonly<Record<string, unknown>>,
  ) => Promise<ApplicationIdentityFlowView>;
  readonly transition: (
    transition: string,
    input?: Readonly<Record<string, unknown>>,
  ) => Promise<ApplicationIdentityFlowView | ApplicationIdentitySessionView>;
  readonly cancel: () => Promise<ApplicationIdentityFlowView>;
  readonly reset: () => void;
}

export function useApplicationIdentityFlow(
  kind: ApplicationPreAuthenticationFlowKind,
): ApplicationIdentityFlowState {
  const client = useApplicationIdentityClient();
  const [state, setState] = useState<{
    readonly flow?: ApplicationIdentityFlowView;
    readonly pending: boolean;
    readonly error?: Error;
  }>({ pending: false });
  const begin = useCallback(async (input: Readonly<Record<string, unknown>> = {}) => {
    setState((current) => ({
      ...(current.flow ? { flow: current.flow } : {}),
      pending: true,
    }));
    try {
      const flow = await client.beginFlow(kind, input);
      setState({ flow, pending: false });
      return flow;
    } catch (error) {
      setState((current) => ({ ...current, pending: false, error: normalizedError(error) }));
      throw error;
    }
  }, [client, kind]);
  const transition = useCallback(async (
    name: string,
    input: Readonly<Record<string, unknown>> = {},
  ) => {
    if (!state.flow) throw new Error(`Identity ${kind} flow has not been started.`);
    setState((current) => ({
      ...(current.flow ? { flow: current.flow } : {}),
      pending: true,
    }));
    try {
      const result = await client.transitionFlow(state.flow.id, name, input);
      setState((current) => ({
        ...(result.kind === 'flow' ? { flow: result } : current),
        pending: false,
      }));
      return result;
    } catch (error) {
      setState((current) => ({ ...current, pending: false, error: normalizedError(error) }));
      throw error;
    }
  }, [client, kind, state.flow]);
  const cancel = useCallback(async () => {
    if (!state.flow) throw new Error(`Identity ${kind} flow has not been started.`);
    const flow = await client.cancelFlow(state.flow.id);
    setState({ flow, pending: false });
    return flow;
  }, [client, kind, state.flow]);
  const reset = useCallback(() => setState({ pending: false }), []);
  return useMemo(() => ({ ...state, begin, transition, cancel, reset }), [begin, cancel, reset, state, transition]);
}

export interface ApplicationOAuthConsentState extends ApplicationIdentityResourceState<ApplicationOAuthConsentView> {
  readonly decide: (decision: 'approve' | 'deny') => Promise<{ readonly continuationUri: string }>;
}

export function useApplicationOAuthConsent(consentId: string): ApplicationOAuthConsentState {
  const client = useApplicationIdentityClient();
  const resource = useIdentityResource(() => client.consent(consentId), [client, consentId]);
  const decide = useCallback(
    (decision: 'approve' | 'deny') => client.decideConsent(consentId, decision),
    [client, consentId],
  );
  return useMemo(() => ({ ...resource.state, decide }), [decide, resource.state]);
}

export interface ApplicationOAuthClientsState extends ApplicationIdentityResourceState<readonly ApplicationOAuthClientView[]> {
  readonly create: (input: {
    readonly name: string;
    readonly type: ApplicationOAuthClientView['type'];
    readonly redirectUris: readonly string[];
    readonly allowedScopes: readonly string[];
  }) => Promise<ApplicationOAuthClientCredential>;
  readonly rotate: (clientId: string) => Promise<ApplicationOAuthClientCredential>;
  readonly revoke: (clientId: string) => Promise<ApplicationOAuthClientView>;
}

export function useApplicationOAuthClients(): ApplicationOAuthClientsState {
  const client = useApplicationIdentityClient();
  const resource = useIdentityResource(() => client.clients(), [client]);
  const create = useCallback(async (input: Parameters<ApplicationIdentityClient['createClient']>[0]) => {
    const credential = await client.createClient(input);
    await resource.refresh();
    return credential;
  }, [client, resource]);
  const rotate = useCallback(
    (clientId: string) => client.rotateClient(clientId),
    [client],
  );
  const revoke = useCallback(async (clientId: string) => {
    const revoked = await client.revokeClient(clientId);
    resource.replace((resource.state.data ?? []).map((candidate) =>
      candidate.id === revoked.id ? revoked : candidate));
    return revoked;
  }, [client, resource]);
  return useMemo(
    () => ({ ...resource.state, create, rotate, revoke }),
    [create, resource.state, revoke, rotate],
  );
}

function useIdentityResource<T>(
  load: () => Promise<T>,
  dependencies: readonly unknown[],
): {
  readonly state: ApplicationIdentityResourceState<T>;
  readonly replace: (value: T) => void;
  readonly refresh: () => Promise<T>;
} {
  const active = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<{
    readonly phase: ApplicationIdentityResourceState<T>['phase'];
    readonly data?: T;
    readonly error?: Error;
  }>({ phase: 'loading' });
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((current) => ({
      ...(current.data !== undefined ? { data: current.data } : {}),
      phase: 'loading',
    }));
    try {
      const value = await load();
      if (!controller.signal.aborted) setState({ phase: 'ready', data: value });
      return value;
    } catch (error) {
      if (!controller.signal.aborted) setState({ phase: 'error', error: normalizedError(error) });
      throw error;
    }
  // The caller supplies the exact semantic dependencies for its stable loader closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => {
    void refresh().catch(() => undefined);
    return () => active.current?.abort();
  }, [refresh]);
  const replace = useCallback((value: T) => setState({ phase: 'ready', data: value }), []);
  const exposed = useMemo<ApplicationIdentityResourceState<T>>(
    () => ({ ...state, refresh }),
    [refresh, state],
  );
  return useMemo(() => ({ state: exposed, replace, refresh }), [exposed, refresh, replace]);
}

function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new Error('The identity request failed.');
}
