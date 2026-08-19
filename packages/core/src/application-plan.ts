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

export type ApplicationPlanSchemaVersion = 'applik8s.applicationPlan/v1alpha1';
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
  readonly runtimeAccess: readonly ApplicationRuntimeAccessRequirement[];
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
  | 'provider'
  | 'physical'
  | 'security'
  | 'state'
  | 'exposure'
  | 'maturity'
  | 'cost'
  | 'estimate';

export interface ApplicationPlanDiffEntry {
  readonly id: string;
  readonly category: ApplicationPlanDiffCategory;
  readonly change: 'added' | 'removed' | 'changed';
  readonly severity: 'info' | 'warning' | 'destructive';
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ApplicationPlanDiff {
  readonly schemaVersion: 'applik8s.applicationPlanDiff/v1alpha1';
  readonly fromTarget: ApplicationCanonicalIdentity['id'];
  readonly toTarget: ApplicationCanonicalIdentity['id'];
  readonly entries: readonly ApplicationPlanDiffEntry[];
}

export function normalizeApplicationPlan(plan: ApplicationPlan): ApplicationPlan {
  return {
    ...plan,
    identities: sorted(plan.identities),
    semantic: {
      nodes: sorted(plan.semantic.nodes),
      edges: sorted(plan.semantic.edges),
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
  return `${stableJson(normalizeApplicationPlan(plan))}\n`;
}

/** Canonical identity material excludes generation and evidence timestamps. */
export function serializeApplicationPlanContent(plan: ApplicationPlan): string {
  const normalized = normalizeApplicationPlan(plan);
  return `${stableJson({
    ...normalized,
    generatedAt: undefined,
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
    `Providers: ${normalized.resolution.capabilities.length - unresolved.length} resolved, ${unresolved.length} unresolved/incompatible`,
    `Physical: ${normalized.physical.nodes.length} nodes, ${normalized.physical.nativePlans.length} native plan records`,
    `Runtime access: ${normalized.semantic.runtimeAccess.length} requirements`,
    `Diagnostics: ${normalized.diagnostics.filter(({ severity }) => severity === 'error').length} errors, ${normalized.diagnostics.filter(({ severity }) => severity === 'warning').length} warnings`,
  ];
  return `${lines.join('\n')}\n`;
}

export function validateApplicationPlan(plan: ApplicationPlan): ApplicationPlanValidationResult {
  const diagnostics: ApplicationPlanDiagnostic[] = [];
  if (plan.schemaVersion !== 'applik8s.applicationPlan/v1alpha1' || plan.application.kind !== 'application' || plan.target.identity.kind !== 'target') {
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
  for (const record of [...plan.semantic.nodes, ...plan.semantic.edges, ...plan.resolution.capabilities, ...plan.physical.nodes, ...plan.physical.edges, ...plan.physical.nativePlans, ...plan.estimates, ...plan.evidence]) {
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
  diagnostics.push(...plan.diagnostics.filter(({ severity }) => severity === 'error'));
  return { valid: diagnostics.length === 0, diagnostics };
}

export function diffApplicationPlans(before: ApplicationPlan, after: ApplicationPlan): ApplicationPlanDiff {
  const entries = [
    ...diffRecords('semantic', before.semantic.nodes, after.semantic.nodes),
    ...diffProviderRecords(before.resolution.capabilities, after.resolution.capabilities),
    ...diffRecords('physical', before.physical.nodes, after.physical.nodes),
    ...diffRecords('security', before.semantic.runtimeAccess, after.semantic.runtimeAccess),
    ...diffRecords('estimate', before.estimates, after.estimates),
  ].sort((left, right) => compare(left.id, right.id));
  return {
    schemaVersion: 'applik8s.applicationPlanDiff/v1alpha1',
    fromTarget: before.target.identity.id,
    toTarget: after.target.identity.id,
    entries,
  };
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
    return stableJson(previousRest) === stableJson(nextRest)
      ? { ...entry, category: 'maturity' }
      : entry;
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
    if (!previous) entries.push({ id, category, change: 'added', severity: category === 'security' ? 'warning' : 'info', after: next });
    else if (!next) entries.push({ id, category, change: 'removed', severity: category === 'physical' ? 'destructive' : 'warning', before: previous });
    else if (stableJson(previous) !== stableJson(next)) entries.push({ id, category, change: 'changed', severity: category === 'physical' ? 'warning' : 'info', before: previous, after: next });
  }
  return entries;
}

function sorted<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((left, right) => compare(left.id, right.id));
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compare(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

function containsSensitiveValue(value: unknown, key = ''): boolean {
  if (/(?:password|bearer|private[-_]?key|secretValue|accessToken|apiKey)$/i.test(key)) return true;
  if (typeof value === 'string') return /^(?:Bearer\s+|sk-[A-Za-z0-9]|AKIA[A-Z0-9])/.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry));
  if (value && typeof value === 'object') return Object.entries(value).some(([entryKey, entry]) => containsSensitiveValue(entry, entryKey));
  return false;
}

function planDiagnostic(severity: ApplicationPlanDiagnostic['severity'], code: string, message: string, subjectId?: string, provenance: readonly ApplicationSourceProvenance[] = []): ApplicationPlanDiagnostic {
  return { severity, code, message, ...(subjectId ? { subjectId } : {}), provenance };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
