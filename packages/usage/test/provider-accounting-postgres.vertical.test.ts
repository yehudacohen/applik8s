// typecast-file-boundary: the transactional SQL fixture implements only the fixed provider-accounting statements under test.
import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from '@applik8s/applik8s/postgres-runtime-contract';
import type { ApplicationUsageEvidenceRef } from '@applik8s/usage';
import { ApplicationProviderAccountingPlanConflictError } from '@applik8s/usage';
import { applicationProviderCallRef, applicationProviderCostRecordRef } from '../src/provider-accounting.js';
import { describe, expect, it } from 'vitest';
import { createPostgresApplicationProviderCallAccounting } from '../src/provider-accounting-postgres.js';

describe('PostgreSQL provider-call accounting', () => {
  it('does not publish a dangling terminal cost reference when cost persistence fails', async () => {
    const database = accountingSqlFixture({ dropCostInserts: true });
    const accounting = createPostgresApplicationProviderCallAccounting({ sql: database.sql });
    const call = await accounting.begin({
      providerCallId: 'call-dangling',
      canonicalRequestHash: digest('1'),
      principalScope: 'workspace-1',
      operationRef: 'operation:dangling',
      provider: 'provider-a',
      capability: 'retrieval',
      reservationRef: 'reservation:dangling',
      startedAt: '2026-08-23T12:00:00.000Z',
    });
    const usageEvidenceRef = usageRef('usage-dangling');
    await expect(accounting.finalize({
      finalizationId: 'finalize-dangling',
      canonicalRequestHash: digest('2'),
      providerCallRef: call.ref,
      state: 'failed',
      usageEvidenceRef,
      cost: {
        kind: 'zero' as const,
        costRecordId: 'cost-dangling',
        canonicalRequestHash: digest('3'),
        currency: 'USD',
        usageEvidenceRef,
        sourceEvidenceRef: 'provider-result:dangling',
      },
      completedAt: '2026-08-23T12:00:01.000Z',
    })).rejects.toBeInstanceOf(ApplicationProviderAccountingPlanConflictError);
    expect(database.costs.size).toBe(0);
    expect(database.calls.get('call-dangling')).toMatchObject({
      state: 'started',
      provider_cost_record_ref: null,
    });
  });

  it('persists one retained call and atomically links terminal usage and cost', async () => {
    const database = accountingSqlFixture();
    const accounting = createPostgresApplicationProviderCallAccounting({
      sql: database.sql,
      schema: 'application',
    });
    const plan = {
      providerCallId: 'call-1',
      canonicalRequestHash: digest('4'),
      principalScope: 'workspace-1',
      operationRef: 'operation:1',
      provider: 'provider-a',
      capability: 'structured-generation',
      reservationRef: 'reservation:1',
      startedAt: '2026-08-23T12:00:00.000Z',
    };

    const [first, retry] = await Promise.all([
      accounting.begin(plan),
      accounting.begin(plan),
    ]);
    expect(retry).toEqual(first);
    expect(database.calls.size).toBe(1);

    const usageEvidenceRef = usageRef('usage-1');
    const finalization = {
      finalizationId: 'finalize-1',
      canonicalRequestHash: digest('5'),
      providerCallRef: first.ref,
      state: 'completed' as const,
      providerRequestRef: 'provider-request-1',
      usageEvidenceRef,
      cost: {
        kind: 'actual' as const,
        costRecordId: 'cost-1',
        canonicalRequestHash: digest('6'),
        currency: 'USD',
        amountMicrounits: 35,
        usageEvidenceRef,
        sourceEvidenceRef: 'provider-response:1',
      },
      completedAt: '2026-08-23T12:00:02.000Z',
    };
    const [terminal, terminalRetry] = await Promise.all([
      accounting.finalize(finalization),
      accounting.finalize(finalization),
    ]);

    expect(terminalRetry).toEqual(terminal);
    expect(database.costs.size).toBe(1);
    await expect(accounting.getCall(applicationProviderCallRef('call-1')))
      .resolves.toMatchObject({ state: 'completed', usageEvidenceRef });
    await expect(accounting.getCostRecord(
      applicationProviderCostRecordRef('cost-1'),
    )).resolves.toMatchObject({
      kind: 'actual',
      amountMicrounits: 35,
      usageEvidenceRef,
    });
  });

  it('recovers an uncertain call and appends immutable reconciliation evidence', async () => {
    const database = accountingSqlFixture();
    const accounting = createPostgresApplicationProviderCallAccounting({
      sql: database.sql,
    });
    const call = await accounting.begin({
      providerCallId: 'call-uncertain',
      canonicalRequestHash: digest('7'),
      principalScope: 'workspace-1',
      operationRef: 'operation:uncertain',
      provider: 'provider-a',
      capability: 'retrieval',
      reservationRef: 'reservation:uncertain',
      startedAt: '2026-08-23T12:00:00.000Z',
    });
    const provisionalUsage = usageRef('usage-provisional');
    const uncertain = await accounting.markUncertain({
      uncertaintyId: 'uncertainty-1',
      canonicalRequestHash: digest('8'),
      providerCallRef: call.ref,
      providerRequestRef: 'provider-request-1',
      provisionalUsageEvidenceRef: provisionalUsage,
      provisionalCost: {
        kind: 'provisional',
        costRecordId: 'cost-provisional',
        canonicalRequestHash: digest('9'),
        currency: 'USD',
        amountMicrounits: 20,
        usageEvidenceRef: provisionalUsage,
        sourceEvidenceRef: 'timeout:1',
      },
      uncertainAt: '2026-08-23T12:00:03.000Z',
    });
    const usageEvidenceRef = usageRef('usage-zero');
    const reconciliationRef = required(uncertain.reconciliationRef);
    const provisionalCostRef = required(
      uncertain.provisionalProviderCostRecordRef,
    );

    const reconciliation = {
      reconciliationRef,
      finalizationId: 'reconcile-1',
      canonicalRequestHash: digest('a'),
      state: 'failed' as const,
      usageEvidenceRef,
      cost: {
        kind: 'zero' as const,
        costRecordId: 'cost-zero',
        canonicalRequestHash: digest('b'),
        currency: 'USD',
        usageEvidenceRef,
        sourceEvidenceRef: 'reconciliation:1',
        reconcilesCostRecordRef: provisionalCostRef,
      },
      completedAt: '2026-08-23T12:05:00.000Z',
    };

    await expect(accounting.reconcile({
      ...reconciliation,
      canonicalRequestHash: digest('c'),
      providerRequestRef: 'provider-request-2',
    })).rejects.toMatchObject({
      code: 'APPLIK8S_PROVIDER_ACCOUNTING_PLAN_CONFLICT',
      operation: 'reconcile',
    });
    const terminal = await accounting.reconcile(reconciliation);
    const retry = await accounting.reconcile(reconciliation);

    expect(retry).toEqual(terminal);
    expect(terminal).toMatchObject({
      state: 'failed',
      reconciliationRef,
      providerRequestRef: 'provider-request-1',
      providerCostRecordRef: applicationProviderCostRecordRef('cost-zero'),
    });
    expect(database.costs.size).toBe(2);
  });
});

function accountingSqlFixture(options: { readonly dropCostInserts?: boolean } = {}): {
  readonly sql: ApplicationPostgresSql;
  readonly calls: Map<string, Record<string, unknown>>;
  readonly costs: Map<string, Record<string, unknown>>;
} {
  const calls = new Map<string, Record<string, unknown>>();
  const costs = new Map<string, Record<string, unknown>>();
  let tail = Promise.resolve();

  const unsafe = async (
    query: string,
    values: readonly unknown[] = [],
  ): Promise<readonly unknown[]> => {
    const normalized = query.replaceAll(/\s+/gu, ' ').trim();
    if (normalized.startsWith('SELECT pg_advisory_xact_lock')) return [];
    if (normalized.includes('applik8s_provider_calls')) {
      if (normalized.startsWith('SELECT') && normalized.includes('WHERE id = $1')) {
        const row = calls.get(String(values[0]));
        return row ? [structuredClone(row)] : [];
      }
      if (normalized.startsWith('SELECT') && normalized.includes('WHERE reconciliation_ref = $1')) {
        const row = [...calls.values()].find(
          (candidate) => candidate.reconciliation_ref === values[0],
        );
        return row ? [structuredClone(row)] : [];
      }
      if (normalized.startsWith('INSERT')) {
        calls.set(String(values[0]), {
          id: values[0],
          ref: values[1],
          canonical_request_hash: values[2],
          principal_scope: values[3],
          operation_ref: values[4],
          provider: values[5],
          capability: values[6],
          reservation_ref: values[7],
          state: values[8],
          started_at: values[9],
          provider_request_ref: null,
          usage_evidence_ref: null,
          provider_cost_record_ref: null,
          provisional_usage_evidence_ref: null,
          provisional_provider_cost_record_ref: null,
          reconciliation_ref: null,
          uncertainty_id: null,
          uncertainty_request_hash: null,
          finalization_id: null,
          finalization_request_hash: null,
          uncertain_at: null,
          completed_at: null,
        });
        return [];
      }
      if (normalized.startsWith('UPDATE')) {
        const row = calls.get(String(values[0]));
        if (!row) throw new Error('Fixture provider call is missing.');
        Object.assign(row, {
          state: values[1],
          provider_request_ref: values[2],
          usage_evidence_ref: values[3],
          provider_cost_record_ref: values[4],
          provisional_usage_evidence_ref: values[5],
          provisional_provider_cost_record_ref: values[6],
          reconciliation_ref: values[7],
          uncertainty_id: values[8],
          uncertainty_request_hash: values[9],
          finalization_id: values[10],
          finalization_request_hash: values[11],
          uncertain_at: values[12],
          completed_at: values[13],
        });
        return [];
      }
    }
    if (normalized.includes('applik8s_provider_cost_records')) {
      if (normalized.startsWith('SELECT') && normalized.includes('WHERE id = $1')) {
        const row = costs.get(String(values[0]));
        return row ? [structuredClone(row)] : [];
      }
      if (normalized.startsWith('SELECT') && normalized.includes('WHERE ref = $1')) {
        const row = [...costs.values()].find(
          (candidate) => candidate.ref === values[0],
        );
        return row ? [structuredClone(row)] : [];
      }
      if (normalized.startsWith('SELECT') && normalized.includes('WHERE provider_call_ref = $1')) {
        return [...costs.values()]
          .filter((candidate) => candidate.provider_call_ref === values[0])
          .map((candidate) => structuredClone(candidate));
      }
      if (normalized.startsWith('INSERT')) {
        if (options.dropCostInserts) return [];
        if (!costs.has(String(values[0]))) {
          const inserted = {
            id: values[0],
            ref: values[1],
            principal_scope: values[2],
            provider_call_ref: values[3],
            canonical_request_hash: values[4],
            kind: values[5],
            currency: values[6],
            amount_microunits: values[7],
            usage_evidence_ref: values[8],
            source_evidence_ref: values[9],
            pricing_revision: values[10],
            allocation_method: values[11],
            reconciles_cost_record_ref: values[12],
            recorded_at: values[13],
          };
          costs.set(String(values[0]), inserted);
          return [structuredClone(inserted)];
        }
        return [];
      }
    }
    throw new Error(`Unexpected provider-accounting SQL: ${normalized}`);
  };

  const transaction = {
    unsafe,
  } as unknown as ApplicationPostgresTransactionSql;
  const sql = {
    unsafe,
    async begin<T>(operation: (sql: ApplicationPostgresTransactionSql) => Promise<T>) {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation(transaction);
      } finally {
        release();
      }
    },
    async end() {},
  } as ApplicationPostgresSql;
  return { sql, calls, costs };
}

function usageRef(id: string): ApplicationUsageEvidenceRef {
  return `applik8s:usage-evidence:v1:${id}` as ApplicationUsageEvidenceRef;
}

function digest(character: string): string {
  return character.repeat(64);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected persisted accounting ref.');
  return value;
}
