import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { CapabilityDescriptor, JsonSchemaSource, PermissionRule, RuntimeConfig } from '@applik8s/core';
import { sdk } from '@applik8s/sdk';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  bindKubernetesConnections,
  buildOperatorManifest,
  bundleHandlerEntrypoint,
  compileTypeKroComposition,
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
  it('keeps the public operator entrypoint free of Node-oriented application dependencies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-operator-entrypoint-'));
    try {
      const entrypoint = join(dir, 'handler.ts');
      await writeFile(entrypoint, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/applik8s/src/operator.ts'))};
export function handle(input: string) { return JSON.stringify({ input, recognized: sdk.isApplik8sError({ code: 'X', message: 'x', severity: 'error', context: {} }) }); }
`);
      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });
      expect(bundle.ok).toBe(true);
      if (!bundle.ok) return;
      const source = await readFile(bundle.value.javascriptBundlePath, 'utf8');
      // typecast: esbuild owns this JSON artifact and the test reads only its documented input map.
      const metafile = JSON.parse(await readFile(bundle.value.metafilePath, 'utf8')) as { readonly inputs: Readonly<Record<string, unknown>> };
      const inputs = Object.keys(metafile.inputs).join('\n');
      expect(source).not.toMatch(/from\s*["']node:|require\(["']node:/);
      expect(inputs).not.toMatch(/application-|typekro|postgres|nats|drizzle|commander/);
      expect(Buffer.byteLength(source)).toBeLessThan(250_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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

  it('declares kubernetes-read host import and typed-read RBAC when handlers use typed reads', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'read-aware-pipeline',
      deployment: { namespace: 'media', replicas: 1 },
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          await job.read.resource(ImageJob).get({ name: job.metadata.name, namespace: job.metadata.namespace ?? 'default' });
          job.status.phase = 'Processing';
        }),
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
      expect(manifest.value.spec.adapterRequirements?.hostImports).toContain('kubernetes-read');
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch'] });
    }
  });

  it('emits portable named Kubernetes connection requirements without installation secrets', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', spec: imageSpecSchema, status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'remote-workload-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      reads: {
        Deployment: sdk.kubernetes.resource({ apiVersion: 'apps/v1', kind: 'Deployment', namespaces: ['payments'], access: 'connection' }),
      },
      capabilities: {
        destination: sdk.kubernetes.connection.required({
          endpointPolicy: 'workload-cluster-apis',
          permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'create', 'patch'], namespaces: ['payments'] }],
        }),
      },
      handlers: [],
    });
    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
      runtimeVersionRange: '^0.4.0',
    });

    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.spec.requiresRuntime).toBe('>=0.1.1, <0.2.0');
    expect(manifest.value.spec.capabilities?.destination).toMatchObject({
      name: 'destination', kind: 'kubernetes',
      kubernetesConnection: { endpointPolicy: 'workload-cluster-apis' },
      execution: { protocol: 'applik8s.kubernetes-connection/v1alpha1' },
    });
    expect(manifest.value.spec.capabilities?.destination).not.toHaveProperty('auth');
    expect(manifest.value.spec.capabilities?.destination).not.toHaveProperty('endpoint');
    expect(manifest.value.spec.kubernetesConnectionBindings).toBeUndefined();
    expect(manifest.value.spec.readResources).toContainEqual({ apiVersion: 'apps/v1', kind: 'Deployment', plural: 'deployments', scope: 'Namespaced', namespaces: ['payments'], access: 'connection' });
    expect(manifest.value.spec.permissions).not.toContainEqual(expect.objectContaining({ apiGroups: ['apps'], resources: ['deployments'] }));
    expect(manifest.value.spec.security.secrets.secretRefs).toEqual([]);
    const installed = bindKubernetesConnections(manifest.value, {
      destination: {
        kubeconfigSecretRef: { name: 'destination-kubeconfig', namespace: 'media', key: 'kubeconfig' },
        context: 'destination',
        endpointPolicy: {
          name: 'workload-cluster-apis', version: '1', scheme: 'https',
          hosts: ['destination.example.test'], ports: [6443], redirects: 'deny',
        },
      },
    });
    expect(installed.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['destination-kubeconfig'] });
    expect(installed.spec.kubernetesConnectionBindings?.destination?.context).toBe('destination');
    expect(() => bindKubernetesConnections(manifest.value, {})).toThrow(/exactly match declared aliases/);
    // typecast: deliberately constructs an invalid extra-alias binding to prove the runtime installation boundary rejects it.
    expect(() => bindKubernetesConnections(manifest.value, {
      ...installed.spec.kubernetesConnectionBindings,
      undeclared: installed.spec.kubernetesConnectionBindings?.destination,
    } as NonNullable<typeof installed.spec.kubernetesConnectionBindings>)).toThrow(/exactly match declared aliases/);
  });

  it('emits declared typed permission bundles into the operator manifest', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const permissions: PermissionRule[] = [
      ImageJob.permissions.read(),
      ImageJob.permissions.watch(),
      ImageJob.permissions.apply(),
      ImageJob.permissions.patch(),
      ImageJob.permissions.patchStatus(),
      ImageJob.permissions.delete(),
      ImageJob.permissions.finalize(),
      sdk.permissions.k8s.ConfigMap.apply(),
      sdk.permissions.k8s.Deployment.patchStatus(),
      sdk.permissions.events.write(),
    ];
    const operator = sdk.operator({
      name: 'permission-bundle-pipeline',
      deployment: { namespace: 'media', replicas: 1 },
      resources: { ImageJob },
      permissions,
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
      expect(manifest.value.spec.permissions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          apiGroups: ['media.applik8s.dev'],
          resources: ['imagejobs'],
          verbs: expect.arrayContaining(['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']),
        }),
        { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] },
        { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['patch', 'update'] },
        { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch'] },
        { apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] },
        { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] },
      ]));
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

  it('lowers bounded secondary watches with source-watch and target-list RBAC', () => {
    const Replica = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'Replica', spec: imageSpecSchema, status: imageStatusSchema });
    const Deployment = sdk.kubernetes.Deployment;
    const operator = sdk.operator({
      name: 'secondary-watch-pipeline',
      deployment: { namespace: 'media' },
      resources: { Replica },
      reads: { Deployment },
      handlers: [Replica.on.reconcile(() => {})],
      secondaryWatches: [sdk.watch(Deployment).enqueue(Replica, { namespace: 'operator', watch: { labelSelector: { matchLabels: { app: 'source' } } } })],
    });
    const manifest = buildOperatorManifest({ operator: operator.definition, handlerArtifactPath: 'wasm/handler.wasm', handlerArtifactDigest: `sha256:${'a'.repeat(64)}`, runtimeContractPath: 'runtime-contract.json', runtimeContractDigest: `sha256:${'b'.repeat(64)}` });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.spec.secondaryWatches).toEqual([expect.objectContaining({
      source: expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment' }),
      target: expect.objectContaining({ kind: 'Replica' }),
      mapper: { mode: 'all', namespace: 'operator' },
    })]);
    expect(manifest.value.spec.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiGroups: ['apps'], resources: ['deployments'], verbs: expect.arrayContaining(['watch']) }),
      expect.objectContaining({ apiGroups: ['media.applik8s.dev'], resources: ['replicas'], verbs: expect.arrayContaining(['list', 'watch']) }),
    ]));
  });

  it('lowers an exact source-metadata mapping without adding target-list fan-out', () => {
    const PublicationOwner = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'PublicationOwner', spec: imageSpecSchema, status: imageStatusSchema });
    const DnsEndpoint = sdk.kubernetes.resource({ apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint', plural: 'dnsendpoints', namespaces: ['media'] });
    const operator = sdk.operator({
      name: 'exact-secondary-watch-pipeline',
      deployment: { namespace: 'media' },
      resources: { PublicationOwner },
      reads: { DnsEndpoint },
      handlers: [PublicationOwner.on.reconcile(() => {})],
      secondaryWatches: [sdk.watch(DnsEndpoint).enqueue(PublicationOwner, {
        namespace: 'source',
        map: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: 'dns.applik8s.dev/source-name' } },
      })],
    });
    const manifest = buildOperatorManifest({ operator: operator.definition, handlerArtifactPath: 'wasm/handler.wasm', handlerArtifactDigest: `sha256:${'a'.repeat(64)}`, runtimeContractPath: 'runtime-contract.json', runtimeContractDigest: `sha256:${'b'.repeat(64)}` });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.spec.secondaryWatches).toEqual([expect.objectContaining({
      source: expect.objectContaining({ apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint' }),
      target: expect.objectContaining({ kind: 'PublicationOwner' }),
      mapper: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: 'dns.applik8s.dev/source-name' }, namespace: 'source' },
    })]);
    expect(manifest.value.spec.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: expect.arrayContaining(['get', 'list', 'watch']) }),
    ]));
  });

  it('rejects invalid exact secondary-watch metadata keys and all-namespace mappings', () => {
    const PublicationOwner = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'PublicationOwner', spec: imageSpecSchema, status: imageStatusSchema });
    const DnsEndpoint = sdk.kubernetes.resource({ apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint', plural: 'dnsendpoints' });
    const invalidKey = sdk.operator({
      name: 'invalid-exact-secondary-watch', resources: { PublicationOwner }, reads: { DnsEndpoint }, handlers: [],
      secondaryWatches: [sdk.watch(DnsEndpoint).enqueue(PublicationOwner, { map: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: 'not valid' } } })],
    });
    expect(buildOperatorManifest({ operator: invalidKey.definition, handlerArtifactPath: 'wasm/handler.wasm', handlerArtifactDigest: `sha256:${'a'.repeat(64)}`, runtimeContractPath: 'runtime-contract.json', runtimeContractDigest: `sha256:${'b'.repeat(64)}` })).toMatchObject({ ok: false, error: { code: 'BUNDLE_INVALID', message: expect.stringContaining('metadata key') } });
    expect(() => sdk.watch(DnsEndpoint).enqueue(PublicationOwner, { namespace: 'all', map: { mode: 'targetNameFromSourceField', source: { kind: 'label', key: 'owner' } } })).toThrow(/cannot use namespace: "all"/);
  });

  it('rejects secondary watch sources that are not declared as resources or reads', () => {
    const Replica = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'Replica', spec: imageSpecSchema, status: imageStatusSchema });
    const Deployment = sdk.kubernetes.Deployment;
    const operator = sdk.operator({
      name: 'undeclared-secondary-watch-source',
      resources: { Replica },
      handlers: [Replica.on.reconcile(() => {})],
      secondaryWatches: [sdk.watch(Deployment).enqueue(Replica)],
    });
    const manifest = buildOperatorManifest({ operator: operator.definition, handlerArtifactPath: 'wasm/handler.wasm', handlerArtifactDigest: `sha256:${'a'.repeat(64)}`, runtimeContractPath: 'runtime-contract.json', runtimeContractDigest: `sha256:${'b'.repeat(64)}` });

    expect(manifest).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        code: 'BUNDLE_INVALID',
        message: expect.stringContaining('must be declared under operator resources or reads'),
      }),
    }));
  });

  it('emits enforceable watch scopes for exact, finite, label, and field routed handlers', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const operator = sdk.operator({
      name: 'scoped-watch-pipeline',
      deployment: { namespace: 'media' },
      resources: { ImageJob },
      handlers: [],
    });
    const scopedDefinition = {
      ...operator.definition,
      handlers: [
        { id: 'ImageJob.reconcile.exact', event: 'reconcile', resource: ImageJob, watch: { namespace: 'media', name: 'hero' } },
        { id: 'ImageJob.reconcile.finite', event: 'reconcile', resource: ImageJob, watch: { namespace: 'media', names: ['hero', 'thumbnail'] } },
        { id: 'ImageJob.reconcile.labels', event: 'reconcile', resource: ImageJob, watch: { namespace: 'media', labelSelector: { matchLabels: { app: 'image' } } } },
        { id: 'ImageJob.reconcile.field', event: 'reconcile', resource: ImageJob, watch: { namespace: 'media', fieldSelector: 'metadata.name=hero' } },
      ],
    };

    const manifest = buildOperatorManifest({
      // typecast: this fixture injects handler registration summaries directly to prove manifest watch lowering independent of handler function bodies.
      operator: scopedDefinition as never,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.watches).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'hero', handlers: ['ImageJob.reconcile.exact'] }),
        expect.objectContaining({ names: ['hero', 'thumbnail'], handlers: ['ImageJob.reconcile.finite'] }),
        expect.objectContaining({ labelSelector: { matchLabels: { app: 'image' } }, handlers: ['ImageJob.reconcile.labels'] }),
        expect.objectContaining({ fieldSelector: 'metadata.name=hero', handlers: ['ImageJob.reconcile.field'] }),
      ]));
      expect(manifest.value.spec.watches.every((watch) => watch.namespace === 'media')).toBe(true);
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

  it('emits GuestBook direct-call app artifacts, route diagnostics, and buffered page-view counters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-guestbook-typekro-artifacts-'));

    try {
      const result = await compileTypeKroComposition({
        entrypoint: join(process.cwd(), 'examples/guestbook.ts'),
        compositionName: 'guestBookStack',
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

      const serverRole = result.value.artifacts.resources.find((resource) => resource.kind === 'Role' && resource.metadata.name === 'main-web' && resource.metadata.namespace === 'guestbook');
      const serverSource = result.value.artifacts.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'main-server-source' && resource.metadata.namespace === 'guestbook');
      expect(result.value.artifacts.operatorArtifacts.map((artifact) => artifact.operatorName)).toContain('guestbook-renderer');
      expect(result.value.artifacts.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'guestbook-renderer', namespace: 'guestbook' }) }));
      expect(result.value.artifacts.resources).toContainEqual(expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'main-server', namespace: 'guestbook' }) }));
      expect(serverRole).toMatchObject({
        rules: expect.arrayContaining([
          expect.objectContaining({
            apiGroups: ['guestbook.applik8s.dev'],
            resources: ['guestbookpageviewbuckets'],
            verbs: expect.arrayContaining(['create', 'get', 'patch']),
          }),
        ]),
      });

      const source = JSON.stringify(serverSource);
      expect(source).toContain('GuestBookPageViewBucket.increment');
      expect(source).toContain('bufferResourceCounterIncrement');
      expect(source).toContain('applik8s-server-counter-flush-failure');
      expect(source).toContain('routes.manifest.json');
      expect(source).toContain('route-get-root-0.mjs');
      expect(source).toContain('route-get-entries-older-1.mjs');
      expect(source).toContain('route-post-entries-2.mjs');
      expect(source).toContain('applik8s-server-route-failure');
      expect(source).toContain('Request body exceeds');
      expect(source).toContain('Too many mutation requests');
      expect(source).toContain('x-applik8s-remote-address');
      expect(source).toContain('sourceLocation');
      expect(source).toContain('bundleInputs');
      expect(source).toContain('sourceKind');
      expect(source).toContain('applik8s-route-source-kind:');
      expect(source).toContain('GuestBook.get');
      expect(source).toContain('renderedHtml');
      expect(source).not.toContain('GuestBookPageViewBucket.get');
      expect(source).not.toContain('GuestBookPageViewBucket.create');
      expect(source).not.toContain('GuestBookPageViewBucket.patch');
      expect(source).not.toContain('const CRDs = 0');

      expect(result.value.artifacts.applicationGraphJsonPath).toBe(join(dir, 'dist', 'typekro', 'application-graph.json'));
      const graph = JSON.parse(await readFile(result.value.artifacts.applicationGraphJsonPath ?? '', 'utf8'));
      expect(graph).toMatchObject({ apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'guestbook-stack' } });
      expect(graph.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'server', name: 'web' }),
        expect.objectContaining({ kind: 'counter', name: 'web.GuestBookPageViewBucket' }),
        expect.objectContaining({ kind: 'provider', interface: 'IndexStore' }),
      ]));
      expect(graph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: { nodeId: 'server.web' }, relationship: 'dependsOn', to: { nodeId: 'crd.guest-book' } }),
        expect.objectContaining({ from: { nodeId: 'server.web' }, relationship: 'dependsOn', to: { nodeId: 'crd.guest-book-entry' } }),
        expect.objectContaining({ from: { nodeId: 'server.web' }, relationship: 'dependsOn', to: { nodeId: 'crd.guest-book-page-view-bucket' } }),
        expect.objectContaining({ from: { nodeId: 'server.web' }, relationship: 'emits', to: { nodeId: 'counter.web-guest-book-page-view-bucket' } }),
        expect.objectContaining({ from: { nodeId: 'counter.web-guest-book-page-view-bucket' }, relationship: 'writes', to: { nodeId: 'crd.guest-book-page-view-bucket' } }),
      ]));
      expect(graph.nodes.map((node: { readonly id: string }) => node.id)).toEqual([...graph.nodes.map((node: { readonly id: string }) => node.id)].sort());
      expect(graph.edges.map((edge: { readonly from: { readonly nodeId: string }; readonly relationship: string; readonly to: { readonly nodeId: string } }) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`)).toEqual([...graph.edges.map((edge: { readonly from: { readonly nodeId: string }; readonly relationship: string; readonly to: { readonly nodeId: string } }) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`)].sort());
      expect(graph.providerRequirements).toEqual([]);
      expect(graph.providerBindings).toEqual([]);
      expect(graph.compatibility).toMatchObject({
        documentedInternalContracts: expect.arrayContaining(['ApplicationGraph']),
        stablePublicApis: expect.arrayContaining(['Resource.increment', 'app.aggregate', 'app.crd', 'app.defaults', 'app.http', 'app.job', 'app.model', 'app.provide', 'app.reconcile', 'app.resource', 'app.schedule', 'app.server', 'app.storage.postgres', 'provider.ModelStore', 'sdk.kubernetesComposition']),
        experimentalSurfaces: expect.arrayContaining(['app.graph']),
        postV3Surfaces: expect.arrayContaining(['workload-movement-operator']),
        labels: expect.arrayContaining([
          expect.objectContaining({ name: 'ApplicationGraph', surface: 'documentedInternalContract' }),
          expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi' }),
          expect.objectContaining({ name: 'provider.ModelStore', surface: 'stablePublicApi' }),
          expect.objectContaining({ name: 'workload-movement-operator', surface: 'postV3Surface' }),
        ]),
      });
      expect(result.value.artifacts.manifest.spec.applicationGraph).toMatchObject({
        apiVersion: 'applik8s.appGraph/v1alpha1',
        path: result.value.artifacts.applicationGraphJsonPath,
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles the minimal GuestBook teaching example with CRDs, server, index, and Ingress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-guestbook-minimal-'));
    try {
      const result = await compileTypeKroComposition({
        entrypoint: join(process.cwd(), 'examples/guestbook-minimal.ts'),
        compositionName: 'guestBookMinimalStack',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts.resources).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'CustomResourceDefinition', metadata: expect.objectContaining({ name: 'guestbooks.guestbook.applik8s.dev' }) }),
          expect.objectContaining({ kind: 'CustomResourceDefinition', metadata: expect.objectContaining({ name: 'guestbookentries.guestbook.applik8s.dev' }) }),
          expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ name: 'web' }) }),
          expect.objectContaining({ kind: 'Ingress', spec: expect.objectContaining({ rules: [expect.objectContaining({ host: 'guestbook.localhost' })] }) }),
        ]));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('emits an installable application definition without fabricating an invalid empty instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-installable-application-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { namespace } from 'typekro/kubernetes';
const platform = app('installable-proof', {
  namespace: 'installable-proof',
  controlPlaneNamespace: 'applications-system',
  apiVersion: 'applications.example.test/v1alpha1',
  kind: 'ProofInstallation',
  spec: type({ hostname: 'string' }),
  status: type({ ready: 'boolean' }),
});
platform.infra(() => namespace({ metadata: { name: 'installable-proof' } }));
export const installableProof = platform;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'installableProof',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.7.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.resources).toContainEqual(expect.objectContaining({
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: expect.objectContaining({ name: 'installable-proof' }),
      }));
      const definition = result.value.artifacts.resources.find((resource) => resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === 'installable-proof');
      // TypeKro 0.28 hoists owned Namespaces out of the RGD so an instance can
      // never finalizer-deadlock inside the Namespace it owns. Applik8s runtime
      // preparation creates the application Namespace before applying an
      // installation instance.
      expect(definition?.spec).toMatchObject({
        resources: [expect.objectContaining({
          id: 'applik8sInstallationContract',
          template: expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'installable-proof-installation-contract' }) }),
        })],
      });
      const definitionResources = definition?.spec && typeof definition.spec === 'object' ? Reflect.get(definition.spec, 'resources') : undefined;
      expect(definitionResources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ template: expect.objectContaining({ kind: 'Namespace' }) }),
      ]));
      expect(definition?.spec).toMatchObject({ schema: { status: { ready: ['$', '{false}'].join('') } } });
      expect(result.value.artifacts.instanceYamlPaths).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles the public GuestBook profile with managed Certificate, DNS intent, and HTTPS URL projection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-guestbook-public-'));
    const previous = {
      profile: process.env.APPLIK8S_GUESTBOOK_PROFILE,
      domain: process.env.APPLIK8S_GUESTBOOK_DOMAIN,
      issuer: process.env.APPLIK8S_GUESTBOOK_ISSUER_NAME,
      issuerKind: process.env.APPLIK8S_GUESTBOOK_ISSUER_KIND,
    };
    try {
      process.env.APPLIK8S_GUESTBOOK_PROFILE = 'public';
      process.env.APPLIK8S_GUESTBOOK_DOMAIN = 'guestbook.example.test';
      process.env.APPLIK8S_GUESTBOOK_ISSUER_NAME = 'launch-issuer';
      process.env.APPLIK8S_GUESTBOOK_ISSUER_KIND = 'Issuer';
      const result = await compileTypeKroComposition({
        entrypoint: join(process.cwd(), 'examples/guestbook.ts'),
        compositionName: 'guestBookStack',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.artifacts.resources).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'Ingress', metadata: expect.objectContaining({ annotations: expect.objectContaining({ 'external-dns.alpha.kubernetes.io/hostname': 'guestbook.example.test' }) }), spec: expect.objectContaining({ tls: [{ hosts: ['guestbook.example.test'], secretName: 'web-tls' }] }) }),
          expect.objectContaining({ apiVersion: 'cert-manager.io/v1', kind: 'Certificate', spec: expect.objectContaining({ secretName: 'web-tls', issuerRef: { name: 'launch-issuer', kind: 'Issuer', group: 'cert-manager.io' } }) }),
        ]));
        const graph = JSON.parse(await readFile(result.value.artifacts.applicationGraphJsonPath ?? '', 'utf8'));
        expect(graph.nodes).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'exposure.web', publicUrl: 'https://guestbook.example.test', readiness: expect.objectContaining({ certificate: 'readyCondition', dns: 'propagationUnverified' }) }),
        ]));
      }
    } finally {
      // typecast: keep environment-key/value cleanup tuples readonly so names and optional prior values retain their correlation.
      for (const [name, value] of [
        ['APPLIK8S_GUESTBOOK_PROFILE', previous.profile],
        ['APPLIK8S_GUESTBOOK_DOMAIN', previous.domain],
        ['APPLIK8S_GUESTBOOK_ISSUER_NAME', previous.issuer],
        ['APPLIK8S_GUESTBOOK_ISSUER_KIND', previous.issuerKind],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('fails TypeKro composition compilation when the attached app graph has invalid provider bindings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-bad-app-graph-'));
    try {
      const entrypoint = join(dir, 'entrypoint.ts');
      await writeFile(entrypoint, `
const composition = {
  operatorInstalls: [],
  resources: [],
  resolveOperatorInstalls() {
    return { ok: true, value: composition };
  },
};

Object.defineProperty(composition, '__applik8sApplicationGraph', {
  value: {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'bad-provider-graph' },
    nodes: [
      {
        id: 'model.entry',
        kind: 'model',
        name: 'Entry',
        stability: 'experimental',
        entity: { name: 'Entry' },
        store: { interface: 'ModelStore', nodeId: 'provider.model.missing' },
        schema: { identity: ['id'], constraints: [], indexes: [], migrations: { strategy: 'none', compatibility: 'schemaCompatibleOnly' }, transactions: 'supported' },
        materialization: {
          mode: 'providerBacked',
          provider: { interface: 'ModelStore', nodeId: 'provider.model.missing' },
          backingResources: [],
          connection: {},
          reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
        },
      },
    ],
    edges: [{ from: { nodeId: 'server.missing' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' }],
    providerRequirements: [],
    providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: ['ApplicationGraph'], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  },
});

export const badProviderGraph = composition;
`);

      const result = await compileTypeKroComposition({
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

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'COMPATIBILITY_FAILED',
          message: expect.stringContaining('Application graph is invalid'),
        });
        expect(result.error.message).toContain('server.missing:dependsOn:model.entry');
        expect(result.error.message).toContain('provider.model.missing');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lowers model command declarations into an inspectable self-contained Node processor workload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-command-processor-artifacts-'));
    try {
      const entrypoint = join(dir, 'entrypoint.ts');
      await writeFile(entrypoint, `
import { app, command, event, EventLog } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';

const AccountEntity = entity('Account', { spec: type({ tenant: 'string', displayName: 'string' }) });
const AuditEntity = entity('Audit', { spec: type({ count: 'number' }) });
const RenameAccount = command('account.rename.v1', {
  input: type({ accountId: 'string', displayName: 'string', requestId: 'string' }),
  output: type({ changed: 'boolean' }),
});
const ReindexAccount = command('account.reindex.v1', { input: type({ accountId: 'string' }), output: type({ accepted: 'boolean' }) });
const AccountChanged = event('account.changed.v1', { payload: type({ accountId: 'string', displayName: 'string' }) });
const platform = app('command-artifact-platform', { namespace: 'commands' });
platform.provide(EventLog, {
  kind: 'nats-jetstream',
  name: 'applik8s-events',
  namespace: 'commands',
  connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'nats-auth', namespace: 'commands' },
  authMode: 'token',
});
platform.storage.postgres('command-db', { database: 'commands', migrations: 'generated-job' });
const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
const Audit = platform.model(AuditEntity, { schema: { transactions: 'required' } });
Account.on.command(RenameAccount, {
  key: ({ accountId }) => accountId,
  processor: { replicas: 2, concurrency: 4, maxAckPending: 12, resources: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '2', memory: '768Mi' } }, nodeSelector: { 'kubernetes.io/os': 'linux' } },
  idempotencyKey: ({ requestId }) => requestId,
  ordering: 'concurrent',
  missing: { route: 'fallback-account' },
  transaction: { models: [Audit], history: [Account, Audit], outbox: [AccountChanged], commands: [ReindexAccount] },
}, async (account, input, context) => {
  const changed = account.spec.displayName !== input.displayName;
  account.patch({ spec: { displayName: input.displayName } });
  await context.models.Audit?.patch({ id: input.accountId }, { spec: { count: 1 } });
  context.emit(AccountChanged, { accountId: input.accountId, displayName: input.displayName });
  context.send(ReindexAccount, { accountId: input.accountId }, { targetKey: input.accountId, idempotencyKey: input.requestId });
  return { changed };
});
export const commandStack = platform.composition;
`);

      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'commandStack',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.4.0',
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
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.artifacts.processorArtifacts).toHaveLength(1);
      const artifact = result.value.artifacts.processorArtifacts[0];
      expect(artifact).toMatchObject({ name: 'account-commands', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
      expect(artifact?.container).toMatchObject({ image: expect.stringMatching(/^applik8s\/command-artifact-platform-command-processor-account-commands:sha-[0-9a-f]{64}$/), baseImage: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', entrypoint: '/app/processor.mjs' });
      expect(artifact?.sizeBytes).toBeGreaterThan(0);
      expect(artifact?.sizeBytes).toBeLessThan(900_000);
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      const logicalSource = source.replace(/\\\r?\n/g, '');
      const manifest = JSON.parse(await readFile(artifact?.manifestPath ?? '', 'utf8'));
      expect(source).toContain('applik8s-command-processor');
      expect(source).toContain('createRequire');
      expect(source).toContain('account.rename');
      expect(source).toContain('account.changed');
      expect(source).toContain('account.reindex');
      expect(logicalSource).toContain('applik8s-command-outbox-relayed');
      expect(logicalSource).toContain('applik8s-command-processor-observation');
      expect(logicalSource).toContain('recordTerminalFailure');
      expect(logicalSource).toContain('applik8s-command-terminal-recorder-missing');
      expect(logicalSource).toContain('applik8s-command-processor-startup-wait');
      expect(logicalSource).toContain('applik8s-processor-startup-timeout');
      expect(logicalSource).toContain('PostgreSQL');
      expect(logicalSource).toContain('JetStream event log');
      expect(logicalSource).toContain('JetStream command consumer');
      expect(logicalSource).toContain('applik8s-command-processor-draining');
      expect(logicalSource).toContain('applik8s-command-processor-drain-failure');
      expect(logicalSource).toContain('applik8s-processor-ready');
      expect(logicalSource).toContain('oldest_pending_seconds');
      expect(logicalSource).toContain('consumerLag');
      expect(source).toContain('APPLIK8S_NATS_SERVERS');
      expect(logicalSource).toContain('APPLIK8S_PROCESSOR_CONCURRENCY');
      expect(JSON.stringify(artifact?.resources)).toContain('nats://applik8s-events.commands.svc:4222');
      expect(source).toContain('jsonSchema');
      expect(source).toMatch(/\.models\s*\.Audit/);
      expect(source).not.toContain('npm install');
      expect(source).not.toContain('bun install');
      expect(Math.max(...source.split('\n').map((line) => line.length))).toBeLessThan(1_000);
      await expect(execFileAsync(process.execPath, [artifact?.sourcePath ?? ''], {
        env: { ...process.env, DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/invalid', APPLIK8S_NATS_SERVERS: '["nats://127.0.0.1:1"]', APPLIK8S_PROCESSOR_CONCURRENCY: '4' },
        timeout: 5_000,
      })).rejects.toMatchObject({
        stderr: expect.not.stringContaining('Dynamic require of'),
      });
      expect(manifest).toMatchObject({
        kind: 'GeneratedCommandProcessor',
        spec: {
          guarantees: { delivery: 'atLeastOnce', authority: 'postgresInboxAndDeclaredOrdering', acknowledgement: 'afterTransactionCommit', externalEffectsWhileLocked: 'forbidden' },
          capacity: { replicas: 2, concurrencyPerReplica: 4, maximumInFlight: 8, maxAckPending: 12, requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '2', memory: '768Mi' } },
          runtime: { packageManagerAtStartup: false, distribution: 'ociImage', image: artifact?.container.image, baseImage: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2' },
          container: expect.objectContaining({ image: artifact?.container.image, contextPath: artifact?.container.contextPath }),
        },
      });
      // Empty NetworkPolicy rule arrays are semantically redundant and the API server
      // normalizes them away. Emitting one makes KRO observe a mutation after every SSA,
      // so it can never leave its reconciliation barrier and project root status.
      expect(JSON.stringify(result.value.artifacts.resources)).not.toContain('"ingress":[]');
      expect(result.value.artifacts.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          apiVersion: 'kro.run/v1alpha1',
          kind: 'ResourceGraphDefinition',
          metadata: expect.objectContaining({ name: 'command-artifact-platform' }),
          spec: expect.objectContaining({
            resources: expect.arrayContaining([
              expect.objectContaining({ template: expect.objectContaining({ apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Stream', metadata: expect.objectContaining({ name: 'applik8s-events' }) }) }),
              expect.objectContaining({ template: expect.objectContaining({ apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Consumer', metadata: expect.objectContaining({ name: 'account-commands' }) }) }),
              expect.objectContaining({ template: expect.objectContaining({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: expect.objectContaining({ name: 'account-commands' }) }) }),
              expect.objectContaining({ template: expect.objectContaining({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: expect.objectContaining({ name: 'account-commands' }) }) }),
              expect.objectContaining({ template: expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'account-commands' }) }) }),
            ]),
          }),
        }),
        expect.objectContaining({ apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Stream', metadata: expect.objectContaining({ name: 'applik8s-events', namespace: 'commands' }), spec: expect.objectContaining({ name: 'APPLIK8S_EVENTS', subjects: ['applik8s.>'], duplicateWindow: '2m' }) }),
        expect.objectContaining({
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: expect.objectContaining({ name: 'account-commands', namespace: 'commands' }),
          spec: expect.objectContaining({ policyTypes: ['Ingress', 'Egress'], egress: expect.arrayContaining([expect.objectContaining({ ports: expect.arrayContaining([expect.objectContaining({ port: 4222 }), expect.objectContaining({ port: 5432 })]) })]) }),
        }),
        expect.objectContaining({
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: expect.objectContaining({ name: 'account-commands', namespace: 'commands' }),
          spec: expect.objectContaining({
            replicas: 2,
            strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
            template: expect.objectContaining({ spec: expect.objectContaining({
              automountServiceAccountToken: false,
              nodeSelector: { 'kubernetes.io/os': 'linux' },
              topologySpreadConstraints: [expect.objectContaining({ maxSkew: 1, topologyKey: 'kubernetes.io/hostname', whenUnsatisfiable: 'ScheduleAnyway' })],
              securityContext: expect.objectContaining({ runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } }),
              containers: [expect.objectContaining({
                name: 'processor',
                image: artifact?.container.image,
                imagePullPolicy: 'IfNotPresent',
                securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
                resources: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '2', memory: '768Mi' } },
                env: expect.arrayContaining([
                  { name: 'APPLIK8S_PROCESSOR_CONCURRENCY', value: '4' },
                  { name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name: 'nats-auth', key: 'token', optional: false } } },
                ]),
              })],
            }) }),
          }),
        }),
        expect.objectContaining({ apiVersion: 'jetstream.nats.io/v1beta2', kind: 'Consumer', metadata: expect.objectContaining({ name: 'account-commands', namespace: 'commands' }), spec: expect.objectContaining({ streamName: 'APPLIK8S_EVENTS', filterSubjects: ['applik8s.commands.account-rename.v1.>'], maxAckPending: 12 }) }),
        expect.objectContaining({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: expect.objectContaining({ name: 'account-commands', namespace: 'commands' }), spec: expect.objectContaining({ maxUnavailable: 1 }) }),
      ]));
      const applicationRgd = result.value.artifacts.resources.find((resource) => resource.apiVersion === 'kro.run/v1alpha1' && resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === 'command-artifact-platform');
      expect(JSON.stringify(applicationRgd)).not.toContain('"kind":"CustomResourceDefinition"');
      const graph = JSON.parse(await readFile(result.value.artifacts.applicationGraphJsonPath ?? '', 'utf8'));
      expect(graph.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'model', name: 'Account', runtime: expect.objectContaining({ provider: 'postgres', database: 'commands', secretName: 'command-db-app' }) }),
        expect.objectContaining({ kind: 'command', name: 'account.rename.v1', contract: expect.objectContaining({ input: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }) }) }),
        expect.objectContaining({ kind: 'commandHandler', ordering: 'concurrent', missing: 'route', missingRoute: 'fallback-account', transaction: expect.objectContaining({ commands: [{ nodeId: 'command.account.reindex.v1' }] }), retention: { replayWindowSeconds: 604_800, auditWindowSeconds: 2_592_000, publishedOutboxWindowSeconds: 86_400, cleanupIntervalSeconds: 300, cleanupBatchSize: 1_000 } }),
        expect.objectContaining({ kind: 'processor', name: 'Account-commands', generatedResources: expect.arrayContaining([expect.objectContaining({ resource: expect.objectContaining({ kind: 'Consumer' }) }), expect.objectContaining({ role: 'policy', resource: expect.objectContaining({ kind: 'NetworkPolicy' }) })]) }),
      ]));
      expect(result.value.artifacts.manifest.spec.processors).toEqual([expect.objectContaining({ name: 'account-commands', digest: artifact?.digest, sizeBytes: artifact?.sizeBytes })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('lowers app.model Postgres provider graph contracts into concrete generated artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-model-graph-lowering-'));
    try {
      const entrypoint = join(dir, 'entrypoint.ts');
      await writeFile(entrypoint, `
import { ModelStore, sdk } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';

const Note = entity('Note', {
  spec: type({ message: 'string' }),
  status: type({ phase: 'string?' }),
});

export const notesModelApp = sdk.kubernetesComposition({
  name: 'notes-model-stack',
  apiVersion: 'notes.applik8s.dev/v1alpha1',
  kind: 'NotesModelStack',
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, (_spec, app) => {
  const store = app.provide(ModelStore, {
    kind: 'postgres',
    name: 'notes-db',
    namespace: 'notes',
    database: 'notes',
    migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'notes-model-migration' },
  });
  app.model(Note, { store });
  return { ready: true };
});
`);

      const result = await compileTypeKroComposition({
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
        throw new Error(result.error.message);
      }
      expect(result.value.artifacts.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: expect.objectContaining({ name: 'notes-db', namespace: 'notes' }) }),
        expect.objectContaining({ apiVersion: 'batch/v1', kind: 'Job', metadata: expect.objectContaining({ name: 'notes-model-migration', namespace: 'notes' }) }),
        expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: expect.objectContaining({ name: 'note-model-store', namespace: 'notes' }) }),
      ]));
      expect(result.value.artifacts.resources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'v1', kind: 'Secret', metadata: expect.objectContaining({ name: 'notes-db-app', namespace: 'notes' }) }),
      ]));
      expect(result.value.artifacts.applicationGraphJsonPath).toBe(join(dir, 'dist', 'typekro', 'application-graph.json'));
      const graph = JSON.parse(await readFile(result.value.artifacts.applicationGraphJsonPath ?? '', 'utf8'));
      const serializedArtifacts = JSON.stringify({ graph, resources: result.value.artifacts.resources });
      expect(serializedArtifacts).not.toContain('__applik8sApplyResources');
      expect(serializedArtifacts).not.toContain('__applik8sDeleteRefs');
      const artifactResourceKeys = new Set(result.value.artifacts.resources.map((resource) => `${resource.apiVersion}:${resource.kind}:${resource.metadata?.namespace ?? ''}:${resource.metadata?.name ?? ''}`));
      type GraphGeneratedResource = { readonly resource?: { readonly apiVersion?: string; readonly kind?: string; readonly namespace?: string; readonly name?: string } };
      type GraphNodeWithGeneratedResources = { readonly generatedResources?: readonly GraphGeneratedResource[] };
      // typecast: JSON.parse returns unknown graph node shapes; this narrows just the generatedResources field for test assertions.
      const graphResourceKeys = new Set((graph.nodes as readonly GraphNodeWithGeneratedResources[]).flatMap((node) => node.generatedResources ?? [])
        .map((generated) => generated.resource)
        .filter((resource): resource is { readonly apiVersion: string; readonly kind: string; readonly namespace?: string; readonly name?: string } => Boolean(resource?.apiVersion && resource.kind && resource.name))
        .map((resource) => `${resource.apiVersion}:${resource.kind}:${resource.namespace ?? ''}:${resource.name ?? ''}`));
      for (const expected of [
        'postgresql.cnpg.io/v1:Cluster:notes:notes-db',
        'batch/v1:Job:notes:notes-model-migration',
      ]) {
        expect(artifactResourceKeys.has(expected)).toBe(true);
        expect(graphResourceKeys.has(expected)).toBe(true);
      }
      expect(graph.providerRequirements).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'requirement.model.note.store', consumer: { nodeId: 'model.note' } }),
      ]));
      expect(graph.providerBindings).toEqual(expect.arrayContaining([
        expect.objectContaining({ requirement: 'requirement.model.note.store', generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'Cluster', name: 'notes-db', namespace: 'notes' })]) }),
      ]));
      expect(graph.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'job.notes-model-migration',
          generatedResources: expect.arrayContaining([
            expect.objectContaining({ artifact: expect.objectContaining({ kind: 'kubernetesManifest', name: 'notes-model-migration.yaml' }) }),
            expect.objectContaining({ artifact: expect.objectContaining({ kind: 'jobDiagnostics', name: 'notes-model-migration-diagnostics' }) }),
          ]),
        }),
      ]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('statically serializes operators that use raw ArkType schemas with inferred CRD types', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-arktype-static-'));

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { type } from 'arktype';

const spec = type({ title: 'string', message: 'string?' });
const status = type({ phase: "('Pending' | 'Rendered')?", entryCount: 'number?' });
const entrySpec = type({ guestbook: 'string', author: 'string', message: 'string' });
const entryStatus = type({ phase: "('Published' | 'Rejected')?" });

export const GuestBook = sdk.crd({ apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'GuestBook', spec, status });
export const GuestBookEntry = sdk.crd({ apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'GuestBookEntry', spec: entrySpec, status: entryStatus });
export const guestBook = sdk.operator({
  name: 'guestbook',
  deployment: { namespace: 'demo', replicas: 1 },
  resources: { GuestBook, GuestBookEntry },
  handlers: [GuestBook.on.reconcile(async (book) => {
    const entries = await book.read.resource(GuestBookEntry).list({ namespace: book.metadata.namespace ?? 'default', labels: { 'guestbook.applik8s.dev/book': book.metadata.name } });
    book.status.phase = 'Rendered';
    book.status.entryCount = entries.items.length;
  })],
});
`
      );

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'guestbook',
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
        expect(result.value.manifest.spec.ownedCrds[0]?.kind).toBe('GuestBook');
        const dispatcher = await readFile(join(dir, 'dist', 'bundle', 'handler.js'), 'utf8');
        const generatedDispatcher = await readFile(join(dir, 'dist', 'bundle', 'handler-dispatcher.generated.ts'), 'utf8');
        expect(generatedDispatcher).toContain('const GuestBookEntry = __operator.resources["GuestBookEntry"]');
        // typecast: esbuild owns this emitted metadata and the test inspects only its documented input path map.
        const metafile = JSON.parse(await readFile(join(dir, 'dist', 'bundle', 'handler.esbuild-meta.json'), 'utf8')) as { readonly inputs: Readonly<Record<string, unknown>> };
        expect(Object.keys(metafile.inputs).some((input) => input.includes('/arktype/'))).toBe(false);
        expect(Buffer.byteLength(dispatcher)).toBeLessThan(250_000);
        expect((await stat(result.value.artifacts.handlerWasmPath)).size).toBeLessThan(20_000_000);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('treats embedded HTML, CSS, client JavaScript, and template text as data during static handler serialization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-static-handler-literals-'));

    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(
        entrypoint,
        `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { type } from 'arktype';

const spec = type({ message: 'string' });
const status = type({ phase: "('Published' | 'Rejected')?", message: 'string?' });

export const GuestBookEntry = sdk.crd({ apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'GuestBookEntry', spec, status });
export const guestBook = sdk.operator({
  name: 'guestbook-literals',
  deployment: { namespace: 'demo', replicas: 1 },
  resources: { GuestBookEntry },
  handlers: [GuestBookEntry.on.reconcile((entry) => {
    const escaped = String(entry.spec.message).replace(/</g, '&lt;');
    const html = \`<!doctype html>
      <style>body { font-family: system-ui; } .entry::before { content: "GuestBook"; }</style>
      <article class="entry" data-kind="GuestBookEntry">\${escaped}</article>
      <script>document.addEventListener('DOMContentLoaded', () => console.log('rendered'));</script>\`;
    if (entry.spec.message.includes('http://') || entry.spec.message.includes('https://')) {
      entry.status.phase = 'Rejected';
      entry.status.message = 'Rejected because links are disabled for this GuestBook.';
      return;
    }
    entry.status.phase = 'Published';
    entry.status.message = html;
  })],
});
`
      );

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'guestbook-literals',
        dispatcherMode: 'staticSerializable',
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
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('captures handlers from a transitively imported operator factory without retaining unused authoring dependencies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-imported-operator-factory-'));
    try {
      const helper = join(dir, 'helper.ts');
      const factory = join(dir, 'factory.ts');
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(helper, `export function resolveMessage(message: string, prefix: string): string { return prefix + message.toUpperCase(); }\n`);
      await writeFile(factory, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { resolveMessage } from './helper.js';
const spec = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkSpec' }, schema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } } };
const status = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkStatus' }, schema: { type: 'object', properties: { result: { type: 'string' } } } };
export function createOperator(deps: { prefix: string; authoringGraph: string }) {
  const Work = sdk.crd({ apiVersion: 'factory.applik8s.dev/v1alpha1', kind: 'Work', spec, status });
  return sdk.operator({ name: 'imported-factory', resources: { Work }, handlers: [
    Work.on.reconcile((work) => { work.status.result = resolveMessage(work.spec.message, deps.prefix); }),
  ] });
}
`);
      await writeFile(entrypoint, `import { createOperator } from './factory.js';
export const operator = createOperator({ prefix: 'ready:', authoringGraph: 'UNUSED_AUTHORING_GRAPH_SENTINEL' });
`);

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'imported-factory',
        dispatcherMode: 'staticSerializable',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });

      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const generatedDispatcher = await readFile(join(dir, 'dist', 'bundle', 'handler-dispatcher.generated.ts'), 'utf8');
      expect(generatedDispatcher).toContain('function resolveMessage');
      expect(generatedDispatcher).toContain("{ \"prefix\": ('ready:') }");
      expect(generatedDispatcher).not.toContain('UNUSED_AUTHORING_GRAPH_SENTINEL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('uses defining-module provenance when an unrelated module has the same helper name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-static-helper-collision-'));
    try {
      const helperA = join(dir, 'helper-a.ts');
      const helperB = join(dir, 'helper-b.ts');
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(helperA, `export function ownedMetadata(name: string): string { return 'a:' + name; }\n`);
      await writeFile(helperB, `export function ownedMetadata(name: string): string { return 'b:' + name; }\n`);
      await writeFile(entrypoint, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { ownedMetadata } from './helper-a.js';
import './helper-b.js';
const spec = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkSpec' }, schema: { type: 'object', properties: {} } };
const status = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkStatus' }, schema: { type: 'object', properties: { result: { type: 'string' } } } };
export const Work = sdk.crd({ apiVersion: 'collision.applik8s.dev/v1alpha1', kind: 'Work', spec, status });
export const operator = sdk.operator({ name: 'helper-collision', resources: { Work }, handlers: [
  Work.on.reconcile((work) => { work.status.result = ownedMetadata(work.metadata.name); }),
] });
`);

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'helper-collision',
        dispatcherMode: 'staticSerializable',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const generatedDispatcher = await readFile(join(dir, 'dist', 'bundle', 'handler-dispatcher.generated.ts'), 'utf8');
      expect(generatedDispatcher).toContain("return 'a:' + name");
      expect(generatedDispatcher).not.toContain("return 'b:' + name");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('isolates same-named helpers when both modules are reachable through aliases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-static-helper-aliases-'));
    try {
      const helperA = join(dir, 'helper-a.ts');
      const helperB = join(dir, 'helper-b.ts');
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(helperA, `export function ownedMetadata(name: string): string { return 'a:' + name; }\n`);
      await writeFile(helperB, `export function ownedMetadata(name: string): string { return 'b:' + name; }\n`);
      await writeFile(entrypoint, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { ownedMetadata as ownedA } from './helper-a.js';
import { ownedMetadata as ownedB } from './helper-b.js';
const spec = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkSpec' }, schema: { type: 'object', properties: {} } };
const status = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'WorkStatus' }, schema: { type: 'object', properties: { result: { type: 'string' } } } };
export const Work = sdk.crd({ apiVersion: 'aliases.applik8s.dev/v1alpha1', kind: 'Work', spec, status });
export const operator = sdk.operator({ name: 'helper-aliases', resources: { Work }, handlers: [
  Work.on.reconcile((work: any) => { work.status.result = ownedA(work.metadata.name) + ownedB(work.metadata.name); }),
] });
`);

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'helper-aliases',
        dispatcherMode: 'staticSerializable',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });

      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const generatedDispatcher = await readFile(join(dir, 'dist', 'bundle', 'handler-dispatcher.generated.ts'), 'utf8');
      expect(generatedDispatcher).toContain("return 'a:' + name");
      expect(generatedDispatcher).toContain("return 'b:' + name");
      expect(generatedDispatcher).toContain('ownedA, ownedB');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('reports genuine unsupported static handler captures with actionable diagnostics', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-static-handler-capture-'));
    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(entrypoint, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { type } from 'arktype';
const spec = type({ message: 'string' });
const status = type({ message: 'string?' });
function makeHandler(prefix: string) {
  return (entry: { spec: { message: string }; status: { message?: string } }) => { entry.status.message = prefix + entry.spec.message; };
}
const capturedHandler = makeHandler('external:');
export const Entry = sdk.crd({ apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'Entry', spec, status });
export const captured = sdk.operator({
  name: 'captured', resources: { Entry },
  handlers: [Entry.on.reconcile(capturedHandler)],
});
`);
      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'captured',
        dispatcherMode: 'staticSerializable',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('closure-local identifier(s)');
        expect(result.error.message).toContain('prefix');
        expect(result.error.message).toContain('Move captured values and helper functions to top-level declarations');
      }
    } finally {
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
      const dispatcherTestPath = join(dir, 'dist/bundle/handler-dispatcher.node-test.ts');
      const dispatcherSource = await readFile(dispatcherPath, 'utf8');
      expect(dispatcherSource).toContain("import { kubernetesRead } from 'applik8s:handler/kubernetes';");
      await writeFile(dispatcherTestPath, dispatcherSource.replace("import { kubernetesRead } from 'applik8s:handler/kubernetes';\n", "const kubernetesRead = () => { throw new Error('unexpected kubernetes-read'); };\n"));
      // static-import-exception: this test loads a compiler-generated dispatcher from a temporary output directory.
      const dispatcher = await import(`${pathToFileURL(dispatcherTestPath).href}?case=handler-error`);
      await expect(dispatcher.handle(JSON.stringify({
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
      }))).rejects.toMatch(/synthetic handler failure/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('preserves nested status object fields by name through generated dispatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-nested-status-dispatch-'));
    try {
      const entrypoint = join(dir, 'operator-entry.ts');
      await writeFile(entrypoint, `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface VolumeSpec { source: string }
interface VolumeStatus { volumes?: Array<{ conditions?: Array<{ type: string; status: string; observedGeneration?: number; lastTransitionTime?: string }> }> }
const spec = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'VolumeSpec' }, schema: { type: 'object', required: ['source'], properties: { source: { type: 'string' } } } };
const status = { kind: 'jsonSchema' as const, ref: { kind: 'jsonSchema' as const, exportName: 'VolumeStatus' }, schema: { type: 'object', properties: { volumes: { type: 'array', items: { type: 'object', properties: { conditions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, status: { type: 'string' }, observedGeneration: { type: 'integer' }, lastTransitionTime: { type: 'string' } } } } } } } } } };
export const VolumeJob = sdk.crd<VolumeSpec, VolumeStatus>({ apiVersion: 'storage.applik8s.dev/v1alpha1', kind: 'VolumeJob', spec, status });
export const operator = sdk.operator({ name: 'nested-status', resources: { VolumeJob }, handlers: [
  VolumeJob.on.reconcile((job) => { job.status.volumes = [{ conditions: [{ type: 'Ready', status: 'True', observedGeneration: 17, lastTransitionTime: '2026-07-14T12:34:56Z' }] }]; }),
] });
`);

      const result = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'nested-status',
        dispatcherMode: 'staticSerializable',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: false, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const dispatcherPath = join(dir, 'dist/bundle/handler-dispatcher.generated.ts');
      const dispatcherTestPath = join(dir, 'dist/bundle/handler-dispatcher.node-test.ts');
      const dispatcherSource = await readFile(dispatcherPath, 'utf8');
      await writeFile(dispatcherTestPath, dispatcherSource.replace("import { kubernetesRead } from 'applik8s:handler/kubernetes';\n", "const kubernetesRead = () => { throw new Error('unexpected kubernetes-read'); };\n"));
      // static-import-exception: this test loads a compiler-generated dispatcher from a temporary output directory.
      const dispatcher = await import(`${pathToFileURL(dispatcherTestPath).href}?case=nested-status`);
      const output = JSON.parse(await dispatcher.handle(JSON.stringify({
        abiVersion: 'applik8s.handler/v1alpha1',
        handlerId: 'VolumeJob.reconcile.0',
        event: 'reconcile',
        object: { apiVersion: 'storage.applik8s.dev/v1alpha1', kind: 'VolumeJob', metadata: { name: 'volume-a', namespace: 'storage' }, spec: { source: 'source-a' } },
        runtime: { reconcileId: 'VolumeJob-volume-a' },
      })));
      const statusOperation = output.operations.find((operation: { readonly kind?: string }) => operation.kind === 'status');
      expect(statusOperation?.status?.volumes?.[0]?.conditions?.[0]).toEqual({
        type: 'Ready',
        status: 'True',
        observedGeneration: 17,
        lastTransitionTime: '2026-07-14T12:34:56Z',
      });
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
      expect(result.value.manifest.spec.container?.baseImage).toMatchObject({
        registry: 'ghcr.io',
        repository: 'yehudacohen/applik8s-operator-host',
        tag: 'v0.6.0',
      });
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
        'applik8s.dev/host-imports': 'capability-request,kubernetes-read,log,cancel,wasi:cli,wasi:clocks,wasi:filesystem,wasi:io,wasi:random,wasi:http,wasi:sockets',
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
      expect(deployment.spec.template.spec.securityContext).toEqual({
        runAsNonRoot: true,
        runAsUser: 65532,
        runAsGroup: 65532,
        seccompProfile: { type: 'RuntimeDefault' },
      });
      expect(deployment.spec.template.spec.volumes).toEqual([{ name: 'tmp', emptyDir: {} }]);
      expect(deployment.spec.template.spec.terminationGracePeriodSeconds).toBe(45);
      expect(container.image).toMatch(/^applik8s\/image-pipeline-operator:[a-f0-9]{12}$/);
      expect(container.securityContext).toEqual({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ['ALL'] },
      });
      expect(container.volumeMounts).toEqual([{ name: 'tmp', mountPath: '/tmp' }]);
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
      expect(container.startupProbe).toMatchObject({
        httpGet: { path: '/healthz', port: 'health' },
        failureThreshold: 36,
        periodSeconds: 5,
        timeoutSeconds: 5,
      });
      expect(container.livenessProbe.httpGet).toEqual({ path: '/healthz', port: 'health' });
      expect(container.livenessProbe).toMatchObject({ initialDelaySeconds: 60, failureThreshold: 12, periodSeconds: 10, timeoutSeconds: 5 });
      expect(container.readinessProbe.httpGet).toEqual({ path: '/readyz', port: 'health' });
      expect(container.readinessProbe).toMatchObject({ initialDelaySeconds: 1, failureThreshold: 12, periodSeconds: 5, timeoutSeconds: 5 });
      expect(container.resources).toEqual({
        requests: { cpu: '100m', memory: '128Mi' },
        limits: { cpu: '1', memory: '1Gi' },
      });
      expect(result.value.manifest.spec.bundle.artifacts).toContainEqual(expect.objectContaining({ kind: 'javascript-source-map', path: result.value.artifacts.sourceMapPath }));
      expect(result.value.manifest.spec.bundle.artifacts).toContainEqual(expect.objectContaining({ kind: 'esbuild-metafile' }));
      const dockerfile = await readFile(result.value.artifacts.generatedImageDockerfilePath ?? '', 'utf8');
      expect(dockerfile).toContain(
        'ARG APPLIK8S_BASE_IMAGE=ghcr.io/yehudacohen/applik8s-operator-host:v0.6.0',
      );
      expect(dockerfile).toContain(['FROM $', '{APPLIK8S_BASE_IMAGE}'].join(''));
      expect(dockerfile).toContain('COPY --chown=65532:65532 operator-manifest.json /etc/applik8s/operator-manifest.json');
      expect(dockerfile).toContain('COPY --chown=65532:65532 wasm/handler.wasm /handler/handler.wasm');
      expect(dockerfile).toContain('COPY --chown=65532:65532 bundle/handler.js /handler/handler.js');
      expect(dockerfile).toContain('COPY --chown=65532:65532 bundle/handler.js.map /handler/handler.js.map');
      expect(dockerfile.trimEnd().endsWith('USER 65532:65532')).toBe(true);
      const applyScript = await readFile(result.value.artifacts.generatedApplyScriptPath ?? '', 'utf8');
      expect(applyScript).toContain('docker}');
      expect(applyScript).toContain('kubectl}');
      expect(applyScript).toContain('Dockerfile.applik8s-runtime');
      expect(applyScript).toContain('--build-arg "APPLIK8S_BASE_IMAGE=$BASE_IMAGE"');
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
  }, 120_000);

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
      const bundledExecution = await execFileAsync(process.execPath, ['--input-type=module', '--eval', `const module = await import(${JSON.stringify(pathToFileURL(bundle.value.javascriptBundlePath).href)}); process.stdout.write(module.handle('ready'));`]);
      expect(bundledExecution.stdout).toBe('ready!');
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
      expect(manifest.value.spec.adapterRequirements?.hostImports).toEqual(['capability-request', 'kubernetes-read', 'log', 'cancel', 'wasi:cli', 'wasi:clocks', 'wasi:filesystem', 'wasi:io', 'wasi:random', 'wasi:http', 'wasi:sockets']);
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

      const invalidExactAndSelectorWatch = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{
            apiVersion: ImageJob.apiVersion,
            kind: ImageJob.kind,
            scope: 'Namespaced',
            name: 'hero',
            labelSelector: { matchLabels: { app: 'image' } },
            events: ['reconcile'],
            handlers: [firstHandler.id],
          }],
        },
      });
      const invalidClusterNamespaceWatch = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{
            apiVersion: ImageJob.apiVersion,
            kind: ImageJob.kind,
            scope: 'Cluster',
            namespace: 'media',
            events: ['reconcile'],
            handlers: [firstHandler.id],
          }],
        },
      });
      const invalidFieldSelectorWatch = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{
            apiVersion: ImageJob.apiVersion,
            kind: ImageJob.kind,
            scope: 'Namespaced',
            fieldSelector: 'spec.priority=high',
            events: ['reconcile'],
            handlers: [firstHandler.id],
          }],
        },
      });
      const invalidLabelSelectorWatch = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{
            apiVersion: ImageJob.apiVersion,
            kind: ImageJob.kind,
            scope: 'Namespaced',
            labelSelector: JSON.parse('{"matchExpressions":[{"key":"app","operator":"Exists","values":{"not":"an-array"}}]}'),
            events: ['reconcile'],
            handlers: [firstHandler.id],
          }],
        },
      });
      const emptyLabelSelectorWatch = validateOperatorManifest({
        ...manifest.value,
        spec: {
          ...manifest.value.spec,
          watches: [{
            apiVersion: ImageJob.apiVersion,
            kind: ImageJob.kind,
            scope: 'Namespaced',
            labelSelector: { matchLabels: {} },
            events: ['reconcile'],
            handlers: [firstHandler.id],
          }],
        },
      });

      expect(invalidExactAndSelectorWatch.ok).toBe(false);
      if (!invalidExactAndSelectorWatch.ok) {
        expect(invalidExactAndSelectorWatch.error.message).toContain('must not combine exact name/names scope with selector scope');
      }
      expect(invalidClusterNamespaceWatch.ok).toBe(false);
      if (!invalidClusterNamespaceWatch.ok) {
        expect(invalidClusterNamespaceWatch.error.message).toContain('cluster-scoped and must not declare namespace');
      }
      expect(invalidFieldSelectorWatch.ok).toBe(false);
      if (!invalidFieldSelectorWatch.ok) {
        expect(invalidFieldSelectorWatch.error.message).toContain('fieldSelector field spec.priority is not supported');
      }
      expect(invalidLabelSelectorWatch.ok).toBe(false);
      if (!invalidLabelSelectorWatch.ok) {
        expect(invalidLabelSelectorWatch.error.message).toContain('labelSelector Exists expressions must not declare values');
      }
      expect(emptyLabelSelectorWatch.ok).toBe(false);
      if (!emptyLabelSelectorWatch.ok) {
        expect(emptyLabelSelectorWatch.error.message).toContain('labelSelector must not be empty');
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
        expect(deployment?.spec.template.spec.containers[0].volumeMounts).toEqual([{ name: 'tmp', mountPath: '/tmp' }]);
        expect(deployment?.spec.template.spec.volumes).toEqual([{ name: 'tmp', emptyDir: {} }]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

});
