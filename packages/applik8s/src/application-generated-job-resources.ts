import type { NormalizedOperationPlan, OperationTarget, PlanTargetOptions, Result } from '@applik8s/core';
import { addApplicationGraphNode, type ApplicationGraphState } from './application-graph-state.js';
import { graphResourceId, kubernetesNameSegment } from './application-identifiers.js';
import {
  applicationGeneratedJobDurableStatus,
  applicationGeneratedJobObservability,
  applicationGeneratedJobPhase,
  applicationGeneratedJobPhaseStatusContract,
  applicationGeneratedJobRetry,
  applicationGeneratedJobRuntime,
  applicationGeneratedJobStatusLifecycle,
  applicationGeneratedJobStatusUpdater,
} from './application-jobs.js';
import { applicationModelMigrationPlan, applicationModelMigrationPreflightSql, applicationModelMigrationSql, type ApplicationRuntimeModelContract } from './application-models.js';
import type { ApplicationTransactionalDatabaseProvider } from './application-providers.js';
import { generatedJobStatusRuntimeBundle } from './application-runtime-modules.js';
import type { ApplicationGeneratedJobStatusTarget, ApplicationStatusReconcilerAppResourceTarget } from './application-status-reconciler.js';
import { applicationStatusReconcilerName } from './application-status-reconciler.js';
import { applicationTypeKroString } from './application-typekro-values.js';
import { configMap as typeKroConfigMap, cronJob as typeKroCronJob, job as typeKroJob } from 'typekro/kubernetes';

export interface ApplicationJobOptions {
  readonly taskKind?: 'preflight' | 'migration' | 'cleanup' | 'repair' | 'maintenance' | 'custom';
  readonly namespace?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface ApplicationScheduleOptions extends ApplicationJobOptions {
  readonly cron?: string;
  readonly timezone?: string;
  readonly concurrencyPolicy?: 'allow' | 'forbid' | 'replace';
  readonly missedRunPolicy?: 'skip' | 'startLate' | 'failClosed';
  readonly startingDeadlineSeconds?: number;
}

export interface ApplicationJobBinding {
  readonly kind: 'applicationJob';
  readonly name: string;
  readonly resourceName: string;
  readonly diagnosticsConfigMapName: string;
  readonly statusPath: string;
  plan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>;
}

export interface ApplicationGeneratedJobResourceState extends ApplicationGraphState {
  readonly appResource: ApplicationStatusReconcilerAppResourceTarget;
  readonly generatedJobStatusTargets: ApplicationGeneratedJobStatusTarget[];
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}

export function emitApplicationGeneratedJob(state: ApplicationGeneratedJobResourceState, name: string, options: ApplicationJobOptions | ApplicationScheduleOptions, cron: string | undefined, plan: ApplicationJobBinding['plan']): ApplicationJobBinding {
  const resourceName = kubernetesNameSegment(name);
  const namespace = options.namespace;
  const nodeId = applicationGraphNodeId('job', resourceName);
  const statusPath = `status.applik8s.jobs.${resourceName}`;
  const diagnosticsConfigMapName = `${resourceName}-diagnostics`;
  const statusRuntimeConfigMapName = `${resourceName}-status-runtime`;
  const observability = applicationGeneratedJobObservability(diagnosticsConfigMapName);
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': cron ? 'generated-scheduled-job' : 'generated-job',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/job': resourceName,
  };
  const missedRunPolicy = isApplicationScheduleOptions(options) ? options.missedRunPolicy : undefined;
  const annotations = missedRunPolicy ? { 'applik8s.dev/missed-run-policy': missedRunPolicy } : undefined;
  const container = applicationGeneratedJobContainer(resourceName, statusPath, options);
  const materialization = cron ? 'kubernetes-cronjob' : 'kubernetes-job';
  const resourceRef = { apiVersion: 'batch/v1', kind: cron ? 'CronJob' : 'Job', name: resourceName, ...(namespace ? { namespace } : {}) };
  const phaseStatusTarget = { resource: { nodeId }, statusPath };
  const permissions = [{ apiGroups: ['batch'], resources: [cron ? 'cronjobs' : 'jobs'], verbs: ['create', 'get', 'list', 'watch', 'patch'] }];
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: { nodeId },
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName: resourceName, idempotencyKey: 'metadata.generation' }),
  });
  const statusReconcilerName = applicationStatusReconcilerName(state.appResource, kubernetesNameSegment);
  const statusStoreConfigMapName = `${statusReconcilerName}-status`;
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName: resourceName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedJobFailed',
      message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`,
      failedStep: 'runJob',
      partialEffects: [{ operation: 'runJob', ref: resourceRef, status: 'visible' }],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} reached a terminal failure.`, observedGeneration: 0 }],
  });
  const durableStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName: resourceName,
    observes: [resourceRef],
    writes: phaseStatusTarget,
    statusShape: phaseStatusContract.statusShape,
    statusConfigMapName: statusStoreConfigMapName,
    ...(namespace ? { statusConfigMapNamespace: namespace } : {}),
  });
  const schedule = cron ? {
    cron,
    ...(isApplicationScheduleOptions(options) && options.timezone ? { timezone: options.timezone } : {}),
    ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: options.concurrencyPolicy } : {}),
    ...(missedRunPolicy ? { missedRunPolicy } : {}),
    ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
  } : undefined;

  if (cron) {
    typeKroCronJob({
      id: graphResourceId(resourceName, 'generatedCronJob'),
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels, ...(annotations ? { annotations } : {}) },
      spec: {
        schedule: cron,
        ...(isApplicationScheduleOptions(options) && options.timezone ? { timeZone: options.timezone } : {}),
        ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: kubernetesCronJobConcurrencyPolicy(options.concurrencyPolicy) } : {}),
        ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
        jobTemplate: { spec: applicationGeneratedJobSpec(labels, container) },
      },
    });
  } else {
    typeKroJob({
      id: graphResourceId(resourceName, 'generatedJob'),
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
      spec: applicationGeneratedJobSpec(labels, container),
    });
  }

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: {
      job: resourceName,
      materialization,
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      statusOwnershipContract: JSON.stringify(durableStatusUpdater.statusOwnership, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      retryPolicy: JSON.stringify(applicationGeneratedJobRetry(), null, 2),
      observabilityContract: JSON.stringify(observability, null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-job-terminal-failure', severity: 'error', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName: resourceName, jobKind: cron ? 'CronJob' : 'Job', statusPath, materialization }], state.appResource),
  });

  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName,
    namespace,
    statusPath,
    jobKind: cron ? 'CronJob' : 'Job',
    materialization,
  });

  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: resourceName,
    stability: 'stable',
    task: {
      taskKind: options.taskKind ?? 'custom',
      ...(options.image ? { image: options.image } : {}),
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: options.args } : {}),
    },
    ...(schedule ? { schedule } : {}),
    phase: applicationGeneratedJobPhase(),
    resources: [resourceRef],
    retry: applicationGeneratedJobRetry(),
    observability,
    runtime: applicationGeneratedJobRuntime({
      materialization,
      statusResource: { nodeId },
      statusPath,
      permissions,
      durableStatusUpdater,
      statusLifecycle: applicationGeneratedJobStatusLifecycle({ jobName: resourceName, materialization, statusConfigMapName: statusStoreConfigMapName, ...(namespace ? { statusConfigMapNamespace: namespace } : {}) }),
      metadataLinks: [{ graphNode: { nodeId }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName }, purpose: 'jobDiagnostics' }],
    }),
    generatedResources: [
      { role: 'workload', graphNode: { nodeId }, resource: resourceRef, artifact: { kind: 'kubernetesManifest', name: `${resourceName}.yaml` } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusRuntimeConfigMapName } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: statusReconcilerName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusReconcilerName } },
      { role: 'jobDiagnostics', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName } },
    ],
  });

  return { kind: 'applicationJob', name, resourceName, diagnosticsConfigMapName, statusPath, plan };
}

function registerApplicationGeneratedJobStatusTarget(state: ApplicationGeneratedJobResourceState, target: ApplicationGeneratedJobStatusTarget): void {
  state.generatedJobStatusTargets.push(target);
}

function applicationGeneratedJobSpec(labels: Readonly<Record<string, string>>, container: ReturnType<typeof applicationGeneratedJobContainer>) {
  return {
    backoffLimit: 3,
    template: {
      metadata: { labels },
      spec: {
        restartPolicy: 'OnFailure',
        containers: [container],
      },
    },
  };
}

function applicationGeneratedJobContainer(resourceName: string, statusPath: string, options: ApplicationJobOptions) {
  return {
    name: 'job',
    image: options.image ?? 'busybox:1.36',
    command: [...(options.command ?? ['sh', '-c'])],
    args: [...(options.args ?? [`echo "applik8s generated job ${resourceName}"`])],
    env: [
      { name: 'APPLIK8S_JOB_NAME', value: resourceName },
      { name: 'APPLIK8S_JOB_STATUS_PATH', value: statusPath },
      ...Object.entries(options.env ?? {}).map(([name, value]) => ({ name, value })),
    ],
  };
}

function isApplicationScheduleOptions(options: ApplicationJobOptions | ApplicationScheduleOptions): options is ApplicationScheduleOptions {
  return 'cron' in options || 'timezone' in options || 'concurrencyPolicy' in options || 'missedRunPolicy' in options || 'startingDeadlineSeconds' in options;
}

function kubernetesCronJobConcurrencyPolicy(policy: 'allow' | 'forbid' | 'replace'): 'Allow' | 'Forbid' | 'Replace' {
  if (policy === 'forbid') {
    return 'Forbid';
  }
  if (policy === 'replace') {
    return 'Replace';
  }
  return 'Allow';
}

export function emitApplicationModelMigrationResources(state: ApplicationGeneratedJobResourceState, model: ApplicationRuntimeModelContract, provider: ApplicationTransactionalDatabaseProvider, clusterName: string, secretName: string, secretKey: string, database: string, namespace: string | undefined, labels: Readonly<Record<string, string>>): void {
  const resourceName = kubernetesNameSegment(model.name);
  const jobName = provider.migrations?.jobName ?? `${resourceName}-migration`;
  const statusPath = `status.applik8s.jobs.${jobName}`;
  const migrationConfigMapName = `${jobName}-migration`;
  const statusRuntimeConfigMapName = `${jobName}-status-runtime`;
  const observability = applicationGeneratedJobObservability(`${jobName}-diagnostics`);
  const migrationPlan = applicationModelMigrationPlan(model);
  const migrationPreflightSql = applicationModelMigrationPreflightSql(model);
  const migrationSql = applicationModelMigrationSql(model);
  const migrationJobRef = { apiVersion: 'batch/v1', kind: 'Job', name: jobName, ...(namespace ? { namespace } : {}) };
  const clusterRef = { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(namespace ? { namespace } : {}) };
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: clusterRef,
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName, idempotencyKey: 'metadata.generation', currentStep: 'provider-readiness' }),
  });
  const migrationStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName,
    observes: [migrationJobRef],
    writes: { resource: clusterRef, statusPath },
    statusShape: phaseStatusContract.statusShape,
    statusConfigMapName: `${kubernetesNameSegment(state.appResource.kind)}-status-reconciler-status`,
    ...(namespace ? { statusConfigMapNamespace: namespace } : {}),
  });
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    currentStep: 'schema-drift',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedMigrationFailed',
      message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`,
      failedStep: 'schema-drift',
      partialEffects: [
        { operation: 'runMigrationJob', ref: migrationJobRef, status: 'visible' },
        { operation: 'readMigrationSql', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: migrationConfigMapName, ...(namespace ? { namespace } : {}) }, status: 'visible' },
      ],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} reached a terminal failure.`, observedGeneration: 0 }],
  });
  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationSql'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: migrationConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: { 'preflight.sql': migrationPreflightSql, 'migration.sql': migrationSql },
  });

  typeKroJob({
    id: graphResourceId(jobName, 'modelMigrationJob'),
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: jobName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      backoffLimit: 3,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'OnFailure',
          containers: [{
            name: 'migration',
            image: 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
            command: ['sh', '-c', 'echo "applik8s-model-migration preflight $APPLIK8S_TRANSACTIONAL_DATABASE_MODEL"; for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/preflight.sql && break; echo "applik8s-model-migration preflight retry $attempt"; sleep 5; if [ "$attempt" = "60" ]; then exit 1; fi; done; echo "applik8s-model-migration applying $APPLIK8S_TRANSACTIONAL_DATABASE_MODEL"; for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql && exit 0; echo "applik8s-model-migration retry $attempt"; sleep 5; done; exit 1'],
            env: [
              { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: secretName, key: secretKey } } },
              { name: 'DATABASE_URL_SECRET_KEY', value: secretKey },
              { name: 'APPLIK8S_TRANSACTIONAL_DATABASE_CLUSTER', value: clusterName },
              { name: 'APPLIK8S_TRANSACTIONAL_DATABASE_DATABASE', value: database },
              { name: 'APPLIK8S_TRANSACTIONAL_DATABASE_MODEL', value: model.name },
              { name: 'APPLIK8S_MIGRATION_STATUS_PATH', value: statusPath },
            ],
            volumeMounts: [{ name: 'applik8s-model-migration', mountPath: '/migrations', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-model-migration', configMap: { name: migrationConfigMapName } }],
        },
      },
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${jobName}-diagnostics`, ...(namespace ? { namespace } : {}), labels },
    data: {
      model: resourceName,
      database,
      cluster: clusterName,
      connectionSecret: secretName,
      connectionSecretKey: secretKey,
      phaseStatusResource: applicationTypeKroString('postgresql.cnpg.io/v1/Cluster/', namespace ? applicationTypeKroString(namespace, '/') : '', clusterName),
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      statusOwnershipContract: JSON.stringify(migrationStatusUpdater.statusOwnership, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      observabilityContract: JSON.stringify(observability, null, 2),
      semantics: 'generatedIdempotentPostgresMigration',
      migrationConfigMap: migrationConfigMapName,
      migrationPreflightSql,
      migrationSql,
      compatibilityPolicy: JSON.stringify({ mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob', enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' } }),
      driftPolicy: 'failClosed',
      migrationPlan: JSON.stringify(migrationPlan, null, 2),
      failureModes: JSON.stringify({ missingCredentials: 'blockBeforeSql', providerReadiness: 'preflightSelectOne', lockBehavior: 'providerNativeAdvisoryLock', missingHistoryTable: 'schemaDriftFailClosed', missingHistoryColumn: 'schemaDriftFailClosed', incompatibleHistoryColumn: 'schemaDriftFailClosed', badSql: 'terminalFailureWithJobLogs', incompatibleColumn: 'schemaDriftFailClosed', incompatibleIndex: 'schemaDriftFailClosed', unknownExistingObject: 'schemaDriftFailClosed', destructiveChange: 'rejectWithoutExplicitPlan' }, null, 2),
      driftDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-drift-detected', severity: 'error', reason: 'SchemaDriftDetected', message: `Generated migration for model ${model.name} detected existing database schema drift or incompatible table/index shape. Provide an explicit migration plan or repair the database before retrying.`, retryable: false }, null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-failed', severity: 'error', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName, jobKind: 'Job', statusPath, materialization: 'kubernetes-job' }], state.appResource),
  });

  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName: jobName,
    namespace,
    statusPath,
    jobKind: 'Job',
    materialization: 'kubernetes-job',
  });
}
