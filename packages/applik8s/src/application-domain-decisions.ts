/**
 * A provider-neutral domain eligibility result. This is deliberately a value
 * algebra, not a registrar: the enclosing query, operation, Job, workflow, or
 * reconcile handler owns authority, evidence, invalidation, and durability.
 */
export type ApplicationDomainDecision<
  TCode extends string = string,
  TDetails = never,
> =
  | { readonly outcome: 'allowed' }
  | {
      readonly outcome: 'denied';
      readonly reason: {
        readonly code: TCode;
        readonly details?: TDetails;
      };
    };

function allowDomainDecision(): ApplicationDomainDecision<never, never> {
  return Object.freeze({ outcome: 'allowed' });
}

function denyDomainDecision<const TCode extends string>(
  code: TCode,
): ApplicationDomainDecision<TCode, never>;
function denyDomainDecision<const TCode extends string, TDetails>(
  code: TCode,
  details: TDetails,
): ApplicationDomainDecision<TCode, TDetails>;
function denyDomainDecision<const TCode extends string, TDetails>(
  code: TCode,
  details?: TDetails,
): ApplicationDomainDecision<TCode, TDetails> {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(code)) {
    throw new Error(
      `Domain decision reason ${JSON.stringify(code)} must be a stable UPPER_SNAKE_CASE code.`,
    );
  }
  return Object.freeze({
    outcome: 'denied',
    reason: Object.freeze({
      code,
      ...(details === undefined ? {} : { details: structuredClone(details) }),
    }),
  });
}

export const domainDecision = Object.freeze({
  allow: allowDomainDecision,
  deny: denyDomainDecision,
  match<
    TCode extends string,
    TDetails,
    TAllowed,
    TDenied,
  >(
    decision: ApplicationDomainDecision<TCode, TDetails>,
    cases: {
      readonly allowed: () => TAllowed;
      readonly denied: (reason: { readonly code: TCode; readonly details?: TDetails }) => TDenied;
    },
  ): TAllowed | TDenied {
    return decision.outcome === 'allowed'
      ? cases.allowed()
      : cases.denied(decision.reason);
  },
});
