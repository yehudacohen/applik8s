// typecast-file-boundary: provider callback metadata is decoded from the
// validated ApplicationGraph before constructing one compiler-owned gateway.
import {
  type ApplicationGatewayNode,
  type ApplicationGraph,
  type ApplicationGraphEdge,
  type ApplicationLakehousePublicationNode,
  type ApplicationProfiledCallbackContract,
  type ApplicationProviderNode,
  type ApplicationScheduleNode,
  type ApplicationSerializedCallbackContract,
  applicationOperationId,
  normalizeApplicationGraph,
} from '@applik8s/core';

const generatedGatewayImage =
  'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface ApplicationEntrypointPublicSurface {
  readonly operationIds: readonly string[];
  readonly modelNames: readonly string[];
  readonly signalIds?: readonly string[];
  readonly schedules?: readonly ApplicationScheduleNode[];
  readonly lakehousePublications?: readonly ApplicationLakehousePublicationNode[];
  /** Exported actor definitions are the only actor protocols publishable to browsers. */
  readonly actorIds?: readonly string[];
}

/**
 * Makes the application entrypoint's named exports the browser/server
 * publication boundary.
 *
 * A model export publishes its authorized operation family. A direct
 * operation export publishes only that operation. A public authored gateway
 * remains authoritative; compiler-owned internal receivers do not suppress
 * the registry-free browser gateway.
 */
export function applicationGraphWithEntrypointPublicSurface(
  graph: ApplicationGraph,
  surface: ApplicationEntrypointPublicSurface,
): ApplicationGraph {
  const graphWithSchedules = applicationGraphWithEntrypointSchedules(
    graph,
    surface.schedules ?? [],
  );
  const graphWithPublications = applicationGraphWithEntrypointLakehousePublications(
    graphWithSchedules,
    surface.lakehousePublications ?? [],
  );
  const exportedOperations = new Set(surface.operationIds);
  const exportedActorIds = new Set(surface.actorIds ?? []);
  const graphWithPublishedHttp = publishExportedHttpRoutes(
    graphWithPublications,
    exportedOperations,
  );
  const graphWithPublishedActors = publishExportedActors(
    graphWithPublishedHttp,
    exportedActorIds,
  );
  const gateways = graphWithPublishedActors.nodes.filter(
    (node): node is ApplicationGatewayNode => node.kind === 'gateway',
  );
  const exportedSignals = new Set(surface.signalIds ?? []);
  const exportedSignalStreams = new Set(
    graphWithPublishedActors.nodes.flatMap((node) =>
      node.kind === 'stream'
      && node.signal
      && exportedSignals.has(node.signal.id)
        ? [node.id]
        : []),
  );
  const assignedSubscriptions = new Set(
    gateways.flatMap((gateway) =>
      gateway.subscriptions.map((reference) => reference.nodeId)),
  );
  const subscriptions = graphWithPublishedActors.nodes.flatMap((node) =>
    node.kind === 'subscription'
    && exportedSignalStreams.has(node.source.nodeId)
    && !assignedSubscriptions.has(node.id)
      ? [{ nodeId: node.id }]
      : []);
  // A public authored gateway is an explicit transport and authority
  // boundary. Its routing remains authoritative even when the same module
  // exports model handles for server-side use. Internal compiler receivers
  // still coexist with the registry-free browser path. Exported signal
  // capabilities are different: the entrypoint export is the explicit
  // publication decision, so subscriptions declared after the authored
  // gateway are attached to that same boundary.
  const publicGateways = gateways.filter(
    (gateway) => gateway.visibility === 'public',
  );
  if (publicGateways.length > 0) {
    if (subscriptions.length === 0) {
      return graphWithPublishedActors;
    }
    if (publicGateways.length !== 1) {
      throw new Error(
        `Application ${graph.metadata.name} exports browser signals but has ${publicGateways.length} public gateways; the signal publication boundary is ambiguous.`,
      );
    }
    const publicGateway = publicGateways[0];
    if (!publicGateway) {
      throw new Error(
        `Application ${graph.metadata.name} lost its public gateway during signal publication.`,
      );
    }
    const publishedGateway = {
      ...publicGateway,
      subscriptions: [...publicGateway.subscriptions, ...subscriptions],
    };
    return normalizeApplicationGraph({
      ...graphWithPublishedActors,
      nodes: graphWithPublishedActors.nodes.map((node) =>
        node.id === publicGateway.id ? publishedGateway : node),
      edges: [
        ...graphWithPublishedActors.edges,
        ...gatewayEdges(publicGateway.id, [], [], subscriptions),
      ],
    });
  }
  const exportedModels = new Set(surface.modelNames);
  const nodes = new Map(graphWithPublishedActors.nodes.map((node) => [node.id, node]));

  for (const node of graphWithPublishedActors.nodes) {
    if (
      node.kind !== 'model'
      || !exportedModels.has(node.name)
    ) {
      continue;
    }
    for (const operation of node.common?.operations ?? []) {
      if (
        operation.authorization !== 'undeclared'
        && operation.authority?.classification !== 'unclassified'
        && operation.authority !== undefined
        && operation.transport === 'command'
      ) {
        exportedOperations.add(operation.publicId);
      }
    }
  }

  const selectedQueries = graphWithPublishedActors.nodes.filter(
    (node) =>
      node.kind === 'query'
      && (
        exportedOperations.has(node.publicId ?? `${node.name}.${node.version}`)
        || (
          node.modelOperation !== undefined
          && exportedModels.has(modelName(nodes, node.modelOperation.model.nodeId))
        )
      ),
  );
  const selectedCommands = graphWithPublishedActors.nodes.flatMap((node) => {
    if (
      node.kind !== 'command'
      || !exportedOperations.has(node.name)
    ) {
      return [];
    }
    const handler = graphWithPublishedActors.nodes.find(
      (candidate) =>
        candidate.kind === 'commandHandler'
        && candidate.command.nodeId === node.id,
    );
    if (handler?.kind !== 'commandHandler') {
      throw new Error(
        `Exported application command ${node.name} has no canonical command handler.`,
      );
    }
    return [{ command: { nodeId: node.id }, handler: { nodeId: handler.id } }];
  });

  const assignedQueries = new Set(
    gateways.flatMap((gateway) =>
      gateway.queries.map((reference) => reference.nodeId)),
  );
  const assignedCommands = new Set(
    gateways.flatMap((gateway) =>
      gateway.commands.map((reference) => reference.command.nodeId)),
  );
  const queries = selectedQueries
    .filter((query) => !assignedQueries.has(query.id))
    .map((query) => ({ nodeId: query.id }));
  const commands = selectedCommands.filter(
    (command) => !assignedCommands.has(command.command.nodeId),
  );
  if (queries.length + commands.length + subscriptions.length === 0) {
    return graphWithPublishedActors;
  }

  const gateway = generatedEntrypointGateway(
    graphWithPublishedActors,
    queries,
    commands,
    subscriptions,
  );
  return normalizeApplicationGraph({
    ...graphWithPublishedActors,
    nodes: [...graphWithPublishedActors.nodes, gateway],
    edges: [
      ...graphWithPublishedActors.edges,
      ...gatewayEdges(gateway.id, queries, commands, subscriptions),
    ],
  });
}

function publishExportedActors(
  graph: ApplicationGraph,
  actorIds: ReadonlySet<string>,
): ApplicationGraph {
  if (actorIds.size === 0) return graph;
  const available = new Set(
    graph.nodes.flatMap((node) => node.kind === 'actor' ? [node.definition.id] : []),
  );
  for (const actorId of actorIds) {
    if (!available.has(actorId)) {
      throw new Error(`Entrypoint exports actor ${actorId}, but the selected application graph does not contain it.`);
    }
  }
  const nodes = graph.nodes.map((node) => node.kind === 'actor' && actorIds.has(node.definition.id)
    ? { ...node, publication: { boundary: 'entrypoint-export' as const } }
    : node);
  return normalizeApplicationGraph({ ...graph, nodes });
}

function applicationGraphWithEntrypointLakehousePublications(
  graph: ApplicationGraph,
  publications: readonly ApplicationLakehousePublicationNode[],
): ApplicationGraph {
  if (publications.length === 0) return graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const requirementIds = new Set(graph.providerRequirements.map(({ id }) => id));
  const providerRequirements = [...graph.providerRequirements];
  const providerBindings = [...graph.providerBindings];
  const edges = [...graph.edges];
  const eventLogs = [...nodes.values()].filter(
    (node): node is Extract<ApplicationGraph['nodes'][number], { kind: 'provider' }> =>
      node.kind === 'provider'
      && node.interface === 'EventLog'
      && !node.config?.qualification,
  );
  if (eventLogs.length > 1) {
    throw new Error(`Lakehouse publications require exactly one application EventLog provider; found ${eventLogs.length}.`);
  }
  const eventLog = eventLogs[0] ?? defaultTargetSelectedEventLog();
  nodes.set(eventLog.id, eventLog);
  for (const publication of [...publications].sort((left, right) => left.id.localeCompare(right.id))) {
    const existing = nodes.get(publication.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(publication)) {
      throw new Error(`Entrypoint lakehouse publication ${publication.name} conflicts with application graph node ${publication.id}.`);
    }
    const provider = nodes.get(publication.dataset.nodeId);
    if (provider?.kind !== 'provider' || provider.interface !== 'LakehouseDataset') {
      throw new Error(`Lakehouse publication ${publication.name} requires provided qualified dataset ${publication.dataset.nodeId}.`);
    }
    const boundPublication = {
      ...publication,
      eventLog: { interface: 'EventLog' as const, nodeId: eventLog.id },
    };
    nodes.set(publication.id, boundPublication);
    const requirementId = `requirement.${publication.id}.dataset`;
    if (requirementIds.has(requirementId)) continue;
    requirementIds.add(requirementId);
    providerRequirements.push({
      id: requirementId,
      interface: 'LakehouseDataset',
      consumer: { nodeId: publication.id },
      provider: publication.dataset,
      required: true,
      purpose: 'lakehouseDataset',
      diagnostics: {
        missing: `Lakehouse publication ${publication.name} requires its qualified LakehouseDataset provider.`,
        ambiguous: `Lakehouse publication ${publication.name} must bind exactly one qualified LakehouseDataset provider.`,
      },
    });
    providerBindings.push({ requirement: requirementId, provider: publication.dataset, generatedResources: [], runtime: {} });
    edges.push({ from: { nodeId: publication.id }, to: { nodeId: publication.dataset.nodeId }, relationship: 'dependsOn' });
    const eventLogRequirementId = `requirement.${publication.id}.event-log`;
    if (!requirementIds.has(eventLogRequirementId)) {
      requirementIds.add(eventLogRequirementId);
      providerRequirements.push({
        id: eventLogRequirementId,
        interface: 'EventLog',
        consumer: { nodeId: publication.id },
        provider: boundPublication.eventLog,
        required: true,
        purpose: 'eventSubscription',
        diagnostics: {
          missing: `Lakehouse publication ${publication.name} requires the application EventLog provider.`,
          ambiguous: `Lakehouse publication ${publication.name} must bind exactly one EventLog provider.`,
        },
      });
      providerBindings.push({ requirement: eventLogRequirementId, provider: boundPublication.eventLog, generatedResources: [], runtime: {} });
      edges.push({ from: { nodeId: publication.id }, to: { nodeId: eventLog.id }, relationship: 'dependsOn' });
    }
  }
  return normalizeApplicationGraph({ ...graph, nodes: [...nodes.values()], edges, providerRequirements, providerBindings });
}

function defaultTargetSelectedEventLog(): ApplicationProviderNode<'EventLog'> {
  return {
    id: 'provider.event-log',
    kind: 'provider',
    name: 'EventLog',
    stability: 'stable',
    interface: 'EventLog',
    implementation: 'target-selected',
    contract: {
      apiVersion: 'applik8s.provider/v1alpha1',
      interface: 'EventLog',
      version: 'v1alpha1',
      requirements: [],
      guarantees: ['atLeastOnce', 'stableMessageIds', 'replay'],
      implementation: { name: 'target-selected' },
      surface: 'stablePublicApi',
      support: 'externalAuthority',
      diagnostics: [],
    },
    config: { selection: 'deployment-target' },
  };
}

function applicationGraphWithEntrypointSchedules(
  graph: ApplicationGraph,
  schedules: readonly ApplicationScheduleNode[],
): ApplicationGraph {
  if (schedules.length === 0) return graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const requirementIds = new Set(graph.providerRequirements.map((requirement) => requirement.id));
  const providerRequirements = [...graph.providerRequirements];
  const providerBindings = [...graph.providerBindings];
  const edges = [...graph.edges];
  for (const schedule of [...schedules].sort((left, right) => left.id.localeCompare(right.id))) {
    const existing = nodes.get(schedule.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(schedule)) {
      throw new Error(`Entrypoint schedule ${schedule.definition.id} conflicts with application graph node ${schedule.id}.`);
    }
    nodes.set(schedule.id, schedule);
    const provider = nodes.get(schedule.scheduler.nodeId);
    if (!provider) {
      if (schedule.scheduler.nodeId !== 'provider.scheduler') {
        throw new Error(
          `Entrypoint schedule ${schedule.definition.id} uses qualified Scheduler ${schedule.scheduler.nodeId}, but the application did not provide that qualification.`,
        );
      }
      nodes.set(schedule.scheduler.nodeId, {
        id: schedule.scheduler.nodeId,
        kind: 'provider',
        name: 'Scheduler',
        stability: 'stable',
        interface: 'Scheduler',
        implementation: 'target-selected',
        contract: {
          apiVersion: 'applik8s.provider/v1alpha1',
          interface: 'Scheduler',
          version: 'v1alpha1',
          requirements: ['idempotentOccurrenceAdmission', 'revisionedDesiredState', 'boundedMisfires'],
          guarantees: ['stableDefinitionIdentity', 'stableOccurrenceIdentity', 'overlapPolicy', 'causalPropagation'],
          implementation: { name: 'target-selected' },
          surface: 'stablePublicApi',
          support: 'externalAuthority',
          diagnostics: [],
        },
        config: { selection: 'deployment-target' },
      });
    } else if (provider.kind !== 'provider' || provider.interface !== 'Scheduler') {
      throw new Error(`Entrypoint schedule ${schedule.definition.id} requires Scheduler provider ${schedule.scheduler.nodeId}.`);
    }
    for (const binding of schedule.providerBindings ?? []) {
      const callableProvider = nodes.get(binding.provider.nodeId);
      if (
        callableProvider?.kind !== 'provider'
        || callableProvider.interface !== binding.provider.interface
      ) {
        throw new Error(
          `Entrypoint schedule ${schedule.definition.id} references missing callable provider ${binding.provider.nodeId}.`,
        );
      }
      if (!edges.some(
        (edge) =>
          edge.from.nodeId === callableProvider.id
          && edge.to.nodeId === schedule.id
          && edge.relationship === 'provides',
      )) {
        edges.push({
          from: { nodeId: callableProvider.id },
          to: { nodeId: schedule.id },
          relationship: 'provides',
        });
      }
    }
    const requirementId = `requirement.${schedule.id}.scheduler`;
    if (!requirementIds.has(requirementId)) {
      requirementIds.add(requirementId);
      providerRequirements.push({
        id: requirementId,
        interface: 'Scheduler',
        consumer: { nodeId: schedule.id },
        provider: schedule.scheduler,
        required: true,
        purpose: 'scheduler',
        diagnostics: {
          missing: `Schedule ${schedule.definition.id} requires a Scheduler provider.`,
          ambiguous: `Schedule ${schedule.definition.id} has multiple Scheduler providers; bind exactly one.`,
        },
      });
      providerBindings.push({
        requirement: requirementId,
        provider: schedule.scheduler,
        generatedResources: [],
        runtime: {},
      });
      edges.push({
        from: { nodeId: schedule.id },
        to: { nodeId: schedule.scheduler.nodeId },
        relationship: 'dependsOn',
      });
    }
  }
  return normalizeApplicationGraph({
    ...graph,
    nodes: [...nodes.values()],
    edges,
    providerRequirements,
    providerBindings,
  });
}

function publishExportedHttpRoutes(
  graph: ApplicationGraph,
  exportedOperations: ReadonlySet<string>,
): ApplicationGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.kind !== 'server') return node;
    let serverChanged = false;
    const routes = node.routes.map((route) => {
      if (!route.functionNative) return route;
      const operationId = applicationOperationId({
        domain: 'http',
        owner: node.name,
        operation: route.id,
      });
      if (!exportedOperations.has(operationId)) return route;
      serverChanged = true;
      return {
        ...route,
        functionNative: {
          ...route.functionNative,
          publication: {
            boundary: 'entrypoint-export' as const,
          },
        },
      };
    });
    if (!serverChanged) return node;
    changed = true;
    return { ...node, routes };
  });
  return changed ? normalizeApplicationGraph({ ...graph, nodes }) : graph;
}

function generatedEntrypointGateway(
  graph: ApplicationGraph,
  queries: ApplicationGatewayNode['queries'],
  commands: ApplicationGatewayNode['commands'],
  subscriptions: ApplicationGatewayNode['subscriptions'],
): ApplicationGatewayNode {
  const identity = graph.nodes.filter(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === 'IdentityProvider'
      && !record(node.config).qualification,
  );
  if (identity.length !== 1) {
    throw new Error(
      `Application ${graph.metadata.name} exports browser operations and requires exactly one unqualified IdentityProvider; found ${identity.length}.`,
    );
  }
  const identityConfig = record(record(identity[0]?.config).identity);
  const authenticationProfile = profiledCallback(
    identityConfig.authenticationProfile,
    'authentication',
  );
  const authentication = serializedCallback(
    identityConfig,
    'authentication',
  );
  if (!authenticationProfile && !authentication) {
    throw new Error(
      `Application ${graph.metadata.name} exports browser operations, but its IdentityProvider has no portable authentication callback.`,
    );
  }
  const name = graph.nodes.some(
    (node) => node.kind === 'gateway' && node.name === 'web',
  )
    ? 'browser-exports'
    : 'web';
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const applicationHostOwnsSurface =
    graph.nodes.some(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'ApplicationHost',
    )
    && commands.length === 0
    && subscriptions.length === 0
    && queries.every((reference) => {
      const node = nodes.get(reference.nodeId);
      return node?.kind === 'query' && node.kubernetes !== undefined;
    });
  return {
    id: `gateway.${name}`,
    kind: 'gateway',
    name,
    stability: 'stable',
    visibility: 'public',
    queries,
    commands,
    subscriptions,
    transport: 'http-sse',
    authentication: 'external-provider',
    trustedContextAdmission: 'server-validated',
    browserCredentials: 'forbidden',
    subscriptionLimits: { perPrincipal: 20, total: 1_000 },
    routes: {
      snapshots: '/queries/:query/snapshot',
      subscriptions: '/queries/:query/subscribe',
      streamReplay: '/streams/:subscription/replay',
      streamSubscriptions: '/streams/:subscription/subscribe',
      commandSubmission: '/commands/:command/submit',
      commandProgress: '/commands/:command/progress',
    },
    resume: 'resumableInvalidation',
    // The Start server already materializes Kubernetes-native model reads and
    // creates through its generated Fetch gateway. Keep the compiler-owned
    // publication node as routing/authority metadata, but do not emit a
    // second Deployment with the ApplicationHost's Kubernetes identity.
    // Relational queries, durable commands, and subscriptions still require
    // their independently scaled generated gateway.
    materialization: applicationHostOwnsSurface
      ? 'runtimeOnly'
      : 'generatedDeployment',
    ...(authenticationProfile
      ? { authenticationProfile }
      : authentication
        ? callbackFields(authentication, 'authentication')
        : {}),
    commandAuthorizationSource: 'async () => true',
    cursorSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: `${graph.metadata.name}-web-cursor`,
      key: 'key',
    },
    deployment: {
      namespace:
        graph.metadata.namespace ?? `${graph.metadata.name}-system`,
      image: generatedGatewayImage,
      replicas: 1,
      port: 8080,
    },
  };
}

function gatewayEdges(
  gateway: string,
  queries: ApplicationGatewayNode['queries'],
  commands: ApplicationGatewayNode['commands'],
  subscriptions: ApplicationGatewayNode['subscriptions'],
): readonly ApplicationGraphEdge[] {
  return [
    ...queries.map((query) => ({
      from: { nodeId: gateway },
      to: query,
      relationship: 'exposes' as const,
    })),
    ...commands.map((command) => ({
      from: { nodeId: gateway },
      to: command.command,
      relationship: 'exposes' as const,
    })),
    ...subscriptions.map((subscription) => ({
      from: { nodeId: gateway },
      to: subscription,
      relationship: 'exposes' as const,
    })),
  ];
}

function modelName(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  nodeId: string,
): string {
  const node = nodes.get(nodeId);
  return node?.kind === 'model' || node?.kind === 'crd' ? node.name : '';
}

function profiledCallback(
  value: unknown,
  prefix: string,
): ApplicationProfiledCallbackContract | undefined {
  const source = record(value);
  const selector = source.selector;
  const cases = record(source.cases);
  const fallback = serializedCallback(record(source.default), prefix);
  if (
    typeof selector !== 'string'
    || !fallback
    || Object.keys(cases).length === 0
  ) {
    return undefined;
  }
  const decoded = Object.fromEntries(
    Object.entries(cases).map(([variant, candidate]) => {
      const callback = serializedCallback(record(candidate), prefix);
      if (!callback) {
        throw new Error(
          `Identity profile ${variant} has no portable ${prefix} callback.`,
        );
      }
      return [variant, callback];
    }),
  );
  return { selector, cases: decoded, default: fallback };
}

function serializedCallback(
  value: Readonly<Record<string, unknown>>,
  prefix: string,
): ApplicationSerializedCallbackContract | undefined {
  const source = value[`${prefix}Source`];
  if (typeof source !== 'string' || !source.trim()) return undefined;
  const dependencies = value[`${prefix}Dependencies`];
  const location = value[`${prefix}Location`];
  const unresolved = value[`${prefix}Unresolved`];
  return {
    source,
    ...(dependencies && typeof dependencies === 'object'
      ? {
          dependencies:
            dependencies as NonNullable<
              ApplicationSerializedCallbackContract['dependencies']
            >,
        }
      : {}),
    ...(location && typeof location === 'object'
      ? {
          location:
            location as NonNullable<
              ApplicationSerializedCallbackContract['location']
            >,
        }
      : {}),
    ...(Array.isArray(unresolved)
      ? {
          unresolved: unresolved.filter(
            (entry): entry is string => typeof entry === 'string',
          ),
        }
      : {}),
  };
}

function callbackFields(
  callback: ApplicationSerializedCallbackContract,
  prefix: 'authentication',
): Pick<
  ApplicationGatewayNode,
  | 'authenticationSource'
  | 'authenticationDependencies'
  | 'authenticationLocation'
  | 'authenticationUnresolved'
> {
  return {
    authenticationSource: callback.source,
    ...(callback.dependencies
      ? { authenticationDependencies: callback.dependencies }
      : {}),
    ...(callback.location
      ? { authenticationLocation: callback.location }
      : {}),
    ...(callback.unresolved
      ? { authenticationUnresolved: callback.unresolved }
      : {}),
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
