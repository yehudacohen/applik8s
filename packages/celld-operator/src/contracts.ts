// typecast-file-boundary: ArkType, Kubernetes OpenAPI, and public literal contracts are declared together here; assertions preserve validated protocol discriminants rather than accepting unvalidated runtime input.
import { type } from 'arktype';

export const celldFleetApiVersion = 'celld.applik8s.io/v1alpha1' as const;
export const celldFleetKind = 'CelldFleet' as const;
export const celldFleetPlural = 'celldfleets' as const;
export const celldFleetFinalizer = 'celld.applik8s.io/finalizer' as const;
export const celldFleetLabel = 'celld.applik8s.io/fleet' as const;
export const celldFleetUidLabel = 'celld.applik8s.io/fleet-uid' as const;
export const celldFleetFingerprintAnnotation = 'celld.applik8s.io/spec-fingerprint' as const;

export const celldRuntimeSecretV1 = Object.freeze({
  contract: 'applik8s.celld-runtime/v1' as const,
  keys: Object.freeze({
    actorAuthorization: 'actor-authorization',
    applicationAuthorization: 'application-authorization',
    connectionSigningKey: 'connection-signing-key',
    operatorAuthorization: 'operator-authorization',
  }),
});

export const s3CredentialsSecretV1 = Object.freeze({
  contract: 'applik8s.object-store.s3-credentials/v1' as const,
  keys: Object.freeze({
    accessKeyId: 'AWS_ACCESS_KEY_ID',
    secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
    sessionToken: 'AWS_SESSION_TOKEN',
  }),
});

export const gcsCredentialsSecretV1 = Object.freeze({
  contract: 'applik8s.object-store.gcs-credentials/v1' as const,
  keys: Object.freeze({
    serviceAccountJson: 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  }),
});

export const celldRuntimeArtifactV1 = Object.freeze({
  contract: 'applik8s.celld-runtime-artifact/v1' as const,
  protocolRevision: 'applik8s.actorAuthority/v1alpha1' as const,
});

const dns1123 = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const sha256 = /^sha256:[a-f0-9]{64}$/;
const immutableImage = /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64})$/;

const CelldObjectStoreCredentialsSchema = type({
  type: "'secret' | 'workloadIdentity'",
  'secretRef?': {
    name: dns1123,
    contract: "'applik8s.object-store.s3-credentials/v1' | 'applik8s.object-store.gcs-credentials/v1'",
  },
  'serviceAccountRef?': { name: dns1123 },
});

export const CelldFleetSpecSchema = type({
  artifact: {
    image: immutableImage,
    manifestDigest: sha256,
    workerVersion: 'string > 0',
    celldVersion: 'string > 0',
  },
  replicas: '1 <= number.integer <= 100',
  'placement?': {
    'topologyKey?': 'string > 0',
    'maxPerDomain?': '1',
  },
  objectStore: {
    dialect: "'s3' | 'gcs'",
    bucket: 'string > 0',
    prefix: 'string',
    'endpoint?': 'string > 0',
    'region?': 'string > 0',
    credentials: CelldObjectStoreCredentialsSchema,
  },
  runtimeSecretRef: {
    name: dns1123,
    contract: "'applik8s.celld-runtime/v1'",
  },
  applicationEndpoint: 'string > 0',
  'ingressNamespaces?': 'string[]',
  rollout: {
    strategy: "'Rolling' | 'Recreate'",
    progressDeadlineSeconds: '30 <= number.integer <= 86400',
    drainDeadlineSeconds: '30 <= number.integer <= 86400',
    restoreDeadlineSeconds: '30 <= number.integer <= 86400',
  },
  deletion: {
    dataPolicy: "'Retain'",
    drainTimeoutPolicy: "'Block'",
  },
});

export const CelldFleetConditionSchema = type({
  type: "'Ready' | 'Progressing' | 'Degraded' | 'Draining' | 'RestoreBlocked'",
  status: "'True' | 'False' | 'Unknown'",
  observedGeneration: 'number.integer >= 0',
  reason: 'string > 0',
  message: 'string',
  lastTransitionTime: 'string > 0',
});

export const CelldFleetStatusSchema = type({
  'observedGeneration?': 'number.integer >= 0',
  'phase?': "'Pending' | 'Ready' | 'Progressing' | 'Draining' | 'Degraded'",
  'replicas?': 'number.integer >= 0',
  'readyReplicas?': 'number.integer >= 0',
  'updatedReplicas?': 'number.integer >= 0',
  'observedImageDigest?': 'string',
  'observedArtifactManifestDigest?': 'string',
  'observedWorkerVersion?': 'string',
  'observedCelldVersion?': 'string',
  'endpoint?': 'string',
  'rollout?': {
    partition: 'number.integer >= 0',
    'waitingOn?': 'string',
    'startedAt?': 'string',
  },
  'conditions?': CelldFleetConditionSchema.array(),
});

const nonemptyOpenApiString = { type: 'string', minLength: 1 } as const;
const dns1123OpenApiString = {
  type: 'string',
  minLength: 1,
  maxLength: 253,
  pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$',
} as const;
const sha256OpenApiString = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } as const;

/**
 * One structural Kubernetes schema shared by the standalone operator compiler
 * and the TypeKro bootstrap. CEL owns the cross-field credential invariant;
 * the handler repeats it before performing any effect.
 */
export const celldFleetSpecOpenApiSchema = {
  type: 'object',
  required: ['artifact', 'replicas', 'objectStore', 'runtimeSecretRef', 'applicationEndpoint', 'rollout', 'deletion'],
  properties: {
    artifact: {
      type: 'object', required: ['image', 'manifestDigest', 'workerVersion', 'celldVersion'], properties: {
        image: { type: 'string', pattern: '^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64})$' },
        manifestDigest: sha256OpenApiString,
        workerVersion: nonemptyOpenApiString,
        celldVersion: nonemptyOpenApiString,
      },
    },
    replicas: { type: 'integer', minimum: 1, maximum: 100 },
    placement: { type: 'object', properties: { topologyKey: nonemptyOpenApiString, maxPerDomain: { type: 'integer', enum: [1] } } },
    objectStore: {
      type: 'object', required: ['dialect', 'bucket', 'prefix', 'credentials'], properties: {
        dialect: { type: 'string', enum: ['s3', 'gcs'] },
        bucket: nonemptyOpenApiString,
        prefix: { type: 'string' },
        endpoint: nonemptyOpenApiString,
        region: nonemptyOpenApiString,
        credentials: {
          type: 'object', required: ['type'], properties: {
            type: { type: 'string', enum: ['secret', 'workloadIdentity'] },
            secretRef: { type: 'object', required: ['name', 'contract'], properties: { name: dns1123OpenApiString, contract: { type: 'string', enum: ['applik8s.object-store.s3-credentials/v1', 'applik8s.object-store.gcs-credentials/v1'] } } },
            serviceAccountRef: { type: 'object', required: ['name'], properties: { name: dns1123OpenApiString } },
          },
          xKubernetesValidations: [{
            rule: "self.type == 'secret' ? has(self.secretRef) && !has(self.serviceAccountRef) : has(self.serviceAccountRef) && !has(self.secretRef)",
            message: 'credentials must select exactly one Secret or workload identity source',
          }],
        },
      },
    },
    runtimeSecretRef: { type: 'object', required: ['name', 'contract'], properties: { name: dns1123OpenApiString, contract: { type: 'string', enum: ['applik8s.celld-runtime/v1'] } } },
    applicationEndpoint: nonemptyOpenApiString,
    ingressNamespaces: { type: 'array', items: nonemptyOpenApiString },
    rollout: { type: 'object', required: ['strategy', 'progressDeadlineSeconds', 'drainDeadlineSeconds', 'restoreDeadlineSeconds'], properties: { strategy: { type: 'string', enum: ['Rolling', 'Recreate'] }, progressDeadlineSeconds: { type: 'integer', minimum: 30, maximum: 86400 }, drainDeadlineSeconds: { type: 'integer', minimum: 30, maximum: 86400 }, restoreDeadlineSeconds: { type: 'integer', minimum: 30, maximum: 86400 } } },
    deletion: { type: 'object', required: ['dataPolicy', 'drainTimeoutPolicy'], properties: { dataPolicy: { type: 'string', enum: ['Retain'] }, drainTimeoutPolicy: { type: 'string', enum: ['Block'] } } },
  },
} as const;

export const celldFleetStatusOpenApiSchema = {
  type: 'object',
  properties: {
    observedGeneration: { type: 'integer', minimum: 0 },
    phase: { type: 'string', enum: ['Pending', 'Ready', 'Progressing', 'Draining', 'Degraded'] },
    replicas: { type: 'integer', minimum: 0 },
    readyReplicas: { type: 'integer', minimum: 0 },
    updatedReplicas: { type: 'integer', minimum: 0 },
    observedImageDigest: { type: 'string' },
    observedArtifactManifestDigest: { type: 'string' },
    observedWorkerVersion: { type: 'string' },
    observedCelldVersion: { type: 'string' },
    endpoint: { type: 'string' },
    rollout: { type: 'object', required: ['partition'], properties: { partition: { type: 'integer', minimum: 0 }, waitingOn: { type: 'string' }, startedAt: { type: 'string' } } },
    conditions: { type: 'array', items: { type: 'object', required: ['type', 'status', 'observedGeneration', 'reason', 'message', 'lastTransitionTime'], properties: { type: { type: 'string', enum: ['Ready', 'Progressing', 'Degraded', 'Draining', 'RestoreBlocked'] }, status: { type: 'string', enum: ['True', 'False', 'Unknown'] }, observedGeneration: { type: 'integer', minimum: 0 }, reason: nonemptyOpenApiString, message: { type: 'string' }, lastTransitionTime: nonemptyOpenApiString } } },
  },
} as const;

export type CelldFleetSpec = typeof CelldFleetSpecSchema.infer;
export type CelldFleetStatus = typeof CelldFleetStatusSchema.infer;
export type CelldFleetCondition = typeof CelldFleetConditionSchema.infer;

export interface CelldRuntimeArtifactManifestV1 {
  readonly apiVersion: typeof celldRuntimeArtifactV1.contract;
  readonly workerVersion: string;
  readonly celldVersion: string;
  readonly applicationGraphDigest: `sha256:${string}`;
  readonly protocolRevision: typeof celldRuntimeArtifactV1.protocolRevision;
  readonly artifactDigest: `sha256:${string}`;
}
