// typecast-file-boundary: the durable worker registry erases definition payload
// generics only after schema ownership is recorded and validates each boundary
// again before invoking or returning application values.
import { createHash, randomUUID } from 'node:crypto';
import {
  type ApplicationAdmissionInvocationContextV1,
  applicationAdmissionContextVersion,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import {
  type ApplicationJobCancellationResult,
  ApplicationJobCancelledError,
  type ApplicationJobDefinition,
  ApplicationJobIdempotencyConflictError,
  type ApplicationJobInvocationOptions,
  type ApplicationJobProgressSnapshot,
  type ApplicationJobReference,
  ApplicationJobResultExpiredError,
  ApplicationJobProgressExpiredError,
  type ApplicationJobRun,
  ApplicationJobRunError,
  type ApplicationJobRuntime,
  type ApplicationJobTerminalOutcome,
  applicationJobRuntimeProtocol,
} from './application-finite-jobs.js';
import {
  type ApplicationJobLeaseToken,
  type ApplicationJobStore,
  type ApplicationJobStoredRun,
  ApplicationJobLeaseLostError,
  createApplicationJobReference,
} from './application-job-store.js';
import { parseApplicationScheduleDuration } from './application-schedule.js';
import { validateMessage } from './application-schema-runtime.js';

type AnyJobDefinition = ApplicationJobDefinition<object, object, object, object>;

export interface DurableApplicationJobRuntimeOptions {
  readonly store: ApplicationJobStore;
  readonly application?: string;
  readonly deployment?: string;
  readonly workerId?: string;
  readonly maximumConcurrency?: number;
  readonly leaseSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly resultRetentionSeconds?: number;
  readonly progressRetentionSeconds?: number;
  readonly now?: () => Date;
  readonly id?: () => string;
}

export interface DurableApplicationJobRuntime extends ApplicationJobRuntime {
  /** Stops claims and heartbeats without fabricating terminal outcomes. */
  close(): Promise<void>;
}

class DurableApplicationJobAuthoredFailure extends Error {
  constructor(readonly value: object) {
    super('Application Job reported a typed failure.');
  }
}

/**
 * Store-backed finite Job runtime shared by durable providers. Provider
 * adapters supply the transactional store and process lifecycle; this kernel
 * owns admission, leases, retries, fencing, cancellation, and typed handles.
 */
export function createDurableApplicationJobRuntime(
  options: DurableApplicationJobRuntimeOptions,
): DurableApplicationJobRuntime {
  const store = options.store;
  const application = options.application?.trim() || 'application';
  const deployment = options.deployment?.trim() || 'deployment';
  const workerId = options.workerId?.trim() || `worker-${randomUUID()}`;
  const maximumConcurrency = positiveInteger(options.maximumConcurrency ?? 4, 'Job maximumConcurrency');
  const leaseSeconds = positiveInteger(options.leaseSeconds ?? 30, 'Job leaseSeconds');
  const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 20, 'Job pollIntervalMs');
  const resultRetentionSeconds = positiveInteger(options.resultRetentionSeconds ?? 86_400, 'Job resultRetentionSeconds');
  const progressRetentionSeconds = positiveInteger(options.progressRetentionSeconds ?? 86_400, 'Job progressRetentionSeconds');
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const definitions = new Map<string, AnyJobDefinition>();
  const controllers = new Map<string, AbortController>();
  let running = 0;
  let closed = false;
  let drainScheduled = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const later = (): void => {
    if (closed || pollTimer !== undefined) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      wake();
    }, pollIntervalMs);
    pollTimer.unref?.();
  };

  const wake = (): void => {
    if (closed || drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      void drain();
    });
  };

  const drain = async (): Promise<void> => {
    while (!closed && running < maximumConcurrency) {
      const claimed = await store.claim({
        owner: workerId,
        now: now().toISOString(),
        leaseSeconds,
        jobs: [...definitions.keys()],
      });
      if (!claimed) {
        later();
        return;
      }
      const definition = definitions.get(claimed.reference.job);
      if (!definition || !claimed.lease) {
        later();
        return;
      }
      running += 1;
      void execute(definition, claimed).finally(() => {
        running -= 1;
        wake();
      });
    }
  };

  const execute = async (definition: AnyJobDefinition, claimed: ApplicationJobStoredRun): Promise<void> => {
    const lease = claimed.lease;
    if (!lease) return;
    const controller = new AbortController();
    controllers.set(claimed.reference.runId, controller);
    let terminalTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let terminalizedByDeadline = false;
    const deadlineMs = claimed.deadline ? Date.parse(claimed.deadline) - now().getTime() : undefined;

    const heartbeat = async (): Promise<void> => {
      if (closed) return;
      try {
        const current = await store.heartbeat(
          claimed.reference.runId,
          lease,
          now().toISOString(),
          leaseSeconds,
        );
        if (current.cancellation && !controller.signal.aborted) {
          controller.abort(new ApplicationJobCancelledError(current.cancellation.reason));
        }
      } catch (cause) {
        if (cause instanceof ApplicationJobLeaseLostError && !controller.signal.aborted) controller.abort(cause);
      }
    };

    if (deadlineMs !== undefined) {
      if (deadlineMs <= 0) {
        terminalizedByDeadline = true;
        await terminalizeDeadline(store, claimed, lease, definition, now, resultRetentionSeconds);
        controllers.delete(claimed.reference.runId);
        return;
      }
      terminalTimer = setTimeout(() => {
        terminalizedByDeadline = true;
        controller.abort(new Error('JOB_EXECUTION_DEADLINE_EXCEEDED'));
        void terminalizeDeadline(store, claimed, lease, definition, now, resultRetentionSeconds);
      }, deadlineMs);
      terminalTimer.unref?.();
    }
    heartbeatTimer = setInterval(() => { void heartbeat(); }, Math.max(10, Math.floor(leaseSeconds * 1_000 / 3)));
    heartbeatTimer.unref?.();

    try {
      if (claimed.cancellation) throw new ApplicationJobCancelledError(claimed.cancellation.reason);
      const rawOutput = await definition.handler(claimed.input, {
        admission: claimed.admission,
        run: claimed.reference,
        invocationId: claimed.reference.runId,
        attempt: claimed.attempt,
        ...(claimed.deadline ? { deadline: claimed.deadline } : {}),
        signal: controller.signal,
        progress: async (rawValue) => {
          const value = definition.contract.progress
            ? validateMessage(definition.contract.progress, rawValue, `${definition.id}.progress`)
            : rawValue;
          const recordedAt = now().toISOString();
          const stored = await store.recordProgress({
            runId: claimed.reference.runId,
            lease,
            value,
            recordedAt,
            expiresAt: retentionExpiry(
              recordedAt,
              definition.options.retention?.progress,
              progressRetentionSeconds,
            ),
          });
          if (!stored.progress) throw new Error(`Job ${definition.id} progress was not retained.`);
          return stored.progress;
        },
        throwIfCancelled: () => {
          if (controller.signal.aborted) {
            throw controller.signal.reason instanceof ApplicationJobCancelledError
              ? controller.signal.reason
              : new ApplicationJobCancelledError(claimed.cancellation?.reason);
          }
        },
        fail: (rawError) => {
          const value = definition.contract.error
            ? validateMessage(definition.contract.error, rawError, `${definition.id}.error`)
            : rawError;
          throw new DurableApplicationJobAuthoredFailure(value);
        },
      });
      if (closed || terminalizedByDeadline) return;
      const output = validateMessage(definition.contract.output, rawOutput, `${definition.id}.output`);
      const terminalAt = now().toISOString();
      await store.terminalize({
        runId: claimed.reference.runId,
        lease,
        outcome: { status: 'succeeded', output },
        terminalAt,
        resultExpiresAt: retentionExpiry(
          terminalAt,
          definition.options.retention?.result,
          resultRetentionSeconds,
        ),
      });
    } catch (cause) {
      if (closed || terminalizedByDeadline || cause instanceof ApplicationJobLeaseLostError) return;
      const current = await store.read(claimed.reference.runId);
      if (current?.phase === 'terminal') return;
      if (current?.cancellation || cause instanceof ApplicationJobCancelledError) {
        const terminalAt = now().toISOString();
        await store.terminalize({
          runId: claimed.reference.runId,
          lease,
          outcome: {
            status: 'cancelled',
            ...(current?.cancellation?.reason ? { reason: current.cancellation.reason } : {}),
          },
          terminalAt,
          resultExpiresAt: retentionExpiry(
            terminalAt,
            definition.options.retention?.result,
            resultRetentionSeconds,
          ),
        });
      } else if (cause instanceof DurableApplicationJobAuthoredFailure) {
        await failTerminal(store, claimed, lease, {
          status: 'failed',
          failure: { kind: 'application', error: cause.value },
        }, definition, now, resultRetentionSeconds);
      } else if (claimed.attempt < claimed.maximumAttempts) {
        await store.retry({ runId: claimed.reference.runId, lease, availableAt: now().toISOString() });
      } else {
        await failTerminal(store, claimed, lease, {
          status: 'failed',
          failure: {
            kind: 'execution',
            code: 'JOB_EXECUTION_FAILED',
            message: 'The Job attempt failed after its retry budget was exhausted.',
            retryable: false,
          },
        }, definition, now, resultRetentionSeconds);
      }
    } finally {
      if (terminalTimer !== undefined) clearTimeout(terminalTimer);
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      controllers.delete(claimed.reference.runId);
    }
  };

  const runFor = <TOutput extends object, TProgress extends object, TError extends object>(
    reference: ApplicationJobReference,
  ): ApplicationJobRun<TOutput, TProgress, TError> => {
    const read = async (): Promise<ApplicationJobStoredRun> => {
      const stored = await store.read(reference.runId);
      if (!stored || stored.reference.job !== reference.job || stored.reference.admittedAt !== reference.admittedAt) {
        throw new Error(`Job ${reference.job} run ${reference.runId} was not found.`);
      }
      return stored;
    };
    const outcome = async (): Promise<ApplicationJobTerminalOutcome<TOutput, TError>> => {
      while (true) {
        const stored = await read();
        if (stored.phase === 'terminal') {
          if (stored.outcome) return stored.outcome as ApplicationJobTerminalOutcome<TOutput, TError>;
          throw new ApplicationJobResultExpiredError(reference, stored.resultExpiresAt ?? stored.terminalAt ?? reference.admittedAt);
        }
        wake();
        await delay(pollIntervalMs);
      }
    };
    return {
      reference,
      outcome,
      async result() {
        const terminal = await outcome();
        if (terminal.status === 'succeeded') return terminal.output;
        throw new ApplicationJobRunError(reference, terminal);
      },
      async cancel(reason): Promise<ApplicationJobCancellationResult<TOutput, TError>> {
        const current = await read();
        if (current.phase === 'terminal') {
          if (!current.outcome) {
            throw new ApplicationJobResultExpiredError(reference, current.resultExpiresAt ?? current.terminalAt ?? reference.admittedAt);
          }
          return { status: 'alreadyTerminal', outcome: current.outcome as ApplicationJobTerminalOutcome<TOutput, TError> };
        }
        const requestedAt = now().toISOString();
        const updated = await store.cancel({
          runId: reference.runId,
          requestedAt,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
          resultExpiresAt: retentionExpiry(
            requestedAt,
            definitions.get(reference.job)?.options.retention?.result,
            resultRetentionSeconds,
          ),
        });
        controllers.get(reference.runId)?.abort(new ApplicationJobCancelledError(updated.cancellation?.reason));
        wake();
        return {
          status: 'requested',
          receipt: updated.cancellation ?? {
            run: reference,
            requestedAt,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
          },
        };
      },
      async progress() {
        const stored = await read();
        if (!stored.progress && stored.progressDigest) {
          throw new ApplicationJobProgressExpiredError(reference, stored.progressExpiresAt ?? reference.admittedAt);
        }
        return stored.progress as ApplicationJobProgressSnapshot<TProgress> | undefined;
      },
    };
  };

  return {
    protocol: applicationJobRuntimeProtocol,
    register(definition) {
      const erased = definition as unknown as AnyJobDefinition;
      const existing = definitions.get(definition.id);
      if (existing && existing !== erased) {
        throw new Error(`Job ${definition.id} was registered more than once with different definitions.`);
      }
      definitions.set(definition.id, erased);
      wake();
    },
    async start(definition, rawInput, invocation: Omit<ApplicationJobInvocationOptions, 'wait'> = {}) {
      this.register?.(definition);
      const input = validateMessage(definition.contract.input, rawInput, `${definition.id}.input`);
      const admittedAt = now().toISOString();
      const admission = invocation.admission ?? localAdmission(definition.id, admittedAt);
      const authoredKey = invocation.idempotencyKey ?? definition.options.idempotencyKey?.(input);
      const scope = authoredKey === undefined ? undefined : digest({
        application,
        deployment,
        job: definition.id,
        trustedContextDigest: admission.trustedContext.digest,
        authorityRevision: admission.authorityRevision,
        key: authoredKey,
      });
      const timeout = definition.options.timeout
        ? parseApplicationScheduleDuration(definition.options.timeout)
        : undefined;
      const reference = createApplicationJobReference(definition.id, admittedAt, id());
      const result = await store.admit({
        reference,
        input,
        admission,
        maximumAttempts: (definition.options.retries ?? 0) + 1,
        availableAt: admittedAt,
        ...(timeout ? { deadline: new Date(Date.parse(admittedAt) + timeout * 1_000).toISOString() } : {}),
        ...(scope ? { idempotencyScope: scope } : {}),
      });
      if (result.status === 'conflict') throw new ApplicationJobIdempotencyConflictError(definition.id);
      wake();
      return runFor(result.run.reference);
    },
    async attach(job, reference) {
      if (reference.protocol !== applicationJobRuntimeProtocol || reference.job !== job) {
        throw new Error(`Job reference does not belong to ${job}.`);
      }
      const stored = await store.read(reference.runId);
      if (!stored || stored.reference.job !== job || stored.reference.admittedAt !== reference.admittedAt) {
        throw new Error(`Job ${job} run ${reference.runId} was not found.`);
      }
      wake();
      return runFor(reference);
    },
    async close() {
      closed = true;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      for (const controller of controllers.values()) controller.abort(new Error('JOB_WORKER_STOPPED'));
      controllers.clear();
    },
  };
}

async function terminalizeDeadline(
  store: ApplicationJobStore,
  run: ApplicationJobStoredRun,
  lease: ApplicationJobLeaseToken,
  definition: AnyJobDefinition,
  now: () => Date,
  resultRetentionSeconds: number,
): Promise<void> {
  const terminalAt = now().toISOString();
  try {
    await store.terminalize({
      runId: run.reference.runId,
      lease,
      outcome: { status: 'timedOut', deadline: run.deadline ?? terminalAt },
      terminalAt,
      resultExpiresAt: retentionExpiry(
        terminalAt,
        definition.options.retention?.result,
        resultRetentionSeconds,
      ),
    });
  } catch (cause) {
    if (!(cause instanceof ApplicationJobLeaseLostError)) throw cause;
  }
}

async function failTerminal(
  store: ApplicationJobStore,
  run: ApplicationJobStoredRun,
  lease: ApplicationJobLeaseToken,
  outcome: ApplicationJobTerminalOutcome<object, object>,
  definition: AnyJobDefinition,
  now: () => Date,
  fallbackSeconds: number,
): Promise<void> {
  const terminalAt = now().toISOString();
  await store.terminalize({
    runId: run.reference.runId,
    lease,
    outcome,
    terminalAt,
    resultExpiresAt: retentionExpiry(terminalAt, definition.options.retention?.result, fallbackSeconds),
  });
}

function localAdmission(job: string, admittedAt: string): ApplicationAdmissionInvocationContextV1 {
  const trustedContextDigest = digest({});
  const operationId = `applik8s://jobs/${encodeURIComponent(job)}/operations/run`;
  return {
    apiVersion: applicationAdmissionContextVersion,
    principal: {
      id: 'principal:applik8s:durable-job-runtime',
      identity: {
        id: 'identity:applik8s:durable-job-runtime',
        kind: 'service',
        issuer: 'applik8s://job-runtime',
        subject: 'durable',
      },
      kind: 'service',
      authenticationMethod: 'framework',
      audience: [operationId],
      trustedContextDigest,
      catalogRevision: 'durable-job-catalog/v1',
      authorityRevision: 'durable-job-runtime/v1',
      admittedAt,
      expiresAt: new Date(Date.parse(admittedAt) + 86_400_000).toISOString(),
    },
    authorityRevision: 'durable-job-runtime/v1',
    trustedContext: { values: {}, digest: trustedContextDigest },
    operation: { id: operationId, transport: 'framework' },
    correlationId: randomUUID(),
    deadline: new Date(Date.parse(admittedAt) + 86_400_000).toISOString(),
  };
}

function retentionExpiry(from: string, authored: string | undefined, fallbackSeconds: number): string {
  const seconds = authored ? parseApplicationScheduleDuration(authored) : fallbackSeconds;
  return new Date(Date.parse(from) + seconds * 1_000).toISOString();
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}
