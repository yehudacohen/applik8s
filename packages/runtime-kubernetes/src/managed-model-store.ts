import {
  portableManagedModelStatus,
  type ResourceObject,
  removePortableManagedModelCondition,
  setPortableManagedModelCondition,
} from '@applik8s/core';

export const kubernetesApplicationManagedModelProtocol = 'applik8s.managed-model.kubernetes/v1alpha1' as const;

export interface KubernetesApplicationManagedModelIdentity {
  readonly apiVersion: string;
  readonly kind: string;
  readonly namespace?: string;
  readonly name: string;
  readonly uid: string;
  readonly generation: number;
  readonly resourceVersion: string;
}

export interface KubernetesApplicationManagedModelCondition {
  readonly type: string;
  readonly status: 'True' | 'False' | 'Unknown';
  readonly observedGeneration: number;
  readonly reason: string;
  readonly message: string;
  readonly lastTransitionTime: string;
}

export interface KubernetesApplicationManagedModelConditionInput {
  readonly type: string;
  readonly status: 'True' | 'False' | 'Unknown';
  readonly reason: string;
  readonly message: string;
}

export class KubernetesApplicationManagedModelFenceError extends Error {
  readonly code = 'RECONCILE_LEASE_LOST' as const;
  readonly expected: KubernetesApplicationManagedModelIdentity;
  readonly actual: KubernetesApplicationManagedModelIdentity | undefined;

  constructor(
    message: string,
    expected: KubernetesApplicationManagedModelIdentity,
    actual?: KubernetesApplicationManagedModelIdentity,
  ) {
    super(message);
    this.name = 'KubernetesApplicationManagedModelFenceError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Captures the exact Kubernetes identity used as the managed-model commit
 * fence. Missing server-owned metadata fails closed; authored fixtures cannot
 * accidentally qualify as live provider observations.
 */
export function kubernetesApplicationManagedModelIdentity<TSpec extends object, TStatus extends object>(
  object: ResourceObject<TSpec, TStatus>,
): KubernetesApplicationManagedModelIdentity {
  const uid = requiredMetadata(object.metadata.uid, `${object.kind} metadata.uid`);
  const resourceVersion = requiredMetadata(
    object.metadata.resourceVersion,
    `${object.kind} metadata.resourceVersion`,
  );
  const generation = object.metadata.generation;
  if (!Number.isSafeInteger(generation) || Number(generation) < 1) {
    throw new Error(`${object.kind} metadata.generation must be a positive server-observed integer.`);
  }
  return Object.freeze({
    apiVersion: object.apiVersion,
    kind: object.kind,
    ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}),
    name: object.metadata.name,
    uid,
    generation: Number(generation),
    resourceVersion,
  });
}

/** Rejects stale workers before a status, condition, or finalizer commit. */
export function assertKubernetesApplicationManagedModelFence(
  expected: KubernetesApplicationManagedModelIdentity,
  live: ResourceObject<object, object> | undefined,
): KubernetesApplicationManagedModelIdentity {
  if (!live) {
    throw new KubernetesApplicationManagedModelFenceError(
      `Managed Kubernetes object ${identityLabel(expected)} no longer exists.`,
      expected,
    );
  }
  const actual = kubernetesApplicationManagedModelIdentity(live);
  const matches = expected.apiVersion === actual.apiVersion
    && expected.kind === actual.kind
    && expected.namespace === actual.namespace
    && expected.name === actual.name
    && expected.uid === actual.uid
    && expected.generation === actual.generation
    && expected.resourceVersion === actual.resourceVersion;
  if (!matches) {
    throw new KubernetesApplicationManagedModelFenceError(
      `Managed Kubernetes object ${identityLabel(expected)} changed while reconciliation was in flight.`,
      expected,
      actual,
    );
  }
  return actual;
}

/**
 * Produces one schema-complete status replacement while preserving the
 * independently owned condition list.
 */
export function kubernetesApplicationManagedModelStatus<TStatus extends object>(
  current: Readonly<TStatus> | undefined,
  next: TStatus,
  conditionsField = 'conditions',
): TStatus {
  return portableManagedModelStatus(current, next, conditionsField);
}

export function setKubernetesApplicationManagedModelCondition(
  current: readonly KubernetesApplicationManagedModelCondition[],
  input: KubernetesApplicationManagedModelConditionInput,
  generation: number,
  now: string,
): readonly KubernetesApplicationManagedModelCondition[] {
  return setPortableManagedModelCondition(current, input, generation, now);
}

export function removeKubernetesApplicationManagedModelCondition(
  current: readonly KubernetesApplicationManagedModelCondition[],
  type: string,
): readonly KubernetesApplicationManagedModelCondition[] {
  return removePortableManagedModelCondition(current, type);
}

function identityLabel(identity: KubernetesApplicationManagedModelIdentity): string {
  return `${identity.apiVersion}/${identity.kind} ${identity.namespace ? `${identity.namespace}/` : ''}${identity.name}`;
}

function requiredMetadata(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} must be present on a live provider observation.`);
  return normalized;
}
