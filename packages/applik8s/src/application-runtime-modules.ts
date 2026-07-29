import type { ApplicationDurableStatusOwnershipContract, ApplicationRuntimeModuleKind } from '@applik8s/core';

import { applicationGeneratedJobAppStatusSchemaContract, applicationGeneratedStatusConcurrencyContract, applicationGeneratedStatusConfigMapContract, applicationGeneratedStatusObservabilityContract } from './application-jobs.js';
export { mergeGeneratedJobStatusConfigMapData, summarizeGeneratedJobStatusConfigMapMerge, type GeneratedJobStatusConfigMapDataMergeInput, type GeneratedJobStatusConfigMapDataMergeSummary } from './application-generated-job-status.js';
import { generatedRuntimeModuleBundle } from './application-runtime-module-bundle.js';
import { generatedRuntimeModuleApiVersion } from './application-runtime-module-manifest.js';
import { generatedRuntimeModuleSource, generatedRuntimeModuleSourcePreamble } from './application-runtime-module-sources.js';

export interface GeneratedApplicationStatusRuntimeTarget {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
}

export interface GeneratedJobStatusRuntimeJobTarget {
  readonly jobName: string;
  readonly jobKind: 'Job' | 'CronJob';
  readonly statusPath: string;
  readonly materialization: 'kubernetes-job' | 'kubernetes-cronjob';
}

export function generatedApplicationRuntimeModuleBundle(): Readonly<Record<string, string>> {
  return generatedRuntimeModuleBundle(generatedApplicationRuntimeModuleSource);
}

export function generatedJobStatusRuntimeBundle(targets: readonly GeneratedJobStatusRuntimeJobTarget[], appTarget?: GeneratedApplicationStatusRuntimeTarget, statusConfigMapName?: string): Readonly<Record<string, string>> {
  const firstTarget = targets[0];
  return {
    'runtime__job-runner.mjs': generatedJobRunnerRuntimeModuleSource(),
    'status-runtime.json': `${JSON.stringify({
      apiVersion: generatedRuntimeModuleApiVersion,
      kind: 'GeneratedJobStatusRuntime',
      entrypoint: 'runGeneratedJobStatusReconciler',
      ...(firstTarget ? { jobName: firstTarget.jobName, statusPath: firstTarget.statusPath, materialization: firstTarget.materialization } : {}),
      targets,
      ...(appTarget ? { target: appTarget } : {}),
      ...(statusConfigMapName ? { statusConfigMapName } : {}),
      ...(statusConfigMapName ? { statusProjection: 'kro' } : {}),
      statusOwnership: generatedJobRuntimeStatusOwnership(statusConfigMapName),
    }, null, 2)}\n`,
  };
}

function generatedJobRuntimeStatusOwnership(statusConfigMapName: string | undefined): ApplicationDurableStatusOwnershipContract {
  return {
    primary: 'applicationStatus',
    durableAuthority: 'generatedStatusConfigMap',
    releasePolicy: 'kroStatusProjectionRequired',
    applicationStatusProjection: 'requiredAuthoritative',
    appStatusSchema: 'required',
    appStatusSchemaContract: applicationGeneratedJobAppStatusSchemaContract(),
    ...(statusConfigMapName ? { durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: statusConfigMapName } } : {}),
    fallbackStore: applicationGeneratedStatusConfigMapContract(),
    concurrency: applicationGeneratedStatusConcurrencyContract(),
    observability: applicationGeneratedStatusObservabilityContract(),
    conflictPolicy: 'mergePatch',
    diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.generated-status-runtime' }, reason: 'KroStatusProjectionRequired', message: 'Generated job status requires KRO-owned status.applik8s.jobs hydration from the runtime-created status ConfigMap.', retryable: false }],
  };
}

export function generatedApplicationRuntimeModuleSource(kind: ApplicationRuntimeModuleKind): string {
  return generatedRuntimeModuleSource(kind, {
    modelRuntime: generatedPostgresModelRuntimeModuleSource,
    jobRunnerRuntime: generatedJobRunnerRuntimeModuleSource,
  });
}

function generatedPostgresModelRuntimeModuleSource(): string {
  return `import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

${generatedRuntimeModuleSourcePreamble('modelRuntime')}

export function createModelRuntime(options = {}) {
  return { runtimeModule, options, createPostgresModelClient };
}

const modelStoreConnections = new Map();
const modelStoreTables = new Map();

export function createPostgresModelClient(model, databaseOverride) {
  const client = {
    async create(input) {
      const table = modelTableFor(model);
      const object = modelObjectFromInput(input);
      try {
        await modelDatabaseForClient(model, databaseOverride).insert(table).values(modelRowFromObject(object));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return object;
    },
    async get(ref) {
      const table = modelTableFor(model);
      let rows;
      try {
        rows = await modelDatabaseForClient(model, databaseOverride).select().from(table).where(and(eq(table.id, ref.id), ...modelRetentionClauses(model))).limit(1);
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return rows[0] ? modelObjectFromRow(rows[0]) : undefined;
    },
    async query(query = {}) {
      return queryPostgresModel(model, query, {}, databaseOverride);
    },
    async patch(ref, patch) {
      const existing = await client.get(ref);
      if (!existing) {
        throw new Error('Model ' + model.name + ' object ' + ref.id + ' was not found.');
      }
      const next = {
        id: existing.id,
        spec: { ...existing.spec, ...(patch.spec || {}) },
        ...modelStatusPatch(existing.status, patch.status),
        revision: nextModelRevision(),
      };
      const table = modelTableFor(model);
      try {
        await modelDatabaseForClient(model, databaseOverride).update(table).set({ spec: next.spec, status: next.status ?? null, revision: next.revision ?? nextModelRevision(), updatedAt: new Date() }).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return next;
    },
    async delete(ref) {
      const table = modelTableFor(model);
      try {
        await modelDatabaseForClient(model, databaseOverride).delete(table).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
    },
    index(indexName, indexOptions = {}) {
      return {
        name: indexName,
        async query(partition, query = {}) {
          const declared = model.indexes?.find((index) => index.name === indexName);
          const partitionBy = indexOptions.partitionBy || declared?.fields?.[0];
          if (!partitionBy) {
            throw new Error('Model index ' + model.name + '.' + indexName + ' requires partitionBy before it can be queried.');
          }
          if (hasUnsupportedIndexFilter(indexOptions.filter) || hasUnsupportedIndexFilter(query.where)) {
            throw new Error('Model index ' + model.name + '.' + indexName + ' filter is not supported by the Postgres TransactionalDatabase runtime yet; unsupported index filters fail closed until filtered index semantics are implemented.');
          }
          const declaredOrderBy = indexOptions.orderBy || declared?.fields?.slice(1) || [];
          return queryPostgresModel(model, { ...query, where: { ...(query.where || {}), [partitionBy]: partition } }, { allowedOrderBy: declaredOrderBy, defaultOrderBy: declaredOrderBy }, databaseOverride);
        },
      };
    },
    async transaction(handler) {
      return modelDatabase(model).transaction(async (transaction) => handler(createPostgresModelClient(model, transaction)));
    },
  };
  return client;
}

function queryPostgresModel(model, query = {}, options = {}, databaseOverride) {
  const requestedOrderBy = query.orderBy || options.defaultOrderBy || [];
  if ((query.orderBy?.length ?? 0) > 0 && !options.allowedOrderBy) {
    throw new Error('Model ' + model.name + ' query orderBy is not supported by the Postgres TransactionalDatabase runtime yet; unsupported ordering fails closed until index/order semantics are implemented.');
  }
  validateModelOrderBy(model, requestedOrderBy, options.allowedOrderBy || []);
  validateModelWhere(model, query.where || {});
  const table = modelTableFor(model);
  const clauses = [...modelWhereClauses(table, query.where || {}), ...modelRetentionClauses(model)];
  const orderClauses = modelOrderClauses(model, requestedOrderBy);
  const offset = query.cursor ? Number(query.cursor) : 0;
  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 500));
  let builder = modelDatabaseForClient(model, databaseOverride).select().from(table).$dynamic();
  if (clauses.length > 0) {
    builder = builder.where(and(...clauses));
  }
  if (orderClauses.length > 0) {
    builder = builder.orderBy(...orderClauses);
  }
  return builder.limit(limit).offset(normalizedOffset)
    .then((rows) => {
      const items = rows.map(modelObjectFromRow);
      const nextCursor = items.length === limit ? String(normalizedOffset + items.length) : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    })
    .catch((error) => {
      throw modelStoreError(model, error);
    });
}

function modelDatabaseForClient(model, databaseOverride) {
  return databaseOverride || modelDatabase(model);
}

function modelDatabase(model) {
  const key = model.connectionEnvName;
  const existing = modelStoreConnections.get(key);
  if (existing) {
    return existing.db;
  }
  const url = process.env[key] || process.env.DATABASE_URL;
  if (!url) {
    throw modelStoreDiagnosticError({
      message: 'applik8s-modelstore-missing-credentials: TransactionalDatabase ' + model.name + ' requires database URL env ' + key + ' or DATABASE_URL.',
      statusCode: 500,
      diagnostic: { event: 'applik8s-modelstore-missing-credentials', model: model.name, env: key },
    });
  }
  const client = postgres(url, { max: 5 });
  const db = drizzle(client);
  modelStoreConnections.set(key, { client, db });
  return db;
}

function modelTableFor(model) {
  const key = model.connectionEnvName + ':' + model.tableName;
  const existing = modelStoreTables.get(key);
  if (existing) {
    return existing;
  }
  const table = pgTable(model.tableName, {
    id: text('id').primaryKey(),
    spec: jsonb('spec').notNull(),
    status: jsonb('status'),
    revision: text('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  });
  modelStoreTables.set(key, table);
  return table;
}

function modelWhereClauses(_table, where) {
  return Object.entries(where).map(([field, value]) => sql.raw('(' + quoteIdentifier('spec') + '->>' + quoteLiteral(field) + ') = ' + quoteLiteral(String(value))));
}

function modelRetentionClauses(model) {
  if (model.retention?.mode !== 'ttl') {
    return [];
  }
  const ttlSeconds = Math.max(1, Number(model.retention.ttlSeconds || 1));
  return [sql.raw(quoteIdentifier('created_at') + ' >= now() - (' + ttlSeconds + " * interval '1 second')")];
}

function validateModelWhere(model, where) {
  for (const [field, value] of Object.entries(where || {})) {
    if (!/^[A-Za-z0-9_]+$/.test(field) || value === null || typeof value === 'object') {
      throw new Error('Model ' + model.name + ' query filter ' + field + ' is not supported by the Postgres TransactionalDatabase runtime yet; unsupported filters fail closed until query semantics are implemented.');
    }
  }
}

function hasUnsupportedIndexFilter(filter) {
  return !!filter && typeof filter === 'object' && Object.keys(filter).length > 0;
}

function validateModelOrderBy(model, orderBy, allowedOrderBy) {
  for (const field of orderBy || []) {
    if (!/^[A-Za-z0-9_]+$/.test(field) || !allowedOrderBy.includes(field)) {
      throw new Error('Model ' + model.name + ' index query orderBy ' + field + ' is not part of the declared index orderBy fields; unsupported ordering fails closed.');
    }
  }
}

function modelOrderClauses(_model, orderBy) {
  return (orderBy || []).map((field) => sql.raw(modelOrderFieldSql(field) + ' ASC'));
}

function modelOrderFieldSql(field) {
  if (field === 'createdAt') {
    return quoteIdentifier('created_at');
  }
  if (field === 'updatedAt') {
    return quoteIdentifier('updated_at');
  }
  return '(' + quoteIdentifier('spec') + '->>' + quoteLiteral(field) + ')';
}

function modelStoreError(model, error) {
  const postgresError = modelPostgresError(error);
  if (postgresError?.code === '23505') {
    const constraint = postgresError.constraint || modelConstraintNameFromDetail(postgresError.detail) || modelDefaultUniqueConstraint(model);
    return modelStoreDiagnosticError({
      message: 'applik8s-model-duplicate-key: Model ' + model.name + ' violates unique constraint ' + constraint + '.',
      statusCode: 409,
      diagnostic: { event: 'applik8s-model-duplicate-key', model: model.name, constraint, postgresCode: '23505' },
      cause: error,
    });
  }
  if (postgresError?.code === '42P01') {
    return modelStoreDiagnosticError({
      message: 'applik8s-model-migration-missing: TransactionalDatabase table ' + model.tableName + ' is missing. Run generated migrations before serving model traffic.',
      statusCode: 500,
      diagnostic: { event: 'applik8s-model-migration-missing', model: model.name, table: model.tableName, postgresCode: '42P01' },
      cause: error,
    });
  }
  return error;
}

function modelPostgresError(error) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    if (typeof current.code === 'string') {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

function modelDefaultUniqueConstraint(model) {
  const constraints = (model.constraints || []).filter((constraint) => constraint.kind === 'unique');
  if (constraints.length === 1) {
    return constraints[0].name;
  }
  const indexes = (model.indexes || []).filter((index) => index.unique);
  if (indexes.length === 1) {
    return indexes[0].name;
  }
  return 'unique';
}

function modelConstraintNameFromDetail(detail) {
  if (typeof detail !== 'string') {
    return undefined;
  }
  const match = detail.match(/constraint "([^"]+)"/);
  return match?.[1];
}

function modelStoreDiagnosticError(options) {
  const error = new Error(options.message);
  error.statusCode = options.statusCode;
  error.diagnostic = options.diagnostic;
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
}

function modelObjectFromInput(input) {
  if (input && typeof input === 'object' && 'spec' in input) {
    return { id: input.id || nextModelId(), spec: input.spec || {}, revision: nextModelRevision() };
  }
  return { id: nextModelId(), spec: input || {}, revision: nextModelRevision() };
}

function modelRowFromObject(object) {
  return { id: object.id, spec: object.spec, status: object.status || null, revision: object.revision || nextModelRevision() };
}

function modelObjectFromRow(row) {
  return { id: row.id, spec: row.spec || {}, ...(row.status ? { status: row.status } : {}), revision: row.revision };
}

function modelStatusPatch(existingStatus, patchStatus) {
  if (existingStatus === undefined && patchStatus === undefined) {
    return {};
  }
  return { status: { ...(existingStatus || {}), ...(patchStatus || {}) } };
}

function nextModelId() {
  return globalThis.crypto?.randomUUID?.() || 'model-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function nextModelRevision() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function quoteLiteral(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}
`;
}

function generatedJobRunnerRuntimeModuleSource(): string {
  return `import { readFileSync } from 'node:fs';
import { request } from 'node:https';

${generatedRuntimeModuleSourcePreamble('jobRunnerRuntime')}
const statusStoreConcurrency = ${JSON.stringify(applicationGeneratedStatusConcurrencyContract())};

export function createJobStatusUpdater(options = {}) {
  const statusPath = options.statusPath || 'status.applik8s.jobs.unknown';
  const idempotency = options.idempotency || { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' };
  return {
    runtimeModule,
    statusPath,
    idempotency,
    statusFromJob(job = {}) {
      return generatedJobStatusFromResource(job, statusPath, idempotency);
    },
    patchStatus(resourceStatus) {
      return objectForStatusPath(statusPath, resourceStatus);
    },
  };
}

export function generatedJobStatusFromResource(resource = {}, statusPath = 'status.applik8s.jobs.unknown', idempotency = { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' }) {
  return resource.kind === 'CronJob' ? generatedJobStatusFromCronJob(resource, statusPath, idempotency) : generatedJobStatusFromJob(resource, statusPath, idempotency);
}

export function generatedJobStatusFromJob(job = {}, statusPath = 'status.applik8s.jobs.unknown', idempotency = { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' }) {
  const metadata = job.metadata || {};
  const status = job.status || {};
  const observedGeneration = Number(metadata.generation || status.observedGeneration || 0);
  const failed = Number(status.failed || 0);
  const succeeded = Number(status.succeeded || 0);
  const active = Number(status.active || 0);
  const phase = succeeded > 0 ? 'Complete' : failed > 0 ? 'Failed' : active > 0 ? 'Progressing' : 'Pending';
  return durableStatus(resourceName(metadata), phase, observedGeneration, jobIdempotencyKey(metadata, idempotency), failed, statusPath, jobReference(job));
}

export function generatedJobStatusFromCronJob(cronJob = {}, statusPath = 'status.applik8s.jobs.unknown', idempotency = { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' }) {
  const metadata = cronJob.metadata || {};
  const status = cronJob.status || {};
  const active = Array.isArray(status.active) ? status.active.length : 0;
  const observedGeneration = Number(metadata.generation || status.observedGeneration || 0);
  const phase = status.lastSuccessfulTime ? 'Complete' : active > 0 ? 'Progressing' : 'Pending';
  return durableStatus(resourceName(metadata), phase, observedGeneration, jobIdempotencyKey(metadata, idempotency), 0, statusPath, jobReference(cronJob));
}

export async function runGeneratedJobStatusReconciler(options = process.env) {
  const runtimeConfig = readRuntimeConfig(options);
  const workloadNamespace = options.APPLIK8S_NAMESPACE || defaultNamespace();
  const appTarget = runtimeConfig.target || {
    apiVersion: requireOption(options, 'APPLIK8S_APP_API_VERSION'),
    kind: requireOption(options, 'APPLIK8S_APP_KIND'),
    plural: requireOption(options, 'APPLIK8S_APP_PLURAL'),
  };
  const targets = runtimeTargets(runtimeConfig, options);
  const statusConfigMapName = runtimeConfig.statusConfigMapName || options.APPLIK8S_STATUS_CONFIG_MAP_NAME;
  const appName = options.APPLIK8S_APP_NAME;
  const appNamespace = options.APPLIK8S_APP_NAMESPACE || workloadNamespace;
  const intervalMs = Number(options.APPLIK8S_RECONCILE_INTERVAL_MS || 5000);
  let running = true;
  process.once('SIGTERM', () => { running = false; });
  process.once('SIGINT', () => { running = false; });
  while (running) {
    await reconcileGeneratedJobStatuses({ workloadNamespace, appNamespace, appTarget, appName, statusConfigMapName, statusProjection: runtimeConfig.statusProjection, targets });
    if (running) {
      await sleep(intervalMs);
    }
  }
}

async function reconcileGeneratedJobStatuses(options) {
  const statusPatch = {};
  for (const target of options.targets) {
    try {
      const resource = await readObservedJob(options.workloadNamespace, target.jobKind, target.jobName);
      const resourceStatus = generatedJobStatusFromResource(resource, target.statusPath);
      deepMerge(statusPatch, objectForStatusPath(target.statusPath, resourceStatus));
    } catch (error) {
      const diagnosticStatus = generatedMissingJobStatus(target, error);
      deepMerge(statusPatch, objectForStatusPath(target.statusPath, diagnosticStatus));
      console.error(JSON.stringify({ event: 'applik8s-job-status-reconciler-target-error', severity: 'error', job: target.jobName, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  if (Object.keys(statusPatch).length > 0) {
    if (options.statusConfigMapName) {
      await patchGeneratedStatusConfigMap(options.workloadNamespace, options.statusConfigMapName, statusPatch);
    }
    if (options.statusProjection === 'kro') {
      return;
    }
    let appName = options.appName;
    let appNamespace = options.appNamespace;
    if (!appName) {
      try {
        const discoveredApp = await discoverApplicationResourceIdentity(options.workloadNamespace, options.appTarget);
        appName = discoveredApp?.name;
        appNamespace = discoveredApp?.namespace || appNamespace;
      } catch (error) {
        console.error(JSON.stringify({ event: 'applik8s-job-status-reconciler-app-discovery-error', severity: 'warn', message: error instanceof Error ? error.message : String(error) }));
      }
    }
    if (appName) {
      try {
        await patchApplicationStatus(appNamespace, options.appTarget, appName, statusPatch);
      } catch (error) {
        console.error(JSON.stringify({ event: 'applik8s-job-status-reconciler-app-status-error', severity: 'warn', app: appName, message: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
}

function readRuntimeConfig(options) {
  if (options.APPLIK8S_STATUS_RUNTIME_CONFIG) {
    return JSON.parse(options.APPLIK8S_STATUS_RUNTIME_CONFIG);
  }
  try {
    return JSON.parse(readFileSync('/app/status-runtime.json', 'utf8'));
  } catch (_error) {
    return {};
  }
}

function runtimeTargets(runtimeConfig, options) {
  if (Array.isArray(runtimeConfig.targets) && runtimeConfig.targets.length > 0) {
    return runtimeConfig.targets.map((target) => ({
      jobName: String(target.jobName),
      jobKind: target.jobKind === 'CronJob' ? 'CronJob' : 'Job',
      statusPath: target.statusPath || 'status.applik8s.jobs.' + target.jobName,
      materialization: target.materialization || (target.jobKind === 'CronJob' ? 'kubernetes-cronjob' : 'kubernetes-job'),
    }));
  }
  const jobName = requireOption(options, 'APPLIK8S_JOB_NAME');
  const jobKind = options.APPLIK8S_JOB_KIND === 'CronJob' ? 'CronJob' : 'Job';
  return [{
    jobName,
    jobKind,
    statusPath: options.APPLIK8S_JOB_STATUS_PATH || 'status.applik8s.jobs.' + jobName,
    materialization: jobKind === 'CronJob' ? 'kubernetes-cronjob' : 'kubernetes-job',
  }];
}

async function readObservedJob(namespace, kind, name) {
  const plural = kind === 'CronJob' ? 'cronjobs' : 'jobs';
  return kubeRequest('GET', '/apis/batch/v1/namespaces/' + encodeURIComponent(namespace) + '/' + plural + '/' + encodeURIComponent(name));
}

async function patchApplicationStatus(namespace, target, name, statusPatch) {
  const path = apiPathFor(target.apiVersion, target.plural, namespace, name) + '/status';
  await kubeRequest('PATCH', path, { status: statusPatch }, { 'content-type': 'application/merge-patch+json' });
}

async function patchGeneratedStatusConfigMap(namespace, name, statusPatch) {
  const currentJobs = statusPatch?.applik8s?.jobs || {};
  for (let attempt = 1; attempt <= statusStoreConcurrency.maxAttempts; attempt += 1) {
    const existing = await readGeneratedStatusConfigMap(namespace, name);
    const observedAt = new Date().toISOString();
    const existingData = existing.data || {};
    const merged = mergeGeneratedJobStatusEntries(parseGeneratedStatusJobs(existingData), currentJobs, parseJsonObject(existingData['conflicts.json']), observedAt);
    const history = appendGeneratedJobHistory(parseJsonObject(existingData['history.json']), merged.acceptedJobs, observedAt);
    const mergeMetrics = generatedJobStatusMergeMetrics(merged, currentJobs, observedAt);
    try {
      const body = {
        ...(existing.resourceVersion ? { metadata: { resourceVersion: existing.resourceVersion } } : {}),
        data: {
          'status.json': JSON.stringify(statusPatchWithMergedGeneratedJobs(statusPatch, merged.jobs), null, 2),
          'applik8s-jobs.json': JSON.stringify(merged.jobs, null, 2),
          'history.json': JSON.stringify(history, null, 2),
          'conflicts.json': JSON.stringify(merged.conflicts, null, 2),
          updatedAt: observedAt,
        },
      };
      if (existing.missing) {
        await kubeRequest('POST', '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/configmaps', {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name, namespace, labels: { 'app.kubernetes.io/managed-by': 'applik8s', 'app.kubernetes.io/component': 'generated-job-status' } },
          ...body,
        });
      } else {
        await kubeRequest('PATCH', '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/configmaps/' + encodeURIComponent(name), body, { 'content-type': 'application/merge-patch+json' });
      }
      console.error(JSON.stringify({ event: 'applik8s-job-status-reconciler-status-store-merged', severity: 'info', configMap: name, ...mergeMetrics }));
      return;
    } catch (error) {
      if (isKubernetesConflict(error) && attempt === statusStoreConcurrency.maxAttempts) {
        console.error(JSON.stringify({ event: statusStoreConcurrency.retryExhaustedDiagnostic, severity: 'error', configMap: name, attempt, maxAttempts: statusStoreConcurrency.maxAttempts, message: error instanceof Error ? error.message : String(error) }));
      }
      if (!isKubernetesConflict(error) || attempt === statusStoreConcurrency.maxAttempts) {
        throw error;
      }
      console.error(JSON.stringify({ event: statusStoreConcurrency.retryDiagnostic, severity: 'warn', configMap: name, attempt, message: error instanceof Error ? error.message : String(error) }));
    }
  }
}

function statusPatchWithMergedGeneratedJobs(statusPatch, jobs) {
  const applik8s = statusPatch?.applik8s && typeof statusPatch.applik8s === 'object' && !Array.isArray(statusPatch.applik8s) ? statusPatch.applik8s : {};
  return { ...statusPatch, applik8s: { ...applik8s, jobs } };
}

async function readGeneratedStatusConfigMap(namespace, name) {
  try {
    const configMap = await kubeRequest('GET', '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/configmaps/' + encodeURIComponent(name));
    return {
      data: configMap && configMap.data && typeof configMap.data === 'object' ? configMap.data : {},
      resourceVersion: configMap?.metadata?.resourceVersion,
    };
  } catch (error) {
    const missing = error instanceof Error && error.message.includes('HTTP 404');
    console.error(JSON.stringify({ event: 'applik8s-job-status-reconciler-status-store-read-error', severity: missing ? 'info' : 'warn', configMap: name, missing, message: error instanceof Error ? error.message : String(error) }));
    return { data: {}, resourceVersion: undefined, missing };
  }
}

function isKubernetesConflict(error) {
  return error instanceof Error && error.message.includes('HTTP 409');
}

function appendGeneratedJobHistory(existingHistory, currentJobs, observedAt = new Date().toISOString()) {
  const nextHistory = { ...existingHistory };
  for (const [jobName, status] of Object.entries(currentJobs)) {
    const entries = Array.isArray(nextHistory[jobName]) ? nextHistory[jobName] : [];
    const entry = generatedJobHistoryEntry(status, observedAt);
    const previous = entries[entries.length - 1];
    nextHistory[jobName] = shouldAppendGeneratedJobHistoryEntry(previous, entry)
      ? [...entries, entry].slice(-20)
      : [...entries.slice(0, -1), { ...entry, observedAt }].slice(-20);
  }
  return nextHistory;
}

function generatedJobHistoryEntry(status, observedAt) {
  return {
    observedAt,
    phase: status?.phase || 'Unknown',
    observedGeneration: Number(status?.observedGeneration || 0),
    idempotencyKey: String(status?.idempotencyKey || 'unknown'),
    retryCount: Number(status?.retryCount || 0),
  };
}

function shouldAppendGeneratedJobHistoryEntry(previous, entry) {
  return !previous || previous.phase !== entry.phase || previous.observedGeneration !== entry.observedGeneration || previous.idempotencyKey !== entry.idempotencyKey || previous.retryCount !== entry.retryCount;
}

function mergeGeneratedJobStatusEntries(existingJobs, currentJobs, existingConflicts, observedAt) {
  const jobs = { ...existingJobs };
  const acceptedJobs = {};
  const conflicts = { ...existingConflicts };
  for (const [jobName, status] of Object.entries(currentJobs)) {
    const existing = jobs[jobName];
    if (shouldRetainCompletedGeneratedJobStatus(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntry(existing, observedAt), rejected: generatedJobHistoryEntry(status, observedAt), reason: 'CompletedIdempotencyKeyRetained' }].slice(-20);
      continue;
    }
    if (isStaleGeneratedJobStatus(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntry(existing, observedAt), rejected: generatedJobHistoryEntry(status, observedAt), reason: 'StaleObservedGeneration' }].slice(-20);
      continue;
    }
    if (isConcurrentGeneratedJobObservation(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntry(existing, observedAt), accepted: generatedJobHistoryEntry(status, observedAt), reason: 'ConcurrentObservationAccepted' }].slice(-20);
    }
    jobs[jobName] = status;
    acceptedJobs[jobName] = status;
  }
  return { jobs, acceptedJobs, conflicts };
}

function generatedJobStatusMergeMetrics(merged, currentJobs, observedAt) {
  let rejectedUpdates = 0;
  let conflictUpdates = 0;
  for (const entries of Object.values(merged.conflicts || {})) {
    for (const entry of generatedJobConflictEntries(entries)) {
      if (entry?.observedAt !== observedAt) {
        continue;
      }
      if (entry.rejected) {
        rejectedUpdates += 1;
      }
      if (entry.accepted) {
        conflictUpdates += 1;
      }
    }
  }
  return {
    observedJobs: Object.keys(currentJobs || {}).length,
    retainedJobs: Object.keys(merged.jobs || {}).length,
    acceptedUpdates: Object.keys(merged.acceptedJobs || {}).length,
    rejectedUpdates,
    conflictUpdates,
  };
}

function isStaleGeneratedJobStatus(existing, incoming) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  const existingGeneration = Number(existing.observedGeneration || 0);
  const incomingGeneration = Number(incoming.observedGeneration || 0);
  return incomingGeneration > 0 && existingGeneration > incomingGeneration;
}

function shouldRetainCompletedGeneratedJobStatus(existing, incoming) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  return existing.phase === 'Complete' && incoming.phase !== 'Complete' && String(existing.idempotencyKey || '') === String(incoming.idempotencyKey || '');
}

function isConcurrentGeneratedJobObservation(existing, incoming) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  const existingGeneration = Number(existing.observedGeneration || 0);
  const incomingGeneration = Number(incoming.observedGeneration || 0);
  const existingIdempotency = String(existing.idempotencyKey || '');
  const incomingIdempotency = String(incoming.idempotencyKey || '');
  return existingGeneration > 0 && existingGeneration === incomingGeneration && existingIdempotency !== '' && incomingIdempotency !== '' && existingIdempotency !== incomingIdempotency;
}

function generatedJobConflictEntries(value) {
  return Array.isArray(value) ? value : [];
}

function parseGeneratedStatusJobs(existingData) {
  const jobs = parseJsonObject(existingData['applik8s-jobs.json']);
  if (Object.keys(jobs).length > 0) {
    return jobs;
  }
  const status = parseJsonObject(existingData['status.json']);
  const statusJobs = status?.applik8s?.jobs;
  return statusJobs && typeof statusJobs === 'object' && !Array.isArray(statusJobs) ? { ...statusJobs } : {};
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

async function discoverApplicationResourceIdentity(namespace, target) {
  const ownerIdentity = await discoverApplicationResourceIdentityFromOwnerReferences(namespace, target);
  if (ownerIdentity) {
    return ownerIdentity;
  }
  const list = await kubeRequest('GET', apiCollectionPathFor(target.apiVersion, target.plural, namespace));
  const items = Array.isArray(list.items) ? list.items : [];
  if (items.length === 1 && items[0]?.metadata?.name) {
    return { name: String(items[0].metadata.name), namespace };
  }
  throw new Error('Unable to discover owning application resource for ' + target.apiVersion + '/' + target.kind + '. Set APPLIK8S_APP_NAME explicitly.');
}

async function discoverApplicationResourceIdentityFromOwnerReferences(namespace, target) {
  const podName = process.env.HOSTNAME;
  if (!podName) {
    return undefined;
  }
  try {
    const pod = await kubeRequest('GET', '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/pods/' + encodeURIComponent(podName));
    const replicaSetRef = ownerReference(pod, 'ReplicaSet', 'apps/v1');
    if (!replicaSetRef) {
      return undefined;
    }
    const replicaSet = await kubeRequest('GET', '/apis/apps/v1/namespaces/' + encodeURIComponent(namespace) + '/replicasets/' + encodeURIComponent(replicaSetRef.name));
    const deploymentRef = ownerReference(replicaSet, 'Deployment', 'apps/v1');
    if (!deploymentRef) {
      return undefined;
    }
    const deployment = await kubeRequest('GET', '/apis/apps/v1/namespaces/' + encodeURIComponent(namespace) + '/deployments/' + encodeURIComponent(deploymentRef.name));
    const appRef = ownerReference(deployment, target.kind, target.apiVersion);
    if (appRef?.name) {
      return { name: String(appRef.name), namespace };
    }
    const metadata = deployment.metadata || {};
    const labels = metadata.labels || {};
    const annotations = metadata.annotations || {};
    const kroInstanceName = labels['kro.run/instance-name'] || annotations['kro.run/instance-name'];
    if (kroInstanceName) {
      return { name: String(kroInstanceName), namespace: String(labels['kro.run/instance-namespace'] || annotations['kro.run/instance-namespace'] || namespace) };
    }
    return undefined;
  } catch (_error) {
    return undefined;
  }
}

function ownerReference(resource, kind, apiVersion) {
  const refs = resource && resource.metadata && Array.isArray(resource.metadata.ownerReferences) ? resource.metadata.ownerReferences : [];
  return refs.find((ref) => ref && ref.kind === kind && ref.apiVersion === apiVersion);
}

async function kubeRequest(method, path, body, headers = {}) {
  const token = readServiceAccountFile('token').trim();
  const ca = readServiceAccountFile('ca.crt');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await httpsRequest({
    hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
    port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
    path,
    method,
    ca,
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      ...headers,
    },
  }, payload);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(method + ' ' + path + ' failed with HTTP ' + response.statusCode + ': ' + response.body);
  }
  return response.body ? JSON.parse(response.body) : {};
}

function httpsRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(Number(process.env.APPLIK8S_KUBE_REQUEST_TIMEOUT_MS || 10000), () => {
      req.destroy(new Error(options.method + ' ' + options.path + ' timed out'));
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function readServiceAccountFile(name) {
  return readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/' + name, 'utf8');
}

function defaultNamespace() {
  try {
    return readServiceAccountFile('namespace').trim() || 'default';
  } catch (_error) {
    return 'default';
  }
}

function apiPathFor(apiVersion, plural, namespace, name) {
  return apiCollectionPathFor(apiVersion, plural, namespace) + '/' + encodeURIComponent(name);
}

function apiCollectionPathFor(apiVersion, plural, namespace) {
  if (apiVersion === 'v1') {
    return '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(plural);
  }
  const parts = apiVersion.split('/');
  const group = parts[0];
  const version = parts[1] || 'v1';
  return '/apis/' + encodeURIComponent(group) + '/' + encodeURIComponent(version) + '/namespaces/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(plural);
}

function objectForStatusPath(statusPath, value) {
  const segments = statusPath.split('.').filter(Boolean);
  const statusSegments = segments[0] === 'status' ? segments.slice(1) : segments;
  let output = value;
  for (let index = statusSegments.length - 1; index >= 0; index -= 1) {
    output = { [statusSegments[index]]: output };
  }
  return output;
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function generatedMissingJobStatus(target, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    phase: 'Pending',
    observedGeneration: 0,
    currentStep: 'waiting-for-controller',
    idempotencyKey: target.jobName,
    retryCount: 0,
    conditions: [{ type: 'Blocked', status: 'True', reason: 'GeneratedJobUnavailable', message, observedGeneration: 0 }],
    statusPath: target.statusPath,
  };
}

function durableStatus(jobName, phase, observedGeneration, idempotencyKey, retryCount, statusPath, ref) {
  return {
    phase,
    observedGeneration,
    currentStep: phase === 'Pending' ? 'waiting-for-controller' : phase === 'Progressing' ? 'running' : undefined,
    lastSuccessfulStep: phase === 'Complete' ? 'runJob' : undefined,
    idempotencyKey,
    retryCount,
    terminalFailure: phase === 'Failed' ? { reason: 'GeneratedJobFailed', message: 'Generated job ' + jobName + ' reached a terminal failure.', failedStep: 'runJob', partialEffects: [{ operation: 'runJob', ref, status: 'visible' }] } : undefined,
    conditions: [jobCondition(phase, observedGeneration)],
    statusPath,
  };
}

function jobIdempotencyKey(metadata, idempotency) {
  if (idempotency.keySource === 'metadata.uid') {
    return String(metadata.uid || metadata.name || 'unknown');
  }
  return String(metadata.generation || metadata.resourceVersion || metadata.name || 'unknown');
}

function resourceName(metadata) {
  return String(metadata.name || 'unknown');
}

function jobReference(job) {
  const metadata = job.metadata || {};
  return { apiVersion: job.apiVersion || 'batch/v1', kind: job.kind || 'Job', name: metadata.name || 'unknown', namespace: metadata.namespace };
}

function jobCondition(phase, observedGeneration) {
  if (phase === 'Complete') {
    return { type: 'Ready', status: 'True', reason: 'GeneratedJobComplete', message: 'Generated job completed successfully.', observedGeneration };
  }
  if (phase === 'Failed') {
    return { type: 'Failed', status: 'True', reason: 'GeneratedJobFailed', message: 'Generated job failed.', observedGeneration };
  }
  if (phase === 'Progressing') {
    return { type: 'Progressing', status: 'True', reason: 'GeneratedJobRunning', message: 'Generated job is running.', observedGeneration };
  }
  return { type: 'Progressing', status: 'False', reason: 'GeneratedJobPending', message: 'Generated job is waiting for the Kubernetes job controller.', observedGeneration };
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) {
    throw new Error(name + ' is required for the generated job status reconciler.');
  }
  return String(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && (process.argv[1].endsWith('runtime__job-runner.mjs') || process.argv[1].endsWith('job-runner.mjs'))) {
  runGeneratedJobStatusReconciler().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
`;
}
