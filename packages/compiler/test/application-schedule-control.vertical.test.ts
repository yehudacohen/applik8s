import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ApplicationGraph, ApplicationGraphNode, JsonObject } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationReactive } from '../src/application-reactive/index.js';

describe('generated workflow-only schedule control', () => {
  it('emits one focused worker with exact workflow authority and Kubernetes lifecycle resources', async () => {
    const graph = applicationGraph([
      {
        id: 'provider.scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable',
        interface: 'Scheduler', implementation: 'kubernetes-cronjob-scheduler', config: {},
      },
      {
        id: 'provider.scheduler-external', kind: 'provider', name: 'ExternalScheduler', stability: 'stable',
        interface: 'Scheduler', implementation: 'target-selected',
        config: { qualification: { name: 'external' } },
      },
      {
        id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase', stability: 'stable',
        interface: 'TransactionalDatabase', implementation: 'postgres',
        config: {
          transactionalDatabase: {
            clusterName: 'schedule-db',
            namespace: 'catalog',
            connectionSecret: { name: 'schedule-db-app', namespace: 'catalog' },
            connectionSecretKey: 'uri',
          },
        },
      },
      {
        id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable',
        interface: 'WorkflowEngine', implementation: 'hatchet', config: { namespace: 'catalog' },
      },
      {
        id: 'workflow.digest.v1', kind: 'workflow', name: 'digest.v1', stability: 'stable',
        contract: { name: 'digest', version: 'v1', input: schema({ type: 'object' }), output: schema({ type: 'object' }), errors: [], signals: [] },
        triggers: { crons: [] },
      },
      {
        id: 'workflow-handler.digest.v1', kind: 'workflowHandler', name: 'digest.v1', stability: 'stable',
        workflow: { nodeId: 'workflow.digest.v1' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
        tasks: [], childWorkflows: [], taskBindings: [], childWorkflowBindings: [], handlerSource: 'async input => input',
        orchestrationBoundary: 'durableEffectsThroughTasks', deterministicOperations: ['task'], sourceAnalysis: 'closedWorkflowAllowlist',
      },
      {
        id: 'workflow-worker.digest', kind: 'workflowWorker', name: 'digest-worker', stability: 'stable',
        handlers: [{ nodeId: 'workflow-handler.digest.v1' }], workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
        runtime: 'node', lifecycle: 'longLived',
        deployment: { replicas: 1, taskSlots: 4, durableSlots: 4, gracefulShutdownSeconds: 30, healthPort: 8080, egress: 'allowAll', scaling: { mode: 'fixed' } },
      },
      {
        id: 'schedule.digest', kind: 'schedule', name: 'digest', stability: 'stable',
        definition: {
          id: 'digest', configuration: 'fixed', cron: '0 4 * * *', timezone: 'UTC', overlap: 'skip', misfires: 'latest',
          maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
          requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' },
        },
        scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
        state: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
        target: {
          kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.digest.v1' },
          contract: { name: 'digest', version: 'v1', input: schema({ type: 'object' }) },
          input: { kind: 'literal', value: {} },
        },
        functionNative: true,
      },
      {
        id: 'schedule.external-digest', kind: 'schedule', name: 'external-digest', stability: 'stable',
        definition: {
          id: 'external-digest', configuration: 'fixed', cron: '0 5 * * *', timezone: 'UTC', overlap: 'skip', misfires: 'latest',
          maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
          requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' },
        },
        scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler-external' },
        state: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
        target: {
          kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.digest.v1' },
          contract: { name: 'digest', version: 'v1', input: schema({ type: 'object' }) },
          input: { kind: 'literal', value: {} },
        },
        functionNative: true,
      },
      {
        id: 'schedule.delayed-digest', kind: 'schedule', name: 'delayed-digest', stability: 'stable',
        definition: {
          id: 'delayed-digest', configuration: 'fixed', at: '2026-08-23T04:30:00.000Z', timezone: 'UTC', overlap: 'skip', misfires: 'latest',
          maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3_600 },
          requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' },
        },
        scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
        state: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
        target: {
          kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.digest.v1' },
          contract: { name: 'digest', version: 'v1', input: schema({ type: 'object' }) },
          input: { kind: 'literal', value: { reason: 'delayed' } },
        },
        functionNative: true,
      },
    ] as unknown as ApplicationGraphNode[]);
    const [artifact] = await emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-schedule-control-')),
      entrypoint: import.meta.filename,
      executionTarget: 'kubernetes',
    });

    expect(artifact).toMatchObject({
      kind: 'scheduleControlWorker',
      name: 'reactive-test-schedule-control',
    });
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual([
      'ServiceAccount',
      'Deployment',
      'NetworkPolicy',
      'Role',
      'RoleBinding',
      'Service',
      'CronJob',
      'CronJob',
    ]);
    const deployment = artifact?.resources.find((resource) => resource.kind === 'Deployment');
    expect(deployment).toMatchObject({
      spec: {
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        template: {
          spec: {
            serviceAccountName: 'reactive-test-schedule-control',
            volumes: [expect.objectContaining({
              name: 'workflow-gateway-token',
              projected: expect.objectContaining({ sources: [expect.objectContaining({ serviceAccountToken: expect.objectContaining({ path: 'token' }) })] }),
            })],
            containers: [expect.objectContaining({
              env: expect.arrayContaining([
                expect.objectContaining({ name: 'APPLIK8S_SCHEDULE_DATABASE_URL' }),
                { name: 'APPLIK8S_WORKFLOW_GATEWAY_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-gateway/token' },
                expect.objectContaining({ name: 'APPLIK8S_INTERNAL_OPERATION_SECRET' }),
              ]),
            })],
          },
        },
      },
    });
    const role = artifact?.resources.find((resource) => resource.kind === 'Role');
    expect(role?.rules).toContainEqual({
      apiGroups: ['batch'],
      resources: ['cronjobs'],
      verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
    });
    const oneTimeCronJob = artifact?.resources
      .filter((resource) => resource.kind === 'CronJob')
      .find((resource) => (resource.metadata.annotations as Readonly<Record<string, string>> | undefined)?.['applik8s.dev/schedule-definition'] === 'delayed-digest');
    const oneTimeSpec = oneTimeCronJob?.spec as {
      readonly jobTemplate: {
        readonly spec: {
          readonly template: {
            readonly spec: {
              readonly containers: readonly [{
                readonly env: readonly { readonly name: string; readonly value?: string }[];
              }];
            };
          };
        };
      };
    } | undefined;
    const oneTimeAdmission = oneTimeSpec?.jobTemplate.spec.template.spec.containers[0]?.env
      .find((entry: { readonly name?: string }) => entry.name === 'APPLIK8S_SCHEDULE_ADMISSION')?.value;
    expect(JSON.parse(String(oneTimeAdmission))).toMatchObject({
      definitionId: 'delayed-digest',
      deleteAfterCompletion: true,
      providerResourceName: oneTimeCronJob?.metadata.name,
    });
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    const generated = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'gateway.generated.ts'), 'utf8');
    expect(source).toContain('closeApplik8sGateway');
    expect(generated).toContain('startScheduledWorkflow');
    expect(generated).toContain('await installLocalApplicationScheduleRuntime');
    expect(generated).toContain('await startAwsApplicationScheduleQueueRunner');
    expect(generated).toContain('reactive-test-schedule-control.catalog.svc:8080');
    expect(generated).not.toContain('external-digest');
    expect(generated).not.toContain('createApplicationIdentitySessionHandler');
    expect(generated).not.toContain('createApplicationAIAgentGateway');
    expect(JSON.parse(await readFile(artifact?.manifestPath ?? '', 'utf8'))).toMatchObject({
      kind: 'GeneratedScheduleControlWorker',
    });

    const hatchetGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === 'provider.scheduler'
        ? {
            ...node,
            implementation: 'hatchet-scheduler',
            config: {
              scheduler: {
                kind: 'hatchet-scheduler',
                workflowEngine: {
                  kind: 'hatchet',
                  namespace: 'catalog',
                  hostPort: 'hatchet-engine.catalog.svc:7070',
                  apiUrl: 'http://hatchet-api.catalog.svc:8080',
                  workerTokenSecret: { name: 'hatchet-client-config', namespace: 'catalog' },
                },
              },
            },
          } as ApplicationGraphNode
        : node),
    } satisfies ApplicationGraph;
    const [hatchetArtifact] = await emitGeneratedApplicationReactive({
      graph: hatchetGraph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-hatchet-schedule-control-')),
      entrypoint: import.meta.filename,
      executionTarget: 'kubernetes',
    });
    expect(hatchetArtifact?.resources.map(({ kind }) => kind)).toEqual([
      'ServiceAccount',
      'Deployment',
      'NetworkPolicy',
      'Service',
    ]);
    expect(hatchetArtifact?.kubernetesPermissions).toEqual([]);
    expect(hatchetArtifact?.credentialProjections).toEqual(expect.arrayContaining([
      {
        target: 'kubernetes',
        namespace: 'catalog',
        name: 'hatchet-client-config',
        keys: ['HATCHET_CLIENT_TOKEN'],
      },
      {
        target: 'kubernetes',
        namespace: 'catalog',
        name: 'schedule-db-app',
        keys: ['uri'],
      },
    ]));
    const hatchetDeployment = hatchetArtifact?.resources.find(({ kind }) => kind === 'Deployment');
    expect(hatchetDeployment).toMatchObject({ spec: { template: { spec: {
      volumes: expect.arrayContaining([expect.objectContaining({
        secret: {
          secretName: 'hatchet-client-config',
          items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }],
        },
      })]),
    } } } });
    const hatchetSource = await readFile(
      join(dirname(hatchetArtifact?.sourcePath ?? ''), 'gateway.generated.ts'),
      'utf8',
    );
    expect(hatchetSource).toContain('createHatchetApplicationScheduleRuntime');
    expect(hatchetSource).toContain('const kubernetesScheduleProviderIds = new Set([])');
    expect(hatchetSource).toContain('kubernetesScheduleProviderIds.has(schedulerNodeId)');

    const hosted = await emitGeneratedApplicationReactive({
      graph: {
        ...graph,
        nodes: [...graph.nodes, {
          id: 'provider.application-host', kind: 'provider', name: 'ApplicationHost', stability: 'stable',
          interface: 'ApplicationHost', implementation: 'managed-application-host',
          config: { host: { name: 'reactive-test-web', namespace: 'catalog' } },
        } as ApplicationGraphNode],
      },
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-hosted-schedule-control-')),
      entrypoint: import.meta.filename,
      executionTarget: 'kubernetes',
    });
    expect(hosted).toEqual([]);

    const externallyManaged = await emitGeneratedApplicationReactive({
      graph: {
        ...graph,
        nodes: graph.nodes.filter((node) =>
          node.id !== 'provider.scheduler' && node.id !== 'schedule.digest'),
      },
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-external-schedule-control-')),
      entrypoint: import.meta.filename,
      executionTarget: 'kubernetes',
    });
    expect(externallyManaged).toEqual([]);
  }, 120_000);
});

function applicationGraph(nodes: readonly ApplicationGraphNode[]): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'reactive-test', namespace: 'catalog' },
    nodes,
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function schema(jsonSchema: JsonObject) {
  return {
    kind: 'declared' as const,
    runtime: 'arktype' as const,
    jsonSchema,
  };
}
