import {
  type ApplicationModelCommandContext,
  type ApplicationRelationalModel,
  type PromotedDrizzleTable,
  module,
} from '@applik8s/applik8s';
import {
  applicationEntitlements,
  applicationUsageFacts,
  applicationUsageSchema,
} from './schema.js';

export * from './schema.js';

function installUsage() {
  return {
    // app.include() registers this schema before installation.
    // typecast: preserve the promoted model facets on the same Drizzle values.
    UsageFact: applicationUsageFacts as ApplicationRelationalModel<
      typeof applicationUsageFacts
    >,
    // typecast: module installation retains the promoted table identity.
    Entitlement: applicationEntitlements as PromotedDrizzleTable<
      typeof applicationEntitlements
    >,
  };
}

export const usage = module(
  'usage',
  { schema: applicationUsageSchema },
  installUsage,
);

export interface ActiveEntitlementRequirement {
  readonly principalScope: string;
  readonly capability: string;
}

export class ApplicationEntitlementRequiredError extends Error {
  readonly code = 'APPLIK8S_ENTITLEMENT_REQUIRED';

  constructor(readonly requirement: ActiveEntitlementRequirement) {
    super(
      `Capability ${requirement.capability} requires an active entitlement for ${requirement.principalScope}.`,
    );
    this.name = 'ApplicationEntitlementRequiredError';
  }
}

/**
 * Transaction-authoritative entitlement admission for a native model policy.
 *
 * Callers declare `Usage.Entitlement` in the policy transaction once; this
 * helper keeps generic participant decoding and validity-window handling out
 * of application source.
 */
export async function requireActiveEntitlement(
  context: ApplicationModelCommandContext,
  requirement: ActiveEntitlementRequirement,
): Promise<void> {
  const page = await context.models.Entitlement?.query({
    where: {
      principalScope: requirement.principalScope,
      capability: requirement.capability,
    },
    limit: 100,
  });
  const admittedAt = Date.parse(context.now);
  const active = page?.items.some(({ spec }) => {
    const validFrom = Reflect.get(spec, 'validFrom');
    const validUntil = Reflect.get(spec, 'validUntil');
    return typeof validFrom === 'string'
      && Date.parse(validFrom) <= admittedAt
      && (
        validUntil == null
        || (
          typeof validUntil === 'string'
          && Date.parse(validUntil) > admittedAt
        )
      );
  }) === true;
  if (!active) throw new ApplicationEntitlementRequiredError(requirement);
}
