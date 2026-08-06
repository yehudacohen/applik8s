// typecast-file-boundary: Fetch doubles bridge DOM stream types while runtime protocol checks remain under test.
import {
  createHttpApplicationQueryTransport,
  createHttpApplicationRuntimeTransport,
  queryInputKey,
} from '@applik8s/client';
import { describe, expect, it, vi } from 'vitest';

describe('browser-safe HTTP/SSE query transport', () => {
  it('preserves the Window receiver when the default fetch implementation is captured', async () => {
    const originalFetch = globalThis.fetch;
    const snapshot = { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'cards.v1', inputKey: queryInputKey({}), value: [], cursor: 'cursor-1', capability: 'resumableInvalidation', generatedAt: '2026-07-15T00:00:00.000Z' } as const;
    globalThis.fetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify(snapshot), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;
    try {
      await expect(createHttpApplicationQueryTransport().snapshot('cards.v1', {})).resolves.toEqual(snapshot);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validates snapshots and parses bounded CRLF SSE streams', async () => {
    const input = { setId: 'set-1' };
    const snapshot = { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'cards.v1', inputKey: queryInputKey(input), value: [{ id: 'card-1' }], cursor: 'cursor-1', capability: 'resumableInvalidation', generatedAt: '2026-07-15T00:00:00.000Z' } as const;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/queries/multiplex')) {
        const body = JSON.parse(String(init?.body)) as { readonly subscriptions: readonly { readonly id: string }[] };
        const subscriptionId = body.subscriptions[0]?.id;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: message\r\ndata: {"protocol":"applik8s.query-multiplex/v1alpha1","kind":"event","subscriptionId":${JSON.stringify(subscriptionId)},"event":{"kind":"invalidate","protocol":"applik8s.query/v1alpha1","id":"cards.v1:2","sequence":2,"query":"cards.v1","cursor":"cursor-2","models":["Card"]}}\r\n\r\n`)); controller.close(); } }), { status: 200 });
      }
      return new Response(JSON.stringify(snapshot), { status: 200 });
    });
    const transport = createHttpApplicationQueryTransport({ baseUrl: 'https://catalog.test', fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(transport.snapshot('cards.v1', input)).resolves.toEqual(snapshot);
    const events: unknown[] = [];
    const errors: Error[] = [];
    transport.subscribe('cards.v1', input, snapshot.cursor, { signal: new AbortController().signal, onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });
    await settle();
    expect(events).toEqual([expect.objectContaining({ kind: 'invalidate', cursor: 'cursor-2' })]);
    expect(errors[0]?.message).toContain('ended before cancellation');
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/queries/multiplex'))).toHaveLength(1);
  });

  it('fails closed for oversized or malformed protocol messages', async () => {
    const oversized = createHttpApplicationQueryTransport({ maxSnapshotBytes: 4, fetch: (async () => new Response('12345')) as unknown as typeof globalThis.fetch });
    await expect(oversized.snapshot('cards.v1', {})).rejects.toThrow('exceeded');
    const malformed = createHttpApplicationQueryTransport({ fetch: (async () => new Response(JSON.stringify({ kind: 'snapshot', query: 'cards.v1' }))) as unknown as typeof globalThis.fetch });
    await expect(malformed.snapshot('cards.v1', {})).rejects.toThrow('violates');
  });

  it('coalesces concurrent logical query subscriptions onto one browser connection', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { readonly subscriptions: readonly { readonly id: string; readonly query: string }[] };
      const payload = body.subscriptions.map((subscription, index) => `data: ${JSON.stringify({
        protocol: 'applik8s.query-multiplex/v1alpha1',
        kind: 'event',
        subscriptionId: subscription.id,
        event: { kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: `${subscription.query}:${index + 1}`, sequence: index + 1, query: subscription.query, cursor: `cursor-${index + 1}`, models: ['Card'] },
      })}\n\n`).join('');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } }), { status: 200 });
    });
    const transport = createHttpApplicationQueryTransport({ baseUrl: 'https://catalog.test', fetch: fetch as unknown as typeof globalThis.fetch });
    const first: unknown[] = [];
    const second: unknown[] = [];
    transport.subscribe('cards.first.v1', {}, 'first-cursor', { signal: new AbortController().signal, onEvent: (event) => first.push(event), onError: () => undefined });
    transport.subscribe('cards.second.v1', {}, 'second-cursor', { signal: new AbortController().signal, onEvent: (event) => second.push(event), onError: () => undefined });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { readonly subscriptions: readonly unknown[] };
    expect(request.subscriptions).toHaveLength(2);
    expect(first).toEqual([expect.objectContaining({ query: 'cards.first.v1' })]);
    expect(second).toEqual([expect.objectContaining({ query: 'cards.second.v1' })]);
  });

  it('waits for physical SSE cancellation before opening a replacement connection', async () => {
    const cancellationGates: Array<{
      readonly started: Promise<void>;
      start(): void;
      release(): void;
      readonly completed: Promise<void>;
    }> = [];
    let activeConnections = 0;
    let maximumConnections = 0;
    const fetch = vi.fn(async () => {
      activeConnections += 1;
      maximumConnections = Math.max(maximumConnections, activeConnections);
      let startCancellation: (() => void) | undefined;
      let releaseCancellation: (() => void) | undefined;
      const started = new Promise<void>((resolve) => { startCancellation = resolve; });
      const completed = new Promise<void>((resolve) => { releaseCancellation = resolve; }).then(() => {
        activeConnections -= 1;
      });
      cancellationGates.push({
        started,
        start: () => startCancellation?.(),
        release: () => releaseCancellation?.(),
        completed,
      });
      const gate = cancellationGates.at(-1);
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          gate?.start();
          return gate?.completed;
        },
      }), { status: 200 });
    });
    const transport = createHttpApplicationQueryTransport({
      baseUrl: 'https://catalog.test',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const first = new AbortController();
    const second = new AbortController();
    transport.subscribe('cards.first.v1', {}, 'first-cursor', {
      signal: first.signal,
      onEvent: () => undefined,
      onError: () => undefined,
    });
    await waitFor(() => fetch.mock.calls.length === 1);

    transport.subscribe('cards.second.v1', {}, 'second-cursor', {
      signal: second.signal,
      onEvent: () => undefined,
      onError: () => undefined,
    });
    await cancellationGates[0]?.started;
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    cancellationGates[0]?.release();
    await waitFor(() => fetch.mock.calls.length === 2);
    expect(maximumConnections).toBe(1);

    first.abort();
    second.abort();
    await cancellationGates[1]?.started;
    cancellationGates[1]?.release();
    await cancellationGates[1]?.completed;
  });
});

describe('HTTP application runtime transport', () => {
  it('uses the canonical runtime envelope and supplies a per-invocation idempotency key', async () => {
    let request: Request | undefined;
    const transport = createHttpApplicationRuntimeTransport({
      baseUrl: 'https://application.test/__applik8s/v1',
      fetch: (async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({
          protocol: 'applik8s.runtime/v1alpha1',
          operation: 'applik8s://http/public-assistant/operations/ask',
          result: { answer: 'Hello' },
        }));
      }) as typeof globalThis.fetch,
    });
    await expect(transport.execute({
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: 'applik8s://http/public-assistant/operations/ask',
      model: 'public-assistant',
      name: 'ask',
      operation: 'custom',
      transport: 'runtime',
    }, { question: 'Hello?' })).resolves.toEqual({ answer: 'Hello' });
    expect(request?.url).toBe(
      'https://application.test/__applik8s/v1/runtime/applik8s%3A%2F%2Fhttp%2Fpublic-assistant%2Foperations%2Fask',
    );
    expect(request?.headers.get('idempotency-key')).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    await expect(request?.json()).resolves.toEqual({
      input: { question: 'Hello?' },
    });
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for HTTP transport state.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
