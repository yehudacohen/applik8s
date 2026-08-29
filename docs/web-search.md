# Web search

`@applik8s/web-search` is a small provider-neutral capability for bounded,
server-side retrieval. It deliberately does not own research policy, evidence
records, source trust, disclosure, citation, or accounting. Those remain part
of the application domain.

```ts
import { WebSearch } from '@applik8s/web-search';

const ResearchSearch = WebSearch.named('research');
const webSearch = application.inject(ResearchSearch);

export async function findPublicSources(query: string) {
  return webSearch.search({
    query,
    limit: 8,
    safeSearch: 'moderate',
    timeoutMs: 10_000,
  });
}
```

Profiles select implementations without changing that handler:

```ts
import { LocalWebSearch } from '@applik8s/web-search';
import { SearxngWebSearch } from '@applik8s/web-search-searxng';

deployment
  .provide(ResearchSearch)
  .starter(() => LocalWebSearch.deterministic())
  .developer(() => SearxngWebSearch.managed({
    name: 'research-search',
    namespace: 'research-search-system',
    secretKeyRef: { name: 'research-search-secret', key: 'secret_key' },
  }))
  .dedicated(() => SearxngWebSearch.managed({
    name: 'research-search',
    namespace: 'research-search-system',
    secretKeyRef: { name: 'research-search-secret', key: 'secret_key' },
    replicas: 3,
  }))
  .external(() => SearxngWebSearch.external({
    endpoint: 'https://search.example.com',
  }))
  .exhaustive();
```

The managed adapter contributes TypeKro's maintained `searxngBootstrap`
composition. The deployment graph contains only the Secret name and key;
plaintext secret material is never embedded in the application graph.
