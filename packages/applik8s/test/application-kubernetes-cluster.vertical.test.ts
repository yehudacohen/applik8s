// typecast-file-boundary: protocol adversarial tests construct deliberately malformed host payloads.
import {
  ApplicationKubernetesCapabilityError,
  type ApplicationKubernetesCapabilityHost,
  type ApplicationKubernetesCapabilityIntent,
  type ApplicationKubernetesCapabilityResponse,
  KubernetesCluster,
  app,
  applicationGraphFor,
  applicationKubernetesCapabilityProtocol,
  config,
  createApplicationKubernetesCapabilityRequest,
  installApplicationKubernetesCapabilityHostResolver,
  sdk,
  secret,
} from '@applik8s/applik8s';
import { installApplicationKubernetesCapabilityWitHost } from '../src/kubernetes-cluster-wit-runtime.js';
import { describe, expect, it } from 'vitest';
import { type } from '@applik8s/applik8s/dsl';

const Deployment = sdk.kubernetes.Deployment;

function deployment(name: string, namespace = 'apps', payload = 'ready') {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace, uid: `uid-${name}`, resourceVersion: '7' },
    spec: { replicas: 1, payload },
    status: { readyReplicas: 1 },
  };
}

describe('application Kubernetes cluster capability', () => {
  it('uses one named provider for bounded typed resource operations without exposing credentials', async () => {
    const application = app('destination-cluster');
    const Destination = KubernetesCluster.named('destination');
    application.provide(Destination, KubernetesCluster.external({
      kubeconfig: secret.env('DESTINATION_KUBECONFIG'),
      context: config.env('DESTINATION_CONTEXT'),
      namespace: 'apps',
      endpointPolicy: {
        name: 'destination-api',
        version: '1',
        scheme: 'https',
        hosts: ['destination.example.test'],
        ports: [6443],
        redirects: 'deny',
      },
    }));
    application.http('api').post('inspect-destination', '/destination', {
      input: type({ namespace: 'string', name: 'string' }),
      output: type({ name: 'string' }),
      __generatedBindings: { 'Destination.resources': Destination.resources },
    }, async ({ input }) => ({
      name: (await Destination.resources(Deployment).get(input)).metadata.name,
    })).public();

    const intents: ApplicationKubernetesCapabilityIntent[] = [];
    const host: ApplicationKubernetesCapabilityHost = {
      async invoke(intent) {
        intents.push(intent);
        switch (intent.operation.kind) {
          case 'get': return ok(deployment(intent.operation.identity.name, intent.operation.identity.namespace));
          case 'list': {
            const second = intent.operation.page.continue === 'next';
            return ok({
              items: [deployment(second ? 'two' : 'one')],
              resourceVersion: second ? '12' : '11',
              ...(second ? {} : { continue: 'next' }),
            });
          }
          case 'watch': return ok({
            events: [{ type: 'Modified', object: deployment('one') }],
            resourceVersion: '13',
          });
          case 'apply': return ok(intent.operation.value);
          case 'patch': return ok(deployment(intent.operation.identity.name, intent.operation.identity.namespace));
          case 'delete': return ok({ deleted: true, uid: intent.operation.preconditions.uid });
        }
      },
    };
    const dispose = installApplicationKubernetesCapabilityHostResolver(bindingId =>
      bindingId === 'provider.kubernetes-cluster.v1alpha1.destination' ? host : undefined);
    try {
      const resources = Destination.resources(Deployment);
      await expect(resources.get({ namespace: 'apps', name: 'api' })).resolves.toMatchObject({
        metadata: { name: 'api', namespace: 'apps' },
      });
      await expect(resources.list(
        { namespace: 'apps', labels: { app: 'api' } },
        { pageSize: 1, maxPages: 2, maxItems: 2, maxBytes: 4_000, timeout: '2s' },
      )).resolves.toMatchObject({ items: [{ metadata: { name: 'one' } }, { metadata: { name: 'two' } }], resourceVersion: '12' });
      await expect(resources.watch(
        { namespace: 'apps' },
        { from: '12', timeout: '2s', maxEvents: 2, maxBytes: 4_000 },
      )).resolves.toMatchObject({ events: [{ type: 'Modified' }], resourceVersion: '13' });
      await expect(resources.apply(deployment('api'), { fieldManager: 'applik8s.io/workload-replicator' })).resolves.toMatchObject({ kind: 'Deployment' });
      await expect(resources.patch(
        { namespace: 'apps', name: 'api' },
        { spec: { replicas: 2 } },
        { fieldManager: 'workload-replicator', expectedResourceVersion: '7' },
      )).resolves.toMatchObject({ metadata: { name: 'api' } });
      await expect(resources.delete(
        { namespace: 'apps', name: 'api' },
        { uid: 'uid-api', propagation: 'Foreground' },
      )).resolves.toEqual({ deleted: true, uid: 'uid-api' });
    } finally {
      dispose();
    }

    expect(intents).toHaveLength(7);
    expect(intents.every(intent =>
      intent.bindingId === 'provider.kubernetes-cluster.v1alpha1.destination'
      && intent.resource.group === 'apps'
      && intent.resource.plural === 'deployments'
      && intent.deadlineUnixMs > Date.now() - 10_000
      && !('credentials' in intent)
      && !('kubeconfig' in intent))).toBe(true);
    expect(applicationGraphFor(application.composition)?.nodes).toContainEqual(expect.objectContaining({
      id: 'provider.kubernetes-cluster.v1alpha1.destination',
      kind: 'provider',
      interface: 'KubernetesCluster',
      implementation: 'external-kubernetes-cluster',
    }));
    expect(applicationGraphFor(application.composition)?.nodes).toContainEqual(expect.objectContaining({
      kind: 'server',
      routes: [expect.objectContaining({
        functionNative: expect.objectContaining({
          providerBindings: [expect.objectContaining({
            identifier: 'Destination.resources',
            provider: expect.objectContaining({
              interface: 'KubernetesCluster',
              nodeId: 'provider.kubernetes-cluster.v1alpha1.destination',
            }),
            operation: expect.objectContaining({ member: 'resources' }),
          })],
        }),
      })],
    }));
  });

  it('enforces scope, mutation ownership, finite limits, and fail-closed protocol validation', async () => {
    const Destination = KubernetesCluster.named('bounded');
    const resources = Destination.resources(Deployment);
    await expect(resources.get({ name: 'api' })).rejects.toMatchObject({
      code: 'KUBERNETES_CLUSTER_SCOPE_UNBOUNDED',
    });
    await expect(resources.delete({ namespace: 'apps', name: 'api' }, {})).rejects.toMatchObject({
      code: 'KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED',
    });
    await expect(resources.list({ namespace: 'apps' }, { pageSize: 0 })).rejects.toThrow('pageSize');

    let mode: 'repeated' | 'oversized' | 'wrong-kind' = 'repeated';
    const dispose = installApplicationKubernetesCapabilityHostResolver(() => ({
      async invoke(intent) {
        if (mode === 'repeated') return ok({ items: [deployment('one')], continue: 'same' });
        if (mode === 'oversized') return ok({ items: [deployment('one', 'apps', '⚡'.repeat(2_000))] });
        return ok({ ...deployment('one'), kind: 'StatefulSet' });
      },
    }));
    try {
      await expect(resources.list(
        { namespace: 'apps' },
        { maxPages: 3, maxItems: 10, maxBytes: 10_000 },
      )).rejects.toMatchObject({ code: 'KUBERNETES_CLUSTER_CONTINUATION_INVALID' });
      mode = 'oversized';
      await expect(resources.list(
        { namespace: 'apps' },
        { maxPages: 1, maxItems: 10, maxBytes: 1_024 },
      )).rejects.toMatchObject({ code: 'KUBERNETES_CLUSTER_RESPONSE_LIMIT' });
      mode = 'wrong-kind';
      await expect(resources.get({ namespace: 'apps', name: 'one' })).rejects.toMatchObject({
        code: 'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE',
      });
    } finally {
      dispose();
    }
  });

  it('enforces mutually exclusive external credential forms and canonical host authority envelopes', () => {
    expect(KubernetesCluster.external({
      endpoint: config.env.url('DESTINATION_ENDPOINT'),
      credentials: secret.env('DESTINATION_CREDENTIALS'),
    })).toMatchObject({ kind: 'external-kubernetes-cluster', endpoint: { valueType: 'url' } });
    expect(KubernetesCluster.external({
      kubeconfig: secret.env('DESTINATION_KUBECONFIG'),
      context: 'destination',
    })).toMatchObject({ kind: 'external-kubernetes-cluster', kubeconfig: { kind: 'secret' } });
    expect(() => KubernetesCluster.external({} as never)).toThrow('exactly one');
    expect(() => KubernetesCluster.external({
      endpoint: config.env.url('DESTINATION_ENDPOINT'),
    } as never)).toThrow('endpoint and credentials');
    expect(() => KubernetesCluster.external({
      kubeconfig: secret.env('DESTINATION_KUBECONFIG'),
      endpoint: config.env.url('DESTINATION_ENDPOINT'),
      credentials: secret.env('DESTINATION_CREDENTIALS'),
    } as never)).toThrow('exactly one');

    const intent: ApplicationKubernetesCapabilityIntent = {
      protocol: applicationKubernetesCapabilityProtocol,
      bindingId: 'provider.kubernetes-cluster.v1alpha1.destination',
      operationId: 'k8s_test',
      resource: { group: 'apps', version: 'v1', kind: 'Deployment', plural: 'deployments', scope: 'namespaced' },
      operation: { kind: 'get', identity: { namespace: 'apps', name: 'api' } },
      deadlineUnixMs: 1_800_000_000_000,
    };
    expect(createApplicationKubernetesCapabilityRequest(intent, {
      authorityReceipt: 'receipt-1',
      causalContext: 'principal:user-1',
      traceContext: 'traceparent-1',
    })).toEqual({ ...intent, authorityReceipt: 'receipt-1', causalContext: 'principal:user-1', traceContext: 'traceparent-1' });
    expect(() => createApplicationKubernetesCapabilityRequest(intent, {
      authorityReceipt: '',
      causalContext: 'principal:user-1',
    })).toThrow('authority receipt');
  });

  it('hydrates the component WIT transport into the same validated capability host contract', async () => {
    const requests: ApplicationKubernetesCapabilityIntent[] = [];
    const dispose = installApplicationKubernetesCapabilityWitHost(requestJson => {
      const request = JSON.parse(requestJson) as ApplicationKubernetesCapabilityIntent;
      requests.push(request);
      return {
        tag: 'ok',
        val: JSON.stringify({
          ok: true,
          value: ok(deployment(request.operation.kind === 'get' ? request.operation.identity.name : 'unexpected')),
        }),
      };
    });
    try {
      await expect(KubernetesCluster.named('component').resources(Deployment).get({
        namespace: 'apps',
        name: 'component-api',
      })).resolves.toMatchObject({ metadata: { name: 'component-api' } });
    } finally {
      dispose();
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      protocol: applicationKubernetesCapabilityProtocol,
      bindingId: 'provider.kubernetes-cluster.v1alpha1.component',
      operation: { kind: 'get' },
    });

    const disposeMalformed = installApplicationKubernetesCapabilityWitHost(() => ({
      ok: true,
      value: JSON.stringify({ ok: true, value: { protocol: applicationKubernetesCapabilityProtocol, ok: false, error: { code: 'UNKNOWN', message: 'bad', retryable: false } } }),
    }));
    try {
      await expect(KubernetesCluster.named('component').resources(Deployment).get({
        namespace: 'apps', name: 'component-api',
      })).rejects.toMatchObject({ code: 'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE' });
    } finally {
      disposeMalformed();
    }
  });
});

function ok(value: unknown): ApplicationKubernetesCapabilityResponse {
  return {
    protocol: applicationKubernetesCapabilityProtocol,
    ok: true,
    value: value as never,
  };
}

void ApplicationKubernetesCapabilityError;
