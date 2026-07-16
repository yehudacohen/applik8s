import type { ApplicationMessageContractSchema, ApplicationProviderNode, ApplicationProviderRef, ApplicationRetryPolicy, JsonObject, JsonValue } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk';
import type { SchemaInput } from '@applik8s/sdk';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import type { ApplicationProjectionStoreProvider, ApplicationProviderState } from './application-providers.js';
import { applicationProviderImplementationName, isClickHouseProjectionStoreProvider } from './application-providers.js';
import type { ApplicationQueryBinding, ApplicationQueryPrincipal } from './application-queries.js';
import type { ApplicationDatabaseBinding } from './application.js';
import type { ApplicationModelCommandBinding } from './application-models.js';
import { serializeApplicationCallback } from './application-callback.js';
import type { StreamDefinition } from './dsl.js';
import { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler } from './query-gateway.js';
import type { ApplicationQueryGateway, ApplicationQueryGatewayHttpOptions, ApplicationQueryGatewayOptions as ApplicationQueryGatewayRuntimeOptions } from './query-gateway.js';

interface ApplicationReactiveState extends ApplicationGraphState, ApplicationProviderState {}

export interface ApplicationStreamOptions<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly database: ApplicationDatabaseBinding;
  readonly retention: { readonly maxAgeSeconds: number; readonly maxMessages?: number };
  readonly partitionBy: (payload: TPayload) => string;
  readonly authorize: (request: { readonly principal: TPrincipal; readonly action: 'read' | 'replay' }) => boolean | Promise<boolean>;
  readonly authority?: 'postgres-outbox';
  readonly replay?: 'supported';
}

export interface ApplicationStreamBinding<TPayload extends object = object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly kind: 'applicationStream';
  readonly definition: StreamDefinition<TPayload>;
  readonly retention: ApplicationStreamOptions<TPayload, TPrincipal>['retention'];
  readonly authority: 'postgres-outbox' | 'kubernetes-watch' | 'provider';
  readonly replay: 'supported' | 'reset-only';
  readonly database: ApplicationDatabaseBinding;
  partition(payload: TPayload): string;
  authorize(principal: TPrincipal, action: 'read' | 'replay'): Promise<boolean>;
}

export interface ApplicationSubscriptionOptions<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly source: ApplicationStreamBinding | ApplicationQueryBinding;
  readonly delivery?: 'polling' | 'sse';
  readonly authorize: (request: { readonly principal: TPrincipal }) => boolean | Promise<boolean>;
  readonly retry?: { readonly maxAttempts?: number; readonly initialDelayMs?: number; readonly maxDelayMs?: number };
}

export interface ApplicationSubscriptionBinding<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly kind: 'applicationSubscription';
  readonly name: string;
  readonly source: ApplicationSubscriptionOptions<TPrincipal>['source'];
  authorize(principal: TPrincipal): Promise<boolean>;
}

export interface ApplicationProjectionOptions<TPayload extends object, TRow extends object> {
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly output: SchemaInput<TRow>;
  readonly provider?: ApplicationProjectionStoreProvider;
  readonly checkpoint?: 'idempotent';
  readonly rebuildable?: boolean;
  readonly project: (payload: TPayload, event: { readonly id: string; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
}

export interface ApplicationProjectionBinding<TPayload extends object = object, TRow extends object = object> {
  readonly kind: 'applicationProjection';
  readonly name: string;
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly provider: ApplicationProjectionStoreProvider;
  readonly output: SchemaInput<TRow>;
  readonly project: ApplicationProjectionOptions<TPayload, TRow>['project'];
}

export interface ApplicationGatewayOptions {
  readonly queries?: readonly ApplicationQueryBinding[];
  readonly commands?: readonly ApplicationModelCommandBinding[];
  readonly subscriptions?: readonly ApplicationSubscriptionBinding[];
  readonly authorizeCommand?: (request: { readonly principal: ApplicationQueryPrincipal; readonly command: string; readonly input: unknown }) => boolean | Promise<boolean>;
  readonly basePath?: string;
  readonly subscriptionLimits?: { readonly perPrincipal?: number; readonly total?: number };
  readonly deployment?: {
    readonly namespace: string;
    readonly authenticate: (request: Request) => ApplicationGatewayAdmission | Promise<ApplicationGatewayAdmission>;
    readonly cursorSecret: { readonly apiVersion?: string; readonly kind?: string; readonly name: string; readonly key: string; readonly namespace?: string };
    readonly image?: string;
    readonly replicas?: number;
    readonly port?: number;
  };
}

export interface ApplicationGatewayAdmission {
  readonly principal: ApplicationQueryPrincipal;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly authorizationVersion: string;
}

export interface ApplicationGatewayBinding {
  readonly kind: 'applicationGateway';
  readonly name: string;
  readonly queries: readonly ApplicationQueryBinding[];
  readonly commands: readonly ApplicationModelCommandBinding[];
  readonly subscriptions: readonly ApplicationSubscriptionBinding[];
  readonly basePath: string;
  runtime<TRequest, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: Omit<ApplicationQueryGatewayRuntimeOptions<TRequest, TPrincipal>, 'queries' | 'subscriptionLimits'>): ApplicationQueryGateway<TRequest>;
  httpHandler<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: Omit<ApplicationQueryGatewayRuntimeOptions<Request, TPrincipal>, 'queries' | 'subscriptionLimits'>, http?: Omit<ApplicationQueryGatewayHttpOptions, 'basePath'>): (request: Request) => Promise<Response>;
}

export function registerApplicationStream<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal>(state: ApplicationReactiveState, definition: StreamDefinition<TPayload>, options: ApplicationStreamOptions<TPayload, TPrincipal>): ApplicationStreamBinding<TPayload, TPrincipal> {
  const nodeId = reactiveNodeId('stream', definition.id);
  if (state.graphNodes.some((node) => node.id === nodeId)) throw new Error(`Application stream ${definition.id} is already registered.`);
  if (!Number.isSafeInteger(options.retention.maxAgeSeconds) || options.retention.maxAgeSeconds < 1) throw new Error(`Application stream ${definition.id} maxAgeSeconds must be a positive safe integer.`);
  if (options.retention.maxMessages !== undefined && (!Number.isSafeInteger(options.retention.maxMessages) || options.retention.maxMessages < 1)) throw new Error(`Application stream ${definition.id} maxMessages must be a positive safe integer when declared.`);
  if (options.authority && options.authority !== 'postgres-outbox') throw new Error(`Application stream ${definition.id} supports only postgres-outbox authority in v0.6.`);
  if (options.replay && options.replay !== 'supported') throw new Error(`Application stream ${definition.id} supports only durable replay in v0.6.`);
  if (options.database.provider.kind !== 'postgres') throw new Error(`Application stream ${definition.id} requires a PostgreSQL database binding.`);
  const payload = declaredSchema(definition.payload, `${definition.id}.payload`);
  // typecast: callback serialization erases generic payload names after the declared payload schema establishes their runtime shape.
  const partition = serializeApplicationCallback({ registrar: 'stream', argumentIndex: 1, property: 'partitionBy', label: `Application stream ${definition.id} partition`, callback: options.partitionBy as (...args: never[]) => unknown, allowDeferredResolution: true });
  // typecast: authorization input is reconstructed by the generated gateway and checked against the stream's declared principal boundary.
  const authorization = serializeApplicationCallback({ registrar: 'stream', argumentIndex: 1, property: 'authorize', label: `Application stream ${definition.id} authorization`, callback: options.authorize as (...args: never[]) => unknown, allowDeferredResolution: true });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'stream',
    name: definition.name,
    version: definition.version,
    stability: 'stable',
    payload,
    authority: 'postgres-outbox',
    delivery: 'at-least-once',
    replay: 'supported',
    retention: options.retention,
    partitioning: 'declared',
    compatibility: 'versioned-schema',
    authorization: 'application-defined',
    database: reactiveDatabaseRuntime(options.database),
    partitionSource: partition.source,
    ...(partition.dependencies ? { partitionDependencies: partition.dependencies } : {}),
    ...(partition.unresolved ? { partitionUnresolved: partition.unresolved } : {}),
    authorizationSource: authorization.source,
    ...(authorization.dependencies ? { authorizationDependencies: authorization.dependencies } : {}),
    ...(authorization.unresolved ? { authorizationUnresolved: authorization.unresolved } : {}),
  });
  return {
    kind: 'applicationStream',
    definition,
    retention: options.retention,
    authority: 'postgres-outbox',
    replay: 'supported',
    database: options.database,
    partition(payloadValue) {
      const validated = validateSchema(definition.payload, payloadValue, `${definition.id}.payload`);
      const partition = options.partitionBy(validated);
      if (!partition.trim()) throw new Error(`Application stream ${definition.id} partition key must not be empty.`);
      return partition;
    },
    async authorize(principal, action) {
      return options.authorize({ principal, action });
    },
  };
}

export function registerApplicationSubscription<TPrincipal extends ApplicationQueryPrincipal>(state: ApplicationReactiveState, name: string, options: ApplicationSubscriptionOptions<TPrincipal>): ApplicationSubscriptionBinding<TPrincipal> {
  const nodeId = reactiveNodeId('subscription', name);
  const source = sourceNodeRef(options.source);
  if (!state.graphNodes.some((node) => node.id === source.nodeId)) throw new Error(`Application subscription ${name} references a source that is not registered in this app.`);
  const retry = { mode: 'boundedExponentialBackoff', maxAttempts: options.retry?.maxAttempts ?? 5, initialDelayMs: options.retry?.initialDelayMs ?? 250, maxDelayMs: options.retry?.maxDelayMs ?? 30_000, factor: 2 } satisfies ApplicationRetryPolicy;
  if ((retry.maxAttempts ?? 0) < 1 || (retry.initialDelayMs ?? 0) < 1 || (retry.maxDelayMs ?? 0) < (retry.initialDelayMs ?? 0)) throw new Error(`Application subscription ${name} has invalid retry bounds.`);
  // typecast: the generated subscription gateway reconstructs the declared principal boundary after authenticating each request.
  const authorization = serializeApplicationCallback({ registrar: 'subscription', argumentIndex: 1, property: 'authorize', label: `Application subscription ${name} authorization`, callback: options.authorize as (...args: never[]) => unknown, allowDeferredResolution: true });
  addApplicationGraphNode(state, { id: nodeId, kind: 'subscription', name, stability: 'stable', source, delivery: options.delivery ?? 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: authorization.source, ...(authorization.dependencies ? { authorizationDependencies: authorization.dependencies } : {}), ...(authorization.location ? { authorizationLocation: authorization.location } : {}), ...(authorization.unresolved ? { authorizationUnresolved: authorization.unresolved } : {}), retry, suspension: 'bounded-failures' });
  addApplicationGraphEdge(state, { from: { nodeId }, to: source, relationship: 'reads' });
  return { kind: 'applicationSubscription', name, source: options.source, async authorize(principal) { return options.authorize({ principal }); } };
}

export function registerApplicationProjection<TPayload extends object, TRow extends object>(state: ApplicationReactiveState, name: string, options: ApplicationProjectionOptions<TPayload, TRow>): ApplicationProjectionBinding<TPayload, TRow> {
  const provider = options.provider ?? projectionProvider(state);
  const providerNode = recordProjectionProvider(state, provider);
  const nodeId = reactiveNodeId('projection', name);
  const source = sourceNodeRef(options.source);
  if (options.checkpoint && options.checkpoint !== 'idempotent') throw new Error(`Application projection ${name} supports only idempotent ClickHouse checkpoints in v0.6.`);
  // typecast: projection output is validated against the declared schema before provider writes.
  const handler = serializeApplicationCallback({ registrar: 'projection', argumentIndex: 1, property: 'project', label: `Application projection ${name}`, callback: options.project as (...args: never[]) => unknown, allowDeferredResolution: true });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'projection',
    name,
    stability: 'stable',
    source,
    provider: providerNode,
    rebuildable: options.rebuildable ?? true,
    checkpoint: 'idempotent',
    output: declaredSchema(options.output, `${name}.output`),
    eventIdentity: 'stable-source-event-id',
    duplicateHandling: 'idempotent',
    rebuild: 'full-replay',
    handlerSource: handler.source,
    ...(handler.dependencies ? { handlerDependencies: handler.dependencies } : {}),
    ...(handler.location ? { handlerLocation: handler.location } : {}),
    ...(handler.unresolved ? { handlerUnresolved: handler.unresolved } : {}),
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: source, relationship: 'reads' });
  addApplicationGraphEdge(state, { from: providerNode, to: { nodeId }, relationship: 'provides' });
  const requirement = `projection-store.${reactiveName(name)}`;
  addApplicationProviderRequirement(state, { id: requirement, interface: 'ProjectionStore', consumer: { nodeId }, provider: providerNode, required: true, purpose: 'projectionStore', diagnostics: { missing: `Projection ${name} requires a ProjectionStore provider.`, ambiguous: `Projection ${name} has multiple ProjectionStore providers.` } });
  addApplicationProviderBinding(state, { requirement, provider: providerNode, generatedResources: [], runtime: {}, metadataLinks: [] });
  return { kind: 'applicationProjection', name, source: options.source, provider, output: options.output, project: options.project };
}

export function registerApplicationGateway(state: ApplicationReactiveState, name: string, options: ApplicationGatewayOptions): ApplicationGatewayBinding {
  const queries = options.queries ?? [];
  const subscriptions = options.subscriptions ?? [];
  if (queries.length + (options.commands?.length ?? 0) + subscriptions.length === 0) throw new Error(`Application gateway ${name} must expose at least one query, command, or subscription.`);
  const queryRefs = queries.map((query) => ({ nodeId: reactiveNodeId('query', query.id) }));
  for (const query of queryRefs) if (!state.graphNodes.some((node) => node.id === query.nodeId && node.kind === 'query')) throw new Error(`Application gateway ${name} references unregistered query ${query.nodeId}.`);
  const basePath = `/${(options.basePath ?? 'queries').replace(/^\/+|\/+$/g, '')}`;
  const limits = { perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20, total: options.subscriptionLimits?.total ?? 1_000 };
  if (limits.perPrincipal < 1 || limits.total < limits.perPrincipal) throw new Error(`Application gateway ${name} has invalid subscription limits.`);
  const nodeId = reactiveNodeId('gateway', name);
  const commandRefs = (options.commands ?? []).map((command) => {
    const handler = state.graphNodes.find((node) => node.kind === 'commandHandler' && node.name === command.name);
    if (handler?.kind !== 'commandHandler') throw new Error(`Application gateway ${name} references command binding ${command.name}, but its command handler is not registered in this app.`);
    return { handler: { nodeId: handler.id }, command: handler.command };
  });
  const subscriptionRefs = subscriptions.map((subscription) => ({ nodeId: reactiveNodeId('subscription', subscription.name) }));
  for (const subscription of subscriptionRefs) if (!state.graphNodes.some((node) => node.id === subscription.nodeId && node.kind === 'subscription')) throw new Error(`Application gateway ${name} references unregistered subscription ${subscription.nodeId}.`);
  if (commandRefs.length > 0 && !options.authorizeCommand) throw new Error(`Application gateway ${name} exposes commands and must declare authorizeCommand.`);
  const deployment = options.deployment;
  if (deployment?.cursorSecret.namespace && deployment.cursorSecret.namespace !== deployment.namespace) throw new Error(`Application gateway ${name} cannot mount cursor Secret from another namespace.`);
  // typecast: generated authentication receives the standard Request boundary and returns the declared gateway identity contract.
  const authentication = deployment ? serializeApplicationCallback({ registrar: 'gateway', argumentIndex: 1, property: 'authenticate', label: `Application gateway ${name} authentication`, callback: deployment.authenticate as (...args: never[]) => unknown, allowDeferredResolution: true }) : undefined;
  // typecast: generated command admission receives a schema-validated command input and the gateway-established principal.
  const commandAuthorization = options.authorizeCommand ? serializeApplicationCallback({ registrar: 'gateway', argumentIndex: 1, property: 'authorizeCommand', label: `Application gateway ${name} command authorization`, callback: options.authorizeCommand as (...args: never[]) => unknown, allowDeferredResolution: true }) : undefined;
  addApplicationGraphNode(state, {
    id: nodeId, kind: 'gateway', name, stability: 'stable', queries: queryRefs, commands: commandRefs, subscriptions: subscriptionRefs, transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: limits, routes: { snapshots: `${basePath}/:query/snapshot`, subscriptions: `${basePath}/:query/subscribe`, streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation',
    materialization: deployment ? 'generatedDeployment' : 'runtimeOnly',
    ...(authentication ? { authenticationSource: authentication.source } : {}),
    ...(authentication?.dependencies ? { authenticationDependencies: authentication.dependencies } : {}),
    ...(authentication?.location ? { authenticationLocation: authentication.location } : {}),
    ...(authentication?.unresolved ? { authenticationUnresolved: authentication.unresolved } : {}),
    ...(commandAuthorization ? { commandAuthorizationSource: commandAuthorization.source } : {}),
    ...(commandAuthorization?.dependencies ? { commandAuthorizationDependencies: commandAuthorization.dependencies } : {}),
    ...(commandAuthorization?.location ? { commandAuthorizationLocation: commandAuthorization.location } : {}),
    ...(commandAuthorization?.unresolved ? { commandAuthorizationUnresolved: commandAuthorization.unresolved } : {}),
    ...(deployment ? {
      cursorSecret: { apiVersion: deployment.cursorSecret.apiVersion ?? 'v1', kind: deployment.cursorSecret.kind ?? 'Secret', name: deployment.cursorSecret.name, ...(deployment.cursorSecret.namespace ? { namespace: deployment.cursorSecret.namespace } : {}), key: deployment.cursorSecret.key },
      deployment: { namespace: deployment.namespace, image: deployment.image ?? 'node:22-alpine', replicas: deployment.replicas ?? 1, port: deployment.port ?? 8080 },
    } : {}),
  });
  for (const query of queryRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: query, relationship: 'exposes' });
  for (const command of commandRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: command.command, relationship: 'exposes' });
  for (const subscription of subscriptionRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: subscription, relationship: 'exposes' });
  return {
    kind: 'applicationGateway', name, queries, commands: options.commands ?? [], subscriptions, basePath,
    runtime(runtimeOptions) {
      return createApplicationQueryGateway({ ...runtimeOptions, queries, subscriptionLimits: limits });
    },
    httpHandler(runtimeOptions, httpOptions = {}) {
      const runtime = createApplicationQueryGateway({ ...runtimeOptions, queries, subscriptionLimits: limits });
      return createApplicationQueryGatewayHttpHandler(runtime, { ...httpOptions, basePath: basePath.slice(1) });
    },
  };
}

function reactiveDatabaseRuntime(binding: ApplicationDatabaseBinding): { readonly name: string; readonly connectionEnvName: string; readonly secretName: string; readonly secretKey: string; readonly secretNamespace?: string; readonly access?: { readonly context: string; readonly contextSchema: JsonObject; readonly setting: string; readonly column: string } } {
  const provider = binding.provider;
  const clusterName = provider.name ?? `${reactiveName(binding.name)}-db`;
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return { name: binding.name, connectionEnvName: `APPLIK8S_DATABASE_${reactiveName(binding.name).replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_URL`, secretName: secret.name ?? `${clusterName}-app`, secretKey: provider.connectionSecretKey ?? 'uri', ...(secret.namespace ?? provider.namespace ? { secretNamespace: secret.namespace ?? provider.namespace } : {}), ...(binding.access ? { access: { context: binding.access.context.name, contextSchema: binding.access.context.contract.jsonSchema, setting: binding.access.setting, column: binding.access.column } } : {}) };
}

function projectionProvider(state: ApplicationReactiveState): ApplicationProjectionStoreProvider {
  const provider = state.providers.projections ?? state.defaults.projections;
  if (!isClickHouseProjectionStoreProvider(provider)) throw new Error('app.projection(...) requires a ClickHouse ProjectionStore provider. Bind ProjectionStore.clickhouse(...) with app.provide or app.defaults.');
  return provider;
}

function recordProjectionProvider(state: ApplicationReactiveState, provider: ApplicationProjectionStoreProvider): ApplicationProviderRef<'ProjectionStore'> {
  if (!isClickHouseProjectionStoreProvider(provider)) throw new Error('The v0.6 ProjectionStore implementation must be ClickHouse.');
  if (provider.credentialsSecret && !provider.credentialsSecret.name) throw new Error('ClickHouse ProjectionStore credentialsSecret must declare a Secret name.');
  const nodeId = 'provider.projection-store';
  const node: ApplicationProviderNode<'ProjectionStore'> = {
    id: nodeId,
    kind: 'provider',
    name: 'ProjectionStore',
    stability: 'stable',
    interface: 'ProjectionStore',
    implementation: applicationProviderImplementationName(provider),
    contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'ProjectionStore', version: 'v1alpha1', requirements: ['replayableSource'], guarantees: ['idempotentInsert', 'checkpoint', 'fullRebuild'], implementation: { name: 'clickhouse' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    config: { provider: 'clickhouse', name: provider.name ?? 'applik8s-analytics', namespace: provider.namespace ?? 'applik8s-analytics', provision: provider.provision ?? true, endpoint: provider.endpoint ?? `http://clickhouse-${provider.name ?? 'applik8s-analytics'}.${provider.namespace ?? 'applik8s-analytics'}.svc.cluster.local:8123`, database: provider.database ?? 'default', ...(provider.credentialsSecret?.name ? { credentialsSecret: { apiVersion: provider.credentialsSecret.apiVersion, kind: provider.credentialsSecret.kind, name: provider.credentialsSecret.name, ...(provider.credentialsSecret.namespace ? { namespace: provider.credentialsSecret.namespace } : {}) }, usernameKey: provider.usernameKey ?? 'username', passwordKey: provider.passwordKey ?? 'password' } : {}) },
  };
  addApplicationGraphNode(state, node);
  return { interface: 'ProjectionStore', nodeId };
}

function sourceNodeRef(source: ApplicationStreamBinding | ApplicationQueryBinding): { readonly nodeId: string } {
  return source.kind === 'applicationStream' ? { nodeId: reactiveNodeId('stream', source.definition.id) } : { nodeId: reactiveNodeId('query', source.id) };
}

function declaredSchema<TValue extends object>(schema: SchemaInput<TValue>, name: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(schema, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`applik8s-reactive-schema-unsupported: ${name}: ${emitted.error.message}`);
  // typecast: normalizeSchema emitted the core JsonObject contract on the successful branch.
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema as JsonObject };
}

function validateSchema<TValue extends object>(schema: SchemaInput<TValue>, value: unknown, name: string): TValue {
  // typecast: the schema adapter performs runtime validation at this public stream boundary.
  const result = normalizeSchema(schema, name).validate(value as JsonValue);
  if (!result.ok) throw new Error(`applik8s-reactive-schema-invalid: ${name}: ${result.error.message}`);
  return result.value;
}

function reactiveNodeId(kind: string, name: string): string {
  return `${kind}.${reactiveName(name)}`;
}

function reactiveName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}
