// typecast-file-boundary: Public discriminants and canonical URI identities are constructed only after the module validates their bounded string inputs.

import type { ApplicationOperationId } from './application-operation-authority.js';
import {
  type ApplicationTelemetryEnvelopeV1,
  applicationTelemetryEnvelopeVersion,
  validateApplicationTelemetryEnvelopeV1,
} from './application-telemetry.js';
import type { SourceLocation } from './common.js';

export const applicationFoundationApiVersion = 'applik8s.foundation/v1alpha1' as const;

export type ApplicationCanonicalIdentityKind =
  | 'application'
  | 'graph-node'
  | 'operation'
  | 'source'
  | 'provider'
  | 'execution-boundary'
  | 'artifact'
  | 'target';

export interface ApplicationCanonicalIdentity {
  readonly apiVersion: typeof applicationFoundationApiVersion;
  readonly kind: ApplicationCanonicalIdentityKind;
  readonly id: `applik8s://${string}`;
  readonly application: string;
  /** Stable semantic identity. Source paths, timestamps, and generated display names are forbidden. */
  readonly semanticKey: string;
  readonly parentId?: `applik8s://${string}`;
}

export type ApplicationSourceProvenanceOrigin =
  | 'authored'
  | 'captured-call-site'
  | 'captured-helper'
  | 'framework-generated'
  | 'profile-provider-rule'
  | 'provider-plan'
  | 'external-responsibility';

export interface ApplicationSourceProvenance {
  readonly apiVersion: 'applik8s.provenance/v1alpha1';
  readonly id: string;
  readonly origin: ApplicationSourceProvenanceOrigin;
  /** Workspace-relative module identity; never an absolute developer-machine path. */
  readonly module?: string;
  readonly symbol?: string;
  readonly location?: SourceLocation;
  /** Ordered application-local helper path from the executable boundary to the effect. */
  readonly helperPath?: readonly string[];
  readonly causedBy?: ApplicationCanonicalIdentity['id'];
  readonly generatedBy?: string;
}

export type ApplicationDeploymentTargetKind = 'local' | 'aws-local' | 'aws' | 'kubernetes';

export interface ApplicationDeploymentTargetDescriptor {
  readonly apiVersion: 'applik8s.target/v1alpha1';
  readonly identity: ApplicationCanonicalIdentity;
  readonly target: ApplicationDeploymentTargetKind;
  /** Application policy/capacity selection remains separate from deployment target. */
  readonly profile: string;
  readonly lifecycleAuthority: 'local-supervisor' | 'alchemy' | 'external';
  readonly attributes: Readonly<Record<string, string>>;
}

export type ApplicationProviderMaturity =
  | 'stable'
  | 'beta'
  | 'preview'
  | 'experimental'
  | 'external';

export type ApplicationProviderDisposition =
  | 'supported'
  | 'degraded'
  | 'incompatible'
  | 'unresolved';

export type ApplicationProviderGuaranteeCategory =
  | 'ordering-partitioning'
  | 'replay-retention-acknowledgement-duplicates'
  | 'transaction-outbox'
  | 'consistency'
  | 'limits'
  | 'runtime-access-enforcement'
  | 'readiness-output-authority'
  | 'lifecycle'
  | 'target-limitation';

export interface ApplicationProviderGuarantee {
  readonly id: string;
  readonly category: ApplicationProviderGuaranteeCategory;
  readonly statement: string;
  readonly disposition: 'guaranteed' | 'bounded' | 'unsupported' | 'external';
  readonly evidence: readonly string[];
}

export interface ApplicationProviderGuaranteeManifest {
  readonly apiVersion: 'applik8s.providerGuarantees/v1alpha1';
  readonly provider: ApplicationCanonicalIdentity;
  readonly capability: {
    readonly interface: string;
    readonly qualifier?: string;
    readonly implementation: string;
    readonly version: string;
  };
  readonly targets: readonly ApplicationDeploymentTargetKind[];
  readonly maturity: ApplicationProviderMaturity;
  readonly guarantees: readonly ApplicationProviderGuarantee[];
  readonly limitations: readonly string[];
  readonly evidenceLevel: 'none' | 'static' | 'local-live' | 'target-live' | 'production-history';
}

export type ApplicationRuntimeAccessOperation =
  | 'model.read'
  | 'model.write'
  | 'model.delete'
  | 'object.list'
  | 'object.read'
  | 'object.write'
  | 'object.delete'
  | 'event.subscribe'
  | 'event.publish'
  | 'queue.consume'
  | 'queue.publish'
  | 'workflow.invoke'
  | 'workflow.admin'
  | 'schedule.configure'
  | 'schedule.unschedule'
  | 'schedule.admit'
  | 'schedule.invoke'
  | 'actor.invoke'
  | 'actor.connect'
  | 'actor.broadcast'
  | 'actor.admin'
  | 'ai.invoke'
  | 'search.read'
  | 'search.write'
  | 'secret.read'
  | 'checkpoint.use'
  | 'connection.use'
  | 'kubernetes.get'
  | 'kubernetes.list'
  | 'kubernetes.watch'
  | 'kubernetes.create'
  | 'kubernetes.patch'
  | 'kubernetes.status'
  | 'kubernetes.finalize'
  | 'kubernetes.delete'
  | 'network.connect'
  | 'telemetry.write';

const applicationRuntimeAccessOperations = new Set<string>([
  'model.read',
  'model.write',
  'model.delete',
  'object.list',
  'object.read',
  'object.write',
  'object.delete',
  'event.subscribe',
  'event.publish',
  'queue.consume',
  'queue.publish',
  'workflow.invoke',
  'workflow.admin',
  'schedule.configure',
  'schedule.unschedule',
  'schedule.admit',
  'schedule.invoke',
  'actor.invoke',
  'actor.connect',
  'actor.broadcast',
  'actor.admin',
  'ai.invoke',
  'search.read',
  'search.write',
  'secret.read',
  'checkpoint.use',
  'connection.use',
  'kubernetes.get',
  'kubernetes.list',
  'kubernetes.watch',
  'kubernetes.create',
  'kubernetes.patch',
  'kubernetes.status',
  'kubernetes.finalize',
  'kubernetes.delete',
  'network.connect',
  'telemetry.write',
]);

/** Runtime boundary for the versioned provider-neutral access vocabulary. */
export function isApplicationRuntimeAccessOperation(
  value: unknown,
): value is ApplicationRuntimeAccessOperation {
  return typeof value === 'string'
    && applicationRuntimeAccessOperations.has(value);
}

export type ApplicationRuntimeAccessScope =
  | { readonly kind: 'capability'; readonly capabilityId: string }
  | {
      readonly kind: 'resource';
      readonly resourceId: string;
      /** Exact credential keys when this resource scope names a Secret projection. */
      readonly keys?: readonly string[];
    }
  | { readonly kind: 'prefix'; readonly resourceId: string; readonly prefix: string }
  | { readonly kind: 'namespace'; readonly namespace: string; readonly resourceKinds?: readonly string[] }
  | { readonly kind: 'selector'; readonly resourceId: string; readonly labels: Readonly<Record<string, string>> }
  | {
      readonly kind: 'kubernetes';
      readonly apiGroup: string;
      readonly resource: string;
      readonly scope: 'Namespaced' | 'Cluster';
      readonly namespaces?: readonly string[];
      readonly resourceNames?: readonly string[];
      /** Exact Kubernetes verbs retained when a semantic operation groups subresource behavior. */
      readonly verbs?: readonly string[];
    }
  | { readonly kind: 'external'; readonly responsibility: string };

export interface ApplicationRuntimeAccessRequirement {
  readonly apiVersion: 'applik8s.runtimeAccess/v1alpha1';
  readonly id: string;
  readonly consumer: {
    readonly nodeId: string;
    readonly executionIdentity: ApplicationCanonicalIdentity['id'];
    readonly artifactId?: string;
  };
  readonly target: {
    readonly capabilityId: string;
    readonly qualification?: string;
    readonly operation: ApplicationRuntimeAccessOperation;
    readonly scope: ApplicationRuntimeAccessScope;
  };
  readonly origin: 'inferred' | 'explicit' | 'framework' | 'provider-required';
  readonly provenance: readonly ApplicationSourceProvenance[];
  readonly sensitivity: 'public' | 'internal' | 'credential';
  readonly enforcement: 'required' | 'best-effort' | 'application-only';
}

export function applicationRuntimeAccessRequirement(input: Omit<ApplicationRuntimeAccessRequirement, 'apiVersion' | 'id'>): ApplicationRuntimeAccessRequirement {
  const provenance = [...input.provenance].sort((left, right) => left.id.localeCompare(right.id));
  const id = `runtime-access:${lengthPrefixed([
    input.consumer.nodeId,
    input.consumer.executionIdentity,
    input.consumer.artifactId ?? '',
    input.target.capabilityId,
    input.target.qualification ?? '',
    input.target.operation,
    stableFoundationJson(input.target.scope),
    input.origin,
    input.sensitivity,
    input.enforcement,
  ])}`;
  return {
    ...input,
    apiVersion: 'applik8s.runtimeAccess/v1alpha1',
    id,
    provenance,
  };
}

/** Unions identical semantic access while retaining all source provenance. */
export function mergeApplicationRuntimeAccessRequirements(
  requirements: readonly ApplicationRuntimeAccessRequirement[],
): readonly ApplicationRuntimeAccessRequirement[] {
  const merged = new Map<string, ApplicationRuntimeAccessRequirement>();
  for (const requirement of requirements) {
    const normalized = applicationRuntimeAccessRequirement(requirement);
    const previous = merged.get(normalized.id);
    if (!previous) {
      merged.set(normalized.id, normalized);
      continue;
    }
    const provenance = new Map(
      [...previous.provenance, ...normalized.provenance].map((entry) => [entry.id, entry]),
    );
    merged.set(normalized.id, {
      ...normalized,
      provenance: [...provenance.values()].sort((left, right) => left.id.localeCompare(right.id)),
    });
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export interface ApplicationNativePlanRecord {
  readonly apiVersion: 'applik8s.nativePlan/v1alpha1';
  readonly id: string;
  readonly authority: 'alchemy' | 'typekro' | 'local-supervisor';
  readonly adapterVersion: string;
  readonly target: ApplicationCanonicalIdentity['id'];
  readonly contentDigest: string;
  readonly resourceIds: readonly string[];
  readonly actions: readonly ('create' | 'adopt' | 'update' | 'replace' | 'retain' | 'delete' | 'external' | 'unknown')[];
  readonly provenance: readonly ApplicationSourceProvenance[];
  /** Sanitized, bounded facts only. Native clients, credentials, and arbitrary provider objects are forbidden. */
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ApplicationGuestHostIdentityEnvelope {
  readonly apiVersion: 'applik8s.guestHostIdentity/v1alpha1';
  readonly application: ApplicationCanonicalIdentity['id'];
  readonly operation: ApplicationCanonicalIdentity['id'];
  readonly execution: ApplicationCanonicalIdentity['id'];
  readonly artifact: ApplicationCanonicalIdentity['id'];
  readonly attempt: string;
  readonly runtimeAccess: {
    readonly version: 'v1alpha1';
    readonly digest: string;
    readonly requirementIds: readonly string[];
  };
  readonly capabilityIds: readonly string[];
  readonly effectIds: readonly string[];
  readonly causalPrincipalId?: string;
  readonly authorizationReceiptIds: readonly string[];
  /**
   * The exact portable telemetry carrier used by every maintained runtime.
   * This field is diagnostic evidence only; authority remains in the outer
   * guest/host identity and runtime-access envelopes.
   */
  readonly telemetry?: ApplicationTelemetryEnvelopeV1;
}

export interface ApplicationFoundationDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'FOUNDATION_IDENTITY_INVALID'
    | 'FOUNDATION_IDENTITY_DUPLICATE'
    | 'FOUNDATION_PROVENANCE_INVALID'
    | 'FOUNDATION_TARGET_INVALID'
    | 'FOUNDATION_PROVIDER_GUARANTEE_INVALID'
    | 'FOUNDATION_RUNTIME_ACCESS_INVALID'
    | 'FOUNDATION_NATIVE_PLAN_INVALID'
    | 'FOUNDATION_GUEST_HOST_ENVELOPE_INVALID';
  readonly message: string;
  readonly subjectId?: string;
}

export function applicationCanonicalIdentity(input: {
  readonly application: string;
  readonly kind: Exclude<ApplicationCanonicalIdentityKind, 'operation'>;
  readonly semanticKey: string;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  assertIdentityPart(input.application, 'application');
  assertIdentityPart(input.semanticKey, 'semantic key');
  const id = `applik8s://applications/${encodeURIComponent(input.application)}/${identityPath(input.kind)}/${encodeURIComponent(input.semanticKey)}` as const;
  return {
    apiVersion: applicationFoundationApiVersion,
    kind: input.kind,
    id,
    application: input.application,
    semanticKey: input.semanticKey,
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };
}

export function applicationOperationIdentity(input: {
  readonly application: string;
  readonly operationId: ApplicationOperationId;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  assertIdentityPart(input.application, 'application');
  if (!input.operationId.startsWith('applik8s://')) throw new Error('Canonical operation ID must use the applik8s:// scheme.');
  return {
    apiVersion: applicationFoundationApiVersion,
    kind: 'operation',
    id: input.operationId,
    application: input.application,
    semanticKey: input.operationId,
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };
}

export function applicationGraphNodeIdentity(input: {
  readonly application: string;
  readonly nodeKind: string;
  readonly nodeId: string;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  return applicationCanonicalIdentity({
    application: input.application,
    kind: 'graph-node',
    semanticKey: lengthPrefixed([input.nodeKind, input.nodeId]),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  });
}

export function applicationProviderIdentity(input: {
  readonly application: string;
  readonly capabilityInterface: string;
  readonly nodeId: string;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  return applicationCanonicalIdentity({
    application: input.application,
    kind: 'provider',
    semanticKey: lengthPrefixed([input.capabilityInterface, input.nodeId]),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  });
}

export function applicationExecutionBoundaryIdentity(input: {
  readonly application: string;
  readonly boundaryKind: string;
  readonly ownerNodeId: string;
  readonly qualifier?: string;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  return applicationCanonicalIdentity({
    application: input.application,
    kind: 'execution-boundary',
    semanticKey: lengthPrefixed([input.boundaryKind, input.ownerNodeId, input.qualifier ?? '']),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  });
}

export function applicationTargetIdentity(input: {
  readonly application: string;
  readonly target: ApplicationDeploymentTargetKind;
  readonly connectionDigest: string;
  readonly instance: string;
  readonly parentId?: ApplicationCanonicalIdentity['id'];
}): ApplicationCanonicalIdentity {
  return applicationCanonicalIdentity({
    application: input.application,
    kind: 'target',
    semanticKey: lengthPrefixed([input.target, input.connectionDigest, input.instance]),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  });
}

export function sourceProvenance(input: Omit<ApplicationSourceProvenance, 'apiVersion' | 'id'>): ApplicationSourceProvenance {
  const module = input.module ? workspaceRelativePath(input.module) : undefined;
  const location = input.location
    ? { ...input.location, file: workspaceRelativePath(input.location.file) }
    : undefined;
  const key = lengthPrefixed([input.origin, module ?? '', input.symbol ?? '', ...(input.helperPath ?? [])]);
  return {
    ...input,
    apiVersion: 'applik8s.provenance/v1alpha1',
    id: `source:${key}`,
    ...(module ? { module } : {}),
    ...(location ? { location } : {}),
  };
}

export function validateApplicationFoundation(input: {
  readonly identities: readonly ApplicationCanonicalIdentity[];
  readonly provenance?: readonly ApplicationSourceProvenance[];
  readonly targets?: readonly ApplicationDeploymentTargetDescriptor[];
  readonly providerGuarantees?: readonly ApplicationProviderGuaranteeManifest[];
  readonly runtimeAccess?: readonly ApplicationRuntimeAccessRequirement[];
  readonly nativePlans?: readonly ApplicationNativePlanRecord[];
  readonly guestHostEnvelopes?: readonly ApplicationGuestHostIdentityEnvelope[];
}): readonly ApplicationFoundationDiagnostic[] {
  const diagnostics: ApplicationFoundationDiagnostic[] = [];
  const identities = new Map<string, ApplicationCanonicalIdentity>();
  for (const identity of input.identities) {
    let expectedId: string | undefined;
    try {
      expectedId = identity.kind === 'operation'
        ? applicationOperationIdentity({
            application: identity.application,
            operationId: identity.semanticKey as ApplicationOperationId,
            ...(identity.parentId ? { parentId: identity.parentId } : {}),
          }).id
        : applicationCanonicalIdentity({
            application: identity.application,
            kind: identity.kind,
            semanticKey: identity.semanticKey,
            ...(identity.parentId ? { parentId: identity.parentId } : {}),
          }).id;
    } catch {
      // The common diagnostic below is more useful than leaking a constructor exception.
    }
    if (!identity.id.startsWith('applik8s://') || !identity.application || !identity.semanticKey || identity.id !== expectedId) {
      diagnostics.push(diagnostic('FOUNDATION_IDENTITY_INVALID', `Canonical identity ${identity.id || '<empty>'} is incomplete.`, identity.id));
    }
    const previous = identities.get(identity.id);
    if (previous) {
      diagnostics.push(diagnostic('FOUNDATION_IDENTITY_DUPLICATE', `Canonical identity ${identity.id} is declared more than once${previous.kind !== identity.kind || previous.semanticKey !== identity.semanticKey ? ' with incompatible records' : ''}.`, identity.id));
    }
    identities.set(identity.id, identity);
  }
  for (const identity of input.identities) {
    if (identity.parentId && (!identities.has(identity.parentId) || identities.get(identity.parentId)?.application !== identity.application)) {
      diagnostics.push(diagnostic('FOUNDATION_IDENTITY_INVALID', `Canonical identity ${identity.id} has an unknown or cross-application parent ${identity.parentId}.`, identity.id));
    }
  }
  for (const provenance of input.provenance ?? []) {
    if ((!provenance.module && !provenance.generatedBy) || absolutePath(provenance.module) || absolutePath(provenance.location?.file)) {
      diagnostics.push(diagnostic('FOUNDATION_PROVENANCE_INVALID', `Source provenance ${provenance.id} must retain a workspace-relative module or a framework generator.`, provenance.id));
    }
    if ((provenance.helperPath ?? []).some((entry) => !entry.trim())) {
      diagnostics.push(diagnostic('FOUNDATION_PROVENANCE_INVALID', `Source provenance ${provenance.id} contains an empty helper path segment.`, provenance.id));
    }
    if (provenance.causedBy && !identities.has(provenance.causedBy)) {
      diagnostics.push(diagnostic('FOUNDATION_PROVENANCE_INVALID', `Source provenance ${provenance.id} references unknown cause ${provenance.causedBy}.`, provenance.id));
    }
  }
  for (const target of input.targets ?? []) {
    if (target.identity.kind !== 'target' || !identities.has(target.identity.id) || !target.profile || Object.values(target.attributes).some((value) => !value.trim())) {
      diagnostics.push(diagnostic('FOUNDATION_TARGET_INVALID', `Deployment target ${target.identity.id} is incomplete.`, target.identity.id));
    }
  }
  for (const manifest of input.providerGuarantees ?? []) {
    const guaranteeIds = new Set<string>();
    if (manifest.provider.kind !== 'provider' || !identities.has(manifest.provider.id) || manifest.targets.length === 0 || !manifest.capability.interface || !manifest.capability.implementation) {
      diagnostics.push(diagnostic('FOUNDATION_PROVIDER_GUARANTEE_INVALID', `Provider guarantee manifest for ${manifest.provider.id} is incomplete.`, manifest.provider.id));
    }
    for (const guarantee of manifest.guarantees) {
      if (!guarantee.id || guaranteeIds.has(guarantee.id) || !guarantee.statement) {
        diagnostics.push(diagnostic('FOUNDATION_PROVIDER_GUARANTEE_INVALID', `Provider ${manifest.provider.id} contains an empty or duplicate guarantee.`, manifest.provider.id));
      }
      guaranteeIds.add(guarantee.id);
    }
  }
  const accessIds = new Set<string>();
  for (const requirement of input.runtimeAccess ?? []) {
    if (!requirement.id || accessIds.has(requirement.id) || !requirement.consumer.nodeId || !identities.has(requirement.consumer.executionIdentity) || identities.get(requirement.consumer.executionIdentity)?.kind !== 'execution-boundary' || !requirement.target.capabilityId || !isApplicationRuntimeAccessOperation(requirement.target.operation) || requirement.provenance.length === 0 || containsWildcard(requirement.target.scope)) {
      diagnostics.push(diagnostic('FOUNDATION_RUNTIME_ACCESS_INVALID', `Runtime-access requirement ${requirement.id || '<empty>'} is ambiguous, unattributed, duplicated, or wildcarded.`, requirement.id));
    }
    accessIds.add(requirement.id);
  }
  for (const plan of input.nativePlans ?? []) {
    if (!plan.id || !identities.has(plan.target) || identities.get(plan.target)?.kind !== 'target' || !/^sha256:[a-f0-9]{64}$/.test(plan.contentDigest) || Object.entries(plan.summary).some(([key, value]) => credentialValueKey(key) || credentialValue(value))) {
      diagnostics.push(diagnostic('FOUNDATION_NATIVE_PLAN_INVALID', `Native plan ${plan.id || '<empty>'} is incomplete or contains credential-shaped summary data.`, plan.id));
    }
  }
  for (const envelope of input.guestHostEnvelopes ?? []) {
    const references = [envelope.application, envelope.operation, envelope.execution, envelope.artifact];
    const telemetry = envelope.telemetry;
    let invalidTelemetry = false;
    if (telemetry !== undefined) {
      try {
        validateApplicationTelemetryEnvelopeV1(telemetry);
        invalidTelemetry = telemetry.identity.application !== envelope.application
          || telemetry.identity.operation !== envelope.operation
          || telemetry.identity.execution !== envelope.execution
          || telemetry.identity.instance !== envelope.attempt
          || telemetry.invocation.relationship !== 'synchronous';
      } catch {
        invalidTelemetry = true;
      }
    }
    if (invalidTelemetry) {
      diagnostics.push(diagnostic('FOUNDATION_GUEST_HOST_ENVELOPE_INVALID', `Guest/host identity envelope for ${envelope.execution} does not carry a valid parity-bound ${applicationTelemetryEnvelopeVersion} carrier.`, envelope.execution));
    } else if (references.some((reference) => !identities.has(reference)) || !envelope.attempt || !envelope.runtimeAccess.digest.startsWith('sha256:') || envelope.runtimeAccess.requirementIds.some((id) => !accessIds.has(id))) {
      diagnostics.push(diagnostic('FOUNDATION_GUEST_HOST_ENVELOPE_INVALID', `Guest/host identity envelope for ${envelope.execution} has unknown identities or an invalid access digest.`, envelope.execution));
    }
  }
  return diagnostics;
}

function identityPath(kind: ApplicationCanonicalIdentityKind): string {
  const paths: Record<ApplicationCanonicalIdentityKind, string> = {
    application: 'identity',
    'graph-node': 'graph-nodes',
    operation: 'operations',
    source: 'sources',
    provider: 'providers',
    'execution-boundary': 'execution-boundaries',
    artifact: 'artifacts',
    target: 'targets',
  };
  return paths[kind];
}

function lengthPrefixed(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

function stableFoundationJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableFoundationJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableFoundationJson(entry)}`)
    .join(',')}}`;
}

function assertIdentityPart(value: string, label: string): void {
  if (!value.trim() || [...value].some((character) => character.charCodeAt(0) < 0x20)) {
    throw new Error(`Canonical ${label} must be non-empty and contain no control characters.`);
  }
}

function workspaceRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (absolutePath(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Source provenance path ${value} must be workspace-relative.`);
  }
  return normalized;
}

function absolutePath(value: unknown): boolean {
  return typeof value === 'string' && (/^(?:[A-Za-z]:)?\//.test(value) || value.startsWith('\\\\'));
}

function containsWildcard(scope: ApplicationRuntimeAccessScope): boolean {
  return JSON.stringify(scope).includes('*');
}

function credentialValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^(?:Bearer\s+|sk-[A-Za-z0-9]|AKIA[A-Z0-9])/.test(value);
}

function credentialValueKey(value: string): boolean {
  return /(?:password|token|apiKey|secretValue|privateKey|credential)$/i.test(value);
}

function diagnostic(code: ApplicationFoundationDiagnostic['code'], message: string, subjectId?: string): ApplicationFoundationDiagnostic {
  return { severity: 'error', code, message, ...(subjectId ? { subjectId } : {}) };
}
