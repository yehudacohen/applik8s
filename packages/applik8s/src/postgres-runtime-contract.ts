export interface ApplicationPostgresEndOptions {
  readonly timeout?: number;
}

export interface ApplicationPostgresSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  begin<TResult>(operation: (transaction: ApplicationPostgresTransactionSql) => Promise<TResult>): Promise<TResult>;
  end(options?: ApplicationPostgresEndOptions): Promise<void>;
}

export interface ApplicationPostgresTransactionSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  json(value: unknown): unknown;
  /**
   * Drizzle transaction bound to this exact PostgreSQL transaction. Runtime
   * adapters populate it so function-native views observe staged model writes
   * and use savepoints instead of opening an inconsistent sibling connection.
   */
  readonly database?: unknown;
}

export interface ApplicationPostgresClientOptions {
  readonly max?: number;
  readonly idle_timeout?: number;
  readonly connect_timeout?: number;
  readonly prepare?: boolean;
}
