import type { ResourceDefinition, RuntimeSchema } from '@applik8s/core';
import { type as arkType, type Type } from 'arktype';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-arktype';
import { createTableRelationsHelpers, extractTablesRelationalConfig, getTableColumns, getTableName, isTable, Many, normalizeRelation, One, type InferInsertModel, type InferSelectModel, type Relation, type Relations, type Table } from 'drizzle-orm';
import { getTableConfig, type AnyPgTable } from 'drizzle-orm/pg-core';
import type { ApplicationModelCommandBinding, ApplicationModelCommandHandler, ApplicationModelCommandOptions } from './application-models.js';
import type { CommandDefinition } from './dsl.js';

/** Stable runtime metadata key for native objects promoted into the Applik8s model graph. */
export const applicationModelFacet = Symbol.for('@applik8s/model-facet');

/** Stable runtime metadata key carried by ArkType identity-reference schemas. */
export const applicationModelReference = Symbol.for('@applik8s/model-reference');

export interface ApplicationModelSnapshot<TValue, TIdentity = string> {
  readonly identity: TIdentity;
  readonly value: TValue;
  readonly revision?: string;
}

export interface ApplicationModelIdentityContract {
  readonly fields: readonly string[];
  readonly encoding: 'scalar';
}

export interface ApplicationModelRevisionContract {
  readonly field: string;
  readonly authority: 'postgres-row' | 'kubernetes-resource-version' | 'model-store';
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
  readonly provider: 'postgres' | 'kubernetes' | 'model-store';
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
  readonly on: {
    command<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
      command: CommandDefinition<TInput, TOutput, TErrors>,
      options: ApplicationModelCommandOptions<TInput, InferSelectModel<TTable>>,
      handler: ApplicationModelCommandHandler<InferSelectModel<TTable>, Record<string, never>, TInput, TOutput, TErrors>,
    ): ApplicationModelCommandBinding<TInput, TOutput, InferSelectModel<TTable>, Record<string, never>>;
  };
}

export type PromotedDrizzleTable<TTable extends AnyPgTable, TIdentity = ConventionalTableIdentity<TTable>> = TTable & {
  readonly $model: DrizzleApplicationModelFacet<TTable, TIdentity>;
  readonly [applicationModelFacet]: DrizzleApplicationModelFacet<TTable, TIdentity>;
};

export interface PromoteDrizzleTableOptions<TTable extends AnyPgTable> {
  readonly name?: string;
  readonly database?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly identity?: readonly (keyof InferSelectModel<TTable> & string)[];
  readonly revision?: keyof InferSelectModel<TTable> & string | false;
}

type NativeModelCommandRegistrar = (command: CommandDefinition<object, object, Readonly<Record<string, object>>>, options: ApplicationModelCommandOptions<object, object>, handler: ApplicationModelCommandHandler<object, Record<string, never>, object, object, Readonly<Record<string, object>>>) => ApplicationModelCommandBinding<object, object, object, Record<string, never>>;

const nativeModelCommandRegistrars = new WeakMap<object, NativeModelCommandRegistrar>();

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
  readonly __status?: TStatus;
}

export type PromotedKubernetesResource<TSpec extends object, TStatus extends object = Record<string, never>> = ResourceDefinition<TSpec, TStatus> & {
  readonly $model: KubernetesApplicationModelFacet<TSpec, TStatus>;
  readonly [applicationModelFacet]: KubernetesApplicationModelFacet<TSpec, TStatus>;
};

/**
 * Promotes a native Drizzle table without wrapping or proxying it.
 *
 * The returned value is the original table by identity. A single non-enumerable
 * `$model` facet avoids changing Drizzle schema enumeration or colliding with
 * ordinary table APIs. A user column named `$model` is rejected before mutation.
 */
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
  if ('$model' in table) {
    throw new Error(`Drizzle table ${getTableName(table)} cannot be promoted because it already exposes a $model property or column. Rename that column or use the symbol-based getApplicationModelFacet(...) access path.`);
  }

  const tableConfig = getTableConfig(table);
  const identityFields = resolveIdentityFields(table, options.identity);
  if (identityFields.length !== 1) {
    throw new Error(`Drizzle table ${getTableName(table)} has composite identity [${identityFields.join(', ')}]. v0.6 requires an explicit canonical tuple codec before composite identities can be promoted.`);
  }
  const revisionField = resolveRevisionField(table, options.revision);
  const selectSchema = createSelectSchema(table) as Type<InferSelectModel<TTable>>;
  const insertSchema = createInsertSchema(table) as Type<InferInsertModel<TTable>>;
  const updateSchema = createUpdateSchema(table) as Type<Partial<InferInsertModel<TTable>>>;
  const name = options.name ?? getTableName(table);
  const identity: ApplicationModelIdentityContract = { fields: identityFields, encoding: 'scalar' };
  const relationships = Object.freeze(normalizeDrizzleModelRelationships(table, options.schema, name));
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

  Object.defineProperties(table, {
    [applicationModelFacet]: { value: facet, enumerable: false, configurable: false, writable: false },
    $model: { value: facet, enumerable: false, configurable: false, writable: false },
  });
  return table as PromotedDrizzleTable<TTable>;
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

export interface PromoteKubernetesResourceOptions {
  readonly name?: string;
  /**
   * Declares a provider-enforced namespace boundary. The model context reads the
   * Namespace and compares this label with the admitted trusted-context value.
   */
  readonly access?: { readonly context: string; readonly namespaceLabel: string };
}

// typecast-boundary: the resource definition owns the spec/status generics installed in its immutable common model facet.
export function promoteKubernetesResource<TSpec extends object, TStatus extends object>(resource: ResourceDefinition<TSpec, TStatus>, nameOrOptions: string | PromoteKubernetesResourceOptions = resource.kind): PromotedKubernetesResource<TSpec, TStatus> {
  const options = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
  const name = options.name ?? resource.kind;
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
    ref() {
      return decorateModelReference(arkType('string'), { target: name, identity, integrity: 'reconcile-checked' });
    },
  });
  Object.defineProperties(resource, {
    [applicationModelFacet]: { value: facet, enumerable: false, configurable: false, writable: false },
    $model: { value: facet, enumerable: false, configurable: false, writable: false },
  });
  return resource as PromotedKubernetesResource<TSpec, TStatus>;
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
  return Object.entries(tableEntry.relations).sort(([left], [right]) => left.localeCompare(right)).map(([name, relation]) => drizzleRelationshipContract(source, name, relation, extracted.tables, extracted.tableNamesMap));
}

function drizzleRelationshipContract(source: string, name: string, relation: Relation, tables: ReturnType<typeof extractTablesRelationalConfig>['tables'], tableNamesMap: Readonly<Record<string, string>>): ApplicationModelRelationshipContract {
  const normalized = normalizeRelation(tables, tableNamesMap, relation);
  const sourceColumns = getTableColumns(relation.sourceTable);
  const targetColumns = getTableColumns(relation.referencedTable);
  const fields = normalized.fields.map((column) => columnPropertyName(sourceColumns, column));
  const references = normalized.references.map((column) => columnPropertyName(targetColumns, column));
  return {
    source,
    name,
    target: relation.referencedTableName,
    cardinality: relation instanceof Many ? 'many' : 'one',
    integrity: relation instanceof One && relation.config ? 'foreign-key' : 'relation-only',
    fields,
    references,
  };
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

// Compile-time guard: relation schema inputs are native Drizzle objects, never serialized graph values.
export type DrizzleApplicationSchema = Readonly<Record<string, AnyPgTable | Relations | unknown>>;
