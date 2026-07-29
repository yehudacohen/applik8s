// typecast-file-boundary: compiler catalog fixtures intentionally assemble erased graph contracts to exercise normalization and rejection paths.
import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { compileApplicationOperationCatalog, compileApplicationWorkloadAuthority } from '../src/application-operations/index.js';

const emptyCompatibility = {
  stablePublicApis: [],
  documentedInternalContracts: [],
  experimentalSurfaces: [],
  postV3Surfaces: [],
  labels: [],
} as const;

function graph(classification: 'public' | 'unclassified'): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'chirp' },
    nodes: [
      {
        id: 'model.post',
        kind: 'model',
        name: 'Post',
        stability: 'stable',
        entity: { name: 'Post' },
        database: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
        schema: {
          identity: ['id'],
          constraints: [],
          indexes: [],
          migrations: { strategy: 'none', compatibility: 'schemaCompatibleOnly' },
          transactions: 'required',
        },
        materialization: {
          mode: 'providerBacked',
          provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
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
        common: {
          identity: { fields: ['id'], encoding: 'scalar' },
          snapshot: { shape: 'identity-value-revision', revisionOptional: true },
          changes: { authority: 'postgres-change-log', rawWrites: 'observed' },
          relationships: [],
          operations: [{
            name: 'publish',
            operation: 'custom',
            transport: 'command',
            publicId: 'posts.publish.v1',
            authorization: 'application-defined',
            input: {
              kind: 'declared',
              runtime: 'arktype',
              jsonSchema: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
            },
            output: {
              kind: 'declared',
              runtime: 'arktype',
              jsonSchema: { type: 'object', properties: { published: { type: 'boolean' } }, required: ['published'] },
            },
            authority: {
              classification,
              permissionIds: [],
              grantable: false,
              delegable: false,
              scope: classification === 'public' ? { kind: 'all' } : { kind: 'none', reason: 'not classified' },
            },
          }],
        },
      },
      {
        id: 'command.posts.publish.v1',
        kind: 'command',
        name: 'posts.publish.v1',
        stability: 'stable',
        contract: {
          name: 'posts.publish',
          version: 'v1',
          input: {
            kind: 'declared',
            runtime: 'arktype',
            jsonSchema: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
          },
          output: {
            kind: 'declared',
            runtime: 'arktype',
            jsonSchema: { type: 'object', properties: { published: { type: 'boolean' } }, required: ['published'] },
          },
          errors: [],
        },
      },
      {
        id: 'commandHandler.post-publish',
        kind: 'commandHandler',
        name: 'post-publish',
        stability: 'stable',
        model: { nodeId: 'model.post' },
        command: { nodeId: 'command.posts.publish.v1' },
        key: { source: 'input.postId', kind: 'field' },
        ordering: 'serial',
        missing: 'reject',
        transaction: { models: [{ nodeId: 'model.post' }], history: [], outbox: [] },
        retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 100 },
        retention: {
          replayWindowSeconds: 60,
          auditWindowSeconds: 60,
          publishedOutboxWindowSeconds: 60,
          cleanupIntervalSeconds: 10,
          cleanupBatchSize: 10,
        },
        effectBoundary: 'transactionSafeOnly',
        effectEnforcement: {
          sourceAnalysis: 'closedStructuralAllowlist',
          runtimeMembrane: 'asyncContextAmbientIo',
          externalEffects: 'outboxOrTaskOnly',
        },
        handlerSource: 'async () => ({ published: true })',
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
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: emptyCompatibility,
  };
}

describe('application operation catalog compilation', () => {
  it('separates stable operation identity from its command transport binding', () => {
    const catalog = compileApplicationOperationCatalog(graph('public'), {
      revision: 'catalog-1',
      requireClassified: true,
    });

    expect(catalog.operations).toEqual([
      expect.objectContaining({
        id: 'applik8s://models/Post/operations/publish',
        kind: 'model.operation',
        authority: expect.objectContaining({ classification: 'public' }),
        transports: [expect.objectContaining({ id: 'posts.publish.v1', transport: 'event' })],
        placement: { nodeId: 'commandHandler.post-publish', runtime: 'command-processor' },
      }),
    ]);
    expect(catalog.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('fails production compilation for externally reachable unclassified operations', () => {
    expect(() => compileApplicationOperationCatalog(graph('unclassified'), {
      revision: 'catalog-1',
      requireClassified: true,
    })).toThrow(/operation catalog is not production-ready/i);
  });

  it('uses the static authority manifest as replay-safe classification evidence', () => {
    const base = graph('unclassified');
    const operationId = 'applik8s://models/Post/operations/publish' as const;
    const catalog = compileApplicationOperationCatalog({
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'authority-manifest.application',
          kind: 'authorityManifest',
          name: 'application-authority',
          stability: 'stable',
          manifest: {
            apiVersion: 'applik8s.authorityManifest/v1alpha1',
            application: 'chirp',
            revision: 'sha256:manifest',
            identities: [],
            permissions: [{
              id: 'permission:chirp:publish',
              name: 'publish',
              operationIds: [operationId],
              scope: { kind: 'all' },
              grantable: false,
            }],
            roles: [],
            grants: [],
            outcomes: [],
          },
        },
      ],
    }, {
      revision: 'catalog-static-authority',
      requireClassified: true,
    });

    expect(catalog.operations[0]?.authority).toMatchObject({
      classification: 'assigned',
      defaultScope: { kind: 'all' },
    });
  });

  it('fails closed when a static authority manifest references an unknown operation', () => {
    const base = graph('unclassified');
    expect(() => compileApplicationOperationCatalog({
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'authority-manifest.application',
          kind: 'authorityManifest',
          name: 'application-authority',
          stability: 'stable',
          manifest: {
            apiVersion: 'applik8s.authorityManifest/v1alpha1',
            application: 'chirp',
            revision: 'sha256:manifest',
            identities: [],
            permissions: [{
              id: 'permission:chirp:missing',
              name: 'missing',
              operationIds: ['applik8s://models/Post/operations/missing'],
              scope: { kind: 'all' },
              grantable: false,
            }],
            roles: [],
            grants: [],
            outcomes: [],
          },
        },
      ],
    })).toThrow(/references unknown operations/i);
  });

  it('serializes the exact maximum workload authority for declared task operation dependencies', () => {
    const base = graph('public');
    const catalog = compileApplicationOperationCatalog(base, { revision: 'catalog-workload' });
    const operationId = catalog.operations[0]!.id;
    const workloadGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'task-handler.publish-post',
          kind: 'taskHandler',
          name: 'publish-post',
          stability: 'stable',
          task: { nodeId: 'task.publish-post' },
          workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
          operations: [{
            alias: 'publish',
            command: { nodeId: 'command.posts.publish.v1' },
            handler: { nodeId: 'commandHandler.post-publish' },
            authority: {
              apiVersion: 'applik8s.operationDependency/v1alpha1',
              alias: 'publish',
              operationId,
              invocation: 'context.invoke',
              authorization: 'reauthorize',
              restrictions: {
                target: { kind: 'all' },
                predicates: [{
                  kind: 'compare',
                  field: 'state',
                  operator: 'eq',
                  value: { kind: 'literal', value: 'draft' },
                }],
                transport: { kind: 'transport', bindingId: 'posts.publish.v1', transport: 'event' },
              },
              binding: {
                apiVersion: 'applik8s.executionBinding/v1alpha1',
                id: 'binding.publish-post.publish',
                revision: 'sha256:binding',
                operationId,
                source: 'input',
                projectionDigest: 'sha256:projection',
                projectionSource: '(input) => ({ postId: input.postId })',
                boundKeys: ['postId'],
                inferred: true,
                provenance: { nodeId: 'task-handler.publish-post' },
              },
              terminal: true,
            },
          }],
          operationPrincipalSource: '(input) => ({ id: input.principalId })',
          retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1000 },
          executionTimeoutSeconds: 60,
          scheduleTimeoutSeconds: 300,
          idempotency: {
            required: true,
            keySource: 'invocation',
            guarantee: 'atLeastOnceRetrySafe',
          },
          effectBoundary: 'externalEffectsAllowed',
          handlerSource: 'async () => ({})',
        },
      ],
    } as ApplicationGraph;

    expect(compileApplicationWorkloadAuthority(workloadGraph, catalog)).toEqual([
      expect.objectContaining({
        apiVersion: 'applik8s.workloadAuthority/v1alpha1',
        workloadIdentity: expect.objectContaining({
          kind: 'workload',
          subject: 'task-handler.publish-post',
        }),
        operationId,
        catalogRevision: catalog.revision,
        restrictions: expect.objectContaining({
          predicates: [expect.objectContaining({ field: 'state' })],
        }),
        binding: expect.objectContaining({
          source: 'input',
          boundKeys: ['postId'],
        }),
        transports: ['event'],
        delegation: 'forbidden',
        impersonation: 'forbidden',
      }),
    ]);
  });

  it('serializes one workload authority envelope per declared AI agent tool', () => {
    const base = graph('public');
    const catalog = compileApplicationOperationCatalog(base, {
      revision: 'catalog-agent',
    });
    const operation = catalog.operations[0]!;
    const workloadGraph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'provider.ai',
          kind: 'provider',
          name: 'AI',
          stability: 'stable',
          interface: 'AI',
          implementation: 'envoy-ai-gateway',
          config: {},
        },
        {
          id: 'aiAgent.publisher',
          kind: 'aiAgent',
          name: 'publisher',
          stability: 'stable',
          serviceIdentity: {
            id: 'identity:chirp:service:publisher',
            kind: 'service',
            issuer: 'applik8s://chirp',
            subject: 'publisher',
          },
          model: {
            apiVersion: 'applik8s.aiModel/v1alpha1',
            name: 'fast',
            capabilities: ['chat', 'tools'],
            constraints: {},
          },
          inference: { interface: 'AI', nodeId: 'provider.ai' },
          instructions: { kind: 'static', value: 'Publish only admitted posts.' },
          tools: [{
            operationId: operation.id,
            operationVersion: operation.version,
            transport: 'command',
            graphNode: { nodeId: 'model.post' },
            authority: {
              classification: 'public',
              grantable: false,
              delegable: false,
              scope: {
                kind: 'compare',
                field: 'state',
                operator: 'eq',
                value: { kind: 'literal', value: 'draft' },
              },
            },
          }],
          budgets: { timeoutMs: 120_000 },
          executionPolicy: {
            callerDelegation: 'forbidden',
            uncertainCompletion: 'escalate',
          },
          compatibility: {
            apiVersion: 'applik8s.aiCompatibility/v1alpha1',
            tanstackAI: '0.42.0',
            tanstackAIClient: '0.22.1',
            tanstackAIReact: '0.18.1',
            tanstackAIPersistence: 'unreleased',
            agUi: '0.0.52',
            applik8sAdapter: 'applik8s.ai-tanstack/v1alpha1',
          },
          handlerSource: 'async () => ({})',
          runtime: 'node',
          lifecycle: 'longLived',
          deployment: {
            replicas: 1,
            port: 3000,
            healthPort: 8081,
            gracefulShutdownSeconds: 30,
            maximumConcurrency: 16,
          },
        },
      ],
    };

    expect(compileApplicationWorkloadAuthority(workloadGraph, catalog)).toEqual([
      expect.objectContaining({
        workloadIdentity: expect.objectContaining({
          subject: 'aiAgent.publisher',
        }),
        serviceIdentity: expect.objectContaining({
          id: 'identity:chirp:service:publisher',
        }),
        operationId: operation.id,
        restrictions: {
          target: expect.objectContaining({ kind: 'compare', field: 'state' }),
          predicates: [],
        },
        inputSchemaDigest: operation.input.digest,
        delegation: 'forbidden',
        impersonation: 'forbidden',
      }),
    ]);
  });

  it('uses a named raw route as its stable operation identity and preserves its authority', () => {
    const base = graph('public');
    const catalog = compileApplicationOperationCatalog({
      ...base,
      nodes: [{
        id: 'server.api',
        kind: 'server',
        name: 'api',
        stability: 'stable',
        routes: [{
          id: 'administration.disable-user',
          named: true,
          method: 'POST',
          path: '/admin/users/:id/disable',
          authority: {
            classification: 'assigned',
            permissionIds: ['permission.administrator'],
            grantable: false,
            delegable: false,
            scope: { kind: 'all' },
          },
        }],
        resources: [],
        indexes: [],
        observability: {
          health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
          logs: { format: 'json', component: 'api', failureEvents: [] },
          metrics: { mode: 'none', names: [] },
          events: [],
          sourceMaps: 'required',
          replayArtifacts: [],
          diagnosticsArtifact: { kind: 'routeDiagnostics', name: 'api-routes' },
        },
      }],
    }, {
      revision: 'catalog-routes',
      requireClassified: true,
    });

    expect(catalog.operations).toEqual([
      expect.objectContaining({
        id: 'applik8s://http/api/operations/administration.disable-user',
        name: 'administration.disable-user',
        kind: 'http.raw',
        authority: expect.objectContaining({
          classification: 'assigned',
        }),
        transports: [expect.objectContaining({
          route: {
            name: 'administration.disable-user',
            method: 'POST',
            path: '/admin/users/:id/disable',
          },
        })],
      }),
    ]);
  });
});
