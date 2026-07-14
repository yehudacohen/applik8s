import { describe, expect, it } from 'vitest';
import { planTypeKroEmission } from '../src/pipeline/typekro-emission-plan.js';

describe('TypeKro compiler lowering plan', () => {
  it('preserves source order while deduplicating Kubernetes identities', () => {
    const resource = (kind: string, name: string, namespace?: string) => ({ apiVersion: 'v1', kind, metadata: { name, ...(namespace ? { namespace } : {}) } });
    const shared = resource('ConfigMap', 'shared', 'app');
    const plan = planTypeKroEmission({
      factory: [shared],
      composition: [shared, resource('Service', 'api', 'app')],
      processors: [resource('Deployment', 'processor', 'app')],
      workflows: [resource('Deployment', 'worker', 'app')],
    });
    expect(plan.apiVersion).toBe('applik8s.compiler.typekro-plan/v1alpha1');
    expect(plan.resources.map((item) => `${item.kind}/${item.metadata.name}`)).toEqual(['ConfigMap/shared', 'Service/api', 'Deployment/processor', 'Deployment/worker']);
    expect(plan.sources).toEqual({ factory: 1, composition: 2, processors: 1, workflows: 1 });
  });
});
