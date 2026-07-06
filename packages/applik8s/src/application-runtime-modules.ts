import type { ApplicationRuntimeModuleExportContract, ApplicationRuntimeModuleInterfaceContract, ApplicationRuntimeModuleKind, ApplicationRuntimeModuleRef } from '@applik8s/core';

export const generatedRuntimeModuleApiVersion = 'applik8s.runtime/v1alpha1';

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
  return {
    'runtime/server.mjs': generatedApplicationRuntimeModuleSource('serverRuntime'),
    'runtime/model-store-postgres.mjs': generatedApplicationRuntimeModuleSource('modelRuntime'),
    'runtime/job-runner.mjs': generatedApplicationRuntimeModuleSource('jobRunnerRuntime'),
    'runtime/kubernetes-client.mjs': generatedApplicationRuntimeModuleSource('kubernetesClient'),
    'runtime/diagnostics.mjs': generatedApplicationRuntimeModuleSource('diagnostics'),
    'runtime/providers/postgres.mjs': generatedApplicationRuntimeModuleSource('providerAdapter'),
  };
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
    }, null, 2)}\n`,
  };
}

export function generatedApplicationRuntimeModuleSource(kind: ApplicationRuntimeModuleKind): string {
  if (kind === 'jobRunnerRuntime') {
    return generatedJobRunnerRuntimeModuleSource();
  }
  if (kind === 'modelRuntime') {
    return generatedPostgresModelRuntimeModuleSource();
  }
  const entrypoint = runtimeModuleEntrypoint(kind);
  const moduleExports = [{ name: entrypoint, kind: 'function', stability: 'stable' }] satisfies readonly ApplicationRuntimeModuleExportContract[];
  return `export const runtimeModule = ${JSON.stringify({ apiVersion: generatedRuntimeModuleApiVersion, kind, entrypoint, exports: [entrypoint], interface: runtimeModuleInterface([], moduleExports, kind === 'diagnostics' ? 'notApplicable' : 'required') })};\nexport function ${entrypoint}(options = {}) {\n  return { runtimeModule, options };\n}\n`;
}

function generatedPostgresModelRuntimeModuleSource(): string {
  return `import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

export const runtimeModule = ${JSON.stringify({ apiVersion: generatedRuntimeModuleApiVersion, kind: 'modelRuntime', entrypoint: 'createModelRuntime', exports: ['createModelRuntime', 'createPostgresModelClient'], interface: runtimeModuleInterface([{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }, { name: 'createPostgresModelClient', kind: 'function', stability: 'stable' }], 'required') })};

export function createModelRuntime(options = {}) {
  return { runtimeModule, options, createPostgresModelClient };
}

const modelStoreConnections = new Map();
const modelStoreTables = new Map();

export function createPostgresModelClient(model) {
  return {
    async create(input) {
      const table = modelTableFor(model);
      const object = modelObjectFromInput(input);
      try {
        await modelDatabase(model).insert(table).values(modelRowFromObject(object));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return object;
    },
    async get(ref) {
      const table = modelTableFor(model);
      let rows;
      try {
        rows = await modelDatabase(model).select().from(table).where(eq(table.id, ref.id)).limit(1);
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return rows[0] ? modelObjectFromRow(rows[0]) : undefined;
    },
    async query(query = {}) {
      const table = modelTableFor(model);
      const clauses = modelWhereClauses(table, query.where || {});
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 500));
      const builder = modelDatabase(model).select().from(table);
      let rows;
      try {
        rows = await (clauses.length > 0 ? builder.where(and(...clauses)) : builder).limit(limit).offset(Number.isFinite(offset) && offset > 0 ? offset : 0);
      } catch (error) {
        throw modelStoreError(model, error);
      }
      const items = rows.map(modelObjectFromRow);
      const nextCursor = items.length === limit ? String((Number.isFinite(offset) && offset > 0 ? offset : 0) + items.length) : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    async patch(ref, patch) {
      const existing = await this.get(ref);
      if (!existing) {
        throw new Error('Model ' + model.name + ' object ' + ref.id + ' was not found.');
      }
      const next = {
        id: existing.id,
        spec: { ...existing.spec, ...(patch.spec || {}) },
        ...(existing.status || patch.status ? { status: { ...(existing.status || {}), ...(patch.status || {}) } } : {}),
        revision: nextModelRevision(),
      };
      const table = modelTableFor(model);
      try {
        await modelDatabase(model).update(table).set({ spec: next.spec, status: next.status || null, revision: next.revision, updatedAt: new Date() }).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return next;
    },
    async delete(ref) {
      const table = modelTableFor(model);
      try {
        await modelDatabase(model).delete(table).where(eq(table.id, ref.id));
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
          return createPostgresModelClient(model).query({ ...query, where: { ...(query.where || {}), [partitionBy]: partition } });
        },
      };
    },
  };
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
      message: 'applik8s-modelstore-missing-credentials: ModelStore ' + model.name + ' requires database URL env ' + key + ' or DATABASE_URL.',
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
  const existing = modelStoreTables.get(model.name);
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
  modelStoreTables.set(model.name, table);
  return table;
}

function modelWhereClauses(_table, where) {
  return Object.entries(where).map(([field, value]) => sql.raw('(' + quoteIdentifier('spec') + '->>' + quoteLiteral(field) + ') = ' + quoteLiteral(String(value))));
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
      message: 'applik8s-model-migration-missing: ModelStore table ' + model.tableName + ' is missing. Run generated migrations before serving model traffic.',
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
  return { id: input.id || nextModelId(), spec: input.spec || {}, revision: nextModelRevision() };
}

function modelRowFromObject(object) {
  return { id: object.id, spec: object.spec, status: object.status || null, revision: object.revision || nextModelRevision() };
}

function modelObjectFromRow(row) {
  return { id: row.id, spec: row.spec || {}, ...(row.status ? { status: row.status } : {}), revision: row.revision };
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

export const runtimeModule = ${JSON.stringify({ apiVersion: generatedRuntimeModuleApiVersion, kind: 'jobRunnerRuntime', entrypoint: 'runGeneratedJobStatusReconciler', exports: ['createJobStatusUpdater', 'generatedJobStatusFromResource', 'runGeneratedJobStatusReconciler'], interface: runtimeModuleInterface([{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }, { name: 'generatedJobStatusFromResource', kind: 'function', stability: 'stable' }, { name: 'runGeneratedJobStatusReconciler', kind: 'function', stability: 'stable' }], 'required') })};

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
    await reconcileGeneratedJobStatuses({ workloadNamespace, appNamespace, appTarget, appName, statusConfigMapName, targets });
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
  const jobs = statusPatch?.applik8s?.jobs || {};
  await kubeRequest('PATCH', '/api/v1/namespaces/' + encodeURIComponent(namespace) + '/configmaps/' + encodeURIComponent(name), {
    data: {
      'status.json': JSON.stringify(statusPatch, null, 2),
      'applik8s-jobs.json': JSON.stringify(jobs, null, 2),
      updatedAt: new Date().toISOString(),
    },
  }, { 'content-type': 'application/merge-patch+json' });
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

function runtimeModuleEntrypoint(kind: ApplicationRuntimeModuleKind): string {
  if (kind === 'serverRuntime') {
    return 'createServerRuntime';
  }
  if (kind === 'modelRuntime') {
    return 'createModelRuntime';
  }
  if (kind === 'diagnostics') {
    return 'createDiagnosticsRuntime';
  }
  if (kind === 'providerAdapter') {
    return 'createProviderAdapter';
  }
  if (kind === 'kubernetesClient') {
    return 'createKubernetesClient';
  }
  if (kind === 'indexerRuntime') {
    return 'createIndexerRuntime';
  }
  if (kind === 'aggregateWorkerRuntime') {
    return 'createAggregateWorkerRuntime';
  }
  if (kind === 'counterFlusherRuntime') {
    return 'createCounterFlusherRuntime';
  }
  return 'createRuntimeModule';
}

function runtimeModuleInterface(imports: readonly ApplicationRuntimeModuleRef[], exports: readonly ApplicationRuntimeModuleExportContract[], sourceMaps: ApplicationRuntimeModuleInterfaceContract['sourceMaps']): ApplicationRuntimeModuleInterfaceContract {
  return {
    apiVersion: generatedRuntimeModuleApiVersion,
    imports,
    exports,
    diagnostics: 'structured',
    sourceMaps,
    failurePolicy: 'failClosed',
  };
}
