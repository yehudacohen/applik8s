import { describe, expect, it } from 'vitest';
import {
  type ApplicationOperationCatalog,
  type ApplicationScopeExpression,
  applicationOperationId,
  intersectApplicationScopes,
  normalizeApplicationScope,
  scopeContainsUnreviewedCode,
  validateApplicationAuthorizationReceipt,
  validateApplicationOperationCatalog,
} from '../src/index.js';

const schema = {
  digest: 'sha256:fixture',
  schema: { type: 'object', properties: {} },
} as const;

function catalog(operations: ApplicationOperationCatalog['operations']): ApplicationOperationCatalog {
  return {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: 'authority-fixture',
    revision: 'catalog-1',
    digest: 'sha256:catalog-1',
    state: 'proposed',
    operations,
    predecessor: 'catalog-0',
  };
}

describe('application operation and authority contracts', () => {
  it('constructs stable operation identities without retaining action vocabulary', () => {
    expect(applicationOperationId({
      domain: 'models',
      owner: 'Post',
      operation: 'publish',
    })).toBe('applik8s://models/Post/operations/publish');

    expect(() => applicationOperationId({
      domain: 'models',
      owner: 'Post stream',
      operation: 'publish',
    })).toThrow(/stable URI path segment/);
  });

  it('normalizes and intersects closed, serializable scope expressions', () => {
    const tenant: ApplicationScopeExpression = {
      kind: 'compare',
      field: 'tenantId',
      operator: 'eq',
      value: { kind: 'reference', source: 'principal', path: 'identity.tenantId' },
    };
    const owner: ApplicationScopeExpression = {
      kind: 'compare',
      field: 'authorId',
      operator: 'eq',
      value: { kind: 'reference', source: 'principal', path: 'identity.subject' },
    };

    expect(intersectApplicationScopes({ kind: 'all' }, tenant, tenant, owner)).toEqual({
      kind: 'and',
      expressions: [tenant, owner],
    });
    expect(normalizeApplicationScope({
      kind: 'or',
      expressions: [{ kind: 'none', reason: 'not applicable' }, owner],
    })).toEqual(owner);
  });

  it('fails closed for invalid, duplicate, and unclassified operations', () => {
    const operations: ApplicationOperationCatalog['operations'] = [
      {
        id: 'applik8s://models/Post/actions/publish',
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'model.operation',
        name: 'publish',
        version: '1',
        input: schema,
        output: schema,
        errors: {},
        placement: { nodeId: 'command-handler.publish-post', runtime: 'command-processor' },
        target: { identity: schema, model: 'Post' },
        authority: {
          classification: 'unclassified',
          grantable: false,
          delegable: false,
          checks: ['execution'],
          defaultScope: { kind: 'none', reason: 'unclassified' },
        },
        transports: [],
      },
    ];
    const diagnostics = validateApplicationOperationCatalog(catalog([...operations, ...operations]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'AUTHORITY_INVALID_OPERATION_ID',
      'AUTHORITY_UNCLASSIFIED_OPERATION',
      'AUTHORITY_INVALID_OPERATION_ID',
      'AUTHORITY_DUPLICATE_OPERATION',
      'AUTHORITY_UNCLASSIFIED_OPERATION',
    ]);
  });

  it('detects runtime code smuggled into untyped serialized policy', () => {
    const malicious = {
      kind: 'field',
      path: 'tenantId',
      operator: 'eq',
      value: () => 'tenant-a',
    } as unknown as ApplicationScopeExpression;

    expect(scopeContainsUnreviewedCode(malicious)).toBe(true);
    expect(scopeContainsUnreviewedCode({
      kind: 'and',
      expressions: [
        { kind: 'audience', audience: 'application-api' },
        { kind: 'relationship', from: 'Post', name: 'owner', to: 'Account', target: { kind: 'all' } },
      ],
    })).toBe(false);
  });

  it('validates durable authorization receipt revision and trusted-context bindings', () => {
    const receipt = {
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1' as const,
      application: 'test',
      id: 'receipt-1',
      operationId: 'applik8s://models/Post/operations/publish' as const,
      operationVersion: 'v1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      principal: {
        id: 'principal-1',
        identity: { id: 'identity-1', kind: 'human' as const, issuer: 'test', subject: 'user-1' },
        kind: 'human' as const,
        authenticationMethod: 'test',
        audience: ['chirp'],
        trustedContextDigest: 'sha256:context',
        catalogRevision: 'catalog-1',
        authorityRevision: 'authority-1',
        admittedAt: '2026-07-29T00:00:00.000Z',
      },
      trustedContextDigest: 'sha256:context',
      matchedPermissionIds: [],
      matchedGrantIds: [],
      inputDigest: 'sha256:input',
      target: { kind: 'all' as const },
      scopeEvidence: [],
      audience: 'chirp',
      transport: 'event' as const,
      admittedAt: '2026-07-29T00:00:00.000Z',
    };

    expect(validateApplicationAuthorizationReceipt(receipt)).toEqual([]);
    expect(validateApplicationAuthorizationReceipt({
      ...receipt,
      principal: { ...receipt.principal, authorityRevision: 'authority-other' },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'receipt.principal' }),
    ]));
    expect(() => validateApplicationAuthorizationReceipt({
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
      application: 'test',
      principal: null,
      target: { kind: 'unknown' },
      scopeEvidence: [null],
    } as never)).not.toThrow();
    expect(validateApplicationAuthorizationReceipt({
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
      application: 'test',
      principal: null,
      target: { kind: 'unknown' },
      scopeEvidence: [null],
    } as never)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'receipt' }),
      expect.objectContaining({ path: 'receipt.principal' }),
      expect.objectContaining({ path: 'receipt.target' }),
    ]));
  });
});
