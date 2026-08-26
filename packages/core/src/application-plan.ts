// typecast-file-boundary: Plan diff classification narrows records from the closed, validated public plan union before comparing canonical JSON.
import type {
  ApplicationCanonicalIdentity,
  ApplicationDeploymentTargetDescriptor,
  ApplicationNativePlanRecord,
  ApplicationProviderDisposition,
  ApplicationProviderGuaranteeManifest,
  ApplicationProviderMaturity,
  ApplicationRuntimeAccessRequirement,
  ApplicationSourceProvenance,
} from './application-foundation.js';
import { canonicalJsonV1String } from './canonical-json.js';

export type ApplicationPlanSchemaVersion = 'applik8s.applicationPlan/v1alpha1';
export type ApplicationPlanSourceGraphVersion = 'applik8s.appGraph/v1alpha1';
export type ApplicationPlanFactClass =
  | 'declared'
  | 'derived'
  | 'resolved'
  | 'planned'
  | 'estimated'
  | 'unknown'
  | 'external'
  | 'observed';

export interface ApplicationPlan {
  readonly schemaVersion: ApplicationPlanSchemaVersion;
  readonly sourceGraphVersion: ApplicationPlanSourceGraphVersion;
  readonly application: ApplicationCanonicalIdentity;
  readonly target: ApplicationDeploymentTargetDescriptor;
  readonly generatedAt: string;
  readonly sourceDigest: string;
  readonly identities: readonly ApplicationCanonicalIdentity[];
  readonly semantic: ApplicationSemanticPlan;
  readonly resolution: ApplicationProviderResolutionPlan;
  readonly physical: ApplicationPhysicalTopologyPlan;
  readonly diagnostics: readonly ApplicationPlanDiagnostic[];
  readonly estimates: readonly ApplicationPlanEstimate[];
  readonly evidence: readonly ApplicationPlanEvidenceReference[];
}

export interface ApplicationSemanticPlan {
  readonly nodes: readonly ApplicationSemanticPlanNode[];
  readonly edges: readonly ApplicationSemanticPlanEdge[];
  readonly executions: readonly ApplicationPlanExecution[];
  readonly authority: readonly ApplicationPlanAuthorityGrant[];
  readonly dataFlows: readonly ApplicationPlanDataFlow[];
  readonly state: readonly ApplicationPlanStateAuthority[];
  readonly exposures: readonly ApplicationPlanExposure[];
  readonly observability: readonly ApplicationPlanObservability[];
  readonly runtimeAccess: readonly ApplicationRuntimeAccessRequirement[];
}

export interface ApplicationPlanExecution {
  readonly id: string;
  readonly identity: ApplicationCanonicalIdentity['id'];
  readonly graphNodeId: string;
  readonly kind: string;
  readonly scalingBoundary: 'singleton' | 'replicated' | 'provider-managed' | 'unknown';
  readonly fact: 'declared' | 'derived';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanAuthorityGrant {
  readonly id: string;
  readonly principal: string;
  readonly operationIds: readonly string[];
  readonly permissionId?: string;
  readonly scope: unknown;
  readonly fact: 'declared' | 'derived';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanDataFlow {
  readonly id: string;
  readonly from: ApplicationCanonicalIdentity['id'];
  readonly to: ApplicationCanonicalIdentity['id'];
  readonly relationship: string;
  readonly causal: boolean;
  readonly fact: 'declared' | 'derived';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanStateAuthority {
  readonly id: string;
  readonly subject: ApplicationCanonicalIdentity['id'];
  readonly authority: string;
  readonly consistency: string;
  readonly retention?: string;
  readonly recovery?: string;
  readonly fact: 'declared' | 'derived' | 'unknown';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanExposure {
  readonly id: string;
  readonly subject: ApplicationCanonicalIdentity['id'];
  readonly kind: 'http' | 'gateway' | 'subscription' | 'external';
  readonly public: boolean | 'unknown';
  readonly trustBoundary: string;
  readonly fact: 'declared' | 'derived' | 'unknown';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanObservability {
  readonly id: string;
  readonly subject: ApplicationCanonicalIdentity['id'];
  readonly signals: readonly ('traces' | 'logs' | 'metrics' | 'events')[];
  readonly collector: string;
  readonly export: string;
  readonly retention: string;
  readonly cardinality: 'bounded' | 'unbounded' | 'unknown';
  readonly topology: {
    readonly collector: 'local-collector' | 'clickstack-gateway' | 'cloudwatch-collector' | 'external-collector' | 'provider-resolved';
    readonly protocol: 'otlp/http-protobuf' | 'provider-resolved';
    readonly endpoint: 'supervisor-assigned' | 'provider-managed' | string;
    readonly lifecycle: 'ephemeral' | 'retained' | 'external' | 'provider-managed';
    readonly authentication: 'none' | 'secret-header' | 'workload-identity' | 'provider-resolved';
    readonly tls: 'plaintext-loopback' | 'system-trust' | 'custom-ca' | 'workload-identity' | 'provider-resolved';
  };
  readonly sampling?: {
    readonly traceHead: number;
    readonly debugLogs: number;
    readonly alwaysSampleErrors: boolean;
  };
  readonly redaction?: { readonly deniedFields: readonly string[] };
  readonly fact: 'declared' | 'derived' | 'unknown';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationSemanticPlanNode {
  readonly id: ApplicationCanonicalIdentity['id'];
  readonly graphNodeId: string;
  readonly kind: string;
  readonly name: string;
  readonly stability: 'stable' | 'experimental' | 'internal';
  readonly fact: 'declared' | 'derived';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationSemanticPlanEdge {
  readonly id: string;
  readonly from: ApplicationCanonicalIdentity['id'];
  readonly to: ApplicationCanonicalIdentity['id'];
  readonly relationship: string;
  readonly fact: 'declared' | 'derived';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationProviderResolutionPlan {
  readonly capabilities: readonly ApplicationProviderResolutionEntry[];
}

export interface ApplicationProviderResolutionEntry {
  readonly id: string;
  readonly requirementId: string;
  readonly consumer: ApplicationCanonicalIdentity['id'];
  readonly capability: { readonly interface: string; readonly qualifier?: string };
  readonly provider?: ApplicationCanonicalIdentity;
  readonly implementation?: string;
  readonly version?: string;
  readonly maturity: ApplicationProviderMaturity;
  readonly disposition: ApplicationProviderDisposition;
  readonly guarantees: readonly string[];
  readonly gaps: readonly string[];
  readonly externalResponsibilities: readonly string[];
  readonly fact: 'resolved' | 'unknown' | 'external';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPhysicalTopologyPlan {
  readonly nodes: readonly ApplicationPhysicalPlanNode[];
  readonly edges: readonly ApplicationPhysicalPlanEdge[];
  readonly nativePlans: readonly ApplicationNativePlanRecord[];
}

export interface ApplicationPhysicalPlanNode {
  readonly id: ApplicationCanonicalIdentity['id'];
  readonly deploymentNodeId: string;
  readonly kind: string;
  readonly provider: { readonly interface: string; readonly implementation: string; readonly version: string };
  readonly scope: { readonly connectionDigest: string; readonly namespace?: string };
  readonly lifecycle: {
    readonly ownership: 'application' | 'shared' | 'external';
    readonly intent: 'create' | 'adopt' | 'update' | 'replace' | 'retain' | 'delete' | 'external' | 'unknown';
  };
  readonly outputs: readonly { readonly name: string; readonly sensitivity: 'public' | 'sensitive'; readonly persistence: string }[];
  readonly fact: 'planned' | 'external' | 'unknown';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPhysicalPlanEdge {
  readonly id: string;
  readonly from: ApplicationCanonicalIdentity['id'];
  readonly to: ApplicationCanonicalIdentity['id'];
  readonly relationship: string;
  readonly output?: string;
  readonly fact: 'planned';
}

export interface ApplicationPlanDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly subjectId?: string;
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanEstimate {
  readonly id: string;
  readonly subjectId: string;
  readonly name: string;
  readonly value?: number | string;
  readonly unit?: string;
  readonly costClass?: 'none' | 'low' | 'medium' | 'high' | 'unknown';
  readonly assumptions: readonly string[];
  readonly fact: 'estimated' | 'unknown';
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationPlanEvidenceReference {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: 'static' | 'local-live' | 'target-live' | 'production-history' | 'reconciliation';
  readonly reference: string;
  readonly observedAt?: string;
  readonly fact: 'observed';
}

export interface ApplicationPlanValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ApplicationPlanDiagnostic[];
}

export type ApplicationPlanDiffCategory =
  | 'semantic'
  | 'execution'
  | 'dependency'
  | 'authority'
  | 'data-flow'
  | 'runtime-access'
  | 'provider'
  | 'physical'
  | 'security'
  | 'state'
  | 'exposure'
  | 'lifecycle'
  | 'observability'
  | 'maturity'
  | 'cost'
  | 'estimate'
  | 'native-plan'
  | 'diagnostic'
  | 'evidence'
  | 'provenance';

export interface ApplicationPlanDiffEntry {
  readonly id: string;
  readonly category: ApplicationPlanDiffCategory;
  readonly change: 'added' | 'removed' | 'changed';
  readonly action: 'create' | 'update' | 'replace' | 'delete';
  readonly severity: 'info' | 'warning' | 'destructive';
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ApplicationPlanDiff {
  readonly schemaVersion: 'applik8s.applicationPlanDiff/v1alpha1';
  readonly fromTarget: ApplicationCanonicalIdentity['id'];
  readonly toTarget: ApplicationCanonicalIdentity['id'];
  readonly sourceGraphVersion: ApplicationPlanSourceGraphVersion;
  readonly summary: {
    readonly create: number;
    readonly update: number;
    readonly replace: number;
    readonly delete: number;
    readonly noOp: number;
  };
  readonly entries: readonly ApplicationPlanDiffEntry[];
}

export class ApplicationPlanComparisonError extends TypeError {
  constructor(
    readonly code:
      | 'PLAN_COMPARISON_APPLICATION_MISMATCH'
      | 'PLAN_COMPARISON_GRAPH_VERSION_INCOMPATIBLE'
      | 'PLAN_COMPARISON_SCHEMA_INCOMPATIBLE',
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationPlanComparisonError';
  }
}

export function normalizeApplicationPlan(plan: ApplicationPlan): ApplicationPlan {
  return {
    ...plan,
    identities: sorted(plan.identities),
    semantic: {
      nodes: sorted(plan.semantic.nodes),
      edges: sorted(plan.semantic.edges),
      executions: sorted(plan.semantic.executions),
      authority: sorted(plan.semantic.authority),
      dataFlows: sorted(plan.semantic.dataFlows),
      state: sorted(plan.semantic.state),
      exposures: sorted(plan.semantic.exposures),
      observability: sorted(plan.semantic.observability),
      runtimeAccess: sorted(plan.semantic.runtimeAccess),
    },
    resolution: { capabilities: sorted(plan.resolution.capabilities) },
    physical: {
      nodes: sorted(plan.physical.nodes),
      edges: sorted(plan.physical.edges),
      nativePlans: sorted(plan.physical.nativePlans),
    },
    diagnostics: [...plan.diagnostics].sort((left, right) => compare(left.code, right.code) || compare(left.subjectId ?? '', right.subjectId ?? '') || compare(left.message, right.message)),
    estimates: sorted(plan.estimates),
    evidence: sorted(plan.evidence),
  };
}

export function serializeApplicationPlan(plan: ApplicationPlan): string {
  assertNoSensitivePlanData(plan);
  return `${canonicalJsonV1String(normalizeApplicationPlan(plan))}\n`;
}

/** Canonical identity material excludes generation and evidence timestamps. */
export function serializeApplicationPlanContent(plan: ApplicationPlan): string {
  assertNoSensitivePlanData(plan);
  const normalized = normalizeApplicationPlan(plan);
  const { generatedAt: _generatedAt, ...content } = normalized;
  return `${canonicalJsonV1String({
    ...content,
    evidence: normalized.evidence.map(({ observedAt: _observedAt, ...evidence }) => evidence),
  })}\n`;
}

export function renderApplicationPlanText(plan: ApplicationPlan): string {
  const normalized = normalizeApplicationPlan(plan);
  const unresolved = normalized.resolution.capabilities.filter(({ disposition }) => disposition === 'unresolved' || disposition === 'incompatible');
  const lines = [
    `Application: ${normalized.application.application}`,
    `Target: ${normalized.target.target} (${normalized.target.profile})`,
    `Semantic: ${normalized.semantic.nodes.length} nodes, ${normalized.semantic.edges.length} edges`,
    `Execution: ${normalized.semantic.executions.length} identities`,
    `Authority: ${normalized.semantic.authority.length} grants`,
    `Data flow: ${normalized.semantic.dataFlows.length} flows, ${normalized.semantic.state.length} state authorities`,
    `Providers: ${normalized.resolution.capabilities.length - unresolved.length} resolved, ${unresolved.length} unresolved/incompatible`,
    `Physical: ${normalized.physical.nodes.length} nodes, ${normalized.physical.nativePlans.length} native plan records`,
    `Runtime access: ${normalized.semantic.runtimeAccess.length} requirements`,
    `Diagnostics: ${normalized.diagnostics.filter(({ severity }) => severity === 'error').length} errors, ${normalized.diagnostics.filter(({ severity }) => severity === 'warning').length} warnings`,
  ];
  return `${lines.join('\n')}\n`;
}

export function validateApplicationPlan(plan: ApplicationPlan): ApplicationPlanValidationResult {
  const diagnostics: ApplicationPlanDiagnostic[] = [];
  if (plan.schemaVersion !== 'applik8s.applicationPlan/v1alpha1'
    || plan.sourceGraphVersion !== 'applik8s.appGraph/v1alpha1'
    || plan.application.kind !== 'application'
    || plan.target.identity.kind !== 'target') {
    diagnostics.push(planDiagnostic('error', 'PLAN_ENVELOPE_INVALID', 'Application plan has an invalid schema, application identity, or target identity.'));
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(plan.sourceDigest)) {
    diagnostics.push(planDiagnostic('error', 'PLAN_SOURCE_DIGEST_INVALID', 'Application plan sourceDigest must be a full sha256 digest.'));
  }
  const ids = new Set<string>();
  const canonicalIdentityIds = new Set<string>();
  for (const identity of plan.identities) {
    if (canonicalIdentityIds.has(identity.id)) diagnostics.push(planDiagnostic('error', 'PLAN_IDENTITY_COLLISION', `Canonical identity ${identity.id} is duplicated.`, identity.id));
    canonicalIdentityIds.add(identity.id);
  }
  if (!canonicalIdentityIds.has(plan.application.id) || !canonicalIdentityIds.has(plan.target.identity.id)) {
    diagnostics.push(planDiagnostic('error', 'PLAN_IDENTITY_MISSING', 'Application plan identity registry must contain its application and target identities.'));
  }
  for (const node of [...plan.semantic.nodes, ...plan.physical.nodes]) {
    if (!canonicalIdentityIds.has(node.id)) {
      diagnostics.push(planDiagnostic('error', 'PLAN_IDENTITY_MISSING', `Plan node ${node.id} has no canonical identity record.`, node.id, node.provenance));
    }
  }
  for (const resolution of plan.resolution.capabilities) {
    if (resolution.provider && !canonicalIdentityIds.has(resolution.provider.id)) {
      diagnostics.push(planDiagnostic('error', 'PLAN_IDENTITY_MISSING', `Provider resolution ${resolution.id} has no canonical provider identity record.`, resolution.id, resolution.provenance));
    }
  }
  for (const record of [
    ...plan.semantic.nodes,
    ...plan.semantic.edges,
    ...plan.semantic.executions,
    ...plan.semantic.authority,
    ...plan.semantic.dataFlows,
    ...plan.semantic.state,
    ...plan.semantic.exposures,
    ...plan.semantic.observability,
    ...plan.semantic.runtimeAccess,
    ...plan.resolution.capabilities,
    ...plan.physical.nodes,
    ...plan.physical.edges,
    ...plan.physical.nativePlans,
    ...diagnosticRecords(plan.diagnostics),
    ...plan.estimates,
    ...plan.evidence,
  ]) {
    if (!record.id || ids.has(record.id)) diagnostics.push(planDiagnostic('error', 'PLAN_IDENTITY_COLLISION', `Application plan identity ${record.id || '<empty>'} is empty or duplicated.`, record.id));
    ids.add(record.id);
  }
  for (const requirement of plan.semantic.runtimeAccess) {
    if (!canonicalIdentityIds.has(requirement.consumer.executionIdentity)) {
      diagnostics.push(planDiagnostic('error', 'PLAN_RUNTIME_ACCESS_IDENTITY_UNKNOWN', `Runtime-access requirement ${requirement.id} references unknown execution identity ${requirement.consumer.executionIdentity}.`, requirement.id, requirement.provenance));
    }
  }
  for (const resolution of plan.resolution.capabilities) {
    if (resolution.disposition === 'unresolved' || resolution.disposition === 'incompatible') {
      diagnostics.push(planDiagnostic('error', 'PLAN_PROVIDER_UNRESOLVED', `Required capability ${resolution.capability.interface} is ${resolution.disposition}.`, resolution.id, resolution.provenance));
    }
  }
  if (containsSensitiveValue(plan)) {
    diagnostics.push(planDiagnostic('error', 'PLAN_SENSITIVE_DATA', 'Application plan contains a credential-shaped key or value.'));
  }
  try {
    canonicalJsonV1String(normalizeApplicationPlan(plan));
  } catch {
    diagnostics.push(planDiagnostic('error', 'PLAN_CANONICAL_JSON_INVALID', 'Application plan contains a value outside Canonical JSON v1.'));
  }
  diagnostics.push(...plan.diagnostics.filter(({ severity }) => severity === 'error'));
  return { valid: diagnostics.length === 0, diagnostics };
}

export function diffApplicationPlans(before: ApplicationPlan, after: ApplicationPlan): ApplicationPlanDiff {
  assertComparablePlans(before, after);
  const entries = [
    ...diffRecords('semantic', before.semantic.nodes, after.semantic.nodes),
    ...diffRecords('dependency', before.semantic.edges, after.semantic.edges),
    ...diffRecords('execution', before.semantic.executions, after.semantic.executions),
    ...securitySensitiveDiff('authority', before.semantic.authority, after.semantic.authority),
    ...diffRecords('data-flow', before.semantic.dataFlows, after.semantic.dataFlows),
    ...diffRecords('state', before.semantic.state, after.semantic.state),
    ...securitySensitiveDiff('exposure', before.semantic.exposures, after.semantic.exposures),
    ...diffRecords('observability', before.semantic.observability, after.semantic.observability),
    ...diffProviderRecords(before.resolution.capabilities, after.resolution.capabilities),
    ...diffPhysicalRecords(before.physical.nodes, after.physical.nodes),
    ...diffRecords('dependency', before.physical.edges, after.physical.edges),
    ...diffRecords('native-plan', before.physical.nativePlans, after.physical.nativePlans),
    ...securitySensitiveDiff('runtime-access', before.semantic.runtimeAccess, after.semantic.runtimeAccess),
    ...diffRecords('diagnostic', diagnosticRecords(before.diagnostics), diagnosticRecords(after.diagnostics)),
    ...diffRecords('estimate', before.estimates, after.estimates),
    ...diffRecords('evidence', before.evidence, after.evidence),
  ].sort((left, right) => compare(left.id, right.id));
  const changedIds = new Set(entries.map(({ id }) => id));
  const allIds = new Set([
    ...planDiffRecordIds(before),
    ...planDiffRecordIds(after),
  ]);
  return {
    schemaVersion: 'applik8s.applicationPlanDiff/v1alpha1',
    fromTarget: before.target.identity.id,
    toTarget: after.target.identity.id,
    sourceGraphVersion: before.sourceGraphVersion,
    summary: {
      create: entries.filter(({ action }) => action === 'create').length,
      update: entries.filter(({ action }) => action === 'update').length,
      replace: entries.filter(({ action }) => action === 'replace').length,
      delete: entries.filter(({ action }) => action === 'delete').length,
      noOp: [...allIds].filter((id) => !changedIds.has(id)).length,
    },
    entries,
  };
}

function securitySensitiveDiff(
  category: 'authority' | 'exposure' | 'runtime-access',
  before: readonly { readonly id: string }[],
  after: readonly { readonly id: string }[],
): ApplicationPlanDiffEntry[] {
  return diffRecords(category, before, after).map((entry) => ({
    ...entry,
    severity: entry.change === 'removed' ? 'info' : 'warning',
  }));
}

export function renderApplicationPlanGraph(plan: ApplicationPlan): string {
  const normalized = normalizeApplicationPlan(plan);
  const lines = ['flowchart LR'];
  for (const node of normalized.semantic.nodes) {
    lines.push(`  ${graphIdentifier(node.id)}[${JSON.stringify(`${node.kind}: ${node.name}`)}]`);
  }
  for (const edge of normalized.semantic.edges) {
    lines.push(`  ${graphIdentifier(edge.from)} -->|${JSON.stringify(edge.relationship)}| ${graphIdentifier(edge.to)}`);
  }
  for (const resolution of normalized.resolution.capabilities) {
    if (!resolution.provider) continue;
    const provider = graphIdentifier(resolution.provider.id);
    lines.push(`  ${provider}[${JSON.stringify(`provider: ${resolution.implementation ?? resolution.capability.interface}`)}]`);
    lines.push(`  ${graphIdentifier(resolution.consumer)} -.->|${JSON.stringify(resolution.capability.interface)}| ${provider}`);
  }
  return `${lines.join('\n')}\n`;
}

function diffProviderRecords(
  before: readonly ApplicationProviderResolutionEntry[],
  after: readonly ApplicationProviderResolutionEntry[],
): ApplicationPlanDiffEntry[] {
  const entries = diffRecords('provider', before, after);
  return entries.map((entry) => {
    if (entry.change !== 'changed' || !entry.before || !entry.after) return entry;
    const previous = entry.before as ApplicationProviderResolutionEntry;
    const next = entry.after as ApplicationProviderResolutionEntry;
    const { maturity: _previousMaturity, ...previousRest } = previous;
    const { maturity: _nextMaturity, ...nextRest } = next;
    return canonicalJsonV1String(previousRest) === canonicalJsonV1String(nextRest)
      ? { ...entry, category: 'maturity' }
      : entry;
  });
}

function diffPhysicalRecords(
  before: readonly ApplicationPhysicalPlanNode[],
  after: readonly ApplicationPhysicalPlanNode[],
): ApplicationPlanDiffEntry[] {
  return diffRecords('physical', before, after).map((entry) => {
    if (entry.change !== 'changed' || !entry.before || !entry.after) return entry;
    const previous = entry.before as ApplicationPhysicalPlanNode;
    const next = entry.after as ApplicationPhysicalPlanNode;
    if (canonicalJsonV1String(previous.lifecycle) !== canonicalJsonV1String(next.lifecycle)) {
      return {
        ...entry,
        category: 'lifecycle',
        action: next.lifecycle.intent === 'replace' ? 'replace' : entry.action,
        severity: next.lifecycle.intent === 'delete' || next.lifecycle.intent === 'replace' ? 'destructive' : 'warning',
      };
    }
    return entry;
  });
}

export function providerGuaranteeFor(
  manifests: readonly ApplicationProviderGuaranteeManifest[],
  providerId: ApplicationCanonicalIdentity['id'],
): ApplicationProviderGuaranteeManifest | undefined {
  return manifests.find(({ provider }) => provider.id === providerId);
}

function diffRecords(category: ApplicationPlanDiffCategory, before: readonly { readonly id: string }[], after: readonly { readonly id: string }[]): ApplicationPlanDiffEntry[] {
  const left = new Map(before.map((entry) => [entry.id, entry]));
  const right = new Map(after.map((entry) => [entry.id, entry]));
  const entries: ApplicationPlanDiffEntry[] = [];
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const previous = left.get(id);
    const next = right.get(id);
    if (!previous) entries.push({ id, category, change: 'added', action: 'create', severity: category === 'security' ? 'warning' : 'info', after: next });
    else if (!next) entries.push({ id, category, change: 'removed', action: 'delete', severity: category === 'physical' ? 'destructive' : 'warning', before: previous });
    else if (canonicalJsonV1String(previous) !== canonicalJsonV1String(next)) {
      const previousWithoutProvenance = withoutProvenance(previous);
      const nextWithoutProvenance = withoutProvenance(next);
      entries.push({
        id,
        category: canonicalJsonV1String(previousWithoutProvenance) === canonicalJsonV1String(nextWithoutProvenance) ? 'provenance' : category,
        change: 'changed',
        action: 'update',
        severity: category === 'physical' ? 'warning' : 'info',
        before: previous,
        after: next,
      });
    }
  }
  return entries;
}

function withoutProvenance<T extends { readonly id: string }>(record: T): Omit<T, 'provenance'> {
  const { provenance: _provenance, ...rest } = record as T & { readonly provenance?: unknown };
  return rest;
}

function sorted<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((left, right) => compare(left.id, right.id));
}

function containsSensitiveValue(value: unknown, key = ''): boolean {
  if (/(?:password|bearer|private[-_]?key|secretValue|accessToken|apiKey|email|phone|socialSecurityNumber|ssn)$/i.test(key)) return true;
  if (typeof value === 'string') return /^(?:Bearer\s+|sk-[A-Za-z0-9]|AKIA[A-Z0-9])/.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry));
  if (value && typeof value === 'object') return Object.entries(value).some(([entryKey, entry]) => containsSensitiveValue(entry, entryKey));
  return false;
}

function assertComparablePlans(before: ApplicationPlan, after: ApplicationPlan): void {
  if (before.schemaVersion !== after.schemaVersion || before.schemaVersion !== 'applik8s.applicationPlan/v1alpha1') {
    throw new ApplicationPlanComparisonError('PLAN_COMPARISON_SCHEMA_INCOMPATIBLE', `Cannot compare ApplicationPlan schemas ${before.schemaVersion} and ${after.schemaVersion}.`);
  }
  if (before.sourceGraphVersion !== after.sourceGraphVersion || before.sourceGraphVersion !== 'applik8s.appGraph/v1alpha1') {
    throw new ApplicationPlanComparisonError('PLAN_COMPARISON_GRAPH_VERSION_INCOMPATIBLE', `Cannot compare application graph schemas ${before.sourceGraphVersion} and ${after.sourceGraphVersion}.`);
  }
  if (before.application.id !== after.application.id) {
    throw new ApplicationPlanComparisonError('PLAN_COMPARISON_APPLICATION_MISMATCH', `Cannot compare plans for ${before.application.id} and ${after.application.id}.`);
  }
}

function diagnosticRecords(diagnostics: readonly ApplicationPlanDiagnostic[]): readonly (ApplicationPlanDiagnostic & { readonly id: string })[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    id: `diagnostic:${lengthPrefixed([diagnostic.code, diagnostic.subjectId ?? '', diagnostic.message])}`,
  }));
}

function lengthPrefixed(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

function planDiffRecordIds(plan: ApplicationPlan): readonly string[] {
  return [
    ...plan.semantic.nodes,
    ...plan.semantic.edges,
    ...plan.semantic.executions,
    ...plan.semantic.authority,
    ...plan.semantic.dataFlows,
    ...plan.semantic.state,
    ...plan.semantic.exposures,
    ...plan.semantic.observability,
    ...plan.semantic.runtimeAccess,
    ...plan.resolution.capabilities,
    ...plan.physical.nodes,
    ...plan.physical.edges,
    ...plan.physical.nativePlans,
    ...diagnosticRecords(plan.diagnostics),
    ...plan.estimates,
    ...plan.evidence,
  ].map(({ id }) => id);
}

function assertNoSensitivePlanData(plan: ApplicationPlan): void {
  if (containsSensitiveValue(plan)) {
    throw new Error('PLAN_SENSITIVE_DATA: Application plan contains a credential-shaped key or value and cannot be serialized.');
  }
}

function planDiagnostic(severity: ApplicationPlanDiagnostic['severity'], code: string, message: string, subjectId?: string, provenance: readonly ApplicationSourceProvenance[] = []): ApplicationPlanDiagnostic {
  return { severity, code, message, ...(subjectId ? { subjectId } : {}), provenance };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function graphIdentifier(value: string): string {
  let hash = 2166136261;
  for (const code of new TextEncoder().encode(value)) {
    hash ^= code;
    hash = Math.imul(hash, 16777619);
  }
  return `n${(hash >>> 0).toString(16)}`;
}
