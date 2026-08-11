import {
  field,
  index,
  model,
  pgEnum,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationSubscriptionState = pgEnum(
  'applik8s_subscription_state',
  [
    'trialing',
    'active',
    'past_due',
    'paused',
    'unpaid',
    'cancelled',
    'incomplete',
  ],
);

export const applicationBillingCatalogVersionState = pgEnum(
  'applik8s_billing_catalog_version_state',
  ['draft', 'published', 'retired'],
);

export const applicationBillingModel = pgEnum(
  'applik8s_billing_model',
  ['flat', 'per_seat', 'metered'],
);

export const applicationBillingUsageDeliveryState = pgEnum(
  'applik8s_billing_usage_delivery_state',
  ['pending', 'delivering', 'delivered', 'failed'],
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
    sortOrder: field.integer('sort_order').notNull().default(0),
    active: field.boolean('active').notNull().default(true),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  { name: 'BillingPlan', revision: false },
);

export const applicationBillingCatalogVersions = model(
  'applik8s_billing_catalog_versions',
  {
    id: field.text('id').primaryKey(),
    planId: field.text('plan_id').notNull(),
    version: field.integer('version').notNull(),
    state: applicationBillingCatalogVersionState('state').notNull(),
    currency: field.text('currency').notNull(),
    recommended: field.boolean('recommended').notNull().default(false),
    publishedAt: field.timestamp('published_at', {
      withTimezone: true,
      mode: 'string',
    }),
    retiredAt: field.timestamp('retired_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_catalog_versions_number_uidx').on(
      table.planId,
      table.version,
    ),
    index('applik8s_billing_catalog_versions_state_idx').on(
      table.planId,
      table.state,
    ),
  ],
  { name: 'BillingCatalogVersion', revision: false },
);

export const applicationBillingCatalogPrices = model(
  'applik8s_billing_catalog_prices',
  {
    id: field.text('id').primaryKey(),
    catalogVersionId: field.text('catalog_version_id').notNull(),
    billingModel: applicationBillingModel('billing_model').notNull(),
    interval: field.text('interval'),
    unitAmountMicrounits: field.bigint('unit_amount_microunits', {
      mode: 'number',
    }).notNull(),
    includedQuantity: field.bigint('included_quantity', {
      mode: 'number',
    }),
    meterKey: field.text('meter_key'),
    provider: field.text('provider').notNull(),
    providerProductId: field.text('provider_product_id'),
    providerPriceId: field.text('provider_price_id'),
    lookupKey: field.text('lookup_key'),
    active: field.boolean('active').notNull().default(true),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_catalog_prices_lookup_uidx').on(
      table.provider,
      table.lookupKey,
    ),
    index('applik8s_billing_catalog_prices_version_idx').on(
      table.catalogVersionId,
      table.active,
    ),
  ],
  { name: 'BillingCatalogPrice', revision: false },
);

export const applicationBillingCatalogEntitlements = model(
  'applik8s_billing_catalog_entitlements',
  {
    id: field.text('id').primaryKey(),
    catalogVersionId: field.text('catalog_version_id').notNull(),
    capability: field.text('capability').notNull(),
    enabled: field.boolean('enabled').notNull().default(true),
    quantityLimit: field.bigint('quantity_limit', { mode: 'number' }),
    constraints: field.jsonb('constraints').notNull(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_catalog_entitlements_uidx').on(
      table.catalogVersionId,
      table.capability,
    ),
  ],
  { name: 'BillingCatalogEntitlement', revision: false },
);

export const applicationBillingMeters = model(
  'applik8s_billing_meters',
  {
    id: field.text('id').primaryKey(),
    key: field.text('key').notNull(),
    displayName: field.text('display_name').notNull(),
    aggregation: field.text('aggregation').notNull(),
    eventName: field.text('event_name').notNull(),
    provider: field.text('provider').notNull(),
    providerMeterId: field.text('provider_meter_id'),
    active: field.boolean('active').notNull().default(true),
  },
  (table) => [
    uniqueIndex('applik8s_billing_meters_key_uidx').on(table.key),
    uniqueIndex('applik8s_billing_meters_event_uidx').on(
      table.provider,
      table.eventName,
    ),
  ],
  { name: 'BillingMeter', revision: false },
);

export const applicationBillingCustomers = model(
  'applik8s_billing_customers',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    provider: field.text('provider').notNull(),
    providerCustomerId: field.text('provider_customer_id').notNull(),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_customers_scope_uidx').on(
      table.principalScope,
      table.provider,
    ),
    uniqueIndex('applik8s_billing_customers_provider_uidx').on(
      table.provider,
      table.providerCustomerId,
    ),
  ],
  { name: 'BillingCustomer', revision: false },
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
    catalogVersionId: field.text('catalog_version_id'),
    cancelAtPeriodEnd: field.boolean('cancel_at_period_end').notNull().default(false),
    scheduledCatalogVersionId: field.text('scheduled_catalog_version_id'),
    scheduledChangeAt: field.timestamp('scheduled_change_at', {
      withTimezone: true,
      mode: 'string',
    }),
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

export const applicationBillingSubscriptionItems = model(
  'applik8s_billing_subscription_items',
  {
    id: field.text('id').primaryKey(),
    subscriptionId: field.text('subscription_id').notNull(),
    catalogPriceId: field.text('catalog_price_id'),
    providerSubscriptionItemId: field.text('provider_subscription_item_id'),
    providerPriceId: field.text('provider_price_id'),
    billingModel: applicationBillingModel('billing_model').notNull(),
    meterKey: field.text('meter_key'),
    quantity: field.bigint('quantity', { mode: 'number' }).notNull(),
    active: field.boolean('active').notNull().default(true),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_subscription_items_provider_uidx').on(
      table.providerSubscriptionItemId,
    ),
    index('applik8s_billing_subscription_items_subscription_idx').on(
      table.subscriptionId,
      table.active,
    ),
  ],
  { name: 'BillingSubscriptionItem', revision: false },
);

export const applicationBillingUsageLedger = model(
  'applik8s_billing_usage_ledger',
  {
    id: field.text('id').primaryKey(),
    idempotencyKey: field.text('idempotency_key').notNull(),
    principalScope: field.text('principal_scope').notNull(),
    subscriptionItemId: field.text('subscription_item_id'),
    meterKey: field.text('meter_key').notNull(),
    quantity: field.bigint('quantity', { mode: 'number' }).notNull(),
    billableQuantity: field.bigint('billable_quantity', {
      mode: 'number',
    }).notNull(),
    occurredAt: field.timestamp('occurred_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    dimensions: field.jsonb('dimensions').notNull(),
    deliveryState: applicationBillingUsageDeliveryState(
      'delivery_state',
    ).notNull(),
    deliveryAttempts: field.integer('delivery_attempts').notNull().default(0),
    providerEventId: field.text('provider_event_id'),
    lastError: field.text('last_error'),
    nextAttemptAt: field.timestamp('next_attempt_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_billing_usage_ledger_idempotency_uidx').on(
      table.idempotencyKey,
    ),
    index('applik8s_billing_usage_ledger_delivery_idx').on(
      table.deliveryState,
      table.nextAttemptAt,
    ),
    index('applik8s_billing_usage_ledger_scope_time_idx').on(
      table.principalScope,
      table.occurredAt,
    ),
  ],
  { name: 'BillingUsageLedgerEntry', revision: false },
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
  applicationBillingCatalogVersions,
  applicationBillingCatalogPrices,
  applicationBillingCatalogEntitlements,
  applicationBillingMeters,
  applicationBillingCustomers,
  applicationSubscriptions,
  applicationBillingSubscriptionItems,
  applicationBillingUsageLedger,
  applicationPaymentEvents,
});
