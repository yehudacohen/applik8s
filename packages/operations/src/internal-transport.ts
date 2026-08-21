// typecast-file-boundary: signed internal invocation payloads are decoded only
// after HMAC verification and full receipt/principal/identity validation.
import { createHash } from 'node:crypto';
import type {
  ApplicationAdmissionContextV1,
  ApplicationAuthorizationReceipt,
  ApplicationOperationId,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import {
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1,
  validateApplicationAuthorizationReceipt,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import {
  canonicalInternalJson,
  internalTransportSecret,
  internalTransportSignature,
  internalTransportSignatureMatches,
} from './internal-signing.js';

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
  /** Canonical v0.8 context; admission remains during the Release A rollback window. */
  readonly context: ApplicationAdmissionContextV1;
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
  readonly audience: string | readonly string[];
  readonly now?: Date;
  readonly maximumLifetimeMs?: number;
  readonly maximumTokenBytes?: number;
}

export function applicationInternalOperationInputDigest(value: JsonValue): string {
  return `sha256:${createHash('sha256')
    .update(canonicalInternalJson(value))
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
  const normalizedSecret = internalTransportSecret(secret);
  validateInvocation(invocation, {
    operationId: invocation.operationId,
    operationVersion: invocation.operationVersion,
    inputDigest: invocation.inputDigest,
    audience: invocation.audience,
    now: new Date(invocation.issuedAt),
    maximumLifetimeMs: 60_000,
  });
  assertApplicationInternalContextHasNoCredentials(
    invocation.admission.trustedContext,
  );
  const payload = Buffer.from(
    canonicalInternalJson(invocation),
    'utf8',
  ).toString('base64url');
  const signature = internalTransportSignature(normalizedSecret, payload);
  return `${payload}.${signature}`;
}

export function decodeApplicationInternalOperationInvocation(
  secret: string,
  token: string,
  expected: ApplicationInternalOperationVerification,
): ApplicationInternalOperationInvocation {
  const normalizedSecret = internalTransportSecret(secret);
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
  const calculated = internalTransportSignature(normalizedSecret, payload);
  if (!internalTransportSignatureMatches(signature, calculated)) {
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
  const wireInvocation = decoded as LegacyCompatibleInternalOperationInvocation;
  validateInvocation(wireInvocation, expected);
  assertApplicationInternalContextHasNoCredentials(
    wireInvocation.admission.trustedContext,
  );
  const context = wireInvocation.context
    ? validateApplicationAdmissionContextV1(wireInvocation.context, {
        now: (expected.now ?? new Date()).getTime(),
      })
    : legacyInternalOperationContext(wireInvocation);
  validateCanonicalParity(wireInvocation, context);
  return structuredClone({ ...wireInvocation, context });
}

function validateInvocation(
  invocation: LegacyCompatibleInternalOperationInvocation,
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
    || !expectedAudiences(expected.audience).includes(invocation.audience)
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
  if (invocation.context) {
    const context = validateApplicationAdmissionContextV1(invocation.context, {
      now,
    });
    validateCanonicalParity(invocation, context);
  }
}

type LegacyCompatibleInternalOperationInvocation =
  Omit<ApplicationInternalOperationInvocation, 'context'> & {
    readonly context?: ApplicationAdmissionContextV1;
  };

function legacyInternalOperationContext(
  invocation: LegacyCompatibleInternalOperationInvocation,
): ApplicationAdmissionContextV1 {
  return withApplicationAdmissionExecutionV1(
    createApplicationAdmissionContextV1({
      admission: invocation.admission,
      operation: {
        id: invocation.operationId,
        transport: canonicalInternalTransport(invocation.source.transport),
      },
      correlationId: invocation.source.sessionId ?? invocation.id,
    }),
    {
      causationId: invocation.id,
      deadline: invocation.expiresAt,
      authorizationReceipt: invocation.authorizationReceipt,
      delivery: {
        id: invocation.id,
        source: `applik8s://internal-operation/${invocation.source.workloadId}`,
      },
    },
  );
}

function validateCanonicalParity(
  invocation: LegacyCompatibleInternalOperationInvocation,
  context: ApplicationAdmissionContextV1,
): void {
  if (
    context.principal.id !== invocation.admission.principal.id
    || context.authorityRevision !== invocation.admission.principal.authorityRevision
    || context.trustedContext.digest !== invocation.admission.principal.trustedContextDigest
    || canonicalInternalJson(context.trustedContext.values)
      !== canonicalInternalJson(invocation.admission.trustedContext)
    || context.operation.id !== invocation.operationId
    || context.operation.transport !== canonicalInternalTransport(invocation.source.transport)
    || context.authorizationReceipt?.id !== invocation.authorizationReceipt.id
    || context.deadline !== invocation.expiresAt
    || context.delivery?.id !== invocation.id
  ) {
    throw transportError(
      'INTERNAL_INVOCATION_INVALID',
      'The canonical admission context does not match its Release A compatibility fields.',
    );
  }
}

function canonicalInternalTransport(
  transport: ApplicationInternalOperationInvocation['source']['transport'],
): ApplicationAdmissionContextV1['operation']['transport'] {
  return transport === 'event' ? 'broker' : transport;
}

function expectedAudiences(
  audience: string | readonly string[],
): readonly string[] {
  return typeof audience === 'string' ? [audience] : audience;
}

export function assertApplicationInternalContextHasNoCredentials(
  value: unknown,
  path = '$',
): void {
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
      assertApplicationInternalContextHasNoCredentials(
        entry,
        `${path}[${index}]`,
      );
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
    assertApplicationInternalContextHasNoCredentials(entry, `${path}.${key}`);
  }
}

function stable(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 1_024;
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
