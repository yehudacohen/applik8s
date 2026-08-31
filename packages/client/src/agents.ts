export interface ApplicationAgentClientContract {
  readonly name: string;
  readonly key: string;
}

export interface ApplicationAgentClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ApplicationAgentInvocationOptions {
  readonly idempotencyKey?: string;
}

export interface ApplicationAgentInvocationRuntime {
  invoke<TInput extends object, TResult>(request: {
    readonly agent: string;
    readonly input: TInput;
    readonly key: string;
    readonly idempotencyKey?: string;
  }): Promise<TResult>;
}

const runtimeResolversKey = Symbol.for('@applik8s/client/agent-invocation-runtime-resolvers');
type AgentRuntimeResolver = () => ApplicationAgentInvocationRuntime | undefined;

function runtimeResolvers(): AgentRuntimeResolver[] {
  // typecast: augment the shared global object with the symbol-keyed resolver registry.
  const state = globalThis as typeof globalThis & { [runtimeResolversKey]?: AgentRuntimeResolver[] };
  const existing = state[runtimeResolversKey];
  if (existing) return existing;
  const resolvers: AgentRuntimeResolver[] = [];
  state[runtimeResolversKey] = resolvers;
  return resolvers;
}

export function installApplicationAgentInvocationRuntimeResolver(
  resolver: AgentRuntimeResolver,
): () => void {
  const resolvers = runtimeResolvers();
  resolvers.push(resolver);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = resolvers.lastIndexOf(resolver);
    if (index >= 0) resolvers.splice(index, 1);
  };
}

export async function invokeApplicationAgent<TInput extends object, TResult>(request: {
  readonly agent: string;
  readonly input: TInput;
  readonly key: string;
  readonly idempotencyKey?: string;
}): Promise<TResult> {
  const resolvers = runtimeResolvers();
  for (let index = resolvers.length - 1; index >= 0; index -= 1) {
    const runtime = resolvers[index]?.();
    if (runtime) return runtime.invoke<TInput, TResult>(request);
  }
  if (typeof window !== 'undefined') return requestApplicationAgent<TInput, TResult>(request, {});
  throw new Error(
    `Application agent ${request.agent} has no active invocation runtime. `
    + 'Call it in a browser, an authenticated server request, or an Applik8s-managed closure.',
  );
}

export function createApplicationAgentHttpRuntime(
  options: ApplicationAgentClientOptions = {},
): ApplicationAgentInvocationRuntime {
  return Object.freeze({
    invoke<TInput extends object, TResult>(request: {
      readonly agent: string;
      readonly input: TInput;
      readonly key: string;
      readonly idempotencyKey?: string;
    }) {
      return requestApplicationAgent<TInput, TResult>(request, options);
    },
  });
}

/** Browser/server facade for one function-native application agent. */
export function createApplicationAgentClient<TInput extends object, TResult>(
  contract: ApplicationAgentClientContract,
  options: ApplicationAgentClientOptions = {},
): (input: TInput, invocation?: ApplicationAgentInvocationOptions) => Promise<TResult> {
  const name = required(contract.name, 'agent name');
  const keyField = required(contract.key, 'agent key field');
  return async (input, invocation = {}) => {
    const key = Reflect.get(input, keyField);
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error(`Application agent ${name} input field ${keyField} must be a non-empty string.`);
    }
    return requestApplicationAgent<TInput, TResult>({
      agent: name,
      input,
      key: key.trim(),
      ...(invocation.idempotencyKey ? { idempotencyKey: invocation.idempotencyKey } : {}),
    }, options);
  };
}

async function requestApplicationAgent<TInput extends object, TResult>(
  invocation: {
    readonly agent: string;
    readonly input: TInput;
    readonly key: string;
    readonly idempotencyKey?: string;
  },
  options: ApplicationAgentClientOptions,
): Promise<TResult> {
  const request = options.fetch ?? globalThis.fetch;
  const idempotencyKey = invocation.idempotencyKey?.trim();
  const runId = idempotencyKey || randomId('agent-run');
  const endpoint = new URL('/__applik8s/v1/ai/chat', options.baseUrl ?? browserBaseUrl());
  const response = await request(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      threadId: invocation.key,
      runId,
      input: invocation.input,
      messages: [],
      forwardedProps: { applik8s: { agent: invocation.agent } },
    }),
  });
  const envelope: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = envelope && typeof envelope === 'object'
      ? Reflect.get(envelope, 'message') ?? Reflect.get(envelope, 'error')
      : undefined;
    throw new Error(
      `Application agent ${invocation.agent} failed with HTTP ${response.status}${typeof message === 'string' ? `: ${message}` : ''}.`,
    );
  }
  if (!envelope || typeof envelope !== 'object' || !Reflect.has(envelope, 'result')) {
    throw new Error(`Application agent ${invocation.agent} returned an invalid result envelope.`);
  }
  // typecast: the HTTP envelope was validated above; TResult is supplied by the typed agent facade.
  return Reflect.get(envelope, 'result') as TResult;
}

function browserBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  throw new Error('Application agent client requires baseUrl outside a browser.');
}

function randomId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}:${id}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Application ${label} must not be empty.`);
  return normalized;
}
