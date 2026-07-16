import { singleton } from 'typekro';
import { DEFAULT_CLICKHOUSE_REPO_NAME, DEFAULT_CLICKHOUSE_REPO_URL, clickHouseCluster, clickhouseHelmRepositoryBootstrap, clickhouseOperatorBootstrap } from 'typekro/clickhouse';
import { networkPolicy } from 'typekro/kubernetes';
import { graphResourceId, kubernetesNameSegment } from './application-identifiers.js';
import { applicationProjectionStoreImplementation } from './application-providers.js';

export interface ApplicationProjectionStoreResourceState {
  readonly emittedProjectionStores: Set<string>;
}

/** Materializes the default shared ClickHouse control plane and app-owned data plane. */
export function emitApplicationProjectionStoreResources(state: ApplicationProjectionStoreResourceState, provider: unknown): void {
  const projection = applicationProjectionStoreImplementation(provider);
  if (!projection || projection.provision === false) return;
  const name = projection.name ?? 'applik8s-analytics';
  const namespace = projection.namespace ?? 'applik8s-analytics';
  const key = `${namespace}:${name}`;
  if (state.emittedProjectionStores.has(key)) return;
  state.emittedProjectionStores.add(key);
  // Materialize the nested repository singleton explicitly. Wrapping the
  // complete operator composition as a singleton intentionally does not
  // execute its body while the parent graph is built, so its nested singleton
  // owner must also be visible at the application composition boundary.
  singleton(clickhouseHelmRepositoryBootstrap, {
    id: 'clickhouse-helm-repository',
    spec: { name: DEFAULT_CLICKHOUSE_REPO_NAME, namespace: 'flux-system', url: DEFAULT_CLICKHOUSE_REPO_URL },
  });
  singleton(clickhouseOperatorBootstrap, {
    id: 'applik8s-clickhouse-operator',
    spec: {
      name: 'clickhouse-operator',
      namespace: 'clickhouse-system',
      shared: true,
      customValues: {
        configs: {
          files: {
            // The official chart otherwise watches only its own namespace
            // outside kube-system. Applik8s provisions CHIs in application
            // namespaces, so the singleton must make its cluster scope real.
            'config.yaml': {
              watch: { namespaces: { include: ['.*'], exclude: [] } },
              clickhouse: {
                configuration: {
                  user: {
                    // Provisioned stores use Kubernetes workload isolation as
                    // their admission boundary. Altinity otherwise restricts
                    // the passwordless default user to localhost/CHI peers.
                    default: { networksIP: ['0.0.0.0/0', '::/0'] },
                  },
                },
              },
              label: {
                exclude: [
                  'applyset.kubernetes.io/part-of',
                  'kro.run/instance-group',
                  'kro.run/instance-id',
                  'kro.run/instance-kind',
                  'kro.run/instance-name',
                  'kro.run/instance-namespace',
                  'kro.run/instance-version',
                  'kro.run/kro-version',
                  'kro.run/node-id',
                  'kro.run/owned',
                  'typekro.io/factory',
                  'typekro.io/mode',
                  'typekro.io/rgd',
                ],
              },
              annotation: {
                exclude: [
                  'applyset.kubernetes.io/additional-namespaces',
                  'applyset.kubernetes.io/contains-group-kinds',
                  'applyset.kubernetes.io/tooling',
                ],
              },
            },
          },
        },
      },
    },
  });
  clickHouseCluster({
    name,
    namespace,
    version: projection.version ?? '25.12.5',
    storage: { size: projection.storageSize ?? '10Gi', ...(projection.storageClassName ? { storageClassName: projection.storageClassName } : {}) },
  });
  networkPolicy({
    id: graphResourceId(name, 'clickhouseClientAccess'),
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: `${kubernetesNameSegment(name)}-client-access`, namespace },
    spec: {
      podSelector: { matchLabels: { 'clickhouse.altinity.com/chi': name } },
      policyTypes: ['Ingress'],
      // typecast: preserve the Kubernetes `from` wire key despite client-node naming it `_from`.
      ingress: [{
        from: [
          { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } }, podSelector: { matchLabels: { 'app.kubernetes.io/component': 'projection-worker' } } },
          { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } }, podSelector: { matchLabels: { 'clickhouse.altinity.com/chi': name } } },
          { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'clickhouse-system' } } },
        ],
        ports: [{ protocol: 'TCP', port: 8123 }, { protocol: 'TCP', port: 9000 }],
      } as never],
    },
  });
}
