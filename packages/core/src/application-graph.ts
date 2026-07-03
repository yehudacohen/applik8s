import type { ApiVersion, Condition, Diagnostic, JsonObject, KubernetesName, NamespaceName, ObjectRef, ResourceScope, SourceLocation } from './common.js';
import type { PermissionRule } from './resource.js';

export type ApplicationGraphVersion = 'applik8s.appGraph/v1alpha1';

export const applicationGraphMetadataProperty = '__applik8sApplicationGraph';

export const applicationGraphArtifactFileName = 'application-graph.json';

export interface ApplicationGraphArtifactReference {
  readonly apiVersion: ApplicationGraphVersion;
  readonly path: string;
  readonly digest: string;
}

export type ApplicationGraphNodeKind =
  | 'crd'
  | 'model'
  | 'server'
  | 'operator'
  | 'index'
  | 'aggregate'
  | 'counter'
  | 'job'
  | 'provider'
  | 'permission'
  | 'typeKroResource';

// typecast: the runtime node-kind registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationGraphNodeKinds = [
  'crd',
  'model',
  'server',
  'operator',
  'index',
  'aggregate',
  'counter',
  'job',
  'provider',
  'permission',
  'typeKroResource',
] as const satisfies readonly ApplicationGraphNodeKind[];

export type ApplicationProviderInterfaceKind =
  | 'ModelStore'
  | 'IndexStore'
  | 'CounterStore'
  | 'EventSource'
  | 'Secret'
  | 'Queue'
  | 'ObjectStorage'
  | 'HttpExposure'
  | 'CredentialStore';

// typecast: the runtime provider-interface registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationProviderInterfaceKinds = [
  'ModelStore',
  'IndexStore',
  'CounterStore',
  'EventSource',
  'Secret',
  'Queue',
  'ObjectStorage',
  'HttpExposure',
  'CredentialStore',
] as const satisfies readonly ApplicationProviderInterfaceKind[];

export interface ApplicationGraph {
  readonly apiVersion: ApplicationGraphVersion;
  readonly kind: 'ApplicationGraph';
  readonly metadata: ApplicationGraphMetadata;
  readonly nodes: readonly ApplicationGraphNode[];
  readonly edges: readonly ApplicationGraphEdge[];
  readonly compatibility: ApplicationGraphCompatibility;
}

export interface ApplicationGraphMetadata {
  readonly name: KubernetesName;
  readonly namespace?: NamespaceName;
  readonly sourceLocation?: SourceLocation;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export type ApplicationGraphNode =
  | ApplicationCrdNode
  | ApplicationModelNode
  | ApplicationServerNode
  | ApplicationOperatorNode
  | ApplicationIndexNode
  | ApplicationAggregateNode
  | ApplicationCounterNode
  | ApplicationJobNode
  | ApplicationProviderNode
  | ApplicationPermissionNode
  | ApplicationTypeKroResourceNode;

export interface ApplicationGraphNodeBase<TKind extends ApplicationGraphNodeKind> {
  readonly id: string;
  readonly kind: TKind;
  readonly name: string;
  readonly sourceLocation?: SourceLocation;
  readonly stability: ApplicationGraphStability;
}

export type ApplicationGraphStability = 'stable' | 'experimental' | 'internal';

export interface ApplicationCrdNode extends ApplicationGraphNodeBase<'crd'> {
  readonly resource: ApplicationResourceContract;
  readonly materialization: 'kubernetes-crd';
}

export interface ApplicationModelNode extends ApplicationGraphNodeBase<'model'> {
  readonly entity: ApplicationEntityContract;
  readonly store: ApplicationProviderRef<'ModelStore'>;
  readonly schema: ApplicationModelSchemaContract;
  readonly materialization: ApplicationModelMaterializationContract;
}

export interface ApplicationServerNode extends ApplicationGraphNodeBase<'server'> {
  readonly routes: readonly ApplicationRouteContract[];
  readonly resources: readonly ApplicationResourceRef[];
  readonly indexes: readonly ApplicationGraphNodeRef[];
  readonly exposure?: ApplicationProviderRef<'HttpExposure'>;
}

export interface ApplicationOperatorNode extends ApplicationGraphNodeBase<'operator'> {
  readonly resources: readonly ApplicationResourceRef[];
  readonly watches: readonly ApplicationWatchScope[];
}

export interface ApplicationIndexNode extends ApplicationGraphNodeBase<'index'> {
  readonly source: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly provider: ApplicationProviderRef<'IndexStore'>;
  readonly partitionBy?: ApplicationExpressionContract;
  readonly filter?: ApplicationExpressionContract;
  readonly orderBy?: ApplicationExpressionContract;
}

export interface ApplicationAggregateNode extends ApplicationGraphNodeBase<'aggregate'> {
  readonly source: ApplicationGraphNodeRef;
  readonly target: ApplicationStatusTargetRef;
  readonly flush: ApplicationFlushPolicy;
}

export interface ApplicationCounterNode extends ApplicationGraphNodeBase<'counter'> {
  readonly target: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly provider?: ApplicationProviderRef<'CounterStore'>;
  readonly flush: ApplicationFlushPolicy;
}

export interface ApplicationJobNode extends ApplicationGraphNodeBase<'job'> {
  readonly task: ApplicationJobTaskContract;
  readonly phase: ApplicationPhaseContract;
  readonly resources: readonly ApplicationResourceRef[];
  readonly retry: ApplicationRetryPolicy;
  readonly runtime: ApplicationJobRuntimeContract;
}

export interface ApplicationProviderNode<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> extends ApplicationGraphNodeBase<'provider'> {
  readonly interface: TInterface;
  readonly implementation: string;
  readonly config?: JsonObject;
}

export interface ApplicationProviderRequirement<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly id: string;
  readonly interface: TInterface;
  readonly consumer: ApplicationGraphNodeRef;
  readonly provider?: ApplicationProviderRef<TInterface>;
  readonly required: true;
  readonly purpose: 'modelStore' | 'indexStore' | 'counterStore' | 'eventSource' | 'secret' | 'queue' | 'objectStorage' | 'httpExposure' | 'credentialStore';
  readonly diagnostics: ApplicationProviderRequirementDiagnostics;
}

export interface ApplicationProviderRequirementDiagnostics {
  readonly missing: string;
  readonly ambiguous: string;
}

export interface ApplicationProviderBindingContract<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly requirement: string;
  readonly provider: ApplicationProviderRef<TInterface>;
  readonly generatedResources: readonly ApplicationResourceRef[];
  readonly runtime: ApplicationProviderRuntimeContract;
}

export interface ApplicationProviderRuntimeContract {
  readonly env?: Readonly<Record<string, string>>;
  readonly secretRefs?: readonly ApplicationResourceRef[];
  readonly volumeMounts?: readonly string[];
  readonly permissions?: readonly PermissionRule[];
}

export interface ApplicationPermissionNode extends ApplicationGraphNodeBase<'permission'> {
  readonly owner: ApplicationGraphNodeRef;
  readonly rules: readonly PermissionRule[];
  readonly mode: 'explicit' | 'inferred' | 'explicitAndInferred';
}

export interface ApplicationTypeKroResourceNode extends ApplicationGraphNodeBase<'typeKroResource'> {
  readonly resource: ApplicationResourceRef;
  readonly watch?: ApplicationWatchScope;
}

export interface ApplicationGraphNodeRef {
  readonly nodeId: string;
}

export interface ApplicationResourceRef {
  readonly apiVersion: ApiVersion;
  readonly kind: string;
  readonly name?: KubernetesName;
  readonly namespace?: NamespaceName;
}

export interface ApplicationResourceContract {
  readonly apiVersion: ApiVersion;
  readonly kind: string;
  readonly plural: string;
  readonly scope: ResourceScope;
}

export interface ApplicationEntityContract {
  readonly name: string;
  readonly specSchemaDigest?: string;
  readonly statusSchemaDigest?: string;
}

export interface ApplicationModelSchemaContract {
  readonly identity: readonly string[];
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
  readonly migrations: ApplicationMigrationContract;
  readonly transactions: 'required' | 'supported' | 'unsupported';
  readonly retention?: ApplicationRetentionPolicy;
}

export interface ApplicationModelMaterializationContract {
  readonly mode: 'providerBacked';
  readonly provider: ApplicationProviderRef<'ModelStore'>;
  readonly backingResources: readonly ApplicationResourceRef[];
  readonly connection: ApplicationProviderRuntimeContract;
  readonly reconciliation: ApplicationModelReconciliationContract;
}

export interface ApplicationModelReconciliationContract {
  readonly ownership: 'application' | 'external';
  readonly schemaDrift: 'failClosed' | 'generatedMigrationJob';
  readonly deletionPolicy: 'retain' | 'deleteWithApplication';
}

export interface ApplicationModelConstraint {
  readonly name: string;
  readonly fields: readonly string[];
  readonly kind: 'unique' | 'foreignKey' | 'check';
}

export interface ApplicationModelIndex {
  readonly name: string;
  readonly fields: readonly string[];
  readonly unique?: boolean;
}

export interface ApplicationMigrationContract {
  readonly strategy: 'none' | 'generatedJob' | 'external';
  readonly compatibility: 'schemaCompatibleOnly' | 'requiresExplicitMigration';
}

export interface ApplicationRetentionPolicy {
  readonly mode: 'retain' | 'ttl' | 'deleteWithOwner';
  readonly ttlSeconds?: number;
}

export interface ApplicationRouteContract {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly sourceLocation?: SourceLocation;
}

export interface ApplicationProviderRef<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly interface: TInterface;
  readonly nodeId: string;
}

export type ApplicationWatchScope =
  | ApplicationExactWatchScope
  | ApplicationFiniteWatchScope
  | ApplicationSelectorWatchScope
  | ApplicationFieldSelectorWatchScope
  | ApplicationMixedWatchScope;

export interface ApplicationExactWatchScope {
  readonly kind: 'exact';
  readonly ref: ObjectRef;
}

export interface ApplicationFiniteWatchScope {
  readonly kind: 'finite';
  readonly refs: readonly ObjectRef[];
}

export interface ApplicationSelectorWatchScope {
  readonly kind: 'labelSelector';
  readonly apiVersion: ApiVersion;
  readonly resourceKind: string;
  readonly namespace?: NamespaceName;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ApplicationFieldSelectorWatchScope {
  readonly kind: 'fieldSelector';
  readonly apiVersion: ApiVersion;
  readonly resourceKind: string;
  readonly namespace?: NamespaceName;
  readonly fieldSelector: string;
}

export interface ApplicationMixedWatchScope {
  readonly kind: 'mixed';
  readonly scopes: readonly Exclude<ApplicationWatchScope, ApplicationMixedWatchScope>[];
}

export interface ApplicationStatusTargetRef {
  readonly resource: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly statusPath?: string;
}

export interface ApplicationFlushPolicy {
  readonly everyMs: number;
  readonly maxEvents?: number;
}

export interface ApplicationExpressionContract {
  readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate';
  readonly source: string;
}

export interface ApplicationJobTaskContract {
  readonly taskKind: 'preflight' | 'migration' | 'cleanup' | 'repair' | 'maintenance' | 'custom';
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
}

export interface ApplicationJobRuntimeContract {
  readonly materialization: 'kubernetes-job' | 'kubernetes-cronjob';
  readonly idempotency: ApplicationJobIdempotencyContract;
  readonly phaseStatus: ApplicationStatusTargetRef;
  readonly permissions: readonly PermissionRule[];
  readonly environment?: ApplicationProviderRuntimeContract;
}

export interface ApplicationJobIdempotencyContract {
  readonly keySource: 'metadata.uid' | 'metadata.generation' | 'spec' | 'explicit';
  readonly conflictPolicy: 'skipCompleted' | 'replaceFailed' | 'failClosed';
}

export interface ApplicationPhaseContract {
  readonly initialPhase: string;
  readonly terminalPhases: readonly string[];
  readonly conditions: readonly ApplicationPhaseConditionType[];
}

export type ApplicationPhaseConditionType = 'Blocked' | 'Progressing' | 'Ready' | 'Finalized' | 'Failed';

export interface ApplicationPhaseStatus {
  readonly phase: string;
  readonly observedGeneration?: number;
  readonly currentStep?: string;
  readonly lastSuccessfulStep?: string;
  readonly idempotencyKey?: string;
  readonly retryCount?: number;
  readonly terminalFailure?: ApplicationTerminalFailure;
  readonly conditions: readonly Condition[];
}

export interface ApplicationTerminalFailure {
  readonly reason: string;
  readonly message: string;
  readonly failedStep?: string;
  readonly partialEffects?: readonly ApplicationPartialEffect[];
}

export interface ApplicationPartialEffect {
  readonly operation: string;
  readonly ref?: ObjectRef;
  readonly status: 'visible' | 'unknown' | 'rolledBack';
}

export interface ApplicationRetryPolicy {
  readonly mode: 'never' | 'boundedExponentialBackoff';
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface ApplicationGraphEdge {
  readonly from: ApplicationGraphNodeRef;
  readonly to: ApplicationGraphNodeRef;
  readonly relationship: ApplicationGraphEdgeRelationship;
}

export type ApplicationGraphEdgeRelationship =
  | 'dependsOn'
  | 'provides'
  | 'reads'
  | 'writes'
  | 'watches'
  | 'emits'
  | 'owns'
  | 'exposes';

export interface ApplicationGraphCompatibility {
  readonly stablePublicApis: readonly string[];
  readonly documentedInternalContracts: readonly string[];
  readonly experimentalSurfaces: readonly string[];
  readonly postV3Surfaces: readonly string[];
}

export function isApplicationGraphNodeKind(value: string): value is ApplicationGraphNodeKind {
  // typecast: Array.includes needs an erased string array to test arbitrary input while preserving the type predicate result.
  return (applicationGraphNodeKinds as readonly string[]).includes(value);
}

export function isApplicationProviderInterfaceKind(value: string): value is ApplicationProviderInterfaceKind {
  // typecast: Array.includes needs an erased string array to test arbitrary input while preserving the type predicate result.
  return (applicationProviderInterfaceKinds as readonly string[]).includes(value);
}

export function normalizeApplicationGraph(graph: ApplicationGraph): ApplicationGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].sort(compareApplicationGraphNodes),
    edges: [...graph.edges].sort(compareApplicationGraphEdges),
    compatibility: {
      stablePublicApis: sortedStrings(graph.compatibility.stablePublicApis),
      documentedInternalContracts: sortedStrings(graph.compatibility.documentedInternalContracts),
      experimentalSurfaces: sortedStrings(graph.compatibility.experimentalSurfaces),
      postV3Surfaces: sortedStrings(graph.compatibility.postV3Surfaces),
    },
  };
}

export function serializeApplicationGraph(graph: ApplicationGraph): string {
  return `${stableJsonStringify(normalizeApplicationGraph(graph))}\n`;
}

export function validateApplicationGraphProviderBindings(graph: ApplicationGraph, requirements: readonly ApplicationProviderRequirement[] = []): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const providers = graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider');
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const node of graph.nodes) {
    for (const ref of uniqueApplicationProviderRefs(applicationProviderRefsForNode(node))) {
      diagnostics.push(...applicationProviderRefDiagnostics(`Application graph node ${node.id}`, ref, providerById));
    }
  }

  for (const requirement of requirements) {
    if (!nodeIds.has(requirement.consumer.nodeId)) {
      diagnostics.push(applicationProviderBindingDiagnostic(`Application provider requirement ${requirement.id} references missing consumer ${requirement.consumer.nodeId}.`));
      continue;
    }
    if (requirement.provider) {
      diagnostics.push(...applicationProviderRefDiagnostics(`Application provider requirement ${requirement.id}`, requirement.provider, providerById));
      continue;
    }
    const candidates = providers.filter((provider) => provider.interface === requirement.interface);
    if (candidates.length === 0) {
      diagnostics.push(applicationProviderBindingDiagnostic(requirement.diagnostics.missing));
    } else if (candidates.length > 1) {
      diagnostics.push(applicationProviderBindingDiagnostic(requirement.diagnostics.ambiguous));
    }
  }

  return diagnostics;
}

function uniqueApplicationProviderRefs(refs: readonly ApplicationProviderRef[]): readonly ApplicationProviderRef[] {
  const byKey = new Map<string, ApplicationProviderRef>();
  for (const ref of refs) {
    byKey.set(`${ref.interface}:${ref.nodeId}`, ref);
  }
  return [...byKey.values()];
}

function applicationProviderRefDiagnostics(owner: string, ref: ApplicationProviderRef, providerById: ReadonlyMap<string, ApplicationProviderNode>): readonly Diagnostic[] {
  const provider = providerById.get(ref.nodeId);
  if (!provider) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but that provider node is missing.`)];
  }
  if (provider.interface !== ref.interface) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but the provider node implements ${provider.interface}.`)];
  }
  return [];
}

function applicationProviderRefsForNode(node: ApplicationGraphNode): readonly ApplicationProviderRef[] {
  switch (node.kind) {
    case 'model':
      return [node.store, node.materialization.provider];
    case 'server':
      return node.exposure ? [node.exposure] : [];
    case 'index':
      return [node.provider];
    case 'counter':
      return node.provider ? [node.provider] : [];
    default:
      return [];
  }
}

function applicationProviderBindingDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPATIBILITY_FAILED',
    message,
    recovery: { summary: 'Bind exactly one matching provider before lowering this application graph.' },
  };
}

function compareApplicationGraphNodes(left: ApplicationGraphNode, right: ApplicationGraphNode): number {
  return compareStrings(left.id, right.id) || compareStrings(left.kind, right.kind) || compareStrings(left.name, right.name);
}

function compareApplicationGraphEdges(left: ApplicationGraphEdge, right: ApplicationGraphEdge): number {
  return compareStrings(left.from.nodeId, right.from.nodeId) || compareStrings(left.relationship, right.relationship) || compareStrings(left.to.nodeId, right.to.nodeId);
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`).join(',')}}`;
}
