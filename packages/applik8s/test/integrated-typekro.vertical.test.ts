// typecast-file-boundary: integration fixtures inspect TypeKro proxy and serialized manifest boundaries after graph validation.
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import type { ApplicationModelBinding, ApplicationProviderToken, ApplicationTransactionalDatabaseProvider } from '@applik8s/applik8s';
import { app, applicationGraphFor, Certificate, ContainerRegistry, CounterStore, CredentialStore, cel, DnsPublication, EventSource, HttpExposure, IndexStore, inferRbac, kubernetesComposition, ObjectStorage, permissions, providers, Queue, resolveOperatorInstalls, resources, Secret, sdk, TransactionalDatabase, typeKro } from '@applik8s/applik8s';
import type { ApplicationRuntimeModuleInterfaceContract, ApplicationRuntimeModuleManifestContract, OperationTarget, Result } from '@applik8s/core';
import { serializeApplicationGraph, validateApplicationGraphCompatibilityPolicy, validateApplicationJobStatusLifecycleContract, validateApplicationProviderInterfaceContract, validateApplicationRuntimeModuleInterfaceContract, validateApplicationRuntimeModuleManifestContract, validateApplicationTransactionalDatabaseSemanticsContract } from '@applik8s/core';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { mergeGeneratedJobStatusConfigMapData, patchGeneratedJobStatusConfigMapData, persistGeneratedJobStatusWithDurableFallback, summarizeGeneratedJobStatusConfigMapMerge } from '../src/application-generated-job-status.js';
import { applicationGeneratedStatusConcurrencyContract } from '../src/application-jobs.js';
import { generatedRuntimeModuleBundle } from '../src/application-runtime-module-bundle.js';
import { generatedApplicationRuntimeModuleKinds, generatedApplicationRuntimeModuleManifest } from '../src/application-runtime-module-manifest.js';
import { generatedRuntimeModuleSource, generatedRuntimeModuleSourcePreamble } from '../src/application-runtime-module-sources.js';
import { generatedApplicationRuntimeModuleSource } from '../src/application-runtime-modules.js';
import { serializeApplicationServerCaptures } from '../src/application-server-routing.js';
import { type GeneratedServerRuntimeBundleContract, validateGeneratedServerRuntimeBundleContract } from '../src/application-server-runtime-bundle.js';
import { entity, field, label, metadata, type } from '../src/dsl.js';
import * as kubernetesFactories from '../src/factories/kubernetes.js';
import { cnpg, rook, simple, valkey } from '../src/factories.js';
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
    expect(app).toBeTypeOf('function');
    expect(sdk.app).toBe(app);
    expect(sdk.kubernetesComposition).toBe(kubernetesComposition);
    expect(providers.IndexStore).toBe(IndexStore);
    expect(providers.TransactionalDatabase).toBe(TransactionalDatabase);
    expect(providers.CounterStore).toBe(CounterStore);
    expect(providers.EventSource).toBe(EventSource);
    expect(providers.Secret).toBe(Secret);
    expect(providers.Queue).toBe(Queue);
    expect(providers.ObjectStorage).toBe(ObjectStorage);
    expect(providers.HttpExposure).toBe(HttpExposure);
    expect(providers.CredentialStore).toBe(CredentialStore);
    expect(providers.ContainerRegistry).toBe(ContainerRegistry);
    expect(cel).toBeTypeOf('function');
  });

  it('exports the v0.2 application DSL helpers', () => {
    expect(field('status.phase').eq('Accepted')).toMatchObject({ expressionKind: 'predicate', operator: 'eq' });
    expect(label('guestbook.applik8s.dev/book').value).toBe('guestbook.applik8s.dev/book');
    expect(metadata.creationTimestamp.desc()).toMatchObject({ expressionKind: 'ordering', direction: 'desc' });
    expect(entity('Note', { spec: type({ message: 'string' }) })).toMatchObject({ kind: 'applik8sEntity', name: 'Note' });
  });

  it('plans generated server and job operation targets from dry-run artifacts without effects', () => {
    const target = artifactOnlyOperationTarget();
    let serverPlan: unknown;
    let jobPlan: unknown;
    let serverApplyPlan: unknown;
    let missingDryRunPlan: unknown;
    let missingApplyPlan: unknown;
    const composition = sdk.kubernetesComposition({
      name: 'generated-binding-plan-app',
      apiVersion: 'plans.applik8s.dev/v1alpha1',
      kind: 'GeneratedBindingPlanApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const server = app.server('admin', {}, (routes) => {
        routes.get('/', async () => ({ ready: true }));
      });
      const job = app.job('repair', { taskKind: 'repair' });
      serverPlan = server.plan(target, { dryRun: true, fieldManager: 'generated-server-dry-run' });
      jobPlan = job.plan(target, { dryRun: true, fieldManager: 'generated-job-dry-run' });
      serverApplyPlan = server.plan(target, { fieldManager: 'generated-server-apply-plan' });
      missingDryRunPlan = job.plan(artifactOnlyOperationTarget({ dryRun: false }), { dryRun: true });
      missingApplyPlan = job.plan(artifactOnlyOperationTarget({ apply: false }));
      return { ready: true };
    });

    expect(serverPlan).toMatchObject({ ok: true, value: { operations: [expect.objectContaining({ kind: 'apply', fieldManager: 'generated-server-dry-run', resource: expect.objectContaining({ kind: 'ConfigMap' }) })] } });
    expect(jobPlan).toMatchObject({ ok: true, value: { operations: [expect.objectContaining({ kind: 'apply', fieldManager: 'generated-job-dry-run', resource: expect.objectContaining({ metadata: expect.objectContaining({ name: 'artifact-dry-run' }) }) })] } });
    expect(serverApplyPlan).toMatchObject({ ok: true, value: { operations: [expect.objectContaining({ kind: 'apply', fieldManager: 'generated-server-apply-plan', resource: expect.objectContaining({ metadata: expect.objectContaining({ name: 'artifact-apply' }) }) })] } });
    expect(missingDryRunPlan).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'LIFECYCLE_UNSAFE', message: expect.stringContaining('dryRunPlan artifact') }) });
    expect(missingApplyPlan).toMatchObject({ ok: false, error: expect.objectContaining({ code: 'LIFECYCLE_UNSAFE', message: expect.stringContaining('applyPlan artifact') }) });
    expect(composition.resources.map((resource) => resource.metadata.name)).not.toEqual(expect.arrayContaining(['artifact-apply', 'artifact-dry-run']));
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
    expect(plainValue(role)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Note = resourceClients["Note"];') } });

    const modelImplicitDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-model-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity);
      return { ready: true };
    });
    expect(applicationGraphFor(modelImplicitDefaultComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase', implementation: 'postgres' }),
      expect.objectContaining({ id: 'model.note', kind: 'model', name: 'Note' }),
    ]));

    const modelDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-model-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ database: { kind: 'postgres' } });
      return { ready: true };
    });
    expect(applicationGraphFor(modelDefaultComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase', implementation: 'postgres', config: expect.objectContaining({ bindingKind: 'default', provider: 'postgres', transactionalDatabase: { kind: 'postgres' } }) }),
    ]));

    expect(() => sdk.kubernetesComposition({
      name: 'notes-model-events-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelEventsApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'notes-db', database: 'notes' });
      const Note = app.model(NoteEntity, { database: store });
      Note.on.created(async () => undefined);
      return { ready: true };
    })).toThrow(/requires transactional model event delivery/);

    const counterDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-counter-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesCounterDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ counters: { kind: 'kubernetes-resource-counter' } });
      return { ready: true };
    });
    expect(applicationGraphFor(counterDefaultComposition)?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'provider', name: 'CounterStore', implementation: 'kubernetes-resource-counter' })]));

    const eventDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-events-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesEventsDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ events: { kind: 'kubernetes-watch' } });
      return { ready: true };
    });
    expect(applicationGraphFor(eventDefaultComposition)?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'provider', name: 'EventSource', implementation: 'kubernetes-watch' })]));

    const exposureDefaultComposition = sdk.kubernetesComposition({
      name: 'notes-expose-default-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesExposeDefaultApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.defaults({ expose: 'ingress' });
      return { ready: true };
    });
    expect(applicationGraphFor(exposureDefaultComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'provider.http-exposure',
        kind: 'provider',
        name: 'HttpExposure',
        implementation: 'ingress',
        config: expect.objectContaining({
          bindingKind: 'default',
          provider: 'ingress',
        }),
      }),
    ]));

    expect(() => sdk.kubernetesComposition({
      name: 'notes-expose-default-gateway-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesExposeDefaultGatewayApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      // typecast: force an unsupported exposure provider shape to verify fail-closed validation.
      app.defaults({ expose: { kind: 'gateway' } as never });
      return { ready: true };
    })).toThrow(/requires HttpExposure\.ingress\(\.\.\.\) or HttpExposure\.nodePort\(\.\.\.\)/);

    const appInfraComposition = sdk.kubernetesComposition({
      name: 'notes-infra-bindings-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesInfraBindingsApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(HttpExposure, { kind: 'ingress', ingressClassName: 'nginx' });
      const config = app.config('database-url', { namespace: 'notes', env: 'DATABASE_URL', mountPath: '/etc/applik8s/config', configMapName: 'notes-app-config', key: 'database-url', value: 'postgres://example.invalid/notes' });
      const secret = app.secret('database-password', { namespace: 'notes', env: 'DATABASE_PASSWORD', mountPath: '/etc/applik8s/secrets', secretName: 'notes-db-app', key: 'password', redaction: 'required' });
      const generatedSecret = app.secret('session-key', { namespace: 'notes', ownership: 'generated' });
      const web = app.server('web', { namespace: 'notes', config: [config], secrets: [secret] }, (server) => {
        server.get('/healthz', async () => ({ ok: true }));
      });
      const exposure = app.expose('web', { service: web, servicePort: 8080, hostnames: ['notes.example.test'], tls: { mode: 'external', secretName: 'notes-web-tls' } });
      expect(config.resourceName).toBe('notes-app-config');
      expect(secret.resourceName).toBe('notes-db-app');
      expect(secret.ownership).toBe('external');
      expect(generatedSecret.ownership).toBe('generated');
      expect(web.serviceName).toBe('web');
      expect(exposure.hostnames).toEqual(['notes.example.test']);
      expect(exposure.tlsIntent).toEqual({ mode: 'external', secretName: 'notes-web-tls' });
      return { ready: true };
    });
    expect(plainValue(appInfraComposition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-app-config', namespace: 'notes' }), data: { 'database-url': 'postgres://example.invalid/notes' } }),
      expect.objectContaining({ kind: 'Secret', metadata: expect.objectContaining({ name: 'session-key-secret', namespace: 'notes' }), type: 'Opaque' }),
      expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: expect.objectContaining({ name: 'web', namespace: 'notes' }),
        spec: expect.objectContaining({
          template: expect.objectContaining({
            spec: expect.objectContaining({
              containers: [expect.objectContaining({
                env: expect.arrayContaining([
                  expect.objectContaining({ name: 'DATABASE_URL', valueFrom: { configMapKeyRef: { name: 'notes-app-config', key: 'database-url' } } }),
                  expect.objectContaining({ name: 'DATABASE_PASSWORD', valueFrom: { secretKeyRef: { name: 'notes-db-app', key: 'password' } } }),
                ]),
                volumeMounts: expect.arrayContaining([
                  expect.objectContaining({ name: 'applik8s-config-database-url', mountPath: '/etc/applik8s/config', readOnly: true }),
                  expect.objectContaining({ name: 'applik8s-secret-database-password', mountPath: '/etc/applik8s/secrets', readOnly: true }),
                ]),
              })],
              volumes: expect.arrayContaining([
                expect.objectContaining({ name: 'applik8s-config-database-url', configMap: { name: 'notes-app-config' } }),
                expect.objectContaining({ name: 'applik8s-secret-database-password', secret: { secretName: 'notes-db-app' } }),
              ]),
            }),
          }),
        }),
      }),
      expect.objectContaining({ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: expect.objectContaining({ name: 'web-ingress', namespace: 'notes' }), spec: expect.objectContaining({ ingressClassName: 'nginx', rules: [expect.objectContaining({ host: 'notes.example.test' })], tls: [{ hosts: ['notes.example.test'], secretName: 'notes-web-tls' }] }) }),
    ]));
    expect(plainValue(appInfraComposition.resources)).not.toContainEqual(expect.objectContaining({ kind: 'Secret', metadata: expect.objectContaining({ name: 'notes-db-app', namespace: 'notes' }) }));
    expect(applicationGraphFor(appInfraComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'provider.http-exposure',
        kind: 'provider',
        implementation: 'ingress',
        config: expect.objectContaining({
          bindingKind: 'provided',
          provider: 'ingress',
        }),
      }),
      expect.objectContaining({ id: 'config.database-url', kind: 'config', provider: 'ConfigMap', key: 'database-url' }),
      expect.objectContaining({ id: 'secret.database-password', kind: 'secret', provider: 'Secret', ownership: 'external', redaction: 'required', generatedResources: [] }),
      expect.objectContaining({ id: 'secret.session-key', kind: 'secret', provider: 'Secret', ownership: 'generated', generatedResources: [expect.objectContaining({ role: 'secret' })] }),
      expect.objectContaining({ id: 'exposure.web', kind: 'exposure', provider: { interface: 'HttpExposure', nodeId: 'provider.http-exposure' }, hostnames: ['notes.example.test'] }),
      expect.objectContaining({ id: 'server.web', kind: 'server', generatedResources: expect.arrayContaining([
        expect.objectContaining({ role: 'config', dependsOn: [{ nodeId: 'config.database-url' }] }),
        expect.objectContaining({ role: 'secret', dependsOn: [{ nodeId: 'secret.database-password' }] }),
      ]) }),
    ]));
    expect(applicationGraphFor(appInfraComposition)?.edges).toEqual(expect.arrayContaining([
      { from: { nodeId: 'server.web' }, to: { nodeId: 'config.database-url' }, relationship: 'reads' },
      { from: { nodeId: 'server.web' }, to: { nodeId: 'secret.database-password' }, relationship: 'reads' },
    ]));

    expect(() => sdk.kubernetesComposition({
      name: 'notes-expose-required-tls-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesExposeRequiredTlsApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.expose('web', { service: 'notes-web', hostnames: ['notes.example.test'], tls: { mode: 'external', secretName: '' } });
      return { ready: true };
    })).toThrow(/requires a non-empty secretName/);

    const managedExposureComposition = sdk.kubernetesComposition({
      name: 'notes-managed-exposure-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesManagedExposureApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(Certificate, Certificate.certManager({ issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' } }));
      app.provide(DnsPublication, DnsPublication.externalDns());
      const exposure = app.expose('public-web', {
        service: 'notes-web',
        namespace: 'notes',
        hostnames: ['notes.example.test', 'www.notes.example.test'],
        tls: { mode: 'managed' },
        dns: { mode: 'managed', ttlSeconds: 120 },
      });
      expect(exposure.publicUrl).toBe('https://notes.example.test');
      expect(exposure.tlsIntent).toEqual({ mode: 'managed', secretName: 'public-web-tls' });
      expect(exposure.readiness.dns).toBe('propagationUnverified');
      return { ready: true };
    });
    expect(plainValue(managedExposureComposition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'Ingress',
        metadata: expect.objectContaining({
          annotations: expect.objectContaining({
            'external-dns.alpha.kubernetes.io/hostname': 'notes.example.test,www.notes.example.test',
            'external-dns.alpha.kubernetes.io/ttl': '120',
          }),
        }),
        spec: expect.objectContaining({ tls: [{ hosts: ['notes.example.test', 'www.notes.example.test'], secretName: 'public-web-tls' }] }),
      }),
      expect.objectContaining({
        apiVersion: 'cert-manager.io/v1',
        kind: 'Certificate',
        metadata: expect.objectContaining({ name: 'public-web-certificate', namespace: 'notes' }),
        spec: expect.objectContaining({
          secretName: 'public-web-tls',
          dnsNames: ['notes.example.test', 'www.notes.example.test'],
          issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer', group: 'cert-manager.io' },
        }),
      }),
    ]));
    const managedExposureYaml = managedExposureComposition.factory('kro').toYaml();
    expect(managedExposureYaml).toContain('kind: Ingress');
    expect(managedExposureYaml).toMatch(/readyWhen:\n\s+- \$\{true\}/);
    expect(applicationGraphFor(managedExposureComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.certificate', interface: 'Certificate', implementation: 'cert-manager' }),
      expect.objectContaining({ id: 'provider.dns-publication', interface: 'DnsPublication', implementation: 'external-dns' }),
      expect.objectContaining({
        id: 'exposure.public-web',
        publicUrl: 'https://notes.example.test',
        certificate: { interface: 'Certificate', nodeId: 'provider.certificate' },
        dnsPublication: { interface: 'DnsPublication', nodeId: 'provider.dns-publication' },
        readiness: expect.objectContaining({ certificate: 'readyCondition', dns: 'propagationUnverified' }),
      }),
    ]));

    expect(() => sdk.kubernetesComposition({
      name: 'notes-missing-certificate-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesMissingCertificateProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.expose('web', { service: 'notes-web', hostnames: ['notes.example.test'], tls: { mode: 'managed' } });
      return { ready: true };
    })).toThrow(/requires a Certificate provider/);

    const postgresTransactionalDatabase: ApplicationTransactionalDatabaseProvider = {
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
      app.defaults({ database: postgresTransactionalDatabase });
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
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', implementation: 'postgres', config: expect.objectContaining({ bindingKind: 'default', provider: 'postgres', transactionalDatabase: expect.objectContaining({ kind: 'postgres', name: 'notes-db', database: 'notes' }) }) }),
      expect.objectContaining({
        id: 'model.note',
        schema: expect.objectContaining({
          guarantees: expect.objectContaining({
            identity: 'stableId',
            uniqueness: 'databaseConstraint',
            indexes: 'declaredSecondaryIndexes',
            transactions: 'required',
            retention: 'retain',
            migrationOwnership: 'generatedJob',
            semantics: expect.objectContaining({ generatedRuntimeParity: 'required', scriptRuntimeParity: 'required' }),
          }),
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
      const provider = app.provide(TransactionalDatabase, postgresTransactionalDatabase);
      expect(provider).toEqual({ kind: 'applicationProvider', token: TransactionalDatabase, implementation: postgresTransactionalDatabase });
      return { ready: true };
    });
    const modelProviderGraph = applicationGraphFor(modelProviderComposition);
    expect(modelProviderGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase', implementation: 'postgres', config: expect.objectContaining({ bindingKind: 'provided', provider: 'postgres', transactionalDatabase: expect.objectContaining({ kind: 'postgres', name: 'notes-db', database: 'notes' }) }) }),
    ]));
    if (!modelProviderGraph) {
      throw new Error('expected notes-model-provider-app to attach an application graph');
    }
    expect(serializeApplicationGraph(modelProviderGraph)).toContain('"provider.transactional-database"');

    let directModel: ApplicationModelBinding<{ readonly message: string }, { readonly phase?: string }> | undefined;
    const directProviderModelComposition = sdk.kubernetesComposition({
      name: 'notes-model-direct-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelDirectProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      directModel = app.model(NoteEntity, { database: postgresTransactionalDatabase });
      expect(directModel.kind).toBe('applicationModel');
      return { ready: true };
    });
    const directProviderModelGraph = applicationGraphFor(directProviderModelComposition);
    expect(directProviderModelGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model.note', kind: 'model', name: 'Note', database: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' } }),
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
          reconciliation: { ownership: 'application', schemaDrift: 'generatedMigrationJob', deletionPolicy: 'deleteWithApplication' },
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
          statusLifecycle: expect.objectContaining({ ownership: expect.objectContaining({ durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'notes-model-direct-provider-app-status-reconciler-status' } }) }),
          durableStatusUpdater: expect.objectContaining({ statusOwnership: expect.objectContaining({ durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'notes-model-direct-provider-app-status-reconciler-status' } }) }),
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
      expect.objectContaining({ id: 'requirement.model.note.database', interface: 'TransactionalDatabase', consumer: { nodeId: 'model.note' }, provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' } }),
    ]));
    expect(directProviderModelGraph?.providerBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirement: 'requirement.model.note.database',
        provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
        generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'Cluster', name: 'notes-db' })]),
        runtime: expect.objectContaining({
          env: expect.objectContaining({ DATABASE_URL_SECRET: 'notes-db-app' }),
          readiness: expect.objectContaining({ dependencies: [expect.objectContaining({ kind: 'Cluster', name: 'notes-db' })] }),
        }),
        metadataLinks: expect.arrayContaining([expect.objectContaining({ purpose: 'providerDependency', graphNode: { nodeId: 'provider.transactional-database' } })]),
      }),
    ]));
    expect(directProviderModelGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { nodeId: 'provider.transactional-database' }, to: { nodeId: 'model.note' }, relationship: 'provides' }),
      expect.objectContaining({ from: { nodeId: 'job.notes-model-migration' }, to: { nodeId: 'model.note' }, relationship: 'dependsOn' }),
    ]));
    if (!directModel) {
      throw new Error('expected app.model to return a model binding for explicit Postgres provider');
    }
    await expect(directModel.create({ spec: { message: 'hi' } })).rejects.toMatchObject({
      message: expect.stringMatching(/applik8s-transactional-database-missing-credentials/),
      diagnostic: expect.objectContaining({ event: 'applik8s-transactional-database-missing-credentials', model: 'Note', env: 'APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL' }),
    });

    const providedModelComposition = sdk.kubernetesComposition({
      name: 'notes-model-provider-does-not-enable-model-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelProviderDoesNotEnableModelApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const provider = app.provide(TransactionalDatabase, postgresTransactionalDatabase);
      const model = app.model(NoteEntity, { database: provider });
      expect(model.backend).toMatchObject({
        interface: 'TransactionalDatabase',
        runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
        transactions: 'supported',
      });
      return { ready: true };
    });
    expect(applicationGraphFor(providedModelComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', implementation: 'postgres' }),
      expect.objectContaining({ id: 'model.note', kind: 'model', materialization: expect.objectContaining({ mode: 'providerBacked' }) }),
    ]));

    const untypedTransactionalDatabaseToken: ApplicationProviderToken<unknown> = { name: 'TransactionalDatabase' };
    expect(() => sdk.kubernetesComposition({
      name: 'notes-postgres-model-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesPostgresModelProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.provide(untypedTransactionalDatabaseToken, 'postgres');
      return { ready: true };
    })).toThrow(/app\.provide\(TransactionalDatabase, \.\.\.\) currently supports only the typed PostgreSQL database provider declaration/);

    expect(() => sdk.kubernetesComposition({
      name: 'notes-counter-provider-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesCounterProviderApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      // typecast: deliberately violate the token contract to exercise fail-closed runtime validation.
      app.provide(CounterStore, 'valkey' as never);
      return { ready: true };
    })).toThrow(/app\.provide\(CounterStore, \.\.\.\) does not match the bounded v0\.3 Kubernetes-native provider contract/);

    const reservedProviderTokens: readonly [ApplicationProviderToken<unknown>, string][] = [
      [EventSource, 'EventSource'],
      [Secret, 'Secret'],
      [Queue, 'Queue'],
      [ObjectStorage, 'ObjectStorage'],
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
        // typecast: deliberately violate each token contract to exercise fail-closed runtime validation.
        app.provide(token, 'reserved' as never);
        return { ready: true };
      })).toThrow(new RegExp(`app\\.provide\\(${tokenName}, \\.\\.\\.\\) does not match the bounded v0\\.3 Kubernetes-native provider contract`));
    }

    expect(() => sdk.kubernetesComposition({
      name: 'notes-http-exposure-provider-invalid-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesHttpExposureProviderInvalidApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      // typecast: force an unsupported HttpExposure alias to verify fail-closed provider validation.
      app.provide(HttpExposure, 'gateway' as never);
      return { ready: true };
    })).toThrow(/app\.provide\(HttpExposure, \.\.\.\) requires HttpExposure\.ingress\(\.\.\.\) or HttpExposure\.nodePort\(\.\.\.\)/);

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
    expect(plainValue(jobComposition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'migrate' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'migrate-diagnostics' }), data: expect.objectContaining({ phaseStatusPath: 'status.applik8s.jobs.migrate' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'migrate-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('runGeneratedJobStatusReconciler'), 'status-runtime.json': expect.stringContaining('notesjobapps') }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('discoverApplicationResourceIdentity'), 'status-runtime.json': expect.stringContaining('"statusConfigMapName"') }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler-status' }) }),
      expect.objectContaining({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }) }),
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: [''], resources: ['configmaps'], verbs: ['create', 'get', 'patch', 'update'] }),
        expect.objectContaining({ apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch'] }),
      ]) }),
      expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'notes-job-app-status-reconciler' }), spec: expect.objectContaining({ template: expect.objectContaining({ spec: expect.objectContaining({ serviceAccountName: 'notes-job-app-status-reconciler' }) }) }) }),
    ]));
    const jobRuntimeConfigMap = jobComposition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-job-app-status-reconciler-runtime');
    expect(() => transformSync(String(jobRuntimeConfigMap?.data?.['runtime__job-runner.mjs'] ?? ''), { loader: 'js', format: 'esm' })).not.toThrow();
    expect(jobRuntimeConfigMap?.data?.['runtime__job-runner.mjs']).toContain('history.json');
    expect(jobRuntimeConfigMap?.data?.['runtime__job-runner.mjs']).toContain('appendGeneratedJobHistory');
    expect(jobRuntimeConfigMap?.data?.['runtime__job-runner.mjs']).toContain('slice(-20)');
    expect(jobRuntimeConfigMap?.data?.['status-runtime.json']).toContain('"statusRoot": "status.applik8s"');
    expect(jobRuntimeConfigMap?.data?.['status-runtime.json']).toContain('"jobsPath": "status.applik8s.jobs"');
    expect(jobRuntimeConfigMap?.data?.['status-runtime.json']).toContain('"dataKeys"');
    expect(jobRuntimeConfigMap?.data?.['status-runtime.json']).toContain('"resourceVersionMergePatch"');
    const jobStatusConfigMap = jobComposition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-job-app-status-reconciler-status');
    expect(Reflect.get(jobStatusConfigMap ?? {}, '__externalRef')).toBe(true);
    const jobDiagnostics = jobComposition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'migrate-diagnostics');
    expect(jobDiagnostics?.data?.phaseStatusContract).toContain('observedGeneration');
    expect(jobDiagnostics?.data?.phaseStatusContract).toContain('metadata.generation');
    expect(jobDiagnostics?.data?.statusOwnershipContract).toContain('status.applik8s.jobs');
    expect(jobDiagnostics?.data?.statusOwnershipContract).toContain('conflicts.json');
    expect(jobDiagnostics?.data?.terminalFailureStatus).toContain('partialEffects');
    expect(jobDiagnostics?.data?.terminalFailureStatus).toContain('GeneratedJobFailed');
    expect(jobDiagnostics?.data?.observabilityContract).toContain('applik8s_generated_job_observations_total');
    expect(applicationGraphFor(jobComposition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.migrate', kind: 'job', name: 'migrate', task: expect.objectContaining({ taskKind: 'migration' }), runtime: expect.objectContaining({ materialization: 'kubernetes-job', phaseStatus: expect.objectContaining({ statusPath: 'status.applik8s.jobs.migrate' }), statusLifecycle: expect.objectContaining({ multiJob: 'appLevelReconciler', fallback: 'generatedStatusConfigMap', ownership: expect.objectContaining({ applicationStatusProjection: 'requiredAuthoritative', appStatusSchemaContract: expect.objectContaining({ jobsPath: 'status.applik8s.jobs', ownership: 'kroStatusProjection' }), durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'notes-job-app-status-reconciler-status' }, fallbackStore: expect.objectContaining({ objectOwnership: 'runtimeCreatedResource', dataKeys: expect.arrayContaining(['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt']) }) }) }), durableStatusUpdater: expect.objectContaining({ runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' }, statusOwnership: expect.objectContaining({ durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'notes-job-app-status-reconciler-status' } }) }) }) }),
    ]));
    const jobGraphNode = applicationGraphFor(jobComposition)?.nodes.find((node) => node.kind === 'job' && node.id === 'job.migrate');
    expect(jobGraphNode?.kind === 'job' && jobGraphNode.runtime.statusLifecycle ? validateApplicationJobStatusLifecycleContract(jobGraphNode.runtime.statusLifecycle) : []).toEqual([]);
    expect(jobGraphNode?.kind === 'job' ? jobGraphNode.runtime.statusLifecycle : undefined).toMatchObject({ historyRetention: { maxEntries: 20, terminalRetention: 'retain' } });

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
    expect(plainValue(scheduleComposition.resources)).toEqual(expect.arrayContaining([
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
      expect.objectContaining({ id: 'job.cleanup', kind: 'job', schedule: expect.objectContaining({ cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' }), runtime: expect.objectContaining({ materialization: 'kubernetes-cronjob', statusLifecycle: expect.objectContaining({ cronJob: 'latestRunAndHistory' }) }) }),
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
    const maintenanceResources = plainValue(multiJobComposition.resources);
    const maintenanceReconcilers = maintenanceResources.filter((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'notes-maintenance-app-status-reconciler');
    expect(maintenanceReconcilers).toHaveLength(1);
    expect(maintenanceResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('compact'), 'runtime__job-runner.mjs': expect.stringContaining('deepMerge') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'status-runtime.json': expect.stringContaining('sweep') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'compact-diagnostics' }), data: expect.objectContaining({ terminalFailureStatus: expect.stringContaining('partialEffects') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'sweep-diagnostics' }), data: expect.objectContaining({ terminalFailureStatus: expect.stringContaining('GeneratedJobFailed') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler-status' }) }),
      expect.objectContaining({ kind: 'Role', metadata: expect.objectContaining({ name: 'notes-maintenance-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: ['batch'], resources: ['jobs', 'cronjobs'], verbs: ['get', 'list', 'watch'] }),
      ]) }),
    ]));
    const maintenanceStatusConfigMap = maintenanceResources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-maintenance-app-status-reconciler-status');
    expect(Reflect.get(maintenanceStatusConfigMap ?? {}, '__externalRef')).toBe(true);
  });

  it('supports the v0.3 golden-path resource model http storage and reconcile authoring surface', () => {
    const composition = sdk.kubernetesComposition({
      name: 'tenant-platform-golden-dx',
      apiVersion: 'tenants.applik8s.dev/v1alpha1',
      kind: 'TenantPlatformGoldenDx',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const Tenant = app.resource('Tenant', {
        spec: type({ plan: "'free' | 'team' | 'enterprise'", ownerEmail: 'string' }),
        status: type({ phase: "'Pending' | 'Ready' | 'Failed'", url: 'string?' }),
      });

      app.storage.postgres('tenant-platform-db', {
        namespace: 'platform',
        database: 'tenant_platform',
        migrations: 'generated-job',
      });

      const Account = app.model('Account', {
        spec: type({ tenant: 'string', email: 'string', role: "'owner' | 'admin' | 'viewer'" }),
        indexes: { byTenant: ['tenant', 'email'] },
      });

      app.server('admin', { namespace: 'platform', resources: { Tenant }, models: { Account } }, (http) => {
        http.post('/tenants/:tenant/accounts', async () => Account.create({
          spec: { tenant: 'main', email: 'owner@example.com', role: 'owner' },
        }));
      });

      Tenant.on.reconcile(async (tenant) => {
        tenant.status.phase = 'Ready';
      });

      return { ready: true };
    });

    expect(composition.operatorInstalls).toHaveLength(1);
    expect(composition.operatorInstalls[0]?.operatorName).toBe('tenant-controller');
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'admin' }) }));
    expect(composition.resources).toContainEqual(expect.objectContaining({ kind: 'Job', metadata: expect.objectContaining({ name: 'account-migration' }) }));

    const graph = applicationGraphFor(composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'crd.tenant', kind: 'crd', name: 'Tenant', resource: expect.objectContaining({ apiVersion: 'tenants.applik8s.dev/v1alpha1' }) }),
      expect.objectContaining({ id: 'model.account', kind: 'model', name: 'Account' }),
      expect.objectContaining({ id: 'server.admin', kind: 'server', name: 'admin' }),
      expect.objectContaining({ id: 'operator.tenant-controller', kind: 'operator', name: 'tenant-controller' }),
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase', implementation: 'postgres' }),
    ]));
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining([
      'app.resource',
      'app.http',
      'Resource.on.reconcile',
      'app.database.postgres',
    ]));
  });

  it('supports top-level v0.3 app builder authoring with inferred HTTP bindings and flat model create', () => {
    const tenantPlatform = app('tenant-platform-builder-dx', {
      namespace: 'platform',
      apiVersion: 'tenants.applik8s.dev/v1alpha1',
      kind: 'TenantPlatformBuilderDx',
    });

    const Tenant = tenantPlatform.resource('Tenant', {
      spec: type({ plan: "'free' | 'team' | 'enterprise'", ownerEmail: 'string' }),
      status: type({ phase: "'Pending' | 'Ready' | 'Failed'", url: 'string?' }),
    });

    tenantPlatform.storage.postgres('tenant-platform-db', {
      database: 'tenant_platform',
      migrations: 'generated-job',
    });

    const Account = tenantPlatform.model('Account', {
      spec: type({ tenant: 'string', email: 'string', role: "'owner' | 'admin' | 'viewer'" }),
      indexes: { byTenant: ['tenant', 'email'] },
    });

    tenantPlatform.server('admin', (http) => {
      http.post('/tenants/:tenant/accounts', async ({ params, form }) => Account.create({
        tenant: params.tenant ?? 'main',
        email: form.string('email'),
        role: form.enum('role', ['owner', 'admin', 'viewer']),
      }));
    });

    Tenant.on.reconcile(async (tenant) => {
      tenant.status.phase = 'Ready';
    });

    expect(tenantPlatform).not.toHaveProperty('reconcile');
    expect(tenantPlatform.operatorInstalls).toHaveLength(1);
    expect(tenantPlatform.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'admin', namespace: 'platform' }) }));
    expect(tenantPlatform.resources).toContainEqual(expect.objectContaining({ kind: 'Job', metadata: expect.objectContaining({ name: 'account-migration', namespace: 'platform' }) }));
    expect(tenantPlatform.factory('kro')).toBeTruthy();

    // typecast: this assertion inspects heterogeneous generated resource objects for the admin source ConfigMap fixture.
    const sourceConfigMap = tenantPlatform.resources.find((resource) => Reflect.get(resource as object, 'kind') === 'ConfigMap' && Reflect.get(Reflect.get(resource as object, 'metadata') as object, 'name') === 'admin-source') as { readonly data?: Readonly<Record<string, string>> } | undefined;
    expect(JSON.stringify(sourceConfigMap?.data ?? {})).toContain('params.tenant');
    expect(JSON.stringify(sourceConfigMap?.data ?? {})).toContain('form.enum');
    expect(JSON.stringify(sourceConfigMap?.data ?? {})).toContain('Account.create');

    const graph = applicationGraphFor(tenantPlatform);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'crd.tenant', kind: 'crd', name: 'Tenant' }),
      expect.objectContaining({ id: 'model.account', kind: 'model', name: 'Account' }),
      expect.objectContaining({ id: 'server.admin', kind: 'server', name: 'admin' }),
      expect.objectContaining({ id: 'operator.tenant-controller', kind: 'operator', name: 'tenant-controller' }),
    ]));
  });

  it('coalesces resource-native reconcile and finalization into one inferred operator install', () => {
    const application = app('resource-owned-controller', {
      namespace: 'platform',
      apiVersion: 'controllers.applik8s.dev/v1alpha1',
      kind: 'ResourceOwnedController',
    });
    const Work = application.resource('Work', {
      spec: type({ value: 'string' }),
      status: type({ 'phase?': 'string' }),
    });

    Work.on.reconcile((work) => {
      work.status.phase = 'Ready';
    });
    Work.on.finalize((work) => {
      work.status.phase = 'Deleting';
    }, { finalizer: 'controllers.applik8s.dev/work' });

    expect(application).not.toHaveProperty('reconcile');
    expect(application.operatorInstalls).toHaveLength(1);
    expect(application.operatorInstalls[0]).toMatchObject({
      operatorName: 'work-controller',
      deployment: {
        namespace: 'platform',
      },
      operator: {
        handlers: [
          expect.objectContaining({ event: 'reconcile' }),
          expect.objectContaining({ event: 'finalize' }),
        ],
      },
    });
  });

  it('emits Postgres TransactionalDatabase backing resources as concrete TypeKro/Kubernetes resources', () => {
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
      app.model(NoteEntity, { database: { kind: 'postgres', name: 'notes-db', namespace: 'notes', database: 'notes' } });
      return { ready: true };
    });

    expect(plainValue(composition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'notes-db', namespace: 'notes' }) }),
    ]));
    expect(plainValue(composition.resources)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'note-transactional-database' }) }),
    ]));
    expect(composition.resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'v1', kind: 'Secret', metadata: expect.objectContaining({ name: 'notes-db-app', namespace: 'notes' }) }),
    ]));
  });

  it('observes direct-provisioned PostgreSQL without placing authoritative data under KRO ownership', () => {
    const NoteEntity = entity('Note', { spec: type({ message: 'string' }), status: type({ phase: 'string?' }) });
    const composition = sdk.kubernetesComposition({
      name: 'notes-retained-model-app', apiVersion: 'notes.applik8s.dev/v1alpha1', kind: 'NotesRetainedModelApp',
      spec: type({}), status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.model(NoteEntity, { database: TransactionalDatabase.postgres({
        name: 'notes-authority', namespace: 'notes', database: 'notes', ownership: 'direct-provisioned',
        lifecycle: { deletionPolicy: 'retain' }, storage: { size: '20Gi' },
        backup: {
          schedule: '0 0 2 * * *', retentionPolicy: '7d',
          destination: { kind: 'volume-snapshot', className: 'durable-snapshots' },
        },
      }) });
      return { ready: true };
    });

    const cluster = composition.resources.find((resource) => resource.apiVersion === 'postgresql.cnpg.io/v1' && resource.kind === 'Cluster');
    expect(cluster).toMatchObject({ metadata: { name: 'notes-authority', namespace: 'notes' } });
    expect(Reflect.get(cluster ?? {}, '__externalRef')).toBe(true);
    expect(plainValue(composition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: expect.objectContaining({ name: 'notes-authority-backup', namespace: 'notes' }),
        spec: expect.objectContaining({
          cluster: { name: 'notes-authority' },
          method: 'volumeSnapshot',
          schedule: '0 0 2 * * *',
          backupOwnerReference: 'cluster',
        }),
      }),
    ]));
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model.note',
        materialization: expect.objectContaining({ reconciliation: expect.objectContaining({ ownership: 'application', deletionPolicy: 'retain' }) }),
      }),
    ]));
  });

  it('preserves profile-selected PostgreSQL ownership as mutually exclusive graph and direct lifecycle resources', () => {
    const application = app('notes-profile-model-app', {
      namespace: 'notes',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesProfileModelApp',
      spec: type({ profile: "'managed' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    application.database.postgres('notes', {
      clusterName: 'notes-authority',
      database: 'notes',
      schema: {},
      ownership: application.select(application.installation.spec.profile, {
        external: 'external',
        default: 'direct-provisioned',
      }),
      provision: application.select(application.installation.spec.profile, {
        external: false,
        default: true,
      }),
      lifecycle: { deletionPolicy: 'retain' },
      connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'notes-authority-app', namespace: 'notes' },
      storage: { size: '20Gi' },
    });
    application.model('ProfileNote', { spec: type({ message: 'string' }) });

    const clusters = application.resources.filter(
      (resource): resource is object => {
        if (!resource || typeof resource !== 'object') return false;
        return Reflect.get(resource, 'apiVersion') === 'postgresql.cnpg.io/v1'
          && Reflect.get(resource, 'kind') === 'Cluster';
      },
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ metadata: { name: 'notes-authority', namespace: 'notes' } });
    expect(Reflect.get(clusters[0] ?? {}, '__externalRef')).toBe(true);
    const yaml = application.composition.factory('kro').toYaml();
    expect(yaml).toContain('schema.spec.profile) == "external"');
    expect(yaml).toContain('== "direct-provisioned"');
    expect(yaml).not.toContain('GraphOwned');
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
        database: {
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

    // The supplied connection Secret is the runtime authority. Do not broaden
    // the graph with an unused observed Cluster dependency.
    expect(composition.resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster' }),
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
          guarantees: expect.objectContaining({
            transactions: 'required',
            retention: 'ttl',
            semantics: expect.objectContaining({
              generatedRuntimeParity: 'required',
              scriptRuntimeParity: 'required',
              query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
              indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
              transactions: { declaration: 'required', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' },
              retention: { mode: 'ttl', ttlSeconds: 86_400, deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' },
            }),
          }),
        }),
        materialization: expect.objectContaining({
          backingResources: [expect.objectContaining({ kind: 'Cluster', name: 'shared-db', namespace: 'data' })],
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
          reconciliation: expect.objectContaining({ ownership: 'external' }),
        }),
      }),
    ]));
    const graph = applicationGraphFor(composition);
    const modelNode = graph?.nodes.find((node) => node.kind === 'model' && node.id === 'model.entry');
    expect(modelNode?.kind === 'model' && modelNode.schema.guarantees?.semantics ? validateApplicationTransactionalDatabaseSemanticsContract(modelNode.schema.guarantees.semantics) : []).toEqual([]);
    const providerNode = graph?.nodes.find((node) => node.kind === 'provider' && node.id === 'provider.transactional-database');
    expect(providerNode?.kind === 'provider' && providerNode.contract ? validateApplicationProviderInterfaceContract(providerNode.contract) : []).toEqual([]);
  });

  it('fails closed when a model declares multi-operation transactions unsupported', async () => {
    const NoteEntity = entity('Note', {
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    let notes: ApplicationModelBinding<{ readonly message: string }, { readonly phase?: string }> | undefined;
    const composition = sdk.kubernetesComposition({
      name: 'notes-model-transaction-boundary-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'NotesModelTransactionBoundaryApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      notes = app.model(NoteEntity, {
        database: { kind: 'postgres', name: 'notes-db', database: 'notes' },
        schema: { transactions: 'unsupported' },
      });
      return { ready: true };
    });

    const graph = applicationGraphFor(composition);
    const modelNode = graph?.nodes.find((node) => node.kind === 'model' && node.id === 'model.note');
    if (!notes) {
      throw new Error('expected model binding');
    }
    expect(notes?.backend.transactions).toBe('unsupported');
    expect(modelNode?.kind === 'model' ? modelNode.schema.guarantees?.semantics?.transactions : undefined).toEqual({
      declaration: 'unsupported',
      singleOperationAtomicity: 'databaseStatement',
      multiOperationApi: 'implemented',
      multiOperationBehavior: 'failClosed',
    });
    expect(modelNode?.kind === 'model' && modelNode.schema.guarantees?.semantics ? validateApplicationTransactionalDatabaseSemanticsContract(modelNode.schema.guarantees.semantics) : []).toEqual([]);
    await expect(notes.transaction(async (transaction) => transaction.create({ spec: { message: 'hello' } }))).rejects.toThrow(/transaction\(\.\.\.\) is unsupported/);
  });

  it('generates server runtime TransactionalDatabase clients backed by a singleton app-scoped CNPG provider', () => {
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
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app' });
      const Account = app.model(AccountEntity, {
        database: store,
        schema: {
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
        },
      });
      app.model(ProfileEntity, { database: store });
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
          expect.objectContaining({ name: 'APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL', valueFrom: { secretKeyRef: { name: 'app-db-app', key: 'uri' } } }),
        ]),
      })] } } },
    });
    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const serverSource = String(sourceConfigMap?.data?.['server.mjs'] ?? '');
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Account = modelClients["Account"];') } });
    expect(() => transformSync(String(sourceConfigMap?.data?.['server.mjs'] ?? ''), { loader: 'js', format: 'esm' })).not.toThrow();
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain("from './runtime/transactional-database-postgres.mjs'");
    expect(String(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs'] ?? '')).toContain('createPostgresModelClient');
    expect(String(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs'] ?? '')).toContain('drizzle-orm/postgres-js');
    expect(serverSource).not.toContain('ensureModelTable');
    expect(serverSource).not.toContain('transactionalDatabaseTableReady');
    expect(JSON.stringify(sourceConfigMap)).toContain('Account.create');
    expect(JSON.stringify(sourceConfigMap)).toContain('Account.query');
    const modelRuntimeSource = String(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs'] ?? '');
    expect(modelRuntimeSource).toContain('modelPostgresError(error)');
    expect(modelRuntimeSource).toContain('current = current.cause');
    expect(modelRuntimeSource).toContain('modelDefaultUniqueConstraint(model)');
  });

  it('generates TransactionalDatabase migrations, constraint diagnostics, index queries, and credential diagnostics', () => {
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
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob' } });
      const Account = app.model(AccountEntity, {
        database: store,
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
    expect(source).toContain('APPLIK8S_TRANSACTIONAL_DATABASE_ACCOUNT_DATABASE_URL');
    expect(source).toContain('applik8s-transactional-database-missing-credentials');
    expect(source).toContain('applik8s-model-migration-missing');
    expect(serverSource).not.toContain('ensureModelTable');
    expect(serverSource).not.toContain('transactionalDatabaseTableReady');
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
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob' } });
      const Account = app.model(AccountEntity, { database: store, schema: { indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }] } });
      app.server('web', { namespace: 'platform' }, (server) => {
        server.post('/accounts', async () => Account.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } }));
      });
      return { ready: true };
    });

    const sourceConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'web-source');
    const deployment = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web');
    const sourceDataKeys = Object.keys(sourceConfigMap?.data ?? {});
    const extractedModuleBundleKeys = Object.keys(generatedRuntimeModuleBundle(() => ''));
    const extractedSource = generatedRuntimeModuleSource('serverRuntime', { modelRuntime: () => 'model-source', jobRunnerRuntime: () => 'job-source' });
    expect(sourceDataKeys.every((key) => !key.includes('/'))).toBe(true);
    expect(sourceDataKeys).toEqual(expect.arrayContaining(extractedModuleBundleKeys.map((key) => key.replaceAll('/', '__'))));
    expect(extractedSource).toContain('createServerRuntime');
    expect(generatedApplicationRuntimeModuleSource('modelRuntime')).toContain(generatedRuntimeModuleSourcePreamble('modelRuntime'));
    expect(generatedApplicationRuntimeModuleSource('jobRunnerRuntime')).toContain(generatedRuntimeModuleSourcePreamble('jobRunnerRuntime'));
    expect(generatedRuntimeModuleSource('modelRuntime', { modelRuntime: () => 'model-source', jobRunnerRuntime: () => 'job-source' })).toBe('model-source');
    expect(generatedRuntimeModuleSource('jobRunnerRuntime', { modelRuntime: () => 'model-source', jobRunnerRuntime: () => 'job-source' })).toBe('job-source');
    expect(sourceConfigMap?.data).toMatchObject({
      'runtime__server.mjs': expect.stringContaining('serverRuntime'),
      'runtime__transactional-database-postgres.mjs': expect.stringContaining('modelRuntime'),
      'runtime__kubernetes-client.mjs': expect.stringContaining('kubernetesClient'),
      'runtime__diagnostics.mjs': expect.stringContaining('diagnostics'),
      'runtime__providers__postgres.mjs': expect.stringContaining('providerAdapter'),
      'runtime.modules.json': expect.stringContaining('GeneratedRuntimeModuleManifest'),
    });
    expect(sourceConfigMap?.data?.['runtime__server.mjs']).toContain('export const runtimeModule');
    expect(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs']).toContain('"kind":"modelRuntime"');
    expect(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs']).toContain('"interface"');
    expect(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs']).toContain('"failurePolicy":"failClosed"');
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('"kind":"jobRunnerRuntime"');
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('"kubernetesClient"');
    expect(sourceConfigMap?.data?.['runtime__job-runner.mjs']).toContain('createJobStatusUpdater');
    expect(sourceConfigMap?.data?.['runtime__kubernetes-client.mjs']).toContain('"kind":"kubernetesClient"');
    expect(sourceConfigMap?.data?.['runtime__diagnostics.mjs']).toContain('"kind":"diagnostics"');
    expect(sourceConfigMap?.data?.['runtime__providers__postgres.mjs']).toContain('"kind":"providerAdapter"');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain('createRuntimeBindings');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain('modelClients');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).toContain("from './runtime/transactional-database-postgres.mjs'");
    expect(String(sourceConfigMap?.data?.['bindings.mjs'] ?? '')).toContain("import { createRuntimeBindings } from './runtime.mjs'");
    expect(String(sourceConfigMap?.data?.['routes.mjs'] ?? '')).toContain("from './route-");
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('applik8sServerRuntime');
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('/-/healthz');
    // typecast: runtime.bundle.json is generated by applik8s and immediately validated against the generated server runtime bundle contract.
    const serverRuntimeBundle = JSON.parse(String(sourceConfigMap?.data?.['runtime.bundle.json'] ?? '{}')) as GeneratedServerRuntimeBundleContract;
    expect(validateGeneratedServerRuntimeBundleContract(serverRuntimeBundle)).toEqual([]);
    expect(serverRuntimeBundle).toMatchObject({ packageManagerAtStartup: false, releasePolicy: { dependencyInstallation: 'buildTimeOnly', runtimeImage: 'explicitImageOrGeneratedRecipe', supplyChain: 'metadataOnlyUntilSignedArtifacts', failurePolicy: 'failClosed' } });
    expect(serverRuntimeBundle.observability.logs.failureEvents).toContain('applik8s-route-action-failure');
    expect(String(sourceConfigMap?.data?.['routes.manifest.json'] ?? '')).toContain('"observability"');
    // typecast: runtime.modules.json is validated immediately through the exported runtime module manifest contract.
    const runtimeModules = JSON.parse(String(sourceConfigMap?.data?.['runtime.modules.json'] ?? '{}')) as ApplicationRuntimeModuleManifestContract;
    expect(validateApplicationRuntimeModuleManifestContract(runtimeModules)).toEqual([]);
    expect(runtimeModules).toEqual(generatedApplicationRuntimeModuleManifest());
    expect(runtimeModules.modules.map((module) => module.kind)).toEqual([...generatedApplicationRuntimeModuleKinds]);
    expect(runtimeModules.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'applik8s.runtime/v1alpha1', kind: 'serverRuntime', name: 'server', artifact: { kind: 'runtimeModule', path: 'runtime/server.mjs', name: 'server' }, path: 'runtime/server.mjs', imports: expect.arrayContaining([expect.objectContaining({ kind: 'modelRuntime' })]) }),
      expect.objectContaining({ apiVersion: 'applik8s.runtime/v1alpha1', kind: 'modelRuntime', name: 'postgres-models', artifact: { kind: 'runtimeModule', path: 'runtime/transactional-database-postgres.mjs', name: 'postgres-models' }, path: 'runtime/transactional-database-postgres.mjs', exports: expect.arrayContaining([expect.objectContaining({ name: 'createPostgresModelClient' })]) }),
      expect.objectContaining({ apiVersion: 'applik8s.runtime/v1alpha1', kind: 'jobRunnerRuntime', name: 'generated-job-status', artifact: { kind: 'runtimeModule', path: 'runtime/job-runner.mjs', name: 'generated-job-status' }, path: 'runtime/job-runner.mjs', entrypoint: 'createJobStatusUpdater', imports: expect.arrayContaining([expect.objectContaining({ kind: 'kubernetesClient' })]) }),
      expect.objectContaining({ apiVersion: 'applik8s.runtime/v1alpha1', kind: 'diagnostics', name: 'diagnostics', artifact: { kind: 'runtimeModule', path: 'runtime/diagnostics.mjs', name: 'diagnostics' }, path: 'runtime/diagnostics.mjs' }),
      expect.objectContaining({ apiVersion: 'applik8s.runtime/v1alpha1', kind: 'providerAdapter', name: 'postgres', artifact: { kind: 'runtimeModule', path: 'runtime/providers/postgres.mjs', name: 'postgres' }, path: 'runtime/providers/postgres.mjs' }),
    ]));
    for (const module of runtimeModules.modules) {
      const sourceKey = module.path.replaceAll('/', '__');
      const sourceModuleJson = String(sourceConfigMap?.data?.[sourceKey] ?? '').match(/export const runtimeModule = (\{.*\});/)?.[1] ?? '{}';
      // typecast: runtime module source self-description is compared immediately to the validated manifest entry.
      const sourceModule = JSON.parse(sourceModuleJson) as ApplicationRuntimeModuleManifestContract['modules'][number];
      expect(sourceModule).toEqual(module);
      expect(sourceModule.artifact.path).toBe(module.path);
      expect(sourceModule.interface.imports).toEqual(module.imports);
      expect(sourceModule.interface.exports).toEqual(module.exports);
    }
    expect(runtimeModules.modules.flatMap((module: { readonly interface?: ApplicationRuntimeModuleInterfaceContract }) => module.interface ? validateApplicationRuntimeModuleInterfaceContract(module.interface) : [])).toEqual([]);
    const serverGraphNode = applicationGraphFor(composition)?.nodes.find((node) => node.kind === 'server' && node.id === 'server.web');
    expect(serverGraphNode?.kind === 'server' ? serverGraphNode.routes : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ diagnostics: expect.objectContaining({ routeFailureEvent: 'applik8s-server-route-failure', actionFailureEvent: 'applik8s-route-action-failure', failurePolicy: 'failClosed', partialEffects: 'unknownAfterActionStarted', includes: expect.arrayContaining(['routeId', 'action', 'diagnostic', 'stack']) }) }),
    ]));
    expect(String(sourceConfigMap?.data?.['routes.manifest.json'] ?? '')).toContain('applik8s-route-action-failure');
    expect(String(sourceConfigMap?.data?.['routes.manifest.json'] ?? '')).toContain('unknownAfterActionStarted');
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('applik8s-route-action-failure');
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('unknownAfterActionStarted');
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('routeId');
    expect(String(sourceConfigMap?.data?.['server.mjs'] ?? '')).toContain('failurePolicy');
    expect(String(sourceConfigMap?.data?.['routes.mjs'] ?? '')).toContain('export: "route_post_accounts_0"');
    const deploymentJson = JSON.stringify(deployment);
    expect(deploymentJson).toContain('"path":"runtime.modules.json"');
    expect(deploymentJson).toContain('"path":"runtime/server.mjs"');
    expect(deploymentJson).toContain('"path":"runtime/transactional-database-postgres.mjs"');
    expect(deploymentJson).toContain('"path":"runtime/job-runner.mjs"');
    expect(deploymentJson).toContain('"path":"runtime/kubernetes-client.mjs"');
    expect(deploymentJson).toContain('"path":"runtime/diagnostics.mjs"');
    expect(deploymentJson).toContain('"path":"runtime/providers/postgres.mjs"');
    expect(deploymentJson).toContain('"readinessProbe":{"httpGet":{"path":"/-/healthz","port":"http"}');
    expect(deploymentJson).toContain('"livenessProbe":{"httpGet":{"path":"/-/healthz","port":"http"}');
    expect(String(sourceConfigMap?.data?.['runtime.mjs'] ?? '')).not.toContain('function createPostgresModelClient');
    const runtimeModule = JSON.parse(String(sourceConfigMap?.data?.['runtime__transactional-database-postgres.mjs'] ?? '').match(/export const runtimeModule = (\{.*\});/)?.[1] ?? '{}');
    expect(validateApplicationRuntimeModuleInterfaceContract(runtimeModule.interface)).toEqual([]);
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
      const store = app.provide(TransactionalDatabase, { kind: 'postgres', name: 'app-db', namespace: 'platform', database: 'app', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'accounts-model-migration' } });
      app.model(AccountEntity, {
        database: store,
        schema: {
          constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
          indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
        },
      });
      return { ready: true };
    });

    const migrationConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-migration');
    const diagnosticsConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'accounts-model-migration-diagnostics');
    const preflightSql = String(migrationConfigMap?.data?.['preflight.sql'] ?? '');
    const migrationSql = String(migrationConfigMap?.data?.['migration.sql'] ?? '');

    expect(preflightSql).toContain('applik8s-model-migration-preflight');
    expect(preflightSql).toContain('SELECT 1 AS provider_readiness');
    expect(preflightSql).toContain('pg_advisory_xact_lock');
    expect(preflightSql).toContain('missingHistoryTable');
    expect(preflightSql).toContain('incompatibleColumn');
    expect(preflightSql).toContain('incompatibleIndex');
    expect(preflightSql).toContain('unknownExistingObject');
    expect(preflightSql).toContain('destructiveChange');
    expect(preflightSql).toContain('actual_history');
    expect(preflightSql).toContain('missingHistoryColumn');
    expect(preflightSql).toContain('pg_index');
    expect(preflightSql).toContain('pg_get_indexdef');
    expect(preflightSql).toContain('indisunique');
    expect(preflightSql).toContain('normalized_index_definition');
    expect(preflightSql).toContain('account-email-unique');
    expect(preflightSql).toContain('accounts-by-email');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "applik8s_model_migrations"');
    expect(migrationSql).toContain('INSERT INTO "applik8s_model_migrations"');
    expect(diagnosticsConfigMap?.data).toMatchObject({
      compatibilityPolicy: expect.stringContaining('explicitPlanRequired'),
      driftPolicy: 'failClosed',
      phaseStatusContract: expect.stringContaining('observedGeneration'),
      statusOwnershipContract: expect.stringContaining('status.applik8s.jobs'),
      durableStatusTemplate: expect.stringContaining('provider-readiness'),
      terminalFailureStatus: expect.stringContaining('partialEffects'),
      migrationPlan: expect.stringContaining('account-email-unique'),
      failureModes: expect.stringContaining('missingCredentials'),
      driftDiagnostic: expect.stringContaining('applik8s-model-migration-drift-detected'),
      failureDiagnostic: expect.stringContaining('applik8s-model-migration-failed'),
    });
    expect(diagnosticsConfigMap?.data?.driftDiagnostic).toContain('SchemaDriftDetected');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('badSql');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('providerReadiness');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('lockBehavior');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('missingHistoryTable');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('incompatibleColumn');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('incompatibleIndex');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('unknownExistingObject');
    expect(diagnosticsConfigMap?.data?.failureModes).toContain('destructiveChange');
    expect(diagnosticsConfigMap?.data?.statusOwnershipContract).toContain('resourceVersionMergePatch');
    expect(diagnosticsConfigMap?.data?.statusOwnershipContract).toContain('history.json');
    expect(diagnosticsConfigMap?.data?.migrationPlan).toContain('destructive-change');
    expect(diagnosticsConfigMap?.data?.migrationPlan).toContain('schema-drift');
    expect(diagnosticsConfigMap?.data?.migrationPreflightSql).toContain('pg_advisory_xact_lock');
    expect(migrationSql).not.toContain('DROP TABLE');
    expect(migrationSql).not.toContain('DROP INDEX');
  });

  it('fails closed for script-runtime model CRUD when no Postgres credentials are configured', async () => {
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
      model = app.model(NoteEntity, { database: { kind: 'postgres', name: 'notes-db', database: 'notes' } });
      return { ready: true };
    });
    if (!model) {
      throw new Error('expected model binding');
    }

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousModelUrl = process.env.APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL;
    try {
      await expect(model.create({ spec: { message: 'hello' } })).rejects.toMatchObject({
        message: expect.stringContaining('applik8s-transactional-database-missing-credentials'),
        diagnostic: expect.objectContaining({ event: 'applik8s-transactional-database-missing-credentials', model: 'Note', env: 'APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL' }),
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      if (previousModelUrl === undefined) {
        delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL;
      } else {
        process.env.APPLIK8S_TRANSACTIONAL_DATABASE_NOTE_DATABASE_URL = previousModelUrl;
      }
    }
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
      app.model(NoteEntity, { database: { kind: 'postgres', name: 'notes-db', namespace: 'notes', database: 'notes', migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'notes-model-migration' } } });
      return { ready: true };
    });

    expect(plainValue(composition.resources)).toEqual(expect.arrayContaining([
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
                  image: 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
                  command: expect.arrayContaining(['sh', '-c', expect.stringContaining('/migrations/preflight.sql')]),
                  env: expect.arrayContaining([
                    expect.objectContaining({ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'notes-db-app', key: 'uri' } } }),
                    expect.objectContaining({ name: 'APPLIK8S_TRANSACTIONAL_DATABASE_MODEL', value: 'Note' }),
                  ]),
                  volumeMounts: expect.arrayContaining([expect.objectContaining({ name: 'applik8s-model-migration', mountPath: '/migrations', readOnly: true })]),
                }),
              ]),
              volumes: expect.arrayContaining([expect.objectContaining({ name: 'applik8s-model-migration', configMap: { name: 'notes-model-migration-migration' } })]),
            }),
          }),
        }),
      }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-migration' }), data: expect.objectContaining({ 'preflight.sql': expect.stringContaining('applik8s-model-migration-preflight'), 'migration.sql': expect.stringContaining('CREATE TABLE IF NOT EXISTS "applik8s_note"') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-diagnostics' }), data: expect.objectContaining({ phaseStatusContract: expect.stringContaining('status.applik8s.jobs.notes-model-migration'), terminalFailureStatus: expect.stringContaining('runMigrationJob') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-status-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('patchApplicationStatus'), 'status-runtime.json': expect.stringContaining('notesmodelmigrationartifactsapps') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler-runtime' }), data: expect.objectContaining({ 'runtime__job-runner.mjs': expect.stringContaining('patchGeneratedStatusConfigMap'), 'status-runtime.json': expect.stringContaining('notes-model-migration') }) }),
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler-status' }) }),
      expect.objectContaining({ kind: 'ClusterRole', metadata: expect.objectContaining({ name: 'notes-notes-model-migration-artifacts-app-status-reconciler' }), rules: expect.arrayContaining([
        expect.objectContaining({ apiGroups: [''], resources: ['configmaps'], verbs: ['create', 'get', 'patch', 'update'] }),
      ]) }),
      expect.objectContaining({ kind: 'ClusterRoleBinding', metadata: expect.objectContaining({ name: 'notes-notes-model-migration-artifacts-app-status-reconciler' }) }),
      expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'notes-model-migration-artifacts-app-status-reconciler' }), spec: expect.objectContaining({ template: expect.objectContaining({ spec: expect.objectContaining({ serviceAccountName: 'notes-model-migration-artifacts-app-status-reconciler' }) }) }) }),
    ]));
    const migrationRuntimeConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-model-migration-artifacts-app-status-reconciler-runtime');
    const generatedJobRunnerRuntime = String(migrationRuntimeConfigMap?.data?.['runtime__job-runner.mjs'] ?? '');
    expect(() => transformSync(generatedJobRunnerRuntime, { loader: 'js', format: 'esm' })).not.toThrow();
    expect(generatedJobRunnerRuntime).toContain('{ ...entry, observedAt }');
    expect(generatedJobRunnerRuntime).not.toContain('{ ...previous, observedAt }');
    const migrationStatusConfigMap = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'notes-model-migration-artifacts-app-status-reconciler-status');
    expect(Reflect.get(migrationStatusConfigMap ?? {}, '__externalRef')).toBe(true);
    expect(JSON.stringify(composition.resources)).not.toContain('$' + '{APPLIK8S_TRANSACTIONAL_DATABASE_MODEL}');
    expect(JSON.stringify(composition.resources)).not.toContain('$' + '{attempt}');
  });

  it('merges generated-job status ConfigMap data without losing concurrent job status or history', () => {
    const existingData = mergeGeneratedJobStatusConfigMapData({
      observedAt: '2026-07-06T00:00:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            migration: { phase: 'Complete', observedGeneration: 1, idempotencyKey: 'migration-1', retryCount: 0 },
          },
        },
      },
    });
    const mergedData = mergeGeneratedJobStatusConfigMapData({
      existingData,
      observedAt: '2026-07-06T00:01:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            cleanup: { phase: 'Progressing', observedGeneration: 4, idempotencyKey: 'cleanup-4', retryCount: 1 },
          },
        },
      },
    });
    const repeatedData = mergeGeneratedJobStatusConfigMapData({
      existingData: mergedData,
      observedAt: '2026-07-06T00:02:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            cleanup: { phase: 'Progressing', observedGeneration: 4, idempotencyKey: 'cleanup-4', retryCount: 1 },
          },
        },
      },
    });
    const concurrentData = mergeGeneratedJobStatusConfigMapData({
      existingData: repeatedData,
      observedAt: '2026-07-06T00:02:30.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            cleanup: { phase: 'Progressing', observedGeneration: 4, idempotencyKey: 'cleanup-4-rerun', retryCount: 2 },
          },
        },
      },
    });
    const staleData = mergeGeneratedJobStatusConfigMapData({
      existingData: repeatedData,
      observedAt: '2026-07-06T00:03:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            cleanup: { phase: 'Pending', observedGeneration: 3, idempotencyKey: 'cleanup-3', retryCount: 0 },
          },
        },
      },
    });
    const completedConflictData = mergeGeneratedJobStatusConfigMapData({
      existingData: staleData,
      observedAt: '2026-07-06T00:04:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            migration: { phase: 'Failed', observedGeneration: 1, idempotencyKey: 'migration-1', retryCount: 1 },
          },
        },
      },
    });

    expect(JSON.parse(String(mergedData['applik8s-jobs.json']))).toMatchObject({
      migration: { phase: 'Complete' },
      cleanup: { phase: 'Progressing' },
    });
    expect(JSON.parse(String(mergedData['status.json']))).toEqual({ applik8s: { jobs: { migration: { phase: 'Complete', observedGeneration: 1, idempotencyKey: 'migration-1', retryCount: 0 }, cleanup: { phase: 'Progressing', observedGeneration: 4, idempotencyKey: 'cleanup-4', retryCount: 1 } } } });
    expect(JSON.parse(String(mergedData['history.json']))).toMatchObject({
      migration: [expect.objectContaining({ phase: 'Complete', observedAt: '2026-07-06T00:00:00.000Z' })],
      cleanup: [expect.objectContaining({ phase: 'Progressing', observedAt: '2026-07-06T00:01:00.000Z' })],
    });
    expect(JSON.parse(String(repeatedData['history.json'])).cleanup).toHaveLength(1);
    expect(JSON.parse(String(repeatedData['history.json'])).cleanup[0]).toMatchObject({ observedAt: '2026-07-06T00:02:00.000Z' });
    expect(JSON.parse(String(concurrentData['applik8s-jobs.json'])).cleanup).toMatchObject({ phase: 'Progressing', observedGeneration: 4, idempotencyKey: 'cleanup-4-rerun' });
    expect(JSON.parse(String(concurrentData['conflicts.json'])).cleanup).toEqual([
      expect.objectContaining({ reason: 'ConcurrentObservationAccepted', observedAt: '2026-07-06T00:02:30.000Z', accepted: expect.objectContaining({ idempotencyKey: 'cleanup-4-rerun' }) }),
    ]);
    expect(JSON.parse(String(staleData['applik8s-jobs.json'])).cleanup).toMatchObject({ phase: 'Progressing', observedGeneration: 4 });
    expect(JSON.parse(String(staleData['status.json'])).applik8s.jobs.cleanup).toMatchObject({ phase: 'Progressing', observedGeneration: 4 });
    expect(JSON.parse(String(staleData['history.json'])).cleanup).toHaveLength(1);
    expect(JSON.parse(String(staleData['conflicts.json'])).cleanup).toEqual([
      expect.objectContaining({ reason: 'StaleObservedGeneration', observedAt: '2026-07-06T00:03:00.000Z', rejected: expect.objectContaining({ observedGeneration: 3 }) }),
    ]);
    expect(JSON.parse(String(completedConflictData['applik8s-jobs.json'])).migration).toMatchObject({ phase: 'Complete', idempotencyKey: 'migration-1' });
    expect(JSON.parse(String(completedConflictData['status.json'])).applik8s.jobs.migration).toMatchObject({ phase: 'Complete', idempotencyKey: 'migration-1' });
    expect(JSON.parse(String(completedConflictData['history.json'])).migration).toHaveLength(1);
    expect(JSON.parse(String(completedConflictData['conflicts.json'])).migration).toEqual([
      expect.objectContaining({ reason: 'CompletedIdempotencyKeyRetained', observedAt: '2026-07-06T00:04:00.000Z', rejected: expect.objectContaining({ phase: 'Failed', idempotencyKey: 'migration-1' }) }),
    ]);
  });

  it('summarizes generated-job status merges for adversarial multi-job conflict metrics', () => {
    const initial = summarizeGeneratedJobStatusConfigMapMerge({
      observedAt: '2026-07-06T02:00:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            migration: { phase: 'Complete', observedGeneration: 5, idempotencyKey: 'migration-5', retryCount: 0 },
            cleanup: { phase: 'Progressing', observedGeneration: 7, idempotencyKey: 'cleanup-7', retryCount: 1 },
          },
        },
      },
    });
    const adversarial = summarizeGeneratedJobStatusConfigMapMerge({
      existingData: { ...initial.data, 'history.json': '{not-json', 'conflicts.json': String(initial.data['conflicts.json']) },
      observedAt: '2026-07-06T02:01:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            migration: { phase: 'Failed', observedGeneration: 5, idempotencyKey: 'migration-5', retryCount: 2 },
            cleanup: { phase: 'Progressing', observedGeneration: 6, idempotencyKey: 'cleanup-6', retryCount: 0 },
            repair: { phase: 'Progressing', observedGeneration: 1, idempotencyKey: 'repair-1', retryCount: 0 },
          },
        },
      },
    });
    const concurrent = summarizeGeneratedJobStatusConfigMapMerge({
      existingData: adversarial.data,
      observedAt: '2026-07-06T02:02:00.000Z',
      statusPatch: {
        applik8s: {
          jobs: {
            repair: { phase: 'Progressing', observedGeneration: 1, idempotencyKey: 'repair-1-rerun', retryCount: 1 },
          },
        },
      },
    });

    expect(initial.metrics).toEqual({ observedJobs: 2, retainedJobs: 2, acceptedUpdates: 2, rejectedUpdates: 0, conflictUpdates: 0 });
    expect(adversarial.metrics).toEqual({ observedJobs: 3, retainedJobs: 3, acceptedUpdates: 1, rejectedUpdates: 2, conflictUpdates: 0 });
    expect(concurrent.metrics).toEqual({ observedJobs: 1, retainedJobs: 3, acceptedUpdates: 1, rejectedUpdates: 0, conflictUpdates: 1 });
    expect(JSON.parse(String(adversarial.data['applik8s-jobs.json']))).toMatchObject({
      migration: { phase: 'Complete', idempotencyKey: 'migration-5' },
      cleanup: { phase: 'Progressing', observedGeneration: 7 },
      repair: { phase: 'Progressing', idempotencyKey: 'repair-1' },
    });
    expect(JSON.parse(String(adversarial.data['history.json']))).toMatchObject({
      repair: [expect.objectContaining({ phase: 'Progressing', observedAt: '2026-07-06T02:01:00.000Z' })],
    });
    expect(JSON.parse(String(adversarial.data['conflicts.json']))).toMatchObject({
      migration: [expect.objectContaining({ reason: 'CompletedIdempotencyKeyRetained', rejected: expect.objectContaining({ phase: 'Failed' }) })],
      cleanup: [expect.objectContaining({ reason: 'StaleObservedGeneration', rejected: expect.objectContaining({ observedGeneration: 6 }) })],
    });
    expect(JSON.parse(String(concurrent.data['applik8s-jobs.json'])).repair).toMatchObject({ idempotencyKey: 'repair-1-rerun' });
    expect(JSON.parse(String(concurrent.data['conflicts.json'])).repair).toEqual([
      expect.objectContaining({ reason: 'ConcurrentObservationAccepted', accepted: expect.objectContaining({ idempotencyKey: 'repair-1-rerun' }) }),
    ]);
  });

  it('keeps CronJob generated status latest-run state while retaining bounded history', () => {
    const firstRun = mergeGeneratedJobStatusConfigMapData({
      observedAt: '2026-07-06T04:00:00.000Z',
      statusPatch: { applik8s: { jobs: { 'cleanup-hourly': { phase: 'Complete', observedGeneration: 11, idempotencyKey: 'cleanup-hourly-202607060400', retryCount: 0 } } } },
    });
    const refreshedSameRun = mergeGeneratedJobStatusConfigMapData({
      existingData: firstRun,
      observedAt: '2026-07-06T04:01:00.000Z',
      statusPatch: { applik8s: { jobs: { 'cleanup-hourly': { phase: 'Complete', observedGeneration: 11, idempotencyKey: 'cleanup-hourly-202607060400', retryCount: 0 } } } },
    });
    const nextRun = mergeGeneratedJobStatusConfigMapData({
      existingData: refreshedSameRun,
      observedAt: '2026-07-06T05:00:00.000Z',
      statusPatch: { applik8s: { jobs: { 'cleanup-hourly': { phase: 'Progressing', observedGeneration: 12, idempotencyKey: 'cleanup-hourly-202607060500', retryCount: 1 } } } },
    });

    expect(JSON.parse(String(refreshedSameRun['history.json']))['cleanup-hourly']).toHaveLength(1);
    expect(JSON.parse(String(refreshedSameRun['history.json']))['cleanup-hourly'][0]).toMatchObject({ observedAt: '2026-07-06T04:01:00.000Z', idempotencyKey: 'cleanup-hourly-202607060400' });
    expect(JSON.parse(String(nextRun['applik8s-jobs.json']))['cleanup-hourly']).toMatchObject({ phase: 'Progressing', observedGeneration: 12, idempotencyKey: 'cleanup-hourly-202607060500' });
    expect(JSON.parse(String(nextRun['history.json']))['cleanup-hourly']).toEqual([
      expect.objectContaining({ phase: 'Complete', idempotencyKey: 'cleanup-hourly-202607060400' }),
      expect.objectContaining({ phase: 'Progressing', idempotencyKey: 'cleanup-hourly-202607060500' }),
    ]);
  });

  it('recovers retained generated-job state from status.json after status-store restart or old data shape', () => {
    const recovered = mergeGeneratedJobStatusConfigMapData({
      existingData: {
        'status.json': JSON.stringify({ applik8s: { jobs: { migration: { phase: 'Complete', observedGeneration: 9, idempotencyKey: 'migration-9', retryCount: 0 } } } }),
        updatedAt: '2026-07-06T06:00:00.000Z',
      },
      observedAt: '2026-07-06T06:05:00.000Z',
      statusPatch: { applik8s: { jobs: { repair: { phase: 'Progressing', observedGeneration: 1, idempotencyKey: 'repair-1', retryCount: 0 } } } },
    });
    const completedConflict = mergeGeneratedJobStatusConfigMapData({
      existingData: {
        'status.json': JSON.stringify({ applik8s: { jobs: { migration: { phase: 'Complete', observedGeneration: 9, idempotencyKey: 'migration-9', retryCount: 0 } } } }),
      },
      observedAt: '2026-07-06T06:06:00.000Z',
      statusPatch: { applik8s: { jobs: { migration: { phase: 'Failed', observedGeneration: 9, idempotencyKey: 'migration-9', retryCount: 1 } } } },
    });

    expect(JSON.parse(String(recovered['applik8s-jobs.json']))).toMatchObject({
      migration: { phase: 'Complete', idempotencyKey: 'migration-9' },
      repair: { phase: 'Progressing', idempotencyKey: 'repair-1' },
    });
    expect(JSON.parse(String(recovered['status.json'])).applik8s.jobs).toMatchObject({
      migration: { phase: 'Complete' },
      repair: { phase: 'Progressing' },
    });
    expect(JSON.parse(String(completedConflict['applik8s-jobs.json'])).migration).toMatchObject({ phase: 'Complete', idempotencyKey: 'migration-9' });
    expect(JSON.parse(String(completedConflict['conflicts.json'])).migration).toEqual([
      expect.objectContaining({ reason: 'CompletedIdempotencyKeyRetained', rejected: expect.objectContaining({ phase: 'Failed' }) }),
    ]);
  });

  it('retries generated-job status ConfigMap writes on resourceVersion conflicts and preserves merged status', async () => {
    const diagnostics: Readonly<Record<string, unknown>>[] = [];
    const patches: { readonly metadata?: { readonly resourceVersion: string }; readonly data: Readonly<Record<string, string>> }[] = [];
    let reads = 0;
    const result = await patchGeneratedJobStatusConfigMapData({
      concurrency: applicationGeneratedStatusConcurrencyContract(),
      statusPatch: { applik8s: { jobs: { repair: { phase: 'Progressing', observedGeneration: 2, idempotencyKey: 'repair-2', retryCount: 0 } } } },
      observedAt: () => `2026-07-06T03:00:0${reads}.000Z`,
      diagnostic: (event) => diagnostics.push(event),
      isConflict: (error) => error instanceof Error && error.message.includes('HTTP 409'),
      read: async () => {
        reads += 1;
        return reads === 1
          ? { data: {}, resourceVersion: 'rv-1' }
          : { data: { 'applik8s-jobs.json': JSON.stringify({ cleanup: { phase: 'Complete', observedGeneration: 1, idempotencyKey: 'cleanup-1', retryCount: 0 } }) }, resourceVersion: 'rv-2' };
      },
      patch: async (payload) => {
        patches.push(payload);
        if (patches.length === 1) {
          throw new Error('HTTP 409 conflict');
        }
      },
    });

    expect(result.attempts).toBe(2);
    expect(patches.map((patch) => patch.metadata?.resourceVersion)).toEqual(['rv-1', 'rv-2']);
    expect(JSON.parse(String(patches[1]?.data['applik8s-jobs.json']))).toMatchObject({ cleanup: { phase: 'Complete' }, repair: { phase: 'Progressing' } });
    expect(diagnostics).toEqual([
      expect.objectContaining({ event: 'applik8s-job-status-reconciler-status-store-conflict-retry', attempt: 1 }),
      expect.objectContaining({ event: 'applik8s-job-status-reconciler-status-store-merged', attempt: 2, acceptedUpdates: 1, retainedJobs: 2 }),
    ]);
  });

  it('fails closed and reports retry exhaustion when generated-job status ConfigMap conflicts persist', async () => {
    const diagnostics: Readonly<Record<string, unknown>>[] = [];
    const concurrency = applicationGeneratedStatusConcurrencyContract();
    let patches = 0;
    await expect(patchGeneratedJobStatusConfigMapData({
      concurrency,
      statusPatch: { applik8s: { jobs: { repair: { phase: 'Progressing', observedGeneration: 2, idempotencyKey: 'repair-2', retryCount: 0 } } } },
      diagnostic: (event) => diagnostics.push(event),
      isConflict: (error) => error instanceof Error && error.message.includes('HTTP 409'),
      read: async () => ({ data: {}, resourceVersion: `rv-${patches + 1}` }),
      patch: async () => {
        patches += 1;
        throw new Error('HTTP 409 conflict');
      },
    })).rejects.toThrow('HTTP 409 conflict');

    expect(patches).toBe(concurrency.maxAttempts);
    expect(diagnostics.filter((event) => event.event === concurrency.retryDiagnostic)).toHaveLength(concurrency.maxAttempts - 1);
    expect(diagnostics.at(-1)).toMatchObject({ event: concurrency.retryExhaustedDiagnostic, severity: 'error', attempt: concurrency.maxAttempts, maxAttempts: concurrency.maxAttempts });
  });

  it('writes durable generated-job status before diagnosing best-effort app status patch failure', async () => {
    const diagnostics: Readonly<Record<string, unknown>>[] = [];
    const operations: string[] = [];
    const result = await persistGeneratedJobStatusWithDurableFallback({
      concurrency: applicationGeneratedStatusConcurrencyContract(),
      statusPatch: { applik8s: { jobs: { migration: { phase: 'Complete', observedGeneration: 4, idempotencyKey: 'migration-4', retryCount: 0 } } } },
      diagnostic: (event) => diagnostics.push(event),
      isConflict: () => false,
      read: async () => ({ data: {}, resourceVersion: 'rv-1' }),
      patch: async () => {
        operations.push('status-configmap');
      },
      patchApplicationStatus: async () => {
        operations.push('app-status');
        throw new Error('status.applik8s pruned');
      },
    });

    expect(result.appStatus).toBe('failed');
    expect(result.statusStore.metrics).toMatchObject({ acceptedUpdates: 1, retainedJobs: 1 });
    expect(operations).toEqual(['status-configmap', 'app-status']);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'applik8s-job-status-reconciler-status-store-merged' }),
      expect.objectContaining({ event: 'applik8s-job-status-reconciler-app-status-error', durableFallback: 'generatedStatusConfigMap' }),
    ]));
  });

  it('caps generated-job status history and conflict diagnostics to release-bounded retention', () => {
    let historyData: Readonly<Record<string, string>> | undefined;
    for (let observedGeneration = 1; observedGeneration <= 25; observedGeneration += 1) {
      historyData = mergeGeneratedJobStatusConfigMapData({
        ...(historyData ? { existingData: historyData } : {}),
        observedAt: `2026-07-06T00:${String(observedGeneration).padStart(2, '0')}:00.000Z`,
        statusPatch: {
          applik8s: {
            jobs: {
              cleanup: { phase: 'Progressing', observedGeneration, idempotencyKey: `cleanup-${observedGeneration}`, retryCount: observedGeneration },
            },
          },
        },
      });
    }

    const retainedHistory = JSON.parse(String(historyData?.['history.json'])).cleanup;
    expect(retainedHistory).toHaveLength(20);
    expect(retainedHistory[0]).toMatchObject({ observedGeneration: 6, idempotencyKey: 'cleanup-6' });
    expect(retainedHistory[19]).toMatchObject({ observedGeneration: 25, idempotencyKey: 'cleanup-25' });

    let conflictData = mergeGeneratedJobStatusConfigMapData({
      observedAt: '2026-07-06T01:00:00.000Z',
      statusPatch: { applik8s: { jobs: { repair: { phase: 'Progressing', observedGeneration: 7, idempotencyKey: 'repair-0', retryCount: 0 } } } },
    });
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      conflictData = mergeGeneratedJobStatusConfigMapData({
        existingData: conflictData,
        observedAt: `2026-07-06T01:${String(attempt).padStart(2, '0')}:00.000Z`,
        statusPatch: {
          applik8s: {
            jobs: {
              repair: { phase: 'Progressing', observedGeneration: 7, idempotencyKey: `repair-${attempt}`, retryCount: attempt },
            },
          },
        },
      });
    }

    const retainedConflicts = JSON.parse(String(conflictData['conflicts.json'])).repair;
    expect(retainedConflicts).toHaveLength(20);
    expect(retainedConflicts[0]).toMatchObject({ reason: 'ConcurrentObservationAccepted', accepted: expect.objectContaining({ idempotencyKey: 'repair-6' }) });
    expect(retainedConflicts[19]).toMatchObject({ reason: 'ConcurrentObservationAccepted', accepted: expect.objectContaining({ idempotencyKey: 'repair-25' }) });
  });

  it('emits one durable status reconciler for multiple generated Jobs and CronJobs with runtime-owned status data', () => {
    const composition = sdk.kubernetesComposition({
      name: 'maintenance-jobs-app',
      apiVersion: 'maintenance.applik8s.dev/v1alpha1',
      kind: 'MaintenanceJobsApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const repair = app.job('repair accounts', { namespace: 'maintenance', taskKind: 'repair', image: 'busybox:1.36' });
      const cleanup = app.schedule('cleanup accounts', { namespace: 'maintenance', taskKind: 'cleanup', cron: '*/15 * * * *', timezone: 'UTC', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
      expect(repair.statusPath).toBe('status.applik8s.jobs.repair-accounts');
      expect(cleanup.statusPath).toBe('status.applik8s.jobs.cleanup-accounts');
      return { ready: true };
    });

    expect(plainValue(composition.resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'repair-accounts', namespace: 'maintenance' }) }),
      expect.objectContaining({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: expect.objectContaining({ name: 'cleanup-accounts', namespace: 'maintenance', annotations: { 'applik8s.dev/missed-run-policy': 'failClosed' } }) }),
    ]));
    const statusRuntime = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'maintenance-jobs-app-status-reconciler-runtime');
    expect(statusRuntime).toMatchObject({
      data: {
        'status-runtime.json': expect.stringContaining('repair-accounts'),
        'runtime__job-runner.mjs': expect.stringContaining('history.json'),
      },
    });
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('conflicts.json');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('StaleObservedGeneration');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('CompletedIdempotencyKeyRetained');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('ConcurrentObservationAccepted');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('metadata: { resourceVersion: existing.resourceVersion }');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('statusStoreConcurrency');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('attempt <= statusStoreConcurrency.maxAttempts');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('!isKubernetesConflict(error) || attempt === statusStoreConcurrency.maxAttempts');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('applik8s-job-status-reconciler-status-store-conflict-retry');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('applik8s-job-status-reconciler-status-store-conflict-exhausted');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('applik8s-job-status-reconciler-status-store-merged');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('acceptedUpdates');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('rejectedUpdates');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('conflictUpdates');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('statusPatchWithMergedGeneratedJobs');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain('parseGeneratedStatusJobs(existingData)');
    expect(String(statusRuntime?.data?.['runtime__job-runner.mjs'] ?? '')).toContain("status?.applik8s?.jobs");
    const statusRuntimeConfig = JSON.parse(String(statusRuntime?.data?.['status-runtime.json'] ?? '{}'));
    expect(statusRuntimeConfig.statusOwnership).toMatchObject({
      durableAuthority: 'generatedStatusConfigMap',
      releasePolicy: 'kroStatusProjectionRequired',
      applicationStatusProjection: 'requiredAuthoritative',
      appStatusSchemaContract: { ownership: 'kroStatusProjection' },
      concurrency: { maxAttempts: 5, retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted' },
    });
    expect(statusRuntimeConfig.targets).toEqual([
      expect.objectContaining({ jobName: 'repair-accounts', jobKind: 'Job', materialization: 'kubernetes-job' }),
      expect.objectContaining({ jobName: 'cleanup-accounts', jobKind: 'CronJob', materialization: 'kubernetes-cronjob' }),
    ]);
    const statusStore = composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'maintenance-jobs-app-status-reconciler-status');
    expect(statusStore).toBeDefined();
    expect(Reflect.get(statusStore ?? {}, '__externalRef')).toBe(true);
    expect(applicationGraphFor(composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job.repair-accounts', kind: 'job', runtime: expect.objectContaining({ statusLifecycle: expect.objectContaining({ multiJob: 'appLevelReconciler' }) }) }),
      expect.objectContaining({ id: 'job.cleanup-accounts', kind: 'job', schedule: expect.objectContaining({ cron: '*/15 * * * *', missedRunPolicy: 'failClosed' }), runtime: expect.objectContaining({ statusLifecycle: expect.objectContaining({ cronJob: 'latestRunAndHistory' }) }) }),
    ]));
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
      const provider = app.provide(IndexStore, 'valkey');
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
      expect(provider).toEqual({
        kind: 'applicationProvider',
        token: IndexStore,
        implementation: { kind: 'valkey' },
      });
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
    expect(plainValue(serverRole)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(plainValue(indexerRole)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list', 'watch'] }] });
    expect(JSON.stringify(sourceConfigMap)).toContain('applik8sServerRuntime');
    expect(JSON.stringify(sourceConfigMap)).toContain('hono');
    expect(JSON.stringify(sourceConfigMap)).toContain('server.mjs.map');
    expect(JSON.stringify(sourceConfigMap)).toContain('createResourceClient');
    expect(JSON.stringify(sourceConfigMap)).toContain('createIndexClient');
    expect(JSON.stringify(sourceConfigMap)).toContain('bindings.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('runtime.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('routes.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('routes.manifest.json');
    expect(JSON.stringify(sourceConfigMap)).toContain('runtime.bundle.json');
    expect(sourceConfigMap?.data?.['runtime.bundle.json']).toContain('"packageManagerAtStartup": false');
    expect(JSON.stringify(sourceConfigMap)).toContain('route-get-root-0.mjs');
    expect(JSON.stringify(sourceConfigMap)).toContain('route-post-notes-1.mjs');
    expect(JSON.stringify(sourceConfigMap)).not.toContain('Function(');
    expect(JSON.stringify(sourceConfigMap)).toContain('applik8s-server-route-failure');
    expect(JSON.stringify(sourceConfigMap)).toContain('context.req.param()');
    expect(JSON.stringify(sourceConfigMap)).toContain('get-root-0');
    expect(JSON.stringify(sourceConfigMap)).toContain('post-notes-1');
    expect(JSON.stringify(sourceConfigMap)).toContain('queryValkeyIndex');
    expect(JSON.stringify(sourceConfigMap)).toContain('ZREVRANGE');
    expect(JSON.stringify(sourceConfigMap)).toContain('web-index.default.svc.cluster.local');
    const emittedWebDeployment = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web');
    expect(JSON.stringify(emittedWebDeployment)).not.toContain('npm install');
    expect(JSON.stringify(emittedWebDeployment)).toContain('node');
    expect(JSON.stringify(emittedWebDeployment)).toContain('/app/server.mjs');
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
    expect(kroYaml).toMatch(
      /phase: ['"]\$\{webDeployment\.status\.availableReplicas >= webDeployment\.spec\.replicas \?/,
    );
  });

  it('lowers operator watch scopes into app graph contracts and fails closed for unsupported selectors', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const watchedOperator = Object.assign((_options: object) => ({}), {
      definition: {
        name: 'watched-notes-controller',
        resources: { Note },
        handlers: [
          { id: 'Note.reconcile.exact', event: 'reconcile', resource: Note, watch: { namespace: 'notes', name: 'one' } },
          { id: 'Note.reconcile.finite', event: 'reconcile', resource: Note, watch: { namespace: 'notes', names: ['one', 'two'] } },
          { id: 'Note.reconcile.labels', event: 'reconcile', resource: Note, watch: { namespace: 'notes', labelSelector: { matchLabels: { app: 'notes' } } } },
          { id: 'Note.reconcile.field', event: 'reconcile', resource: Note, watch: { namespace: 'notes', fieldSelector: 'metadata.name=one' } },
          { id: 'Note.reconcile.unsupported', event: 'reconcile', resource: Note, watch: { namespace: 'notes', labelSelector: { matchExpressions: [{ key: 'app', operator: 'Exists' }] } } },
        ],
      },
    });

    const composition = sdk.kubernetesComposition({
      name: 'watched-notes-app',
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'WatchedNotesApp',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      app.operator(watchedOperator, { namespace: 'notes' });
      return { ready: true };
    });

    composition.factory('kro').toYaml();
    const operatorNode = plainValue(applicationGraphFor(composition))?.nodes.find((node) => node.kind === 'operator' && node.name === 'watched-notes-controller');
    if (operatorNode?.kind !== 'operator') {
      throw new Error('expected operator graph node');
    }
    const watches = plainValue(operatorNode.watches);
    const watchContracts = plainValue(operatorNode.watchContracts ?? []);
    expect(watches).toEqual(expect.arrayContaining([
      { kind: 'exact', ref: { apiVersion: 'notes.applik8s.dev/v1alpha1', kind: 'Note', name: 'one', namespace: 'notes' } },
      { kind: 'finite', refs: expect.arrayContaining([{ apiVersion: 'notes.applik8s.dev/v1alpha1', kind: 'Note', name: 'two', namespace: 'notes' }]) },
      { kind: 'labelSelector', apiVersion: 'notes.applik8s.dev/v1alpha1', resourceKind: 'Note', namespace: 'notes', labels: { app: 'notes' } },
      { kind: 'fieldSelector', apiVersion: 'notes.applik8s.dev/v1alpha1', resourceKind: 'Note', namespace: 'notes', fieldSelector: 'metadata.name=one' },
      { kind: 'mixed', scopes: [] },
    ]));
    expect(watchContracts).toEqual(expect.arrayContaining([
      expect.objectContaining({ lowering: 'exact', failurePolicy: 'failClosed', permissions: expect.arrayContaining([expect.objectContaining({ resources: ['notes'], verbs: ['get', 'list', 'watch'] })]) }),
      expect.objectContaining({ lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' } }),
      expect.objectContaining({ lowering: 'mixed', permissions: [], diagnostics: expect.arrayContaining([expect.objectContaining({ event: 'applik8s-watch-scope-unlowerable', reason: 'UnsupportedLabelSelectorExpression', retryable: false })]) }),
    ]));
    const unsupportedContract = watchContracts.find((contract) => contract.diagnostics.some((diagnostic) => diagnostic.reason === 'UnsupportedLabelSelectorExpression'));
    expect(unsupportedContract).toMatchObject({ lowering: 'mixed', permissions: [], failurePolicy: 'failClosed' });
    expect(unsupportedContract?.scope).toEqual({ kind: 'mixed', scopes: [] });
    expect(watchContracts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: expect.objectContaining({ kind: 'labelSelector', labels: {} }) }),
    ]));
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
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi', implementation: 'implemented' }),
      expect.objectContaining({ name: 'provider.TransactionalDatabase', surface: 'stablePublicApi', implementation: 'implemented' }),
      expect.objectContaining({ name: 'provider.Queue', surface: 'stablePublicApi', implementation: 'implemented' }),
    ]));
    const providerImplementationByName = new Map(graph?.compatibility.labels.filter((label) => label.name.startsWith('provider.')).map((label) => [label.name, label.implementation]));
    expect(providerImplementationByName).toEqual(new Map([
      ['provider.AI', 'implemented'],
      ['provider.AnalyticalDatabase', 'implemented'],
      ['provider.Authorization', 'implemented'],
      ['provider.Certificate', 'implemented'],
      ['provider.CounterStore', 'implemented'],
      ['provider.CredentialStore', 'implemented'],
      ['provider.DnsPublication', 'implemented'],
      ['provider.EventLog', 'implemented'],
      ['provider.EventSource', 'implemented'],
      ['provider.HttpExposure', 'implemented'],
      ['provider.IndexStore', 'implemented'],
      ['provider.ObjectStorage', 'implemented'],
      ['provider.Queue', 'implemented'],
      ['provider.Secret', 'implemented'],
      ['provider.StructuredGeneration', 'implemented'],
      ['provider.TransactionalDatabase', 'implemented'],
      ['provider.WorkflowEngine', 'implemented'],
    ]));
    expect(graph?.compatibility.labels.filter((label) => label.name.startsWith('provider.')).every((label) => label.implementation === 'implemented')).toBe(true);
    const stableLabels = new Set(graph?.compatibility.labels.filter((label) => label.surface === 'stablePublicApi').map((label) => label.name));
    expect(graph?.compatibility.stablePublicApis.every((api) => stableLabels.has(api))).toBe(true);
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['provider.Secret', 'provider.Queue', 'provider.ObjectStorage', 'provider.HttpExposure', 'provider.CredentialStore']));
  });

  it('keeps the emitted app graph versioned while pruning unused framework-default providers', () => {
    const AccountEntity = entity('Account', {
      spec: type({ email: 'string', displayName: 'string' }),
      status: type({ phase: 'string?' }),
    });
    const composition = sdk.kubernetesComposition({
      name: 'accounts-golden-graph',
      apiVersion: 'accounts.applik8s.dev/v1alpha1',
      kind: 'AccountsGoldenGraph',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    }, (_spec, app) => {
      const store = TransactionalDatabase.postgres({ name: 'accounts-db', database: 'accounts', migrations: TransactionalDatabase.migrations.generatedJob({ jobName: 'accounts-model-migration' }) });
      const Account = app.model(AccountEntity, { database: store, schema: { identity: ['id'], constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }], indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }], transactions: 'supported', retention: { mode: 'retain' } } });
      app.server('admin', {}, (server) => {
        server.get('/accounts/:id', async (request) => Account.get({ id: request.query.id ?? '' }));
      });
      app.job('repair accounts', { taskKind: 'repair' });
      app.schedule('cleanup accounts', { taskKind: 'cleanup', cron: '0 3 * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
      return { ready: true };
    });
    const graph = applicationGraphFor(composition);
    if (!graph) {
      throw new Error('expected generated application graph');
    }
    const serialized = serializeApplicationGraph(graph);
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(graph).toMatchObject({ apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'accounts-golden-graph' } });
    expect(validateApplicationGraphCompatibilityPolicy(graph)).toEqual([]);
    expect(serialized).toContain('"apiVersion":"applik8s.appGraph/v1alpha1"');
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'job.accounts-model-migration',
      'job.cleanup-accounts',
      'job.repair-accounts',
      'model.account',
      'provider.transactional-database',
      'server.admin',
    ]);
    expect(nodesById.get('job.cleanup-accounts')).toMatchObject({ id: 'job.cleanup-accounts', kind: 'job', schedule: expect.objectContaining({ cron: '0 3 * * *' }) });
    expect(nodesById.get('job.repair-accounts')).toMatchObject({ id: 'job.repair-accounts', kind: 'job', observability: expect.objectContaining({ diagnosticsArtifact: { kind: 'jobDiagnostics', name: 'repair-accounts-diagnostics' } }) });
    expect(nodesById.get('model.account')).toMatchObject({ id: 'model.account', kind: 'model', materialization: expect.objectContaining({ mode: 'providerBacked', provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' } }) });
    expect(nodesById.get('provider.transactional-database')).toMatchObject({ id: 'provider.transactional-database', kind: 'provider', interface: 'TransactionalDatabase', implementation: 'postgres' });
    expect(nodesById.get('server.admin')).toMatchObject({ id: 'server.admin', kind: 'server', observability: expect.objectContaining({ health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' } }) });
    expect(graph?.edges.map((edge) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`)).toEqual([
      'job.accounts-model-migration:dependsOn:model.account',
      'provider.transactional-database:provides:model.account',
    ]);
    expect(graph?.compatibility.stablePublicApis).toEqual([
      'Model.create',
      'Model.delete',
      'Model.edit',
      'Model.on.create',
      'Model.on.delete',
      'Model.on.update',
      'Model.require',
      'Model.update',
      'Provider.named',
      'Resource.increment',
      'Resource.index',
      'Resource.on.reconcile',
      'Stream.process',
      'Stream.project',
      'Stream.subscribe',
      'app.agent',
      'app.aggregate',
      'app.all',
      'app.any',
      'app.config',
      'app.crd',
      'app.database.postgres',
      'app.defaults',
      'app.expose',
      'app.gateway',
      'app.http',
      'app.inject',
      'app.installation',
      'app.interpolate',
      'app.job',
      'app.mcp',
      'app.mcp.client',
      'app.model',
      'app.objectStore',
      'app.profile',
      'app.projection',
      'app.provide',
      'app.query',
      'app.resource',
      'app.schedule',
      'app.secret',
      'app.select',
      'app.selectProvider',
      'app.server',
      'app.stream',
      'app.subscription',
      'app.when',
      'app.workflow',
      'command',
      'event',
      'provider.AI',
      'provider.AnalyticalDatabase',
      'provider.Authorization',
      'provider.Certificate',
      'provider.CounterStore',
      'provider.CredentialStore',
      'provider.DnsPublication',
      'provider.EventLog',
      'provider.EventSource',
      'provider.HttpExposure',
      'provider.IndexStore',
      'provider.ObjectStorage',
      'provider.Queue',
      'provider.Secret',
      'provider.StructuredGeneration',
      'provider.TransactionalDatabase',
      'provider.WorkflowEngine',
      'sdk.kubernetesComposition',
      'stream',
      'workflow',
    ]);
  });

  it('fails fast when aggregate callbacks capture unsupported closure values', () => {
    const Note = sdk.crd({
      apiVersion: 'notes.applik8s.dev/v1alpha1',
      kind: 'Note',
      spec: type({ message: 'string' }),
      status: type({ count: 'number?' }),
    });
    const byBook = Note.index('byBook', {
      partitionBy: label('notes.applik8s.dev/book'),
      orderBy: metadata.creationTimestamp.desc(),
    });
    let increment = 1;
    // Prevent the test transform from constant-folding away the closure.
    if (Date.now() < 0) increment = 2;

    expect(() => {
      const composition = sdk.kubernetesComposition({
        name: 'notes-app-aggregate-closure-capture',
        apiVersion: 'notes.applik8s.dev/v1alpha1',
        kind: 'NotesAppAggregateClosureCapture',
        spec: type({}),
        status: type({ ready: 'boolean' }),
      }, (_spec, app) => {
        app.defaults({ indexes: 'valkey' });
        app.aggregate('noteStats', {
          source: byBook,
          target: {
            resource: Note,
            name: 'main',
            status: (stats: { readonly count: number }) => ({ count: stats.count }),
          },
          initial: { count: 0 },
          reduce: (stats: { readonly count: number }) => ({ count: stats.count + increment }),
        });
        return { ready: true };
      });
      void composition.resources;
    }).toThrow(/app\.aggregate noteStats reduce references module-scope identifier\(s\) that are not available inside the generated runtime: increment/);
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
    expect(plainValue(role)).toMatchObject({
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
    expect(plainValue(role)).toMatchObject({
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
    expect(plainValue(valkey)).toMatchObject({
      metadata: { name: 'shared-index' },
      spec: { template: { spec: { containers: [expect.objectContaining({ name: 'valkey', image: 'valkey/valkey:8.1-alpine' })] } } },
    });
    expect(plainValue(valkeyService)).toMatchObject({ spec: { ports: [{ name: 'valkey', port: 6379, targetPort: 6379 }] } });
    expect(plainValue(valkeyConnection)).toMatchObject({ data: { backend: 'valkey', host: 'shared-index.default.svc.cluster.local', port: '6379' } });
    expect(plainValue(indexer)).toMatchObject({ metadata: { name: 'web-indexer' } });
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
    })).toThrow(/app\.server route GET \/.*references module-scope identifier\(s\) that are not available inside the generated runtime: prefix/);
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
    expect(plainValue(role)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(plainValue(indexerRole)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['get', 'list', 'watch'] }] });
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
    expect(plainValue(role)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
    expect(sourceConfigMap).toMatchObject({ data: { 'bindings.mjs': expect.stringContaining('const Note = resourceClients["Note"];') } });
  });

  it('fails fast when function captures close over undeclared values', () => {
    const label = Function(
      'value',
      'return `${missingPrefix}-${value}`;',
    ) as (value: number) => string;

    expect(() =>
      serializeApplicationServerCaptures({ label }),
    ).toThrow(/app\.server capture "label" references module-scope identifier\(s\) that are not available inside the generated runtime: missingPrefix/);
  });

  it('uses the default Valkey IndexStore for request-path index queries', () => {
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
    const defaultValkey = composition.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'web-index');
    expect(role).toBeUndefined();
    expect(defaultValkey).toMatchObject({ metadata: { name: 'web-index' } });
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
    expect(plainValue(role)).toMatchObject({ rules: [{ apiGroups: ['notes.applik8s.dev'], resources: ['notes'], verbs: ['create'] }] });
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
    expect(plainValue(role)).toMatchObject({
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
    expect(valkey.valkeyBootstrap).toBeDefined();
    expect(rook.rookCephOperatorBootstrap).toBeDefined();
    expect(rook.rookObjectStorageClaim).toBeDefined();
    expect(kubernetesFactories).toBeTypeOf('object');
  });

  it('consumes the released TypeKro production provider surface', async () => {
    const workspacePackage = JSON.parse(await readFile('package.json', 'utf8'));
    const applik8sPackage = JSON.parse(await readFile('packages/applik8s/package.json', 'utf8'));
    const adapterPackage = JSON.parse(await readFile('packages/typekro-adapter/package.json', 'utf8'));
    const installedPackage = JSON.parse(await readFile('node_modules/typekro/package.json', 'utf8'));

    expect(workspacePackage.dependencies.typekro).toBe('0.33.7');
    expect(applik8sPackage.dependencies.typekro).toBe('0.33.7');
    expect(adapterPackage.dependencies.typekro).toBe('0.33.7');
    expect(installedPackage.version).toBe('0.33.7');
  });

  it('builds generated app infrastructure on existing TypeKro Kubernetes factories', async () => {
    const source = await readFile(new URL('../src/application-builder.ts', import.meta.url), 'utf8');

    expect(source).toContain("from 'typekro/kubernetes'");
    expect(source).toContain('deployment as typeKroDeployment');
    expect(source).toContain('serviceAccount as typeKroServiceAccount');
    expect(source).not.toMatch(/\bcreateResource\s*\(/);
  });

  it('declares package exports for the v0.2 TypeKro integration subpaths', async () => {
    const packageJson = JSON.parse(await readFile('packages/applik8s/package.json', 'utf8'));

    expect(packageJson.exports).toMatchObject({
      './dsl': { types: './dist/dsl.d.ts', import: './dist/dsl.js' },
      './typekro': { types: './dist/typekro.d.ts', import: './dist/typekro.js' },
      './factories': { types: './dist/factories.d.ts', import: './dist/factories.js' },
      './factories/*': { types: './dist/factories/*.d.ts', import: './dist/factories/*.js' },
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

// typecast-boundary: the JSON round-trip deliberately strips framework proxies while preserving the caller's fixture contract.
function plainValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function artifactOnlyOperationTarget(options: { readonly apply?: boolean; readonly dryRun?: boolean } = {}): OperationTarget<{ readonly ready: boolean }> {
  const unsupported = <T>(): Result<T> => ({
    ok: false,
    error: { code: 'LIFECYCLE_UNSAFE', message: 'adapter path must not run', severity: 'error', context: {}, recovery: { summary: 'Use operationTargetArtifacts.' } },
  });
  const operationTargetArtifacts = {
    ...(options.apply === false ? {} : { applyPlan: { operations: [{ kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'artifact-apply' } } }] } }),
    deletePlan: { operations: [{ kind: 'delete', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: 'artifact-apply' } }] },
    ...(options.dryRun === false ? {} : { dryRunPlan: { operations: [{ kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'artifact-dry-run' } } }] } }),
  };
  return {
    targetKind: 'operationTarget',
    adapter: { renderApply: unsupported, renderDelete: unsupported, inferRbac: unsupported },
    // typecast: this fixture intentionally omits applyPlan/dryRunPlan in negative cases to exercise generated binding runtime validation.
    operationTargetArtifacts: operationTargetArtifacts as never,
  };
}
