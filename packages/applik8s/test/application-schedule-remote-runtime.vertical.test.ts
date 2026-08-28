// typecast-file-boundary: The transport fixture deliberately supplies an opaque admitted caller at the remote-runtime boundary.

import { createRemoteApplicationScheduleRuntime } from '../src/application-schedule-remote-runtime.js';
import { describe, expect, it } from 'vitest';

describe('remote function-native schedule management', () => {
  it('sends exact provider identity, admission, instance, and authorization', async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined; readonly body: unknown }> = [];
    const runtime = createRemoteApplicationScheduleRuntime({
      endpoint: 'http://schedule-control.test/__applik8s/v1/internal/schedules/manage',
      authorization: 'runtime-secret',
      schedulerNodeId: 'provider.scheduler.hatchet.hosted',
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          init,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({
          ok: true,
          result: {
            definitionId: 'poll-source.v1',
            instanceId: 'source-a',
            revision: '2',
            state: 'updated',
          },
        });
      },
    });
    const result = await runtime.reconcile({
      definition: definition(),
      instance: {
        id: 'source-a',
        revision: '2',
        input: { sourceId: 'source-a' },
        cron: '*/5 * * * *',
        timezone: 'UTC',
        enabled: true,
      },
      handler: async () => undefined,
      management: management('configure'),
    });
    expect(result).toMatchObject({ state: 'updated', revision: '2' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'http://schedule-control.test/__applik8s/v1/internal/schedules/manage',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer runtime-secret',
          'content-type': 'application/json',
        },
      },
      body: {
        apiVersion: 'applik8s.scheduleManagementRequest/v1alpha1',
        action: 'configure',
        schedulerNodeId: 'provider.scheduler.hatchet.hosted',
        definitionId: 'poll-source.v1',
        instance: expect.objectContaining({ id: 'source-a', revision: '2' }),
        management: expect.objectContaining({ action: 'configure' }),
      },
    });
  });

  it('carries immediate caller admission and fails closed on provider errors', async () => {
    const bodies: unknown[] = [];
    const runtime = createRemoteApplicationScheduleRuntime({
      endpoint: 'https://schedule-control.test/manage',
      authorization: 'runtime-secret',
      schedulerNodeId: 'provider.scheduler',
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ error: 'schedule_definition_unknown' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await expect(runtime.invoke({
      definition: definition(),
      input: { sourceId: 'source-a' },
      handler: async () => undefined,
      callerAdmission: { correlationId: 'caller-1' } as never,
    })).rejects.toThrow('schedule_definition_unknown');
    expect(bodies[0]).toMatchObject({
      action: 'invoke',
      definitionId: 'poll-source.v1',
      callerAdmission: { correlationId: 'caller-1' },
    });
  });
});

function definition() {
  return {
    id: 'poll-source.v1',
    configuration: 'dynamic' as const,
    timezone: 'UTC',
    overlap: 'skip' as const,
    misfires: 'latest' as const,
    maximumLatenessSeconds: 300,
    retry: { maxAttempts: 4, maximumAgeSeconds: 21_600 },
    requirements: {
      configuration: 'dynamic' as const,
      cardinality: 'high' as const,
      precision: 'minute' as const,
    },
  };
}

function management(action: 'configure' | 'remove') {
  return {
    apiVersion: 'applik8s.scheduleManagement/v1alpha1' as const,
    id: `management-${action}`,
    action,
    definitionId: 'poll-source.v1',
    instanceId: 'source-a',
    revision: action === 'configure' ? '2' : 'removed',
    principalId: 'principal:test',
    authorityRevision: 'authority:test',
    trustedContextDigest: 'sha256:test',
    correlationId: 'caller-1',
    admittedAt: '2026-08-27T20:00:00.000Z',
  };
}
