// typecast-file-boundary: Test doubles intentionally implement partial Kubernetes SDK APIs and custom-object payloads.
import type { KubeConfig, V1CronJob } from '@kubernetes/client-node';
import { describe, expect, test } from 'vitest';
import {
  createKubernetesApplicationScheduleRuntime,
  kubernetesApplicationScheduleCronJob,
} from '../src/index.js';

describe('Kubernetes function-native Scheduler', () => {
  test('renders a bounded fixed CronJob with stable provider execution identity', () => {
    const cronJob = kubernetesApplicationScheduleCronJob({
      applicationId: 'demo',
      environmentId: 'test',
      namespace: 'demo',
      name: 'schedule-cleanup',
      image: 'demo@sha256:abc',
      admissionEndpoint: 'http://demo.demo.svc:3000/__applik8s/v1/internal/schedules/occurrences',
      authorizationSecretName: 'demo-internal-operation',
      definition: {
        id: 'cleanup.v1',
        configuration: 'fixed',
        every: '15m',
        timezone: 'UTC',
        overlap: 'skip',
        misfires: 'latest',
        retry: { maxAttempts: 4, maximumAgeSeconds: 3600 },
        requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' },
      },
    });
    expect(cronJob).toMatchObject({
      metadata: { namespace: 'demo' },
      spec: {
        schedule: '*/15 * * * *',
        timeZone: 'UTC',
        concurrencyPolicy: 'Forbid',
        jobTemplate: { spec: { backoffLimit: 3, template: { spec: { restartPolicy: 'Never' } } } },
      },
    });
    expect(JSON.stringify(cronJob)).toContain("batch.kubernetes.io/job-name");
    expect(JSON.stringify(cronJob)).toContain('APPLIK8S_INTERNAL_OPERATION_SECRET');
  });

  test('creates, noops, replaces, and removes dynamic CronJobs by revision', async () => {
    const resources = new Map<string, V1CronJob>();
    const api = {
      async readNamespacedCronJob({ name }: { readonly name: string }) {
        const value = resources.get(name);
        if (!value) throw { code: 404 };
        return structuredClone(value);
      },
      async createNamespacedCronJob({ body }: { readonly body: V1CronJob }) {
        resources.set(body.metadata!.name!, structuredClone({
          ...body,
          metadata: { ...body.metadata, uid: 'schedule-uid' },
        }));
        return body;
      },
      async replaceNamespacedCronJob({ name, body }: { readonly name: string; readonly body: V1CronJob }) {
        const uid = resources.get(name)?.metadata?.uid;
        resources.set(name, structuredClone({
          ...body,
          metadata: { ...body.metadata, ...(uid ? { uid } : {}) },
        }));
        return body;
      },
      async deleteNamespacedCronJob({ name, body }: { readonly name: string; readonly body?: { readonly preconditions?: { readonly uid?: string } } }) {
        expect(body?.preconditions?.uid).toBe('schedule-uid');
        if (!resources.delete(name)) throw { response: { statusCode: 404 } };
        return {};
      },
    };
    const kubeConfig = { makeApiClient: () => api } as unknown as KubeConfig;
    const runtime = await createKubernetesApplicationScheduleRuntime({
      applicationId: 'demo', environmentId: 'test', namespace: 'demo',
      admissionEndpoint: 'http://demo.demo.svc/internal', authorizationSecretName: 'demo-internal-operation', kubeConfig,
    });
    const definition = {
      id: 'digest.v1', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const, misfires: 'latest' as const,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1800 },
      requirements: { configuration: 'dynamic' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };
    const first = await runtime.reconcile({ definition, instance: { id: 'tenant-a', revision: '1', input: {}, every: '1h' }, handler: async () => undefined });
    const same = await runtime.reconcile({ definition, instance: { id: 'tenant-a', revision: '1', input: {}, every: '1h' }, handler: async () => undefined });
    const live = [...resources.values()][0]!;
    live.spec!.schedule = '*/5 * * * *';
    const repaired = await runtime.reconcile({ definition, instance: { id: 'tenant-a', revision: '1', input: {}, every: '1h' }, handler: async () => undefined });
    const updated = await runtime.reconcile({ definition, instance: { id: 'tenant-a', revision: '2', input: {}, every: '2h' }, handler: async () => undefined });
    expect([first.state, same.state, repaired.state, updated.state]).toEqual(['created', 'unchanged', 'updated', 'updated']);
    expect([...resources.values()][0]?.spec?.schedule).toBe('0 */2 * * *');
    expect((await runtime.remove(definition.id, 'tenant-a')).state).toBe('removed');
    expect((await runtime.remove(definition.id, 'tenant-a')).state).toBe('unchanged');
  });
});
