// typecast-file-boundary: managed-model tests use focused PostgreSQL row fixtures to exercise durable lifecycle validation.
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
    expect(sql).toContain("jsonb_typeof(status) = 'string'");
    expect(sql).toContain("jsonb_typeof(conditions) = 'string'");
    expect(sql).toContain("jsonb_typeof(finalizers) = 'string'");
    expect(sql).toContain('applik8s_managed_model_invalidations');
    expect(sql).toContain('applik8s_managed_model_activations');
    expect(sql).toContain('activated_count bigint');
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
      await sql`DELETE FROM applik8s_managed_model_activations WHERE application_id = ${applicationId}`;
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
    const verificationSql = postgres(requiredDatabaseUrl, { max: 1 });
    try {
      const [stored] = await verificationSql<readonly {
        status_type: string;
        conditions_type: string;
        finalizers_type: string;
      }[]>`
        SELECT jsonb_typeof(status) AS status_type,
               jsonb_typeof(conditions) AS conditions_type,
               jsonb_typeof(finalizers) AS finalizers_type
        FROM applik8s_managed_model_lifecycle
        WHERE application_id = ${applicationId}
          AND model_name = 'Workspace'
      `;
      expect(stored).toEqual({
        status_type: 'object',
        conditions_type: 'array',
        finalizers_type: 'array',
      });
    } finally {
      await verificationSql.end({ timeout: 5 });
    }

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

  test('retains deletion state across row removal and starts a fresh incarnation only after finalization', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const identity = 'workspace-deletion';
    const deletionStore = createPostgresApplicationManagedModelStore<string, { version: string }, {
      observedGeneration: number;
      phase: 'Pending' | 'Ready';
    }>({
      databaseUrl: requiredDatabaseUrl,
      applicationId,
      model: 'WorkspaceDeletion',
      statusSchemaVersion: '1',
      readValue: async id => values.get(id),
      deleteValue: async id => {
        values.delete(id);
      },
    });
    const initialStatus = { observedGeneration: 0, phase: 'Pending' } as const;
    const originalValue = { version: '1.0.0' };
    values.set(identity, originalValue);
    const original = await deletionStore.observeDesired(identity, originalValue, initialStatus, {
      now: '2026-01-02T00:00:00.000Z',
    });
    const lease = await deletionStore.claimNext({
      model: 'WorkspaceDeletion',
      now: '2026-01-02T00:00:01.000Z',
      leaseDurationSeconds: 60,
    });
    if (!lease || lease.record.id !== identity) throw new Error('expected deletion lifecycle lease');
    const precondition = {
      model: 'WorkspaceDeletion',
      id: identity,
      uid: lease.record.metadata.uid,
      generation: lease.record.metadata.generation,
      resourceVersion: lease.record.metadata.resourceVersion,
      fence: lease.fence,
    };
    await deletionStore.ensureFinalizers(precondition, ['workspaces.applik8s.dev/cleanup'], '2026-01-02T00:00:01.000Z');
    await deletionStore.markDeletion(identity, {
      now: '2026-01-02T00:00:02.000Z',
      value: originalValue,
    });
    const deleting = await deletionStore.read(identity);
    expect(deleting).toMatchObject({
      value: originalValue,
      metadata: {
        uid: original.metadata.uid,
        deletionTimestamp: '2026-01-02T00:00:02.000Z',
        finalizers: ['workspaces.applik8s.dev/cleanup'],
      },
    });
    await expect(deletionStore.observeDesired(identity, { version: '2.0.0' }, initialStatus))
      .rejects.toThrow(/still finalizing deletion/);

    const cleanupLease = await deletionStore.claimNext({
      model: 'WorkspaceDeletion',
      now: '2026-01-02T00:00:03.000Z',
      leaseDurationSeconds: 60,
    });
    if (!cleanupLease || cleanupLease.record.id !== identity) throw new Error('expected cleanup lease');
    const cleanupPrecondition = {
      model: 'WorkspaceDeletion',
      id: identity,
      uid: cleanupLease.record.metadata.uid,
      generation: cleanupLease.record.metadata.generation,
      resourceVersion: cleanupLease.record.metadata.resourceVersion,
      fence: cleanupLease.fence,
    };
    const withoutFinalizer = await deletionStore.removeFinalizer(
      cleanupPrecondition,
      'workspaces.applik8s.dev/cleanup',
      '2026-01-02T00:00:03.000Z',
    );
    const completedDeletion = await deletionStore.complete({ ...cleanupPrecondition, resourceVersion: withoutFinalizer.metadata.resourceVersion }, {
      now: '2026-01-02T00:00:03.000Z',
    });
    expect(completedDeletion.metadata).toMatchObject({
      deletionTimestamp: '2026-01-02T00:00:02.000Z',
      finalizers: [],
    });
    expect(values.has(identity)).toBe(false);

    const replacementValue = { version: '2.0.0' };
    values.set(identity, replacementValue);
    const replacement = await deletionStore.observeDesired(identity, replacementValue, initialStatus, {
      now: '2026-01-02T00:00:04.000Z',
    });
    expect(replacement.metadata).toMatchObject({ generation: 1, resourceVersion: '1', finalizers: [] });
    expect(replacement.metadata.uid).not.toBe(original.metadata.uid);
    expect(replacement.metadata.deletionTimestamp).toBeUndefined();
    await deletionStore.close();
  });

  test('activates existing rows through a durable cursor and resumes idempotently after process replacement', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const activationValues = new Map([
      ['activation-a', { version: '1.0.0' }],
      ['activation-b', { version: '1.0.0' }],
      ['activation-c', { version: '1.0.0' }],
    ]);
    const createActivationStore = (statusSchemaVersion = '1') => createPostgresApplicationManagedModelStore<string, { version: string }, {
      observedGeneration: number;
      phase: 'Pending' | 'Ready';
    }>({
      databaseUrl: requiredDatabaseUrl,
      applicationId,
      model: 'WorkspaceActivation',
      statusSchemaVersion,
      readValue: async id => activationValues.get(id),
    });
    const initialStatus = { observedGeneration: 0, phase: 'Pending' } as const;
    const scanPage = async ({ cursor, limit }: { readonly cursor?: string; readonly limit: number }) => {
      const entries = [...activationValues.entries()].sort(([left], [right]) => left.localeCompare(right));
      const offset = cursor === undefined ? 0 : entries.findIndex(([identity]) => identity === cursor) + 1;
      const page = entries.slice(offset, offset + limit);
      const last = page.at(-1);
      return {
        items: page.map(([identity, value]) => ({ identity, value })),
        ...(offset + page.length < entries.length && last
          ? { nextCursor: last[0] }
          : {}),
      };
    };

    const first = createActivationStore();
    expect(await first.activateExisting({ initialStatus, scanPage, pageSize: 1, maximumPages: 1 }))
      .toEqual({ activated: 1, completed: false });
    const firstRecord = await first.read('activation-a');
    expect(firstRecord?.metadata).toMatchObject({ generation: 1, resourceVersion: '1' });
    await first.close();

    const replacement = createActivationStore();
    expect(await replacement.activateExisting({ initialStatus, scanPage, pageSize: 1 }))
      .toEqual({ activated: 2, completed: true });
    expect(await replacement.activateExisting({ initialStatus, scanPage, pageSize: 1 }))
      .toEqual({ activated: 0, completed: true });
    expect((await replacement.read('activation-a'))?.metadata.uid).toBe(firstRecord?.metadata.uid);
    expect(await replacement.read('activation-c')).toMatchObject({
      id: 'activation-c',
      metadata: { generation: 1, resourceVersion: '1' },
    });
    await replacement.close();

    const incompatible = createActivationStore('2');
    await expect(incompatible.activateExisting({ initialStatus, scanPage, pageSize: 1 }))
      .rejects.toThrow(/requires status schema 1 to migrate to 2/);
    await incompatible.close();
  });
});
