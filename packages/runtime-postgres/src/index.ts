import type { ApplicationPostgresClientOptions, ApplicationPostgresSql } from '@applik8s/applik8s/postgres-runtime-contract';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createApplicationPostgresSql(url: string, options: ApplicationPostgresClientOptions = {}): ApplicationPostgresSql {
  // typecast: the provider-neutral contract is the exact async unsafe/begin/end subset consumed by Applik8s.
  return postgres(url, options) as unknown as ApplicationPostgresSql;
}

export function createApplicationPostgresDrizzle(url: string, options: ApplicationPostgresClientOptions = {}) {
  const native = postgres(url, options);
  return {
    // typecast: the raw client is returned only through the narrowed provider-neutral lifecycle contract.
    client: native as unknown as ApplicationPostgresSql,
    database: drizzle(native),
  };
}
