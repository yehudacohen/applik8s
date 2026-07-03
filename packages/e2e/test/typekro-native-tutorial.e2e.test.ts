import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage } from '@applik8s/compiler';
import type { OperatorManifest } from '@applik8s/core';
import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-typekro-tutorial-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const group = `tutorial${process.pid}.applik8s.dev`;
const operatorName = 'tutorial-image-pipeline';
const imageJobName = 'tutorial-hero';
const statusConsumerName = 'tutorial-status-consumer';
const watchedDeploymentName = 'tutorial-watched-deployment';
const unwatchedDeploymentName = 'tutorial-unwatched-deployment';
const stackName = `tutorial-media-stack-${process.pid}`;
const stackKind = `TutorialMediaStack${process.pid}`;

let tempDir: string | undefined;
let outDir: string | undefined;

describeLive('live TypeKro-native tutorial', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-tutorial-'));
    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'media-stack.ts');
    await writeFile(entrypoint, mediaStackSource(group, namespace));

    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'mediaStack', '--out-dir', outDir], process.cwd());

    for (const manifestPath of await nestedOperatorManifestPaths()) {
      const image = await buildImplicitRuntimeImage({ manifest: await readOperatorManifest(manifestPath) });
      if (!image.ok) {
        throw new Error(image.error.message);
      }
    }
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `imagejobs.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('installs an operator, creates CRDs through factories, composes status, and routes TypeKro listeners', async () => {
    await runGeneratedTypeKroApplyScript();

    await kubectl(['wait', `crd/imagejobs.${group}`, '--for=condition=Established', '--timeout=90s']);
    await waitForDeploymentCreated();
    await rolloutStatusWithDiagnostics(operatorName);
    await waitForImageJobPhase('Processing');
    await waitForStatusConsumerPhase('Processing');

    expect((await kubectl(['get', `imagejobs.${group}/${imageJobName}`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[0]}'])).stdout.trim()).toBe(`s3://images/${imageJobName}.png.webp`);
    expect((await kubectl(['get', `configmap/${statusConsumerName}`, '--namespace', namespace, '--output=jsonpath={.data.phase}'])).stdout.trim()).toBe('Processing');

    await applyDeployment(watchedDeploymentName);
    await applyDeployment(unwatchedDeploymentName);
    await patchDeploymentTemplate(watchedDeploymentName, 'watched');
    await patchDeploymentTemplate(unwatchedDeploymentName, 'unwatched');

    await waitForObservedConfigMap(`listener-${watchedDeploymentName}`, watchedDeploymentName);
    await sleep(5_000);
    expect((await kubectl(['get', `configmap/listener-${unwatchedDeploymentName}`, '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
  }, 360_000);
});

async function ensureKroRuntime(): Promise<void> {
  try {
    await kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']);
    return;
  } catch {
    await ensureNamespace(runtimeNamespace);
    const bootstrap = typeKroRuntimeBootstrap({ namespace: runtimeNamespace, kroVersion: '0.9.0' });
    const factory = bootstrap.factory('direct', { namespace: runtimeNamespace, waitForReady: true, timeout: 300_000 });
    await factory.deploy({ namespace: runtimeNamespace });
    await kubectl(['wait', 'crd/resourcegraphdefinitions.kro.run', '--for=condition=Established', '--timeout=180s']);
  }
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', 'namespace', name]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function nestedOperatorManifestPaths(): Promise<readonly string[]> {
  const manifestPath = join(requiredOutDir(), 'typekro', 'typekro-composition.json');
  // typecast: composition bundle JSON is generated by applik8s; this test validates only nested operator manifest references.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly spec?: { readonly operators?: readonly { readonly manifest?: string }[] } };
  const paths = manifest.spec?.operators?.map((operator) => operator.manifest).filter((path): path is string => typeof path === 'string') ?? [];
  if (paths.length === 0) {
    throw new Error(`TypeKro composition manifest did not reference nested operator manifests: ${manifestPath}`);
  }
  return paths;
}

async function readOperatorManifest(path: string): Promise<OperatorManifest> {
  // typecast: nested operator manifest JSON is generated by the compiler and consumed immediately by the runtime image builder.
  return JSON.parse(await readFile(path, 'utf8')) as OperatorManifest;
}

async function runGeneratedTypeKroApplyScript(): Promise<void> {
  await exec('sh', [join(requiredOutDir(), 'typekro', 'apply.sh')], process.cwd());
}

async function rolloutStatusWithDiagnostics(deployment: string): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${deployment}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForDeploymentCreated(): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 180_000) {
    try {
      lastOutput = (await kubectl(['get', `deployment/${operatorName}`, '--namespace', namespace, '--output=name'])).stdout.trim();
      if (lastOutput === `deployment.apps/${operatorName}`) {
        return;
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', stackKind, stackName, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'all', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected KRO to create Deployment ${operatorName}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForImageJobPhase(phase: string): Promise<void> {
  try {
    await kubectl(['wait', `imagejobs.${group}/${imageJobName}`, '--namespace', namespace, `--for=jsonpath={.status.phase}=${phase}`, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `imagejobs.${group}/${imageJobName}`, '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=500']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `Expected ImageJob phase ${phase}.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForStatusConsumerPhase(phase: string): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 180_000) {
    try {
      lastOutput = (await kubectl(['get', `configmap/${statusConsumerName}`, '--namespace', namespace, '--output=jsonpath={.data.phase}'])).stdout.trim();
      if (lastOutput === phase) {
        return;
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `configmap/${statusConsumerName}`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', `imagejobs.${group}/${imageJobName}`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ConfigMap ${statusConsumerName} phase ${phase}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForObservedConfigMap(name: string, observed: string): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    try {
      lastOutput = (await kubectl(['get', `configmap/${name}`, '--namespace', namespace, '--output=jsonpath={.data.observed}'])).stdout.trim();
      if (lastOutput === observed) {
        return;
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', 'deployments', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmaps', '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=500']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ConfigMap ${name} to record ${observed}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function applyDeployment(name: string): Promise<void> {
  const path = join(requiredTempDir(), `${name}.deployment.yaml`);
  await writeFile(path, deploymentYaml(name));
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-tutorial-e2e', '--filename', path]);
}

async function patchDeploymentTemplate(name: string, value: string): Promise<void> {
  await kubectl(['annotate', `deployment/${name}`, '--namespace', namespace, `applik8s.dev/typekro-tutorial-patch=${value}`, '--overwrite']);
}

function deploymentYaml(name: string): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${name}
spec:
  replicas: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: placeholder
          image: busybox:1.36
          command: ["sh", "-c", "sleep 3600"]
`;
}

function requiredTempDir(): string {
  if (!tempDir) {
    throw new Error('TypeKro tutorial e2e temp directory was not initialized.');
  }
  return tempDir;
}

function requiredOutDir(): string {
  if (!outDir) {
    throw new Error('TypeKro tutorial e2e output directory was not initialized.');
  }
  return outDir;
}

function mediaStackSource(apiGroup: string, targetNamespace: string): string {
  return `import { type } from 'arktype';
import { cel, sdk, typeKro } from '@applik8s/applik8s';
import { ConfigMap } from '@applik8s/applik8s/factories/simple';

interface ImageSpec { sourceUrl: string; formats: string[] }
interface ImageStatus { phase?: 'Processing'; outputUrls?: string[] }

const objectSchema = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'KubernetesObjectShape' },
  schema: { type: 'object', additionalProperties: true },
};
const imageSpec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl', 'formats'],
    additionalProperties: false,
    properties: {
      sourceUrl: { type: 'string' },
      formats: { type: 'array', items: { type: 'string' } },
    },
  },
};
const imageStatus = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'ImageJob', spec: imageSpec, status: imageStatus });
const Deployment = typeKro.resource((input: { name: string; namespace: string }) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: input.name, namespace: input.namespace },
  spec: {},
}), {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  plural: 'deployments',
  spec: objectSchema,
  status: objectSchema,
});

export const imagePipeline = sdk.operator({
  name: ${JSON.stringify(operatorName)},
  deployment: { namespace: ${JSON.stringify(targetNamespace)}, replicas: 1 },
  resources: { ImageJob },
  permissions: [
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch'] },
    sdk.permissions.events.write(),
  ],
  handlers: [],
});

export const mediaStack = typeKro.kubernetesComposition({
  name: ${JSON.stringify(stackName)},
  apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)},
  kind: ${JSON.stringify(stackKind)},
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, () => {
  const pipeline = imagePipeline({ namespace: ${JSON.stringify(targetNamespace)}, replicas: 1 });
  const image = pipeline.imageJob({
    name: ${JSON.stringify(imageJobName)},
    namespace: ${JSON.stringify(targetNamespace)},
    spec: { sourceUrl: ${JSON.stringify(`s3://images/${imageJobName}.png`)}, formats: ['webp'] },
  });
  image.on.reconcile((job) => {
    job.status.phase = 'Processing';
    job.status.outputUrls = [job.spec.sourceUrl + '.webp'];
  });

  const watched = Deployment({ name: ${JSON.stringify(watchedDeploymentName)}, namespace: ${JSON.stringify(targetNamespace)} });
  watched.on.updated(imagePipeline, (deployment) => {
    deployment.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'listener-' + deployment.metadata.name, namespace: deployment.metadata.namespace },
      data: { observed: deployment.metadata.name },
    });
    deployment.events.normal('TypeKroDeploymentObserved', 'TypeKro listener observed Deployment update.');
  });

  ConfigMap({
    name: ${JSON.stringify(statusConsumerName)},
    namespace: ${JSON.stringify(targetNamespace)},
    data: { phase: cel\`\${image.status.phase}\` },
  });
  return { ready: image.status.phase === 'Processing' };
});
`;
}
