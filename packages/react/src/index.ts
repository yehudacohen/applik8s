import type { ApplicationCommandHandle, ApplicationCommandState, ApplicationMutationHookOptions, ApplicationMutationState, ApplicationOperationContract, ApplicationQueryExternalStore, ApplicationQueryOperationState, ApplicationQuerySnapshot, ApplicationQueryState, ApplicationQuerySuspenseResult } from '@applik8s/client';
import { ApplicationCommandClient, ApplicationQueryClient, createHttpApplicationCommandTransport, createHttpApplicationQueryTransport, createHttpApplicationRuntimeTransport, installApplicationMutationHook, installApplicationOperationRuntime, installApplicationQueryHook, queryInputKey, waitForApplicationCommand } from '@applik8s/client';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const ApplicationQueryClientContext = createContext<ApplicationQueryClient | undefined>(undefined);
const ApplicationCommandClientContext = createContext<ApplicationCommandClient | undefined>(undefined);

export interface ApplicationQueryClientProviderProps {
  readonly client: ApplicationQueryClient;
  readonly children?: ReactNode;
}

/** Supplies one browser-safe query client without coupling components to a router. */
export function ApplicationQueryClientProvider(props: ApplicationQueryClientProviderProps): ReactNode {
  return createElement(ApplicationQueryClientContext.Provider, { value: props.client }, props.children);
}

export function useApplicationQueryClient(): ApplicationQueryClient {
  const client = useContext(ApplicationQueryClientContext);
  if (!client) throw new Error('useApplicationQueryClient requires an ApplicationQueryClientProvider.');
  return client;
}

export interface ApplicationQueryHydrationBoundaryProps {
  readonly snapshots: readonly ApplicationQuerySnapshot[];
  readonly children?: ReactNode;
}

/** Hydrates loader snapshots once before descendants subscribe to their query stores. */
export function ApplicationQueryHydrationBoundary(props: ApplicationQueryHydrationBoundaryProps): ReactNode {
  const client = useApplicationQueryClient();
  const [initialSnapshots] = useState(() => {
    client.hydrate(props.snapshots);
    return props.snapshots;
  });
  useEffect(() => {
    if (props.snapshots !== initialSnapshots) client.hydrate(props.snapshots);
  }, [client, initialSnapshots, props.snapshots]);
  return props.children;
}

/** Reads a cached immutable query snapshot and starts or resumes delivery when React subscribes. */
export function useApplicationQuery<TInput, TValue>(query: string, input: TInput): ApplicationQueryState<TValue> {
  const client = useApplicationQueryClient();
  const canonical = useCanonicalQueryInput(input);
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(() => client.query<TInput, TValue>(query, canonical.input), [canonical, client, query]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useApplicationQueryOperation<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
): ApplicationQueryOperationState<TValue> {
  const client = useApplicationQueryClient();
  const canonical = useCanonicalQueryInput(input);
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, canonical.input),
    [canonical, client, operation.id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    phase: state.phase,
    data: state.value,
    error: state.error,
    stale: state.stale,
    revision: state.revision,
    refresh: store.refresh,
  };
}

export function useApplicationSuspenseQueryOperation<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
): ApplicationQuerySuspenseResult<TValue> {
  const client = useApplicationQueryClient();
  const canonical = useCanonicalQueryInput(input);
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, canonical.input),
    [canonical, client, operation.id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (state.error) throw state.error;
  if (state.value === undefined || state.phase === 'idle' || state.phase === 'loading') throw store.refresh();
  return { data: state.value, stale: state.stale, revision: state.revision, refresh: store.refresh };
}

function useCanonicalQueryInput<TInput>(input: TInput): { readonly key: string; readonly input: TInput } {
  const key = queryInputKey(input);
  const canonical = useRef({ key, input });
  if (canonical.current.key !== key) canonical.current = { key, input };
  return canonical.current;
}

function useApplicationQueryOperationAdapter<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
  suspense: boolean,
): ApplicationQueryOperationState<TValue> | ApplicationQuerySuspenseResult<TValue> {
  const client = useApplicationQueryClient();
  const canonical = useCanonicalQueryInput(input);
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, canonical.input),
    [canonical, client, operation.id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (suspense) {
    if (state.error) throw state.error;
    if (state.value === undefined || state.phase === 'idle' || state.phase === 'loading') throw store.refresh();
    return { data: state.value, stale: state.stale, revision: state.revision, refresh: store.refresh };
  }
  return {
    phase: state.phase,
    data: state.value,
    error: state.error,
    stale: state.stale,
    revision: state.revision,
    refresh: store.refresh,
  };
}

export interface ApplicationCommandClientProviderProps {
  readonly client: ApplicationCommandClient;
  readonly children?: ReactNode;
}

export interface Applik8sProviderProps {
  readonly children?: ReactNode;
  readonly baseUrl?: string;
  readonly dehydrated?: readonly ApplicationQuerySnapshot[];
  readonly queryClient?: ApplicationQueryClient;
  readonly commandClient?: ApplicationCommandClient;
}

/**
 * Installs same-origin browser query and command clients for generated model facades.
 * The provider is router-independent and can be used by any React application.
 */
export function Applik8sProvider(props: Applik8sProviderProps): ReactNode {
  const baseUrl = props.baseUrl ?? '/__applik8s/v1';
  const clients = useMemo(() => {
    const queryClient = props.queryClient ?? new ApplicationQueryClient(createHttpApplicationQueryTransport({ baseUrl }));
    return {
      queryClient,
      commandClient: props.commandClient ?? new ApplicationCommandClient(createHttpApplicationCommandTransport({ baseUrl })),
      runtimeClient: createHttpApplicationRuntimeTransport({ baseUrl }),
    };
  }, [baseUrl, props.commandClient, props.queryClient]);
  const hydration = useRef<{ readonly queryClient: ApplicationQueryClient; readonly snapshots: readonly ApplicationQuerySnapshot[] } | undefined>(undefined);
  if (props.dehydrated && (hydration.current?.queryClient !== clients.queryClient || hydration.current.snapshots !== props.dehydrated)) {
    clients.queryClient.hydrate(props.dehydrated);
    hydration.current = { queryClient: clients.queryClient, snapshots: props.dehydrated };
  }
  useEffect(() => installApplicationOperationRuntime({
    execute(operation, input) {
      if (operation.transport === 'command') return clients.commandClient.execute(operation.id, input);
      if (operation.transport === 'runtime') return clients.runtimeClient.execute(operation, input);
      throw new Error(`Direct browser operation ${operation.id} uses unsupported ${operation.transport} mutation transport.`);
    },
    async snapshotQuery<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
      if (operation.transport !== 'query') {
        throw new Error(`Direct browser preload ${operation.id} uses unsupported ${operation.transport} transport.`);
      }
      const snapshot = await clients.queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
      clients.queryClient.hydrate([snapshot]);
      return snapshot;
    },
  }), [clients]);
  return createElement(
    ApplicationQueryClientProvider,
    { client: clients.queryClient },
    createElement(ApplicationCommandClientProvider, { client: clients.commandClient }, props.children),
  );
}

export function ApplicationCommandClientProvider(props: ApplicationCommandClientProviderProps): ReactNode {
  return createElement(ApplicationCommandClientContext.Provider, { value: props.client }, props.children);
}

export function useApplicationCommandClient(): ApplicationCommandClient {
  const client = useContext(ApplicationCommandClientContext);
  if (!client) throw new Error('useApplicationCommandClient requires an ApplicationCommandClientProvider.');
  return client;
}

/** Observes one submitted command while preserving each backend progress dimension verbatim. */
export function useApplicationCommand<TOutput>(handle: ApplicationCommandHandle<TOutput>): ApplicationCommandState<TOutput> {
  return useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot);
}

export type ApplicationMutationObservation<TOutput = unknown> =
  | { readonly state: 'notDeclared' }
  | { readonly state: 'pending'; readonly identity?: unknown }
  | { readonly state: 'matched'; readonly snapshot?: TOutput }
  | { readonly state: 'failed'; readonly error: Error };

export type ApplicationMutation<TInput, TOutput> = ApplicationMutationState<TInput, TOutput>;
export type ApplicationMutationOptions<TInput> = ApplicationMutationHookOptions<TInput>;

/** Returns an awaitable callable while preserving transport and durable-result state independently. */
export function useApplicationMutation<TInput, TOutput>(
  command: string,
  options: ApplicationMutationOptions<TInput> = {},
): ApplicationMutation<TInput, TOutput> {
  const client = useApplicationCommandClient();
  const [handle, setHandle] = useState<ApplicationCommandHandle<TOutput> | undefined>(undefined);
  const [submission, setSubmission] = useState<{ readonly active: boolean; readonly at?: number }>({ active: false });
  const idle = useMemo(() => idleCommandState<TOutput>(command), [command]);
  const state = useSyncExternalStore(
    handle ? handle.subscribe : noSubscription,
    handle ? handle.getSnapshot : () => idle,
    handle ? handle.getSnapshot : () => idle,
  );
  const invoke = useCallback(async (input: TInput): Promise<TOutput> => {
    handle?.dispose();
    const submittedAt = Date.now();
    setSubmission({ active: true, at: submittedAt });
    const expectedRevision = options.expectedRevision?.(input);
    try {
      const next = await client.submit<TInput, TOutput>(command, input, {
        ...(options.commandId ? { commandId: options.commandId() } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey(input) } : {}),
        ...(expectedRevision ? { expectedRevision } : {}),
      });
      setHandle(next);
      return await waitForApplicationCommand(next);
    } finally {
      setSubmission((current) => current.at === submittedAt ? { ...current, active: false } : current);
    }
  }, [client, command, handle, options]);
  const reset = useCallback(() => {
    handle?.dispose();
    setHandle(undefined);
    setSubmission({ active: false });
  }, [handle]);
  return useMemo(() => Object.assign(invoke, {
    pending: submission.active || state.phase === 'submitting' || state.phase === 'pending',
    paused: state.durableResult === 'unknown' && state.transport === 'acknowledged',
    data: state.output,
    error: state.error,
    submittedAt: submission.at,
    // typecast: the active local submission branch is the literal transport state exposed by the mutation contract.
    transport: submission.active ? 'submitting' as const : state.transport,
    durableResult: state.durableResult,
    observation: commandObservation(state),
    reset,
  }), [invoke, reset, state, submission]);
}

const reactHookDisposerKey = Symbol.for('@applik8s/react/operation-hook-disposer');

/** Installs the React operation adapters and returns an HMR-safe disposer. */
export function installApplik8sReactOperationHooks(): () => void {
  // typecast: this global symbol slot is private to this package and stores only its HMR disposer.
  const previous = Reflect.get(globalThis, reactHookDisposerKey) as (() => void) | undefined;
  previous?.();
  const disposeMutation = installApplicationMutationHook(<TInput, TOutput>(
    operation: ApplicationOperationContract,
    options?: ApplicationMutationOptions<TInput>,
  ) => useApplicationMutation<TInput, TOutput>(operation.id, options));
  const disposeQuery = installApplicationQueryHook(<TInput, TValue>(
    operation: ApplicationOperationContract,
    input: TInput,
    suspense: boolean,
  ) => useApplicationQueryOperationAdapter<TInput, TValue>(operation, input, suspense));
  const dispose = () => {
    disposeQuery();
    disposeMutation();
    if (Reflect.get(globalThis, reactHookDisposerKey) === dispose) Reflect.deleteProperty(globalThis, reactHookDisposerKey);
  };
  Reflect.set(globalThis, reactHookDisposerKey, dispose);
  return dispose;
}

installApplik8sReactOperationHooks();

function commandObservation<TOutput>(state: ApplicationCommandState<TOutput>): ApplicationMutationObservation<TOutput> {
  if (state.reconciliation === 'progressing') return { state: 'pending' };
  if (state.reconciliation === 'ready') return { state: 'matched', ...(state.output !== undefined ? { snapshot: state.output } : {}) };
  if (state.reconciliation === 'failed') return { state: 'failed', error: state.error ?? new Error(`Application command ${state.command} reported failed reconciliation.`) };
  return { state: 'notDeclared' };
}

function idleCommandState<TOutput>(command: string): ApplicationCommandState<TOutput> {
  return {
    protocol: 'applik8s.command/v1alpha1',
    command,
    commandId: '',
    correlationId: '',
    phase: 'unknown',
    transport: 'idle',
    durableResult: 'unknown',
    workflow: 'notStarted',
    reconciliation: 'notObserved',
    revision: 0,
  };
}

function noSubscription(): () => void {
  return () => undefined;
}
