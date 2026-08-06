// typecast-file-boundary: external MCP responses are bounded and structurally validated before protocol contracts are restored.
import { createHash, randomBytes } from 'node:crypto';
import type { JsonObject, JsonValue } from '@applik8s/core';
import {
  ApplicationMcpError,
  applicationMcpProtocolRevision,
  type ApplicationMcpListedTool,
  type ApplicationMcpToolCallResult,
} from './contracts.js';

export interface ApplicationExternalMcpCredential {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly audience: string;
  readonly resource: string;
  readonly expiresAt: string;
  readonly credentialId: string;
  readonly source:
    | 'authorization-code'
    | 'client-credentials-extension'
    | 'workload-credential';
  /**
   * Prevents an inbound user/client bearer token from being reused for egress.
   * The provider must acquire a new credential for this exact server.
   */
  readonly separatelyAcquired: true;
}

export interface ApplicationExternalMcpCredentialProvider {
  acquire(input: {
    readonly serverId: string;
    readonly audience: string;
    readonly resource: string;
    readonly scopes: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<ApplicationExternalMcpCredential>;
}

export interface ApplicationExternalMcpToolPolicy {
  readonly name: string;
  readonly schemaRevision?: string;
}

export interface ApplicationExternalMcpAuditRecord {
  readonly apiVersion: 'applik8s.externalMcpAudit/v1alpha1';
  readonly event:
    | 'initialize'
    | 'discovery'
    | 'call'
    | 'denied'
    | 'quarantined'
    | 'failure';
  readonly serverId: string;
  readonly tool?: string;
  readonly argumentsDigest?: string;
  readonly resultDigest?: string;
  readonly catalogRevision?: string;
  readonly credentialId?: string;
  readonly runCausationId?: string;
  readonly occurredAt: string;
  readonly durationMs: number;
  readonly outcome: 'allowed' | 'denied' | 'failed';
  readonly reason?: string;
}

export interface ApplicationExternalMcpAuditSink {
  record(record: ApplicationExternalMcpAuditRecord): Promise<void>;
}

export interface ApplicationExternalMcpClientOptions {
  readonly id: string;
  readonly endpoint: string;
  readonly audience: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly credentials: ApplicationExternalMcpCredentialProvider;
  readonly tools: readonly ApplicationExternalMcpToolPolicy[];
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly fetch?: ApplicationMcpFetch;
  readonly audit?: ApplicationExternalMcpAuditSink;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

export type ApplicationMcpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ApplicationExternalMcpTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly schemaRevision: string;
  readonly operationId?: string;
  readonly catalogRevision?: string;
  readonly contentClassification: 'untrusted-external';
}

interface ExternalMcpSession {
  readonly id: string;
  readonly protocolRevision: typeof applicationMcpProtocolRevision;
  readonly catalogRevision?: string;
  readonly tools: ReadonlyMap<string, ApplicationExternalMcpTool>;
}

export class ApplicationExternalMcpClient {
  readonly #options: ApplicationExternalMcpClientOptions;
  readonly #fetch: ApplicationMcpFetch;
  readonly #clock: () => Date;
  readonly #identifier: () => string;
  readonly #semaphore: BoundedSemaphore;
  #session: ExternalMcpSession | undefined;

  constructor(options: ApplicationExternalMcpClientOptions) {
    this.#options = normalizedClientOptions(options);
    this.#fetch = options.fetch ?? fetch;
    this.#clock = options.clock ?? (() => new Date());
    this.#identifier =
      options.identifier ?? (() => randomBytes(18).toString('base64url'));
    this.#semaphore = new BoundedSemaphore(options.concurrency);
  }

  async initialize(signal?: AbortSignal): Promise<readonly ApplicationExternalMcpTool[]> {
    const started = this.#clock();
    return this.#semaphore.run(async () => {
      const execution = boundedSignal(
        this.#options.timeoutMs,
        signal,
        'MCP external initialization',
      );
      try {
        const initialized = await this.#request(
          'initialize',
          {
            protocolVersion: applicationMcpProtocolRevision,
            capabilities: {},
            clientInfo: { name: 'applik8s', version: '0.7.0' },
          },
          execution.signal,
        );
        const protocolVersion = protocolString(
          initialized.result?.protocolVersion,
          'initialize protocolVersion',
        );
        if (protocolVersion !== applicationMcpProtocolRevision) {
          throw new ApplicationMcpError(
            'MCP_PROTOCOL_UNSUPPORTED',
            `External MCP server negotiated unsupported protocol ${protocolVersion}.`,
            502,
          );
        }
        const sessionId = protocolString(
          initialized.sessionId,
          'Mcp-Session-Id',
        );
        this.#session = {
          id: sessionId,
          protocolRevision: applicationMcpProtocolRevision,
          ...(protocolStringOptional(
            isJsonObject(initialized.result?._meta)
              ? initialized.result._meta['applik8s/catalog-revision']
              : undefined,
          )
            ? {
              catalogRevision: protocolString(
                (initialized.result?._meta as JsonObject)[
                  'applik8s/catalog-revision'
                ],
                'catalog revision',
              ),
            }
            : {}),
          tools: new Map(),
        };
        const tools = await this.#discover(execution.signal);
        await this.#audit({
          event: 'initialize',
          outcome: 'allowed',
          started,
          ...(this.#session.catalogRevision
            ? { catalogRevision: this.#session.catalogRevision }
            : {}),
        });
        return tools;
      } catch (error) {
        await this.#audit({
          event: 'failure',
          outcome: 'failed',
          reason: publicErrorCode(error),
          started,
        });
        throw error;
      } finally {
        execution.dispose();
      }
    });
  }

  async tools(signal?: AbortSignal): Promise<readonly ApplicationExternalMcpTool[]> {
    if (!this.#session) return this.initialize(signal);
    return [...this.#session.tools.values()];
  }

  async refreshDiscovery(
    signal?: AbortSignal,
  ): Promise<readonly ApplicationExternalMcpTool[]> {
    if (!this.#session) return this.initialize(signal);
    const execution = boundedSignal(
      this.#options.timeoutMs,
      signal,
      'MCP external discovery',
    );
    try {
      return await this.#semaphore.run(() => this.#discover(execution.signal));
    } finally {
      execution.dispose();
    }
  }

  async call(
    name: string,
    args: JsonValue,
    options: {
      readonly runCausationId?: string;
      readonly idempotencyKey?: string;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<ApplicationMcpToolCallResult> {
    const started = this.#clock();
    if (!this.#session) await this.initialize(options.signal);
    return this.#semaphore.run(async () => {
      const execution = boundedSignal(
        this.#options.timeoutMs,
        options.signal,
        `MCP external tool ${name}`,
      );
      const argumentsDigest = digest(args);
      try {
        const session = this.#requiredSession();
        const tool = session.tools.get(name);
        if (!tool) {
          await this.#audit({
            event: 'denied',
            tool: name,
            argumentsDigest,
            outcome: 'denied',
            reason: 'tool-not-allowlisted',
            started,
            ...(options.runCausationId
              ? { runCausationId: options.runCausationId }
              : {}),
          });
          throw new ApplicationMcpError(
            'MCP_TOOL_UNKNOWN',
            `External MCP tool ${name} is not allowlisted in the pinned session.`,
            403,
          );
        }
        const called = await this.#request(
          'tools/call',
          { name, arguments: args },
          execution.signal,
          session.id,
          options.idempotencyKey,
        );
        const result = requiredToolResult(called.result);
        const resultDigest = digest(result);
        await this.#audit({
          event: 'call',
          tool: name,
          argumentsDigest,
          resultDigest,
          outcome: 'allowed',
          started,
          ...(session.catalogRevision
            ? { catalogRevision: session.catalogRevision }
            : {}),
          ...(options.runCausationId
            ? { runCausationId: options.runCausationId }
            : {}),
          ...(called.credentialId
            ? { credentialId: called.credentialId }
            : {}),
        });
        return result;
      } catch (error) {
        await this.#audit({
          event: 'failure',
          tool: name,
          argumentsDigest,
          outcome: 'failed',
          reason: publicErrorCode(error),
          started,
          ...(options.runCausationId
            ? { runCausationId: options.runCausationId }
            : {}),
        });
        throw error;
      } finally {
        execution.dispose();
      }
    });
  }

  async close(signal?: AbortSignal): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const execution = boundedSignal(
      this.#options.timeoutMs,
      signal,
      'MCP external session close',
    );
    try {
      const credential = await this.#credential(execution.signal);
      const response = await this.#fetch(this.#options.endpoint, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          'Mcp-Session-Id': session.id,
          'MCP-Protocol-Version': applicationMcpProtocolRevision,
        },
        signal: execution.signal,
      });
      if (response.status !== 204 && response.status !== 404) {
        throw externalResponseError(response.status);
      }
      this.#session = undefined;
    } finally {
      execution.dispose();
    }
  }

  async #discover(signal: AbortSignal): Promise<readonly ApplicationExternalMcpTool[]> {
    const started = this.#clock();
    const session = this.#requiredSession();
    const response = await this.#request(
      'tools/list',
      {},
      signal,
      session.id,
    );
    const listed = requiredListedTools(response.result);
    const policies = new Map(
      this.#options.tools.map((policy) => [policy.name, policy]),
    );
    const discovered = new Map<string, ApplicationExternalMcpTool>();
    for (const listedTool of listed) {
      const policy = policies.get(listedTool.name);
      if (!policy) continue;
      const schemaRevision =
        protocolStringOptional(
          listedTool._meta?.['applik8s/schema-revision'],
        ) ?? digest({
          input: listedTool.inputSchema,
          output: listedTool.outputSchema ?? {},
        });
      if (
        policy.schemaRevision
        && policy.schemaRevision !== schemaRevision
      ) {
        await this.#audit({
          event: 'quarantined',
          tool: listedTool.name,
          outcome: 'denied',
          reason: 'configured-schema-revision-mismatch',
          started,
        });
        throw new ApplicationMcpError(
          'MCP_EXTERNAL_SCHEMA_CHANGED',
          `External MCP tool ${listedTool.name} does not match configured schema revision ${policy.schemaRevision}.`,
          409,
        );
      }
      const prior = session.tools.get(listedTool.name);
      if (prior && prior.schemaRevision !== schemaRevision) {
        await this.#audit({
          event: 'quarantined',
          tool: listedTool.name,
          outcome: 'denied',
          reason: 'session-schema-revision-changed',
          started,
        });
        throw new ApplicationMcpError(
          'MCP_EXTERNAL_SCHEMA_CHANGED',
          `External MCP tool ${listedTool.name} changed inside a pinned session.`,
          409,
        );
      }
      discovered.set(listedTool.name, {
        name: listedTool.name,
        ...(listedTool.title ? { title: listedTool.title } : {}),
        ...(listedTool.description
          ? { description: listedTool.description }
          : {}),
        inputSchema: listedTool.inputSchema,
        ...(listedTool.outputSchema
          ? { outputSchema: listedTool.outputSchema }
          : {}),
        schemaRevision,
        ...(protocolStringOptional(
          listedTool._meta?.['applik8s/operation-id'],
        )
          ? {
            operationId: protocolString(
              listedTool._meta?.['applik8s/operation-id'],
              'operation ID',
            ),
          }
          : {}),
        ...(protocolStringOptional(
          listedTool._meta?.['applik8s/catalog-revision'],
        )
          ? {
            catalogRevision: protocolString(
              listedTool._meta?.['applik8s/catalog-revision'],
              'catalog revision',
            ),
          }
          : {}),
        contentClassification: 'untrusted-external',
      });
    }
    for (const policy of this.#options.tools) {
      if (!discovered.has(policy.name)) {
        throw new ApplicationMcpError(
          'MCP_TOOL_UNAVAILABLE',
          `Allowlisted external MCP tool ${policy.name} was not discovered.`,
          502,
        );
      }
    }
    this.#session = { ...session, tools: discovered };
    await this.#audit({
      event: 'discovery',
      outcome: 'allowed',
      started,
      ...(session.catalogRevision
        ? { catalogRevision: session.catalogRevision }
        : {}),
    });
    return [...discovered.values()];
  }

  async #request(
    method: string,
    params: JsonObject,
    signal: AbortSignal,
    sessionId?: string,
    idempotencyKey?: string,
  ): Promise<{
    readonly result: JsonObject;
    readonly sessionId?: string;
    readonly credentialId?: string;
  }> {
    const credential = await this.#credential(signal);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: `mcp_${this.#identifier()}`,
      method,
      params,
    });
    if (new TextEncoder().encode(body).byteLength > this.#options.maximumRequestBytes) {
      throw new ApplicationMcpError(
        'MCP_REQUEST_TOO_LARGE',
        'External MCP request exceeds its configured size bound.',
        413,
      );
    }
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${credential.accessToken}`,
      'content-type': 'application/json',
      'MCP-Protocol-Version': applicationMcpProtocolRevision,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (idempotencyKey) {
      headers['Idempotency-Key'] = protocolString(
        idempotencyKey,
        'idempotency key',
      );
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#options.endpoint, {
        method: 'POST',
        headers,
        body,
        signal,
      });
    } catch (error) {
      if (signal.aborted && signal.reason instanceof ApplicationMcpError) {
        throw signal.reason;
      }
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_UNAVAILABLE',
        'External MCP server could not be reached.',
        502,
        { cause: error instanceof Error ? error.name : 'unknown' },
      );
    }
    if (!response.ok) throw externalResponseError(response.status);
    const value = await boundedResponseJson(
      response,
      this.#options.maximumResponseBytes,
    );
    if (isJsonObject(value.error)) {
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_UNAVAILABLE',
        protocolStringOptional(value.error.message)
          ?? 'External MCP server returned a protocol error.',
        502,
      );
    }
    if (!isJsonObject(value.result)) {
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_UNAVAILABLE',
        'External MCP response has no result object.',
        502,
      );
    }
    return {
      result: value.result,
      ...(response.headers.get('Mcp-Session-Id')
        ? { sessionId: response.headers.get('Mcp-Session-Id')! }
        : {}),
      credentialId: credential.credentialId,
    };
  }

  async #credential(signal: AbortSignal): Promise<ApplicationExternalMcpCredential> {
    const credential = await this.#options.credentials.acquire({
      serverId: this.#options.id,
      audience: this.#options.audience,
      resource: this.#options.resource,
      scopes: this.#options.scopes,
      signal,
    });
    if (
      credential.tokenType !== 'Bearer'
      || credential.separatelyAcquired !== true
      || credential.audience !== this.#options.audience
      || credential.resource !== this.#options.resource
      || !credential.accessToken
      || credential.accessToken.length > 32_768
      || Date.parse(credential.expiresAt) <= this.#clock().getTime()
    ) {
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_CREDENTIAL_INVALID',
        `External MCP credential is not a current, separately acquired credential for ${this.#options.resource}.`,
        401,
      );
    }
    return credential;
  }

  #requiredSession(): ExternalMcpSession {
    if (!this.#session) {
      throw new ApplicationMcpError(
        'MCP_SESSION_REQUIRED',
        'External MCP client has not initialized a session.',
        409,
      );
    }
    return this.#session;
  }

  async #audit(input: {
    readonly event: ApplicationExternalMcpAuditRecord['event'];
    readonly outcome: ApplicationExternalMcpAuditRecord['outcome'];
    readonly started: Date;
    readonly tool?: string;
    readonly argumentsDigest?: string;
    readonly resultDigest?: string;
    readonly catalogRevision?: string;
    readonly credentialId?: string;
    readonly runCausationId?: string;
    readonly reason?: string;
  }): Promise<void> {
    if (!this.#options.audit) return;
    const occurredAt = this.#clock();
    await this.#options.audit.record({
      apiVersion: 'applik8s.externalMcpAudit/v1alpha1',
      event: input.event,
      serverId: this.#options.id,
      outcome: input.outcome,
      occurredAt: occurredAt.toISOString(),
      durationMs: Math.max(0, occurredAt.getTime() - input.started.getTime()),
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.argumentsDigest
        ? { argumentsDigest: input.argumentsDigest }
        : {}),
      ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
      ...(input.catalogRevision
        ? { catalogRevision: input.catalogRevision }
        : {}),
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      ...(input.runCausationId
        ? { runCausationId: input.runCausationId }
        : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }
}

function normalizedClientOptions(
  options: ApplicationExternalMcpClientOptions,
): ApplicationExternalMcpClientOptions {
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(options.id)) {
    throw new Error('External MCP client ID is invalid.');
  }
  const endpoint = canonicalUri(options.endpoint, 'endpoint');
  const resource = canonicalUri(options.resource, 'resource');
  if (endpoint !== resource || options.audience !== resource) {
    throw new Error(
      'External MCP endpoint, OAuth resource, and audience must use one canonical URI.',
    );
  }
  if (
    !Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 100
    || options.timeoutMs > 10 * 60_000
  ) {
    throw new Error('External MCP timeoutMs must be between 100 ms and 10 minutes.');
  }
  if (
    !Number.isSafeInteger(options.concurrency)
    || options.concurrency < 1
    || options.concurrency > 1_000
  ) {
    throw new Error('External MCP concurrency must be between 1 and 1000.');
  }
  for (const [field, value] of [
    ['maximumRequestBytes', options.maximumRequestBytes],
    ['maximumResponseBytes', options.maximumResponseBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1_024 || value > 100_000_000) {
      throw new Error(`External MCP ${field} must be between 1 KiB and 100 MB.`);
    }
  }
  const toolNames = new Set<string>();
  for (const tool of options.tools) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(tool.name) || toolNames.has(tool.name)) {
      throw new Error(
        `External MCP tool allowlist contains invalid or duplicate name ${tool.name}.`,
      );
    }
    toolNames.add(tool.name);
  }
  if (toolNames.size === 0) {
    throw new Error('External MCP client must allowlist at least one tool.');
  }
  return {
    ...options,
    endpoint,
    audience: resource,
    resource,
    scopes: [...new Set(options.scopes.map((scope) => protocolString(scope, 'scope')))].sort(),
    tools: options.tools.map((tool) => ({ ...tool })),
  };
}

function requiredListedTools(value: JsonObject): readonly ApplicationMcpListedTool[] {
  if (!Array.isArray(value.tools)) {
    throw new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      'External MCP tools/list response is invalid.',
      502,
    );
  }
  return value.tools.map((tool, index) => {
    if (!isJsonObject(tool) || !isJsonObject(tool.inputSchema)) {
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_UNAVAILABLE',
        `External MCP tool at index ${index} is invalid.`,
        502,
      );
    }
    return {
      name: protocolString(tool.name, 'tool name'),
      ...(protocolStringOptional(tool.title) ? { title: tool.title as string } : {}),
      ...(protocolStringOptional(tool.description)
        ? { description: tool.description as string }
        : {}),
      inputSchema: tool.inputSchema,
      ...(isJsonObject(tool.outputSchema)
        ? { outputSchema: tool.outputSchema }
        : {}),
      ...(isJsonObject(tool._meta)
        && protocolStringOptional(tool._meta['applik8s/operation-id'])
        && protocolStringOptional(tool._meta['applik8s/operation-version'])
        && protocolStringOptional(tool._meta['applik8s/schema-revision'])
        && protocolStringOptional(tool._meta['applik8s/catalog-revision'])
        ? { _meta: {
          'applik8s/operation-id': protocolString(
            tool._meta['applik8s/operation-id'],
            'operation ID',
          ) as NonNullable<ApplicationMcpListedTool['_meta']>['applik8s/operation-id'],
          'applik8s/operation-version': protocolString(
            tool._meta['applik8s/operation-version'],
            'operation version',
          ),
          'applik8s/schema-revision': protocolString(
            tool._meta['applik8s/schema-revision'],
            'schema revision',
          ),
          'applik8s/catalog-revision': protocolString(
            tool._meta['applik8s/catalog-revision'],
            'catalog revision',
          ),
        } }
        : {}),
    };
  });
}

function requiredToolResult(value: JsonObject): ApplicationMcpToolCallResult {
  if (!Array.isArray(value.content)) {
    throw new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      'External MCP tools/call result is invalid.',
      502,
    );
  }
  const content = value.content.map((item, index) => {
    if (
      !isJsonObject(item)
      || item.type !== 'text'
      || typeof item.text !== 'string'
    ) {
      throw new ApplicationMcpError(
        'MCP_EXTERNAL_UNAVAILABLE',
        `External MCP content at index ${index} is unsupported.`,
        502,
      );
    }
    return { type: 'text' as const, text: item.text };
  });
  const meta = isJsonObject(value._meta) ? value._meta : {};
  const operationId = protocolStringOptional(
    meta['applik8s/operation-id'],
  );
  const catalogRevision = protocolStringOptional(
    meta['applik8s/catalog-revision'],
  );
  return {
    content,
    ...(isJsonObject(value.structuredContent)
      ? { structuredContent: value.structuredContent }
      : {}),
    ...(typeof value.isError === 'boolean' ? { isError: value.isError } : {}),
    ...(operationId && catalogRevision
      ? {
        _meta: {
          'applik8s/operation-id':
            operationId as NonNullable<ApplicationMcpToolCallResult['_meta']>['applik8s/operation-id'],
          'applik8s/catalog-revision': catalogRevision,
        },
      }
      : {}),
  };
}

async function boundedResponseJson(
  response: Response,
  maximumBytes: number,
): Promise<JsonObject> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new ApplicationMcpError(
      'MCP_RESPONSE_TOO_LARGE',
      'External MCP response exceeds its declared size bound.',
      502,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      'External MCP response has no body.',
      502,
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ApplicationMcpError(
        'MCP_RESPONSE_TOO_LARGE',
        'External MCP response exceeds its size bound.',
        502,
      );
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(joined));
    if (!isJsonObject(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      'External MCP response is not a JSON object.',
      502,
    );
  }
}

function boundedSignal(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  label: string,
): { readonly signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new ApplicationMcpError(
          'MCP_DEADLINE_EXCEEDED',
          `${label} exceeded its deadline.`,
          504,
        ),
      ),
    timeoutMs,
  );
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    },
  };
}

class BoundedSemaphore {
  readonly #maximum: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(maximum: number) {
    this.#maximum = maximum;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#maximum) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
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
      `External MCP ${field} must be an HTTPS URI without credentials or fragment outside loopback.`,
    );
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/u, '');
}

function externalResponseError(status: number): ApplicationMcpError {
  return new ApplicationMcpError(
    status === 401 || status === 403
      ? 'MCP_EXTERNAL_CREDENTIAL_INVALID'
      : 'MCP_EXTERNAL_UNAVAILABLE',
    status === 401 || status === 403
      ? 'External MCP credential was rejected.'
      : `External MCP server failed with HTTP ${status}.`,
    status === 401 || status === 403 ? status : 502,
  );
}

function protocolString(
  value: unknown,
  field: string,
  maximumLength = 16_384,
): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > maximumLength
    || containsControlCharacter(value)
  ) {
    throw new ApplicationMcpError(
      'MCP_EXTERNAL_UNAVAILABLE',
      `External MCP ${field} is invalid.`,
      502,
    );
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function protocolStringOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function publicErrorCode(error: unknown): string {
  return error instanceof ApplicationMcpError
    ? error.code
    : 'MCP_EXTERNAL_UNAVAILABLE';
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
