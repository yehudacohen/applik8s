import { describe, expect, it } from 'vitest';
import { OryHttpTransport } from '../src/index.js';

describe('Ory HTTP transport', () => {
  it('bounds streaming response bodies before buffering them', async () => {
    const transport = new OryHttpTransport({
      maximumResponseBytes: 1024,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(800));
              controller.enqueue(new Uint8Array(800));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    });

    await expect(
      transport.request(new URL('http://ory.identity.svc/oversized')),
    ).rejects.toMatchObject({
      code: 'ORY_RESPONSE_INVALID',
      status: 200,
    });
  });

  it('keeps the deadline active while consuming the response body', async () => {
    const transport = new OryHttpTransport({
      timeoutMs: 100,
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => undefined);
            },
          }),
          { status: 200 },
        ),
    });

    await expect(
      transport.request(new URL('http://ory.identity.svc/stalled')),
    ).rejects.toMatchObject({ code: 'ORY_TIMEOUT' });
  });

  it('distinguishes caller cancellation from a provider timeout', async () => {
    const cancellation = new AbortController();
    const transport = new OryHttpTransport({
      timeoutMs: 1_000,
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => undefined);
            },
          }),
          { status: 200 },
        ),
    });
    setTimeout(() => cancellation.abort(new Error('caller stopped')), 10);

    await expect(
      transport.request(
        new URL('http://ory.identity.svc/cancelled'),
        { signal: cancellation.signal },
      ),
    ).rejects.toMatchObject({ code: 'ORY_CANCELLED' });
  });
});
