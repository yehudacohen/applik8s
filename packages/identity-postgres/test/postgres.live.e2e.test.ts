import { randomBytes } from 'node:crypto';
import type {
  ApplicationIdentityAdmissionReceipt,
  ApplicationIdentityProjectionFrontier,
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOrphanedProviderSession,
  ApplicationPreAuthenticationFlowRecord,
} from '@applik8s/identity';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresApplicationIdentityStores } from '../src/index.js';

const databaseUrl = process.env.APPLIK8S_IDENTITY_POSTGRES_URL;
const live = databaseUrl ? describe : describe.skip;

live('PostgreSQL identity stores', () => {
  const schema = `applik8s_identity_test_${randomBytes(6).toString('hex')}`;
  // typecast: the enclosing live-suite selection proves the optional environment value is present before PostgreSQL construction.
  const sql = postgres(databaseUrl as string, { max: 6, prepare: false });
  const stores = createPostgresApplicationIdentityStores({ sql, schema });

  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await stores.prepare();
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sql.end({ timeout: 5 });
  });

  it('persists flows and permits exactly one compare-and-swap winner', async () => {
    const initial = identityFlow('flow-cas');
    await expect(stores.flows.createFlow(initial)).resolves.toEqual(initial);

    const candidates = ['verify-email', 'complete-profile'].map(
      (transition): ApplicationPreAuthenticationFlowRecord => ({
        ...initial,
        completedTransitions: [transition],
        attempts: 1,
        version: 2,
      }),
    );
    const results = await Promise.allSettled(
      candidates.map((candidate) => stores.flows.replaceFlow(candidate, 1)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    await expect(stores.flows.getFlow(initial.id)).resolves.toMatchObject({
      id: initial.id,
      version: 2,
      attempts: 1,
    });
  });

  it('commits admission and its consumed flow atomically and replays by completion key', async () => {
    const initial = identityFlow('flow-admission');
    const consumed: ApplicationPreAuthenticationFlowRecord = {
      ...initial,
      state: 'consumed',
      attempts: 1,
      consumedAt: '2026-07-29T00:01:00.000Z',
      version: 2,
    };
    const receipt = admissionReceipt(initial.id);
    await stores.flows.createFlow(initial);

    await expect(
      stores.flows.commitAdmission({
        flow: consumed,
        expectedFlowVersion: 1,
        receipt,
      }),
    ).resolves.toMatchObject({ kind: 'committed', flow: consumed, receipt });
    await expect(
      stores.flows.commitAdmission({
        flow: consumed,
        expectedFlowVersion: 1,
        receipt,
      }),
    ).resolves.toMatchObject({ kind: 'replayed', flow: consumed, receipt });
    await expect(
      stores.flows.getAdmissionReceipt(receipt.providerCompletionKey),
    ).resolves.toEqual(receipt);
  });

  it('deduplicates provider-session orphans and resolves them with versioned evidence', async () => {
    const orphan = orphanedSession('orphan-1');
    const duplicate = { ...orphan, id: 'orphan-duplicate' };

    await expect(stores.flows.recordOrphan(orphan)).resolves.toEqual(orphan);
    await expect(stores.flows.recordOrphan(duplicate)).resolves.toEqual(orphan);
    await expect(stores.flows.listPendingOrphans(10)).resolves.toContainEqual(
      orphan,
    );
    await expect(
      stores.flows.resolveOrphan(orphan.id, 1, {
        state: 'revoked',
        resolvedAt: '2026-07-29T00:02:00.000Z',
        evidence: { provider: 'confirmed' },
      }),
    ).resolves.toMatchObject({
      id: orphan.id,
      state: 'revoked',
      version: 2,
      resolutionEvidence: { provider: 'confirmed' },
    });
    await expect(stores.flows.listPendingOrphans(10)).resolves.not.toContainEqual(
      expect.objectContaining({ id: orphan.id }),
    );
  });

  it('persists OAuth consent reservations with compare-and-swap semantics', async () => {
    const initial = oauthFlow('oauth-flow');
    await expect(stores.oauth.create(initial)).resolves.toEqual(initial);
    const approving: ApplicationOAuthAuthorizationFlowRecord = {
      ...initial,
      state: 'approving',
      version: 2,
    };
    await expect(stores.oauth.replace(approving, 1)).resolves.toEqual(approving);
    await expect(
      stores.oauth.replace({ ...approving, state: 'denying', version: 2 }, 1),
    ).rejects.toThrow(/changed concurrently/u);
    await expect(stores.oauth.get(initial.id)).resolves.toEqual(approving);
  });

  it('fails closed when JSONB identity and durable columns diverge', async () => {
    const initial = identityFlow('flow-corrupt');
    await stores.flows.createFlow(initial);
    await sql.unsafe(
      `UPDATE ${schema}.applik8s_identity_flows
       SET record = jsonb_set(record, '{id}', '"another-flow"'::jsonb)
       WHERE id = $1`,
      [initial.id],
    );

    await expect(stores.flows.getFlow(initial.id)).rejects.toThrow(
      /identity\/version is inconsistent/u,
    );
  });

  it('persists authorization projection frontiers with compare-and-swap ordering', async () => {
    const initial = projectionFrontier(1, 'authority-1');
    await expect(stores.frontiers.commit(initial, undefined)).resolves.toEqual(initial);
    const candidates = [
      projectionFrontier(2, 'authority-2'),
      projectionFrontier(3, 'authority-3'),
    ];
    const results = await Promise.allSettled(
      candidates.map((candidate) => stores.frontiers.commit(candidate, 1)),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(stores.frontiers.read('application-authority')).resolves.toMatchObject({
      projection: 'application-authority',
      state: 'current',
      sourceSequence: expect.any(Number),
    });
  });
});

function identityFlow(id: string): ApplicationPreAuthenticationFlowRecord {
  return {
    apiVersion: 'applik8s.identity/v1alpha1',
    id,
    kind: 'login',
    provider: 'ory-kratos',
    providerFlowId: `provider-${id}`,
    browserBindingDigest: 'browser-digest',
    csrfBindingDigest: 'csrf-digest',
    providerContinuityDigest: 'continuity-digest',
    allowedTransitions: ['verify-email', 'complete-profile'],
    completedTransitions: [],
    state: 'active',
    attempts: 0,
    maximumAttempts: 8,
    issuedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T00:10:00.000Z',
    version: 1,
  };
}

function admissionReceipt(flowId: string): ApplicationIdentityAdmissionReceipt {
  return {
    apiVersion: 'applik8s.identityAdmission/v1alpha1',
    id: `receipt-${flowId}`,
    flowId,
    provider: 'ory-kratos',
    providerCompletionKey: `completion-${flowId}`,
    providerSessionId: `session-${flowId}`,
    principal: {
      id: 'principal:app:human-1',
      identity: {
        id: 'identity:ory:human-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'human-1',
      },
      kind: 'human',
      authenticationMethod: 'ory:password',
      audience: ['https://application.example.test'],
      trustedContextDigest: 'context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-29T00:00:00.000Z',
      sessionId: `session-${flowId}`,
    },
    authenticationMethod: 'ory:password',
    assurance: ['aal1'],
    trustedContextDigest: 'context-1',
    issuedAt: '2026-07-29T00:01:00.000Z',
  };
}

function orphanedSession(id: string): ApplicationOrphanedProviderSession {
  return {
    apiVersion: 'applik8s.identityOrphan/v1alpha1',
    id,
    flowId: 'flow-orphan',
    provider: 'ory-kratos',
    providerSessionId: 'session-orphan',
    providerCompletionKey: 'completion-orphan',
    reason: 'local admission failed',
    state: 'pending',
    createdAt: '2026-07-29T00:00:00.000Z',
    version: 1,
  };
}

function oauthFlow(id: string): ApplicationOAuthAuthorizationFlowRecord {
  return {
    apiVersion: 'applik8s.oauth/v1alpha1',
    id,
    provider: 'ory-hydra',
    providerAuthorizationRequestId: `challenge-${id}`,
    authorizationRequestId: `request-${id}`,
    clientId: 'client-1',
    clientRevision: 'revision-1',
    redirectUri: 'https://client.example.test/callback',
    scopes: ['openid'],
    resources: ['https://api.example.test/'],
    audience: ['api'],
    codeChallenge: 'a'.repeat(43),
    codeChallengeMethod: 'S256',
    resourceOwner: {
      id: 'identity:ory:human-1',
      kind: 'human',
      issuer: 'https://identity.example.test',
      subject: 'human-1',
    },
    resourceOwnerPrincipalId: 'principal:app:human-1',
    sessionId: 'session-human-1',
    authenticationMethod: 'ory:password',
    authorityRevision: 'authority-1',
    browserBindingDigest: 'browser-digest',
    csrfBindingDigest: 'csrf-digest',
    state: 'active',
    issuedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T00:10:00.000Z',
    version: 1,
  };
}

function projectionFrontier(
  sourceSequence: number,
  sourceAuthorityRevision: string,
): ApplicationIdentityProjectionFrontier {
  return {
    projection: 'application-authority',
    sourceAuthorityRevision,
    sourceSequence,
    projectedAt: `2026-07-29T00:00:0${sourceSequence}.000Z`,
    state: 'current',
  };
}
