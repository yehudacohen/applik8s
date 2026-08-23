import type { ApplicationProviderNode } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { applicationCallableProviderEnvironment } from '../src/application-callable-provider-runtime.js';

describe('callable provider runtime lowering', () => {
  it('resolves target selection and preserves profile-selected config and Secret identity', () => {
    const provider = callableProvider({
      kind: 'targetSelection',
      targets: {
        local: runtime({ env: { ACQUISITION_SOURCE: 'local' } }),
        kubernetes: {
          kind: 'profileSelection',
          selector: 'schema.spec.profile',
          cases: {
            starter: runtime({
              env: { ACQUISITION_SOURCE: 'starter' },
              secretEnv: {
                ACQUISITION_TOKEN: secret('acquisition-starter'),
              },
            }),
            dedicated: runtime({
              env: { ACQUISITION_SOURCE: 'dedicated' },
              secretEnv: {
                ACQUISITION_TOKEN: secret('acquisition-dedicated'),
              },
            }),
          },
          default: runtime({
            env: { ACQUISITION_SOURCE: 'starter' },
            secretEnv: {
              ACQUISITION_TOKEN: secret('acquisition-starter'),
            },
          }),
        },
      },
    });

    const environment = applicationCallableProviderEnvironment(
      [provider],
      { target: 'kubernetes', namespace: 'workflows' },
    );
    expect(environment).toEqual([
      {
        name: 'ACQUISITION_SOURCE',
        value: expect.stringContaining('schema.spec.profile'),
      },
      {
        name: 'ACQUISITION_TOKEN',
        valueFrom: {
          secretKeyRef: {
            name: expect.stringContaining('acquisition-dedicated'),
            key: 'token',
          },
        },
      },
    ]);
  });

  it('fails closed when the compiling target has no provider runtime', () => {
    const provider = callableProvider({
      kind: 'targetSelection',
      targets: { local: runtime({ env: { ACQUISITION_SOURCE: 'local' } }) },
    });
    expect(() => applicationCallableProviderEnvironment(
      [provider],
      { target: 'kubernetes', namespace: 'workflows' },
    )).toThrow(/has no kubernetes runtime binding/);
  });

  it('rejects profile branches that change an environment binding from public to Secret-backed', () => {
    const provider = callableProvider({
      kind: 'profileSelection',
      selector: 'schema.spec.profile',
      cases: {
        starter: runtime({ env: { ACQUISITION_TOKEN: 'inspectable' } }),
        dedicated: runtime({
          secretEnv: { ACQUISITION_TOKEN: secret('acquisition-dedicated') },
        }),
      },
      default: runtime({ env: { ACQUISITION_TOKEN: 'inspectable' } }),
    });
    expect(() => applicationCallableProviderEnvironment(
      [provider],
      { target: 'kubernetes', namespace: 'workflows' },
    )).toThrow(/both public and Secret-backed/);
  });

  it('rejects cross-namespace Secret projection', () => {
    const provider = callableProvider(runtime({
      secretEnv: {
        ACQUISITION_TOKEN: secret('acquisition', 'other-namespace'),
      },
    }));
    expect(() => applicationCallableProviderEnvironment(
      [provider],
      { target: 'kubernetes', namespace: 'workflows' },
    )).toThrow(/cannot project Secret other-namespace\/acquisition/);
  });
});

function callableProvider(callableRuntime: unknown): ApplicationProviderNode {
  return {
    id: 'provider.acquisition-provider.v1alpha1.primary',
    kind: 'provider',
    name: 'AcquisitionProvider',
    stability: 'stable',
    interface: 'AcquisitionProvider',
    implementation: 'fixture',
    config: { callableRuntime } as never,
  };
}

function runtime(runtimeContract: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { kind: 'runtime', runtime: runtimeContract };
}

function secret(name: string, namespace = 'workflows'): Readonly<Record<string, unknown>> {
  return {
    secret: { apiVersion: 'v1', kind: 'Secret', name, namespace },
    key: 'token',
  };
}
