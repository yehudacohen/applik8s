import type { ApplicationGraphNode } from '@applik8s/core';

/**
 * Returns only provider references that are part of a graph node's declared
 * contract. This deliberately avoids walking arbitrary nested `nodeId`
 * properties: doing so could turn unrelated metadata into runtime authority.
 */
export function applicationWorkloadProviderNodeIds(node: ApplicationGraphNode | undefined): readonly string[] {
  if (!node) return [];
  switch (node.kind) {
    case 'model': return [node.database.nodeId];
    case 'server': return node.exposure ? [node.exposure.nodeId] : [];
    case 'index': return [node.provider.nodeId];
    case 'counter': return node.provider ? [node.provider.nodeId] : [];
    case 'processor': return node.eventLog ? [node.eventLog.nodeId] : [];
    case 'taskHandler': return [
      node.workflowEngine.nodeId,
      ...(node.capabilities ?? []).map(({ nodeId }) => nodeId),
      ...(node.providerBindings ?? []).map(({ provider }) => provider.nodeId),
    ];
    case 'workflowHandler':
    case 'workflowWorker': return [node.workflowEngine.nodeId];
    case 'schedule': return [
      node.scheduler.nodeId,
      ...(node.providerBindings ?? []).map(({ provider }) => provider.nodeId),
    ];
    case 'lakehousePublication': return [node.dataset.nodeId, ...(node.eventLog ? [node.eventLog.nodeId] : [])];
    case 'actor': return [
      node.runtime.nodeId,
      ...(node.providerBindings ?? []).map(({ provider }) => provider.nodeId),
    ];
    case 'aiAgent': return [
      node.inference.nodeId,
      node.state.nodeId,
      ...(node.providerBindings ?? []).map(({ provider }) => provider.nodeId),
    ];
    case 'query': return node.search ? [node.search.provider.nodeId] : [];
    case 'streamProcessor': return [
      ...(node.providerBindings ?? []).map(({ provider }) => provider.nodeId),
      ...(node.workflowEngine ? [node.workflowEngine.nodeId] : []),
    ];
    case 'projection': return [node.provider.nodeId];
    case 'objectStore': return [node.provider.nodeId];
    case 'exposure': return [
      node.provider.nodeId,
      ...(node.certificate ? [node.certificate.nodeId] : []),
      ...(node.dnsPublication ? [node.dnsPublication.nodeId] : []),
    ];
    default: return [];
  }
}

/** Exact semantic dependencies whose provider requirements belong to a workload. */
export function applicationWorkloadDependencyNodeIds(node: ApplicationGraphNode | undefined): readonly string[] {
  if (!node) return [];
  switch (node.kind) {
    case 'processor': return node.handlers.map(({ nodeId }) => nodeId);
    case 'commandHandler': return [node.model.nodeId, node.command.nodeId, ...node.transaction.models.map(({ nodeId }) => nodeId), ...node.transaction.history.map(({ nodeId }) => nodeId), ...node.transaction.outbox.map(({ nodeId }) => nodeId)];
    case 'query': return node.reads.map(({ model }) => model.nodeId);
    case 'gateway': return [...node.queries.map(({ nodeId }) => nodeId), ...node.commands.flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...node.subscriptions.map(({ nodeId }) => nodeId)];
    case 'workflowWorker': return node.handlers.map(({ nodeId }) => nodeId);
    case 'workflowHandler': return [node.workflow.nodeId, ...node.tasks.map(({ nodeId }) => nodeId), ...node.childWorkflows.map(({ nodeId }) => nodeId)];
    case 'taskHandler': return [node.task.nodeId, ...(node.operations ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queries ?? []).map(({ query }) => query.nodeId), ...(node.projections ?? []).flatMap(({ projection, artifacts }) => [projection.nodeId, artifacts.nodeId]), ...(node.objects ?? []).map(({ store }) => store.nodeId), ...(node.actors ?? []).map(({ actor }) => actor.nodeId)];
    case 'aiAgent': return [...node.tools.flatMap(({ graphNode }) => graphNode ? [graphNode.nodeId] : []), ...(node.operations ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queries ?? []).map(({ query }) => query.nodeId), ...(node.actors ?? []).map(({ actor }) => actor.nodeId)];
    case 'streamProcessor': return [node.source.nodeId, ...(node.functionNativeTransaction?.models ?? []).map(({ nodeId }) => nodeId), ...(node.operationBindings ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queryBindings ?? []).map(({ query }) => query.nodeId), ...(node.actorBindings ?? []).map(({ actor }) => actor.nodeId), ...(node.applicationScheduleBindings ?? []).flatMap(({ schedule, scheduler }) => [schedule.nodeId, scheduler.nodeId]), ...(node.schedules ?? []).map(({ target }) => target.nodeId), ...(node.tasks ?? []).map(({ target }) => target.nodeId)];
    case 'projection': return [node.source.nodeId, ...(node.online?.rebuild.source ? [node.online.rebuild.source.nodeId] : [])];
    case 'subscription': return [node.source.nodeId];
    default: return [];
  }
}
