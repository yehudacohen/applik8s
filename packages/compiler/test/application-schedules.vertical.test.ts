import { describe, expect, it } from 'vitest';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';
import { generatedApplicationFetchGatewayModules } from '../src/application-fetch-gateway/index.js';

describe('v0.8 function-native schedule discovery', () => {
  it('publishes reachable schedules with qualified scheduler dependencies', async () => {
    const discovered = await discoverApplicationGraphWithExports(
      new URL('./fixtures/v08-schedule-app.ts', import.meta.url).pathname,
      'scheduleProof',
    );
    expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
    if (!discovered.ok) return;
    expect(discovered.value.scheduleExports).toEqual([
      { name: 'Cleanup', id: 'evidence.cleanup.v1' },
      { name: 'PollSource', id: 'source.poll.v1' },
    ]);
    expect(discovered.value.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'schedule.evidence.cleanup.v1',
        kind: 'schedule',
        scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
      }),
      expect.objectContaining({
        id: 'schedule.source.poll.v1',
        kind: 'schedule',
        scheduler: {
          interface: 'Scheduler',
          nodeId: 'provider.scheduler.v1alpha1.source-polling',
        },
      }),
      expect.objectContaining({
        id: 'provider.scheduler',
        kind: 'provider',
        implementation: 'target-selected',
      }),
      expect.objectContaining({
        id: 'provider.scheduler.v1alpha1.source-polling',
        kind: 'provider',
        implementation: 'hatchet-scheduler',
      }),
    ]));
    expect(discovered.value.graph.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ consumer: { nodeId: 'schedule.evidence.cleanup.v1' }, interface: 'Scheduler' }),
      expect.objectContaining({ consumer: { nodeId: 'schedule.source.poll.v1' }, interface: 'Scheduler' }),
    ]));
    const gateway = generatedApplicationFetchGatewayModules(discovered.value.graph);
    expect(gateway?.files['gateway.generated.ts']).toContain("installLocalApplicationScheduleRuntime");
    expect(gateway?.files['gateway.generated.ts']).toContain("APPLIK8S_DEPLOYMENT_TARGET === 'local'");
    expect(gateway?.files['gateway.generated.ts']).toContain('createKubernetesApplicationScheduleRuntime');
    expect(gateway?.files['gateway.generated.ts']).toContain('/__applik8s/v1/internal/schedules/occurrences');
    expect(gateway?.files['gateway.generated.ts']).toContain("requiredEnv('APPLIK8S_SCHEDULE_DATABASE_URL')");
    expect(gateway?.files['gateway.generated.ts']).toContain('evidence.cleanup.v1');
    expect(gateway?.files['gateway.generated.ts']).not.toContain('source.poll.v1');
  }, 60_000);
});
