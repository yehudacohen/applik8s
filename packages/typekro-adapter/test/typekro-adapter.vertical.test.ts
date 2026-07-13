import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOperatorManifest, compileTypeKroComposition, createCompilerPipeline } from '@applik8s/compiler';
import type { JsonObject, OperatorDefinition, OperatorManifest } from '@applik8s/core';
import type { CallableOperator } from '@applik8s/sdk';
import { dispatchOperatorHandler, sdk } from '@applik8s/sdk';
import { createHandlerProxyRecorder } from '@applik8s/testing';
import { type as arkType } from 'arktype';
import { describe, expect, it } from 'vitest';
import { ImageJob as GoldenPathImageJob, imagePipeline as goldenPathImagePipeline } from '../../../examples/imagejob.js';
import type { TypeKroGraph } from '../src/index.js';
import { asComposition, asOperationTargetFactory, createGraphAdapter, toOperationTarget, typeKro } from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
  readonly formats: readonly string[];
}

interface ImageStatus {
  readonly phase: 'Pending' | 'Processing' | 'Complete' | 'Failed';
  readonly outputUrls: readonly string[];
}

interface ArkConfigSpec {
  readonly mode: 'fast' | 'safe';
  readonly enabled: true;
  readonly weight: number | null;
  readonly labels: Readonly<Record<string, string>>;
  readonly targets: readonly string[];
  readonly nested: { readonly ready: boolean };
}

interface OperatorContainerProjection {
  readonly ports?: readonly JsonObject[];
  readonly env?: readonly JsonObject[];
  readonly startupProbe?: { readonly httpGet?: JsonObject };
  readonly livenessProbe?: { readonly httpGet?: JsonObject };
  readonly readinessProbe?: { readonly httpGet?: JsonObject };
}

interface ResourceProjection {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly resourceOwnership?: string;
}

const imageSpecSchema: JsonObject = {
  type: 'object',
  properties: {
    sourceUrl: { type: 'string' },
    formats: { type: 'array', items: { type: 'string' } },
  },
  required: ['sourceUrl', 'formats'],
  additionalProperties: false,
};

const imageStatusSchema: JsonObject = {
  type: 'object',
  properties: {
    phase: { type: 'string', enum: ['Pending', 'Processing', 'Complete', 'Failed'] },
    outputUrls: { type: 'array', items: { type: 'string' } },
  },
  required: ['phase', 'outputUrls'],
  additionalProperties: false,
};

const tenantSchema: JsonObject = { type: 'object' };

// typecast: the vertical test uses a minimal graph-shaped fixture rather than constructing a full TypeKro graph factory.
const graph = {
  name: 'tenant-stack',
  resources: [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'tenant-app', namespace: 'tenants' },
      spec: { replicas: 2 },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'tenant-app', namespace: 'tenants' },
      spec: { ports: [{ port: 80 }] },
    },
  ],
  factory(mode: 'direct' | 'kro') {
    return { mode };
  },
  toYaml() {
    return '';
  },
} as unknown as TypeKroGraph;

const dependencyGraphEdges: Readonly<Record<string, readonly string[]>> = {
  namespace: [],
  database: ['namespace'],
  app: ['database'],
};

// typecast: this fixture models the TypeKro dependencyGraph methods used by the adapter without needing a live TypeKro deployment factory.
const dependencyOrderedGraph = {
  name: 'dependency-ordered-stack',
  resources: [
    {
      id: 'namespace',
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'tenant-a' },
    },
    {
      id: 'app',
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'tenant-app', namespace: 'tenant-a' },
      spec: { replicas: 1 },
    },
    {
      id: 'database',
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Cluster',
      metadata: { name: 'tenant-db', namespace: 'tenant-a' },
      spec: { instances: 1 },
    },
  ],
  dependencyGraph: {
    getTopologicalOrder() {
      return ['namespace', 'database', 'app'];
    },
    getDependencies(id: string) {
      return [...(dependencyGraphEdges[id] ?? [])];
    },
  },
  factory(mode: 'direct' | 'kro') {
    return { mode };
  },
  toYaml() {
    return '';
  },
} as unknown as TypeKroGraph;

describe('TypeKro adapter operation targets', () => {
  it('consumes the canonical ImageJob golden path as a TypeKro install composition', () => {
    const manifest = buildOperatorManifest({
      operator: goldenPathImagePipeline.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) {
      return;
    }

    const result = asComposition(goldenPathImagePipeline.definition, manifest.value, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const installed = result.value({ namespace: 'media', replicas: 1 });
      const image = installed.imageJob({
        name: 'hero-image',
        spec: {
          endpoint: 'http://ministack.media.svc.cluster.local:4566',
          region: 'us-east-1',
          sourceBucket: 'images',
          sourceKey: 'hero.png',
          outputBucket: 'processed',
          formats: ['webp'],
          priority: 'normal',
        },
      });

      expect(result.value.crdFactories.ImageJob).toBeTypeOf('function');
      expect(result.value.crdFactories.imageJob).toBeTypeOf('function');
      expect(image.kind).toBe(GoldenPathImageJob.kind);
      expect(image.metadata.namespace).toBe('media-system');
      expect(result.value.resources.some((resource) => resource.kind === 'Deployment')).toBe(true);
    }
  });

  it('adapts an applik8s operator into a callable TypeKro install composition', () => {
    const { operator, manifest } = imageOperatorFixture();

    const result = asComposition(operator, manifest, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const composition = result.value;
      const instance = composition({ namespace: 'media', replicas: 1 });
      const imageJobFactory = instance.crdFactories.imageJob;
      if (!imageJobFactory) {
        throw new Error('Expected imageJob CRD factory alias to be present.');
      }
      const imageJob = imageJobFactory({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } });

      expect(composition.operator).toBe(operator);
      expect(composition.manifest).toBe(manifest);
      expect(composition.crdFactories.ImageJob).toBeTypeOf('function');
      expect(instance.crdFactories.imageJob).toBeTypeOf('function');
      expect(imageJob.kind).toBe('ImageJob');
      expect(imageJob.metadata.namespace).toBe('media-system');
      expect(composition.resources.some((resource) => resource.kind === 'Deployment')).toBe(true);
      const deployment = composition.resources.find((resource) => resource.kind === 'Deployment');
      expect(deployment?.metadata.annotations).toMatchObject({
        'applik8s.dev/bundle-digest': manifest.spec.bundle.digest,
        'applik8s.dev/source-digest': manifest.spec.bundle.sourceDigest,
        'applik8s.dev/compiler-version': manifest.spec.bundle.compilerVersion,
        'applik8s.dev/handler-abi': 'applik8s.handler/v1alpha1',
        'applik8s.dev/requires-runtime': '^0.1.0',
        'applik8s.dev/handler-timeout-seconds': '30',
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
        'applik8s.dev/rbac-mode': manifest.spec.security.rbac.mode,
        'applik8s.dev/rbac-least-privilege-reviewed': String(manifest.spec.security.rbac.leastPrivilegeReviewed),
        'applik8s.dev/rbac-rule-count': String(manifest.spec.security.rbac.rules.length),
        'applik8s.dev/host-imports': 'capability-request,kubernetes-read,log,cancel,wasi:cli,wasi:clocks,wasi:filesystem,wasi:io,wasi:random,wasi:http,wasi:sockets',
        'applik8s.dev/capabilities': '',
        'applik8s.dev/capability-kinds': '',
        'applik8s.dev/capability-protocols': '',
        'applik8s.dev/capability-live-execution': 'disabled',
        'applik8s.dev/capability-redaction': 'none',
        'applik8s.dev/capability-idempotency': 'none',
        'applik8s.dev/ambient-environment': 'denied',
        'applik8s.dev/ambient-filesystem': 'denied',
        'applik8s.dev/ambient-network': 'denied',
        'applik8s.dev/embedded-secret-material': 'denied',
        'applik8s.dev/local-credential-paths': 'denied',
        'applik8s.dev/unsupported-native-modules': 'denied',
      });
      expect(composition.factory('direct')).toBeTruthy();
      expect(composition.factory('kro')).toBeTruthy();
      const kroYaml = composition.factory('kro').toYaml();
      expect(kroYaml).toContain('replicas: integer');
      expect(kroYaml).toContain('has(schema.spec.replicas) ? schema.spec.replicas : 1');
    }
  });

  it('mirrors runtime replay and probe env in the TypeKro operator Deployment', () => {
    const { operator, manifest } = imageOperatorFixture(imageSpecSchema, {
      leaderElection: { enabled: false, leaseName: 'image-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
      concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
      rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
      health: { enabled: true, path: '/healthz', port: 8080 },
      metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
      handlerTimeoutSeconds: 30,
      replayArtifacts: { enabled: true, directory: '/tmp/applik8s-replay' },
    });

    const result = asComposition(operator, manifest, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const deployment = result.value.resources.find((resource) => resource.kind === 'Deployment');
      // typecast: TypeKro composition resources are intentionally erased to JSON objects; this test asserts the generated Deployment shape.
      const deploymentSpec = deployment?.spec as { readonly template?: { readonly spec?: { readonly containers?: readonly OperatorContainerProjection[] } } } | undefined;
      const container = deploymentSpec?.template?.spec?.containers?.[0];

      expect(container?.ports).toContainEqual({ name: 'health', containerPort: 8080 });
      expect(container?.env).toContainEqual({ name: 'APPLIK8S_HEALTH_ADDR', value: '0.0.0.0:8080' });
      expect(container?.env).toContainEqual({ name: 'APPLIK8S_HANDLER_TIMEOUT_SECONDS', value: '30' });
      expect(container?.env).toContainEqual({ name: 'APPLIK8S_REPLAY_ARTIFACT_DIR', value: '/tmp/applik8s-replay' });
      expect(container?.env).not.toContainEqual({ name: 'APPLIK8S_REPLAY_INCLUDE_PAYLOADS', value: '1' });
      expect(container?.startupProbe).toMatchObject({
        httpGet: { path: '/healthz', port: 'health' },
        failureThreshold: 36,
        periodSeconds: 5,
        timeoutSeconds: 5,
      });
      expect(container?.livenessProbe?.httpGet).toEqual({ path: '/healthz', port: 'health' });
      expect(container?.livenessProbe).toMatchObject({ initialDelaySeconds: 60, failureThreshold: 12, periodSeconds: 10, timeoutSeconds: 5 });
      expect(container?.readinessProbe?.httpGet).toEqual({ path: '/readyz', port: 'health' });
      expect(container?.readinessProbe).toMatchObject({ initialDelaySeconds: 1, failureThreshold: 12, periodSeconds: 5, timeoutSeconds: 5 });
    }
  });

  it('builds generated operator install infrastructure on existing TypeKro Kubernetes factories', async () => {
    const source = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain("from 'typekro/kubernetes'");
    expect(source).toContain('customResourceDefinition as typeKroCustomResourceDefinition');
    expect(source).toContain('serviceAccount as typeKroServiceAccount');
    expect(source).toContain('clusterRoleBinding as typeKroClusterRoleBinding');
    expect(source).toContain('deployment as typeKroDeployment');
    expect(source).toContain('function createKnownInstallResource');
    expect(source).toContain('return withInstallReadiness(resource, createResource(');
  });

  it('fails closed when TypeKro install specs request multiple operator replicas', () => {
    const { operator, manifest } = imageOperatorFixture();
    const result = asComposition(operator, manifest, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => result.value({ namespace: 'media', replicas: 2 })).toThrow('runtime.leaderElection.enabled');
    }
  });

  it('allows TypeKro install specs to request multiple replicas with leader election enabled', () => {
    const { operator, manifest } = imageOperatorFixture(imageSpecSchema, {
      leaderElection: { enabled: true, leaseName: 'image-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
      concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
      rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
      health: { enabled: true, path: '/healthz', port: 8080 },
      metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
    });
    const result = asComposition(operator, manifest, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const instance = result.value({ namespace: 'media', replicas: 2 });
      const deployment = result.value.resources.find((resource) => resource.kind === 'Deployment');
      // typecast: TypeKro composition resources are JSON-erased; this test asserts the generated Deployment projection.
      const deploymentSpec = deployment?.spec as { readonly replicas?: number; readonly template?: { readonly spec?: { readonly containers?: readonly OperatorContainerProjection[] } } } | undefined;
      const role = result.value.resources.find((resource) => resource.kind === 'Role');

      expect(instance.crdFactories.imageJob).toBeTypeOf('function');
      expect(String(deploymentSpec?.replicas)).toMatch(/schema.*spec\.replicas/);
      expect(deploymentSpec?.template?.spec?.containers?.[0]?.env).toContainEqual({ name: 'APPLIK8S_LEADER_ELECTION_IDENTITY', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } });
      expect(role?.rules).toContainEqual({ apiGroups: ['coordination.k8s.io'], resources: ['leases'], verbs: ['get', 'update', 'patch'], resourceNames: ['image-pipeline'] });
      expect(role?.rules).toContainEqual({ apiGroups: ['coordination.k8s.io'], resources: ['leases'], verbs: ['create'] });
    }
  });

  it('fails closed when TypeKro install synthesis sees unsupported runtime concurrency', () => {
    const { operator, manifest } = imageOperatorFixture();
    const unsafeManifest = {
      ...manifest,
      spec: {
        ...manifest.spec,
        runtime: {
          leaderElection: { enabled: false, leaseName: 'image-pipeline', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
          concurrency: { workerCount: 2, maxInFlightPerResource: 1 },
          rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
          health: { enabled: true, path: '/healthz', port: 8080 },
          metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
        },
      },
    } satisfies OperatorManifest;

    const result = asComposition(operator, unsafeManifest, { compositionName: 'image-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('runtime.concurrency.workerCount');
    }
  });

  it('fails closed when TypeKro install synthesis sees an invalid CRD schema', () => {
    const { operator, manifest } = imageOperatorFixture({
      type: 'object',
      properties: {
        'bad.name': { type: 'string' },
      },
    });

    const result = asComposition(operator, manifest, { compositionName: 'invalid-schema-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Kubernetes-compatible JSON field name');
    }
  });

  it('uses the shared Kubernetes structural schema gate for TypeKro CRD synthesis', () => {
    const cases: readonly { readonly name: string; readonly schema: JsonObject; readonly message: string }[] = [
      {
        name: 'missing-required-property',
        schema: { type: 'object', required: ['sourceUrl'], properties: {} },
        message: 'required includes sourceUrl',
      },
      {
        name: 'tuple-array',
        schema: { type: 'object', properties: { targets: { type: 'array', items: [{ type: 'string' }] } } },
        message: 'items must be a schema object',
      },
      {
        name: 'nullable-without-type',
        schema: { type: 'object', properties: { maybe: { nullable: true } } },
        message: 'nullable requires an explicit type',
      },
      {
        name: 'unsupported-default',
        schema: { type: 'object', properties: { sourceUrl: { type: 'string', default: 's3://bucket/image.png' } } },
        message: 'default is not supported',
      },
      {
        name: 'empty-nested-object',
        schema: { type: 'object', properties: { config: { type: 'object' } } },
        message: 'object must declare properties or additionalProperties',
      },
      {
        name: 'preserve-unknown-fields',
        schema: { type: 'object', properties: { config: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true, additionalProperties: true } } },
        message: 'unsupported JSON Schema keyword x-kubernetes-preserve-unknown-fields',
      },
    ];

    for (const testCase of cases) {
      const { operator, manifest } = imageOperatorFixture(testCase.schema);

      const result = asComposition(operator, manifest, { compositionName: `invalid-${testCase.name}`, defaultNamespace: 'media-system' });

      expect(result.ok, testCase.name).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain(testCase.message);
      }
    }
  });

  it('preserves ArkType-normalized structural schemas through TypeKro CRD synthesis', () => {
    const ArkConfig = sdk.crd<ArkConfigSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ArkConfig',
      spec: arkType({
        mode: "'fast' | 'safe'",
        enabled: 'true',
        weight: 'number | null',
        labels: 'Record<string, string>',
        targets: 'string[]',
        nested: { ready: 'boolean' },
      }),
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageStatus' }, schema: imageStatusSchema },
      statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' },
    });
    const operator = sdk.operator({ name: 'arktype-typekro-pipeline', deployment: { namespace: 'media-system' }, resources: { ArkConfig }, handlers: [] });
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

    const result = asComposition(operator.definition, manifest.value, { compositionName: 'arktype-typekro-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const crd = result.value.resources.find((resource) => resource.kind === 'CustomResourceDefinition');
      // typecast: TypeKro composition resources are JSON-erased; this test asserts the generated CRD schema projection.
      const specSchema = (crd?.spec as { readonly versions?: readonly { readonly schema?: { readonly openAPIV3Schema?: { readonly properties?: { readonly spec?: JsonObject } } } }[] } | undefined)?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.spec;
      // typecast: TypeKro composition resources are JSON-erased; this test asserts the generated CRD status schema projection.
      const statusSchema = (crd?.spec as { readonly versions?: readonly { readonly schema?: { readonly openAPIV3Schema?: { readonly properties?: { readonly status?: JsonObject } } } }[] } | undefined)?.versions?.[0]?.schema?.openAPIV3Schema?.properties?.status;
      expect(specSchema?.properties).toMatchObject({
        mode: { enum: ['fast', 'safe'], type: 'string' },
        enabled: { enum: [true], type: 'boolean' },
        weight: { type: 'number', nullable: true },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
        targets: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } },
      });
      expect(statusSchema?.properties).toMatchObject({
        observedGeneration: { type: 'integer', format: 'int64' },
        conditions: expect.objectContaining({ type: 'array', 'x-kubernetes-list-type': 'map', 'x-kubernetes-list-map-keys': ['type'] }),
      });
      expect(JSON.stringify(statusSchema)).toContain('"True"');
      expect(JSON.stringify(statusSchema)).toContain('"False"');
      expect(JSON.stringify(statusSchema)).toContain('"Unknown"');
    }
  });

  it('fails closed for unsafe ArkType mixed unions during TypeKro CRD synthesis', () => {
    const UnsafeArkConfig = sdk.crd<{ readonly value: string | number }, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'UnsafeArkConfig',
      spec: arkType({ value: 'string | number' }),
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageStatus' }, schema: imageStatusSchema },
    });
    const operator = sdk.operator({ name: 'unsafe-arktype-typekro-pipeline', deployment: { namespace: 'media-system' }, resources: { UnsafeArkConfig }, handlers: [] });
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

    const result = asComposition(operator.definition, manifest.value, { compositionName: 'unsafe-arktype-typekro-pipeline', defaultNamespace: 'media-system' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('composition keywords');
    }
  });

  it('renders TypeKro graph resources into applik8s operation plans', () => {
    const adapter = createGraphAdapter({ fieldManager: 'tenant-operator' });

    const rendered = adapter.render(graph, { tenant: 'acme' });

    expect(rendered.ok).toBe(true);
    if (rendered.ok) {
      expect(rendered.value.operations).toEqual([
        { kind: 'apply', fieldManager: 'tenant-operator', resource: graph.resources[0] },
        { kind: 'apply', fieldManager: 'tenant-operator', resource: graph.resources[1] },
      ]);
    }
  });

  it('maps TypeKro graph status projections into handler status', () => {
    // typecast: the test uses a minimal graph-like fixture with a status projection instead of constructing a full TypeKro graph runtime.
    const statusGraph = {
      ...graph,
      status: {
        ready: true,
        observedGeneration: 3,
        endpoint: 'https://tenant.example.test',
      },
    } as unknown as TypeKroGraph<JsonObject, { readonly ready: boolean; readonly observedGeneration: number; readonly endpoint: string }>;
    const adapter = createGraphAdapter<JsonObject, { readonly ready: boolean; readonly observedGeneration: number; readonly endpoint: string }, { readonly phase: 'Ready' | 'Provisioning'; readonly observedGeneration: number; readonly url?: string }>({
      statusMapper: (status) => ({
        phase: status.ready ? 'Ready' : 'Provisioning',
        observedGeneration: status.observedGeneration ?? 0,
        ...(status.endpoint ? { url: status.endpoint } : {}),
      }),
    });

    const rendered = adapter.renderStatus(statusGraph, { tenant: 'acme' });

    expect(rendered).toEqual({
      ok: true,
      value: {
        phase: 'Ready',
        observedGeneration: 3,
        url: 'https://tenant.example.test',
      },
    });
  });

  it('wraps TypeKro graphs as apply/delete operation targets', () => {
    const target = toOperationTarget(graph, { tenant: 'acme' }, { fieldManager: 'tenant-operator' });

    expect(target.targetKind).toBe('operationTarget');
    expect(target.contract).toMatchObject({
      id: 'operation-target.tenant-stack',
      operations: ['apply', 'delete'],
      execution: { contexts: expect.arrayContaining(['handler', 'generatedServer', 'generatedJob', 'typeKro']), ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' },
      lowering: { mode: 'typeKroResource', failurePolicy: 'failClosed' },
      dryRun: { supported: true, failurePolicy: 'failClosed' },
      ownership: { ownerReferences: 'optional', orphanPolicy: 'retain' },
      finalizers: { required: false, cleanupOperation: 'deleteTarget' },
    });
    expect(target.contract.lowering?.artifact).toMatchObject({ kind: 'typeKroResource', path: 'plans/operation-target.tenant-stack.apply.json' });
    expect(target.contract.dryRun.artifact).toMatchObject({ kind: 'typeKroResource', path: 'plans/operation-target.tenant-stack.dry-run.json' });
    expect(target.operationTargetArtifacts.applyPlan.operations.map((operation) => operation.kind)).toEqual(['apply', 'apply']);
    expect(target.operationTargetArtifacts.deletePlan.operations.map((operation) => operation.kind)).toEqual(['delete', 'delete']);
    expect(target.operationTargetArtifacts.dryRunPlan?.operations.map((operation) => operation.kind)).toEqual(['apply', 'apply']);
    expect(Object.hasOwn(target, '__applik8sApplyResources')).toBe(false);
    expect(Object.hasOwn(target, '__applik8sDeleteRefs')).toBe(false);
    const owner = { apiVersion: 'infra.applik8s.dev/v1alpha1', kind: 'Tenant', name: 'acme', uid: 'tenant-uid' };
    const apply = target.adapter.renderApply(target, { fieldManager: 'override-manager', force: true, owner });
    const deletion = target.adapter.renderDelete(target);

    expect(apply.ok).toBe(true);
    expect(deletion.ok).toBe(true);
    if (apply.ok && deletion.ok) {
      expect(apply.value.operations[0]).toMatchObject({ kind: 'apply', fieldManager: 'override-manager', force: true, ownership: { mode: 'reference', ref: owner } });
      expect(deletion.value.operations).toEqual([
        { kind: 'delete', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'tenant-app', namespace: 'tenants' } },
        { kind: 'delete', ref: { apiVersion: 'v1', kind: 'Service', name: 'tenant-app', namespace: 'tenants' } },
      ]);
    }
  });

  it('exposes vision-shaped TypeKro operation target aliases', () => {
    const target = typeKro.operationTarget(graph, { tenant: 'acme' }, { fieldManager: 'tenant-operator' });
    const tenantStack = typeKro.targetFactory(dependencyOrderedGraph);
    const deletionTarget = tenantStack({ tenant: 'acme' });
    const adapter = typeKro.graphAdapter({ fieldManager: 'tenant-operator' });

    const apply = target.adapter.renderApply(target);
    const deletion = deletionTarget.adapter.renderDelete(deletionTarget, { propagationPolicy: 'Foreground' });
    const rendered = adapter.render(graph, { tenant: 'acme' });

    expect(typeKro.composition).toBe(asComposition);
    expect(apply.ok).toBe(true);
    expect(deletion.ok).toBe(true);
    expect(rendered.ok).toBe(true);
    if (apply.ok && deletion.ok && rendered.ok) {
      expect(apply.value.operations).toEqual(rendered.value.operations);
      expect(deletion.value.operations.map((operation) => operation.kind)).toEqual(['delete', 'delete', 'delete']);
    }
  });

  it('deletes TypeKro operation targets in reverse topological order when a dependency graph is available', () => {
    const target = toOperationTarget(dependencyOrderedGraph, { tenant: 'acme' });

    const deletion = target.adapter.renderDelete(target, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });

    expect(deletion.ok).toBe(true);
    if (deletion.ok) {
      expect(deletion.value.operations).toEqual([
        { kind: 'delete', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'tenant-app', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
        { kind: 'delete', ref: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'tenant-db', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
        { kind: 'delete', ref: { apiVersion: 'v1', kind: 'Namespace', name: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      ]);
    }
  });

  it('preserves reverse topological target delete order through finalizer handler normalization', () => {
    const target = toOperationTarget(dependencyOrderedGraph, { tenant: 'acme' });
    const recorder = createHandlerProxyRecorder(
      {
        apiVersion: 'platform.applik8s.dev/v1alpha1',
        kind: 'Tenant',
        metadata: { name: 'tenant-a', namespace: 'platform' },
        spec: {},
        status: {},
      },
      { event: 'finalize' }
    );

    recorder.scope.finalizers.add('platform.applik8s.dev/tenant');
    recorder.scope.delete(target, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });
    recorder.scope.finalizers.remove('platform.applik8s.dev/tenant');

    expect(recorder.normalizedPlan().operations).toEqual([
      { kind: 'finalizer', operation: 'add', finalizer: 'platform.applik8s.dev/tenant' },
      { kind: 'delete', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'tenant-app', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'delete', ref: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'tenant-db', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'delete', ref: { apiVersion: 'v1', kind: 'Namespace', name: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'finalizer', operation: 'remove', finalizer: 'platform.applik8s.dev/tenant' },
    ]);
  });

  it('preserves reverse topological target delete order through generated handler dispatch', async () => {
    const tenantResource = {
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'Tenant',
      plural: 'tenants',
      scope: 'Namespaced',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'TenantSpec' }, schema: tenantSchema },
      statusSubresource: false,
      versions: [],
      permissions: { read: [], write: [], status: [], finalizers: [] },
      eventMetadata: [],
    };
    // typecast: this test only needs the erased runtime shape consumed by dispatchOperatorHandler, not the full callable CRD factory surface.
    const tenantOperator = {
      name: 'tenant-operator',
      resources: { Tenant: tenantResource },
      handlers: [
        {
          id: 'Tenant.finalize.0',
          event: 'finalize',
          resource: tenantResource,
          handlerStyle: 'proxy',
          handler(tenant: { readonly metadata: { readonly name: string }; readonly finalizers: { add(finalizer: string): void; remove(finalizer: string): void }; delete(target: unknown, options: { readonly propagationPolicy: 'Foreground'; readonly gracePeriodSeconds: 5 }): void }) {
            const target = toOperationTarget(dependencyOrderedGraph, { tenant: tenant.metadata.name });
            tenant.finalizers.add('platform.applik8s.dev/tenant');
            tenant.delete(target, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });
            tenant.finalizers.remove('platform.applik8s.dev/tenant');
          },
        },
      ],
      trustLevel: 'trustedApplication',
      effects: { mode: 'planned', replayable: true },
    } as unknown as OperatorDefinition;
    const handlerId = tenantOperator.handlers[0]?.id;
    if (!handlerId) {
      throw new Error('Expected handler registration.');
    }

    const outputJson = await dispatchOperatorHandler(tenantOperator, JSON.stringify({
      handlerId,
      event: 'finalize',
      object: {
        apiVersion: 'platform.applik8s.dev/v1alpha1',
        kind: 'Tenant',
        metadata: { name: 'tenant-a', namespace: 'platform' },
        spec: {},
        status: {},
      },
    }));

    expect(JSON.parse(outputJson).operations).toEqual([
      { kind: 'finalizer', operation: 'add', finalizer: 'platform.applik8s.dev/tenant' },
      { kind: 'delete', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'tenant-app', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'delete', ref: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'tenant-db', namespace: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'delete', ref: { apiVersion: 'v1', kind: 'Namespace', name: 'tenant-a' }, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      { kind: 'finalizer', operation: 'remove', finalizer: 'platform.applik8s.dev/tenant' },
    ]);
  });

  it('creates operation target factories and infers RBAC', () => {
    const target = asOperationTargetFactory(graph)({ tenant: 'acme' });
    const rbac = target.adapter.inferRbac(target);

    expect(rbac.ok).toBe(true);
    if (rbac.ok) {
      expect(rbac.value).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(rbac.value).toContainEqual({ apiGroups: [''], resources: ['services'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
    }
  });

  it('exposes TypeKro operation-target permissions for operator manifest RBAC', () => {
    const target = typeKro.operationTarget(graph, { tenant: 'acme' });
    const permissions = typeKro.permissions(target);
    const graphPermissions = typeKro.inferRbac(graph);

    expect(target.operationTargetArtifacts.applyPlan.operations).toHaveLength(2);
    expect(target.operationTargetArtifacts.deletePlan.operations).toEqual([
      { kind: 'delete', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'tenant-app', namespace: 'tenants' } },
      { kind: 'delete', ref: { apiVersion: 'v1', kind: 'Service', name: 'tenant-app', namespace: 'tenants' } },
    ]);
    expect(graphPermissions.ok).toBe(true);
    if (!graphPermissions.ok) {
      throw new Error('Expected TypeKro RBAC inference to succeed.');
    }
    expect(graphPermissions.value).toEqual(permissions);

    const Tenant = sdk.crd<{ readonly plan: string }, { readonly phase?: string }>({
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'Tenant',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'TenantSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'TenantStatus' }, schema: tenantSchema },
    });
    const operator = sdk.operator({
      name: 'tenant-target-controller',
      resources: { Tenant },
      permissions,
      handlers: [Tenant.on.reconcile((tenant) => {
        tenant.apply(target, { fieldManager: 'tenant-stack' });
      })],
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
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['services'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['platform.applik8s.dev'], resources: ['tenants'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['platform.applik8s.dev'], resources: ['tenants/status'], verbs: ['get', 'patch', 'update'] });
    }
  });

  it('carries TypeKro operation-target permissions on the handler registration', () => {
    const target = typeKro.operationTarget(graph, { tenant: 'acme' });
    const targetPermissions = typeKro.permissions(target);
    const Tenant = sdk.crd<{ readonly plan: string }, { readonly phase?: string }>({
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'Tenant',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'TenantSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'TenantStatus' }, schema: tenantSchema },
    });
    const operator = sdk.operator({
      name: 'tenant-handler-target-controller',
      resources: { Tenant },
      handlers: [sdk.withPermissions(Tenant.on.reconcile((tenant) => {
        tenant.apply(target, { fieldManager: 'tenant-stack' });
      }), targetPermissions)],
    });

    const manifest = buildOperatorManifest({
      operator: operator.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(operator.definition.permissions).toBeUndefined();
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['services'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['platform.applik8s.dev'], resources: ['tenants'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.security.rbac.mode).toBe('inferred');
    }
  });

  it('groups TypeKro-backed listeners into an explicit applik8s operator', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const platform = sdk.operator({ name: 'platform-controller', resources: {}, handlers: [], deployment: { namespace: 'operators' } });

    const app = Deployment({ id: 'app', name: 'tenant-app', namespace: 'apps' });
    const registration = app.on.updated(platform, (deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    });

    expect(registration.resource.resourceOwnership).toBe('external');
    const groupedDeployment = projectedResource(platform.definition.resources, 'deployment');
    expect(groupedDeployment?.apiVersion).toBe('apps/v1');
    expect(groupedDeployment?.kind).toBe('Deployment');
    expect(groupedDeployment?.resourceOwnership).toBe('external');
    expect(platform.definition.handlers).toHaveLength(1);

    const manifest = buildOperatorManifest({
      operator: platform.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.ownedCrds).toEqual([]);
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        plural: 'deployments',
        scope: 'Namespaced',
        namespace: 'apps',
        name: 'tenant-app',
        events: ['updated'],
        handlers: [registration.id],
      }));
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch'] });
    }
  });

  it('fails closed for unattached TypeKro-backed listener registrations', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });

    const app = Deployment({ id: 'app', name: 'tenant-app', namespace: 'apps' });

    expect(() => app.on.updated((deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    })).toThrow(/not attached to an operator/);
  });

  it('fails closed for unattached aggregate TypeKro listener registrations', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });

    const api = Deployment({ id: 'api', name: 'api', namespace: 'apps' });
    const worker = Deployment({ id: 'worker', name: 'worker', namespace: 'apps' });

    expect(() => typeKro.resources([api, worker]).on.updated((deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    })).toThrow(/not attached to an operator/);
  });

  it('defaults TypeKro-backed listener grouping to the enclosing kubernetesComposition', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const platformStackDefinition = {
      name: 'platform-stack',
      apiVersion: 'platform.applik8s.dev/v1alpha1',
      kind: 'PlatformStack',
      spec: arkType({ name: 'string' }),
      status: arkType({ ready: 'boolean' }),
    };
    const composition = typeKro.kubernetesComposition(
      platformStackDefinition,
      (_spec) => {
        const app = Deployment({ id: 'app', name: 'tenant-app', namespace: 'apps' });
        app.on.updated((deployment) => {
          deployment.events.normal('DeploymentUpdated', 'Deployment changed');
        });
        return { ready: true };
      }
    );

    const operator = composition.listenerOperator({ name: 'platform-stack-controller', deployment: { namespace: 'operators' } });

    const groupedDeployment = projectedResource(operator.definition.resources, 'deployment');
    expect(groupedDeployment?.apiVersion).toBe('apps/v1');
    expect(groupedDeployment?.kind).toBe('Deployment');
    expect(groupedDeployment?.resourceOwnership).toBe('external');
    expect(operator.definition.handlers).toHaveLength(1);
    expect(operator.definition.handlers[0]?.event).toBe('updated');
    expect(operator.definition.handlers[0]?.watch).toEqual({ namespace: 'apps', name: 'tenant-app' });
  });

  it('captures direct applik8s operator calls inside TypeKro compositions as install bindings', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageSpec' }, schema: imageSpecSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageStatus' }, schema: imageStatusSchema },
    });
    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [],
      deployment: { namespace: 'media-system' },
    });
    const mediaStackDefinition = {
      name: 'media-stack',
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MediaStack',
      spec: arkType({ namespace: 'string' }),
      status: arkType({ ready: 'boolean' }),
    };

    const composition = typeKro.kubernetesComposition(mediaStackDefinition, (spec) => {
      const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
      const image = pipeline.imageJob({
        name: 'hero',
        namespace: spec.namespace,
        spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
      });
      return { ready: image.kind === 'ImageJob' };
    });

    expect(composition.operatorInstalls).toHaveLength(1);
    const install = composition.operatorInstalls[0];
    expect(install?.operatorName).toBe('image-pipeline');
    expect(install?.deployment).toMatchObject({ replicas: 1 });
    expect(Reflect.get(install?.deployment ?? {}, 'namespace')).toBeTypeOf('function');
    expect(install?.binding.installKind).toBe('applik8sOperatorInstall');
    expect(Reflect.get(install?.binding.crdFactories ?? {}, 'imageJob')).toBeTypeOf('function');
  });

  it('adds scoped handlers to generated CRD instances from direct-call install bindings', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageSpec' }, schema: imageSpecSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageStatus' }, schema: imageStatusSchema },
    });
    const imagePipeline = sdk.operator({
      name: 'image-pipeline-with-instance-handler',
      resources: { ImageJob },
      handlers: [],
      deployment: { namespace: 'media-system' },
    });
    const mediaStackDefinition = {
      name: 'media-stack-with-instance-handler',
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MediaStackWithInstanceHandler',
      spec: arkType({ namespace: 'string' }),
      status: arkType({ ready: 'boolean' }),
    };

    const composition = typeKro.kubernetesComposition(mediaStackDefinition, (spec) => {
      const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
      const image = pipeline.imageJob({
        name: 'hero',
        namespace: spec.namespace,
        spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
      });
      image.on.reconcile((job) => {
        job.status.phase = 'Processing';
      });
      return { ready: image.status?.phase === 'Processing' };
    });

    expect(imagePipeline.definition.handlers).toHaveLength(1);
    expect(imagePipeline.definition.handlers[0]).toMatchObject({
      event: 'reconcile',
      watch: { name: 'hero' },
    });
    expect(composition.operatorInstalls).toHaveLength(1);
    composition({ namespace: 'media-system' });
    expect(imagePipeline.definition.handlers).toHaveLength(1);
  });

  it('resolves captured direct operator calls into TypeKro install resources from compiled manifests', () => {
    const { operator: imagePipelineDefinition, manifest } = imageOperatorFixture();
    const imagePipeline = sdk.operator({
      name: imagePipelineDefinition.name,
      resources: imagePipelineDefinition.resources,
      handlers: imagePipelineDefinition.handlers,
      ...(imagePipelineDefinition.deployment ? { deployment: imagePipelineDefinition.deployment } : {}),
      ...(imagePipelineDefinition.runtime ? { runtime: imagePipelineDefinition.runtime } : {}),
    });
    const mediaStackDefinition = {
      name: 'media-stack',
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MediaStack',
      spec: arkType({ namespace: 'string' }),
      status: arkType({ ready: 'boolean' }),
    };
    const composition = typeKro.kubernetesComposition(mediaStackDefinition, (spec) => {
      const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
      const imageJob = pipeline.imageJob;
      if (!imageJob) {
        throw new Error('Expected imageJob factory alias.');
      }
      const image = imageJob({
        name: 'hero',
        namespace: spec.namespace,
        spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
      });
      imageJob({
        name: 'thumbnail',
        namespace: spec.namespace,
        spec: { sourceUrl: 's3://images/thumb.png', formats: ['webp'] },
      });
      return { ready: image.status?.phase === 'Complete' };
    });

    const resolved = composition.resolveOperatorInstalls({ manifests: [manifest] });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.operatorInstalls).toHaveLength(1);
      expect(resolved.value.resources.some((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'image-pipeline')).toBe(true);
      expect(resolved.value.resources.some((resource) => resource.kind === 'CustomResourceDefinition')).toBe(true);
      expect(resolved.value.resources.some((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'hero')).toBe(true);
      expect(resolved.value.resources.some((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'thumbnail')).toBe(true);
    }
  });

  it('passes generated CRDs as KRO prerequisites for resolved operator installs', () => {
    const { operator: imagePipelineDefinition, manifest } = imageOperatorFixture();
    const imagePipeline = sdk.operator({
      name: imagePipelineDefinition.name,
      resources: imagePipelineDefinition.resources,
      handlers: imagePipelineDefinition.handlers,
      ...(imagePipelineDefinition.deployment ? { deployment: imagePipelineDefinition.deployment } : {}),
      ...(imagePipelineDefinition.runtime ? { runtime: imagePipelineDefinition.runtime } : {}),
    });
    const composition = typeKro.kubernetesComposition({
      name: 'media-stack-prereqs',
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MediaStackPrereqs',
      spec: arkType({ namespace: 'string' }),
      status: arkType({ ready: 'boolean' }),
    }, (spec) => {
      const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
      const imageJob = pipeline.imageJob;
      if (!imageJob) {
        throw new Error('Expected imageJob factory alias.');
      }
      const image = imageJob({
        name: 'hero',
        namespace: spec.namespace,
        spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
      });
      return { ready: image.status?.phase === 'Complete' };
    });

    const resolved = composition.resolveOperatorInstalls({ manifests: [manifest], defaultNamespace: 'media-system' });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error(resolved.error.message);
    }
    const kroYaml = resolved.value.factory('kro', { namespace: 'media-system' }).toYaml();
    expect(kroYaml.trimStart().startsWith('apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition')).toBe(true);
    expect(kroYaml.indexOf('name: imagejobs.media.applik8s.dev')).toBeLessThan(kroYaml.indexOf('kind: ResourceGraphDefinition'));
  });

  it('fails closed when captured direct operator calls are missing compiled manifests', () => {
    const { operator: imagePipelineDefinition } = imageOperatorFixture();
    const imagePipeline = sdk.operator({
      name: imagePipelineDefinition.name,
      resources: imagePipelineDefinition.resources,
      handlers: imagePipelineDefinition.handlers,
      ...(imagePipelineDefinition.deployment ? { deployment: imagePipelineDefinition.deployment } : {}),
      ...(imagePipelineDefinition.runtime ? { runtime: imagePipelineDefinition.runtime } : {}),
    });
    const mediaStackDefinition = {
      name: 'media-stack',
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MediaStack',
      spec: arkType({ namespace: 'string' }),
      status: arkType({ ready: 'boolean' }),
    };
    const composition = typeKro.kubernetesComposition(mediaStackDefinition, (spec) => {
      const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
      return { ready: pipeline.status.ready === true };
    });

    const resolved = typeKro.resolveOperatorInstalls(composition, { manifests: [] });

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.message).toContain('missing a compiled applik8s OperatorBundle manifest');
    }
  });

  it('resolves direct operator calls from compiler-produced compile results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-compile-'));
    try {
      const entrypoint = join(dir, 'compiled-image-pipeline.mjs');
      await writeFile(entrypoint, `
        import { sdk } from '@applik8s/sdk';

        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: {
            type: 'object',
            required: ['sourceUrl', 'formats'],
            additionalProperties: false,
            properties: {
              sourceUrl: { type: 'string' },
              formats: { type: 'array', items: { type: 'string' } }
            }
          }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: {
            type: 'object',
            properties: { phase: { type: 'string' } }
          }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'compiled-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });
      `);
      const compiled = await createCompilerPipeline().run({
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
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) {
        throw new Error(compiled.error.message);
      }

      // static-import-exception: this test imports a generated temporary entrypoint to verify compiler-produced manifests; typecast: the generated fixture exports the known callable operator used by this test.
      const imported = await import(`${pathToFileURL(entrypoint).href}?v=${Date.now()}`) as { readonly imagePipeline: CallableOperator };
      const mediaStackDefinition = {
        name: 'compiled-media-stack',
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'CompiledMediaStack',
        spec: arkType({ namespace: 'string' }),
        status: arkType({ ready: 'boolean' }),
      };
      const composition = typeKro.kubernetesComposition(mediaStackDefinition, (spec) => {
        const pipeline = imported.imagePipeline({ namespace: spec.namespace, replicas: 1 });
        const imageJob = pipeline.imageJob;
        if (!imageJob) {
          throw new Error('Expected imageJob factory alias.');
        }
        const image = imageJob({
          name: 'hero',
          namespace: spec.namespace,
          spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
        });
        return { ready: image.status?.phase === 'Complete' };
      });

      const resolved = composition.resolveOperatorInstalls({ manifests: [compiled.value] });

      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.value.resources.some((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'compiled-image-pipeline')).toBe(true);
        expect(resolved.value.resources.some((resource) => resource.kind === 'CustomResourceDefinition')).toBe(true);
        expect(resolved.value.resources.some((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'hero')).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles exported TypeKro compositions by lowering captured operator installs automatically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-composition-'));
    try {
      const entrypoint = join(dir, 'media-stack.mjs');
      await writeFile(entrypoint, `
        import { type } from 'arktype';
        import { sdk } from '@applik8s/sdk';
        import { typeKro } from '@applik8s/typekro-adapter';

        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: {
            type: 'object',
            required: ['sourceUrl', 'formats'],
            additionalProperties: false,
            properties: {
              sourceUrl: { type: 'string' },
              formats: { type: 'array', items: { type: 'string' } }
            }
          }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: {
            type: 'object',
            properties: { phase: { type: 'string' } }
          }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'auto-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });

        export const mediaStack = typeKro.kubernetesComposition({
          name: 'auto-media-stack',
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'AutoMediaStack',
          spec: type({ namespace: 'string' }),
          status: type({ ready: 'boolean' }),
        }, (spec) => {
          const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
          const image = pipeline.imageJob({
            name: 'hero',
            namespace: spec.namespace,
            spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
          });
          return { ready: image.status.phase === 'Complete' };
        });
      `);

      const compiled = await compileTypeKroComposition({
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

      if (!compiled.ok) {
        throw new Error(compiled.error.message);
      }
      expect(compiled.value.operatorCompiles).toHaveLength(1);
      expect(compiled.value.operatorCompiles[0]?.manifest.metadata.name).toBe('auto-image-pipeline');
      const resources = compiled.value.composition.resources;
      expect(resources.some((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'auto-image-pipeline')).toBe(true);
      expect(resources.some((resource) => resource.kind === 'CustomResourceDefinition')).toBe(true);
      expect(resources.some((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'hero')).toBe(true);

      expect(compiled.value.artifacts.operatorArtifacts).toHaveLength(1);
      expect(compiled.value.artifacts.operatorArtifacts[0]?.operatorName).toBe('auto-image-pipeline');
      expect(compiled.value.artifacts.resourceYamlPaths.length).toBeGreaterThan(0);
      expect(compiled.value.artifacts.instanceYamlPaths).toHaveLength(1);
      expect(compiled.value.artifacts.applyScriptPath).toBe(join(dir, 'dist', 'typekro', 'apply.sh'));

      const compositionManifest = compiled.value.artifacts.manifest;
      expect(compositionManifest.kind).toBe('TypeKroCompositionBundle');
      expect(compositionManifest.metadata.name).toBe('mediaStack');
      expect(compositionManifest.spec.operators[0]?.name).toBe('auto-image-pipeline');
      const emittedResources = compiled.value.artifacts.resources;
      expect(compositionManifest.spec.resourceCount).toBe(emittedResources.length);
      expect(emittedResources.some((resource) => resource.kind === 'Deployment' && resource.metadata.name === 'auto-image-pipeline')).toBe(true);
      expect(emittedResources.some((resource) => resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === 'auto-media-stack')).toBe(true);
      expect(emittedResources.some((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'hero')).toBe(true);
      const emittedRole = emittedResources.find((resource) => resource.kind === 'Role');
      const emittedRoleBinding = emittedResources.find((resource) => resource.kind === 'RoleBinding');
      expect(Array.isArray(emittedRole?.rules)).toBe(true);
      expect(Array.isArray(emittedRoleBinding?.subjects)).toBe(true);
      const combinedYaml = await readFile(compiled.value.artifacts.combinedYamlPath, 'utf8');
      expect(combinedYaml).toContain('kind: Deployment');
      expect(combinedYaml).toContain('kind: ImageJob');
      expect(combinedYaml).toContain('rules:\n  - apiGroups:');
      expect(combinedYaml).toContain('subjects:\n  - kind: ServiceAccount');
      const applyScript = await readFile(compiled.value.artifacts.applyScriptPath, 'utf8');
      expect(applyScript).toContain('Applying TypeKro prerequisite CustomResourceDefinitions');
      expect(applyScript).toContain('kubectl');
      expect(applyScript).toContain('apply_with_retry');
      expect(applyScript).toContain('wait_for_api_resource');
      expect(applyScript).toContain("wait_for_api_resource 'media.applik8s.dev' 'AutoMediaStack'");
      expect(applyScript).toContain('grep -Eq "^kind:[[:space:]]*$2[[:space:]]*$"');
      expect(applyScript).toContain('Skipping TypeKro template resource owned by a ResourceGraphDefinition');
      expect(applyScript).toContain('Skipping TypeKro template resource with expression placeholders');
      expect(applyScript).toContain('Applying TypeKro stack instances');
      const firstResourceYaml = await readFile(compiled.value.artifacts.resourceYamlPaths[0] ?? '', 'utf8');
      expect(firstResourceYaml).toContain('apiVersion:');
      const instanceYaml = await readFile(compiled.value.artifacts.instanceYamlPaths[0] ?? '', 'utf8');
      expect(instanceYaml).toContain('kind: AutoMediaStack');
      expect(instanceYaml).toContain('spec: {}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('compiles generated-CRD instance handlers from mixed TypeKro composition entrypoints without bundling TypeKro into the handler', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-handler-composition-'));
    try {
      const entrypoint = join(dir, 'media-stack.mjs');
      await writeFile(entrypoint, `
        import { type } from 'arktype';
        import { cel, sdk, typeKro } from '@applik8s/applik8s';
        import { ConfigMap } from '@applik8s/applik8s/factories/simple';

        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: {
            type: 'object',
            required: ['sourceUrl', 'formats'],
            additionalProperties: false,
            properties: {
              sourceUrl: { type: 'string' },
              formats: { type: 'array', items: { type: 'string' } }
            }
          }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'handler-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });

        export const mediaStack = typeKro.kubernetesComposition({
          name: 'handler-media-stack',
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'HandlerMediaStack',
          spec: type({}),
          status: type({ ready: 'boolean' }),
        }, () => {
          const pipeline = imagePipeline({ namespace: 'media-system', replicas: 1 });
          const image = pipeline.imageJob({
            name: 'hero',
            namespace: 'media-system',
            spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
          });
          image.on.reconcile((job) => {
            job.status.phase = 'Processing';
            job.status.outputUrls = [job.spec.sourceUrl + '.webp'];
          });
          ConfigMap({
            name: 'status-consumer',
            namespace: 'media-system',
            data: { phase: cel\`\${image.status.phase}\` },
          });
          return { ready: image.status.phase === 'Processing' };
        });
      `);

      const compiled = await compileTypeKroComposition({
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

      if (!compiled.ok) {
        throw new Error(compiled.error.message);
      }
      expect(compiled.value.operatorCompiles[0]?.manifest.metadata.name).toBe('handler-image-pipeline');
      expect(compiled.value.operatorCompiles[0]?.manifest.spec.handlerExports).toContainEqual(expect.objectContaining({
        event: 'reconcile',
        handlerId: 'ImageJob.reconcile.0',
        resource: expect.objectContaining({ apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob' }),
      }));
      expect(compiled.value.operatorCompiles[0]?.manifest.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        namespace: 'media-system',
        name: 'hero',
        handlers: ['ImageJob.reconcile.0'],
      }));
      expect(compiled.value.operatorCompiles[0]?.manifest.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch'] });
      expect(compiled.value.operatorCompiles[0]?.manifest.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] });
      expect(compiled.value.operatorCompiles[0]?.manifest.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
      const imageJob = compiled.value.composition.resources.find((resource) => resource.kind === 'ImageJob' && resource.metadata.name === 'hero');
      const statusConsumer = compiled.value.composition.resources.find((resource) => resource.kind === 'ConfigMap' && resource.metadata.name === 'status-consumer');
      expect(imageJob).toBeDefined();
      expect(statusConsumer).toBeDefined();
      expect(JSON.stringify(statusConsumer)).toContain('phase');
      expect(JSON.stringify(statusConsumer)).not.toContain('Processing');
      expect(Object.keys(imageJob ?? {})).not.toContain('on');
      let imageJobYaml = '';
      for (const path of compiled.value.artifacts.resourceYamlPaths) {
        const yaml = await readFile(path, 'utf8');
        if (yaml.includes('\nkind: ImageJob\n')) {
          imageJobYaml = yaml;
          break;
        }
      }
      expect(imageJobYaml).toContain('kind: ImageJob');
      expect(imageJobYaml).not.toContain('\non:');
      let statusConsumerYaml = '';
      for (const path of compiled.value.artifacts.resourceYamlPaths) {
        const yaml = await readFile(path, 'utf8');
        if (yaml.includes('\nkind: ConfigMap\n') && yaml.includes('name: status-consumer')) {
          statusConsumerYaml = yaml;
          break;
        }
      }
      expect(statusConsumerYaml).toContain('kind: ConfigMap');
      expect(statusConsumerYaml).toContain('phase:');
      expect(statusConsumerYaml).not.toContain('Processing');
      const handlerBundle = await readFile(join(dir, 'dist', 'operators', 'handler-image-pipeline', 'bundle', 'handler.js'), 'utf8');
      expect(handlerBundle).toContain('handler-image-pipeline');
      expect(handlerBundle).not.toContain('node:async_hooks');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('serializes reachable top-level TypeKro handler constants without importing the authoring module', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-static-handler-diagnostic-'));
    try {
      const entrypoint = join(dir, 'media-stack.mjs');
      await writeFile(entrypoint, `
        import { type } from 'arktype';
        import { sdk, typeKro } from '@applik8s/applik8s';

        const phaseFromModuleScope = 'Processing';
        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: { type: 'object', required: ['sourceUrl'], properties: { sourceUrl: { type: 'string' } } }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: { type: 'object', properties: { phase: { type: 'string' } } }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'static-diagnostic-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });

        export const mediaStack = typeKro.kubernetesComposition({
          name: 'static-diagnostic-media-stack',
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'StaticDiagnosticMediaStack',
          spec: type({}),
          status: type({ ready: 'boolean' }),
        }, () => {
          const pipeline = imagePipeline({ namespace: 'media-system', replicas: 1 });
          const image = pipeline.imageJob({ name: 'hero', namespace: 'media-system', spec: { sourceUrl: 's3://images/hero.png' } });
          image.on.reconcile((job) => {
            job.status.phase = phaseFromModuleScope;
          });
          return { ready: image.status.phase === 'Processing' };
        });
      `);

      const compiled = await compileTypeKroComposition({
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

      expect(compiled.ok).toBe(true);
      if (compiled.ok) {
        const handlerBundle = await readFile(join(dir, 'dist', 'operators', 'static-diagnostic-image-pipeline', 'bundle', 'handler.js'), 'utf8');
        expect(handlerBundle).toContain('Processing');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('groups finite TypeKro resource instance listeners into scoped manifest watches', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const api = Deployment({ id: 'api', name: 'api', namespace: 'apps' });
    const worker = Deployment({ id: 'worker', name: 'worker', namespace: 'apps' });
    const platform = sdk.operator({ name: 'platform-controller', resources: {}, handlers: [] });

    const registration = Deployment.instances([api, worker]).on.updated(platform, (deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    });

    const manifest = buildOperatorManifest({
      operator: platform.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        plural: 'deployments',
        scope: 'Namespaced',
        namespace: 'apps',
        names: ['api', 'worker'],
        events: ['updated'],
        handlers: [registration.id],
      }));
      expect(manifest.value.spec.ownedCrds).toEqual([]);
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
    }
  });

  it('deduplicates equivalent finite TypeKro listener scopes in manifest watches', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const api = Deployment({ id: 'api', name: 'api', namespace: 'apps' });
    const worker = Deployment({ id: 'worker', name: 'worker', namespace: 'apps' });
    const platform = sdk.operator({ name: 'platform-controller', resources: {}, handlers: [] });

    const updated = Deployment.instances([worker, api]).on.updated(platform, (deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    });
    const statusChanged = Deployment.instances([api, worker]).on.statusChanged(platform, (deployment) => {
      deployment.events.normal('DeploymentStatusChanged', 'Deployment status changed');
    });

    const manifest = buildOperatorManifest({
      operator: platform.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.watches.filter((watch) => watch.apiVersion === 'apps/v1' && watch.kind === 'Deployment')).toEqual([
        expect.objectContaining({
          namespace: 'apps',
          names: ['api', 'worker'],
          events: ['updated', 'statusChanged'],
          handlers: [updated.id, statusChanged.id],
        }),
      ]);
    }
  });

  it('groups selector-scoped TypeKro resource listeners into scoped manifest watches', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const platform = sdk.operator({ name: 'platform-controller', resources: {}, handlers: [] });

    const registration = Deployment.where({ namespace: 'apps', labels: { 'app.kubernetes.io/part-of': 'platform' } }).on.updated(platform, (deployment) => {
      deployment.events.normal('DeploymentUpdated', 'Deployment changed');
    });

    const manifest = buildOperatorManifest({
      operator: platform.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        plural: 'deployments',
        scope: 'Namespaced',
        namespace: 'apps',
        labelSelector: { matchLabels: { 'app.kubernetes.io/part-of': 'platform' } },
        events: ['updated'],
        handlers: [registration.id],
      }));
      expect(manifest.value.spec.ownedCrds).toEqual([]);
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
    }
  });

  it('rejects ambiguous TypeKro listener selector shorthand', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });

    expect(() => Deployment.where({
      labels: { app: 'api' },
      labelSelector: { matchLabels: { tier: 'backend' } },
    })).toThrow('either labels or labelSelector');
  });

  it('rejects unsupported TypeKro listener label selector expressions instead of emitting broad watches', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });

    expect(() => Deployment.where({
      namespace: 'apps',
      labelSelector: { matchExpressions: [{ key: 'app', operator: 'Exists' }] },
    }).on.updated(() => undefined)).toThrow('labelSelector.matchExpressions');
  });

  it('groups mixed TypeKro resource listeners through aggregate resource scopes', () => {
    const Deployment = typeKro.resource(typeKroDeploymentFactory, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      plural: 'deployments',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DeploymentStatus' }, schema: tenantSchema },
    });
    const Service = typeKro.resource(typeKroServiceFactory, {
      apiVersion: 'v1',
      kind: 'Service',
      plural: 'services',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ServiceSpec' }, schema: tenantSchema },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ServiceStatus' }, schema: tenantSchema },
    });
    const api = Deployment({ id: 'api', name: 'api', namespace: 'apps' });
    const worker = Deployment({ id: 'worker', name: 'worker', namespace: 'apps' });
    const apiService = Service({ id: 'api-service', name: 'api', namespace: 'apps' });
    const platform = sdk.operator({ name: 'platform-controller', resources: {}, handlers: [] });

    const registrations = typeKro.resources([api, worker, apiService]).on.updated(platform, (resource) => {
      resource.events.normal('ResourceUpdated', 'Resource changed');
    });

    const manifest = buildOperatorManifest({
      operator: platform.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });

    expect(registrations).toHaveLength(2);
    expect(platform.definition.handlers).toHaveLength(2);
    expect(projectedResource(platform.definition.resources, 'deployment')?.resourceOwnership).toBe('external');
    expect(projectedResource(platform.definition.resources, 'service')?.resourceOwnership).toBe('external');
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        plural: 'deployments',
        scope: 'Namespaced',
        namespace: 'apps',
        names: ['api', 'worker'],
        events: ['updated'],
        handlers: [registrations[0]?.id],
      }));
      expect(manifest.value.spec.watches).toContainEqual(expect.objectContaining({
        apiVersion: 'v1',
        kind: 'Service',
        plural: 'services',
        scope: 'Namespaced',
        namespace: 'apps',
        names: ['api'],
        events: ['updated'],
        handlers: [registrations[1]?.id],
      }));
      expect(manifest.value.spec.ownedCrds).toEqual([]);
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['services'], verbs: ['get', 'list', 'watch'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['services/status'], verbs: ['get', 'patch', 'update'] });
      expect(manifest.value.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
    }
  });
});

function typeKroDeploymentFactory(input: { readonly id?: string; readonly name: string; readonly namespace?: string }) {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    id: input.id,
    metadata: { name: input.name, ...(input.namespace ? { namespace: input.namespace } : {}) },
    spec: {},
  };
}

function typeKroServiceFactory(input: { readonly id?: string; readonly name: string; readonly namespace?: string }) {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    id: input.id,
    metadata: { name: input.name, ...(input.namespace ? { namespace: input.namespace } : {}) },
    spec: {},
  };
}

function projectedResource(resources: object, key: string): ResourceProjection | undefined {
  const value = Reflect.get(resources, key);
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  return value;
}

function imageOperatorFixture(specSchema: JsonObject = imageSpecSchema, runtime?: OperatorDefinition['runtime']): { readonly operator: OperatorDefinition; readonly manifest: OperatorManifest } {
  const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
    apiVersion: 'media.applik8s.dev/v1alpha1',
    kind: 'ImageJob',
    spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageSpec' }, schema: specSchema },
    status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'ImageStatus' }, schema: imageStatusSchema },
  });
  const imagePipeline = sdk.operator({
    name: 'image-pipeline',
    resources: { ImageJob },
    deployment: { namespace: 'media-system' },
    ...(runtime ? { runtime } : {}),
    handlers: [ImageJob.on.reconcile((job) => { job.status.phase = 'Processing'; })],
  });
  const manifest = buildOperatorManifest({
    operator: imagePipeline.definition,
    handlerArtifactPath: 'wasm/handler.wasm',
    handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
    runtimeContractPath: 'runtime-contract.json',
    runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
  });
  if (!manifest.ok) {
    throw new Error(manifest.error.message);
  }
  return { operator: imagePipeline.definition, manifest: manifest.value };
}
