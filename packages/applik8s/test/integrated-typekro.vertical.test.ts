import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { app, applicationGraphFor, cel, CounterStore, CredentialStore, EventSource, HttpExposure, IndexStore, inferRbac, kubernetesComposition, ModelStore, ObjectStorage, permissions, providers, Queue, resolveOperatorInstalls, resources, sdk, Secret, typeKro } from '@applik8s/applik8s';
import type { ApplicationModelBinding, ApplicationModelStoreProvider, ApplicationProviderToken } from '@applik8s/applik8s';
import { serializeApplicationGraph } from '@applik8s/core';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { entity, field, label, metadata, type } from '../src/dsl.js';
import * as kubernetesFactories from '../src/factories/kubernetes.js';
import { cnpg, simple, valkey } from '../src/factories.js';
import { decoratedRouteMessage } from './fixtures/route-helpers.js';

interface GeneratedRouteHandler {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  handler(request: { readonly query: Readonly<Record<string, string | undefined>>; formData(): Promise<unknown> }): Promise<unknown> | unknown;
}

interface GeneratedServerSandbox {
  __handlers?: readonly GeneratedRouteHandler[];
}

interface GeneratedRuntimeExports {
  createRuntimeBindings(): {
    readonly resourceClients: Readonly<Record<string, { increment(input: unknown): Promise<unknown> | unknown }>>;
    readonly indexClients: Readonly<Record<string, unknown>>;
  };
  flushResourceCounterBuffers(): Promise<void>;
}

interface GeneratedRuntimeSandbox {
  __runtime?: GeneratedRuntimeExports;
}

interface GeneratedIndexerExports {
  readonly runtimeIndexes: Readonly<Record<string, unknown>>;
  upsertIndexedItem(index: unknown, item: unknown): Promise<void>;
  removeIndexedItem(index: unknown, item: unknown): Promise<void>;
}

interface GeneratedIndexerSandbox {
  __indexer?: GeneratedIndexerExports;
}

interface GeneratedAggregateExports {
  applySourceObject(kubernetesEventType: string, item: unknown): void;
  applySnapshotObject(item: unknown): void;
  stats(): unknown;
}

interface GeneratedAggregateSandbox {
  __aggregate?: GeneratedAggregateExports;
}

type FakeValkeyConnectionFactory = (options: unknown, onConnect?: () => void) => unknown;
type FakeHttpsRequest = (options: { readonly method?: string; readonly path?: string; readonly headers?: unknown }, callback: (response: FakeHttpResponse) => void) => FakeHttpRequest;

interface FakeHttpRequest {
  on(event: 'error', listener: (error: Error) => void): void;
  write(payload: string): void;
  end(): void;
}

interface FakeHttpResponse {
  readonly statusCode: number;
  setEncoding(encoding: string): void;
  on(event: 'data' | 'end', listener: (payload?: string) => void): void;
}

function noteRouteMessage(value: string): string {
  return decoratedRouteMessage(value).toUpperCase();
}

describe('integrated TypeKro package surface', () => {
  it('exports the applik8s-wrapped TypeKro composition helpers from the umbrella package', () => {
    expect(typeKro.kubernetesComposition).toBeTypeOf('function');
    expect(kubernetesComposition).toBe(sdk.kubernetesComposition);
    expect(typeKro.resource).toBeTypeOf('function');
    expect(typeKro.resources).toBeTypeOf('function');
    expect(typeKro.resolveOperatorInstalls).toBeTypeOf('function');
    expect(typeKro.resources).toBe(resources);
    expect(typeKro.resolveOperatorInstalls).toBe(resolveOperatorInstalls);
    expect(typeKro.inferRbac).toBe(inferRbac);
    expect(typeKro.permissions).toBe(permissions);
    expect(typeKro.operationTarget).toBeTypeOf('function');
    expect(sdk.withPermissions).toBeTypeOf('function');
    expect(app).toBe(kubernetesComposition);
    expect(sdk.app).toBe(kubernetesComposition);
    expect(sdk.kubernetesComposition).toBe(kubernetesComposition);
    expect(providers.IndexStore).toBe(IndexStore);
    expect(providers.ModelStore).toBe(ModelStore);
    expect(providers.CounterStore).toBe(CounterStore);
    expect(providers.EventSource).toBe(EventSource);
    expect(providers.Secret).toBe(Secret);
    expect(providers.Queue).toBe(Queue);
    expect(providers.ObjectStorage).toBe(ObjectStorage);
    expect(providers.HttpExposure).toBe(HttpExposure);
    expect(providers.CredentialStore).toBe(CredentialStore);
    expect(cel).toBeTypeOf('function');
  });

  it('exports the v0.2 application DSL helpers', () => {
    expect(field('status.phase').eq('Accepted')).toMatchObject({ expressionKind: 'predicate', operator: 'eq' });
    expect(label('guestbook.applik8s.dev/book').value).toBe('guestbook.applik8s.dev/book');
    expect(metadata.creationTimestamp.desc()).toMatchObject({ expressionKind: 'ordering', direction: 'desc' });
    expect(entity('Note', { spec: type({ message: 'string' }) })).toMatchObject({ kind: 'applik8sEntity', name: 'Note' });
  });

  it('exposes the future app.model resource-like contract without enabling model runtime', () => {
    type NoteModel = ApplicationModelBinding<{ readonly message: string }, { readonly phase?: string }>;
    const modelBindingKeys: readonly (keyof NoteModel)[] = ['kind', 'name', 'entity', 'backend', 'create', 'get', 'query', 'patch', 'delete', 'index', 'on'];

    expect(modelBindingKeys).toEqual(expect.arrayContaining(['create', 'get', 'query', 'patch', 'delete', 'index', 'on', 'backend']));
  });

  it('materializes schema-first entities as app-scoped CRDs and graph-visible Postgres models', async () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-entity-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesEntityApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const Note = app.crd(NoteEntity, { apiVersion: 'notes.applik8s.dev/v1alpha1' });
      app.server('web', {}, (server) => {
        server.post('/notes', async () => Note.create({ name: 'from-entity', spec: { message: 'hi' } }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(role).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Note = resourceClients["Note"];') } });

    expect(() => sdk.kubernetesComposition({
      name: 'notes-model-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity);
      return { ready: true };
    })).toThrow(/app\.model\("Note"\) requires a typed ModelStore provider/);

    const modelDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-model-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ models: { kind: 'postgres' } });
      return { ready: true };
    });
    expect(applicationGraphFor(modelDefaultComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.model-store', kind: 'provider', name: 'ModelStore', implementation: 'postgres', config: { bindingKind: 'default', provider: 'postgres' } }),
    ]));

    expect(() => sdk.kubernetesComposition({
      name: 'notes-counter-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesCounterDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ counters: 'valkey' });
      return { ready: true };
    })).toThrow(/app\.defaults\(\{ counters: \.\.\. \}\) requires a storage-backed CounterStore implementation/);

    expect(() => sdk.kubernetesComposition({
      name: 'notes-events-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesEventsDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ events: 'watch' });
      return { ready: true };
    })).toThrow(/app\.defaults\(\{ events: \.\.\. \}\) requires an EventSource implementation/);

    expect(() => sdk.kubernetesComposition({
      name: 'notes-expose-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesExposeDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ expose: 'ingress' });
      return { ready: true };
    })).toThrow(/app\.defaults\(\{ expose: \.\.\. \}\) requires an HttpExposure implementation/);

    const postgresModelStore: ApplicationModelStoreProvider = {
      kind: 'postgres',
      name: 'notes-db',
      database: 'notes',
      migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'notes-model-migration' },
      runtime: {
        env: { DATABASE_URL_SECRET: 'notes-db-app' },
        secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'notes-db-app' }],
        readiness: { dependencies: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'notes-db' }], condition: 'Ready', timeoutSeconds: 300 },
      },
      readiness: { waitForClusterReady: true, condition: 'Ready', timeoutSeconds: 300 },
    };
    const defaultProviderModelComposition = sdk.kubernetesComposition({
      name: 'notes-model-default-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelDefaultProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ models: postgresModelStore });
      app.model(NoteEntity, {
        schema: {
          identity: ['id'],
          constraints: [{ name: 'note-message-unique', kind: 'unique', fields: ['message'] }],
          indexes: [{ name: 'notes-by-message', partitionBy: 'message', unique: true }],
          transactions: 'required',
          retention: { mode: 'retain' },
        },
      });
      return { ready: true };
    });
    expect(applicationGraphFor(defaultProviderModelComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.model-store', kind: 'provider', implementation: 'postgres', config: { bindingKind: 'modelStore', provider: 'postgres' } }),
      expect.objectContaining({
        id: 'model.note',
        schema: expect.objectContaining({
          guarantees: {
            identity: 'stableId',
            uniqueness: 'databaseConstraint',
            indexes: 'declaredSecondaryIndexes',
            transactions: 'required',
            retention: 'retain',
            migrationOwnership: 'generatedJob',
          },
        }),
      }),
      expect.objectContaining({ id: 'job.notes-model-migration', kind: 'job', task: { taskKind: 'migration' } }),
    ]));
    const modelProviderComposition = sdk.kubernetesComposition({
      name: 'notes-model-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const provider = app.provide(ModelStore, postgresModelStore);
      expect(provider).toEqual({ kind: 'applicationProvider', token: ModelStore, implementation: postgresModelStore });
      return { ready: true };
    });
    const modelProviderGraph = applicationGraphFor(modelProviderComposition);
    expect(modelProviderGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.model-store', kind: 'provider', name: 'ModelStore', implementation: 'postgres', config: { bindingKind: 'provided', provider: 'postgres' } }),
    ]));
    if (!modelProviderGraph) {
      throw new Error('expected notes-model-provider-app to attach an application graph');
    }
    expect(serializeApplicationGraph(modelProviderGraph)).toContain('"provider.model-store"');

    let directModel: ApplicationModelBinding<{ readonly message: string }, { readonly phase?: string }> | undefined;
    const directProviderModelComposition = sdk.kubernetesComposition({
      name: 'notes-model-direct-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelDirectProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      directModel = app.model(NoteEntity, { store: postgresModelStore });
      expect(directModel.kind).toBe('applicationModel');
      return { ready: true };
    });
    const directProviderModelGraph = applicationGraphFor(directProviderModelComposition);
    expect(directProviderModelGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model.note', kind: 'model', name: 'Note', store: { interface: 'ModelStore', nodeId: 'provider.model-store' } }),
      expect.objectContaining({ id: 'job.notes-model-migration', kind: 'job', task: { taskKind: 'migration' } }),
    ]));
    expect(directProviderModelGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model.note',
        materialization: expect.objectContaining({
          mode: 'providerBacked',
          backingResources: [expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'notes-db' })],
          connection: expect.objectContaining({
            env: expect.objectContaining({ DATABASE_URL_SECRET: 'notes-db-app' }),
            secretRefs: expect.arrayContaining([expect.objectContaining({ apiVersion: 'v1', kind: 'Secret', name: 'notes-db-app' })]),
            readiness: expect.objectContaining({ condition: 'Ready', timeoutSeconds: 300 }),
          }),
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
          reconciliation: { ownership: 'application', schemaDrift: 'generatedMigrationJob', deletionPolicy: 'retain' },
        }),
        generatedResources: expect.arrayContaining([
          expect.objectContaining({ role: 'providerDependency', resource: expect.objectContaining({ kind: 'Cluster', name: 'notes-db' }) }),
        ]),
      }),
      expect.objectContaining({
        id: 'job.notes-model-migration',
        runtime: expect.objectContaining({
          materialization: 'kubernetes-job',
          idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
          phaseStatus: expect.objectContaining({ statusPath: 'status.applik8s.jobs.notes-model-migration' }),
          permissions: expect.arrayContaining([expect.objectContaining({ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] })]),
          environment: expect.objectContaining({ secretRefs: expect.arrayContaining([expect.objectContaining({ name: 'notes-db-app' })]) }),
        }),
        generatedResources: expect.arrayContaining([
          expect.objectContaining({ role: 'migration', resource: expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', name: 'notes-model-migration' }) }),
          expect.objectContaining({ role: 'jobDiagnostics', artifact: expect.objectContaining({ kind: 'jobDiagnostics' }) }),
        ]),
      }),
    ]));
    expect(directProviderModelGraph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'requirement.model.note.store', interface: 'ModelStore', consumer: { nodeId: 'model.note' }, provider: { interface: 'ModelStore', nodeId: 'provider.model-store' } }),
    ]));
    expect(directProviderModelGraph?.providerBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirement: 'requirement.model.note.store',
        provider: { interface: 'ModelStore', nodeId: 'provider.model-store' },
        generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'Cluster', name: 'notes-db' })]),
        runtime: expect.objectContaining({
          env: expect.objectContaining({ DATABASE_URL_SECRET: 'notes-db-app' }),
          readiness: expect.objectContaining({ dependencies: [expect.objectContaining({ kind: 'Cluster', name: 'notes-db' })] }),
        }),
        metadataLinks: expect.arrayContaining([expect.objectContaining({ purpose: 'providerDependency', graphNode: { nodeId: 'provider.model-store' } })]),
      }),
    ]));
    expect(directProviderModelGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { nodeId: 'provider.model-store' }, to: { nodeId: 'model.note' }, relationship: 'provides' }),
      expect.objectContaining({ from: { nodeId: 'job.notes-model-migration' }, to: { nodeId: 'model.note' }, relationship: 'dependsOn' }),
    ]));
    if (!directModel) {
      throw new Error('expected app.model to return a model binding for explicit Postgres provider');
    }
    await expect(directModel.create({ spec: { message: 'hi' } })).rejects.toThrow(/script-execution ModelStore runtime/);

    const providedModelComposition = sdk.kubernetesComposition({
      name: 'notes-model-provider-does-not-enable-model-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelProviderDoesNotEnableModelApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const provider = app.provide(ModelStore, postgresModelStore);
      const model = app.model(NoteEntity, { store: provider });
      expect(model.backend).toMatchObject({
        interface: 'ModelStore',
        runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
        transactions: 'supported',
      });
      return { ready: true };
    });
    expect(applicationGraphFor(providedModelComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.model-store', kind: 'provider', implementation: 'postgres' }),
      expect.objectContaining({ id: 'model.note', kind: 'model', materialization: expect.objectContaining({ mode: 'providerBacked' }) }),
    ]));

    const untypedModelStoreToken: ApplicationProviderToken<unknown> = { name: 'ModelStore' };
    expect(() => sdk.kubernetesComposition({
      name: 'notes-postgres-model-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesPostgresModelProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(untypedModelStoreToken, 'postgres');
      return { ready: true };
    })).toThrow(/app\.provide\(ModelStore, \.\.\.\) currently supports only the typed Postgres ModelStore provider declaration/);

    expect(() => sdk.kubernetesComposition({
      name: 'notes-counter-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesCounterProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(CounterStore, 'valkey');
      return { ready: true };
    })).toThrow(/app\.provide\(CounterStore, \.\.\.\) requires a generated provider adapter/);

    const reservedProviderTokens: readonly [ApplicationProviderToken<unknown>, string][] = [
      [EventSource, 'EventSource'],
      [Secret, 'Secret'],
      [Queue, 'Queue'],
      [ObjectStorage, 'ObjectStorage'],
      [HttpExposure, 'HttpExposure'],
      [CredentialStore, 'CredentialStore'],
    ];
    for (const [token, tokenName] of reservedProviderTokens) {
      expect(() => sdk.kubernetesComposition({
        name: `notes-${tokenName.toLowerCase()}-provider-app`,
        apiVersion: 'notes.applik8s.dev/v1alpha1',
        kind: `Notes${tokenName}ProviderApp`,
        spec: type({}),
        status: type({ ready: 'boolean' }),
      }, (_spec, app) => {
        app.provide(token, 'reserved');
        return { ready: true };
      })).toThrow(new RegExp(`app\\.provide\\(${tokenName}, \\.\\.\\.\\) requires a generated provider adapter`));
    }

    const jobComposition = sdk.kubernetesComposition({
      name: 'notes-job-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesJobApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const job = app.job('migrate', { taskKind: 'migration', image: 'busybox:1.36', command: ['sh', '-c'], args: ['echo migrate'] });
      expect(job).toMatchObject({ kind: 'applicationJob', resourceName: 'migrate', diagnosticsConfigMapName: 'migrate-diagnostics', statusPath: 'status.applik8s.jobs.migrate' });
      return { ready: true };
    });
    expect(jobComposition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'migrate' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'migrate-diagnostics' }), data: expect.objectContaining({ phaseStatusPath: 'status.applik8s.jobs.migrate' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'migrate-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('runGeneratedJobStatusReconciler'), 'status-runtime.json': expect.stringContaining('notesjobapps') }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('discoverApplicationResourceIdentity'), 'status-runtime.json': expect.stringContaining('"statusConfigMapName"') }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler-status' }), data: expect.objectContaining({ 'status.json': '{}', 'applik8s-jobs.json': '{}' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }) }),
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'patch', 'update'] }),
        expect.objectContaining({ apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch'] }),
        expect.objectContaining({ apiGroups: ['notes.applik8s.dev'], resources: ['notesjobapps'], verbs: ['get', 'list'] }),
        expect.objectContaining({ apiGroups: ['notes.applik8s.dev'], resources: ['notesjobapps/status'], verbs: ['get', 'patch', 'update'] }),
      ]) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }), spec: expect.objectContaining({ template: expect.objectContaining({ spec: expect.objectContaining({ serviceAccountName: 'notes-job-app-status-reconciler' }) }) }) }),
    ]));
    const jobRuntimeConfigMap = jobComposition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-job-app-status-reconciler-runtime');
    expect(() => transformSync(String(jobRuntimeConfigMap?.data?.['runtime__job-runner.mjs'] ?? ''), { loader: 'js', format: 'esm' })).not.toThrow();
    const jobDiagnostics = jobComposition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'migrate-diagnostics');
    expect(jobDiagnostics?.data?.phaseStatusContract).toContain('observedGeneration');
    expect(jobDiagnostics?.data?.phaseStatusContract).toContain('metadata.generation');
    expect(jobDiagnostics?.data?.terminalFailureStatus).toContain('partialEffects');
    expect(applicationGraphFor(jobComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.migrate', kind: 'job', name: 'migrate', task: expect.objectContaining({ taskKind: 'migration' }), runtime: expect.objectContaining({ materialization: 'kubernetes-job', phaseStatus: expect.objectContaining({ statusPath: 'status.applik8s.jobs.migrate' }), durableStatusUpdater: expect.objectContaining({ runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' } }) }) }),
    ]));

    const scheduleComposition = sdk.kubernetesComposition({
      name: 'notes-schedule-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesScheduleApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const schedule = app.schedule('cleanup', { taskKind: 'cleanup', cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
      expect(schedule).toMatchObject({ kind: 'applicationJob', resourceName: 'cleanup', diagnosticsConfigMapName: 'cleanup-diagnostics', statusPath: 'status.applik8s.jobs.cleanup' });
      return { ready: true };
    });
    expect(scheduleComposition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: expect.objectContaining({ name: 'cleanup' }), spec: expect.objectContaining({ schedule: '0 * * * *', concurrencyPolicy: 'Forbid' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'cleanup-diagnostics' }), data: expect.objectContaining({ materialization: 'kubernetes-cronjob' }) }),
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'notes-schedule-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: ['batch'], resources: ['cronjobs'], verbs: ['get', 'list', 'watch'] }),
      ]) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'notes-schedule-app-status-reconciler' }), spec: expect.objectContaining({ template: expect.objectContaining({ spec: expect.objectContaining({ containers: expect.arrayContaining([
        expect.objectContaining({ command: expect.arrayContaining(['node', '--input-type=module']), env: expect.arrayContaining([
          expect.objectContaining({ name: 'APPLIK8S_APP_PLURAL', value: 'notesscheduleapps' }),
        ]) }),
      ]) }) }) }) }),
    ]));
    expect(applicationGraphFor(scheduleComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.cleanup', kind: 'job', schedule: expect.objectContaining({ cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' }), runtime: expect.objectContaining({ materialization: 'kubernetes-cronjob' }) }),
    ]));

    const multiJobComposition = sdk.kubernetesComposition({
      name: 'notes-maintenance-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesMaintenanceApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.job('compact', { taskKind: 'maintenance' });
      app.schedule('sweep', { taskKind: 'cleanup', cron: '*/5 * * * *' });
      return { ready: true };
    });
    const maintenanceReconcilers = multiJobComposition.resources.filter((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'notes-maintenance-app-status-reconciler');
    expect(maintenanceReconcilers).toHaveLength(1);
    expect(multiJobComposition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('compact'), 'runtime__job-runner.mjs': expect.stringContaining('deepMerge') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('sweep') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-status' }), data: expect.objectContaining({ 'applik8s-jobs.json': '{}' }) }),
      expect.objectContaining({ kind: 'Role', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: ['batch'], resources: ['jobs', 'cronjobs'], verbs: ['get', 'list', 'watch'] }),
      ]) }),
    ]));
  });

  it('emits Postgres ModelStore backing resources as concrete TypeKro/Kubernetes resources', () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const composition = sdk.kubernetesComposition({
      name: 'notes-model-resource-emission-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelResourceEmissionApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity, { store: { kind: 'postgres', name: 'notes-db', namespace: 'notes', database: 'notes' } });
      return { ready: true };
    });

    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'notes-db', namespace: 'notes' }) }),
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'notes-model-store', namespace: 'notes' }) }),
    ]));
    expect(composition.resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'v1', kind: 'Secret', metadata: expect.objectContaining({ name: 'notes-db-app', namespace: 'notes' }) }),
    ]));
  });

  it('records model schema constraints, indexes, retention, and external provider ownership in the app graph', () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string', author: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const composition = sdk.kubernetesComposition({
      name: 'notes-model-schema-contract-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelSchemaContractApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity, {
        name: 'Entry',
        store: {
          kind: 'postgres',
          provision: false,
          cluster: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'shared-db', namespace: 'data' },
          connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'shared-db-app', namespace: 'data' },
        },
        schema: {
          identity: ['id'],
          constraints: [{ name: 'entry-message-author-unique', kind: 'unique', fields: ['message', 'author'] }],
          indexes: [{ name: 'entries-by-author', partitionBy: 'author', orderBy: ['message'], unique: false }],
          transactions: 'required',
          retention: { mode: 'ttl', ttlSeconds: 86_400 },
        },
      });
      return { ready: true };
    });

    expect(composition.resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'shared-db' }) }),
    ]));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model.entry',
        schema: expect.objectContaining({
          identity: ['id'],
          constraints: [{ name: 'entry-message-author-unique', kind: 'unique', fields: ['message', 'author'] }],
          indexes: [{ name: 'entries-by-author', fields: ['author', 'message'] }],
          transactions: 'required',
          retention: { mode: 'ttl', ttlSeconds: 86_400 },
        }),
        materialization: expect.objectContaining({
          backingResources: [expect.objectContaining({ kind: 'Cluster', name: 'shared-db', namespace: 'data' })],
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
          reconciliation: expect.objectContaining({ ownership: 'external' }),
        }),
      }),
    ]));
  });

  it('generates server runtime ModelStore clients backed by a singleton app-scoped CNPG provider', () => {
    const AccountEntity = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const ProfileEntity = entity('Profile', {
      spec: type({ accountId: 'string', bio: 'string?' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'accounts-model-runtime-app',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsModelRuntimeApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(ModelStore, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app' });
      const Account = app.model(AccountEntity, {
        store,
        schema: {
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
        },
      });
      app.model(ProfileEntity, { store });
      app.server('web', { namespace: 'platform' }, (server) => {
        server.post('/accounts', async () => Account.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } }));
        server.get('/accounts', async () => Account.query({ where: { email: 'ada@example.com' }, limit: 10 }));
      });
      return { ready: true };
    });

    const clusters = composition.resources.filter((resource) => resource.apiVersion === 'postgresql.cnpg.io/v1' && resource.kind === 'Cluster' && resource.metadata.name === 'app-db');
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ metadata: { namespace: 'platform' }, spec: { bootstrap: { initdb: { database: 'app', owner: 'app' } } } });
    const deployment = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web');
    expect(deployment).toMatchObject({
      spec: { template: { spec: { containers: [expect.objectContaining({
        env: expect.arrayContaining([
          expect.objectContaining({ name: 'APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL', valueFrom: { secretKeyRef: { name: 'app-db-app', key: 'uri' } } }),
        ]),
      })] } } },
    });
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const serverSource = String(sourceConfigMap?.data?.['server.mjs'] ?? '');
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Account = modelClients["Account"];') } });
    expect(() => transformSync(String(sourceConfigMap?.data?.['server.mjs'] ?? ''), { loader: 'js', format: 'esm' })).not.toThrow();
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain("from './runtime/model-store-postgres.mjs'");
    expect(String(sourceConfigMap?.data?.['runtime__model-store-postgres.mjs'] ?? '')).toContain('createPostgresModelClient');
    expect(String(sourceConfigMap?.data?.['runtime__model-store-postgres.mjs'] ?? '')).toContain('drizzle-orm/postgres-js');
    expect(serverSource).not.toContain('ensureModelTable');
    expect(serverSource).not.toContain('modelStoreTableReady');
    expect(JSON.stringify(sourceConfigMap)).toContain('Account.create');
    expect(JSON.stringify(sourceConfigMap)).toContain('Account.query');
    const modelRuntimeSource = String(sourceConfigMap?.data?.['runtime__model-store-postgres.mjs'] ?? '');
    expect(modelRuntimeSource).toContain('modelPostgresError(error)');
    expect(modelRuntimeSource).toContain('current = current.cause');
    expect(modelRuntimeSource).toContain('modelDefaultUniqueConstraint(model)');
  });

  it('generates ModelStore migrations, constraint diagnostics, index queries, and credential diagnostics', () => {
    const AccountEntity = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'accounts-model-runtime-contract-app',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsModelRuntimeContractApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(ModelStore, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob' } });
      const Account = app.model(AccountEntity, {
        store,
        schema: {
          identity: ['id'],
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
          transactions: 'required',
        },
      });
      app.server('web', { namespace: 'platform' }, (server) => {
        server.post('/accounts', async () => Account.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } }));
        server.get('/accounts', async () => Account.index('accounts-by-email', { partitionBy: 'email', unique: true }).query('ada@example.com'));
      });
      return { ready: true };
    });

    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const migrationConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'account-migration-migration');
    const source = JSON.stringify(sourceConfigMap);
    const serverSource = String(sourceConfigMap?.data?.['server.mjs'] ?? '');
    const migrationSql = String(migrationConfigMap?.data?.['migration.sql'] ?? '');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "applik8s_account"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "account-email-unique"');
    expect(migrationSql).toContain('(("spec"->>\'email\'))');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "accounts-by-email"');
    expect(source).toContain('accounts-by-email');
    expect(source).toContain('23505');
    expect(source).toContain('applik8s-model-duplicate-key');
    expect(JSON.stringify(composition.resources)).toContain('applik8s-model-migration applying');
    expect(source).toContain('APPLIK8S_MODEL_STORE_ACCOUNT_DATABASE_URL');
    expect(source).toContain('applik8s-modelstore-missing-credentials');
    expect(source).toContain('applik8s-model-migration-missing');
    expect(serverSource).not.toContain('ensureModelTable');
    expect(serverSource).not.toContain('modelStoreTableReady');
  });

  it('emits generated server, model, job, diagnostics, and provider runtime modules as focused artifacts', () => {
    const AccountEntity = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'accounts-runtime-module-boundary-app',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsRuntimeModuleBoundaryApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(ModelStore, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob' } });
      const Account = app.model(AccountEntity, { store, schema: { indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }] } });
      app.server('web', { namespace: 'platform' }, (server) => {
        server.post('/accounts', async () => Account.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } }));
      });
      return { ready: true };
    });

    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const deployment = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web');
    const sourceDataKeys = Object.keys(sourceConfigMap?.data ?? {});
    expect(sourceDataKeys.every((key) => !key.includes('/'))).toBe(true);
    expect(sourceConfigMap?.data).toMatchObject({
      'runtime__server.mjs': expect.stringContaining('serverRuntime'),
      'runtime__model-store-postgres.mjs': expect.stringContaining('modelRuntime'),
      'runtime__diagnostics.mjs': expect.stringContaining('diagnostics'),
      'runtime__providers__postgres.mjs': expect.stringContaining('providerAdapter'),
    });
    expect(sourceConfigMap?.data?.['runtime__server.mjs']).toContain('export const runtimeModule');
    expect(sourceConfigMap?.data?.['runtime__model-store-postgres.mjs']).toContain('"kind":"modelRuntime"');
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('"kind":"jobRunnerRuntime"');
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('createJobStatusUpdater');
    expect(sourceConfigMap?.data?.['runtime__diagnostics.mjs']).toContain('"kind":"diagnostics"');
    expect(sourceConfigMap?.data?.['runtime__providers__postgres.mjs']).toContain('"kind":"providerAdapter"');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain('createRuntimeBindings');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain('modelClients');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain("from './runtime/model-store-postgres.mjs'");
    expect(String(sourceConfigMap?.data?.['bindings.mjs'] ?? '')).toContain("import { createRuntimeBindings } from './runtime.mjs'");
    expect(String(sourceConfigMap?.data?.['routes.mjs'] ?? '')).toContain("from './route-");
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('./routes.mjs');
    expect(deployment).toMatchObject({ spec: { template: { spec: { volumes: expect.arrayContaining([
      expect.objectContaining({ name: 'applik8s-server-source', configMap: { name: 'web-source', items: expect.arrayContaining([
        expect.objectContaining({ key: 'runtime__server.mjs', path: 'runtime/server.mjs' }),
        expect.objectContaining({ key: 'runtime__model-store-postgres.mjs', path: 'runtime/model-store-postgres.mjs' }),
        expect.objectContaining({ key: 'runtime__job-runner.mjs', path: 'runtime/job-runner.mjs' }),
        expect.objectContaining({ key: 'runtime__diagnostics.mjs', path: 'runtime/diagnostics.mjs' }),
        expect.objectContaining({ key: 'runtime__providers__postgres.mjs', path: 'runtime/providers/postgres.mjs' }),
      ]) } }),
    ]) } } } });
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).not.toContain('function createModelClient');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).not.toContain('function createPostgresModelClient');
  });

  it('emits migration compatibility plans, history table metadata, and fail-closed drift diagnostics', () => {
    const AccountEntity = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'accounts-migration-compatibility-app',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'AccountsMigrationCompatibilityApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(ModelStore, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'accounts-model-migration' } });
      app.model(AccountEntity, {
        store,
        schema: {
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
        },
      });
      return { ready: true };
    });

    const migrationConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-migration');
    const diagnosticsConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-diagnostics');
    const migrationSql = String(migrationConfigMap?.data?.['migration.sql'] ?? '');

    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "applik8s_model_migrations"');
    expect(migrationSql).toContain('INSERT INTO "applik8s_model_migrations"');
    expect(diagnosticsConfigMap?.data).toMatchObject({
      compatibilityPolicy: expect.stringContaining('explicitPlanRequired'),
      driftPolicy: 'failClosed',
      phaseStatusContract: expect.stringContaining('observedGeneration'),
      durableStatusTemplate: expect.stringContaining('provider-readiness'),
      terminalFailureStatus: expect.stringContaining('partialEffects'),
      migrationPlan: expect.stringContaining('account-email-unique'),
      failureModes: expect.stringContaining('missingCredentials'),
      driftDiagnostic: expect.stringContaining('SchemaDriftDetected'),
      failureDiagnostic: expect.stringContaining('applik8s-model-migration-failed'),
    });
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('badSql');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('incompatibleTableOrIndex');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('destructiveChange');
    expect(diagnosticsConfigMap?.data?.migrationPlan).toContain('destructive-change');
    expect(diagnosticsConfigMap?.data?.migrationPlan).toContain('schema-drift');
    expect(migrationSql).not.toContain('DROP TABLE');
    expect(migrationSql).not.toContain('DROP INDEX');
  });

  it.fails('executes generated model CRUD and query methods through ModelStore runtime clients', async () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    let model: ApplicationModelBinding<{ readonly message: string }, { readonly phase?: string }> | undefined;
    sdk.kubernetesComposition({
      name: 'notes-model-runtime-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelRuntimeApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      model = app.model(NoteEntity, { store: { kind: 'postgres', name: 'notes-db', database: 'notes' } });
      return { ready: true };
    });
    if (!model) {
      throw new Error('expected model binding');
    }

    await expect(model.create({ spec: { message: 'hello' } })).resolves.toMatchObject({ id: expect.any(String), spec: { message: 'hello' } });
    await expect(model.get({ id: 'note-1' })).resolves.toMatchObject({ id: 'note-1', spec: expect.any(Object) });
    await expect(model.query({ where: { message: 'hello' }, limit: 10 })).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(model.patch({ id: 'note-1' }, { status: { phase: 'Accepted' } })).resolves.toMatchObject({ id: 'note-1', status: { phase: 'Accepted' } });
    await expect(model.index('byMessage', { partitionBy: 'message' }).query('hello')).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it('emits migration jobs with durable phase status and observable diagnostics as concrete resources', () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const composition = sdk.kubernetesComposition({
      name: 'notes-model-migration-artifacts-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelMigrationArtifactsApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity, { store: { kind: 'postgres', name: 'notes-db', namespace: 'notes', database: 'notes', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'notes-model-migration' } } });
      return { ready: true };
    });

    expect(composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: expect.objectContaining({ name: 'notes-model-migration' }),
        spec: expect.objectContaining({
          template: expect.objectContaining({
            spec: expect.objectContaining({
              restartPolicy: 'OnFailure',
              containers: expect.arrayContaining([
                expect.objectContaining({
                  image: 'postgres:16-alpine',
                  command: expect.arrayContaining(['sh', '-c', expect.stringContaining('psql "$DATABASE_URL"')]),
                  env: expect.arrayContaining([
                    expect.objectContaining({ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'notes-db-app', key: 'uri' } } }),
                    expect.objectContaining({ name: 'APPLIK8S_MODEL_STORE_MODEL', value: 'Note' }),
                  ]),
                  volumeMounts: expect.arrayContaining([expect.objectContaining({ name: 'applik8s-model-migration', mountPath: '/migrations', readOnly: true })]),
                }),
              ]),
              volumes: expect.arrayContaining([expect.objectContaining({ name: 'applik8s-model-migration', configMap: { name: 'notes-model-migration-migration' } })]),
            }),
          }),
        }),
      }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-migration' }), data: expect.objectContaining({ 'migration.sql': expect.stringContaining('CREATE TABLE IF NOT EXISTS "applik8s_note"') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-diagnostics' }), data: expect.objectContaining({ phaseStatusContract: expect.stringContaining('status.applik8s.jobs.notes-model-migration'), terminalFailureStatus: expect.stringContaining('runMigrationJob') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('patchApplicationStatus'), 'status-runtime.json': expect.stringContaining('notesmodelmigrationartifactsapps') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('patchGeneratedStatusConfigMap'), 'status-runtime.json': expect.stringContaining('notes-model-migration') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler-status' }), data: expect.objectContaining({ 'status.json': '{}', 'applik8s-jobs.json': '{}' }) }),
      expect.objectContaining({ kind: 'ClusterRole', metadata: expect.objectContaining({ name: 'notes-notes-model-migration-artifacts-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'patch', 'update'] }),
        expect.objectContaining({ apiGroups: ['notes.applik8s.dev'], resources: ['notesmodelmigrationartifactsapps/status'], verbs: ['get', 'patch', 'update'] }),
      ]) }),
      expect.objectContaining({ kind: 'ClusterRoleBinding', metadata: expect.objectContaining({ name: 'notes-notes-model-migration-artifacts-app-status-reconciler' }) }),
      expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler' }), spec: expect.objectContaining({ template: expect.objectContaining({ spec: expect.objectContaining({ serviceAccountName: 'notes-model-migration-artifacts-app-status-reconciler' }) }) }) }),
    ]));
    const migrationRuntimeConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-model-migration-artifacts-app-status-reconciler-runtime');
    expect(() => transformSync(String(migrationRuntimeConfigMap?.data?.['runtime__job-runner.mjs'] ?? ''), { loader: 'js', format: 'esm' })).not.toThrow();
    expect(JSON.stringify(composition.resources)).not.toContain('${APPLIK8S_MODEL_STORE_MODEL}');
    expect(JSON.stringify(composition.resources)).not.toContain('${attempt}');
  });

  it('supports composition-scoped app authoring with explicit operator and server registration', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const notes = sdk.operator({
      name: 'notes-controller',
      resources: { Note },
      handlers: [],
      deployment: { namespace: 'notes-system' },
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
      orderBy: metadata.creationTimestamp.desc(),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesApp',
      spec: type({ namespace: 'string' }),
      status: type({ ready: 'boolean', phase: 'string' }),
    }, (spec, app) => {
      const install = app.operator(notes, { namespace: spec.namespace, replicas: 1 });
      const defaults = app.defaults({ indexes: 'valkey' });
      const provider = app.provide({ name: 'IndexStore' }, 'valkey');
      const web = app.api('web', {
        service: { port: 80 },
        resources: { Note },
        indexes: { byBook },
        cache: [byBook],
        indexBackend: { kind: 'valkey' },
      }, (server) => {
        server.get('/', async () => ({ notes: (await byBook.query('main', { limit: 10 })).items }));
        server.post('/notes', async (request) => {
          const form = await request.formData();
          return Note.create({ name: 'from-form', spec: { message: form.string('message') } });
        });
      });
      install.note({ name: 'hello', namespace: spec.namespace, spec: { message: 'hi' } });
      expect(defaults).toEqual({ kind: 'applicationDefaults', defaults: { indexes: 'valkey' } });
      expect(provider).toEqual({ kind: 'applicationProvider', token: { name: 'IndexStore' }, implementation: 'valkey' });
      expect(app.api.web).toBe(web);
      expect(app.server.web).toBe(web);
      expect(web.routes).toEqual([
        expect.objectContaining({ id: 'get-root-0', method: 'GET', path: '/' }),
        expect.objectContaining({ id: 'post-notes-1', method: 'POST', path: '/notes' }),
      ]);
      const { deployment: webDeployment } = web;
      const ready = webDeployment.status.availableReplicas >= webDeployment.spec.replicas;
      return { ready, phase: ready ? 'Ready' : 'Installing' };
    });

    expect(composition.operatorInstalls).toHaveLength(1);
    expect(composition.operatorInstalls[0]?.operatorName).toBe('notes-controller');
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'web-source' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Role', metadata: expect.objectContaining({ name: 'web' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Service', metadata: expect.objectContaining({ name: 'web' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'web' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web-index' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Service', metadata: expect.objectContaining({ name: 'web-index' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'web-indexer' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Role', metadata: expect.objectContaining({ name: 'web-indexer' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'RoleBinding', metadata: expect.objectContaining({ name: 'web-indexer' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'web-indexer-source' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web-indexer' }) }));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'operator', name: 'notes-controller' }),
    ]));
    expect(applicationGraphFor(composition)?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { nodeId: 'operator.notes-controller' }, relationship: 'owns' }),
    ]));
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const indexerSourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-indexer-source');
    const serverRole = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const indexerRole = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web-indexer');
    expect(serverRole).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(indexerRole).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list', 'watch'] }] });
    expect(JSON.stringify(sourceConfigMap)).toContain('applik8sServerRuntime');
    expect(JSON.stringify(sourceConfigMap)).toContain('hono');
    expect(JSON.stringify(sourceConfigMap)).toContain('server.mjs.map');
    expect(JSON.stringify(sourceConfigMap)).toContain('createResourceClient');
    expect(JSON.stringify(sourceConfigMap)).toContain('createIndexClient');
    expect(JSON.stringify(sourceConfigMap)).toContain('bindings.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('runtime.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('routes.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('routes.manifest.json');
    expect(JSON.stringify(sourceConfigMap)).toContain('route-get-root-0.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('route-post-notes-1.mjs');
    expect(JSON.stringify(sourceConfigMap)).not.toContain('Function(');
    expect(JSON.stringify(sourceConfigMap)).toContain('applik8s-server-route-failure');
    expect(JSON.stringify(sourceConfigMap)).toContain('get-root-0');
    expect(JSON.stringify(sourceConfigMap)).toContain('post-notes-1');
    expect(JSON.stringify(sourceConfigMap)).toContain('queryValkeyIndex');
    expect(JSON.stringify(sourceConfigMap)).toContain('ZREVRANGE');
    expect(JSON.stringify(sourceConfigMap)).toContain('web-index.default.svc.cluster.local');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('syncAllIndexes');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('startWatchLoop');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('watchIndex');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain("params.set('watch', 'true')");
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('ZADD');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('ZREM');
    expect(JSON.stringify(indexerSourceConfigMap)).toContain('SMEMBERS');
    expect(JSON.stringify(sourceConfigMap)).toContain('notes.applik8s.dev/v1alpha1');
    expect(JSON.stringify(sourceConfigMap)).toContain('notes.applik8s.dev/book');
    expect(JSON.stringify(sourceConfigMap)).toContain('byBook.query');
    expect(JSON.stringify(sourceConfigMap)).toContain('Note.create');
    expect(JSON.stringify(sourceConfigMap)).toContain('/notes');
    for (const [fileName, source] of Object.entries(sourceConfigMap?.data ?? {})) {
      if (fileName.endsWith('.mjs')) {
        expect(source).not.toContain('${');
      }
    }
    const kroYaml = composition.factory('kro').toYaml();
    expect(kroYaml).toContain('availableReplicas');
    expect(kroYaml).toContain('webDeployment.status.availableReplicas >= webDeployment.spec.replicas');
    expect(kroYaml).toContain('phase: "${webDeployment.status.availableReplicas >= webDeployment.spec.replicas ?');
  });

  it('attaches an inspectable application graph before TypeKro emits Kubernetes resources', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string', count: 'number?' }),
      status: type({ count: 'number?' }),
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      orderBy: metadata.creationTimestamp.desc(),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-graph',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppGraph',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ indexes: 'valkey' });
      const appConfig = app.infra(kubernetesFactories.configMap({
        id: 'appConfig',
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'app-config' },
        data: { mode: 'graph-test' },
      }));
      expect(appConfig.kind).toBe('ConfigMap');
      app.server('web', { resources: { Note }, indexes: { byBook } }, (server) => {
        server.get('/notes', async () => byBook.query('main', { limit: 10 }));
        server.post('/views', async () => Note.increment({ name: 'main', spec: { message: 'main' } }));
      });
      app.aggregate('noteStats', {
        source: byBook,
        target: {
          resource: Note,
          name: 'main',
          status: (stats: { readonly count: number }) => ({ count: stats.count }),
        },
        initial: { count: 0 },
        reduce: (stats: { readonly count: number }) => ({ count: stats.count + 1 }),
      });
      return { ready: true };
    });

    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'note-stats-aggregate' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'app-config' }) }));
    expect(composition.factory('kro').toYaml()).toContain('notes-app-graph');

    const graph = applicationGraphFor(composition);
    expect(graph).toMatchObject({
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'notes-app-graph' },
    });
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'server', name: 'web' }),
      expect.objectContaining({ kind: 'crd', name: 'Note' }),
      expect.objectContaining({ kind: 'index', name: 'byBook' }),
      expect.objectContaining({ kind: 'provider', name: 'IndexStore', implementation: 'valkey' }),
      expect.objectContaining({ kind: 'aggregate', name: 'noteStats' }),
      expect.objectContaining({ kind: 'counter', name: 'web.Note' }),
      expect.objectContaining({ kind: 'typeKroResource', name: 'app-config' }),
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: 'dependsOn' }),
      expect.objectContaining({ from: { nodeId: 'provider.index-store' }, to: { nodeId: 'index.by-book' }, relationship: 'provides' }),
      expect.objectContaining({ relationship: 'reads' }),
      expect.objectContaining({ relationship: 'emits' }),
    ]));
    const nodeIds = graph?.nodes.map((node) => node.id) ?? [];
    const edgeIds = graph?.edges.map((edge) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`) ?? [];
    expect(nodeIds).toEqual([...nodeIds].sort());
    expect(edgeIds).toEqual([...edgeIds].sort());
    expect(graph ? serializeApplicationGraph(graph) : '').toContain('"kind":"ApplicationGraph"');
    expect(graph?.providerRequirements).toEqual([]);
    expect(graph?.providerBindings).toEqual([]);
    expect(graph?.compatibility.documentedInternalContracts).toContain('ApplicationGraph');
    expect(graph?.compatibility.postV3Surfaces).toContain('workload-movement-operator');
    expect(graph?.compatibility.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ApplicationGraph', surface: 'documentedInternalContract' }),
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi' }),
      expect.objectContaining({ name: 'provider.ModelStore', surface: 'stablePublicApi' }),
    ]));
  });

  it('infers app.server resource CRUD RBAC from typed resource actions', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-crud-rbac',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppCrudRbac',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { namespace: 'notes', resources: { Note } }, (server) => {
        server.post('/notes', async (request) => {
          const form = await request.formData();
          return Note.create({ name: 'from-form', namespace: 'notes', spec: { message: form.string('message') } });
        });
        server.get('/notes', async () => Note.query({ namespace: 'notes', limit: 20 }));
        server.get('/notes/one', async () => Note.get({ name: 'one', namespace: 'notes' }));
        server.post('/notes/patch', async () => Note.patch({ name: 'one', namespace: 'notes' }, [{ op: 'replace', path: '/spec/message', value: 'updated' }]));
        server.post('/notes/delete', async () => Note.delete({ name: 'one', namespace: 'notes' }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    expect(role).toMatchObject({
      rules: expect.arrayContaining([
        expect.objectContaining({
          apiGroups: ['notes.applik8s.dev'],
          resources: ['notes'],
          verbs: expect.arrayContaining(['create', 'get', 'list', 'patch', 'delete']),
        }),
      ]),
    });
  });

  it('buffers app.server counter increments while inferring create get patch RBAC', () => {
    const PageViewBucket = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'PageViewBucket',
      spec: type({ note: 'string', windowStart: 'string', count: 'number' }),
      status: type({ observedCount: 'number?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-counter-rbac',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppCounterRbac',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { namespace: 'notes', resources: { PageViewBucket } }, (server) => {
        server.get('/', async () => PageViewBucket.increment({
          name: 'main-views',
          namespace: 'notes',
          labels: { 'notes.applik8s.dev/note': 'main' },
          spec: { note: 'main', windowStart: '2026-07-01T00:00:00.000Z' },
          field: 'spec.count',
        }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(role).toMatchObject({
      rules: expect.arrayContaining([
        expect.objectContaining({
          apiGroups: ['notes.applik8s.dev'],
          resources: ['pageviewbuckets'],
          verbs: expect.arrayContaining(['create', 'get', 'patch']),
        }),
      ]),
    });
    expect(JSON.stringify(sourceConfigMap)).toContain('bufferResourceCounterIncrement');
    expect(JSON.stringify(sourceConfigMap)).toContain('applik8s-server-counter-flush-failure');
    expect(JSON.stringify(sourceConfigMap)).toContain('PageViewBucket.increment');
  });

  it('uses app.provide(IndexStore, ...) as the app-scoped default index backend', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
      orderBy: metadata.creationTimestamp.desc(),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-provider-index-store',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppProviderIndexStore',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(IndexStore, { kind: 'valkey', name: 'shared-index' });
      const web = app.server('web', { indexes: { byBook } }, (server) => {
        server.get('/notes', async () => byBook.query('main', { limit: 10 }));
      });
      const { deployment: webDeployment } = web;
      const ready = webDeployment.status.availableReplicas >= webDeployment.spec.replicas;
      return { ready };
    });

    const valkey = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'shared-index');
    const valkeyService = composition.resources.find((resource) => resource.kind === 'Service' && resource.metadata.name === 'shared-index');
    const valkeyConnection = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'shared-index-applik8s-index');
    const indexer = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web-indexer');
    const serverSource = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(valkey).toMatchObject({
      metadata: { name: 'shared-index' },
      spec: { template: { spec: { containers: [expect.objectContaining({ name: 'valkey', image: 'valkey/valkey:8.1-alpine' })] } } },
    });
    expect(valkeyService).toMatchObject({ spec: { ports: [{ name: 'valkey', port: 6379, targetPort: 6379 }] } });
    expect(valkeyConnection).toMatchObject({ data: { backend: 'valkey', host: 'shared-index.default.svc.cluster.local', port: '6379' } });
    expect(indexer).toMatchObject({ metadata: { name: 'web-indexer' } });
    expect(JSON.stringify(serverSource)).toContain('shared-index.default.svc.cluster.local');
    expect(composition.factory('kro').toYaml()).toContain('availableReplicas');
  });

  it('fails fast when generated server routes capture unsupported closure values', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const prefix = 'captured';

    expect(() => sdk.kubernetesComposition({
      name: 'notes-app-closure-capture',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppClosureCapture',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note } }, (server) => {
        server.get('/', async () => ({ message: prefix }));
      });
      return { ready: true };
    })).toThrow(/app\.server route GET \/ cannot serialize closure identifier\(s\): prefix/);
  });

  it('allows generated server routes to return Web Response objects', () => {
    const composition = sdk.kubernetesComposition({
      name: 'notes-app-response-route',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppResponseRoute',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', {}, (server) => {
        server.get('/missing', async () => new Response('not found', { status: 404 }));
      });
      return { ready: true };
    });

    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-missing-0.mjs': expect.stringContaining('new Response') } });
  });

  it('serializes explicit generated server route captures separately from permissions', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const pageSize = 10;
    const prefix = 'page';
    const label = (value: number) => `${prefix}-${value}`;

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-route-captures',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppRouteCaptures',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note }, captures: { pageSize, prefix, label } }, (server) => {
        server.get('/config', async () => ({ pageSize, label: label(pageSize) }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(role).toBeUndefined();
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const captures={};') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const pageSize=captures["pageSize"]=10;') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const prefix=captures["prefix"]="page";') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const label=captures["label"]=') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-config-0.mjs': expect.stringContaining("from './bindings.mjs';") } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-config-0.mjs': expect.stringContaining('export const route_get_config_0') } });
  });

  it('emits generated server route modules from source-backed TypeScript route expressions', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-source-routes',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppSourceRoutes',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note } }, (server) => {
        server.get('/typed', async (request: { readonly query: Readonly<Record<string, string | undefined>> }) => ({ cursor: request.query.cursor ?? 'first' }));
      });
      return { ready: true };
    });

    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-typed-0.mjs': expect.stringContaining('applik8s-route-source-kind: source') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-typed-0.mjs': expect.not.stringContaining('readonly query') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-typed-0.mjs': expect.stringContaining('cursor: request.query.cursor ?? "first"') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'routes.manifest.json': expect.stringContaining('"sourceKind": "source"') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'routes.mjs': expect.stringContaining('sourceLocation') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'server.mjs': expect.stringContaining('routeDiagnostics(route)') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'server.mjs': expect.stringContaining('error.stack?') } });
  });

  it('infers app-scoped operator resources and bundles module-scope route helpers', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const notes = sdk.operator({
      name: 'notes-controller-inferred',
      resources: { Note },
      handlers: [],
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
      orderBy: metadata.creationTimestamp.desc(),
    });
    const composition = sdk.kubernetesComposition({
      name: 'notes-app-inferred-server-bindings',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppInferredServerBindings',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.operator(notes, { namespace: 'notes-system' });
      app.defaults({ indexes: 'valkey' });
      app.server('web', { cache: [byBook] }, (server) => {
        server.get('/notes', async () => byBook.query('main', { limit: 10 }));
        server.post('/notes', async () => Note.create({ name: 'from-helper', spec: { message: noteRouteMessage(' hello ') } }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const indexerRole = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web-indexer');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web-index' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Service', metadata: expect.objectContaining({ name: 'web-index' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web-indexer' }) }));
    expect(role).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(indexerRole).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list', 'watch'] }] });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Note = resourceClients["Note"];') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const byBook = indexClients["byBook"];') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-post-notes-1.mjs': expect.stringContaining('function decoratedRouteMessage') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-post-notes-1.mjs': expect.stringContaining('noteRouteMessage') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-post-notes-1.mjs': expect.stringContaining('applik8s-route-bundle-inputs') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-post-notes-1.mjs': expect.stringContaining('imported:') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'route-get-notes-0.mjs': expect.stringContaining('byBook.query') } });
  });

  it('infers app-scoped resources from direct callable operator installs', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const notes = sdk.operator({
      name: 'notes-controller-direct-call',
      resources: { Note },
      handlers: [],
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-direct-call-inference',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppDirectCallInference',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const install = notes({ namespace: 'notes-system' });
      install.note({ name: 'hello', spec: { message: 'hi' } });
      app.server('web', {}, (server) => {
        server.post('/notes', async () => Note.create({ name: 'from-direct-call', spec: { message: 'hello' } }));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    expect(composition.operatorInstalls.map((install) => install.operatorName)).toContain('notes-controller-direct-call');
    expect(role).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Note = resourceClients["Note"];') } });
  });

  it('fails fast when function captures close over undeclared values', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const prefix = 'page';
    const label = (value: number) => `${prefix}-${value}`;

    expect(() => sdk.kubernetesComposition({
      name: 'notes-app-function-capture',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppFunctionCapture',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note }, captures: { label } }, (server) => {
        server.get('/config', async () => ({ label: label(10) }));
      });
      return { ready: true };
    })).toThrow(/app\.server capture "label" cannot serialize closure identifier\(s\): prefix/);
  });

  it('infers server list RBAC for uncached request-path index queries', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
      orderBy: metadata.creationTimestamp.desc(),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-uncached-index',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppUncachedIndex',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { indexes: { byBook } }, (server) => {
        server.get('/notes', async () => byBook.query('main'));
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    expect(role).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list'] }] });
  });

  it('infers server RBAC from supported route method aliases without scanning strings', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-alias-permissions',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppAliasPermissions',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note } }, (server) => {
        server.post('/notes', async () => {
          const createNote = Note.create;
          const text = 'Note.delete({ name: "not-real" })';
          await createNote({ name: 'alias', spec: { message: text } });
          return { ok: true };
        });
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'web');
    expect(role).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
  });

  it('fails closed for dynamic app.server resource client access', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });

    expect(() => sdk.kubernetesComposition({
      name: 'notes-app-dynamic-client-access',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppDynamicClientAccess',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.server('web', { resources: { Note } }, (server) => {
        // biome-ignore lint/complexity/useLiteralKeys: exercises fail-closed dynamic client access.
        server.post('/notes', async () => Note['create']({ name: 'dynamic', spec: { message: 'hidden' } }));
      });
      return { ready: true };
    })).toThrow(/app\.server route POST \/notes uses unsupported dynamic binding access: Note/);
  });

  it('generates a debounced aggregate worker for resource index event streams', () => {
    const Book = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Book',
      spec: type({ title: 'string' }),
      status: type({ noteCount: 'number?' }),
    });
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ book: 'string', message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const byBook = Note.index('acceptedByBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-aggregate',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppAggregate',
      spec: type({ namespace: 'string?' }),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.aggregate<{ count: number }, { type: string; object?: { status?: { phase?: string } }; previous?: { status?: { phase?: string } } }>('noteStats', {
        source: byBook,
        target: {
          resource: Book,
          name: 'main',
          namespace: 'notes',
          status: (stats) => ({ noteCount: stats.count }),
        },
        initial: { count: 0 },
        flush: { every: '2s', maxEvents: 10 },
        reduce(stats, event) {
          const wasAccepted = event.previous?.status?.phase === 'Accepted';
          const isAccepted = event.type !== 'deleted' && event.object?.status?.phase === 'Accepted';
          if (!wasAccepted && isAccepted) {
            return { count: stats.count + 1 };
          }
          if (wasAccepted && !isAccepted) {
            return { count: Math.max(0, stats.count - 1) };
          }
          return stats;
        },
      });
      return { ready: true };
    });

    const role = composition.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'note-stats-aggregate');
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'note-stats-aggregate-source');
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'note-stats-aggregate' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'note-stats-aggregate' }) }));
    expect(role).toMatchObject({
      rules: [
        { apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list', 'watch'] },
        { apiGroups: ['notes.applik8s.dev'], resources: ['books/status'], verbs: ['patch'] },
      ],
    });
    expect(sourceConfigMap).toMatchObject({ data: { 'aggregate.mjs': expect.stringContaining('const aggregateName = "noteStats";') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'aggregate.mjs': expect.stringContaining('async function flushAggregate(force = false)') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'aggregate.mjs': expect.stringContaining('const objectStore = new Map();') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'aggregate.mjs': expect.stringContaining('previous') } });
    expect(sourceConfigMap).toMatchObject({ data: { 'aggregate.mjs': expect.stringContaining("path: objectPath(targetResource, targetNamespace ?? aggregateNamespace(), targetName) + '/status'") } });

    const aggregate = evaluateGeneratedAggregateSource(generatedConfigMapData(composition.resources, 'note-stats-aggregate-source', 'aggregate.mjs'));
    const accepted = noteObject('ada', 'Accepted', '2026-01-01T00:00:00.000Z');
    const rejected = noteObject('ada', 'Rejected', '2026-01-01T00:00:00.000Z');
    aggregate.applySnapshotObject(accepted);
    expect(aggregate.stats()).toEqual({ count: 1 });
    aggregate.applySourceObject('MODIFIED', rejected);
    expect(aggregate.stats()).toEqual({ count: 0 });
    aggregate.applySourceObject('MODIFIED', accepted);
    expect(aggregate.stats()).toEqual({ count: 1 });
    aggregate.applySourceObject('DELETED', accepted);
    expect(aggregate.stats()).toEqual({ count: 0 });
  });

  it('keeps aggregate object state consistent when reducers fail', () => {
    const Book = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Book',
      spec: type({ title: 'string' }),
      status: type({ noteCount: 'number?' }),
    });
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ book: 'string', message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const byBook = Note.index('acceptedByBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      filter: field('status.phase').eq('Accepted'),
    });

    const composition = sdk.kubernetesComposition({
      name: 'notes-app-aggregate-reducer-failure',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesAppAggregateReducerFailure',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.aggregate<{ count: number }, { type: string; object?: { metadata?: { name?: string }; status?: { phase?: string } }; previous?: { status?: { phase?: string } } }>('noteStats', {
        source: byBook,
        target: {
          resource: Book,
          name: 'main',
          namespace: 'notes',
          status: (stats) => ({ noteCount: stats.count }),
        },
        initial: { count: 0 },
        reduce(stats, event) {
          if (event.type === 'created' && event.object?.metadata?.name === 'boom') {
            throw new Error('boom reducer');
          }
          const wasAccepted = event.previous?.status?.phase === 'Accepted';
          const isAccepted = event.type !== 'deleted' && event.object?.status?.phase === 'Accepted';
          if (!wasAccepted && isAccepted) {
            return { count: stats.count + 1 };
          }
          if (wasAccepted && !isAccepted) {
            return { count: stats.count - 1 };
          }
          return stats;
        },
      });
      return { ready: true };
    });

    const aggregate = evaluateGeneratedAggregateSource(generatedConfigMapData(composition.resources, 'note-stats-aggregate-source', 'aggregate.mjs'));
    const boom = noteObject('boom', 'Accepted', '2026-01-01T00:00:00.000Z');

    expect(() => aggregate.applySourceObject('ADDED', boom)).toThrow('boom reducer');
    expect(aggregate.stats()).toEqual({ count: 0 });
    aggregate.applySourceObject('DELETED', boom);
    expect(aggregate.stats()).toEqual({ count: 0 });
  });

  it('re-exports TypeKro factories through the applik8s factories surface', () => {
    expect(cnpg.cluster).toBeTypeOf('function');
    expect(simple.Deployment).toBeTypeOf('function');
    expect(valkey.valkey).toBeTypeOf('function');
    expect(kubernetesFactories).toBeTypeOf('object');
  });

  it('builds generated app infrastructure on existing TypeKro Kubernetes factories', async () => {
    const source = await readFile(new URL('../src/application.ts', import.meta.url), 'utf8');

    expect(source).toContain("from 'typekro/kubernetes'");
    expect(source).toContain('deployment as typeKroDeployment');
    expect(source).toContain('serviceAccount as typeKroServiceAccount');
    expect(source).not.toMatch(/\bcreateResource\s*\(/);
  });

  it('declares package exports for the v0.2 TypeKro integration subpaths', async () => {
    const packageJson = JSON.parse(await readFile('packages/applik8s/package.json', 'utf8'));

    expect(packageJson.exports).toMatchObject({
      './dsl': './src/dsl.ts',
      './typekro': './src/typekro.ts',
      './factories': './src/factories.ts',
      './factories/*': './src/factories/*.ts',
    });
  });
});

describe('generated Valkey-backed application runtime', () => {
  it('executes generated cached index queries against Valkey without Kubernetes list reads', async () => {
    const { runtimeSource, bindingsSource, routesSource, routeSources } = generatedValkeyAppSources();
    const ada = noteObject('ada', 'Accepted', '2026-01-01T00:00:00.000Z');
    const grace = noteObject('grace', 'Accepted', '2026-01-02T00:00:00.000Z');
    const commands: string[][] = [];
    const objects = new Map([
      ['applik8s:index:byBook:object:test-ns/grace', JSON.stringify(grace)],
      ['applik8s:index:byBook:object:test-ns/ada', JSON.stringify(ada)],
    ]);
    const createConnection = createFakeValkeyConnection(commands, (parts) => {
      if (parts[0] === 'ZREVRANGE') {
        return ['test-ns/grace', 'test-ns/ada'];
      }
      if (parts[0] === 'MGET') {
        return parts.slice(1).map((key) => objects.get(key));
      }
      throw new Error(`Unexpected Valkey command: ${parts.join(' ')}`);
    });

    const sandbox = evaluateGeneratedServerBundle(runtimeSource, bindingsSource, routesSource, routeSources, createConnection);
    const route = sandbox.__handlers?.find((handler) => handler.method === 'GET' && handler.path === '/notes');

    expect(route).toBeDefined();
    expect(await route?.handler({ query: {}, formData: async () => ({}) })).toEqual({ items: [grace, ada], nextCursor: '2' });
    expect(commands).toEqual([
      ['ZREVRANGE', 'applik8s:index:byBook:partition:test-ns:main', '0', '1'],
      ['MGET', 'applik8s:index:byBook:object:test-ns/grace', 'applik8s:index:byBook:object:test-ns/ada'],
    ]);
  });

  it('executes generated indexer watch-event upsert and removal commands', async () => {
    const { indexerSource } = generatedValkeyAppSources();
    const commands: string[][] = [];
    const createConnection = createFakeValkeyConnection(commands, (parts) => {
      if (parts[0] === 'SMEMBERS') {
        return ['legacy'];
      }
      if (parts[0] === 'ZREM' || parts[0] === 'SADD' || parts[0] === 'ZADD') {
        return 1;
      }
      return 'OK';
    });

    const indexer = evaluateGeneratedIndexerSource(indexerSource, createConnection);
    const index = indexer.runtimeIndexes.byBook;
    const accepted = noteObject('ada', 'Accepted', '2026-01-01T00:00:00.000Z');
    await indexer.upsertIndexedItem(index, accepted);

    expect(commands).toEqual([
      ['SMEMBERS', 'applik8s:index:byBook:partitions:test-ns'],
      ['ZREM', 'applik8s:index:byBook:partition:test-ns:legacy', 'test-ns/ada'],
      ['DEL', 'applik8s:index:byBook:object:test-ns/ada'],
      ['SET', 'applik8s:index:byBook:object:test-ns/ada', JSON.stringify(accepted)],
      ['SADD', 'applik8s:index:byBook:partitions:test-ns', 'main'],
      ['ZADD', 'applik8s:index:byBook:partition:test-ns:main', String(Date.parse('2026-01-01T00:00:00.000Z')), 'test-ns/ada'],
    ]);

    commands.length = 0;
    await indexer.upsertIndexedItem(index, noteObject('ada', 'Rejected', '2026-01-01T00:00:00.000Z'));

    expect(commands).toEqual([
      ['SMEMBERS', 'applik8s:index:byBook:partitions:test-ns'],
      ['ZREM', 'applik8s:index:byBook:partition:test-ns:legacy', 'test-ns/ada'],
      ['DEL', 'applik8s:index:byBook:object:test-ns/ada'],
    ]);
  });

  it('fails generated request-path index queries that cannot be constrained before Kubernetes access', async () => {
    const { runtimeSource, bindingsSource, routesSource, routeSources } = generatedUnsafeIndexAppSources();
    const sandbox = evaluateGeneratedServerBundle(runtimeSource, bindingsSource, routesSource, routeSources, createFakeValkeyConnection([], () => []));
    const route = sandbox.__handlers?.find((handler) => handler.method === 'GET' && handler.path === '/notes');

    expect(route).toBeDefined();
    await expect(route?.handler({ query: {}, formData: async () => ({}) })).rejects.toThrow('cannot be queried from a request path without a label partition or label filter');
  });

  it('retries buffered resource counter flushes after Kubernetes failures', async () => {
    const { runtimeSource } = generatedCounterAppSources();
    let failGet = true;
    const requests: { readonly method?: string; readonly path?: string; readonly body?: string }[] = [];
    const runtime = evaluateGeneratedRuntimeSource(runtimeSource, createFakeKubernetesHttpsRequest((request) => {
      requests.push(request);
      if (request.method === 'GET' && failGet) {
        return { statusCode: 500, body: { message: 'temporary apiserver failure' } };
      }
      if (request.method === 'GET') {
        return { statusCode: 404, body: { message: 'not found' } };
      }
      if (request.method === 'POST') {
        return { statusCode: 201, body: JSON.parse(request.body ?? '{}') };
      }
      throw new Error(`Unexpected Kubernetes request: ${request.method ?? 'GET'} ${request.path ?? '/'}`);
    }));
    const pageViews = runtime.createRuntimeBindings().resourceClients.PageViewBucket;
    if (!pageViews) {
      throw new Error('Generated counter runtime did not expose PageViewBucket.');
    }

    await pageViews.increment({
      name: 'main-views',
      namespace: 'test-ns',
      labels: { 'notes.applik8s.dev/book': 'main' },
      spec: { note: 'main', windowStart: '2026-07-01T00:00:00.000Z' },
      field: 'spec.count',
    });
    await expect(runtime.flushResourceCounterBuffers()).rejects.toThrow('temporary apiserver failure');

    failGet = false;
    await runtime.flushResourceCounterBuffers();

    const post = requests.find((request) => request.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      metadata: { name: 'main-views', namespace: 'test-ns', labels: { 'notes.applik8s.dev/book': 'main' } },
      spec: { note: 'main', windowStart: '2026-07-01T00:00:00.000Z', count: 1 },
    });
  });
});

function generatedValkeyAppSources(): { readonly serverSource: string; readonly runtimeSource: string; readonly bindingsSource: string; readonly routesSource: string; readonly routeSources: readonly string[]; readonly indexerSource: string } {
  const Note = sdk.crd({
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'Note',
    spec: type({ message: 'string' }),
    status: type({ phase: 'string?' }),
  });
  const byBook = Note.index('byBook', {
    partitionBy: label('notes.applik8s.dev/book'),
    filter: field('status.phase').eq('Accepted'),
    orderBy: metadata.creationTimestamp.desc(),
  });
  const composition = sdk.kubernetesComposition({
    name: 'notes-app-runtime',
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'NotesAppRuntime',
    spec: type({ namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  }, (_spec, app) => {
    app.server('web', {
      namespace: 'test-ns',
      service: { port: 80 },
      indexes: { byBook },
      cache: [byBook],
      indexBackend: { kind: 'valkey', host: 'valkey.test-ns.svc.cluster.local' },
    }, (server) => {
      server.get('/notes', async () => byBook.query('main', { limit: 2 }));
    });
    return { ready: false };
  });
  return {
    serverSource: generatedConfigMapData(composition.resources, 'web-source', 'server.mjs'),
    runtimeSource: generatedConfigMapData(composition.resources, 'web-source', 'runtime.mjs'),
    bindingsSource: generatedConfigMapData(composition.resources, 'web-source', 'bindings.mjs'),
    routesSource: generatedConfigMapData(composition.resources, 'web-source', 'routes.mjs'),
    routeSources: [generatedConfigMapData(composition.resources, 'web-source', 'route-get-notes-0.mjs')],
    indexerSource: generatedConfigMapData(composition.resources, 'web-indexer-source', 'indexer.mjs'),
  };
}

function generatedUnsafeIndexAppSources(): { readonly runtimeSource: string; readonly bindingsSource: string; readonly routesSource: string; readonly routeSources: readonly string[] } {
  const Note = sdk.crd({
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'Note',
    spec: type({ message: 'string' }),
    status: type({ phase: 'string?' }),
  });
  const byPhase = Note.index('byPhase', {
    partitionBy: field('status.phase'),
    orderBy: metadata.creationTimestamp.desc(),
  });
  const composition = sdk.kubernetesComposition({
    name: 'notes-app-unsafe-index-runtime',
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'NotesAppUnsafeIndexRuntime',
    spec: type({}),
    status: type({ ready: 'boolean' }),
  }, (_spec, app) => {
    app.server('web', {
      namespace: 'test-ns',
      service: { port: 80 },
      indexes: { byPhase },
    }, (server) => {
      server.get('/notes', async () => byPhase.query('Accepted', { limit: 2 }));
    });
    return { ready: false };
  });
  return {
    runtimeSource: generatedConfigMapData(composition.resources, 'web-source', 'runtime.mjs'),
    bindingsSource: generatedConfigMapData(composition.resources, 'web-source', 'bindings.mjs'),
    routesSource: generatedConfigMapData(composition.resources, 'web-source', 'routes.mjs'),
    routeSources: [generatedConfigMapData(composition.resources, 'web-source', 'route-get-notes-0.mjs')],
  };
}

function generatedCounterAppSources(): { readonly runtimeSource: string } {
  const PageViewBucket = sdk.crd({
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'PageViewBucket',
    spec: type({ note: 'string', windowStart: 'string', count: 'number' }),
    status: type({ observedCount: 'number?' }),
  });
  const composition = sdk.kubernetesComposition({
    name: 'notes-app-counter-runtime',
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'NotesAppCounterRuntime',
    spec: type({}),
    status: type({ ready: 'boolean' }),
  }, (_spec, app) => {
    app.server('web', { namespace: 'test-ns', resources: { PageViewBucket } }, (server) => {
      server.get('/', async () => PageViewBucket.increment({
        name: 'main-views',
        namespace: 'test-ns',
        labels: { 'notes.applik8s.dev/book': 'main' },
        spec: { note: 'main', windowStart: '2026-07-01T00:00:00.000Z' },
        field: 'spec.count',
      }));
    });
    return { ready: false };
  });
  return { runtimeSource: generatedConfigMapData(composition.resources, 'web-source', 'runtime.mjs') };
}

function generatedConfigMapData(resources: readonly { readonly kind?: string; readonly metadata?: { readonly name?: string }; readonly data?: Readonly<Record<string, string>> }[], name: string, key: string): string {
  const configMap = resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata?.name === name);
  const value = configMap?.data?.[key];
  if (typeof value !== 'string') {
    throw new Error(`Generated ConfigMap ${name} is missing ${key}.`);
  }
  return value;
}

function evaluateGeneratedServerBundle(runtimeSource: string, routesSource: string, createConnection: FakeValkeyConnectionFactory): GeneratedServerSandbox;
function evaluateGeneratedServerBundle(runtimeSource: string, bindingsSource: string, routesSource: string, routeSources: readonly string[], createConnection: FakeValkeyConnectionFactory): GeneratedServerSandbox;
function evaluateGeneratedServerBundle(runtimeSource: string, bindingsOrRoutesSource: string, routesOrCreateConnection: string | FakeValkeyConnectionFactory, routeSources: readonly string[] = [], maybeCreateConnection?: FakeValkeyConnectionFactory): GeneratedServerSandbox {
  const bindingsSource = typeof routesOrCreateConnection === 'string' ? bindingsOrRoutesSource : '';
  const routesSource = typeof routesOrCreateConnection === 'string' ? routesOrCreateConnection : bindingsOrRoutesSource;
  const createConnection = typeof routesOrCreateConnection === 'function' ? routesOrCreateConnection : maybeCreateConnection;
  if (!createConnection) {
    throw new Error('Generated server test requires a connection factory.');
  }
  const processShim: { readonly env: { readonly APPLIK8S_SERVER_NAMESPACE: string }; once: (..._args: unknown[]) => unknown } = {
    env: { APPLIK8S_SERVER_NAMESPACE: 'test-ns' },
    once: () => processShim,
  };
  const sandbox: GeneratedServerSandbox & Record<string, unknown> = {
    createConnection,
    readFile: async () => '',
    httpsRequest: () => {
      throw new Error('Generated cached index query unexpectedly called Kubernetes.');
    },
    process: processShim,
    Buffer,
    URL,
    URLSearchParams,
    console,
  };
  runInNewContext([
    withoutGeneratedImportsAndExports(runtimeSource),
    bindingsSource ? withoutGeneratedImportsAndExports(bindingsSource) : '',
    ...routeSources.map(withoutGeneratedImportsAndExports),
    withoutGeneratedImportsAndExports(routesSource),
    'globalThis.__handlers = routes;',
  ].join('\n'), sandbox, { timeout: 1000 });
  return sandbox;
}

function evaluateGeneratedAggregateSource(source: string): GeneratedAggregateExports {
  const withoutImports = withoutGeneratedImports(source);
  const startupStart = withoutImports.indexOf('void startWatchLoop();');
  const functionsStart = withoutImports.indexOf('async function syncAggregate()');
  if (startupStart === -1 || functionsStart === -1 || functionsStart <= startupStart) {
    throw new Error('Generated aggregate source startup block was not found.');
  }
  const executable = `${withoutImports.slice(0, startupStart)}${withoutImports.slice(functionsStart)}\nglobalThis.__aggregate = { applySourceObject, applySnapshotObject, stats: () => stats };`;
  const sandbox: GeneratedAggregateSandbox & Record<string, unknown> = {
    readFile: async () => '',
    httpsRequest: () => {
      throw new Error('Generated aggregate helper unexpectedly called Kubernetes.');
    },
    process: { env: { APPLIK8S_AGGREGATE_NAMESPACE: 'test-ns' } },
    structuredClone,
    URLSearchParams,
    console,
  };
  runInNewContext(executable, sandbox, { timeout: 1000 });
  if (!sandbox.__aggregate) {
    throw new Error('Generated aggregate exports were not captured.');
  }
  return sandbox.__aggregate;
}

function evaluateGeneratedRuntimeSource(source: string, httpsRequest: FakeHttpsRequest): GeneratedRuntimeExports {
  const executable = `${withoutGeneratedImportsAndExports(source)}\nglobalThis.__runtime = { createRuntimeBindings, flushResourceCounterBuffers };`;
  const processShim: { readonly env: { readonly APPLIK8S_SERVER_NAMESPACE: string }; once: (..._args: unknown[]) => unknown; exit: (_code?: number) => never } = {
    env: { APPLIK8S_SERVER_NAMESPACE: 'test-ns' },
    once: () => processShim,
    exit: () => {
      throw new Error('Generated runtime unexpectedly exited.');
    },
  };
  const sandbox: GeneratedRuntimeSandbox & Record<string, unknown> = {
    readFile: async () => '',
    httpsRequest,
    createConnection: () => {
      throw new Error('Generated counter runtime unexpectedly opened a Valkey connection.');
    },
    process: processShim,
    setInterval: () => ({ unref: () => undefined }),
    Buffer,
    URLSearchParams,
    console,
  };
  runInNewContext(executable, sandbox, { timeout: 1000 });
  if (!sandbox.__runtime) {
    throw new Error('Generated runtime exports were not captured.');
  }
  return sandbox.__runtime;
}

function evaluateGeneratedIndexerSource(source: string, createConnection: FakeValkeyConnectionFactory): GeneratedIndexerExports {
  const withoutImports = withoutGeneratedImports(source);
  const startupStart = withoutImports.indexOf('await syncAllIndexes();');
  const functionsStart = withoutImports.indexOf('async function syncAllIndexes()');
  if (startupStart === -1 || functionsStart === -1 || functionsStart <= startupStart) {
    throw new Error('Generated indexer source startup block was not found.');
  }
  const executable = `${withoutImports.slice(0, startupStart)}${withoutImports.slice(functionsStart)}\nglobalThis.__indexer = { runtimeIndexes, upsertIndexedItem, removeIndexedItem };`;
  const sandbox: GeneratedIndexerSandbox & Record<string, unknown> = {
    createConnection,
    readFile: async () => '',
    httpsRequest: () => {
      throw new Error('Generated watch-event indexer helper unexpectedly called Kubernetes.');
    },
    process: { env: { APPLIK8S_SERVER_NAMESPACE: 'test-ns' } },
    Buffer,
    URLSearchParams,
    console,
  };
  runInNewContext(executable, sandbox, { timeout: 1000 });
  if (!sandbox.__indexer) {
    throw new Error('Generated indexer exports were not captured.');
  }
  return sandbox.__indexer;
}

function withoutGeneratedImports(source: string): string {
  return source.replace(/^import .*;\n/gm, '');
}

function withoutGeneratedImportsAndExports(source: string): string {
  return withoutGeneratedImports(source).replace(/^export /gm, '');
}

function createFakeValkeyConnection(commands: string[][], respond: (parts: readonly string[]) => unknown): FakeValkeyConnectionFactory {
  return (_options, onConnect) => {
    const listeners: Partial<Record<'data' | 'error', (payload: string | Error) => void>> = {};
    const socket = {
      setEncoding: () => undefined,
      on: (event: 'data' | 'error', listener: (payload: string | Error) => void) => {
        listeners[event] = listener;
      },
      write: (payload: string) => {
        const parts = decodeRespArray(payload);
        commands.push(parts);
        queueMicrotask(() => listeners.data?.(encodeRespValue(respond(parts))));
      },
      end: () => undefined,
      destroy: () => undefined,
    };
    queueMicrotask(() => onConnect?.());
    return socket;
  };
}

function createFakeKubernetesHttpsRequest(respond: (request: { readonly method?: string; readonly path?: string; readonly body?: string }) => { readonly statusCode: number; readonly body?: unknown }): FakeHttpsRequest {
  return (options, callback) => {
    const chunks: string[] = [];
    const listeners: Partial<Record<'error', (error: Error) => void>> = {};
    return {
      on: (event, listener) => {
        listeners[event] = listener;
      },
      write: (payload) => {
        chunks.push(payload);
      },
      end: () => {
        queueMicrotask(() => {
          try {
            const body = chunks.join('') || undefined;
            const result = respond({
              ...(options.method ? { method: options.method } : {}),
              ...(options.path ? { path: options.path } : {}),
              ...(body ? { body } : {}),
            });
            const responseBody = result.body === undefined ? '' : JSON.stringify(result.body);
            callback({
              statusCode: result.statusCode,
              setEncoding: () => undefined,
              on: (event, listener) => {
                if (event === 'data' && responseBody) {
                  queueMicrotask(() => listener(responseBody));
                }
                if (event === 'end') {
                  queueMicrotask(() => listener());
                }
              },
            });
          } catch (error) {
            listeners.error?.(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    };
  };
}

function decodeRespArray(input: string): string[] {
  if (input[0] !== '*') {
    throw new Error(`Expected RESP array, got ${input[0] ?? 'empty input'}.`);
  }
  const firstLineEnd = input.indexOf('\r\n');
  const count = Number(input.slice(1, firstLineEnd));
  const values: string[] = [];
  let offset = firstLineEnd + 2;
  for (let index = 0; index < count; index += 1) {
    if (input[offset] !== '$') {
      throw new Error(`Expected RESP bulk string at ${offset}.`);
    }
    const lengthEnd = input.indexOf('\r\n', offset);
    const length = Number(input.slice(offset + 1, lengthEnd));
    const valueStart = lengthEnd + 2;
    values.push(input.slice(valueStart, valueStart + length));
    offset = valueStart + length + 2;
  }
  return values;
}

function encodeRespValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `*${value.length}\r\n${value.map(encodeRespValue).join('')}`;
  }
  if (value === undefined || value === null) {
    return '$-1\r\n';
  }
  if (typeof value === 'number') {
    return `:${value}\r\n`;
  }
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

function noteObject(name: string, phase: string, creationTimestamp: string): object {
  return {
    apiVersion: 'notes.applik8s.dev/v1alpha1',
    kind: 'Note',
    metadata: {
      namespace: 'test-ns',
      name,
      creationTimestamp,
      labels: { 'notes.applik8s.dev/book': 'main' },
    },
    spec: { message: `${name} says hi` },
    status: { phase },
  };
}
