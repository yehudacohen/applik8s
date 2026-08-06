// typecast-file-boundary: MCP server tests intentionally supply boundary fixtures to verify runtime protocol validation.
import {
  CallToolResultSchema,
  InitializeResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationMcpError,
  ApplicationMcpServerRuntime,
  InMemoryApplicationMcpSessionStore,
  applicationMcpProtocolRevision,
  applicationMcpSchemaRevision,
  createApplicationMcpCatalogSource,
  createApplicationMcpHttpHandler,
  type ApplicationMcpCatalogSource,
} from '../src/index.js';

describe('MCP server runtime', () => {
  it('pins one catalog and reauthorizes the same operation on every call', async () => {
    const operation = operationFixture('catalog-1');
    const catalog = catalogSource(catalogFixture('catalog-1', 'active', operation));
    const execute = vi.fn(async ({ arguments: input }: { readonly arguments: JsonValue }) => ({
      message: `hello ${(input as { readonly name: string }).name}`,
    }));
    const runtime = runtimeFixture({ catalog, execute });
    const admission = admissionFixture();

    const initialized = await runtime.initialize({
      protocolVersion: applicationMcpProtocolRevision,
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admission);
    expect(InitializeResultSchema.safeParse({
      protocolVersion: initialized.protocolVersion,
      capabilities: initialized.capabilities,
      serverInfo: initialized.serverInfo,
      instructions: initialized.instructions,
    }).success).toBe(true);

    const tools = await runtime.listTools(initialized.sessionId, admission);
    expect(ListToolsResultSchema.safeParse({ tools }).success).toBe(true);
    expect(tools).toEqual([
      expect.objectContaining({
        name: 'greet',
        inputSchema: operation.input.schema,
        outputSchema: operation.output.schema,
      }),
    ]);

    const result = await runtime.callTool('greet', { name: 'Ada' }, {
      admission: { ...admission, principal: { ...admission.principal, authorityRevision: 'authority-2' } },
      sessionId: initialized.sessionId,
      idempotencyKey: 'request-1',
    });
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result.structuredContent).toEqual({ message: 'hello Ada' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation,
      transport: 'mcp',
      admission: expect.objectContaining({
        principal: expect.objectContaining({ authorityRevision: 'authority-2' }),
      }),
      idempotencyKey: 'request-1',
    }));
  });

  it('does not reinterpret a live session when a new catalog activates', async () => {
    const first = operationFixture('catalog-1');
    const second = {
      ...operationFixture('catalog-2'),
      input: schema({ type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false }),
    };
    let catalogs = [
      catalogFixture('catalog-1', 'active', first),
    ];
    const catalog: ApplicationMcpCatalogSource = {
      async active() {
        const active = catalogs.find((candidate) => candidate.state === 'active')!;
        return active;
      },
      async get(_application, revision) {
        return catalogs.find((candidate) => candidate.revision === revision);
      },
    };
    const execute = vi.fn(async () => ({ message: 'first' }));
    const runtime = runtimeFixture({ catalog, execute });
    const admission = admissionFixture();
    const initialized = await runtime.initialize({
      protocolVersion: applicationMcpProtocolRevision,
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admission);

    catalogs = [
      catalogFixture('catalog-1', 'draining', first),
      catalogFixture('catalog-2', 'active', second),
    ];
    await expect(runtime.callTool('greet', { name: 'Grace' }, {
      admission,
      sessionId: initialized.sessionId,
    })).resolves.toMatchObject({ structuredContent: { message: 'first' } });
    await expect(runtime.callTool('greet', { count: 2 }, {
      admission,
      sessionId: initialized.sessionId,
    })).rejects.toMatchObject({ code: 'MCP_INPUT_INVALID' });

    catalogs = [
      catalogFixture('catalog-1', 'retired', first),
      catalogFixture('catalog-2', 'active', second),
    ];
    await expect(runtime.listTools(initialized.sessionId, admission)).rejects.toMatchObject({
      code: 'MCP_CATALOG_REINITIALIZE_REQUIRED',
    });
  });

  it('accepts nullable values emitted by ArkType-backed operation schemas', async () => {
    const base = operationFixture('catalog-1');
    const output = schema({
      type: 'object',
      properties: {
        value: {
          type: 'object',
          properties: {
            approvedBy: { type: 'string', nullable: true },
          },
          required: ['approvedBy'],
        },
      },
      required: ['value'],
    });
    const operation = {
      ...base,
      output,
      transports: base.transports.map((transport) => ({
        ...transport,
        ...(transport.mcp
          ? {
            mcp: {
              ...transport.mcp,
              schemaRevision: `${base.input.digest}:${output.digest}`,
            },
          }
          : {}),
      })),
    };
    const runtime = runtimeFixture({
      catalog: catalogSource(catalogFixture('catalog-1', 'active', operation)),
      execute: async () => ({ value: { approvedBy: null } }),
    });
    const admission = admissionFixture();
    const initialized = await runtime.initialize({
      protocolVersion: applicationMcpProtocolRevision,
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admission);

    await expect(runtime.callTool('greet', { name: 'Ada' }, {
      admission,
      sessionId: initialized.sessionId,
      idempotencyKey: 'nullable-result',
    })).resolves.toMatchObject({
      structuredContent: { value: { approvedBy: null } },
    });
  });

  it('prevents session transfer and rejects wrong protocol eras', async () => {
    const runtime = runtimeFixture({
      catalog: catalogSource(catalogFixture('catalog-1', 'active', operationFixture('catalog-1'))),
      execute: async () => ({ message: 'ok' }),
    });
    const admission = admissionFixture();
    await expect(runtime.initialize({
      protocolVersion: '2026-07-28',
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admission)).rejects.toMatchObject({ code: 'MCP_PROTOCOL_UNSUPPORTED' });

    const initialized = await runtime.initialize({
      protocolVersion: applicationMcpProtocolRevision,
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admission);
    const other = admissionFixture({
      id: 'principal-other',
      identity: { ...admission.principal.identity, id: 'identity-other', subject: 'other' },
    });
    await expect(runtime.listTools(initialized.sessionId, other)).rejects.toMatchObject({
      code: 'MCP_SESSION_IDENTITY_MISMATCH',
    });
  });

  it('serves protected-resource metadata and never accepts query-string bearer tokens', async () => {
    const runtime = runtimeFixture({
      catalog: catalogSource(catalogFixture('catalog-1', 'active', operationFixture('catalog-1'))),
      execute: async () => ({ message: 'ok' }),
    });
    const admitRequest = vi.fn(async () => admissionFixture());
    const handle = createApplicationMcpHttpHandler({ runtime, admitRequest });
    const metadata = await handle(new Request(
      'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
    ));
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      resource: 'https://mcp.example.test/mcp',
      authorization_servers: ['https://identity.example.test'],
      applik8s_protocol_revision: applicationMcpProtocolRevision,
      applik8s_operation_catalog_revision: 'catalog-1',
    });

    const rejected = await handle(new Request(
      'https://mcp.example.test/mcp?access_token=leaked',
      {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      },
    ));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(admitRequest).not.toHaveBeenCalled();
  });

  it('mounts transport on an internal path without changing OAuth resource identity', async () => {
    const runtime = runtimeFixture({
      catalog: catalogSource(catalogFixture('catalog-1', 'active', operationFixture('catalog-1'))),
      execute: async () => ({ message: 'ok' }),
    });
    const handle = createApplicationMcpHttpHandler({
      runtime,
      path: '/__applik8s/mcp/public',
      admitRequest: async () => admissionFixture(),
    });
    const canonical = await handle(new Request('https://mcp.example.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: applicationMcpProtocolRevision,
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    }));
    expect(canonical.status).toBe(404);
    const mounted = await handle(new Request(
      'http://identity-start-access-mcp/__applik8s/mcp/public',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: applicationMcpProtocolRevision,
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      },
    ));
    expect(mounted.status).toBe(200);
    expect(mounted.headers.get('Mcp-Session-Id')).toBeTruthy();
    await expect(mounted.json()).resolves.toMatchObject({
      result: {
        protocolVersion: applicationMcpProtocolRevision,
      },
    });
  });

  it('releases abandoned session catalog references through a bounded expiry sweep', async () => {
    const release = vi.fn(async () => undefined);
    const source = {
      ...catalogSource(
        catalogFixture('catalog-1', 'active', operationFixture('catalog-1')),
      ),
      release,
    };
    const runtime = new ApplicationMcpServerRuntime({
      application: 'test',
      definition: {
        apiVersion: 'applik8s.mcpServer/v1alpha1',
        id: 'research',
        name: 'Research',
        revision: 'server-1',
        endpoint: 'https://mcp.example.test/mcp',
        resource: 'https://mcp.example.test/mcp',
        audience: 'https://mcp.example.test/mcp',
        authorizationServers: ['https://identity.example.test'],
        scopes: ['operations:invoke'],
        protocolRevision: applicationMcpProtocolRevision,
        sessionLifetimeMs: 60_000,
      },
      catalog: source,
      sessions: new InMemoryApplicationMcpSessionStore(),
      executor: { async execute() { return {}; } },
      identifier: () => 'expired',
      clock: (() => {
        let calls = 0;
        return () => new Date(
          calls++ === 0
            ? '2026-07-29T00:00:00.000Z'
            : '2026-07-29T00:02:00.000Z',
        );
      })(),
    });
    const initialized = await runtime.initialize({
      protocolVersion: applicationMcpProtocolRevision,
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }, admissionFixture());
    await expect(runtime.reapExpiredSessions()).resolves.toEqual([
      initialized.sessionId,
    ]);
    expect(release).toHaveBeenCalledWith(
      'test',
      'catalog-1',
      initialized.sessionId,
    );
  });
});

function runtimeFixture(options: {
  readonly catalog: ApplicationMcpCatalogSource;
  readonly execute: (input: {
    readonly arguments: JsonValue;
  }) => Promise<JsonValue>;
}): ApplicationMcpServerRuntime {
  return new ApplicationMcpServerRuntime({
    application: 'test',
    definition: {
      apiVersion: 'applik8s.mcpServer/v1alpha1',
      id: 'research',
      name: 'Research',
      revision: 'server-1',
      endpoint: 'https://mcp.example.test/mcp',
      resource: 'https://mcp.example.test/mcp',
      audience: 'https://mcp.example.test/mcp',
      authorizationServers: ['https://identity.example.test'],
      scopes: ['operations:invoke'],
      protocolRevision: applicationMcpProtocolRevision,
      sessionLifetimeMs: 600_000,
    },
    catalog: options.catalog,
    sessions: new InMemoryApplicationMcpSessionStore(),
    executor: { execute: options.execute },
    identifier: () => 'fixed',
    clock: () => new Date('2026-07-29T00:00:00.000Z'),
  });
}

function admissionFixture(
  override: Partial<ApplicationPrincipal> = {},
): ApplicationRequestAdmission {
  return {
    principal: {
      id: 'principal-viewer',
      identity: {
        id: 'identity-viewer',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'viewer',
      },
      kind: 'human',
      authenticationMethod: 'oauth-access-token',
      audience: ['https://mcp.example.test/mcp'],
      trustedContextDigest: 'context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2026-07-29T01:00:00.000Z',
      ...override,
    },
    trustedContext: {},
  };
}

function operationFixture(catalogRevision: string): ApplicationOperationDescriptor {
  const input = schema({
    type: 'object',
    properties: { name: { type: 'string', minLength: 1 } },
    required: ['name'],
    additionalProperties: false,
  });
  const output = schema({
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
    additionalProperties: false,
  });
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://test/operations/greet',
    version: catalogRevision,
    name: 'greet',
    kind: 'model.operation',
    input,
    output,
    errors: {},
    authority: {
      classification: 'assigned',
      grantable: true,
      delegable: false,
      checks: ['admission', 'execution'],
      defaultScope: { kind: 'all' },
      audiences: ['https://mcp.example.test/mcp'],
      transports: ['direct', 'mcp'],
    },
    transports: [{
      id: 'mcp.research.greet',
      transport: 'mcp',
      server: 'research',
      mcp: {
        server: 'research',
        tool: 'greet',
        schemaRevision: `${input.digest}:${output.digest}`,
      },
    }],
    placement: { nodeId: 'handler.greet', runtime: 'server' },
  };
}

function schema(value: Record<string, JsonValue>) {
  return {
    digest: `sha256:${JSON.stringify(value).length}`,
    schema: value,
  };
}

function catalogFixture(
  revision: string,
  state: ApplicationOperationCatalog['state'],
  operation: ApplicationOperationDescriptor,
) {
  return {
    revision,
    state,
    operations: [operation],
  };
}

function catalogSource(
  catalog: ReturnType<typeof catalogFixture>,
): ApplicationMcpCatalogSource {
  return {
    async active() {
      return catalog;
    },
    async get(_application, revision) {
      return revision === catalog.revision ? catalog : undefined;
    },
  };
}
