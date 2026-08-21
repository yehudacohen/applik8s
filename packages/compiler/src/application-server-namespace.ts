import type {
  ApplicationGraph,
  ApplicationServerNode,
} from '@applik8s/core';

/**
 * Resolve the effective namespace of a generated application server.
 *
 * The compiler uses this identity for both the emitted workload and every
 * private caller authorization derived from that workload. Keeping the
 * resolution in one place prevents a generated-resource namespace from being
 * deployed successfully while its workflow gateway authorizes a different
 * service-account identity.
 */
export function applicationServerNamespace(
  graph: ApplicationGraph,
  server: ApplicationServerNode,
  fallback = 'default',
): string {
  return server.deployment?.namespace
    ?? graph.metadata.namespace
    ?? generatedServerWorkloadNamespace(server)
    ?? fallback;
}

function generatedServerWorkloadNamespace(
  server: ApplicationServerNode,
): string | undefined {
  const resource = server.generatedResources?.find(
    (candidate) => candidate.role === 'workload',
  )?.resource;
  return resource && 'namespace' in resource
    && typeof resource.namespace === 'string'
    ? resource.namespace
    : undefined;
}
