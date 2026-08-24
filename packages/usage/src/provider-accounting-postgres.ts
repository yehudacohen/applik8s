// typecast-file-boundary: fixed PostgreSQL projections are decoded into the public provider-accounting contract before use.
import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from '@applik8s/applik8s/postgres-runtime-contract';
import {
  ApplicationProviderAccountingPlanConflictError,
  type ApplicationProviderCallAccounting,
  type ApplicationProviderCallFinalization,
  type ApplicationProviderCallRecord,
  type ApplicationProviderCallRef,
  type ApplicationProviderCostInput,
  type ApplicationProviderCostRecord,
  type ApplicationProviderCostRecordRef,
  type ApplicationProviderReconciliationRef,
  applicationProviderCallId,
  applicationProviderCallRef,
  applicationProviderCostRecordId,
  applicationProviderCostRecordRef,
  createInMemoryApplicationProviderCallAccounting,
} from './provider-accounting.js';

export interface PostgresApplicationProviderCallAccountingOptions {
  /** Compiler/runtime-owned SQL capability; URLs and credentials are rejected by type. */
  readonly sql: ApplicationPostgresSql;
  /** Optional trusted schema containing the @applik8s/usage migration. */
  readonly schema?: string;
}

/**
 * PostgreSQL-backed provider accounting authority.
 *
 * The application's generated @applik8s/usage migration must already exist.
 * Every transition locks the provider-call identity and commits the mutable
 * call projection with any new immutable cost record in one transaction.
 */
export function createPostgresApplicationProviderCallAccounting(
  options: PostgresApplicationProviderCallAccountingOptions,
): ApplicationProviderCallAccounting {
  const callsTable = qualifiedTable(options.schema, 'applik8s_provider_calls');
  const costsTable = qualifiedTable(
    options.schema,
    'applik8s_provider_cost_records',
  );

  return {
    async begin(plan) {
      return options.sql.begin(async (transaction) => {
        await lock(transaction, `provider-call:${plan.providerCallId}`);
        const existing = await selectCallById(transaction, plan.providerCallId);
        if (existing) {
          const runtime = await hydratedRuntime(transaction, existing);
          return runtime.begin(plan);
        }
        const runtime = createInMemoryApplicationProviderCallAccounting();
        const created = await runtime.begin(plan);
        await insertCall(transaction, created);
        return created;
      });
    },

    async markUncertain(input) {
      return transition(input.providerCallRef, async (runtime) =>
        runtime.markUncertain(input));
    },

    async finalize(input) {
      return transition(input.providerCallRef, async (runtime) =>
        runtime.finalize(input));
    },

    async reconcile(input) {
      const call = await selectCallByReconciliation(options.sql, input.reconciliationRef);
      if (!call) {
        throw new Error(
          `Provider reconciliation ${input.reconciliationRef} was not found.`,
        );
      }
      return transition(call.ref, async (runtime) => runtime.reconcile(input));
    },

    async recordAdjustment(input) {
      const callId = applicationProviderCallId(input.providerCallRef);
      return options.sql.begin(async (transaction) => {
        await lock(transaction, `provider-call:${callId}`);
        await lock(
          transaction,
          `provider-cost:${input.cost.costRecordId}`,
        );
        const call = await selectCallById(transaction, callId, true);
        if (!call) throw new Error(`Provider call ${input.providerCallRef} was not found.`);
        const runtime = await hydratedRuntime(transaction, call);
        const record = await runtime.recordAdjustment(input);
        await insertCost(transaction, 'recordAdjustment', record);
        return record;
      });
    },

    async getCall(ref) {
      return selectCallById(options.sql, applicationProviderCallId(ref));
    },

    async getCostRecord(ref) {
      applicationProviderCostRecordId(ref);
      const rows = await options.sql.unsafe(
        `SELECT * FROM ${costsTable} WHERE ref = $1 LIMIT 1`,
        [ref],
      );
      return rows[0] ? decodeCost(rows[0]) : undefined;
    },

    async getCallFromReconciliation(ref) {
      return selectCallByReconciliation(options.sql, ref);
    },
  };

  async function transition(
    ref: ApplicationProviderCallRef,
    apply: (
      runtime: ApplicationProviderCallAccounting,
    ) => Promise<ApplicationProviderCallRecord>,
  ): Promise<ApplicationProviderCallRecord> {
    const callId = applicationProviderCallId(ref);
    return options.sql.begin(async (transaction) => {
      await lock(transaction, `provider-call:${callId}`);
      const existing = await selectCallById(transaction, callId, true);
      if (!existing) throw new Error(`Provider call ${ref} was not found.`);
      const beforeCosts = await selectCostsForCall(transaction, ref);
      const beforeRefs = new Set(beforeCosts.map(({ ref: costRef }) => costRef));
      const runtime = await hydrate(existing, beforeCosts);
      const next = await apply(runtime);
      for (const costRef of [
        next.provisionalProviderCostRecordRef,
        next.providerCostRecordRef,
      ]) {
        if (!costRef || beforeRefs.has(costRef)) continue;
        const record = await runtime.getCostRecord(costRef);
        if (!record) {
          throw new Error(`Provider accounting transition lost cost record ${costRef}.`);
        }
        await lock(transaction, `provider-cost:${record.costRecordId}`);
        await insertCost(transaction, transitionOperation(next), record);
      }
      await updateCall(transaction, next);
      return next;
    });
  }

  async function hydratedRuntime(
    sql: SqlReader,
    call: ApplicationProviderCallRecord,
  ): Promise<ApplicationProviderCallAccounting> {
    return hydrate(call, await selectCostsForCall(sql, call.ref));
  }

  async function hydrate(
    call: ApplicationProviderCallRecord,
    costs: readonly ApplicationProviderCostRecord[],
  ): Promise<ApplicationProviderCallAccounting> {
    const runtime = createInMemoryApplicationProviderCallAccounting();
    await runtime.begin(call);
    const byRef = new Map(costs.map((cost) => [cost.ref, cost]));
    if (call.uncertaintyId) {
      await runtime.markUncertain({
        uncertaintyId: call.uncertaintyId,
        canonicalRequestHash: required(
          call.uncertaintyRequestHash,
          'uncertaintyRequestHash',
        ),
        providerCallRef: call.ref,
        ...(call.providerRequestRef
          ? { providerRequestRef: call.providerRequestRef }
          : {}),
        ...(call.provisionalUsageEvidenceRef
          ? { provisionalUsageEvidenceRef: call.provisionalUsageEvidenceRef }
          : {}),
        ...(call.provisionalProviderCostRecordRef
          ? {
              provisionalCost: costInput(
                required(
                  byRef.get(call.provisionalProviderCostRecordRef),
                  'provisionalProviderCostRecord',
                ),
              ) as Extract<
                ApplicationProviderCostInput,
                { readonly kind: 'provisional' }
              >,
            }
          : {}),
        uncertainAt: required(call.uncertainAt, 'uncertainAt'),
      });
    }
    if (isTerminal(call.state)) {
      const cost = costInput(required(
        byRef.get(required(call.providerCostRecordRef, 'providerCostRecordRef')),
        'providerCostRecord',
      ));
      if (cost.kind !== 'actual' && cost.kind !== 'zero') {
        throw new Error('Terminal provider call does not reference actual-or-zero cost.');
      }
      const finalization: ApplicationProviderCallFinalization = {
        finalizationId: required(call.finalizationId, 'finalizationId'),
        canonicalRequestHash: required(
          call.finalizationRequestHash,
          'finalizationRequestHash',
        ),
        providerCallRef: call.ref,
        state: call.state,
        ...(call.providerRequestRef
          ? { providerRequestRef: call.providerRequestRef }
          : {}),
        usageEvidenceRef: required(call.usageEvidenceRef, 'usageEvidenceRef'),
        cost,
        completedAt: required(call.completedAt, 'completedAt'),
      };
      if (call.uncertaintyId) {
        await runtime.reconcile({
          ...finalization,
          reconciliationRef: required(
            call.reconciliationRef,
            'reconciliationRef',
          ),
        });
      } else {
        await runtime.finalize(finalization);
      }
    }
    for (const cost of costs) {
      if (cost.kind !== 'adjustment') continue;
      const input = costInput(cost);
      if (input.kind !== 'adjustment') continue;
      await runtime.recordAdjustment({
        providerCallRef: call.ref,
        cost: input,
        recordedAt: cost.recordedAt,
      });
    }
    return runtime;
  }

  async function selectCallById(
    sql: SqlReader,
    id: string,
    forUpdate = false,
  ): Promise<ApplicationProviderCallRecord | undefined> {
    const rows = await sql.unsafe(
      `SELECT * FROM ${callsTable} WHERE id = $1 LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] ? decodeCall(rows[0]) : undefined;
  }

  async function selectCallByReconciliation(
    sql: SqlReader,
    ref: ApplicationProviderReconciliationRef,
  ): Promise<ApplicationProviderCallRecord | undefined> {
    const rows = await sql.unsafe(
      `SELECT * FROM ${callsTable} WHERE reconciliation_ref = $1 LIMIT 1`,
      [ref],
    );
    return rows[0] ? decodeCall(rows[0]) : undefined;
  }

  async function selectCostsForCall(
    sql: SqlReader,
    ref: ApplicationProviderCallRef,
  ): Promise<readonly ApplicationProviderCostRecord[]> {
    const rows = await sql.unsafe(
      `SELECT * FROM ${costsTable} WHERE provider_call_ref = $1 ORDER BY recorded_at ASC, id ASC`,
      [ref],
    );
    return rows.map(decodeCost);
  }

  async function insertCall(
    sql: ApplicationPostgresTransactionSql,
    call: ApplicationProviderCallRecord,
  ): Promise<void> {
    await sql.unsafe(
      `INSERT INTO ${callsTable} (
        id, ref, canonical_request_hash, principal_scope, operation_ref,
        provider, capability, reservation_ref, state, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        call.providerCallId,
        call.ref,
        call.canonicalRequestHash,
        call.principalScope,
        call.operationRef,
        call.provider,
        call.capability,
        call.reservationRef,
        call.state,
        call.startedAt,
      ],
    );
  }

  async function updateCall(
    sql: ApplicationPostgresTransactionSql,
    call: ApplicationProviderCallRecord,
  ): Promise<void> {
    await sql.unsafe(
      `UPDATE ${callsTable} SET
        state = $2, provider_request_ref = $3, usage_evidence_ref = $4,
        provider_cost_record_ref = $5, provisional_usage_evidence_ref = $6,
        provisional_provider_cost_record_ref = $7, reconciliation_ref = $8,
        uncertainty_id = $9, uncertainty_request_hash = $10,
        finalization_id = $11, finalization_request_hash = $12,
        uncertain_at = $13, completed_at = $14
      WHERE id = $1`,
      [
        call.providerCallId,
        call.state,
        call.providerRequestRef ?? null,
        call.usageEvidenceRef ?? null,
        call.providerCostRecordRef ?? null,
        call.provisionalUsageEvidenceRef ?? null,
        call.provisionalProviderCostRecordRef ?? null,
        call.reconciliationRef ?? null,
        call.uncertaintyId ?? null,
        call.uncertaintyRequestHash ?? null,
        call.finalizationId ?? null,
        call.finalizationRequestHash ?? null,
        call.uncertainAt ?? null,
        call.completedAt ?? null,
      ],
    );
  }

  async function insertCost(
    sql: ApplicationPostgresTransactionSql,
    operation: 'markUncertain' | 'finalize' | 'reconcile' | 'recordAdjustment',
    cost: ApplicationProviderCostRecord,
  ): Promise<void> {
    const existingRows = await sql.unsafe(
      `SELECT * FROM ${costsTable} WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [cost.costRecordId],
    );
    if (existingRows[0]) {
      const existing = decodeCost(existingRows[0]);
      if (!equivalentCost(existing, cost)) {
        throw new ApplicationProviderAccountingPlanConflictError(
          operation,
          cost.costRecordId,
          existing.canonicalRequestHash,
          cost.canonicalRequestHash,
        );
      }
      return;
    }
    const inserted = await sql.unsafe(
      `INSERT INTO ${costsTable} (
        id, ref, principal_scope, provider_call_ref, canonical_request_hash, kind, currency,
        amount_microunits, usage_evidence_ref, source_evidence_ref,
        pricing_revision, allocation_method, reconciles_cost_record_ref,
        recorded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO NOTHING
      RETURNING *`,
      [
        cost.costRecordId,
        cost.ref,
        cost.principalScope,
        cost.providerCallRef,
        cost.canonicalRequestHash,
        cost.kind,
        cost.currency,
        cost.amountMicrounits,
        cost.usageEvidenceRef ?? null,
        cost.sourceEvidenceRef,
        cost.pricingRevision ?? null,
        cost.allocationMethod ?? null,
        cost.reconcilesCostRecordRef ?? null,
        cost.recordedAt,
      ],
    );
    if (inserted[0]) return;
    const racedRows = await sql.unsafe(
      `SELECT * FROM ${costsTable} WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [cost.costRecordId],
    );
    const raced = racedRows[0] ? decodeCost(racedRows[0]) : undefined;
    if (!raced || !equivalentCost(raced, cost)) {
      throw new ApplicationProviderAccountingPlanConflictError(
        operation,
        cost.costRecordId,
        raced?.canonicalRequestHash ?? 'missing-after-conflict',
        cost.canonicalRequestHash,
      );
    }
  }
}

function transitionOperation(
  call: ApplicationProviderCallRecord,
): 'markUncertain' | 'finalize' | 'reconcile' {
  if (call.state === 'uncertain') return 'markUncertain';
  return call.uncertaintyId ? 'reconcile' : 'finalize';
}

type SqlReader = Pick<ApplicationPostgresSql, 'unsafe'>
  | Pick<ApplicationPostgresTransactionSql, 'unsafe'>;

async function lock(
  sql: ApplicationPostgresTransactionSql,
  identity: string,
): Promise<void> {
  await sql.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `applik8s:provider-accounting:v1:${identity}`,
  ]);
}

function decodeCall(value: unknown): ApplicationProviderCallRecord {
  const row = record(value, 'provider call');
  const providerCallId = text(row.id, 'id');
  const ref = text(row.ref, 'ref') as ApplicationProviderCallRef;
  if (applicationProviderCallRef(providerCallId) !== ref) {
    throw new Error('Provider call opaque reference does not match its identity.');
  }
  return {
    providerCallId,
    ref,
    canonicalRequestHash: text(row.canonical_request_hash, 'canonical_request_hash'),
    principalScope: text(row.principal_scope, 'principal_scope'),
    operationRef: text(row.operation_ref, 'operation_ref'),
    provider: text(row.provider, 'provider'),
    capability: text(row.capability, 'capability'),
    reservationRef: text(row.reservation_ref, 'reservation_ref'),
    state: callState(row.state),
    ...optionalText(row.provider_request_ref, 'providerRequestRef'),
    ...optionalRef(row.usage_evidence_ref, 'usageEvidenceRef'),
    ...optionalRef(row.provider_cost_record_ref, 'providerCostRecordRef'),
    ...optionalRef(row.provisional_usage_evidence_ref, 'provisionalUsageEvidenceRef'),
    ...optionalRef(row.provisional_provider_cost_record_ref, 'provisionalProviderCostRecordRef'),
    ...optionalRef(row.reconciliation_ref, 'reconciliationRef'),
    ...optionalText(row.uncertainty_id, 'uncertaintyId'),
    ...optionalText(row.uncertainty_request_hash, 'uncertaintyRequestHash'),
    ...optionalText(row.finalization_id, 'finalizationId'),
    ...optionalText(row.finalization_request_hash, 'finalizationRequestHash'),
    startedAt: instant(row.started_at, 'started_at'),
    ...optionalInstant(row.uncertain_at, 'uncertainAt'),
    ...optionalInstant(row.completed_at, 'completedAt'),
  } as ApplicationProviderCallRecord;
}

function decodeCost(value: unknown): ApplicationProviderCostRecord {
  const row = record(value, 'provider cost record');
  const costRecordId = text(row.id, 'id');
  const ref = text(row.ref, 'ref') as ApplicationProviderCostRecordRef;
  if (applicationProviderCostRecordRef(costRecordId) !== ref) {
    throw new Error('Provider cost opaque reference does not match its identity.');
  }
  return {
    ref,
    principalScope: text(row.principal_scope, 'principal_scope'),
    providerCallRef: text(row.provider_call_ref, 'provider_call_ref') as ApplicationProviderCallRef,
    costRecordId,
    canonicalRequestHash: text(row.canonical_request_hash, 'canonical_request_hash'),
    kind: costKind(row.kind),
    currency: text(row.currency, 'currency'),
    amountMicrounits: safeInteger(row.amount_microunits, 'amount_microunits'),
    ...optionalRef(row.usage_evidence_ref, 'usageEvidenceRef'),
    sourceEvidenceRef: text(row.source_evidence_ref, 'source_evidence_ref'),
    ...optionalText(row.pricing_revision, 'pricingRevision'),
    ...optionalText(row.allocation_method, 'allocationMethod'),
    ...optionalRef(row.reconciles_cost_record_ref, 'reconcilesCostRecordRef'),
    recordedAt: instant(row.recorded_at, 'recorded_at'),
  } as ApplicationProviderCostRecord;
}

function costInput(record: ApplicationProviderCostRecord): ApplicationProviderCostInput {
  return {
    costRecordId: record.costRecordId,
    canonicalRequestHash: record.canonicalRequestHash,
    kind: record.kind,
    currency: record.currency,
    amountMicrounits: record.amountMicrounits,
    ...(record.usageEvidenceRef ? { usageEvidenceRef: record.usageEvidenceRef } : {}),
    sourceEvidenceRef: record.sourceEvidenceRef,
    ...(record.pricingRevision ? { pricingRevision: record.pricingRevision } : {}),
    ...(record.allocationMethod ? { allocationMethod: record.allocationMethod } : {}),
    ...(record.reconcilesCostRecordRef
      ? { reconcilesCostRecordRef: record.reconcilesCostRecordRef }
      : {}),
  } as ApplicationProviderCostInput;
}

function qualifiedTable(schema: string | undefined, table: string): string {
  return schema ? `${identifier(schema)}.${identifier(table)}` : identifier(table);
}

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`PostgreSQL identifier ${JSON.stringify(value)} is invalid.`);
  }
  return `"${value}"`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${label} row is malformed.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is invalid.`);
  return value;
}

function instant(value: unknown, label: string): string {
  if (value instanceof Date) return value.toISOString();
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return new Date(result).toISOString();
}

function optionalText<Key extends string>(
  value: unknown,
  key: Key,
): { readonly [Property in Key]?: string } {
  return value == null ? {} : { [key]: text(value, key) } as never;
}

function optionalInstant<Key extends string>(
  value: unknown,
  key: Key,
): { readonly [Property in Key]?: string } {
  return value == null ? {} : { [key]: instant(value, key) } as never;
}

function optionalRef<Key extends string>(
  value: unknown,
  key: Key,
): { readonly [Property in Key]?: string } {
  return optionalText(value, key);
}

function safeInteger(value: unknown, label: string): number {
  const candidate = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(candidate)) throw new Error(`${label} is invalid.`);
  return candidate;
}

function callState(value: unknown): ApplicationProviderCallRecord['state'] {
  if (
    value !== 'started'
    && value !== 'uncertain'
    && value !== 'completed'
    && value !== 'failed'
    && value !== 'cancelled'
  ) throw new Error('Provider call state is invalid.');
  return value;
}

function costKind(value: unknown): ApplicationProviderCostRecord['kind'] {
  if (
    value !== 'zero'
    && value !== 'actual'
    && value !== 'provisional'
    && value !== 'adjustment'
  ) throw new Error('Provider cost kind is invalid.');
  return value;
}

function isTerminal(
  state: ApplicationProviderCallRecord['state'],
): state is 'completed' | 'failed' | 'cancelled' {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Provider accounting ${label} is missing.`);
  return value;
}

function equivalentCost(
  left: ApplicationProviderCostRecord,
  right: ApplicationProviderCostRecord,
): boolean {
  return left.ref === right.ref
    && left.providerCallRef === right.providerCallRef
    && left.costRecordId === right.costRecordId
    && left.canonicalRequestHash === right.canonicalRequestHash
    && left.kind === right.kind
    && left.currency === right.currency
    && left.amountMicrounits === right.amountMicrounits
    && left.usageEvidenceRef === right.usageEvidenceRef
    && left.sourceEvidenceRef === right.sourceEvidenceRef
    && left.pricingRevision === right.pricingRevision
    && left.allocationMethod === right.allocationMethod
    && left.reconcilesCostRecordRef === right.reconcilesCostRecordRef
    && left.recordedAt === right.recordedAt;
}
