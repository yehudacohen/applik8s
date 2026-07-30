import {
  DEFAULT_NACK_VERSION,
  DEFAULT_NATS_REPOSITORY_NAME,
  DEFAULT_NATS_REPOSITORY_URL,
  DEFAULT_NATS_VERSION,
  natsHelmRelease,
  natsHelmRepository,
} from 'typekro/nats';

import { graphResourceId } from './application-identifiers.js';
import type { ApplicationEventLogProvider } from './application-providers.js';
import { applicationTypeKroGreaterThan, applicationTypeKroString, applicationTypeKroValueIdentity } from './application-typekro-values.js';

export interface ApplicationEventLogResourceState {
  readonly emittedEventLogs: Set<string>;
}

/** Materialize the complete app-owned NATS server + NACK prerequisite chain. */
export function emitApplicationEventLogResources(
  state: ApplicationEventLogResourceState,
  provider: ApplicationEventLogProvider,
): void {
  if (provider.provision === false) return;
  const name = provider.name ?? 'applik8s-events';
  // TypeKro schema refs copied into nested Flux sourceRef objects otherwise
  // serialize as `{}`. A CEL string survives both direct resource metadata and
  // every nested chart reference.
  const namespace = applicationTypeKroString(provider.namespace ?? 'default');
  const key = `${applicationTypeKroValueIdentity(namespace)}:${name}`;
  if (state.emittedEventLogs.has(key)) return;
  state.emittedEventLogs.add(key);

  natsHelmRepository({
    id: graphResourceId(name, 'natsHelmRepository'),
    name: DEFAULT_NATS_REPOSITORY_NAME,
    namespace,
    url: DEFAULT_NATS_REPOSITORY_URL,
  });
  natsHelmRelease({
    id: graphResourceId(name, 'natsHelmRelease'),
    name,
    namespace,
    chart: 'nats',
    version: DEFAULT_NATS_VERSION,
    repositoryName: DEFAULT_NATS_REPOSITORY_NAME,
    repositoryNamespace: namespace,
    values: {
      fullnameOverride: name,
      config: {
        cluster: { enabled: applicationTypeKroGreaterThan(provider.replicas ?? 1, 1), replicas: provider.replicas ?? 1 },
        jetstream: {
          enabled: true,
          fileStore: {
            enabled: true,
            pvc: {
              enabled: true,
              size: provider.storageSize ?? '10Gi',
              ...(provider.storageClassName
                ? { storageClassName: provider.storageClassName }
                : {}),
            },
          },
        },
      },
      natsBox: { enabled: true },
      // The NATS chart merges this object at the StatefulSet root. Kubernetes
      // owns persistentVolumeClaimRetentionPolicy under StatefulSet.spec.
      statefulSet: { merge: { spec: { persistentVolumeClaimRetentionPolicy: { whenDeleted: 'Retain', whenScaled: 'Retain' } } } },
    },
  });
  natsHelmRelease({
    id: graphResourceId(name, 'nackHelmRelease'),
    name: 'nack',
    namespace,
    chart: 'nack',
    version: DEFAULT_NACK_VERSION,
    repositoryName: DEFAULT_NATS_REPOSITORY_NAME,
    repositoryNamespace: namespace,
    values: {
      jetstream: {
        enabled: true,
        nats: { url: applicationTypeKroString('nats://', name, '.', namespace, '.svc:4222') },
        controlLoop: true,
      },
      namespaced: false,
    },
  });
}
