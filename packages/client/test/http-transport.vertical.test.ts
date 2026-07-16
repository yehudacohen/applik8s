// typecast-file-boundary: Fetch doubles bridge DOM stream types while runtime protocol checks remain under test.
import { createHttpApplicationQueryTransport, queryInputKey } from '@applik8s/client';
import { describe, expect, it, vi } from 'vitest';

describe('browser-safe HTTP/SSE query transport', () => {
  it('validates snapshots and parses bounded CRLF SSE streams', async () => {
    const input = { setId: 'set-1' };
    const snapshot = { kind: 'snapshot', protocol: 'applik8s.query/v1alpha1', query: 'cards.v1', inputKey: queryInputKey(input), value: [{ id: 'card-1' }], cursor: 'cursor-1', capability: 'resumableInvalidation', generatedAt: '2026-07-15T00:00:00.000Z' } as const;
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith('/subscribe')) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: invalidate\r\ndata: {"kind":"invalidate","protocol":"applik8s.query/v1alpha1","id":"cards.v1:2","sequence":2,"query":"cards.v1","cursor":"cursor-2","models":["Card"]}\r\n\r\n')); controller.close(); } }), { status: 200 });
      return new Response(JSON.stringify(snapshot), { status: 200 });
    });
    const transport = createHttpApplicationQueryTransport({ baseUrl: 'https://catalog.test', fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(transport.snapshot('cards.v1', input)).resolves.toEqual(snapshot);
    const events: unknown[] = [];
    const errors: Error[] = [];
    await transport.subscribe('cards.v1', input, snapshot.cursor, { signal: new AbortController().signal, onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });
    expect(events).toEqual([expect.objectContaining({ kind: 'invalidate', cursor: 'cursor-2' })]);
    expect(errors[0]?.message).toContain('ended before cancellation');
  });

  it('fails closed for oversized or malformed protocol messages', async () => {
    const oversized = createHttpApplicationQueryTransport({ maxSnapshotBytes: 4, fetch: (async () => new Response('12345')) as unknown as typeof globalThis.fetch });
    await expect(oversized.snapshot('cards.v1', {})).rejects.toThrow('exceeded');
    const malformed = createHttpApplicationQueryTransport({ fetch: (async () => new Response(JSON.stringify({ kind: 'snapshot', query: 'cards.v1' }))) as unknown as typeof globalThis.fetch });
    await expect(malformed.snapshot('cards.v1', {})).rejects.toThrow('violates');
  });
});
