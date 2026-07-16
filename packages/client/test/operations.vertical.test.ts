// typecast-file-boundary: operation test doubles intentionally erase generic payloads while asserting runtime dispatch and metadata preservation.
import { describe, expect, it } from 'vitest';
import {
  attachApplicationOperations,
  createApplicationMutationOperation,
  createApplicationQueryOperation,
  decorateApplicationMutationOperation,
  getApplicationOperationContract,
  installApplicationMutationHook,
  installApplicationOperationRuntime,
  installApplicationQueryHook,
} from '../src/index.js';

const createContract = {
  apiVersion: 'applik8s.operation/v1alpha1',
  kind: 'applicationOperation',
  id: 'GuestBookEntry.create',
  model: 'GuestBookEntry',
  name: 'create',
  operation: 'create',
  transport: 'command',
} as const;

const publishedContract = {
  apiVersion: 'applik8s.operation/v1alpha1',
  kind: 'applicationOperation',
  id: 'GuestBookEntry.published',
  model: 'GuestBookEntry',
  name: 'published',
  operation: 'query',
  transport: 'query',
} as const;

describe('application operations', () => {
  it('dispatches a browser facade through the active runtime and preserves stable metadata', async () => {
    const restore = installApplicationOperationRuntime({
      async execute(operation, input) {
        return { operation: operation.id, input } as never;
      },
    });
    try {
      const create = createApplicationMutationOperation<{ message: string }, { operation: string; input: { message: string } }>(createContract);
      await expect(create({ message: 'hello' })).resolves.toEqual({
        operation: 'GuestBookEntry.create',
        input: { message: 'hello' },
      });
      expect(getApplicationOperationContract(create)).toEqual(createContract);
    } finally {
      restore();
    }
  });

  it('decorates a native server operation without changing its function identity', async () => {
    const native = async (input: { message: string }) => ({ identity: input.message });
    const decorated = decorateApplicationMutationOperation(native, createContract);
    expect(decorated).toBe(native);
    await expect(decorated({ message: 'hello' })).resolves.toEqual({ identity: 'hello' });
  });

  it('delegates useMutation to the installed React adapter', () => {
    const expected = Object.assign(async () => ({ identity: 'created' }), {
      pending: false,
      paused: false,
      data: undefined,
      error: undefined,
      submittedAt: undefined,
      transport: 'idle' as const,
      durableResult: 'unknown' as const,
      observation: { state: 'notDeclared' as const },
      reset() {},
    });
    const restore = installApplicationMutationHook((operation) => {
      expect(operation.id).toBe('GuestBookEntry.create');
      return expected as never;
    });
    try {
      const create = createApplicationMutationOperation(createContract, async () => ({ identity: 'server' }));
      expect(create.useMutation()).toBe(expected);
    } finally {
      restore();
    }
  });

  it('creates model-native query invocations with preload and React adapter semantics', async () => {
    const restoreRuntime = installApplicationOperationRuntime({
      async execute() {
        throw new Error('query operations do not use command execution');
      },
      async snapshotQuery(operation, input) {
        return {
          kind: 'snapshot',
          protocol: 'applik8s.query/v1alpha1',
          query: operation.id,
          inputKey: 'test-input',
          value: [{ operation: operation.id, input }],
          cursor: 'test-cursor',
          capability: 'resumableInvalidation',
          generatedAt: '2026-07-16T00:00:00.000Z',
        } as never;
      },
    });
    const restoreHook = installApplicationQueryHook((operation, input, suspense) => suspense
      ? { data: [{ operation: operation.id, input }], stale: false, revision: 1, async refresh() {} } as never
      : { phase: 'ready', data: [{ operation: operation.id, input }], error: undefined, stale: false, revision: 1, async refresh() {} } as never);
    try {
      const published = createApplicationQueryOperation<{ guestbook: string }, readonly object[]>(publishedContract);
      const invocation = published({ guestbook: 'main' });
      await expect(invocation.preload()).resolves.toEqual([{
        operation: 'GuestBookEntry.published',
        input: { guestbook: 'main' },
      }]);
      expect(invocation.useQuery()).toMatchObject({ phase: 'ready', revision: 1 });
      expect(invocation.useSuspenseQuery()).toMatchObject({ data: [expect.objectContaining({ operation: 'GuestBookEntry.published' })] });
    } finally {
      restoreHook();
      restoreRuntime();
    }
  });

  it('attaches operations without replacing native model members', () => {
    const model = { name: 'GuestBookEntry' };
    const published = createApplicationQueryOperation(publishedContract);
    expect(attachApplicationOperations(model, { published })).toMatchObject({ name: 'GuestBookEntry' });
    expect(Reflect.get(model, 'published')).toBe(published);
    expect(() => attachApplicationOperations(model, { name: published })).toThrow(/cannot replace existing model member name/);
  });
});
