import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApplicationAuthorizationReceipt,
  type ApplicationPrincipal,
  createApplicationExecutionPrincipalV1,
} from '@applik8s/core';
import {
  createApplicationActorTurnAuthority,
  normalizeApplicationActorTurnAuthority,
} from '../src/application-actor-authority-runtime.js';
import { installApplicationTelemetryRuntimeResolver } from '../src/application-telemetry-runtime.js';

const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length > 0) disposers.pop()?.(); });

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

  it('records canonical, legacy alarm-recovery, and rejected decode evidence without payloads', () => {
    const counts: Array<{ readonly metric: string; readonly attributes?: Readonly<Record<string, string | number | boolean>> }> = [];
    const logs: Array<{ readonly event: string; readonly fields?: Readonly<Record<string, unknown>> }> = [];
    disposers.push(installApplicationTelemetryRuntimeResolver(() => ({
      run: async (_boundary, execute) => execute(),
      log(_severity, event, fields) {
        logs.push(fields === undefined ? { event } : { event, fields });
      },
      count(metric, _value, attributes) {
        counts.push(attributes === undefined ? { metric } : { metric, attributes });
      },
    })));
    const principal = testPrincipal();
    const receipt = testReceipt(principal);
    const legacy = {
      principal: { id: principal.id },
      causalPrincipal: { id: 'principal:human' },
      authorizationReceipt: receipt,
      trustedContextDigest: principal.trustedContextDigest,
    } as const;

    const recovered = normalizeApplicationActorTurnAuthority(legacy, {
      context: 'alarm-delivery',
    });
    normalizeApplicationActorTurnAuthority(recovered);
    expect(() => normalizeApplicationActorTurnAuthority({
      ...legacy,
      principal: { id: 'principal:forged' },
    }, { context: 'durable-read' })).toThrow(/does not match/u);

    expect(counts).toEqual(expect.arrayContaining([
      {
        metric: 'applik8s.actor.authority.legacy_read',
        attributes: { context: 'alarm-delivery' },
      },
      {
        metric: 'applik8s.actor.authority.decode',
        attributes: {
          format: 'canonical-v1',
          context: 'turn',
          outcome: 'accepted',
        },
      },
      {
        metric: 'applik8s.actor.authority.decode',
        attributes: {
          format: 'release-a-legacy',
          context: 'durable-read',
          outcome: 'rejected',
        },
      },
    ]));
    expect(logs).toEqual([
      {
        event: 'applik8s.actor.admission',
        fields: {
          apiVersion: 'applik8s.admission-observation/v1',
          state: 'admitted',
          boundary: 'execution',
          admissionVersion: 'applik8s.admission/v1',
          transport: 'actor',
          compatibilityPath: 'legacy',
        },
      },
      {
        event: 'applik8s.actor.admission',
        fields: {
          apiVersion: 'applik8s.admission-observation/v1',
          state: 'admitted',
          boundary: 'execution',
          admissionVersion: 'applik8s.admission/v1',
          transport: 'actor',
          compatibilityPath: 'canonical',
        },
      },
      {
        event: 'applik8s.actor.admission',
        fields: {
          apiVersion: 'applik8s.admission-observation/v1',
          state: 'rejected',
          boundary: 'execution',
          admissionVersion: 'applik8s.admission/v1',
          transport: 'actor',
          compatibilityPath: 'legacy',
          rejectionCode: 'Error',
        },
      },
    ]);
  });

  it('fails closed when recovered actor execution authority carries a stale cancellation fence', () => {
    const workloadIdentity = {
      id: 'identity:actor-test:workload:actor.workspace.v1:rename',
      kind: 'workload' as const,
      issuer: 'applik8s://actor-test',
      subject: 'actor.workspace.v1:rename',
    };
    const principal = createApplicationExecutionPrincipalV1({
      application: 'actor-test',
      executionKind: 'actor',
      executionId: 'turn-one',
      attempt: 1,
      workloadIdentity,
      executionContext: {
        kind: 'actor',
        actor: 'workspace.v1',
        member: 'rename',
        keyDigest: 'sha256:key',
        turnId: 'turn-one',
      },
      envelopes: [],
      trustedContextDigest: 'sha256:actor-context',
      audience: ['actor-test'],
      catalogRevision: 'catalog-one',
      authorityRevision: 'authority-one',
      admittedAt: '2026-08-23T00:00:00.000Z',
      deadline: '2026-08-23T00:05:00.000Z',
      cancellationRevision: 'active:turn-one',
    });

    expect(() => createApplicationActorTurnAuthority({
      admission: { principal, trustedContext: {} },
      operationId: 'applik8s://actors/workspace.v1/operations/rename',
      correlationId: 'turn-one',
      causalPrincipal: { id: principal.causalPrincipalId ?? principal.id },
      cancellation: { revision: 'cancelled:turn-one' },
    })).toThrow(/cancellation fence revision/u);
    expect(createApplicationActorTurnAuthority({
      admission: { principal, trustedContext: {} },
      operationId: 'applik8s://actors/workspace.v1/operations/rename',
      correlationId: 'turn-one',
      causalPrincipal: { id: principal.causalPrincipalId ?? principal.id },
      cancellation: { revision: principal.cancellationRevision },
    })).toMatchObject({
      admission: {
        cancellation: { revision: 'active:turn-one' },
      },
    });
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
