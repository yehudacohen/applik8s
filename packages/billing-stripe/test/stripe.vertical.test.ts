import { createHmac } from 'node:crypto';
import { StripePayments } from '@applik8s/billing-stripe';
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
  });
});
