import { describe, expect, it } from 'vitest';
import { planTypeKroEmission, typeKroGeneratedResourceId } from '../src/pipeline/typekro-emission-plan.js';

describe('TypeKro compiler lowering plan', () => {
  it('preserves source order while deduplicating Kubernetes identities', () => {
    const resource = (kind: string, name: string, namespace?: string) => ({ apiVersion: 'v1', kind, metadata: { name, ...(namespace ? { namespace } : {}) } });
    const shared = resource('ConfigMap', 'shared', 'app');
    const plan = planTypeKroEmission({
      factory: [shared],
      composition: [shared, resource('Service', 'api', 'app')],
      migrations: [],
      processors: [resource('Deployment', 'processor', 'app')],
      jobs: [],
      managedModels: [resource('Deployment', 'managed-models', 'app')],
      workflows: [resource('Deployment', 'worker', 'app')],
      reactive: [resource('Deployment', 'gateway', 'app')],
      mcp: [resource('Deployment', 'mcp', 'app')],
      agents: [resource('Deployment', 'researcher', 'app')],
      http: [resource('Deployment', 'http', 'app')],
    });
    expect(plan.apiVersion).toBe('applik8s.compiler.typekro-plan/v1alpha1');
    expect(plan.resources.map((item) => `${item.kind}/${item.metadata.name}`)).toEqual(['ConfigMap/shared', 'Service/api', 'Deployment/processor', 'Deployment/managed-models', 'Deployment/worker', 'Deployment/gateway', 'Deployment/mcp', 'Deployment/researcher', 'Deployment/http']);
    expect(plan.sources).toEqual({ factory: 1, composition: 2, migrations: 0, processors: 1, jobs: 0, managedModels: 1, workflows: 1, reactive: 1, mcp: 1, agents: 1, http: 1 });
  });

  it('bounds generated KRO node ids to Kubernetes label-safe lengths without collisions', () => {
    const left = typeKroGeneratedResourceId({ kind: 'ConfigMap', metadata: { name: 'an-extremely-long-generated-application-runtime-source-config-map-for-the-public-query-gateway' } }, 0);
    const right = typeKroGeneratedResourceId({ kind: 'ConfigMap', metadata: { name: 'an-extremely-long-generated-application-runtime-source-config-map-for-the-private-query-gateway' } }, 0);
    expect(left).toMatch(/^[A-Za-z0-9]+$/);
    expect(left.length).toBeLessThanOrEqual(63);
    expect(right.length).toBeLessThanOrEqual(63);
    expect(left).not.toBe(right);
  });
});
