// typecast-file-boundary: Portable graph nodes are recognized from unknown authored objects by explicit discriminants.
import type { SourceLocation } from './common.js';
import type {
  ApplicationGraph,
  ApplicationGraphFoundationContract,
  ApplicationGraphNode,
  ApplicationGraphNodeKind,
  ApplicationGraphNodeRef,
} from './application-graph-contract.js';
import {
  type ApplicationCanonicalIdentity,
  type ApplicationRuntimeAccessOperation,
  type ApplicationRuntimeAccessRequirement,
  type ApplicationRuntimeAccessScope,
  type ApplicationSourceProvenance,
  applicationCanonicalIdentity,
  applicationExecutionBoundaryIdentity,
  applicationGraphNodeIdentity,
  applicationProviderIdentity,
  applicationRuntimeAccessRequirement,
  mergeApplicationRuntimeAccessRequirements,
  sourceProvenance,
} from './application-foundation.js';

export interface DeriveApplicationGraphFoundationOptions {
  /** Required when compiler discovery retained absolute authored paths. */
  readonly workspaceRoot?: string;
}

const executionNodeKinds = new Set<ApplicationGraphNodeKind>([
  'server',
  'operator',
  'commandHandler',
  'processor',
  'taskHandler',
  'workflowHandler',
  'workflowWorker',
  'aiAgent',
  'mcpServer',
  'mcpClient',
  'query',
  'gateway',
  'streamProcessor',
  'subscription',
  'projection',
  'job',
  'schedule',
  'lakehousePublication',
  'actor',
]);

/**
 * Derives the v0.8 identity, provenance, and access layer from the one
 * authoritative application graph. This analysis has no deployment effects.
 */
export function deriveApplicationGraphFoundation(
  graph: ApplicationGraph,
  options: DeriveApplicationGraphFoundationOptions = {},
): ApplicationGraphFoundationContract {
  const application = applicationCanonicalIdentity({
    application: graph.metadata.name,
    kind: 'application',
    semanticKey: graph.metadata.name,
  });
  const executionIdentities = new Map<string, ApplicationCanonicalIdentity>();
  const provenanceByNode = new Map<string, ApplicationSourceProvenance>();
  const identities: ApplicationCanonicalIdentity[] = [application];

  for (const node of graph.nodes) {
    const identity = applicationGraphNodeIdentity({
      application: graph.metadata.name,
      nodeKind: node.kind,
      nodeId: node.id,
      parentId: application.id,
    });
    identities.push(identity);
    provenanceByNode.set(node.id, graphNodeProvenance(node, identity, options.workspaceRoot));
    if (node.kind === 'provider') {
      identities.push(applicationProviderIdentity({
        application: graph.metadata.name,
        capabilityInterface: node.interface,
        nodeId: node.id,
        parentId: application.id,
      }));
    }
    if (executionNodeKinds.has(node.kind)) {
      const execution = applicationExecutionBoundaryIdentity({
        application: graph.metadata.name,
        boundaryKind: executionBoundaryKind(node),
        ownerNodeId: node.id,
        parentId: identity.id,
      });
      executionIdentities.set(node.id, execution);
      identities.push(execution);
    }
  }

  const requirements: ApplicationRuntimeAccessRequirement[] = [];
  const add = (
    consumer: ApplicationGraphNode,
    operation: ApplicationRuntimeAccessOperation,
    capabilityId: string,
    scope: ApplicationRuntimeAccessScope,
    origin: ApplicationRuntimeAccessRequirement['origin'] = 'inferred',
  ): void => {
    const execution = executionIdentities.get(consumer.id);
    const provenance = provenanceByNode.get(consumer.id);
    if (!execution || !provenance) return;
    requirements.push(applicationRuntimeAccessRequirement({
      consumer: { nodeId: consumer.id, executionIdentity: execution.id },
      target: { capabilityId, operation, scope },
      origin,
      provenance: [provenance],
      sensitivity: operation === 'secret.read' ? 'credential' : 'internal',
      enforcement: 'required',
    }));
  };

  for (const edge of graph.edges) {
    const consumer = nodeFor(graph, edge.from);
    const target = nodeFor(graph, edge.to);
    if (!consumer || !target || !executionIdentities.has(consumer.id)) continue;
    const access = accessForEdge(edge.relationship, target);
    if (access) add(consumer, access.operation, access.capabilityId, access.scope);
  }

  for (const node of graph.nodes) {
    if (!executionIdentities.has(node.id)) continue;
    for (const requirement of graph.providerRequirements.filter(({ consumer }) => consumer.nodeId === node.id)) {
      add(node, 'connection.use', requirement.interface, {
        kind: 'capability',
        capabilityId: requirement.interface,
      }, 'framework');
    }
    addNodeSpecificRequirements(node, graph, add);
  }

  return {
    identities: uniqueIdentities([...(graph.foundation?.identities ?? []), ...identities]),
    provenance: uniqueProvenance([
      ...(graph.foundation?.provenance ?? []),
      ...provenanceByNode.values(),
    ]),
    runtimeAccess: mergeApplicationRuntimeAccessRequirements([
      ...(graph.foundation?.runtimeAccess ?? []),
      ...requirements,
    ]),
  };
}

export function withDerivedApplicationGraphFoundation(
  graph: ApplicationGraph,
  options: DeriveApplicationGraphFoundationOptions = {},
): ApplicationGraph {
  return { ...graph, foundation: deriveApplicationGraphFoundation(graph, options) };
}

function addNodeSpecificRequirements(
  node: ApplicationGraphNode,
  graph: ApplicationGraph,
  add: (
    consumer: ApplicationGraphNode,
    operation: ApplicationRuntimeAccessOperation,
    capabilityId: string,
    scope: ApplicationRuntimeAccessScope,
    origin?: ApplicationRuntimeAccessRequirement['origin'],
  ) => void,
): void {
  if (node.kind === 'commandHandler') {
    for (const model of node.transaction.models) {
      add(node, 'model.read', model.nodeId, resourceScope(model));
      add(node, 'model.write', model.nodeId, resourceScope(model));
    }
    for (const event of node.transaction.outbox) add(node, 'event.publish', event.nodeId, resourceScope(event), 'framework');
    return;
  }
  if (node.kind === 'taskHandler') {
    for (const operation of node.operations ?? []) {
      if (operation.command?.nodeId) add(node, 'model.write', operation.command.nodeId, resourceScope(operation.command));
    }
    for (const query of node.queries ?? []) {
      if (query.query?.nodeId) add(node, 'model.read', query.query.nodeId, resourceScope(query.query));
    }
    for (const projection of node.projections ?? []) {
      add(node, 'search.write', projection.projection.nodeId, resourceScope(projection.projection));
      add(node, 'object.write', projection.artifacts.nodeId, resourceScope(projection.artifacts));
    }
    for (const object of node.objects ?? []) {
      add(node, 'object.read', object.store.nodeId, resourceScope(object.store));
      add(node, 'object.write', object.store.nodeId, resourceScope(object.store));
    }
    if (node.workflowEngine?.interface) add(node, 'connection.use', node.workflowEngine.interface, { kind: 'capability', capabilityId: node.workflowEngine.interface }, 'framework');
    return;
  }
  if (node.kind === 'workflowHandler') {
    for (const task of node.tasks) add(node, 'workflow.invoke', task.nodeId, resourceScope(task));
    for (const workflow of node.childWorkflows) add(node, 'workflow.invoke', workflow.nodeId, resourceScope(workflow));
    if (node.workflowEngine?.interface) add(node, 'connection.use', node.workflowEngine.interface, { kind: 'capability', capabilityId: node.workflowEngine.interface }, 'framework');
    return;
  }
  if (node.kind === 'aiAgent') {
    add(node, 'ai.invoke', node.inference.nodeId, resourceScope(node.inference));
    add(node, 'model.read', node.state.nodeId, resourceScope(node.state), 'framework');
    add(node, 'model.write', node.state.nodeId, resourceScope(node.state), 'framework');
    for (const operation of node.operations ?? []) add(node, 'model.write', operation.command.nodeId, resourceScope(operation.command));
    for (const query of node.queries ?? []) add(node, 'model.read', query.query.nodeId, resourceScope(query.query));
    return;
  }
  if (node.kind === 'query') {
    for (const read of node.reads) add(node, 'model.read', read.model.nodeId, resourceScope(read.model));
    if (node.search) add(node, 'search.read', node.search.index.nodeId, resourceScope(node.search.index));
    return;
  }
  if (node.kind === 'subscription') {
    add(node, 'event.subscribe', node.source.nodeId, resourceScope(node.source));
    return;
  }
  if (node.kind === 'gateway') {
    for (const query of node.queries) add(node, 'model.read', query.nodeId, resourceScope(query));
    for (const command of node.commands) add(node, 'model.write', command.command.nodeId, resourceScope(command.command));
    for (const subscription of node.subscriptions) add(node, 'event.subscribe', subscription.nodeId, resourceScope(subscription));
    if (node.cursorSecret) {
      const secretId = [
        node.cursorSecret.apiVersion,
        node.cursorSecret.kind,
        node.cursorSecret.namespace ?? '',
        node.cursorSecret.name ?? '',
      ].join('/');
      add(node, 'secret.read', secretId, { kind: 'resource', resourceId: secretId }, 'framework');
    }
    return;
  }
  if (node.kind === 'processor') {
    const selectedEventLogs = new Set(graph.providerRequirements
      .filter(({ consumer }) => consumer.nodeId === node.id)
      .filter(({ interface: providerInterface }) => providerInterface === 'EventLog')
      .flatMap(({ provider }) => provider?.nodeId ? [provider.nodeId] : []));
    const eventLogNodeId = node.eventLog?.nodeId
      ?? (selectedEventLogs.size === 1 ? [...selectedEventLogs][0] : undefined);
    if (eventLogNodeId) {
      add(node, 'event.subscribe', eventLogNodeId, { kind: 'resource', resourceId: eventLogNodeId }, 'framework');
      // Generated processors relay committed outbox events and publish terminal
      // dead letters through the same authority. This is framework access, not
      // an implicit grant to the authored handler.
      add(node, 'event.publish', eventLogNodeId, { kind: 'resource', resourceId: eventLogNodeId }, 'framework');
    } else if (selectedEventLogs.size > 1) {
      // Retain the unresolved capability in the canonical graph so every
      // target emits an actionable diagnostic instead of choosing one
      // provider by iteration order.
      add(node, 'event.subscribe', 'EventLog', { kind: 'capability', capabilityId: 'EventLog' }, 'framework');
      add(node, 'event.publish', 'EventLog', { kind: 'capability', capabilityId: 'EventLog' }, 'framework');
    }
    return;
  }
  if (node.kind === 'workflowWorker') {
    for (const handler of node.handlers) add(node, 'workflow.invoke', handler.nodeId, resourceScope(handler), 'framework');
    if (node.workflowEngine?.interface) add(node, 'connection.use', node.workflowEngine.interface, { kind: 'capability', capabilityId: node.workflowEngine.interface }, 'framework');
    return;
  }
  if (node.kind === 'operator') {
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'schedule') {
    add(node, 'schedule.admit', node.scheduler.nodeId, resourceScope(node.scheduler), 'framework');
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'lakehousePublication') {
    add(
      node,
      'event.subscribe',
      node.eventLog?.nodeId ?? node.sourceEventId,
      node.eventLog ? resourceScope(node.eventLog) : { kind: 'resource', resourceId: node.sourceEventId },
      'framework',
    );
    add(node, 'object.write', node.dataset.nodeId, resourceScope(node.dataset), 'framework');
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'actor') {
    add(node, 'connection.use', node.runtime.nodeId, resourceScope(node.runtime), 'framework');
    if (node.definition.protocol.some((member) => member.kind === 'broadcast')) {
      add(node, 'actor.broadcast', node.runtime.nodeId, resourceScope(node.runtime));
    }
    if (node.definition.protocol.some((member) => member.kind === 'connection' || member.kind === 'connectionMessage' || member.kind === 'disconnection')) {
      add(node, 'actor.connect', node.runtime.nodeId, resourceScope(node.runtime));
    }
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'server' || node.kind === 'job' || node.kind === 'streamProcessor' || node.kind === 'projection') {
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
  }
}

function accessForEdge(
  relationship: ApplicationGraph['edges'][number]['relationship'],
  target: ApplicationGraphNode,
): { readonly operation: ApplicationRuntimeAccessOperation; readonly capabilityId: string; readonly scope: ApplicationRuntimeAccessScope } | undefined {
  const scope = { kind: 'resource' as const, resourceId: target.id };
  if (relationship === 'reads' || relationship === 'queries' || relationship === 'hydrates') {
    if (target.kind === 'objectStore') return { operation: 'object.read', capabilityId: target.id, scope };
    if (target.kind === 'secret') return { operation: 'secret.read', capabilityId: target.id, scope };
    if (target.kind === 'index' || target.kind === 'projection') return { operation: 'search.read', capabilityId: target.id, scope };
    return { operation: 'model.read', capabilityId: target.id, scope };
  }
  if (relationship === 'writes') {
    if (target.kind === 'objectStore') return { operation: 'object.write', capabilityId: target.id, scope };
    if (target.kind === 'index' || target.kind === 'projection') return { operation: 'search.write', capabilityId: target.id, scope };
    return { operation: 'model.write', capabilityId: target.id, scope };
  }
  if (relationship === 'emits') return { operation: 'event.publish', capabilityId: target.id, scope };
  if (relationship === 'watches') return { operation: 'kubernetes.watch', capabilityId: target.id, scope };
  if (relationship === 'projects') return { operation: 'search.write', capabilityId: target.id, scope };
  return undefined;
}

function graphNodeProvenance(
  node: ApplicationGraphNode,
  identity: ApplicationCanonicalIdentity,
  workspaceRoot?: string,
): ApplicationSourceProvenance {
  if (!node.sourceLocation) {
    return sourceProvenance({
      origin: 'framework-generated',
      generatedBy: `application-graph:${node.kind}`,
      symbol: node.id,
      causedBy: identity.id,
    });
  }
  const location = relativeLocation(node.sourceLocation, workspaceRoot);
  return sourceProvenance({
    origin: 'authored',
    module: location.file,
    symbol: node.name,
    location,
    causedBy: identity.id,
  });
}

function relativeLocation(location: SourceLocation, workspaceRoot?: string): SourceLocation {
  const file = location.file.replaceAll('\\', '/');
  const root = workspaceRoot?.replaceAll('\\', '/').replace(/\/$/, '');
  if (root && file.startsWith(`${root}/`)) return { ...location, file: file.slice(root.length + 1) };
  if (file.startsWith('/')) throw new Error(`Application graph source ${location.file} is outside the declared workspace root.`);
  return { ...location, file: file.replace(/^\.\//, '') };
}

function nodeFor(graph: ApplicationGraph, ref: ApplicationGraphNodeRef): ApplicationGraphNode | undefined {
  return graph.nodes.find(({ id }) => id === ref.nodeId);
}

function resourceScope(ref: { readonly nodeId: string }): ApplicationRuntimeAccessScope {
  return { kind: 'resource', resourceId: ref.nodeId };
}

function executionBoundaryKind(node: ApplicationGraphNode): string {
  if (node.kind === 'commandHandler' || node.kind === 'taskHandler' || node.kind === 'workflowHandler') return 'handler';
  if (node.kind === 'streamProcessor' || node.kind === 'processor') return 'processor';
  if (node.kind === 'schedule') return 'schedule-runner';
  if (node.kind === 'lakehousePublication') return 'lakehouse-publisher';
  return node.kind;
}

function uniqueIdentities(values: readonly ApplicationCanonicalIdentity[]): readonly ApplicationCanonicalIdentity[] {
  const records = new Map<string, ApplicationCanonicalIdentity>();
  for (const value of values) {
    const previous = records.get(value.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error(`Canonical identity ${value.id} has incompatible declarations.`);
    records.set(value.id, value);
  }
  return [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueProvenance(values: readonly ApplicationSourceProvenance[]): readonly ApplicationSourceProvenance[] {
  const records = new Map(values.map((value) => [value.id, value]));
  return [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
}
