import {
  type ConnectConnectionAdapter,
  type FetchConnectionOptions,
  fetchServerSentEvents,
} from '@tanstack/ai-client';

export interface ApplicationTanStackConnectionOptions
  extends Omit<FetchConnectionOptions, 'body'> {
  readonly endpoint?: string;
  /** The same typed application.agent(...) handle exported by the application entrypoint. */
  readonly agent?: ApplicationTanStackAgentReference;
}

export interface ApplicationTanStackAgentReference {
  readonly kind: 'applicationAgent';
  readonly name: string;
}

/**
 * Use TanStack's AG-UI/SSE transport unchanged while enforcing the canonical
 * Conversation/thread and protocol-run identity boundary.
 */
export function createApplicationTanStackConnection(
  options: ApplicationTanStackConnectionOptions = {},
): ConnectConnectionAdapter {
  const agent = options.agent;
  const baseEndpoint = options.endpoint ?? '/__applik8s/v1/ai/chat';
  const endpoint = agent
    ? withQueryParameter(baseEndpoint, 'agent', agent.name)
    : baseEndpoint;
  if (!endpoint.trim()) throw new Error('TanStack AI connection endpoint must be non-empty.');
  if (agent && (agent.kind !== 'applicationAgent' || !agent.name.trim())) {
    throw new Error(
      'TanStack AI connection agent must be an application.agent(...) handle.',
    );
  }
  const upstream = fetchServerSentEvents(endpoint, {
    ...(options.headers ? { headers: options.headers } : {}),
    credentials: options.credentials ?? 'same-origin',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetchClient ? { fetchClient: options.fetchClient } : {}),
    ...(agent ? { body: { applik8s: { agent: agent.name } } } : {}),
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
    ...(upstream.hydrate ? { hydrate: upstream.hydrate } : {}),
  };
}

function withQueryParameter(endpoint: string, name: string, value: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}
