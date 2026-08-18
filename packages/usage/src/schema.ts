import {
  field,
  index,
  model,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

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

export const applicationUsageSchema = Object.freeze({
  applicationUsageFacts,
  applicationEntitlements,
});
