// typecast-file-boundary: Callable-provider fixtures deliberately erase receiver generics to prove public hydration, extraction, and rejection behavior.
import { describe, expect, it } from 'vitest';
import {
  resolveApplicationCallableProviderRuntimeEnvironment,
  type ApplicationProviderNode,
} from '../src/index.js';

function provider(callableRuntime: Readonly<Record<string, unknown>>): ApplicationProviderNode {
  return {
    id: 'provider.payments',
    name: 'payments',
    kind: 'provider',
    interface: 'PaymentProvider',
    implementation: 'stripe',
    // Test fixtures cross the portable JSON boundary after constructing the
    // deliberately heterogeneous callable-runtime tree.
    config: { callableRuntime: callableRuntime as never },
    stability: 'stable',
  };
}

describe('callable provider runtime environment', () => {
  it('selects one concrete profile and target without retaining deployment expressions', () => {
    const entries = resolveApplicationCallableProviderRuntimeEnvironment([
      provider({
        kind: 'profileSelection',
        selector: '${schema.spec.profile}',
        cases: {
          developer: {
            kind: 'targetSelection',
            targets: {
              aws: {
                kind: 'runtime',
                runtime: {
                  env: { STRIPE_MODE: 'test' },
                  secretEnv: {
                    STRIPE_SECRET_KEY: {
                      secret: { kind: 'Secret', name: 'provider-credentials', namespace: 'application' },
                      key: 'STRIPE_SECRET_KEY',
                    },
                  },
                },
              },
            },
          },
        },
        default: { kind: 'runtime', runtime: { env: { STRIPE_MODE: 'disabled' } } },
      }),
    ], { target: 'aws', profile: 'developer' });

    expect(entries).toEqual([
      { providerId: 'provider.payments', name: 'STRIPE_MODE', source: { kind: 'value', value: 'test' } },
      {
        providerId: 'provider.payments',
        name: 'STRIPE_SECRET_KEY',
        source: {
          kind: 'secret',
          namespace: 'application',
          name: 'provider-credentials',
          key: 'STRIPE_SECRET_KEY',
          optional: false,
        },
      },
    ]);
  });

  it('rejects conflicting provider environment on one workload', () => {
    expect(() => resolveApplicationCallableProviderRuntimeEnvironment([
      provider({ kind: 'runtime', runtime: { env: { PROVIDER_MODE: 'stripe' } } }),
      { ...provider({ kind: 'runtime', runtime: { env: { PROVIDER_MODE: 'other' } } }), id: 'provider.other' },
    ], { target: 'aws' })).toThrow(/conflicting runtime environment PROVIDER_MODE/u);
  });
});
// typecast-file-boundary: Callable-provider fixtures deliberately erase receiver generics to prove public hydration, extraction, and rejection behavior.
