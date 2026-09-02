import type {
  ApplicationPostgresClientOptions,
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from '@applik8s/applik8s/postgres-runtime-contract';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  drizzle,
  PostgresJsSession,
  PostgresJsTransaction,
} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createApplicationPostgresSql(url: string, options: ApplicationPostgresClientOptions = {}): ApplicationPostgresSql {
  const native = postgres(url, options);
  return createApplicationPostgresSqlFromNative(native);
}

export function createApplicationPostgresDrizzle(url: string, options: ApplicationPostgresClientOptions = {}) {
  const native = postgres(url, options);
  return {
    client: createApplicationPostgresSqlFromNative(native),
    database: drizzle(native),
  };
}

// typecast-boundary: postgres-js and Drizzle expose mutually compatible
// runtime values with declarations that cannot express this decorated adapter.
function createApplicationPostgresSqlFromNative(
  native: ReturnType<typeof postgres>,
): ApplicationPostgresSql {
  const dialect = new PgDialect();
  return {
    // Preserve postgres-js's established command/runtime contract exactly.
    // typecast: postgres-js exposes a wider variadic generic than the stable
    // Applik8s SQL boundary, while their runtime call signatures are identical.
    unsafe: native.unsafe.bind(native) as ApplicationPostgresSql['unsafe'],
    json: native.json.bind(native),
    // typecast: adapt postgres-js's generic transaction callback once at the
    // provider boundary while preserving the framework's qualified contract.
    begin: ((operation: (
      transaction: ApplicationPostgresTransactionSql,
    ) => unknown) => native.begin(async (transaction) => {
      // Drizzle's public runtime constructors accept TransactionSql here, but
      // its declaration currently constrains PostgresJsSession to the root Sql
      // client. Reflect.construct keeps this adapter boundary honest at
      // runtime without spreading that inaccurate constraint into Applik8s.
      const session = Reflect.construct(PostgresJsSession, [
        transaction,
        dialect,
        undefined,
      ]);
      const database = Reflect.construct(PostgresJsTransaction, [
        dialect,
        session,
        undefined,
      ]);
      // Adapter-owned boundary: attach the Drizzle view without replacing or
      // wrapping the postgres-js transaction that the durable command kernel
      // has already qualified. PostgresJsTransaction uses savepoints for
      // nested relational.run()/transaction() calls.
      Object.defineProperty(transaction, 'database', {
        configurable: true,
        enumerable: false,
        value: database,
      });
      // typecast: the native transaction has just been decorated with the
      // Drizzle database required by ApplicationPostgresTransactionSql.
      return operation(
        transaction as unknown as ApplicationPostgresTransactionSql,
      );
    })) as ApplicationPostgresSql['begin'],
    end: native.end.bind(native),
  };
}
