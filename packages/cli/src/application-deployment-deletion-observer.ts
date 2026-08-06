import type { ApplicationDeploymentGraph } from '@applik8s/deployment-contract';
import * as kubernetes from '@kubernetes/client-node';
import { kubernetesStatusCode } from './application-deployment-exposure-observer.js';
import type { ApplicationDeploymentObserverIo } from './application-deployment-observer.js';
import { APPLICATION_DEPLOYMENT_TIMEOUT_MS } from './application-deployment-timeouts.js';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

/** Concrete application-owned namespaces whose deletion is part of destroy. */
export function applicationOwnedDeletionNamespaces(
  graph: ApplicationDeploymentGraph,
): readonly string[] {
  return [...new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === 'kubernetesDirect'
          && node.spec.compositionId === 'applik8s-namespace'
          && node.lifecycle.ownership === 'application'
          && node.lifecycle.deletion === 'delete',
      )
      .map((node) => {
        const configuration = node.spec.configuration;
        const name =
          configuration && typeof configuration === 'object'
            ? Reflect.get(configuration, 'name')
            : undefined;
        if (typeof name !== 'string' || !name.trim()) {
          throw new Error(
            `Application-owned namespace node ${node.id} has no concrete configuration.name.`,
          );
        }
        return name;
      }),
  )].sort();
}

/**
 * A successful Alchemy transaction is not yet an authoritative Kubernetes
 * deletion receipt: Namespace deletion is asynchronous. Do not allow a
 * subsequent install to race a terminating namespace or report cleanup while
 * PVC/finalizer work remains.
 */
export async function waitForApplicationOwnedNamespaceDeletion(
  context: string,
  graph: ApplicationDeploymentGraph,
  io: ApplicationDeploymentObserverIo,
  timeoutMs = APPLICATION_DEPLOYMENT_TIMEOUT_MS,
): Promise<void> {
  const pending = new Set(applicationOwnedDeletionNamespaces(graph));
  if (pending.size === 0) return;
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  const startedAt = Date.now();
  let lastReport = 0;
  while (pending.size > 0 && Date.now() - startedAt < timeoutMs) {
    for (const name of [...pending]) {
      const namespace = await core.readNamespace({ name }).catch(
        (cause: unknown) => {
          if (kubernetesStatusCode(cause) === 404) return undefined;
          throw cause;
        },
      );
      if (!namespace) pending.delete(name);
    }
    if (pending.size === 0) return;
    if (Date.now() - lastReport >= 15_000) {
      io.stdout(
        `Waiting for application-owned Namespace deletion: ${[...pending].sort().join(', ')}`,
      );
      lastReport = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for application-owned Namespace deletion: ${[...pending].sort().join(', ')}. Inspect namespaced finalizers and resume the same destroy transaction.`,
  );
}
