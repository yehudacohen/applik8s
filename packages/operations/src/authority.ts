// typecast-file-boundary: durable authority state is validated and normalized before PostgreSQL/JSON records are restored to canonical grant contracts.
import { createHash, randomUUID } from 'node:crypto';
import type {
  ApplicationApprovalRecord,
  ApplicationAuditEvent,
  ApplicationAuthorityRevisionId,
  ApplicationAuthorizationReceipt,
  ApplicationDelegationRecord,
  ApplicationGrantRecord,
  ApplicationGrantRequestRecord,
  ApplicationGrantReservation,
  ApplicationIdentityReference,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationOperationId,
  ApplicationOperationTransport,
  ApplicationOutcomeDefinition,
  ApplicationPermissionRecord,
  ApplicationPrincipal,
  ApplicationRevocationTombstone,
  ApplicationRoleRecord,
  ApplicationScopeExpression,
  ApplicationStaticAuthorityManifest,
  ApplicationStaticRoleBootstrapDefinition,
} from '@applik8s/core';
import {
  intersectApplicationScopes,
  normalizeApplicationScope,
  validateApplicationScope,
} from '@applik8s/core';
import { compareApplicationOperationCatalogs } from './catalog.js';

export interface ApplicationAuthoritySnapshot {
  readonly revision: ApplicationAuthorityRevisionId;
  readonly permissions: readonly ApplicationPermissionRecord[];
  readonly roles: readonly ApplicationRoleRecord[];
  readonly grants: readonly ApplicationGrantRecord[];
  readonly delegations: readonly ApplicationDelegationRecord[];
  readonly requests: readonly ApplicationGrantRequestRecord[];
  readonly approvals: readonly ApplicationApprovalRecord[];
  readonly outcomes: readonly ApplicationOutcomeDefinition[];
  readonly reservations: readonly ApplicationGrantReservation[];
  readonly tombstones: readonly ApplicationRevocationTombstone[];
}

export interface ApplicationAuthorityRepository {
  snapshot(): Promise<ApplicationAuthoritySnapshot>;
  putPermission(record: ApplicationPermissionRecord): Promise<void>;
  putRole(record: ApplicationRoleRecord): Promise<void>;
  putGrant(record: ApplicationGrantRecord): Promise<void>;
  putDelegation(record: ApplicationDelegationRecord): Promise<void>;
  putRequest(record: ApplicationGrantRequestRecord): Promise<void>;
  putApproval(record: ApplicationApprovalRecord): Promise<void>;
  putOutcome(record: ApplicationOutcomeDefinition): Promise<void>;
  putReservation(record: ApplicationGrantReservation): Promise<void>;
  putTombstone(record: ApplicationRevocationTombstone): Promise<void>;
  putCatalogReference?(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
    operationIds?: readonly ApplicationOperationId[],
  ): Promise<void>;
  removeCatalogReference?(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void>;
  appendAudit(event: ApplicationAuditEvent): Promise<void>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface ApplicationAuthorizationRequest {
  readonly application: string;
  readonly catalog: ApplicationOperationCatalog;
  readonly operation: ApplicationOperationDescriptor;
  readonly principal: ApplicationPrincipal;
  readonly target: ApplicationScopeExpression;
  readonly scopeEvidence?: readonly ApplicationScopeExpression[];
  readonly audience: string;
  readonly transport: ApplicationOperationTransport;
  readonly inputDigest: string;
  readonly trustedContextDigest: string;
  readonly idempotencyKey?: string;
  readonly commandId?: string;
  readonly targetDigest?: string;
  /** Normalized result of an explicitly declared application-policy hook. */
  readonly applicationPolicyAllowed?: boolean;
}

export type ApplicationAuthorizationResult =
  | {
    readonly allowed: true;
    readonly receipt: ApplicationAuthorizationReceipt;
    readonly reservation?: ApplicationGrantReservation;
  }
  | {
    readonly allowed: false;
    readonly code: ApplicationAuthorizationDenialCode;
    readonly message: string;
  };

export interface ApplicationAuthorityManifest {
  readonly revision: string;
  readonly permissions: readonly ApplicationPermissionRecord[];
  readonly roles: readonly ApplicationRoleRecord[];
  readonly grants: readonly ApplicationGrantRecord[];
}

export interface ApplicationGrantDecision {
  readonly approval: ApplicationApprovalRecord;
  readonly grant?: ApplicationGrantRecord;
}

export interface ApplicationRoleBootstrapRequest {
  readonly id: string;
  readonly roleId: string;
  readonly identity: ApplicationIdentityReference;
  readonly issuedBy: ApplicationIdentityReference;
  readonly reason: string;
}

export interface ApplicationBreakGlassRoleRequest
  extends ApplicationRoleBootstrapRequest {
  readonly expiresAt: string;
  readonly acknowledgement: string;
}

export type ApplicationAuthorizationDenialCode =
  | 'AUTHORIZATION_CATALOG_INACTIVE'
  | 'AUTHORIZATION_OPERATION_UNCLASSIFIED'
  | 'AUTHORIZATION_OPERATION_MISMATCH'
  | 'AUTHORIZATION_CONTEXT_MISMATCH'
  | 'AUTHORIZATION_AUDIENCE_DENIED'
  | 'AUTHORIZATION_TRANSPORT_DENIED'
  | 'AUTHORIZATION_POLICY_DENIED'
  | 'AUTHORIZATION_NO_GRANT'
  | 'AUTHORIZATION_SCOPE_EMPTY'
  | 'AUTHORIZATION_GRANT_EXHAUSTED'
  | 'AUTHORIZATION_GRANT_REVOKED'
  | 'AUTHORIZATION_GRANT_EXPIRED';

export class ApplicationAuthorityService {
  readonly #repository: ApplicationAuthorityRepository;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(
    repository: ApplicationAuthorityRepository,
    options: { readonly now?: () => Date; readonly id?: () => string } = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
  }

  async reconcileApplicationPermissions(
    manifestRevision: string,
    desired: readonly ApplicationPermissionRecord[],
  ): Promise<readonly ApplicationPermissionRecord[]> {
    return this.#repository.transaction(async () => {
      const current = await this.#repository.snapshot();
      const desiredById = new Map(desired.map((permission) => [permission.id, permission]));
      for (const permission of desired) {
        assertAuthorityRecordOrigin(permission.origin, 'application', permission.id);
        assertAuthorityCatalogRevision(permission.catalogRevision, permission.id);
        if (permission.manifestRevision !== manifestRevision) {
          throw new ApplicationAuthorityError('AUTHORITY_MANIFEST_REVISION_MISMATCH', `Permission ${permission.id} does not carry manifest revision ${manifestRevision}.`);
        }
        const existing = current.permissions.find((candidate) => candidate.id === permission.id);
        if (existing?.origin === 'runtime') {
          throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Application permission ${permission.id} cannot shadow a runtime permission.`);
        }
        validateScopeOrThrow(permission.scope, `permissions.${permission.id}.scope`);
        await this.#repository.putPermission(permission);
      }
      const retiredAt = this.#now().toISOString();
      for (const permission of current.permissions) {
        if (permission.origin !== 'application' || permission.retiredAt || desiredById.has(permission.id)) continue;
        await this.#repository.putPermission({ ...permission, retiredAt });
      }
      return (await this.#repository.snapshot()).permissions.filter((permission) => permission.origin === 'application');
    });
  }

  async createRuntimePermission(
    record: ApplicationPermissionRecord,
  ): Promise<ApplicationPermissionRecord> {
    return this.#repository.transaction(async () => {
      assertAuthorityRecordOrigin(record.origin, 'runtime', record.id);
      assertAuthorityCatalogRevision(record.catalogRevision, record.id);
      validateScopeOrThrow(record.scope, `permissions.${record.id}.scope`);
      const existing = (await this.#repository.snapshot()).permissions.find((candidate) => candidate.id === record.id);
      if (existing) {
        throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Permission ${record.id} already exists and cannot be overwritten.`);
      }
      await this.#repository.putPermission(record);
      return record;
    });
  }

  async createRuntimeRole(record: ApplicationRoleRecord): Promise<ApplicationRoleRecord> {
    return this.#repository.transaction(async () => {
      assertAuthorityRecordOrigin(record.origin, 'runtime', record.id);
      const state = await this.#repository.snapshot();
      if (state.roles.some((candidate) => candidate.id === record.id)) {
        throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Role ${record.id} already exists and cannot be overwritten.`);
      }
      const missing = record.permissionIds.filter((permissionId) =>
        !state.permissions.some((permission) => permission.id === permissionId && !permission.retiredAt));
      if (missing.length > 0) {
        throw new ApplicationAuthorityError('AUTHORITY_PERMISSION_UNAVAILABLE', `Role ${record.id} references unavailable permissions: ${missing.join(', ')}.`);
      }
      await this.#repository.putRole(record);
      await this.#audit('role.created', state.revision, {
        details: { roleId: record.id, permissionIds: [...record.permissionIds] },
      });
      return record;
    });
  }

  async reconcileApplicationAuthority(manifest: ApplicationAuthorityManifest): Promise<ApplicationAuthoritySnapshot> {
    return this.#repository.transaction(() => this.#reconcileApplicationAuthority(manifest));
  }

  async #reconcileApplicationAuthority(manifest: ApplicationAuthorityManifest): Promise<ApplicationAuthoritySnapshot> {
      const current = await this.#repository.snapshot();
      const desiredPermissionIds = new Set(manifest.permissions.map((record) => record.id));
      const desiredRoleIds = new Set(manifest.roles.map((record) => record.id));
      const desiredGrantIds = new Set(manifest.grants.map((record) => record.id));
      for (const permission of manifest.permissions) {
        assertAuthorityRecordOrigin(permission.origin, 'application', permission.id);
        assertAuthorityCatalogRevision(permission.catalogRevision, permission.id);
        if (permission.manifestRevision !== manifest.revision) {
          throw new ApplicationAuthorityError('AUTHORITY_MANIFEST_REVISION_MISMATCH', `Permission ${permission.id} does not carry manifest revision ${manifest.revision}.`);
        }
        validateScopeOrThrow(permission.scope, `permissions.${permission.id}.scope`);
        if (current.permissions.some((candidate) => candidate.id === permission.id && candidate.origin === 'runtime')) {
          throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Application permission ${permission.id} cannot shadow a runtime permission.`);
        }
        const existing = current.permissions.find((candidate) => candidate.id === permission.id);
        if (!existing || stableJson(existing) !== stableJson(permission)) {
          await this.#repository.putPermission(permission);
        }
      }
      for (const role of manifest.roles) {
        assertAuthorityRecordOrigin(role.origin, 'application', role.id);
        if (current.roles.some((candidate) => candidate.id === role.id && candidate.origin === 'runtime')) {
          throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Application role ${role.id} cannot shadow a runtime role.`);
        }
        const unavailable = role.permissionIds.filter((permissionId) => !desiredPermissionIds.has(permissionId)
          && !current.permissions.some((permission) => permission.id === permissionId && !permission.retiredAt));
        if (unavailable.length > 0) {
          throw new ApplicationAuthorityError('AUTHORITY_PERMISSION_UNAVAILABLE', `Role ${role.id} references unavailable permissions: ${unavailable.join(', ')}.`);
        }
        const existing = current.roles.find((candidate) => candidate.id === role.id);
        if (!existing || stableJson(existing) !== stableJson(role)) {
          await this.#repository.putRole(role);
        }
      }
      for (const grant of manifest.grants) {
        assertAuthorityRecordOrigin(grant.origin, 'application', grant.id);
        const grantState = await this.#repository.snapshot();
        if (grantState.grants.some((candidate) => candidate.id === grant.id && candidate.origin === 'runtime')) {
          throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Application grant ${grant.id} cannot shadow a runtime grant.`);
        }
        this.#validateGrant(grant, grantState, { requireGrantablePermission: false });
        const existing = grantState.grants.find((candidate) => candidate.id === grant.id);
        if (!existing || stableJson(existing) !== stableJson(grant)) {
          await this.#putGrant(grant);
        }
      }
      const retiredAt = this.#now().toISOString();
      for (const permission of current.permissions) {
        if (permission.origin === 'application' && !permission.retiredAt && !desiredPermissionIds.has(permission.id)) {
          await this.#repository.putPermission({ ...permission, retiredAt });
        }
      }
      for (const role of current.roles) {
        if (role.origin === 'application' && !role.retiredAt && !desiredRoleIds.has(role.id)) {
          await this.#repository.putRole({ ...role, retiredAt });
        }
      }
      for (const grant of current.grants) {
        if (grant.origin === 'application' && !grant.revokedAt && !desiredGrantIds.has(grant.id)) {
          await this.#putGrant({ ...grant, revokedAt: retiredAt });
        }
      }
      return this.#repository.snapshot();
  }

  async reconcileStaticAuthorityManifest(
    manifest: ApplicationStaticAuthorityManifest,
    catalogRevision: string,
  ): Promise<ApplicationAuthoritySnapshot> {
    return this.#repository.transaction(async () => {
      const current = await this.#repository.snapshot();
      const now = this.#now().toISOString();
      const identities = new Map(manifest.identities.map((identity) => [identity.id, identity]));
      if (identities.size !== manifest.identities.length) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_MANIFEST_IDENTITY_CONFLICT',
          `Static authority manifest ${manifest.revision} contains duplicate identity references.`,
        );
      }
      const permissions: ApplicationPermissionRecord[] = manifest.permissions.map((definition) => ({
        apiVersion: 'applik8s.permission/v1alpha1',
        id: definition.id,
        name: definition.name,
        origin: 'application',
        manifestRevision: manifest.revision,
        catalogRevision,
        operationIds: definition.operationIds,
        scope: definition.scope,
        ...(definition.transports ? { transports: definition.transports } : {}),
        ...(definition.audiences ? { audiences: definition.audiences } : {}),
        grantable: definition.grantable,
        ...(definition.lifecycleOwner ? { lifecycleOwner: definition.lifecycleOwner } : {}),
        createdAt: current.permissions.find((candidate) => candidate.id === definition.id)?.createdAt ?? now,
      }));
      const roles: ApplicationRoleRecord[] = manifest.roles.map((definition) => ({
        apiVersion: 'applik8s.role/v1alpha1',
        id: definition.id,
        name: definition.name,
        origin: 'application',
        permissionIds: definition.permissionIds,
        ...(definition.lifecycleOwner ? { lifecycleOwner: definition.lifecycleOwner } : {}),
        createdAt: current.roles.find((candidate) => candidate.id === definition.id)?.createdAt ?? now,
      }));
      const grants: ApplicationGrantRecord[] = manifest.grants.map((definition) => {
        if (!identities.has(definition.identity.id) || !identities.has(definition.issuedBy.id)) {
          throw new ApplicationAuthorityError(
            'AUTHORITY_MANIFEST_IDENTITY_CONFLICT',
            `Static grant ${definition.id} references an identity not declared by manifest ${manifest.revision}.`,
          );
        }
        return {
          apiVersion: 'applik8s.grant/v1alpha1',
          id: definition.id,
          origin: 'application',
          identity: definition.identity,
          ...(definition.permissionId ? { permissionId: definition.permissionId } : {}),
          operationIds: definition.operationIds,
          scope: definition.scope,
          ...(definition.audiences ? { audiences: definition.audiences } : {}),
          ...(definition.transports ? { transports: definition.transports } : {}),
          issuedBy: definition.issuedBy,
          ...(definition.canGrant ? { canGrant: true } : {}),
          ...(definition.lifecycleOwner ? { lifecycleOwner: definition.lifecycleOwner } : {}),
          ...(definition.reason ? { reason: definition.reason } : {}),
          ...(definition.maximumUses !== undefined ? { maximumUses: definition.maximumUses } : {}),
          ...(definition.expiresAt ? { expiresAt: definition.expiresAt } : {}),
          ...(definition.outcomeId ? { outcomeId: definition.outcomeId } : {}),
          catalogRevision,
          authorityRevision: current.grants.find((candidate) => candidate.id === definition.id)?.authorityRevision ?? current.revision,
          createdAt: current.grants.find((candidate) => candidate.id === definition.id)?.createdAt ?? now,
        };
      });
      for (const outcome of manifest.outcomes) {
        await this.#registerOutcome(outcome);
      }
      return this.#reconcileApplicationAuthority({
        revision: manifest.revision,
        permissions,
        roles,
        grants,
      });
    });
  }

  async registerOutcome(record: ApplicationOutcomeDefinition): Promise<ApplicationOutcomeDefinition> {
    return this.#repository.transaction(() => this.#registerOutcome(record));
  }

  async #registerOutcome(record: ApplicationOutcomeDefinition): Promise<ApplicationOutcomeDefinition> {
      const state = await this.#repository.snapshot();
      const existing = state.outcomes.find((candidate) => candidate.id === record.id);
      if (existing && stableJson(existing) !== stableJson(record)) {
        throw new ApplicationAuthorityError('AUTHORITY_OUTCOME_CONFLICT', `Outcome ${record.id} already exists with different semantics.`);
      }
      validateScopeOrThrow(record.predicate, `outcomes.${record.id}.predicate`);
      if (!existing) await this.#repository.putOutcome(record);
      return existing ?? record;
  }

  async requestGrant(record: ApplicationGrantRequestRecord): Promise<ApplicationGrantRequestRecord> {
    return this.#repository.transaction(async () => {
      if (record.state !== 'pending') {
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_INVALID_STATE', `New grant request ${record.id} must be pending.`);
      }
      validateScopeOrThrow(record.scope, `grantRequests.${record.id}.scope`);
      const state = await this.#repository.snapshot();
      const existing = state.requests.find((candidate) => candidate.id === record.id);
      if (existing) {
        if (stableJson(existing) === stableJson(record)) return existing;
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Grant request ${record.id} already exists with different terms.`);
      }
      await this.#repository.putRequest(record);
      await this.#audit('grant.requested', state.revision, {
        principal: record.requester,
        details: { requestId: record.id, operationIds: [...record.operationIds] },
      });
      return record;
    });
  }

  async decideGrantRequest(requestId: string, decision: ApplicationGrantDecision): Promise<ApplicationGrantRequestRecord> {
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const request = state.requests.find((candidate) => candidate.id === requestId);
      if (!request) throw new ApplicationAuthorityError('AUTHORITY_REQUEST_UNAVAILABLE', `Grant request ${requestId} does not exist.`);
      if (request.state !== 'pending') {
        const existingApproval = state.approvals.find((candidate) => candidate.id === decision.approval.id);
        if (existingApproval && stableJson(existingApproval) === stableJson(decision.approval)) return request;
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_INVALID_STATE', `Grant request ${requestId} is already ${request.state}.`);
      }
      if (decision.approval.requestId !== request.id) {
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Approval ${decision.approval.id} does not belong to request ${request.id}.`);
      }
      if (decision.approval.approver.id === request.requester.id) {
        throw new ApplicationAuthorityError('AUTHORITY_SELF_APPROVAL', `Requester ${request.requester.id} cannot approve its own grant request.`);
      }
      const approved = decision.approval.decision === 'approve';
      if (approved && !decision.grant) {
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Approved request ${request.id} requires a materialized grant.`);
      }
      if (!approved && decision.grant) {
        throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Rejected request ${request.id} cannot create a grant.`);
      }
      if (decision.grant) {
        if (decision.grant.identity.id !== request.requester.id) {
          throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Grant ${decision.grant.id} must target request principal ${request.requester.id}.`);
        }
        assertSubset(decision.grant.operationIds, request.operationIds, 'operation', decision.grant.id);
        assertScopeNotBroader(decision.grant.scope, request.scope, decision.grant.id);
        if (request.requestedMaximumUses !== undefined
          && (decision.grant.maximumUses === undefined || decision.grant.maximumUses > request.requestedMaximumUses)) {
          throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Grant ${decision.grant.id} exceeds request ${request.id} maximum uses.`);
        }
        if (request.requestedExpiresAt
          && (!decision.grant.expiresAt || decision.grant.expiresAt > request.requestedExpiresAt)) {
          throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Grant ${decision.grant.id} exceeds request ${request.id} expiry.`);
        }
        if (request.requiredOutcomeId !== decision.grant.outcomeId) {
          throw new ApplicationAuthorityError('AUTHORITY_REQUEST_CONFLICT', `Grant ${decision.grant.id} must preserve request ${request.id} outcome requirement.`);
        }
        const outcome = decision.grant.outcomeId
          ? state.outcomes.find((candidate) => candidate.id === decision.grant?.outcomeId)
          : undefined;
        if (decision.grant.outcomeId && !outcome) {
          throw new ApplicationAuthorityError('AUTHORITY_OUTCOME_UNAVAILABLE', `Grant ${decision.grant.id} references unavailable outcome ${decision.grant.outcomeId}.`);
        }
        if (outcome && (outcome.verifier.id === decision.grant.identity.id
          || decision.grant.operationIds.includes(outcome.observationOperationId))) {
          throw new ApplicationAuthorityError('AUTHORITY_OUTCOME_SELF_VERIFICATION', `Grant ${decision.grant.id} cannot verify its own required outcome.`);
        }
        this.#validateGrant(decision.grant, state, { requireGrantablePermission: true });
        await this.#putGrant(decision.grant);
      }
      const decided: ApplicationGrantRequestRecord = {
        ...request,
        state: approved ? 'approved' : 'rejected',
        decidedAt: decision.approval.decidedAt,
      };
      await this.#repository.putApproval(decision.approval);
      await this.#repository.putRequest(decided);
      await this.#audit(approved ? 'grant.approved' : 'grant.rejected', state.revision, {
        principal: decision.approval.approver,
        details: {
          requestId,
          approvalId: decision.approval.id,
          ...(decision.grant ? { grantId: decision.grant.id } : {}),
        },
      });
      return decided;
    });
  }

  async assignGrant(record: ApplicationGrantRecord): Promise<ApplicationGrantRecord> {
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const existing = state.grants.find((candidate) => candidate.id === record.id);
      if (existing) {
        if (stableJson(existing) === stableJson(record)) return existing;
        throw new ApplicationAuthorityError('AUTHORITY_GRANT_CONFLICT', `Grant ${record.id} already exists with different immutable authority.`);
      }
      this.#validateGrant(record, state, { requireGrantablePermission: record.origin === 'runtime' });
      await this.#putGrant(record);
      await this.#audit('grant.assigned', record.authorityRevision, {
        principal: record.issuedBy,
        details: { grantId: record.id, identityId: record.identity.id },
      });
      return record;
    });
  }

  /**
   * Materializes an application-declared one-time role bootstrap only after
   * the identity provider has admitted the exact identity. The first active
   * assignee closes the bootstrap permanently; ordinary revocation cannot
   * accidentally reopen it for a different subject.
   */
  async bootstrapDeclaredRole(
    bootstrap: ApplicationStaticRoleBootstrapDefinition,
    admittedIdentity: ApplicationIdentityReference,
  ): Promise<readonly ApplicationGrantRecord[]> {
    return this.#repository.transaction(async () => {
      if (!sameIdentity(bootstrap.identity, admittedIdentity)) return [];
      const state = await this.#repository.snapshot();
      const role = state.roles.find(
        (candidate) => candidate.id === bootstrap.roleId && !candidate.retiredAt,
      );
      if (!role) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_UNAVAILABLE',
          `Role bootstrap ${bootstrap.id} references unavailable role ${bootstrap.roleId}.`,
        );
      }
      if (role.permissionIds.length === 0) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_UNAVAILABLE',
          `Role bootstrap ${bootstrap.id} cannot assign role ${role.name} before it has permissions.`,
        );
      }
      const now = this.#now();
      const lifecycleOwner = applicationRoleBootstrapOwner(bootstrap.roleId);
      const historicalRoleGrants = state.grants.filter(
        (grant) => grant.lifecycleOwner === lifecycleOwner,
      );
      if (historicalRoleGrants.length > 0) {
        return historicalRoleGrants.every((grant) =>
          sameIdentity(grant.identity, admittedIdentity))
          ? historicalRoleGrants.filter(
              (grant) => !grant.revokedAt && !isExpired(grant.expiresAt, now),
            )
          : [];
      }
      const createdAt = now.toISOString();
      const grants: ApplicationGrantRecord[] = [];
      for (const permissionId of role.permissionIds) {
        const permission = state.permissions.find(
          (candidate) => candidate.id === permissionId && !candidate.retiredAt,
        );
        if (!permission) {
          throw new ApplicationAuthorityError(
            'AUTHORITY_PERMISSION_UNAVAILABLE',
            `Role bootstrap ${bootstrap.id} references unavailable permission ${permissionId}.`,
          );
        }
        const grant: ApplicationGrantRecord = {
          apiVersion: 'applik8s.grant/v1alpha1',
          id: `${bootstrap.id}:${permission.id}`,
          origin: 'runtime',
          identity: admittedIdentity,
          permissionId: permission.id,
          operationIds: permission.operationIds,
          scope: permission.scope,
          ...(permission.audiences
            ? { audiences: permission.audiences }
            : {}),
          ...(permission.transports
            ? { transports: permission.transports }
            : {}),
          issuedBy: bootstrap.issuedBy,
          lifecycleOwner,
          reason: bootstrap.reason,
          catalogRevision: permission.catalogRevision,
          authorityRevision: state.revision,
          createdAt,
        };
        this.#validateGrant(grant, state, {
          requireGrantablePermission: false,
        });
        await this.#putGrant(grant);
        await this.#audit('grant.assigned', grant.authorityRevision, {
          principal: bootstrap.issuedBy,
          details: {
            grantId: grant.id,
            identityId: admittedIdentity.id,
            bootstrapId: bootstrap.id,
            roleId: role.id,
          },
        });
        grants.push(grant);
      }
      return grants;
    });
  }

  /**
   * Deployment-owner bootstrap for Dedicated and External installations. It
   * shares the same role-level one-shot lease as a declared local bootstrap,
   * so changing provider subjects or revoking the initial owner can never
   * reopen bootstrap implicitly.
   */
  bootstrapRole(
    request: ApplicationRoleBootstrapRequest,
  ): Promise<readonly ApplicationGrantRecord[]> {
    if (!request.reason.trim()) {
      throw new ApplicationAuthorityError(
        'AUTHORITY_GRANT_CONFLICT',
        'Application role bootstrap requires a non-empty audited reason.',
      );
    }
    assertBootstrapIdentity(request.identity, 'bootstrap identity');
    assertBootstrapIdentity(request.issuedBy, 'bootstrap issuer');
    return this.bootstrapDeclaredRole({
      id: request.id,
      roleId: request.roleId,
      identity: request.identity,
      issuedBy: request.issuedBy,
      reason: request.reason,
    }, request.identity);
  }

  /**
   * Explicit bounded recovery authority. Break-glass never reopens or mutates
   * the one-time bootstrap lease and is capped at twenty-four hours.
   */
  async assignBreakGlassRole(
    request: ApplicationBreakGlassRoleRequest,
  ): Promise<readonly ApplicationGrantRecord[]> {
    assertBootstrapIdentity(request.identity, 'break-glass identity');
    assertBootstrapIdentity(request.issuedBy, 'break-glass issuer');
    if (!request.reason.trim() || !request.acknowledgement.trim()) {
      throw new ApplicationAuthorityError(
        'AUTHORITY_GRANT_CONFLICT',
        'Break-glass authority requires an explicit acknowledgement and audited reason.',
      );
    }
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const now = this.#now();
      const expiresAt = new Date(request.expiresAt);
      const maximumExpiry = now.getTime() + 24 * 60 * 60 * 1_000;
      if (
        Number.isNaN(expiresAt.getTime())
        || expiresAt.getTime() <= now.getTime()
        || expiresAt.getTime() > maximumExpiry
      ) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_BREAK_GLASS_ACKNOWLEDGEMENT_REQUIRED',
          'Break-glass expiry must be in the future and no more than 24 hours from issuance.',
        );
      }
      const role = state.roles.find(
        (candidate) => candidate.id === request.roleId && !candidate.retiredAt,
      );
      if (!role || role.permissionIds.length === 0) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_UNAVAILABLE',
          `Break-glass request ${request.id} references unavailable or empty role ${request.roleId}.`,
        );
      }
      const lifecycleOwner = `application-role-break-glass:${request.roleId}:${request.id}`;
      const existing = state.grants.filter(
        (grant) => grant.lifecycleOwner === lifecycleOwner,
      );
      if (existing.length > 0) {
        const sameTerms = existing.every(
          (grant) =>
            sameIdentity(grant.identity, request.identity)
            && grant.expiresAt === expiresAt.toISOString(),
        );
        if (!sameTerms) {
          throw new ApplicationAuthorityError(
            'AUTHORITY_GRANT_CONFLICT',
            `Break-glass request ${request.id} already exists with different terms.`,
          );
        }
        return existing;
      }
      const grants: ApplicationGrantRecord[] = [];
      for (const permissionId of role.permissionIds) {
        const permission = state.permissions.find(
          (candidate) => candidate.id === permissionId && !candidate.retiredAt,
        );
        if (!permission) {
          throw new ApplicationAuthorityError(
            'AUTHORITY_PERMISSION_UNAVAILABLE',
            `Break-glass role ${role.id} references unavailable permission ${permissionId}.`,
          );
        }
        const grant: ApplicationGrantRecord = {
          apiVersion: 'applik8s.grant/v1alpha1',
          id: `${lifecycleOwner}:${permission.id}`,
          origin: 'runtime',
          identity: request.identity,
          permissionId: permission.id,
          operationIds: permission.operationIds,
          scope: permission.scope,
          ...(permission.audiences ? { audiences: permission.audiences } : {}),
          ...(permission.transports ? { transports: permission.transports } : {}),
          issuedBy: request.issuedBy,
          lifecycleOwner,
          reason: request.reason,
          expiresAt: expiresAt.toISOString(),
          catalogRevision: permission.catalogRevision,
          authorityRevision: state.revision,
          createdAt: now.toISOString(),
        };
        this.#validateGrant(grant, state, { requireGrantablePermission: false });
        await this.#putGrant(grant);
        grants.push(grant);
      }
      await this.#audit('break-glass', state.revision, {
        principal: request.issuedBy,
        details: {
          requestId: request.id,
          roleId: role.id,
          identityId: request.identity.id,
          expiresAt: expiresAt.toISOString(),
          acknowledgement: request.acknowledgement,
          grantIds: grants.map((grant) => grant.id),
        },
      });
      return grants;
    });
  }

  /** Revokes every active permission grant that currently backs one role. */
  async revokeRoleForIdentity(
    roleId: string,
    identity: ApplicationIdentityReference,
    reason: string,
  ): Promise<readonly ApplicationGrantRecord[]> {
    if (!reason.trim()) {
      throw new ApplicationAuthorityError(
        'AUTHORITY_GRANT_CONFLICT',
        'Role revocation requires a non-empty audited reason.',
      );
    }
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const role = state.roles.find((candidate) => candidate.id === roleId);
      if (!role) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_UNAVAILABLE',
          `Cannot revoke unavailable role ${roleId}.`,
        );
      }
      const permissionIds = new Set(role.permissionIds);
      const grants = state.grants.filter(
        (grant) =>
          !grant.revokedAt
          && sameIdentity(grant.identity, identity)
          && Boolean(grant.permissionId && permissionIds.has(grant.permissionId)),
      );
      const revoked: ApplicationGrantRecord[] = [];
      for (const grant of grants) {
        revoked.push(await this.#revokeGrant(grant.id, reason));
      }
      return revoked;
    });
  }

  /** Returns only roles fully backed by active canonical grants. */
  async grantedRolesForIdentity(
    identity: ApplicationIdentityReference,
  ): Promise<readonly string[]> {
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const now = this.#now();
      const permissionIds = new Set(
        state.grants
          .filter(
            (grant) =>
              sameIdentity(grant.identity, identity)
              && !grant.revokedAt
              && !isExpired(grant.expiresAt, now),
          )
          .flatMap((grant) => grant.permissionId ? [grant.permissionId] : []),
      );
      return state.roles
        .filter(
          (role) =>
            !role.retiredAt
            && role.permissionIds.length > 0
            && role.permissionIds.every((permissionId) =>
              permissionIds.has(permissionId)),
        )
        .map((role) => role.name)
        .sort();
    });
  }

  async migrateCatalogAuthority(
    from: ApplicationOperationCatalog,
    to: ApplicationOperationCatalog,
    nextAuthorityRevision: ApplicationAuthorityRevisionId,
  ): Promise<ApplicationAuthoritySnapshot> {
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      if (from.application !== to.application
        || (from.state !== 'active' && from.state !== 'draining')
        || (to.state !== 'staged' && to.state !== 'active')) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_CATALOG_MIGRATION_INVALID',
          'Authority catalog migration must move from one active/draining revision to one staged/active revision of the same application.',
        );
      }
      const report = compareApplicationOperationCatalogs(from, to);
      const migrateOperationIds = (operationIds: readonly ApplicationOperationId[], owner: string) => operationIds.map((operationId) => {
        const change = report.changes.find((candidate) => candidate.operationId === operationId);
        if (!change) {
          throw new ApplicationAuthorityError('AUTHORITY_CATALOG_MIGRATION_INVALID', `${owner} operation ${operationId} has no catalog migration result.`);
        }
        if (change.kind === 'compatible') return operationId;
        if (change.kind === 'replaced' && change.replacement?.compatible && change.replacement.migration) {
          return change.replacement.operationId;
        }
        throw new ApplicationAuthorityError(
          'AUTHORITY_CATALOG_MIGRATION_INVALID',
          `${owner} operation ${operationId} requires an explicit compatible replacement migration before activation.`,
        );
      });

      const migratedPermissions = new Map(
        state.permissions
          .filter((permission) => !permission.retiredAt && permission.catalogRevision === from.revision)
          .map((permission) => [permission.id, {
            ...permission,
            operationIds: [...new Set(migrateOperationIds(permission.operationIds, `Permission ${permission.id}`))].sort(),
            catalogRevision: to.revision,
          } satisfies ApplicationPermissionRecord]),
      );
      const migrationState: ApplicationAuthoritySnapshot = {
        ...state,
        permissions: state.permissions.map((permission) =>
          migratedPermissions.get(permission.id) ?? permission),
      };
      const migratedGrants = state.grants
        .filter((grant) => !grant.revokedAt
          && !isExpired(grant.expiresAt, this.#now())
          && grant.catalogRevision === from.revision)
        .map((grant) => ({
          ...grant,
          operationIds: [...new Set(migrateOperationIds(grant.operationIds, `Grant ${grant.id}`))].sort(),
          catalogRevision: to.revision,
          authorityRevision: nextAuthorityRevision,
        } satisfies ApplicationGrantRecord));
      const migratedGrantById = new Map(
        migratedGrants.map((grant) => [grant.id, grant]),
      );
      const grantValidationState: ApplicationAuthoritySnapshot = {
        ...migrationState,
        grants: state.grants.map((grant) =>
          migratedGrantById.get(grant.id) ?? grant),
      };

      for (const grant of migratedGrants) {
        this.#validateGrant(grant, grantValidationState, {
          // Ordinary runtime grants must continue to derive from explicitly
          // grantable authority after a catalog migration. Framework-managed
          // operator bootstrap and break-glass leases are different: they are
          // intentionally allowed to materialize non-grantable role
          // permissions through audited, one-shot system paths. Requiring
          // grantable=true here makes every later catalog rollout fail after
          // the first operator admission.
          requireGrantablePermission:
            grant.origin === 'runtime'
            && !isFrameworkManagedRoleLease(grant.lifecycleOwner),
        });
      }
      for (const permission of migratedPermissions.values()) {
        await this.#repository.putPermission(permission);
      }
      for (const grant of migratedGrants) {
        await this.#repository.putGrant(grant);
        await this.#repository.removeCatalogReference?.(from.revision, 'grant', grant.id);
        await this.#repository.putCatalogReference?.(
          to.revision,
          'grant',
          grant.id,
          grant.operationIds,
        );
      }
      for (const grant of state.grants.filter((candidate) =>
        candidate.catalogRevision === from.revision
        && !candidate.revokedAt
        && isExpired(candidate.expiresAt, this.#now()))) {
        await this.#repository.removeCatalogReference?.(from.revision, 'grant', grant.id);
        await this.#audit('grant.expired', nextAuthorityRevision, {
          principal: grant.issuedBy,
          details: { grantId: grant.id, fromRevision: from.revision },
        });
      }
      for (const grant of migratedGrants) {
        await this.#audit('grant.migrated', nextAuthorityRevision, {
          principal: grant.issuedBy,
          details: {
            grantId: grant.id,
            fromRevision: from.revision,
            toRevision: to.revision,
            operationIds: [...grant.operationIds],
          },
        });
      }
      return this.#repository.snapshot();
    });
  }

  /** @deprecated Catalog meaning is shared; migrate every live permission and grant atomically. */
  async migrateGrantCatalog(
    grantId: string,
    from: ApplicationOperationCatalog,
    to: ApplicationOperationCatalog,
    nextAuthorityRevision: ApplicationAuthorityRevisionId,
  ): Promise<ApplicationGrantRecord> {
    const before = (await this.#repository.snapshot()).grants.find((candidate) =>
      candidate.id === grantId && !candidate.revokedAt);
    if (!before || before.catalogRevision !== from.revision) {
      throw new ApplicationAuthorityError('AUTHORITY_GRANT_UNAVAILABLE', `Grant ${grantId} is unavailable for catalog migration.`);
    }
    const migrated = await this.migrateCatalogAuthority(from, to, nextAuthorityRevision);
    const grant = migrated.grants.find((candidate) => candidate.id === grantId);
    if (!grant || grant.catalogRevision !== to.revision) {
      throw new ApplicationAuthorityError('AUTHORITY_CATALOG_MIGRATION_INVALID', `Grant ${grantId} did not migrate to catalog ${to.revision}.`);
    }
    return grant;
  }

  #validateGrant(
    record: ApplicationGrantRecord,
    state: ApplicationAuthoritySnapshot,
    options: { readonly requireGrantablePermission: boolean },
  ): void {
    validateScopeOrThrow(record.scope, `grants.${record.id}.scope`);
    if (record.identity.id === record.issuedBy.id && record.origin === 'runtime') {
      throw new ApplicationAuthorityError('AUTHORITY_SELF_GRANT', `Runtime principal ${record.identity.id} cannot grant authority to itself.`);
    }
    if (record.operationIds.length === 0) {
      throw new ApplicationAuthorityError('AUTHORITY_GRANT_CONFLICT', `Grant ${record.id} must contain at least one operation.`);
    }
    if (!record.catalogRevision.trim() || !record.authorityRevision.trim()) {
      throw new ApplicationAuthorityError('AUTHORITY_GRANT_CONFLICT', `Grant ${record.id} must pin catalog and authority revisions.`);
    }
    const permission = record.permissionId
      ? state.permissions.find((candidate) => candidate.id === record.permissionId && !candidate.retiredAt)
      : undefined;
    if (record.permissionId && !permission) {
      throw new ApplicationAuthorityError('AUTHORITY_PERMISSION_UNAVAILABLE', `Grant ${record.id} references unavailable permission ${record.permissionId}.`);
    }
    if (permission) {
      if (permission.catalogRevision !== record.catalogRevision) {
        throw new ApplicationAuthorityError('AUTHORITY_CATALOG_MIGRATION_INVALID', `Grant ${record.id} and permission ${permission.id} must pin the same catalog revision.`);
      }
      assertSubset(record.operationIds, permission.operationIds, 'operation', record.id);
      assertScopeNotBroader(record.scope, permission.scope, record.id);
      assertSubset(record.audiences ?? [], permission.audiences ?? record.audiences ?? [], 'audience', record.id);
      assertSubset(record.transports ?? [], permission.transports ?? record.transports ?? [], 'transport', record.id);
      if (options.requireGrantablePermission && !permission.grantable) {
        throw new ApplicationAuthorityError('AUTHORITY_PERMISSION_NOT_GRANTABLE', `Permission ${permission.id} cannot be assigned at runtime.`);
      }
    }
    if (options.requireGrantablePermission) {
      if (!permission) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_UNAVAILABLE',
          `Runtime grant ${record.id} must derive from one grantable permission.`,
        );
      }
      const issuerGrant = state.grants.find((candidate) =>
        candidate.identity.id === record.issuedBy.id
        && candidate.canGrant === true
        && !candidate.revokedAt
        && !isExpired(candidate.expiresAt, this.#now())
        && candidate.catalogRevision === record.catalogRevision
        && candidate.permissionId === permission.id);
      if (!issuerGrant) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_PERMISSION_NOT_GRANTABLE',
          `Identity ${record.issuedBy.id} has no active canGrant authority for permission ${permission.id}.`,
        );
      }
      assertSubset(record.operationIds, issuerGrant.operationIds, 'operation', record.id);
      assertScopeNotBroader(record.scope, issuerGrant.scope, record.id);
      assertSubset(
        record.audiences ?? [],
        issuerGrant.audiences ?? record.audiences ?? [],
        'audience',
        record.id,
      );
      assertSubset(
        record.transports ?? [],
        issuerGrant.transports ?? record.transports ?? [],
        'transport',
        record.id,
      );
      if (
        record.expiresAt
        && issuerGrant.expiresAt
        && record.expiresAt > issuerGrant.expiresAt
      ) {
        throw new ApplicationAuthorityError(
          'AUTHORITY_GRANT_CONFLICT',
          `Runtime grant ${record.id} cannot outlive issuer grant ${issuerGrant.id}.`,
        );
      }
    }
    if (record.delegationId) {
      const delegation = state.delegations.find((candidate) => candidate.id === record.delegationId);
      if (!delegation || delegation.revokedAt || isExpired(delegation.expiresAt, this.#now())) {
        throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_UNAVAILABLE', `Delegation ${record.delegationId} is unavailable.`);
      }
      assertSubset(record.operationIds, delegation.operationIds, 'operation', record.id);
      assertSubset(record.audiences ?? [], delegation.audiences ?? record.audiences ?? [], 'audience', record.id);
      assertSubset(record.transports ?? [], delegation.transports ?? record.transports ?? [], 'transport', record.id);
      if (record.maximumUses !== undefined && delegation.maximumUses !== undefined && record.maximumUses > delegation.maximumUses) {
        throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Grant ${record.id} exceeds delegation ${delegation.id} maximum uses.`);
      }
      if (record.expiresAt && delegation.expiresAt && record.expiresAt > delegation.expiresAt) {
        throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Grant ${record.id} outlives delegation ${delegation.id}.`);
      }
      assertScopeNotBroader(record.scope, delegation.scope, record.id);
    }
    if (record.outcomeId) {
      const outcome = state.outcomes.find((candidate) => candidate.id === record.outcomeId);
      if (!outcome) {
        throw new ApplicationAuthorityError('AUTHORITY_OUTCOME_UNAVAILABLE', `Grant ${record.id} references unavailable outcome ${record.outcomeId}.`);
      }
      if (outcome.verifier.id === record.identity.id || record.operationIds.includes(outcome.observationOperationId)) {
        throw new ApplicationAuthorityError('AUTHORITY_OUTCOME_SELF_VERIFICATION', `Grant ${record.id} cannot verify its own required outcome.`);
      }
    }
  }

  async delegate(record: ApplicationDelegationRecord, parentGrant: ApplicationGrantRecord): Promise<ApplicationDelegationRecord> {
    return this.#repository.transaction(async () => {
      if (parentGrant.revokedAt || isExpired(parentGrant.expiresAt, this.#now())) {
        throw new ApplicationAuthorityError('AUTHORITY_GRANT_UNAVAILABLE', `Grant ${parentGrant.id} cannot be delegated because it is inactive.`);
      }
      assertSubset(record.operationIds, parentGrant.operationIds, 'operation', record.id);
      assertSubset(record.audiences ?? [], parentGrant.audiences ?? record.audiences ?? [], 'audience', record.id);
      assertSubset(record.transports ?? [], parentGrant.transports ?? record.transports ?? [], 'transport', record.id);
      assertScopeNotBroader(record.scope, parentGrant.scope, record.id);
      if (record.expiresAt && parentGrant.expiresAt && record.expiresAt > parentGrant.expiresAt) {
        throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Delegation ${record.id} outlives grant ${parentGrant.id}.`);
      }
      await this.#repository.putDelegation(record);
      return record;
    });
  }

  async authorize(request: ApplicationAuthorizationRequest): Promise<ApplicationAuthorizationResult> {
    return this.#repository.transaction(async () => {
      const now = this.#now();
      const denyAuthorization = async (
        code: ApplicationAuthorizationDenialCode,
        message: string,
      ): Promise<
        Extract<ApplicationAuthorizationResult, { readonly allowed: false }>
      > => {
        const denied = deny(code, message);
        await this.#audit(
          'authorization.denied',
          request.principal.authorityRevision,
          {
            principal: request.principal.identity,
            operationId: request.operation.id,
            ...(request.targetDigest
              ? { targetDigest: request.targetDigest }
              : {}),
            details: {
              code,
              audience: request.audience,
              transport: request.transport,
            },
          },
        );
        return denied;
      };
      if (request.catalog.state !== 'active' && request.catalog.state !== 'draining') {
        return denyAuthorization('AUTHORIZATION_CATALOG_INACTIVE', `Catalog ${request.catalog.revision} is ${request.catalog.state}.`);
      }
      if (!request.catalog.operations.some((operation) => operation.id === request.operation.id)
        || request.principal.catalogRevision !== request.catalog.revision) {
        return denyAuthorization('AUTHORIZATION_OPERATION_MISMATCH', `Principal and operation must resolve through catalog ${request.catalog.revision}.`);
      }
      if (request.operation.authority.classification === 'unclassified') {
        return denyAuthorization('AUTHORIZATION_OPERATION_UNCLASSIFIED', `Operation ${request.operation.id} has no authority classification.`);
      }
      if (request.principal.trustedContextDigest !== request.trustedContextDigest) {
        return denyAuthorization('AUTHORIZATION_CONTEXT_MISMATCH', 'Trusted request context does not match the admitted principal.');
      }
      if (!request.principal.audience.includes(request.audience)) {
        return denyAuthorization('AUTHORIZATION_AUDIENCE_DENIED', `Principal ${request.principal.id} was not admitted for audience ${request.audience}.`);
      }
      if (request.operation.authority.audiences && !request.operation.authority.audiences.includes(request.audience)) {
        return denyAuthorization('AUTHORIZATION_AUDIENCE_DENIED', `Audience ${request.audience} is outside operation ${request.operation.id}.`);
      }
      if (request.operation.authority.transports && !request.operation.authority.transports.includes(request.transport)) {
        return denyAuthorization('AUTHORIZATION_TRANSPORT_DENIED', `Transport ${request.transport} is outside operation ${request.operation.id}.`);
      }
      if (request.operation.authority.classification === 'application-policy'
        && request.applicationPolicyAllowed !== true) {
        return denyAuthorization('AUTHORIZATION_POLICY_DENIED', `Application policy denied ${request.operation.id}.`);
      }
      const state = await this.#repository.snapshot();
      const principalRoles = new Set(request.principal.roles ?? []);
      const rolePermissionIds = new Set(
        state.roles
          .filter(
            (role) =>
              !role.retiredAt
              && principalRoles.has(role.name),
          )
          .flatMap((role) => role.permissionIds),
      );
      const rolePermissions =
        request.operation.authority.classification === 'public'
        || request.operation.authority.classification === 'application-policy'
          ? []
          : state.permissions.filter(
              (permission) =>
                rolePermissionIds.has(permission.id)
                && !permission.retiredAt
                && permission.catalogRevision === request.catalog.revision
                && permission.operationIds.includes(request.operation.id)
                && (!permission.audiences
                  || permission.audiences.includes(request.audience))
                && (!permission.transports
                  || permission.transports.includes(request.transport)),
            );
      const candidates = request.operation.authority.classification === 'public'
        || request.operation.authority.classification === 'application-policy'
        ? []
        : state.grants.filter((grant) =>
          grant.identity.id === request.principal.identity.id
          && grant.catalogRevision === request.catalog.revision
          && grant.operationIds.includes(request.operation.id)
          && (!grant.audiences || grant.audiences.includes(request.audience))
          && (!grant.transports || grant.transports.includes(request.transport)));
      if (request.operation.authority.classification !== 'public'
        && request.operation.authority.classification !== 'application-policy'
        && candidates.length === 0
        && rolePermissions.length === 0) {
        return denyAuthorization('AUTHORIZATION_NO_GRANT', `Principal ${request.principal.identity.id} has no grant for ${request.operation.id}.`);
      }
      const grant = candidates.find((candidate) => !candidate.revokedAt && !isExpired(candidate.expiresAt, now));
      const rolePermission = rolePermissions.find(
        (permission) =>
          intersectApplicationScopes(
            request.operation.authority.defaultScope,
            request.target,
            ...(request.scopeEvidence ?? []),
            permission.scope,
          ).kind !== 'none',
      );
      if (!grant && !rolePermission && candidates.length === 0 && rolePermissions.length > 0) {
        return denyAuthorization(
          'AUTHORIZATION_SCOPE_EMPTY',
          `Every role permission for ${request.operation.id} excludes the requested target.`,
        );
      }
      if (!grant && !rolePermission && candidates.some((candidate) => candidate.revokedAt)) {
        return denyAuthorization('AUTHORIZATION_GRANT_REVOKED', `Every matching grant for ${request.operation.id} is revoked.`);
      }
      if (!grant && !rolePermission && candidates.some((candidate) => isExpired(candidate.expiresAt, now))) {
        return denyAuthorization('AUTHORIZATION_GRANT_EXPIRED', `Every matching grant for ${request.operation.id} is expired.`);
      }
      const scope = intersectApplicationScopes(
        request.operation.authority.defaultScope,
        request.target,
        ...(request.scopeEvidence ?? []),
        ...(grant ? [grant.scope] : []),
        ...(rolePermission ? [rolePermission.scope] : []),
      );
      if (scope.kind === 'none') return denyAuthorization('AUTHORIZATION_SCOPE_EMPTY', `Authority intersection is empty: ${scope.reason}.`);

      let reservation: ApplicationGrantReservation | undefined;
      if (grant?.maximumUses !== undefined) {
        if (!request.idempotencyKey || !request.commandId || !request.targetDigest) {
          throw new ApplicationAuthorityError('AUTHORITY_RESERVATION_REQUIRED', `Bounded grant ${grant.id} requires idempotencyKey, commandId, and targetDigest.`);
        }
        const sameRetry = state.reservations.find((candidate) =>
          candidate.grantId === grant.id
          && candidate.idempotencyKey === request.idempotencyKey
          && candidate.operationId === request.operation.id
          && candidate.targetDigest === request.targetDigest);
        if (sameRetry) {
          reservation = sameRetry;
        } else {
          const consumed = state.reservations.filter((candidate) =>
            candidate.grantId === grant.id
            && !['released', 'expired'].includes(candidate.state));
          if (consumed.length >= grant.maximumUses) {
            return denyAuthorization('AUTHORIZATION_GRANT_EXHAUSTED', `Grant ${grant.id} has no remaining uses.`);
          }
          const timestamp = now.toISOString();
          reservation = {
            apiVersion: 'applik8s.grantReservation/v1alpha1',
            id: this.#id(),
            grantId: grant.id,
            idempotencyKey: request.idempotencyKey,
            commandId: request.commandId,
            operationId: request.operation.id,
            targetDigest: request.targetDigest,
            authorityRevision: request.principal.authorityRevision,
            state: 'reserved',
            reservedAt: timestamp,
            updatedAt: timestamp,
            uncertainEffect: false,
          };
          await this.#repository.putReservation(reservation);
          await this.#audit('grant.reserved', request.principal.authorityRevision, {
            principal: request.principal.identity,
            operationId: request.operation.id,
            targetDigest: request.targetDigest,
            details: { grantId: grant.id, reservationId: reservation.id },
          });
        }
      }
      const receipt: ApplicationAuthorizationReceipt = {
        apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
        id: this.#id(),
        application: request.application,
        operationId: request.operation.id,
        operationVersion: request.operation.version,
        catalogRevision: request.catalog.revision,
        authorityRevision: request.principal.authorityRevision,
        principal: request.principal,
        trustedContextDigest: request.trustedContextDigest,
        matchedPermissionIds: [
          ...new Set([
            ...(grant?.permissionId ? [grant.permissionId] : []),
            ...(rolePermission ? [rolePermission.id] : []),
          ]),
        ],
        matchedGrantIds: grant ? [grant.id] : [],
        inputDigest: request.inputDigest,
        target: request.target,
        scopeEvidence: request.scopeEvidence ?? [],
        audience: request.audience,
        transport: request.transport,
        admittedAt: now.toISOString(),
        ...(request.principal.expiresAt ? { expiresAt: request.principal.expiresAt } : {}),
        ...(reservation ? { reservationId: reservation.id } : {}),
      };
      if (request.commandId) {
        await this.#repository.putCatalogReference?.(
          request.catalog.revision,
          'envelope',
          request.commandId,
          [request.operation.id],
        );
      }
      await this.#audit('authorization.allowed', request.principal.authorityRevision, {
        principal: request.principal.identity,
        operationId: request.operation.id,
        details: { receiptId: receipt.id, grantIds: receipt.matchedGrantIds },
        ...(request.targetDigest ? { targetDigest: request.targetDigest } : {}),
      });
      return { allowed: true, receipt, ...(reservation ? { reservation } : {}) };
    });
  }

  async transitionReservation(
    reservationId: string,
    state: ApplicationGrantReservation['state'],
    options: { readonly uncertainEffect?: boolean } = {},
  ): Promise<ApplicationGrantReservation> {
    return this.#repository.transaction(async () => {
      const reservation = (await this.#repository.snapshot()).reservations.find((candidate) => candidate.id === reservationId);
      if (!reservation) throw new ApplicationAuthorityError('AUTHORITY_RESERVATION_NOT_FOUND', `Reservation ${reservationId} does not exist.`);
      assertReservationTransition(reservation.state, state);
      const updated: ApplicationGrantReservation = {
        ...reservation,
        state,
        updatedAt: this.#now().toISOString(),
        uncertainEffect: options.uncertainEffect ?? reservation.uncertainEffect,
      };
      await this.#repository.putReservation(updated);
      return updated;
    });
  }

  async revalidateReceipt(
    receipt: ApplicationAuthorizationReceipt,
    catalog: ApplicationOperationCatalog,
    boundary: 'execution' | 'protected-step' | 'pre-commit' | 'result-read' | 'subscription-resume',
    trustedContextDigest: string,
  ): Promise<ApplicationAuthorizationResult> {
    return this.#repository.transaction(async () => {
      const now = this.#now();
      if (catalog.revision !== receipt.catalogRevision || (catalog.state !== 'active' && catalog.state !== 'draining')) {
        return deny('AUTHORIZATION_CATALOG_INACTIVE', `Receipt ${receipt.id} references unavailable catalog ${receipt.catalogRevision}.`);
      }
      const operation = catalog.operations.find((candidate) =>
        candidate.id === receipt.operationId && candidate.version === receipt.operationVersion);
      if (!operation) {
        return deny('AUTHORIZATION_OPERATION_MISMATCH', `Receipt ${receipt.id} references an unknown operation version.`);
      }
      if (!operation.authority.checks.includes(boundary)) {
        return { allowed: true, receipt };
      }
      if (receipt.trustedContextDigest !== trustedContextDigest
        || receipt.principal.trustedContextDigest !== trustedContextDigest) {
        return deny('AUTHORIZATION_CONTEXT_MISMATCH', `Receipt ${receipt.id} trusted context changed before ${boundary}.`);
      }
      if (isExpired(receipt.expiresAt ?? receipt.principal.expiresAt, now)) {
        return deny('AUTHORIZATION_GRANT_EXPIRED', `Receipt ${receipt.id} expired before ${boundary}.`);
      }
      const state = await this.#repository.snapshot();
      for (const grantId of receipt.matchedGrantIds) {
        const grant = state.grants.find((candidate) => candidate.id === grantId);
        if (!grant || grant.revokedAt) {
          return deny('AUTHORIZATION_GRANT_REVOKED', `Receipt ${receipt.id} grant ${grantId} is unavailable before ${boundary}.`);
        }
        if (isExpired(grant.expiresAt, now)) {
          return deny('AUTHORIZATION_GRANT_EXPIRED', `Receipt ${receipt.id} grant ${grantId} expired before ${boundary}.`);
        }
      }
      return { allowed: true, receipt };
    });
  }

  async createRevocationTombstone(record: ApplicationRevocationTombstone): Promise<ApplicationRevocationTombstone> {
    return this.#repository.transaction(async () => {
      if (record.provenAt || record.transferredByBreakGlassAt) {
        throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_INVALID_STATE', `New revocation tombstone ${record.id} cannot already be completed.`);
      }
      if (record.obligations.length === 0) {
        throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_INVALID_STATE', `Revocation tombstone ${record.id} requires at least one external neutralization obligation.`);
      }
      validateScopeOrThrow(record.scope, `tombstones.${record.id}.scope`);
      const state = await this.#repository.snapshot();
      const existing = state.tombstones.find((candidate) => candidate.id === record.id);
      if (existing) {
        if (stableJson(existing) === stableJson(record)) return existing;
        throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_CONFLICT', `Revocation tombstone ${record.id} already exists with different obligations.`);
      }
      await this.#repository.putTombstone(record);
      return record;
    });
  }

  async observeRevocationObligation(
    tombstoneId: string,
    projection: string,
    observation: {
      readonly state: 'neutralized' | 'expiry-guaranteed' | 'failed';
      readonly providerRevision?: string;
      readonly observedAt: string;
      readonly guaranteedExpiryAt?: string;
      readonly diagnostic?: string;
    },
  ): Promise<ApplicationRevocationTombstone> {
    return this.#repository.transaction(async () => {
      const state = await this.#repository.snapshot();
      const tombstone = state.tombstones.find((candidate) => candidate.id === tombstoneId);
      if (!tombstone) throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_UNAVAILABLE', `Revocation tombstone ${tombstoneId} does not exist.`);
      if (tombstone.provenAt || tombstone.transferredByBreakGlassAt) return tombstone;
      const matched = tombstone.obligations.some((candidate) => candidate.projection === projection);
      if (!matched) {
        throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_UNAVAILABLE', `Revocation tombstone ${tombstoneId} has no ${projection} obligation.`);
      }
      if (observation.state === 'expiry-guaranteed' && !observation.guaranteedExpiryAt) {
        throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_INVALID_STATE', `Expiry-guaranteed obligation ${projection} requires guaranteedExpiryAt.`);
      }
      const obligations = tombstone.obligations.map((candidate) =>
        candidate.projection === projection ? { ...candidate, ...observation } : candidate);
      const complete = obligations.every((candidate) =>
        candidate.state === 'neutralized'
        || (candidate.state === 'expiry-guaranteed' && candidate.guaranteedExpiryAt !== undefined));
      const updated: ApplicationRevocationTombstone = {
        ...tombstone,
        obligations,
        ...(complete ? { provenAt: this.#now().toISOString() } : {}),
      };
      await this.#repository.putTombstone(updated);
      await this.#audit(complete ? 'revocation.proven' : 'revocation.obligation-neutralized', tombstone.authorityRevision, {
        details: { tombstoneId, projection, state: observation.state },
      });
      return updated;
    });
  }

  async transferRevocationByBreakGlass(
    tombstoneId: string,
    principal: ApplicationIdentityReference,
    acknowledgement: string,
  ): Promise<ApplicationRevocationTombstone> {
    return this.#repository.transaction(async () => {
      if (!acknowledgement.trim()) {
        throw new ApplicationAuthorityError('AUTHORITY_BREAK_GLASS_ACKNOWLEDGEMENT_REQUIRED', 'Break-glass authority transfer requires an explicit acknowledgement.');
      }
      const tombstone = (await this.#repository.snapshot()).tombstones.find((candidate) => candidate.id === tombstoneId);
      if (!tombstone) throw new ApplicationAuthorityError('AUTHORITY_REVOCATION_UNAVAILABLE', `Revocation tombstone ${tombstoneId} does not exist.`);
      if (tombstone.provenAt) return tombstone;
      const updated: ApplicationRevocationTombstone = {
        ...tombstone,
        transferredByBreakGlassAt: this.#now().toISOString(),
        auditProvenance: [...tombstone.auditProvenance, acknowledgement],
      };
      await this.#repository.putTombstone(updated);
      await this.#audit('break-glass', tombstone.authorityRevision, {
        principal,
        details: { tombstoneId, acknowledgement },
      });
      return updated;
    });
  }

  async assertAuthorityTeardownSafe(application: string): Promise<void> {
    const pending = (await this.#repository.snapshot()).tombstones.filter((tombstone) =>
      tombstone.application === application && !tombstone.provenAt && !tombstone.transferredByBreakGlassAt);
    if (pending.length > 0) {
      throw new ApplicationAuthorityError(
        'AUTHORITY_REVOCATION_PENDING',
        `Application ${application} retains ${pending.length} unproven revocation tombstone(s): ${pending.map((candidate) => candidate.id).join(', ')}.`,
      );
    }
  }

  async revokeGrant(grantId: string, reason: string): Promise<ApplicationGrantRecord> {
    return this.#repository.transaction(() => this.#revokeGrant(grantId, reason));
  }

  async #revokeGrant(grantId: string, reason: string): Promise<ApplicationGrantRecord> {
    const grant = (await this.#repository.snapshot()).grants.find((candidate) => candidate.id === grantId);
    if (!grant) throw new ApplicationAuthorityError('AUTHORITY_GRANT_UNAVAILABLE', `Grant ${grantId} does not exist.`);
    if (grant.revokedAt) return grant;
    const revoked = { ...grant, revokedAt: this.#now().toISOString(), reason: grant.reason ?? reason };
    await this.#putGrant(revoked);
    await this.#audit('grant.revoked', grant.authorityRevision, {
      principal: grant.issuedBy,
      details: { grantId, reason },
    });
    return revoked;
  }

  async #audit(
    kind: ApplicationAuditEvent['kind'],
    authorityRevision: ApplicationAuthorityRevisionId,
    fields: Pick<ApplicationAuditEvent, 'principal' | 'operationId' | 'targetDigest'> & { readonly details: ApplicationAuditEvent['details'] },
  ): Promise<void> {
    await this.#repository.appendAudit({
      apiVersion: 'applik8s.audit/v1alpha1',
      id: this.#id(),
      kind,
      occurredAt: this.#now().toISOString(),
      authorityRevision,
      details: fields.details,
      ...(fields.principal ? { principal: fields.principal } : {}),
      ...(fields.operationId ? { operationId: fields.operationId } : {}),
      ...(fields.targetDigest ? { targetDigest: fields.targetDigest } : {}),
    });
  }

  async #putGrant(record: ApplicationGrantRecord): Promise<void> {
    const previous = (await this.#repository.snapshot()).grants.find(
      (candidate) => candidate.id === record.id,
    );
    await this.#repository.putGrant(record);
    if (previous && previous.catalogRevision !== record.catalogRevision) {
      await this.#repository.removeCatalogReference?.(
        previous.catalogRevision,
        'grant',
        previous.id,
      );
    }
    if (record.revokedAt || isExpired(record.expiresAt, this.#now())) {
      await this.#repository.removeCatalogReference?.(record.catalogRevision, 'grant', record.id);
    } else {
      await this.#repository.putCatalogReference?.(
        record.catalogRevision,
        'grant',
        record.id,
        record.operationIds,
      );
    }
  }
}

export class InMemoryApplicationAuthorityRepository implements ApplicationAuthorityRepository {
  #revision = 0;
  readonly #permissions = new Map<string, ApplicationPermissionRecord>();
  readonly #roles = new Map<string, ApplicationRoleRecord>();
  readonly #grants = new Map<string, ApplicationGrantRecord>();
  readonly #delegations = new Map<string, ApplicationDelegationRecord>();
  readonly #requests = new Map<string, ApplicationGrantRequestRecord>();
  readonly #approvals = new Map<string, ApplicationApprovalRecord>();
  readonly #outcomes = new Map<string, ApplicationOutcomeDefinition>();
  readonly #reservations = new Map<string, ApplicationGrantReservation>();
  readonly #tombstones = new Map<string, ApplicationRevocationTombstone>();
  readonly #audit: ApplicationAuditEvent[] = [];
  readonly #catalogReferences = new Map<string, Set<string>>();
  #tail = Promise.resolve();

  async snapshot(): Promise<ApplicationAuthoritySnapshot> {
    return clone({
      revision: String(this.#revision),
      permissions: [...this.#permissions.values()],
      roles: [...this.#roles.values()],
      grants: [...this.#grants.values()],
      delegations: [...this.#delegations.values()],
      requests: [...this.#requests.values()],
      approvals: [...this.#approvals.values()],
      outcomes: [...this.#outcomes.values()],
      reservations: [...this.#reservations.values()],
      tombstones: [...this.#tombstones.values()],
    });
  }

  async putPermission(record: ApplicationPermissionRecord): Promise<void> { this.#put(this.#permissions, record); }
  async putRole(record: ApplicationRoleRecord): Promise<void> { this.#put(this.#roles, record); }
  async putGrant(record: ApplicationGrantRecord): Promise<void> { this.#put(this.#grants, record); }
  async putDelegation(record: ApplicationDelegationRecord): Promise<void> { this.#put(this.#delegations, record); }
  async putRequest(record: ApplicationGrantRequestRecord): Promise<void> { this.#put(this.#requests, record); }
  async putApproval(record: ApplicationApprovalRecord): Promise<void> { this.#put(this.#approvals, record); }
  async putOutcome(record: ApplicationOutcomeDefinition): Promise<void> { this.#put(this.#outcomes, record); }
  async putReservation(record: ApplicationGrantReservation): Promise<void> { this.#put(this.#reservations, record); }
  async putTombstone(record: ApplicationRevocationTombstone): Promise<void> { this.#put(this.#tombstones, record); }
  async appendAudit(event: ApplicationAuditEvent): Promise<void> {
    // Audit position is not authority state. Advancing the policy revision for
    // an authorization receipt would make that receipt invalidate every other
    // cursor and admitted principal merely by recording its own decision.
    this.#audit.push(clone(event));
  }
  async putCatalogReference(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
    _operationIds?: readonly ApplicationOperationId[],
  ): Promise<void> {
    const key = `${revision}\0${kind}`;
    const values = this.#catalogReferences.get(key) ?? new Set<string>();
    values.add(referenceId);
    this.#catalogReferences.set(key, values);
  }
  async removeCatalogReference(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    this.#catalogReferences.get(`${revision}\0${kind}`)?.delete(referenceId);
  }
  catalogReferences(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
  ): readonly string[] {
    return [...(this.#catalogReferences.get(`${revision}\0${kind}`) ?? [])].sort();
  }

  audit(): readonly ApplicationAuditEvent[] {
    return clone(this.#audit);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.#tail;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    const checkpoint = {
      revision: this.#revision,
      permissions: cloneMap(this.#permissions),
      roles: cloneMap(this.#roles),
      grants: cloneMap(this.#grants),
      delegations: cloneMap(this.#delegations),
      requests: cloneMap(this.#requests),
      approvals: cloneMap(this.#approvals),
      outcomes: cloneMap(this.#outcomes),
      reservations: cloneMap(this.#reservations),
      tombstones: cloneMap(this.#tombstones),
      // Audit is append-only. Capturing its length preserves exact rollback
      // semantics without cloning the complete history before every
      // authorization decision (which made a sequence of decisions O(n²)).
      auditLength: this.#audit.length,
      catalogReferences: new Map(
        [...this.#catalogReferences].map(([key, values]) => [key, new Set(values)]),
      ),
    };
    try {
      return await work();
    } catch (error) {
      this.#revision = checkpoint.revision;
      restoreMap(this.#permissions, checkpoint.permissions);
      restoreMap(this.#roles, checkpoint.roles);
      restoreMap(this.#grants, checkpoint.grants);
      restoreMap(this.#delegations, checkpoint.delegations);
      restoreMap(this.#requests, checkpoint.requests);
      restoreMap(this.#approvals, checkpoint.approvals);
      restoreMap(this.#outcomes, checkpoint.outcomes);
      restoreMap(this.#reservations, checkpoint.reservations);
      restoreMap(this.#tombstones, checkpoint.tombstones);
      this.#audit.splice(checkpoint.auditLength);
      this.#catalogReferences.clear();
      for (const [key, values] of checkpoint.catalogReferences) {
        this.#catalogReferences.set(key, new Set(values));
      }
      throw error;
    } finally {
      release();
    }
  }

  #put<T extends { readonly id: string }>(map: Map<string, T>, record: T): void {
    map.set(record.id, clone(record));
    this.#revision += 1;
  }
}

export type ApplicationAuthorityErrorCode =
  | 'AUTHORITY_MANIFEST_REVISION_MISMATCH'
  | 'AUTHORITY_MANIFEST_IDENTITY_CONFLICT'
  | 'AUTHORITY_ORIGIN_CONFLICT'
  | 'AUTHORITY_GRANT_CONFLICT'
  | 'AUTHORITY_CATALOG_MIGRATION_INVALID'
  | 'AUTHORITY_PERMISSION_UNAVAILABLE'
  | 'AUTHORITY_PERMISSION_NOT_GRANTABLE'
  | 'AUTHORITY_OUTCOME_CONFLICT'
  | 'AUTHORITY_OUTCOME_UNAVAILABLE'
  | 'AUTHORITY_OUTCOME_SELF_VERIFICATION'
  | 'AUTHORITY_DELEGATION_UNAVAILABLE'
  | 'AUTHORITY_DELEGATION_BROADENING'
  | 'AUTHORITY_SELF_GRANT'
  | 'AUTHORITY_SELF_APPROVAL'
  | 'AUTHORITY_GRANT_UNAVAILABLE'
  | 'AUTHORITY_REQUEST_CONFLICT'
  | 'AUTHORITY_REQUEST_UNAVAILABLE'
  | 'AUTHORITY_REQUEST_INVALID_STATE'
  | 'AUTHORITY_RESERVATION_REQUIRED'
  | 'AUTHORITY_RESERVATION_NOT_FOUND'
  | 'AUTHORITY_INVALID_RESERVATION_TRANSITION'
  | 'AUTHORITY_REVOCATION_CONFLICT'
  | 'AUTHORITY_REVOCATION_UNAVAILABLE'
  | 'AUTHORITY_REVOCATION_INVALID_STATE'
  | 'AUTHORITY_REVOCATION_PENDING'
  | 'AUTHORITY_BREAK_GLASS_ACKNOWLEDGEMENT_REQUIRED'
  | 'AUTHORITY_INVALID_SCOPE';

export class ApplicationAuthorityError extends Error {
  readonly code: ApplicationAuthorityErrorCode;

  constructor(code: ApplicationAuthorityErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationAuthorityError';
    this.code = code;
  }
}

export function applicationAuthorityDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function validateScopeOrThrow(scope: ApplicationScopeExpression, path: string): void {
  const diagnostics = validateApplicationScope(scope, path);
  if (diagnostics.length > 0) {
    throw new ApplicationAuthorityError('AUTHORITY_INVALID_SCOPE', diagnostics.map((diagnostic) => diagnostic.message).join(' '));
  }
}

function assertAuthorityRecordOrigin(actual: string, expected: string, id: string): void {
  if (actual !== expected) {
    throw new ApplicationAuthorityError('AUTHORITY_ORIGIN_CONFLICT', `Authority record ${id} must have ${expected} origin; received ${actual}.`);
  }
}

function assertAuthorityCatalogRevision(revision: string, id: string): void {
  if (!revision.trim()) {
    throw new ApplicationAuthorityError('AUTHORITY_CATALOG_MIGRATION_INVALID', `Authority record ${id} must pin a catalog revision.`);
  }
}

function assertSubset<T extends string>(
  requested: readonly T[],
  maximum: readonly T[],
  kind: string,
  id: string,
): void {
  const allowed = new Set(maximum);
  const extra = requested.filter((candidate) => !allowed.has(candidate));
  if (extra.length > 0) {
    throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Authority ${id} broadens ${kind} values: ${extra.join(', ')}.`);
  }
}

function assertScopeNotBroader(
  candidate: ApplicationScopeExpression,
  maximum: ApplicationScopeExpression,
  id: string,
): void {
  const normalizedCandidate = normalizeApplicationScope(candidate);
  const normalizedMaximum = normalizeApplicationScope(maximum);
  if (!isProvableScopeSubset(normalizedCandidate, normalizedMaximum)) {
    throw new ApplicationAuthorityError('AUTHORITY_DELEGATION_BROADENING', `Authority ${id} scope is not a provable subset of its maximum.`);
  }
}

/**
 * Conservative structural implication for the closed scope IR. Unknown
 * equivalences fail closed; authored narrowing through conjunction and unions
 * is accepted without relying on executable policy code.
 */
export function isProvableScopeSubset(
  candidate: ApplicationScopeExpression,
  maximum: ApplicationScopeExpression,
): boolean {
  if (maximum.kind === 'all' || candidate.kind === 'none') return true;
  if (stableJson(candidate) === stableJson(maximum)) return true;
  if (candidate.kind === 'or') {
    return candidate.expressions.every((branch) => isProvableScopeSubset(branch, maximum));
  }
  if (maximum.kind === 'or') {
    return maximum.expressions.some((branch) => isProvableScopeSubset(candidate, branch));
  }
  if (maximum.kind === 'and') {
    return maximum.expressions.every((restriction) => isProvableScopeSubset(candidate, restriction));
  }
  if (candidate.kind === 'and') {
    return candidate.expressions.some((restriction) => isProvableScopeSubset(restriction, maximum));
  }
  return false;
}

function assertReservationTransition(
  from: ApplicationGrantReservation['state'],
  to: ApplicationGrantReservation['state'],
): void {
  const allowed: Readonly<Record<ApplicationGrantReservation['state'], readonly ApplicationGrantReservation['state'][]>> = {
    reserved: ['consumed', 'released', 'expired'],
    consumed: ['outcome-pending'],
    'outcome-pending': ['outcome-verified', 'outcome-failed'],
    'outcome-verified': [],
    'outcome-failed': [],
    released: [],
    expired: [],
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) {
    throw new ApplicationAuthorityError('AUTHORITY_INVALID_RESERVATION_TRANSITION', `Reservation cannot transition from ${from} to ${to}.`);
  }
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= now.getTime();
}

function sameIdentity(
  left: ApplicationIdentityReference,
  right: ApplicationIdentityReference,
): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.issuer === right.issuer
    && left.subject === right.subject;
}

function applicationRoleBootstrapOwner(roleId: string): string {
  return `application-role-bootstrap:${roleId}`;
}

function isFrameworkManagedRoleLease(lifecycleOwner: string | undefined): boolean {
  return lifecycleOwner?.startsWith('application-role-bootstrap:') === true
    || lifecycleOwner?.startsWith('application-role-break-glass:') === true;
}

function assertBootstrapIdentity(
  identity: ApplicationIdentityReference,
  label: string,
): void {
  if (
    !identity.id.trim()
    || !identity.issuer.trim()
    || !identity.subject.trim()
    || identity.kind === 'execution'
    || identity.kind === 'pre-authentication-flow'
    || identity.kind === 'oauth-authorization-flow'
  ) {
    throw new ApplicationAuthorityError(
      'AUTHORITY_GRANT_CONFLICT',
      `Application ${label} must be one exact provider-verified non-framework identity.`,
    );
  }
}

function deny(
  code: ApplicationAuthorizationDenialCode,
  message: string,
): Extract<ApplicationAuthorizationResult, { readonly allowed: false }> {
  return { allowed: false, code, message };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneMap<T>(value: ReadonlyMap<string, T>): Map<string, T> {
  return new Map([...value].map(([key, entry]) => [key, clone(entry)]));
}

function restoreMap<T>(target: Map<string, T>, source: ReadonlyMap<string, T>): void {
  target.clear();
  for (const [key, entry] of source) target.set(key, clone(entry));
}
