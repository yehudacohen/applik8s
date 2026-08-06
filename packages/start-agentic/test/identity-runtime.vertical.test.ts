import {
  AgenticWorkspaceAdmissionError,
  authenticateAgenticProfileRequest,
  authenticateAgenticStarterRequest,
  readyAgenticProfileIdentity,
} from '@applik8s/start-agentic/identity-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Agentic Start identity runtime', () => {
  it('keeps credential-free Starter identity while admitting workspace authority only from server state', async () => {
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    const workspaceId = '9d389c54-4e6e-4e69-995f-c663946cef3e';
    const request = new Request('http://research.example.test/', {
      headers: { cookie: `applik8s_workspace=${workspaceId}` },
    });
    const lookups: unknown[] = [];

    const admission = await authenticateAgenticStarterRequest(
      request,
      {
        lookup: async (input) => {
          lookups.push(input);
          return {
            workspaceId,
            role: 'workspace-administrator',
          };
        },
      },
    );

    expect(lookups).toEqual([{
      workspaceId,
      principalId: 'principal:research:deterministic:local-developer',
    }]);
    expect(admission.trustedContext).toEqual({
      issuer: 'applik8s://research/identity/deterministic',
      workspaceId,
      workspaceRole: 'workspace-administrator',
    });
    expect(admission.principal.roles).toEqual([
      'authenticated',
      'administrator',
      'workspace-administrator',
    ]);
    expect(admission.principal.trustedContextDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects forged workspace selectors without accepting browser-supplied authority', async () => {
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    const workspaceId = '9d389c54-4e6e-4e69-995f-c663946cef3e';

    await expect(authenticateAgenticStarterRequest(
      new Request('http://research.example.test/', {
        headers: { cookie: `applik8s_workspace=${workspaceId}` },
      }),
      { lookup: async () => undefined },
    )).rejects.toMatchObject({
      name: 'AgenticWorkspaceAdmissionError',
      code: 'APPLIK8S_WORKSPACE_ACCESS_DENIED',
      workspaceId,
    } satisfies Partial<AgenticWorkspaceAdmissionError>);
  });

  it('rejects malformed selectors before consulting the membership authority', async () => {
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    const lookup = vi.fn();

    await expect(authenticateAgenticStarterRequest(
      new Request('http://research.example.test/', {
        headers: { cookie: 'applik8s_workspace=administrator' },
      }),
      { lookup },
    )).rejects.toThrow('workspace selector must be a UUID');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not invent product tenancy when a Starter request has no workspace selector', async () => {
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'notes');

    const admission = await authenticateAgenticStarterRequest(
      new Request('http://notes.example.test/'),
    );

    expect(admission.trustedContext).toEqual({
      issuer: 'applik8s://notes/identity/deterministic',
    });
    expect(admission.principal.roles).toEqual([
      'authenticated',
      'administrator',
    ]);
  });

  it('supports an explicit product-owned Starter workspace bootstrap', async () => {
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    const bootstrap = vi.fn(async () => ({
      workspaceId: '9d389c54-4e6e-4e69-995f-c663946cef3e',
      // Preserve the literal role while leaving workspace configurable.
      // typecast: this is the exact role returned by the bootstrap contract.
      role: 'workspace-owner' as const,
    }));

    const admission = await authenticateAgenticStarterRequest(
      new Request('http://research.example.test/'),
      { bootstrap },
    );

    expect(bootstrap).toHaveBeenCalledWith({
      application: 'research',
      principalId: 'principal:research:deterministic:local-developer',
    });
    expect(admission.trustedContext).toMatchObject({
      workspaceId: '9d389c54-4e6e-4e69-995f-c663946cef3e',
      workspaceRole: 'workspace-owner',
    });
    expect(admission.principal.roles).toEqual([
      'authenticated',
      'administrator',
      'workspace-owner',
    ]);
  });

  it('derives the dedicated Ory boundary from trusted installation state', async () => {
    vi.stubEnv('APPLIK8S_INSTALLATION_SPEC', JSON.stringify({
      name: 'research-dedicated',
      profile: 'dedicated',
      providers: {
        inference: {},
        identity: { issuer: 'https://identity.research.example.test' },
        objects: { deviceStorageClassName: 'dedicated-block' },
      },
    }));
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    vi.stubEnv('APPLIK8S_NAMESPACE', 'research-system');
    vi.stubEnv('APPLIK8S_OPERATION_CATALOG_REVISION', 'catalog-7');
    vi.stubEnv('APPLIK8S_AUTHORITY_REVISION', 'authority-9');
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(sessionFixture());
    });

    const admission = await authenticateAgenticProfileRequest(
      new Request('https://research.example.test/', {
        headers: { cookie: 'ory_kratos_session=session-cookie' },
      }),
      'dedicated',
    );

    expect(requests[0]?.url).toBe(
      'http://research-identity-kratos-public.research-system.svc.cluster.local/sessions/whoami',
    );
    expect(admission).toMatchObject({
      trustedContext: {
        issuer: 'https://identity.research.example.test',
      },
      principal: {
        kind: 'human',
        audience: ['research'],
        catalogRevision: 'catalog-7',
        authorityRevision: 'authority-9',
        identity: { subject: 'human-1' },
      },
    });
  });

  it('probes the chart service ports for the dedicated Ory boundary', async () => {
    vi.stubEnv('APPLIK8S_INSTALLATION_SPEC', JSON.stringify({
      name: 'research-dedicated',
      profile: 'dedicated',
      providers: {
        identity: { issuer: 'https://identity.research.example.test' },
      },
    }));
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    vi.stubEnv('APPLIK8S_NAMESPACE', 'research-system');
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({});
    });

    await readyAgenticProfileIdentity('dedicated');

    expect(requests.map((request) => request.url).sort()).toEqual([
      'http://research-identity-kratos-admin.research-system.svc.cluster.local/health/ready',
      'http://research-identity-kratos-public.research-system.svc.cluster.local/health/ready',
    ]);
  });

  it('uses only explicit externally owned Ory endpoints and probes both surfaces', async () => {
    vi.stubEnv('APPLIK8S_INSTALLATION_SPEC', JSON.stringify({
      name: 'research',
      profile: 'external',
      providers: {
        identity: {
          kind: 'ory',
          issuer: 'https://identity.example.test',
          publicUrl: 'https://identity-public.example.test',
          adminUrl: 'https://identity-admin.example.test',
        },
      },
    }));
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({});
    });

    await readyAgenticProfileIdentity('external');

    expect(requests.map((request) => request.url).sort()).toEqual([
      'https://identity-admin.example.test/health/ready',
      'https://identity-public.example.test/health/ready',
    ]);
  });

  it('fails closed when the runtime profile and requested adapter disagree', async () => {
    vi.stubEnv('APPLIK8S_INSTALLATION_SPEC', JSON.stringify({
      name: 'research',
      profile: 'starter',
    }));
    vi.stubEnv('APPLIK8S_APPLICATION_NAME', 'research');

    await expect(readyAgenticProfileIdentity('dedicated')).rejects.toThrow(
      'Agentic dedicated identity received installation profile "starter".',
    );
  });

  it('fails closed when a dedicated runtime has no compiler-provided logical application name', async () => {
    vi.stubEnv('APPLIK8S_INSTALLATION_SPEC', JSON.stringify({
      name: 'research-dedicated',
      profile: 'dedicated',
      providers: {
        identity: { issuer: 'https://identity.research.example.test' },
      },
    }));
    vi.stubEnv('APPLIK8S_NAMESPACE', 'research-system');

    await expect(readyAgenticProfileIdentity('dedicated')).rejects.toThrow(
      'Agentic Ory identity requires APPLIK8S_APPLICATION_NAME.',
    );
  });
});

function sessionFixture() {
  return {
    id: 'session-1',
    active: true,
    authentication_methods: [
      { method: 'password' },
      { method: 'totp' },
    ],
    identity: {
      id: 'human-1',
      schema_id: 'human',
      traits: { email: 'human@example.test' },
    },
  };
}
