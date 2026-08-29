import type {
  ApplicationWebSearchRequest,
  ApplicationWebSearchResponse,
  ApplicationWebSearchResult,
  NormalizedApplicationWebSearchRequest,
} from '@applik8s/web-search';
import {
  normalizeApplicationWebSearchRequest,
  normalizeApplicationWebSearchResults,
} from '@applik8s/web-search';

export interface SearxngApplicationWebSearchRuntimeOptions {
  readonly endpoint: string;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: () => Date;
}

interface SearxngResponse {
  readonly results?: readonly Record<string, unknown>[];
  readonly unresponsive_engines?: readonly unknown[];
}

export function createSearxngApplicationWebSearch(
  options: SearxngApplicationWebSearchRuntimeOptions,
): (input: ApplicationWebSearchRequest) => Promise<ApplicationWebSearchResponse> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('SearXNG web search requires a Fetch-compatible runtime.');
  }
  const configuredTimeoutMs = boundedInteger(options.timeoutMs ?? 10_000, 100, 30_000, 'SearXNG timeout');
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes ?? 2_000_000,
    1_024,
    8_000_000,
    'SearXNG maximum response bytes',
  );
  const clock = options.clock ?? (() => new Date());
  return async (input) => {
    const endpoint = runtimeEndpoint(options.endpoint);
    const request = normalizeApplicationWebSearchRequest(input);
    const timeoutMs = Math.min(request.timeoutMs, configuredTimeoutMs);
    const url = searchUrl(endpoint, request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`SearXNG search failed with HTTP ${response.status}.`);
      }
      const payload = parsedResponse(await boundedResponseText(response, maximumResponseBytes));
      const results = normalizeApplicationWebSearchResults(
        (payload.results ?? []).slice(0, request.limit).map(resultFromSearxng),
        request.limit,
      );
      return Object.freeze({
        query: request.query,
        provider: 'searxng',
        results,
        observedAt: clock().toISOString(),
        partial: (payload.unresponsive_engines?.length ?? 0) > 0,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`SearXNG search exceeded its ${timeoutMs}ms deadline.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function boundedResponseText(
  response: Response,
  maximumResponseBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    await response.body?.cancel();
    throw new Error(`SearXNG response exceeded ${maximumResponseBytes} bytes.`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) {
        await reader.cancel();
        throw new Error(`SearXNG response exceeded ${maximumResponseBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** @internal Optional-adapter entrypoint used by @applik8s/web-search/runtime. */
export async function searchSearxngApplicationWeb(
  input: ApplicationWebSearchRequest,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationWebSearchResponse> {
  return createSearxngApplicationWebSearch({
    endpoint: requiredEnvironment(environment, 'APPLIK8S_WEB_SEARCH_ENDPOINT'),
    timeoutMs: integerEnvironment(environment, 'APPLIK8S_WEB_SEARCH_TIMEOUT_MS', 100, 30_000),
    maximumResponseBytes: integerEnvironment(
      environment,
      'APPLIK8S_WEB_SEARCH_MAX_RESPONSE_BYTES',
      1_024,
      8_000_000,
    ),
  })(input);
}

function searchUrl(endpoint: URL, request: NormalizedApplicationWebSearchRequest): URL {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/search`;
  url.searchParams.set('q', request.query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('safesearch', request.safeSearch === 'off' ? '0' : request.safeSearch === 'moderate' ? '1' : '2');
  if (request.language) url.searchParams.set('language', request.language);
  if (request.timeRange) url.searchParams.set('time_range', request.timeRange);
  return url;
}

function resultFromSearxng(value: Record<string, unknown>): ApplicationWebSearchResult {
  const engines = Array.isArray(value.engines)
    ? value.engines.filter((engine): engine is string => typeof engine === 'string')
    : [];
  return {
    title: typeof value.title === 'string' ? value.title : '',
    url: typeof value.url === 'string' ? value.url : '',
    snippet: typeof value.content === 'string' ? value.content : '',
    ...(engines.length > 0 ? { source: engines.join(', ') } : {}),
    ...(typeof value.publishedDate === 'string' ? { publishedAt: value.publishedDate } : {}),
    ...(typeof value.score === 'number' ? { score: value.score } : {}),
  };
}

function parsedResponse(text: string): SearxngResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('SearXNG returned malformed JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SearXNG returned a malformed response object.');
  }
  // typecast: result fields remain unknown and are normalized field-by-field before leaving the adapter.
  return value as SearxngResponse;
}

function runtimeEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('SearXNG endpoint must be an absolute HTTP or HTTPS URL.');
  }
  if ((endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password) {
    throw new Error('SearXNG endpoint must be an uncredentialed HTTP or HTTPS URL.');
  }
  return endpoint;
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function integerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  minimum: number,
  maximum: number,
): number {
  return boundedInteger(Number(requiredEnvironment(environment, name)), minimum, maximum, name);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
