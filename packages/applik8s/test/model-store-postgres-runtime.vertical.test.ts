import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationRuntimeModelContract } from '../src/application-models.js';
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
    await expect(client.delete({ id: 'note-1' })).resolves.toBeUndefined();
    await expect(client.get({ id: 'note-1' })).resolves.toBeUndefined();
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
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
