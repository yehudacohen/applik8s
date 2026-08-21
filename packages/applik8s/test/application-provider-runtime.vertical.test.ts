// typecast-file-boundary: adversarial runtime-selection fixtures deliberately
// bypass the public provider-builder types to exercise fail-closed decoding.

import {
  app,
  defineApplicationProvider,
} from '@applik8s/applik8s';
import {
  ApplicationProviderRuntimeSelectionError,
  resolveApplicationProviderRuntimeImplementation,
} from '@applik8s/applik8s/internal/provider-runtime';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { applicationCallableProviderDependencies } from '../src/application-provider-dependencies';

describe('managed provider runtime selection', () => {
  it('returns direct provider implementations unchanged', () => {
    const implementation = { kind: 'direct', invoke: () => 'direct' };
    expect(
      resolveApplicationProviderRuntimeImplementation(implementation, {}),
    ).toBe(implementation);
    expect(
      resolveApplicationProviderRuntimeImplementation(
        {
          kind: 'applicationProvider',
          implementation,
        } as never,
        {},
      ),
    ).toBe(implementation);
  });

  it('selects the provisioned implementation for the managed profile variant', () => {
    const starter = { kind: 'starter', invoke: () => 'starter' };
    const dedicated = { kind: 'dedicated', invoke: () => 'dedicated' };
    const binding = {
      kind: 'applicationProvider',
      implementation: {
        kind: 'application-provider-selection',
        selector: '${schema.spec.profile}',
        cases: { starter, dedicated },
        default: starter,
      },
    } as never;
    expect(
      resolveApplicationProviderRuntimeImplementation(binding, {
        APPLIK8S_PROFILE_VARIANT: 'dedicated',
      }),
    ).toBe(dedicated);
  });

  it('fails closed when the runtime variant is absent or unknown', () => {
    const selection = {
      kind: 'application-provider-selection',
      selector: '${schema.spec.profile}',
      cases: { starter: { kind: 'starter' } },
      default: { kind: 'starter' },
    } as const;
    expect(() =>
      resolveApplicationProviderRuntimeImplementation(selection, {}),
    ).toThrow(ApplicationProviderRuntimeSelectionError);
    expect(() =>
      resolveApplicationProviderRuntimeImplementation(selection, {
        APPLIK8S_PROFILE_VARIANT: 'not-a-profile',
      }),
    ).toThrow(/no implementation for profile variant/);
  });

  it('returns stable callable provider operations with portable dependency metadata', async () => {
    interface AcquisitionProviderImplementation {
      readonly kind: 'acquisition';
      readonly source: string;
      acquire(input: { readonly id: string }): Promise<string>;
    }
    const AcquisitionProvider = defineApplicationProvider<AcquisitionProviderImplementation>({
      interface: 'AcquisitionProvider',
      version: 'v1alpha1',
      accepts: (candidate): candidate is AcquisitionProviderImplementation =>
        candidate !== null
        && typeof candidate === 'object'
        && Reflect.get(candidate, 'kind') === 'acquisition'
        && typeof Reflect.get(candidate, 'acquire') === 'function',
    }).named('primary');
    const Installation = type({ profile: "'starter' | 'dedicated'" });
    const application = app('callable-provider', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const implementation = (source: string): AcquisitionProviderImplementation => ({
      kind: 'acquisition',
      source,
      async acquire(input) {
        return `${this.source}:${input.id}`;
      },
    });
    application
      .profile(application.installation.spec, 'profile')
      .provide(AcquisitionProvider)
      .starter(() => implementation('starter'))
      .dedicated(() => implementation('dedicated'))
      .exhaustive();

    const provider = application.inject(AcquisitionProvider);
    const acquire = provider.acquire;
    expect(acquire).toBe(provider.acquire);
    expect(JSON.parse(JSON.stringify(provider))).toMatchObject({
      kind: 'applicationProvider',
      qualification: { name: 'primary' },
    });
    const previousVariant = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'dedicated';
    try {
      await expect(acquire({ id: 'item-1' })).resolves.toBe('dedicated:item-1');
      expect(provider.source).toBe('dedicated');
    } finally {
      if (previousVariant === undefined) {
        delete process.env.APPLIK8S_PROFILE_VARIANT;
      } else {
        process.env.APPLIK8S_PROFILE_VARIANT = previousVariant;
      }
    }
    expect(applicationCallableProviderDependencies({ acquire })).toEqual([
      expect.objectContaining({
        identifier: 'acquire',
        provider: expect.objectContaining({
          interface: 'AcquisitionProvider',
          qualification: expect.objectContaining({ name: 'primary' }),
        }),
      }),
    ]);
  });
});
