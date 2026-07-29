// typecast-file-boundary: authority normalization validates canonical identities, scopes, and JSON records before restoring branded operation contracts.
import type { JsonObject, JsonValue, SourceLocation } from './common.js';

export type ApplicationOperationId = `applik8s://${string}`;
export const applicationOperationCatalogArtifactFileName = 'operation-catalog.json';
export const applicationWorkloadAuthorityArtifactFileName = 'workload-authority.json';
export type ApplicationCatalogRevisionId = string;
export type ApplicationAuthorityRevisionId = string;
export type ApplicationPrincipalId = string;
export type ApplicationIdentityReferenceId = string;

export type ApplicationOperationKind =
  | 'model.create'
  | 'model.read'
  | 'model.query'
  | 'model.update'
  | 'model.delete'
  | 'model.operation'
  | 'resource.create'
  | 'resource.read'
  | 'resource.update'
  | 'resource.delete'
  | 'resource.status'
  | 'resource.operation'
  | 'query'
  | 'search'
  | 'subscription'
  | 'workflow.start'
  | 'workflow.signal'
  | 'workflow.cancel'
  | 'workflow.result'
  | 'task'
  | 'http.raw'
  | 'mcp.tool';

export type ApplicationOperationTransport =
  | 'direct'
  | 'http'
  | 'mcp'
  | 'workflow'
  | 'event'
  | 'control-plane';

export type ApplicationAuthorizationBoundary =
  | 'admission'
  | 'enqueue'
  | 'execution'
  | 'protected-step'
  | 'pre-commit'
  | 'result-read'
  | 'subscription-resume';

export interface ApplicationSchemaDescriptor {
  readonly digest: string;
  readonly schema: JsonObject;
}

export interface ApplicationOperationTargetDescriptor {
  readonly model?: string;
  readonly resource?: {
    readonly apiVersion: string;
    readonly kind: string;
  };
  readonly identity: ApplicationSchemaDescriptor;
}

export interface ApplicationOperationTransportBinding {
  readonly id: string;
  readonly transport: ApplicationOperationTransport;
  readonly server?: string;
  readonly route?: {
    readonly name: string;
    readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
    readonly path: string;
  };
  readonly mcp?: {
    readonly server: string;
    readonly tool: string;
    readonly schemaRevision: string;
  };
}

export interface ApplicationOperationReplacement {
  readonly operationId: ApplicationOperationId;
  readonly compatible: boolean;
  readonly migration?: string;
}

export interface ApplicationOperationAuthorityDescriptor {
  readonly classification: 'unclassified' | 'public' | 'assigned' | 'runtime-grantable' | 'application-policy';
  readonly grantable: boolean;
  readonly delegable: boolean;
  readonly checks: readonly ApplicationAuthorizationBoundary[];
  readonly defaultScope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
}

export interface ApplicationOperationDescriptor {
  readonly apiVersion: 'applik8s.operation/v1alpha1';
  readonly id: ApplicationOperationId;
  readonly version: string;
  readonly name: string;
  readonly kind: ApplicationOperationKind;
  readonly input: ApplicationSchemaDescriptor;
  readonly output: ApplicationSchemaDescriptor;
  readonly errors: Readonly<Record<string, ApplicationSchemaDescriptor>>;
  readonly target?: ApplicationOperationTargetDescriptor;
  readonly authority: ApplicationOperationAuthorityDescriptor;
  readonly transports: readonly ApplicationOperationTransportBinding[];
  readonly placement: {
    readonly nodeId: string;
    readonly runtime: 'server' | 'command-processor' | 'workflow-worker' | 'event-processor' | 'operator';
  };
  readonly effects?: readonly string[];
  readonly emittedEvents?: readonly string[];
  readonly deprecated?: {
    readonly since: string;
    readonly message: string;
  };
  readonly replaces?: ApplicationOperationReplacement;
  readonly sourceLocation?: SourceLocation;
}

export type ApplicationCatalogState = 'proposed' | 'staged' | 'active' | 'draining' | 'retired';

export interface ApplicationOperationCatalog {
  readonly apiVersion: 'applik8s.operationCatalog/v1alpha1';
  readonly application: string;
  readonly revision: ApplicationCatalogRevisionId;
  readonly digest: string;
  readonly state: ApplicationCatalogState;
  readonly operations: readonly ApplicationOperationDescriptor[];
  readonly predecessor?: ApplicationCatalogRevisionId;
  readonly stagedAt?: string;
  readonly activatedAt?: string;
  readonly drainingAt?: string;
  readonly retiredAt?: string;
}

export interface ApplicationOperationCompatibilityChange {
  readonly operationId: ApplicationOperationId;
  readonly kind: 'added' | 'removed' | 'compatible' | 'narrowed' | 'broadened' | 'replaced' | 'incompatible';
  readonly message: string;
  readonly replacement?: ApplicationOperationReplacement;
}

export interface ApplicationOperationCompatibilityReport {
  readonly fromRevision: ApplicationCatalogRevisionId;
  readonly toRevision: ApplicationCatalogRevisionId;
  readonly compatible: boolean;
  readonly changes: readonly ApplicationOperationCompatibilityChange[];
  readonly blockingGrantIds: readonly string[];
  readonly blockingEnvelopeIds: readonly string[];
  readonly blockingWorkflowIds: readonly string[];
  readonly blockingSessionIds: readonly string[];
}

export type ApplicationIdentityKind =
  | 'human'
  | 'pre-authentication-flow'
  | 'oauth-authorization-flow'
  | 'service'
  | 'workload'
  | 'execution'
  | 'oauth-client'
  | 'mcp-client'
  | 'external';

export interface ApplicationIdentityReference {
  readonly id: ApplicationIdentityReferenceId;
  readonly kind: ApplicationIdentityKind;
  readonly issuer: string;
  readonly subject: string;
}

export type ApplicationExecutionKind = 'agent' | 'task' | 'workflow' | 'processor' | 'reconcile';

export interface ApplicationPrincipal {
  readonly id: ApplicationPrincipalId;
  readonly identity: ApplicationIdentityReference;
  readonly kind: ApplicationIdentityKind;
  readonly authenticationMethod: string;
  readonly audience: readonly string[];
  readonly trustedContextDigest: string;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly admittedAt: string;
  readonly expiresAt?: string;
  readonly sessionId?: string;
  readonly clientId?: string;
  readonly flowId?: string;
}

export interface ApplicationExecutionPrincipal extends ApplicationPrincipal {
  readonly kind: 'execution';
  readonly executionKind: ApplicationExecutionKind;
  readonly executionId: string;
  readonly attempt: number;
  readonly workloadIdentity: ApplicationIdentityReference;
  readonly serviceIdentity?: ApplicationIdentityReference;
  readonly causalPrincipal?: ApplicationIdentityReference;
  readonly causalGrantIds: readonly string[];
  readonly deadline: string;
  readonly cancellationRevision: string;
  readonly bindings: readonly ApplicationExecutionBinding[];
  readonly effectiveAuthority: readonly ApplicationEffectiveAuthority[];
}

export interface ApplicationPreAuthenticationFlowPrincipal extends ApplicationPrincipal {
  readonly kind: 'pre-authentication-flow';
  readonly flowId: string;
  readonly browserBindingDigest: string;
  readonly csrfBindingDigest: string;
  readonly allowedTransitions: readonly string[];
}

export interface ApplicationOAuthAuthorizationFlowPrincipal extends ApplicationPrincipal {
  readonly kind: 'oauth-authorization-flow';
  readonly flowId: string;
  readonly resourceOwner: ApplicationIdentityReference;
  readonly authorizationRequestId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
}

export type ApplicationClosureSubject =
  | 'free'
  | 'input'
  | 'event'
  | 'resource'
  | 'lifecycle'
  | 'route'
  | 'reconcile'
  | 'task'
  | 'workflow';

export interface ApplicationNormalizedClosureContract {
  readonly apiVersion: 'applik8s.closure/v1alpha1';
  readonly subject: ApplicationClosureSubject;
  readonly sourceDigest: string;
  readonly captures: readonly {
    readonly name: string;
    readonly kind: 'literal' | 'function' | 'resource' | 'operation' | 'provider' | 'schema';
    readonly digest: string;
  }[];
  readonly dependencies: readonly ApplicationOperationInvocationDependency[];
  readonly effects: readonly {
    readonly kind: 'model' | 'resource' | 'event' | 'object' | 'workflow' | 'external';
    readonly target: string;
    readonly operation: string;
  }[];
}

export interface ApplicationOperationInvocationDependency {
  readonly apiVersion: 'applik8s.operationDependency/v1alpha1';
  readonly alias: string;
  readonly operationId: ApplicationOperationId;
  readonly invocation: 'direct-facade' | 'context.invoke';
  readonly authorization: 'reauthorize';
  readonly restrictions: ApplicationStaticRestriction;
  readonly binding?: ApplicationExecutionBinding;
  readonly terminal: true;
}

export type ApplicationScopeScalar = string | number | boolean | null;

export type ApplicationScopeValue =
  | { readonly kind: 'literal'; readonly value: ApplicationScopeScalar }
  | {
    readonly kind: 'reference';
    readonly source: 'target' | 'principal' | 'trusted-context' | 'input' | 'event' | 'resource';
    readonly path: string;
  };

export type ApplicationScopeExpression =
  | { readonly kind: 'all' }
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'target'; readonly model: string; readonly identity: Readonly<Record<string, ApplicationScopeScalar>> }
  | { readonly kind: 'and'; readonly expressions: readonly ApplicationScopeExpression[] }
  | { readonly kind: 'or'; readonly expressions: readonly ApplicationScopeExpression[] }
  | { readonly kind: 'not'; readonly expression: ApplicationScopeExpression }
  | { readonly kind: 'compare'; readonly field: string; readonly operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; readonly value: ApplicationScopeValue }
  | { readonly kind: 'in'; readonly field: string; readonly values: readonly ApplicationScopeValue[] }
  | { readonly kind: 'relationship'; readonly from: string; readonly name: string; readonly to: string; readonly target: ApplicationScopeExpression }
  | { readonly kind: 'transport'; readonly bindingId: string; readonly transport: ApplicationOperationTransport }
  | { readonly kind: 'audience'; readonly audience: string }
  | { readonly kind: 'trusted-context'; readonly key: string; readonly operator: 'eq' | 'in'; readonly value: ApplicationScopeValue | readonly ApplicationScopeValue[] };

export interface ApplicationScopeIr {
  readonly apiVersion: 'applik8s.scope/v1alpha1';
  readonly expression: ApplicationScopeExpression;
}

export interface ApplicationStaticRestriction {
  readonly target?: ApplicationScopeExpression;
  readonly predicates: readonly ApplicationScopeExpression[];
  readonly transport?: ApplicationScopeExpression;
  readonly audience?: ApplicationScopeExpression;
}

export type ApplicationExecutionBindingSource = 'input' | 'event' | 'resource';

export interface ApplicationExecutionBinding {
  readonly apiVersion: 'applik8s.executionBinding/v1alpha1';
  readonly id: string;
  readonly revision: string;
  readonly operationId: ApplicationOperationId;
  readonly source: ApplicationExecutionBindingSource;
  readonly projectionDigest: string;
  readonly projectionSource: string;
  readonly boundKeys: readonly string[];
  readonly inferred: boolean;
  readonly provenance: {
    readonly nodeId: string;
    readonly sourceLocation?: SourceLocation;
  };
}

export interface ApplicationWorkloadAuthorityEnvelope {
  readonly apiVersion: 'applik8s.workloadAuthority/v1alpha1';
  readonly id: string;
  readonly workloadIdentity: ApplicationIdentityReference;
  readonly serviceIdentity?: ApplicationIdentityReference;
  readonly operationId: ApplicationOperationId;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly restrictions: ApplicationStaticRestriction;
  readonly binding?: ApplicationExecutionBinding;
  readonly inputSchemaDigest: string;
  readonly audiences: readonly string[];
  readonly transports: readonly ApplicationOperationTransport[];
  readonly delegation: 'forbidden';
  readonly impersonation: 'forbidden';
}

export interface ApplicationEffectiveAuthority {
  readonly operationId: ApplicationOperationId;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly workloadEnvelopeId: string;
  readonly grantIds: readonly string[];
  readonly inputDigest: string;
  readonly target: ApplicationScopeExpression;
  readonly scope: ApplicationScopeExpression;
  readonly audience: string;
  readonly transport: ApplicationOperationTransport;
}

export type ApplicationAuthorityOrigin = 'application' | 'runtime';

export interface ApplicationPermissionRecord {
  readonly apiVersion: 'applik8s.permission/v1alpha1';
  readonly id: string;
  readonly name: string;
  readonly origin: ApplicationAuthorityOrigin;
  readonly manifestRevision?: string;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly audiences?: readonly string[];
  readonly grantable: boolean;
  readonly lifecycleOwner?: string;
  readonly createdAt: string;
  readonly retiredAt?: string;
}

export interface ApplicationRoleRecord {
  readonly apiVersion: 'applik8s.role/v1alpha1';
  readonly id: string;
  readonly name: string;
  readonly origin: ApplicationAuthorityOrigin;
  readonly permissionIds: readonly string[];
  readonly lifecycleOwner?: string;
  readonly createdAt: string;
  readonly retiredAt?: string;
}

export interface ApplicationDelegationRecord {
  readonly apiVersion: 'applik8s.delegation/v1alpha1';
  readonly id: string;
  readonly grantor: ApplicationIdentityReference;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly maximumValiditySeconds?: number;
  readonly maximumUses?: number;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface ApplicationGrantRecord {
  readonly apiVersion: 'applik8s.grant/v1alpha1';
  readonly id: string;
  readonly origin: ApplicationAuthorityOrigin;
  readonly identity: ApplicationIdentityReference;
  readonly permissionId?: string;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly issuedBy: ApplicationIdentityReference;
  readonly delegationId?: string;
  readonly lifecycleOwner?: string;
  readonly reason?: string;
  readonly maximumUses?: number;
  readonly expiresAt?: string;
  readonly outcomeId?: string;
  /** Catalog revision whose operation meanings this grant was reviewed against. */
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly createdAt: string;
  readonly revokedAt?: string;
}

export interface ApplicationGrantRequestRecord {
  readonly apiVersion: 'applik8s.grantRequest/v1alpha1';
  readonly id: string;
  readonly requester: ApplicationIdentityReference;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly reason: string;
  readonly evidence?: JsonObject;
  readonly requestedExpiresAt?: string;
  readonly requestedMaximumUses?: number;
  readonly requiredOutcomeId?: string;
  readonly approvalPolicyId: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface ApplicationApprovalRecord {
  readonly apiVersion: 'applik8s.approval/v1alpha1';
  readonly id: string;
  readonly requestId: string;
  readonly approver: ApplicationIdentityReference;
  readonly decision: 'approve' | 'reject';
  readonly reason?: string;
  readonly evidence?: JsonObject;
  readonly decidedAt: string;
}

export interface ApplicationOutcomeDefinition {
  readonly apiVersion: 'applik8s.outcome/v1alpha1';
  readonly id: string;
  readonly name: string;
  readonly subjectModel: string;
  readonly verifier: ApplicationIdentityReference;
  readonly observationOperationId: ApplicationOperationId;
  readonly predicate: ApplicationScopeExpression;
  readonly timeoutSeconds: number;
  readonly failure: 'escalate' | 'revoke' | 'deny-retry';
}

export interface ApplicationGrantReservation {
  readonly apiVersion: 'applik8s.grantReservation/v1alpha1';
  readonly id: string;
  readonly grantId: string;
  readonly idempotencyKey: string;
  readonly commandId: string;
  readonly operationId: ApplicationOperationId;
  readonly targetDigest: string;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly state: 'reserved' | 'consumed' | 'outcome-pending' | 'outcome-verified' | 'outcome-failed' | 'released' | 'expired';
  readonly reservedAt: string;
  readonly updatedAt: string;
  readonly uncertainEffect: boolean;
}

export interface ApplicationAuthorizationReceipt {
  readonly apiVersion: 'applik8s.authorizationReceipt/v1alpha1';
  readonly id: string;
  readonly application: string;
  readonly operationId: ApplicationOperationId;
  readonly operationVersion: string;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly principal: ApplicationPrincipal;
  readonly trustedContextDigest: string;
  readonly matchedPermissionIds: readonly string[];
  readonly matchedGrantIds: readonly string[];
  readonly workloadEnvelopeId?: string;
  readonly executionPrincipalId?: string;
  readonly inputDigest: string;
  readonly target: ApplicationScopeExpression;
  readonly scopeEvidence: readonly ApplicationScopeExpression[];
  readonly audience: string;
  readonly transport: ApplicationOperationTransport;
  readonly admittedAt: string;
  readonly expiresAt?: string;
  readonly reservationId?: string;
}

export interface ApplicationAuditEvent {
  readonly apiVersion: 'applik8s.audit/v1alpha1';
  readonly id: string;
  readonly kind:
    | 'catalog.staged'
    | 'catalog.activated'
    | 'catalog.draining'
    | 'catalog.retired'
    | 'permission.created'
    | 'permission.retired'
    | 'role.created'
    | 'role.retired'
    | 'grant.requested'
    | 'grant.approved'
    | 'grant.rejected'
    | 'grant.assigned'
    | 'grant.migrated'
    | 'grant.reserved'
    | 'grant.consumed'
    | 'grant.revoked'
    | 'grant.expired'
    | 'grant.outcome-pending'
    | 'grant.outcome-verified'
    | 'grant.outcome-failed'
    | 'authorization.allowed'
    | 'authorization.denied'
    | 'authority.draining'
    | 'revocation.obligation-neutralized'
    | 'revocation.proven'
    | 'break-glass';
  readonly occurredAt: string;
  readonly principal?: ApplicationIdentityReference;
  readonly operationId?: ApplicationOperationId;
  readonly targetDigest?: string;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly causationId?: string;
  readonly correlationId?: string;
  readonly details: JsonObject;
}

export interface ApplicationRevocationObligation {
  readonly projection: string;
  readonly kind: 'revoke' | 'lease-expiry' | 'credential-rotation' | 'route-detachment' | 'deny-all';
  readonly state: 'pending' | 'neutralized' | 'expiry-guaranteed' | 'failed';
  readonly providerRevision?: string;
  readonly observedAt?: string;
  readonly guaranteedExpiryAt?: string;
  readonly diagnostic?: string;
}

export interface ApplicationRevocationTombstone {
  readonly apiVersion: 'applik8s.revocationTombstone/v1alpha1';
  readonly id: string;
  readonly application: string;
  readonly authorityRevision: ApplicationAuthorityRevisionId;
  readonly identityIds: readonly ApplicationIdentityReferenceId[];
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly obligations: readonly ApplicationRevocationObligation[];
  readonly createdAt: string;
  readonly provenAt?: string;
  readonly transferredByBreakGlassAt?: string;
  readonly auditProvenance: readonly string[];
}

export interface ApplicationAuthorityDiagnostic {
  readonly code:
    | 'AUTHORITY_INVALID_OPERATION_ID'
    | 'AUTHORITY_UNCLASSIFIED_OPERATION'
    | 'AUTHORITY_DUPLICATE_OPERATION'
    | 'AUTHORITY_INVALID_SCOPE'
    | 'AUTHORITY_CATALOG_INCOMPATIBLE'
    | 'AUTHORITY_BOUND_FIELD_OVERRIDE'
    | 'AUTHORITY_SCOPE_CONFLICT'
    | 'AUTHORITY_DELEGATION_BROADENING'
    | 'AUTHORITY_RETIRED_OPERATION'
    | 'AUTHORITY_REVOCATION_PENDING';
  readonly message: string;
  readonly path?: string;
}

/**
 * Deterministic application-authored authority declaration. Runtime lifecycle
 * fields are materialized by the canonical authority store at reconciliation
 * time rather than embedded into compiler artifacts.
 */
export interface ApplicationStaticAuthorityManifest {
  readonly apiVersion: 'applik8s.authorityManifest/v1alpha1';
  readonly application: string;
  readonly revision: string;
  readonly identities: readonly ApplicationIdentityReference[];
  readonly permissions: readonly ApplicationStaticPermissionDefinition[];
  readonly roles: readonly ApplicationStaticRoleDefinition[];
  readonly grants: readonly ApplicationStaticGrantDefinition[];
  readonly outcomes: readonly ApplicationOutcomeDefinition[];
}

export interface ApplicationStaticPermissionDefinition {
  readonly id: string;
  readonly name: string;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly audiences?: readonly string[];
  readonly grantable: boolean;
  readonly lifecycleOwner?: string;
}

export interface ApplicationStaticRoleDefinition {
  readonly id: string;
  readonly name: string;
  readonly permissionIds: readonly string[];
  readonly lifecycleOwner?: string;
}

export interface ApplicationStaticGrantDefinition {
  readonly id: string;
  readonly identity: ApplicationIdentityReference;
  readonly permissionId?: string;
  readonly operationIds: readonly ApplicationOperationId[];
  readonly scope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly issuedBy: ApplicationIdentityReference;
  readonly lifecycleOwner?: string;
  readonly reason?: string;
  readonly maximumUses?: number;
  readonly expiresAt?: string;
  readonly outcomeId?: string;
}

export function normalizeApplicationScope(expression: ApplicationScopeExpression): ApplicationScopeExpression {
  if (expression.kind !== 'and' && expression.kind !== 'or') return expression;
  const flattened = expression.expressions.flatMap((candidate) =>
    candidate.kind === expression.kind ? candidate.expressions : [candidate]);
  const normalized = flattened.map(normalizeApplicationScope);
  const identity = expression.kind === 'and' ? 'all' : 'none';
  const filtered = normalized.filter((candidate) => candidate.kind !== identity);
  if (expression.kind === 'and' && filtered.some((candidate) => candidate.kind === 'none')) {
    return filtered.find((candidate) => candidate.kind === 'none') ?? { kind: 'none', reason: 'scope intersection is empty' };
  }
  if (expression.kind === 'or' && filtered.some((candidate) => candidate.kind === 'all')) return { kind: 'all' };
  if (filtered.length === 0) return expression.kind === 'and' ? { kind: 'all' } : { kind: 'none', reason: 'scope union is empty' };
  if (filtered.length === 1) return filtered[0] ?? { kind: 'none', reason: 'scope normalization failed' };
  return { kind: expression.kind, expressions: deduplicateScopes(filtered) };
}

export function intersectApplicationScopes(...expressions: readonly ApplicationScopeExpression[]): ApplicationScopeExpression {
  return normalizeApplicationScope({ kind: 'and', expressions });
}

export function applicationOperationId(parts: {
  readonly domain: 'models' | 'resources' | 'queries' | 'search' | 'workflows' | 'tasks' | 'http' | 'mcp';
  readonly owner: string;
  readonly operation: string;
}): ApplicationOperationId {
  for (const [name, value] of Object.entries(parts)) {
    if (!value.trim() || /[\s?#]/.test(value)) throw new Error(`Application operation ${name} must be a non-empty stable URI path segment.`);
  }
  return `applik8s://${parts.domain}/${parts.owner}/operations/${parts.operation}`;
}

export function validateApplicationOperationCatalog(
  catalog: ApplicationOperationCatalog,
  options: { readonly requireClassified?: boolean } = { requireClassified: true },
): readonly ApplicationAuthorityDiagnostic[] {
  const diagnostics: ApplicationAuthorityDiagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, operation] of catalog.operations.entries()) {
    if (!operation.id.startsWith('applik8s://') || operation.id.includes('/actions/')) {
      diagnostics.push({
        code: 'AUTHORITY_INVALID_OPERATION_ID',
        message: `Operation ${operation.name} must use a stable applik8s://.../operations/... identity.`,
        path: `operations[${index}].id`,
      });
    }
    if (ids.has(operation.id)) {
      diagnostics.push({
        code: 'AUTHORITY_DUPLICATE_OPERATION',
        message: `Operation identity ${operation.id} appears more than once in catalog ${catalog.revision}.`,
        path: `operations[${index}].id`,
      });
    }
    ids.add(operation.id);
    if (options.requireClassified !== false && operation.authority.classification === 'unclassified') {
      diagnostics.push({
        code: 'AUTHORITY_UNCLASSIFIED_OPERATION',
        message: `Operation ${operation.id} is externally reachable but has no authority classification.`,
        path: `operations[${index}].authority.classification`,
      });
    }
    diagnostics.push(...validateApplicationScope(operation.authority.defaultScope, `operations[${index}].authority.defaultScope`));
  }
  return diagnostics;
}

export function validateApplicationAuthorizationReceipt(
  receipt: ApplicationAuthorizationReceipt,
): readonly ApplicationAuthorityDiagnostic[] {
  const diagnostics: ApplicationAuthorityDiagnostic[] = [];
  const candidate = receipt as unknown as Readonly<Record<string, unknown>>;
  const principal = candidate.principal && typeof candidate.principal === 'object'
    ? candidate.principal as Readonly<Record<string, unknown>>
    : undefined;
  if (candidate.apiVersion !== 'applik8s.authorizationReceipt/v1alpha1'
    || !nonEmptyString(candidate.id)
    || !nonEmptyString(candidate.application)
    || !nonEmptyString(candidate.operationId)
    || !candidate.operationId.startsWith('applik8s://')
    || !nonEmptyString(candidate.operationVersion)
    || !nonEmptyString(candidate.catalogRevision)
    || !nonEmptyString(candidate.authorityRevision)) {
    diagnostics.push({
      code: 'AUTHORITY_RETIRED_OPERATION',
      message: 'Authorization receipt identity, operation, catalog, and authority revision fields must be complete.',
      path: 'receipt',
    });
  }
  const identity = principal?.identity && typeof principal.identity === 'object'
    ? principal.identity as Readonly<Record<string, unknown>>
    : undefined;
  if (!principal
    || !nonEmptyString(principal.id)
    || !nonEmptyString(principal.kind)
    || !nonEmptyString(principal.authenticationMethod)
    || !identity
    || !nonEmptyString(identity.id)
    || !nonEmptyString(identity.issuer)
    || !nonEmptyString(identity.subject)
    || principal.catalogRevision !== candidate.catalogRevision
    || principal.authorityRevision !== candidate.authorityRevision) {
    diagnostics.push({
      code: 'AUTHORITY_SCOPE_CONFLICT',
      message: 'Authorization receipt principal revisions must match the admitted catalog and authority revisions.',
      path: 'receipt.principal',
    });
  }
  if (!nonEmptyString(candidate.trustedContextDigest)
    || principal?.trustedContextDigest !== candidate.trustedContextDigest
    || !nonEmptyString(candidate.inputDigest)
    || !nonEmptyString(candidate.audience)
    || !applicationOperationTransports.has(candidate.transport as ApplicationOperationTransport)) {
    diagnostics.push({
      code: 'AUTHORITY_SCOPE_CONFLICT',
      message: 'Authorization receipt context, input, audience, and transport bindings must be complete and consistent.',
      path: 'receipt',
    });
  }
  if (!validIsoTimestamp(candidate.admittedAt)
    || (candidate.expiresAt !== undefined && !validIsoTimestamp(candidate.expiresAt))) {
    diagnostics.push({
      code: 'AUTHORITY_SCOPE_CONFLICT',
      message: 'Authorization receipt admission and expiration times must be valid ISO timestamps.',
      path: 'receipt.admittedAt',
    });
  }
  if (!stringArray(candidate.matchedPermissionIds) || !stringArray(candidate.matchedGrantIds)) {
    diagnostics.push({
      code: 'AUTHORITY_SCOPE_CONFLICT',
      message: 'Authorization receipt permission and grant evidence must be arrays of non-empty identifiers.',
      path: 'receipt.matchedGrantIds',
    });
  }
  if (candidate.target && typeof candidate.target === 'object') {
    diagnostics.push(...validateSerializedReceiptScope(candidate.target, 'receipt.target'));
  } else {
    diagnostics.push({
      code: 'AUTHORITY_INVALID_SCOPE',
      message: 'Authorization receipt target must be a closed scope expression.',
      path: 'receipt.target',
    });
  }
  if (Array.isArray(candidate.scopeEvidence)) {
    for (const [index, scope] of candidate.scopeEvidence.entries()) {
      if (scope && typeof scope === 'object') {
        diagnostics.push(...validateSerializedReceiptScope(scope, `receipt.scopeEvidence[${index}]`));
      } else {
        diagnostics.push({
          code: 'AUTHORITY_INVALID_SCOPE',
          message: 'Authorization receipt scope evidence must contain only closed scope expressions.',
          path: `receipt.scopeEvidence[${index}]`,
        });
      }
    }
  } else {
    diagnostics.push({
      code: 'AUTHORITY_INVALID_SCOPE',
      message: 'Authorization receipt scope evidence must be an array.',
      path: 'receipt.scopeEvidence',
    });
  }
  return diagnostics;
}

const applicationOperationTransports = new Set<ApplicationOperationTransport>([
  'direct',
  'http',
  'mcp',
  'workflow',
  'event',
  'control-plane',
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function validIsoTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function validateSerializedReceiptScope(
  value: object,
  path: string,
): readonly ApplicationAuthorityDiagnostic[] {
  try {
    const diagnostics = validateApplicationScope(value as ApplicationScopeExpression, path);
    return diagnostics ?? [{
      code: 'AUTHORITY_INVALID_SCOPE',
      message: 'Authorization receipt scope uses an unknown expression kind.',
      path,
    }];
  } catch {
    return [{
      code: 'AUTHORITY_INVALID_SCOPE',
      message: 'Authorization receipt scope is structurally invalid.',
      path,
    }];
  }
}

export function scopeContainsUnreviewedCode(expression: ApplicationScopeExpression): boolean {
  // The closed discriminated union is intentionally data-only. This recursive
  // walk also protects callers loading untyped serialized policy.
  const candidate = expression as unknown as Readonly<Record<string, unknown>>;
  if (Object.values(candidate).some((value) => typeof value === 'function')) return true;
  if (expression.kind === 'and' || expression.kind === 'or') return expression.expressions.some(scopeContainsUnreviewedCode);
  if (expression.kind === 'not') return scopeContainsUnreviewedCode(expression.expression);
  if (expression.kind === 'relationship') return scopeContainsUnreviewedCode(expression.target);
  return false;
}

export function validateApplicationScope(
  expression: ApplicationScopeExpression,
  path = 'scope',
): readonly ApplicationAuthorityDiagnostic[] {
  if (scopeContainsUnreviewedCode(expression)) {
    return [{
      code: 'AUTHORITY_INVALID_SCOPE',
      message: 'Authority scopes must be closed data and cannot contain executable functions.',
      path,
    }];
  }
  switch (expression.kind) {
    case 'all':
      return [];
    case 'none':
      return expression.reason.trim()
        ? []
        : [{ code: 'AUTHORITY_INVALID_SCOPE', message: 'A deny-all scope must explain why it is empty.', path: `${path}.reason` }];
    case 'target':
      return expression.model.trim() && Object.keys(expression.identity).length > 0
        ? []
        : [{ code: 'AUTHORITY_INVALID_SCOPE', message: 'An exact target scope requires a model and at least one identity field.', path }];
    case 'and':
    case 'or':
      if (expression.expressions.length === 0) {
        return [{ code: 'AUTHORITY_INVALID_SCOPE', message: `${expression.kind} scope composition must contain at least one expression.`, path }];
      }
      return expression.expressions.flatMap((candidate, index) => validateApplicationScope(candidate, `${path}.expressions[${index}]`));
    case 'not':
      return validateApplicationScope(expression.expression, `${path}.expression`);
    case 'compare':
      return [
        ...validateScopePath(expression.field, `${path}.field`),
        ...validateScopeValue(expression.value, `${path}.value`),
      ];
    case 'in':
      return [
        ...validateScopePath(expression.field, `${path}.field`),
        ...(expression.values.length === 0
          ? [{ code: 'AUTHORITY_INVALID_SCOPE' as const, message: 'A membership scope must contain at least one value.', path: `${path}.values` }]
          : expression.values.flatMap((value, index) => validateScopeValue(value, `${path}.values[${index}]`))),
      ];
    case 'relationship':
      return [
        ...validateScopePath(expression.from, `${path}.from`),
        ...validateScopePath(expression.name, `${path}.name`),
        ...validateScopePath(expression.to, `${path}.to`),
        ...validateApplicationScope(expression.target, `${path}.target`),
      ];
    case 'transport':
      return expression.bindingId.trim()
        ? []
        : [{ code: 'AUTHORITY_INVALID_SCOPE', message: 'A transport scope requires a stable binding id.', path: `${path}.bindingId` }];
    case 'audience':
      return expression.audience.trim()
        ? []
        : [{ code: 'AUTHORITY_INVALID_SCOPE', message: 'An audience scope cannot be empty.', path: `${path}.audience` }];
    case 'trusted-context': {
      const values = Array.isArray(expression.value) ? expression.value : [expression.value];
      return [
        ...validateScopePath(expression.key, `${path}.key`),
        ...(values.length === 0
          ? [{ code: 'AUTHORITY_INVALID_SCOPE' as const, message: 'A trusted-context membership scope must contain at least one value.', path: `${path}.value` }]
          : values.flatMap((value, index) => validateScopeValue(value, `${path}.value[${index}]`))),
      ];
    }
  }
}

function deduplicateScopes(expressions: readonly ApplicationScopeExpression[]): readonly ApplicationScopeExpression[] {
  const seen = new Set<string>();
  const result: ApplicationScopeExpression[] = [];
  for (const expression of expressions) {
    const key = canonicalJson(expression);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(expression);
  }
  return result;
}

function canonicalJson(value: JsonValue | ApplicationScopeExpression): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry as JsonValue)}`).join(',')}}`;
}

function validateScopePath(value: string, path: string): readonly ApplicationAuthorityDiagnostic[] {
  return value.trim() && !value.split('.').some((segment) => !segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor')
    ? []
    : [{ code: 'AUTHORITY_INVALID_SCOPE', message: `Authority scope path ${value || '<empty>'} is invalid.`, path }];
}

function validateScopeValue(value: ApplicationScopeValue, path: string): readonly ApplicationAuthorityDiagnostic[] {
  if (value.kind === 'literal') return [];
  return validateScopePath(value.path, `${path}.path`);
}
