import {
  type ApplicationQueryBinding,
  type ApplicationRelationalContext,
  applicationAdmittedContextDigest,
  applicationRequestContextValues,
  createApplicationFetchGateway,
  IdentityProvider,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission, testApplicationPrincipal } from '../../../test-support/application-principal.js';

describe('framework-neutral application gateway', () => {
  it('mounts authenticated query dispatch below a versioned Fetch boundary', async () => {
    const query: ApplicationQueryBinding<{ readonly limit: number }, readonly string[]> = {
      kind: 'applicationQuery',
      id: 'entries.published.v1',
      name: 'entries.published',
      version: 'v1',
      input: type({ limit: 'number.integer >= 1' }),
      output: type('string[]'),
      trustedContext: [],
      reads: [{ $model: { name: 'GuestBookEntry' } }],
      budgets: { timeoutMs: 1_000, maxResultBytes: 10_000, maxRows: 100 },
      database: { kind: 'applicationDatabase', name: 'guestbook', provider: { kind: 'postgres' }, schema: {} },
      async authorize(principal) { return principal.id === 'author'; },
      async run() { return ['hello']; },
    };
    const identity = IdentityProvider.from(async () =>
      testApplicationAdmission('author', {
        authorityRevision: 'membership-1',
        trustedContext: { guestbook: 'main' },
      }));
    const gateway = createApplicationFetchGateway({
      identity,
      cursorSecret: 'framework-neutral-cursor-secret-with-32-characters',
      query: {
        // typecast: the gateway intentionally erases this fixture's concrete query payload while its ArkType schemas remain authoritative.
        queries: [query as ApplicationQueryBinding<unknown, unknown>],
        context: (requestIdentity) => {
          expect(applicationAdmittedContextDigest(requestIdentity.admittedContext)).toBe(applicationAdmittedContextDigest({
            values: applicationRequestContextValues(testApplicationPrincipal('author', {
              authorityRevision: 'membership-1',
              trustedContext: { guestbook: 'main' },
            }), 'membership-1', { guestbook: 'main' }),
            digestSecret: 'framework-neutral-cursor-secret-with-32-characters',
          }));
          return relationalContext();
        },
      },
    });
    const response = await gateway.handle(new Request(
      'https://guestbook.test/__applik8s/v1/queries/entries.published.v1/snapshot',
      { method: 'POST', body: JSON.stringify({ input: { limit: 20 } }) },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: 'snapshot',
      query: 'entries.published.v1',
      value: ['hello'],
    });
    await expect(gateway.handle(new Request('https://guestbook.test/__applik8s/v1/healthz')).then((value) => value.json())).resolves.toEqual({ live: true });
    await expect(gateway.handle(new Request('https://guestbook.test/__applik8s/v1/readyz')).then((value) => value.json())).resolves.toEqual({ ready: true });
  });

  it('keeps framework routing outside the gateway', async () => {
    const gateway = createApplicationFetchGateway({
      identity: IdentityProvider.from(async () =>
        testApplicationAdmission('author', { authorityRevision: 'membership-1' })),
      cursorSecret: 'framework-neutral-cursor-secret-with-32-characters',
    });
    expect((await gateway.handle(new Request('https://guestbook.test/'))).status).toBe(404);
    expect((await gateway.handle(new Request('https://guestbook.test/__applik8s/v1/unknown'))).status).toBe(404);
  });
});

function relationalContext(): ApplicationRelationalContext {
  return {
    admittedContext: { values: {}, digestSecret: 'application-gateway-test-context-secret' },
    trustedContext: {},
    database() { throw new Error('not used'); },
    async run(_binding, handler) { return handler(); },
    async snapshot(_binding, handler) { return { value: await handler(), sequence: 1 }; },
    async changes() { return { items: [], retentionFloor: 0 }; },
    // typecast: the fixture never reads db; never marks the deliberately unavailable transactional client.
    async transaction(_binding, handler) { return handler({ db: undefined as never, changes: { invalidate() {}, reset() {} } }); },
    async get() { return undefined; },
    async update() { throw new Error('not used'); },
  };
}
