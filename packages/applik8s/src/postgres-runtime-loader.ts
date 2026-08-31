import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ApplicationPostgresClientOptions, ApplicationPostgresSql } from './postgres-runtime-contract.js';

interface ApplicationPostgresRuntimeModule {
  createApplicationPostgresSql(url: string, options?: ApplicationPostgresClientOptions): ApplicationPostgresSql;
  createApplicationPostgresDrizzle(url: string, options?: ApplicationPostgresClientOptions): {
    readonly client: ApplicationPostgresSql;
    readonly database: PostgresJsDatabase;
  };
}

let runtime: Promise<ApplicationPostgresRuntimeModule> | undefined;

async function loadApplicationPostgresRuntime(): Promise<ApplicationPostgresRuntimeModule> {
  // static-import-exception: the PostgreSQL wire client is an optional runtime adapter and must not inflate authoring-only installs.
  runtime ??= import('@applik8s/runtime-postgres/sql');
  return runtime;
}

export async function createApplicationPostgresSql(url: string, options?: ApplicationPostgresClientOptions): Promise<ApplicationPostgresSql> {
  return (await loadApplicationPostgresRuntime()).createApplicationPostgresSql(url, options);
}

export async function createApplicationPostgresDrizzle(url: string, options?: ApplicationPostgresClientOptions): Promise<{
  readonly client: ApplicationPostgresSql;
  readonly database: PostgresJsDatabase;
}> {
  return (await loadApplicationPostgresRuntime()).createApplicationPostgresDrizzle(url, options);
}
