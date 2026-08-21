// typecast-file-boundary: Kubernetes custom-object responses are narrowed by API version and kind before schedule execution.
import { createHash, randomUUID } from 'node:crypto';
import {
  applicationScheduleOccurrenceId,
  executeApplicationScheduleAdmission,
  type ApplicationScheduleAdmission,
  type ApplicationScheduleConvergenceResult,
  type ApplicationScheduleDefinitionContract,
  type ApplicationScheduleHandle,
  type ApplicationScheduleHandler,
  type ApplicationScheduleInstance,
  type ApplicationScheduleOccurrenceReceipt,
  type ApplicationScheduleRuntime,
} from '@applik8s/applik8s';
import type { BatchV1Api, KubeConfig, V1CronJob } from '@kubernetes/client-node';
import postgres, { type Sql } from 'postgres';

const admissionImage = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface KubernetesApplicationScheduleRuntimeOptions {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly namespace: string;
  readonly admissionEndpoint: string;
  readonly authorizationSecretName: string;
  readonly authorizationSecretKey?: string;
  readonly kubeConfig?: KubeConfig;
  readonly image?: string;
}

export interface KubernetesApplicationScheduleRuntime extends ApplicationScheduleRuntime {
  /** Removes an exact, already-authorized CronJob identity after one-time execution. */
  readonly removeResource: (name: string) => Promise<void>;
}

/**
 * Kubernetes implementation of the function-native dynamic Scheduler surface.
 * CronJobs are ordinary application-owned resources; PostgreSQL remains the
 * canonical occurrence and overlap authority at admission time.
 */
export async function createKubernetesApplicationScheduleRuntime(
  options: KubernetesApplicationScheduleRuntimeOptions,
): Promise<KubernetesApplicationScheduleRuntime> {
  validateOptions(options);
  // static-import-exception: lazy loading keeps the Kubernetes SDK out of non-Kubernetes application hosts.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = options.kubeConfig ?? new kubernetes.KubeConfig();
  if (!options.kubeConfig) {
    if (process.env.KUBERNETES_SERVICE_HOST) kubeConfig.loadFromCluster();
    else kubeConfig.loadFromDefault();
  }
  const api = kubeConfig.makeApiClient(kubernetes.BatchV1Api);
  const image = options.image ?? admissionImage;
  return {
    async invoke<TInput extends object, TResult>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly input: TInput;
      readonly handler: ApplicationScheduleHandler<TInput, TResult>;
    }): Promise<TResult> {
      const now = new Date().toISOString();
      return request.handler(request.input, {
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId: applicationScheduleOccurrenceId({
          applicationId: options.applicationId,
          environmentId: options.environmentId,
          definitionId: request.definition.id,
          instanceId: 'immediate',
          scheduledAt: now,
        }),
        scheduledAt: now,
        admittedAt: now,
        startedAt: now,
        attempt: 1,
        trigger: 'immediate',
        signal: new AbortController().signal,
      });
    },
    async reconcile<TInput extends object>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly instance: ApplicationScheduleInstance<TInput>;
      readonly handler: ApplicationScheduleHandler<TInput, unknown>;
    }): Promise<ApplicationScheduleConvergenceResult> {
      if (request.definition.configuration !== 'dynamic') {
        throw new Error(`Kubernetes Scheduler cannot reconcile dynamic instance state for fixed definition ${request.definition.id}.`);
      }
      const name = dynamicScheduleName(options, request.definition.id, request.instance.id);
      const desired = cronJob({
        options,
        image,
        name,
        definition: request.definition,
        instance: request.instance,
      });
      let existing: V1CronJob | undefined;
      try {
        existing = await api.readNamespacedCronJob({ namespace: options.namespace, name });
      } catch (cause) {
        if (statusCode(cause) !== 404) throw cause;
      }
      const desiredRevision = request.instance.revision;
      if (existing?.metadata?.annotations?.['applik8s.dev/schedule-revision'] === desiredRevision
        && kubernetesScheduleResourceMatches(existing, desired)) {
        return { definitionId: request.definition.id, instanceId: request.instance.id, revision: desiredRevision, state: 'unchanged' };
      }
      if (existing) {
        if (existing.metadata?.resourceVersion) desired.metadata!.resourceVersion = existing.metadata.resourceVersion;
        await api.replaceNamespacedCronJob({ namespace: options.namespace, name, body: desired, fieldManager: 'applik8s-scheduler', fieldValidation: 'Strict' });
      } else {
        await api.createNamespacedCronJob({ namespace: options.namespace, body: desired, fieldManager: 'applik8s-scheduler', fieldValidation: 'Strict' });
      }
      return { definitionId: request.definition.id, instanceId: request.instance.id, revision: desiredRevision, state: existing ? 'updated' : 'created' };
    },
    async remove(definitionId, instanceId) {
      const name = dynamicScheduleName(options, definitionId, instanceId);
      const removed = await deleteKubernetesScheduleResource(api, options.namespace, name);
      return removed
        ? { definitionId, instanceId, revision: 'deleted', state: 'removed' }
        : { definitionId, instanceId, revision: 'absent', state: 'unchanged' };
    },
    async removeResource(name) {
      if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(name) || name.length > 253) {
        throw new Error(`Kubernetes schedule cleanup resource name ${name} is invalid.`);
      }
      await deleteKubernetesScheduleResource(api, options.namespace, name);
    },
  };
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
}

/**
 * Admits one Kubernetes occurrence under a durable PostgreSQL lease. A prior
 * terminal receipt is returned byte-for-byte; concurrent duplicate delivery
 * fails with a retryable error instead of executing the callback twice.
 */
export async function executeKubernetesApplicationScheduleAdmission<TInput extends object, TResult>(
  options: KubernetesScheduleAdmissionAuthorityOptions<TInput, TResult>,
): Promise<ApplicationScheduleOccurrenceReceipt<TResult>> {
  const sql = postgres(required(options.databaseUrl, 'Kubernetes schedule PostgreSQL authority'), { max: 2 });
  try {
    await ensureAuthority(sql);
    const occurrenceId = applicationScheduleOccurrenceId({
      applicationId: options.admission.applicationId,
      environmentId: options.admission.environmentId,
      definitionId: options.admission.definitionId,
      instanceId: options.admission.instanceId,
      scheduledAt: options.admission.scheduledAt,
      ...(options.admission.schedulerExecutionId ? { schedulerExecutionId: options.admission.schedulerExecutionId } : {}),
    });
    const overlapKey = options.handle.definition.overlapBy
      ? options.handle.definition.overlapBy((options.admission.input ?? {}) as TInput)
      : options.admission.instanceId;
    const claim = await claimOccurrence(sql, {
      occurrenceId,
      definitionId: options.admission.definitionId,
      overlapKey,
      overlap: options.handle.definition.overlap,
    });
    if (claim.state === 'complete') return claim.receipt as ApplicationScheduleOccurrenceReceipt<TResult>;
    if (claim.state === 'busy') throw new KubernetesScheduleOccurrenceBusyError(occurrenceId);
    if (claim.state === 'skipped') return claim.receipt as ApplicationScheduleOccurrenceReceipt<TResult>;
    const receipt = await executeApplicationScheduleAdmission(options.handle, options.admission, options.signal);
    if (receipt.state === 'succeeded' || receipt.state === 'skipped') {
      if (!await completeOccurrence(sql, occurrenceId, claim.owner, receipt)) {
        throw new Error(`Kubernetes schedule occurrence ${occurrenceId} lost its durable execution lease.`);
      }
      await options.removeCompletedOneTime?.();
      return receipt;
    }
    await releaseOccurrence(sql, occurrenceId, claim.owner, receipt);
    return receipt;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export class KubernetesScheduleOccurrenceBusyError extends Error {
  readonly code = 'SCHEDULE_OCCURRENCE_BUSY';
  constructor(readonly occurrenceId: string) {
    super(`Kubernetes schedule occurrence ${occurrenceId} is already executing under another lease.`);
    this.name = 'KubernetesScheduleOccurrenceBusyError';
  }
}

function cronJob<TInput extends object>(request: {
  readonly options: KubernetesApplicationScheduleRuntimeOptions;
  readonly image: string;
  readonly name: string;
  readonly definition: ApplicationScheduleDefinitionContract<TInput>;
  readonly instance: ApplicationScheduleInstance<TInput>;
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
      },
    },
    spec: {
      schedule: kubernetesCron(request.instance, request.definition),
      timeZone: request.instance.timezone ?? request.definition.timezone,
      suspend: request.instance.enabled === false,
      concurrencyPolicy: request.definition.overlap === 'skip' ? 'Forbid' : 'Allow',
      failedJobsHistoryLimit: 3,
      successfulJobsHistoryLimit: 1,
      startingDeadlineSeconds: Math.min(request.definition.retry.maximumAgeSeconds, 2_147_483_647),
      jobTemplate: {
        metadata: { labels },
        spec: {
          backoffLimit: Math.max(0, request.definition.retry.maxAttempts - 1),
          ttlSecondsAfterFinished: 3_600,
          template: {
            metadata: { labels },
            spec: {
              restartPolicy: 'Never',
              containers: [admissionContainer({
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

function admissionContainer(options: {
  readonly image: string;
  readonly endpoint: string;
  readonly authorizationSecretName: string;
  readonly authorizationSecretKey: string;
  readonly admission: object;
}): NonNullable<NonNullable<NonNullable<V1CronJob['spec']>['jobTemplate']['spec']>['template']['spec']>['containers'][number] {
  const source = `const base=JSON.parse(process.env.APPLIK8S_SCHEDULE_ADMISSION);const now=new Date().toISOString();const response=await fetch(process.env.APPLIK8S_SCHEDULE_ENDPOINT,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+process.env.APPLIK8S_INTERNAL_OPERATION_SECRET},body:JSON.stringify({...base,scheduledAt:now,admittedAt:now,attempt:1,schedulerExecutionId:process.env.APPLIK8S_JOB_NAME})});if(!response.ok){console.error(await response.text());process.exit(1)};console.log(await response.text());`;
  return {
    name: 'schedule-admission',
    image: options.image,
    imagePullPolicy: 'IfNotPresent',
    command: ['node', '--input-type=module', '--eval', source],
    env: [
      { name: 'APPLIK8S_SCHEDULE_ENDPOINT', value: options.endpoint },
      { name: 'APPLIK8S_SCHEDULE_ADMISSION', value: JSON.stringify(options.admission) },
      { name: 'APPLIK8S_JOB_NAME', valueFrom: { fieldRef: { fieldPath: "metadata.labels['batch.kubernetes.io/job-name']" } } },
      { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', valueFrom: { secretKeyRef: { name: options.authorizationSecretName, key: options.authorizationSecretKey } } },
    ],
    resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { memory: '64Mi' } },
    securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: true, capabilities: { drop: ['ALL'] } },
  };
}

function kubernetesCron<TInput extends object>(instance: ApplicationScheduleInstance<TInput>, definition: ApplicationScheduleDefinitionContract<TInput>): string {
  const cron = instance.cron ?? definition.cron;
  if (cron) return cron;
  const every = instance.every ?? definition.every;
  if (every) {
    const match = /^(\d+)(m|h|d)$/u.exec(every);
    if (!match) throw new Error(`Kubernetes CronJob schedule ${definition.id} requires minute-or-coarser cadence; received ${every}.`);
    const amount = Number(match[1]);
    if (match[2] === 'm') return amount === 1 ? '* * * * *' : `*/${amount} * * * *`;
    if (match[2] === 'h') return amount === 1 ? '0 * * * *' : `0 */${amount} * * *`;
    return amount === 1 ? '0 0 * * *' : `0 0 */${amount} * *`;
  }
  const at = instance.at ?? definition.at;
  if (!at) throw new Error(`Kubernetes schedule ${definition.id} has no cadence.`);
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error(`Kubernetes schedule ${definition.id} has invalid one-time timestamp ${at}.`);
  return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}

async function ensureAuthority(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS applik8s_schedule_occurrences (
    occurrence_id text PRIMARY KEY,
    definition_id text NOT NULL,
    overlap_key text NOT NULL,
    state text NOT NULL CHECK (state IN ('running', 'succeeded', 'skipped')),
    lease_owner text,
    lease_until timestamptz,
    receipt jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS applik8s_schedule_occurrences_overlap ON applik8s_schedule_occurrences (definition_id, overlap_key, state, lease_until)`;
}

type Claim =
  | { readonly state: 'claimed'; readonly owner: string }
  | { readonly state: 'complete'; readonly receipt: unknown }
  | { readonly state: 'skipped'; readonly receipt: unknown }
  | { readonly state: 'busy' };

async function claimOccurrence(sql: Sql, options: { readonly occurrenceId: string; readonly definitionId: string; readonly overlapKey: string; readonly overlap: 'allow' | 'skip' }): Promise<Claim> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [options.definitionId, options.overlapKey]);
    const prior = await transaction<{ state: string; receipt: unknown }[]>`SELECT state, receipt FROM applik8s_schedule_occurrences WHERE occurrence_id = ${options.occurrenceId}`;
    if (prior[0]?.state === 'succeeded' || prior[0]?.state === 'skipped') return { state: 'complete', receipt: prior[0].receipt };
    if (prior[0]?.state === 'running') {
      const reclaimed = await transaction<{ occurrence_id: string }[]>`UPDATE applik8s_schedule_occurrences SET lease_owner = ${randomUUID()}, lease_until = now() + interval '5 minutes', updated_at = now() WHERE occurrence_id = ${options.occurrenceId} AND lease_until < now() RETURNING occurrence_id`;
      if (reclaimed.length === 0) return { state: 'busy' };
    }
    if (options.overlap === 'skip') {
      const active = await transaction<{ occurrence_id: string }[]>`SELECT occurrence_id FROM applik8s_schedule_occurrences WHERE definition_id = ${options.definitionId} AND overlap_key = ${options.overlapKey} AND state = 'running' AND lease_until >= now() AND occurrence_id <> ${options.occurrenceId} LIMIT 1`;
      if (active.length > 0) {
        const receipt = { occurrenceId: options.occurrenceId, definitionId: options.definitionId, instanceId: options.overlapKey, scheduledAt: new Date().toISOString(), state: 'skipped', attempts: 0 };
        await transaction`INSERT INTO applik8s_schedule_occurrences (occurrence_id, definition_id, overlap_key, state, receipt) VALUES (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'skipped', ${transaction.json(receipt)}) ON CONFLICT (occurrence_id) DO NOTHING`;
        return { state: 'skipped', receipt };
      }
    }
    const owner = randomUUID();
    await transaction`INSERT INTO applik8s_schedule_occurrences (occurrence_id, definition_id, overlap_key, state, lease_owner, lease_until) VALUES (${options.occurrenceId}, ${options.definitionId}, ${options.overlapKey}, 'running', ${owner}, now() + interval '5 minutes') ON CONFLICT (occurrence_id) DO UPDATE SET lease_owner = ${owner}, lease_until = now() + interval '5 minutes', updated_at = now() WHERE applik8s_schedule_occurrences.state = 'running'`;
    return { state: 'claimed', owner };
  });
}

async function completeOccurrence(sql: Sql, id: string, owner: string, receipt: unknown): Promise<boolean> {
  const rows = await sql<{ occurrence_id: string }[]>`UPDATE applik8s_schedule_occurrences SET state = ${(receipt as { state: string }).state}, receipt = ${sql.json(JSON.parse(JSON.stringify(receipt)))}, lease_owner = NULL, lease_until = NULL, updated_at = now() WHERE occurrence_id = ${id} AND state = 'running' AND lease_owner = ${owner} RETURNING occurrence_id`;
  return rows.length === 1;
}

async function releaseOccurrence(sql: Sql, id: string, owner: string, receipt: unknown): Promise<void> {
  await sql`UPDATE applik8s_schedule_occurrences SET receipt = ${sql.json(JSON.parse(JSON.stringify(receipt)))}, lease_owner = NULL, lease_until = now(), updated_at = now() WHERE occurrence_id = ${id} AND state = 'running' AND lease_owner = ${owner}`;
}

function dynamicScheduleName(options: KubernetesApplicationScheduleRuntimeOptions, definitionId: string, instanceId: string): string {
  const suffix = createHash('sha256').update(`${options.applicationId}\0${options.environmentId}\0${definitionId}\0${instanceId}`).digest('hex').slice(0, 20);
  return `applik8s-${safeLabel(definitionId).slice(0, 24)}-${suffix}`.slice(0, 63).replace(/-+$/u, '');
}

function safeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '') || 'schedule';
}

function validateOptions(options: KubernetesApplicationScheduleRuntimeOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (name === 'kubeConfig' || name === 'authorizationSecretKey' || name === 'image') continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Kubernetes Scheduler runtime ${name} is required.`);
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
