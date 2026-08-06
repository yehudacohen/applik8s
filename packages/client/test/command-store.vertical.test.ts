// typecast-file-boundary: protocol doubles construct narrowed command states to exercise client transitions.
import { ApplicationCommandClient, ApplicationCommandFailedError, ApplicationCommandRejectedError, createApplicationClientId, createHttpApplicationCommandTransport, type ApplicationCommandProgress, type ApplicationCommandTransport } from '@applik8s/client';
import { describe, expect, it, vi } from 'vitest';

describe('browser-safe durable command client', () => {
  it('generates a UUID from getRandomValues when randomUUID is unavailable on local HTTP', () => {
    const id = createApplicationClientId({
      getRandomValues(value) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return value;
      },
    });
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

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

  it('resolves execute only after the durable result succeeds', async () => {
    const transport: ApplicationCommandTransport = {
      async submit(command, _input, options) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: options.commandId, correlationId: options.commandId, transport: 'acknowledged', durableResult: 'pending', progressCursor: 'cursor', workflow: 'notStarted', reconciliation: 'notObserved' };
      },
      async progress(command) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: 'execute-1', correlationId: 'execute-1', transport: 'acknowledged', durableResult: 'succeeded', output: { identity: 'entry-1' }, workflow: 'notStarted', reconciliation: 'notObserved' };
      },
    };
    const client = new ApplicationCommandClient(transport, { id: () => 'execute-1', poll: { initialMs: 10, maxMs: 10 } });
    await expect(client.execute('GuestBookEntry.create', { message: 'hello' })).resolves.toEqual({ identity: 'entry-1' });
  });

  it('rejects execute with the durable domain rejection', async () => {
    const transport: ApplicationCommandTransport = {
      async submit(command, _input, options) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: options.commandId, correlationId: options.commandId, transport: 'acknowledged', durableResult: 'pending', progressCursor: 'rejected', workflow: 'notStarted', reconciliation: 'notObserved' };
      },
      async progress(command) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: 'rejected-1', correlationId: 'rejected-1', transport: 'acknowledged', durableResult: 'rejected', rejection: { name: 'forbidden', payload: { reason: 'reader' } }, workflow: 'notStarted', reconciliation: 'notObserved' };
      },
    };
    const client = new ApplicationCommandClient(transport, { id: () => 'rejected-1' });
    await expect(client.execute('GuestBookEntry.create', { message: 'hello' })).rejects.toBeInstanceOf(ApplicationCommandRejectedError);
  });

  it('rejects execute with a distinct redacted terminal processing failure', async () => {
    const transport: ApplicationCommandTransport = {
      async submit(command, _input, options) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: options.commandId, correlationId: options.commandId, transport: 'acknowledged', durableResult: 'pending', progressCursor: 'failed', workflow: 'notStarted', reconciliation: 'notObserved' };
      },
      async progress(command) {
        return { protocol: 'applik8s.command/v1alpha1', command, commandId: 'failed-1', correlationId: 'failed-1', transport: 'acknowledged', durableResult: 'failed', failure: { code: 'processing_failed', attempts: 5 }, workflow: 'notStarted', reconciliation: 'failed' };
      },
    };
    const client = new ApplicationCommandClient(transport, { id: () => 'failed-1' });
    const execution = client.execute('GuestBookEntry.create', { message: 'hello' });
    await expect(execution).rejects.toBeInstanceOf(ApplicationCommandFailedError);
    await expect(execution).rejects.toMatchObject({
      name: 'ApplicationCommandFailedError',
      code: 'APPLIK8S_COMMAND_FAILED',
      failure: { code: 'processing_failed', attempts: 5 },
    });
  });
});

function neverProgress(): ApplicationCommandProgress { return { protocol: 'applik8s.command/v1alpha1', command: 'cards.rename.v1', commandId: 'command-1', correlationId: 'command-1', transport: 'acknowledged', durableResult: 'pending', progressCursor: 'opaque' }; }
