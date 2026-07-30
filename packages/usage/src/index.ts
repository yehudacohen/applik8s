import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const applicationUsageFacts = pgTable(
  'applik8s_usage_facts',
  {
    id: text('id').primaryKey(),
    principalScope: text('principal_scope').notNull(),
    operationId: text('operation_id'),
    invocationId: text('invocation_id'),
    attemptId: text('attempt_id'),
    provider: text('provider'),
    backend: text('backend'),
    logicalModel: text('logical_model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    costMicrounits: bigint('cost_microunits', { mode: 'number' }),
    pricingRevision: text('pricing_revision'),
    confidence: text('confidence').notNull(),
    dimensions: jsonb('dimensions').notNull(),
    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    recordedAt: timestamp('recorded_at', {
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
);

export const applicationEntitlements = pgTable(
  'applik8s_entitlements',
  {
    id: text('id').primaryKey(),
    principalScope: text('principal_scope').notNull(),
    capability: text('capability').notNull(),
    limit: bigint('limit', { mode: 'number' }),
    period: text('period'),
    constraints: jsonb('constraints').notNull(),
    authorityRevision: text('authority_revision').notNull(),
    validFrom: timestamp('valid_from', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    validUntil: timestamp('valid_until', {
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
);

export const applicationUsageSchema = Object.freeze({
  applicationUsageFacts,
  applicationEntitlements,
});

export interface ApplicationUsageModuleOptions {
  readonly database?: ApplicationDatabaseBinding;
}

export function usage(
  application: Pick<KubernetesApplicationBuilder, 'model'>,
  options: ApplicationUsageModuleOptions = {},
) {
  const modelOptions = options.database
    ? { database: options.database }
    : undefined;
  const UsageFact = application.model(applicationUsageFacts, {
    ...modelOptions,
    name: 'UsageFact',
    revision: false,
  });
  const Entitlement = application.model(applicationEntitlements, {
    ...modelOptions,
    name: 'Entitlement',
    revision: false,
  });
  return Object.freeze({ UsageFact, Entitlement });
}
