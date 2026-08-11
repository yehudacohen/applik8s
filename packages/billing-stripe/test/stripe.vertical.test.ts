import { createHmac } from 'node:crypto';
import {
  StripePayments,
  StripeWebhookAuthenticationError,
  StripeWebhookPayloadError,
  StripeWebhookUnsupportedEventError,
} from '@applik8s/billing-stripe';
import { describe, expect, it } from 'vitest';

describe('Stripe payment adapter', () => {
  it('authenticates raw webhook bytes and derives provider-neutral events', async () => {
    const body = new TextEncoder().encode(JSON.stringify({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      created: 1_767_225_600,
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          current_period_start: 1_767_225_600,
          current_period_end: 1_769_904_000,
          metadata: {
            principalScope: 'workspace:one',
            plan: 'price_pro',
          },
        },
      },
    }));
    const timestamp = 1_767_225_600;
    const signature = createHmac('sha256', 'webhook-secret')
      .update(`${timestamp}.${new TextDecoder().decode(body)}`)
      .digest('hex');
    const provider = StripePayments.fromSecret({
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret(reference) {
        return reference.key === 'apiKey' ? 'sk_test' : 'webhook-secret';
      },
      clock: () => new Date(timestamp * 1000),
    });
    await expect(provider.verifyWebhook?.({
      body,
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    })).resolves.toMatchObject({
      provider: 'stripe',
      id: 'evt_1',
      principalScope: 'workspace:one',
      plan: 'price_pro',
      status: 'active',
    });
    await expect(provider.verifyWebhook?.({
      body,
      headers: { 'stripe-signature': `t=${timestamp},v1=${'0'.repeat(64)}` },
    })).rejects.toThrow('signature is invalid');
  });

  it('passes idempotency and secret-derived credentials only on the server request', async () => {
    let requestInit: RequestInit | undefined;
    const request: typeof fetch = Object.assign(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        requestInit = init;
        return new Response(JSON.stringify({
            id: 'cs_1',
            url: 'https://checkout.stripe.test/cs_1',
            customer: 'cus_1',
          }), { status: 200 });
      },
      {
        preconnect(_url: string | URL) {
          // Test transport has no socket pool to warm.
        },
      },
    );
    const provider = StripePayments.fromSecret({
      endpoint: 'https://api.stripe.test/v1',
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret() {
        return 'server-secret';
      },
      fetch: request,
    });
    await provider.startCheckout({
      principalScope: 'workspace:one',
      plan: 'price_pro',
      returnTo: 'https://app.example.test/billing',
      idempotencyKey: 'checkout-1',
    });
    expect(requestInit?.headers).toMatchObject({
      authorization: 'Bearer server-secret',
      'idempotency-key': 'checkout-1',
    });
    expect(String(requestInit?.body)).toContain(
      'subscription_data%5Bmetadata%5D%5BprincipalScope%5D=workspace%3Aone',
    );
  });

  it('resolves logical catalog prices and reports metered usage without changing application contracts', async () => {
    const requests: string[] = [];
    const bodies = new Map<string, string>();
    const request: typeof fetch = Object.assign(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input);
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (init?.body) bodies.set(url, String(init.body));
        if (url.includes('/prices?')) {
          return Response.json({ data: [{ id: 'price_resolved' }] });
        }
        if (url.endsWith('/checkout/sessions')) {
          expect(String(init?.body)).toContain('price_resolved');
          return Response.json({
            id: 'cs_2',
            url: 'https://checkout.stripe.test/cs_2',
            customer: 'cus_2',
          });
        }
        if (url.endsWith('/billing/meter_events')) {
          return Response.json({
            identifier: 'usage-1',
            created: 1_767_225_600,
          });
        }
        if (url.endsWith('/billing_portal/sessions')) {
          return Response.json({
            id: 'bps_1',
            url: 'https://billing.stripe.test/session',
          });
        }
        if (url.endsWith('/subscriptions/sub_2')) {
          return Response.json({
            id: 'sub_2',
            current_period_end: 1_769_904_000,
          });
        }
        return new Response(null, { status: 404 });
      },
      {
        preconnect(_url: string | URL) {
          // Test transport has no socket pool to warm.
        },
      },
    );
    const provider = StripePayments.fromSecret({
      endpoint: 'https://api.stripe.test/v1',
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret() {
        return 'server-secret';
      },
      fetch: request,
    });
    await provider.startCheckout({
      principalScope: 'workspace:one',
      plan: 'team_monthly',
      returnTo: 'https://app.example.test/billing',
      idempotencyKey: 'checkout-2',
    });
    await provider.openPortal({
      principalScope: 'workspace:one',
      providerCustomerId: 'cus_2',
      returnTo: 'https://app.example.test/billing',
      idempotencyKey: 'portal-2',
    });
    await provider.changeSubscription?.({
      principalScope: 'workspace:one',
      providerSubscriptionId: 'sub_2',
      items: [{ price: 'team_monthly' }],
      timing: 'immediate',
      idempotencyKey: 'change-2',
    });
    await expect(provider.reportUsage?.({
      principalScope: 'workspace:one',
      providerCustomerId: 'cus_2',
      meter: 'ai_tokens',
      quantity: 125,
      occurredAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'usage-1',
    })).resolves.toMatchObject({
      provider: 'stripe',
      providerEventId: 'usage-1',
    });
    expect(requests).toEqual([
      'GET https://api.stripe.test/v1/prices?lookup_keys%5B%5D=team_monthly&active=true&limit=1',
      'POST https://api.stripe.test/v1/checkout/sessions',
      'POST https://api.stripe.test/v1/billing_portal/sessions',
      'GET https://api.stripe.test/v1/prices?lookup_keys%5B%5D=team_monthly&active=true&limit=1',
      'POST https://api.stripe.test/v1/subscriptions/sub_2',
      'POST https://api.stripe.test/v1/billing/meter_events',
    ]);
    expect(
      bodies.get('https://api.stripe.test/v1/billing_portal/sessions'),
    ).toContain('customer=cus_2');
    expect(
      bodies.get('https://api.stripe.test/v1/subscriptions/sub_2'),
    ).toContain('items%5B0%5D%5Bprice%5D=price_resolved');
    expect(
      bodies.get('https://api.stripe.test/v1/billing/meter_events'),
    ).toContain('payload%5Bstripe_customer_id%5D=cus_2');
  });

  it('keeps authentication, unsupported events, and malformed payloads distinct', async () => {
    const timestamp = 1_767_225_600;
    const provider = StripePayments.fromSecret({
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret() {
        return 'webhook-secret';
      },
      clock: () => new Date(timestamp * 1000),
    });
    const signed = (value: string) => {
      const body = new TextEncoder().encode(value);
      const signature = createHmac('sha256', 'webhook-secret')
        .update(`${timestamp}.${value}`)
        .digest('hex');
      return {
        body,
        headers: {
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
      };
    };

    await expect(provider.verifyWebhook?.({
      body: new Uint8Array(),
      headers: {},
    })).rejects.toBeInstanceOf(StripeWebhookAuthenticationError);
    await expect(
      provider.verifyWebhook?.(signed('{')),
    ).rejects.toBeInstanceOf(StripeWebhookPayloadError);
    await expect(
      provider.verifyWebhook?.(signed(JSON.stringify({
        id: 'evt_invoice',
        type: 'invoice.created',
        created: timestamp,
      }))),
    ).rejects.toBeInstanceOf(StripeWebhookUnsupportedEventError);
  });

  it('fails closed with actionable URL diagnostics before making a request', async () => {
    const unreachable: typeof fetch = Object.assign(
      async () => {
        throw new Error('request should not be reached');
      },
      {
        preconnect(_url: string | URL) {
          // Validation fails before transport selection.
        },
      },
    );
    const provider = (endpoint: string) => StripePayments.fromSecret({
      endpoint,
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret() {
        return 'server-secret';
      },
      fetch: unreachable,
    });

    await expect(provider('not-an-absolute-url').startCheckout({
      principalScope: 'workspace:one',
      plan: 'price_pro',
      returnTo: 'https://app.example.test/billing',
      idempotencyKey: 'invalid-endpoint',
    })).rejects.toThrow(
      'Stripe API endpoint must be an absolute HTTP(S) URL.',
    );
    await expect(provider('https://api.stripe.test/v1').startCheckout({
      principalScope: 'workspace:one',
      plan: 'price_pro',
      returnTo: '/billing',
      idempotencyKey: 'invalid-return',
    })).rejects.toThrow(
      'Billing return URL must be an absolute HTTP(S) URL.',
    );
  });
});
