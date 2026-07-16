import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { ApplicationGraph, ApplicationModelNode, JsonObject } from '@applik8s/core';

export interface GeneratedApplicationMigrationArtifact {
  readonly name: string;
  readonly digest: string;
  readonly sourcePath: string;
  readonly manifestPath: string;
  readonly resources: readonly GeneratedApplicationMigrationResource[];
}

export interface GeneratedApplicationMigrationResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & { readonly name: string; readonly namespace?: string };
}

export async function emitGeneratedApplicationMigrations(options: {
  readonly graph: ApplicationGraph;
  readonly entrypoint: string;
  readonly outDir: string;
}): Promise<readonly GeneratedApplicationMigrationArtifact[]> {
  const models = options.graph.nodes.filter((node): node is ApplicationModelNode => node.kind === 'model' && node.native?.kind === 'drizzle-table' && Boolean(node.runtime?.nativeRelational));
  const missing = models.filter((model) => !model.native?.artifact.migrations);
  if (missing.length > 0) {
    throw new Error(`Native relational models ${missing.map((model) => model.name).sort().join(', ')} have no committed migration artifact. app.database.postgres(..., { migrations }) is required so application tables, RLS, command authority, outboxes, and live-query changes are installed together.`);
  }
  const groups = new Map<string, ApplicationModelNode[]>();
  for (const model of models) {
    const runtime = model.runtime;
    const migration = model.native?.artifact.migrations;
    if (!runtime || !migration) continue;
    const key = `${runtime.clusterName}\0${runtime.database}\0${migration.path}`;
    const current = groups.get(key) ?? [];
    current.push(model);
    groups.set(key, current);
  }
  if (groups.size === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationMigrationArtifact[] = [];
  for (const grouped of groups.values()) {
    const ordered = [...grouped].sort((left, right) => left.name.localeCompare(right.name));
    const first = ordered[0];
    if (!first?.runtime || !first.native?.artifact.migrations) continue;
    const migration = first.native.artifact.migrations;
    const source = await applicationMigrationSource(migration.path, options.entrypoint);
    const framework = frameworkMigrationSql(ordered);
    const contentDigest = `sha256:${createHash('sha256').update(`${source}\n${framework}`).digest('hex')}`;
    if (migration.digest && migration.digest !== contentDigest) {
      throw new Error(`Native migration artifact ${migration.path} digest mismatch: graph declares ${migration.digest}, compiler calculated ${contentDigest}.`);
    }
    const name = kubernetesName(`${options.graph.metadata.name}-${first.runtime.database}-migration`);
    const namespace = first.runtime.secretNamespace ?? options.graph.metadata.namespace;
    const migrationSql = psqlMigrationScript(name, contentDigest, source, framework);
    if (Buffer.byteLength(migrationSql) > 900_000) throw new Error(`Native migration artifact ${migration.path} exceeds the safe ConfigMap limit; package it in an immutable migration image.`);
    const sourcePath = join(options.outDir, `${name}.sql`);
    const manifestPath = join(options.outDir, `${name}.manifest.json`);
    await writeFile(sourcePath, migrationSql);
    const resources = migrationResources(name, namespace, contentDigest, migrationSql, first.runtime);
    await writeFile(manifestPath, `${JSON.stringify({ apiVersion: 'applik8s.migration/v1alpha1', kind: 'GeneratedApplicationMigration', metadata: { name }, spec: { digest: contentDigest, source: migration.path, models: ordered.map((model) => model.name), resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })) } }, null, 2)}\n`);
    artifacts.push({ name, digest: contentDigest, sourcePath, manifestPath, resources });
  }
  return artifacts;
}

async function applicationMigrationSource(path: string, entrypoint: string): Promise<string> {
  const resolved = isAbsolute(path) ? path : join(dirname(entrypoint), path);
  let info: Stats;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(`Native migration artifact ${path} does not exist relative to ${entrypoint}.`);
  }
  const files = info.isDirectory() ? await sqlFiles(resolved) : [resolved];
  if (files.length === 0) throw new Error(`Native migration artifact ${path} contains no .sql files.`);
  return (await Promise.all(files.map(async (file) => `-- application-migration: ${relative(resolved, file) || file.split('/').pop()}\n${await readFile(file, 'utf8')}`))).join('\n\n');
}

async function sqlFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sqlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.sql')) result.push(path);
  }
  return result;
}

function frameworkMigrationSql(models: readonly ApplicationModelNode[]): string {
  const statements = [
    'CREATE TABLE IF NOT EXISTS applik8s_command_inbox (scope text PRIMARY KEY, binding_id text NOT NULL, model text NOT NULL, target_key text NOT NULL, idempotency_key text NOT NULL, message_id text NOT NULL, input jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now());',
    'CREATE TABLE IF NOT EXISTS applik8s_command_results (scope text PRIMARY KEY REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, output jsonb, error jsonb, model_revision text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(), CHECK ((output IS NULL) <> (error IS NULL)));',
    'CREATE TABLE IF NOT EXISTS applik8s_model_transitions (id text PRIMARY KEY, scope text NOT NULL REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, model text NOT NULL, target_key text NOT NULL, before_state jsonb NOT NULL, after_state jsonb NOT NULL, model_revision text NOT NULL, committed_at timestamptz NOT NULL DEFAULT now());',
    'CREATE TABLE IF NOT EXISTS applik8s_model_history (id text PRIMARY KEY, scope text NOT NULL REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, model text NOT NULL, target_key text NOT NULL, before_state jsonb NOT NULL, after_state jsonb NOT NULL, model_revision text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());',
    'CREATE TABLE IF NOT EXISTS applik8s_event_outbox (id text PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, scope text NOT NULL REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, contract_name text NOT NULL, contract_version text NOT NULL, partition_key text NOT NULL, envelope jsonb NOT NULL, payload jsonb NOT NULL, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());',
    'ALTER TABLE applik8s_event_outbox ADD COLUMN IF NOT EXISTS sequence bigint GENERATED ALWAYS AS IDENTITY;',
    'CREATE UNIQUE INDEX IF NOT EXISTS applik8s_event_outbox_sequence ON applik8s_event_outbox (sequence);',
    'CREATE TABLE IF NOT EXISTS applik8s_public_stream_events (id text PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, contract_name text NOT NULL, contract_version text NOT NULL, partition_key text NOT NULL, envelope jsonb NOT NULL, payload jsonb NOT NULL, context_digest text, recorded_at timestamptz NOT NULL);',
    'CREATE UNIQUE INDEX IF NOT EXISTS applik8s_public_stream_events_sequence ON applik8s_public_stream_events (sequence);',
    'CREATE INDEX IF NOT EXISTS applik8s_public_stream_events_contract_sequence ON applik8s_public_stream_events (contract_name, contract_version, sequence);',
    'CREATE INDEX IF NOT EXISTS applik8s_public_stream_events_contract_recorded_at ON applik8s_public_stream_events (contract_name, contract_version, recorded_at);',
    'CREATE INDEX IF NOT EXISTS applik8s_public_stream_events_context_sequence ON applik8s_public_stream_events (contract_name, contract_version, context_digest, sequence);',
    'CREATE TABLE IF NOT EXISTS applik8s_command_outbox (id text PRIMARY KEY, scope text NOT NULL REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, contract_name text NOT NULL, contract_version text NOT NULL, partition_key text NOT NULL, envelope jsonb NOT NULL, payload jsonb NOT NULL, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());',
    'CREATE INDEX IF NOT EXISTS applik8s_event_outbox_pending ON applik8s_event_outbox (created_at) WHERE published_at IS NULL;',
    'CREATE INDEX IF NOT EXISTS applik8s_command_outbox_pending ON applik8s_command_outbox (created_at) WHERE published_at IS NULL;',
    "CREATE TABLE IF NOT EXISTS applik8s_model_changes (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, model text NOT NULL, operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'invalidate', 'reset')), identity jsonb, revision text, context_digest text NOT NULL, changed_fields jsonb, recorded_at timestamptz NOT NULL);",
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_context_sequence ON applik8s_model_changes (context_digest, sequence);',
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_model_sequence ON applik8s_model_changes (model, sequence);',
  ];
  for (const model of models) {
    const runtime = model.runtime?.nativeRelational;
    const table = model.runtime ? qualifiedIdentifier(model.runtime.tableName, runtime?.schema) : undefined;
    if (!runtime?.access || !table) continue;
    const accessColumn = runtime.access.column;
    const policy = quoteIdentifier(`applik8s_${model.runtime?.tableName}_${runtime.access.context}`);
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    statements.push(`DROP POLICY IF EXISTS ${policy} ON ${table};`);
    statements.push(`CREATE POLICY ${policy} ON ${table} USING (${quoteIdentifier(accessColumn)}::text = current_setting(${quoteLiteral(runtime.access.setting)}, true)) WITH CHECK (${quoteIdentifier(accessColumn)}::text = current_setting(${quoteLiteral(runtime.access.setting)}, true));`);
  }
  return statements.join('\n\n');
}

function psqlMigrationScript(name: string, digest: string, application: string, framework: string): string {
  return `\\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended(${quoteLiteral(`applik8s:migration:${name}`)}, 0));
CREATE TABLE IF NOT EXISTS applik8s_migration_history (digest text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
SELECT EXISTS (SELECT 1 FROM applik8s_migration_history WHERE digest = ${quoteLiteral(digest)}) AS applik8s_already_applied \\gset
\\if :applik8s_already_applied
\\echo 'applik8s-migration already applied ${digest}'
\\else
${application}

${framework}

INSERT INTO applik8s_migration_history (digest, name) VALUES (${quoteLiteral(digest)}, ${quoteLiteral(name)});
\\endif
SELECT pg_advisory_unlock(hashtextextended(${quoteLiteral(`applik8s:migration:${name}`)}, 0));
`;
}

function migrationResources(name: string, namespace: string | undefined, digest: string, migrationSql: string, runtime: NonNullable<ApplicationModelNode['runtime']>): readonly GeneratedApplicationMigrationResource[] {
  const labels = { 'app.kubernetes.io/name': name, 'app.kubernetes.io/component': 'migration', 'app.kubernetes.io/managed-by': 'applik8s' };
  const metadata = { name, ...(namespace ? { namespace } : {}), labels, annotations: { 'applik8s.dev/migration-digest': digest } };
  return [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata, data: { 'migration.sql': migrationSql } },
    {
      apiVersion: 'batch/v1', kind: 'Job', metadata, spec: {
        backoffLimit: 6, activeDeadlineSeconds: 900, ttlSecondsAfterFinished: 86_400,
        template: { metadata: { labels }, spec: { restartPolicy: 'OnFailure', containers: [{ name: 'migration', image: 'postgres:17-alpine', command: ['sh', '-c', 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql'], env: [{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: runtime.secretName, key: runtime.secretKey } } }, { name: 'PGCONNECT_TIMEOUT', value: '10' }], volumeMounts: [{ name: 'migration', mountPath: '/migrations', readOnly: true }] }], volumes: [{ name: 'migration', configMap: { name } }] } },
      },
    },
  ];
}

function kubernetesName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'migration';
}

function qualifiedIdentifier(table: string, schema?: string): string {
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}` : quoteIdentifier(table);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
