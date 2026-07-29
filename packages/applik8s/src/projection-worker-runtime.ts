/** Focused generated analytical and online projection runtime. */
export { createClickHouseAnalyticalProjectionReader, createClickHouseAnalyticalProjectionWriter, runApplicationProjection } from './projection-runtime-clickhouse.js';
export { createValkeyOnlineProjectionReader, createValkeyOnlineProjectionWriter } from './projection-runtime-valkey.js';
export { retireApplicationOnlineProjectionGeneration, runApplicationOnlineProjectionRebuild } from './projection-rebuild-runtime.js';
export { createPostgresApplicationProjectionSnapshotSource } from './projection-snapshot-postgres-runtime.js';
export type { ApplicationProjectionSnapshotItem, ApplicationProjectionSnapshotSource, PostgresApplicationProjectionSnapshotOptions } from './projection-snapshot-postgres-runtime.js';
export { createPostgresApplicationStream, enforcePostgresApplicationStreamRetention } from './stream-runtime-postgres.js';
