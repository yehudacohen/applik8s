// typecast-file-boundary: subscription gateway fixtures decode deliberately erased transport events through the validated public protocol boundary.
import { createHmac } from 'node:crypto';
import { type ApplicationReplayPage, createApplicationAuthorizedReplayableStream, createApplicationStreamSubscriptionGateway } from '@applik8s/applik8s';
import { type ApplicationAuthorizationReceipt, canonicalJsonV1Value } from '@applik8s/core';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import { describe, expect, test, vi } from 'vitest';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';

const cursorSecret = 'stream-subscription-test-secret-with-32-characters';

describe('authenticated public stream subscriptions', () => {
  test('advances across hidden exact-instance events without leaking or stalling', async () => {
    const pages = [
      {
        items: [
          event(1, 'hidden-1'),
          event(2, 'visible-1'),
        ],
        nextSequence: 2,
        exhausted: false,
        retentionFloor: 0,
      },
      {
        items: [
          event(3, 'hidden-2'),
          event(4, 'visible-2'),
        ],
        nextSequence: 4,
        exhausted: true,
        retentionFloor: 0,
      },
    ];
    let page = 0;
    const filtered = createApplicationAuthorizedReplayableStream({
      source: {
        async read() {
          return pages[page++]!;
        },
      },
      authorize: async (candidate) =>
        String(Reflect.get(candidate.payload, 'id')).startsWith('visible'),
    });

    await expect(filtered.read(0, 2)).resolves.toMatchObject({
      items: [
        expect.objectContaining({ sequence: 2, payload: { id: 'visible-1' } }),
        expect.objectContaining({ sequence: 4, payload: { id: 'visible-2' } }),
      ],
      nextSequence: 4,
      exhausted: true,
    });
  });

  test('replays through an opaque identity/context-scoped cursor and closes its source', async () => {
    const close = vi.fn(async () => undefined);
    const read = vi.fn(async (): Promise<ApplicationReplayPage<object>> => ({
      items: [{ id: 'event-1', stream: { name: 'cards.changed', version: 'v1' }, sequence: 1, partitionKey: 'card-1', recordedAt: '2026-07-15T00:00:00.000Z', payload: { cardId: 'card-1' } }],
      nextSequence: 1,
      exhausted: true,
      retentionFloor: 0,
    }));
    let admittedIdentity: Parameters<Parameters<typeof createApplicationStreamSubscriptionGateway>[0]['subscriptions'][number]['open']>[0] | undefined;
    const observations: unknown[] = [];
    const gateway = fixture({ read, close }, {
      observeIdentity: (identity) => { admittedIdentity = identity; },
      observeAdmission: (observation) => { observations.push(observation); },
    });

    const response = await gateway.handle(request('/streams/card-events/replay', {}, {
      'x-request-id': 'stream-request-1',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    }));
    expect(response?.status).toBe(200);
    // typecast: the test decodes only the public replay fields asserted below.
    const replay = await response?.json() as { readonly cursor: string; readonly items: readonly unknown[] };
    expect(replay.items).toHaveLength(1);
    expect(replay.cursor).not.toContain('context-private');
    const cursorBody = JSON.parse(
      Buffer.from(replay.cursor.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const [encodedBody, encodedSignature] = replay.cursor.split('.');
    expect(encodedSignature).toBe(
      createHmac('sha256', cursorSecret)
        .update(encodedBody ?? '')
        .digest('base64url'),
    );
    expect(cursorBody).toMatchObject({ version: 2, subscription: 'card-events' });
    expect(cursorBody).not.toHaveProperty('principalId');
    expect(cursorBody).not.toHaveProperty('authorizationVersion');
    expect(cursorBody).not.toHaveProperty('contextDigest');
    expect(JSON.stringify(cursorBody)).not.toContain('user-1');
    expect(JSON.stringify(cursorBody)).not.toContain('membership-1');
    expect(JSON.stringify(cursorBody)).not.toContain('context-private');
    expect(read).toHaveBeenCalledWith(0, 100);
    expect(close).toHaveBeenCalledOnce();
    expect(admittedIdentity?.admission).toMatchObject({
      correlationId: 'stream-request-1',
      operation: { id: 'applik8s://streams/card-events/replay', transport: 'http' },
      trace: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    });
    expect(observations).toContainEqual({
      apiVersion: 'applik8s.admission-observation/v1',
      state: 'admitted',
      boundary: 'request',
      admissionVersion: 'applik8s.admission/v1',
      transport: 'http',
      compatibilityPath: 'canonical',
    });

    const resumed = await gateway.handle(request('/streams/card-events/replay', { cursor: replay.cursor }));
    expect(resumed?.status).toBe(200);
    expect(read).toHaveBeenLastCalledWith(1, 100);

    const currentTime = Date.now();
    const v1Codec = createSignedEnvelopeCodec({
      purpose: 'applik8s.stream-cursor/v1',
      keys: staticSignedEnvelopeKeyProvider({
        current: {
          id: 'stream-cursor-current',
          key: signedEnvelopeUtf8Key(cursorSecret),
        },
      }),
      now: () => currentTime,
      maximumLifetimeMs: 15 * 60_000,
      validatePayload(value) { return value; },
    });
    const v1Cursor = await v1Codec.sign(canonicalJsonV1Value(cursorBody), {
      issuedAt: currentTime,
      expiresAt: Number(cursorBody.expiresAt),
    });
    const v1Resumed = await gateway.handle(request('/streams/card-events/replay', { cursor: v1Cursor }));
    expect(v1Resumed?.status).toBe(200);
    expect(read).toHaveBeenLastCalledWith(1, 100);
  });

  test('bounds stream cursor lifetime at the framework boundary', () => {
    expect(() => fixture({
      async read() { return { items: [], nextSequence: 0, exhausted: true, retentionFloor: 0 }; },
    }, { cursorTtlSeconds: 24 * 60 * 60 + 1 })).toThrow(/cursor, session, or page bounds/);
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

  test('pins canonical operation authority and resumes after unrelated global authority advancement', async () => {
    const source = { async read() { return { items: [], nextSequence: 0, exhausted: true, retentionFloor: 0 }; } };
    const first = fixture(source, { authorityRevision: 'authority-1' });
    const response = await first.handle(request('/streams/card-events/replay', {}));
    const cursor = (await response?.json() as { readonly cursor: string }).cursor;
    const cursorBody = JSON.parse(
      Buffer.from(cursor.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(cursorBody).toMatchObject({
      version: 2,
      operationId: 'applik8s://stream-fixture/queries/cards.changed/operations/subscribe',
      operationVersion: 'v1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
    });
    expect(cursorBody.applicationBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const changed = fixture(source, { authorityRevision: 'authority-2' });
    await expect(changed.handle(request('/streams/card-events/replay', { cursor }))).resolves.toMatchObject({ status: 200 });
  });

  test('keeps receipt-less cursors fail-closed across principal authority changes', async () => {
    const source = { async read() { return { items: [], nextSequence: 0, exhausted: true, retentionFloor: 0 }; } };
    const first = fixture(source, { principalAuthorityRevision: 'membership-1' });
    const response = await first.handle(request('/streams/card-events/replay', {}));
    const cursor = (await response?.json() as { readonly cursor: string }).cursor;

    const changed = fixture(source, { principalAuthorityRevision: 'membership-2' });
    await expect(changed.handle(request('/streams/card-events/replay', { cursor }))).resolves.toMatchObject({ status: 400 });
  });
});

function event(sequence: number, id: string) {
  return {
    id: `event-${sequence}`,
    stream: { name: 'signals', version: 'v1' },
    sequence,
    partitionKey: id,
    recordedAt: '2026-07-15T00:00:00.000Z',
    payload: { id },
  };
}

function fixture(source: { read(after: number, limit: number): Promise<ApplicationReplayPage<object>>; close?(): Promise<void> }, options: { readonly principalId?: string; readonly authorize?: boolean; readonly authorityRevision?: string; readonly principalAuthorityRevision?: string; readonly cursorTtlSeconds?: number; readonly observeIdentity?: (identity: Parameters<Parameters<typeof createApplicationStreamSubscriptionGateway>[0]['subscriptions'][number]['open']>[0]) => void; readonly observeAdmission?: Parameters<typeof createApplicationStreamSubscriptionGateway>[0]['observeAdmission'] } = {}) {
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
        onEvent: () => { throw new Error('not used by replay fixture'); },
        onBatch: () => { throw new Error('not used by replay fixture'); },
        process: () => { throw new Error('not used by replay fixture'); },
      },
      authorize: async () => options.authorize ?? true,
      open: (identity) => {
        options.observeIdentity?.(identity);
        return source;
      },
    }],
    authenticate: async () => ({ principal: testApplicationPrincipal(options.principalId ?? 'user-1', { authorityRevision: options.principalAuthorityRevision ?? 'membership-1' }), trustedContext: {}, contextDigest: 'context-private' }),
    ...(options.authorityRevision ? {
      authorizeOperation: async ({ identity, inputDigest, trustedContextDigest }) => streamReceipt(
        identity.principal.id,
        options.authorityRevision ?? 'authority-1',
        inputDigest,
        trustedContextDigest,
      ),
    } : {}),
    cursorSecret,
    ...(options.observeAdmission ? { observeAdmission: options.observeAdmission } : {}),
    ...(options.cursorTtlSeconds === undefined ? {} : { cursorTtlSeconds: options.cursorTtlSeconds }),
  });
}

function request(path: string, body: object, headers?: HeadersInit): Request { return new Request(`https://catalog.test${path}`, { method: 'POST', ...(headers ? { headers } : {}), body: JSON.stringify(body) }); }

function streamReceipt(
  principalId: string,
  authorityRevision: string,
  inputDigest: string,
  trustedContextDigest: string,
): ApplicationAuthorizationReceipt {
  return {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    application: 'stream-fixture',
    id: `receipt-${authorityRevision}`,
    operationId: 'applik8s://stream-fixture/queries/cards.changed/operations/subscribe',
    operationVersion: 'v1',
    catalogRevision: 'catalog-1',
    authorityRevision,
    principal: {
      id: principalId,
      identity: { id: `identity-${principalId}`, kind: 'human', issuer: 'fixture', subject: principalId },
      kind: 'human',
      authenticationMethod: 'fixture',
      audience: ['stream-gateway'],
      trustedContextDigest,
      catalogRevision: 'catalog-1',
      authorityRevision,
      admittedAt: '2026-07-15T12:00:00.000Z',
    },
    trustedContextDigest,
    matchedPermissionIds: [],
    matchedGrantIds: [],
    inputDigest,
    target: { kind: 'all' },
    scopeEvidence: [{ kind: 'all' }],
    audience: 'stream-gateway',
    transport: 'http',
    admittedAt: '2026-07-15T12:00:00.000Z',
  };
}
