import {
  app,
  profileFragment,
  Scheduler,
} from '@applik8s/applik8s';
import { agenticProfilesWith } from '@applik8s/start-agentic';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('Agentic Start assembly-profile extensions', () => {
  it('composes product-owned capabilities into each selected target-free profile', () => {
    const application = app('extended-agentic', {
      spec: type({
        name: 'string',
        profile: "'starter' | 'developer' | 'dedicated' | 'external'",
      }),
      status: type({ ready: 'boolean' }),
    });
    const productScheduling = profileFragment(
      'product.scheduling.v1',
      (profile) => {
        profile.provide(
          Scheduler.named('product'),
          Scheduler.local().identified('product.scheduler.v1'),
        );
      },
    );

    // This test deliberately installs the reusable profile fragment into a
    // typecast: use a minimal schema that omits Agentic Start's full contract.
    application.include(agenticProfilesWith({
      assemblyProfileFragments: {
        starter: [productScheduling],
        developer: [productScheduling],
        dedicated: [productScheduling],
        external: [productScheduling],
      },
    }) as never);

    for (const name of ['starter', 'developer', 'dedicated', 'external']) {
      const profile = application.assemblyProfiles.get(name);
      expect(profile?.fragments).toContain('product.scheduling.v1');
      const plan = application.implementationPlan(name);
      expect(plan.bindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability: expect.objectContaining({
              interface: 'Scheduler@v1alpha1',
              qualifier: 'product',
            }),
          }),
        ]),
      );
      expect(plan.bindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability: expect.objectContaining({
              interface: 'ApplicationHost@v1alpha1',
            }),
          }),
          expect.objectContaining({
            capability: expect.objectContaining({
              interface: 'ActorRuntime@v1alpha1',
            }),
          }),
          expect.objectContaining({
            capability: expect.objectContaining({
              interface: 'IdentityProvider@v1alpha1',
              qualifier: 'primary',
            }),
          }),
        ]),
      );
    }
  });
});
