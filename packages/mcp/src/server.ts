// typecast-file-boundary: MCP transport decoding validates JSON-RPC and JSON Schema values before restoring protocol contracts.
import { createHash, randomBytes } from 'node:crypto';
import type {
  ApplicationOperationDescriptor,
  ApplicationRequestAdmission,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import {
  type ApplicationMcpCatalogSource,
  ApplicationMcpError,
  type ApplicationMcpInitializeRequest,
  type ApplicationMcpInitializeResult,
  type ApplicationMcpListedTool,
  type ApplicationMcpPinnedTool,
  type ApplicationMcpProtectedResourceMetadata,
  type ApplicationMcpServerDefinition,
  type ApplicationMcpServerRuntimeOptions,
  type ApplicationMcpSession,
  type ApplicationMcpToolBinding,
  type ApplicationMcpToolCallResult,
  applicationMcpProtocolRevision,
} from './contracts.js';

export type {
  ApplicationMcpPlacementDispatch,
  ApplicationMcpPlacementExecutorOptions,
} from './placement.js';
export {
  createApplicationMcpPlacementExecutor,
} from './placement.js';

export interface ApplicationMcpCallOptions {
  readonly admission: ApplicationRequestAdmission;
  readonly sessionId: string;
  readonly idempotencyKey?: string;
  readonly progressToken?: string | number;
  readonly signal?: AbortSignal;
}

export class ApplicationMcpServerRuntime {
  readonly #options: ApplicationMcpServerRuntimeOptions;
  readonly #clock: () => Date;
  readonly #identifier: () => string;

  constructor(options: ApplicationMcpServerRuntimeOptions) {
    this.#options = normalizedServerOptions(options);
    this.#clock = options.clock ?? (() => new Date());
    this.#identifier =
      options.identifier ?? (() => randomBytes(24).toString('base64url'));
  }

  async definition(): Promise<ApplicationMcpServerDefinition> {
    const catalog = await this.#options.catalog.active(this.#options.application);
    return {
      ...this.#options.definition,
      operationCatalogRevision: catalog.revision,
      tools: operationToolBindings(
        this.#options.definition.id,
        catalog.operations,
      ),
    };
  }

  async metadata(): Promise<ApplicationMcpProtectedResourceMetadata> {
    const definition = await this.definition();
    return {
      resource: definition.resource,
      authorization_servers: [...definition.authorizationServers],
      scopes_supported: [...definition.scopes],
      bearer_methods_supported: ['header'],
      resource_name: definition.name,
      applik8s_protocol_revision: definition.protocolRevision,
      applik8s_server_revision: definition.revision,
      applik8s_operation_catalog_revision:
        definition.operationCatalogRevision,
    };
  }

  async initialize(
    request: ApplicationMcpInitializeRequest,
    admission: ApplicationRequestAdmission,
  ): Promise<ApplicationMcpInitializeResult> {
    if (request.protocolVersion !== applicationMcpProtocolRevision) {
      throw new ApplicationMcpError(
        'MCP_PROTOCOL_UNSUPPORTED',
        `MCP protocol ${request.protocolVersion} is unsupported; initialize with ${applicationMcpProtocolRevision}.`,
        400,
        {
          requested: request.protocolVersion,
          supported: applicationMcpProtocolRevision,
        },
      );
    }
    assertAdmissionAudience(admission, this.#options.definition.audience);
    const catalog = await this.#options.catalog.active(
      this.#options.application,
    );
    const bindings = operationToolBindings(
      this.#options.definition.id,
      catalog.operations,
    );
    const pinned: ApplicationMcpPinnedTool[] = [];
    for (const binding of bindings) {
      const operation = catalog.operations.find(
        (candidate) => candidate.id === binding.operationId,
      );
      if (!operation) continue;
      if (
        this.#options.visibility
        && !(await this.#options.visibility.visible({
          operation,
          principal: admission.principal,
          audience: this.#options.definition.audience,
          catalogRevision: catalog.revision,
        }))
      ) {
        continue;
      }
      pinned.push({ ...binding, operation });
    }
    const now = this.#clock();
    const session: ApplicationMcpSession = {
      apiVersion: 'applik8s.mcpSession/v1alpha1',
      id: `mcp_session_${this.#identifier()}`,
      serverId: this.#options.definition.id,
      serverRevision: this.#options.definition.revision,
      protocolRevision: applicationMcpProtocolRevision,
      catalogRevision: catalog.revision,
      principalId: admission.principal.id,
      principalIdentityId: admission.principal.identity.id,
      audience: this.#options.definition.audience,
      authorityRevisionAtInitialization:
        admission.principal.authorityRevision,
      tools: pinned,
      issuedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + this.#options.definition.sessionLifetimeMs,
      ).toISOString(),
      state: 'active',
      version: 1,
    };
    await this.#options.sessions.create(session);
    try {
      await this.#options.catalog.reference?.(
        this.#options.application,
        catalog.revision,
        session.id,
      );
    } catch (error) {
      const created = await this.#options.sessions.get(session.id);
      if (created) {
        await this.#options.sessions.replace(
          { ...created, state: 'closed', version: created.version + 1 },
          created.version,
        );
      }
      throw error;
    }
    return {
      protocolVersion: applicationMcpProtocolRevision,
      capabilities: { tools: { listChanged: true } },
      serverInfo: {
        name: this.#options.definition.name,
        version: this.#options.definition.revision,
      },
      instructions:
        'Tool names and schemas are pinned to this session. Reinitialize when the server reports a catalog migration.',
      sessionId: session.id,
      catalogRevision: session.catalogRevision,
    };
  }

  async listTools(
    sessionId: string,
    admission: ApplicationRequestAdmission,
  ): Promise<readonly ApplicationMcpListedTool[]> {
    const session = await this.#activeSession(sessionId, admission);
    const tools: ApplicationMcpListedTool[] = [];
    for (const tool of session.tools) {
      if (
        this.#options.visibility
        && !(await this.#options.visibility.visible({
          operation: tool.operation,
          principal: admission.principal,
          audience: session.audience,
          catalogRevision: session.catalogRevision,
        }))
      ) {
        continue;
      }
      tools.push({
        name: tool.publicName,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.operation.input.schema,
        outputSchema: tool.operation.output.schema,
        _meta: {
          'applik8s/operation-id': tool.operationId,
          'applik8s/operation-version': tool.operationVersion,
          'applik8s/schema-revision': tool.schemaRevision,
          'applik8s/catalog-revision': session.catalogRevision,
        },
      });
    }
    return tools;
  }

  async callTool(
    name: string,
    args: JsonValue,
    options: ApplicationMcpCallOptions,
  ): Promise<ApplicationMcpToolCallResult> {
    const session = await this.#activeSession(
      options.sessionId,
      options.admission,
    );
    const tool = session.tools.find((candidate) => candidate.publicName === name);
    if (!tool) {
      throw new ApplicationMcpError(
        'MCP_TOOL_UNKNOWN',
        `MCP tool ${name} is not present in pinned catalog ${session.catalogRevision}.`,
        404,
      );
    }
    if (
      this.#options.visibility
      && !(await this.#options.visibility.visible({
        operation: tool.operation,
        principal: options.admission.principal,
        audience: session.audience,
        catalogRevision: session.catalogRevision,
      }))
    ) {
      throw new ApplicationMcpError(
        'MCP_AUTHORIZATION_DENIED',
        `MCP tool ${name} is unavailable to the current principal.`,
        403,
      );
    }
    const validation = validateJsonSchema(tool.operation.input.schema, args);
    if (validation.length > 0) {
      throw new ApplicationMcpError(
        'MCP_INPUT_INVALID',
        `MCP tool ${name} input is invalid: ${validation[0]}.`,
        400,
      );
    }
    const output = await this.#options.executor.execute({
      operation: tool.operation,
      arguments: args,
      admission: options.admission,
      audience: session.audience,
      transport: 'mcp',
      serverId: session.serverId,
      sessionId: session.id,
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      ...(options.progressToken !== undefined
        ? { progressToken: options.progressToken }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const outputValidation = validateJsonSchema(
      tool.operation.output.schema,
      output,
    );
    if (outputValidation.length > 0) {
      throw new ApplicationMcpError(
        'MCP_TOOL_UNAVAILABLE',
        `MCP operation ${tool.operationId} returned an invalid result.`,
        502,
      );
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      ...(isJsonObject(output) ? { structuredContent: output } : {}),
      _meta: {
        'applik8s/operation-id': tool.operationId,
        'applik8s/catalog-revision': session.catalogRevision,
      },
    };
  }

  async close(
    sessionId: string,
    admission: ApplicationRequestAdmission,
  ): Promise<void> {
    const session = await this.#requiredSession(sessionId);
    assertSessionPrincipal(session, admission, this.#clock());
    if (session.state !== 'closed') {
      await this.#options.sessions.replace(
        { ...session, state: 'closed', version: session.version + 1 },
        session.version,
      );
    }
    await this.#options.catalog.release?.(
      this.#options.application,
      session.catalogRevision,
      session.id,
    );
  }

  /**
   * Releases catalog references for sessions that can no longer authenticate.
   * Deployments run this bounded sweep periodically so abandoned sessions
   * cannot prevent an incompatible catalog from retiring forever.
   */
  async reapExpiredSessions(limit = 100): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error('MCP expired-session reap limit must be between 1 and 10000.');
    }
    const now = this.#clock().getTime();
    const sessions = await this.#options.sessions.list({
      serverId: this.#options.definition.id,
      states: ['active', 'draining', 'closed'],
      limit,
    });
    const released: string[] = [];
    for (const session of sessions) {
      if (session.state !== 'closed' && Date.parse(session.expiresAt) > now) {
        continue;
      }
      if (session.state !== 'closed') {
        try {
          await this.#options.sessions.replace(
            { ...session, state: 'closed', version: session.version + 1 },
            session.version,
          );
        } catch {
          continue;
        }
      }
      try {
        await this.#options.catalog.release?.(
          this.#options.application,
          session.catalogRevision,
          session.id,
        );
        released.push(session.id);
      } catch {
        // Closed sessions remain discoverable so the next bounded sweep can
        // retry reference release after a transient catalog-store outage.
      }
    }
    return released;
  }

  async #activeSession(
    sessionId: string,
    admission: ApplicationRequestAdmission,
  ): Promise<ApplicationMcpSession> {
    const session = await this.#requiredSession(sessionId);
    assertSessionPrincipal(session, admission, this.#clock());
    const catalog = await this.#options.catalog.get(
      this.#options.application,
      session.catalogRevision,
    );
    if (!catalog || catalog.state === 'retired') {
      throw new ApplicationMcpError(
        'MCP_CATALOG_REINITIALIZE_REQUIRED',
        `MCP catalog ${session.catalogRevision} is no longer executable; reinitialize and rediscover tools.`,
        409,
      );
    }
    return session;
  }

  async #requiredSession(sessionId: string): Promise<ApplicationMcpSession> {
    if (!sessionId.trim()) {
      throw new ApplicationMcpError(
        'MCP_SESSION_REQUIRED',
        'A stateful MCP session ID is required.',
        400,
      );
    }
    const session = await this.#options.sessions.get(sessionId);
    if (!session || session.serverId !== this.#options.definition.id) {
      throw new ApplicationMcpError(
        'MCP_SESSION_UNAVAILABLE',
        `MCP session ${sessionId} is unavailable.`,
        404,
      );
    }
    return session;
  }
}

export interface ApplicationMcpHttpHandlerOptions {
  readonly runtime: ApplicationMcpServerRuntime;
  readonly admitRequest: (
    request: Request,
    context: {
      readonly audience: string;
      readonly resource: string;
      readonly requiredScopes: readonly string[];
    },
  ) => Promise<ApplicationRequestAdmission>;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes?: number;
}

export function createApplicationMcpHttpHandler(
  options: ApplicationMcpHttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const maximumRequestBytes = boundedBytes(
    options.maximumRequestBytes ?? 1_048_576,
    'maximumRequestBytes',
  );
  const maximumResponseBytes = boundedBytes(
    options.maximumResponseBytes ?? 10_000_000,
    'maximumResponseBytes',
  );
  return async (request) => {
    const definition = await options.runtime.definition();
    const url = new URL(request.url);
    if (
      request.method === 'GET'
      && isProtectedResourceMetadataPath(url.pathname, definition.endpoint)
    ) {
      return jsonResponse(await options.runtime.metadata(), 200, maximumResponseBytes);
    }
    if (url.pathname !== new URL(definition.endpoint).pathname) {
      return new Response('Not Found', { status: 404 });
    }
    if (url.searchParams.has('access_token')) {
      return authenticationError(
        definition,
        'invalid_token',
        'Bearer tokens are accepted only in the Authorization header.',
      );
    }
    let admission: ApplicationRequestAdmission;
    try {
      admission = await options.admitRequest(request, {
        audience: definition.audience,
        resource: definition.resource,
        requiredScopes: definition.scopes,
      });
      assertAdmissionAudience(admission, definition.audience);
    } catch {
      return authenticationError(
        definition,
        'invalid_token',
        'Authentication is required.',
      );
    }
    try {
      if (request.method === 'DELETE') {
        await options.runtime.close(requiredSessionHeader(request), admission);
        return new Response(null, { status: 204 });
      }
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { allow: 'POST, DELETE' },
        });
      }
      const message = await boundedJsonObject(request, maximumRequestBytes);
      const id = message.id;
      const method = requiredJsonRpcMethod(message);
      const params = isJsonObject(message.params) ? message.params : {};
      if (method === 'initialize') {
        const initialized = await options.runtime.initialize(
          {
            protocolVersion: requiredProtocolVersion(params.protocolVersion),
            clientInfo: requiredClientInfo(params.clientInfo),
            ...(isJsonObject(params.capabilities)
              ? { capabilities: params.capabilities }
              : {}),
          },
          admission,
        );
        return jsonRpcResponse(
          id,
          {
            protocolVersion: initialized.protocolVersion,
            capabilities: initialized.capabilities,
            serverInfo: initialized.serverInfo,
            instructions: initialized.instructions,
            _meta: {
              'applik8s/catalog-revision': initialized.catalogRevision,
            },
          },
          maximumResponseBytes,
          {
            'Mcp-Session-Id': initialized.sessionId,
            'MCP-Protocol-Version': initialized.protocolVersion,
          },
        );
      }
      const sessionId = requiredSessionHeader(request);
      if (method === 'ping') {
        await options.runtime.listTools(sessionId, admission);
        return jsonRpcResponse(id, {}, maximumResponseBytes);
      }
      if (method === 'tools/list') {
        const tools = await options.runtime.listTools(sessionId, admission);
        return jsonRpcResponse(id, { tools }, maximumResponseBytes);
      }
      if (method === 'tools/call') {
        const name = requiredProtocolString(params.name, 'tool name', 128);
        const args = params.arguments === undefined ? {} : jsonValue(params.arguments);
        const requestMeta = isJsonObject(params._meta) ? params._meta : undefined;
        const progressToken = requestMeta?.progressToken;
        const result = await options.runtime.callTool(name, args, {
          admission,
          sessionId,
          ...(typeof request.headers.get('Idempotency-Key') === 'string'
            ? {
              idempotencyKey: requiredProtocolString(
                request.headers.get('Idempotency-Key'),
                'idempotency key',
                512,
              ),
            }
            : {}),
          ...(typeof progressToken === 'string' || typeof progressToken === 'number'
            ? {
              progressToken,
            }
            : {}),
          signal: request.signal,
        });
        return jsonRpcResponse(id, result, maximumResponseBytes);
      }
      throw new ApplicationMcpError(
        'MCP_TOOL_UNKNOWN',
        `MCP method ${method} is unsupported.`,
        404,
      );
    } catch (error) {
      return jsonRpcErrorResponse(error, maximumResponseBytes);
    }
  };
}

function normalizedServerOptions(
  options: ApplicationMcpServerRuntimeOptions,
): ApplicationMcpServerRuntimeOptions {
  if (!options.application.trim()) {
    throw new Error('MCP server application identity must not be empty.');
  }
  const endpoint = canonicalMcpUri(options.definition.endpoint, 'endpoint');
  const resource = canonicalMcpUri(options.definition.resource, 'resource');
  if (endpoint !== resource) {
    throw new Error(
      'MCP server endpoint and OAuth resource must use one canonical URI.',
    );
  }
  if (options.definition.audience !== resource) {
    throw new Error('MCP server audience must equal its canonical resource URI.');
  }
  if (
    options.definition.protocolRevision !== applicationMcpProtocolRevision
  ) {
    throw new Error(
      `MCP server must pin protocol ${applicationMcpProtocolRevision}.`,
    );
  }
  if (
    !Number.isSafeInteger(options.definition.sessionLifetimeMs)
    || options.definition.sessionLifetimeMs < 60_000
    || options.definition.sessionLifetimeMs > 24 * 60 * 60_000
  ) {
    throw new Error(
      'MCP sessionLifetimeMs must be between one minute and 24 hours.',
    );
  }
  return {
    ...options,
    definition: {
      ...options.definition,
      endpoint,
      resource,
      audience: resource,
      authorizationServers: options.definition.authorizationServers.map(
        (value) => canonicalMcpUri(value, 'authorization server'),
      ),
      scopes: normalizedUniqueStrings(options.definition.scopes, 'MCP scopes'),
    },
  };
}

function operationToolBindings(
  serverId: string,
  operations: readonly ApplicationOperationDescriptor[],
): readonly ApplicationMcpToolBinding[] {
  const names = new Map<string, string>();
  const bindings: ApplicationMcpToolBinding[] = [];
  for (const operation of operations) {
    for (const transport of operation.transports) {
      if (
        transport.transport !== 'mcp'
        || transport.mcp?.server !== serverId
      ) {
        continue;
      }
      const publicName = requiredToolName(transport.mcp.tool);
      const collision = names.get(publicName);
      if (collision && collision !== operation.id) {
        throw new ApplicationMcpError(
          'MCP_TOOL_AMBIGUOUS',
          `MCP tool ${publicName} maps to both ${collision} and ${operation.id}.`,
          500,
        );
      }
      names.set(publicName, operation.id);
      if (
        transport.mcp.schemaRevision !== operation.input.digest
        && transport.mcp.schemaRevision
          !== `${operation.input.digest}:${operation.output.digest}`
      ) {
        throw new ApplicationMcpError(
          'MCP_TOOL_UNAVAILABLE',
          `MCP tool ${publicName} schema revision does not match operation ${operation.id}.`,
          500,
        );
      }
      bindings.push({
        publicName,
        operationId: operation.id,
        operationVersion: operation.version,
        inputSchemaDigest: operation.input.digest,
        outputSchemaDigest: operation.output.digest,
        schemaRevision: transport.mcp.schemaRevision,
        ...(operation.deprecated ? { deprecated: operation.deprecated } : {}),
      });
    }
  }
  return bindings.sort((left, right) =>
    left.publicName.localeCompare(right.publicName));
}

function assertAdmissionAudience(
  admission: ApplicationRequestAdmission,
  audience: string,
): void {
  if (
    !admission.principal.id
    || !admission.principal.identity.id
    || !admission.principal.audience.includes(audience)
  ) {
    throw new ApplicationMcpError(
      'MCP_AUTHENTICATION_REQUIRED',
      `MCP credential is not admitted for resource ${audience}.`,
      401,
    );
  }
}

function assertSessionPrincipal(
  session: ApplicationMcpSession,
  admission: ApplicationRequestAdmission,
  now: Date,
): void {
  assertAdmissionAudience(admission, session.audience);
  if (
    session.principalId !== admission.principal.id
    || session.principalIdentityId !== admission.principal.identity.id
  ) {
    throw new ApplicationMcpError(
      'MCP_SESSION_IDENTITY_MISMATCH',
      'MCP sessions cannot be transferred between admitted principals.',
      403,
    );
  }
  if (
    session.state !== 'active'
    || Date.parse(session.expiresAt) <= now.getTime()
    || (admission.principal.expiresAt
      && Date.parse(admission.principal.expiresAt) <= now.getTime())
  ) {
    throw new ApplicationMcpError(
      'MCP_SESSION_UNAVAILABLE',
      `MCP session ${session.id} is expired or closed.`,
      401,
    );
  }
}

function validateJsonSchema(
  schema: JsonObject,
  value: JsonValue,
  path = '$',
): readonly string[] {
  const errors: string[] = [];
  if ('const' in schema && stable(schema.const) !== stable(value)) {
    errors.push(`${path} does not equal its const value`);
  }
  if (
    Array.isArray(schema.enum)
    && !schema.enum.some((candidate) => stable(candidate) === stable(value))
  ) {
    errors.push(`${path} is outside its enum`);
  }
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      const matches = branches.filter(
        (branch) =>
          isJsonObject(branch)
          && validateJsonSchema(branch, value, path).length === 0,
      ).length;
      if (
        (keyword === 'anyOf' && matches === 0)
        || (keyword === 'oneOf' && matches !== 1)
      ) {
        errors.push(`${path} does not satisfy ${keyword}`);
      }
      return errors;
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (isJsonObject(branch)) {
        errors.push(...validateJsonSchema(branch, value, path));
      }
    }
  }
  const types = Array.isArray(schema.type)
    ? schema.type.filter((candidate): candidate is string => typeof candidate === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];
  if (
    types.length > 0
    && !types.some((type) => jsonSchemaTypeMatches(type, value))
  ) {
    errors.push(`${path} must be ${types.join(' or ')}`);
    return errors;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} is shorter than minLength`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} is longer than maxLength`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) {
          errors.push(`${path} does not match pattern`);
        }
      } catch {
        errors.push(`${path} uses an invalid runtime pattern`);
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} is below minimum`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} is above maximum`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} has fewer than minItems`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} has more than maxItems`);
    }
    if (isJsonObject(schema.items)) {
      for (const [index, item] of value.entries()) {
        errors.push(...validateJsonSchema(schema.items, item, `${path}[${index}]`));
      }
    }
  }
  if (isJsonObject(value)) {
    const properties = isJsonObject(schema.properties)
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
        (candidate): candidate is string => typeof candidate === 'string',
      )
      : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key];
      if (isJsonObject(property)) {
        errors.push(...validateJsonSchema(property, item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      } else if (isJsonObject(schema.additionalProperties)) {
        errors.push(
          ...validateJsonSchema(
            schema.additionalProperties,
            item,
            `${path}.${key}`,
          ),
        );
      }
    }
  }
  return errors;
}

function jsonSchemaTypeMatches(type: string, value: JsonValue): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'object':
      return isJsonObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function canonicalMcpUri(value: string, field: string): string {
  const url = new URL(value);
  if (
    url.hash
    || url.username
    || url.password
    || (url.protocol !== 'https:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(
      `MCP ${field} must be an HTTPS URI without credentials or fragment outside loopback.`,
    );
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/u, '');
}

function requiredToolName(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(value)) {
    throw new Error(
      `MCP tool name ${JSON.stringify(value)} must contain 1-128 letters, digits, _, ., or -.`,
    );
  }
  return value;
}

function normalizedUniqueStrings(
  values: readonly string[],
  field: string,
): readonly string[] {
  const normalized = [
    ...new Set(
      values.map((value) => requiredProtocolString(value, field, 512)),
    ),
  ].sort();
  if (normalized.length === 0) {
    throw new Error(`${field} must contain at least one value.`);
  }
  return normalized;
}

function requiredProtocolString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > maximumLength
    || [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new ApplicationMcpError(
      'MCP_INPUT_INVALID',
      `MCP ${field} is invalid.`,
      400,
    );
  }
  return value;
}

function requiredProtocolVersion(value: unknown): string {
  return requiredProtocolString(value, 'protocolVersion', 32);
}

function requiredClientInfo(value: unknown): {
  readonly name: string;
  readonly version: string;
} {
  if (!isJsonObject(value)) {
    throw new ApplicationMcpError(
      'MCP_INPUT_INVALID',
      'MCP clientInfo is required.',
      400,
    );
  }
  return {
    name: requiredProtocolString(value.name, 'client name', 128),
    version: requiredProtocolString(value.version, 'client version', 64),
  };
}

function requiredJsonRpcMethod(message: JsonObject): string {
  if (message.jsonrpc !== '2.0') {
    throw new ApplicationMcpError(
      'MCP_INPUT_INVALID',
      'MCP JSON-RPC version must be 2.0.',
      400,
    );
  }
  return requiredProtocolString(message.method, 'JSON-RPC method', 128);
}

function requiredSessionHeader(request: Request): string {
  const session = request.headers.get('Mcp-Session-Id');
  if (!session) {
    throw new ApplicationMcpError(
      'MCP_SESSION_REQUIRED',
      'Mcp-Session-Id is required after initialization.',
      400,
    );
  }
  return requiredProtocolString(session, 'session ID', 512);
}

async function boundedJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<JsonObject> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new ApplicationMcpError(
      'MCP_REQUEST_TOO_LARGE',
      'MCP request exceeds its declared size bound.',
      413,
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new ApplicationMcpError(
      'MCP_REQUEST_TOO_LARGE',
      'MCP request exceeds its size bound.',
      413,
    );
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!isJsonObject(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new ApplicationMcpError(
      'MCP_INPUT_INVALID',
      'MCP request must contain one JSON-RPC object.',
      400,
    );
  }
}

function jsonRpcResponse(
  id: JsonValue | undefined,
  result: unknown,
  maximumBytes: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return jsonResponse(
    { jsonrpc: '2.0', id: id ?? null, result },
    200,
    maximumBytes,
    headers,
  );
}

function jsonRpcErrorResponse(
  error: unknown,
  maximumBytes: number,
): Response {
  const mcp = error instanceof ApplicationMcpError
    ? error
    : new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      'MCP request could not be completed.',
      500,
    );
  const code =
    mcp.status === 404
      ? -32601
      : mcp.status === 400 || mcp.status === 413
        ? -32602
        : -32603;
  return jsonResponse(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code,
        message: mcp.message,
        data: { code: mcp.code, ...(mcp.details ?? {}) },
      },
    },
    mcp.status,
    maximumBytes,
  );
}

function jsonResponse(
  value: unknown,
  status: number,
  maximumBytes: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const body = JSON.stringify(value);
  const size = new TextEncoder().encode(body).byteLength;
  if (size > maximumBytes) {
    const fallback = JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'MCP response exceeds its configured size bound.',
        data: { code: 'MCP_RESPONSE_TOO_LARGE' },
      },
    });
    return new Response(fallback, {
      status: 502,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function authenticationError(
  definition: ApplicationMcpServerDefinition,
  error: string,
  description: string,
): Response {
  const metadata = protectedResourceMetadataUrl(definition);
  const challenge = `Bearer ${[
    `error="${quotedHeaderValue(error)}"`,
    `resource_metadata="${quotedHeaderValue(metadata)}"`,
    `scope="${quotedHeaderValue(definition.scopes.join(' '))}"`,
    `error_description="${quotedHeaderValue(description)}"`,
  ].join(', ')}`;
  return new Response(
    JSON.stringify({
      error: 'unauthorized',
      message: 'Authentication is required.',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'www-authenticate': challenge,
      },
    },
  );
}

function protectedResourceMetadataUrl(
  definition: ApplicationMcpServerDefinition,
): string {
  const endpoint = new URL(definition.endpoint);
  endpoint.pathname = `/.well-known/oauth-protected-resource${endpoint.pathname}`;
  endpoint.search = '';
  return endpoint.toString();
}

function isProtectedResourceMetadataPath(
  pathname: string,
  endpoint: string,
): boolean {
  return pathname
    === `/.well-known/oauth-protected-resource${new URL(endpoint).pathname}`;
}

function quotedHeaderValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function boundedBytes(value: number, field: string): number {
  if (
    !Number.isSafeInteger(value)
    || value < 1024
    || value > 100_000_000
  ) {
    throw new Error(`MCP ${field} must be between 1 KiB and 100 MB.`);
  }
  return value;
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new ApplicationMcpError(
    'MCP_INPUT_INVALID',
    'MCP value is not JSON-compatible.',
    400,
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`;
}

export function applicationMcpSchemaRevision(
  operation: Pick<ApplicationOperationDescriptor, 'input' | 'output'>,
): string {
  return `${operation.input.digest}:${operation.output.digest}`;
}

export function applicationMcpToolName(
  operation: Pick<ApplicationOperationDescriptor, 'id' | 'name'>,
): string {
  const base = operation.name
    .trim()
    .replaceAll(/[^A-Za-z0-9_.-]+/gu, '_')
    .slice(0, 96);
  const suffix = createHash('sha256')
    .update(operation.id)
    .digest('hex')
    .slice(0, 12);
  return requiredToolName(`${base}.${suffix}`);
}

export function createApplicationMcpCatalogSource(
  repository: {
    list(application: string): Promise<readonly {
      readonly revision: string;
      readonly state: 'proposed' | 'staged' | 'active' | 'draining' | 'retired';
      readonly operations: readonly ApplicationOperationDescriptor[];
    }[]>;
    get(application: string, revision: string): Promise<{
      readonly revision: string;
      readonly state: 'proposed' | 'staged' | 'active' | 'draining' | 'retired';
      readonly operations: readonly ApplicationOperationDescriptor[];
    } | undefined>;
    putReference?(
      application: string,
      revision: string,
      kind: 'session',
      referenceId: string,
    ): Promise<void>;
    removeReference?(
      application: string,
      revision: string,
      kind: 'session',
      referenceId: string,
    ): Promise<void>;
  },
): ApplicationMcpCatalogSource {
  const putReference = repository.putReference?.bind(repository);
  const removeReference = repository.removeReference?.bind(repository);
  return {
    async active(application) {
      const active = (await repository.list(application)).find(
        (candidate) => candidate.state === 'active',
      );
      if (!active) {
        throw new ApplicationMcpError(
          'MCP_CATALOG_REINITIALIZE_REQUIRED',
          `Application ${application} has no active operation catalog.`,
          503,
        );
      }
      return active;
    },
    get: (application, revision) => repository.get(application, revision),
    ...(putReference
      ? {
        reference: (
          application: string,
          revision: string,
          sessionId: string,
        ) =>
          putReference(
            application,
            revision,
            'session',
            sessionId,
          ),
      }
      : {}),
    ...(removeReference
      ? {
        release: (
          application: string,
          revision: string,
          sessionId: string,
        ) =>
          removeReference(
            application,
            revision,
            'session',
            sessionId,
          ),
      }
      : {}),
  };
}
