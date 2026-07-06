import { createHash } from 'node:crypto';
import { serializeApplicationGraph, validateApplicationV03PressureTestContract } from '@applik8s/core';
import { applicationGraphFor, ModelStore, sdk, type ApplicationModelBinding, type ApplicationV03PressureTestContract } from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import { entity, type } from '../../packages/applik8s/src/dsl.js';

describe('v0.3 infrastructure-from-code product story', () => {
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
      const store = app.provide(ModelStore, { kind: 'postgres', name: 'accounts-db', database: 'accounts' });
      const accounts = app.model(Account, { store });

      expect(accounts.backend.runtimeBoundary).toEqual({
        serializedCallbacks: 'generatedRuntimeClient',
        scriptExecution: 'scriptRuntimeClient',
      });
      return { ready: true };
    });

    const graph = applicationGraphFor(composition);
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['app.model', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'provider.ModelStore']));
    expect(graph?.compatibility.documentedInternalContracts).toEqual(expect.arrayContaining(['ApplicationGraph']));
    expect(graph?.compatibility.experimentalSurfaces).toEqual(expect.arrayContaining(['app.graph']));
    expect(graph?.compatibility.postV3Surfaces).toEqual(expect.arrayContaining(['workload-movement-operator', 'generic-workflow-orchestration', 'broad-provider-ecosystem']));
    expect(graph?.compatibility.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi' }),
      expect.objectContaining({ name: 'provider.ModelStore', surface: 'stablePublicApi' }),
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
    const previousModelUrl = process.env.APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL;
    try {
      await expect(accounts.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } })).rejects.toMatchObject({
        message: expect.stringContaining('applik8s-modelstore-missing-credentials'),
        diagnostic: expect.objectContaining({ event: 'applik8s-modelstore-missing-credentials', model: 'Account', env: 'APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL' }),
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      if (previousModelUrl === undefined) {
        delete process.env.APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL;
      } else {
        process.env.APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL = previousModelUrl;
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
    const migrationJob = graph?.nodes.find((node) => node.kind === 'job' && node.name === 'accounts-model-migration');
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
          statusOwnership: expect.objectContaining({ primary: 'applicationStatus', fallback: 'generatedStatusConfigMap', appStatusSchema: 'bestEffort' }),
        }),
      },
      phase: {
        conditions: expect.arrayContaining(['Blocked', 'Progressing', 'Ready', 'Finalized', 'Failed']),
      },
    });
    expect(Object.keys(sourceConfigMap?.data ?? {})).toEqual(expect.arrayContaining([
      'runtime__server.mjs',
      'runtime__model-store-postgres.mjs',
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
    expect(appStatusConfigMap?.data).toMatchObject({ 'status.json': '{}', 'applik8s-jobs.json': '{}' });
    expect(deployment).toMatchObject({ spec: { template: { spec: { volumes: expect.arrayContaining([
      expect.objectContaining({ configMap: { name: 'accounts-web-source', items: expect.arrayContaining([
        expect.objectContaining({ key: 'runtime__server.mjs', path: 'runtime/server.mjs' }),
        expect.objectContaining({ key: 'runtime__model-store-postgres.mjs', path: 'runtime/model-store-postgres.mjs' }),
        expect.objectContaining({ key: 'runtime__job-runner.mjs', path: 'runtime/job-runner.mjs' }),
        expect.objectContaining({ key: 'runtime__kubernetes-client.mjs', path: 'runtime/kubernetes-client.mjs' }),
        expect.objectContaining({ key: 'runtime__diagnostics.mjs', path: 'runtime/diagnostics.mjs' }),
      ]) } }),
    ]) } } } });
  });

  it('generates app.job workloads with durable status and diagnostics contracts', () => {
    const composition = sdk.kubernetesComposition({
      name: 'accounts-maintenance-contract',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsMaintenanceContract',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const job = app.job('compact-accounts', { taskKind: 'maintenance', image: 'postgres:16-alpine', command: ['sh', '-c'], args: ['echo compact'] });
      expect(job.statusPath).toBe('status.applik8s.jobs.compact-accounts');
      return { ready: true };
    });

    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'compact-accounts' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-diagnostics' }), data: expect.objectContaining({ phaseStatusPath: 'status.applik8s.jobs.compact-accounts' }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-accounts-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('runGeneratedJobStatusReconciler') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('compact-accounts') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler-status' }), data: expect.objectContaining({ 'applik8s-jobs.json': '{}' }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler' }) }),
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'accounts-maintenance-contract-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ resources: ['accountsmaintenancecontracts/status'], verbs: ['get', 'patch', 'update'] }),
      ]) }),
    ]));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.compact-accounts', kind: 'job', runtime: expect.objectContaining({ materialization: 'kubernetes-job', durableStatusUpdater: expect.objectContaining({ failurePolicy: 'failClosed' }) }) }),
    ]));
  });

  it('generates app.schedule CronJobs with durable status and diagnostics contracts', () => {
    const composition = sdk.kubernetesComposition({
      name: 'accounts-scheduled-maintenance-contract',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsScheduledMaintenanceContract',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const job = app.schedule('compact-accounts-hourly', { taskKind: 'maintenance', cron: '0 * * * *', image: 'postgres:16-alpine', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
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
      expect.objectContaining({ id: 'job.compact-accounts-hourly', kind: 'job', schedule: expect.objectContaining({ cron: '0 * * * *', concurrencyPolicy: 'forbid' }), runtime: expect.objectContaining({ materialization: 'kubernetes-cronjob' }) }),
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
      requiredProviders: ['ModelStore', 'IndexStore', 'Secret', 'HttpExposure', 'CredentialStore'],
      requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
      requiredOperationTargets: [{ id: 'operation-target.accounts-stack', target: { nodeId: 'typeKroResource.accounts-stack' }, operations: ['apply', 'delete'], lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/accounts-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['accountsstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
      requiredWatchScopes: [{ scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'platform', labels: { 'tenant.applik8s.dev/name': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] }],
      requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'ModelStore', nodeId: 'provider.model-store' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db', namespace: 'platform' }, expectedRevision: 'sha256:accounts-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['missingHistoryTable', 'incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Schema drift must fail closed before applying migrations.', retryable: false }] }],
      requiredStatusOwnership: [{ primary: 'applicationStatus', fallback: 'generatedStatusConfigMap', appStatusSchema: 'bestEffort', durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status', namespace: 'platform' }, conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Durable generated job status must survive KRO app status pruning.', retryable: false }] }],
      liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration', namespace: 'platform' }], requiredAssertions: ['migration job completes', 'server becomes ready', 'job status is patched', 'unsupported watch predicates fail closed'] },
    } satisfies ApplicationV03PressureTestContract;

    expect(pressureTest.graph.digest).toBe(graphDigest);
    expect(pressureTest.requiredNodes).toEqual(expect.arrayContaining(['model', 'server', 'job', 'provider']));
    expect(graph.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(pressureTest.requiredNodes));
    expect(graph.providerRequirements.map((requirement) => requirement.interface)).toEqual(expect.arrayContaining(['ModelStore']));
    expect(graph.providerBindings.flatMap((binding) => binding.generatedResources.map((resource) => resource.kind))).toEqual(expect.arrayContaining(['Cluster']));
    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'accounts-db', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'accounts-model-migration', namespace: 'platform' }) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'accounts-web', namespace: 'platform' }) }),
    ]));
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-web-source');
    expect(Object.keys(sourceConfigMap?.data ?? {})).toEqual(expect.arrayContaining(['runtime__server.mjs', 'runtime__model-store-postgres.mjs', 'runtime__job-runner.mjs', 'runtime__kubernetes-client.mjs', 'runtime__diagnostics.mjs']));
    expect(pressureTest.requiredOperationTargets[0]?.dryRun.failurePolicy).toBe('failClosed');
    expect(pressureTest.requiredWatchScopes[0]?.failurePolicy).toBe('failClosed');
    expect(pressureTest.requiredMigrationDriftChecks[0]?.policy.driftPolicy).toBe('failClosed');
    expect(pressureTest.requiredStatusOwnership?.[0]?.fallback).toBe('generatedStatusConfigMap');
    expect(pressureTest.liveValidation?.requiredAssertions).toEqual(expect.arrayContaining(['job status is patched', 'unsupported watch predicates fail closed']));
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
      const store = app.provide(ModelStore, {
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
