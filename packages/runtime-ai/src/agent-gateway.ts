// typecast-file-boundary: Agent gateway request and response records are validated before typed routing and audit use.
import { createHash } from 'node:crypto';
import {
  applicationCausalPrincipalContext,
  type ApplicationRequestAdmission,
  createApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
  withApplicationAdmissionTraceV1,
} from '@applik8s/core';
import {
  applicationExecutionAdmissionProtocol,
  encodeApplicationExecutionAdmission,
} from '@applik8s/operations';

export interface ApplicationAIAgentGatewayTarget {
  readonly name: string;
  readonly nodeId: string;
  readonly baseUrl: string;
  readonly workloadIdentityId: string;
  readonly serviceIdentityId: string;
  readonly audience: readonly string[];
  readonly timeoutMs: number;
}

export interface ApplicationAIAgentGatewayAuthorization {
  readonly admission: ApplicationRequestAdmission;
  readonly target: ApplicationAIAgentGatewayTarget;
  readonly threadId: string;
  readonly runId: string;
}

export interface ApplicationAIAgentGatewayOptions {
  readonly application: string;
  readonly secret: string;
  readonly targets: readonly ApplicationAIAgentGatewayTarget[];
  readonly authenticate: (
    request: Request,
  ) => ApplicationRequestAdmission | Promise<ApplicationRequestAdmission>;
  readonly authorize: (
    request: ApplicationAIAgentGatewayAuthorization,
  ) => boolean | Promise<boolean>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly maximumRequestBytes?: number;
  readonly maximumAdmissionLifetimeMs?: number;
  /** Server-side diagnostic sink; responses remain deliberately sanitized. */
  readonly onError?: (error: unknown) => void;
}

export interface ApplicationAIAgentGateway {
  handle(request: Request): Promise<Response | undefined>;
}

/**
 * Authenticates a browser-native TanStack AI request, binds it to exactly one
 * agent run, signs a credential-free internal execution admission, and proxies
 * only the bounded request body to the generated agent workload.
 */
export function createApplicationAIAgentGateway(
  options: ApplicationAIAgentGatewayOptions,
): ApplicationAIAgentGateway {
  const application = required(options.application, 'application');
  const targets = validatedTargets(options.targets);
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const maximumRequestBytes = boundedInteger(
    options.maximumRequestBytes ?? 1024 * 1024,
    1_024,
    10 * 1024 * 1024,
    'maximumRequestBytes',
  );
  const maximumLifetimeMs = boundedInteger(
    options.maximumAdmissionLifetimeMs ?? 5 * 60_000,
    1_000,
    5 * 60_000,
    'maximumAdmissionLifetimeMs',
  );

  return {
    async handle(incoming) {
      const url = new URL(incoming.url);
      if (url.pathname !== '/__applik8s/v1/ai/chat') return undefined;
      if (incoming.method !== 'POST' && incoming.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
      }
      try {
        const authenticationRequest = incoming.clone();
        if (incoming.method === 'GET') {
          const threadId = stable(url.searchParams.get('threadId'), 'threadId');
          const target = selectedTargetFromName(
            targets,
            stable(url.searchParams.get('agent'), 'agent'),
          );
          const runId = `hydrate:${threadId}`;
          const admission = await options.authenticate(authenticationRequest);
          assertAdmission(admission, application);
          if (!await options.authorize({ admission, target, threadId, runId })) {
            return json({ error: 'forbidden' }, 403);
          }
          const token = executionAdmission({
            application,
            admission,
            target,
            threadId,
            runId,
            now,
            maximumLifetimeMs,
            secret: options.secret,
            request: incoming,
          });
          return await request(new Request(
            new URL(`/__applik8s/v1/ai/chat?threadId=${encodeURIComponent(threadId)}`, target.baseUrl),
            {
              method: 'GET',
              headers: forwardedHeaders(incoming.headers, token),
              signal: AbortSignal.any([
                incoming.signal,
                AbortSignal.timeout(target.timeoutMs),
              ]),
            },
          ));
        }
        const { source, value } = await boundedJson(
          incoming,
          maximumRequestBytes,
        );
        const body = record(value, 'TanStack AI request');
        const threadId = stable(body.threadId, 'threadId');
        const runId = stable(body.runId, 'runId');
        const target = selectedTarget(targets, body);
        const admission = await options.authenticate(authenticationRequest);
        assertAdmission(admission, application);
        if (!await options.authorize({
          admission,
          target,
          threadId,
          runId,
        })) {
          return json({ error: 'forbidden' }, 403);
        }
        const token = executionAdmission({
          application,
          admission,
          target,
          threadId,
          runId,
          now,
          maximumLifetimeMs,
          secret: options.secret,
          request: incoming,
        });
        const timeout = AbortSignal.timeout(target.timeoutMs);
        try {
          return await request(
            new Request(
              new URL('/__applik8s/v1/ai/chat', target.baseUrl),
              {
                method: 'POST',
                headers: forwardedHeaders(incoming.headers, token),
                body: source,
                signal: AbortSignal.any([incoming.signal, timeout]),
              },
            ),
          );
        } catch {
          if (incoming.signal.aborted) {
            throw gatewayError(
              'request_cancelled',
              499,
              'The caller cancelled the agent request.',
            );
          }
          if (timeout.aborted) {
            throw gatewayError(
              'upstream_timeout',
              504,
              'The agent exceeded its declared timeout.',
            );
          }
          throw gatewayError(
            'upstream_unavailable',
            502,
            'The agent workload is unavailable.',
          );
        }
      } catch (error) {
        if (error instanceof ApplicationAIAgentGatewayError) {
          return json({ error: error.code }, error.status);
        }
        options.onError?.(error);
        return json({ error: 'unauthorized' }, 401);
      }
    },
  };
}

function validatedTargets(
  values: readonly ApplicationAIAgentGatewayTarget[],
): ReadonlyMap<string, ApplicationAIAgentGatewayTarget> {
  if (values.length === 0) {
    throw new Error('Application AI agent gateway requires at least one target.');
  }
  const targets = new Map<string, ApplicationAIAgentGatewayTarget>();
  for (const value of values) {
    const name = stable(value.name, 'target.name');
    stable(value.nodeId, 'target.nodeId');
    stable(value.workloadIdentityId, 'target.workloadIdentityId');
    stable(value.serviceIdentityId, 'target.serviceIdentityId');
    if (value.audience.length === 0) {
      throw new Error(`Application AI agent gateway target ${name} has no audience.`);
    }
    value.audience.forEach((audience) => {
      stable(audience, 'target.audience');
    });
    boundedInteger(value.timeoutMs, 1, 30 * 60_000, 'target.timeoutMs');
    let baseUrl: URL;
    try {
      baseUrl = new URL(value.baseUrl);
    } catch {
      throw new Error(
        `Application AI agent gateway target ${name} has an invalid baseUrl.`,
      );
    }
    if (
      (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:')
      || baseUrl.username
      || baseUrl.password
    ) {
      throw new Error(
        `Application AI agent gateway target ${name} requires an HTTP(S) baseUrl without credentials.`,
      );
    }
    if (targets.has(name)) {
      throw new Error(
        `Application AI agent gateway target ${name} is duplicated.`,
      );
    }
    targets.set(name, Object.freeze({ ...value, name }));
  }
  return targets;
}

function selectedTargetFromName(
  targets: ReadonlyMap<string, ApplicationAIAgentGatewayTarget>,
  name: string,
): ApplicationAIAgentGatewayTarget {
  const target = targets.get(name);
  if (!target) {
    throw gatewayError('agent_unavailable', 404, `Unknown application agent ${name}.`);
  }
  return target;
}

function executionAdmission(input: {
  readonly application: string;
  readonly admission: ApplicationRequestAdmission;
  readonly target: ApplicationAIAgentGatewayTarget;
  readonly threadId: string;
  readonly runId: string;
  readonly now: () => Date;
  readonly maximumLifetimeMs: number;
  readonly secret: string;
  readonly request: Request;
}): string {
  const issuedAt = input.now();
  const principalExpiry = input.admission.principal.expiresAt
    ? Date.parse(input.admission.principal.expiresAt)
    : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(
    issuedAt.getTime() + input.maximumLifetimeMs,
    principalExpiry,
  );
  if (!Number.isFinite(issuedAt.getTime()) || expiresAt <= issuedAt.getTime()) {
    throw gatewayError('unauthorized', 401, 'Agent admission is expired.');
  }
  const executionDigest = digest({
    application: input.application,
    target: input.target.nodeId,
    principal: input.admission.principal.id,
    threadId: input.threadId,
    runId: input.runId,
  });
  const causalPrincipal = applicationCausalPrincipalContext(input.admission.principal);
  const id = `agent-admission:${executionDigest}`;
  const executionId = `agent-run:${executionDigest}`;
  const cancellationRevision = `agent-cancellation:${digest({
    authority: input.admission.principal.authorityRevision,
    target: input.target.nodeId,
    runId: input.runId,
  })}`;
  const correlationId = stableHeader(
    input.request.headers.get('x-applik8s-correlation-id'),
  ) ?? input.threadId;
  const causationId = stableHeader(
    input.request.headers.get('x-applik8s-causation-id'),
  ) ?? input.runId;
  const traceparent = stableHeader(input.request.headers.get('traceparent'));
  const tracestate = stableHeader(input.request.headers.get('tracestate'));
  const baseContext = createApplicationAdmissionContextV1({
    admission: input.admission,
    operation: {
      id: `applik8s://agent/${input.target.nodeId}/execute`,
      transport: 'framework',
    },
    correlationId,
  });
  const tracedContext = traceparent
    ? withApplicationAdmissionTraceV1(baseContext, {
        traceparent,
        ...(tracestate ? { tracestate } : {}),
      })
    : baseContext;
  const context = withApplicationAdmissionExecutionV1(tracedContext, {
    causationId,
    deadline: new Date(expiresAt).toISOString(),
    cancellation: { revision: cancellationRevision },
    delivery: {
      id,
      source: 'applik8s://agent-gateway',
    },
  });
  return encodeApplicationExecutionAdmission(input.secret, {
    apiVersion: applicationExecutionAdmissionProtocol,
    id,
    executionKind: 'agent',
    executionId,
    attempt: 1,
    workloadIdentityId: input.target.workloadIdentityId,
    serviceIdentityId: input.target.serviceIdentityId,
    context,
    admission: input.admission,
    audience: input.target.audience,
    causalGrantIds: [...causalPrincipal.grantIds],
    cancellationRevision,
    binding: {
      agentId: input.target.nodeId,
      threadId: input.threadId,
      runId: input.runId,
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

function stableHeader(value: string | null): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 2_048
    ? normalized
    : undefined;
}

function selectedTarget(
  targets: ReadonlyMap<string, ApplicationAIAgentGatewayTarget>,
  body: Readonly<Record<string, unknown>>,
): ApplicationAIAgentGatewayTarget {
  const forwarded = optionalRecord(body.forwardedProps);
  const applik8s = optionalRecord(forwarded?.applik8s);
  const selected = applik8s?.agent;
  if (selected === undefined && targets.size === 1) {
    const only = targets.values().next().value;
    if (only) return only;
  }
  if (typeof selected !== 'string' || !targets.has(selected)) {
    throw gatewayError(
      'agent_unavailable',
      404,
      'The requested application agent is unavailable.',
    );
  }
  return targets.get(selected)!;
}

async function boundedJson(
  request: Request,
  maximumBytes: number,
): Promise<{ readonly source: string; readonly value: unknown }> {
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > maximumBytes) {
    throw gatewayError(
      'request_too_large',
      413,
      'The agent request exceeded its byte budget.',
    );
  }
  try {
    return { source, value: JSON.parse(source) };
  } catch {
    throw gatewayError(
      'invalid_request',
      400,
      'The agent request is not valid JSON.',
    );
  }
}

function assertAdmission(
  admission: ApplicationRequestAdmission,
  application: string,
): void {
  if (
    !admission?.principal?.id
    || !admission.principal.identity?.id
    || !admission.principal.catalogRevision
    || !admission.principal.authorityRevision
    || !admission.principal.trustedContextDigest
    || !admission.trustedContext
    || typeof admission.trustedContext !== 'object'
    || Array.isArray(admission.trustedContext)
    || !admission.principal.audience.includes(application)
  ) {
    throw gatewayError(
      'unauthorized',
      401,
      'The identity provider returned an incomplete application admission.',
    );
  }
}

function forwardedHeaders(source: Headers, token: string): Headers {
  const headers = new Headers({
    'content-type': source.get('content-type') ?? 'application/json',
    accept: source.get('accept') ?? 'text/event-stream',
    'x-applik8s-execution-admission': token,
  });
  for (const name of ['traceparent', 'tracestate'] as const) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw gatewayError(
      'invalid_request',
      400,
      `${label} must be an object.`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stable(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > 2_048
    || containsControlCharacter(value)
  ) {
    throw gatewayError(
      'invalid_request',
      400,
      `Application AI agent ${label} is invalid.`,
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

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(
      `Application AI agent gateway ${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

type ApplicationAIAgentGatewayErrorCode =
  | 'agent_unavailable'
  | 'invalid_request'
  | 'request_cancelled'
  | 'request_too_large'
  | 'unauthorized'
  | 'upstream_timeout'
  | 'upstream_unavailable';

class ApplicationAIAgentGatewayError extends Error {
  constructor(
    readonly code: ApplicationAIAgentGatewayErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function gatewayError(
  code: ApplicationAIAgentGatewayErrorCode,
  status: number,
  message: string,
): ApplicationAIAgentGatewayError {
  return new ApplicationAIAgentGatewayError(code, status, message);
}

function required(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(
      `Application AI agent gateway ${label} must not be empty.`,
    );
  }
  return value.trim();
}

function json(
  value: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
