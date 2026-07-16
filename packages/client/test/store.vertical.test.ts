// typecast-file-boundary: heterogeneous snapshots erase value generics to test cache isolation and hydration.
import type { ApplicationQueryEvent, ApplicationQuerySnapshot, ApplicationQueryTransport } from '../src/protocol.js';
import { ApplicationQueryClient, queryInputKey } from '../src/store.js';
import { describe, expect, test } from 'vitest';

class FakeTransport implements ApplicationQueryTransport {
  readonly snapshots: { query: string; input: unknown }[] = [];
  readonly subscriptions: { query: string; input: unknown; cursor: string; onEvent: (event: ApplicationQueryEvent) => void; onError: (error: Error) => void }[] = [];
  nextValue: unknown = [{ id: 'card-1', name: 'First' }];
  sequence = 1;
  async snapshot<TInput, TValue>(query: string, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
    this.snapshots.push({ query, input });
    return { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query, inputKey: queryInputKey(input), value: this.nextValue as TValue, cursor: `cursor-${this.sequence++}`, capability: 'resumableInvalidation', generatedAt: '2026-07-15T12:00:00.000Z' };
  }
  subscribe<TInput>(query: string, input: TInput, cursor: string, options: { signal: AbortSignal; onEvent: (event: ApplicationQueryEvent) => void; onError: (error: Error) => void }): void {
    this.subscriptions.push({ query, input, cursor, onEvent: options.onEvent, onError: options.onError });
  }
}

describe('browser-safe application query client', () => {
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
