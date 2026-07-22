// typecast-file-boundary: Task-operation tests intentionally construct protocol envelopes and provider fakes around runtime validation boundaries.
import { describe, expect, it, vi } from 'vitest';
import type { Sql } from 'postgres';
import type { JsonValue } from '@applik8s/core';
import { applicationCommandPrincipal } from '../src/command-principal.js';
import {
  ApplicationTaskOperationFailedError,
  ApplicationTaskOperationRejectedError,
  createApplicationTaskOperationRuntime,
} from '../src/task-operation-runtime.js';

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
      { id: '', authorizationVersion: '' },
      { invocationId: '', idempotencyKey: '', signal: new AbortController().signal },
    )).toEqual({});
    await runtime.close();
  });

  it('submits only declared commands with a fixed service principal and observes the canonical durable result', async () => {
    let published: Record<string, unknown> | undefined;
    const verify = vi.fn(async () => undefined);
    const drain = vi.fn(async () => undefined);
    const sql = { unsafe: vi.fn(async () => published ? [{ output: { identity: 'post-1', accepted: true }, error: null }] : []) } as unknown as Sql;
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
      { id: 'bot-1', claims: { role: 'automation-worker' }, authorizationVersion: 'policy-v1', trustedContext: { automationId: 'a-1' } },
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );

    await expect(operations.publish?.({ id: 'post-1', body: 'hello' })).resolves.toEqual({ identity: 'post-1', accepted: true });
    expect(verify).toHaveBeenCalledOnce();
    const principal = applicationCommandPrincipal(Reflect.get(published ?? {}, 'trustedContext') as {
      readonly values: Readonly<Record<string, JsonValue>>;
    });
    expect(principal).toMatchObject({ id: 'bot-1', claims: { role: 'automation-worker' }, authorizationVersion: 'policy-v1' });
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
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql: { unsafe: vi.fn() } as unknown as Sql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish() { throw new Error('must not publish'); }, async drain() {} },
    });
    expect(() => runtime.bind(
      { remove: 'Post.delete.v1' },
      { id: 'bot-1', authorizationVersion: 'policy-v1' },
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    )).toThrow(/undeclared command/);
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      { id: 'bot-1', authorizationVersion: 'policy-v1' },
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );
    await expect(operations.publish?.({ id: 'post-1' })).rejects.toThrow(/input validation failed/);
    await runtime.close();
  });

  it('surfaces durable domain rejection without retrying it as an unknown transport failure', async () => {
    const sql = { unsafe: vi.fn(async () => [{ output: null, error: { name: 'quotaExceeded', payload: { remaining: 0 } } }]) } as unknown as Sql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish(envelope) { return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id }; }, async drain() {} },
    });
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      { id: 'bot-1', authorizationVersion: 'policy-v1' },
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
    const sql = { unsafe: vi.fn(async () => [{ output: null, error: { name: 'internalFailure', payload: { code: 'processing_failed', attempts: 5, privateDetail: 'hidden' } } }]) } as unknown as Sql;
    const runtime = createApplicationTaskOperationRuntime({
      commands: [{ id: 'Post.create.v1', bindingId: 'Post.create', model: 'Post', inputSchema, databaseUrl: 'postgres://unused', sql, key: (input) => Reflect.get(input, 'id') }],
      cursorSecret: 'a-stable-secret-containing-at-least-thirty-two-characters',
      eventLogPublisher: { async publish(envelope) { return { stream: 'events', sequence: 1, duplicate: false, subject: 'commands', messageId: envelope.id }; }, async drain() {} },
    });
    const operations = runtime.bind(
      { publish: 'Post.create.v1' },
      { id: 'bot-1', authorizationVersion: 'policy-v1' },
      { invocationId: 'run-1', idempotencyKey: 'run-1', signal: new AbortController().signal },
    );
    const failure = operations.publish?.({ id: 'post-1', body: 'hello' });
    await expect(failure).rejects.toBeInstanceOf(ApplicationTaskOperationFailedError);
    await expect(failure).rejects.toMatchObject({ code: 'APPLIK8S_TASK_OPERATION_FAILED', command: 'Post.create.v1' });
    await expect(failure).rejects.not.toThrow(/hidden/);
    await runtime.close();
  });
});
