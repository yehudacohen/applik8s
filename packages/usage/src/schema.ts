import {
  field,
  index,
  model,
  pgEnum,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';
import { sql } from 'drizzle-orm';
import { check, foreignKey } from 'drizzle-orm/pg-core';
import type {
  ApplicationProviderCallRef,
  ApplicationProviderCostRecordRef,
  ApplicationProviderReconciliationRef,
  ApplicationUsageEvidenceRef,
} from './provider-accounting.js';

export const applicationProviderCallState = pgEnum(
  'applik8s_provider_call_state',
  ['started', 'uncertain', 'completed', 'failed', 'cancelled'],
);

export const applicationProviderCostKind = pgEnum(
  'applik8s_provider_cost_kind',
  ['zero', 'actual', 'provisional', 'adjustment'],
);

export const applicationUsageFacts = model(
  'applik8s_usage_facts',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    operationId: field.text('operation_id'),
    invocationId: field.text('invocation_id'),
    protocolRunId: field.text('protocol_run_id'),
    attemptId: field.text('attempt_id'),
    provider: field.text('provider'),
    backend: field.text('backend'),
    logicalModel: field.text('logical_model'),
    inputTokens: field.integer('input_tokens'),
    outputTokens: field.integer('output_tokens'),
    cachedInputTokens: field.integer('cached_input_tokens'),
    reasoningTokens: field.integer('reasoning_tokens'),
    costMicrounits: field.bigint('cost_microunits', { mode: 'number' }),
    pricingRevision: field.text('pricing_revision'),
    confidence: field.text('confidence').notNull(),
    dimensions: field.jsonb('dimensions').notNull(),
    occurredAt: field.timestamp('occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    recordedAt: field.timestamp('recorded_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_usage_facts_attempt_uidx').on(
      table.attemptId,
      table.pricingRevision,
    ),
    index('applik8s_usage_facts_scope_time_idx').on(
      table.principalScope,
      table.occurredAt,
    ),
  ],
  { name: 'UsageFact', revision: false },
);

export const applicationEntitlements = model(
  'applik8s_entitlements',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    capability: field.text('capability').notNull(),
    limit: field.bigint('limit', { mode: 'number' }),
    period: field.text('period'),
    constraints: field.jsonb('constraints').notNull(),
    authorityRevision: field.text('authority_revision').notNull(),
    validFrom: field.timestamp('valid_from', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    validUntil: field.timestamp('valid_until', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    uniqueIndex('applik8s_entitlements_scope_capability_uidx').on(
      table.principalScope,
      table.capability,
      table.authorityRevision,
    ),
  ],
  { name: 'Entitlement', revision: false },
);

/**
 * One row per external provider request. The provider-call identity is
 * established before dispatch and remains stable through uncertainty and
 * reconciliation. Customer billing never writes or owns this table.
 */
export const applicationProviderCalls = model(
  'applik8s_provider_calls',
  {
    id: field.text('id').primaryKey(),
    ref: field.text('ref').$type<ApplicationProviderCallRef>().notNull(),
    canonicalRequestHash: field.text('canonical_request_hash').notNull(),
    principalScope: field.text('principal_scope').notNull(),
    operationRef: field.text('operation_ref').notNull(),
    provider: field.text('provider').notNull(),
    capability: field.text('capability').notNull(),
    reservationRef: field.text('reservation_ref').notNull(),
    state: applicationProviderCallState('state').notNull(),
    providerRequestRef: field.text('provider_request_ref'),
    usageEvidenceRef: field.text('usage_evidence_ref')
      .$type<ApplicationUsageEvidenceRef>(),
    providerCostRecordRef: field.text('provider_cost_record_ref')
      .$type<ApplicationProviderCostRecordRef>(),
    provisionalUsageEvidenceRef: field.text('provisional_usage_evidence_ref')
      .$type<ApplicationUsageEvidenceRef>(),
    provisionalProviderCostRecordRef: field.text(
      'provisional_provider_cost_record_ref',
    ).$type<ApplicationProviderCostRecordRef>(),
    reconciliationRef: field.text('reconciliation_ref')
      .$type<ApplicationProviderReconciliationRef>(),
    uncertaintyId: field.text('uncertainty_id'),
    uncertaintyRequestHash: field.text('uncertainty_request_hash'),
    finalizationId: field.text('finalization_id'),
    finalizationRequestHash: field.text('finalization_request_hash'),
    startedAt: field.timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    uncertainAt: field.timestamp('uncertain_at', {
      withTimezone: true,
      mode: 'string',
    }),
    completedAt: field.timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    recordedAt: field.timestamp('recorded_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_provider_calls_ref_uidx').on(table.ref),
    uniqueIndex('applik8s_provider_calls_scope_ref_uidx').on(table.principalScope, table.ref),
    uniqueIndex('applik8s_provider_calls_uncertainty_uidx').on(
      table.uncertaintyId,
    ),
    uniqueIndex('applik8s_provider_calls_finalization_uidx').on(
      table.finalizationId,
    ),
    index('applik8s_provider_calls_scope_time_idx').on(
      table.principalScope,
      table.startedAt,
    ),
    index('applik8s_provider_calls_state_idx').on(
      table.state,
      table.startedAt,
    ),
    check(
      'applik8s_provider_calls_state_shape_check',
      sql`(
        (${table.state} = 'started'
          AND ${table.uncertaintyId} IS NULL
          AND ${table.finalizationId} IS NULL
          AND ${table.usageEvidenceRef} IS NULL
          AND ${table.providerCostRecordRef} IS NULL
          AND ${table.completedAt} IS NULL)
        OR
        (${table.state} = 'uncertain'
          AND ${table.uncertaintyId} IS NOT NULL
          AND ${table.uncertaintyRequestHash} IS NOT NULL
          AND ${table.reconciliationRef} IS NOT NULL
          AND ${table.uncertainAt} IS NOT NULL
          AND ${table.finalizationId} IS NULL
          AND ${table.usageEvidenceRef} IS NULL
          AND ${table.providerCostRecordRef} IS NULL
          AND ${table.completedAt} IS NULL)
        OR
        (${table.state} IN ('completed', 'failed', 'cancelled')
          AND ${table.finalizationId} IS NOT NULL
          AND ${table.finalizationRequestHash} IS NOT NULL
          AND ${table.usageEvidenceRef} IS NOT NULL
          AND ${table.providerCostRecordRef} IS NOT NULL
          AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
    check('applik8s_provider_calls_hash_check', sql`${table.canonicalRequestHash} ~ '^[0-9a-f]{64}$' AND (${table.uncertaintyRequestHash} IS NULL OR ${table.uncertaintyRequestHash} ~ '^[0-9a-f]{64}$') AND (${table.finalizationRequestHash} IS NULL OR ${table.finalizationRequestHash} ~ '^[0-9a-f]{64}$')`),
    check('applik8s_provider_calls_time_order_check', sql`(${table.uncertainAt} IS NULL OR ${table.uncertainAt} >= ${table.startedAt}) AND (${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt}) AND (${table.uncertainAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.uncertainAt})`),
  ],
  { name: 'ProviderCall', revision: false },
);

/**
 * Append-only provider-cost source records. Provisional observations and
 * later invoice adjustments are new rows; neither mutates an earlier fact.
 */
export const applicationProviderCostRecords = model(
  'applik8s_provider_cost_records',
  {
    id: field.text('id').primaryKey(),
    ref: field.text('ref').$type<ApplicationProviderCostRecordRef>().notNull(),
    principalScope: field.text('principal_scope').notNull(),
    providerCallRef: field.text('provider_call_ref')
      .$type<ApplicationProviderCallRef>()
      .notNull(),
    canonicalRequestHash: field.text('canonical_request_hash').notNull(),
    kind: applicationProviderCostKind('kind').notNull(),
    currency: field.text('currency').notNull(),
    amountMicrounits: field.bigint('amount_microunits', {
      mode: 'number',
    }).notNull(),
    usageEvidenceRef: field.text('usage_evidence_ref')
      .$type<ApplicationUsageEvidenceRef>(),
    sourceEvidenceRef: field.text('source_evidence_ref').notNull(),
    pricingRevision: field.text('pricing_revision'),
    allocationMethod: field.text('allocation_method'),
    reconcilesCostRecordRef: field.text('reconciles_cost_record_ref')
      .$type<ApplicationProviderCostRecordRef>(),
    recordedAt: field.timestamp('recorded_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
  },
  (table) => [
    uniqueIndex('applik8s_provider_cost_records_ref_uidx').on(table.ref),
    uniqueIndex('applik8s_provider_cost_records_scope_ref_uidx').on(table.principalScope, table.ref),
    index('applik8s_provider_cost_records_call_idx').on(
      table.providerCallRef,
      table.recordedAt,
    ),
    index('applik8s_provider_cost_records_reconciliation_idx').on(
      table.reconcilesCostRecordRef,
    ),
    check(
      'applik8s_provider_cost_records_kind_shape_check',
      sql`(
        (${table.kind} = 'zero'
          AND ${table.amountMicrounits} = 0
          AND ${table.usageEvidenceRef} IS NOT NULL)
        OR
        (${table.kind} = 'actual'
          AND ${table.amountMicrounits} > 0
          AND ${table.usageEvidenceRef} IS NOT NULL)
        OR
        (${table.kind} = 'provisional'
          AND ${table.amountMicrounits} >= 0
          AND ${table.reconcilesCostRecordRef} IS NULL)
        OR
        (${table.kind} = 'adjustment'
          AND ${table.reconcilesCostRecordRef} IS NOT NULL)
      )`,
    ),
    foreignKey({
      name: 'applik8s_provider_cost_records_call_fk',
      columns: [table.principalScope, table.providerCallRef],
      foreignColumns: [applicationProviderCalls.principalScope, applicationProviderCalls.ref],
    }),
    foreignKey({
      name: 'applik8s_provider_cost_records_reconciles_fk',
      columns: [table.principalScope, table.reconcilesCostRecordRef],
      foreignColumns: [table.principalScope, table.ref],
    }),
    check('applik8s_provider_cost_records_hash_check', sql`${table.canonicalRequestHash} ~ '^[0-9a-f]{64}$'`),
  ],
  { name: 'ProviderCostRecord', revision: false },
);

export const applicationUsageSchema = Object.freeze({
  applicationUsageFacts,
  applicationEntitlements,
  applicationProviderCalls,
  applicationProviderCostRecords,
});
