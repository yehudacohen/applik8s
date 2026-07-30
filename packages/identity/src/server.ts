import type {
  ApplicationIdentityAccountView,
  ApplicationIdentityFlowView,
  ApplicationIdentityMfaEnrollmentView,
  ApplicationIdentityMfaMethodView,
  ApplicationIdentityPublicError,
  ApplicationIdentitySessionView,
  ApplicationOAuthClientCredential,
  ApplicationOAuthClientView,
  ApplicationOAuthConsentView,
} from './client.js';
import { applicationIdentityHttpProtocol } from './client.js';
import type { ApplicationPreAuthenticationFlowKind } from './contracts.js';

export interface ApplicationIdentityHttpContext {
  readonly request: Request;
  readonly signal: AbortSignal;
}

export interface ApplicationIdentityHttpOperations {
  session(context: ApplicationIdentityHttpContext): Promise<ApplicationIdentitySessionView>;
  beginFlow(
    kind: ApplicationPreAuthenticationFlowKind,
    input: Readonly<Record<string, unknown>>,
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationIdentityFlowView>;
  transitionFlow(
    flowId: string,
    transition: string,
    input: Readonly<Record<string, unknown>>,
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationIdentityFlowView | ApplicationIdentitySessionView>;
  cancelFlow(flowId: string, context: ApplicationIdentityHttpContext): Promise<ApplicationIdentityFlowView>;
  logout(context: ApplicationIdentityHttpContext): Promise<ApplicationIdentitySessionView>;
  account(context: ApplicationIdentityHttpContext): Promise<ApplicationIdentityAccountView>;
  updateAccount(
    input: Readonly<Record<string, unknown>>,
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationIdentityAccountView>;
  beginMfa(
    method: ApplicationIdentityMfaMethodView['kind'],
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationIdentityMfaEnrollmentView>;
  completeMfa(
    enrollmentId: string,
    input: Readonly<Record<string, unknown>>,
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationIdentityAccountView>;
  removeMfa(methodId: string, context: ApplicationIdentityHttpContext): Promise<ApplicationIdentityAccountView>;
  consent(consentId: string, context: ApplicationIdentityHttpContext): Promise<ApplicationOAuthConsentView>;
  decideConsent(
    consentId: string,
    decision: 'approve' | 'deny',
    context: ApplicationIdentityHttpContext,
  ): Promise<{ readonly continuationUri: string }>;
  clients(context: ApplicationIdentityHttpContext): Promise<readonly ApplicationOAuthClientView[]>;
  createClient(
    input: {
      readonly name: string;
      readonly type: ApplicationOAuthClientView['type'];
      readonly redirectUris: readonly string[];
      readonly allowedScopes: readonly string[];
    },
    context: ApplicationIdentityHttpContext,
  ): Promise<ApplicationOAuthClientCredential>;
  rotateClient(clientId: string, context: ApplicationIdentityHttpContext): Promise<ApplicationOAuthClientCredential>;
  revokeClient(clientId: string, context: ApplicationIdentityHttpContext): Promise<ApplicationOAuthClientView>;
}

export interface ApplicationIdentityHttpHandlerOptions {
  readonly operations: ApplicationIdentityHttpOperations;
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  readonly onError?: (
    error: unknown,
    context: ApplicationIdentityHttpContext,
  ) => ApplicationIdentityPublicError | Promise<ApplicationIdentityPublicError>;
}

/** Framework-neutral Request/Response adapter over ordinary application identity operations. */
export function createApplicationIdentityHttpHandler(
  options: ApplicationIdentityHttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const basePath = `/${(options.basePath ?? '__applik8s/v1/identity').replace(/^\/+|\/+$/gu, '')}`;
  const maximumBytes = options.maxRequestBytes ?? 128 * 1024;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1_024 || maximumBytes > 1024 * 1024) {
    throw new Error('Application identity server maxRequestBytes must be between 1 KiB and 1 MiB.');
  }
  return async (request) => {
    const context = { request, signal: request.signal };
    try {
      const url = new URL(request.url);
      const path = url.pathname.startsWith(basePath)
        ? url.pathname.slice(basePath.length).split('/').filter(Boolean).map(decodeURIComponent)
        : [];
      if (path.length === 1 && path[0] === 'session' && request.method === 'GET') {
        return json(await options.operations.session(context));
      }
      if (path.length === 1 && path[0] === 'session' && request.method === 'DELETE') {
        return json(await options.operations.logout(context));
      }
      if (path[0] === 'flows' && path.length === 2 && request.method === 'POST' && isFlowKind(path[1])) {
        return json(await options.operations.beginFlow(path[1], await requestObject(request, maximumBytes), context), 201);
      }
      if (path[0] === 'flows' && path.length === 2 && request.method === 'DELETE') {
        return json(await options.operations.cancelFlow(requiredSegment(path[1]), context));
      }
      if (path[0] === 'flows' && path.length === 4 && path[2] === 'transitions' && request.method === 'POST') {
        return json(await options.operations.transitionFlow(
          requiredSegment(path[1]),
          requiredSegment(path[3]),
          await requestObject(request, maximumBytes),
          context,
        ));
      }
      if (path.length === 1 && path[0] === 'account' && request.method === 'GET') {
        return json(await options.operations.account(context));
      }
      if (path.length === 1 && path[0] === 'account' && request.method === 'PATCH') {
        return json(await options.operations.updateAccount(await requestObject(request, maximumBytes), context));
      }
      if (path[0] === 'account' && path[1] === 'mfa' && path.length === 2 && request.method === 'POST') {
        const body = await requestObject(request, maximumBytes);
        const method = body.method;
        if (!isMfaKind(method)) return publicError('invalid_request', 'The MFA method is invalid.', 400);
        return json(await options.operations.beginMfa(method, context), 201);
      }
      if (path[0] === 'account' && path[1] === 'mfa' && path.length === 3 && request.method === 'POST') {
        return json(await options.operations.completeMfa(
          requiredSegment(path[2]),
          await requestObject(request, maximumBytes),
          context,
        ));
      }
      if (path[0] === 'account' && path[1] === 'mfa' && path.length === 3 && request.method === 'DELETE') {
        return json(await options.operations.removeMfa(requiredSegment(path[2]), context));
      }
      if (path[0] === 'consents' && path.length === 2 && request.method === 'GET') {
        return json(await options.operations.consent(requiredSegment(path[1]), context));
      }
      if (path[0] === 'consents' && path.length === 2 && request.method === 'POST') {
        const decision = (await requestObject(request, maximumBytes)).decision;
        if (decision !== 'approve' && decision !== 'deny') {
          return publicError('invalid_request', 'The consent decision is invalid.', 400);
        }
        return json({
          protocol: applicationIdentityHttpProtocol,
          kind: 'consent-decision',
          ...await options.operations.decideConsent(requiredSegment(path[1]), decision, context),
        });
      }
      if (path.length === 1 && path[0] === 'clients' && request.method === 'GET') {
        return json({
          protocol: applicationIdentityHttpProtocol,
          kind: 'oauth-client-list',
          items: await options.operations.clients(context),
        });
      }
      if (path.length === 1 && path[0] === 'clients' && request.method === 'POST') {
        const body = await requestObject(request, maximumBytes);
        if (!isClientCreateInput(body)) return publicError('invalid_request', 'The OAuth client request is invalid.', 400);
        return json(await options.operations.createClient(body, context), 201);
      }
      if (path[0] === 'clients' && path.length === 3 && path[2] === 'rotate' && request.method === 'POST') {
        return json(await options.operations.rotateClient(requiredSegment(path[1]), context));
      }
      if (path[0] === 'clients' && path.length === 2 && request.method === 'DELETE') {
        return json(await options.operations.revokeClient(requiredSegment(path[1]), context));
      }
      return publicError('invalid_request', 'The identity route does not exist.', 404);
    } catch (error) {
      const publicValue = options.onError
        ? await options.onError(error, context)
        : defaultPublicError(error);
      return json(publicValue, statusFor(publicValue));
    }
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

function publicError(
  code: ApplicationIdentityPublicError['code'],
  message: string,
  status: number,
): Response {
  return json({
    protocol: applicationIdentityHttpProtocol,
    kind: 'error',
    code,
    message,
    retryable: code === 'rate_limited' || code === 'provider_unavailable',
  } satisfies ApplicationIdentityPublicError, status);
}

async function requestObject(request: Request, maximumBytes: number): Promise<Readonly<Record<string, unknown>>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new ApplicationIdentityHttpError('invalid_request', 'The identity request is too large.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new ApplicationIdentityHttpError('invalid_request', 'The identity request is too large.');
  if (bytes.byteLength === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApplicationIdentityHttpError('invalid_request', 'The identity request is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationIdentityHttpError('invalid_request', 'The identity request is invalid.');
  }
  // typecast: the object/array boundary above proves the JSON body is a string-keyed request record.
  return value as Readonly<Record<string, unknown>>;
}

function requiredSegment(value: string | undefined): string {
  if (!value?.trim() || value.length > 512) throw new ApplicationIdentityHttpError('invalid_request', 'The identity request is invalid.');
  return value;
}

function isFlowKind(value: string | undefined): value is ApplicationPreAuthenticationFlowKind {
  return value === 'register' || value === 'login' || value === 'verify' || value === 'recover';
}

function isMfaKind(value: unknown): value is ApplicationIdentityMfaMethodView['kind'] {
  return value === 'totp' || value === 'webauthn' || value === 'recovery-code' || value === 'provider';
}

function isClientCreateInput(value: Readonly<Record<string, unknown>>): value is {
  readonly name: string;
  readonly type: ApplicationOAuthClientView['type'];
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
} {
  return typeof value.name === 'string'
    && (value.type === 'public' || value.type === 'confidential' || value.type === 'service')
    && Array.isArray(value.redirectUris)
    && value.redirectUris.every((item) => typeof item === 'string')
    && Array.isArray(value.allowedScopes)
    && value.allowedScopes.every((item) => typeof item === 'string');
}

export class ApplicationIdentityHttpError extends Error {
  constructor(
    readonly code: ApplicationIdentityPublicError['code'],
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApplicationIdentityHttpError';
  }
}

function defaultPublicError(error: unknown): ApplicationIdentityPublicError {
  const recognized = error instanceof ApplicationIdentityHttpError;
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'error',
    code: recognized ? error.code : 'internal_error',
    message: recognized ? error.message : 'The identity request could not be completed.',
    retryable: recognized && (error.code === 'rate_limited' || error.code === 'provider_unavailable'),
    ...(recognized && error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  };
}

function statusFor(error: ApplicationIdentityPublicError): number {
  switch (error.code) {
    case 'invalid_request': return 400;
    case 'authentication_required': return 401;
    case 'authorization_required': return 403;
    case 'flow_expired':
    case 'flow_consumed':
    case 'continuity_lost':
    case 'conflict': return 409;
    case 'rate_limited': return 429;
    case 'provider_unavailable': return 503;
    case 'internal_error': return 500;
  }
}
