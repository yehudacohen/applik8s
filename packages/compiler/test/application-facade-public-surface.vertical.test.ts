// typecast-file-boundary: the fixture intentionally assembles the smallest
// erased graph needed to exercise compiler-owned browser publication.
import { type ApplicationGatewayNode, type ApplicationGraph, validateApplicationGraphStructure } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { applicationFacadeManifest, generatedApplicationFacadeSource } from '../src/application-facade/index.js';
import { applicationGraphWithEntrypointPublicSurface } from '../src/application-facade/public-surface.js';
import { generatedApplicationFetchGatewayModules } from '../src/application-fetch-gateway/index.js';

describe('entrypoint-driven application public surface', () => {
  it('publishes an exported model command family and view through one compiler-owned gateway', () => {
    const result = applicationGraphWithEntrypointPublicSurface(graph(), {
      operationIds: [],
      modelNames: ['Workspace'],
    });

    const gateways = result.nodes.filter(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    expect(gateways).toHaveLength(1);
    expect(gateways[0]).toMatchObject({
      id: 'gateway.web',
      visibility: 'public',
      materialization: 'generatedDeployment',
      queries: [{ nodeId: 'query.Workspace.list' }],
      commands: [{
        command: { nodeId: 'command.Workspace.create' },
        handler: { nodeId: 'command-handler.Workspace.create' },
      }],
    });
    expect(result.edges).toEqual(expect.arrayContaining([
      {
        from: { nodeId: 'gateway.web' },
        to: { nodeId: 'query.Workspace.list' },
        relationship: 'exposes',
      },
      {
        from: { nodeId: 'gateway.web' },
        to: { nodeId: 'command.Workspace.create' },
        relationship: 'exposes',
      },
    ]));
  });

  it('keeps a Kubernetes-native browser surface inside the selected ApplicationHost', () => {
    const authored = graph();
    const result = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [
        ...authored.nodes.map((node) =>
          node.id === 'query.Workspace.list'
            ? {
                ...node,
                kubernetes: {
                  invocation: 'model-native',
                  kind: 'kubernetes-list-watch',
                  model: { nodeId: 'model.Workspace' },
                  resource: {
                    apiVersion: 'example.test/v1',
                    kind: 'Workspace',
                    plural: 'workspaces',
                    scope: 'Namespaced',
                  },
                  pageSize: 100,
                  maxPages: 10,
                  maxItems: 1_000,
                  project: { source: '(value) => value' },
                },
              }
            : node),
        {
          id: 'provider.application-host',
          kind: 'provider',
          name: 'ApplicationHost',
          stability: 'stable',
          interface: 'ApplicationHost',
          implementation: 'kubernetes-application-host',
          config: {
            host: {
              kind: 'kubernetes-application-host',
              namespace: 'agentic-start-system',
            },
          },
        },
      ],
    } as ApplicationGraph, {
      operationIds: ['Workspace.list'],
      modelNames: [],
    });

    const gateway = result.nodes.find(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    expect(gateway).toMatchObject({
      id: 'gateway.web',
      materialization: 'runtimeOnly',
      queries: [{ nodeId: 'query.Workspace.list' }],
      commands: [],
      subscriptions: [],
    });
  });

  it('records an exported native CRD create route as exact public-gateway authority', () => {
    const authored = graph();
    const result = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [
        ...authored.nodes.filter((node) => node.id !== 'model.Workspace'),
        {
          id: 'model.Workspace',
          kind: 'crd',
          name: 'Workspace',
          stability: 'stable',
          resource: {
            apiVersion: 'example.test/v1',
            kind: 'Workspace',
            plural: 'workspaces',
            scope: 'Namespaced',
          },
          materialization: 'kubernetes-crd',
          create: { authorizationSource: '() => true', placementSource: '() => ({ namespace: "default" })' },
          common: {
            operations: [{
              name: 'create',
              operation: 'create',
              transport: 'command',
              publicId: 'Workspace.create',
              authorization: 'application-defined',
              authority: {
                classification: 'assigned', permissionIds: ['workspace:create'], grantable: false, delegable: false, scope: { kind: 'all' },
              },
            }],
          },
        },
        {
          id: 'gateway.authored',
          kind: 'gateway',
          name: 'authored',
          stability: 'stable',
          visibility: 'public',
          queries: [{ nodeId: 'query.Workspace.list' }],
          commands: [],
          subscriptions: [],
        },
      ],
    } as unknown as ApplicationGraph, {
      operationIds: [],
      modelNames: ['Workspace'],
    });

    expect(result.nodes).toContainEqual(expect.objectContaining({
      id: 'permission.gateway.authored.native-model-operations',
      kind: 'permission',
      owner: { nodeId: 'gateway.authored' },
      mode: 'inferred',
      rules: [{
        apiGroups: ['example.test'],
        resources: ['workspaces'],
        verbs: ['create'],
        scope: 'Namespaced',
      }],
    }));
  });

  it('does not publish models that the entrypoint keeps private', () => {
    const authored = graph();
    const result = applicationGraphWithEntrypointPublicSurface(authored, {
      operationIds: [],
      modelNames: [],
    });

    expect(result).toBe(authored);
    expect(result.nodes.some((node) => node.kind === 'gateway')).toBe(false);
  });

  it('keeps internal receiver assignments while publishing uncovered browser handles', () => {
    const inferred = applicationGraphWithEntrypointPublicSurface(graph(), {
      operationIds: [],
      modelNames: ['Workspace'],
    });
    const generated = inferred.nodes.find(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    if (!generated) throw new Error('Expected generated gateway fixture.');
    const authored = graph();
    const result = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [
        ...authored.nodes,
        {
          ...generated,
          id: 'gateway.system',
          name: 'system',
          visibility: 'internal',
          queries: [],
        },
      ],
    }, {
      operationIds: [],
      modelNames: ['Workspace'],
    });

    expect(result.nodes.filter((node) => node.kind === 'gateway')).toEqual([
      expect.objectContaining({
        id: 'gateway.system',
        visibility: 'internal',
        commands: [{
          command: { nodeId: 'command.Workspace.create' },
          handler: { nodeId: 'command-handler.Workspace.create' },
        }],
      }),
      expect.objectContaining({
        id: 'gateway.web',
        visibility: 'public',
        commands: [],
        queries: [{ nodeId: 'query.Workspace.list' }],
      }),
    ]);
  });

  it('keeps an authored public gateway authoritative', () => {
    const inferred = applicationGraphWithEntrypointPublicSurface(graph(), {
      operationIds: [],
      modelNames: ['Workspace'],
    });
    const generated = inferred.nodes.find(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    if (!generated) throw new Error('Expected generated gateway fixture.');
    const authored: ApplicationGraph = {
      ...graph(),
      nodes: [
        ...graph().nodes,
        {
          ...generated,
          id: 'gateway.authored',
          name: 'authored',
          queries: [],
          commands: [],
        },
      ],
    };

    const result = applicationGraphWithEntrypointPublicSurface(authored, {
      operationIds: [],
      modelNames: ['Workspace'],
    });
    const gateways = result.nodes.filter(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    expect(gateways).toHaveLength(1);
    expect(gateways[0]).toMatchObject({
      id: 'gateway.authored',
      queries: [],
      commands: [],
    });
  });

  it('publishes an exported signal subscription through the existing public gateway', () => {
    const inferred = applicationGraphWithEntrypointPublicSurface(graph(), {
      operationIds: [],
      modelNames: ['Workspace'],
    });
    const generated = inferred.nodes.find(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    if (!generated) throw new Error('Expected generated gateway fixture.');
    const authored = graphWithSignal({
      ...generated,
      id: 'gateway.authored',
      name: 'authored',
      queries: [],
      commands: [],
    });

    const result = applicationGraphWithEntrypointPublicSurface(authored, {
      operationIds: [],
      modelNames: [],
      signalIds: ['review-decision.v1'],
    });
    const gateway = result.nodes.find(
      (node): node is ApplicationGatewayNode => node.kind === 'gateway',
    );
    expect(gateway).toMatchObject({
      id: 'gateway.authored',
      queries: [],
      commands: [],
      subscriptions: [{ nodeId: 'subscription.review-decisions' }],
    });
    expect(result.edges).toContainEqual({
      from: { nodeId: 'gateway.authored' },
      to: { nodeId: 'subscription.review-decisions' },
      relationship: 'exposes',
    });
  });

  it('marks only exported function-native HTTP handles for browser publication', () => {
    const authored = graphWithHttp();
    const operationId =
      'applik8s://http/public-assistant/operations/ask';
    const published = applicationGraphWithEntrypointPublicSurface(authored, {
      operationIds: [operationId],
      modelNames: [],
    });
    const server = published.nodes.find((node) => node.kind === 'server');
    expect(server?.kind === 'server' ? server.routes : []).toEqual([
      expect.objectContaining({
        id: 'ask',
        functionNative: expect.objectContaining({
          publication: { boundary: 'entrypoint-export' },
        }),
      }),
      expect.objectContaining({
        id: 'internal',
        functionNative: expect.not.objectContaining({
          publication: expect.anything(),
        }),
      }),
    ]);
  });

  it('publishes exported standalone queries as direct browser handles', () => {
    const authored = graph();
    const modelQuery = authored.nodes.find((node) => node.id === 'query.Workspace.list');
    if (!modelQuery || modelQuery.kind !== 'query') throw new Error('Expected query fixture.');
    const { modelOperation: _modelOperation, ...standaloneQuery } = modelQuery;
    const standalone = {
      ...standaloneQuery,
      id: 'query.workspace.activity.v1',
      name: 'workspace.activity',
      publicId: 'workspace.activity.v1',
    };
    const published = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [...authored.nodes, standalone],
    }, { operationIds: ['workspace.activity.v1'], modelNames: [] });
    const manifest = applicationFacadeManifest(published, {
      operationExports: [{ name: 'WorkspaceActivitySnapshot', operationId: 'workspace.activity.v1' }],
    });
    expect(manifest.operations).toContainEqual(expect.objectContaining({
      id: 'workspace.activity.v1',
      transport: 'query',
      exportNames: ['WorkspaceActivitySnapshot'],
    }));
    expect(generatedApplicationFacadeSource(manifest, 'browser')).toContain(
      'export const WorkspaceActivitySnapshot = createApplicationQueryOperation',
    );
  });

  it('emits callable agent exports from their function-native invocation contract', () => {
    const manifest = {
      apiVersion: 'applik8s.facade/v1alpha1',
      application: 'research',
      models: [], operations: [], objectStores: [], signals: [], actors: [],
      agents: [{
        name: 'market-research.v1',
        invocation: {
          key: 'threadId',
          input: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
          output: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
        },
        exportNames: ['MarketResearcher'],
      }],
    } as const;
    const source = generatedApplicationFacadeSource(manifest, 'browser', { browserBaseUrl: 'https://app.example.test' });
    const serverSource = generatedApplicationFacadeSource(manifest, 'server');

    expect(source).toContain('createApplicationAgentClient');
    expect(source).toContain('export const MarketResearcher = Object.assign');
    expect(source).toContain('"key":"threadId"');
    expect(source).toContain('https://app.example.test');
    expect(serverSource).toContain("import { createApplik8sServerAgentOperation } from '@applik8s/server'");
    expect(serverSource).toContain('export const MarketResearcher = Object.assign(createApplik8sServerAgentOperation');
    expect(serverSource).not.toContain('createApplicationAgentClient');
  });

  it('does not provision a dynamic scheduler for an immediate HTTP workflow call', () => {
    const authored = workflowScheduleGraph();
    const published = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [
        ...authored.nodes,
        {
          id: 'server.workflow-start',
          kind: 'server',
          name: 'workflow-start',
          stability: 'stable',
          routes: [{
            id: 'start-onboarding',
            named: true,
            method: 'POST',
            path: '/start',
            functionNative: {
              input: { jsonSchema: { type: 'object' } },
              output: { jsonSchema: { type: 'object' } },
              handler: { source: 'async input => Onboarding(input)' },
              workflowBindings: [{
                identifier: 'Onboarding',
                target: { nodeId: 'workflow.tenant.onboarding.v1' },
                contract: {
                  name: 'tenant.onboarding',
                  version: 'v1',
                  input: { jsonSchema: { type: 'object' } },
                  output: { jsonSchema: { type: 'object' } },
                  signals: [],
                },
              }],
              workflowEngine: {
                interface: 'WorkflowEngine',
                nodeId: 'provider.workflow-engine',
              },
              idempotency: {
                source: 'http-idempotency-key',
                contextScoped: true,
              },
              requestBoundary: {
                durableValues: 'schema-normalized-only',
                rawRequestCapture: 'rejected',
                principal: 'framework-authenticated',
              },
            },
            diagnostics: {
              declaredName: true,
              staticPath: true,
              portableHandler: true,
              requestBoundary: true,
            },
          }],
          deployment: {
            namespace: 'workflow-system',
            replicas: 1,
            port: 80,
            maxRequestBodyBytes: 8_192,
            mutationRateLimit: { maxRequests: 20, windowSeconds: 60 },
          },
          resources: [],
          indexes: [],
          observability: {
            tracing: 'openTelemetry',
            metrics: 'prometheus',
            logs: 'structured',
          },
        },
      ],
    } as unknown as ApplicationGraph, {
      operationIds: ['applik8s://http/workflow-start/operations/start-onboarding'],
      modelNames: [],
    });

    expect(published.nodes).not.toContainEqual(expect.objectContaining({
      id: 'schedule.workflow-start.tenant.onboarding.v1',
    }));
    expect(published.nodes).toContainEqual(expect.objectContaining({
      kind: 'schedule',
      definition: expect.objectContaining({
        configuration: 'fixed',
        cron: '0 4 * * *',
      }),
    }));
  });

  it('lowers legacy workflow crons through the shared schedule graph without duplicating provider cron ownership', () => {
    const published = applicationGraphWithEntrypointPublicSurface(
      workflowScheduleGraph(),
      {
        operationIds: [],
        modelNames: [],
        durables: [{ kind: 'workflow', id: 'tenant.onboarding.v1' }],
      },
    );
    const workflow = published.nodes.find(
      (node) => node.id === 'workflow.tenant.onboarding.v1',
    );
    expect(workflow?.kind === 'workflow' ? workflow.triggers.crons : undefined)
      .toEqual([]);
    const scheduled = published.nodes.find(
      (node) => node.kind === 'schedule'
        && node.target?.kind === 'durableStart'
        && node.definition.configuration === 'fixed',
    );
    expect(scheduled).toMatchObject({
      kind: 'schedule',
      definition: {
        configuration: 'fixed',
        cron: '0 4 * * *',
        timezone: 'UTC',
        overlap: 'skip',
        misfires: 'latest',
      },
      scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
      target: {
        kind: 'durableStart',
        durable: { kind: 'workflow', nodeId: 'workflow.tenant.onboarding.v1' },
        contract: { name: 'tenant.onboarding', version: 'v1' },
        input: { kind: 'literal', value: { tenantId: 'scheduled', requestId: 'daily' } },
      },
    });
    expect(published.edges).toContainEqual({
      from: { nodeId: scheduled?.id },
      to: { nodeId: 'workflow.tenant.onboarding.v1' },
      relationship: 'dependsOn',
    });
    expect(published.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: { nodeId: scheduled?.id },
        interface: 'Scheduler',
      }),
    ]));
    expect(published.nodes).toContainEqual(expect.objectContaining({
      id: 'schedule.workflow-start.tenant.onboarding.v1',
      definition: expect.objectContaining({ configuration: 'dynamic' }),
      state: {
        interface: 'TransactionalDatabase',
        nodeId: 'provider.TransactionalDatabase',
      },
      target: expect.objectContaining({
        kind: 'durableStart',
        durable: { kind: 'workflow', nodeId: 'workflow.tenant.onboarding.v1' },
        input: { kind: 'scheduleInput' },
      }),
    }));
    expect(published.nodes).toContainEqual(expect.objectContaining({
      id: 'provider.TransactionalDatabase',
      kind: 'provider',
      interface: 'TransactionalDatabase',
      implementation: 'postgres',
      config: {
        transactionalDatabase: expect.objectContaining({
          clusterName: 'agentic-start-schedule-state',
          ownership: 'direct-provisioned',
        }),
      },
    }));
    expect(validateApplicationGraphStructure(published)).toEqual([]);

    const source = generatedApplicationFetchGatewayModules(published)
      ?.files['gateway.generated.ts'] ?? '';
    expect(source).toContain('startScheduledWorkflow');
    expect(source).toContain('tenant.onboarding.v1');
    expect(source).toContain("'idempotency-key': idempotencyKey");
    expect(source).toContain('context.occurrenceId');
    expect(source).toContain("purpose: 'applik8s.workflow-gateway-admission/v1'");
  });

  it('reuses one qualified application database as schedule state without provisioning a shadow authority', () => {
    const authored = workflowScheduleGraph();
    const published = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: [
        ...authored.nodes,
        {
          id: 'provider.transactional-database.v1alpha1.primary',
          kind: 'provider',
          name: 'TransactionalDatabase',
          stability: 'stable',
          interface: 'TransactionalDatabase',
          implementation: 'postgres',
          config: {
            qualification: { apiVersion: 'v1alpha1', name: 'primary' },
            transactionalDatabase: {
              kind: 'postgres',
              clusterName: 'primary-db',
              namespace: 'workflow-system',
            },
          },
        },
      ],
    } as ApplicationGraph, {
      operationIds: [],
      modelNames: [],
      durables: [{ kind: 'workflow', id: 'tenant.onboarding.v1' }],
    });

    expect(published.nodes.filter((node) => node.kind === 'schedule')).not.toHaveLength(0);
    expect(published.nodes.filter((node) => node.kind === 'schedule')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: {
            interface: 'TransactionalDatabase',
            nodeId: 'provider.transactional-database.v1alpha1.primary',
          },
        }),
      ]),
    );
    expect(published.nodes.some((node) => node.id === 'provider.TransactionalDatabase')).toBe(false);
  });

  it('lowers workflow schedules even when the application has no web host', () => {
    const authored = workflowScheduleGraph();
    const published = applicationGraphWithEntrypointPublicSurface({
      ...authored,
      nodes: authored.nodes.filter((node) =>
        node.kind !== 'provider' || node.interface !== 'ApplicationHost'),
    } as ApplicationGraph, {
      operationIds: [],
      modelNames: [],
      durables: [{ kind: 'workflow', id: 'tenant.onboarding.v1' }],
    });

    expect(published.nodes).toContainEqual(expect.objectContaining({
      id: 'schedule.workflow-start.tenant.onboarding.v1',
      kind: 'schedule',
      definition: expect.objectContaining({ configuration: 'dynamic' }),
    }));
    expect(published.nodes).toContainEqual(expect.objectContaining({
      kind: 'schedule',
      definition: expect.objectContaining({
        configuration: 'fixed',
        cron: '0 4 * * *',
      }),
      target: expect.objectContaining({
        kind: 'durableStart',
        durable: { kind: 'workflow', nodeId: 'workflow.tenant.onboarding.v1' },
      }),
    }));
    expect(validateApplicationGraphStructure(published)).toEqual([]);
  });

  it('lowers exported Jobs through the shared scheduler into the private Job controller', () => {
    const authored = jobScheduleGraph();
    const published = applicationGraphWithEntrypointPublicSurface(authored, {
      operationIds: [],
      modelNames: [],
      durables: [{ kind: 'job', id: 'search.rebuild.v1' }],
    });
    const scheduled = published.nodes.find(
      (node) => node.id === 'schedule.job-start.search.rebuild.v1',
    );
    expect(scheduled).toMatchObject({
      kind: 'schedule',
      definition: {
        configuration: 'dynamic',
        requirements: { configuration: 'dynamic', cardinality: 'high', precision: 'second' },
      },
      target: {
        kind: 'durableStart',
        durable: { kind: 'job', nodeId: 'job.search.rebuild.v1' },
        contract: { name: 'search.rebuild', version: 'v1' },
        input: { kind: 'scheduleInput' },
      },
    });
    expect(published.edges).toContainEqual({
      from: { nodeId: scheduled?.id },
      to: { nodeId: 'job.search.rebuild.v1' },
      relationship: 'dependsOn',
    });
    expect(validateApplicationGraphStructure(published)).toEqual([]);

    const source = generatedApplicationFetchGatewayModules(published)
      ?.files['gateway.generated.ts'] ?? '';
    expect(source).toContain('startScheduledJob');
    expect(source).toContain('applik8s.jobControllerRequest/v1alpha1');
    expect(source).toContain("purpose: 'applik8s.job-controller-admission/v1'");
    expect(source).toContain('agentic-start-jobs.workflow-system.svc:8091/v1/jobs');
    expect(source).toContain('context.occurrenceId');
    expect(source).not.toContain('async input => ({ rebuilt: input.workspaceId })');
  });
});

function jobScheduleGraph(): ApplicationGraph {
  const authored = workflowScheduleGraph();
  return {
    ...authored,
    nodes: [
      ...authored.nodes.filter((node) =>
        node.kind !== 'workflow'
        && node.kind !== 'workflowHandler'
        && node.kind !== 'workflowWorker'
        && !(node.kind === 'provider' && node.interface === 'WorkflowEngine')),
      {
        id: 'provider.job-runtime',
        kind: 'provider',
        name: 'JobRuntime',
        stability: 'experimental',
        interface: 'JobRuntime',
        implementation: 'kubernetes-job-runtime',
        config: { namespace: 'workflow-system' },
      },
      {
        id: 'job.search.rebuild.v1',
        kind: 'job',
        name: 'search.rebuild.v1',
        stability: 'experimental',
        contract: {
          name: 'search.rebuild',
          version: 'v1',
          input: { jsonSchema: { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] } },
          output: { jsonSchema: { type: 'object', properties: { rebuilt: { type: 'string' } }, required: ['rebuilt'] } },
        },
        handlerSource: 'async input => ({ rebuilt: input.workspaceId })',
        retry: { maxAttempts: 1, wholeAttempt: true },
        idempotency: { scope: 'applicationDeploymentContractContextAuthority', keySource: 'invocation', conflict: 'failClosed' },
        cancellation: { request: 'durableReceipt', terminal: 'firstTransitionWins', behavior: 'cooperativeThenProviderBounded' },
        retention: { source: 'profileWithAuthoredOverrides' },
        runtime: { interface: 'JobRuntime', selection: 'profile', protocol: 'applik8s.jobRuntime/v1alpha1' },
      },
    ],
    edges: [
      ...authored.edges,
      {
        from: { nodeId: 'provider.job-runtime' },
        to: { nodeId: 'job.search.rebuild.v1' },
        relationship: 'provides',
      },
    ],
  } as unknown as ApplicationGraph;
}

function workflowScheduleGraph(): ApplicationGraph {
  const authored = graph();
  return {
    ...authored,
    metadata: { ...authored.metadata, namespace: 'workflow-system' },
    nodes: [
      ...authored.nodes.filter((node) => node.kind === 'provider'),
      {
        id: 'provider.application-host',
        kind: 'provider',
        name: 'ApplicationHost',
        stability: 'stable',
        interface: 'ApplicationHost',
        implementation: 'managed-application-host',
        config: { host: { name: 'workflow-web', namespace: 'workflow-system' } },
      },
      {
        id: 'provider.workflow-engine',
        kind: 'provider',
        name: 'WorkflowEngine',
        stability: 'stable',
        interface: 'WorkflowEngine',
        implementation: 'hatchet',
        config: { namespace: 'workflow-system' },
      },
      {
        id: 'workflow.tenant.onboarding.v1',
        kind: 'workflow',
        name: 'tenant.onboarding.v1',
        stability: 'stable',
        contract: {
          name: 'tenant.onboarding',
          version: 'v1',
          input: { jsonSchema: { type: 'object' } },
          output: { jsonSchema: { type: 'object' } },
          errors: [],
          signals: [],
        },
        triggers: {
          crons: [{
            name: 'daily-onboarding',
            expression: '0 4 * * *',
            input: { tenantId: 'scheduled', requestId: 'daily' },
          }],
        },
      },
      {
        id: 'workflow-handler.tenant.onboarding.v1',
        kind: 'workflowHandler',
        name: 'tenant.onboarding.v1',
        stability: 'stable',
        workflow: { nodeId: 'workflow.tenant.onboarding.v1' },
        workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
        tasks: [],
        childWorkflows: [],
        taskBindings: [],
        childWorkflowBindings: [],
        handlerSource: 'async input => input',
        orchestrationBoundary: 'durableEffectsThroughTasks',
        deterministicOperations: ['task'],
        sourceAnalysis: 'closedWorkflowAllowlist',
      },
      {
        id: 'workflow-worker.tenant.onboarding.v1',
        kind: 'workflowWorker',
        name: 'tenant-onboarding-worker',
        stability: 'stable',
        workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
        handlers: [{ nodeId: 'workflow-handler.tenant.onboarding.v1' }],
        runtime: 'node',
        lifecycle: 'longLived',
        deployment: {
          replicas: 1,
          taskSlots: 4,
          durableSlots: 4,
          gracefulShutdownSeconds: 30,
          healthPort: 8080,
          egress: 'allowAll',
          scaling: { mode: 'fixed' },
        },
      },
    ],
  } as unknown as ApplicationGraph;
}

function graphWithHttp(): ApplicationGraph {
  const authored = graph();
  return {
    ...authored,
    nodes: [
      ...authored.nodes,
      {
        id: 'server.public-assistant',
        kind: 'server',
        name: 'public-assistant',
        stability: 'stable',
        routes: ['ask', 'internal'].map((id) => ({
          id,
          named: true,
          method: 'POST',
          path: `/${id}`,
          functionNative: {
            input: { jsonSchema: { type: 'object' } },
            output: { jsonSchema: { type: 'object' } },
            handler: { source: 'async () => ({})' },
            idempotency: {
              source: 'http-idempotency-key',
              contextScoped: true,
            },
            requestBoundary: {
              durableValues: 'schema-normalized-only',
              rawRequestCapture: 'rejected',
              principal: 'framework-authenticated',
            },
          },
          diagnostics: {
            declaredName: true,
            staticPath: true,
            portableHandler: true,
            requestBoundary: true,
          },
        })),
        deployment: {
          namespace: 'agentic-start-system',
          replicas: 1,
          port: 80,
          maxRequestBodyBytes: 8_192,
          mutationRateLimit: { maxRequests: 20, windowSeconds: 60 },
        },
        resources: [],
        indexes: [],
        observability: {
          tracing: 'openTelemetry',
          metrics: 'prometheus',
          logs: 'structured',
        },
      },
    ],
  } as unknown as ApplicationGraph;
}

function graphWithSignal(gateway: ApplicationGatewayNode): ApplicationGraph {
  const authored = graph();
  return {
    ...authored,
    nodes: [
      ...authored.nodes,
      {
        id: 'stream.review-decision.v1',
        kind: 'stream',
        name: 'review-decision',
        version: 'v1',
        stability: 'stable',
        payload: { jsonSchema: { type: 'object' } },
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        signal: {
          id: 'review-decision.v1',
          name: 'review-decision',
          version: 'v1',
          actions: [],
        },
      },
      {
        id: 'subscription.review-decisions',
        kind: 'subscription',
        name: 'review-decisions',
        stability: 'stable',
        source: { nodeId: 'stream.review-decision.v1' },
        delivery: 'sse',
        cursor: 'opaque-scoped',
        authorization: 'application-defined',
        authorizationSource: '() => true',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 5,
          initialDelayMs: 250,
          maxDelayMs: 30_000,
          factor: 2,
        },
        suspension: 'bounded-failures',
      },
      gateway,
    ],
  } as unknown as ApplicationGraph;
}

function graph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'agentic-start', namespace: 'agentic-start-system' },
    nodes: [
      {
        id: 'provider.identity',
        kind: 'provider',
        name: 'identity',
        stability: 'stable',
        interface: 'IdentityProvider',
        implementation: 'identity',
        config: {
          identity: {
            authenticationSource:
              'async () => ({ principal: { id: "user" }, trustedContext: {}, authorizationVersion: "v1" })',
          },
        },
      },
      {
        id: 'model.Workspace',
        kind: 'model',
        name: 'Workspace',
        stability: 'stable',
          common: {
          operations: [
            {
              name: 'create',
              operation: 'create',
              transport: 'command',
              publicId: 'Workspace.create',
              authorization: 'application-defined',
              authority: {
                classification: 'assigned',
                permissionIds: ['permission:workspace:create'],
                grantable: false,
                delegable: false,
                scope: { kind: 'all' },
              },
            },
            {
              name: 'delete',
              operation: 'delete',
              transport: 'command',
              publicId: 'Workspace.delete',
              authorization: 'application-defined',
              authority: {
                classification: 'unclassified',
                permissionIds: [],
                grantable: false,
                delegable: false,
                scope: { kind: 'all' },
              },
            },
          ],
        },
      },
      {
        id: 'command.Workspace.create',
        kind: 'command',
        name: 'Workspace.create',
        stability: 'stable',
      },
      {
        id: 'command-handler.Workspace.create',
        kind: 'commandHandler',
        name: 'Workspace.create',
        stability: 'stable',
        model: { nodeId: 'model.Workspace' },
        command: { nodeId: 'command.Workspace.create' },
      },
      {
        id: 'query.Workspace.list',
        kind: 'query',
        name: 'Workspace.list',
        publicId: 'Workspace.list',
        version: 'v1',
        stability: 'stable',
        modelOperation: {
          model: { nodeId: 'model.Workspace' },
          name: 'list',
          kind: 'view',
        },
      },
    ],
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
  } as unknown as ApplicationGraph;
}
