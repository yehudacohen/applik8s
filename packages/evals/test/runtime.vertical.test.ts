import type {
  ApplicationExecutionPrincipal,
} from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { executeApplicationDeterministicAgentCase } from '../src/runtime.js';

const Input = type({ text: 'string' });
const Output = type({ id: 'string' });
const operation = {
  id: 'applik8s://evaluations/operations/create-document',
  schemas: { input: Input, output: Output },
};

describe('deterministic agent evaluation runtime', () => {
  it('executes one typed operation through the native agent loop without calling the operation implementation', async () => {
    await expect(executeApplicationDeterministicAgentCase({
      instructions: 'Create a durable document through the admitted operation.',
      request: 'Create the launch brief.',
      operation,
      operationInput: { text: 'Launch brief' },
      operationOutput: { id: 'evaluation-document' },
      principal,
      maximumTurns: 5,
      maximumToolCalls: 4,
    })).resolves.toMatchObject({
      operationId: operation.id,
      invocationCount: 1,
      invokedInput: { text: 'Launch brief' },
      providerToolCallId: expect.stringMatching(/^tool-call-/u),
      response: 'The isolated typed operation completed.',
    });
  });

  it('fails closed for missing requests and invalid budgets', async () => {
    await expect(executeApplicationDeterministicAgentCase({
      instructions: 'Use the operation.',
      request: ' ',
      operation,
      operationInput: { text: 'evidence' },
      operationOutput: { id: 'evaluation-document' },
      principal,
      maximumTurns: 0,
      maximumToolCalls: 1,
    })).rejects.toThrow(/case request/iu);
  });
});

const principal: ApplicationExecutionPrincipal = {
  id: 'principal:evaluation-run',
  identity: {
    id: 'identity:evaluation-run',
    kind: 'execution',
    issuer: 'applik8s://evaluation-test',
    subject: 'evaluation-run',
  },
  kind: 'execution',
  authenticationMethod: 'workload-jwt',
  audience: ['evaluation'],
  trustedContextDigest: 'sha256:evaluation-context',
  catalogRevision: 'catalog-v1',
  authorityRevision: 'authority-v1',
  admittedAt: '2026-08-16T12:00:00.000Z',
  executionKind: 'processor',
  executionId: 'evaluation-run',
  attempt: 1,
  workloadIdentity: {
    id: 'identity:evaluation-worker',
    kind: 'workload',
    issuer: 'applik8s://evaluation-test',
    subject: 'evaluation-worker',
  },
  causalGrantIds: [],
  deadline: '2026-08-16T12:05:00.000Z',
  cancellationRevision: 'cancel-v1',
  bindings: [],
  effectiveAuthority: [],
};
