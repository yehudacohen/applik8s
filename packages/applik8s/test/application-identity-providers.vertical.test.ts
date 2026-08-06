import {
  app,
  applicationGraphFor,
  IdentityProvider,
  OAuthAuthorizationServer,
  TransactionalDatabase,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

describe('provider-neutral identity capabilities', () => {
  it('records server-side database admission dependencies without serializing provider bindings', () => {
    const application = app('stateful-identity', {
      spec: type({ profile: "'starter' | 'dedicated'" }),
      status: type({ ready: 'boolean' }),
    });
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    const IdentityDatabase = TransactionalDatabase.named('identity');
    const databaseProvider = () => TransactionalDatabase.postgres({
      name: 'identity',
      clusterName: 'stateful-identity-db',
      namespace: 'stateful-identity-system',
      database: 'stateful-identity',
    });
    deployment
      .provide(IdentityDatabase)
      .starter(databaseProvider)
      .dedicated(databaseProvider)
      .exhaustive();
    const database = application.inject(IdentityDatabase);
    application.provide(
      IdentityProvider,
      IdentityProvider.from(
        async () => testApplicationAdmission('human-1'),
        { dependencies: { database } },
      ),
    );

    const graph = applicationGraphFor(application.composition);
    const identity = graph?.nodes.find(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'IdentityProvider',
    );
    expect(identity).toMatchObject({
      config: {
        identityRuntime: {
          databaseProvider: {
            interface: 'TransactionalDatabase',
            nodeId: 'provider.transactional-database.v1alpha1.identity',
          },
        },
      },
    });
    expect(JSON.stringify(identity)).not.toContain('applicationProvider');
    expect(graph?.edges).toContainEqual({
      from: {
        nodeId: 'provider.transactional-database.v1alpha1.identity',
      },
      to: { nodeId: 'provider.identity-provider' },
      relationship: 'provides',
    });
  });

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

  it('selects identity and OAuth implementations through exhaustive qualified profiles', () => {
    const application = app('profiled-identity', {
      spec: type({
        name: 'string',
        profile: "'starter' | 'dedicated' | 'external'",
      }),
      status: type({ ready: 'boolean' }),
    });
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    const PrimaryIdentity = IdentityProvider.named('primary');
    const PrimaryOAuth = OAuthAuthorizationServer.named('primary');
    deployment
      .provide(PrimaryIdentity)
      .starter(() =>
        IdentityProvider.deterministic({
          mode: 'starter',
          application: 'profiled-identity',
          subject: 'developer',
          catalogRevision: 'starter-catalog',
          authorityRevision: 'starter-authority',
        }),
      )
      .dedicated(() =>
        IdentityProvider.from(
          async () => testApplicationAdmission('dedicated-human'),
          {
            infrastructure: {
              kind: 'ory',
              stack: 'platform',
              provision: true,
              spec: {
                name: 'profiled-identity',
                namespace: 'profiled-identity-system',
                shared: true,
                managed: {
                  databases: true,
                  secrets: true,
                  routes: false,
                  sampleUpstream: false,
                  courierSes: false,
                },
              },
              deletionPolicy: 'retain',
            },
          },
        ),
      )
      .external(() =>
        IdentityProvider.from(async () =>
          testApplicationAdmission('external-human')),
      )
      .exhaustive();
    deployment
      .provide(PrimaryOAuth)
      .starter(() => oauth('starter'))
      .dedicated(() => oauth('dedicated'))
      .external(() => oauth('external'))
      .exhaustive();

    expect(application.inject(PrimaryIdentity)).toMatchObject({
      qualification: {
        capability: 'IdentityProvider',
        name: 'primary',
      },
    });
    expect(application.inject(PrimaryOAuth)).toMatchObject({
      qualification: {
        capability: 'OAuthAuthorizationServer',
        name: 'primary',
      },
    });
    const providers = applicationGraphFor(application.composition)?.nodes.filter(
      (node) => node.kind === 'provider',
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interface: 'IdentityProvider',
          implementation: 'application-provider-selection',
          config: expect.objectContaining({
            qualification: expect.objectContaining({ name: 'primary' }),
            identity: {
              authenticationProfile: {
                selector: 'schema.spec.profile',
                cases: {
                  starter: expect.objectContaining({
                    authenticationSource: expect.any(String),
                  }),
                  dedicated: expect.objectContaining({
                    authenticationSource: expect.any(String),
                  }),
                  external: expect.objectContaining({
                    authenticationSource: expect.any(String),
                  }),
                },
                default: expect.objectContaining({
                  authenticationSource: expect.any(String),
                }),
              },
            },
            identityInfrastructure: {
              kind: 'application-provider-selection',
              selector: 'schema.spec.profile',
              cases: {
                starter: null,
                dedicated: expect.objectContaining({
                  kind: 'ory',
                  stack: 'platform',
                  provision: true,
                }),
                external: null,
              },
              default: expect.objectContaining({
                kind: 'ory',
                stack: 'platform',
                provision: true,
              }),
            },
          }),
        }),
        expect.objectContaining({
          interface: 'OAuthAuthorizationServer',
          implementation: 'application-provider-selection',
          config: expect.objectContaining({
            qualification: expect.objectContaining({ name: 'primary' }),
          }),
        }),
      ]),
    );
  });
});

function oauth(name: string) {
  return OAuthAuthorizationServer.from(
    `${name}-oauth`,
    async ({ flow, decision }) => ({
      id: `${name}-${flow.id}`,
      providerAuthorizationRequestId: flow.providerAuthorizationRequestId,
      accepted: decision === 'approve',
      continuationUri: `https://${name}.example.test/continue`,
      evidence: { provider: name },
    }),
  );
}
