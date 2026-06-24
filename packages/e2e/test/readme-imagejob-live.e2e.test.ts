import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
let ministackForward: PortForward | undefined;

describeLive('README ImageJob live operator acceptance', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
    await kubectl(['delete', 'crd', imageJobResource, '--ignore-not-found=true', '--wait=false']);
    await waitForNamespaceDeleted(namespace);
    await waitForCrdDeleted(imageJobResource);
    await kubectl(['create', 'namespace', namespace]);
    await installMinistack();
    ministackForward = await startPortForward(['--namespace', namespace, 'service/ministack', ':4566']);
    await seedMinistack(ministackForward.endpoint);

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
        allowNetworkAccess: true,
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
  endpoint: http://ministack.media.svc.cluster.local:4566
  region: us-east-1
  sourceBucket: images
  sourceKey: hero.png
  outputBucket: processed
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
    await ministackForward?.close();
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
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.sourceUrl}'])).stdout.trim()).toBe('s3://images/hero.png');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.formats}'])).stdout.trim()).toBe('webp,avif');
    expect((await kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--output=jsonpath={.data.outputUrls}'])).stdout.trim()).toBe('s3://processed/hero-image.webp,s3://processed/hero-image.avif');
    expect((await kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[0]}'])).stdout.trim()).toBe('s3://processed/hero-image.webp');
    expect((await kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[1]}'])).stdout.trim()).toBe('s3://processed/hero-image.avif');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=hero-image,reason=ImageJobComplete', '--output=jsonpath={.items[0].reason}'])).stdout.trim()).toBe('ImageJobComplete');
    if (!ministackForward) {
      throw new Error('Ministack port-forward was not started.');
    }
    expect(await readS3Text(ministackForward.endpoint, 'processed', 'hero-image.webp')).toBe('applik8s image format=webp\nhero-image-source');
    expect(await readS3Text(ministackForward.endpoint, 'processed', 'hero-image.avif')).toBe('applik8s image format=avif\nhero-image-source');
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
    await kubectl(['wait', `${imageJobResource}/hero-image`, '--namespace', namespace, '--for=jsonpath={.status.phase}=Complete', '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `${imageJobResource}/hero-image`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'configmap/hero-image-output', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app=ministack', '--tail=300']),
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

async function installMinistack(): Promise<void> {
  await docker(['pull', 'ministackorg/ministack'], process.cwd());
  await kubectl(['create', 'deployment', 'ministack', '--namespace', namespace, '--image=ministackorg/ministack', '--port=4566']);
  await kubectl(['expose', 'deployment/ministack', '--namespace', namespace, '--port=4566', '--target-port=4566']);
  await kubectl(['rollout', 'status', 'deployment/ministack', '--namespace', namespace, '--timeout=180s']);
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function startPortForward(args: readonly string[]): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', ...args], { cwd: process.cwd(), env: process.env });
  let output = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out starting kubectl port-forward.\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) -> 4566/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl port-forward exited with code ${code}.\n${output}`));
    });
  });
  return { endpoint, close: () => closePortForward(child) };
}

async function closePortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
  });
}

function s3(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

async function seedMinistack(endpoint: string): Promise<void> {
  const client = s3(endpoint);
  await client.send(new CreateBucketCommand({ Bucket: 'images' }));
  await client.send(new CreateBucketCommand({ Bucket: 'processed' }));
  await client.send(new PutObjectCommand({ Bucket: 'images', Key: 'hero.png', Body: new TextEncoder().encode('hero-image-source') }));
}

async function readS3Text(endpoint: string, bucket: string, key: string): Promise<string> {
  const response = await s3(endpoint).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`S3 object ${bucket}/${key} had no body.`);
  }
  return new TextDecoder().decode(await response.Body.transformToByteArray());
}
