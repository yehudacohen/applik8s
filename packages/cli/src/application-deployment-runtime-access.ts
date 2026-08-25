import { makeKubernetesApiClient } from './kubernetes-api-client.js';

/**
 * Observe an installed target capability without treating an authored
 * application value as cluster authority. Absence, unreadability, or an
 * unhealthy agent fails closed to standard NetworkPolicy.
 */
export async function observeKubernetesRuntimeAccessNetworkPolicyProvider(
  context: string,
): Promise<'standard' | 'cilium'> {
  // static-import-exception: cluster observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  try {
    const extensions = makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api);
    const apps = makeKubernetesApiClient(kubeConfig, kubernetes.AppsV1Api);
    const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
    const [crds, daemonSets, ciliumConfig] = await Promise.all([
      extensions.listCustomResourceDefinition({}),
      apps.listDaemonSetForAllNamespaces({ labelSelector: 'k8s-app=cilium' }),
      core.readNamespacedConfigMap({ name: 'cilium-config', namespace: 'kube-system' }),
    ]);
    return classifyKubernetesRuntimeAccessNetworkPolicyProvider(crds.items, daemonSets.items, [ciliumConfig]);
  } catch {
    return 'standard';
  }
}

export function classifyKubernetesRuntimeAccessNetworkPolicyProvider(
  crds: readonly {
    readonly metadata?: { readonly name?: string };
    readonly spec: { readonly group: string; readonly names: { readonly kind: string }; readonly versions: readonly { readonly name: string; readonly served: boolean }[] };
    readonly status?: { readonly conditions?: readonly { readonly type: string; readonly status: string }[] };
  }[],
  daemonSets: readonly {
    readonly metadata?: { readonly name?: string; readonly labels?: Readonly<Record<string, string>> };
    readonly status?: { readonly desiredNumberScheduled: number; readonly numberReady: number };
  }[],
  configMaps: readonly {
    readonly metadata?: { readonly name?: string; readonly namespace?: string };
    readonly data?: Readonly<Record<string, string>>;
  }[],
): 'standard' | 'cilium' {
    const policyCrd = crds.find(({ metadata, spec, status }) =>
      metadata?.name === 'ciliumnetworkpolicies.cilium.io'
      && spec.group === 'cilium.io'
      && spec.names.kind === 'CiliumNetworkPolicy'
      && spec.versions.some(({ name, served }) => name === 'v2' && served)
      && status?.conditions?.some(({ type, status: state }) => type === 'Established' && state === 'True'));
    const readyAgent = daemonSets.some(({ metadata, status }) =>
      (metadata?.name === 'cilium' || metadata?.labels?.['k8s-app'] === 'cilium')
      && typeof status?.desiredNumberScheduled === 'number'
      && status.desiredNumberScheduled > 0
      && status.numberReady === status.desiredNumberScheduled);
    const l7ProxyEnabled = configMaps.some(({ metadata, data }) =>
      metadata?.name === 'cilium-config'
      && metadata.namespace === 'kube-system'
      && data?.['enable-l7-proxy'] === 'true');
    return policyCrd && readyAgent && l7ProxyEnabled ? 'cilium' : 'standard';
}
