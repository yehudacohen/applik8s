// typecast-file-boundary: persisted local resource JSON is validated before entering the in-memory authority.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Applik8sLocalResourceAuthorityOptions {
  readonly statePath: string;
  readonly token: string;
  readonly host?: string;
  readonly port?: number;
}

export interface Applik8sLocalResourceAuthority {
  readonly origin: string;
  readonly store: Applik8sLocalResourceStore;
  close(): Promise<void>;
}

export interface Applik8sLocalResourceObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>> & {
    readonly name: string;
    readonly namespace?: string;
    readonly uid: string;
    readonly resourceVersion: string;
    readonly generation: number;
  };
  readonly spec?: unknown;
  readonly status?: unknown;
  readonly [key: string]: unknown;
}

export interface Applik8sLocalResourceEvent {
  readonly type: 'ADDED' | 'MODIFIED' | 'DELETED';
  readonly object: Applik8sLocalResourceObject;
}

interface StoredState {
  readonly apiVersion: 'applik8s.localResources/v1alpha1';
  readonly revision: number;
  readonly resources: readonly Applik8sLocalResourceObject[];
  readonly events: readonly Applik8sLocalResourceEvent[];
}

export interface Applik8sLocalResourceAddress {
  readonly group: string;
  readonly version: string;
  readonly namespace?: string;
  readonly plural: string;
  readonly name?: string;
}

export interface Applik8sLocalResourceListOptions {
  readonly limit?: number;
  readonly continueToken?: string;
  readonly labelSelector?: string;
  readonly fieldSelector?: string;
}

/** Persistent, single-writer resource authority used only by the local deployment target. */
export class Applik8sLocalResourceStore {
  readonly #statePath: string;
  readonly #listeners = new Set<(event: Applik8sLocalResourceEvent) => void>();
  #state: StoredState = emptyState();
  #write: Promise<void> = Promise.resolve();

  constructor(statePath: string) {
    this.#statePath = statePath;
  }

  async load(): Promise<void> {
    const raw = await readFile(this.#statePath, 'utf8').catch((cause: unknown) => {
      if (statusCode(cause) === 'ENOENT') return undefined;
      throw cause;
    });
    if (raw === undefined) return;
    this.#state = validateStoredState(JSON.parse(raw));
  }

  async create(address: Applik8sLocalResourceAddress, body: unknown): Promise<Applik8sLocalResourceObject> {
    const input = record(body, 'Local resource body');
    const metadata = record(input.metadata, 'Local resource metadata');
    const name = requiredString(metadata.name, 'Local resource metadata.name');
    const kind = requiredString(input.kind, 'Local resource kind');
    const namespace = address.namespace;
    const identity = resourceIdentity(address, name);
    if (this.#state.resources.some((resource) => identityOf(resource, address.plural) === identity)) throw authorityError(409, `${identity} already exists.`);
    const revision = this.#state.revision + 1;
    const object = {
      ...input,
      apiVersion: `${address.group}/${address.version}`,
      kind,
      metadata: {
        ...metadata,
        name,
        ...(namespace ? { namespace } : {}),
        uid: randomUUID(),
        creationTimestamp: new Date().toISOString(),
        resourceVersion: String(revision),
        generation: 1,
      },
    } as unknown as Applik8sLocalResourceObject;
    await this.#commit(revision, [...this.#state.resources, object], { type: 'ADDED', object });
    return object;
  }

  get(address: Applik8sLocalResourceAddress): Applik8sLocalResourceObject {
    const name = requiredString(address.name, 'Local resource name');
    const identity = resourceIdentity(address, name);
    const found = this.#state.resources.find((resource) => identityOf(resource, address.plural) === identity);
    if (!found) throw authorityError(404, `${identity} was not found.`);
    return found;
  }

  list(address: Applik8sLocalResourceAddress, options: Applik8sLocalResourceListOptions = {}): Readonly<Record<string, unknown>> {
    const snapshot = this.#state.revision;
    const cursor = decodeCursor(options.continueToken);
    if (cursor && cursor.revision !== snapshot) throw authorityError(410, 'Local resource continuation token expired after the collection changed.');
    const items = this.#state.resources
      .filter((resource) => resourceAddressMatches(resource, address))
      .filter((resource) => selectorMatches(resource, options.labelSelector, options.fieldSelector))
      .sort((left, right) => left.metadata.name.localeCompare(right.metadata.name));
    const offset = cursor?.offset ?? 0;
    const limit = boundedLimit(options.limit);
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      apiVersion: 'v1',
      kind: 'List',
      metadata: {
        resourceVersion: String(snapshot),
        ...(nextOffset < items.length ? { _continue: encodeCursor({ revision: snapshot, offset: nextOffset }) } : {}),
      },
      items: page,
    };
  }

  async replaceStatus(address: Applik8sLocalResourceAddress, status: unknown): Promise<Applik8sLocalResourceObject> {
    return this.#replace(address, (current, revision) => ({ ...current, status, metadata: { ...current.metadata, resourceVersion: String(revision) } }));
  }

  async replace(address: Applik8sLocalResourceAddress, body: unknown): Promise<Applik8sLocalResourceObject> {
    const desired = record(body, 'Local resource replacement');
    return this.#replace(address, (current, revision) => ({
      ...desired,
      apiVersion: current.apiVersion,
      kind: current.kind,
      metadata: {
        ...record(desired.metadata, 'Local resource replacement metadata'),
        name: current.metadata.name,
        ...(current.metadata.namespace ? { namespace: current.metadata.namespace } : {}),
        uid: current.metadata.uid,
        creationTimestamp: current.metadata.creationTimestamp,
        resourceVersion: String(revision),
        generation: current.metadata.generation + 1,
      },
    }) as Applik8sLocalResourceObject);
  }

  async update(address: Applik8sLocalResourceAddress, update: (current: Applik8sLocalResourceObject) => Applik8sLocalResourceObject): Promise<Applik8sLocalResourceObject> {
    return this.#replace(address, (current, revision) => {
      const next = update(current);
      return { ...next, metadata: { ...next.metadata, resourceVersion: String(revision) } };
    });
  }

  async delete(address: Applik8sLocalResourceAddress): Promise<void> {
    const current = this.get(address);
    const revision = this.#state.revision + 1;
    const deleted = { ...current, metadata: { ...current.metadata, resourceVersion: String(revision) } };
    await this.#commit(revision, this.#state.resources.filter((resource) => resource !== current), { type: 'DELETED', object: deleted });
  }

  subscribe(listener: (event: Applik8sLocalResourceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  eventsAfter(address: Applik8sLocalResourceAddress, resourceVersion: number): readonly Applik8sLocalResourceEvent[] {
    return this.#state.events.filter((event) => Number(event.object.metadata.resourceVersion) > resourceVersion && resourceAddressMatches(event.object, address));
  }

  async #replace(address: Applik8sLocalResourceAddress, update: (current: Applik8sLocalResourceObject, revision: number) => Applik8sLocalResourceObject): Promise<Applik8sLocalResourceObject> {
    const current = this.get(address);
    const revision = this.#state.revision + 1;
    const next = update(current, revision);
    await this.#commit(revision, this.#state.resources.map((resource) => resource === current ? next : resource), { type: 'MODIFIED', object: next });
    return next;
  }

  async #commit(revision: number, resources: readonly Applik8sLocalResourceObject[], event: Applik8sLocalResourceEvent): Promise<void> {
    const state: StoredState = {
      apiVersion: 'applik8s.localResources/v1alpha1',
      revision,
      resources,
      events: [...this.#state.events, event].slice(-1_000),
    };
    this.#state = state;
    this.#write = this.#write.then(async () => {
      await mkdir(dirname(this.#statePath), { recursive: true });
      const temporary = `${this.#statePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await rename(temporary, this.#statePath);
    });
    await this.#write;
    for (const listener of this.#listeners) listener(event);
  }
}

export async function startApplik8sLocalResourceAuthority(options: Applik8sLocalResourceAuthorityOptions): Promise<Applik8sLocalResourceAuthority> {
  const token = requiredString(options.token, 'Local resource authority token');
  const store = new Applik8sLocalResourceStore(options.statePath);
  await store.load();
  const server = createServer(async (request, response) => {
    try {
      if (!authorized(request.headers.authorization, token)) throw authorityError(401, 'Unauthorized.');
      const url = new URL(request.url ?? '/', 'http://local.applik8s');
      if (url.pathname === '/healthz' && request.method === 'GET') return json(response, 200, { ready: true });
      if (url.pathname.startsWith('/v1/watch/apis/') && request.method === 'GET') return watchResponse(request, response, store, parseWatchAddress(url.pathname), url);
      const address = parseResourceAddress(url.pathname);
      if (!address) throw authorityError(404, 'Unknown local resource route.');
      if (request.method === 'GET' && address.name) return json(response, 200, store.get(address));
      if (request.method === 'GET') return json(response, 200, store.list(address, listOptions(url)));
      if (request.method === 'POST' && !address.name) return json(response, 201, await store.create(address, await requestJson(request)));
      if (request.method === 'PATCH' && address.name && url.searchParams.get('subresource') === 'status') return json(response, 200, await store.replaceStatus(address, record(await requestJson(request), 'Status body').status));
      if (request.method === 'PUT' && address.name) return json(response, 200, await store.replace(address, await requestJson(request)));
      if (request.method === 'DELETE' && address.name) {
        await store.delete(address);
        response.writeHead(204).end();
        return;
      }
      throw authorityError(405, 'Method not allowed.');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      json(response, numericStatus(error), { error: error.message });
    }
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local resource authority did not expose a TCP address.');
  return {
    origin: `http://${host}:${address.port}`,
    store,
    close: () => closeServer(server),
  };
}

function watchResponse(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, store: Applik8sLocalResourceStore, address: Applik8sLocalResourceAddress, url: URL): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const write = (event: Applik8sLocalResourceEvent): void => {
    if (resourceAddressMatches(event.object, address) && selectorMatches(event.object, url.searchParams.get('labelSelector') ?? undefined, url.searchParams.get('fieldSelector') ?? undefined)) response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  for (const event of store.eventsAfter(address, Number(url.searchParams.get('resourceVersion') ?? 0))) write(event);
  const unsubscribe = store.subscribe(write);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  request.once('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function parseResourceAddress(pathname: string): Applik8sLocalResourceAddress | undefined {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'v1' || parts[1] !== 'resources' || parts.length < 6) return undefined;
  const [group, version] = [parts[2], parts[3]];
  if (!group || !version) return undefined;
  if (parts[4] === 'cluster') return { group, version, plural: requiredString(parts[5], 'Resource plural'), ...(parts[6] ? { name: parts[6] } : {}) };
  if (parts[4] === 'namespaces' && parts[5] && parts[6]) return { group, version, namespace: parts[5], plural: parts[6], ...(parts[7] ? { name: parts[7] } : {}) };
  return undefined;
}

function parseWatchAddress(pathname: string): Applik8sLocalResourceAddress {
  const path = pathname.slice('/v1/watch'.length);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'apis' || !parts[1] || !parts[2]) throw authorityError(404, 'Invalid local watch path.');
  if (parts[3] === 'namespaces' && parts[4] && parts[5]) return { group: parts[1], version: parts[2], namespace: parts[4], plural: parts[5] };
  if (parts[3]) return { group: parts[1], version: parts[2], plural: parts[3] };
  throw authorityError(404, 'Invalid local watch path.');
}

function resourceAddressMatches(resource: Applik8sLocalResourceObject, address: Applik8sLocalResourceAddress): boolean {
  return resource.apiVersion === `${address.group}/${address.version}`
    && resource.metadata.namespace === address.namespace
    && applik8sLocalResourcePlural(resource.kind) === address.plural;
}

function identityOf(resource: Applik8sLocalResourceObject, plural: string): string {
  const [group = '', version = ''] = resource.apiVersion.split('/');
  return resourceIdentity({ group, version, ...(resource.metadata.namespace ? { namespace: resource.metadata.namespace } : {}), plural }, resource.metadata.name);
}

function resourceIdentity(address: Applik8sLocalResourceAddress, name: string): string {
  return `${address.group}/${address.version}/${address.namespace ?? '_cluster'}/${address.plural}/${name}`;
}

export function applik8sLocalResourcePlural(kind: string): string {
  const lower = kind.toLowerCase();
  return lower.endsWith('s') ? `${lower}es` : lower.endsWith('y') ? `${lower.slice(0, -1)}ies` : `${lower}s`;
}

function selectorMatches(resource: Applik8sLocalResourceObject, labels?: string, fields?: string): boolean {
  const labelRecord = recordOrEmpty(resource.metadata.labels);
  for (const selector of splitSelectors(labels)) {
    const [key, value] = selector.split('=');
    if (!key || value === undefined || labelRecord[key] !== value) return false;
  }
  for (const selector of splitSelectors(fields)) {
    const [key, value] = selector.split('=');
    if (value === undefined) return false;
    if (key === 'metadata.name' && resource.metadata.name !== value) return false;
    if (key === 'metadata.namespace' && resource.metadata.namespace !== value) return false;
  }
  return true;
}

function listOptions(url: URL): Applik8sLocalResourceListOptions {
  return {
    ...(url.searchParams.get('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
    ...(url.searchParams.get('_continue') ? { continueToken: url.searchParams.get('_continue')! } : {}),
    ...(url.searchParams.get('labelSelector') ? { labelSelector: url.searchParams.get('labelSelector')! } : {}),
    ...(url.searchParams.get('fieldSelector') ? { fieldSelector: url.searchParams.get('fieldSelector')! } : {}),
  };
}

function splitSelectors(value?: string): readonly string[] {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function boundedLimit(value?: number): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 500) throw authorityError(400, 'List limit must be an integer from 1 through 500.');
  return value;
}

function encodeCursor(value: { readonly revision: number; readonly offset: number }): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(value?: string): { readonly revision: number; readonly offset: number } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { readonly revision?: unknown; readonly offset?: unknown };
    if (!Number.isInteger(parsed.revision) || !Number.isInteger(parsed.offset)) throw new Error('invalid');
    return { revision: parsed.revision as number, offset: parsed.offset as number };
  } catch {
    throw authorityError(400, 'Invalid local resource continuation token.');
  }
}

async function requestJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw authorityError(413, 'Local resource request exceeded 1 MiB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw authorityError(400, 'Local resource request body must be JSON.');
  }
}

function validateStoredState(value: unknown): StoredState {
  const state = record(value, 'Local resource state');
  if (state.apiVersion !== 'applik8s.localResources/v1alpha1' || !Number.isInteger(state.revision) || !Array.isArray(state.resources) || !Array.isArray(state.events)) throw new Error('Local resource state is malformed or incompatible.');
  return state as unknown as StoredState;
}

function emptyState(): StoredState {
  return { apiVersion: 'applik8s.localResources/v1alpha1', revision: 0, resources: [], events: [] };
}

function authorized(value: string | undefined, token: string): boolean {
  const candidate = value?.startsWith('Bearer ') ? value.slice(7) : '';
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(response: import('node:http').ServerResponse, code: number, body: unknown): void {
  response.writeHead(code, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function authorityError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

function numericStatus(error: Error): number {
  const code = Reflect.get(error, 'code');
  return typeof code === 'number' && code >= 400 && code <= 599 ? code : 500;
}

function statusCode(cause: unknown): unknown {
  return cause && typeof cause === 'object' ? Reflect.get(cause, 'code') : undefined;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw authorityError(400, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw authorityError(400, `${label} must be a non-empty string.`);
  return value.trim();
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => server.close((cause) => cause ? reject(cause) : resolveClose()));
}
