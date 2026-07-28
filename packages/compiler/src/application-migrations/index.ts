// typecast-file-boundary: normalized migration graph nodes are discriminator-checked before compiler-specific projection.
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { ApplicationGraph, ApplicationModelNode, JsonObject } from '@applik8s/core';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { applicationGraphStringValue } from '../application-installation-values.js';

const DEFAULT_MIGRATION_IMAGE = 'postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193';

export interface GeneratedApplicationMigrationArtifact {
  readonly name: string;
  readonly digest: string;
  readonly sourcePath: string;
  readonly manifestPath: string;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationMigrationResource[];
}

export interface GeneratedApplicationMigrationResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & { readonly name: string; readonly namespace?: string };
}

interface ApplicationMigrationSource {
  readonly key: string;
  readonly sql: string;
  readonly digest: string;
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
    const key = `${runtime.authorityName ?? runtime.database}\0${migration.path}`;
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
    const sources = await applicationMigrationSources(migration.path, options.entrypoint);
    const framework = frameworkMigrationSql(ordered);
    const frameworkDigest = sha256(`framework\0${framework}`);
    const contentDigest = sha256(JSON.stringify({ application: sources.map(({ key, digest }) => ({ key, digest })), framework: frameworkDigest }));
    if (migration.digest && migration.digest !== contentDigest) {
      throw new Error(`Native migration artifact ${migration.path} digest mismatch: graph declares ${migration.digest}, compiler calculated ${contentDigest}.`);
    }
    const command = ['sh', '-c', 'attempt=0; until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; do attempt=$((attempt + 1)); if [ "$attempt" -ge 300 ]; then echo "database did not become ready within 600 seconds" >&2; exit 1; fi; sleep 2; done; exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql'] as const;
    // A Job template is immutable even when the migration SQL is unchanged.
    // Include its execution contract in the Kubernetes identity so compiler
    // fixes to the base image or command create a new, safely repeatable Job.
    // The SQL history continues to use contentDigest and therefore prevents
    // reapplying an already committed migration.
    const executionDigest = createHash('sha256')
      .update(contentDigest)
      .update('\0')
      .update(DEFAULT_MIGRATION_IMAGE)
      .update('\0')
      .update(JSON.stringify(command))
      .update('\0')
      // The same idempotent SQL must still execute once for each physical
      // database authority. A connection/cluster migration therefore needs a
      // fresh immutable Job even when the application schema is unchanged.
      .update(JSON.stringify({
        database: first.runtime.database,
        clusterName: first.runtime.clusterName,
        secretName: first.runtime.secretName,
        secretKey: first.runtime.secretKey,
        secretNamespace: first.runtime.secretNamespace,
      }))
      .digest('hex');
    // Jobs are immutable. Content-address their Kubernetes identity so a new
    // committed migration or execution-contract fix produces a new Job instead
    // of an unsafe patch of a completed predecessor.
    const authorityName = first.runtime.authorityName ?? first.runtime.database;
    const name = kubernetesName(`${options.graph.metadata.name}-${authorityName}-migration-${executionDigest.slice(0, 12)}`);
    // Generated resources are injected after TypeKro has serialized the base
    // composition, so they must carry the portable `${schema.spec...}` string
    // rather than a live TypeKro proxy object.
    const namespace = applicationGraphStringValue(first.runtime.secretNamespace)
      ?? applicationGraphStringValue(options.graph.metadata.namespace);
    const migrationSql = psqlMigrationScript(name, `${options.graph.metadata.name}:${authorityName}`, sources, framework, frameworkDigest);
    const sourcePath = join(options.outDir, `${name}.sql`);
    const manifestPath = join(options.outDir, `${name}.manifest.json`);
    await writeFile(sourcePath, migrationSql);
    const container = await emitGeneratedApplicationContainer({
      graphName: options.graph.metadata.name,
      workloadName: name,
      role: 'migration',
      artifactDir: join(options.outDir, name),
      sourcePath,
      destinationFileName: 'migration.sql',
      entrypoint: '/migrations/migration.sql',
      command,
      destinationDirectory: '/migrations',
      baseImage: DEFAULT_MIGRATION_IMAGE,
      sourceDigest: contentDigest,
    });
    const resources = migrationResources(name, namespace, contentDigest, container, first.runtime);
    await writeFile(manifestPath, `${JSON.stringify({ apiVersion: 'applik8s.migration/v1alpha1', kind: 'GeneratedApplicationMigration', metadata: { name }, spec: { digest: contentDigest, source: migration.path, applicationMigrations: sources.map(({ key, digest }) => ({ key, digest })), frameworkDigest, models: ordered.map((model) => model.name), distribution: 'ociImage', container, resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })) } }, null, 2)}\n`);
    artifacts.push({ name, digest: contentDigest, sourcePath, manifestPath, container, resources });
  }
  return artifacts;
}

async function applicationMigrationSources(path: string, entrypoint: string): Promise<readonly ApplicationMigrationSource[]> {
  const resolved = isAbsolute(path) ? path : join(dirname(entrypoint), path);
  let info: Stats;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(`Native migration artifact ${path} does not exist relative to ${entrypoint}.`);
  }
  const files = info.isDirectory() ? await sqlFiles(resolved) : [resolved];
  if (files.length === 0) throw new Error(`Native migration artifact ${path} contains no .sql files.`);
  const root = info.isDirectory() ? resolved : dirname(resolved);
  return Promise.all(files.map(async (file) => {
    const key = relative(root, file) || basename(file);
    const sql = await readFile(file, 'utf8');
    return { key, sql, digest: sha256(`application\0${key}\0${sql}`) };
  }));
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
    'CREATE TABLE IF NOT EXISTS applik8s_command_results (scope text PRIMARY KEY REFERENCES applik8s_command_inbox(scope) ON DELETE CASCADE, output jsonb, error jsonb, model_revision text NOT NULL, model_snapshot jsonb, model_deleted boolean NOT NULL DEFAULT false, completed_at timestamptz NOT NULL DEFAULT now(), CHECK ((output IS NULL) <> (error IS NULL)));',
    'ALTER TABLE applik8s_command_results ADD COLUMN IF NOT EXISTS model_snapshot jsonb;',
    'ALTER TABLE applik8s_command_results ADD COLUMN IF NOT EXISTS model_deleted boolean NOT NULL DEFAULT false;',
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
    'CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors (contract_name text NOT NULL, contract_version text NOT NULL, context_digest text NOT NULL, deleted_through bigint NOT NULL CHECK (deleted_through >= 0), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (contract_name, contract_version, context_digest));',
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

function psqlMigrationScript(name: string, lockScope: string, application: readonly ApplicationMigrationSource[], framework: string, frameworkDigest: string): string {
  const applicationSteps = application.map((migration) => `-- application-migration: ${migration.key}
SELECT EXISTS (
  SELECT 1 FROM applik8s_migration_history
  WHERE migration_kind = 'application' AND migration_key = ${quoteLiteral(migration.key)} AND digest = ${quoteLiteral(migration.digest)}
) AS applik8s_file_applied,
EXISTS (
  SELECT 1 FROM applik8s_migration_history
  WHERE migration_kind = 'application' AND migration_key = ${quoteLiteral(migration.key)} AND digest <> ${quoteLiteral(migration.digest)}
) AS applik8s_file_conflict \\gset
\\if :applik8s_file_conflict
DO $applik8s_migration_conflict$
BEGIN
  RAISE EXCEPTION USING MESSAGE = ${quoteLiteral(`applik8s-migration conflict: committed migration ${migration.key} changed after it was applied`)};
END
$applik8s_migration_conflict$;
\\endif
\\if :applik8s_file_applied
\\echo 'applik8s application migration already applied ${migration.key} ${migration.digest}'
\\else
BEGIN;
${migration.sql}
INSERT INTO applik8s_migration_history (digest, name, migration_kind, migration_key)
VALUES (${quoteLiteral(migration.digest)}, ${quoteLiteral(name)}, 'application', ${quoteLiteral(migration.key)});
COMMIT;
\\endif`).join('\n\n');
  return `\\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended(${quoteLiteral(`applik8s:migration:${lockScope}`)}, 0));
CREATE TABLE IF NOT EXISTS applik8s_migration_history (
  digest text PRIMARY KEY,
  name text NOT NULL,
  migration_kind text NOT NULL DEFAULT 'legacy',
  migration_key text,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE applik8s_migration_history ADD COLUMN IF NOT EXISTS migration_kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE applik8s_migration_history ADD COLUMN IF NOT EXISTS migration_key text;
CREATE UNIQUE INDEX IF NOT EXISTS applik8s_application_migration_key
ON applik8s_migration_history (migration_key) WHERE migration_kind = 'application';

${applicationSteps}

SELECT EXISTS (SELECT 1 FROM applik8s_migration_history WHERE digest = ${quoteLiteral(frameworkDigest)}) AS applik8s_framework_applied \\gset
\\if :applik8s_framework_applied
\\echo 'applik8s framework migration already applied ${frameworkDigest}'
\\else
BEGIN;
${framework}
INSERT INTO applik8s_migration_history (digest, name, migration_kind, migration_key)
VALUES (${quoteLiteral(frameworkDigest)}, ${quoteLiteral(name)}, 'framework', ${quoteLiteral(frameworkDigest)});
COMMIT;
\\endif
SELECT pg_advisory_unlock(hashtextextended(${quoteLiteral(`applik8s:migration:${lockScope}`)}, 0));
`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function migrationResources(name: string, namespace: string | undefined, digest: string, container: GeneratedApplicationContainerArtifact, runtime: NonNullable<ApplicationModelNode['runtime']>): readonly GeneratedApplicationMigrationResource[] {
  const labels = { 'app.kubernetes.io/name': name, 'app.kubernetes.io/component': 'migration', 'app.kubernetes.io/managed-by': 'applik8s' };
  const metadata = { name, ...(namespace ? { namespace } : {}), labels, annotations: { 'applik8s.dev/migration-digest': digest } };
  return [
    {
      apiVersion: 'batch/v1', kind: 'Job', metadata, spec: {
        // The content-addressed Job is part of a continuously reconciled
        // Application graph. Giving it a TTL would make Kubernetes delete the
        // completed Job and KRO recreate (and rerun) the migration forever.
        // A changed migration digest produces a new Job name; graph
        // reconciliation owns retirement of the superseded Job.
        backoffLimit: 6, activeDeadlineSeconds: 900,
        template: { metadata: { labels }, spec: {
          restartPolicy: 'OnFailure',
          automountServiceAccountToken: false,
          terminationGracePeriodSeconds: 30,
          containers: [{
            name: 'migration',
            image: container.image,
            command: [...container.command],
            env: [{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: runtime.secretName, key: runtime.secretKey } } }, { name: 'PGCONNECT_TIMEOUT', value: '10' }],
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } },
          }],
        } },
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
