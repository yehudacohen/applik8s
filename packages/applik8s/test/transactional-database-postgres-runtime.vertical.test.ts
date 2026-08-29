// typecast-file-boundary: PostgreSQL vertical fixtures decode controlled fake result rows into the same runtime shapes used by the adapter.

import { type ApplicationExecutionPrincipal, createApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { type } from 'arktype';
import { sql as drizzleSql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';
import { app } from '../src/application.js';
import { withApplicationManagedEffects } from '../src/application-managed-effects.js';
import { runApplicationModelBeforeCommit } from '../src/application-model-policy.js';
import { type ApplicationRuntimeModelContract, applicationModelMigrationPreflightSql, applicationModelMigrationSql } from '../src/application-models.js';
import { generatedApplicationRuntimeModuleSource } from '../src/application-runtime-modules.js';
import { type ApplicationTelemetryBoundary, type ApplicationTelemetryRuntime, installApplicationTelemetryRuntimeResolver, runApplicationTelemetryBoundary } from '../src/application-telemetry-runtime.js';
import { applicationRequestContextValues } from '../src/command-principal.js';
import { type ApplicationMessageEnvelope, command, event } from '../src/dsl.js';
import { applicationPostgresModelReadClients, closePostgresModelCommandRuntime, DurableCommandRejectedError, executeFunctionNativePostgresModelEdit, executeFunctionNativePostgresTransaction, executePostgresModelCommand, type FunctionNativePostgresNestedOperation, isRetryablePostgresTransactionError, normalizePostgresNativeModelValue, type PostgresModelCommandEventDefinition, recordPostgresModelCommandTerminalFailure } from '../src/model-command-postgres-runtime.js';
import { applicationModelCommandBindingForOperation, nativeApplicationModelBindingFor, nativeApplicationModelCommandRegistrar } from '../src/native-models.js';
import { cleanupPostgresCommandData, observePostgresOutboxLag, relayPostgresCommandOutbox, relayPostgresEventOutbox } from '../src/postgres-outbox-runtime.js';
import { applicationRelationalFrameworkMigrationSql } from '../src/relational-runtime.js';
import { bindApplicationFunctionNativeOperationHandle, createApplicationFunctionNativeOperationHandle, runApplicationStreamProcessor } from '../src/stream-worker-runtime.js';
import { closePostgresModelClients, createPostgresModelClient } from '../src/transactional-database-postgres-runtime.js';

const liveDatabaseUrl = process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL;

describe('Postgres TransactionalDatabase script runtime', () => {
  it('retains bounded target and public policy context in rejection diagnostics', () => {
    const error = new DurableCommandRejectedError(
      {
        name: 'policyRejected',
        payload: { message: 'The card is outside the admitted workspace.' },
      },
      false,
      {
        commandId: 'command-1',
        correlationId: 'command-1',
        target: { model: 'Card', key: 'card-7' },
        phase: 'rejected',
        replayed: false,
        resultRevision: 'revision-1',
      },
    );
    expect(error.message).toBe(
      'applik8s-command-rejected: Card/card-7: policyRejected: The card is outside the admitted workspace.',
    );
    expect(error.message).not.toContain(JSON.stringify(error.rejection));
  });

  afterEach(async () => {
    delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_NOTE_DATABASE_URL;
    delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL;
    await closePostgresModelClients();
    await closePostgresModelCommandRuntime();
  });

  it('generates the durable command inbox, result, transition, history, and outbox schema', () => {
    const migration = applicationModelMigrationSql(scriptNoteModel('applik8s_script_note_commands'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_command_inbox"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_command_results"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_model_transitions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_model_history"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_event_outbox"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "applik8s_command_outbox"');
    expect(migration).toContain('PRIMARY KEY (application, revision, kind, reference_id)\n  );\n\nALTER TABLE applik8s_operation_catalog_references');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS operation_ids jsonb NOT NULL DEFAULT '[]'::jsonb;\n\nCREATE TABLE IF NOT EXISTS \"applik8s_model_migrations\"");
    expect(migration).toContain('WHERE published_at IS NULL');
    expect(migration).toContain('applik8s_command_inbox_cleanup');
    expect(migration).toContain('applik8s_event_outbox_cleanup');
  });

  it('classifies only PostgreSQL transaction-abort codes as safe whole-transaction retries', () => {
    expect(isRetryablePostgresTransactionError({ code: '40P01' })).toBe(true);
    expect(isRetryablePostgresTransactionError({ code: '40001' })).toBe(true);
    expect(isRetryablePostgresTransactionError({ code: '23505' })).toBe(false);
    expect(isRetryablePostgresTransactionError(new Error('connection failed'))).toBe(false);
  });

  it('passes compiler-owned identity through helper-mediated operation routing and one synchronous telemetry child', async () => {
    const operation = {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: 'GeneratedIdentity.create',
      model: 'GeneratedIdentity',
      name: 'create',
      operation: 'create',
      transport: 'command',
    } as const;
    const handle = createApplicationFunctionNativeOperationHandle<
      { readonly value: string },
      { readonly identity: string }
    >({
      operation,
      command: { id: 'models.GeneratedIdentity.create.v1' },
      key: (_input, _context, messageId) => messageId,
    });

    const boundaries: ApplicationTelemetryBoundary[] = [];
    const telemetry = recordingTelemetryRuntime(boundaries);
    const disposeTelemetry = installApplicationTelemetryRuntimeResolver(
      () => telemetry,
    );
    const invokeThroughHelper = (value: string) => handle({ value });
    try {
      const result = await runApplicationTelemetryBoundary({
        kind: 'http',
        identity: 'create-generated-identity',
        relationship: 'synchronous',
      }, () => withApplicationManagedEffects({
        commandId: 'source-event',
        routingContext: {},
        emit: () => {
          throw new Error('not used');
        },
        invoke: () => {
          throw new Error('not used');
        },
        async invokeAtomic(_operation, _input, route) {
          const routed = route('deterministic-nested-message');
          return { identity: routed.targetKey };
        },
      }, () => invokeThroughHelper('created')));

      expect(result).toEqual({ identity: 'deterministic-nested-message' });
      expect(boundaries).toEqual([
        expect.objectContaining({ kind: 'http', identity: 'create-generated-identity' }),
        expect.objectContaining({
          kind: 'operation',
          identity: 'GeneratedIdentity.create',
          definition: 'GeneratedIdentity.create',
          relationship: 'synchronous',
        }),
      ]);
    } finally {
      disposeTelemetry();
    }
  });

  it('uses queued delivery outside a managed edit and atomic delivery inside it', async () => {
    const calls: string[] = [];
    const operation = bindApplicationFunctionNativeOperationHandle(
      async ({ value }: { readonly value: string }) => {
        calls.push(`atomic:${value}`);
        return 'atomic';
      },
      async ({ value }: { readonly value: string }) => {
        calls.push(`queued:${value}`);
        return 'queued';
      },
    );

    await expect(operation({ value: 'outside' })).resolves.toBe('queued');
    await expect(withApplicationManagedEffects({
      commandId: 'transaction-1',
      routingContext: {},
      emit: () => { throw new Error('not used'); },
      invoke: () => { throw new Error('not used'); },
      invokeAtomic: async () => undefined,
    }, () => operation({ value: 'inside' }))).resolves.toBe('atomic');
    expect(calls).toEqual(['queued:outside', 'atomic:inside']);
  });

  it('normalizes provider-native timestamps to the logical JSON model representation', () => {
    const timestamp = new Date('2026-08-06T04:43:58.000Z');

    expect(normalizePostgresNativeModelValue({
      createdAt: timestamp,
      nested: [{ observedAt: timestamp }],
      retained: '2026-08-06T04:43:58.000Z',
    })).toEqual({
      createdAt: '2026-08-06T04:43:58.000Z',
      nested: [{ observedAt: '2026-08-06T04:43:58.000Z' }],
      retained: '2026-08-06T04:43:58.000Z',
    });
  });

  it('installs admitted RLS context before function-native model reads', async () => {
    const queries: { readonly query: string; readonly parameters?: readonly unknown[] }[] = [];
    const transaction = {
      async unsafe(query: string, parameters?: readonly unknown[]) {
        queries.push({ query, ...(parameters ? { parameters } : {}) });
        if (query.startsWith('SELECT * FROM')) {
          return [{
            id: 'note-1',
            principal_scope: 'workspace:trusted',
            message: 'visible',
            revision: 'revision-1',
          }];
        }
        return [];
      },
      json(value: unknown) { return value; },
    };
    const database = {
      async begin<TResult>(handler: (value: typeof transaction) => Promise<TResult>) {
        return handler(transaction);
      },
      async unsafe() { return []; },
      async end() {},
    };
    const scopedModel: ApplicationRuntimeModelContract = {
      name: 'ScopedRead',
      tableName: 'scoped_reads',
      provider: 'postgres',
      database: 'application',
      clusterName: 'application-db',
      secretName: 'application-db-app',
      secretKey: 'uri',
      connectionEnvName: 'APPLIK8S_DATABASE_APPLICATION_URL',
      constraints: [],
      indexes: [],
      retention: { mode: 'retain' },
      storageShape: 'native-relational',
      nativeRelational: {
        identity: { property: 'id', column: 'id' },
        revision: { property: 'revision', column: 'revision' },
        columns: [
          { property: 'id', column: 'id' },
          { property: 'principalScope', column: 'principal_scope' },
          { property: 'message', column: 'message' },
          { property: 'revision', column: 'revision' },
        ],
        access: {
          context: 'principalScope',
          setting: 'applik8s.test.principal_scope',
          property: 'principalScope',
          column: 'principal_scope',
        },
      },
    };

    const clients = await applicationPostgresModelReadClients(
      database,
      [scopedModel],
      {
        values: { principalScope: 'workspace:trusted' },
        digest: 'a'.repeat(64),
      },
    );
    await expect(clients.ScopedRead?.get({ id: 'note-1' })).resolves.toMatchObject({
      id: 'note-1',
      spec: { principalScope: 'workspace:trusted', message: 'visible' },
    });
    expect(queries.map(({ query }) => query)).toEqual([
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      expect.stringContaining('SELECT * FROM "scoped_reads"'),
    ]);
    expect(queries[2]?.parameters).toEqual([
      'applik8s.test.principal_scope',
      'workspace:trusted',
    ]);
  });

  it('restores PostgreSQL int8 strings using the compiled Drizzle number intent', () => {
    expect(normalizePostgresNativeModelValue('42', 'number')).toBe(42);
    expect(normalizePostgresNativeModelValue('42')).toBe('42');
  });

  it('persists an idempotent redacted terminal result without handler or model side effects', async () => {
    const queries: { readonly query: string; readonly parameters?: readonly unknown[] }[] = [];
    const transaction = {
      async unsafe(query: string, parameters?: readonly unknown[]) {
        queries.push({ query, ...(parameters ? { parameters } : {}) });
        return query.startsWith('SELECT scope FROM applik8s_command_results') ? [] : [];
      },
      json(value: unknown) { return value; },
    };
    const sql = { async begin(handler: (value: typeof transaction) => Promise<void>) { return handler(transaction); } } as unknown as postgres.Sql;
    await recordPostgresModelCommandTerminalFailure({
      bindingId: 'Account-create',
      command: { name: 'accounts.create', version: 'v1' },
      model: scriptNoteModel('accounts'),
      message: { id: 'command-1', input: { displayName: 'Ada' }, targetKey: 'account-1', idempotencyKey: 'once', context: { values: {}, digest: 'a'.repeat(64) } },
      sql,
    }, { code: 'processing_failed', attempts: 5 });

    expect(queries.map(({ query }) => query)).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      'SELECT scope FROM applik8s_command_results WHERE scope = $1 LIMIT 1',
      expect.stringContaining('INSERT INTO applik8s_command_inbox'),
      expect.stringContaining('INSERT INTO applik8s_command_results'),
    ]);
    const resultParameters = queries[3]?.parameters;
    expect(resultParameters?.[1]).toEqual({ name: 'internalFailure', payload: { code: 'processing_failed', attempts: 5 } });
    expect(JSON.stringify(queries)).not.toContain('Error');
    expect(queries.some(({ query }) => /model_transitions|event_outbox|model_changes/.test(query))).toBe(false);
  });

  it('fails closed with diagnostics when script execution has no database credentials', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const client = createPostgresModelClient<{ readonly message: string }>(scriptNoteModel('applik8s_script_note_missing_credentials'));

      await expect(client.create({ spec: { message: 'hello' } })).rejects.toMatchObject({
        statusCode: 500,
        message: expect.stringContaining('applik8s-transactional-database-missing-credentials'),
        diagnostic: expect.objectContaining({
          event: 'applik8s-transactional-database-missing-credentials',
          model: 'ScriptNote',
          env: 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_NOTE_DATABASE_URL',
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

  it('keeps generated and script runtime semantics aligned for the Postgres TransactionalDatabase contract', () => {
    const generated = generatedApplicationRuntimeModuleSource('modelRuntime');

    expect(generated).toContain('createPostgresModelClient');
    expect(generated).toContain("model.connectionEnvName + ':' + model.tableName");
    expect(generated).toContain('modelStatusPatch(existing.status, patch.status)');
    expect(generated).toContain('status: next.status ?? null');
    expect(generated).toContain('applik8s-transactional-database-missing-credentials');
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

describe.runIf(liveDatabaseUrl)('Postgres TransactionalDatabase script runtime live database behavior', () => {
  const tableName = `applik8s_script_live_note_${process.pid}`;
  const model = scriptNoteModel(tableName, 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL');
  const indexName = `script_live_note_message_${process.pid}`;
  let sql: postgres.Sql;

  beforeEach(async () => {
    process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL = liveDatabaseUrl;
    sql = postgres(liveDatabaseUrl ?? '', { max: 1 });
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(tableName)} (id text PRIMARY KEY, spec jsonb NOT NULL, status jsonb, revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await sql.unsafe(`CREATE UNIQUE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} ((spec->>'message'))`);
  });

  afterEach(async () => {
    await closePostgresModelClients();
    await closePostgresModelCommandRuntime();
    await sql?.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
    await sql?.end({ timeout: 1 });
    delete process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL;
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
    process.env.APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL = liveDatabaseUrl;
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

  it('commits model state, history, transitions, results, and event outbox atomically and replays duplicate results', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Live command transaction test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const commandModel = { ...scriptNoteModel(`${tableName}_commands`, 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL'), name: 'ScriptCommandNote' };
    const bindingId = `script-note-command-${process.pid}`;
    // The compiler decorates its internal lowering record without mutating the
    // public, deliberately frozen event handle.
    const NoteChanged = {
      ...event('note.changed.v1', { payload: type({ message: 'string' }) }),
      partition: (payload: object) => String(Reflect.get(payload, 'message')),
    } satisfies PostgresModelCommandEventDefinition;
    await sql.unsafe(applicationModelMigrationSql(commandModel));
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    const client = createPostgresModelClient<{ readonly message: string }>(commandModel);
    await client.create({ id: 'note-command-1', spec: { message: 'before' } });
    let invocations = 0;
    const execution = {
      bindingId,
      command: { name: 'note.rename', version: 'v1' },
      schemas: {
        input: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
        output: { type: 'object', properties: { previous: { type: 'string' }, current: { type: 'string' } }, required: ['previous', 'current'], additionalProperties: false },
        errors: { nameReserved: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false } },
      },
      model: commandModel,
      message: {
        id: 'message-1',
        input: { message: 'after' },
        targetKey: 'note-command-1',
        idempotencyKey: 'request-1',
        recordedAt: '2026-07-10T12:00:00.000Z',
        telemetry: telemetryCarrier('command:note.rename.v1', 'http:message-1'),
      },
      history: true,
      outbox: [NoteChanged],
      databaseUrl: liveDatabaseUrl,
      async handler(note: { readonly spec: { readonly message: string }; patch(patch: { readonly spec?: { readonly message?: string } }): void }, input: { readonly message: string }, context: { emit(eventDefinition: typeof NoteChanged, payload: { readonly message: string }): void }) {
        invocations += 1;
        const previous = note.spec.message;
        note.patch({ spec: { message: input.message } });
        context.emit(NoteChanged, { message: input.message });
        return { previous, current: input.message };
      },
    };

    const modelBoundaries: ApplicationTelemetryBoundary[] = [];
    const telemetryRuntime = recordingTelemetryRuntime(modelBoundaries);
    const disposeTelemetry = installApplicationTelemetryRuntimeResolver(
      () => telemetryRuntime,
    );
    const first = await executePostgresModelCommand(execution);
    const duplicate = await executePostgresModelCommand(execution);
    disposeTelemetry();

    expect(first).toMatchObject({ replayed: false, output: { previous: 'before', current: 'after' }, model: { spec: { message: 'after' } }, events: [expect.objectContaining({ contract: { name: 'note.changed', version: 'v1' }, causationId: 'message-1', recordedAt: '2026-07-10T12:00:00.000Z', partitionKey: 'after' })] });
    expect(duplicate).toMatchObject({ replayed: true, output: first.output, model: { spec: { message: 'after' } }, events: [] });
    expect(first.observation).toEqual({ commandId: 'message-1', correlationId: 'message-1', target: { model: 'ScriptCommandNote', key: 'note-command-1' }, phase: 'completed', replayed: false, resultRevision: first.model.revision, stateRevision: { authority: 'model', model: 'ScriptCommandNote', target: 'note-command-1', revision: first.model.revision } });
    expect(first.events[0]).toMatchObject({ stateRevision: first.observation.stateRevision });
    expect(first.events[0]?.telemetry).toMatchObject({
      identity: {
        operation: bindingId,
        execution: 'model:message-1',
        attempt: 1,
      },
      invocation: { kind: 'live', relationship: 'asynchronous' },
    });
    expect(first.events[0]?.telemetry).not.toEqual(execution.message.telemetry);
    expect(duplicate.observation).toEqual({ ...first.observation, replayed: true });
    expect(modelBoundaries).toHaveLength(1);
    expect(invocations).toBe(1);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId])).resolves.toMatchObject([{ count: 1 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_model_transitions WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 1 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_model_history WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 1 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 1 }]);
    await expect(sql.unsafe('SELECT partition_key FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toEqual([{ partition_key: 'after' }]);
    await expect(sql.unsafe("SELECT envelope->'telemetry' AS telemetry FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)", [bindingId])).resolves.toEqual([{ telemetry: first.events[0]?.telemetry }]);

    const publishedEvents: Array<ApplicationMessageEnvelope<object>> = [];
    await expect(relayPostgresEventOutbox({
      databaseUrl: liveDatabaseUrl,
      eventLog: {
        async publish(envelope) {
          publishedEvents.push(envelope);
          return { stream: 'events', sequence: 1, duplicate: false, subject: 'events.note.changed.v1', messageId: envelope.id };
        },
      },
    })).resolves.toMatchObject({ selected: 1, published: 1, duplicates: 0 });
    expect(publishedEvents).toEqual([expect.objectContaining({
      id: first.events[0]?.id,
      telemetry: first.events[0]?.telemetry,
    })]);

    const sourceEvent = publishedEvents[0];
    const producerTelemetry = first.events[0]?.telemetry;
    const sourceMessage = sourceEvent?.payload
      ? Reflect.get(sourceEvent.payload, 'message')
      : undefined;
    if (!sourceEvent || !producerTelemetry || typeof sourceMessage !== 'string') {
      throw new Error('The committed event and its producer carrier are required for processor propagation evidence.');
    }
    let processorCheckpoint = 0;
    let processorInvocations = 0;
    const disposeProcessorTelemetry = installApplicationTelemetryRuntimeResolver(
      () => telemetryRuntime,
    );
    try {
      await expect(runApplicationStreamProcessor({
        processor: 'note-index',
        streamName: 'note.changed.v1',
        source: {
          async read(afterSequence) {
            return afterSequence >= 1
              ? { items: [], nextSequence: 1, exhausted: true, retentionFloor: 0 }
              : {
                  items: [{
                    id: String(sourceEvent.id),
                    stream: { name: 'note.changed', version: 'v1' },
                    sequence: 1,
                    partitionKey: String(sourceEvent.partitionKey),
                    recordedAt: String(sourceEvent.recordedAt),
                    telemetry: producerTelemetry,
                    payload: { message: sourceMessage },
                  }],
                  nextSequence: 1,
                  exhausted: true,
                  retentionFloor: 0,
                };
          },
        },
        store: {
          async prepare() {},
          async checkpoint() { return processorCheckpoint; },
          async advance(_processor, _stream, sequence) { processorCheckpoint = sequence; },
          async deadLetter() {},
          async close() {},
        },
        // typecast: this causal-propagation fixture does not exercise admission;
        // dedicated processor tests prove the canonical admitted context.
        admit: async () => ({}) as never,
        async handle() {
          processorInvocations += 1;
          if (processorInvocations === 1) throw new Error('retry the emitted worker once');
        },
        concurrency: 1,
        retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
        failure: 'pause',
        timeoutMs: 1_000,
        maxInputBytes: 1_000,
      })).resolves.toMatchObject({ processed: 1, checkpoint: 1, exhausted: true });
    } finally {
      disposeProcessorTelemetry();
    }
    expect(modelBoundaries).toHaveLength(3);
    expect(modelBoundaries.slice(1)).toEqual([
      expect.objectContaining({
        kind: 'processor', identity: 'note-index',
        execution: `processor:note-index:${String(sourceEvent.id)}`,
        attempt: 1, invocation: 'live', relationship: 'asynchronous',
        links: [producerTelemetry],
      }),
      expect.objectContaining({
        kind: 'processor', identity: 'note-index',
        execution: `processor:note-index:${String(sourceEvent.id)}`,
        attempt: 2, invocation: 'retry', relationship: 'asynchronous',
        links: [producerTelemetry],
      }),
    ]);
    expect(processorInvocations).toBe(2);

    let createInvocations = 0;
    const createExistingExecution = {
      ...execution,
      operation: 'create' as const,
      bindingId: `${bindingId}-create`,
      command: { name: 'models.ScriptCommandNote.create', version: 'v1' },
      message: {
        ...execution.message,
        id: 'message-create-existing',
        input: { message: 'must-not-overwrite' },
        idempotencyKey: 'request-create-existing',
      },
      initialize: (input: { readonly message: string }) => input,
      async handler() {
        createInvocations += 1;
        return { previous: 'missing', current: 'must-not-overwrite' };
      },
    };
    await expect(
      executePostgresModelCommand(createExistingExecution),
    ).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: false,
      rejection: {
        name: 'targetExists',
        payload: {
          model: 'ScriptCommandNote',
          targetKey: 'note-command-1',
        },
      },
      observation: expect.objectContaining({
        phase: 'rejected',
        stateRevision: first.observation.stateRevision,
      }),
    });
    await expect(
      executePostgresModelCommand(createExistingExecution),
    ).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: true,
      rejection: { name: 'targetExists' },
    });
    expect(createInvocations).toBe(0);
    await expect(client.get({ id: 'note-command-1' })).resolves.toMatchObject({
      spec: { message: 'after' },
      revision: first.model.revision,
    });

    const conflictExecution = {
      ...execution,
      message: { ...execution.message, id: 'message-conflict', idempotencyKey: 'request-conflict', expectedRevision: 'stale-revision' },
    };
    await expect(executePostgresModelCommand(conflictExecution)).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: false,
      rejection: { name: 'revisionConflict', payload: { expectedRevision: 'stale-revision', actualRevision: first.model.revision } },
      observation: expect.objectContaining({ commandId: 'message-conflict', target: { model: 'ScriptCommandNote', key: 'note-command-1' }, phase: 'rejected', resultRevision: first.model.revision, stateRevision: { authority: 'model', model: 'ScriptCommandNote', target: 'note-command-1', revision: first.model.revision } }),
    });
    await expect(executePostgresModelCommand(conflictExecution)).rejects.toMatchObject({
      replayed: true,
      rejection: { name: 'revisionConflict' },
      observation: expect.objectContaining({ commandId: 'message-conflict', target: { model: 'ScriptCommandNote', key: 'note-command-1' }, phase: 'rejected', resultRevision: first.model.revision }),
    });

    const rejectedExecution = {
      ...execution,
      message: { ...execution.message, id: 'message-rejected', idempotencyKey: 'request-rejected' },
      errors: ['nameReserved'],
      async handler(_note: { readonly spec: { readonly message: string } }, _input: { readonly message: string }, context: { reject(name: 'nameReserved', payload: { readonly reason: string }): never }) {
        context.reject('nameReserved', { reason: 'reserved' });
      },
    };
    await expect(executePostgresModelCommand(rejectedExecution)).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: false,
      rejection: { name: 'nameReserved', payload: { reason: 'reserved' } },
      observation: expect.objectContaining({ commandId: 'message-rejected', correlationId: 'message-rejected', phase: 'rejected', replayed: false, resultRevision: expect.any(String), stateRevision: expect.objectContaining({ authority: 'model', model: 'ScriptCommandNote', target: 'note-command-1' }) }),
    });
    await expect(executePostgresModelCommand(rejectedExecution)).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: true,
      rejection: { name: 'nameReserved', payload: { reason: 'reserved' } },
      observation: expect.objectContaining({ commandId: 'message-rejected', correlationId: 'message-rejected', phase: 'rejected', replayed: true, resultRevision: expect.any(String) }),
    });
    await expect(sql.unsafe("SELECT count(*)::int AS count FROM applik8s_command_results WHERE error ->> 'name' = 'nameReserved'", [])).resolves.toMatchObject([{ count: 1 }]);

    const transientPolicyFailure = Object.assign(
      new Error('serialization retry required'),
      { code: '40001' },
    );
    const transientPolicyExecution = {
      ...execution,
      retry: { mode: 'never' as const },
      message: {
        ...execution.message,
        id: 'message-transient-policy-failure',
        idempotencyKey: 'request-transient-policy-failure',
      },
      errors: ['policyRejected'],
      schemas: {
        ...execution.schemas,
        errors: {
          policyRejected: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      },
      async handler() {
        await runApplicationModelBeforeCommit(() => {
          throw transientPolicyFailure;
        });
        return { previous: 'before', current: 'after' };
      },
    };
    await expect(executePostgresModelCommand(transientPolicyExecution)).rejects.toBe(
      transientPolicyFailure,
    );

    const invalidOutputExecution = {
      ...execution,
      message: { ...execution.message, id: 'message-invalid-output', idempotencyKey: 'request-invalid-output' },
      async handler() {
        // typecast: this malformed handler result deliberately bypasses its compile-time output contract to test rollback.
        return { previous: 1, current: 'after' } as never;
      },
    };
    await expect(executePostgresModelCommand(invalidOutputExecution)).rejects.toThrow(/applik8s-message-schema-invalid.*output/);

    const invalidRejectionExecution = {
      ...execution,
      message: { ...execution.message, id: 'message-invalid-rejection', idempotencyKey: 'request-invalid-rejection' },
      errors: ['nameReserved'],
      async handler(_note: unknown, _input: unknown, context: { reject(name: string, payload: object): never }) {
        context.reject('nameReserved', { reason: 1 });
      },
    };
    await expect(executePostgresModelCommand(invalidRejectionExecution)).rejects.toThrow(/applik8s-message-schema-invalid.*errors\.nameReserved/);
    const preCommitContextDigest = 'a'.repeat(64);
    const authorizationReceipt = {
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1' as const,
      application: 'test',
      id: 'receipt-pre-commit-denied',
      operationId: 'applik8s://models/ScriptCommandNote/operations/rename' as const,
      operationVersion: 'v1',
      catalogRevision: 'catalog-pre-commit',
      authorityRevision: 'authority-pre-commit',
      principal: {
        id: 'principal:user-1',
        identity: { id: 'identity:user-1', kind: 'human' as const, issuer: 'test', subject: 'user-1' },
        kind: 'human' as const,
        authenticationMethod: 'test',
        audience: ['script-command'],
        trustedContextDigest: preCommitContextDigest,
        catalogRevision: 'catalog-pre-commit',
        authorityRevision: 'authority-pre-commit',
        admittedAt: '2026-07-10T12:00:00.000Z',
      },
      trustedContextDigest: preCommitContextDigest,
      matchedPermissionIds: [],
      matchedGrantIds: [],
      inputDigest: 'sha256:pre-commit-input',
      target: { kind: 'target' as const, model: 'ScriptCommandNote', identity: { id: 'note-command-1' } },
      scopeEvidence: [],
      audience: 'script-command',
      transport: 'http' as const,
      admittedAt: '2026-07-10T12:00:00.000Z',
    };
    let preCommitTransactionObserved = false;
    const preCommitDeniedExecution = {
      ...execution,
      message: {
        ...execution.message,
        id: 'message-pre-commit-denied',
        idempotencyKey: 'request-pre-commit-denied',
        authorizationReceipt,
        context: { values: {}, digest: preCommitContextDigest },
      },
      async handler(note: { readonly spec: { readonly message: string }; patch(patch: { readonly spec: { readonly message?: string } }): void }) {
        note.patch({ spec: { message: 'must-not-commit' } });
        return { previous: note.spec.message, current: 'must-not-commit' };
      },
      async revalidateAuthorization(
        _receipt: import('@applik8s/core').ApplicationAuthorizationReceipt,
        boundary: 'pre-commit',
        context: {
          readonly transaction: import('../src/postgres-runtime-contract.js').ApplicationPostgresTransactionSql;
          readonly trustedContextDigest: string;
        },
      ) {
        expect(boundary).toBe('pre-commit');
        await context.transaction.unsafe('SELECT 1 AS pre_commit_authority_check');
        preCommitTransactionObserved = true;
        return { allowed: false as const, code: 'AUTHORIZATION_GRANT_REVOKED', message: 'revoked before commit' };
      },
    };
    const deniedBoundaries: ApplicationTelemetryBoundary[] = [];
    const deniedCompletions: Array<{
      readonly boundary: ApplicationTelemetryBoundary;
      readonly result: 'ok' | 'error';
      readonly errorType?: string;
    }> = [];
    const deniedTelemetryRuntime = recordingTelemetryRuntime(
      deniedBoundaries,
      deniedCompletions,
    );
    const disposeDeniedTelemetry = installApplicationTelemetryRuntimeResolver(
      () => deniedTelemetryRuntime,
    );
    try {
      await expect(executePostgresModelCommand(preCommitDeniedExecution)).rejects.toMatchObject({
        code: 'applik8s-command-rejected',
        rejection: {
          name: 'internalFailure',
          payload: {
            code: 'authorization_denied',
            attempts: 1,
            authorizationCode: 'AUTHORIZATION_GRANT_REVOKED',
          },
        },
      });
    } finally {
      disposeDeniedTelemetry();
    }
    expect(deniedBoundaries).toEqual([
      expect.objectContaining({
        kind: 'model',
        identity: bindingId,
        attempt: 1,
        invocation: 'live',
      }),
    ]);
    expect(deniedCompletions).toEqual([
      expect.objectContaining({
        result: 'error',
        errorType: 'ApplicationModelRejected',
      }),
    ]);
    expect(preCommitTransactionObserved).toBe(true);
    await expect(client.get({ id: 'note-command-1' })).resolves.toMatchObject({ spec: { message: 'after' } });
    await expect(sql.unsafe(
      `SELECT result.error
       FROM applik8s_command_results result
       JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope
       WHERE inbox.message_id = 'message-pre-commit-denied'`,
    )).resolves.toMatchObject([{
      error: {
        name: 'internalFailure',
        payload: expect.objectContaining({ code: 'authorization_denied' }),
      },
    }]);
    await expect(sql.unsafe(
      `SELECT count(*)::int AS count
       FROM applik8s_model_transitions transition
       JOIN applik8s_command_inbox inbox ON inbox.scope = transition.scope
       WHERE inbox.message_id = 'message-pre-commit-denied'`,
    )).resolves.toEqual([{ count: 0 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId])).resolves.toMatchObject([{ count: 4 }]);
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(commandModel.tableName)}`);
  });

  it('hydrates a native create access column from trusted context before the RLS-checked insert', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Native command RLS creation test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const rlsTable = `applik8s_native_command_rls_${process.pid}`;
    const bindingId = `native-command-rls-${process.pid}`;
    const rlsModel: ApplicationRuntimeModelContract = {
      name: 'NativeCommandRls',
      tableName: rlsTable,
      provider: 'postgres',
      database: 'script_runtime',
      clusterName: 'script-runtime-db',
      secretName: 'script-runtime-db-app',
      secretKey: 'uri',
      connectionEnvName: 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL',
      constraints: [],
      indexes: [],
      retention: { mode: 'retain' },
      storageShape: 'native-relational',
      nativeRelational: {
        identity: { property: 'id', column: 'id' },
        revision: { property: 'revision', column: 'revision' },
        columns: [
          { property: 'id', column: 'id' },
          { property: 'principalScope', column: 'principal_scope' },
          { property: 'message', column: 'message' },
          { property: 'revision', column: 'revision' },
        ],
        access: {
          context: 'principalScope',
          setting: 'applik8s.test.principal_scope',
          property: 'principalScope',
          column: 'principal_scope',
        },
      },
    };
    await sql.unsafe(applicationModelMigrationSql(rlsModel));
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(rlsTable)}`);
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(rlsTable)} (id text PRIMARY KEY, principal_scope text NOT NULL, message text NOT NULL, revision text NOT NULL)`);
    await sql.unsafe(`ALTER TABLE ${quoteIdentifier(rlsTable)} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`ALTER TABLE ${quoteIdentifier(rlsTable)} FORCE ROW LEVEL SECURITY`);
    await sql.unsafe(`CREATE POLICY ${quoteIdentifier(`${rlsTable}_scope`)} ON ${quoteIdentifier(rlsTable)} USING (principal_scope = current_setting('applik8s.test.principal_scope', true)) WITH CHECK (principal_scope = current_setting('applik8s.test.principal_scope', true))`);
    try {
      const result = await executePostgresModelCommand({
        bindingId,
        operation: 'create',
        command: { name: 'models.NativeCommandRls.create', version: 'v1' },
        model: rlsModel,
        message: {
          id: 'native-command-rls-create',
          input: { message: 'created' },
          targetKey: 'native-command-rls-row',
          idempotencyKey: 'native-command-rls-create',
          context: {
            values: { principalScope: 'workspace:trusted' },
            digest: 'f'.repeat(64),
            changeScopes: {
              global: 'a'.repeat(64),
              'context:principalScope': 'b'.repeat(64),
            },
          },
        },
        initialize: (input: { readonly message: string }) => ({
          id: 'native-command-rls-row',
          // This deliberately models a schema default that cannot know the
          // selected workspace. The framework must replace it before INSERT.
          principalScope: 'principal:default',
          message: input.message,
          revision: '',
        }),
        databaseUrl: liveDatabaseUrl,
        async handler(target) {
          expect(target.spec.principalScope).toBe('workspace:trusted');
          return { principalScope: target.spec.principalScope };
        },
      });

      expect(result.model.spec).toMatchObject({
        principalScope: 'workspace:trusted',
        message: 'created',
      });
    } finally {
      await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(rlsTable)}`);
    }
  });

  it('executes function-native Model.edit through the same durable transaction and duplicate-recovery kernel', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Function-native model edit test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const bindingId = `function-native-script-note-${process.pid}`;
    const FunctionNativeChanged = {
      ...event('function-native-note.changed.v1', {
        payload: type({ id: 'string', message: 'string' }),
      }),
      partition: (payload: object) => String(Reflect.get(payload, 'id')),
    } satisfies PostgresModelCommandEventDefinition;
    await sql.unsafe(applicationModelMigrationSql(model));
    await sql.unsafe(
      'DELETE FROM applik8s_command_inbox WHERE binding_id = $1',
      [bindingId],
    );
    const client = createPostgresModelClient<{ readonly message: string }>(
      model,
    );
    await client.create({
      id: 'function-native-note',
      spec: { message: 'before' },
    });
    let invocations = 0;
    const execution = {
      bindingId,
      model,
      models: [model],
      outbox: [FunctionNativeChanged],
      databaseUrl: liveDatabaseUrl,
      delivery: {
        id: 'function-native-event-1',
        idempotencyKey: 'function-native-event-1',
        correlationId: 'function-native-event-1',
        causationId: 'function-native-event-1',
        recordedAt: '2026-08-02T00:00:00.000Z',
      },
    };
    const request = {
      model: 'ScriptNote',
      identity: 'function-native-note',
      async handler(note: {
        readonly identity: string;
        readonly message: string;
        update(patch: { readonly message?: string }): Promise<void>;
      }) {
        invocations += 1;
        await note.update({ message: 'after' });
        FunctionNativeChanged.emit({
          id: note.identity,
          message: note.message,
        });
        return { id: note.identity, message: note.message };
      },
    };

    const first = await executeFunctionNativePostgresModelEdit(
      execution,
      request,
    );
    const duplicate = await executeFunctionNativePostgresModelEdit(
      execution,
      request,
    );

    expect(first).toEqual({
      id: 'function-native-note',
      message: 'after',
    });
    expect(duplicate).toEqual(first);
    expect(invocations).toBe(1);
    await expect(client.get({ id: 'function-native-note' })).resolves.toMatchObject({
      spec: { message: 'after' },
    });
    await expect(sql.unsafe(
      'SELECT count(*)::int AS count FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)',
      [bindingId],
    )).resolves.toEqual([{ count: 1 }]);
    await sql.unsafe(
      'DELETE FROM applik8s_command_inbox WHERE binding_id = $1',
      [bindingId],
    );
  });

  it('returns provisional nested-operation results and commits or rolls them back with the lifecycle transaction', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Function-native nested-operation test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const atomicModel = {
      ...scriptNoteModel(
        `applik8s_function_native_atomic_${process.pid}`,
        'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL',
      ),
      name: 'ScriptAtomicNote',
    };
    const createBindingId = `function-native-atomic-create-${process.pid}`;
    const updateBindingId = `function-native-atomic-update-${process.pid}`;
    await sql.unsafe(applicationModelMigrationSql(atomicModel));
    await sql.unsafe(
      'DELETE FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[])',
      [[createBindingId, updateBindingId]],
    );
    const client = createPostgresModelClient<{ readonly message: string }>(
      atomicModel,
    );
    const admittedPrincipal = testApplicationPrincipal('atomic-author', {
      authorityRevision: 'atomic-authority-v1',
      trustedContext: { tenantId: 'atomic-tenant' },
    });
    const admittedContext = {
      values: applicationRequestContextValues(
        admittedPrincipal,
        'atomic-authority-v1',
        { tenantId: 'atomic-tenant' },
      ),
      digest: 'e'.repeat(64),
    } as const;
    let createInvocations = 0;
    let updateInvocations = 0;
    const observedPrincipals: string[] = [];
    const observedTenants: string[] = [];
    const operation = (
      operationId: string,
      bindingId: string,
      kind: 'create' | 'update',
    ): FunctionNativePostgresNestedOperation => ({
      operationId,
      bindingId,
      operation: kind,
      command: { name: operationId.slice(0, -3), version: 'v1' },
      errors: [],
      schemas: {
        input: {},
        output: {},
        errors: {},
        events: {},
        commands: {},
      },
      model: atomicModel,
      models: [atomicModel],
      selfRead: false,
      historyModels: [],
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 },
      history: false,
      outbox: [],
      commands: [],
      ordering: 'serial',
      ...(kind === 'create'
        ? {
            initialize: (input: object) => ({ message: String(Reflect.get(input, 'message')) }),
          }
        : {}),
      async handler(target, input, context) {
        const message = String(Reflect.get(input, 'message'));
        if (context.principal?.id) observedPrincipals.push(context.principal.id);
        const tenantId = context.trustedContext.tenantId;
        if (typeof tenantId === 'string') observedTenants.push(tenantId);
        if (kind === 'create') createInvocations += 1;
        else {
          updateInvocations += 1;
          target.patch({ spec: { message } });
        }
        return { identity: target.id, value: target.spec };
      },
    });
    const createId = 'models.ScriptAtomicNote.create.v1';
    const updateId = 'models.ScriptAtomicNote.update.v1';
    const operations = [
      operation(createId, createBindingId, 'create'),
      operation(updateId, updateBindingId, 'update'),
    ];
    const createNote = createApplicationFunctionNativeOperationHandle<
      { readonly id: string; readonly message: string },
      { readonly identity: string; readonly value: { readonly message: string }; readonly revision?: string }
    >({
      operation: {
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: createId,
        model: atomicModel.name,
        name: 'create',
        operation: 'create',
        transport: 'command',
      },
      command: { id: createId },
      key: (input) => input.id,
    });
    const updateNote = createApplicationFunctionNativeOperationHandle<
      { readonly id: string; readonly message: string },
      { readonly identity: string; readonly value: { readonly message: string }; readonly revision?: string }
    >({
      operation: {
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: updateId,
        model: atomicModel.name,
        name: 'update',
        operation: 'update',
        transport: 'command',
      },
      command: { id: updateId },
      key: (input) => input.id,
    });
    const AmbientChanged = {
      ...event('function-native-ambient.changed.v1', {
        payload: type({ id: 'string', message: 'string' }),
      }),
      partition: (payload: object) => String(Reflect.get(payload, 'id')),
    } satisfies PostgresModelCommandEventDefinition;
    await sql.unsafe(
      'DELETE FROM applik8s_public_stream_events WHERE contract_name = $1 AND contract_version = $2',
      [AmbientChanged.name, AmbientChanged.version],
    );
    const execution = {
      bindingId: `function-native-atomic-lifecycle-${process.pid}`,
      databaseUrl: liveDatabaseUrl,
      connectionModel: atomicModel,
      operations,
      outbox: [AmbientChanged],
      delivery: {
        id: 'function-native-atomic-event-1',
        idempotencyKey: 'function-native-atomic-event-1',
        recordedAt: '2026-08-09T00:00:00.000Z',
        context: admittedContext,
      },
    };
    const invoke = () => executeFunctionNativePostgresTransaction(
      execution,
      async () => {
        const created = await createNote({ id: 'atomic-note', message: 'created' });
        expect(created).toMatchObject({
          identity: 'atomic-note',
          value: { message: 'created' },
          revision: expect.any(String),
        });
        const updated = await updateNote({ id: created.identity, message: 'updated' });
        AmbientChanged.emit({
          id: updated.identity,
          message: updated.value.message,
        });
        expect(updated).toMatchObject({
          identity: 'atomic-note',
          value: { message: 'updated' },
          revision: expect.any(String),
        });
        return updated;
      },
    );

    await expect(invoke()).resolves.toMatchObject({
      identity: 'atomic-note',
      value: { message: 'updated' },
      revision: expect.any(String),
    });
    await expect(invoke()).resolves.toMatchObject({
      identity: 'atomic-note',
      value: { message: 'updated' },
      revision: expect.any(String),
    });
    expect(createInvocations).toBe(1);
    expect(updateInvocations).toBe(1);
    expect(observedPrincipals).toEqual([
      admittedPrincipal.id,
      admittedPrincipal.id,
    ]);
    expect(observedTenants).toEqual(['atomic-tenant', 'atomic-tenant']);
    await expect(sql.unsafe(
      'SELECT count(*)::int AS count FROM applik8s_event_outbox WHERE contract_name = $1 AND contract_version = $2',
      ['function-native-ambient.changed', 'v1'],
    )).resolves.toEqual([{ count: 1 }]);
    await expect(sql.unsafe(
      'SELECT count(*)::int AS count FROM applik8s_public_stream_events WHERE contract_name = $1 AND contract_version = $2',
      ['function-native-ambient.changed', 'v1'],
    )).resolves.toEqual([{ count: 1 }]);
    await expect(executeFunctionNativePostgresTransaction(
      execution,
      async () => {
        AmbientChanged.emit({ id: 'atomic-note', message: 'conflicting-replay' });
      },
    )).rejects.toThrow(/applik8s-function-native-event-idempotency-conflict/);
    await expect(client.get({ id: 'atomic-note' })).resolves.toMatchObject({
      spec: { message: 'updated' },
    });

    await expect(executeFunctionNativePostgresTransaction(
      {
        ...execution,
        delivery: {
          id: 'function-native-atomic-event-rollback',
          idempotencyKey: 'function-native-atomic-event-rollback',
        },
      },
      async () => {
        await createNote({ id: 'rolled-back-note', message: 'temporary' });
        AmbientChanged.emit({ id: 'rolled-back-note', message: 'temporary' });
        throw new Error('rollback-after-provisional-result');
      },
    )).rejects.toThrow(/rollback-after-provisional-result/);
    await expect(client.get({ id: 'rolled-back-note' })).resolves.toBeUndefined();
    await expect(sql.unsafe(
      'SELECT count(*)::int AS count FROM applik8s_command_inbox WHERE binding_id = $1 AND target_key = $2',
      [createBindingId, 'rolled-back-note'],
    )).resolves.toEqual([{ count: 0 }]);
    await expect(sql.unsafe(
      'SELECT count(*)::int AS count FROM applik8s_event_outbox WHERE contract_name = $1 AND contract_version = $2 AND partition_key = $3',
      ['function-native-ambient.changed', 'v1', 'rolled-back-note'],
    )).resolves.toEqual([{ count: 0 }]);

    await sql.unsafe(
      'DELETE FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[])',
      [[createBindingId, updateBindingId, execution.bindingId]],
    );
    await sql.unsafe(
      'DELETE FROM applik8s_public_stream_events WHERE contract_name = $1 AND contract_version = $2',
      [AmbientChanged.name, AmbientChanged.version],
    );
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(atomicModel.tableName)}`);
  });

  it('executes direct native create, update, and delete operations with committed lifecycle events and replay', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Live direct native CRUD test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const directTableName = `applik8s_direct_card_${process.pid}`;
    const cards = pgTable(directTableName, {
      id: text('id').primaryKey(),
      title: text('title').notNull(),
      ownerId: text('owner_id').notNull().default(drizzleSql<string>`nullif(current_setting('applik8s.principal.id', true), '')`),
      causalOwnerId: text('causal_owner_id').notNull().default(drizzleSql<string>`nullif(current_setting('applik8s.principal.causal_id', true), '')`),
      revision: text('revision').notNull(),
    });
    const direct = app(`direct-native-${process.pid}`);
    const Database = direct.database.postgres('direct-native', { schema: { cards } });
    const CardBase = direct.model(cards, { name: `DirectCard${process.pid}`, database: Database, revision: 'revision' });
    CardBase.create.beforeCommit({ history: true }, async (_card, input) => {
      if (input.title === 'policy-rejected') {
        throw new Error('Card title is rejected by policy.');
      }
    });
    const ArchiveCard = command(`direct-card-${process.pid}.archive.v1`, {
      input: type({ cardId: 'string' }),
      output: type({ archived: 'boolean' }),
    });
    const archive = nativeApplicationModelCommandRegistrar(CardBase)!(ArchiveCard, {
      key: ({ cardId }) => cardId,
      history: true,
    }, async (card) => {
      card.patch({ spec: { title: 'archived' } });
      return { archived: true };
    });
    const Card = CardBase;
    const model = nativeApplicationModelBindingFor(Card);
    const create = applicationModelCommandBindingForOperation(Card.create);
    const update = applicationModelCommandBindingForOperation(Card.update);
    const remove = applicationModelCommandBindingForOperation(Card.delete);
    const requestingPrincipal = testApplicationPrincipal('author-1', {
      authorityRevision: 'chirp-authz-v1',
      trustedContext: { tenantId: 'direct-native-live' },
    });
    const executionPrincipal: ApplicationExecutionPrincipal = {
      ...requestingPrincipal,
      id: 'principal:direct-native:execution:agent:run-1:1',
      identity: {
        id: 'identity:direct-native:service:assistant',
        kind: 'service',
        issuer: 'applik8s://direct-native',
        subject: 'assistant',
      },
      kind: 'execution',
      authenticationMethod: 'workload-identity',
      executionKind: 'agent',
      executionId: 'run-1',
      attempt: 1,
      workloadIdentity: {
        id: 'identity:direct-native:workload:assistant',
        kind: 'workload',
        issuer: 'applik8s://direct-native',
        subject: 'assistant',
      },
      causalPrincipalId: requestingPrincipal.id,
      causalPrincipal: requestingPrincipal.identity,
      causalGrantIds: [],
      deadline: '2099-01-01T00:00:00.000Z',
      cancellationRevision: 'cancel-1',
      bindings: [],
      effectiveAuthority: [],
    };
    const admittedContext = {
      values: applicationRequestContextValues(
        executionPrincipal,
        'chirp-authz-v1',
        { tenantId: 'direct-native-live' },
      ),
      digest: 'a'.repeat(64),
      changeScopes: {
        global: 'c'.repeat(64),
        'context:tenantId': 'd'.repeat(64),
      },
    } as const;
    if (!model || !create || !update || !remove) throw new Error('Direct native lifecycle bindings were not installed.');

    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(directTableName)} (id text PRIMARY KEY, title text NOT NULL, owner_id text DEFAULT nullif(current_setting('applik8s.principal.id', true), '') NOT NULL, causal_owner_id text DEFAULT nullif(current_setting('applik8s.principal.causal_id', true), '') NOT NULL, revision text NOT NULL)`);
    await sql.unsafe(applicationModelMigrationSql(model.runtime));
    await sql.unsafe(applicationRelationalFrameworkMigrationSql(Database, [Card]));
    try {
      const created = await create.execute({ id: 'card-1', title: 'created', revision: 'input-r1' }, {
        id: 'direct-create-1',
        targetKey: 'card-1',
        idempotencyKey: 'direct-create-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      const replayedCreate = await create.execute({ id: 'card-1', title: 'created', revision: 'input-r1' }, {
        id: 'direct-create-replay',
        targetKey: 'card-1',
        idempotencyKey: 'direct-create-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      expect(created).toMatchObject({
        replayed: false,
        output: {
          identity: 'card-1',
          value: {
            id: 'card-1',
            title: 'created',
            ownerId: executionPrincipal.id,
            causalOwnerId: requestingPrincipal.id,
          },
          revision: expect.any(String),
        },
        model: {
          id: 'card-1',
          spec: {
            id: 'card-1',
            title: 'created',
            ownerId: executionPrincipal.id,
            causalOwnerId: requestingPrincipal.id,
          },
          revision: expect.any(String),
        },
        events: [expect.objectContaining({
          contract: { name: `models.DirectCard${process.pid}.created`, version: 'v1' },
          payload: {
            operation: 'create',
            identity: 'card-1',
            value: expect.objectContaining({
              id: 'card-1',
              title: 'created',
              ownerId: executionPrincipal.id,
              causalOwnerId: requestingPrincipal.id,
            }),
            revision: expect.any(String),
          },
        })],
      });
      expect(replayedCreate).toMatchObject({
        replayed: true,
        output: created.output,
        model: created.model,
        events: [],
      });

      const rejectedDelivery = {
        id: 'direct-create-policy-rejected',
        targetKey: 'card-policy-rejected',
        idempotencyKey: 'direct-create-policy-rejected',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      } as const;
      await expect(create.execute({
        id: 'card-policy-rejected',
        title: 'policy-rejected',
        revision: 'input-policy-rejected',
      }, rejectedDelivery)).rejects.toMatchObject({
        code: 'applik8s-command-rejected',
        replayed: false,
        rejection: {
          name: 'policyRejected',
          payload: { message: 'Card title is rejected by policy.' },
        },
      });
      await expect(create.execute({
        id: 'card-policy-rejected',
        title: 'policy-rejected',
        revision: 'input-policy-rejected',
      }, {
        ...rejectedDelivery,
        id: 'direct-create-policy-rejected-replay',
      })).rejects.toMatchObject({
        code: 'applik8s-command-rejected',
        replayed: true,
        rejection: {
          name: 'policyRejected',
          payload: { message: 'Card title is rejected by policy.' },
        },
      });
      await expect(sql.unsafe(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(directTableName)} WHERE id = $1`,
        ['card-policy-rejected'],
      )).resolves.toEqual([{ count: 0 }]);

      await expect(create.execute({ id: 'card-without-actor', title: 'rejected', revision: 'input-r2' }, {
        id: 'direct-create-without-actor',
        targetKey: 'card-without-actor',
        idempotencyKey: 'direct-create-without-actor',
        context: {
          values: { tenantId: 'direct-native-live' },
          digest: 'b'.repeat(64),
          changeScopes: { global: 'e'.repeat(64), 'context:tenantId': 'f'.repeat(64) },
        },
        databaseUrl: liveDatabaseUrl,
      })).rejects.toMatchObject({ code: '23502' });
      await expect(sql.unsafe(`SELECT count(*)::int AS count FROM ${quoteIdentifier(directTableName)} WHERE id = $1`, ['card-without-actor'])).resolves.toEqual([{ count: 0 }]);

      const updated = await update.execute({ identity: 'card-1', patch: { title: 'updated' } }, {
        id: 'direct-update-1',
        targetKey: 'card-1',
        idempotencyKey: 'direct-update-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      expect(updated).toMatchObject({
        replayed: false,
        output: { identity: 'card-1', value: { id: 'card-1', title: 'updated' }, revision: expect.any(String) },
        events: [expect.objectContaining({
          contract: { name: `models.DirectCard${process.pid}.updated`, version: 'v1' },
          payload: {
            operation: 'update',
            identity: 'card-1',
            previous: expect.objectContaining({ title: 'created' }),
            current: expect.objectContaining({ title: 'updated' }),
            revision: expect.any(String),
          },
        })],
      });

      const archived = await archive.execute({ cardId: 'card-1' }, {
        id: 'direct-archive-1',
        targetKey: 'card-1',
        idempotencyKey: 'direct-archive-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      expect(archived).toMatchObject({
        replayed: false,
        output: { archived: true },
        model: {
          spec: expect.objectContaining({
            id: 'card-1',
            title: 'archived',
            ownerId: executionPrincipal.id,
            causalOwnerId: requestingPrincipal.id,
          }),
        },
        events: [expect.objectContaining({
          contract: { name: `models.DirectCard${process.pid}.archive.completed`, version: 'v1' },
          payload: {
            operation: 'archive',
            identity: 'card-1',
            previous: expect.objectContaining({ title: 'updated' }),
            current: expect.objectContaining({ title: 'archived' }),
            result: { archived: true },
            revision: expect.any(String),
          },
        })],
      });

      const deleted = await remove.execute({ identity: 'card-1' }, {
        id: 'direct-delete-1',
        targetKey: 'card-1',
        idempotencyKey: 'direct-delete-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      const replayedDelete = await remove.execute({ identity: 'card-1' }, {
        id: 'direct-delete-replay',
        targetKey: 'card-1',
        idempotencyKey: 'direct-delete-idempotency-1',
        context: admittedContext,
        databaseUrl: liveDatabaseUrl,
      });
      expect(deleted).toMatchObject({
        replayed: false,
        deleted: true,
        output: { identity: 'card-1', deleted: true },
        events: [expect.objectContaining({
          contract: { name: `models.DirectCard${process.pid}.deleted`, version: 'v1' },
          payload: {
            operation: 'delete',
            identity: 'card-1',
            previous: expect.objectContaining({ id: 'card-1', title: 'archived' }),
            tombstone: { identity: 'card-1', deleted: true },
            revision: expect.any(String),
          },
        })],
      });
      expect(replayedDelete).toMatchObject({
        replayed: true,
        deleted: true,
        output: deleted.output,
        model: deleted.model,
        events: [],
      });
      await expect(sql.unsafe(`SELECT count(*)::int AS count FROM ${quoteIdentifier(directTableName)}`)).resolves.toEqual([{ count: 0 }]);
    } finally {
      await sql.unsafe(
        'DELETE FROM applik8s_public_stream_events WHERE contract_name LIKE $1',
        [`models.DirectCard${process.pid}.%`],
      );
      await sql.unsafe(
        'DELETE FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[])',
        [[create.name, update.name, archive.name, remove.name]],
      );
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(directTableName)}`);
    }
  });

  it('serializes concurrent same-key commands and rolls back state plus outbox before commit', async () => {
    if (!liveDatabaseUrl) {
      throw new Error('Live command concurrency test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    }
    const counterModel = commandCounterModel(`applik8s_script_command_counter_${process.pid}`);
    const bindingId = `script-counter-command-${process.pid}`;
    const CounterChanged = event('counter.changed.v1', { payload: type({ count: 'number' }) });
    await sql.unsafe(applicationModelMigrationSql(counterModel));
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    const client = createPostgresModelClient<{ readonly count: number }>(counterModel);
    await client.create({ id: 'shared-counter', spec: { count: 0 } });

    const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId,
      command: { name: 'counter.increment', version: 'v1' },
      model: counterModel,
      message: { id: `increment-message-${index}`, input: { amount: 1 }, targetKey: 'shared-counter', idempotencyKey: `increment-${index}` },
      outbox: [CounterChanged],
      databaseUrl: liveDatabaseUrl,
      async handler(counter, input, context) {
        const count = counter.spec.count + input.amount;
        await Promise.resolve();
        counter.patch({ spec: { count } });
        context.emit(CounterChanged, { count });
        return { count };
      },
    })));

    expect(results.map((result) => result.output.count).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(client.get({ id: 'shared-counter' })).resolves.toMatchObject({ spec: { count: 10 } });

    await expect(executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId,
      command: { name: 'counter.increment', version: 'v1' },
      model: counterModel,
      message: { id: 'crash-message', input: { amount: 100 }, targetKey: 'shared-counter', idempotencyKey: 'crash-before-commit' },
      outbox: [CounterChanged],
      databaseUrl: liveDatabaseUrl,
      async handler(counter, input, context) {
        const count = counter.spec.count + input.amount;
        counter.patch({ spec: { count } });
        context.emit(CounterChanged, { count });
        throw new Error('simulated-crash-before-commit');
      },
    })).rejects.toThrow(/simulated-crash-before-commit/);
    await expect(client.get({ id: 'shared-counter' })).resolves.toMatchObject({ spec: { count: 10 } });
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId])).resolves.toMatchObject([{ count: 10 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 10 }]);

    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(counterModel.tableName)}`);
  });

  it('executes concurrent optimistic commands, alternate-key routing, transactional command outbox, and runtime effect denial', async () => {
    if (!liveDatabaseUrl) throw new Error('Live complete command semantics test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const model = commandCounterModel(`applik8s_script_complete_command_${process.pid}`);
    const bindingId = `script-complete-command-${process.pid}`;
    const Followup = command('counter.followup.v1', { input: type({ counterId: 'string', count: 'number' }), output: type({ accepted: 'boolean' }) });
    await sql.unsafe(applicationModelMigrationSql(model));
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    const client = createPostgresModelClient<{ readonly count: number }>(model);
    await Promise.all([
      client.create({ id: 'fallback-counter', spec: { count: 0 } }),
      client.create({ id: 'parallel-a', spec: { count: 0 } }),
      client.create({ id: 'parallel-b', spec: { count: 0 } }),
    ]);

    const routed = await executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId,
      command: { name: 'counter.increment', version: 'v1' },
      schemas: { input: {}, output: {}, errors: {}, commands: { [Followup.id]: { type: 'object', properties: { counterId: { type: 'string' }, count: { type: 'number' } }, required: ['counterId', 'count'], additionalProperties: false } } },
      model,
      ordering: 'concurrent',
      missingRoute: 'fallback-counter',
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 20, initialDelayMs: 1, maxDelayMs: 10 },
      message: { id: 'routed-message', input: { amount: 1 }, targetKey: 'missing-counter', idempotencyKey: 'routed-request' },
      commands: [Followup],
      databaseUrl: liveDatabaseUrl,
      async handler(target, input, context) {
        const count = target.spec.count + input.amount;
        target.patch({ spec: { count } });
        context.send(Followup, { counterId: target.id, count }, { targetKey: target.id });
        return { count };
      },
    });
    expect(routed).toMatchObject({ model: { id: 'fallback-counter', spec: { count: 1 } }, observation: { target: { model: model.name, key: 'fallback-counter' } } });
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_command_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 1 }]);
    const relayed: { readonly id: string; readonly channel?: string }[] = [];
    await expect(relayPostgresCommandOutbox({ databaseUrl: liveDatabaseUrl, eventLog: { async publish(envelope, channel) { relayed.push({ id: envelope.id, ...(channel ? { channel } : {}) }); return { stream: 'APPLIK8S_EVENTS', sequence: 1, duplicate: false, subject: 'applik8s.commands.counter-followup.v1.fallback-counter', messageId: envelope.id }; } } })).resolves.toMatchObject({ selected: 1, published: 1 });
    expect(relayed).toEqual([expect.objectContaining({ channel: 'commands' })]);

    let entered = 0;
    let release: (() => void) | undefined;
    const bothEntered = new Promise<void>((resolve) => { release = resolve; });
    const runParallel = (targetKey: string) => executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId: `${bindingId}-parallel`, command: { name: 'counter.parallel', version: 'v1' }, model, ordering: 'concurrent',
      message: { id: `parallel-${targetKey}`, input: { amount: 1 }, targetKey, idempotencyKey: targetKey }, databaseUrl: liveDatabaseUrl,
      async handler(target, input) { entered += 1; if (entered === 2) release?.(); await bothEntered; const count = target.spec.count + input.amount; target.patch({ spec: { count } }); return { count }; },
    });
    await expect(Promise.all([runParallel('parallel-a'), runParallel('parallel-b')])).resolves.toHaveLength(2);

    const optimistic = await Promise.all(Array.from({ length: 10 }, (_, index) => executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId: `${bindingId}-optimistic`, command: { name: 'counter.optimistic', version: 'v1' }, model, ordering: 'concurrent',
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 20, initialDelayMs: 1, maxDelayMs: 10 },
      message: { id: `optimistic-${index}`, input: { amount: 1 }, targetKey: 'fallback-counter', idempotencyKey: `optimistic-${index}` }, databaseUrl: liveDatabaseUrl,
      async handler(target, input) { const count = target.spec.count + input.amount; await Promise.resolve(); target.patch({ spec: { count } }); return { count }; },
    })));
    expect(optimistic.map((result) => result.output.count).sort((left, right) => left - right)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    await expect(executePostgresModelCommand<{ readonly count: number }, Record<string, never>, Record<string, never>, { readonly ok: boolean }>({
      bindingId: `${bindingId}-effect`, command: { name: 'counter.effect', version: 'v1' }, model,
      message: { id: 'effect-message', input: {}, targetKey: 'fallback-counter', idempotencyKey: 'effect-request' }, databaseUrl: liveDatabaseUrl,
      async handler() { await globalThis.fetch('http://127.0.0.1:1/forbidden'); return { ok: true }; },
    })).rejects.toThrow(/applik8s-command-external-effect-forbidden/);
    await expect(client.get({ id: 'fallback-counter' })).resolves.toMatchObject({ spec: { count: 11 } });

    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id LIKE $1', [`${bindingId}%`]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(model.tableName)}`);
  });

  it('cleans only completed binding-scoped command data after audit and published-outbox windows', async () => {
    if (!liveDatabaseUrl) throw new Error('Live command cleanup test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const cleanupModel = commandCounterModel(`applik8s_script_cleanup_${process.pid}`);
    const bindingId = `script-cleanup-command-${process.pid}`;
    const otherBindingId = `${bindingId}-other`;
    await sql.unsafe(applicationModelMigrationSql(cleanupModel));
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[])', [[bindingId, otherBindingId]]);
    const insert = async (scope: string, owner: string, receivedAt: string, publishedAt: string | undefined) => {
      await sql.unsafe("INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input, received_at) VALUES ($1, $2, 'Cleanup', $3, $3, $3, '{}'::jsonb, $4::timestamptz)", [scope, owner, scope, receivedAt]);
      await sql.unsafe("INSERT INTO applik8s_command_results (scope, output, model_revision, completed_at) VALUES ($1, '{}'::jsonb, 'revision', $2::timestamptz)", [scope, receivedAt]);
      await sql.unsafe('INSERT INTO applik8s_event_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload, published_at, created_at) VALUES ($1, $2, \'cleanup.changed\', \'v1\', $2, $3::jsonb, \'{}\'::jsonb, $4::timestamptz, $5::timestamptz)', [`${scope}-event`, scope, JSON.stringify({ id: `${scope}-event`, contract: { name: 'cleanup.changed', version: 'v1' }, payload: {}, recordedAt: receivedAt }), publishedAt ?? null, receivedAt]);
    };
    await insert(`${bindingId}-expired`, bindingId, '2026-05-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    await insert(`${bindingId}-pending`, bindingId, '2026-05-01T00:00:00.000Z', undefined);
    await insert(`${bindingId}-recent`, bindingId, '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
    await insert(`${otherBindingId}-expired`, otherBindingId, '2026-05-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');

    const cleanup = await cleanupPostgresCommandData({ databaseUrl: liveDatabaseUrl, bindingIds: [bindingId], auditWindowSeconds: 30 * 24 * 60 * 60, publishedOutboxWindowSeconds: 24 * 60 * 60, batchSize: 100, now: '2026-07-11T00:00:00.000Z' });
    expect(cleanup).toEqual({ eventOutboxDeleted: 1, commandOutboxDeleted: 0, commandsDeleted: 1, admissionsDeleted: 0 });
    const retained = await sql.unsafe('SELECT scope FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[]) ORDER BY scope', [[bindingId, otherBindingId]]);
    expect(retained).toHaveLength(3);
    expect(retained).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: `${bindingId}-pending` }),
      expect.objectContaining({ scope: `${bindingId}-recent` }),
      expect.objectContaining({ scope: `${otherBindingId}-expired` }),
    ]));
    await expect(observePostgresOutboxLag(liveDatabaseUrl)).resolves.toEqual(expect.objectContaining({ pendingEvents: expect.any(Number), pendingCommands: expect.any(Number), oldestPendingSeconds: expect.any(Number) }));
    await sql.unsafe('DELETE FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[]))', [[bindingId, otherBindingId]]);
    await sql.unsafe('DELETE FROM applik8s_command_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[]))', [[bindingId, otherBindingId]]);
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = ANY($1::text[])', [[bindingId, otherBindingId]]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(cleanupModel.tableName)}`);
  });

  it('recovers from broker outage and crash-after-publish using the stable outbox message id', async () => {
    if (!liveDatabaseUrl) throw new Error('Live outbox recovery test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const relayModel = commandCounterModel(`applik8s_script_relay_${process.pid}`);
    const bindingId = `script-relay-command-${process.pid}`;
    const RelayChanged = event('relay.changed.v1', { payload: type({ count: 'number' }) });
    await sql.unsafe(applicationModelMigrationSql(relayModel));
    // The relay owns the global pending queue. Remove only rows owned by this
    // file's script-* fixtures so an interrupted prior run cannot contaminate
    // the crash/retry proof or erase non-test application events.
    await sql.unsafe(
      "DELETE FROM applik8s_command_inbox WHERE binding_id LIKE 'script-%'",
    );
    const client = createPostgresModelClient<{ readonly count: number }>(relayModel);
    await client.create({ id: 'relay-target', spec: { count: 0 } });
    await executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId,
      command: { name: 'relay.increment', version: 'v1' },
      model: relayModel,
      message: { id: 'relay-message', input: { amount: 1 }, targetKey: 'relay-target', idempotencyKey: 'relay-request' },
      outbox: [RelayChanged],
      databaseUrl: liveDatabaseUrl,
      async handler(target, input: { readonly amount: number }, context) {
        const count = target.spec.count + input.amount;
        target.patch({ spec: { count } });
        context.emit(RelayChanged, { count });
        return { count };
      },
    });

    await expect(relayPostgresEventOutbox({ databaseUrl: liveDatabaseUrl, eventLog: { publish: async () => { throw new Error('simulated-broker-outage'); } } })).rejects.toThrow(/simulated-broker-outage/);
    await expect(sql.unsafe('SELECT published_at FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ published_at: null }]);

    const publications: string[] = [];
    const eventLog = { publish: async (envelope: { readonly id: string }) => {
      publications.push(envelope.id);
      return { stream: 'APPLIK8S_EVENTS', sequence: 1, duplicate: publications.length > 1, subject: 'applik8s.events.relay.changed.v1.relay-target', messageId: envelope.id };
    } };
    await expect(relayPostgresEventOutbox({ databaseUrl: liveDatabaseUrl, eventLog, onPublishAcknowledged: async () => { throw new Error('simulated-crash-after-publish'); } })).rejects.toThrow(/simulated-crash-after-publish/);
    await expect(sql.unsafe('SELECT published_at FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ published_at: null }]);
    await expect(relayPostgresEventOutbox({ databaseUrl: liveDatabaseUrl, eventLog })).resolves.toMatchObject({ selected: 1, published: 1, duplicates: 1, messageIds: [publications[0]] });
    expect(publications).toEqual([publications[0], publications[0]]);
    await expect(sql.unsafe('SELECT published_at IS NOT NULL AS published FROM applik8s_event_outbox WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ published: true }]);
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(relayModel.tableName)}`);
  });

  it('commits declared same-database participant model changes in the command transaction', async () => {
    if (!liveDatabaseUrl) throw new Error('Live participant transaction test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const accountModel = commandCounterModel(`applik8s_script_account_${process.pid}`);
    const auditModel = { ...commandCounterModel(`applik8s_script_audit_${process.pid}`), name: 'Audit' };
    const bindingId = `script-participant-command-${process.pid}`;
    await sql.unsafe(applicationModelMigrationSql(accountModel));
    await sql.unsafe(applicationModelMigrationSql(auditModel));
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    const accountClient = createPostgresModelClient<{ readonly count: number }>(accountModel);
    const auditClient = createPostgresModelClient<{ readonly count: number }>(auditModel);
    await accountClient.create({ id: 'account-1', spec: { count: 0 } });
    await auditClient.create({ id: 'audit-1', spec: { count: 0 } });

    await executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly amount: number }, { readonly count: number }>({
      bindingId,
      command: { name: 'account.increment', version: 'v1' },
      model: accountModel,
      models: [accountModel, auditModel],
      historyModels: ['Audit'],
      message: { id: 'participant-message', input: { amount: 1 }, targetKey: 'account-1', idempotencyKey: 'participant-request' },
      databaseUrl: liveDatabaseUrl,
      async handler(account, input, context) {
        account.patch({ spec: { count: account.spec.count + input.amount } });
        await context.models.Audit?.patch({ id: 'audit-1' }, { spec: { count: 1 } });
        return { count: account.spec.count };
      },
    });

    await expect(accountClient.get({ id: 'account-1' })).resolves.toMatchObject({ spec: { count: 1 } });
    await expect(auditClient.get({ id: 'audit-1' })).resolves.toMatchObject({ spec: { count: 1 } });
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_model_transitions WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [bindingId])).resolves.toMatchObject([{ count: 2 }]);
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_model_history WHERE model = $1 AND scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $2)', ['Audit', bindingId])).resolves.toMatchObject([{ count: 1 }]);

    const rejectedBindingId = `${bindingId}-rejected`;
    const rejectedExecution = {
      bindingId: rejectedBindingId,
      command: { name: 'account.increment', version: 'v1' },
      errors: ['auditRejected'],
      model: accountModel,
      models: [accountModel, auditModel],
      historyModels: ['Audit'],
      message: { id: 'participant-rejected-message', input: { amount: 10 }, targetKey: 'account-1', idempotencyKey: 'participant-rejected-request' },
      databaseUrl: liveDatabaseUrl,
      async handler(account: { readonly spec: { readonly count: number }; patch(patch: { readonly spec: { readonly count: number } }): void }, input: { readonly amount: number }, context: { readonly models: Readonly<Record<string, { patch(ref: { readonly id: string }, patch: { readonly spec: { readonly count: number } }): Promise<unknown> }>>; reject(name: 'auditRejected', payload: { readonly reason: string }): never }) {
        account.patch({ spec: { count: account.spec.count + input.amount } });
        await context.models.Audit?.patch({ id: 'audit-1' }, { spec: { count: 11 } });
        context.reject('auditRejected', { reason: 'policy' });
      },
    };
    await expect(executePostgresModelCommand(rejectedExecution)).rejects.toMatchObject({
      code: 'applik8s-command-rejected',
      replayed: false,
      rejection: { name: 'auditRejected', payload: { reason: 'policy' } },
    });
    await expect(accountClient.get({ id: 'account-1' })).resolves.toMatchObject({ spec: { count: 1 } });
    await expect(auditClient.get({ id: 'audit-1' })).resolves.toMatchObject({ spec: { count: 1 } });
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_model_transitions WHERE scope IN (SELECT scope FROM applik8s_command_inbox WHERE binding_id = $1)', [rejectedBindingId])).resolves.toMatchObject([{ count: 0 }]);
    await expect(sql.unsafe("SELECT count(*)::int AS count FROM applik8s_command_results WHERE error ->> 'name' = 'auditRejected'", [])).resolves.toMatchObject([{ count: 1 }]);

    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [rejectedBindingId]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(accountModel.tableName)}`);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(auditModel.tableName)}`);
  });

  it('installs admitted RLS context for a scoped participant of an unscoped command model', async () => {
    if (!liveDatabaseUrl) throw new Error('Live participant RLS test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const primaryModel = commandCounterModel(`applik8s_script_unscoped_primary_${process.pid}`);
    const participantTable = `applik8s_script_scoped_participant_${process.pid}`;
    const participantModel: ApplicationRuntimeModelContract = {
      ...commandCounterModel(participantTable),
      name: 'ScopedParticipant',
      storageShape: 'native-relational',
      nativeRelational: {
        identity: { property: 'id', column: 'id' },
        revision: { property: 'revision', column: 'revision' },
        columns: [
          { property: 'id', column: 'id' },
          { property: 'principalScope', column: 'principal_scope' },
          { property: 'message', column: 'message' },
          { property: 'revision', column: 'revision' },
        ],
        access: {
          context: 'principalScope',
          setting: 'applik8s.test.participant_scope',
          property: 'principalScope',
          column: 'principal_scope',
        },
      },
    };
    const bindingId = `script-participant-rls-${process.pid}`;
    await sql.unsafe(applicationModelMigrationSql(primaryModel));
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(participantTable)}`);
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(participantTable)} (id text PRIMARY KEY, principal_scope text NOT NULL, message text NOT NULL, revision text NOT NULL)`);
    await sql.unsafe(`INSERT INTO ${quoteIdentifier(participantTable)} (id, principal_scope, message, revision) VALUES ('participant-1', 'workspace:trusted', 'visible', 'revision-1')`);
    await sql.unsafe(`ALTER TABLE ${quoteIdentifier(participantTable)} ENABLE ROW LEVEL SECURITY`);
    await sql.unsafe(`ALTER TABLE ${quoteIdentifier(participantTable)} FORCE ROW LEVEL SECURITY`);
    await sql.unsafe(`CREATE POLICY ${quoteIdentifier(`${participantTable}_scope`)} ON ${quoteIdentifier(participantTable)} USING (principal_scope = current_setting('applik8s.test.participant_scope', true)) WITH CHECK (principal_scope = current_setting('applik8s.test.participant_scope', true))`);
    const primaryClient = createPostgresModelClient<{ readonly count: number }>(primaryModel);
    await primaryClient.create({ id: 'primary-1', spec: { count: 0 } });

    try {
      const result = await executePostgresModelCommand({
        bindingId,
        command: { name: 'primary.read-participant', version: 'v1' },
        model: primaryModel,
        models: [primaryModel, participantModel],
        message: {
          id: 'participant-rls-message',
          input: {},
          targetKey: 'primary-1',
          idempotencyKey: 'participant-rls-request',
          context: {
            values: { principalScope: 'workspace:trusted' },
            digest: 'e'.repeat(64),
          },
        },
        databaseUrl: liveDatabaseUrl,
        async handler(_primary, _input, context) {
          const participant = await context.models.ScopedParticipant?.get({ id: 'participant-1' });
          return { message: Reflect.get(participant?.spec ?? {}, 'message') };
        },
      });

      expect(result.output).toEqual({ message: 'visible' });
    } finally {
      await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(primaryModel.tableName)}`);
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(participantTable)}`);
    }
  });

  it('retries an intentionally deadlocked multi-model transaction from a clean boundary', async () => {
    if (!liveDatabaseUrl) throw new Error('Live command deadlock test requires APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL.');
    const accountModel = commandCounterModel(`applik8s_script_deadlock_account_${process.pid}`);
    const auditModel = { ...commandCounterModel(`applik8s_script_deadlock_audit_${process.pid}`), name: 'DeadlockAudit' };
    const bindingId = `script-deadlock-command-${process.pid}`;
    await sql.unsafe(applicationModelMigrationSql(accountModel));
    await sql.unsafe(applicationModelMigrationSql(auditModel));
    const accountClient = createPostgresModelClient<{ readonly count: number }>(accountModel);
    const auditClient = createPostgresModelClient<{ readonly count: number }>(auditModel);
    await Promise.all([
      accountClient.create({ id: 'account-a', spec: { count: 0 } }),
      accountClient.create({ id: 'account-b', spec: { count: 0 } }),
      auditClient.create({ id: 'audit-a', spec: { count: 0 } }),
      auditClient.create({ id: 'audit-b', spec: { count: 0 } }),
    ]);
    let waiting = 0;
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const invocations = new Map<string, number>();
    const execute = (id: string, targetKey: string, first: string, second: string) => executePostgresModelCommand<{ readonly count: number }, Record<string, never>, { readonly first: string; readonly second: string }, { readonly ok: boolean }>({
      bindingId,
      command: { name: 'account.audit-pair', version: 'v1' },
      model: accountModel,
      models: [accountModel, auditModel],
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 5, maxDelayMs: 20 },
      message: { id, input: { first, second }, targetKey, idempotencyKey: id },
      databaseUrl: liveDatabaseUrl,
      async handler(_account, input, context) {
        const invocation = (invocations.get(id) ?? 0) + 1;
        invocations.set(id, invocation);
        const firstObject = await context.models.DeadlockAudit?.get({ id: input.first });
        await context.models.DeadlockAudit?.patch({ id: input.first }, { spec: { count: Number(Reflect.get(firstObject?.spec ?? {}, 'count') ?? 0) + 1 } });
        if (invocation === 1) {
          waiting += 1;
          if (waiting === 2) releaseBarrier?.();
          await barrier;
        }
        const secondObject = await context.models.DeadlockAudit?.get({ id: input.second });
        await context.models.DeadlockAudit?.patch({ id: input.second }, { spec: { count: Number(Reflect.get(secondObject?.spec ?? {}, 'count') ?? 0) + 1 } });
        return { ok: true };
      },
    });

    const retryBoundaries: ApplicationTelemetryBoundary[] = [];
    const retryCompletions: Array<{
      readonly boundary: ApplicationTelemetryBoundary;
      readonly result: 'ok' | 'error';
      readonly errorType?: string;
    }> = [];
    const retryTelemetryRuntime = recordingTelemetryRuntime(
      retryBoundaries,
      retryCompletions,
    );
    const disposeRetryTelemetry = installApplicationTelemetryRuntimeResolver(
      () => retryTelemetryRuntime,
    );
    try {
      await expect(Promise.all([
        execute('deadlock-a', 'account-a', 'audit-a', 'audit-b'),
        execute('deadlock-b', 'account-b', 'audit-b', 'audit-a'),
      ])).resolves.toHaveLength(2);
    } finally {
      disposeRetryTelemetry();
    }
    expect([...invocations.values()].some((count) => count > 1)).toBe(true);
    expect(retryBoundaries.some((boundary) =>
      boundary.kind === 'model'
      && boundary.attempt === 2
      && boundary.invocation === 'retry'
      && boundary.attributes?.['applik8s.model.transaction_attempt'] === 2)).toBe(true);
    expect(retryCompletions.some((completion) =>
      completion.result === 'error')).toBe(true);
    expect(retryCompletions.filter((completion) =>
      completion.result === 'ok')).toHaveLength(2);
    await expect(auditClient.get({ id: 'audit-a' })).resolves.toMatchObject({ spec: { count: 2 } });
    await expect(auditClient.get({ id: 'audit-b' })).resolves.toMatchObject({ spec: { count: 2 } });
    await expect(sql.unsafe('SELECT count(*)::int AS count FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId])).resolves.toMatchObject([{ count: 2 }]);

    await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id = $1', [bindingId]);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(accountModel.tableName)}`);
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(auditModel.tableName)}`);
  });

  it('fails migration preflight closed against existing schema drift before migration SQL runs', async () => {
    const driftTableName = `${tableName}_drift`;
    const driftModel = scriptNoteModel(driftTableName, 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL');
    await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(driftTableName)}`);
    await sql.unsafe('DELETE FROM applik8s_model_migrations WHERE model = $1', [driftModel.name]);
    await sql.unsafe('CREATE TABLE IF NOT EXISTS "applik8s_model_migrations" (id text PRIMARY KEY, model text NOT NULL, revision text NOT NULL, plan jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await sql.unsafe(`CREATE TABLE ${quoteIdentifier(driftTableName)} (id text PRIMARY KEY, spec jsonb NOT NULL, status jsonb, revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), unmanaged text)`);

    try {
      let preflightError: unknown;
      try {
        await sql.unsafe(applicationModelMigrationPreflightSql(driftModel));
      } catch (error) {
        preflightError = error;
        await sql.unsafe('ROLLBACK');
      }
      expect(preflightError).toMatchObject({ message: expect.stringMatching(/applik8s-model-migration-drift-detected: unknownExistingObject/) });
    } finally {
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(driftTableName)}`);
    }
  });
});

function telemetryCarrier(operation: string, execution: string) {
  return createApplicationTelemetryEnvelopeV1({
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    identity: {
      application: 'transactional-runtime',
      environment: 'test',
      target: 'local',
      operation,
      execution,
      attempt: 1,
    },
  });
}

function recordingTelemetryRuntime(
  boundaries: ApplicationTelemetryBoundary[],
  completions: Array<{
    readonly boundary: ApplicationTelemetryBoundary;
    readonly result: 'ok' | 'error';
    readonly errorType?: string;
  }> = [],
): ApplicationTelemetryRuntime {
  let active: ReturnType<typeof telemetryCarrier> | undefined;
  return {
    async run<TResult>(
      boundary: ApplicationTelemetryBoundary,
      execute: () => Promise<TResult>,
    ): Promise<TResult> {
      boundaries.push(boundary);
      const previous = active;
      const producer = boundary.parent ?? previous;
      const traceId = producer?.traceparent.slice(3, 35)
        ?? 'fedcba9876543210fedcba9876543210';
      active = createApplicationTelemetryEnvelopeV1({
        traceparent: `00-${traceId}-${String(boundaries.length).padStart(16, '0')}-01`,
        identity: {
          application: producer?.identity.application ?? 'transactional-runtime',
          environment: producer?.identity.environment ?? 'test',
          target: producer?.identity.target ?? 'local',
          operation: boundary.identity,
          execution: boundary.execution ?? `${boundary.kind}:${boundary.identity}`,
          attempt: boundary.attempt ?? 1,
          ...(boundary.definition ? { definition: boundary.definition } : {}),
          ...(boundary.instance ? { instance: boundary.instance } : {}),
        },
        invocation: {
          kind: boundary.invocation ?? 'live',
          relationship: boundary.relationship ?? 'synchronous',
          replaySuppressed: boundary.invocation === 'replay',
        },
      });
      try {
        const result = await execute();
        completions.push({ boundary, result: 'ok' });
        return result;
      } catch (error) {
        completions.push({
          boundary,
          result: 'error',
          errorType: error instanceof Error ? error.name : 'Error',
        });
        throw error;
      } finally {
        active = previous;
      }
    },
    capture: () => active,
    log() {},
    count() {},
    record() {},
  };
}

function scriptNoteModel(tableName: string, connectionEnvName = 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_NOTE_DATABASE_URL'): ApplicationRuntimeModelContract {
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

function commandCounterModel(tableName: string): ApplicationRuntimeModelContract {
  return {
    name: 'ScriptCommandCounter',
    tableName,
    provider: 'postgres',
    database: 'script_runtime',
    clusterName: 'script-runtime-db',
    secretName: 'script-runtime-db-app',
    secretKey: 'uri',
    connectionEnvName: 'APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_LIVE_NOTE_DATABASE_URL',
    constraints: [],
    indexes: [],
    retention: { mode: 'retain' },
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
