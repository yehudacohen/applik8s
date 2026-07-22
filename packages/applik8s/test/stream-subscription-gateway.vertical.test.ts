import { createApplicationStreamSubscriptionGateway, type ApplicationReplayPage } from '@applik8s/applik8s';
import { describe, expect, test, vi } from 'vitest';

const cursorSecret = 'stream-subscription-test-secret-with-32-characters';

describe('authenticated public stream subscriptions', () => {
  test('replays through an opaque identity/context-scoped cursor and closes its source', async () => {
    const close = vi.fn(async () => undefined);
    const read = vi.fn(async (): Promise<ApplicationReplayPage<object>> => ({
      items: [{ id: 'event-1', stream: { name: 'cards.changed', version: 'v1' }, sequence: 1, partitionKey: 'card-1', recordedAt: '2026-07-15T00:00:00.000Z', payload: { cardId: 'card-1' } }],
      nextSequence: 1,
      exhausted: true,
      retentionFloor: 0,
    }));
    const gateway = fixture({ read, close });

    const response = await gateway.handle(request('/streams/card-events/replay', {}));
    expect(response?.status).toBe(200);
    // typecast: the test decodes only the public replay fields asserted below.
    const replay = await response?.json() as { readonly cursor: string; readonly items: readonly unknown[] };
    expect(replay.items).toHaveLength(1);
    expect(replay.cursor).not.toContain('context-private');
    expect(read).toHaveBeenCalledWith(0, 100);
    expect(close).toHaveBeenCalledOnce();

    const resumed = await gateway.handle(request('/streams/card-events/replay', { cursor: replay.cursor }));
    expect(resumed?.status).toBe(200);
    expect(read).toHaveBeenLastCalledWith(1, 100);
  });

  test('fails closed on retention gaps, cursor transfer, and changed authorization', async () => {
    const page = { items: [], nextSequence: 4, exhausted: true, retentionFloor: 8 } satisfies ApplicationReplayPage<object>;
    const first = fixture({ async read() { return { ...page, nextSequence: 4, retentionFloor: 0 }; } });
    const response = await first.handle(request('/streams/card-events/replay', {}));
    // typecast: the response is the versioned public stream replay envelope.
    const cursor = (await response?.json() as { readonly cursor: string }).cursor;

    const gap = fixture({ async read() { return page; } });
    await expect(gap.handle(request('/streams/card-events/replay', { cursor }))).resolves.toMatchObject({ status: 409 });

    const transferred = fixture({ async read() { return page; } }, { principalId: 'another-user' });
    await expect(transferred.handle(request('/streams/card-events/replay', { cursor }))).resolves.toMatchObject({ status: 400 });

    const denied = fixture({ async read() { return page; } }, { authorize: false });
    await expect(denied.handle(request('/streams/card-events/replay', {}))).resolves.toMatchObject({ status: 403 });
  });
});

function fixture(source: { read(after: number, limit: number): Promise<ApplicationReplayPage<object>>; close?(): Promise<void> }, options: { readonly principalId?: string; readonly authorize?: boolean } = {}) {
  return createApplicationStreamSubscriptionGateway({
    subscriptions: [{
      name: 'card-events',
      stream: {
        kind: 'applicationStream',
        // typecast: payload validation belongs to stream registration; this gateway test injects already-authorized replay envelopes.
        definition: { kind: 'applik8sStream', id: 'cards.changed.v1', name: 'cards.changed', version: 'v1', payload: (() => undefined) as never },
        retention: { maxAgeSeconds: 3600 },
        authority: 'postgres-outbox',
        replay: 'supported',
        // typecast: this runtime test does not execute database authoring behavior; the gateway receives an injected replay source.
        database: {} as never,
        partition: () => 'unused',
        authorize: async () => true,
        project: () => { throw new Error('not used by replay fixture'); },
        subscribe: () => { throw new Error('not used by replay fixture'); },
        process: () => { throw new Error('not used by replay fixture'); },
      },
      authorize: async () => options.authorize ?? true,
      open: () => source,
    }],
    authenticate: async () => ({ principal: { id: options.principalId ?? 'user-1' }, authorizationVersion: 'membership-1', contextDigest: 'context-private' }),
    cursorSecret,
  });
}

function request(path: string, body: object): Request { return new Request(`https://catalog.test${path}`, { method: 'POST', body: JSON.stringify(body) }); }
