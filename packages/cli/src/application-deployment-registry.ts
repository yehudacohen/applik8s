// typecast-file-boundary: registry discovery validates generated graph JSON and Kubernetes service data before returning a typed provider endpoint.
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { resolveApplicationInstallationValues } from './application-installation-values.js';
import type {
  ApplicationContainerRegistryEndpoint,
  ApplicationContainerRegistryProvider,
} from '@applik8s/applik8s/deployment-registry';
import {
  applicationContainerRegistryFromGraph,
  type ResolvedApplicationContainerRegistry,
  resolveApplicationContainerRegistry,
} from '@applik8s/applik8s/deployment-registry';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

export interface ApplicationDeploymentRegistryIo {
  readonly cwd: string;
  stdout(message: string): void;
}

export async function resolveDeploymentContainerRegistry(
  bundlePath: string,
  context: string,
  spec: Readonly<Record<string, unknown>>,
  io: ApplicationDeploymentRegistryIo,
): Promise<ResolvedApplicationContainerRegistry> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  const graph = graphPath ? await readGeneratedApplicationGraph(bundlePath, io.cwd) : undefined;
  const registryGraph = graph
    ? applicationGraphDeploymentSlice(
        graph,
        (node) =>
          node.kind === 'provider'
          && node.interface === 'ContainerRegistry'
          && (
            !node.config?.qualification
            || typeof node.config.qualification !== 'object'
            || Array.isArray(node.config.qualification)
          ),
      )
    : undefined;
  const authoredProvider = registryGraph
    ? applicationContainerRegistryFromGraph(resolveApplicationInstallationValues(registryGraph, spec, { preserveInstallationReferences: true }))
    : { kind: 'orbstack-container-registry' } satisfies ApplicationContainerRegistryProvider;
  const provider = registryGraph
    ? applicationContainerRegistryFromGraph(resolveApplicationInstallationValues(registryGraph, spec))
    : authoredProvider;
  const resolved = await resolveApplicationContainerRegistry(
    provider,
    (endpoint) => resolveKubernetesNodePortEndpoint(context, endpoint),
  );
  io.stdout(resolved.remote
    ? `Container registry: ${resolved.origin}/${resolved.repositoryPrefix ?? ''}`.replace(/\/$/, '')
    : 'Container registry: OrbStack local image store');
  const deploymentRepositoryPrefix = authoredProvider.kind === 'harbor-container-registry'
    ? authoredProvider.project
    : authoredProvider.kind === 'oci-container-registry'
      ? authoredProvider.repositoryPrefix
      : undefined;
  return deploymentRepositoryPrefix && deploymentRepositoryPrefix !== resolved.repositoryPrefix
    ? { ...resolved, deploymentRepositoryPrefix }
    : resolved;
}

export async function readGeneratedApplicationGraph(
  bundlePath: string,
  projectRoot = process.cwd(),
): Promise<ApplicationGraph> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  if (!graphPath) throw new Error('Generated TypeKro bundle does not reference an ApplicationGraph.');
  const projectPath = graphPath.startsWith('/') ? graphPath : resolve(projectRoot, graphPath);
  const bundlePathCandidate = resolve(dirname(bundlePath), graphPath);
  const resolvedPath = await access(projectPath).then(() => projectPath).catch(async () =>
    access(bundlePathCandidate).then(() => bundlePathCandidate));
  const graph = JSON.parse(await readFile(resolvedPath, 'utf8')) as ApplicationGraph;
  if (graph.apiVersion !== 'applik8s.appGraph/v1alpha1' || graph.kind !== 'ApplicationGraph') {
    throw new Error(`Generated application graph ${resolvedPath} has an unsupported contract.`);
  }
  return graph;
}

/** Materialize only the nodes consumed by one deployment phase. */
export function applicationGraphDeploymentSlice(
  graph: ApplicationGraph,
  include: (node: ApplicationGraph['nodes'][number]) => boolean,
): ApplicationGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(include),
    edges: [],
    providerBindings: [],
    providerRequirements: [],
  };
}

async function resolveKubernetesNodePortEndpoint(
  context: string,
  endpoint: Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>,
): Promise<string> {
  // static-import-exception: registry discovery uses Kubernetes only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  const service = await core.readNamespacedService({
    namespace: endpoint.namespace,
    name: endpoint.service,
  });
  if (service.spec?.type !== 'NodePort' || !service.spec.ports?.some((port) => port.nodePort === endpoint.port)) {
    throw new Error(`ContainerRegistry NodePort ${endpoint.namespace}/${endpoint.service}:${endpoint.port} is not exposed by the selected Kubernetes context.`);
  }
  if (endpoint.publishHost) {
    return `${endpoint.protocol}://${endpoint.publishHost}:${endpoint.port}`;
  }
  const nodes = await core.listNode({});
  const address = nodes.items
    .flatMap((node) => node.status?.addresses ?? [])
    .find((candidate) => candidate.type === 'InternalIP' && typeof candidate.address === 'string')
    ?.address;
  if (!address) throw new Error(`Kubernetes context ${context} has no node InternalIP for the configured registry NodePort.`);
  return `${endpoint.protocol}://${address}:${endpoint.port}`;
}
