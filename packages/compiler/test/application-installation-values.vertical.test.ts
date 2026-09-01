// typecast-file-boundary: Compiler tests inspect serialized installation artifacts and deliberately malformed values beyond their authored generic types.

import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, test } from 'vitest';
import { applicationGraphAllConditions, applicationGraphBooleanCondition, applicationGraphInterpolate, applicationGraphJsonStringArray, applicationGraphServiceHost, applicationGraphStringValue, applicationKroIncludeWhen } from '../src/application-installation-values.js';
import {
  materializeApplicationInstallationValue,
  materializeInstallationComposition,
} from '../src/application-deployment-graph.js';
import { injectGeneratedResourcesIntoApplicationRgd } from '../src/pipeline/application-artifacts.js';

describe('installation-derived compiler values', () => {
  test('concretizes profile execution identities before generated artifact validation', async () => {
    const graph = {
      metadata: { name: 'chirp' },
      nodes: [{
        id: 'workflow.rebuild',
        kind: 'workflow',
        name: 'rebuild',
        namespace: {
          [Symbol.for('TypeKro.KubernetesRef')]: true,
          resourceId: '__schema__',
          fieldPath: 'spec.name',
        },
        storage: {
          secret: {
            expression: 'schema.spec.providers.storage.secretName',
          },
          secretNamespace: '${schema.spec.name}',
        },
      }],
      edges: [],
    };

    await expect(materializeApplicationInstallationValue(graph, {
      name: 'chirp-system',
      providers: { storage: { secretName: 'chirp-storage' } },
    })).resolves.toMatchObject({
      nodes: [{
        namespace: 'chirp-system',
        storage: {
          secret: 'chirp-storage',
          secretNamespace: 'chirp-system',
        },
      }],
    });
    expect(graph.nodes[0]?.namespace).toMatchObject({
      resourceId: '__schema__',
      fieldPath: 'spec.name',
    });
  });

  test('uses TypeKro evaluation for a concrete validation view while preserving resource expressions', async () => {
    const symbolic = {
      resources: [{
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          namespace: '${schema.spec.name}',
          name: '${schema.spec.profile == "dedicated" ? "managed" : schema.spec.external.name}',
        },
        data: {
          observed: '${database.status.connection}',
          selected: {
            expression: 'schema.spec.profile == "dedicated" ? "yes" : "no"',
          },
        },
      }],
      status: {},
      clusterApiPrerequisites: [],
    } as const;
    const concrete = await materializeInstallationComposition(symbolic, {
      name: 'chirp-dedicated',
      profile: 'dedicated',
      external: { name: 'unused' },
    });
    expect(concrete.resources[0]?.metadata).toEqual({
      namespace: 'chirp-dedicated',
      name: 'managed',
    });
    expect(concrete.resources[0]?.data).toEqual({
      observed: '${database.status.connection}',
      selected: 'yes',
    });
    expect(symbolic.resources[0]?.metadata.namespace).toBe('${schema.spec.name}');
  });

  test('preserves live and JSON-normalized TypeKro references', () => {
    expect(applicationGraphStringValue({ expression: 'schema.spec.name' })).toBe(`$${'{schema.spec.name}'}`);
    expect(applicationGraphStringValue({
      [Symbol.for('TypeKro.KubernetesRef')]: true,
      resourceId: '__schema__',
      fieldPath: 'spec.hostname',
    })).toBe(`$${'{schema.spec.hostname}'}`);
    expect(applicationGraphServiceHost('chirp-index', { expression: 'schema.spec.name' }))
      .toBe(`chirp-index.$${'{schema.spec.name}'}.svc.cluster.local`);
    expect(applicationGraphStringValue('__KUBERNETES_REF___schema___spec.name__'))
      .toBe('${schema.spec.name}');
  });

  test('lowers graph-aware interpolation and JSON endpoint arrays once', () => {
    expect(
      applicationGraphInterpolate(
        '${schema.spec.events.prefix}',
        '.commands.post-created.v1.>',
      ),
    ).toBe(
      '${string(schema.spec.events.prefix) + ".commands.post-created.v1.>"}',
    );
    expect(
      applicationGraphJsonStringArray([
        '${schema.spec.events.server}',
      ]),
    ).toBe(
      '${"[\\"" + string(schema.spec.events.server) + "\\"]"}',
    );
    expect(
      applicationGraphJsonStringArray([
        'nats://events.messaging.svc:4222',
      ]),
    ).toBe('["nats://events.messaging.svc:4222"]');
  });

  test('combines optional provider feature and provisioning switches without raw authoring CEL', () => {
    expect(applicationGraphBooleanCondition(true)).toBe('true');
    expect(applicationGraphBooleanCondition(false)).toBe('false');
    expect(applicationKroIncludeWhen('true')).toBeUndefined();
    expect(applicationKroIncludeWhen('false')).toBe('${false}');
    expect(applicationKroIncludeWhen('${schema.spec.enabled}')).toBe('${schema.spec.enabled}');
    expect(applicationGraphAllConditions(true, true)).toBeUndefined();
    expect(applicationGraphAllConditions(true, false)).toBe('false');
    expect(applicationGraphAllConditions(
      { expression: 'schema.spec.features.analytics' },
      { expression: 'schema.spec.profile != "external"' },
    )).toBe('${(schema.spec.features.analytics) && (schema.spec.profile != "external")}');
  });

  test('conditions the complete analytical provider graph from its qualified config', () => {
    const enabled = '${schema.spec.features.analytics}';
    const graph = {
      nodes: [{
        id: 'provider.analytics',
        kind: 'provider',
        name: 'AnalyticalDatabase',
        stability: 'stable',
        interface: 'AnalyticalDatabase',
        implementation: 'clickhouse',
        config: {
          bindingKind: 'provided',
          analyticalDatabase: {
            kind: 'clickhouse',
            enabled,
            provision: true,
          },
        },
      }],
    } as unknown as ApplicationGraph;
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1',
            kind: 'Chirp',
            spec: { features: { analytics: 'boolean' } },
            status: {},
          },
          resources: [
            {
              id: 'repository',
              externalRef: {
                apiVersion: 'kro.run/v1alpha1',
                kind: 'ClickHouseHelmRepository',
                metadata: { name: 'clickhouse', namespace: 'typekro-system' },
              },
            },
            {
              id: 'operator',
              externalRef: {
                apiVersion: 'kro.run/v1alpha1',
                kind: 'ClickHouseOperatorBootstrap',
                metadata: { name: 'clickhouse', namespace: 'typekro-system' },
              },
            },
            {
              id: 'cluster',
              template: {
                apiVersion: 'clickhouse.altinity.com/v1',
                kind: 'ClickHouseInstallation',
                metadata: { name: 'chirp-analytics', namespace: 'chirp' },
                spec: {},
              },
            },
          ],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'chirp', undefined, graph);

    const resources = (artifacts.resources[0]?.spec as { resources: Array<{ includeWhen?: string[] }> }).resources;
    expect(resources).toHaveLength(3);
    expect(resources.every((resource) => resource.includeWhen?.includes(enabled))).toBe(true);
  });

  test('replaces legacy raw server scaffolding when a function-native HTTP worker is emitted', () => {
    const graph = {
      nodes: [{
        id: 'server.public-api',
        kind: 'server',
        name: 'public-api',
        stability: 'stable',
        routes: [{
          id: 'create-post',
          named: true,
          method: 'POST',
          path: '/posts',
          functionNative: {},
        }],
        resources: [],
        indexes: [],
        observability: {},
        generatedResources: [
          {
            role: 'workload',
            graphNode: { nodeId: 'server.public-api' },
            resource: {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              name: 'public-api',
              namespace: 'chirp',
            },
          },
          {
            role: 'service',
            graphNode: { nodeId: 'server.public-api' },
            resource: {
              apiVersion: 'v1',
              kind: 'Service',
              name: 'public-api',
              namespace: 'chirp',
            },
          },
          {
            role: 'rbac',
            graphNode: { nodeId: 'server.public-api' },
            resource: {
              apiVersion: 'rbac.authorization.k8s.io/v1',
              kind: 'Role',
              name: 'public-api',
              namespace: 'chirp',
            },
          },
          {
            role: 'runtimeBundle',
            graphNode: { nodeId: 'server.public-api' },
            resource: {
              apiVersion: 'v1',
              kind: 'ConfigMap',
              name: 'public-api-source',
              namespace: 'chirp',
            },
          },
        ],
      }],
    } as unknown as ApplicationGraph;
    const old = (apiVersion: string, kind: string, name: string) => ({
      id: `old${kind}`,
      template: {
        apiVersion,
        kind,
        metadata: {
          name,
          namespace: 'chirp',
          labels: { runtime: 'legacy' },
        },
      },
    });
    const generated = (apiVersion: string, kind: string) => ({
      apiVersion,
      kind,
      metadata: {
        name: 'public-api',
        namespace: 'chirp',
        labels: { runtime: 'function-native' },
      },
    });
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1',
            kind: 'Chirp',
            spec: {},
            status: {},
          },
          resources: [
            old('v1', 'ServiceAccount', 'public-api'),
            old('rbac.authorization.k8s.io/v1', 'Role', 'public-api'),
            old('rbac.authorization.k8s.io/v1', 'RoleBinding', 'public-api'),
            old('v1', 'ConfigMap', 'public-api-source'),
            old('v1', 'Service', 'public-api'),
            old('apps/v1', 'Deployment', 'public-api'),
            old('v1', 'Secret', 'unrelated'),
          ],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [
      generated('v1', 'ServiceAccount'),
      generated('v1', 'Service'),
      generated('apps/v1', 'Deployment'),
    ], 'chirp', undefined, graph);

    const resources = (artifacts.resources[0]?.spec as {
      resources: Array<{
        template?: {
          kind?: string;
          metadata?: { name?: string; labels?: { runtime?: string } };
        };
      }>;
    }).resources;
    expect(resources.filter((resource) =>
      resource.template?.metadata?.name === 'public-api')).toHaveLength(3);
    expect(resources.filter((resource) =>
      resource.template?.metadata?.labels?.runtime === 'function-native'))
      .toHaveLength(3);
    expect(resources.some((resource) =>
      resource.template?.metadata?.name === 'public-api-source')).toBe(false);
    expect(resources.some((resource) =>
      resource.template?.metadata?.name === 'unrelated')).toBe(true);
  });

  test('does not block external consumers on profile-conditional managed streams', () => {
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1',
            kind: 'Chirp',
            spec: { profile: 'string' },
            status: {},
          },
          resources: [],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [
      {
        apiVersion: 'jetstream.nats.io/v1beta2',
        kind: 'Stream',
        metadata: {
          name: 'events',
          namespace: 'chirp',
          annotations: {
            'applik8s.dev/include-when': '${schema.spec.profile != "external"}',
          },
        },
        spec: {
          name: 'EVENTS',
          subjects: ['events.>'],
        },
      },
      {
        apiVersion: 'jetstream.nats.io/v1beta2',
        kind: 'Consumer',
        metadata: {
          name: 'commands',
          namespace: 'chirp',
        },
        spec: {
          streamName: 'EVENTS',
          durableName: 'commands',
        },
      },
    ], 'chirp');

    const resources = (artifacts.resources[0]?.spec as {
      resources: Array<{
        id?: string;
        readyWhen?: readonly string[];
        template?: {
          kind?: string;
          metadata?: {
            annotations?: Record<string, string>;
            labels?: Record<string, string>;
          };
        };
      }>;
    }).resources;
    const stream = resources.find((resource) =>
      resource.template?.kind === 'Stream');
    const consumer = resources.find((resource) =>
      resource.template?.kind === 'Consumer');
    const dependencies = Object.entries(
      consumer?.template?.metadata?.annotations ?? {},
    ).filter(([key]) => key.startsWith('typekro.dev/depends-on-'));
    expect(stream?.id).toEqual(expect.any(String));
    expect(dependencies).toEqual([]);
  });

  test('orders generated application workloads after the authoritative migration Job', () => {
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'agentic-start' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1',
            kind: 'AgenticStart',
            spec: {},
            status: {},
          },
          resources: [],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: 'agentic-start-application-migration',
          namespace: 'agentic-start-system',
          labels: {
            'app.kubernetes.io/component': 'migration',
            'app.kubernetes.io/managed-by': 'applik8s',
          },
        },
        spec: {},
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'agentic-start-app',
          namespace: 'agentic-start-system',
          labels: {
            'app.kubernetes.io/component': 'application',
          },
        },
        spec: {},
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: {
          name: 'agentic-start-app',
          namespace: 'agentic-start-system',
          labels: {
            'app.kubernetes.io/managed-by': 'applik8s',
          },
        },
        spec: {},
      },
    ], 'agentic-start');

    const resources = (artifacts.resources[0]?.spec as {
      resources: Array<{
        id?: string;
        readyWhen?: readonly string[];
        template?: {
          kind?: string;
          metadata?: {
            annotations?: Record<string, string>;
            labels?: Record<string, string>;
          };
        };
      }>;
    }).resources;
    const migration = resources.find((resource) =>
      resource.template?.kind === 'Job');
    const deployment = resources.find((resource) =>
      resource.template?.kind === 'Deployment');
    const service = resources.find((resource) =>
      resource.template?.kind === 'Service');
    const dependencyValues = (entry: typeof deployment) =>
      Object.entries(entry?.template?.metadata?.annotations ?? {})
        .filter(([key]) => key.startsWith('typekro.dev/depends-on-'))
        .map(([, value]) => value);

    expect(migration?.id).toEqual(expect.any(String));
    expect(dependencyValues(deployment)).toContain(
      `\${string(${migration?.id}.status.succeeded)}`,
    );
    expect(
      deployment?.template?.metadata?.labels?.['app.kubernetes.io/managed-by'],
    ).toBe('applik8s');
    expect(migration?.readyWhen).toEqual([
      `\${${migration?.id}.status.succeeded == 1}`,
    ]);
    expect(dependencyValues(migration)).toEqual([]);
    expect(dependencyValues(service)).toEqual([]);
  });

  test('projects absent optional capabilities as constant CEL status expressions', () => {
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: {
          schema: { apiVersion: 'applications.example.dev/v1alpha1', kind: 'Chirp', spec: {}, status: {} },
          resources: [],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'chirp', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'Chirp',
      emitDefaultInstance: false,
      controlPlaneNamespace: 'chirp-control',
      statusProjection: { mode: 'standardApplicationReadiness', fields: ['backupStatus', 'migrationStatus'] },
    });

    expect(artifacts.resources[0]?.spec).toMatchObject({
      schema: {
        status: {
          backupStatus: '${applik8sInstallationContract.data["status.NotConfigured"]}',
          migrationStatus: '${applik8sInstallationContract.data["status.NotRequired"]}',
        },
      },
    });
  });

  test('lowers selected container-registry pull Secrets into one resource-backed status projection', () => {
    const graph = {
      nodes: [{
        kind: 'provider',
        interface: 'ContainerRegistry',
        config: {
          bindingKind: 'provided',
          containerRegistry: {
            kind: 'application-provider-selection',
            selector: 'schema.spec.profile',
            cases: {
              external: {
                pullSecret: {
                  apiVersion: 'v1', kind: 'Secret',
                  name: '${schema.spec.providers.registry.pullSecretName}',
                  namespace: '${schema.spec.name}',
                },
              },
            },
            default: {
              pullSecret: {
                apiVersion: 'v1', kind: 'Secret', name: 'chirp-registry-pull', namespace: '${schema.spec.name}',
              },
            },
          },
        },
      }],
    } as unknown as ApplicationGraph;
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: 'chirp' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1', kind: 'Chirp',
            spec: { profile: 'string', name: 'string', providers: { registry: { pullSecretName: 'string' } } },
            status: { providerStatus: { registry: 'string' } },
          },
          resources: [],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'chirp', {
      apiVersion: 'applications.example.dev/v1alpha1', kind: 'Chirp', emitDefaultInstance: false,
      statusProjection: { mode: 'standardApplicationReadiness', fields: ['providerStatus'] },
    }, graph);

    const spec = artifacts.resources[0]?.spec as { resources: Array<Record<string, unknown>>; schema: { status: { providerStatus: { registry: string } } } };
    expect(spec.resources).toContainEqual({
      id: 'applik8sContainerRegistryPullSecret',
      role: 'containerRegistryPullSecret',
      externalRef: {
        apiVersion: 'v1', kind: 'Secret',
        metadata: {
          name: '${schema.spec.profile == "external" ? schema.spec.providers.registry.pullSecretName : ("chirp-registry-pull")}',
          namespace: '${schema.spec.name}',
        },
      },
    });
    expect(spec.schema.status.providerStatus.registry).toContain('applik8sContainerRegistryPullSecret.metadata.resourceVersion');
  });

  test('projects feature-gated readiness through a resource-derived installation contract', () => {
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1',
            kind: 'Chirp',
            spec: { enabled: 'boolean' },
            status: { ready: 'boolean', phase: 'string' },
          },
          resources: [{
            id: 'worker',
            includeWhen: ['${schema.spec.enabled}'],
            template: {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              metadata: { name: 'worker', namespace: 'chirp' },
              spec: { replicas: 1 },
            },
          }, {
            id: 'migration',
            template: {
              apiVersion: 'batch/v1',
              kind: 'Job',
              metadata: {
                name: 'migration',
                namespace: 'chirp',
                labels: { 'app.kubernetes.io/component': 'migration' },
              },
              spec: {},
            },
          }],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'chirp', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'Chirp',
      emitDefaultInstance: false,
      controlPlaneNamespace: 'chirp-control',
      statusProjection: { mode: 'standardApplicationReadiness', fields: ['ready', 'phase', 'migrationStatus'] },
    });

    const resourceGraph = artifacts.resources[0];
    expect(resourceGraph?.spec).toMatchObject({
      resources: expect.arrayContaining([expect.objectContaining({
        id: 'applik8sInstallationContract',
        template: expect.objectContaining({
          data: expect.objectContaining({ 'active.worker': '${string((schema.spec.enabled))}' }),
        }),
      })]),
    });
    const status = (resourceGraph?.spec as { schema?: { status?: Record<string, string> } }).schema?.status;
    expect(status?.ready).toContain('applik8sInstallationContract.data["active.worker"] == "true"');
    expect(status?.phase).toContain('applik8sInstallationContract.data["active.worker"] == "true"');
    expect(status?.ready).not.toContain('schema.spec');
    expect(status?.phase).not.toContain('schema.spec');
    expect(status?.migrationStatus).toContain('? "Failed" :');
    expect(status?.migrationStatus).toContain('c.type == "Failed" && c.status == "True"');
    expect(status?.phase).toContain('? "Degraded" : "Installing"');
  });

  test('projects terminal controller failures distinctly from ordinary convergence', () => {
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'failure-aware' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1', kind: 'FailureAware', spec: {},
            status: { ready: 'boolean', phase: 'string', rolloutStatus: 'string', providerStatus: { eventLog: 'string' }, degradedReasons: 'string[]' },
          },
          resources: [{
            id: 'eventLog',
            template: {
              apiVersion: 'helm.toolkit.fluxcd.io/v2', kind: 'HelmRelease',
              metadata: { name: 'applik8s-events', namespace: 'failure-aware' }, spec: {},
            },
          }],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'failure-aware', {
      apiVersion: 'applications.example.dev/v1alpha1', kind: 'FailureAware', emitDefaultInstance: false,
      statusProjection: { mode: 'standardApplicationReadiness', fields: ['ready', 'phase', 'rolloutStatus', 'providerStatus', 'degradedReasons'] },
    });

    const status = (artifacts.resources[0]?.spec as { schema?: { status?: Record<string, unknown> } }).schema?.status;
    expect(status?.phase).toContain('c.type == "Stalled" && c.status == "True"');
    expect(status?.phase).toContain('? "Degraded" : "Installing"');
    expect(status?.rolloutStatus).toContain('? "Blocked" : "Reconciling"');
    expect((status?.providerStatus as Record<string, string>).eventLog).toContain('? "Failed" :');
    expect(status?.degradedReasons).toContain('HelmRelease/applik8s-events reported a terminal reconciliation failure');
  });

  test('projects a framework-default local NodePort provider from its active resource', () => {
    const graph = {
      nodes: [{
        id: 'provider.http-exposure', kind: 'provider', name: 'HttpExposure', stability: 'stable',
        interface: 'HttpExposure', implementation: 'ingress',
        config: { bindingKind: 'frameworkDefault', provider: 'ingress' },
      }],
    } as unknown as ApplicationGraph;
    const artifacts = injectGeneratedResourcesIntoApplicationRgd({
      resources: [{
        apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: 'local-exposure' },
        spec: {
          schema: {
            apiVersion: 'applications.example.dev/v1alpha1', kind: 'LocalExposure', spec: {},
            status: { providerStatus: { exposure: 'string' } },
          },
          resources: [{
            id: 'webLocalNodePortApplicationExposure',
            template: {
              apiVersion: 'v1', kind: 'Service',
              metadata: { name: 'web-local-node-port', annotations: { 'applik8s.dev/public-url': 'http://127.0.0.1:30080' } },
              spec: { type: 'NodePort' },
            },
          }],
        },
      }],
      instances: [],
      instancesAreAuthoritative: true,
    }, [], 'local-exposure', {
      apiVersion: 'applications.example.dev/v1alpha1', kind: 'LocalExposure', emitDefaultInstance: false,
      statusProjection: { mode: 'standardApplicationReadiness', fields: ['providerStatus'] },
    }, graph);

    const status = (artifacts.resources[0]?.spec as { schema?: { status?: { providerStatus?: Record<string, string> } } }).schema?.status;
    expect(status?.providerStatus?.exposure).toContain('${(true) ?');
    expect(status?.providerStatus?.exposure).toContain('? "Ready" : "Pending"');
  });
});
