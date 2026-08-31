// typecast-file-boundary: request-scope tests use focused authenticated runtime doubles to prove resolver installation and cleanup.
import { describe, expect, it } from 'vitest';
import { ApplicationCommandClient, ApplicationQueryClient, type ApplicationOperationContract } from '@applik8s/client';
import {
  createApplik8sServerAgentOperation,
  createApplik8sServerQueryOperation,
  installApplik8sServerRequestRuntimeResolver,
  runWithApplik8sServerRequest,
} from '../src/index.js';

const contract = {
  apiVersion: 'applik8s.operation/v1alpha1',
  kind: 'applicationOperation',
  id: 'Widget.list',
  model: 'Widget',
  name: 'list',
  operation: 'query',
  transport: 'query',
} satisfies ApplicationOperationContract;

describe('framework-neutral authenticated server request scope', () => {
  it('executes callable agents through the authenticated same-origin request transport', async () => {
    const requests: Request[] = [];
    const runtime = {
      ...requestRuntime('agent'),
      request: new Request('https://application.example.test/app'),
      fetch: Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({ result: { status: 'completed', value: { body: 'grounded' } } });
      }, { preconnect() {} }) as typeof globalThis.fetch,
    };
    const operation = createApplik8sServerAgentOperation<
      { readonly threadId: string; readonly question: string },
      { readonly status: 'completed'; readonly value: { readonly body: string } }
    >({ name: 'researcher.v1', key: 'threadId' });

    const result = await runWithApplik8sServerRequest(runtime, () => operation(
      { threadId: 'research-1', question: 'What changed?' },
      { idempotencyKey: 'request-1' },
    ));

    expect(result).toEqual({ status: 'completed', value: { body: 'grounded' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://application.example.test/__applik8s/v1/ai/chat');
    expect(requests[0]?.headers.get('idempotency-key')).toBe('request-1');
  });

  it('uses the active request client and never falls back to an unauthenticated loopback fetch', async () => {
    const operation = createApplik8sServerQueryOperation<{ tenant: string }, readonly string[]>(contract);
    await expect(operation({ tenant: 'missing' }).snapshot()).rejects.toThrow(/no authenticated request runtime/);
    const runtime = requestRuntime('tenant-a');
    await expect(runWithApplik8sServerRequest(runtime, () => operation({ tenant: 'tenant-a' }).snapshot()))
      .resolves.toMatchObject({ value: ['tenant-a'] });
  });

  it('supports adapter-provided request contexts and out-of-order uninstallation', async () => {
    const operation = createApplik8sServerQueryOperation<{ tenant: string }, readonly string[]>(contract);
    const removeA = installApplik8sServerRequestRuntimeResolver(() => requestRuntime('a'));
    const removeB = installApplik8sServerRequestRuntimeResolver(() => requestRuntime('b'));
    removeA();
    await expect(operation({ tenant: 'b' }).preload()).resolves.toEqual(['b']);
    removeB();
    await expect(operation({ tenant: 'missing' }).snapshot()).rejects.toThrow(/no authenticated request runtime/);
  });
});

function requestRuntime(tenant: string) {
  return {
    request: new Request(`https://example.test/?tenant=${tenant}`),
    queryClient: new ApplicationQueryClient({
      async snapshot<TInput, TValue>(query: string, _input: TInput) {
        return {
          protocol: 'applik8s.query/v1alpha1', kind: 'snapshot', capability: 'resumableInvalidation',
          query, inputKey: tenant, cursor: tenant, revision: 1, generatedAt: new Date(0).toISOString(), value: [tenant] as unknown as TValue, // typecast: the generic transport fixture's concrete value shape is selected by the caller.
        };
      },
      async subscribe() {},
    }),
    commandClient: new ApplicationCommandClient({
      async submit() { throw new Error('not used'); },
      async progress() { throw new Error('not used'); },
    }),
  };
}
