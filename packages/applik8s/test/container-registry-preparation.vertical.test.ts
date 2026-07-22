// typecast-file-boundary: registry-preparation fixtures preserve literal receipt discriminators and inspect dynamic provider calls.
import {
  ContainerRegistry,
} from '@applik8s/applik8s';
import { describe, expect, it, vi } from 'vitest';
import { resolveApplicationContainerRegistry } from '../src/container-deployment-plan.js';
import {
  deleteApplicationContainerRegistryPreparation,
  prepareApplicationContainerRegistry,
} from '../src/container-registry-preparation.js';

describe('application ContainerRegistry preparation', () => {
  it('reconciles a managed Harbor project and its purpose-scoped robots before builds', async () => {
    const provider = ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('http://harbor.example.test:32080'),
      project: 'chirp',
      management: {
        adminCredentials: {
          apiVersion: 'v1',
          kind: 'Secret',
          name: 'harbor-admin',
          namespace: 'harbor-system',
          username: 'admin',
          passwordKey: 'HARBOR_ADMIN_PASSWORD',
        },
        secretNamespace: 'chirp',
        pushRobotName: 'chirp-builder',
        pullRobotName: 'chirp-runtime',
        autoScan: true,
        autoSbomGeneration: true,
        immutableTags: { tagPattern: 'sha-*' },
        retention: { keepMostRecent: 50 },
      },
    });
    const resolved = await resolveApplicationContainerRegistry(provider, async () => {
      throw new Error('unexpected NodePort resolution');
    });
    const ensureNamespace = vi.fn(async (_context: string, namespace: string) => ({
      apiVersion: 'applik8s.deployment/v1alpha1' as const,
      kind: 'DirectNamespacePreparation' as const,
      namespace,
      instanceName: namespace,
      ownership: 'managed' as const,
      created: true,
    }));
    const deleteNamespace = vi.fn(async () => undefined);
    const reconcileHarborProject = vi.fn(async () => undefined);
    const deleteHarborProject = vi.fn(async () => undefined);

    await expect(prepareApplicationContainerRegistry(resolved, 'orbstack', {
      ensureNamespace,
      deleteNamespace,
      reconcileHarborProject,
      deleteHarborProject,
    })).resolves.toEqual({
      provider: 'managed-harbor',
      project: 'chirp',
      secretNamespace: 'chirp',
      pushSecretName: 'chirp-registry-push',
      pullSecretName: 'chirp-registry-pull',
      directPreparations: [{
        apiVersion: 'applik8s.deployment/v1alpha1',
        kind: 'DirectNamespacePreparation',
        namespace: 'chirp',
        instanceName: 'chirp',
        ownership: 'managed',
        created: true,
      }],
    });
    expect(ensureNamespace).toHaveBeenCalledWith('orbstack', 'chirp');
    expect(reconcileHarborProject).toHaveBeenCalledWith(expect.objectContaining({
      context: 'orbstack',
      endpoint: 'http://harbor.example.test:32080',
      project: 'chirp',
      registry: 'http://harbor.example.test:32080',
      allowPlainHttp: true,
      insecure: false,
      secretNamespace: 'chirp',
      policy: {
        autoScan: true,
        autoSbomGeneration: true,
        immutableTags: { tagPattern: 'sha-*' },
        retention: { keepMostRecent: 50 },
      },
      robots: [
        { name: 'chirp-builder', secretName: 'chirp-registry-push', access: 'push', registry: 'http://harbor.example.test:32080' },
        { name: 'chirp-runtime', secretName: 'chirp-registry-pull', access: 'pull', registry: 'http://harbor.example.test:32080' },
      ],
    }));
  });

  it('leaves external registries untouched', async () => {
    const resolved = await resolveApplicationContainerRegistry(ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin('https://registry.example.test'),
      repositoryPrefix: 'applications',
    }), async () => {
      throw new Error('unexpected NodePort resolution');
    });
    const runtime = {
      ensureNamespace: vi.fn(async (_context: string, namespace: string) => ({
        apiVersion: 'applik8s.deployment/v1alpha1' as const,
        kind: 'DirectNamespacePreparation' as const,
        namespace,
        instanceName: namespace,
        ownership: 'managed' as const,
      })),
      deleteNamespace: vi.fn(async () => undefined),
      reconcileHarborProject: vi.fn(async () => undefined),
      deleteHarborProject: vi.fn(async () => undefined),
    };
    await expect(prepareApplicationContainerRegistry(resolved, 'production', runtime)).resolves.toEqual({
      provider: 'external',
    });
    expect(runtime.ensureNamespace).not.toHaveBeenCalled();
    expect(runtime.reconcileHarborProject).not.toHaveBeenCalled();
  });

  it('deletes only managed direct preparation through the recorded TypeKro lifecycle', async () => {
    const runtime = {
      ensureNamespace: vi.fn(),
      deleteNamespace: vi.fn(async () => undefined),
      reconcileHarborProject: vi.fn(),
      deleteHarborProject: vi.fn(async () => undefined),
    };
    await deleteApplicationContainerRegistryPreparation({
      provider: 'managed-harbor',
      directPreparations: [
        {
          apiVersion: 'applik8s.deployment/v1alpha1',
          kind: 'DirectNamespacePreparation',
          namespace: 'external-control',
          instanceName: 'external-control',
          ownership: 'external',
        },
        {
          apiVersion: 'applik8s.deployment/v1alpha1',
          kind: 'DirectNamespacePreparation',
          namespace: 'chirp',
          instanceName: 'chirp',
          ownership: 'managed',
        },
      ],
    }, 'orbstack', runtime);

    expect(runtime.deleteNamespace).toHaveBeenCalledTimes(1);
    expect(runtime.deleteNamespace).toHaveBeenCalledWith('orbstack', expect.objectContaining({
      namespace: 'chirp',
      ownership: 'managed',
    }));

    runtime.deleteNamespace.mockClear();
    await deleteApplicationContainerRegistryPreparation({
      provider: 'managed-harbor',
      directPreparations: [{
        apiVersion: 'applik8s.deployment/v1alpha1',
        kind: 'DirectNamespacePreparation',
        namespace: 'chirp',
        instanceName: 'chirp',
        ownership: 'managed',
      }],
    }, 'orbstack', runtime, { preserveNamespaces: ['chirp'] });
    expect(runtime.deleteNamespace).not.toHaveBeenCalled();
  });

  it('deletes an explicitly disposable Harbor project before its robot Secret namespace', async () => {
    const provider = ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('http://harbor.example.test:32080'),
      project: 'chirp-preview',
      management: {
        adminCredentials: {
          apiVersion: 'v1', kind: 'Secret', name: 'harbor-admin', namespace: 'harbor-system', username: 'admin', passwordKey: 'password',
        },
        secretNamespace: 'chirp-preview',
        pushSecretName: 'chirp-push',
        pullSecretName: 'chirp-pull',
        projectLifecycle: { deletionPolicy: 'delete', purgeRepositories: true, timeoutMs: 90_000 },
      },
    });
    const resolved = await resolveApplicationContainerRegistry(provider, async () => { throw new Error('unexpected'); });
    const order: string[] = [];
    const runtime = {
      ensureNamespace: vi.fn(async (_context: string, namespace: string) => ({
        apiVersion: 'applik8s.deployment/v1alpha1' as const,
        kind: 'DirectNamespacePreparation' as const,
        namespace,
        instanceName: namespace,
        ownership: 'managed' as const,
      })),
      reconcileHarborProject: vi.fn(async () => undefined),
      deleteHarborProject: vi.fn(async () => { order.push('project'); }),
      deleteNamespace: vi.fn(async () => { order.push('namespace'); }),
    };
    const receipt = await prepareApplicationContainerRegistry(resolved, 'orbstack', runtime);
    expect(receipt.projectDeletion).toEqual(expect.objectContaining({
      endpoint: 'http://harbor.example.test:32080',
      project: 'chirp-preview',
      purgeRepositories: true,
      timeoutMs: 90_000,
      secretNamespace: 'chirp-preview',
      robotSecretNames: ['chirp-push', 'chirp-pull'],
    }));

    await deleteApplicationContainerRegistryPreparation(receipt, 'orbstack', runtime);

    expect(runtime.deleteHarborProject).toHaveBeenCalledWith(expect.objectContaining({
      context: 'orbstack',
      project: 'chirp-preview',
    }));
    expect(order).toEqual(['project', 'namespace']);
  });

  it('rolls back a newly managed Namespace through TypeKro when Harbor preparation fails', async () => {
    const provider = ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('https://harbor.example.test'),
      project: 'chirp',
      management: {
        adminCredentials: {
          apiVersion: 'v1', kind: 'Secret', name: 'harbor-admin', namespace: 'harbor-system', username: 'admin', passwordKey: 'password',
        },
        secretNamespace: 'chirp',
      },
    });
    const resolved = await resolveApplicationContainerRegistry(provider, async () => { throw new Error('unexpected'); });
    const preparation = {
      apiVersion: 'applik8s.deployment/v1alpha1' as const,
      kind: 'DirectNamespacePreparation' as const,
      namespace: 'chirp',
      instanceName: 'chirp',
      ownership: 'managed' as const,
      created: true,
    };
    const deleteNamespace = vi.fn(async () => undefined);

    await expect(prepareApplicationContainerRegistry(resolved, 'orbstack', {
      ensureNamespace: vi.fn(async () => preparation),
      deleteNamespace,
      reconcileHarborProject: vi.fn(async () => { throw new Error('Harbor unavailable'); }),
      deleteHarborProject: vi.fn(async () => undefined),
    })).rejects.toThrow(/Harbor unavailable/);
    expect(deleteNamespace).toHaveBeenCalledWith('orbstack', preparation);
  });

  it('preserves a pre-existing managed Namespace when a Harbor update fails', async () => {
    const provider = ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('https://harbor.example.test'),
      project: 'chirp',
      management: {
        adminCredentials: {
          apiVersion: 'v1', kind: 'Secret', name: 'harbor-admin', namespace: 'harbor-system', username: 'admin', passwordKey: 'password',
        },
        secretNamespace: 'chirp',
      },
    });
    const resolved = await resolveApplicationContainerRegistry(provider, async () => { throw new Error('unexpected'); });
    const preparation = {
      apiVersion: 'applik8s.deployment/v1alpha1' as const,
      kind: 'DirectNamespacePreparation' as const,
      namespace: 'chirp',
      instanceName: 'chirp',
      ownership: 'managed' as const,
      created: false,
    };
    const deleteNamespace = vi.fn(async () => undefined);

    await expect(prepareApplicationContainerRegistry(resolved, 'orbstack', {
      ensureNamespace: vi.fn(async () => preparation),
      deleteNamespace,
      reconcileHarborProject: vi.fn(async () => { throw new Error('Harbor unavailable'); }),
      deleteHarborProject: vi.fn(async () => undefined),
    })).rejects.toThrow(/Harbor unavailable/);
    expect(deleteNamespace).not.toHaveBeenCalled();
  });
});
