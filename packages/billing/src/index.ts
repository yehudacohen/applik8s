import type {
  ApplicationRelationalModel,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  defineApplicationProvider,
  module,
} from '@applik8s/applik8s';
import {
  bindApplicationCallableDependencies,
  bindApplicationProviderDependencies,
  resolveApplicationProviderRuntimeImplementation,
} from '@applik8s/applik8s/internal/provider-runtime';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  applicationBillingCatalogEntitlements,
  applicationBillingCatalogPrices,
  applicationBillingCatalogVersions,
  applicationBillingCustomers,
  applicationBillingMeters,
  applicationBillingPlans,
  applicationBillingSchema,
  applicationBillingSubscriptionItems,
  applicationBillingUsageLedger,
  applicationPaymentEvents,
  applicationSubscriptions,
} from './schema.js';

export * from './schema.js';

export type PaymentMode = 'simulated' | 'live';
export type BillingChangeTiming = 'immediate' | 'periodEnd';
export type BillingProrationBehavior =
  | 'alwaysInvoice'
  | 'createProrations'
  | 'none';

export interface BillingProviderCapabilities {
  readonly checkout: boolean;
  readonly portal: boolean;
  readonly subscriptionChanges: boolean;
  readonly scheduledChanges: boolean;
  readonly meteredUsage: boolean;
}

export interface PaymentCheckoutInput {
  readonly principalScope: string;
  readonly plan: string;
  readonly returnTo: string;
  readonly idempotencyKey: string;
  /** Existing canonical provider mapping, supplied only by the billing module. */
  readonly providerCustomerId?: string;
}

export interface PaymentCheckout {
  readonly provider: string;
  /**
   * Checkout providers may not allocate a customer until the hosted checkout
   * completes. The authenticated webhook establishes that durable mapping.
   */
  readonly providerCustomerId?: string;
  readonly providerCheckoutId: string;
  readonly url: string;
  readonly mode: PaymentMode;
  readonly expiresAt?: string;
}

export interface PaymentPortalInput {
  readonly principalScope: string;
  readonly providerCustomerId: string;
  readonly returnTo: string;
  readonly idempotencyKey: string;
}

export interface PaymentPortal {
  readonly provider: string;
  readonly url: string;
  readonly mode: PaymentMode;
}

export interface SubscriptionChangeItem {
  readonly subscriptionItemId?: string;
  readonly price: string;
  readonly quantity?: number;
}

export interface SubscriptionChangeInput {
  readonly principalScope: string;
  readonly providerSubscriptionId: string;
  readonly items: readonly SubscriptionChangeItem[];
  readonly timing: BillingChangeTiming;
  readonly proration?: BillingProrationBehavior;
  readonly idempotencyKey: string;
}

export interface SubscriptionChangePreview {
  readonly provider: string;
  readonly currency: string;
  readonly amountDueMicrounits: number;
  readonly totalMicrounits: number;
  readonly effectiveAt: string;
  readonly lines: readonly {
    readonly description: string;
    readonly amountMicrounits: number;
  }[];
}

export interface SubscriptionChangeResult {
  readonly provider: string;
  readonly providerSubscriptionId: string;
  readonly state: 'applied' | 'scheduled';
  readonly effectiveAt: string;
}

export interface SubscriptionCancellationInput {
  readonly principalScope: string;
  readonly providerSubscriptionId: string;
  readonly timing: BillingChangeTiming;
  readonly idempotencyKey: string;
}

export interface SubscriptionCancellationResult {
  readonly provider: string;
  readonly providerSubscriptionId: string;
  readonly cancelled: boolean;
  readonly effectiveAt: string;
}

export interface BillingUsageReportInput {
  readonly principalScope: string;
  readonly providerCustomerId: string;
  readonly subscriptionItemId?: string;
  readonly meter: string;
  readonly quantity: number;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly dimensions?: Readonly<Record<string, string>>;
}

export interface BillingUsageReport {
  readonly provider: string;
  readonly providerEventId: string;
  readonly idempotencyKey: string;
  readonly acceptedAt: string;
}

/**
 * Application-facing billing intents. Provider identifiers are deliberately
 * absent: the billing module resolves them from canonical tenant-scoped rows.
 */
export type BillingCheckoutInput = Omit<
  PaymentCheckoutInput,
  'providerCustomerId'
>;
export type BillingPortalInput = Omit<
  PaymentPortalInput,
  'providerCustomerId'
>;
export interface BillingSubscriptionChangeInput {
  readonly principalScope: string;
  readonly plan: string;
  readonly timing: BillingChangeTiming;
  readonly proration?: BillingProrationBehavior;
  readonly idempotencyKey: string;
}
export interface BillingSubscriptionCancellationInput {
  readonly principalScope: string;
  readonly timing: BillingChangeTiming;
  readonly idempotencyKey: string;
}
export interface BillingSubscriptionResumeInput {
  readonly principalScope: string;
  readonly idempotencyKey: string;
}
export type BillingMeteredUsageInput = Omit<
  BillingUsageReportInput,
  'providerCustomerId'
>;

export interface PaymentWebhookInput {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PaymentProviderEvent {
  readonly provider: string;
  readonly id: string;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly principalScope: string;
  readonly plan: string;
  readonly status: 'active' | 'pastDue' | 'cancelled';
  readonly occurredAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly rawType: string;
}

export interface ApplicationPaymentProvider {
  /** Stable provider identity persisted in BillingCustomer/Subscription rows. */
  readonly provider: string;
  readonly kind: string;
  readonly mode: PaymentMode;
  readonly capabilities: BillingProviderCapabilities;
  startCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckout>;
  openPortal(input: PaymentPortalInput): Promise<PaymentPortal>;
  previewSubscriptionChange?(
    input: SubscriptionChangeInput,
  ): Promise<SubscriptionChangePreview>;
  changeSubscription?(
    input: SubscriptionChangeInput,
  ): Promise<SubscriptionChangeResult>;
  cancelSubscription?(
    input: SubscriptionCancellationInput,
  ): Promise<SubscriptionCancellationResult>;
  resumeSubscription?(
    input: Omit<SubscriptionCancellationInput, 'timing'>,
  ): Promise<SubscriptionCancellationResult>;
  reportUsage?(input: BillingUsageReportInput): Promise<BillingUsageReport>;
  verifyWebhook?(input: PaymentWebhookInput): Promise<PaymentProviderEvent>;
}

export const PaymentProvider =
  defineApplicationProvider<ApplicationPaymentProvider>({
    interface: 'PaymentProvider',
    version: 'v1alpha1',
    description:
      'Provider-neutral checkout, billing portal, and authenticated subscription events.',
    requirements: [
      'checkout and portal calls are idempotent',
      'webhook events are authenticated before publication',
    ],
    guarantees: [
      'provider credentials never enter browser contracts',
      'subscription facts remain provider-neutral',
    ],
    accepts(value): value is ApplicationPaymentProvider {
      return Boolean(
        value
          && typeof value === 'object'
          && typeof Reflect.get(value, 'provider') === 'string'
          && typeof Reflect.get(value, 'kind') === 'string'
          && (Reflect.get(value, 'mode') === 'simulated'
            || Reflect.get(value, 'mode') === 'live')
          && typeof Reflect.get(value, 'capabilities') === 'object'
          && typeof Reflect.get(value, 'startCheckout') === 'function'
          && typeof Reflect.get(value, 'openPortal') === 'function',
      );
    },
  });

export interface LocalPaymentProviderOptions {
  readonly origin?: string;
  readonly clock?: () => Date;
}

export const LocalPayments = Object.freeze({
  simulated(
    options: LocalPaymentProviderOptions = {},
  ): ApplicationPaymentProvider {
    const origin = options.origin ?? 'http://127.0.0.1:3000';
    const clock = options.clock ?? (() => new Date());
    return Object.freeze({
      provider: 'local',
      kind: 'local-simulated',
      mode: 'simulated',
      capabilities: {
        checkout: true,
        portal: true,
        subscriptionChanges: true,
        scheduledChanges: true,
        meteredUsage: true,
      },
      async startCheckout(
        input: PaymentCheckoutInput,
      ): Promise<PaymentCheckout> {
        const key = stableLocalPaymentId(
          input.principalScope,
          input.plan,
          input.idempotencyKey,
        );
        return {
          provider: 'local',
          providerCustomerId: `local_customer_${stableLocalPaymentId(input.principalScope)}`,
          providerCheckoutId: `local_checkout_${key}`,
          url: `${origin}/billing/simulated/checkout/${key}`,
          mode: 'simulated',
          expiresAt: new Date(clock().getTime() + 15 * 60_000).toISOString(),
        };
      },
      async openPortal(input: PaymentPortalInput): Promise<PaymentPortal> {
        return {
          provider: 'local',
          url: `${origin}/billing/simulated/portal/${stableLocalPaymentId(
            input.principalScope,
            input.idempotencyKey,
          )}`,
          mode: 'simulated',
        };
      },
      async previewSubscriptionChange(
        input: SubscriptionChangeInput,
      ): Promise<SubscriptionChangePreview> {
        const effectiveAt = input.timing === 'immediate'
          ? clock().toISOString()
          : new Date(clock().getTime() + 30 * 86_400_000).toISOString();
        return {
          provider: 'local',
          currency: 'usd',
          amountDueMicrounits: 0,
          totalMicrounits: 0,
          effectiveAt,
          lines: input.items.map((item) => ({
            description: `Simulated change to ${item.price}`,
            amountMicrounits: 0,
          })),
        };
      },
      async changeSubscription(
        input: SubscriptionChangeInput,
      ): Promise<SubscriptionChangeResult> {
        return {
          provider: 'local',
          providerSubscriptionId: input.providerSubscriptionId,
          state: input.timing === 'immediate' ? 'applied' : 'scheduled',
          effectiveAt: input.timing === 'immediate'
            ? clock().toISOString()
            : new Date(clock().getTime() + 30 * 86_400_000).toISOString(),
        };
      },
      async cancelSubscription(
        input: SubscriptionCancellationInput,
      ): Promise<SubscriptionCancellationResult> {
        return {
          provider: 'local',
          providerSubscriptionId: input.providerSubscriptionId,
          cancelled: true,
          effectiveAt: input.timing === 'immediate'
            ? clock().toISOString()
            : new Date(clock().getTime() + 30 * 86_400_000).toISOString(),
        };
      },
      async resumeSubscription(
        input: Omit<SubscriptionCancellationInput, 'timing'>,
      ): Promise<SubscriptionCancellationResult> {
        return {
          provider: 'local',
          providerSubscriptionId: input.providerSubscriptionId,
          cancelled: false,
          effectiveAt: clock().toISOString(),
        };
      },
      async reportUsage(
        input: BillingUsageReportInput,
      ): Promise<BillingUsageReport> {
        return {
          provider: 'local',
          providerEventId: `local_usage_${stableLocalPaymentId(
            input.principalScope,
            input.meter,
            input.idempotencyKey,
          )}`,
          idempotencyKey: input.idempotencyKey,
          acceptedAt: clock().toISOString(),
        };
      },
    });
  },
});

function installBilling(
  application: Pick<KubernetesApplicationBuilder, 'inject' | 'role'>,
) {
  const payments = application.inject(PaymentProvider.named('primary'));
  const subscriptions = promotedBillingModel(applicationSubscriptions);
  const customers = promotedBillingModel(applicationBillingCustomers);
  const paymentEvents = promotedBillingModel(applicationPaymentEvents);

  async function scopedBillingCustomer(
    principalScope: string,
    provider: string,
    required: true,
  ): Promise<NonNullable<Awaited<ReturnType<typeof customers.find>>[number]>['value']>;
  async function scopedBillingCustomer(
    principalScope: string,
    provider: string,
    required: false,
  ): Promise<NonNullable<Awaited<ReturnType<typeof customers.find>>[number]>['value'] | undefined>;
  async function scopedBillingCustomer(
    principalScope: string,
    provider: string,
    required: boolean,
  ) {
    const matches = await customers.find({
      where: { principalScope, provider },
      limit: 2,
    });
    if (matches.length > 1) {
      throw new Error(
        `Billing customer mapping for ${principalScope}/${provider} is ambiguous.`,
      );
    }
    const customer = matches[0]?.value;
    if (!customer && required) {
      throw new Error(
        `Billing customer mapping for ${principalScope}/${provider} does not exist.`,
      );
    }
    return customer;
  }

  async function scopedBillingSubscription(
    principalScope: string,
    provider: string,
  ) {
    const matches = await subscriptions.find({
      where: { principalScope, provider },
      limit: 2,
    });
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Billing subscription for ${principalScope}/${provider} does not exist.`
          : `Billing subscription for ${principalScope}/${provider} is ambiguous.`,
      );
    }
    const subscription = matches[0];
    if (!subscription) {
      throw new Error(
        `Billing subscription for ${principalScope}/${provider} disappeared during resolution.`,
      );
    }
    return subscription.value;
  }

  async function recordBillingCustomer(
    principalScope: string,
    provider: string,
    providerCustomerId: string,
  ): Promise<void> {
    const byProviderIdentity = await customers.get(providerCustomerId);
    if (byProviderIdentity) {
      if (
        byProviderIdentity.value.principalScope !== principalScope
        || byProviderIdentity.value.provider !== provider
      ) {
        throw new Error(
          `Provider customer ${provider}/${providerCustomerId} is already mapped to another principal scope.`,
        );
      }
      return;
    }
    const byScope = await scopedBillingCustomer(
      principalScope,
      provider,
      false,
    );
    if (byScope) {
      throw new Error(
        `Billing customer mapping for ${principalScope}/${provider} cannot change from ${byScope.providerCustomerId} to ${providerCustomerId} without an explicit migration.`,
      );
    }
    await customers.create({
      id: providerCustomerId,
      principalScope,
      provider,
      providerCustomerId,
    });
  }

  async function startCheckout(input: BillingCheckoutInput) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const customer = await scopedBillingCustomer(
      input.principalScope,
      provider.provider,
      false,
    );
    const checkout = await provider.startCheckout({
      ...input,
      ...(customer
        ? { providerCustomerId: customer.providerCustomerId }
        : {}),
    });
    if (checkout.providerCustomerId) {
      await recordBillingCustomer(
        input.principalScope,
        checkout.provider,
        checkout.providerCustomerId,
      );
    }
    return checkout;
  }

  async function openBillingPortal(input: BillingPortalInput) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const customer = await scopedBillingCustomer(
      input.principalScope,
      provider.provider,
      true,
    );
    return provider.openPortal({
      ...input,
      providerCustomerId: customer.providerCustomerId,
    });
  }

  async function previewSubscriptionChange(
    input: BillingSubscriptionChangeInput,
  ) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const subscription = await scopedBillingSubscription(
      input.principalScope,
      provider.provider,
    );
    return requireBillingProviderMethod(
      provider,
      'previewSubscriptionChange',
    )({
      principalScope: input.principalScope,
      providerSubscriptionId: subscription.providerSubscriptionId,
      items: [{ price: input.plan }],
      timing: input.timing,
      ...(input.proration ? { proration: input.proration } : {}),
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function changeSubscription(input: BillingSubscriptionChangeInput) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const subscription = await scopedBillingSubscription(
      input.principalScope,
      provider.provider,
    );
    return requireBillingProviderMethod(
      provider,
      'changeSubscription',
    )({
      principalScope: input.principalScope,
      providerSubscriptionId: subscription.providerSubscriptionId,
      items: [{ price: input.plan }],
      timing: input.timing,
      ...(input.proration ? { proration: input.proration } : {}),
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function cancelSubscription(
    input: BillingSubscriptionCancellationInput,
  ) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const subscription = await scopedBillingSubscription(
      input.principalScope,
      provider.provider,
    );
    return requireBillingProviderMethod(
      provider,
      'cancelSubscription',
    )({
      ...input,
      providerSubscriptionId: subscription.providerSubscriptionId,
    });
  }

  async function resumeSubscription(
    input: BillingSubscriptionResumeInput,
  ) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const subscription = await scopedBillingSubscription(
      input.principalScope,
      provider.provider,
    );
    return requireBillingProviderMethod(
      provider,
      'resumeSubscription',
    )({
      ...input,
      providerSubscriptionId: subscription.providerSubscriptionId,
    });
  }

  async function reportUsage(input: BillingMeteredUsageInput) {
    const provider = resolveApplicationProviderRuntimeImplementation(payments);
    const customer = await scopedBillingCustomer(
      input.principalScope,
      provider.provider,
      true,
    );
    return requireBillingProviderMethod(
      provider,
      'reportUsage',
    )({
      ...input,
      providerCustomerId: customer.providerCustomerId,
    });
  }

  async function verifyWebhook(input: PaymentWebhookInput) {
    return requireBillingProviderMethod(
      resolveApplicationProviderRuntimeImplementation(payments),
      'verifyWebhook',
    )(input);
  }

  const maintainedDependencies = <TCallable extends CallableFunction>(
    callable: TCallable,
    dependencies: readonly { readonly identifier: string; readonly value: unknown }[],
  ) => {
    bindApplicationProviderDependencies(callable, [payments]);
    bindApplicationCallableDependencies(callable, [
      { identifier: 'payments', value: payments },
      ...dependencies,
    ]);
  };
  maintainedDependencies(startCheckout, [
    { identifier: 'BillingCustomer.find', value: customers.find },
    { identifier: 'BillingCustomer.get', value: customers.get },
    { identifier: 'BillingCustomer.create', value: customers.create },
  ]);
  maintainedDependencies(openBillingPortal, [
    { identifier: 'BillingCustomer.find', value: customers.find },
  ]);
  for (const callable of [
    previewSubscriptionChange,
    changeSubscription,
    cancelSubscription,
    resumeSubscription,
  ]) {
    maintainedDependencies(callable, [
      { identifier: 'Subscription.find', value: subscriptions.find },
    ]);
  }
  maintainedDependencies(reportUsage, [
    { identifier: 'BillingCustomer.find', value: customers.find },
  ]);
  maintainedDependencies(
    verifyWebhook,
    [],
  );

  // Customer mappings are reachable only through the billing module's
  // authenticated server-side intent functions. The caller's route/tool
  // policy supplies the application decision; the raw model operation is not
  // independently public.
  customers.create.applicationPolicy();

  application
    .role('applik8s-provider-webhook')
    .can(paymentEvents.create.all());

  paymentEvents.on.create(
    {
      processor: { replicas: 1, concurrency: 8 },
      retry: {
        maxAttempts: 8,
        initialDelayMs: 250,
        maxDelayMs: 30_000,
      },
    },
    async function projectPaymentSubscription(created) {
      const event = paymentProviderEventPayload(created.value.payload);
      const providerCustomer = await customers.get(event.customerId);
      if (
        providerCustomer
        && (
          providerCustomer.value.principalScope !== event.principalScope
          || providerCustomer.value.provider !== event.provider
        )
      ) {
        throw new Error(
          `Provider customer ${event.provider}/${event.customerId} is already mapped to another principal scope.`,
        );
      }
      const scopedCustomers = await customers.find({
        where: {
          principalScope: event.principalScope,
          provider: event.provider,
        },
        limit: 2,
      });
      if (scopedCustomers.length > 1) {
        throw new Error(
          `Billing customer mapping for ${event.principalScope}/${event.provider} is ambiguous.`,
        );
      }
      const scopedCustomer = scopedCustomers[0]?.value;
      if (
        scopedCustomer
        && scopedCustomer.providerCustomerId !== event.customerId
      ) {
        throw new Error(
          `Billing customer mapping for ${event.principalScope}/${event.provider} cannot change from ${scopedCustomer.providerCustomerId} to ${event.customerId} without an explicit migration.`,
        );
      }
      if (!providerCustomer && !scopedCustomer) {
        await customers.create({
          id: event.customerId,
          principalScope: event.principalScope,
          provider: event.provider,
          providerCustomerId: event.customerId,
        });
      }
      const current = await subscriptions.get(event.subscriptionId);
      if (
        current
        && Date.parse(current.value.providerOccurredAt)
          >= Date.parse(event.occurredAt)
      ) {
        return;
      }
      const status: 'active' | 'cancelled' | 'past_due' =
        event.status === 'pastDue'
        ? 'past_due'
        : event.status === 'cancelled'
          ? 'cancelled'
          : 'active';
      if (!current) {
        await subscriptions.create({
          id: event.subscriptionId,
          principalScope: event.principalScope,
          planId: event.plan,
          provider: event.provider,
          providerCustomerId: event.customerId,
          providerSubscriptionId: event.subscriptionId,
          status,
          cancelAtPeriodEnd: false,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          providerOccurredAt: event.occurredAt,
        });
        return;
      }
      await subscriptions.edit(event.subscriptionId, subscription => {
        return subscription.update({
          principalScope: event.principalScope,
          planId: event.plan,
          provider: event.provider,
          providerCustomerId: event.customerId,
          providerSubscriptionId: event.subscriptionId,
          status,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          providerOccurredAt: event.occurredAt,
        });
      });
    },
  );

  return {
    BillingPlan: promotedBillingModel(applicationBillingPlans),
    BillingCatalogVersion:
      promotedBillingModel(applicationBillingCatalogVersions),
    BillingCatalogPrice:
      promotedBillingModel(applicationBillingCatalogPrices),
    BillingCatalogEntitlement:
      promotedBillingModel(applicationBillingCatalogEntitlements),
    BillingMeter: promotedBillingModel(applicationBillingMeters),
    BillingCustomer: customers,
    Subscription: subscriptions,
    BillingSubscriptionItem:
      promotedBillingModel(applicationBillingSubscriptionItems),
    BillingUsageLedgerEntry:
      promotedBillingModel(applicationBillingUsageLedger),
    PaymentEvent: paymentEvents,
    startCheckout,
    openBillingPortal,
    previewSubscriptionChange,
    changeSubscription,
    cancelSubscription,
    resumeSubscription,
    reportUsage,
    verifyWebhook,
    payments,
  };
}

function promotedBillingModel<TTable extends AnyPgTable>(
  table: TTable,
): ApplicationRelationalModel<TTable> {
  // app.include() promotes this exact declared Drizzle value before setup.
  // typecast: retain the model operations and lifecycle facet on that value.
  return table as ApplicationRelationalModel<TTable>;
}

function paymentProviderEventPayload(value: unknown): PaymentProviderEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Payment event payload must be an object.');
  }
  const required = (
    field:
      | 'provider'
      | 'id'
      | 'customerId'
      | 'subscriptionId'
      | 'principalScope'
      | 'plan'
      | 'status'
      | 'occurredAt'
      | 'periodStart'
      | 'periodEnd'
      | 'rawType',
  ): string => {
    const candidate = Reflect.get(value, field);
    if (typeof candidate !== 'string' || !candidate) {
      throw new Error(`Payment event payload ${field} must be a non-empty string.`);
    }
    return candidate;
  };
  const status = required('status');
  if (status !== 'active' && status !== 'pastDue' && status !== 'cancelled') {
    throw new Error(`Payment event payload status ${JSON.stringify(status)} is unsupported.`);
  }
  return {
    provider: required('provider'),
    id: required('id'),
    customerId: required('customerId'),
    subscriptionId: required('subscriptionId'),
    principalScope: required('principalScope'),
    plan: required('plan'),
    status,
    occurredAt: required('occurredAt'),
    periodStart: required('periodStart'),
    periodEnd: required('periodEnd'),
    rawType: required('rawType'),
  };
}

export const billing = module(
  'billing',
  { schema: applicationBillingSchema },
  installBilling,
);

export interface SubscriptionProjectionState {
  readonly providerEventId: string;
  readonly providerOccurredAt: string;
  readonly principalScope: string;
  readonly plan: string;
  readonly status: PaymentProviderEvent['status'];
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * Deterministic idempotency/out-of-order reducer used by payment-event
 * processors before updating canonical subscription and entitlement state.
 */
export function projectSubscriptionEvent(
  current: SubscriptionProjectionState | undefined,
  event: PaymentProviderEvent,
): SubscriptionProjectionState {
  if (
    current
    && (
      current.providerEventId === event.id
      || Date.parse(current.providerOccurredAt) > Date.parse(event.occurredAt)
    )
  ) {
    return current;
  }
  return Object.freeze({
    providerEventId: event.id,
    providerOccurredAt: event.occurredAt,
    principalScope: event.principalScope,
    plan: event.plan,
    status: event.status,
    periodStart: event.periodStart,
    periodEnd: event.periodEnd,
  });
}

function stableLocalPaymentId(...parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of parts.join('\0')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type BillingProviderMethodName =
  | 'previewSubscriptionChange'
  | 'changeSubscription'
  | 'cancelSubscription'
  | 'resumeSubscription'
  | 'reportUsage'
  | 'verifyWebhook';

function requireBillingProviderMethod<
  TMethod extends BillingProviderMethodName,
>(
  provider: ApplicationPaymentProvider,
  method: TMethod,
): NonNullable<ApplicationPaymentProvider[TMethod]> {
  const implementation = provider[method];
  if (typeof implementation !== 'function') {
    throw new Error(
      `Billing provider ${provider.kind} does not support ${method}.`,
    );
  }
  // The runtime check preserves the method selected by the generic key.
  // typecast: bind() erases only the already-validated provider receiver.
  return implementation.bind(provider) as NonNullable<
    ApplicationPaymentProvider[TMethod]
  >;
}
