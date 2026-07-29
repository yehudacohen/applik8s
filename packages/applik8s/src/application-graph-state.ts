import type { ApplicationCompatibilityLabel, ApplicationDiagnosticContract, ApplicationGraph, ApplicationGraphEdge, ApplicationGraphNode, ApplicationProviderBindingContract, ApplicationProviderInterfaceKind, ApplicationProviderRequirement } from '@applik8s/core';
import { normalizeApplicationGraph } from '@applik8s/core';

export interface ApplicationGraphState {
  readonly graphNodes: ApplicationGraphNode[];
  readonly graphEdges: ApplicationGraphEdge[];
  readonly providerRequirements: ApplicationProviderRequirement[];
  readonly providerBindings: ApplicationProviderBindingContract[];
}

export function applicationGraphFromState(name: string, state: ApplicationGraphState): ApplicationGraph {
  return normalizeApplicationGraph({
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name },
    nodes: dedupeApplicationGraphNodes(state.graphNodes),
    edges: dedupeApplicationGraphEdges(state.graphEdges),
    providerRequirements: dedupeApplicationProviderRequirements(state.providerRequirements),
    providerBindings: dedupeApplicationProviderBindings(state.providerBindings),
    compatibility: {
      stablePublicApis: ['sdk.kubernetesComposition', 'app.installation', 'app.server', 'app.http', 'app.crd', 'app.resource', 'app.model', 'app.on', 'app.reconcile', 'app.storage.postgres', 'app.objectStore', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'app.select', 'app.selectProvider', 'app.when', 'app.any', 'app.all', 'app.interpolate', 'app.aggregate', 'app.config', 'app.secret', 'app.expose', 'app.query', 'app.gateway', 'app.stream', 'app.subscription', 'app.projection', 'Stream.process', 'Stream.project', 'Stream.subscribe', 'Resource.index', 'Resource.increment', 'command', 'event', 'stream', 'task', 'workflow', 'Model.create', 'Model.update', 'Model.delete', 'Model.on.create', 'Model.on.update', 'Model.on.delete', 'Model.action', 'Model.on.action', 'Model.command', 'Model.on.command', 'app.task', 'app.workflow', 'provider.ModelStore', 'provider.IndexStore', 'provider.CounterStore', 'provider.EventSource', 'provider.EventLog', 'provider.Secret', 'provider.Queue', 'provider.ObjectStorage', 'provider.HttpExposure', 'provider.Certificate', 'provider.DnsPublication', 'provider.CredentialStore', 'provider.WorkflowEngine', 'provider.ProjectionStore', 'provider.Authorization', 'provider.StructuredGeneration'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['app.graph'],
      postV3Surfaces: ['workload-movement-operator', 'additional-provider-adapters'],
      labels: [
        stableApiLabel('sdk.kubernetesComposition', 'v0.2', 'Canonical TypeKro-backed app composition entrypoint.'),
        stableApiLabel('app.installation', 'v0.7', 'Typed installable Application CRD contract shared by generated manifests, operators, and application code.'),
        stableApiLabel('app.server', 'v0.2', 'Generated app-server workload entrypoint with inferred resources and RBAC.'),
        stableApiLabel('app.http', 'v0.3', 'Golden-path generated HTTP workload entrypoint; aliases app.server while preserving generated artifacts and RBAC.'),
        stableApiLabel('app.crd', 'v0.2', 'Schema-first Kubernetes CRD materialization entrypoint.'),
        stableApiLabel('app.resource', 'v0.3', 'Golden-path Kubernetes control-plane resource declaration that materializes as an app-owned CRD.'),
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Substrate-freeze app IR before lowering.', implementation: 'implemented' },
        stableApiLabel('app.model', 'v0.3', 'Schema-first storage-backed model materialization entrypoint.'),
        stableApiLabel('app.on', 'v0.6', 'App-native Kubernetes lifecycle event registration for created, updated, deleted, statusChanged, reconcile, and finalize handlers.'),
        stableApiLabel('app.reconcile', 'v0.3', 'Golden-path app-scoped reconcile handler entrypoint backed by a generated operator install.'),
        stableApiLabel('app.storage.postgres', 'v0.3', 'Golden-path default ModelStore binding for the concrete Postgres provider and generated migration job path.'),
        stableApiLabel('app.objectStore', 'v0.7', 'Provider-neutral bounded object store declaration with server-only credentials, integrity metadata, and optional signed browser intents.'),
        stableApiLabel('app.job', 'v0.3', 'Durable generated Kubernetes Job task entrypoint with diagnostics and status metadata.'),
        stableApiLabel('app.schedule', 'v0.3', 'Durable generated Kubernetes CronJob task entrypoint with diagnostics and status metadata.'),
        stableApiLabel('app.defaults', 'v0.3', 'App-scoped provider default binding boundary.'),
        stableApiLabel('app.provide', 'v0.3', 'Typed app-scoped provider binding boundary.'),
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
        stableApiLabel('provider.ModelStore', 'v0.3', 'Typed model storage capability contract backed by the Postgres provider slice.'),
        stableApiLabel('provider.IndexStore', 'v0.3', 'Typed index storage capability contract backed by the Valkey provider slice.'),
        stableApiLabel('provider.CounterStore', 'v0.3', 'Defaults to bounded Kubernetes-resource counters with buffered writes.'),
        stableApiLabel('provider.EventSource', 'v0.3', 'Defaults to bounded Kubernetes watch streams.'),
        stableApiLabel('provider.Secret', 'v0.3', 'Defaults to Kubernetes Secret references with explicit object ownership.'),
        stableApiLabel('provider.Queue', 'v0.3', 'Defaults to a bounded resourceVersion-safe ConfigMap queue contract.'),
        stableApiLabel('provider.ObjectStorage', 'v0.3', 'Defaults to bounded ConfigMap-backed objects with an explicit 512 KiB object ceiling.'),
        stableApiLabel('provider.HttpExposure', 'v0.3', 'Typed HTTP exposure capability contract backed by explicit Ingress and NodePort providers.'),
        stableApiLabel('provider.CredentialStore', 'v0.3', 'Defaults to Kubernetes SecretRef credentials with external object ownership.'),
        { name: 'app.graph', surface: 'experimentalSurface', since: 'v0.3', rationale: 'Direct graph introspection remains experimental while the serialized ApplicationGraph artifact is the documented contract.', implementation: 'failClosedReserved' },
        stableApiLabel('command', 'v0.4', 'Inert versioned command contracts with durable schema, identity, result, and compatibility semantics.'),
        stableApiLabel('event', 'v0.4', 'Inert versioned committed-fact contracts written through declared transactional outboxes.'),
        stableApiLabel('Model.on.command', 'v0.4', 'Low-level keyed command registration for explicit command contracts; ordinary domain code should prefer direct lifecycle mutations or Model.action.'),
        stableApiLabel('Model.create', 'v0.7', 'Direct schema-derived durable relational creation with transactional outbox change delivery.'),
        stableApiLabel('Model.update', 'v0.7', 'Direct schema-derived durable relational update with transactional outbox change delivery.'),
        stableApiLabel('Model.delete', 'v0.7', 'Direct schema-derived durable relational deletion with retained typed tombstones.'),
        stableApiLabel('Model.on.create', 'v0.7', 'Typed bounded processing of committed model creation events.'),
        stableApiLabel('Model.on.update', 'v0.7', 'Typed bounded processing of committed model update events with previous/current snapshots.'),
        stableApiLabel('Model.on.delete', 'v0.7', 'Typed bounded processing of committed model deletion events with previous snapshots and tombstones.'),
        stableApiLabel('Model.action', 'v0.7', 'Single declaration for exceptional non-CRUD model behavior; derives the direct method and its typed committed Model.on.<verb> completion stream. Prefer lifecycle mutations or tasks/workflows where they fit.'),
        stableApiLabel('Model.on.action', 'v0.7', 'Low-level action registration used by Model.action; ordinary domain code should use the direct named method.'),
        stableApiLabel('Model.command', 'v0.4', 'Versioned command contract foundation retained for explicit protocol-level operations.'),
        stableApiLabel('provider.EventLog', 'v0.4', 'Durable at-least-once transport implemented by NATS JetStream while PostgreSQL remains authoritative.'),
        stableApiLabel('provider.Certificate', 'v0.4', 'Managed TLS intent materializes cert-manager Certificate resources while issuer lifecycle remains platform-owned.'),
        stableApiLabel('provider.DnsPublication', 'v0.4', 'Managed DNS intent materializes external-dns declarations without claiming propagation readiness.'),
        stableApiLabel('task', 'v0.5', 'Inert provider-neutral durable task contract with schemas, versioned identity, durable results, and named errors.'),
        stableApiLabel('workflow', 'v0.5', 'Inert provider-neutral durable workflow contract with schemas, versioned identity, signals, and named errors.'),
        stableApiLabel('app.task', 'v0.5', 'App-bound idempotent external-effect task materialized by the selected WorkflowEngine provider.'),
        stableApiLabel('app.workflow', 'v0.5', 'App-bound durable orchestration with declared tasks, child workflows, waits, schedules, signals, cancellation, and deterministic time.'),
        stableApiLabel('provider.WorkflowEngine', 'v0.5', 'Durable task and workflow execution contract initially implemented by Hatchet with operational PostgreSQL authority.'),
        stableApiLabel('app.query', 'v0.6', 'Versioned authorized query contract with bounded snapshots and invalidation/requery semantics.'),
        stableApiLabel('app.gateway', 'v0.6', 'Authenticated HTTP/SSE bridge for public query snapshots, scoped cursors, resume, and reset.'),
        stableApiLabel('stream', 'v0.6', 'Inert versioned public stream contract with an explicit runtime schema.'),
        stableApiLabel('app.stream', 'v0.6', 'App-bound replay, retention, partition, compatibility, and authorization contract.'),
        stableApiLabel('app.subscription', 'v0.6', 'Authorized cursor-scoped delivery binding with bounded retry and suspension.'),
        stableApiLabel('app.projection', 'v0.6', 'Rebuildable idempotent projection over an explicit replayable stream.'),
        stableApiLabel('Stream.process', 'v0.7', 'Durable at-least-once stream processing with PostgreSQL checkpoints, stable event idempotency, bounded retries, and explicit terminal failure policy.'),
        stableApiLabel('Stream.project', 'v0.7', 'Canonical stream-scoped spelling for a rebuildable projection.'),
        stableApiLabel('Stream.subscribe', 'v0.7', 'Canonical stream-scoped spelling for an authorized live subscription.'),
        stableApiLabel('provider.ProjectionStore', 'v0.6', 'Disposable analytical projection storage initially implemented by ClickHouse.'),
        stableApiLabel('provider.Authorization', 'v0.7', 'Provider-neutral versioned authorization decisions separated from request identity and enforced fail closed.'),
        stableApiLabel('provider.StructuredGeneration', 'v0.7', 'Schema-bound, cancellable structured generation with bounded usage evidence and Secret-backed credentials.'),
        { name: 'workload-movement-operator', surface: 'postV3Surface', rationale: 'Pressure-test application after v0.3 substrate freeze.', implementation: 'postV3' },
        { name: 'additional-provider-adapters', surface: 'postV3Surface', rationale: 'v0.3 ships bounded Kubernetes-native defaults; additional cloud and hosted-service adapters remain incremental.', implementation: 'postV3' },
      ],
    },
  });
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
      && existing.implementation === node.implementation
    ) {
      state.graphNodes[index] = {
        ...existing,
        ...node,
        config: { ...(existing.config ?? {}), ...(node.config ?? {}) },
      };
      return;
    }
    state.graphNodes[index] = node;
    return;
  }
  state.graphNodes.push(node);
}

export function addApplicationGraphEdge(state: ApplicationGraphState, edge: ApplicationGraphEdge): void {
  state.graphEdges.push(edge);
}

export function addApplicationProviderRequirement(state: ApplicationGraphState, requirement: ApplicationProviderRequirement): void {
  const index = state.providerRequirements.findIndex((candidate) => candidate.id === requirement.id);
  if (index >= 0) {
    state.providerRequirements[index] = requirement;
    return;
  }
  state.providerRequirements.push(requirement);
}

export function addApplicationProviderBinding(state: ApplicationGraphState, binding: ApplicationProviderBindingContract): void {
  const index = state.providerBindings.findIndex((candidate) => candidate.requirement === binding.requirement && candidate.provider.interface === binding.provider.interface && candidate.provider.nodeId === binding.provider.nodeId);
  if (index >= 0) {
    state.providerBindings[index] = binding;
    return;
  }
  state.providerBindings.push(binding);
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
