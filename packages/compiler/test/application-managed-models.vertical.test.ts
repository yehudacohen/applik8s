import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  applicationGraphFor,
  Database,
  ManagedModelStore,
  OperatorRuntime,
  Scheduler,
  TransactionalDatabase,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { emitGeneratedApplicationManagedModels } from '../src/application-managed-models/index.js';

describe('generated distributed managed-model operator', () => {
  test('bundles checkpointed activation, callback execution, health gates, and PostgreSQL lifecycle authority', async () => {
    const workspaces = pgTable('managed_operator_workspaces', {
      id: text('id').primaryKey(),
      version: text('version').notNull(),
    });
    const application = app('managed-operator', { namespace: 'managed-operator' });
    const database = application.provide(TransactionalDatabase, Database.postgres({
      name: 'catalog',
      namespace: 'managed-operator',
      database: 'catalog',
    }));
    const DatabaseBinding = application.database.bind('catalog', {
      provider: database,
      schema: { workspaces },
    });
    const Workspace = application.model(workspaces, {
      name: 'Workspace',
      database: DatabaseBinding,
    }).managed({
      status: type({ observedGeneration: 'number.integer >= 0', phase: "'Pending' | 'Ready'" }),
      initialStatus: { observedGeneration: 0, phase: 'Pending' },
      resync: { interval: '2m', maximumItems: 250 },
      lease: { duration: '45s' },
    });
    application.provide(Workspace.store, ManagedModelStore.postgres({ database }));
    const scheduler = application.provide(Scheduler, Scheduler.postgres({ database }));
    application.provide(OperatorRuntime, OperatorRuntime.distributed({ database, scheduler }));
    Workspace.on.reconcile(async workspace => {
      await workspace.status.update({
        observedGeneration: workspace.metadata.generation,
        phase: 'Ready',
      });
      await workspace.conditions.set({
        type: 'Ready',
        status: 'True',
        reason: 'Converged',
        message: workspace.value.version,
      });
    });
    Workspace.on.finalize(async workspace => {
      await workspace.conditions.remove('CleanupBlocked');
    }, { finalizer: 'workspaces.applik8s.dev/cleanup' });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected managed-model application graph.');
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-managed-operator-'));
    try {
      const [artifact] = await emitGeneratedApplicationManagedModels({
        graph,
        outDir,
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      });
      expect(artifact).toBeDefined();
      if (!artifact) throw new Error('Expected generated managed-model artifact.');
      expect(artifact?.modelIds).toEqual([expect.stringContaining('model')]);
      expect(artifact?.resources.map(({ kind }) => kind)).toEqual(['NetworkPolicy', 'Deployment']);
      const deployment = artifact?.resources.find(({ kind }) => kind === 'Deployment');
      expect(deployment?.spec).toMatchObject({
        replicas: 2,
        template: {
          spec: {
            containers: [{
              resources: {
                requests: { cpu: '50m', memory: '96Mi' },
                limits: { cpu: '500m', memory: '256Mi' },
              },
            }],
          },
        },
      });
      expect(JSON.stringify(deployment)).toContain('catalog-app');
      expect(JSON.stringify(deployment)).toContain('APPLIK8S_DATABASE_CATALOG_URL');
      const generated = await readFile(join(outDir, 'managed-operator-managed-models', 'managed-model-operator.generated.ts'), 'utf8');
      expect(generated).toContain('createPostgresApplicationManagedModelStore');
      expect(generated).toContain('activateExisting');
      expect(generated).toContain('scanPostgresApplicationManagedModelValues');
      expect(generated).toContain('createPostgresApplicationOperatorRuntime');
      expect(generated).toContain('withApplicationNativeModelReadClients');
      expect(generated).toContain("request.url === '/readyz'");
      expect(generated).toContain('resyncIntervalSeconds: 120');
      expect(generated).toContain('maximumResyncItems: 250');
      expect(generated).toContain('leaseDurationSeconds: 45');
      expect(generated).toContain('workspaces.applik8s.dev/cleanup');
      expect(generated).not.toContain('npm install');
      const bundled = await readFile(artifact.sourcePath, 'utf8');
      expect(bundled).toContain('activation exceeded its bounded migration window');
      expect(artifact?.container.baseImage).toMatch(/@sha256:/u);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  test('fails closed when a managed callback cannot be statically bundled', async () => {
    const records = pgTable('unresolved_managed_records', { id: text('id').primaryKey() });
    const application = app('unresolved-managed', { namespace: 'unresolved-managed' });
    const database = application.provide(TransactionalDatabase, Database.postgres({
      name: 'catalog', namespace: 'unresolved-managed', database: 'catalog',
    }));
    const DatabaseBinding = application.database.bind('catalog', { provider: database, schema: { records } });
    const Record = application.model(records, { name: 'Record', database: DatabaseBinding }).managed({
      status: type({ ready: 'boolean' }), initialStatus: { ready: false },
    });
    application.provide(Record.store, ManagedModelStore.postgres({ database }));
    const scheduler = application.provide(Scheduler, Scheduler.postgres({ database }));
    application.provide(OperatorRuntime, OperatorRuntime.distributed({ database, scheduler }));
    const callback = async () => undefined;
    Record.on.reconcile(callback);
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected graph.');
    const model = graph.nodes.find(node => node.kind === 'model' && node.name === 'Record');
    if (model?.kind !== 'model' || !model.managed) throw new Error('Expected managed model.');
    const managed = model.managed;
    const reconcile = managed.reconcile;
    if (!reconcile) throw new Error('Expected managed reconcile callback.');
    const brokenModel: typeof model = {
      ...model,
      managed: {
        ...managed,
        reconcile: {
          ...reconcile,
          handlerSource: reconcile.handlerSource,
          conditionTypes: reconcile.conditionTypes,
          handlerUnresolved: ['missingHelper'],
        },
      },
    };
    const broken = {
      ...graph,
      nodes: graph.nodes.map(node => node.id === model.id ? brokenModel : node),
    };
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-managed-unresolved-'));
    try {
      await expect(emitGeneratedApplicationManagedModels({
        graph: broken,
        outDir,
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      })).rejects.toThrow(/unresolved identifiers: missingHelper/u);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
