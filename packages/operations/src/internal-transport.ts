// typecast-file-boundary: signed internal invocation payloads are decoded only
// after HMAC verification and full receipt/principal/identity validation.
import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import type {
  ApplicationAuthorizationReceipt,
  ApplicationOperationId,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import { validateApplicationAuthorizationReceipt } from '@applik8s/core';

export const applicationInternalOperationProtocol =
  'applik8s.internalOperation/v1alpha1' as const;

export interface ApplicationInternalOperationInvocation {
  readonly apiVersion: typeof applicationInternalOperationProtocol;
  readonly id: string;
  readonly operationId: ApplicationOperationId;
  readonly operationVersion: string;
  readonly inputDigest: string;
  readonly audience: string;
  readonly source: {
    readonly transport: 'mcp' | 'http' | 'workflow' | 'event' | 'control-plane';
    readonly workloadId: string;
    readonly sessionId?: string;
  };
  readonly admission: ApplicationRequestAdmission;
  readonly authorizationReceipt: ApplicationAuthorizationReceipt;
  readonly idempotencyKey?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ApplicationInternalOperationVerification {
  readonly operationId: ApplicationOperationId;
  readonly operationVersion?: string;
  readonly inputDigest: string;
  readonly audience: string;
  readonly now?: Date;
  readonly maximumLifetimeMs?: number;
  readonly maximumTokenBytes?: number;
}

export function applicationInternalOperationInputDigest(value: JsonValue): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex')}`;
}

/**
 * Encodes authority evidence for one internal placement hop.
 *
 * The envelope contains no provider credential. Workloads verify it and
 * execute the already-registered operation under the attached receipt.
 */
export function encodeApplicationInternalOperationInvocation(
  secret: string,
  invocation: ApplicationInternalOperationInvocation,
): string {
  const normalizedSecret = transportSecret(secret);
  validateInvocation(invocation, {
    operationId: invocation.operationId,
    operationVersion: invocation.operationVersion,
    inputDigest: invocation.inputDigest,
    audience: invocation.audience,
    now: new Date(invocation.issuedAt),
    maximumLifetimeMs: 60_000,
  });
  assertNoCredentialMaterial(invocation.admission.trustedContext);
  const payload = Buffer.from(
    canonicalJson(invocation),
    'utf8',
  ).toString('base64url');
  const signature = sign(normalizedSecret, payload);
  return `${payload}.${signature}`;
}

export function decodeApplicationInternalOperationInvocation(
  secret: string,
  token: string,
  expected: ApplicationInternalOperationVerification,
): ApplicationInternalOperationInvocation {
  const normalizedSecret = transportSecret(secret);
  const maximumBytes = expected.maximumTokenBytes ?? 256 * 1024;
  if (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1_024
    || maximumBytes > 1024 * 1024
  ) {
    throw new Error(
      'Internal operation maximumTokenBytes must be between 1 KiB and 1 MiB.',
    );
  }
  if (new TextEncoder().encode(token).byteLength > maximumBytes) {
    throw transportError(
      'INTERNAL_INVOCATION_TOO_LARGE',
      'The internal operation invocation exceeds its size bound.',
    );
  }
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) {
    throw transportError(
      'INTERNAL_INVOCATION_INVALID',
      'The internal operation invocation is malformed.',
    );
  }
  const calculated = sign(normalizedSecret, payload);
  if (!safeEqual(signature, calculated)) {
    throw transportError(
      'INTERNAL_INVOCATION_INVALID',
      'The internal operation invocation signature is invalid.',
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw transportError(
      'INTERNAL_INVOCATION_INVALID',
      'The internal operation invocation payload is invalid.',
    );
  }
  const invocation = decoded as ApplicationInternalOperationInvocation;
  validateInvocation(invocation, expected);
  assertNoCredentialMaterial(invocation.admission.trustedContext);
  return structuredClone(invocation);
}

function validateInvocation(
  invocation: ApplicationInternalOperationInvocation,
  expected: ApplicationInternalOperationVerification,
): void {
  const receiptDiagnostics = validateApplicationAuthorizationReceipt(
    invocation.authorizationReceipt,
  );
  const principal = invocation.admission?.principal;
  const receipt = invocation.authorizationReceipt;
  const issuedAt = Date.parse(invocation.issuedAt);
  const expiresAt = Date.parse(invocation.expiresAt);
  const now = (expected.now ?? new Date()).getTime();
  const maximumLifetime = expected.maximumLifetimeMs ?? 60_000;
  if (
    !Number.isSafeInteger(maximumLifetime)
    || maximumLifetime < 1_000
    || maximumLifetime > 5 * 60_000
  ) {
    throw new Error(
      'Internal operation maximumLifetimeMs must be between one second and five minutes.',
    );
  }
  if (
    invocation.apiVersion !== applicationInternalOperationProtocol
    || !stable(invocation.id)
    || invocation.operationId !== expected.operationId
    || (expected.operationVersion
      && invocation.operationVersion !== expected.operationVersion)
    || invocation.inputDigest !== expected.inputDigest
    || invocation.audience !== expected.audience
    || !stable(invocation.source?.workloadId)
    || !['mcp', 'http', 'workflow', 'event', 'control-plane'].includes(
      invocation.source?.transport,
    )
    || !principal?.id
    || !principal.identity?.id
    || !invocation.admission.trustedContext
    || typeof invocation.admission.trustedContext !== 'object'
    || Array.isArray(invocation.admission.trustedContext)
    || receiptDiagnostics.length > 0
    || receipt.operationId !== invocation.operationId
    || receipt.operationVersion !== invocation.operationVersion
    || receipt.inputDigest !== invocation.inputDigest
    || receipt.audience !== invocation.audience
    || receipt.transport !== invocation.source.transport
    || receipt.principal.id !== principal.id
    || receipt.principal.identity.id !== principal.identity.id
    || receipt.catalogRevision !== principal.catalogRevision
    || receipt.authorityRevision !== principal.authorityRevision
    || receipt.trustedContextDigest !== principal.trustedContextDigest
    || !principal.audience.includes(invocation.audience)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > maximumLifetime
    || now < issuedAt - 5_000
    || now >= expiresAt
    || (principal.expiresAt
      && Date.parse(principal.expiresAt) <= now)
    || (receipt.expiresAt
      && Date.parse(receipt.expiresAt) <= now)
  ) {
    throw transportError(
      'INTERNAL_INVOCATION_INVALID',
      'The internal operation invocation does not match its authority evidence.',
    );
  }
}

function assertNoCredentialMaterial(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (/^(?:Bearer|Basic)\s+/iu.test(value)) {
      throw transportError(
        'INTERNAL_TOKEN_PASSTHROUGH_FORBIDDEN',
        `Credential material is forbidden in internal operation context at ${path}.`,
      );
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoCredentialMaterial(entry, `${path}[${index}]`);
    });
    return;
  }
  for (const [key, entry] of Object.entries(
    value as Readonly<Record<string, JsonValue>>,
  )) {
    if (
      /^(?:access_?token|refresh_?token|authorization|cookie|client_?secret|password|api_?key)$/iu.test(
        key,
      )
    ) {
      throw transportError(
        'INTERNAL_TOKEN_PASSTHROUGH_FORBIDDEN',
        `Credential field ${path}.${key} is forbidden in internal operation context.`,
      );
    }
    assertNoCredentialMaterial(entry, `${path}.${key}`);
  }
}

function transportSecret(value: string): string {
  if (new TextEncoder().encode(value).byteLength < 32) {
    throw new Error(
      'Internal operation transport secret must contain at least 32 bytes.',
    );
  }
  return value;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function stable(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 1_024;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

export type ApplicationInternalOperationTransportErrorCode =
  | 'INTERNAL_INVOCATION_INVALID'
  | 'INTERNAL_INVOCATION_TOO_LARGE'
  | 'INTERNAL_TOKEN_PASSTHROUGH_FORBIDDEN';

export class ApplicationInternalOperationTransportError extends Error {
  constructor(
    readonly code: ApplicationInternalOperationTransportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationInternalOperationTransportError';
  }
}

function transportError(
  code: ApplicationInternalOperationTransportErrorCode,
  message: string,
): ApplicationInternalOperationTransportError {
  return new ApplicationInternalOperationTransportError(code, message);
}
