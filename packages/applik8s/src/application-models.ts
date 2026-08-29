// typecast-file-boundary: schema-normalized model contracts cross erased runtime registries here; casts restore their declaration-time generics after identity checks.
import { createHash } from 'node:crypto';
import type { ApplicationMutationOperation, ApplicationOperationAuthorizationContract, ApplicationOperationLike } from '@applik8s/client';
import type { ApplicationAuthorizationReceipt, ApplicationCommandHandlerNode, ApplicationCommandRetentionContract, ApplicationExpressionContract, ApplicationGeneratedResourceContract, ApplicationMessageContractSchema, ApplicationMigrationContract, ApplicationModelConstraint, ApplicationModelIndex, ApplicationModelNode, ApplicationModelOperationGraphContract, ApplicationProcessorNode, ApplicationProviderInterfaceContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef, ApplicationRetentionPolicy, ApplicationRetryPolicy, ApplicationTransactionalDatabaseGuaranteesContract, ApplicationTransactionalDatabaseSemanticsContract, JsonValue } from '@applik8s/core';
import { applicationAuthorityPostgresSchemaStatements } from '@applik8s/operations';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import { type as arkType } from 'arktype';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import { applicationGeneratedJobDurableStatus, applicationGeneratedJobObservability, applicationGeneratedJobPhase, applicationGeneratedJobRetry, applicationGeneratedJobRuntime, applicationGeneratedJobStatusLifecycle, applicationGeneratedJobStatusUpdater } from './application-jobs.js';
import { type ApplicationProcessorOptions, normalizeApplicationProcessorOptions, sameApplicationProcessorDeployment } from './application-processor-policy.js';
import type { ApplicationAnalyticalDatabaseProvider, ApplicationEventLogProvider, ApplicationProviderBinding, ApplicationProviderQualification, ApplicationProviderState, ApplicationTransactionalDatabaseProvider } from './application-providers.js';
import { applicationEventLogImplementation, applicationProviderImplementationName, applicationProviderInterface, applicationProviderQualificationFor, applicationProviderSelectionFor, applicationTransactionalDatabaseImplementation } from './application-providers.js';
import { analyzeApplicationServerRouteSource, applicationCommandSourceViolations, serializedCallbackClosureMessage, unsupportedRouteFreeIdentifiers } from './application-route-source.js';
import { applicationTypeKroGraphValue, applicationTypeKroJsonStringArray, applicationTypeKroSerializedValue, applicationTypeKroString, applicationTypeKroValueIdentity } from './application-typekro-values.js';
import type { ApplicationCommandPrincipal } from './command-principal.js';
import { type CommandDefinition, type EntityDefinition, type EventDefinition, event } from './dsl.js';
import { type ApplicationEventLogPublisher, createApplicationEventLogPublisherFromEnvironment, type EventLogPublishAcknowledgement } from './event-log-runtime.js';
import type { PostgresModelCommandResult } from './model-command-postgres-runtime.js';
import { canonicalApplicationCommandKey, executePostgresModelCommand } from './model-command-postgres-runtime.js';
import { applicationModelCommandBindingForOperation, applicationModelFacet, type DrizzleAnalyticalApplicationModelFacet, type DrizzleApplicationModelFacet, getApplicationModelFacet, nativeApplicationModelBindingFor } from './native-models.js';
import { createPostgresModelClient } from './transactional-database-postgres-runtime.js';

const applicationModelCommandAuthorities = new WeakMap<object, Map<string, ApplicationOperationAuthorizationContract>>();

export interface ApplicationModelOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly name?: string;
  readonly database?: ApplicationTransactionalDatabaseProvider | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly schema?: ApplicationModelSchemaOptions<TSpec, TStatus>;
}

export interface ApplicationModelSchemaOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly identity?: readonly (keyof TSpec | string)[];
  readonly constraints?: readonly ApplicationModelConstraintOptions<TSpec, TStatus>[];
  readonly indexes?: readonly ApplicationModelSchemaIndexOptions<TSpec, TStatus>[];
  readonly transactions?: 'required' | 'supported' | 'unsupported';
  readonly retention?: ApplicationRetentionPolicy;
}

export interface ApplicationModelConstraintOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly name: string;
  readonly fields: readonly (keyof TSpec | keyof TStatus | string)[];
  readonly kind: 'unique' | 'foreignKey' | 'check';
}

export interface ApplicationModelSchemaIndexOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> extends ApplicationModelIndexOptions<TSpec, TStatus> {
  readonly name: string;
}

export interface ApplicationModelBinding<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly kind: 'applicationModel';
  readonly name: string;
  readonly entity: EntityDefinition<TSpec, TStatus>;
  readonly runtime: ApplicationRuntimeModelContract;
  readonly backend: ApplicationModelBackendContract;
  create(input: ApplicationModelCreateInput<TSpec> | TSpec): Promise<ApplicationModelObject<TSpec, TStatus>>;
  get(ref: ApplicationModelRef): Promise<ApplicationModelObject<TSpec, TStatus> | undefined>;
  query(options?: ApplicationModelQueryOptions<TSpec>): Promise<ApplicationModelQueryPage<TSpec, TStatus>>;
  patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<TSpec, TStatus>): Promise<ApplicationModelObject<TSpec, TStatus>>;
  delete(ref: ApplicationModelRef): Promise<void>;
  index(name: string, options?: ApplicationModelIndexOptions<TSpec, TStatus>): ApplicationModelIndexBinding<TSpec, TStatus>;
  transaction<TResult>(handler: (model: ApplicationModelTransactionClient<TSpec, TStatus>) => TResult | Promise<TResult>): Promise<TResult>;
  readonly on: ApplicationModelEventRegistrar<TSpec, TStatus>;
}

export type ApplicationCommandKey = string | number | boolean | Readonly<Record<string, string | number | boolean>>;

export interface ApplicationCommandRoutingContext {
  readonly principal?: import('@applik8s/core').ApplicationPrincipal;
  readonly authorizationVersion?: string;
  readonly trustedContext?: Readonly<Record<string, JsonValue>>;
}

export interface ApplicationModelCommandOptions<
  TInput extends object,
  TSpec extends object,
> {
  readonly key: (
    input: TInput,
    context?: ApplicationCommandRoutingContext,
    messageId?: string,
  ) => ApplicationCommandKey;
  readonly ordering?: 'serial' | 'concurrent';
  readonly idempotencyKey?: (input: TInput) => string;
  /** Route a missing submitted key to this alternate key in the same model. */
  readonly missing?: 'reject' | { readonly initialize: (input: TInput, targetKey: string) => TSpec } | { readonly route: string };
  /** Concise primary-model history declaration. Equivalent to adding this model to transaction.history. */
  readonly history?: boolean;
  /** Concise domain outbox declaration. Equivalent to transaction.outbox. */
  readonly events?: readonly EventDefinition<object>[];
  readonly transaction?: {
    readonly models?: readonly ApplicationModelTransactionParticipant[];
    readonly history?: readonly ApplicationModelTransactionParticipant[];
    readonly outbox?: readonly EventDefinition<object>[];
    readonly commands?: readonly (CommandDefinition<object, object, Readonly<Record<string, object>>> | ApplicationOperationLike)[];
  };
  readonly retry?: ApplicationRetryPolicy;
  readonly retention?: Partial<ApplicationCommandRetentionContract>;
  readonly processor?: ApplicationProcessorOptions;
  /** @internal Compiler-owned direct model operation name. */
  readonly publicName?: string;
  /** @internal Compiler-owned conventional mutation classification. */
  readonly __operation?: ApplicationModelOperationGraphContract['operation'];
  /** @internal Compiler-owned sources for generated lifecycle operations. */
  readonly __generatedSources?: {
    readonly key?: string;
    readonly idempotencyKey?: string;
    readonly initialize?: string;
    readonly handler?: string;
  };
  /** @internal Framework-owned identifiers for generated lifecycle events. */
  readonly __generatedEventBindings?: Readonly<
    Record<string, EventDefinition<object>>
  >;
  /** @internal Closed callback contract for a generated native beforeCommit policy. */
  readonly __generatedBeforeCommit?: import('@applik8s/core').ApplicationSerializedCallbackContract;
  /** @internal Compiler-captured direct model and operation dependencies. */
  readonly __generatedCalls?: readonly unknown[];
  /** @internal Local identifiers for compiler-captured models, events, and operations. */
  readonly __generatedModelBindings?: Readonly<Record<string, unknown>>;
  /** @internal Compiler-captured direct calls whose result was awaited by the authored callback. */
  readonly __generatedAwaitedCalls?: Readonly<Record<string, unknown>>;
}

/** Named models and promoted native Drizzle models share the same transaction-participant experience. */
export type ApplicationModelTransactionParticipant =
  | ApplicationModelBinding<object, object>
  | (AnyPgTable & (
      | { readonly [applicationModelFacet]: unknown }
      // Exported maintained-model declarations intentionally omit the private
      // symbol facet. Their collision-safe direct model surface is still a
      // valid transaction participant; runtime resolution recovers the same
      // canonical facet from the table.
      | { readonly $model: unknown }
    ));

export const defaultApplicationCommandRetention: ApplicationCommandRetentionContract = {
  replayWindowSeconds: 7 * 24 * 60 * 60,
  auditWindowSeconds: 30 * 24 * 60 * 60,
  publishedOutboxWindowSeconds: 24 * 60 * 60,
  cleanupIntervalSeconds: 5 * 60,
  cleanupBatchSize: 1_000,
};

export type ApplicationCommandDomainError<TErrors extends Readonly<Record<string, object>>> = {
  readonly [TName in keyof TErrors & string]: { readonly name: TName; readonly payload: TErrors[TName] };
}[keyof TErrors & string];

export interface ApplicationModelCommandParticipantClient {
  get(ref: ApplicationModelRef): Promise<ApplicationModelObject<object, object> | undefined>;
  /** Bounded transaction-locked equality query over an explicitly declared participant. */
  query(options: ApplicationModelQueryOptions<object> & { readonly limit: number }): Promise<ApplicationModelQueryPage<object, object>>;
  create(input: ApplicationModelCreateInput<object>): Promise<ApplicationModelObject<object, object>>;
  patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<object, object>): Promise<ApplicationModelObject<object, object>>;
  delete(ref: ApplicationModelRef): Promise<void>;
}

export interface ApplicationModelCommandContext<TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>> {
  readonly commandId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly attempt: number;
  readonly now: string;
  /** Gateway-established caller identity persisted in the signed durable envelope. */
  readonly principal?: ApplicationCommandPrincipal;
  /** Provider-admitted context with framework-reserved identity keys removed. */
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly models: Readonly<Record<string, ApplicationModelCommandParticipantClient>>;
  update<TValue extends object>(
    model: ApplicationModelCommandTarget<TValue, object>,
    patch: Partial<TValue>,
    options?: { readonly ifRevision?: string },
  ): Promise<{ readonly value: import('./native-models.js').ApplicationModelSnapshot<TValue>; readonly changed: boolean }>;
  id(scope?: string): string;
  emit<TPayload extends object>(event: EventDefinition<TPayload>, payload: TPayload): void;
  send<TInput extends object, TOutput>(command: ApplicationMutationOperation<TInput, TOutput>, input: TInput, options: { readonly targetKey: ApplicationCommandKey; readonly idempotencyKey?: string }): void;
  send<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(command: CommandDefinition<TInput, TOutput, TErrors>, input: TInput, options: { readonly targetKey: ApplicationCommandKey; readonly idempotencyKey?: string }): void;
  reject<TName extends keyof TErrors & string>(name: TName, payload: TErrors[TName]): never;
}

export interface ApplicationModelCommandTarget<TSpec extends object, TStatus extends object> {
  readonly id: string;
  readonly identity: string;
  readonly value: TSpec;
  readonly spec: TSpec;
  readonly status: TStatus | undefined;
  readonly revision?: string;
  patch(patch: ApplicationModelPatch<TSpec, TStatus>): void;
  /** Marks the locked primary model for transactional deletion after the handler succeeds. */
  delete(): void;
}

export type ApplicationModelCommandHandler<
  TSpec extends object,
  TStatus extends object,
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> = (
  model: ApplicationModelCommandTarget<TSpec, TStatus>,
  input: TInput,
  context: ApplicationModelCommandContext<TErrors>,
) => TOutput | Promise<TOutput>;

export interface ApplicationModelCommandDeliveryOptions {
  readonly id: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  /** Bounded framework telemetry carrier restored from an internal durable envelope. */
  readonly telemetry?: import('@applik8s/core').ApplicationTelemetryEnvelopeV1;
  readonly attempt?: number;
  readonly recordedAt?: string;
  readonly expectedRevision?: string;
  /** Internal trusted-context envelope established by an authenticated server boundary. */
  readonly context?: {
    readonly values: Readonly<Record<string, JsonValue>>;
    readonly digest: string;
    readonly changeScopes?: Readonly<Record<string, string>>;
  };
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  readonly databaseUrl?: string;
  /** Internal durable-envelope override used by declared command outboxes. */
  readonly targetKey?: string;
  /** Internal durable-envelope override used by declared command outboxes. */
  readonly idempotencyKey?: string;
}

export interface ApplicationCommandSubmissionAcknowledgement extends EventLogPublishAcknowledgement {
  readonly phase: 'transportAcknowledged';
  readonly commandId: string;
  readonly correlationId: string;
}

export interface ApplicationModelCommandBinding<TInput extends object = object, TOutput extends object = object, TSpec extends object = object, TStatus extends object = object> {
  readonly kind: 'applicationModelCommand';
  readonly name: string;
  readonly model: string;
  readonly command: string;
  readonly processor: string;
  /** Compiler-authoring bridge from the direct handle to its canonical graph operation. */
  classify(authority: ApplicationOperationAuthorizationContract): void;
  /** Framework-owned deterministic routing used by ambient transaction staging. */
  route(input: TInput, messageId: string, context?: ApplicationCommandRoutingContext): {
    readonly targetKey: ApplicationCommandKey;
    readonly idempotencyKey: string;
  };
  send(input: TInput, delivery: Omit<ApplicationModelCommandDeliveryOptions, 'databaseUrl' | 'targetKey' | 'idempotencyKey'>): Promise<ApplicationCommandSubmissionAcknowledgement>;
  execute(input: TInput, delivery: ApplicationModelCommandDeliveryOptions): Promise<PostgresModelCommandResult<TSpec, TStatus, TOutput>>;
  drain(): Promise<void>;
}

export interface ApplicationModelTransactionClient<TSpec extends object, TStatus extends object = Record<string, never>> {
  create(input: ApplicationModelCreateInput<TSpec> | TSpec): Promise<ApplicationModelObject<TSpec, TStatus>>;
  get(ref: ApplicationModelRef): Promise<ApplicationModelObject<TSpec, TStatus> | undefined>;
  query(options?: ApplicationModelQueryOptions<TSpec>): Promise<ApplicationModelQueryPage<TSpec, TStatus>>;
  patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<TSpec, TStatus>): Promise<ApplicationModelObject<TSpec, TStatus>>;
  delete(ref: ApplicationModelRef): Promise<void>;
  index(name: string, options?: ApplicationModelIndexOptions<TSpec, TStatus>): ApplicationModelIndexBinding<TSpec, TStatus>;
}

export interface ApplicationRuntimeModelContract {
  readonly name: string;
  readonly tableName: string;
  readonly provider: 'postgres';
  /** Stable application-level authority identity used for generated artifacts. */
  readonly authorityName?: string;
  readonly database: string;
  readonly clusterName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly connectionEnvName: string;
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
  readonly retention: ApplicationRetentionPolicy;
  readonly storageShape?: 'jsonb-envelope' | 'native-relational';
  readonly nativeRelational?: {
    readonly schema?: string;
    readonly identity: { readonly property: string; readonly column: string };
    readonly revision?: { readonly property: string; readonly column: string };
    readonly columns: readonly {
      readonly property: string;
      readonly column: string;
      /**
       * Drizzle's logical value type. PostgreSQL drivers may expose a different
       * representation (notably int8 as a string), so generated runtimes must
       * retain this decoder intent rather than guessing from a live value.
       */
      readonly logicalType?: string;
    }[];
    readonly access?: { readonly context: string; readonly setting: string; readonly property: string; readonly column: string };
  };
}

export interface ApplicationModelBackendContract {
  readonly interface: 'TransactionalDatabase';
  readonly provider?: ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly runtimeBoundary: {
    readonly serializedCallbacks: 'generatedRuntimeClient';
    readonly scriptExecution: 'scriptRuntimeClient';
  };
  readonly transactions: 'required' | 'supported' | 'unsupported';
  readonly queryConsistency: 'strong' | 'eventual' | 'providerDefined';
  readonly eventSemantics: 'transactionalOutbox' | 'bestEffort' | 'unsupported';
  readonly limitations: readonly string[];
}

export interface ApplicationModelObject<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly id: string;
  readonly spec: TSpec;
  readonly status?: TStatus;
  readonly revision?: string;
}

export interface ApplicationModelCreateInput<TSpec extends object> {
  readonly id?: string;
  readonly spec: TSpec;
}

export interface ApplicationModelRef {
  readonly id: string;
}

export interface ApplicationModelQueryOptions<TSpec extends object> {
  readonly where?: Partial<TSpec>;
  readonly limit?: number;
  readonly cursor?: string;
  readonly orderBy?: readonly string[];
}

export interface ApplicationModelQueryPage<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly items: readonly ApplicationModelObject<TSpec, TStatus>[];
  readonly nextCursor?: string;
}

export interface ApplicationModelPatch<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly spec?: Partial<TSpec>;
  readonly status?: Partial<TStatus>;
}

export interface ApplicationModelIndexOptions<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly partitionBy?: keyof TSpec | string;
  readonly filter?: Partial<TSpec> | Partial<TStatus>;
  readonly orderBy?: readonly string[];
  readonly unique?: boolean;
}

export interface ApplicationModelIndexBinding<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly name: string;
  query(partition: string, options?: Omit<ApplicationModelQueryOptions<TSpec>, 'where'>): Promise<ApplicationModelQueryPage<TSpec, TStatus>>;
}

export interface ApplicationModelEventRegistrar<TSpec extends object, TStatus extends object = Record<string, never>> {
  created(handler: ApplicationModelEventHandler<TSpec, TStatus>): ApplicationModelEventBinding;
  updated(handler: ApplicationModelEventHandler<TSpec, TStatus>): ApplicationModelEventBinding;
  deleted(handler: ApplicationModelEventHandler<TSpec, TStatus>): ApplicationModelEventBinding;
}

export type ApplicationModelEventHandler<TSpec extends object, TStatus extends object = Record<string, never>> = (model: ApplicationModelObject<TSpec, TStatus>) => unknown | Promise<unknown>;

export interface ApplicationModelEventBinding {
  readonly kind: 'applicationModelEvent';
  readonly event: 'created' | 'updated' | 'deleted';
}

interface ApplicationModelGraphState extends ApplicationGraphState, ApplicationProviderState {
  readonly appResource?: { readonly kind: string };
}

export function resolveApplicationTransactionalDatabase(state: ApplicationModelGraphState, entityName: string, database: ApplicationModelOptions['database']): ApplicationTransactionalDatabaseProvider {
  const implementation = applicationTransactionalDatabaseImplementation(database) ?? applicationTransactionalDatabaseImplementation(state.providers.database) ?? applicationTransactionalDatabaseImplementation(state.defaults.database);
  if (!implementation) {
    throw new Error(`app.model(${JSON.stringify(entityName)}) requires a typed TransactionalDatabase provider. Bind the golden path with app.database.postgres("name"), use app.provide(TransactionalDatabase, TransactionalDatabase.postgres(...)), app.defaults({ database: provider }), or pass { database: provider }.`);
  }
  return implementation;
}

export function recordApplicationModelGraph<TSpec extends object, TStatus extends object>(state: ApplicationModelGraphState, entity: EntityDefinition<TSpec, TStatus>, provider: ApplicationTransactionalDatabaseProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined, runtime: ApplicationRuntimeModelContract): void {
  const modelName = options?.name ?? entity.name;
  const nodeId = applicationGraphNodeId('model', modelName);
  const qualification = applicationProviderQualificationFor(
    options?.database,
  );
  const providerNodeId = applicationProviderNodeId(
    'TransactionalDatabase',
    qualification,
  );
  const providerResources = applicationTransactionalDatabaseProviderResources(provider, modelName);
  const migration = provider.migrations ?? { strategy: 'none', compatibility: 'schemaCompatibleOnly' };
  const schema = options?.schema;
  recordApplicationProviderGraph(
    state,
    'TransactionalDatabase',
    'transactionalDatabase',
    provider,
    qualification,
  );
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'model',
    name: modelName,
    stability: 'stable',
    entity: { name: entity.name },
    database: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    schema: {
      identity: applicationModelIdentity(schema),
      constraints: applicationTransactionalDatabaseConstraints(schema),
      indexes: applicationTransactionalDatabaseIndexes(schema),
      migrations: { strategy: migration.strategy, compatibility: migration.compatibility },
      transactions: schema?.transactions ?? 'supported',
      retention: schema?.retention ?? { mode: 'retain' },
      guarantees: applicationTransactionalDatabaseGuarantees(schema, migration),
    },
    materialization: {
      mode: 'providerBacked',
      provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
      backingResources: providerResources,
      connection: applicationTransactionalDatabaseRuntime(provider, modelName, providerResources),
      runtimeBoundary: applicationModelRuntimeBoundary(),
      reconciliation: { ...applicationTransactionalDatabaseReconciliation(provider), schemaDrift: migration.strategy === 'generatedJob' ? 'generatedMigrationJob' : 'failClosed' },
    },
    common: {
      identity: { fields: applicationModelIdentity(schema), encoding: 'scalar' },
      snapshot: { shape: 'identity-value-revision', revisionOptional: true },
      changes: { authority: 'transactional-database-outbox', rawWrites: 'explicit-invalidation-required' },
      relationships: [],
      operations: [{
        name: 'create',
        operation: 'create',
        transport: 'command',
        publicId: `${modelName}.create`,
        authorization: 'undeclared',
      }],
    },
    runtime,
    generatedResources: providerResources.map((resource) => ({
      role: 'providerDependency',
      graphNode: { nodeId },
      resource,
      artifact: { kind: 'providerContract', name: `${modelName}-transactional-database` },
      dependsOn: [{ nodeId: providerNodeId }],
    })),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  const requirementId = applicationTransactionalDatabaseRequirementId(modelName);
  addApplicationProviderRequirement(state, {
    id: requirementId,
    interface: 'TransactionalDatabase',
    consumer: { nodeId },
    provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    required: true,
    purpose: 'transactionalDatabase',
    diagnostics: {
      missing: `Model ${modelName} requires a TransactionalDatabase provider. Bind the golden path with app.database.postgres("name"), use app.provide(TransactionalDatabase, { kind: "postgres", ... }), or pass an explicit database.`,
      ambiguous: `Model ${modelName} has multiple TransactionalDatabase providers. Bind the model to one provider explicitly.`,
    },
  });
  addApplicationProviderBinding(state, {
    requirement: requirementId,
    provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    generatedResources: providerResources,
    runtime: applicationTransactionalDatabaseRuntime(provider, modelName, providerResources),
    metadataLinks: [{ graphNode: { nodeId: providerNodeId }, artifact: { kind: 'providerContract', name: `${modelName}-transactional-database` }, purpose: 'providerDependency' }],
  });
  if (migration.strategy === 'generatedJob') {
    recordApplicationModelMigrationJobGraph(state, modelName, nodeId, provider, providerResources);
  }
}

// typecast-boundary: Drizzle relation metadata is normalized into the closed graph constraint union after integrity filtering.
export function recordApplicationNativeModelGraph<TTable extends AnyPgTable>(
  state: ApplicationModelGraphState,
  model: DrizzleApplicationModelFacet<TTable>,
  provider: ApplicationTransactionalDatabaseProvider,
  runtime: ApplicationRuntimeModelContract,
  migrations: { readonly artifact?: string; readonly digest?: string } = {},
  qualification?: ApplicationProviderQualification,
): void {
  const nodeId = applicationGraphNodeId('model', model.name);
  const providerNodeId = applicationProviderNodeId(
    'TransactionalDatabase',
    qualification,
  );
  const providerResources = applicationTransactionalDatabaseProviderResources(
    provider,
    runtime.authorityName ?? model.name,
  );
  recordApplicationProviderGraph(
    state,
    'TransactionalDatabase',
    'nativeRelationalModel',
    provider,
    qualification,
  );
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'model',
    name: model.name,
    stability: 'stable',
    entity: { name: model.name },
    database: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    schema: {
      identity: model.identity.fields,
      constraints: model.relationships.filter((relationship) => relationship.integrity === 'foreign-key').map((relationship) => ({ name: `${model.name}_${relationship.name}_fk`, fields: relationship.fields, kind: 'foreignKey' as const })),
      indexes: [],
      migrations: { strategy: migrations.artifact ? 'external' : 'none', compatibility: 'requiresExplicitMigration' },
      transactions: 'required',
      retention: { mode: 'retain' },
      guarantees: {
        identity: 'stableId',
        uniqueness: 'databaseConstraint',
        indexes: 'declaredSecondaryIndexes',
        transactions: 'required',
        retention: 'retain',
        migrationOwnership: migrations.artifact ? 'external' : 'none',
      },
    },
    materialization: {
      mode: 'providerBacked',
      provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
      backingResources: providerResources,
      connection: applicationTransactionalDatabaseRuntime(provider, model.name, providerResources),
      runtimeBoundary: applicationModelRuntimeBoundary(),
      reconciliation: { ...applicationTransactionalDatabaseReconciliation(provider), schemaDrift: 'failClosed' },
    },
    native: {
      kind: 'drizzle-table',
      authority: 'postgres',
      artifact: { name: model.table.name, ...(model.table.schema ? { schema: model.table.schema } : {}), database: model.database, ...(migrations.artifact ? { migrations: { path: migrations.artifact, ...(migrations.digest ? { digest: migrations.digest } : {}) } } : {}) },
      schemaAuthority: 'drizzle',
      runtimeSchema: 'derived-arktype',
      nativeApi: 'preserved',
    },
    common: {
      identity: model.identity,
      ...(model.revision ? { revision: model.revision } : {}),
      snapshot: { shape: 'identity-value-revision', revisionOptional: true },
      changes: { authority: 'postgres-change-log', rawWrites: 'explicit-invalidation-required' },
      relationships: model.relationships,
      ...(model.runtimeRoles ? { runtimeRoles: model.runtimeRoles } : {}),
      operations: [{
        name: 'create',
        operation: 'create',
        transport: 'command',
        publicId: `${model.name}.create`,
        authorization: 'undeclared',
      }],
    },
    runtime: { ...runtime, storageShape: 'native-relational' },
    generatedResources: providerResources.map((resource) => ({
      role: 'providerDependency',
      graphNode: { nodeId },
      resource,
      artifact: { kind: 'providerContract', name: `${model.name}-native-relational-transactional-database` },
      dependsOn: [{ nodeId: providerNodeId }],
    })),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  const requirementId = applicationTransactionalDatabaseRequirementId(model.name);
  addApplicationProviderRequirement(state, {
    id: requirementId,
    interface: 'TransactionalDatabase',
    consumer: { nodeId },
    provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    required: true,
    purpose: 'transactionalDatabase',
    diagnostics: {
      missing: `Native relational model ${model.name} requires its registered PostgreSQL database provider.`,
      ambiguous: `Native relational model ${model.name} is associated with more than one PostgreSQL database provider.`,
    },
  });
  addApplicationProviderBinding(state, {
    requirement: requirementId,
    provider: { interface: 'TransactionalDatabase', nodeId: providerNodeId },
    generatedResources: providerResources,
    runtime: applicationTransactionalDatabaseRuntime(provider, model.name, providerResources),
    metadataLinks: [{ graphNode: { nodeId: providerNodeId }, artifact: { kind: 'providerContract', name: `${model.name}-native-relational-transactional-database` }, purpose: 'providerDependency' }],
  });
}

export function recordApplicationAnalyticalNativeModelGraph<
  TTable extends AnyPgTable,
>(
  state: ApplicationModelGraphState,
  model: DrizzleAnalyticalApplicationModelFacet<TTable>,
  providerInput:
    | ApplicationAnalyticalDatabaseProvider
    | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>,
): void {
  const nodeId = applicationGraphNodeId('model', model.name);
  const qualification = applicationProviderQualificationFor(providerInput);
  const providerNodeId = applicationProviderGraphNodeId(
    'AnalyticalDatabase',
    qualification,
  );
  const implementation =
    providerInput
    && typeof providerInput === 'object'
    && Reflect.get(providerInput, 'kind') === 'applicationProvider'
      ? Reflect.get(providerInput, 'implementation')
      : providerInput;
  if (
    !state.graphNodes.some(
      (node) => node.kind === 'provider' && node.id === providerNodeId,
    )
  ) {
    recordApplicationProviderGraph(
      state,
      'AnalyticalDatabase',
      'nativeAnalyticalModel',
      implementation,
      qualification,
    );
  }
  const providerRef = {
    interface: 'AnalyticalDatabase' as const,
    nodeId: providerNodeId,
  };
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'model',
    name: model.name,
    stability: 'stable',
    entity: { name: model.name },
    database: providerRef,
    schema: {
      identity: model.identity.fields,
      constraints: [],
      indexes: [],
      migrations: {
        strategy: 'none',
        compatibility: 'requiresExplicitMigration',
      },
      transactions: 'unsupported',
      retention: { mode: 'retain' },
    },
    materialization: {
      mode: 'providerBacked',
      provider: providerRef,
      backingResources: [],
      connection: {},
      runtimeBoundary: applicationModelRuntimeBoundary(),
      reconciliation: {
        ownership: 'external',
        schemaDrift: 'failClosed',
        deletionPolicy: 'retain',
      },
    },
    native: {
      kind: 'drizzle-table',
      authority: 'analytical-database',
      artifact: {
        name: model.table.name,
        ...(model.table.schema ? { schema: model.table.schema } : {}),
      },
      schemaAuthority: 'drizzle',
      runtimeSchema: 'derived-arktype',
      nativeApi: 'preserved',
    },
    common: {
      identity: model.identity,
      snapshot: {
        shape: 'identity-value-revision',
        revisionOptional: true,
      },
      changes: {
        authority: 'analytical-checkpoint',
        rawWrites: 'explicit-invalidation-required',
      },
      relationships: model.relationships,
      ...(model.runtimeRoles ? { runtimeRoles: model.runtimeRoles } : {}),
      operations: [],
    },
  });
  addApplicationGraphEdge(state, {
    from: { nodeId: providerNodeId },
    to: { nodeId },
    relationship: 'provides',
  });
  const requirementId = `analytical-database.${model.name}`;
  addApplicationProviderRequirement(state, {
    id: requirementId,
    interface: 'AnalyticalDatabase',
    consumer: { nodeId },
    provider: providerRef,
    required: true,
    purpose: 'analyticalDatabase',
    diagnostics: {
      missing: `Analytical model ${model.name} requires its declared AnalyticalDatabase provider.`,
      ambiguous: `Analytical model ${model.name} is associated with more than one AnalyticalDatabase provider.`,
    },
  });
  addApplicationProviderBinding(state, {
    requirement: requirementId,
    provider: providerRef,
    generatedResources: [],
    runtime: {},
    metadataLinks: [],
  });
}

export function recordApplicationModelCommandGraph<
  TSpec extends object,
  TStatus extends object,
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
>(
  state: ApplicationModelGraphState,
  model: ApplicationModelBinding<TSpec, TStatus>,
  command: CommandDefinition<TInput, TOutput, TErrors>,
  options: ApplicationModelCommandOptions<TInput, TSpec>,
  handler: ApplicationModelCommandHandler<TSpec, TStatus, TInput, TOutput, TErrors>,
): ApplicationModelCommandBinding<TInput, TOutput, TSpec, TStatus> {
  const modelNodeId = applicationGraphNodeId('model', model.name);
  const commandNodeId = applicationGraphNodeId('command', command.id);
  const handlerName = `${model.name}-${command.id}`;
  const handlerNodeId = applicationGraphNodeId('command-handler', handlerName);
  const processorName = options.processor?.group ?? `${model.name}-commands`;
  const processorNodeId = applicationGraphNodeId('processor', processorName);
  const publicName = applicationCommandPublicName(options.publicName, command.name);
  const completionEvent =
    (options.__operation ?? 'custom') === 'custom'
      ? event(
          `models.${model.name}.${publicName}.completed.v1`,
          {
            // typecast: ArkType cannot prove a heterogeneous generic object
            // definition assembled from the model and command schemas, but
            // both schemas already satisfy this registrar's object bounds.
            payload: arkType({
              operation: `'${publicName}'`,
              identity: 'string',
              previous: model.entity.spec,
              current: model.entity.spec,
              result: command.output,
              revision: 'string',
            } as never) as unknown as SchemaInput<object>,
          },
        )
      : undefined;
  if (state.graphNodes.some((node) => node.id === handlerNodeId)) {
    throw new Error(`Model ${model.name} already has a handler for command ${command.id}. Command handlers must be unambiguous within an application graph.`);
  }
  if (state.graphNodes.some((node) => node.kind === 'commandHandler' && node.command.nodeId === commandNodeId)) {
    throw new Error(`Command ${command.id} already has a handler in this application graph. Durable command routing requires exactly one owning handler per versioned command contract.`);
  }

  const key = options.__generatedSources?.key
    ? applicationGeneratedCommandFunctionExpression('key', model.name, command.id, options.__generatedSources.key)
    : applicationCommandFunctionExpression('key', model.name, command.id, options.key);
  const idempotencyKey = options.idempotencyKey
    ? options.__generatedSources?.idempotencyKey
      ? applicationGeneratedCommandFunctionExpression('idempotencyKey', model.name, command.id, options.__generatedSources.idempotencyKey)
      : applicationCommandFunctionExpression('idempotencyKey', model.name, command.id, options.idempotencyKey)
    : undefined;
  const declaredTransactionModels = uniqueApplicationModelBindings(options.transaction?.models ?? []);
  const generatedBindings = Object.entries(options.__generatedModelBindings ?? {});
  const directModelBindings = generatedBindings
    .flatMap(([identifier, participant]) => {
      const normalizedParticipant =
        participant
        && typeof participant === 'object'
        && Reflect.get(participant, 'kind') === 'applicationModel'
          ? participant as ApplicationModelBinding<object, object>
          : participant && typeof participant === 'object'
            ? nativeApplicationModelBindingFor(participant)
            : undefined;
      return normalizedParticipant ? [{ identifier, participant: normalizedParticipant }] : [];
    })
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
  const generatedEvents = [
    ...(completionEvent
      ? [{
          identifier: '__applik8sCompletionEvent',
          event: completionEvent as EventDefinition<object>,
        }]
      : []),
    ...Object.entries(options.__generatedEventBindings ?? {}).map(
      ([identifier, generated]) => ({ identifier, event: generated }),
    ),
    ...generatedBindings.flatMap(([identifier, candidate]) =>
      candidate
      && typeof candidate === 'object'
      && Reflect.get(candidate, 'kind') === 'applik8sEvent'
        ? [{ identifier, event: candidate as EventDefinition<object> }]
        : []),
  ];
  const generatedEventIdentifiers = new Set<string>();
  const generatedEventIdsByIdentifier = new Map<string, string>();
  for (const { identifier, event: generated } of generatedEvents) {
    const previous = generatedEventIdsByIdentifier.get(identifier);
    if (previous && previous !== generated.id) {
      throw new Error(
        `Model ${model.name} command ${command.id} binds generated event identifier ${identifier} to both ${previous} and ${generated.id}.`,
      );
    }
    generatedEventIdentifiers.add(identifier);
    generatedEventIdsByIdentifier.set(identifier, generated.id);
  }
  const generatedCommands = generatedBindings.flatMap(([identifier, candidate]) => {
    if (
      candidate
      && typeof candidate === 'object'
      && Reflect.get(candidate, 'kind') === 'applik8sCommand'
    ) {
      return [{
        identifier,
        command: candidate as CommandDefinition<
          object,
          object,
          Readonly<Record<string, object>>
        >,
      }];
    }
    const binding = applicationModelCommandBindingForOperation(candidate);
    return binding
      ? [{
          identifier,
          command: applicationOutboxCommandDefinition(
            state,
            model.name,
            command.id,
            candidate as ApplicationOperationLike,
          ),
        }]
      : [];
  });
  const selfRead = declaredTransactionModels.some((participant) => participant.name === model.name);
  const transactionModels = uniqueApplicationModelBindings([
    model,
    ...declaredTransactionModels,
    ...directModelBindings.map(({ participant }) => participant),
  ]);
  const historyModels = uniqueApplicationModelBindings([...(options.history ? [model] : []), ...(options.transaction?.history ?? [])]);
  const transactionModelIds = new Set(transactionModels.map((participant) => applicationGraphNodeId('model', participant.name)));
  for (const historyModel of historyModels) {
    if (!transactionModelIds.has(applicationGraphNodeId('model', historyModel.name))) {
      throw new Error(`Model ${model.name} command ${command.id} declares history for ${historyModel.name}, but that model is not a transaction participant.`);
    }
  }
  validateApplicationCommandTransactionDomain(model.name, command.id, transactionModels);

  const generatedEventIds = new Set(generatedEvents.map(({ event }) => event.id));
  const explicitOutboxEvents = [
    ...(options.events ?? []),
    ...(options.transaction?.outbox ?? []),
  ].filter((event) => !generatedEventIds.has(event.id));
  const outboxEvents = [
    ...explicitOutboxEvents,
    ...generatedEvents.map(({ event }) => event),
  ];
  if (new Set(outboxEvents.map((event) => event.id)).size !== outboxEvents.length) throw new Error(`Model ${model.name} command ${command.id} declares a duplicate outbox event.`);
  const generatedCommandIds = new Set(generatedCommands.map(({ command: generated }) => generated.id));
  const explicitOutboxCommands = (options.transaction?.commands ?? [])
    .map((outboxCommand) =>
      applicationOutboxCommandDefinition(state, model.name, command.id, outboxCommand))
    .filter((outboxCommand) => !generatedCommandIds.has(outboxCommand.id));
  const outboxCommands = [
    ...explicitOutboxCommands,
    ...generatedCommands.map(({ command: generated }) => generated),
  ];
  const handlerSource = options.__generatedSources?.handler
    ? applicationGeneratedCommandFunctionSource('handler', model.name, command.id, options.__generatedSources.handler)
    : applicationCommandFunctionSource('handler', model.name, command.id, handler);
  const eventBindings = [
    ...(explicitOutboxEvents.length > 0
      ? applicationCommandEventBindings(
          `${handlerSource}\n${options.__generatedBeforeCommit?.source ?? ''}`,
          explicitOutboxEvents,
          model.name,
          command.id,
          generatedEventIdentifiers,
        )
      : []),
    ...generatedEvents.map(({ identifier, event: generated }) => ({
      identifier,
      event: { nodeId: applicationGraphNodeId('event', generated.id) },
    })),
  ];
  const commandBindings = [
    ...(explicitOutboxCommands.length > 0
      ? applicationCommandOutboxBindings(
          `${handlerSource}\n${options.__generatedBeforeCommit?.source ?? ''}`,
          explicitOutboxCommands,
          model.name,
          command.id,
        )
      : []),
    ...generatedCommands.map(({ identifier, command: generated }) => ({
      identifier,
      command: { nodeId: applicationGraphNodeId('command', generated.id) },
    })),
  ];
  for (const binding of directModelBindings) {
    if ([...eventBindings, ...commandBindings].some(({ identifier }) => identifier === binding.identifier)) {
      throw new Error(`Model ${model.name} command ${command.id} uses ${binding.identifier} as both an emitted contract and a direct model binding.`);
    }
  }
  const retention = applicationCommandRetention(options.retention, model.name, command.id);
  validateApplicationCommandHandlerClosure(
    handlerSource,
    [...eventBindings, ...commandBindings],
    [
      ...directModelBindings.map(({ identifier }) => identifier),
      ...(options.__generatedBeforeCommit
        ? ['__applik8sBeforeCommit', '__applik8sRunBeforeCommit']
        : []),
    ],
    model.name,
    command.id,
  );
  addApplicationGraphNode(state, {
    id: commandNodeId,
    kind: 'command',
    name: command.id,
    stability: 'stable',
    contract: {
      name: command.name,
      version: command.version,
      input: declaredMessageSchema(command.input, `${command.id}.input`),
      output: declaredMessageSchema(command.output, `${command.id}.output`),
      // typecast: Object.keys erases the mapped error-schema value type; every value still originates from command.errors.
      errors: Object.keys(command.errors).sort().map((name) => ({ name, schema: declaredMessageSchema(command.errors[name] as SchemaInput<object>, `${command.id}.errors.${name}`) })),
    },
  });

  const modelNode = state.graphNodes.find((node): node is ApplicationModelNode => node.id === modelNodeId && node.kind === 'model');
  if (!modelNode?.common) throw new Error(`Model ${model.name} command ${command.id} cannot attach its public operation to a missing model graph node.`);
  const authorityKey = `${model.name}:${publicName}`;
  const registeredAuthority = applicationModelCommandAuthorities.get(command)?.get(authorityKey);
  const operation: ApplicationModelOperationGraphContract = {
    name: publicName,
    operation: options.__operation ?? 'custom',
    transport: 'command',
    publicId: command.id,
    input: declaredMessageSchema(command.input, `${command.id}.input`),
    output: declaredMessageSchema(command.output, `${command.id}.output`),
    authorization: 'application-defined',
    ...(registeredAuthority ? { authority: registeredAuthority } : {}),
  };
  const operations = [...(modelNode.common.operations ?? []).filter((candidate) => candidate.name !== publicName), operation];
  addApplicationGraphNode(state, { ...modelNode, common: { ...modelNode.common, operations } });

  const eventLog = applicationEventLogImplementation(state.providers.eventLogs) ?? applicationEventLogImplementation(state.defaults.eventLogs);
  if (!eventLog) {
    throw new Error(`Model ${model.name} command ${command.id} requires an EventLog provider. Bind EventLog to a nats-jetstream provider.`);
  }
  recordApplicationProviderGraph(state, 'EventLog', 'commandTransport', eventLog);
  for (const event of outboxEvents) {
    const eventNodeId = applicationGraphNodeId('event', event.id);
    addApplicationGraphNode(state, {
      id: eventNodeId,
      kind: 'event',
      name: event.id,
      stability: 'stable',
      contract: { name: event.name, version: event.version, payload: declaredMessageSchema(event.payload, `${event.id}.payload`) },
    });
  }
  for (const emittedCommand of outboxCommands) {
    addApplicationGraphNode(state, {
      id: applicationGraphNodeId('command', emittedCommand.id),
      kind: 'command',
      name: emittedCommand.id,
      stability: 'stable',
      contract: {
        name: emittedCommand.name,
        version: emittedCommand.version,
        input: declaredMessageSchema(emittedCommand.input, `${emittedCommand.id}.input`),
        output: declaredMessageSchema(emittedCommand.output, `${emittedCommand.id}.output`),
        // typecast: Object.keys erases the mapped durable-error schema key while every value still originates from this command definition.
        errors: Object.keys(emittedCommand.errors).sort().map((name) => ({ name, schema: declaredMessageSchema(emittedCommand.errors[name] as SchemaInput<object>, `${emittedCommand.id}.errors.${name}`) })),
      },
    });
  }

  addApplicationGraphNode(state, {
    id: handlerNodeId,
    kind: 'commandHandler',
    name: handlerName,
    stability: 'stable',
    model: { nodeId: modelNodeId },
    command: { nodeId: commandNodeId },
    key,
    ordering: options.ordering ?? 'serial',
    ...(idempotencyKey ? { idempotencyKey } : {}),
    missing: applicationCommandMissingPolicy(options.missing),
    ...(options.missing && options.missing !== 'reject' && 'route' in options.missing ? { missingRoute: options.missing.route } : {}),
    transaction: {
      models: transactionModels.map((participant) => ({ nodeId: applicationGraphNodeId('model', participant.name) })),
      modelBindings: directModelBindings.map(({ identifier, participant }) => ({
        identifier,
        model: { nodeId: applicationGraphNodeId('model', participant.name) },
      })),
      ...(selfRead ? { selfRead: true } : {}),
      history: historyModels.map((participant) => ({ nodeId: applicationGraphNodeId('model', participant.name) })),
      outbox: outboxEvents.map((event) => ({ nodeId: applicationGraphNodeId('event', event.id) })),
      commands: outboxCommands.map((item) => ({ nodeId: applicationGraphNodeId('command', item.id) })),
    },
    retry: options.retry ?? { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 30_000 },
    retention,
    effectBoundary: 'transactionSafeOnly',
    effectEnforcement: {
      sourceAnalysis: 'closedStructuralAllowlist',
      runtimeMembrane: 'asyncContextAmbientIo',
      externalEffects: 'outboxOrTaskOnly',
    },
    projectionReadiness: {
      submissionAcknowledgement: 'transportOnly',
      durableResultAuthority: 'postgresCommandResults',
      duplicateRecovery: 'idempotentRedelivery',
      correlation: 'commandCorrelationCausation',
      resultRevisionAuthority: 'postgresCommandResults',
      stateRevisionAuthority: 'modelRevision',
      reconciliationLink: 'modelRevisionWhenPresent',
    },
    handlerSource,
    ...(options.__generatedBeforeCommit
      ? { beforeCommit: options.__generatedBeforeCommit }
      : {}),
    ...(completionEvent
      ? {
          completionEvent: {
            nodeId: applicationGraphNodeId('event', completionEvent.id),
          },
        }
      : {}),
    ...(options.missing && options.missing !== 'reject' && 'initialize' in options.missing
      ? { initializeSource: options.__generatedSources?.initialize
        ? applicationGeneratedCommandFunctionSource('initialize', model.name, command.id, options.__generatedSources.initialize)
        : applicationCommandFunctionSource('initialize', model.name, command.id, options.missing.initialize) }
      : {}),
    ...(eventBindings.length > 0 ? { eventBindings } : {}),
    ...(commandBindings.length > 0 ? { commandBindings } : {}),
  });

  const currentProcessor = state.graphNodes.find((node): node is ApplicationProcessorNode => node.id === processorNodeId && node.kind === 'processor');
  if (currentProcessor) {
    assertApplicationProcessorRuntimeCompatibility(state, currentProcessor, model.runtime);
  }
  const currentHandlers = currentProcessor?.kind === 'processor' ? currentProcessor.handlers : [];
  const requestedProcessor = normalizeApplicationProcessorOptions(`Model ${model.name} command ${command.id}`, options.processor, currentProcessor?.deployment);
  const requestedProcessorImage = requestedProcessor.image;
  if (requestedProcessorImage && currentProcessor?.runtimeImage && requestedProcessorImage !== currentProcessor.runtimeImage) {
    throw new Error(`Model ${model.name} command ${command.id} requests processor image ${requestedProcessorImage}, but shared processor ${processorName} already uses ${currentProcessor.runtimeImage}.`);
  }
  const runtimeImage = requestedProcessorImage ?? currentProcessor?.runtimeImage;
  if (currentProcessor && !sameApplicationProcessorDeployment(requestedProcessor.deployment, currentProcessor.deployment)) {
    throw new Error(`Model ${model.name} command ${command.id} requests a processor deployment policy that conflicts with shared processor ${processorName}. Configure every command on the model with the same processor policy.`);
  }
  addApplicationGraphNode(state, {
    id: processorNodeId,
    kind: 'processor',
    name: processorName,
    stability: 'stable',
    handlers: [...currentHandlers, { nodeId: handlerNodeId }],
    runtime: 'node',
    ...(runtimeImage ? { runtimeImage } : {}),
    deployment: currentProcessor?.deployment ?? requestedProcessor.deployment,
    inference: 'generated',
    lifecycle: 'longLived',
    eventLog: { interface: 'EventLog', nodeId: applicationProviderNodeId('EventLog') },
    generatedResources: applicationCommandProcessorGeneratedResources(processorName, model.runtime, eventLog, currentProcessor?.deployment ?? requestedProcessor.deployment),
  });

  addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: modelNodeId }, relationship: 'dependsOn' });
  addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: commandNodeId }, relationship: 'dependsOn' });
  for (const event of outboxEvents) {
    addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: applicationGraphNodeId('event', event.id) }, relationship: 'emits' });
  }
  for (const emittedCommand of outboxCommands) {
    addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: applicationGraphNodeId('command', emittedCommand.id) }, relationship: 'emits' });
  }
  addApplicationGraphEdge(state, { from: { nodeId: processorNodeId }, to: { nodeId: handlerNodeId }, relationship: 'owns' });
  {
    const providerNodeId = applicationProviderNodeId('EventLog');
    const requirementId = `requirement.${handlerNodeId}.event-log`;
    addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId: processorNodeId }, relationship: 'provides' });
    addApplicationProviderRequirement(state, {
      id: requirementId,
      interface: 'EventLog',
      consumer: { nodeId: processorNodeId },
      provider: { interface: 'EventLog', nodeId: providerNodeId },
      required: true,
      purpose: 'eventLog',
      diagnostics: {
        missing: `Command processor ${processorName} requires an EventLog provider for committed outbox delivery.`,
        ambiguous: `Command processor ${processorName} has multiple EventLog providers. Bind exactly one provider explicitly.`,
      },
    });
    addApplicationProviderBinding(state, {
      requirement: requirementId,
      provider: { interface: 'EventLog', nodeId: providerNodeId },
      generatedResources: [],
      runtime: applicationEventLogRuntime(eventLog),
    });
  }
  const subjectPrefix = eventLog.subjectPrefix ?? 'applik8s';
  const servers = eventLog.servers ?? [applicationTypeKroString('nats://', eventLog.name ?? 'applik8s-events', eventLog.namespace ? '.' : '', eventLog.namespace, '.svc:4222')];
  let publisher: Promise<ApplicationEventLogPublisher> | undefined;
  const initialize = options.missing && options.missing !== 'reject' && 'initialize' in options.missing
    ? options.missing.initialize
    : undefined;
  const targetKey = (
    input: TInput,
    context?: ApplicationCommandRoutingContext,
    messageId?: string,
  ) => canonicalApplicationCommandKey(options.key(input, context, messageId));
  const commandIdempotencyKey = (input: TInput, messageId: string) => options.idempotencyKey?.(input) ?? messageId;
  return {
    kind: 'applicationModelCommand',
    name: handlerName,
    model: model.name,
    command: command.id,
    processor: processorName,
    classify(authority) {
      const authorities = applicationModelCommandAuthorities.get(command) ?? new Map();
      authorities.set(authorityKey, authority);
      applicationModelCommandAuthorities.set(command, authorities);
      const current = state.graphNodes.find((node): node is ApplicationModelNode => node.id === modelNodeId && node.kind === 'model');
      if (!current?.common) throw new Error(`Model operation ${model.name}.${publicName} cannot classify a missing model graph node.`);
      const operations = (current.common.operations ?? []).map((candidate) =>
        candidate.name === publicName ? { ...candidate, authority } : candidate);
      addApplicationGraphNode(state, { ...current, common: { ...current.common, operations } });
    },
    route(input, messageId, context) {
      return {
        targetKey: targetKey(input, context, messageId),
        idempotencyKey: commandIdempotencyKey(input, messageId),
      };
    },
    async send(input, delivery) {
      validateApplicationMessage(command.input, input, `${command.id}.input`);
      const key = targetKey(input, undefined, delivery.id);
      publisher ??= Promise.resolve(createApplicationEventLogPublisherFromEnvironment({
        connectionName: `${processorName}-binding`,
        nats: { servers, stream: eventLog.stream ?? 'APPLIK8S_EVENTS', subjectPrefix },
      }));
      const acknowledgement = await (await publisher).publish({
        id: delivery.id,
        contract: { name: command.name, version: command.version },
        payload: input,
        recordedAt: delivery.recordedAt ?? new Date().toISOString(),
        partitionKey: key,
        routing: { binding: handlerName, targetKey: key, idempotencyKey: commandIdempotencyKey(input, delivery.id) },
        ...(delivery.tenant ? { tenant: delivery.tenant } : {}),
        ...(delivery.correlationId ? { correlationId: delivery.correlationId } : {}),
        ...(delivery.causationId ? { causationId: delivery.causationId } : {}),
        ...(delivery.traceparent ? { traceparent: delivery.traceparent } : {}),
        ...(delivery.attempt ? { attempt: delivery.attempt } : {}),
        ...(delivery.expectedRevision ? { expectedRevision: delivery.expectedRevision } : {}),
        ...(delivery.context ? { trustedContext: delivery.context } : {}),
      }, 'commands');
      return {
        ...acknowledgement,
        phase: 'transportAcknowledged',
        commandId: delivery.id,
        correlationId: delivery.correlationId ?? delivery.id,
      };
    },
    execute(input, delivery) {
      return executePostgresModelCommand({
        bindingId: handlerName,
        operation:
          options.__operation === 'create' ||
          options.__operation === 'update' ||
          options.__operation === 'delete'
            ? options.__operation
            : 'custom',
        command: { name: command.name, version: command.version },
        errors: Object.keys(command.errors),
        schemas: {
          input: declaredMessageSchema(command.input, `${command.id}.input`).jsonSchema,
          output: declaredMessageSchema(command.output, `${command.id}.output`).jsonSchema,
          // typecast: Object.entries erases the mapped error-schema value type before durable JSON Schema emission.
          errors: Object.fromEntries(Object.entries(command.errors).map(([name, schema]) => [name, declaredMessageSchema(schema as SchemaInput<object>, `${command.id}.errors.${name}`).jsonSchema])),
          events: Object.fromEntries(outboxEvents.map((event) => [event.id, declaredMessageSchema(event.payload, `${event.id}.payload`).jsonSchema])),
          commands: Object.fromEntries(outboxCommands.map((item) => [item.id, declaredMessageSchema(item.input, `${item.id}.input`).jsonSchema])),
        },
        model: model.runtime,
        models: transactionModels.map((participant) => participant.runtime),
        ...(selfRead ? { selfRead: true } : {}),
        historyModels: historyModels.map((participant) => participant.name),
        ...(options.retry ? { retry: options.retry } : {}),
        message: {
          id: delivery.id,
          input,
          targetKey: delivery.targetKey ?? targetKey(input),
          idempotencyKey: delivery.idempotencyKey ?? commandIdempotencyKey(input, delivery.id),
          ...(delivery.tenant ? { tenant: delivery.tenant } : {}),
          ...(delivery.correlationId ? { correlationId: delivery.correlationId } : {}),
          ...(delivery.causationId ? { causationId: delivery.causationId } : {}),
          ...(delivery.traceparent ? { traceparent: delivery.traceparent } : {}),
          ...(delivery.attempt ? { attempt: delivery.attempt } : {}),
          ...(delivery.recordedAt ? { recordedAt: delivery.recordedAt } : {}),
          ...(delivery.expectedRevision ? { expectedRevision: delivery.expectedRevision } : {}),
          ...(delivery.context ? { context: delivery.context } : {}),
        },
        history: historyModels.some((participant) => participant.name === model.name),
        // typecast: command transaction declarations erase payload specifics after their schemas have been validated and recorded in the graph.
        outbox: outboxEvents as readonly EventDefinition<object>[],
        ...(completionEvent
          ? {
              completionEvent:
                completionEvent as EventDefinition<object>,
            }
          : {}),
        commands: outboxCommands,
        ordering: options.ordering ?? 'serial',
        ...(options.missing && options.missing !== 'reject' && 'route' in options.missing ? { missingRoute: options.missing.route } : {}),
        ...(initialize ? { initialize } : {}),
        handler,
        ...(delivery.databaseUrl ? { databaseUrl: delivery.databaseUrl } : {}),
      });
    },
    drain: async () => {
      if (publisher) await (await publisher).drain();
    },
  };
}

/**
 * Removes the replaceable graph slice for one compiler-owned conventional
 * mutation before a transaction policy is attached. Contract, provider, and
 * model nodes are deliberately retained and are overwritten/deduplicated by
 * the subsequent registration.
 */
export function prepareApplicationModelCommandReplacement(
  state: ApplicationModelGraphState,
  modelName: string,
  commandId: string,
): void {
  const handlerName = `${modelName}-${commandId}`;
  const handlerNodeId = applicationGraphNodeId('command-handler', handlerName);
  const handlerIndex = state.graphNodes.findIndex((node) => node.id === handlerNodeId && node.kind === 'commandHandler');
  if (handlerIndex < 0) {
    throw new Error(`Model ${modelName} command ${commandId} cannot attach beforeCommit policy because its generated direct handler is missing.`);
  }
  state.graphNodes.splice(handlerIndex, 1);
  const processors = state.graphNodes.filter((node): node is ApplicationProcessorNode =>
    node.kind === 'processor' && node.handlers.some((handler) => handler.nodeId === handlerNodeId));
  if (processors.length !== 1) {
    throw new Error(`Model ${modelName} command ${commandId} expected exactly one generated processor owner, found ${processors.length}.`);
  }
  for (const processor of processors) {
    addApplicationGraphNode(state, {
      ...processor,
      handlers: processor.handlers.filter((handler) => handler.nodeId !== handlerNodeId),
    });
  }
  for (let index = state.graphEdges.length - 1; index >= 0; index -= 1) {
    const edge = state.graphEdges[index];
    if (edge && (edge.from.nodeId === handlerNodeId || edge.to.nodeId === handlerNodeId)) {
      state.graphEdges.splice(index, 1);
    }
  }
}

function assertApplicationProcessorRuntimeCompatibility(
  state: ApplicationModelGraphState,
  processor: ApplicationProcessorNode,
  runtime: ApplicationRuntimeModelContract,
): void {
  const existingRuntime = processor.handlers
    .map((reference) => state.graphNodes.find((node) => node.id === reference.nodeId))
    .filter((node): node is ApplicationCommandHandlerNode => node?.kind === 'commandHandler')
    .map((handler) => state.graphNodes.find((node) => node.id === handler.model.nodeId))
    .find((node): node is ApplicationModelNode & { readonly runtime: ApplicationRuntimeModelContract } => node?.kind === 'model' && Boolean(node.runtime))
    ?.runtime;
  if (!existingRuntime) {
    throw new Error(`Shared processor ${processor.name} has no resolvable model runtime.`);
  }
  const connection = (candidate: ApplicationRuntimeModelContract) => ({
    provider: candidate.provider,
    database: candidate.database,
    clusterName: candidate.clusterName,
    secretName: candidate.secretName,
    secretKey: candidate.secretKey,
    secretNamespace: candidate.secretNamespace ?? '',
  });
  if (JSON.stringify(connection(existingRuntime)) !== JSON.stringify(connection(runtime))) {
    throw new Error(`Shared processor ${processor.name} cannot combine models from different PostgreSQL connection domains.`);
  }
}

function applicationCommandPublicName(explicit: string | undefined, commandName: string): string {
  const name = explicit ?? commandName.split('.').at(-1) ?? commandName;
  if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
    throw new Error(`Application command ${commandName} public operation name ${JSON.stringify(name)} must be a JavaScript identifier so it can be called directly on the generated model.`);
  }
  return name;
}

function applicationCommandRetention(input: Partial<ApplicationCommandRetentionContract> | undefined, model: string, command: string): ApplicationCommandRetentionContract {
  const retention = { ...defaultApplicationCommandRetention, ...input };
  if (!Number.isInteger(retention.replayWindowSeconds) || retention.replayWindowSeconds < 60) throw new Error(`Model ${model} command ${command} retention.replayWindowSeconds must be an integer >= 60.`);
  if (!Number.isInteger(retention.auditWindowSeconds) || retention.auditWindowSeconds < retention.replayWindowSeconds) throw new Error(`Model ${model} command ${command} retention.auditWindowSeconds must be an integer >= replayWindowSeconds.`);
  if (!Number.isInteger(retention.publishedOutboxWindowSeconds) || retention.publishedOutboxWindowSeconds < 60) throw new Error(`Model ${model} command ${command} retention.publishedOutboxWindowSeconds must be an integer >= 60.`);
  if (!Number.isInteger(retention.cleanupIntervalSeconds) || retention.cleanupIntervalSeconds < 10) throw new Error(`Model ${model} command ${command} retention.cleanupIntervalSeconds must be an integer >= 10.`);
  if (!Number.isInteger(retention.cleanupBatchSize) || retention.cleanupBatchSize < 1 || retention.cleanupBatchSize > 10_000) throw new Error(`Model ${model} command ${command} retention.cleanupBatchSize must be an integer between 1 and 10000.`);
  return retention;
}

function applicationEventLogRuntime(provider: ApplicationEventLogProvider): ApplicationProviderRuntimeContract {
  const serviceName = provider.name ?? 'applik8s-events';
  const servers = provider.servers ?? [applicationTypeKroString('nats://', serviceName, provider.namespace ? '.' : '', provider.namespace, '.svc:4222')];
  return {
    env: {
      APPLIK8S_EVENT_LOG_PROVIDER: provider.kind,
      APPLIK8S_NATS_SERVERS: applicationTypeKroJsonStringArray(servers),
      APPLIK8S_NATS_STREAM: provider.stream ?? 'APPLIK8S_EVENTS',
      APPLIK8S_NATS_SUBJECT_PREFIX: provider.subjectPrefix ?? 'applik8s',
    },
    ...(provider.connectionSecret ? { secretRefs: [provider.connectionSecret] } : {}),
    readiness: {
      dependencies: provider.provision === false ? [] : [{ apiVersion: 'v1', kind: 'Service', name: serviceName, ...(provider.namespace ? { namespace: provider.namespace } : {}) }],
      condition: 'JetStream stream exists with the declared subject prefix',
      timeoutSeconds: 120,
    },
  };
}

function applicationCommandEventBindings(
  handlerSource: string,
  events: readonly EventDefinition<object>[],
  modelName: string,
  commandId: string,
  generatedIdentifiers: ReadonlySet<string> = new Set(),
): readonly { readonly identifier: string; readonly event: { readonly nodeId: string } }[] {
  const identifiers = [...handlerSource.matchAll(/\.\s*emit\s*\(\s*([A-Za-z_$][\w$]*)\s*,/g)]
    .map((match) => match[1])
    .filter(
      (identifier): identifier is string =>
        typeof identifier === 'string'
        && !generatedIdentifiers.has(identifier),
    );
  const unique = [...new Set(identifiers)];
  if (unique.length !== events.length) {
    throw new Error(`Model ${modelName} command ${commandId} must emit each declared outbox event through a stable identifier so the generated processor can serialize its closure. Found ${unique.length} event identifiers (${unique.join(', ') || 'none'}) for ${events.length} declared events (${events.map((event) => event.id).join(', ')}).`);
  }
  return unique.map((identifier, index) => ({
    identifier,
    event: { nodeId: applicationGraphNodeId('event', events[index]?.id ?? '') },
  }));
}

function applicationOutboxCommandDefinition(
  state: ApplicationModelGraphState,
  modelName: string,
  ownerCommandId: string,
  commandOrOperation: CommandDefinition<object, object, Readonly<Record<string, object>>> | ApplicationOperationLike,
): CommandDefinition<object, object, Readonly<Record<string, object>>> {
  if (Reflect.get(commandOrOperation, 'kind') === 'applik8sCommand') {
    return commandOrOperation as CommandDefinition<object, object, Readonly<Record<string, object>>>;
  }
  const binding = applicationModelCommandBindingForOperation(commandOrOperation);
  if (!binding) {
    throw new Error(`Model ${modelName} command ${ownerCommandId} declares an outbox operation that is not registered in this application graph.`);
  }
  const node = state.graphNodes.find((candidate) => candidate.id === applicationGraphNodeId('command', binding.command));
  if (node?.kind !== 'command') {
    throw new Error(`Model ${modelName} command ${ownerCommandId} cannot resolve outbox operation ${binding.command} to its generated command contract.`);
  }
  const schema = (exportName: string, jsonSchema: JsonValue): SchemaInput<object> => ({
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName },
    schema: jsonSchema as import('@applik8s/core').JsonObject,
  });
  return {
    kind: 'applik8sCommand',
    id: binding.command,
    name: node.contract.name,
    version: node.contract.version,
    input: schema(`${binding.command}.input`, node.contract.input.jsonSchema),
    output: schema(`${binding.command}.output`, node.contract.output.jsonSchema),
    errors: Object.fromEntries(node.contract.errors.map((error) => [error.name, schema(`${binding.command}.errors.${error.name}`, error.schema.jsonSchema)])),
  };
}

function applicationCommandOutboxBindings(
  handlerSource: string,
  commands: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[],
  modelName: string,
  commandId: string,
): readonly { readonly identifier: string; readonly command: { readonly nodeId: string } }[] {
  const identifiers = [...handlerSource.matchAll(/\.\s*send\s*\(\s*([A-Za-z_$][\w$]*)\s*,/g)]
    .map((match) => match[1])
    .filter((identifier): identifier is string => Boolean(identifier));
  const unique = [...new Set(identifiers)];
  if (unique.length !== commands.length) {
    throw new Error(`Model ${modelName} command ${commandId} must send each declared outbox command through a stable identifier so the generated processor can serialize its closure. Found ${unique.length} command identifiers for ${commands.length} declared commands.`);
  }
  return unique.map((identifier, index) => ({
    identifier,
    command: { nodeId: applicationGraphNodeId('command', commands[index]?.id ?? '') },
  }));
}

function validateApplicationCommandHandlerClosure(
  handlerSource: string,
  eventBindings: readonly { readonly identifier: string }[],
  modelBindings: readonly string[],
  modelName: string,
  commandId: string,
): void {
  const analysis = analyzeApplicationServerRouteSource(handlerSource);
  const unsupported = unsupportedRouteFreeIdentifiers(
    analysis,
    new Set([
      ...eventBindings.map((binding) => binding.identifier),
      ...modelBindings,
    ]),
  );
  if (unsupported.length > 0) {
    throw new Error(serializedCallbackClosureMessage({
      label: `Model ${modelName} command ${commandId} handler`,
      identifiers: unsupported,
      guidance: 'Keep deterministic helpers inside the handler, emit only declared event identifiers, or wait for explicit command-handler capture support.',
    }));
  }
}

function applicationCommandProcessorGeneratedResources(
  processorName: string,
  model: ApplicationRuntimeModelContract,
  eventLog: ApplicationEventLogProvider,
  deployment: ApplicationProcessorNode['deployment'],
): readonly ApplicationGeneratedResourceContract[] {
  const name = kubernetesNameSegment(processorName);
  const namespace = model.secretNamespace ?? eventLog.namespace;
  const nodeId = applicationGraphNodeId('processor', processorName);
  const configuredStreamName = applicationTypeKroSerializedValue(
    eventLog.name ?? eventLog.stream ?? 'applik8s-events',
  );
  const streamName = configuredStreamName.startsWith('${')
    ? configuredStreamName
    : kubernetesNameSegment(configuredStreamName);
  const resource = (apiVersion: string, kind: string, resourceName: string): ApplicationResourceRef => ({
    apiVersion,
    kind,
    name: resourceName,
    ...(namespace ? { namespace } : {}),
  });
  return [
    { role: 'workload', graphNode: { nodeId }, resource: resource('apps/v1', 'Deployment', name), artifact: { kind: 'kubernetesManifest', name: `${name}.yaml` } },
    { role: 'policy', graphNode: { nodeId }, resource: resource('networking.k8s.io/v1', 'NetworkPolicy', name), artifact: { kind: 'kubernetesManifest', name: `${name}-network-policy.yaml` } },
    // typecast: preserve generated-resource discriminants through the conditional PDB collection.
    ...('disabled' in deployment.disruption ? [] : [{ role: 'policy' as const, graphNode: { nodeId }, resource: resource('policy/v1', 'PodDisruptionBudget', name), artifact: { kind: 'kubernetesManifest' as const, name: `${name}-pod-disruption-budget.yaml` } }]),
    { role: 'runtimeBundle', graphNode: { nodeId }, resource: resource('v1', 'ConfigMap', `${name}-source`), artifact: { kind: 'runtimeBundle', name: `${name}-source` } },
    // typecast: preserve discriminants while conditionally adding the TypeKro-owned Stream.
    ...(eventLog.provision === false ? [] : [{ role: 'providerDependency' as const, graphNode: { nodeId }, resource: resource('jetstream.nats.io/v1beta2', 'Stream', streamName), artifact: { kind: 'typeKroResource' as const, name: streamName } }]),
    { role: 'providerDependency', graphNode: { nodeId }, resource: resource('jetstream.nats.io/v1beta2', 'Consumer', name), artifact: { kind: 'typeKroResource', name } },
  ];
}

function declaredMessageSchema<T extends object>(input: SchemaInput<T>, name: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(input, name).emitJsonSchema();
  if (!emitted.ok) {
    throw new Error(`applik8s-message-schema-unsupported: ${name}: ${emitted.error.message}`);
  }
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema };
}

function validateApplicationMessage<T extends object>(schema: SchemaInput<T>, value: unknown, name: string): T {
  // typecast: command inputs cross a JSON envelope boundary and the runtime schema validates their concrete JSON shape next.
  const result = normalizeSchema(schema, name).validate(value as JsonValue);
  if (!result.ok) {
    throw new Error(`applik8s-message-schema-invalid: ${name}: ${result.error.message}`);
  }
  return result.value;
}

function applicationCommandMissingPolicy<TInput extends object, TSpec extends object>(missing: ApplicationModelCommandOptions<TInput, TSpec>['missing']): 'reject' | 'initialize' | 'route' {
  if (!missing || missing === 'reject') {
    return 'reject';
  }
  return 'initialize' in missing ? 'initialize' : 'route';
}

function applicationCommandFunctionExpression(kind: string, modelName: string, commandId: string, fn: (...args: never[]) => unknown): ApplicationExpressionContract {
  return { kind: 'function', source: applicationCommandFunctionSource(kind, modelName, commandId, fn) };
}

function applicationGeneratedCommandFunctionExpression(kind: string, modelName: string, commandId: string, source: string): ApplicationExpressionContract {
  return { kind: 'function', source: applicationGeneratedCommandFunctionSource(kind, modelName, commandId, source) };
}

function applicationGeneratedCommandFunctionSource(kind: string, modelName: string, commandId: string, source: string): string {
  const trimmed = source.trim();
  if (!trimmed || trimmed.includes('[native code]')) throw new Error(`Generated model ${modelName} command ${commandId} ${kind} must provide serializable JavaScript source.`);
  const sourceKind = kind === 'key' || kind === 'idempotencyKey' || kind === 'initialize' ? kind : 'handler';
  const violations = applicationCommandSourceViolations(trimmed, sourceKind);
  if (violations.length > 0) {
    throw new Error(`Generated model ${modelName} command ${commandId} ${kind} violates the closed command runtime: ${violations.map((violation) => violation.name).join(', ')}.`);
  }
  return trimmed;
}

function applicationCommandFunctionSource(kind: string, modelName: string, commandId: string, fn: (...args: never[]) => unknown): string {
  const source = Function.prototype.toString.call(fn).trim();
  if (!source || source.includes('[native code]')) {
    throw new Error(`Model ${modelName} command ${commandId} ${kind} must be a serializable JavaScript function.`);
  }
  const sourceKind = kind === 'key' || kind === 'idempotencyKey' || kind === 'initialize' ? kind : 'handler';
  const violations = applicationCommandSourceViolations(source, sourceKind);
  if (violations.length > 0) {
    const names = violations.map((violation) => violation.name).join(', ');
    if (sourceKind === 'key' || sourceKind === 'idempotencyKey') {
      throw new Error(`Model ${modelName} command ${commandId} ${kind} must be deterministic; ${names} is not allowed.`);
    }
    throw new Error(`Model ${modelName} command ${commandId} ${kind} uses ${names}, which is forbidden while model locks are held. Transaction handlers are closed structural closures: use context.now/context.id and move external effects to a declared outbox or durable task.`);
  }
  return source;
}

function uniqueApplicationModelBindings(bindings: readonly ApplicationModelTransactionParticipant[]): readonly ApplicationModelBinding<object, object>[] {
  const byName = new Map<string, ApplicationModelBinding<object, object>>();
  for (const participant of bindings) {
    const binding = participant && typeof participant === 'object' && Reflect.get(participant, 'kind') === 'applicationModel'
      ? participant as ApplicationModelBinding<object, object>
      : nativeApplicationModelBindingFor(participant);
    if (!binding) {
      const name = participant && typeof participant === 'object'
        ? getApplicationModelFacet<object, unknown, object, object>(participant)?.name
        : undefined;
      throw new Error(`Application transaction participant ${typeof name === 'string' ? name : '<unknown>'} must be a named model or a Drizzle model registered through app.model(...).`);
    }
    byName.set(binding.name, binding);
  }
  return [...byName.values()];
}

function validateApplicationCommandTransactionDomain(modelName: string, commandId: string, models: readonly ApplicationModelBinding<object, object>[]): void {
  const domains = new Set(models.map((model) => `${model.runtime.provider}:${model.runtime.clusterName}:${model.runtime.database}`));
  if (domains.size > 1) {
    throw new Error(`Model ${modelName} command ${commandId} spans multiple physical transaction domains (${[...domains].join(', ')}). Cross-provider or cross-database atomic transactions fail closed.`);
  }
  for (const model of models) {
    if (model.backend.transactions === 'unsupported') {
      throw new Error(`Model ${modelName} command ${commandId} includes ${model.name}, which declares transactions as unsupported.`);
    }
  }
}

function applicationTransactionalDatabaseGuarantees<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined, migration: ApplicationMigrationContract): ApplicationTransactionalDatabaseGuaranteesContract {
  return {
    identity: 'stableId',
    uniqueness: 'databaseConstraint',
    indexes: 'declaredSecondaryIndexes',
    transactions: schema?.transactions ?? 'supported',
    retention: schema?.retention?.mode === 'ttl' ? 'ttl' : schema?.retention?.mode === 'deleteWithOwner' ? 'deleteWithApplication' : 'retain',
    migrationOwnership: migration.strategy === 'generatedJob' ? 'generatedJob' : migration.strategy === 'external' ? 'external' : 'none',
    semantics: applicationTransactionalDatabaseSemantics(schema),
  };
}

function applicationTransactionalDatabaseSemantics<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): ApplicationTransactionalDatabaseSemanticsContract {
  const retentionMode = schema?.retention?.mode === 'ttl' ? 'ttl' : schema?.retention?.mode === 'deleteWithOwner' ? 'deleteWithApplication' : 'retain';
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    transactions: { declaration: schema?.transactions ?? 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: schema?.transactions === 'unsupported' ? 'failClosed' : 'runtimeTransaction' },
    retention: {
      mode: retentionMode,
      ...(schema?.retention?.mode === 'ttl' ? { ttlSeconds: schema.retention.ttlSeconds } : {}),
      deletionPolicy: schema?.retention?.mode === 'deleteWithOwner' ? 'ownerDeletion' : 'explicitOnly',
      enforcement: 'runtimeEnforced',
    },
  };
}

export interface ApplicationModelRuntimeBinding {
  readonly kind: 'applicationModel';
  readonly name: string;
  readonly runtime: ApplicationRuntimeModelContract;
}

export type ApplicationModelCommandRegistrar<TSpec extends object, TStatus extends object> = <TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
  command: CommandDefinition<TInput, TOutput, TErrors>,
  options: ApplicationModelCommandOptions<TInput, TSpec>,
  handler: ApplicationModelCommandHandler<TSpec, TStatus, TInput, TOutput, TErrors>,
) => ApplicationModelCommandBinding<TInput, TOutput, TSpec, TStatus>;

const applicationModelCommandRegistrars =
  new WeakMap<object, ApplicationModelCommandRegistrar<object, object>>();

export function bindApplicationModelCommandRegistrar<
  TSpec extends object,
  TStatus extends object,
>(
  model: ApplicationModelBinding<TSpec, TStatus>,
  registrar: ApplicationModelCommandRegistrar<TSpec, TStatus>,
): void {
  // typecast: the model object is the identity boundary that restores the
  // declaration-time generics when the compiler-owned registrar is retrieved.
  applicationModelCommandRegistrars.set(
    model,
    registrar as unknown as ApplicationModelCommandRegistrar<object, object>,
  );
}

export function applicationModelCommandRegistrar<
  TSpec extends object,
  TStatus extends object,
>(
  model: ApplicationModelBinding<TSpec, TStatus>,
): ApplicationModelCommandRegistrar<TSpec, TStatus> | undefined {
  // typecast: the registrar was stored under this exact model identity.
  return applicationModelCommandRegistrars.get(model) as
    | ApplicationModelCommandRegistrar<TSpec, TStatus>
    | undefined;
}

export function applicationModelBinding<TSpec extends object, TStatus extends object>(entity: EntityDefinition<TSpec, TStatus>, _provider: ApplicationTransactionalDatabaseProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined, runtime: ApplicationRuntimeModelContract, commandRegistrar?: ApplicationModelCommandRegistrar<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus> {
  const name = options?.name ?? entity.name;
  const transactionSemantics = options?.schema?.transactions ?? 'supported';
  const scriptClient = () => createPostgresModelClient<TSpec, TStatus>(runtime);
  const binding: ApplicationModelBinding<TSpec, TStatus> = {
    kind: 'applicationModel',
    name,
    entity,
    runtime,
    backend: {
      interface: 'TransactionalDatabase',
      runtimeBoundary: applicationModelRuntimeBoundary(),
      transactions: transactionSemantics,
      queryConsistency: 'providerDefined',
      eventSemantics: 'unsupported',
      limitations: ['model CRUD/query calls inside serialized generated callbacks lower to generated runtime clients; ordinary script execution uses the same Postgres TransactionalDatabase runtime and requires database credentials plus generated migrations'],
    },
    async create(input) {
      return scriptClient().create(input);
    },
    async get(ref) {
      return scriptClient().get(ref);
    },
    async query(query) {
      return scriptClient().query(query);
    },
    async patch(ref, patch) {
      return scriptClient().patch(ref, patch);
    },
    async delete(ref) {
      return scriptClient().delete(ref);
    },
    index(indexName, indexOptions) {
      return scriptClient().index(indexName, indexOptions) satisfies ApplicationModelIndexBinding<TSpec, TStatus>;
    },
    async transaction(handler) {
      if (transactionSemantics === 'unsupported') {
        throw new Error(`Model ${name}.transaction(...) is unsupported by this model schema and fails closed. Declare transactions as "supported" or "required" before relying on multi-operation atomicity.`);
      }
      return scriptClient().transaction(handler);
    },
    on: {
      created: () => applicationModelUnsupportedEvent(name, 'created'),
      updated: () => applicationModelUnsupportedEvent(name, 'updated'),
      deleted: () => applicationModelUnsupportedEvent(name, 'deleted'),
    },
  };
  if (commandRegistrar) bindApplicationModelCommandRegistrar(binding, commandRegistrar);
  return binding;
}

function applicationModelUnsupportedEvent(modelName: string, event: 'created' | 'updated' | 'deleted'): ApplicationModelEventBinding {
  throw new Error(`Model ${modelName}.on.${event}(...) requires transactional model event delivery, which is not implemented for the Postgres TransactionalDatabase slice yet. Model event semantics fail closed until outbox/watch behavior is implemented.`);
}

export function applicationRuntimeModelContract<TSpec extends object, TStatus extends object>(entity: EntityDefinition<TSpec, TStatus>, provider: ApplicationTransactionalDatabaseProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined): ApplicationRuntimeModelContract {
  const name = options?.name ?? entity.name;
  const runtimeProvider = applicationTransactionalDatabaseRuntimeProvider(
    provider,
    name,
  );
  const modelSegment = kubernetesNameSegment(name);
  const resources = applicationTransactionalDatabaseProviderResources(runtimeProvider, name);
  const cluster = resources[0];
  const clusterName = applicationTypeKroSerializedValue(runtimeProvider.clusterName ?? runtimeProvider.name ?? cluster?.name ?? `${modelSegment}-db`);
  const secret = runtimeProvider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(runtimeProvider.namespace ? { namespace: runtimeProvider.namespace } : {}) };
  return {
    name,
    tableName: `applik8s_${modelSegment.replace(/[^a-z0-9]+/g, '_')}`,
    provider: 'postgres',
    authorityName: modelSegment,
    database: applicationTypeKroSerializedValue(runtimeProvider.database ?? modelSegment),
    clusterName,
    secretName: applicationTypeKroSerializedValue(secret.name ?? `${clusterName}-app`),
    secretKey: applicationTypeKroSerializedValue(runtimeProvider.connectionSecretKey ?? 'uri'),
    ...(secret.namespace ?? runtimeProvider.namespace ? { secretNamespace: applicationTypeKroSerializedValue(secret.namespace ?? runtimeProvider.namespace) } : {}),
    connectionEnvName: `APPLIK8S_TRANSACTIONAL_DATABASE_${modelSegment.replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_DATABASE_URL`,
    constraints: applicationTransactionalDatabaseConstraints(options?.schema),
    indexes: applicationTransactionalDatabaseIndexes(options?.schema),
    retention: options?.schema?.retention ?? { mode: 'retain' },
  };
}

export function applicationModelMigrationSql(model: ApplicationRuntimeModelContract): string {
  const migrationPlan = applicationModelMigrationPlan(model);
  const statements = [
    ...applicationAuthorityPostgresSchemaStatements.map((statement) => `${statement.trimEnd()};`),
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_model_migrations')} (\n  id text PRIMARY KEY,\n  model text NOT NULL,\n  revision text NOT NULL,\n  plan jsonb NOT NULL,\n  applied_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_admissions')} (\n  scope text PRIMARY KEY,\n  command text NOT NULL,\n  binding_id text NOT NULL,\n  command_id text NOT NULL,\n  authorization_receipt jsonb NOT NULL,\n  admitted_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_admissions_cleanup')} ON ${quoteSqlIdentifier('applik8s_command_admissions')} (binding_id, admitted_at);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_inbox')} (\n  scope text PRIMARY KEY,\n  binding_id text NOT NULL,\n  model text NOT NULL,\n  target_key text NOT NULL,\n  idempotency_key text NOT NULL,\n  message_id text NOT NULL,\n  input jsonb NOT NULL,\n  authorization_receipt jsonb,\n  received_at timestamptz NOT NULL DEFAULT now()\n);`,
    `ALTER TABLE ${quoteSqlIdentifier('applik8s_command_inbox')} ADD COLUMN IF NOT EXISTS authorization_receipt jsonb;`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_results')} (\n  scope text PRIMARY KEY REFERENCES ${quoteSqlIdentifier('applik8s_command_inbox')}(scope) ON DELETE CASCADE,\n  output jsonb,\n  error jsonb,\n  model_revision text NOT NULL,\n  model_snapshot jsonb,\n  model_deleted boolean NOT NULL DEFAULT false,\n  completed_at timestamptz NOT NULL DEFAULT now(),\n  CHECK ((output IS NULL) <> (error IS NULL))\n);`,
    `ALTER TABLE ${quoteSqlIdentifier('applik8s_command_results')} ADD COLUMN IF NOT EXISTS model_snapshot jsonb;`,
    `ALTER TABLE ${quoteSqlIdentifier('applik8s_command_results')} ADD COLUMN IF NOT EXISTS model_deleted boolean NOT NULL DEFAULT false;`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_model_transitions')} (\n  id text PRIMARY KEY,\n  scope text NOT NULL REFERENCES ${quoteSqlIdentifier('applik8s_command_inbox')}(scope) ON DELETE CASCADE,\n  model text NOT NULL,\n  target_key text NOT NULL,\n  before_state jsonb NOT NULL,\n  after_state jsonb NOT NULL,\n  model_revision text NOT NULL,\n  committed_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_model_history')} (\n  id text PRIMARY KEY,\n  scope text NOT NULL REFERENCES ${quoteSqlIdentifier('applik8s_command_inbox')}(scope) ON DELETE CASCADE,\n  model text NOT NULL,\n  target_key text NOT NULL,\n  before_state jsonb NOT NULL,\n  after_state jsonb NOT NULL,\n  model_revision text NOT NULL,\n  recorded_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_event_outbox')} (\n  id text PRIMARY KEY,\n  scope text NOT NULL REFERENCES ${quoteSqlIdentifier('applik8s_command_inbox')}(scope) ON DELETE CASCADE,\n  contract_name text NOT NULL,\n  contract_version text NOT NULL,\n  partition_key text NOT NULL,\n  envelope jsonb NOT NULL,\n  payload jsonb NOT NULL,\n  published_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_event_outbox_pending')} ON ${quoteSqlIdentifier('applik8s_event_outbox')} (created_at) WHERE published_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_event_outbox_cleanup')} ON ${quoteSqlIdentifier('applik8s_event_outbox')} (published_at) WHERE published_at IS NOT NULL;`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_public_stream_events')} (\n  id text PRIMARY KEY,\n  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,\n  contract_name text NOT NULL,\n  contract_version text NOT NULL,\n  partition_key text NOT NULL,\n  envelope jsonb NOT NULL,\n  payload jsonb NOT NULL,\n  context_digest text,\n  recorded_at timestamptz NOT NULL\n);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_public_stream_events_sequence')} ON ${quoteSqlIdentifier('applik8s_public_stream_events')} (sequence);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_public_stream_events_contract_sequence')} ON ${quoteSqlIdentifier('applik8s_public_stream_events')} (contract_name, contract_version, sequence);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_public_stream_events_contract_recorded_at')} ON ${quoteSqlIdentifier('applik8s_public_stream_events')} (contract_name, contract_version, recorded_at);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_public_stream_events_context_sequence')} ON ${quoteSqlIdentifier('applik8s_public_stream_events')} (contract_name, contract_version, context_digest, sequence);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_outbox')} (\n  id text PRIMARY KEY,\n  scope text NOT NULL REFERENCES ${quoteSqlIdentifier('applik8s_command_inbox')}(scope) ON DELETE CASCADE,\n  contract_name text NOT NULL,\n  contract_version text NOT NULL,\n  partition_key text NOT NULL,\n  envelope jsonb NOT NULL,\n  payload jsonb NOT NULL,\n  published_at timestamptz,\n  created_at timestamptz NOT NULL DEFAULT now()\n);`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_outbox_pending')} ON ${quoteSqlIdentifier('applik8s_command_outbox')} (created_at) WHERE published_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_outbox_cleanup')} ON ${quoteSqlIdentifier('applik8s_command_outbox')} (published_at) WHERE published_at IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier('applik8s_command_inbox_cleanup')} ON ${quoteSqlIdentifier('applik8s_command_inbox')} (binding_id, received_at);`,
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier(model.tableName)} (\n  id text PRIMARY KEY,\n  spec jsonb NOT NULL,\n  status jsonb,\n  revision text NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now(),\n  updated_at timestamptz NOT NULL DEFAULT now()\n);`,
    ...model.constraints.filter((constraint) => constraint.kind === 'unique').map((constraint) => `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteSqlIdentifier(constraint.name)} ON ${quoteSqlIdentifier(model.tableName)} (${constraint.fields.map(modelSqlIndexExpression).join(', ')});`),
    ...model.indexes.map((index) => `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quoteSqlIdentifier(index.name)} ON ${quoteSqlIdentifier(model.tableName)} (${index.fields.map(modelSqlIndexExpression).join(', ')});`),
    `INSERT INTO ${quoteSqlIdentifier('applik8s_model_migrations')} (id, model, revision, plan) VALUES (${quoteSqlLiteral(migrationPlan.id)}, ${quoteSqlLiteral(model.name)}, ${quoteSqlLiteral(migrationPlan.toRevision)}, ${quoteSqlLiteral(JSON.stringify(migrationPlan))}::jsonb) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, plan = EXCLUDED.plan, applied_at = now();`,
  ];
  return `${statements.join('\n\n')}\n`;
}

export function applicationModelMigrationPreflightSql(model: ApplicationRuntimeModelContract): string {
  const migrationPlan = applicationModelMigrationPlan(model);
  const expectedColumns = [
    { name: 'id', type: 'text' },
    { name: 'spec', type: 'jsonb' },
    { name: 'status', type: 'jsonb' },
    { name: 'revision', type: 'text' },
    { name: 'created_at', type: 'timestamp with time zone' },
    { name: 'updated_at', type: 'timestamp with time zone' },
  ];
  const expectedHistoryColumns = [
    { name: 'id', type: 'text' },
    { name: 'model', type: 'text' },
    { name: 'revision', type: 'text' },
    { name: 'plan', type: 'jsonb' },
    { name: 'applied_at', type: 'timestamp with time zone' },
  ];
  const indexChecks = [...model.constraints.filter((constraint) => constraint.kind === 'unique').map((constraint) => ({ name: constraint.name, fields: constraint.fields, unique: true })), ...model.indexes].map((index) => `
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${quoteSqlLiteral(index.name)} AND tablename <> ${quoteSqlLiteral(model.tableName)}) THEN
    RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleIndex index % exists on a different table', ${quoteSqlLiteral(index.name)};
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${quoteSqlLiteral(index.name)} AND tablename = ${quoteSqlLiteral(model.tableName)}) THEN
    SELECT pg_get_indexdef(pg_index.indexrelid), pg_index.indisunique
    INTO actual_index_definition, actual_index_unique
    FROM pg_index
    JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_class table_class ON table_class.oid = pg_index.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = ${quoteSqlLiteral(model.tableName)}
      AND index_class.relname = ${quoteSqlLiteral(index.name)}
    LIMIT 1;
    normalized_index_definition := replace(replace(regexp_replace(lower(coalesce(actual_index_definition, '')), '\\s+', '', 'g'), '"', ''), '::text', '');
    IF actual_index_unique IS DISTINCT FROM ${index.unique ? 'true' : 'false'} THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleIndex index % has incompatible uniqueness', ${quoteSqlLiteral(index.name)};
    END IF;
${index.fields.map((field) => `    IF position(${quoteSqlLiteral(normalizedSqlIndexExpression(field))} in normalized_index_definition) = 0 THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleIndex index % does not match generated model schema', ${quoteSqlLiteral(index.name)};
    END IF;`).join('\n')}
  END IF;`).join('\n');

  return `-- applik8s-model-migration-preflight
-- providerReadiness: fail closed before schema effects when Postgres is unavailable.
SELECT 1 AS provider_readiness;

BEGIN;
SELECT pg_advisory_xact_lock(hashtext(${quoteSqlLiteral(`applik8s:model-migration:${model.tableName}`)}));

DO $applik8s_migration_preflight$
DECLARE
  model_table_exists boolean;
  history_table_exists boolean;
  latest_revision text;
  missing_column text;
  incompatible_column text;
  missing_history_column text;
  incompatible_history_column text;
  unknown_column text;
  actual_index_definition text;
  actual_index_unique boolean;
  normalized_index_definition text;
BEGIN
  SELECT to_regclass(${quoteSqlLiteral(`public.${model.tableName}`)}) IS NOT NULL INTO model_table_exists;
  SELECT to_regclass(${quoteSqlLiteral('public.applik8s_model_migrations')}) IS NOT NULL INTO history_table_exists;

  IF model_table_exists AND NOT history_table_exists THEN
    RAISE EXCEPTION 'applik8s-model-migration-drift-detected: missingHistoryTable existing model table % has no applik8s_model_migrations history table', ${quoteSqlLiteral(model.tableName)};
  END IF;

  IF history_table_exists THEN
    SELECT expected.column_name INTO missing_history_column
    FROM (VALUES ${expectedHistoryColumns.map((column) => `(${quoteSqlLiteral(column.name)}, ${quoteSqlLiteral(column.type)})`).join(', ')}) AS expected(column_name, data_type)
    LEFT JOIN information_schema.columns actual_history
      ON actual_history.table_schema = 'public'
      AND actual_history.table_name = 'applik8s_model_migrations'
      AND actual_history.column_name = expected.column_name
    WHERE actual_history.column_name IS NULL
    LIMIT 1;
    IF missing_history_column IS NOT NULL THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: missingHistoryColumn migration history table is missing required column %', missing_history_column;
    END IF;

    SELECT expected.column_name INTO incompatible_history_column
    FROM (VALUES ${expectedHistoryColumns.map((column) => `(${quoteSqlLiteral(column.name)}, ${quoteSqlLiteral(column.type)})`).join(', ')}) AS expected(column_name, data_type)
    JOIN information_schema.columns actual_history
      ON actual_history.table_schema = 'public'
      AND actual_history.table_name = 'applik8s_model_migrations'
      AND actual_history.column_name = expected.column_name
    WHERE actual_history.data_type <> expected.data_type
    LIMIT 1;
    IF incompatible_history_column IS NOT NULL THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleHistoryColumn migration history table has incompatible column %', incompatible_history_column;
    END IF;

    SELECT revision INTO latest_revision
    FROM applik8s_model_migrations
    WHERE model = ${quoteSqlLiteral(model.name)}
    ORDER BY applied_at DESC
    LIMIT 1;
    IF latest_revision IS NOT NULL AND latest_revision <> ${quoteSqlLiteral(migrationPlan.toRevision)} THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: destructiveChange model % has recorded revision % but generated revision is %; provide an explicit migration plan', ${quoteSqlLiteral(model.name)}, latest_revision, ${quoteSqlLiteral(migrationPlan.toRevision)};
    END IF;
  END IF;

  IF model_table_exists THEN
    SELECT expected.column_name INTO missing_column
    FROM (VALUES ${expectedColumns.map((column) => `(${quoteSqlLiteral(column.name)}, ${quoteSqlLiteral(column.type)})`).join(', ')}) AS expected(column_name, data_type)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
      AND actual.table_name = ${quoteSqlLiteral(model.tableName)}
      AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
    LIMIT 1;
    IF missing_column IS NOT NULL THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleColumn model table % is missing required column %', ${quoteSqlLiteral(model.tableName)}, missing_column;
    END IF;

    SELECT expected.column_name INTO incompatible_column
    FROM (VALUES ${expectedColumns.map((column) => `(${quoteSqlLiteral(column.name)}, ${quoteSqlLiteral(column.type)})`).join(', ')}) AS expected(column_name, data_type)
    JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
      AND actual.table_name = ${quoteSqlLiteral(model.tableName)}
      AND actual.column_name = expected.column_name
    WHERE actual.data_type <> expected.data_type
    LIMIT 1;
    IF incompatible_column IS NOT NULL THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleColumn model table % has an incompatible column %', ${quoteSqlLiteral(model.tableName)}, incompatible_column;
    END IF;

    SELECT actual.column_name INTO unknown_column
    FROM information_schema.columns actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = ${quoteSqlLiteral(model.tableName)}
      AND actual.column_name NOT IN (${expectedColumns.map((column) => quoteSqlLiteral(column.name)).join(', ')})
    LIMIT 1;
    IF unknown_column IS NOT NULL THEN
      RAISE EXCEPTION 'applik8s-model-migration-drift-detected: unknownExistingObject model table % has unmanaged column %', ${quoteSqlLiteral(model.tableName)}, unknown_column;
    END IF;
${indexChecks}
  END IF;
END
$applik8s_migration_preflight$;

COMMIT;
`;
}

export interface GeneratedApplicationModelMigrationPlan extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly toRevision: string;
}

export function applicationModelMigrationPlan(model: ApplicationRuntimeModelContract): GeneratedApplicationModelMigrationPlan {
  const revisionInput = JSON.stringify({ tableName: model.tableName, constraints: model.constraints, indexes: model.indexes });
  const revision = `sha256:${createHash('sha256').update(revisionInput).digest('hex')}`;
  return {
    id: `${model.tableName}-${revision.slice('sha256:'.length, 'sha256:'.length + 12)}`,
    model: model.name,
    tableName: model.tableName,
    toRevision: revision,
    compatibilityPolicy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' },
    checks: [
      { id: 'provider-readiness', kind: 'providerReadiness', failurePolicy: 'block', diagnostic: 'applik8s-model-migration-failed' },
      { id: 'schema-drift', kind: 'schemaDrift', failurePolicy: 'block', diagnostic: 'applik8s-model-migration-failed' },
      { id: 'destructive-change', kind: 'destructiveChange', failurePolicy: 'block', diagnostic: 'applik8s-model-migration-failed' },
    ],
    steps: [
      { id: 'create-history-table', kind: 'createTable', idempotent: true },
      { id: 'create-model-table', kind: 'createTable', idempotent: true, dependsOn: ['create-history-table'] },
      ...model.constraints.filter((constraint) => constraint.kind === 'unique').map((constraint) => ({ id: constraint.name, kind: 'addConstraint', idempotent: true, dependsOn: ['create-model-table'] })),
      ...model.indexes.map((index) => ({ id: index.name, kind: 'addIndex', idempotent: true, dependsOn: ['create-model-table'] })),
      { id: 'record-migration-history', kind: 'customSql', idempotent: true, dependsOn: ['create-model-table'] },
    ],
  };
}

function modelJsonFieldExpression(field: string): string {
  const normalized = field.startsWith('spec.') || field.startsWith('status.') ? field : `spec.${field}`;
  const [root, ...path] = normalized.split('.');
  if (root !== 'spec' && root !== 'status') {
    return `${quoteSqlIdentifier('spec')}->>${quoteSqlLiteral(field)}`;
  }
  if (path.length === 0) {
    return quoteSqlIdentifier(root);
  }
  const last = path[path.length - 1] ?? '';
  if (path.length === 1) {
    return `${quoteSqlIdentifier(root)}->>${quoteSqlLiteral(last)}`;
  }
  const prefix = path.slice(0, -1).map(quoteSqlLiteral).join(',');
  return `(${quoteSqlIdentifier(root)}#>${`'{${prefix}}'`}) ->> ${quoteSqlLiteral(last)}`;
}

function modelSqlIndexExpression(field: string): string {
  return `(${modelJsonFieldExpression(field)})`;
}

function normalizedSqlIndexExpression(field: string): string {
  return modelJsonFieldExpression(field).replaceAll('"', '').replaceAll(' ', '').toLowerCase();
}

function quoteSqlIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function applicationTransactionalDatabaseRequirementId(modelName: string): string {
  return `requirement.${applicationGraphNodeId('model', modelName)}.database`;
}

function applicationTransactionalDatabaseReconciliation(provider: ApplicationTransactionalDatabaseProvider): {
  readonly ownership: 'application' | 'external';
  readonly deletionPolicy: 'retain' | 'deleteWithApplication';
} {
  const runtimeProvider = applicationTransactionalDatabaseRuntimeProvider(
    provider,
    'application',
  );
  const ownership = runtimeProvider.provision === false || runtimeProvider.cluster || runtimeProvider.ownership === 'external'
    ? 'external'
    : 'application';
  const deletionPolicy = ownership === 'external'
    || (runtimeProvider.ownership === 'direct-provisioned' && runtimeProvider.lifecycle?.deletionPolicy === 'retain')
    ? 'retain'
    : 'deleteWithApplication';
  return { ownership, deletionPolicy };
}

function applicationTransactionalDatabaseProviderResources(provider: ApplicationTransactionalDatabaseProvider, modelName: string): readonly ApplicationResourceRef[] {
  const runtimeProvider = applicationTransactionalDatabaseRuntimeProvider(
    provider,
    modelName,
  );
  if (runtimeProvider.cluster) {
    return [runtimeProvider.cluster];
  }
  const clusterName = runtimeProvider.clusterName ?? runtimeProvider.name ?? `${kubernetesNameSegment(modelName)}-db`;
  return [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(runtimeProvider.namespace ? { namespace: runtimeProvider.namespace } : {}) }];
}

function applicationTransactionalDatabaseRuntime(provider: ApplicationTransactionalDatabaseProvider, modelName: string, resources: readonly ApplicationResourceRef[]): ApplicationProviderRuntimeContract {
  const runtimeProvider = applicationTransactionalDatabaseRuntimeProvider(
    provider,
    modelName,
  );
  const cluster = resources[0];
  const secret = runtimeProvider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${cluster?.name ?? kubernetesNameSegment(modelName)}-app`, ...(runtimeProvider.namespace ? { namespace: runtimeProvider.namespace } : {}) };
  return {
    ...(runtimeProvider.runtime ?? {}),
    env: { DATABASE_URL_SECRET: secret.name ?? `${kubernetesNameSegment(modelName)}-db-app`, ...(runtimeProvider.runtime?.env ?? {}) },
    secretRefs: uniqueApplicationResourceRefs([secret, ...(runtimeProvider.runtime?.secretRefs ?? [])]),
    readiness: runtimeProvider.runtime?.readiness ?? {
      dependencies: resources,
      condition: runtimeProvider.readiness?.condition ?? 'Ready',
      timeoutSeconds: runtimeProvider.readiness?.timeoutSeconds ?? 300,
    },
  };
}

/**
 * Profile-selected database fields are already lowered by
 * applicationTransactionalDatabaseImplementation() into schema-driven values.
 * Preserve those values in the generated workload rather than freezing the
 * first branch's connection identity: external profiles legitimately point at
 * a different cluster, database, and Secret.
 */
function applicationTransactionalDatabaseRuntimeProvider(
  provider: ApplicationTransactionalDatabaseProvider,
  _modelName: string,
): ApplicationTransactionalDatabaseProvider {
  return provider;
}

function applicationModelIdentity<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly string[] {
  return schema?.identity?.map(String) ?? ['id'];
}

function applicationTransactionalDatabaseConstraints<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly ApplicationModelConstraint[] {
  return (schema?.constraints ?? []).map((constraint) => ({
    name: constraint.name,
    kind: constraint.kind,
    fields: constraint.fields.map(String),
  }));
}

function applicationTransactionalDatabaseIndexes<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly ApplicationModelIndex[] {
  return (schema?.indexes ?? []).map((index) => ({
    name: index.name,
    fields: applicationModelIndexFields(index),
    ...(index.unique ? { unique: true } : {}),
  }));
}

function applicationModelIndexFields<TSpec extends object, TStatus extends object>(index: ApplicationModelSchemaIndexOptions<TSpec, TStatus>): readonly string[] {
  return [
    ...(index.partitionBy ? [String(index.partitionBy)] : []),
    ...(index.orderBy ?? []),
  ];
}

function recordApplicationModelMigrationJobGraph(state: ApplicationModelGraphState, modelName: string, modelNodeId: string, provider: ApplicationTransactionalDatabaseProvider, resources: readonly ApplicationResourceRef[]): void {
  const jobName = provider.migrations?.jobName ?? `${kubernetesNameSegment(modelName)}-migration`;
  const nodeId = applicationGraphNodeId('job', jobName);
  const jobResource = { apiVersion: 'batch/v1', kind: 'Job', name: jobName, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  const statusTarget = { resource: resources[0] ?? { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster' }, statusPath: `status.applik8s.jobs.${jobName}` };
  const statusConfigMapName = state.appResource ? `${kubernetesNameSegment(state.appResource.kind)}-status-reconciler-status` : undefined;
  const statusShape = applicationGeneratedJobDurableStatus({ jobName, idempotencyKey: 'metadata.generation', currentStep: 'provider-readiness' });
  const durableStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName,
    observes: [jobResource],
    writes: statusTarget,
    statusShape,
    ...(statusConfigMapName ? { statusConfigMapName } : {}),
    ...(provider.namespace ? { statusConfigMapNamespace: provider.namespace } : {}),
  });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: jobName,
    stability: 'stable',
    task: { taskKind: 'migration' },
    phase: applicationGeneratedJobPhase(),
    resources,
    retry: applicationGeneratedJobRetry(),
    observability: applicationGeneratedJobObservability(`${jobName}-diagnostics`),
    runtime: applicationGeneratedJobRuntime({
      materialization: 'kubernetes-job',
      statusResource: statusTarget.resource,
      statusPath: statusTarget.statusPath,
      permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
      environment: applicationTransactionalDatabaseRuntime(provider, modelName, resources),
      durableStatusUpdater,
      statusLifecycle: applicationGeneratedJobStatusLifecycle({ jobName, materialization: 'kubernetes-job', ...(statusConfigMapName ? { statusConfigMapName } : {}), ...(provider.namespace ? { statusConfigMapNamespace: provider.namespace } : {}) }),
      metadataLinks: [{ graphNode: { nodeId }, artifact: { kind: 'jobDiagnostics', name: `${jobName}-diagnostics` }, purpose: 'jobDiagnostics' }],
    }),
    generatedResources: [
      { role: 'migration', graphNode: { nodeId }, resource: jobResource, artifact: { kind: 'kubernetesManifest', name: `${jobName}.yaml` }, dependsOn: [{ nodeId: modelNodeId }] },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: `${jobName}-status-runtime`, ...(provider.namespace ? { namespace: provider.namespace } : {}) }, artifact: { kind: 'runtimeModule', name: `${jobName}-status-runtime` } },
      { role: 'jobDiagnostics', graphNode: { nodeId }, artifact: { kind: 'jobDiagnostics', name: `${jobName}-diagnostics` } },
    ],
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: modelNodeId }, relationship: 'dependsOn' });
}

function recordApplicationProviderGraph(
  state: ApplicationGraphState,
  tokenName: string | undefined,
  bindingKind: string,
  implementation: unknown,
  qualification?: ApplicationProviderQualification,
): void {
  const providerInterface = applicationProviderInterface(tokenName);
  if (!providerInterface) {
    return;
  }
  const selectedImplementation =
    applicationProviderSelectionFor(implementation) ?? implementation;
  const nodeId = applicationProviderNodeId(providerInterface, qualification);
  let existingConfig: Readonly<Record<string, JsonValue>> | undefined;
  for (let index = state.graphNodes.length - 1; index >= 0; index -= 1) {
    const candidate = state.graphNodes[index];
    if (candidate?.kind === 'provider' && candidate.id === nodeId) {
      existingConfig = candidate.config;
      break;
    }
  }
  const eventLog = providerInterface === 'EventLog' ? applicationEventLogImplementation(implementation) : undefined;
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'provider',
    name: providerInterface,
    stability: 'stable',
    interface: providerInterface,
    implementation: applicationProviderImplementationName(selectedImplementation),
    contract: applicationProviderInterfaceContract(providerInterface, selectedImplementation),
    config: {
      ...(existingConfig ?? {}),
      bindingKind:
        typeof existingConfig?.bindingKind === 'string'
          ? existingConfig.bindingKind
          : bindingKind,
      provider: applicationProviderImplementationName(selectedImplementation),
      ...(qualification
        ? { qualification: qualification as unknown as JsonValue }
        : {}),
      // Deployment lowering consumes the normalized ApplicationGraph, not the
      // authoring closure. Preserve the complete validated provider
      // contract—including typed installation references and lifecycle data—
      // so ownership, backup, and external-provider decisions remain possible
      // at the deployment boundary.
      ...(providerInterface === 'TransactionalDatabase' && selectedImplementation && typeof selectedImplementation === 'object'
        ? { transactionalDatabase: applicationTypeKroGraphValue(selectedImplementation) as JsonValue }
        : {}),
      ...(providerInterface === 'AnalyticalDatabase' && selectedImplementation && typeof selectedImplementation === 'object'
        ? { analyticalDatabase: applicationTypeKroGraphValue(selectedImplementation) as JsonValue }
        : {}),
      ...(eventLog ? {
        name: eventLog.name ?? 'applik8s-events',
        namespace: eventLog.namespace ?? '',
        servers: [...(eventLog.servers ?? [])],
        stream: eventLog.stream ?? 'APPLIK8S_EVENTS',
        subjectPrefix: eventLog.subjectPrefix ?? 'applik8s',
        provision: eventLog.provision ?? true,
        replicas: eventLog.replicas ?? 1,
        storageSize: eventLog.storageSize ?? '10Gi',
        ...(eventLog.storageClassName
          ? { storageClassName: eventLog.storageClassName }
          : {}),
        pvcRetentionPolicy: eventLog.pvcRetentionPolicy ?? 'retain',
        authMode: eventLog.authMode ?? 'token',
        ...(eventLog.connectionSecret ? { connectionSecret: { apiVersion: eventLog.connectionSecret.apiVersion, kind: eventLog.connectionSecret.kind, ...(eventLog.connectionSecret.name ? { name: eventLog.connectionSecret.name } : {}), ...(eventLog.connectionSecret.namespace ? { namespace: eventLog.connectionSecret.namespace } : {}) } } : {}),
        tokenKey: eventLog.tokenKey ?? 'token',
        userKey: eventLog.userKey ?? 'user',
        passwordKey: eventLog.passwordKey ?? 'password',
      } : {}),
    },
  });
}

function applicationProviderInterfaceContract(providerInterface: ApplicationProviderInterfaceKind, implementation: unknown): ApplicationProviderInterfaceContract {
  const implemented = (providerInterface === 'TransactionalDatabase' && applicationProviderImplementationName(implementation) === 'postgres')
    || (providerInterface === 'AnalyticalDatabase' && applicationProviderImplementationName(implementation) === 'clickhouse')
    || (providerInterface === 'EventLog' && applicationProviderImplementationName(implementation) === 'nats-jetstream');
  return {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: providerInterface,
    version: 'v1alpha1',
    requirements: providerInterface === 'EventLog' ? ['durableTransport'] : ['applicationRuntimeBinding'],
    guarantees: providerInterface === 'TransactionalDatabase'
      ? ['sameDomainTransactions', 'durableResults', 'transactionalOutbox']
      : providerInterface === 'AnalyticalDatabase'
        ? ['idempotentInsert', 'checkpoint', 'fullRebuild']
      : providerInterface === 'EventLog'
        ? ['atLeastOnce', 'stableMessageIds', 'replay']
        : [],
    implementation: { name: applicationProviderImplementationName(implementation) },
    surface: 'stablePublicApi',
    support: implemented ? 'implemented' : 'failClosedReserved',
    diagnostics: implemented ? [] : [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: applicationProviderNodeId(providerInterface) }, reason: 'ProviderInterfaceReserved', message: `${providerInterface} is reserved as a stable v0.3 provider interface but no generated provider adapter is enabled for this binding.`, retryable: false }],
  };
}

function applicationProviderNodeId(
  providerInterface: ApplicationProviderInterfaceKind,
  qualification?: ApplicationProviderQualification,
): string {
  return applicationProviderGraphNodeId(providerInterface, qualification);
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}

function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function uniqueApplicationResourceRefs(refs: readonly ApplicationResourceRef[]): readonly ApplicationResourceRef[] {
  const byKey = new Map<string, ApplicationResourceRef>();
  for (const ref of refs) {
    byKey.set(`${ref.apiVersion}:${ref.kind}:${applicationTypeKroValueIdentity(ref.namespace)}:${applicationTypeKroValueIdentity(ref.name)}`, ref);
  }
  return [...byKey.values()];
}

function applicationModelRuntimeBoundary(): ApplicationModelBackendContract['runtimeBoundary'] {
  return {
    serializedCallbacks: 'generatedRuntimeClient',
    scriptExecution: 'scriptRuntimeClient',
  };
}
