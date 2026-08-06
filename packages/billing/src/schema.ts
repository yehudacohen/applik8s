import {
  field,
  index,
  model,
  pgEnum,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationSubscriptionState = pgEnum(
  'applik8s_subscription_state',
  ['active', 'past_due', 'cancelled'],
);

export const applicationBillingPlans = model(
  'applik8s_billing_plans',
  {
    id: field.text('id').primaryKey(),
    name: field.text('name').notNull(),
    description: field.text('description').notNull(),
    interval: field.text('interval').notNull(),
    priceMicrounits: field.bigint('price_microunits', {
      mode: 'number',
    }).notNull(),
    currency: field.text('currency').notNull(),
    capabilities: field.jsonb('capabilities').notNull(),
    active: field.boolean('active').notNull().default(true),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  { name: 'BillingPlan', revision: false },
);

export const applicationSubscriptions = model(
  'applik8s_subscriptions',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    planId: field.text('plan_id').notNull(),
    provider: field.text('provider').notNull(),
    providerCustomerId: field.text('provider_customer_id').notNull(),
    providerSubscriptionId: field.text('provider_subscription_id').notNull(),
    status: applicationSubscriptionState('status').notNull(),
    periodStart: field.timestamp('period_start', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    periodEnd: field.timestamp('period_end', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    providerOccurredAt: field.timestamp('provider_occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_subscriptions_scope_uidx').on(table.principalScope),
    uniqueIndex('applik8s_subscriptions_provider_uidx').on(
      table.provider,
      table.providerSubscriptionId,
    ),
    index('applik8s_subscriptions_status_idx').on(
      table.status,
      table.periodEnd,
    ),
  ],
  { name: 'Subscription', revision: false },
);

export const applicationPaymentEvents = model(
  'applik8s_payment_events',
  {
    id: field.text('id').primaryKey(),
    provider: field.text('provider').notNull(),
    providerEventId: field.text('provider_event_id').notNull(),
    principalScope: field.text('principal_scope').notNull(),
    providerSubscriptionId: field.text('provider_subscription_id').notNull(),
    type: field.text('type').notNull(),
    occurredAt: field.timestamp('occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    payload: field.jsonb('payload').notNull(),
    receivedAt: field.timestamp('received_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_payment_events_provider_uidx').on(
      table.provider,
      table.providerEventId,
    ),
    index('applik8s_payment_events_scope_time_idx').on(
      table.principalScope,
      table.occurredAt,
    ),
  ],
  { name: 'PaymentEvent', revision: false },
);

export const applicationBillingSchema = Object.freeze({
  applicationBillingPlans,
  applicationSubscriptions,
  applicationPaymentEvents,
});
