// typecast-file-boundary: deployment-plan fixtures preserve literal workload and receipt discriminators for adversarial coverage.
import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';

import {
  applicationContainerRegistryFromGraph,
  applicationImageEvidence,
  applicationImageSetDigest,
  materializeApplicationImages,
  resolveApplicationContainerRegistry,
  validateApplicationImageReceipts,
  validateApplicationPullSecretCoverage,
} from '../src/container-deployment-plan.js';

describe('container deployment plan', () => {
  it('defaults to OrbStack and resolves a NodePort Harbor endpoint without ambient context', async () => {
    expect(applicationContainerRegistryFromGraph(graph([]))).toEqual({
      kind: 'orbstack-container-registry',
    });
    const provider = applicationContainerRegistryFromGraph(graph([
      {
        id: 'provider.container-registry',
        kind: 'provider',
        name: 'ContainerRegistry',
        stability: 'stable',
        interface: 'ContainerRegistry',
        implementation: 'harbor-container-registry',
        config: {
          bindingKind: 'provided',
          provider: 'harbor-container-registry',
          containerRegistry: {
            kind: 'harbor-container-registry',
            endpoint: {
              kind: 'kubernetes-node-port',
              namespace: 'harbor-system',
              service: 'harbor',
              port: 32_080,
              protocol: 'http',
              pullHost: '127.0.0.1',
            },
            project: 'applications',
            pushCredentials: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: 'applications-push',
              namespace: 'platform-control',
            },
            pullSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: 'applications-pull',
              namespace: 'applications',
            },
          },
        },
      },
    ]));
    expect(await resolveApplicationContainerRegistry(provider, async (endpoint) => {
      expect(endpoint).toMatchObject({ service: 'harbor', port: 32_080 });
      return 'http://192.0.2.10:32080';
    })).toMatchObject({
      remote: true,
      origin: 'http://192.0.2.10:32080',
      pullOrigin: 'http://127.0.0.1:32080',
      repositoryPrefix: 'applications',
      pullSecretName: 'applications-pull',
    });
  });

  it('canonicalizes resolved origins and rejects credential-bearing deployment endpoints before evidence can record them', async () => {
    const provider = {
      kind: 'oci-container-registry' as const,
      endpoint: { kind: 'origin' as const, origin: 'HTTPS://REGISTRY.EXAMPLE.TEST:443/' },
    };
    await expect(resolveApplicationContainerRegistry(provider, async () => 'unused')).resolves.toMatchObject({
      origin: 'https://registry.example.test',
      pullOrigin: 'https://registry.example.test',
    });
    await expect(resolveApplicationContainerRegistry({
      ...provider,
      endpoint: { kind: 'origin', origin: 'https://robot:secret@registry.example.test' },
    }, async () => 'unused')).rejects.toThrow(/must not contain userinfo or credentials/);
  });

  it('accepts serialized typed installation references at the deployment validation boundary', () => {
    const reference = (path: string) => ['$', `{schema.spec.${path}}`].join('');
    const provider = applicationContainerRegistryFromGraph(graph([{
      id: 'provider.container-registry', kind: 'provider', name: 'ContainerRegistry', stability: 'stable', interface: 'ContainerRegistry', implementation: 'harbor-container-registry',
      config: { bindingKind: 'provided', provider: 'harbor-container-registry', containerRegistry: {
        kind: 'harbor-container-registry',
        endpoint: { kind: 'kubernetes-node-port', namespace: 'harbor-system', service: 'harbor', port: 32_080, protocol: 'http' },
        project: reference('name'),
        pushCredentials: { apiVersion: 'v1', kind: 'Secret', name: 'push', namespace: reference('name') },
        pullSecret: { apiVersion: 'v1', kind: 'Secret', name: 'pull', namespace: reference('name') },
        management: {
          adminCredentials: { apiVersion: 'v1', kind: 'Secret', name: 'admin', namespace: 'harbor-system' },
          secretNamespace: reference('name'),
          projectLifecycle: { deletionPolicy: reference('lifecycle.registryProjectDeletion'), purgeRepositories: reference('lifecycle.purgeRegistryRepositories') },
        },
      } },
    }]));
    expect(provider).toMatchObject({ kind: 'harbor-container-registry', project: reference('name'), management: { projectLifecycle: { purgeRepositories: reference('lifecycle.purgeRegistryRepositories') } } });
  });

  it('materializes only exact authored images and injects one pull Secret per consuming Pod spec', () => {
    const logical = 'applik8s/chirp-web:sha-source';
    const immutable = 'registry.example.test/chirp/applik8s/chirp-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const resource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            imagePullSecrets: [{ name: 'existing' }],
            initContainers: [{ name: 'migration', image: logical }],
            containers: [
              { name: 'web', image: logical, imagePullPolicy: 'Never' },
              { name: 'sidecar', image: 'third-party.example.test/sidecar:v1' },
            ],
          },
        },
      },
    };
    const materialized = materializeApplicationImages(resource, [{
      logicalImage: logical,
      immutableImage: immutable,
      taggedImage: 'registry.example.test/chirp/applik8s/chirp-web:sha-source',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pushed: true,
    }], 'chirp-pull');

    expect(materialized.spec.template.spec.containers).toEqual([
      { name: 'web', image: immutable, imagePullPolicy: 'IfNotPresent' },
      { name: 'sidecar', image: 'third-party.example.test/sidecar:v1' },
    ]);
    expect(materialized.spec.template.spec.initContainers[0]?.image).toBe(immutable);
    expect(materialized.spec.template.spec.imagePullSecrets).toEqual([
      { name: 'existing' },
      { name: 'chirp-pull' },
    ]);

    const installationProject = ['$', '{schema.spec.name}'].join('');
    const projected = materializeApplicationImages(resource, [{
      logicalImage: logical,
      immutableImage: immutable,
      taggedImage: 'registry.example.test/chirp/applik8s/chirp-web:sha-source',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pushed: true,
    }], 'chirp-pull', { published: 'chirp', deployment: installationProject });
    expect(projected.spec.template.spec.containers[0]?.image).toBe(
      `registry.example.test/${installationProject}/applik8s/chirp-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    );
  });

  it('fails closed on incomplete remote publication and emits graph-bound deterministic evidence', () => {
    const receipt = {
      logicalImage: 'applik8s/chirp-web:sha-source',
      immutableImage: 'registry.example.test/chirp/applik8s/chirp-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      taggedImage: 'registry.example.test/chirp/applik8s/chirp-web:sha-source',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pushed: true,
      platforms: ['linux/arm64'],
      artifact: { class: 'application-host' as const, name: 'chirp-web' },
    };
    expect(() => validateApplicationImageReceipts([{ ...receipt, pushed: false }], true)).toThrow(/not a pushed, registry-verified immutable digest/);
    const provider = containerRegistryFixture();
    const resolved = {
      provider,
      origin: 'https://registry.example.test',
      repositoryPrefix: 'chirp',
      remote: true,
      pullSecretName: 'chirp-pull',
    } as const;
    const evidence = applicationImageEvidence({ path: 'application-graph.json', digest: 'sha256:graph' }, resolved, [receipt]);
    expect(evidence).toMatchObject({
      kind: 'ApplicationImageEvidence',
      artifactSetDigest: applicationImageSetDigest([receipt]),
      applicationGraph: { digest: 'sha256:graph' },
      registry: { kind: 'oci-container-registry', remote: true },
    });
    expect(applicationImageSetDigest([receipt])).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(applicationImageSetDigest([receipt])).toBe(applicationImageSetDigest([receipt]));
    expect(applicationImageSetDigest([{ ...receipt, publication: 'built' }])).toBe(
      applicationImageSetDigest([{ ...receipt, publication: 'reused' }]),
    );
    const { platforms: _platforms, ...receiptWithoutPlatforms } = receipt;
    expect(applicationImageSetDigest([{ ...receipt, platforms: ['linux/arm64'] }])).toBe(
      applicationImageSetDigest([receiptWithoutPlatforms]),
    );
    expect(applicationImageSetDigest([{ ...receipt, logicalImage: 'applik8s/chirp-web:component-build-a' }])).toBe(
      applicationImageSetDigest([{ ...receipt, logicalImage: 'applik8s/chirp-web:component-build-b' }]),
    );
  });

  it('requires a least-privilege pull Secret in every authored workload namespace', () => {
    const receipt = {
      logicalImage: 'applik8s/chirp-web:sha-source',
      immutableImage: 'registry.example.test/chirp/chirp-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      taggedImage: 'registry.example.test/chirp/chirp-web:sha-source',
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pushed: true,
    };
    const workload = (namespace: string) => ({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'chirp-web', namespace },
      spec: { template: { spec: { containers: [{ name: 'web', image: receipt.logicalImage }] } } },
    });
    const pullSecret = { apiVersion: 'v1' as const, kind: 'Secret' as const, name: 'chirp-pull', namespace: 'chirp' };

    expect(validateApplicationPullSecretCoverage([workload('chirp')], [receipt], pullSecret)).toEqual(['chirp']);
    expect(() => validateApplicationPullSecretCoverage([workload('another')], [receipt], pullSecret)).toThrow(/cannot use ContainerRegistry pull Secret/);
    expect(() => validateApplicationPullSecretCoverage([workload('$' + '{schema.spec.namespace}')], [receipt], pullSecret)).toThrow(/no concrete namespace projection/);
  });
});

function containerRegistryFixture() {
  return {
    kind: 'oci-container-registry' as const,
    endpoint: { kind: 'origin' as const, origin: 'https://registry.example.test' },
    repositoryPrefix: 'chirp',
    pullSecret: { apiVersion: 'v1' as const, kind: 'Secret' as const, name: 'chirp-pull', namespace: 'chirp' },
  };
}

function graph(nodes: ApplicationGraph['nodes']): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'test' },
    nodes,
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}
