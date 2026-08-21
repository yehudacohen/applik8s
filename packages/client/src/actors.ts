// typecast-file-boundary: Browser transport payloads are checked before restoration to generated actor types.
/** Browser-safe, provider-neutral actor facade. No provider credential enters this module. */

export type ApplicationActorClientMemberKind =
  | 'command'
  | 'message'
  | 'connectionMessage'
  | 'connection'
  | 'disconnection'
  | 'broadcast';

export interface ApplicationActorClientContract {
  readonly id: string;
  readonly members: readonly {
    readonly name: string;
    readonly kind: ApplicationActorClientMemberKind;
  }[];
}

export interface ApplicationActorClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly createWebSocket?: (url: string) => ApplicationActorClientWebSocket;
  readonly id?: () => string;
}

export interface ApplicationActorClientWebSocket {
  readonly readyState: number;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void;
  send(value: string): void;
  close(code?: number, reason?: string): void;
}

export interface ApplicationActorDeliveryReceipt {
  readonly operationId: string;
  readonly actor: string;
  readonly key: string;
  readonly member: string;
  readonly state: 'committed';
  readonly revision: number;
  readonly replayed: boolean;
}

export interface ApplicationActorClientConnection {
  readonly id: string;
  readonly actor: string;
  readonly key: string;
  readonly state: 'connecting' | 'open' | 'closing' | 'closed';
  readonly on: Readonly<Record<string, (listener: (value: unknown, receipt: unknown) => void) => () => void>>;
  close(input?: object): Promise<void>;
  readonly [member: string]: unknown;
}

interface ActorConnectionAdmission {
  readonly connectionId: string;
  readonly url: string;
}

interface PendingDelivery {
  readonly resolve: (receipt: ApplicationActorDeliveryReceipt) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Reconstructs an exported actor as ordinary typed-looking callable members.
 * The authoring module supplies the static TypeScript type; this implementation
 * supplies the browser transport without importing celld, Kubernetes, or AWS.
 */
export function createApplicationActorClient(
  contract: ApplicationActorClientContract,
  options: ApplicationActorClientOptions = {},
): object {
  assertActorContract(contract);
  const target: Record<string, unknown> = {
    kind: 'applicationActor',
    id: contract.id,
  };
  for (const member of contract.members) {
    if (member.kind === 'command') {
      target[member.name] = async (key: string, input: object, invocation: { readonly idempotencyKey?: string } = {}) => {
        const response = await actorOperationRequest(contract.id, key, member.name, input, invocation.idempotencyKey, options);
        return requiredObject(response.result, `${contract.id}.${member.name} result`);
      };
    } else if (member.kind === 'message') {
      target[member.name] = Object.freeze({
        send: async (key: string, input: object, invocation: { readonly idempotencyKey?: string } = {}) => {
          const response = await actorOperationRequest(contract.id, key, member.name, input, invocation.idempotencyKey, options);
          return requiredObject(response.receipt, `${contract.id}.${member.name} receipt`);
        },
      });
    } else if (member.kind === 'connection') {
      target[member.name] = (key: string, input: object, connectionOptions: {
        readonly disconnect?: { readonly member: string; readonly input: object };
        readonly lease?: string;
      } = {}) => connectApplicationActor(contract, member.name, key, input, connectionOptions, options);
    }
  }
  return Object.freeze(target);
}

async function actorOperationRequest(
  actor: string,
  key: string,
  member: string,
  input: object,
  idempotencyKey: string | undefined,
  options: ApplicationActorClientOptions,
): Promise<Readonly<Record<string, unknown>>> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') throw new Error('Application actor calls require a Fetch implementation.');
  const response = await fetchImplementation(actorUrl(options.baseUrl, actor, key, `operations/${encodeURIComponent(member)}`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw actorClientError(body, response.status, `${actor}.${member}`);
  return requiredObject(body, `${actor}.${member} response`);
}

async function connectApplicationActor(
  contract: ApplicationActorClientContract,
  connectMember: string,
  key: string,
  input: object,
  connectionOptions: {
    readonly disconnect?: { readonly member: string; readonly input: object };
    readonly lease?: string;
  },
  options: ApplicationActorClientOptions,
): Promise<ApplicationActorClientConnection> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') throw new Error('Application actor connections require a Fetch implementation.');
  const disconnectMembers = contract.members.filter(({ kind }) => kind === 'disconnection');
  const selectedDisconnect = connectionOptions.disconnect ?? (
    disconnectMembers.length === 1
      ? { member: disconnectMembers[0]?.name ?? '', input: {} }
      : undefined
  );
  if (!selectedDisconnect || !disconnectMembers.some(({ name }) => name === selectedDisconnect.member)) {
    throw new Error(`Actor ${contract.id}.${connectMember} requires one declared disconnection member.`);
  }
  const admissionResponse = await fetchImplementation(actorUrl(options.baseUrl, contract.id, key, 'connections'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      member: connectMember,
      input,
      disconnect: selectedDisconnect,
      ...(connectionOptions.lease ? { lease: connectionOptions.lease } : {}),
    }),
  });
  const admissionBody = await admissionResponse.json().catch(() => undefined);
  if (!admissionResponse.ok) throw actorClientError(admissionBody, admissionResponse.status, `${contract.id}.${connectMember}`);
  const admission = actorConnectionAdmission(admissionBody);
  const createSocket = options.createWebSocket ?? defaultWebSocket;
  const socket = createSocket(admission.url);
  const broadcasts = new Map<string, Set<(value: unknown, receipt: unknown) => void>>();
  const pending = new Map<string, PendingDelivery>();
  let state: ApplicationActorClientConnection['state'] = 'connecting';
  let closeInput: object | undefined;
  const open = deferred<void>();
  const closed = deferred<void>();
  const connection: Record<string, unknown> = {
    id: admission.connectionId,
    actor: contract.id,
    key,
    get state() { return state; },
    on: Object.freeze(Object.fromEntries(contract.members.flatMap((member) => member.kind === 'broadcast'
      ? [[member.name, (listener: (value: unknown, receipt: unknown) => void) => {
          const listeners = broadcasts.get(member.name) ?? new Set();
          listeners.add(listener);
          broadcasts.set(member.name, listeners);
          return () => listeners.delete(listener);
        }]]
      : []))),
    async close(inputValue?: object) {
      if (state === 'closed') return;
      closeInput = inputValue ?? selectedDisconnect.input;
      await open.promise.catch(() => undefined);
      if (connectionState() === 'closed') return;
      state = 'closing';
      socket.send(JSON.stringify({ type: 'close', member: selectedDisconnect.member, input: closeInput }));
      await closed.promise;
    },
  };
  for (const member of contract.members) {
    if (member.kind !== 'connectionMessage') continue;
    connection[member.name] = async (value: object): Promise<ApplicationActorDeliveryReceipt> => {
      await open.promise;
      if (state !== 'open') throw new Error(`Actor connection ${admission.connectionId} is not open.`);
      const messageId = options.id?.() ?? globalThis.crypto.randomUUID();
      const delivery = deferred<ApplicationActorDeliveryReceipt>();
      pending.set(messageId, delivery);
      socket.send(JSON.stringify({ type: 'message', member: member.name, messageId, input: value }));
      return delivery.promise;
    };
  }
  socket.addEventListener('open', () => {
    state = 'open';
    open.resolve();
  });
  socket.addEventListener('message', (event) => {
    try {
      const envelope = requiredObject(Reflect.get(event as object, 'data') && JSON.parse(String(Reflect.get(event as object, 'data'))), 'actor WebSocket message');
      const type = Reflect.get(envelope, 'type');
      if (type === 'delivery') {
        const messageId = requiredString(Reflect.get(envelope, 'messageId'), 'actor delivery messageId');
        const delivery = pending.get(messageId);
        if (!delivery) return;
        pending.delete(messageId);
        delivery.resolve(requiredObject(Reflect.get(envelope, 'receipt'), 'actor delivery receipt') as unknown as ApplicationActorDeliveryReceipt);
      } else if (type === 'error') {
        const messageId = requiredString(Reflect.get(envelope, 'messageId'), 'actor error messageId');
        const delivery = pending.get(messageId);
        if (!delivery) return;
        pending.delete(messageId);
        delivery.reject(new Error(requiredString(Reflect.get(envelope, 'message'), 'actor delivery error')));
      } else if (type === 'broadcast') {
        const member = requiredString(Reflect.get(envelope, 'member'), 'actor broadcast member');
        for (const listener of broadcasts.get(member) ?? []) listener(Reflect.get(envelope, 'value'), Reflect.get(envelope, 'receipt'));
      }
    } catch {
      // Invalid provider frames are ignored; close/error still gives the
      // application a terminal transport signal without executing data.
    }
  });
  const terminate = () => {
    state = 'closed';
    open.reject(new Error(`Actor connection ${admission.connectionId} closed before admission completed.`));
    for (const delivery of pending.values()) delivery.reject(new Error(`Actor connection ${admission.connectionId} closed before delivery completed.`));
    pending.clear();
    closed.resolve();
  };
  socket.addEventListener('close', terminate);
  socket.addEventListener('error', () => {
    if (state === 'connecting') open.reject(new Error(`Actor connection ${admission.connectionId} failed during admission.`));
  });
  await open.promise;
  return connection as unknown as ApplicationActorClientConnection;

  function connectionState(): ApplicationActorClientConnection['state'] {
    return state;
  }
}

function actorUrl(baseUrl: string | undefined, actor: string, key: string, suffix: string): URL {
  const base = baseUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  return new URL(`/__applik8s/v1/actors/${encodeURIComponent(actor)}/${encodeURIComponent(key)}/${suffix}`, base);
}

function defaultWebSocket(url: string): ApplicationActorClientWebSocket {
  if (typeof WebSocket === 'undefined') throw new Error('Application actor realtime connections require WebSocket support.');
  return new WebSocket(url);
}

function actorConnectionAdmission(value: unknown): ActorConnectionAdmission {
  const record = requiredObject(value, 'actor connection admission');
  return {
    connectionId: requiredString(Reflect.get(record, 'connectionId'), 'actor connectionId'),
    url: requiredString(Reflect.get(record, 'url'), 'actor connection URL'),
  };
}

function actorClientError(value: unknown, status: number, operation: string): Error {
  const message = value && typeof value === 'object' && typeof Reflect.get(value, 'message') === 'string'
    ? String(Reflect.get(value, 'message'))
    : `Actor operation ${operation} failed with HTTP ${status}.`;
  const error = new Error(message);
  Object.defineProperty(error, 'status', { value: status, enumerable: true });
  return error;
}

function assertActorContract(contract: ApplicationActorClientContract): void {
  if (!contract.id.trim()) throw new Error('Application actor client requires a stable actor id.');
  const names = new Set<string>();
  for (const member of contract.members) {
    if (!member.name.trim() || names.has(member.name)) throw new Error(`Application actor ${contract.id} has an invalid or duplicate member ${member.name}.`);
    names.add(member.name);
  }
}

function requiredObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
