// typecast-file-boundary: negative fixtures deliberately cross the typed status API to prove runtime schema rejection.
import {
  ApplicationManagedModelConflictError,
  createDeterministicApplicationManagedModelStore,
  runApplicationManagedModelOnce,
  type ApplicationManagedModelRuntimeBinding,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { describe, expect, test } from 'vitest';

interface Workspace {
  readonly version: string;
}

interface WorkspaceStatus {
  readonly observedGeneration: number;
  readonly phase: 'Pending' | 'Ready' | 'Degraded';
}

const statusSchema = type({
  observedGeneration: 'number.integer >= 0',
  phase: "'Pending' | 'Ready' | 'Degraded'",
});

describe('application managed-model runtime', () => {
  test('reconciles invalidations with schema-complete status, condition stamping, and durable next-due intent', async () => {
    const store = createDeterministicApplicationManagedModelStore<string, Workspace, WorkspaceStatus>();
    store.putDesired('Workspace', 'workspace-1', { version: '1.0.0' }, {
      observedGeneration: 0,
      phase: 'Pending',
    }, '2026-01-01T00:00:00.000Z');
    let clock = new Date('2026-01-01T00:00:05.000Z');
    const binding: ApplicationManagedModelRuntimeBinding<string, Workspace, WorkspaceStatus> = {
      model: 'Workspace',
      status: statusSchema,
      leaseDurationSeconds: 60,
      conditionTypes: ['Ready'],
      finalizers: [],
      reconcile: async (workspace, context) => {
        await workspace.status.update({
          observedGeneration: workspace.metadata.generation,
          phase: 'Ready',
        });
        await workspace.conditions.set({
          type: 'Ready',
          status: 'True',
          reason: 'Converged',
          message: `version ${workspace.value.version}`,
        });
        return context.requeueAfter('30s');
      },
    };

    const result = await runApplicationManagedModelOnce({ store, binding, now: () => clock });
    expect(result).toMatchObject({
      kind: 'reconciled',
      id: 'workspace-1',
      generation: 1,
      nextDueAt: '2026-01-01T00:00:35.000Z',
    });
    const stored = store.inspect('Workspace', 'workspace-1');
    expect(stored?.status).toEqual({ observedGeneration: 1, phase: 'Ready' });
    expect(stored?.conditions).toEqual([{
      type: 'Ready',
      status: 'True',
      observedGeneration: 1,
      reason: 'Converged',
      message: 'version 1.0.0',
      lastTransitionTime: '2026-01-01T00:00:05.000Z',
    }]);

    clock = new Date('2026-01-01T00:00:34.000Z');
    expect(await runApplicationManagedModelOnce({ store, binding, now: () => clock })).toEqual({ kind: 'idle' });
    clock = new Date('2026-01-01T00:00:35.000Z');
    expect((await runApplicationManagedModelOnce({ store, binding, now: () => clock })).kind).toBe('reconciled');
    expect(store.inspect('Workspace', 'workspace-1')?.conditions[0]?.lastTransitionTime)
      .toBe('2026-01-01T00:00:05.000Z');
  });

  test('increments generation only for desired-value changes and fences stale commits', async () => {
    const store = createDeterministicApplicationManagedModelStore<string, Workspace, WorkspaceStatus>();
    const initialStatus: WorkspaceStatus = { observedGeneration: 0, phase: 'Pending' };
    store.putDesired('Workspace', 'workspace-1', { version: '1.0.0' }, initialStatus);
    const first = await store.claimNext({ model: 'Workspace', now: '2026-01-01T00:00:00.000Z', leaseDurationSeconds: 1 });
    if (!first) throw new Error('expected first lease');
    store.putDesired('Workspace', 'workspace-1', { version: '2.0.0' }, initialStatus);
    await expect(store.writeStatus({
      model: 'Workspace',
      id: 'workspace-1',
      uid: first.record.metadata.uid,
      generation: first.record.metadata.generation,
      resourceVersion: first.record.metadata.resourceVersion,
      fence: first.fence,
    }, { observedGeneration: 1, phase: 'Ready' }, '2026-01-01T00:00:00.500Z'))
      .rejects.toBeInstanceOf(ApplicationManagedModelConflictError);
    expect(store.inspect('Workspace', 'workspace-1')?.metadata.generation).toBe(2);
  });

  test('installs finalizers before reconcile and retains them across failed or requeued cleanup', async () => {
    const store = createDeterministicApplicationManagedModelStore<string, Workspace, WorkspaceStatus>();
    store.putDesired('Workspace', 'workspace-1', { version: '1.0.0' }, {
      observedGeneration: 0,
      phase: 'Pending',
    });
    let cleanupReady = false;
    const binding: ApplicationManagedModelRuntimeBinding<string, Workspace, WorkspaceStatus> = {
      model: 'Workspace',
      status: statusSchema,
      leaseDurationSeconds: 60,
      conditionTypes: [],
      reconcile: async () => {},
      finalizers: [{
        name: 'workspaces.applik8s.dev/cleanup',
        conditionTypes: ['CleanupBlocked'],
        async handler(workspace, context) {
          if (!cleanupReady) {
            await workspace.conditions.set({
              type: 'CleanupBlocked',
              status: 'True',
              reason: 'DependencyPresent',
              message: 'waiting',
            });
            return context.requeueAfter('10s');
          }
          await workspace.conditions.remove('CleanupBlocked');
          return undefined;
        },
      }],
    };
    await runApplicationManagedModelOnce({ store, binding });
    expect(store.inspect('Workspace', 'workspace-1')?.metadata.finalizers)
      .toEqual(['workspaces.applik8s.dev/cleanup']);
    store.deleteDesired('Workspace', 'workspace-1', '2026-01-01T00:00:00.000Z');
    let clock = new Date('2026-01-01T00:00:01.000Z');
    const blocked = await runApplicationManagedModelOnce({ store, binding, now: () => clock });
    expect(blocked.nextDueAt).toBe('2026-01-01T00:00:11.000Z');
    expect(store.inspect('Workspace', 'workspace-1')?.metadata.finalizers)
      .toEqual(['workspaces.applik8s.dev/cleanup']);
    cleanupReady = true;
    clock = new Date('2026-01-01T00:00:11.000Z');
    await runApplicationManagedModelOnce({ store, binding, now: () => clock });
    expect(store.inspect('Workspace', 'workspace-1')?.metadata.finalizers).toEqual([]);
  });

  test('rejects partial or unauthorized writes without advancing completion', async () => {
    const store = createDeterministicApplicationManagedModelStore<string, Workspace, WorkspaceStatus>();
    store.putDesired('Workspace', 'workspace-1', { version: '1.0.0' }, {
      observedGeneration: 0,
      phase: 'Pending',
    });
    const invalidStatus = await runApplicationManagedModelOnce({
      store,
      binding: {
        model: 'Workspace',
        status: statusSchema,
        leaseDurationSeconds: 60,
        conditionTypes: [],
        finalizers: [],
        reconcile: async workspace => {
          await workspace.status.update({ phase: 'Ready' } as WorkspaceStatus);
        },
      },
    });
    expect(invalidStatus).toMatchObject({ kind: 'failed', error: expect.stringContaining('status is invalid') });
    store.invalidate('Workspace', 'workspace-1');
    const invalidCondition = await runApplicationManagedModelOnce({
      store,
      binding: {
        model: 'Workspace',
        status: statusSchema,
        leaseDurationSeconds: 60,
        conditionTypes: ['Ready'],
        finalizers: [],
        reconcile: async workspace => {
          await workspace.conditions.set({
            type: 'Degraded',
            status: 'True',
            reason: 'NoAuthority',
            message: 'forbidden',
          });
        },
      },
    });
    expect(invalidCondition).toMatchObject({ kind: 'failed', error: expect.stringContaining('does not own condition Degraded') });
  });
});
