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
  logsIncludeJsonField,
  sleep,
} from './live-e2e-helpers';

const namespace = 'media';
const apiGroup = 'media.applik8s.dev';
const imageJobResource = `imagejobs.${apiGroup}`;

let tempDir: string | undefined;
let artifactDir: string | undefined;
let samplePath: string | undefined;

describeLive('README ImageJob live operator acceptance', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
    await kubectl(['delete', 'crd', imageJobResource, '--ignore-not-found=true', '--wait=false']);
    await waitForNamespaceDeleted(namespace);
    await waitForCrdDeleted(imageJobResource);
    await kubectl(['create', 'namespace', namespace]);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-readme-imagejob-live-'));
    const compiled = await createCompilerPipeline().run({
      entrypoint: join(process.cwd(), 'examples/imagejob.ts'),
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
    expect(compiled.value.manifest.spec.handlerArtifact.path).toContain('handler.wasm');
    expect(compiled.value.manifest.spec.handlerExports).toEqual(expect.arrayContaining([
      expect.objectContaining({ handlerId: 'ImageJob.reconcile.0', event: 'reconcile' }),
      expect.objectContaining({ handlerId: 'ImageJob.finalize.1', event: 'finalize', finalizers: ['media.applik8s.dev/imagejob'] }),
    ]));

    const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
    if (!image.ok) {
      throw new Error(image.error.message);
    }

    artifactDir = join(tempDir, 'dist/kubernetes');
    samplePath = join(tempDir, 'hero-image.yaml');
    await writeFile(samplePath, `apiVersion: media.applik8s.dev/v1alpha1
kind: ImageJob
metadata:
  name: hero-image
  namespace: media
spec:
  sourceUrl: s3://bucket/hero.png
  formats:
    - webp
    - avif
  priority: normal
`);

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-readme-e2e', '--filename', manifestPath]);
    }
    await kubectl(['wait', `crd/${imageJobResource}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutStatusWithDiagnostics();
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', imageJobResource, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('runs the exact README ImageJob source through the Rust/WASM operator runtime', async () => {
    if (!samplePath) {
      throw new Error('README ImageJob sample was not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-readme-e2e', '--filename', samplePath]);

    await waitForImageJobStatusWithDiagnostics();
    expect((await kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('media.applik8s.dev/imagejob');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://bucket/hero.png');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.formats}'])).stdout.trim()).toBe('webp,avif');
    expect((await kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[0]}'])).stdout.trim()).toBe('s3://processed/hero-image.webp');
    expect((await kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[1]}'])).stdout.trim()).toBe('s3://processed/hero-image.avif');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=hero-image,reason=ImageJobAccepted', '--output=jsonpath={.items[0].reason}'])).stdout.trim()).toBe('ImageJobAccepted');
    await waitForRuntimeListenerLog('ImageJob.reconcile.0', 'reconcile');

    await kubectl(['delete', `${imageJobResource}/hero-image`, '--namespace', namespace, '--wait=false']);
    await waitForFinalizationWithDiagnostics();
    await waitForRuntimeListenerLog('ImageJob.finalize.1', 'finalize');
  }, 360_000);
});

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', 'deployment/image-pipeline', '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', 'deployment/image-pipeline', '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--output=wide']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForImageJobStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['wait', `${imageJobResource}/hero-image`, '--namespace', namespace, '--for=jsonpath={.status.phase}=Processing', '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=500']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'ImageJob status wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForFinalizationWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['wait', '--for=delete', 'configmap/hero-image-output', '--namespace', namespace, '--timeout=180s']);
    await kubectl(['wait', '--for=delete', `${imageJobResource}/hero-image`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=700']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Finalization wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForRuntimeListenerLog(handlerId: string, event: string): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=1000'])).stdout;
    if (logsIncludeJsonField(logs, 'handlerId', handlerId) && logsIncludeJsonField(logs, 'event', event)) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Expected runtime logs to include handlerId=${handlerId} and event=${event}.\n${logs}`);
}

async function waitForNamespaceDeleted(name: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const result = await kubectl(['get', 'namespace', name, '--ignore-not-found=true', '--output=name']);
    if (result.stdout.trim() === '') {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for namespace/${name} to be deleted.`);
}

async function waitForCrdDeleted(name: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const result = await kubectl(['get', 'crd', name, '--ignore-not-found=true', '--output=name']);
    if (result.stdout.trim() === '') {
      return;
    }
    await sleep(2_000);
  }
  const remaining = await kubectl(['get', imageJobResource, '--all-namespaces', '--ignore-not-found=true', '--output=name']);
  if (remaining.stdout.trim() === '') {
    await kubectl(['patch', 'crd', name, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
    const forcedAt = Date.now();
    while (Date.now() - forcedAt < 30_000) {
      const result = await kubectl(['get', 'crd', name, '--ignore-not-found=true', '--output=name']);
      if (result.stdout.trim() === '') {
        return;
      }
      await sleep(1_000);
    }
    throw new Error(`Timed out waiting for crd/${name} to be deleted after clearing finalizers.`);
  }
  throw new Error(`Timed out waiting for crd/${name} to be deleted.`);
}
