import type {
  ApplicationAuthorizationReceipt,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
} from './application-operation-authority.js';
import { validateApplicationAuthorizationReceipt } from './application-operation-authority.js';
import { canonicalJsonV1Value } from './canonical-json.js';
import type { JsonObject, JsonValue } from './common.js';

export const applicationAdmissionContextVersion = 'applik8s.admission/v1' as const;

export type ApplicationAdmissionTransportV1 =
  | 'actor'
  | 'broker'
  | 'control-plane'
  | 'direct'
  | 'framework'
  | 'http'
  | 'mcp'
  | 'schedule'
  | 'webhook'
  | 'workflow';

export interface ApplicationAdmissionContextV1 {
  readonly apiVersion: typeof applicationAdmissionContextVersion;
  readonly principal: ApplicationPrincipal;
  readonly authorityRevision: string;
  readonly trustedContext: {
    readonly values: Readonly<Record<string, JsonValue>>;
    readonly digest: string;
  };
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  readonly operation: {
    readonly id: string;
    readonly transport: ApplicationAdmissionTransportV1;
  };
  readonly correlationId: string;
  readonly causationId?: string;
  readonly deadline?: string;
  readonly cancellation?: {
    readonly revision: string;
    readonly requestedAt?: string;
  };
  readonly trace?: {
    readonly traceparent: string;
    readonly tracestate?: string;
  };
  readonly delivery?: {
    readonly id: string;
    readonly source: string;
  };
}

export interface CreateApplicationAdmissionContextV1Options<
  TPrincipal extends ApplicationPrincipal = ApplicationPrincipal,
> {
  readonly admission: ApplicationRequestAdmission & {
    readonly principal: TPrincipal;
  };
  readonly operation: ApplicationAdmissionContextV1['operation'];
  readonly correlationId: string;
}

export interface ApplicationAdmissionExecutionProvenanceV1 {
  readonly causationId?: string;
  readonly deadline?: string;
  readonly cancellation?: ApplicationAdmissionContextV1['cancellation'];
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  readonly delivery?: ApplicationAdmissionContextV1['delivery'];
}

export class ApplicationAdmissionContextV1Error extends TypeError {
  constructor(
    readonly code:
      | 'ADMISSION_AUTHORITY_MISMATCH'
      | 'ADMISSION_CONTEXT_INVALID'
      | 'ADMISSION_DEADLINE_EXPIRED'
      | 'ADMISSION_IDENTITY_INVALID'
      | 'ADMISSION_OPERATION_INVALID'
      | 'ADMISSION_RECEIPT_INVALID'
      | 'ADMISSION_TRACE_INVALID'
      | 'ADMISSION_VERSION_INVALID',
    readonly path: string,
    message: string,
  ) {
    super(`${message} at ${path}.`);
    this.name = new.target.name;
  }
}

/**
 * The one construction boundary for framework admission. Transport adapters
 * verify their own evidence, then supply an authenticated request admission and
 * transport provenance here. Execution families receive only narrowed views of
 * the validated result.
 */
export function createApplicationAdmissionContextV1<
  TPrincipal extends ApplicationPrincipal,
>(
  options: CreateApplicationAdmissionContextV1Options<TPrincipal>,
): ApplicationAdmissionContextV1 & { readonly principal: TPrincipal } {
  if (!options.admission || typeof options.admission !== 'object') {
    throw new TypeError('Admission is required.');
  }
  const principal = options.admission.principal;
  if (!principal || typeof principal !== 'object') {
    throw new TypeError('Admission principal is required.');
  }
  for (const field of ['id', 'kind', 'trustedContextDigest', 'authorityRevision'] as const) {
    if (typeof Reflect.get(principal, field) !== 'string' || !String(Reflect.get(principal, field)).trim()) {
      throw new TypeError(`Admission principal ${field} is invalid.`);
    }
  }
  const canonicalTrustedContext = canonicalJsonV1Value(options.admission.trustedContext);
  if (!canonicalTrustedContext || typeof canonicalTrustedContext !== 'object' || Array.isArray(canonicalTrustedContext)) {
    throw new TypeError('Admission trusted context must be JSON.');
  }
  // typecast-boundary: Canonical JSON normalization and the array rejection
  // above establish the JsonObject branch.
  const trustedContextValues = canonicalTrustedContext as JsonObject;
  const operation = options.operation;
  if (!operation?.id?.startsWith('applik8s://')
    || !admissionTransports.includes(`|${operation.transport}|`)) {
    throw new TypeError('Admission operation is invalid.');
  }
  if (!options.correlationId?.trim()) {
    throw new TypeError('Admission correlationId is required.');
  }
  return Object.freeze({
    apiVersion: applicationAdmissionContextVersion,
    principal,
    authorityRevision: principal.authorityRevision,
    trustedContext: Object.freeze({
      values: trustedContextValues,
      digest: principal.trustedContextDigest,
    }),
    operation,
    correlationId: options.correlationId,
  });
}

/** Adds validated W3C trace provenance without widening the base constructor. */
export function withApplicationAdmissionTraceV1<
  TContext extends ApplicationAdmissionContextV1,
>(
  context: TContext,
  trace: ApplicationAdmissionContextV1['trace'],
): TContext {
  if (!trace || !/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u.test(trace.traceparent)
    || (trace.tracestate !== undefined && !trace.tracestate.trim())) {
    throw new TypeError('Admission trace is invalid.');
  }
  return Object.freeze({
    ...context,
    trace: Object.freeze({ ...trace }),
  }) as TContext;
}

/**
 * Adds execution-family provenance after transport evidence has produced the
 * canonical base context. This keeps request-only bundles small while giving
 * workflows, tasks, brokers, actors, schedules, and agents one validation
 * boundary for causation, deadlines, cancellation, receipts, and delivery.
 */
export function withApplicationAdmissionExecutionV1<
  TContext extends ApplicationAdmissionContextV1,
>(
  context: TContext,
  provenance: ApplicationAdmissionExecutionProvenanceV1,
): TContext {
  return validateApplicationAdmissionContextV1({
    ...context,
    ...(provenance.causationId ? { causationId: provenance.causationId } : {}),
    ...(provenance.deadline ? { deadline: provenance.deadline } : {}),
    ...(provenance.cancellation
      ? { cancellation: provenance.cancellation }
      : {}),
    ...(provenance.authorizationReceipt
      ? { authorizationReceipt: provenance.authorizationReceipt }
      : {}),
    ...(provenance.delivery ? { delivery: provenance.delivery } : {}),
  }, {
    // Construction validates the timestamp but must not reject deterministic
    // fixtures or replayed durable records merely because wall time advanced.
    now: Number.NEGATIVE_INFINITY,
  }) as TContext;
}

export function validateApplicationAdmissionContextV1(
  value: unknown,
  options: { readonly now?: number } = {},
): ApplicationAdmissionContextV1 {
  const input = record(value, '$');
  if (input.apiVersion !== applicationAdmissionContextVersion) {
    throw admissionError('ADMISSION_VERSION_INVALID', '$.apiVersion', 'Admission context version is unsupported');
  }
  const principal = validatePrincipal(input.principal, '$.principal');
  const authorityRevision = requiredString(input.authorityRevision, '$.authorityRevision');
  if (principal.authorityRevision !== authorityRevision) {
    throw admissionError('ADMISSION_AUTHORITY_MISMATCH', '$.authorityRevision', 'Admission authority revision does not match the principal');
  }
  const trustedContext = record(input.trustedContext, '$.trustedContext');
  const trustedContextValues = jsonObject(trustedContext.values, '$.trustedContext.values');
  const trustedContextDigest = requiredString(trustedContext.digest, '$.trustedContext.digest');
  if (principal.trustedContextDigest !== trustedContextDigest) {
    throw admissionError('ADMISSION_AUTHORITY_MISMATCH', '$.trustedContext.digest', 'Admission trusted-context digest does not match the principal');
  }
  const operation = validateOperation(input.operation);
  const correlationId = requiredString(input.correlationId, '$.correlationId');
  const causationId = optionalString(input.causationId, '$.causationId');
  const deadline = optionalTimestamp(input.deadline, '$.deadline');
  if (deadline && Date.parse(deadline) < (options.now ?? Date.now())) {
    throw admissionError('ADMISSION_DEADLINE_EXPIRED', '$.deadline', 'Admission deadline has expired');
  }
  const cancellation = input.cancellation === undefined
    ? undefined
    : validateCancellation(input.cancellation);
  const trace = input.trace === undefined ? undefined : validateTrace(input.trace);
  const delivery = input.delivery === undefined
    ? undefined
    : validateDelivery(input.delivery);
  const authorizationReceipt = input.authorizationReceipt === undefined
    ? undefined
    : input.authorizationReceipt as ApplicationAuthorizationReceipt;
  if (authorizationReceipt) {
    validateReceipt(authorizationReceipt, principal, operation.id);
  }
  return Object.freeze({
    apiVersion: applicationAdmissionContextVersion,
    principal,
    authorityRevision,
    trustedContext: Object.freeze({ values: trustedContextValues, digest: trustedContextDigest }),
    ...(authorizationReceipt ? { authorizationReceipt } : {}),
    operation,
    correlationId,
    ...(causationId ? { causationId } : {}),
    ...(deadline ? { deadline } : {}),
    ...(cancellation ? { cancellation } : {}),
    ...(trace ? { trace } : {}),
    ...(delivery ? { delivery } : {}),
  });
}

export function applicationAdmissionIdentityView(
  context: ApplicationAdmissionContextV1,
): Pick<ApplicationAdmissionContextV1, 'apiVersion' | 'principal' | 'authorityRevision' | 'trustedContext'> {
  return Object.freeze({
    apiVersion: context.apiVersion,
    principal: context.principal,
    authorityRevision: context.authorityRevision,
    trustedContext: context.trustedContext,
  });
}

export function applicationAdmissionInvocationView(
  context: ApplicationAdmissionContextV1,
): Omit<ApplicationAdmissionContextV1, 'delivery'> {
  const { delivery: _delivery, ...view } = context;
  return Object.freeze(view);
}

const admissionTransports = '|actor|broker|control-plane|direct|framework|http|mcp|schedule|webhook|workflow|';

function validatePrincipal(value: unknown, path: string): ApplicationPrincipal {
  const principal = record(value, path) as unknown as ApplicationPrincipal;
  for (const field of ['id', 'kind', 'trustedContextDigest', 'authorityRevision'] as const) {
    if (typeof Reflect.get(principal, field) !== 'string' || !String(Reflect.get(principal, field)).trim()) {
      throw admissionError('ADMISSION_IDENTITY_INVALID', `${path}.${field}`, `Admission principal ${field} is invalid`);
    }
  }
  return principal;
}

function validateOperation(value: unknown): ApplicationAdmissionContextV1['operation'] {
  const operation = record(value, '$.operation');
  const id = requiredString(operation.id, '$.operation.id');
  if (!id.startsWith('applik8s://')) {
    throw admissionError('ADMISSION_OPERATION_INVALID', '$.operation.id', 'Admission operation identity is invalid');
  }
  const transport = requiredString(operation.transport, '$.operation.transport');
  if (!admissionTransports.includes(`|${transport}|`)) {
    throw admissionError('ADMISSION_OPERATION_INVALID', '$.operation.transport', 'Admission transport is unsupported');
  }
  return Object.freeze({ id, transport: transport as ApplicationAdmissionTransportV1 });
}

function validateReceipt(
  receipt: ApplicationAuthorizationReceipt,
  principal: ApplicationPrincipal,
  operationId: string,
): void {
  const diagnostics = validateApplicationAuthorizationReceipt(receipt);
  if (diagnostics.length > 0) {
    throw admissionError('ADMISSION_RECEIPT_INVALID', '$.authorizationReceipt', diagnostics[0]?.message ?? 'Admission receipt is invalid');
  }
  if (
    receipt.principal.id !== principal.id
    || receipt.authorityRevision !== principal.authorityRevision
    || receipt.trustedContextDigest !== principal.trustedContextDigest
    || receipt.operationId !== operationId
  ) {
    throw admissionError('ADMISSION_RECEIPT_INVALID', '$.authorizationReceipt', 'Admission receipt does not match the canonical context');
  }
}

function validateCancellation(value: unknown): NonNullable<ApplicationAdmissionContextV1['cancellation']> {
  const input = record(value, '$.cancellation');
  const revision = requiredString(input.revision, '$.cancellation.revision');
  const requestedAt = optionalTimestamp(input.requestedAt, '$.cancellation.requestedAt');
  return Object.freeze({ revision, ...(requestedAt ? { requestedAt } : {}) });
}

function validateTrace(value: unknown): NonNullable<ApplicationAdmissionContextV1['trace']> {
  const input = record(value, '$.trace');
  const traceparent = requiredString(input.traceparent, '$.trace.traceparent');
  if (!/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u.test(traceparent)) {
    throw admissionError('ADMISSION_TRACE_INVALID', '$.trace.traceparent', 'Admission traceparent is invalid');
  }
  const tracestate = optionalString(input.tracestate, '$.trace.tracestate');
  return Object.freeze({ traceparent, ...(tracestate ? { tracestate } : {}) });
}

function validateDelivery(value: unknown): NonNullable<ApplicationAdmissionContextV1['delivery']> {
  const input = record(value, '$.delivery');
  return Object.freeze({
    id: requiredString(input.id, '$.delivery.id'),
    source: requiredString(input.source, '$.delivery.source'),
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw admissionError('ADMISSION_CONTEXT_INVALID', path, 'Admission context value must be an object');
  }
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown, path: string): JsonObject {
  const input = record(value, path);
  for (const [key, entry] of Object.entries(input)) assertJsonValue(entry, `${path}.${key}`);
  return Object.freeze({ ...input }) as JsonObject;
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertJsonValue(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) assertJsonValue(entry, `${path}.${key}`);
    return;
  }
  throw admissionError('ADMISSION_CONTEXT_INVALID', path, 'Admission trusted context is not JSON');
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw admissionError('ADMISSION_CONTEXT_INVALID', path, 'Admission field must be a non-empty string');
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function optionalTimestamp(value: unknown, path: string): string | undefined {
  const timestamp = optionalString(value, path);
  if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) {
    throw admissionError('ADMISSION_CONTEXT_INVALID', path, 'Admission timestamp is invalid');
  }
  return timestamp;
}

function admissionError(
  code: ApplicationAdmissionContextV1Error['code'],
  path: string,
  message: string,
): ApplicationAdmissionContextV1Error {
  return new ApplicationAdmissionContextV1Error(code, path, message);
}
