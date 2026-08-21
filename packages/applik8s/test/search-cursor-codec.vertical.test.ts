import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApplicationSearchCursorError,
  createApplicationSearchCursorCodec,
} from '../src/search-cursor-codec.js';

const secret = 'search-cursor-test-secret-with-at-least-32-bytes';
const now = Date.parse('2026-08-21T00:00:00.000Z');
const common = {
  logicalIndex: 'posts',
  indexRevision: 'search-v1',
  physicalGeneration: 'generation-2',
  checkpoint: 42,
  principalId: 'account-1',
  contextDigest: 'context-v1',
  authorizationVersion: 'authority-v3',
  queryDigest: 'query-v2',
} as const;

describe('shared application search cursor codec', () => {
  it('keeps the v0.8 Release-A writer readable by pre-v0.8 offset readers', async () => {
    const token = await createApplicationSearchCursorCodec({
      secret,
      now: () => now,
    }).encode({ ...common, continuation: { kind: 'offset', offset: 20 } });
    const [encodedPayload, encodedSignature] = token.split('.');
    const expected = createHmac('sha256', secret)
      .update(encodedPayload ?? '')
      .digest('base64url');

    expect(encodedSignature).toBe(expected);
    expect(JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'))).toMatchObject({
      protocol: 'applik8s.search-cursor/v1alpha1',
      ...common,
      offset: 20,
      issuedAt: now,
      expiresAt: now + 15 * 60 * 1_000,
    });
  });

  it('normalizes released offset and OpenSearch cursors behind one provider-neutral continuation', async () => {
    const offset = legacyToken({
      protocol: 'applik8s.search-cursor/v1alpha1',
      ...common,
      offset: 40,
    });
    const ordered = legacyToken({
      protocol: 'applik8s.opensearch-cursor/v1alpha1',
      ...common,
      searchAfter: [0.75, 'post-42'],
    });
    const codec = createApplicationSearchCursorCodec({ secret, now: () => now });

    await expect(codec.decode(offset, { ...common, continuationKind: 'offset' }))
      .resolves.toMatchObject({ continuation: { kind: 'offset', offset: 40 } });
    await expect(codec.decode(ordered, { ...common, continuationKind: 'orderedValues' }))
      .resolves.toMatchObject({
        continuation: { kind: 'orderedValues', values: [0.75, 'post-42'] },
      });
  });

  it('reads Signed Envelope v1 with the same semantics and rejects provider substitution', async () => {
    const codec = createApplicationSearchCursorCodec({
      secret,
      now: () => now,
      writer: 'v1',
    });
    const token = await codec.encode({
      ...common,
      continuation: { kind: 'orderedValues', values: [0.5, 'post-20'] },
    });

    await expect(codec.decode(token, { ...common, continuationKind: 'orderedValues' }))
      .resolves.toMatchObject({
        continuation: { kind: 'orderedValues', values: [0.5, 'post-20'] },
      });
    await expect(codec.decode(token, { ...common, continuationKind: 'offset' }))
      .rejects.toBeInstanceOf(ApplicationSearchCursorError);
  });

  it('fails closed for expiry, admitted-context drift, and tampering', async () => {
    const codec = createApplicationSearchCursorCodec({
      secret,
      now: () => now,
      lifetimeMs: 1_000,
    });
    const token = await codec.encode({
      ...common,
      continuation: { kind: 'offset', offset: 20 },
    });
    await expect(createApplicationSearchCursorCodec({
      secret,
      now: () => now + 1_001,
    }).decode(token, { ...common, continuationKind: 'offset' }))
      .rejects.toBeInstanceOf(ApplicationSearchCursorError);
    await expect(codec.decode(token, {
      ...common,
      contextDigest: 'different-context',
      continuationKind: 'offset',
    })).rejects.toBeInstanceOf(ApplicationSearchCursorError);
    await expect(codec.decode(`${token.slice(0, -1)}x`, {
      ...common,
      continuationKind: 'offset',
    })).rejects.toBeInstanceOf(ApplicationSearchCursorError);
  });
});

function legacyToken(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
