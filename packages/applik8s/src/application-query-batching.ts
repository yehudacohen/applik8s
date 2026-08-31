// typecast-file-boundary: selection schemas and durable batch cursors are validated before generic query values cross the batching boundary.
import { createHash } from 'node:crypto';
import type { ApplicationQueryOperation } from '@applik8s/client';
import { canonicalJsonV1String, type JsonObject, type JsonValue } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { serializeApplicationCallback } from './application-callback.js';
import type {
  ApplicationJobBinding,
  ApplicationJobExecution,
} from './application-finite-jobs.js';
import { registerApplicationJob } from './application-finite-jobs.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode } from './application-graph-state.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import type { ApplicationQueryBinding } from './application-queries.js';
import {
  type ApplicationQuerySelectionContract,
  evaluateApplicationQuerySelection,
} from './application-query-selection.js';

export const applicationQueryBatchProtocol = 'applik8s.query-batch/v1alpha1' as const;

export type ApplicationQueryBatchConsistency =
  | { readonly mode: 'repeatableSnapshot' }
  | { readonly mode: 'versionPinned'; readonly version: string }
  | { readonly mode: 'monotonicFrontier' }
  | {
      readonly mode: 'bestEffort';
      readonly acceptsMembershipDrift: true;
      readonly idempotency: 'handlerDeclared';
    };

export const QueryConsistency = Object.freeze({
  repeatableSnapshot: Object.freeze({ mode: 'repeatableSnapshot' as const }),
  versionPinned(version: string): ApplicationQueryBatchConsistency {
    if (!version.trim()) throw new TypeError('QueryConsistency.versionPinned(...) requires a non-empty immutable version.');
    return Object.freeze({ mode: 'versionPinned', version: version.trim() });
  },
  monotonicFrontier: Object.freeze({ mode: 'monotonicFrontier' as const }),
  bestEffort(options: {
    readonly acceptsMembershipDrift: true;
    readonly idempotency?: 'handlerDeclared';
  }): ApplicationQueryBatchConsistency {
    if (options.acceptsMembershipDrift !== true) {
      throw new TypeError('QueryConsistency.bestEffort(...) requires acceptsMembershipDrift: true.');
    }
    return Object.freeze({
      mode: 'bestEffort',
      acceptsMembershipDrift: true,
      idempotency: options.idempotency ?? 'handlerDeclared',
    });
  },
});

export interface ApplicationQueryBatchOptions {
  readonly batch: { readonly maxItems: number };
  readonly concurrency?: number;
  readonly consistency: ApplicationQueryBatchConsistency;
  readonly retries?: number;
  readonly timeout?: string;
  readonly resources?: {
    readonly cpu?: string;
    readonly memory?: string;
  };
}

export interface ApplicationQueryBatchWindow {
  readonly protocol: typeof applicationQueryBatchProtocol;
  readonly scanId: string;
  readonly ordinal: number;
  readonly id: string;
  readonly lower?: ApplicationQueryBatchFrontierReference;
  readonly upper: ApplicationQueryBatchFrontierReference;
  readonly consistencyRevision: string;
}

export interface ApplicationQueryBatchFrontierReference {
  readonly protocol: typeof applicationQueryBatchProtocol;
  readonly scanId: string;
  readonly ordinal: number;
  readonly digest: string;
}

export interface ApplicationQueryBatch<TItem extends object> {
  readonly items: readonly TItem[];
  readonly window: ApplicationQueryBatchWindow;
  readonly processed: number;
  readonly isFinal: boolean;
}

export interface ApplicationQueryBatchResult {
  readonly processedItems: number;
  readonly completedWindows: number;
  readonly finalFrontier: ApplicationQueryBatchFrontierReference;
  readonly consistencyRevision: string;
}

export interface ApplicationQueryBatchProgress {
  readonly processedItems: number;
  readonly completedWindows: number;
  readonly committedFrontier?: ApplicationQueryBatchFrontierReference;
}

export type ApplicationQueryBatchHandler<TItem extends object> = (
  batch: ApplicationQueryBatch<TItem>,
) => void | Promise<void>;

/** @internal Application-builder replay record retained on the Query declaration. */
export interface ApplicationQueryBatchReplay {
  readonly policy: ApplicationQueryBatchOptions;
  readonly handler: ApplicationQueryBatchHandler<object>;
}

export interface ApplicationBatchableQueryOperation<
  TInput,
  TItem extends object,
  TTarget = unknown,
> extends ApplicationQueryOperation<TInput, readonly TItem[], TTarget> {
  onBatch(
    options: ApplicationQueryBatchOptions,
    handler: ApplicationQueryBatchHandler<TItem>,
  ): ApplicationJobBinding<
    TInput & object,
    ApplicationQueryBatchResult,
    ApplicationQueryBatchProgress
  >;
}

export function decorateApplicationBatchableQueryOperation<
  TInput extends object,
  TItem extends object,
>(options: {
  readonly state: ApplicationGraphState;
  readonly operation: ApplicationQueryOperation<TInput, readonly TItem[]>;
  readonly query: ApplicationQueryBinding<TInput, readonly TItem[]>;
  readonly selection: ApplicationQuerySelectionContract;
  readonly replays?: ApplicationQueryBatchReplay[];
}): ApplicationBatchableQueryOperation<TInput, TItem> {
  const operation = options.operation as ApplicationBatchableQueryOperation<TInput, TItem>;
  Object.defineProperty(operation, 'onBatch', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: (
      policy: ApplicationQueryBatchOptions,
      handler: ApplicationQueryBatchHandler<TItem>,
    ) => {
      options.replays?.push({
        policy,
        handler: handler as ApplicationQueryBatchHandler<object>,
      });
      return registerApplicationQueryBatch(options, policy, handler);
    },
  });
  for (const replay of options.replays ?? []) {
    registerApplicationQueryBatch(
      options,
      replay.policy,
      replay.handler as ApplicationQueryBatchHandler<TItem>,
    );
  }
  return operation;
}

function registerApplicationQueryBatch<TInput extends object, TItem extends object>(
  declaration: {
    readonly state: ApplicationGraphState;
    readonly operation: ApplicationQueryOperation<TInput, readonly TItem[]>;
    readonly query: ApplicationQueryBinding<TInput, readonly TItem[]>;
    readonly selection: ApplicationQuerySelectionContract;
  },
  policy: ApplicationQueryBatchOptions,
  handler: ApplicationQueryBatchHandler<TItem>,
): ApplicationJobBinding<TInput, ApplicationQueryBatchResult, ApplicationQueryBatchProgress> {
  const maxItems = positiveInteger(policy.batch.maxItems, 'Query batch maxItems');
  const concurrency = positiveInteger(policy.concurrency ?? 1, 'Query batch concurrency');
  if (typeof handler !== 'function') throw new TypeError('Query.onBatch(...) requires a batch handler.');
  const serialized = serializeApplicationCallback({
    registrar: 'Query.onBatch',
    argumentIndex: 1,
    property: 'handler',
    label: `Application query ${declaration.query.id} batch handler`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const normalizedPolicy: ApplicationQueryBatchOptions = {
    ...policy,
    batch: { maxItems },
    concurrency,
  };
  const id = `queries.${kubernetesNameSegment(declaration.query.id)}.batch.${declaration.query.version}`;
  const job = registerApplicationJob<
    TInput,
    ApplicationQueryBatchResult,
    ApplicationQueryBatchProgress,
    never
  >(
    declaration.state,
    id,
    {
      input: declaration.query.input as unknown as SchemaInput<TInput>,
      output: queryBatchResultSchema(),
      progress: queryBatchProgressSchema(),
    },
    {
      ...(policy.retries === undefined ? {} : { retries: policy.retries }),
      ...(policy.timeout === undefined ? {} : { timeout: policy.timeout }),
      idempotencyKey: (input) => queryBatchInputDigest(declaration.selection.digest, input),
    },
    async function executeQueryBatchJob(input, execution) {
      return executeApplicationQueryBatch<TInput, TItem>({
        selection: declaration.selection,
        input,
        policy: normalizedPolicy,
        handler,
        execution,
      });
    },
  );
  const nodeId = `job.${kubernetesNameSegment(id)}`;
  const node = declaration.state.graphNodes.find(
    (candidate) => candidate.id === nodeId && candidate.kind === 'job',
  );
  if (node?.kind !== 'job') {
    throw new Error(`Query batch ${declaration.query.id} did not create its finite Job graph node.`);
  }
  addApplicationGraphNode(declaration.state, {
    ...node,
    queryBatch: {
      query: { nodeId: `query.${declaration.query.id}` },
      selectionDigest: declaration.selection.digest,
      consistency: normalizedPolicy.consistency,
      batch: { maxItems, concurrency },
      lowering: {
        provider: 'postgres',
        strategy: 'materializedSnapshotRelation',
        checkpointAuthority: 'sourceDatabase',
        maximumSnapshotItems: 100_000,
        maximumSnapshotAgeSeconds: 86_400,
        stableKeyset: true,
        durableWindowReceipts: true,
        contiguousFrontier: true,
      },
      ...(normalizedPolicy.resources ? { resources: normalizedPolicy.resources } : {}),
      handlerSource: serialized.source,
      ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
      ...(serialized.location ? { handlerLocation: serialized.location } : {}),
      ...(serialized.unresolved ? { handlerUnresolved: serialized.unresolved } : {}),
    },
  });
  addApplicationGraphEdge(declaration.state, {
    from: { nodeId },
    to: { nodeId: `query.${declaration.query.id}` },
    relationship: 'reads',
  });
  return job;
}

export interface ApplicationQueryBatchPreparedScan {
  readonly protocol: typeof applicationQueryBatchProtocol;
  readonly scanId: string;
  readonly selectionDigest: string;
  readonly consistencyRevision: string;
  /** Attempt-scoped fence preventing an expired worker from committing. */
  readonly executionFence: string;
  readonly terminalBound: ApplicationQueryBatchFrontierReference;
  readonly firstFrontier?: ApplicationQueryBatchFrontierReference;
  /** Logical succeeded prefix restored before the current worker attempt. */
  readonly committedItems: number;
  readonly committedWindows: number;
  readonly expiresAt?: string;
}

export interface ApplicationQueryBatchWindowRead<TItem extends object> {
  readonly items: readonly TItem[];
  readonly window: ApplicationQueryBatchWindow;
  readonly next?: ApplicationQueryBatchFrontierReference;
  readonly terminal: boolean;
  /** A durable receipt already exists, so the handler must not run again. */
  readonly receipt?: 'succeeded';
}

export interface ApplicationQueryBatchRuntime {
  readonly capabilities: {
    readonly repeatableSnapshot: boolean;
    readonly versionPinned: boolean;
    readonly monotonicFrontier: boolean;
    readonly bestEffort: boolean;
    readonly stableKeyset: boolean;
    readonly resumableFrontier: boolean;
    readonly durableWindowReceipts: boolean;
    readonly concurrentWindows: boolean;
    readonly maximumSnapshotAge?: string;
  };
  prepare(request: {
    readonly selection: ApplicationQuerySelectionContract;
    readonly input: unknown;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly authorityRevision: string;
    readonly runId: string;
    readonly executionFence: string;
    readonly consistency: ApplicationQueryBatchConsistency;
    readonly batchSize: number;
  }): Promise<ApplicationQueryBatchPreparedScan>;
  readWindow<TItem extends object>(request: {
    readonly scan: ApplicationQueryBatchPreparedScan;
    readonly after?: ApplicationQueryBatchFrontierReference;
    readonly maximumItems: number;
    readonly signal: AbortSignal;
  }): Promise<ApplicationQueryBatchWindowRead<TItem>>;
  completeWindow(request: {
    readonly scan: ApplicationQueryBatchPreparedScan;
    readonly window: ApplicationQueryBatchWindow;
    readonly outcome: 'succeeded' | 'failed';
  }): Promise<{ readonly committedFrontier?: ApplicationQueryBatchFrontierReference }>;
  release(request: {
    readonly scan: ApplicationQueryBatchPreparedScan;
    readonly terminal: 'succeeded' | 'failed' | 'cancelled' | 'timedOut';
  }): Promise<void>;
}

export type ApplicationQueryBatchRuntimeResolver = (
  selection: ApplicationQuerySelectionContract,
) => ApplicationQueryBatchRuntime | undefined;

const runtimeResolvers: ApplicationQueryBatchRuntimeResolver[] = [];

export function installApplicationQueryBatchRuntimeResolver(
  resolver: ApplicationQueryBatchRuntimeResolver,
): () => void {
  runtimeResolvers.push(resolver);
  return () => {
    const index = runtimeResolvers.lastIndexOf(resolver);
    if (index >= 0) runtimeResolvers.splice(index, 1);
  };
}

export function applicationQueryBatchRuntime(
  selection: ApplicationQuerySelectionContract,
): ApplicationQueryBatchRuntime {
  for (const resolver of [...runtimeResolvers].reverse()) {
    const runtime = resolver(selection);
    if (runtime) return runtime;
  }
  throw new Error(`Query batch selection ${selection.digest} has no active provider runtime.`);
}

/**
 * Deterministic in-memory provider used by local execution and the provider
 * conformance suite. Its durable state is process-local by design; production
 * providers implement the identical protocol over a qualified store.
 */
export function createDeterministicApplicationQueryBatchRuntime(options: {
  readonly rows: (
    selection: ApplicationQuerySelectionContract,
  ) => readonly object[] | Promise<readonly object[]>;
  readonly now?: () => Date;
}): ApplicationQueryBatchRuntime {
  const scans = new Map<string, DeterministicQueryBatchScan>();
  return {
    capabilities: {
      repeatableSnapshot: true,
      versionPinned: true,
      monotonicFrontier: true,
      bestEffort: true,
      stableKeyset: true,
      resumableFrontier: true,
      durableWindowReceipts: true,
      concurrentWindows: true,
    },
    async prepare(request) {
      const key = queryBatchScanKey(request.runId, request.selection.digest);
      const admissionDigest = queryBatchAdmissionDigest(request);
      let state = scans.get(key);
      if (!state) {
        const rows = await options.rows(request.selection);
        const items = evaluateApplicationQuerySelection({
          selection: request.selection,
          input: request.input,
          rows,
        });
        const consistencyRevision = request.consistency.mode === 'versionPinned'
          ? request.consistency.version
          : createHash('sha256').update(canonicalJsonV1String({
              selection: request.selection.digest,
              input: request.input,
              authorityRevision: request.authorityRevision,
              rows: items,
            })).digest('hex');
        const scanId = createHash('sha256').update(canonicalJsonV1String({ key, consistencyRevision })).digest('hex');
        state = {
          key,
          scanId,
          selectionDigest: request.selection.digest,
          consistencyRevision,
          items,
          batchSize: request.batchSize,
          committedOrdinal: -1,
          receipts: new Set<number>(),
          preparedAt: (options.now ?? (() => new Date()))().toISOString(),
          activeFence: request.executionFence,
          admissionDigest,
        };
        scans.set(key, state);
      } else if (state.admissionDigest !== admissionDigest) {
        throw new Error(`QUERY_BATCH_ADMISSION_CONFLICT: scan ${state.scanId} was prepared under another authority context.`);
      } else if (state.batchSize !== request.batchSize) {
        throw new Error(`Query batch scan ${state.scanId} cannot change batch size after preparation.`);
      } else {
        state.activeFence = request.executionFence;
      }
      return deterministicPreparedScan(state);
    },
    async readWindow<TItem extends object>(request: {
      readonly scan: ApplicationQueryBatchPreparedScan;
      readonly after?: ApplicationQueryBatchFrontierReference;
      readonly maximumItems: number;
      readonly signal: AbortSignal;
    }): Promise<ApplicationQueryBatchWindowRead<TItem>> {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('QUERY_BATCH_CANCELLED');
      const state = requiredDeterministicScan(scans, request.scan);
      if (request.maximumItems !== state.batchSize) {
        throw new Error(`Query batch scan ${state.scanId} requires its prepared batch size ${state.batchSize}.`);
      }
      const ordinal = (request.after?.ordinal ?? -1) + 1;
      const offset = ordinal * state.batchSize;
      const items = state.items.slice(offset, offset + state.batchSize) as unknown as readonly TItem[];
      const upper = deterministicFrontier(state, ordinal);
      const terminal = offset + items.length >= state.items.length;
      return {
        items,
        window: {
          protocol: applicationQueryBatchProtocol,
          scanId: state.scanId,
          ordinal,
          id: createHash('sha256').update(canonicalJsonV1String({
            selection: state.selectionDigest,
            revision: state.consistencyRevision,
            ...(request.after ? { lower: request.after.digest } : {}),
            upper: upper.digest,
          })).digest('hex'),
          ...(request.after ? { lower: request.after } : {}),
          upper,
          consistencyRevision: state.consistencyRevision,
        },
        ...(terminal ? {} : { next: upper }),
        terminal,
        ...(state.receipts.has(ordinal) ? { receipt: 'succeeded' as const } : {}),
      };
    },
    async completeWindow(request) {
      const state = requiredDeterministicScan(scans, request.scan);
      if (request.window.scanId !== state.scanId) throw new Error('Query batch window belongs to another scan.');
      if (request.outcome === 'succeeded') state.receipts.add(request.window.ordinal);
      else state.receipts.delete(request.window.ordinal);
      while (state.receipts.has(state.committedOrdinal + 1)) state.committedOrdinal += 1;
      return state.committedOrdinal >= 0
        ? { committedFrontier: deterministicFrontier(state, state.committedOrdinal) }
        : {};
    },
    async release(request) {
      const state = requiredDeterministicScan(scans, request.scan);
      state.released = request.terminal;
    },
  };
}

export async function executeApplicationQueryBatch<
  TInput extends object,
  TItem extends object,
>(options: {
  readonly selection: ApplicationQuerySelectionContract;
  readonly input: TInput;
  readonly policy: ApplicationQueryBatchOptions;
  readonly handler: ApplicationQueryBatchHandler<TItem>;
  readonly execution: ApplicationJobExecution<ApplicationQueryBatchProgress, never>;
}): Promise<ApplicationQueryBatchResult> {
  const runtime = applicationQueryBatchRuntime(options.selection);
  assertRuntimeSupports(runtime, options.policy);
  const scan = await runtime.prepare({
    selection: options.selection,
    input: options.input,
    trustedContext: options.execution.admission.trustedContext.values,
    authorityRevision: options.execution.admission.authorityRevision,
    runId: options.execution.run.runId,
    executionFence: options.execution.invocationId,
    consistency: options.policy.consistency,
    batchSize: positiveInteger(options.policy.batch.maxItems, 'Query batch maxItems'),
  });
  let after = scan.firstFrontier;
  let processedItems = scan.committedItems;
  let completedWindows = scan.committedWindows;
  let finalFrontier = scan.firstFrontier ?? scan.terminalBound;
  let terminal: 'succeeded' | 'failed' | 'cancelled' | 'timedOut' = 'failed';
  try {
    while (true) {
      options.execution.throwIfCancelled();
      const admitted: ApplicationQueryBatchWindowRead<TItem>[] = [];
      let admissionAfter = after;
      for (let index = 0; index < (options.policy.concurrency ?? 1); index += 1) {
        const read = await runtime.readWindow<TItem>({
          scan,
          ...(admissionAfter ? { after: admissionAfter } : {}),
          maximumItems: options.policy.batch.maxItems,
          signal: options.execution.signal,
        });
        if (read.items.length === 0 && read.terminal) {
          if (admitted.length === 0) {
            finalFrontier = read.window.upper;
            terminal = 'succeeded';
          }
          break;
        }
        admitted.push(read);
        admissionAfter = read.window.upper;
        if (read.terminal) break;
        if (!read.next) {
          throw new Error(
            `Query batch provider returned non-terminal window ${read.window.id} without a next frontier.`,
          );
        }
      }
      if (admitted.length === 0) break;
      const offsets: number[] = [];
      let waveItems = 0;
      for (const read of admitted) {
        offsets.push(waveItems);
        waveItems += read.items.length;
      }
      const outcomes = await Promise.allSettled(admitted.map(async (read, index) => {
        if (read.receipt !== 'succeeded') {
          try {
            await options.handler({
              items: read.items,
              window: read.window,
              processed: processedItems + (offsets[index] ?? 0),
              isFinal: read.terminal,
            });
          } catch (error) {
            await runtime.completeWindow({ scan, window: read.window, outcome: 'failed' });
            throw error;
          }
        }
        return runtime.completeWindow({ scan, window: read.window, outcome: 'succeeded' });
      }));
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      if (failure) throw failure.reason;
      processedItems += waveItems;
      completedWindows += admitted.length;
      const committed = outcomes
        .filter((outcome): outcome is PromiseFulfilledResult<{ readonly committedFrontier?: ApplicationQueryBatchFrontierReference }> => outcome.status === 'fulfilled')
        .flatMap((outcome) => outcome.value.committedFrontier ? [outcome.value.committedFrontier] : [])
        .sort((left, right) => right.ordinal - left.ordinal)[0];
      finalFrontier = committed ?? finalFrontier;
      await options.execution.progress({
        processedItems,
        completedWindows,
        ...(committed
          ? { committedFrontier: committed }
          : {}),
      });
      const last = admitted.at(-1);
      if (!last) throw new Error('Query batch admitted wave unexpectedly became empty.');
      after = last.window.upper;
      if (last.terminal) {
        terminal = 'succeeded';
        break;
      }
    }
    return {
      processedItems,
      completedWindows,
      finalFrontier,
      consistencyRevision: scan.consistencyRevision,
    };
  } finally {
    await runtime.release({ scan, terminal });
  }
}

interface DeterministicQueryBatchScan {
  readonly key: string;
  readonly scanId: string;
  readonly selectionDigest: string;
  readonly consistencyRevision: string;
  readonly items: readonly object[];
  readonly batchSize: number;
  readonly preparedAt: string;
  readonly admissionDigest: string;
  activeFence: string;
  committedOrdinal: number;
  readonly receipts: Set<number>;
  released?: 'succeeded' | 'failed' | 'cancelled' | 'timedOut';
}

function queryBatchScanKey(
  runId: string,
  selectionDigest: string,
): string {
  return createHash('sha256')
    .update(canonicalJsonV1String({ runId, selectionDigest }))
    .digest('hex');
}

function queryBatchAdmissionDigest(request: {
  readonly selection: ApplicationQuerySelectionContract;
  readonly input: unknown;
  readonly authorityRevision: string;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
}): string {
  return createHash('sha256')
    .update(canonicalJsonV1String({
      selection: request.selection.digest,
      input: request.input,
      authorityRevision: request.authorityRevision,
      trustedContext: request.trustedContext,
    }))
    .digest('hex');
}

function deterministicPreparedScan(state: DeterministicQueryBatchScan): ApplicationQueryBatchPreparedScan {
  const terminalOrdinal = Math.max(0, Math.ceil(state.items.length / state.batchSize) - 1);
  return {
    protocol: applicationQueryBatchProtocol,
    scanId: state.scanId,
    selectionDigest: state.selectionDigest,
    consistencyRevision: state.consistencyRevision,
    executionFence: state.activeFence,
    terminalBound: deterministicFrontier(state, terminalOrdinal),
    committedItems: state.committedOrdinal < 0
      ? 0
      : Math.min(state.items.length, (state.committedOrdinal + 1) * state.batchSize),
    committedWindows: state.committedOrdinal + 1,
    ...(state.committedOrdinal >= 0
      ? { firstFrontier: deterministicFrontier(state, state.committedOrdinal) }
      : {}),
  };
}

function deterministicFrontier(
  state: DeterministicQueryBatchScan,
  ordinal: number,
): ApplicationQueryBatchFrontierReference {
  return {
    protocol: applicationQueryBatchProtocol,
    scanId: state.scanId,
    ordinal,
    digest: createHash('sha256').update(canonicalJsonV1String({
      scanId: state.scanId,
      ordinal,
      revision: state.consistencyRevision,
    })).digest('hex'),
  };
}

function requiredDeterministicScan(
  scans: ReadonlyMap<string, DeterministicQueryBatchScan>,
  scan: ApplicationQueryBatchPreparedScan,
): DeterministicQueryBatchScan {
  const state = [...scans.values()].find((candidate) => candidate.scanId === scan.scanId);
  if (!state || state.selectionDigest !== scan.selectionDigest) {
    throw new Error(`Unknown or mismatched query batch scan ${scan.scanId}.`);
  }
  if (state.activeFence !== scan.executionFence) {
    throw new Error(`QUERY_BATCH_FENCE_LOST: scan ${scan.scanId} belongs to a newer Job attempt.`);
  }
  return state;
}

function assertRuntimeSupports(
  runtime: ApplicationQueryBatchRuntime,
  options: ApplicationQueryBatchOptions,
): void {
  const mode = options.consistency.mode;
  if (!runtime.capabilities[mode]) {
    throw new Error(`Query batch provider does not support requested ${mode} consistency.`);
  }
  const concurrency = positiveInteger(options.concurrency ?? 1, 'Query batch concurrency');
  if (concurrency > 1 && !runtime.capabilities.concurrentWindows) {
    throw new Error('Query batch provider does not support concurrent durable windows.');
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function queryBatchInputDigest(selectionDigest: string, input: object): string {
  return createHash('sha256')
    .update(canonicalJsonV1String({ selectionDigest, input }))
    .digest('hex');
}

function queryBatchResultSchema(): SchemaInput<ApplicationQueryBatchResult> {
  return jsonSchema('ApplicationQueryBatchResult', {
    type: 'object',
    additionalProperties: false,
    required: ['processedItems', 'completedWindows', 'finalFrontier', 'consistencyRevision'],
    properties: {
      processedItems: { type: 'integer', minimum: 0 },
      completedWindows: { type: 'integer', minimum: 0 },
      finalFrontier: queryBatchFrontierJsonSchema(),
      consistencyRevision: { type: 'string', minLength: 1 },
    },
  });
}

function queryBatchProgressSchema(): SchemaInput<ApplicationQueryBatchProgress> {
  return jsonSchema('ApplicationQueryBatchProgress', {
    type: 'object',
    additionalProperties: false,
    required: ['processedItems', 'completedWindows'],
    properties: {
      processedItems: { type: 'integer', minimum: 0 },
      completedWindows: { type: 'integer', minimum: 0 },
      committedFrontier: queryBatchFrontierJsonSchema(),
    },
  });
}

function queryBatchFrontierJsonSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['protocol', 'scanId', 'ordinal', 'digest'],
    properties: {
      protocol: { const: applicationQueryBatchProtocol },
      scanId: { type: 'string', minLength: 1 },
      ordinal: { type: 'integer', minimum: 0 },
      digest: { type: 'string', minLength: 1 },
    },
  };
}

function jsonSchema<TValue extends object>(
  exportName: string,
  schema: JsonObject,
): SchemaInput<TValue> {
  return {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName },
    schema,
  };
}
