// typecast-file-boundary: Live provider tests inspect untyped Kubernetes custom-object responses after asserting their API identity.
import { KubeConfig } from '@kubernetes/client-node';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { applicationPostgresClusterPreparation } from '../../applik8s/src/application-postgres-preparation.js';
import { assertExpectedKubectlContext, describeLive, kubectl } from './live-e2e-helpers.js';

// Namespace deletion is intentionally outside this test. It exercises the
// direct provider boundary in an existing namespace so unrelated namespace-
// controller failures cannot hide whether the CNPG resource was finalized.
const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? 'default';
const clusterName = `authoritative-${process.pid}`;

describeLive('live direct PostgreSQL provider lifecycle', () => {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack');
  const clusterFactory = applicationPostgresClusterPreparation.factory('direct', {
    namespace,
    kubeConfig,
    waitForReady: true,
    timeout: 10 * 60_000,
  });
  let clusterPrepared = false;

  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await kubectl(['get', `namespace/${namespace}`]);
  });

  afterAll(async () => {
    const cleanupFailures: unknown[] = [];
    if (clusterPrepared) {
      await clusterFactory.deleteInstance(clusterName).catch((cause) => cleanupFailures.push(cause));
    }
    await clusterFactory.dispose().catch((cause) => cleanupFailures.push(cause));
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'Direct PostgreSQL lifecycle cleanup did not complete through TypeKro.');
    }
  }, 12 * 60_000);

  it('creates, reconciles, and deletes a CNPG cluster without KRO ownership', async () => {
    await clusterFactory.deploy({
      name: clusterName,
      namespace,
      spec: {
        instances: 1,
        bootstrap: { initdb: { database: 'application', owner: 'app' } },
        storage: { size: '1Gi' },
      },
    });
    clusterPrepared = true;

    const live = JSON.parse((await kubectl([
      'get', `cluster.postgresql.cnpg.io/${clusterName}`, '--namespace', namespace, '--output=json',
    ])).stdout) as {
      readonly metadata?: { readonly labels?: Readonly<Record<string, string>> };
      readonly status?: { readonly phase?: string; readonly conditions?: readonly { readonly type?: string; readonly status?: string }[] };
    };
    expect(live.metadata?.labels?.['kro.run/owned']).not.toBe('true');
    expect(live.metadata?.labels).toMatchObject({
      'typekro.io/factory-name': 'applik8s-postgres-cluster-preparation',
      'typekro.io/instance-name': clusterName,
    });
    expect(
      live.status?.phase === 'Cluster in healthy state'
      || live.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
    ).toBe(true);

    await clusterFactory.deleteInstance(clusterName);
    clusterPrepared = false;
    await expect(kubectl([
      'get', `cluster.postgresql.cnpg.io/${clusterName}`, '--namespace', namespace,
    ])).rejects.toThrow();
  }, 12 * 60_000);
});
