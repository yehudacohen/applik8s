// typecast-file-boundary: Kubernetes custom-object responses are narrowed by API version and kind before schedule execution.
import { createHash } from 'node:crypto';
import {
  type ApplicationScheduleAdmission,
  type ApplicationScheduleAdmissionRunner,
  type ApplicationScheduleConvergenceResult,
  type ApplicationScheduleDefinitionContract,
  type ApplicationScheduleHandle,
  type ApplicationScheduleHandler,
  type ApplicationScheduleInstance,
  type ApplicationScheduleManagementReceipt,
  type ApplicationScheduleOccurrenceReceipt,
  type ApplicationScheduleRuntime,
  type ApplicationScheduleStateAuthority,
  applicationScheduleImmediateInvocationAdmission,
  applicationScheduleOccurrenceId,
  applicationScheduleProjectedDesiredState,
} from '@applik8s/applik8s/schedule-provider-runtime';
import {
  type ApplicationAdmissionInvocationContextV1,
  exactFiveFieldCronForInterval,
} from '@applik8s/core';
import {
  ApplicationScheduleOccurrenceBusyError,
  executePostgresApplicationScheduleAdmission,
} from '@applik8s/runtime-postgres/schedule-occurrence';
import { createPostgresApplicationScheduleStateAuthority } from '@applik8s/runtime-postgres/schedule-state';
import type { BatchV1Api, KubeConfig, V1CronJob } from '@kubernetes/client-node';

const admissionImage = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';
export const DEFAULT_KUBERNETES_SCHEDULE_INSTANCE_CEILING = 100;

export interface KubernetesApplicationScheduleRuntimeOptions {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly namespace: string;
  readonly admissionEndpoint: string;
  readonly authorizationSecretName: string;
  readonly authorizationSecretKey?: string;
  /** ServiceAccount used by occurrence Jobs to read their authoritative scheduled timestamp. */
  readonly serviceAccountName?: string;
  readonly databaseUrl?: string;
  readonly kubeConfig?: KubeConfig;
  /** Explicitly select the pod's projected Kubernetes identity. Never reads ambient kubeconfig. */
  readonly inCluster?: true;
  /** Provider/test seam for an already-authorized Batch API. */
  readonly api?: Pick<
    BatchV1Api,
    | 'readNamespacedCronJob'
    | 'createNamespacedCronJob'
    | 'replaceNamespacedCronJob'
    | 'deleteNamespacedCronJob'
  >;
  readonly image?: string;
  /** Maximum active CronJob projections allowed for one application/environment. */
  readonly maximumInstances?: number;
  readonly admissionRunner?: ApplicationScheduleAdmissionRunner;
  readonly stateAuthority?: ApplicationScheduleStateAuthority;
}

export interface KubernetesApplicationScheduleRuntime extends ApplicationScheduleRuntime {
  /** Removes an exact, already-authorized CronJob identity after one-time execution. */
  readonly removeResource: (name: string) => Promise<void>;
  /** Replays canonical desired state left pending by an interrupted projection. */
  readonly recover: () => Promise<readonly ApplicationScheduleConvergenceResult[]>;
  readonly close: () => Promise<void>;
}

/**
 * Kubernetes implementation of the function-native dynamic Scheduler surface.
 * PostgreSQL owns desired state before provider projection and remains the
 * canonical occurrence and overlap authority at admission time. CronJobs are
 * restart-recoverable, application-owned projections of that state.
 */
export async function createKubernetesApplicationScheduleRuntime(
  options: KubernetesApplicationScheduleRuntimeOptions,
): Promise<KubernetesApplicationScheduleRuntime> {
  validateOptions(options);
  if (options.kubeConfig && options.inCluster) {
    throw new Error(
      'Kubernetes schedule runtime must select exactly one explicit client source.',
    );
  }
  let api = options.api;
  if (!api) {
    if (!options.kubeConfig && !options.inCluster) {
      throw new Error(
        'Kubernetes schedule runtime requires an explicit kubeConfig or inCluster: true; ambient kubeconfig is never adopted.',
      );
    }
    // static-import-exception: lazy loading keeps the Kubernetes SDK out of non-Kubernetes application hosts.
    const kubernetes = await import('@kubernetes/client-node');
    const kubeConfig = options.kubeConfig ?? new kubernetes.KubeConfig();
    if (options.inCluster) kubeConfig.loadFromCluster();
    api = kubeConfig.makeApiClient(kubernetes.BatchV1Api);
  }
  const image = options.image ?? admissionImage;
  const maximumInstances = options.maximumInstances
    ?? DEFAULT_KUBERNETES_SCHEDULE_INSTANCE_CEILING;
  const stateAuthority = options.stateAuthority
    ?? createPostgresApplicationScheduleStateAuthority({
      databaseUrl: required(options.databaseUrl ?? '', 'Kubernetes schedule PostgreSQL state authority'),
      applicationId: options.applicationId,
      environmentId: options.environmentId,
    });
  const ownsStateAuthority = !options.stateAuthority;
  const project = async (request: {
    readonly definition: ApplicationScheduleDefinitionContract<object>;
    readonly instance: ApplicationScheduleInstance<object>;
    readonly management?: ApplicationScheduleManagementReceipt;
  }): Promise<'created' | 'updated' | 'unchanged'> => {
    const name = dynamicScheduleName(options, request.definition.id, request.instance.id);
    const desired = cronJob({
      options,
      image,
      name,
      definition: request.definition,
      instance: request.instance,
      ...(request.management ? { management: request.management } : {}),
    });
    let existing: V1CronJob | undefined;
    try {
      existing = await api.readNamespacedCronJob({ namespace: options.namespace, name });
    } catch (cause) {
      if (statusCode(cause) !== 404) throw cause;
    }
    if (existing?.metadata?.annotations?.['applik8s.dev/schedule-revision'] === request.instance.revision
      && kubernetesScheduleResourceMatches(existing, desired)) {
      return 'unchanged';
    }
    if (existing) {
      if (existing.metadata?.resourceVersion) desired.metadata!.resourceVersion = existing.metadata.resourceVersion;
      await api.replaceNamespacedCronJob({ namespace: options.namespace, name, body: desired, fieldManager: 'applik8s-scheduler', fieldValidation: 'Strict' });
      return 'updated';
    }
    await api.createNamespacedCronJob({ namespace: options.namespace, body: desired, fieldManager: 'applik8s-scheduler', fieldValidation: 'Strict' });
    return 'created';
  };
  const runtime: KubernetesApplicationScheduleRuntime = {
    async invoke<TInput extends object, TResult>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly input: TInput;
      readonly handler: ApplicationScheduleHandler<TInput, TResult>;
      readonly callerAdmission: ApplicationAdmissionInvocationContextV1;
    }): Promise<TResult> {
      const now = new Date().toISOString();
			const occurrenceId = applicationScheduleOccurrenceId({
				applicationId: options.applicationId,
				environmentId: options.environmentId,
				definitionId: request.definition.id,
				instanceId: 'immediate',
				scheduledAt: now,
			});
      const invocationAdmission = applicationScheduleImmediateInvocationAdmission({
        caller: request.callerAdmission,
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId,
        admittedAt: now,
        maximumAgeSeconds: request.definition.retry.maximumAgeSeconds,
      });
      const invokeHandler = async () => request.handler(request.input, {
        definitionId: request.definition.id,
        instanceId: 'immediate',
				occurrenceId,
        scheduledAt: now,
        admittedAt: now,
        startedAt: now,
        attempt: 1,
        trigger: 'immediate',
				admission: invocationAdmission,
        signal: new AbortController().signal,
      });
      return options.admissionRunner
        ? options.admissionRunner.run(invocationAdmission, invokeHandler)
        : invokeHandler();
    },
    async reconcile<TInput extends object>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly instance: ApplicationScheduleInstance<TInput>;
      readonly handler: ApplicationScheduleHandler<TInput, unknown>;
      readonly management?: ApplicationScheduleManagementReceipt;
    }): Promise<ApplicationScheduleConvergenceResult> {
      if (request.definition.configuration !== 'dynamic') {
        throw new Error(`Kubernetes Scheduler cannot reconcile dynamic instance state for fixed definition ${request.definition.id}.`);
      }
      if (request.definition.requirements.cardinality !== 'bounded') {
        throw new Error(
          `Kubernetes Scheduler requires bounded cardinality; schedule ${request.definition.id} declares ${request.definition.requirements.cardinality}.`,
        );
      }
      const canonical = await stateAuthority.reconcile({
        ...request,
        maximumActiveInstances: maximumInstances,
      });
      const projected = await project({
        definition: request.definition as unknown as ApplicationScheduleDefinitionContract<object>,
        instance: request.instance as ApplicationScheduleInstance<object>,
        ...(request.management ? { management: request.management } : {}),
      });
      if (!await stateAuthority.markProjected(request.definition.id, request.instance.id, request.instance.revision, 'active')) {
        await runtime.recover();
        throw new Error(`Schedule ${request.definition.id}:${request.instance.id} revision ${request.instance.revision} was superseded during Kubernetes projection.`);
      }
      return {
        ...canonical,
        state: projected === 'unchanged' ? canonical.state : projected,
      };
    },
    async remove(definitionId, instanceId, management) {
      const canonical = await stateAuthority.remove(definitionId, instanceId, management);
      const name = dynamicScheduleName(options, definitionId, instanceId);
      const removed = await deleteKubernetesScheduleResource(api, options.namespace, name);
      if (!await stateAuthority.markProjected(definitionId, instanceId, canonical.revision, 'removed')) {
        await runtime.recover();
        throw new Error(`Schedule ${definitionId}:${instanceId} removal was superseded during Kubernetes projection.`);
      }
      return {
        ...canonical,
        state: removed || canonical.state === 'removed' ? 'removed' : 'unchanged',
      };
    },
    async removeResource(name) {
      if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(name) || name.length > 253) {
        throw new Error(`Kubernetes schedule cleanup resource name ${name} is invalid.`);
      }
      await deleteKubernetesScheduleResource(api, options.namespace, name);
    },
    async recover() {
      const recovered: ApplicationScheduleConvergenceResult[] = [];
      for (const record of await stateAuthority.recoveryCandidates()) {
        if (record.state === 'active') {
          const desired = applicationScheduleProjectedDesiredState(record);
          const state = await project(desired);
          if (!await stateAuthority.markProjected(record.definitionId, record.instanceId, record.revision, 'active')) {
            throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during Kubernetes recovery.`);
          }
          recovered.push({
            definitionId: record.definitionId,
            instanceId: record.instanceId,
            revision: record.revision,
            state,
            ...(record.management ? { management: record.management } : {}),
          });
          continue;
        }
        const removed = await deleteKubernetesScheduleResource(
          api,
          options.namespace,
          dynamicScheduleName(options, record.definitionId, record.instanceId),
        );
        if (!await stateAuthority.markProjected(record.definitionId, record.instanceId, record.revision, 'removed')) {
          throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during Kubernetes recovery.`);
        }
        recovered.push({
          definitionId: record.definitionId,
          instanceId: record.instanceId,
          revision: record.revision,
          state: removed ? 'removed' : 'unchanged',
          ...(record.management ? { management: record.management } : {}),
        });
      }
      return recovered;
    },
    async close() {
      if (ownsStateAuthority) await stateAuthority.close?.();
    },
  };
  await runtime.recover();
  return runtime;
}

async function deleteKubernetesScheduleResource(
  api: Pick<BatchV1Api, 'readNamespacedCronJob' | 'deleteNamespacedCronJob'>,
  namespace: string,
  name: string,
): Promise<boolean> {
  let existing: V1CronJob;
  try {
    existing = await api.readNamespacedCronJob({ namespace, name });
  } catch (cause) {
    if (statusCode(cause) === 404) return false;
    throw cause;
  }
  const uid = existing.metadata?.uid;
  if (!uid) throw new Error(`Kubernetes schedule ${namespace}/${name} has no UID; refusing unleased deletion.`);
  try {
    await api.deleteNamespacedCronJob({
      namespace,
      name,
      propagationPolicy: 'Foreground',
      body: { propagationPolicy: 'Foreground', preconditions: { uid } },
    });
  } catch (cause) {
    if (statusCode(cause) === 404) return true;
    throw cause;
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const live = await api.readNamespacedCronJob({ namespace, name });
      if (live.metadata?.uid !== uid) {
        throw new Error(`Kubernetes schedule ${namespace}/${name} was replaced while deletion was completing; refusing to touch UID ${String(live.metadata?.uid)}.`);
      }
    } catch (cause) {
      if (statusCode(cause) === 404) return true;
      throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Kubernetes schedule ${namespace}/${name} UID ${uid} to finish deleting.`);
}

/**
 * Compares every field authored by Applik8s while tolerating Kubernetes
 * defaulted and server-owned fields. The revision annotation is an identity
 * hint, not drift evidence: a user or controller can mutate the live CronJob
 * without changing it.
 */
export function kubernetesScheduleResourceMatches(
  live: V1CronJob,
  desired: V1CronJob,
): boolean {
  return desiredValueMatches(live.metadata?.labels, desired.metadata?.labels)
    && desiredValueMatches(live.metadata?.annotations, desired.metadata?.annotations)
    && desiredValueMatches(live.spec, desired.spec);
}

function desiredValueMatches(live: unknown, desired: unknown): boolean {
  if (desired === null || typeof desired !== 'object') return Object.is(live, desired);
  if (Array.isArray(desired)) {
    return Array.isArray(live)
      && live.length >= desired.length
      && desired.every((value, index) => desiredValueMatches(live[index], value));
  }
  if (live === null || typeof live !== 'object' || Array.isArray(live)) return false;
  return Object.entries(desired).every(([key, value]) =>
    desiredValueMatches(Reflect.get(live, key), value));
}

export interface KubernetesScheduleAdmissionAuthorityOptions<TInput extends object, TResult> {
  readonly databaseUrl: string;
  readonly handle: ApplicationScheduleHandle<TInput, TResult>;
  readonly admission: ApplicationScheduleAdmission;
  readonly signal?: AbortSignal;
  readonly removeCompletedOneTime?: () => Promise<void>;
  readonly admissionRunner?: ApplicationScheduleAdmissionRunner;
}

/**
 * Admits one Kubernetes occurrence under a durable PostgreSQL lease. A prior
 * terminal receipt is returned byte-for-byte; concurrent duplicate delivery
 * fails with a retryable error instead of executing the callback twice.
 */
export async function executeKubernetesApplicationScheduleAdmission<TInput extends object, TResult>(
  options: KubernetesScheduleAdmissionAuthorityOptions<TInput, TResult>,
): Promise<ApplicationScheduleOccurrenceReceipt<TResult>> {
  return executePostgresApplicationScheduleAdmission({
    databaseUrl: required(options.databaseUrl, 'Kubernetes schedule PostgreSQL authority'),
    handle: options.handle,
    admission: options.admission,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.removeCompletedOneTime
      ? { afterCompletion: options.removeCompletedOneTime }
      : {}),
    ...(options.admissionRunner ? { admissionRunner: options.admissionRunner } : {}),
  });
}

/** @deprecated Use the provider-neutral PostgreSQL occurrence error. */
export { ApplicationScheduleOccurrenceBusyError as KubernetesScheduleOccurrenceBusyError };

function cronJob<TInput extends object>(request: {
  readonly options: Pick<
    KubernetesApplicationScheduleRuntimeOptions,
    'applicationId' | 'environmentId' | 'namespace' | 'admissionEndpoint'
      | 'authorizationSecretName' | 'authorizationSecretKey' | 'serviceAccountName'
  >;
  readonly image: string;
  readonly name: string;
  readonly definition: ApplicationScheduleDefinitionContract<TInput>;
  readonly instance: ApplicationScheduleInstance<TInput>;
  readonly management?: ApplicationScheduleManagementReceipt;
}): V1CronJob {
  const labels = {
    'app.kubernetes.io/name': request.options.applicationId,
    'app.kubernetes.io/component': 'schedule',
    'applik8s.dev/schedule-definition': safeLabel(request.definition.id),
  };
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: {
      name: request.name,
      namespace: request.options.namespace,
      labels,
      annotations: {
        'applik8s.dev/schedule-revision': request.instance.revision,
        'applik8s.dev/schedule-definition': request.definition.id,
        ...(request.management ? {
          'applik8s.dev/schedule-management-receipt': request.management.id,
          'applik8s.dev/schedule-management-principal': request.management.principalId,
          'applik8s.dev/schedule-management-authority': request.management.authorityRevision,
        } : {}),
      },
    },
    spec: {
      schedule: kubernetesCron(request.instance, request.definition),
      // `every` is elapsed-time cadence and `at` is an absolute instant. Their
      // cron projections are calculated in UTC; applying a user calendar zone
      // here would change the authored schedule around offsets and DST.
      timeZone: request.instance.cron || request.definition.cron
        ? request.instance.timezone ?? request.definition.timezone
        : 'UTC',
      suspend: request.instance.enabled === false,
      concurrencyPolicy: request.definition.overlap === 'skip' ? 'Forbid' : 'Allow',
      failedJobsHistoryLimit: 3,
      successfulJobsHistoryLimit: 1,
      startingDeadlineSeconds: Math.min(
        request.definition.misfires === 'skip'
          ? request.definition.maximumLatenessSeconds
          : request.definition.retry.maximumAgeSeconds,
        2_147_483_647,
      ),
      jobTemplate: {
        metadata: { labels },
        spec: {
          backoffLimit: Math.max(0, request.definition.retry.maxAttempts - 1),
          ttlSecondsAfterFinished: 3_600,
          template: {
            metadata: { labels },
            spec: {
              restartPolicy: 'Never',
              ...(request.options.serviceAccountName
                ? { serviceAccountName: request.options.serviceAccountName }
                : {}),
              containers: [kubernetesApplicationScheduleAdmissionContainer({
                image: request.image,
                endpoint: request.options.admissionEndpoint,
                authorizationSecretName: request.options.authorizationSecretName,
                authorizationSecretKey: request.options.authorizationSecretKey ?? 'key',
                admission: {
                  schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
                  applicationId: request.options.applicationId,
                  environmentId: request.options.environmentId,
                  definitionId: request.definition.id,
                  instanceId: request.instance.id,
                  input: request.instance.input,
                  ...(request.instance.at
                    ? { scheduledAt: new Date(request.instance.at).toISOString() }
                    : {}),
                  ...(request.instance.at && request.instance.deleteAfterCompletion
                    ? { deleteAfterCompletion: true, providerResourceName: request.name }
                    : {}),
                },
              })],
            },
          },
        },
      },
    },
  };
}

export function kubernetesApplicationScheduleCronJob(options: {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly namespace: string;
  readonly name: string;
  readonly image: string;
  readonly admissionEndpoint: string;
  readonly authorizationSecretName: string;
  readonly authorizationSecretKey?: string;
  readonly serviceAccountName?: string;
  readonly definition: ApplicationScheduleDefinitionContract<Record<string, never>>;
}): V1CronJob {
  return cronJob({
    options,
    image: options.image,
    name: options.name,
    definition: options.definition,
    instance: {
      id: 'fixed',
      revision: createHash('sha256').update(JSON.stringify(options.definition)).digest('hex'),
      input: {},
      ...(options.definition.cron ? { cron: options.definition.cron } : {}),
      ...(options.definition.every ? { every: options.definition.every } : {}),
      ...(options.definition.at ? { at: options.definition.at, deleteAfterCompletion: true } : {}),
      timezone: options.definition.timezone,
      enabled: true,
    },
  });
}

export function kubernetesApplicationScheduleAdmissionContainer(options: {
  readonly image: string;
  readonly endpoint: string;
  readonly authorizationSecretName: string;
  readonly authorizationSecretKey: string;
  readonly admission: object;
}): NonNullable<NonNullable<NonNullable<V1CronJob['spec']>['jobTemplate']['spec']>['template']['spec']>['containers'][number] {
  const source = `import{readFile}from'node:fs/promises';const base=JSON.parse(process.env.APPLIK8S_SCHEDULE_ADMISSION);const admittedAt=new Date().toISOString();let scheduledAt=base.scheduledAt;if(!scheduledAt){const token=(await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8')).trim();const namespace=process.env.APPLIK8S_NAMESPACE;const jobName=process.env.APPLIK8S_JOB_NAME;const jobResponse=await fetch('https://kubernetes.default.svc/apis/batch/v1/namespaces/'+encodeURIComponent(namespace)+'/jobs/'+encodeURIComponent(jobName),{headers:{authorization:'Bearer '+token}});if(!jobResponse.ok)throw new Error('Unable to read Kubernetes schedule Job '+jobName+': HTTP '+jobResponse.status);const job=await jobResponse.json();scheduledAt=job?.metadata?.annotations?.['batch.kubernetes.io/cronjob-scheduled-timestamp'];}if(typeof scheduledAt!=='string'||!Number.isFinite(Date.parse(scheduledAt)))throw new Error('Kubernetes schedule Job has no authoritative scheduled timestamp.');const response=await fetch(process.env.APPLIK8S_SCHEDULE_ENDPOINT,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+process.env.APPLIK8S_INTERNAL_OPERATION_SECRET},body:JSON.stringify({...base,scheduledAt:new Date(scheduledAt).toISOString(),admittedAt,attempt:1,schedulerExecutionId:process.env.APPLIK8S_JOB_NAME})});if(!response.ok){console.error(await response.text());process.exit(1)};console.log(await response.text());`;
  return {
    name: 'schedule-admission',
    image: options.image,
    imagePullPolicy: 'IfNotPresent',
    command: ['node', '--input-type=module', '--eval', source],
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
      runAsGroup: 1000,
      runAsNonRoot: true,
      runAsUser: 1000,
    },
    env: [
      { name: 'APPLIK8S_SCHEDULE_ENDPOINT', value: options.endpoint },
      { name: 'APPLIK8S_SCHEDULE_ADMISSION', value: JSON.stringify(options.admission) },
      { name: 'APPLIK8S_JOB_NAME', valueFrom: { fieldRef: { fieldPath: "metadata.labels['batch.kubernetes.io/job-name']" } } },
      { name: 'APPLIK8S_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
      { name: 'NODE_EXTRA_CA_CERTS', value: '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt' },
      { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', valueFrom: { secretKeyRef: { name: options.authorizationSecretName, key: options.authorizationSecretKey } } },
    ],
    resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { memory: '64Mi' } },
  };
}

function kubernetesCron<TInput extends object>(instance: ApplicationScheduleInstance<TInput>, definition: ApplicationScheduleDefinitionContract<TInput>): string {
  const cron = instance.cron ?? definition.cron;
  if (cron) return cron;
  const every = instance.every ?? definition.every;
  if (every) {
    return exactFiveFieldCronForInterval(every);
  }
  const at = instance.at ?? definition.at;
  if (!at) throw new Error(`Kubernetes schedule ${definition.id} has no cadence.`);
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error(`Kubernetes schedule ${definition.id} has invalid one-time timestamp ${at}.`);
  return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}

function dynamicScheduleName(options: KubernetesApplicationScheduleRuntimeOptions, definitionId: string, instanceId: string): string {
  const suffix = createHash('sha256').update(`${options.applicationId}\0${options.environmentId}\0${definitionId}\0${instanceId}`).digest('hex').slice(0, 20);
  return `applik8s-${safeLabel(definitionId).slice(0, 24)}-${suffix}`.slice(0, 63).replace(/-+$/u, '');
}

function safeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '') || 'schedule';
}

function validateOptions(options: KubernetesApplicationScheduleRuntimeOptions): void {
  if (!options.stateAuthority && !options.databaseUrl?.trim()) {
    throw new Error('Kubernetes Scheduler runtime databaseUrl is required when no stateAuthority is injected.');
  }
  for (const [name, value] of Object.entries(options)) {
    if (name === 'kubeConfig' || name === 'authorizationSecretKey' || name === 'serviceAccountName' || name === 'image' || name === 'maximumInstances' || name === 'admissionRunner' || name === 'stateAuthority' || name === 'databaseUrl') continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Kubernetes Scheduler runtime ${name} is required.`);
  }
  const maximumInstances = options.maximumInstances
    ?? DEFAULT_KUBERNETES_SCHEDULE_INSTANCE_CEILING;
  if (!Number.isSafeInteger(maximumInstances) || maximumInstances < 1) {
    throw new Error('Kubernetes schedule maximumInstances must be a positive integer.');
  }
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function statusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'code');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(cause, 'response');
  return response && typeof response === 'object' && typeof Reflect.get(response, 'statusCode') === 'number'
    ? Reflect.get(response, 'statusCode') as number
    : undefined;
}
