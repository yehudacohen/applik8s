// typecast-file-boundary: provider-accounting validates discriminated inputs and opaque wire references before rebuilding their narrowed public contract shapes.
import { createHash } from 'node:crypto';

/**
 * Provider-call accounting is source evidence, not customer billing.
 *
 * Opaque references are branded only at the TypeScript boundary. They are
 * ordinary strings on the wire and in PostgreSQL.
 */
export type ApplicationProviderAccountingRef<Kind extends string> = string & {
  readonly __applicationProviderAccountingRef: Kind;
};

export type ApplicationProviderCallRef =
  ApplicationProviderAccountingRef<'provider-call'>;
export type ApplicationUsageEvidenceRef =
  ApplicationProviderAccountingRef<'usage-evidence'>;
export type ApplicationProviderCostRecordRef =
  ApplicationProviderAccountingRef<'provider-cost-record'>;
export type ApplicationProviderReconciliationRef =
  ApplicationProviderAccountingRef<'provider-reconciliation'>;

export type ApplicationProviderCallTerminalState =
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ApplicationProviderCallState =
  | 'started'
  | 'uncertain'
  | ApplicationProviderCallTerminalState;

export interface ApplicationProviderCallPlan {
  /** Idempotency identity for exactly one external provider request. */
  readonly providerCallId: string;
  /** Versioned canonical digest of every semantic request field. */
  readonly canonicalRequestHash: string;
  readonly principalScope: string;
  readonly operationRef: string;
  readonly provider: string;
  readonly capability: string;
  /** Reservation established before the external request is issued. */
  readonly reservationRef: string;
  readonly startedAt: string;
}

export interface ApplicationProviderCallRecord
  extends ApplicationProviderCallPlan {
  readonly ref: ApplicationProviderCallRef;
  readonly state: ApplicationProviderCallState;
  readonly providerRequestRef?: string;
  readonly usageEvidenceRef?: ApplicationUsageEvidenceRef;
  readonly providerCostRecordRef?: ApplicationProviderCostRecordRef;
  readonly provisionalUsageEvidenceRef?: ApplicationUsageEvidenceRef;
  readonly provisionalProviderCostRecordRef?: ApplicationProviderCostRecordRef;
  readonly reconciliationRef?: ApplicationProviderReconciliationRef;
  readonly uncertaintyId?: string;
  readonly uncertaintyRequestHash?: string;
  readonly finalizationId?: string;
  readonly finalizationRequestHash?: string;
  readonly uncertainAt?: string;
  readonly completedAt?: string;
}

interface ApplicationProviderCostInputBase {
  /** Idempotency identity for exactly one immutable cost record. */
  readonly costRecordId: string;
  /** Versioned canonical digest of this cost-record payload. */
  readonly canonicalRequestHash: string;
  readonly currency: string;
  readonly sourceEvidenceRef: string;
  readonly pricingRevision?: string;
  readonly allocationMethod?: string;
}

export type ApplicationProviderCostInput =
  | (ApplicationProviderCostInputBase & {
      readonly kind: 'zero';
      readonly amountMicrounits?: 0;
      readonly usageEvidenceRef: ApplicationUsageEvidenceRef;
      readonly reconcilesCostRecordRef?: ApplicationProviderCostRecordRef;
    })
  | (ApplicationProviderCostInputBase & {
      readonly kind: 'actual';
      readonly amountMicrounits: number;
      readonly usageEvidenceRef: ApplicationUsageEvidenceRef;
      readonly reconcilesCostRecordRef?: ApplicationProviderCostRecordRef;
    })
  | (ApplicationProviderCostInputBase & {
      readonly kind: 'provisional';
      readonly amountMicrounits: number;
      readonly usageEvidenceRef?: ApplicationUsageEvidenceRef;
      readonly reconcilesCostRecordRef?: never;
    })
  | (ApplicationProviderCostInputBase & {
      /** Signed immutable delta created by later invoice reconciliation. */
      readonly kind: 'adjustment';
      readonly amountMicrounits: number;
      readonly usageEvidenceRef?: ApplicationUsageEvidenceRef;
      readonly reconcilesCostRecordRef: ApplicationProviderCostRecordRef;
    });

export interface ApplicationProviderCostRecord {
  readonly ref: ApplicationProviderCostRecordRef;
  readonly providerCallRef: ApplicationProviderCallRef;
  readonly principalScope: string;
  readonly costRecordId: string;
  readonly canonicalRequestHash: string;
  readonly kind: ApplicationProviderCostInput['kind'];
  readonly currency: string;
  readonly amountMicrounits: number;
  readonly usageEvidenceRef?: ApplicationUsageEvidenceRef;
  readonly sourceEvidenceRef: string;
  readonly pricingRevision?: string;
  readonly allocationMethod?: string;
  readonly reconcilesCostRecordRef?: ApplicationProviderCostRecordRef;
  readonly recordedAt: string;
}

export interface ApplicationProviderCallUncertainty {
  /** Idempotency identity for the uncertainty transition. */
  readonly uncertaintyId: string;
  readonly canonicalRequestHash: string;
  readonly providerCallRef: ApplicationProviderCallRef;
  readonly providerRequestRef?: string;
  readonly provisionalUsageEvidenceRef?: ApplicationUsageEvidenceRef;
  readonly provisionalCost?: Extract<
    ApplicationProviderCostInput,
    { readonly kind: 'provisional' }
  >;
  readonly uncertainAt: string;
}

export interface ApplicationProviderCallFinalization {
  /** Idempotency identity for the terminal transition. */
  readonly finalizationId: string;
  readonly canonicalRequestHash: string;
  readonly providerCallRef: ApplicationProviderCallRef;
  readonly state: ApplicationProviderCallTerminalState;
  readonly providerRequestRef?: string;
  readonly usageEvidenceRef: ApplicationUsageEvidenceRef;
  readonly cost: Extract<
    ApplicationProviderCostInput,
    { readonly kind: 'actual' | 'zero' }
  >;
  readonly completedAt: string;
}

export interface ApplicationProviderCallReconciliation
  extends Omit<ApplicationProviderCallFinalization, 'providerCallRef'> {
  readonly reconciliationRef: ApplicationProviderReconciliationRef;
}

export interface ApplicationProviderCostAdjustment {
  readonly providerCallRef: ApplicationProviderCallRef;
  readonly cost: Extract<
    ApplicationProviderCostInput,
    { readonly kind: 'adjustment' }
  >;
  readonly recordedAt: string;
}

export interface ApplicationProviderCallAccounting {
  begin(
    plan: ApplicationProviderCallPlan,
  ): Promise<ApplicationProviderCallRecord>;
  markUncertain(
    uncertainty: ApplicationProviderCallUncertainty,
  ): Promise<ApplicationProviderCallRecord>;
  finalize(
    finalization: ApplicationProviderCallFinalization,
  ): Promise<ApplicationProviderCallRecord>;
  reconcile(
    reconciliation: ApplicationProviderCallReconciliation,
  ): Promise<ApplicationProviderCallRecord>;
  recordAdjustment(
    adjustment: ApplicationProviderCostAdjustment,
  ): Promise<ApplicationProviderCostRecord>;
  getCall(
    ref: ApplicationProviderCallRef,
  ): Promise<ApplicationProviderCallRecord | undefined>;
  getCostRecord(
    ref: ApplicationProviderCostRecordRef,
  ): Promise<ApplicationProviderCostRecord | undefined>;
  /** Runtime-store lookup used to bind an opaque reconciliation handle. */
  getCallFromReconciliation(
    ref: ApplicationProviderReconciliationRef,
  ): Promise<ApplicationProviderCallRecord | undefined>;
}

/**
 * Application-facing accounting authority injected into one admitted task.
 *
 * Scope, opaque storage identities, and all timestamps are owned by the
 * runtime. Application code supplies only the semantic request and its exact
 * versioned digest.
 */
export interface ApplicationProviderCallAccountingHandle {
  begin(
    plan: ApplicationProviderCallPlanInput,
  ): Promise<ApplicationProviderCallRecord>;
  markUncertain(
    uncertainty: ApplicationProviderCallUncertaintyInput,
  ): Promise<ApplicationProviderCallRecord>;
  finalize(
    finalization: ApplicationProviderCallFinalizationInput,
  ): Promise<ApplicationProviderCallRecord>;
  reconcile(
    reconciliation: ApplicationProviderCallReconciliationInput,
  ): Promise<ApplicationProviderCallRecord>;
  recordAdjustment(
    adjustment: ApplicationProviderCostAdjustmentInput,
  ): Promise<ApplicationProviderCostRecord>;
  getCall(
    ref: ApplicationProviderCallRef,
  ): Promise<ApplicationProviderCallRecord | undefined>;
  getCostRecord(
    ref: ApplicationProviderCostRecordRef,
  ): Promise<ApplicationProviderCostRecord | undefined>;
}

export type ApplicationProviderCallPlanInput = Omit<ApplicationProviderCallPlan, 'principalScope' | 'startedAt'>;
export type ApplicationProviderCallUncertaintyInput = Omit<ApplicationProviderCallUncertainty, 'uncertainAt'>;
export type ApplicationProviderCallFinalizationInput = Omit<ApplicationProviderCallFinalization, 'completedAt'>;
export type ApplicationProviderCallReconciliationInput = Omit<ApplicationProviderCallReconciliation, 'completedAt'>;
export type ApplicationProviderCostAdjustmentInput = Omit<ApplicationProviderCostAdjustment, 'recordedAt'>;

export interface ApplicationProviderAccountingAdmittedAuthority {
  readonly principal: {
    readonly id: string;
    readonly identity?: {
      readonly id: string;
      readonly issuer: string;
      readonly subject: string;
    };
  };
  readonly trustedContext?: {
    readonly digest: string;
    readonly values: Readonly<Record<string, unknown>>;
  };
  readonly now?: () => string;
}

export class ApplicationProviderAccountingRequestHashError extends Error {
  readonly code = 'APPLIK8S_PROVIDER_ACCOUNTING_REQUEST_HASH_MISMATCH';

  constructor(
    readonly operation: ApplicationProviderAccountingConflictOperation,
    readonly submittedRequestHash: string,
    readonly expectedRequestHash: string,
  ) {
    super(`Provider accounting ${operation} canonical request hash does not match its semantic payload.`);
    this.name = 'ApplicationProviderAccountingRequestHashError';
  }
}

export function applicationProviderCallPlanHashV1(
  input: Pick<ApplicationProviderCallPlan, 'operationRef' | 'provider' | 'capability' | 'reservationRef'>,
): string {
  return accountingDigest('provider-call-plan-v1', [
    input.operationRef,
    input.provider,
    input.capability,
    input.reservationRef,
  ]);
}

export function applicationProviderCallUncertaintyHashV1(
  input: Omit<ApplicationProviderCallUncertainty, 'uncertaintyId' | 'canonicalRequestHash' | 'uncertainAt'>,
): string {
  return accountingDigest('provider-call-uncertainty-v1', [
    input.providerCallRef,
    input.providerRequestRef ?? null,
    input.provisionalUsageEvidenceRef ?? null,
    input.provisionalCost
      ? [input.provisionalCost.costRecordId, input.provisionalCost.canonicalRequestHash]
      : null,
  ]);
}

export function applicationProviderCallFinalizationHashV1(
  input: Omit<ApplicationProviderCallFinalization, 'finalizationId' | 'canonicalRequestHash' | 'completedAt'>,
): string {
  return accountingDigest('provider-call-finalization-v1', [
    input.providerCallRef,
    input.state,
    input.providerRequestRef ?? null,
    input.usageEvidenceRef,
    input.cost.costRecordId,
    input.cost.canonicalRequestHash,
  ]);
}

export function applicationProviderCallReconciliationHashV1(
  input: Omit<ApplicationProviderCallReconciliation, 'finalizationId' | 'canonicalRequestHash' | 'completedAt'>,
): string {
  return accountingDigest('provider-call-reconciliation-v1', [
    input.reconciliationRef,
    input.state,
    input.providerRequestRef ?? null,
    input.usageEvidenceRef,
    input.cost.costRecordId,
    input.cost.canonicalRequestHash,
  ]);
}

export function applicationProviderCostHashV1(
  providerCallRef: ApplicationProviderCallRef,
  input: Omit<ApplicationProviderCostInput, 'canonicalRequestHash'>,
): string {
  return accountingDigest('provider-cost-v1', [
    providerCallRef,
    input.kind,
    input.currency,
    input.kind === 'zero' ? 0 : input.amountMicrounits,
    input.usageEvidenceRef ?? null,
    input.sourceEvidenceRef,
    input.pricingRevision ?? null,
    input.allocationMethod ?? null,
    input.reconcilesCostRecordRef ?? null,
  ]);
}

/** Binds the raw store to compiler-admitted authority for one task attempt. */
export function bindApplicationProviderCallAccounting(
  store: ApplicationProviderCallAccounting,
  authority: ApplicationProviderAccountingAdmittedAuthority,
): ApplicationProviderCallAccountingHandle {
  const principalScope = applicationProviderAccountingPrincipalScope(authority);
  const now = () => {
    const value = authority.now?.() ?? new Date().toISOString();
    validateInstant(value, 'runtime timestamp');
    return value;
  };
  const scopedIdentity = (kind: string, identity: string) => {
    validateIdentity(identity, kind);
    return accountingDigest(`provider-accounting-${kind}-identity-v1`, [principalScope, identity]);
  };
  const scopedCost = (
    operation: ApplicationProviderAccountingConflictOperation,
    ref: ApplicationProviderCallRef,
    cost: ApplicationProviderCostInput,
  ): ApplicationProviderCostInput => {
    // The public hash covers the caller-visible semantic payload. The
    // compiler-owned partition may rewrite only the private storage identity
    // after that public contract has been validated.
    assertExactHash(
      operation,
      cost.canonicalRequestHash,
      applicationProviderCostHashV1(ref, cost),
    );
    const costRecordId = scopedIdentity('cost', cost.costRecordId);
    return { ...cost, costRecordId } as ApplicationProviderCostInput;
  };

  return Object.freeze({
    async begin(plan: ApplicationProviderCallPlanInput) {
      validateIdentity(plan.providerCallId, 'providerCallId');
      assertExactHash('begin', plan.canonicalRequestHash, applicationProviderCallPlanHashV1(plan));
      const providerCallId = scopedIdentity('call', plan.providerCallId);
      return store.begin({
        ...plan,
        providerCallId,
        principalScope,
        startedAt: now(),
      });
    },
    async markUncertain(input: ApplicationProviderCallUncertaintyInput) {
      await requireScopedCall(input.providerCallRef);
      validateUncertainty(input);
      assertExactHash('markUncertain', input.canonicalRequestHash, applicationProviderCallUncertaintyHashV1(input));
      return store.markUncertain({
        ...input,
        uncertaintyId: scopedIdentity('uncertainty', input.uncertaintyId),
        ...(input.provisionalCost
          ? { provisionalCost: scopedCost('markUncertain', input.providerCallRef, input.provisionalCost) as Extract<ApplicationProviderCostInput, { readonly kind: 'provisional' }> }
          : {}),
        uncertainAt: now(),
      });
    },
    async finalize(input: ApplicationProviderCallFinalizationInput) {
      await requireScopedCall(input.providerCallRef);
      validateFinalizationSemanticFields(input);
      assertExactHash('finalize', input.canonicalRequestHash, applicationProviderCallFinalizationHashV1(input));
      return store.finalize({
        ...input,
        finalizationId: scopedIdentity('finalization', input.finalizationId),
        cost: scopedCost('finalize', input.providerCallRef, input.cost) as Extract<ApplicationProviderCostInput, { readonly kind: 'actual' | 'zero' }>,
        completedAt: now(),
      });
    },
    async reconcile(input: ApplicationProviderCallReconciliationInput) {
      validateIdentity(input.reconciliationRef, 'reconciliationRef');
      const call = await store.getCallFromReconciliation(input.reconciliationRef);
      const providerCallRef = call?.ref;
      if (!providerCallRef || call.principalScope !== principalScope) {
        throw new Error(`Provider reconciliation ${input.reconciliationRef} was not found.`);
      }
      validateFinalizationSemanticFields({ ...input, providerCallRef });
      assertExactHash('reconcile', input.canonicalRequestHash, applicationProviderCallReconciliationHashV1(input));
      return store.reconcile({
        ...input,
        finalizationId: scopedIdentity('finalization', input.finalizationId),
        cost: scopedCost('reconcile', providerCallRef, input.cost) as Extract<ApplicationProviderCostInput, { readonly kind: 'actual' | 'zero' }>,
        completedAt: now(),
      });
    },
    async recordAdjustment(input: ApplicationProviderCostAdjustmentInput) {
      await requireScopedCall(input.providerCallRef);
      return store.recordAdjustment({
        ...input,
        cost: scopedCost('recordAdjustment', input.providerCallRef, input.cost) as Extract<ApplicationProviderCostInput, { readonly kind: 'adjustment' }>,
        recordedAt: now(),
      });
    },
    async getCall(ref: ApplicationProviderCallRef) {
      const record = await store.getCall(ref);
      return record?.principalScope === principalScope ? record : undefined;
    },
    async getCostRecord(ref: ApplicationProviderCostRecordRef) {
      const record = await store.getCostRecord(ref);
      if (!record) return undefined;
      const call = await store.getCall(record.providerCallRef);
      return call?.principalScope === principalScope ? record : undefined;
    },
  });

  async function requireScopedCall(ref: ApplicationProviderCallRef): Promise<ApplicationProviderCallRecord> {
    validateIdentity(ref, 'providerCallRef');
    const call = await store.getCall(ref);
    if (!call || call.principalScope !== principalScope) {
      throw new Error(`Provider call ${ref} was not found.`);
    }
    return call;
  }
}

export function applicationProviderAccountingPrincipalScope(
  authority: ApplicationProviderAccountingAdmittedAuthority,
): string {
  validateIdentity(authority.principal.id, 'principal.id');
  if (authority.trustedContext) {
    validateSha256Digest(
      authority.trustedContext.digest,
      'trustedContext.digest',
    );
  }
  const values = authority.trustedContext?.values;
  if (
    values
    && Object.hasOwn(values, 'principalScope')
  ) {
    const admittedScope = values.principalScope;
    if (typeof admittedScope !== 'string') {
      throw new Error(
        'trustedContext.values.principalScope must be a non-empty string.',
      );
    }
    validateIdentity(
      admittedScope,
      'trustedContext.values.principalScope',
    );
    return admittedScope;
  }

  // The maintained identity convention uses the authenticated principal ID
  // for personal work and replaces it with an admitted workspace ID only when
  // workspace access is proven. Internal/personal calls without that optional
  // trusted-context field therefore retain the same personal boundary.
  return authority.principal.id;
}

export type ApplicationProviderAccountingConflictOperation =
  | 'begin'
  | 'markUncertain'
  | 'finalize'
  | 'reconcile'
  | 'recordAdjustment';

export class ApplicationProviderAccountingPlanConflictError extends Error {
  readonly code = 'APPLIK8S_PROVIDER_ACCOUNTING_PLAN_CONFLICT';

  constructor(
    readonly operation: ApplicationProviderAccountingConflictOperation,
    readonly identity: string,
    readonly authoritativeRequestHash: string,
    readonly submittedRequestHash: string,
  ) {
    super(
      `Provider accounting ${operation} identity ${identity} was reused with a different canonical request hash.`,
    );
    this.name = 'ApplicationProviderAccountingPlanConflictError';
  }
}

export class ApplicationProviderAccountingStateError extends Error {
  readonly code = 'APPLIK8S_PROVIDER_ACCOUNTING_STATE_CONFLICT';

  constructor(
    readonly providerCallRef: ApplicationProviderCallRef,
    readonly state: ApplicationProviderCallState,
    readonly attemptedTransition:
      | 'markUncertain'
      | 'finalize'
      | 'reconcile'
      | 'recordAdjustment',
  ) {
    super(
      `Provider call ${providerCallRef} in state ${state} cannot accept ${attemptedTransition}.`,
    );
    this.name = 'ApplicationProviderAccountingStateError';
  }
}

/**
 * Deterministic reference implementation and provider conformance fixture.
 *
 * Production stores must provide the same atomicity: a terminal/provisional
 * cost row and its provider-call transition commit together. This in-memory
 * implementation serializes each public operation synchronously before its
 * promise resolves, so concurrent equivalent calls retain one record.
 */
export function createInMemoryApplicationProviderCallAccounting(
): ApplicationProviderCallAccounting {
  const calls = new Map<ApplicationProviderCallRef, ApplicationProviderCallRecord>();
  const callRefsById = new Map<string, ApplicationProviderCallRef>();
  const costs = new Map<ApplicationProviderCostRecordRef, ApplicationProviderCostRecord>();
  const costRefsById = new Map<string, ApplicationProviderCostRecordRef>();
  const requiredCall = (ref: ApplicationProviderCallRef) => {
    const call = calls.get(ref);
    if (!call) throw new Error(`Provider call ${ref} was not found.`);
    return call;
  };

  const persistCost = (
    operation: ApplicationProviderAccountingConflictOperation,
    providerCallRef: ApplicationProviderCallRef,
    input: ApplicationProviderCostInput,
    recordedAt: string,
  ): ApplicationProviderCostRecord => {
    validateCostInput(input);
    if (input.reconcilesCostRecordRef) {
      const reconciled = costs.get(input.reconcilesCostRecordRef);
      if (!reconciled) {
        throw new Error(
          `Provider cost record ${input.reconcilesCostRecordRef} was not found.`,
        );
      }
      if (reconciled.providerCallRef !== providerCallRef) {
        throw new Error(
          'A provider cost record may reconcile only a record from the same provider call.',
        );
      }
      if (reconciled.currency !== input.currency) {
        throw new Error(
          'A provider cost reconciliation must retain the source currency.',
        );
      }
    }
    const existingRef = costRefsById.get(input.costRecordId);
    if (existingRef) {
      const existing = requiredValue(
        costs.get(existingRef),
        `Provider cost record ${existingRef} was not found.`,
      );
      assertEquivalent(
        operation,
        input.costRecordId,
        existing.canonicalRequestHash,
        input.canonicalRequestHash,
      );
      if (
        existing.providerCallRef !== providerCallRef
        || costSemanticKey(existing) !== costSemanticKey(input)
      ) {
          throw new ApplicationProviderAccountingPlanConflictError(
          operation,
          input.costRecordId,
          existing.canonicalRequestHash,
          input.canonicalRequestHash,
        );
      }
      return existing;
    }
    const ref = providerCostRecordRef(input.costRecordId);
    const record = immutable({
      ref,
      providerCallRef,
      principalScope: requiredCall(providerCallRef).principalScope,
      costRecordId: input.costRecordId,
      canonicalRequestHash: input.canonicalRequestHash,
      kind: input.kind,
      currency: input.currency,
      amountMicrounits: input.kind === 'zero'
        ? 0
        : input.amountMicrounits,
      ...(input.usageEvidenceRef
        ? { usageEvidenceRef: input.usageEvidenceRef }
        : {}),
      sourceEvidenceRef: input.sourceEvidenceRef,
      ...(input.pricingRevision
        ? { pricingRevision: input.pricingRevision }
        : {}),
      ...(input.allocationMethod
        ? { allocationMethod: input.allocationMethod }
        : {}),
      ...(input.reconcilesCostRecordRef
        ? { reconcilesCostRecordRef: input.reconcilesCostRecordRef }
        : {}),
      recordedAt,
    } satisfies ApplicationProviderCostRecord);
    costs.set(ref, record);
    costRefsById.set(input.costRecordId, ref);
    return record;
  };

  return {
    async begin(input) {
      validateCallPlan(input);
      const existingRef = callRefsById.get(input.providerCallId);
      if (existingRef) {
        const existing = requiredValue(
          calls.get(existingRef),
          `Provider call ${existingRef} was not found.`,
        );
        assertEquivalent(
          'begin',
          input.providerCallId,
          existing.canonicalRequestHash,
          input.canonicalRequestHash,
        );
        if (callPlanSemanticKey(existing) !== callPlanSemanticKey(input)) {
          throw new ApplicationProviderAccountingPlanConflictError(
            'begin',
            input.providerCallId,
            existing.canonicalRequestHash,
            input.canonicalRequestHash,
          );
        }
        return existing;
      }
      const ref = providerCallRef(input.providerCallId);
      const record = immutable({ ...input, ref, state: 'started' as const });
      calls.set(ref, record);
      callRefsById.set(input.providerCallId, ref);
      return record;
    },

    async markUncertain(input) {
      validateIdentity(input.uncertaintyId, 'uncertaintyId');
      validateHash(input.canonicalRequestHash);
      validateInstant(input.uncertainAt, 'uncertainAt');
      const call = requiredCall(input.providerCallRef);
      if (Date.parse(input.uncertainAt) < Date.parse(call.startedAt)) {
        throw new Error('Provider call uncertainty cannot precede dispatch.');
      }
      if (call.state === 'uncertain') {
        const uncertaintyRequestHash = requiredValue(
          call.uncertaintyRequestHash,
          `Uncertain provider call ${call.ref} has no request hash.`,
        );
        assertEquivalent(
          'markUncertain',
          input.uncertaintyId,
          uncertaintyRequestHash,
          input.canonicalRequestHash,
        );
        if (call.uncertaintyId !== input.uncertaintyId) {
          throw new ApplicationProviderAccountingPlanConflictError(
            'markUncertain',
            input.uncertaintyId,
            uncertaintyRequestHash,
            input.canonicalRequestHash,
          );
        }
        const submittedProvisionalCostRef = input.provisionalCost
          ? providerCostRecordRef(input.provisionalCost.costRecordId)
          : undefined;
        const submittedProvisionalUsageRef =
          input.provisionalUsageEvidenceRef
          ?? input.provisionalCost?.usageEvidenceRef;
        if (
          call.providerRequestRef !== input.providerRequestRef
          || call.provisionalUsageEvidenceRef
            !== submittedProvisionalUsageRef
          || call.provisionalProviderCostRecordRef
            !== submittedProvisionalCostRef
        ) {
          throw new ApplicationProviderAccountingPlanConflictError(
            'markUncertain',
            input.uncertaintyId,
            uncertaintyRequestHash,
            input.canonicalRequestHash,
          );
        }
        if (input.provisionalCost) {
          persistCost(
            'markUncertain',
            call.ref,
            input.provisionalCost,
            input.uncertainAt,
          );
        }
        return call;
      }
      if (call.state !== 'started') {
        throw new ApplicationProviderAccountingStateError(
          call.ref,
          call.state,
          'markUncertain',
        );
      }
      if (
        input.provisionalUsageEvidenceRef
        && input.provisionalCost?.usageEvidenceRef
        && input.provisionalUsageEvidenceRef
          !== input.provisionalCost.usageEvidenceRef
      ) {
        throw new Error(
          'Provisional provider cost and provider-call usage evidence must match.',
        );
      }
      const provisionalUsageEvidenceRef =
        input.provisionalUsageEvidenceRef
        ?? input.provisionalCost?.usageEvidenceRef;
      const provisional = input.provisionalCost
        ? persistCost(
            'markUncertain',
            call.ref,
            input.provisionalCost,
            input.uncertainAt,
          )
        : undefined;
      const reconciliationRef = providerReconciliationRef(input.uncertaintyId);
      const next = immutable({
        ...call,
        state: 'uncertain' as const,
        uncertaintyId: input.uncertaintyId,
        uncertaintyRequestHash: input.canonicalRequestHash,
        reconciliationRef,
        ...(input.providerRequestRef
          ? { providerRequestRef: input.providerRequestRef }
          : {}),
        ...(provisionalUsageEvidenceRef
          ? { provisionalUsageEvidenceRef }
          : {}),
        ...(provisional
          ? { provisionalProviderCostRecordRef: provisional.ref }
          : {}),
        uncertainAt: input.uncertainAt,
      } satisfies ApplicationProviderCallRecord);
      calls.set(call.ref, next);
      return next;
    },

    async finalize(input) {
      return terminalize('finalize', requiredCall(input.providerCallRef), input);
    },

    async reconcile(input) {
      const call = requiredCallFromReconciliation(input.reconciliationRef, calls);
      if (call.state !== 'uncertain' && !isTerminal(call.state)) {
        throw new ApplicationProviderAccountingStateError(
          call.ref,
          call.state,
          'reconcile',
        );
      }
      if (
        call.providerRequestRef
        && input.providerRequestRef
        && call.providerRequestRef !== input.providerRequestRef
      ) {
        const authoritativeRequestHash =
          applicationProviderCallReconciliationHashV1({
            ...input,
            providerRequestRef: call.providerRequestRef,
          });
        throw new ApplicationProviderAccountingPlanConflictError(
          'reconcile',
          input.finalizationId,
          authoritativeRequestHash,
          input.canonicalRequestHash,
        );
      }
      return terminalize('reconcile', call, {
        ...input,
        providerCallRef: call.ref,
      });
    },

    async recordAdjustment(input) {
      validateInstant(input.recordedAt, 'recordedAt');
      const call = requiredCall(input.providerCallRef);
      if (!isTerminal(call.state)) {
        throw new ApplicationProviderAccountingStateError(
          call.ref,
          call.state,
          'recordAdjustment',
        );
      }
      return persistCost(
        'recordAdjustment',
        call.ref,
        input.cost,
        input.recordedAt,
      );
    },

    async getCall(ref) {
      return calls.get(ref);
    },

    async getCostRecord(ref) {
      return costs.get(ref);
    },

    async getCallFromReconciliation(ref) {
      for (const call of calls.values()) {
        if (call.reconciliationRef === ref) return call;
      }
      return undefined;
    },
  };

  function terminalize(
    operation: 'finalize' | 'reconcile',
    call: ApplicationProviderCallRecord,
    input: ApplicationProviderCallFinalization,
  ): ApplicationProviderCallRecord {
    validateFinalization(input);
    const effectiveProviderRequestRef =
      input.providerRequestRef ?? call.providerRequestRef;
    if (Date.parse(input.completedAt) < Date.parse(call.startedAt)) {
      throw new Error('Provider call completion cannot precede dispatch.');
    }
    if (
      operation === 'reconcile'
      && call.uncertainAt
      && Date.parse(input.completedAt) < Date.parse(call.uncertainAt)
    ) {
      throw new Error('Provider call reconciliation cannot precede uncertainty.');
    }
    if (isTerminal(call.state)) {
      const finalizationRequestHash = requiredValue(
        call.finalizationRequestHash,
        `Terminal provider call ${call.ref} has no finalization request hash.`,
      );
      assertEquivalent(
        operation,
        input.finalizationId,
        finalizationRequestHash,
        input.canonicalRequestHash,
      );
      if (call.finalizationId !== input.finalizationId) {
        throw new ApplicationProviderAccountingPlanConflictError(
          operation,
          input.finalizationId,
          finalizationRequestHash,
          input.canonicalRequestHash,
        );
      }
      const submittedCostRef = providerCostRecordRef(input.cost.costRecordId);
      if (
        call.state !== input.state
        || call.providerRequestRef !== effectiveProviderRequestRef
        || call.usageEvidenceRef !== input.usageEvidenceRef
        || call.providerCostRecordRef !== submittedCostRef
      ) {
        throw new ApplicationProviderAccountingPlanConflictError(
          operation,
          input.finalizationId,
          finalizationRequestHash,
          input.canonicalRequestHash,
        );
      }
      persistCost(operation, call.ref, input.cost, input.completedAt);
      return call;
    }
    if (
      operation === 'finalize' && call.state !== 'started'
      || operation === 'reconcile' && call.state !== 'uncertain'
    ) {
      throw new ApplicationProviderAccountingStateError(
        call.ref,
        call.state,
        operation,
      );
    }
    if (input.cost.usageEvidenceRef !== input.usageEvidenceRef) {
      throw new Error(
        'Terminal provider cost and provider-call usage evidence must match.',
      );
    }
    if (
      call.provisionalProviderCostRecordRef
      && input.cost.reconcilesCostRecordRef
        !== call.provisionalProviderCostRecordRef
    ) {
      throw new Error(
        'A reconciled terminal cost must reference the retained provisional provider cost.',
      );
    }
    const cost = persistCost(operation, call.ref, input.cost, input.completedAt);
    const next = immutable({
      ...call,
      state: input.state,
      ...(effectiveProviderRequestRef
        ? { providerRequestRef: effectiveProviderRequestRef }
        : {}),
      usageEvidenceRef: input.usageEvidenceRef,
      providerCostRecordRef: cost.ref,
      finalizationId: input.finalizationId,
      finalizationRequestHash: input.canonicalRequestHash,
      completedAt: input.completedAt,
    } satisfies ApplicationProviderCallRecord);
    calls.set(call.ref, next);
    return next;
  }

  function requiredCallFromReconciliation(
    ref: ApplicationProviderReconciliationRef,
    values: ReadonlyMap<ApplicationProviderCallRef, ApplicationProviderCallRecord>,
  ): ApplicationProviderCallRecord {
    for (const call of values.values()) {
      if (call.reconciliationRef === ref) return call;
    }
    throw new Error(`Provider reconciliation ${ref} was not found.`);
  }
}

export function applicationProviderCallRef(
  providerCallId: string,
): ApplicationProviderCallRef {
  validateIdentity(providerCallId, 'providerCallId');
  return providerCallRef(providerCallId);
}

export function applicationProviderCallId(
  ref: ApplicationProviderCallRef,
): string {
  return opaqueReferenceIdentity(
    ref,
    'applik8s:provider-call:v1:',
    'provider call',
  );
}

export function applicationProviderCostRecordRef(
  costRecordId: string,
): ApplicationProviderCostRecordRef {
  validateIdentity(costRecordId, 'costRecordId');
  return providerCostRecordRef(costRecordId);
}

export function applicationProviderCostRecordId(
  ref: ApplicationProviderCostRecordRef,
): string {
  return opaqueReferenceIdentity(
    ref,
    'applik8s:provider-cost:v1:',
    'provider cost record',
  );
}

function providerCallRef(providerCallId: string): ApplicationProviderCallRef {
  return `applik8s:provider-call:v1:${encodeURIComponent(providerCallId)}` as ApplicationProviderCallRef;
}

function providerCostRecordRef(
  costRecordId: string,
): ApplicationProviderCostRecordRef {
  return `applik8s:provider-cost:v1:${encodeURIComponent(costRecordId)}` as ApplicationProviderCostRecordRef;
}

function providerReconciliationRef(
  uncertaintyId: string,
): ApplicationProviderReconciliationRef {
  return `applik8s:provider-reconciliation:v1:${encodeURIComponent(uncertaintyId)}` as ApplicationProviderReconciliationRef;
}

function opaqueReferenceIdentity(
  ref: string,
  prefix: string,
  label: string,
): string {
  if (!ref.startsWith(prefix)) {
    throw new Error(`${label} reference is malformed.`);
  }
  const encoded = ref.slice(prefix.length);
  try {
    const identity = decodeURIComponent(encoded);
    validateIdentity(identity, `${label} identity`);
    if (`${prefix}${encodeURIComponent(identity)}` !== ref) {
      throw new Error(`${label} reference is not canonically encoded.`);
    }
    return identity;
  } catch (cause) {
    throw new Error(`${label} reference is malformed.`, { cause });
  }
}

function validateCallPlan(input: ApplicationProviderCallPlan): void {
  validateIdentity(input.providerCallId, 'providerCallId');
  validateHash(input.canonicalRequestHash);
  for (const [label, value] of [
    ['principalScope', input.principalScope],
    ['operationRef', input.operationRef],
    ['provider', input.provider],
    ['capability', input.capability],
    ['reservationRef', input.reservationRef],
  ] as const) validateIdentity(value, label);
  validateInstant(input.startedAt, 'startedAt');
}

function validateFinalization(input: ApplicationProviderCallFinalization): void {
  validateIdentity(input.finalizationId, 'finalizationId');
  validateHash(input.canonicalRequestHash);
  validateInstant(input.completedAt, 'completedAt');
  validateCostInput(input.cost);
  validateFinalizationSemanticFields(input);
}

function validateFinalizationSemanticFields(
  input: Pick<ApplicationProviderCallFinalization, 'providerCallRef' | 'providerRequestRef' | 'usageEvidenceRef' | 'state'>,
): void {
  validateIdentity(input.providerCallRef, 'providerCallRef');
  if (!isTerminal(input.state)) throw new Error('Provider call finalization state is invalid.');
  if (input.providerRequestRef) validateIdentity(input.providerRequestRef, 'providerRequestRef');
  validateIdentity(input.usageEvidenceRef, 'usageEvidenceRef');
}

function validateUncertainty(
  input: Omit<ApplicationProviderCallUncertainty, 'uncertainAt'>,
): void {
  validateIdentity(input.uncertaintyId, 'uncertaintyId');
  validateIdentity(input.providerCallRef, 'providerCallRef');
  if (input.providerRequestRef) validateIdentity(input.providerRequestRef, 'providerRequestRef');
  if (input.provisionalUsageEvidenceRef) validateIdentity(input.provisionalUsageEvidenceRef, 'provisionalUsageEvidenceRef');
  if (input.provisionalCost) validateCostInput(input.provisionalCost);
}

function validateCostInput(input: ApplicationProviderCostInput): void {
  validateIdentity(input.costRecordId, 'costRecordId');
  validateHash(input.canonicalRequestHash);
  validateIdentity(input.currency, 'currency');
  validateIdentity(input.sourceEvidenceRef, 'sourceEvidenceRef');
  if (input.usageEvidenceRef) validateIdentity(input.usageEvidenceRef, 'usageEvidenceRef');
  if (input.pricingRevision) validateIdentity(input.pricingRevision, 'pricingRevision');
  if (input.allocationMethod) validateIdentity(input.allocationMethod, 'allocationMethod');
  if (input.reconcilesCostRecordRef) validateIdentity(input.reconcilesCostRecordRef, 'reconcilesCostRecordRef');
  if (input.kind === 'zero') {
    if (input.amountMicrounits !== undefined && input.amountMicrounits !== 0) {
      throw new Error('Zero provider cost must have amountMicrounits 0.');
    }
  } else if (
    !Number.isSafeInteger(input.amountMicrounits)
    || (input.kind !== 'adjustment' && input.amountMicrounits < 0)
  ) {
    throw new Error(
      `${input.kind} provider cost must use a ${input.kind === 'adjustment' ? 'signed ' : 'non-negative '}safe-integer amountMicrounits.`,
    );
  }
  if (input.kind === 'actual' && input.amountMicrounits === 0) {
    throw new Error('A zero actual cost must use the explicit zero disposition.');
  }
}

function validateIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.length > 2_048) throw new Error(`${label} must not exceed 2048 characters.`);
}

function validateHash(value: string): void {
  validateSha256Digest(value, 'canonicalRequestHash');
}

function validateSha256Digest(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(
      `${label} must be a lowercase 64-character SHA-256 digest.`,
    );
  }
}

function validateInstant(value: string, label: string): void {
  if (
    !value
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO instant.`);
  }
}

function assertEquivalent(
  operation: ApplicationProviderAccountingConflictOperation,
  identity: string,
  authoritativeRequestHash: string,
  submittedRequestHash: string,
): void {
  if (authoritativeRequestHash !== submittedRequestHash) {
    throw new ApplicationProviderAccountingPlanConflictError(
      operation,
      identity,
      authoritativeRequestHash,
      submittedRequestHash,
    );
  }
}

function callPlanSemanticKey(input: ApplicationProviderCallPlan): string {
  return JSON.stringify([
    input.principalScope,
    input.operationRef,
    input.provider,
    input.capability,
    input.reservationRef,
  ]);
}

function accountingDigest(version: string, semanticFields: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([version, ...semanticFields]))
    .digest('hex');
}

function assertExactHash(
  operation: ApplicationProviderAccountingConflictOperation,
  submitted: string,
  expected: string,
): void {
  validateHash(expected);
  if (!/^[0-9a-f]{64}$/u.test(submitted) || submitted !== expected) {
    throw new ApplicationProviderAccountingRequestHashError(
      operation,
      submitted,
      expected,
    );
  }
}

function costSemanticKey(
  input: ApplicationProviderCostInput | ApplicationProviderCostRecord,
): string {
  return JSON.stringify([
    input.kind,
    input.currency,
    input.kind === 'zero' ? 0 : input.amountMicrounits,
    input.usageEvidenceRef ?? null,
    input.sourceEvidenceRef,
    input.pricingRevision ?? null,
    input.allocationMethod ?? null,
    input.reconcilesCostRecordRef ?? null,
  ]);
}

function isTerminal(
  state: ApplicationProviderCallState,
): state is ApplicationProviderCallTerminalState {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function immutable<T extends object>(value: T): Readonly<T> {
  return Object.freeze(structuredClone(value));
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
