import type {
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationMcpServerNode,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationQueryNode,
} from '@applik8s/core';
import { applicationGraphNumberValue, applicationGraphStringValue } from '../application-installation-values.js';

export interface ApplicationMcpPlacementRoute {
  readonly serverId: string;
  readonly serverName: string;
  readonly tool: string;
  readonly operationId: ApplicationOperationDescriptor['id'];
  readonly operationVersion: string;
  readonly placement: ApplicationOperationDescriptor['placement'];
  readonly receiver: {
    readonly nodeId: string;
    readonly kind: 'generatedGateway';
    readonly serviceName: string;
    readonly namespace: string;
    readonly port: number;
    readonly path: '/__applik8s/internal/v1/operations';
    readonly url: string;
  };
}

/**
 * Resolves every MCP tool to the generated workload that already owns its
 * public transport boundary. The route does not move or copy an operation
 * implementation: command execution remains in its command processor, while
 * the generated gateway performs the existing durable submission.
 */
export function compileApplicationMcpPlacementRoutes(
  graph: ApplicationGraph,
  catalog: ApplicationOperationCatalog,
): readonly ApplicationMcpPlacementRoute[] {
  if (catalog.application !== graph.metadata.name) {
    throw new Error(
      `Operation catalog ${catalog.application} does not belong to ${graph.metadata.name}.`,
    );
  }
  const operations = new Map(
    catalog.operations.map((operation) => [operation.id, operation]),
  );
  const gateways = graph.nodes.filter(
    (node): node is ApplicationGatewayNode =>
      node.kind === 'gateway'
      && node.materialization === 'generatedDeployment',
  );
  const queries = new Map(
    graph.nodes
      .filter((node): node is ApplicationQueryNode => node.kind === 'query')
      .map((query) => [query.id, query]),
  );
  return graph.nodes
    .filter((node): node is ApplicationMcpServerNode => node.kind === 'mcpServer')
    .flatMap((server) => server.tools.map((tool) => {
      const operation = operations.get(tool.operationId);
      if (!operation) {
        throw new Error(
          `Application MCP server ${server.name} exposes unavailable operation ${tool.operationId}.`,
        );
      }
      const candidates = gateways.filter((gateway) =>
        gatewayReceivesOperation(gateway, operation, queries),
      );
      if (candidates.length === 0) {
        throw new Error(
          `Application MCP tool ${server.name}.${tool.publicName} cannot route ${operation.id} at ${operation.placement.runtime} placement ${operation.placement.nodeId}. Expose the operation through one generated app.gateway(...) boundary or add a placement receiver for that runtime.`,
        );
      }
      if (candidates.length > 1) {
        throw new Error(
          `Application MCP tool ${server.name}.${tool.publicName} has ambiguous receivers for ${operation.id}: ${candidates.map((candidate) => candidate.id).sort().join(', ')}.`,
        );
      }
      const receiver = candidates[0]!;
      if (!receiver.deployment) {
        throw new Error(
          `Application MCP receiver ${receiver.id} has no generated deployment.`,
        );
      }
      const namespace =
        applicationGraphStringValue(receiver.deployment.namespace) ?? 'default';
      const port =
        applicationGraphNumberValue(receiver.deployment.port)
        ?? receiver.deployment.port;
      if (typeof port !== 'number') {
        throw new Error(
          `Application MCP receiver ${receiver.id} has a non-concrete service port.`,
        );
      }
      const serviceName = kubernetesName(
        `${graph.metadata.name}-${receiver.name}`,
      );
      const path = '/__applik8s/internal/v1/operations' as const;
      return {
        serverId: server.id,
        serverName: server.name,
        tool: tool.publicName,
        operationId: operation.id,
        operationVersion: operation.version,
        placement: operation.placement,
        receiver: {
          nodeId: receiver.id,
          kind: 'generatedGateway' as const,
          serviceName,
          namespace,
          port,
          path,
          url: `http://${serviceName}.${namespace}.svc:${port}${path}`,
        },
      };
    }))
    .sort((left, right) =>
      `${left.serverName}:${left.tool}`.localeCompare(
        `${right.serverName}:${right.tool}`,
      ),
    );
}

function gatewayReceivesOperation(
  gateway: ApplicationGatewayNode,
  operation: ApplicationOperationDescriptor,
  queries: ReadonlyMap<string, ApplicationQueryNode>,
): boolean {
  if (
    operation.placement.runtime === 'command-processor'
    && gateway.commands.some(
      (command) => command.handler.nodeId === operation.placement.nodeId,
    )
  ) {
    return true;
  }
  if (
    operation.placement.runtime !== 'server'
    || operation.kind === 'http.raw'
  ) {
    return false;
  }
  if (
    gateway.queries.some(
      (query) => query.nodeId === operation.placement.nodeId,
    )
    || gateway.subscriptions.some(
      (subscription) =>
        subscription.nodeId === operation.placement.nodeId,
    )
  ) {
    return true;
  }
  if (!operation.target?.model) return false;
  return gateway.queries.some((reference) => {
    const query = queries.get(reference.nodeId);
    return query?.modelOperation?.model.nodeId === operation.placement.nodeId
      && query.modelOperation.name === operation.name;
  });
}

function kubernetesName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'app';
}
