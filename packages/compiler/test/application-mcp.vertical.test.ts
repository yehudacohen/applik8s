// typecast-file-boundary: Test fixtures intentionally inspect generated manifests after asserting their structural shape.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationOperationCatalog,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationMcpServers } from '../src/application-mcp/emitter.js';
import { compileApplicationMcpPlacementRoutes } from '../src/application-mcp/index.js';

const operationId = 'applik8s://models/Post/operations/create' as const;
const compilerTestEntrypoint = new URL('./application-mcp.vertical.test.ts', import.meta.url).pathname;

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
    visibility: 'public' as const,
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
      {
        id: 'provider.identity-provider',
        kind: 'provider',
        name: 'IdentityProvider',
        stability: 'stable',
        interface: 'IdentityProvider',
        implementation: 'identity-provider',
        config: {
          identityInfrastructure: {
            kind: 'ory',
            stack: 'platform',
            provision: true,
            spec: { name: 'chirp-identity', namespace: 'chirp-system' },
            deletionPolicy: 'retain',
          },
        },
      },
      {
        id: 'model.post',
        kind: 'model',
        name: 'Post',
        stability: 'stable',
        entity: { name: 'Post' },
        database: {
          interface: 'TransactionalDatabase',
          nodeId: 'provider.transactional-database',
        },
        schema: {
          identity: ['id'],
          constraints: [],
          indexes: [],
          migrations: {
            strategy: 'generatedJob',
            compatibility: 'requiresExplicitMigration',
          },
          transactions: 'required',
        },
        materialization: {
          mode: 'providerBacked',
          provider: {
            interface: 'TransactionalDatabase',
            nodeId: 'provider.transactional-database',
          },
          backingResources: [],
          connection: {},
          runtimeBoundary: {
            serializedCallbacks: 'generatedRuntimeClient',
            scriptExecution: 'scriptRuntimeClient',
          },
          reconciliation: {
            ownership: 'application',
            schemaDrift: 'failClosed',
            deletionPolicy: 'retain',
          },
        },
        runtime: {
          name: 'Post',
          tableName: 'posts',
          provider: 'postgres',
          database: 'application',
          clusterName: 'chirp-db',
          secretName: 'chirp-db-app',
          secretKey: 'uri',
          secretNamespace: 'chirp-system',
          connectionEnvName: 'APPLIK8S_DATABASE_APPLICATION_URL',
          constraints: [],
          indexes: [],
          retention: { mode: 'retain' },
        },
      },
      {
        id: 'commandHandler.post-create',
        kind: 'commandHandler',
        name: 'Post-posts.create.v1',
        stability: 'stable',
        model: { nodeId: 'model.post' },
        command: { nodeId: 'command.posts.create.v1' },
        key: { kind: 'field', source: 'input.id' },
        ordering: 'serial',
        missing: 'reject',
        transaction: { models: [{ nodeId: 'model.post' }], history: [], outbox: [] },
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 1_000,
        },
        retention: {
          replayWindowSeconds: 3_600,
          auditWindowSeconds: 7_200,
          publishedOutboxWindowSeconds: 3_600,
          cleanupIntervalSeconds: 60,
          cleanupBatchSize: 100,
        },
        effectBoundary: 'transactionSafeOnly',
        effectEnforcement: {
          sourceAnalysis: 'closedStructuralAllowlist',
          runtimeMembrane: 'asyncContextAmbientIo',
          externalEffects: 'outboxOrTaskOnly',
        },
        handlerSource: 'async () => ({ created: true })',
        projectionReadiness: {
          submissionAcknowledgement: 'transportOnly',
          durableResultAuthority: 'postgresCommandResults',
          duplicateRecovery: 'idempotentRedelivery',
          correlation: 'commandCorrelationCausation',
          resultRevisionAuthority: 'postgresCommandResults',
          stateRevisionAuthority: 'modelRevision',
          reconciliationLink: 'modelRevisionWhenPresent',
        },
      },
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
        baseUrl: 'http://chirp-social.chirp-system.svc:8080',
        environmentName: 'APPLIK8S_RUNTIME_ENDPOINT_3F2D11115CC1B5916218',
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

  it('emits a durable OAuth-protected MCP workload without copying operation handlers', async () => {
    const { graph, catalog } = fixture();
    const [artifact] = await emitGeneratedApplicationMcpServers({
      entrypoint: compilerTestEntrypoint,
      graph,
      operationCatalog: catalog,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-mcp-artifact-')),
    });
    if (!artifact) throw new Error('Expected one generated MCP artifact.');
    const generated = await readFile(
      join(dirname(artifact.sourcePath), 'mcp.generated.ts'),
      'utf8',
    );
    const deployment = artifact.resources.find(
      (resource) => resource.kind === 'Deployment',
    );

    expect(artifact).toMatchObject({
      name: 'chirp-public-mcp',
      serverId: 'mcpServer.public',
      container: {
        entrypoint: '/app/runtime.mjs',
        baseImage: expect.stringContaining('node:22-alpine@sha256:'),
      },
    });
    expect(artifact.resources.map((resource) => resource.kind)).toEqual([
      'Deployment',
      'Service',
      'NetworkPolicy',
      'PodDisruptionBudget',
    ]);
    expect(generated).toContain('createPostgresApplicationMcpStores');
    expect(generated).toContain('createApplicationOAuthResourceAdmission');
    expect(generated).toContain('applicationOAuthIdentityReference');
    expect(generated).toContain('OryHydraOAuthAdapter');
    expect(generated).toContain('createApplicationMcpPlacementExecutor');
    expect(generated).toContain('path: "/__applik8s/mcp/public"');
    expect(generated).toContain('invocation: invocationToken');
    expect(generated).not.toContain('x-applik8s-internal-invocation');
    expect(generated).not.toContain('created: true');
    expect(generated).not.toContain('Authorization:');
    expect(JSON.stringify(deployment)).toContain(
      'APPLIK8S_INTERNAL_OPERATION_SECRET',
    );
    expect(JSON.stringify(deployment)).toContain(
      'http://chirp-identity-hydra-admin.chirp-system.svc:4445',
    );
  });

  it('materializes MCP only for profile branches with OAuth-capable identity infrastructure', async () => {
    const { graph, catalog } = fixture();
    const profiledGraph: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === 'provider' && node.interface === 'IdentityProvider'
          ? {
              ...node,
              implementation: 'application-provider-selection',
              config: {
                ...node.config,
                identityInfrastructure: {
                  kind: 'application-provider-selection',
                  selector: 'schema.spec.profile',
                  cases: {
                    starter: null,
                    dedicated: {
                      kind: 'ory',
                      stack: 'platform',
                      provision: true,
                      spec: {
                        name: 'chirp-identity',
                        namespace: 'chirp-system',
                      },
                      deletionPolicy: 'retain',
                    },
                    external: null,
                  },
                  default: null,
                },
              },
            }
          : node,
      ),
    };
    const [artifact] = await emitGeneratedApplicationMcpServers({
      entrypoint: compilerTestEntrypoint,
      graph: profiledGraph,
      operationCatalog: catalog,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-profiled-mcp-')),
    });
    if (!artifact) throw new Error('Expected one generated MCP artifact.');
    for (const resource of artifact.resources) {
      expect(resource.metadata).toMatchObject({
        annotations: {
          'applik8s.dev/include-when':
            '${schema.spec.profile == "dedicated"}',
        },
      });
    }
    const deployment = artifact.resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    expect(JSON.stringify(deployment)).toContain(
      'http://chirp-identity-hydra-admin.chirp-system.svc:4445',
    );
    expect(JSON.stringify(deployment)).toContain(
      'http://chirp-identity-hydra-public.chirp-system.svc:4444',
    );
  });
});
