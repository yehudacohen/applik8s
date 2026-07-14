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
      stablePublicApis: ['sdk.kubernetesComposition', 'app.server', 'app.http', 'app.crd', 'app.resource', 'app.model', 'app.reconcile', 'app.storage.postgres', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'app.aggregate', 'app.config', 'app.secret', 'app.expose', 'Resource.index', 'Resource.increment', 'command', 'event', 'task', 'workflow', 'Model.on.command', 'app.task', 'app.workflow', 'provider.ModelStore', 'provider.IndexStore', 'provider.CounterStore', 'provider.EventSource', 'provider.EventLog', 'provider.Secret', 'provider.Queue', 'provider.ObjectStorage', 'provider.HttpExposure', 'provider.Certificate', 'provider.DnsPublication', 'provider.CredentialStore', 'provider.WorkflowEngine'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['app.graph'],
      postV3Surfaces: ['workload-movement-operator', 'additional-provider-adapters'],
      labels: [
        stableApiLabel('sdk.kubernetesComposition', 'v0.2', 'Canonical TypeKro-backed app composition entrypoint.'),
        stableApiLabel('app.server', 'v0.2', 'Generated app-server workload entrypoint with inferred resources and RBAC.'),
        stableApiLabel('app.http', 'v0.3', 'Golden-path generated HTTP workload entrypoint; aliases app.server while preserving generated artifacts and RBAC.'),
        stableApiLabel('app.crd', 'v0.2', 'Schema-first Kubernetes CRD materialization entrypoint.'),
        stableApiLabel('app.resource', 'v0.3', 'Golden-path Kubernetes control-plane resource declaration that materializes as an app-owned CRD.'),
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Substrate-freeze app IR before lowering.', implementation: 'implemented' },
        stableApiLabel('app.model', 'v0.3', 'Schema-first storage-backed model materialization entrypoint.'),
        stableApiLabel('app.reconcile', 'v0.3', 'Golden-path app-scoped reconcile handler entrypoint backed by a generated operator install.'),
        stableApiLabel('app.storage.postgres', 'v0.3', 'Golden-path default ModelStore binding for the concrete Postgres provider and generated migration job path.'),
        stableApiLabel('app.job', 'v0.3', 'Durable generated Kubernetes Job task entrypoint with diagnostics and status metadata.'),
        stableApiLabel('app.schedule', 'v0.3', 'Durable generated Kubernetes CronJob task entrypoint with diagnostics and status metadata.'),
        stableApiLabel('app.defaults', 'v0.3', 'App-scoped provider default binding boundary.'),
        stableApiLabel('app.provide', 'v0.3', 'Typed app-scoped provider binding boundary.'),
        stableApiLabel('app.aggregate', 'v0.2', 'Generated aggregate worker entrypoint for resource event streams.'),
        stableApiLabel('app.config', 'v0.3', 'App-scoped ConfigMap-backed configuration binding API with explicit env/file metadata.'),
        stableApiLabel('app.secret', 'v0.3', 'App-scoped Secret-backed binding API with explicit redaction metadata.'),
        stableApiLabel('app.expose', 'v0.3', 'App-scoped HTTP exposure API for the concrete Ingress-backed v0.3 slice; unsupported TLS/Gateway semantics fail closed.'),
        stableApiLabel('Resource.index', 'v0.2', 'Cache-backed resource read-model declaration.'),
        stableApiLabel('Resource.increment', 'v0.2', 'Buffered counter operation for generated server/runtime scopes.'),
        stableApiLabel('provider.ModelStore', 'v0.3', 'Typed model storage capability contract backed by the Postgres provider slice.'),
        stableApiLabel('provider.IndexStore', 'v0.3', 'Typed index storage capability contract backed by the Valkey provider slice.'),
        stableApiLabel('provider.CounterStore', 'v0.3', 'Defaults to bounded Kubernetes-resource counters with buffered writes.'),
        stableApiLabel('provider.EventSource', 'v0.3', 'Defaults to bounded Kubernetes watch streams.'),
        stableApiLabel('provider.Secret', 'v0.3', 'Defaults to Kubernetes Secret references with explicit object ownership.'),
        stableApiLabel('provider.Queue', 'v0.3', 'Defaults to a bounded resourceVersion-safe ConfigMap queue contract.'),
        stableApiLabel('provider.ObjectStorage', 'v0.3', 'Defaults to bounded ConfigMap-backed objects with an explicit 512 KiB object ceiling.'),
        stableApiLabel('provider.HttpExposure', 'v0.3', 'Typed HTTP exposure capability contract backed by the Ingress app.expose slice; unsupported provider adapters fail closed.'),
        stableApiLabel('provider.CredentialStore', 'v0.3', 'Defaults to Kubernetes SecretRef credentials with external object ownership.'),
        { name: 'app.graph', surface: 'experimentalSurface', since: 'v0.3', rationale: 'Direct graph introspection remains experimental while the serialized ApplicationGraph artifact is the documented contract.', implementation: 'failClosedReserved' },
        stableApiLabel('command', 'v0.4', 'Inert versioned command contracts with durable schema, identity, result, and compatibility semantics.'),
        stableApiLabel('event', 'v0.4', 'Inert versioned committed-fact contracts written through declared transactional outboxes.'),
        stableApiLabel('Model.on.command', 'v0.4', 'Keyed model command declarations lower to the PostgreSQL transaction kernel and inferred bounded processors.'),
        stableApiLabel('provider.EventLog', 'v0.4', 'Durable at-least-once transport implemented by NATS JetStream while PostgreSQL remains authoritative.'),
        stableApiLabel('provider.Certificate', 'v0.4', 'Managed TLS intent materializes cert-manager Certificate resources while issuer lifecycle remains platform-owned.'),
        stableApiLabel('provider.DnsPublication', 'v0.4', 'Managed DNS intent materializes external-dns declarations without claiming propagation readiness.'),
        stableApiLabel('task', 'v0.5', 'Inert provider-neutral durable task contract with schemas, versioned identity, durable results, and named errors.'),
        stableApiLabel('workflow', 'v0.5', 'Inert provider-neutral durable workflow contract with schemas, versioned identity, signals, and named errors.'),
        stableApiLabel('app.task', 'v0.5', 'App-bound idempotent external-effect task materialized by the selected WorkflowEngine provider.'),
        stableApiLabel('app.workflow', 'v0.5', 'App-bound durable orchestration with declared tasks, child workflows, waits, schedules, signals, cancellation, and deterministic time.'),
        stableApiLabel('provider.WorkflowEngine', 'v0.5', 'Durable task and workflow execution contract initially implemented by Hatchet with operational PostgreSQL authority.'),
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
