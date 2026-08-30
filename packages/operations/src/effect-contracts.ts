import type { JsonObject, JsonValue, RuntimeSchema } from '@applik8s/core';

export const EffectContractSchemaVersion = 'applik8s.effectContract/v1alpha1' as const;
export const EffectReceiptSchemaVersion = 'applik8s.effectReceipt/v1alpha1' as const;

export type EffectGuarantee =
  | 'frameworkFenced'
  | 'dependencyFenced'
  | 'idempotent'
  | 'receipted'
  | 'transactionalIntent'
  | 'unfencedExternal';

export interface EffectContractIdentity {
  readonly application: string;
  readonly capability: string;
  readonly method: string;
  readonly revision: string;
}

export interface EffectAuthorityRequirement {
  readonly operationId: string;
  readonly reauthorizeOnRetry: boolean;
}

export interface EffectIdempotencyContract {
  readonly mode: 'none' | 'logicalIdentity';
  readonly providerKey?: string;
}

export interface EffectFencingContract {
  readonly mode: 'none' | 'framework' | 'dependency';
  readonly providerToken?: string;
}

export interface EffectReceiptContract {
  readonly authority: 'framework' | 'provider' | 'transaction';
  readonly observation: 'unsupported' | 'byLogicalIdentity' | 'byProviderReceipt';
}

export interface EffectCancellationContract {
  readonly mode: 'unsupported' | 'bestEffort' | 'proven';
}

export interface EffectRetryContract {
  readonly mode: 'never' | 'afterProvenAbsent' | 'idempotent';
  readonly maximumAttempts: number;
}

export interface EffectCompensationContract {
  readonly effect: EffectContractIdentity;
  readonly permittedAfterUnknown: false;
}

/**
 * Provider-authored metadata for one effectful capability method. Application
 * code invokes the capability method directly; it never constructs this
 * contract or threads receipt/fence state itself.
 */
export interface EffectContract<TInput extends object, TResult extends object> {
  readonly apiVersion: typeof EffectContractSchemaVersion;
  readonly identity: EffectContractIdentity;
  readonly input: RuntimeSchema<TInput>;
  readonly result: RuntimeSchema<TResult>;
  readonly guarantees: readonly EffectGuarantee[];
  readonly authority: EffectAuthorityRequirement;
  readonly idempotency: EffectIdempotencyContract;
  readonly fencing: EffectFencingContract;
  readonly receipt: EffectReceiptContract;
  readonly cancellation: EffectCancellationContract;
  readonly retry: EffectRetryContract;
  readonly compensation?: EffectCompensationContract;
}

export interface EffectInvocationIdentity {
  readonly effect: EffectContractIdentity;
  readonly scope: string;
  readonly logicalId: string;
  readonly attemptId: string;
  readonly causalExecutionId: string;
  readonly causalPrincipalId?: string;
}

export interface EffectEvidence {
  readonly source: string;
  readonly observedAt: string;
  readonly reference?: string;
  readonly details?: JsonObject;
}

export interface EffectDurableErrorDescriptor {
  readonly name: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

export interface EffectPrincipalReference {
  readonly id: string;
  readonly kind: string;
}

export interface EffectEvidenceReference {
  readonly id: string;
  readonly kind: string;
}

interface EffectReceiptBase {
  readonly apiVersion: typeof EffectReceiptSchemaVersion;
  readonly receiptId: string;
  readonly identity: EffectInvocationIdentity;
  readonly recordedAt: string;
  readonly predecessorReceiptId?: string;
}

export type EffectReceipt<TResult extends JsonValue = JsonValue> =
  | EffectReceiptBase & { readonly status: 'admitted'; readonly admittedAt: string }
  | EffectReceiptBase & {
      readonly status: 'accepted';
      readonly providerReceipt: string;
    }
  | EffectReceiptBase & { readonly status: 'succeeded'; readonly result: TResult }
  | EffectReceiptBase & {
      readonly status: 'failed';
      readonly error: EffectDurableErrorDescriptor;
    }
  | EffectReceiptBase & { readonly status: 'cancelled'; readonly cancelledAt: string }
  | EffectReceiptBase & {
      readonly status: 'unknown';
      readonly lastEvidence: EffectEvidence;
    }
  | EffectReceiptBase & {
      readonly status: 'absent';
      readonly observedAt: string;
      readonly evidence: EffectEvidence;
      readonly safeToRetry: true;
    }
  | EffectReceiptBase & {
      readonly status: 'operatorResolved';
      readonly resolvedAt: string;
      readonly operator: EffectPrincipalReference;
      readonly reason: string;
      readonly evidenceReviewed: readonly EffectEvidenceReference[];
      readonly action: 'stop' | 'retryWithNewLogicalIdentity' | 'awaitFurtherEvidence';
      readonly acknowledgedRisk: string;
    };

export type EffectObservation<TResult extends JsonValue = JsonValue> =
  | { readonly status: 'succeeded'; readonly result: TResult; readonly evidence: EffectEvidence }
  | { readonly status: 'failed'; readonly error: EffectDurableErrorDescriptor; readonly evidence: EffectEvidence }
  | { readonly status: 'absent'; readonly evidence: EffectEvidence }
  | { readonly status: 'unknown'; readonly evidence: EffectEvidence };

export class EffectContractError extends Error {
  constructor(
    readonly code:
      | 'EFFECT_IDENTITY_UNSTABLE'
      | 'EFFECT_FENCE_UNSUPPORTED'
      | 'EFFECT_RETRY_UNSAFE'
      | 'EFFECT_RECEIPT_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'EffectContractError';
  }
}

export function defineEffectContract<TInput extends object, TResult extends object>(
  contract: EffectContract<TInput, TResult>,
): EffectContract<TInput, TResult> {
  validateEffectContract(contract);
  return Object.freeze({
    ...contract,
    guarantees: Object.freeze([...contract.guarantees]),
  });
}

export function validateEffectContract(
  contract: EffectContract<object, object>,
): void {
  if (contract.apiVersion !== EffectContractSchemaVersion) {
    throw new EffectContractError('EFFECT_IDENTITY_UNSTABLE', 'Unsupported effect contract schema.');
  }
  validateEffectContractIdentity(contract.identity);
  requireText(contract.authority.operationId, 'effect authority operation ID');
  if (!Number.isSafeInteger(contract.retry.maximumAttempts) || contract.retry.maximumAttempts < 1) {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Effect retry maximumAttempts must be a positive safe integer.');
  }
  const guarantees = new Set(contract.guarantees);
  if (guarantees.size !== contract.guarantees.length) {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Effect guarantees must not contain duplicates.');
  }
  if (guarantees.has('unfencedExternal') && (
    guarantees.has('frameworkFenced')
    || guarantees.has('dependencyFenced')
    || contract.fencing.mode === 'framework'
    || contract.fencing.mode === 'dependency'
  )) {
    throw new EffectContractError(
      'EFFECT_FENCE_UNSUPPORTED',
      'An unfenced external effect cannot claim dependency fencing.',
    );
  }
  if (contract.fencing.mode === 'dependency' && !guarantees.has('dependencyFenced')) {
    throw new EffectContractError('EFFECT_FENCE_UNSUPPORTED', 'Dependency fencing requires the dependencyFenced guarantee.');
  }
  if (contract.fencing.mode === 'framework' && !guarantees.has('frameworkFenced')) {
    throw new EffectContractError('EFFECT_FENCE_UNSUPPORTED', 'Framework fencing requires the frameworkFenced guarantee.');
  }
  if (guarantees.has('dependencyFenced') && contract.fencing.mode !== 'dependency') {
    throw new EffectContractError('EFFECT_FENCE_UNSUPPORTED', 'The dependencyFenced guarantee requires dependency fencing.');
  }
  if (guarantees.has('frameworkFenced') && contract.fencing.mode !== 'framework') {
    throw new EffectContractError('EFFECT_FENCE_UNSUPPORTED', 'The frameworkFenced guarantee requires framework fencing.');
  }
  if (contract.idempotency.mode === 'logicalIdentity' && !guarantees.has('idempotent')) {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Logical-identity idempotency requires the idempotent guarantee.');
  }
  if (contract.retry.mode === 'idempotent' && contract.idempotency.mode !== 'logicalIdentity') {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Idempotent retry requires logical-identity idempotency.');
  }
  if (contract.retry.mode === 'afterProvenAbsent' && contract.receipt.observation === 'unsupported') {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Retry after absence requires a provider observation path.');
  }
  if (contract.retry.mode === 'never' && contract.retry.maximumAttempts !== 1) {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'A non-retryable effect must declare exactly one attempt.');
  }
  if (guarantees.has('transactionalIntent') && contract.receipt.authority !== 'transaction') {
    throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Transactional intent requires transaction-owned receipts.');
  }
  if (contract.compensation) {
    validateEffectContractIdentity(contract.compensation.effect);
    if (contract.compensation.permittedAfterUnknown !== false) {
      throw new EffectContractError('EFFECT_RETRY_UNSAFE', 'Compensation must fail closed for unknown original outcomes.');
    }
  }
}

export function validateEffectInvocationIdentity(identity: EffectInvocationIdentity): void {
  validateEffectContractIdentity(identity.effect);
  requireText(identity.scope, 'effect scope');
  requireText(identity.logicalId, 'effect logical ID');
  requireText(identity.attemptId, 'effect attempt ID');
  requireText(identity.causalExecutionId, 'effect causal execution ID');
  if (identity.causalPrincipalId !== undefined) requireText(identity.causalPrincipalId, 'effect causal principal ID');
}

export function validateEffectReceipt<TResult extends JsonValue>(
  receipt: EffectReceipt<TResult>,
): EffectReceipt<TResult> {
  if (receipt.apiVersion !== EffectReceiptSchemaVersion) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', 'Unsupported effect receipt schema.');
  }
  requireText(receipt.receiptId, 'effect receipt ID');
  validateEffectInvocationIdentity(receipt.identity);
  requireTimestamp(receipt.recordedAt, 'effect receipt recordedAt');
  if (receipt.predecessorReceiptId !== undefined) requireText(receipt.predecessorReceiptId, 'effect predecessor receipt ID');
  switch (receipt.status) {
    case 'admitted':
      requireTimestamp(receipt.admittedAt, 'effect admission time');
      break;
    case 'accepted':
      requireText(receipt.providerReceipt, 'provider receipt');
      break;
    case 'succeeded':
      assertJson(receipt.result, 'effect result');
      break;
    case 'failed':
      requireText(receipt.error.name, 'durable error name');
      requireText(receipt.error.message, 'durable error message');
      if (receipt.error.details !== undefined) assertJson(receipt.error.details, 'durable error details');
      break;
    case 'cancelled':
      requireTimestamp(receipt.cancelledAt, 'effect cancellation time');
      break;
    case 'unknown':
      validateEvidence(receipt.lastEvidence);
      break;
    case 'absent':
      if (receipt.safeToRetry !== true) throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', 'Absent receipts must explicitly authorize retry.');
      requireTimestamp(receipt.observedAt, 'effect absence observation time');
      validateEvidence(receipt.evidence);
      break;
    case 'operatorResolved':
      requireTimestamp(receipt.resolvedAt, 'effect operator resolution time');
      requireText(receipt.operator.id, 'effect operator ID');
      requireText(receipt.operator.kind, 'effect operator kind');
      requireText(receipt.reason, 'effect operator resolution reason');
      requireText(receipt.acknowledgedRisk, 'effect acknowledged risk');
      for (const evidence of receipt.evidenceReviewed) {
        requireText(evidence.id, 'effect evidence reference ID');
        requireText(evidence.kind, 'effect evidence reference kind');
      }
      break;
  }
  return receipt;
}

/**
 * Validates the immutable append-only receipt chain for one logical effect.
 * It deliberately rejects terminal rewrites and requires unknown outcomes to
 * be resolved through observation or an explicit operator disposition.
 */
export function appendEffectReceipt<TResult extends JsonValue>(
  history: readonly EffectReceipt<TResult>[],
  next: EffectReceipt<TResult>,
): readonly EffectReceipt<TResult>[] {
  validateEffectReceipt(next);
  const previous = history.at(-1);
  if (!previous) {
    if (next.status !== 'admitted' || next.predecessorReceiptId !== undefined) {
      throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', 'An effect receipt chain must begin with admission.');
    }
    return Object.freeze([next]);
  }
  validateEffectReceipt(previous);
  if (!sameLogicalEffect(previous.identity, next.identity)) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', 'Effect receipt identity changed within one logical chain.');
  }
  if (next.predecessorReceiptId !== previous.receiptId) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', `Effect receipt ${next.receiptId} must follow ${previous.receiptId}.`);
  }
  if (Date.parse(next.recordedAt) < Date.parse(previous.recordedAt)) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', 'Effect receipt time moved backwards.');
  }
  if (!allowedTransitions[previous.status].has(next.status)) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', `Effect receipt cannot transition from ${previous.status} to ${next.status}.`);
  }
  if (history.some(({ receiptId }) => receiptId === next.receiptId)) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', `Effect receipt ID ${next.receiptId} is already present.`);
  }
  return Object.freeze([...history, next]);
}

const allowedTransitions: Readonly<Record<EffectReceipt['status'], ReadonlySet<EffectReceipt['status']>>> = {
  admitted: new Set(['accepted', 'succeeded', 'failed', 'cancelled', 'unknown']),
  accepted: new Set(['succeeded', 'failed', 'cancelled', 'unknown']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  unknown: new Set(['succeeded', 'failed', 'absent', 'operatorResolved']),
  absent: new Set(),
  operatorResolved: new Set(['succeeded', 'failed', 'absent']),
};

function validateEffectContractIdentity(identity: EffectContractIdentity): void {
  requireText(identity.application, 'effect application');
  requireText(identity.capability, 'effect capability');
  requireText(identity.method, 'effect method');
  requireText(identity.revision, 'effect revision');
}

function sameLogicalEffect(left: EffectInvocationIdentity, right: EffectInvocationIdentity): boolean {
  return left.scope === right.scope
    && left.logicalId === right.logicalId
    && left.causalExecutionId === right.causalExecutionId
    && left.causalPrincipalId === right.causalPrincipalId
    && left.effect.application === right.effect.application
    && left.effect.capability === right.effect.capability
    && left.effect.method === right.effect.method
    && left.effect.revision === right.effect.revision;
}

function validateEvidence(evidence: EffectEvidence): void {
  requireText(evidence.source, 'effect evidence source');
  requireTimestamp(evidence.observedAt, 'effect evidence observation time');
  if (evidence.reference !== undefined) requireText(evidence.reference, 'effect evidence reference');
  if (evidence.details !== undefined) assertJson(evidence.details, 'effect evidence details');
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new EffectContractError('EFFECT_IDENTITY_UNSTABLE', `${label} must be non-empty.`);
}

function requireTimestamp(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', `${label} must be an ISO-compatible timestamp.`);
  }
}

function assertJson(value: unknown, label: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertJson(entry, label);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertJson(entry, label);
    return;
  }
  throw new EffectContractError('EFFECT_RECEIPT_CONFLICT', `${label} must be finite JSON.`);
}
