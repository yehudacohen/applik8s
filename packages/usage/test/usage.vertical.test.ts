// typecast-file-boundary: conformance fixtures intentionally construct branded wire references and preserve literal discriminants while testing runtime rejection.
import {
  type ApplicationModelCommandContext,
  app,
  applicationGraphFor,
} from '@applik8s/applik8s';
import {
  ApplicationEntitlementRequiredError,
  ApplicationProviderAccountingPlanConflictError,
  ApplicationProviderAccountingRequestHashError,
  type ApplicationUsageEvidenceRef,
  applicationProviderCallFinalizationHashV1,
  applicationProviderCallPlanHashV1,
  applicationProviderCostHashV1,
  requireActiveEntitlement,
  usage,
} from '@applik8s/usage';
import {
  type ApplicationProviderCallPlan,
  applicationProviderCallId,
  applicationProviderCallRef,
  applicationProviderAccountingPrincipalScope,
  applicationProviderCostRecordRef,
  bindApplicationProviderCallAccounting,
  createInMemoryApplicationProviderCallAccounting,
} from '../src/provider-accounting.js';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { applicationProviderCalls, applicationProviderCostRecords } from '../src/schema.js';

describe('transaction-authoritative entitlement admission', () => {
  it('admits an active matching entitlement', async () => {
    await expect(
      requireActiveEntitlement(
        contextWithEntitlements([
          {
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2027-01-01T00:00:00.000Z',
          },
        ]),
        {
          principalScope: 'workspace-1',
          capability: 'research-review',
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('fails closed for absent and expired entitlements', async () => {
    for (const entitlements of [
      [],
      [{
        validFrom: '2025-01-01T00:00:00.000Z',
        validUntil: '2025-12-31T23:59:59.000Z',
      }],
    ]) {
      await expect(
        requireActiveEntitlement(
          contextWithEntitlements(entitlements),
          {
            principalScope: 'workspace-1',
            capability: 'research-review',
          },
        ),
      ).rejects.toBeInstanceOf(ApplicationEntitlementRequiredError);
    }
  });
});

describe('provider-call accounting conformance', () => {
  it('installs provider-call and immutable provider-cost authority with usage', () => {
    const application = app('usage-accounting-contract');
    application.database.postgres('application', { schema: {} });
    const Usage = application.include(usage);

    expect(Usage.ProviderCall.$model.name).toBe('ProviderCall');
    expect(Usage.ProviderCostRecord.$model.name).toBe('ProviderCostRecord');
    const graph = applicationGraphFor(application);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'model', name: 'ProviderCall' }),
      expect.objectContaining({ kind: 'model', name: 'ProviderCostRecord' }),
    ]));
    const accountingMutations = graph?.nodes.filter(
      (node) =>
        node.kind === 'commandHandler'
        && (
          node.name.startsWith('ProviderCall-models.')
          || node.name.startsWith('ProviderCostRecord-models.')
        ),
    ) ?? [];
    expect(accountingMutations).toHaveLength(6);
    expect(accountingMutations.every(
      (node) =>
        node.kind === 'commandHandler'
        && node.beforeCommit?.source.includes(
          'writable only through the provider-accounting authority',
        ) === true,
    )).toBe(true);
    const callConfig = getTableConfig(applicationProviderCalls);
    const costConfig = getTableConfig(applicationProviderCostRecords);
    expect(callConfig.checks.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'applik8s_provider_calls_hash_check',
      'applik8s_provider_calls_time_order_check',
    ]));
    expect(costConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(expect.arrayContaining([
      'applik8s_provider_cost_records_call_fk',
      'applik8s_provider_cost_records_reconciles_fk',
    ]));
    expect(callConfig.uniqueConstraints.map(({ name }) => name)).toContain(
      'applik8s_provider_calls_scope_ref_unique',
    );
    expect(costConfig.uniqueConstraints.map(({ name }) => name)).toContain(
      'applik8s_provider_cost_records_scope_ref_unique',
    );
  });

  it('rejects non-canonical temporal and opaque-reference representations', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    await expect(accounting.begin({
      ...providerCallPlan(),
      canonicalRequestHash: 'not-a-sha256-digest',
    })).rejects.toThrow(/lowercase 64-character SHA-256 digest/);
    await expect(accounting.begin({
      ...providerCallPlan(),
      startedAt: '2026-08-23T08:00:00-04:00',
    })).rejects.toThrow(/canonical ISO instant/);
    expect(() => applicationProviderCallId(
      'applik8s:provider-call:v1:%63all-1' as ReturnType<
        typeof applicationProviderCallRef
      >,
    )).toThrow(/malformed/);
  });

  it('retains exactly one provider call for concurrent equivalent retries', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    const plan = providerCallPlan();

    const calls = await Promise.all(
      Array.from({ length: 20 }, () => accounting.begin(plan)),
    );

    expect(new Set(calls.map(({ ref }) => ref))).toEqual(
      new Set([applicationProviderCallRef('call-1')]),
    );
    expect(calls.every((call) => call === calls[0])).toBe(true);
    await expect(accounting.begin({
      ...plan,
      canonicalRequestHash: digest('2'),
    })).rejects.toMatchObject({
      code: 'APPLIK8S_PROVIDER_ACCOUNTING_PLAN_CONFLICT',
      operation: 'begin',
      identity: 'call-1',
    });
  });

  it('atomically seals one terminal call with matching actual usage and cost', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    const call = await accounting.begin(providerCallPlan());
    const usageEvidenceRef = usageRef('usage-1');
    const finalization = {
      finalizationId: 'finalize-1',
      canonicalRequestHash: digest('3'),
      providerCallRef: call.ref,
      state: 'completed' as const,
      providerRequestRef: 'provider-request-1',
      usageEvidenceRef,
      cost: {
        kind: 'actual' as const,
        costRecordId: 'cost-1',
        canonicalRequestHash: digest('4'),
        currency: 'USD',
        amountMicrounits: 41,
        usageEvidenceRef,
        sourceEvidenceRef: 'provider-response:1',
        pricingRevision: 'price-2026-08',
      },
      completedAt: '2026-08-23T12:00:02.000Z',
    };

    const [first, retry] = await Promise.all([
      accounting.finalize(finalization),
      accounting.finalize(finalization),
    ]);

    expect(retry).toBe(first);
    expect(first).toMatchObject({
      state: 'completed',
      usageEvidenceRef,
      providerCostRecordRef: applicationProviderCostRecordRef('cost-1'),
    });
    const costRecordRef = requiredTestValue(first.providerCostRecordRef);
    await expect(
      accounting.getCostRecord(costRecordRef),
    ).resolves.toMatchObject({
      kind: 'actual',
      amountMicrounits: 41,
      usageEvidenceRef,
      providerCallRef: call.ref,
    });
  });

  it('keeps uncertainty non-terminal and reconciles the same call to explicit zero', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    const call = await accounting.begin(providerCallPlan());
    const provisionalUsageEvidenceRef = usageRef('usage-provisional-1');
    const uncertain = await accounting.markUncertain({
      uncertaintyId: 'uncertain-1',
      canonicalRequestHash: digest('5'),
      providerCallRef: call.ref,
      providerRequestRef: 'provider-request-1',
      provisionalUsageEvidenceRef,
      provisionalCost: {
        kind: 'provisional',
        costRecordId: 'cost-provisional-1',
        canonicalRequestHash: digest('6'),
        currency: 'USD',
        amountMicrounits: 70,
        usageEvidenceRef: provisionalUsageEvidenceRef,
        sourceEvidenceRef: 'provider-timeout:1',
      },
      uncertainAt: '2026-08-23T12:00:02.000Z',
    });
    const usageEvidenceRef = usageRef('usage-zero-1');
    const reconciliationRef = requiredTestValue(uncertain.reconciliationRef);
    const provisionalProviderCostRecordRef = requiredTestValue(
      uncertain.provisionalProviderCostRecordRef,
    );
    const reconciliation = {
      reconciliationRef,
      finalizationId: 'reconcile-finalization-1',
      canonicalRequestHash: digest('7'),
      state: 'failed' as const,
      usageEvidenceRef,
      cost: {
        kind: 'zero' as const,
        costRecordId: 'cost-zero-1',
        canonicalRequestHash: digest('8'),
        currency: 'USD',
        usageEvidenceRef,
        sourceEvidenceRef: 'provider-reconciliation:1',
        reconcilesCostRecordRef: provisionalProviderCostRecordRef,
      },
      completedAt: '2026-08-23T12:05:00.000Z',
    };

    await expect(accounting.reconcile({
      ...reconciliation,
      canonicalRequestHash: digest('9'),
      providerRequestRef: 'provider-request-2',
    })).rejects.toMatchObject({
      code: 'APPLIK8S_PROVIDER_ACCOUNTING_PLAN_CONFLICT',
      operation: 'reconcile',
    });
    const terminal = await accounting.reconcile(reconciliation);
    const retry = await accounting.reconcile(reconciliation);

    expect(retry).toBe(terminal);
    expect(terminal).toMatchObject({
      ref: call.ref,
      state: 'failed',
      providerRequestRef: 'provider-request-1',
      usageEvidenceRef,
      provisionalProviderCostRecordRef:
        applicationProviderCostRecordRef('cost-provisional-1'),
      providerCostRecordRef: applicationProviderCostRecordRef('cost-zero-1'),
    });
    await expect(
      accounting.getCostRecord(
        applicationProviderCostRecordRef('cost-provisional-1'),
      ),
    ).resolves.toMatchObject({ kind: 'provisional', amountMicrounits: 70 });
  });

  it('appends retained signed invoice adjustments without rewriting source cost', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    const call = await accounting.begin(providerCallPlan());
    const usageEvidenceRef = usageRef('usage-1');
    const terminal = await accounting.finalize({
      finalizationId: 'finalize-1',
      canonicalRequestHash: digest('a'),
      providerCallRef: call.ref,
      state: 'completed',
      usageEvidenceRef,
      cost: {
        kind: 'actual',
        costRecordId: 'cost-1',
        canonicalRequestHash: digest('b'),
        currency: 'USD',
        amountMicrounits: 41,
        usageEvidenceRef,
        sourceEvidenceRef: 'provider-response:1',
      },
      completedAt: '2026-08-23T12:00:02.000Z',
    });
    const terminalCostRecordRef = requiredTestValue(
      terminal.providerCostRecordRef,
    );
    const adjustment = {
      providerCallRef: call.ref,
      cost: {
        kind: 'adjustment' as const,
        costRecordId: 'cost-adjustment-1',
        canonicalRequestHash: digest('c'),
        currency: 'USD',
        amountMicrounits: -3,
        sourceEvidenceRef: 'provider-invoice-line:1',
        reconcilesCostRecordRef: terminalCostRecordRef,
      },
      recordedAt: '2026-09-01T00:00:00.000Z',
    };

    const first = await accounting.recordAdjustment(adjustment);
    const retry = await accounting.recordAdjustment(adjustment);

    expect(retry).toBe(first);
    expect(first).toMatchObject({
      kind: 'adjustment',
      amountMicrounits: -3,
      reconcilesCostRecordRef: terminal.providerCostRecordRef,
    });
    await expect(
      accounting.getCostRecord(terminalCostRecordRef),
    ).resolves.toMatchObject({ kind: 'actual', amountMicrounits: 41 });
    await expect(accounting.recordAdjustment({
      ...adjustment,
      cost: {
        ...adjustment.cost,
        canonicalRequestHash: digest('d'),
      },
    })).rejects.toBeInstanceOf(
      ApplicationProviderAccountingPlanConflictError,
    );
  });

  it('does not persist terminal cost when usage linkage is invalid', async () => {
    const accounting = createInMemoryApplicationProviderCallAccounting();
    const call = await accounting.begin(providerCallPlan());

    await expect(accounting.finalize({
      finalizationId: 'finalize-invalid',
      canonicalRequestHash: digest('e'),
      providerCallRef: call.ref,
      state: 'failed',
      usageEvidenceRef: usageRef('usage-call'),
      cost: {
        kind: 'zero',
        costRecordId: 'cost-invalid',
        canonicalRequestHash: digest('f'),
        currency: 'USD',
        usageEvidenceRef: usageRef('usage-cost'),
        sourceEvidenceRef: 'provider-result:invalid',
      },
      completedAt: '2026-08-23T12:00:02.000Z',
    })).rejects.toThrow(/usage evidence must match/);
    await expect(accounting.getCostRecord(
      applicationProviderCostRecordRef('cost-invalid'),
    )).resolves.toBeUndefined();
    await expect(accounting.getCall(call.ref)).resolves.toMatchObject({
      state: 'started',
    });
  });
});

describe('admitted provider-accounting handle', () => {
  it('uses the admitted principal scope across digest, role, and issuer rotation', () => {
    const principal = {
      id: 'provider-worker',
      identity: {
        id: 'identity:provider-worker',
        issuer: 'applik8s://authority-test',
        subject: 'provider-worker',
      },
    };
    const first = applicationProviderAccountingPrincipalScope({
      principal,
      trustedContext: {
        digest: '1'.repeat(64),
        values: {
          principalScope: 'workspace-a',
          workspaceRole: 'owner',
          issuer: 'https://identity.example/v1',
          authorityRevision: 'revision-1',
        },
      },
    });
    const rotated = applicationProviderAccountingPrincipalScope({
      principal,
      trustedContext: {
        digest: '2'.repeat(64),
        values: {
          principalScope: 'workspace-a',
          workspaceRole: 'member',
          issuer: 'https://identity.example/v2',
          authorityRevision: 'revision-2',
        },
      },
    });
    const changedTenant = applicationProviderAccountingPrincipalScope({
      principal,
      trustedContext: {
        digest: '3'.repeat(64),
        values: {
          principalScope: 'workspace-b',
          workspaceRole: 'owner',
        },
      },
    });

    expect(rotated).toBe(first);
    expect(changedTenant).not.toBe(first);
    expect(first).toBe('workspace-a');
    expect(changedTenant).toBe('workspace-b');
  });

  it('uses the existing personal-principal convention only when scope is absent', () => {
    const personal = applicationProviderAccountingPrincipalScope({
      principal: { id: 'person-1' },
      trustedContext: {
        digest: '1'.repeat(64),
        values: { workspaceRole: 'authenticated' },
      },
    });
    const rotated = applicationProviderAccountingPrincipalScope({
      principal: { id: 'person-1' },
      trustedContext: {
        digest: '2'.repeat(64),
        values: { workspaceRole: 'operator', authorityRevision: 'revision-2' },
      },
    });

    expect(personal).toBe('person-1');
    expect(rotated).toBe(personal);
  });

  it('fails closed for malformed admitted principal scopes', () => {
    const authority = (principalScope: unknown) => ({
      principal: { id: 'person-1' },
      trustedContext: {
        digest: '1'.repeat(64),
        values: { principalScope },
      },
    });

    expect(() => applicationProviderAccountingPrincipalScope(
      authority('  '),
    )).toThrow(/principalScope must be a non-empty string/);
    expect(() => applicationProviderAccountingPrincipalScope(
      authority({ workspace: 'workspace-a' }),
    )).toThrow(/principalScope must be a non-empty string/);
    expect(() => applicationProviderAccountingPrincipalScope(
      authority('x'.repeat(2_049)),
    )).toThrow(/principalScope must not exceed 2048 characters/);
    expect(() => applicationProviderAccountingPrincipalScope({
      principal: { id: 'person-1' },
      trustedContext: {
        digest: 'not-a-transport-digest',
        values: { principalScope: 'workspace-a' },
      },
    })).toThrow(/trustedContext.digest must be a lowercase 64-character/);
  });

  it('derives tenant-separated identities, owns time, and validates exact requests', async () => {
    const store = createInMemoryApplicationProviderCallAccounting();
    const at = '2026-08-23T12:00:00.000Z';
    const first = bindApplicationProviderCallAccounting(store, {
      principal: { id: 'provider-worker' },
      trustedContext: {
        digest: 'a'.repeat(64),
        values: { principalScope: 'tenant-a' },
      },
      now: () => at,
    });
    const second = bindApplicationProviderCallAccounting(store, {
      principal: { id: 'provider-worker' },
      trustedContext: {
        digest: 'b'.repeat(64),
        values: { principalScope: 'tenant-b' },
      },
      now: () => at,
    });
    const plan = {
      providerCallId: 'shared-external-id',
      operationRef: 'acquire:1',
      provider: 'primary',
      capability: 'acquire',
      reservationRef: 'reservation:1',
    };
    const request = {
      ...plan,
      canonicalRequestHash: applicationProviderCallPlanHashV1(plan),
    };

    const [left, retry, right] = await Promise.all([
      first.begin(request),
      first.begin(request),
      second.begin(request),
    ]);

    expect(retry.ref).toBe(left.ref);
    expect(right.ref).not.toBe(left.ref);
    expect(left.startedAt).toBe(at);
    await expect(second.getCall(left.ref)).resolves.toBeUndefined();
    await expect(first.begin({
      ...request,
      provider: 'different',
    })).rejects.toBeInstanceOf(ApplicationProviderAccountingRequestHashError);
    const oversizedPlan = { ...plan, providerCallId: 'x'.repeat(2_049) };
    await expect(first.begin({
      ...oversizedPlan,
      canonicalRequestHash: applicationProviderCallPlanHashV1(oversizedPlan),
    })).rejects.toThrow(/2048 characters/);

    const usageEvidenceRef = usageRef('scoped-usage');
    const costWithoutHash = {
      kind: 'zero' as const,
      costRecordId: 'zero-cost',
      currency: 'USD',
      usageEvidenceRef,
      sourceEvidenceRef: 'provider-result:1',
    };
    const cost = {
      ...costWithoutHash,
      canonicalRequestHash: applicationProviderCostHashV1(left.ref, costWithoutHash),
    };
    const finalizationWithoutHash = {
      providerCallRef: left.ref,
      state: 'completed' as const,
      usageEvidenceRef,
      cost,
    };
    const terminal = await first.finalize({
      finalizationId: 'finish',
      ...finalizationWithoutHash,
      canonicalRequestHash: applicationProviderCallFinalizationHashV1(finalizationWithoutHash),
    });
    expect(terminal).toMatchObject({ state: 'completed', completedAt: at });
    const retainedCost = await first.getCostRecord(
      requiredTestValue(terminal.providerCostRecordRef),
    );
    expect(retainedCost?.costRecordId).not.toBe(costWithoutHash.costRecordId);
    expect(retainedCost).toMatchObject({
      canonicalRequestHash: cost.canonicalRequestHash,
      principalScope: 'tenant-a',
    });
  });

  it('attributes a subordinate cost-hash mismatch to its owning transition', async () => {
    const store = createInMemoryApplicationProviderCallAccounting();
    const accounting = bindApplicationProviderCallAccounting(store, {
      principal: { id: 'provider-worker' },
      trustedContext: {
        digest: 'a'.repeat(64),
        values: { principalScope: 'tenant-a' },
      },
      now: () => '2026-08-23T12:00:00.000Z',
    });
    const plan = {
      providerCallId: 'call-with-bad-cost',
      operationRef: 'acquire:bad-cost',
      provider: 'primary',
      capability: 'acquire',
      reservationRef: 'reservation:bad-cost',
    };
    const call = await accounting.begin({
      ...plan,
      canonicalRequestHash: applicationProviderCallPlanHashV1(plan),
    });
    const usageEvidenceRef = usageRef('bad-cost-usage');
    const cost = {
      kind: 'zero' as const,
      costRecordId: 'bad-cost',
      canonicalRequestHash: digest('f'),
      currency: 'USD',
      usageEvidenceRef,
      sourceEvidenceRef: 'provider-result:bad-cost',
    };
    const finalization = {
      providerCallRef: call.ref,
      state: 'failed' as const,
      usageEvidenceRef,
      cost,
    };

    await expect(accounting.finalize({
      finalizationId: 'finish-bad-cost',
      ...finalization,
      canonicalRequestHash:
        applicationProviderCallFinalizationHashV1(finalization),
    })).rejects.toMatchObject({
      code: 'APPLIK8S_PROVIDER_ACCOUNTING_REQUEST_HASH_MISMATCH',
      operation: 'finalize',
    });
  });
});

function providerCallPlan(): ApplicationProviderCallPlan {
  return {
    providerCallId: 'call-1',
    canonicalRequestHash: digest('1'),
    principalScope: 'workspace-1',
    operationRef: 'agent-invocation:1',
    provider: 'provider-a',
    capability: 'structured-generation',
    reservationRef: 'budget-reservation:1',
    startedAt: '2026-08-23T12:00:00.000Z',
  };
}

function usageRef(id: string): ApplicationUsageEvidenceRef {
  return `applik8s:usage-evidence:v1:${id}` as ApplicationUsageEvidenceRef;
}

function digest(character: string): string {
  return character.repeat(64);
}

function requiredTestValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected retained accounting reference.');
  return value;
}

function contextWithEntitlements(
  entitlements: readonly Record<string, unknown>[],
): ApplicationModelCommandContext {
  // typecast: implement only the public now/models subset read by this helper.
  return {
    now: '2026-06-01T00:00:00.000Z',
    models: {
      Entitlement: {
        async query() {
          return {
            items: entitlements.map((spec, index) => ({
              id: `entitlement-${index}`,
              spec,
            })),
          };
        },
      },
    },
  } as unknown as ApplicationModelCommandContext;
}
