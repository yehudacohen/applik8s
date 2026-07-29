// typecast-file-boundary: Drizzle table identity and schema-normalized registries preserve generics that must be restored after runtime identity checks.
import type { JsonObject, JsonValue, ResourceDefinition, ResourceInstanceInput, ResourceObject, RuntimeSchema } from '@applik8s/core';
import { createApplicationMutationOperation, decorateApplicationMutationOperation, observeApplicationOperationAuthority, type ApplicationMutationOperation, type ApplicationQueryOperation } from '@applik8s/client';
import { normalizeSchema } from '@applik8s/sdk';
import { type as arkType, type Type } from 'arktype';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-arktype';
import { createTableRelationsHelpers, extractTablesRelationalConfig, getTableColumns, getTableName, isTable, Many, normalizeRelation, One, type InferInsertModel, type InferSelectModel, type Relation, type Relations, type Table } from 'drizzle-orm';
import { getTableConfig, type AnyPgTable } from 'drizzle-orm/pg-core';
import type { ApplicationModelBinding, ApplicationModelCommandBinding, ApplicationModelCommandHandler, ApplicationModelCommandOptions } from './application-models.js';
import type {
  ApplicationSearchDocument,
  ApplicationSearchField,
  ApplicationSearchIndexBinding,
} from './application-search.js';
import type { ApplicationKubernetesModelViewOptions, ApplicationModelViewOptions, ApplicationQueryPrincipal, ApplicationQuerySourceBinding } from './application-queries.js';
import type { ApplicationStreamProcessContext, ApplicationStreamProcessOptions, ApplicationStreamProcessorBinding } from './application-reactive.js';
import type { ApplicationReconcileHandler, ApplicationReconcileOptions, ApplicationResourceControllerBinding } from './application-events.js';
import { event, type CommandDefinition, type EventDefinition } from './dsl.js';
import { applicationModelFacet, getRequiredDrizzleApplicationModelFacet } from './native-model-runtime.js';

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

/** A committed exceptional model operation delivered through the same outbox as lifecycle events. */
export interface ApplicationModelActionCompletedEvent<TName extends string, TValue, TOutput, TIdentity = string> {
  readonly operation: TName;
  readonly identity: TIdentity;
  readonly previous: TValue;
  readonly current: TValue;
  readonly result: TOutput;
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
export type ApplicationModelBeforeCommitHandler<
  TValue extends object,
  TInput extends object,
> = (
  model: ApplicationModelCommandHandler<TValue, Record<string, never>, TInput, object> extends (
    model: infer TModel,
    input: TInput,
    context: infer _TContext,
  ) => unknown ? TModel : never,
  input: TInput,
  context: ApplicationModelCommandHandler<TValue, Record<string, never>, TInput, object> extends (
    model: infer _TModel,
    input: TInput,
    context: infer TContext,
  ) => unknown ? TContext : never,
) => void | Promise<void>;

export type ApplicationModelBeforeCommitOptions<TInput extends object, TValue extends object> = Omit<
  ApplicationModelCommandOptions<TInput, TValue>,
  'key' | 'missing' | 'publicName' | '__operation' | '__generatedSources'
>;

export interface ApplicationModelMutationOperation<
  TInput extends object,
  TOutput,
  TValue extends object,
> extends ApplicationMutationOperation<TInput, TOutput, TValue> {
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

export type ApplicationModelActionCompletedRegistrar<
  TName extends string,
  TValue,
  TOutput,
  TIdentity = string,
> = (
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: (
    completed: ApplicationModelActionCompletedEvent<TName, TValue, TOutput, TIdentity>,
    context: ApplicationStreamProcessContext,
  ) => void | Promise<void>,
) => ApplicationStreamProcessorBinding<ApplicationModelActionCompletedEvent<TName, TValue, TOutput, TIdentity>>;

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
  extends Omit<CommonApplicationModelFacet<InferSelectModel<TTable>, TIdentity, InferInsertModel<TTable>, Partial<InferInsertModel<TTable>>>, 'provider' | 'native' | 'schema'> {
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
  readonly on: {
    command<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
      command: CommandDefinition<TInput, TOutput, TErrors>,
      options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
      handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
    ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
    operation<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
      operation: CommandDefinition<TInput, TOutput, TErrors>,
      options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
      handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
    ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
    /** @deprecated Use on.operation(...) instead. Removed at 1.0. */
    action<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
      operation: CommandDefinition<TInput, TOutput, TErrors>,
      options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
      handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
    ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
  };
}

export interface DrizzleApplicationModelApi<
  TTable extends AnyPgTable,
  TIdentity = ConventionalTableIdentity<TTable>,
> {
  readonly create: ApplicationModelMutationOperation<InferInsertModel<TTable>, ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>, InferSelectModel<TTable>>;
  readonly update: ApplicationModelMutationOperation<ApplicationModelUpdateInput<Partial<InferInsertModel<TTable>>, TIdentity>, ApplicationModelSnapshot<InferSelectModel<TTable>, TIdentity>, InferSelectModel<TTable>>;
  readonly delete: ApplicationModelMutationOperation<ApplicationModelDeleteInput<TIdentity>, ApplicationModelDeleteEvent<InferSelectModel<TTable>, TIdentity>['tombstone'], InferSelectModel<TTable>>;
  readonly on: ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, TIdentity>;
  view<const TName extends string, TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined = undefined>(
    name: TName,
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): PromotedDrizzleTable<TTable, TIdentity> & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
  command<const TName extends string, TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
    name: TName,
    command: CommandDefinition<TInput, TOutput, TErrors>,
    options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
    handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
  ): PromotedDrizzleTable<TTable, TIdentity> & Readonly<Record<TName, ApplicationMutationOperation<TInput, TOutput>>>;
  operation<const TName extends string, TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
    name: TName,
    operation: CommandDefinition<TInput, TOutput, TErrors>,
    options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
    handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
  ): PromotedDrizzleTable<TTable, TIdentity>
    & Readonly<Record<TName, ApplicationMutationOperation<TInput, TOutput>>>
    & { readonly on: ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, TIdentity> & Readonly<Record<TName, ApplicationModelActionCompletedRegistrar<TName, InferSelectModel<TTable>, TOutput, TIdentity>>> };
  /** @deprecated Use operation(name, ...) instead. Removed at 1.0. */
  action<const TName extends string, TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
    name: TName,
    operation: CommandDefinition<TInput, TOutput, TErrors>,
    options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
    handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
  ): PromotedDrizzleTable<TTable, TIdentity>
    & Readonly<Record<TName, ApplicationMutationOperation<TInput, TOutput>>>
    & { readonly on: ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, TIdentity> & Readonly<Record<TName, ApplicationModelActionCompletedRegistrar<TName, InferSelectModel<TTable>, TOutput, TIdentity>>> };
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

export type PromotedDrizzleTable<TTable extends AnyPgTable, TIdentity = ConventionalTableIdentity<TTable>> = TTable & {
  readonly [applicationModelFacet]: DrizzleApplicationModelFacet<TTable, TIdentity>;
} & Omit<DrizzleApplicationModelDirectMembers<TTable, TIdentity>, keyof TTable>;

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
    view<
      const TName extends string,
      TInput,
      TOutput,
      TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
      TSource extends ApplicationQuerySourceBinding | undefined = undefined,
    >(
      name: TName,
      options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
    ): PromotedAnalyticalDrizzleTable<TTable, TIdentity>
      & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
  };
}

type DrizzleAnalyticalModelDirectMembers<
  TTable extends AnyPgTable,
  TIdentity,
> = {
  readonly $model: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>;
  readonly schema: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>['schema'];
  readonly relations: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>['relations'];
  ref(): ApplicationModelReferenceSchema<TIdentity>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  view<
    const TName extends string,
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined = undefined,
  >(
    name: TName,
    options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  ): PromotedAnalyticalDrizzleTable<TTable, TIdentity>
    & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
};

export type PromotedAnalyticalDrizzleTable<
  TTable extends AnyPgTable,
  TIdentity = ConventionalTableIdentity<TTable>,
> = TTable & {
  readonly [applicationModelFacet]: DrizzleAnalyticalApplicationModelFacet<TTable, TIdentity>;
} & Omit<DrizzleAnalyticalModelDirectMembers<TTable, TIdentity>, keyof TTable>;

export interface PromoteDrizzleTableOptions<TTable extends AnyPgTable> {
  readonly name?: string;
  readonly database?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly identity?: readonly (keyof InferSelectModel<TTable> & string)[];
  readonly revision?: keyof InferSelectModel<TTable> & string | false;
}

export type PromoteAnalyticalDrizzleTableOptions<TTable extends AnyPgTable> =
  Omit<PromoteDrizzleTableOptions<TTable>, 'database' | 'revision'>;

type NativeModelCommandRegistrar = (command: CommandDefinition<object, object, Readonly<Record<string, object>>>, options: ApplicationModelCommandOptions<object, object>, handler: ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>) => ApplicationModelCommandBinding<object, object, object, Record<string, never>>;
type NativeModelBeforeCommitRegistrar = (
  options: ApplicationModelBeforeCommitOptions<object, object>,
  handler: ApplicationModelBeforeCommitHandler<object, object>,
) => void;
type ApplicationModelViewRegistrar = <TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined>(name: string, options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>) => ApplicationQueryOperation<TInput, TOutput>;

const nativeModelCommandRegistrars = new WeakMap<object, NativeModelCommandRegistrar>();
const nativeModelBeforeCommitRegistrars = new WeakMap<object, NativeModelBeforeCommitRegistrar>();
type NativeModelLifecycleRegistrar = ApplicationModelLifecycleRegistrar<object, unknown>;
const nativeModelLifecycleRegistrars = new WeakMap<object, NativeModelLifecycleRegistrar>();
type NativeModelActionEventRegistrar = (
  definition: EventDefinition<object>,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: (payload: object, context: ApplicationStreamProcessContext) => void | Promise<void>,
) => ApplicationStreamProcessorBinding<object>;
const nativeModelActionEventRegistrars = new WeakMap<object, NativeModelActionEventRegistrar>();
const nativeApplicationModelBindings = new WeakMap<object, ApplicationModelBinding<object, object>>();
const applicationModelViewRegistrars = new WeakMap<object, ApplicationModelViewRegistrar>();
const applicationModelCommandOperationBindings = new WeakMap<object, ApplicationModelCommandBinding>();
type NativeKubernetesLifecycleRegistrar = ApplicationKubernetesLifecycleRegistrar<object, object>;
const nativeKubernetesLifecycleRegistrars = new WeakMap<object, NativeKubernetesLifecycleRegistrar>();

export function applicationModelCommandBindingForOperation(value: unknown): ApplicationModelCommandBinding | undefined {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? applicationModelCommandOperationBindings.get(value)
    : undefined;
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
): ((
  options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
  handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
) => void) | undefined {
  return nativeModelBeforeCommitRegistrars.get(operation) as unknown as ((
    options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
    handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
  ) => void) | undefined;
}

/** Binds a compiler-created direct operation such as Model.create to its durable command transport. */
export function bindApplicationModelCommandOperation(value: object, binding: ApplicationModelCommandBinding): void {
  applicationModelCommandOperationBindings.set(value, binding);
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
  return nativeKubernetesLifecycleRegistrars.get(resource) as unknown as ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus> | undefined;
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

export interface ApplicationKubernetesCreateRequest<TSpec extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
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

export interface ApplicationKubernetesCreatePolicy<TSpec extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly authorize: (request: ApplicationKubernetesCreateRequest<TSpec, TPrincipal>) => boolean | Promise<boolean>;
  readonly place: (request: { readonly context: Readonly<Record<string, JsonValue>>; readonly input: TSpec }) => ApplicationKubernetesCreatePlacement;
}

export interface ApplicationKubernetesLifecycleRegistrar<TSpec extends object, TStatus extends object> {
  create(name: string, options: ApplicationReconcileOptions, handler: ApplicationReconcileHandler<TSpec, TStatus>): ApplicationResourceControllerBinding;
  update(name: string, options: ApplicationReconcileOptions, handler: ApplicationReconcileHandler<TSpec, TStatus>): ApplicationResourceControllerBinding;
  delete(name: string, options: ApplicationReconcileOptions, handler: ApplicationReconcileHandler<TSpec, TStatus>): ApplicationResourceControllerBinding;
}

export type PromotedKubernetesResource<TSpec extends object, TStatus extends object = Record<string, never>> = ResourceDefinition<TSpec, TStatus> & {
  readonly $model: KubernetesApplicationModelFacet<TSpec, TStatus>;
  readonly [applicationModelFacet]: KubernetesApplicationModelFacet<TSpec, TStatus>;
  readonly relations: KubernetesApplicationModelFacet<TSpec, TStatus>['relations'];
  ref(): ApplicationModelReferenceSchema<string>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  readonly create: ApplicationMutationOperation<TSpec | ResourceInstanceInput<TSpec> | ResourceObject<TSpec, TStatus>, ResourceObject<TSpec, TStatus>>;
  readonly on: ResourceDefinition<TSpec, TStatus>['on'] & ApplicationKubernetesLifecycleRegistrar<TSpec, TStatus>;
  view<const TName extends string, TInput, TOutput, TSelf extends PromotedKubernetesResource<TSpec, TStatus> = PromotedKubernetesResource<TSpec, TStatus>, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(
    this: TSelf,
    name: TName,
    options: ApplicationKubernetesModelViewOptions<TInput, ResourceObject<TSpec, TStatus>, TOutput, TPrincipal>,
  ): TSelf & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
};

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
    throw new Error(
      'Applik8s analytical model promotion requires a Drizzle table.',
    );
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
      options.name !== undefined
      && existing.name
        !== publicApplicationModelName(
          options.name,
          `Drizzle table ${getTableName(table)}`,
        )
    ) {
      throw new Error(
        `Drizzle table ${getTableName(table)} is already promoted as ${existing.name}.`,
      );
    }
    return table as PromotedAnalyticalDrizzleTable<TTable>;
  }

  const directMemberNames = [
    '$model',
    'schema',
    'relations',
    'ref',
    'view',
  ] as const;
  const directMemberCollisions = Object.freeze(
    directMemberNames.filter((member) => member in table),
  );
  const tableConfig = getTableConfig(table);
  const identityFields = resolveIdentityFields(table, options.identity);
  if (identityFields.length !== 1) {
    throw new Error(
      `Drizzle table ${getTableName(table)} has composite identity [${identityFields.join(', ')}]. Analytical model promotion requires one canonical identity field.`,
    );
  }
  const selectSchema = createSelectSchema(table) as Type<
    InferSelectModel<TTable>
  >;
  const name = publicApplicationModelName(
    options.name ?? getTableName(table),
    `Drizzle table ${getTableName(table)}`,
  );
  const identity: ApplicationModelIdentityContract = {
    fields: identityFields,
    encoding: 'scalar',
  };
  const relationships = Object.freeze(
    normalizeDrizzleModelRelationships(table, options.schema, name),
  );
  const view = <
    const TName extends string,
    TInput,
    TOutput,
    TPrincipal extends ApplicationQueryPrincipal,
    TSource extends ApplicationQuerySourceBinding | undefined,
  >(
    viewName: TName,
    viewOptions: ApplicationModelViewOptions<
      TInput,
      TOutput,
      TPrincipal,
      TSource
    >,
  ) =>
    installApplicationModelView(
      table,
      viewName,
      viewOptions,
    ) as PromotedAnalyticalDrizzleTable<TTable>
      & Readonly<Record<TName, ApplicationQueryOperation<TInput, TOutput>>>;
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
    relations: Object.freeze(
      Object.fromEntries(
        relationships.map((relationship) => [
          relationship.name,
          relationship,
        ]),
      ),
    ),
    capabilities: Object.freeze({
      reads: 'declaredQueries',
      aggregates: 'providerRefinement',
      ingestion: 'projectionOwned',
      checkpoint: 'idempotent',
      rebuild: 'fullReplay',
    }),
    api: Object.freeze({ view }),
    ref() {
      const identitySchema = arktypePropertySchema(
        selectSchema,
        identityFields[0] as string,
      );
      return decorateModelReference(identitySchema, {
        target: name,
        identity,
        integrity: 'soft',
      }) as ApplicationModelReferenceSchema<
        ConventionalTableIdentity<TTable>
      >;
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
export function promoteDrizzleTable<TTable extends AnyPgTable>(table: TTable, options: PromoteDrizzleTableOptions<TTable> = {}): PromotedDrizzleTable<TTable> {
  if (!isTable(table)) {
    throw new Error('Applik8s native model promotion requires a Drizzle table. Views, relations, queries, and wrapper objects are not promotable models.');
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
    'create',
    'update',
    'delete',
    'on',
    'view',
    'command',
    'operation',
    'action',
  ] as const;
  const directMemberCollisions = Object.freeze(
    directMemberNames.filter((member) => member in table),
  );

  const tableConfig = getTableConfig(table);
  const identityFields = resolveIdentityFields(table, options.identity);
  if (identityFields.length !== 1) {
    throw new Error(`Drizzle table ${getTableName(table)} has composite identity [${identityFields.join(', ')}]. v0.6 requires an explicit canonical tuple codec before composite identities can be promoted.`);
  }
  const revisionField = resolveRevisionField(table, options.revision);
  const selectSchema = createSelectSchema(table) as Type<InferSelectModel<TTable>>;
  const insertSchema = createInsertSchema(table) as Type<InferInsertModel<TTable>>;
  const updateSchema = createUpdateSchema(table) as Type<Partial<InferInsertModel<TTable>>>;
  const name = publicApplicationModelName(options.name ?? getTableName(table), `Drizzle table ${getTableName(table)}`);
  const identity: ApplicationModelIdentityContract = { fields: identityFields, encoding: 'scalar' };
  const relationships = Object.freeze(normalizeDrizzleModelRelationships(table, options.schema, name));
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
    relations: Object.freeze(Object.fromEntries(relationships.map((relationship) => [relationship.name, relationship]))),
    on: Object.freeze({
      command<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
        command: CommandDefinition<TInput, TOutput, TErrors>,
        commandOptions: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
        handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
      ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>> {
        const registrar = nativeModelCommandRegistrars.get(table);
        if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring durable commands.`);
        // typecast: the registrar is installed by app.model for this exact promoted table and runtime row schema.
        return registrar(command as CommandDefinition<object, object, Readonly<Record<string, object>>>, commandOptions as ApplicationModelCommandOptions<object, object>, handler as unknown as ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>) as unknown as ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
      },
      operation<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
        operation: CommandDefinition<TInput, TOutput, TErrors>,
        operationOptions: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
        handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
      ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>> {
        const registrar = nativeModelCommandRegistrars.get(table);
        if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring durable operations.`);
        return registrar(operation as CommandDefinition<object, object, Readonly<Record<string, object>>>, operationOptions as ApplicationModelCommandOptions<object, object>, handler as unknown as ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>) as unknown as ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
      },
      action<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
        operation: CommandDefinition<TInput, TOutput, TErrors>,
        operationOptions: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
        handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
      ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>> {
        const registrar = nativeModelCommandRegistrars.get(table);
        if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring durable operations.`);
        return registrar(operation as CommandDefinition<object, object, Readonly<Record<string, object>>>, operationOptions as ApplicationModelCommandOptions<object, object>, handler as unknown as ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>) as unknown as ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
      },
    }),
    ref() {
      const identitySchema = arktypePropertySchema(selectSchema, identityFields[0] as string);
      const reference: ApplicationModelReferenceContract = {
        target: name,
        identity,
        integrity: 'soft',
      };
      return decorateModelReference(identitySchema, reference) as ApplicationModelReferenceSchema<ConventionalTableIdentity<TTable>>;
    },
  });

  const createOperation = applicationModelMutationOperation<
    InferInsertModel<TTable>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    InferSelectModel<TTable>
  >({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: `${name}.create`,
    model: name,
    name: 'create',
    operation: 'create',
    transport: 'command',
  });
  const updateOperation = applicationModelMutationOperation<
    ApplicationModelUpdateInput<Partial<InferInsertModel<TTable>>, ConventionalTableIdentity<TTable>>,
    ApplicationModelSnapshot<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    InferSelectModel<TTable>
  >({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: `${name}.update`,
    model: name,
    name: 'update',
    operation: 'update',
    transport: 'command',
  });
  const deleteOperation = applicationModelMutationOperation<
    ApplicationModelDeleteInput<ConventionalTableIdentity<TTable>>,
    ApplicationModelDeleteEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>['tombstone'],
    InferSelectModel<TTable>
  >({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: `${name}.delete`,
    model: name,
    name: 'delete',
    operation: 'delete',
    transport: 'command',
  });

  const lifecycleRegistrars = {
    create(
      lifecycleName: string,
      lifecycleOptions: ApplicationStreamProcessOptions,
      lifecycleHandler: ApplicationModelCreateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring create-event handlers.`);
      // typecast: the registrar is installed for this exact promoted table and its derived select/identity types.
      return registrar.create(lifecycleName, lifecycleOptions, lifecycleHandler as ApplicationModelCreateEventHandler<object, unknown>) as ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>>;
    },
    update(
      lifecycleName: string,
      lifecycleOptions: ApplicationStreamProcessOptions,
      lifecycleHandler: ApplicationModelUpdateEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring update-event handlers.`);
      return registrar.update(lifecycleName, lifecycleOptions, lifecycleHandler as ApplicationModelUpdateEventHandler<object, unknown>) as ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>>;
    },
    delete(
      lifecycleName: string,
      lifecycleOptions: ApplicationStreamProcessOptions,
      lifecycleHandler: ApplicationModelDeleteEventHandler<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
    ) {
      const registrar = nativeModelLifecycleRegistrars.get(table);
      if (!registrar) throw new Error(`Native model ${name} must be registered through app.model(table) before declaring delete-event handlers.`);
      return registrar.delete(lifecycleName, lifecycleOptions, lifecycleHandler as ApplicationModelDeleteEventHandler<object, unknown>) as ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>>;
    },
  };

  const viewModel = <TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined>(viewName: string, viewOptions: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>) =>
    installApplicationModelView(table, viewName, viewOptions);
  const commandModel = <TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
    operationName: string,
    command: CommandDefinition<TInput, TOutput, TErrors>,
    commandOptions: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
    handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
  ) => installApplicationModelCommand(table, operationName, command, commandOptions, handler);
  const operationModel = <TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
    operationName: string,
    operation: CommandDefinition<TInput, TOutput, TErrors>,
    operationOptions: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
    handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
  ) => installApplicationModelOperation(table, operationName, operation, operationOptions, handler);
  // typecast-boundary: every member is derived from this exact table; the
  // private object-returning installers regain their generic public surface at
  // this single collision-safe API boundary.
  collisionSafeApi = Object.freeze({
    create: createOperation,
    update: updateOperation,
    delete: deleteOperation,
    on: lifecycleRegistrars,
    view: viewModel,
    command: commandModel,
    operation: operationModel,
    action: operationModel,
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
    create: collisionSafeApi.create,
    update: collisionSafeApi.update,
    delete: collisionSafeApi.delete,
    on: collisionSafeApi.on,
    view: collisionSafeApi.view,
    command: collisionSafeApi.command,
    operation: collisionSafeApi.operation,
    action: collisionSafeApi.action,
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
): ApplicationModelMutationOperation<TInput, TOutput, TValue> {
  const operation = createApplicationMutationOperation<TInput, TOutput, TValue>(contract) as unknown as ApplicationModelMutationOperation<TInput, TOutput, TValue>;
  Object.defineProperty(operation, 'beforeCommit', {
    value: (
      options: ApplicationModelBeforeCommitOptions<TInput, TValue>,
      handler: ApplicationModelBeforeCommitHandler<TValue, TInput>,
    ) => {
      const registrar = nativeApplicationModelBeforeCommitRegistrar(operation);
      if (!registrar) {
        throw new Error(`Application model ${contract.model}.${contract.name}.beforeCommit(...) requires a model registered through app.model(...).`);
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

function installApplicationModelCommand<TTable extends AnyPgTable, TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
  model: TTable,
  name: string,
  command: CommandDefinition<TInput, TOutput, TErrors>,
  options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
  handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
): object {
  if (!/^[$A-Z_a-z][$\w]*$/.test(name)) throw new Error(`Application model command name ${JSON.stringify(name)} must be a JavaScript identifier.`);
  if (name in model) throw new Error(`Application model command ${name} cannot replace an existing model member.`);
  const registrar = nativeModelCommandRegistrars.get(model);
  if (!registrar) throw new Error('Application model commands must be declared on a model registered through app.model(...).');
  // typecast: the table-identity registry intentionally erases command generics while retaining the same runtime definition object.
  const erasedCommand = command as CommandDefinition<object, object, Readonly<Record<string, object>>>;
  // typecast: the model table identity correlates these options with the erased registrar's row schema.
  const erasedOptions = { ...options, publicName: name } as ApplicationModelCommandOptions<object, object>;
  // typecast: handler generics are restored by the public method result after this one private identity-keyed registry boundary.
  const erasedHandler = handler as unknown as ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>;
  const binding = registrar(erasedCommand, erasedOptions, erasedHandler);
  const operation = createApplicationMutationOperation<TInput, TOutput>({
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: command.id,
      model: getApplicationModelFacet(model)?.name ?? getTableName(model),
      name,
      operation: 'custom',
      transport: 'command',
    });
  applicationModelCommandOperationBindings.set(operation, binding);
  observeApplicationOperationAuthority(operation, (authority) => binding.classify(authority));
  Object.defineProperty(model, name, {
    value: operation,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return model;
}

function installApplicationModelOperation<TTable extends AnyPgTable, TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
  model: TTable,
  name: string,
  command: CommandDefinition<TInput, TOutput, TErrors>,
  options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
  handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
): object {
  const completion = applicationModelActionCompletedDefinition(model, name, command);
  const source = applicationModelActionHandlerSource(name, handler);
  const wrapped: typeof handler = async (target, input, context) => {
    const previous = target.value;
    const result = await handler(target, input, context);
    context.emit(completion, {
      operation: name,
      identity: target.identity,
      previous,
      current: target.value,
      result,
      revision: target.revision ?? '',
    });
    return result;
  };
  const transaction = {
    ...options.transaction,
    outbox: [...(options.transaction?.outbox ?? []), completion],
  };
  const installed = installApplicationModelCommand(model, name, command, {
    ...options,
    transaction,
    __generatedSources: { ...options.__generatedSources, handler: source },
  }, wrapped);
  const registrar = nativeModelActionEventRegistrars.get(model);
  if (!registrar) throw new Error(`Native model action ${name} must be declared on a model registered through app.model(...).`);
  const on = getRequiredDrizzleApplicationModelFacet(model).api.on as unknown as Record<string, unknown>;
  if (name in on) throw new Error(`Application model action event ${name} cannot replace an existing lifecycle member.`);
  Object.defineProperty(on, name, {
    value: (
      processorName: string,
      processorOptions: ApplicationStreamProcessOptions,
      processorHandler: (payload: object, context: ApplicationStreamProcessContext) => void | Promise<void>,
    ) => registrar(completion as EventDefinition<object>, processorName, processorOptions, processorHandler),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return installed;
}

function applicationModelActionCompletedDefinition<TTable extends AnyPgTable, TInput extends object, TOutput extends object>(
  model: TTable,
  name: string,
  command: CommandDefinition<TInput, TOutput, Readonly<Record<string, object>>>,
): EventDefinition<ApplicationModelActionCompletedEvent<string, InferSelectModel<TTable>, TOutput, ConventionalTableIdentity<TTable>>> {
  const facet = getApplicationModelFacet<
    InferSelectModel<TTable>,
    ConventionalTableIdentity<TTable>,
    InferInsertModel<TTable>,
    Partial<InferInsertModel<TTable>>
  >(model);
  if (!facet) throw new Error('Application model actions require promoted model metadata.');
  const row = emittedApplicationJsonSchema(facet.schema.select, `${facet.name}.select`);
  const result = emittedApplicationJsonSchema(command.output, `${command.id}.output`);
  const identityField = facet.identity.fields[0];
  const identity = identityField ? jsonSchemaProperty(row, identityField) : undefined;
  if (!identity) throw new Error(`Application model action ${facet.name}.${name} cannot derive the scalar identity schema.`);
  const payload: JsonObject = {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: [name] },
      identity,
      previous: row,
      current: row,
      result,
      revision: { type: 'string' },
    },
    required: ['operation', 'identity', 'previous', 'current', 'result', 'revision'],
    additionalProperties: false,
  };
  return event(`models.${facet.name}.${name}.completed.v1`, {
    payload: {
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: `${facet.name}.${name}.completed` },
      schema: payload,
    },
  });
}

function emittedApplicationJsonSchema<T extends object>(schema: import('@applik8s/sdk').SchemaInput<T>, name: string): JsonObject {
  const emitted = normalizeSchema(schema, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`Application model action ${name} cannot emit JSON Schema: ${emitted.error.message}`);
  return emitted.value.schema;
}

function jsonSchemaProperty(schema: JsonObject, name: string): JsonObject | undefined {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined;
  const property = Reflect.get(properties, name) as JsonValue | undefined;
  return property && typeof property === 'object' && !Array.isArray(property) ? property as JsonObject : undefined;
}

function applicationModelActionHandlerSource<TOutput extends object>(
  name: string,
  handler: (...args: never[]) => TOutput | Promise<TOutput>,
): string {
  const source = Function.prototype.toString.call(handler).trim();
  if (!source || source.includes('[native code]')) throw new Error(`Application model action ${name} must use a serializable handler.`);
  return `async (model, input, context) => {\n  const previous = model.value;\n  const result = await (${source})(model, input, context);\n  context.emit(ActionCompleted, { operation: ${JSON.stringify(name)}, identity: model.identity, previous, current: model.value, result, revision: model.revision ?? '' });\n  return result;\n}`;
}

export function bindNativeApplicationModelCommands<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  registrar: DrizzleApplicationModelFacet<TTable>['on']['command'],
): void {
  // typecast: the public generic registrar is erased only in the private table-identity registry; every invocation remains schema-bound by the facet method.
  nativeModelCommandRegistrars.set(model, registrar as NativeModelCommandRegistrar);
}

export function nativeApplicationModelCommandRegistrar<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>): DrizzleApplicationModelFacet<TTable>['on']['command'] | undefined {
  // typecast: table identity guarantees the erased registrar was installed for this promoted row schema.
  return nativeModelCommandRegistrars.get(model) as DrizzleApplicationModelFacet<TTable>['on']['command'] | undefined;
}

export function bindNativeApplicationModelLifecycle<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  registrar: ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>>,
): void {
  nativeModelLifecycleRegistrars.set(model, registrar as NativeModelLifecycleRegistrar);
}

export function bindNativeApplicationModelActionEvents<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  registrar: NativeModelActionEventRegistrar,
): void {
  nativeModelActionEventRegistrars.set(model, registrar);
}

export function nativeApplicationModelActionEventRegistrar<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
): NativeModelActionEventRegistrar | undefined {
  return nativeModelActionEventRegistrars.get(model);
}

export function nativeApplicationModelLifecycleRegistrar<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
): ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>> | undefined {
  return nativeModelLifecycleRegistrars.get(model) as ApplicationModelLifecycleRegistrar<InferSelectModel<TTable>, ConventionalTableIdentity<TTable>> | undefined;
}

/** Internal bridge used when a promoted Drizzle model participates in another model action's transaction. */
export function bindNativeApplicationModelBinding(model: object, binding: ApplicationModelBinding<object, object>): void {
  nativeApplicationModelBindings.set(model, binding);
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
export function promoteKubernetesResource<TSpec extends object, TStatus extends object>(resource: ResourceDefinition<TSpec, TStatus>, nameOrOptions: string | PromoteKubernetesResourceOptions<TSpec> = resource.kind): PromotedKubernetesResource<TSpec, TStatus> {
  const options = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const name = publicApplicationModelName(options.name ?? resource.kind, `Kubernetes resource ${resource.apiVersion}/${resource.kind}`);
  const existing = Reflect.get(resource, applicationModelFacet) as KubernetesApplicationModelFacet<TSpec, TStatus> | undefined;
  if (existing) {
    if (existing.name !== name || JSON.stringify(existing.access) !== JSON.stringify(options.access)) {
      throw new Error(`Kubernetes resource ${resource.apiVersion}/${resource.kind} is already promoted as model ${existing.name}.`);
    }
    return resource as PromotedKubernetesResource<TSpec, TStatus>;
  }
  if ('$model' in resource) {
    throw new Error(`Kubernetes resource ${resource.apiVersion}/${resource.kind} already exposes a $model property.`);
  }
  for (const directFacet of ['relations', 'ref'] as const) {
    if (directFacet in resource) {
      throw new Error(`Kubernetes resource ${resource.apiVersion}/${resource.kind} cannot expose direct model ${directFacet} because it already has that property. Use getApplicationModelFacet(...) as the collision-safe advanced path.`);
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
    relations: Object.freeze(Object.fromEntries(relationships.map((relationship) => [relationship.name, relationship]))),
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
    view: {
      value: (viewName: string, viewOptions: ApplicationModelViewOptions<unknown, unknown, ApplicationQueryPrincipal>) => installApplicationModelView(resource, viewName, viewOptions),
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
    if (typeof sdkRegister !== 'function') throw new Error(`Kubernetes model ${modelName} has no SDK ${lifecycle} lifecycle registrar.`);
    Object.defineProperty(eventSources, lifecycle, {
      value: (handlerOrName: ApplicationReconcileHandler<TSpec, TStatus> | string, options?: ApplicationReconcileOptions, handler?: ApplicationReconcileHandler<TSpec, TStatus>) => {
        if (typeof handlerOrName !== 'string') return sdkRegister(handlerOrName);
        if (!options || typeof handler !== 'function') {
          throw new Error(`Kubernetes model ${modelName}.on.${lifecycle}(name, options, handler) requires a lifecycle name, deployment options, and handler.`);
        }
        const registrar = nativeKubernetesLifecycleRegistrars.get(resource);
        if (!registrar) throw new Error(`Kubernetes model ${modelName} must be registered through app.crd(...) before declaring direct lifecycle handlers.`);
        return registrar[lifecycle](handlerOrName, options, handler as unknown as ApplicationReconcileHandler<object, object>);
      },
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
}

function installApplicationModelView<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined>(
  model: object,
  name: string,
  options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
): object {
  if (name in model) throw new Error(`Application model view ${name} cannot replace an existing model member.`);
  const registrar = applicationModelViewRegistrars.get(model);
  if (!registrar) throw new Error('Application model views must be declared on a model registered through app.model(...) or app.crd(...).');
  const operation = registrar(name, options);
  Object.defineProperty(model, name, { value: operation, enumerable: false, configurable: false, writable: false });
  return model;
}

// typecast-boundary: the private symbol is installed only by the validated promotion functions above.
export function getApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate>(value: unknown): CommonApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate> | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  return Reflect.get(value, applicationModelFacet) as CommonApplicationModelFacet<TValue, TIdentity, TInsert, TUpdate> | undefined;
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

function resolveIdentityFields<TTable extends AnyPgTable>(table: TTable, explicit: PromoteDrizzleTableOptions<TTable>['identity']): string[] {
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
  const primaryColumns = [...config.columns.filter((column) => column.primary), ...config.primaryKeys.flatMap((key) => key.columns)];
  const inferred = primaryColumns.map((column) => Object.entries(columns).find(([, candidate]) => candidate === column)?.[0]).filter((field): field is string => field !== undefined);
  if (inferred.length === 0) {
    throw new Error(`Drizzle table ${getTableName(table)} has no inferable primary-key identity. Declare a primary key or pass an explicit identity field.`);
  }
  return uniqueStrings(inferred);
}

function resolveRevisionField<TTable extends AnyPgTable>(table: TTable, revision: PromoteDrizzleTableOptions<TTable>['revision']): string | undefined {
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

function normalizeDrizzleModelRelationships(table: AnyPgTable, schema: Readonly<Record<string, unknown>> | undefined, source: string): ApplicationModelRelationshipContract[] {
  if (!schema) {
    return [];
  }
  const extracted = extractTablesRelationalConfig({ ...schema }, createTableRelationsHelpers);
  const tableConfig = getTableConfig(table);
  const tableEntry = Object.values(extracted.tables).find((candidate) => candidate.dbName === getTableName(table) && candidate.schema === tableConfig.schema);
  if (!tableEntry) {
    throw new Error(`Drizzle table ${getTableName(table)} is not present in the registered relational schema.`);
  }
  return Object.entries(tableEntry.relations).sort(([left], [right]) => left.localeCompare(right)).map(([name, relation]) => drizzleRelationshipContract(
    source,
    name,
    relation,
    extracted.tables,
    extracted.tableNamesMap,
    () => logicalModelNameForTable(schema, relation.referencedTableName) ?? relation.referencedTableName,
  ));
}

function drizzleRelationshipContract(source: string, name: string, relation: Relation, tables: ReturnType<typeof extractTablesRelationalConfig>['tables'], tableNamesMap: Readonly<Record<string, string>>, target: () => string): ApplicationModelRelationshipContract {
  const normalized = normalizeRelation(tables, tableNamesMap, relation);
  const sourceColumns = getTableColumns(relation.sourceTable);
  const targetColumns = getTableColumns(relation.referencedTable);
  const fields = normalized.fields.map((column) => columnPropertyName(sourceColumns, column));
  const references = normalized.references.map((column) => columnPropertyName(targetColumns, column));
  return {
    source,
    name,
    get target() { return target(); },
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
    throw new Error(`Derived ArkType schema does not expose field ${field}; the installed drizzle-arktype adapter is incompatible.`);
  }
  // typecast: ArkType get() returns a Type when invoked on a Type and the compatibility guard proves the method exists.
  return Reflect.apply(get, schema, [field]) as Type<unknown>;
}

// typecast-boundary: ArkType descriptions preserve the identity generic while attaching immutable reference metadata.
function decorateModelReference<TIdentity>(schema: Type<TIdentity>, reference: ApplicationModelReferenceContract): ApplicationModelReferenceSchema<TIdentity> {
  const marker = `applik8s:model-reference:${encodeURIComponent(JSON.stringify(reference))}`;
  const described = (schema as Type<unknown>).describe(marker);
  const existing = Reflect.get(described, applicationModelReference) as ApplicationModelReferenceContract | undefined;
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(reference)) throw new Error(`ArkType schema is already bound to model reference ${existing.target} and cannot be rebound to ${reference.target}.`);
    return described as ApplicationModelReferenceSchema<TIdentity>;
  }
  Object.defineProperty(described, applicationModelReference, { value: Object.freeze(reference), enumerable: false, configurable: false, writable: false });
  return described as ApplicationModelReferenceSchema<TIdentity>;
}

function modelRelationshipsFromRuntimeSchema(schema: RuntimeSchema<object>, source: string): ApplicationModelRelationshipContract[] {
  // typecast: ArkType is an optional runtime facet on normalized schema sources and is checked before use.
  const schemaSource = schema.source as typeof schema.source & { readonly arktype?: Type<object> };
  if (!schemaSource.arktype) {
    return [];
  }
  const jsonSchema = schemaSource.arktype.toJsonSchema();
  const relationships: ApplicationModelRelationshipContract[] = [];
  visitReferenceDescriptions(jsonSchema, [], relationships, source);
  return relationships.sort((left, right) => left.name.localeCompare(right.name));
}

function visitReferenceDescriptions(value: unknown, path: readonly string[], relationships: ApplicationModelRelationshipContract[], source = 'kubernetes-resource'): void {
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

function assertCompatiblePromotion<TTable extends AnyPgTable>(existing: DrizzleApplicationModelFacet<TTable>, table: TTable, options: PromoteDrizzleTableOptions<TTable>): void {
  const expectedName = options.name ?? getTableName(table);
  const expectedDatabase = options.database ?? 'default';
  if (existing.name !== expectedName || existing.database !== expectedDatabase) {
    throw new Error(`Drizzle table ${getTableName(table)} is already promoted as model ${existing.name} in database ${existing.database}; native model promotion is order-independent and cannot be rebound.`);
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function publicApplicationModelName(value: string, owner: string): string {
  if (!/^[$A-Z_a-z][$\w]*$/.test(value)) {
    throw new Error(`${owner} application model name ${JSON.stringify(value)} must be a valid JavaScript identifier because it is exported by generated browser and server facades. Pass an explicit name such as "GuestBookEntry".`);
  }
  return value;
}

// Compile-time guard: relation schema inputs are native Drizzle objects, never serialized graph values.
export type DrizzleApplicationSchema = Readonly<Record<string, AnyPgTable | Relations | unknown>>;
