// typecast-file-boundary: the HTTP provider boundary validates protocol envelopes before narrowing them to typed capability requests and results.
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApplicationResourceRef } from '@applik8s/core';
import type {
  ApplicationAgentHarnessProvider,
  ApplicationAgentHarnessRequest,
  ApplicationCodeWorkspaceLease,
  ApplicationCodeWorkspaceLeaseRequest,
  ApplicationCodeWorkspaceProvider,
  ApplicationCodeWorkspaceReleaseRequest,
  ApplicationProcessRunnerProvider,
  ApplicationSourceRepositoryProvider,
} from './contracts.js';
import type { ApplicationCodeAgentRuntimeProviders } from './runtime.js';
import { bindCodeAgentProviderRuntime } from './runtime-contract.js';

export interface ApplicationCodeAgentHttpClientOptions {
  readonly endpoint: string;
  /** Local/test credential. It is never serialized into a provider runtime binding. */
  readonly authorization?: string;
  /** Production credential projected into the application runtime from a Secret. */
  readonly authorizationSecret?: {
    readonly secret: ApplicationResourceRef;
    readonly key: string;
  };
  readonly fetch?: typeof globalThis.fetch;
}

export interface ApplicationCodeAgentHttpServerOptions {
  readonly providers: ApplicationCodeAgentRuntimeProviders;
  readonly authorization: string;
  readonly host?: '127.0.0.1' | '0.0.0.0';
  readonly port?: number;
  readonly maximumRequestBytes?: number;
}

export interface ApplicationCodeAgentHttpServer {
  readonly server: Server;
  readonly origin: string;
  close(): Promise<void>;
}

export function createHttpCodeAgentProviders(
  options: ApplicationCodeAgentHttpClientOptions,
): ApplicationCodeAgentRuntimeProviders {
  const endpoint = normalizedEndpoint(options.endpoint);
  const request = options.fetch ?? globalThis.fetch;
  const invoke = <T>(path: string, body: object): Promise<T> => httpInvoke(
    request,
    endpoint,
    path,
    authorization(options),
    body,
  );
  const harness: ApplicationAgentHarnessProvider = {
    provider: 'http-agent-harness', kind: 'agent-harness-http', mode: 'live',
    run: input => invoke('/v1/harness/run', input),
    cancel: input => invoke('/v1/harness/cancel', input),
  };
  const workspace: ApplicationCodeWorkspaceProvider = {
    provider: 'http-code-workspace', kind: 'code-workspace-http', mode: 'live' as const,
    lease: (input: ApplicationCodeWorkspaceLeaseRequest) => invoke<ApplicationCodeWorkspaceLease>('/v1/workspace/lease', input),
    release: (input: ApplicationCodeWorkspaceReleaseRequest) => invoke<{ readonly released: boolean }>('/v1/workspace/release', input),
  };
  const repository: ApplicationSourceRepositoryProvider = {
    provider: 'http-source-repository', kind: 'source-repository-http', mode: 'live',
    inspect: input => invoke('/v1/repository/inspect', input),
    apply: input => invoke('/v1/repository/apply', input),
  };
  const process: ApplicationProcessRunnerProvider = {
    provider: 'http-process-runner', kind: 'process-runner-http', mode: 'live',
    run: input => invoke('/v1/process/run', input),
  };
  if (!options.fetch && options.authorizationSecret) {
    const runtime = {
      env: {
        APPLIK8S_AGENT_HARNESS_KIND: 'http',
        APPLIK8S_CODE_AGENT_PROVIDER_ENDPOINT: endpoint.href,
      },
      secretEnv: {
        APPLIK8S_CODE_AGENT_PROVIDER_AUTHORIZATION: options.authorizationSecret,
      },
    } as const;
    bindCodeAgentProviderRuntime(harness, 'harness', runtime);
    bindCodeAgentProviderRuntime(workspace, 'workspace', runtime);
    bindCodeAgentProviderRuntime(repository, 'repository', runtime);
    bindCodeAgentProviderRuntime(process, 'process', runtime);
  }
  return { harness, workspace, repository, process };
}

export async function createCodeAgentProviderHttpServer(
  options: ApplicationCodeAgentHttpServerOptions,
): Promise<ApplicationCodeAgentHttpServer> {
  const token = boundedAuthorization(options.authorization);
  const maximumRequestBytes = boundedInteger(options.maximumRequestBytes ?? 12_000_000, 1_024, 20_000_000);
  const server = createServer((request, response) => void serve(request, response, options.providers, token, maximumRequestBytes));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Code-agent provider server did not bind a TCP port.');
  const host = options.host ?? '127.0.0.1';
  return {
    server,
    origin: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${(address as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function serve(
  request: IncomingMessage,
  response: ServerResponse,
  providers: ApplicationCodeAgentRuntimeProviders,
  token: string,
  maximumRequestBytes: number,
): Promise<void> {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      return json(response, 200, { ready: true });
    }
    if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' });
    if (!authorized(request.headers.authorization, token)) return json(response, 403, { error: 'forbidden' });
    const body = await requestObject(request, maximumRequestBytes);
    let result: unknown;
    switch (request.url) {
      case '/v1/harness/run': result = await providers.harness.run(body as unknown as ApplicationAgentHarnessRequest); break;
      case '/v1/harness/cancel': result = await providers.harness.cancel(body as never); break;
      case '/v1/workspace/lease': result = await providers.workspace.lease(body as unknown as ApplicationCodeWorkspaceLeaseRequest); break;
      case '/v1/workspace/release': result = await providers.workspace.release(body as unknown as ApplicationCodeWorkspaceReleaseRequest); break;
      case '/v1/repository/inspect': result = await providers.repository.inspect(body as never); break;
      case '/v1/repository/apply': result = await providers.repository.apply(body as never); break;
      case '/v1/process/run': result = await providers.process.run(body as never); break;
      default: return json(response, 404, { error: 'not_found' });
    }
    return json(response, 200, result);
  } catch (cause) {
    return json(response, 400, {
      error: 'request_rejected',
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function httpInvoke<T>(
  request: typeof globalThis.fetch,
  endpoint: URL,
  path: string,
  token: string,
  body: object,
): Promise<T> {
  const response = await request(new URL(path, endpoint), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === 'object' && typeof Reflect.get(value, 'message') === 'string'
      ? Reflect.get(value, 'message')
      : `HTTP ${response.status}`;
    throw new Error(`Code-agent provider ${path} rejected the request: ${message}.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Code-agent provider ${path} returned an invalid response envelope.`);
  }
  return value as T;
}

async function requestObject(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maximumBytes) throw new Error('Code-agent provider request exceeded its byte bound.');
    chunks.push(value);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Code-agent provider request must be a JSON object.');
  return value as Record<string, unknown>;
}

function authorized(header: string | undefined, token: string): boolean {
  const candidate = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function authorization(options: ApplicationCodeAgentHttpClientOptions): string {
  return boundedAuthorization(options.authorization ?? process.env.APPLIK8S_CODE_AGENT_PROVIDER_AUTHORIZATION ?? '');
}

function boundedAuthorization(value: string): string {
  if (value.length < 32 || value.length > 4_096) throw new Error('Code-agent provider authorization must contain 32 to 4096 characters.');
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Expected an integer between ${minimum} and ${maximum}.`);
  return value;
}

function normalizedEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('Code-agent provider endpoint must use HTTP(S).');
  endpoint.pathname = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`;
  return endpoint;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
