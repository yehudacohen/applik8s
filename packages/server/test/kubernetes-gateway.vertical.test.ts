// typecast-file-boundary: focused runtime tests use structural Kubernetes client doubles for only the methods exercised by the gateway.

import type { JsonValue } from '@applik8s/core';
import {
  createSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
  verifyLegacyCompactHmacJson,
} from '@applik8s/runtime/signed-envelope';
import type { CustomObjectsApi, Watch } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';
import { createApplik8sKubernetesGateway } from '../src/kubernetes-gateway.js';

const secret = 'test-cursor-secret-that-is-longer-than-thirty-two-bytes';
const resource = {
  apiVersion: 'guestbook.example/v1alpha1',
  kind: 'GuestBookEntry',
  plural: 'guestbookentries',
  scope: 'Namespaced' as const,
};
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { guestbook: { type: 'string' }, message: { type: 'string' } },
  required: ['guestbook', 'message'],
};

describe('generated Kubernetes application gateway', () => {
  it('authorizes and idempotently creates a model before returning its authoritative snapshot', async () => {
    let stored: KubernetesObject | undefined;
    let commandAdmission: unknown;
    const observations: unknown[] = [];
    const objects = {
      async createNamespacedCustomObject(request: { readonly body: KubernetesObject }) {
        stored = {
          ...request.body,
          metadata: { ...request.body.metadata, resourceVersion: '7' },
        };
        return stored;
      },
      async getNamespacedCustomObject() {
        if (!stored) throw new Error('missing');
        return stored;
      },
    } as unknown as CustomObjectsApi;
    const gateway = createApplik8sKubernetesGateway({
      authenticate: async () => testApplicationAdmission('demo', {
        authorityRevision: 'canonical-authority-v1',
        trustedContext: { guestbook: 'tenant-a', namespace: 'guestbook', role: 'author' },
      }),
      cursorSecret: secret,
      objects,
      watch: inertWatch(),
      readiness: () => undefined,
      observeAdmission: (observation) => { observations.push(observation); },
      commands: [{
        id: 'GuestBookEntry.create',
        model: 'GuestBookEntry',
        resource,
        inputSchema,
        allowedNamespaces: ['guestbook'],
        authorize: ({ admission, context, input }) => {
          commandAdmission = admission;
          return context.guestbook === field(input, 'guestbook');
        },
        place: ({ context }) => ({ namespace: String(context.namespace), generateName: 'entry-', labels: { tenant: String(context.guestbook) } }),
      }],
    });
    const submission = await gateway.handle(post('/__applik8s/v1/commands/GuestBookEntry.create/submit', {
      input: { guestbook: 'tenant-a', message: 'hello' },
      commandId: 'command-1',
      idempotencyKey: 'once',
    }, {
      'x-request-id': 'kubernetes-command-1',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    }));
    expect(submission.status).toBe(200);
    const accepted = await submission.json() as { readonly durableResult: string; readonly progressCursor: string };
    expect(accepted.durableResult).toBe('pending');
    const legacyPayload = await releasedKubernetesCursorPayload(accepted.progressCursor);
    expect(legacyPayload).toMatchObject({ kind: 'kubernetes-command', commandId: 'command-1' });
    expect(stored).toMatchObject({
      metadata: {
        namespace: 'guestbook',
        labels: { tenant: 'tenant-a' },
        annotations: { 'applik8s.dev/command-id': 'command-1' },
      },
      spec: { guestbook: 'tenant-a', message: 'hello' },
    });
    expect(commandAdmission).toMatchObject({
      correlationId: 'kubernetes-command-1',
      operation: { id: 'applik8s://commands/GuestBookEntry.create/submit', transport: 'http' },
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

    const progress = await gateway.handle(post('/__applik8s/v1/commands/GuestBookEntry.create/progress', {
      cursor: await signedEnvelopeV1KubernetesCursor(legacyPayload),
    }));
    expect(await progress.json()).toMatchObject({
      durableResult: 'succeeded',
      output: {
        identity: expect.stringMatching(/^entry-[a-f0-9]{20}$/),
        value: { guestbook: 'tenant-a', message: 'hello' },
        revision: '7',
      },
      modelRevision: '7',
    });
  });

  it('rejects request-derived namespaces outside the generated RBAC boundary before calling Kubernetes', async () => {
    let called = false;
    const objects = {
      async createNamespacedCustomObject() {
        called = true;
        throw new Error('must not be reached');
      },
      async listNamespacedCustomObject() {
        called = true;
        throw new Error('must not be reached');
      },
    } as unknown as CustomObjectsApi;
    const gateway = createApplik8sKubernetesGateway({
      authenticate: identity('tenant-a'),
      cursorSecret: secret,
      objects,
      watch: inertWatch(),
      readiness: () => undefined,
      commands: [{
        id: 'GuestBookEntry.create', model: 'GuestBookEntry', resource, inputSchema,
        allowedNamespaces: ['guestbook'], authorize: () => true,
        place: () => ({ namespace: 'other', generateName: 'entry-' }),
      }],
      queries: [{
        id: 'GuestBookEntry.published', model: 'GuestBookEntry', resource,
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'array', items: { type: 'object' } },
        budgets: { timeoutMs: 1_000, maxRows: 10, maxResultBytes: 10_000 },
        bounds: { pageSize: 10, maxPages: 2, maxItems: 10 },
        allowedNamespaces: ['guestbook'], authorize: () => true,
        namespace: () => 'other', project: ({ value }) => value,
      }],
    });

    const command = await gateway.handle(post('/__applik8s/v1/commands/GuestBookEntry.create/submit', {
      input: { guestbook: 'tenant-a', message: 'hello' }, commandId: 'command-unsafe', idempotencyKey: 'once',
    }));
    const query = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/snapshot', { input: {} }));

    expect(command.status).toBe(400);
    expect(query.status).toBe(400);
    expect(called).toBe(false);
  });

  it('uses a bounded list resourceVersion as the signed watch frontier and rejects cross-context cursors', async () => {
    let page = 0;
    const queryTelemetry: Array<{ readonly query: string; readonly operation: string }> = [];
    const subscriptionLifecycle: string[] = [];
    const objects = {
      async listNamespacedCustomObject() {
        page += 1;
        return page === 1
          ? {
              metadata: { resourceVersion: '11', continue: 'next' },
              items: [{ metadata: { name: 'older', creationTimestamp: '2026-01-01T00:00:00Z' }, spec: { guestbook: 'tenant-a', message: 'old' }, status: { phase: 'Published' } }],
            }
          : {
              metadata: { resourceVersion: '11' },
              items: [{ metadata: { name: 'newer', creationTimestamp: '2026-01-02T00:00:00Z' }, spec: { guestbook: 'tenant-a', message: 'new' }, status: { phase: 'Published' } }],
            };
      },
    } as unknown as CustomObjectsApi;
    const watch = {
      async watch(
        _path: string,
        query: { readonly resourceVersion?: string },
        callback: (phase: string, object: KubernetesObject) => void,
        done: (error?: Error) => void,
      ) {
        expect(query.resourceVersion).toBe('11');
        queueMicrotask(() => {
          callback('MODIFIED', { metadata: { name: 'newer', resourceVersion: '12' } });
          subscriptionLifecycle.push('watch:done');
          done();
        });
        return new AbortController();
      },
    } as unknown as Watch;
    let authorizationVersion = 'demo-v1';
    const gateway = createApplik8sKubernetesGateway({
      authenticate: async () => testApplicationAdmission('demo', {
        authorityRevision: authorizationVersion,
        trustedContext: { guestbook: 'tenant-a', namespace: 'guestbook', role: 'author' },
      }),
      cursorSecret: secret,
      objects,
      watch,
      readiness: () => undefined,
      queryTelemetry: {
        async run(query, operation, execute) {
          queryTelemetry.push({ query, operation });
          subscriptionLifecycle.push(`${operation}:start`);
          try {
            return await execute();
          } finally {
            subscriptionLifecycle.push(`${operation}:end`);
          }
        },
      },
      queries: [{
        id: 'GuestBookEntry.published',
        model: 'GuestBookEntry',
        resource,
        inputSchema: {
          type: 'object',
          properties: { guestbook: { type: 'string' }, limit: { type: 'integer' } },
          required: ['guestbook'],
        },
        outputSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, message: { type: 'string' } },
            required: ['id', 'message'],
          },
        },
        budgets: { timeoutMs: 1_000, maxRows: 10, maxResultBytes: 10_000 },
        bounds: { pageSize: 1, maxPages: 3, maxItems: 3 },
        authorize: ({ context, input }) => context.guestbook === field(input, 'guestbook'),
        fixedNamespace: 'guestbook',
        filter: ({ value }) => field(value.status, 'phase') === 'Published',
        compare: ({ left, right }) => String(right.metadata.creationTimestamp).localeCompare(String(left.metadata.creationTimestamp)),
        project: ({ value }) => ({ id: value.metadata.name, message: field(value.spec, 'message') }),
        limit: ({ input }) => Number(field(input, 'limit') ?? 10),
      }],
    });
    const snapshotResponse = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/snapshot', {
      input: { guestbook: 'tenant-a', limit: 1 },
    }));
    const snapshot = await snapshotResponse.json() as { readonly value: unknown; readonly cursor: string };
    expect(snapshot.value).toEqual([{ id: 'newer', message: 'new' }]);

    subscriptionLifecycle.length = 0;
    const subscription = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/subscribe', {
      input: { guestbook: 'tenant-a', limit: 1 },
      cursor: snapshot.cursor,
    }));
    const event = await subscription.text();
    expect(event).toContain('"kind":"invalidate"');
    expect(event).toContain('"models":["GuestBookEntry"]');
    expect(subscriptionLifecycle).toEqual(['subscribe:start', 'watch:done', 'subscribe:end']);

    const multiplex = await gateway.handle(post('/__applik8s/v1/queries/multiplex', {
      subscriptions: [
        { id: 'first', query: 'GuestBookEntry.published', input: { guestbook: 'tenant-a', limit: 1 }, cursor: snapshot.cursor },
        { id: 'second', query: 'GuestBookEntry.published', input: { guestbook: 'tenant-a', limit: 1 }, cursor: snapshot.cursor },
      ],
    }));
    expect(multiplex.status).toBe(200);
    const multiplexEvents = await multiplex.text();
    expect(multiplexEvents).toContain('"subscriptionId":"first"');
    expect(multiplexEvents).toContain('"subscriptionId":"second"');
    expect(multiplexEvents).toContain('"protocol":"applik8s.query-multiplex/v1alpha1"');

    authorizationVersion = 'demo-v2';
    const rejected = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/subscribe', {
      input: { guestbook: 'tenant-a', limit: 1 },
      cursor: snapshot.cursor,
    }));
    expect(rejected.status).toBe(400);
    expect(queryTelemetry).toEqual([
      { query: 'GuestBookEntry.published', operation: 'snapshot' },
      { query: 'GuestBookEntry.published', operation: 'subscribe' },
      { query: 'GuestBookEntry.published', operation: 'subscribe' },
      { query: 'GuestBookEntry.published', operation: 'subscribe' },
    ]);
  });

  it('stops admitting work and aborts active Kubernetes watches during shutdown', async () => {
    const telemetryLifecycle: string[] = [];
    const objects = {
      async listNamespacedCustomObject() {
        return {
          metadata: { resourceVersion: '21' },
          items: [{ metadata: { name: 'entry', resourceVersion: '21' }, spec: { guestbook: 'tenant-a', message: 'hello' } }],
        };
      },
    } as unknown as CustomObjectsApi;
    const active = new AbortController();
    const watch = {
      async watch() {
        return active;
      },
    } as unknown as Watch;
    const gateway = createApplik8sKubernetesGateway({
      authenticate: identity('tenant-a'),
      cursorSecret: secret,
      objects,
      watch,
      readiness: () => undefined,
      queryTelemetry: {
        async run(_query, operation, execute) {
          telemetryLifecycle.push(`${operation}:start`);
          try {
            return await execute();
          } finally {
            telemetryLifecycle.push(`${operation}:end`);
          }
        },
      },
      queries: [{
        id: 'GuestBookEntry.published',
        model: 'GuestBookEntry',
        resource,
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
        budgets: { timeoutMs: 1_000, maxRows: 10, maxResultBytes: 10_000 },
        bounds: { pageSize: 10, maxPages: 2, maxItems: 10 },
        authorize: () => true,
        fixedNamespace: 'guestbook',
        project: ({ value }) => ({ id: value.metadata.name }),
      }],
    });
    const snapshot = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/snapshot', { input: {} }));
    const { cursor } = await snapshot.json() as { readonly cursor: string };
    telemetryLifecycle.length = 0;
    const subscription = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/subscribe', { input: {}, cursor }));

    await gateway.close();

    expect(active.signal.aborted).toBe(true);
    expect(telemetryLifecycle).toEqual(['subscribe:start']);
    const rejected = await gateway.handle(post('/__applik8s/v1/queries/GuestBookEntry.published/snapshot', { input: {} }));
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: 'gateway_stopping' });
    await subscription.body?.cancel();
    expect(telemetryLifecycle).toEqual(['subscribe:start', 'subscribe:end']);
  });

  it('reports the underlying provider failure without weakening the redacted HTTP contract', async () => {
    const failure = new Error('provider certificate chain rejected');
    const observed: Array<{
      readonly error: unknown;
      readonly operation: unknown;
    }> = [];
    const gateway = createApplik8sKubernetesGateway({
      authenticate: identity('tenant-a'),
      cursorSecret: secret,
      objects: {
        async listNamespacedCustomObject() {
          throw failure;
        },
      } as unknown as CustomObjectsApi,
      watch: inertWatch(),
      readiness: () => undefined,
      onError(error, operation) {
        observed.push({ error, operation });
        throw new Error('diagnostic sink failure must not escape');
      },
      queries: [{
        id: 'GuestBookEntry.published',
        model: 'GuestBookEntry',
        resource,
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'array', items: { type: 'object' } },
        budgets: { timeoutMs: 1_000, maxRows: 10, maxResultBytes: 10_000 },
        bounds: { pageSize: 10, maxPages: 2, maxItems: 10 },
        authorize: () => true,
        fixedNamespace: 'guestbook',
        project: ({ value }) => value,
      }],
    });

    const response = await gateway.handle(post(
      '/__applik8s/v1/queries/GuestBookEntry.published/snapshot',
      { input: {} },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(observed).toEqual([{
      error: failure,
      operation: {
        kind: 'query',
        id: 'GuestBookEntry.published',
        action: 'snapshot',
      },
    }]);
  });
});

async function releasedKubernetesCursorPayload(value: string): Promise<JsonValue> {
  return verifyLegacyCompactHmacJson(value, {
    key: signedEnvelopeUtf8Key(secret),
    validatePayload: (payload) => payload,
  });
}

async function signedEnvelopeV1KubernetesCursor(payload: JsonValue): Promise<string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Test cursor payload is invalid.');
  const expiresAt = Reflect.get(payload, 'expiresAt');
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError('Test cursor expiry is invalid.');
  const issuedAt = Date.now();
  return createSignedEnvelopeCodec<JsonValue>({
    purpose: 'applik8s.kubernetes-gateway-cursor/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'kubernetes-gateway-cursor-current', key: signedEnvelopeUtf8Key(secret) },
    }),
    now: () => issuedAt,
    maximumLifetimeMs: 15 * 60_000,
    validatePayload: (value) => value,
  }).sign(payload, { issuedAt, expiresAt: Number(expiresAt) });
}

function identity(guestbook: string) {
  return async () => testApplicationAdmission('demo', {
    authorityRevision: 'demo-v1',
    trustedContext: { guestbook, namespace: 'guestbook', role: 'author' },
  });
}

function post(path: string, body: unknown, headers?: Readonly<Record<string, string>>): Request {
  return new Request(`http://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function inertWatch(): Watch {
  return { async watch() { return new AbortController(); } } as unknown as Watch;
}

function field(value: unknown, name: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, name) : undefined;
}

interface KubernetesObject {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly resourceVersion?: string;
    readonly creationTimestamp?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec?: unknown;
  readonly status?: unknown;
}
