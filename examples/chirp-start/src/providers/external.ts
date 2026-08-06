import { ContainerRegistry } from '@applik8s/applik8s';

export interface ExternalProviderInputs {
  readonly registry: { readonly origin: string; readonly repositoryPrefix: string; readonly pushSecretName: string; readonly pullSecretName: string };
  readonly objectStorage: { readonly endpoint: string; readonly bucket: string; readonly prefix: string; readonly region: string; readonly credentialsSecretName: string; readonly forcePathStyle: boolean };
  readonly database: { readonly database: string; readonly connectionSecretName: string; readonly connectionSecretKey: string };
  readonly analytics: { readonly endpoint: string; readonly database: string; readonly credentialsSecretName: string };
  readonly workflows: { readonly hostPort: string; readonly apiUrl: string; readonly workerTokenSecretName: string; readonly tls: boolean };
  readonly index: { readonly host: string; readonly port: number; readonly passwordSecretName: string; readonly passwordSecretKey: string };
  readonly generation: { readonly endpoint: string; readonly credentialsSecretName: string; readonly credentialKey: string; readonly authorization: 'bearer' | 'x-api-key'; readonly defaultProfile: string };
  readonly events: { readonly server: string; readonly stream?: string; readonly subjectPrefix?: string; readonly connectionSecretName?: string };
}

/**
 * The external profile proves that domain modules do not know provider vendors.
 * Real OIDC/Ory/Zitadel adapters can replace these semantic bindings without
 * changing a model, route, action, view, stream, or React component.
 */
export function externalInfrastructureProviders(namespace: string, inputs: ExternalProviderInputs) {
  return {
    registry: ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin(inputs.registry.origin),
      repositoryPrefix: inputs.registry.repositoryPrefix,
      pushCredentials: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: inputs.registry.pushSecretName,
        namespace,
        dockerConfigJsonKey: '.dockerconfigjson',
      },
      pullSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: inputs.registry.pullSecretName,
        namespace,
      },
    }),
    objects: inputs.objectStorage,
    database: inputs.database,
    analytics: inputs.analytics,
    workflows: inputs.workflows,
    index: inputs.index,
    generation: inputs.generation,
    events: inputs.events,
  };
}
