import type { AnyKubernetesObject, ObjectMeta } from '@applik8s/core';
import { celldHealthPath } from './compatibility.js';
import {
  type CelldFleetSpec,
  celldFleetFingerprintAnnotation,
  celldFleetLabel,
  celldFleetUidLabel,
  celldRuntimeSecretV1,
  gcsCredentialsSecretV1,
  s3CredentialsSecretV1,
} from './contracts.js';

export interface CelldFleetIdentity {
  readonly name: string;
  readonly namespace: string;
  readonly uid: string;
  readonly generation: number;
}

export interface RenderCelldFleetChildrenOptions {
  readonly identity: CelldFleetIdentity;
  readonly spec: CelldFleetSpec;
  readonly fingerprint: string;
  readonly rolloutPartition: number;
}

export interface CelldFleetChildren {
  readonly serviceAccount: AnyKubernetesObject;
  readonly peerService: AnyKubernetesObject;
  readonly clientService: AnyKubernetesObject;
  readonly deploymentJob: AnyKubernetesObject;
  readonly statefulSet: AnyKubernetesObject;
  readonly networkPolicy: AnyKubernetesObject;
  readonly podDisruptionBudget: AnyKubernetesObject;
  readonly all: readonly AnyKubernetesObject[];
}

export function renderCelldFleetChildren(options: RenderCelldFleetChildrenOptions): CelldFleetChildren {
  const { identity, spec } = options;
  const labels = fleetLabels(identity);
  const deploymentJobLabels = { ...labels, 'app.kubernetes.io/component': 'actor-deployer' };
  const metadata = (name: string, resourceLabels: Readonly<Record<string, string>> = labels): ObjectMeta => ({
    name,
    namespace: identity.namespace,
    labels: resourceLabels,
    annotations: { [celldFleetFingerprintAnnotation]: options.fingerprint },
    ownerReferences: [{
      apiVersion: 'celld.applik8s.io/v1alpha1',
      kind: 'CelldFleet',
      name: identity.name,
      uid: identity.uid,
      controller: true,
      blockOwnerDeletion: true,
    }],
  });
  const serviceAccountName = spec.objectStore.credentials.type === 'workloadIdentity'
    ? requiredWorkloadIdentityServiceAccount(spec)
    : `${identity.name}-celld`;
  const peerServiceName = `${identity.name}-peers`;
  const storageEnvironment = objectStoreEnvironment(spec);
  const runtimeEnvironment = [
    envSecret('CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION', spec.runtimeSecretRef.name, celldRuntimeSecretV1.keys.actorAuthorization),
    envSecret('CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION', spec.runtimeSecretRef.name, celldRuntimeSecretV1.keys.applicationAuthorization),
    envSecret('CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY', spec.runtimeSecretRef.name, celldRuntimeSecretV1.keys.connectionSigningKey),
    envSecret('CELLD_VAR_APPLIK8S_ACTOR_OPERATOR_AUTHORIZATION', spec.runtimeSecretRef.name, celldRuntimeSecretV1.keys.operatorAuthorization),
    { name: 'CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_ENDPOINT', value: spec.applicationEndpoint },
  ];
  const serviceAccount: AnyKubernetesObject = {
    apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(serviceAccountName),
    automountServiceAccountToken: spec.objectStore.credentials.type === 'workloadIdentity',
  };
  const peerService: AnyKubernetesObject = {
    apiVersion: 'v1', kind: 'Service', metadata: metadata(peerServiceName),
    spec: { clusterIP: 'None', publishNotReadyAddresses: true, selector: labels, ports: [{ name: 'celld-peer', port: 8081, targetPort: 'celld-peer' }] },
  };
  const clientService: AnyKubernetesObject = {
    apiVersion: 'v1', kind: 'Service', metadata: metadata(identity.name),
    spec: { type: 'ClusterIP', selector: labels, ports: [{ name: 'http', port: 8080, targetPort: 'celld' }] },
  };
  const deploymentJob: AnyKubernetesObject = {
    apiVersion: 'batch/v1', kind: 'Job', metadata: {
      ...metadata(celldDeploymentJobName(identity.name, spec.artifact.manifestDigest), deploymentJobLabels),
      // The deployment receipt is artifact-scoped, not fleet-generation
      // scoped. Replica and placement updates must not mutate a completed
      // Job's immutable pod template. If an actual deployment input changes,
      // the reconciler detects the desired-template difference and performs a
      // delete-before-create replacement.
      annotations: { [celldFleetFingerprintAnnotation]: spec.artifact.manifestDigest },
    },
    spec: {
      backoffLimit: 4,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: deploymentJobLabels, annotations: { [celldFleetFingerprintAnnotation]: spec.artifact.manifestDigest } },
        spec: {
          restartPolicy: 'OnFailure', serviceAccountName, automountServiceAccountToken: false,
          containers: [{
            name: 'deploy', image: spec.artifact.image, imagePullPolicy: 'IfNotPresent', command: ['celld'],
            args: ['deploy', '/app', '--bucket', bucketUrl(spec), ...(spec.objectStore.endpoint ? ['--endpoint', spec.objectStore.endpoint] : []), ...(spec.objectStore.region ? ['--region', spec.objectStore.region] : [])],
            env: [...storageEnvironment, ...runtimeEnvironment],
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
            resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '1', memory: '1Gi' } },
          }],
        },
      },
    },
  };
  const statefulSet: AnyKubernetesObject = {
    apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: metadata(identity.name),
    spec: {
      replicas: spec.replicas,
      serviceName: peerServiceName,
      podManagementPolicy: 'Parallel',
      updateStrategy: spec.rollout.strategy === 'Recreate'
        ? { type: 'OnDelete' }
        : { type: 'RollingUpdate', rollingUpdate: { partition: options.rolloutPartition } },
      selector: { matchLabels: labels },
      template: {
        metadata: {
          labels,
          annotations: {
            [celldFleetFingerprintAnnotation]: options.fingerprint,
            'celld.applik8s.io/artifact-manifest-digest': spec.artifact.manifestDigest,
            'celld.applik8s.io/worker-version': spec.artifact.workerVersion,
            'celld.applik8s.io/celld-version': spec.artifact.celldVersion,
          },
        },
        spec: {
          serviceAccountName,
          automountServiceAccountToken: spec.objectStore.credentials.type === 'workloadIdentity',
          terminationGracePeriodSeconds: spec.rollout.drainDeadlineSeconds,
          securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, fsGroupChangePolicy: 'OnRootMismatch', seccompProfile: { type: 'RuntimeDefault' } },
          topologySpreadConstraints: [{
            maxSkew: 1,
            topologyKey: spec.placement?.topologyKey ?? 'kubernetes.io/hostname',
            whenUnsatisfiable: 'DoNotSchedule',
            labelSelector: { matchLabels: labels },
          }],
          containers: [{
            name: 'celld', image: spec.artifact.image, imagePullPolicy: 'IfNotPresent', command: ['celld'],
            args: ['--bucket', bucketUrl(spec), '--listen', '0.0.0.0:8080', '--internal-listen', '0.0.0.0:8081', ...(spec.objectStore.endpoint ? ['--endpoint', spec.objectStore.endpoint] : []), ...(spec.objectStore.region ? ['--region', spec.objectStore.region] : [])],
            env: [
              ...storageEnvironment, ...runtimeEnvironment,
              { name: 'CELLD_ADDR', value: '0.0.0.0:8080' },
              { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
              { name: 'CELLD_ADVERTISE', value: `$(POD_NAME).${peerServiceName}.${identity.namespace}.svc.cluster.local:8081` },
              { name: 'CELLD_WATCH', value: '/var/lib/celld/state' },
            ],
            ports: [{ name: 'celld', containerPort: 8080 }, { name: 'celld-peer', containerPort: 8081 }],
            readinessProbe: { httpGet: { path: celldHealthPath(spec.artifact.celldVersion), port: 'celld' }, initialDelaySeconds: 3, periodSeconds: 3, failureThreshold: 40 },
            livenessProbe: { tcpSocket: { port: 'celld' }, initialDelaySeconds: 20, periodSeconds: 10, failureThreshold: 6 },
            volumeMounts: [{ name: 'runtime', mountPath: '/var/lib/celld' }],
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
            resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { cpu: '2', memory: '2Gi' } },
          }],
          volumes: [{ name: 'runtime', emptyDir: {} }],
        },
      },
    },
  };
  const ingressNamespaces = [...new Set([identity.namespace, ...(spec.ingressNamespaces ?? [])])].sort();
  const networkPolicy: AnyKubernetesObject = {
    apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(`${identity.name}-private`),
    spec: {
      podSelector: { matchLabels: labels }, policyTypes: ['Ingress'],
      ingress: [
        { from: ingressNamespaces.map(namespace => ({ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } } })), ports: [{ protocol: 'TCP', port: 8080 }] },
        {
          from: [{
            namespaceSelector: {},
            podSelector: { matchLabels: { 'app.kubernetes.io/name': 'applik8s-celld-operator' } },
          }],
          ports: [{ protocol: 'TCP', port: 8080 }, { protocol: 'TCP', port: 8081 }],
        },
        { from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': identity.namespace } } }], ports: [{ protocol: 'TCP', port: 8081 }] },
      ],
    },
  };
  const podDisruptionBudget: AnyKubernetesObject = {
    apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: metadata(identity.name),
    spec: { maxUnavailable: 1, selector: { matchLabels: labels } },
  };
  const all = [
    ...(spec.objectStore.credentials.type === 'workloadIdentity' ? [] : [serviceAccount]),
    peerService, clientService, deploymentJob, statefulSet, networkPolicy, podDisruptionBudget,
  ];
  return { serviceAccount, peerService, clientService, deploymentJob, statefulSet, networkPolicy, podDisruptionBudget, all };
}

export function celldFleetChildRefs(
  name: string,
  namespace: string,
  options: { readonly ownsServiceAccount?: boolean } = { ownsServiceAccount: true },
): readonly { readonly apiVersion: string; readonly kind: string; readonly name: string; readonly namespace: string }[] {
  return [
    ['apps/v1', 'StatefulSet', name],
    ['v1', 'Service', name],
    ['v1', 'Service', `${name}-peers`],
    ['networking.k8s.io/v1', 'NetworkPolicy', `${name}-private`],
    ['policy/v1', 'PodDisruptionBudget', name],
    ...(options.ownsServiceAccount === false ? [] : [['v1', 'ServiceAccount', `${name}-celld`]]),
  ].map(([apiVersion, kind, childName]) => ({ apiVersion: apiVersion ?? '', kind: kind ?? '', name: childName ?? '', namespace }));
}

export function celldDeploymentJobName(name: string, manifestDigest: string): string {
  return `${name}-deploy-${manifestDigest.slice('sha256:'.length, 'sha256:'.length + 12)}`;
}

export function celldFleetImageDigest(image: string): string | undefined {
  if (/^sha256:[a-f0-9]{64}$/u.test(image)) return image;
  const separator = image.lastIndexOf('@');
  const digest = separator < 0 ? undefined : image.slice(separator + 1);
  return digest && /^sha256:[a-f0-9]{64}$/u.test(digest) ? digest : undefined;
}

function fleetLabels(identity: CelldFleetIdentity): Readonly<Record<string, string>> {
  return {
    'app.kubernetes.io/name': 'celld',
    'app.kubernetes.io/instance': identity.name,
    'app.kubernetes.io/component': 'actor-runtime',
    'app.kubernetes.io/managed-by': 'applik8s-celld-operator',
    [celldFleetLabel]: identity.name,
    [celldFleetUidLabel]: identity.uid,
  };
}

function bucketUrl(spec: CelldFleetSpec): string {
  const prefix = spec.objectStore.prefix.replace(/^\/+|\/+$/gu, '');
  return `${spec.objectStore.dialect}://${spec.objectStore.bucket}${prefix ? `/${prefix}` : ''}`;
}

function envSecret(name: string, secretName: string, key: string): object {
  return { name, valueFrom: { secretKeyRef: { name: secretName, key } } };
}

function objectStoreEnvironment(spec: CelldFleetSpec): readonly object[] {
  if (spec.objectStore.credentials.type === 'workloadIdentity') {
    return [
      ...(spec.objectStore.region ? [{ name: 'AWS_REGION', value: spec.objectStore.region }, { name: 'AWS_DEFAULT_REGION', value: spec.objectStore.region }] : []),
      ...(spec.objectStore.endpoint ? [{ name: 'S3_ENDPOINT', value: spec.objectStore.endpoint }] : []),
    ];
  }
  const secret = requiredObjectStoreSecret(spec);
  return spec.objectStore.dialect === 's3'
    ? [
        envSecret('AWS_ACCESS_KEY_ID', secret, s3CredentialsSecretV1.keys.accessKeyId),
        envSecret('AWS_SECRET_ACCESS_KEY', secret, s3CredentialsSecretV1.keys.secretAccessKey),
        ...(spec.objectStore.region ? [{ name: 'AWS_REGION', value: spec.objectStore.region }, { name: 'AWS_DEFAULT_REGION', value: spec.objectStore.region }] : []),
        ...(spec.objectStore.endpoint ? [{ name: 'S3_ENDPOINT', value: spec.objectStore.endpoint }] : []),
      ]
    : [envSecret('GOOGLE_APPLICATION_CREDENTIALS_JSON', secret, gcsCredentialsSecretV1.keys.serviceAccountJson)];
}

function requiredWorkloadIdentityServiceAccount(spec: CelldFleetSpec): string {
  const reference = spec.objectStore.credentials.serviceAccountRef;
  if (spec.objectStore.credentials.type !== 'workloadIdentity' || !reference) {
    throw new Error('CelldFleet workload-identity credentials require serviceAccountRef.');
  }
  return reference.name;
}

function requiredObjectStoreSecret(spec: CelldFleetSpec): string {
  const reference = spec.objectStore.credentials.secretRef;
  if (spec.objectStore.credentials.type !== 'secret' || !reference) {
    throw new Error('CelldFleet Secret credentials require secretRef.');
  }
  return reference.name;
}
