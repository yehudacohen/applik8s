// typecast-file-boundary: provider-neutral lifecycle records validate their schema and fence before recovering declaration-time identity, value, and status generics.
import { createHash, randomUUID } from 'node:crypto';
import type { JsonValue } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk';
import {
  type ApplicationManagedModelCondition,
  type ApplicationManagedModelConditionInput,
  type ApplicationManagedModelHandler,
  type ApplicationManagedModelMetadata,
  type ApplicationManagedModelObject,
  type ApplicationManagedModelReconcileContext,
  type ApplicationManagedModelRequeue,
  type ApplicationManagedModelWriteReceipt,
  applicationManagedModelProtocol,
  managedModelDurationSeconds,
} from './application-managed-models.js';

export interface ApplicationManagedModelStoreRecord<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly model: string;
  readonly id: TIdentity;
  readonly value: Readonly<TValue>;
  readonly metadata: ApplicationManagedModelMetadata;
  readonly status: Readonly<TStatus>;
  readonly conditions: readonly ApplicationManagedModelCondition[];
  readonly nextDueAt?: string;
  readonly invalidated: boolean;
}

export interface ApplicationManagedModelLease<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly reconcileId: string;
  readonly fence: string;
  readonly attempt: number;
  readonly expiresAt: string;
  readonly record: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>;
}

export interface ApplicationManagedModelCommitPrecondition<TIdentity> {
  readonly model: string;
  readonly id: TIdentity;
  readonly uid: string;
  readonly generation: number;
  readonly resourceVersion: string;
  readonly fence: string;
}

export interface ApplicationManagedModelStore<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  claimNext(options: {
    readonly model: string;
    readonly now: string;
    readonly leaseDurationSeconds: number;
  }): Promise<ApplicationManagedModelLease<TIdentity, TValue, TStatus> | undefined>;
  writeStatus(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    status: TStatus,
    now: string,
  ): Promise<{ readonly receipt: ApplicationManagedModelWriteReceipt; readonly record: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus> }>;
  writeCondition(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    condition: ApplicationManagedModelConditionInput | { readonly remove: string },
    now: string,
  ): Promise<{ readonly receipt: ApplicationManagedModelWriteReceipt; readonly record: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus> }>;
  ensureFinalizers(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    finalizers: readonly string[],
    now: string,
  ): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>>;
  removeFinalizer(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    finalizer: string,
    now: string,
  ): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>>;
  complete(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    options: { readonly now: string; readonly nextDueAt?: string },
  ): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>>;
  release(
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    options: { readonly now: string; readonly retryAt?: string; readonly error?: string },
  ): Promise<void>;
}

export interface ApplicationManagedModelRuntimeBinding<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly model: string;
  readonly status: SchemaInput<TStatus>;
  readonly leaseDurationSeconds: number;
  readonly conditionTypes: readonly string[];
  readonly reconcile?: ApplicationManagedModelHandler<TIdentity, TValue, TStatus>;
  readonly finalizers: readonly {
    readonly name: string;
    readonly conditionTypes: readonly string[];
    readonly handler: ApplicationManagedModelHandler<TIdentity, TValue, TStatus>;
  }[];
}

export interface RunApplicationManagedModelOptions<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly store: ApplicationManagedModelStore<TIdentity, TValue, TStatus>;
  readonly binding: ApplicationManagedModelRuntimeBinding<TIdentity, TValue, TStatus>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  readonly causalPrincipalId?: string;
  readonly trustedContext?: Readonly<Record<string, JsonValue>>;
  readonly failureRetry?: string;
}

export interface ApplicationManagedModelRunResult<TIdentity> {
  readonly kind: 'idle' | 'reconciled' | 'finalized' | 'failed';
  readonly id?: TIdentity;
  readonly reconcileId?: string;
  readonly generation?: number;
  readonly nextDueAt?: string;
  readonly error?: string;
}

export class ApplicationManagedModelConflictError extends Error {
  readonly code = 'MANAGED_MODEL_FENCE_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationManagedModelConflictError';
  }
}

export async function runApplicationManagedModelOnce<
  TIdentity,
  TValue extends object,
  TStatus extends object,
>(
  options: RunApplicationManagedModelOptions<TIdentity, TValue, TStatus>,
): Promise<ApplicationManagedModelRunResult<TIdentity>> {
  const now = options.now ?? (() => new Date());
  const claimedAt = now().toISOString();
  const lease = await options.store.claimNext({
    model: options.binding.model,
    now: claimedAt,
    leaseDurationSeconds: options.binding.leaseDurationSeconds,
  });
  if (!lease) return { kind: 'idle' };
  let record = lease.record;
  let precondition = applicationManagedModelPrecondition(lease, record);
  const abort = options.signal ?? new AbortController().signal;
  let requestedRequeue: ApplicationManagedModelRequeue | undefined;
  const context: ApplicationManagedModelReconcileContext = Object.freeze({
    protocol: applicationManagedModelProtocol,
    reconcileId: lease.reconcileId,
    fence: lease.fence,
    attempt: lease.attempt,
    signal: abort,
    ...(options.causalPrincipalId ? { causalPrincipalId: options.causalPrincipalId } : {}),
    trustedContext: options.trustedContext ?? {},
    requeueAfter(duration: string) {
      const next = Object.freeze({
        kind: 'managedModelRequeue' as const,
        afterSeconds: managedModelDurationSeconds(duration, 'context.requeueAfter'),
      });
      requestedRequeue = next;
      return next;
    },
    throwIfCancelled() {
      abort.throwIfAborted();
    },
  });

  try {
    context.throwIfCancelled();
    if (!record.metadata.deletionTimestamp && options.binding.finalizers.length > 0) {
      record = await options.store.ensureFinalizers(
        precondition,
        options.binding.finalizers.map((entry) => entry.name),
        now().toISOString(),
      );
      precondition = applicationManagedModelPrecondition(lease, record);
    }
    const deleting = Boolean(record.metadata.deletionTimestamp);
    if (deleting) {
      for (const finalizer of options.binding.finalizers) {
        if (!record.metadata.finalizers.includes(finalizer.name)) continue;
        const invoked = applicationManagedModelInvocation(
          options.store,
          lease,
          record,
          options.binding.status,
          finalizer.conditionTypes,
          now,
        );
        const result = await finalizer.handler(invoked.object, context);
        record = invoked.current();
        precondition = applicationManagedModelPrecondition(lease, record);
        const requeue = result?.kind === 'managedModelRequeue' ? result : requestedRequeue;
        if (requeue) {
          const nextDueAt = new Date(now().getTime() + requeue.afterSeconds * 1_000).toISOString();
          await options.store.complete(precondition, { now: now().toISOString(), nextDueAt });
          return { kind: 'finalized', id: record.id, reconcileId: lease.reconcileId, generation: record.metadata.generation, nextDueAt };
        }
        record = await options.store.removeFinalizer(precondition, finalizer.name, now().toISOString());
        precondition = applicationManagedModelPrecondition(lease, record);
      }
      await options.store.complete(precondition, { now: now().toISOString() });
      return { kind: 'finalized', id: record.id, reconcileId: lease.reconcileId, generation: record.metadata.generation };
    }
    if (!options.binding.reconcile) {
      await options.store.complete(precondition, { now: now().toISOString() });
      return { kind: 'reconciled', id: record.id, reconcileId: lease.reconcileId, generation: record.metadata.generation };
    }
    const invoked = applicationManagedModelInvocation(
      options.store,
      lease,
      record,
      options.binding.status,
      options.binding.conditionTypes,
      now,
    );
    const result = await options.binding.reconcile(invoked.object, context);
    record = invoked.current();
    precondition = applicationManagedModelPrecondition(lease, record);
    const requeue = result?.kind === 'managedModelRequeue' ? result : requestedRequeue;
    const nextDueAt = requeue
      ? new Date(now().getTime() + requeue.afterSeconds * 1_000).toISOString()
      : undefined;
    await options.store.complete(precondition, {
      now: now().toISOString(),
      ...(nextDueAt ? { nextDueAt } : {}),
    });
    return {
      kind: 'reconciled',
      id: record.id,
      reconcileId: lease.reconcileId,
      generation: record.metadata.generation,
      ...(nextDueAt ? { nextDueAt } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retrySeconds = managedModelDurationSeconds(options.failureRetry ?? '30s', 'failureRetry');
    await options.store.release(precondition, {
      now: now().toISOString(),
      retryAt: new Date(now().getTime() + retrySeconds * 1_000).toISOString(),
      error: message,
    });
    return {
      kind: 'failed',
      id: record.id,
      reconcileId: lease.reconcileId,
      generation: record.metadata.generation,
      error: message,
    };
  }
}

function applicationManagedModelInvocation<TIdentity, TValue extends object, TStatus extends object>(
  store: ApplicationManagedModelStore<TIdentity, TValue, TStatus>,
  lease: ApplicationManagedModelLease<TIdentity, TValue, TStatus>,
  initial: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>,
  schema: SchemaInput<TStatus>,
  conditionTypes: readonly string[],
  now: () => Date,
): {
  readonly object: ApplicationManagedModelObject<TIdentity, TValue, TStatus>;
  current(): ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>;
} {
  let record = initial;
  const object: ApplicationManagedModelObject<TIdentity, TValue, TStatus> = {
    id: initial.id,
    value: initial.value,
    metadata: initial.metadata,
    status: {
      get current() { return record.status; },
      async update(next) {
        const validated = normalizeSchema(schema, `${initial.model}.managed.status`).validate(next as JsonValue);
        if (!validated.ok) throw new Error(`Managed model ${initial.model} status is invalid: ${validated.error.message}`);
        const committed = await store.writeStatus(
          applicationManagedModelPrecondition(lease, record),
          validated.value,
          now().toISOString(),
        );
        record = committed.record;
        return committed.receipt;
      },
    },
    conditions: {
      get current() { return record.conditions; },
      async set(next) {
        if (!conditionTypes.includes(next.type)) {
          throw new Error(`Managed model ${initial.model} handler does not own condition ${next.type}.`);
        }
        const committed = await store.writeCondition(
          applicationManagedModelPrecondition(lease, record),
          next,
          now().toISOString(),
        );
        record = committed.record;
        return committed.receipt;
      },
      async remove(type) {
        if (!conditionTypes.includes(type)) {
          throw new Error(`Managed model ${initial.model} handler does not own condition ${type}.`);
        }
        const committed = await store.writeCondition(
          applicationManagedModelPrecondition(lease, record),
          { remove: type },
          now().toISOString(),
        );
        record = committed.record;
        return committed.receipt;
      },
    },
  };
  return { object, current: () => record };
}

function applicationManagedModelPrecondition<TIdentity, TValue extends object, TStatus extends object>(
  lease: ApplicationManagedModelLease<TIdentity, TValue, TStatus>,
  record: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>,
): ApplicationManagedModelCommitPrecondition<TIdentity> {
  return {
    model: record.model,
    id: record.id,
    uid: record.metadata.uid,
    generation: record.metadata.generation,
    resourceVersion: record.metadata.resourceVersion,
    fence: lease.fence,
  };
}

interface MemoryManagedModelRecord<TIdentity, TValue extends object, TStatus extends object> {
  model: string;
  id: TIdentity;
  value: TValue;
  metadata: ApplicationManagedModelMetadata;
  status: TStatus;
  conditions: ApplicationManagedModelCondition[];
  nextDueAt?: string;
  invalidated: boolean;
  lease?: { fence: string; expiresAt: string; reconcileId: string; attempt: number };
  fenceCounter: number;
  lastError?: string;
}

export interface DeterministicApplicationManagedModelStore<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> extends ApplicationManagedModelStore<TIdentity, TValue, TStatus> {
  putDesired(model: string, id: TIdentity, value: TValue, initialStatus: TStatus, now?: string): void;
  deleteDesired(model: string, id: TIdentity, now?: string): void;
  invalidate(model: string, id: TIdentity): void;
  inspect(model: string, id: TIdentity): ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus> | undefined;
}

export function createDeterministicApplicationManagedModelStore<
  TIdentity,
  TValue extends object,
  TStatus extends object,
>(): DeterministicApplicationManagedModelStore<TIdentity, TValue, TStatus> {
  const records = new Map<string, MemoryManagedModelRecord<TIdentity, TValue, TStatus>>();
  const key = (model: string, id: TIdentity) => `${model}:${canonicalManagedValue(id)}`;
  const view = (record: MemoryManagedModelRecord<TIdentity, TValue, TStatus>) => structuredClone({
    model: record.model,
    id: record.id,
    value: record.value,
    metadata: record.metadata,
    status: record.status,
    conditions: record.conditions,
    ...(record.nextDueAt ? { nextDueAt: record.nextDueAt } : {}),
    invalidated: record.invalidated,
  }) as ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>;
  const requireRecord = (model: string, id: TIdentity) => {
    const record = records.get(key(model, id));
    if (!record) throw new ApplicationManagedModelConflictError(`Managed model ${model}/${canonicalManagedValue(id)} no longer exists.`);
    return record;
  };
  const assertFence = (precondition: ApplicationManagedModelCommitPrecondition<TIdentity>) => {
    const record = requireRecord(precondition.model, precondition.id);
    if (
      record.metadata.uid !== precondition.uid
      || record.metadata.generation !== precondition.generation
      || record.metadata.resourceVersion !== precondition.resourceVersion
      || record.lease?.fence !== precondition.fence
    ) {
      throw new ApplicationManagedModelConflictError(`Managed model ${precondition.model}/${canonicalManagedValue(precondition.id)} rejected a stale generation, resource version, or fence.`);
    }
    return record;
  };
  const incrementVersion = (record: MemoryManagedModelRecord<TIdentity, TValue, TStatus>) => {
    record.metadata = { ...record.metadata, resourceVersion: String(Number(record.metadata.resourceVersion) + 1) };
  };
  const receipt = (record: MemoryManagedModelRecord<TIdentity, TValue, TStatus>, now: string): ApplicationManagedModelWriteReceipt => ({
    protocol: applicationManagedModelProtocol,
    uid: record.metadata.uid,
    generation: record.metadata.generation,
    resourceVersion: record.metadata.resourceVersion,
    fence: record.lease?.fence ?? '',
    committedAt: now,
  });
  return {
    putDesired(model, id, value, initialStatus, now = new Date().toISOString()) {
      const existing = records.get(key(model, id));
      if (!existing) {
        records.set(key(model, id), {
          model,
          id: structuredClone(id),
          value: structuredClone(value),
          status: structuredClone(initialStatus),
          conditions: [],
          metadata: {
            uid: randomUUID(),
            generation: 1,
            resourceVersion: '1',
            createdAt: now,
            finalizers: [],
          },
          invalidated: true,
          fenceCounter: 0,
        });
        return;
      }
      if (canonicalManagedValue(existing.value) === canonicalManagedValue(value)) return;
      existing.value = structuredClone(value);
      existing.metadata = {
        ...existing.metadata,
        generation: existing.metadata.generation + 1,
      };
      incrementVersion(existing);
      existing.invalidated = true;
    },
    deleteDesired(model, id, now = new Date().toISOString()) {
      const record = requireRecord(model, id);
      if (!record.metadata.deletionTimestamp) {
        record.metadata = { ...record.metadata, deletionTimestamp: now };
        incrementVersion(record);
      }
      record.invalidated = true;
    },
    invalidate(model, id) {
      requireRecord(model, id).invalidated = true;
    },
    inspect(model, id) {
      const record = records.get(key(model, id));
      return record ? view(record) : undefined;
    },
    async claimNext({ model, now, leaseDurationSeconds }) {
      const nowMs = Date.parse(now);
      const candidate = [...records.values()]
        .filter((record) => record.model === model)
        .filter((record) => !record.lease || Date.parse(record.lease.expiresAt) <= nowMs)
        .filter((record) => record.invalidated || (record.nextDueAt !== undefined && Date.parse(record.nextDueAt) <= nowMs))
        .sort((left, right) => canonicalManagedValue(left.id).localeCompare(canonicalManagedValue(right.id)))[0];
      if (!candidate) return undefined;
      candidate.fenceCounter += 1;
      const lease = {
        fence: String(candidate.fenceCounter),
        reconcileId: randomUUID(),
        attempt: (candidate.lease?.attempt ?? 0) + 1,
        expiresAt: new Date(nowMs + leaseDurationSeconds * 1_000).toISOString(),
      };
      candidate.lease = lease;
      return { ...lease, record: view(candidate) };
    },
    async writeStatus(precondition, status, now) {
      const record = assertFence(precondition);
      record.status = structuredClone(status);
      incrementVersion(record);
      return { receipt: receipt(record, now), record: view(record) };
    },
    async writeCondition(precondition, condition, now) {
      const record = assertFence(precondition);
      if ('remove' in condition) {
        record.conditions = record.conditions.filter((entry) => entry.type !== condition.remove);
      } else {
        const previous = record.conditions.find((entry) => entry.type === condition.type);
        const unchanged = previous
          && previous.status === condition.status
          && previous.reason === condition.reason
          && previous.message === condition.message;
        const next: ApplicationManagedModelCondition = {
          ...condition,
          observedGeneration: record.metadata.generation,
          lastTransitionTime: unchanged ? previous.lastTransitionTime : now,
        };
        record.conditions = [...record.conditions.filter((entry) => entry.type !== condition.type), next]
          .sort((left, right) => left.type.localeCompare(right.type));
      }
      incrementVersion(record);
      return { receipt: receipt(record, now), record: view(record) };
    },
    async ensureFinalizers(precondition, finalizers) {
      const record = assertFence(precondition);
      const next = [...new Set([...record.metadata.finalizers, ...finalizers])].sort();
      if (canonicalManagedValue(next) !== canonicalManagedValue(record.metadata.finalizers)) {
        record.metadata = { ...record.metadata, finalizers: next };
        incrementVersion(record);
      }
      return view(record);
    },
    async removeFinalizer(precondition, finalizer) {
      const record = assertFence(precondition);
      record.metadata = {
        ...record.metadata,
        finalizers: record.metadata.finalizers.filter((value) => value !== finalizer),
      };
      incrementVersion(record);
      return view(record);
    },
    async complete(precondition, options) {
      const record = assertFence(precondition);
      record.invalidated = false;
      if (options.nextDueAt) record.nextDueAt = options.nextDueAt;
      else delete record.nextDueAt;
      delete record.lease;
      delete record.lastError;
      return view(record);
    },
    async release(precondition, options) {
      const record = assertFence(precondition);
      if (options.retryAt) record.nextDueAt = options.retryAt;
      else delete record.nextDueAt;
      record.invalidated = false;
      if (options.error) record.lastError = options.error;
      else delete record.lastError;
      delete record.lease;
    },
  };
}

function canonicalManagedValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalManagedValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonicalManagedValue(entry)}`)
    .join(',')}}`;
}

export function applicationManagedModelDesiredDigest(value: unknown): string {
  return createHash('sha256').update(canonicalManagedValue(value)).digest('hex');
}
