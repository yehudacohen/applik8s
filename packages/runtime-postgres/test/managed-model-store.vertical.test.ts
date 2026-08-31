import {
  runApplicationManagedModelOnce,
  type ApplicationManagedModelRuntimeBinding,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import postgres from 'postgres';
import { afterAll, describe, expect, test } from 'vitest';
import {
  createPostgresApplicationManagedModelStore,
  postgresApplicationManagedModelMigrationSql,
} from '../src/managed-model-store.js';

const databaseUrl = process.env.APPLIK8S_JOB_POSTGRES_URL;
const requiredDatabaseUrl = databaseUrl ?? 'postgres://managed-model-live-test-not-configured';
const live = databaseUrl ? describe : describe.skip;

describe('PostgreSQL managed-model migration', () => {
  test('declares isolated lifecycle, invalidation, lease, status, condition, and next-due authority', () => {
    const sql = postgresApplicationManagedModelMigrationSql('managed_test').join('\n');
    expect(sql).toContain('applik8s_managed_model_lifecycle');
    expect(sql).toContain('desired_digest');
    expect(sql).toContain('lease_fence');
    expect(sql).toContain('conditions jsonb');
    expect(sql).toContain('applik8s_managed_model_invalidations');
  });
});

live('PostgreSQL managed-model store', () => {
  const applicationId = `managed-model-${crypto.randomUUID()}`;
  const values = new Map<string, { version: string }>();
  const store = createPostgresApplicationManagedModelStore<string, { version: string }, {
    observedGeneration: number;
    phase: 'Pending' | 'Ready';
  }>({
    databaseUrl: requiredDatabaseUrl,
    applicationId,
    model: 'Workspace',
    statusSchemaVersion: '1',
    readValue: async id => values.get(id),
  });

  afterAll(async () => {
    await store.close();
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`DELETE FROM applik8s_managed_model_invalidations WHERE application_id = ${applicationId}`;
      await sql`DELETE FROM applik8s_managed_model_lifecycle WHERE application_id = ${applicationId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('survives process replacement while preserving generation, fencing, and next-due state', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    values.set('workspace-1', { version: '1.0.0' });
    await store.observeDesired('workspace-1', { version: '1.0.0' }, {
      observedGeneration: 0,
      phase: 'Pending',
    }, { now: '2026-01-01T00:00:00.000Z' });
    let clock = new Date('2026-01-01T00:00:05.000Z');
    const binding: ApplicationManagedModelRuntimeBinding<string, { version: string }, {
      observedGeneration: number;
      phase: 'Pending' | 'Ready';
    }> = {
      model: 'Workspace',
      status: type({ observedGeneration: 'number.integer >= 0', phase: "'Pending' | 'Ready'" }),
      leaseDurationSeconds: 60,
      conditionTypes: ['Ready'],
      finalizers: [],
      reconcile: async (workspace, context) => {
        await workspace.status.update({
          observedGeneration: workspace.metadata.generation,
          phase: 'Ready',
        });
        await workspace.conditions.set({
          type: 'Ready', status: 'True', reason: 'Converged', message: workspace.value.version,
        });
        return context.requeueAfter('20s');
      },
    };
    expect(await runApplicationManagedModelOnce({ store, binding, now: () => clock }))
      .toMatchObject({ kind: 'reconciled', generation: 1, nextDueAt: '2026-01-01T00:00:25.000Z' });

    const replacement = createPostgresApplicationManagedModelStore<string, { version: string }, {
      observedGeneration: number;
      phase: 'Pending' | 'Ready';
    }>({
      databaseUrl: requiredDatabaseUrl,
      applicationId,
      model: 'Workspace',
      statusSchemaVersion: '1',
      readValue: async id => values.get(id),
    });
    clock = new Date('2026-01-01T00:00:25.000Z');
    expect((await runApplicationManagedModelOnce({ store: replacement, binding, now: () => clock })).kind)
      .toBe('reconciled');
    values.set('workspace-1', { version: '2.0.0' });
    const updated = await replacement.observeDesired('workspace-1', { version: '2.0.0' }, {
      observedGeneration: 0,
      phase: 'Pending',
    }, { now: '2026-01-01T00:00:30.000Z' });
    expect(updated.metadata.generation).toBe(2);
    await replacement.close();
  });
});
