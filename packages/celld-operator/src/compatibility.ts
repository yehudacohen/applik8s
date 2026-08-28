export type CelldVersionTransition = 'unchanged' | 'requiresRecreate';

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
