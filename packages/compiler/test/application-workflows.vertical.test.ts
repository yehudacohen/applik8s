import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

describe('v0.5 generated workflow lowering', () => {
  it('emits a pinned Hatchet/CNPG bootstrap and production worker lifecycle without RabbitMQ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, task, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import { type } from '@applik8s/applik8s/dsl';
const SendWelcome = task('tenant.send-welcome.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { providerUnavailable: type({ retryAfterSeconds: 'number' }) } });
const GeneratedWelcome = type({ sent: 'boolean' });
const OnboardTenant = workflow('tenant.onboard.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { rejected: type({ reason: 'string' }) }, signals: { approved: type({ approved: 'boolean' }) } });
const minimumTenantIdLength = 2;
function shouldSendWelcome(tenantId: string): boolean { return tenantId.length >= minimumTenantIdLength; }
const platform = app('workflow-proof', {
  namespace: 'workflow-proof',
  apiVersion: 'applications.example.test/v1alpha1',
  kind: 'WorkflowProofInstallation',
  spec: type({ profile: "'starter' | 'external'", generationEndpoint: 'string', generationSecretName: 'string' }),
  status: type({ ready: 'boolean' }),
});
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ name: 'hatchet', namespace: 'workflow-proof', tenantId: 'tenant-id', credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'workflow-proof' } }));
platform.provide(StructuredGeneration, platform.selectProvider(platform.installation.spec.profile, {
  external: StructuredGeneration.http({ endpoint: platform.installation.spec.generationEndpoint, credentialSecret: { apiVersion: 'v1', kind: 'Secret', name: platform.installation.spec.generationSecretName, namespace: 'workflow-proof' } }),
  default: StructuredGeneration.deterministic({ output: { sent: true }, inputUnits: 1, outputUnits: 1 }),
}));
const welcome = platform.task(SendWelcome, { retries: 3, executionTimeoutSeconds: 90, requires: [StructuredGeneration] }, async (input, context) => {
  if (!shouldSendWelcome(input.tenantId)) return { sent: false };
  return (await context.use(StructuredGeneration).generate({ profile: 'welcome', input: { tenantId: input.tenantId }, output: GeneratedWelcome, idempotencyKey: input.requestId, signal: context.signal })).value;
});
platform.workflow(OnboardTenant, { tasks: { welcome }, worker: { scaling: { mode: 'kedaHatchetSlots', minReplicas: 1, maxReplicas: 8 } } }, async (input, context) => {
  await context.sleep('1s');
  return context.task('welcome', input, { idempotencyKey: input.requestId });
});
export const workflowProof = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'workflowProof',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.workflowArtifacts).toHaveLength(1);
      expect(result.value.artifacts.instanceYamlPaths).toHaveLength(0);
      const rootDefinition = result.value.artifacts.resources.find((resource) => resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === 'workflow-proof');
      expect(rootDefinition).toMatchObject({ spec: { schema: { spec: { profile: expect.any(String), generationEndpoint: expect.any(String), generationSecretName: expect.any(String) } } } });
      const artifact = result.value.artifacts.workflowArtifacts[0];
      expect(artifact).toMatchObject({ sizeBytes: expect.any(Number), digest: expect.stringMatching(/^sha256:/) });
      expect(artifact?.container).toMatchObject({ image: expect.stringMatching(/^applik8s\/workflow-proof-workflow-worker-hatchet:sha-[0-9a-f]{64}$/), entrypoint: '/app/workflow-worker.mjs' });
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      expect(source).toContain('HatchetClient');
      expect(source).toContain('applik8s-workflow-startup-wait');
      expect(source).toContain('applik8s-workflow-startup-timeout');
      expect(source).toContain('Hatchet engine');
      expect(source).toContain('Hatchet API');
      expect(source).toContain('applik8s-durable-error:');
      expect(source).toContain('providerUnavailable');
      expect(source).toContain('rejected');
      expect(source).toContain('applik8s-structured-generation-output-invalid');
      expect(source).toContain('attempted to use undeclared capability');
      expect(source).toContain('APPLIK8S_STRUCTURED_GENERATION_SELECTION');
      expect(source).toContain('structured-generation-deterministic');
      expect(source).toContain('structured-generation-http');
      expect(source).not.toContain('runThreaded');
      const resources = result.value.artifacts.resources;
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'hatchet-source' }) })]));
      expect(resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'hatchet-db', namespace: 'workflow-proof' }) }),
        expect.objectContaining({ apiVersion: 'helm.toolkit.fluxcd.io/v2', kind: 'HelmRelease', spec: expect.objectContaining({ values: expect.objectContaining({ postgres: { enabled: false }, rabbitmq: { enabled: false } }) }) }),
        expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'hatchet' }) }),
        expect.objectContaining({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget' }),
        expect.objectContaining({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy' }),
        expect.objectContaining({ apiVersion: 'keda.sh/v1alpha1', kind: 'TriggerAuthentication' }),
        expect.objectContaining({ apiVersion: 'keda.sh/v1alpha1', kind: 'ScaledObject', spec: expect.objectContaining({ minReplicaCount: 1, maxReplicaCount: 8 }) }),
      ]));
      const networkPolicy = resources.find((resource) => resource.kind === 'NetworkPolicy');
      expect(networkPolicy?.spec).toMatchObject({ policyTypes: ['Ingress'] });
      const release = resources.find((resource) => resource.kind === 'HelmRelease');
      expect(release?.spec).toMatchObject({ chart: { spec: { chart: 'hatchet-stack', version: '0.12.4' } }, valuesFrom: expect.arrayContaining([expect.objectContaining({ name: 'hatchet-worker', targetPath: 'sharedConfig.defaultAdminPassword' })]), values: { sharedConfig: { serverAuthCookieDomain: 'hatchet-api.workflow-proof.svc', env: { SERVER_MSGQUEUE_KIND: 'postgres' } }, postgres: { enabled: false }, rabbitmq: { enabled: false } } });
      const workerDeployment = resources.find((resource) => resource.kind === 'Deployment');
      expect(workerDeployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_STRUCTURED_GENERATION_SELECTION', value: '${schema.spec.profile}' },
        { name: 'APPLIK8S_STRUCTURED_GENERATION_ENDPOINT', value: '${schema.spec.profile == "external" ? schema.spec.generationEndpoint : ("")}' },
        { name: 'APPLIK8S_STRUCTURED_GENERATION_API_KEY', valueFrom: { secretKeyRef: { name: '${schema.spec.profile == "external" ? schema.spec.generationSecretName : ("applik8s-structured-generation-unused")}', key: '${schema.spec.profile == "external" ? "apiKey" : ("apiKey")}', optional: true } } },
      ]) })] } } });
      const bundle = result.value.artifacts.manifest.spec.workflows;
      expect(bundle).toEqual([expect.objectContaining({ name: 'hatchet', digest: artifact?.digest, sizeBytes: artifact?.sizeBytes })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('uses the provisioned Hatchet chart worker-token Secret by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-default-token-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, task, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = task('work.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('default-token', { namespace: 'default-token' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ name: 'runtime', namespace: 'default-token' }));
platform.task(Run, {}, async () => ({ done: true }));
export const defaultToken = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'defaultToken',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment');
      expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'hatchet-client-config', key: 'HATCHET_CLIENT_TOKEN' } } },
      ]) })] } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('lowers a typed online-projection rebuild into the workflow worker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-rebuild-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await mkdir(join(dir, 'migrations'));
      await writeFile(join(dir, 'migrations/0001_records.sql'), 'CREATE TABLE records (id text PRIMARY KEY);\n');
      await writeFile(entrypoint, `
import { app, event, IndexStore, ObjectStorage, task, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
const platform = app('rebuild-proof', { namespace: 'rebuild-proof' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ provision: false, namespace: 'rebuild-proof', hostPort: 'hatchet:7070', apiUrl: 'http://hatchet:8080', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'rebuild-proof' } }));
platform.provide(IndexStore, IndexStore.valkey({ name: 'online', namespace: 'rebuild-proof', host: 'online.rebuild-proof.svc', port: 6379, provision: false, authentication: { mode: 'password', secret: { apiVersion: 'v1', kind: 'Secret', name: 'online-password', namespace: 'rebuild-proof' }, key: 'password' } }));
platform.provide(ObjectStorage, ObjectStorage.s3({ name: 'artifacts', bucket: 'projection-artifacts', region: 'us-east-1', endpoint: 'http://objects.rebuild-proof.svc', credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'object-credentials', namespace: 'rebuild-proof' } }));
const records = pgTable('records', { id: text('id').primaryKey() });
const database = platform.database.postgres('records', { schema: { records }, migrations: { path: './migrations' } });
const RecordModel = platform.model(records, { name: 'Record', database });
const Changed = event('records.changed.v1', { payload: type({ id: 'string', score: 'number' }) });
const changes = platform.stream(Changed, { database, retention: { maxAgeSeconds: 86400 }, partitionBy: ({ id }) => id, authorize: () => false });
function rebuildPartition() { return 'all'; }
const timeline = changes.project('timeline', { store: IndexStore, output: type({ id: 'string', score: 'number' }), map: (payload) => payload, partitionBy: rebuildPartition, key: ({ id }) => id, score: ({ score }) => score, value: (row) => row, retention: { maxItemsPerPartition: 1000 }, generationScoped: true, rebuild: { source: RecordModel, map: (record) => ({ id: record.id, score: 0 }), checkpoint: 'durable' } });
const artifacts = platform.objectStore('projection-artifacts', { mode: 'immutable', maxObjectBytes: 4000000, contentTypes: ['application/vnd.applik8s.projection-segment+json', 'application/vnd.applik8s.projection-rebuild+json'] });
const Rebuild = task('records.rebuild.v1', { input: type({ generation: 'string' }), output: type({ watermark: 'number' }) });
platform.task(Rebuild, { projections: { timeline: { projection: timeline, artifacts, bounds: { batchSize: 250, maxSegments: 1000 } } }, objects: { artifacts } }, async (input, context) => {
  await context.objects.artifacts.head('rebuild/' + input.generation + '/manifest.json');
  return { watermark: (await context.projections.timeline.rebuild({ generation: input.generation })).publishedWatermark };
});
export const rebuildProof = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint, compositionName: 'rebuildProof', outDir: join(dir, 'dist'), runtimeVersionRange: '^0.6.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1', adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const artifact = result.value.artifacts.workflowArtifacts[0];
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
			const generatedSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'workflow-worker.generated.ts'), 'utf8');
      expect({
        rebuildRuntime: source.includes('applik8s.online-projection-rebuild/v1alpha1'),
        segmentRuntime: source.includes('applik8s.online-projection-segment/v1alpha1'),
        atomicPublish: source.includes('could not catch generation'),
        retirementGuard: source.includes('cannot retire artifact evidence owned by another scope'),
        providerGuard: source.includes('Projection rebuild object storage is disabled'),
				typedObjects: generatedSource.includes('objectRuntimes') && generatedSource.includes('attempted to use undeclared object store') && generatedSource.includes('Object body exceeds'),
        capturedHelper: source.includes('function(){return"all"}'),
        authoritativeSnapshot: source.includes('REPEATABLE READ READ ONLY') && source.includes('snapshot watermark'),
      }).toEqual({ rebuildRuntime: true, segmentRuntime: true, atomicPublish: true, retirementGuard: true, providerGuard: true, typedObjects: true, capturedHelper: true, authoritativeSnapshot: true });
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === artifact?.name);
      expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_REBUILD_VALKEY_HOST', value: 'online.rebuild-proof.svc' },
        { name: 'APPLIK8S_REBUILD_VALKEY_PASSWORD', valueFrom: { secretKeyRef: { name: 'online-password', key: 'password' } } },
        { name: 'APPLIK8S_REBUILD_OBJECT_BUCKET', value: 'projection-artifacts' },
				{ name: 'APPLIK8S_TASK_OBJECT_BUCKET', value: 'projection-artifacts' },
        { name: 'AWS_ACCESS_KEY_ID', valueFrom: { secretKeyRef: { name: 'object-credentials', key: 'AWS_ACCESS_KEY_ID', optional: true } } },
      ]) })] } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('rejects external effects hidden in module-scope workflow helpers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-effects-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Flow = workflow('unsafe.flow.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
async function hiddenEffect(id: string) { await fetch('https://example.test/' + id); }
const platform = app('unsafe-workflow');
platform.workflow(Flow, {}, async (input) => { await hiddenEffect(input.id); return { done: true }; });
export const unsafeWorkflow = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'unsafeWorkflow',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Move external effects into declared app.task');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('fails closed when KEDA task-stat scaling cannot name a Hatchet tenant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-invalid-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, task, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = task('work.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const Flow = workflow('work.flow.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('invalid-scaling', { namespace: 'invalid-scaling' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'invalid-scaling' }));
const run = platform.task(Run, { }, async () => ({ done: true }));
platform.workflow(Flow, { tasks: { run }, worker: { scaling: { mode: 'kedaHatchetSlots', maxReplicas: 4 } } }, async (input, context) => context.task('run', input));
export const invalidScaling = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'invalidScaling',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('has no tenantId');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('binds an externally managed Hatchet runtime without generating provider infrastructure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-external-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, task, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = task('external.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('external-runtime', { namespace: 'external-runtime' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ provision: false, namespace: 'external-runtime', hostPort: 'hatchet.example.test:7070', apiUrl: 'https://hatchet.example.test', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'external-hatchet-token', namespace: 'external-runtime' } }));
platform.task(Run, {}, async () => ({ done: true }));
export const externalRuntime = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'externalRuntime',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.resources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'HelmRelease' }),
        expect.objectContaining({ kind: 'HelmRepository' }),
        expect.objectContaining({ kind: 'Cluster' }),
      ]));
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment');
      expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'external-hatchet-token', key: 'HATCHET_CLIENT_TOKEN' } } },
        { name: 'HATCHET_CLIENT_HOST_PORT', value: 'hatchet.example.test:7070' },
        { name: 'HATCHET_CLIENT_API_URL', value: 'https://hatchet.example.test' },
      ]) })] } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
