import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type ApplicationModelBinding, type ApplicationV03PressureTestContract, applicationGraphFor, sdk, TransactionalDatabase } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
import { type ApplicationDurableStatusOwnershipContract, type ApplicationProviderInterfaceContract, serializeApplicationGraph, validateApplicationV03PressureTestContract } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { createTenantPlatformExample, createTenantPlatformPressureTestContract } from '../tenant-platform.js';

describe('v0.3 infrastructure-from-code product story', () => {
  it('ships a Tenant Platform control-plane pressure-test skeleton for v0.3 substrate work', () => {
    const example = createTenantPlatformExample();
    const graph = applicationGraphFor(example.composition);
    const pressureTest = createTenantPlatformPressureTestContract(example);

    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase' }),
      expect.objectContaining({ id: 'model.account', kind: 'model', schema: expect.objectContaining({ transactions: 'required' }) }),
      expect.objectContaining({ id: 'model.audit-record', kind: 'model', schema: expect.objectContaining({ retention: expect.objectContaining({ mode: 'ttl', ttlSeconds: 7776000 }) }) }),
      expect.objectContaining({ id: 'model.invitation', kind: 'model' }),
      expect.objectContaining({ id: 'model.usage-sample', kind: 'model' }),
      expect.objectContaining({ id: 'server.tenant-admin', kind: 'server' }),
      expect.objectContaining({ id: 'job.account-migration', kind: 'workloadJob', task: expect.objectContaining({ taskKind: 'migration' }) }),
      expect.objectContaining({ id: 'job.audit-record-migration', kind: 'workloadJob', task: expect.objectContaining({ taskKind: 'migration' }) }),
      expect.objectContaining({ id: 'job.tenant-platform-repair', kind: 'workloadJob', task: expect.objectContaining({ taskKind: 'repair' }) }),
      expect.objectContaining({ id: 'job.tenant-platform-cleanup', kind: 'workloadJob', task: expect.objectContaining({ taskKind: 'cleanup' }) }),
    ]));
    const generatedResources = graph?.nodes.flatMap((node) => node.generatedResources ?? []) ?? [];
    expect(generatedResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'tenant-platform-db', namespace: 'platform' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', name: 'account-migration', namespace: 'platform' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', name: 'audit-record-migration', namespace: 'platform' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', name: 'tenant-platform-repair' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ apiVersion: 'batch/v1', kind: 'CronJob', name: 'tenant-platform-cleanup' }) }),
      expect.objectContaining({ artifact: expect.objectContaining({ kind: 'runtimeModule', name: 'account-migration-status-runtime' }) }),
      expect.objectContaining({ artifact: expect.objectContaining({ kind: 'runtimeModule', name: 'tenant-platform-status-reconciler' }) }),
    ]));
    expect(example.composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'tenant-platform-db', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'account-migration', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'audit-record-migration', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'tenant-platform-repair' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: expect.objectContaining({ name: 'tenant-platform-cleanup' }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'tenant-platform-status-reconciler' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'account-migration-migration' }), data: expect.objectContaining({ 'preflight.sql': expect.stringContaining('applik8s-model-migration-preflight'), 'migration.sql': expect.stringContaining('CREATE TABLE IF NOT EXISTS "applik8s_account"') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'account-migration-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('runGeneratedJobStatusReconciler') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'tenant-platform-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('tenant-platform-repair') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'tenant-platform-status-reconciler-status' }) }),
    ]));
    const tenantStatusConfigMap = example.composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'tenant-platform-status-reconciler-status');
    expect(tenantStatusConfigMap).toMatchObject({ __externalRef: true });
    expect(graph?.nodes.find((node) => node.id === 'server.tenant-admin')).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'Tenant' }),
        expect.objectContaining({ apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'Environment' }),
        expect.objectContaining({ apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'AppInstallation' }),
        expect.objectContaining({ apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'MaintenanceWindow' }),
      ]),
      routes: expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/tenants/:tenant/accounts' }),
        expect.objectContaining({ method: 'POST', path: '/tenants/:tenant/invitations' }),
        expect.objectContaining({ method: 'GET', path: '/tenants/:tenant/usage' }),
      ]),
    });
    expect(pressureTest.name).toBe('tenant-platform-control-plane-pressure-test');
    expect(pressureTest.requiredProviders).toEqual(expect.arrayContaining(['TransactionalDatabase', 'Secret', 'CredentialStore', 'HttpExposure', 'Queue', 'ObjectStorage', 'EventSource']));
    expect(pressureTest.requiredNodes).toEqual(expect.arrayContaining(['model', 'server', 'workloadJob', 'provider']));
    expect(pressureTest.requiredStatusEvidence).toMatchObject({ authoritativeStore: 'applicationStatus', liveGate: 'requiredBeforeAnnouncement' });
    expect(pressureTest.requiredTransactionalDatabaseEvidence).toMatchObject({ scriptRuntimeParity: 'localAndOptInLiveGate', migrationDriftCoverage: 'required' });
    expect(pressureTest.requiredOperationTargetEvidence.contexts).toEqual(expect.arrayContaining(['generatedServer', 'generatedJob']));
    expect(pressureTest.requiredWatchScopeEvidence).toMatchObject({ unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired', broadWatchFallback: 'forbidden' });
    expect(pressureTest.runtimeReleasePolicy).toMatchObject({ startupPackageManager: false, dependencyInstallation: 'buildTimeOnly', failurePolicy: 'failClosed' });
    expect(pressureTest.liveValidation?.requiredAssertions).toEqual(expect.arrayContaining(['server becomes ready']));
    expect(pressureTest.liveValidation?.additionalAssertions).toEqual(expect.arrayContaining(['generated job status history is retained']));
    expect(pressureTest.liveValidation?.requiredAssertions).toEqual(expect.arrayContaining(['migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed']));
    expect(validateApplicationV03PressureTestContract(pressureTest)).toEqual([]);
  });

  it('keeps release-facing examples on public package entrypoints', () => {
    const tenantPlatformSource = readFileSync(new URL('../tenant-platform.ts', import.meta.url), 'utf8');
    const guestbookSource = readFileSync(new URL('../guestbook.ts', import.meta.url), 'utf8');

    expect(tenantPlatformSource).toMatch(/from ['"]@applik8s\/applik8s['"]/);
    expect(tenantPlatformSource).toMatch(/from ['"]@applik8s\/applik8s\/dsl['"]/);
    expect(tenantPlatformSource).toContain('app(config.stackName');
    expect(tenantPlatformSource).toContain('tenantPlatform.resource');
    expect(tenantPlatformSource).toContain('tenantPlatform.storage.postgres');
    expect(tenantPlatformSource).toContain("migrations: 'generated-job'");
    expect(tenantPlatformSource).not.toContain('TransactionalDatabase.postgres');
    expect(tenantPlatformSource).not.toContain('tenantPlatform.model(AccountEntity, {\n    store:');
    expect(tenantPlatformSource).toContain('tenantPlatform.server');
    expect(tenantPlatformSource).toContain('Tenant.on.reconcile');
    expect(guestbookSource).toMatch(/from ['"]@applik8s\/applik8s['"]/);
    expect(guestbookSource).toMatch(/from ['"]@applik8s\/applik8s\/dsl['"]/);
    expect(`${tenantPlatformSource}\n${guestbookSource}`).not.toContain("../packages/applik8s/src");
    expect(`${tenantPlatformSource}\n${guestbookSource}`).not.toContain("../src/dsl");
    expect(guestbookSource).not.toMatch(/const\s+CRDs\s*=\s*0/);
    expect(guestbookSource).not.toMatch(/const\s+DOMContentLoaded\s*=\s*0/);
  });

  it('treats v0.3 model/provider APIs as stable and records the runtime execution boundary', () => {
    const Account = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'accounts-platform-contract',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsPlatformContract',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'accounts-db', database: 'accounts' });
      const accounts = app.model(Account, { store });

      expect(accounts.backend.runtimeBoundary).toEqual({
        serializedCallbacks: 'generatedRuntimeClient',
        scriptExecution: 'scriptRuntimeClient',
      });
      return { ready: true };
    });

    const graph = applicationGraphFor(composition);
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['app.model', 'app.workload.job', 'app.workload.cronJob', 'app.defaults', 'app.provide', 'provider.TransactionalDatabase']));
    expect(graph?.compatibility.documentedInternalContracts).toEqual(expect.arrayContaining(['ApplicationGraph']));
    expect(graph?.compatibility.experimentalSurfaces).toEqual(expect.arrayContaining(['app.graph']));
    expect(graph?.compatibility.postV3Surfaces).toEqual(expect.arrayContaining(['workload-movement-operator', 'additional-provider-adapters']));
    expect(graph?.compatibility.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi' }),
      expect.objectContaining({ name: 'provider.TransactionalDatabase', surface: 'stablePublicApi' }),
      expect.objectContaining({ name: 'ApplicationGraph', surface: 'documentedInternalContract' }),
      expect.objectContaining({ name: 'workload-movement-operator', surface: 'postV3Surface' }),
    ]));
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model.account',
        materialization: expect.objectContaining({
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
        }),
      }),
    ]));
  });

  it('materializes schema-first model contracts into graph and infrastructure artifacts', () => {
    const { composition } = accountsModelApp();

    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'accounts-db', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'accounts-model-migration', namespace: 'platform' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'accounts-model-migration-diagnostics', namespace: 'platform' }) }),
    ]));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model.account',
        schema: expect.objectContaining({
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', fields: ['email'], unique: true }],
          transactions: 'required',
        }),
        materialization: expect.objectContaining({
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
        }),
      }),
    ]));
  });

  it('fails closed for ordinary script model CRUD when no Postgres credentials are configured', async () => {
    const { accounts } = accountsModelApp();
    if (!accounts) {
      throw new Error('expected Account model binding');
    }

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousModelUrl = process.env.APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL;
    try {
      await expect(accounts.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } })).rejects.toMatchObject({
        message: expect.stringContaining('applik8s-transactional-database-missing-credentials'),
        diagnostic: expect.objectContaining({ event: 'applik8s-transactional-database-missing-credentials', model: 'Account', env: 'APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL' }),
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      if (previousModelUrl === undefined) {
        delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL;
      } else {
        process.env.APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL = previousModelUrl;
      }
    }
  });

  it('emits migration jobs that apply real schema migrations instead of fail-closed placeholders', () => {
    const { composition } = accountsModelApp();
    const migrationJob = composition.resources.find((resource) => resource.apiVersion === 'batch/v1' && resource.kind === 'Job' && resource.metadata.name === 'accounts-model-migration');
    const migrationConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-migration');
    const migrationCommand = String(migrationJob?.spec?.template?.spec?.containers?.[0]?.command?.[2] ?? '');
    const migrationSql = String(migrationConfigMap?.data?.['migration.sql'] ?? '');

    expect(JSON.stringify(migrationJob)).not.toContain('refusing to fake migration success');
    expect(migrationCommand).toContain('psql "$DATABASE_URL"');
    expect(JSON.stringify(migrationJob)).toContain('accounts-model-migration-migration');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "applik8s_account"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "account-email-unique"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "accounts-by-email"');
  });

  it('publishes durable generated job status and extracted runtime modules as v0.3 substrate contracts', () => {
    const { composition } = accountsModelApp();
    const graph = applicationGraphFor(composition);
    const migrationJob = graph?.nodes.find((node) => node.kind === 'workloadJob' && node.name === 'accounts-model-migration');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-web-source');
    const statusRuntimeConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-status-runtime');
    const appStatusConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-platform-status-reconciler-status');
    const deployment = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'accounts-web');

    expect(migrationJob).toMatchObject({
      runtime: {
        idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
        phaseStatus: { statusPath: 'status.applik8s.jobs.accounts-model-migration' },
        durableStatusUpdater: expect.objectContaining({
          runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' },
          statusOwnership: expect.objectContaining({ primary: 'applicationStatus', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'kroStatusProjectionRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusSchema: 'required', appStatusSchemaContract: expect.objectContaining({ ownership: 'kroStatusProjection' }), concurrency: expect.objectContaining({ updateStrategy: 'resourceVersionRetry', maxAttempts: 5, retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted' }), observability: expect.objectContaining({ mergeEvent: 'applik8s-job-status-reconciler-status-store-merged' }) }),
        }),
      },
      phase: {
        conditions: expect.arrayContaining(['Blocked', 'Progressing', 'Ready', 'Finalized', 'Failed']),
      },
    });
    expect(Object.keys(sourceConfigMap?.data ?? {})).toEqual(expect.arrayContaining([
      'runtime__server.mjs',
      'runtime__transactional-database-postgres.mjs',
      'runtime__job-runner.mjs',
      'runtime__kubernetes-client.mjs',
      'runtime__diagnostics.mjs',
    ]));
    expect(Object.keys(sourceConfigMap?.data ?? {}).every((key) => !key.includes('/'))).toBe(true);
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('createJobStatusUpdater');
    expect(statusRuntimeConfigMap?.data).toMatchObject({
      'runtime__job-runner.mjs': expect.stringContaining('generatedJobStatusFromResource'),
      'status-runtime.json': expect.stringContaining('accounts-model-migration'),
    });
    expect(appStatusConfigMap).toMatchObject({ __externalRef: true });
    expect(deployment).toMatchObject({ spec: { template: { spec: { volumes: expect.arrayContaining([
      expect.objectContaining({ configMap: { name: 'accounts-web-source', items: expect.arrayContaining([
        expect.objectContaining({ key: 'runtime__server.mjs', path: 'runtime/server.mjs' }),
        expect.objectContaining({ key: 'runtime__transactional-database-postgres.mjs', path: 'runtime/transactional-database-postgres.mjs' }),
        expect.objectContaining({ key: 'runtime__job-runner.mjs', path: 'runtime/job-runner.mjs' }),
        expect.objectContaining({ key: 'runtime__kubernetes-client.mjs', path: 'runtime/kubernetes-client.mjs' }),
        expect.objectContaining({ key: 'runtime__diagnostics.mjs', path: 'runtime/diagnostics.mjs' }),
      ]) } }),
    ]) } } } });
  });

  it('generates app.workload.job workloads with durable status and diagnostics contracts', () => {
    const composition = sdk.kubernetesComposition({
      name: 'accounts-maintenance-contract',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsMaintenanceContract',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const job = app.workload.job('compact-accounts', { taskKind: 'maintenance', image: 'postgres:16-alpine', command: ['sh', '-c'], args: ['echo compact'] });
      expect(job.statusPath).toBe('status.applik8s.jobs.compact-accounts');
      return { ready: true };
    });

    const expectedJobResources = [
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'compact-accounts' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-diagnostics' }), data: expect.objectContaining({ phaseStatusPath: 'status.applik8s.jobs.compact-accounts' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('runGeneratedJobStatusReconciler') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('compact-accounts') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler-status' }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler' }) }),
    ];
    for (const expectedResource of expectedJobResources) {
      expect(composition.resources).toContainEqual(expectedResource);
    }
    const statusRole = composition.resources.find((resource) =>
      resource.apiVersion === 'rbac.authorization.k8s.io/v1'
      && resource.kind === 'Role'
      && resource.metadata.name === 'accounts-maintenance-contract-status-reconciler');
    expect(statusRole?.rules).toContainEqual({
      apiGroups: [''],
      resources: ['configmaps'],
      verbs: ['create', 'get', 'patch', 'update'],
    });
    const statusConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-maintenance-contract-status-reconciler-status');
    expect(statusConfigMap).toMatchObject({ __externalRef: true });
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.compact-accounts', kind: 'workloadJob', runtime: expect.objectContaining({ materialization: 'kubernetes-job', durableStatusUpdater: expect.objectContaining({ failurePolicy: 'failClosed' }) }) }),
    ]));
  });

  it('generates app.workload.cronJob workloads with durable status and diagnostics contracts', () => {
    const composition = sdk.kubernetesComposition({
      name: 'accounts-scheduled-maintenance-contract',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsScheduledMaintenanceContract',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const job = app.workload.cronJob('compact-accounts-hourly', { taskKind: 'maintenance', cron: '0 * * * *', image: 'postgres:16-alpine', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
      expect(job.statusPath).toBe('status.applik8s.jobs.compact-accounts-hourly');
      return { ready: true };
    });

    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: expect.objectContaining({ name: 'compact-accounts-hourly' }), spec: expect.objectContaining({ schedule: '0 * * * *', concurrencyPolicy: 'Forbid' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-hourly-diagnostics' }), data: expect.objectContaining({ materialization: 'kubernetes-cronjob' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-hourly-status-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('kubernetes-cronjob') }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'accounts-scheduled-maintenance-contract-status-reconciler' }) }),
    ]));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.compact-accounts-hourly', kind: 'workloadJob', schedule: expect.objectContaining({ cron: '0 * * * *', concurrencyPolicy: 'forbid' }), runtime: expect.objectContaining({ materialization: 'kubernetes-cronjob' }) }),
    ]));
  });

  it('defines the v0.3 pressure-test gates before broad implementation continues', () => {
    const { composition } = accountsModelApp();
    const graph = applicationGraphFor(composition);
    if (!graph) {
      throw new Error('expected pressure-test app graph fixture');
    }
    const graphDigest = `sha256:${createHash('sha256').update(serializeApplicationGraph(graph)).digest('hex')}`;
    const pressureTest = {
      name: 'accounts-platform-pressure-test',
      graph: { apiVersion: graph.apiVersion, path: 'application-graph.json', digest: graphDigest },
      requiredNodes: [...new Set(graph.nodes.map((node) => node.kind))],
      requiredProviders: ['TransactionalDatabase', 'IndexStore', 'CounterStore', 'EventSource', 'Secret', 'Queue', 'ObjectStorage', 'HttpExposure', 'CredentialStore'],
      requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
      requiredOperationTargets: [{ id: 'operation-target.accounts-stack', target: { nodeId: 'typeKroResource.accounts-stack' }, operations: ['apply', 'delete'], execution: { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' }, lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/accounts-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['accountsstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
      requiredWatchScopes: [
        { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'platform', labels: { 'tenant.applik8s.dev/name': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
        { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'platform', labels: {} }, lowering: 'labelSelector', permissions: [], failurePolicy: 'failClosed', diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'platform' }, reason: 'UnsupportedLabelSelectorExpression', message: 'Unsupported watch predicate fails closed instead of broadening account platform watches.', retryable: false }] },
      ],
      requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db', namespace: 'platform' }, expectedRevision: 'sha256:accounts-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['missingHistoryTable', 'incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Schema drift must fail closed before applying migrations.', retryable: false }] }],
      requiredTransactionalDatabaseSemantics: [transactionalDatabaseSemantics()],
      requiredRuntimeModuleInterfaces: [runtimeModuleInterface([{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required')],
      requiredProviderInterfaces: providerInterfaces(),
      providerCompatibility: providerCompatibilityMatrix(),
      requiredStatusOwnership: [{ primary: 'applicationStatus', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'kroStatusProjectionRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusSchema: 'required', appStatusSchemaContract: appStatusSchemaContract(), durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status', namespace: 'platform' }, fallbackStore: generatedStatusConfigMapContract(), concurrency: generatedStatusConcurrencyContract(), observability: generatedStatusObservabilityContract(), conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'KroStatusProjectionRequired', message: 'KRO-owned status.applik8s.jobs hydration is required.', retryable: false }] }],
      requiredStatusEvidence: statusEvidence(),
      requiredTransactionalDatabaseEvidence: transactionalDatabaseEvidenceContract(),
      requiredOperationTargetEvidence: operationTargetEvidence(),
      requiredWatchScopeEvidence: watchScopeEvidence(),
      runtimeReleasePolicy: runtimeReleasePolicy(),
      liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration', namespace: 'platform' }, { apiVersion: 'apps/v1', kind: 'Deployment', name: 'accounts-web', namespace: 'platform' }, { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status', namespace: 'platform' }], requiredAssertions: ['migration job completes', 'server becomes ready', 'model create/query works', 'duplicate key returns 409', 'durable job status is persisted', 'migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed'], additionalAssertions: ['job status is durable in generated status ConfigMap'] },
    } satisfies ApplicationV03PressureTestContract;

    expect(pressureTest.graph.digest).toBe(graphDigest);
    expect(pressureTest.requiredNodes).toEqual(expect.arrayContaining(['model', 'server', 'workloadJob', 'provider']));
    expect(graph.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(pressureTest.requiredNodes));
    expect(graph.providerRequirements.map((requirement) => requirement.interface)).toEqual(expect.arrayContaining(['TransactionalDatabase']));
    expect(graph.providerBindings.flatMap((binding) => binding.generatedResources.map((resource) => resource.kind))).toEqual(expect.arrayContaining(['Cluster']));
    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'accounts-db', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'accounts-model-migration', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'accounts-web', namespace: 'platform' }) }),
    ]));
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-web-source');
    expect(Object.keys(sourceConfigMap?.data ?? {})).toEqual(expect.arrayContaining(['runtime__server.mjs', 'runtime__transactional-database-postgres.mjs', 'runtime__job-runner.mjs', 'runtime__kubernetes-client.mjs', 'runtime__diagnostics.mjs']));
    expect(pressureTest.requiredOperationTargets[0]?.dryRun.failurePolicy).toBe('failClosed');
    expect(pressureTest.requiredWatchScopes[0]?.failurePolicy).toBe('failClosed');
    expect(pressureTest.requiredMigrationDriftChecks[0]?.policy.driftPolicy).toBe('failClosed');
    expect(pressureTest.requiredStatusOwnership?.[0]?.fallbackStore?.objectOwnership).toBe('runtimeCreatedResource');
    expect(pressureTest.requiredStatusOwnership?.[0]?.applicationStatusProjection).toBe('requiredAuthoritative');
    expect(pressureTest.requiredProviderInterfaces?.map((providerInterface) => providerInterface.interface)).toEqual(expect.arrayContaining(['TransactionalDatabase', 'CredentialStore', 'HttpExposure']));
    expect(pressureTest.liveValidation?.additionalAssertions).toEqual(expect.arrayContaining(['job status is durable in generated status ConfigMap']));
    expect(pressureTest.liveValidation?.requiredAssertions).toEqual(expect.arrayContaining(['unsupported watch predicates fail closed']));
    expect(validateApplicationV03PressureTestContract(pressureTest)).toEqual([]);
  });
});

function accountsModelApp() {
    const Account = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });
    let accounts: ApplicationModelBinding<{ readonly email: string; readonly displayName: string }, { readonly phase?: string }> | undefined;

    const composition = sdk.kubernetesComposition({
      name: 'accounts-platform',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsPlatform',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(TransactionalDatabase, {
        kind: 'postgres',
        name: 'accounts-db',
        namespace: 'platform',
        database: 'accounts',
        migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'accounts-model-migration' },
      });
      const accountModel = app.model(Account, {
        store,
        schema: {
          identity: ['id'],
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
          transactions: 'required',
          retention: { mode: 'retain' },
        },
      });
      accounts = accountModel;
      app.server('accounts-web', { namespace: 'platform', models: { accountModel } }, (server) => {
        server.post('/accounts', async () => accountModel.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } }));
      });
      return { ready: true };
    });
  return { composition, accounts };
}

function providerInterfaces(): readonly ApplicationProviderInterfaceContract[] {
  return [
    { interface: 'TransactionalDatabase', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'IndexStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Search', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'CounterStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'EventSource', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'EventLog', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Secret', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Queue', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'ObjectStorage', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'HttpExposure', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Certificate', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'DnsPublication', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'CredentialStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'WorkflowEngine', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'JobRuntime', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'ManagedModelStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'OperatorRuntime', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Scheduler', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Observability', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'LakehouseDataset', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'LakehouseQuery', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'ActorRuntime', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'StructuredGeneration', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'AI', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'AnalyticalDatabase', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'ApplicationHost', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'ContainerRegistry', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'IdentityProvider', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'OAuthAuthorizationServer', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
    { interface: 'Authorization', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  ];
}

function providerCompatibilityMatrix(): ApplicationV03PressureTestContract['providerCompatibility'] {
  return { apiVersion: 'applik8s.providerCompatibility/v1alpha1', providers: providerInterfaces(), requiredForV03: ['TransactionalDatabase', 'IndexStore', 'CounterStore', 'EventSource', 'Secret', 'Queue', 'ObjectStorage', 'HttpExposure', 'CredentialStore'] };
}

function transactionalDatabaseSemantics(): NonNullable<ApplicationV03PressureTestContract['requiredTransactionalDatabaseSemantics']>[number] {
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    transactions: { declaration: 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' },
    retention: { mode: 'retain', deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' },
  };
}

function runtimeModuleInterface(imports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['imports'], exports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['exports'], sourceMaps: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['sourceMaps']): NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number] {
  return { apiVersion: 'applik8s.runtime/v1alpha1', imports, exports, diagnostics: 'structured', sourceMaps, failurePolicy: 'failClosed' };
}

function statusEvidence(): ApplicationV03PressureTestContract['requiredStatusEvidence'] {
  return { authoritativeStore: 'applicationStatus', appStatusProjection: 'requiredAuthoritative', history: 'boundedRetained', conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics', restartSafety: 'required', multiJobCronJobCoverage: 'required', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'], liveGate: 'requiredBeforeAnnouncement', failurePolicy: 'failClosed' };
}

function transactionalDatabaseEvidenceContract(): ApplicationV03PressureTestContract['requiredTransactionalDatabaseEvidence'] {
  return { generatedRuntimeParity: 'localGeneratedArtifactGate', scriptRuntimeParity: 'localAndOptInLiveGate', liveGate: 'requiredBeforeAnnouncement', queryIndexConstraintCoverage: 'required', transactionCoverage: 'required', migrationDriftCoverage: 'required', unsupportedSemantics: 'failClosed' };
}

function operationTargetEvidence(): ApplicationV03PressureTestContract['requiredOperationTargetEvidence'] {
  return { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], dryRunPlans: 'artifactBackedRequired', generatedServerJobExecution: 'required', typeKroExecution: 'required', rbacAndFinalizerCoverage: 'required', failurePolicy: 'failClosed' };
}

function watchScopeEvidence(): ApplicationV03PressureTestContract['requiredWatchScopeEvidence'] {
  return { lowerings: ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'], unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired', runtimeRouting: 'required', broadWatchFallback: 'forbidden', failurePolicy: 'failClosed' };
}

function runtimeReleasePolicy(): ApplicationV03PressureTestContract['runtimeReleasePolicy'] {
  return { startupPackageManager: false, dependencyInstallation: 'buildTimeOnly', runtimeImage: 'explicitImageOrGeneratedRecipe', supplyChain: 'metadataOnlyUntilSignedArtifacts', signedArtifacts: 'postV03', failurePolicy: 'failClosed' };
}

function appStatusSchemaContract(): NonNullable<ApplicationDurableStatusOwnershipContract['appStatusSchemaContract']> {
  return { statusRoot: 'status.applik8s', jobsPath: 'status.applik8s.jobs', schema: 'generatedJobStatusMap', ownership: 'kroStatusProjection', pruningBehavior: 'failClosed' };
}

function generatedStatusConfigMapContract(): NonNullable<ApplicationDurableStatusOwnershipContract['fallbackStore']> {
  return { objectOwnership: 'runtimeCreatedResource', dataOwnership: 'runtime', dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'], updateStrategy: 'resourceVersionMergePatch', history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' }, conflicts: { key: 'conflicts.json', maxEntries: 20 } };
}

function generatedStatusConcurrencyContract(): NonNullable<ApplicationDurableStatusOwnershipContract['concurrency']> {
  return { updateStrategy: 'resourceVersionRetry', maxAttempts: 5, retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry', retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted', failurePolicy: 'failClosed' };
}

function generatedStatusObservabilityContract(): NonNullable<ApplicationDurableStatusOwnershipContract['observability']> {
  return { mergeEvent: 'applik8s-job-status-reconciler-status-store-merged', conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] };
}
