// typecast-file-boundary: schema-normalized streams, projections, and subscriptions cross erased graph registries and regain declaration-time generics by stable IDs.

import type { ApplicationOperationLike } from '@applik8s/client';
import type { ApplicationMessageContractSchema, ApplicationProviderNode, ApplicationProviderRef, ApplicationRetryPolicy, JsonObject, JsonValue } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk';
import type { ApplicationDatabaseBinding } from './application.js';
import { serializeApplicationCallback } from './application-callback.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import type { ApplicationModelCommandBinding } from './application-models.js';
import { type ApplicationProcessorOptions, normalizeApplicationProcessorOptions } from './application-processor-policy.js';
import type { ApplicationIndexBackend, ApplicationIndexStoreProviderToken, ApplicationProjectionStoreProvider, ApplicationProviderState } from './application-providers.js';
import { applicationIndexBackend, applicationProviderImplementationName, defaultApplicationIndexProvider, IndexStore, isClickHouseProjectionStoreProvider } from './application-providers.js';
import type { ApplicationQueryBinding, ApplicationQueryPrincipal } from './application-queries.js';
import { applicationQueryBindingForOperation } from './application-queries.js';
import { applicationTypeKroSerializedValue, applicationTypeKroString } from './application-typekro-values.js';
import { type ApplicationTaskBinding, type ApplicationWorkflowBinding, type ApplicationWorkflowState, recordApplicationWorkflowEngine } from './application-workflows.js';
import type { EventDefinition, StreamDefinition } from './dsl.js';
import { applicationModelCommandBindingForOperation, applicationModelFacet, type CommonApplicationModelFacet, getApplicationModelFacet } from './native-models.js';
import type { ApplicationQueryGateway, ApplicationQueryGatewayHttpOptions, ApplicationQueryGatewayOptions as ApplicationQueryGatewayRuntimeOptions } from './query-gateway.js';
import { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler } from './query-gateway.js';
import type { ApplicationWorkflowInvocationMetadata, ApplicationWorkflowScheduleResult } from './workflow-runtime.js';

interface ApplicationReactiveState extends ApplicationGraphState, ApplicationProviderState {}

export type ApplicationStreamScheduleTargets = Readonly<Record<string, ApplicationTaskBinding<object, object> | ApplicationWorkflowBinding<object, object>>>;

export type ApplicationStreamTaskTargets = Readonly<Record<string, ApplicationTaskBinding<object, object>>>;

export type ApplicationStreamTaskFunctions<TTargets extends ApplicationStreamTaskTargets> = {
  readonly [TAlias in keyof TTargets]: TTargets[TAlias] extends ApplicationTaskBinding<infer TInput, infer TOutput>
    ? (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) => Promise<TOutput>
    : never;
};

export type ApplicationStreamScheduleFunctions<TTargets extends ApplicationStreamScheduleTargets> = {
  readonly [TAlias in keyof TTargets]: {
    reconcile(
      schedule: {
        readonly id: string;
        readonly expression: string;
        readonly revision: string;
        readonly enabled: boolean;
        readonly input: TTargets[TAlias] extends ApplicationTaskBinding<infer TInput, object>
          ? TInput
          : TTargets[TAlias] extends ApplicationWorkflowBinding<infer TInput, object>
            ? TInput
            : never;
      },
      metadata?: ApplicationWorkflowInvocationMetadata,
    ): Promise<ApplicationWorkflowScheduleResult>;
  };
};

interface ApplicationStreamRegistrars<TPayload extends object> {
  project<TRow extends object>(name: string, options: Omit<ApplicationAnalyticalProjectionOptions<TPayload, TRow>, 'source'>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
  project<TRow extends object, TValue extends object, TSnapshot extends object = object>(name: string, options: Omit<ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>, 'source'>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  subscribe<TSubscriberPrincipal extends ApplicationQueryPrincipal>(name: string, options: Omit<ApplicationSubscriptionOptions<TSubscriberPrincipal>, 'source'>): ApplicationSubscriptionBinding<TSubscriberPrincipal>;
  process<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(name: string, options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
}

export interface ApplicationStreamOptions<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly database: ApplicationDatabaseBinding;
  readonly retention: { readonly maxAgeSeconds: number; readonly maxMessages?: number };
  readonly partitionBy: (payload: TPayload) => string;
  readonly authorize: (request: { readonly principal: TPrincipal; readonly action: 'read' | 'replay' }) => boolean | Promise<boolean>;
  readonly authority?: 'postgres-outbox';
  readonly replay?: 'supported';
}

/** A committed domain event can be promoted directly to a durable replay stream without redeclaring its payload. */
export type ApplicationReplayDefinition<TPayload extends object> = EventDefinition<TPayload> | StreamDefinition<TPayload>;

export interface ApplicationStreamBinding<TPayload extends object = object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly kind: 'applicationStream';
  readonly definition: ApplicationReplayDefinition<TPayload>;
  readonly retention: ApplicationStreamOptions<TPayload, TPrincipal>['retention'];
  readonly authority: 'postgres-outbox' | 'kubernetes-watch' | 'provider';
  readonly replay: 'supported' | 'reset-only';
  readonly database: ApplicationDatabaseBinding;
  partition(payload: TPayload): string;
  authorize(principal: TPrincipal, action: 'read' | 'replay'): Promise<boolean>;
  /** Declares a derived store directly from this stream while retaining app.projection compatibility. */
  project<TRow extends object>(name: string, options: Omit<ApplicationAnalyticalProjectionOptions<TPayload, TRow>, 'source'>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
  project<TRow extends object, TValue extends object, TSnapshot extends object = object>(name: string, options: Omit<ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>, 'source'>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  /** Declares an authorized client delivery directly from this stream. */
  subscribe<TSubscriberPrincipal extends ApplicationQueryPrincipal = TPrincipal>(name: string, options: Omit<ApplicationSubscriptionOptions<TSubscriberPrincipal>, 'source'>): ApplicationSubscriptionBinding<TSubscriberPrincipal>;
  /** Declares bounded durable backend work over this replayable stream. */
  process<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(name: string, options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
}

export interface ApplicationStreamProcessOptions<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  /** Installation-derived condition controlling processor materialization. */
  readonly enabled?: boolean;
  readonly processor?: ApplicationProcessorOptions;
  readonly retry?: { readonly maxAttempts?: number; readonly initialDelayMs?: number; readonly maxDelayMs?: number; readonly deadLetter?: boolean };
  readonly budgets?: { readonly timeoutMs?: number; readonly maxInputBytes?: number };
  /** Provider-neutral recurring schedules this handler may converge. */
  readonly schedules?: TSchedules;
	/** Provider-neutral one-shot durable tasks this handler may invoke. */
	readonly tasks?: TTasks;
}

export interface ApplicationStreamProcessContext<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  readonly event: {
    readonly id: string;
    readonly stream: { readonly name: string; readonly version: string };
    readonly sequence: number;
    readonly recordedAt: string;
    readonly partitionKey: string;
    /** Opaque scope proving which admitted context produced the committed fact. */
    readonly contextDigest?: string;
  };
  /** Gateway-established actor captured durably with the committed fact. */
  readonly principal?: import('./command-principal.js').ApplicationCommandPrincipal;
  /** Provider-admitted values captured with the command; reserved identity keys are removed. */
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly schedules: ApplicationStreamScheduleFunctions<TSchedules>;
	readonly tasks: ApplicationStreamTaskFunctions<TTasks>;
}

export type ApplicationStreamProcessHandler<TPayload extends object, TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> = (payload: TPayload, context: ApplicationStreamProcessContext<TSchedules, TTasks>) => void | Promise<void>;

export interface ApplicationStreamProcessorBinding<TPayload extends object = object, TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  readonly kind: 'applicationStreamProcessor';
  readonly name: string;
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>;
  readonly options: ApplicationStreamProcessOptions<TSchedules, TTasks>;
}

export interface ApplicationSubscriptionOptions<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly source: ApplicationReactiveSourceBinding;
  readonly delivery?: 'polling' | 'sse';
  readonly authorize: (request: { readonly principal: TPrincipal }) => boolean | Promise<boolean>;
  readonly retry?: { readonly maxAttempts?: number; readonly initialDelayMs?: number; readonly maxDelayMs?: number };
}

export type ApplicationReactiveSourceBinding = Pick<ApplicationStreamBinding, 'kind' | 'definition'> | ApplicationQueryBinding;

export interface ApplicationSubscriptionBinding<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly kind: 'applicationSubscription';
  readonly name: string;
  readonly source: ApplicationSubscriptionOptions<TPrincipal>['source'];
  authorize(principal: TPrincipal): Promise<boolean>;
}

export interface ApplicationAnalyticalProjectionOptions<TPayload extends object, TRow extends object> {
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly output: SchemaInput<TRow>;
  readonly provider?: ApplicationProjectionStoreProvider;
  readonly checkpoint?: 'idempotent';
  readonly rebuildable?: boolean;
  readonly project: (payload: TPayload, event: { readonly id: string; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
}

export type ApplicationProjectionRebuildModel<TValue extends object> = object & (
  | { readonly [applicationModelFacet]: CommonApplicationModelFacet<TValue, unknown, unknown, unknown> }
  | { readonly $model: CommonApplicationModelFacet<TValue, unknown, unknown, unknown> }
);

export type ApplicationOnlineProjectionRebuildOptions<TPayload extends object, TSnapshot extends object> =
  | { readonly checkpoint?: 'durable'; readonly source?: never; readonly map?: never }
  | {
    /** Canonical model authority scanned under one bounded repeatable-read snapshot. */
    readonly source: ApplicationProjectionRebuildModel<TSnapshot>;
    /** Converts current authoritative model state into the projection's stream payload vocabulary. */
    readonly map: (snapshot: TSnapshot) => TPayload | readonly TPayload[] | Promise<TPayload | readonly TPayload[]>;
    readonly checkpoint?: 'durable';
  };

export interface ApplicationOnlineProjectionOptions<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object = object> {
  readonly source: ApplicationStreamBinding<TPayload>;
  /** Selects the logical online-index capability; the bound provider remains replaceable. */
  readonly store: ApplicationIndexStoreProviderToken;
  /** Runtime schema for the value stored and returned by the online authority. */
  readonly output: SchemaInput<TValue>;
  readonly map: (payload: TPayload, event: { readonly id: string; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
  readonly partitionBy: (row: TRow) => string;
  readonly key: (row: TRow) => string;
  readonly score: (row: TRow) => number;
  /** Required as epochMilliseconds when age-based retention is enabled. */
  readonly scoreUnit?: 'arbitrary' | 'epochMilliseconds';
  readonly value: (row: TRow) => TValue;
  readonly removeWhen?: (row: TRow) => boolean;
  readonly retention: { readonly maxItemsPerPartition: number; readonly maxPartitions?: number; readonly maxAgeSeconds?: number };
  readonly generationScoped: true;
  readonly rebuild?: ApplicationOnlineProjectionRebuildOptions<TPayload, TSnapshot>;
}

export type ApplicationProjectionOptions<TPayload extends object, TRow extends object, TValue extends object = TRow, TSnapshot extends object = object> =
  | ApplicationAnalyticalProjectionOptions<TPayload, TRow>
  | ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>;

export interface ApplicationAnalyticalProjectionBinding<TPayload extends object = object, TRow extends object = object> {
  readonly kind: 'applicationProjection';
  readonly storage: 'analytical';
  readonly name: string;
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly provider: ApplicationProjectionStoreProvider;
  readonly output: SchemaInput<TRow>;
  readonly project: ApplicationAnalyticalProjectionOptions<TPayload, TRow>['project'];
}

export interface ApplicationOnlineProjectionBinding<TPayload extends object = object, TRow extends object = object, TValue extends object = object> {
  readonly kind: 'applicationProjection';
  readonly storage: 'online';
  readonly name: string;
  readonly source: ApplicationStreamBinding<TPayload>;
  readonly provider: ApplicationIndexBackend;
  readonly output: SchemaInput<TValue>;
  readonly map: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['map'];
  readonly partitionBy: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['partitionBy'];
  readonly key: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['key'];
  readonly score: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['score'];
  readonly value: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['value'];
  readonly removeWhen?: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['removeWhen'];
  readonly retention: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue>['retention'];
  readonly generationScoped: true;
}

export type ApplicationProjectionBinding<TPayload extends object = object, TRow extends object = object, TValue extends object = TRow> =
  | ApplicationAnalyticalProjectionBinding<TPayload, TRow>
  | ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;

export interface ApplicationGatewayOptions {
  readonly queries?: readonly (ApplicationQueryBinding | ApplicationOperationLike)[];
  readonly commands?: readonly (ApplicationModelCommandBinding | ApplicationOperationLike)[];
  readonly subscriptions?: readonly ApplicationSubscriptionBinding[];
  readonly authorizeCommand?: (request: {
    readonly principal: ApplicationQueryPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly command: string;
    readonly input: unknown;
  }) => boolean | Promise<boolean>;
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
  /** Generated Kubernetes Service identity when this gateway is materialized as a Deployment. */
  readonly serviceName?: string;
  readonly namespace?: string;
  readonly port?: number;
  readonly queries: readonly ApplicationQueryBinding[];
  readonly commands: readonly ApplicationModelCommandBinding[];
  readonly subscriptions: readonly ApplicationSubscriptionBinding[];
  readonly basePath: string;
  runtime<TRequest, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: Omit<ApplicationQueryGatewayRuntimeOptions<TRequest, TPrincipal>, 'queries' | 'subscriptionLimits'>): ApplicationQueryGateway<TRequest>;
  httpHandler<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: Omit<ApplicationQueryGatewayRuntimeOptions<Request, TPrincipal>, 'queries' | 'subscriptionLimits'>, http?: Omit<ApplicationQueryGatewayHttpOptions, 'basePath'>): (request: Request) => Promise<Response>;
}

export function registerApplicationStream<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal>(state: ApplicationReactiveState, definition: ApplicationReplayDefinition<TPayload>, options: ApplicationStreamOptions<TPayload, TPrincipal>, registrars?: ApplicationStreamRegistrars<TPayload>): ApplicationStreamBinding<TPayload, TPrincipal> {
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
    project: ((name: string, projectionOptions: Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'>) => {
      if (!registrars) throw new Error(`Application stream ${definition.id}.project(...) has no application registration context and fails closed.`);
      // typecast: the public overload selected the discriminated analytical or online option before this shared registrar boundary.
      return registrars.project(name, projectionOptions as never);
    }) as ApplicationStreamBinding<TPayload, TPrincipal>['project'],
    subscribe(name, subscriptionOptions) {
      if (!registrars) throw new Error(`Application stream ${definition.id}.subscribe(...) has no application registration context and fails closed.`);
      return registrars.subscribe(name, subscriptionOptions);
    },
    process(name, processOptions, handler) {
      if (!registrars) throw new Error(`Application stream ${definition.id}.process(...) has no application registration context and fails closed.`);
      return registrars.process(name, processOptions, handler);
    },
  };
}

export function registerApplicationStreamProcessor<
  TPayload extends object,
  TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>,
  TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>,
>(state: ApplicationReactiveState, name: string, source: ApplicationStreamBinding<TPayload>, options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks> {
  const nodeId = reactiveNodeId('streamProcessor', name);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Application stream processor ${JSON.stringify(name)} must be a lowercase DNS-style identifier.`);
  if (state.graphNodes.some((node) => node.id === nodeId)) throw new Error(`Application stream processor ${name} is already registered.`);
  const sourceRef = sourceNodeRef(source);
  if (!state.graphNodes.some((node) => node.id === sourceRef.nodeId && node.kind === 'stream')) throw new Error(`Application stream processor ${name} references a source that is not registered in this app.`);
  const processor = normalizeApplicationProcessorOptions(`Stream ${name}`, options.processor);
  if (processor.deployment.replicas !== 1) throw new Error(`Application stream processor ${name} currently requires replicas: 1 because its PostgreSQL checkpoint authority has not yet gained distributed partition claims.`);
  const retry = {
    mode: 'boundedExponentialBackoff' as const,
    maxAttempts: options.retry?.maxAttempts ?? 8,
    initialDelayMs: options.retry?.initialDelayMs ?? 250,
    maxDelayMs: options.retry?.maxDelayMs ?? 30_000,
    factor: 2,
  };
  if (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1 || !Number.isSafeInteger(retry.initialDelayMs) || retry.initialDelayMs < 1 || !Number.isSafeInteger(retry.maxDelayMs) || retry.maxDelayMs < retry.initialDelayMs) throw new Error(`Application stream processor ${name} has invalid retry bounds.`);
  const timeoutMs = options.budgets?.timeoutMs ?? 30_000;
  const maxInputBytes = options.budgets?.maxInputBytes ?? 256_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new Error(`Application stream processor ${name} has invalid execution budgets.`);
  const serialized = serializeApplicationCallback({ registrar: 'stream.process', argumentIndex: 2, property: 'handler', label: `Application stream processor ${name}`, callback: handler as (...args: never[]) => unknown, allowDeferredResolution: true });
  const schedules = recordApplicationStreamSchedules(state, nodeId, options.schedules ?? {});
	const tasks = recordApplicationStreamTasks(state, nodeId, options.tasks ?? {});
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'streamProcessor',
    name,
    stability: 'stable',
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    source: sourceRef,
    database: reactiveDatabaseRuntime(source.database),
    handlerSource: serialized.source,
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { handlerLocation: serialized.location } : {}),
    ...(serialized.unresolved ? { handlerUnresolved: serialized.unresolved } : {}),
    ...(schedules.length > 0 ? {
      schedules,
    } : {}),
		...(tasks.length > 0 ? { tasks } : {}),
		...(schedules.length + tasks.length > 0 ? { workflowEngine: { interface: 'WorkflowEngine' as const, nodeId: reactiveNodeId('provider', 'WorkflowEngine') } } : {}),
    delivery: 'at-least-once',
    idempotency: 'source-event-id',
    checkpoint: 'postgres',
    failure: options.retry?.deadLetter ? 'deadLetter' : 'pause',
    retry,
    deployment: processor.deployment,
    budgets: { timeoutMs, maxInputBytes },
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: sourceRef, relationship: 'reads' });
  for (const schedule of schedules) addApplicationGraphEdge(state, { from: { nodeId }, to: schedule.target, relationship: 'dependsOn' });
	for (const task of tasks) addApplicationGraphEdge(state, { from: { nodeId }, to: task.target, relationship: 'dependsOn' });
  if (schedules.length + tasks.length > 0) addApplicationGraphEdge(state, { from: { nodeId: reactiveNodeId('provider', 'WorkflowEngine') }, to: { nodeId }, relationship: 'provides' });
  return { kind: 'applicationStreamProcessor', name, source, handler, options };
}

function recordApplicationStreamTasks(
	state: ApplicationReactiveState,
	processorNodeId: string,
	targets: ApplicationStreamTaskTargets,
): readonly {
	readonly alias: string;
	readonly target: { readonly nodeId: string };
	readonly contract: { readonly name: string; readonly version: string; readonly input: ApplicationMessageContractSchema; readonly output: ApplicationMessageContractSchema };
}[] {
	const entries = Object.entries(targets).sort(([left], [right]) => left.localeCompare(right));
	if (entries.length === 0) return [];
	recordApplicationWorkflowEngine(state as ApplicationWorkflowState);
	return entries.map(([alias, target]) => {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) throw new Error(`Application stream processor ${processorNodeId} task alias ${JSON.stringify(alias)} must start with a letter and contain only letters, digits, underscore, or dash.`);
		if (target.kind !== 'applicationTask') throw new Error(`Application stream processor ${processorNodeId} task ${alias} must target an application task binding.`);
		const nodeId = reactiveNodeId('task', target.definition.id);
		const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
		if (node?.kind !== 'task') throw new Error(`Application stream processor ${processorNodeId} task ${alias} references unregistered task ${target.definition.id}.`);
		return { alias, target: { nodeId }, contract: { name: node.contract.name, version: node.contract.version, input: node.contract.input, output: node.contract.output } };
	});
}

function recordApplicationStreamSchedules(
  state: ApplicationReactiveState,
  processorNodeId: string,
  targets: ApplicationStreamScheduleTargets,
): readonly {
  readonly alias: string;
  readonly target: { readonly nodeId: string };
  readonly contract: { readonly name: string; readonly version: string; readonly input: ApplicationMessageContractSchema };
}[] {
  const entries = Object.entries(targets).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return [];
  // The concrete application state owns workflow registries even when a
  // lifecycle registrar exposes only the narrower reactive/provider shape.
  recordApplicationWorkflowEngine(state as ApplicationWorkflowState);
  return entries.map(([alias, target]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) throw new Error(`Application stream processor ${processorNodeId} schedule alias ${JSON.stringify(alias)} must start with a letter and contain only letters, digits, underscore, or dash.`);
    const kind = target.kind === 'applicationTask' ? 'task' : target.kind === 'applicationWorkflow' ? 'workflow' : undefined;
    if (!kind) throw new Error(`Application stream processor ${processorNodeId} schedule ${alias} must target an application task or workflow binding.`);
    const nodeId = reactiveNodeId(kind, target.definition.id);
    const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
    if (node?.kind !== kind) throw new Error(`Application stream processor ${processorNodeId} schedule ${alias} references unregistered ${kind} ${target.definition.id}.`);
    return { alias, target: { nodeId }, contract: { name: node.contract.name, version: node.contract.version, input: node.contract.input } };
  });
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

export function registerApplicationProjection<TPayload extends object, TRow extends object>(state: ApplicationReactiveState, name: string, options: ApplicationAnalyticalProjectionOptions<TPayload, TRow>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
export function registerApplicationProjection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object>(state: ApplicationReactiveState, name: string, options: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
export function registerApplicationProjection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object>(state: ApplicationReactiveState, name: string, options: ApplicationProjectionOptions<TPayload, TRow, TValue, TSnapshot>): ApplicationProjectionBinding<TPayload, TRow, TValue> {
  if ('store' in options) return registerOnlineApplicationProjection(state, name, options);
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
    storage: 'analytical',
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
  return { kind: 'applicationProjection', storage: 'analytical', name, source: options.source, provider, output: options.output, project: options.project };
}

function registerOnlineApplicationProjection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object>(
  state: ApplicationReactiveState,
  name: string,
  options: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>,
): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue> {
  if (options.store !== IndexStore) throw new Error(`Application online projection ${name} store must be the provider-neutral IndexStore capability token.`);
  if (options.generationScoped !== true) throw new Error(`Application online projection ${name} must use generationScoped: true so rebuild publication is atomic.`);
  if (!Number.isSafeInteger(options.retention.maxItemsPerPartition) || options.retention.maxItemsPerPartition < 1 || options.retention.maxItemsPerPartition > 1_000_000) {
    throw new Error(`Application online projection ${name} maxItemsPerPartition must be between 1 and 1000000.`);
  }
  if (options.retention.maxAgeSeconds !== undefined && (!Number.isSafeInteger(options.retention.maxAgeSeconds) || options.retention.maxAgeSeconds < 1)) {
    throw new Error(`Application online projection ${name} maxAgeSeconds must be a positive safe integer.`);
  }
  const maxPartitions = options.retention.maxPartitions ?? 100_000;
  if (!Number.isSafeInteger(maxPartitions) || maxPartitions < 1 || maxPartitions > 1_000_000) {
    throw new Error(`Application online projection ${name} maxPartitions must be between 1 and 1000000.`);
  }
  const scoreUnit = options.scoreUnit ?? 'arbitrary';
  if (options.retention.maxAgeSeconds !== undefined && scoreUnit !== 'epochMilliseconds') {
    throw new Error(`Application online projection ${name} must declare scoreUnit: 'epochMilliseconds' when maxAgeSeconds is enabled.`);
  }
  if (options.rebuild?.checkpoint !== undefined && options.rebuild.checkpoint !== 'durable') {
    throw new Error(`Application online projection ${name} rebuild checkpoint must be durable.`);
  }
  const provider = applicationIndexBackend(defaultApplicationIndexProvider(state));
  if (!provider) throw new Error(`Application online projection ${name} requires a Valkey-compatible IndexStore provider.`);
  const providerNode = { interface: 'IndexStore', nodeId: 'provider.index-store' } as const;
  if (!state.graphNodes.some((node) => node.id === providerNode.nodeId && node.kind === 'provider')) {
    throw new Error(`Application online projection ${name} requires IndexStore to be bound with app.provide(...) or app.defaults(...) before the projection is declared.`);
  }
  const nodeId = reactiveNodeId('projection', name);
  const source = sourceNodeRef(options.source);
  if (state.graphNodes.some((node) => node.id === nodeId)) throw new Error(`Application projection ${name} is already registered.`);
  const map = serializeProjectionCallback(name, 'map', options.map as (...args: never[]) => unknown);
  const partition = serializeProjectionCallback(name, 'partitionBy', options.partitionBy as (...args: never[]) => unknown);
  const key = serializeProjectionCallback(name, 'key', options.key as (...args: never[]) => unknown);
  const score = serializeProjectionCallback(name, 'score', options.score as (...args: never[]) => unknown);
  const value = serializeProjectionCallback(name, 'value', options.value as (...args: never[]) => unknown);
  const remove = options.removeWhen ? serializeProjectionCallback(name, 'removeWhen', options.removeWhen as (...args: never[]) => unknown) : undefined;
  const rebuildSource = options.rebuild?.source ? sourceNodeRefForModel(state, options.rebuild.source, name) : undefined;
  const rebuildMap = options.rebuild?.source ? serializeProjectionCallback(name, 'rebuild.map', options.rebuild.map as (...args: never[]) => unknown) : undefined;
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'projection',
    name,
    stability: 'stable',
    source,
    provider: providerNode,
    storage: 'online',
    rebuildable: true,
    checkpoint: 'idempotent',
    output: declaredSchema(options.output, `${name}.output`),
    eventIdentity: 'stable-source-event-id',
    duplicateHandling: 'idempotent',
    rebuild: 'full-replay',
    handlerSource: map.source,
    ...(map.dependencies ? { handlerDependencies: map.dependencies } : {}),
    ...(map.location ? { handlerLocation: map.location } : {}),
    ...(map.unresolved ? { handlerUnresolved: map.unresolved } : {}),
    online: {
      generationScoped: true,
      retention: { ...options.retention, maxPartitions },
      scoreUnit,
      rebuild: {
        checkpoint: 'durable',
        ...(rebuildSource ? { source: rebuildSource } : {}),
        ...(rebuildMap ? {
          mapSource: rebuildMap.source,
          ...(rebuildMap.dependencies ? { mapDependencies: rebuildMap.dependencies } : {}),
          ...(rebuildMap.location ? { mapLocation: rebuildMap.location } : {}),
          ...(rebuildMap.unresolved ? { mapUnresolved: rebuildMap.unresolved } : {}),
        } : {}),
      },
      partitionSource: partition.source,
      ...(partition.dependencies ? { partitionDependencies: partition.dependencies } : {}),
      ...(partition.location ? { partitionLocation: partition.location } : {}),
      ...(partition.unresolved ? { partitionUnresolved: partition.unresolved } : {}),
      keySource: key.source,
      ...(key.dependencies ? { keyDependencies: key.dependencies } : {}),
      ...(key.location ? { keyLocation: key.location } : {}),
      ...(key.unresolved ? { keyUnresolved: key.unresolved } : {}),
      scoreSource: score.source,
      ...(score.dependencies ? { scoreDependencies: score.dependencies } : {}),
      ...(score.location ? { scoreLocation: score.location } : {}),
      ...(score.unresolved ? { scoreUnresolved: score.unresolved } : {}),
      valueSource: value.source,
      ...(value.dependencies ? { valueDependencies: value.dependencies } : {}),
      ...(value.location ? { valueLocation: value.location } : {}),
      ...(value.unresolved ? { valueUnresolved: value.unresolved } : {}),
      ...(remove ? {
        removeSource: remove.source,
        ...(remove.dependencies ? { removeDependencies: remove.dependencies } : {}),
        ...(remove.location ? { removeLocation: remove.location } : {}),
        ...(remove.unresolved ? { removeUnresolved: remove.unresolved } : {}),
      } : {}),
    },
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: source, relationship: 'reads' });
  addApplicationGraphEdge(state, { from: providerNode, to: { nodeId }, relationship: 'provides' });
  if (rebuildSource) addApplicationGraphEdge(state, { from: { nodeId }, to: rebuildSource, relationship: 'reads' });
  const requirement = `index-store.${reactiveName(name)}`;
  addApplicationProviderRequirement(state, { id: requirement, interface: 'IndexStore', consumer: { nodeId }, provider: providerNode, required: true, purpose: 'onlineProjectionStore', diagnostics: { missing: `Online projection ${name} requires an IndexStore provider.`, ambiguous: `Online projection ${name} has multiple IndexStore providers.` } });
  addApplicationProviderBinding(state, { requirement, provider: providerNode, generatedResources: [], runtime: {}, metadataLinks: [] });
  return {
    kind: 'applicationProjection', storage: 'online', name, source: options.source, provider, output: options.output,
    map: options.map, partitionBy: options.partitionBy, key: options.key, score: options.score, value: options.value,
    ...(options.removeWhen ? { removeWhen: options.removeWhen } : {}), retention: options.retention, generationScoped: true,
  };
}

function serializeProjectionCallback(name: string, property: string, callback: (...args: never[]) => unknown) {
  return serializeApplicationCallback({ registrar: 'projection', argumentIndex: 1, property, label: `Application projection ${name} ${property}`, callback, allowDeferredResolution: true });
}

function sourceNodeRefForModel(state: ApplicationReactiveState, source: object, projection: string): { readonly nodeId: string } {
  const facet = getApplicationModelFacet<object, unknown, unknown, unknown>(source);
  if (!facet) throw new Error(`Application online projection ${projection} rebuild source must be a promoted model.`);
  const node = state.graphNodes.find((candidate) => (candidate.kind === 'model' || candidate.kind === 'crd') && candidate.name === facet.name);
  if (!node) throw new Error(`Application online projection ${projection} cannot resolve rebuild source ${facet.name} in this application graph.`);
  return { nodeId: node.id };
}

export function registerApplicationGateway(state: ApplicationReactiveState, name: string, options: ApplicationGatewayOptions, graphName = 'app'): ApplicationGatewayBinding {
  const queries = (options.queries ?? []).map((query) => applicationQueryBindingForOperation(query) ?? query).filter(isApplicationQueryBinding);
  if (queries.length !== (options.queries?.length ?? 0)) throw new Error(`Application gateway ${name} received a query operation that is not registered in this app.`);
  const commands = (options.commands ?? []).map((command) => applicationModelCommandBindingForOperation(command) ?? command).filter(isApplicationModelCommandBinding);
  if (commands.length !== (options.commands?.length ?? 0)) throw new Error(`Application gateway ${name} received a command operation that is not registered in this app.`);
  const subscriptions = options.subscriptions ?? [];
  if (queries.length + commands.length + subscriptions.length === 0) throw new Error(`Application gateway ${name} must expose at least one query, command, or subscription.`);
  const queryRefs = queries.map((query) => ({ nodeId: `query.${query.id}` }));
  for (const query of queryRefs) if (!state.graphNodes.some((node) => node.id === query.nodeId && node.kind === 'query')) throw new Error(`Application gateway ${name} references unregistered query ${query.nodeId}.`);
  const basePath = `/${(options.basePath ?? 'queries').replace(/^\/+|\/+$/g, '')}`;
  const limits = { perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20, total: options.subscriptionLimits?.total ?? 1_000 };
  if (limits.perPrincipal < 1 || limits.total < limits.perPrincipal) throw new Error(`Application gateway ${name} has invalid subscription limits.`);
  const nodeId = reactiveNodeId('gateway', name);
  const commandRefs = commands.map((command) => {
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
  const identityProvider = state.providers.extensions?.['RequestIdentity@v1alpha1'];
  const identityReadyCallback = identityProvider && typeof identityProvider === 'object' ? Reflect.get(identityProvider, 'ready') : undefined;
  const identityReadiness = deployment && typeof identityReadyCallback === 'function'
    ? serializeApplicationCallback({ registrar: 'RequestIdentity', argumentIndex: 1, property: 'ready', label: `Application gateway ${name} identity readiness`, callback: identityReadyCallback as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  const authorizationProvider = state.providers.extensions?.['Authorization@v1alpha1'];
  const authorizationReadyCallback = authorizationProvider && typeof authorizationProvider === 'object' ? Reflect.get(authorizationProvider, 'ready') : undefined;
  const authorizationReadiness = deployment && typeof authorizationReadyCallback === 'function'
    ? serializeApplicationCallback({ registrar: 'Authorization', argumentIndex: 1, property: 'ready', label: `Application gateway ${name} authorization readiness`, callback: authorizationReadyCallback as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  // typecast: generated command admission receives a schema-validated command input and the gateway-established principal.
  const commandAuthorization = options.authorizeCommand ? serializeApplicationCallback({ registrar: 'gateway', argumentIndex: 1, property: 'authorizeCommand', label: `Application gateway ${name} command authorization`, callback: options.authorizeCommand as (...args: never[]) => unknown, allowDeferredResolution: true }) : undefined;
  addApplicationGraphNode(state, {
    id: nodeId, kind: 'gateway', name, stability: 'stable', queries: queryRefs, commands: commandRefs, subscriptions: subscriptionRefs, transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: limits, routes: { snapshots: `${basePath}/:query/snapshot`, subscriptions: `${basePath}/:query/subscribe`, streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation',
    materialization: deployment ? 'generatedDeployment' : 'runtimeOnly',
    ...(authentication ? { authenticationSource: authentication.source } : {}),
    ...(authentication?.dependencies ? { authenticationDependencies: authentication.dependencies } : {}),
    ...(authentication?.location ? { authenticationLocation: authentication.location } : {}),
    ...(authentication?.unresolved ? { authenticationUnresolved: authentication.unresolved } : {}),
    ...(identityReadiness ? { identityReadinessSource: identityReadiness.source } : {}),
    ...(identityReadiness?.dependencies ? { identityReadinessDependencies: identityReadiness.dependencies } : {}),
    ...(identityReadiness?.location ? { identityReadinessLocation: identityReadiness.location } : {}),
    ...(identityReadiness?.unresolved ? { identityReadinessUnresolved: identityReadiness.unresolved } : {}),
    ...(authorizationReadiness ? { authorizationReadinessSource: authorizationReadiness.source } : {}),
    ...(authorizationReadiness?.dependencies ? { authorizationReadinessDependencies: authorizationReadiness.dependencies } : {}),
    ...(authorizationReadiness?.location ? { authorizationReadinessLocation: authorizationReadiness.location } : {}),
    ...(authorizationReadiness?.unresolved ? { authorizationReadinessUnresolved: authorizationReadiness.unresolved } : {}),
    ...(commandAuthorization ? { commandAuthorizationSource: commandAuthorization.source } : {}),
    ...(commandAuthorization?.dependencies ? { commandAuthorizationDependencies: commandAuthorization.dependencies } : {}),
    ...(commandAuthorization?.location ? { commandAuthorizationLocation: commandAuthorization.location } : {}),
    ...(commandAuthorization?.unresolved ? { commandAuthorizationUnresolved: commandAuthorization.unresolved } : {}),
    ...(deployment ? {
      cursorSecret: { apiVersion: deployment.cursorSecret.apiVersion ?? 'v1', kind: deployment.cursorSecret.kind ?? 'Secret', name: deployment.cursorSecret.name, ...(deployment.cursorSecret.namespace ? { namespace: deployment.cursorSecret.namespace } : {}), key: deployment.cursorSecret.key },
      deployment: { namespace: deployment.namespace, image: deployment.image ?? 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: deployment.replicas ?? 1, port: deployment.port ?? 8080 },
    } : {}),
  });
  for (const query of queryRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: query, relationship: 'exposes' });
  for (const command of commandRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: command.command, relationship: 'exposes' });
  for (const subscription of subscriptionRefs) addApplicationGraphEdge(state, { from: { nodeId }, to: subscription, relationship: 'exposes' });
  return {
    kind: 'applicationGateway',
    name,
    ...(deployment ? { serviceName: reactiveName(`${graphName}-${name}`), namespace: deployment.namespace, port: deployment.port ?? 8080 } : {}),
    queries,
    commands,
    subscriptions,
    basePath,
    runtime(runtimeOptions) {
      return createApplicationQueryGateway({ ...runtimeOptions, queries, subscriptionLimits: limits });
    },
    httpHandler(runtimeOptions, httpOptions = {}) {
      const runtime = createApplicationQueryGateway({ ...runtimeOptions, queries, subscriptionLimits: limits });
      return createApplicationQueryGatewayHttpHandler(runtime, { ...httpOptions, basePath: basePath.slice(1) });
    },
  };
}

function isApplicationQueryBinding(value: unknown): value is ApplicationQueryBinding {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationQuery');
}

function isApplicationModelCommandBinding(value: unknown): value is ApplicationModelCommandBinding {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationModelCommand');
}

function reactiveDatabaseRuntime(binding: ApplicationDatabaseBinding): { readonly name: string; readonly connectionEnvName: string; readonly secretName: string; readonly secretKey: string; readonly secretNamespace?: string; readonly access?: { readonly context: string; readonly contextSchema: JsonObject; readonly setting: string; readonly column: string } } {
  const provider = binding.provider;
  const clusterName = provider.clusterName ?? provider.name ?? `${reactiveName(binding.name)}-db`;
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return { name: binding.name, connectionEnvName: `APPLIK8S_DATABASE_${reactiveName(binding.name).replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_URL`, secretName: applicationTypeKroSerializedValue(secret.name ?? `${clusterName}-app`), secretKey: applicationTypeKroSerializedValue(provider.connectionSecretKey ?? 'uri'), ...(secret.namespace ?? provider.namespace ? { secretNamespace: applicationTypeKroSerializedValue(secret.namespace ?? provider.namespace) } : {}), ...(binding.access ? { access: { context: binding.access.context.name, contextSchema: binding.access.context.contract.jsonSchema, setting: binding.access.setting, column: binding.access.column } } : {}) };
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
    config: { provider: 'clickhouse', enabled: provider.enabled ?? true, name: provider.name ?? 'applik8s-analytics', namespace: provider.namespace ?? 'applik8s-analytics', provision: provider.provision ?? true, endpoint: provider.endpoint ?? applicationTypeKroString('http://clickhouse-', provider.name ?? 'applik8s-analytics', '.', provider.namespace ?? 'applik8s-analytics', '.svc.cluster.local:8123'), database: provider.database ?? 'default', ...(provider.credentialsSecret?.name ? { credentialsSecret: { apiVersion: provider.credentialsSecret.apiVersion, kind: provider.credentialsSecret.kind, name: provider.credentialsSecret.name, ...(provider.credentialsSecret.namespace ? { namespace: provider.credentialsSecret.namespace } : {}) }, usernameKey: provider.usernameKey ?? 'username', passwordKey: provider.passwordKey ?? 'password' } : {}) },
  };
  addApplicationGraphNode(state, node);
  return { interface: 'ProjectionStore', nodeId };
}

function sourceNodeRef(source: ApplicationReactiveSourceBinding): { readonly nodeId: string } {
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
