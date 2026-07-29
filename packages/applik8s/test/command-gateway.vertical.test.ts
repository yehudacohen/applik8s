// typecast-file-boundary: test doubles model untyped PostgreSQL and protocol boundaries exercised by runtime validation.
import { createApplicationCommandGateway } from '@applik8s/applik8s';
import { describe, expect, it, vi } from 'vitest';
import { applicationCommandScope } from '../src/command-runtime-contract.js';
import { applicationCommandPrincipal, applicationCommandTrustedContext } from '../src/command-principal.js';

describe('authenticated command gateway', () => {
  it('includes admitted context in durable idempotency scope', () => {
    const first = applicationCommandScope('binding', 'Card', 'card-1', 'once', 'a'.repeat(64));
    const second = applicationCommandScope('binding', 'Card', 'card-1', 'once', 'b'.repeat(64));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^sha256:/);
  });

  it('reports redacted internal failures while preserving the public error boundary', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, databaseUrl: 'postgres://unused', key: (input) => String(Reflect.get(input, 'id')) }],
      authenticate: async () => ({ principal: { id: 'principal-1' }, trustedContext: { tenant: 'tenant-1' }, authorizationVersion: 'policy-v1' }),
      authorize: async () => true,
      cursorSecret: '01234567890123456789012345678901',
      eventLogPublisher: {
        publish: async () => { throw new Error('upstream details'); },
        drain: async () => undefined,
      },
    });
    try {
      const response = await gateway.handle(new Request('http://gateway/commands/cards.rename.v1/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: 'card-1' }, commandId: 'command-1', idempotencyKey: 'idempotency-1' }),
      }));
      expect(response?.status).toBe(500);
      await expect(response?.json()).resolves.toEqual({ error: 'internal_error' });
      expect(error).toHaveBeenCalledWith(JSON.stringify({
        event: 'applik8s-command-gateway-error',
        command: 'cards.rename.v1',
        operation: 'submit',
        error: { name: 'Error', message: 'upstream details' },
      }));
    } finally {
      error.mockRestore();
      await gateway.close();
    }
  });

  it('separates transport acknowledgement from durable result and scopes opaque progress to admission', async () => {
    const publish = vi.fn(async () => ({ stream: 'APPLIK8S_EVENTS', sequence: 1, duplicate: false, subject: 'applik8s.commands.cards.rename.v1.card-1', messageId: 'command-1' }));
    const unsafe = vi.fn(async () => [{ output: { changed: true }, error: null, model_revision: 'revision-2' }]);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }, databaseUrl: 'postgres://unused', sql: { unsafe } as never, key: (input, context) => {
        expect(context).toMatchObject({ principal: { id: 'user-1' }, authorizationVersion: 'membership-2', trustedContext: { organizationId: 'organization-1' } });
        return Reflect.get(input, 'cardId');
      } }],
      authenticate: async () => ({ principal: { id: 'user-1', claims: { role: 'author' } }, trustedContext: { organizationId: 'organization-1' }, authorizationVersion: 'membership-2' }),
      authorize: async ({ principal }) => principal.id === 'user-1',
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      eventLogPublisher: { publish, async drain() {} },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    });
    const submissionResponse = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/submit', { method: 'POST', body: JSON.stringify({ input: { cardId: 'card-1' }, commandId: 'command-1', idempotencyKey: 'rename-once' }) }));
    expect(submissionResponse?.status).toBe(202);
    const submission = await submissionResponse?.json() as { readonly progressCursor: string; readonly durableResult: string };
    expect(submission.durableResult).toBe('pending');
    expect(submission.progressCursor).not.toContain('organization-1');
    const cursorBody = JSON.parse(Buffer.from(submission.progressCursor.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(cursorBody).toMatchObject({ version: 2, command: 'cards.rename.v1', durableScope: expect.stringMatching(/^sha256:/) });
    expect(cursorBody).not.toHaveProperty('principalId');
    expect(cursorBody).not.toHaveProperty('authorizationVersion');
    expect(cursorBody).not.toHaveProperty('contextDigest');
    expect(cursorBody).not.toHaveProperty('targetKey');
    expect(JSON.stringify(cursorBody)).not.toContain('user-1');
    expect(JSON.stringify(cursorBody)).not.toContain('membership-2');
    expect(JSON.stringify(cursorBody)).not.toContain('organization-1');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      id: 'command-1',
      routing: { binding: 'Card-cards.rename.v1', targetKey: 'card-1', idempotencyKey: 'rename-once' },
      trustedContext: expect.objectContaining({
        values: expect.objectContaining({ organizationId: 'organization-1' }),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        changeScopes: expect.objectContaining({
          global: expect.stringMatching(/^[a-f0-9]{64}$/),
          'context:organizationId': expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    }), 'commands');
    const published = (publish.mock.calls as unknown as readonly (readonly [unknown])[])[0]?.[0] as unknown as {
      readonly trustedContext?: {
        readonly values: Readonly<Record<string, never>>;
        readonly changeScopes?: Readonly<Record<string, string>>;
      };
    };
    expect(applicationCommandPrincipal(published.trustedContext)).toEqual({ id: 'user-1', claims: { role: 'author' }, authorizationVersion: 'membership-2' });
    expect(applicationCommandTrustedContext(published.trustedContext)).toEqual({ organizationId: 'organization-1' });
    expect(JSON.stringify(published.trustedContext?.changeScopes)).not.toContain('organization-1');
    expect(JSON.stringify(published.trustedContext?.changeScopes)).not.toContain('user-1');

    const progressResponse = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor: submission.progressCursor }) }));
    await expect(progressResponse?.json()).resolves.toMatchObject({ durableResult: 'succeeded', output: { changed: true }, modelRevision: 'revision-2', reconciliation: 'progressing' });
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('applik8s_command_results'), [expect.stringMatching(/^sha256:/)]);
    await gateway.close();
  });

  it('ends progress polling with a redacted terminal processing failure instead of a domain rejection', async () => {
    const unsafe = vi.fn(async () => [{
      output: null,
      error: { name: 'internalFailure', payload: { code: 'processing_failed', attempts: 5, detail: 'must-not-leak' } },
      model_revision: 'terminal-revision',
    }]);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object' }, databaseUrl: 'postgres://unused', sql: { unsafe } as never, key: () => 'card-1' }],
      authenticate: async () => ({ principal: { id: 'user-1' }, trustedContext: {}, authorizationVersion: 'membership-1' }),
      authorize: async () => true,
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      eventLogPublisher: { async publish() { return { stream: 'events', sequence: 1, duplicate: false, subject: 'command', messageId: 'terminal-1' }; }, async drain() {} },
    });
    const submitted = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/submit', { method: 'POST', body: JSON.stringify({ input: {}, commandId: 'terminal-1', idempotencyKey: 'terminal-1' }) }));
    const cursor = Reflect.get(await submitted?.json(), 'progressCursor');
    const response = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor }) }));
    const body = await response?.json();
    expect(body).toEqual(expect.objectContaining({
      durableResult: 'failed',
      failure: { code: 'processing_failed', attempts: 5 },
      reconciliation: 'failed',
      modelRevision: 'terminal-revision',
    }));
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    await gateway.close();
  });
});
