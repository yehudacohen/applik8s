// typecast-file-boundary: protocol doubles construct narrowed command states to exercise client transitions.
import { ApplicationCommandClient, createHttpApplicationCommandTransport, type ApplicationCommandProgress, type ApplicationCommandTransport } from '@applik8s/client';
import { describe, expect, it, vi } from 'vitest';

describe('browser-safe durable command client', () => {
  it('keeps transport acknowledgement, durable result, model revision, workflow, and reconciliation independent', async () => {
    let observations = 0;
    const transport: ApplicationCommandTransport = {
      async submit(command, _input, options) { return { protocol: 'applik8s.command/v1alpha1', command, commandId: options.commandId, correlationId: options.commandId, transport: 'acknowledged', durableResult: 'pending', progressCursor: 'opaque', workflow: 'notStarted', reconciliation: 'notObserved' }; },
      async progress(command) {
        observations += 1;
        return observations === 1
          ? { protocol: 'applik8s.command/v1alpha1', command, commandId: 'command-1', correlationId: 'command-1', transport: 'acknowledged', durableResult: 'succeeded', output: { renamed: true }, modelRevision: 'revision-2', workflow: 'notStarted', reconciliation: 'progressing', progressCursor: 'opaque' }
          : neverProgress();
      },
    };
    const client = new ApplicationCommandClient(transport, { id: () => 'command-1', poll: { initialMs: 10, maxMs: 10 } });
    const handle = await client.submit<Record<never, never>, { renamed: boolean }>('cards.rename.v1', {});
    await handle.refresh();
    expect(handle.getSnapshot()).toMatchObject({ phase: 'succeeded', transport: 'acknowledged', durableResult: 'succeeded', output: { renamed: true }, modelRevision: 'revision-2', workflow: 'notStarted', reconciliation: 'progressing' });
    handle.dispose();
  });

  it('preserves unknown outcome after a submission transport failure for deliberate recovery', async () => {
    const client = new ApplicationCommandClient({ async submit() { throw new Error('connection closed after write'); }, async progress() { return neverProgress(); } }, { id: () => 'unknown-command' });
    const handle = await client.submit('cards.rename.v1', {});
    expect(handle.getSnapshot()).toMatchObject({ phase: 'unknown', transport: 'failed', durableResult: 'unknown', commandId: 'unknown-command' });
  });

  it('validates the HTTP command protocol and never treats acknowledgement as success', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ protocol: 'applik8s.command/v1alpha1', command: 'cards.rename.v1', commandId: 'command-1', correlationId: 'command-1', transport: 'acknowledged', durableResult: 'pending', progressCursor: 'opaque' }), { status: 200 }));
    const transport = createHttpApplicationCommandTransport({ baseUrl: 'https://catalog.test', fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(transport.submit('cards.rename.v1', {}, { commandId: 'command-1', idempotencyKey: 'retry-1' })).resolves.toMatchObject({ transport: 'acknowledged', durableResult: 'pending' });
    expect(fetch).toHaveBeenCalledWith('https://catalog.test/commands/cards.rename.v1/submit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ input: {}, commandId: 'command-1', idempotencyKey: 'retry-1' }) }));
  });
});

function neverProgress(): ApplicationCommandProgress { return { protocol: 'applik8s.command/v1alpha1', command: 'cards.rename.v1', commandId: 'command-1', correlationId: 'command-1', transport: 'acknowledged', durableResult: 'pending', progressCursor: 'opaque' }; }
