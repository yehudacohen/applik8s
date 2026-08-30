export type CelldVersionTransition = 'unchanged' | 'requiresRecreate';

export function celldHealthPath(version: string): string {
  const match = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-|$)/u.exec(version);
  if (!match) {
    throw new Error(`CelldFleet artifact.celldVersion must be an exact semantic version, received ${JSON.stringify(version)}.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 4
    ? '/.well-known/celld/health'
    : '/__celld/health';
}

/**
 * v0.8 intentionally qualifies rolling updates only within one Celld runtime
 * version. A version change has unknown mixed-version semantics until a pair is
 * added to a future, evidence-backed compatibility table, so the operator
 * automatically uses a replacement rollout and never runs a mixed fleet.
 */
export function classifyCelldVersionTransition(
  observedVersion: string | undefined,
  desiredVersion: string,
): CelldVersionTransition {
  return observedVersion === undefined || observedVersion === desiredVersion
    ? 'unchanged'
    : 'requiresRecreate';
}

export function effectiveCelldRolloutStrategy(
  observedVersion: string | undefined,
  desiredVersion: string,
  configured: 'Rolling' | 'Recreate',
): 'Rolling' | 'Recreate' {
  return configured === 'Recreate'
    || classifyCelldVersionTransition(observedVersion, desiredVersion) === 'requiresRecreate'
    ? 'Recreate'
    : 'Rolling';
}
