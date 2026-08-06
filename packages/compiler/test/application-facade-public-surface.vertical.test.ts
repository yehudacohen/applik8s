// typecast-file-boundary: the fixture intentionally assembles the smallest
// erased graph needed to exercise compiler-owned browser publication.
import type { ApplicationGraph, ApplicationGatewayNode } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { applicationGraphWithEntrypointPublicSurface } from '../src/application-facade/public-surface.js';

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
});

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
