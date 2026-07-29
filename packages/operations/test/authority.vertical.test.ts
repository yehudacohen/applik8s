// typecast-file-boundary: authority conformance fixtures intentionally construct erased grants and scopes to exercise validation and precedence.
import { describe, expect, it } from 'vitest';
import type {
  ApplicationGrantRecord,
  ApplicationGrantRequestRecord,
  ApplicationIdentityReference,
  ApplicationOutcomeDefinition,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationPermissionRecord,
  ApplicationPrincipal,
} from '@applik8s/core';
import {
  ApplicationAuthorityError,
  ApplicationAuthorityService,
  InMemoryApplicationAuthorityRepository,
} from '../src/index.js';

const identity: ApplicationIdentityReference = {
  id: 'identity:bot',
  kind: 'service',
  issuer: 'applik8s',
  subject: 'bot',
};
const administrator: ApplicationIdentityReference = {
  id: 'identity:administrator',
  kind: 'human',
  issuer: 'applik8s',
  subject: 'administrator',
};
const operation: ApplicationOperationDescriptor = {
  apiVersion: 'applik8s.operation/v1alpha1',
  id: 'applik8s://models/Post/operations/publish',
  version: '1',
  name: 'publish',
  kind: 'model.operation',
  input: { digest: 'sha256:input', schema: { type: 'object' } },
  output: { digest: 'sha256:output', schema: { type: 'object' } },
  errors: {},
  authority: {
    classification: 'runtime-grantable',
    grantable: true,
    delegable: true,
    checks: ['enqueue', 'execution', 'pre-commit'],
    defaultScope: { kind: 'all' },
    audiences: ['chirp-api'],
    transports: ['direct'],
  },
  transports: [],
  placement: { nodeId: 'command-handler.publish', runtime: 'command-processor' },
};
const catalog: ApplicationOperationCatalog = {
  apiVersion: 'applik8s.operationCatalog/v1alpha1',
  application: 'chirp',
  revision: 'catalog-1',
  digest: 'sha256:catalog',
  state: 'active',
  operations: [operation],
};
const principal: ApplicationPrincipal = {
  id: 'principal:bot',
  identity,
  kind: 'service',
  authenticationMethod: 'workload-identity',
  audience: ['chirp-api'],
  trustedContextDigest: 'sha256:context',
  catalogRevision: catalog.revision,
  authorityRevision: 'authority-1',
  admittedAt: '2026-07-29T00:00:00.000Z',
};
const permission: ApplicationPermissionRecord = {
  apiVersion: 'applik8s.permission/v1alpha1',
  id: 'permission:publish',
  name: 'publish',
  origin: 'runtime',
  catalogRevision: catalog.revision,
  operationIds: [operation.id],
  scope: { kind: 'all' },
  grantable: true,
  createdAt: '2026-07-29T00:00:00.000Z',
};
const grant: ApplicationGrantRecord = {
  apiVersion: 'applik8s.grant/v1alpha1',
  id: 'grant:publish-once',
  origin: 'runtime',
  identity,
  permissionId: permission.id,
  operationIds: [operation.id],
  scope: {
    kind: 'compare',
    field: 'authorId',
    operator: 'eq',
    value: { kind: 'literal', value: 'bot' },
  },
  audiences: ['chirp-api'],
  transports: ['direct'],
  issuedBy: administrator,
  maximumUses: 1,
  catalogRevision: catalog.revision,
  authorityRevision: 'authority-1',
  createdAt: '2026-07-29T00:00:00.000Z',
};

describe('operation authority lifecycle', () => {
  it('reconciles an application-authored authority manifest idempotently', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository, {
      now: () => new Date('2026-07-29T00:00:00.000Z'),
    });
    const applicationIdentity: ApplicationIdentityReference = {
      id: 'identity:chirp:application',
      kind: 'service',
      issuer: 'applik8s://chirp',
      subject: 'application-authority',
    };
    const manifest = {
      apiVersion: 'applik8s.authorityManifest/v1alpha1' as const,
      application: 'chirp',
      revision: 'sha256:static-authority',
      identities: [applicationIdentity, identity],
      permissions: [{
        id: 'permission:chirp:publish',
        name: 'publish',
        operationIds: [operation.id],
        scope: { kind: 'all' as const },
        transports: ['direct' as const],
        audiences: ['chirp-api'],
        grantable: false,
      }],
      roles: [],
      grants: [{
        id: 'grant:chirp:bot-publish',
        identity,
        permissionId: 'permission:chirp:publish',
        operationIds: [operation.id],
        scope: { kind: 'all' as const },
        transports: ['direct' as const],
        audiences: ['chirp-api'],
        issuedBy: applicationIdentity,
      }],
      outcomes: [],
    };

    const first = await authority.reconcileStaticAuthorityManifest(manifest, catalog.revision);
    const second = await authority.reconcileStaticAuthorityManifest(manifest, catalog.revision);

    expect(second.revision).toBe(first.revision);
    expect(second.permissions).toEqual([
      expect.objectContaining({
        id: 'permission:chirp:publish',
        origin: 'application',
        manifestRevision: manifest.revision,
      }),
    ]);
    expect(second.grants).toEqual([
      expect.objectContaining({
        id: 'grant:chirp:bot-publish',
        origin: 'application',
        identity,
      }),
    ]);
  });

  it('reserves a one-use grant atomically and reuses only the exact idempotent retry', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    let id = 0;
    const authority = new ApplicationAuthorityService(repository, {
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      id: () => `generated-${++id}`,
    });
    await authority.createRuntimePermission(permission);
    await authority.assignGrant(grant);
    const request = {
      application: 'chirp',
      catalog,
      operation,
      principal,
      target: grant.scope,
      audience: 'chirp-api',
      transport: 'direct' as const,
      inputDigest: 'sha256:input-1',
      trustedContextDigest: principal.trustedContextDigest,
      idempotencyKey: 'retry-key',
      commandId: 'command-1',
      targetDigest: 'sha256:post-1',
    };
    const [first, racing] = await Promise.all([
      authority.authorize(request),
      authority.authorize({ ...request, idempotencyKey: 'other-key', commandId: 'command-2' }),
    ]);

    expect(first.allowed).toBe(true);
    expect(racing).toMatchObject({ allowed: false, code: 'AUTHORIZATION_GRANT_EXHAUSTED' });
    const retry = await authority.authorize(request);
    expect(retry.allowed).toBe(true);
    if (!first.allowed || !retry.allowed) throw new Error('fixture authorization unexpectedly failed');
    expect(retry.reservation?.id).toBe(first.reservation?.id);
    expect((await repository.snapshot()).reservations).toHaveLength(1);
  });

  it('rejects self-grants and delegation broadening', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository);
    await authority.createRuntimePermission(permission);
    await expect(authority.assignGrant({ ...grant, issuedBy: identity })).rejects.toMatchObject({
      code: 'AUTHORITY_SELF_GRANT',
    } satisfies Partial<ApplicationAuthorityError>);

    await authority.assignGrant(grant);
    await expect(authority.delegate({
      apiVersion: 'applik8s.delegation/v1alpha1',
      id: 'delegation:broader',
      grantor: identity,
      operationIds: [operation.id, 'applik8s://models/Post/operations/delete'],
      scope: { kind: 'all' },
      createdAt: '2026-07-29T00:00:00.000Z',
    }, grant)).rejects.toMatchObject({
      code: 'AUTHORITY_DELEGATION_BROADENING',
    } satisfies Partial<ApplicationAuthorityError>);

    await expect(authority.delegate({
      apiVersion: 'applik8s.delegation/v1alpha1',
      id: 'delegation:narrower',
      grantor: identity,
      operationIds: [operation.id],
      scope: {
        kind: 'and',
        expressions: [
          grant.scope,
          { kind: 'compare', field: 'state', operator: 'eq', value: { kind: 'literal', value: 'draft' } },
        ],
      },
      createdAt: '2026-07-29T00:00:00.000Z',
    }, grant)).resolves.toMatchObject({
      id: 'delegation:narrower',
    });
  });

  it('rejects trusted-context drift before considering grants', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository);
    await authority.createRuntimePermission(permission);
    await authority.assignGrant(grant);
    await expect(authority.authorize({
      application: 'chirp',
      catalog,
      operation,
      principal,
      target: grant.scope,
      audience: 'chirp-api',
      transport: 'direct',
      inputDigest: 'sha256:input',
      trustedContextDigest: 'sha256:different-context',
    })).resolves.toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_CONTEXT_MISMATCH',
    });
  });

  it('requires independent approval and independent outcome verification', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository, {
      now: () => new Date('2026-07-29T00:00:00.000Z'),
    });
    await authority.createRuntimePermission(permission);
    const outcome: ApplicationOutcomeDefinition = {
      apiVersion: 'applik8s.outcome/v1alpha1',
      id: 'outcome:post-visible',
      name: 'post-visible',
      subjectModel: 'Post',
      verifier: administrator,
      observationOperationId: 'applik8s://queries/Post/operations/read',
      predicate: { kind: 'compare', field: 'state', operator: 'eq', value: { kind: 'literal', value: 'published' } },
      timeoutSeconds: 60,
      failure: 'revoke',
    };
    await authority.registerOutcome(outcome);
    const request: ApplicationGrantRequestRecord = {
      apiVersion: 'applik8s.grantRequest/v1alpha1',
      id: 'request:publish-once',
      requester: identity,
      operationIds: [operation.id],
      scope: grant.scope,
      reason: 'Publish one reviewed post',
      requestedMaximumUses: 1,
      requiredOutcomeId: outcome.id,
      approvalPolicyId: 'approval:administrator',
      state: 'pending',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    await authority.requestGrant(request);
    const approval = {
      apiVersion: 'applik8s.approval/v1alpha1' as const,
      id: 'approval:publish-once',
      requestId: request.id,
      approver: administrator,
      decision: 'approve' as const,
      decidedAt: '2026-07-29T00:00:00.000Z',
    };
    await expect(authority.decideGrantRequest(request.id, {
      approval: { ...approval, approver: identity },
      grant: { ...grant, outcomeId: outcome.id },
    })).rejects.toMatchObject({ code: 'AUTHORITY_SELF_APPROVAL' });

    const decided = await authority.decideGrantRequest(request.id, {
      approval,
      grant: { ...grant, outcomeId: outcome.id },
    });
    expect(decided.state).toBe('approved');
    expect((await repository.snapshot()).grants).toContainEqual(expect.objectContaining({
      id: grant.id,
      outcomeId: outcome.id,
    }));

    const selfVerifyingOutcome: ApplicationOutcomeDefinition = {
      ...outcome,
      id: 'outcome:self-verifying',
      verifier: identity,
    };
    await authority.registerOutcome(selfVerifyingOutcome);
    await expect(authority.assignGrant({
      ...grant,
      id: 'grant:self-verifying',
      outcomeId: selfVerifyingOutcome.id,
    })).rejects.toMatchObject({ code: 'AUTHORITY_OUTCOME_SELF_VERIFICATION' });
  });

  it('revalidates durable receipts and retains revocation obligations until neutralized', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository, {
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      id: () => 'generated',
    });
    await authority.createRuntimePermission(permission);
    const { maximumUses: _maximumUses, ...unboundedGrant } = grant;
    await authority.assignGrant(unboundedGrant);
    const admitted = await authority.authorize({
      application: 'chirp',
      catalog,
      operation,
      principal,
      target: grant.scope,
      audience: 'chirp-api',
      transport: 'direct',
      inputDigest: 'sha256:input',
      trustedContextDigest: principal.trustedContextDigest,
    });
    if (!admitted.allowed) throw new Error('fixture authorization unexpectedly failed');
    await authority.revokeGrant(grant.id, 'security response');
    await expect(authority.revalidateReceipt(
      admitted.receipt,
      catalog,
      'pre-commit',
      principal.trustedContextDigest,
    )).resolves.toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_GRANT_REVOKED',
    });

    await authority.createRevocationTombstone({
      apiVersion: 'applik8s.revocationTombstone/v1alpha1',
      id: 'tombstone:chirp',
      application: 'chirp',
      authorityRevision: 'authority-2',
      identityIds: [identity.id],
      operationIds: [operation.id],
      scope: { kind: 'all' },
      obligations: [{
        projection: 'casbin',
        kind: 'revoke',
        state: 'pending',
      }],
      createdAt: '2026-07-29T00:00:00.000Z',
      auditProvenance: ['revocation:grant:publish-once'],
    });
    await expect(authority.assertAuthorityTeardownSafe('chirp')).rejects.toMatchObject({
      code: 'AUTHORITY_REVOCATION_PENDING',
    });
    const proven = await authority.observeRevocationObligation('tombstone:chirp', 'casbin', {
      state: 'neutralized',
      providerRevision: 'casbin-2',
      observedAt: '2026-07-29T00:00:00.000Z',
    });
    expect(proven.provenAt).toBe('2026-07-29T00:00:00.000Z');
    await expect(authority.assertAuthorityTeardownSafe('chirp')).resolves.toBeUndefined();
  });

  it('migrates pinned permission and grant meanings before a rolling catalog activates', async () => {
    const repository = new InMemoryApplicationAuthorityRepository();
    const authority = new ApplicationAuthorityService(repository);
    await authority.createRuntimePermission(permission);
    const { maximumUses: _maximumUses, ...unboundedGrant } = grant;
    await authority.assignGrant(unboundedGrant);
    const secondGrant = {
      ...unboundedGrant,
      id: 'grant:publish-recurring',
      authorityRevision: 'authority-1',
    };
    await authority.assignGrant(secondGrant);
    const successor: ApplicationOperationCatalog = {
      ...catalog,
      revision: 'catalog-2',
      digest: 'sha256:catalog-2',
      state: 'staged',
      predecessor: catalog.revision,
      operations: [{ ...operation, version: '2' }],
    };
    const beforeMigration = await repository.snapshot();
    await expect(authority.migrateCatalogAuthority(
      catalog,
      { ...successor, operations: [] },
      'authority-invalid',
    )).rejects.toMatchObject({
      code: 'AUTHORITY_CATALOG_MIGRATION_INVALID',
    });
    expect(await repository.snapshot()).toEqual(beforeMigration);

    const migrated = await authority.migrateCatalogAuthority(
      catalog,
      successor,
      'authority-2',
    );

    expect(migrated.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: grant.id,
        catalogRevision: successor.revision,
        authorityRevision: 'authority-2',
      }),
      expect.objectContaining({
        id: secondGrant.id,
        catalogRevision: successor.revision,
        authorityRevision: 'authority-2',
      }),
    ]));
    expect((await repository.snapshot()).permissions).toContainEqual(expect.objectContaining({
      id: permission.id,
      catalogRevision: successor.revision,
    }));
    expect(repository.catalogReferences(catalog.revision, 'grant')).toEqual([]);
    expect(repository.catalogReferences(successor.revision, 'grant')).toEqual([
      grant.id,
      secondGrant.id,
    ]);
  });
});
