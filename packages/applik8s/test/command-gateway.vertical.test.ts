// typecast-file-boundary: test doubles model untyped PostgreSQL and protocol boundaries exercised by runtime validation.
import { createApplicationCommandGateway } from '@applik8s/applik8s';
import { describe, expect, it, vi } from 'vitest';

describe('authenticated command gateway', () => {
  it('separates transport acknowledgement from durable result and scopes opaque progress to admission', async () => {
    const publish = vi.fn(async () => ({ stream: 'APPLIK8S_EVENTS', sequence: 1, duplicate: false, subject: 'applik8s.commands.cards.rename.v1.card-1', messageId: 'command-1' }));
    const unsafe = vi.fn(async () => [{ output: { changed: true }, error: null, model_revision: 'revision-2' }]);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }, databaseUrl: 'postgres://unused', sql: { unsafe } as never, key: (input) => Reflect.get(input, 'cardId') }],
      authenticate: async () => ({ principal: { id: 'user-1' }, trustedContext: { organizationId: 'organization-1' }, authorizationVersion: 'membership-2' }),
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
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'command-1', routing: { binding: 'Card-cards.rename.v1', targetKey: 'card-1', idempotencyKey: 'rename-once' }, trustedContext: { values: { organizationId: 'organization-1' }, digest: expect.stringMatching(/^[a-f0-9]{64}$/) } }), 'commands');

    const progressResponse = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor: submission.progressCursor }) }));
    await expect(progressResponse?.json()).resolves.toMatchObject({ durableResult: 'succeeded', output: { changed: true }, modelRevision: 'revision-2', reconciliation: 'progressing' });
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('applik8s_command_results'), [expect.stringMatching(/^sha256:/)]);
    await gateway.close();
  });
});
