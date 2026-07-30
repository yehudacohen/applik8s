// typecast-file-boundary: compiler-owned graph/catalog/deployment JSON is discriminator-checked before explanation rendering.
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
} from '@applik8s/core';
import { validateApplicationGraph } from '@applik8s/core';
import { compileApplicationWorkloadAuthority } from '@applik8s/compiler';
import {
  decodeApplicationDeploymentGraph,
  type ApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import type { ApplicationDeploymentCommandIo } from './application-deployment-command.js';

export interface ApplicationExplainCommandOptions {
  readonly outDir: string;
  readonly json?: boolean;
}

export async function explainCompiledApplicationOperation(
  query: string,
  options: ApplicationExplainCommandOptions,
  io: ApplicationDeploymentCommandIo,
): Promise<number> {
  const directory = resolve(io.cwd, options.outDir, 'typekro');
  const graph = await readApplicationGraph(
    resolve(directory, 'application-graph.json'),
  );
  const catalog = await readOperationCatalog(
    resolve(directory, 'operation-catalog.json'),
  );
  const operation = resolveOperation(catalog, query);
  const sourceGraphDigest = await readSourceGraphDigest(
    resolve(directory, 'typekro-composition.json'),
  );
  const deployment = await optionalDeploymentGraph(
    resolve(directory, 'application-deployment-graph.json'),
    sourceGraphDigest,
  );
  const report = applicationOperationExplanation(
    graph,
    catalog,
    operation,
    deployment,
    query,
  );
  if (options.json) {
    io.stdout(JSON.stringify(report));
    return 0;
  }
  renderHumanExplanation(report, io);
  return 0;
}

function applicationOperationExplanation(
  graph: ApplicationGraph,
  catalog: ApplicationOperationCatalog,
  operation: ApplicationOperationDescriptor,
  deployment: ApplicationDeploymentGraph | undefined,
  query: string,
) {
  const seedIds = new Set<string>([operation.placement.nodeId]);
  if (operation.target) {
    const target = graph.nodes.find(
      (node) =>
        (node.kind === 'model' || node.kind === 'crd')
        && node.name === operation.target?.model,
    );
    if (target) seedIds.add(target.id);
  }
  for (const node of graph.nodes) {
    if (
      (node.kind === 'command' || node.kind === 'event')
      && JSON.stringify(node).includes(operation.id)
    ) {
      seedIds.add(node.id);
    }
  }
  const relatedIds = graphNeighborhood(graph, seedIds, 2);
  const nodes = graph.nodes.filter((node) => relatedIds.has(node.id));
  const edges = graph.edges.filter(
    (edge) =>
      relatedIds.has(edge.from.nodeId) && relatedIds.has(edge.to.nodeId),
  );
  const requirements = graph.providerRequirements.filter((requirement) =>
    relatedIds.has(requirement.consumer.nodeId));
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const bindings = graph.providerBindings.filter((binding) =>
    requirementIds.has(binding.requirement));
  const providerIds = new Set(
    bindings.map((binding) => binding.provider.nodeId),
  );
  const providers = graph.nodes.filter(
    (node): node is Extract<ApplicationGraphNode, { readonly kind: 'provider' }> =>
      node.kind === 'provider'
      && (providerIds.has(node.id) || relatedIds.has(node.id)),
  );
  const workloadAuthority = compileApplicationWorkloadAuthority(
    graph,
    catalog,
  ).filter((envelope) => envelope.operationId === operation.id);
  const agents = graph.nodes.filter(
    (node) =>
      node.kind === 'aiAgent'
      && node.tools.some((tool) => tool.operationId === operation.id),
  );
  const deploymentNodes = deployment?.nodes.filter((node) =>
    node.source.semanticNodeId
      ? relatedIds.has(node.source.semanticNodeId)
      : false) ?? [];
  const deploymentIds = new Set(deploymentNodes.map((node) => node.id));
  const deploymentEdges = deployment?.edges.filter(
    (edge) =>
      deploymentIds.has(edge.from)
      || deploymentIds.has(edge.to),
  ) ?? [];
  const diagnostics = validateApplicationGraph(graph).filter((diagnostic) => {
    const serialized = JSON.stringify(diagnostic);
    return [...relatedIds].some((nodeId) => serialized.includes(nodeId));
  });
  return {
    apiVersion: 'applik8s.explanation/v1alpha1',
    query,
    application: {
      name: graph.metadata.name,
      namespace: graph.metadata.namespace,
      source: graph.metadata.sourceLocation,
      catalogRevision: catalog.revision,
    },
    operation,
    authority: {
      operation: operation.authority,
      maximumWorkloadEnvelopes: workloadAuthority,
    },
    graph: {
      nodes,
      edges,
      providers,
      requirements,
      bindings,
      agents,
    },
    deployment: deployment
      ? {
          identity: deployment.metadata.identity,
          strategy: deployment.metadata.strategy,
          sourceGraphDigest: deployment.metadata.sourceGraphDigest,
          profileTransition: deployment.metadata.profileTransition,
          nodes: deploymentNodes,
          edges: deploymentEdges,
        }
      : {
          state: 'not-planned',
          warning:
            'Run applik8s plan to add concrete TypeKro/Alchemy lifecycle and resource evidence.',
        },
    diagnostics,
  } as const;
}

function resolveOperation(
  catalog: ApplicationOperationCatalog,
  query: string,
): ApplicationOperationDescriptor {
  const normalized = query.trim().toLowerCase();
  const candidates = catalog.operations.filter((operation) => {
    const modelName = operation.target?.model;
    const aliases = [
      operation.id,
      operation.name,
      operation.kind,
      modelName ? `${modelName}.${operation.name}` : undefined,
      modelName ? `${modelName}.${operation.kind.split('.').at(-1)}` : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));
    return aliases.some((candidate) => candidate.toLowerCase() === normalized);
  });
  if (candidates.length === 1) return candidates[0] as ApplicationOperationDescriptor;
  if (candidates.length === 0) {
    throw new Error(
      `Operation ${query} is absent from catalog ${catalog.revision}. Available operations: ${catalog.operations.map((operation) => operation.target?.model ? `${operation.target.model}.${operation.name}` : operation.id).join(', ')}.`,
    );
  }
  throw new Error(
    `Operation ${query} is ambiguous. Use one exact operation id: ${candidates.map((operation) => operation.id).join(', ')}.`,
  );
}

function graphNeighborhood(
  graph: ApplicationGraph,
  seeds: ReadonlySet<string>,
  maximumDepth: number,
): ReadonlySet<string> {
  const visited = new Set(seeds);
  let frontier = [...seeds];
  for (let depth = 0; depth < maximumDepth && frontier.length > 0; depth += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.includes(edge.from.nodeId) && !visited.has(edge.to.nodeId)) {
        next.add(edge.to.nodeId);
      }
      if (frontier.includes(edge.to.nodeId) && !visited.has(edge.from.nodeId)) {
        next.add(edge.from.nodeId);
      }
    }
    for (const id of next) visited.add(id);
    frontier = [...next];
  }
  return visited;
}

async function readApplicationGraph(path: string): Promise<ApplicationGraph> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (
    !value
    || typeof value !== 'object'
    || Reflect.get(value, 'kind') !== 'ApplicationGraph'
    || !Array.isArray(Reflect.get(value, 'nodes'))
    || !Array.isArray(Reflect.get(value, 'edges'))
  ) {
    throw new Error(`Compiled application graph ${path} is invalid.`);
  }
  return value as ApplicationGraph;
}

async function readOperationCatalog(
  path: string,
): Promise<ApplicationOperationCatalog> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (
    !value
    || typeof value !== 'object'
    || Reflect.get(value, 'apiVersion')
      !== 'applik8s.operationCatalog/v1alpha1'
    || !Array.isArray(Reflect.get(value, 'operations'))
  ) {
    throw new Error(`Compiled operation catalog ${path} is invalid.`);
  }
  return value as ApplicationOperationCatalog;
}

async function optionalDeploymentGraph(
  path: string,
  sourceGraphDigest: string,
): Promise<ApplicationDeploymentGraph | undefined> {
  if (!await access(path).then(() => true).catch(() => false)) return undefined;
  const graph = decodeApplicationDeploymentGraph(await readFile(path, 'utf8'));
  return graph.metadata.sourceGraphDigest === sourceGraphDigest
    ? graph
    : undefined;
}

async function readSourceGraphDigest(path: string): Promise<string> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const spec = value && typeof value === 'object'
    ? Reflect.get(value, 'spec')
    : undefined;
  const applicationGraph = spec && typeof spec === 'object'
    ? Reflect.get(spec, 'applicationGraph')
    : undefined;
  const digest = applicationGraph && typeof applicationGraph === 'object'
    ? Reflect.get(applicationGraph, 'digest')
    : undefined;
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      `Compiled TypeKro bundle ${path} has no source ApplicationGraph digest.`,
    );
  }
  return digest;
}

function renderHumanExplanation(
  report: ReturnType<typeof applicationOperationExplanation>,
  io: ApplicationDeploymentCommandIo,
): void {
  io.stdout(`${report.operation.id} (${report.operation.kind})`);
  io.stdout(
    `Catalog: ${report.application.catalogRevision}; input ${report.operation.input.digest}; output ${report.operation.output.digest}`,
  );
  io.stdout(
    `Authority: ${report.operation.authority.classification}; checks ${report.operation.authority.checks.join(', ')}`,
  );
  io.stdout(
    `Placement: ${report.operation.placement.runtime} at ${report.operation.placement.nodeId}`,
  );
  io.stdout(
    `Graph: ${report.graph.nodes.length} related nodes, ${report.graph.edges.length} dependencies, ${report.graph.providers.length} providers`,
  );
  for (const provider of report.graph.providers) {
    io.stdout(
      `  provider ${provider.interface}: ${provider.implementation} (${provider.id})`,
    );
  }
  io.stdout(
    `Workload authority: ${report.authority.maximumWorkloadEnvelopes.length} maximum envelope(s)`,
  );
  if (!('state' in report.deployment)) {
    io.stdout(
      `Deployment: ${report.deployment.strategy} via ${report.deployment.nodes.length} related TypeKro/Alchemy nodes`,
    );
    for (const node of report.deployment.nodes) {
      io.stdout(
        `  ${node.kind} ${node.id}: ${node.lifecycle.ownership}/${node.lifecycle.deletion}`,
      );
    }
  } else {
    io.stdout(`Deployment: ${report.deployment.state}. ${report.deployment.warning}`);
  }
  if (report.diagnostics.length === 0) {
    io.stdout('Diagnostics: none');
  } else {
    io.stdout(`Diagnostics: ${report.diagnostics.length}`);
    for (const diagnostic of report.diagnostics) {
      io.stdout(`  ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
}
