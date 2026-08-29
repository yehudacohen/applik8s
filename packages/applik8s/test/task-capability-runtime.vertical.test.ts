import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationTaskCapabilityBindings,
  defineApplicationTaskCapabilityFactory,
} from '../src/task-capability-runtime.js';

describe('task capability factories', () => {
  it('binds one declared capability per invocation and denies undeclared access', () => {
    const bind = vi.fn((context) => ({ invocationId: context.invocation.invocationId }));
    const capabilities = createApplicationTaskCapabilityBindings(
      { AI: defineApplicationTaskCapabilityFactory(bind) },
      ['AI'],
      {
        task: {
          contractId: 'research',
          contractVersion: 'v1',
          handlerId: 'taskHandler.research',
          workerId: 'workflowWorker.research',
        },
        invocation: {
          invocationId: 'invocation-1',
          idempotencyKey: 'input-1',
          attempt: 1,
          signal: new AbortController().signal,
          deadline: '2026-08-29T12:00:00.000Z',
          cancellationRevision: 'active:invocation-1',
        },
        authority: { kind: 'none' },
      },
      'research.v1',
    );
    expect(capabilities.use('AI')).toEqual({ invocationId: 'invocation-1' });
    expect(capabilities.use('AI')).toEqual({ invocationId: 'invocation-1' });
    expect(bind).toHaveBeenCalledTimes(1);
    expect(() => capabilities.use('Secret')).toThrow('undeclared capability');
  });
});
