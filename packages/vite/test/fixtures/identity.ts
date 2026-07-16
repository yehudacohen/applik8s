export function fixtureAdmission(id: string) {
  return {
    principal: { id },
    authorizationVersion: 'fixture-v1',
    trustedContext: {},
  };
}
