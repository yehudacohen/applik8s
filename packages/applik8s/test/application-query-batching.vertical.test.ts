// typecast-file-boundary: batching tests deliberately assemble erased and adversarial query fixtures to exercise runtime validation and fencing.
import { describe, expect, test } from 'vitest';
import type { ApplicationJobExecution } from '../src/application-finite-jobs.js';
import {
  type ApplicationQueryBatchProgress,
  createDeterministicApplicationQueryBatchRuntime,
  executeApplicationQueryBatch,
  installApplicationQueryBatchRuntimeResolver,
  QueryConsistency,
} from '../src/application-query-batching.js';
import {
  type ApplicationQuerySelectableModel,
  captureApplicationQuerySelection,
  evaluateApplicationQuerySelection,
} from '../src/application-query-selection.js';

interface CardRow {
  readonly id: string;
  readonly setId: string;
  readonly name: string;
}

const Card = {
  $inferSelect: undefined as unknown as CardRow,
  $model: {
    kind: 'applicationModelFacet' as const,
    name: 'Card',
    provider: 'postgres',
    database: 'catalog',
    table: {
      name: 'cards',
      columns: [
        { property: 'id', column: 'id', logicalType: 'string', nullable: false },
        { property: 'setId', column: 'set_id', logicalType: 'string', nullable: false },
        { property: 'name', column: 'name', logicalType: 'string', nullable: false },
      ],
    },
    identity: { fields: ['id'] },
  },
} satisfies ApplicationQuerySelectableModel<CardRow>;

function cardsForSet(
  input: { readonly setId: string },
  context: { readonly select: typeof import('../src/application-query-selection.js').createApplicationQuerySelection },
) {
  return context.select(Card)
    .where(card => card.setId.eq(input.setId))
    .orderBy(card => card.name.asc());
}

function selection() {
  const contract = captureApplicationQuerySelection(
    cardsForSet as (input: unknown, context: unknown) => unknown,
    cardsForSet.toString(),
  );
  if (!contract) throw new Error('Expected a portable query selection.');
  return contract;
}

describe('function-native Query.onBatch semantics', () => {
  test('captures one portable selection and appends stable identity ordering', () => {
    const contract = selection();
    expect(contract).toMatchObject({
      sourceModel: 'Card',
      source: {
        provider: 'postgres',
        database: 'catalog',
        table: 'cards',
        columns: [
          { property: 'id', column: 'id' },
          { property: 'setId', column: 'set_id' },
          { property: 'name', column: 'name' },
        ],
      },
      predicate: {
        kind: 'comparison',
        operation: 'eq',
        left: { kind: 'field', path: ['setId'] },
        right: { kind: 'input', path: ['setId'] },
      },
      order: [
        { expression: { kind: 'field', path: ['name'] }, direction: 'asc' },
        { expression: { kind: 'field', path: ['id'] }, direction: 'asc' },
      ],
    });
    expect(evaluateApplicationQuerySelection({
      selection: contract,
      input: { setId: 'set-1' },
      rows: [
        { id: 'card-3', setId: 'set-2', name: 'A' },
        { id: 'card-2', setId: 'set-1', name: 'B' },
        { id: 'card-1', setId: 'set-1', name: 'B' },
      ],
    })).toEqual([
      { id: 'card-1', setId: 'set-1', name: 'B' },
      { id: 'card-2', setId: 'set-1', name: 'B' },
    ]);
  });

  test('processes bounded concurrent windows and commits only the contiguous prefix', async () => {
    const contract = selection();
    const base = createDeterministicApplicationQueryBatchRuntime({
      rows: () => cards(5),
    });
    const completions: { readonly ordinal: number; readonly committed?: number }[] = [];
    const runtime = {
      ...base,
      async completeWindow(request: Parameters<typeof base.completeWindow>[0]) {
        const result = await base.completeWindow(request);
        completions.push({
          ordinal: request.window.ordinal,
          ...(result.committedFrontier ? { committed: result.committedFrontier.ordinal } : {}),
        });
        return result;
      },
    };
    const uninstall = installApplicationQueryBatchRuntimeResolver(() => runtime);
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const seen: number[] = [];
    try {
      const result = await executeApplicationQueryBatch({
        selection: contract,
        input: { setId: 'set-1' },
        policy: {
          batch: { maxItems: 2 },
          concurrency: 3,
          consistency: QueryConsistency.repeatableSnapshot,
        },
        execution: execution('run-concurrent'),
        async handler(batch) {
          seen.push(batch.window.ordinal);
          if (batch.window.ordinal === 0) await first;
          if (batch.window.ordinal === 2) releaseFirst();
        },
      });
      expect(result).toMatchObject({
        processedItems: 5,
        completedWindows: 3,
        finalFrontier: { ordinal: 2 },
      });
      expect(seen).toEqual([0, 1, 2]);
      expect(completions.slice(0, 2)).toEqual([
        { ordinal: 1 },
        { ordinal: 2 },
      ]);
      expect(completions.at(-1)).toEqual({ ordinal: 0, committed: 2 });
    } finally {
      uninstall();
    }
  });

  test('resumes a failed gap without rerunning a later receipted window', async () => {
    const contract = selection();
    const runtime = createDeterministicApplicationQueryBatchRuntime({ rows: () => cards(3) });
    const uninstall = installApplicationQueryBatchRuntimeResolver(() => runtime);
    const invocations = new Map<number, number>();
    let failFirst = true;
    const run = async () => executeApplicationQueryBatch({
      selection: contract,
      input: { setId: 'set-1' },
      policy: {
        batch: { maxItems: 1 },
        concurrency: 2,
        consistency: QueryConsistency.monotonicFrontier,
      },
      execution: execution('run-resume'),
      async handler(batch) {
        invocations.set(batch.window.ordinal, (invocations.get(batch.window.ordinal) ?? 0) + 1);
        if (batch.window.ordinal === 0 && failFirst) {
          failFirst = false;
          throw new Error('injected gap failure');
        }
      },
    });
    try {
      await expect(run()).rejects.toThrow('injected gap failure');
      await expect(run()).resolves.toMatchObject({
        processedItems: 3,
        completedWindows: 3,
        finalFrontier: { ordinal: 2 },
      });
      expect(invocations.get(0)).toBe(2);
      expect(invocations.get(1)).toBe(1);
      expect(invocations.get(2)).toBe(1);
    } finally {
      uninstall();
    }
  });

  test('completes an empty selection without invoking the handler', async () => {
    const contract = selection();
    const runtime = createDeterministicApplicationQueryBatchRuntime({ rows: () => [] });
    const uninstall = installApplicationQueryBatchRuntimeResolver(() => runtime);
    let invoked = false;
    try {
      await expect(executeApplicationQueryBatch({
        selection: contract,
        input: { setId: 'set-1' },
        policy: {
          batch: { maxItems: 10 },
          consistency: QueryConsistency.repeatableSnapshot,
        },
        execution: execution('run-empty'),
        async handler() { invoked = true; },
      })).resolves.toMatchObject({ processedItems: 0, completedWindows: 0 });
      expect(invoked).toBe(false);
    } finally {
      uninstall();
    }
  });
});

function cards(count: number): readonly CardRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${String(index).padStart(2, '0')}`,
    setId: 'set-1',
    name: `Card ${String(index).padStart(2, '0')}`,
  }));
}

function execution(runId: string): ApplicationJobExecution<ApplicationQueryBatchProgress, never> {
  const controller = new AbortController();
  return {
    admission: {
      authorityRevision: 'authority-v1',
      trustedContext: { values: { organizationId: 'organization-1' }, digest: 'context-v1' },
    } as never,
    run: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'queries.Card.cardsForSet.batch.v1',
      runId,
      admittedAt: '2026-08-31T00:00:00.000Z',
    },
    invocationId: runId,
    attempt: 1,
    signal: controller.signal,
    async progress(value) {
      return {
        run: this.run,
        sequence: 1,
        recordedAt: '2026-08-31T00:00:00.000Z',
        value,
      };
    },
    throwIfCancelled() {
      if (controller.signal.aborted) throw controller.signal.reason;
    },
    fail(error) { throw error; },
  };
}
