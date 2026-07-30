import {
  ApplicationIdentityProjectionStaleError,
  MemoryApplicationIdentityProjectionFrontierStore,
} from '@applik8s/identity';
import { describe, expect, it, vi } from 'vitest';
import {
  OryKetoRelationshipProjection,
  OryOathkeeperAccessGateway,
} from '../src/index.js';

describe('Ory authorization projections', () => {
  it('advances Keto only after the complete relationship batch succeeds', async () => {
    const frontiers = new MemoryApplicationIdentityProjectionFrontierStore();
    const requests: Request[] = [];
    const projection = new OryKetoRelationshipProjection({
      readUrl: 'http://keto-read.identity.svc/',
      writeUrl: 'http://keto-write.identity.svc/',
      frontiers,
      clock: () => new Date('2026-07-29T00:00:00.000Z'),
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.includes('/check/')) return Response.json({ allowed: true });
        if (request.url.includes('/health/')) return Response.json({ status: 'ok' });
        return request.method === 'PUT'
          ? Response.json({}, { status: 201 })
          : new Response(null, { status: 204 });
      },
    });
    const tuple = {
      namespace: 'documents',
      object: 'document-1',
      relation: 'viewer',
      subject: 'identity-1',
    };

    await expect(projection.project({
      projection: 'application-authority',
      sourceAuthorityRevision: 'authority-2',
      sourceSequence: 2,
      changes: [
        { operation: 'put', tuple },
        { operation: 'delete', tuple: { ...tuple, subject: 'identity-old' } },
      ],
    })).resolves.toMatchObject({
      state: 'current',
      sourceAuthorityRevision: 'authority-2',
      sourceSequence: 2,
    });
    await expect(projection.check({
      projection: 'application-authority',
      requiredAuthorityRevision: 'authority-2',
      tuple,
    })).resolves.toMatchObject({ allowed: true });
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'PUT http://keto-write.identity.svc/admin/relation-tuples',
      'DELETE http://keto-write.identity.svc/admin/relation-tuples?namespace=documents&object=document-1&relation=viewer&subject_id=identity-old',
      'GET http://keto-read.identity.svc/health/ready',
      'GET http://keto-read.identity.svc/relation-tuples/check/openapi?namespace=documents&object=document-1&relation=viewer&subject_id=identity-1',
    ]);
  });

  it('fails closed before calling Keto when its projection revision is stale', async () => {
    const request = vi.fn(async () => Response.json({ allowed: true }));
    const projection = new OryKetoRelationshipProjection({
      readUrl: 'http://keto-read.identity.svc/',
      writeUrl: 'http://keto-write.identity.svc/',
      frontiers: new MemoryApplicationIdentityProjectionFrontierStore(),
      fetch: request,
    });

    await expect(projection.check({
      projection: 'application-authority',
      requiredAuthorityRevision: 'authority-2',
      tuple: {
        namespace: 'documents',
        object: 'document-1',
        relation: 'viewer',
        subject: 'identity-1',
      },
    })).rejects.toBeInstanceOf(ApplicationIdentityProjectionStaleError);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns only allowlisted Oathkeeper upstream headers at a current frontier', async () => {
    const frontiers = new MemoryApplicationIdentityProjectionFrontierStore();
    await frontiers.commit({
      projection: 'gateway-policy',
      sourceAuthorityRevision: 'authority-3',
      sourceSequence: 3,
      projectedAt: '2026-07-29T00:00:00.000Z',
      state: 'current',
    }, undefined);
    const gateway = new OryOathkeeperAccessGateway({
      decisionUrl: 'http://oathkeeper-api.identity.svc/',
      frontiers,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/health/')) return Response.json({ status: 'ok' });
        return Response.json(
          { rule: 'application-api', provider_detail: 'must-not-leak' },
          {
            headers: {
              'x-user': 'identity-1',
              'x-session-id': 'session-1',
              'x-provider-secret': 'private',
            },
          },
        );
      },
    });

    await expect(gateway.decide({
      request: new Request('https://application.example.test/private', {
        headers: { cookie: 'session=private', 'x-untrusted': 'browser' },
      }),
      projection: 'gateway-policy',
      requiredAuthorityRevision: 'authority-3',
    })).resolves.toMatchObject({
      allowed: true,
      upstreamHeaders: {
        'x-user': 'identity-1',
        'x-session-id': 'session-1',
      },
      evidence: { rule: 'application-api' },
    });
  });
});
