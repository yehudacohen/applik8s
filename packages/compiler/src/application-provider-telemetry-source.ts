import type { ApplicationCallableProviderBinding } from '@applik8s/core';

/**
 * Emits the single framework-owned wrapper around an actual generated provider
 * operation. Discovery and placement stay inert; invoking this value opens the
 * provider-attempt boundary.
 */
export function generatedApplicationProviderOperationValue(
  binding: ApplicationCallableProviderBinding,
  callable: string,
): string {
  if (!binding.operation) {
    throw new Error(
      `Provider binding ${binding.identifier} has no callable operation to instrument.`,
    );
  }
  return `instrumentApplicationProviderOperation(${JSON.stringify({
    interface: binding.provider.interface,
    nodeId: binding.provider.nodeId,
    member: binding.operation.member,
  })}, ${callable})`;
}
