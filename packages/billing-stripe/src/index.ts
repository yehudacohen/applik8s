import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ApplicationPaymentProvider,
  PaymentCheckout,
  PaymentCheckoutInput,
  PaymentPortal,
  PaymentPortalInput,
  PaymentProviderEvent,
  PaymentWebhookInput,
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
  readonly customer: string;
  readonly expires_at?: number;
}

interface StripePortalResponse {
  readonly id: string;
  readonly url: string;
}

export const StripePayments = Object.freeze({
  fromSecret(options: StripePaymentsOptions): ApplicationPaymentProvider {
    const endpoint = options.endpoint ?? 'https://api.stripe.com/v1';
    const request = options.fetch ?? fetch;
    const clock = options.clock ?? (() => new Date());
    const tolerance = options.webhookToleranceSeconds ?? 300;
    return Object.freeze({
      kind: 'stripe',
      mode: 'live',
      async startCheckout(
        input: PaymentCheckoutInput,
      ): Promise<PaymentCheckout> {
        const response = await stripeForm<StripeCheckoutResponse>(
          request,
          endpoint,
          '/checkout/sessions',
          await options.resolveSecret(options.secrets.apiKey),
          input.idempotencyKey,
          {
            mode: 'subscription',
            success_url: absoluteReturnUrl(input.returnTo, 'success'),
            cancel_url: absoluteReturnUrl(input.returnTo, 'cancelled'),
            client_reference_id: input.principalScope,
            'metadata[principalScope]': input.principalScope,
            'metadata[plan]': input.plan,
            'line_items[0][price]': input.plan,
            'line_items[0][quantity]': '1',
          },
        );
        return {
          provider: 'stripe',
          providerCustomerId: response.customer,
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
            customer: input.principalScope,
            return_url: input.returnTo,
          },
        );
        return {
          provider: 'stripe',
          url: response.url,
          mode: 'live',
        };
      },
      async verifyWebhook(
        input: PaymentWebhookInput,
      ): Promise<PaymentProviderEvent> {
        const secret = await options.resolveSecret(
          options.secrets.webhookSecret,
        );
        const signature = header(input.headers, 'stripe-signature');
        assertStripeSignature(
          input.body,
          signature,
          secret,
          clock(),
          tolerance,
        );
        return stripeEvent(JSON.parse(new TextDecoder().decode(input.body)));
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
    throw new Error('Stripe webhook signature is malformed.');
  }
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceSeconds) {
    throw new Error('Stripe webhook signature is outside the accepted timestamp window.');
  }
  const signed = new TextEncoder().encode(
    `${timestamp}.${new TextDecoder().decode(body)}`,
  );
  const expected = createHmac('sha256', secret).update(signed).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    throw new Error('Stripe webhook signature is not hexadecimal.');
  }
  if (
    expected.byteLength !== actual.byteLength
    || !timingSafeEqual(expected, actual)
  ) {
    throw new Error('Stripe webhook signature is invalid.');
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
  const response = await request(new URL(path, endpoint), {
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

function absoluteReturnUrl(returnTo: string, outcome: string): string {
  const url = new URL(returnTo);
  url.searchParams.set('billing', outcome);
  return url.href;
}

function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];
  if (!value) throw new Error(`Missing ${name} header.`);
  return value;
}

function stripeEvent(value: unknown): PaymentProviderEvent {
  if (!value || typeof value !== 'object') {
    throw new Error('Stripe webhook payload must be an object.');
  }
  const id = requiredString(value, 'id');
  const type = requiredString(value, 'type');
  const created = requiredNumber(value, 'created');
  const data = Reflect.get(value, 'data');
  const object = data && typeof data === 'object'
    ? Reflect.get(data, 'object')
    : undefined;
  if (!object || typeof object !== 'object') {
    throw new Error('Stripe webhook data.object is required.');
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
    throw new Error(`Stripe webhook ${key} must be a non-empty string.`);
  }
  return field;
}

function requiredNumber(value: unknown, key: string): number {
  const field = value && typeof value === 'object'
    ? Reflect.get(value, key)
    : undefined;
  if (typeof field !== 'number' || !Number.isSafeInteger(field)) {
    throw new Error(`Stripe webhook ${key} must be an integer.`);
  }
  return field;
}

function requiredUnixSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Stripe subscription period must be an integer timestamp.');
  }
  return value;
}
