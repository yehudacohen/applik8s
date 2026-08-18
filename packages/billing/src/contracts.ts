import { type } from 'arktype';

/** Provider-neutral browser/server contracts shared by every billing surface. */
export const applicationBillingCheckoutInputSchema = type({
  intentId: 'string > 0',
  plan: 'string > 0',
  returnTo: 'string > 0',
});
export const applicationBillingCheckoutOutputSchema = type({
  provider: 'string > 0',
  'providerCustomerId?': 'string > 0',
  providerCheckoutId: 'string > 0',
  mode: "'simulated' | 'live'",
  url: 'string > 0',
  'expiresAt?': 'string',
});
export const applicationBillingPortalInputSchema = type({
  intentId: 'string > 0',
  returnTo: 'string > 0',
});
export const applicationBillingPortalOutputSchema = type({
  provider: 'string > 0',
  mode: "'simulated' | 'live'",
  url: 'string > 0',
});
export const applicationBillingSubscriptionChangeInputSchema = type({
  intentId: 'string > 0',
  plan: 'string > 0',
  timing: "'immediate' | 'periodEnd'",
});
export const applicationBillingSubscriptionChangeOutputSchema = type({
  provider: 'string > 0',
  providerSubscriptionId: 'string > 0',
  state: "'applied' | 'scheduled'",
  effectiveAt: 'string > 0',
});
export const applicationBillingSubscriptionCancellationInputSchema = type({
  intentId: 'string > 0',
  timing: "'immediate' | 'periodEnd'",
});
export const applicationBillingSubscriptionCancellationOutputSchema = type({
  provider: 'string > 0',
  providerSubscriptionId: 'string > 0',
  cancelled: 'boolean',
  effectiveAt: 'string > 0',
});
export const applicationBillingSubscriptionResumeInputSchema = type({
  intentId: 'string > 0',
});
export const applicationBillingPaymentEventSchema = type({
  provider: 'string > 0',
  id: 'string > 0',
  customerId: 'string > 0',
  subscriptionId: 'string > 0',
  principalScope: 'string > 0',
  plan: 'string > 0',
  status: "'active' | 'pastDue' | 'cancelled'",
  occurredAt: 'string > 0',
  periodStart: 'string > 0',
  periodEnd: 'string > 0',
  rawType: 'string > 0',
});
export const applicationBillingPaymentWebhookResultSchema = type({
  received: 'true',
  eventId: 'string > 0',
});
