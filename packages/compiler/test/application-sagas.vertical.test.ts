// typecast-file-boundary: These compiler fixtures deliberately construct and
// inspect partial graph contracts at the serialization boundary.
import { WorkflowEngine, app, applicationGraphFor } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import type { ApplicationGraph, ApplicationWorkflowWorkerNode } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { workflowContract } from '../src/application-workflows/contracts.js';
import { workflowResources } from '../src/application-workflows/resources.js';
import {
  generatedSagaHandlerModule,
  generatedWorkerSource,
} from '../src/application-workflows/source.js';

describe('v0.9 deployed Saga workflow lowering', () => {
  it('lowers a provider-neutral Saga into the shared Hatchet worker with a fenced PostgreSQL receipt store', () => {
    const application = app('saga-lowering', { namespace: 'saga-system' });
    application.transaction.saga(
      'checkout.v1',
      {
        input: type({ orderId: 'string' }),
        output: type({ committed: 'boolean' }),
      },
      { deadline: '10m', recoveryDeadline: '12h' },
      async (_input, saga) => {
        await saga.step(
          'reserve',
          async () => ({ id: 'reservation' }),
          { compensate: async () => undefined },
        );
        await saga.commit('commit-order', async () => ({ id: 'order' }));
        return { committed: true };
      },
    );

    const graph = applicationGraphFor(application.composition) as ApplicationGraph;
    const worker = graph.nodes.find(
      (node): node is ApplicationWorkflowWorkerNode =>
        node.kind === 'workflowWorker',
    );
    expect(worker).toBeDefined();
    if (!worker) return;
    const contract = workflowContract(graph, worker);

    expect(contract.sagas).toEqual([
      expect.objectContaining({ id: 'saga.checkout.v1', name: 'checkout.v1' }),
    ]);
    expect(contract.sagaStore).toEqual({
      connectionEnvironmentName: 'APPLIK8S_SAGA_DATABASE_URL',
      secret: {
        name: 'applik8s-hatchet-database',
        key: 'DATABASE_URL',
        namespace: 'default',
      },
    });

    const generated = generatedWorkerSource(contract);
    expect(generated).toContain('createDurableApplicationSagaRuntime');
    expect(generated).toContain('createPostgresApplicationSagaStore');
    expect(generated).toContain("name: \"checkout.v1\"");
    expect(generated).toContain("id: \"checkout.v1\"");
    expect(generated).toContain('const sagaRuntime = createDurableApplicationSagaRuntime');

    const saga = contract.sagas[0]!;
    expect(generatedSagaHandlerModule(saga)).toContain(
      'export function createHandler',
    );

    const resources = workflowResources(
      contract,
      'saga-worker',
      'registry.example/saga@sha256:abc',
      'sha256:abc',
      true,
    );
    const deployment = resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    const containers = Reflect.get(
      Reflect.get(
        Reflect.get((deployment?.spec ?? {}) as object, 'template') as object,
        'spec',
      ) as object,
      'containers',
    ) as readonly { readonly env?: readonly Record<string, unknown>[] }[];
    const sagaEnvironment = containers[0]?.env?.find(
      (entry) => entry.name === 'APPLIK8S_SAGA_DATABASE_URL',
    );
    expect(sagaEnvironment).toEqual({
      name: 'APPLIK8S_SAGA_DATABASE_URL',
      valueFrom: {
        secretKeyRef: {
          name: 'applik8s-hatchet-database',
          key: 'DATABASE_URL',
          optional: false,
        },
      },
    });
  });

  it('fails closed when an external workflow engine omits the Saga receipt-store Secret', () => {
    const application = app('external-saga-lowering', {
      namespace: 'saga-system',
    });
    application.provide(WorkflowEngine, WorkflowEngine.hatchet({
      provision: false,
      namespace: 'saga-system',
      hostPort: 'hatchet.example:7070',
      apiUrl: 'https://hatchet.example',
      workerTokenSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'hatchet-worker',
        namespace: 'saga-system',
      },
    }));
    application.transaction.saga(
      'checkout.external.v1',
      {
        input: type({ orderId: 'string' }),
        output: type({ committed: 'boolean' }),
      },
      async () => ({ committed: true }),
    );
    const graph = applicationGraphFor(application.composition) as ApplicationGraph;
    const worker = graph.nodes.find(
      (node): node is ApplicationWorkflowWorkerNode =>
        node.kind === 'workflowWorker',
    );
    expect(worker).toBeDefined();
    if (!worker) return;
    expect(() => workflowContract(graph, worker)).toThrow(
      'does not declare an exact connectionSecret',
    );
  });
});
