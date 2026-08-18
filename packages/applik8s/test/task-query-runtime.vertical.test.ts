// typecast-file-boundary: Task-query tests intentionally construct signed protocol fixtures and generic handler fakes for negative validation coverage.
import { describe, expect, it, vi } from 'vitest';
import { createApplicationTaskQueryRuntime, verifyApplicationTaskQueryAdmission } from '../src/task-query-runtime.js';

const secret = 'task-query-test-secret-with-at-least-32-bytes';

describe('task query runtime', () => {
  it('does not require a service principal for a task with no declared queries in a shared worker', () => {
    const runtime = createApplicationTaskQueryRuntime({ cursorSecret: secret, queries: [] });
    expect(runtime.bind({}, undefined)).toEqual({});
  });

  it('injects only declared bounded queries under a signed compiler-owned service principal', async () => {
    let admission: ReturnType<typeof verifyApplicationTaskQueryAdmission> | undefined;
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const incoming = new Request('http://chirp-social.chirp.svc:8080/__applik8s/v1/queries/Post.homeTimeline/snapshot', init);
      admission = verifyApplicationTaskQueryAdmission({ request: incoming, cursorSecret: secret, audience: 'gateway.social', query: 'Post.homeTimeline', input: { viewerId: 'automation-account' }, now: new Date('2026-07-20T00:00:00.000Z') });
      return new Response(JSON.stringify({
        kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'Post.homeTimeline',
        inputKey: 'ignored', cursor: 'opaque', capability: 'resumableInvalidation', generatedAt: '2026-07-20T00:00:00.000Z',
        value: [{ id: 'post-1', body: 'hello' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const runtime = createApplicationTaskQueryRuntime({
      cursorSecret: secret,
      fetch: request as unknown as typeof fetch,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      queries: [{
        id: 'Post.homeTimeline', audience: 'gateway.social',
        endpoint: 'http://chirp-social.chirp.svc:8080/__applik8s/v1/queries/Post.homeTimeline/snapshot',
        inputSchema: { type: 'object', properties: { viewerId: { type: 'string' } }, required: ['viewerId'], additionalProperties: false },
        outputSchema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, body: { type: 'string' } }, required: ['id', 'body'], additionalProperties: false } },
        timeoutMs: 2_000, maxResultBytes: 16_000,
      }],
    });
    const queries = runtime.bind({ context: 'Post.homeTimeline' }, {
      id: 'automation-account', roles: ['automation-worker'], authorizationVersion: 'policy-v1', trustedContext: { automationId: 'automation-1' },
    });

    await expect(queries.context?.({ viewerId: 'automation-account' })).resolves.toEqual([{ id: 'post-1', body: 'hello' }]);
    expect(admission).toEqual({
      principal: { id: 'automation-account', roles: ['automation-worker'] },
      authorizationVersion: 'policy-v1', trustedContext: { automationId: 'automation-1' },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(() => runtime.bind({ forbidden: 'Post.notDeclared' }, { id: 'worker', authorizationVersion: 'v1' })).toThrow(/undeclared/);
  });

  it('preserves canonical service identity through signed internal query admission', async () => {
    let admission: ReturnType<typeof verifyApplicationTaskQueryAdmission> | undefined;
    const runtime = createApplicationTaskQueryRuntime({
      cursorSecret: secret,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        const request = new Request('http://gateway/queries/AgentProfile.active/snapshot', init);
        admission = verifyApplicationTaskQueryAdmission({
          request,
          cursorSecret: secret,
          audience: 'gateway.web',
          query: 'AgentProfile.active',
          input: { slug: 'workspace-assistant' },
        });
        return new Response(JSON.stringify({
          kind: 'snapshot',
          protocol: 'applik8s.query/v1alpha1',
          query: 'AgentProfile.active',
          value: {},
        }));
      }) as typeof fetch,
      queries: [{
        id: 'AgentProfile.active',
        audience: 'gateway.web',
        endpoint: 'http://gateway/queries/AgentProfile.active/snapshot',
        inputSchema: {
          type: 'object',
          properties: { slug: { type: 'string' } },
          required: ['slug'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object', additionalProperties: false },
        timeoutMs: 1_000,
        maxResultBytes: 1_000,
      }],
    });
    const identity = {
      id: 'identity:agentic-product:service:workspace-assistant',
      kind: 'service' as const,
      issuer: 'applik8s://agentic-product',
      subject: 'workspace-assistant',
    };
    const active = runtime.bind({ active: 'AgentProfile.active' }, {
      id: identity.id,
      identity,
      kind: 'service',
      authenticationMethod: 'workload-identity',
      authorizationVersion: 'authority-v1',
    }).active;
    if (!active) throw new Error('Expected declared query.');

    await active({ slug: 'workspace-assistant' });

    expect(admission?.principal).toEqual({
      id: identity.id,
      identity,
      kind: 'service',
      authenticationMethod: 'workload-identity',
    });
  });

  it('preserves function-native zero-input queries while required inputs remain fail-closed', async () => {
    const inputs: unknown[] = [];
    const runtime = createApplicationTaskQueryRuntime({
      cursorSecret: secret,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        inputs.push(JSON.parse(String(init?.body)).input);
        return new Response(JSON.stringify({
          kind: 'snapshot',
          protocol: 'applik8s.query/v1alpha1',
          query: inputs.length === 1 ? 'AutomationControl.current' : 'Post.byId',
          value: { ready: true },
        }), { status: 200 });
      }) as typeof fetch,
      queries: [
        {
          id: 'AutomationControl.current',
          audience: 'gateway.automation',
          endpoint: 'http://gateway/query/snapshot',
          inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
          outputSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
          timeoutMs: 1_000,
          maxResultBytes: 1_000,
        },
        {
          id: 'Post.byId',
          audience: 'gateway.social',
          endpoint: 'http://gateway/query/snapshot',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
          outputSchema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
          timeoutMs: 1_000,
          maxResultBytes: 1_000,
        },
      ],
    });
    const queries = runtime.bind(
      { current: 'AutomationControl.current', byId: 'Post.byId' },
      { id: 'automation-account', authorizationVersion: 'v1' },
    );

    await expect(queries.current?.()).resolves.toEqual({ ready: true });
    expect(inputs).toEqual([{}]);
    await expect(queries.byId?.()).rejects.toThrow(/task-query-schema-invalid/);
    expect(inputs).toEqual([{}]);
  });

  it('rejects tampered, wrong-audience, and expired internal admissions', async () => {
    let signedRequest: Request | undefined;
    const runtime = createApplicationTaskQueryRuntime({
      cursorSecret: secret,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        signedRequest = new Request('http://gateway/query/snapshot', init);
        return new Response(JSON.stringify({ kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'Account.mine', value: [] }), { status: 200 });
      }) as typeof fetch,
      queries: [{ id: 'Account.mine', audience: 'gateway.account', endpoint: 'http://gateway/query/snapshot', inputSchema: { type: 'object' }, outputSchema: { type: 'array' }, timeoutMs: 1_000, maxResultBytes: 1_000 }],
    });
    const mine = runtime.bind({ mine: 'Account.mine' }, { id: 'account-1', authorizationVersion: 'v1' }).mine;
    if (!mine) throw new Error('Expected declared query.');
    await mine({});
    if (!signedRequest) throw new Error('Expected signed request.');
    expect(verifyApplicationTaskQueryAdmission({ request: signedRequest, cursorSecret: secret, audience: 'gateway.other', query: 'Account.mine', input: {}, now: new Date('2026-07-20T00:00:00.000Z') })).toBeUndefined();
    expect(verifyApplicationTaskQueryAdmission({ request: signedRequest, cursorSecret: secret, audience: 'gateway.account', query: 'Account.mine', input: {}, now: new Date('2026-07-20T00:01:01.000Z') })).toBeUndefined();
    expect(verifyApplicationTaskQueryAdmission({ request: signedRequest, cursorSecret: secret, audience: 'gateway.account', query: 'Account.mine', input: { changed: true }, now: new Date('2026-07-20T00:00:00.000Z') })).toBeUndefined();
    const tampered = new Request(signedRequest, { headers: { ...Object.fromEntries(signedRequest.headers), 'x-applik8s-task-query': `${signedRequest.headers.get('x-applik8s-task-query')}x` } });
    expect(verifyApplicationTaskQueryAdmission({ request: tampered, cursorSecret: secret, audience: 'gateway.account', query: 'Account.mine', input: {}, now: new Date('2026-07-20T00:00:00.000Z') })).toBeUndefined();
  });

  it('streams responses through a hard byte ceiling instead of buffering an unbounded body', async () => {
    const runtime = createApplicationTaskQueryRuntime({
      cursorSecret: secret,
      fetch: (async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(40_000)));
          controller.enqueue(new TextEncoder().encode('y'.repeat(40_000)));
          controller.close();
        },
      }))) as unknown as typeof fetch,
      queries: [{ id: 'Bounded.current', audience: 'gateway.bounded', endpoint: 'http://gateway/query/snapshot', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, timeoutMs: 1_000, maxResultBytes: 1 }],
    });
    const current = runtime.bind({ current: 'Bounded.current' }, { id: 'account-1', authorizationVersion: 'v1' }).current;
    if (!current) throw new Error('Expected declared bounded query.');
    await expect(current({})).rejects.toThrow(/response-too-large/);
  });
});
