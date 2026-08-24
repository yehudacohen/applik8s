import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { generatedApplicationFetchGatewayModules } from '../src/application-fetch-gateway/index.js';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';

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
			{ name: 'DefaultPoll', id: 'source.default-poll.v1' },
      { name: 'PollSource', id: 'source.poll.v1' },
    ]);
    expect(discovered.value.actorExports).toEqual([
      { name: 'Workspace', actorId: 'workspace.v1' },
    ]);
    expect(discovered.value.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'schedule.evidence.cleanup.v1',
        kind: 'schedule',
        scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
        providerBindings: [
          expect.objectContaining({
            provider: expect.objectContaining({
              interface: 'AcquisitionProvider',
              nodeId: 'provider.acquisition-provider.v1alpha1.primary',
            }),
            operation: expect.objectContaining({
              member: 'acquire',
              runtime: expect.objectContaining({
                module: '@fixture/acquisition/runtime',
                export: 'acquireItem',
              }),
            }),
          }),
        ],
      }),
      expect.objectContaining({
        id: 'schedule.source.poll.v1',
        kind: 'schedule',
        scheduler: {
          interface: 'Scheduler',
          nodeId: 'provider.scheduler.v1alpha1.source-polling',
        },
        providerBindings: [
          expect.objectContaining({
            provider: expect.objectContaining({
              interface: 'AcquisitionProvider',
              nodeId: 'provider.acquisition-provider.v1alpha1.primary',
            }),
            operation: expect.objectContaining({ member: 'acquire' }),
          }),
        ],
      }),
			expect.objectContaining({
				id: 'schedule.source.default-poll.v1',
				kind: 'schedule',
				definition: expect.objectContaining({
					overlapBy: expect.objectContaining({ source: expect.stringContaining('sourceBindingId') }),
				}),
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
      expect.objectContaining({
        id: 'actor.workspace.v1',
        kind: 'actor',
        providerBindings: [
          expect.objectContaining({
            provider: expect.objectContaining({
              interface: 'AcquisitionProvider',
              nodeId: 'provider.acquisition-provider.v1alpha1.primary',
            }),
          }),
        ],
      }),
    ]));
    expect(discovered.value.graph.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ consumer: { nodeId: 'schedule.evidence.cleanup.v1' }, interface: 'Scheduler' }),
      expect.objectContaining({ consumer: { nodeId: 'schedule.source.poll.v1' }, interface: 'Scheduler' }),
    ]));
    expect(discovered.value.graph.edges).toContainEqual({
      from: { nodeId: 'provider.acquisition-provider.v1alpha1.primary' },
      to: { nodeId: 'schedule.evidence.cleanup.v1' },
      relationship: 'provides',
    });
    expect(discovered.value.graph.edges).toContainEqual({
      from: { nodeId: 'provider.acquisition-provider.v1alpha1.primary' },
      to: { nodeId: 'actor.workspace.v1' },
      relationship: 'provides',
    });
    const gateway = generatedApplicationFetchGatewayModules(discovered.value.graph);
    expect(gateway?.files['gateway.generated.ts']).toContain("installLocalApplicationScheduleRuntime");
    expect(gateway?.files['gateway.generated.ts']).toContain("APPLIK8S_DEPLOYMENT_TARGET === 'local'");
    expect(gateway?.files['gateway.generated.ts']).toContain('createKubernetesApplicationScheduleRuntime');
    expect(gateway?.files['gateway.generated.ts']).toContain('installApplicationInvocationAdmissionResolver');
    expect(gateway?.files['gateway.generated.ts']).toContain('admissionRunner: scheduleAdmissionRunner');
    expect(gateway?.files['gateway.generated.ts']).toContain('createApplicationAdmissionObservationV1');
    expect(gateway?.files['gateway.generated.ts']).toContain("event: 'applik8s-schedule-admission'");
    expect(gateway?.files['gateway.generated.ts']).toContain("transport: 'schedule'");
    expect(gateway?.files['gateway.generated.ts']).not.toContain('evidence: { admission }');
    expect(gateway?.files['gateway.generated.ts']).toContain('/__applik8s/v1/internal/schedules/occurrences');
    expect(gateway?.files['gateway.generated.ts']).toContain("requiredEnv('APPLIK8S_SCHEDULE_DATABASE_URL')");
    expect(gateway?.files['gateway.generated.ts']).toContain('evidence.cleanup.v1');
    expect(gateway?.files['gateway.generated.ts']).toContain('source.poll.v1');
    expect(gateway?.files['gateway.generated.ts']).toContain('createHatchetApplicationScheduleRuntime');
    expect(gateway?.files['gateway.generated.ts']).toContain('provider.scheduler.v1alpha1.source-polling');
    expect(gateway?.files['gateway.generated.ts']).toContain('hatchetScheduleRuntimes.get(schedulerNodeId)');
    expect(gateway?.files['gateway.generated.ts']).toContain("schedulerNodeId === 'provider.scheduler'");
    const generatedSources = Object.values(gateway?.files ?? {}).join('\n');
    expect(generatedSources).toContain('overlapBy: callback_schedule_overlap_key_');
    expect(generatedSources).toContain('sourceBindingId');
    expect(generatedSources).toContain('@fixture/acquisition/runtime');
    expect(generatedSources).toContain('acquireItem');
    expect(generatedSources).not.toContain('.profile(');
    expect(generatedSources).not.toContain('.provide(');
    expect(generatedSources).not.toContain('.inject(');
    expect(generatedSources).not.toContain('platform.installation.spec');
    expect(generatedSources).toContain('binding.on["acquire"]');
    // typecast: negative graph fixture removes runtime metadata after validation.
    const missingRuntimeGraph = {
      ...discovered.value.graph,
      nodes: discovered.value.graph.nodes.map((node) =>
        node.kind !== 'schedule' || node.id !== 'schedule.evidence.cleanup.v1'
          ? node
          : {
              ...node,
              providerBindings: node.providerBindings?.map((binding) => ({
                ...binding,
                ...(binding.operation
                  ? { operation: { member: binding.operation.member } }
                  : {}),
              })),
            }),
    } as ApplicationGraph;
    expect(() => generatedApplicationFetchGatewayModules(missingRuntimeGraph))
      .toThrow(/Application schedule evidence\.cleanup\.v1 provider binding acquire has no public static runtime operation/);
    // typecast: negative graph fixture removes the operation after validation.
    const operationLessGraph = {
      ...missingRuntimeGraph,
      nodes: missingRuntimeGraph.nodes.map((node) =>
        node.kind !== 'schedule' || node.id !== 'schedule.evidence.cleanup.v1'
          ? node
          : {
              ...node,
              providerBindings: node.providerBindings?.map(
                ({ operation: _operation, ...binding }) => binding,
              ),
            }),
    } as ApplicationGraph;
    expect(() => generatedApplicationFetchGatewayModules(operationLessGraph))
      .toThrow(/Application schedule evidence\.cleanup\.v1 provider binding acquire has no public static runtime operation/);
  }, 60_000);
});
