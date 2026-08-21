// typecast-file-boundary: persisted-row and malformed-payload fixtures deliberately cross erased signal storage contracts to exercise fail-closed validation.
import {
  applicationSignalAccessAllows,
  applicationSignalIsActionable,
  applicationSignalPostgresMigrationSql,
  createApplicationSignalIssuanceDecoder,
  createApplicationWorkflowSignalRuntime,
  createMemoryApplicationSignalStore,
  createPostgresApplicationSignalStore,
  hydrateApplicationSignal,
  runApplicationSignalOutboxRelay,
  type ApplicationSignalDefinition,
  type ApplicationSignalReference,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import {
  applicationAdmissionInvocationView,
  createApplicationAdmissionContextV1,
  createApplicationExecutionPrincipalV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import type { ApplicationPostgresSql } from '../src/postgres-runtime-contract.js';

const ReviewDecision: ApplicationSignalDefinition<
  { postId: string },
  {
    approve: { comment?: string };
    reject: { reason: string };
  }
> = {
  kind: 'applicationSignalDefinition' as const,
  id: 'review-decision.v1',
  name: 'review-decision',
  version: 'v1',
  input: type({ postId: 'string' }),
  actions: {
    approve: type({ 'comment?': 'string' }),
    reject: type({ reason: 'string' }),
  },
};

describe('v0.7 canonical signal runtime', () => {
  it('issues idempotently and commits one immutable outbox fact', async () => {
    const store = createMemoryApplicationSignalStore();
    let authorizations = 0;
    const createRuntime = () =>
      createApplicationWorkflowSignalRuntime({
        store,
        invocation: { id: 'run-1', revision: 'revision-1' },
        occurrence: () => 'call-site-1:1',
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        authorizeIssue: (_request, { signalId }) => {
          authorizations += 1;
          return { id: `authority:${signalId}` };
        },
        wait: async () => undefined,
      });

    const first = await createRuntime().emit(ReviewDecision, {
      input: { postId: 'post-1' },
      expiresIn: '24h',
      target: { postId: 'post-1' },
      authorize: [{ role: 'reviewer' }],
    });
    const replay = await createRuntime().emit(ReviewDecision, {
      input: { postId: 'post-1' },
      expiresIn: '24h',
      target: { postId: 'post-1' },
      authorize: [{ role: 'reviewer' }],
    });

    expect(replay.issuance.id).toBe(first.issuance.id);
    expect(replay.issueReceipt).toEqual(first.issueReceipt);
    expect(first.issueReceipt).toEqual({
      id: `authority:${first.issuance.id}`,
    });
    expect(authorizations).toBe(1);
    expect(await store.pendingOutbox(10)).toEqual([
      expect.objectContaining({
        kind: 'issued',
        signalId: first.issuance.id,
        contractId: ReviewDecision.id,
      }),
    ]);
  });

  it('recovers every issuance-to-publication crash window without duplicating canonical state', async () => {
    const store = createMemoryApplicationSignalStore();
    const occurrence = () => 'crash-window:1';
    let failAdmission = true;
    const runtime = () => createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-crash-windows', revision: 'revision-1' },
      occurrence,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => {
        if (failAdmission) throw new Error('crash-before-issuance-commit');
        return { id: 'receipt:issued' };
      },
      wait: async () => undefined,
    });
    const request = {
      input: { postId: 'post-crash-windows' },
      expiresIn: '24h',
      target: { postId: 'post-crash-windows' },
      authorize: [{ role: 'reviewer' }],
    } as const;

    await expect(runtime().emit(ReviewDecision, request))
      .rejects.toThrow('crash-before-issuance-commit');
    expect(await store.pendingOutbox(10)).toEqual([]);

    failAdmission = false;
    const committed = await runtime().emit(ReviewDecision, request);
    const replayedAfterHistoryLoss = await runtime().emit(ReviewDecision, request);
    expect(replayedAfterHistoryLoss.issuance.id).toBe(committed.issuance.id);
    expect(await store.pendingOutbox(10)).toHaveLength(1);

    const controller = new AbortController();
    const attempts: string[] = [];
    let crashAfterPublish = true;
    await runApplicationSignalOutboxRelay({
      store,
      signal: controller.signal,
      now: () => new Date('2026-01-01T01:00:00.000Z'),
      idleMs: 1,
      sleep: async () => undefined,
      publish: async (fact) => {
        attempts.push(fact.id);
        if (crashAfterPublish) {
          crashAfterPublish = false;
          throw new Error('crash-after-broker-publication-before-ack');
        }
        controller.abort();
      },
    });

    expect(attempts).toEqual([attempts[0], attempts[0]]);
    expect(await store.pendingOutbox(10)).toEqual([]);
    expect((await store.read(committed.issuance.id))?.terminal).toBeUndefined();
  });

  it('derives actor identity from the framework and redacts the winning payload from a losing action', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-2', revision: 'revision-1' },
      occurrence: () => 'call-site-1:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-2' },
      expiresIn: '24h',
      target: { postId: 'post-2' },
      grantAccessTo: {
        id: 'reviewer-1',
        kind: 'human',
        issuer: 'test',
        subject: 'reviewer-1',
      },
    });
    const reference = decision as ApplicationSignalReference<typeof ReviewDecision>;
    const reviewer = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference,
      actor: { id: 'reviewer-1', roles: ['reviewer'] },
      authorizeAction: async ({ action }) => ({ id: `receipt:${action}:reviewer-1` }),
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    const other = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference,
      actor: { id: 'reviewer-2', roles: ['reviewer'] },
      authorizeAction: async ({ action }) => ({ id: `receipt:${action}:reviewer-2` }),
      now: () => new Date('2026-01-01T01:00:01.000Z'),
    });

    const resolved = await reviewer.approve({ comment: 'Looks good' });
    expect(resolved).toMatchObject({
      status: 'resolved',
      outcome: {
        action: 'approve',
        input: { comment: 'Looks good' },
        actor: { id: 'reviewer-1' },
      },
    });

    const losing = await other.reject({ reason: 'private reason' });
    expect(losing).toEqual({
      status: 'alreadyResolved',
      outcome: {
        status: 'resolved',
        decidedAt: '2026-01-01T01:00:00.000Z',
      },
    });
    expect(JSON.stringify(losing)).not.toContain('Looks good');
    expect(JSON.stringify(losing)).not.toContain('reviewer-1');
  });

  it('returns the original correlated result for an exact same-action idempotent replay', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-idempotent-action', revision: 'revision-1' },
      occurrence: () => 'call-site-idempotent-action:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-idempotent-action' },
      expiresIn: '24h',
      target: { postId: 'post-idempotent-action' },
      authorize: [{ role: 'reviewer' }],
    });
    let authorizations = 0;
    const signal = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference: decision,
      actor: { id: 'reviewer-idempotent' },
      authorizeAction: async () => {
        authorizations += 1;
        return { id: 'receipt:idempotent-action' };
      },
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });

    const first = await signal.approve(
      { comment: 'Ship it once' },
      { idempotencyKey: 'approve-once' },
    );
    const replay = await signal.approve(
      { comment: 'Ship it once' },
      { idempotencyKey: 'approve-once' },
    );

    expect(replay).toEqual(first);
    expect(replay).toMatchObject({
      status: 'resolved',
      outcome: {
        action: 'approve',
        input: { comment: 'Ship it once' },
        actor: { id: 'reviewer-idempotent' },
      },
      receipt: { id: 'receipt:idempotent-action' },
    });
    expect(authorizations).toBe(1);
  });

  it('admits exactly one concurrent terminal action in the memory authority', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-concurrent-action', revision: 'revision-1' },
      occurrence: () => 'call-site-concurrent-action:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-concurrent-action' },
      expiresIn: '24h',
      target: { postId: 'post-concurrent-action' },
      authorize: [{ role: 'reviewer' }],
    });
    const approvals: string[] = [];
    const signal = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference: decision,
      actor: { id: 'reviewer-concurrent' },
      authorizeAction: async ({ action }) => {
        approvals.push(action);
        await Promise.resolve();
        return { id: `receipt:${action}` };
      },
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });

    const [approve, reject] = await Promise.all([
      signal.approve(
        { comment: 'winner' },
        { idempotencyKey: 'concurrent-approve' },
      ),
      signal.reject(
        { reason: 'loser' },
        { idempotencyKey: 'concurrent-reject' },
      ),
    ]);

    expect(approve).toMatchObject({
      status: 'resolved',
      outcome: { action: 'approve', input: { comment: 'winner' } },
    });
    expect(reject).toEqual({
      status: 'alreadyResolved',
      outcome: {
        status: 'resolved',
        decidedAt: '2026-01-01T01:00:00.000Z',
      },
    });
    expect(approvals).toEqual(['approve']);
    expect(await store.pendingOutbox(10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'issued' }),
        expect.objectContaining({
          kind: 'resolved',
          payload: expect.objectContaining({ action: 'approve' }),
        }),
      ]),
    );
  });

  it('authorizes and retires exact-instance authority inside the terminal transition', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-terminal-authority', revision: 'revision-1' },
      occurrence: () => 'call-site-terminal:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => ({ id: 'receipt:issue' }),
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-terminal' },
      expiresIn: '24h',
      target: { postId: 'post-terminal' },
      grantAccessTo: {
        id: 'identity:reviewer',
        kind: 'human',
        issuer: 'test',
        subject: 'reviewer',
      },
    });
    const order: string[] = [];
    const signal = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference: decision,
      actor: { id: 'identity:reviewer' },
      authorizeAction: async ({ transaction }) => {
        expect(transaction).toBeUndefined();
        order.push('authorize');
        return { id: 'receipt:approve' };
      },
      finalizeAction: async ({ terminal }, { transaction }) => {
        expect(transaction).toBeUndefined();
        expect(terminal).toMatchObject({
          status: 'resolved',
          action: 'approve',
          receipt: { id: 'receipt:approve' },
        });
        order.push('retire-grant');
      },
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });

    await signal.approve({ comment: 'approved' });
    expect(order).toEqual(['authorize', 'retire-grant']);

    await signal.reject({ reason: 'already terminal' });
    expect(order).toEqual(['authorize', 'retire-grant']);
  });

  it('decodes an inert issuance into a current-authority server capability', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-decoder', revision: 'revision-1' },
      occurrence: () => 'call-site-1:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-decoder' },
      expiresIn: '24h',
      target: { postId: 'post-decoder' },
      authorize: [{ role: 'reviewer' }],
    });
    const reference = decision as ApplicationSignalReference<typeof ReviewDecision>;
    const decoder = createApplicationSignalIssuanceDecoder({
      store,
      definition: ReviewDecision,
      admit: async (_issuance, context) => ({
        actor: {
          id: context.principal?.id ?? 'workload:reviewer',
          roles: ['reviewer'],
        },
        authorizeAction: async ({ action }) => ({
          id: `receipt:${action}:server`,
        }),
      }),
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    const workloadIdentity = {
      id: 'identity:test:workload:signal-processor',
      kind: 'workload' as const,
      issuer: 'applik8s://test',
      subject: 'signal-processor',
    };
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const executionPrincipal = createApplicationExecutionPrincipalV1({
      application: 'test',
      executionKind: 'processor',
      executionId: 'signal-processor:event-decoder',
      attempt: 1,
      workloadIdentity,
      envelopes: [],
      trustedContextDigest: 'signal-context-v1',
      audience: ['signal-processor'],
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      deadline,
      cancellationRevision: 'active:signal-processor:event-decoder',
    });
    const admission = applicationAdmissionInvocationView(
      withApplicationAdmissionExecutionV1(
        createApplicationAdmissionContextV1({
          admission: { principal: executionPrincipal, trustedContext: {} },
          operation: {
            id: 'applik8s://processors/signal/operations/deliver',
            transport: 'broker',
          },
          correlationId: 'event-decoder',
        }),
        {
          causationId: 'event-decoder',
          deadline,
          cancellation: {
            revision: 'active:signal-processor:event-decoder',
          },
        },
      ),
    );
    const decoded = await decoder({
      id: reference.issuance.id,
      input: { postId: 'post-decoder' },
      signal: reference,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: reference.expiresAt,
    }, {
      admission,
      event: {
        id: 'event-decoder',
        stream: { name: ReviewDecision.name, version: ReviewDecision.version },
        sequence: 1,
        recordedAt: '2026-01-01T00:00:00.000Z',
        partitionKey: reference.issuance.id,
      },
      trustedContext: {},
      signal: new AbortController().signal,
    });

    expect(typeof decoded.signal.approve).toBe('function');
    await expect(decoded.signal.approve({ comment: 'server decision' }))
      .resolves.toMatchObject({
        status: 'resolved',
        outcome: {
          action: 'approve',
          actor: { id: 'workload:reviewer' },
        },
      });
  });

  it('narrows existing authority by exact identity or role and fails closed on unknown selectors', async () => {
    const base = {
      id: 'signal-1',
      occurrenceKey: 'occurrence-1',
      contract: {
        id: ReviewDecision.id,
        name: ReviewDecision.name,
        version: ReviewDecision.version,
      },
      input: { postId: 'post-1' },
      actions: ['approve', 'reject'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
      target: { postId: 'post-1' },
      issueReceipt: { id: 'receipt:issue' },
    } as const;

    expect(applicationSignalAccessAllows({
      ...base,
      access: { mode: 'authorize', selectors: [{ id: 'identity:reviewer' }] },
    }, { id: 'identity:reviewer' })).toBe(true);
    expect(applicationSignalAccessAllows({
      ...base,
      access: { mode: 'authorize', selectors: [{ role: 'reviewer' }] },
    }, { id: 'identity:other', roles: ['reviewer'] })).toBe(true);
    expect(applicationSignalAccessAllows({
      ...base,
      access: {
        mode: 'authorize',
        selectors: [{ relationship: 'organization.reviewers' }],
      },
    }, { id: 'identity:reviewer', roles: ['reviewer'] })).toBe(false);

    expect(applicationSignalIsActionable({
      ...base,
      access: { mode: 'authorize', selectors: [{ role: 'reviewer' }] },
    }, new Date('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(applicationSignalIsActionable({
      ...base,
      access: { mode: 'authorize', selectors: [{ role: 'reviewer' }] },
      terminal: {
        status: 'expired',
        expiredAt: '2026-01-01T12:00:00.000Z',
      },
    }, new Date('2026-01-01T12:00:00.000Z'))).toBe(false);
    expect(applicationSignalIsActionable({
      ...base,
      access: { mode: 'authorize', selectors: [{ role: 'reviewer' }] },
    }, new Date('2026-01-02T00:00:00.000Z'))).toBe(false);
  });

  it('reattaches to canonical state after wakeup and matches the correlated terminal action', async () => {
    const store = createMemoryApplicationSignalStore();
    let wake: (() => void) | undefined;
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-3', revision: 'revision-1' },
      occurrence: () => 'call-site-1:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: () => new Promise<void>((resolve) => {
        wake = resolve;
      }),
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-3' },
      expiresIn: '24h',
      target: { postId: 'post-3' },
      authorize: [],
    });
    const awaiting = decision();
    const signal = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference: decision,
      actor: { id: 'reviewer-3' },
      authorizeAction: async () => ({ id: 'receipt:approve' }),
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    await signal.approve({ comment: 'ship it' });
    wake?.();

    const outcome = await awaiting;
    await expect(
      outcome.match({
        approve: async ({ actor, input }) => `${actor.id}:${input.comment}`,
        reject: async ({ input }) => input.reason,
        expired: async () => 'expired',
      }),
    ).resolves.toBe('reviewer-3:ship it');
  });

  it('propagates the owning workflow cancellation through issuance and durable wait', async () => {
    const store = createMemoryApplicationSignalStore();
    const cancellation = new AbortController();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      signal: cancellation.signal,
      invocation: { id: 'run-cancelled', revision: 'revision-1' },
      occurrence: () => 'call-site-cancelled:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async (_reference, options) => {
        expect(options?.signal).toBe(cancellation.signal);
        cancellation.abort(new Error('workflow-cancelled'));
      },
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-cancelled' },
      expiresIn: '24h',
      target: { postId: 'post-cancelled' },
      authorize: [],
    });

    await expect(decision()).rejects.toThrow('workflow-cancelled');
    await expect(runtime.emit(ReviewDecision, {
      input: { postId: 'post-never-issued' },
      expiresIn: '24h',
      target: { postId: 'post-never-issued' },
      authorize: [],
    })).rejects.toThrow('workflow-cancelled');
  });

  it('always replays the durable wait before reading an already-terminal decision', async () => {
    const store = createMemoryApplicationSignalStore();
    let waits = 0;
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-terminal-before-wait', revision: 'revision-1' },
      occurrence: () => 'call-site-terminal-before-wait:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => {
        waits += 1;
      },
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-terminal-before-wait' },
      expiresIn: '24h',
      target: { postId: 'post-terminal-before-wait' },
      authorize: [],
    });
    const signal = hydrateApplicationSignal({
      store,
      definition: ReviewDecision,
      reference: decision,
      actor: { id: 'reviewer-terminal-before-wait' },
      authorizeAction: async () => ({ id: 'receipt:terminal-before-wait' }),
      now: () => new Date('2026-01-01T01:00:00.000Z'),
    });
    await signal.approve({ comment: 'already terminal' });

    const first = await decision();
    const second = await decision();

    expect(waits).toBe(2);
    expect(first.value).toMatchObject({
      status: 'resolved',
      action: 'approve',
      input: { comment: 'already terminal' },
    });
    expect(second.value).toEqual(first.value);
  });

  it('retains the PostgreSQL local-transaction authority tables explicitly', () => {
    const migration = applicationSignalPostgresMigrationSql.join('\n');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_public_stream_events');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_signals');
    expect(migration).toContain('occurrence_key text NOT NULL UNIQUE');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_signal_resolutions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_signal_outbox');
    expect(migration).toContain("CHECK (kind IN ('issued', 'resolved', 'expired'))");
  });

  it('retries PostgreSQL schema preparation after a transient connection failure', async () => {
    let attempts = 0;
    const sql: ApplicationPostgresSql = {
      async unsafe() {
        attempts += 1;
        if (attempts === 1) throw new Error('transient connection failure');
        return [];
      },
      async begin(operation) {
        return operation({
          unsafe: async () => [],
          json: (value) => value,
        });
      },
      async end() {},
    };
    const store = createPostgresApplicationSignalStore({ sql });

    await expect(store.read('readiness')).rejects.toThrow(
      'transient connection failure',
    );
    await expect(store.read('readiness')).resolves.toBeUndefined();
    expect(attempts).toBeGreaterThan(
      applicationSignalPostgresMigrationSql.length,
    );
  });

  it('relays committed facts at least once and advances canonical expiry', async () => {
    const store = createMemoryApplicationSignalStore();
    const runtime = createApplicationWorkflowSignalRuntime({
      store,
      invocation: { id: 'run-relay', revision: 'revision-1' },
      occurrence: () => 'call-site-1:1',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      authorizeIssue: () => undefined,
      wait: async () => undefined,
    });
    const decision = await runtime.emit(ReviewDecision, {
      input: { postId: 'post-relay' },
      expiresIn: '1h',
      target: { postId: 'post-relay' },
      authorize: [],
    });
    const controller = new AbortController();
    const published: string[] = [];
    await runApplicationSignalOutboxRelay({
      store,
      signal: controller.signal,
      now: () => new Date('2026-01-01T02:00:00.000Z'),
      idleMs: 1,
      publish: async (fact) => {
        published.push(fact.kind);
        if (fact.kind === 'expired') controller.abort();
      },
    });

    expect(published).toEqual(['issued', 'expired']);
    expect(await store.pendingOutbox(10)).toEqual([]);
    await expect(decision()).resolves.toMatchObject({
      value: {
        status: 'expired',
        expiredAt: '2026-01-01T02:00:00.000Z',
      },
    });
  });
});
