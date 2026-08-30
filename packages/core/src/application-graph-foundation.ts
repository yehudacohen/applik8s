// typecast-file-boundary: Portable graph nodes are recognized from unknown authored objects by explicit discriminants.

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
import type {
  ApplicationCallableProviderBinding,
  ApplicationGraph,
  ApplicationGraphFoundationContract,
  ApplicationGraphNode,
  ApplicationGraphNodeKind,
  ApplicationGraphNodeRef,
  ApplicationResourceRef,
} from './application-graph-contract.js';
import { applicationScheduleControlIdentity } from './application-schedule-control.js';
import type { SourceLocation } from './common.js';

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
  // A search index is both the declarative search contract and the owner of
  // its generated projection worker. Keeping the execution identity on the
  // canonical index node lets artifact credentials and provider access bind
  // to the same semantic owner instead of inventing a deployment-only node.
  'index',
  'job',
  'workloadJob',
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
  const observabilityRuntime = applicationObservabilityRuntime(graph);
  const add = (
    consumer: ApplicationGraphNode,
    operation: ApplicationRuntimeAccessOperation,
    capabilityId: string,
    scope: ApplicationRuntimeAccessScope,
    origin: ApplicationRuntimeAccessRequirement['origin'] = 'inferred',
    provenanceNode: ApplicationGraphNode = consumer,
  ): void => {
    const execution = executionIdentities.get(consumer.id);
    const provenance = provenanceByNode.get(provenanceNode.id);
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
    // Kubernetes reconcilers run in the Rust operator host rather than the
    // generated JavaScript application runtimes that receive the external
    // OTLP environment. Its independently configured Telemetry capability is
    // recorded below, but browser/Node OTLP credentials must not be projected
    // into that host implicitly.
    if (observabilityRuntime && node.kind !== 'operator') {
      add(
        node,
        'telemetry.write',
        observabilityRuntime.provider.id,
        { kind: 'capability', capabilityId: observabilityRuntime.provider.interface },
        'framework',
        observabilityRuntime.provider,
      );
      for (const secret of observabilityRuntime.secrets) {
        const identity = applicationResourceIdentity(secret.ref);
        add(node, 'secret.read', identity, {
          kind: 'resource',
          resourceId: identity,
          keys: [secret.key],
        }, 'framework', observabilityRuntime.provider);
      }
    }
    const runtimeSecrets = providerRuntimeSecretRefs(node, graph);
    for (const binding of callableProviderBindings(node)) {
      const access = binding.operation?.runtime?.access;
      if (!access || access === 'none') continue;
      for (const operation of access.operations) {
        if (operation === 'secret.read' && runtimeSecrets.length > 0) continue;
        add(
          node,
          operation,
          binding.provider.nodeId,
          resourceScope(binding.provider),
        );
      }
    }
    for (const secret of runtimeSecrets) {
      const identity = applicationResourceIdentity(secret.ref);
      add(node, 'secret.read', identity, {
        kind: 'resource',
        resourceId: identity,
        ...(secret.keys.length > 0 ? { keys: secret.keys } : {}),
      }, 'framework');
    }
    for (const requirement of graph.providerRequirements.filter(({ consumer }) => consumer.nodeId === node.id)) {
      add(node, 'connection.use', requirement.interface, {
        kind: 'capability',
        capabilityId: requirement.interface,
      }, 'framework');
    }
    addNodeSpecificRequirements(node, graph, add);
  }

  for (const permission of graph.nodes.filter((node) => node.kind === 'permission')) {
    const owner = nodeFor(graph, permission.owner);
    if (!owner || !executionIdentities.has(owner.id)) continue;
    for (const rule of permission.rules) {
      for (const access of kubernetesAccessForPermissionRule(rule, graph)) {
        add(
          owner,
          access.operation,
          access.capabilityId,
          access.scope,
          permission.mode === 'inferred' ? 'inferred' : 'explicit',
          permission,
        );
      }
    }
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

function applicationObservabilityRuntime(
  graph: ApplicationGraph,
): {
  readonly provider: Extract<ApplicationGraphNode, { readonly kind: 'provider' }>;
  readonly secrets: readonly { readonly ref: ApplicationResourceRef; readonly key: string }[];
} | undefined {
  const provider = graph.nodes.find((node): node is Extract<ApplicationGraphNode, { readonly kind: 'provider' }> =>
    node.kind === 'provider' && node.interface === 'Observability');
  if (!provider) return undefined;
  const root = plainObject(provider.config);
  const config = plainObject(root?.observability) ?? root;
  if (!config) return { provider, secrets: [] };
  const secrets: { ref: ApplicationResourceRef; key: string }[] = [];
  const authentication = plainObject(config.authentication);
  const authenticationSecret = applicationSecretRef(authentication?.secret);
  if (authenticationSecret && typeof authentication?.key === 'string' && authentication.key.length > 0) {
    secrets.push({ ref: authenticationSecret, key: authentication.key });
  }
  const tls = plainObject(config.tls);
  const certificateAuthority = applicationSecretRef(tls?.certificateAuthority);
  if (
    tls?.trust === 'custom-ca'
    && certificateAuthority
    && typeof tls.key === 'string'
    && tls.key.length > 0
  ) {
    secrets.push({ ref: certificateAuthority, key: tls.key });
  }
  return { provider, secrets };
}

function applicationSecretRef(value: unknown): ApplicationResourceRef | undefined {
  const ref = plainObject(value);
  if (
    ref?.kind !== 'Secret'
    || typeof ref.apiVersion !== 'string'
    || typeof ref.name !== 'string'
    || ref.name.length === 0
    || (ref.namespace !== undefined && typeof ref.namespace !== 'string')
  ) return undefined;
  return {
    apiVersion: ref.apiVersion,
    kind: 'Secret',
    name: ref.name,
    ...(typeof ref.namespace === 'string' ? { namespace: ref.namespace } : {}),
  };
}

function plainObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function callableProviderBindings(
  node: ApplicationGraphNode,
): readonly ApplicationCallableProviderBinding[] {
  if (node.kind === 'server') {
    return node.routes.flatMap(
      (route) => route.functionNative?.providerBindings ?? [],
    );
  }
  if (!('providerBindings' in node) || !Array.isArray(node.providerBindings)) {
    return [];
  }
  return node.providerBindings;
}

function providerRuntimeSecretRefs(
  node: ApplicationGraphNode,
  graph: ApplicationGraph,
): readonly { readonly ref: ApplicationResourceRef; readonly keys: readonly string[] }[] {
  const providerIds = new Set(callableProviderBindings(node).map(({ provider }) => provider.nodeId));
  if (providerIds.size === 0) return [];
  const requirementIds = new Set(graph.providerRequirements
    .filter(({ consumer }) => consumer.nodeId === node.id)
    .filter((requirement) => {
      const binding = graph.providerBindings.find(({ requirement: id }) => id === requirement.id);
      return providerIds.has(binding?.provider.nodeId ?? requirement.provider?.nodeId ?? '');
    })
    .map(({ id }) => id));
  const refs = graph.providerBindings
    .filter(({ requirement }) => requirementIds.has(requirement))
    .flatMap(({ runtime }) => [
      ...(runtime.secretRefs ?? []).map((ref) => ({ ref, keys: [] as readonly string[] })),
      ...Object.values(runtime.secretEnv ?? {}).map(({ secret: ref, key }) => ({ ref, keys: [key] })),
    ]);
  const unique = new Map<string, { ref: ApplicationResourceRef; keys: Set<string>; whole: boolean }>();
  for (const entry of refs) {
    const identity = applicationResourceIdentity(entry.ref);
    const current = unique.get(identity) ?? { ref: entry.ref, keys: new Set<string>(), whole: false };
    if (entry.keys.length === 0) current.whole = true;
    for (const key of entry.keys) current.keys.add(key);
    unique.set(identity, current);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => ({ ref: entry.ref, keys: entry.whole ? [] : [...entry.keys].sort() }));
}

function applicationResourceIdentity(ref: ApplicationResourceRef): string {
  return [ref.apiVersion, ref.kind, ref.namespace ?? '', ref.name ?? ''].join('/');
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
    if (node.kubernetes?.kind === 'kubernetes-list-watch') {
      const apiGroup = apiGroupForVersion(node.kubernetes.resource.apiVersion);
      const resource = node.kubernetes.resource.plural;
      const scope = node.kubernetes.resource.scope;
      for (const [operation, verb] of [
        ['kubernetes.get', 'get'],
        ['kubernetes.list', 'list'],
        ['kubernetes.watch', 'watch'],
      ] as const) {
        add(node, operation, `kubernetes:${apiGroup}:${resource}`, {
          kind: 'kubernetes',
          apiGroup,
          resource,
          scope,
          verbs: [verb],
        });
      }
    }
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
      add(node, 'secret.read', secretId, { kind: 'resource', resourceId: secretId, keys: [node.cursorSecret.key] }, 'framework');
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
    add(node, 'checkpoint.use', 'framework.processor-checkpoints', {
      kind: 'resource',
      resourceId: 'framework.processor-checkpoints',
    }, 'framework');
    return;
  }
  if (node.kind === 'workflowWorker') {
    for (const handler of node.handlers) add(node, 'workflow.invoke', handler.nodeId, resourceScope(handler), 'framework');
    if (node.workflowEngine?.interface) add(node, 'connection.use', node.workflowEngine.interface, { kind: 'capability', capabilityId: node.workflowEngine.interface }, 'framework');
    return;
  }
  if (node.kind === 'operator') {
    for (const contract of node.watchContracts ?? []) {
      for (const rule of contract.permissions) {
        for (const access of kubernetesAccessForPermissionRule(rule, graph)) {
          add(node, access.operation, access.capabilityId, access.scope, 'framework');
        }
      }
    }
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'schedule') {
    add(node, 'schedule.admit', node.scheduler.nodeId, resourceScope(node.scheduler), 'framework');
    add(node, 'connection.use', node.state.nodeId, resourceScope(node.state), 'framework');
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
    add(node, 'checkpoint.use', 'framework.processor-checkpoints', {
      kind: 'resource',
      resourceId: 'framework.processor-checkpoints',
    }, 'framework');
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
  if (node.kind === 'streamProcessor') {
    const scheduleControl = applicationScheduleControlIdentity(graph.metadata.name);
    for (const binding of node.applicationScheduleBindings ?? []) {
      add(node, 'schedule.configure', binding.scheduler.nodeId, resourceScope(binding.schedule));
      add(node, 'schedule.unschedule', binding.scheduler.nodeId, resourceScope(binding.schedule));
      add(node, 'schedule.invoke', binding.scheduler.nodeId, resourceScope(binding.schedule));
    }
    if ((node.applicationScheduleBindings?.length ?? 0) > 0) {
      add(node, 'network.connect', scheduleControl.capabilityId, {
        kind: 'resource',
        resourceId: scheduleControl.nodeId,
      }, 'framework');
    }
    add(node, 'telemetry.write', 'Telemetry', { kind: 'capability', capabilityId: 'Telemetry' }, 'framework');
    return;
  }
  if (node.kind === 'server' || node.kind === 'job' || node.kind === 'workloadJob' || node.kind === 'projection') {
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
    if (target.kind === 'secret') return {
      operation: 'secret.read',
      capabilityId: target.id,
      scope: { ...scope, keys: [target.key] },
    };
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

function kubernetesAccessForPermissionRule(
  rule: import('./resource.js').PermissionRule,
  graph: ApplicationGraph,
): readonly {
  readonly operation: ApplicationRuntimeAccessOperation;
  readonly capabilityId: string;
  readonly scope: ApplicationRuntimeAccessScope;
}[] {
  const accesses: {
    operation: ApplicationRuntimeAccessOperation;
    capabilityId: string;
    scope: ApplicationRuntimeAccessScope;
  }[] = [];
  for (const apiGroup of rule.apiGroups) {
    for (const resource of rule.resources) {
      const [plural, subresource] = resource.split('/', 2);
      const declared = graph.nodes.find((node): node is Extract<ApplicationGraphNode, { readonly kind: 'crd' }> => node.kind === 'crd'
        && apiGroupForVersion(node.resource.apiVersion) === apiGroup
        && node.resource.plural === plural);
      const scope = rule.namespaces === 'all'
        ? { kind: 'namespace' as const, namespace: '*', resourceKinds: [resource] }
        : {
            kind: 'kubernetes' as const,
            apiGroup,
            resource,
            // Legacy raw PermissionRule values predate explicit scope metadata and
            // historically lowered to namespace-local RBAC. Preserve that least-
            // privilege default; cluster-scoped typed resources now carry their
            // scope explicitly and therefore never depend on this fallback.
            scope: rule.scope ?? declared?.resource.scope ?? 'Namespaced' as const,
            ...(Array.isArray(rule.namespaces) ? { namespaces: [...rule.namespaces].sort() } : {}),
            ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames].sort() } : {}),
          };
      for (const [operation, operationVerbs] of kubernetesOperationsForVerbs(rule.verbs, subresource)) {
        accesses.push({
          operation,
          capabilityId: `kubernetes:${apiGroup}:${resource}`,
          scope: scope.kind === 'kubernetes'
            ? { ...scope, verbs: operationVerbs }
            : scope,
        });
      }
    }
  }
  return accesses;
}

function kubernetesOperationsForVerbs(
  verbs: readonly string[],
  subresource: string | undefined,
): readonly (readonly [ApplicationRuntimeAccessOperation, readonly string[]])[] {
  const operations = new Map<ApplicationRuntimeAccessOperation, Set<string>>();
  for (const verb of verbs) {
    let operation: ApplicationRuntimeAccessOperation | undefined;
    if (verb === 'get') operation = 'kubernetes.get';
    else if (verb === 'list') operation = 'kubernetes.list';
    else if (verb === 'watch') operation = 'kubernetes.watch';
    else if (verb === 'create') operation = 'kubernetes.create';
    else if (verb === 'delete' || verb === 'deletecollection') operation = 'kubernetes.delete';
    else if (verb === 'patch' || verb === 'update') {
      operation = subresource === 'status'
        ? 'kubernetes.status'
        : subresource === 'finalizers'
          ? 'kubernetes.finalize'
          : 'kubernetes.patch';
    }
    if (!operation) continue;
    const values = operations.get(operation) ?? new Set<string>();
    values.add(verb);
    operations.set(operation, values);
  }
  return [...operations.entries()]
    .map(([operation, values]) => [operation, [...values].sort()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

function apiGroupForVersion(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
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
