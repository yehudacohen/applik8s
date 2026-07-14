import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

describe('v0.5 generated workflow lowering', () => {
  it('emits a pinned Hatchet/CNPG bootstrap and production worker lifecycle without RabbitMQ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, task, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const SendWelcome = task('tenant.send-welcome.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { providerUnavailable: type({ retryAfterSeconds: 'number' }) } });
const OnboardTenant = workflow('tenant.onboard.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { rejected: type({ reason: 'string' }) }, signals: { approved: type({ approved: 'boolean' }) } });
const minimumTenantIdLength = 2;
function shouldSendWelcome(tenantId: string): boolean { return tenantId.length >= minimumTenantIdLength; }
const platform = app('workflow-proof', { namespace: 'workflow-proof' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ name: 'hatchet', namespace: 'workflow-proof', tenantId: 'tenant-id', credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'workflow-proof' } }));
const welcome = platform.task(SendWelcome, { retries: 3, executionTimeoutSeconds: 90 }, async (input) => ({ sent: shouldSendWelcome(input.tenantId) }));
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
      const rootInstance = parse(await readFile(result.value.artifacts.instanceYamlPaths.at(-1) ?? '', 'utf8'));
      expect(rootInstance.metadata).toMatchObject({ name: 'workflow-proof', namespace: 'workflow-proof' });
      const artifact = result.value.artifacts.workflowArtifacts[0];
      expect(artifact).toMatchObject({ sizeBytes: expect.any(Number), digest: expect.stringMatching(/^sha256:/) });
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      expect(source).toContain('HatchetClient');
      expect(source).toContain('applik8s-durable-error:');
      expect(source).toContain('providerUnavailable');
      expect(source).toContain('rejected');
      expect(source).not.toContain('runThreaded');
      const resources = result.value.artifacts.resources;
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
      const bundle = result.value.artifacts.manifest.spec.workflows;
      expect(bundle).toEqual([expect.objectContaining({ name: 'hatchet', digest: artifact?.digest, sizeBytes: artifact?.sizeBytes })]);
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
