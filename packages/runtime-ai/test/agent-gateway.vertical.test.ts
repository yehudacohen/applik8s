import { createHash } from 'node:crypto';
import type { ApplicationRequestAdmission } from '@applik8s/core';
import { decodeApplicationExecutionAdmission } from '@applik8s/operations';
import { describe, expect, it, vi } from 'vitest';
import {
  type ApplicationAIAgentGatewayTarget,
  createApplicationAIAgentGateway,
} from '../src/agent-gateway.js';

const secret = 'agent-gateway-internal-secret-at-least-32-bytes';
const target: ApplicationAIAgentGatewayTarget = {
  name: 'researcher',
  nodeId: 'aiAgent.researcher',
  baseUrl: 'http://researcher.research-system.svc:3000',
  workloadIdentityId:
    'identity:research:workload:aiAgent.researcher',
  serviceIdentityId: 'identity:research:service:researcher',
  audience: ['identity:research:workload:aiAgent.researcher'],
  timeoutMs: 120_000,
};

describe('application AI agent gateway', () => {
  it('authenticates, authorizes, signs an exact run admission, and strips browser credentials', async () => {
    const forwarded: Request[] = [];
    const authenticate = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer browser-token');
      expect(request.headers.get('cookie')).toBe('session=browser-cookie');
      return admission();
    });
    const authorize = vi.fn(async () => true);
    const gateway = createApplicationAIAgentGateway({
      application: 'research',
      secret,
      targets: [target],
      authenticate,
      authorize,
      now: () => new Date('2026-07-30T12:00:00.000Z'),
      fetch: Object.assign(async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        forwarded.push(request);
        return new Response('event: RUN_FINISHED\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      }, { preconnect: vi.fn() }),
    });
    const body = {
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
      messages: [],
      forwardedProps: {
        applik8s: { agent: 'researcher' },
      },
    };
    const response = await gateway.handle(new Request(
      'https://research.example.test/__applik8s/v1/ai/chat',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer browser-token',
          cookie: 'session=browser-cookie',
          'content-type': 'application/json',
          'x-applik8s-execution-admission': 'forged-browser-token',
        },
        body: JSON.stringify(body),
      },
    ));

    expect(response?.status).toBe(200);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith({
      admission: admission(),
      target,
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
    });
    const internal = forwarded[0];
    expect(internal?.url).toBe(
      'http://researcher.research-system.svc:3000/__applik8s/v1/ai/chat',
    );
    expect(internal?.headers.get('authorization')).toBeNull();
    expect(internal?.headers.get('cookie')).toBeNull();
    const token = internal?.headers.get('x-applik8s-execution-admission');
    expect(token).toBeTruthy();
    const decoded = decodeApplicationExecutionAdmission(
      secret,
      token!,
      {
        executionKind: 'agent',
        workloadIdentityId: target.workloadIdentityId,
        serviceIdentityId: target.serviceIdentityId,
        audience: target.audience,
        binding: {
          agentId: target.nodeId,
          threadId: 'conversation-1',
          runId: 'protocol-run-1',
        },
        now: new Date('2026-07-30T12:00:01.000Z'),
      },
    );
    expect(decoded.admission).toEqual(admission());
    expect(decoded.executionId).toMatch(/^agent-run:[a-f0-9]{64}$/u);
    expect(await internal?.json()).toEqual(body);
  });

  it('fails closed for unknown agents, denied requests, and oversized bodies', async () => {
    const dispatch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response());
    const gateway = createApplicationAIAgentGateway({
      application: 'research',
      secret,
      targets: [target],
      authenticate: async () => admission(),
      authorize: async () => false,
      maximumRequestBytes: 1_024,
      fetch: Object.assign(dispatch, { preconnect: vi.fn() }),
    });
    const unknown = await gateway.handle(agentRequest({
      forwardedProps: { applik8s: { agent: 'unknown' } },
    }));
    expect(unknown?.status).toBe(404);
    const denied = await gateway.handle(agentRequest());
    expect(denied?.status).toBe(403);
    const oversized = await gateway.handle(agentRequest({
      messages: [{ content: 'x'.repeat(2_000) }],
    }));
    expect(oversized?.status).toBe(413);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not claim unrelated gateway routes', async () => {
    const gateway = createApplicationAIAgentGateway({
      application: 'research',
      secret,
      targets: [target],
      authenticate: async () => admission(),
      authorize: async () => true,
    });
    expect(
      await gateway.handle(
        new Request('https://research.example.test/__applik8s/v1/queries/list'),
      ),
    ).toBeUndefined();
  });

  it('bounds agent dispatch and distinguishes timeout from provider failure', async () => {
    const timedOut = createApplicationAIAgentGateway({
      application: 'research',
      secret,
      targets: [{ ...target, timeoutMs: 10 }],
      authenticate: async () => admission(),
      authorize: async () => true,
      fetch: Object.assign(async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        await new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
        });
        return new Response();
      }, { preconnect: vi.fn() }),
    });
    expect(await timedOut.handle(agentRequest())).toMatchObject({
      status: 504,
    });

    const unavailable = createApplicationAIAgentGateway({
      application: 'research',
      secret,
      targets: [target],
      authenticate: async () => admission(),
      authorize: async () => true,
      fetch: Object.assign(async () => {
        throw new Error('connection refused');
      }, { preconnect: vi.fn() }),
    });
    const response = await unavailable.handle(agentRequest());
    expect(response?.status).toBe(502);
    expect(await response?.json()).toEqual({
      error: 'upstream_unavailable',
    });
  });
});

function agentRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): Request {
  return new Request(
    'https://research.example.test/__applik8s/v1/ai/chat',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'conversation-1',
        runId: 'protocol-run-1',
        messages: [],
        ...overrides,
      }),
    },
  );
}

function admission(): ApplicationRequestAdmission {
  const trustedContext = { tenant: 'tenant-1' };
  return {
    principal: {
      id: 'principal:research:human:user-1',
      identity: {
        id: 'identity:research:human:user-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'user-1',
      },
      kind: 'human',
      authenticationMethod: 'oauth-session',
      audience: ['research'],
      trustedContextDigest: createHash('sha256')
        .update(JSON.stringify(trustedContext))
        .digest('hex'),
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-30T11:59:00.000Z',
      expiresAt: '2026-07-30T12:10:00.000Z',
    },
    trustedContext,
  };
}
