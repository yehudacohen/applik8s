// typecast-file-boundary: The local HTTP authority is an untyped transport boundary whose frames and errors are shape-checked before adapter use.
import type {
  Applik8sResourceObjectClient,
  Applik8sResourceWatchClient,
} from './kubernetes-gateway.js';

export interface Applik8sLocalResourceClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface Applik8sLocalResourceClients {
  readonly objects: Applik8sResourceObjectClient;
  readonly watch: Applik8sResourceWatchClient;
  readonly readiness: () => Promise<void>;
}

/** Connects the framework-neutral resource gateway to the local target authority. */
export function createApplik8sLocalResourceClients(
  options: Applik8sLocalResourceClientOptions,
): Applik8sLocalResourceClients {
  const baseUrl = requiredUrl(options.baseUrl);
  const token = required(options.token, 'Local resource authority token');
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImplementation(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await localResourceError(response);
    return response.status === 204 ? undefined : response.json();
  };
  const collectionPath = (input: ResourceCoordinates): string => {
    const prefix = input.namespace
      ? `/v1/resources/${segment(input.group)}/${segment(input.version)}/namespaces/${segment(input.namespace)}`
      : `/v1/resources/${segment(input.group)}/${segment(input.version)}/cluster`;
    return `${prefix}/${segment(input.plural)}`;
  };
  const list = (input: ResourceCoordinates & ListCoordinates): Promise<unknown> => request('GET', withQuery(collectionPath(input), input));
  const create = (input: ResourceCoordinates & { readonly body: object }): Promise<unknown> => request('POST', collectionPath(input), input.body);
  const get = (input: ResourceCoordinates & { readonly name: string }): Promise<unknown> => request('GET', `${collectionPath(input)}/${segment(input.name)}`);
  return {
    objects: {
      listNamespacedCustomObject: (input) => list(input),
      listClusterCustomObject: (input) => list(input),
      createNamespacedCustomObject: (input) => create(input),
      createClusterCustomObject: (input) => create(input),
      getNamespacedCustomObject: (input) => get(input),
      getClusterCustomObject: (input) => get(input),
    },
    watch: {
      async watch(path, query, callback, done) {
        const controller = new AbortController();
        void consumeWatch(fetchImplementation, new URL(withQuery(`/v1/watch${path}`, query), baseUrl), token, controller.signal, callback)
          .then(() => done())
          .catch((cause: unknown) => {
            if (!controller.signal.aborted) done(cause);
          });
        return controller;
      },
    },
    async readiness() {
      const response = await fetchImplementation(new URL('/healthz', baseUrl), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw await localResourceError(response);
    },
  };
}

interface ResourceCoordinates {
  readonly group: string;
  readonly version: string;
  readonly plural: string;
  readonly namespace?: string;
}

interface ListCoordinates {
  readonly limit?: number;
  readonly _continue?: string;
  readonly labelSelector?: string;
  readonly fieldSelector?: string;
  readonly allowWatchBookmarks?: boolean;
}

async function consumeWatch(
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
  token: string,
  signal: AbortSignal,
  callback: (phase: string, object: unknown) => void,
): Promise<void> {
  const response = await fetchImplementation(url, { signal, headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw await localResourceError(response);
  if (!response.body) throw new Error('Local resource authority returned an empty watch stream.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  while (!signal.aborted) {
    const next = await reader.read();
    if (next.done) return;
    buffered += next.value;
    let boundary = buffered.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
      if (data) {
        const event = JSON.parse(data) as { readonly type?: unknown; readonly object?: unknown };
        if (typeof event.type === 'string') callback(event.type, event.object);
      }
      boundary = buffered.indexOf('\n\n');
    }
  }
}

function withQuery(path: string, input: object): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input)) {
    if (['group', 'version', 'plural', 'namespace', 'body', 'fieldManager'].includes(name) || value === undefined) continue;
    query.set(name, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function localResourceError(response: Response): Promise<Error> {
  const message = await response.text().catch(() => '');
  const error = new Error(`Local resource authority HTTP ${response.status}${message ? `: ${message}` : ''}`) as Error & { code: number; response: { statusCode: number } };
  error.code = response.status;
  error.response = { statusCode: response.status };
  return error;
}

function requiredUrl(value: string): URL {
  const url = new URL(required(value, 'Local resource authority URL'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Local resource authority URL must use HTTP(S), received ${url.protocol}.`);
  return url;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function segment(value: string): string {
  return encodeURIComponent(required(value, 'Resource coordinate'));
}
