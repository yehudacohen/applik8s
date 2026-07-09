import type { ApplicationDurableStatusConcurrencyContract } from '@applik8s/core';

export interface GeneratedJobStatusConfigMapDataMergeInput {
  readonly existingData?: Readonly<Record<string, string>>;
  readonly statusPatch: Readonly<Record<string, unknown>>;
  readonly observedAt?: string;
}

export interface GeneratedJobStatusConfigMapPatchInput {
  readonly statusPatch: Readonly<Record<string, unknown>>;
  readonly concurrency: ApplicationDurableStatusConcurrencyContract;
  readonly read: () => Promise<{ readonly data?: Readonly<Record<string, string>>; readonly resourceVersion?: string }>;
  readonly patch: (payload: { readonly metadata?: { readonly resourceVersion: string }; readonly data: Readonly<Record<string, string>> }) => Promise<void>;
  readonly isConflict: (error: unknown) => boolean;
  readonly observedAt?: () => string;
  readonly diagnostic?: (event: Readonly<Record<string, unknown>>) => void;
}

export interface GeneratedJobStatusConfigMapPatchResult extends GeneratedJobStatusConfigMapDataMergeSummary {
  readonly attempts: number;
  readonly resourceVersion?: string;
}

export interface GeneratedJobStatusPersistenceInput extends GeneratedJobStatusConfigMapPatchInput {
  readonly patchApplicationStatus?: (statusPatch: Readonly<Record<string, unknown>>) => Promise<void>;
}

export interface GeneratedJobStatusPersistenceResult {
  readonly statusStore: GeneratedJobStatusConfigMapPatchResult;
  readonly appStatus: 'patched' | 'failed' | 'skipped';
}

export async function patchGeneratedJobStatusConfigMapData(input: GeneratedJobStatusConfigMapPatchInput): Promise<GeneratedJobStatusConfigMapPatchResult> {
  for (let attempt = 1; attempt <= input.concurrency.maxAttempts; attempt += 1) {
    const existing = await input.read();
    const observedAt = input.observedAt?.();
    const summary = summarizeGeneratedJobStatusConfigMapMerge({
      ...(existing.data ? { existingData: existing.data } : {}),
      statusPatch: input.statusPatch,
      ...(observedAt ? { observedAt } : {}),
    });
    try {
      await input.patch({
        ...(existing.resourceVersion ? { metadata: { resourceVersion: existing.resourceVersion } } : {}),
        data: summary.data,
      });
      input.diagnostic?.({ event: 'applik8s-job-status-reconciler-status-store-merged', severity: 'info', attempt, ...summary.metrics });
      return { ...summary, attempts: attempt, ...(existing.resourceVersion ? { resourceVersion: existing.resourceVersion } : {}) };
    } catch (error) {
      const conflict = input.isConflict(error);
      if (conflict && attempt === input.concurrency.maxAttempts) {
        input.diagnostic?.({ event: input.concurrency.retryExhaustedDiagnostic, severity: 'error', attempt, maxAttempts: input.concurrency.maxAttempts, message: error instanceof Error ? error.message : String(error) });
      }
      if (!conflict || attempt === input.concurrency.maxAttempts) {
        throw error;
      }
      input.diagnostic?.({ event: input.concurrency.retryDiagnostic, severity: 'warn', attempt, message: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error('Generated job status ConfigMap retry loop exited without patching or throwing.');
}

export async function persistGeneratedJobStatusWithDurableFallback(input: GeneratedJobStatusPersistenceInput): Promise<GeneratedJobStatusPersistenceResult> {
  const statusStore = await patchGeneratedJobStatusConfigMapData(input);
  if (!input.patchApplicationStatus) {
    return { statusStore, appStatus: 'skipped' };
  }
  try {
    await input.patchApplicationStatus(input.statusPatch);
    return { statusStore, appStatus: 'patched' };
  } catch (error) {
    input.diagnostic?.({ event: 'applik8s-job-status-reconciler-app-status-error', severity: 'warn', message: error instanceof Error ? error.message : String(error), durableFallback: 'generatedStatusConfigMap' });
    return { statusStore, appStatus: 'failed' };
  }
}

export interface GeneratedJobStatusConfigMapDataMergeSummary {
  readonly data: Readonly<Record<string, string>>;
  readonly metrics: {
    readonly observedJobs: number;
    readonly retainedJobs: number;
    readonly acceptedUpdates: number;
    readonly rejectedUpdates: number;
    readonly conflictUpdates: number;
  };
}

export function mergeGeneratedJobStatusConfigMapData(input: GeneratedJobStatusConfigMapDataMergeInput): Readonly<Record<string, string>> {
  return summarizeGeneratedJobStatusConfigMapMerge(input).data;
}

export function summarizeGeneratedJobStatusConfigMapMerge(input: GeneratedJobStatusConfigMapDataMergeInput): GeneratedJobStatusConfigMapDataMergeSummary {
  const existing = input.existingData ?? {};
  const currentJobs = generatedStatusPatchJobs(input.statusPatch);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const merged = mergeGeneratedJobStatusEntries(parseGeneratedStatusJobs(existing), currentJobs, parseGeneratedStatusJsonObject(existing['conflicts.json']), observedAt);
  const history = appendGeneratedJobHistoryEntries(parseGeneratedStatusJsonObject(existing['history.json']), merged.acceptedJobs, observedAt);
  return {
    data: {
      'status.json': `${JSON.stringify(statusPatchWithMergedGeneratedJobs(input.statusPatch, merged.jobs), null, 2)}`,
      'applik8s-jobs.json': `${JSON.stringify(merged.jobs, null, 2)}`,
      'history.json': `${JSON.stringify(history, null, 2)}`,
      'conflicts.json': `${JSON.stringify(merged.conflicts, null, 2)}`,
      updatedAt: observedAt,
    },
    metrics: generatedJobStatusMergeMetrics(merged, currentJobs, observedAt),
  };
}

function statusPatchWithMergedGeneratedJobs(statusPatch: Readonly<Record<string, unknown>>, jobs: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const applik8s = Reflect.get(statusPatch, 'applik8s');
  const applik8sPatch = applik8s && typeof applik8s === 'object' && !Array.isArray(applik8s) ? applik8s : {};
  return { ...statusPatch, applik8s: { ...applik8sPatch, jobs } };
}

function mergeGeneratedJobStatusEntries(existingJobs: Readonly<Record<string, unknown>>, currentJobs: Readonly<Record<string, unknown>>, existingConflicts: Readonly<Record<string, unknown>>, observedAt: string): { readonly jobs: Readonly<Record<string, unknown>>; readonly acceptedJobs: Readonly<Record<string, unknown>>; readonly conflicts: Readonly<Record<string, unknown>> } {
  const jobs: Record<string, unknown> = { ...existingJobs };
  const acceptedJobs: Record<string, unknown> = {};
  const conflicts: Record<string, unknown> = { ...existingConflicts };
  for (const [jobName, status] of Object.entries(currentJobs)) {
    const existing = jobs[jobName];
    if (shouldRetainCompletedGeneratedJobStatus(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntryFromStatus(existing, observedAt), rejected: generatedJobHistoryEntryFromStatus(status, observedAt), reason: 'CompletedIdempotencyKeyRetained' }].slice(-20);
      continue;
    }
    if (isStaleGeneratedJobStatus(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntryFromStatus(existing, observedAt), rejected: generatedJobHistoryEntryFromStatus(status, observedAt), reason: 'StaleObservedGeneration' }].slice(-20);
      continue;
    }
    if (isConcurrentGeneratedJobObservation(existing, status)) {
      conflicts[jobName] = [...generatedJobConflictEntries(conflicts[jobName]), { observedAt, existing: generatedJobHistoryEntryFromStatus(existing, observedAt), accepted: generatedJobHistoryEntryFromStatus(status, observedAt), reason: 'ConcurrentObservationAccepted' }].slice(-20);
    }
    jobs[jobName] = status;
    acceptedJobs[jobName] = status;
  }
  return { jobs, acceptedJobs, conflicts };
}

function generatedJobStatusMergeMetrics(merged: { readonly jobs: Readonly<Record<string, unknown>>; readonly acceptedJobs: Readonly<Record<string, unknown>>; readonly conflicts: Readonly<Record<string, unknown>> }, currentJobs: Readonly<Record<string, unknown>>, observedAt: string): GeneratedJobStatusConfigMapDataMergeSummary['metrics'] {
  let rejectedUpdates = 0;
  let conflictUpdates = 0;
  for (const entries of Object.values(merged.conflicts)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Reflect.get(entry, 'observedAt') !== observedAt) {
        continue;
      }
      if (Reflect.get(entry, 'rejected')) {
        rejectedUpdates += 1;
      }
      if (Reflect.get(entry, 'accepted')) {
        conflictUpdates += 1;
      }
    }
  }
  return {
    observedJobs: Object.keys(currentJobs).length,
    retainedJobs: Object.keys(merged.jobs).length,
    acceptedUpdates: Object.keys(merged.acceptedJobs).length,
    rejectedUpdates,
    conflictUpdates,
  };
}

function isStaleGeneratedJobStatus(existing: unknown, incoming: unknown): boolean {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  const existingGeneration = Number(Reflect.get(existing, 'observedGeneration') || 0);
  const incomingGeneration = Number(Reflect.get(incoming, 'observedGeneration') || 0);
  return incomingGeneration > 0 && existingGeneration > incomingGeneration;
}

function shouldRetainCompletedGeneratedJobStatus(existing: unknown, incoming: unknown): boolean {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  return Reflect.get(existing, 'phase') === 'Complete'
    && Reflect.get(incoming, 'phase') !== 'Complete'
    && String(Reflect.get(existing, 'idempotencyKey') || '') === String(Reflect.get(incoming, 'idempotencyKey') || '');
}

function isConcurrentGeneratedJobObservation(existing: unknown, incoming: unknown): boolean {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return false;
  }
  const existingGeneration = Number(Reflect.get(existing, 'observedGeneration') || 0);
  const incomingGeneration = Number(Reflect.get(incoming, 'observedGeneration') || 0);
  const existingIdempotency = String(Reflect.get(existing, 'idempotencyKey') || '');
  const incomingIdempotency = String(Reflect.get(incoming, 'idempotencyKey') || '');
  return existingGeneration > 0 && existingGeneration === incomingGeneration && existingIdempotency !== '' && incomingIdempotency !== '' && existingIdempotency !== incomingIdempotency;
}

function generatedJobConflictEntries(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function generatedStatusPatchJobs(statusPatch: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const applik8s = Reflect.get(statusPatch, 'applik8s');
  if (!applik8s || typeof applik8s !== 'object' || Array.isArray(applik8s)) {
    return {};
  }
  const jobs = Reflect.get(applik8s, 'jobs');
  // typecast: jobs was checked to be a plain runtime status object before copying into JSON data.
  return jobs && typeof jobs === 'object' && !Array.isArray(jobs) ? { ...jobs } as Readonly<Record<string, unknown>> : {};
}

function parseGeneratedStatusJobs(existingData: Readonly<Record<string, string>>): Readonly<Record<string, unknown>> {
  const jobs = parseGeneratedStatusJsonObject(existingData['applik8s-jobs.json']);
  if (Object.keys(jobs).length > 0) {
    return jobs;
  }
  const status = parseGeneratedStatusJsonObject(existingData['status.json']);
  const applik8s = Reflect.get(status, 'applik8s');
  if (!applik8s || typeof applik8s !== 'object' || Array.isArray(applik8s)) {
    return {};
  }
  const statusJobs = Reflect.get(applik8s, 'jobs');
  // typecast: recovered status.json jobs were checked to be an opaque non-array status object before merging.
  return statusJobs && typeof statusJobs === 'object' && !Array.isArray(statusJobs) ? { ...statusJobs } as Readonly<Record<string, unknown>> : {};
}

function appendGeneratedJobHistoryEntries(existingHistory: Readonly<Record<string, unknown>>, currentJobs: Readonly<Record<string, unknown>>, observedAt: string): Readonly<Record<string, unknown>> {
  const nextHistory: Record<string, unknown> = { ...existingHistory };
  for (const [jobName, status] of Object.entries(currentJobs)) {
    const existing = nextHistory[jobName];
    const entries = Array.isArray(existing) ? existing : [];
    const entry = generatedJobHistoryEntryFromStatus(status, observedAt);
    const previous = entries[entries.length - 1];
    nextHistory[jobName] = shouldAppendGeneratedJobHistoryEntrySnapshot(previous, entry)
      ? [...entries, entry].slice(-20)
      : [...entries.slice(0, -1), { ...entry, observedAt }].slice(-20);
  }
  return nextHistory;
}

function generatedJobHistoryEntryFromStatus(status: unknown, observedAt: string): Readonly<Record<string, unknown>> {
  const record = status && typeof status === 'object' && !Array.isArray(status) ? status : {};
  return {
    observedAt,
    phase: String(Reflect.get(record, 'phase') || 'Unknown'),
    observedGeneration: Number(Reflect.get(record, 'observedGeneration') || 0),
    idempotencyKey: String(Reflect.get(record, 'idempotencyKey') || 'unknown'),
    retryCount: Number(Reflect.get(record, 'retryCount') || 0),
  };
}

function shouldAppendGeneratedJobHistoryEntrySnapshot(previous: unknown, entry: Readonly<Record<string, unknown>>): boolean {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    return true;
  }
  return Reflect.get(previous, 'phase') !== entry.phase || Reflect.get(previous, 'observedGeneration') !== entry.observedGeneration || Reflect.get(previous, 'idempotencyKey') !== entry.idempotencyKey || Reflect.get(previous, 'retryCount') !== entry.retryCount;
}

function parseGeneratedStatusJsonObject(value: string | undefined): Readonly<Record<string, unknown>> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    // typecast: parsed JSON was checked to be a non-array object and is used as opaque status metadata.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Readonly<Record<string, unknown>> : {};
  } catch (_error) {
    return {};
  }
}
