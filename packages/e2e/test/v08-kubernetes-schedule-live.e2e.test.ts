// typecast-file-boundary: live Kubernetes JSON is narrowed after kind and metadata assertions.
import { randomUUID } from 'node:crypto';
import {
  createKubernetesApplicationScheduleRuntime,
} from '@applik8s/runtime-kubernetes';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  kubectl,
} from './live-e2e-helpers.js';

const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const namespace = `applik8s-v08-schedule-${suffix}`;
const applicationId = `v08-schedule-${suffix}`;

describeLive('v0.8 Kubernetes Scheduler lifecycle on OrbStack', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await kubectl(['create', 'namespace', namespace]);
  });

  afterAll(async () => {
    await kubectl(['delete', 'namespace', namespace, '--wait=true', '--timeout=120s']);
  });

  it('creates, noops, repairs drift, updates, and deletes one dynamic schedule identity', async () => {
    const runtime = await createKubernetesApplicationScheduleRuntime({
      applicationId,
      environmentId: 'orbstack',
      namespace,
      admissionEndpoint: `http://${applicationId}.${namespace}.svc.cluster.local/__applik8s/v1/internal/schedules/occurrences`,
      authorizationSecretName: `${applicationId}-internal-operation`,
    });
    const definition = {
      id: 'workspace-digest.v1',
      configuration: 'dynamic' as const,
      timezone: 'UTC',
      overlap: 'skip' as const,
      misfires: 'latest' as const,
      maximumLatenessSeconds: 300,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1_800 },
      requirements: {
        configuration: 'dynamic' as const,
        cardinality: 'bounded' as const,
        precision: 'minute' as const,
      },
    };
    const firstInstance = {
      id: 'workspace-a',
      revision: 'revision-one',
      input: { workspaceId: 'workspace-a' },
      every: '1h',
      enabled: false,
    };
    const created = await runtime.reconcile({ definition, instance: firstInstance, handler: async () => undefined });
    const unchanged = await runtime.reconcile({ definition, instance: firstInstance, handler: async () => undefined });
    expect([created.state, unchanged.state]).toEqual(['created', 'unchanged']);

    const resources = JSON.parse((await kubectl([
      'get', 'cronjob', '--namespace', namespace, '--output=json',
    ])).stdout) as {
      readonly items?: readonly [{ readonly metadata?: { readonly name?: string; readonly uid?: string }; readonly spec?: { readonly schedule?: string; readonly suspend?: boolean } }];
    };
    const live = resources.items?.[0];
    expect(live?.spec).toMatchObject({ schedule: '0 * * * *', suspend: true });
    const name = live?.metadata?.name;
    const uid = live?.metadata?.uid;
    if (!name || !uid) throw new Error('Kubernetes did not return the schedule CronJob identity.');

    await kubectl(['patch', 'cronjob', name, '--namespace', namespace, '--type=merge', '--patch', JSON.stringify({ spec: { schedule: '*/5 * * * *' } })]);
    const repaired = await runtime.reconcile({ definition, instance: firstInstance, handler: async () => undefined });
    expect(repaired.state).toBe('updated');
    expect(JSON.parse((await kubectl(['get', 'cronjob', name, '--namespace', namespace, '--output=json'])).stdout)).toMatchObject({
      metadata: { uid },
      spec: { schedule: '0 * * * *', suspend: true },
    });

    const updated = await runtime.reconcile({
      definition,
      instance: { ...firstInstance, revision: 'revision-two', every: '2h' },
      handler: async () => undefined,
    });
    expect(updated.state).toBe('updated');
    expect(JSON.parse((await kubectl(['get', 'cronjob', name, '--namespace', namespace, '--output=json'])).stdout)).toMatchObject({
      metadata: { uid, annotations: { 'applik8s.dev/schedule-revision': 'revision-two' } },
      spec: { schedule: '0 */2 * * *', suspend: true },
    });

    expect((await runtime.remove(definition.id, firstInstance.id)).state).toBe('removed');
    expect((await runtime.remove(definition.id, firstInstance.id)).state).toBe('unchanged');
    expect((await kubectl(['get', 'cronjob', name, '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
  }, 180_000);
});
