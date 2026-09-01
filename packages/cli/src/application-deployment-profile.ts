/**
 * Lifecycle commands may name a profile for operator clarity, but the
 * persisted deployment graph remains authoritative. Refuse to operate on a
 * different profile instead of silently selecting another physical graph.
 */
export function assertRequestedDeploymentProfile(
  deployedProfile: string,
  requestedProfile: string | undefined,
  operation: 'Destroy' | 'Status',
): void {
  if (requestedProfile === undefined) return;
  const requested = requestedProfile.trim();
  if (!requested) throw new Error(`${operation} --profile must not be empty.`);
  if (requested !== deployedProfile) {
    throw new Error(
      `${operation} profile ${requested} does not match persisted Alchemy stack profile ${deployedProfile}.`,
    );
  }
}
