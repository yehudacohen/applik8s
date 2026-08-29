import type { ApplicationProviderPrivateRuntime } from '@applik8s/applik8s';

export interface DocumentTransformerFixture {
  readonly kind: 'local' | 'remote';
  transform(input: string): Promise<string>;
}

export function isDocumentTransformerFixture(
  candidate: unknown,
): candidate is DocumentTransformerFixture {
  return Boolean(
    candidate
    && typeof candidate === 'object'
    && ['local', 'remote'].includes(String(Reflect.get(candidate, 'kind')))
    && typeof Reflect.get(candidate, 'transform') === 'function',
  );
}

export function createDocumentTransformerFixture(
  runtime: ApplicationProviderPrivateRuntime<
    { readonly accessToken: unknown },
    { readonly catalog: unknown }
  >,
): DocumentTransformerFixture {
  return {
    kind: 'remote',
    transform: async (input: string) => {
      await runtime.postgres.catalog.sql.unsafe('select 1');
      return `${runtime.credentials.accessToken.length}:${input}`;
    },
  };
}
