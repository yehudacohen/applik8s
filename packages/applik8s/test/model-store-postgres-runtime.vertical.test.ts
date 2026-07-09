import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatedApplicationRuntimeModuleSource } from '../src/application-runtime-modules.js';
import { applicationModelMigrationPreflightSql, type ApplicationRuntimeModelContract } from '../src/application-models.js';
import { closePostgresModelClients, createPostgresModelClient } from '../src/model-store-postgres-runtime.js';

const liveDatabaseUrl = process.env.APPLIK8S_MODELSTORE_SCRIPT_RUNTIME_DATABASE_URL;

describe('Postgres ModelStore script runtime', () => {
  afterEach(async () => {
    delete process.env.APPLIK8S_MODEL_STORE_SCRIPT_NOTE_DATABASE_URL;
    delete process.env.APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL;
    await closePostgresModelClients();
  });

  it('fails closed with diagnostics when script execution has no database credentials', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const client = createPostgresModelClient<{ readonly message: string }>(scriptNoteModel('applik8s_script_note_missing_credentials'));

      await expect(client.create({ spec: { message: 'hello' } })).rejects.toMatchObject({
        statusCode: 500,
        message: expect.stringContaining('applik8s-modelstore-missing-credentials'),
        diagnostic: expect.objectContaining({
          event: 'applik8s-modelstore-missing-credentials',
          model: 'ScriptNote',
          env: 'APPLIK8S_MODEL_STORE_SCRIPT_NOTE_DATABASE_URL',
        }),
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('keeps generated and script runtime semantics aligned for the Postgres ModelStore contract', () => {
    const generated = generatedApplicationRuntimeModuleSource('modelRuntime');

    expect(generated).toContain('createPostgresModelClient');
    expect(generated).toContain("model.connectionEnvName + ':' + model.tableName");
    expect(generated).toContain('modelStatusPatch(existing.status, patch.status)');
    expect(generated).toContain('status: next.status ?? null');
    expect(generated).toContain('applik8s-modelstore-missing-credentials');
    expect(generated).toContain('applik8s-model-migration-missing');
    expect(generated).toContain('applik8s-model-duplicate-key');
    expect(generated).toContain('postgresCode: \'42P01\'');
    expect(generated).toContain('postgresCode: \'23505\'');
    expect(generated).toContain('Math.max(1, Math.min(Number(query.limit ?? 50), 500))');
    expect(generated).toContain('unsupported ordering fails closed');
    expect(generated).toContain('declared index orderBy fields');
    expect(generated).toContain('unsupported filters fail closed');
    expect(generated).toContain('unsupported index filters fail closed');
    expect(generated).toContain('async transaction(handler)');
    expect(generated).toContain('return modelDatabase(model).transaction');
    expect(generated).toContain('modelRetentionClauses(model)');
    expect(generated).toContain("model.retention?.mode !== 'ttl'");
    expect(generated).not.toContain('CREATE TABLE');
    expect(generated).not.toContain('CREATE TABLE IF NOT EXISTS');
    expect(generated).not.toContain('ensureModelTable');
  });

  it('implements transaction API while still failing closed for unsupported retention and undeclared index assumptions', async () => {
    const client = createPostgresModelClient<{ readonly message: string }>(scriptNoteModel('applik8s_script_note_contracts'));

    expect(Reflect.get(client, 'transaction')).toEqual(expect.any(Function));
    expect(Reflect.get(client, 'expire')).toBeUndefined();
    await expect(client.query({ orderBy: ['createdAt'] })).rejects.toThrow(/unsupported ordering fails closed/);
    // typecast: intentionally erase static query shape to verify runtime fail-closed validation for unsupported status filters.
    await expect(client.query({ where: { 'status.phase': 'Ready' } } as never)).rejects.toThrow(/unsupported filters fail closed/);
    // typecast: intentionally erase static query shape to verify runtime fail-closed validation for complex filter values.
    await expect(client.query({ where: { message: { contains: 'hello' } } as never })).rejects.toThrow(/unsupported filters fail closed/);
    await expect(client.index('undeclared').query('hello')).rejects.toThrow(/requires partitionBy before it can be queried/);
    await expect(client.index('byMessage', { partitionBy: 'message', filter: { message: 'hello' } }).query('hello')).rejects.toThrow(/unsupported index filters fail closed/);
    // typecast: intentionally erase static index query shape to verify runtime fail-closed validation for unsupported index query filters.
    await expect(client.index('byMessage', { partitionBy: 'message' }).query('hello', { where: { message: 'hello' } } as never)).rejects.toThrow(/unsupported index filters fail closed/);
    await expect(client.index('byMessage').query('hello', { orderBy: ['createdAt'] })).rejects.toThrow(/declared index orderBy fields/);
  });
});

describe.runIf(liveDatabaseUrl)('Postgres ModelStore script runtime live database behavior', () => {
  const tableName = `applik8s_script_live_note_${process.pid}`;
  const model = scriptNoteModel(tableName, 'APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL');
  const indexName = `script_live_note_message_${process.pid}`;
  let sql: postgres.Sql;

  beforeEach(async () => {
    process.env.APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL = liveDatabaseUrl;
    sql = postgres(liveDatabaseUrl ?? '', { max: 1 });
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(tableName)} (id text PRIMARY KEY, spec jsonb NOT NULL, status jsonb, revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await sql.unsafe(`CREATE UNIQUE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} ((spec->>'message'))`);
  });

  afterEach(async () => {
    await closePostgresModelClients();
    await sql?.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    await sql?.end({ timeout: 1 });
    delete process.env.APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  it('executes create, get, query, patch, delete, and index query against real Postgres storage', async () => {
    const client = createPostgresModelClient<{ readonly message: string }, { readonly phase?: string }>(model);

    const created = await client.create({ id: 'note-1', spec: { message: 'hello' } });
    expect(created).toMatchObject({ id: 'note-1', spec: { message: 'hello' } });
    await expect(client.get({ id: 'note-1' })).resolves.toMatchObject({ id: 'note-1', spec: { message: 'hello' } });
    await expect(client.query({ where: { message: 'hello' }, limit: 10 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'note-1' })] });
    await expect(client.patch({ id: 'note-1' }, { status: { phase: 'Accepted' } })).resolves.toMatchObject({ id: 'note-1', status: { phase: 'Accepted' } });
    await expect(client.index('byMessage', { partitionBy: 'message', unique: true }).query('hello')).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'note-1' })] });
    await expect(client.index('byMessage', { partitionBy: 'message', orderBy: ['createdAt'], unique: true }).query('hello', { orderBy: ['createdAt'] })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'note-1' })] });
    await expect(client.delete({ id: 'note-1' })).resolves.toBeUndefined();
    await expect(client.get({ id: 'note-1' })).resolves.toBeUndefined();
  });

  it('enforces query limits, explicit index partitions, duplicate constraints, and explicit-only retention against real Postgres storage', async () => {
    const client = createPostgresModelClient<{ readonly message: string }, { readonly phase?: string }>(model);

    await client.create({ id: 'retained-note', spec: { message: 'retained' } });
    await expect(client.index('missingPartition', {}).query('retained')).rejects.toThrow(/requires partitionBy before it can be queried/);
    await expect(client.query({ orderBy: ['createdAt'] })).rejects.toThrow(/unsupported ordering fails closed/);
    // typecast: intentionally erase static query shape to verify live runtime fail-closed validation for unsupported status filters.
    await expect(client.query({ where: { 'status.phase': 'Ready' } } as never)).rejects.toThrow(/unsupported filters fail closed/);
    await expect(client.query({ limit: 1000 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'retained-note' })] });
    await expect(client.get({ id: 'retained-note' })).resolves.toMatchObject({ id: 'retained-note' });
    await expect(client.create({ id: 'duplicate-retained-note', spec: { message: 'retained' } })).rejects.toMatchObject({
      statusCode: 409,
      diagnostic: expect.objectContaining({ event: 'applik8s-model-duplicate-key' }),
    });
    await client.delete({ id: 'retained-note' });
    await expect(client.get({ id: 'retained-note' })).resolves.toBeUndefined();
  });

  it('commits and rolls back multi-operation transactions against real Postgres storage', async () => {
    const client = createPostgresModelClient<{ readonly message: string }, { readonly phase?: string }>(model);

    await expect(client.transaction(async (transaction) => {
      await transaction.create({ id: 'tx-commit', spec: { message: 'committed' } });
      await transaction.patch({ id: 'tx-commit' }, { status: { phase: 'Committed' } });
      return 'committed';
    })).resolves.toBe('committed');
    await expect(client.get({ id: 'tx-commit' })).resolves.toMatchObject({ id: 'tx-commit', status: { phase: 'Committed' } });

    await expect(client.transaction(async (transaction) => {
      await transaction.create({ id: 'tx-rollback', spec: { message: 'rolled-back' } });
      throw new Error('rollback-intent');
    })).rejects.toThrow(/rollback-intent/);
    await expect(client.get({ id: 'tx-rollback' })).resolves.toBeUndefined();
  });

  it('filters expired ttl-retention objects from get and query against real Postgres storage', async () => {
    const ttlModel: ApplicationRuntimeModelContract = { ...model, retention: { mode: 'ttl', ttlSeconds: 60 } };
    const client = createPostgresModelClient<{ readonly message: string }, { readonly phase?: string }>(ttlModel);

    await client.create({ id: 'ttl-old', spec: { message: 'expired' } });
    await client.create({ id: 'ttl-new', spec: { message: 'fresh' } });
    await sql.unsafe(`UPDATE ${quoteIdentifier(tableName)} SET created_at = now() - interval '2 hours' WHERE id = 'ttl-old'`);

    await expect(client.get({ id: 'ttl-old' })).resolves.toBeUndefined();
    await expect(client.get({ id: 'ttl-new' })).resolves.toMatchObject({ id: 'ttl-new' });
    await expect(client.query({ limit: 10 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'ttl-new' })] });
    await expect(client.query({ where: { message: 'expired' } })).resolves.toMatchObject({ items: [] });
  });

  it('prefers the model-specific connection env over DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgres://invalid:invalid@127.0.0.1:1/invalid';
    process.env.APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL = liveDatabaseUrl;
    const client = createPostgresModelClient<{ readonly message: string }>(model);

    await expect(client.create({ id: 'note-env', spec: { message: 'env-specific' } })).resolves.toMatchObject({ id: 'note-env' });
  });

  it('maps missing migrated tables to migration diagnostics', async () => {
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    const client = createPostgresModelClient<{ readonly message: string }>(model);

    await expect(client.create({ id: 'missing-table', spec: { message: 'hello' } })).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('applik8s-model-migration-missing'),
      diagnostic: expect.objectContaining({ event: 'applik8s-model-migration-missing', model: 'ScriptNote', table: tableName, postgresCode: '42P01' }),
    });
  });

  it('maps database uniqueness violations to duplicate-key diagnostics', async () => {
    const client = createPostgresModelClient<{ readonly message: string }>(model);

    await client.create({ id: 'note-a', spec: { message: 'duplicate' } });
    await expect(client.create({ id: 'note-b', spec: { message: 'duplicate' } })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('applik8s-model-duplicate-key'),
      diagnostic: expect.objectContaining({ event: 'applik8s-model-duplicate-key', model: 'ScriptNote', postgresCode: '23505' }),
    });
  });

  it('fails migration preflight closed against existing schema drift before migration SQL runs', async () => {
    const driftTableName = `${tableName}_drift`;
    const driftModel = scriptNoteModel(driftTableName, 'APPLIK8S_MODEL_STORE_SCRIPT_LIVE_NOTE_DATABASE_URL');
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(driftTableName)}`);
    await sql.unsafe('CREATE TABLE IF NOT EXISTS "applik8s_model_migrations" (id text PRIMARY KEY, model text NOT NULL, revision text NOT NULL, plan jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(driftTableName)} (id text PRIMARY KEY, spec jsonb NOT NULL, status jsonb, revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), unmanaged text)`);

    try {
      await expect(sql.unsafe(applicationModelMigrationPreflightSql(driftModel))).rejects.toThrow(/applik8s-model-migration-drift-detected: unknownExistingObject/);
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(driftTableName)}`);
    }
  });
});

function scriptNoteModel(tableName: string, connectionEnvName = 'APPLIK8S_MODEL_STORE_SCRIPT_NOTE_DATABASE_URL'): ApplicationRuntimeModelContract {
  return {
    name: 'ScriptNote',
    tableName,
    provider: 'postgres',
    database: 'script_runtime',
    clusterName: 'script-runtime-db',
    secretName: 'script-runtime-db-app',
    secretKey: 'uri',
    connectionEnvName,
    constraints: [{ name: 'script-note-message-unique', kind: 'unique', fields: ['message'] }],
    indexes: [{ name: 'byMessage', fields: ['message'], unique: true }],
    retention: { mode: 'retain' },
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
