import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
    expect(source).toContain('CREATE TABLE cards');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS applik8s_model_changes');
    expect(source).toContain('ALTER TABLE "cards" FORCE ROW LEVEL SECURITY');
    expect(source).toContain('"organization_id"::text = current_setting(\'applik8s.context.organizationId\', true)');
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual(['ConfigMap', 'Job']);
    expect(artifact?.resources[1]).toMatchObject({ spec: { template: { spec: { containers: [{ env: expect.arrayContaining([{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'catalog-app', key: 'uri' } } }]) }] } } } });
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
