import { describe, expect, it } from 'vitest';
import type {
  ApplicationAuthorizationReceipt,
  ApplicationPrincipal,
} from '@applik8s/core';
import {
  createApplicationActorTurnAuthority,
  normalizeApplicationActorTurnAuthority,
} from '../src/application-actor-authority-runtime.js';

describe('canonical actor turn authority', () => {
  it('constructs one canonical actor admission while preserving causal lineage', () => {
    const principal = testPrincipal();
    const receipt = testReceipt(principal);
    const authority = createApplicationActorTurnAuthority({
      admission: { principal, trustedContext: { organizationId: 'org-one' } },
      operationId: receipt.operationId,
      correlationId: 'actor-call-one',
      causationId: 'request-one',
      causalPrincipal: { id: 'principal:human' },
      authorizationReceipt: receipt,
      cancellation: { revision: 'cancel-one' },
    });

    expect(authority).toMatchObject({
      principal: { id: principal.id },
      causalPrincipal: { id: 'principal:human' },
      trustedContextDigest: principal.trustedContextDigest,
      admission: {
        apiVersion: 'applik8s.admission/v1',
        authorityRevision: principal.authorityRevision,
        operation: { id: receipt.operationId, transport: 'actor' },
        correlationId: 'actor-call-one',
        causationId: 'request-one',
        cancellation: { revision: 'cancel-one' },
        trustedContext: {
          values: { organizationId: 'org-one' },
          digest: principal.trustedContextDigest,
        },
      },
    });
    expect(normalizeApplicationActorTurnAuthority(authority)).toEqual(authority);
  });

  it('upgrades the released durable alarm authority from its complete receipt', () => {
    const principal = testPrincipal();
    const receipt = testReceipt(principal);
    const upgraded = normalizeApplicationActorTurnAuthority({
      principal: { id: principal.id },
      causalPrincipal: { id: 'principal:original-human' },
      authorizationReceipt: receipt,
      trustedContextDigest: principal.trustedContextDigest,
    });

    expect(upgraded.admission).toMatchObject({
      apiVersion: 'applik8s.admission/v1',
      principal: { id: principal.id },
      operation: { id: receipt.operationId, transport: 'actor' },
      correlationId: `actor-receipt:${receipt.id}`,
      trustedContext: {
        values: {},
        digest: principal.trustedContextDigest,
      },
    });
    expect(upgraded.causalPrincipal.id).toBe('principal:original-human');
  });

  it('rejects incomplete legacy authority and forged compatibility mirrors', () => {
    expect(() => normalizeApplicationActorTurnAuthority({
      principal: { id: 'principal:forged' },
      causalPrincipal: { id: 'principal:forged' },
      authorizationReceipt: {
        id: 'internal:forged',
        authorityRevision: 'authority-one',
      },
      trustedContextDigest: 'context-one',
    })).toThrow(/complete authorization receipt/u);

    const principal = testPrincipal();
    const receipt = testReceipt(principal);
    const authority = createApplicationActorTurnAuthority({
      admission: { principal, trustedContext: {} },
      operationId: receipt.operationId,
      correlationId: 'actor-call-two',
      causalPrincipal: { id: principal.id },
      authorizationReceipt: receipt,
    });
    expect(() => normalizeApplicationActorTurnAuthority({
      ...authority,
      principal: { id: 'principal:forged' },
    })).toThrow(/compatibility fields/u);
  });
});

function testPrincipal(): ApplicationPrincipal {
  return Object.freeze({
    id: 'principal:actor-caller',
    identity: Object.freeze({
      id: 'identity:actor-caller',
      kind: 'human',
      issuer: 'test',
      subject: 'actor-caller',
    }),
    kind: 'human',
    authenticationMethod: 'test',
    audience: Object.freeze(['actor-test']),
    trustedContextDigest: 'sha256:actor-context',
    catalogRevision: 'catalog-one',
    authorityRevision: 'authority-one',
    admittedAt: '2026-08-23T00:00:00.000Z',
  });
}

function testReceipt(
  principal: ApplicationPrincipal,
): ApplicationAuthorizationReceipt {
  return Object.freeze({
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    id: 'receipt:actor-call',
    application: 'actor-test',
    operationId: 'applik8s://actors/workspace.v1/operations/rename',
    operationVersion: 'v1',
    catalogRevision: principal.catalogRevision,
    authorityRevision: principal.authorityRevision,
    principal,
    trustedContextDigest: principal.trustedContextDigest,
    matchedPermissionIds: Object.freeze([]),
    matchedGrantIds: Object.freeze([]),
    inputDigest: 'sha256:actor-input',
    target: Object.freeze({
      kind: 'target',
      model: 'workspace.v1',
      identity: Object.freeze({ key: 'workspace-one' }),
    }),
    scopeEvidence: Object.freeze([]),
    audience: 'actor-test',
    transport: 'direct',
    admittedAt: '2026-08-23T00:00:00.000Z',
  });
}
