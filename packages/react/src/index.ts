import type { ApplicationCommandClient, ApplicationCommandHandle, ApplicationCommandState, ApplicationMutationHookOptions, ApplicationMutationState, ApplicationOperationContract, ApplicationQueryClient, ApplicationQueryExternalStore, ApplicationQueryOperationState, ApplicationQueryState, ApplicationQuerySuspenseResult } from '@applik8s/client';
import { installApplicationMutationHook, installApplicationQueryHook, waitForApplicationCommand } from '@applik8s/client';
import { createContext, createElement, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

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

/** Reads a cached immutable query snapshot and starts or resumes delivery when React subscribes. */
export function useApplicationQuery<TInput, TValue>(query: string, input: TInput): ApplicationQueryState<TValue> {
  const client = useApplicationQueryClient();
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(() => client.query<TInput, TValue>(query, input), [client, query, input]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useApplicationQueryOperation<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
): ApplicationQueryOperationState<TValue> {
  const client = useApplicationQueryClient();
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, input),
    [client, operation.id, input],
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
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, input),
    [client, operation.id, input],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (state.error) throw state.error;
  if (state.value === undefined || state.phase === 'idle' || state.phase === 'loading') throw store.refresh();
  return { data: state.value, stale: state.stale, revision: state.revision, refresh: store.refresh };
}

function useApplicationQueryOperationAdapter<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
  suspense: boolean,
): ApplicationQueryOperationState<TValue> | ApplicationQuerySuspenseResult<TValue> {
  const client = useApplicationQueryClient();
  const store = useMemo<ApplicationQueryExternalStore<TValue>>(
    () => client.query<TInput, TValue>(operation.id, input),
    [client, operation.id, input],
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
  const idle = useMemo(() => idleCommandState<TOutput>(command), [command]);
  const state = useSyncExternalStore(
    handle ? handle.subscribe : noSubscription,
    handle ? handle.getSnapshot : () => idle,
    handle ? handle.getSnapshot : () => idle,
  );
  const invoke = useCallback(async (input: TInput): Promise<TOutput> => {
    handle?.dispose();
    const expectedRevision = options.expectedRevision?.(input);
    const next = await client.submit<TInput, TOutput>(command, input, {
      ...(options.commandId ? { commandId: options.commandId() } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey(input) } : {}),
      ...(expectedRevision ? { expectedRevision } : {}),
    });
    setHandle(next);
    return waitForApplicationCommand(next);
  }, [client, command, handle, options]);
  const reset = useCallback(() => {
    handle?.dispose();
    setHandle(undefined);
  }, [handle]);
  return useMemo(() => Object.assign(invoke, {
    pending: state.phase === 'submitting' || state.phase === 'pending',
    paused: state.durableResult === 'unknown' && state.transport === 'acknowledged',
    data: state.output,
    error: state.error,
    submittedAt: undefined,
    transport: state.transport,
    durableResult: state.durableResult,
    observation: commandObservation(state),
    reset,
  }), [invoke, reset, state]);
}

installApplicationMutationHook(<TInput, TOutput>(
  operation: ApplicationOperationContract,
  options?: ApplicationMutationOptions<TInput>,
) => useApplicationMutation<TInput, TOutput>(operation.id, options));

installApplicationQueryHook(<TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
  suspense: boolean,
) => useApplicationQueryOperationAdapter<TInput, TValue>(operation, input, suspense));

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
