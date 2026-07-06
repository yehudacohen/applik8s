import type { ApplicationDiagnosticContract, ApplicationGraphMetadataLink, ApplicationGraphNodeRef, ApplicationJobIdempotencyContract, ApplicationPhaseContract, ApplicationProviderRuntimeContract, ApplicationResourceRef, ApplicationRetryPolicy, GeneratedJobDurableStatusContract, GeneratedJobDurableStatusUpdaterContract, GeneratedJobPhaseStatusContract, GeneratedJobRuntimeContract } from '@applik8s/core';

export function applicationGeneratedJobPhase(): ApplicationPhaseContract {
  return { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Blocked', 'Progressing', 'Ready', 'Finalized', 'Failed'] };
}

export function applicationGeneratedJobRetry(): ApplicationRetryPolicy {
  return { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 30000 };
}

export function applicationGeneratedJobIdempotency(): ApplicationJobIdempotencyContract {
  return { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' };
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
  readonly diagnostics?: readonly ApplicationDiagnosticContract[];
}): GeneratedJobDurableStatusUpdaterContract {
  return {
    runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' },
    observes: options.observes,
    writes: options.writes,
    statusOwnership: {
      primary: 'applicationStatus',
      fallback: 'generatedStatusConfigMap',
      appStatusSchema: 'bestEffort',
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: `job.${options.jobName}` }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Generated job status is patched to application status when the CRD schema allows it and persisted in the generated status ConfigMap as the durable fallback.', retryable: false }],
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
}): GeneratedJobRuntimeContract {
  return {
    materialization: options.materialization,
    idempotency: applicationGeneratedJobIdempotency(),
    phaseStatus: { resource: options.statusResource, statusPath: options.statusPath },
    permissions: options.permissions,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.metadataLinks ? { metadataLinks: options.metadataLinks } : {}),
    ...(options.durableStatusUpdater ? { durableStatusUpdater: options.durableStatusUpdater } : {}),
  };
}
