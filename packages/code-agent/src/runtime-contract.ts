// typecast-file-boundary: Symbol-keyed runtime bindings are checked at the
// module boundary before they are exposed as typed provider capabilities.
import type { ApplicationProviderRuntimeContract } from '@applik8s/core';

const symbols = {
  harness: Symbol.for('applik8s.agentHarnessRuntimeBinding'),
  workspace: Symbol.for('applik8s.codeWorkspaceRuntimeBinding'),
  repository: Symbol.for('applik8s.sourceRepositoryRuntimeBinding'),
  process: Symbol.for('applik8s.processRunnerRuntimeBinding'),
} as const;

export function bindCodeAgentProviderRuntime<T extends object>(
  provider: T,
  kind: keyof typeof symbols,
  runtime: ApplicationProviderRuntimeContract,
): T {
  Object.defineProperty(provider, symbols[kind], {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(runtime),
  });
  return provider;
}

export function codeAgentProviderRuntime(
  provider: object,
  kind: keyof typeof symbols,
): ApplicationProviderRuntimeContract | undefined {
  const runtime = Reflect.get(provider, symbols[kind]);
  return runtime && typeof runtime === 'object'
    ? runtime as ApplicationProviderRuntimeContract
    : undefined;
}
