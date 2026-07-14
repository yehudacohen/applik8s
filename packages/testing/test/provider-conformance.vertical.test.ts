import type { ApplicationProviderInterfaceContract } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { inspectApplicationProviderPackageConformance } from '../src/provider-conformance.js';

describe('external provider package conformance', () => {
  it('accepts a deterministic ProjectionStore registration without extending the built-in registry', () => {
    // typecast: preserve the provider kind discriminant for the structural acceptance predicate.
    const implementation = { kind: 'clickhouse', endpoint: 'http://clickhouse.test' } as const;
    const register = (): ApplicationProviderInterfaceContract => ({
      apiVersion: 'applik8s.provider/v1alpha1',
      interface: 'ProjectionStore',
      version: 'v1alpha1',
      requirements: ['atomicProjectionCheckpoint'],
      guarantees: ['replaySafeProjectionWrites'],
      implementation: { name: 'clickhouse-projection-provider' },
      surface: 'experimentalSurface',
      support: 'implemented',
      diagnostics: [],
    });
    const report = inspectApplicationProviderPackageConformance({
      interface: 'ProjectionStore', version: 'v1alpha1', implementation,
      accepts: (value): value is typeof implementation => Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'clickhouse'),
      register,
      requiredRequirements: ['atomicProjectionCheckpoint'],
      requiredGuarantees: ['replaySafeProjectionWrites'],
    });
    expect(report.ok, [...report.checks.filter((item) => !item.passed).map((item) => item.message), ...report.diagnostics.map((item) => item.message)].join('; ')).toBe(true);
  });
});
