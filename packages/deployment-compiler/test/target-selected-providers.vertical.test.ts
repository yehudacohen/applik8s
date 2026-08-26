// typecast-file-boundary: Test fixtures inspect provider resources emitted through a generic graph contract.
import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { builtinApplicationDeploymentContributors, resolveApplicationProviderForTarget } from '../src/index.js';

describe('v0.8 target-selected provider lowering', () => {
  it.each([
    ['local', 'local-scheduler'],
    ['aws-local', 'eventbridge-scheduler'],
    ['aws', 'eventbridge-scheduler'],
    ['kubernetes', 'kubernetes-cronjob-scheduler'],
  ] as const)('selects the maintained Scheduler implementation for %s', (target, implementation) => {
    const provider = providerNode('Scheduler');
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'Scheduler' && candidate.implementation === 'target-selected');
    expect(contributor).toBeDefined();
    const contribution = contributor!.contribute(provider, context(target));
    expect(contribution.compositionFragments).toEqual([
      expect.objectContaining({ providerInterface: 'Scheduler', providerImplementation: implementation }),
    ]);
  });

  it.each([
    ['local', 'nats-jetstream'],
    ['aws-local', 'kinesis'],
    ['aws', 'kinesis'],
    ['kubernetes', 'nats-jetstream'],
  ] as const)('selects the maintained EventLog implementation for %s', (target, implementation) => {
    const provider = resolveApplicationProviderForTarget(providerNode('EventLog'), context(target));
    expect(provider).toMatchObject({
      interface: 'EventLog',
      implementation,
      config: expect.objectContaining({ kind: implementation }),
    });
  });

  it('resolves fluent target branches and lets aws-local inherit the AWS API-fidelity provider', () => {
    const provider: ApplicationProviderNode = {
      id: 'provider.lakehouse-dataset.v1alpha1.history', kind: 'provider', name: 'LakehouseDataset', stability: 'stable',
      interface: 'LakehouseDataset', implementation: 'application-target-provider-selection',
      config: {
        qualification: { name: 'history', compatibilityRevision: 'v1alpha1' },
        targetSelection: { targets: {
          local: { implementation: 'duckdb-dataset', configuration: { kind: 'duckdb-dataset', root: '.applik8s/history' } },
          aws: { implementation: 's3-dataset', configuration: { kind: 's3-dataset', bucket: 'history', catalog: 'history', region: 'us-east-1' } },
        } },
      },
    };
    expect(resolveApplicationProviderForTarget(provider, context('local'))).toMatchObject({ implementation: 'duckdb-dataset', config: { lakehouseDataset: { kind: 'duckdb-dataset' } } });
    expect(resolveApplicationProviderForTarget(provider, context('aws-local'))).toMatchObject({ implementation: 's3-dataset', config: { lakehouseDataset: { kind: 's3-dataset' } } });
    expect(() => resolveApplicationProviderForTarget(provider, context('kubernetes'))).toThrow(/\.kubernetes/u);
  });

  it.each([
    ['local', 'deterministic-local-actors'],
    ['aws-local', 'deterministic-local-actors'],
    ['aws', 'celld-actors'],
  ] as const)('selects the maintained ActorRuntime implementation for %s', (target, implementation) => {
    const provider = providerNode('ActorRuntime');
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'ActorRuntime' && candidate.implementation === 'target-selected');
    const contribution = contributor!.contribute(provider, context(target));
    expect(contribution.compositionFragments).toEqual([
      expect.objectContaining({ providerInterface: 'ActorRuntime', providerImplementation: implementation }),
    ]);
  });

  it('fails closed when implicit Kubernetes Celld selection has no durable state authority', () => {
    const provider = providerNode('ActorRuntime');
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'ActorRuntime' && candidate.implementation === 'target-selected');
    expect(() => contributor!.contribute(provider, context('kubernetes'))).toThrow(/ObjectStorage/u);
  });

  it('derives Kubernetes Celld state from the selected application ObjectStorage provider', () => {
    const provider = providerNode('ActorRuntime');
    const graph: ApplicationGraph = { ...emptyGraph(), nodes: [{
      id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable',
      interface: 'ObjectStorage', implementation: 's3',
      config: { objectStorage: {
        kind: 's3', bucket: 'actor-state', region: 'us-east-1',
        endpoint: 'http://object-store.storage.svc:9000', forcePathStyle: true,
        credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'object-credentials', namespace: 'proof-system' },
      } },
    }] };
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'ActorRuntime' && candidate.implementation === 'target-selected');
    const contribution = contributor!.contribute(provider, { ...context('kubernetes'), graph });
    expect(contribution.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'direct.provider.ActorRuntime.celld',
        spec: expect.objectContaining({
          configuration: expect.objectContaining({
            bucket: 'actor-state',
            endpoint: 'http://object-store.storage.svc:9000',
            credentialsSecretName: 'object-credentials',
          }),
        }),
      }),
    ]));
  });

  it('orders the Celld fleet after its application-owned local S3 authority', () => {
    const storage: ApplicationProviderNode = {
      id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable',
      interface: 'ObjectStorage', implementation: 's3',
      config: { objectStorage: {
        kind: 's3', bucket: 'actor-state', region: 'us-east-1',
        endpoint: 'http://proof-objects.proof-system.svc:8333', forcePathStyle: true,
        ownership: 'direct-provisioned',
        credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'proof-object-credentials', namespace: 'proof-system' },
        provisioning: { kind: 'local-s3', enabled: true, name: 'proof-objects', storageSize: '1Gi' },
      } },
    };
    const actor = providerNode('ActorRuntime');
    const graph: ApplicationGraph = { ...emptyGraph(), nodes: [storage, actor] };
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'ActorRuntime' && candidate.implementation === 'target-selected');
    const contribution = contributor!.contribute(actor, { ...context('kubernetes'), graph });

    expect(contribution.edges).toContainEqual({
      from: 'direct.provider.ObjectStorage.local-s3',
      to: 'direct.provider.ActorRuntime.celld',
      relationship: 'requiresReady',
    });
  });

  it('lowers ClickStack into explicit operator, ClickHouse, and OTLP gateway lifecycle nodes', () => {
    const provider: ApplicationProviderNode = {
      id: 'provider.Observability', kind: 'provider', name: 'Observability', stability: 'stable',
      interface: 'Observability', implementation: 'clickstack',
      config: { observability: { kind: 'clickstack', namespace: 'telemetry', storageSize: '20Gi', policy: {}, retention: {} } },
    };
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'Observability' && candidate.implementation === 'clickstack');
    const contribution = contributor!.contribute(provider, context('kubernetes'));
    expect(contribution.nodes.map(({ id }) => id)).toEqual([
      'direct.provider.Observability.clickhouse-operator',
      'external.provider.Observability.clickstack-credentials',
      'direct.provider.Observability.clickhouse',
      'direct.provider.Observability.clickstack',
    ]);
    const serialized = JSON.stringify(contribution);
    expect(serialized).toContain('clickhouse-password');
    expect(serialized).toContain('hyperdx-api-key');
    expect(serialized).toContain('values.yaml');
    expect(serialized).toContain('passwordSecretRef');
    expect(serialized).not.toContain('CLICKHOUSE_PASSWORD":"');
    expect(serialized).not.toContain('HYPERDX_API_KEY":"');
    expect(serialized).toContain('"consumers":["provider.Observability"');
    expect(contribution.edges).toContainEqual({
      from: 'external.provider.Observability.clickstack-credentials',
      to: 'direct.provider.Observability.clickhouse',
      relationship: 'requiresReady',
    });
    expect(contribution.edges).toContainEqual({
      from: 'external.provider.Observability.clickstack-credentials',
      to: 'direct.provider.Observability.clickstack',
      relationship: 'requiresReady',
    });
    expect(contribution.edges).toContainEqual({
      from: 'direct.provider.Observability.clickhouse',
      to: 'direct.provider.Observability.clickstack',
      relationship: 'requiresReady',
    });
  });

  it('bounds ClickStack identities before Altinity derives its host resources', () => {
    const provider: ApplicationProviderNode = {
      id: 'provider.Observability', kind: 'provider', name: 'Observability', stability: 'stable',
      interface: 'Observability', implementation: 'clickstack',
      config: { observability: { kind: 'clickstack', namespace: 'telemetry', policy: {}, retention: {} } },
    };
    const contributor = builtinApplicationDeploymentContributors().find((candidate) =>
      candidate.interface === 'Observability' && candidate.implementation === 'clickstack');
    const longContext = {
      ...context('kubernetes'),
      graph: {
        ...context('kubernetes').graph,
        metadata: { name: 'a-very-long-application-name-that-would-overflow-altinity-derived-resources' },
      },
    };
    const contribution = contributor!.contribute(provider, longContext);
    const cluster = contribution.nodes.find(({ id }) => id.endsWith('.clickhouse'));
    const stack = contribution.nodes.find(({ id }) => id.endsWith('.clickstack'));
    if (!cluster || !stack) throw new Error('ClickStack contribution omitted its cluster or stack node.');
    const clusterName = String(jsonObject(jsonObject(cluster.spec).configuration).name);
    const stackName = String(jsonObject(jsonObject(jsonObject(stack.spec).configuration).instance).name);

    expect(clusterName.length).toBeLessThanOrEqual(34);
    expect(`chi-${clusterName}-cluster-0-0`.length).toBeLessThanOrEqual(63);
    expect(`chi-${clusterName}-cluster-0-0-0`.length).toBeLessThanOrEqual(63);
    expect(`chi-${clusterName}-common-configd`.length).toBeLessThanOrEqual(63);
    expect(`chi-${clusterName}-common-usersd`.length).toBeLessThanOrEqual(63);
    expect(`chi-${clusterName}-deploy-confd-cluster-0-0`.length).toBeLessThanOrEqual(63);
    expect(stackName.length).toBeLessThanOrEqual(23);
    expect(clusterName).toMatch(/-[a-f0-9]{8}-clickhouse$/u);
  });

  it('lowers an explicit Celld provider to a generated OCI Worker and reference-only credentials', () => {
    const provider: ApplicationProviderNode = {
      id: 'provider.ActorRuntime', kind: 'provider', name: 'ActorRuntime', stability: 'stable',
      interface: 'ActorRuntime', implementation: 'celld-actors',
      config: { actorRuntime: {
        kind: 'celld-actors', replicas: 2,
        stateStore: {
          kind: 's3', bucket: 'actor-state', region: 'us-east-1', endpoint: 'http://s3.storage.svc:9000', forcePathStyle: true,
          credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'actor-state-credentials', namespace: 'default' },
        },
      } },
    };
    const contributor = builtinApplicationDeploymentContributors().find((candidate) => candidate.interface === 'ActorRuntime' && candidate.implementation === 'celld-actors');
    const contribution = contributor!.contribute(provider, context('kubernetes'));
    expect(contribution.nodes.map(({ id }) => id)).toEqual([
      'external.provider.ActorRuntime.celld-authorization',
      'direct.provider.ActorRuntime.celld',
    ]);
    expect(contribution.edges).toContainEqual({
      from: 'artifact.celld-runtime',
      to: 'direct.provider.ActorRuntime.celld',
      relationship: 'requiresOutput',
      output: 'immutableReference',
    });
    expect(JSON.stringify(contribution.nodes)).toContain(
      'http://proof-api.proof-system.svc.cluster.local:8080',
    );
    expect(JSON.stringify(contribution.nodes)).not.toContain('authorization":"');
  });
});

function providerNode(providerInterface: 'Scheduler' | 'ActorRuntime' | 'EventLog'): ApplicationProviderNode {
  return {
    id: `provider.${providerInterface}`,
    kind: 'provider',
    name: providerInterface,
    stability: 'stable',
    interface: providerInterface,
    implementation: 'target-selected',
  };
}

function context(target: 'local' | 'aws-local' | 'aws' | 'kubernetes') {
  return {
    graph: emptyGraph(),
    target,
    connection: { provider: target, cluster: target, digest: `sha256:${'0'.repeat(64)}` },
    instance: 'proof',
    profile: 'starter',
    strategy: 'direct' as const,
    installationSpec: {},
    materializedComposition: {
      resources: [{
        id: 'proofHttpService',
        template: {
          apiVersion: 'v1', kind: 'Service',
          metadata: {
            name: 'proof-api', namespace: 'proof-system',
            labels: { 'app.kubernetes.io/component': 'typed-http' },
          },
          spec: {
            selector: { 'app.kubernetes.io/component': 'typed-http' },
            ports: [{ name: 'http', port: 8080, targetPort: 'http' }],
          },
        },
      }],
      status: {},
    },
  };
}

function emptyGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'proof' }, nodes: [], edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected deployment JSON object.');
  }
  return value as Readonly<Record<string, unknown>>;
}
