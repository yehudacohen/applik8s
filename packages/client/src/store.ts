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
  snapshotGeneratedAt: number;
  invalidationEpoch: number;
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
      entry = { key, query, input, listeners: new Set(), seenEvents: new Set(), state: { phase: 'idle', stale: true, revision: 0 }, controller: undefined, refresh: undefined, reconnectAttempt: 0, lastEventSequence: 0, reconnectTimer: undefined, lastUsed: ++this.#clock, snapshotGeneratedAt: 0, invalidationEpoch: 0 };
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
        if (selected.state.phase === 'idle') {
          void this.#refresh(selected).catch(() => undefined);
        }
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
      const generatedAt = snapshotTimestamp(snapshot);
      if (existing?.state.phase === 'ready' && existing.snapshotGeneratedAt >= generatedAt) continue;
      const entry: StoreEntry = existing ?? { key, query: snapshot.query, input: undefined, listeners: new Set(), seenEvents: new Set(), state: { phase: 'idle', stale: true, revision: 0 }, controller: undefined, refresh: undefined, reconnectAttempt: 0, lastEventSequence: 0, reconnectTimer: undefined, lastUsed: ++this.#clock, snapshotGeneratedAt: 0, invalidationEpoch: 0 };
      entry.state = { phase: 'ready', value: snapshot.value, cursor: snapshot.cursor, stale: false, revision: entry.state.revision + 1 };
      entry.snapshotGeneratedAt = generatedAt;
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
      generatedAt: new Date(entry.snapshotGeneratedAt).toISOString(),
    }));
  }

  async #refresh(entry: StoreEntry): Promise<void> {
    if (entry.refresh) return entry.refresh;
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = undefined;
    }
    const { error: _error, ...stateWithoutError } = entry.state;
    entry.state = { ...stateWithoutError, phase: entry.state.value === undefined ? 'loading' : 'ready', stale: true, revision: entry.state.revision + 1 };
    this.#notify(entry);
    const refresh = (async () => {
      // An invalidate can arrive while its authoritative requery is in flight.
      // A snapshot started before that invalidate is not allowed to clear the
      // stale bit or replace the newer resume cursor. Requery until one snapshot
      // spans a stable invalidation epoch; this closes the snapshot/SSE handoff
      // without relying on timing or a page reload.
      while (true) {
        const epoch = entry.invalidationEpoch;
        const eventCursor = entry.state.cursor;
        const snapshot = await this.transport.snapshot(entry.query, entry.input);
        if (snapshot.query !== entry.query || snapshot.inputKey !== entry.key.slice(entry.query.length + 1)) throw new Error('Application query snapshot identity does not match the requested query/input.');
        const superseded = entry.invalidationEpoch !== epoch;
        entry.state = {
          phase: 'ready',
          value: snapshot.value,
          cursor: superseded ? (entry.state.cursor ?? eventCursor ?? snapshot.cursor) : snapshot.cursor,
          stale: superseded,
          revision: entry.state.revision + 1,
        };
        entry.snapshotGeneratedAt = snapshotTimestamp(snapshot);
        entry.reconnectAttempt = 0;
        this.#notify(entry);
        if (!superseded) {
          if (entry.listeners.size > 0) this.#connect(entry);
          return;
        }
      }
    })().catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      entry.state = {
        ...entry.state,
        phase: entry.listeners.size > 0 ? 'reconnecting' : 'error',
        stale: true,
        error: normalized,
        revision: entry.state.revision + 1,
      };
      this.#notify(entry);
      this.#scheduleSnapshotRefresh(entry);
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
    // A query cursor may carry more than one independently advancing frontier.
    // Projection-backed queries, for example, can first invalidate for database
    // sequence N and later invalidate again when their provider revision catches
    // up while the database sequence is still N. Event ids deduplicate the same
    // frontier observation; only a *strictly* older database sequence is stale.
    if (sequence !== undefined && sequence < entry.lastEventSequence) return;
    if (sequence !== undefined) entry.lastEventSequence = sequence;
    entry.seenEvents.add(event.id);
    // typecast: size > 1000 proves the Set iterator yields a string value.
    if (entry.seenEvents.size > 1_000) entry.seenEvents.delete(entry.seenEvents.values().next().value as string);
    if (event.kind === 'reset') {
      entry.invalidationEpoch += 1;
      const { cursor: _cursor, ...stateWithoutCursor } = entry.state;
      entry.state = { ...stateWithoutCursor, stale: true, revision: entry.state.revision + 1 };
      this.#disconnect(entry);
      void this.#refresh(entry).catch(() => undefined);
      return;
    }
    if (event.kind === 'invalidate') entry.invalidationEpoch += 1;
    const { error: _error, ...stateWithoutError } = entry.state;
    entry.reconnectAttempt = 0;
    entry.state = {
      ...stateWithoutError,
      phase: 'ready',
      cursor: event.cursor,
      // A keepalive on a resumed stream proves the server accepted the resume
      // cursor and has delivered every intervening frame. Do not clear stale
      // while an authoritative requery is still in flight.
      stale: event.kind === 'invalidate' || entry.refresh !== undefined,
      revision: entry.state.revision + 1,
    };
    this.#notify(entry);
    if (event.kind === 'invalidate') {
      void this.#refresh(entry).catch(() => undefined);
    }
  }

  #scheduleSnapshotRefresh(entry: StoreEntry): void {
    if (entry.listeners.size === 0 || entry.reconnectTimer) return;
    const delay = Math.min(
      this.#reconnect.maxMs,
      this.#reconnect.initialMs * this.#reconnect.factor ** entry.reconnectAttempt++,
    );
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = undefined;
      void this.#refresh(entry).catch(() => undefined);
    }, delay);
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

function snapshotTimestamp(snapshot: ApplicationQuerySnapshot): number {
  const value = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(value)) throw new Error(`Application query snapshot ${snapshot.query} has invalid generatedAt ${JSON.stringify(snapshot.generatedAt)}.`);
  return value;
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
