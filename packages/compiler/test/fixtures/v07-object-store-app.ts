import {
  app,
  IdentityProvider,
  ObjectStorage,
} from '@applik8s/applik8s';

const platform = app('object-store-proof', {
  namespace: 'object-store-proof',
});

platform.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: 'object-store-proof',
    subject: 'test',
    audience: ['object-store-proof'],
    catalogRevision: 'catalog-test',
    authorityRevision: 'authority-test',
  }),
);
platform.provide(
  ObjectStorage,
  ObjectStorage.s3({
    name: 'objects',
    bucket: 'object-store-proof',
    region: 'us-east-1',
    endpoint: 'https://objects.example.test',
    credentialsSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'object-store-proof',
      namespace: 'object-store-proof',
    },
    ownership: 'external',
  }),
);

export const ArtifactObjects = platform.objectStore('agentic-artifacts', {
  maxObjectBytes: 1_000_000,
  contentTypes: ['text/plain'],
  mode: 'immutable',
  browser: { upload: 'signed', download: 'signed' },
});

export const objectStoreProof = platform.composition;
