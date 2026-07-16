import type {
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationProjectionNode,
  ApplicationQueryNode,
  ApplicationStreamNode,
  ApplicationSubscriptionNode,
} from './application-graph.js';

type ReactiveNode = ApplicationQueryNode | ApplicationGatewayNode | ApplicationStreamNode | ApplicationSubscriptionNode | ApplicationProjectionNode;

/** Keeps v0.6 reactive graph invariants cohesive and independent of the legacy graph validator. */
export function applicationReactiveNodeStructureMessages(node: ReactiveNode, graph: ApplicationGraph): readonly string[] {
  switch (node.kind) {
    case 'query':
      return queryMessages(node, graph);
    case 'gateway':
      return gatewayMessages(node, graph);
    case 'stream':
      return streamMessages(node);
    case 'subscription':
      return subscriptionMessages(node, graph);
    case 'projection':
      return projectionMessages(node, graph);
  }
}

function queryMessages(node: ApplicationQueryNode, graph: ApplicationGraph): readonly string[] {
  const ids = new Set(graph.nodes.map((candidate) => candidate.id));
  const messages: string[] = [];
  if (!node.version || node.reads.length === 0) messages.push(`Application query ${node.id} must declare a version and at least one read dependency.`);
  for (const read of node.reads) if (!ids.has(read.model.nodeId)) messages.push(`Application query ${node.id} reads missing model ${read.model.nodeId}.`);
  if (node.budgets.timeoutMs < 1 || node.budgets.maxResultBytes < 1 || node.budgets.maxRows < 1) messages.push(`Application query ${node.id} budgets must be positive.`);
  if (!node.authorizationSource?.trim() || !node.handlerSource?.trim()) messages.push(`Application query ${node.id} must retain serializable authorization and handler callbacks.`);
  if (node.snapshotResume === 'resumableInvalidation' && !node.database) messages.push(`Application query ${node.id} promises resumable invalidation without a PostgreSQL database runtime.`);
  return messages;
}

function gatewayMessages(node: ApplicationGatewayNode, graph: ApplicationGraph): readonly string[] {
  const byId = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const messages: string[] = [];
  if (node.queries.length + node.commands.length + node.subscriptions.length === 0) messages.push(`Application gateway ${node.id} must expose at least one query, command, or subscription.`);
  for (const query of node.queries) if (byId.get(query.nodeId)?.kind !== 'query') messages.push(`Application gateway ${node.id} references non-query ${query.nodeId}.`);
  for (const subscription of node.subscriptions) if (byId.get(subscription.nodeId)?.kind !== 'subscription') messages.push(`Application gateway ${node.id} references non-subscription ${subscription.nodeId}.`);
  if (node.subscriptionLimits.perPrincipal < 1 || node.subscriptionLimits.total < node.subscriptionLimits.perPrincipal) messages.push(`Application gateway ${node.id} has invalid subscription limits.`);
  if (node.materialization === 'generatedDeployment' && (!node.authenticationSource?.trim() || !node.cursorSecret || !node.deployment)) messages.push(`Generated application gateway ${node.id} must declare authentication, cursor Secret, and deployment contracts.`);
  for (const command of node.commands) {
    if (byId.get(command.command.nodeId)?.kind !== 'command' || byId.get(command.handler.nodeId)?.kind !== 'commandHandler') messages.push(`Application gateway ${node.id} references an invalid command or command handler.`);
  }
  if (node.commands.length > 0 && !node.commandAuthorizationSource?.trim()) messages.push(`Application gateway ${node.id} exposes commands without an application authorization callback.`);
  return messages;
}

function streamMessages(node: ApplicationStreamNode): readonly string[] {
  const messages: string[] = [];
  if (!node.version || node.retention.maxAgeSeconds < 1) messages.push(`Application stream ${node.id} must declare a version and positive retention.`);
  if (node.retention.maxMessages !== undefined && node.retention.maxMessages < 1) messages.push(`Application stream ${node.id} maxMessages must be positive when declared.`);
  if (node.authority !== 'postgres-outbox' || node.replay !== 'supported') messages.push(`Application stream ${node.id} uses an authority or replay mode not implemented in v0.6.`);
  if (!node.partitionSource?.trim() || !node.authorizationSource?.trim()) messages.push(`Application stream ${node.id} must retain serializable partition and authorization callbacks.`);
  return messages;
}

function subscriptionMessages(node: ApplicationSubscriptionNode, graph: ApplicationGraph): readonly string[] {
  const source = graph.nodes.find((candidate) => candidate.id === node.source.nodeId);
  return (source?.kind === 'stream' || source?.kind === 'query') && (node.delivery === 'polling' || node.delivery === 'sse') && node.authorizationSource.trim()
    ? []
    : [`Application subscription ${node.id} must consume a stream or query source and retain serializable authorization.`];
}

function projectionMessages(node: ApplicationProjectionNode, graph: ApplicationGraph): readonly string[] {
  const source = graph.nodes.find((candidate) => candidate.id === node.source.nodeId);
  const messages: string[] = [];
  if (source?.kind !== 'stream') messages.push(`Application projection ${node.id} must consume a replayable stream.`);
  if (!node.handlerSource.trim()) messages.push(`Application projection ${node.id} must retain a serializable projector.`);
  if (node.checkpoint !== 'idempotent') messages.push(`Application projection ${node.id} uses a checkpoint mode not implemented by the v0.6 ClickHouse runtime.`);
  return messages;
}
