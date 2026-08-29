import { describe, expect, it, vi } from 'vitest';
import { SearxngWebSearch } from '../src/index.js';
import { createSearxngApplicationWebSearch } from '../src/runtime.js';

describe('SearXNG web-search adapter', () => {
  it('normalizes provider output and preserves bounded provenance', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('durable actors');
      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('safesearch')).toBe('2');
      return new Response(JSON.stringify({
        results: [{
          title: 'Durable actors',
          url: 'https://example.test/actors',
          content: 'A bounded result.',
          engines: ['brave', 'duckduckgo'],
          score: 0.9,
        }],
        unresponsive_engines: ['wikipedia'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    // typecast: Vitest's callable mock lacks Bun's non-standard fetch.preconnect property but implements the invoked Fetch subset.
    const search = createSearxngApplicationWebSearch({
      endpoint: 'http://searxng.test',
      fetch: fetch as unknown as typeof globalThis.fetch, // typecast: mock implements the invoked Fetch subset.
      clock: () => new Date('2026-08-29T00:00:00.000Z'),
    });
    await expect(search({ query: 'durable actors', safeSearch: 'strict' })).resolves.toEqual({
      query: 'durable actors',
      provider: 'searxng',
      results: [{
        title: 'Durable actors',
        url: 'https://example.test/actors',
        snippet: 'A bounded result.',
        source: 'brave, duckduckgo',
        score: 0.9,
      }],
      observedAt: '2026-08-29T00:00:00.000Z',
      partial: true,
    });
  });

  it('enforces cancellation deadlines and response-size limits', async () => {
    const hangingFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
    // typecast: the deadline fixture implements the invoked Fetch subset and deliberately never produces a response.
    const timed = createSearxngApplicationWebSearch({
      endpoint: 'http://searxng.test',
      timeoutMs: 100,
      fetch: hangingFetch as unknown as typeof globalThis.fetch, // typecast: mock implements the invoked Fetch subset.
    });
    await expect(timed({ query: 'deadline', timeoutMs: 100 })).rejects.toThrow(/100ms deadline/u);

    // typecast: the response-size fixture implements the invoked Fetch subset; Bun's fetch.preconnect extension is irrelevant.
    const oversized = createSearxngApplicationWebSearch({
      endpoint: 'http://searxng.test',
      maximumResponseBytes: 1_024,
      fetch: (async () => new Response(JSON.stringify({ payload: 'x'.repeat(2_000) }))) as unknown as typeof globalThis.fetch, // typecast: fixture implements the invoked Fetch subset.
    });
    await expect(oversized({ query: 'bounded' })).rejects.toThrow(/exceeded 1024 bytes/u);
  });

  it('keeps managed topology reference-only and external transport fail-closed', () => {
    expect(SearxngWebSearch.managed({
      name: 'research-search',
      namespace: 'research-search-system',
      secretKeyRef: { name: 'research-search-secret' },
    })).toMatchObject({
      provider: 'searxng',
      kind: 'searxng',
      deployment: {
        management: 'typekro',
        secretKeyRef: { name: 'research-search-secret' },
      },
    });
    expect(() => SearxngWebSearch.external({ endpoint: 'http://search.example.test' })).toThrow(/require HTTPS/u);
    expect(SearxngWebSearch.external({
      endpoint: 'http://search.example.test',
      allowInsecureHttp: true,
    })).toMatchObject({ deployment: { management: 'external' } });
  });
});
