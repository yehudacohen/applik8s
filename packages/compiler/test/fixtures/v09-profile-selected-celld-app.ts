import {
  ActorRuntime,
  app,
  ObjectStorage,
} from '@applik8s/applik8s';

const application = app('profile-selected-celld-proof', {
  namespace: 'profile-selected-celld-proof',
});

const state = ObjectStorage.s3({
  name: 'actor-state',
  bucket: 'profile-selected-celld-proof',
  region: 'us-east-1',
  endpoint: 'https://objects.example.test',
  credentialsSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'actor-state',
    namespace: 'profile-selected-celld-proof',
  },
  ownership: 'external',
});

application.provide(ObjectStorage, state);
application.profile('starter', (profile) => {
  profile.provide(
    ActorRuntime,
    ActorRuntime.celld({ replicas: 1, stateStore: state }),
  );
});

export const profileSelectedCelldProof = application.composition;
