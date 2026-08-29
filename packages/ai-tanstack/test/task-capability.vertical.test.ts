// typecast-file-boundary: middleware fixtures exercise the public TanStack structural contract with the smallest valid test doubles.
import { AI } from '@applik8s/ai';
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationTanStackTaskCapability,
  withApplicationTanStackTaskToolExecution,
} from '../src/index.js';

describe('native TanStack task capabilities', () => {
  it('binds admitted execution and validates logical model adapters', () => {
    const signal = new AbortController().signal;
    const adapter = { provider: 'fixture' };
    const capability = createApplicationTanStackTaskCapability({
      persistenceMiddleware: { name: 'persistence' },
      execution: {
        operationId: 'applik8s://tasks/research',
        invocationId: 'invocation-1',
        idempotencyKey: 'input-1',
        attempt: 2,
        signal,
      },
      adapter: () => adapter as never,
    });
    expect(capability.context).toMatchObject({
      operationId: 'applik8s://tasks/research',
      invocationId: 'invocation-1',
      idempotencyKey: 'input-1',
      attempt: 2,
      signal,
      applik8s: { persistenceMiddleware: { name: 'persistence' } },
    });
    expect(capability.adapter(AI.model('fast', {
      capabilities: [AI.chat],
    }))).toBe(adapter);
    expect(() => capability.adapter({ apiVersion: 'wrong', name: '' } as never))
      .toThrow('AI.model');
  });

  it('scopes each native server tool call by provider call identity', async () => {
    const execute = vi.fn(async (input: unknown) => input);
    const run = vi.fn(async (_execution, invoke: () => Promise<unknown>) => invoke());
    const middleware = withApplicationTanStackTaskToolExecution(
      { name: 'persistence' },
      run,
    );
    const tool = { name: 'search', execute };
    const transformed = await middleware.onConfig?.({} as never, {
      messages: [],
      systemPrompts: [],
      tools: [tool as never],
    });
    const scoped = transformed?.tools?.[0];
    await expect(scoped?.execute?.(
      { query: 'evidence' },
      { toolCallId: 'call-1' } as never,
    )).resolves.toEqual({ query: 'evidence' });
    expect(run).toHaveBeenCalledWith(
      { id: 'call-1', name: 'search' },
      expect.any(Function),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
