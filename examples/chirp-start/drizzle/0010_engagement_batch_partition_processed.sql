CREATE INDEX IF NOT EXISTS "engagement_batches_partition_processed"
  ON "engagement_batches" USING btree ("partition_key", "processed_at");
