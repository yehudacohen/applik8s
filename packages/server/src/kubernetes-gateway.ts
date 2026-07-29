// typecast-file-boundary: Kubernetes custom objects and generated JSON-schema contracts are validated at the public gateway boundary.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CustomObjectsApi, KubeConfig, VersionApi, Watch } from '@kubernetes/client-node';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { ApplicationCommandProgress, ApplicationCommandSubmission, ApplicationQueryEvent, ApplicationQueryMultiplexFrame, ApplicationQuerySnapshot } from '@applik8s/client';
import type { JsonObject } from '@applik8s/core';

export interface Applik8sGatewayAdmission {
  readonly principal: { readonly id: string; readonly claims?: Readonly<Record<string, unknown>> };
  readonly trustedContext: Readonly<Record<string, unknown>>;
  readonly authorizationVersion: string;
}

export interface Applik8sKubernetesResourceContract {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
  readonly scope: 'Namespaced' | 'Cluster';
}

export interface Applik8sKubernetesCreateContract {
  readonly id: string;
  readonly model: string;
  readonly resource: Applik8sKubernetesResourceContract;
  readonly inputSchema: JsonObject;
  /** Namespaces the generated service account is intentionally allowed to address. */
  readonly allowedNamespaces?: readonly string[];
  authorize(request: { readonly principal: Applik8sGatewayAdmission['principal']; readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: object }): boolean | Promise<boolean>;
  place(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: object }): {
    readonly namespace?: string;
    readonly name?: string;
    readonly generateName?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
}

export interface Applik8sKubernetesQueryContract {
  readonly id: string;
  readonly model: string;
  readonly resource: Applik8sKubernetesResourceContract;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly budgets: { readonly timeoutMs: number; readonly maxResultBytes: number; readonly maxRows: number };
  readonly bounds: { readonly pageSize: number; readonly maxPages: number; readonly maxItems: number };
  /** Namespaces the generated service account is intentionally allowed to address. */
  readonly allowedNamespaces?: readonly string[];
  authorize(request: { readonly principal: Applik8sGatewayAdmission['principal']; readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown }): boolean | Promise<boolean>;
  namespace?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown }): string;
  readonly fixedNamespace?: string;
  labelSelector?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown }): string | undefined;
  fieldSelector?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown }): string | undefined;
  filter?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown; readonly value: KubernetesObject }): boolean;
  compare?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown; readonly left: KubernetesObject; readonly right: KubernetesObject }): number;
  project(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown; readonly value: KubernetesObject }): unknown;
  limit?(request: { readonly context: Applik8sGatewayAdmission['trustedContext']; readonly input: unknown }): number;
}

export interface Applik8sKubernetesGatewayOptions {
  readonly authenticate: (
    request: Request,
    operation?: { readonly kind: 'command' | 'query'; readonly id: string; readonly input: unknown },
  ) => Applik8sGatewayAdmission | Promise<Applik8sGatewayAdmission>;
  readonly cursorSecret: string;
  readonly commands?: readonly Applik8sKubernetesCreateContract[];
  readonly queries?: readonly Applik8sKubernetesQueryContract[];
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  readonly cursorTtlSeconds?: number;
  readonly maxSessionMs?: number;
  readonly maxMultiplexSubscriptions?: number;
  readonly subscriptionLimits?: { readonly perPrincipal?: number; readonly total?: number };
  readonly kubeConfig?: KubeConfig;
  readonly objects?: CustomObjectsApi;
  readonly watch?: Watch;
  readonly readiness?: () => void | Promise<void>;
  readonly now?: () => Date;
}

export interface Applik8sKubernetesGateway {
  handle(request: Request): Promise<Response>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

interface KubernetesObject {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
    readonly resourceVersion?: string;
    readonly creationTimestamp?: string;
    readonly [key: string]: unknown;
  };
  readonly spec?: unknown;
  readonly status?: unknown;
  readonly [key: string]: unknown;
}

interface KubernetesList {
  readonly metadata: { readonly resourceVersion?: string; readonly continue?: string; readonly _continue?: string };
  readonly items: readonly KubernetesObject[];
}

interface QueryCursor {
  readonly version: 1;
  readonly kind: 'kubernetes-query';
  readonly query: string;
  readonly inputKey: string;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly resourceVersion: string;
  readonly sequence: number;
  readonly expiresAt: number;
}

interface CommandCursor {
  readonly version: 1;
  readonly kind: 'kubernetes-command';
  readonly command: string;
  readonly commandId: string;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly namespace?: string;
  readonly name: string;
  readonly expiresAt: number;
}

type GatewayCursor = QueryCursor | CommandCursor;

/**
 * Framework-neutral Kubernetes model gateway.
 *
 * Kubernetes list/resourceVersion/watch is the provider authority; HMAC-signed
 * cursors bind that frontier to query input, principal, admitted context, and
 * authorization version before anything reaches the browser protocol.
 */
export function createApplik8sKubernetesGateway(options: Applik8sKubernetesGatewayOptions): Applik8sKubernetesGateway {
  if (options.cursorSecret.length < 32) throw new Error('Applik8s Kubernetes gateway cursorSecret must contain at least 32 characters.');
  const basePath = normalizeBasePath(options.basePath ?? '/__applik8s/v1');
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const cursorTtlSeconds = options.cursorTtlSeconds ?? 15 * 60;
  const maxSessionMs = options.maxSessionMs ?? 5 * 60_000;
  const maxMultiplexSubscriptions = options.maxMultiplexSubscriptions ?? 100;
  if (!Number.isSafeInteger(maxMultiplexSubscriptions) || maxMultiplexSubscriptions < 1 || maxMultiplexSubscriptions > 1_000) {
    throw new Error('Applik8s Kubernetes gateway maxMultiplexSubscriptions must be between 1 and 1000.');
  }
  const now = options.now ?? (() => new Date());
  const commands = uniqueById(options.commands ?? [], 'command');
  const queries = uniqueById(options.queries ?? [], 'query');
  const config = options.kubeConfig ?? defaultKubeConfig();
  const objects = options.objects ?? config.makeApiClient(CustomObjectsApi);
  const watch = options.watch ?? new Watch(config);
  const version = options.readiness ? undefined : config.makeApiClient(VersionApi);
  const subscriptions = subscriptionLimiter({
    perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20,
    total: options.subscriptionLimits?.total ?? 1_000,
  });
  const activeWatches = new Set<AbortController>();
  let stopping = false;

  return {
    async handle(request) {
      const url = new URL(request.url);
      if (url.pathname === '/healthz' || url.pathname === `${basePath}/healthz`) return json({ live: !stopping }, stopping ? 503 : 200);
      if (url.pathname === '/readyz' || url.pathname === `${basePath}/readyz`) {
        try {
          await ready();
          return json({ ready: true }, 200);
        } catch (error) {
          return json({ ready: false, error: error instanceof Error ? error.message : String(error) }, 503);
        }
      }
      if (stopping) return json({ error: 'gateway_stopping' }, 503, { 'retry-after': '1' });
      if (!url.pathname.startsWith(`${basePath}/`)) return json({ error: 'not_found' }, 404);
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const body = await boundedJson(request, maxRequestBytes);
      if (!body.ok) return body.response;
      const route = url.pathname.slice(basePath.length).split('/').filter(Boolean).map(decodeURIComponent);
      try {
        if (route[0] === 'commands' && route.length === 3) {
          const command = commands.get(route[1] ?? '');
          if (!command) return json({ error: 'not_found' }, 404);
          if (route[2] === 'submit') return await submitCommand(request, command, body.value);
          if (route[2] === 'progress') return await commandProgress(request, command, body.value);
        }
        if (route[0] === 'queries' && route.length === 2 && route[1] === 'multiplex') {
          return await queryMultiplex(request, body.value);
        }
        if (route[0] === 'queries' && route.length === 3) {
          const query = queries.get(route[1] ?? '');
          if (!query) return json({ error: 'not_found' }, 404);
          if (route[2] === 'snapshot') return await querySnapshot(request, query, body.value);
          if (route[2] === 'subscribe') return await querySubscription(request, query, body.value);
        }
        return json({ error: 'not_found' }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not authorized/i.test(message)) return json({ error: 'forbidden' }, 403);
        if (/validation|cursor|required|placement|namespace|limit/i.test(message)) return json({ error: 'invalid_request' }, 400);
        return json({ error: 'internal_error' }, 500);
      }
    },
    ready,
    async close() {
      stopping = true;
      for (const active of activeWatches) active.abort();
      activeWatches.clear();
    },
  };

  async function ready(): Promise<void> {
    if (stopping) throw new Error('Applik8s Kubernetes gateway is stopping.');
    if (options.readiness) await options.readiness();
    else {
      if (!config.getCurrentCluster()) throw new Error('Kubernetes configuration has no current cluster.');
      await version?.getCode({});
    }
  }

  async function submitCommand(request: Request, command: Applik8sKubernetesCreateContract, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const input = validateObject(command.inputSchema, body.input, `${command.id}.input`);
    const admission = await admit(options.authenticate, request, { kind: 'command', id: command.id, input });
    if (!await command.authorize({ principal: admission.principal, context: admission.trustedContext, input })) {
      throw new Error(`Application command ${command.id} is not authorized.`);
    }
    const commandId = requiredString(body.commandId, 'commandId');
    const idempotencyKey = requiredString(body.idempotencyKey, 'idempotencyKey');
    const contextDigest = admittedContextDigest(options.cursorSecret, admission.trustedContext);
    const placement = command.place({ context: admission.trustedContext, input });
    const namespace = command.resource.scope === 'Namespaced'
      ? allowedNamespace(requiredString(placement.namespace, 'placement.namespace'), command.allowedNamespaces, command.id)
      : undefined;
    const name = deterministicKubernetesName(placement, contextDigest, idempotencyKey);
    const object = {
      apiVersion: command.resource.apiVersion,
      kind: command.resource.kind,
      metadata: {
        name,
        ...(namespace ? { namespace } : {}),
        ...(placement.labels ? { labels: placement.labels } : {}),
        ...(placement.annotations ? { annotations: placement.annotations } : {}),
        'annotations': {
          ...(placement.annotations ?? {}),
          'applik8s.dev/command-id': commandId,
          'applik8s.dev/idempotency-digest': createHash('sha256').update(`${contextDigest}:${idempotencyKey}`).digest('hex'),
        },
      },
      spec: input,
    };
    let created: KubernetesObject;
    try {
      created = await createObject(objects, command.resource, namespace, object);
    } catch (error) {
      if (responseStatus(error) !== 409) throw error;
      created = await getObject(objects, command.resource, namespace, name);
      if (stableJson(created.spec) !== stableJson(input)) {
        throw new Error(`Application command ${command.id} idempotency key already identifies a different Kubernetes object.`);
      }
    }
    const cursor = signCursor(options.cursorSecret, {
      version: 1,
      kind: 'kubernetes-command',
      command: command.id,
      commandId,
      principalId: admission.principal.id,
      contextDigest,
      authorizationVersion: admission.authorizationVersion,
      ...(namespace ? { namespace } : {}),
      name,
      expiresAt: now().getTime() + cursorTtlSeconds * 1_000,
    });
    const submission: ApplicationCommandSubmission = {
      protocol: 'applik8s.command/v1alpha1',
      command: command.id,
      commandId,
      correlationId: commandId,
      transport: 'acknowledged',
      durableResult: 'pending',
      progressCursor: cursor,
      workflow: 'notStarted',
      reconciliation: 'progressing',
    };
    return json(submission, 200);
  }

  async function commandProgress(request: Request, command: Applik8sKubernetesCreateContract, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const encoded = requiredString(body.cursor, 'cursor');
    const admission = await admit(options.authenticate, request, { kind: 'command', id: command.id, input: { cursor: encoded } });
    const cursor = verifyCursor(options.cursorSecret, encoded, now().getTime());
    if (cursor.kind !== 'kubernetes-command' || cursor.command !== command.id) throw new Error('Application command cursor is invalid.');
    assertCursorIdentity(cursor, admission, options.cursorSecret);
    const object = await getObject(objects, command.resource, cursor.namespace, cursor.name);
    const progress: ApplicationCommandProgress = {
      protocol: 'applik8s.command/v1alpha1',
      command: command.id,
      commandId: cursor.commandId,
      correlationId: cursor.commandId,
      transport: 'acknowledged',
      durableResult: 'succeeded',
      progressCursor: encoded,
      output: modelSnapshot(object),
      ...(object.metadata.resourceVersion ? { modelRevision: object.metadata.resourceVersion } : {}),
      workflow: 'notStarted',
      reconciliation: reconciliationState(object),
    };
    return json(progress, 200);
  }

  async function querySnapshot(request: Request, query: Applik8sKubernetesQueryContract, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const input = validateUnknown(query.inputSchema, body.input, `${query.id}.input`);
    const admission = await admit(options.authenticate, request, { kind: 'query', id: query.id, input });
    if (!await query.authorize({ principal: admission.principal, context: admission.trustedContext, input })) {
      throw new Error(`Application query ${query.id} is not authorized.`);
    }
    const result = await withTimeout(listSnapshot(objects, query, admission.trustedContext, input), query.budgets.timeoutMs, `Application query ${query.id} exceeded its execution budget.`);
    const output = validateUnknown(query.outputSchema, result.value, `${query.id}.output`);
    enforceOutputBudgets(query, output);
    const contextDigest = admittedContextDigest(options.cursorSecret, admission.trustedContext);
    const inputKey = stableInputKey(input);
    const cursor = signCursor(options.cursorSecret, {
      version: 1,
      kind: 'kubernetes-query',
      query: query.id,
      inputKey,
      principalId: admission.principal.id,
      contextDigest,
      authorizationVersion: admission.authorizationVersion,
      resourceVersion: result.resourceVersion,
      sequence: 0,
      expiresAt: now().getTime() + cursorTtlSeconds * 1_000,
    });
    const snapshot: ApplicationQuerySnapshot = {
      kind: 'snapshot',
      protocol: 'applik8s.query/v1alpha1',
      query: query.id,
      inputKey,
      value: output,
      cursor,
      capability: 'atomicSnapshotResume',
      generatedAt: now().toISOString(),
    };
    return json(snapshot, 200);
  }

  async function querySubscription(request: Request, query: Applik8sKubernetesQueryContract, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const input = validateUnknown(query.inputSchema, body.input, `${query.id}.input`);
    const admission = await admit(options.authenticate, request, { kind: 'query', id: query.id, input });
    if (!await query.authorize({ principal: admission.principal, context: admission.trustedContext, input })) {
      throw new Error(`Application query ${query.id} is not authorized.`);
    }
    const cursor = verifyCursor(options.cursorSecret, requiredString(body.cursor, 'cursor'), now().getTime());
    if (cursor.kind !== 'kubernetes-query' || cursor.query !== query.id || cursor.inputKey !== stableInputKey(input)) {
      throw new Error('Application query cursor is invalid.');
    }
    assertCursorIdentity(cursor, admission, options.cursorSecret);
    if (!subscriptions.acquire(admission.principal.id)) return json({ error: 'subscription_limit' }, 429, { 'retry-after': '5' });
    const stream = kubernetesSubscriptionStream({
      watch,
      query,
      input,
      context: admission.trustedContext,
      cursor,
      secret: options.cursorSecret,
      ttlSeconds: cursorTtlSeconds,
      maxSessionMs,
      now,
      release: () => subscriptions.release(admission.principal.id),
      track: (active) => {
        if (stopping) {
          active.abort();
          return () => undefined;
        }
        activeWatches.add(active);
        return () => activeWatches.delete(active);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  async function queryMultiplex(request: Request, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const raw = body.subscriptions;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxMultiplexSubscriptions) return json({ error: 'invalid_subscriptions' }, 400);
    const ids = new Set<string>();
    const requested: { readonly id: string; readonly query: string; readonly input: unknown; readonly cursor: string }[] = [];
    for (const value of raw) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'invalid_subscriptions' }, 400);
      const id = Reflect.get(value, 'id');
      const query = Reflect.get(value, 'query');
      const cursor = Reflect.get(value, 'cursor');
      if (typeof id !== 'string' || id.length < 1 || id.length > 128 || ids.has(id)) return json({ error: 'invalid_subscriptions' }, 400);
      if (typeof query !== 'string' || query.length < 1 || query.length > 512) return json({ error: 'invalid_subscriptions' }, 400);
      if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 16 * 1024 || !Reflect.has(value, 'input')) return json({ error: 'invalid_subscriptions' }, 400);
      ids.add(id);
      requested.push({ id, query, cursor, input: Reflect.get(value, 'input') });
    }
    const encoder = new TextEncoder();
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (frame: ApplicationQueryMultiplexFrame) => {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        };
        const pumps = requested.map(async (subscription) => {
          const query = queries.get(subscription.query);
          if (!query) {
            enqueue({ protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId: subscription.id, error: 'not_found' });
            return;
          }
          try {
            const response = await querySubscription(request, query, { input: subscription.input, cursor: subscription.cursor });
            if (!response.ok || !response.body) {
              enqueue({
                protocol: 'applik8s.query-multiplex/v1alpha1',
                kind: 'error',
                subscriptionId: subscription.id,
                error: response.status === 403 ? 'forbidden' : response.status === 429 ? 'subscription_limit' : response.status === 400 ? 'invalid_request' : 'internal_error',
                ...(response.status === 429 ? { retryAfterSeconds: 5 } : {}),
              });
              return;
            }
            const reader = response.body.getReader();
            readers.add(reader);
            try {
              for await (const payload of ssePayloads(reader, 64 * 1024)) {
                const event = JSON.parse(payload) as ApplicationQueryEvent;
                enqueue({ protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'event', subscriptionId: subscription.id, event });
              }
            } finally {
              readers.delete(reader);
              await reader.cancel().catch(() => undefined);
            }
          } catch (error) {
            if (!closed) enqueue({
              protocol: 'applik8s.query-multiplex/v1alpha1',
              kind: 'error',
              subscriptionId: subscription.id,
              error: /not authorized/i.test(error instanceof Error ? error.message : String(error)) ? 'forbidden' : /validation|cursor|required|namespace|limit/i.test(error instanceof Error ? error.message : String(error)) ? 'invalid_request' : 'internal_error',
            });
          }
        });
        void Promise.all(pumps).then(() => {
          if (closed) return;
          closed = true;
          controller.close();
        }).catch((error: unknown) => {
          if (closed) return;
          closed = true;
          controller.error(error);
        });
      },
      async cancel() {
        if (closed) return;
        closed = true;
        await Promise.allSettled([...readers].map((reader) => reader.cancel()));
        readers.clear();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' },
    });
  }
}

async function* ssePayloads(reader: ReadableStreamDefaultReader<Uint8Array>, maxEventBytes: number): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    if (new TextEncoder().encode(buffer).byteLength > maxEventBytes * 2) throw new Error('Kubernetes query multiplex SSE buffer exceeded its bound.');
    let boundary = /\r?\n\r?\n/.exec(buffer);
    while (boundary?.index !== undefined) {
      const block = buffer.slice(0, boundary.index).replaceAll('\r', '');
      buffer = buffer.slice(boundary.index + boundary[0].length);
      if (new TextEncoder().encode(block).byteLength > maxEventBytes) throw new Error('Kubernetes query multiplex SSE event exceeded its bound.');
      const payload = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (payload) yield payload;
      boundary = /\r?\n\r?\n/.exec(buffer);
    }
  }
}

async function listSnapshot(
  objects: CustomObjectsApi,
  query: Applik8sKubernetesQueryContract,
  context: Readonly<Record<string, unknown>>,
  input: unknown,
): Promise<{ readonly value: readonly unknown[]; readonly resourceVersion: string }> {
  const namespace = query.resource.scope === 'Namespaced'
    ? allowedNamespace(requiredString(query.fixedNamespace ?? query.namespace?.({ context, input }), 'query.namespace'), query.allowedNamespaces, query.id)
    : undefined;
  const labelSelector = query.labelSelector?.({ context, input });
  const fieldSelector = query.fieldSelector?.({ context, input });
  const items: KubernetesObject[] = [];
  let continueToken: string | undefined;
  let resourceVersion: string | undefined;
  let pages = 0;
  do {
    if (pages >= query.bounds.maxPages) throw new Error(`Application query ${query.id} exceeded ${query.bounds.maxPages} Kubernetes list pages.`);
    const page = await listObjects(objects, query.resource, namespace, {
      limit: query.bounds.pageSize,
      ...(continueToken ? { continueToken } : {}),
      ...(labelSelector ? { labelSelector } : {}),
      ...(fieldSelector ? { fieldSelector } : {}),
    });
    pages += 1;
    const pageVersion = requiredString(page.metadata.resourceVersion, 'metadata.resourceVersion');
    if (resourceVersion && pageVersion !== resourceVersion) throw new Error(`Application query ${query.id} Kubernetes pagination changed resourceVersion.`);
    resourceVersion = pageVersion;
    items.push(...page.items);
    if (items.length > query.bounds.maxItems) throw new Error(`Application query ${query.id} exceeded ${query.bounds.maxItems} Kubernetes objects.`);
    continueToken = page.metadata.continue ?? page.metadata._continue;
  } while (continueToken);
  const filtered = query.filter ? items.filter((value) => query.filter?.({ context, input, value })) : items;
  if (query.compare) filtered.sort((left, right) => query.compare?.({ context, input, left, right }) ?? 0);
  const requestedLimit = query.limit?.({ context, input });
  if (requestedLimit !== undefined && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 0 || requestedLimit > query.budgets.maxRows)) {
    throw new Error(`Application query ${query.id} limit must be between 0 and ${query.budgets.maxRows}.`);
  }
  const selected = requestedLimit === undefined ? filtered : filtered.slice(0, requestedLimit);
  return { value: selected.map((value) => query.project({ context, input, value })), resourceVersion: resourceVersion ?? '0' };
}

function kubernetesSubscriptionStream(options: {
  readonly watch: Watch;
  readonly query: Applik8sKubernetesQueryContract;
  readonly input: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly cursor: QueryCursor;
  readonly secret: string;
  readonly ttlSeconds: number;
  readonly maxSessionMs: number;
  readonly now: () => Date;
  readonly release: () => void;
  readonly track: (abort: AbortController) => () => void;
}): ReadableStream<Uint8Array> {
  let abort: AbortController | undefined;
  let untrack: () => void = () => undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    untrack();
    options.release();
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const namespace = options.query.resource.scope === 'Namespaced'
        ? allowedNamespace(
          requiredString(options.query.fixedNamespace ?? options.query.namespace?.({ context: options.context, input: options.input }), 'query.namespace'),
          options.query.allowedNamespaces,
          options.query.id,
        )
        : undefined;
      const labelSelector = options.query.labelSelector?.({ context: options.context, input: options.input });
      const fieldSelector = options.query.fieldSelector?.({ context: options.context, input: options.input });
      const path = watchPath(options.query.resource, namespace);
      let sequence = options.cursor.sequence;
      const deadline = setTimeout(() => abort?.abort(), options.maxSessionMs);
      const send = (event: ApplicationQueryEvent) => controller.enqueue(encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
      try {
        abort = await options.watch.watch(
          path,
          {
            resourceVersion: options.cursor.resourceVersion,
            allowWatchBookmarks: true,
            ...(labelSelector ? { labelSelector } : {}),
            ...(fieldSelector ? { fieldSelector } : {}),
          },
          (phase, raw) => {
            const object = raw as KubernetesObject & { readonly code?: number; readonly message?: string };
            const resourceVersion = String(object.metadata?.resourceVersion ?? options.cursor.resourceVersion);
            if (phase === 'ERROR') {
              if (Number(object.code) === 410) {
                send({ kind: 'reset', protocol: 'applik8s.query/v1alpha1', query: options.query.id, id: `${options.query.id}:reset:${options.now().getTime()}`, reason: 'providerReset' });
                abort?.abort();
                return;
              }
              controller.error(new Error(`Kubernetes watch failed with ${object.code ?? 'unknown'}: ${object.message ?? 'unknown error'}`));
              abort?.abort();
              return;
            }
            sequence += 1;
            const cursor = signCursor(options.secret, {
              ...options.cursor,
              resourceVersion,
              sequence,
              expiresAt: options.now().getTime() + options.ttlSeconds * 1_000,
            });
            if (phase === 'BOOKMARK') {
              send({ kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', query: options.query.id, id: `${options.query.id}:bookmark:${resourceVersion}`, cursor, sequence });
              return;
            }
            send({ kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', query: options.query.id, id: `${options.query.id}:${phase}:${resourceVersion}`, cursor, sequence, models: [options.query.model] });
          },
          (error) => {
            clearTimeout(deadline);
            release();
            if (error) controller.error(error);
            else controller.close();
          },
        );
        untrack = options.track(abort);
        if (released) {
          untrack();
          abort.abort();
        }
      } catch (error) {
        clearTimeout(deadline);
        release();
        controller.error(error);
      }
    },
    cancel() {
      abort?.abort();
      release();
    },
  });
}

async function listObjects(
  objects: CustomObjectsApi,
  resource: Applik8sKubernetesResourceContract,
  namespace: string | undefined,
  options: { readonly limit: number; readonly continueToken?: string; readonly labelSelector?: string; readonly fieldSelector?: string },
): Promise<KubernetesList> {
  const { group, version } = splitApiVersion(resource.apiVersion);
  const response = resource.scope === 'Namespaced'
    ? await objects.listNamespacedCustomObject({
        group,
        version,
        namespace: requiredString(namespace, 'namespace'),
        plural: resource.plural,
        allowWatchBookmarks: false,
        limit: options.limit,
        ...(options.continueToken ? { _continue: options.continueToken } : {}),
        ...(options.labelSelector ? { labelSelector: options.labelSelector } : {}),
        ...(options.fieldSelector ? { fieldSelector: options.fieldSelector } : {}),
      })
    : await objects.listClusterCustomObject({
        group,
        version,
        plural: resource.plural,
        allowWatchBookmarks: false,
        limit: options.limit,
        ...(options.continueToken ? { _continue: options.continueToken } : {}),
        ...(options.labelSelector ? { labelSelector: options.labelSelector } : {}),
        ...(options.fieldSelector ? { fieldSelector: options.fieldSelector } : {}),
      });
  return response as KubernetesList;
}

async function createObject(objects: CustomObjectsApi, resource: Applik8sKubernetesResourceContract, namespace: string | undefined, body: object): Promise<KubernetesObject> {
  const { group, version } = splitApiVersion(resource.apiVersion);
  const response = resource.scope === 'Namespaced'
    ? await objects.createNamespacedCustomObject({ group, version, namespace: requiredString(namespace, 'namespace'), plural: resource.plural, body, fieldManager: 'applik8s-application-host' })
    : await objects.createClusterCustomObject({ group, version, plural: resource.plural, body, fieldManager: 'applik8s-application-host' });
  return response as KubernetesObject;
}

async function getObject(objects: CustomObjectsApi, resource: Applik8sKubernetesResourceContract, namespace: string | undefined, name: string): Promise<KubernetesObject> {
  const { group, version } = splitApiVersion(resource.apiVersion);
  const response = resource.scope === 'Namespaced'
    ? await objects.getNamespacedCustomObject({ group, version, namespace: requiredString(namespace, 'namespace'), plural: resource.plural, name })
    : await objects.getClusterCustomObject({ group, version, plural: resource.plural, name });
  return response as KubernetesObject;
}

function watchPath(resource: Applik8sKubernetesResourceContract, namespace: string | undefined): string {
  const { group, version } = splitApiVersion(resource.apiVersion);
  return resource.scope === 'Namespaced'
    ? `/apis/${group}/${version}/namespaces/${requiredString(namespace, 'namespace')}/${resource.plural}`
    : `/apis/${group}/${version}/${resource.plural}`;
}

function splitApiVersion(apiVersion: string): { readonly group: string; readonly version: string } {
  const [group, version, extra] = apiVersion.split('/');
  if (!group || !version || extra) throw new Error(`Kubernetes application model apiVersion ${apiVersion} must contain group/version.`);
  return { group, version };
}

function defaultKubeConfig(): KubeConfig {
  const config = new KubeConfig();
  if (process.env.KUBERNETES_SERVICE_HOST) config.loadFromCluster();
  else config.loadFromDefault();
  return config;
}

async function admit(
  authenticate: Applik8sKubernetesGatewayOptions['authenticate'],
  request: Request,
  operation: { readonly kind: 'command' | 'query'; readonly id: string; readonly input: unknown },
): Promise<Applik8sGatewayAdmission> {
  const admission = await authenticate(request, operation);
  if (!admission?.principal?.id || !admission.authorizationVersion || !admission.trustedContext || typeof admission.trustedContext !== 'object') {
    throw new Error('Applik8s request identity provider returned an incomplete admission.');
  }
  return admission;
}

function validateObject(schema: JsonObject, value: unknown, name: string): object {
  const validated = validateUnknown(schema, value, name);
  if (!validated || typeof validated !== 'object' || Array.isArray(validated)) throw new Error(`${name} validation requires an object.`);
  return validated;
}

function validateUnknown(schema: JsonObject, value: unknown, name: string): unknown {
  const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: name }, schema }, name);
  const result = normalized.validate(value as never);
  if (!result.ok) throw new Error(`${name} validation failed: ${result.error.message}`);
  return result.value;
}

function enforceOutputBudgets(query: Applik8sKubernetesQueryContract, value: unknown): void {
  if (Array.isArray(value) && value.length > query.budgets.maxRows) throw new Error(`Application query ${query.id} exceeded maxRows ${query.budgets.maxRows}.`);
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > query.budgets.maxResultBytes) throw new Error(`Application query ${query.id} exceeded maxResultBytes ${query.budgets.maxResultBytes}.`);
}

function deterministicKubernetesName(
  placement: ReturnType<Applik8sKubernetesCreateContract['place']>,
  contextDigest: string,
  idempotencyKey: string,
): string {
  if (placement.name && placement.generateName) throw new Error('Kubernetes create placement cannot declare both name and generateName.');
  if (placement.name) return kubernetesName(placement.name);
  if (!placement.generateName) throw new Error('Kubernetes create placement requires name or generateName.');
  const prefix = kubernetesName(placement.generateName).replace(/-+$/g, '').slice(0, 42);
  const suffix = createHash('sha256').update(`${contextDigest}:${idempotencyKey}`).digest('hex').slice(0, 20);
  return `${prefix}-${suffix}`;
}

function modelSnapshot(object: KubernetesObject): { readonly identity: string; readonly value: unknown; readonly revision?: string } {
  return {
    identity: object.metadata.name,
    value: object.spec,
    ...(object.metadata.resourceVersion ? { revision: object.metadata.resourceVersion } : {}),
  };
}

function reconciliationState(object: KubernetesObject): 'notObserved' | 'progressing' | 'ready' | 'failed' {
  const phase = object.status && typeof object.status === 'object' ? Reflect.get(object.status, 'phase') : undefined;
  if (phase === 'Ready' || phase === 'Published' || phase === 'Succeeded') return 'ready';
  if (phase === 'Failed' || phase === 'Rejected' || phase === 'Degraded') return 'failed';
  return object.status ? 'progressing' : 'notObserved';
}

function admittedContextDigest(secret: string, context: Readonly<Record<string, unknown>>): string {
  return createHmac('sha256', secret).update(stableJson(context)).digest('base64url');
}

function assertCursorIdentity(cursor: GatewayCursor, admission: Applik8sGatewayAdmission, secret: string): void {
  if (
    cursor.principalId !== admission.principal.id
    || cursor.authorizationVersion !== admission.authorizationVersion
    || cursor.contextDigest !== admittedContextDigest(secret, admission.trustedContext)
  ) throw new Error('Application cursor identity is invalid.');
}

function signCursor(secret: string, cursor: GatewayCursor): string {
  const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function verifyCursor(secret: string, value: string, currentTime: number): GatewayCursor {
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra) throw new Error('Application cursor is invalid.');
  const expected = createHmac('sha256', secret).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Application cursor is invalid.');
  const cursor = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GatewayCursor;
  if (cursor.version !== 1 || cursor.expiresAt < currentTime) throw new Error('Application cursor is invalid or expired.');
  return cursor;
}

function subscriptionLimiter(limits: { readonly perPrincipal: number; readonly total: number }) {
  if (!Number.isSafeInteger(limits.perPrincipal) || !Number.isSafeInteger(limits.total) || limits.perPrincipal < 1 || limits.total < limits.perPrincipal) {
    throw new Error('Applik8s Kubernetes gateway subscription limits are invalid.');
  }
  const active = new Map<string, number>();
  let total = 0;
  return {
    acquire(principal: string) {
      const principalCount = active.get(principal) ?? 0;
      if (principalCount >= limits.perPrincipal || total >= limits.total) return false;
      active.set(principal, principalCount + 1);
      total += 1;
      return true;
    },
    release(principal: string) {
      const principalCount = active.get(principal) ?? 0;
      if (principalCount < 1 || total < 1) return;
      if (principalCount === 1) active.delete(principal);
      else active.set(principal, principalCount - 1);
      total -= 1;
    },
  };
}

function uniqueById<T extends { readonly id: string }>(values: readonly T[], kind: string): Map<string, T> {
  const result = new Map(values.map((value) => [value.id, value]));
  if (result.size !== values.length) throw new Error(`Applik8s Kubernetes gateway ${kind} ids must be unique.`);
  return result;
}

async function boundedJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) };
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ok: true, value: value as Readonly<Record<string, unknown>> }
      : { ok: false, response: json({ error: 'invalid_json' }, 400) };
  } catch {
    return { ok: false, response: json({ error: 'invalid_json' }, 400) };
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value;
}

function allowedNamespace(namespace: string, allowed: readonly string[] | undefined, operation: string): string {
  if (!allowed || allowed.includes(namespace)) return namespace;
  throw new Error(`Application operation ${operation} resolved namespace ${namespace}, which is outside its declared namespace boundary.`);
}

function normalizeBasePath(value: string): string {
  const normalized = `/${value.split('/').filter(Boolean).join('/')}`;
  if (normalized === '/') throw new Error('Applik8s Kubernetes gateway basePath must not be root.');
  return normalized;
}

function stableInputKey(value: unknown): string {
  return Buffer.from(stableJson(value)).toString('base64url');
}

function stableJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function kubernetesName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!normalized) throw new Error('Kubernetes create placement produced an empty name.');
  return normalized.slice(0, 63).replace(/[^a-z0-9]+$/g, '');
}

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = Reflect.get(error, 'response');
  return response && typeof response === 'object' ? Number(Reflect.get(response, 'statusCode') ?? Reflect.get(response, 'status')) : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
