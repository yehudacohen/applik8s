// typecast-file-boundary: untrusted signal JSON is structurally validated before contract-derived browser capabilities are hydrated.
import {
  createApplicationRuntimeOperation,
  type ApplicationOperationLike,
} from './operations.js';

export interface ApplicationClientSignalReference {
  readonly $type: 'applik8s.signal/v1';
  readonly contract: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly issuance: { readonly id: string };
  readonly expiresAt: string;
}

export interface ApplicationClientSignalContract {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly actions: readonly string[];
  readonly subscription: string;
}

export interface ApplicationClientSignalSubscriptionOptions {
  readonly after?: string;
  readonly signal?: AbortSignal;
  readonly endpoint?: string;
  readonly fetch?: ApplicationClientSignalFetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

export type ApplicationClientSignalFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ApplicationClientSignalActionOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface ApplicationClientSignalActionResult {
  readonly status: 'resolved' | 'alreadyResolved';
  readonly outcome: unknown;
  readonly receipt?: { readonly id: string };
}

export type ApplicationClientSignal = ApplicationClientSignalReference &
  Readonly<Record<
    string,
    (
      input: object,
      options?: ApplicationClientSignalActionOptions,
    ) => Promise<ApplicationClientSignalActionResult>
  >>;

export interface ApplicationClientSignalIssuance {
  readonly id: string;
  readonly input: object;
  readonly signal: ApplicationClientSignal;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ApplicationClientSignalSubscription
  extends AsyncIterable<ApplicationClientSignalIssuance> {
  replay(options?: {
    readonly after?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly items: readonly ApplicationClientSignalIssuance[];
    readonly cursor: string;
    readonly exhausted: boolean;
  }>;
}

export interface ApplicationClientSignalOperation {
  readonly signalKind: 'applicationSignal';
  readonly signal: {
    readonly kind: 'applicationSignalDefinition';
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly actions: Readonly<Record<string, unknown>>;
  };
  /** Browser/server facade parity for static role and identity authority declarations. */
  readonly read: ApplicationOperationLike;
  subscribe(
    options?: ApplicationClientSignalSubscriptionOptions,
  ): ApplicationClientSignalSubscription;
}

/**
 * Browser-safe half of the signal dual-runtime illusion.
 *
 * Generated facades call this function; application code continues to import
 * its authored signal contract and never sees stream or action route details.
 */
export function createApplicationSignalOperation(
  contract: ApplicationClientSignalContract,
): ApplicationClientSignalOperation {
  assertSignalContract(contract);
  const definition = Object.freeze({
    kind: 'applicationSignalDefinition' as const,
    id: contract.id,
    name: contract.name,
    version: contract.version,
    actions: Object.freeze(
      Object.fromEntries(contract.actions.map((action) => [action, true])),
    ),
  });
  const read = createSignalAuthorityFacet(contract, 'issuance.read');
  const authorityFacets = Object.fromEntries(
    contract.actions.map((action) => [
      action,
      createSignalAuthorityFacet(contract, action),
    ] as const),
  );
  return Object.freeze({
    read,
    ...authorityFacets,
    signalKind: 'applicationSignal' as const,
    signal: definition,
    subscribe(options: ApplicationClientSignalSubscriptionOptions = {}) {
      return createSignalSubscription(contract, options);
    },
  });
}

function createSignalAuthorityFacet(
  contract: ApplicationClientSignalContract,
  operation: string,
): ApplicationOperationLike {
  return createApplicationRuntimeOperation({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: signalOperationId(contract.id, operation),
    model: contract.id,
    name: operation,
    operation: 'custom',
    transport: 'runtime',
    version: contract.version,
    authority: {
      classification: 'runtime-grantable',
      permissionIds: [],
      grantable: true,
      delegable: false,
      scope: { kind: 'all' },
      transports: ['direct', 'http', 'event'],
    },
  });
}

function signalOperationId(contractId: string, operation: string): string {
  for (const [name, value] of Object.entries({
    contract: contractId,
    operation,
  })) {
    if (!value.trim() || /[\s?#]/.test(value)) {
      throw new Error(
        `Application signal ${name} must be a non-empty stable URI path segment.`,
      );
    }
  }
  return `applik8s://signals/${contractId}/operations/${operation}`;
}

function createSignalSubscription(
  contract: ApplicationClientSignalContract,
  options: ApplicationClientSignalSubscriptionOptions,
): ApplicationClientSignalSubscription {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('Application signal subscription requires fetch.');
  }
  const replay = async (
    replayOptions: {
      readonly after?: string;
      readonly limit?: number;
      readonly signal?: AbortSignal;
    } = {},
  ) => {
    const response = await signalFetch(
      fetchImplementation,
      options,
      streamUrl(options.endpoint, contract.subscription, 'replay'),
      {
        cursor: replayOptions.after ?? options.after,
        ...(replayOptions.limit === undefined
          ? {}
          : { limit: replayOptions.limit }),
      },
      replayOptions.signal ?? options.signal,
    );
    const payload = await responseJson(response);
    if (!response.ok) {
      throw new Error(
        `Application signal ${contract.id} replay failed with HTTP ${response.status}.`,
      );
    }
    if (
      payload.kind !== 'replay'
      || !Array.isArray(payload.items)
      || typeof payload.cursor !== 'string'
      || typeof payload.exhausted !== 'boolean'
    ) {
      throw new Error(`Application signal ${contract.id} returned an invalid replay envelope.`);
    }
    return {
      items: payload.items.map((item) => hydrateSignalEnvelope(contract, item, options)),
      cursor: payload.cursor,
      exhausted: payload.exhausted,
    };
  };
  return Object.freeze({
    replay,
    async *[Symbol.asyncIterator]() {
      let cursor = options.after;
      while (!options.signal?.aborted) {
        const response = await signalFetch(
          fetchImplementation,
          options,
          streamUrl(options.endpoint, contract.subscription, 'subscribe'),
          { cursor },
          options.signal,
        );
        if (!response.ok || !response.body) {
          throw new Error(
            `Application signal ${contract.id} subscription failed with HTTP ${response.status}.`,
          );
        }
        let observedFrame = false;
        for await (const frame of sseFrames(response.body, options.signal)) {
          if (frame.event === 'keepalive') {
            const keepalive = parsedRecord(frame.data, `${contract.id} keepalive`);
            if (typeof keepalive.cursor === 'string') cursor = keepalive.cursor;
            continue;
          }
          if (frame.event === 'reset') {
            throw new Error(`Application signal ${contract.id} subscription requires reset.`);
          }
          if (frame.event !== 'events') continue;
          const events = parsedRecord(frame.data, `${contract.id} events`);
          if (!Array.isArray(events.items) || typeof events.cursor !== 'string') {
            throw new Error(`Application signal ${contract.id} returned an invalid SSE envelope.`);
          }
          observedFrame = true;
          cursor = events.cursor;
          for (const item of events.items) {
            yield hydrateSignalEnvelope(contract, item, options);
          }
        }
        if (options.signal?.aborted) return;
        if (!observedFrame) {
          await abortableDelay(250, options.signal);
        }
      }
    },
  });
}

function hydrateSignalEnvelope(
  contract: ApplicationClientSignalContract,
  value: unknown,
  options: ApplicationClientSignalSubscriptionOptions,
): ApplicationClientSignalIssuance {
  const envelope = record(value, `${contract.id} stream envelope`);
  const issuance = record(envelope.payload, `${contract.id} issuance`);
  const reference = record(issuance.signal, `${contract.id} signal`);
  const contractIdentity = record(reference.contract, `${contract.id} contract`);
  const issuanceIdentity = record(reference.issuance, `${contract.id} identity`);
  if (
    reference.$type !== 'applik8s.signal/v1'
    || contractIdentity.id !== contract.id
    || contractIdentity.name !== contract.name
    || contractIdentity.version !== contract.version
    || typeof issuanceIdentity.id !== 'string'
    || !issuanceIdentity.id
    || typeof reference.expiresAt !== 'string'
    || typeof issuance.id !== 'string'
    || typeof issuance.issuedAt !== 'string'
    || typeof issuance.expiresAt !== 'string'
  ) {
    throw new Error(`Application signal ${contract.id} returned an invalid issuance.`);
  }
  const signalReference = Object.freeze({
    $type: 'applik8s.signal/v1' as const,
    contract: Object.freeze({
      id: contract.id,
      name: contract.name,
      version: contract.version,
    }),
    issuance: Object.freeze({ id: issuanceIdentity.id }),
    expiresAt: reference.expiresAt,
  });
  const actions = Object.fromEntries(contract.actions.map((action) => [
    action,
    async (
      input: object,
      actionOptions: ApplicationClientSignalActionOptions = {},
    ) => {
      const response = await signalFetch(
        options.fetch ?? globalThis.fetch,
        options,
        signalActionUrl(
          options.endpoint,
          contract.id,
          issuanceIdentity.id as string,
          action,
        ),
        {
          input,
          ...(actionOptions.idempotencyKey
            ? { idempotencyKey: actionOptions.idempotencyKey }
            : {}),
        },
        actionOptions.signal ?? options.signal,
      );
      const payload = await responseJson(response);
      if (!response.ok) {
        throw new Error(
          `Application signal ${contract.id}.${action} failed with HTTP ${response.status}.`,
        );
      }
      return payload as unknown as ApplicationClientSignalActionResult;
    },
  ]));
  const signal = Object.freeze({
    ...signalReference,
    ...actions,
  }) as ApplicationClientSignal;
  return Object.freeze({
    id: issuance.id,
    input: record(issuance.input, `${contract.id} input`),
    signal,
    issuedAt: issuance.issuedAt,
    expiresAt: issuance.expiresAt,
  });
}

async function signalFetch(
  fetchImplementation: ApplicationClientSignalFetch,
  options: ApplicationClientSignalSubscriptionOptions,
  url: string,
  body: object,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const headers = new Headers(
    typeof options.headers === 'function'
      ? await options.headers()
      : options.headers,
  );
  headers.set('content-type', 'application/json');
  return fetchImplementation(url, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return parsedRecord(await response.text(), 'application signal response');
}

function parsedRecord(value: string, owner: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value), owner);
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error(`${owner} is not valid JSON.`);
    throw cause;
  }
}

function record(value: unknown, owner: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${owner} must be an object.`);
  }
  return value as Record<string, unknown>;
}

async function* sseFrames(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<{ readonly event: string; readonly data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal?.aborted) {
      const next = await reader.read();
      if (next.done) return;
      pending += decoder.decode(next.value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';
      for (const raw of frames) {
        let event = 'message';
        const data: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function streamUrl(
  endpoint: string | undefined,
  subscription: string,
  operation: 'replay' | 'subscribe',
): string {
  const path = `/__applik8s/v1/streams/${encodeURIComponent(subscription)}/${operation}`;
  return endpoint ? new URL(path, endpoint).toString() : path;
}

function signalActionUrl(
  endpoint: string | undefined,
  contract: string,
  issuance: string,
  action: string,
): string {
  const path = `/__applik8s/v1/signals/${encodeURIComponent(contract)}/${encodeURIComponent(issuance)}/actions/${encodeURIComponent(action)}`;
  return endpoint ? new URL(path, endpoint).toString() : path;
}

function assertSignalContract(contract: ApplicationClientSignalContract): void {
  if (
    !contract.id
    || !contract.name
    || !contract.version
    || !contract.subscription
    || contract.actions.length === 0
    || new Set(contract.actions).size !== contract.actions.length
  ) {
    throw new Error('Application signal facade contract is incomplete.');
  }
}

async function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, ms);
    const abort = () => done();
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
