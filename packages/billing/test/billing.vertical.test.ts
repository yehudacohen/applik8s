import {
  LocalPayments,
  PaymentProvider,
  projectSubscriptionEvent,
} from '@applik8s/billing';
import { describe, expect, it } from 'vitest';

describe('provider-neutral billing', () => {
  it('offers deterministic, credential-free Starter checkout and portal flows', async () => {
    const payments = LocalPayments.simulated({
      origin: 'http://app.example.test',
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(PaymentProvider.accepts?.(payments)).toBe(true);
    await expect(
      payments.startCheckout({
        principalScope: 'workspace:one',
        plan: 'pro',
        returnTo: '/billing',
        idempotencyKey: 'checkout-1',
      }),
    ).resolves.toEqual({
      provider: 'local',
      providerCustomerId: 'local_customer_d6a17c58',
      providerCheckoutId: 'local_checkout_4c6dd783',
      url: 'http://app.example.test/billing/simulated/checkout/4c6dd783',
      mode: 'simulated',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
    const first = await payments.openPortal({
      principalScope: 'workspace:one',
      returnTo: '/billing',
      idempotencyKey: 'portal-1',
    });
    const second = await payments.openPortal({
      principalScope: 'workspace:one',
      returnTo: '/billing',
      idempotencyKey: 'portal-1',
    });
    expect(first).toEqual(second);
    expect(first.mode).toBe('simulated');
  });

  it('deduplicates provider events and rejects out-of-order regressions', () => {
    const current = projectSubscriptionEvent(undefined, {
      provider: 'stripe',
      id: 'evt-new',
      customerId: 'cus-1',
      subscriptionId: 'sub-1',
      principalScope: 'workspace:one',
      plan: 'pro',
      status: 'active',
      occurredAt: '2026-01-02T00:00:00.000Z',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-02-01T00:00:00.000Z',
      rawType: 'customer.subscription.updated',
    });
    expect(projectSubscriptionEvent(current, {
      provider: 'stripe',
      id: 'evt-old',
      customerId: 'cus-1',
      subscriptionId: 'sub-1',
      principalScope: 'workspace:one',
      plan: 'free',
      status: 'cancelled',
      occurredAt: '2026-01-01T00:00:00.000Z',
      periodStart: '2025-12-01T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
      rawType: 'customer.subscription.deleted',
    })).toBe(current);
  });
});
