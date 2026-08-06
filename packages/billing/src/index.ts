import type {
  ApplicationRelationalModel,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  module,
  defineApplicationProvider,
} from '@applik8s/applik8s';
import { resolveApplicationProviderRuntimeImplementation } from '@applik8s/applik8s/internal/provider-runtime';
import {
  applicationBillingPlans,
  applicationBillingSchema,
  applicationPaymentEvents,
  applicationSubscriptions,
} from './schema.js';

export * from './schema.js';

export type PaymentMode = 'simulated' | 'live';

export interface PaymentCheckoutInput {
  readonly principalScope: string;
  readonly plan: string;
  readonly returnTo: string;
  readonly idempotencyKey: string;
}

export interface PaymentCheckout {
  readonly provider: string;
  readonly providerCustomerId: string;
  readonly providerCheckoutId: string;
  readonly url: string;
  readonly mode: PaymentMode;
  readonly expiresAt?: string;
}

export interface PaymentPortalInput {
  readonly principalScope: string;
  readonly returnTo: string;
  readonly idempotencyKey: string;
}

export interface PaymentPortal {
  readonly provider: string;
  readonly url: string;
  readonly mode: PaymentMode;
}

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
  readonly kind: string;
  readonly mode: PaymentMode;
  startCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckout>;
  openPortal(input: PaymentPortalInput): Promise<PaymentPortal>;
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
          && typeof Reflect.get(value, 'kind') === 'string'
          && (Reflect.get(value, 'mode') === 'simulated'
            || Reflect.get(value, 'mode') === 'live')
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
      kind: 'local-simulated',
      mode: 'simulated',
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
    });
  },
});

function installBilling(
  application: Pick<KubernetesApplicationBuilder, 'inject'>,
) {
  const payments = application.inject(PaymentProvider.named('primary'));

  async function startCheckout(input: PaymentCheckoutInput) {
    return resolveApplicationProviderRuntimeImplementation(
      payments,
    ).startCheckout(input);
  }

  async function openBillingPortal(input: PaymentPortalInput) {
    return resolveApplicationProviderRuntimeImplementation(
      payments,
    ).openPortal(input);
  }

  return {
    // app.include() registers this schema before installation.
    // typecast: preserve the promoted model facets on the same Drizzle values.
    BillingPlan: applicationBillingPlans as ApplicationRelationalModel<
      typeof applicationBillingPlans
    >,
    // typecast: module installation retains the promoted table identity.
    Subscription: applicationSubscriptions as ApplicationRelationalModel<
      typeof applicationSubscriptions
    >,
    // typecast: module installation retains the promoted table identity.
    PaymentEvent: applicationPaymentEvents as ApplicationRelationalModel<
      typeof applicationPaymentEvents
    >,
    startCheckout,
    openBillingPortal,
    payments,
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
