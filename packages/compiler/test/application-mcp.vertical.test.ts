import type {
  ApplicationGraph,
  ApplicationOperationCatalog,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { compileApplicationMcpPlacementRoutes } from '../src/application-mcp/index.js';

const operationId = 'applik8s://models/Post/operations/create' as const;

function fixture(options: {
  readonly secondGateway?: boolean;
  readonly exposeCommand?: boolean;
} = {}): {
  readonly graph: ApplicationGraph;
  readonly catalog: ApplicationOperationCatalog;
} {
  const gateway = (id: string, name: string) => ({
    id,
    kind: 'gateway' as const,
    name,
    stability: 'stable' as const,
    queries: [],
    commands: options.exposeCommand === false
      ? []
      : [{
          command: { nodeId: 'command.posts.create.v1' },
          handler: { nodeId: 'commandHandler.post-create' },
        }],
    subscriptions: [],
    transport: 'http-sse' as const,
    authentication: 'external-provider' as const,
    trustedContextAdmission: 'server-validated' as const,
    browserCredentials: 'forbidden' as const,
    subscriptionLimits: { perPrincipal: 20, total: 1_000 },
    routes: {
      snapshots: '/queries/:query/snapshot',
      subscriptions: '/queries/:query/subscribe',
      streamReplay: '/streams/:subscription/replay',
      streamSubscriptions: '/streams/:subscription/subscribe',
      commandSubmission: '/commands/:command/submit',
      commandProgress: '/commands/:command/progress',
    },
    resume: 'resumableInvalidation' as const,
    materialization: 'generatedDeployment' as const,
    deployment: {
      namespace: 'chirp-system',
      image: 'example.invalid/chirp@sha256:deadbeef',
      replicas: 2,
      port: 8080,
    },
  });
  const graph: ApplicationGraph = {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'chirp', namespace: 'chirp-system' },
    nodes: [
      gateway('gateway.social', 'social'),
      ...(options.secondGateway
        ? [gateway('gateway.other', 'other')]
        : []),
      {
        id: 'mcpServer.public',
        kind: 'mcpServer',
        name: 'public',
        stability: 'stable',
        protocol: {
          preferred: '2025-11-25',
          supported: ['2025-11-25'],
          sdk: '@modelcontextprotocol/sdk@1.30.0',
          extensions: [
            'io.modelcontextprotocol/oauth-client-credentials/v1',
          ],
        },
        path: '/__applik8s/mcp/public',
        resource: 'https://chirp.example.test/mcp',
        audience: 'https://chirp.example.test/mcp',
        authorizationServers: ['https://identity.example.test'],
        scopes: ['operations:invoke'],
        tools: [{
          publicName: 'create-post',
          operationId,
          schemaRevision: 'operation',
        }],
        sessions: {
          mode: 'stateful-pinned',
          catalog: 'operation-catalog-revision',
          authorization: 'revalidate-every-call',
          compatibleBindings: 'drain',
          incompatibleBindings: 'reinitialize',
          lifetimeMs: 3_600_000,
        },
        transport: {
          kind: 'streamable-http',
          protectedResourceMetadata: true,
          tokenPassthrough: 'forbidden',
          maximumRequestBytes: 1_048_576,
          maximumResponseBytes: 10_485_760,
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
  };
  const catalog: ApplicationOperationCatalog = {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: 'chirp',
    revision: 'catalog-1',
    digest: 'sha256:catalog',
    state: 'active',
    operations: [{
      apiVersion: 'applik8s.operation/v1alpha1',
      id: operationId,
      version: 'v1',
      name: 'create',
      kind: 'model.create',
      input: {
        digest: 'sha256:input',
        schema: { type: 'object' },
      },
      output: {
        digest: 'sha256:output',
        schema: { type: 'object' },
      },
      errors: {},
      authority: {
        classification: 'public',
        grantable: false,
        delegable: false,
        checks: ['admission', 'enqueue', 'execution', 'pre-commit', 'result-read'],
        defaultScope: { kind: 'all' },
        transports: ['http', 'mcp'],
      },
      transports: [{
        id: 'mcp.public.create-post',
        transport: 'mcp',
        server: 'public',
        mcp: {
          server: 'public',
          tool: 'create-post',
          schemaRevision: 'sha256:input:sha256:output',
        },
      }],
      placement: {
        nodeId: 'commandHandler.post-create',
        runtime: 'command-processor',
      },
    }],
  };
  return { graph, catalog };
}

describe('application MCP placement routing', () => {
  it('routes through the generated gateway while preserving command placement', () => {
    const { graph, catalog } = fixture();

    expect(compileApplicationMcpPlacementRoutes(graph, catalog)).toEqual([{
      serverId: 'mcpServer.public',
      serverName: 'public',
      tool: 'create-post',
      operationId,
      operationVersion: 'v1',
      audience: 'https://chirp.example.test/mcp',
      placement: {
        nodeId: 'commandHandler.post-create',
        runtime: 'command-processor',
      },
      receiver: {
        nodeId: 'gateway.social',
        kind: 'generatedGateway',
        serviceName: 'chirp-social',
        namespace: 'chirp-system',
        port: 8080,
        path: '/__applik8s/internal/v1/operations',
        url: 'http://chirp-social.chirp-system.svc:8080/__applik8s/internal/v1/operations',
      },
    }]);
  });

  it('fails closed when no generated receiver owns the operation', () => {
    const { graph, catalog } = fixture({ exposeCommand: false });

    expect(() => compileApplicationMcpPlacementRoutes(graph, catalog))
      .toThrow(/cannot route.+command-processor placement/);
  });

  it('fails closed instead of choosing between ambiguous receivers', () => {
    const { graph, catalog } = fixture({ secondGateway: true });

    expect(() => compileApplicationMcpPlacementRoutes(graph, catalog))
      .toThrow(/ambiguous receivers.+gateway.other, gateway.social/);
  });
});
