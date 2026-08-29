import type {
  ApplicationWebSearchRequest,
  ApplicationWebSearchResponse,
  ApplicationWebSearchResult,
} from './index.js';
import {
  LocalWebSearch,
  normalizeApplicationWebSearchResults,
} from './index.js';

let deterministicProvider: ReturnType<typeof LocalWebSearch.deterministic> | undefined;
let deterministicConfiguration: string | undefined;

/** @internal Managed-worker lowering for the selected WebSearch provider. */
export async function searchApplicationWeb(
  input: ApplicationWebSearchRequest,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationWebSearchResponse> {
  const kind = environment.APPLIK8S_WEB_SEARCH_KIND ?? 'deterministic';
  if (kind === 'deterministic') {
    const provider = environment.APPLIK8S_WEB_SEARCH_PROVIDER ?? 'local-deterministic';
    const encoded = environment.APPLIK8S_WEB_SEARCH_FIXTURES ?? '[]';
    const configuration = `${provider}\0${encoded}`;
    const createProvider = () => LocalWebSearch.deterministic({
      provider,
      results: normalizeApplicationWebSearchResults(
        parsedFixtures(encoded),
        20,
      ),
    });
    if (environment === process.env) {
      if (!deterministicProvider || deterministicConfiguration !== configuration) {
        deterministicConfiguration = configuration;
        deterministicProvider = createProvider();
      }
      return deterministicProvider.search(input);
    }
    return createProvider().search(input);
  }
  if (kind !== 'searxng') {
    throw new Error(`Managed web search kind ${JSON.stringify(kind)} is unsupported.`);
  }
  // static-import-exception: SearXNG is an optional provider package and must not load for deterministic profiles.
  const { searchSearxngApplicationWeb } = await import(
    '@applik8s/web-search-searxng/runtime'
  );
  return searchSearxngApplicationWeb(input, environment);
}

function parsedFixtures(encoded: string): readonly ApplicationWebSearchResult[] {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('APPLIK8S_WEB_SEARCH_FIXTURES must contain valid JSON.');
  }
  if (!Array.isArray(value)) {
    throw new Error('APPLIK8S_WEB_SEARCH_FIXTURES must contain a JSON array.');
  }
  // typecast: individual fixture fields are validated by the provider constructor immediately after parsing.
  return value as readonly ApplicationWebSearchResult[];
}
