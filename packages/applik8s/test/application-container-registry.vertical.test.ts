// typecast-file-boundary: vertical fixtures inspect normalized provider configuration and preserve literal discriminators for assertions.
import { app, applicationGraphFor, ContainerRegistry } from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('application ContainerRegistry capability', () => {
  it('records a credential-free Harbor deployment contract in the ApplicationGraph', () => {
    const application = app('registry-contract', { namespace: 'registry-contract' });
    const endpoint = ContainerRegistry.nodePort({
      namespace: 'harbor-system',
      service: 'harbor',
      port: 32_080,
      protocol: 'http',
      publishHost: '192.0.2.10',
      pullHost: '127.0.0.1',
    });
    const binding = application.provide(ContainerRegistry, ContainerRegistry.harbor({
      endpoint,
      project: 'registry-contract',
      pushCredentials: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'registry-contract-push',
        namespace: 'registry-control',
      },
      pullSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'registry-contract-pull',
        namespace: 'registry-contract',
      },
      tls: { plainHttp: true },
    }));

    expect(binding).toMatchObject({
      kind: 'applicationProvider',
      implementation: { kind: 'harbor-container-registry', project: 'registry-contract' },
    });
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'ContainerRegistry',
        implementation: 'harbor-container-registry',
        config: {
          bindingKind: 'provided',
          provider: 'harbor-container-registry',
          containerRegistry: {
            kind: 'harbor-container-registry',
            endpoint,
            project: 'registry-contract',
            pushCredentials: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: 'registry-contract-push',
              namespace: 'registry-control',
            },
            pullSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: 'registry-contract-pull',
              namespace: 'registry-contract',
            },
            tls: { plainHttp: true },
          },
        },
      }),
    ]));
  });

  it('records an installation-selected deployment provider', () => {
    const application = app('selected-registry', {
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'SelectedRegistryInstallation',
      spec: type({ profile: "'starter' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    const local = ContainerRegistry.orbstack();
    const external = ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin('https://registry.example.test'),
      repositoryPrefix: 'selected-registry',
    });
    application.provide(ContainerRegistry, application.selectProvider(application.installation.spec.profile, {
      external,
      default: local,
    }));

    const provider = applicationGraphFor(application.composition)?.nodes.find((node) => node.kind === 'provider' && node.interface === 'ContainerRegistry');
    expect(provider).toMatchObject({
      kind: 'provider',
      implementation: 'application-provider-selection',
      config: {
        containerRegistry: {
          kind: 'application-provider-selection',
          selector: 'schema.spec.profile',
          cases: { external: { kind: 'oci-container-registry' } },
          default: { kind: 'orbstack-container-registry' },
        },
      },
    });
  });

  it('derives a cluster-global Harbor project from the concrete installation while keeping Secret names resolvable', () => {
    const application = app('installable-registry', {
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'RegistryInstallation',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const project = application.installation.spec.name;
    const endpoint = ContainerRegistry.nodePort({ namespace: 'harbor-system', service: 'harbor', port: 32_080, protocol: 'http' });
    expect(() => ContainerRegistry.harbor({
      endpoint,
      project,
      management: {
        adminCredentials: { apiVersion: 'v1', kind: 'Secret', name: 'harbor-admin', namespace: 'harbor-system' },
        secretNamespace: project,
      },
    })).toThrow(/requires explicit management\.pushSecretName and management\.pullSecretName/);

    application.provide(ContainerRegistry, ContainerRegistry.harbor({
      endpoint,
      project,
      management: {
        adminCredentials: { apiVersion: 'v1', kind: 'Secret', name: 'harbor-admin', namespace: 'harbor-system' },
        secretNamespace: project,
        pushSecretName: 'registry-push',
        pullSecretName: 'registry-pull',
      },
    }));
    const provider = applicationGraphFor(application.composition)?.nodes.find((node) => node.kind === 'provider' && node.interface === 'ContainerRegistry');
    if (provider?.kind !== 'provider') throw new Error('Expected an installation-derived ContainerRegistry provider node.');
    const installationName = ['$', '{schema.spec.name}'].join('');
    expect(provider?.config?.containerRegistry).toMatchObject({
      project: installationName,
      pushCredentials: { name: 'registry-push', namespace: installationName },
      pullSecret: { name: 'registry-pull', namespace: installationName },
    });
  });

  it('supports provider-neutral OCI and OrbStack bindings and fails closed on unsafe Harbor declarations', () => {
    expect(ContainerRegistry.orbstack()).toEqual({ kind: 'orbstack-container-registry' });
    expect(ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin('https://registry.example.test'),
      repositoryPrefix: 'applications',
    })).toMatchObject({ kind: 'oci-container-registry', repositoryPrefix: 'applications' });
    expect(() => ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('https://harbor.example.test'),
      project: 'applications',
      pushCredentials: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'push',
        namespace: 'control',
      },
    } as never)).toThrow(/pullSecret/);
    expect(() => ContainerRegistry.nodePort({
      namespace: 'harbor-system',
      service: 'harbor',
      port: 32_080,
      protocol: 'http',
      publishHost: ' ',
    })).toThrow(/publishHost must not be empty/);
    expect(() => ContainerRegistry.nodePort({
      namespace: 'harbor-system',
      service: 'harbor',
      port: 32_080,
      protocol: 'http',
      pullHost: ' ',
    })).toThrow(/pullHost must not be empty/);
    expect(ContainerRegistry.origin('HTTPS://REGISTRY.EXAMPLE.TEST:443/')).toEqual({
      kind: 'origin',
      origin: 'https://registry.example.test',
    });
    for (const origin of [
      'https://robot:secret@registry.example.test',
      'https://registry.example.test/project',
      'https://registry.example.test?token=secret',
      'https://registry.example.test#credential',
      'ftp://registry.example.test',
      ' https://registry.example.test',
    ]) {
      expect(() => ContainerRegistry.origin(origin)).toThrow(/ContainerRegistry origin/);
    }
  });

  it('derives purpose-scoped robot Secret references from one managed Harbor project declaration', () => {
    expect(ContainerRegistry.harbor({
      endpoint: ContainerRegistry.nodePort({
        namespace: 'harbor-system',
        service: 'harbor',
        port: 32_080,
        protocol: 'http',
      }),
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
        autoScan: true,
        autoSbomGeneration: true,
        immutableTags: { tagPattern: 'sha-*' },
        retention: { keepMostRecent: 50 },
      },
      tls: { plainHttp: true },
    })).toMatchObject({
      kind: 'harbor-container-registry',
      project: 'chirp',
      pushCredentials: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'chirp-registry-push',
        namespace: 'chirp',
        dockerConfigJsonKey: '.dockerconfigjson',
      },
      pullSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'chirp-registry-pull',
        namespace: 'chirp',
      },
    });
    expect(() => ContainerRegistry.harbor({
      endpoint: ContainerRegistry.origin('https://harbor.example.test'),
      project: 'chirp',
      management: {
        adminCredentials: {
          apiVersion: 'v1',
          kind: 'Secret',
          name: 'harbor-admin',
          namespace: 'harbor-system',
          username: 'admin',
          usernameKey: 'username',
        },
        secretNamespace: 'chirp',
      },
    })).toThrow(/either username or usernameKey/);
  });
});
