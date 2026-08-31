// typecast-file-boundary: This is the canonical unknown-to-admission validation boundary; assertions occur only after closed structural and discriminant checks.
import type {
  ApplicationAuthorizationReceipt,
  ApplicationCausalPrincipalContext,
  ApplicationExecutionKind,
  ApplicationExecutionPrincipal,
  ApplicationIdentityReference,
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  ApplicationWorkloadAuthorityEnvelope,
} from './application-operation-authority.js';
import { validateApplicationAuthorizationReceipt } from './application-operation-authority.js';
import { canonicalJsonV1Value } from './canonical-json.js';
import type { JsonObject, JsonValue } from './common.js';

export const applicationAdmissionContextVersion = 'applik8s.admission/v1' as const;
export const applicationAdmissionObservationVersion =
  'applik8s.admission-observation/v1' as const;

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

/** Read-only managed-execution view exposed to application closures. */
export type ApplicationAdmissionInvocationContextV1 = Omit<
  ApplicationAdmissionContextV1,
  'delivery'
>;

/**
 * Bounded, provider-neutral evidence emitted by an admission boundary.
 *
 * This is intentionally not an audit record and contains no principal,
 * trusted context, payload, signature, receipt, identifier, or exception
 * message. Provider adapters retain responsibility for verifying their own
 * transport evidence before an `admitted` observation can be constructed.
 */
export interface ApplicationAdmissionObservationV1 {
  readonly apiVersion: typeof applicationAdmissionObservationVersion;
  readonly state: 'admitted' | 'rejected';
  readonly boundary: 'delivery' | 'execution' | 'request';
  readonly admissionVersion: typeof applicationAdmissionContextVersion;
  readonly transport: ApplicationAdmissionTransportV1;
  readonly compatibilityPath: 'canonical' | 'legacy';
  readonly rejectionCode?: string;
}

export type ApplicationAdmissionObserverV1 = (
  observation: ApplicationAdmissionObservationV1,
) => void | Promise<void>;

export interface ApplicationAdmissionObservationDeliveryV1 {
  readonly delivered: boolean;
  /** Bounded observer failure class; admission itself is never changed. */
  readonly failureCode?: string;
}

export interface CreateApplicationAdmissionObservationV1Options {
  readonly state: ApplicationAdmissionObservationV1['state'];
  readonly boundary: ApplicationAdmissionObservationV1['boundary'];
  readonly admission?: Pick<ApplicationAdmissionContextV1, 'apiVersion' | 'operation'>;
  readonly transport?: ApplicationAdmissionTransportV1;
  readonly compatibilityPath?: ApplicationAdmissionObservationV1['compatibilityPath'];
  readonly rejectionCode?: string;
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

export interface CreateApplicationRequestAdmissionContextV1Options<
  TPrincipal extends ApplicationPrincipal = ApplicationPrincipal,
> extends CreateApplicationAdmissionContextV1Options<TPrincipal> {
  /** Verified W3C request trace provenance, when the transport supplied it. */
  readonly trace?: ApplicationAdmissionContextV1['trace'];
}

export interface ApplicationAdmissionExecutionProvenanceV1 {
  readonly causationId?: string;
  readonly deadline?: string;
  readonly cancellation?: ApplicationAdmissionContextV1['cancellation'];
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  readonly delivery?: ApplicationAdmissionContextV1['delivery'];
}

export interface CreateApplicationExecutionPrincipalV1Options {
  readonly application: string;
  readonly executionKind: ApplicationExecutionKind;
  readonly executionId: string;
  readonly attempt: number;
  readonly workloadIdentity: ApplicationIdentityReference;
  readonly serviceIdentity?: ApplicationIdentityReference;
  readonly executionContext?: ApplicationExecutionPrincipal['executionContext'];
  readonly causalPrincipal?: ApplicationCausalPrincipalContext;
  readonly envelopes: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly trustedContextDigest: string;
  readonly audience: readonly string[];
  readonly catalogRevision: string;
  readonly authorityRevision: string;
  readonly deadline: string;
  readonly cancellationRevision: string;
  readonly authenticationMethod?: string;
  readonly admittedAt?: string;
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
 * Reduces an arbitrary failure to a bounded class suitable for admission
 * health evidence. Error messages are never included because provider errors
 * can contain raw payloads, signatures, identities, or trusted context.
 */
export function applicationAdmissionRejectionCodeV1(error: unknown): string {
  const code = error && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : undefined;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) {
    return code;
  }
  if (
    error instanceof Error
    && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
  ) {
    return error.name;
  }
  return 'AdmissionRejected';
}

/** Constructs the only public admission-health evidence shape. */
export function createApplicationAdmissionObservationV1(
  options: CreateApplicationAdmissionObservationV1Options,
): ApplicationAdmissionObservationV1 {
  const compatibilityPath = options.compatibilityPath ?? 'canonical';
  if (compatibilityPath !== 'canonical' && compatibilityPath !== 'legacy') {
    throw new TypeError('Admission observation compatibility path is invalid.');
  }
  if (
    options.boundary !== 'delivery'
    && options.boundary !== 'execution'
    && options.boundary !== 'request'
  ) {
    throw new TypeError('Admission observation boundary is invalid.');
  }
  if (options.state !== 'admitted' && options.state !== 'rejected') {
    throw new TypeError('Admission observation state is invalid.');
  }
  if (options.state === 'admitted' && !options.admission) {
    throw new TypeError(
      'An admitted observation requires a validated admission context.',
    );
  }
  if (
    options.admission
    && options.admission.apiVersion !== applicationAdmissionContextVersion
  ) {
    throw new TypeError('Admission observation context version is invalid.');
  }
  const transport = options.admission?.operation.transport ?? options.transport;
  if (!transport || !admissionTransports.includes(`|${transport}|`)) {
    throw new TypeError('Admission observation transport is invalid.');
  }
  if (
    options.admission
    && options.transport
    && options.transport !== options.admission.operation.transport
  ) {
    throw new TypeError('Admission observation transport does not match context.');
  }
  if (options.state === 'admitted' && options.rejectionCode) {
    throw new TypeError('An admitted observation cannot contain a rejection code.');
  }
  if (
    options.rejectionCode
    && !/^(?:[A-Z][A-Z0-9_]{0,63}|[A-Za-z][A-Za-z0-9]{0,63})$/u.test(
      options.rejectionCode,
    )
  ) {
    throw new TypeError('Admission observation rejection code is invalid.');
  }
  return Object.freeze({
    apiVersion: applicationAdmissionObservationVersion,
    state: options.state,
    boundary: options.boundary,
    admissionVersion: applicationAdmissionContextVersion,
    transport,
    compatibilityPath,
    ...(options.rejectionCode ? { rejectionCode: options.rejectionCode } : {}),
  });
}

/**
 * Delivers bounded admission evidence without allowing an observability sink
 * to alter the admitted or rejected protocol result.
 */
export async function deliverApplicationAdmissionObservationV1(
  observer: ApplicationAdmissionObserverV1 | undefined,
  options: CreateApplicationAdmissionObservationV1Options,
): Promise<ApplicationAdmissionObservationDeliveryV1> {
  if (!observer) return Object.freeze({ delivered: false });
  const observation = createApplicationAdmissionObservationV1(options);
  try {
    await observer(observation);
    return Object.freeze({ delivered: true });
  } catch (error) {
    return Object.freeze({
      delivered: false,
      failureCode: applicationAdmissionRejectionCodeV1(error),
    });
  }
}

/**
 * Constructs the one framework execution principal shared by managed
 * execution adapters. The caller must first verify its provider-specific
 * delivery evidence; this boundary then binds that delivery to compiler-owned
 * workload identity, revisions, authority envelopes, deadline, cancellation,
 * and causal attribution without granting ambient operation authority.
 */
export function createApplicationExecutionPrincipalV1(
  options: CreateApplicationExecutionPrincipalV1Options,
): ApplicationExecutionPrincipal {
  const application = nonEmpty(options.application, 'Execution application');
  const executionId = nonEmpty(options.executionId, 'Execution ID');
  if (!executionKinds.includes(`|${options.executionKind}|`)) {
    throw new TypeError('Execution kind is unsupported.');
  }
  if (!Number.isSafeInteger(options.attempt) || options.attempt < 1) {
    throw new TypeError('Execution attempt must be a positive safe integer.');
  }
  const workloadIdentity = validateIdentity(
    options.workloadIdentity,
    'workload',
    'Execution workload identity',
  );
  const serviceIdentity = options.serviceIdentity === undefined
    ? undefined
    : validateIdentity(
        options.serviceIdentity,
        'service',
        'Execution service identity',
      );
  const catalogRevision = nonEmpty(
    options.catalogRevision,
    'Execution catalog revision',
  );
  const authorityRevision = nonEmpty(
    options.authorityRevision,
    'Execution authority revision',
  );
  const trustedContextDigest = nonEmpty(
    options.trustedContextDigest,
    'Execution trusted-context digest',
  );
  const cancellationRevision = nonEmpty(
    options.cancellationRevision,
    'Execution cancellation revision',
  );
  const deadline = timestamp(options.deadline, 'Execution deadline');
  const admittedAt = timestamp(
    options.admittedAt ?? new Date().toISOString(),
    'Execution admittedAt',
  );
  if (Date.parse(deadline) < Date.parse(admittedAt)) {
    throw new TypeError('Execution deadline precedes admission.');
  }
  if (options.executionKind === 'actor' && options.executionContext?.kind !== 'actor') {
    throw new TypeError(
      'Actor execution requires stable actor, member, key-digest, and turn identifiers.',
    );
  }
  if (options.executionContext) {
    if (options.executionContext.kind !== options.executionKind) {
      throw new TypeError(
        'Execution context must match its managed execution kind and contain stable identifiers.',
      );
    }
    if (
      (options.executionContext.kind === 'agent'
        && (!options.executionContext.threadId.trim()
          || !options.executionContext.runId.trim()))
      || (options.executionContext.kind === 'actor'
        && (!options.executionContext.actor.trim()
          || !options.executionContext.member.trim()
          || !options.executionContext.keyDigest.trim()
          || !options.executionContext.turnId.trim()))
    ) {
      throw new TypeError(
        'Execution context must match its managed execution kind and contain stable identifiers.',
      );
    }
  }
  const audience = uniqueStrings(options.audience, 'Execution audience');
  const causalPrincipal = options.causalPrincipal
    ? Object.freeze({
        id: nonEmpty(options.causalPrincipal.id, 'Execution causal principal ID'),
        identity: validateIdentity(
          options.causalPrincipal.identity,
          undefined,
          'Execution causal principal identity',
        ),
        grantIds: uniqueStrings(
          options.causalPrincipal.grantIds,
          'Execution causal grant',
          true,
        ),
      })
    : Object.freeze({
        id: workloadIdentity.id,
        identity: workloadIdentity,
        grantIds: Object.freeze([] as string[]),
      });
  const envelopeIds = new Set<string>();
  const bindingIds = new Set<string>();
  const bindings = options.envelopes.flatMap((envelope) => {
    const id = nonEmpty(envelope.id, 'Execution workload envelope ID');
    if (envelopeIds.has(id)) {
      throw new TypeError(`Execution received duplicate workload envelope ${id}.`);
    }
    envelopeIds.add(id);
    if (envelope.catalogRevision !== catalogRevision) {
      throw new TypeError(
        `Workload envelope ${id} references catalog ${envelope.catalogRevision}, not ${catalogRevision}.`,
      );
    }
    if (!sameIdentity(envelope.workloadIdentity, workloadIdentity)) {
      throw new TypeError(
        `Workload envelope ${id} belongs to ${envelope.workloadIdentity.id}, not ${workloadIdentity.id}.`,
      );
    }
    if (!sameOptionalIdentity(envelope.serviceIdentity, serviceIdentity)) {
      throw new TypeError(
        `Workload envelope ${id} service identity does not match this execution.`,
      );
    }
    for (const envelopeAudience of envelope.audiences) {
      if (!audience.includes(envelopeAudience)) {
        throw new TypeError(
          `Workload envelope ${id} audience ${envelopeAudience} is absent from this execution.`,
        );
      }
    }
    if (!envelope.binding) return [];
    if (bindingIds.has(envelope.binding.id)) {
      throw new TypeError(
        `Execution received duplicate workload binding ${envelope.binding.id}.`,
      );
    }
    bindingIds.add(envelope.binding.id);
    return [envelope.binding];
  });
  const identity = serviceIdentity ?? workloadIdentity;
  return Object.freeze({
    id: `principal:${application}:execution:${options.executionKind}:${executionId}:${options.attempt}`,
    identity,
    kind: 'execution',
    executionKind: options.executionKind,
    executionId,
    attempt: options.attempt,
    workloadIdentity,
    ...(serviceIdentity ? { serviceIdentity } : {}),
    ...(options.executionContext
      ? { executionContext: Object.freeze({ ...options.executionContext }) }
      : {}),
    causalPrincipalId: causalPrincipal.id,
    causalPrincipal: causalPrincipal.identity,
    causalGrantIds: causalPrincipal.grantIds,
    authenticationMethod:
      options.authenticationMethod?.trim() || 'workload-identity',
    audience,
    trustedContextDigest,
    catalogRevision,
    authorityRevision,
    admittedAt,
    deadline,
    expiresAt: deadline,
    cancellationRevision,
    bindings: Object.freeze(bindings),
    effectiveAuthority: Object.freeze([]),
  });
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

/**
 * Shared request-ingress construction boundary. HTTP, browser/SSE, and
 * Kubernetes adapters authenticate their own transport evidence, then use this
 * helper so identity, authority, trusted context, operation identity,
 * correlation, and trace provenance cannot drift between gateways.
 */
export function createApplicationRequestAdmissionContextV1<
  TPrincipal extends ApplicationPrincipal,
>(
  options: CreateApplicationRequestAdmissionContextV1Options<TPrincipal>,
): ApplicationAdmissionContextV1 & { readonly principal: TPrincipal } {
  const context = createApplicationAdmissionContextV1(options);
  return options.trace
    ? withApplicationAdmissionTraceV1(context, options.trace)
    : context;
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
  return validateApplicationAdmissionContextStructureV1(
    value,
    options,
    validateReceipt,
  );
}

/**
 * Validates a canonical context for transports whose protocol forbids an
 * authorization receipt. Keeping this profile in the canonical owner lets
 * generated runtimes omit the operation-authority receipt verifier without
 * implementing a second admission parser.
 */
export function validateApplicationAdmissionContextV1WithoutReceipt(
  value: unknown,
  options: { readonly now?: number } = {},
): ApplicationAdmissionContextV1 {
  return validateApplicationAdmissionContextStructureV1(value, options);
}

function validateApplicationAdmissionContextStructureV1(
  value: unknown,
  options: { readonly now?: number },
  receiptValidator?: (
    receipt: ApplicationAuthorizationReceipt,
    principal: ApplicationPrincipal,
    operationId: string,
  ) => void,
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
    if (!receiptValidator) {
      throw admissionError(
        'ADMISSION_RECEIPT_INVALID',
        '$.authorizationReceipt',
        'Admission authorization receipt is forbidden for this transport',
      );
    }
    receiptValidator(authorizationReceipt, principal, operation.id);
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
): ApplicationAdmissionInvocationContextV1 {
  const { delivery: _delivery, ...view } = context;
  return Object.freeze(view);
}

const admissionTransports = '|actor|broker|control-plane|direct|framework|http|mcp|schedule|webhook|workflow|';
const executionKinds = '|actor|agent|job|task|workflow|processor|reconcile|';

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required.`);
  }
  return value.trim();
}

function timestamp(value: unknown, name: string): string {
  const candidate = nonEmpty(value, name);
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError(`${name} must be an ISO timestamp.`);
  }
  return parsed.toISOString();
}

function uniqueStrings(
  values: readonly string[],
  name: string,
  allowEmpty = false,
): readonly string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new TypeError(`${name} must contain at least one value.`);
  }
  const normalized = values.map((value) => nonEmpty(value, name));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${name} contains duplicate values.`);
  }
  return Object.freeze(normalized);
}

function validateIdentity(
  value: ApplicationIdentityReference,
  expectedKind: ApplicationIdentityReference['kind'] | undefined,
  name: string,
): ApplicationIdentityReference {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} is required.`);
  }
  const identity = Object.freeze({
    id: nonEmpty(value.id, `${name} ID`),
    kind: nonEmpty(value.kind, `${name} kind`) as ApplicationIdentityReference['kind'],
    issuer: nonEmpty(value.issuer, `${name} issuer`),
    subject: nonEmpty(value.subject, `${name} subject`),
  });
  if (expectedKind && identity.kind !== expectedKind) {
    throw new TypeError(`${name} must have kind ${expectedKind}.`);
  }
  return identity;
}

function sameIdentity(
  left: ApplicationIdentityReference,
  right: ApplicationIdentityReference,
): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.issuer === right.issuer
    && left.subject === right.subject;
}

function sameOptionalIdentity(
  left: ApplicationIdentityReference | undefined,
  right: ApplicationIdentityReference | undefined,
): boolean {
  if (!left || !right) return left === right;
  return sameIdentity(left, right);
}

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
