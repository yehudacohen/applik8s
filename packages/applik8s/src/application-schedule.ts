// typecast-file-boundary: Schedule contracts erase user schemas for transport and validate every admission before dispatch.
import { sha256Hex } from '@applik8s/deployment-contract';
import type {
  ApplicationScheduleNode,
  JsonObject,
} from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { serializeApplicationCallback } from './application-callback.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import { runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
import type {
  ApplicationQualifiedProviderToken,
  ApplicationSchedulerProvider,
  ApplicationSchedulerProviderToken,
} from './application-providers.js';
import { Scheduler } from './application-providers.js';
import {
  declaredSchema,
  validateMessage,
} from './application-workflow-serialization.js';

export type ApplicationScheduleOverlapPolicy = 'allow' | 'skip';
export type ApplicationScheduleMisfirePolicy = 'skip' | 'latest' | 'all-bounded';

export interface ApplicationScheduleContext {
  readonly definitionId: string;
  readonly instanceId: string;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly admittedAt: string;
  readonly startedAt: string;
  readonly attempt: number;
  readonly trigger: 'schedule' | 'immediate';
  readonly signal: AbortSignal;
}

export interface ApplicationScheduleRetryPolicy {
  readonly maxAttempts?: number;
  readonly maximumAge?: string;
}

export interface ApplicationScheduleRequirements {
  readonly configuration?: 'fixed' | 'dynamic';
  readonly cardinality?: 'bounded' | 'high';
  readonly precision?: 'minute' | 'second';
}

interface ApplicationScheduleAuthoringMetadata {
  readonly __generatedCalls?: readonly unknown[];
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
  readonly __generatedAwaitedCalls?: Readonly<Record<string, unknown>>;
}

interface ApplicationSchedulePolicy extends ApplicationScheduleAuthoringMetadata {
  readonly timezone?: string;
  readonly overlap?: ApplicationScheduleOverlapPolicy;
  readonly misfires?: ApplicationScheduleMisfirePolicy;
  readonly maxCatchUp?: number;
  readonly retry?: ApplicationScheduleRetryPolicy;
  readonly requirements?: ApplicationScheduleRequirements;
}

export type ApplicationFixedScheduleOptions = ApplicationSchedulePolicy & {
  readonly id: string;
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string | Date;
  readonly input?: never;
  readonly overlapBy?: never;
};

export type ApplicationDynamicScheduleOptions<TInput extends object> =
  ApplicationSchedulePolicy & {
    readonly id: string;
    readonly input: SchemaInput<TInput>;
    readonly overlapBy?: (input: TInput) => string;
    readonly cron?: never;
    readonly every?: never;
    readonly at?: never;
  };

export interface ApplicationScheduleInstance<TInput extends object> {
  readonly id: string;
  readonly revision: string;
  readonly input: TInput;
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string | Date;
  readonly timezone?: string;
  readonly enabled?: boolean;
  readonly deleteAfterCompletion?: boolean;
}

export interface ApplicationScheduleConvergenceResult {
  readonly definitionId: string;
  readonly instanceId: string;
  readonly revision: string;
  readonly state: 'created' | 'updated' | 'unchanged' | 'removed';
}

export interface ApplicationScheduleOccurrenceReceipt<TResult = unknown> {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly scheduledAt: string;
  readonly state: 'succeeded' | 'failed' | 'skipped';
  readonly attempts: number;
  readonly result?: TResult;
  readonly error?: { readonly name: string; readonly message: string };
}

export interface ApplicationScheduleAdmission {
  readonly schemaVersion: 'applik8s.scheduleAdmission/v1alpha1';
  readonly applicationId: string;
  readonly environmentId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly scheduledAt: string;
  readonly admittedAt: string;
  readonly attempt: number;
  readonly input?: object;
  readonly schedulerExecutionId?: string;
  /** Provider lifecycle hint for one-time dynamic schedules. */
  readonly deleteAfterCompletion?: boolean;
  /** Exact provider resource identity used for bounded one-time cleanup. */
  readonly providerResourceName?: string;
}

export interface ApplicationScheduleRuntimeSnapshot {
  readonly schemaVersion: 'applik8s.scheduleRuntime/v1alpha1';
  readonly applicationId: string;
  readonly environmentId: string;
  readonly revision: number;
  readonly instances: readonly ApplicationSchedulePersistedInstance[];
  readonly occurrences: readonly ApplicationSchedulePersistedOccurrence[];
}

export interface ApplicationSchedulePersistedInstance {
  readonly key: string;
  readonly definitionId: string;
  readonly instance: ApplicationScheduleInstance<object>;
  readonly digest: string;
  readonly anchorAt: string;
  readonly lastEvaluatedAt: string;
}

export type ApplicationSchedulePersistedOccurrence =
  | ApplicationScheduleOccurrenceReceipt
  | {
      readonly occurrenceId: string;
      readonly definitionId: string;
      readonly instanceId: string;
      readonly scheduledAt: string;
      readonly state: 'admitted';
      readonly attempts: number;
    };

export interface ApplicationScheduleDefinitionContract<TInput extends object> {
  readonly id: string;
  readonly configuration: 'fixed' | 'dynamic';
  readonly input?: SchemaInput<TInput>;
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string;
  readonly timezone: string;
  readonly overlap: ApplicationScheduleOverlapPolicy;
  readonly overlapBy?: (input: TInput) => string;
  readonly misfires: ApplicationScheduleMisfirePolicy;
  readonly maxCatchUp?: number;
  readonly retry: { readonly maxAttempts: number; readonly maximumAgeSeconds: number };
  readonly requirements: Required<ApplicationScheduleRequirements>;
}

export interface ApplicationScheduleRuntime {
  invoke<TInput extends object, TResult>(options: {
    readonly definition: ApplicationScheduleDefinitionContract<TInput>;
    readonly input: TInput;
    readonly handler: ApplicationScheduleHandler<TInput, TResult>;
  }): Promise<TResult>;
  reconcile<TInput extends object, TResult>(options: {
    readonly definition: ApplicationScheduleDefinitionContract<TInput>;
    readonly instance: ApplicationScheduleInstance<TInput>;
    readonly handler: ApplicationScheduleHandler<TInput, TResult>;
  }): Promise<ApplicationScheduleConvergenceResult>;
  remove(definitionId: string, instanceId: string): Promise<ApplicationScheduleConvergenceResult>;
}

export type ApplicationScheduleHandler<TInput extends object, TResult> = (
  input: TInput,
  context: ApplicationScheduleContext,
) => TResult | Promise<TResult>;

export interface ApplicationScheduleHandle<TInput extends object, TResult> {
  (input: TInput): Promise<TResult>;
  readonly kind: 'applicationSchedule';
  readonly definition: ApplicationScheduleDefinitionContract<TInput>;
  readonly graphNode: ApplicationScheduleNode;
  schedule(instance: ApplicationScheduleInstance<TInput>): Promise<ApplicationScheduleConvergenceResult>;
  unschedule(instanceId: string): Promise<ApplicationScheduleConvergenceResult>;
}

export type ApplicationFixedScheduleHandle<TResult> = Omit<
  ApplicationScheduleHandle<Record<string, never>, TResult>,
  'schedule'
> & {
  (): Promise<TResult>;
  schedule(instance?: never): never;
};

export type ApplicationSchedulerToken =
  | ApplicationSchedulerProviderToken
  | ApplicationQualifiedProviderToken<ApplicationSchedulerProvider>;

export interface ApplicationScheduleRegistrar {
  <TResult>(
    options: ApplicationFixedScheduleOptions,
    handler: (context: ApplicationScheduleContext) => TResult | Promise<TResult>,
  ): ApplicationFixedScheduleHandle<TResult>;
  <TInput extends object, TResult>(
    options: ApplicationDynamicScheduleOptions<TInput>,
    handler: ApplicationScheduleHandler<TInput, TResult>,
  ): ApplicationScheduleHandle<TInput, TResult>;
}

const scheduleRuntimeResolvers: Array<() => ApplicationScheduleRuntime | undefined> = [];

export function installApplicationScheduleRuntimeResolver(
  resolver: () => ApplicationScheduleRuntime | undefined,
): () => void {
  scheduleRuntimeResolvers.push(resolver);
  return () => {
    const index = scheduleRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) scheduleRuntimeResolvers.splice(index, 1);
  };
}

function applicationScheduleRuntime(): ApplicationScheduleRuntime {
  for (let index = scheduleRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = scheduleRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  const injected = Reflect.get(
    globalThis,
    Symbol.for('applik8s.scheduleRuntimeResolver'),
  );
  if (typeof injected === 'function') {
    const runtime = injected();
    if (runtime) return runtime as ApplicationScheduleRuntime;
  }
  throw new Error(
    'No Scheduler runtime is installed for this execution boundary. Compile the application for a qualified target or install a local scheduler resolver.',
  );
}

export function schedule<TResult>(
  options: ApplicationFixedScheduleOptions,
  handler: (context: ApplicationScheduleContext) => TResult | Promise<TResult>,
): ApplicationFixedScheduleHandle<TResult>;
export function schedule<TInput extends object, TResult>(
  options: ApplicationDynamicScheduleOptions<TInput>,
  handler: ApplicationScheduleHandler<TInput, TResult>,
): ApplicationScheduleHandle<TInput, TResult>;
export function schedule<TInput extends object, TResult>(
  options: ApplicationFixedScheduleOptions | ApplicationDynamicScheduleOptions<TInput>,
  handler:
    | ((context: ApplicationScheduleContext) => TResult | Promise<TResult>)
    | ApplicationScheduleHandler<TInput, TResult>,
): ApplicationFixedScheduleHandle<TResult> | ApplicationScheduleHandle<TInput, TResult> {
  return createApplicationSchedule(
    Scheduler,
    options,
    handler,
  );
}

export function createApplicationSchedule<TInput extends object, TResult>(
  scheduler: ApplicationSchedulerToken,
  options: ApplicationFixedScheduleOptions | ApplicationDynamicScheduleOptions<TInput>,
  handler:
    | ((context: ApplicationScheduleContext) => TResult | Promise<TResult>)
    | ApplicationScheduleHandler<TInput, TResult>,
): ApplicationFixedScheduleHandle<TResult> | ApplicationScheduleHandle<TInput, TResult> {
  const normalized = normalizeScheduleDefinition(options);
  const fixed = normalized.configuration === 'fixed';
  const runtimeHandler: ApplicationScheduleHandler<TInput, TResult> = fixed
    ? async (_input, context) => (handler as (context: ApplicationScheduleContext) => TResult | Promise<TResult>)(context)
    : handler as ApplicationScheduleHandler<TInput, TResult>;
  const serialized = serializeApplicationCallback({
    registrar: 'schedule',
    argumentIndex: 1,
    property: 'handler',
    label: `Schedule ${normalized.id}`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const qualification = Reflect.get(scheduler, 'qualification') as
    | { readonly name: string; readonly compatibilityRevision: string }
    | undefined;
  const schedulerNodeId = applicationProviderGraphNodeId(
    'Scheduler',
    qualification,
  );
  const overlapBy = options.overlapBy
    ? serializeApplicationCallback({
        registrar: 'schedule',
        argumentIndex: 0,
        property: 'overlapBy',
        label: `Schedule ${normalized.id} overlap key`,
        callback: options.overlapBy as (...args: never[]) => unknown,
        allowDeferredResolution: true,
      })
    : undefined;
  const graphNode: ApplicationScheduleNode = Object.freeze({
    id: `schedule.${normalized.id}`,
    kind: 'schedule',
    name: normalized.id,
    stability: 'stable',
    definition: {
      id: normalized.id,
      configuration: normalized.configuration,
      ...(normalized.input
        ? { input: declaredSchema(normalized.input, `${normalized.id}.input`) }
        : {}),
      ...(normalized.cron ? { cron: normalized.cron } : {}),
      ...(normalized.every ? { every: normalized.every } : {}),
      ...(normalized.at ? { at: normalized.at } : {}),
      timezone: normalized.timezone,
      overlap: normalized.overlap,
      ...(overlapBy ? { overlapBy } : {}),
      misfires: normalized.misfires,
      ...(normalized.maxCatchUp ? { maxCatchUp: normalized.maxCatchUp } : {}),
      retry: normalized.retry,
      requirements: normalized.requirements,
    },
    scheduler: { interface: 'Scheduler' as const, nodeId: schedulerNodeId },
    handler: serialized,
    functionNative: true,
  });
  const callable = async (input: TInput): Promise<TResult> => {
    const validated = normalized.input
      ? validateMessage(normalized.input, input, `${normalized.id}.input`)
      : {} as TInput;
    return applicationScheduleRuntime().invoke({
      definition: normalized,
      input: validated,
      handler: runtimeHandler,
    });
  };
  return Object.assign(callable, {
    kind: 'applicationSchedule' as const,
    definition: normalized,
    graphNode,
    schedule: async (instance: ApplicationScheduleInstance<TInput>) => {
      if (fixed) {
        throw new Error(`Fixed schedule ${normalized.id} cannot create dynamic instances.`);
      }
      return applicationScheduleRuntime().reconcile({
        definition: normalized,
        instance: normalizeScheduleInstance(normalized, instance),
        handler: runtimeHandler,
      });
    },
    unschedule: (instanceId: string) =>
      applicationScheduleRuntime().remove(normalized.id, nonEmptyId(instanceId, 'schedule instance id')),
    [applicationScheduleHandlerSymbol]: runtimeHandler,
  }) as ApplicationScheduleHandle<TInput, TResult>;
}

function normalizeScheduleDefinition<TInput extends object>(
  options: ApplicationFixedScheduleOptions | ApplicationDynamicScheduleOptions<TInput>,
): ApplicationScheduleDefinitionContract<TInput> {
  const id = nonEmptyId(options.id, 'schedule definition id');
  const configuration = options.input ? 'dynamic' : 'fixed';
  const cadence = normalizeCadence(options);
  if (configuration === 'fixed' && cadence.count !== 1) {
    throw new Error(`Fixed schedule ${id} requires exactly one of cron, every, or at.`);
  }
  if (configuration === 'dynamic' && cadence.count !== 0) {
    throw new Error(`Dynamic schedule ${id} receives cron, every, or at from each instance.`);
  }
  const misfires = options.misfires ?? 'latest';
  const maxCatchUp = options.maxCatchUp;
  if (misfires === 'all-bounded' && (!Number.isSafeInteger(maxCatchUp) || (maxCatchUp ?? 0) < 1)) {
    throw new Error(`Schedule ${id} with all-bounded misfires requires a positive maxCatchUp.`);
  }
  const timezone = options.timezone?.trim() || 'UTC';
  assertTimeZone(timezone);
  const retry = {
    maxAttempts: positiveInteger(options.retry?.maxAttempts ?? 4, `${id} retry.maxAttempts`),
    maximumAgeSeconds: parseDurationSeconds(options.retry?.maximumAge ?? '6h', `${id} retry.maximumAge`),
  };
  return Object.freeze({
    id,
    configuration,
    ...(options.input ? { input: options.input } : {}),
    ...(cadence.cron ? { cron: cadence.cron } : {}),
    ...(cadence.every ? { every: cadence.every } : {}),
    ...(cadence.at ? { at: cadence.at } : {}),
    timezone,
    overlap: options.overlap ?? 'skip',
    ...(options.overlapBy ? { overlapBy: options.overlapBy } : {}),
    misfires,
    ...(maxCatchUp ? { maxCatchUp } : {}),
    retry,
    requirements: {
      configuration: options.requirements?.configuration ?? configuration,
      cardinality: options.requirements?.cardinality ?? (configuration === 'dynamic' ? 'high' : 'bounded'),
      precision: options.requirements?.precision ?? 'minute',
    },
  });
}

function normalizeScheduleInstance<TInput extends object>(
  definition: ApplicationScheduleDefinitionContract<TInput>,
  instance: ApplicationScheduleInstance<TInput>,
): ApplicationScheduleInstance<TInput> {
  const id = nonEmptyId(instance.id, 'schedule instance id');
  const revision = nonEmptyString(instance.revision, `schedule ${id} revision`);
  const cadence = normalizeCadence(instance);
  if (cadence.count !== 1) {
    throw new Error(`Schedule instance ${definition.id}/${id} requires exactly one of cron, every, or at.`);
  }
  const timezone = instance.timezone?.trim() || definition.timezone;
  assertTimeZone(timezone);
  return Object.freeze({
    id,
    revision,
    input: definition.input
      ? validateMessage(definition.input, instance.input, `${definition.id}.input`)
      : instance.input,
    ...(cadence.cron ? { cron: cadence.cron } : {}),
    ...(cadence.every ? { every: cadence.every } : {}),
    ...(cadence.at ? { at: cadence.at } : {}),
    timezone,
    enabled: instance.enabled ?? true,
    ...(instance.deleteAfterCompletion ? { deleteAfterCompletion: true } : {}),
  });
}

function normalizeCadence(value: {
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string | Date;
}): { readonly count: number; readonly cron?: string; readonly every?: string; readonly at?: string } {
  const cron = value.cron?.trim();
  const every = value.every?.trim();
  const at = value.at instanceof Date ? value.at.toISOString() : value.at?.trim();
  if (cron) validateCronExpression(cron);
  if (every) parseDurationSeconds(every, 'schedule every');
  if (at && !Number.isFinite(Date.parse(at))) throw new Error(`Schedule at must be an ISO timestamp; received ${JSON.stringify(at)}.`);
  return {
    count: [cron, every, at].filter(Boolean).length,
    ...(cron ? { cron } : {}),
    ...(every ? { every } : {}),
    ...(at ? { at: new Date(at).toISOString() } : {}),
  };
}

function nonEmptyId(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new Error(`${label} must be a stable lower-case identifier; received ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function nonEmptyString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

export function parseApplicationScheduleDuration(value: string): number {
  return parseDurationSeconds(value, 'schedule duration');
}

function parseDurationSeconds(value: string, label: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new Error(`${label} must use a positive duration such as 30s, 5m, 2h, or 1d.`);
  const amount = Number(match[1]);
  const multiplier = match[2] === 's' ? 1 : match[2] === 'm' ? 60 : match[2] === 'h' ? 3_600 : 86_400;
  return positiveInteger(amount * multiplier, label);
}

function validateCronExpression(value: string): void {
  const fields = value.split(/\s+/u);
  if (fields.length !== 5) throw new Error(`Schedule cron must contain five fields; received ${JSON.stringify(value)}.`);
  if (fields.some((field) => !/^[0-9*/,-]+$/u.test(field))) {
    throw new Error(`Schedule cron contains unsupported syntax: ${JSON.stringify(value)}.`);
  }
}

function assertTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error(`Schedule timezone ${JSON.stringify(value)} is not a valid IANA timezone.`);
  }
}

interface MemoryScheduleInstance {
  readonly key: string;
  readonly definition: ApplicationScheduleDefinitionContract<object>;
  readonly instance: ApplicationScheduleInstance<object>;
  readonly handler: ApplicationScheduleHandler<object, unknown>;
  readonly digest: string;
  readonly anchorAt: string;
  readonly lastEvaluatedAt: string;
}

export interface DeterministicApplicationScheduleRuntime extends ApplicationScheduleRuntime {
  registerFixed<TResult>(
    definition: ApplicationScheduleDefinitionContract<Record<string, never>>,
    handler: ApplicationScheduleHandler<Record<string, never>, TResult>,
  ): Promise<ApplicationScheduleConvergenceResult>;
  tick(now: Date): Promise<readonly ApplicationScheduleOccurrenceReceipt[]>;
  occurrences(): readonly ApplicationScheduleOccurrenceReceipt[];
  instances(): readonly ApplicationScheduleInstance<object>[];
  snapshot(): ApplicationScheduleRuntimeSnapshot;
}

const applicationScheduleHandlerSymbol = Symbol.for('applik8s.applicationSchedule.handler');

/** Provider bootstrap seam for an already admitted occurrence. */
export async function executeApplicationScheduleAdmission<TInput extends object, TResult>(
  handle: ApplicationScheduleHandle<TInput, TResult>,
  admission: ApplicationScheduleAdmission,
  signal: AbortSignal = new AbortController().signal,
): Promise<ApplicationScheduleOccurrenceReceipt<TResult>> {
  if (admission.definitionId !== handle.definition.id) {
    throw new Error(`Schedule admission for ${admission.definitionId} cannot execute ${handle.definition.id}.`);
  }
  if (!Number.isSafeInteger(admission.attempt) || admission.attempt < 1) {
    throw new Error(`Schedule admission ${admission.definitionId}/${admission.instanceId} has an invalid attempt.`);
  }
  const scheduledAt = new Date(admission.scheduledAt);
  const admittedAt = new Date(admission.admittedAt);
  if (!Number.isFinite(scheduledAt.getTime()) || !Number.isFinite(admittedAt.getTime())) {
    throw new Error(`Schedule admission ${admission.definitionId}/${admission.instanceId} has an invalid timestamp.`);
  }
  const input: TInput = handle.definition.input
    ? validateMessage(handle.definition.input, admission.input ?? {}, `${handle.definition.id}.input`)
    : {} as TInput;
  const handler = Reflect.get(handle, applicationScheduleHandlerSymbol);
  if (typeof handler !== 'function') throw new Error(`Schedule ${handle.definition.id} has no framework runtime handler.`);
  const occurrenceId = applicationScheduleOccurrenceId({
    applicationId: admission.applicationId,
    environmentId: admission.environmentId,
    definitionId: admission.definitionId,
    instanceId: admission.instanceId,
    scheduledAt: scheduledAt.toISOString(),
    ...(admission.schedulerExecutionId ? { schedulerExecutionId: admission.schedulerExecutionId } : {}),
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await runApplicationTelemetryBoundary({
      kind: 'schedule',
      identity: admission.definitionId,
      attempt: admission.attempt,
      attributes: {
        'applik8s.schedule.trigger': 'schedule',
        'applik8s.schedule.occurrence_id': occurrenceId,
      },
    }, async () => (handler as ApplicationScheduleHandler<TInput, TResult>)(input, {
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      occurrenceId,
      scheduledAt: scheduledAt.toISOString(),
      admittedAt: admittedAt.toISOString(),
      startedAt,
      attempt: admission.attempt,
      trigger: 'schedule',
      signal,
    }));
    return {
      occurrenceId,
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      scheduledAt: scheduledAt.toISOString(),
      state: 'succeeded',
      attempts: admission.attempt,
      result,
    };
  } catch (error) {
    return {
      occurrenceId,
      definitionId: admission.definitionId,
      instanceId: admission.instanceId,
      scheduledAt: scheduledAt.toISOString(),
      state: 'failed',
      attempts: admission.attempt,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Framework bootstrap seam. Application code should export the fixed schedule handle. */
export function registerFixedApplicationSchedule<TResult>(
  runtime: DeterministicApplicationScheduleRuntime,
  handle: ApplicationFixedScheduleHandle<TResult>,
): Promise<ApplicationScheduleConvergenceResult> {
  const handler = Reflect.get(handle, applicationScheduleHandlerSymbol);
  if (typeof handler !== 'function') throw new Error(`Schedule ${handle.definition.id} has no framework runtime handler.`);
  return runtime.registerFixed(handle.definition, handler as ApplicationScheduleHandler<Record<string, never>, TResult>);
}

export function createDeterministicApplicationScheduleRuntime(options: {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly now?: () => Date;
  readonly snapshot?: ApplicationScheduleRuntimeSnapshot;
  readonly persist?: (snapshot: ApplicationScheduleRuntimeSnapshot) => void | Promise<void>;
}): DeterministicApplicationScheduleRuntime {
  const now = options.now ?? (() => new Date());
  if (options.snapshot && (options.snapshot.applicationId !== options.applicationId || options.snapshot.environmentId !== options.environmentId)) {
    throw new Error('Schedule runtime snapshot belongs to a different application or environment.');
  }
  let revision = options.snapshot?.revision ?? 0;
  const restoredInstances = new Map((options.snapshot?.instances ?? []).map((entry) => [entry.key, entry]));
  const instances = new Map<string, MemoryScheduleInstance>();
  const occurrences = new Map<string, ApplicationSchedulePersistedOccurrence>(
    (options.snapshot?.occurrences ?? []).map((entry) => [entry.occurrenceId, entry]),
  );
  const inFlight = new Set<string>();

  const snapshot = (): ApplicationScheduleRuntimeSnapshot => ({
    schemaVersion: 'applik8s.scheduleRuntime/v1alpha1',
    applicationId: options.applicationId,
    environmentId: options.environmentId,
    revision,
    instances: [...instances.values()].map(({ key, definition, instance, digest, anchorAt, lastEvaluatedAt }) => ({
      key,
      definitionId: definition.id,
      instance,
      digest,
      anchorAt,
      lastEvaluatedAt,
    })).sort((left, right) => left.key.localeCompare(right.key)),
    occurrences: [...occurrences.values()].sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId)),
  });
  const persist = async (): Promise<void> => {
    revision += 1;
    await options.persist?.(snapshot());
  };

  const invoke = async <TInput extends object, TResult>(request: {
    readonly definition: ApplicationScheduleDefinitionContract<TInput>;
    readonly input: TInput;
    readonly handler: ApplicationScheduleHandler<TInput, TResult>;
  }): Promise<TResult> => {
    const admitted = now();
    const occurrenceId = applicationScheduleOccurrenceId({
      applicationId: options.applicationId,
      environmentId: options.environmentId,
      definitionId: request.definition.id,
      instanceId: 'immediate',
      scheduledAt: admitted.toISOString(),
    });
    const signal = new AbortController().signal;
    return runApplicationTelemetryBoundary({ kind: 'schedule', identity: request.definition.id, attempt: 1, attributes: { 'applik8s.schedule.trigger': 'immediate' } }, async () => request.handler(request.input, {
      definitionId: request.definition.id,
      instanceId: 'immediate',
      occurrenceId,
      scheduledAt: admitted.toISOString(),
      admittedAt: admitted.toISOString(),
      startedAt: admitted.toISOString(),
      attempt: 1,
      trigger: 'immediate',
      signal,
    }));
  };

  return {
    invoke,
    async reconcile(request) {
      const key = `${request.definition.id}:${request.instance.id}`;
      const digest = stableDigest({
        definition: request.definition.id,
        instance: request.instance as unknown as JsonObject,
      });
      const existing = instances.get(key);
      const restored = restoredInstances.get(key);
      const previous = existing ?? (restored && restored.definitionId === request.definition.id
        ? {
            ...restored,
            definition: request.definition as unknown as ApplicationScheduleDefinitionContract<object>,
            handler: request.handler as ApplicationScheduleHandler<object, unknown>,
          }
        : undefined);
      if (previous?.instance.revision === request.instance.revision) {
        if (previous.digest !== digest) {
          throw new Error(`Schedule ${key} revision ${request.instance.revision} conflicts with different desired state.`);
        }
        if (!existing) instances.set(key, previous);
        restoredInstances.delete(key);
        return {
          definitionId: request.definition.id,
          instanceId: request.instance.id,
          revision: request.instance.revision,
          state: 'unchanged',
        };
      }
      if (previous && compareRevision(request.instance.revision, previous.instance.revision) < 0) {
        throw new Error(`Schedule ${key} revision ${request.instance.revision} is stale; current revision is ${previous.instance.revision}.`);
      }
      const reconciledAt = now().toISOString();
      instances.set(key, {
        key,
        definition: request.definition as unknown as ApplicationScheduleDefinitionContract<object>,
        instance: request.instance as ApplicationScheduleInstance<object>,
        handler: request.handler as ApplicationScheduleHandler<object, unknown>,
        digest,
        anchorAt: previous?.anchorAt ?? reconciledAt,
        lastEvaluatedAt: previous?.lastEvaluatedAt ?? reconciledAt,
      });
      restoredInstances.delete(key);
      await persist();
      return {
        definitionId: request.definition.id,
        instanceId: request.instance.id,
        revision: request.instance.revision,
        state: previous ? 'updated' : 'created',
      };
    },
    async remove(definitionId, instanceId) {
      const key = `${definitionId}:${instanceId}`;
      const existing = instances.get(key);
      const restored = restoredInstances.get(key);
      instances.delete(key);
      restoredInstances.delete(key);
      if (existing || restored) await persist();
      return {
        definitionId,
        instanceId,
        revision: existing?.instance.revision ?? restored?.instance.revision ?? 'absent',
        state: existing || restored ? 'removed' : 'unchanged',
      };
    },
    async registerFixed(definition, handler) {
      if (definition.configuration !== 'fixed') throw new Error(`Schedule ${definition.id} is not fixed.`);
      return this.reconcile({
        definition,
        instance: {
          id: 'fixed',
          revision: stableDigest({ id: definition.id, cron: definition.cron, every: definition.every, at: definition.at, timezone: definition.timezone }),
          input: {},
          ...(definition.cron ? { cron: definition.cron } : {}),
          ...(definition.every ? { every: definition.every } : {}),
          ...(definition.at ? { at: definition.at, deleteAfterCompletion: true } : {}),
          timezone: definition.timezone,
          enabled: true,
        },
        handler,
      });
    },
    async tick(at) {
      const emitted: ApplicationScheduleOccurrenceReceipt[] = [];
      for (const [key, current] of [...instances.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        if (current.instance.enabled === false) {
          instances.set(key, { ...current, lastEvaluatedAt: at.toISOString() });
          continue;
        }
        const admitted = [...occurrences.values()]
          .filter((entry) => entry.state === 'admitted'
            && entry.definitionId === current.definition.id
            && entry.instanceId === current.instance.id)
          .map(({ scheduledAt }) => new Date(scheduledAt));
        const due = uniqueScheduleTimes([...dueApplicationScheduleTimes(current, at), ...admitted]);
        const selected = current.definition.misfires === 'skip'
          ? due.slice(-1).filter((scheduledAt) => scheduledAt.getTime() === at.getTime())
          : current.definition.misfires === 'latest'
            ? due.slice(-1)
            : due.slice(0, current.definition.maxCatchUp ?? 1);
        for (const scheduledAt of selected) {
          const occurrenceId = applicationScheduleOccurrenceId({
            applicationId: options.applicationId,
            environmentId: options.environmentId,
            definitionId: current.definition.id,
            instanceId: current.instance.id,
            scheduledAt: scheduledAt.toISOString(),
          });
          const prior = occurrences.get(occurrenceId);
          if (prior && prior.state !== 'admitted') {
            emitted.push(prior);
            continue;
          }
          const overlapKey = current.definition.overlapBy
            ? current.definition.overlapBy(current.instance.input)
            : current.instance.id;
          const leaseKey = `${current.definition.id}:${overlapKey}`;
          if (current.definition.overlap === 'skip' && inFlight.has(leaseKey)) {
            const receipt: ApplicationScheduleOccurrenceReceipt = {
              occurrenceId,
              definitionId: current.definition.id,
              instanceId: current.instance.id,
              scheduledAt: scheduledAt.toISOString(),
              state: 'skipped',
              attempts: 0,
            };
            occurrences.set(occurrenceId, receipt);
            emitted.push(receipt);
            continue;
          }
          inFlight.add(leaseKey);
          occurrences.set(occurrenceId, {
            occurrenceId,
            definitionId: current.definition.id,
            instanceId: current.instance.id,
            scheduledAt: scheduledAt.toISOString(),
            state: 'admitted',
            attempts: prior?.attempts ?? 0,
          });
          await persist();
          const receipt = await executeMemoryOccurrence(current, occurrenceId, scheduledAt, now);
          inFlight.delete(leaseKey);
          occurrences.set(occurrenceId, receipt);
          await persist();
          emitted.push(receipt);
          if (current.instance.deleteAfterCompletion && current.instance.at) instances.delete(key);
        }
        if (instances.has(key)) {
          instances.set(key, { ...current, lastEvaluatedAt: at.toISOString() });
          await persist();
        }
      }
      return emitted;
    },
    occurrences: () => [...occurrences.values()].filter((entry): entry is ApplicationScheduleOccurrenceReceipt => entry.state !== 'admitted').sort((left, right) => left.occurrenceId.localeCompare(right.occurrenceId)),
    instances: () => [
      ...[...instances.values()].map((entry) => entry.instance),
      ...[...restoredInstances.values()].map((entry) => entry.instance),
    ],
    snapshot,
  };
}

async function executeMemoryOccurrence(
  current: MemoryScheduleInstance,
  occurrenceId: string,
  scheduledAt: Date,
  now: () => Date,
): Promise<ApplicationScheduleOccurrenceReceipt> {
  let attempts = 0;
  let failure: unknown;
  while (attempts < current.definition.retry.maxAttempts) {
    attempts += 1;
    try {
      const startedAt = now().toISOString();
      const result = await runApplicationTelemetryBoundary({ kind: 'schedule', identity: current.definition.id, attempt: attempts, attributes: { 'applik8s.schedule.trigger': 'schedule' } }, async () => current.handler(current.instance.input, {
        definitionId: current.definition.id,
        instanceId: current.instance.id,
        occurrenceId,
        scheduledAt: scheduledAt.toISOString(),
        admittedAt: startedAt,
        startedAt,
        attempt: attempts,
        trigger: 'schedule',
        signal: new AbortController().signal,
      }));
      return {
        occurrenceId,
        definitionId: current.definition.id,
        instanceId: current.instance.id,
        scheduledAt: scheduledAt.toISOString(),
        state: 'succeeded',
        attempts,
        result,
      };
    } catch (error) {
      failure = error;
      if ((now().getTime() - scheduledAt.getTime()) / 1_000 >= current.definition.retry.maximumAgeSeconds) break;
    }
  }
  return {
    occurrenceId,
    definitionId: current.definition.id,
    instanceId: current.instance.id,
    scheduledAt: scheduledAt.toISOString(),
    state: 'failed',
    attempts,
    error: {
      name: failure instanceof Error ? failure.name : 'Error',
      message: failure instanceof Error ? failure.message : String(failure),
    },
  };
}

function dueApplicationScheduleTimes(current: MemoryScheduleInstance, now: Date): readonly Date[] {
  const from = new Date(current.lastEvaluatedAt);
  if (current.instance.at) {
    const at = new Date(current.instance.at);
    return at > from && at <= now ? [at] : [];
  }
  if (current.instance.every) {
    const intervalMs = parseDurationSeconds(current.instance.every, 'schedule every') * 1_000;
    const values: Date[] = [];
    const anchor = new Date(current.anchorAt).getTime();
    const firstIndex = Math.max(1, Math.floor((from.getTime() - anchor) / intervalMs) + 1);
    for (let candidate = anchor + firstIndex * intervalMs; candidate <= now.getTime() && values.length < 10_000; candidate += intervalMs) {
      values.push(new Date(candidate));
    }
    return values;
  }
  if (!current.instance.cron) return [];
  const values: Date[] = [];
  const candidate = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  while (candidate <= now && values.length < 10_000) {
    if (cronMatches(current.instance.cron, candidate, current.instance.timezone ?? current.definition.timezone)) {
      values.push(new Date(candidate));
    }
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return values;
}

function uniqueScheduleTimes(values: readonly Date[]): readonly Date[] {
  return [...new Map(values.map((value) => [value.toISOString(), value])).values()]
    .sort((left, right) => left.getTime() - right.getTime());
}

function cronMatches(expression: string, instant: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  const fields = expression.split(/\s+/u);
  return matchesCronField(fields[0] ?? '*', Number(value('minute')), 0, 59)
    && matchesCronField(fields[1] ?? '*', Number(value('hour')), 0, 23)
    && matchesCronField(fields[2] ?? '*', Number(value('day')), 1, 31)
    && matchesCronField(fields[3] ?? '*', Number(value('month')), 1, 12)
    && matchesCronField(fields[4] ?? '*', weekday, 0, 6);
}

function matchesCronField(field: string, value: number, minimum: number, maximum: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepValue] = part.split('/');
    const step = stepValue ? Number(stepValue) : 1;
    if (!Number.isSafeInteger(step) || step < 1) return false;
    const [startValue, endValue] = range === '*'
      ? [minimum, maximum]
      : range?.includes('-')
        ? range.split('-').map(Number)
        : [Number(range), Number(range)];
    if (!Number.isSafeInteger(startValue) || !Number.isSafeInteger(endValue)) return false;
    return value >= (startValue ?? minimum)
      && value <= (endValue ?? maximum)
      && (value - (startValue ?? minimum)) % step === 0;
  });
}

export function applicationScheduleOccurrenceId(options: {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly definitionId: string;
  readonly instanceId: string;
  readonly scheduledAt: string;
  /** Stable provider-native execution identity. Preferred when supplied. */
  readonly schedulerExecutionId?: string;
}): string {
  const execution = options.schedulerExecutionId?.trim() || options.scheduledAt;
  return `occ_${sha256Hex(`${options.applicationId}\0${options.environmentId}\0${options.definitionId}\0${options.instanceId}\0${execution}`)}`;
}

function compareRevision(left: string, right: string): number {
  if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
  return left.localeCompare(right);
}

function stableDigest(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}
