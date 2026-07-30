import {
  app,
  applicationGraphFor,
  IdentityProvider,
  OAuthAuthorizationServer,
} from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

describe('provider-neutral identity capabilities', () => {
  it('records authentication and OAuth authorization as distinct injectable providers', () => {
    const application = app('identity-capabilities');
    application.provide(
      IdentityProvider,
      IdentityProvider.from(async () =>
        testApplicationAdmission('human-1', {
          authorityRevision: 'authority-1',
          trustedContext: { tenant: 'tenant-1' },
        })),
    );
    application.provide(
      OAuthAuthorizationServer,
      OAuthAuthorizationServer.from('test-oauth', async ({ flow, decision }) => ({
        id: `decision-${flow.id}`,
        providerAuthorizationRequestId:
          flow.providerAuthorizationRequestId,
        accepted: decision === 'approve',
        continuationUri: 'https://oauth.example.test/continue',
        evidence: { provider: 'test-oauth' },
      })),
    );

    const providers = applicationGraphFor(application.composition)?.nodes.filter(
      (node) => node.kind === 'provider',
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interface: 'IdentityProvider',
          implementation: 'identity-provider',
          config: expect.objectContaining({
            identity: expect.objectContaining({
              authenticationSource: expect.any(String),
            }),
          }),
        }),
        expect.objectContaining({
          interface: 'OAuthAuthorizationServer',
          implementation: 'oauth-authorization-server',
          config: expect.objectContaining({
            oauthAuthorization: expect.objectContaining({
              decisionSource: expect.any(String),
            }),
          }),
        }),
      ]),
    );
  });

  it('rejects incomplete OAuth provider bindings', () => {
    const application = app('invalid-oauth-capability');
    expect(() =>
      application.provide(
        OAuthAuthorizationServer,
        // typecast: deliberately malformed test input exercises runtime validation past the public static contract.
        { kind: 'oauth-authorization-server', name: '', decide: async () => undefined } as never,
      )).toThrow(/OAuthAuthorizationServer/u);
  });
});
