import { type } from '@applik8s/applik8s/dsl';
import { desc } from 'drizzle-orm';
import { app, workflow } from '../domain-app';
import { Database } from '../providers/database';
import { engagementBatches } from '../schema/engagement';

const EngagementBatchBase = engagementBatches;

EngagementBatchBase.create.beforeCommit(
  { history: true },
  async (receipt, input, context) => {
    if (input.processedAt !== undefined || input.revision !== undefined) {
      throw new Error(
        'Engagement batch timestamps and revisions are framework-owned.',
      );
    }
    const eventCount = Number(input.eventCount);
    const netDelta = Number(input.netDelta);
    if (!Number.isSafeInteger(eventCount) || eventCount < 1 || eventCount > 100) {
      throw new Error('An engagement batch receipt requires between 1 and 100 events.');
    }
    if (!Number.isSafeInteger(netDelta) || Math.abs(netDelta) > eventCount) {
      throw new Error('An engagement batch net delta must fit its frozen membership.');
    }
    if (
      !input.partitionKey
      || !input.firstSequence
      || !input.lastSequence
    ) {
      throw new Error(
        'An engagement batch receipt requires its partition and sequence range.',
      );
    }
    receipt.patch({ spec: { processedAt: context.now } });
  },
);

EngagementBatchBase.update.beforeCommit(
  { history: true },
  async () => {
    throw new Error('Frozen engagement batch receipts are immutable.');
  },
);

EngagementBatchBase.delete.beforeCommit(
  { history: true },
  async () => {
    throw new Error('Frozen engagement batch receipts are retained as audit evidence.');
  },
);

export const EngagementBatch = EngagementBatchBase;
const EngagementBatchRecorder = app.serviceIdentity(
  'engagement-batch-recorder',
);
EngagementBatchRecorder.can(EngagementBatch.create);

export const EngagementBatchRecent = EngagementBatch.view(
  {
    input: type({ 'limit?': 'number.integer >= 1' }),
    output: type({
      id: 'string',
      partitionKey: 'string',
      firstSequence: 'string',
      lastSequence: 'string',
      eventCount: 'string',
      netDelta: 'string',
      processedAt: 'string',
    }).array(),
    database: Database,
    authorize: ({ principal }) =>
      principal.roles?.some((role) =>
        ['analytics-worker', 'moderator', 'installation-administrator'].includes(role),
      ) === true,
    budgets: { maxRows: 100, maxResultBytes: 256_000, timeoutMs: 2_000 },
  },
  async function recentEngagementBatches(input, _context) {
    return Database
      .select({
        id: EngagementBatchBase.id,
        partitionKey: EngagementBatchBase.partitionKey,
        firstSequence: EngagementBatchBase.firstSequence,
        lastSequence: EngagementBatchBase.lastSequence,
        eventCount: EngagementBatchBase.eventCount,
        netDelta: EngagementBatchBase.netDelta,
        processedAt: EngagementBatchBase.processedAt,
      })
      .from(EngagementBatchBase)
      .orderBy(desc(EngagementBatchBase.processedAt))
      .limit(Math.min(input.limit ?? 50, 100));
  },
);

/**
 * The batch worker calls this value directly. Its durable occurrence identity
 * is the frozen batch id, so a worker restart cannot create a second receipt
 * while the model operation remains an ordinary callable handle.
 */
export const recordEngagementBatch = workflow(
  'engagement.record-batch.v1',
  {
    input: type({
      id: 'string',
      partitionKey: 'string',
      firstSequence: 'string',
      lastSequence: 'string',
      eventCount: 'string',
      netDelta: 'string',
    }),
    output: type({ id: 'string' }),
  },
  {
    identity: EngagementBatchRecorder,
    authority: [EngagementBatch.create.all()],
    idempotencyKey: ({ id }) => id,
  },
  async function persistEngagementBatchReceipt(input) {
    const receipt = await EngagementBatch.create(input);
    return { id: String(receipt.value.id) };
  },
);
