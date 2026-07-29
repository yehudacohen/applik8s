// typecast-file-boundary: Drizzle table identity and schema-normalized graph registries preserve generics that are restored after runtime identity checks.

import type { SchemaInput } from '@applik8s/sdk';
import { type as arkType } from 'arktype';
import type { ApplicationDatabaseBinding, ApplicationNativeDrizzleModelOptions } from './application.js';
import type { ApplicationEventLogResourceState } from './application-event-log-resources.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import type {
  ApplicationModelBinding,
  ApplicationModelCommandOptions,
  ApplicationRuntimeModelContract,
} from './application-models.js';
import { recordApplicationModelCommandGraph } from './application-models.js';
import type { ApplicationProcessorOptions } from './application-processor-policy.js';
import type { ApplicationProviderState } from './application-providers.js';
import {
  type ApplicationStreamBinding,
  type ApplicationStreamProcessHandler,
  type ApplicationStreamProcessOptions,
  type ApplicationStreamProcessorBinding,
  registerApplicationStream,
  registerApplicationStreamProcessor,
} from './application-reactive.js';
import { extractApplicationCallArgumentSource } from './application-route-source.js';
import { applicationTypeKroSerializedValue } from './application-typekro-values.js';
import { command, type EventDefinition, event } from './dsl.js';
import {
  type ApplicationModelBeforeCommitHandler,
  type ApplicationModelBeforeCommitOptions,
  type ApplicationModelCreateEvent,
  type ApplicationModelDeleteEvent,
  type ApplicationModelUpdateEvent,
  bindApplicationModelCommandOperation,
  getRequiredDrizzleApplicationModelFacet,
  type PromotedDrizzleTable,
} from './native-models.js';

const applicationBeforeCommitSourceCache = new WeakMap<(...args: never[]) => unknown, Map<string, string>>();

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { isApplicationAuthenticatedPrincipalDefault } from './drizzle.js';

export interface ApplicationNativeModelState extends ApplicationGraphState, ApplicationProviderState, ApplicationEventLogResourceState {
  readonly databases: Map<string, ApplicationDatabaseBinding>;
  readonly modelLifecycleStreams: Map<string, ApplicationStreamBinding<object>>;
}

export function resolveApplicationDatabase(
  state: ApplicationNativeModelState,
  explicit: ApplicationDatabaseBinding | undefined,
): ApplicationDatabaseBinding {
  if (explicit) {
    const registered = state.databases.get(explicit.name);
    if (!registered || registered.schema !== explicit.schema) {
      throw new Error(`Application database ${explicit.name} is not registered in this app context.`);
    }
    return registered;
  }
  const databases = [...state.databases.values()];
  if (databases.length === 1 && databases[0]) return databases[0];
  if (databases.length === 0) {
    throw new Error('app.model(table) requires a registered native database. Declare app.database.postgres("name", { schema, migrations, access }) before promoting a Drizzle table.');
  }
  throw new Error(`app.model(table) is ambiguous because ${databases.length} native databases are registered. Pass { database } explicitly.`);
}

export function validateNativeModelAccess(
  table: AnyPgTable,
  database: ApplicationDatabaseBinding,
  access: ApplicationNativeDrizzleModelOptions<AnyPgTable>['access'],
): void {
  const policy = database.access;
  const effective = access ?? policy?.default ?? 'global';
  if (effective === 'global') return;
  if (!policy) {
    throw new Error(`Drizzle table ${getTableName(table)} requires trusted-context enforcement, but database ${database.name} has no PostgreSQL RLS access policy.`);
  }
  const columns = getTableColumns(table);
  const column = columns[policy.column];
  if (!column) {
    throw new Error(`Drizzle table ${getTableName(table)} must declare column ${policy.column} for database ${database.name}'s required trusted-context/RLS policy, or opt out explicitly with { access: "global" }.`);
  }
  if (!column.notNull) {
    throw new Error(`Drizzle table ${getTableName(table)} access column ${policy.column} must be non-null when trusted context ${policy.context.name} is required.`);
  }
}

export function applicationNativeRuntimeModelContract<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  database: ApplicationDatabaseBinding,
): ApplicationRuntimeModelContract {
  const provider = database.provider;
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const name = facet.name;
  const segment = kubernetesNameSegment(name);
  const clusterName = applicationTypeKroSerializedValue(provider.clusterName ?? provider.name ?? `${segment}-db`);
  const secret = provider.connectionSecret ?? {
    apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}),
  };
  const columns = getTableColumns(model);
  const identityProperty = facet.identity.fields[0];
  const identityColumn = identityProperty ? columns[identityProperty] : undefined;
  if (!identityProperty || !identityColumn) throw new Error(`Native model ${name} has no serializable identity column.`);
  const revisionProperty = facet.revision?.field;
  const revisionColumn = revisionProperty ? columns[revisionProperty] : undefined;
  return {
    name,
    tableName: facet.table.name,
    provider: 'postgres',
    authorityName: database.name,
    database: applicationTypeKroSerializedValue(provider.database ?? database.name),
    clusterName,
    secretName: applicationTypeKroSerializedValue(secret.name ?? `${clusterName}-app`),
    secretKey: applicationTypeKroSerializedValue(provider.connectionSecretKey ?? 'uri'),
    ...(secret.namespace ?? provider.namespace ? { secretNamespace: applicationTypeKroSerializedValue(secret.namespace ?? provider.namespace) } : {}),
    connectionEnvName: `APPLIK8S_DATABASE_${kubernetesNameSegment(database.name).replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_URL`,
    constraints: facet.relationships.filter((relationship) => relationship.integrity === 'foreign-key').map((relationship) => ({
      name: `${name}_${relationship.name}_fk`, fields: relationship.fields, kind: 'foreignKey',
    })),
    indexes: [],
    retention: { mode: 'retain' },
    storageShape: 'native-relational',
    nativeRelational: {
      ...(facet.table.schema ? { schema: facet.table.schema } : {}),
      identity: { property: identityProperty, column: identityColumn.name },
      ...(revisionProperty && revisionColumn ? { revision: { property: revisionProperty, column: revisionColumn.name } } : {}),
      columns: Object.entries(columns).map(([property, column]) => ({ property, column: column.name })),
      ...(database.access ? {
        access: {
          context: database.access.context.name,
          setting: database.access.setting,
          property: database.access.column,
          column: columns[database.access.column]?.name ?? database.access.column,
        },
      } : {}),
    },
  };
}

export function applicationNativeCommandModelBinding<TTable extends AnyPgTable>(
  model: PromotedDrizzleTable<TTable>,
  runtime: ApplicationRuntimeModelContract,
): ApplicationModelBinding<import('drizzle-orm').InferSelectModel<TTable>, Record<string, never>> {
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const unsupported = () => {
    throw new Error(`Native model ${facet.name} uses its Drizzle API for direct persistence and the common relational runtime for observable writes.`);
  };
  return {
    kind: 'applicationModel',
    name: facet.name,
    entity: { kind: 'applik8sEntity', name: facet.name, spec: facet.schema.select } as never,
    runtime,
    backend: {
      interface: 'ModelStore',
      runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
      transactions: 'required',
      queryConsistency: 'strong',
      eventSemantics: 'transactionalOutbox',
      limitations: ['Native relational reads and arbitrary SQL remain Drizzle-owned; only declared observable writes are live-query authoritative.'],
    },
    create: unsupported as never,
    get: unsupported as never,
    query: unsupported as never,
    patch: unsupported as never,
    delete: unsupported as never,
    index: unsupported as never,
    transaction: unsupported as never,
    action: unsupported as never,
    on: {
      created: unsupported as never,
      updated: unsupported as never,
      deleted: unsupported as never,
      command: unsupported as never,
      action: unsupported as never,
    },
  };
}

export function applicationNativeCreateContracts<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>) {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TInput = import('drizzle-orm').InferInsertModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const identity = facet.ref();
  const snapshot = arkType({ identity, value: facet.schema.select, 'revision?': 'string' });
  const created = arkType({ operation: "'create'", identity, value: facet.schema.select, 'revision?': 'string' });
  return {
    command: command<TInput, import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>>(`models.${facet.name}.create.v1`, {
      input: facet.schema.insert,
      output: snapshot as unknown as SchemaInput<import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>>,
    }),
    event: event<ApplicationModelCreateEvent<TValue, TIdentity>>(`models.${facet.name}.created.v1`, {
      payload: created as unknown as SchemaInput<ApplicationModelCreateEvent<TValue, TIdentity>>,
    }),
  };
}

export function applicationNativeUpdateContracts<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>) {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  type TUpdate = Partial<import('drizzle-orm').InferInsertModel<TTable>>;
  type TInput = import('./native-models.js').ApplicationModelUpdateInput<TUpdate, TIdentity>;
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const identity = facet.ref();
  const input = arkType({ identity, patch: facet.schema.update });
  const snapshot = arkType({ identity, value: facet.schema.select, 'revision?': 'string' });
  const updated = arkType({ operation: "'update'", identity, previous: facet.schema.select, current: facet.schema.select, 'revision?': 'string' });
  return {
    command: command<TInput, import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>>(`models.${facet.name}.update.v1`, {
      input: input as unknown as SchemaInput<TInput>,
      output: snapshot as unknown as SchemaInput<import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>>,
    }),
    event: event<ApplicationModelUpdateEvent<TValue, TIdentity>>(`models.${facet.name}.updated.v1`, {
      payload: updated as unknown as SchemaInput<ApplicationModelUpdateEvent<TValue, TIdentity>>,
    }),
  };
}

export function applicationNativeDeleteContracts<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>) {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  type TInput = import('./native-models.js').ApplicationModelDeleteInput<TIdentity>;
  type TTombstone = ApplicationModelDeleteEvent<TValue, TIdentity>['tombstone'];
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const identity = facet.ref();
  const input = arkType({ identity });
  const tombstone = arkType({ identity, deleted: 'true' });
  const deleted = arkType({ operation: "'delete'", identity, previous: facet.schema.select, tombstone: { identity, deleted: 'true' }, 'revision?': 'string' });
  return {
    command: command<TInput, TTombstone>(`models.${facet.name}.delete.v1`, {
      input: input as unknown as SchemaInput<TInput>,
      output: tombstone as unknown as SchemaInput<TTombstone>,
    }),
    event: event<ApplicationModelDeleteEvent<TValue, TIdentity>>(`models.${facet.name}.deleted.v1`, {
      payload: deleted as unknown as SchemaInput<ApplicationModelDeleteEvent<TValue, TIdentity>>,
    }),
  };
}

export function bindApplicationNativeCreateOperation<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  commandModel: ApplicationModelBinding<import('drizzle-orm').InferSelectModel<TTable>, Record<string, never>>,
  defaultProcessor?: ApplicationProcessorOptions,
  policy?: {
    readonly options: ApplicationModelBeforeCommitOptions<import('drizzle-orm').InferInsertModel<TTable>, import('drizzle-orm').InferSelectModel<TTable>>;
    readonly handler: ApplicationModelBeforeCommitHandler<import('drizzle-orm').InferSelectModel<TTable>, import('drizzle-orm').InferInsertModel<TTable>>;
  },
): void {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TInput = import('drizzle-orm').InferInsertModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  type TSnapshot = import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>;
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const contracts = applicationNativeCreateContracts(model);
  const identityProperty = facet.identity.fields[0];
  if (!identityProperty) throw new Error(`Native model ${facet.name} cannot generate create because it has no scalar identity property.`);
  const identityColumn = getTableColumns(model)[identityProperty];
  const principalDerivedIdentity = isApplicationAuthenticatedPrincipalDefault(identityColumn?.default);
  const keySource = principalDerivedIdentity
    ? `(input, context) => { const supplied = input[${JSON.stringify(identityProperty)}]; if (supplied !== undefined) return String(supplied); const principalId = context?.principal?.id; if (!principalId) throw new Error(${JSON.stringify(`Native model ${facet.name}.create requires an admitted principal because ${identityProperty} uses authenticatedPrincipalId.`)}); return principalId; }`
    : `(input) => String(input[${JSON.stringify(identityProperty)}])`;
  const initializeSource = principalDerivedIdentity
    ? `(input, targetKey) => ({ ...input, [${JSON.stringify(identityProperty)}]: targetKey })`
    : '(input) => input';
  const policySource = policy ? applicationBeforeCommitSource(facet.name, 'create', policy.handler) : undefined;
  const binding = recordApplicationModelCommandGraph(
    state,
    commandModel,
    contracts.command,
    applicationNativeMutationOptions(policy?.options, {
      key: (input: TInput, context) => {
        const supplied = Reflect.get(input, identityProperty);
        if (supplied !== undefined) return String(supplied);
        const principalId = context?.principal?.id;
        if (!principalDerivedIdentity || !principalId) throw new Error(`Native model ${facet.name}.create requires ${principalDerivedIdentity ? `an admitted principal because ${identityProperty} uses authenticatedPrincipalId` : `identity field ${identityProperty}`}.`);
        return principalId;
      },
      missing: {
        initialize: (input: TInput, targetKey: string) => (principalDerivedIdentity
          ? { ...input, [identityProperty]: targetKey }
          : input) as TValue,
      },
      events: [...applicationBeforeCommitEvents(policy?.options), contracts.event],
      publicName: 'create',
      __operation: 'create',
      __generatedSources: {
        key: keySource,
        initialize: initializeSource,
        handler: `async (model, input, context) => {
  ${policySource ? `await (${policySource})(model, input, context);` : ''}
  const created = { operation: 'create', identity: model.identity, value: model.value };
  context.emit(ModelCreated, created);
  return { identity: model.identity, value: model.value };
}`,
      },
    }, defaultProcessor),
    async (target, input, context): Promise<TSnapshot> => {
      await policy?.handler(target, input, context);
      const created: ApplicationModelCreateEvent<TValue, TIdentity> = {
        operation: 'create', identity: target.identity as TIdentity, value: target.value,
      };
      context.emit(contracts.event, created);
      return { identity: target.identity as TIdentity, value: target.value };
    },
  );
  bindApplicationModelCommandOperation(facet.api.create, binding);
}

export function bindApplicationNativeUpdateOperation<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  commandModel: ApplicationModelBinding<import('drizzle-orm').InferSelectModel<TTable>, Record<string, never>>,
  defaultProcessor?: ApplicationProcessorOptions,
  policy?: {
    readonly options: ApplicationModelBeforeCommitOptions<import('./native-models.js').ApplicationModelUpdateInput<Partial<import('drizzle-orm').InferInsertModel<TTable>>, import('./native-models.js').ConventionalTableIdentity<TTable>>, import('drizzle-orm').InferSelectModel<TTable>>;
    readonly handler: ApplicationModelBeforeCommitHandler<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ApplicationModelUpdateInput<Partial<import('drizzle-orm').InferInsertModel<TTable>>, import('./native-models.js').ConventionalTableIdentity<TTable>>>;
  },
): void {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  type TInput = import('./native-models.js').ApplicationModelUpdateInput<Partial<import('drizzle-orm').InferInsertModel<TTable>>, TIdentity>;
  type TSnapshot = import('./native-models.js').ApplicationModelSnapshot<TValue, TIdentity>;
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const contracts = applicationNativeUpdateContracts(model);
  const policySource = policy ? applicationBeforeCommitSource(facet.name, 'update', policy.handler) : undefined;
  const binding = recordApplicationModelCommandGraph(
    state,
    commandModel,
    contracts.command,
    applicationNativeMutationOptions(policy?.options, {
      key: (input: TInput) => String(input.identity),
      missing: 'reject',
      events: [...applicationBeforeCommitEvents(policy?.options), contracts.event],
      publicName: 'update',
      __operation: 'update',
      __generatedSources: {
        key: '(input) => String(input.identity)',
        handler: `async (model, input, context) => {
  const previous = model.value;
  model.patch({ spec: input.patch });
  ${policySource ? `await (${policySource})(model, input, context);` : ''}
  const current = model.value;
  context.emit(ModelUpdated, { operation: 'update', identity: model.identity, previous, current });
  return { identity: model.identity, value: current };
}`,
      },
    }, defaultProcessor),
    async (target, input, context): Promise<TSnapshot> => {
      const previous = target.value;
      target.patch({ spec: input.patch as unknown as Partial<TValue> });
      await policy?.handler(target, input, context);
      const current = target.value;
      context.emit(contracts.event, {
        operation: 'update', identity: target.identity as TIdentity, previous, current,
      });
      return { identity: target.identity as TIdentity, value: current };
    },
  );
  bindApplicationModelCommandOperation(facet.api.update, binding);
}

export function bindApplicationNativeDeleteOperation<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  commandModel: ApplicationModelBinding<import('drizzle-orm').InferSelectModel<TTable>, Record<string, never>>,
  defaultProcessor?: ApplicationProcessorOptions,
  policy?: {
    readonly options: ApplicationModelBeforeCommitOptions<import('./native-models.js').ApplicationModelDeleteInput<import('./native-models.js').ConventionalTableIdentity<TTable>>, import('drizzle-orm').InferSelectModel<TTable>>;
    readonly handler: ApplicationModelBeforeCommitHandler<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ApplicationModelDeleteInput<import('./native-models.js').ConventionalTableIdentity<TTable>>>;
  },
): void {
  type TValue = import('drizzle-orm').InferSelectModel<TTable>;
  type TIdentity = import('./native-models.js').ConventionalTableIdentity<TTable>;
  type TInput = import('./native-models.js').ApplicationModelDeleteInput<TIdentity>;
  type TTombstone = ApplicationModelDeleteEvent<TValue, TIdentity>['tombstone'];
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const contracts = applicationNativeDeleteContracts(model);
  const policySource = policy ? applicationBeforeCommitSource(facet.name, 'delete', policy.handler) : undefined;
  const binding = recordApplicationModelCommandGraph(
    state,
    commandModel,
    contracts.command,
    applicationNativeMutationOptions(policy?.options, {
      key: (input: TInput) => String(input.identity),
      missing: 'reject',
      events: [...applicationBeforeCommitEvents(policy?.options), contracts.event],
      publicName: 'delete',
      __operation: 'delete',
      __generatedSources: {
        key: '(input) => String(input.identity)',
        handler: `async (model, input, context) => {
  ${policySource ? `await (${policySource})(model, input, context);` : ''}
  const tombstone = { identity: model.identity, deleted: true };
  context.emit(ModelDeleted, { operation: 'delete', identity: model.identity, previous: model.value, tombstone });
  model.delete();
  return tombstone;
}`,
      },
    }, defaultProcessor),
    async (target, input, context): Promise<TTombstone> => {
      await policy?.handler(target, input, context);
      const tombstone = { identity: target.identity as TIdentity, deleted: true as const };
      context.emit(contracts.event, {
        operation: 'delete', identity: target.identity as TIdentity, previous: target.value, tombstone,
      });
      target.delete();
      return tombstone;
    },
  );
  bindApplicationModelCommandOperation(facet.api.delete, binding);
}

function applicationNativeMutationOptions<TInput extends object, TValue extends object>(
  policy: ApplicationModelBeforeCommitOptions<TInput, TValue> | undefined,
  generated: Pick<ApplicationModelCommandOptions<TInput, TValue>, 'key' | 'missing' | 'events' | 'publicName' | '__operation' | '__generatedSources'>,
  defaultProcessor?: ApplicationProcessorOptions,
): ApplicationModelCommandOptions<TInput, TValue> {
  const processor = policy?.processor ?? defaultProcessor;
  const transaction = policy?.transaction
    ? (() => {
        const { outbox: _outbox, ...rest } = policy.transaction;
        return rest;
      })()
    : undefined;
  return {
    ...policy,
    ...generated,
    history: policy?.history ?? true,
    ...(processor ? { processor } : {}),
    ...(transaction ? { transaction } : {}),
  };
}

function applicationBeforeCommitEvents<TInput extends object, TValue extends object>(
  options: ApplicationModelBeforeCommitOptions<TInput, TValue> | undefined,
): readonly EventDefinition<object>[] {
  return [...(options?.events ?? []), ...(options?.transaction?.outbox ?? [])];
}

function applicationBeforeCommitSource(
  modelName: string,
  operation: 'create' | 'update' | 'delete',
  handler: (...args: never[]) => unknown,
): string {
	const cacheKey = `${modelName}:${operation}`;
	const cached = applicationBeforeCommitSourceCache.get(handler)?.get(cacheKey);
	if (cached) return cached;
  const source = (extractApplicationCallArgumentSource('beforeCommit', 1)?.source ?? Function.prototype.toString.call(handler)).trim();
  if (!source || source.includes('[native code]')) {
    throw new Error(`Model ${modelName}.${operation}.beforeCommit(...) must be a serializable JavaScript function.`);
  }
	const entries = applicationBeforeCommitSourceCache.get(handler) ?? new Map();
	entries.set(cacheKey, source);
	applicationBeforeCommitSourceCache.set(handler, entries);
  return source;
}

export function registerApplicationNativeCreateProcessor<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  database: ApplicationDatabaseBinding,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: import('./native-models.js').ApplicationModelCreateEventHandler<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>,
): ApplicationStreamProcessorBinding<ApplicationModelCreateEvent<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>> {
  const contracts = applicationNativeCreateContracts(model);
  return registerApplicationNativeProcessor(state, database, contracts.event, name, options, handler, (value) => String(value.identity));
}

export function registerApplicationNativeUpdateProcessor<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  database: ApplicationDatabaseBinding,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: import('./native-models.js').ApplicationModelUpdateEventHandler<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>,
): ApplicationStreamProcessorBinding<ApplicationModelUpdateEvent<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>> {
  const contracts = applicationNativeUpdateContracts(model);
  return registerApplicationNativeProcessor(state, database, contracts.event, name, options, handler, (value) => String(value.identity));
}

export function registerApplicationNativeDeleteProcessor<TTable extends AnyPgTable>(
  state: ApplicationNativeModelState,
  model: PromotedDrizzleTable<TTable>,
  database: ApplicationDatabaseBinding,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: import('./native-models.js').ApplicationModelDeleteEventHandler<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>,
): ApplicationStreamProcessorBinding<ApplicationModelDeleteEvent<import('drizzle-orm').InferSelectModel<TTable>, import('./native-models.js').ConventionalTableIdentity<TTable>>> {
  const contracts = applicationNativeDeleteContracts(model);
  return registerApplicationNativeProcessor(state, database, contracts.event, name, options, handler, (value) => String(value.identity));
}

export function registerApplicationNativeActionProcessor<TPayload extends object>(
  state: ApplicationNativeModelState,
  database: ApplicationDatabaseBinding,
  definition: EventDefinition<TPayload>,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: ApplicationStreamProcessHandler<TPayload>,
): ApplicationStreamProcessorBinding<TPayload> {
  return registerApplicationNativeProcessor(
    state,
    database,
    definition,
    name,
    options,
    handler,
    (value) => String(Reflect.get(value, 'identity')),
  );
}

function registerApplicationNativeProcessor<TPayload extends object>(
  state: ApplicationNativeModelState,
  database: ApplicationDatabaseBinding,
  definition: EventDefinition<TPayload>,
  name: string,
  options: ApplicationStreamProcessOptions,
  handler: ApplicationStreamProcessHandler<TPayload>,
  partitionBy: (value: TPayload) => string,
): ApplicationStreamProcessorBinding<TPayload> {
  const streamKey = definition.id;
  let stream = state.modelLifecycleStreams.get(streamKey) as ApplicationStreamBinding<TPayload> | undefined;
  if (!stream) {
    stream = registerApplicationStream(state, definition, {
      database,
      retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 10_000_000 },
      partitionBy,
      authorize: () => false,
    });
    state.modelLifecycleStreams.set(streamKey, stream as unknown as ApplicationStreamBinding<object>);
  }
  return registerApplicationStreamProcessor(state, name, stream, options, handler);
}
