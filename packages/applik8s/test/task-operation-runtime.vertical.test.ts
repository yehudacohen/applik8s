// typecast-file-boundary: Task-operation tests intentionally construct protocol envelopes and provider fakes around runtime validation boundaries.

import type { ApplicationAuthorizationReceipt, ApplicationExecutionPrincipal, ApplicationWorkloadAuthorityEnvelope, JsonValue } from '@applik8s/core';
import { describe, expect, it, vi } from 'vitest';
import { applicationCommandPrincipal } from '../src/command-principal.js';
import type { ApplicationPostgresSql } from '../src/postgres-runtime-contract.js';
import {
  type ApplicationTaskOperationAuthorityError,
  ApplicationTaskOperationFailedError,
  ApplicationTaskOperationRejectedError,
  createApplicationTaskOperationRuntime,
} from '../src/task-operation-runtime.js';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';

const inputSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, body: { type: 'string' } },
  required: ['id', 'body'],
  additionalProperties: false,
} as const;

describe('task operation runtime', () => {
  it('does not require a service principal for a task with no declared operations in a shared worker', async () => {
    const runtime = createApplicationTaskOperationRuntime({
      commands: [],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish() { throw new Error('must not publish'); }, async drain() {} },
    });

    expect(runtime.bind(
      {},
      taskPrincipal('unused'),
      { invocationId: '', idempotencyKey: '', signal: new AbortController().signal },
    )).toEqual({});
    await runtime.close();
  });

  it('submits only declared commands with a fixed service principal and observes the canonical durable result', async () => {
    let published: Record<string, unknown> | undefined;
    const verify = vi.fn(async () => undefined);
    const drain = vi.fn(async () => undefined);
    const sql = { unsafe: vi.fn(async () => published ? [{ output: { identity: 'post-1', accepted: true }, error: null }] : []) } as unknown as ApplicationPostgresSql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{
        id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema,
        databaseUrl: 'postgres://unused', sql, key: (input) => Reflect.get(input, 'id'),
      }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: {
        verify,
        async publish(envelope) {
          published = envelope as unknown as Record<string, unknown>;
          return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id };
        },
        drain,
      },
      resultTimeoutMs: 2_000,
    });
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      taskPrincipal('bot-1', 'policy-v1', { automationId: 'a-1' }),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );

    await expect(operations.publish?.({ id: 'post-1', body: 'hello' })).resolves.toEqual({ identity: 'post-1', accepted: true });
    expect(verify).toHaveBeenCalledOnce();
    const principal = applicationCommandPrincipal(Reflect.get(published ?? {}, 'trustedContext') as {
      readonly values: Readonly<Record<string, JsonValue>>;
    });
    expect(principal).toMatchObject({ id: 'bot-1', authorityRevision: 'policy-v1' });
    expect(Reflect.get(Reflect.get(published ?? {}, 'trustedContext') as object, 'changeScopes')).toMatchObject({
      global: expect.stringMatching(/^[a-f0-9]{64}$/),
      'context:automationId': expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(published)).not.toContain('a-stable-secret-containing-at-least-thirty-two-characters');
    await runtime.close();
    expect(drain).toHaveBeenCalledOnce();
  });

  it('fails closed for undeclared aliases and invalid command input', async () => {
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql: { unsafe: vi.fn() } as unknown as ApplicationPostgresSql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish() { throw new Error('must not publish'); }, async drain() {} },
    });
    expect(() => runtime.bind(
      { remove: 'Post.delete.v1' },
      taskPrincipal('bot-1'),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    )).toThrow(/undeclared command/);
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      taskPrincipal('bot-1'),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );
    await expect(operations.publish?.({ id: 'post-1' })).rejects.toThrow(/input validation failed/);
    await runtime.close();
  });

  it('projects exact execution-bound fields and rejects every caller override before merge', async () => {
    let published: Record<string, unknown> | undefined;
    const sql = {
      unsafe: vi.fn(async () => published
        ? [{ output: { identity: 'post-1', accepted: true }, error: null }]
        : []),
    } as unknown as ApplicationPostgresSql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{
        id: 'Post.create.v1',
        bindingId: 'Post.create',
        model: 'Post',
        inputSchema,
        databaseUrl: 'postgres://unused',
        sql,
        key: (input) => Reflect.get(input, 'id'),
      }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: {
        async publish(envelope) {
          published = envelope as unknown as Record<string, unknown>;
          return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id };
        },
        async drain() {},
      },
    });
    const operations = runtime.bind(
      {
        publish: {
          commandId: 'Post.create.v1',
          operationId: 'applik8s://models/Post/operations/create',
          boundKeys: ['id'],
          project: (task) => ({ id: String(Reflect.get(task, 'postId')) }),
        },
      },
      taskPrincipal('bot-1'),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
      { postId: 'post-1' },
    );

    await expect(operations.publish?.({ id: 'attacker', body: 'hello' })).rejects.toMatchObject({
      code: 'AUTHORITY_BOUND_FIELD_OVERRIDE',
      operationId: 'applik8s://models/Post/operations/create',
    } satisfies Partial<ApplicationTaskOperationAuthorityError>);
    await expect(operations.publish?.({ body: 'hello' })).resolves.toEqual({
      identity: 'post-1',
      accepted: true,
    });
    expect(Reflect.get(published ?? {}, 'payload')).toEqual({ id: 'post-1', body: 'hello' });
    await runtime.close();
  });

  it('admits one execution principal and embeds its envelope-bound receipt in the durable command', async () => {
    let published: Record<string, unknown> | undefined;
    const sql = {
      unsafe: vi.fn(async () => published
        ? [{ output: { identity: 'post-1', accepted: true }, error: null }]
        : []),
    } as unknown as ApplicationPostgresSql;
    const workloadIdentity = {
      id: 'identity:chirp:workload:task-handler.publish',
      kind: 'workload' as const,
      issuer: 'applik8s://chirp',
      subject: 'task-handler.publish',
    };
    const envelope: ApplicationWorkloadAuthorityEnvelope = {
      apiVersion: 'applik8s.workloadAuthority/v1alpha1',
      id: 'workload-authority:publish',
      workloadIdentity,
      operationId: 'applik8s://models/Post/operations/create',
      catalogRevision: 'catalog-1',
      restrictions: { target: { kind: 'all' }, predicates: [] },
      inputSchemaDigest: 'sha256:input',
      audiences: [workloadIdentity.id],
      transports: ['event'],
      delegation: 'forbidden',
      impersonation: 'forbidden',
    };
    const executionPrincipal: ApplicationExecutionPrincipal = {
      id: 'principal:chirp:execution:task:run-1:1',
      identity: workloadIdentity,
      kind: 'execution',
      executionKind: 'task',
      executionId: 'run-1',
      attempt: 1,
      workloadIdentity,
      causalGrantIds: [],
      authenticationMethod: 'workload-identity',
      audience: [workloadIdentity.id],
      trustedContextDigest: 'sha256:context',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-29T00:00:00.000Z',
      deadline: '2099-07-29T00:00:00.000Z',
      expiresAt: '2099-07-29T00:00:00.000Z',
      cancellationRevision: 'active:run-1',
      bindings: [],
      effectiveAuthority: [],
    };
    const admitExecution = vi.fn(async () => executionPrincipal);
    const authorizeExecution = vi.fn(async (request): Promise<{ readonly allowed: true; readonly receipt: ApplicationAuthorizationReceipt }> => ({
      allowed: true,
      receipt: {
        apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
        id: 'receipt-1',
        application: 'chirp',
        operationId: envelope.operationId,
        operationVersion: 'v1',
        catalogRevision: 'catalog-1',
        authorityRevision: 'authority-1',
        principal: request.principal,
        trustedContextDigest: request.trustedContextDigest,
        matchedPermissionIds: [],
        matchedGrantIds: [],
        workloadEnvelopeId: envelope.id,
        executionPrincipalId: request.principal.id,
        inputDigest: request.inputDigest,
        target: request.target,
        scopeEvidence: [],
        audience: workloadIdentity.id,
        transport: 'event',
        admittedAt: '2026-07-29T00:00:00.000Z',
      },
    }));
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{
        id: 'Post.create.v1',
        bindingId: 'Post.create',
        model: 'Post',
        inputSchema,
        databaseUrl: 'postgres://unused',
        sql,
        key: (input) => Reflect.get(input, 'id'),
      }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: {
        async publish(command) {
          published = command as unknown as Record<string, unknown>;
          return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: command.id };
        },
        async drain() {},
      },
      admitExecution,
      authorizeExecution,
    });
    const operations = runtime.bind(
      {
        publish: {
          commandId: 'Post.create.v1',
          operationId: envelope.operationId,
          boundKeys: [],
          envelope,
        },
      },
      taskPrincipal('bot-1'),
      {
        invocationId: 'run-1',
        idempotencyKey: 'run-1',
        signal: new AbortController().signal,
        deadline: executionPrincipal.deadline,
        cancellationRevision: executionPrincipal.cancellationRevision,
      },
    );

    await expect(operations.publish?.({ id: 'post-1', body: 'hello' })).resolves.toEqual({
      identity: 'post-1',
      accepted: true,
    });
    expect(admitExecution).toHaveBeenCalledOnce();
    expect(authorizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      principal: executionPrincipal,
      envelope,
      cancellationRevision: 'active:run-1',
    }));
    expect(Reflect.get(published ?? {}, 'authorizationReceipt')).toMatchObject({
      id: 'receipt-1',
      workloadEnvelopeId: envelope.id,
      executionPrincipalId: executionPrincipal.id,
    });
    await runtime.close();
  });

  it('surfaces durable domain rejection without retrying it as an unknown transport failure', async () => {
    const sql = { unsafe: vi.fn(async () => [{ output: null, error: { name: 'quotaExceeded', payload: { remaining: 0 } } }]) } as unknown as ApplicationPostgresSql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish(envelope) { return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id }; }, async drain() {} },
    });
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      taskPrincipal('bot-1'),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );
    const rejection = operations.publish?.({ id: 'post-1', body: 'hello' });
    await expect(rejection).rejects.toBeInstanceOf(ApplicationTaskOperationRejectedError);
    await expect(rejection).rejects.toMatchObject({
      code: 'APPLIK8S_TASK_OPERATION_REJECTED',
      rejection: { name: 'quotaExceeded', payload: { remaining: 0 } },
    });
    await runtime.close();
  });

  it('surfaces exhausted command processing as a distinct redacted task failure', async () => {
    const sql = { unsafe: vi.fn(async () => [{ output: null, error: { name: 'internalFailure', payload: { code: 'processing_failed', attempts: 5, privateDetail: 'hidden' } } }]) } as unknown as ApplicationPostgresSql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish(envelope) { return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id }; }, async drain() {} },
    });
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      taskPrincipal('bot-1'),
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );
    const failure = operations.publish?.({ id: 'post-1', body: 'hello' });
    await expect(failure).rejects.toBeInstanceOf(ApplicationTaskOperationFailedError);
    await expect(failure).rejects.toMatchObject({ code: 'APPLIK8S_TASK_OPERATION_FAILED', command: 'Post.create.v1' });
    await expect(failure).rejects.not.toThrow(/hidden/);
    await runtime.close();
  });
});

function taskPrincipal(
  id: string,
  authorityRevision = 'policy-v1',
  trustedContext: Record<string, JsonValue> = {},
) {
  return {
    ...testApplicationPrincipal(id, { authorityRevision, trustedContext }),
    trustedContext,
  };
}
