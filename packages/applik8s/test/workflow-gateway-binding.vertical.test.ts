// typecast-file-boundary: the fake generic workflow runtime returns fixture
// values for the caller-selected input/output contracts while this test
// verifies the wrapper's provider-owned tracking metadata.
import { describe, expect, it } from 'vitest';
import { createApplicationWorkflowGatewayBinding } from '../src/workflow-gateway-binding.js';
import { setApplicationWorkflowRuntimeFactory } from '../src/workflow-runtime.js';

describe('generated workflow gateway binding', () => {
  it('preserves the provider idempotency key needed for restart-safe resource tracking', async () => {
    const restore = setApplicationWorkflowRuntimeFactory(async () => ({
      async run() {
        return { phase: 'Ready' } as never;
      },
      async start() {
        return {
          id: 'run-1',
          __idempotencyKey: 'resource-uid:7',
          async result() {
            return { phase: 'Ready' } as never;
          },
          async observe() {
            return {
              phase: 'Running' as const,
              admittedAt: '2026-08-09T15:00:00.000Z',
            };
          },
          async cancel() {},
        };
      },
      async schedule() {
        return { id: 'scheduled-1' };
      },
      async reconcileSchedule(_contract, schedule) {
        return { id: schedule.id, revision: schedule.revision, state: 'unchanged' };
      },
      async signal() {},
    }));

    try {
      const binding = createApplicationWorkflowGatewayBinding<
        { name: string },
        { phase: string }
      >('policy.apply.v1', 'v1');
      const run = await binding.start(
        { name: 'default' },
        { idempotencyKey: 'resource-uid:7' },
      );

      expect(run.__idempotencyKey).toBe('resource-uid:7');
      await expect(run.observe()).resolves.toMatchObject({
        reference: {
          provider: 'workflow',
          workflow: 'policy.apply.v1',
          run: 'run-1',
        },
        workflowRevision: 'v1',
        phase: 'Running',
      });
    } finally {
      restore();
    }
  });
});
