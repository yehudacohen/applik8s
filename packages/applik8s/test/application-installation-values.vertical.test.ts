// typecast-file-boundary: Test fixtures deliberately model serialized installation values to exercise validation and recursive concretization boundaries.
import { describe, expect, test } from 'vitest';
import { resolveApplicationInstallationValues } from '../../cli/src/application-installation-values.js';

describe('application installation deployment values', () => {
  test('resolves direct descriptors and KRO strings without mutating the graph', () => {
    const graph = {
      namespace: { expression: 'schema.spec.name' },
      endpoint: `https://$${'{schema.spec.hostname}'}`,
      retained: { expression: 'schema.spec.name + "-other"' },
    };
    expect(resolveApplicationInstallationValues(graph, { name: 'chirp-a', hostname: 'chirp.test' })).toEqual({
      namespace: 'chirp-a',
      endpoint: 'https://chirp.test',
      retained: { expression: 'schema.spec.name + "-other"' },
    });
    expect(graph.namespace).toEqual({ expression: 'schema.spec.name' });
  });

  test('resolves the bounded string grammar emitted by app.interpolate', () => {
    expect(resolveApplicationInstallationValues({
      bucket: '${"" + string(schema.spec.name) + "-media"}',
    }, { name: 'community' })).toEqual({ bucket: 'community-media' });

    expect(resolveApplicationInstallationValues({ value: '${schema.spec.name.lowerAscii()}' }, { name: 'community' }))
      .toEqual({ value: '${schema.spec.name.lowerAscii()}' });
  });

  test('materializes schema-only selection and boolean CEL emitted by the application graph DSL', () => {
    const selected = '${schema.spec.profile == "external" ? schema.spec.providers.database.clusterName : ("chirp")}';
    const enabled = '${(schema.spec.profile == "external" ? false : (true)) && (schema.spec.backup.enabled)}';
    expect(resolveApplicationInstallationValues({ selected, enabled }, {
      profile: 'starter',
      backup: { enabled: true },
    })).toEqual({ selected: 'chirp', enabled: true });
    expect(resolveApplicationInstallationValues({ selected, enabled }, {
      profile: 'external',
      providers: { database: { clusterName: 'shared-cnpg' } },
      backup: { enabled: true },
    })).toEqual({ selected: 'shared-cnpg', enabled: false });
  });

  test('fails closed for missing and non-primitive interpolation values', () => {
    expect(() => resolveApplicationInstallationValues({ namespace: { expression: 'schema.spec.name' } }, {}))
      .toThrow('does not define required deployment value schema.spec.name');
    expect(() => resolveApplicationInstallationValues({ value: `prefix-$${'{schema.spec.features}'}` }, { features: { media: true } }))
      .toThrow('does not resolve to a primitive value');
  });

  test('preserves foreign prerequisite-RGD schema references while resolving root workload values', () => {
    expect(resolveApplicationInstallationValues({
      workload: { namespace: '${schema.spec.name}' },
      prerequisiteTemplate: { namespace: '${schema.spec.namespace}' },
    }, { name: 'chirp' }, { preserveUnknownReferences: true })).toEqual({
      workload: { namespace: 'chirp' },
      prerequisiteTemplate: { namespace: '${schema.spec.namespace}' },
    });
  });

  test('selects one deployment-bound provider before resolving only its concrete branch', () => {
    const selection = {
      kind: 'application-provider-selection',
      selector: 'schema.spec.profile',
      cases: {
        external: {
          kind: 'oci-container-registry',
          endpoint: { kind: 'origin', origin: '${schema.spec.providers.registry.origin}' },
          repositoryPrefix: '${schema.spec.providers.registry.repositoryPrefix}',
        },
      },
      default: {
        kind: 'harbor-container-registry',
        endpoint: { kind: 'origin', origin: 'http://127.0.0.1:32080' },
        project: '${schema.spec.name}',
      },
    } as const;

    expect(resolveApplicationInstallationValues(selection, { profile: 'starter', name: 'community' })).toEqual({
      kind: 'harbor-container-registry',
      endpoint: { kind: 'origin', origin: 'http://127.0.0.1:32080' },
      project: 'community',
    });
    expect(resolveApplicationInstallationValues(selection, {
      profile: 'external',
      providers: { registry: { origin: 'https://registry.example.test', repositoryPrefix: 'teams/community' } },
    })).toEqual({
      kind: 'oci-container-registry',
      endpoint: { kind: 'origin', origin: 'https://registry.example.test' },
      repositoryPrefix: 'teams/community',
    });
    expect(resolveApplicationInstallationValues(
      selection,
      { profile: 'starter', name: 'community' },
      { preserveInstallationReferences: true },
    )).toEqual({
      kind: 'harbor-container-registry',
      endpoint: { kind: 'origin', origin: 'http://127.0.0.1:32080' },
      project: '${schema.spec.name}',
    });
    expect(resolveApplicationInstallationValues(
      selection,
      { profile: 'external' },
      { preserveInstallationReferences: true },
    )).toEqual({
      kind: 'oci-container-registry',
      endpoint: { kind: 'origin', origin: '${schema.spec.providers.registry.origin}' },
      repositoryPrefix: '${schema.spec.providers.registry.repositoryPrefix}',
    });
  });

  test('materializes independent collision domains for bounded installations', () => {
    const installationDrivenPlan = {
      workloadNamespace: { expression: 'schema.spec.name' },
      registry: {
        project: { expression: 'schema.spec.name' },
        pullRobotName: { expression: 'schema.spec.name' },
        pullSecretNamespace: { expression: 'schema.spec.name' },
        projectDeletion: { expression: 'schema.spec.lifecycle.registryProjectDeletion' },
        purgeRepositories: { expression: 'schema.spec.lifecycle.purgeRegistryRepositories' },
      },
      exposure: {
        nodePort: { expression: 'schema.spec.exposure.nodePort' },
        publicUrl: `http://127.0.0.1:$${'{schema.spec.exposure.nodePort}'}`,
      },
      objectStorage: {
        bucket: '${"" + string(schema.spec.name) + "-media"}',
      },
    } as const;
    const community = resolveApplicationInstallationValues(installationDrivenPlan, {
      name: 'community',
      lifecycle: { registryProjectDeletion: 'retain', purgeRegistryRepositories: false },
      exposure: { nodePort: 30_080 },
    });
    const privateSite = resolveApplicationInstallationValues(installationDrivenPlan, {
      name: 'private-site',
      lifecycle: { registryProjectDeletion: 'delete', purgeRegistryRepositories: true },
      exposure: { nodePort: 30_081 },
    });

    expect(community).toEqual({
      workloadNamespace: 'community',
      registry: {
        project: 'community',
        pullRobotName: 'community',
        pullSecretNamespace: 'community',
        projectDeletion: 'retain',
        purgeRepositories: false,
      },
      exposure: { nodePort: 30_080, publicUrl: 'http://127.0.0.1:30080' },
      objectStorage: { bucket: 'community-media' },
    });
    expect(privateSite).toEqual({
      workloadNamespace: 'private-site',
      registry: {
        project: 'private-site',
        pullRobotName: 'private-site',
        pullSecretNamespace: 'private-site',
        projectDeletion: 'delete',
        purgeRepositories: true,
      },
      exposure: { nodePort: 30_081, publicUrl: 'http://127.0.0.1:30081' },
      objectStorage: { bucket: 'private-site-media' },
    });
    expect(community.workloadNamespace).not.toBe(privateSite.workloadNamespace);
    expect(community.registry.project).not.toBe(privateSite.registry.project);
    expect(community.exposure.nodePort).not.toBe(privateSite.exposure.nodePort);
    expect(community.objectStorage.bucket).not.toBe(privateSite.objectStorage.bucket);
    expect(installationDrivenPlan.registry.project).toEqual({ expression: 'schema.spec.name' });
  });
});
