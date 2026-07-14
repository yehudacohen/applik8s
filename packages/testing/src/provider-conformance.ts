import type { ApplicationProviderInterfaceContract, Diagnostic } from '@applik8s/core';
import { validateApplicationProviderInterfaceContract } from '@applik8s/core';

export interface ApplicationProviderPackageConformanceCase<TImplementation> {
  readonly interface: string;
  readonly version: string;
  readonly implementation: TImplementation;
  readonly accepts: (implementation: unknown) => implementation is TImplementation;
  readonly register: (implementation: TImplementation) => ApplicationProviderInterfaceContract;
  readonly requiredRequirements?: readonly string[];
  readonly requiredGuarantees?: readonly string[];
}

export interface ApplicationProviderPackageConformanceReport {
  readonly ok: boolean;
  readonly contract: ApplicationProviderInterfaceContract;
  readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly message: string }[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Provider packages use this before framework-specific live tests to prove the shared registration seam deterministically. */
export function inspectApplicationProviderPackageConformance<TImplementation>(testCase: ApplicationProviderPackageConformanceCase<TImplementation>): ApplicationProviderPackageConformanceReport {
  const first = testCase.register(testCase.implementation);
  const second = testCase.register(testCase.implementation);
  const checks = [
    check('accepts-implementation', testCase.accepts(testCase.implementation), `Provider ${testCase.interface} must accept its own implementation.`),
    check('stable-registration', JSON.stringify(first) === JSON.stringify(second), `Provider ${testCase.interface} registration must be deterministic.`),
    check('interface-identity', first.interface === testCase.interface, `Registered interface must be ${testCase.interface}.`),
    check('version-identity', first.version === testCase.version, `Registered version must be ${testCase.version}.`),
    check('requirements', (testCase.requiredRequirements ?? []).every((requirement) => (first.requirements ?? []).includes(requirement)), `Provider ${testCase.interface} must declare every required capability.`),
    check('guarantees', (testCase.requiredGuarantees ?? []).every((guarantee) => (first.guarantees ?? []).includes(guarantee)), `Provider ${testCase.interface} must declare every required guarantee.`),
  ];
  const diagnostics = validateApplicationProviderInterfaceContract(first);
  return { ok: checks.every((item) => item.passed) && diagnostics.length === 0, contract: first, checks, diagnostics };
}

function check(name: string, passed: boolean, message: string): { readonly name: string; readonly passed: boolean; readonly message: string } {
  return { name, passed, message };
}
