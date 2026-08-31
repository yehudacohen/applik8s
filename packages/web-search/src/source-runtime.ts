// typecast-file-boundary: configured deterministic fixtures and optional HTTP adapter results are validated by the source-retrieval provider contract.
import type {
  ApplicationRetrievedSource,
  ApplicationSourceRetrievalRequest,
} from './index.js';
import { LocalSourceRetriever } from './index.js';

let deterministicProvider: ReturnType<typeof LocalSourceRetriever.deterministic> | undefined;
let deterministicConfiguration: string | undefined;

/** @internal Managed-worker lowering for the selected SourceRetriever provider. */
export async function retrieveApplicationSource(
  input: ApplicationSourceRetrievalRequest,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationRetrievedSource> {
  const kind = environment.APPLIK8S_SOURCE_RETRIEVER_KIND ?? 'deterministic';
  if (kind === 'deterministic') {
    const provider = environment.APPLIK8S_SOURCE_RETRIEVER_PROVIDER ?? 'local-deterministic';
    const encoded = environment.APPLIK8S_SOURCE_RETRIEVER_FIXTURES ?? '[]';
    const configuration = `${provider}\0${encoded}`;
    const createProvider = () => LocalSourceRetriever.deterministic({
      provider,
      sources: parsedFixtures(encoded),
    });
    if (environment === process.env) {
      if (!deterministicProvider || deterministicConfiguration !== configuration) {
        deterministicConfiguration = configuration;
        deterministicProvider = createProvider();
      }
      return deterministicProvider.retrieve(input);
    }
    return createProvider().retrieve(input);
  }
  if (kind !== 'bounded-http') {
    throw new Error(`Managed source retriever kind ${JSON.stringify(kind)} is unsupported.`);
  }
  // static-import-exception: the Node HTTP adapter is optional and never loads for deterministic profiles.
  const { retrieveBoundedHttpSource } = await import(
    '@applik8s/web-retrieval-http/runtime'
  );
  return retrieveBoundedHttpSource(input, environment);
}

function parsedFixtures(encoded: string): readonly ApplicationRetrievedSource[] {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('APPLIK8S_SOURCE_RETRIEVER_FIXTURES must contain valid JSON.');
  }
  if (!Array.isArray(value)) throw new Error('APPLIK8S_SOURCE_RETRIEVER_FIXTURES must contain a JSON array.');
  return value as readonly ApplicationRetrievedSource[];
}
