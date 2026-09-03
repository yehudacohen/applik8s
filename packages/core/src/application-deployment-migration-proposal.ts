// typecast-file-boundary: Migration proposal decoding validates versioned persisted JSON before restoring its closed plan types.
import type { ApplicationSourceProvenance } from './application-foundation.js';
import type {
  ApplicationCapabilityImplementationIdentity,
  ApplicationCapabilityReference,
} from './application-implementation-plan.js';
import { canonicalJsonV1String } from './canonical-json.js';

export const applicationDeploymentMigrationProposalVersion = 'applik8s.deploymentMigrationProposal/v1alpha1' as const;

export interface ApplicationDeploymentMigrationBaseline {
  readonly release: string;
  readonly gitTag: string;
  readonly commit: string;
  readonly applicationArtifactSchema: string;
  readonly applicationPlanSchema: string;
  readonly providerCatalogDigest: string;
  readonly runtimeProtocolVersions: readonly string[];
  readonly evidenceManifestDigest: string;
}

export interface ApplicationDeploymentMigrationSource {
  readonly baseline: ApplicationDeploymentMigrationBaseline;
  readonly application: string;
  readonly deploymentStateIdentity: string;
  readonly applicationArtifactDigest: string;
  readonly planDigest: string;
}

export interface ApplicationDeploymentMigrationTarget {
  readonly release: string;
  readonly application: string;
  readonly profile: string;
  readonly applicationArtifactDigest: string;
  readonly applicationPlanSchema: string;
  readonly providerCatalogDigest: string;
  readonly planDigest: string;
}

export type ApplicationPhysicalIdentity =
  | {
      readonly domain: 'kubernetes';
      readonly cluster: string;
      readonly group: string;
      readonly kind: string;
      readonly namespace?: string;
      readonly name: string;
    }
  | {
      readonly domain: 'aws';
      readonly account: string;
      readonly region: string;
      readonly resourceType: string;
      readonly resourceId: string;
    }
  | {
      readonly domain: 'external';
      readonly provider: string;
      readonly scope: string;
      readonly bindingDigest: string;
    }
  | {
      readonly domain: 'provider';
      readonly provider: string;
      readonly scope: string;
      readonly resourceType: string;
      readonly resourceId: string;
    };

export type ApplicationMigrationLifecycle = 'application' | 'shared' | 'external' | 'retained';

export interface ApplicationLegacyDeploymentNode {
  readonly id: string;
  readonly semanticRequirement?: string;
  readonly capability: ApplicationCapabilityReference;
  readonly implementation: string;
  readonly providerContract: string;
  readonly physicalIdentity?: ApplicationPhysicalIdentity;
  readonly lifecycle: ApplicationMigrationLifecycle;
  readonly stateSchema: string;
  readonly guarantees: readonly string[];
  readonly retention?: string;
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationTargetDeploymentNode {
  readonly id: string;
  readonly semanticRequirement: string;
  readonly implementation: ApplicationCapabilityImplementationIdentity;
  readonly providerContract: string;
  readonly physicalIdentity?: ApplicationPhysicalIdentity;
  readonly lifecycle: ApplicationMigrationLifecycle;
  readonly stateSchema: string;
  readonly guarantees: readonly string[];
  readonly retention?: string;
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export type ApplicationDeploymentMigrationDisposition =
  | 'preserve'
  | 'adopt'
  | 'replace'
  | 'retire'
  | 'retain'
  | 'external';

export interface ApplicationDeploymentMigrationDirective {
  readonly sourceNode: string;
  readonly targetNode?: string;
  readonly disposition: Exclude<ApplicationDeploymentMigrationDisposition, 'preserve'>;
  readonly reason: string;
  readonly providerMigration?: string;
  readonly compatibilityReceipts?: readonly string[];
}

export interface ApplicationDeploymentMigrationInput {
  readonly source: ApplicationDeploymentMigrationSource;
  readonly target: ApplicationDeploymentMigrationTarget;
  /** The exact codec accepted by this process; it must equal the source record. */
  readonly acceptedBaseline: ApplicationDeploymentMigrationBaseline;
  readonly sourceNodes: readonly ApplicationLegacyDeploymentNode[];
  readonly targetNodes: readonly ApplicationTargetDeploymentNode[];
  readonly directives?: readonly ApplicationDeploymentMigrationDirective[];
}

export interface ApplicationMigrationLifecycleTransferPlan {
  readonly mode: 'none' | 'fenced-handoff' | 'migration-exclusive';
  readonly sourceAuthority: 'legacy-deployment' | 'external' | 'shared-owner' | 'retained-owner';
  readonly targetAuthority: 'target-deployment' | 'external' | 'shared-owner' | 'retained-owner' | 'none';
  readonly requiresSourceFence: boolean;
  readonly requiresPhysicalIdentityReread: boolean;
  readonly commitFrontier: 'target-authorized' | 'target-ready' | 'retirement-complete' | 'not-applicable';
}

export interface ApplicationDeploymentMigrationMapping {
  readonly id: string;
  readonly sourceNode: string;
  readonly targetSemanticRequirement?: string;
  readonly targetNode?: string;
  readonly targetImplementation?: string;
  readonly sourcePhysicalIdentity?: ApplicationPhysicalIdentity;
  readonly targetPhysicalIdentity?: ApplicationPhysicalIdentity;
  readonly disposition: ApplicationDeploymentMigrationDisposition;
  readonly lifecycleTransfer: ApplicationMigrationLifecycleTransferPlan;
  readonly compatibility: readonly string[];
  readonly provenance: readonly ApplicationSourceProvenance[];
  readonly consequences: readonly string[];
}

export interface ApplicationDeploymentMigrationDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'MIGRATION_SOURCE_RELEASE_UNQUALIFIED'
    | 'MIGRATION_SOURCE_SCHEMA_UNSUPPORTED'
    | 'MIGRATION_SOURCE_STATE_MISSING'
    | 'MIGRATION_MAPPING_AMBIGUOUS'
    | 'MIGRATION_PHYSICAL_IDENTITY_CONFLICT'
    | 'MIGRATION_PROVIDER_INCOMPATIBLE'
    | 'MIGRATION_LIFECYCLE_TRANSFER_UNSAFE'
    | 'MIGRATION_RETAINED_DATA_UNSAFE'
    | 'MIGRATION_SHARED_OWNER_BLOCKED';
  readonly message: string;
  readonly sourceNode?: string;
  readonly targetNode?: string;
  readonly provenance: readonly ApplicationSourceProvenance[];
}

export interface ApplicationDeploymentMigrationProposal {
  readonly schemaVersion: typeof applicationDeploymentMigrationProposalVersion;
  readonly mode: 'read-only';
  readonly source: ApplicationDeploymentMigrationSource;
  readonly target: ApplicationDeploymentMigrationTarget;
  readonly mappings: readonly ApplicationDeploymentMigrationMapping[];
  readonly diagnostics: readonly ApplicationDeploymentMigrationDiagnostic[];
  readonly status: 'ready' | 'blocked';
  readonly mutationAuthorized: false;
}

export class ApplicationDeploymentMigrationProposalError extends Error {
  constructor(
    readonly code: ApplicationDeploymentMigrationDiagnostic['code'],
    message: string,
    readonly sourceNode?: string,
    readonly targetNode?: string,
  ) {
    super(message);
    this.name = 'ApplicationDeploymentMigrationProposalError';
  }
}

/**
 * Produces a deterministic migration proposal without reading or mutating a
 * provider. A blocked proposal is evidence, never permission to continue.
 */
export function proposeApplicationDeploymentMigration(
  input: ApplicationDeploymentMigrationInput,
): ApplicationDeploymentMigrationProposal {
  validateInputIdentity(input);
  const diagnostics: ApplicationDeploymentMigrationDiagnostic[] = [];
  const sourceNodes = uniqueById(input.sourceNodes, 'source', diagnostics);
  const targetNodes = uniqueById(input.targetNodes, 'target', diagnostics);
  for (const target of targetNodes.values()) validateTargetNode(target, diagnostics);
  const directives = directivesBySource(input.directives ?? [], sourceNodes, targetNodes, diagnostics);
  const targetByRequirement = indexTargetsByRequirement(targetNodes);
  const claimedTargetNodes = new Map<string, string>();
  const mappings: ApplicationDeploymentMigrationMapping[] = [];

  for (const source of [...sourceNodes.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    validateLegacyNode(source, diagnostics);
    const directive = directives.get(source.id);
    const candidates = directive?.targetNode
      ? compact([targetNodes.get(directive.targetNode)])
      : source.semanticRequirement
        ? targetByRequirement.get(source.semanticRequirement) ?? []
        : [];
    const mapping = mapSourceNode(source, candidates, directive, diagnostics);
    if (!mapping) continue;
    if (mapping.targetNode) {
      const previous = claimedTargetNodes.get(mapping.targetNode);
      if (previous && previous !== source.id) {
        diagnostics.push(diagnostic(
          'MIGRATION_MAPPING_AMBIGUOUS',
          `Target node ${mapping.targetNode} is claimed by source nodes ${previous} and ${source.id}.`,
          source.provenance,
          source.id,
          mapping.targetNode,
        ));
        continue;
      }
      claimedTargetNodes.set(mapping.targetNode, source.id);
    }
    mappings.push(mapping);
  }

  const orderedDiagnostics = diagnostics.sort(compareDiagnostic);
  return Object.freeze({
    schemaVersion: applicationDeploymentMigrationProposalVersion,
    mode: 'read-only',
    source: snapshotSource(input.source),
    target: { ...input.target },
    mappings: mappings.sort((left, right) => left.sourceNode.localeCompare(right.sourceNode)),
    diagnostics: orderedDiagnostics,
    status: orderedDiagnostics.some(({ severity }) => severity === 'error') ? 'blocked' : 'ready',
    mutationAuthorized: false,
  });
}

export function applicationPhysicalIdentityKey(identity: ApplicationPhysicalIdentity): string {
  validatePhysicalIdentity(identity);
  return canonicalJsonV1String(identity);
}

export function serializeApplicationDeploymentMigrationProposal(
  proposal: ApplicationDeploymentMigrationProposal,
): string {
  return canonicalJsonV1String(proposal);
}

function mapSourceNode(
  source: ApplicationLegacyDeploymentNode,
  candidates: readonly ApplicationTargetDeploymentNode[],
  directive: ApplicationDeploymentMigrationDirective | undefined,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): ApplicationDeploymentMigrationMapping | undefined {
  if (directive) return mapDirective(source, candidates, directive, diagnostics);
  if (!source.semanticRequirement) {
    diagnostics.push(diagnostic(
      'MIGRATION_MAPPING_AMBIGUOUS',
      `Source node ${source.id} has no semantic requirement and requires an explicit disposition.`,
      source.provenance,
      source.id,
    ));
    return undefined;
  }
  if (candidates.length !== 1) {
    diagnostics.push(diagnostic(
      'MIGRATION_MAPPING_AMBIGUOUS',
      candidates.length === 0
        ? `Source node ${source.id} has no target for semantic requirement ${source.semanticRequirement}.`
        : `Source node ${source.id} has ${candidates.length} targets for semantic requirement ${source.semanticRequirement}.`,
      source.provenance,
      source.id,
    ));
    return undefined;
  }
  const target = candidates[0];
  if (!target) return undefined;
  if (!compatibleProvider(source, target, diagnostics)) return undefined;
  if (!samePhysicalIdentity(source.physicalIdentity, target.physicalIdentity)) {
    diagnostics.push(diagnostic(
      'MIGRATION_PHYSICAL_IDENTITY_CONFLICT',
      `Source node ${source.id} and target node ${target.id} do not have the same canonical physical identity; replacement requires an explicit provider migration.`,
      [...source.provenance, ...target.provenance],
      source.id,
      target.id,
    ));
    return undefined;
  }
  if (!compatibleLifecycle(source, target, diagnostics)) return undefined;
  return mapping(source, target, 'preserve', [], [], lifecycleTransfer(source, target, 'preserve'));
}

function mapDirective(
  source: ApplicationLegacyDeploymentNode,
  candidates: readonly ApplicationTargetDeploymentNode[],
  directive: ApplicationDeploymentMigrationDirective,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): ApplicationDeploymentMigrationMapping | undefined {
  const target = candidates[0];
  if (directive.targetNode && !target) return undefined;
  const compatibility = [...new Set(directive.compatibilityReceipts ?? [])].sort();
  const consequences: string[] = [];
  switch (directive.disposition) {
    case 'replace': {
      if (!target || !directive.providerMigration?.trim()) {
        diagnostics.push(diagnostic(
          'MIGRATION_PROVIDER_INCOMPATIBLE',
          `Replacement of ${source.id} requires a target node and qualified provider migration.`,
          source.provenance,
          source.id,
          target?.id,
        ));
        return undefined;
      }
      consequences.push('physical identity changes', 'provider readiness is the commit frontier');
      if (source.lifecycle === 'retained' || source.retention) consequences.push('retained data requires provider-qualified transfer');
      return mapping(source, target, 'replace', compatibility, consequences, lifecycleTransfer(source, target, 'replace'));
    }
    case 'adopt': {
      if (!target || source.lifecycle !== 'application' || target.lifecycle !== 'application') {
        diagnostics.push(diagnostic(
          'MIGRATION_LIFECYCLE_TRANSFER_UNSAFE',
          `Adoption of ${source.id} is allowed only between application-owned source and target nodes.`,
          source.provenance,
          source.id,
          target?.id,
        ));
        return undefined;
      }
      if (!samePhysicalIdentity(source.physicalIdentity, target.physicalIdentity) || compatibility.length === 0) {
        diagnostics.push(diagnostic(
          'MIGRATION_PHYSICAL_IDENTITY_CONFLICT',
          `Adoption of ${source.id} requires equal canonical physical identity and a compatibility receipt.`,
          source.provenance,
          source.id,
          target.id,
        ));
        return undefined;
      }
      return mapping(source, target, 'adopt', compatibility, [], lifecycleTransfer(source, target, 'adopt'));
    }
    case 'retire': {
      if (target) {
        diagnostics.push(diagnostic('MIGRATION_MAPPING_AMBIGUOUS', `Retired source node ${source.id} cannot name a target.`, source.provenance, source.id, target.id));
        return undefined;
      }
      if (source.lifecycle !== 'application') {
        diagnostics.push(diagnostic('MIGRATION_LIFECYCLE_TRANSFER_UNSAFE', `Only application-owned source node ${source.id} may be retired.`, source.provenance, source.id));
        return undefined;
      }
      consequences.push('legacy physical resource is removed before migration completion');
      return mapping(source, undefined, 'retire', compatibility, consequences, lifecycleTransfer(source, undefined, 'retire'));
    }
    case 'retain': {
      if (target || (source.lifecycle !== 'retained' && !source.retention)) {
        diagnostics.push(diagnostic('MIGRATION_RETAINED_DATA_UNSAFE', `Retained source node ${source.id} must already have an explicit retention contract and no target owner.`, source.provenance, source.id, target?.id));
        return undefined;
      }
      return mapping(source, undefined, 'retain', compatibility, ['resource remains under its retained owner'], lifecycleTransfer(source, undefined, 'retain'));
    }
    case 'external': {
      if (target && target.lifecycle !== 'external') {
        diagnostics.push(diagnostic('MIGRATION_LIFECYCLE_TRANSFER_UNSAFE', `External source node ${source.id} cannot map to application-owned target ${target.id}.`, source.provenance, source.id, target.id));
        return undefined;
      }
      if (source.lifecycle !== 'external') {
        diagnostics.push(diagnostic('MIGRATION_LIFECYCLE_TRANSFER_UNSAFE', `Source node ${source.id} is not externally owned.`, source.provenance, source.id, target?.id));
        return undefined;
      }
      return mapping(source, target, 'external', compatibility, [], lifecycleTransfer(source, target, 'external'));
    }
  }
}

function mapping(
  source: ApplicationLegacyDeploymentNode,
  target: ApplicationTargetDeploymentNode | undefined,
  disposition: ApplicationDeploymentMigrationDisposition,
  compatibility: readonly string[],
  consequences: readonly string[],
  transfer: ApplicationMigrationLifecycleTransferPlan,
): ApplicationDeploymentMigrationMapping {
  return {
    id: `migration:${source.id}`,
    sourceNode: source.id,
    ...(target ? {
      targetSemanticRequirement: target.semanticRequirement,
      targetNode: target.id,
      targetImplementation: target.implementation.canonical.id,
    } : {}),
    ...(source.physicalIdentity ? { sourcePhysicalIdentity: source.physicalIdentity } : {}),
    ...(target?.physicalIdentity ? { targetPhysicalIdentity: target.physicalIdentity } : {}),
    disposition,
    lifecycleTransfer: transfer,
    compatibility: [...compatibility].sort(),
    provenance: [...source.provenance, ...(target?.provenance ?? [])],
    consequences: [...consequences],
  };
}

function lifecycleTransfer(
  source: ApplicationLegacyDeploymentNode,
  target: ApplicationTargetDeploymentNode | undefined,
  disposition: ApplicationDeploymentMigrationDisposition,
): ApplicationMigrationLifecycleTransferPlan {
  if (disposition === 'replace') {
    return { mode: 'migration-exclusive', sourceAuthority: 'legacy-deployment', targetAuthority: 'target-deployment', requiresSourceFence: true, requiresPhysicalIdentityReread: true, commitFrontier: 'target-ready' };
  }
  if (disposition === 'retire') {
    return { mode: 'migration-exclusive', sourceAuthority: 'legacy-deployment', targetAuthority: 'none', requiresSourceFence: true, requiresPhysicalIdentityReread: true, commitFrontier: 'retirement-complete' };
  }
  if (disposition === 'external' || source.lifecycle === 'external') {
    return { mode: 'none', sourceAuthority: 'external', targetAuthority: 'external', requiresSourceFence: false, requiresPhysicalIdentityReread: false, commitFrontier: 'not-applicable' };
  }
  if (disposition === 'retain' || source.lifecycle === 'retained') {
    return { mode: 'none', sourceAuthority: 'retained-owner', targetAuthority: 'retained-owner', requiresSourceFence: false, requiresPhysicalIdentityReread: false, commitFrontier: 'not-applicable' };
  }
  if (source.lifecycle === 'shared' || target?.lifecycle === 'shared') {
    return { mode: 'none', sourceAuthority: 'shared-owner', targetAuthority: 'shared-owner', requiresSourceFence: false, requiresPhysicalIdentityReread: true, commitFrontier: 'not-applicable' };
  }
  return { mode: 'fenced-handoff', sourceAuthority: 'legacy-deployment', targetAuthority: 'target-deployment', requiresSourceFence: true, requiresPhysicalIdentityReread: true, commitFrontier: 'target-authorized' };
}

function compatibleProvider(
  source: ApplicationLegacyDeploymentNode,
  target: ApplicationTargetDeploymentNode,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): boolean {
  const missingGuarantees = source.guarantees.filter((guarantee) => !target.guarantees.includes(guarantee));
  if (source.providerContract === target.providerContract && source.stateSchema === target.stateSchema && missingGuarantees.length === 0) return true;
  diagnostics.push(diagnostic(
    'MIGRATION_PROVIDER_INCOMPATIBLE',
    `Source node ${source.id} and target node ${target.id} differ in provider contract, state schema, or required guarantees (${missingGuarantees.join(', ') || 'none missing'}).`,
    [...source.provenance, ...target.provenance],
    source.id,
    target.id,
  ));
  return false;
}

function compatibleLifecycle(
  source: ApplicationLegacyDeploymentNode,
  target: ApplicationTargetDeploymentNode,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): boolean {
  if (source.lifecycle === target.lifecycle && source.retention === target.retention) return true;
  const code = source.lifecycle === 'retained' || target.lifecycle === 'retained'
    ? 'MIGRATION_RETAINED_DATA_UNSAFE'
    : source.lifecycle === 'shared' || target.lifecycle === 'shared'
      ? 'MIGRATION_SHARED_OWNER_BLOCKED'
      : 'MIGRATION_LIFECYCLE_TRANSFER_UNSAFE';
  diagnostics.push(diagnostic(
    code,
    `Source node ${source.id} lifecycle ${source.lifecycle} is not compatible with target node ${target.id} lifecycle ${target.lifecycle}.`,
    [...source.provenance, ...target.provenance],
    source.id,
    target.id,
  ));
  return false;
}

function validateInputIdentity(input: ApplicationDeploymentMigrationInput): void {
  requireText(input.source.application, 'migration source application');
  requireText(input.target.application, 'migration target application');
  if (input.source.application !== input.target.application) {
    throw new ApplicationDeploymentMigrationProposalError('MIGRATION_SOURCE_STATE_MISSING', 'Source and target application identities differ.');
  }
  validateBaseline(input.source.baseline);
  validateBaseline(input.acceptedBaseline);
  if (canonicalJsonV1String(input.source.baseline) !== canonicalJsonV1String(input.acceptedBaseline)) {
    throw new ApplicationDeploymentMigrationProposalError('MIGRATION_SOURCE_RELEASE_UNQUALIFIED', 'Source baseline does not equal the loaded migration codec baseline.');
  }
  requireDigest(input.source.applicationArtifactDigest, 'source application artifact digest');
  requireDigest(input.source.planDigest, 'source plan digest');
  requireDigest(input.target.applicationArtifactDigest, 'target application artifact digest');
  requireDigest(input.target.planDigest, 'target plan digest');
  requireDigest(input.target.providerCatalogDigest, 'target provider catalog digest');
  requireText(input.target.profile, 'target profile');
  requireText(input.target.applicationPlanSchema, 'target plan schema');
}

function validateBaseline(baseline: ApplicationDeploymentMigrationBaseline): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(baseline.release) || baseline.gitTag !== `v${baseline.release}`) {
    throw new ApplicationDeploymentMigrationProposalError('MIGRATION_SOURCE_RELEASE_UNQUALIFIED', `Migration source ${baseline.release} is not an exact semantic-version release/tag pair.`);
  }
  if (!/^[a-f0-9]{40}$/u.test(baseline.commit)) {
    throw new ApplicationDeploymentMigrationProposalError('MIGRATION_SOURCE_RELEASE_UNQUALIFIED', 'Migration source commit must be a complete Git hash.');
  }
  requireText(baseline.applicationArtifactSchema, 'baseline application artifact schema');
  requireText(baseline.applicationPlanSchema, 'baseline application plan schema');
  requireDigest(baseline.providerCatalogDigest, 'baseline provider catalog digest');
  requireDigest(baseline.evidenceManifestDigest, 'baseline evidence manifest digest');
  if (baseline.runtimeProtocolVersions.length === 0 || baseline.runtimeProtocolVersions.some((value) => !value.trim())) {
    throw new ApplicationDeploymentMigrationProposalError('MIGRATION_SOURCE_RELEASE_UNQUALIFIED', 'Migration baseline requires exact runtime protocol versions.');
  }
}

function validateLegacyNode(
  node: ApplicationLegacyDeploymentNode,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): void {
  if (!node.id.trim() || !node.implementation.trim() || !node.providerContract.trim() || !node.stateSchema.trim()) {
    diagnostics.push(diagnostic('MIGRATION_SOURCE_STATE_MISSING', `Source node ${node.id || '<empty>'} is missing identity or state metadata.`, node.provenance, node.id || undefined));
  }
  if (node.physicalIdentity) {
    try {
      validatePhysicalIdentity(node.physicalIdentity);
    } catch (error) {
      diagnostics.push(diagnostic('MIGRATION_SOURCE_STATE_MISSING', error instanceof Error ? error.message : String(error), node.provenance, node.id));
    }
  }
}

function validateTargetNode(
  node: ApplicationTargetDeploymentNode,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): void {
  if (
    !node.id.trim()
    || !node.semanticRequirement.trim()
    || !node.providerContract.trim()
    || !node.stateSchema.trim()
    || !node.implementation.canonical.id.trim()
  ) {
    diagnostics.push(diagnostic(
      'MIGRATION_SOURCE_STATE_MISSING',
      `Target node ${node.id || '<empty>'} is missing semantic, implementation, provider, or state identity.`,
      node.provenance,
      undefined,
      node.id || undefined,
    ));
  }
  if (node.physicalIdentity) {
    try {
      validatePhysicalIdentity(node.physicalIdentity);
    } catch (error) {
      diagnostics.push(diagnostic(
        'MIGRATION_SOURCE_STATE_MISSING',
        error instanceof Error ? error.message : String(error),
        node.provenance,
        undefined,
        node.id,
      ));
    }
  }
}

function validatePhysicalIdentity(identity: ApplicationPhysicalIdentity): void {
  const values = identity.domain === 'kubernetes'
    ? [identity.cluster, identity.kind, identity.name, ...(identity.namespace ? [identity.namespace] : [])]
    : identity.domain === 'aws'
      ? [identity.account, identity.region, identity.resourceType, identity.resourceId]
      : identity.domain === 'external'
        ? [identity.provider, identity.scope, identity.bindingDigest]
        : [identity.provider, identity.scope, identity.resourceType, identity.resourceId];
  if (values.some((value) => !value.trim())) throw new TypeError(`Physical identity ${identity.domain} contains an empty component.`);
  if (identity.domain === 'external') requireDigest(identity.bindingDigest, 'external binding digest');
}

function uniqueById<T extends { readonly id: string; readonly provenance: readonly ApplicationSourceProvenance[] }>(
  values: readonly T[],
  kind: 'source' | 'target',
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): Map<string, T> {
  const output = new Map<string, T>();
  for (const value of values) {
    if (!value.id.trim() || output.has(value.id)) {
      diagnostics.push(diagnostic('MIGRATION_MAPPING_AMBIGUOUS', `${kind} node ${value.id || '<empty>'} is duplicated or empty.`, value.provenance, kind === 'source' ? value.id : undefined, kind === 'target' ? value.id : undefined));
      continue;
    }
    output.set(value.id, value);
  }
  return output;
}

function directivesBySource(
  values: readonly ApplicationDeploymentMigrationDirective[],
  sourceNodes: ReadonlyMap<string, ApplicationLegacyDeploymentNode>,
  targetNodes: ReadonlyMap<string, ApplicationTargetDeploymentNode>,
  diagnostics: ApplicationDeploymentMigrationDiagnostic[],
): Map<string, ApplicationDeploymentMigrationDirective> {
  const output = new Map<string, ApplicationDeploymentMigrationDirective>();
  for (const value of values) {
    if (output.has(value.sourceNode) || !sourceNodes.has(value.sourceNode)) {
      diagnostics.push(diagnostic('MIGRATION_MAPPING_AMBIGUOUS', `Migration directive for source ${value.sourceNode} is duplicate or references a missing source.`, [], value.sourceNode));
      continue;
    }
    if (value.targetNode && !targetNodes.has(value.targetNode)) {
      diagnostics.push(diagnostic('MIGRATION_MAPPING_AMBIGUOUS', `Migration directive for ${value.sourceNode} references missing target ${value.targetNode}.`, [], value.sourceNode, value.targetNode));
      continue;
    }
    requireText(value.reason, `migration directive ${value.sourceNode} reason`);
    output.set(value.sourceNode, value);
  }
  return output;
}

function indexTargetsByRequirement(
  nodes: ReadonlyMap<string, ApplicationTargetDeploymentNode>,
): ReadonlyMap<string, readonly ApplicationTargetDeploymentNode[]> {
  const output = new Map<string, ApplicationTargetDeploymentNode[]>();
  for (const node of nodes.values()) {
    requireText(node.semanticRequirement, `target node ${node.id} semantic requirement`);
    const values = output.get(node.semanticRequirement) ?? [];
    values.push(node);
    output.set(node.semanticRequirement, values);
  }
  return output;
}

function samePhysicalIdentity(
  source: ApplicationPhysicalIdentity | undefined,
  target: ApplicationPhysicalIdentity | undefined,
): boolean {
  if (!source || !target) return false;
  try {
    return applicationPhysicalIdentityKey(source) === applicationPhysicalIdentityKey(target);
  } catch {
    return false;
  }
}

function diagnostic(
  code: ApplicationDeploymentMigrationDiagnostic['code'],
  message: string,
  provenance: readonly ApplicationSourceProvenance[],
  sourceNode?: string,
  targetNode?: string,
): ApplicationDeploymentMigrationDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    ...(sourceNode ? { sourceNode } : {}),
    ...(targetNode ? { targetNode } : {}),
    provenance: [...provenance],
  };
}

function compareDiagnostic(
  left: ApplicationDeploymentMigrationDiagnostic,
  right: ApplicationDeploymentMigrationDiagnostic,
): number {
  return left.code.localeCompare(right.code)
    || (left.sourceNode ?? '').localeCompare(right.sourceNode ?? '')
    || (left.targetNode ?? '').localeCompare(right.targetNode ?? '')
    || left.message.localeCompare(right.message);
}

function snapshotSource(source: ApplicationDeploymentMigrationSource): ApplicationDeploymentMigrationSource {
  return {
    ...source,
    baseline: {
      ...source.baseline,
      runtimeProtocolVersions: [...source.baseline.runtimeProtocolVersions],
    },
  };
}

function compact<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty.`);
}

function requireDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${label} must be a complete sha256 digest.`);
}
