// typecast-file-boundary: HTTP fixtures deliberately cross the erased signal
// gateway boundary and inspect persisted canonical state after validation.
import {
  createApplicationSignalGateway,
  createApplicationWorkflowSignalRuntime,
  createMemoryApplicationSignalStore,
  type ApplicationSignalDefinition,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { describe, expect, it } from 'vitest';

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
    approve: type({ 'comment?': 'string' }).onUndeclaredKey('reject'),
    reject: type({ reason: 'string' }),
  },
};

describe('v0.7 exact-instance signal gateway', () => {
  it('derives the actor at the server boundary and never trusts client identity', async () => {
    const { store, issuanceId } = await issuedSignal();
    const gateway = createApplicationSignalGateway({
      store,
      definitions: [ReviewDecision],
      authenticate(request) {
        const id = request.headers.get('x-test-principal');
        if (!id) throw new Error('unauthenticated');
        return {
          actor: { id, roles: ['reviewer'] },
          principal: { id },
        };
      },
      authorizeRead: ({ identity }) => ({
        id: `read:${identity.actor.id}`,
      }),
      authorizeAction: ({ identity, action }) => ({
        id: `${action}:${identity.actor.id}`,
      }),
    });

    const read = await gateway.handle(
      new Request(signalUrl(issuanceId), {
        headers: { 'x-test-principal': 'reviewer-1' },
      }),
    );
    expect(read?.status).toBe(200);
    expect(await read?.json()).toMatchObject({
      id: issuanceId,
      input: { postId: 'post-1' },
      signal: { issuance: { id: issuanceId } },
    });

    const spoofed = await gateway.handle(
      actionRequest(
        issuanceId,
        'approve',
        { comment: 'ship it', approvedBy: 'administrator' },
        'reviewer-1',
      ),
    );
    expect(spoofed?.status).toBe(400);
    expect(await spoofed?.json()).toEqual({ error: 'invalid_input' });

    const approved = await gateway.handle(
      actionRequest(
        issuanceId,
        'approve',
        { comment: 'ship it' },
        'reviewer-1',
      ),
    );
    expect(approved?.status).toBe(200);
    const result = await approved?.json();
    expect(result).toMatchObject({
      status: 'resolved',
      outcome: {
        action: 'approve',
        input: { comment: 'ship it' },
        actor: { id: 'reviewer-1' },
        receipt: { id: 'approve:reviewer-1' },
      },
    });
    expect((await store.read(issuanceId))?.terminal).toMatchObject({
      action: 'approve',
      actor: { id: 'reviewer-1' },
    });
  });

  it('fails closed for unauthenticated reads and redacts the winning decision from losing actions', async () => {
    const { store, issuanceId } = await issuedSignal();
    const gateway = createApplicationSignalGateway({
      store,
      definitions: [ReviewDecision],
      authenticate(request) {
        const id = request.headers.get('x-test-principal');
        if (!id) throw new Error('unauthenticated');
        return { actor: { id }, principal: { id } };
      },
      authorizeRead: () => ({ id: 'read-receipt' }),
      authorizeAction: ({ identity, action }) => ({
        id: `${action}:${identity.actor.id}`,
      }),
    });

    const anonymous = await gateway.handle(new Request(signalUrl(issuanceId)));
    expect(anonymous?.status).toBe(401);
    expect(await anonymous?.json()).toEqual({ error: 'unauthenticated' });

    const approved = await gateway.handle(
      actionRequest(
        issuanceId,
        'approve',
        { comment: 'private approval context' },
        'reviewer-1',
      ),
    );
    expect(approved?.status).toBe(200);

    const losing = await gateway.handle(
      actionRequest(
        issuanceId,
        'reject',
        { reason: 'private rejection context' },
        'reviewer-2',
      ),
    );
    expect(losing?.status).toBe(200);
    const payload = await losing?.json();
    expect(payload).toMatchObject({
      status: 'alreadyResolved',
      outcome: { status: 'resolved' },
    });
    expect(JSON.stringify(payload)).not.toContain('private approval context');
    expect(JSON.stringify(payload)).not.toContain('reviewer-1');
  });

  it('fails closed before resolution when action authority is absent', async () => {
    const { store, issuanceId } = await issuedSignal();
    const gateway = createApplicationSignalGateway({
      store,
      definitions: [ReviewDecision],
      authenticate: () => ({
        actor: { id: 'unprivileged-user' },
        principal: { id: 'unprivileged-user' },
      }),
      authorizeRead: () => ({ id: 'read-receipt' }),
      authorizeAction: () => false,
    });

    const denied = await gateway.handle(
      actionRequest(
        issuanceId,
        'approve',
        { comment: 'must not commit' },
        'unprivileged-user',
      ),
    );
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: 'forbidden' });
    expect((await store.read(issuanceId))?.terminal).toBeUndefined();
  });
});

async function issuedSignal() {
  const store = createMemoryApplicationSignalStore();
  const runtime = createApplicationWorkflowSignalRuntime({
    store,
    invocation: { id: 'run-1', revision: 'revision-1' },
    occurrence: () => 'review-call:1',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    authorizeIssue: () => ({ id: 'issue-receipt' }),
    wait: async () => undefined,
  });
  const decision = await runtime.emit(ReviewDecision, {
    input: { postId: 'post-1' },
    expiresIn: '365d',
    target: { postId: 'post-1' },
    authorize: [{ role: 'reviewer' }],
  });
  return { store, issuanceId: decision.issuance.id };
}

function signalUrl(signalId: string): string {
  return `https://application.test/__applik8s/v1/signals/${ReviewDecision.id}/${signalId}`;
}

function actionRequest(
  signalId: string,
  action: string,
  input: object,
  principal = 'reviewer-1',
): Request {
  return new Request(`${signalUrl(signalId)}/actions/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-principal': principal,
    },
    body: JSON.stringify({ input }),
  });
}
