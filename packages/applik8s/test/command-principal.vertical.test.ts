import type {
  ApplicationExecutionPrincipal,
  ApplicationPrincipal,
} from '@applik8s/core';
import { describe, expect, test } from 'vitest';
import {
  applicationCommandCausalPrincipalId,
  applicationCommandPrincipal,
  applicationCommandPrincipalValues,
  applicationCommandTrustedContext,
} from '../src/command-principal.js';

const human: ApplicationPrincipal = {
  id: 'principal:notes:human:alice',
  identity: {
    id: 'identity:notes:human:alice',
    kind: 'human',
    issuer: 'https://identity.example.test',
    subject: 'alice',
  },
  kind: 'human',
  authenticationMethod: 'session',
  audience: ['notes'],
  trustedContextDigest: 'context-1',
  catalogRevision: 'catalog-1',
  authorityRevision: 'authority-1',
  admittedAt: '2026-08-06T12:00:00.000Z',
};

const agent: ApplicationExecutionPrincipal = {
  ...human,
  id: 'principal:notes:execution:agent:run-1:1',
  identity: {
    id: 'identity:notes:service:assistant',
    kind: 'service',
    issuer: 'applik8s://notes',
    subject: 'assistant',
  },
  kind: 'execution',
  authenticationMethod: 'workload-identity',
  executionKind: 'agent',
  executionId: 'run-1',
  attempt: 1,
  workloadIdentity: {
    id: 'identity:notes:workload:assistant',
    kind: 'workload',
    issuer: 'applik8s://notes',
    subject: 'assistant',
  },
  causalPrincipalId: human.id,
  causalPrincipal: human.identity,
  causalGrantIds: [],
  deadline: '2026-08-06T12:05:00.000Z',
  cancellationRevision: 'cancel-1',
  bindings: [],
  effectiveAuthority: [],
};

describe('durable command ownership attribution', () => {
  test('attributes direct requests to their authenticated actor', () => {
    expect(applicationCommandCausalPrincipalId(human)).toBe(human.id);
  });

  test('attributes agent tools to the admitted causal requester', () => {
    expect(applicationCommandCausalPrincipalId(agent)).toBe(human.id);
    expect(agent.id).not.toBe(human.id);
  });

  test('fails closed when an execution has no causal requester', () => {
    const { causalPrincipalId: _causalPrincipalId, ...unattributed } = agent;
    expect(
      applicationCommandCausalPrincipalId(unattributed),
    ).toBeUndefined();
  });

  test('framework delivery restores the principal without leaking the reserved key to handlers', () => {
    const delivered = {
      ...applicationCommandPrincipalValues(agent),
      tenantId: 'tenant-1',
    };
    expect(applicationCommandPrincipal({ values: delivered })).toMatchObject({
      id: agent.id,
      causalPrincipalId: human.id,
    });
    const handlerVisible = applicationCommandTrustedContext({
      values: delivered,
    });
    expect('applik8s.dev/principal' in handlerVisible).toBe(false);
    expect(handlerVisible.tenantId).toBe('tenant-1');
  });
});
