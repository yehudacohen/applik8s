import { createHash } from 'node:crypto';
import type {
  ApplicationIdentityKind,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';

export interface ApplicationDeterministicIdentityOptions {
  /** Explicit safety marker: this provider is only for credential-free starter profiles and tests. */
  readonly mode: 'starter';
  readonly application: string;
  readonly subject: string;
  readonly catalogRevision: string;
  readonly authorityRevision: string;
  readonly audience?: readonly string[];
  readonly issuer?: string;
  readonly kind?: Extract<ApplicationIdentityKind, 'human' | 'service' | 'external'>;
  readonly authenticationMethod?: string;
  readonly trustedContext?: Readonly<Record<string, JsonValue>>;
  readonly admittedAt?: string;
  readonly expiresAt?: string;
  readonly sessionId?: string;
}

/**
 * Creates the credential-free starter principal without defining a second
 * principal shape. Dedicated and external profiles must use a real adapter.
 */
export function createDeterministicApplicationPrincipal(
  options: ApplicationDeterministicIdentityOptions,
): ApplicationPrincipal {
  const application = required(options.application, 'application');
  const subject = required(options.subject, 'subject');
  const catalogRevision = required(options.catalogRevision, 'catalogRevision');
  const authorityRevision = required(options.authorityRevision, 'authorityRevision');
  const issuer = required(
    options.issuer ?? `applik8s://${application}/identity/deterministic`,
    'issuer',
  );
  const kind = options.kind ?? 'human';
  const admittedAt = validTimestamp(
    options.admittedAt ?? new Date().toISOString(),
    'admittedAt',
  );
  const expiresAt = options.expiresAt
    ? validTimestamp(options.expiresAt, 'expiresAt')
    : undefined;
  const audience = options.audience ?? [application];
  if (audience.length === 0 || audience.some((value) => !value.trim())) {
    throw new Error(
      'Deterministic identity audience requires at least one non-empty value.',
    );
  }
  return Object.freeze({
    id: `principal:${application}:deterministic:${subject}`,
    identity: Object.freeze({
      id: `identity:deterministic:${subject}`,
      kind,
      issuer,
      subject,
    }),
    kind,
    authenticationMethod:
      options.authenticationMethod ?? 'deterministic-starter',
    audience: Object.freeze([...audience]),
    trustedContextDigest: digestTrustedContext(options.trustedContext ?? {}),
    catalogRevision,
    authorityRevision,
    admittedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(options.sessionId ? { sessionId: required(options.sessionId, 'sessionId') } : {}),
  });
}

export function createDeterministicApplicationAdmission(
  options: ApplicationDeterministicIdentityOptions,
): ApplicationRequestAdmission {
  const trustedContext = Object.freeze({ ...(options.trustedContext ?? {}) });
  return Object.freeze({
    principal: createDeterministicApplicationPrincipal({
      ...options,
      trustedContext,
    }),
    trustedContext,
  });
}

function digestTrustedContext(
  value: Readonly<Record<string, JsonValue>>,
): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function required(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`Deterministic identity ${label} must not be empty.`);
  }
  return value.trim();
}

function validTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Deterministic identity ${label} must be an ISO timestamp.`);
  }
  return value;
}
