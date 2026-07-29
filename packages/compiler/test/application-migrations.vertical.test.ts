import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationGraph, ApplicationModelNode } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationMigrations } from '../src/application-migrations/index.js';

describe('native relational migration lowering', () => {
  it('composes immutable application/framework SQL and an advisory-locked generated job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-native-migrations-'));
    const migrations = join(root, 'drizzle');
    await mkdir(migrations);
    await writeFile(join(migrations, '0001_cards.sql'), 'CREATE TABLE cards (id text PRIMARY KEY, organization_id text NOT NULL, revision text NOT NULL);\n');
    const graph = nativeGraph('./drizzle');
    const [artifact] = await emitGeneratedApplicationMigrations({ graph, entrypoint: join(root, 'app.ts'), outDir: join(root, 'out') });
    expect(artifact?.digest).toMatch(/^sha256:/);
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('pg_advisory_lock');
    expect(source).toContain('applik8s_migration_history');
    expect(source).toContain("migration_kind = 'application'");
    expect(source).toContain("migration_key = '0001_cards.sql'");
    expect(source).toContain('RAISE EXCEPTION USING MESSAGE');
    expect(source).not.toContain('\\quit 3');
    expect(source).toContain('applik8s framework migration already applied');
    expect(source).toContain('CREATE TABLE cards');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS applik8s_model_changes');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors');
    expect(source).toContain('ALTER TABLE "cards" FORCE ROW LEVEL SECURITY');
    expect(source).toContain('"organization_id"::text = current_setting(\'applik8s.context.organizationId\', true)');
    expect(artifact?.container).toMatchObject({
      image: expect.stringMatching(/^applik8s\/catalog-migration-catalog-catalog-migration-[0-9a-f]{12}:sha-[0-9a-f]{64}$/),
      baseImage: 'postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193',
      entrypoint: '/migrations/migration.sql',
      command: ['sh', '-c', expect.stringContaining('database did not become ready within 600 seconds')],
    });
    expect(artifact?.name).toMatch(/^catalog-catalog-migration-[0-9a-f]{12}$/);
    expect(artifact?.name).not.toContain(artifact?.digest.slice('sha256:'.length, 'sha256:'.length + 12));
    await expect(readFile(artifact?.container.dockerfilePath ?? '', 'utf8')).resolves.toContain(
      `COPY --chown=1000:1000 ${artifact?.name}.sql /migrations/migration.sql`,
    );
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual(['Job']);
    expect(artifact?.resources[0]).toMatchObject({ spec: { template: { spec: {
      automountServiceAccountToken: false,
      terminationGracePeriodSeconds: 30,
      containers: [{
        image: artifact?.container.image,
        env: expect.arrayContaining([{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'catalog-app', key: 'uri' } } }]),
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } },
      }],
    } } } });
    expect(artifact?.resources[0]?.spec).not.toHaveProperty('ttlSecondsAfterFinished');
    expect(JSON.stringify(artifact?.resources)).not.toContain('configMap');
  });

  it('fails closed when a declared immutable digest does not match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-native-migrations-digest-'));
    await writeFile(join(root, 'migration.sql'), 'SELECT 1;\n');
    await expect(emitGeneratedApplicationMigrations({ graph: nativeGraph('./migration.sql', 'sha256:not-the-content'), entrypoint: join(root, 'app.ts'), outDir: join(root, 'out') })).rejects.toThrow('digest mismatch');
  });

  it('fails closed when a native relational app omits its migration authority', async () => {
    const graph = nativeGraph('./unused.sql');
    const model = graph.nodes[0];
    if (model?.kind !== 'model' || !model.native) throw new Error('Expected native model fixture.');
    const { migrations: _migrations, ...artifact } = model.native.artifact;
    const missing: ApplicationModelNode = { ...model, native: { ...model.native, artifact } };
    await expect(emitGeneratedApplicationMigrations({ graph: { ...graph, nodes: [missing] }, entrypoint: '/tmp/app.ts', outDir: '/tmp/out' })).rejects.toThrow('no committed migration artifact');
  });

  it('gives each physical database authority a distinct immutable migration Job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-native-migrations-authority-'));
    await writeFile(join(root, 'migration.sql'), 'SELECT 1;\n');
    const original = nativeGraph('./migration.sql');
    const model = original.nodes[0];
    if (model?.kind !== 'model' || !model.runtime) throw new Error('Expected native model fixture.');
    const moved: ApplicationModelNode = {
      ...model,
      runtime: {
        ...model.runtime,
        clusterName: 'catalog-models',
        secretName: 'catalog-models-app',
      },
    };
    const [before] = await emitGeneratedApplicationMigrations({
      graph: original,
      entrypoint: join(root, 'app.ts'),
      outDir: join(root, 'before'),
    });
    const [after] = await emitGeneratedApplicationMigrations({
      graph: { ...original, nodes: [moved] },
      entrypoint: join(root, 'app.ts'),
      outDir: join(root, 'after'),
    });
    expect(after?.digest).toBe(before?.digest);
    expect(after?.name).not.toBe(before?.name);
    expect(after?.resources[0]).toMatchObject({
      metadata: { name: after?.name },
      spec: { template: { spec: { containers: [{
        env: expect.arrayContaining([
          { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'catalog-models-app', key: 'uri' } } },
        ]),
      }] } } },
    });
  });
});

function nativeGraph(path: string, digest?: string): ApplicationGraph {
  const model: ApplicationModelNode = {
    id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', entity: { name: 'Card' },
    store: { interface: 'ModelStore', nodeId: 'provider.model-store' },
    schema: { identity: ['id'], constraints: [], indexes: [], migrations: { strategy: 'external', compatibility: 'requiresExplicitMigration' }, transactions: 'required', retention: { mode: 'retain' }, guarantees: { identity: 'stableId', uniqueness: 'databaseConstraint', indexes: 'declaredSecondaryIndexes', transactions: 'required', retention: 'retain', migrationOwnership: 'external' } },
    materialization: { mode: 'providerBacked', provider: { interface: 'ModelStore', nodeId: 'provider.model-store' }, backingResources: [], connection: { env: {}, readiness: { dependencies: [], condition: 'ready', timeoutSeconds: 60 } }, runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' }, reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' } },
    native: { kind: 'drizzle-table', authority: 'postgres', artifact: { name: 'cards', database: 'catalog', migrations: { path, ...(digest ? { digest } : {}) } }, schemaAuthority: 'drizzle', runtimeSchema: 'derived-arktype', nativeApi: 'preserved' },
    common: { identity: { fields: ['id'], encoding: 'scalar' }, revision: { field: 'revision', authority: 'postgres-row' }, snapshot: { shape: 'identity-value-revision', revisionOptional: true }, changes: { authority: 'postgres-change-log', rawWrites: 'explicit-invalidation-required' }, relationships: [] },
    runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', connectionEnvName: 'DATABASE_URL', constraints: [], indexes: [], retention: { mode: 'retain' }, storageShape: 'native-relational', nativeRelational: { identity: { property: 'id', column: 'id' }, revision: { property: 'revision', column: 'revision' }, columns: [{ property: 'id', column: 'id' }, { property: 'organizationId', column: 'organization_id' }, { property: 'revision', column: 'revision' }], access: { context: 'organizationId', setting: 'applik8s.context.organizationId', property: 'organizationId', column: 'organization_id' } } },
  };
  return { apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'catalog', namespace: 'catalog-system' }, nodes: [model], edges: [], providerRequirements: [], providerBindings: [], compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] } };
}
