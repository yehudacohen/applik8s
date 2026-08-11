import { proxyApplicationQueryMultiplex } from '@applik8s/applik8s';
import { describe, expect, it, vi } from 'vitest';

describe('application-host query multiplex proxy', () => {
  it('coalesces subscriptions by owning gateway and merges their SSE frames', async () => {
    const socialBodies: unknown[] = [];
    const social = vi.fn(async (request: Request) => {
      socialBodies.push(await request.clone().json());
      return upstreamResponse(request);
    });
    const system = vi.fn(async (request: Request) => upstreamResponse(request));
    const response = await proxyApplicationQueryMultiplex(new Request('https://chirp.test/__applik8s/v1/queries/multiplex', {
      method: 'POST',
      headers: { 'content-length': '9999' },
      body: JSON.stringify({ subscriptions: [
        { id: 'home', query: 'Post.homeTimeline', input: {}, cursor: 'home-cursor' },
        { id: 'profile', query: 'Post.byAuthor', input: { authorId: 'viewer' }, cursor: 'profile-cursor' },
        { id: 'health', query: 'System.health', input: {}, cursor: 'health-cursor' },
      ] }),
    }), {
      resolve(query) {
        if (query.startsWith('Post.')) return { id: 'social', handle: social };
        if (query.startsWith('System.')) return { id: 'system', handle: system };
        return undefined;
      },
    });

    expect(response?.status).toBe(200);
    const body = await response?.text();
    expect(social).toHaveBeenCalledTimes(1);
    expect(system).toHaveBeenCalledTimes(1);
    const socialRequest = socialBodies[0];
    expect(socialRequest).toMatchObject({ subscriptions: expect.any(Array) });
    expect(Array.isArray(Reflect.get(Object(socialRequest), 'subscriptions')) ? Reflect.get(Object(socialRequest), 'subscriptions') : []).toHaveLength(2);
    expect(social.mock.calls[0]?.[0].headers.has('content-length')).toBe(false);
    expect(body).toContain('"subscriptionId":"home"');
    expect(body).toContain('"subscriptionId":"profile"');
    expect(body).toContain('"subscriptionId":"health"');
  });

  it('fails closed before opening upstream streams for unknown or excessive subscriptions', async () => {
    const target = vi.fn(async (request: Request) => upstreamResponse(request));
    const unknown = await proxyApplicationQueryMultiplex(requestFor([{ id: 'missing', query: 'Missing.query', input: {}, cursor: 'cursor' }]), {
      resolve: () => undefined,
    });
    expect(unknown?.status).toBe(404);
    expect(target).not.toHaveBeenCalled();

    const excessive = await proxyApplicationQueryMultiplex(requestFor([
      { id: 'one', query: 'Post.one', input: {}, cursor: 'one' },
      { id: 'two', query: 'Post.two', input: {}, cursor: 'two' },
    ]), { maxSubscriptions: 1, resolve: () => ({ id: 'social', handle: target }) });
    expect(excessive?.status).toBe(400);
    expect(target).not.toHaveBeenCalled();
  });

  it('treats browser disconnect cancellation as ordinary lifecycle, not an upstream failure', async () => {
    const requestAbort = new AbortController();
    const upstreamAbort = new Error('browser disconnected');
    upstreamAbort.name = 'AbortError';
    const onUpstreamError = vi.fn();
    const response = await proxyApplicationQueryMultiplex(
      new Request('https://chirp.test/__applik8s/v1/queries/multiplex', {
        method: 'POST',
        body: JSON.stringify({ subscriptions: [
          { id: 'notes', query: 'Note.list', input: {}, cursor: 'cursor' },
        ] }),
        signal: requestAbort.signal,
      }),
      {
        resolve: () => ({
          id: 'notes',
          async handle(request) {
            return new Response(new ReadableStream({
              start(controller) {
                request.signal.addEventListener(
                  'abort',
                  () => controller.error(upstreamAbort),
                  { once: true },
                );
              },
            }), { headers: { 'content-type': 'text/event-stream' } });
          },
        }),
        onUpstreamError,
      },
    );
    const read = response?.body?.getReader().read();
    requestAbort.abort();
    await expect(read).resolves.toMatchObject({ done: true });
    expect(onUpstreamError).not.toHaveBeenCalled();
  });
});

function requestFor(subscriptions: readonly unknown[]): Request {
  return new Request('https://chirp.test/__applik8s/v1/queries/multiplex', { method: 'POST', body: JSON.stringify({ subscriptions }) });
}

async function upstreamResponse(request: Request): Promise<Response> {
  const body: unknown = JSON.parse(await request.text());
  const subscriptions = body && typeof body === 'object' && !Array.isArray(body) ? Reflect.get(body, 'subscriptions') : undefined;
  if (!Array.isArray(subscriptions) || !subscriptions.every(isSubscription)) throw new Error('Upstream test request did not contain valid subscriptions.');
  const frames = subscriptions.map((subscription) => `data: ${JSON.stringify({
    protocol: 'applik8s.query-multiplex/v1alpha1',
    kind: 'event',
    subscriptionId: subscription.id,
    event: { kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', id: `${subscription.query}:1`, sequence: 1, query: subscription.query, cursor: 'next' },
  })}\n\n`).join('');
  return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function isSubscription(value: unknown): value is { readonly id: string; readonly query: string } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof Reflect.get(value, 'id') === 'string'
    && typeof Reflect.get(value, 'query') === 'string');
}
