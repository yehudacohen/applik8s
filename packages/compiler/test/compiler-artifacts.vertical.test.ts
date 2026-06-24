import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { CapabilityDescriptor, JsonSchemaSource, RuntimeConfig } from '@applik8s/core';
import { sdk } from '@applik8s/sdk';
import {
  buildOperatorManifest,
  bundleHandlerEntrypoint,
  createCompilerPipeline,
  emitHandlerWitArtifact,
  emitOperatorKubernetesYaml,
  emitRuntimeContractArtifact,
  emitWasmComponentArtifact,
  validateOperatorManifest,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

interface ImageSpec {
  readonly sourceUrl: string;
}

interface ImageStatus {
  readonly phase?: 'Pending' | 'Processing';
}

const imageSpecSchema: JsonSchemaSource<ImageSpec> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl'],
    additionalProperties: false,
    properties: { sourceUrl: { type: 'string' } },
  },
};

const imageStatusSchema: JsonSchemaSource<ImageStatus> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
  schema: {
    type: 'object',
    properties: { phase: { type: 'string' } },
  },
};

const unsupportedLeaderElectionRuntime: RuntimeConfig = {
  leaderElection: {
    enabled: true,
    leaseName: 'image-pipeline',
    leaseDurationSeconds: 15,
    renewDeadlineSeconds: 10,
    retryPeriodSeconds: 2,
  },
  concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
  rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
  health: { enabled: true, path: '/healthz', port: 8080 },
  metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
};

describe('compiler artifact vertical slice', () => {
  it('rejects unsupported compile options instead of silently ignoring them', () => {
    const pipeline = createCompilerPipeline();
    const request = {
      entrypoint: 'operator-entry.ts',
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
    } satisfies Parameters<ReturnType<typeof createCompilerPipeline>['plan']>[0];

    expect(pipeline.plan({ ...request, packageName: '@acme/image-pipeline' }).ok).toBe(false);
    // typecast: this regression intentionally passes an unsupported ABI value that the public compile type prevents.
    expect(pipeline.plan({ ...request, handlerAbiVersion: 'applik8s.handler/v1beta1' as never }).ok).toBe(false);
    expect(pipeline.plan({ ...request, adapterRequirements: { kind: 'wasmComponent', hostImports: [] } }).ok).toBe(false);
    expect(pipeline.plan({ ...request, portability: { ...request.portability, allowedHostImports: ['custom:host/import'] } }).ok).toBe(false);
  });

  it('fails closed for multi-replica deployments without leader election', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'unsafe-ha-pipeline',
      deployment: { namespace: 'media', replicas: 2 },
      resources: { ImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('deployment.replicas greater than 1');
    }
  });

  it('allows leader-elected multi-replica deployments and emits Lease RBAC', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'unsupported-leader-election-pipeline',
      deployment: { namespace: 'media', replicas: 2 },
      runtime: unsupportedLeaderElectionRuntime,
      resources: { ImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.permissions).toContainEqual({
        apiGroups: ['coordination.k8s.io'],
        resources: ['leases'],
        verbs: ['get', 'update', 'patch'],
        resourceNames: ['image-pipeline'],
      });
      expect(manifest.value.spec.permissions).toContainEqual({
        apiGroups: ['coordination.k8s.io'],
        resources: ['leases'],
        verbs: ['create'],
      });
    }
  });

  it('fails closed when replay artifacts are enabled without an explicit directory', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'invalid-replay-pipeline',
      deployment: { namespace: 'media', replicas: 1 },
      runtime: {
        ...unsupportedLeaderElectionRuntime,
        leaderElection: { ...unsupportedLeaderElectionRuntime.leaderElection, enabled: false },
        replayArtifacts: { enabled: true },
      },
      resources: { ImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('runtime.replayArtifacts.directory');
    }
  });

  it('fails closed when runtime concurrency settings exceed the implemented single-worker contract', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'unsupported-concurrency-pipeline',
      deployment: { namespace: 'media', replicas: 1 },
      runtime: {
        ...unsupportedLeaderElectionRuntime,
        leaderElection: { ...unsupportedLeaderElectionRuntime.leaderElection, enabled: false },
        concurrency: { workerCount: 2, maxInFlightPerResource: 1 },
      },
      resources: { ImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('runtime.concurrency.workerCount');
    }
  });

  it('fails closed for multi-version CRDs until conversion and migration compatibility are implemented', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const version = ImageJob.versions[0];
    if (!version) {
      throw new Error('Expected ImageJob to have a storage version.');
    }
    const MultiVersionImageJob = Object.assign((input: Parameters<typeof ImageJob>[0]) => ImageJob(input), ImageJob, {
      versions: [version, { ...version, name: 'v1beta1', served: true, storage: false }],
    });
    const operator = sdk.operator({
      name: 'multi-version-crd-pipeline',
      resources: { ImageJob: MultiVersionImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('exactly one CRD version');
    }
  });

  it('fails closed for conversion webhooks until CRD conversion support exists', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const version = ImageJob.versions[0];
    if (!version) {
      throw new Error('Expected ImageJob to have a storage version.');
    }
    const WebhookImageJob = Object.assign((input: Parameters<typeof ImageJob>[0]) => ImageJob(input), ImageJob, {
      versions: [
        {
          ...version,
          compatibility: {
            // typecast: negative fixture deliberately narrows the unsupported conversion strategy to prove fail-closed validation.
            conversionStrategy: 'webhook' as const,
            conversionWebhook: { serviceName: 'image-converter', serviceNamespace: 'media', path: '/convert' },
          },
        },
      ],
    });
    const operator = sdk.operator({
      name: 'conversion-webhook-crd-pipeline',
      resources: { ImageJob: WebhookImageJob },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('conversion webhook semantics');
    }
  });

  it('emits declared finalize handler ownership metadata into the manifest', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'finalizer-aware-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => { job.finalizers.add('media.applik8s.dev/imagejob'); }),
        ImageJob.on.finalize((job) => { job.finalizers.remove('media.applik8s.dev/imagejob'); }, { finalizer: 'media.applik8s.dev/imagejob' }),
      ],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.handlerExports.find((handler) => handler.event === 'finalize')).toMatchObject({
        handlerId: 'ImageJob.finalize.1',
        finalizers: ['media.applik8s.dev/imagejob'],
      });
    }
  });

  it('emits statusChanged handlers into manifest exports and watches', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'status-aware-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      handlers: [ImageJob.on.statusChanged((job) => { job.status.phase = 'Processing'; })],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.handlerExports).toContainEqual(expect.objectContaining({
        handlerId: 'ImageJob.statusChanged.0',
        event: 'statusChanged',
      }));
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        events: ['statusChanged'],
        handlers: ['ImageJob.statusChanged.0'],
      }));
    }
  });

  it('synthesizes a standalone bundle into the default output directory when outDir is omitted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-default-outdir-'));
    const previousCwd = process.cwd();

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(previousCwd, 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string }
interface ImageStatus { phase?: 'Processing' }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: { type: 'object', required: ['sourceUrl'], additionalProperties: false, properties: { sourceUrl: { type: 'string' } } },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: 'media', replicas: 1 },
  resources: { ImageJob },
  handlers: [ImageJob.on.reconcile((job) => { job.status.phase = 'Processing'; })],
});
`
      );

      process.chdir(dir);
      const result = await createCompilerPipeline().run({
        entrypoint,
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

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const defaultOutDir = join(await realpath(dir), 'dist/applik8s');
      expect(result.value.artifacts.manifestJsonPath).toBe(join(defaultOutDir, 'operator-manifest.json'));
      expect(result.value.artifacts.generatedImageDockerfilePath).toBe(join(defaultOutDir, 'Dockerfile.applik8s-runtime'));
      expect(result.value.artifacts.generatedApplyScriptPath).toBe(join(defaultOutDir, 'apply.sh'));

      const applyScriptPath = result.value.artifacts.generatedApplyScriptPath ?? '';
      const applyScript = await readFile(applyScriptPath, 'utf8');
      expect(applyScript).toContain('APPLIK8S_BUILD_BASE');
      expect(applyScript).toContain('Dockerfile.applik8s-runtime');
      expect(applyScript).toContain('kubernetes/*.yaml');
      expect((await stat(applyScriptPath)).mode & 0o111).toBeGreaterThan(0);
      await execFileAsync('sh', ['-n', applyScriptPath]);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('throws handler failures from the generated WIT dispatcher', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-dispatcher-errors-'));

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string }
interface ImageStatus { phase?: 'Processing' }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: { type: 'object', required: ['sourceUrl'], additionalProperties: false, properties: { sourceUrl: { type: 'string' } } },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: 'media' },
  resources: { ImageJob },
  handlers: [ImageJob.on.reconcile(() => { throw new Error('synthetic handler failure'); })],
});
`
      );

      const result = await createCompilerPipeline().run({
        entrypoint,
        outDir: join(dir, 'dist'),
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

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const dispatcherPath = join(dir, 'dist/bundle/handler-dispatcher.generated.ts');
      // static-import-exception: this test loads a compiler-generated dispatcher from a temporary output directory.
      const dispatcher = await import(`${pathToFileURL(dispatcherPath).href}?case=handler-error`);
      expect(() => dispatcher.handle(JSON.stringify({
        abiVersion: 'applik8s.handler/v1alpha1',
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: { name: 'hero-image', namespace: 'media' },
          spec: { sourceUrl: 's3://bucket/hero.png' },
        },
        runtime: { reconcileId: 'ImageJob-hero-image' },
      }))).toThrow(/synthetic handler failure/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles an exported operator through the integrated pipeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-integrated-compiler-'));

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string }
interface ImageStatus { phase?: 'Processing' }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: { type: 'object', required: ['sourceUrl'], additionalProperties: false, properties: { sourceUrl: { type: 'string' } } },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: 'media' },
  runtime: {
    leaderElection: { enabled: false, leaseName: 'image-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
    concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
    rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
    health: { enabled: true, path: '/healthz', port: 8080 },
    metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
    handlerTimeoutSeconds: 30,
    replayArtifacts: { enabled: true, directory: '/tmp/applik8s-replay', includePayloads: true },
  },
  resources: { ImageJob },
  handlers: [ImageJob.on.reconcile((job) => { job.status.phase = 'Processing'; })],
});

`
      );

      const result = await createCompilerPipeline().run({
        entrypoint,
        outDir: join(dir, 'dist'),
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

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.value.manifest.metadata.name).toBe('image-pipeline');
      expect(result.value.manifest.spec.container?.image).toMatchObject({ repository: 'applik8s/image-pipeline-operator' });
      expect(result.value.manifest.spec.container?.baseImage).toMatchObject({ registry: 'ghcr.io', repository: 'applik8s/applik8s-operator-host', tag: 'dev' });
      expect(result.value.manifest.spec.container?.files).toEqual([
        { source: 'operator-manifest.json', destination: '/etc/applik8s/operator-manifest.json' },
        { source: 'wasm/handler.wasm', destination: '/handler/handler.wasm' },
        { source: 'bundle/handler.js', destination: '/handler/handler.js' },
        { source: 'bundle/handler.js.map', destination: '/handler/handler.js.map' },
      ]);
      expect(result.value.artifacts.handlerWasmPath).toContain('handler.wasm');
      expect(result.value.artifacts.sourceMapPath).toContain('handler.js.map');
      const sourceMap = JSON.parse(await readFile(result.value.artifacts.sourceMapPath ?? '', 'utf8'));
      expect(Reflect.get(sourceMap, 'sourcesContent')).toBeUndefined();
      expect(result.value.artifacts.generatedDeploymentYamlPath).toContain('deployment-image-pipeline.yaml');
      expect(result.value.artifacts.generatedImageDockerfilePath).toContain('Dockerfile.applik8s-runtime');
      expect(result.value.artifacts.generatedApplyScriptPath).toContain('apply.sh');
      expect(result.value.closureGraph.handlers[0]?.handlerId).toBe('ImageJob.reconcile.0');
      expect(result.value.manifest.spec.security.portability).toMatchObject({
        enforcement: 'failClosed',
        deterministicBuild: true,
        environmentAccess: 'denied',
        filesystemAccess: 'denied',
        networkAccess: 'denied',
        dynamicImport: 'denied',
        localCredentialPaths: 'denied',
        embeddedSecretMaterial: 'denied',
        unsupportedNativeModules: 'denied',
        sourceMaps: { emitted: true, sourceContent: 'excluded', paths: 'preservedByPolicy' },
      });
      expect(result.value.manifest.spec.bundle.supplyChain.posture).toEqual({
        signing: 'unsigned',
        sbom: 'notGenerated',
        provenance: 'notGenerated',
        admission: 'metadataOnly',
      });
      expect(result.value.manifest.spec.ownedCrds[0]).toMatchObject({
        kind: 'ImageJob',
        storageVersion: 'v1alpha1',
        conversionStrategy: 'none',
        statusSubresource: true,
        versioning: {
          multiVersion: 'singleVersion',
          conversionWebhook: 'notConfigured',
          storageMigration: 'notRequired',
          rollbackSafety: 'schemaCompatibleOnly',
        },
      });
      const deployment = parse(await readFile(result.value.artifacts.generatedDeploymentYamlPath, 'utf8'));
      const container = deployment.spec.template.spec.containers[0];
      expect(deployment.metadata.annotations).toMatchObject({
        'applik8s.dev/bundle-digest': result.value.manifest.spec.bundle.digest,
        'applik8s.dev/source-digest': result.value.manifest.spec.bundle.sourceDigest,
        'applik8s.dev/compiler-version': result.value.manifest.spec.bundle.compilerVersion,
        'applik8s.dev/handler-abi': 'applik8s.handler/v1alpha1',
        'applik8s.dev/requires-runtime': '^0.1.0',
        'applik8s.dev/crd-storage-versions': 'media.applik8s.dev/v1alpha1/ImageJob=v1alpha1',
        'applik8s.dev/crd-conversion-strategies': 'media.applik8s.dev/v1alpha1/ImageJob=none',
        'applik8s.dev/crd-multi-version': 'singleVersion',
        'applik8s.dev/crd-storage-migration': 'notRequired',
        'applik8s.dev/rollback-safety': 'schemaCompatibleOnly',
        'applik8s.dev/uninstall-controller-domain-data': 'preserve',
        'applik8s.dev/delete-domain-data-confirmation': 'required',
        'applik8s.dev/supply-chain-signing': 'unsigned',
        'applik8s.dev/supply-chain-sbom': 'notGenerated',
        'applik8s.dev/supply-chain-provenance': 'notGenerated',
        'applik8s.dev/admission-verification': 'metadataOnly',
        'applik8s.dev/security-enforcement': 'failClosed',
        'applik8s.dev/rbac-mode': result.value.manifest.spec.security.rbac.mode,
        'applik8s.dev/rbac-least-privilege-reviewed': String(result.value.manifest.spec.security.rbac.leastPrivilegeReviewed),
        'applik8s.dev/rbac-rule-count': String(result.value.manifest.spec.security.rbac.rules.length),
        'applik8s.dev/host-imports': 'capability-request,log,cancel',
        'applik8s.dev/ambient-environment': 'denied',
        'applik8s.dev/ambient-filesystem': 'denied',
        'applik8s.dev/ambient-network': 'denied',
        'applik8s.dev/embedded-secret-material': 'denied',
        'applik8s.dev/local-credential-paths': 'denied',
        'applik8s.dev/unsupported-native-modules': 'denied',
      });
      expect(deployment.spec.template.metadata.annotations).toMatchObject({
        'applik8s.dev/bundle-digest': result.value.manifest.spec.bundle.digest,
        'applik8s.dev/handler-abi': 'applik8s.handler/v1alpha1',
      });
      expect(container.image).toMatch(/^applik8s\/image-pipeline-operator:[a-f0-9]{12}$/);
      expect(container.ports).toContainEqual({ name: 'health', containerPort: 8080 });
      expect(container.env).toContainEqual({ name: 'APPLIK8S_HEALTH_ADDR', value: '0.0.0.0:8080' });
      expect(container.env).toContainEqual({ name: 'APPLIK8S_HANDLER_TIMEOUT_SECONDS', value: '30' });
      expect(container.env).toContainEqual({ name: 'APPLIK8S_REPLAY_ARTIFACT_DIR', value: '/tmp/applik8s-replay' });
      expect(container.env).toContainEqual({ name: 'APPLIK8S_REPLAY_INCLUDE_PAYLOADS', value: '1' });
      expect(container.env).toContainEqual({ name: 'OTEL_SERVICE_NAME', value: 'image-pipeline' });
      expect(container.env).toContainEqual({ name: 'OTEL_METRIC_EXPORT_INTERVAL', value: '30000' });
      expect(container.env).toContainEqual({
        name: 'OTEL_RESOURCE_ATTRIBUTES',
        value: `service.namespace=applik8s,applik8s.operator=image-pipeline,applik8s.bundle_digest=${result.value.manifest.spec.bundle.digest}`,
      });
      expect(container.livenessProbe.httpGet).toEqual({ path: '/healthz', port: 'health' });
      expect(container.readinessProbe.httpGet).toEqual({ path: '/readyz', port: 'health' });
      expect(result.value.manifest.spec.bundle.artifacts).toContainEqual(expect.objectContaining({ kind: 'javascript-source-map', path: result.value.artifacts.sourceMapPath }));
      expect(result.value.manifest.spec.bundle.artifacts).toContainEqual(expect.objectContaining({ kind: 'esbuild-metafile' }));
      const dockerfile = await readFile(result.value.artifacts.generatedImageDockerfilePath ?? '', 'utf8');
      expect(dockerfile).toContain('FROM ghcr.io/applik8s/applik8s-operator-host:dev');
      expect(dockerfile).toContain('COPY operator-manifest.json /etc/applik8s/operator-manifest.json');
      expect(dockerfile).toContain('COPY wasm/handler.wasm /handler/handler.wasm');
      expect(dockerfile).toContain('COPY bundle/handler.js /handler/handler.js');
      expect(dockerfile).toContain('COPY bundle/handler.js.map /handler/handler.js.map');
      const applyScript = await readFile(result.value.artifacts.generatedApplyScriptPath ?? '', 'utf8');
      expect(applyScript).toContain('docker}');
      expect(applyScript).toContain('kubectl}');
      expect(applyScript).toContain('Dockerfile.applik8s-runtime');
      expect(applyScript).toContain('kubernetes/*.yaml');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles capability-using bundles now that the Rust capability host protocol exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-capability-compile-'));

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const schema = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'Spec' },
  schema: { type: 'object', properties: {} },
};
const Thing = sdk.crd({ apiVersion: 'example.applik8s.dev/v1alpha1', kind: 'Thing', spec: schema });
export const capabilityOperator = sdk.operator({
  name: 'capability-operator',
  resources: { Thing },
  capabilities: { processor: sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' }) },
  handlers: [],
});
`
      );

      const result = await createCompilerPipeline().run({
        entrypoint,
        outDir: join(dir, 'dist'),
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts.handlerWasmPath).toContain('handler.wasm');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits fail-closed capability execution posture into manifests and Kubernetes annotations', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'capability-posture-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      capabilities: {
        processor: sdk.external.http({ baseUrl: 'https://processor.example.test', auth: sdk.secretRef('processor-token', 'token', 'media'), timeoutMs: 2000 }),
      },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (!manifest.ok) {
      return;
    }
    expect(manifest.value.spec.capabilities?.processor).toMatchObject({
      name: 'processor',
      kind: 'http',
      endpoint: 'https://processor.example.test',
      execution: {
        liveExecution: 'disabled',
        protocol: 'notImplemented',
        audit: { recordRequests: true, recordResponses: false, includePayloads: false },
        redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
        idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
      },
    });
    expect(manifest.value.spec.security.capabilities[0]).toMatchObject({
      name: 'processor',
      execution: { liveExecution: 'disabled', protocol: 'notImplemented' },
    });
    expect(manifest.value.spec.security.secrets.secretRefs).toEqual([{ name: 'processor-token', key: 'token', namespace: 'media' }]);

    const dir = await mkdtemp(join(tmpdir(), 'applik8s-capability-posture-yaml-'));
    try {
      const yaml = await emitOperatorKubernetesYaml({ manifest: manifest.value, operator: operator.definition, outDir: dir });
      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }
      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const deployment = documents.find((document) => document.kind === 'Deployment');
      expect(deployment?.metadata.annotations).toMatchObject({
        'applik8s.dev/capabilities': 'processor',
        'applik8s.dev/capability-kinds': 'http',
        'applik8s.dev/capability-protocols': 'notImplemented',
        'applik8s.dev/capability-live-execution': 'disabled',
        'applik8s.dev/capability-redaction': 'payloads-redacted',
        'applik8s.dev/capability-idempotency': 'requiredForMutations',
        'applik8s.dev/handler-timeout-seconds': '30',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows explicitly live auth-none HTTP capabilities through the host protocol', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const descriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const operator = sdk.operator({
      name: 'live-capability-pipeline',
      resources: { ImageJob },
      capabilities: {
        processor: {
          ...descriptor,
          execution: {
            liveExecution: 'hostProtocol',
            protocol: 'applik8s.capability/v1alpha1',
            audit: { recordRequests: true, recordResponses: true, includePayloads: false },
            redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
            idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
          },
        },
      },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      const processor = manifest.value.spec.capabilities?.processor;
      expect(processor).toBeTruthy();
      expect(processor?.execution).toMatchObject({
        liveExecution: 'hostProtocol',
        protocol: 'applik8s.capability/v1alpha1',
      });
      expect(manifest.value.spec.security.capabilities[0]?.execution).toMatchObject({
        liveExecution: 'hostProtocol',
        protocol: 'applik8s.capability/v1alpha1',
      });
    }
  });

  it('allows live HTTP capabilities with namespace-scoped secretRef auth and emits Secret RBAC', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const descriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: sdk.secretRef('processor-token', 'token') });
    const operator = sdk.operator({
      name: 'live-secret-capability-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      capabilities: {
        processor: {
          ...descriptor,
          execution: {
            liveExecution: 'hostProtocol',
            protocol: 'applik8s.capability/v1alpha1',
            audit: { recordRequests: true, recordResponses: true, includePayloads: false },
            redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
            idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
          },
        },
      },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.capabilities?.processor?.auth).toEqual({
        type: 'secretRef',
        secretRef: { name: 'processor-token', key: 'token' },
      });
      expect(manifest.value.spec.permissions).toContainEqual({
        apiGroups: [''],
        resources: ['secrets'],
        verbs: ['get'],
        resourceNames: ['processor-token'],
      });
      expect(manifest.value.spec.security.secrets.secretRefs).toEqual([{ name: 'processor-token', key: 'token' }]);
    }
  });

  it('rejects live secretRef HTTP capabilities without an explicit deployment namespace', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const descriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: sdk.secretRef('processor-token', 'token') });
    const operator = sdk.operator({
      name: 'unsafe-live-secret-capability-pipeline',
      resources: { ImageJob },
      capabilities: {
        processor: {
          ...descriptor,
          execution: {
            liveExecution: 'hostProtocol',
            protocol: 'applik8s.capability/v1alpha1',
            audit: { recordRequests: true, recordResponses: true, includePayloads: false },
            redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
            idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
          },
        },
      },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('deployment.namespace');
    }
  });

  it('rejects unsafe capability timeout and retry policy before manifest emission', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const timeoutDescriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none', timeoutMs: 0 });
    const retryDescriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const cases: readonly { readonly name: string; readonly descriptor: CapabilityDescriptor; readonly message: string }[] = [
      {
        name: 'timeout',
        descriptor: timeoutDescriptor,
        message: 'policy.timeoutMs must be an integer between 1 and 30000',
      },
      {
        name: 'retry',
        descriptor: {
          ...retryDescriptor,
          policy: {
            failureMode: 'rejectPromiseWithApplik8sError',
            retry: { maxAttempts: 6, backoffMs: 1, maxBackoffMs: 1 },
          },
        },
        message: 'policy.retry.maxAttempts must be an integer between 1 and 5',
      },
    ];

    for (const testCase of cases) {
      const operator = sdk.operator({
        name: `unsafe-capability-${testCase.name}-pipeline`,
        resources: { ImageJob },
        capabilities: { processor: testCase.descriptor },
        handlers: [],
      });

      const manifest = buildOperatorManifest({
        operator: operator.definition,
        handlerArtifactPath: 'wasm/handler.wasm',
        handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
        runtimeContractPath: 'runtime-contract.json',
        runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
      });

      expect(manifest.ok, testCase.name).toBe(false);
      if (!manifest.ok) {
        expect(manifest.error.message).toContain(testCase.message);
      }
    }
  });

  it('rejects unsupported capability auth descriptors before manifest emission', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const descriptor: CapabilityDescriptor = {
      ...sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' }),
      // typecast: negative fixture simulates untyped JavaScript or a casted descriptor outside the public CapabilityAuth union.
      auth: { type: 'apiKey', headerName: 'X-Api-Key' } as never,
    };
    const operator = sdk.operator({
      name: 'unsupported-auth-capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor: descriptor },
      handlers: [],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(false);
    if (!manifest.ok) {
      expect(manifest.error.message).toContain('unsupported auth type apiKey');
    }
  });

  it('uses supported tools to emit bundle, ABI, manifest, and Kubernetes YAML artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-artifacts-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `const suffix = "!";
export function handle(input: string): string {
  return input + suffix;
}
`
      );

      const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        spec: imageSpecSchema,
        status: imageStatusSchema,
      });
      const imagePipeline = sdk.operator({
        name: 'image-pipeline',
        deployment: { namespace: 'media' },
        resources: { ImageJob },
        handlers: [
          ImageJob.on.reconcile((job) => {
            job.status.phase = 'Processing';
          }),
        ],
      });

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });
      const runtimeContract = await emitRuntimeContractArtifact({ outDir: join(dir, 'contract') });
      const wit = await emitHandlerWitArtifact({ outDir: join(dir, 'contract') });

      expect(bundle.ok).toBe(true);
      expect(runtimeContract.ok).toBe(true);
      expect(wit.ok).toBe(true);
      if (!bundle.ok || !runtimeContract.ok || !wit.ok) {
        return;
      }

      expect(bundle.value.wasmBackend).toBe('componentize-js');
      expect(await readFile(bundle.value.javascriptBundlePath, 'utf8')).toContain('suffix');
      expect(wit.value.witSource).toContain('export handle');

      const wasm = await emitWasmComponentArtifact({
        javascriptBundlePath: bundle.value.javascriptBundlePath,
        witPath: wit.value.path,
        outDir: join(dir, 'wasm'),
      });
      expect(wasm.ok).toBe(true);
      if (!wasm.ok) {
        return;
      }

      const manifest = buildOperatorManifest({
        operator: imagePipeline.definition,
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: wasm.value.digest,
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(manifest.ok).toBe(true);
      if (!manifest.ok) {
        return;
      }

      expect(manifest.value.spec.adapterRequirements?.kind).toBe('wasmComponent');
      expect(manifest.value.spec.adapterRequirements?.hostImports).toEqual(['capability-request', 'log', 'cancel']);
      expect(manifest.value.spec.handlerArtifact.digest).toBe(wasm.value.digest);
      expect(manifest.value.spec.bundle.sourceDigest).toBe(runtimeContract.value.digest);
      expect(manifest.value.spec.bundle.artifacts).toEqual([
        { kind: 'runtime-contract', path: runtimeContract.value.path, digest: runtimeContract.value.digest },
        { kind: 'wasm-component', path: wasm.value.path, digest: wasm.value.digest },
      ]);
      expect(manifest.value.spec.bundle.portability?.bundleDigest).toBe(manifest.value.spec.bundle.digest);
      expect(manifest.value.spec.handlerExports).toHaveLength(1);
      expect(manifest.value.spec.ownedCrds[0]?.kind).toBe('ImageJob');
      expect(validateOperatorManifest(manifest.value)).toEqual({ ok: true, value: [] });

      const invalidWatchManifest = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{ apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, events: ['reconcile'], handlers: ['missing-handler'] }],
        },
      });

      expect(invalidWatchManifest.ok).toBe(false);

      const invalidManifestVersion = validateOperatorManifest({
        ...manifest.value,
        apiVersion: 'applik8s.operator/v2alpha1',
      });
      // typecast: negative manifest-validation fixture intentionally violates the typed manifest kind.
      const invalidManifestKind = validateOperatorManifest({
        ...manifest.value,
        kind: 'Bundle',
      } as unknown as typeof manifest.value);

      expect(invalidManifestVersion.ok).toBe(false);
      expect(invalidManifestKind.ok).toBe(false);

      const portability = manifest.value.spec.bundle.portability;
      expect(portability).toBeDefined();
      if (!portability) {
        return;
      }
      const invalidBundleIdentityManifest = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          bundle: {
            ...manifest.value.spec.bundle,
            portability: {
              ...portability,
              bundleDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
            },
          },
        },
      });

      expect(invalidBundleIdentityManifest.ok).toBe(false);

      const invalidArtifactInventoryManifest = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          bundle: {
            ...manifest.value.spec.bundle,
            artifacts: [
              { kind: 'runtime-contract', path: runtimeContract.value.path, digest: runtimeContract.value.digest },
              {
                kind: 'wasm-component',
                path: wasm.value.path,
                digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
              },
            ],
          },
        },
      });

      expect(invalidArtifactInventoryManifest.ok).toBe(false);

      const invalidManifest = buildOperatorManifest({
        operator: imagePipeline.definition,
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: 'handler.wasm',
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(invalidManifest.ok).toBe(false);

      const firstHandler = imagePipeline.definition.handlers[0];
      expect(firstHandler).toBeDefined();
      if (!firstHandler) {
        return;
      }

      const duplicateHandlerManifest = buildOperatorManifest({
        operator: {
          ...imagePipeline.definition,
          handlers: [firstHandler, firstHandler],
        },
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: wasm.value.digest,
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(duplicateHandlerManifest.ok).toBe(false);

      const ambiguousRouteManifest = buildOperatorManifest({
        operator: {
          ...imagePipeline.definition,
          handlers: [firstHandler, { ...firstHandler, id: `${firstHandler.id}.duplicate-route` }],
        },
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: wasm.value.digest,
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(ambiguousRouteManifest.ok).toBe(false);
      if (!ambiguousRouteManifest.ok) {
        expect(ambiguousRouteManifest.error.message).toContain('does not support multiple handlers');
      }

      const finalizeOne = ImageJob.on.finalize(() => {}, { finalizer: 'media.applik8s.dev/cleanup' });
      const finalizeTwo = ImageJob.on.finalize(() => {}, { finalizer: 'media.applik8s.dev/archive' });
      const disjointFinalizeManifest = buildOperatorManifest({
        operator: {
          ...imagePipeline.definition,
          handlers: [firstHandler, finalizeOne, finalizeTwo],
        },
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: wasm.value.digest,
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(disjointFinalizeManifest.ok).toBe(true);

      const overlappingFinalizeManifest = buildOperatorManifest({
        operator: {
          ...imagePipeline.definition,
          handlers: [firstHandler, finalizeOne, { ...finalizeTwo, finalizers: ['media.applik8s.dev/cleanup'] }],
        },
        handlerArtifactPath: wasm.value.path,
        handlerArtifactDigest: wasm.value.digest,
        runtimeContractPath: runtimeContract.value.path,
        runtimeContractDigest: runtimeContract.value.digest,
      });

      expect(overlappingFinalizeManifest.ok).toBe(false);
      if (!overlappingFinalizeManifest.ok) {
        expect(overlappingFinalizeManifest.error.message).toContain('does not support multiple handlers');
      }

      const yaml = await emitOperatorKubernetesYaml({
        manifest: manifest.value,
        operator: imagePipeline.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (yaml.ok) {
        expect(yaml.value.paths.length).toBeGreaterThanOrEqual(5);
        const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));

        expect(documents.some((document) => document.kind === 'CustomResourceDefinition' && document.spec.names.kind === 'ImageJob')).toBe(true);
        const crd = documents.find((document) => document.kind === 'CustomResourceDefinition' && document.spec.names.kind === 'ImageJob');
        expect(crd?.spec.versions[0].schema.openAPIV3Schema.properties.spec).toMatchObject({
          type: 'object',
          required: ['sourceUrl'],
        });
        expect(crd?.spec.versions[0].schema.openAPIV3Schema.properties.status).toMatchObject({
          type: 'object',
          properties: { phase: { type: 'string' } },
        });
        expect(documents.some((document) => document.kind === 'Deployment' && document.metadata.name === 'image-pipeline')).toBe(true);
        expect(documents.some((document) => document.kind === 'ConfigMap')).toBe(false);
        const deployment = documents.find((document) => document.kind === 'Deployment' && document.metadata.name === 'image-pipeline');
        expect(deployment?.spec.template.spec.containers[0].image).toMatch(/^applik8s\/image-pipeline-operator:[a-f0-9]{12}$/);
        expect(deployment?.spec.template.spec.initContainers).toBeUndefined();
        expect(deployment?.spec.template.spec.containers[0].env).toContainEqual({ name: 'APPLIK8S_HANDLER_PATH', value: '/handler/handler.wasm' });
        expect(deployment?.spec.template.spec.containers[0].volumeMounts).toBeUndefined();
        expect(deployment?.spec.template.spec.volumes).toBeUndefined();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

});
