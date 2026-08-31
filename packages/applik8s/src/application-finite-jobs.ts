// typecast-file-boundary: The local Job runtime erases schema-validated record generics only inside its heterogeneous durable run map and restores them through definition-owned handles.
import { createHash, randomUUID } from 'node:crypto';
import {
  type ApplicationAdmissionInvocationContextV1,
  type JsonObject,
  applicationAdmissionContextVersion,
  canonicalJsonV1String,
} from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import { serializeApplicationCallback } from './application-callback.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderRequirement } from './application-graph-state.js';
import { applicationProviderGraphNodeId, kubernetesNameSegment } from './application-identifiers.js';
import {
  type ApplicationFixedScheduleHandle,
  type ApplicationScheduleConvergenceResult,
  type ApplicationScheduleHandle,
  parseApplicationScheduleDuration,
  schedule as applicationSchedule,
} from './application-schedule.js';
import { declaredSchema, validateMessage } from './application-schema-runtime.js';
import { functionExpression } from './application-workflow-serialization.js';
import { event, type EventDefinition } from './dsl.js';

export const applicationJobRuntimeProtocol = 'applik8s.jobRuntime/v1alpha1' as const;

export interface ApplicationJobContract<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
> {
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly progress?: SchemaInput<TProgress>;
  readonly error?: SchemaInput<TError>;
}

export interface ApplicationJobOptions<TInput extends object> {
  /** Whole-attempt retries after the initial attempt. */
  readonly retries?: number;
  /** Managed execution deadline. This is distinct from a caller wait timeout. */
  readonly timeout?: string;
  readonly idempotencyKey?: (input: TInput) => string;
  readonly retention?: {
    readonly result?: string;
    readonly progress?: string;
    readonly applicationFacts?: string;
    readonly providerAttempts?: string;
  };
}

export interface ApplicationJobInvocationOptions {
  readonly idempotencyKey?: string;
  readonly wait?: { readonly timeout: string };
  /** Framework-admitted execution identity. Transport adapters supply this; clients do not author it. */
  readonly admission?: ApplicationAdmissionInvocationContextV1;
}

export interface ApplicationJobOneTimeScheduleOptions {
  readonly at: string | Date;
  /** Stable desired-state identity. Omission derives one from Job, input, and instant. */
  readonly id?: string;
  readonly timezone?: string;
}

export type ApplicationJobRecurringScheduleOptions = {
  readonly timezone?: string;
  readonly overlap?: 'allow' | 'skip';
  readonly misfire?:
    | { readonly policy: 'skip'; readonly grace?: string }
    | { readonly policy: 'runOnce'; readonly grace?: string }
    | { readonly policy: 'catchUp'; readonly grace?: string; readonly maximumOccurrences: number };
} & (
  | { readonly cron: string; readonly every?: never }
  | { readonly cron?: never; readonly every: string }
);

export interface ApplicationJobDynamicSchedule<TInput extends object> {
  readonly id: string;
  readonly input: TInput;
  readonly revision?: string;
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string | Date;
  readonly timezone?: string;
  readonly enabled?: boolean;
}

export interface ApplicationJobSchedules<TInput extends object> {
  reconcile(schedule: ApplicationJobDynamicSchedule<TInput>): Promise<ApplicationScheduleConvergenceResult>;
  remove(id: string): Promise<ApplicationScheduleConvergenceResult>;
}

export interface ApplicationJobReference {
  readonly protocol: typeof applicationJobRuntimeProtocol;
  readonly job: string;
  readonly runId: string;
  readonly admittedAt: string;
}

export interface ApplicationJobCancellationReceipt {
  readonly run: ApplicationJobReference;
  readonly requestedAt: string;
  readonly reason?: string;
}

export interface ApplicationJobProgressSnapshot<TProgress extends object> {
  readonly run: ApplicationJobReference;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly value: TProgress;
}

export type ApplicationJobFailure<TError extends object = never> =
  | { readonly kind: 'application'; readonly error: TError }
  | {
      readonly kind: 'execution';
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly kind: 'provider';
      readonly provider: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    };

export type ApplicationJobTerminalOutcome<
  TOutput extends object,
  TError extends object = never,
> =
  | { readonly status: 'succeeded'; readonly output: TOutput }
  | { readonly status: 'failed'; readonly failure: ApplicationJobFailure<TError> }
  | { readonly status: 'cancelled'; readonly reason?: string }
  | { readonly status: 'timedOut'; readonly deadline: string };

export interface ApplicationJobStartedFact {
  readonly run: ApplicationJobReference;
  readonly attempt: number;
  readonly startedAt: string;
}

export type ApplicationJobProgressedFact<TProgress extends object> = ApplicationJobProgressSnapshot<TProgress>;
export interface ApplicationJobSucceededFact<TOutput extends object> {
  readonly run: ApplicationJobReference;
  readonly completedAt: string;
  readonly output: TOutput;
}
export interface ApplicationJobFailedFact<TError extends object = never> {
  readonly run: ApplicationJobReference;
  readonly completedAt: string;
  readonly failure: ApplicationJobFailure<TError>;
}
export interface ApplicationJobCancelledFact {
  readonly run: ApplicationJobReference;
  readonly completedAt: string;
  readonly reason?: string;
}
export interface ApplicationJobTimedOutFact {
  readonly run: ApplicationJobReference;
  readonly completedAt: string;
  readonly deadline: string;
}

export interface ApplicationJobEvents<TOutput extends object, TProgress extends object, TError extends object> {
  readonly started: EventDefinition<ApplicationJobStartedFact>;
  readonly progressed: EventDefinition<ApplicationJobProgressedFact<TProgress>>;
  readonly succeeded: EventDefinition<ApplicationJobSucceededFact<TOutput>>;
  readonly failed: EventDefinition<ApplicationJobFailedFact<TError>>;
  readonly cancelled: EventDefinition<ApplicationJobCancelledFact>;
  readonly timedOut: EventDefinition<ApplicationJobTimedOutFact>;
}

export type ApplicationJobCancellationResult<
  TOutput extends object,
  TError extends object = never,
> =
  | { readonly status: 'requested'; readonly receipt: ApplicationJobCancellationReceipt }
  | { readonly status: 'alreadyTerminal'; readonly outcome: ApplicationJobTerminalOutcome<TOutput, TError> };

export interface ApplicationJobExecution<
  TProgress extends object,
  TError extends object,
> {
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly run: ApplicationJobReference;
  readonly invocationId: string;
  readonly attempt: number;
  readonly deadline?: string;
  readonly signal: AbortSignal;
  progress(value: TProgress): Promise<ApplicationJobProgressSnapshot<TProgress>>;
  throwIfCancelled(): void;
  fail(error: TError): never;
}

export type ApplicationJobHandler<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
> = (
  input: TInput,
  execution: ApplicationJobExecution<TProgress, TError>,
) => TOutput | Promise<TOutput>;

export interface ApplicationJobRun<
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
> {
  readonly reference: ApplicationJobReference;
  result(): Promise<TOutput>;
  outcome(): Promise<ApplicationJobTerminalOutcome<TOutput, TError>>;
  cancel(reason?: string): Promise<ApplicationJobCancellationResult<TOutput, TError>>;
  progress(): Promise<ApplicationJobProgressSnapshot<TProgress> | undefined>;
}

export interface ApplicationJobBinding<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
> {
  (input: TInput, options?: ApplicationJobInvocationOptions): Promise<TOutput>;
  readonly kind: 'applicationJob';
  readonly id: string;
  /** Immutable authoring contract used by compiler discovery and typed schedule lowering. */
  readonly definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>;
  readonly events: ApplicationJobEvents<TOutput, TProgress, TError>;
  start(input: TInput, options?: Omit<ApplicationJobInvocationOptions, 'wait'>): Promise<ApplicationJobRun<TOutput, TProgress, TError>>;
  attach(reference: ApplicationJobReference): Promise<ApplicationJobRun<TOutput, TProgress, TError>>;
  schedule(input: TInput, options: ApplicationJobOneTimeScheduleOptions): Promise<ApplicationScheduleConvergenceResult>;
  schedule(
    id: string,
    input: TInput,
    options: ApplicationJobRecurringScheduleOptions,
  ): ApplicationFixedScheduleHandle<ApplicationJobReference>;
  readonly schedules: ApplicationJobSchedules<TInput>;
}

export interface ApplicationJobDefinition<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
> {
  readonly id: string;
  readonly contract: ApplicationJobContract<TInput, TOutput, TProgress, TError>;
  readonly options: ApplicationJobOptions<TInput>;
  readonly handler: ApplicationJobHandler<TInput, TOutput, TProgress, TError>;
  readonly events?: ApplicationJobEvents<TOutput, TProgress, TError>;
}

export interface ApplicationJobRuntime {
  readonly protocol: typeof applicationJobRuntimeProtocol;
  register?<TInput extends object, TOutput extends object, TProgress extends object, TError extends object>(
    definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
  ): void;
  start<TInput extends object, TOutput extends object, TProgress extends object, TError extends object>(
    definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
    input: TInput,
    options?: Omit<ApplicationJobInvocationOptions, 'wait'>,
  ): Promise<ApplicationJobRun<TOutput, TProgress, TError>>;
  attach<TOutput extends object, TProgress extends object, TError extends object>(
    job: string,
    reference: ApplicationJobReference,
  ): Promise<ApplicationJobRun<TOutput, TProgress, TError>>;
}

export interface DeterministicApplicationJobRuntimeOptions {
  readonly application?: string;
  readonly deployment?: string;
  readonly maximumConcurrency?: number;
  readonly resultRetentionSeconds?: number;
  readonly progressRetentionSeconds?: number;
  readonly now?: () => Date;
  readonly id?: () => string;
}

export type ApplicationJobRuntimeResolver = (
  providerNodeId: string,
) => ApplicationJobRuntime | undefined;

export class ApplicationJobProviderUnsupportedError extends Error {
  readonly code = 'JOB_PROVIDER_UNSUPPORTED' as const;

  constructor(readonly providerNodeId: string) {
    super(
      `No JobRuntime adapter is installed for ${providerNodeId}. Compile the application for its selected target or install a matching runtime resolver.`,
    );
    this.name = new.target.name;
  }
}

const applicationJobRuntimeResolvers: ApplicationJobRuntimeResolver[] = [];
let defaultApplicationJobRuntime: ApplicationJobRuntime | undefined;

export function installApplicationJobRuntimeResolver(
  resolver: ApplicationJobRuntimeResolver,
): () => void {
  applicationJobRuntimeResolvers.push(resolver);
  return () => {
    const index = applicationJobRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) applicationJobRuntimeResolvers.splice(index, 1);
  };
}

export function applicationJobRuntime(
  providerNodeId = applicationProviderGraphNodeId('JobRuntime'),
  options: { readonly allowLocalFallback?: boolean } = {},
): ApplicationJobRuntime {
  for (const resolver of [...applicationJobRuntimeResolvers].reverse()) {
    const runtime = resolver(providerNodeId);
    if (runtime) return runtime;
  }
  if (options.allowLocalFallback === false) {
    throw new ApplicationJobProviderUnsupportedError(providerNodeId);
  }
  defaultApplicationJobRuntime ??= createDeterministicApplicationJobRuntime();
  return defaultApplicationJobRuntime;
}

export class ApplicationJobRunError<TError extends object = never> extends Error {
  constructor(
    readonly run: ApplicationJobReference,
    readonly terminal: Exclude<ApplicationJobTerminalOutcome<object, TError>, { readonly status: 'succeeded' }>,
  ) {
    super(`Job ${run.job} run ${run.runId} ended as ${terminal.status}.`);
    this.name = new.target.name;
  }
}

export class ApplicationJobInvocationTimeoutError extends Error {
  constructor(readonly run: ApplicationJobReference, readonly timeout: string) {
    super(`Timed out waiting ${timeout} for Job ${run.job} run ${run.runId}; the managed run remains active.`);
    this.name = new.target.name;
  }
}

export class ApplicationJobIdempotencyConflictError extends Error {
  readonly code = 'JOB_IDEMPOTENCY_CONFLICT';
  constructor(readonly job: string) {
    super(`Job ${job} received a different input for an existing scoped idempotency key.`);
    this.name = new.target.name;
  }
}

export class ApplicationJobCancelledError extends Error {
  constructor(readonly reason?: string) {
    super(reason ? `Job cancellation requested: ${reason}` : 'Job cancellation requested.');
    this.name = new.target.name;
  }
}

export class ApplicationJobResultExpiredError extends Error {
  readonly code = 'JOB_RESULT_EXPIRED';
  constructor(readonly run: ApplicationJobReference, readonly expiredAt: string) {
    super(`Job ${run.job} run ${run.runId} result expired at ${expiredAt}.`);
    this.name = new.target.name;
  }
}

export class ApplicationJobProgressExpiredError extends Error {
  readonly code = 'JOB_PROGRESS_EXPIRED';
  constructor(readonly run: ApplicationJobReference, readonly expiredAt: string) {
    super(`Job ${run.job} run ${run.runId} progress expired at ${expiredAt}.`);
    this.name = new.target.name;
  }
}

export function applicationJobLifecycleEvents<
  TInput extends object,
  TOutput extends object,
  TProgress extends object,
  TError extends object,
>(
  id: string,
  contract: ApplicationJobContract<TInput, TOutput, TProgress, TError>,
): ApplicationJobEvents<TOutput, TProgress, TError> {
  const identity = finiteJobIdentity(id);
  const prefix = `jobs.${identity.name}`;
  const version = identity.version;
  const output = emittedJobSchema(contract.output, `${id}.output`);
  const progress = contract.progress
    ? emittedJobSchema(contract.progress, `${id}.progress`)
    : { type: 'object', additionalProperties: false, properties: {} } satisfies JsonObject;
  const applicationFailure = contract.error
    ? [{
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'error'],
        properties: { kind: { const: 'application' }, error: emittedJobSchema(contract.error, `${id}.error`) },
      } satisfies JsonObject]
    : [];
  const failure = {
    oneOf: [
      ...applicationFailure,
      {
        type: 'object', additionalProperties: false, required: ['kind', 'code', 'message', 'retryable'],
        properties: { kind: { const: 'execution' }, code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } },
      },
      {
        type: 'object', additionalProperties: false, required: ['kind', 'provider', 'code', 'message', 'retryable'],
        properties: { kind: { const: 'provider' }, provider: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } },
      },
    ],
  } satisfies JsonObject;
  const run = applicationJobReferenceJsonSchema();
  const timestamp = { type: 'string', format: 'date-time' } satisfies JsonObject;
  return Object.freeze({
    started: applicationJobEvent<ApplicationJobStartedFact>(`${prefix}.started.${version}`, {
      run, attempt: { type: 'integer', minimum: 1 }, startedAt: timestamp,
    }, ['run', 'attempt', 'startedAt']),
    progressed: applicationJobEvent<ApplicationJobProgressedFact<TProgress>>(`${prefix}.progressed.${version}`, {
      run, sequence: { type: 'integer', minimum: 1 }, recordedAt: timestamp, value: progress,
    }, ['run', 'sequence', 'recordedAt', 'value']),
    succeeded: applicationJobEvent<ApplicationJobSucceededFact<TOutput>>(`${prefix}.succeeded.${version}`, {
      run, completedAt: timestamp, output,
    }, ['run', 'completedAt', 'output']),
    failed: applicationJobEvent<ApplicationJobFailedFact<TError>>(`${prefix}.failed.${version}`, {
      run, completedAt: timestamp, failure,
    }, ['run', 'completedAt', 'failure']),
    cancelled: applicationJobEvent<ApplicationJobCancelledFact>(`${prefix}.cancelled.${version}`, {
      run, completedAt: timestamp, reason: { type: 'string' },
    }, ['run', 'completedAt']),
    timedOut: applicationJobEvent<ApplicationJobTimedOutFact>(`${prefix}.timedOut.${version}`, {
      run, completedAt: timestamp, deadline: timestamp,
    }, ['run', 'completedAt', 'deadline']),
  });
}

function applicationJobEvent<TPayload extends object>(
  id: string,
  properties: Readonly<Record<string, JsonObject>>,
  required: readonly string[],
): EventDefinition<TPayload> {
  return event<TPayload>(id, {
    payload: {
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: id },
      schema: { type: 'object', additionalProperties: false, properties, required },
    },
  });
}

function emittedJobSchema<TValue extends object>(schema: SchemaInput<TValue>, label: string): JsonObject {
  const emitted = normalizeSchema(schema, label).emitJsonSchema();
  if (!emitted.ok) throw new Error(`Application Job schema ${label} cannot be emitted: ${emitted.error.message}`);
  return emitted.value.schema;
}

function applicationJobReferenceJsonSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['protocol', 'job', 'runId', 'admittedAt'],
    properties: {
      protocol: { const: applicationJobRuntimeProtocol },
      job: { type: 'string', minLength: 1 },
      runId: { type: 'string', minLength: 1 },
      admittedAt: { type: 'string', format: 'date-time' },
    },
  };
}

class ApplicationJobAuthoredFailure<TError extends object> extends Error {
  constructor(readonly value: TError) {
    super('Application Job reported a typed failure.');
  }
}

interface LocalJobRecord<TInput extends object, TOutput extends object, TProgress extends object, TError extends object> {
  readonly definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>;
  readonly reference: ApplicationJobReference;
  readonly input: TInput;
  readonly inputDigest: string;
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly completion: Promise<void>;
  resolve(): void;
  phase: 'queued' | 'running' | 'terminal';
  attempt: number;
  outcome?: ApplicationJobTerminalOutcome<TOutput, TError>;
  terminalStatus?: ApplicationJobTerminalOutcome<TOutput, TError>['status'];
  terminalDigest?: string;
  progress?: ApplicationJobProgressSnapshot<TProgress>;
  progressRecordedAt?: string;
  progressDigest?: string;
  cancellation?: ApplicationJobCancellationReceipt;
  controller?: AbortController;
  terminalAt?: string;
}

/** Deterministic local conformance runtime; persistence/provider adapters implement this same contract. */
export function createDeterministicApplicationJobRuntime(
  options: DeterministicApplicationJobRuntimeOptions = {},
): ApplicationJobRuntime {
  const application = options.application?.trim() || 'application';
  const deployment = options.deployment?.trim() || 'local';
  const maximumConcurrency = positiveInteger(options.maximumConcurrency ?? 4, 'Job maximumConcurrency');
  const defaultResultRetentionSeconds = positiveInteger(options.resultRetentionSeconds ?? 86_400, 'Job resultRetentionSeconds');
  const defaultProgressRetentionSeconds = positiveInteger(options.progressRetentionSeconds ?? 86_400, 'Job progressRetentionSeconds');
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const records = new Map<string, LocalJobRecord<object, object, object, object>>();
  const idempotency = new Map<string, string>();
  const queue: LocalJobRecord<object, object, object, object>[] = [];
  let running = 0;

  const terminalize = (
    record: LocalJobRecord<object, object, object, object>,
    outcome: ApplicationJobTerminalOutcome<object, object>,
  ): boolean => {
    if (record.terminalAt) return false;
    record.outcome = outcome;
    record.terminalStatus = outcome.status;
    record.terminalDigest = digest(outcome);
    record.phase = 'terminal';
    record.terminalAt = now().toISOString();
    record.resolve();
    return true;
  };

  const drain = (): void => {
    while (running < maximumConcurrency) {
      const record = queue.shift();
      if (!record) return;
      if (record.terminalAt) continue;
      running += 1;
      record.phase = 'running';
      void execute(record).finally(() => {
        running -= 1;
        drain();
      });
    }
  };

  const execute = async (record: LocalJobRecord<object, object, object, object>): Promise<void> => {
    const retries = nonNegativeInteger(record.definition.options.retries ?? 0, `Job ${record.definition.id} retries`);
    const timeoutSeconds = record.definition.options.timeout
      ? parseApplicationScheduleDuration(record.definition.options.timeout)
      : undefined;
    const deadline = timeoutSeconds === undefined
      ? undefined
      : new Date(now().getTime() + timeoutSeconds * 1_000).toISOString();
    const deadlineTimer = timeoutSeconds === undefined || deadline === undefined ? undefined : setTimeout(() => {
      record.controller?.abort(new Error('JOB_EXECUTION_DEADLINE_EXCEEDED'));
      terminalize(record, { status: 'timedOut', deadline });
    }, timeoutSeconds * 1_000);
    try {
      for (let attempt = 1; attempt <= retries + 1 && !record.terminalAt; attempt += 1) {
        record.attempt = attempt;
        const controller = new AbortController();
        record.controller = controller;
        if (record.cancellation) controller.abort(new ApplicationJobCancelledError(record.cancellation.reason));
        try {
          const output = await record.definition.handler(record.input, {
            admission: record.admission,
            run: record.reference,
            invocationId: record.reference.runId,
            attempt,
            ...(deadline ? { deadline } : {}),
            signal: controller.signal,
            progress: async (value) => {
              const validated = record.definition.contract.progress
                ? validateMessage(record.definition.contract.progress, value, `${record.definition.id}.progress`)
                : value;
              const snapshot = {
                run: record.reference,
                sequence: (record.progress?.sequence ?? 0) + 1,
                recordedAt: now().toISOString(),
                value: validated,
              };
              record.progress = snapshot;
              record.progressRecordedAt = snapshot.recordedAt;
              record.progressDigest = digest(snapshot.value);
              return snapshot;
            },
            throwIfCancelled: () => {
              if (controller.signal.aborted) throw new ApplicationJobCancelledError(record.cancellation?.reason);
            },
            fail: (error) => {
              const value = record.definition.contract.error
                ? validateMessage(record.definition.contract.error, error, `${record.definition.id}.error`)
                : error;
              throw new ApplicationJobAuthoredFailure(value);
            },
          });
          const validated = validateMessage(record.definition.contract.output, output, `${record.definition.id}.output`);
          terminalize(record, { status: 'succeeded', output: validated });
        } catch (error) {
          if (record.terminalAt) break;
          if (record.cancellation || error instanceof ApplicationJobCancelledError || controller.signal.aborted) {
            terminalize(record, {
              status: 'cancelled',
              ...(record.cancellation?.reason ? { reason: record.cancellation.reason } : {}),
            });
          } else if (error instanceof ApplicationJobAuthoredFailure) {
            terminalize(record, { status: 'failed', failure: { kind: 'application', error: error.value } });
          } else if (attempt > retries) {
            terminalize(record, {
              status: 'failed',
              failure: {
                kind: 'execution',
                code: 'JOB_EXECUTION_FAILED',
                message: 'The Job attempt failed after its retry budget was exhausted.',
                retryable: false,
              },
            });
          }
        }
      }
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      delete record.controller;
    }
  };

  const runFor = <TOutput extends object, TProgress extends object, TError extends object>(
    record: LocalJobRecord<object, object, object, object>,
  ): ApplicationJobRun<TOutput, TProgress, TError> => {
    const expiresAt = (retention: string | undefined, fallbackSeconds: number, from: string): string =>
      new Date(Date.parse(from) + (retention ? parseApplicationScheduleDuration(retention) : fallbackSeconds) * 1_000).toISOString();
    const retainedOutcome = (): ApplicationJobTerminalOutcome<TOutput, TError> => {
      if (!record.terminalAt || !record.terminalStatus || !record.terminalDigest) {
        throw new Error(`Job ${record.reference.job} run ${record.reference.runId} has no terminal identity.`);
      }
      const expiredAt = expiresAt(record.definition.options.retention?.result, defaultResultRetentionSeconds, record.terminalAt);
      if (now().getTime() >= Date.parse(expiredAt)) {
        delete record.outcome;
        throw new ApplicationJobResultExpiredError(record.reference, expiredAt);
      }
      if (!record.outcome) {
        throw new Error(`Job ${record.reference.job} run ${record.reference.runId} retained no terminal payload before ${expiredAt}.`);
      }
      return record.outcome as ApplicationJobTerminalOutcome<TOutput, TError>;
    };
    return ({
    reference: record.reference,
    async outcome() {
      await record.completion;
      return retainedOutcome();
    },
    async result() {
      await record.completion;
      const outcome = retainedOutcome();
      if (outcome.status === 'succeeded') return outcome.output;
      throw new ApplicationJobRunError(record.reference, outcome);
    },
    async cancel(reason) {
      if (record.terminalAt) {
        return { status: 'alreadyTerminal', outcome: retainedOutcome() };
      }
      const receipt = record.cancellation ?? {
        run: record.reference,
        requestedAt: now().toISOString(),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      };
      record.cancellation = receipt;
      record.controller?.abort(new ApplicationJobCancelledError(receipt.reason));
      if (record.phase === 'queued') {
        terminalize(record, { status: 'cancelled', ...(receipt.reason ? { reason: receipt.reason } : {}) });
      }
      return { status: 'requested', receipt };
    },
    async progress() {
      if (record.progressRecordedAt && record.progressDigest) {
        const expiredAt = expiresAt(record.definition.options.retention?.progress, defaultProgressRetentionSeconds, record.progressRecordedAt);
        if (now().getTime() >= Date.parse(expiredAt)) {
          delete record.progress;
          throw new ApplicationJobProgressExpiredError(record.reference, expiredAt);
        }
      }
      return record.progress as ApplicationJobProgressSnapshot<TProgress> | undefined;
    },
    });
  };

  return {
    protocol: applicationJobRuntimeProtocol,
    async start<TInput extends object, TOutput extends object, TProgress extends object, TError extends object>(
      definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
      rawInput: TInput,
      invocation: Omit<ApplicationJobInvocationOptions, 'wait'> = {},
    ) {
      const input = validateMessage(definition.contract.input, rawInput, `${definition.id}.input`);
      const admission = invocation.admission ?? localJobAdmission(definition.id, now);
      const authoredKey = invocation.idempotencyKey ?? definition.options.idempotencyKey?.(input);
      const inputDigest = digest(input);
      const scope = authoredKey === undefined ? undefined : digest({
        application,
        deployment,
        job: definition.id,
        trustedContextDigest: admission.trustedContext.digest,
        authorityRevision: admission.authorityRevision,
        key: authoredKey,
      });
      const existingId = scope === undefined ? undefined : idempotency.get(scope);
      if (existingId) {
        const existing = records.get(existingId);
        if (!existing) throw new Error(`Job ${definition.id} idempotency state references missing run ${existingId}.`);
        if (existing.inputDigest !== inputDigest) throw new ApplicationJobIdempotencyConflictError(definition.id);
        return runFor<TOutput, TProgress, TError>(existing);
      }
      const reference = {
        protocol: applicationJobRuntimeProtocol,
        job: definition.id,
        runId: id(),
        admittedAt: now().toISOString(),
      } satisfies ApplicationJobReference;
      let resolve!: () => void;
      const completion = new Promise<void>((resolved) => {
        resolve = resolved;
      });
      const record: LocalJobRecord<TInput, TOutput, TProgress, TError> = {
        definition,
        reference,
        input,
        inputDigest,
        admission,
        completion,
        resolve,
        phase: 'queued',
        attempt: 0,
      };
      // typecast-boundary: the runtime map erases only schema-validated payload
      // generics; every typed handle is reconstructed from its owning definition.
      const erasedRecord = record as unknown as LocalJobRecord<object, object, object, object>;
      records.set(reference.runId, erasedRecord);
      if (scope !== undefined) idempotency.set(scope, reference.runId);
      queue.push(erasedRecord);
      queueMicrotask(drain);
      return runFor<TOutput, TProgress, TError>(erasedRecord);
    },
    async attach<TOutput extends object, TProgress extends object, TError extends object>(
      job: string,
      reference: ApplicationJobReference,
    ) {
      if (reference.protocol !== applicationJobRuntimeProtocol || reference.job !== job) {
        throw new Error(`Job reference does not belong to ${job}.`);
      }
      const record = records.get(reference.runId);
      if (!record || record.reference.job !== job || record.reference.admittedAt !== reference.admittedAt) {
        throw new Error(`Job ${job} run ${reference.runId} was not found.`);
      }
      return runFor<TOutput, TProgress, TError>(record);
    },
  };
}

/** Internal registration primitive used by the application-owned Job registrar. */
export function createApplicationJobBinding<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
>(
  definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
  runtime: ApplicationJobRuntime,
): ApplicationJobBinding<TInput, TOutput, TProgress, TError> {
  const events = definition.events ?? applicationJobLifecycleEvents(definition.id, definition.contract);
  const registeredDefinition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError> = {
    ...definition,
    events,
  };
  runtime.register?.(registeredDefinition);
  const callable = async (
    input: TInput,
    options: ApplicationJobInvocationOptions = {},
  ): Promise<TOutput> => {
    const run = await runtime.start(registeredDefinition, input, options);
    if (!options.wait) return run.result();
    const milliseconds = parseApplicationScheduleDuration(options.wait.timeout) * 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run.result(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(
            new ApplicationJobInvocationTimeoutError(run.reference, options.wait?.timeout ?? ''),
          ), milliseconds);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const scheduleDefinitionId = `job-start.${kubernetesNameSegment(definition.id)}`;
  const dynamicSchedule = applicationSchedule(
    {
      id: scheduleDefinitionId,
      input: definition.contract.input,
      timezone: 'UTC',
      overlap: 'allow',
      misfires: 'latest',
      maximumLateness: '15m',
      retry: { maxAttempts: 5, maximumAge: '6h' },
      requirements: {
        configuration: 'dynamic',
        cardinality: 'high',
        precision: 'second',
      },
    },
    async (input, context) => {
      const run = await runtime.start(registeredDefinition, input, {
        idempotencyKey: context.occurrenceId,
        admission: context.admission,
      });
      return run.reference;
    },
  ) as ApplicationScheduleHandle<TInput, ApplicationJobReference>;
  const recurringSchedule = (
    id: string,
    input: TInput,
    options: ApplicationJobRecurringScheduleOptions,
  ): ApplicationFixedScheduleHandle<ApplicationJobReference> => {
    const normalized = recurringJobScheduleOptions(id, options);
    const admittedInput = validateMessage(
      definition.contract.input,
      input,
      `${definition.id}.schedule.input`,
    );
    const handle = applicationSchedule(
      {
        id,
        ...normalized,
      },
      async (context) => {
        const run = await runtime.start(registeredDefinition, admittedInput, {
          idempotencyKey: context.occurrenceId,
          admission: context.admission,
        });
        return run.reference;
      },
    ) as ApplicationFixedScheduleHandle<ApplicationJobReference>;
    return applicationJobTargetSchedule(handle, definition, admittedInput);
  };
  function scheduleJob(
    input: TInput,
    options: ApplicationJobOneTimeScheduleOptions,
  ): Promise<ApplicationScheduleConvergenceResult>;
  function scheduleJob(
    id: string,
    input: TInput,
    options: ApplicationJobRecurringScheduleOptions,
  ): ApplicationFixedScheduleHandle<ApplicationJobReference>;
  function scheduleJob(
    inputOrId: TInput | string,
    optionsOrInput: ApplicationJobOneTimeScheduleOptions | TInput,
    recurring?: ApplicationJobRecurringScheduleOptions,
  ): Promise<ApplicationScheduleConvergenceResult> | ApplicationFixedScheduleHandle<ApplicationJobReference> {
    if (typeof inputOrId === 'string') {
      if (!recurring) throw new TypeError(`Recurring Job schedule ${inputOrId} requires timing options.`);
      return recurringSchedule(inputOrId, optionsOrInput as TInput, recurring);
    }
    const options = optionsOrInput as ApplicationJobOneTimeScheduleOptions;
    const at = normalizedJobScheduleInstant(options.at);
    const instanceId = options.id?.trim() || `once.${createHash('sha256')
      .update(canonicalJsonV1String({ job: definition.id, input: inputOrId, at }))
      .digest('hex')
      .slice(0, 24)}`;
    const revision = createHash('sha256')
      .update(canonicalJsonV1String({ input: inputOrId, at, timezone: options.timezone ?? 'UTC' }))
      .digest('hex');
    return dynamicSchedule.schedule({
      id: instanceId,
      revision,
      input: inputOrId,
      at,
      timezone: options.timezone ?? 'UTC',
      deleteAfterCompletion: true,
    });
  }
  return Object.assign(callable, {
    kind: 'applicationJob' as const,
    id: registeredDefinition.id,
    definition: registeredDefinition,
    events,
    start: (input: TInput, options?: Omit<ApplicationJobInvocationOptions, 'wait'>) =>
      runtime.start(registeredDefinition, input, options),
    attach: (reference: ApplicationJobReference) =>
      runtime.attach<TOutput, TProgress, TError>(definition.id, reference),
    schedule: scheduleJob,
    schedules: Object.freeze({
      reconcile(schedule: ApplicationJobDynamicSchedule<TInput>) {
        return dynamicSchedule.schedule({
          ...schedule,
          revision: schedule.revision ?? createHash('sha256')
            .update(canonicalJsonV1String(schedule))
            .digest('hex'),
          deleteAfterCompletion: schedule.at !== undefined,
        });
      },
      remove(id: string) {
        return dynamicSchedule.unschedule(id);
      },
    }),
  });
}

function applicationJobTargetSchedule<
  TInput extends object,
  TOutput extends object,
  TProgress extends object,
  TError extends object,
>(
  handle: ApplicationFixedScheduleHandle<ApplicationJobReference>,
  definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
  input: TInput,
): ApplicationFixedScheduleHandle<ApplicationJobReference> {
  const identity = finiteJobIdentity(definition.id);
  const target = {
    kind: 'durableStart' as const,
    durable: {
      kind: 'job' as const,
      nodeId: `job.${kubernetesNameSegment(definition.id)}`,
    },
    contract: {
      name: identity.name,
      version: identity.version,
      input: declaredSchema(definition.contract.input, `${definition.id}.input`),
    },
    input: { kind: 'literal' as const, value: input },
  };
  return Object.assign(handle, {
    graphNode: Object.freeze({
      ...handle.graphNode,
      handler: undefined,
      target,
    }),
  });
}

function recurringJobScheduleOptions(
  id: string,
  options: ApplicationJobRecurringScheduleOptions,
): {
  readonly cron?: string;
  readonly every?: string;
  readonly timezone: string;
  readonly overlap: 'allow' | 'skip';
  readonly misfires: 'skip' | 'latest' | 'all-bounded';
  readonly maximumLateness: string;
  readonly maximumCatchUp?: number;
  readonly retry: { readonly maxAttempts: number; readonly maximumAge: string };
  readonly requirements: { readonly configuration: 'fixed'; readonly cardinality: 'bounded'; readonly precision: 'minute' | 'second' };
} {
  if (!id.trim()) throw new TypeError('Recurring Job schedule id must be non-empty.');
  const misfire = options.misfire ?? { policy: 'runOnce' as const, grace: '15m' };
  const grace = misfire.grace ?? '15m';
  const timing = 'cron' in options && typeof options.cron === 'string'
    ? { cron: options.cron }
    : { every: options.every };
  return {
    ...timing,
    timezone: options.timezone ?? 'UTC',
    overlap: options.overlap ?? 'skip',
    misfires: misfire.policy === 'skip'
      ? 'skip'
      : misfire.policy === 'catchUp'
        ? 'all-bounded'
        : 'latest',
    maximumLateness: grace,
    ...(misfire.policy === 'catchUp'
      ? { maximumCatchUp: misfire.maximumOccurrences }
      : {}),
    retry: { maxAttempts: 5, maximumAge: '6h' },
    requirements: {
      configuration: 'fixed',
      cardinality: 'bounded',
      precision: options.cron ? 'minute' : 'second',
    },
  };
}

function normalizedJobScheduleInstant(value: string | Date): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Job schedule at must be a valid instant.');
  return instant.toISOString();
}

/** Registers one application-owned finite Job and returns its function-native handle. */
export function registerApplicationJob<
  TInput extends object,
  TOutput extends object,
  TProgress extends object = Record<string, never>,
  TError extends object = never,
>(
  state: ApplicationGraphState,
  id: string,
  contract: ApplicationJobContract<TInput, TOutput, TProgress, TError>,
  options: ApplicationJobOptions<TInput>,
  handler: ApplicationJobHandler<TInput, TOutput, TProgress, TError>,
): ApplicationJobBinding<TInput, TOutput, TProgress, TError> {
  const identity = finiteJobIdentity(id);
  const serialized = serializeApplicationCallback({
    registrar: 'job',
    argumentIndex: 3,
    property: 'handler',
    label: `Application Job ${id}`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const timeoutSeconds = options.timeout
    ? parseApplicationScheduleDuration(options.timeout)
    : undefined;
  const retentionSeconds = Object.fromEntries(
    Object.entries(options.retention ?? {}).map(([name, duration]) => [
      name,
      parseApplicationScheduleDuration(duration),
    ]),
  ) as Partial<Record<'result' | 'progress' | 'applicationFacts' | 'providerAttempts', number>>;
  const nodeId = `job.${kubernetesNameSegment(id)}`;
  const lifecycleEvents = applicationJobLifecycleEvents(id, contract);
  const providerNodeId = applicationProviderGraphNodeId('JobRuntime');
  const selectedRuntime = state.graphNodes.find(
    (node) => node.kind === 'provider' && node.id === providerNodeId,
  );
  const allowLocalFallback = selectedRuntime?.kind === 'provider'
    && selectedRuntime.implementation === 'local-job-runtime';
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: id,
    stability: 'experimental',
    contract: {
      name: identity.name,
      version: identity.version,
      input: declaredSchema(contract.input, `${id}.input`),
      output: declaredSchema(contract.output, `${id}.output`),
      ...(contract.progress ? { progress: declaredSchema(contract.progress, `${id}.progress`) } : {}),
      ...(contract.error ? { error: declaredSchema(contract.error, `${id}.error`) } : {}),
    },
    handlerSource: serialized.source,
    events: Object.fromEntries(Object.entries(lifecycleEvents).map(([name, definition]) => [name, {
      id: definition.id,
      contract: declaredSchema(definition.payload, `${definition.id}.payload`),
    }])) as import('@applik8s/core').ApplicationJobNode['events'],
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { sourceLocation: serialized.location } : {}),
    retry: { maxAttempts: nonNegativeInteger(options.retries ?? 0, `Job ${id} retries`) + 1, wholeAttempt: true },
    ...(timeoutSeconds === undefined ? {} : { executionDeadlineSeconds: timeoutSeconds }),
    idempotency: {
      scope: 'applicationDeploymentContractContextAuthority',
      keySource: options.idempotencyKey ? 'inputExpression' : 'invocation',
      ...(options.idempotencyKey ? { expression: functionExpression(options.idempotencyKey, `${id} idempotency key`) } : {}),
      conflict: 'failClosed',
    },
    cancellation: {
      request: 'durableReceipt',
      terminal: 'firstTransitionWins',
      behavior: 'cooperativeThenProviderBounded',
    },
    retention: {
      source: 'profileWithAuthoredOverrides',
      ...(retentionSeconds.result === undefined ? {} : { resultSeconds: retentionSeconds.result }),
      ...(retentionSeconds.progress === undefined ? {} : { progressSeconds: retentionSeconds.progress }),
      ...(retentionSeconds.applicationFacts === undefined ? {} : { applicationFactsSeconds: retentionSeconds.applicationFacts }),
      ...(retentionSeconds.providerAttempts === undefined ? {} : { providerAttemptsSeconds: retentionSeconds.providerAttempts }),
    },
    runtime: {
      interface: 'JobRuntime',
      selection: 'profile',
      protocol: applicationJobRuntimeProtocol,
    },
  });
  addApplicationGraphEdge(state, {
    from: { nodeId: providerNodeId },
    to: { nodeId },
    relationship: 'provides',
  });
  addApplicationProviderRequirement(state, {
    id: `requirement.${nodeId}.job-runtime`,
    interface: 'JobRuntime',
    consumer: { nodeId },
    provider: { interface: 'JobRuntime', nodeId: providerNodeId },
    required: true,
    purpose: 'finiteExecution',
    diagnostics: {
      missing: `Application Job ${id} requires one JobRuntime provider. Bind JobRuntime.local(), .kubernetes(), or .aws() through the selected application profile.`,
      ambiguous: `Application Job ${id} resolves more than one JobRuntime provider. Bind exactly one implementation in the selected application profile.`,
    },
  });
  const resolvedRuntime: ApplicationJobRuntime = {
    protocol: applicationJobRuntimeProtocol,
    start: (definition, input, invocation) => applicationJobRuntime(
      providerNodeId,
      { allowLocalFallback },
    ).start(definition, input, invocation),
    attach: (job, reference) => applicationJobRuntime(
      providerNodeId,
      { allowLocalFallback },
    ).attach(job, reference),
  };
  return createApplicationJobBinding({ id, contract, options, handler, events: lifecycleEvents }, resolvedRuntime);
}

function localJobAdmission(
  job: string,
  now: () => Date,
): ApplicationAdmissionInvocationContextV1 {
  const admittedAt = now().toISOString();
  const authorityRevision = 'local-job-runtime/v1';
  const trustedContextDigest = digest({});
  const operationId = `applik8s://jobs/${encodeURIComponent(job)}/operations/run`;
  return {
    apiVersion: applicationAdmissionContextVersion,
    principal: {
      id: 'principal:applik8s:local-job-runtime',
      identity: {
        id: 'identity:applik8s:local-job-runtime',
        kind: 'service',
        issuer: 'applik8s://job-runtime',
        subject: 'local',
      },
      kind: 'service',
      authenticationMethod: 'framework',
      audience: [operationId],
      trustedContextDigest,
      catalogRevision: 'local-job-catalog/v1',
      authorityRevision,
      admittedAt,
      expiresAt: new Date(new Date(admittedAt).getTime() + 86_400_000).toISOString(),
    },
    authorityRevision,
    trustedContext: { values: {}, digest: trustedContextDigest },
    operation: { id: operationId, transport: 'framework' },
    correlationId: randomUUID(),
    deadline: new Date(new Date(admittedAt).getTime() + 86_400_000).toISOString(),
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonV1String(value)).digest('hex');
}

function finiteJobIdentity(id: string): { readonly name: string; readonly version: string } {
  const match = /^(.+)\.(v[1-9][0-9]*)$/u.exec(id.trim());
  if (!match?.[1] || !match[2]) {
    throw new TypeError(`Application Job id ${JSON.stringify(id)} must end in a positive version such as search.rebuild.v1.`);
  }
  return { name: match[1], version: match[2] };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer.`);
  return value;
}
