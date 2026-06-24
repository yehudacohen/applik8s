import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';

import {
  assertExpectedKubectlContext,
  describeLive,
  docker,
  formatSettledOutput,
  generatedManifestPaths,
  kubectl,
  logsIncludesOperationKind,
  sleep,
} from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-partial-${process.pid}`;
const group = `partial${process.pid}.applik8s.dev`;
let tempDir: string | undefined;
let artifactDir: string | undefined;
let samplePath: string | undefined;
let restrictedRolePath: string | undefined;

describeLive('live partial operation failure reconciliation', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await kubectl(['create', 'namespace', namespace]);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-live-partial-failure-'));
    const entrypoint = join(tempDir, 'partial-pipeline.ts');
    await writeFile(entrypoint, partialPipelineSource(group, namespace));

    const compiled = await createCompilerPipeline().run({
      entrypoint,
      outDir: join(tempDir, 'dist'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    if (!compiled.ok) {
      throw new Error(compiled.error.message);
    }

    const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
    if (!image.ok) {
      throw new Error(image.error.message);
    }

    artifactDir = join(tempDir, 'dist/kubernetes');
    samplePath = join(tempDir, 'partial-image.yaml');
    restrictedRolePath = join(tempDir, 'partial-pipeline-restricted-role.yaml');
    await writeFile(samplePath, partialJobYaml('partial-image', 's3://bucket/partial.png'));
    await writeFile(restrictedRolePath, restrictedRoleYaml());

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-partial-e2e', '--filename', manifestPath]);
    }
    await kubectl(['apply', '--server-side', '--force-conflicts', '--field-manager=applik8s-partial-e2e-rbac', '--filename', restrictedRolePath]);
    await kubectl(['wait', `crd/partialjobs.${group}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutStatusWithDiagnostics();
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `partialjobs.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports a failed operation while preserving earlier effects and skipping later effects', async () => {
    if (!samplePath) {
      throw new Error('Live partial-failure sample was not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-partial-e2e', '--filename', samplePath]);
    await waitForPartialFailureDiagnostics();
    const ready = await waitForReadyCondition('partial-image', 'False', 'ApplyFailed');

    expect(ready.message).toContain('partial effects');
    expect((await kubectl(['get', 'configmap/partial-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://bucket/partial.png');
    expect((await kubectl(['get', 'secret/partial-image-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `partialjobs.${group}/partial-image`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `partialjobs.${group}/partial-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('partial.applik8s.dev/job');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=partial-image,reason=PartialJobAccepted', '--output=jsonpath={.items[*].reason}'])).stdout.trim()).toBe('');
  }, 300_000);
});

function partialJobYaml(name: string, sourceUrl: string): string {
  return `apiVersion: ${group}/v1alpha1
kind: PartialJob
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  sourceUrl: ${sourceUrl}
`;
}

function restrictedRoleYaml(): string {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: partial-pipeline-controller
  namespace: ${namespace}
rules:
  - apiGroups: [${JSON.stringify(group)}]
    resources: [partialjobs]
    verbs: [get, list, watch, patch]
  - apiGroups: [${JSON.stringify(group)}]
    resources: [partialjobs/status]
    verbs: [get, patch, update]
  - apiGroups: [${JSON.stringify(group)}]
    resources: [partialjobs/finalizers]
    verbs: [get, patch, update]
  - apiGroups: ['']
    resources: [configmaps]
    verbs: [get, create, update, patch, delete]
  - apiGroups: ['']
    resources: [events]
    verbs: [create, patch, update]
`;
}

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', 'deployment/partial-pipeline', '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', 'deployment/partial-pipeline', '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=partial-pipeline', '--output=wide']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=partial-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForPartialFailureDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=partial-pipeline', '--all-containers=true', '--tail=800'])).stdout;
    if (
      logs.includes('OperationFailed') &&
      logsIncludesOperationKind(logs, 'apply') &&
      logs.includes('partial-image-secret') &&
      logs.includes('forbidden') &&
      logsIncludesJsonNumber(logs, 'completedOperations', 2) &&
      logsIncludesJsonNumber(logs, 'applied', 1) &&
      logsIncludesJsonNumber(logs, 'finalizersMutated', 1)
    ) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `partialjobs.${group}/partial-image`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/partial-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'secret/partial-image-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected partial operation failure diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForReadyCondition(name: string, status: 'True' | 'False' | 'Unknown', reason: string): Promise<{ readonly message: string }> {
  const started = Date.now();
  let lastCondition = '<missing>';
  while (Date.now() - started < 120_000) {
    // typecast: kubectl returns untyped JSON; this helper only reads optional Ready condition fields.
    const object = JSON.parse((await kubectl(['get', `partialjobs.${group}/${name}`, '--namespace', namespace, '--output=json'])).stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly reason?: string; readonly message?: string }[] } };
    const ready = object.status?.conditions?.find((condition) => condition.type === 'Ready');
    lastCondition = JSON.stringify(ready ?? null);
    if (ready?.status === status && ready.reason === reason && ready.message) {
      return { message: ready.message };
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `partialjobs.${group}/${name}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=partial-pipeline', '--all-containers=true', '--tail=1000']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ${name} Ready=${status} reason ${reason}, got ${lastCondition}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

function logsIncludesJsonNumber(logs: string, key: string, value: number): boolean {
  return logs.includes(`"${key}":${value}`) || logs.includes(`\\"${key}\\":${value}`) || logs.includes(`${key}: ${value}`);
}

function partialPipelineSource(apiGroup: string, operatorNamespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface PartialSpec { sourceUrl: string }
interface PartialStatus { phase?: 'Processing' }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'PartialSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl'],
    properties: { sourceUrl: { type: 'string' } },
  },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'PartialStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' } } },
};

export const PartialJob = sdk.crd<PartialSpec, PartialStatus>({
  apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)},
  kind: 'PartialJob',
  plural: 'partialjobs',
  spec,
  status,
  statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' },
});

export const partialPipeline = sdk.operator({
  name: 'partial-pipeline',
  deployment: { namespace: ${JSON.stringify(operatorNamespace)}, replicas: 1 },
  runtime: {
    handlerTimeoutSeconds: 5,
    leaderElection: { enabled: false, leaseName: 'partial-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
    concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
    rateLimit: { baseDelayMs: 1000, maxDelayMs: 5000 },
    health: { enabled: true, path: '/healthz', port: 8080 },
    metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
  },
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['partialjobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['partialjobs/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['partialjobs/finalizers'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: [''], resources: ['secrets'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] },
  ],
  resources: { PartialJob },
  handlers: [PartialJob.on.created((job) => {
    const childName = job.names.dnsSafe(job.metadata.name + '-output');
    job.finalizers.add('partial.applik8s.dev/job');
    job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: childName, namespace: job.metadata.namespace }, data: { sourceUrl: job.spec.sourceUrl } });
    job.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: job.names.dnsSafe(job.metadata.name + '-secret'), namespace: job.metadata.namespace }, data: { sourceUrl: 'czM6Ly9idWNrZXQvcGFydGlhbC5wbmc=' } });
    job.status.phase = 'Processing';
    job.events.normal('PartialJobAccepted', 'Partial job accepted for processing');
  })],
});
`;
}
