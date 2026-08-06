import { describe, expect, it, vi } from 'vitest';
import {
  createIdentityStartMcpCredential,
  identityStartMcpClientId,
  identityStartMcpResource,
  invokeIdentityStartMcp,
} from './identity-start-mcp';

describe('Identity Start MCP live-evidence helpers', () => {
  it('provisions an issuer-admitted client credential with exact resource bounds', async () => {
    const revokeClient = vi.fn(async () => undefined);
    const provisionClient = vi.fn(async ({ client }) => client);
    const issueToken = vi.fn(async () => ({
      accessToken: 'provider-token',
      tokenType: 'bearer',
      expiresIn: 300,
      scope: ['operations:invoke'],
    }));
    const credential = await createIdentityStartMcpCredential({
      client: async () => undefined,
      provisionClient,
      issueToken,
      revokeClient,
    });

    expect(provisionClient).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({
        id: identityStartMcpClientId,
        type: 'service',
        allowedResources: [identityStartMcpResource],
        allowedAudience: [identityStartMcpResource],
        grantTypes: ['client_credentials'],
      }),
      secret: expect.stringMatching(/^applik8s-v07-/u),
    }));
    expect(issueToken).toHaveBeenCalledWith(expect.objectContaining({
      grantType: 'client_credentials',
      resources: [identityStartMcpResource],
      audience: [identityStartMcpResource],
    }));
    await credential.revoke();
    expect(revokeClient).toHaveBeenCalledWith(identityStartMcpClientId);
  });

  it('initializes, discovers, and calls the typed create tool in one pinned session', async () => {
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      // typecast: narrow the controlled JSON-RPC test request to the fields used by the fake transport.
      const message = await request.json() as {
        readonly id: number;
        readonly method: string;
      };
      if (message.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'identity-start', version: '0.7.0' },
            _meta: {
              'applik8s/catalog-revision': 'catalog-v07',
            },
          },
        }, { headers: { 'Mcp-Session-Id': 'session-v07' } });
      }
      if (message.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: [{ name: 'create' }] },
        });
      }
      return Response.json({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [],
          structuredContent: { id: 'request-v07' },
          isError: false,
        },
      });
    });

    await expect(invokeIdentityStartMcp({
      endpoint: 'https://identity-start.example.test/mcp',
      accessToken: 'provider-token',
      input: { target: 'production/catalog' },
      fetch: fetcher,
    })).resolves.toMatchObject({
      sessionId: 'session-v07',
      catalogRevision: 'catalog-v07',
      tool: 'create',
      result: {
        structuredContent: { id: 'request-v07' },
      },
    });
    expect(requests).toHaveLength(3);
    expect(requests[1]?.headers.get('Mcp-Session-Id')).toBe('session-v07');
    expect(requests[2]?.headers.get('Idempotency-Key')).toMatch(
      /^identity-start-mcp-/u,
    );
    expect(requests.every((request) =>
      request.headers.get('authorization') === 'Bearer provider-token'
    )).toBe(true);
  });
});
