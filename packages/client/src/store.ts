import type { ApplicationQueryEvent, ApplicationQuerySnapshot, ApplicationQueryTransport } from './protocol.js';

export interface ApplicationQueryState<TValue = unknown> {
  readonly phase: 'idle' | 'loading' | 'ready' | 'reconnecting' | 'error';
  readonly value?: TValue;
  readonly cursor?: string;
  readonly error?: Error;
  readonly stale: boolean;
  readonly revision: number;
}

export interface ApplicationQueryExternalStore<TValue> {
  getSnapshot(): ApplicationQueryState<TValue>;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  dispose(): void;
}

export interface ApplicationQueryClientOptions {
  readonly maxEntries?: number;
  readonly reconnect?: { readonly initialMs?: number; readonly maxMs?: number; readonly factor?: number };
}

interface StoreEntry<TInput = unknown, TValue = unknown> {
  readonly key: string;
  readonly query: string;
  input: TInput;
  readonly listeners: Set<() => void>;
  readonly seenEvents: Set<string>;
  state: ApplicationQueryState<TValue>;
  controller: AbortController | undefined;
  refresh: Promise<void> | undefined;
  reconnectAttempt: number;
  lastEventSequence: number;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  lastUsed: number;
}

export class ApplicationQueryClient {
  readonly #entries = new Map<string, StoreEntry>();
  readonly #maxEntries: number;
  readonly #reconnect: { readonly initialMs: number; readonly maxMs: number; readonly factor: number };
  #clock = 0;

  constructor(readonly transport: ApplicationQueryTransport, options: ApplicationQueryClientOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 100;
    this.#reconnect = {
      initialMs: options.reconnect?.initialMs ?? 250,
      maxMs: options.reconnect?.maxMs ?? 10_000,
      factor: options.reconnect?.factor ?? 2,
    };
    if (this.#maxEntries < 1) throw new Error('ApplicationQueryClient maxEntries must be at least 1.');
  }

  // typecast-boundary: cache keys preserve the query/input generic association inside the private heterogeneous store map.
  query<TInput, TValue>(query: string, input: TInput): ApplicationQueryExternalStore<TValue> {
    const key = queryCacheKey(query, input);
    let entry = this.#entries.get(key) as StoreEntry<TInput, TValue> | undefined;
    if (!entry) {
      entry = { key, query, input, listeners: new Set(), seenEvents: new Set(), state: { phase: 'idle', stale: true, revision: 0 }, controller: undefined, refresh: undefined, reconnectAttempt: 0, lastEventSequence: 0, reconnectTimer: undefined, lastUsed: ++this.#clock };
      this.#entries.set(key, entry);
      this.#evict();
    }
    entry.input = input;
    entry.lastUsed = ++this.#clock;
    const selected = entry;
    return {
      getSnapshot: () => selected.state,
      subscribe: (listener) => {
        selected.listeners.add(listener);
        if (selected.state.phase === 'idle') void this.#refresh(selected);
        else if (selected.state.cursor && !selected.controller) this.#connect(selected);
        return () => {
          selected.listeners.delete(listener);
          if (selected.listeners.size === 0) this.#disconnect(selected);
        };
      },
      refresh: () => this.#refresh(selected),
      dispose: () => {
        this.#disconnect(selected);
        this.#entries.delete(selected.key);
      },
    };
  }

  hydrate(snapshots: readonly ApplicationQuerySnapshot[]): void {
    for (const snapshot of snapshots) {
      const key = `${snapshot.query}:${snapshot.inputKey}`;
      const existing = this.#entries.get(key);
      if (existing?.state.phase === 'ready') continue;
      const entry: StoreEntry = existing ?? { key, query: snapshot.query, input: undefined, listeners: new Set(), seenEvents: new Set(), state: { phase: 'idle', stale: true, revision: 0 }, controller: undefined, refresh: undefined, reconnectAttempt: 0, lastEventSequence: 0, reconnectTimer: undefined, lastUsed: ++this.#clock };
      entry.state = { phase: 'ready', value: snapshot.value, cursor: snapshot.cursor, stale: false, revision: entry.state.revision + 1 };
      this.#entries.set(key, entry);
      this.#notify(entry);
    }
    this.#evict();
  }

  dehydrate(): readonly ApplicationQuerySnapshot[] {
    return [...this.#entries.values()].filter((entry) => entry.state.phase === 'ready' && entry.state.cursor).map((entry) => ({
      kind: 'snapshot',
      protocol: 'applik8s.query/v1alpha1',
      query: entry.query,
      inputKey: entry.key.slice(entry.query.length + 1),
      value: entry.state.value,
      // typecast: the preceding filter requires a truthy cursor for every dehydrated ready entry.
      cursor: entry.state.cursor as string,
      capability: 'resumableInvalidation',
      generatedAt: new Date().toISOString(),
    }));
  }

  async #refresh(entry: StoreEntry): Promise<void> {
    if (entry.refresh) return entry.refresh;
    const { error: _error, ...stateWithoutError } = entry.state;
    entry.state = { ...stateWithoutError, phase: entry.state.value === undefined ? 'loading' : 'ready', stale: true, revision: entry.state.revision + 1 };
    this.#notify(entry);
    const refresh = this.transport.snapshot(entry.query, entry.input).then((snapshot) => {
      if (snapshot.query !== entry.query || snapshot.inputKey !== entry.key.slice(entry.query.length + 1)) throw new Error('Application query snapshot identity does not match the requested query/input.');
      entry.state = { phase: 'ready', value: snapshot.value, cursor: snapshot.cursor, stale: false, revision: entry.state.revision + 1 };
      entry.reconnectAttempt = 0;
      this.#notify(entry);
      if (entry.listeners.size > 0) this.#connect(entry);
    }).catch((error: unknown) => {
      entry.state = { ...entry.state, phase: 'error', stale: true, error: error instanceof Error ? error : new Error(String(error)), revision: entry.state.revision + 1 };
      this.#notify(entry);
      throw error;
    }).finally(() => { entry.refresh = undefined; });
    entry.refresh = refresh;
    return refresh;
  }

  #connect(entry: StoreEntry): void {
    if (entry.controller || !entry.state.cursor || entry.listeners.size === 0) return;
    const controller = new AbortController();
    entry.controller = controller;
    void Promise.resolve(this.transport.subscribe(entry.query, entry.input, entry.state.cursor, {
      signal: controller.signal,
      onEvent: (event) => this.#event(entry, event),
      onError: (error) => this.#subscriptionError(entry, error),
    })).catch((error: unknown) => this.#subscriptionError(entry, error instanceof Error ? error : new Error(String(error))));
  }

  #event(entry: StoreEntry, event: ApplicationQueryEvent): void {
    if (event.query !== entry.query || entry.seenEvents.has(event.id)) return;
    const sequence = event.kind === 'reset' ? undefined : event.sequence;
    if (sequence !== undefined && sequence <= entry.lastEventSequence) return;
    if (sequence !== undefined) entry.lastEventSequence = sequence;
    entry.seenEvents.add(event.id);
    // typecast: size > 1000 proves the Set iterator yields a string value.
    if (entry.seenEvents.size > 1_000) entry.seenEvents.delete(entry.seenEvents.values().next().value as string);
    if (event.kind === 'reset') {
      const { cursor: _cursor, ...stateWithoutCursor } = entry.state;
      entry.state = { ...stateWithoutCursor, stale: true, revision: entry.state.revision + 1 };
      this.#disconnect(entry);
      void this.#refresh(entry);
      return;
    }
    entry.state = { ...entry.state, cursor: event.cursor, stale: event.kind === 'invalidate' || entry.state.stale, revision: entry.state.revision + 1 };
    this.#notify(entry);
    if (event.kind === 'invalidate') void this.#refresh(entry);
  }

  #subscriptionError(entry: StoreEntry, error: Error): void {
    if (entry.controller?.signal.aborted) return;
    entry.controller = undefined;
    entry.state = { ...entry.state, phase: 'reconnecting', stale: true, error, revision: entry.state.revision + 1 };
    this.#notify(entry);
    const delay = Math.min(this.#reconnect.maxMs, this.#reconnect.initialMs * this.#reconnect.factor ** entry.reconnectAttempt++);
    entry.reconnectTimer = setTimeout(() => { entry.reconnectTimer = undefined; this.#connect(entry); }, delay);
  }

  #disconnect(entry: StoreEntry): void {
    entry.controller?.abort();
    entry.controller = undefined;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = undefined;
  }

  #notify(entry: StoreEntry): void {
    for (const listener of entry.listeners) listener();
  }

  #evict(): void {
    if (this.#entries.size <= this.#maxEntries) return;
    const candidates = [...this.#entries.values()].filter((entry) => entry.listeners.size === 0).sort((left, right) => left.lastUsed - right.lastUsed);
    while (this.#entries.size > this.#maxEntries && candidates.length > 0) {
      const entry = candidates.shift();
      if (!entry) break;
      this.#disconnect(entry);
      this.#entries.delete(entry.key);
    }
  }
}

export function queryInputKey(input: unknown): string {
  return base64Url(stableJson(input));
}

export function queryCacheKey(query: string, input: unknown): string {
  return `${query}:${queryInputKey(input)}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
