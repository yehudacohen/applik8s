// typecast-file-boundary: deployment fixtures preserve provider discriminants at the graph boundary.
import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';

import {
  applicationContainerRegistryFromGraph,
  resolveApplicationContainerRegistry,
} from '../src/deployment-registry.js';

describe('deployment registry binding', () => {
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

  it('canonicalizes origins and rejects credential-bearing deployment endpoints', async () => {
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
          },
          project: reference('name'),
          pushCredentials: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'push',
            namespace: reference('name'),
          },
          pullSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'pull',
            namespace: reference('name'),
          },
          management: {
            adminCredentials: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: 'admin',
              namespace: 'harbor-system',
            },
            secretNamespace: reference('name'),
            projectLifecycle: {
              deletionPolicy: reference('lifecycle.registryProjectDeletion'),
              purgeRepositories: reference('lifecycle.purgeRegistryRepositories'),
            },
          },
        },
      },
    }]));
    expect(provider).toMatchObject({
      kind: 'harbor-container-registry',
      project: reference('name'),
      management: {
        projectLifecycle: {
          purgeRepositories: reference('lifecycle.purgeRegistryRepositories'),
        },
      },
    });
  });

  it('resolves the unqualified application default without treating its named profile authority as a second registry', () => {
    const selected = {
      kind: 'oci-container-registry' as const,
      endpoint: {
        kind: 'origin' as const,
        origin: 'https://registry.example.test',
      },
      repositoryPrefix: 'chirp',
    };
    const provider = applicationContainerRegistryFromGraph(graph([
      {
        id: 'provider.container-registry.v1alpha1.images',
        kind: 'provider',
        name: 'ContainerRegistry',
        stability: 'stable',
        interface: 'ContainerRegistry',
        implementation: 'application-provider-selection',
        config: {
          bindingKind: 'provided',
          qualification: {
            apiVersion: 'applik8s.providerQualification/v1alpha1',
            capability: 'ContainerRegistry',
            compatibilityRevision: 'v1alpha1',
            key: 'ContainerRegistry@v1alpha1:images',
            name: 'images',
          },
          containerRegistry: selected,
        },
      },
      {
        id: 'provider.container-registry',
        kind: 'provider',
        name: 'ContainerRegistry',
        stability: 'stable',
        interface: 'ContainerRegistry',
        implementation: 'oci-container-registry',
        config: {
          bindingKind: 'provided',
          aliasOf: 'provider.container-registry.v1alpha1.images',
          containerRegistry: selected,
        },
      },
    ]));

    expect(provider).toEqual(selected);
  });

  it('fails closed when named registry roles have no application default', () => {
    expect(() => applicationContainerRegistryFromGraph(graph([{
      id: 'provider.container-registry.v1alpha1.images',
      kind: 'provider',
      name: 'ContainerRegistry',
      stability: 'stable',
      interface: 'ContainerRegistry',
      implementation: 'oci-container-registry',
      config: {
        qualification: {
          apiVersion: 'applik8s.providerQualification/v1alpha1',
          capability: 'ContainerRegistry',
          compatibilityRevision: 'v1alpha1',
          key: 'ContainerRegistry@v1alpha1:images',
          name: 'images',
        },
        containerRegistry: {
          kind: 'oci-container-registry',
          endpoint: {
            kind: 'origin',
            origin: 'https://registry.example.test',
          },
        },
      },
    }]))).toThrow(/no unqualified application default/);
  });
});

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
