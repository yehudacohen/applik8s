import type { ApplicationCommandClient, ApplicationCommandHandle, ApplicationCommandState, ApplicationQueryClient, ApplicationQueryExternalStore, ApplicationQueryState } from '@applik8s/client';
import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

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
