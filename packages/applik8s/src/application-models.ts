import { createHash } from 'node:crypto';
import type { ApplicationMigrationContract, ApplicationModelConstraint, ApplicationModelIndex, ApplicationModelStoreGuaranteesContract, ApplicationModelStoreSemanticsContract, ApplicationProviderInterfaceContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef, ApplicationRetentionPolicy } from '@applik8s/core';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement, type ApplicationGraphState } from './application-graph-state.js';
import { applicationModelStoreImplementation, applicationProviderImplementationName, applicationProviderInterface } from './application-providers.js';
import type { ApplicationModelStoreProvider, ApplicationProviderBinding, ApplicationProviderState } from './application-providers.js';
import type { EntityDefinition } from './dsl.js';
import { applicationGeneratedJobDurableStatus, applicationGeneratedJobPhase, applicationGeneratedJobRetry, applicationGeneratedJobRuntime, applicationGeneratedJobStatusLifecycle, applicationGeneratedJobStatusUpdater } from './application-jobs.js';
import { createPostgresModelClient } from './model-store-postgres-runtime.js';

export interface ApplicationModelOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly name?: string;
  readonly store?: ApplicationModelStoreProvider | ApplicationProviderBinding<ApplicationModelStoreProvider>;
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
  create(input: ApplicationModelCreateInput<TSpec>): Promise<ApplicationModelObject<TSpec, TStatus>>;
  get(ref: ApplicationModelRef): Promise<ApplicationModelObject<TSpec, TStatus> | undefined>;
  query(options?: ApplicationModelQueryOptions<TSpec>): Promise<ApplicationModelQueryPage<TSpec, TStatus>>;
  patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<TSpec, TStatus>): Promise<ApplicationModelObject<TSpec, TStatus>>;
  delete(ref: ApplicationModelRef): Promise<void>;
  index(name: string, options: ApplicationModelIndexOptions<TSpec, TStatus>): ApplicationModelIndexBinding<TSpec, TStatus>;
  readonly on: ApplicationModelEventRegistrar<TSpec, TStatus>;
}

export interface ApplicationRuntimeModelContract {
  readonly name: string;
  readonly tableName: string;
  readonly provider: 'postgres';
  readonly database: string;
  readonly clusterName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly connectionEnvName: string;
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
}

export interface ApplicationModelBackendContract {
  readonly interface: 'ModelStore';
  readonly provider?: ApplicationProviderBinding<ApplicationModelStoreProvider>;
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

interface ApplicationModelGraphState extends ApplicationGraphState, ApplicationProviderState {}

export function resolveApplicationModelStore(state: ApplicationModelGraphState, entityName: string, store: ApplicationModelOptions['store']): ApplicationModelStoreProvider {
  const implementation = applicationModelStoreImplementation(store) ?? applicationModelStoreImplementation(state.providers.models) ?? applicationModelStoreImplementation(state.defaults.models);
  if (!implementation) {
    throw new Error(`app.model(${JSON.stringify(entityName)}) requires a typed ModelStore provider. Bind one with app.provide(ModelStore, { kind: "postgres", ... }), app.defaults({ models: provider }), or pass { store: provider } before enabling a model-backed entity.`);
  }
  return implementation;
}

export function recordApplicationModelGraph<TSpec extends object, TStatus extends object>(state: ApplicationModelGraphState, entity: EntityDefinition<TSpec, TStatus>, provider: ApplicationModelStoreProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined): void {
  const modelName = options?.name ?? entity.name;
  const nodeId = applicationGraphNodeId('model', modelName);
  const providerNodeId = applicationProviderNodeId('ModelStore');
  const providerResources = applicationModelStoreProviderResources(provider, modelName);
  const migration = provider.migrations ?? { strategy: 'none', compatibility: 'schemaCompatibleOnly' };
  const schema = options?.schema;
  recordApplicationProviderGraph(state, 'ModelStore', 'modelStore', provider);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'model',
    name: modelName,
    stability: 'experimental',
    entity: { name: entity.name },
    store: { interface: 'ModelStore', nodeId: providerNodeId },
    schema: {
      identity: applicationModelIdentity(schema),
      constraints: applicationModelStoreConstraints(schema),
      indexes: applicationModelStoreIndexes(schema),
      migrations: { strategy: migration.strategy, compatibility: migration.compatibility },
      transactions: schema?.transactions ?? 'supported',
      retention: schema?.retention ?? { mode: 'retain' },
      guarantees: applicationModelStoreGuarantees(schema, migration),
    },
    materialization: {
      mode: 'providerBacked',
      provider: { interface: 'ModelStore', nodeId: providerNodeId },
      backingResources: providerResources,
      connection: applicationModelStoreRuntime(provider, modelName, providerResources),
      runtimeBoundary: applicationModelRuntimeBoundary(),
      reconciliation: { ownership: provider.provision === false ? 'external' : 'application', schemaDrift: migration.strategy === 'generatedJob' ? 'generatedMigrationJob' : 'failClosed', deletionPolicy: 'retain' },
    },
    generatedResources: providerResources.map((resource) => ({
      role: 'providerDependency',
      graphNode: { nodeId },
      resource,
      artifact: { kind: 'providerContract', name: `${modelName}-model-store` },
      dependsOn: [{ nodeId: providerNodeId }],
    })),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  const requirementId = applicationModelStoreRequirementId(modelName);
  addApplicationProviderRequirement(state, {
    id: requirementId,
    interface: 'ModelStore',
    consumer: { nodeId },
    provider: { interface: 'ModelStore', nodeId: providerNodeId },
    required: true,
    purpose: 'modelStore',
    diagnostics: {
      missing: `Model ${modelName} requires a ModelStore provider. Bind one with app.provide(ModelStore, { kind: "postgres", ... }) or pass an explicit store.`,
      ambiguous: `Model ${modelName} has multiple ModelStore providers. Bind the model to one provider explicitly.`,
    },
  });
  addApplicationProviderBinding(state, {
    requirement: requirementId,
    provider: { interface: 'ModelStore', nodeId: providerNodeId },
    generatedResources: providerResources,
    runtime: applicationModelStoreRuntime(provider, modelName, providerResources),
    metadataLinks: [{ graphNode: { nodeId: providerNodeId }, artifact: { kind: 'providerContract', name: `${modelName}-model-store` }, purpose: 'providerDependency' }],
  });
  if (migration.strategy === 'generatedJob') {
    recordApplicationModelMigrationJobGraph(state, modelName, nodeId, provider, providerResources);
  }
}

function applicationModelStoreGuarantees<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined, migration: ApplicationMigrationContract): ApplicationModelStoreGuaranteesContract {
  return {
    identity: 'stableId',
    uniqueness: 'databaseConstraint',
    indexes: 'declaredSecondaryIndexes',
    transactions: schema?.transactions ?? 'supported',
    retention: schema?.retention?.mode === 'ttl' ? 'ttl' : schema?.retention?.mode === 'deleteWithOwner' ? 'deleteWithApplication' : 'retain',
    migrationOwnership: migration.strategy === 'generatedJob' ? 'generatedJob' : migration.strategy === 'external' ? 'external' : 'none',
    semantics: applicationModelStoreSemantics(schema),
  };
}

function applicationModelStoreSemantics<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): ApplicationModelStoreSemanticsContract {
  const retentionMode = schema?.retention?.mode === 'ttl' ? 'ttl' : schema?.retention?.mode === 'deleteWithOwner' ? 'deleteWithApplication' : 'retain';
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    retention: {
      mode: retentionMode,
      ...(schema?.retention?.mode === 'ttl' ? { ttlSeconds: schema.retention.ttlSeconds } : {}),
      deletionPolicy: schema?.retention?.mode === 'deleteWithOwner' ? 'ownerDeletion' : 'explicitOnly',
    },
  };
}

export interface ApplicationModelRuntimeBinding {
  readonly kind: 'applicationModel';
  readonly name: string;
  readonly runtime: ApplicationRuntimeModelContract;
}

export function applicationModelBinding<TSpec extends object, TStatus extends object>(entity: EntityDefinition<TSpec, TStatus>, _provider: ApplicationModelStoreProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined, runtime: ApplicationRuntimeModelContract): ApplicationModelBinding<TSpec, TStatus> {
  const name = options?.name ?? entity.name;
  const scriptClient = () => createPostgresModelClient<TSpec, TStatus>(runtime);
  return {
    kind: 'applicationModel',
    name,
    entity,
    runtime,
    backend: {
      interface: 'ModelStore',
      runtimeBoundary: applicationModelRuntimeBoundary(),
      transactions: 'supported',
      queryConsistency: 'providerDefined',
      eventSemantics: 'unsupported',
      limitations: ['model CRUD/query calls inside serialized generated callbacks lower to generated runtime clients; ordinary script execution uses the same Postgres ModelStore runtime and requires database credentials plus generated migrations'],
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
    on: {
      created: () => applicationModelRuntimeEvent(name, 'created'),
      updated: () => applicationModelRuntimeEvent(name, 'updated'),
      deleted: () => applicationModelRuntimeEvent(name, 'deleted'),
    },
  };
}

export function applicationRuntimeModelContract<TSpec extends object, TStatus extends object>(entity: EntityDefinition<TSpec, TStatus>, provider: ApplicationModelStoreProvider, options: ApplicationModelOptions<TSpec, TStatus> | undefined): ApplicationRuntimeModelContract {
  const name = options?.name ?? entity.name;
  const modelSegment = kubernetesNameSegment(name);
  const resources = applicationModelStoreProviderResources(provider, name);
  const cluster = resources[0];
  const clusterName = provider.name ?? cluster?.name ?? `${modelSegment}-db`;
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return {
    name,
    tableName: `applik8s_${modelSegment.replace(/[^a-z0-9]+/g, '_')}`,
    provider: 'postgres',
    database: provider.database ?? modelSegment,
    clusterName,
    secretName: secret.name ?? `${clusterName}-app`,
    secretKey: provider.connectionSecretKey ?? 'uri',
    ...(secret.namespace ?? provider.namespace ? { secretNamespace: secret.namespace ?? provider.namespace } : {}),
    connectionEnvName: `APPLIK8S_MODEL_STORE_${modelSegment.replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_DATABASE_URL`,
    constraints: applicationModelStoreConstraints(options?.schema),
    indexes: applicationModelStoreIndexes(options?.schema),
  };
}

export function applicationModelMigrationSql(model: ApplicationRuntimeModelContract): string {
  const migrationPlan = applicationModelMigrationPlan(model);
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${quoteSqlIdentifier('applik8s_model_migrations')} (\n  id text PRIMARY KEY,\n  model text NOT NULL,\n  revision text NOT NULL,\n  plan jsonb NOT NULL,\n  applied_at timestamptz NOT NULL DEFAULT now()\n);`,
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
  const indexChecks = [...model.constraints.filter((constraint) => constraint.kind === 'unique').map((constraint) => ({ name: constraint.name, fields: constraint.fields, unique: true })), ...model.indexes].map((index) => `
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${quoteSqlLiteral(index.name)} AND tablename <> ${quoteSqlLiteral(model.tableName)}) THEN
    RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleIndex index % exists on a different table', ${quoteSqlLiteral(index.name)};
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${quoteSqlLiteral(index.name)} AND tablename = ${quoteSqlLiteral(model.tableName)} AND indexdef NOT ILIKE ${quoteSqlLiteral(`%${index.fields[0] ?? index.name}%`)}) THEN
    RAISE EXCEPTION 'applik8s-model-migration-drift-detected: incompatibleIndex index % does not match generated model schema', ${quoteSqlLiteral(index.name)};
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
  unknown_column text;
BEGIN
  SELECT to_regclass(${quoteSqlLiteral(`public.${model.tableName}`)}) IS NOT NULL INTO model_table_exists;
  SELECT to_regclass(${quoteSqlLiteral('public.applik8s_model_migrations')}) IS NOT NULL INTO history_table_exists;

  IF model_table_exists AND NOT history_table_exists THEN
    RAISE EXCEPTION 'applik8s-model-migration-drift-detected: missingHistoryTable existing model table % has no applik8s_model_migrations history table', ${quoteSqlLiteral(model.tableName)};
  END IF;

  IF history_table_exists THEN
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

function quoteSqlIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function applicationModelStoreRequirementId(modelName: string): string {
  return `requirement.${applicationGraphNodeId('model', modelName)}.store`;
}

function applicationModelStoreProviderResources(provider: ApplicationModelStoreProvider, modelName: string): readonly ApplicationResourceRef[] {
  if (provider.cluster) {
    return [provider.cluster];
  }
  const clusterName = provider.name ?? `${kubernetesNameSegment(modelName)}-db`;
  return [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(provider.namespace ? { namespace: provider.namespace } : {}) }];
}

function applicationModelStoreRuntime(provider: ApplicationModelStoreProvider, modelName: string, resources: readonly ApplicationResourceRef[]): ApplicationProviderRuntimeContract {
  const cluster = resources[0];
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${cluster?.name ?? kubernetesNameSegment(modelName)}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return {
    ...(provider.runtime ?? {}),
    env: { DATABASE_URL_SECRET: secret.name ?? `${kubernetesNameSegment(modelName)}-db-app`, ...(provider.runtime?.env ?? {}) },
    secretRefs: uniqueApplicationResourceRefs([secret, ...(provider.runtime?.secretRefs ?? [])]),
    readiness: provider.runtime?.readiness ?? {
      dependencies: resources,
      condition: provider.readiness?.condition ?? 'Ready',
      timeoutSeconds: provider.readiness?.timeoutSeconds ?? 300,
    },
  };
}

function applicationModelIdentity<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly string[] {
  return schema?.identity?.map(String) ?? ['id'];
}

function applicationModelStoreConstraints<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly ApplicationModelConstraint[] {
  return (schema?.constraints ?? []).map((constraint) => ({
    name: constraint.name,
    kind: constraint.kind,
    fields: constraint.fields.map(String),
  }));
}

function applicationModelStoreIndexes<TSpec extends object, TStatus extends object>(schema: ApplicationModelSchemaOptions<TSpec, TStatus> | undefined): readonly ApplicationModelIndex[] {
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

function recordApplicationModelMigrationJobGraph(state: ApplicationGraphState, modelName: string, modelNodeId: string, provider: ApplicationModelStoreProvider, resources: readonly ApplicationResourceRef[]): void {
  const jobName = provider.migrations?.jobName ?? `${kubernetesNameSegment(modelName)}-migration`;
  const nodeId = applicationGraphNodeId('job', jobName);
  const jobResource = { apiVersion: 'batch/v1', kind: 'Job', name: jobName, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  const statusTarget = { resource: resources[0] ?? { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster' }, statusPath: `status.applik8s.jobs.${jobName}` };
  const statusShape = applicationGeneratedJobDurableStatus({ jobName, idempotencyKey: 'metadata.generation', currentStep: 'provider-readiness' });
  const durableStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName,
    observes: [jobResource],
    writes: statusTarget,
    statusShape,
  });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: jobName,
    stability: 'experimental',
    task: { taskKind: 'migration' },
    phase: applicationGeneratedJobPhase(),
    resources,
    retry: applicationGeneratedJobRetry(),
    runtime: applicationGeneratedJobRuntime({
      materialization: 'kubernetes-job',
      statusResource: statusTarget.resource,
      statusPath: statusTarget.statusPath,
      permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
      environment: applicationModelStoreRuntime(provider, modelName, resources),
      durableStatusUpdater,
      statusLifecycle: applicationGeneratedJobStatusLifecycle({ jobName, materialization: 'kubernetes-job' }),
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

function recordApplicationProviderGraph(state: ApplicationGraphState, tokenName: string | undefined, bindingKind: string, implementation: unknown): void {
  const providerInterface = applicationProviderInterface(tokenName);
  if (!providerInterface) {
    return;
  }
  const nodeId = applicationProviderNodeId(providerInterface);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'provider',
    name: providerInterface,
    stability: 'experimental',
    interface: providerInterface,
    implementation: applicationProviderImplementationName(implementation),
    contract: applicationProviderInterfaceContract(providerInterface, implementation),
    config: { bindingKind, provider: applicationProviderImplementationName(implementation) },
  });
}

function applicationProviderInterfaceContract(providerInterface: ApplicationProviderInterfaceKind, implementation: unknown): ApplicationProviderInterfaceContract {
  const implemented = providerInterface === 'ModelStore' && applicationProviderImplementationName(implementation) === 'postgres';
  return {
    interface: providerInterface,
    surface: 'stablePublicApi',
    support: implemented ? 'implemented' : 'failClosedReserved',
    diagnostics: implemented ? [] : [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: applicationProviderNodeId(providerInterface) }, reason: 'ProviderInterfaceReserved', message: `${providerInterface} is reserved as a stable v0.3 provider interface but no generated provider adapter is enabled for this binding.`, retryable: false }],
  };
}

function applicationProviderNodeId(providerInterface: ApplicationProviderInterfaceKind): string {
  return applicationGraphNodeId('provider', providerInterface);
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
    byKey.set(`${ref.apiVersion}:${ref.kind}:${ref.namespace ?? ''}:${ref.name ?? ''}`, ref);
  }
  return [...byKey.values()];
}

function applicationModelRuntimeBoundary(): ApplicationModelBackendContract['runtimeBoundary'] {
  return {
    serializedCallbacks: 'generatedRuntimeClient',
    scriptExecution: 'scriptRuntimeClient',
  };
}

function applicationModelRuntimeEvent(modelName: string, event: 'created' | 'updated' | 'deleted'): ApplicationModelEventBinding {
  throw new Error(`app.model(${JSON.stringify(modelName)}).on.${event}(...) requires generated ModelStore event semantics, which are not enabled in this v0.3 graph-authoring slice.`);
}
