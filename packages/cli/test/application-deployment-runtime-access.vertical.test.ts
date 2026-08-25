import { describe, expect, it } from 'vitest';
import { classifyKubernetesRuntimeAccessNetworkPolicyProvider } from '../src/application-deployment-runtime-access.js';

describe('deployment runtime-access target capability observation', () => {
  const crd = {
    metadata: { name: 'ciliumnetworkpolicies.cilium.io' },
    spec: {
      group: 'cilium.io',
      names: { kind: 'CiliumNetworkPolicy' },
      versions: [{ name: 'v2', served: true }],
    },
    status: { conditions: [{ type: 'Established', status: 'True' }] },
  } as const;
  const daemonSet = {
    metadata: { name: 'cilium', labels: { 'k8s-app': 'cilium' } },
    status: { desiredNumberScheduled: 3, numberReady: 3 },
  } as const;
  const configMap = {
    metadata: { name: 'cilium-config', namespace: 'kube-system' },
    data: { 'enable-l7-proxy': 'true' },
  } as const;

  it('selects Cilium only from an established CRD, a ready agent fleet, and an explicitly enabled L7 proxy', () => {
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([crd], [daemonSet], [configMap])).toBe('cilium');
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([], [daemonSet], [configMap])).toBe('standard');
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([crd], [{ ...daemonSet, status: { desiredNumberScheduled: 3, numberReady: 2 } }], [configMap])).toBe('standard');
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([{ ...crd, status: { conditions: [{ type: 'Established', status: 'False' }] } }], [daemonSet], [configMap])).toBe('standard');
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([crd], [daemonSet], [])).toBe('standard');
    expect(classifyKubernetesRuntimeAccessNetworkPolicyProvider([crd], [daemonSet], [{ ...configMap, data: { 'enable-l7-proxy': 'false' } }])).toBe('standard');
  });
});
