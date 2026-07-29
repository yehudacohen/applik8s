// typecast-file-boundary: exact unavailable-state literals define the fail-closed upstream compatibility gate.
export const applicationTanStackServerPersistenceCompatibility = Object.freeze({
  package: '@tanstack/ai-persistence',
  version: 'unreleased',
  contract: 'ChatPersistence',
  status: 'unavailable',
} as const);

/**
 * TanStack's browser ChatClientPersistence is presentation-only and must not
 * be substituted for the server-authoritative ChatPersistence contract.
 */
export function assertApplicationTanStackServerPersistenceAvailable(): never {
  throw new Error(
    '@tanstack/ai-persistence has not published its server ChatPersistence contract. '
      + 'Applik8s refuses to substitute browser ChatClientPersistence or a parallel persistence protocol.',
  );
}
