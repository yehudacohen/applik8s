import { defineApplicationProvider } from '@applik8s/applik8s';
import {
  applicationWebSearchProviderRuntime,
  bindApplicationWebSearchProviderRuntime,
} from './runtime-contract.js';

export type ApplicationWebSearchSafeSearch = 'off' | 'moderate' | 'strict';
export type ApplicationWebSearchTimeRange = 'day' | 'week' | 'month' | 'year';

export interface ApplicationWebSearchRequest {
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
    const implementation: ApplicationWebSearchProvider = {
      provider,
      kind: 'web-search-deterministic',
      mode: 'deterministic',
      async search(input: ApplicationWebSearchRequest) {
        const request = normalizeApplicationWebSearchRequest(input);
        return Object.freeze({
          query: request.query,
          provider,
          results: Object.freeze(fixtures.slice(0, request.limit)),
          observedAt: clock().toISOString(),
          partial: false,
        });
      },
    };
    return Object.freeze(bindApplicationWebSearchProviderRuntime(implementation, {
      env: {
        APPLIK8S_WEB_SEARCH_KIND: 'deterministic',
        APPLIK8S_WEB_SEARCH_PROVIDER: provider,
        APPLIK8S_WEB_SEARCH_FIXTURES: JSON.stringify(fixtures),
      },
    }));
  },
});

export interface NormalizedApplicationWebSearchRequest {
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
