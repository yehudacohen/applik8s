/**
 * Compiler marker for a domain-scoped provider-call accounting authority.
 * The marker contains model identities only; generated workers construct the
 * callable capability from their admitted principal, trusted context, clock,
 * and compiler-owned database credential.
 */
export interface ApplicationProviderAccountingBinding<TCapability> {
  readonly kind: 'applicationProviderAccounting';
  readonly name: string;
  readonly callModel: object;
  readonly costModel: object;
  /** Type-only capability carried into ApplicationTaskContext. */
  readonly __capability?: TCapability;
}

export function defineApplicationProviderAccountingBinding<TCapability>(
  name: string,
  models: {
    readonly call: object;
    readonly cost: object;
  },
): ApplicationProviderAccountingBinding<TCapability> {
  if (!name.trim()) throw new Error('Application provider accounting binding name must not be empty.');
  return Object.freeze({
    kind: 'applicationProviderAccounting',
    name,
    callModel: models.call,
    costModel: models.cost,
  });
}
