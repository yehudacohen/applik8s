// typecast-file-boundary: live dynamic Kubernetes objects are validated by the capability runtime before assertions.
import {
  KubernetesCluster,
  installApplicationKubernetesCapabilityHostResolver,
  sdk,
} from '@applik8s/applik8s';
import { createKubernetesApplicationCapabilityHost } from '@applik8s/runtime-kubernetes';
import { KubeConfig } from '@kubernetes/client-node';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  kubectl,
  sleep,
  waitForKubernetesResourceDeleted,
} from './live-e2e-helpers.js';

const namespace = `applik8s-v09-cluster-${crypto.randomUUID().slice(0, 8)}`;
const Current = KubernetesCluster.named('current-live');
const External = KubernetesCluster.named('external-live');
const ConfigMap = sdk.kubernetes.resource<{ readonly data?: Readonly<Record<string, string>> }>({
  apiVersion: 'v1', kind: 'ConfigMap', plural: 'configmaps', scope: 'Namespaced', access: 'connection',
});

describeLive('v0.9 Kubernetes cluster capability', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await kubectl(['create', 'namespace', namespace]);
  }, 30_000);

  afterAll(async () => {
    await kubectl(['delete', 'namespace', namespace, '--wait=false', '--ignore-not-found=true']);
    await waitForKubernetesResourceDeleted(`namespace/${namespace}`, 120_000);
  }, 150_000);

  test('runs the same typed source through current and external host bindings with bounded mutation ownership', async () => {
    const currentConfig = new KubeConfig();
    currentConfig.loadFromDefault();
    currentConfig.setCurrentContext(process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack');
    const externalConfig = new KubeConfig();
    externalConfig.loadFromString(currentConfig.exportConfig());
    externalConfig.setCurrentContext(currentConfig.getCurrentContext());
    const currentHost = createKubernetesApplicationCapabilityHost({
      kubeConfig: currentConfig,
      authorize: intent => ({ authorityReceipt: `live:${intent.operation.kind}`, causalContext: 'qualification:v09' }),
    });
    const externalHost = createKubernetesApplicationCapabilityHost({
      kubeConfig: externalConfig,
      authorize: intent => ({ authorityReceipt: `external:${intent.operation.kind}`, causalContext: 'qualification:v09' }),
    });
    const dispose = installApplicationKubernetesCapabilityHostResolver(bindingId => {
      if (bindingId === 'provider.kubernetes-cluster.v1alpha1.current-live') return currentHost;
      if (bindingId === 'provider.kubernetes-cluster.v1alpha1.external-live') return externalHost;
      return undefined;
    });
    const current = Current.resources(ConfigMap);
    const external = External.resources(ConfigMap);
    const firstName = 'current-source';
    const secondName = 'external-source';
    try {
      await current.apply(configMap(firstName, 'one'), { fieldManager: 'applik8s-v09-cluster-live' });
      await external.apply(configMap(secondName, 'one'), { fieldManager: 'applik8s-v09-cluster-live' });
      const currentRead = await external.get({ namespace, name: firstName });
      const externalRead = await current.get({ namespace, name: secondName });
      const currentUid = requiredMetadata(currentRead.metadata.uid, `${firstName} uid`);
      const externalUid = requiredMetadata(externalRead.metadata.uid, `${secondName} uid`);
      const externalResourceVersion = requiredMetadata(
        externalRead.metadata.resourceVersion,
        `${secondName} resourceVersion`,
      );
      expect(currentRead.metadata.uid).toEqual(expect.any(String));
      expect(externalRead.metadata.uid).toEqual(expect.any(String));
      const listed = await external.list(
        { namespace, labels: { 'app.kubernetes.io/managed-by': 'applik8s-v09-cluster-live' } },
        { pageSize: 1, maxPages: 4, maxItems: 4, maxBytes: 16_000, timeout: '10s' },
      );
      expect(listed.items.map(item => item.metadata.name).sort()).toEqual([firstName, secondName]);

      const watched = current.watch(
        { namespace, fields: { 'metadata.name': secondName } },
        { from: externalResourceVersion, timeout: '10s', maxEvents: 1, maxBytes: 8_000 },
      );
      await sleep(500);
      await external.patch(
        { namespace, name: secondName },
        { data: { revision: 'two' } },
        {
          fieldManager: 'applik8s-v09-cluster-live',
          expectedUid: externalUid,
          expectedResourceVersion: externalResourceVersion,
        },
      );
      await expect(watched).resolves.toMatchObject({ events: [{ type: 'Modified', object: { metadata: { name: secondName } } }] });

      await external.delete(
        { namespace, name: firstName },
        { uid: currentUid, propagation: 'Foreground' },
      );
      const latestSecond = await current.get({ namespace, name: secondName });
      await current.delete(
        { namespace, name: secondName },
        { uid: requiredMetadata(latestSecond.metadata.uid, `${secondName} latest uid`), propagation: 'Foreground' },
      );
      await expect(current.get({ namespace, name: firstName })).rejects.toMatchObject({ code: 'KUBERNETES_CLUSTER_NOT_FOUND' });
      await expect(external.get({ namespace, name: secondName })).rejects.toMatchObject({ code: 'KUBERNETES_CLUSTER_NOT_FOUND' });
    } finally {
      dispose();
    }
  }, 90_000);
});

function requiredMetadata(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Live Kubernetes capability result is missing ${label}.`);
  return value;
}

function configMap(name: string, revision: string) {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name,
      namespace,
      labels: { 'app.kubernetes.io/managed-by': 'applik8s-v09-cluster-live' },
    },
    data: { revision },
  };
}
