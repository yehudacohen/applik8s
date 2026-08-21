// runtime-integrity: external-protocol-crypto=stripe-signature-v1
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ApplicationPaymentProvider,
  BillingUsageReport,
  BillingUsageReportInput,
  PaymentCheckout,
  PaymentCheckoutInput,
  PaymentPortal,
  PaymentPortalInput,
  PaymentProviderEvent,
  PaymentWebhookInput,
  SubscriptionCancellationInput,
  SubscriptionCancellationResult,
  SubscriptionChangeInput,
  SubscriptionChangePreview,
  SubscriptionChangeResult,
} from '@applik8s/billing';

export interface PaymentSecretReference {
  readonly name: string;
  readonly key?: string;
  readonly namespace?: string;
}

export interface StripePaymentSecrets {
  readonly apiKey: PaymentSecretReference;
  readonly webhookSecret: PaymentSecretReference;
}

export interface StripePaymentsOptions {
  readonly secrets: StripePaymentSecrets;
  resolveSecret(reference: PaymentSecretReference): Promise<string>;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly clock?: () => Date;
  readonly webhookToleranceSeconds?: number;
}

interface StripeCheckoutResponse {
  readonly id: string;
  readonly url: string;
  readonly customer: string | null;
  readonly expires_at?: number;
}

interface StripePriceListResponse {
  readonly data?: readonly {
    readonly id?: string;
  }[];
}

interface StripePortalResponse {
  readonly id: string;
  readonly url: string;
}

interface StripeSubscriptionResponse {
  readonly id: string;
  readonly cancel_at_period_end?: boolean;
  readonly current_period_end?: number;
}

interface StripeInvoicePreviewResponse {
  readonly currency: string;
  readonly amount_due?: number;
  readonly total?: number;
  readonly lines?: {
    readonly data?: readonly {
      readonly description?: string;
      readonly amount?: number;
      readonly proration?: boolean;
    }[];
  };
}

interface StripeMeterEventResponse {
  readonly identifier?: string;
  readonly created?: number;
}

export class StripeWebhookAuthenticationError extends Error {
  readonly code = 'APPLIK8S_WEBHOOK_AUTHENTICATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookAuthenticationError';
  }
}

export class StripeWebhookPayloadError extends Error {
  readonly code = 'APPLIK8S_WEBHOOK_PAYLOAD_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookPayloadError';
  }
}

export class StripeWebhookUnsupportedEventError extends Error {
  readonly code = 'APPLIK8S_WEBHOOK_EVENT_UNSUPPORTED';

  constructor(readonly eventType: string) {
    super(`Stripe webhook event ${eventType} is not consumed by billing.`);
    this.name = 'StripeWebhookUnsupportedEventError';
  }
}

export const StripePayments = Object.freeze({
  fromSecret(options: StripePaymentsOptions): ApplicationPaymentProvider {
    const endpoint = options.endpoint ?? 'https://api.stripe.com/v1';
    const request = options.fetch ?? fetch;
    const clock = options.clock ?? (() => new Date());
    const tolerance = options.webhookToleranceSeconds ?? 300;
    return Object.freeze({
      provider: 'stripe',
      kind: 'stripe',
      mode: 'live',
      capabilities: {
        checkout: true,
        portal: true,
        subscriptionChanges: true,
        scheduledChanges: false,
        meteredUsage: true,
      },
      async startCheckout(
        input: PaymentCheckoutInput,
      ): Promise<PaymentCheckout> {
        const apiKey = await options.resolveSecret(options.secrets.apiKey);
        const price = await stripePriceReference(
          request,
          endpoint,
          apiKey,
          input.plan,
        );
        const response = await stripeForm<StripeCheckoutResponse>(
          request,
          endpoint,
          '/checkout/sessions',
          apiKey,
          input.idempotencyKey,
          {
            mode: 'subscription',
            success_url: absoluteReturnUrl(input.returnTo, 'success'),
            cancel_url: absoluteReturnUrl(input.returnTo, 'cancelled'),
            client_reference_id: input.principalScope,
            'metadata[principalScope]': input.principalScope,
            'metadata[plan]': input.plan,
            'subscription_data[metadata][principalScope]':
              input.principalScope,
            'subscription_data[metadata][plan]': input.plan,
            ...(input.providerCustomerId
              ? { customer: input.providerCustomerId }
              : {}),
            'line_items[0][price]': price,
            'line_items[0][quantity]': '1',
          },
        );
        return {
          provider: 'stripe',
          ...(response.customer
            ? { providerCustomerId: response.customer }
            : {}),
          providerCheckoutId: response.id,
          url: response.url,
          mode: 'live',
          ...(response.expires_at
            ? { expiresAt: new Date(response.expires_at * 1000).toISOString() }
            : {}),
        };
      },
      async openPortal(input: PaymentPortalInput): Promise<PaymentPortal> {
        const response = await stripeForm<StripePortalResponse>(
          request,
          endpoint,
          '/billing_portal/sessions',
          await options.resolveSecret(options.secrets.apiKey),
          input.idempotencyKey,
          {
            customer: input.providerCustomerId,
            return_url: input.returnTo,
          },
        );
        return {
          provider: 'stripe',
          url: response.url,
          mode: 'live',
        };
      },
      async previewSubscriptionChange(
        input: SubscriptionChangeInput,
      ): Promise<SubscriptionChangePreview> {
        if (input.timing !== 'immediate') {
          throw new Error(
            'Stripe period-end plan changes require a subscription-schedule adapter.',
          );
        }
        const effectiveAt = clock().toISOString();
        const apiKey = await options.resolveSecret(options.secrets.apiKey);
        const items = await stripeSubscriptionItems(
          request,
          endpoint,
          apiKey,
          input.items,
          'subscription_details[items]',
        );
        const response = await stripeForm<StripeInvoicePreviewResponse>(
          request,
          endpoint,
          '/invoices/create_preview',
          apiKey,
          input.idempotencyKey,
          {
            subscription: input.providerSubscriptionId,
            'subscription_details[proration_behavior]':
              stripeProration(input.proration),
            ...items,
          },
        );
        return {
          provider: 'stripe',
          currency: response.currency,
          amountDueMicrounits: minorToMicrounits(response.amount_due ?? 0),
          totalMicrounits: minorToMicrounits(response.total ?? 0),
          effectiveAt,
          lines: (response.lines?.data ?? [])
            .filter((line) => line.proration !== false)
            .slice(0, 20)
            .map((line) => ({
              description: line.description ?? 'Subscription change',
              amountMicrounits: minorToMicrounits(line.amount ?? 0),
            })),
        };
      },
      async changeSubscription(
        input: SubscriptionChangeInput,
      ): Promise<SubscriptionChangeResult> {
        if (input.timing !== 'immediate') {
          throw new Error(
            'Stripe period-end plan changes require a subscription-schedule adapter.',
          );
        }
        const apiKey = await options.resolveSecret(options.secrets.apiKey);
        const items = await stripeSubscriptionItems(
          request,
          endpoint,
          apiKey,
          input.items,
          'items',
        );
        const response = await stripeForm<StripeSubscriptionResponse>(
          request,
          endpoint,
          `/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`,
          apiKey,
          input.idempotencyKey,
          {
            proration_behavior: stripeProration(input.proration),
            payment_behavior: 'pending_if_incomplete',
            'metadata[applik8sChangeId]': input.idempotencyKey,
            ...(input.items.length === 1
              ? { 'metadata[plan]': input.items[0]?.price ?? '' }
              : {}),
            ...items,
          },
        );
        return {
          provider: 'stripe',
          providerSubscriptionId: response.id,
          state: 'applied',
          effectiveAt: clock().toISOString(),
        };
      },
      async cancelSubscription(
        input: SubscriptionCancellationInput,
      ): Promise<SubscriptionCancellationResult> {
        const apiKey = await options.resolveSecret(options.secrets.apiKey);
        const response = input.timing === 'immediate'
          ? await stripeDelete<StripeSubscriptionResponse>(
              request,
              endpoint,
              `/subscriptions/${encodeURIComponent(
                input.providerSubscriptionId,
              )}`,
              apiKey,
              input.idempotencyKey,
            )
          : await stripeForm<StripeSubscriptionResponse>(
              request,
              endpoint,
              `/subscriptions/${encodeURIComponent(
                input.providerSubscriptionId,
              )}`,
              apiKey,
              input.idempotencyKey,
              {
                cancel_at_period_end: 'true',
                'metadata[applik8sCancellationId]': input.idempotencyKey,
              },
            );
        return {
          provider: 'stripe',
          providerSubscriptionId: response.id,
          cancelled: true,
          effectiveAt: response.current_period_end
            ? new Date(response.current_period_end * 1000).toISOString()
            : clock().toISOString(),
        };
      },
      async resumeSubscription(
        input: Omit<SubscriptionCancellationInput, 'timing'>,
      ): Promise<SubscriptionCancellationResult> {
        const response = await stripeForm<StripeSubscriptionResponse>(
          request,
          endpoint,
          `/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`,
          await options.resolveSecret(options.secrets.apiKey),
          input.idempotencyKey,
          {
            cancel_at_period_end: 'false',
            'metadata[applik8sCancellationId]': input.idempotencyKey,
          },
        );
        return {
          provider: 'stripe',
          providerSubscriptionId: response.id,
          cancelled: false,
          effectiveAt: clock().toISOString(),
        };
      },
      async reportUsage(
        input: BillingUsageReportInput,
      ): Promise<BillingUsageReport> {
        const response = await stripeForm<StripeMeterEventResponse>(
          request,
          endpoint,
          '/billing/meter_events',
          await options.resolveSecret(options.secrets.apiKey),
          input.idempotencyKey,
          {
            event_name: input.meter,
            identifier: input.idempotencyKey,
            timestamp: String(
              Math.floor(Date.parse(input.occurredAt) / 1000),
            ),
            'payload[stripe_customer_id]': input.providerCustomerId,
            'payload[value]': String(input.quantity),
          },
        );
        return {
          provider: 'stripe',
          providerEventId: response.identifier ?? input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          acceptedAt: response.created
            ? new Date(response.created * 1000).toISOString()
            : clock().toISOString(),
        };
      },
      async verifyWebhook(
        input: PaymentWebhookInput,
      ): Promise<PaymentProviderEvent> {
        const secret = await options.resolveSecret(
          options.secrets.webhookSecret,
        );
        assertStripeSignature(
          input.body,
          stripeSignatureHeader(input.headers),
          secret,
          clock(),
          tolerance,
        );
        let decoded: unknown;
        try {
          decoded = JSON.parse(new TextDecoder().decode(input.body));
        } catch {
          throw new StripeWebhookPayloadError(
            'Stripe webhook body must contain valid JSON.',
          );
        }
        return stripeEvent(decoded);
      },
    });
  },
});

export function assertStripeSignature(
  body: Uint8Array,
  signatureHeader: string,
  secret: string,
  now: Date,
  toleranceSeconds = 300,
): void {
  const entries = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.trim().split('=', 2);
      return [key, value];
    }),
  );
  const timestamp = Number(entries.t);
  const signature = entries.v1;
  if (!Number.isSafeInteger(timestamp) || !signature) {
    throw new StripeWebhookAuthenticationError(
      'Stripe webhook signature is malformed.',
    );
  }
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceSeconds) {
    throw new StripeWebhookAuthenticationError(
      'Stripe webhook signature is outside the accepted timestamp window.',
    );
  }
  const signed = new TextEncoder().encode(
    `${timestamp}.${new TextDecoder().decode(body)}`,
  );
  const expected = createHmac('sha256', secret).update(signed).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    throw new StripeWebhookAuthenticationError(
      'Stripe webhook signature is not hexadecimal.',
    );
  }
  if (
    expected.byteLength !== actual.byteLength
    || !timingSafeEqual(expected, actual)
  ) {
    throw new StripeWebhookAuthenticationError(
      'Stripe webhook signature is invalid.',
    );
  }
}

async function stripeForm<T>(
  request: typeof fetch,
  endpoint: string,
  path: string,
  apiKey: string,
  idempotencyKey: string,
  values: Readonly<Record<string, string>>,
): Promise<T> {
  const response = await request(stripeApiUrl(endpoint, path), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey,
    },
    body: new URLSearchParams(values),
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed with HTTP ${response.status}.`);
  }
  // Stripe endpoint-specific decoders own T; this bounded server-only adapter
  // restores that reviewed response shape after HTTP success.
  // typecast: endpoint-specific generic response shape after successful HTTP validation.
  return await response.json() as T;
}

async function stripeDelete<T>(
  request: typeof fetch,
  endpoint: string,
  path: string,
  apiKey: string,
  idempotencyKey: string,
): Promise<T> {
  const response = await request(stripeApiUrl(endpoint, path), {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': idempotencyKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed with HTTP ${response.status}.`);
  }
  // typecast: endpoint-specific response shape after HTTP success.
  return await response.json() as T;
}

async function stripeGet<T>(
  request: typeof fetch,
  endpoint: string,
  path: string,
  apiKey: string,
  search: Readonly<Record<string, string>>,
): Promise<T> {
  const url = stripeApiUrl(endpoint, path);
  for (const [key, value] of Object.entries(search)) {
    url.searchParams.append(key, value);
  }
  const response = await request(url, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed with HTTP ${response.status}.`);
  }
  // typecast: endpoint-specific response shape after HTTP success.
  return await response.json() as T;
}

async function stripePriceReference(
  request: typeof fetch,
  endpoint: string,
  apiKey: string,
  logicalPrice: string,
): Promise<string> {
  if (logicalPrice.startsWith('price_')) return logicalPrice;
  const response = await stripeGet<StripePriceListResponse>(
    request,
    endpoint,
    '/prices',
    apiKey,
    {
      'lookup_keys[]': logicalPrice,
      active: 'true',
      limit: '1',
    },
  );
  const price = response.data?.[0]?.id;
  if (!price) {
    throw new Error(
      `Stripe has no active Price with lookup key ${logicalPrice}.`,
    );
  }
  return price;
}

async function stripeSubscriptionItems(
  request: typeof fetch,
  endpoint: string,
  apiKey: string,
  items: SubscriptionChangeInput['items'],
  prefix: 'items' | 'subscription_details[items]',
): Promise<Readonly<Record<string, string>>> {
  const resolved = await Promise.all(items.map(async (item) => ({
    ...item,
    price: await stripePriceReference(
      request,
      endpoint,
      apiKey,
      item.price,
    ),
  })));
  return Object.fromEntries(resolved.flatMap((item, index) => [
    ...(item.subscriptionItemId
      ? [[`${prefix}[${index}][id]`, item.subscriptionItemId]]
      : []),
    [`${prefix}[${index}][price]`, item.price],
    [`${prefix}[${index}][quantity]`, String(item.quantity ?? 1)],
  ]));
}

function stripeProration(
  value: SubscriptionChangeInput['proration'],
): string {
  if (value === 'alwaysInvoice') return 'always_invoice';
  if (value === 'none') return 'none';
  return 'create_prorations';
}

function minorToMicrounits(value: number): number {
  return value * 10_000;
}

function absoluteReturnUrl(returnTo: string, outcome: string): string {
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    throw new Error('Billing return URL must be an absolute HTTP(S) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Billing return URL must be an absolute HTTP(S) URL.');
  }
  url.searchParams.set('billing', outcome);
  return url.href;
}

function stripeApiUrl(endpoint: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    throw new Error('Stripe API endpoint must be an absolute HTTP(S) URL.');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('Stripe API endpoint must be an absolute HTTP(S) URL.');
  }
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;
  base.search = '';
  base.hash = '';
  return base;
}

function stripeSignatureHeader(
  headers: Readonly<Record<string, string>>,
): string {
  const value = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'stripe-signature',
  )?.[1];
  if (!value) {
    throw new StripeWebhookAuthenticationError(
      'Missing stripe-signature header.',
    );
  }
  return value;
}

function stripeEvent(value: unknown): PaymentProviderEvent {
  if (!value || typeof value !== 'object') {
    throw new StripeWebhookPayloadError(
      'Stripe webhook payload must be an object.',
    );
  }
  const id = requiredString(value, 'id');
  const type = requiredString(value, 'type');
  if (
    type !== 'customer.subscription.created'
    && type !== 'customer.subscription.updated'
    && type !== 'customer.subscription.deleted'
  ) {
    throw new StripeWebhookUnsupportedEventError(type);
  }
  const created = requiredNumber(value, 'created');
  const data = Reflect.get(value, 'data');
  const object = data && typeof data === 'object'
    ? Reflect.get(data, 'object')
    : undefined;
  if (!object || typeof object !== 'object') {
    throw new StripeWebhookPayloadError(
      'Stripe webhook data.object is required.',
    );
  }
  const metadata = Reflect.get(object, 'metadata');
  const currentPeriodStart = Reflect.get(object, 'current_period_start');
  const currentPeriodEnd = Reflect.get(object, 'current_period_end');
  return {
    provider: 'stripe',
    id,
    customerId: requiredString(object, 'customer'),
    subscriptionId: requiredString(object, 'id'),
    principalScope: requiredString(metadata, 'principalScope'),
    plan: requiredString(metadata, 'plan'),
    status: stripeSubscriptionStatus(requiredString(object, 'status')),
    occurredAt: new Date(created * 1000).toISOString(),
    periodStart: new Date(requiredUnixSeconds(currentPeriodStart) * 1000).toISOString(),
    periodEnd: new Date(requiredUnixSeconds(currentPeriodEnd) * 1000).toISOString(),
    rawType: type,
  };
}

function stripeSubscriptionStatus(
  status: string,
): PaymentProviderEvent['status'] {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'pastDue';
  return 'cancelled';
}

function requiredString(value: unknown, key: string): string {
  const field = value && typeof value === 'object'
    ? Reflect.get(value, key)
    : undefined;
  if (typeof field !== 'string' || field.length === 0) {
    throw new StripeWebhookPayloadError(
      `Stripe webhook ${key} must be a non-empty string.`,
    );
  }
  return field;
}

function requiredNumber(value: unknown, key: string): number {
  const field = value && typeof value === 'object'
    ? Reflect.get(value, key)
    : undefined;
  if (typeof field !== 'number' || !Number.isSafeInteger(field)) {
    throw new StripeWebhookPayloadError(
      `Stripe webhook ${key} must be an integer.`,
    );
  }
  return field;
}

function requiredUnixSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new StripeWebhookPayloadError(
      'Stripe subscription period must be an integer timestamp.',
    );
  }
  return value;
}
