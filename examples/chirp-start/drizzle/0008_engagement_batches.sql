CREATE TABLE IF NOT EXISTS "engagement_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "partition_key" text NOT NULL,
  "first_sequence" text NOT NULL,
  "last_sequence" text NOT NULL,
  "event_count" text NOT NULL,
  "net_delta" text NOT NULL,
  "processed_at" text DEFAULT '' NOT NULL,
  "revision" text DEFAULT '' NOT NULL
);

CREATE INDEX IF NOT EXISTS "engagement_batches_processed"
  ON "engagement_batches" USING btree ("processed_at");

CREATE INDEX IF NOT EXISTS "engagement_batches_partition"
  ON "engagement_batches" USING btree ("partition_key", "last_sequence");
