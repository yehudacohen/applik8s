import type { ApplicationModelCommandContext } from '@applik8s/applik8s';
import {
  ApplicationEntitlementRequiredError,
  requireActiveEntitlement,
} from '@applik8s/usage';
import { describe, expect, it } from 'vitest';

describe('transaction-authoritative entitlement admission', () => {
  it('admits an active matching entitlement', async () => {
    await expect(
      requireActiveEntitlement(
        contextWithEntitlements([
          {
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2027-01-01T00:00:00.000Z',
          },
        ]),
        {
          principalScope: 'workspace-1',
          capability: 'research-review',
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('fails closed for absent and expired entitlements', async () => {
    for (const entitlements of [
      [],
      [{
        validFrom: '2025-01-01T00:00:00.000Z',
        validUntil: '2025-12-31T23:59:59.000Z',
      }],
    ]) {
      await expect(
        requireActiveEntitlement(
          contextWithEntitlements(entitlements),
          {
            principalScope: 'workspace-1',
            capability: 'research-review',
          },
        ),
      ).rejects.toBeInstanceOf(ApplicationEntitlementRequiredError);
    }
  });
});

function contextWithEntitlements(
  entitlements: readonly Record<string, unknown>[],
): ApplicationModelCommandContext {
  // typecast: implement only the public now/models subset read by this helper.
  return {
    now: '2026-06-01T00:00:00.000Z',
    models: {
      Entitlement: {
        async query() {
          return {
            items: entitlements.map((spec, index) => ({
              id: `entitlement-${index}`,
              spec,
            })),
          };
        },
      },
    },
  } as unknown as ApplicationModelCommandContext;
}
