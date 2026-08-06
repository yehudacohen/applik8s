// typecast-file-boundary: MCP client tests use intentionally malformed and partial protocol fixtures to verify runtime rejection.
import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationExternalMcpClient,
  applicationMcpProtocolRevision,
  type ApplicationExternalMcpAuditRecord,
  type ApplicationMcpFetch,
} from '../src/index.js';

describe('external MCP client boundary', () => {
  it('uses a separate audience-bound credential and pins allowlisted schemas', async () => {
    const requests: Request[] = [];
    const audit: ApplicationExternalMcpAuditRecord[] = [];
    const client = new ApplicationExternalMcpClient({
      id: 'retrieval',
      endpoint: 'https://retrieval.example.test/mcp',
      resource: 'https://retrieval.example.test/mcp',
      audience: 'https://retrieval.example.test/mcp',
      scopes: ['fetch'],
      tools: [{ name: 'fetch', schemaRevision: 'schema-1' }],
      timeoutMs: 5_000,
      concurrency: 2,
      maximumRequestBytes: 10_000,
      maximumResponseBytes: 10_000,
      credentials: {
        async acquire() {
          return {
            tokenType: 'Bearer',
            accessToken: 'separate-egress-token',
            audience: 'https://retrieval.example.test/mcp',
            resource: 'https://retrieval.example.test/mcp',
            expiresAt: '2026-07-29T01:00:00.000Z',
            credentialId: 'credential-1',
            source: 'client-credentials-extension',
            separatelyAcquired: true,
          };
        },
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const message = await request.json() as { readonly method: string };
        if (message.method === 'initialize') {
          return json({
            jsonrpc: '2.0',
            id: '1',
            result: {
              protocolVersion: applicationMcpProtocolRevision,
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: 'retrieval', version: '1' },
              _meta: { 'applik8s/catalog-revision': 'catalog-1' },
            },
          }, { 'Mcp-Session-Id': 'session-1' });
        }
        if (message.method === 'tools/list') {
          return json({
            jsonrpc: '2.0',
            id: '2',
            result: {
              tools: [{
                name: 'fetch',
                description: 'Untrusted remote description',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                _meta: {
                  'applik8s/operation-id': 'applik8s://retrieval/operations/fetch',
                  'applik8s/operation-version': '1',
                  'applik8s/schema-revision': 'schema-1',
                  'applik8s/catalog-revision': 'catalog-1',
                },
              }],
            },
          });
        }
        return json({
          jsonrpc: '2.0',
          id: '3',
          result: {
            content: [{ type: 'text', text: '{"ok":true}' }],
            structuredContent: { ok: true },
            _meta: {
              'applik8s/operation-id': 'applik8s://retrieval/operations/fetch',
              'applik8s/catalog-revision': 'catalog-1',
            },
          },
        });
      },
      audit: { async record(record) { audit.push(record); } },
      clock: () => new Date('2026-07-29T00:00:00.000Z'),
      identifier: () => 'fixed',
    });

    await expect(client.initialize()).resolves.toEqual([
      expect.objectContaining({
        name: 'fetch',
        schemaRevision: 'schema-1',
        contentClassification: 'untrusted-external',
      }),
    ]);
    await expect(client.call('fetch', { url: 'https://example.test' }, {
      runCausationId: 'run-1',
    })).resolves.toMatchObject({ structuredContent: { ok: true } });
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe('Bearer separate-egress-token');
      expect(request.url).not.toContain('access_token');
    }
    expect(requests[1]?.headers.get('Mcp-Session-Id')).toBe('session-1');
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'discovery', outcome: 'allowed' }),
      expect.objectContaining({
        event: 'call',
        tool: 'fetch',
        runCausationId: 'run-1',
        credentialId: 'credential-1',
      }),
    ]));
  });

  it('rejects inherited or wrong-audience credentials before network use', async () => {
    const fetch = vi.fn();
    const client = externalClientFixture({
      fetch,
      credential: {
        tokenType: 'Bearer',
        accessToken: 'inbound-user-token',
        audience: 'https://other.example.test',
        resource: 'https://retrieval.example.test/mcp',
        expiresAt: '2026-07-29T01:00:00.000Z',
        credentialId: 'credential-1',
        source: 'authorization-code',
        separatelyAcquired: true,
      },
    });
    await expect(client.initialize()).rejects.toMatchObject({
      code: 'MCP_EXTERNAL_CREDENTIAL_INVALID',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('quarantines an allowlisted tool when its schema changes inside a session', async () => {
    let revision = 'schema-1';
    const client = externalClientFixture({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const message = await request.json() as { readonly method: string };
        if (message.method === 'initialize') {
          return json({
            jsonrpc: '2.0',
            id: '1',
            result: {
              protocolVersion: applicationMcpProtocolRevision,
              capabilities: {},
              serverInfo: { name: 'test', version: '1' },
            },
          }, { 'Mcp-Session-Id': 'session-1' });
        }
        return json({
          jsonrpc: '2.0',
          id: '2',
          result: {
            tools: [{
              name: 'fetch',
              inputSchema: { type: 'object' },
              _meta: {
                'applik8s/operation-id': 'applik8s://test/operations/fetch',
                'applik8s/operation-version': '1',
                'applik8s/schema-revision': revision,
                'applik8s/catalog-revision': 'catalog-1',
              },
            }],
          },
        });
      },
    });
    await client.initialize();
    revision = 'schema-2';
    await expect(client.refreshDiscovery()).rejects.toMatchObject({
      code: 'MCP_EXTERNAL_SCHEMA_CHANGED',
    });
  });

  it('can initialize on the first call at concurrency one and accepts generic MCP results without Applik8s metadata', async () => {
    const client = externalClientFixture({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const message = await request.json() as { readonly method: string };
        if (message.method === 'initialize') {
          return json({
            jsonrpc: '2.0',
            id: '1',
            result: {
              protocolVersion: applicationMcpProtocolRevision,
              capabilities: {},
              serverInfo: { name: 'generic', version: '1' },
            },
          }, { 'Mcp-Session-Id': 'session-1' });
        }
        if (message.method === 'tools/list') {
          return json({
            jsonrpc: '2.0',
            id: '2',
            result: {
              tools: [{
                name: 'fetch',
                inputSchema: { type: 'object' },
                _meta: { vendor: 'generic' },
              }],
            },
          });
        }
        return json({
          jsonrpc: '2.0',
          id: '3',
          result: {
            content: [{ type: 'text', text: 'ok' }],
          },
        });
      },
    });
    await expect(client.call('fetch', {})).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
  });
});

function externalClientFixture(options: {
  readonly fetch: ApplicationMcpFetch;
  readonly credential?: {
    readonly tokenType: 'Bearer';
    readonly accessToken: string;
    readonly audience: string;
    readonly resource: string;
    readonly expiresAt: string;
    readonly credentialId: string;
    readonly source: 'authorization-code';
    readonly separatelyAcquired: true;
  };
}) {
  return new ApplicationExternalMcpClient({
    id: 'retrieval',
    endpoint: 'https://retrieval.example.test/mcp',
    resource: 'https://retrieval.example.test/mcp',
    audience: 'https://retrieval.example.test/mcp',
    scopes: ['fetch'],
    tools: [{ name: 'fetch' }],
    timeoutMs: 5_000,
    concurrency: 1,
    maximumRequestBytes: 10_000,
    maximumResponseBytes: 10_000,
    fetch: options.fetch,
    credentials: {
      async acquire() {
        return options.credential ?? {
          tokenType: 'Bearer',
          accessToken: 'separate-egress-token',
          audience: 'https://retrieval.example.test/mcp',
          resource: 'https://retrieval.example.test/mcp',
          expiresAt: '2026-07-29T01:00:00.000Z',
          credentialId: 'credential-1',
          source: 'authorization-code',
          separatelyAcquired: true,
        };
      },
    },
    clock: () => new Date('2026-07-29T00:00:00.000Z'),
    identifier: () => 'fixed',
  });
}

function json(value: unknown, headers: Record<string, string> = {}) {
  return Response.json(value, { headers });
}
