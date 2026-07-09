import type { ApplicationAppStatusSchemaContract, ApplicationDiagnosticContract, ApplicationDurableStatusConcurrencyContract, ApplicationDurableStatusObservabilityContract, ApplicationGeneratedStatusConfigMapContract, ApplicationGraphMetadataLink, ApplicationGraphNodeRef, ApplicationJobIdempotencyContract, ApplicationJobStatusLifecycleContract, ApplicationObservabilityContract, ApplicationPhaseContract, ApplicationProviderRuntimeContract, ApplicationResourceRef, ApplicationRetryPolicy, GeneratedJobDurableStatusContract, GeneratedJobDurableStatusUpdaterContract, GeneratedJobPhaseStatusContract, GeneratedJobRuntimeContract } from '@applik8s/core';

export function applicationGeneratedJobPhase(): ApplicationPhaseContract {
  return { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Blocked', 'Progressing', 'Ready', 'Finalized', 'Failed'] };
}

export function applicationGeneratedJobRetry(): ApplicationRetryPolicy {
  return { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 30000 };
}

export function applicationGeneratedJobObservability(diagnosticsArtifactName: string): ApplicationObservabilityContract {
  return {
    health: { mode: 'kubernetesJobStatus' },
    logs: { format: 'json', component: 'applik8s-job-runner', failureEvents: ['applik8s-job-terminal-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_generated_job_observations_total', 'applik8s_generated_job_failures_total'] },
    events: ['applik8s-job-terminal-failure'],
    sourceMaps: 'notApplicable',
    replayArtifacts: [{ kind: 'jobDiagnostics', name: diagnosticsArtifactName }],
    diagnosticsArtifact: { kind: 'jobDiagnostics', name: diagnosticsArtifactName },
  };
}

export function applicationGeneratedJobIdempotency(): ApplicationJobIdempotencyContract {
  return { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' };
}

export function applicationGeneratedJobAppStatusSchemaContract(): ApplicationAppStatusSchemaContract {
  return {
    statusRoot: 'status.applik8s',
    jobsPath: 'status.applik8s.jobs',
    schema: 'generatedJobStatusMap',
    ownership: 'kroStatusProjection',
    pruningBehavior: 'failClosed',
  };
}

export function applicationGeneratedStatusConfigMapContract(): ApplicationGeneratedStatusConfigMapContract {
  return {
    objectOwnership: 'runtimeCreatedResource',
    dataOwnership: 'runtime',
    dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'],
    updateStrategy: 'resourceVersionMergePatch',
    history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' },
    conflicts: { key: 'conflicts.json', maxEntries: 20 },
  };
}

export function applicationGeneratedStatusConcurrencyContract(): ApplicationDurableStatusConcurrencyContract {
  return {
    updateStrategy: 'resourceVersionRetry',
    maxAttempts: 5,
    retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry',
    retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted',
    failurePolicy: 'failClosed',
  };
}

export function applicationGeneratedStatusObservabilityContract(): ApplicationDurableStatusObservabilityContract {
  return {
    mergeEvent: 'applik8s-job-status-reconciler-status-store-merged',
    conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry',
    metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'],
  };
}

export function applicationGeneratedJobDurableStatus(options: {
  readonly jobName: string;
  readonly phase?: string;
  readonly observedGeneration?: number;
  readonly idempotencyKey?: string;
  readonly currentStep?: string;
  readonly lastSuccessfulStep?: string;
  readonly retryCount?: number;
  readonly terminalFailure?: GeneratedJobDurableStatusContract['terminalFailure'];
  readonly conditions?: GeneratedJobDurableStatusContract['conditions'];
}): GeneratedJobDurableStatusContract {
  const observedGeneration = options.observedGeneration ?? 0;
  return {
    phase: options.phase ?? 'Pending',
    observedGeneration,
    idempotencyKey: options.idempotencyKey ?? options.jobName,
    retryCount: options.retryCount ?? 0,
    ...(options.currentStep ? { currentStep: options.currentStep } : {}),
    ...(options.lastSuccessfulStep ? { lastSuccessfulStep: options.lastSuccessfulStep } : {}),
    ...(options.terminalFailure ? { terminalFailure: options.terminalFailure } : {}),
    conditions: options.conditions ?? [{ type: 'Progressing', status: 'False', reason: 'JobPending', message: `Generated job ${options.jobName} has not reported progress yet.`, observedGeneration }],
  };
}

export function applicationGeneratedJobPhaseStatusContract(options: {
  readonly statusResource: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly statusPath: string;
  readonly statusShape: GeneratedJobDurableStatusContract;
}): GeneratedJobPhaseStatusContract {
  return {
    phase: applicationGeneratedJobPhase(),
    idempotency: applicationGeneratedJobIdempotency(),
    statusTarget: { resource: options.statusResource, statusPath: options.statusPath },
    statusShape: options.statusShape,
  };
}

export function applicationGeneratedJobStatusUpdater(options: {
  readonly jobName: string;
  readonly observes: readonly ApplicationResourceRef[];
  readonly writes: GeneratedJobRuntimeContract['phaseStatus'];
  readonly statusShape: GeneratedJobDurableStatusContract;
  readonly statusConfigMapName?: string;
  readonly statusConfigMapNamespace?: string;
  readonly diagnostics?: readonly ApplicationDiagnosticContract[];
}): GeneratedJobDurableStatusUpdaterContract {
  return {
    runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' },
    observes: options.observes,
    writes: options.writes,
    statusOwnership: {
      primary: 'applicationStatus',
      durableAuthority: 'generatedStatusConfigMap',
      releasePolicy: 'kroStatusProjectionRequired',
      applicationStatusProjection: 'requiredAuthoritative',
      appStatusSchema: 'required',
      appStatusSchemaContract: applicationGeneratedJobAppStatusSchemaContract(),
      ...(options.statusConfigMapName ? { durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: options.statusConfigMapName, ...(options.statusConfigMapNamespace ? { namespace: options.statusConfigMapNamespace } : {}) } } : {}),
      fallbackStore: applicationGeneratedStatusConfigMapContract(),
      concurrency: applicationGeneratedStatusConcurrencyContract(),
      observability: applicationGeneratedStatusObservabilityContract(),
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: `job.${options.jobName}` }, reason: 'KroStatusProjectionRequired', message: 'Generated job status requires KRO-owned status.applik8s.jobs hydration from the runtime-created status ConfigMap.', retryable: false }],
    },
    statusShape: options.statusShape,
    failurePolicy: 'failClosed',
    idempotency: applicationGeneratedJobIdempotency(),
    diagnostics: options.diagnostics ?? [{ event: 'applik8s-job-terminal-failure', severity: 'error', subject: { nodeId: `job.${options.jobName}` }, reason: 'GeneratedJobFailed', message: `Generated job ${options.jobName} reached a terminal failure.`, retryable: true }],
  };
}

export function applicationGeneratedJobRuntime(options: {
  readonly materialization: GeneratedJobRuntimeContract['materialization'];
  readonly statusResource: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly statusPath: string;
  readonly permissions: GeneratedJobRuntimeContract['permissions'];
  readonly environment?: ApplicationProviderRuntimeContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
  readonly durableStatusUpdater?: GeneratedJobDurableStatusUpdaterContract;
  readonly statusLifecycle?: ApplicationJobStatusLifecycleContract;
}): GeneratedJobRuntimeContract {
  return {
    materialization: options.materialization,
    idempotency: applicationGeneratedJobIdempotency(),
    phaseStatus: { resource: options.statusResource, statusPath: options.statusPath },
    ...(options.statusLifecycle ? { statusLifecycle: options.statusLifecycle } : {}),
    permissions: options.permissions,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.metadataLinks ? { metadataLinks: options.metadataLinks } : {}),
    ...(options.durableStatusUpdater ? { durableStatusUpdater: options.durableStatusUpdater } : {}),
  };
}

export function applicationGeneratedJobStatusLifecycle(options: {
  readonly jobName: string;
  readonly materialization: GeneratedJobRuntimeContract['materialization'];
  readonly statusConfigMapName?: string;
  readonly statusConfigMapNamespace?: string;
}): ApplicationJobStatusLifecycleContract {
  return {
    ownership: {
      primary: 'applicationStatus',
      durableAuthority: 'generatedStatusConfigMap',
      releasePolicy: 'kroStatusProjectionRequired',
      applicationStatusProjection: 'requiredAuthoritative',
      appStatusSchema: 'required',
      appStatusSchemaContract: applicationGeneratedJobAppStatusSchemaContract(),
      ...(options.statusConfigMapName ? { durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: options.statusConfigMapName, ...(options.statusConfigMapNamespace ? { namespace: options.statusConfigMapNamespace } : {}) } } : {}),
      fallbackStore: applicationGeneratedStatusConfigMapContract(),
      concurrency: applicationGeneratedStatusConcurrencyContract(),
      observability: applicationGeneratedStatusObservabilityContract(),
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: `job.${options.jobName}` }, reason: 'KroStatusProjectionRequired', message: 'Generated job status requires KRO-owned status.applik8s.jobs hydration from the runtime-created status ConfigMap.', retryable: false }],
    },
    conflictPolicy: 'mergePatch',
    conflictResolution: { staleObservedGeneration: 'reject', completedIdempotencyKey: 'retainCompleted', diagnosticsStore: 'conflicts.json' },
    historyRetention: { maxEntries: 20, terminalRetention: 'retain' },
    terminalFailure: { condition: 'Failed', partialEffects: 'required', diagnostics: 'required', history: 'retain' },
    multiJob: 'appLevelReconciler',
    cronJob: options.materialization === 'kubernetes-cronjob' ? 'latestRunAndHistory' : 'unsupported',
    fallback: 'generatedStatusConfigMap',
  };
}
