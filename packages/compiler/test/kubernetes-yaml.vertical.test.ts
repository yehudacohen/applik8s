import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type as arkType } from 'arktype';
import { parse } from 'yaml';

import type { JsonSchemaSource, OperatorDefinition, OperatorManifest } from '@applik8s/core';
import { sdk } from '@applik8s/sdk';
import {
  buildOperatorManifest,
  emitOperatorKubernetesYaml,
  type KubernetesDocument,
  validateStructuralOpenApiSchema,
  validateGeneratedKubernetesDocuments,
} from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
}

interface ImageStatus {
  readonly phase?: 'Pending' | 'Processing';
}

interface ConfigSpec {
  readonly labels: Readonly<Record<string, string>>;
  readonly replicasByZone?: Readonly<Record<string, number>>;
  readonly targets?: readonly {
    readonly name: string;
    readonly port?: number | null;
  }[];
}

interface ArkConfigSpec {
  readonly mode: 'fast' | 'safe';
  readonly enabled: true;
  readonly weight: number | null;
  readonly labels: Readonly<Record<string, string>>;
  readonly targets: readonly string[];
  readonly nested: { readonly ready: boolean };
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

describe('Kubernetes YAML generation', () => {
  it('emits cluster-scoped RBAC when an owned CRD is cluster scoped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cluster-rbac-'));

    try {
      const ClusterThing = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'platform.applik8s.dev/v1alpha1',
        kind: 'ClusterThing',
        scope: 'Cluster',
        spec: imageSpecSchema,
        status: imageStatusSchema,
      });
      const clusterOperator = sdk.operator({
        name: 'cluster-operator',
        deployment: { namespace: 'operators' },
        resources: { ClusterThing },
        handlers: [],
      });
      const digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      const handlerArtifactPath = join(dir, 'handler.wasm');
      await writeFile(handlerArtifactPath, new Uint8Array([0, 97, 115, 109]));
      const manifest = buildOperatorManifest({
        operator: clusterOperator.definition,
        handlerArtifactPath,
        handlerArtifactDigest: digest,
        runtimeContractPath: 'runtime-contract.json',
        runtimeContractDigest: digest,
      });

      expect(manifest.ok).toBe(true);
      if (!manifest.ok) {
        return;
      }

      const yaml = await emitOperatorKubernetesYaml({
        manifest: manifest.value,
        operator: clusterOperator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }

      expect(new Set(yaml.value.paths).size).toBe(yaml.value.paths.length);
      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      expect(documents.some((document) => document.kind === 'ClusterRole')).toBe(true);
      expect(documents.some((document) => document.kind === 'ClusterRoleBinding')).toBe(true);
      expect(documents.some((document) => document.kind === 'ConfigMap')).toBe(false);
      expect(documents.some((document) => document.kind === 'Role')).toBe(false);
      expect(documents.some((document) => document.kind === 'RoleBinding')).toBe(false);
      expect(documents.find((document) => document.kind === 'ClusterRoleBinding')?.subjects[0]).toMatchObject({
        kind: 'ServiceAccount',
        name: 'cluster-operator-controller',
        namespace: 'operators',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validates semantic references in generated Kubernetes documents', () => {
    const invalidDocuments: KubernetesDocument[] = [
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'image-pipeline-controller' },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'Role',
          name: 'missing-role',
        },
        subjects: [{ kind: 'ServiceAccount', name: 'image-pipeline-controller' }],
      },
    ];

    const validation = validateGeneratedKubernetesDocuments(invalidDocuments);

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('MANIFEST_INVALID');
      expect(validation.error.message).toContain('missing Role missing-role');
    }
  });

  it('fails closed instead of emitting unsafe multi-replica operator deployments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-unsafe-replicas-'));

    try {
      const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        spec: imageSpecSchema,
        status: imageStatusSchema,
      });
      const safeOperator = sdk.operator({
        name: 'unsafe-replica-operator',
        deployment: { namespace: 'media', replicas: 1 },
        resources: { ImageJob },
        handlers: [],
      });
      const unsafeOperator = sdk.operator({
        name: 'unsafe-replica-operator',
        deployment: { namespace: 'media', replicas: 2 },
        resources: { ImageJob },
        handlers: [],
      });
      const manifest = await buildTestManifest(dir, safeOperator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: unsafeOperator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(false);
      if (!yaml.ok) {
        expect(yaml.error.message).toContain('deployment.replicas greater than 1');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits leader-elected multi-replica operator deployments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-leader-election-'));

    try {
      const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        spec: imageSpecSchema,
        status: imageStatusSchema,
      });
      const operator = sdk.operator({
        name: 'leader-elected-operator',
        deployment: { namespace: 'media', replicas: 2 },
        runtime: {
          leaderElection: { enabled: true, leaseName: 'leader-elected-operator', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
          concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
          rateLimit: { baseDelayMs: 5000, maxDelayMs: 300000 },
          health: { enabled: true, path: '/healthz', port: 8080 },
          metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
        },
        resources: { ImageJob },
        handlers: [],
      });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }
      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const deployment = documents.find((document) => document.kind === 'Deployment');
      const role = documents.find((document) => document.kind === 'Role');
      const env = deployment?.spec.template.spec.containers[0].env;

      expect(deployment?.spec.replicas).toBe(2);
      expect(env).toContainEqual({ name: 'APPLIK8S_LEADER_ELECTION_IDENTITY', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } });
      expect(role?.rules).toContainEqual({ apiGroups: ['coordination.k8s.io'], resources: ['leases'], verbs: ['get', 'update', 'patch'], resourceNames: ['leader-elected-operator'] });
      expect(role?.rules).toContainEqual({ apiGroups: ['coordination.k8s.io'], resources: ['leases'], verbs: ['create'] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits Secret RBAC for live secretRef HTTP capabilities', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-secret-capability-rbac-'));

    try {
      const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        spec: imageSpecSchema,
        status: imageStatusSchema,
      });
      const descriptor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: sdk.secretRef('processor-token', 'token') });
      const operator = sdk.operator({
        name: 'secret-capability-operator',
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
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }
      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const role = documents.find((document) => document.kind === 'Role');

      expect(role?.rules).toContainEqual({ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['processor-token'] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds standard condition fields for convention-enabled status schemas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-status-convention-'));

    try {
      const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        spec: imageSpecSchema,
        status: {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ClosedImageStatus' },
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { phase: { type: 'string' } },
          },
        },
        statusConvention: {
          observedGenerationField: 'observedGeneration',
          conditionsField: 'conditions',
        },
      });
      const operator = sdk.operator({
        name: 'status-convention-operator',
        resources: { ImageJob },
        handlers: [],
      });
      const digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      const handlerArtifactPath = join(dir, 'handler.wasm');
      await writeFile(handlerArtifactPath, new Uint8Array([0, 97, 115, 109]));
      const manifest = buildOperatorManifest({
        operator: operator.definition,
        handlerArtifactPath,
        handlerArtifactDigest: digest,
        runtimeContractPath: 'runtime-contract.json',
        runtimeContractDigest: digest,
      });

      expect(manifest.ok).toBe(true);
      if (!manifest.ok) {
        return;
      }

      expect(manifest.value.spec.ownedCrds[0]?.statusSubresource).toBe(true);
      expect(manifest.value.spec.ownedCrds[0]?.statusConvention).toEqual({
        observedGenerationField: 'observedGeneration',
        conditionsField: 'conditions',
      });

      const yaml = await emitOperatorKubernetesYaml({
        manifest: manifest.value,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }

      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const crd = documents.find((document) => document.kind === 'CustomResourceDefinition');
      const statusSchema = crd?.spec.versions[0].schema.openAPIV3Schema.properties.status;
      expect(statusSchema.properties.phase).toEqual({ type: 'string' });
      expect(statusSchema.properties.observedGeneration).toEqual({ type: 'integer', format: 'int64' });
      expect(statusSchema.properties.conditions['x-kubernetes-list-type']).toBe('map');
      expect(statusSchema.properties.conditions['x-kubernetes-list-map-keys']).toEqual(['type']);
      expect(statusSchema.properties.conditions.items.properties.status.enum).toEqual(['True', 'False', 'Unknown']);
      expect(statusSchema.properties.conditions.items.properties.lastTransitionTime).toEqual({ type: 'string', format: 'date-time' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when a CRD schema cannot be represented structurally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-structural-schema-'));

    try {
      const PatternThing = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'PatternThing',
        spec: {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'PatternSpec' },
          schema: {
            type: 'object',
            properties: {
              sourceUrl: { type: 'string', pattern: '^s3://' },
            },
          },
        },
        status: imageStatusSchema,
      });
      const operator = sdk.operator({
        name: 'schema-operator',
        resources: { PatternThing },
        handlers: [],
      });
      const digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      const handlerArtifactPath = join(dir, 'handler.wasm');
      await writeFile(handlerArtifactPath, new Uint8Array([0, 97, 115, 109]));
      const manifest = buildOperatorManifest({
        operator: operator.definition,
        handlerArtifactPath,
        handlerArtifactDigest: digest,
        runtimeContractPath: 'runtime-contract.json',
        runtimeContractDigest: digest,
      });

      expect(manifest.ok).toBe(true);
      if (!manifest.ok) {
        return;
      }

      const yaml = await emitOperatorKubernetesYaml({
        manifest: manifest.value,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(false);
      if (!yaml.ok) {
        expect(yaml.error.message).toContain('not structurally supported');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits structural schemas for required fields, arrays, nullable fields, and maps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-structural-map-schema-'));

    try {
      const ConfigThing = sdk.crd<ConfigSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ConfigThing',
        spec: {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ConfigSpec' },
          schema: {
            type: 'object',
            required: ['labels'],
            additionalProperties: false,
            properties: {
              labels: { type: 'object', additionalProperties: { type: 'string' } },
              replicasByZone: { type: 'object', additionalProperties: { type: 'integer' } },
              targets: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name'],
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    port: { type: 'integer', nullable: true },
                  },
                },
              },
            },
          },
        },
        status: imageStatusSchema,
      });
      const operator = sdk.operator({
        name: 'structural-map-operator',
        resources: { ConfigThing },
        handlers: [],
      });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }

      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const crd = documents.find((document) => document.kind === 'CustomResourceDefinition');
      const specSchema = crd?.spec.versions[0].schema.openAPIV3Schema.properties.spec;
      expect(specSchema.required).toEqual(['labels']);
      expect(specSchema['x-kubernetes-preserve-unknown-fields']).toBeUndefined();
      expect(specSchema.properties.labels.additionalProperties).toEqual({ type: 'string' });
      expect(specSchema.properties.replicasByZone.additionalProperties).toEqual({ type: 'integer' });
      expect(specSchema.properties.targets.items.required).toEqual(['name']);
      expect(specSchema.properties.targets.items.properties.port).toEqual({ type: 'integer', nullable: true });
      expect(specSchema.properties.targets.items.additionalProperties).toBeUndefined();
      expect(specSchema.properties.targets.items['x-kubernetes-preserve-unknown-fields']).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits structural CRD schemas for safe ArkType enum, const, nullable, array, map, and object output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-arktype-structural-schema-'));

    try {
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
        status: imageStatusSchema,
      });
      const operator = sdk.operator({ name: 'arktype-structural-operator', resources: { ArkConfig }, handlers: [] });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(true);
      if (!yaml.ok) {
        return;
      }

      const documents = await Promise.all(yaml.value.paths.map(async (path) => parse(await readFile(path, 'utf8'))));
      const crd = documents.find((document) => document.kind === 'CustomResourceDefinition');
      const specSchema = crd?.spec.versions[0].schema.openAPIV3Schema.properties.spec;

      expect(specSchema.properties.mode).toEqual({ enum: ['fast', 'safe'], type: 'string' });
      expect(specSchema.properties.enabled).toEqual({ enum: [true], type: 'boolean' });
      expect(specSchema.properties.weight).toEqual({ type: 'number', nullable: true });
      expect(specSchema.properties.labels).toEqual({ type: 'object', additionalProperties: { type: 'string' } });
      expect(specSchema.properties.targets).toEqual({ type: 'array', items: { type: 'string' } });
      expect(specSchema.properties.nested).toMatchObject({
        type: 'object',
        required: ['ready'],
        properties: { ready: { type: 'boolean' } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed before CRD emission for unsafe ArkType mixed unions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-arktype-unsafe-union-'));

    try {
      const UnsafeArkConfig = sdk.crd<{ readonly value: string | number }, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'UnsafeArkConfig',
        spec: arkType({ value: 'string | number' }),
        status: imageStatusSchema,
      });
      const operator = sdk.operator({ name: 'arktype-unsafe-union-operator', resources: { UnsafeArkConfig }, handlers: [] });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(false);
      if (!yaml.ok) {
        expect(yaml.error.message).toContain('composition keywords');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed for composition keywords in nested CRD schemas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-composition-schema-'));

    try {
      const CompositionThing = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'CompositionThing',
        spec: {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'CompositionSpec' },
          schema: {
            type: 'object',
            properties: {
              sourceUrl: {
                oneOf: [{ type: 'string' }, { type: 'integer' }],
              },
            },
          },
        },
        status: imageStatusSchema,
      });
      const operator = sdk.operator({ name: 'composition-schema-operator', resources: { CompositionThing }, handlers: [] });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(false);
      if (!yaml.ok) {
        expect(yaml.error.message).toContain('composition keywords');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed for Kubernetes structural schema hazards before YAML emission', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-structural-hazards-'));
    const cases = [
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
        name: 'missing-array-items',
        schema: { type: 'object', properties: { targets: { type: 'array' } } },
        message: 'type array must declare items',
      },
      {
        name: 'invalid-list-map-key',
        schema: {
          type: 'object',
          properties: {
            conditions: {
              type: 'array',
              'x-kubernetes-list-type': 'map',
              'x-kubernetes-list-map-keys': ['type'],
              items: { type: 'object', properties: { status: { type: 'string' } } },
            },
          },
        },
        message: 'unsupported JSON Schema keyword x-kubernetes-list-type',
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

    try {
      for (const [index, testCase] of cases.entries()) {
        const HazardThing = sdk.crd<ImageSpec, ImageStatus>({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: `HazardThing${index}`,
          spec: {
            kind: 'jsonSchema',
            ref: { kind: 'jsonSchema', exportName: testCase.name },
            schema: testCase.schema,
          },
          status: imageStatusSchema,
        });
        const operator = sdk.operator({ name: `hazard-${index}`, resources: { HazardThing }, handlers: [] });
        const manifest = await buildTestManifest(dir, operator.definition);

        const yaml = await emitOperatorKubernetesYaml({
          manifest,
          operator: operator.definition,
          outDir: join(dir, 'kubernetes', testCase.name),
        });

        expect(yaml.ok, testCase.name).toBe(false);
        if (!yaml.ok) {
          expect(yaml.error.message).toContain(testCase.message);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shared structural schema gate rejects unknown-field preservation until pruning semantics are explicit', () => {
    const diagnostics = validateStructuralOpenApiSchema({
      type: 'object',
      properties: {
        config: {
          type: 'object',
          additionalProperties: true,
          'x-kubernetes-preserve-unknown-fields': true,
        },
      },
    }, 'PreserveUnknownSpec');

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toContain('CRD schema PreserveUnknownSpec.config.x-kubernetes-preserve-unknown-fields: true is not supported until unknown-field retention semantics are explicit.');
  });

  it('shared structural schema gate rejects optional Kubernetes list-map keys', () => {
    const diagnostics = validateStructuralOpenApiSchema({
      type: 'object',
      properties: {
        conditions: {
          type: 'array',
          'x-kubernetes-list-type': 'map',
          'x-kubernetes-list-map-keys': ['type'],
          items: {
            type: 'object',
            required: ['status'],
            properties: {
              type: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    }, 'OptionalListMapKeySpec');

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toContain('CRD schema OptionalListMapKeySpec.conditions.x-kubernetes-list-map-keys references item property type, but OptionalListMapKeySpec.conditions[].required does not require it.');
  });

  it('shared structural schema gate validates scalar enum compatibility', () => {
    const valid = validateStructuralOpenApiSchema({
      type: 'object',
      properties: {
        phase: { type: 'string', enum: ['Pending', 'Ready'] },
        priority: { type: 'integer', enum: [1, 2, 3] },
        optionalMode: { type: 'string', nullable: true, enum: ['fast', null] },
      },
    }, 'EnumSpec');
    const invalid = validateStructuralOpenApiSchema({
      type: 'object',
      properties: {
        phase: { type: 'string', enum: ['Ready', 1] },
        labels: { type: 'object', additionalProperties: { type: 'string' }, enum: [{ app: 'web' }] },
        missingType: { enum: ['Ready'] },
        empty: { type: 'string', enum: [] },
      },
    }, 'InvalidEnumSpec');

    expect(valid).toEqual([]);
    expect(invalid.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      'CRD schema InvalidEnumSpec.phase.enum contains a value that does not match type string.',
      'CRD schema InvalidEnumSpec.labels.enum is supported only for scalar string, number, integer, or boolean fields.',
      'CRD schema InvalidEnumSpec.missingType.enum requires an explicit scalar type.',
      'CRD schema InvalidEnumSpec.empty.enum must be a non-empty array.',
    ]));
  });

  it('fails closed for Kubernetes-incompatible JSON field names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-invalid-field-schema-'));

    try {
      const InvalidFieldThing = sdk.crd<ImageSpec, ImageStatus>({
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'InvalidFieldThing',
        spec: {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'InvalidFieldSpec' },
          schema: {
            type: 'object',
            properties: {
              'bad.name': { type: 'string' },
            },
          },
        },
        status: imageStatusSchema,
      });
      const operator = sdk.operator({ name: 'invalid-field-schema-operator', resources: { InvalidFieldThing }, handlers: [] });
      const manifest = await buildTestManifest(dir, operator.definition);

      const yaml = await emitOperatorKubernetesYaml({
        manifest,
        operator: operator.definition,
        outDir: join(dir, 'kubernetes'),
      });

      expect(yaml.ok).toBe(false);
      if (!yaml.ok) {
        expect(yaml.error.message).toContain('Kubernetes-compatible JSON field name');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function buildTestManifest(dir: string, operator: OperatorDefinition): Promise<OperatorManifest> {
  const digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const handlerArtifactPath = join(dir, 'handler.wasm');
  await writeFile(handlerArtifactPath, new Uint8Array([0, 97, 115, 109]));
  const manifest = buildOperatorManifest({
    operator,
    handlerArtifactPath,
    handlerArtifactDigest: digest,
    runtimeContractPath: 'runtime-contract.json',
    runtimeContractDigest: digest,
  });
  if (!manifest.ok) {
    throw new Error(manifest.error.message);
  }
  return manifest.value;
}
