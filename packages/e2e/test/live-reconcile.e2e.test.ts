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

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-live-${process.pid}`;
const group = `media${process.pid}.applik8s.dev`;
let tempDir: string | undefined;
let artifactDir: string | undefined;
let samplePath: string | undefined;
let conflictSamplePath: string | undefined;
let conflictConfigMapPath: string | undefined;
let statusConflictSamplePath: string | undefined;
let statusConflictPatchPath: string | undefined;
let rbacDeniedSamplePath: string | undefined;
let malformedSamplePath: string | undefined;
let restartSamplePath: string | undefined;
let updatedSamplePath: string | undefined;
let timeoutSamplePath: string | undefined;

describeLive('live generated operator reconciliation', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await kubectl(['create', 'namespace', namespace]);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-live-reconcile-'));
    const entrypoint = join(tempDir, 'image-pipeline.ts');
    await writeFile(entrypoint, imagePipelineSource(group, namespace));

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
    samplePath = join(tempDir, 'hero-image.yaml');
    conflictSamplePath = join(tempDir, 'conflict-image.yaml');
    conflictConfigMapPath = join(tempDir, 'conflict-configmap.yaml');
    statusConflictSamplePath = join(tempDir, 'status-conflict-image.yaml');
    statusConflictPatchPath = join(tempDir, 'status-conflict-image-status.yaml');
    rbacDeniedSamplePath = join(tempDir, 'rbac-denied-image.yaml');
    malformedSamplePath = join(tempDir, 'malformed-output-image.yaml');
    restartSamplePath = join(tempDir, 'restart-image.yaml');
    updatedSamplePath = join(tempDir, 'updated-image.yaml');
    timeoutSamplePath = join(tempDir, 'timeout-image.yaml');
    await writeFile(samplePath, imageJobYaml('hero-image', 's3://bucket/hero.png'));
    await writeFile(conflictSamplePath, imageJobYaml('conflict-image', 's3://bucket/conflict.png'));
    await writeFile(statusConflictSamplePath, imageJobYaml('status-conflict-image', 's3://bucket/status-conflict.png'));
    await writeFile(rbacDeniedSamplePath, imageJobYaml('rbac-denied-image', 's3://bucket/rbac-denied.png'));
    await writeFile(malformedSamplePath, imageJobYaml('malformed-output-image', 's3://bucket/malformed.png'));
    await writeFile(restartSamplePath, imageJobYaml('restart-image', 's3://bucket/restart.png'));
    await writeFile(updatedSamplePath, imageJobYaml('updated-image', 's3://bucket/updated-original.png'));
    await writeFile(timeoutSamplePath, imageJobYaml('timeout-image', 's3://bucket/timeout.png'));
    await writeFile(conflictConfigMapPath, `apiVersion: v1
kind: ConfigMap
metadata:
  name: conflict-image-output
  namespace: ${namespace}
data:
  sourceUrl: s3://external-owner/original.png
`);
    await writeFile(statusConflictPatchPath, `apiVersion: ${group}/v1alpha1
kind: ImageJob
metadata:
  name: status-conflict-image
  namespace: ${namespace}
status:
  phase: ExternalOwner
`);

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', manifestPath]);
    }
    await kubectl(['wait', `crd/imagejobs.${group}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutStatusWithDiagnostics();
  }, 600_000);

  function imageJobYaml(name: string, sourceUrl: string): string {
    return `apiVersion: ${group}/v1alpha1
kind: ImageJob
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  sourceUrl: ${sourceUrl}
  formats:
    - webp
  priority: normal
`;
  }

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `imagejobs.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reconciles a created object with status, owner refs, events, finalizers, and requeue', async () => {
    if (!artifactDir || !samplePath || !conflictSamplePath || !conflictConfigMapPath || !statusConflictSamplePath || !statusConflictPatchPath || !rbacDeniedSamplePath || !malformedSamplePath || !restartSamplePath || !updatedSamplePath || !timeoutSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', samplePath]);

    await waitForStatusWithDiagnostics();
    await waitForReadyCondition('hero-image', 'True', 'ReconcileSucceeded', 1);
    expect((await kubectl(['get', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('media.applik8s.dev/imagejob');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://bucket/hero.png');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences[0].apiVersion}'])).stdout.trim()).toBe(`${group}/v1alpha1`);
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences[0].kind}'])).stdout.trim()).toBe('ImageJob');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences[0].name}'])).stdout.trim()).toBe('hero-image');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences[0].controller}'])).stdout.trim()).toBe('true');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences[0].uid}'])).stdout.trim()).toBe((await kubectl(['get', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--output=jsonpath={.metadata.uid}'])).stdout.trim());
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=hero-image,reason=ImageJobAccepted', '--output=jsonpath={.items[0].reason}'])).stdout.trim()).toBe('ImageJobAccepted');
    expect((await kubectl(['get', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--output=jsonpath={.status.requeueAfterSeconds}'])).stdout.trim()).toBe('30');
  }, 300_000);

  it('routes generation changes through the updated handler', async () => {
    if (!updatedSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', updatedSamplePath]);
    await waitForConfigMapSource('updated-image-output', 's3://bucket/updated-original.png');
    await kubectl(['patch', `imagejobs.${group}/updated-image`, '--namespace', namespace, '--type=merge', '--patch', '{"spec":{"sourceUrl":"s3://bucket/updated-next.png"}}']);
    await kubectl(['wait', `imagejobs.${group}/updated-image`, '--namespace', namespace, '--for=jsonpath={.metadata.generation}=2', '--timeout=60s']);
    await waitForConfigMapSource('updated-image-output', 's3://bucket/updated-next.png');
    await waitForReadyCondition('updated-image', 'True', 'ReconcileSucceeded', 2);
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=updated-image,reason=ImageJobUpdated', '--output=jsonpath={.items[0].reason}'])).stdout.trim()).toBe('ImageJobUpdated');
  }, 300_000);

  it('rebuilds missing child state after an operator restart and resync', async () => {
    if (!restartSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', restartSamplePath]);
    await waitForConfigMapSource('restart-image-output', 's3://bucket/restart.png');
    await kubectl(['scale', 'deployment/image-pipeline', '--namespace', namespace, '--replicas=0']);
    await kubectl(['wait', '--for=delete', 'pod', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--timeout=180s']);
    await kubectl(['delete', 'configmap/restart-image-output', '--namespace', namespace, '--ignore-not-found=true']);
    expect((await kubectl(['get', 'configmap/restart-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    await kubectl(['scale', 'deployment/image-pipeline', '--namespace', namespace, '--replicas=1']);
    await rolloutStatusWithDiagnostics();
    await waitForRestartResyncWithDiagnostics();
  }, 300_000);

  it('runs finalize cleanup before removing the framework finalizer', async () => {
    await kubectl(['delete', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--wait=false']);
    await waitForFinalizationWithDiagnostics();
  }, 300_000);

  it('surfaces server-side apply conflicts and preserves earlier finalizer effects', async () => {
    if (!conflictConfigMapPath || !conflictSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=external-owner', '--filename', conflictConfigMapPath]);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', conflictSamplePath]);
    await waitForConflictDiagnostics();
    await waitForReadyCondition('conflict-image', 'False', 'ApplyFailed');

    expect((await kubectl(['get', 'configmap/conflict-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://external-owner/original.png');
    expect((await kubectl(['get', `imagejobs.${group}/conflict-image`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `imagejobs.${group}/conflict-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('media.applik8s.dev/imagejob');
  }, 300_000);

  it('surfaces status patch conflicts after successful child apply effects', async () => {
    if (!statusConflictSamplePath || !statusConflictPatchPath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', statusConflictSamplePath]);
    await kubectl(['apply', '--server-side', '--field-manager=external-status-owner', '--subresource=status', '--filename', statusConflictPatchPath]);
    await kubectl(['annotate', `imagejobs.${group}/status-conflict-image`, '--namespace', namespace, 'applik8s.dev/status-conflict-trigger=true', '--overwrite']);
    await waitForStatusConflictDiagnostics();
    await waitForReadyCondition('status-conflict-image', 'False', 'StatusPatchFailed');

    expect((await kubectl(['get', 'configmap/status-conflict-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://bucket/status-conflict.png');
    expect((await kubectl(['get', `imagejobs.${group}/status-conflict-image`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('ExternalOwner');
    expect((await kubectl(['get', `imagejobs.${group}/status-conflict-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('media.applik8s.dev/imagejob');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=status-conflict-image,reason=ImageJobAccepted', '--output=jsonpath={.items[*].reason}'])).stdout.trim()).toBe('');
  }, 300_000);

  it('stops on RBAC denial and does not apply later status or event operations', async () => {
    if (!rbacDeniedSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', rbacDeniedSamplePath]);
    await waitForRbacDeniedDiagnostics();
    await waitForReadyCondition('rbac-denied-image', 'False', 'UndeclaredPermission');

    expect((await kubectl(['get', 'configmap/rbac-denied-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', 'secret/rbac-denied-image-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `imagejobs.${group}/rbac-denied-image`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `imagejobs.${group}/rbac-denied-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=rbac-denied-image,reason=ImageJobAccepted', '--output=jsonpath={.items[*].reason}'])).stdout.trim()).toBe('');
  }, 300_000);

  it('fails closed on malformed handler output before Kubernetes effects', async () => {
    if (!malformedSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', malformedSamplePath]);
    await waitForMalformedOutputDiagnostics();
    await waitForReadyCondition('malformed-output-image', 'False', 'InvalidRuntimePayload');

    expect((await kubectl(['get', 'configmap/malformed-output-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `imagejobs.${group}/malformed-output-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=malformed-output-image,reason=ImageJobAccepted', '--output=jsonpath={.items[*].reason}'])).stdout.trim()).toBe('');
  }, 300_000);

  it('interrupts timed-out WASM handlers without applying child state', async () => {
    if (!timeoutSamplePath) {
      throw new Error('Live reconcile artifacts were not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-live-e2e', '--filename', timeoutSamplePath]);
    await waitForReadyCondition('timeout-image', 'False', 'HandlerTimedOut');
    expect((await kubectl(['get', 'configmap/timeout-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
  }, 300_000);
});

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', 'deployment/image-pipeline', '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', 'deployment/image-pipeline', '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=200']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['wait', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--for=jsonpath={.status.phase}=Processing', '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'configmaps', '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Status wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForFinalizationWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['wait', '--for=delete', 'configmap/hero-image-output', '--namespace', namespace, '--timeout=180s']);
    await kubectl(['wait', '--for=delete', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `imagejobs.${group}/hero-image`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Finalization wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForConfigMapSource(name: string, sourceUrl: string): Promise<void> {
  const started = Date.now();
  let lastValue = '';
  while (Date.now() - started < 180_000) {
    lastValue = (await kubectl(['get', `configmap/${name}`, '--namespace', namespace, '--ignore-not-found=true', '--output=jsonpath={.data.sourceUrl}'])).stdout.trim();
    if (lastValue === sourceUrl) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Expected configmap/${name} .data.sourceUrl to be ${sourceUrl}, got ${lastValue || '<missing>'}.`);
}

async function waitForRestartResyncWithDiagnostics(): Promise<void> {
  try {
    await waitForConfigMapSource('restart-image-output', 's3://bucket/restart.png');
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `imagejobs.${group}/restart-image`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'configmap/restart-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--output=wide']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Restart resync wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForConflictDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=500'])).stdout;
    if (logs.includes('OperationFailed') && logsIncludesOperationKind(logs, 'apply') && logs.includes('conflict-image-output') && logs.includes('conflict')) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `imagejobs.${group}/conflict-image`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/conflict-image-output', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected SSA conflict diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForStatusConflictDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=700'])).stdout;
    if (logs.includes('OperationFailed') && logsIncludesOperationKind(logs, 'status') && logs.includes('status-conflict-image') && logs.includes('conflict')) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `imagejobs.${group}/status-conflict-image`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/status-conflict-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected status conflict diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForRbacDeniedDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=900'])).stdout;
    if (logs.includes('UndeclaredPermission') && logs.includes('resource=secrets')) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `imagejobs.${group}/rbac-denied-image`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/rbac-denied-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'secret/rbac-denied-image-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected RBAC denial diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForMalformedOutputDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=1100'])).stdout;
    if (logs.includes('InvalidPayload') && logs.includes('status.status must be a JSON object')) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `imagejobs.${group}/malformed-output-image`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/malformed-output-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected malformed handler output diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForReadyCondition(name: string, status: 'True' | 'False' | 'Unknown', reason: string, observedGeneration?: number): Promise<void> {
  const started = Date.now();
  let lastCondition = '<missing>';
  while (Date.now() - started < 120_000) {
    // typecast: kubectl returns untyped JSON; this helper only reads the optional status condition fields it validates.
    const object = JSON.parse((await kubectl(['get', `imagejobs.${group}/${name}`, '--namespace', namespace, '--output=json'])).stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly reason?: string; readonly observedGeneration?: number; readonly message?: string }[] } };
    const ready = object.status?.conditions?.find((condition) => condition.type === 'Ready');
    lastCondition = JSON.stringify(ready ?? null);
    const generationMatches = observedGeneration === undefined ? typeof ready?.observedGeneration === 'number' : ready?.observedGeneration === observedGeneration;
    if (ready?.status === status && ready.reason === reason && generationMatches && ready.message) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `imagejobs.${group}/${name}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=1200']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ${name} Ready=${status} reason ${reason}, got ${lastCondition}.
${diagnostics.map(formatSettledOutput).join('\n')}`);
}

function imagePipelineSource(apiGroup: string, operatorNamespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string; formats: string[]; priority: 'low' | 'normal' | 'high' }
interface ImageStatus { phase?: 'Processing'; outputUrls?: string[]; requeueAfterSeconds?: number }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl', 'formats', 'priority'],
    additionalProperties: false,
    properties: {
      sourceUrl: { type: 'string' },
      formats: { type: 'array', items: { type: 'string' } },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    },
  },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } }, requeueAfterSeconds: { type: 'number' } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
  apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)},
  kind: 'ImageJob',
  spec,
  status,
  statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' },
});
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: ${JSON.stringify(operatorNamespace)}, replicas: 1 },
  runtime: {
    handlerTimeoutSeconds: 1,
    leaderElection: { enabled: false, leaseName: 'image-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
    concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
    rateLimit: { baseDelayMs: 1000, maxDelayMs: 5000 },
    health: { enabled: true, path: '/healthz', port: 8080 },
    metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
  },
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['imagejobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['imagejobs/finalizers'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] },
  ],
  resources: { ImageJob },
  handlers: [ImageJob.on.created((job) => {
    if (job.event !== 'created') {
      throw new Error('Expected created event routing.');
    }
    const childName = job.names.dnsSafe(job.metadata.name + '-output');
    if (job.metadata.name === 'rbac-denied-image') {
      job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: childName, namespace: job.metadata.namespace }, data: { sourceUrl: job.spec.sourceUrl } });
      job.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'rbac-denied-image-secret', namespace: job.metadata.namespace }, data: { sourceUrl: 'czM6Ly9idWNrZXQvcmJhYy1kZW5pZWQucG5n' } });
      job.status.phase = 'Processing';
      job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
      job.finalizers.add('media.applik8s.dev/imagejob');
      return;
    }
    if (job.metadata.name === 'malformed-output-image') {
      return {
        apply: [{ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: childName, namespace: job.metadata.namespace }, data: { sourceUrl: job.spec.sourceUrl } }],
        status: 'not-a-json-object',
        events: [{ kind: 'event', type: 'Normal', reason: 'ImageJobAccepted', message: 'Image job accepted for processing' }],
        finalizers: [{ kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/imagejob' }],
      } as never;
    }
    if (job.metadata.name === 'timeout-image') {
      while (true) {}
    }
    job.finalizers.add('media.applik8s.dev/imagejob');
    job.status.phase = 'Processing';
    job.status.outputUrls = [];
    job.status.requeueAfterSeconds = 30;
    job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: childName, namespace: job.metadata.namespace }, data: { sourceUrl: job.spec.sourceUrl } });
    job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
    job.requeue({ afterSeconds: 30, reason: 'verify-live-requeue' });
  }), ImageJob.on.updated((job) => {
    if (job.event !== 'updated') {
      throw new Error('Expected updated event routing.');
    }
    const childName = job.names.dnsSafe(job.metadata.name + '-output');
    job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: childName, namespace: job.metadata.namespace }, data: { sourceUrl: job.spec.sourceUrl } });
    job.events.normal('ImageJobUpdated', 'Image job update accepted');
  }), ImageJob.on.reconcile(() => {
    throw new Error('Expected generation-based created routing.');
  }), ImageJob.on.finalize((job) => {
    if (job.event !== 'finalize') {
      throw new Error('Expected finalize event routing.');
    }
    const childName = job.names.dnsSafe(job.metadata.name + '-output');
    const childRef = { apiVersion: 'v1', kind: 'ConfigMap', name: childName, ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}) };
    job.delete(childRef, { propagationPolicy: 'Foreground' });
    job.events.normal('ImageJobFinalized', 'Image job cleanup completed');
    job.finalizers.remove('media.applik8s.dev/imagejob');
  })],
});
`;
}
