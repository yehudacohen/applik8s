import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';
import { type as arkType } from 'arktype';
import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ConfigMap } from '../../applik8s/src/factories/simple.js';
import { cel, sdk, typeKro } from '../../applik8s/src/index.js';

import { assertExpectedKubectlContext, describeLive, docker, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-typekro-status-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const group = `status${process.pid}.applik8s.dev`;
const operatorName = 'status-image-pipeline';
const imageJobName = 'status-hero';
const statusConsumerName = 'status-consumer';
const statusStackName = `status-media-stack-${process.pid}`;
const statusStackKind = `StatusMediaStack${process.pid}`;
const statusStackPlural = `statusmediastack${process.pid}s`;

interface ImageSpec { readonly sourceUrl: string; readonly formats: readonly string[] }
interface ImageStatus { readonly phase: 'Processing'; readonly outputUrls?: readonly string[] }

let tempDir: string | undefined;

describeLive('live TypeKro status composition', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-status-'));
    const entrypoint = join(tempDir, 'media-stack.ts');
    await writeFile(entrypoint, mediaStackSource(group, namespace));

    const compiled = await createCompilerPipeline().run({
      entrypoint,
      operatorName,
      outDir: join(tempDir, 'dist/operator'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      dispatcherMode: 'staticSerializable',
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
    const mediaStack = statusComposition(group, namespace);
    const resolved = mediaStack.resolveOperatorInstalls({
      manifests: [compiled.value],
      defaultNamespace: namespace,
      factoryOptions: { namespace, waitForReady: true, timeout: 300_000 },
    });
    if (!resolved.ok) {
      throw new Error(resolved.error.message);
    }
    const factory = resolved.value.factory('kro', { namespace, waitForReady: true, timeout: 300_000 });
    try {
      await factory.deploy({});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Unrecognized API version and kind') || !message.includes(statusStackKind)) {
        throw error;
      }
      await deployStatusStackInstance();
    }
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'resourcegraphdefinition', statusStackName, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `imagejobs.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('drives a downstream TypeKro resource from runtime-authored generated CRD status', async () => {
    await waitForDeploymentCreated();
    await rolloutStatusWithDiagnostics();
    await waitForImageJobPhase('Processing');
    await waitForStatusConsumerPhase('Processing');

    expect((await kubectl(['get', `configmap/${statusConsumerName}`, '--namespace', namespace, '--output=jsonpath={.data.phase}'])).stdout.trim()).toBe('Processing');
  }, 300_000);
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
    kubectl(['get', statusStackKind, statusStackName, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'resourcegraphdefinition', statusStackName, '--output=yaml']),
    kubectl(['get', 'all', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected KRO to create Deployment ${operatorName}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${operatorName}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${operatorName}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
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
    kubectl(['get', 'resourcegraphdefinitions.kro.run', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ConfigMap ${statusConsumerName} phase ${phase}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

function statusComposition(apiGroup: string, targetNamespace: string) {
  const spec = {
    kind: 'jsonSchema' as const, // typecast: schema source discriminants must remain literal so sdk.crd selects the JSON Schema adapter shape.
    ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' }, // typecast: schema source discriminants must remain literal so sdk.crd selects the JSON Schema adapter shape.
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
  const status = {
    kind: 'jsonSchema' as const, // typecast: schema source discriminants must remain literal so sdk.crd selects the JSON Schema adapter shape.
    ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' }, // typecast: schema source discriminants must remain literal so sdk.crd selects the JSON Schema adapter shape.
    schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } },
  };
  const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: `${apiGroup}/v1alpha1`, kind: 'ImageJob', spec, status });
  const imagePipeline = sdk.operator({
    name: operatorName,
    deployment: { namespace: targetNamespace, replicas: 1 },
    resources: { ImageJob },
    handlers: [],
  });

  return typeKro.kubernetesComposition({
    name: statusStackName,
    apiVersion: `${apiGroup}/v1alpha1`,
    kind: statusStackKind,
    spec: arkType({}),
    status: arkType({ ready: 'boolean' }),
  }, () => {
    const pipeline = imagePipeline({ namespace: targetNamespace, replicas: 1 });
    const image = pipeline.imageJob({
      name: imageJobName,
      namespace: targetNamespace,
      spec: { sourceUrl: `s3://images/${imageJobName}.png`, formats: ['webp'] },
    });
    image.on.reconcile((job) => {
      job.status.phase = 'Processing';
      job.status.outputUrls = [`${job.spec.sourceUrl}.webp`];
    });
    const imageStatus = image.status;
    if (!imageStatus) {
      throw new Error('Generated ImageJob status projection is missing from the TypeKro resource.');
    }
    ConfigMap({
      name: statusConsumerName,
      namespace: targetNamespace,
      data: { phase: cel`${imageStatus.phase}` },
    });
    return { ready: imageStatus.phase === 'Processing' };
  });
}

async function deployStatusStackInstance(): Promise<void> {
  if (!tempDir) {
    throw new Error('TypeKro status e2e temp directory was not initialized.');
  }
  await kubectl(['wait', `crd/${statusStackPlural}.kro.run`, '--for=condition=Established', '--timeout=60s']);
  const path = join(tempDir, 'status-stack-instance.yaml');
  await writeFile(path, `apiVersion: kro.run/v1alpha1
kind: ${statusStackKind}
metadata:
  name: ${statusStackName}
  namespace: ${namespace}
spec: {}
`);
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-status-e2e', '--filename', path]);
}

function mediaStackSource(apiGroup: string, targetNamespace: string): string {
  return `import { type } from 'arktype';
import { cel, sdk, typeKro } from '@applik8s/applik8s';
import { ConfigMap } from '@applik8s/applik8s/factories/simple';

interface ImageSpec { sourceUrl: string; formats: string[] }
interface ImageStatus { phase?: 'Processing'; outputUrls?: string[] }

const spec = {
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
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: ${JSON.stringify(operatorName)},
  deployment: { namespace: ${JSON.stringify(targetNamespace)}, replicas: 1 },
  resources: { ImageJob },
  handlers: [],
});

export const mediaStack = typeKro.kubernetesComposition({
  name: ${JSON.stringify(statusStackName)},
  apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)},
    kind: ${JSON.stringify(statusStackKind)},
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
  ConfigMap({
    name: ${JSON.stringify(statusConsumerName)},
    namespace: ${JSON.stringify(targetNamespace)},
    data: { phase: cel\`\${image.status.phase}\` },
  });
  return { ready: image.status.phase === 'Processing' };
});
`;
}
