import { app, applicationGraphFor, setApplicationWorkflowRuntimeFactory, task, WorkflowEngine, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { describe, expect, it } from 'vitest';

const ProvisionTenant = task('tenant.provision.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string' }),
  errors: { providerUnavailable: type({ retryAfterSeconds: 'number' }) },
});

const TenantOnboarding = workflow('tenant.onboarding.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string', approved: 'boolean' }),
  errors: { rejected: type({ reason: 'string' }) },
  signals: { approval: type({ approved: 'boolean' }) },
});

describe('v0.5 durable task and workflow contracts', () => {
  it('records provider-neutral contracts, Hatchet bindings, workers, and deterministic orchestration boundaries', () => {
    const platform = app('workflow-platform', { namespace: 'workflow-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
      name: 'workflow-hatchet',
      namespace: 'workflow-system',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'workflow-hatchet-worker', namespace: 'workflow-system' },
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32 },
    }));
    const provision = platform.task(ProvisionTenant, {
      retries: 4,
      executionTimeoutSeconds: 120,
      idempotencyKey: (input) => input.requestId,
    }, async (input) => ({ endpoint: `https://${input.tenantId}.example.test` }));
    const onboarding = platform.workflow(TenantOnboarding, {
      tasks: { provision },
      crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }],
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081 },
    }, async (input, context) => {
      const provisioned = await context.task('provision', input, { idempotencyKey: input.requestId });
      const approval = await context.waitFor('approval', { scope: context.invocationId });
      if (!approval.approved) context.fail('rejected', { reason: 'approval denied' });
      return { endpoint: provisioned.endpoint, approved: approval.approved };
    });

    const graph = applicationGraphFor(platform.composition);
    expect(graph).toBeDefined();
    expect(graph?.metadata.namespace).toBe('workflow-system');
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['task', 'workflow', 'app.task', 'app.workflow', 'provider.WorkflowEngine']));
    expect(graph?.compatibility.postV3Surfaces).not.toContain('generic-workflow-orchestration');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', name: 'tenant.provision.v1', contract: expect.objectContaining({ version: 'v1', errors: [expect.objectContaining({ name: 'providerUnavailable' })] }) }),
      expect.objectContaining({ kind: 'taskHandler', effectBoundary: 'externalEffectsAllowed', retry: expect.objectContaining({ mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 1_000, factor: 2 }), idempotency: expect.objectContaining({ required: true, guarantee: 'atLeastOnceRetrySafe' }) }),
      expect.objectContaining({ kind: 'workflow', name: 'tenant.onboarding.v1', triggers: { crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }] }, contract: expect.objectContaining({ signals: [expect.objectContaining({ name: 'approval' })] }) }),
      expect.objectContaining({ kind: 'workflowHandler', orchestrationBoundary: 'durableEffectsThroughTasks', taskBindings: [{ alias: 'provision', task: { nodeId: 'task.tenant.provision.v1' } }], deterministicOperations: expect.arrayContaining(['sleep', 'externalEvent', 'cancellation']) }),
      expect.objectContaining({ kind: 'workflowWorker', runtime: 'node', lifecycle: 'longLived', deployment: expect.objectContaining({ replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081, egress: 'allowAll' }) }),
      expect.objectContaining({ kind: 'provider', interface: 'WorkflowEngine', implementation: 'hatchet', config: expect.objectContaining({ chartVersion: '0.12.4', serverVersion: 'v0.90.13' }) }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ interface: 'WorkflowEngine', purpose: 'workflowEngine' })]));
    expect(graph?.providerBindings).toEqual(expect.arrayContaining([expect.objectContaining({ generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'HelmRepository' })]), runtime: expect.objectContaining({ secretRefs: [expect.objectContaining({ name: 'workflow-hatchet-worker' })] }) })]));
    if (!graph) throw new Error('Expected workflow graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    expect(onboarding.kind).toBe('applicationWorkflow');
  });

  it('delegates app-bound handles to the selected runtime and preserves invocation metadata', async () => {
    const calls: unknown[] = [];
    // typecast: the fake runtime returns the generic caller-selected output without coupling the fixture to one contract.
    const restore = setApplicationWorkflowRuntimeFactory(async () => ({
      async run(contract, input, metadata, result) {
        calls.push({ operation: 'run', contract, input, metadata, result });
        // typecast: the generic fake returns the caller-selected test output.
        return { endpoint: 'https://tenant-a.example.test' } as never;
      },
      async start() {
        return { id: 'run-1', async result() {
          // typecast: the generic fake returns the caller-selected test output.
          return { endpoint: 'unused' } as never;
        }, async cancel() {} };
      },
      async schedule() { return { id: 'scheduled-1' }; },
      async signal(contract, runId, signal, payload, metadata) { calls.push({ operation: 'signal', contract, runId, signal, payload, metadata }); },
    }));
    try {
      const platform = app('runtime-platform');
      const provision = platform.task(ProvisionTenant, { idempotencyKey: (input) => input.requestId }, async () => ({ endpoint: 'unused' }));
      await provision.run({ tenantId: 'tenant-a', requestId: 'request-1' }, { correlationId: 'correlation-1' }, { timeoutMs: 12_000 });
      expect(calls).toEqual([expect.objectContaining({ operation: 'run', contract: 'tenant.provision.v1', metadata: expect.objectContaining({ idempotencyKey: 'request-1', correlationId: 'correlation-1' }), result: { timeoutMs: 12_000 } })]);
    } finally {
      restore();
    }
  });

  it('rejects ambient external effects in durable orchestration while allowing them in tasks', () => {
    const platform = app('unsafe-workflow');
    expect(() => platform.workflow(TenantOnboarding, { tasks: { ProvisionTenant } }, async (input) => {
      await fetch(`https://example.test/${input.tenantId}`);
      return { endpoint: 'unsafe', approved: false };
    })).toThrow(/Move external effects into declared app\.task/);
  });

  it('accepts runtime-serialized task handlers with multiple variable declarators', () => {
    const platform = app('multi-declarator-task');
    expect(() => platform.task(ProvisionTenant, {}, async (input) => {
      const endpoint = `https://${input.tenantId}.example.test`;
      const response = { endpoint };
      return response;
    })).not.toThrow();
  });
});
