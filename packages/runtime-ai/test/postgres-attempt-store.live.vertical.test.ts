// typecast-file-boundary: the live PostgreSQL fixture constructs one complete
// public execution principal and reads only records validated by the durable
// AI runtime before asserting persisted state.

import {
  type ApplicationAIResolvedRoute,
  createApplicationAIAttemptRuntime,
} from '@applik8s/ai';
import type {
  ApplicationExecutionPrincipal,
  ApplicationOperationId,
} from '@applik8s/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresApplicationAIAttemptStore } from '../src/index.js';

const databaseUrl = process.env.APPLIK8S_AI_TEST_DATABASE_URL;
const live = databaseUrl ? describe : describe.skip;
const schema = `applik8s_ai_test_${process.pid}`;
const sql = databaseUrl
  ? postgres(databaseUrl, { max: 8, prepare: false })
  : undefined;

live('PostgreSQL durable AI attempt store', () => {
  beforeAll(async () => {
    await sql?.unsafe(`CREATE SCHEMA ${schema}`);
  });

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await sql?.end({ timeout: 5 });
  });

  it('serializes concurrent reservation and survives runtime replacement', async () => {
    if (!sql) throw new Error('Expected a live PostgreSQL client.');
    const store = createPostgresApplicationAIAttemptStore({ sql, schema });
    const runtime = createApplicationAIAttemptRuntime({
      store,
      ids: deterministicIds(),
    });
    await runtime.reserveInvocation({
      invocationId: 'invocation-live-1',
      conversationId: 'conversation-live-1',
      protocolRunId: 'protocol-run-live-1',
      agentRunId: 'agent-run-live-1',
      logicalModel: 'fast',
      request: { messages: [{ role: 'user', content: 'hello' }] },
      admittedPrincipal: principal(),
    });
    const persistedInvocations = await sql.unsafe(
      `SELECT count(*)::integer AS count, min(record->>'id') AS id FROM ${schema}.applik8s_ai_invocations`,
    );
    expect(persistedInvocations[0]).toMatchObject({
      count: 1,
      id: 'invocation-live-1',
    });
    expect(await runtime.observe('invocation-live-1')).toMatchObject({
      invocation: { id: 'invocation-live-1' },
      attempts: [],
    });

    const decisions = await Promise.all(
      Array.from({ length: 12 }, () =>
        runtime.reserveAttempt({
          invocationId: 'invocation-live-1',
          redactedRequestMetadata: { messageCount: 1 },
          route,
        })),
    );

    expect(new Set(decisions.map((decision) => decision.attempt.id))).toHaveLength(1);
    expect(decisions.filter((decision) => decision.action === 'dispatch')).toHaveLength(1);
    const reserved = decisions[0]?.attempt;
    if (!reserved) throw new Error('Expected one durable attempt.');
    const dispatching = await runtime.transition(
      'invocation-live-1',
      reserved.id,
      reserved.version,
      { state: 'dispatching', recovery: 'joinable' },
    );
    await runtime.appendDelta(
      'invocation-live-1',
      reserved.id,
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'persisted' },
    );
    const proposal = await runtime.reserveToolProposal({
      invocationId: 'invocation-live-1',
      attemptId: reserved.id,
      providerToolCallId: 'provider-tool-live-1',
      operationId: (
        'applik8s://models/AccessRequest/operations/create'
      ) as ApplicationOperationId,
      operationVersion: 'v1',
      arguments: {
        target: 'production/catalog',
        evidence: 'PostgreSQL JSONB accepts the durable proposal identity.',
      },
    });
    expect(proposal.id).toMatch(/^proposal_[a-f0-9]{64}$/u);
    const persistedProposals = await sql.unsafe(
      `SELECT count(*)::integer AS count, min(record->>'id') AS id
       FROM ${schema}.applik8s_ai_tool_proposals`,
    );
    expect(persistedProposals[0]).toMatchObject({
      count: 1,
      id: proposal.id,
    });

    const replacement = createApplicationAIAttemptRuntime({
      store: createPostgresApplicationAIAttemptStore({ sql, schema }),
      ids: deterministicIds(),
    });
    const observed = await replacement.observe('invocation-live-1');

    expect(observed).toMatchObject({
      invocation: {
        id: 'invocation-live-1',
        currentAttemptId: reserved.id,
      },
      attempts: [{
        id: reserved.id,
        state: 'streaming',
        version: dispatching.version + 1,
        streamFrontier: 1,
      }],
      deltas: [{
        attemptId: reserved.id,
        sequence: 1,
        event: {
          type: 'TEXT_MESSAGE_CONTENT',
          delta: 'persisted',
        },
      }],
    });
  });
}, 30_000);

const route: ApplicationAIResolvedRoute = {
  policyRevision: 'sha256:route-live-1',
  logicalModel: 'fast',
  providerClass: 'deterministic',
  backend: 'deterministic',
  concreteModel: 'deterministic',
  capabilities: ['chat', 'streaming'],
  route: 'deterministic/fast',
  fallbackChain: [],
};

function deterministicIds() {
  let attempt = 0;
  let command = 0;
  return {
    next(prefix: 'attempt' | 'command') {
      if (prefix === 'attempt') return `attempt-live-${++attempt}`;
      return `command-live-${++command}`;
    },
  };
}

function principal(): ApplicationExecutionPrincipal {
  return {
    id: 'principal://agent/researcher/agent-run-live-1',
    identity: {
      id: 'identity://executions/researcher/agent-run-live-1',
      kind: 'execution',
      issuer: 'applik8s',
      subject: 'researcher/agent-run-live-1',
    },
    kind: 'execution',
    authenticationMethod: 'workload-envelope',
    audience: ['agent:researcher'],
    trustedContextDigest: 'sha256:context-live',
    catalogRevision: 'catalog-live-1',
    authorityRevision: 'authority-live-1',
    admittedAt: new Date().toISOString(),
    executionKind: 'agent',
    executionId: 'agent-run-live-1',
    attempt: 1,
    workloadIdentity: {
      id: 'identity://workloads/researcher',
      kind: 'workload',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    serviceIdentity: {
      id: 'identity://services/researcher',
      kind: 'service',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    causalGrantIds: [],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    cancellationRevision: 'cancel-live-1',
    bindings: [],
    effectiveAuthority: [],
  };
}
