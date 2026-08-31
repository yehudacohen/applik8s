// typecast-file-boundary: Kubernetes client responses are narrowed through the
// exact Job identity and framework annotations before entering typed receipts.
import { createHash } from 'node:crypto';
import type {
  ApplicationJobReference,
  ApplicationJobRuntime,
} from '@applik8s/applik8s/job';
import { createDurableApplicationJobRuntime } from '@applik8s/applik8s/job-runtime-durable';
import type {
  ApplicationJobStore,
  ApplicationJobStoredRun,
} from '@applik8s/applik8s/job-store';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import { createPostgresApplicationJobStore } from '@applik8s/runtime-postgres/job-store';
import type {
  BatchV1Api,
  KubeConfig,
  V1EnvVar,
  V1Job,
} from '@kubernetes/client-node';

export const kubernetesApplicationJobDispatchProtocol = 'applik8s.kubernetes-job-dispatch/v1alpha1' as const;

const managedBy = 'applik8s-job-runtime';
const runIdAnnotation = 'jobs.applik8s.dev/run-id';
const jobIdAnnotation = 'jobs.applik8s.dev/job-id';
const inputDigestAnnotation = 'jobs.applik8s.dev/input-digest';
const specDigestAnnotation = 'jobs.applik8s.dev/spec-digest';

export interface KubernetesApplicationJobDispatcherOptions {
  readonly applicationId: string;
  readonly deploymentId: string;
  readonly namespace: string;
  /** Immutable worker/controller artifact used for every finite Job attempt. */
  readonly image: string;
  readonly serviceAccountName?: string;
  readonly imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  readonly workerCommand?: readonly string[];
  readonly workerArguments?: readonly string[];
  readonly environment?: readonly V1EnvVar[];
  readonly ttlSecondsAfterFinished?: number;
  readonly terminationGracePeriodSeconds?: number;
  readonly kubeConfig?: KubeConfig;
  /** Test/provider seam; ordinary callers supply a KubeConfig or use ambient configuration. */
  readonly api?: Pick<BatchV1Api, 'createNamespacedJob' | 'readNamespacedJob' | 'deleteNamespacedJob'>;
}

export interface KubernetesApplicationJobDispatchReceipt {
  readonly protocol: typeof kubernetesApplicationJobDispatchProtocol;
  readonly run: ApplicationJobReference;
  readonly resource: {
    readonly apiVersion: 'batch/v1';
    readonly kind: 'Job';
    readonly namespace: string;
    readonly name: string;
    readonly uid: string;
  };
  readonly state: 'created' | 'existing';
  readonly specDigest: string;
}

export interface KubernetesApplicationJobCancellationReceipt {
  readonly protocol: typeof kubernetesApplicationJobDispatchProtocol;
  readonly run: ApplicationJobReference;
  readonly state: 'absent' | 'deletionRequested';
  readonly resource: {
    readonly namespace: string;
    readonly name: string;
    readonly uid?: string;
  };
}

export interface KubernetesApplicationJobObservation {
  readonly run: ApplicationJobReference;
  readonly resource: {
    readonly namespace: string;
    readonly name: string;
    readonly uid: string;
  };
  readonly phase: 'pending' | 'running' | 'succeeded' | 'failed' | 'terminating';
  readonly active: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface KubernetesApplicationJobDispatcher {
  readonly dispatch: (run: ApplicationJobStoredRun) => Promise<KubernetesApplicationJobDispatchReceipt>;
  readonly cancel: (run: ApplicationJobStoredRun) => Promise<KubernetesApplicationJobCancellationReceipt>;
  readonly observe: (run: ApplicationJobStoredRun) => Promise<KubernetesApplicationJobObservation | undefined>;
}

export interface KubernetesApplicationJobRuntimeOptions extends KubernetesApplicationJobDispatcherOptions {
  readonly databaseUrl?: string;
  readonly store?: ApplicationJobStore;
  readonly dispatcher?: KubernetesApplicationJobDispatcher;
  /** Present only inside one provider-created finite worker. */
  readonly workerRunId?: string;
  readonly workerId?: string;
  readonly leaseSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly resultRetentionSeconds?: number;
  readonly progressRetentionSeconds?: number;
}

export interface KubernetesApplicationJobRuntime extends ApplicationJobRuntime {
  readonly close: () => Promise<void>;
}

export class KubernetesApplicationJobDispatchError extends Error {
  readonly code = 'JOB_KUBERNETES_DISPATCH_FAILED' as const;
  readonly run: ApplicationJobReference;
  readonly resource: { readonly namespace: string; readonly name: string };

  constructor(
    message: string,
    run: ApplicationJobReference,
    resource: { readonly namespace: string; readonly name: string },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'KubernetesApplicationJobDispatchError';
    this.run = run;
    this.resource = resource;
  }
}

/**
 * Assembles the durable provider runtime in either controller mode (admit and
 * converge a Kubernetes Job) or exact-run worker mode (claim and execute one
 * logical run from the same immutable artifact).
 */
export async function createKubernetesApplicationJobRuntime(
  options: KubernetesApplicationJobRuntimeOptions,
): Promise<KubernetesApplicationJobRuntime> {
  const store = options.store ?? createPostgresApplicationJobStore({
    databaseUrl: required(options.databaseUrl, 'Kubernetes Job PostgreSQL state authority'),
    applicationId: options.applicationId,
    deploymentId: options.deploymentId,
  });
  const ownsStore = !options.store;
  const workerMode = options.workerRunId !== undefined;
  const workerRunId = workerMode
    ? required(options.workerRunId, 'Kubernetes Job worker run ID')
    : undefined;
  const dispatcher = workerMode
    ? options.dispatcher
    : options.dispatcher ?? await createKubernetesApplicationJobDispatcher(options);
  const dispatch = async (run: ApplicationJobStoredRun): Promise<void> => {
    if (!dispatcher) throw new Error('Kubernetes Job controller dispatcher is unavailable.');
    await dispatcher.dispatch(run);
  };
  const cancelDispatch = async (run: ApplicationJobStoredRun): Promise<void> => {
    if (!dispatcher) throw new Error('Kubernetes Job controller dispatcher is unavailable.');
    await dispatcher.cancel(run);
  };
  const durable = createDurableApplicationJobRuntime({
    store,
    application: options.applicationId,
    deployment: options.deploymentId,
    executeWorkers: workerMode,
    ...(workerRunId ? { claimRunId: workerRunId } : {}),
    ...(options.workerId ? { workerId: options.workerId } : {}),
    ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
    ...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
    ...(options.resultRetentionSeconds ? { resultRetentionSeconds: options.resultRetentionSeconds } : {}),
    ...(options.progressRetentionSeconds ? { progressRetentionSeconds: options.progressRetentionSeconds } : {}),
    ...(!workerMode ? {
      dispatch,
      cancelDispatch,
    } : {}),
  });
  return {
    ...durable,
    async close() {
      await durable.close();
      if (ownsStore && 'close' in store && typeof store.close === 'function') await store.close();
    },
  };
}

/**
 * Creates the provider-side convergence seam used by the durable Job controller.
 * Runtime-created Jobs are intentionally not TypeKro graph children: their
 * durable run is the owner, and each create/delete is UID- and digest-guarded.
 */
export async function createKubernetesApplicationJobDispatcher(
  options: KubernetesApplicationJobDispatcherOptions,
): Promise<KubernetesApplicationJobDispatcher> {
  validateOptions(options);
  let api = options.api;
  if (!api) {
    // static-import-exception: Kubernetes is loaded only when this provider is selected.
    const kubernetes = await import('@kubernetes/client-node');
    const kubeConfig = options.kubeConfig ?? new kubernetes.KubeConfig();
    if (!options.kubeConfig) {
      if (process.env.KUBERNETES_SERVICE_HOST) kubeConfig.loadFromCluster();
      else kubeConfig.loadFromDefault();
    }
    api = kubeConfig.makeApiClient(kubernetes.BatchV1Api);
  }
  const batch = api;

  const desiredFor = (run: ApplicationJobStoredRun): { readonly body: V1Job; readonly digest: string } => {
    const body = kubernetesJob(options, run);
    const digest = jobSpecDigest(body);
    const annotations = body.metadata?.annotations;
    if (!annotations) throw new Error('Framework-generated Kubernetes Job metadata annotations are missing.');
    annotations[specDigestAnnotation] = digest;
    return { body, digest };
  };

  const readExact = async (run: ApplicationJobStoredRun): Promise<V1Job | undefined> => {
    const name = kubernetesApplicationJobName(options, run.reference.runId);
    try {
      const live = await batch.readNamespacedJob({ namespace: options.namespace, name });
      assertOwnedJob(live, run, options.namespace, name);
      return live;
    } catch (cause) {
      if (kubernetesErrorStatusCode(cause) === 404) return undefined;
      if (cause instanceof KubernetesApplicationJobDispatchError) throw cause;
      throw new KubernetesApplicationJobDispatchError(
        `Could not read Kubernetes Job ${options.namespace}/${name} for run ${run.reference.runId}.`,
        run.reference,
        { namespace: options.namespace, name },
        { cause },
      );
    }
  };

  return {
    async dispatch(run) {
      const { body, digest } = desiredFor(run);
      const name = required(body.metadata?.name, 'Framework-generated Kubernetes Job name');
      let live: V1Job;
      let state: 'created' | 'existing';
      try {
        live = await batch.createNamespacedJob({
          namespace: options.namespace,
          body,
          fieldManager: managedBy,
          fieldValidation: 'Strict',
        });
        state = 'created';
      } catch (cause) {
        if (kubernetesErrorStatusCode(cause) !== 409) {
          throw new KubernetesApplicationJobDispatchError(
            `Could not create Kubernetes Job ${options.namespace}/${name} for run ${run.reference.runId}.`,
            run.reference,
            { namespace: options.namespace, name },
            { cause },
          );
        }
        const existing = await readExact(run);
        if (!existing) {
          throw new KubernetesApplicationJobDispatchError(
            `Kubernetes reported a conflict for Job ${options.namespace}/${name}, but the exact resource could not be read.`,
            run.reference,
            { namespace: options.namespace, name },
            { cause },
          );
        }
        live = existing;
        state = 'existing';
      }
      assertOwnedJob(live, run, options.namespace, name, digest);
      if (live.metadata?.deletionTimestamp) {
        throw new KubernetesApplicationJobDispatchError(
          `Kubernetes Job ${options.namespace}/${name} is terminating; run ${run.reference.runId} remains durable and can be rejoined.`,
          run.reference,
          { namespace: options.namespace, name },
        );
      }
      return {
        protocol: kubernetesApplicationJobDispatchProtocol,
        run: run.reference,
        resource: {
          apiVersion: 'batch/v1',
          kind: 'Job',
          namespace: options.namespace,
          name,
          uid: required(live.metadata?.uid, `Kubernetes Job ${options.namespace}/${name} UID`),
        },
        state,
        specDigest: digest,
      };
    },
    async cancel(run) {
      const name = kubernetesApplicationJobName(options, run.reference.runId);
      const live = await readExact(run);
      if (!live) {
        return {
          protocol: kubernetesApplicationJobDispatchProtocol,
          run: run.reference,
          state: 'absent',
          resource: { namespace: options.namespace, name },
        };
      }
      const uid = required(live.metadata?.uid, `Kubernetes Job ${options.namespace}/${name} UID`);
      try {
        await batch.deleteNamespacedJob({
          namespace: options.namespace,
          name,
          propagationPolicy: 'Background',
          body: {
            apiVersion: 'v1',
            kind: 'DeleteOptions',
            preconditions: { uid },
            propagationPolicy: 'Background',
          },
        });
      } catch (cause) {
        if (kubernetesErrorStatusCode(cause) === 404) {
          return {
            protocol: kubernetesApplicationJobDispatchProtocol,
            run: run.reference,
            state: 'absent',
            resource: { namespace: options.namespace, name },
          };
        }
        throw new KubernetesApplicationJobDispatchError(
          `Could not cancel Kubernetes Job ${options.namespace}/${name} for run ${run.reference.runId}.`,
          run.reference,
          { namespace: options.namespace, name },
          { cause },
        );
      }
      return {
        protocol: kubernetesApplicationJobDispatchProtocol,
        run: run.reference,
        state: 'deletionRequested',
        resource: { namespace: options.namespace, name, uid },
      };
    },
    async observe(run) {
      const name = kubernetesApplicationJobName(options, run.reference.runId);
      const live = await readExact(run);
      if (!live) return undefined;
      const active = live.status?.active ?? 0;
      const succeeded = live.status?.succeeded ?? 0;
      const failed = live.status?.failed ?? 0;
      return {
        run: run.reference,
        resource: {
          namespace: options.namespace,
          name,
          uid: required(live.metadata?.uid, `Kubernetes Job ${options.namespace}/${name} UID`),
        },
        phase: live.metadata?.deletionTimestamp
          ? 'terminating'
          : succeeded > 0
            ? 'succeeded'
            : active > 0
              ? 'running'
              : failed > 0
                ? 'failed'
                : 'pending',
        active,
        succeeded,
        failed,
      };
    },
  };
}

export function kubernetesApplicationJobName(
  options: Pick<KubernetesApplicationJobDispatcherOptions, 'applicationId' | 'deploymentId'>,
  runId: string,
): string {
  const digest = createHash('sha256')
    .update(`${options.applicationId}\0${options.deploymentId}\0${runId}`)
    .digest('hex')
    .slice(0, 24);
  return `applik8s-job-${digest}`;
}

function kubernetesJob(
  options: KubernetesApplicationJobDispatcherOptions,
  run: ApplicationJobStoredRun,
): V1Job {
  const name = kubernetesApplicationJobName(options, run.reference.runId);
  const selectorLabels = {
    'app.kubernetes.io/managed-by': managedBy,
    'jobs.applik8s.dev/run': shortDigest(run.reference.runId),
  };
  const deadlineSeconds = run.deadline
    ? Math.max(1, Math.ceil((Date.parse(run.deadline) - Date.parse(run.admittedAt)) / 1_000))
    : undefined;
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name,
      namespace: options.namespace,
      labels: selectorLabels,
      annotations: {
        [runIdAnnotation]: run.reference.runId,
        [jobIdAnnotation]: run.reference.job,
        [inputDigestAnnotation]: run.inputDigest,
        [specDigestAnnotation]: '',
      },
    },
    spec: {
      // Kubernetes restarts only infrastructure-lost worker Pods. The durable
      // store remains authoritative for logical attempts, leases, fencing,
      // authored failures, and terminal uniqueness. Giving the Job the same
      // bounded retry budget lets a replacement Pod reattach to the exact run
      // after the previous worker lease expires without creating a new run.
      backoffLimit: Math.max(0, run.maximumAttempts - 1),
      ...(deadlineSeconds ? { activeDeadlineSeconds: deadlineSeconds } : {}),
      ...(options.ttlSecondsAfterFinished === undefined
        ? { ttlSecondsAfterFinished: 3_600 }
        : { ttlSecondsAfterFinished: options.ttlSecondsAfterFinished }),
      template: {
        metadata: { labels: selectorLabels },
        spec: {
          restartPolicy: 'Never',
          ...(options.serviceAccountName ? { serviceAccountName: options.serviceAccountName } : {}),
          terminationGracePeriodSeconds: options.terminationGracePeriodSeconds ?? 30,
          containers: [{
            name: 'worker',
            image: options.image,
            imagePullPolicy: options.imagePullPolicy ?? 'IfNotPresent',
            ...(options.workerCommand ? { command: [...options.workerCommand] } : {}),
            args: [
              ...(options.workerArguments ?? []),
              '--applik8s-job-run',
              run.reference.runId,
            ],
            env: [
              ...(options.environment ?? []),
              { name: 'APPLIK8S_JOB_RUN_ID', value: run.reference.runId },
              { name: 'APPLIK8S_JOB_ID', value: run.reference.job },
            ],
          }],
        },
      },
    },
  };
}

function jobSpecDigest(job: V1Job): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJsonV1String({
      apiVersion: job.apiVersion,
      kind: job.kind,
      metadata: {
        name: job.metadata?.name,
        namespace: job.metadata?.namespace,
        labels: job.metadata?.labels,
        annotations: Object.fromEntries(
          Object.entries(job.metadata?.annotations ?? {}).filter(([key]) => key !== specDigestAnnotation),
        ),
      },
      spec: job.spec,
    }, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
}

function assertOwnedJob(
  live: V1Job,
  run: ApplicationJobStoredRun,
  namespace: string,
  name: string,
  desiredDigest?: string,
): void {
  const annotations = live.metadata?.annotations ?? {};
  const actualRun = annotations[runIdAnnotation];
  const actualJob = annotations[jobIdAnnotation];
  const actualDigest = annotations[specDigestAnnotation];
  if (actualRun !== run.reference.runId || actualJob !== run.reference.job) {
    throw new KubernetesApplicationJobDispatchError(
      `Kubernetes Job ${namespace}/${name} is not owned by finite run ${run.reference.runId}; refusing to adopt or delete it.`,
      run.reference,
      { namespace, name },
    );
  }
  if (desiredDigest && actualDigest !== desiredDigest) {
    throw new KubernetesApplicationJobDispatchError(
      `Kubernetes Job ${namespace}/${name} has spec digest ${actualDigest ?? '<missing>'}, expected ${desiredDigest}; refusing mutable adoption.`,
      run.reference,
      { namespace, name },
    );
  }
}

function validateOptions(options: KubernetesApplicationJobDispatcherOptions): void {
  required(options.applicationId, 'Kubernetes Job applicationId');
  required(options.deploymentId, 'Kubernetes Job deploymentId');
  required(options.namespace, 'Kubernetes Job namespace');
  if (!/@sha256:[a-f0-9]{64}$/u.test(options.image)) {
    throw new TypeError('Kubernetes Job image must be pinned to an immutable sha256 digest.');
  }
  for (const variable of options.environment ?? []) {
    if (variable.name === 'APPLIK8S_JOB_RUN_ID' || variable.name === 'APPLIK8S_JOB_ID') {
      throw new TypeError(`Kubernetes Job environment cannot override framework variable ${variable.name}.`);
    }
  }
  if (options.ttlSecondsAfterFinished !== undefined
    && (!Number.isSafeInteger(options.ttlSecondsAfterFinished) || options.ttlSecondsAfterFinished < 0)) {
    throw new TypeError('Kubernetes Job ttlSecondsAfterFinished must be a non-negative integer.');
  }
}

function kubernetesErrorStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'code');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(cause, 'response');
  if (response && typeof response === 'object') {
    const nested = Reflect.get(response, 'statusCode') ?? Reflect.get(response, 'status');
    if (typeof nested === 'number') return nested;
  }
  const body = Reflect.get(cause, 'body');
  if (body && typeof body === 'object' && typeof Reflect.get(body, 'code') === 'number') {
    return Reflect.get(body, 'code') as number;
  }
  return undefined;
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function shortDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}
