export type ApplicationOperationalHealthState =
  | 'Ready'
  | 'Action required'
  | 'Needs verification';

/**
 * Collapse current-state operational evidence without inventing readiness.
 * Inferred records can explain topology but never prove a provider is ready.
 */
export function applicationOperationalHealthState(
  records: readonly { readonly state: string; readonly authority: string }[],
): ApplicationOperationalHealthState {
  const states = records.map(({ state }) => state.toLowerCase());
  if (states.some(state => /failed|degraded|blocked|denied/u.test(state))) {
    return 'Action required';
  }
  if (records.some(({ state, authority }) =>
    authority !== 'inferred'
    && /^(ready|running|succeeded)$/u.test(state.toLowerCase()))) {
    return 'Ready';
  }
  return 'Needs verification';
}
