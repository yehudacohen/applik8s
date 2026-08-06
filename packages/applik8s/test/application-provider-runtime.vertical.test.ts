// typecast-file-boundary: adversarial runtime-selection fixtures deliberately
// bypass the public provider-builder types to exercise fail-closed decoding.
import {
  ApplicationProviderRuntimeSelectionError,
  resolveApplicationProviderRuntimeImplementation,
} from '@applik8s/applik8s/internal/provider-runtime';
import { describe, expect, it } from 'vitest';

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
});
