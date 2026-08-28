// typecast-file-boundary: Kubernetes discovery schemas erase provider client generics only while declaring the operator's validated read/watch resources.
import { sdk } from '@applik8s/sdk';

export interface KubernetesStatefulSetStatus {
  readonly observedGeneration?: number;
  readonly replicas?: number;
  readonly readyReplicas?: number;
  readonly updatedReplicas?: number;
  readonly currentRevision?: string;
  readonly updateRevision?: string;
}

export interface KubernetesPodStatus {
  readonly phase?: string;
  readonly conditions?: readonly { readonly type?: string; readonly status?: string }[];
  readonly containerStatuses?: readonly {
    readonly name?: string;
    readonly ready?: boolean;
    readonly image?: string;
    readonly imageID?: string;
  }[];
}

export interface KubernetesJobStatus {
  readonly succeeded?: number;
  readonly failed?: number;
  readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly reason?: string; readonly message?: string }[];
}

export const CelldStatefulSet = sdk.kubernetes.resource<object, KubernetesStatefulSetStatus>({
  apiVersion: 'apps/v1', kind: 'StatefulSet', plural: 'statefulsets', access: 'local',
});
export const CelldPod = sdk.kubernetes.resource<object, KubernetesPodStatus>({
  apiVersion: 'v1', kind: 'Pod', plural: 'pods', access: 'local',
});
export const CelldJob = sdk.kubernetes.resource<object, KubernetesJobStatus>({
  apiVersion: 'batch/v1', kind: 'Job', plural: 'jobs', access: 'local',
});
export const CelldSecret = sdk.kubernetes.resource({
  apiVersion: 'v1', kind: 'Secret', plural: 'secrets', access: 'local',
});
export const CelldService = sdk.kubernetes.resource({
  apiVersion: 'v1', kind: 'Service', plural: 'services', access: 'local',
});
export const CelldNetworkPolicy = sdk.kubernetes.resource({
  apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', plural: 'networkpolicies', access: 'local',
});
export const CelldPodDisruptionBudget = sdk.kubernetes.resource({
  apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', plural: 'poddisruptionbudgets', access: 'local',
});
export const CelldServiceAccount = sdk.kubernetes.resource({
  apiVersion: 'v1', kind: 'ServiceAccount', plural: 'serviceaccounts', access: 'local',
});

export const celldOperatorReads = {
  StatefulSet: CelldStatefulSet,
  Pod: CelldPod,
  Job: CelldJob,
  Secret: CelldSecret,
  Service: CelldService,
  NetworkPolicy: CelldNetworkPolicy,
  PodDisruptionBudget: CelldPodDisruptionBudget,
  ServiceAccount: CelldServiceAccount,
} as const;
