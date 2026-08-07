import type { ApplicationDeploymentGraph } from '@applik8s/deployment-contract';

/** Removes the production-only ApplicationHost image from a dev operation. */
export function applicationDevelopmentGraph(
  graph: ApplicationDeploymentGraph,
): ApplicationDeploymentGraph {
  const applicationImages = graph.nodes.filter(
    (node) =>
      node.kind === 'artifact'
      && node.source.semanticNodeId === 'provider.application-host',
  );
  if (applicationImages.length !== 1 || !applicationImages[0]) {
    throw new Error(
      `Development deployment requires exactly one ApplicationHost image artifact; found ${applicationImages.length}.`,
    );
  }
  const artifactId = applicationImages[0].id;
  const consumers = graph.edges.filter(
    (edge) =>
      edge.from === artifactId
      && edge.relationship === 'requiresOutput',
  );
  if (
    consumers.length !== 1
    || consumers[0]?.to !== 'kubernetes.application'
    || consumers[0].output !== 'immutableReference'
  ) {
    throw new Error(
      `Development ApplicationHost artifact ${artifactId} must have one immutable-reference consumer at kubernetes.application.`,
    );
  }
  let removedInputs = 0;
  const nodes = graph.nodes.flatMap((node) => {
    if (node.id === artifactId) return [];
    const inputs = Object.fromEntries(
      Object.entries(node.inputs).filter(([, input]) => {
        const remove =
          input.kind === 'output'
          && input.nodeId === artifactId
          && input.output === 'immutableReference';
        if (remove) removedInputs += 1;
        return !remove;
      }),
    );
    return [{ ...node, inputs }];
  });
  if (removedInputs !== 1) {
    throw new Error(
      `Development ApplicationHost artifact ${artifactId} must have one immutable-reference graph input; found ${removedInputs}.`,
    );
  }
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(
      (edge) => edge.from !== artifactId && edge.to !== artifactId,
    ),
  };
}
