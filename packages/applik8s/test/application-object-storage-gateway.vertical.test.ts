// typecast-file-boundary: Gateway tests construct protocol-boundary fakes and inspect validated response bodies as their expected contracts.
import { createHash, createHmac } from 'node:crypto';
import { type ApplicationObjectMetadata, type ApplicationObjectStorageRuntime, createApplicationFetchGateway, verifyApplicationObjectCompletionReceipt } from '@applik8s/applik8s';
import { canonicalJsonV1Value } from '@applik8s/core';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import { describe, expect, it, vi } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

describe('authenticated application object-storage gateway', () => {
  it('issues principal-scoped intents and verifies the complete upload/download path', async () => {
    const objects = new Map<string, ApplicationObjectMetadata & { readonly body: Uint8Array }>();
    const observations: unknown[] = [];
    const signUpload = vi.fn();
    const runtime: ApplicationObjectStorageRuntime = {
      async put(request) {
        const body = typeof request.body === 'string' ? new TextEncoder().encode(request.body) : request.body;
        const sha256 = createHash('sha256').update(body).digest('hex');
        const value = { store: 'attachments', key: request.key, size: body.byteLength, contentType: request.contentType, sha256, body };
        objects.set(request.key, value);
        return value;
      },
      async get(key) { return objects.get(key)?.body; },
      async head(key) { return objects.get(key); },
      async delete(key) { objects.delete(key); },
      signUpload,
      async signDownload() { throw new Error('native presigning must not be used by the same-origin gateway'); },
    };
    const gateway = createApplicationFetchGateway({
      identity: {
        kind: 'identity-provider',
        authenticate: (request) => {
          const id = request.headers.get('x-user');
          if (!id) throw new Error('missing identity');
          return testApplicationAdmission(id, { authorityRevision: 'policy-v1' });
        },
      },
      cursorSecret: 'object-intent-secret-that-is-at-least-thirty-two-bytes',
      observeAdmission: (observation) => { observations.push(observation); },
      objects: [{
        name: 'attachments', enabled: true, mode: 'immutable', maxObjectBytes: 32,
        contentTypes: ['text/plain'], browser: { upload: 'signed', download: 'signed', downloadAccess: 'owner', ttlSeconds: 600 }, runtime,
      }],
    });
    const body = new TextEncoder().encode('hello');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const intentResponse = await gateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.createUpload', {
      input: { contentType: 'text/plain', size: body.byteLength, sha256 },
    }, 'alice'));
    expect(intentResponse.status).toBe(200);
    expect(observations).toContainEqual({
      apiVersion: 'applik8s.admission-observation/v1',
      state: 'admitted',
      boundary: 'request',
      admissionVersion: 'applik8s.admission/v1',
      transport: 'http',
      compatibilityPath: 'canonical',
    });
    const intent = runtimeResult(await intentResponse.json());
    expect(intent).toMatchObject({ method: 'PUT', object: { store: 'attachments' } });
    expect(String(intent.object.key)).toMatch(/^[a-f0-9]{32}\/[0-9a-f-]+$/);
    expect(signUpload).not.toHaveBeenCalled();

    const legacyToken = new URL(String(intent.url)).searchParams.get('token') ?? '';
    const [legacyBody, legacySignature] = legacyToken.split('.');
    expect(legacySignature).toBe(
      createHmac('sha256', 'object-intent-secret-that-is-at-least-thirty-two-bytes')
        .update(legacyBody ?? '')
        .digest('base64url'),
    );
    const legacyPayload = JSON.parse(
      Buffer.from(legacyBody ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const expiresAt = Number(legacyPayload.expiresAt);
    const currentTime = expiresAt - 10 * 60_000;
    const v1Codec = createSignedEnvelopeCodec({
      purpose: 'applik8s.object-intent/v1',
      keys: staticSignedEnvelopeKeyProvider({
        current: {
          id: 'object-intent-current',
          key: signedEnvelopeUtf8Key('object-intent-secret-that-is-at-least-thirty-two-bytes'),
        },
      }),
      now: () => currentTime,
      maximumLifetimeMs: 10 * 60_000,
      validatePayload(value) { return value; },
    });
    const v1UploadToken = await v1Codec.sign(canonicalJsonV1Value(legacyPayload), {
      issuedAt: currentTime,
      expiresAt,
    });
    const v1UploadUrl = new URL(String(intent.url));
    v1UploadUrl.searchParams.set('token', v1UploadToken);

    const rejectedPrincipal = await gateway.handle(new Request(String(intent.url), { method: 'PUT', headers: { ...record(intent.headers), 'x-user': 'bob' }, body }));
    expect(rejectedPrincipal.status).toBe(401);
    const upload = await gateway.handle(new Request(v1UploadUrl, { method: 'PUT', headers: { ...record(intent.headers), 'x-user': 'alice' }, body }));
    expect(upload.status).toBe(201);

    const completion = await gateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.completeUpload', {
      input: { key: intent.object.key, contentType: 'text/plain', size: body.byteLength, sha256 },
    }, 'alice'));
    expect(completion.status).toBe(200);
    const completed = runtimeResult(await completion.json());
    expect(completed).toMatchObject({ key: intent.object.key, objectId: String(intent.object.key).split('/').at(-1), size: 5, contentType: 'text/plain', sha256 });
    await expect(verifyApplicationObjectCompletionReceipt({
      receipt: String(completed.receipt),
      secret: 'object-intent-secret-that-is-at-least-thirty-two-bytes',
      principalId: 'alice',
      authorizationVersion: 'policy-v1',
      store: 'attachments',
      objectId: String(completed.objectId),
      key: String(completed.key),
      contentType: String(completed.contentType),
      size: Number(completed.size),
      sha256: String(completed.sha256),
    })).resolves.toBe(true);
    await expect(verifyApplicationObjectCompletionReceipt({
      receipt: String(completed.receipt),
      secret: 'object-intent-secret-that-is-at-least-thirty-two-bytes',
      principalId: 'bob',
      authorizationVersion: 'policy-v1',
      store: 'attachments',
      objectId: String(completed.objectId),
      key: String(completed.key),
      contentType: String(completed.contentType),
      size: Number(completed.size),
      sha256: String(completed.sha256),
    })).resolves.toBe(false);

    const completionPayload = JSON.parse(
      Buffer.from(String(completed.receipt).split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const completionExpiresAt = Number(completionPayload.expiresAt);
    const v1Receipt = await v1Codec.sign(canonicalJsonV1Value(completionPayload), {
      issuedAt: completionExpiresAt - 10 * 60_000,
      expiresAt: completionExpiresAt,
    });
    await expect(verifyApplicationObjectCompletionReceipt({
      receipt: v1Receipt,
      secret: 'object-intent-secret-that-is-at-least-thirty-two-bytes',
      principalId: 'alice',
      authorizationVersion: 'policy-v1',
      store: 'attachments',
      objectId: String(completed.objectId),
      key: String(completed.key),
      contentType: String(completed.contentType),
      size: Number(completed.size),
      sha256: String(completed.sha256),
    })).resolves.toBe(true);

    const downloadIntentResponse = await gateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.createDownload', {
      input: { key: intent.object.key },
    }, 'alice'));
    const downloadIntent = runtimeResult(await downloadIntentResponse.json());
    const download = await gateway.handle(new Request(String(downloadIntent.url), { headers: { 'x-user': 'alice' } }));
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('hello');

    const publicGateway = createApplicationFetchGateway({
      identity: {
        kind: 'identity-provider',
        authenticate: (request) => {
          const id = request.headers.get('x-user');
          if (!id) throw new Error('missing identity');
          return testApplicationAdmission(id, { authorityRevision: 'policy-v1' });
        },
      },
      cursorSecret: 'object-intent-secret-that-is-at-least-thirty-two-bytes',
      objects: [{
        name: 'attachments', enabled: true, mode: 'immutable', maxObjectBytes: 32,
        contentTypes: ['text/plain'], browser: { upload: 'signed', download: 'signed', downloadAccess: 'authenticated', ttlSeconds: 600 }, runtime,
      }],
    });
    const readerIntentResponse = await publicGateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.createDownload', {
      input: { key: intent.object.key },
    }, 'bob'));
    expect(readerIntentResponse.status).toBe(200);
    const readerIntent = runtimeResult(await readerIntentResponse.json());
    expect((await publicGateway.handle(new Request(String(readerIntent.url), { headers: { 'x-user': 'alice' } }))).status).toBe(401);
    const readerDownload = await publicGateway.handle(new Request(String(readerIntent.url), { headers: { 'x-user': 'bob' } }));
    expect(readerDownload.status).toBe(200);
    expect(await readerDownload.text()).toBe('hello');
    await publicGateway.close();
    await gateway.close();
  });

  it('rejects tampering, unbounded declarations, and content that does not match the signed digest', async () => {
    const put = vi.fn();
    const runtime: ApplicationObjectStorageRuntime = {
      put,
      async get() { return undefined; }, async head() { return undefined; }, async delete() {},
      async signUpload() { throw new Error('unused'); }, async signDownload() { throw new Error('unused'); },
    };
    const gateway = createApplicationFetchGateway({
      identity: { kind: 'identity-provider', authenticate: () => testApplicationAdmission('alice', { authorityRevision: 'v1' }) },
      cursorSecret: 'another-object-intent-secret-with-sufficient-entropy',
      objects: [{ name: 'attachments', mode: 'immutable', maxObjectBytes: 5, contentTypes: ['text/plain'], browser: { upload: 'signed', download: 'none', downloadAccess: 'owner', ttlSeconds: 60 }, runtime }],
    });
    const oversized = await gateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.createUpload', {
      input: { contentType: 'text/plain', size: 6, sha256: 'a'.repeat(64) },
    }, 'alice'));
    expect(oversized.status).toBe(400);

    const intentResponse = await gateway.handle(jsonRequest('/__applik8s/v1/runtime/objectStore.attachments.createUpload', {
      input: { contentType: 'text/plain', size: 5, sha256: createHash('sha256').update('hello').digest('hex') },
    }, 'alice'));
    const intent = runtimeResult(await intentResponse.json());
    const tampered = new URL(String(intent.url));
    tampered.searchParams.set('token', `${tampered.searchParams.get('token')}x`);
    expect((await gateway.handle(new Request(tampered, { method: 'PUT', headers: record(intent.headers), body: 'hello' }))).status).toBe(401);
    expect((await gateway.handle(new Request(String(intent.url), { method: 'PUT', headers: record(intent.headers), body: 'wrong' }))).status).toBe(409);
    expect(put).not.toHaveBeenCalled();
    await gateway.close();
  });
});

function jsonRequest(path: string, body: unknown, user: string): Request {
  return new Request(`https://chirp.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify(body),
  });
}

function runtimeResult(value: unknown): { readonly method?: string; readonly url: string; readonly headers: unknown; readonly object: { readonly key: string }; readonly key?: string; readonly objectId?: string; readonly size?: number; readonly contentType?: string; readonly sha256?: string; readonly receipt?: string } {
  if (!value || typeof value !== 'object' || !Reflect.get(value, 'result') || typeof Reflect.get(value, 'result') !== 'object') throw new Error('missing runtime result');
  return Reflect.get(value, 'result') as ReturnType<typeof runtimeResult>;
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
