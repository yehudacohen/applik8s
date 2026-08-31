import { describe, expect, it } from 'vitest';
import { app, applicationGraphFor } from '@applik8s/applik8s';
import { type } from 'arktype';
import {
  LocalWebSearch,
  LocalSourceRetriever,
  SourceRetriever,
  WebSearch,
  normalizeApplicationWebSearchRequest,
} from '../src/index.js';
import { searchApplicationWeb } from '../src/runtime.js';

describe('provider-neutral web search', () => {
  it('records qualified provider configuration and a static callable runtime', () => {
    const application = app('web-search-proof', {
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const ResearchSearch = WebSearch.named('research');
    application.provide(
      ResearchSearch,
      LocalWebSearch.deterministic({ provider: 'research-fixture' }),
    );
    const graph = applicationGraphFor(application);
    if (!graph) throw new Error('Expected the application graph to be recorded.');
    const node = graph.nodes.find(
      (candidate) => candidate.kind === 'provider' && candidate.interface === 'WebSearch',
    );
    expect(node).toMatchObject({
      kind: 'provider',
      implementation: 'web-search-deterministic',
      config: {
        webSearch: {
          provider: 'research-fixture',
          kind: 'web-search-deterministic',
          mode: 'deterministic',
        },
        callableRuntime: expect.any(Object),
      },
    });
  });

  it('provides a bounded deterministic capability with source provenance', async () => {
    const provider = LocalWebSearch.deterministic({
      results: [{
        title: 'Applik8s',
        url: 'https://example.test/applik8s',
        snippet: 'A provider-neutral result.',
        source: 'fixture',
      }],
    });
    expect(WebSearch.accepts?.(provider)).toBe(true);
    await expect(provider.search({ query: '  applik8s  ', limit: 1 })).resolves.toMatchObject({
      query: 'applik8s',
      provider: 'local-deterministic',
      partial: false,
      results: [{
        title: 'Applik8s',
        url: 'https://example.test/applik8s',
        source: 'fixture',
      }],
    });
  });

  it('fails closed on unbounded requests and unsafe result URLs', async () => {
    expect(() => normalizeApplicationWebSearchRequest({ query: 'x', limit: 21 })).toThrow(/between 1 and 20/u);
    expect(() => normalizeApplicationWebSearchRequest({ query: 'x', timeoutMs: 60_000 })).toThrow(/between 100 and 30000/u);
    expect(() => LocalWebSearch.deterministic({
      results: [{ title: 'unsafe', url: 'file:///etc/passwd', snippet: '' }],
    })).toThrow(/HTTP or HTTPS/u);
  });

  it('hydrates the deterministic implementation from its portable runtime binding', async () => {
    await expect(searchApplicationWeb({ query: 'runtime' }, {
      APPLIK8S_WEB_SEARCH_KIND: 'deterministic',
      APPLIK8S_WEB_SEARCH_PROVIDER: 'fixture-runtime',
      APPLIK8S_WEB_SEARCH_FIXTURES: JSON.stringify([{
        title: 'Runtime',
        url: 'https://example.test/runtime',
        snippet: 'Hydrated without authoring-time provider code.',
      }]),
    })).resolves.toMatchObject({
      provider: 'fixture-runtime',
      results: [{ title: 'Runtime' }],
    });
  });

  it('keeps search and selected-source retrieval as separately injected authorities', async () => {
    const source = {
      requestedUrl: 'https://example.test/source',
      canonicalUrl: 'https://example.test/source',
      mediaType: 'text/plain',
      title: 'Source',
      text: 'Untrusted source text.',
      contentDigest: `sha256:${'b'.repeat(64)}` as const,
      sizeBytes: 22,
      retrievedAt: new Date(0).toISOString(),
      provider: 'fixture',
      receipt: {
        redirects: [],
        networkPolicy: 'fixture',
        contentPolicy: 'fixture',
      },
    };
    const provider = LocalSourceRetriever.deterministic({ sources: [source] });
    expect(SourceRetriever.accepts?.(provider)).toBe(true);
    await expect(provider.retrieve({ url: source.requestedUrl })).resolves.toMatchObject({
      canonicalUrl: source.canonicalUrl,
      contentDigest: source.contentDigest,
      text: source.text,
    });

    const application = app('source-retriever-proof');
    application.provide(SourceRetriever.named('research'), provider);
    const graph = applicationGraphFor(application.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'SourceRetriever',
        config: expect.objectContaining({
          sourceRetriever: expect.objectContaining({
            kind: 'source-retriever-deterministic',
            mode: 'deterministic',
          }),
        }),
      }),
    ]));
  });
});
