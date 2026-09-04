// typecast-file-boundary: Test doubles intentionally implement partial Kubernetes SDK APIs and custom-object payloads.

import { createDeterministicApplicationScheduleStateAuthority } from '@applik8s/applik8s';
import type { KubeConfig, V1CronJob } from '@kubernetes/client-node';
import { describe, expect, test } from 'vitest';
import {
  createKubernetesApplicationScheduleRuntime,
  kubernetesApplicationScheduleCronJob,
} from '../src/index.js';

describe('Kubernetes function-native Scheduler', () => {
  test('fails closed instead of adopting ambient kubeconfig', async () => {
    await expect(createKubernetesApplicationScheduleRuntime({
      applicationId: 'demo',
      environmentId: 'test',
      namespace: 'demo',
      admissionEndpoint: 'http://demo.demo.svc/internal',
      authorizationSecretName: 'demo-internal-operation',
      stateAuthority: createDeterministicApplicationScheduleStateAuthority(),
    })).rejects.toThrow(/explicit kubeConfig or inCluster: true/u);
  });

  test('renders a bounded fixed CronJob with stable provider execution identity', () => {
    const cronJob = kubernetesApplicationScheduleCronJob({
      applicationId: 'demo',
      environmentId: 'test',
      namespace: 'demo',
      name: 'schedule-cleanup',
      image: 'demo@sha256:abc',
      admissionEndpoint: 'http://demo.demo.svc:3000/__applik8s/v1/internal/schedules/occurrences',
      authorizationSecretName: 'demo-internal-operation',
      serviceAccountName: 'demo-schedule-control',
      definition: {
        id: 'cleanup.v1',
        configuration: 'fixed',
        every: '15m',
        timezone: 'UTC',
        overlap: 'skip',
        misfires: 'latest',
        maximumLatenessSeconds: 300,
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
        jobTemplate: { spec: { backoffLimit: 3, template: { spec: {
          restartPolicy: 'Never',
          serviceAccountName: 'demo-schedule-control',
        } } } },
      },
    });
    expect(JSON.stringify(cronJob)).toContain("batch.kubernetes.io/job-name");
    expect(JSON.stringify(cronJob)).toContain("batch.kubernetes.io/cronjob-scheduled-timestamp");
    expect(JSON.stringify(cronJob)).toContain('NODE_EXTRA_CA_CERTS');
    expect(JSON.stringify(cronJob)).toContain('APPLIK8S_INTERNAL_OPERATION_SECRET');
    expect(cronJob.spec?.jobTemplate.spec?.template.spec?.containers[0]?.securityContext)
      .toMatchObject({ runAsNonRoot: true, runAsUser: 1000, readOnlyRootFilesystem: true });
  });

  test('projects elapsed intervals and absolute instants in UTC without changing their meaning', () => {
    const base = {
      applicationId: 'demo',
      environmentId: 'test',
      namespace: 'demo',
      image: 'demo@sha256:abc',
      admissionEndpoint: 'http://demo.demo.svc/internal',
      authorizationSecretName: 'demo-internal-operation',
    } as const;
    const contract = {
      configuration: 'fixed' as const,
      timezone: 'America/New_York',
      overlap: 'skip' as const,
      misfires: 'latest' as const,
      maximumLatenessSeconds: 300,
      retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
      requirements: { configuration: 'fixed' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };
    const interval = kubernetesApplicationScheduleCronJob({
      ...base,
      name: 'schedule-interval',
      definition: { ...contract, id: 'interval.v1', every: '2h' },
    });
    const oneTime = kubernetesApplicationScheduleCronJob({
      ...base,
      name: 'schedule-once',
      definition: { ...contract, id: 'once.v1', at: '2026-11-01T05:30:00.000Z' },
    });
    expect(interval.spec).toMatchObject({ schedule: '0 */2 * * *', timeZone: 'UTC' });
    expect(oneTime.spec).toMatchObject({ schedule: '30 5 1 11 *', timeZone: 'UTC' });
    const oneTimeAdmission = oneTime.spec?.jobTemplate.spec?.template.spec?.containers[0]?.env
      ?.find(({ name }) => name === 'APPLIK8S_SCHEDULE_ADMISSION')?.value;
    expect(JSON.parse(String(oneTimeAdmission))).toMatchObject({
      scheduledAt: '2026-11-01T05:30:00.000Z',
    });
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
      serviceAccountName: 'demo-schedule-control',
      stateAuthority: createDeterministicApplicationScheduleStateAuthority(),
      maximumInstances: 1,
    });
    const definition = {
      id: 'digest.v1', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const, misfires: 'latest' as const, maximumLatenessSeconds: 300,
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
    expect([...resources.values()][0]?.spec?.jobTemplate.spec?.template.spec?.serviceAccountName)
      .toBe('demo-schedule-control');
    await expect(runtime.reconcile({
      definition,
      instance: { id: 'tenant-b', revision: '1', input: {}, every: '1h' },
      handler: async () => undefined,
    })).rejects.toThrow(/instance ceiling 1 is exhausted/u);
    await expect(runtime.reconcile({
      definition: {
        ...definition,
        id: 'high-cardinality.v1',
        requirements: { ...definition.requirements, cardinality: 'high' as const },
      },
      instance: { id: 'tenant-high', revision: '1', input: {}, every: '1h' },
      handler: async () => undefined,
    })).rejects.toThrow(/requires bounded cardinality/u);
    expect((await runtime.remove(definition.id, 'tenant-a')).state).toBe('removed');
    expect((await runtime.remove(definition.id, 'tenant-a')).state).toBe('unchanged');
  });

  test('replays canonical state after provider projection is interrupted', async () => {
    const resources = new Map<string, V1CronJob>();
    let failCreate = true;
    const api = {
      async readNamespacedCronJob({ name }: { readonly name: string }) {
        const value = resources.get(name);
        if (!value) throw { code: 404 };
        return structuredClone(value);
      },
      async createNamespacedCronJob({ body }: { readonly body: V1CronJob }) {
        if (failCreate) {
          failCreate = false;
          throw new Error('simulated provider interruption');
        }
        resources.set(body.metadata!.name!, structuredClone({
          ...body,
          metadata: { ...body.metadata, uid: 'recovered-uid' },
        }));
        return body;
      },
      async replaceNamespacedCronJob() { throw new Error('unexpected replace'); },
      async deleteNamespacedCronJob() { return {}; },
    };
    const authority = createDeterministicApplicationScheduleStateAuthority();
    const options = {
      applicationId: 'demo', environmentId: 'test', namespace: 'demo',
      admissionEndpoint: 'http://demo.demo.svc/internal', authorizationSecretName: 'demo-internal-operation',
      kubeConfig: { makeApiClient: () => api } as unknown as KubeConfig,
      stateAuthority: authority,
    };
    const definition = {
      id: 'recover.v1', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const,
      misfires: 'latest' as const, maximumLatenessSeconds: 300,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1800 },
      requirements: { configuration: 'dynamic' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };
    const runtime = await createKubernetesApplicationScheduleRuntime(options);
    await expect(runtime.reconcile({
      definition,
      instance: { id: 'tenant-a', revision: '1', input: {}, every: '1h' },
      handler: async () => undefined,
    })).rejects.toThrow(/simulated provider interruption/u);
    expect(await authority.pending()).toHaveLength(1);

    await createKubernetesApplicationScheduleRuntime(options);
    expect(await authority.pending()).toHaveLength(0);
    expect([...resources.values()][0]?.metadata?.annotations?.['applik8s.dev/schedule-revision']).toBe('1');

    resources.clear();
    await createKubernetesApplicationScheduleRuntime(options);
    expect([...resources.values()][0]?.metadata?.annotations?.['applik8s.dev/schedule-revision']).toBe('1');
  });
});
