import { externalRef } from 'typekro';
import { clusterRole as typeKroClusterRole, clusterRoleBinding as typeKroClusterRoleBinding, configMap as typeKroConfigMap, deployment as typeKroDeployment, role as typeKroRole, roleBinding as typeKroRoleBinding, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import { generatedJobStatusRuntimeBundle } from './application-runtime-modules.js';
import { applicationTypeKroString } from './application-typekro-values.js';

export interface ApplicationStatusReconcilerAppResourceTarget {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
}

export interface ApplicationGeneratedJobStatusTarget {
  readonly resourceName: string;
  readonly namespace?: string | undefined;
  readonly statusPath: string;
  readonly jobKind: 'Job' | 'CronJob';
  readonly materialization: 'kubernetes-job' | 'kubernetes-cronjob';
}

export interface ApplicationGeneratedJobStatusReconcilerState {
  readonly appResource: ApplicationStatusReconcilerAppResourceTarget;
  readonly generatedJobStatusTargets: readonly ApplicationGeneratedJobStatusTarget[];
}

export interface ApplicationStatusReconcilerEmitUtilities {
  readonly graphResourceId: (name: string, role: string) => string;
  readonly kubernetesNameSegment: (value: string) => string;
  readonly apiGroupForApiVersion: (apiVersion: string) => string;
}

export interface ApplicationGeneratedJobStatusProjectionStore {
  readonly namespace?: string;
  readonly data?: Readonly<Record<string, string>>;
}

export function applicationStatusReconcilerName(appResource: ApplicationStatusReconcilerAppResourceTarget, kubernetesNameSegment: (value: string) => string): string {
  return `${kubernetesNameSegment(appResource.kind)}-status-reconciler`;
}

export function emitApplicationGeneratedJobStatusReconcilers(state: ApplicationGeneratedJobStatusReconcilerState, utilities: ApplicationStatusReconcilerEmitUtilities): readonly ApplicationGeneratedJobStatusProjectionStore[] {
  const groups = new Map<string, ApplicationGeneratedJobStatusTarget[]>();
  for (const target of state.generatedJobStatusTargets) {
    const key = target.namespace ?? '';
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  return [...groups].map(([namespaceKey, targets]) => emitGeneratedJobStatusReconcilerResources(state, utilities, namespaceKey || undefined, targets));
}

function emitGeneratedJobStatusReconcilerResources(state: ApplicationGeneratedJobStatusReconcilerState, utilities: ApplicationStatusReconcilerEmitUtilities, namespace: string | undefined, targets: readonly ApplicationGeneratedJobStatusTarget[]): ApplicationGeneratedJobStatusProjectionStore {
  const reconcilerName = applicationStatusReconcilerName(state.appResource, utilities.kubernetesNameSegment);
  if (targets.length === 0) {
    return { ...(namespace ? { namespace } : {}) };
  }
  const statusRuntimeConfigMapName = `${reconcilerName}-runtime`;
  const statusConfigMapName = `${reconcilerName}-status`;
  const labels = {
    'app.kubernetes.io/name': reconcilerName,
    'app.kubernetes.io/component': 'generated-job-status-reconciler',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/app-kind': utilities.kubernetesNameSegment(state.appResource.kind),
  };
  const batchResources = unique(targets.map((target) => target.jobKind === 'CronJob' ? 'cronjobs' : 'jobs'));
  const rules = [
    { apiGroups: [''], resources: ['pods'], verbs: ['get'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['create', 'get', 'patch', 'update'] },
    { apiGroups: ['apps'], resources: ['replicasets', 'deployments'], verbs: ['get'] },
    { apiGroups: ['batch'], resources: batchResources, verbs: ['get', 'list', 'watch'] },
  ];

  typeKroConfigMap({
    id: utilities.graphResourceId(reconcilerName, 'statusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle(targets.map((target) => ({ jobName: target.resourceName, jobKind: target.jobKind, statusPath: target.statusPath, materialization: target.materialization })), state.appResource, statusConfigMapName),
  });
  const durableStatus = externalRef({
    id: utilities.graphResourceId(reconcilerName, 'durableStatus'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusConfigMapName, ...(namespace ? { namespace } : {}) },
  });

  typeKroServiceAccount({
    id: utilities.graphResourceId(reconcilerName, 'serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: reconcilerName, ...(namespace ? { namespace } : {}), labels },
  });
  typeKroRole({
    id: utilities.graphResourceId(reconcilerName, 'role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: reconcilerName, ...(namespace ? { namespace } : {}), labels },
    rules,
  });
  typeKroRoleBinding({
    id: utilities.graphResourceId(reconcilerName, 'roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: reconcilerName, ...(namespace ? { namespace } : {}), labels },
    subjects: [{ kind: 'ServiceAccount', name: reconcilerName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: reconcilerName },
  });
  if (namespace) {
    const clusterRoleName = applicationTypeKroString(namespace, '-', reconcilerName);
    typeKroClusterRole({
      id: utilities.graphResourceId(reconcilerName, 'clusterRole'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: { name: clusterRoleName, labels },
      rules,
    });
    typeKroClusterRoleBinding({
      id: utilities.graphResourceId(reconcilerName, 'clusterRoleBinding'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: clusterRoleName, labels },
      subjects: [{ kind: 'ServiceAccount', name: reconcilerName, namespace }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: clusterRoleName },
    });
  }
  typeKroDeployment({
    id: utilities.graphResourceId(reconcilerName, 'deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: reconcilerName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: reconcilerName,
          containers: [{
            name: 'status-reconciler',
            image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
            command: [
              'node',
              '--input-type=module',
              '-e',
              "import('/app/runtime__job-runner.mjs').then((module) => module.runGeneratedJobStatusReconciler()).catch((error) => { console.error(error); process.exitCode = 1; });",
            ],
            env: [
              { name: 'APPLIK8S_APP_API_VERSION', value: state.appResource.apiVersion },
              { name: 'APPLIK8S_APP_KIND', value: state.appResource.kind },
              { name: 'APPLIK8S_APP_PLURAL', value: state.appResource.plural },
              namespace ? { name: 'APPLIK8S_NAMESPACE', value: namespace } : { name: 'APPLIK8S_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
            ],
            volumeMounts: [{ name: 'applik8s-status-runtime', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-status-runtime', configMap: { name: statusRuntimeConfigMapName } }],
        },
      },
    },
  });
  // TypeKro's enhanced ConfigMap exposes data as status-builder references;
  // this projection intentionally narrows it to the map surface needed by the
  // application status CEL expression.
  // typecast: bridge TypeKro's enhanced ConfigMap to the internal projection-only view.
  return durableStatus as unknown as ApplicationGeneratedJobStatusProjectionStore;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
