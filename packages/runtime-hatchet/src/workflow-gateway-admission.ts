/** Provider-facing, runtime-safe compaction for workflow gateway admission records. */

export type HatchetWorkflowAdmissionRunState = 'active' | 'terminal' | 'missing';
export type HatchetWorkflowAdmissionDeleteResult = 'deleted' | 'absent' | 'conflict';

export interface HatchetWorkflowAdmissionLeaseRecord {
  readonly metadata?: {
    readonly name?: string;
    readonly uid?: string;
    readonly annotations?: Readonly<Record<string, string>>;
  };
}

export interface HatchetWorkflowAdmissionPage {
  readonly items: readonly HatchetWorkflowAdmissionLeaseRecord[];
  readonly nextCursor?: string;
}

export interface CompactHatchetWorkflowAdmissionPageOptions {
  readonly nowMs: number;
  readonly replayWindowSeconds: number;
  readonly cleanupBatchSize: number;
  readonly cursor?: string;
  listPage(input: {
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<HatchetWorkflowAdmissionPage>;
  runState(providerRunId: string): Promise<HatchetWorkflowAdmissionRunState>;
  deleteLease(input: {
    readonly name: string;
    readonly uid: string;
  }): Promise<HatchetWorkflowAdmissionDeleteResult>;
}

export interface CompactHatchetWorkflowAdmissionPageResult {
  readonly inspected: number;
  readonly deleted: number;
  readonly nextCursor?: string;
}

/**
 * Inspect one bounded page and remove only terminal records older than the
 * declared replay window. UID-fenced deletion makes concurrent replicas safe.
 */
export async function compactHatchetWorkflowAdmissionPage(
  options: CompactHatchetWorkflowAdmissionPageOptions,
): Promise<CompactHatchetWorkflowAdmissionPageResult> {
  if (!Number.isFinite(options.nowMs)) throw new Error('Workflow admission cleanup requires a finite clock value.');
  if (!Number.isSafeInteger(options.replayWindowSeconds) || options.replayWindowSeconds < 60) {
    throw new Error('Workflow admission cleanup replayWindowSeconds must be a safe integer of at least 60 seconds.');
  }
  if (!Number.isSafeInteger(options.cleanupBatchSize) || options.cleanupBatchSize < 1 || options.cleanupBatchSize > 10_000) {
    throw new Error('Workflow admission cleanup batch size must be a safe integer between 1 and 10000.');
  }
  const page = await options.listPage({
    ...(options.cursor ? { cursor: options.cursor } : {}),
    limit: options.cleanupBatchSize,
  });
  let deleted = 0;
  for (const lease of page.items) {
    const annotations = lease.metadata?.annotations ?? {};
    const admittedAt = Date.parse(annotations['applik8s.dev/admitted-at'] ?? '');
    const providerRunId = annotations['applik8s.dev/provider-run-id'];
    const name = lease.metadata?.name;
    const uid = lease.metadata?.uid;
    if (
      annotations['applik8s.dev/admission-state'] !== 'admitted'
      || !providerRunId
      || !name
      || !uid
      || !Number.isFinite(admittedAt)
      || options.nowMs - admittedAt < options.replayWindowSeconds * 1_000
    ) continue;
    const state = await options.runState(providerRunId);
    if (state !== 'terminal' && state !== 'missing') continue;
    const result = await options.deleteLease({ name, uid });
    if (result === 'deleted' || result === 'absent') deleted += 1;
  }
  return {
    inspected: page.items.length,
    deleted,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}
