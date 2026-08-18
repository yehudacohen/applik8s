/**
 * Derive a lease deadline from framework-issued time rather than ambient wall
 * clock. The caller supplies the trusted timestamp; this helper only performs
 * deterministic calendar arithmetic.
 */
export function agenticLeaseExpiration(
  issuedAt: string,
  durationMilliseconds: number,
): string {
  const issuedAtMilliseconds = Date.parse(issuedAt);
  if (!Number.isFinite(issuedAtMilliseconds)) {
    throw new Error('Agentic lease issuance requires an ISO timestamp.');
  }
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 1) {
    throw new Error('Agentic lease duration must be a positive integer number of milliseconds.');
  }
  return new Date(issuedAtMilliseconds + durationMilliseconds).toISOString();
}
