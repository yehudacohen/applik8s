// typecast-file-boundary: MCP schemas validate untrusted protocol payloads before restoring typed contracts.
import type {
  ApplicationCatalogRevisionId,
  ApplicationOperationDescriptor,
  ApplicationOperationId,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonObject,
  JsonValue,
} from '@applik8s/core';

/** Stable MCP wire baseline served by Applik8s v0.7. */
export const applicationMcpProtocolRevision = '2025-11-25' as const;

/**
 * An explicit compatibility tuple is emitted into diagnostics and manifests.
 * The newer 2026-07-28 wire era remains an evaluated opt-in, not an inferred
 * consequence of a dependency upgrade.
 */
export const applicationMcpCompatibility = Object.freeze({
  protocolRevision: applicationMcpProtocolRevision,
  supportedWireEras: [applicationMcpProtocolRevision],
  preferredWireEra: applicationMcpProtocolRevision,
  typescriptSdk: '@modelcontextprotocol/sdk@1.30.0',
  clientCredentialsExtension: 'io.modelcontextprotocol/oauth-client-credentials/v1',
  experimentalWireEras: ['2026-07-28'],
} as const);

export type ApplicationMcpProtocolRevision =
  typeof applicationMcpCompatibility.supportedWireEras[number];

export interface ApplicationMcpServerDefinition {
  readonly apiVersion: 'applik8s.mcpServer/v1alpha1';
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly endpoint: string;
  readonly resource: string;
  readonly audience: string;
  readonly authorizationServers: readonly string[];
  readonly scopes: readonly string[];
  readonly protocolRevision: ApplicationMcpProtocolRevision;
  readonly operationCatalogRevision: ApplicationCatalogRevisionId;
  readonly sessionLifetimeMs: number;
  readonly tools: readonly ApplicationMcpToolBinding[];
}

export interface ApplicationMcpToolBinding {
  readonly publicName: string;
  readonly operationId: ApplicationOperationId;
  readonly operationVersion: string;
  readonly inputSchemaDigest: string;
  readonly outputSchemaDigest: string;
  readonly schemaRevision: string;
  readonly title?: string;
  readonly description?: string;
  readonly deprecated?: {
    readonly since: string;
    readonly message: string;
  };
}

export interface ApplicationMcpPinnedTool extends ApplicationMcpToolBinding {
  readonly operation: ApplicationOperationDescriptor;
}

export interface ApplicationMcpSession {
  readonly apiVersion: 'applik8s.mcpSession/v1alpha1';
  readonly id: string;
  readonly serverId: string;
  readonly serverRevision: string;
  readonly protocolRevision: ApplicationMcpProtocolRevision;
  readonly catalogRevision: ApplicationCatalogRevisionId;
  readonly principalId: string;
  readonly principalIdentityId: string;
  readonly audience: string;
  readonly authorityRevisionAtInitialization: string;
  readonly tools: readonly ApplicationMcpPinnedTool[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: 'active' | 'draining' | 'closed';
  readonly version: number;
}

export interface ApplicationMcpSessionStore {
  create(session: ApplicationMcpSession): Promise<ApplicationMcpSession>;
  get(sessionId: string): Promise<ApplicationMcpSession | undefined>;
  replace(
    session: ApplicationMcpSession,
    expectedVersion: number,
  ): Promise<ApplicationMcpSession>;
  list(input: {
    readonly serverId: string;
    readonly states: readonly ApplicationMcpSession['state'][];
    readonly limit: number;
  }): Promise<readonly ApplicationMcpSession[]>;
}

export interface ApplicationMcpCatalogSource {
  active(application: string): Promise<{
    readonly revision: ApplicationCatalogRevisionId;
    readonly operations: readonly ApplicationOperationDescriptor[];
  }>;
  get(application: string, revision: ApplicationCatalogRevisionId): Promise<{
    readonly revision: ApplicationCatalogRevisionId;
    readonly state: 'proposed' | 'staged' | 'active' | 'draining' | 'retired';
    readonly operations: readonly ApplicationOperationDescriptor[];
  } | undefined>;
  reference?(
    application: string,
    revision: ApplicationCatalogRevisionId,
    sessionId: string,
  ): Promise<void>;
  release?(
    application: string,
    revision: ApplicationCatalogRevisionId,
    sessionId: string,
  ): Promise<void>;
}

export interface ApplicationMcpOperationExecutor {
  execute(input: {
    readonly operation: ApplicationOperationDescriptor;
    readonly arguments: JsonValue;
    readonly admission: ApplicationRequestAdmission;
    readonly audience: string;
    readonly transport: 'mcp';
    readonly serverId: string;
    readonly sessionId?: string;
    readonly idempotencyKey?: string;
    readonly progressToken?: string | number;
    readonly signal?: AbortSignal;
  }): Promise<JsonValue>;
}

export interface ApplicationMcpToolVisibility {
  visible(input: {
    readonly operation: ApplicationOperationDescriptor;
    readonly principal: ApplicationPrincipal;
    readonly audience: string;
    readonly catalogRevision: ApplicationCatalogRevisionId;
  }): Promise<boolean>;
}

export interface ApplicationMcpServerRuntimeOptions {
  readonly application: string;
  readonly definition: Omit<
    ApplicationMcpServerDefinition,
    'operationCatalogRevision' | 'tools'
  >;
  readonly catalog: ApplicationMcpCatalogSource;
  readonly sessions: ApplicationMcpSessionStore;
  readonly executor: ApplicationMcpOperationExecutor;
  readonly visibility?: ApplicationMcpToolVisibility;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

export interface ApplicationMcpInitializeRequest {
  readonly protocolVersion: string;
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly capabilities?: JsonObject;
}

export interface ApplicationMcpInitializeResult {
  readonly protocolVersion: ApplicationMcpProtocolRevision;
  readonly capabilities: {
    readonly tools: { readonly listChanged: true };
  };
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly instructions: string;
  readonly sessionId: string;
  readonly catalogRevision: ApplicationCatalogRevisionId;
}

export interface ApplicationMcpListedTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly _meta?: {
    readonly 'applik8s/operation-id': ApplicationOperationId;
    readonly 'applik8s/operation-version': string;
    readonly 'applik8s/schema-revision': string;
    readonly 'applik8s/catalog-revision': ApplicationCatalogRevisionId;
  };
}

export interface ApplicationMcpToolCallResult {
  readonly content: readonly {
    readonly type: 'text';
    readonly text: string;
  }[];
  readonly structuredContent?: JsonObject;
  readonly isError?: boolean;
  readonly _meta?: {
    readonly 'applik8s/operation-id': ApplicationOperationId;
    readonly 'applik8s/catalog-revision': ApplicationCatalogRevisionId;
  };
}

export interface ApplicationMcpProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly ['header'];
  readonly resource_name: string;
  readonly resource_documentation?: string;
  readonly 'applik8s_protocol_revision': ApplicationMcpProtocolRevision;
  readonly 'applik8s_server_revision': string;
  readonly 'applik8s_operation_catalog_revision': ApplicationCatalogRevisionId;
}

export class ApplicationMcpError extends Error {
  constructor(
    readonly code:
      | 'MCP_PROTOCOL_UNSUPPORTED'
      | 'MCP_SESSION_REQUIRED'
      | 'MCP_SESSION_UNAVAILABLE'
      | 'MCP_SESSION_IDENTITY_MISMATCH'
      | 'MCP_CATALOG_REINITIALIZE_REQUIRED'
      | 'MCP_TOOL_UNKNOWN'
      | 'MCP_TOOL_AMBIGUOUS'
      | 'MCP_TOOL_UNAVAILABLE'
      | 'MCP_INPUT_INVALID'
      | 'MCP_AUTHENTICATION_REQUIRED'
      | 'MCP_AUTHORIZATION_DENIED'
      | 'MCP_REQUEST_TOO_LARGE'
      | 'MCP_RESPONSE_TOO_LARGE'
      | 'MCP_DEADLINE_EXCEEDED'
      | 'MCP_EXTERNAL_SCHEMA_CHANGED'
      | 'MCP_EXTERNAL_CREDENTIAL_INVALID'
      | 'MCP_EXTERNAL_UNAVAILABLE',
    message: string,
    readonly status = 400,
    readonly details?: Readonly<Record<string, JsonValue>>,
  ) {
    super(message);
    this.name = 'ApplicationMcpError';
  }
}
