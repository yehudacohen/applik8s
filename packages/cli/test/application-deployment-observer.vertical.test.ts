import { type ApplicationKubernetesDirectDeploymentNode, applicationRuntimeAccessPlanDigest } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import {
  applicationInstanceSpec,
  applicationOwnedDeletionNamespaces,
  kubernetesStatusCode,
  type ObservedApplicationInstance,
} from '../src/application-deployment-observer.js';

const instance: ObservedApplicationInstance = {
  apiVersion: 'testing.applik8s.dev/v1alpha1',
  kind: 'ExampleApplication',
  namespace: 'control',
  name: 'example',
};

describe('application deployment observation', () => {
  it('projects a JSON installation spec from the exact live object', () => {
    expect(
      applicationInstanceSpec(
        {
          metadata: { name: 'example', namespace: 'control' },
          spec: {
            profile: 'starter',
            providers: { database: { secretName: 'database' } },
          },
        },
        instance,
      ),
    ).toEqual({
      profile: 'starter',
      providers: { database: { secretName: 'database' } },
    });
  });

  it('recognizes client-node Kubernetes status errors across supported shapes', () => {
    expect(kubernetesStatusCode({ statusCode: 404 })).toBe(404);
    expect(kubernetesStatusCode({ response: { status: 403 } })).toBe(403);
    expect(kubernetesStatusCode({
      body: JSON.stringify({
        kind: 'Status',
        reason: 'NotFound',
        code: 404,
      }),
    })).toBe(404);
    expect(kubernetesStatusCode(new Error(
      'HTTP-Code: 404\nMessage: Unknown API Status Code!',
    ))).toBe(404);
    expect(kubernetesStatusCode(new Error('socket closed'))).toBeUndefined();
  });

  it('fails closed for absent and non-JSON live installation state', () => {
    expect(() => applicationInstanceSpec({}, instance)).toThrow(
      'has no JSON object spec',
    );
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: undefined } },
        instance,
      ),
    ).toThrow('contains a non-JSON value');
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: Number.POSITIVE_INFINITY } },
        instance,
      ),
    ).toThrow('non-finite number');
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: new Date(0) } },
        instance,
      ),
    ).toThrow('non-JSON object');
  });

  it('derives only application-owned delete namespaces for authoritative destroy receipts', () => {
    const runtimeAccessContent = {
      apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
      application: 'application',
      target: 'kubernetes' as const,
      sourceGraphDigest: `sha256:${'c'.repeat(64)}` as const,
      executions: [],
      diagnostics: [],
    };
    const base: Omit<ApplicationKubernetesDirectDeploymentNode, 'lifecycle'> = {
      id: 'direct.namespace.workload',
      kind: 'kubernetesDirect',
      contractVersion: 1,
      source: {},
      provider: {
        interface: 'Namespace',
        implementation: 'typekro-kubernetes',
        version: '1',
      },
      scope: { connectionDigest: `sha256:${'a'.repeat(64)}` },
      capabilities: { strategies: ['direct'], alchemy: true },
      configurationDigest: `sha256:${'b'.repeat(64)}`,
      inputs: {},
      outputs: [],
      spec: {
        compositionId: 'applik8s-namespace',
        reason: 'test',
        configuration: { name: 'application-system' },
      },
    };
    expect(applicationOwnedDeletionNamespaces({
      apiVersion: 'applik8s.deploymentGraph/v1alpha1',
      kind: 'ApplicationDeploymentGraph',
      metadata: {
        identity: {
          connection: {
            provider: 'kubernetes',
            cluster: 'orbstack',
            digest: `sha256:${'a'.repeat(64)}`,
          },
          application: 'application',
          controlPlaneNamespace: 'default',
          instance: 'application',
          profile: 'starter',
        },
        mode: 'fresh',
        strategy: 'direct',
        sourceGraphDigest: `sha256:${'c'.repeat(64)}`,
        compilerVersion: 'test',
      },
      runtimeAccess: { ...runtimeAccessContent, digest: applicationRuntimeAccessPlanDigest(runtimeAccessContent) },
      nodes: [
        {
          ...base,
          lifecycle: {
            ownership: 'application',
            deletion: 'delete',
            adoption: 'createOrAdoptExact',
          },
        },
        {
          ...base,
          id: 'direct.namespace.shared',
          spec: {
            ...base.spec,
            configuration: { name: 'shared-system' },
          },
          lifecycle: {
            ownership: 'shared',
            deletion: 'retain',
            adoption: 'createOrAdoptExact',
          },
        },
      ],
      edges: [],
    })).toEqual(['application-system']);
  });
});
