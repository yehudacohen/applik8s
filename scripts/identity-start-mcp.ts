// typecast-file-boundary: live OAuth and MCP wire values are narrowed before
// becoming exact-candidate evidence.
import { randomUUID } from 'node:crypto';
import type {
  ApplicationOAuthClient,
  ApplicationOAuthProtocolProviderAdapter,
} from '@applik8s/identity';

export const identityStartMcpClientId =
  'identity-start-release-automation';
export const identityStartMcpResource =
  'https://identity-start.example.test/mcp';
export const identityStartMcpScope = 'operations:invoke';

export type IdentityStartMcpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface IdentityStartMcpCredential {
  readonly accessToken: string;
  readonly clientId: typeof identityStartMcpClientId;
  readonly clientSecret: string;
  readonly revoke: () => Promise<void>;
}

export async function createIdentityStartMcpCredential(
  provider: Pick<
    ApplicationOAuthProtocolProviderAdapter,
    'client' | 'provisionClient' | 'issueToken' | 'revokeClient'
  >,
): Promise<IdentityStartMcpCredential> {
  const existing = await provider.client(identityStartMcpClientId);
  if (existing) await provider.revokeClient(identityStartMcpClientId);
  const clientSecret = `applik8s-v07-${randomUUID()}`;
  const client = identityStartOAuthClient();
  await provider.provisionClient({
    client,
    name: 'Identity Start release automation',
    secret: clientSecret,
  });
  try {
    const token = await provider.issueToken({
      grantType: 'client_credentials',
      client: {
        clientId: identityStartMcpClientId,
        clientSecret,
      },
      scopes: [identityStartMcpScope],
      resources: [identityStartMcpResource],
      audience: [identityStartMcpResource],
    });
    if (!token.accessToken.trim()) {
      throw new Error('Identity Start OAuth provider returned an empty access token.');
    }
    return Object.freeze({
      accessToken: token.accessToken,
      clientId: identityStartMcpClientId,
      clientSecret,
      revoke: () => provider.revokeClient(identityStartMcpClientId),
    });
  } catch (error) {
    await provider.revokeClient(identityStartMcpClientId).catch(() => undefined);
    throw error;
  }
}

export interface IdentityStartMcpInvocation {
  readonly sessionId: string;
  readonly catalogRevision: string;
  readonly tool: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export async function invokeIdentityStartMcp(
  options: {
    readonly endpoint: string;
    readonly accessToken: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly fetch?: IdentityStartMcpFetch;
  },
): Promise<IdentityStartMcpInvocation> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const initialized = await mcpRequest({
    fetcher,
    endpoint: options.endpoint,
    accessToken: options.accessToken,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'applik8s-v07-evidence', version: '0.7.0' },
    },
  });
  const sessionId = requiredHeader(
    initialized.response.headers,
    'Mcp-Session-Id',
  );
  const initializedResult = objectValue(
    initialized.body.result,
    'MCP initialize result',
  );
  const metadata = optionalObject(initializedResult._meta);
  const catalogRevision = requiredString(
    metadata?.['applik8s/catalog-revision'],
    'MCP catalog revision',
  );
  const listed = await mcpRequest({
    fetcher,
    endpoint: options.endpoint,
    accessToken: options.accessToken,
    sessionId,
    id: 2,
    method: 'tools/list',
    params: {},
  });
  const tools = arrayValue(
    objectValue(listed.body.result, 'MCP tools/list result').tools,
    'MCP tools',
  );
  const tool = tools.map((entry) =>
    requiredString(objectValue(entry, 'MCP tool').name, 'MCP tool name')
  ).find((name) => name === 'create');
  if (!tool) {
    throw new Error(
      `Identity Start MCP discovery did not expose create; received ${tools.length} tools.`,
    );
  }
  const called = await mcpRequest({
    fetcher,
    endpoint: options.endpoint,
    accessToken: options.accessToken,
    sessionId,
    id: 3,
    method: 'tools/call',
    params: {
      name: tool,
      arguments: options.input,
    },
    idempotencyKey: `identity-start-mcp-${randomUUID()}`,
  });
  const result = objectValue(called.body.result, 'MCP tools/call result');
  if (result.isError === true) {
    throw new Error(
      `Identity Start MCP tool returned an application error: ${JSON.stringify(result)}`,
    );
  }
  return Object.freeze({
    sessionId,
    catalogRevision,
    tool,
    result,
  });
}

function identityStartOAuthClient(): ApplicationOAuthClient {
  return {
    apiVersion: 'applik8s.oauth/v1alpha1',
    id: identityStartMcpClientId,
    type: 'service',
    redirectUris: [],
    allowedScopes: [identityStartMcpScope],
    allowedResources: [identityStartMcpResource],
    allowedAudience: [identityStartMcpResource],
    grantTypes: ['client_credentials'],
    requirePkce: false,
    state: 'active',
    revision: 'identity-start-v07',
  };
}

async function mcpRequest(options: {
  readonly fetcher: IdentityStartMcpFetch;
  readonly endpoint: string;
  readonly accessToken: string;
  readonly sessionId?: string;
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
}): Promise<{
  readonly response: Response;
  readonly body: Readonly<Record<string, unknown>>;
}> {
  const response = await options.fetcher(options.endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      ...(options.sessionId
        ? { 'Mcp-Session-Id': options.sessionId }
        : {}),
      ...(options.idempotencyKey
        ? { 'Idempotency-Key': options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: options.id,
      method: options.method,
      params: options.params,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `MCP ${options.method} returned ${response.status}: ${text.slice(0, 2_000)}`,
    );
  }
  const body = objectValue(JSON.parse(text), `MCP ${options.method} response`);
  if (body.error) {
    throw new Error(
      `MCP ${options.method} failed: ${JSON.stringify(body.error)}`,
    );
  }
  return { response, body };
}

function requiredHeader(headers: Headers, name: string): string {
  return requiredString(headers.get(name), name);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function objectValue(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function optionalObject(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}
