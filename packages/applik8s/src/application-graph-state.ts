import type { ApplicationCompatibilityLabel, ApplicationDiagnosticContract, ApplicationGraph, ApplicationGraphEdge, ApplicationGraphNode, ApplicationProviderBindingContract, ApplicationProviderInterfaceKind, ApplicationProviderRequirement } from '@applik8s/core';
import { normalizeApplicationGraph } from '@applik8s/core';

export interface ApplicationGraphState {
  readonly graphNodes: ApplicationGraphNode[];
  readonly graphEdges: ApplicationGraphEdge[];
  readonly providerRequirements: ApplicationProviderRequirement[];
  readonly providerBindings: ApplicationProviderBindingContract[];
  readonly onChange?: () => void;
}

export function applicationGraphFromState(name: string, state: ApplicationGraphState): ApplicationGraph {
  const edges = dedupeApplicationGraphEdges(state.graphEdges);
  const requirements = dedupeApplicationProviderRequirements(
    state.providerRequirements,
  );
  const bindings = dedupeApplicationProviderBindings(state.providerBindings);
  return normalizeApplicationGraph({
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name },
    nodes: pruneUnusedFrameworkDefaults(
      dedupeApplicationGraphNodes(state.graphNodes),
      edges,
      requirements,
      bindings,
    ),
    edges,
    providerRequirements: requirements,
    providerBindings: bindings,
    compatibility: {
      stablePublicApis: ['sdk.kubernetesComposition', 'app.installation', 'app.server', 'app.http', 'app.crd', 'app.resource', 'app.model', 'Resource.on.reconcile', 'app.database.postgres', 'app.objectStore', 'app.workload.job', 'app.workload.cronJob', 'app.defaults', 'app.provide', 'app.profile', 'app.inject', 'Provider.named', 'app.select', 'app.selectProvider', 'app.when', 'app.any', 'app.all', 'app.interpolate', 'app.aggregate', 'app.config', 'app.secret', 'app.expose', 'app.query', 'app.gateway', 'app.stream', 'app.subscription', 'app.projection', 'app.agent', 'app.mcp', 'app.mcp.client', 'Stream.process', 'Stream.project', 'Stream.subscribe', 'Resource.index', 'Resource.increment', 'command', 'event', 'stream', 'workflow', 'Model.create', 'Model.update', 'Model.delete', 'Model.require', 'Model.edit', 'Model.managed', 'Model.on.reconcile', 'Model.on.finalize', 'Model.on.create', 'Model.on.update', 'Model.on.delete', 'app.workflow', 'provider.TransactionalDatabase', 'provider.AnalyticalDatabase', 'provider.ManagedModelStore', 'provider.OperatorRuntime', 'provider.IndexStore', 'provider.CounterStore', 'provider.EventSource', 'provider.EventLog', 'provider.Secret', 'provider.Queue', 'provider.ObjectStorage', 'provider.HttpExposure', 'provider.Certificate', 'provider.DnsPublication', 'provider.CredentialStore', 'provider.WorkflowEngine', 'provider.Authorization', 'provider.StructuredGeneration', 'provider.AI'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['app.graph', 'app.job', 'app.transaction.saga', 'ML.model', 'provider.JobRuntime', 'provider.MLModel'],
      postV3Surfaces: ['workload-movement-operator', 'additional-provider-adapters'],
      labels: [
        stableApiLabel('sdk.kubernetesComposition', 'v0.2', 'Canonical TypeKro-backed app composition entrypoint.'),
        stableApiLabel('app.installation', 'v0.7', 'Typed installable Application CRD contract shared by generated manifests, operators, and application code.'),
        stableApiLabel('app.server', 'v0.2', 'Generated app-server workload entrypoint with inferred resources and RBAC.'),
        stableApiLabel('app.http', 'v0.7', 'Typed function-native HTTP registrar with schema, authority, authenticated principal, and context-scoped idempotency boundaries.'),
        stableApiLabel('app.crd', 'v0.2', 'Schema-first Kubernetes CRD materialization entrypoint.'),
        stableApiLabel('app.resource', 'v0.3', 'Golden-path Kubernetes control-plane resource declaration that materializes as an app-owned CRD.'),
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Substrate-freeze app IR before lowering.', implementation: 'implemented' },
        stableApiLabel('app.model', 'v0.3', 'Schema-first storage-backed model materialization entrypoint.'),
        stableApiLabel('Resource.on.reconcile', 'v0.7', 'Resource-native reconcile handler entrypoint backed by an inferred generated operator install.'),
        stableApiLabel('app.database.postgres', 'v0.7', 'Canonical native relational authority binding backed by PostgreSQL/CNPG.'),
        stableApiLabel('app.objectStore', 'v0.7', 'Provider-neutral bounded object store declaration with server-only credentials, integrity metadata, and optional signed browser intents.'),
        stableApiLabel('app.workload.job', 'v0.9', 'Explicit low-level Kubernetes Job workload with diagnostics and status metadata.'),
        stableApiLabel('app.workload.cronJob', 'v0.9', 'Explicit low-level Kubernetes CronJob workload with diagnostics and status metadata.'),
        stableApiLabel('app.defaults', 'v0.3', 'App-scoped provider default binding boundary.'),
        stableApiLabel('app.provide', 'v0.3', 'Typed app-scoped provider binding boundary.'),
        stableApiLabel('app.profile', 'v0.7', 'Schema-derived exhaustive installation profiles with graph-visible inactive branches and fail-closed transition policy.'),
        stableApiLabel('app.inject', 'v0.7', 'Typed capture boundary for one exhaustively provided qualified capability.'),
        stableApiLabel('Provider.named', 'v0.7', 'Branded semantic provider qualification by capability, compatibility revision, and stable role name.'),
        stableApiLabel('app.select', 'v0.7', 'Typed installation-discriminated scalar selection lowered to portable KRO CEL.'),
        stableApiLabel('app.selectProvider', 'v0.7', 'Deployment-bound provider selection resolved only after concrete installation validation.'),
        stableApiLabel('app.when', 'v0.7', 'Typed conditional scalar selection without authored CEL.'),
        stableApiLabel('app.any', 'v0.7', 'Typed disjunction of installation conditions without authored CEL.'),
        stableApiLabel('app.all', 'v0.7', 'Typed conjunction of installation conditions without authored CEL.'),
        stableApiLabel('app.interpolate', 'v0.7', 'Typed string composition over installation values without authored CEL.'),
        stableApiLabel('app.aggregate', 'v0.2', 'Generated aggregate worker entrypoint for resource event streams.'),
        stableApiLabel('app.config', 'v0.3', 'App-scoped ConfigMap-backed configuration binding API with explicit env/file metadata.'),
        stableApiLabel('app.secret', 'v0.3', 'App-scoped Secret-backed binding API with explicit redaction metadata.'),
        stableApiLabel('app.expose', 'v0.3', 'App-scoped conditional HTTP exposure through explicit Ingress or NodePort providers, with managed TLS and DNS intent.'),
        stableApiLabel('Resource.index', 'v0.2', 'Cache-backed resource read-model declaration.'),
        stableApiLabel('Resource.increment', 'v0.2', 'Buffered counter operation for generated server/runtime scopes.'),
        stableApiLabel('provider.IndexStore', 'v0.3', 'Typed index storage capability contract backed by the Valkey provider slice.'),
        stableApiLabel('provider.CounterStore', 'v0.3', 'Defaults to bounded Kubernetes-resource counters with buffered writes.'),
        stableApiLabel('provider.EventSource', 'v0.3', 'Defaults to bounded Kubernetes watch streams.'),
        stableApiLabel('provider.Secret', 'v0.3', 'Defaults to Kubernetes Secret references with explicit object ownership.'),
        stableApiLabel('provider.Queue', 'v0.3', 'Defaults to a bounded resourceVersion-safe ConfigMap queue contract.'),
        stableApiLabel('provider.ObjectStorage', 'v0.3', 'Defaults to bounded ConfigMap-backed objects with an explicit 512 KiB object ceiling.'),
        stableApiLabel('provider.HttpExposure', 'v0.3', 'Typed HTTP exposure capability contract backed by explicit Ingress and NodePort providers.'),
        stableApiLabel('provider.CredentialStore', 'v0.3', 'Defaults to Kubernetes SecretRef credentials with external object ownership.'),
        { name: 'app.graph', surface: 'experimentalSurface', since: 'v0.3', rationale: 'Direct graph introspection remains experimental while the serialized ApplicationGraph artifact is the documented contract.', implementation: 'failClosedReserved' },
        { name: 'app.job', surface: 'experimentalSurface', since: 'v0.9', rationale: 'Function-native finite managed work is available through the local conformance runtime while profile-selected Kubernetes and AWS JobRuntime providers remain release-gated.', implementation: 'failClosedReserved' },
        { name: 'app.transaction.saga', surface: 'experimentalSurface', since: 'v0.9', rationale: 'Explicit compensating coordination over distributed effects remains beta until one deployed workflow provider passes the complete interruption and unknown-outcome matrix.', implementation: 'failClosedReserved' },
        { name: 'ML.model', surface: 'experimentalSurface', since: 'v0.9', rationale: 'Typed predictive model declarations and deterministic local conformance are implemented; generated deployed-provider hydration remains release-gated.', implementation: 'failClosedReserved' },
        { name: 'provider.MLModel', surface: 'experimentalSurface', since: 'v0.9', rationale: 'Qualified predictive providers retain content-addressed artifact and receipt contracts while deployed provider conformance remains beta.', implementation: 'failClosedReserved' },
        { name: 'provider.JobRuntime', surface: 'experimentalSurface', since: 'v0.9', rationale: 'Finite managed execution is profile-selectable across local, Kubernetes, and AWS implementations while deployed provider conformance remains release-gated.', implementation: 'failClosedReserved' },
        stableApiLabel('command', 'v0.4', 'Inert versioned command contracts with durable schema, identity, result, and compatibility semantics.'),
        stableApiLabel('event', 'v0.4', 'Inert versioned committed-fact contracts written through declared transactional outboxes.'),
        stableApiLabel('Model.create', 'v0.7', 'Direct schema-derived durable relational creation with transactional outbox change delivery.'),
        stableApiLabel('Model.update', 'v0.7', 'Direct schema-derived durable relational update with transactional outbox change delivery.'),
        stableApiLabel('Model.delete', 'v0.7', 'Direct schema-derived durable relational deletion with retained typed tombstones.'),
        stableApiLabel('Model.require', 'v0.7', 'Required transaction-scoped point read inferred from the enclosing managed closure.'),
        stableApiLabel('Model.edit', 'v0.7', 'Model-authoritative atomic mutation boundary inside an ordinary managed TypeScript function.'),
        stableApiLabel('Model.managed', 'v0.9', 'Enriches the existing native model with typed status and portable continuous-convergence semantics without introducing a wrapper model.'),
        stableApiLabel('Model.on.reconcile', 'v0.9', 'Canonical provider-neutral reconcile registrar shared with Kubernetes Resource.on.reconcile semantics.'),
        stableApiLabel('Model.on.finalize', 'v0.9', 'Portable restart-safe finalization with framework-managed finalizer installation and removal.'),
        stableApiLabel('Model.on.create', 'v0.7', 'Typed bounded processing of committed model creation events.'),
        stableApiLabel('Model.on.update', 'v0.7', 'Typed bounded processing of committed model update events with previous/current snapshots.'),
        stableApiLabel('Model.on.delete', 'v0.7', 'Typed bounded processing of committed model deletion events with previous snapshots and tombstones.'),
        stableApiLabel('provider.EventLog', 'v0.4', 'Durable at-least-once transport implemented by NATS JetStream while PostgreSQL remains authoritative.'),
        stableApiLabel('provider.Certificate', 'v0.4', 'Managed TLS intent materializes cert-manager Certificate resources while issuer lifecycle remains platform-owned.'),
        stableApiLabel('provider.DnsPublication', 'v0.4', 'Managed DNS intent materializes external-dns declarations without claiming propagation readiness.'),
        stableApiLabel('workflow', 'v0.5', 'Inert provider-neutral durable workflow contract with schemas, versioned identity, signals, and named errors.'),
        stableApiLabel('app.workflow', 'v0.5', 'Function-native durable orchestration with compiler-inferred retryable effect steps, child workflows, waits, schedules, signals, cancellation, and deterministic time.'),
        stableApiLabel('provider.WorkflowEngine', 'v0.5', 'Durable task and workflow execution contract initially implemented by Hatchet with operational PostgreSQL authority.'),
        stableApiLabel('app.query', 'v0.6', 'Versioned authorized query contract with bounded snapshots and invalidation/requery semantics.'),
        stableApiLabel('app.gateway', 'v0.6', 'Authenticated HTTP/SSE bridge for public query snapshots, scoped cursors, resume, and reset.'),
        stableApiLabel('stream', 'v0.6', 'Inert versioned public stream contract with an explicit runtime schema.'),
        stableApiLabel('app.stream', 'v0.6', 'App-bound replay, retention, partition, compatibility, and authorization contract.'),
        stableApiLabel('app.subscription', 'v0.6', 'Authorized cursor-scoped delivery binding with bounded retry and suspension.'),
        stableApiLabel('app.projection', 'v0.6', 'Rebuildable idempotent projection over an explicit replayable stream.'),
        stableApiLabel('app.agent', 'v0.7', 'Colocated serializable agent execution over one logical model, one service identity, and an exact set of existing operation tools.'),
        stableApiLabel('app.mcp', 'v0.7', 'Protected stateful MCP exposure over existing canonical operations with session-pinned catalog semantics.'),
        stableApiLabel('app.mcp.client', 'v0.7', 'Bounded allowlisted external MCP capability with separately acquired audience-bound credentials.'),
        stableApiLabel('Stream.process', 'v0.7', 'Durable at-least-once stream processing with PostgreSQL checkpoints, stable event idempotency, bounded retries, and explicit terminal failure policy.'),
        stableApiLabel('Stream.project', 'v0.7', 'Canonical stream-scoped spelling for a rebuildable projection.'),
        stableApiLabel('Stream.subscribe', 'v0.7', 'Canonical stream-scoped spelling for an authorized live subscription.'),
        stableApiLabel('provider.TransactionalDatabase', 'v0.7', 'Canonical transactional database capability, initially implemented by PostgreSQL/CNPG.'),
        stableApiLabel('provider.AnalyticalDatabase', 'v0.7', 'Canonical rebuildable analytical database capability, initially implemented by ClickHouse.'),
        stableApiLabel('provider.ManagedModelStore', 'v0.9', 'Qualified desired-value lifecycle authority for one managed model across PostgreSQL and Kubernetes.'),
        stableApiLabel('provider.OperatorRuntime', 'v0.9', 'Provider-neutral fenced reconciliation, resync, delayed wakeup, status, and finalization execution capability.'),
        stableApiLabel('provider.Authorization', 'v0.7', 'Provider-neutral versioned authorization decisions separated from request identity and enforced fail closed.'),
        stableApiLabel('provider.StructuredGeneration', 'v0.7', 'Schema-bound, cancellable structured generation with bounded usage evidence and Secret-backed credentials.'),
        stableApiLabel('provider.AI', 'v0.7', 'Provider-neutral logical model resolution with durable physical attempts, server-only credentials, and explicit gateway compatibility.'),
        { name: 'workload-movement-operator', surface: 'postV3Surface', rationale: 'Pressure-test application after v0.3 substrate freeze.', implementation: 'postV3' },
        { name: 'additional-provider-adapters', surface: 'postV3Surface', rationale: 'v0.3 ships bounded Kubernetes-native defaults; additional cloud and hosted-service adapters remain incremental.', implementation: 'postV3' },
      ],
    },
  });
}

function pruneUnusedFrameworkDefaults(
  nodes: readonly ApplicationGraphNode[],
  edges: readonly ApplicationGraphEdge[],
  requirements: readonly ApplicationProviderRequirement[],
  bindings: readonly ApplicationProviderBindingContract[],
): readonly ApplicationGraphNode[] {
  const referenced = new Set<string>();
  for (const edge of edges) {
    referenced.add(edge.from.nodeId);
    referenced.add(edge.to.nodeId);
  }
  for (const requirement of requirements) {
    if (requirement.provider) referenced.add(requirement.provider.nodeId);
    referenced.add(requirement.consumer.nodeId);
  }
  for (const binding of bindings) {
    referenced.add(binding.provider.nodeId);
  }
  return nodes.filter((node) =>
    node.kind !== 'provider'
    || node.config?.bindingKind !== 'frameworkDefault'
    || referenced.has(node.id));
}

function stableApiLabel(name: string, since: string, rationale: string): ApplicationCompatibilityLabel {
  return { name, surface: 'stablePublicApi', since, rationale, implementation: 'implemented' };
}

function _reservedProviderApiLabel(providerInterface: ApplicationProviderInterfaceKind): ApplicationCompatibilityLabel {
  return {
    name: `provider.${providerInterface}`,
    surface: 'stablePublicApi',
    since: 'v0.3',
    rationale: `${providerInterface} is a stable v0.3 provider interface reserved for app-scoped dependency injection; generated adapters fail closed until a concrete provider is implemented.`,
    implementation: 'failClosedReserved',
    diagnostics: [reservedProviderDiagnostic(providerInterface)],
  };
}

function reservedProviderDiagnostic(providerInterface: ApplicationProviderInterfaceKind): ApplicationDiagnosticContract {
  return {
    event: 'applik8s-provider-requirement-missing',
    severity: 'error',
    subject: { nodeId: `provider.${providerInterface}` },
    reason: 'ProviderInterfaceReserved',
    message: `${providerInterface} is a stable v0.3 provider interface, but this release has no generated adapter for it.`,
    likelyFix: `Bind a supported concrete provider, or keep ${providerInterface} usage behind a fail-closed feature boundary until an adapter exists.`,
    retryable: false,
  };
}

export function isApplicationGraph(value: unknown): value is ApplicationGraph {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'apiVersion') === 'applik8s.appGraph/v1alpha1' && Reflect.get(value, 'kind') === 'ApplicationGraph');
}

export function addApplicationGraphNode(state: ApplicationGraphState, node: ApplicationGraphNode): void {
  const index = state.graphNodes.findIndex((candidate) => candidate.id === node.id);
  if (index >= 0) {
    const existing = state.graphNodes[index];
    if (
      existing?.kind === 'provider'
      && node.kind === 'provider'
      && existing.interface === node.interface
    ) {
      const inheritedAlias =
        node.config?.aliasOf === undefined
          ? existing.config?.aliasOf
          : undefined;
      state.graphNodes[index] =
        existing.implementation === node.implementation
          ? {
              ...existing,
              ...node,
              config: {
                ...(existing.config ?? {}),
                ...(node.config ?? {}),
                ...(inheritedAlias !== undefined
                  ? { aliasOf: inheritedAlias }
                  : {}),
              },
            }
          : {
              ...node,
              ...(node.config || inheritedAlias !== undefined
                ? {
                    config: {
                      ...(node.config ?? {}),
                      ...(inheritedAlias !== undefined
                        ? { aliasOf: inheritedAlias }
                        : {}),
                    },
                  }
                : {}),
            };
      state.onChange?.();
      return;
    }
    state.graphNodes[index] = node;
    state.onChange?.();
    return;
  }
  state.graphNodes.push(node);
  state.onChange?.();
}

export function addApplicationGraphEdge(state: ApplicationGraphState, edge: ApplicationGraphEdge): void {
  state.graphEdges.push(edge);
  state.onChange?.();
}

export function addApplicationProviderRequirement(state: ApplicationGraphState, requirement: ApplicationProviderRequirement): void {
  const index = state.providerRequirements.findIndex((candidate) => candidate.id === requirement.id);
  if (index >= 0) {
    state.providerRequirements[index] = requirement;
    state.onChange?.();
    return;
  }
  state.providerRequirements.push(requirement);
  state.onChange?.();
}

export function addApplicationProviderBinding(state: ApplicationGraphState, binding: ApplicationProviderBindingContract): void {
  const index = state.providerBindings.findIndex((candidate) => candidate.requirement === binding.requirement && candidate.provider.interface === binding.provider.interface && candidate.provider.nodeId === binding.provider.nodeId);
  if (index >= 0) {
    state.providerBindings[index] = binding;
    state.onChange?.();
    return;
  }
  state.providerBindings.push(binding);
  state.onChange?.();
}

function dedupeApplicationGraphNodes(nodes: readonly ApplicationGraphNode[]): readonly ApplicationGraphNode[] {
  const byId = new Map<string, ApplicationGraphNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
}

function dedupeApplicationGraphEdges(edges: readonly ApplicationGraphEdge[]): readonly ApplicationGraphEdge[] {
  const byKey = new Map<string, ApplicationGraphEdge>();
  for (const edge of edges) {
    byKey.set(JSON.stringify(edge), edge);
  }
  return [...byKey.values()];
}

function dedupeApplicationProviderRequirements(requirements: readonly ApplicationProviderRequirement[]): readonly ApplicationProviderRequirement[] {
  const byId = new Map<string, ApplicationProviderRequirement>();
  for (const requirement of requirements) {
    byId.set(requirement.id, requirement);
  }
  return [...byId.values()];
}

function dedupeApplicationProviderBindings(bindings: readonly ApplicationProviderBindingContract[]): readonly ApplicationProviderBindingContract[] {
  const byKey = new Map<string, ApplicationProviderBindingContract>();
  for (const binding of bindings) {
    byKey.set(`${binding.requirement}:${binding.provider.interface}:${binding.provider.nodeId}`, binding);
  }
  return [...byKey.values()];
}
