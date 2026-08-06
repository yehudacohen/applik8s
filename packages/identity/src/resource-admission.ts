// typecast-file-boundary: Kubernetes identity resources are schema-validated before admission metadata is interpreted.
import { createHash } from 'node:crypto';
import type {
  ApplicationIdentityReference,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonObject,
} from '@applik8s/core';
import type {
  ApplicationOAuthProtocolProviderAdapter,
  ApplicationOAuthTokenIntrospection,
} from './oauth-contracts.js';

export interface ApplicationOAuthResourceAdmissionContext {
  readonly audience: string;
  readonly resource: string;
  readonly requiredScopes: readonly string[];
}

export interface ApplicationOAuthResourceAdmissionOptions {
  readonly provider: Pick<
    ApplicationOAuthProtocolProviderAdapter,
    'introspectToken'
  >;
  /**
   * Admits provider evidence through the canonical operation-authority
   * runtime. The adapter validates the returned principal; it never constructs
   * an alternate transport-specific principal.
   */
  readonly admitPrincipal: (input: {
    readonly introspection: ApplicationOAuthTokenIntrospection;
    readonly context: ApplicationOAuthResourceAdmissionContext;
    readonly trustedContext: JsonObject;
    readonly trustedContextDigest: string;
    readonly now: Date;
  }) => ApplicationPrincipal | Promise<ApplicationPrincipal>;
  readonly maximumTokenBytes?: number;
  readonly clock?: () => Date;
}

export interface ApplicationOAuthIdentityReferenceOptions {
  /** Exact issuer value asserted by the trusted OAuth provider. */
  readonly issuer: string;
  /** Stable OAuth subject. Client-credential workloads use their client ID. */
  readonly subject: string;
  readonly kind: Extract<
    ApplicationIdentityReference['kind'],
    'human' | 'workload'
  >;
}

/**
 * Derives the canonical identity shared by OAuth admission and static
 * application authority declarations. Issuer participation prevents a client
 * ID issued by one provider from inheriting authority assigned to another.
 */
export function applicationOAuthIdentityReference(
  options: ApplicationOAuthIdentityReferenceOptions,
): ApplicationIdentityReference {
  const issuer = exactOAuthIdentityValue(options.issuer, 'issuer');
  const subject = exactOAuthIdentityValue(options.subject, 'subject');
  const parsedIssuer = new URL(issuer);
  if (
    (parsedIssuer.protocol !== 'https:' && parsedIssuer.protocol !== 'http:')
    || parsedIssuer.username
    || parsedIssuer.password
    || parsedIssuer.search
    || parsedIssuer.hash
  ) {
    throw new Error(
      'OAuth identity issuer must be an absolute HTTP(S) URI without credentials, query, or fragment.',
    );
  }
  const identityDigest = createHash('sha256')
    .update(issuer)
    .update('\0')
    .update(subject)
    .digest('hex');
  return Object.freeze({
    id: `identity:oauth:${identityDigest}`,
    kind: options.kind,
    issuer,
    subject,
  });
}

/**
 * Provider-neutral OAuth bearer admission for protected application resources.
 *
 * Only opaque tokens from the Authorization header are accepted. Provider
 * introspection remains authoritative for revocation, expiry, audience, and
 * scope; unverified JWT payloads and query-string credentials are never read.
 */
export function createApplicationOAuthResourceAdmission(
  options: ApplicationOAuthResourceAdmissionOptions,
): (
  request: Request,
  context: ApplicationOAuthResourceAdmissionContext,
) => Promise<ApplicationRequestAdmission> {
  const maximumTokenBytes = options.maximumTokenBytes ?? 8 * 1024;
  if (
    !Number.isSafeInteger(maximumTokenBytes)
    || maximumTokenBytes < 128
    || maximumTokenBytes > 64 * 1024
  ) {
    throw new Error(
      'OAuth resource maximumTokenBytes must be between 128 bytes and 64 KiB.',
    );
  }
  const clock = options.clock ?? (() => new Date());
  return async (request, rawContext) => {
    const context = normalizedContext(rawContext);
    const token = bearerToken(request, maximumTokenBytes);
    const introspection = await options.provider.introspectToken(token);
    const now = clock();
    assertIntrospection(introspection, context, now);
    const subject = introspection.subject ?? introspection.clientId;
    if (!subject) {
      throw admissionError(
        'OAUTH_TOKEN_IDENTITY_MISSING',
        'The OAuth token has no stable subject or client identity.',
      );
    }
    const trustedContext: JsonObject = {
      oauth: {
        subject,
        scopes: [...introspection.scope].sort(),
        audience: [...introspection.audience].sort(),
        ...(introspection.clientId
          ? { clientId: introspection.clientId }
          : {}),
        ...(introspection.issuer ? { issuer: introspection.issuer } : {}),
        ...(introspection.tokenType
          ? { tokenType: introspection.tokenType }
          : {}),
      },
    };
    const trustedContextDigest = digestJson(trustedContext);
    const principal = await options.admitPrincipal({
      introspection,
      context,
      trustedContext,
      trustedContextDigest,
      now,
    });
    assertPrincipal(
      principal,
      introspection,
      context,
      trustedContextDigest,
      now,
    );
    return Object.freeze({
      principal: Object.freeze({
        ...principal,
        audience: Object.freeze([...principal.audience]),
      }),
      trustedContext: Object.freeze(trustedContext),
    });
  };
}

function bearerToken(request: Request, maximumBytes: number): string {
  const url = new URL(request.url);
  if (url.searchParams.has('access_token')) {
    throw admissionError(
      'OAUTH_TOKEN_LOCATION_INVALID',
      'OAuth bearer tokens are accepted only in the Authorization header.',
    );
  }
  const authorization = request.headers.get('authorization');
  const match = /^Bearer ([^\s,]+)$/u.exec(authorization ?? '');
  if (!match?.[1]) {
    throw admissionError(
      'OAUTH_AUTHENTICATION_REQUIRED',
      'A single OAuth Bearer credential is required.',
    );
  }
  if (new TextEncoder().encode(match[1]).byteLength > maximumBytes) {
    throw admissionError(
      'OAUTH_TOKEN_TOO_LARGE',
      'The OAuth bearer credential exceeds the configured size bound.',
    );
  }
  return match[1];
}

function exactOAuthIdentityValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048) {
    throw new Error(`OAuth identity ${label} must be a non-empty bounded string.`);
  }
  return normalized;
}

function normalizedContext(
  context: ApplicationOAuthResourceAdmissionContext,
): ApplicationOAuthResourceAdmissionContext {
  const resource = canonicalUri(context.resource, 'resource');
  const audience = canonicalUri(context.audience, 'audience');
  if (resource !== audience) {
    throw new Error(
      'OAuth protected-resource audience must equal its canonical resource URI.',
    );
  }
  const requiredScopes = [
    ...new Set(context.requiredScopes.map((scope) => required(scope, 'scope'))),
  ].sort();
  if (requiredScopes.length === 0) {
    throw new Error('OAuth protected resource requires at least one scope.');
  }
  return { resource, audience, requiredScopes };
}

function assertIntrospection(
  value: ApplicationOAuthTokenIntrospection,
  context: ApplicationOAuthResourceAdmissionContext,
  now: Date,
): void {
  if (!value.active) {
    throw admissionError(
      'OAUTH_TOKEN_INACTIVE',
      'The OAuth token is inactive or revoked.',
    );
  }
  if (
    value.expiresAt !== undefined
    && (!Number.isFinite(value.expiresAt)
      || value.expiresAt * 1_000 <= now.getTime())
  ) {
    throw admissionError('OAUTH_TOKEN_EXPIRED', 'The OAuth token has expired.');
  }
  const audience = new Set(value.audience.map(canonicalAudience));
  if (!audience.has(context.resource) || !audience.has(context.audience)) {
    throw admissionError(
      'OAUTH_AUDIENCE_DENIED',
      'The OAuth token is not bound to this protected resource.',
    );
  }
  const scopes = new Set(value.scope);
  const missing = context.requiredScopes.filter((scope) => !scopes.has(scope));
  if (missing.length > 0) {
    throw admissionError(
      'OAUTH_SCOPE_DENIED',
      `The OAuth token is missing required scope ${missing[0]}.`,
    );
  }
}

function assertPrincipal(
  principal: ApplicationPrincipal,
  introspection: ApplicationOAuthTokenIntrospection,
  context: ApplicationOAuthResourceAdmissionContext,
  trustedContextDigest: string,
  now: Date,
): void {
  const subject = introspection.subject ?? introspection.clientId;
  if (
    !principal.id
    || !principal.identity.id
    || principal.identity.subject !== subject
    || (introspection.issuer
      && principal.identity.issuer !== introspection.issuer)
    || !principal.catalogRevision
    || !principal.authorityRevision
    || principal.trustedContextDigest !== trustedContextDigest
    || !principal.audience.includes(context.audience)
    || (introspection.clientId
      && principal.clientId !== introspection.clientId)
    || (principal.expiresAt
      && Date.parse(principal.expiresAt) <= now.getTime())
  ) {
    throw admissionError(
      'OAUTH_PRINCIPAL_INVALID',
      'Canonical principal admission does not match OAuth evidence.',
    );
  }
}

function canonicalUri(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.hash
    || url.username
    || url.password
    || (url.protocol !== 'https:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(
      `OAuth ${label} must be an HTTPS URI without credentials or fragment outside loopback.`,
    );
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/u, '');
}

function canonicalAudience(value: string): string {
  try {
    return canonicalUri(value, 'token audience');
  } catch {
    return value;
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /\s/u.test(normalized)) {
    throw new Error(`OAuth ${label} must be a stable non-empty identifier.`);
  }
  return normalized;
}

function digestJson(value: JsonObject): string {
  return createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export type ApplicationOAuthResourceAdmissionErrorCode =
  | 'OAUTH_AUTHENTICATION_REQUIRED'
  | 'OAUTH_TOKEN_LOCATION_INVALID'
  | 'OAUTH_TOKEN_TOO_LARGE'
  | 'OAUTH_TOKEN_INACTIVE'
  | 'OAUTH_TOKEN_EXPIRED'
  | 'OAUTH_TOKEN_IDENTITY_MISSING'
  | 'OAUTH_AUDIENCE_DENIED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_PRINCIPAL_INVALID';

export class ApplicationOAuthResourceAdmissionError extends Error {
  constructor(
    readonly code: ApplicationOAuthResourceAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationOAuthResourceAdmissionError';
  }
}

function admissionError(
  code: ApplicationOAuthResourceAdmissionErrorCode,
  message: string,
): ApplicationOAuthResourceAdmissionError {
  return new ApplicationOAuthResourceAdmissionError(code, message);
}
