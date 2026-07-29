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
}

export interface ApplicationPostgresClientOptions {
  readonly max?: number;
  readonly idle_timeout?: number;
  readonly connect_timeout?: number;
  readonly prepare?: boolean;
}
