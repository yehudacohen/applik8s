import { describe, expect, it } from 'vitest';
import {
  assertKubernetesApplicationManagedModelFence,
  KubernetesApplicationManagedModelFenceError,
  kubernetesApplicationManagedModelIdentity,
  kubernetesApplicationManagedModelStatus,
  kubernetesApplicationOperatorRuntime,
  setKubernetesApplicationManagedModelCondition,
} from '../src/index.js';

const object = {
  apiVersion: 'workspaces.applik8s.dev/v1alpha1',
  kind: 'Workspace',
  metadata: {
    name: 'main',
    namespace: 'workspaces',
    uid: 'uid-1',
    generation: 3,
    resourceVersion: '42',
  },
  spec: { version: '1.2.3' },
  status: { phase: 'Pending' },
};

describe('Kubernetes managed-model runtime', () => {
  it('uses UID, generation, and resourceVersion as one fail-closed commit fence', () => {
    const fence = kubernetesApplicationManagedModelIdentity(object);
    expect(assertKubernetesApplicationManagedModelFence(fence, object)).toEqual(fence);
    expect(() => assertKubernetesApplicationManagedModelFence(fence, {
      ...object,
      metadata: { ...object.metadata, resourceVersion: '43' },
    })).toThrow(KubernetesApplicationManagedModelFenceError);
    expect(() => assertKubernetesApplicationManagedModelFence(fence, undefined)).toThrow(
      /no longer exists/u,
    );
  });

  it('replaces schema-owned status while preserving condition authority', () => {
    expect(kubernetesApplicationManagedModelStatus<{
      phase: string;
      endpoint: string;
      conditions?: readonly { readonly type: string }[];
    }>(
      { phase: 'Pending', endpoint: 'old', conditions: [{ type: 'Ready' }] },
      { phase: 'Ready', endpoint: 'new' },
    )).toEqual({
      phase: 'Ready',
      endpoint: 'new',
      conditions: [{ type: 'Ready' }],
    });
  });

  it('stamps the current generation and preserves transition time only for unchanged conditions', () => {
    const first = setKubernetesApplicationManagedModelCondition([], {
      type: 'Ready', status: 'False', reason: 'Pending', message: 'Waiting',
    }, 3, '2026-08-31T12:00:00.000Z');
    const unchanged = setKubernetesApplicationManagedModelCondition(first, {
      type: 'Ready', status: 'False', reason: 'Pending', message: 'Waiting',
    }, 4, '2026-08-31T12:01:00.000Z');
    expect(unchanged[0]).toMatchObject({
      observedGeneration: 4,
      lastTransitionTime: '2026-08-31T12:00:00.000Z',
    });
    const changed = setKubernetesApplicationManagedModelCondition(unchanged, {
      type: 'Ready', status: 'True', reason: 'Converged', message: 'Ready',
    }, 4, '2026-08-31T12:02:00.000Z');
    expect(changed[0]?.lastTransitionTime).toBe('2026-08-31T12:02:00.000Z');
  });

  it('normalizes Kubernetes provider policy without introducing another controller', () => {
    expect(kubernetesApplicationOperatorRuntime({
      namespace: 'operators',
      leaseDuration: '45s',
      resyncInterval: '2m',
      maximumResyncItems: 250,
    })).toEqual({
      protocol: 'applik8s.operator-runtime.kubernetes/v1alpha1',
      namespace: 'operators',
      leaseDurationSeconds: 45,
      resyncIntervalSeconds: 120,
      maximumResyncItems: 250,
      fencing: 'uidGenerationResourceVersion',
      notification: 'watchInvalidationHint',
      resync: 'boundedList',
      delayedWakeup: 'workQueue',
      finalization: 'kubernetesFinalizer',
    });
  });
});
