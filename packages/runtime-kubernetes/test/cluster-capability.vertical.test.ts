// typecast-file-boundary: transport tests use structural Kubernetes client doubles and malformed provider errors.
import {
  applicationKubernetesCapabilityProtocol,
  type ApplicationKubernetesCapabilityIntent,
} from '@applik8s/applik8s';
import type { KubernetesListObject, KubernetesObject } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import {
  createKubernetesApplicationCapabilityHost,
  type ApplicationKubernetesCapabilityObjectClient,
  type ApplicationKubernetesCapabilityWatchClient,
} from '../src/cluster-capability.js';

const resource = {
  group: 'apps', version: 'v1', kind: 'Deployment', plural: 'deployments', scope: 'namespaced' as const,
};

describe('Kubernetes capability Node host', () => {
  it('fails closed instead of adopting ambient kubeconfig', () => {
    expect(() => createKubernetesApplicationCapabilityHost({
      authorize: () => ({
        authorityReceipt: 'receipt',
        causalContext: 'principal',
      }),
    })).toThrow(/explicit kubeConfig or inCluster: true/u);
  });

  it('executes the complete bounded operation family and records framework authority', async () => {
    const calls: string[] = [];
    const observed: unknown[] = [];
    const live = deployment('api');
    const objects: ApplicationKubernetesCapabilityObjectClient = {
      async read() { calls.push('read'); return live; },
      async list() {
        calls.push('list');
        return { apiVersion: 'v1', kind: 'List', metadata: { resourceVersion: '8', _continue: 'next' }, items: [live] } as KubernetesListObject<KubernetesObject>;
      },
      async patch(value, _pretty, _dryRun, manager, force, strategy) {
        calls.push(`patch:${manager}:${String(force)}:${strategy}`);
        return { ...live, ...value } as KubernetesObject;
      },
      async delete(_value, _pretty, _dryRun, _grace, _orphan, propagation, body) {
        calls.push(`delete:${propagation}:${body?.preconditions?.uid}`);
        return {};
      },
    };
    const watch: ApplicationKubernetesCapabilityWatchClient = {
      async watch(path, query, callback, done) {
        calls.push(`watch:${path}:${String(query.resourceVersion)}`);
        queueMicrotask(() => {
          callback('MODIFIED', { ...live, metadata: { ...live.metadata, resourceVersion: '9' } });
          done();
        });
        return new AbortController();
      },
    };
    const host = createKubernetesApplicationCapabilityHost({
      objects,
      watch,
      kubeConfig: {} as never,
      authorize: async intent => ({ authorityReceipt: `receipt:${intent.operationId}`, causalContext: 'principal:alice' }),
      observe: request => { observed.push(request); },
      now: () => 1_000,
    });

    await expect(host.invoke(intent({ kind: 'get', identity: { namespace: 'apps', name: 'api' } }))).resolves.toMatchObject({ ok: true, value: { kind: 'Deployment' } });
    await expect(host.invoke(intent({ kind: 'list', query: { namespace: 'apps' }, page: { limit: 10, maxBytes: 4_000 } }))).resolves.toMatchObject({ ok: true, value: { items: [{ kind: 'Deployment' }], continue: 'next' } });
    await expect(host.invoke(intent({ kind: 'watch', query: { namespace: 'apps' }, from: '8', maxEvents: 2, maxBytes: 4_000 }))).resolves.toMatchObject({ ok: true, value: { events: [{ type: 'Modified' }], resourceVersion: '9' } });
    await expect(host.invoke(intent({ kind: 'apply', value: live as never, ownership: { fieldManager: 'replicator', force: true } }))).resolves.toMatchObject({ ok: true });
    await expect(host.invoke(intent({ kind: 'patch', identity: { namespace: 'apps', name: 'api' }, patch: { spec: { replicas: 2 } }, ownership: { fieldManager: 'replicator', expectedUid: 'uid-api' } }))).resolves.toMatchObject({ ok: true });
    await expect(host.invoke(intent({ kind: 'delete', identity: { namespace: 'apps', name: 'api' }, preconditions: { uid: 'uid-api', propagation: 'Foreground' } }))).resolves.toMatchObject({ ok: true, value: { deleted: true, uid: 'uid-api' } });

    expect(calls).toEqual([
      'read',
      'list',
      'watch:/apis/apps/v1/namespaces/apps/deployments:8',
      'patch:replicator:true:application/apply-patch+yaml',
      'read',
      'patch:replicator:undefined:application/merge-patch+json',
      'delete:Foreground:uid-api',
    ]);
    expect(observed).toHaveLength(6);
    expect(observed[0]).toMatchObject({ authorityReceipt: 'receipt:operation-1', causalContext: 'principal:alice' });
    expect(JSON.stringify(observed)).not.toContain('credential');
  });

  it('fails closed for deadlines, provider errors, mutation conflicts, and oversized responses', async () => {
    let behavior: 'not-found' | 'conflict' | 'oversized' = 'not-found';
    const objects: ApplicationKubernetesCapabilityObjectClient = {
      async read() {
        if (behavior === 'not-found') throw { response: { statusCode: 404 } };
        return behavior === 'conflict'
          ? { ...deployment('api'), metadata: { ...deployment('api').metadata, uid: 'other' } }
          : deployment('api');
      },
      async list() {
        return { apiVersion: 'v1', kind: 'List', metadata: {}, items: [deployment('api', '⚡'.repeat(2_000))] } as KubernetesListObject<KubernetesObject>;
      },
      async patch(value) { return value; },
      async delete() { return {}; },
    };
    const host = createKubernetesApplicationCapabilityHost({
      objects,
      watch: { async watch() { throw new Error('unused'); } },
      kubeConfig: {} as never,
      authorize: () => ({ authorityReceipt: 'receipt', causalContext: 'principal' }),
      now: () => 1_000,
    });
    await expect(host.invoke({ ...intent({ kind: 'get', identity: { namespace: 'apps', name: 'api' } }), deadlineUnixMs: 999 })).resolves.toMatchObject({ ok: false, error: { code: 'KUBERNETES_CLUSTER_DEADLINE' } });
    await expect(host.invoke(intent({ kind: 'get', identity: { namespace: 'apps', name: 'api' } }))).resolves.toMatchObject({ ok: false, error: { code: 'KUBERNETES_CLUSTER_NOT_FOUND' } });
    behavior = 'conflict';
    await expect(host.invoke(intent({ kind: 'patch', identity: { namespace: 'apps', name: 'api' }, patch: { spec: {} }, ownership: { fieldManager: 'replicator', expectedUid: 'uid-api' } }))).resolves.toMatchObject({ ok: false, error: { code: 'KUBERNETES_CLUSTER_CONFLICT' } });
    behavior = 'oversized';
    await expect(host.invoke(intent({ kind: 'list', query: { namespace: 'apps' }, page: { limit: 10, maxBytes: 1_024 } }))).resolves.toMatchObject({ ok: false, error: { code: 'KUBERNETES_CLUSTER_RESPONSE_LIMIT' } });
  });
});

function intent(operation: ApplicationKubernetesCapabilityIntent['operation']): ApplicationKubernetesCapabilityIntent {
  return {
    protocol: applicationKubernetesCapabilityProtocol,
    bindingId: 'provider.kubernetes-cluster.v1alpha1.destination',
    operationId: 'operation-1',
    resource,
    operation,
    deadlineUnixMs: 10_000,
  };
}

function deployment(name: string, payload = 'ready'): KubernetesObject {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: 'apps', uid: `uid-${name}`, resourceVersion: '7' },
    spec: { replicas: 1, payload },
    status: { readyReplicas: 1 },
  } as KubernetesObject;
}
