import {
  createApplicationSignalGateway,
  createApplicationWorkflowSignalRuntime,
  createPostgresApplicationSignalStore,
  hydrateApplicationSignalClient,
  runApplicationSignalOutboxRelay,
  type ApplicationSignalDefinition,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import type {
  ApplicationOperationCatalog,
  ApplicationStaticAuthorityManifest,
} from '@applik8s/core';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.APPLIK8S_V07_SIGNAL_DATABASE_URL;

const ReviewDecision: ApplicationSignalDefinition<
  { postId: string },
  {
    approve: { comment?: string };
    reject: { reason: string };
  }
> = {
  kind: 'applicationSignalDefinition',
  id: 'review-decision.v1',
  name: 'review-decision',
  version: 'v1',
  input: type({ postId: 'string' }),
  actions: {
    approve: type({ 'comment?': 'string' }),
    reject: type({ reason: 'string' }),
  },
};

describe('v0.7 live PostgreSQL signal authority', () => {
  it.skipIf(!databaseUrl)(
    'authorizes a role-scoped signal action inside the canonical signal transaction',
    async () => {
      const liveDatabaseUrl = databaseUrl;
      if (!liveDatabaseUrl) {
        throw new Error('Live PostgreSQL signal test requires its database URL.');
      }
      const sql = postgres(liveDatabaseUrl, {
        max: 4,
        prepare: false,
        onnotice: () => undefined,
      });
      const operationId =
        'applik8s://signals/review-decision.v1/operations/approve';
      const catalog: ApplicationOperationCatalog = {
        apiVersion: 'applik8s.operationCatalog/v1alpha1',
        application: 'signal-role-live',
        revision: 'signal-role-live-r1',
        digest: 'sha256:signal-role-live-r1',
        state: 'proposed',
        operations: [{
          apiVersion: 'applik8s.operation/v1alpha1',
          id: operationId,
          version: 'v1',
          name: 'approve',
          kind: 'signal.action',
          input: { digest: 'sha256:approve-input', schema: {} },
          output: { digest: 'sha256:approve-output', schema: {} },
          errors: {},
          authority: {
            classification: 'runtime-grantable',
            grantable: true,
            delegable: false,
            checks: ['admission', 'execution', 'result-read'],
            defaultScope: { kind: 'all' },
            transports: ['http'],
          },
          transports: [{
            id: 'review-decision.v1.approve.http',
            transport: 'http',
            server: 'signal-role-live-gateway',
          }],
          placement: {
            nodeId: 'signal-role-live-gateway',
            runtime: 'server',
          },
        }],
      };
      const manifest: ApplicationStaticAuthorityManifest = {
        apiVersion: 'applik8s.authorityManifest/v1alpha1',
        application: 'signal-role-live',
        revision: 'sha256:signal-role-live-authority',
        identities: [],
        permissions: [{
          id: 'permission:signal-role-live:reviewer',
          name: 'reviewer-signal-actions',
          operationIds: [operationId],
          scope: { kind: 'all' },
          transports: ['http'],
          grantable: true,
        }],
        roles: [{
          id: 'role:signal-role-live:reviewer',
          name: 'reviewer',
          permissionIds: ['permission:signal-role-live:reviewer'],
        }],
        grants: [],
        outcomes: [],
      };
      const authority = createApplicationOperationAuthorityRuntime({
        sql,
        application: 'signal-role-live',
        catalog,
        authorityManifest: manifest,
      });
      const principal = await authority.admitPrincipal({
        id: 'principal:signal-role-live:reviewer',
        identity: {
          id: 'identity:signal-role-live:reviewer',
          kind: 'human',
          issuer: 'test',
          subject: 'reviewer',
        },
        kind: 'human',
        authenticationMethod: 'test',
        audience: ['signal-role-live-gateway'],
        roles: ['reviewer'],
      }, 'sha256:signal-role-live-context');
      const store = createPostgresApplicationSignalStore({ sql });
      try {
        const workflow = createApplicationWorkflowSignalRuntime({
          store,
          invocation: {
            id: `signal-role-live-${process.pid}-${Date.now()}`,
            revision: 'revision-1',
          },
          occurrence: () => 'review:1',
          authorizeIssue: () => ({ id: 'receipt:issue' }),
          wait: async () => undefined,
        });
        const decision = await workflow.emit(ReviewDecision, {
          input: { postId: 'post-role-live' },
          expiresIn: '24h',
          target: { postId: 'post-role-live' },
          authorize: [{ role: 'reviewer' }],
        });
        const gateway = createApplicationSignalGateway({
          store,
          definitions: [ReviewDecision],
          authenticate: () => ({
            actor: { id: principal.identity.id, roles: ['reviewer'] },
            principal,
          }),
          authorizeRead: () => ({ id: 'receipt:read' }),
          authorizeAction: async ({ signal, action, transaction }) => {
            if (!transaction) {
              throw new Error('Signal action authority must share the signal transaction.');
            }
            const result = await authority.withinTransaction(
              transaction,
              () => authority.authorize({
                principal,
                operationId,
                target: {
                  kind: 'target',
                  model: signal.contract.id,
                  identity: { ...signal.target, signalId: signal.id },
                },
                audience: 'signal-role-live-gateway',
                transport: 'http',
                inputDigest: `sha256:${action}`,
                trustedContextDigest: principal.trustedContextDigest,
                applicationPolicyAllowed: true,
              }),
            );
            return result.allowed ? { id: result.receipt.id } : false;
          },
        });
        const response = await gateway.handle(new Request(
          `http://localhost/__applik8s/v1/signals/${ReviewDecision.id}/${decision.issuance.id}/actions/approve`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              input: { comment: 'Approved through role authority.' },
              idempotencyKey: 'approve-role-live',
            }),
          },
        ));
        expect(response?.status).toBe(200);
        await expect(response?.json()).resolves.toMatchObject({
          status: 'resolved',
          outcome: {
            action: 'approve',
            actor: { id: principal.identity.id },
          },
        });
        const testFacts = (await store.pendingOutbox(1_000)).filter(
          (fact) => fact.signalId === decision.issuance.id,
        );
        await store.acknowledgeOutbox(testFacts.map((fact) => fact.id));
      } finally {
        await store.close();
        await sql.end({ timeout: 1 });
      }
    },
    60_000,
  );

  it.skipIf(!databaseUrl)(
    'survives provider restart with atomic receipts, exact action replay, redaction, and outbox recovery',
    async () => {
      const liveDatabaseUrl = databaseUrl;
      if (!liveDatabaseUrl) {
        throw new Error('Live PostgreSQL signal test requires its database URL.');
      }
      const invocationId = `signal-live-${process.pid}-${Date.now()}`;
      const firstStore = createPostgresApplicationSignalStore({
        databaseUrl: liveDatabaseUrl,
      });
      let issuedWithTransaction = false;
      const workflow = createApplicationWorkflowSignalRuntime({
        store: firstStore,
        invocation: { id: invocationId, revision: 'revision-1' },
        occurrence: () => 'review:1',
        now: () => new Date('2026-08-02T12:00:00.000Z'),
        authorizeIssue: (_request, context) => {
          issuedWithTransaction = context.transaction !== undefined;
          return { id: `provider:issue:${invocationId}` };
        },
        wait: async () => undefined,
      });
      const decision = await workflow.emit(ReviewDecision, {
        input: { postId: 'post-live' },
        expiresIn: '24h',
        target: { postId: 'post-live' },
        authorize: [{ role: 'reviewer' }],
      });
      expect(issuedWithTransaction).toBe(true);
      expect(decision.issueReceipt).toEqual({
        id: `provider:issue:${invocationId}`,
      });
      const pendingAfterIssue = await firstStore.pendingOutbox(1_000);
      await firstStore.acknowledgeOutbox(
        pendingAfterIssue
          .filter((fact) => fact.signalId !== decision.issuance.id)
          .map((fact) => fact.id),
      );
      expect(
        pendingAfterIssue.filter(
          (fact) => fact.signalId === decision.issuance.id,
        ),
      ).toEqual([
        expect.objectContaining({
          kind: 'issued',
          signalId: decision.issuance.id,
        }),
      ]);
      await firstStore.close();

      const secondStore = createPostgresApplicationSignalStore({
        databaseUrl: liveDatabaseUrl,
      });
      let actionAuthorizations = 0;
      let resolvedWithTransaction = false;
      const gateway = createApplicationSignalGateway({
        store: secondStore,
        definitions: [ReviewDecision],
        authenticate: async () => ({
          actor: { id: 'reviewer-live', roles: ['reviewer'] },
          principal: { id: 'reviewer-live', roles: ['reviewer'] },
        }),
        authorizeRead: async () => ({ id: 'provider:read:reviewer-live' }),
        authorizeAction: async ({ action, transaction }) => {
          actionAuthorizations += 1;
          resolvedWithTransaction = transaction !== undefined;
          return { id: `provider:${action}:reviewer-live` };
        },
      });
      const fetchThroughGateway = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) =>
        await gateway.handle(
          new Request(new URL(String(input), 'http://localhost'), init),
        ) ?? new Response(null, { status: 404 });
      const signal = hydrateApplicationSignalClient(
        ReviewDecision,
        decision,
        { fetch: fetchThroughGateway },
      );
      const resolved = await signal.approve(
        { comment: 'Ship the provider-backed result' },
        { idempotencyKey: 'approve-live' },
      );
      expect(resolvedWithTransaction).toBe(true);
      expect(resolved).toMatchObject({
        status: 'resolved',
        outcome: {
          action: 'approve',
          input: { comment: 'Ship the provider-backed result' },
          actor: { id: 'reviewer-live' },
          receipt: { id: 'provider:approve:reviewer-live' },
        },
      });
      await secondStore.close();

      const recoveredStore = createPostgresApplicationSignalStore({
        databaseUrl: liveDatabaseUrl,
      });
      const recoveredGateway = createApplicationSignalGateway({
        store: recoveredStore,
        definitions: [ReviewDecision],
        authenticate: async () => ({
          actor: { id: 'reviewer-live', roles: ['reviewer'] },
          principal: { id: 'reviewer-live', roles: ['reviewer'] },
        }),
        authorizeRead: async () => ({ id: 'provider:read:reviewer-live' }),
        authorizeAction: async ({ action }) => {
          actionAuthorizations += 1;
          return { id: `provider:${action}:reviewer-live` };
        },
      });
      const recoveredFetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) =>
        await recoveredGateway.handle(
          new Request(new URL(String(input), 'http://localhost'), init),
        ) ?? new Response(null, { status: 404 });
      const recoveredSignal = hydrateApplicationSignalClient(
        ReviewDecision,
        decision,
        { fetch: recoveredFetch },
      );
      await expect(
        recoveredSignal.approve(
          { comment: 'Ship the provider-backed result' },
          { idempotencyKey: 'approve-live' },
        ),
      ).resolves.toEqual(resolved);
      expect(actionAuthorizations).toBe(1);
      await expect(
        recoveredSignal.reject(
          { reason: 'must remain private' },
          { idempotencyKey: 'reject-live' },
        ),
      ).resolves.toEqual({
        status: 'alreadyResolved',
        outcome: {
          status: 'resolved',
          decidedAt: expect.any(String),
        },
      });
      expect(actionAuthorizations).toBe(1);

      const published: string[] = [];
      const relay = new AbortController();
      await runApplicationSignalOutboxRelay({
        store: recoveredStore,
        signal: relay.signal,
        idleMs: 1,
        now: () => new Date('2026-08-02T12:01:00.000Z'),
        publish: async (fact) => {
          published.push(`${fact.kind}:${fact.signalId}`);
          if (published.length === 2) relay.abort();
        },
      });
      expect(published).toEqual([
        `issued:${decision.issuance.id}`,
        `resolved:${decision.issuance.id}`,
      ]);
      expect(
        (await recoveredStore.pendingOutbox(10)).filter(
          (fact) => fact.signalId === decision.issuance.id,
        ),
      ).toEqual([]);
      expect(await recoveredStore.read(decision.issuance.id)).toMatchObject({
        terminal: {
          status: 'resolved',
          action: 'approve',
          actor: { id: 'reviewer-live' },
          receipt: { id: 'provider:approve:reviewer-live' },
        },
      });
      await recoveredStore.close();

      const inspection = postgres(liveDatabaseUrl, {
        max: 1,
        prepare: false,
        onnotice: () => undefined,
      });
      try {
        const [counts] = await inspection.unsafe(
          `SELECT
             (SELECT count(*)::int FROM applik8s_signals
              WHERE id = $1) AS signals,
             (SELECT count(*)::int FROM applik8s_signal_resolutions
              WHERE signal_id = $1) AS resolutions,
             (SELECT count(*)::int FROM applik8s_signal_outbox
              WHERE signal_id = $1 AND published_at IS NULL) AS pending_outbox,
             (SELECT jsonb_typeof(input) FROM applik8s_signals
              WHERE id = $1) AS input_type,
             (SELECT jsonb_typeof(target) FROM applik8s_signals
              WHERE id = $1) AS target_type,
             (SELECT jsonb_typeof(access) FROM applik8s_signals
              WHERE id = $1) AS access_type,
             (SELECT jsonb_typeof(payload) FROM applik8s_signal_outbox
              WHERE signal_id = $1 AND kind = 'issued') AS issuance_payload_type`,
          [decision.issuance.id],
        );
        expect(counts).toMatchObject({
          signals: 1,
          resolutions: 1,
          pending_outbox: 0,
          input_type: 'object',
          target_type: 'object',
          access_type: 'object',
          issuance_payload_type: 'object',
        });
      } finally {
        await inspection.end({ timeout: 1 });
      }
    },
    60_000,
  );
});
