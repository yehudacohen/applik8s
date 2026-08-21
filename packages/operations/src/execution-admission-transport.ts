// typecast-file-boundary: signed execution-admission payloads are restored
// only after HMAC, expiry, identity, and request-binding validation.
import { createHash } from 'node:crypto';
import type {
  ApplicationAdmissionContextV1,
  ApplicationExecutionKind,
  ApplicationRequestAdmission,
  JsonObject,
} from '@applik8s/core';
import {
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import {
  canonicalInternalJson,
  internalTransportSecret,
  internalTransportSignature,
  internalTransportSignatureMatches,
} from './internal-signing.js';
import { assertApplicationInternalContextHasNoCredentials } from './internal-transport.js';

export const applicationExecutionAdmissionProtocol =
  'applik8s.executionAdmission/v1alpha1' as const;

export interface ApplicationExecutionAdmissionInvocation {
  readonly apiVersion: typeof applicationExecutionAdmissionProtocol;
  readonly id: string;
  readonly executionKind: ApplicationExecutionKind;
  readonly executionId: string;
  readonly attempt: number;
  readonly workloadIdentityId: string;
  readonly serviceIdentityId?: string;
  /** Canonical v0.8 execution admission; legacy admission remains during Release A rollback compatibility. */
  readonly context: ApplicationAdmissionContextV1;
  readonly admission: ApplicationRequestAdmission;
  readonly audience: readonly string[];
  readonly causalGrantIds: readonly string[];
  readonly cancellationRevision: string;
  readonly binding: JsonObject;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ApplicationExecutionAdmissionExpectation {
  readonly executionKind: ApplicationExecutionKind;
  readonly workloadIdentityId: string;
  readonly serviceIdentityId?: string;
  readonly audience?: readonly string[];
  readonly binding: JsonObject;
  readonly now?: Date;
  readonly maximumLifetimeMs?: number;
  readonly maximumTokenBytes?: number;
}

export function encodeApplicationExecutionAdmission(
  secret: string,
  invocation: ApplicationExecutionAdmissionInvocation,
): string {
  assertApplicationInternalContextHasNoCredentials(
    invocation.admission.trustedContext,
  );
  validateExecutionAdmission(invocation, {
    executionKind: invocation.executionKind,
    workloadIdentityId: invocation.workloadIdentityId,
    ...(invocation.serviceIdentityId
      ? { serviceIdentityId: invocation.serviceIdentityId }
      : {}),
    binding: invocation.binding,
    now: new Date(invocation.issuedAt),
  });
  const payload = Buffer.from(
    canonicalInternalJson(invocation),
    'utf8',
  ).toString('base64url');
  return `${payload}.${internalTransportSignature(
    internalTransportSecret(secret),
    payload,
  )}`;
}

export function decodeApplicationExecutionAdmission(
  secret: string,
  token: string,
  expectation: ApplicationExecutionAdmissionExpectation,
): ApplicationExecutionAdmissionInvocation {
  const maximumBytes = expectation.maximumTokenBytes ?? 256 * 1024;
  if (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1_024
    || maximumBytes > 1024 * 1024
  ) {
    throw new Error(
      'Execution-admission maximumTokenBytes must be between 1 KiB and 1 MiB.',
    );
  }
  if (new TextEncoder().encode(token).byteLength > maximumBytes) {
    throw admissionError(
      'EXECUTION_ADMISSION_TOO_LARGE',
      'The execution-admission token exceeds its size bound.',
    );
  }
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) {
    throw admissionError(
      'EXECUTION_ADMISSION_INVALID',
      'The execution-admission token is malformed.',
    );
  }
  const calculated = internalTransportSignature(
    internalTransportSecret(secret),
    payload,
  );
  if (!internalTransportSignatureMatches(signature, calculated)) {
    throw admissionError(
      'EXECUTION_ADMISSION_INVALID',
      'The execution-admission signature is invalid.',
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw admissionError(
      'EXECUTION_ADMISSION_INVALID',
      'The execution-admission payload is invalid.',
    );
  }
  const wireInvocation = decoded as LegacyCompatibleExecutionAdmissionInvocation;
  validateExecutionAdmission(wireInvocation, expectation);
  assertApplicationInternalContextHasNoCredentials(
    wireInvocation.admission.trustedContext,
  );
  const context = wireInvocation.context
    ? validateApplicationAdmissionContextV1(wireInvocation.context, {
        now: (expectation.now ?? new Date()).getTime(),
      })
    : legacyExecutionAdmissionContext(wireInvocation);
  validateCanonicalParity(wireInvocation, context);
  return structuredClone({ ...wireInvocation, context });
}

function validateExecutionAdmission(
  invocation: LegacyCompatibleExecutionAdmissionInvocation,
  expectation: ApplicationExecutionAdmissionExpectation,
): void {
  const issuedAt = Date.parse(invocation.issuedAt);
  const expiresAt = Date.parse(invocation.expiresAt);
  const now = (expectation.now ?? new Date()).getTime();
  const maximumLifetime = expectation.maximumLifetimeMs ?? 5 * 60_000;
  const principal = invocation.admission?.principal;
  if (
    invocation.apiVersion !== applicationExecutionAdmissionProtocol
    || !stable(invocation.id)
    || invocation.executionKind !== expectation.executionKind
    || !stable(invocation.executionId)
    || !Number.isSafeInteger(invocation.attempt)
    || invocation.attempt < 1
    || invocation.workloadIdentityId !== expectation.workloadIdentityId
    || invocation.serviceIdentityId !== expectation.serviceIdentityId
    || !principal?.id
    || !principal.identity?.id
    || !matchesTrustedContextDigest(
      principal.trustedContextDigest,
      invocation.admission.trustedContext,
    )
    || invocation.audience.length === 0
    || invocation.audience.some((value) => !stable(value))
    || (expectation.audience
      && canonicalInternalJson([...invocation.audience].sort())
        !== canonicalInternalJson([...expectation.audience].sort()))
    || invocation.causalGrantIds.some((value) => !stable(value))
    || !stable(invocation.cancellationRevision)
    || canonicalInternalJson(invocation.binding)
      !== canonicalInternalJson(expectation.binding)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > maximumLifetime
    || now < issuedAt - 5_000
    || now >= expiresAt
    || (principal.expiresAt
      && Date.parse(principal.expiresAt) <= now)
  ) {
    throw admissionError(
      'EXECUTION_ADMISSION_INVALID',
      'The execution-admission token does not match its execution boundary.',
    );
  }
  if (invocation.context) {
    const context = validateApplicationAdmissionContextV1(invocation.context, {
      now,
    });
    validateCanonicalParity(invocation, context);
  }
}

type LegacyCompatibleExecutionAdmissionInvocation =
  Omit<ApplicationExecutionAdmissionInvocation, 'context'> & {
    readonly context?: ApplicationAdmissionContextV1;
  };

function legacyExecutionAdmissionContext(
  invocation: LegacyCompatibleExecutionAdmissionInvocation,
): ApplicationAdmissionContextV1 {
  return withApplicationAdmissionExecutionV1(
    createApplicationAdmissionContextV1({
      admission: invocation.admission,
      operation: {
        id: `applik8s://execution/${invocation.executionKind}/${invocation.executionId}`,
        transport: 'framework',
      },
      correlationId: invocation.executionId,
    }),
    {
      causationId: invocation.id,
      deadline: invocation.expiresAt,
      cancellation: { revision: invocation.cancellationRevision },
      delivery: {
        id: invocation.id,
        source: 'applik8s://execution-admission/legacy',
      },
    },
  );
}

function validateCanonicalParity(
  invocation: LegacyCompatibleExecutionAdmissionInvocation,
  context: ApplicationAdmissionContextV1,
): void {
  if (
    context.principal.id !== invocation.admission.principal.id
    || context.authorityRevision !== invocation.admission.principal.authorityRevision
    || context.trustedContext.digest !== invocation.admission.principal.trustedContextDigest
    || canonicalInternalJson(context.trustedContext.values)
      !== canonicalInternalJson(invocation.admission.trustedContext)
    || context.deadline !== invocation.expiresAt
    || context.cancellation?.revision !== invocation.cancellationRevision
    || context.delivery?.id !== invocation.id
  ) {
    throw admissionError(
      'EXECUTION_ADMISSION_INVALID',
      'The canonical admission context does not match its Release A compatibility fields.',
    );
  }
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalInternalJson(value))
    .digest('hex')}`;
}

function matchesTrustedContextDigest(
  digest: string,
  trustedContext: unknown,
): boolean {
  const expected = digestJson(trustedContext);
  return digest === expected || digest === expected.slice('sha256:'.length);
}

function stable(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 2_048;
}

export type ApplicationExecutionAdmissionErrorCode =
  | 'EXECUTION_ADMISSION_INVALID'
  | 'EXECUTION_ADMISSION_TOO_LARGE';

export class ApplicationExecutionAdmissionError extends Error {
  constructor(
    readonly code: ApplicationExecutionAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationExecutionAdmissionError';
  }
}

function admissionError(
  code: ApplicationExecutionAdmissionErrorCode,
  message: string,
): ApplicationExecutionAdmissionError {
  return new ApplicationExecutionAdmissionError(code, message);
}
