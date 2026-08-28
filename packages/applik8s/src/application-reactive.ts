// typecast-file-boundary: schema-normalized streams, projections, and subscriptions cross erased graph registries and regain declaration-time generics by stable IDs.

import {
  type ApplicationOperationAuthorizationContract,
  type ApplicationOperationLike,
  getApplicationOperationContract,
} from '@applik8s/client';
import type { ApplicationAdmissionInvocationContextV1, ApplicationMessageContractSchema, ApplicationProfiledCallbackContract, ApplicationProviderNode, ApplicationProviderRef, ApplicationRetryPolicy, ApplicationStreamNode, ApplicationStreamProcessorNode, JsonObject, JsonValue } from '@applik8s/core';
import { applicationOperationId } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk';
import type { ApplicationDatabaseBinding } from './application.js';
import { applicationActorDependencyBindings } from './application-actor-dependencies.js';
import {
  expandApplicationCallbackDependencies,
  type SerializedApplicationCallback,
  serializeApplicationCallback,
} from './application-callback.js';
import { inferApplicationFunctionNativeTransaction } from './application-function-native-transactions.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import type { ApplicationModelCommandBinding } from './application-models.js';
import { registerApplicationObjectStore } from './application-object-storage.js';
import { type ApplicationProcessorOptions, normalizeApplicationProcessorOptions } from './application-processor-policy.js';
import type { ApplicationScheduleHandle } from './application-schedule.js';
import {
  applicationProjectionRuntime,
  attachApplicationProjectionRebuildTarget,
} from './application-projection-binding.js';
import { applicationCallableProviderDependencies } from './application-provider-dependencies.js';
import type { ApplicationAnalyticalDatabaseProvider, ApplicationIdentityProvider, ApplicationIndexBackend, ApplicationIndexStoreProviderToken, ApplicationProviderBinding, ApplicationProviderQualification, ApplicationProviderSelectionValue, ApplicationProviderState } from './application-providers.js';
import { applicationAnalyticalDatabaseImplementation, applicationIndexBackend, applicationObjectStorageImplementation, applicationProviderImplementationName, applicationProviderQualificationFor, applicationProviderSelectionFor, applicationTransactionalDatabaseImplementation, defaultApplicationIndexProvider, IndexStore, isApplicationAnalyticalDatabaseProvider, isApplicationIdentityProvider, isClickHouseAnalyticalDatabaseProvider, isPostgresAnalyticalDatabaseProvider } from './application-providers.js';
import type { ApplicationQueryBinding, ApplicationQueryPrincipal } from './application-queries.js';
import { applicationQueryBindingForOperation } from './application-queries.js';
import { applicationTypeKroGraphValue, applicationTypeKroSerializedValue, applicationTypeKroString } from './application-typekro-values.js';
import { type ApplicationTaskBinding, type ApplicationWorkflowBinding, type ApplicationWorkflowState, applicationGeneratedDependencyAlias, recordApplicationWorkflowEngine } from './application-workflows.js';
import { applicationRelationalModelOptionsFor } from './drizzle.js';
import type { EventDefinition, StreamDefinition } from './dsl.js';
import { applicationModelCommandBindingForOperation, applicationModelFacet, type CommonApplicationModelFacet, getApplicationModelFacet } from './native-models.js';
import type { ApplicationQueryGateway, ApplicationQueryGatewayHttpOptions, ApplicationQueryGatewayOptions as ApplicationQueryGatewayRuntimeOptions } from './query-gateway.js';
import { createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler } from './query-gateway.js';
import type { ApplicationWorkflowInvocationMetadata, ApplicationWorkflowScheduleResult } from './workflow-runtime.js';

interface ApplicationReactiveState extends ApplicationGraphState, ApplicationProviderState {}

type ApplicationStreamDurableTarget =
  | Pick<ApplicationTaskBinding<object, object>, 'kind' | 'definition'>
  | Pick<ApplicationWorkflowBinding<object, object>, 'kind' | 'definition'>;

export type ApplicationStreamScheduleTargets = Readonly<Record<string, ApplicationStreamDurableTarget>>;

export type ApplicationStreamTaskTargets = Readonly<Record<string, ApplicationStreamDurableTarget>>;

export type ApplicationStreamTaskFunctions<TTargets extends ApplicationStreamTaskTargets> = {
  readonly [TAlias in keyof TTargets]: TTargets[TAlias] extends ApplicationTaskBinding<infer TInput, infer TOutput>
    ? (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) => Promise<TOutput>
    : TTargets[TAlias] extends ApplicationWorkflowBinding<infer TInput, infer TOutput>
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
  batch<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(name: string, options: ApplicationStreamBatchOptions<TSchedules, TTasks>, handler: ApplicationStreamBatchHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
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

export type ApplicationProjectionOutput<TValue extends object> =
  | SchemaInput<TValue>
  | ApplicationProjectionRebuildModel<TValue>;

interface ApplicationProjectionCapabilityField {
  readonly path: string;
  readonly kind: 'signalReference';
  readonly contract: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly visibility: 'same-as-issuance';
  readonly maxAgeSeconds: number;
}

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
  project<TRow extends object>(options: Omit<ApplicationAnalyticalProjectionOptions<TPayload, TRow>, 'source'>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
  project<TRow extends object, TValue extends object, TSnapshot extends object = object>(options: Omit<ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>, 'source'>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  project<TRow extends object>(name: string, options: Omit<ApplicationAnalyticalProjectionOptions<TPayload, TRow>, 'source'>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
  project<TRow extends object, TValue extends object, TSnapshot extends object = object>(name: string, options: Omit<ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>, 'source'>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  /**
   * Function-native persisted derivation. The callback returns pure write
   * descriptors; provider and checkpoint machinery remain framework-owned.
   */
  project<TValue extends object>(
    output: ApplicationProjectionOutput<TValue>,
    transform: ApplicationAnalyticalProjectionTransform<TPayload, TValue>,
  ): ApplicationAnalyticalProjectionBinding<TPayload, TValue>;
  project<TValue extends object>(
    output: ApplicationProjectionOutput<TValue>,
    transform: ApplicationOnlineProjectionTransform<TPayload, TValue>,
  ): ApplicationOnlineProjectionDraft<TPayload, TValue>;
  /** Declares an authorized client delivery directly from this stream. */
  subscribe<TSubscriberPrincipal extends ApplicationQueryPrincipal = TPrincipal>(name: string, options: Omit<ApplicationSubscriptionOptions<TSubscriberPrincipal>, 'source'>): ApplicationSubscriptionBinding<TSubscriberPrincipal>;
  /** Declares bounded durable backend work over this replayable stream. */
  onEvent<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(
    handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>,
  ): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
  onEvent<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(
    options: ApplicationStreamProcessOptions<TSchedules, TTasks>,
    handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>,
  ): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
  /** Declares bounded microbatch work with durable frozen membership and whole-batch acknowledgement. */
  onBatch<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(
    options: ApplicationStreamBatchOptions<TSchedules, TTasks>,
    handler: ApplicationStreamBatchHandler<TPayload, TSchedules, TTasks>,
  ): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
  /**
   * @deprecated Use onEvent(options?, handler). `process` remains as the
   * compatibility lowering name until the normalized graph vocabulary moves.
   */
  process<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
  process<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>>(name: string, options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks>;
}

export type ApplicationProjectionWrite<TValue extends object> =
  | {
      readonly kind: 'upsert';
      readonly partition: string;
      readonly key: string;
      readonly score: number;
      readonly value: TValue;
    }
  | {
      readonly kind: 'remove';
      readonly partition: string;
      readonly key: string;
      readonly score?: number;
    }
  | { readonly kind: 'skip' };

export type ApplicationAnalyticalProjectionWrite<TValue extends object> =
  | { readonly kind: 'append'; readonly value: TValue }
  | { readonly kind: 'skip' };

export interface ApplicationProjectionWriteScope<TValue extends object> {
  readonly sourceId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly sourcePartition: string;
  upsert(input: Omit<Extract<ApplicationProjectionWrite<TValue>, { readonly kind: 'upsert' }>, 'kind'>): ApplicationProjectionWrite<TValue>;
  remove(input: Omit<Extract<ApplicationProjectionWrite<TValue>, { readonly kind: 'remove' }>, 'kind'>): ApplicationProjectionWrite<TValue>;
  append(value: TValue): ApplicationAnalyticalProjectionWrite<TValue>;
  skip(): ApplicationProjectionWrite<TValue>;
}

export type ApplicationOnlineProjectionTransform<TPayload extends object, TValue extends object> = (
  source: TPayload,
  write: ApplicationProjectionWriteScope<TValue>,
) => ApplicationProjectionWrite<TValue> | readonly ApplicationProjectionWrite<TValue>[];

export type ApplicationAnalyticalProjectionTransform<TPayload extends object, TValue extends object> = (
  source: TPayload,
  write: ApplicationProjectionWriteScope<TValue>,
) => ApplicationAnalyticalProjectionWrite<TValue> | readonly ApplicationAnalyticalProjectionWrite<TValue>[];

export type ApplicationProjectionTransform<TPayload extends object, TValue extends object> =
  | ApplicationOnlineProjectionTransform<TPayload, TValue>
  | ApplicationAnalyticalProjectionTransform<TPayload, TValue>;

export interface ApplicationOnlineProjectionRetentionPolicy {
  readonly maxItemsPerPartition: number;
  readonly maxPartitions?: number;
  readonly maxAge?: string;
}

export interface ApplicationProjectionRebuildScope<TPayload extends object> {
  source(payload: TPayload): TPayload;
  skip(): undefined;
}

export interface ApplicationOnlineProjectionDraft<
  TPayload extends object,
  TValue extends object,
  TSnapshot extends object = object,
> {
  rebuildFrom<TNextSnapshot extends object>(
    source: ApplicationProjectionRebuildModel<TNextSnapshot>,
    map: (
      snapshot: TNextSnapshot,
      rebuild: ApplicationProjectionRebuildScope<TPayload>,
    ) => TPayload | readonly TPayload[] | undefined,
  ): ApplicationOnlineProjectionDraft<TPayload, TValue, TNextSnapshot>;
  rebuildFromReplay(): ApplicationOnlineProjectionDraft<TPayload, TValue, TSnapshot>;
  retain(
    policy: ApplicationOnlineProjectionRetentionPolicy,
  ): ApplicationOnlineProjectionBinding<TPayload, ApplicationProjectionWrite<TValue>, TValue>;
}

export interface ApplicationStreamProcessOptions<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  /** Installation-derived condition controlling processor materialization. */
  readonly enabled?: boolean;
  readonly processor?: ApplicationProcessorOptions;
  readonly retry?: { readonly maxAttempts?: number; readonly initialDelayMs?: number; readonly maxDelayMs?: number; readonly deadLetter?: boolean };
  readonly budgets?: { readonly timeoutMs?: number; readonly maxInputBytes?: number };
  /** Provider-neutral recurring schedules this handler may converge. */
  readonly schedules?: TSchedules;
  /** Provider-neutral durable workflows this handler may invoke. */
  readonly workflows?: TTasks;
  /** @deprecated Use workflows. Retained as a source-compatible lowering alias. */
  readonly tasks?: TTasks;
  /** Compiler-owned direct callable captures; never authored by applications. */
  readonly __generatedCalls?: readonly unknown[];
  /** Compiler-owned source identifiers for direct callable captures. */
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
  /** Compiler-owned direct calls whose result was awaited by the authored callback. */
  readonly __generatedAwaitedCalls?: Readonly<Record<string, unknown>>;
}

export interface ApplicationStreamBatchOptions<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> extends ApplicationStreamProcessOptions<TSchedules, TTasks> {
  readonly batch: {
    readonly maxItems: number;
    readonly maxBytes: string | number;
    readonly maxWait: string | number;
  };
  readonly ordering: 'partition';
  readonly concurrency?: number;
  readonly acknowledgement?: 'wholeBatch';
}

export interface ApplicationStreamProcessContext<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  /** Framework-admitted execution narrowed for the authored callback. */
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly event: {
    readonly id: string;
    readonly stream: { readonly name: string; readonly version: string };
    readonly sequence: number;
    readonly recordedAt: string;
    readonly partitionKey: string;
    /** Opaque scope proving which admitted context produced the committed fact. */
    readonly contextDigest?: string;
    /** Opaque data-isolation scopes propagated only through internal processors. */
    readonly changeScopes?: Readonly<Record<string, string>>;
  };
  /** Gateway-established actor captured durably with the committed fact. */
  readonly principal?: import('./command-principal.js').ApplicationCommandPrincipal;
  /** Provider-admitted values captured with the command; reserved identity keys are removed. */
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly schedules: ApplicationStreamScheduleFunctions<TSchedules>;
  readonly workflows: ApplicationStreamTaskFunctions<TTasks>;
  /** @deprecated Use workflows. */
  readonly tasks: ApplicationStreamTaskFunctions<TTasks>;
}

export type ApplicationStreamProcessHandler<TPayload extends object, TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> = (payload: TPayload, context: ApplicationStreamProcessContext<TSchedules, TTasks>) => void | Promise<void>;

export interface ApplicationEventEnvelope<TPayload extends object> {
  /** Per-event admission narrowed for this delivery attempt. */
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly id: string;
  readonly stream: { readonly name: string; readonly version: string };
  readonly sequence: number;
  readonly recordedAt: string;
  readonly partitionKey: string;
  readonly contextDigest?: string;
  /** Opaque data-isolation scopes propagated only through internal processors. */
  readonly changeScopes?: Readonly<Record<string, string>>;
  readonly principal?: import('./command-principal.js').ApplicationCommandPrincipal;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly value: TPayload;
}

export interface ApplicationEventBatch<TPayload extends object> {
  readonly id: string;
  readonly events: readonly ApplicationEventEnvelope<TPayload>[];
  readonly partition?: string;
  readonly firstSequence: string;
  readonly lastSequence: string;
}

export interface ApplicationStreamBatchContext<TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> {
  readonly batch: { readonly id: string; readonly partition?: string; readonly firstSequence: string; readonly lastSequence: string };
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly schedules: ApplicationStreamScheduleFunctions<TSchedules>;
  readonly workflows: ApplicationStreamTaskFunctions<TTasks>;
  /** @deprecated Use workflows. */
  readonly tasks: ApplicationStreamTaskFunctions<TTasks>;
}

export type ApplicationStreamBatchHandler<TPayload extends object, TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>, TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>> = (
  batch: ApplicationEventBatch<TPayload>,
  context: ApplicationStreamBatchContext<TSchedules, TTasks>,
) => void | Promise<void>;

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
  readonly provider?: ApplicationAnalyticalDatabaseProvider | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>;
  readonly checkpoint?: 'idempotent';
  readonly rebuildable?: boolean;
  /** Compiler-owned capability-bearing output declaration. */
  readonly __capabilityFields?: readonly ApplicationProjectionCapabilityField[];
  readonly project: (payload: TPayload, event: { readonly id: string; readonly sequence: number; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
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
  readonly map: (payload: TPayload, event: { readonly id: string; readonly sequence: number; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
  readonly partitionBy: (row: TRow) => string;
  readonly key: (row: TRow) => string;
  readonly score: (row: TRow) => number;
  /** Required as epochMilliseconds when age-based retention is enabled. */
  readonly scoreUnit?: 'arbitrary' | 'epochMilliseconds';
  readonly value: (row: TRow) => TValue;
  readonly removeWhen?: (row: TRow) => boolean;
  readonly retention: { readonly maxItemsPerPartition: number; readonly maxPartitions?: number; readonly maxAgeSeconds?: number };
  readonly generationScoped: true;
  /** Compiler-owned capability-bearing output declaration. */
  readonly __capabilityFields?: readonly ApplicationProjectionCapabilityField[];
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
  readonly provider:
    | ApplicationAnalyticalDatabaseProvider
    | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>;
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
  /** Rebuilds and atomically publishes a generation using framework-owned evidence storage. */
  rebuild(input: { readonly generation: string; readonly artifactPrefix?: string }): Promise<import('./projection-rebuild-runtime.js').ApplicationOnlineProjectionRebuildResult>;
  /** Retires a generation and the immutable evidence that proved its publication. */
  retire(input: { readonly generation: string; readonly references: readonly import('./application-object-storage.js').ApplicationObjectReference[] }): Promise<void>;
}

export type ApplicationProjectionBinding<TPayload extends object = object, TRow extends object = object, TValue extends object = TRow> =
  | ApplicationAnalyticalProjectionBinding<TPayload, TRow>
  | ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;

export interface ApplicationGatewayOptions {
  /**
   * Internal gateways carry generated workload calls without creating a
   * browser-facing operation route. Defaults to public.
   */
  readonly visibility?: 'public' | 'internal';
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
    /**
     * Optional gateway-specific admission override. When omitted, the generated
     * gateway consumes the single IdentityProvider supplied to the application.
     */
    readonly authenticate?: (request: Request) => ApplicationGatewayAdmission | Promise<ApplicationGatewayAdmission>;
    readonly cursorSecret: { readonly apiVersion?: string; readonly kind?: string; readonly name: string; readonly key: string; readonly namespace?: string };
    readonly image?: string;
    readonly replicas?: number;
    readonly port?: number;
  };
}

/** Authenticated request admission shared by every HTTP/reactive gateway. */
export type ApplicationGatewayAdmission = import('@applik8s/core').ApplicationRequestAdmission;

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
  const applicationSignal = applicationSignalGraphContract(options);
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
    ...(applicationSignal ? { signal: applicationSignal } : {}),
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
    project: ((nameOrOutput: string | ApplicationProjectionOutput<object> | Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'>, optionsOrTransform?: Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'> | ApplicationProjectionTransform<TPayload, object>) => {
      if (!registrars) throw new Error(`Application stream ${definition.id}.project(...) has no application registration context and fails closed.`);
      if (typeof optionsOrTransform === 'function') {
        const mode = functionNativeProjectionMode(optionsOrTransform);
        return mode === 'analytical'
          ? functionNativeAnalyticalProjection(
              registrars,
              nameOrOutput as ApplicationProjectionOutput<object>,
              optionsOrTransform as ApplicationAnalyticalProjectionTransform<TPayload, object>,
              applicationSignal,
            )
          : functionNativeOnlineProjection(
              registrars,
              nameOrOutput as ApplicationProjectionOutput<object>,
              optionsOrTransform as ApplicationOnlineProjectionTransform<TPayload, object>,
              applicationSignal,
            );
      }
      const projectionOptions = typeof nameOrOutput === 'string' ? optionsOrTransform : nameOrOutput;
      if (!projectionOptions) throw new Error(`Application stream ${definition.id}.project(name, options) requires projection options.`);
      const name = typeof nameOrOutput === 'string'
        ? nameOrOutput
        : inferredFunctionNativeName(
          'project',
          'project' in projectionOptions
            ? projectionOptions.project
            : (projectionOptions as unknown as { readonly map: unknown }).map,
        );
      // typecast: the public overload selected the discriminated analytical or online option before this shared registrar boundary.
      return registrars.project(name, projectionOptions as never);
    }) as ApplicationStreamBinding<TPayload, TPrincipal>['project'],
    subscribe(name, subscriptionOptions) {
      if (!registrars) throw new Error(`Application stream ${definition.id}.subscribe(...) has no application registration context and fails closed.`);
      return registrars.subscribe(name, subscriptionOptions);
    },
    onEvent: ((optionsOrHandler: ApplicationStreamProcessOptions | ApplicationStreamProcessHandler<TPayload>, maybeHandler?: ApplicationStreamProcessHandler<TPayload>) => {
      if (!registrars) throw new Error(`Application stream ${definition.id}.onEvent(...) has no application registration context and fails closed.`);
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
      if (typeof handler !== 'function') throw new Error(`Application stream ${definition.id}.onEvent(options, handler) requires a handler.`);
      const options = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
      const name = inferredFunctionNativeName('onEvent', handler);
      return registrars.process(name, options as never, handler as never);
    }) as ApplicationStreamBinding<TPayload, TPrincipal>['onEvent'],
    onBatch: ((options: ApplicationStreamBatchOptions, handler: ApplicationStreamBatchHandler<TPayload>) => {
      if (!registrars) throw new Error(`Application stream ${definition.id}.onBatch(...) has no application registration context and fails closed.`);
      if (typeof handler !== 'function') throw new Error(`Application stream ${definition.id}.onBatch(options, handler) requires a handler.`);
      const name = inferredFunctionNativeName('onBatch', handler);
      return registrars.batch(name, options as never, handler as never);
    }) as ApplicationStreamBinding<TPayload, TPrincipal>['onBatch'],
    process: ((nameOrOptions: string | ApplicationStreamProcessOptions, optionsOrHandler: ApplicationStreamProcessOptions | ApplicationStreamProcessHandler<TPayload>, maybeHandler?: ApplicationStreamProcessHandler<TPayload>) => {
      if (!registrars) throw new Error(`Application stream ${definition.id}.process(...) has no application registration context and fails closed.`);
      const name = typeof nameOrOptions === 'string'
        ? nameOrOptions
        : inferredFunctionNativeName('process', optionsOrHandler);
      const processOptions = typeof nameOrOptions === 'string' ? optionsOrHandler : nameOrOptions;
      const handler = typeof nameOrOptions === 'string' ? maybeHandler : optionsOrHandler;
      return registrars.process(name, processOptions as never, handler as never);
    }) as ApplicationStreamBinding<TPayload, TPrincipal>['process'],
  };
}

function applicationSignalGraphContract<
  TPayload extends object,
  TPrincipal extends ApplicationQueryPrincipal,
>(
  options: ApplicationStreamOptions<TPayload, TPrincipal>,
): ApplicationStreamNode['signal'] | undefined {
  const candidate = Reflect.get(options, '__applicationSignal');
  if (!candidate || typeof candidate !== 'object') return undefined;
  const id = Reflect.get(candidate, 'id');
  const name = Reflect.get(candidate, 'name');
  const version = Reflect.get(candidate, 'version');
  const actions = Reflect.get(candidate, 'actions');
  if (
    typeof id !== 'string'
    || typeof name !== 'string'
    || typeof version !== 'string'
    || !actions
    || typeof actions !== 'object'
    || Array.isArray(actions)
  ) {
    throw new Error('Application signal stream metadata is malformed.');
  }
  return {
    id,
    name,
    version,
    actions: Object.keys(actions)
      .sort()
      .map((action) => ({
        name: action,
        schema: declaredSchema(
          Reflect.get(actions, action),
          `${id}.actions.${action}`,
        ),
      })),
  };
}

function inferredFunctionNativeName(surface: 'project' | 'process' | 'onEvent' | 'onBatch', callback: unknown): string {
  if (
    typeof callback !== 'function'
    || !callback.name.trim()
    || (surface === 'project' && (callback.name === 'project' || callback.name === 'map'))
  ) {
    throw new Error(
      `Stream.${surface}(...) cannot infer stable identity from an anonymous callback. `
      + `Pass a named function or use the compatibility (name, ...) form.`,
    );
  }
  const normalized = callback.name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error(`Stream.${surface}(...) could not derive a stable identity from callback ${JSON.stringify(callback.name)}.`);
  return normalized;
}

function functionNativeOnlineProjection<TPayload extends object, TValue extends object>(
  registrars: ApplicationStreamRegistrars<TPayload>,
  output: ApplicationProjectionOutput<TValue>,
  transform: ApplicationOnlineProjectionTransform<TPayload, TValue>,
  signal: ApplicationStreamNode['signal'] | undefined,
): ApplicationOnlineProjectionDraft<TPayload, TValue> {
  const name = inferredFunctionNativeName('project', transform);
  const outputContract = applicationProjectionOutputContract(
    output,
    transform,
    signal,
  );
  const projectionMap = functionNativeProjectionMap(name, transform);
  let rebuild:
    | { readonly mode: 'replay' }
    | {
        readonly mode: 'snapshot';
        readonly source: ApplicationProjectionRebuildModel<object>;
        readonly map: (
          snapshot: object,
          rebuild: ApplicationProjectionRebuildScope<TPayload>,
        ) => TPayload | readonly TPayload[] | undefined;
      }
    | undefined;

  const draft: ApplicationOnlineProjectionDraft<TPayload, TValue> = {
    rebuildFrom(source, map) {
      rebuild = {
        mode: 'snapshot',
        source: source as ApplicationProjectionRebuildModel<object>,
        map: map as (
          snapshot: object,
          rebuild: ApplicationProjectionRebuildScope<TPayload>,
        ) => TPayload | readonly TPayload[] | undefined,
      };
      return draft;
    },
    rebuildFromReplay() {
      rebuild = { mode: 'replay' };
      return draft;
    },
    retain(policy) {
      const maxAgeSeconds = policy.maxAge === undefined
        ? undefined
        : applicationProjectionDurationSeconds(policy.maxAge);
      const snapshotRebuild = rebuild?.mode === 'snapshot' ? rebuild : undefined;
      const rebuildOptions = snapshotRebuild
        ? {
            source: snapshotRebuild.source,
            checkpoint: 'durable' as const,
            map: functionNativeProjectionRebuildMap(name, snapshotRebuild.map),
          }
        : { checkpoint: 'durable' as const };
      return registrars.project(name, {
        store: IndexStore,
        output: outputContract.schema,
        ...(outputContract.capabilityFields.length > 0
          ? { __capabilityFields: outputContract.capabilityFields }
          : {}),
        map: projectionMap,
        partitionBy: (write) => {
          if (write.kind === 'skip') throw new Error('A skip projection descriptor cannot be persisted.');
          return write.partition;
        },
        key: (write) => {
          if (write.kind === 'skip') throw new Error('A skip projection descriptor cannot be persisted.');
          return write.key;
        },
        score: (write) => {
          if (write.kind === 'skip') throw new Error('A skip projection descriptor cannot be persisted.');
          return write.kind === 'remove' ? 0 : write.score;
        },
        value: (write) => {
          if (write.kind !== 'upsert') {
            throw new Error('A remove projection descriptor has no stored value.');
          }
          return write.value;
        },
        removeWhen: (write) => write.kind === 'remove',
        retention: {
          maxItemsPerPartition: policy.maxItemsPerPartition,
          ...(policy.maxPartitions === undefined ? {} : { maxPartitions: policy.maxPartitions }),
          ...(maxAgeSeconds === undefined ? {} : { maxAgeSeconds }),
        },
        scoreUnit: maxAgeSeconds === undefined ? 'arbitrary' : 'epochMilliseconds',
        generationScoped: true,
        rebuild: rebuildOptions,
      });
    },
  };
  return draft;
}

function functionNativeAnalyticalProjection<TPayload extends object, TValue extends object>(
  registrars: ApplicationStreamRegistrars<TPayload>,
  output: ApplicationProjectionOutput<TValue>,
  transform: ApplicationAnalyticalProjectionTransform<TPayload, TValue>,
  signal: ApplicationStreamNode['signal'] | undefined,
): ApplicationAnalyticalProjectionBinding<TPayload, TValue> {
  const name = inferredFunctionNativeName('project', transform);
  const outputContract = applicationProjectionOutputContract(
    output,
    transform,
    signal,
  );
  return registrars.project(name, {
    output: outputContract.schema,
    ...(outputContract.capabilityFields.length > 0
      ? { __capabilityFields: outputContract.capabilityFields }
      : {}),
    checkpoint: 'idempotent',
    rebuildable: true,
    project: functionNativeAnalyticalProjectionMap(name, transform),
  });
}

function applicationProjectionOutputContract<
  TPayload extends object,
  TValue extends object,
>(
  output: ApplicationProjectionOutput<TValue>,
  transform: ApplicationProjectionTransform<TPayload, TValue>,
  signal: ApplicationStreamNode['signal'] | undefined,
): {
  readonly schema: SchemaInput<TValue>;
  readonly capabilityFields: readonly ApplicationProjectionCapabilityField[];
} {
  const facet = getApplicationModelFacet(output);
  const schema = facet?.schema.select as SchemaInput<TValue> | undefined;
  const declarations = applicationRelationalModelOptionsFor(output).signalFields
    ?? {};
  const capabilityFields = Object.entries(declarations).map(
    ([path, declaration]) => ({
      path,
      kind: 'signalReference' as const,
      contract: declaration.contract,
      visibility: declaration.visibility,
      maxAgeSeconds: applicationProjectionDurationSeconds(
        declaration.maxAge,
      ),
    }),
  );
  const serialized = serializeApplicationCallback({
    registrar: 'project',
    argumentIndex: 1,
    property: 'transform',
    label: 'Application capability-bearing projection transform',
    callback: transform as (...args: never[]) => unknown,
    extractCallsite: false,
  });
  const executableSource = maskApplicationProjectionLiterals(
    serialized.source,
  );
  const standaloneReferences =
    executableSource.match(/\.signal\b(?!\s*\.)/g)?.length ?? 0;
  if (capabilityFields.length === 0) {
    if (standaloneReferences > 0) {
      throw new Error(
        'Application projection cannot persist a signal reference in an ordinary output field. '
        + 'Declare a model field with field.signal(...) or project only inert signal metadata.',
      );
    }
    return {
      schema: (schema ?? output) as SchemaInput<TValue>,
      capabilityFields: [],
    };
  }
  if (!schema || !facet) {
    throw new Error(
      'Capability-bearing projection output must be an Applik8s model declared with model(...).',
    );
  }
  if (!signal) {
    throw new Error(
      'field.signal(...) projection output requires a typed signal issuance source.',
    );
  }
  for (const field of capabilityFields) {
    if (
      field.contract.id !== signal.id
      || field.contract.name !== signal.name
      || field.contract.version !== signal.version
    ) {
      throw new Error(
        `Projection signal field ${field.path} declares ${field.contract.id} but the source emits ${signal.id}.`,
      );
    }
    const escapedPath = field.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const directAssignment = new RegExp(
      `(?:^|[{,]\\s*)${escapedPath}\\s*:\\s*[A-Z_a-z$][\\w$]*\\.signal\\s*(?=[,}])`,
      'm',
    );
    if (!directAssignment.test(executableSource)) {
      throw new Error(
        `Projection signal field ${field.path} must receive the exact inert event.signal reference directly.`,
      );
    }
  }
  if (standaloneReferences !== capabilityFields.length) {
    throw new Error(
      'Capability-bearing projection contains an undeclared or ambiguous signal reference assignment.',
    );
  }
  return {
    schema,
    capabilityFields,
  };
}

/**
 * Static capability checks inspect executable tokens only. Signal-looking
 * documentation, comments, and string/template data must not be mistaken for
 * a capability reference. Template interpolation still produces a string, so
 * masking the complete template is intentionally conservative here.
 */
function maskApplicationProjectionLiterals(source: string): string {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const current = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (current === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (
        index < source.length
        && !(source[index] === '*' && source[index + 1] === '/')
      ) {
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        output += '  ';
        index += 2;
      }
      continue;
    }
    if (current === '\'' || current === '"' || current === '`') {
      const quote = current;
      output += ' ';
      index += 1;
      while (index < source.length) {
        const character = source[index] ?? '';
        if (character === '\\') {
          output += ' ';
          index += 1;
          if (index < source.length) {
            output += source[index] === '\n' ? '\n' : ' ';
            index += 1;
          }
          continue;
        }
        output += character === '\n' ? '\n' : ' ';
        index += 1;
        if (character === quote) break;
      }
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function functionNativeProjectionMode<TPayload extends object, TValue extends object>(
  transform: ApplicationProjectionTransform<TPayload, TValue>,
): 'analytical' | 'online' {
  assertApplicationProjectionCallbackPurity(
    'function-native transform',
    transform as (...args: never[]) => unknown,
  );
  const serialized = serializeApplicationCallback({
    registrar: 'project',
    argumentIndex: 1,
    property: 'transform',
    label: 'Application function-native projection transform',
    callback: transform as (...args: never[]) => unknown,
    extractCallsite: false,
  });
  const source = serialized.source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
  const append = /\.append\s*\(/.test(source);
  const online = /\.(?:upsert|remove)\s*\(/.test(source);
  if (append === online) {
    throw new Error(
      'Function-native Stream.project(...) must use output.append(...) for an analytical projection '
      + 'or output.upsert(...)/output.remove(...) for an online projection. Mixed or hidden write modes '
      + 'fail closed; use the explicit projection options form for advanced helper indirection.',
    );
  }
  return append ? 'analytical' : 'online';
}

function functionNativeProjectionMap<TPayload extends object, TValue extends object>(
  name: string,
  transform: ApplicationOnlineProjectionTransform<TPayload, TValue>,
): ApplicationOnlineProjectionOptions<TPayload, ApplicationProjectionWrite<TValue>, TValue>['map'] {
  const serialized = serializeApplicationCallback({
    registrar: 'project',
    argumentIndex: 1,
    property: 'transform',
    label: `Application projection ${name} transform`,
    callback: transform as (...args: never[]) => unknown,
    extractCallsite: false,
  });
  const functionName = `${name.replace(/-([a-z0-9])/g, (_match, value: string) => value.toUpperCase())}Projection`;
  const source = `function ${functionName}(payload, event) {
    const transform = (${serialized.source});
    const write = Object.freeze({
      sourceId: event.id,
      sequence: event.sequence,
      recordedAt: event.recordedAt,
      sourcePartition: event.partitionKey,
      upsert: (input) => Object.freeze({ kind: "upsert", ...input }),
      remove: (input) => Object.freeze({ kind: "remove", ...input }),
      append: () => { throw new Error("Online projections cannot append analytical rows."); },
      skip: () => Object.freeze({ kind: "skip" }),
    });
    const writes = transform(payload, write);
    if (writes && typeof writes.then === "function") {
      throw new Error("Projection transformations must be synchronous and deterministic.");
    }
    return (Array.isArray(writes) ? writes : [writes]).filter((candidate) => candidate.kind !== "skip");
  }`;
  const callback = Function(`return (${source});`)() as ApplicationOnlineProjectionOptions<TPayload, ApplicationProjectionWrite<TValue>, TValue>['map'];
  Object.defineProperty(callback, Symbol.for('applik8s.applicationCallbackSource'), {
    value: {
      ...(serialized.location ?? {
        file: 'applik8s:generated-projection',
        line: 1,
        column: 1,
      }),
      name: functionName,
      source,
      generated: true,
    },
    enumerable: false,
  });
  return callback;
}

function functionNativeAnalyticalProjectionMap<TPayload extends object, TValue extends object>(
  name: string,
  transform: ApplicationAnalyticalProjectionTransform<TPayload, TValue>,
): ApplicationAnalyticalProjectionOptions<TPayload, TValue>['project'] {
  const serialized = serializeApplicationCallback({
    registrar: 'project',
    argumentIndex: 1,
    property: 'transform',
    label: `Application analytical projection ${name} transform`,
    callback: transform as (...args: never[]) => unknown,
    extractCallsite: false,
  });
  const functionName = `${name.replace(/-([a-z0-9])/g, (_match, value: string) => value.toUpperCase())}Projection`;
  const source = `function ${functionName}(payload, event) {
    const transform = (${serialized.source});
    const write = Object.freeze({
      sourceId: event.id,
      sequence: event.sequence,
      recordedAt: event.recordedAt,
      sourcePartition: event.partitionKey,
      append: (value) => Object.freeze({ kind: "append", value }),
      upsert: () => { throw new Error("Analytical projections cannot upsert online rows."); },
      remove: () => { throw new Error("Analytical projections cannot remove online rows."); },
      skip: () => Object.freeze({ kind: "skip" }),
    });
    const writes = transform(payload, write);
    if (writes && typeof writes.then === "function") {
      throw new Error("Projection transformations must be synchronous and deterministic.");
    }
    return (Array.isArray(writes) ? writes : [writes])
      .filter((candidate) => candidate.kind !== "skip")
      .map((candidate) => candidate.value);
  }`;
  const callback = Function(`return (${source});`)() as ApplicationAnalyticalProjectionOptions<TPayload, TValue>['project'];
  Object.defineProperty(callback, Symbol.for('applik8s.applicationCallbackSource'), {
    value: {
      ...(serialized.location ?? {
        file: 'applik8s:generated-analytical-projection',
        line: 1,
        column: 1,
      }),
      name: functionName,
      source,
      generated: true,
    },
    enumerable: false,
  });
  return callback;
}

function functionNativeProjectionRebuildMap<TPayload extends object>(
  name: string,
  map: (
    snapshot: object,
    rebuild: ApplicationProjectionRebuildScope<TPayload>,
  ) => TPayload | readonly TPayload[] | undefined,
): (snapshot: object) => TPayload | readonly TPayload[] {
  assertApplicationProjectionCallbackPurity(
    `${name} rebuild`,
    map as (...args: never[]) => unknown,
  );
  const serialized = serializeApplicationCallback({
    registrar: 'project',
    argumentIndex: 1,
    property: 'rebuild',
    label: `Application projection ${name} rebuild`,
    callback: map as (...args: never[]) => unknown,
    extractCallsite: false,
  });
  const functionName = `${name.replace(/-([a-z0-9])/g, (_match, value: string) => value.toUpperCase())}Rebuild`;
  const source = `function ${functionName}(snapshot) {
    const map = (${serialized.source});
    const rebuild = Object.freeze({
      source: (payload) => payload,
      skip: () => undefined,
    });
    const sources = map(snapshot, rebuild);
    if (sources && typeof sources.then === "function") {
      throw new Error("Projection rebuild transformations must be synchronous and deterministic.");
    }
    return sources ?? [];
  }`;
  const callback = Function(`return (${source});`)() as (snapshot: object) => TPayload | readonly TPayload[];
  Object.defineProperty(callback, Symbol.for('applik8s.applicationCallbackSource'), {
    value: {
      ...(serialized.location ?? {
        file: 'applik8s:generated-projection',
        line: 1,
        column: 1,
      }),
      name: functionName,
      source,
      generated: true,
    },
    enumerable: false,
  });
  return callback;
}

function applicationProjectionDurationSeconds(value: string): number {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Projection retention maxAge ${JSON.stringify(value)} must be a positive duration using s, m, h, or d.`,
    );
  }
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3_600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`Projection retention maxAge ${JSON.stringify(value)} exceeds the safe duration range.`);
  }
  return seconds;
}

export function registerApplicationStreamProcessor<
  TPayload extends object,
  TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>,
  TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>,
>(state: ApplicationReactiveState, name: string, source: ApplicationStreamBinding<TPayload>, options: ApplicationStreamProcessOptions<TSchedules, TTasks>, handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks> {
  return registerApplicationStreamProcessorInternal(state, name, source, options, handler, 'event');
}

/** @internal Lifecycle registrations may use their source model as the durable command-staging boundary. */
export function registerApplicationLifecycleStreamProcessor<
  TPayload extends object,
>(
  state: ApplicationReactiveState,
  name: string,
  source: ApplicationStreamBinding<TPayload>,
  options: ApplicationStreamProcessOptions,
  handler: ApplicationStreamProcessHandler<TPayload>,
  sourceModel: object,
): ApplicationStreamProcessorBinding<TPayload> {
  return registerApplicationStreamProcessorInternal(
    state,
    name,
    source,
    options,
    handler,
    'event',
    sourceModel,
  );
}

export function registerApplicationStreamBatchProcessor<
  TPayload extends object,
  TSchedules extends ApplicationStreamScheduleTargets = Readonly<Record<never, never>>,
  TTasks extends ApplicationStreamTaskTargets = Readonly<Record<never, never>>,
>(state: ApplicationReactiveState, name: string, source: ApplicationStreamBinding<TPayload>, options: ApplicationStreamBatchOptions<TSchedules, TTasks>, handler: ApplicationStreamBatchHandler<TPayload, TSchedules, TTasks>): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks> {
  return registerApplicationStreamProcessorInternal(state, name, source, options, handler, 'batch');
}

function registerApplicationStreamProcessorInternal<
  TPayload extends object,
  TSchedules extends ApplicationStreamScheduleTargets,
  TTasks extends ApplicationStreamTaskTargets,
>(
  state: ApplicationReactiveState,
  name: string,
  source: ApplicationStreamBinding<TPayload>,
  options: ApplicationStreamProcessOptions<TSchedules, TTasks> | ApplicationStreamBatchOptions<TSchedules, TTasks>,
  handler: ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks> | ApplicationStreamBatchHandler<TPayload, TSchedules, TTasks>,
  invocation: 'event' | 'batch',
  implicitSourceModel?: object,
): ApplicationStreamProcessorBinding<TPayload, TSchedules, TTasks> {
  const nodeId = reactiveNodeId('streamProcessor', name);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Application stream processor ${JSON.stringify(name)} must be a lowercase DNS-style identifier.`);
  if (state.graphNodes.some((node) => node.id === nodeId)) throw new Error(`Application stream processor ${name} is already registered.`);
  const sourceRef = sourceNodeRef(source);
  if (!state.graphNodes.some((node) => node.id === sourceRef.nodeId && node.kind === 'stream')) throw new Error(`Application stream processor ${name} references a source that is not registered in this app.`);
  const batchOptions = invocation === 'batch'
    ? options as ApplicationStreamBatchOptions<TSchedules, TTasks>
    : undefined;
  const processor = normalizeApplicationProcessorOptions(
    `Stream ${name}`,
    batchOptions?.concurrency !== undefined
      ? { ...options.processor, concurrency: batchOptions.concurrency }
      : options.processor,
  );
  if (processor.deployment.replicas !== 1) throw new Error(`Application stream processor ${name} currently requires replicas: 1 because its PostgreSQL checkpoint authority has not yet gained distributed partition claims.`);
  const retry = {
    mode: 'boundedExponentialBackoff' as const,
    maxAttempts: options.retry?.maxAttempts ?? 8,
    initialDelayMs: options.retry?.initialDelayMs ?? 250,
    maxDelayMs: options.retry?.maxDelayMs ?? 30_000,
    factor: 2,
  };
  if (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1 || !Number.isSafeInteger(retry.initialDelayMs) || retry.initialDelayMs < 1 || !Number.isSafeInteger(retry.maxDelayMs) || retry.maxDelayMs < retry.initialDelayMs) throw new Error(`Application stream processor ${name} has invalid retry bounds.`);
  const batch = invocation === 'batch'
    ? normalizeApplicationStreamBatchOptions(name, batchOptions as ApplicationStreamBatchOptions<TSchedules, TTasks>)
    : undefined;
  const timeoutMs = options.budgets?.timeoutMs ?? 30_000;
  const maxInputBytes = options.budgets?.maxInputBytes ?? Math.max(256_000, batch?.maxBytes ?? 0);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new Error(`Application stream processor ${name} has invalid execution budgets.`);
  if (batch && maxInputBytes < batch.maxBytes) throw new Error(`Application batch processor ${name} maxInputBytes must be at least its maxBytes bound.`);
  const schedules = recordApplicationStreamSchedules(state, nodeId, options.schedules ?? {});
  if (options.tasks && options.workflows) throw new Error(`Application stream processor ${name} must use workflows or deprecated tasks, not both.`);
  const inferred = expandApplicationCallbackDependencies({
    // Maintained packages can attach their private dependency graph directly
    // to the registered handler. Including the handler as a root preserves
    // that metadata without requiring application-facing __generatedCalls.
    calls: [handler, ...(options.__generatedCalls ?? [])],
    bindings: options.__generatedBindings,
    awaited: options.__generatedAwaitedCalls,
  });
  const discoveredTransaction = inferApplicationFunctionNativeTransaction(
    state,
    `Application stream processor ${name}`,
    inferred,
    invocation === 'batch' ? 'frozen-batch-id' : 'source-event-id',
  );
  const operationBindings = applicationStreamOperationBindings(
    state,
    name,
    inferred.bindings,
  );
  const queryBindings = applicationStreamQueryBindings(
    state,
    name,
    inferred.bindings,
  );
  const actorBindings = applicationActorDependencyBindings(
    state,
    `Application stream processor ${name}`,
    inferred,
  ).map(({ alias, actor, member, memberKind }) => ({
    identifier: alias,
    actor,
    member,
    memberKind,
  }));
  const applicationScheduleBindings = applicationStreamScheduleHandleBindings(
    state,
    name,
    inferred,
  );
  const awaitedValues = new Set(Object.values(inferred.awaited));
  const unawaitedOperations = Object.entries(inferred.bindings)
    .filter(([, value]) => applicationModelCommandBindingForOperation(value))
    .filter(([, value]) => !awaitedValues.has(value))
    .map(([identifier]) => identifier);
  if (unawaitedOperations.length > 0) {
    throw new Error(
      `Application stream processor ${name} must await direct model operations (${unawaitedOperations.join(', ')}). Awaiting returns a provisional result and lets Applik8s roll back every same-database write if the callback later fails. Use context.send(...) explicitly for post-commit asynchronous delivery.`,
    );
  }
  if (operationBindings.length > 0 && !implicitSourceModel) {
    throw new Error(
      `Application stream processor ${name} reaches direct model operations outside a model lifecycle callback. Use Model.on.create/update/delete for atomic composition, or context.send(...) for post-commit delivery.`,
    );
  }
  const functionNativeTransaction = discoveredTransaction;
  const providerBindings = [
    ...inferred.providerBindings,
    ...applicationCallableProviderDependencies({
      generatedHandlerProviderDependencies: handler,
    }),
  ].filter(
    (binding, index, bindings) =>
      bindings.findIndex(
        (candidate) =>
          candidate.identifier === binding.identifier
          && candidate.provider.nodeId === binding.provider.nodeId
          && candidate.operation?.member === binding.operation?.member
          && candidate.operation?.runtime?.module
            === binding.operation?.runtime?.module
          && candidate.operation?.runtime?.export
            === binding.operation?.runtime?.export,
      ) === index,
  );
  const inferredTasks = Object.fromEntries(
    inferred.calls
      .filter((value): value is ApplicationTaskBinding<object, object> | ApplicationWorkflowBinding<object, object> =>
        typeof value === 'function'
        && (Reflect.get(value, 'kind') === 'applicationTask' || Reflect.get(value, 'kind') === 'applicationWorkflow'))
      .flatMap((value) => {
        const identifiers = Object.entries(inferred.bindings)
          .filter(
            ([identifier, candidate]) =>
              candidate === value && !/^generatedCall\d+$/.test(identifier),
          )
          .map(([identifier]) => identifier);
        return (identifiers.length > 0
          ? identifiers
          : [applicationGeneratedDependencyAlias(value.definition.id)])
          .map((identifier) => [identifier, value] as const);
      }),
  );
	const tasks = recordApplicationStreamTasks(
    state,
    nodeId,
    { ...inferredTasks, ...(options.workflows ?? options.tasks ?? {}) },
  );
  const injectedIdentifiers = [
    ...tasks.map(({ alias }) => alias),
    ...(functionNativeTransaction?.modelBindings ?? [])
      .map(({ identifier }) => identifier),
    ...(functionNativeTransaction?.eventBindings ?? [])
      .map(({ identifier }) => identifier),
    ...operationBindings.map(({ identifier }) => identifier),
    ...queryBindings.map(({ identifier }) => identifier),
    ...actorBindings.map(({ identifier }) => identifier),
    ...applicationScheduleBindings.map(({ identifier }) => identifier),
    ...providerBindings.map(({ identifier }) => identifier),
  ]
    .flatMap((identifier) => [
      identifier,
      identifier.split('.')[0] ?? identifier,
    ])
    .filter(
      (identifier, index, values) =>
        identifier.length > 0 && values.indexOf(identifier) === index,
    );
  const serialized = serializeApplicationCallback({
    registrar: invocation === 'batch' ? 'stream.onBatch' : 'stream.process',
    argumentIndex: 2,
    property: 'handler',
    label: `Application stream processor ${name}`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
    injectedIdentifiers,
  });
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
    ...(functionNativeTransaction ? { functionNativeTransaction } : {}),
    ...(operationBindings.length > 0 ? { operationBindings } : {}),
    ...(queryBindings.length > 0 ? { queryBindings } : {}),
    ...(actorBindings.length > 0 ? { actorBindings } : {}),
    ...(applicationScheduleBindings.length > 0
      ? { applicationScheduleBindings }
      : {}),
    ...(inferred.callables.length > 0
      ? { callableBindings: inferred.callables }
      : {}),
    ...(providerBindings.length > 0 ? { providerBindings } : {}),
    ...(schedules.length > 0 ? {
      schedules,
    } : {}),
		...(tasks.length > 0 ? { tasks } : {}),
    ...(schedules.length + tasks.length > 0 ? { workflowEngine: { interface: 'WorkflowEngine' as const, nodeId: reactiveNodeId('provider', 'WorkflowEngine') } } : {}),
    delivery: 'at-least-once',
    invocation,
    idempotency: invocation === 'batch' ? 'frozen-batch-id' : 'source-event-id',
    ...(batch ? { batch } : {}),
    checkpoint: 'postgres',
    failure: options.retry?.deadLetter ? 'deadLetter' : 'pause',
    retry,
    deployment: processor.deployment,
    budgets: { timeoutMs, maxInputBytes },
  });
  if (functionNativeTransaction) {
    for (const model of functionNativeTransaction.models) {
      addApplicationGraphEdge(state, {
        from: { nodeId },
        to: model,
        relationship: 'dependsOn',
      });
    }
    for (const event of functionNativeTransaction.outbox) {
      addApplicationGraphEdge(state, {
        from: { nodeId },
        to: event,
        relationship: 'emits',
      });
    }
  }
  for (const operation of operationBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: operation.handler,
      relationship: 'dependsOn',
    });
  }
  for (const query of queryBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: query.query,
      relationship: 'reads',
    });
  }
  for (const actor of actorBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: actor.actor,
      relationship: 'dependsOn',
    });
  }
  for (const binding of applicationScheduleBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: binding.schedule,
      relationship: 'dependsOn',
    });
    addApplicationGraphEdge(state, {
      from: { nodeId: binding.scheduler.nodeId },
      to: { nodeId },
      relationship: 'provides',
    });
  }
  for (const provider of providerBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId: provider.provider.nodeId },
      to: { nodeId },
      relationship: 'provides',
    });
  }
  addApplicationGraphEdge(state, { from: { nodeId }, to: sourceRef, relationship: 'reads' });
  for (const schedule of schedules) addApplicationGraphEdge(state, { from: { nodeId }, to: schedule.target, relationship: 'dependsOn' });
	for (const task of tasks) addApplicationGraphEdge(state, { from: { nodeId }, to: task.target, relationship: 'dependsOn' });
  if (schedules.length + tasks.length > 0) addApplicationGraphEdge(state, { from: { nodeId: reactiveNodeId('provider', 'WorkflowEngine') }, to: { nodeId }, relationship: 'provides' });
  // typecast: the public event and batch registrars preserve their respective
  // handler shapes; the erased graph binding intentionally exposes one
  // processor identity to deployment code.
  return { kind: 'applicationStreamProcessor', name, source, handler: handler as ApplicationStreamProcessHandler<TPayload, TSchedules, TTasks>, options };
}

function applicationStreamScheduleHandleBindings(
  state: ApplicationReactiveState,
  processorName: string,
  dependencies: ReturnType<typeof expandApplicationCallbackDependencies>,
): NonNullable<ApplicationStreamProcessorNode['applicationScheduleBindings']> {
  const handles = dependencies.calls.filter(
    (value): value is ApplicationScheduleHandle<object, unknown> =>
      typeof value === 'function'
      && Reflect.get(value, 'kind') === 'applicationSchedule',
  );
  return handles.flatMap((handle) => {
    const registered = state.graphNodes.find(
      (candidate) => candidate.kind === 'schedule'
        && candidate.definition.id === handle.definition.id,
    );
    if (registered && (
      registered.kind !== 'schedule'
      || registered.id !== handle.graphNode.id
      || registered.scheduler.nodeId !== handle.graphNode.scheduler.nodeId
    )) {
      throw new Error(
        `Application stream processor ${processorName} captures schedule ${handle.definition.id}, but the application graph contains a conflicting definition.`,
      );
    }
    // Entrypoint schedules are merged into the public graph only after the
    // application module has executed. Keep the callback binding now and let
    // that canonical merge resolve its database and Scheduler providers; do
    // not require application setup to replay inside the generated worker.
    const node = registered?.kind === 'schedule'
      ? registered
      : handle.graphNode;
    const aliases = Object.entries(dependencies.bindings)
      .filter(
        ([identifier, candidate]) =>
          candidate === handle && !/^generatedCall\d+$/.test(identifier),
      )
      .map(([identifier]) => identifier);
    return (aliases.length > 0
      ? aliases
      : [applicationGeneratedDependencyAlias(handle.definition.id)])
      .map((identifier) => ({
        identifier,
        schedule: { nodeId: node.id },
        scheduler: node.scheduler,
      }));
  }).filter(
    (binding, index, bindings) =>
      bindings.findIndex(
        (candidate) => candidate.identifier === binding.identifier
          && candidate.schedule.nodeId === binding.schedule.nodeId,
      ) === index,
  );
}

function applicationStreamQueryBindings(
  _state: ApplicationReactiveState,
  _processorName: string,
  bindings: Readonly<Record<string, unknown>>,
): NonNullable<ApplicationStreamProcessorNode['queryBindings']> {
  return Object.entries(bindings)
    .flatMap(([identifier, value]) => {
      const binding = applicationQueryBindingForOperation(value);
      if (!binding) return [];
      // Module replay can register the processor before the containing module's
      // query nodes are merged into the root graph. The operation binding is
      // already canonical proof that this is a registered view; final graph
      // validation and compiler resolution fail closed if the exact node never
      // appears, matching workflow query capture semantics.
      return [{ identifier, query: { nodeId: `query.${binding.id}` } }];
    })
    .filter(
      (binding, index, all) =>
        !/^generatedCall\d+$/.test(binding.identifier)
        && all.findIndex(
          (candidate) =>
            candidate.identifier === binding.identifier
            && candidate.query.nodeId === binding.query.nodeId,
        ) === index,
    )
    .sort((left, right) =>
      `${left.identifier}:${left.query.nodeId}`.localeCompare(
        `${right.identifier}:${right.query.nodeId}`,
      ));
}

function applicationStreamOperationBindings(
  state: ApplicationReactiveState,
  processorName: string,
  bindings: Readonly<Record<string, unknown>>,
): NonNullable<ApplicationStreamProcessorNode['operationBindings']> {
  return Object.entries(bindings)
    .flatMap(([identifier, value]) => {
      const binding = applicationModelCommandBindingForOperation(value);
      const operation = getApplicationOperationContract(value);
      if (!binding || !operation) return [];
      const commandNode = state.graphNodes.find(
        (candidate) =>
          candidate.kind === 'command'
          && candidate.name === binding.command,
      );
      const handler = commandNode
        ? state.graphNodes.find(
            (candidate) =>
              candidate.kind === 'commandHandler'
              && candidate.command.nodeId === commandNode.id,
          )
        : undefined;
      if (commandNode?.kind !== 'command' || handler?.kind !== 'commandHandler') {
        throw new Error(
          `Application stream processor ${processorName} reaches ${binding.model}.${operation.name}, but its generated command handler is absent from the application graph.`,
        );
      }
      const canonicalOperationId = applicationOperationId({
        domain: 'models',
        owner: binding.model,
        operation: operation.name,
      });
      return [{
        identifier,
        operationId: canonicalOperationId,
        ...(operation.id !== canonicalOperationId
          ? { runtimeOperationId: operation.id }
          : {}),
        operation: {
          apiVersion: 'applik8s.operation/v1alpha1' as const,
          kind: 'applicationOperation' as const,
          id: operation.id,
          model: operation.model,
          name: operation.name,
          operation: operation.operation as 'create' | 'update' | 'delete',
          transport: 'command' as const,
        },
        command: { nodeId: commandNode.id },
        handler: { nodeId: handler.id },
      }];
    })
    .filter(
      (binding, index, all) =>
        !/^generatedCall\d+$/.test(binding.identifier)
        && all.findIndex(
          (candidate) =>
            candidate.identifier === binding.identifier
            && candidate.operationId === binding.operationId,
        ) === index,
    )
    .sort((left, right) =>
      `${left.identifier}:${left.operationId}`.localeCompare(
        `${right.identifier}:${right.operationId}`,
      ));
}

function normalizeApplicationStreamBatchOptions(
  name: string,
  options: ApplicationStreamBatchOptions,
): NonNullable<import('@applik8s/core').ApplicationStreamProcessorNode['batch']> {
  const maxItems = options.batch.maxItems;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 1_000) {
    throw new Error(`Application batch processor ${name} maxItems must be an integer between 1 and 1000.`);
  }
  if (options.ordering !== 'partition') {
    throw new Error(`Application batch processor ${name} supports only partition ordering.`);
  }
  if (options.acknowledgement !== undefined && options.acknowledgement !== 'wholeBatch') {
    throw new Error(`Application batch processor ${name} supports only wholeBatch acknowledgement.`);
  }
  return {
    maxItems,
    maxBytes: applicationStreamBoundedQuantity(options.batch.maxBytes, 'bytes', name),
    maxWaitMs: applicationStreamBoundedQuantity(options.batch.maxWait, 'duration', name),
    ordering: 'partition',
    acknowledgement: 'wholeBatch',
    membership: 'durableFrozenManifest',
  };
}

function applicationStreamBoundedQuantity(
  input: string | number,
  kind: 'bytes' | 'duration',
  name: string,
): number {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 1) throw new Error(`Application batch processor ${name} ${kind} bound must be a positive safe integer.`);
    return input;
  }
  const units = kind === 'bytes'
    ? { B: 1, KiB: 1_024, MiB: 1_048_576 }
    : { ms: 1, s: 1_000, m: 60_000 };
  const match = /^([1-9][0-9]*)(B|KiB|MiB|ms|s|m)$/.exec(input.trim());
  const multiplier = match ? units[match[2] as keyof typeof units] : undefined;
  const value = match && multiplier ? Number(match[1]) * multiplier : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Application batch processor ${name} ${kind} bound ${JSON.stringify(input)} is invalid.`);
  }
  return value;
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
		const kind = target.kind === 'applicationTask' ? 'task' : target.kind === 'applicationWorkflow' ? 'workflow' : undefined;
		if (!kind) throw new Error(`Application stream processor ${processorNodeId} workflow ${alias} must target an application workflow or legacy task binding.`);
		const nodeId = reactiveNodeId(kind, target.definition.id);
		const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
		if (node?.kind !== kind) throw new Error(`Application stream processor ${processorNodeId} workflow ${alias} references unregistered ${kind} ${target.definition.id}.`);
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
  addApplicationGraphNode(state, { id: nodeId, kind: 'subscription', name, stability: 'stable', source, delivery: options.delivery ?? 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authority: applicationSubscriptionPolicyAuthority(), authorizationSource: authorization.source, ...(authorization.dependencies ? { authorizationDependencies: authorization.dependencies } : {}), ...(authorization.location ? { authorizationLocation: authorization.location } : {}), ...(authorization.unresolved ? { authorizationUnresolved: authorization.unresolved } : {}), retry, suspension: 'bounded-failures' });
  addApplicationGraphEdge(state, { from: { nodeId }, to: source, relationship: 'reads' });
  return { kind: 'applicationSubscription', name, source: options.source, async authorize(principal) { return options.authorize({ principal }); } };
}

/**
 * Subscription visibility is decided by its required authorization callback.
 * Record that callback as application-policy authority so production builds do
 * not force authors to restate the same policy through another API.
 */
function applicationSubscriptionPolicyAuthority(): ApplicationOperationAuthorizationContract {
  return {
    classification: 'application-policy',
    permissionIds: [],
    grantable: false,
    delegable: false,
    scope: { kind: 'all' },
    transports: ['http', 'event'],
  };
}

export function registerApplicationProjection<TPayload extends object, TRow extends object>(state: ApplicationReactiveState, name: string, options: ApplicationAnalyticalProjectionOptions<TPayload, TRow>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
export function registerApplicationProjection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object>(state: ApplicationReactiveState, name: string, options: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
export function registerApplicationProjection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object>(state: ApplicationReactiveState, name: string, options: ApplicationProjectionOptions<TPayload, TRow, TValue, TSnapshot>): ApplicationProjectionBinding<TPayload, TRow, TValue> {
  if ('store' in options) return registerOnlineApplicationProjection(state, name, options);
  const providerInput =
    options.provider
    ?? state.providers.analytics
    ?? state.defaults.analytics;
  const provider = applicationAnalyticalDatabaseImplementation(providerInput);
  const selection = applicationProviderSelectionFor<ApplicationAnalyticalDatabaseProvider>(
    providerInput,
  );
  if (!provider && !selection) {
    throw new Error(
      `Application projection ${name} requires an AnalyticalDatabase provider.`,
    );
  }
  const qualification = applicationProviderQualificationFor(options.provider);
  const selectedProvider = provider ?? selection;
  if (!selectedProvider) {
    throw new Error(`Projection ${name} requires an explicit provider or an application provider selection.`);
  }
  const providerNode = recordProjectionProvider(state, selectedProvider, qualification);
  const nodeId = reactiveNodeId('projection', name);
  const source = sourceNodeRef(options.source);
  if (options.checkpoint && options.checkpoint !== 'idempotent') throw new Error(`Application projection ${name} supports only idempotent analytical checkpoints.`);
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
    ...(options.__capabilityFields?.length
      ? { capabilityFields: options.__capabilityFields }
      : {}),
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
  const requirement = `analytical-database.${reactiveName(name)}`;
  addApplicationProviderRequirement(state, { id: requirement, interface: 'AnalyticalDatabase', consumer: { nodeId }, provider: providerNode, required: true, purpose: 'analyticalDatabase', diagnostics: { missing: `Projection ${name} requires an AnalyticalDatabase provider.`, ambiguous: `Projection ${name} has multiple AnalyticalDatabase providers.` } });
  addApplicationProviderBinding(state, { requirement, provider: providerNode, generatedResources: [], runtime: {}, metadataLinks: [] });
  return {
    kind: 'applicationProjection',
    storage: 'analytical',
    name,
    source: options.source,
    provider: (options.provider ?? provider) as
      | ApplicationAnalyticalDatabaseProvider
      | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>,
    output: options.output,
    project: options.project,
  };
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
    ...(options.__capabilityFields?.length
      ? { capabilityFields: options.__capabilityFields }
      : {}),
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
  addApplicationProviderRequirement(state, { id: requirement, interface: 'IndexStore', consumer: { nodeId }, provider: providerNode, required: true, purpose: 'onlineIndex', diagnostics: { missing: `Online projection ${name} requires an IndexStore provider.`, ambiguous: `Online projection ${name} has multiple IndexStore providers.` } });
  addApplicationProviderBinding(state, { requirement, provider: providerNode, generatedResources: [], runtime: {}, metadataLinks: [] });
  let binding: ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  binding = {
    kind: 'applicationProjection', storage: 'online', name, source: options.source, provider, output: options.output,
    map: options.map, partitionBy: options.partitionBy, key: options.key, score: options.score, value: options.value,
    ...(options.removeWhen ? { removeWhen: options.removeWhen } : {}), retention: options.retention, generationScoped: true,
    rebuild: (input) => applicationProjectionRuntime(binding).rebuild(input),
    retire: (input) => applicationProjectionRuntime(binding).retire(input),
  };
  if (options.rebuild) {
    const objectStorage = applicationObjectStorageImplementation(
      state.providers.objects ?? state.defaults.objects,
    );
    const maxSegmentBytes = objectStorage?.kind === 'kubernetes-configmap-objects'
      ? Math.min(8_000_000, objectStorage.maxObjectBytes ?? 524_288)
      : 8_000_000;
    const artifacts = registerApplicationObjectStore(
      state,
      `${reactiveName(name)}-rebuild-artifacts`,
      {
        maxObjectBytes: maxSegmentBytes,
        contentTypes: [
          'application/vnd.applik8s.projection-segment+json',
          'application/vnd.applik8s.projection-rebuild+json',
        ],
        mode: 'immutable',
        deletion: 'explicit',
      },
    );
    attachApplicationProjectionRebuildTarget(binding, {
      artifacts,
      bounds: {
        batchSize: 500,
        maxSegments: 20_000,
        maxSegmentBytes,
        maxEvents: 10_000_000,
        maxCatchUpRounds: 32,
      },
    });
  }
  return binding;
}

function serializeProjectionCallback(name: string, property: string, callback: (...args: never[]) => unknown) {
  assertApplicationProjectionCallbackPurity(`${name} ${property}`, callback);
  return serializeApplicationCallback({ registrar: 'projection', argumentIndex: 1, property, label: `Application projection ${name} ${property}`, callback, allowDeferredResolution: true });
}

function assertApplicationProjectionCallbackPurity(
  label: string,
  callback: (...args: never[]) => unknown,
  options: { readonly allowAsync?: boolean } = {},
): void {
  if (!options.allowAsync && callback.constructor.name === 'AsyncFunction') {
    throw new Error(
      `Application projection ${label} must be synchronous and pure. Move asynchronous work to Stream.onEvent(...) or Stream.onBatch(...).`,
    );
  }
  const inferred = expandApplicationCallbackDependencies({ calls: [callback] });
  const effects = new Set<string>();
  for (const binding of inferred.providerBindings) {
    effects.add(`${binding.identifier} (${binding.provider.interface})`);
  }
  for (const callable of inferred.callables) {
    effects.add(`${callable.identifier} (${callable.runtime})`);
  }
  for (const [identifier, value] of Object.entries(inferred.bindings)) {
    if (applicationModelCommandBindingForOperation(value)) {
      effects.add(`${identifier} (model mutation)`);
      continue;
    }
    if (applicationQueryBindingForOperation(value)) {
      effects.add(`${identifier} (application query)`);
      continue;
    }
    const operation = getApplicationOperationContract(value);
    if (operation) {
      effects.add(`${identifier} (${operation.id})`);
      continue;
    }
    const kind = value && (typeof value === 'object' || typeof value === 'function')
      ? Reflect.get(value, 'kind')
      : undefined;
    if (
      kind === 'applicationTask'
      || kind === 'applicationWorkflow'
      || kind === 'applicationSchedule'
      || kind === 'applicationActor'
      || kind === 'applik8sCommand'
      || kind === 'applik8sEvent'
      || kind === 'applik8sTask'
      || kind === 'applik8sWorkflow'
    ) {
      effects.add(`${identifier} (${String(kind)})`);
    }
  }
  if (effects.size > 0) {
    throw new Error(
      `Application projection ${label} must be a pure source-to-write transformation and cannot capture application effects or provider handles: ${[...effects].sort().join(', ')}. Move effectful work to Stream.onEvent(...) or Stream.onBatch(...).`,
    );
  }
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
  if (commandRefs.length > 0 && !options.authorizeCommand && options.visibility !== 'internal') {
    throw new Error(`Application gateway ${name} exposes commands and must declare authorizeCommand.`);
  }
  if (options.authorizeCommand) {
    for (const command of options.commands ?? []) {
      const contract = getApplicationOperationContract(command);
      if ((contract?.authority?.classification ?? 'unclassified') !== 'unclassified') continue;
      const classify = (typeof command === 'function' || (typeof command === 'object' && command !== null))
        ? Reflect.get(command, 'applicationPolicy')
        : undefined;
      if (typeof classify !== 'function') {
        throw new Error(
          `Application gateway ${name} cannot classify command ${contract?.id ?? '<unknown>'} through its application policy.`,
        );
      }
      Reflect.apply(classify, command, []);
    }
  }
  const deployment = options.deployment;
  if (deployment?.cursorSecret.namespace && deployment.cursorSecret.namespace !== deployment.namespace) throw new Error(`Application gateway ${name} cannot mount cursor Secret from another namespace.`);
  // typecast: generated authentication receives the standard Request boundary and returns the declared gateway identity contract.
  const authentication = deployment
    ? deployment.authenticate
      ? serializeApplicationCallback({ registrar: 'gateway', argumentIndex: 1, property: 'deployment.authenticate', label: `Application gateway ${name} authentication`, callback: deployment.authenticate as (...args: never[]) => unknown, allowDeferredResolution: true })
      : applicationIdentityAuthentication(state, name)
    : undefined;
  const identityProvider = state.providers.extensions?.['IdentityProvider@v1alpha1'];
  const identityReadiness = deployment
    ? applicationIdentityReadiness(identityProvider, name)
    : undefined;
  const authorizationProvider = state.providers.extensions?.['Authorization@v1alpha1'];
  const authorizationReadyCallback = authorizationProvider && typeof authorizationProvider === 'object' ? Reflect.get(authorizationProvider, 'ready') : undefined;
  const authorizationReadiness = deployment && typeof authorizationReadyCallback === 'function'
    ? serializeApplicationCallback({ registrar: 'Authorization', argumentIndex: 1, property: 'ready', label: `Application gateway ${name} authorization readiness`, callback: authorizationReadyCallback as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  // typecast: generated command admission receives a schema-validated command input and the gateway-established principal.
  const commandAuthorization = options.authorizeCommand ? serializeApplicationCallback({ registrar: 'gateway', argumentIndex: 1, property: 'authorizeCommand', label: `Application gateway ${name} command authorization`, callback: options.authorizeCommand as (...args: never[]) => unknown, allowDeferredResolution: true }) : undefined;
  addApplicationGraphNode(state, {
    id: nodeId, kind: 'gateway', name, stability: 'stable', visibility: options.visibility ?? 'public', queries: queryRefs, commands: commandRefs, subscriptions: subscriptionRefs, transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: limits, routes: { snapshots: `${basePath}/:query/snapshot`, subscriptions: `${basePath}/:query/subscribe`, streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation',
    materialization: deployment ? 'generatedDeployment' : 'runtimeOnly',
    ...(authentication && isApplicationProfiledCallback(authentication)
      ? { authenticationProfile: authentication }
      : authentication
        ? {
            authenticationSource: authentication.source,
            ...(authentication.dependencies ? { authenticationDependencies: authentication.dependencies } : {}),
            ...(authentication.location ? { authenticationLocation: authentication.location } : {}),
            ...(authentication.unresolved ? { authenticationUnresolved: authentication.unresolved } : {}),
          }
        : {}),
    ...(identityReadiness && isApplicationProfiledCallback(identityReadiness)
      ? { identityReadinessProfile: identityReadiness }
      : identityReadiness
        ? {
            identityReadinessSource: identityReadiness.source,
            ...(identityReadiness.dependencies ? { identityReadinessDependencies: identityReadiness.dependencies } : {}),
            ...(identityReadiness.location ? { identityReadinessLocation: identityReadiness.location } : {}),
            ...(identityReadiness.unresolved ? { identityReadinessUnresolved: identityReadiness.unresolved } : {}),
          }
        : {}),
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

function applicationIdentityAuthentication(
  state: ApplicationReactiveState,
  gateway: string,
): SerializedApplicationCallback | ApplicationProfiledCallbackContract {
  const configured = state.providers.extensions?.['IdentityProvider@v1alpha1'];
  const selection =
    applicationProviderSelectionFor<ApplicationIdentityProvider>(configured);
  if (selection) {
    return applicationProfiledIdentityCallback(
      selection,
      (provider, variant) =>
        serializeApplicationIdentityAuthentication(
          provider,
          `Application gateway ${gateway} ${variant} identity authentication`,
        ),
    );
  }
  if (isApplicationIdentityProvider(configured)) {
    return serializeApplicationIdentityAuthentication(
      configured,
      `Application gateway ${gateway} identity authentication`,
    );
  }
  const candidates = state.graphNodes
    .filter((node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === 'IdentityProvider'
      && node.config?.identity !== undefined)
    .map((node) => {
      const identity = node.config?.identity;
      return identity && typeof identity === 'object' && !Array.isArray(identity)
        ? {
            node,
            identity: identity as Readonly<Record<string, JsonValue>>,
          }
        : undefined;
    })
    .filter((candidate) => candidate !== undefined);
  if (candidates.length !== 1) {
    throw new Error(
      `Generated application gateway ${gateway} requires exactly one supplied IdentityProvider when deployment.authenticate is omitted; found ${candidates.length}.`,
    );
  }
  const candidate = candidates[0];
  const source = candidate?.identity.authenticationSource;
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error(
      `Generated application gateway ${gateway} cannot hydrate authentication from ${candidate?.node.id ?? 'IdentityProvider'} because it has no serializable authentication source.`,
    );
  }
  const dependencies = candidate?.identity.authenticationDependencies;
  const location = candidate?.identity.authenticationLocation;
  const unresolved = candidate?.identity.authenticationUnresolved;
  return {
    source,
    ...(dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)
      ? {
          dependencies: dependencies as unknown as NonNullable<
            SerializedApplicationCallback['dependencies']
          >,
        }
      : {}),
    ...(location && typeof location === 'object' && !Array.isArray(location)
      ? {
          location: location as unknown as NonNullable<
            SerializedApplicationCallback['location']
          >,
        }
      : {}),
    ...(Array.isArray(unresolved)
      ? {
          unresolved: unresolved.filter(
            (identifier): identifier is string => typeof identifier === 'string',
          ),
        }
      : {}),
  };
}

function applicationIdentityReadiness(
  configured: unknown,
  gateway: string,
): SerializedApplicationCallback | ApplicationProfiledCallbackContract | undefined {
  const selection =
    applicationProviderSelectionFor<ApplicationIdentityProvider>(configured);
  if (selection) {
    const candidates = [
      ...Object.values(selection.cases),
      selection.default,
    ];
    if (!candidates.some((provider) => typeof provider.ready === 'function')) {
      return undefined;
    }
    return applicationProfiledIdentityCallback(
      selection,
      (provider, variant) =>
        typeof provider.ready === 'function'
          ? serializeApplicationCallback({
              registrar: 'IdentityProvider',
              argumentIndex: 1,
              property: 'ready',
              label: `Application gateway ${gateway} ${variant} identity readiness`,
              callback: provider.ready as (...args: never[]) => unknown,
              allowDeferredResolution: true,
            })
          : { source: 'async () => undefined' },
    );
  }
  if (!isApplicationIdentityProvider(configured) || typeof configured.ready !== 'function') {
    return undefined;
  }
  return serializeApplicationCallback({
    registrar: 'IdentityProvider',
    argumentIndex: 1,
    property: 'ready',
    label: `Application gateway ${gateway} identity readiness`,
    callback: configured.ready as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
}

function serializeApplicationIdentityAuthentication(
  provider: ApplicationIdentityProvider,
  label: string,
): SerializedApplicationCallback {
  if (provider.deterministicAdmission) {
    return {
      source: `async () => (${JSON.stringify(provider.deterministicAdmission)})`,
    };
  }
  return serializeApplicationCallback({
    registrar: 'IdentityProvider',
    argumentIndex: 0,
    property: 'authenticate',
    label,
    callback: provider.authenticate as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
}

function applicationProfiledIdentityCallback(
  selection: ApplicationProviderSelectionValue<ApplicationIdentityProvider>,
  serialize: (
    provider: ApplicationIdentityProvider,
    variant: string,
  ) => SerializedApplicationCallback,
): ApplicationProfiledCallbackContract {
  const entries = Object.entries(selection.cases);
  for (const [variant, provider] of [
    ...entries,
    ['default', selection.default] as const,
  ]) {
    if (!isApplicationIdentityProvider(provider)) {
      throw new Error(
        `Application IdentityProvider profile branch ${variant} does not satisfy the identity provider contract.`,
      );
    }
  }
  return {
    selector: selection.selector,
    cases: Object.fromEntries(
      entries.map(([variant, provider]) => [
        variant,
        serialize(provider, variant),
      ]),
    ),
    default: serialize(selection.default, 'default'),
  };
}

function isApplicationProfiledCallback(
  value: SerializedApplicationCallback | ApplicationProfiledCallbackContract,
): value is ApplicationProfiledCallbackContract {
  return (
    typeof Reflect.get(value, 'selector') === 'string'
    && Reflect.get(value, 'cases') !== undefined
    && Reflect.get(value, 'default') !== undefined
  );
}

function isApplicationQueryBinding(value: unknown): value is ApplicationQueryBinding {
  return Boolean(
    value
    && (typeof value === 'object' || typeof value === 'function')
    && Reflect.get(value, 'kind') === 'applicationQuery',
  );
}

function isApplicationModelCommandBinding(value: unknown): value is ApplicationModelCommandBinding {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationModelCommand');
}

function reactiveDatabaseRuntime(binding: ApplicationDatabaseBinding): { readonly name: string; readonly connectionEnvName: string; readonly secretName: string; readonly secretKey: string; readonly secretNamespace?: string; readonly access?: { readonly context: string; readonly contextSchema: JsonObject; readonly setting: string; readonly column: string; readonly default: 'required' | 'global' } } {
  const provider = binding.provider;
  const clusterName = provider.clusterName ?? provider.name ?? `${reactiveName(binding.name)}-db`;
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return { name: binding.name, connectionEnvName: `APPLIK8S_DATABASE_${reactiveName(binding.name).replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_URL`, secretName: applicationTypeKroSerializedValue(secret.name ?? `${clusterName}-app`), secretKey: applicationTypeKroSerializedValue(provider.connectionSecretKey ?? 'uri'), ...(secret.namespace ?? provider.namespace ? { secretNamespace: applicationTypeKroSerializedValue(secret.namespace ?? provider.namespace) } : {}), ...(binding.access ? { access: { context: binding.access.context.name, contextSchema: binding.access.context.contract.jsonSchema, setting: binding.access.setting, column: binding.access.column, default: binding.access.default } } : {}) };
}

function recordProjectionProvider(
  state: ApplicationReactiveState,
  provider:
    | ApplicationAnalyticalDatabaseProvider
    | import('./application-providers.js').ApplicationProviderSelectionValue<ApplicationAnalyticalDatabaseProvider>,
  qualification?: ApplicationProviderQualification,
): ApplicationProviderRef<'AnalyticalDatabase'> {
  const nodeId = applicationProviderGraphNodeId(
    'AnalyticalDatabase',
    qualification,
  );
  const existing = state.graphNodes.find(
    (candidate) => candidate.id === nodeId,
  );
  if (existing) {
    if (
      existing.kind !== 'provider'
      || existing.interface !== 'AnalyticalDatabase'
    ) {
      throw new Error(
        `AnalyticalDatabase provider identity ${nodeId} collides with ${existing.kind} ${existing.name}.`,
      );
    }
    return { interface: 'AnalyticalDatabase', nodeId };
  }
  if ('cases' in provider) {
    const candidates = [
      ...Object.values(provider.cases),
      provider.default,
    ];
    if (!candidates.every(isApplicationAnalyticalDatabaseProvider)) {
      throw new Error(
        'Every profile-selected AnalyticalDatabase branch must satisfy the analytical capability.',
      );
    }
    throw new Error(
      `Profile-selected AnalyticalDatabase ${nodeId} must be registered before a projection consumes it.`,
    );
  }
  if (
    isClickHouseAnalyticalDatabaseProvider(provider)
    && provider.credentialsSecret
    && !provider.credentialsSecret.name
  ) {
    throw new Error(
      'ClickHouse AnalyticalDatabase credentialsSecret must declare a Secret name.',
    );
  }
  if (isPostgresAnalyticalDatabaseProvider(provider)) {
    const database = applicationTransactionalDatabaseImplementation(
      provider.database,
    );
    if (!database) {
      throw new Error(
        'Analytics.postgres(...) must reference a resolvable TransactionalDatabase binding.',
      );
    }
    const node: ApplicationProviderNode<'AnalyticalDatabase'> = {
      id: nodeId,
      kind: 'provider',
      name: 'AnalyticalDatabase',
      stability: 'stable',
      interface: 'AnalyticalDatabase',
      implementation: 'postgres-analytics',
      contract: {
        apiVersion: 'applik8s.provider/v1alpha1',
        interface: 'AnalyticalDatabase',
        version: 'v1alpha1',
        requirements: ['replayableSource'],
        guarantees: ['idempotentInsert', 'checkpoint', 'fullRebuild'],
        implementation: { name: 'postgres-analytics' },
        surface: 'stablePublicApi',
        support: 'implemented',
        diagnostics: [],
      },
      config: {
        provider: 'postgres-analytics',
        ...(qualification
          ? { qualification: qualification as unknown as JsonValue }
          : {}),
        schema: provider.schema,
        database: applicationTypeKroGraphValue(database) as JsonValue,
      },
    };
    addApplicationGraphNode(state, node);
    return { interface: 'AnalyticalDatabase', nodeId };
  }
  if (!isClickHouseAnalyticalDatabaseProvider(provider)) {
    throw new Error('Unsupported AnalyticalDatabase implementation.');
  }
  const node: ApplicationProviderNode<'AnalyticalDatabase'> = {
    id: nodeId,
    kind: 'provider',
    name: 'AnalyticalDatabase',
    stability: 'stable',
    interface: 'AnalyticalDatabase',
    implementation: applicationProviderImplementationName(provider),
    contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'AnalyticalDatabase', version: 'v1alpha1', requirements: ['replayableSource'], guarantees: ['idempotentInsert', 'checkpoint', 'fullRebuild'], implementation: { name: 'clickhouse' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    config: { provider: 'clickhouse', ...(qualification ? { qualification: qualification as unknown as JsonValue } : {}), enabled: provider.enabled ?? true, name: provider.name ?? 'applik8s-analytics', namespace: provider.namespace ?? 'applik8s-analytics', provision: provider.provision ?? true, endpoint: provider.endpoint ?? applicationTypeKroString('http://clickhouse-', provider.name ?? 'applik8s-analytics', '.', provider.namespace ?? 'applik8s-analytics', '.svc.cluster.local:8123'), database: provider.database ?? 'default', ...(provider.credentialsSecret?.name ? { credentialsSecret: { apiVersion: provider.credentialsSecret.apiVersion, kind: provider.credentialsSecret.kind, name: provider.credentialsSecret.name, ...(provider.credentialsSecret.namespace ? { namespace: provider.credentialsSecret.namespace } : {}) }, usernameKey: provider.usernameKey ?? 'username', passwordKey: provider.passwordKey ?? 'password' } : {}) },
  };
  addApplicationGraphNode(state, node);
  return { interface: 'AnalyticalDatabase', nodeId };
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
