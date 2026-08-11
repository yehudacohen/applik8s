// typecast-file-boundary: Agent gateway request and response records are validated before typed routing and audit use.
import { createHash } from 'node:crypto';
import {
  applicationCausalPrincipalContext,
  type ApplicationRequestAdmission,
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
      if (incoming.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      }
      try {
        const authenticationRequest = incoming.clone();
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
        const issuedAt = now();
        const principalExpiry = admission.principal.expiresAt
          ? Date.parse(admission.principal.expiresAt)
          : Number.POSITIVE_INFINITY;
        const expiresAt = Math.min(
          issuedAt.getTime() + maximumLifetimeMs,
          principalExpiry,
        );
        if (!Number.isFinite(issuedAt.getTime()) || expiresAt <= issuedAt.getTime()) {
          return json({ error: 'unauthorized' }, 401);
        }
        const binding = {
          agentId: target.nodeId,
          threadId,
          runId,
        };
        const executionDigest = digest({
          application,
          target: target.nodeId,
          principal: admission.principal.id,
          threadId,
          runId,
        });
        const causalPrincipal = applicationCausalPrincipalContext(
          admission.principal,
        );
        const token = encodeApplicationExecutionAdmission(options.secret, {
          apiVersion: applicationExecutionAdmissionProtocol,
          id: `agent-admission:${executionDigest}`,
          executionKind: 'agent',
          executionId: `agent-run:${executionDigest}`,
          attempt: 1,
          workloadIdentityId: target.workloadIdentityId,
          serviceIdentityId: target.serviceIdentityId,
          admission,
          audience: target.audience,
          causalGrantIds: [...causalPrincipal.grantIds],
          cancellationRevision:
            `agent-cancellation:${digest({
              authority: admission.principal.authorityRevision,
              target: target.nodeId,
              runId,
            })}`,
          binding,
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
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
