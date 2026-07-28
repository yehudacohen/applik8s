// typecast-file-boundary: Compiler tests inspect serialized installation artifacts and deliberately malformed values beyond their authored generic types.
import { describe, expect, test } from 'vitest';
import type { ApplicationGraph } from '@applik8s/core';
import { applicationGraphAllConditions, applicationGraphBooleanCondition, applicationGraphServiceHost, applicationGraphStringValue, applicationKroIncludeWhen } from '../src/application-installation-values.js';
import { injectGeneratedResourcesIntoApplicationRgd } from '../src/pipeline/application-artifacts.js';

describe('installation-derived compiler values', () => {
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
