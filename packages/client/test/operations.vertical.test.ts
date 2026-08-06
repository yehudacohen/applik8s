// typecast-file-boundary: operation test doubles intentionally erase generic payloads while asserting runtime dispatch and metadata preservation.
import { describe, expect, it, vi } from 'vitest';
import {
  attachApplicationOperations,
  createApplicationMutationOperation,
  createApplicationQueryOperation,
  decorateApplicationMutationOperation,
  getApplicationOperationContract,
  getApplicationOperationSchemas,
  installApplicationMutationHook,
  installApplicationOperationRuntime,
  installApplicationQueryHook,
  queryInputKey,
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

  it('fails closed when multiple browser authorities are installed and restores the remaining authority out of order', async () => {
    const first = installApplicationOperationRuntime({
      async execute() {
        return { authority: 'first' } as never;
      },
    });
    const second = installApplicationOperationRuntime({
      async execute() {
        return { authority: 'second' } as never;
      },
    });
    const create = createApplicationMutationOperation<undefined, { authority: string }>(createContract);
    try {
      expect(() => create(undefined)).toThrow(/multiple browser authorities/i);
      first();
      await expect(create(undefined)).resolves.toEqual({ authority: 'second' });
    } finally {
      first();
      second();
    }
  });

  it('decorates a native server operation without changing its function identity', async () => {
    const native = async (input: { message: string }) => ({ identity: input.message });
    const decorated = decorateApplicationMutationOperation(native, createContract);
    expect(decorated).toBe(native);
    await expect(decorated({ message: 'hello' })).resolves.toEqual({ identity: 'hello' });
  });

  it('lazily materializes compiler-owned operation metadata on an ordinary function', async () => {
    const input = Object.freeze({ kind: 'input-schema' });
    const output = Object.freeze({ kind: 'output-schema' });
    const publish = async (value: { postId: string }) => ({
      postId: value.postId,
      published: true,
    });
    Object.defineProperty(
      publish,
      Symbol.for('applik8s.generatedFunctionOperation'),
      {
        value: {
          contract: {
            ...createContract,
            id: 'applik8s://functions/publish/operations/invoke',
            model: 'Function',
            name: 'publish',
            operation: 'custom',
          },
          schemas: { input, output },
        },
      },
    );

    expect(getApplicationOperationContract(publish)).toMatchObject({
      id: 'applik8s://functions/publish/operations/invoke',
      name: 'publish',
      operation: 'custom',
    });
    expect(getApplicationOperationSchemas(
      publish as unknown as Parameters<typeof getApplicationOperationSchemas>[0],
    )).toEqual({ input, output });
    expect(getApplicationOperationContract(publish)?.id).toBe(
      'applik8s://functions/publish/operations/invoke',
    );
    expect(await publish({ postId: 'post-1' })).toEqual({
      postId: 'post-1',
      published: true,
    });
  });

  it('preserves authoring schemas as hidden operation metadata without changing the public contract', () => {
    const input = { '~standard': { version: 1, vendor: 'test' } };
    const output = { '~standard': { version: 1, vendor: 'test' } };
    const operation = createApplicationMutationOperation(
      createContract,
      async () => ({ identity: 'created' }),
      { input, output },
    );
    expect(getApplicationOperationSchemas(operation)).toEqual({ input, output });
    expect(Object.keys(operation)).not.toContain('applicationOperationSchemas');
    expect(() =>
      decorateApplicationMutationOperation(operation, createContract, {
        input: { other: true },
        output,
      }),
    ).toThrow(/cannot be rebound to different authoring schemas/);
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
      expect(await published({ guestbook: 'main' })).toEqual([{
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

  it('normalizes empty-input operations so their public call is truly nullary', async () => {
    const observed: unknown[] = [];
    const restore = installApplicationOperationRuntime({
      async execute(_operation, input) {
        observed.push(input);
        return { ok: true } as never;
      },
      async snapshotQuery(operation, input) {
        observed.push(input);
        return {
          kind: 'snapshot',
          protocol: 'applik8s.query/v1alpha1',
          query: operation.id,
          inputKey: queryInputKey(input),
          value: { ready: true },
          cursor: 'empty-input-cursor',
          capability: 'resumableInvalidation',
          generatedAt: '2026-07-31T00:00:00.000Z',
        } as never;
      },
    });
    try {
      const refresh = createApplicationMutationOperation<{}, { readonly ok: true }>(createContract);
      const current = createApplicationQueryOperation<{}, { readonly ready: true }>(publishedContract);

      await expect(refresh()).resolves.toEqual({ ok: true });
      expect(await current()).toEqual({ ready: true });
      expect(current().input).toEqual({});
      expect(observed).toEqual([{}, {}]);
    } finally {
      restore();
    }
  });

  it('preloads through the same-origin browser authority before a UI provider has mounted', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        kind: 'snapshot',
        protocol: 'applik8s.query/v1alpha1',
        query: 'GuestBookEntry.published',
        inputKey: queryInputKey(body.input),
        value: [{ id: 'entry-1' }],
        cursor: 'browser-cursor',
        capability: 'resumableInvalidation',
        generatedAt: '2026-07-16T00:00:00.000Z',
      });
    }));
    try {
      const published = createApplicationQueryOperation<{ guestbook: string }, readonly { readonly id: string }[]>(publishedContract);
      await expect(published({ guestbook: 'main' }).preload()).resolves.toEqual([{ id: 'entry-1' }]);
      expect(fetch).toHaveBeenCalledWith('/__applik8s/v1/queries/GuestBookEntry.published/snapshot', expect.objectContaining({ method: 'POST' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('attaches operations without replacing native model members', () => {
    const model = { name: 'GuestBookEntry' };
    const published = createApplicationQueryOperation(publishedContract);
    expect(attachApplicationOperations(model, { published })).toMatchObject({ name: 'GuestBookEntry' });
    expect(Reflect.get(model, 'published')).toBe(published);
    expect(() => attachApplicationOperations(model, { name: published })).toThrow(/cannot replace existing model member name/);
  });

  it('classifies the same direct callable as public or permission-assigned authority', () => {
    const create = createApplicationMutationOperation(createContract, async () => ({ id: 'entry-1' }));
    expect(create.authority.classification).toBe('unclassified');
    expect(create.public()).toBe(create);
    expect(create.authority).toMatchObject({
      classification: 'public',
      grantable: false,
      permissionIds: [],
    });

    expect(create.requires({ id: 'permission:guestbook-editor' })).toBe(create);
    expect(create.authority).toMatchObject({
      classification: 'assigned',
      permissionIds: ['permission:guestbook-editor'],
    });
    expect(create.permission).toEqual({
      operation: create,
      operationId: createContract.id,
    });
    expect(getApplicationOperationContract(create)?.authority).toEqual(create.authority);

    expect(create.applicationPolicy()).toBe(create);
    expect(create.authority).toMatchObject({
      classification: 'application-policy',
      grantable: false,
      delegable: false,
      permissionIds: [],
    });
  });

  it('builds serializable target scopes and terminal execution bindings from the callable handle', () => {
    const create = createApplicationMutationOperation<
      { message: string; guestbookId: string },
      { id: string },
      { authorId: string; tenantId: string }
    >(createContract, async () => ({ id: 'entry-1' }));
    const scoped = create
      .where((target) => target.tenantId.eq({ source: 'principal', path: 'identity.tenantId' }))
      .on({ model: 'GuestBookEntry', identity: { id: 'entry-1' } })
      .where((target) => target.tenantId.eq({
        kind: 'applicationTrustedContext',
        name: 'workspaceId',
      }))
      .where((target) => target.authorId.eq('author-1'));
    expect(scoped).toMatchObject({
      target: { kind: 'target', model: 'GuestBookEntry', identity: { id: 'entry-1' } },
      predicates: [
        {
          kind: 'compare',
          field: 'tenantId',
          operator: 'eq',
          value: { kind: 'reference', source: 'principal', path: 'identity.tenantId' },
        },
        {
          kind: 'compare',
          field: 'tenantId',
          operator: 'eq',
          value: {
            kind: 'reference',
            source: 'trusted-context',
            path: 'workspaceId',
          },
        },
        {
          kind: 'compare',
          field: 'authorId',
          operator: 'eq',
          value: { kind: 'literal', value: 'author-1' },
        },
      ],
    });

    const bound = scoped.onInput((input: { guestbookId: string }) => ({
      guestbookId: input.guestbookId,
    }));
    expect(bound).toMatchObject({
      operation: create,
      source: 'input',
      boundKeys: ['guestbookId'],
    });
    expect(Reflect.has(bound, 'where')).toBe(false);
    expect(Reflect.has(bound, 'on')).toBe(false);
    expect(Reflect.has(bound, 'all')).toBe(false);
  });
});
