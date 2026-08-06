import { field, index, model } from '@applik8s/applik8s/drizzle';

/**
 * Durable receipts for frozen engagement batches.
 *
 * Counts remain decimal strings so a batch can be reproduced without losing
 * precision at the JavaScript/SQL boundary.
 */
export const engagementBatches = model('engagement_batches', {
  id: field.text('id').primaryKey(),
  partitionKey: field.text('partition_key').notNull(),
  firstSequence: field.text('first_sequence').notNull(),
  lastSequence: field.text('last_sequence').notNull(),
  eventCount: field.text('event_count').notNull(),
  netDelta: field.text('net_delta').notNull(),
  processedAt: field.text('processed_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  index('engagement_batches_partition_processed').on(
    table.partitionKey,
    table.processedAt,
  ),
]);
