// typecast-file-boundary: negative fixtures deliberately pass malformed erased values to the public validation boundary.
import {
  app,
  applicationGraphFor,
  defineApplicationProvider,
  defineApplicationProviderRuntime,
  TransactionalDatabase,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  createDocumentTransformerFixture,
  type DocumentTransformerFixture,
  isDocumentTransformerFixture,
} from './fixtures/provider-private-runtime';

const Installation = type({ profile: "'starter' | 'dedicated' | 'external'" });

describe('provider-private runtime authoring', () => {
  it('retains only exact Secret and database references in the public graph', () => {
    const application = app('document-transformer', {
      namespace: 'documents-system',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const Transformer = defineApplicationProvider<DocumentTransformerFixture>({
      interface: 'DocumentTransformer',
      version: 'v1',
      accepts: isDocumentTransformerFixture,
    }).named('primary');
    const Catalog = TransactionalDatabase.named('transformer-catalog');
    const profile = application.profile(application.installation.spec, 'profile');
    profile.provide(Catalog)
      .starter(() => TransactionalDatabase.postgres({ name: 'starter-catalog', namespace: 'documents-system' }))
      .dedicated(() => TransactionalDatabase.postgres({ name: 'dedicated-catalog', namespace: 'documents-system' }))
      .external(() => TransactionalDatabase.postgres({ name: 'external-catalog', namespace: 'documents-system' }))
      .exhaustive();
    const catalog = application.inject(Catalog);
    const remote = (variant: string) => defineApplicationProviderRuntime(Transformer, {
      implementation: 'remote',
      validate: isDocumentTransformerFixture,
      credentials: {
        accessToken: {
          secret: { apiVersion: 'v1', kind: 'Secret', name: `transformer-${variant}`, namespace: 'documents-system' },
          key: 'token',
        },
      },
      postgres: { catalog },
      construct: createDocumentTransformerFixture,
    });
    profile.provide(Transformer)
      .starter(() => remote('starter'))
      .dedicated(() => remote('dedicated'))
      .external(() => remote('external'))
      .exhaustive();

    const graph = applicationGraphFor(application.composition);
    const provider = graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'DocumentTransformer');
    expect(provider).toMatchObject({ config: { profile: { branches: expect.arrayContaining([
      expect.objectContaining({ variant: 'dedicated', privateRuntime: expect.objectContaining({
        credentials: [expect.objectContaining({ alias: 'accessToken', key: 'token' })],
        postgres: [expect.objectContaining({ alias: 'catalog' })],
      }) }),
    ]) } } });
    expect(JSON.stringify(graph)).not.toContain('dependency-secret-value');
  });

  it('rejects blank Secret keys and validators other than the token guard', () => {
    const Transformer = defineApplicationProvider<DocumentTransformerFixture>({
      interface: 'DocumentTransformerValidationFixture',
      version: 'v1',
      accepts: isDocumentTransformerFixture,
    }).named('primary');
    expect(() => defineApplicationProviderRuntime(Transformer, {
      implementation: 'remote',
      validate: isDocumentTransformerFixture,
      credentials: { accessToken: { secret: { apiVersion: 'v1', kind: 'Secret', name: 'transformer' }, key: ' ' } },
      construct: async () => ({ kind: 'remote', transform: async (input: string) => input }),
    })).toThrow('must reference one exact v1 Secret key');
    expect(() => defineApplicationProviderRuntime(Transformer, {
      implementation: 'remote',
      validate: ((candidate: unknown): candidate is DocumentTransformerFixture => isDocumentTransformerFixture(candidate)),
      construct: async () => ({ kind: 'remote', transform: async (input: string) => input }),
    })).toThrow('must be the exact accepts guard');
  });
});
