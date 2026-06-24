import { describe, expect, it } from 'vitest';
import { type as arkType } from 'arktype';
import { buildOperatorManifest } from '@applik8s/compiler';
import { dispatchOperatorHandler, sdk } from '@applik8s/sdk';
import { createHandlerProxyRecorder } from '@applik8s/testing';
import type { JsonObject, OperatorDefinition, OperatorManifest } from '@applik8s/core';
import type { TypeKroGraph } from '../src/index.js';

import { asComposition, asOperationTargetFactory, createGraphAdapter, toOperationTarget, typeKro } from '../src/index.js';
import { ImageJob as GoldenPathImageJob, imagePipeline as goldenPathImagePipeline } from '../../../examples/imagejob.js';

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
  readonly livenessProbe?: { readonly httpGet?: JsonObject };
  readonly readinessProbe?: { readonly httpGet?: JsonObject };
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
      const image = installed.imageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'], priority: 'normal' } });

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
        'applik8s.dev/host-imports': 'capability-request,log,cancel',
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
      expect(container?.livenessProbe?.httpGet).toEqual({ path: '/healthz', port: 'health' });
      expect(container?.readinessProbe?.httpGet).toEqual({ path: '/readyz', port: 'health' });
    }
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
      expect(specSchema?.properties).toMatchObject({
        mode: { enum: ['fast', 'safe'], type: 'string' },
        enabled: { enum: [true], type: 'boolean' },
        weight: { type: 'number', nullable: true },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
        targets: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } },
      });
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
});

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
