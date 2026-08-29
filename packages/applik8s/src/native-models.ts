// typecast-file-boundary: Drizzle table identity and schema-normalized registries preserve generics that must be restored after runtime identity checks.

import {
  type ApplicationMutationOperation,
  type ApplicationOperationContract,
  type ApplicationQueryOperation,
  createApplicationMutationOperation,
  decorateApplicationMutationOperation,
  getApplicationOperationContract,
  installApplicationOperationRuntimeResolver,
} from '@applik8s/client';
import type {
  JsonValue,
  ResourceDefinition,
  ResourceInstanceInput,
  ResourceObject,
  RuntimeSchema,
} from '@applik8s/core';
import { emitArkTypeStructuralJsonSchema } from '@applik8s/sdk';
import { type as arkType, type Type } from 'arktype';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-arktype';
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  getTableName,
  type InferInsertModel,
  type InferSelectModel,
  isTable,
  Many,
  normalizeRelation,
  One,
  type Relation,
  type Relations,
  type Table,
} from 'drizzle-orm';
import { type AnyPgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { instrumentedApplicationCallbackSource } from './application-callback.js';
import type {
  ApplicationResourceControllerBinding,
  ApplicationResourceControllerOptions,
  ApplicationResourceEventHandler,
} from './application-events.js';
import {
  currentApplicationManagedEffects,
  stagedApplicationCommandResult,
} from './application-managed-effects-api.js';
import type {
  ApplicationModelBinding,
  ApplicationModelCommandBinding,
  ApplicationModelCommandHandler,
  ApplicationModelCommandOptions,
} from './application-models.js';
import type {
  ApplicationKubernetesModelViewContract,
  ApplicationKubernetesModelViewImplementation,
  ApplicationKubernetesModelViewOptions,
  ApplicationKubernetesModelViewSchemaContract,
  ApplicationModelQueryContract,
  ApplicationModelQueryImplementation,
  ApplicationModelQuerySchemaContract,
  ApplicationModelViewContract,
  ApplicationModelViewImplementation,
  ApplicationModelViewOptions,
  ApplicationModelViewSchemaContract,
  ApplicationQueryPrincipal,
  ApplicationQuerySourceBinding,
} from './application-queries.js';
import type {
  ApplicationStreamProcessContext,
  ApplicationStreamProcessOptions,
  ApplicationStreamProcessorBinding,
} from './application-reactive.js';
import type {
  ApplicationSearchDocument,
  ApplicationSearchField,
  ApplicationSearchIndexBinding,
} from './application-search.js';
import { runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
import type { CommandDefinition } from './dsl.js';
import {
  type ApplicationNativeModelEditTarget,
  bindApplicationNativeModelMethod,
  editApplicationNativeModelObject,
  findApplicationNativeModelObjects,
  getApplicationNativeModelObject,
  requireApplicationNativeModelObject,
} from './native-model-execution.js';
import { applicationModelFacet } from './native-model-runtime.js';

export { applicationModelFacet, getRequiredDrizzleApplicationModelFacet } from './native-model-runtime.js';

/** Stable runtime metadata key carried by ArkType identity-reference schemas. */
export const applicationModelReference = Symbol.for('@applik8s/model-reference');

export interface ApplicationModelSnapshot<TValue, TIdentity = string> {
  readonly identity: TIdentity;
  readonly value: TValue;
  readonly revision?: string;
}

/** A committed relational insert delivered from the model's transactional outbox. */
export interface ApplicationModelCreateEvent<TValue, TIdentity = string> {
  readonly operation: 'create';
  readonly identity: TIdentity;
  readonly value: TValue;
  /** Present when the authoritative store exposes the committed revision in the event payload. */
  readonly revision?: string;
}

export interface ApplicationModelUpdateInput<TUpdate, TIdentity = string> {
  readonly identity: TIdentity;
  readonly patch: TUpdate;
}

export interface ApplicationModelDeleteInput<TIdentity = string> {
  readonly identity: TIdentity;
}

/** A committed relational update delivered from the model's transactional outbox. */
export interface ApplicationModelUpdateEvent<TValue, TIdentity = string> {
  readonly operation: 'update';
  readonly identity: TIdentity;
  readonly previous: TValue;
  readonly current: TValue;
  readonly revision?: string;
}

export interface ApplicationModelDeleteEvent<TValue, TIdentity = string> {
  readonly operation: 'delete';
  readonly identity: TIdentity;
  readonly previous: TValue;
  readonly tombstone: { readonly identity: TIdentity; readonly deleted: true };
  readonly revision?: string;
}

export type ApplicationModelCreateEventHandler<TValue, TIdentity = string> = (
  created: ApplicationModelCreateEvent<TValue, TIdentity>,
  context: ApplicationStreamProcessContext,
) => void | Promise<void>;

export type ApplicationModelUpdateEventHandler<TValue, TIdentity = string> = (
  updated: ApplicationModelUpdateEvent<TValue, TIdentity>,
  context: ApplicationStreamProcessContext,
) => void | Promise<void>;

export type ApplicationModelDeleteEventHandler<TValue, TIdentity = string> = (
  deleted: ApplicationModelDeleteEvent<TValue, TIdentity>,
  context: ApplicationStreamProcessContext,
) => void | Promise<void>;

/**
 * Transaction-time customization for a conventional model mutation.
 *
 * The framework still owns the mutation contract, durable result, lifecycle
 * event, and return value. This hook exists only for invariants that must be
 * checked or derived while the authoritative row is locked. External effects
 * remain forbidden and must be emitted through the declared outbox.
 */
export type ApplicationModelBeforeCommitHandler<TValue extends object, TInput extends object> = (
  model: ApplicationModelCommandHandler<TValue, Record<string, never>, TInput, object> extends (
    model: infer TModel,
    input: TInput,
    context: infer _TContext,
  ) => unknown
    ? TModel
    : never,
  input: TInput,
  context: ApplicationModelCommandHandler<TValue, Record<string, never>, TInput, object> extends (
    model: infer _TModel,
    input: TInput,
    context: infer TContext,
  ) => unknown
    ? TContext
    : never,
) => void | Promise<void>;

export type ApplicationModelBeforeCommitOptions<TInput extends object, TValue extends object> = Omit<
  ApplicationModelCommandOptions<TInput, TValue>,
  | 'key'
  | 'missing'
  | 'publicName'
  | '__operation'
  | '__generatedSources'
  | '__generatedEventBindings'
>;

export interface ApplicationModelMutationOperation<TInput extends object, TOutput, TValue extends object>
  extends ApplicationMutationOperation<TInput, TOutput, TValue> {
  /**
   * Adds one transaction-authoritative policy hook without changing the
   * conventional create/update/delete public operation or its event stream.
   */
  beforeCommit(
    options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
    handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
  ): ApplicationModelMutationOperation<TInput, TOutput, TValue>;
}

export interface ApplicationModelLifecycleRegistrar<TValue, TIdentity = string> {
  create(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelCreateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<TValue, TIdentity>>;
  update(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelUpdateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<TValue, TIdentity>>;
  delete(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelDeleteEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<TValue, TIdentity>>;
}

export interface FunctionNativeApplicationModelLifecycleRegistrar<TValue, TIdentity = string>
  extends ApplicationModelLifecycleRegistrar<TValue, TIdentity> {
  create(
    handler: ApplicationModelCreateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<TValue, TIdentity>>;
  create(
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelCreateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<TValue, TIdentity>>;
  create(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelCreateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<TValue, TIdentity>>;
  update(
    handler: ApplicationModelUpdateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<TValue, TIdentity>>;
  update(
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelUpdateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<TValue, TIdentity>>;
  update(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelUpdateEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<TValue, TIdentity>>;
  delete(
    handler: ApplicationModelDeleteEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<TValue, TIdentity>>;
  delete(
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelDeleteEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<TValue, TIdentity>>;
  delete(
    name: string,
    options: ApplicationStreamProcessOptions,
    handler: ApplicationModelDeleteEventHandler<TValue, TIdentity>,
  ): ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<TValue, TIdentity>>;
}

export interface ApplicationModelIdentityContract {
  readonly fields: readonly string[];
  readonly encoding: 'scalar';
}

export interface ApplicationModelRevisionContract {
  readonly field: string;
  readonly authority: 'postgres-row' | 'kubernetes-resource-version' | 'transactional-database';
}

export interface ApplicationModelRelationshipContract {
  readonly source: string;
  readonly name: string;
  readonly target: string;
  readonly cardinality: 'one' | 'many';
  readonly integrity: 'foreign-key' | 'relation-only' | 'soft' | 'reconcile-checked';
  readonly fields: readonly string[];
  readonly references: readonly string[];
}

export interface ApplicationModelReferenceContract {
  readonly target: string;
  readonly identity: ApplicationModelIdentityContract;
  readonly integrity: 'foreign-key' | 'relation-only' | 'soft' | 'reconcile-checked';
}

export type ApplicationModelReferenceSchema<TIdentity> = Type<TIdentity> & {
  readonly [applicationModelReference]: ApplicationModelReferenceContract;
};

export interface ApplicationModelSchemaSet<TSelect, TInsert = never, TUpdate = never> {
  readonly select: Type<TSelect> | (TSelect extends object ? RuntimeSchema<TSelect> : never);
  readonly insert?: Type<TInsert>;
  readonly update?: Type<TUpdate>;
}

export interface CommonApplicationModelFacet<TValue, TIdentity = string, TInsert = never, TUpdate = never> {
  readonly apiVersion: 'applik8s.model/v1alpha1';
  readonly kind: 'applicationModelFacet';
  readonly name: string;
  readonly provider: 'postgres' | 'kubernetes' | 'transactional-database' | 'analytical-database';
  readonly native: 'drizzle-table' | 'kubernetes-resource' | 'jsonb-model';
  readonly identity: ApplicationModelIdentityContract;
  readonly revision?: ApplicationModelRevisionContract;
  readonly schema: ApplicationModelSchemaSet<TValue, TInsert, TUpdate>;
  readonly relationships: readonly ApplicationModelRelationshipContract[];
  readonly runtimeRoles?: readonly string[];
  readonly relations: Readonly<Record<string, ApplicationModelRelationshipContract>>;
  readonly access?: {
    readonly context: string;
    readonly namespaceLabel: string;
  };
  ref(): ApplicationModelReferenceSchema<TIdentity>;
}

export type ConventionalTableIdentity<TTable extends Table> = 'id' extends keyof InferSelectModel<TTable>
  ? InferSelectModel<TTable>['id']
  : unknown;

export interface DrizzleApplicationModelFacet<TTable extends AnyPgTable, TIdentity = ConventionalTableIdentity<TTable>>
  extends Omit<
    CommonApplicationModelFacet<
      InferSelectModel<TTable>,
      TIdentity,
      InferInsertModel<TTable>,
      Partial<InferInsertModel<TTable>>
    >,
    'provider' | 'native' | 'schema'
  > {
  readonly provider: 'postgres';
  readonly native: 'drizzle-table';
  readonly schema: {
    readonly select: Type<InferSelectModel<TTable>>;
    readonly insert: Type<InferInsertModel<TTable>>;
    readonly update: Type<Partial<InferInsertModel<TTable>>>;
  };
  readonly database: string;
  readonly table: {
    readonly name: string;
    readonly schema?: string;
  };
  /**
   * Native table members that prevented installation of the corresponding
   * direct convenience member. The Drizzle member always wins; `api` is the
   * collision-safe symbol-backed escape hatch.
   */
  readonly directMemberCollisions: readonly string[];
  readonly api: DrizzleApplicationModelApi<TTable, TIdentity>;
  readonly on: FunctionNativeApplicationModelLifecycleRegistrar<
    InferSelectModel<TTable>,
    TIdentity
  >;
}

export type ApplicationModelEditTarget<TValue extends object, TIdentity> =
  TValue & ApplicationNativeModelEditTarget<TValue, TIdentity>;

export interface DrizzleApplicationModelApi<TTable extends AnyPgTable, TIdentity = ConventionalTableIdentity<TTable>> {
  /** Transaction-locked point read whose participant dependency is inferred from the managed closure. */
  get(identity: TIdentity): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity> | undefined>;
  /** Bounded transaction-locked equality query inferred as a managed participant dependency. */
  find(options: {
    readonly where?: Partial<InferSelectModel<TTable>>;
    readonly limit: number;
  }): Promise<readonly ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>[]>;
  /** Required transaction-scoped point read inferred from the managed closure. */
  require(identity: TIdentity): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>>;
  /**
   * Opens the model-authoritative transaction boundary used by an ordinary
   * managed function. It does not register or expose an operation by itself.
   */
  edit<TResult>(
    identity: TIdentity,
    handler: (
      target: ApplicationModelEditTarget<InferSelectModel<TTable>, TIdentity>,
    ) => TResult | Promise<TResult>,
  ): Promise<TResult>;
  readonly create: ApplicationModelMutationOperation<
    InferInsertModel<TTable>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>,
    InferSelectModel<TTable>
  >;
  readonly update: ApplicationModelMutationOperation<
    ApplicationModelUpdateInput<Partial<InferInsertModel<TTable>>, TIdentity>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>,
    InferSelectModel<TTable>
  >;
  readonly delete: ApplicationModelMutationOperation<
    ApplicationModelDeleteInput<TIdentity>,
    ApplicationModelDeleteEvent<InferSelectModel<TTable>, TIdentity>['tombstone'],
    InferSelectModel<TTable>
  >;
  readonly on: FunctionNativeApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, TIdentity>;
  query<
    TInputSchema extends Type,
    TOutputSchema extends Type,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelQuerySchemaContract<TInputSchema, TOutputSchema, TPrincipal, TSource>,
    implementation: ApplicationModelQueryImplementation<
      TInputSchema['infer'],
      TOutputSchema['infer'],
      TPrincipal,
      TSource
    >,
  ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
  query<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelQueryContract<TInput, TOutput, TPrincipal, TSource>,
    implementation: ApplicationModelQueryImplementation<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    TInputSchema extends Type,
    TOutputSchema extends Type,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelViewSchemaContract<TInputSchema, TOutputSchema, TPrincipal, TSource>,
    implementation: (
      input: TInputSchema['infer'],
      context: import('./application-queries.js').ApplicationModelViewContext<TPrincipal, TSource>,
    ) => unknown | Promise<unknown>,
  ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
  view<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelViewContract<TInput, TOutput, TPrincipal, TSource>,
    implementation: ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    const TName extends string,
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    name: TName,
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): PromotedDrizzleTable<TTable, TIdentity> & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
}

type DrizzleApplicationModelDirectMembers<TTable extends AnyPgTable, TIdentity> = {
  readonly $model: DrizzleApplicationModelFacet<TTable, TIdentity>;
  readonly schema: DrizzleApplicationModelFacet<TTable, TIdentity>['schema'];
  readonly relations: DrizzleApplicationModelFacet<TTable, TIdentity>['relations'];
  ref(): ApplicationModelReferenceSchema<TIdentity>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
} & DrizzleApplicationModelApi<TTable, TIdentity>;

/**
 * Public model surface returned from `model()`.
 *
 * Runtime promotion also installs a collision-safe symbol facet, but that
 * implementation key must not leak into declarations emitted by applications
 * or maintained integration packages.
 */
export type ApplicationRelationalModel<
  TTable extends AnyPgTable,
  TIdentity = ConventionalTableIdentity<TTable>,
> = TTable & Omit<
  DrizzleApplicationModelDirectMembers<TTable, TIdentity>,
  keyof TTable['_']['columns']
>;

export type PromotedDrizzleTable<TTable extends AnyPgTable, TIdentity = ConventionalTableIdentity<TTable>> =
  ApplicationRelationalModel<TTable, TIdentity> & {
    readonly [applicationModelFacet]: DrizzleApplicationModelFacet<TTable, TIdentity>;
  };

export interface DrizzleAnalyticalApplicationModelFacet<
  TTable extends AnyPgTable,
  TIdentity = ConventionalTableIdentity<TTable>,
> extends Omit<
    CommonApplicationModelFacet<InferSelectModel<TTable>, TIdentity>,
    'provider' | 'native' | 'schema' | 'revision'
  > {
  readonly provider: 'analytical-database';
  readonly native: 'drizzle-table';
  readonly schema: {
    readonly select: Type<InferSelectModel<TTable>>;
  };
  readonly table: {
    readonly name: string;
    readonly schema?: string;
  };
  readonly directMemberCollisions: readonly string[];
  readonly capabilities: {
    readonly reads: 'declaredQueries';
    readonly aggregates: 'providerRefinement';
    readonly ingestion: 'projectionOwned';
    readonly checkpoint: 'idempotent';
    readonly rebuild: 'fullReplay';
  };
  readonly api: {
    query<
      TInputSchema extends Type,
      TOutputSchema extends Type,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      contract: ApplicationModelQuerySchemaContract<TInputSchema, TOutputSchema, TPrincipal, TSource>,
      implementation: ApplicationModelQueryImplementation<
        TInputSchema['infer'],
        TOutputSchema['infer'],
        TPrincipal,
        TSource
      >,
    ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
    query<
      TInput,
      TOutput,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      contract: ApplicationModelQueryContract<TInput, TOutput, TPrincipal, TSource>,
      implementation: ApplicationModelQueryImplementation<TInput, TOutput, TPrincipal, TSource>,
    ): ApplicationQueryOperation<TInput, TOutput>;
    view<
      TInput,
      TOutput,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
    ): ApplicationQueryOperation<TInput, TOutput>;
    view<
      TInput,
      TOutput,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      contract: ApplicationModelViewContract<TInput, TOutput, TPrincipal, TSource>,
      implementation: ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>,
    ): ApplicationQueryOperation<TInput, TOutput>;
    view<
      const TName extends string,
      TInput,
      TOutput,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      name: TName,
      options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
    ): PromotedAnalyticalDrizzleTable<TTable, TIdentity> &
      Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
  };
}

type DrizzleAnalyticalModelDirectMembers<TTable extends AnyPgTable, TIdentity> = {
  readonly $model: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>;
  readonly schema: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>['schema'];
  readonly relations: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>['relations'];
  ref(): ApplicationModelReferenceSchema<TIdentity>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  query<
    TInputSchema extends Type,
    TOutputSchema extends Type,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelQuerySchemaContract<TInputSchema, TOutputSchema, TPrincipal, TSource>,
    implementation: ApplicationModelQueryImplementation<
      TInputSchema['infer'],
      TOutputSchema['infer'],
      TPrincipal,
      TSource
    >,
  ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
  query<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelQueryContract<TInput, TOutput, TPrincipal, TSource>,
    implementation: ApplicationModelQueryImplementation<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    contract: ApplicationModelViewContract<TInput, TOutput, TPrincipal, TSource>,
    implementation: ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    const TName extends string,
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    name: TName,
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): PromotedAnalyticalDrizzleTable<TTable, TIdentity> &
    Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
};

export type PromotedAnalyticalDrizzleTable<
  TTable extends AnyPgTable,
  TIdentity = ConventionalTableIdentity<TTable>,
> = TTable & {
  readonly [applicationModelFacet]: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>;
} & Omit<
  DrizzleAnalyticalModelDirectMembers<TTable, TIdentity>,
  keyof TTable['_']['columns']
>;

export interface PromoteDrizzleTableOptions<TTable extends AnyPgTable> {
  readonly name?: string;
  readonly database?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly identity?: readonly (keyof InferSelectModel<TTable> & string)[];
  readonly revision?: (keyof InferSelectModel<TTable> & string) | false;
  readonly runtimeRoles?: readonly string[];
}

export type PromoteAnalyticalDrizzleTableOptions<TTable extends AnyPgTable> = Omit<
  PromoteDrizzleTableOptions<TTable>,
  'database' | 'revision'
>;

type NativeModelCommandRegistrar = (
  command: CommandDefinition<object, object, Readonly<Record<string, object>>>,
  options: ApplicationModelCommandOptions<object, object>,
  handler: ApplicationModelCommandHandler<
    object,
    Record<string, never>,
    object,
    object,
    Readonly<Record<string, object>>
  >,
) => ApplicationModelCommandBinding<object, object, object, Record<string, never>>;
export type NativeApplicationModelCommandRegistrar<TTable extends AnyPgTable> = <
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
>(
  command: CommandDefinition<TInput, TOutput, TErrors>,
  options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
  handler: ApplicationModelCommandHandler<
    InferSelectModel<TTable>,
    Record<string, never>,
    TInput,
    TOutput,
    TErrors
  >,
) => ApplicationModelCommandBinding<
  TInput,
  TOutput,
  InferSelectModel<TTable>,
  Record<string, never>
>;
type NativeModelBeforeCommitRegistrar = (
  options: ApplicationModelBeforeCommitOptions<object, object>,
  handler: ApplicationModelBeforeCommitHandler<object, object>,
) => void;
type ApplicationModelViewRegistrar = <
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined,
>(
  name: string,
  options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  operationKind?: 'query' | 'view',
) => ApplicationQueryOperation<TInput, TOutput>;

const nativeModelCommandRegistrars = new WeakMap<object, NativeModelCommandRegistrar>();
const nativeModelBeforeCommitRegistrars = new WeakMap<object, NativeModelBeforeCommitRegistrar>();
type NativeModelLifecycleRegistrar = ApplicationModelLifecycleRegistrar<object, unknown>;
const nativeModelLifecycleRegistrars = new WeakMap<object, NativeModelLifecycleRegistrar>();
const nativeApplicationModelBindings = new WeakMap<object, ApplicationModelBinding<object, object>>();
const applicationModelViewRegistrars = new WeakMap<object, ApplicationModelViewRegistrar>();
const applicationModelCommandOperationBindings = new WeakMap<object, ApplicationModelCommandBinding>();
const applicationModelCommandContractBindings = new WeakMap<
  object,
  ApplicationModelCommandBinding
>();
const applicationModelCommandBindingsById = new Map<
  string,
  ApplicationModelCommandBinding | 'ambiguous'
>();
installApplicationOperationRuntimeResolver(() => {
  const effects = currentApplicationManagedEffects();
  if (!effects) return undefined;
  return {
    execute<TInput, TOutput>(
      operation: ApplicationOperationContract,
      input: TInput,
    ) {
      const binding =
        applicationModelCommandContractBindings.get(operation)
        ?? applicationModelCommandBindingById(operation.id);
      if (!binding) {
        throw new Error(
          `Application operation ${operation.id} is not a transaction-staged model command.`,
        );
      }
      const route = (messageId: string) =>
        binding.route(input as object, messageId, effects.routingContext);
      return runApplicationTelemetryBoundary({
        kind: 'operation',
        identity: operation.id,
        definition: operation.id,
        relationship: 'synchronous',
      }, async () => {
        if (effects.invokeAtomic) {
          return effects.invokeAtomic(
            operation,
            input as object,
            route,
          ) as Promise<TOutput>;
        }
        const reference = effects.invoke(operation, input as object, route);
        return stagedApplicationCommandResult<TOutput>(reference);
      });
    },
  };
});
type NativeKubernetesLifecycleRegistrar = ApplicationKubernetesLifecycleRegistrar<object, object>;
const nativeKubernetesLifecycleRegistrars = new WeakMap<object, NativeKubernetesLifecycleRegistrar>();

export function applicationModelCommandBindingForOperation(value: unknown): ApplicationModelCommandBinding | undefined {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? applicationModelCommandOperationBindings.get(value)
    : undefined;
}

function bindApplicationModelCommandContract(
  contract: ApplicationOperationContract,
  binding: ApplicationModelCommandBinding,
): void {
  applicationModelCommandContractBindings.set(contract, binding);
  const id = String(contract.id);
  const existing = applicationModelCommandBindingsById.get(id);
  applicationModelCommandBindingsById.set(
    id,
    !existing || existing === binding ? binding : 'ambiguous',
  );
}

function applicationModelCommandBindingById(
  id: ApplicationOperationContract['id'],
): ApplicationModelCommandBinding | undefined {
  const binding = applicationModelCommandBindingsById.get(String(id));
  return binding === 'ambiguous' ? undefined : binding;
}

export function bindNativeApplicationModelBeforeCommit<TInput extends object, TOutput, TValue extends object>(
  operation: ApplicationModelMutationOperation<TInput, TOutput, TValue>,
  registrar: (
    options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
    handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
  ) => void,
): void {
  nativeModelBeforeCommitRegistrars.set(operation, registrar as unknown as NativeModelBeforeCommitRegistrar);
}

export function nativeApplicationModelBeforeCommitRegistrar<TInput extends object, TOutput, TValue extends object>(
  operation: ApplicationModelMutationOperation<TInput, TOutput, TValue>,
):
  | ((
      options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
      handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
    ) => void)
  | undefined {
  return nativeModelBeforeCommitRegistrars.get(operation) as unknown as
    | ((
        options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
        handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
      ) => void)
    | undefined;
}

/** Binds a compiler-created direct operation such as Model.create to its durable command transport. */
export function bindApplicationModelCommandOperation(value: object, binding: ApplicationModelCommandBinding): void {
  applicationModelCommandOperationBindings.set(value, binding);
  const contract = getApplicationOperationContract(value);
  if (contract) bindApplicationModelCommandContract(contract, binding);
}

export function bindNativeKubernetesLifecycle<TSpec extends object, TStatus extends object>(
  resource: PromotedKubernetesResource<TSpec, TStatus>,
  registrar: ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus>,
): void {
  nativeKubernetesLifecycleRegistrars.set(resource, registrar as unknown as NativeKubernetesLifecycleRegistrar);
}

export function nativeKubernetesLifecycleRegistrar<TSpec extends object, TStatus extends object>(
  resource: PromotedKubernetesResource<TSpec, TStatus>,
): ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus> | undefined {
  return nativeKubernetesLifecycleRegistrars.get(resource) as unknown as
    | ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus>
    | undefined;
}

export interface KubernetesApplicationModelFacet<TSpec extends object, TStatus extends object = Record<string, never>>
  extends Omit<CommonApplicationModelFacet<TSpec, string>, 'provider' | 'native' | 'schema' | 'revision'> {
  readonly provider: 'kubernetes';
  readonly native: 'kubernetes-resource';
  readonly schema: { readonly select: RuntimeSchema<TSpec> };
  readonly revision: { readonly field: 'metadata.resourceVersion'; readonly authority: 'kubernetes-resource-version' };
  readonly resource: {
    readonly apiVersion: string;
    readonly kind: string;
    readonly plural: string;
    readonly scope: 'Namespaced' | 'Cluster';
  };
  readonly access?: {
    readonly context: string;
    readonly namespaceLabel: string;
  };
  readonly create?: ApplicationKubernetesCreatePolicy<TSpec>;
  readonly __status?: TStatus;
}

export interface ApplicationKubernetesCreateRequest<
  TSpec extends object,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> {
  readonly principal: TPrincipal;
  readonly context: Readonly<Record<string, JsonValue>>;
  readonly input: TSpec;
}

export interface ApplicationKubernetesCreatePlacement {
  readonly namespace?: string;
  readonly name?: string;
  readonly generateName?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface ApplicationKubernetesCreatePolicy<
  TSpec extends object,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> {
  readonly authorize: (request: ApplicationKubernetesCreateRequest<TSpec, TPrincipal>) => boolean | Promise<boolean>;
  readonly place: (request: {
    readonly context: Readonly<Record<string, JsonValue>>;
    readonly input: TSpec;
  }) => ApplicationKubernetesCreatePlacement;
}

export interface ApplicationKubernetesLifecycleRegistrar<TSpec extends object, TStatus extends object> {
  create(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  update(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  delete(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
}

export interface FunctionNativeApplicationKubernetesLifecycleRegistrar<TSpec extends object, TStatus extends object>
  extends ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus> {
  create(
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  create(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  update(
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  update(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  delete(
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
  delete(
    name: string,
    options: ApplicationResourceControllerOptions,
    handler: ApplicationResourceEventHandler<TSpec, TStatus>,
  ): ApplicationResourceControllerBinding;
}

export type PromotedKubernetesResource<
  TSpec extends object,
  TStatus extends object = Record<string, never>,
> = ResourceDefinition<TSpec, TStatus> & {
  readonly $model: KubernetesApplicationModelFacet<TSpec, TStatus>;
  readonly [applicationModelFacet]: KubernetesApplicationModelFacet<TSpec, TStatus>;
  readonly relations: KubernetesApplicationModelFacet<TSpec, TStatus>['relations'];
  ref(): ApplicationModelReferenceSchema<string>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  readonly create: ApplicationMutationOperation<
    TSpec | ResourceInstanceInput<TSpec> | ResourceObject<TSpec, TStatus>,
    ResourceObject<TSpec, TStatus>
  >;
  readonly on: ResourceDefinition<TSpec, TStatus>['on'] &
    FunctionNativeApplicationKubernetesLifecycleRegistrar<TSpec, TStatus>;
  query<
    TInputSchema extends Type,
    TOutputSchema extends Type,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  >(
    contract: ApplicationKubernetesModelViewSchemaContract<
      TInputSchema,
      ResourceObject<TSpec, TStatus>,
      TOutputSchema,
      TPrincipal
    >,
    implementation: ApplicationKubernetesModelViewImplementation<
      TInputSchema['infer'],
      ResourceObject<TSpec, TStatus>,
      TOutputSchema['infer']
    >,
  ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
  query<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(
    contract: ApplicationKubernetesModelViewContract<
      TInput,
      ResourceObject<TSpec, TStatus>,
      TOutput,
      TPrincipal
    >,
    implementation: ApplicationKubernetesModelViewImplementation<
      TInput,
      ResourceObject<TSpec, TStatus>,
      TOutput
    >,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(
    options: ApplicationKubernetesModelViewOptions<TInput, ResourceObject<TSpec, TStatus>, TOutput, TPrincipal>,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    TInputSchema extends Type,
    TOutputSchema extends Type,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  >(
    contract: ApplicationKubernetesModelViewSchemaContract<
      TInputSchema,
      ResourceObject<TSpec, TStatus>,
      TOutputSchema,
      TPrincipal
    >,
    implementation: ApplicationKubernetesModelViewImplementation<
      TInputSchema['infer'],
      ResourceObject<TSpec, TStatus>,
      TOutputSchema['infer']
    >,
  ): ApplicationQueryOperation<TInputSchema['infer'], TOutputSchema['infer']>;
  view<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(
    contract: ApplicationKubernetesModelViewContract<
      TInput,
      ResourceObject<TSpec, TStatus>,
      TOutput,
      TPrincipal
    >,
    implementation: ApplicationKubernetesModelViewImplementation<
      TInput,
      ResourceObject<TSpec, TStatus>,
      TOutput
    >,
  ): ApplicationQueryOperation<TInput, TOutput>;
  view<
    const TName extends string,
    TInput,
    TOutput,
    TSelf extends PromotedKubernetesResource<TSpec, TStatus> = PromotedKubernetesResource<TSpec, TStatus>,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  >(
    this: TSelf,
    name: TName,
    options: ApplicationKubernetesModelViewOptions<TInput, ResourceObject<TSpec, TStatus>, TOutput, TPrincipal>,
  ): TSelf & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
};

export type ApplicationModelEventKind = 'create' | 'update' | 'delete';

/**
 * Derives the lifecycle value observed by a model without making callers
 * unpack its underlying Drizzle or Kubernetes generic parameters.
 */
export type ApplicationModelEvent<
  TModel,
  TKind extends ApplicationModelEventKind,
> = TModel extends PromotedKubernetesResource<infer TSpec, infer TStatus>
  ? Parameters<ApplicationResourceEventHandler<TSpec, TStatus>>[0]
  : TModel extends PromotedDrizzleTable<infer TTable, infer TIdentity>
    ? TKind extends 'create'
      ? ApplicationModelCreateEvent<InferSelectModel<TTable>, TIdentity>
      : TKind extends 'update'
        ? ApplicationModelUpdateEvent<InferSelectModel<TTable>, TIdentity>
        : ApplicationModelDeleteEvent<InferSelectModel<TTable>, TIdentity>
    : never;

/** Concise public spelling for reusable model lifecycle handlers. */
export type ModelEvent<
  TModel,
  TKind extends ApplicationModelEventKind,
> = ApplicationModelEvent<TModel, TKind>;

/**
 * Promotes a native Drizzle table without wrapping or proxying it.
 *
 * The returned value is the original table by identity. Convenience members are
 * non-enumerable and installed only when the table does not already own that
 * name. The private symbol facet always exposes the complete API, so valid
 * Drizzle column names such as `create`, `on`, or `$model` remain usable.
 */
export function promoteAnalyticalDrizzleTable<TTable extends AnyPgTable>(
  table: TTable,
  options: PromoteAnalyticalDrizzleTableOptions<TTable> = {},
): PromotedAnalyticalDrizzleTable<TTable> {
  if (!isTable(table)) {
    throw new Error('Applik8s analytical model promotion requires a Drizzle table.');
  }
  const existing = Reflect.get(table, applicationModelFacet) as
    | CommonApplicationModelFacet<unknown, unknown, unknown, unknown>
    | undefined;
  if (existing) {
    if (existing.provider !== 'analytical-database') {
      throw new Error(
        `Drizzle table ${getTableName(table)} is already promoted as ${existing.provider} and cannot change authority kind.`,
      );
    }
    if (
      options.name !== undefined &&
      existing.name !== publicApplicationModelName(options.name, `Drizzle table ${getTableName(table)}`)
    ) {
      throw new Error(`Drizzle table ${getTableName(table)} is already promoted as ${existing.name}.`);
    }
    return table as PromotedAnalyticalDrizzleTable<TTable>;
  }

  const directMemberNames = ['$model', 'schema', 'relations', 'ref', 'query', 'view'] as const;
  const directMemberCollisions = Object.freeze(directMemberNames.filter((member) => member in table));
  const tableConfig = getTableConfig(table);
  const identityFields = resolveIdentityFields(table, options.identity);
  if (identityFields.length !== 1) {
    throw new Error(
      `Drizzle table ${getTableName(table)} has composite identity [${identityFields.join(', ')}]. Analytical model promotion requires one canonical identity field.`,
    );
  }
  const selectSchema = createSelectSchema(table) as Type<InferSelectModel<TTable>>;
  const name = publicApplicationModelName(options.name ?? getTableName(table), `Drizzle table ${getTableName(table)}`);
  const identity: ApplicationModelIdentityContract = {
    fields: identityFields,
    encoding: 'scalar',
  };
  const relationships = Object.freeze(normalizeDrizzleModelRelationships(table, options.schema, name));
  const runtimeRoles = normalizedApplicationModelRuntimeRoles(name, options.runtimeRoles);
  const view = ((
    nameOrOptions: string | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
    maybeOptions?:
      | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>
      | ApplicationModelViewImplementation<unknown, unknown, ApplicationQueryPrincipal>,
  ) =>
    typeof nameOrOptions === 'string'
      ? installApplicationModelView(
          table,
          nameOrOptions,
          maybeOptions as ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
        )
      : installFunctionNativeApplicationModelView(
          table,
          nameOrOptions,
          typeof maybeOptions === 'function' ? maybeOptions : undefined,
        )) as DrizzleAnalyticalApplicationModelFacet<TTable>['api']['view'];
  const query = ((
    contract: ApplicationModelQueryContract<unknown, unknown, ApplicationQueryPrincipal>,
    implementation: ApplicationModelQueryImplementation<unknown, unknown, ApplicationQueryPrincipal>,
  ) => installFunctionNativeApplicationModelView(
    table,
    contract,
    implementation,
    'query',
  )) as DrizzleAnalyticalApplicationModelFacet<TTable>['api']['query'];
  const facet: DrizzleAnalyticalApplicationModelFacet<TTable> = Object.freeze({
    apiVersion: 'applik8s.model/v1alpha1',
    kind: 'applicationModelFacet',
    name,
    provider: 'analytical-database',
    native: 'drizzle-table',
    table: {
      name: tableConfig.name,
      ...(tableConfig.schema ? { schema: tableConfig.schema } : {}),
    },
    directMemberCollisions,
    identity,
    schema: Object.freeze({ select: selectSchema }),
    relationships,
    ...(runtimeRoles.length > 0 ? { runtimeRoles } : {}),
    relations: Object.freeze(
      Object.fromEntries(relationships.map((relationship) => [relationship.name, relationship])),
    ),
    capabilities: Object.freeze({
      reads: 'declaredQueries',
      aggregates: 'providerRefinement',
      ingestion: 'projectionOwned',
      checkpoint: 'idempotent',
      rebuild: 'fullReplay',
    }),
    api: Object.freeze({ query, view }),
    ref() {
      const identitySchema = arktypePropertySchema(selectSchema, identityFields[0] as string);
      return decorateModelReference(identitySchema, {
        target: name,
        identity,
        integrity: 'soft',
      }) as ApplicationModelReferenceSchema<ConventionalTableIdentity<TTable>>;
    },
  });

  Object.defineProperty(table, applicationModelFacet, {
    value: facet,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const directMembers: Readonly<Record<string, unknown>> = {
    $model: facet,
    schema: facet.schema,
    relations: facet.relations,
    ref: () => facet.ref(),
    query,
    view,
  };
  for (const [member, value] of Object.entries(directMembers)) {
    if (directMemberCollisions.some((collision) => collision === member)) {
      continue;
    }
    Object.defineProperty(table, member, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return table as PromotedAnalyticalDrizzleTable<TTable>;
}

// typecast-boundary: Drizzle symbol metadata and drizzle-arktype output are validated before installing the promoted model facet.
export function promoteDrizzleTable<TTable extends AnyPgTable>(
  table: TTable,
  options: PromoteDrizzleTableOptions<TTable> = {},
): PromotedDrizzleTable<TTable> {
  if (!isTable(table)) {
    throw new Error(
      'Applik8s native model promotion requires a Drizzle table. Views, relations, queries, and wrapper objects are not promotable models.',
    );
  }
  const existing = Reflect.get(table, applicationModelFacet) as DrizzleApplicationModelFacet<TTable> | undefined;
  if (existing) {
    assertCompatiblePromotion(existing, table, options);
    return table as PromotedDrizzleTable<TTable>;
  }
  const directMemberNames = [
    '$model',
    'schema',
    'relations',
    'ref',
    'get',
    'find',
    'require',
    'edit',
    'create',
    'update',
    'delete',
    'on',
    'query',
    'view',
  ] as const;
  const directMemberCollisions = Object.freeze(directMemberNames.filter((member) => member in table));

  const tableConfig = getTableConfig(table);
  const identityFields = resolveIdentityFields(table, options.identity);
  if (identityFields.length !== 1) {
    throw new Error(
      `Drizzle table ${getTableName(table)} has composite identity [${identityFields.join(', ')}]. v0.6 requires an explicit canonical tuple codec before composite identities can be promoted.`,
    );
  }
  const revisionField = resolveRevisionField(table, options.revision);
  const selectSchema = createSelectSchema(table) as Type<InferSelectModel<TTable>>;
  const insertSchema = createInsertSchema(table) as Type<InferInsertModel<TTable>>;
  const updateSchema = createUpdateSchema(table) as Type<Partial<InferInsertModel<TTable>>>;
  const name = publicApplicationModelName(options.name ?? getTableName(table), `Drizzle table ${getTableName(table)}`);
  const identity: ApplicationModelIdentityContract = { fields: identityFields, encoding: 'scalar' };
  const relationships = Object.freeze(normalizeDrizzleModelRelationships(table, options.schema, name));
  const runtimeRoles = normalizedApplicationModelRuntimeRoles(name, options.runtimeRoles);
  let collisionSafeApi: DrizzleApplicationModelApi<TTable> | undefined;
  const facet: DrizzleApplicationModelFacet<TTable> = Object.freeze({
    apiVersion: 'applik8s.model/v1alpha1',
    kind: 'applicationModelFacet',
    name,
    provider: 'postgres',
    native: 'drizzle-table',
    database: options.database ?? 'default',
    table: {
      name: tableConfig.name,
      ...(tableConfig.schema ? { schema: tableConfig.schema } : {}),
    },
    directMemberCollisions,
    get api() {
      if (!collisionSafeApi) {
        throw new Error(`Drizzle model ${name} is not fully promoted yet.`);
      }
      return collisionSafeApi;
    },
    identity,
    ...(revisionField ? { revision: { field: revisionField, authority: 'postgres-row' as const } } : {}),
    schema: Object.freeze({ select: selectSchema, insert: insertSchema, update: updateSchema }),
    relationships,
    ...(runtimeRoles.length > 0 ? { runtimeRoles } : {}),
    relations: Object.freeze(
      Object.fromEntries(relationships.map((relationship) => [relationship.name, relationship])),
    ),
    get on() {
      if (!collisionSafeApi) {
        throw new Error(`Drizzle model ${name} is not fully promoted yet.`);
      }
      return collisionSafeApi.on;
    },
    ref() {
      const identitySchema = arktypePropertySchema(selectSchema, identityFields[0] as string);
      const reference: ApplicationModelReferenceContract = {
        target: name,
        identity,
        integrity: 'soft',
      };
      return decorateModelReference(identitySchema, reference) as ApplicationModelReferenceSchema<
        ConventionalTableIdentity<TTable>
      >;
    },
  });

  const identitySchema = arktypePropertySchema(selectSchema, identityFields[0] as string);
  const snapshotSchema = arkType({
    identity: identitySchema,
    value: selectSchema,
    'revision?': 'string',
  });
  const updateInputSchema = arkType({
    identity: identitySchema,
    patch: updateSchema,
  });
  const deleteInputSchema = arkType({ identity: identitySchema });
  const tombstoneSchema = arkType({ identity: identitySchema, deleted: 'true' });

  const createOperation = applicationModelMutationOperation<
    InferInsertModel<TTable>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    InferSelectModel<TTable>
  >(
    {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: `${name}.create`,
      model: name,
      name: 'create',
      operation: 'create',
      transport: 'command',
    },
    {
      input: insertSchema,
      output: snapshotSchema,
    },
  );
  const updateOperation = applicationModelMutationOperation<
    ApplicationModelUpdateInput<Partial<InferInsertModel<TTable>>, ConventionalTableIdentity<TTable>>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    InferSelectModel<TTable>
  >(
    {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: `${name}.update`,
      model: name,
      name: 'update',
      operation: 'update',
      transport: 'command',
    },
    {
      input: updateInputSchema,
      output: snapshotSchema,
    },
  );
  const deleteOperation = applicationModelMutationOperation<
    ApplicationModelDeleteInput<ConventionalTableIdentity<TTable>>,
    ApplicationModelDeleteEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>['tombstone'],
    InferSelectModel<TTable>
  >(
    {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: `${name}.delete`,
      model: name,
      name: 'delete',
      operation: 'delete',
      transport: 'command',
    },
    {
      input: deleteInputSchema,
      output: tombstoneSchema,
    },
  );

  const lifecycleRegistrars = {
    create(
      nameOrOptions:
        | string
        | ApplicationStreamProcessOptions
        | ApplicationModelCreateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      optionsOrHandler?:
        | ApplicationStreamProcessOptions
        | ApplicationModelCreateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      maybeHandler?: ApplicationModelCreateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const {
        name: lifecycleName,
        options: lifecycleOptions,
        handler: lifecycleHandler,
      } = normalizeLifecycleRegistration<
        ApplicationStreamProcessOptions,
        ApplicationModelCreateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >('create', nameOrOptions, optionsOrHandler, maybeHandler);
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar)
        throw new Error(
          `Native model ${name} must be registered through app.model(table) before declaring create-event handlers.`,
        );
      // typecast: the registrar is installed for this exact promoted table and its derived select/identity types.
      return registrar.create(
        lifecycleName,
        lifecycleOptions,
        lifecycleHandler as ApplicationModelCreateEventHandler<object, unknown>,
      ) as ApplicationStreamProcessorBinding<
        ApplicationModelCreateEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >;
    },
    update(
      nameOrOptions:
        | string
        | ApplicationStreamProcessOptions
        | ApplicationModelUpdateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      optionsOrHandler?:
        | ApplicationStreamProcessOptions
        | ApplicationModelUpdateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      maybeHandler?: ApplicationModelUpdateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const {
        name: lifecycleName,
        options: lifecycleOptions,
        handler: lifecycleHandler,
      } = normalizeLifecycleRegistration<
        ApplicationStreamProcessOptions,
        ApplicationModelUpdateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >('update', nameOrOptions, optionsOrHandler, maybeHandler);
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar)
        throw new Error(
          `Native model ${name} must be registered through app.model(table) before declaring update-event handlers.`,
        );
      return registrar.update(
        lifecycleName,
        lifecycleOptions,
        lifecycleHandler as ApplicationModelUpdateEventHandler<object, unknown>,
      ) as ApplicationStreamProcessorBinding<
        ApplicationModelUpdateEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >;
    },
    delete(
      nameOrOptions:
        | string
        | ApplicationStreamProcessOptions
        | ApplicationModelDeleteEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      optionsOrHandler?:
        | ApplicationStreamProcessOptions
        | ApplicationModelDeleteEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
      maybeHandler?: ApplicationModelDeleteEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const {
        name: lifecycleName,
        options: lifecycleOptions,
        handler: lifecycleHandler,
      } = normalizeLifecycleRegistration<
        ApplicationStreamProcessOptions,
        ApplicationModelDeleteEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >('delete', nameOrOptions, optionsOrHandler, maybeHandler);
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar)
        throw new Error(
          `Native model ${name} must be registered through app.model(table) before declaring delete-event handlers.`,
        );
      return registrar.delete(
        lifecycleName,
        lifecycleOptions,
        lifecycleHandler as ApplicationModelDeleteEventHandler<object, unknown>,
      ) as ApplicationStreamProcessorBinding<
        ApplicationModelDeleteEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
      >;
    },
  };

  const viewModel = (
    nameOrOptions: string | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
    maybeOptions?:
      | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>
      | ApplicationModelViewImplementation<unknown, unknown, ApplicationQueryPrincipal>,
  ) =>
    typeof nameOrOptions === 'string'
      ? installApplicationModelView(
          table,
          nameOrOptions,
          maybeOptions as ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
        )
      : installFunctionNativeApplicationModelView(
          table,
          nameOrOptions,
          typeof maybeOptions === 'function' ? maybeOptions : undefined,
        );
  const queryModel = (
    contract: ApplicationModelQueryContract<unknown, unknown, ApplicationQueryPrincipal>,
    implementation: ApplicationModelQueryImplementation<unknown, unknown, ApplicationQueryPrincipal>,
  ) => installFunctionNativeApplicationModelView(
    table,
    contract,
    implementation,
    'query',
  );
  const getModel = async (
    identityValue: ConventionalTableIdentity<TTable>,
  ): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>> | undefined> => {
    const value = await getApplicationNativeModelObject(name, identityValue);
    return value
      ? {
          identity: value.id as ConventionalTableIdentity<TTable>,
          value: value.spec as InferSelectModel<TTable>,
          ...(value.revision ? { revision: value.revision } : {}),
        }
      : undefined;
  };
  const findModel = async (findOptions: {
    readonly where?: Partial<InferSelectModel<TTable>>;
    readonly limit: number;
  }): Promise<readonly ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>[]> => {
    const page = await findApplicationNativeModelObjects(name, {
      ...(findOptions.where ? { where: findOptions.where } : {}),
      limit: findOptions.limit,
    });
    return page.items.map((value) => ({
      identity: value.id as ConventionalTableIdentity<TTable>,
      value: value.spec as InferSelectModel<TTable>,
      ...(value.revision ? { revision: value.revision } : {}),
    }));
  };
  const requireModel = async (
    identityValue: ConventionalTableIdentity<TTable>,
  ): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>> => {
    const value = await requireApplicationNativeModelObject<
      InferSelectModel<TTable>,
      ConventionalTableIdentity<TTable>
    >(name, identityValue);
    return {
      identity: value.id as ConventionalTableIdentity<TTable>,
      value: value.spec,
      ...(value.revision ? { revision: value.revision } : {}),
    };
  };
  const editModel = <TResult>(
    identityValue: ConventionalTableIdentity<TTable>,
    handler: (
      target: ApplicationModelEditTarget<
          InferSelectModel<TTable>,
          ConventionalTableIdentity<TTable>
        >,
    ) => TResult | Promise<TResult>,
  ): Promise<TResult> =>
    editApplicationNativeModelObject(name, identityValue, handler);
  bindApplicationNativeModelMethod(
    getModel as (...args: never[]) => unknown,
    {
      kind: 'applicationNativeModelMethod',
      model: table,
      modelName: name,
      method: 'get',
      access: 'read',
    },
  );
  bindApplicationNativeModelMethod(
    findModel as (...args: never[]) => unknown,
    {
      kind: 'applicationNativeModelMethod',
      model: table,
      modelName: name,
      method: 'find',
      access: 'read',
    },
  );
  bindApplicationNativeModelMethod(
    requireModel as (...args: never[]) => unknown,
    {
      kind: 'applicationNativeModelMethod',
      model: table,
      modelName: name,
      method: 'require',
      access: 'read',
    },
  );
  bindApplicationNativeModelMethod(
    editModel as (...args: never[]) => unknown,
    {
      kind: 'applicationNativeModelMethod',
      model: table,
      modelName: name,
      method: 'edit',
      access: 'write',
    },
  );
  // typecast-boundary: every member is derived from this exact table; the
  // private object-returning installers regain their generic public surface at
  // this single collision-safe API boundary.
  collisionSafeApi = Object.freeze({
    get: getModel,
    find: findModel,
    require: requireModel,
    edit: editModel,
    create: createOperation,
    update: updateOperation,
    delete: deleteOperation,
    on: lifecycleRegistrars,
    query: queryModel,
    view: viewModel,
  }) as DrizzleApplicationModelApi<TTable>;

  Object.defineProperty(table, applicationModelFacet, {
    value: facet,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const directMembers: Readonly<Record<string, unknown>> = {
    $model: facet,
    schema: facet.schema,
    relations: facet.relations,
    ref: () => facet.ref(),
    get: collisionSafeApi.get,
    find: collisionSafeApi.find,
    require: collisionSafeApi.require,
    edit: collisionSafeApi.edit,
    create: collisionSafeApi.create,
    update: collisionSafeApi.update,
    delete: collisionSafeApi.delete,
    on: collisionSafeApi.on,
    query: collisionSafeApi.query,
    view: collisionSafeApi.view,
  };
  for (const [member, value] of Object.entries(directMembers)) {
    if (directMemberCollisions.some((collision) => collision === member)) continue;
    Object.defineProperty(table, member, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return table as PromotedDrizzleTable<TTable>;
}

function applicationModelMutationOperation<TInput extends object, TOutput, TValue extends object>(
  contract: Parameters<typeof createApplicationMutationOperation>[0],
  schemas?: {
    readonly input: unknown;
    readonly output: unknown;
  },
): ApplicationModelMutationOperation<TInput, TOutput, TValue> {
  const operation = createApplicationMutationOperation<TInput, TOutput, TValue>(
    contract,
    undefined,
    schemas,
  ) as unknown as ApplicationModelMutationOperation<TInput, TOutput, TValue>;
  Object.defineProperty(operation, 'beforeCommit', {
    value: (
      options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
      handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
    ) => {
      const registrar = nativeApplicationModelBeforeCommitRegistrar(operation);
      if (!registrar) {
        throw new Error(
          `Application model ${contract.model}.${contract.name}.beforeCommit(...) requires a model registered through app.model(...).`,
        );
      }
      registrar(options, handler);
      return operation;
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return operation;
}

export function bindNativeApplicationModelCommands<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  registrar: NativeApplicationModelCommandRegistrar<TTable>,
): void {
  // typecast: the compiler-owned generic registrar is erased only in this
  // private model-identity registry; it is never exposed on the model object.
  nativeModelCommandRegistrars.set(model, registrar as unknown as NativeModelCommandRegistrar);
}

export function nativeApplicationModelCommandRegistrar<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
): NativeApplicationModelCommandRegistrar<TTable> | undefined {
  // typecast: table identity guarantees the erased registrar was installed for this promoted row schema.
  return nativeModelCommandRegistrars.get(model) as
    | NativeApplicationModelCommandRegistrar<TTable>
    | undefined;
}

export function bindNativeApplicationModelLifecycle<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  registrar: ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
): void {
  nativeModelLifecycleRegistrars.set(model, registrar as NativeModelLifecycleRegistrar);
}

export function nativeApplicationModelLifecycleRegistrar<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
): ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>> | undefined {
  return nativeModelLifecycleRegistrars.get(model) as
    | ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>
    | undefined;
}

/** Internal bridge used when a promoted Drizzle model participates in another model action's transaction. */
export function bindNativeApplicationModelBinding(
  model: object,
  binding: ApplicationModelBinding<object, object>,
): void {
  nativeApplicationModelBindings.set(model, binding);
}

function normalizeLifecycleRegistration<TOptions extends object, THandler extends (...args: never[]) => unknown>(
  lifecycle: 'create' | 'update' | 'delete',
  nameOrOptions: string | TOptions | THandler,
  optionsOrHandler?: TOptions | THandler,
  maybeHandler?: THandler,
): { readonly name: string; readonly options: TOptions; readonly handler: THandler } {
  if (typeof nameOrOptions === 'function') {
    return normalizedInferredLifecycleRegistration(
      lifecycle,
      {} as TOptions,
      nameOrOptions,
    );
  }
  if (typeof nameOrOptions === 'string') {
    if (
      typeof maybeHandler !== 'function'
      || !optionsOrHandler
      || typeof optionsOrHandler !== 'object'
    ) {
      throw new Error(`Model.on.${lifecycle}(name, options, handler) requires deployment options and a handler.`);
    }
    return { name: nameOrOptions, options: optionsOrHandler, handler: maybeHandler };
  }
  if (typeof optionsOrHandler !== 'function') {
    throw new Error(`Model.on.${lifecycle}(options, handler) requires a named handler function.`);
  }
  return normalizedInferredLifecycleRegistration(
    lifecycle,
    nameOrOptions,
    optionsOrHandler,
  );
}

function normalizedInferredLifecycleRegistration<
  TOptions extends object,
  THandler extends (...args: never[]) => unknown,
>(
  lifecycle: 'create' | 'update' | 'delete',
  options: TOptions,
  handler: THandler,
): { readonly name: string; readonly options: TOptions; readonly handler: THandler } {
  const authoredName = handler.name.trim();
  if (!authoredName) {
    throw new Error(
      `Model.on.${lifecycle}(options, handler) cannot infer stable identity from an anonymous handler. ` +
        `Pass a named function or use the compatibility (name, options, handler) form.`,
    );
  }
  const normalizedName = authoredName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalizedName) {
    throw new Error(
      `Model.on.${lifecycle}(options, handler) could not derive a valid identity from handler ${JSON.stringify(authoredName)}.`,
    );
  }
  return {
    name: `${normalizedName}-${lifecycle}`,
    options,
    handler,
  };
}

export function nativeApplicationModelBindingFor(model: object): ApplicationModelBinding<object, object> | undefined {
  return nativeApplicationModelBindings.get(model);
}

export function bindApplicationModelViews(model: object, registrar: ApplicationModelViewRegistrar): void {
  applicationModelViewRegistrars.set(model, registrar);
}

export function applicationModelViewRegistrar(model: object): ApplicationModelViewRegistrar | undefined {
  return applicationModelViewRegistrars.get(model);
}

export interface PromoteKubernetesResourceOptions<TSpec extends object = object> {
  readonly name?: string;
  /**
   * Declares a provider-enforced namespace boundary. The model context reads the
   * Namespace and compares this label with the admitted trusted-context value.
   */
  readonly access?: { readonly context: string; readonly namespaceLabel: string };
  readonly create?: ApplicationKubernetesCreatePolicy<TSpec>;
}

// typecast-boundary: the resource definition owns the spec/status generics installed in its immutable common model facet.
export function promoteKubernetesResource<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  nameOrOptions: string | PromoteKubernetesResourceOptions<TSpec> = resource.kind,
): PromotedKubernetesResource<TSpec, TStatus> {
  const options = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const name = publicApplicationModelName(
    options.name ?? resource.kind,
    `Kubernetes resource ${resource.apiVersion}/${resource.kind}`,
  );
  const existing = Reflect.get(resource, applicationModelFacet) as
    | KubernetesApplicationModelFacet<TSpec, TStatus>
    | undefined;
  if (existing) {
    if (existing.name !== name || JSON.stringify(existing.access) !== JSON.stringify(options.access)) {
      throw new Error(
        `Kubernetes resource ${resource.apiVersion}/${resource.kind} is already promoted as model ${existing.name}.`,
      );
    }
    return resource as PromotedKubernetesResource<TSpec, TStatus>;
  }
  if ('$model' in resource) {
    throw new Error(`Kubernetes resource ${resource.apiVersion}/${resource.kind} already exposes a $model property.`);
  }
  for (const directFacet of ['relations', 'ref'] as const) {
    if (directFacet in resource) {
      throw new Error(
        `Kubernetes resource ${resource.apiVersion}/${resource.kind} cannot expose direct model ${directFacet} because it already has that property. Use getApplicationModelFacet(...) as the collision-safe advanced path.`,
      );
    }
  }
  const identity: ApplicationModelIdentityContract = { fields: ['metadata.name'], encoding: 'scalar' };
  const relationships = Object.freeze(modelRelationshipsFromRuntimeSchema(resource.spec, name));
  const facet: KubernetesApplicationModelFacet<TSpec, TStatus> = Object.freeze({
    apiVersion: 'applik8s.model/v1alpha1',
    kind: 'applicationModelFacet',
    name,
    provider: 'kubernetes',
    native: 'kubernetes-resource',
    identity,
    revision: { field: 'metadata.resourceVersion' as const, authority: 'kubernetes-resource-version' as const },
    schema: Object.freeze({ select: resource.spec }),
    relationships,
    relations: Object.freeze(
      Object.fromEntries(relationships.map((relationship) => [relationship.name, relationship])),
    ),
    resource: { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope },
    ...(options.access ? { access: Object.freeze({ ...options.access }) } : {}),
    ...(options.create ? { create: options.create } : {}),
    ref() {
      return decorateModelReference(arkType('string'), { target: name, identity, integrity: 'reconcile-checked' });
    },
  });
  Object.defineProperties(resource, {
    [applicationModelFacet]: { value: facet, enumerable: false, configurable: false, writable: false },
    $model: { value: facet, enumerable: false, configurable: false, writable: false },
    relations: { value: facet.relations, enumerable: false, configurable: false, writable: false },
    ref: { value: () => facet.ref(), enumerable: false, configurable: false, writable: false },
    query: {
      value: (
        contract: ApplicationKubernetesModelViewContract<unknown, object, unknown, ApplicationQueryPrincipal>,
        implementation: ApplicationKubernetesModelViewImplementation<unknown, object, unknown>,
      ) => installFunctionNativeApplicationModelView(
        resource,
        contract,
        implementation,
        'query',
      ),
      enumerable: false,
      configurable: false,
      writable: false,
    },
    view: {
      value: (
        nameOrOptions: string | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
        maybeOptions?:
          | ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>
          | ApplicationModelViewImplementation<unknown, unknown, ApplicationQueryPrincipal>,
      ) =>
        typeof nameOrOptions === 'string'
          ? installApplicationModelView(
              resource,
              nameOrOptions,
              maybeOptions as ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>,
            )
          : installFunctionNativeApplicationModelView(
              resource,
              nameOrOptions,
              typeof maybeOptions === 'function' ? maybeOptions : undefined,
            ),
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
  installPromotedKubernetesLifecycleMethods(resource, name);
  decorateApplicationMutationOperation(resource.create, {
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: `${name}.create`,
    model: name,
    name: 'create',
    operation: 'create',
    transport: 'command',
  });
  return resource as PromotedKubernetesResource<TSpec, TStatus>;
}

function installPromotedKubernetesLifecycleMethods<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  modelName: string,
): void {
  const eventSources = resource.on as ResourceDefinition<TSpec, TStatus>['on'] & Record<string, unknown>;
  for (const lifecycle of ['create', 'update', 'delete'] as const) {
    const sdkRegister = Reflect.get(eventSources, lifecycle);
    if (typeof sdkRegister !== 'function')
      throw new Error(`Kubernetes model ${modelName} has no SDK ${lifecycle} lifecycle registrar.`);
    Object.defineProperty(eventSources, lifecycle, {
      value: (
        handlerNameOrOptions: ApplicationResourceEventHandler<TSpec, TStatus> | ApplicationResourceControllerOptions | string,
        optionsOrHandler?: ApplicationResourceControllerOptions | ApplicationResourceEventHandler<TSpec, TStatus>,
        maybeHandler?: ApplicationResourceEventHandler<TSpec, TStatus>,
      ) => {
        if (typeof handlerNameOrOptions === 'object') {
          const normalized = normalizeLifecycleRegistration(
            lifecycle,
            handlerNameOrOptions,
            optionsOrHandler as ApplicationResourceEventHandler<TSpec, TStatus>,
          );
          const registrar = nativeKubernetesLifecycleRegistrars.get(resource);
          if (!registrar)
            throw new Error(
              `Kubernetes model ${modelName} must be registered through app.crd(...) before declaring direct lifecycle handlers.`,
            );
          return registrar[lifecycle](
            normalized.name,
            normalized.options,
            normalized.handler as unknown as ApplicationResourceEventHandler<object, object>,
          );
        }
        const handlerOrName = handlerNameOrOptions;
        if (typeof handlerOrName !== 'string') return sdkRegister(handlerOrName);
        if (typeof optionsOrHandler !== 'object' || typeof maybeHandler !== 'function') {
          throw new Error(
            `Kubernetes model ${modelName}.on.${lifecycle}(name, options, handler) requires a lifecycle name, deployment options, and handler.`,
          );
        }
        const registrar = nativeKubernetesLifecycleRegistrars.get(resource);
        if (!registrar)
          throw new Error(
            `Kubernetes model ${modelName} must be registered through app.crd(...) before declaring direct lifecycle handlers.`,
          );
        return registrar[lifecycle](
          handlerOrName,
          optionsOrHandler,
          maybeHandler as unknown as ApplicationResourceEventHandler<object, object>,
        );
      },
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
}

function installApplicationModelView<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined,
>(
  model: object,
  name: string,
  options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  operationKind: 'query' | 'view' = 'view',
): object {
  if (name in model) throw new Error(`Application model view ${name} cannot replace an existing model member.`);
  const registrar = applicationModelViewRegistrars.get(model);
  if (!registrar)
    throw new Error(
      'Application model views must be declared on a model registered through app.model(...) or app.crd(...).',
    );
  const operation = registrar(name, options, operationKind);
  Object.defineProperty(model, name, { value: operation, enumerable: false, configurable: false, writable: false });
  return model;
}

function installFunctionNativeApplicationModelView<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined,
>(
  model: object,
  contract:
    | ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>
    | ApplicationModelViewContract<TInput, TOutput, TPrincipal, TSource>
    | ApplicationKubernetesModelViewContract<TInput, object, TOutput, TPrincipal>,
  implementation?:
    | ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>
    | ApplicationKubernetesModelViewImplementation<TInput, object, TOutput>,
  operationKind: 'query' | 'view' = 'view',
): ApplicationQueryOperation<TInput, TOutput> {
  const kubernetesContract = 'select' in contract
    ? contract as ApplicationKubernetesModelViewContract<TInput, object, TOutput, TPrincipal>
    : undefined;
  const options = kubernetesContract && implementation
    ? functionNativeKubernetesViewOptions(
        kubernetesContract,
        implementation as ApplicationKubernetesModelViewImplementation<TInput, object, TOutput>,
      )
    : implementation
    ? ({
        ...contract,
        // The graph records the calling convention explicitly. Keeping the
        // authored function itself here preserves its real source provenance
        // and module closure for generated runtimes.
        run: implementation as ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>,
        __handlerInvocation: 'input-context',
      } as ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>)
    : (contract as ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>);
  const callback = implementation ?? options.run ?? options.kubernetes?.project;
  const instrumentedSource = typeof callback === 'function'
    ? instrumentedApplicationCallbackSource(callback as (...args: never[]) => unknown)
    : undefined;
  const name = instrumentedSource?.name ?? callback?.name;
  if (
    typeof callback !== 'function' ||
    !name?.trim() ||
    name === 'run' ||
    name === 'project'
  ) {
    throw new Error(
      `Model.${operationKind}(contract, implementation) requires a named implementation so the query has stable identity. ` +
        (operationKind === 'view'
          ? 'The compatibility one-object form requires a named run or kubernetes.project function. Use a named function or the compatibility view(name, options) form.'
          : 'Use a named function so the one-shot query has deterministic identity.'),
    );
  }
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `Model.${operationKind}(...) implementation ${JSON.stringify(name)} must use a stable lowerCamelCase function name.`,
    );
  }
  installApplicationModelView(
    model,
    name,
    options as ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
    operationKind,
  );
  return Reflect.get(model, name) as ApplicationQueryOperation<TInput, TOutput>;
}

function functionNativeKubernetesViewOptions<
  TInput,
  TObject,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
>(
  contract: ApplicationKubernetesModelViewContract<TInput, TObject, TOutput, TPrincipal>,
  implementation: ApplicationKubernetesModelViewImplementation<TInput, TObject, TOutput>,
): ApplicationModelViewOptions<TInput, TOutput, TPrincipal> {
  const { select, ...common } = contract;
  const kubernetes = {
    ...(select.namespace !== undefined ? {
      namespace: select.namespace as ApplicationKubernetesModelViewOptions<TInput, TObject, TOutput, TPrincipal>['kubernetes']['namespace'],
    } : {}),
    ...(select.labelSelector ? {
      labelSelector: select.labelSelector,
    } : {}),
    ...(select.fieldSelector ? {
      fieldSelector: select.fieldSelector,
    } : {}),
    ...(select.where ? {
      filter: select.where,
    } : {}),
    ...(select.orderBy ? {
      compare: select.orderBy,
    } : {}),
    project: implementation,
    ...(select.limit ? {
      limit: select.limit,
    } : {}),
    ...(select.bounds?.pageSize !== undefined ? { pageSize: select.bounds.pageSize } : {}),
    ...(select.bounds?.maxPages !== undefined ? { maxPages: select.bounds.maxPages } : {}),
    ...(select.bounds?.maxItems !== undefined ? { maxItems: select.bounds.maxItems } : {}),
  } as unknown as NonNullable<ApplicationModelViewOptions<TInput, TOutput, TPrincipal>['kubernetes']>;
  return {
    ...common,
    kubernetes,
    __kubernetesInvocation: 'model-native',
  };
}

// typecast-boundary: the private symbol is installed only by the validated promotion functions above.
export function getApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate>(
  value: unknown,
): CommonApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate> | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  return Reflect.get(value, applicationModelFacet) as
    | CommonApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate>
    | undefined;
}

export function isPromotedApplicationModel(value: unknown): boolean {
  return getApplicationModelFacet(value) !== undefined;
}

// typecast-boundary: reference metadata is installed under a private symbol only by ref() after contract construction.
export function modelReferenceContract(value: unknown): ApplicationModelReferenceContract | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  return Reflect.get(value, applicationModelReference) as ApplicationModelReferenceContract | undefined;
}

function resolveIdentityFields<TTable extends AnyPgTable>(
  table: TTable,
  explicit: PromoteDrizzleTableOptions<TTable>['identity'],
): string[] {
  const columns = getTableColumns(table);
  if (explicit) {
    if (explicit.length === 0) {
      throw new Error(`Drizzle table ${getTableName(table)} declares an empty application-model identity.`);
    }
    for (const field of explicit) {
      if (!(field in columns)) {
        throw new Error(`Drizzle table ${getTableName(table)} declares unknown identity field ${field}.`);
      }
    }
    return uniqueStrings(explicit);
  }
  const config = getTableConfig(table);
  const primaryColumns = [
    ...config.columns.filter((column) => column.primary),
    ...config.primaryKeys.flatMap((key) => key.columns),
  ];
  const inferred = primaryColumns
    .map((column) => Object.entries(columns).find(([, candidate]) => candidate === column)?.[0])
    .filter((field): field is string => field !== undefined);
  if (inferred.length === 0) {
    throw new Error(
      `Drizzle table ${getTableName(table)} has no inferable primary-key identity. Declare a primary key or pass an explicit identity field.`,
    );
  }
  return uniqueStrings(inferred);
}

function resolveRevisionField<TTable extends AnyPgTable>(
  table: TTable,
  revision: PromoteDrizzleTableOptions<TTable>['revision'],
): string | undefined {
  if (revision === false) {
    return undefined;
  }
  const columns = getTableColumns(table);
  const field = revision ?? ('revision' in columns ? 'revision' : undefined);
  if (!field) {
    return undefined;
  }
  const column = columns[field];
  if (!column) {
    throw new Error(`Drizzle table ${getTableName(table)} declares unknown revision field ${field}.`);
  }
  if (column.dataType !== 'string' || !column.notNull) {
    throw new Error(`Drizzle table ${getTableName(table)} revision field ${field} must be a non-null string column.`);
  }
  return field;
}

function normalizeDrizzleModelRelationships(
  table: AnyPgTable,
  schema: Readonly<Record<string, unknown>> | undefined,
  source: string,
): ApplicationModelRelationshipContract[] {
  if (!schema) {
    return [];
  }
  const extracted = extractTablesRelationalConfig({ ...schema }, createTableRelationsHelpers);
  const tableConfig = getTableConfig(table);
  const tableEntry = Object.values(extracted.tables).find(
    (candidate) => candidate.dbName === getTableName(table) && candidate.schema === tableConfig.schema,
  );
  if (!tableEntry) {
    throw new Error(`Drizzle table ${getTableName(table)} is not present in the registered relational schema.`);
  }
  return Object.entries(tableEntry.relations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, relation]) =>
      drizzleRelationshipContract(
        source,
        name,
        relation,
        extracted.tables,
        extracted.tableNamesMap,
        () => logicalModelNameForTable(schema, relation.referencedTableName) ?? relation.referencedTableName,
      ),
    );
}

function drizzleRelationshipContract(
  source: string,
  name: string,
  relation: Relation,
  tables: ReturnType<typeof extractTablesRelationalConfig>['tables'],
  tableNamesMap: Readonly<Record<string, string>>,
  target: () => string,
): ApplicationModelRelationshipContract {
  const normalized = normalizeRelation(tables, tableNamesMap, relation);
  const sourceColumns = getTableColumns(relation.sourceTable);
  const targetColumns = getTableColumns(relation.referencedTable);
  const fields = normalized.fields.map((column) => columnPropertyName(sourceColumns, column));
  const references = normalized.references.map((column) => columnPropertyName(targetColumns, column));
  return {
    source,
    name,
    get target() {
      return target();
    },
    cardinality: relation instanceof Many ? 'many' : 'one',
    integrity: relation instanceof One && relation.config ? 'foreign-key' : 'relation-only',
    fields,
    references,
  };
}

function logicalModelNameForTable(schema: Readonly<Record<string, unknown>>, tableName: string): string | undefined {
  for (const candidate of Object.values(schema)) {
    if (!isTable(candidate) || getTableName(candidate) !== tableName) continue;
    const facet = getApplicationModelFacet(candidate);
    if (facet) return facet.name;
  }
  return undefined;
}

function columnPropertyName(columns: Readonly<Record<string, unknown>>, column: unknown): string {
  return Object.entries(columns).find(([, candidate]) => candidate === column)?.[0] ?? 'unknown';
}

function arktypePropertySchema<TValue>(schema: Type<TValue>, field: string): Type<unknown> {
  const get = Reflect.get(schema, 'get');
  if (typeof get !== 'function') {
    throw new Error(
      `Derived ArkType schema does not expose field ${field}; the installed drizzle-arktype adapter is incompatible.`,
    );
  }
  // typecast: ArkType get() returns a Type when invoked on a Type and the compatibility guard proves the method exists.
  return Reflect.apply(get, schema, [field]) as Type<unknown>;
}

// typecast-boundary: ArkType descriptions preserve the identity generic while attaching immutable reference metadata.
function decorateModelReference<TIdentity>(
  schema: Type<TIdentity>,
  reference: ApplicationModelReferenceContract,
): ApplicationModelReferenceSchema<TIdentity> {
  const marker = `applik8s:model-reference:${encodeURIComponent(JSON.stringify(reference))}`;
  const described = (schema as Type<unknown>).describe(marker);
  const existing = Reflect.get(described, applicationModelReference) as ApplicationModelReferenceContract | undefined;
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(reference))
      throw new Error(
        `ArkType schema is already bound to model reference ${existing.target} and cannot be rebound to ${reference.target}.`,
      );
    return described as ApplicationModelReferenceSchema<TIdentity>;
  }
  Object.defineProperty(described, applicationModelReference, {
    value: Object.freeze(reference),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return described as ApplicationModelReferenceSchema<TIdentity>;
}

function modelRelationshipsFromRuntimeSchema(
  schema: RuntimeSchema<object>,
  source: string,
): ApplicationModelRelationshipContract[] {
  // typecast: ArkType is an optional runtime facet on normalized schema sources and is checked before use.
  const schemaSource = schema.source as typeof schema.source & { readonly arktype?: Type<object> };
  if (!schemaSource.arktype) {
    return [];
  }
  const jsonSchema = emitArkTypeStructuralJsonSchema(schemaSource.arktype);
  const relationships: ApplicationModelRelationshipContract[] = [];
  visitReferenceDescriptions(jsonSchema, [], relationships, source);
  return relationships.sort((left, right) => left.name.localeCompare(right.name));
}

function visitReferenceDescriptions(
  value: unknown,
  path: readonly string[],
  relationships: ApplicationModelRelationshipContract[],
  source = 'kubernetes-resource',
): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  const description = Reflect.get(value, 'description');
  if (typeof description === 'string' && description.startsWith('applik8s:model-reference:')) {
    const encoded = description.slice('applik8s:model-reference:'.length);
    try {
      // typecast: the marker is emitted solely by decorateModelReference and consumed through the closed reference contract.
      const reference = JSON.parse(decodeURIComponent(encoded)) as ApplicationModelReferenceContract;
      const field = path.join('.');
      relationships.push({
        source,
        name: path[path.length - 1] ?? reference.target,
        target: reference.target,
        cardinality: 'one',
        integrity: 'reconcile-checked',
        fields: [field],
        references: reference.identity.fields,
      });
    } catch {
      throw new Error(`ArkType model reference at ${path.join('.')} contains invalid Applik8s reference metadata.`);
    }
  }
  const properties = Reflect.get(value, 'properties');
  if (properties && typeof properties === 'object') {
    for (const [key, property] of Object.entries(properties)) {
      visitReferenceDescriptions(property, [...path, key], relationships, source);
    }
  }
  const items = Reflect.get(value, 'items');
  if (items) {
    visitReferenceDescriptions(items, [...path, '*'], relationships, source);
  }
}

function assertCompatiblePromotion<TTable extends AnyPgTable>(
  existing: DrizzleApplicationModelFacet<TTable>,
  table: TTable,
  options: PromoteDrizzleTableOptions<TTable>,
): void {
  const expectedName = options.name ?? getTableName(table);
  const expectedDatabase = options.database ?? 'default';
  if (existing.name !== expectedName || existing.database !== expectedDatabase) {
    throw new Error(
      `Drizzle table ${getTableName(table)} is already promoted as model ${existing.name} in database ${existing.database}; native model promotion is order-independent and cannot be rebound.`,
    );
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function publicApplicationModelName(value: string, owner: string): string {
  if (!/^[$A-Z_a-z][$\w]*$/.test(value)) {
    throw new Error(
      `${owner} application model name ${JSON.stringify(value)} must be a valid JavaScript identifier because it is exported by generated browser and server facades. Pass an explicit name such as "GuestBookEntry".`,
    );
  }
  return value;
}

function normalizedApplicationModelRuntimeRoles(
  model: string,
  roles: readonly string[] | undefined,
): readonly string[] {
  const normalized = Object.freeze([...new Set(roles ?? [])].sort());
  for (const role of normalized) {
    if (!/^[a-z][a-z0-9.-]*(?:\/[A-Za-z0-9._-]+)+$/u.test(role)) {
      throw new Error(
        `Drizzle model ${model} runtime role ${JSON.stringify(role)} must be a stable namespaced identifier.`,
      );
    }
  }
  return normalized;
}

// Compile-time guard: relation schema inputs are native Drizzle objects, never serialized graph values.
export type DrizzleApplicationSchema = Readonly<Record<string, AnyPgTable | Relations | unknown>>;
