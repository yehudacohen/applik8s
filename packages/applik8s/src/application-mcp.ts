import {
  getApplicationOperationContract,
  type ApplicationOperationLike,
} from '@applik8s/client';
import {
  applicationOperationId,
  type ApplicationMcpClientNode,
  type ApplicationMcpServerNode,
  type ApplicationOperationId,
} from '@applik8s/core';
import {
  type ApplicationGraphState,
  addApplicationGraphNode,
} from './application-graph-state.js';
import { kubernetesNameSegment } from './application-identifiers.js';

export type ApplicationMcpToolSelection =
  | ApplicationOperationLike
  | {
    readonly name: string;
    readonly operation: ApplicationOperationLike;
  };

export interface ApplicationMcpServerOptions {
  readonly tools: readonly ApplicationMcpToolSelection[];
  /** Defaults to /__applik8s/mcp/<name>. */
  readonly path?: string;
  /**
   * Canonical public OAuth resource URI. It may be omitted until deployment
   * binds a public ApplicationHost; runtime admission still fails closed until
   * a concrete URI exists.
   */
  readonly resource?: string;
  readonly audience?: string;
  readonly authorizationServers?: readonly string[];
  readonly scopes?: readonly string[];
  readonly sessionLifetimeMs?: number;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes?: number;
}

export interface ApplicationMcpServerBinding {
  readonly kind: 'applicationMcpServer';
  readonly name: string;
  readonly id: string;
  readonly path: string;
  readonly tools: readonly {
    readonly name: string;
    readonly operation: ApplicationOperationLike;
    readonly operationId: ApplicationOperationId;
  }[];
}

export interface ApplicationMcpClientOptions {
  readonly server: string;
  readonly tools: readonly (
    | string
    | { readonly name: string; readonly schemaRevision: string }
  )[];
  readonly audience: string;
  readonly resource?: string;
  readonly credentials: {
    readonly kind: 'applicationSecret';
    readonly name: string;
  };
  readonly timeout: string | number;
  readonly concurrency: number;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes: number;
}

export interface ApplicationMcpClientBinding {
  readonly kind: 'applicationMcpClient';
  readonly name: string;
  readonly id: string;
  readonly server: string;
  readonly tools: readonly string[];
}

export interface ApplicationMcpRegistrar {
  (
    name: string,
    options: ApplicationMcpServerOptions,
  ): ApplicationMcpServerBinding;
  client(
    name: string,
    options: ApplicationMcpClientOptions,
  ): ApplicationMcpClientBinding;
}

export interface ApplicationMcpGraphState extends ApplicationGraphState {
  readonly authorityApplicationName: string;
}

export function applicationMcpRegistrar(
  state: ApplicationMcpGraphState,
): ApplicationMcpRegistrar {
  const register = (
    name: string,
    options: ApplicationMcpServerOptions,
  ): ApplicationMcpServerBinding => {
    const normalizedName = stableName(name, 'MCP server');
    if (options.tools.length === 0) {
      throw new Error(
        `Application MCP server ${normalizedName} requires at least one existing operation handle.`,
      );
    }
    const id = `mcpServer.${kubernetesNameSegment(normalizedName)}`;
    const selected = options.tools.map((selection) => {
      const operation = isAliasedTool(selection)
        ? selection.operation
        : selection;
      const contract = getApplicationOperationContract(operation);
      if (!contract) {
        throw new Error(
          `Application MCP server ${normalizedName} tools must be existing application operation handles.`,
        );
      }
      const publicName = isAliasedTool(selection)
        ? toolName(selection.name)
        : toolName(contract.name);
      return {
        name: publicName,
        operation,
        operationId: canonicalOperationId(contract),
      };
    });
    for (const duplicate of duplicates(selected.map((tool) => tool.name))) {
      throw new Error(
        `Application MCP server ${normalizedName} declares duplicate public tool name ${duplicate}; provide an explicit alias.`,
      );
    }
    for (const duplicate of duplicates(selected.map((tool) => tool.operationId))) {
      throw new Error(
        `Application MCP server ${normalizedName} exposes operation ${duplicate} more than once.`,
      );
    }
    const resource = options.resource
      ? canonicalUri(options.resource, `${normalizedName} resource`)
      : undefined;
    const audience = options.audience
      ? canonicalUri(options.audience, `${normalizedName} audience`)
      : resource;
    if (resource && audience !== resource) {
      throw new Error(
        `Application MCP server ${normalizedName} audience must equal its canonical OAuth resource URI.`,
      );
    }
    const node: ApplicationMcpServerNode = {
      id,
      kind: 'mcpServer',
      name: normalizedName,
      stability: 'stable',
      protocol: {
        preferred: '2025-11-25',
        supported: ['2025-11-25'],
        sdk: '@modelcontextprotocol/sdk@1.30.0',
        extensions: [
          'io.modelcontextprotocol/oauth-client-credentials/v1',
        ],
      },
      path: normalizedMcpPath(
        options.path
          ?? `/__applik8s/mcp/${kubernetesNameSegment(normalizedName)}`,
      ),
      ...(resource ? { resource } : {}),
      ...(audience ? { audience } : {}),
      authorizationServers: (options.authorizationServers ?? []).map(
        (value) => canonicalUri(value, `${normalizedName} authorization server`),
      ),
      scopes: uniqueStrings(options.scopes ?? ['operations:invoke'], 'MCP scopes'),
      tools: selected.map((tool) => ({
        publicName: tool.name,
        operationId: tool.operationId,
        schemaRevision: 'operation',
      })),
      sessions: {
        mode: 'stateful-pinned',
        catalog: 'operation-catalog-revision',
        authorization: 'revalidate-every-call',
        compatibleBindings: 'drain',
        incompatibleBindings: 'reinitialize',
        lifetimeMs: boundedInteger(
          options.sessionLifetimeMs ?? 60 * 60_000,
          'MCP sessionLifetimeMs',
          60_000,
          24 * 60 * 60_000,
        ),
      },
      transport: {
        kind: 'streamable-http',
        protectedResourceMetadata: true,
        tokenPassthrough: 'forbidden',
        maximumRequestBytes: boundedInteger(
          options.maximumRequestBytes ?? 1_048_576,
          'MCP maximumRequestBytes',
          1_024,
          100_000_000,
        ),
        maximumResponseBytes: boundedInteger(
          options.maximumResponseBytes ?? 10_000_000,
          'MCP maximumResponseBytes',
          1_024,
          100_000_000,
        ),
      },
    };
    addApplicationGraphNode(state, node);
    return Object.freeze({
      kind: 'applicationMcpServer',
      name: normalizedName,
      id,
      path: node.path,
      tools: Object.freeze(selected),
    });
  };
  const registrar = register as ApplicationMcpRegistrar;
  registrar.client = (
    name: string,
    options: ApplicationMcpClientOptions,
  ): ApplicationMcpClientBinding => {
    const normalizedName = stableName(name, 'MCP client');
    const id = `mcpClient.${kubernetesNameSegment(normalizedName)}`;
    const server = canonicalUri(options.server, `${normalizedName} server`);
    const resource = canonicalUri(
      options.resource ?? options.server,
      `${normalizedName} resource`,
    );
    const audience = canonicalUri(
      options.audience,
      `${normalizedName} audience`,
    );
    if (server !== resource || audience !== resource) {
      throw new Error(
        `Application MCP client ${normalizedName} server, OAuth resource, and audience must be the same canonical URI.`,
      );
    }
    if (options.tools.length === 0) {
      throw new Error(
        `Application MCP client ${normalizedName} must allowlist at least one external tool.`,
      );
    }
    const tools = options.tools.map((tool) =>
      typeof tool === 'string'
        ? { name: toolName(tool), contentClassification: 'untrusted-external' as const }
        : {
          name: toolName(tool.name),
          schemaRevision: stableName(tool.schemaRevision, 'MCP schema revision'),
          contentClassification: 'untrusted-external' as const,
        });
    for (const duplicate of duplicates(tools.map((tool) => tool.name))) {
      throw new Error(
        `Application MCP client ${normalizedName} allowlists tool ${duplicate} more than once.`,
      );
    }
    const node: ApplicationMcpClientNode = {
      id,
      kind: 'mcpClient',
      name: normalizedName,
      stability: 'stable',
      server,
      audience,
      resource,
      protocol: {
        preferred: '2025-11-25',
        supported: ['2025-11-25'],
        clientCredentials:
          'io.modelcontextprotocol/oauth-client-credentials/v1',
      },
      tools,
      credentials: {
        nodeId: `secret.${kubernetesNameSegment(options.credentials.name)}`,
      },
      egress: {
        timeoutMs: durationMilliseconds(options.timeout, 'MCP client timeout'),
        concurrency: boundedInteger(
          options.concurrency,
          'MCP client concurrency',
          1,
          1_000,
        ),
        maximumRequestBytes: boundedInteger(
          options.maximumRequestBytes ?? 1_048_576,
          'MCP client maximumRequestBytes',
          1_024,
          100_000_000,
        ),
        maximumResponseBytes: boundedInteger(
          options.maximumResponseBytes,
          'MCP client maximumResponseBytes',
          1_024,
          100_000_000,
        ),
        tokenPassthrough: 'forbidden',
        schemaChanges: 'quarantine',
      },
      audit: {
        arguments: 'digest',
        result: 'digest',
        causation: 'required',
      },
    };
    addApplicationGraphNode(state, node);
    return Object.freeze({
      kind: 'applicationMcpClient',
      name: normalizedName,
      id,
      server,
      tools: Object.freeze(tools.map((tool) => tool.name)),
    });
  };
  return registrar;
}

function canonicalOperationId(
  contract: NonNullable<ReturnType<typeof getApplicationOperationContract>>,
): ApplicationOperationId {
  if (contract.id.startsWith('applik8s://')) {
    return contract.id as ApplicationOperationId;
  }
  return applicationOperationId({
    domain: contract.transport === 'query' ? 'queries' : 'models',
    owner: contract.model,
    operation: contract.name,
  });
}

function isAliasedTool(
  value: ApplicationMcpToolSelection,
): value is { readonly name: string; readonly operation: ApplicationOperationLike } {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof Reflect.get(value, 'name') === 'string'
    && typeof Reflect.get(value, 'operation') === 'function',
  );
}

function toolName(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(value)) {
    throw new Error(
      `MCP tool name ${JSON.stringify(value)} must contain 1-128 letters, digits, _, ., or -.`,
    );
  }
  return value;
}

function stableName(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 512
    || /[\s?#\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`${field} must be a stable non-empty identifier.`);
  }
  return normalized;
}

function normalizedMcpPath(value: string): string {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/u.test(value)) {
    throw new Error(
      `MCP path ${JSON.stringify(value)} must be an absolute URL-safe path without query or fragment.`,
    );
  }
  return value;
}

function canonicalUri(value: string, field: string): string {
  const url = new URL(value);
  if (
    url.hash
    || url.username
    || url.password
    || (url.protocol !== 'https:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(
      `${field} must be an HTTPS URI without credentials or fragment outside loopback.`,
    );
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/u, '');
}

function uniqueStrings(
  values: readonly string[],
  field: string,
): readonly string[] {
  const result = [...new Set(values.map((value) => stableName(value, field)))].sort();
  if (result.length === 0) throw new Error(`${field} must not be empty.`);
  return result;
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function durationMilliseconds(value: string | number, field: string): number {
  if (typeof value === 'number') {
    return boundedInteger(value, field, 100, 600_000);
  }
  const match = /^(\d+)(ms|s|m)$/u.exec(value.trim());
  if (!match) {
    throw new Error(`${field} must use an integer ms, s, or m duration.`);
  }
  const magnitude = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  return boundedInteger(magnitude * multiplier, field, 100, 600_000);
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

