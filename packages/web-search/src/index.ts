import { defineApplicationProvider } from '@applik8s/applik8s';
import type { JsonObject } from '@applik8s/core';
import {
  applicationSourceRetrieverRuntime,
  applicationWebSearchProviderRuntime,
  bindApplicationSourceRetrieverRuntime,
  bindApplicationWebSearchProviderRuntime,
} from './runtime-contract.js';

export type ApplicationWebSearchSafeSearch = 'off' | 'moderate' | 'strict';
export type ApplicationWebSearchTimeRange = 'day' | 'week' | 'month' | 'year';

export interface ApplicationWebSearchRequest {
  /** Stable logical admission identity for this search across process retries. */
  readonly admissionId: string;
  /** Provider-visible idempotency identity scoped to the admitted research run. */
  readonly idempotencyKey: string;
  readonly query: string;
  readonly limit?: number;
  readonly language?: string;
  readonly safeSearch?: ApplicationWebSearchSafeSearch;
  readonly timeRange?: ApplicationWebSearchTimeRange;
  /** Overall provider deadline. Defaults to 10 seconds and is bounded to 30 seconds. */
  readonly timeoutMs?: number;
}

export interface ApplicationWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly source?: string;
  readonly publishedAt?: string;
  /** Provider-relative relevance value. It is not comparable across providers. */
  readonly score?: number;
}

export interface ApplicationWebSearchResponse {
  readonly query: string;
  readonly provider: string;
  readonly results: readonly ApplicationWebSearchResult[];
  readonly observedAt: string;
  readonly partial: boolean;
  /** Opaque normalized provider receipt; raw transport payloads never cross this boundary. */
  readonly receipt: JsonObject;
}

export interface ApplicationWebSearchProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  search(input: ApplicationWebSearchRequest): Promise<ApplicationWebSearchResponse>;
}

export const WebSearch =
  defineApplicationProvider<ApplicationWebSearchProvider>({
    interface: 'WebSearch',
    version: 'v1alpha1',
    description:
      'Provider-neutral, bounded server-side web retrieval with source provenance.',
    requirements: [
      'queries, result counts, response bytes, and deadlines are bounded',
      'every result identifies an absolute HTTP or HTTPS source URL',
      'provider credentials and raw transport responses never enter application output',
    ],
    guarantees: [
      'application policy and durable research evidence remain application-owned',
      'managed providers are replaceable without changing domain handlers',
      'provider cancellation and malformed responses fail closed',
    ],
    runtime: {
      operations: {
        search: {
          module: '@applik8s/web-search/runtime',
          export: 'searchApplicationWeb',
          access: {
            kind: 'provider',
            operations: ['network.connect'],
          },
        },
      },
      bind(implementation) {
        const runtime = applicationWebSearchProviderRuntime(implementation);
        if (!runtime) {
          throw new Error(
            `Web search provider ${implementation.kind} has no portable managed-worker runtime binding.`,
          );
        }
        return runtime;
      },
    },
    accepts(value): value is ApplicationWebSearchProvider {
      return Boolean(
        value
          && typeof value === 'object'
          && typeof Reflect.get(value, 'provider') === 'string'
          && typeof Reflect.get(value, 'kind') === 'string'
          && (Reflect.get(value, 'mode') === 'deterministic'
            || Reflect.get(value, 'mode') === 'live')
          && typeof Reflect.get(value, 'search') === 'function',
      );
    },
  });

export interface DeterministicWebSearchOptions {
  readonly results?: readonly ApplicationWebSearchResult[];
  /**
   * Exact, case-insensitive query fixtures. When supplied, an unlisted query
   * intentionally returns no results instead of leaking a fixture from an
   * unrelated query. This is the preferred shape for acceptance environments
   * that need to prove evidence-unavailable behavior.
   */
  readonly responsesByQuery?: Readonly<Record<string, readonly ApplicationWebSearchResult[]>>;
  readonly provider?: string;
  readonly clock?: () => Date;
}

export const LocalWebSearch = Object.freeze({
  deterministic(
    options: DeterministicWebSearchOptions = {},
  ): ApplicationWebSearchProvider {
    const provider = options.provider ?? 'local-deterministic';
    const clock = options.clock ?? (() => new Date(0));
    const fixtures = normalizeApplicationWebSearchResults(
      options.results ?? [],
      20,
    );
    const responsesByQuery = normalizeDeterministicWebSearchResponses(
      options.responsesByQuery,
    );
    const implementation: ApplicationWebSearchProvider = {
      provider,
      kind: 'web-search-deterministic',
      mode: 'deterministic',
      async search(input: ApplicationWebSearchRequest) {
        const request = normalizeApplicationWebSearchRequest(input);
        return Object.freeze({
          query: request.query,
          provider,
          results: Object.freeze(
            (responsesByQuery?.[normalizedDeterministicQuery(request.query)] ?? fixtures)
              .slice(0, request.limit),
          ),
          observedAt: clock().toISOString(),
          partial: false,
          receipt: Object.freeze({
            kind: 'deterministic-web-search',
            admissionId: request.admissionId,
            idempotencyKey: request.idempotencyKey,
          }),
        });
      },
    };
    return Object.freeze(bindApplicationWebSearchProviderRuntime(implementation, {
      env: {
        APPLIK8S_WEB_SEARCH_KIND: 'deterministic',
        APPLIK8S_WEB_SEARCH_PROVIDER: provider,
        APPLIK8S_WEB_SEARCH_FIXTURES: JSON.stringify(fixtures),
        ...(responsesByQuery
          ? { APPLIK8S_WEB_SEARCH_RESPONSES_BY_QUERY: JSON.stringify(responsesByQuery) }
          : {}),
      },
    }));
  },
});

function normalizedDeterministicQuery(query: string): string {
  return query.trim().toLocaleLowerCase('en-US');
}

function normalizeDeterministicWebSearchResponses(
  responses: DeterministicWebSearchOptions['responsesByQuery'],
): Readonly<Record<string, readonly ApplicationWebSearchResult[]>> | undefined {
  if (responses === undefined) return undefined;
  const normalized: Record<string, readonly ApplicationWebSearchResult[]> = {};
  for (const [query, results] of Object.entries(responses)) {
    const key = normalizedDeterministicQuery(query);
    if (key.length === 0) {
      throw new Error('Deterministic web search response queries must not be empty.');
    }
    if (Object.hasOwn(normalized, key)) {
      throw new Error(`Deterministic web search query ${JSON.stringify(query)} is duplicated after normalization.`);
    }
    normalized[key] = Object.freeze(normalizeApplicationWebSearchResults(results, 20));
  }
  return Object.freeze(normalized);
}

export interface NormalizedApplicationWebSearchRequest {
  readonly admissionId: string;
  readonly idempotencyKey: string;
  readonly query: string;
  readonly limit: number;
  readonly language?: string;
  readonly safeSearch: ApplicationWebSearchSafeSearch;
  readonly timeRange?: ApplicationWebSearchTimeRange;
  readonly timeoutMs: number;
}

export function normalizeApplicationWebSearchRequest(
  input: ApplicationWebSearchRequest,
): NormalizedApplicationWebSearchRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Web search input must be an object.');
  }
  const query = boundedText(input.query, 'Web search query', 1, 500);
  const admissionId = boundedText(input.admissionId, 'Web search admissionId', 1, 500);
  const idempotencyKey = boundedText(input.idempotencyKey, 'Web search idempotencyKey', 1, 500);
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Web search limit must be an integer between 1 and 20.');
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('Web search timeoutMs must be an integer between 100 and 30000.');
  }
  const safeSearch = input.safeSearch ?? 'moderate';
  if (!['off', 'moderate', 'strict'].includes(safeSearch)) {
    throw new Error('Web search safeSearch must be off, moderate, or strict.');
  }
  const language = input.language === undefined
    ? undefined
    : boundedText(input.language, 'Web search language', 2, 35);
  const timeRange = input.timeRange;
  if (timeRange !== undefined && !['day', 'week', 'month', 'year'].includes(timeRange)) {
    throw new Error('Web search timeRange must be day, week, month, or year.');
  }
  return Object.freeze({
    admissionId,
    idempotencyKey,
    query,
    limit,
    ...(language ? { language } : {}),
    safeSearch,
    ...(timeRange ? { timeRange } : {}),
    timeoutMs,
  });
}

export function normalizeApplicationWebSearchResults(
  values: readonly ApplicationWebSearchResult[],
  limit: number,
): readonly ApplicationWebSearchResult[] {
  if (!Array.isArray(values)) throw new Error('Web search results must be an array.');
  return Object.freeze(values.slice(0, limit).map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Web search result ${index} must be an object.`);
    }
    const url = absoluteHttpUrl(value.url, `Web search result ${index} URL`);
    const publishedAt = value.publishedAt;
    if (publishedAt !== undefined && Number.isNaN(Date.parse(publishedAt))) {
      throw new Error(`Web search result ${index} publishedAt must be an ISO-compatible timestamp.`);
    }
    if (value.score !== undefined && !Number.isFinite(value.score)) {
      throw new Error(`Web search result ${index} score must be finite.`);
    }
    return Object.freeze({
      title: boundedText(value.title, `Web search result ${index} title`, 1, 500),
      url,
      snippet: boundedText(value.snippet, `Web search result ${index} snippet`, 0, 4_000),
      ...(value.source
        ? { source: boundedText(value.source, `Web search result ${index} source`, 1, 200) }
        : {}),
      ...(publishedAt ? { publishedAt: new Date(publishedAt).toISOString() } : {}),
      ...(value.score !== undefined ? { score: value.score } : {}),
    });
  }));
}

function boundedText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} characters.`);
  }
  return normalized;
}

function absoluteHttpUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  url.username = '';
  url.password = '';
  return url.toString();
}

export { bindApplicationWebSearchProviderRuntime } from './runtime-contract.js';

export interface ApplicationSourceRetrievalRequest {
  /** Stable logical retrieval identity retained across retries. */
  readonly retrievalId: string;
  readonly idempotencyKey: string;
  readonly url: string;
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
  readonly acceptedContentTypes?: readonly string[];
}

export interface ApplicationRetrievedSource {
  readonly requestedUrl: string;
  readonly canonicalUrl: string;
  readonly mediaType: string;
  readonly title?: string;
  readonly text: string;
  readonly contentDigest: `sha256:${string}`;
  readonly sizeBytes: number;
  readonly retrievedAt: string;
  readonly provider: string;
  readonly receipt: {
    readonly retrievalId: string;
    readonly idempotencyKey: string;
    readonly redirects: readonly string[];
    readonly networkPolicy: string;
    readonly contentPolicy: string;
  };
}

export interface ApplicationSourceRetrieverProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  retrieve(input: ApplicationSourceRetrievalRequest): Promise<ApplicationRetrievedSource>;
}

export const SourceRetriever = defineApplicationProvider<ApplicationSourceRetrieverProvider>({
  interface: 'SourceRetriever',
  version: 'v1alpha1',
  description: 'Bounded retrieval of explicitly selected public web sources with content provenance.',
  requirements: [
    'search authority never implies source retrieval authority',
    'redirects, addresses, response bytes, time, and content types are bounded',
    'private, link-local, loopback, and cloud-metadata destinations fail closed',
  ],
  guarantees: [
    'retrieved source text remains untrusted application data',
    'every result carries a canonical URL and content digest',
    'provider transport payloads and credentials never enter the result',
  ],
  runtime: {
    operations: {
      retrieve: {
        module: '@applik8s/web-search/source-runtime',
        export: 'retrieveApplicationSource',
        access: { kind: 'provider', operations: ['network.connect'] },
      },
    },
    bind(implementation) {
      const runtime = applicationSourceRetrieverRuntime(implementation);
      if (!runtime) throw new Error(`Source retriever ${implementation.kind} has no portable managed-worker runtime binding.`);
      return runtime;
    },
  },
  accepts(value): value is ApplicationSourceRetrieverProvider {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof Reflect.get(value, 'provider') === 'string'
      && (Reflect.get(value, 'mode') === 'deterministic' || Reflect.get(value, 'mode') === 'live')
      && typeof Reflect.get(value, 'retrieve') === 'function',
    );
  },
});

export interface DeterministicSourceRetrieverOptions {
  readonly sources: readonly ApplicationRetrievedSource[];
  readonly provider?: string;
}

export const LocalSourceRetriever = Object.freeze({
  deterministic(options: DeterministicSourceRetrieverOptions): ApplicationSourceRetrieverProvider {
    const provider = options.provider ?? 'local-deterministic';
    const sources = new Map(options.sources.map((source) => {
      const normalized = normalizeApplicationRetrievedSource(source, provider);
      return [normalized.requestedUrl, normalized];
    }));
    const implementation: ApplicationSourceRetrieverProvider = {
      provider,
      kind: 'source-retriever-deterministic',
      mode: 'deterministic',
      async retrieve(input) {
        const request = normalizeApplicationSourceRetrievalRequest(input);
        const source = sources.get(request.url);
        if (!source) throw new Error(`Deterministic source retriever has no fixture for ${request.url}.`);
        return structuredClone({
          ...source,
          receipt: {
            ...source.receipt,
            retrievalId: request.retrievalId,
            idempotencyKey: request.idempotencyKey,
          },
        });
      },
    };
    return Object.freeze(bindApplicationSourceRetrieverRuntime(implementation, {
      env: {
        APPLIK8S_SOURCE_RETRIEVER_KIND: 'deterministic',
        APPLIK8S_SOURCE_RETRIEVER_PROVIDER: provider,
        APPLIK8S_SOURCE_RETRIEVER_FIXTURES: JSON.stringify([...sources.values()]),
      },
    }));
  },
});

export interface NormalizedApplicationSourceRetrievalRequest {
  readonly retrievalId: string;
  readonly idempotencyKey: string;
  readonly url: string;
  readonly timeoutMs: number;
  readonly maximumBytes: number;
  readonly acceptedContentTypes: readonly string[];
}

export function normalizeApplicationSourceRetrievalRequest(
  input: ApplicationSourceRetrievalRequest,
): NormalizedApplicationSourceRetrievalRequest {
  if (!input || typeof input !== 'object') throw new Error('Source retrieval input must be an object.');
  const retrievalId = boundedText(input.retrievalId, 'Source retrieval retrievalId', 1, 500);
  const idempotencyKey = boundedText(input.idempotencyKey, 'Source retrieval idempotencyKey', 1, 500);
  const url = absoluteHttpUrl(input.url, 'Source retrieval URL');
  const timeoutMs = input.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('Source retrieval timeoutMs must be an integer between 100 and 60000.');
  }
  const maximumBytes = input.maximumBytes ?? 2_000_000;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1_024 || maximumBytes > 8_000_000) {
    throw new Error('Source retrieval maximumBytes must be an integer between 1024 and 8000000.');
  }
  const acceptedContentTypes = Object.freeze([...(input.acceptedContentTypes ?? ['text/html', 'text/plain', 'application/xhtml+xml'])].map((value) => {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)) {
      throw new Error(`Source retrieval content type ${JSON.stringify(value)} is invalid.`);
    }
    return normalized;
  }));
  return Object.freeze({ retrievalId, idempotencyKey, url, timeoutMs, maximumBytes, acceptedContentTypes });
}

export function normalizeApplicationRetrievedSource(
  source: ApplicationRetrievedSource,
  provider = source.provider,
): ApplicationRetrievedSource {
  if (!source || typeof source !== 'object') throw new Error('Retrieved source must be an object.');
  if (!/^sha256:[a-f0-9]{64}$/u.test(source.contentDigest)) throw new Error('Retrieved source must carry a complete sha256 content digest.');
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 0 || source.sizeBytes > 8_000_000) throw new Error('Retrieved source sizeBytes is invalid.');
  if (Number.isNaN(Date.parse(source.retrievedAt))) throw new Error('Retrieved source retrievedAt must be an ISO-compatible timestamp.');
  const text = boundedText(source.text, 'Retrieved source text', 0, 8_000_000);
  return Object.freeze({
    requestedUrl: absoluteHttpUrl(source.requestedUrl, 'Retrieved source requestedUrl'),
    canonicalUrl: absoluteHttpUrl(source.canonicalUrl, 'Retrieved source canonicalUrl'),
    mediaType: boundedText(source.mediaType, 'Retrieved source mediaType', 1, 200).toLowerCase(),
    ...(source.title ? { title: boundedText(source.title, 'Retrieved source title', 1, 1_000) } : {}),
    text,
    contentDigest: source.contentDigest,
    sizeBytes: source.sizeBytes,
    retrievedAt: new Date(source.retrievedAt).toISOString(),
    provider: boundedText(provider, 'Retrieved source provider', 1, 200),
    receipt: Object.freeze({
      retrievalId: boundedText(source.receipt.retrievalId, 'Retrieved source receipt retrievalId', 1, 500),
      idempotencyKey: boundedText(source.receipt.idempotencyKey, 'Retrieved source receipt idempotencyKey', 1, 500),
      redirects: Object.freeze(source.receipt.redirects.map((url) => absoluteHttpUrl(url, 'Retrieved source redirect'))),
      networkPolicy: boundedText(source.receipt.networkPolicy, 'Retrieved source network policy', 1, 200),
      contentPolicy: boundedText(source.receipt.contentPolicy, 'Retrieved source content policy', 1, 200),
    }),
  });
}

export { bindApplicationSourceRetrieverRuntime } from './runtime-contract.js';
