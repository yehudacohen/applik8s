import { domainDecision, type ApplicationDomainDecision } from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';

type RefundReason = 'ORDER_NOT_PAID' | 'REFUND_WINDOW_EXPIRED';

function refundEligibility(order: {
  readonly status: 'paid' | 'pending';
  readonly refundWindowOpen: boolean;
}): ApplicationDomainDecision<RefundReason, { readonly status?: string }> {
  if (order.status !== 'paid') {
    return domainDecision.deny('ORDER_NOT_PAID', { status: order.status });
  }
  if (!order.refundWindowOpen) return domainDecision.deny('REFUND_WINDOW_EXPIRED');
  return domainDecision.allow();
}

describe('v0.9 explainable domain decision disposition', () => {
  it('keeps eligibility as an ordinary reusable typed function', () => {
    expect(refundEligibility({ status: 'pending', refundWindowOpen: true })).toEqual({
      outcome: 'denied',
      reason: { code: 'ORDER_NOT_PAID', details: { status: 'pending' } },
    });
    expect(refundEligibility({ status: 'paid', refundWindowOpen: true })).toEqual({
      outcome: 'allowed',
    });
  });

  it('provides exhaustive result matching without granting authorization', () => {
    const message = domainDecision.match(
      refundEligibility({ status: 'paid', refundWindowOpen: false }),
      {
        allowed: () => 'eligible',
        denied: reason => `ineligible:${reason.code}`,
      },
    );
    expect(message).toBe('ineligible:REFUND_WINDOW_EXPIRED');
  });

  it('requires stable reason codes and clones explanation details', () => {
    const details = { status: 'pending' };
    const decision = domainDecision.deny('ORDER_NOT_PAID', details);
    details.status = 'paid';
    expect(decision).toEqual({
      outcome: 'denied',
      reason: { code: 'ORDER_NOT_PAID', details: { status: 'pending' } },
    });
    expect(() => domainDecision.deny('not stable')).toThrow(/UPPER_SNAKE_CASE/);
  });
});
