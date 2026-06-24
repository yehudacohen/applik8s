import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCompilerPipeline } from '@applik8s/compiler';
import type { OperatorDefinition, OperatorManifest } from '@applik8s/core';
import { asComposition } from '@applik8s/typekro-adapter';
import { imageRef } from '@applik8s/typetainer';
import { typeKroRuntimeBootstrap } from 'typekro';

const execFileAsync = promisify(execFile);
const expectedContext = process.env.APPLIK8S_E2E_CONTEXT;
const directNamespace = process.env.APPLIK8S_E2E_TYPEKRO_DIRECT_NAMESPACE ?? `applik8s-typekro-direct-${process.pid}`;
const kroNamespace = process.env.APPLIK8S_E2E_TYPEKRO_KRO_NAMESPACE ?? `applik8s-typekro-kro-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const apiGroup = process.env.APPLIK8S_E2E_TYPEKRO_API_GROUP ?? `media-${process.pid}.applik8s.dev`;

let tempDir: string | undefined;
let operator: OperatorDefinition | undefined;
let manifest: OperatorManifest | undefined;

describe('TypeKro deployment acceptance', () => {
  beforeAll(async () => {
    if (process.env.APPLIK8S_E2E !== '1' || process.env.APPLIK8S_E2E_TYPEKRO !== '1') {
      throw new Error('Set APPLIK8S_E2E=1 APPLIK8S_E2E_TYPEKRO=1 to run TypeKro deployment acceptance tests.');
    }

    const context = await kubectl(['config', 'current-context']);
    if (expectedContext && context.stdout.trim() !== expectedContext) {
      throw new Error(`Expected kubectl context ${expectedContext}, got ${context.stdout.trim()}.`);
    }

    await kubectl(['create', 'namespace', directNamespace]);
    await kubectl(['create', 'namespace', kroNamespace]);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-e2e-typekro-'));
    const entrypoint = join(tempDir, 'image-pipeline.ts');
    await writeFile(entrypoint, imagePipelineSource(apiGroup));

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

    manifest = compiled.value.manifest;
    operator = await importOperatorDefinition(entrypoint);
    await buildOperatorImages(compiled.value.manifest);
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E === '1' && process.env.APPLIK8S_E2E_TYPEKRO === '1') {
      await kubectl(['delete', 'namespace', directNamespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'namespace', kroNamespace, '--ignore-not-found=true', '--wait=false']);
      await kubectlMaybe(['delete', 'resourcegraphdefinition', `image-pipeline-kro-${process.pid}`, '--ignore-not-found=true', '--wait=false']);
      await kubectlMaybe(['delete', 'crd', `imagejobs.${apiGroup}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('deploys the adapted operator through TypeKro direct mode and waits for readiness', async () => {
    const composition = adaptedComposition('direct');
    const factory = composition.factory('direct', { namespace: directNamespace, waitForReady: true, timeout: 240_000 });

    await factory.deploy({ namespace: directNamespace, replicas: 1 });

    await assertOperatorReady(directNamespace);
    await assertImageJobReconciled(directNamespace, 'direct-hero-image');
    expect(factory.mode).toBe('direct');
  }, 300_000);

  it('deploys the adapted operator through TypeKro kro mode and waits for readiness', async () => {
    await ensureKroRuntime();
    const composition = adaptedComposition('kro');
    const factory = composition.factory('kro', { namespace: kroNamespace, waitForReady: true, timeout: 300_000 });

    await factory.deploy({ namespace: kroNamespace, replicas: 1 });

    await assertOperatorReady(kroNamespace);
    await assertImageJobReconciled(kroNamespace, 'kro-hero-image');
    expect(factory.mode).toBe('kro');
  }, 420_000);
});

function adaptedComposition(mode: 'direct' | 'kro') {
  if (!operator || !manifest) {
    throw new Error('TypeKro e2e fixture was not initialized.');
  }
  const result = asComposition(operator, manifest, {
    compositionName: `image-pipeline-${mode}-${process.pid}`,
    defaultNamespace: mode === 'direct' ? directNamespace : kroNamespace,
    factoryOptions: { namespace: mode === 'direct' ? directNamespace : kroNamespace, waitForReady: true },
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

async function buildOperatorImages(bundle: OperatorManifest): Promise<void> {
  const recipe = bundle.spec.container;
  if (!recipe?.build?.context || !recipe.build.dockerfile) {
    throw new Error('Compiled operator bundle is missing a runtime image build recipe.');
  }
  const runtimeImage = imageRef(recipe.image);
  const runtimeImageName = runtimeImage.registry ? `${runtimeImage.registry}/${runtimeImage.repository}` : runtimeImage.repository;

  await buildWithTypeKroContainerUtility({
    context: process.cwd(),
    dockerfile: 'Dockerfile.operator-host',
    imageName: 'ghcr.io/applik8s/applik8s-operator-host',
    tag: 'dev',
    quiet: true,
    timeout: 600_000,
    registry: { type: 'orbstack' },
  });
  await buildWithTypeKroContainerUtility({
    context: recipe.build.context,
    dockerfile: recipe.build.dockerfile,
    imageName: runtimeImageName,
    tag: runtimeImage.tag ?? 'latest',
    quiet: true,
    timeout: 300_000,
    registry: { type: 'orbstack' },
  });
}

async function buildWithTypeKroContainerUtility(options: Record<string, unknown>): Promise<void> {
  const buildModule = pathToFileURL(join(process.cwd(), 'node_modules/.bun/typekro@file+..+typekro+e8493996db3ef19f/node_modules/typekro/src/core/containers/index.ts')).href;
  const script = `const options = JSON.parse(process.env.TYPEKRO_BUILD_OPTIONS ?? '{}'); const { buildContainer } = await import(${JSON.stringify(buildModule)}); await buildContainer(options);`;
  await execFileAsync('bun', ['--eval', script], {
    env: { ...process.env, TYPEKRO_BUILD_OPTIONS: JSON.stringify(options) },
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function ensureKroRuntime(): Promise<void> {
  const exists = await kubectlMaybe(['get', 'crd/resourcegraphdefinitions.kro.run']);
  if (exists.ok) {
    return;
  }

  await kubectlMaybe(['create', 'namespace', runtimeNamespace]);
  const bootstrap = typeKroRuntimeBootstrap({ namespace: runtimeNamespace, kroVersion: '0.9.0' });
  const factory = bootstrap.factory('direct', { namespace: runtimeNamespace, waitForReady: true, timeout: 300_000 });
  await factory.deploy({ namespace: runtimeNamespace });
  await kubectl(['wait', 'crd/resourcegraphdefinitions.kro.run', '--for=condition=Established', '--timeout=180s']);
}

async function assertOperatorReady(namespace: string): Promise<void> {
  await kubectl(['wait', 'deployment/image-pipeline', '--namespace', namespace, '--for=condition=Available', '--timeout=180s']);
  expect((await kubectl(['get', 'deployment/image-pipeline', '--namespace', namespace, '--output=jsonpath={.status.availableReplicas}'])).stdout.trim()).toBe('1');
  expect((await kubectl(['get', 'pods', '--namespace', namespace, '--selector=app.kubernetes.io/name=image-pipeline', '--output=jsonpath={.items[0].status.containerStatuses[0].ready}'])).stdout.trim()).toBe('true');
}

async function assertImageJobReconciled(namespace: string, name: string): Promise<void> {
  if (!tempDir) {
    throw new Error('TypeKro e2e temp directory was not initialized.');
  }
  const samplePath = join(tempDir, `${name}.yaml`);
  const sourceUrl = `s3://bucket/${name}.png`;
  await writeFile(samplePath, `apiVersion: ${apiGroup}/v1alpha1
kind: ImageJob
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  sourceUrl: ${sourceUrl}
  formats:
    - webp
  priority: normal
`);

  await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-e2e', '--filename', samplePath]);
  await waitForImageJobStatusWithDiagnostics(namespace, name);
  expect((await kubectl(['get', `imagejobs.${apiGroup}/${name}`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('Processing');
  expect((await kubectl(['get', `imagejobs.${apiGroup}/${name}`, '--namespace', namespace, '--output=jsonpath={.status.outputUrls[0]}'])).stdout.trim()).toBe(`${sourceUrl}.webp`);
}

async function waitForImageJobStatusWithDiagnostics(namespace: string, name: string): Promise<void> {
  try {
    await kubectl(['wait', `imagejobs.${apiGroup}/${name}`, '--namespace', namespace, '--for=jsonpath={.status.phase}=Processing', '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `imagejobs.${apiGroup}/${name}`, '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=image-pipeline', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'ImageJob status wait failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

function formatSettledOutput(result: PromiseSettledResult<{ readonly stdout: string; readonly stderr: string }>): string {
  if (result.status === 'fulfilled') {
    return `${result.value.stdout}\n${result.value.stderr}`.trim();
  }
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

async function importOperatorDefinition(entrypoint: string): Promise<OperatorDefinition> {
  // static-import-exception: the e2e writes a temporary operator entrypoint, then imports that generated module to reuse the exact SDK operator definition.
  const module = await import(pathToFileURL(entrypoint).href);
  const pipeline = Reflect.get(module, 'imagePipeline');
  const definition = pipeline && (typeof pipeline === 'object' || typeof pipeline === 'function') ? Reflect.get(pipeline, 'definition') : undefined;
  if (!definition || typeof definition !== 'object') {
    throw new Error('Generated e2e operator source did not export imagePipeline.definition.');
  }
  // typecast: dynamic e2e source exports an SDK operator; runtime shape is checked above before erasing to OperatorDefinition.
  return definition as OperatorDefinition;
}

async function kubectl(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await kubectlMaybe(args);
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

async function kubectlMaybe(args: readonly string[]): Promise<{ readonly ok: true; readonly value: { readonly stdout: string; readonly stderr: string } } | { readonly ok: false; readonly error: Error }> {
  try {
    return { ok: true, value: await execFileAsync('kubectl', args, { env: process.env, maxBuffer: 10 * 1024 * 1024 }) };
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: new Error(`kubectl ${args.join(' ')} failed: ${error.message}`) };
    }
    return { ok: false, error: new Error(`kubectl ${args.join(' ')} failed.`) };
  }
}

function imagePipelineSource(group: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string; formats: string[]; priority: 'low' | 'normal' | 'high' }
interface ImageStatus { phase?: 'Processing'; outputUrls?: string[] }

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
  schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: ${JSON.stringify(`${group}/v1alpha1`)}, kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  resources: { ImageJob },
  handlers: [ImageJob.on.reconcile((job) => { job.status.phase = 'Processing'; job.status.outputUrls = [job.spec.sourceUrl + '.webp']; })],
});
`;
}
