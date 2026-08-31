import { createHash, randomUUID } from 'node:crypto';
import {
  type ApplicationAdmissionInvocationContextV1,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import type {
  ApplicationJobCancellationReceipt,
  ApplicationJobProgressSnapshot,
  ApplicationJobReference,
  ApplicationJobTerminalOutcome,
} from './application-finite-jobs.js';

export const applicationJobStoreProtocol: 'applik8s.jobStore/v1alpha1' = 'applik8s.jobStore/v1alpha1';

export type ApplicationJobStorePhase = 'queued' | 'running' | 'terminal';

export interface ApplicationJobLeaseToken {
  readonly owner: string;
  readonly epoch: number;
}

export interface ApplicationJobLease extends ApplicationJobLeaseToken {
  readonly expiresAt: string;
}

export interface ApplicationJobStoredRun {
  readonly reference: ApplicationJobReference;
  readonly input: object;
  readonly inputDigest: string;
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly phase: ApplicationJobStorePhase;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly admittedAt: string;
  readonly availableAt: string;
  readonly deadline?: string | undefined;
  readonly idempotencyScope?: string | undefined;
  readonly lease?: ApplicationJobLease | undefined;
  readonly progress?: ApplicationJobProgressSnapshot<object> | undefined;
  readonly progressDigest?: string | undefined;
  readonly progressExpiresAt?: string | undefined;
  readonly cancellation?: ApplicationJobCancellationReceipt | undefined;
  readonly outcome?: ApplicationJobTerminalOutcome<object, object> | undefined;
  readonly outcomeDigest?: string | undefined;
  readonly terminalAt?: string | undefined;
  readonly resultExpiresAt?: string | undefined;
}

export interface ApplicationJobStoreAdmission {
  readonly reference: ApplicationJobReference;
  readonly input: object;
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly maximumAttempts: number;
  readonly availableAt: string;
  readonly deadline?: string;
  readonly idempotencyScope?: string;
}

export type ApplicationJobStoreAdmissionResult =
  | { readonly status: 'admitted'; readonly run: ApplicationJobStoredRun }
  | { readonly status: 'existing'; readonly run: ApplicationJobStoredRun }
  | { readonly status: 'conflict'; readonly run: ApplicationJobStoredRun };

export interface ApplicationJobClaimRequest {
  readonly owner: string;
  readonly now: string;
  readonly leaseSeconds: number;
  readonly jobs?: readonly string[];
}

export interface ApplicationJobTerminalWrite {
  readonly runId: string;
  readonly lease: ApplicationJobLeaseToken;
  readonly outcome: ApplicationJobTerminalOutcome<object, object>;
  readonly terminalAt: string;
  readonly resultExpiresAt: string;
}

export interface ApplicationJobRetryWrite {
  readonly runId: string;
  readonly lease: ApplicationJobLeaseToken;
  readonly availableAt: string;
}

export interface ApplicationJobProgressWrite {
  readonly runId: string;
  readonly lease: ApplicationJobLeaseToken;
  readonly value: object;
  readonly recordedAt: string;
  readonly expiresAt: string;
}

export interface ApplicationJobCancellationWrite {
  readonly runId: string;
  readonly requestedAt: string;
  readonly reason?: string;
  readonly resultExpiresAt: string;
}

export interface ApplicationJobPayloadPurgeRequest {
  readonly now: string;
}

export interface ApplicationJobPayloadPurgeResult {
  readonly outcomes: number;
  readonly progress: number;
}

export interface ApplicationJobStore {
  readonly protocol: typeof applicationJobStoreProtocol;
  admit(admission: ApplicationJobStoreAdmission): Promise<ApplicationJobStoreAdmissionResult>;
  claim(request: ApplicationJobClaimRequest): Promise<ApplicationJobStoredRun | undefined>;
  heartbeat(runId: string, lease: ApplicationJobLeaseToken, now: string, leaseSeconds: number): Promise<ApplicationJobStoredRun>;
  recordProgress(write: ApplicationJobProgressWrite): Promise<ApplicationJobStoredRun>;
  retry(write: ApplicationJobRetryWrite): Promise<ApplicationJobStoredRun>;
  terminalize(write: ApplicationJobTerminalWrite): Promise<ApplicationJobStoredRun>;
  cancel(write: ApplicationJobCancellationWrite): Promise<ApplicationJobStoredRun>;
  read(runId: string): Promise<ApplicationJobStoredRun | undefined>;
  purge(request: ApplicationJobPayloadPurgeRequest): Promise<ApplicationJobPayloadPurgeResult>;
}

export class ApplicationJobLeaseLostError extends Error {
  readonly code: 'JOB_LEASE_LOST' = 'JOB_LEASE_LOST';

  constructor(readonly runId: string, readonly owner: string, readonly epoch: number) {
    super(`Job run ${runId} is no longer leased to ${owner} at epoch ${epoch}.`);
    this.name = new.target.name;
  }
}

export class ApplicationJobStoreInvariantError extends Error {
  readonly code: 'JOB_STORE_INVARIANT' = 'JOB_STORE_INVARIANT';

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

interface MutableJobRun {
  reference: ApplicationJobReference;
  input: object;
  inputDigest: string;
  admission: ApplicationAdmissionInvocationContextV1;
  phase: ApplicationJobStorePhase;
  attempt: number;
  maximumAttempts: number;
  admittedAt: string;
  availableAt: string;
  deadline?: string;
  idempotencyScope?: string;
  lease?: ApplicationJobLease;
  progress?: ApplicationJobProgressSnapshot<object>;
  progressDigest?: string;
  progressExpiresAt?: string;
  cancellation?: ApplicationJobCancellationReceipt;
  outcome?: ApplicationJobTerminalOutcome<object, object>;
  outcomeDigest?: string;
  terminalAt?: string;
  resultExpiresAt?: string;
}

export interface DeterministicApplicationJobStore extends ApplicationJobStore {
  snapshot(): readonly ApplicationJobStoredRun[];
}

/**
 * Deterministic reference implementation of the durable Job state machine.
 * It deliberately serializes mutations so providers can differential-test
 * transactional admission, fencing, terminalization, and retention semantics.
 */
export function createDeterministicApplicationJobStore(): DeterministicApplicationJobStore {
  const runs = new Map<string, MutableJobRun>();
  const idempotency = new Map<string, string>();
  let mutation = Promise.resolve();

  const mutate = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    const previous = mutation;
    let release!: () => void;
    mutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const required = (runId: string): MutableJobRun => {
    const run = runs.get(runId);
    if (!run) throw new ApplicationJobStoreInvariantError(`Job run ${runId} does not exist.`);
    return run;
  };

  const assertLease = (run: MutableJobRun, token: ApplicationJobLeaseToken): ApplicationJobLease => {
    const lease = run.lease;
    if (!lease || lease.owner !== token.owner || lease.epoch !== token.epoch) {
      throw new ApplicationJobLeaseLostError(run.reference.runId, token.owner, token.epoch);
    }
    return lease;
  };

  const freeze = (run: MutableJobRun): ApplicationJobStoredRun => structuredClone(run);

  const terminalize = (
    run: MutableJobRun,
    outcome: ApplicationJobTerminalOutcome<object, object>,
    terminalAt: string,
    resultExpiresAt: string,
  ): void => {
    if (run.phase === 'terminal') return;
    assertChronology(terminalAt, resultExpiresAt, 'Job result expiry');
    run.phase = 'terminal';
    run.outcome = structuredClone(outcome);
    run.outcomeDigest = digest(outcome);
    run.terminalAt = terminalAt;
    run.resultExpiresAt = resultExpiresAt;
    delete run.lease;
  };

  return {
    protocol: applicationJobStoreProtocol,
    async admit(value) {
      return mutate(() => {
        const inputDigest = digest(value.input);
        if (value.idempotencyScope) {
          const existingId = idempotency.get(value.idempotencyScope);
          if (existingId) {
            const existing = required(existingId);
            return {
              status: existing.inputDigest === inputDigest ? 'existing' : 'conflict',
              run: freeze(existing),
            };
          }
        }
        if (runs.has(value.reference.runId)) {
          throw new ApplicationJobStoreInvariantError(`Job run ${value.reference.runId} already exists.`);
        }
        positiveInteger(value.maximumAttempts, 'Job maximumAttempts');
        const run: MutableJobRun = {
          reference: structuredClone(value.reference),
          input: structuredClone(value.input),
          inputDigest,
          admission: structuredClone(value.admission),
          phase: 'queued',
          attempt: 0,
          maximumAttempts: value.maximumAttempts,
          admittedAt: value.reference.admittedAt,
          availableAt: value.availableAt,
          ...(value.deadline ? { deadline: value.deadline } : {}),
          ...(value.idempotencyScope ? { idempotencyScope: value.idempotencyScope } : {}),
        };
        runs.set(run.reference.runId, run);
        if (value.idempotencyScope) idempotency.set(value.idempotencyScope, run.reference.runId);
        return { status: 'admitted', run: freeze(run) };
      });
    },
    async claim(request) {
      return mutate(() => {
        positiveInteger(request.leaseSeconds, 'Job leaseSeconds');
        if (!request.owner.trim()) throw new ApplicationJobStoreInvariantError('Job lease owner must be non-empty.');
        const now = timestamp(request.now, 'Job claim time');
        const eligible = [...runs.values()]
          .filter((run) => run.phase !== 'terminal')
          .filter((run) => !request.jobs || request.jobs.includes(run.reference.job))
          .filter((run) => Date.parse(run.availableAt) <= now)
          .filter((run) => run.phase === 'queued' || !run.lease || Date.parse(run.lease.expiresAt) <= now)
          .sort((left, right) => left.admittedAt.localeCompare(right.admittedAt) || left.reference.runId.localeCompare(right.reference.runId))[0];
        if (!eligible) return undefined;
        const epoch = (eligible.lease?.epoch ?? 0) + 1;
        eligible.phase = 'running';
        eligible.attempt += 1;
        eligible.lease = {
          owner: request.owner,
          epoch,
          expiresAt: new Date(now + request.leaseSeconds * 1_000).toISOString(),
        };
        return freeze(eligible);
      });
    },
    async heartbeat(runId, token, nowValue, leaseSeconds) {
      return mutate(() => {
        positiveInteger(leaseSeconds, 'Job leaseSeconds');
        const run = required(runId);
        assertLease(run, token);
        if (run.phase === 'terminal') throw new ApplicationJobLeaseLostError(runId, token.owner, token.epoch);
        run.lease = {
          ...token,
          expiresAt: new Date(timestamp(nowValue, 'Job heartbeat time') + leaseSeconds * 1_000).toISOString(),
        };
        return freeze(run);
      });
    },
    async recordProgress(write) {
      return mutate(() => {
        const run = required(write.runId);
        assertLease(run, write.lease);
        if (run.phase === 'terminal') throw new ApplicationJobLeaseLostError(write.runId, write.lease.owner, write.lease.epoch);
        assertChronology(write.recordedAt, write.expiresAt, 'Job progress expiry');
        const snapshot: ApplicationJobProgressSnapshot<object> = {
          run: run.reference,
          sequence: (run.progress?.sequence ?? 0) + 1,
          recordedAt: write.recordedAt,
          value: structuredClone(write.value),
        };
        run.progress = snapshot;
        run.progressDigest = digest(write.value);
        run.progressExpiresAt = write.expiresAt;
        return freeze(run);
      });
    },
    async retry(write) {
      return mutate(() => {
        const run = required(write.runId);
        assertLease(run, write.lease);
        if (run.phase === 'terminal') return freeze(run);
        if (run.attempt >= run.maximumAttempts) {
          throw new ApplicationJobStoreInvariantError(`Job run ${write.runId} exhausted its ${run.maximumAttempts} attempts.`);
        }
        run.phase = 'queued';
        run.availableAt = write.availableAt;
        delete run.lease;
        return freeze(run);
      });
    },
    async terminalize(write) {
      return mutate(() => {
        const run = required(write.runId);
        if (run.phase === 'terminal') return freeze(run);
        assertLease(run, write.lease);
        terminalize(run, write.outcome, write.terminalAt, write.resultExpiresAt);
        return freeze(run);
      });
    },
    async cancel(write) {
      return mutate(() => {
        const run = required(write.runId);
        if (run.phase === 'terminal') return freeze(run);
        assertChronology(write.requestedAt, write.resultExpiresAt, 'Cancelled Job result expiry');
        run.cancellation ??= {
          run: run.reference,
          requestedAt: write.requestedAt,
          ...(write.reason?.trim() ? { reason: write.reason.trim() } : {}),
        };
        if (run.phase === 'queued') {
          terminalize(run, {
            status: 'cancelled',
            ...(run.cancellation.reason ? { reason: run.cancellation.reason } : {}),
          }, write.requestedAt, write.resultExpiresAt);
        }
        return freeze(run);
      });
    },
    async read(runId) {
      await mutation;
      const run = runs.get(runId);
      return run ? freeze(run) : undefined;
    },
    async purge(request) {
      return mutate(() => {
        const now = timestamp(request.now, 'Job purge time');
        let outcomes = 0;
        let progress = 0;
        for (const run of runs.values()) {
          if (run.outcome && run.resultExpiresAt && Date.parse(run.resultExpiresAt) <= now) {
            delete run.outcome;
            outcomes += 1;
          }
          if (run.progress && run.progressExpiresAt && Date.parse(run.progressExpiresAt) <= now) {
            delete run.progress;
            progress += 1;
          }
        }
        return { outcomes, progress };
      });
    },
    snapshot() {
      return [...runs.values()]
        .sort((left, right) => left.admittedAt.localeCompare(right.admittedAt) || left.reference.runId.localeCompare(right.reference.runId))
        .map(freeze);
    },
  };
}

export function createApplicationJobReference(job: string, admittedAt: string, runId: string = randomUUID()): ApplicationJobReference {
  return {
    protocol: 'applik8s.jobRuntime/v1alpha1',
    job,
    runId,
    admittedAt,
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
}

function timestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new ApplicationJobStoreInvariantError(`${label} must be an ISO timestamp.`);
  return milliseconds;
}

function assertChronology(start: string, end: string, label: string): void {
  if (timestamp(end, label) <= timestamp(start, label)) {
    throw new ApplicationJobStoreInvariantError(`${label} must be later than its source transition.`);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new ApplicationJobStoreInvariantError(`${label} must be a positive integer.`);
  return value;
}
