import {
  type ConnectConnectionAdapter,
  type FetchConnectionOptions,
  fetchServerSentEvents,
} from '@tanstack/ai-client';

export interface ApplicationTanStackConnectionOptions
  extends Omit<FetchConnectionOptions, 'body'> {
  readonly endpoint?: string;
  readonly forwardedProps?: Readonly<Record<string, unknown>>;
}

/**
 * Use TanStack's AG-UI/SSE transport unchanged while enforcing the canonical
 * Conversation/thread and protocol-run identity boundary.
 */
export function createApplicationTanStackConnection(
  options: ApplicationTanStackConnectionOptions = {},
): ConnectConnectionAdapter {
  const endpoint = options.endpoint ?? '/__applik8s/v1/ai/chat';
  if (!endpoint.trim()) throw new Error('TanStack AI connection endpoint must be non-empty.');
  const upstream = fetchServerSentEvents(endpoint, {
    ...(options.headers ? { headers: options.headers } : {}),
    credentials: options.credentials ?? 'same-origin',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetchClient ? { fetchClient: options.fetchClient } : {}),
    ...(options.forwardedProps ? { body: { applik8s: options.forwardedProps } } : {}),
  });
  return {
    async *connect(messages, data, abortSignal, runContext) {
      if (!runContext?.threadId.trim()) {
        throw new Error('TanStack AI connection requires an explicit Conversation-backed threadId.');
      }
      if (!runContext.runId.trim()) {
        throw new Error('TanStack AI connection requires an explicit protocol runId.');
      }
      yield* upstream.connect(messages, data, abortSignal, runContext);
    },
  };
}
