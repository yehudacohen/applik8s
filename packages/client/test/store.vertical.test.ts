// typecast-file-boundary: heterogeneous snapshots erase value generics to test cache isolation and hydration.

import { describe, expect, test } from 'vitest';
import type { ApplicationQueryEvent, ApplicationQuerySnapshot, ApplicationQueryTransport } from '../src/protocol.js';
import {
  ApplicationQueryClient,
  applicationQueryInputCanonicalJsonV1Policy,
  queryInputKey,
} from '../src/store.js';

class FakeTransport implements ApplicationQueryTransport {
  readonly snapshots: { query: string; input: unknown }[] = [];
  readonly subscriptions: { query: string; input: unknown; cursor: string; signal: AbortSignal; onEvent: (event: ApplicationQueryEvent) => void; onError: (error: Error) => void }[] = [];
  nextValue: unknown = [{ id: 'card-1', name: 'First' }];
  sequence = 1;
  snapshotOverride: ((query: string, input: unknown) => Promise<ApplicationQuerySnapshot>) | undefined;
  async snapshot<TInput, TValue>(query: string, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
    this.snapshots.push({ query, input });
    if (this.snapshotOverride) return this.snapshotOverride(query, input) as Promise<ApplicationQuerySnapshot<TValue>>;
    return { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query, inputKey: queryInputKey(input), value: this.nextValue as TValue, cursor: `cursor-${this.sequence++}`, capability: 'resumableInvalidation', generatedAt: '2026-07-15T12:00:00.000Z' };
  }
  subscribe<TInput>(query: string, input: TInput, cursor: string, options: { signal: AbortSignal; onEvent: (event: ApplicationQueryEvent) => void; onError: (error: Error) => void }): void {
    this.subscriptions.push({ query, input, cursor, signal: options.signal, onEvent: options.onEvent, onError: options.onError });
  }
}

describe('browser-safe application query client', () => {
  test('derives retained snapshot keys identically through Web and Node byte paths', () => {
    const input = { z: 2, a: [1, 'é'] };
    const retained = 'eyJhIjpbMSwiw6kiXSwieiI6Mn0';
    expect(applicationQueryInputCanonicalJsonV1Policy.name).toBe('application-query-input');
    expect(queryInputKey(input)).toBe(retained);
    expect(Buffer.from('{"a":[1,"é"],"z":2}', 'utf8').toString('base64url')).toBe(retained);
    expect(queryInputKey({ optional: undefined, a: 1 })).toBe(
      'eyJhIjoxLCJvcHRpb25hbCI6bnVsbH0',
    );
    expect(() => queryInputKey({ createdAt: new Date(0) })).toThrow(/cannot represent/);
  });

  test('hydrates an SSR snapshot without a duplicate fetch and resumes from its cursor', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const input = { setId: 'set-1' };
    client.hydrate([{
      kind: 'snapshot',
      protocol: 'applik8s.query/v1alpha1',
      query: 'cards.for-set.v1',
      inputKey: queryInputKey(input),
      value: [{ id: 'card-1', name: 'SSR' }],
      cursor: 'cursor-ssr',
      capability: 'resumableInvalidation',
      generatedAt: '2026-07-15T12:00:00.000Z',
    }]);
    const store = client.query<typeof input, { id: string; name: string }[]>('cards.for-set.v1', input);
    const unsubscribe = store.subscribe(() => undefined);
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', value: [{ id: 'card-1', name: 'SSR' }], cursor: 'cursor-ssr', stale: false });
    expect(transport.snapshots).toHaveLength(0);
    expect(transport.subscriptions).toEqual([expect.objectContaining({ cursor: 'cursor-ssr' })]);
    unsubscribe();
  });

  test('revalidates a retained snapshot when a dormant query becomes observable again', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const store = client.query<Readonly<Record<string, never>>, readonly { id: string }[]>(
      'workspaces.list.v1',
      {},
    );

    const unsubscribe = store.subscribe(() => undefined);
    await settle();
    expect(store.getSnapshot().value).toEqual([{ id: 'card-1', name: 'First' }]);
    unsubscribe();

    transport.nextValue = [{ id: 'workspace-created-while-inactive' }];
    const unsubscribeAgain = store.subscribe(() => undefined);
    await settle();

    expect(transport.snapshots).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      stale: false,
      value: [{ id: 'workspace-created-while-inactive' }],
    });
    unsubscribeAgain();
  });

  test('does not classify a late transport error from an intentional disconnect as reconnecting', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport, {
      reconnect: { initialMs: 0, maxMs: 0, factor: 1 },
    });
    const store = client.query('documents.detail.v1', { id: 'document-1' });
    const unsubscribe = store.subscribe(() => undefined);
    await settle();
    const subscription = transport.subscriptions[0];
    expect(subscription?.signal.aborted).toBe(false);

    unsubscribe();
    expect(subscription?.signal.aborted).toBe(true);
    subscription?.onError(new DOMException('The operation was aborted.', 'AbortError'));
    await settle();

    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', stale: false });
    expect(transport.subscriptions).toHaveLength(1);
  });

  test('accepts a newer hydration snapshot and rejects an older navigation snapshot', () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const input = { setId: 'set-1' };
    const snapshot = (value: string, cursor: string, generatedAt: string): ApplicationQuerySnapshot => ({
      kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'cards.for-set.v1',
      inputKey: queryInputKey(input), value, cursor, capability: 'resumableInvalidation', generatedAt,
    });
    const store = client.query<typeof input, string>('cards.for-set.v1', input);
    client.hydrate([snapshot('first', 'cursor-1', '2026-07-15T12:00:00.000Z')]);
    client.hydrate([snapshot('newer', 'cursor-2', '2026-07-15T12:00:01.000Z')]);
    client.hydrate([snapshot('stale', 'cursor-0', '2026-07-15T11:59:59.000Z')]);
    expect(store.getSnapshot()).toMatchObject({ value: 'newer', cursor: 'cursor-2' });
  });

  test('automatically recovers an initial snapshot after a transient provider failure', async () => {
    const transport = new FakeTransport();
    let attempts = 0;
    transport.snapshotOverride = async (query, input) => {
      attempts += 1;
      if (attempts === 1) throw new Error('query provider is starting');
      return snapshot(query, input, [{ id: 'card-recovered' }], 'cursor-recovered');
    };
    const client = new ApplicationQueryClient(transport, {
      reconnect: { initialMs: 0, maxMs: 0, factor: 1 },
    });
    const store = client.query('cards.list.v1', {});
    const states: string[] = [];
    const unsubscribe = store.subscribe(() => states.push(store.getSnapshot().phase));

    await settle();
    await settle();

    expect(transport.snapshots).toHaveLength(2);
    expect(states).toContain('reconnecting');
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      stale: false,
      value: [{ id: 'card-recovered' }],
      cursor: 'cursor-recovered',
    });
    expect(store.getSnapshot().error).toBeUndefined();
    unsubscribe();
  });

  test('deduplicates invalidations and coalesces authoritative requery', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const store = client.query<{ setId: string }, { id: string; name: string }[]>('cards.for-set.v1', { setId: 'set-1' });
    const unsubscribe = store.subscribe(() => undefined);
    await settle();
    expect(transport.snapshots).toHaveLength(1);
    transport.nextValue = [{ id: 'card-1', name: 'Updated' }];
    const event = { kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: 'change-2', sequence: 2, query: 'cards.for-set.v1', cursor: 'cursor-2', models: ['Card'] } as const;
    transport.subscriptions[0]?.onEvent(event);
    transport.subscriptions[0]?.onEvent(event);
    await settle();
    expect(transport.snapshots).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', value: [{ id: 'card-1', name: 'Updated' }], stale: false });
    unsubscribe();
  });

  test('does not lose an invalidation that arrives during its authoritative requery', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const input = { postIds: ['post-1'] };
    const store = client.query<typeof input, readonly { id: string; state: string }[]>('media.for-posts.v1', input);
    const unsubscribe = store.subscribe(() => undefined);
    await settle();

    const first = deferred<ApplicationQuerySnapshot>();
    const second = deferred<ApplicationQuerySnapshot>();
    const queued = [first.promise, second.promise];
    transport.snapshotOverride = async () => {
      const snapshot = queued.shift();
      if (!snapshot) throw new Error('Unexpected extra snapshot.');
      return snapshot;
    };
    const subscription = transport.subscriptions[0];
    subscription?.onEvent({ kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: 'media:2', sequence: 2, query: 'media.for-posts.v1', cursor: 'event-cursor-2', models: ['Media'] });
    await Promise.resolve();
    subscription?.onEvent({ kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: 'media:3', sequence: 3, query: 'media.for-posts.v1', cursor: 'event-cursor-3', models: ['Media'] });
    first.resolve(snapshot('media.for-posts.v1', input, [{ id: 'media-1', state: 'uploaded' }], 'snapshot-cursor-2'));
    await settle();

    expect(transport.snapshots).toHaveLength(3);
    expect(store.getSnapshot()).toMatchObject({ value: [{ id: 'media-1', state: 'uploaded' }], cursor: 'event-cursor-3', stale: true });
    second.resolve(snapshot('media.for-posts.v1', input, [{ id: 'media-1', state: 'ready' }], 'snapshot-cursor-3'));
    await settle();

    expect(store.getSnapshot()).toMatchObject({ value: [{ id: 'media-1', state: 'ready' }], cursor: 'snapshot-cursor-3', stale: false });
    unsubscribe();
  });

  test('ignores duplicate and out-of-order provider sequences independently of event-id formatting', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const store = client.query('cards.list.v1', {});
    const unsubscribe = store.subscribe(() => undefined);
    await settle();
    const subscription = transport.subscriptions[0];
    subscription?.onEvent({ kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', id: 'opaque-new', sequence: 8, query: 'cards.list.v1', cursor: 'cursor-8' });
    subscription?.onEvent({ kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: 'opaque-old', sequence: 7, query: 'cards.list.v1', cursor: 'cursor-7', models: ['Card'] });
    await settle();
    expect(store.getSnapshot().cursor).toBe('cursor-8');
    expect(transport.snapshots).toHaveLength(1);
    unsubscribe();
  });

  test('returns a retained snapshot to ready after a resumed stream keepalive', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport, {
      reconnect: { initialMs: 0, maxMs: 0, factor: 1 },
    });
    const store = client.query('cards.list.v1', {});
    const unsubscribe = store.subscribe(() => undefined);
    await settle();

    transport.subscriptions[0]?.onError(new Error('connection reset'));
    expect(store.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      stale: true,
      error: expect.any(Error),
    });
    await settle();
    expect(transport.subscriptions).toHaveLength(2);

    transport.subscriptions[1]?.onEvent({
      kind: 'keepalive',
      protocol: 'applik8s.query/v1alpha1',
      id: 'resume-confirmed',
      sequence: 2,
      query: 'cards.list.v1',
      cursor: 'cursor-2',
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      stale: false,
      cursor: 'cursor-2',
      value: [{ id: 'card-1', name: 'First' }],
    });
    expect(store.getSnapshot().error).toBeUndefined();
    unsubscribe();
  });

  test('requeries when a provider revision advances at the same database sequence', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const store = client.query('timeline.home.v1', { viewerId: 'viewer-1' });
    const unsubscribe = store.subscribe(() => undefined);
    await settle();

    const subscription = transport.subscriptions[0];
    subscription?.onEvent({
      kind: 'invalidate',
      protocol: 'applik8s.query/v1alpha1',
      id: 'timeline.home.v1:8:live:10',
      sequence: 8,
      query: 'timeline.home.v1',
      cursor: 'cursor-database-8-provider-10',
      models: ['Post'],
    });
    await settle();
    expect(transport.snapshots).toHaveLength(2);

    transport.nextValue = [{ id: 'post-2', name: 'Projected' }];
    subscription?.onEvent({
      kind: 'invalidate',
      protocol: 'applik8s.query/v1alpha1',
      id: 'timeline.home.v1:8:live:11',
      sequence: 8,
      query: 'timeline.home.v1',
      cursor: 'cursor-database-8-provider-11',
      models: ['Post'],
    });
    await settle();

    expect(transport.snapshots).toHaveLength(3);
    expect(store.getSnapshot()).toMatchObject({
      value: [{ id: 'post-2', name: 'Projected' }],
      cursor: 'cursor-3',
      stale: false,
    });
    unsubscribe();
  });

  test('resets by discarding the cursor and obtaining a new authoritative snapshot', async () => {
    const transport = new FakeTransport();
    const client = new ApplicationQueryClient(transport);
    const store = client.query('cards.list.v1', {});
    const unsubscribe = store.subscribe(() => undefined);
    await settle();
    transport.nextValue = [{ id: 'card-2' }];
    transport.subscriptions[0]?.onEvent({ kind: 'reset', protocol: 'applik8s.query/v1alpha1', id: 'reset-1', query: 'cards.list.v1', reason: 'retentionGap' });
    await settle();
    expect(transport.snapshots).toHaveLength(2);
    expect(store.getSnapshot()).toMatchObject({ value: [{ id: 'card-2' }], stale: false });
    unsubscribe();
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function snapshot(query: string, input: unknown, value: unknown, cursor: string): ApplicationQuerySnapshot {
  return { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query, inputKey: queryInputKey(input), value, cursor, capability: 'resumableInvalidation', generatedAt: '2026-07-15T12:00:00.000Z' };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve: (value) => resolve?.(value) };
}
