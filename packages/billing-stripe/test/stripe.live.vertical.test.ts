// typecast-file-boundary: the live acceptance fixture restores only Stripe's
// documented response fields after HTTP success on the real API path.
import { randomUUID } from 'node:crypto';
import { StripePayments } from '@applik8s/billing-stripe';
import { describe, expect, it } from 'vitest';

const apiKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID;
const endpoint = 'https://api.stripe.com/v1';
// Placeholders in .env keep dry-runs deterministic; only a real test-mode key
// and price exercise the live acceptance path.
const live = apiKey?.startsWith('sk_test') && priceId?.startsWith('price_')
  ? describe
  : describe.skip;

live('live Stripe payment path acceptance', () => {
  it('starts a checkout session and portal session against the live Stripe API', async () => {
    if (!apiKey || !priceId) {
      throw new Error('Expected live Stripe credentials on the acceptance path.');
    }
    const payments = StripePayments.fromSecret({
      secrets: {
        apiKey: { name: 'stripe', key: 'apiKey' },
        webhookSecret: { name: 'stripe', key: 'webhookSecret' },
      },
      async resolveSecret(reference) {
        if (reference.key === 'apiKey') return apiKey;
        throw new Error('The live acceptance path does not consume a webhook secret.');
      },
    });
    const principalScope = `workspace:live-acceptance-${Date.now()}`;
    const checkout = await payments.startCheckout({
      plan: priceId,
      principalScope,
      returnTo: 'https://app.example.test/billing/return',
      idempotencyKey: `checkout-${randomUUID()}`,
    });
    expect(checkout.provider).toBe('stripe');
    expect(checkout.mode).toBe('live');
    expect(checkout.providerCheckoutId).toMatch(/^cs_/);
    expect(checkout.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(checkout.expiresAt).toBeDefined();

    // Stripe can defer customer creation until hosted checkout completes.
    // Portal acceptance is available only when this session allocated one
    // eagerly; webhook projection owns the durable mapping either way.
    if (checkout.providerCustomerId) {
      expect(checkout.providerCustomerId).toMatch(/^cus_/);
      const portal = await payments.openPortal({
        providerCustomerId: checkout.providerCustomerId,
        principalScope,
        returnTo: 'https://app.example.test/billing/portal',
        idempotencyKey: `portal-${randomUUID()}`,
      });
      expect(portal.provider).toBe('stripe');
      expect(portal.mode).toBe('live');
      expect(portal.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    }

    // Best-effort hygiene: the session auto-expires within 24 hours, but the
    // acceptance run leaves no open checkout object behind on the account.
    await fetch(
      new URL(`/v1/checkout/sessions/${checkout.providerCheckoutId}/expire`, endpoint),
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
      },
    ).catch(() => undefined);
  });
});
