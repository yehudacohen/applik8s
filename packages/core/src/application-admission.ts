import type {
  ApplicationAuthorizationReceipt,
  ApplicationPrincipal,
} from './application-operation-authority.js';
import { validateApplicationAuthorizationReceipt } from './application-operation-authority.js';
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
    this.name = 'ApplicationAdmissionContextV1Error';
  }
}

export function validateApplicationAdmissionContextV1(
  value: unknown,
  options: { readonly now?: number } = {},
): ApplicationAdmissionContextV1 {
  const input = record(value, '$');
  if (input.apiVersion !== applicationAdmissionContextVersion) {
    throw admissionError('ADMISSION_VERSION_INVALID', '$.apiVersion', 'Admission context version is unsupported');
  }
  const principal = record(input.principal, '$.principal') as unknown as ApplicationPrincipal;
  for (const field of ['id', 'kind', 'trustedContextDigest', 'authorityRevision'] as const) {
    if (typeof Reflect.get(principal, field) !== 'string' || !String(Reflect.get(principal, field)).trim()) {
      throw admissionError('ADMISSION_IDENTITY_INVALID', `$.principal.${field}`, `Admission principal ${field} is invalid`);
    }
  }
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
  const operationInput = record(input.operation, '$.operation');
  const operationId = requiredString(operationInput.id, '$.operation.id');
  if (!operationId.startsWith('applik8s://')) {
    throw admissionError('ADMISSION_OPERATION_INVALID', '$.operation.id', 'Admission operation identity is invalid');
  }
  const transport = requiredString(operationInput.transport, '$.operation.transport');
  if (!admissionTransports.has(transport as ApplicationAdmissionTransportV1)) {
    throw admissionError('ADMISSION_OPERATION_INVALID', '$.operation.transport', 'Admission transport is unsupported');
  }
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
    const diagnostics = validateApplicationAuthorizationReceipt(authorizationReceipt);
    if (diagnostics.length > 0) {
      throw admissionError('ADMISSION_RECEIPT_INVALID', '$.authorizationReceipt', diagnostics[0]?.message ?? 'Admission receipt is invalid');
    }
    if (
      authorizationReceipt.principal.id !== principal.id
      || authorizationReceipt.authorityRevision !== authorityRevision
      || authorizationReceipt.trustedContextDigest !== trustedContextDigest
      || authorizationReceipt.operationId !== operationId
    ) {
      throw admissionError('ADMISSION_RECEIPT_INVALID', '$.authorizationReceipt', 'Admission receipt does not match the canonical context');
    }
  }
  return Object.freeze({
    apiVersion: applicationAdmissionContextVersion,
    principal,
    authorityRevision,
    trustedContext: Object.freeze({ values: trustedContextValues, digest: trustedContextDigest }),
    ...(authorizationReceipt ? { authorizationReceipt } : {}),
    operation: Object.freeze({ id: operationId, transport: transport as ApplicationAdmissionTransportV1 }),
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

const admissionTransports = new Set<ApplicationAdmissionTransportV1>([
  'actor',
  'broker',
  'control-plane',
  'direct',
  'framework',
  'http',
  'mcp',
  'schedule',
  'webhook',
  'workflow',
]);

function validateCancellation(value: unknown): NonNullable<ApplicationAdmissionContextV1['cancellation']> {
  const input = record(value, '$.cancellation');
  const revision = requiredString(input.revision, '$.cancellation.revision');
  const requestedAt = optionalTimestamp(input.requestedAt, '$.cancellation.requestedAt');
  return Object.freeze({ revision, ...(requestedAt ? { requestedAt } : {}) });
}

function validateTrace(value: unknown): NonNullable<ApplicationAdmissionContextV1['trace']> {
  const input = record(value, '$.trace');
  const traceparent = requiredString(input.traceparent, '$.trace.traceparent');
  if (!/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/u.test(traceparent)) {
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
