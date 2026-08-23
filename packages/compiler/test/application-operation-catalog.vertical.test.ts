// typecast-file-boundary: compiler catalog fixtures intentionally assemble erased graph contracts to exercise normalization and rejection paths.
import type { ApplicationGraph, ApplicationMessageContractSchema, JsonObject } from '@applik8s/core';
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
      {
        id: 'gateway.public',
        kind: 'gateway',
        name: 'public',
        stability: 'stable',
        visibility: 'public',
        queries: [],
        commands: [{
          command: { nodeId: 'command.posts.publish.v1' },
          handler: { nodeId: 'commandHandler.post-publish' },
        }],
        subscriptions: [],
        transport: 'http-sse',
        authentication: 'external-provider',
        trustedContextAdmission: 'server-validated',
        browserCredentials: 'forbidden',
        subscriptionLimits: { perPrincipal: 10, total: 100 },
        routes: {
          snapshots: '/queries/:query/snapshot',
          subscriptions: '/queries/:query/subscribe',
          streamReplay: '/streams/:subscription/replay',
          streamSubscriptions: '/streams/:subscription/subscribe',
          commandSubmission: '/commands/:command/submit',
          commandProgress: '/commands/:command/progress',
        },
        resume: 'resumableInvalidation',
        materialization: 'runtimeOnly',
        commandAuthorizationSource: '() => true',
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

  it('keeps catalog identity stable across absolute source roots', () => {
    const withSourceRoot = (root: string): ApplicationGraph => ({
      ...graph('public'),
      nodes: graph('public').nodes.map((node) => ({
        ...node,
        sourceLocation: {
          file: `${root}/src/application.ts`,
          line: 12,
          column: 3,
        },
      })),
    });

    const workstation = compileApplicationOperationCatalog(
      withSourceRoot('/Users/developer/workspace/chirp'),
    );
    const container = compileApplicationOperationCatalog(
      withSourceRoot('/applik8s-dev-root/app'),
    );

    expect(workstation.revision).toBe(container.revision);
    expect(workstation.digest).toBe(container.digest);
    expect(workstation.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLocation: expect.objectContaining({
          file: '/Users/developer/workspace/chirp/src/application.ts',
        }),
      }),
    ]));
    expect(container.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLocation: expect.objectContaining({
          file: '/applik8s-dev-root/app/src/application.ts',
        }),
      }),
    ]));
  });

  it('fails production compilation for externally reachable unclassified operations', () => {
    expect(() => compileApplicationOperationCatalog(graph('unclassified'), {
      revision: 'catalog-1',
      requireClassified: true,
    })).toThrow(/operation catalog is not production-ready/i);
  });

  it('keeps an unrouted undeclared model handle latent without inventing public authority', () => {
    const fixture = graph('unclassified');
    const model = fixture.nodes.find((node) => node.kind === 'model');
    const common = model?.common;
    if (!model || !common?.operations) throw new Error('Expected model operation fixture.');
    const operations = common.operations.map(({ authority: _authority, ...operation }) => ({
      ...operation,
      authorization: 'undeclared' as const,
    }));
    const latent: ApplicationGraph = {
      ...fixture,
      nodes: fixture.nodes
        .filter((node) => node.kind !== 'gateway')
        .map((node) =>
          node.id === model.id
            ? {
                ...model,
                common: {
                  ...common,
                  operations,
                },
              }
            : node),
    };

    const catalog = compileApplicationOperationCatalog(latent, {
      revision: 'catalog-latent',
      requireClassified: true,
    });
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        id: 'applik8s://models/Post/operations/publish',
        transports: [{
          id: 'posts.publish.v1',
          transport: 'control-plane',
          server: 'application-command-processor',
        }],
        authority: expect.objectContaining({
          classification: 'application-policy',
          defaultScope: {
            kind: 'none',
            reason: 'operation has no compiled transport',
          },
        }),
      }),
    ]);
  });

  it('classifies a model operation used only by a durable workflow as internal application policy', () => {
    const base = graph('unclassified');
    const withoutGateway = base.nodes.filter((node) => node.kind !== 'gateway');
    const workflowGraph = {
      ...base,
      nodes: [
        ...withoutGateway,
        {
          id: 'task-handler.review',
          kind: 'taskHandler',
          name: 'review',
          stability: 'stable',
          task: { nodeId: 'task.review' },
          workflowEngine: {
            interface: 'WorkflowEngine',
            nodeId: 'provider.workflow-engine',
          },
          operations: [{
            alias: 'publish',
            command: { nodeId: 'command.posts.publish.v1' },
            handler: { nodeId: 'commandHandler.post-publish' },
            authority: {
              apiVersion: 'applik8s.operationDependency/v1alpha1',
              alias: 'publish',
              operationId: 'applik8s://models/Post/operations/publish',
              invocation: 'context.invoke',
              authorization: 'reauthorize',
              restrictions: {
                target: { kind: 'all' },
                predicates: [],
              },
              terminal: true,
            },
          }],
          retry: {
            mode: 'boundedExponentialBackoff',
            maxAttempts: 3,
            initialDelayMs: 100,
            maxDelayMs: 1_000,
          },
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

    const catalog = compileApplicationOperationCatalog(workflowGraph, {
      revision: 'catalog-workflow-internal',
      requireClassified: true,
    });
    expect(catalog.operations).toEqual([
      expect.objectContaining({
        id: 'applik8s://models/Post/operations/publish',
        transports: [{
          id: 'posts.publish.v1',
          transport: 'workflow',
          server: 'application-command-processor',
        }],
        authority: expect.objectContaining({
          classification: 'application-policy',
          defaultScope: { kind: 'all' },
          transports: ['workflow'],
        }),
      }),
    ]);
  });

  it('classifies engine-internal durable operations through the generated application policy', () => {
    const base = graph('public');
    const contract = {
      name: 'proof',
      version: 'v1',
      input: {
        kind: 'declared' as const,
        runtime: 'arktype' as const,
        jsonSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      output: {
        kind: 'declared' as const,
        runtime: 'arktype' as const,
        jsonSchema: {
          type: 'object',
          properties: { done: { type: 'boolean' } },
          required: ['done'],
        },
      },
      errors: [],
    };
    const catalog = compileApplicationOperationCatalog({
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'task.proof.v1',
          kind: 'task',
          name: 'proof.v1',
          stability: 'stable',
          contract,
        },
        {
          id: 'workflow.proof.v1',
          kind: 'workflow',
          name: 'proof.v1',
          stability: 'stable',
          contract: { ...contract, signals: [] },
          triggers: { crons: [] },
        },
      ],
    }, {
      revision: 'catalog-durable-private',
      requireClassified: true,
    });

    expect(
      catalog.operations
        .filter((operation) => operation.transports.every((binding) => binding.transport === 'workflow'))
        .map((operation) => ({
          id: operation.id,
          classification: operation.authority.classification,
          transports: operation.authority.transports,
        })),
    ).toEqual([
      {
        id: 'applik8s://tasks/proof.v1/operations/run',
        classification: 'application-policy',
        transports: ['workflow'],
      },
      {
        id: 'applik8s://workflows/proof.v1/operations/cancel',
        classification: 'application-policy',
        transports: ['workflow'],
      },
      {
        id: 'applik8s://workflows/proof.v1/operations/result',
        classification: 'application-policy',
        transports: ['workflow'],
      },
      {
        id: 'applik8s://workflows/proof.v1/operations/start',
        classification: 'application-policy',
        transports: ['workflow'],
      },
    ]);
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

  it('catalogs CRD-backed model operations and views under the same canonical identities', () => {
    const createOperation = 'applik8s://models/ModerationPolicy/operations/create' as const;
    const currentOperation = 'applik8s://queries/ModerationPolicy/operations/current' as const;
    const catalog = compileApplicationOperationCatalog({
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'chirp' },
      nodes: [
        {
          id: 'crd.moderation-policy',
          kind: 'crd',
          name: 'ModerationPolicy',
          stability: 'stable',
          materialization: 'kubernetes-crd',
          resource: {
            apiVersion: 'chirp.applik8s.dev/v1alpha1',
            kind: 'ModerationPolicy',
            plural: 'moderationpolicies',
            scope: 'Namespaced',
          },
          common: {
            identity: { fields: ['metadata.name'], encoding: 'scalar' },
            snapshot: { shape: 'identity-value-revision', revisionOptional: true },
            changes: { authority: 'kubernetes-watch', rawWrites: 'observed' },
            relationships: [],
            operations: [{
              name: 'create',
              operation: 'create',
              transport: 'command',
              publicId: 'ModerationPolicy.create',
              authorization: 'application-defined',
            }],
          },
        },
        {
          id: 'query.ModerationPolicy.current',
          kind: 'query',
          name: 'ModerationPolicy.current',
          publicId: 'ModerationPolicy.current',
          version: 'v1',
          stability: 'stable',
          input: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
          output: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
          reads: [{ model: { nodeId: 'crd.moderation-policy' } }],
          authorization: 'application-defined',
          trustedContext: [],
          budgets: { timeoutMs: 1_000, maxResultBytes: 1_024, maxRows: 1 },
          snapshotResume: 'resumableInvalidation',
          incremental: 'invalidation-requery',
          cursor: 'opaque-query-version-context-scoped',
          authorizationSource: '() => true',
          handlerSource: 'async () => ({})',
          modelOperation: {
            model: { nodeId: 'crd.moderation-policy' },
            name: 'current',
            kind: 'view',
          },
        },
        {
          id: 'authority-manifest.application',
          kind: 'authorityManifest',
          name: 'application-authority',
          stability: 'stable',
          manifest: {
            apiVersion: 'applik8s.authorityManifest/v1alpha1',
            application: 'chirp',
            revision: 'sha256:crd-role',
            identities: [],
            permissions: [{
              id: 'permission:chirp:moderator',
              name: 'moderator',
              operationIds: [createOperation, currentOperation],
              scope: { kind: 'all' },
              grantable: false,
            }],
            roles: [],
            grants: [],
            outcomes: [],
          },
        },
      ],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
      compatibility: emptyCompatibility,
    }, { revision: 'catalog-crd-authority' });

    expect(catalog.operations.map((operation) => operation.id)).toEqual([
      createOperation,
      currentOperation,
    ]);
    expect(catalog.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createOperation,
          target: expect.objectContaining({ model: 'ModerationPolicy' }),
          authority: expect.objectContaining({ classification: 'assigned' }),
        }),
        expect.objectContaining({
          id: currentOperation,
          target: expect.objectContaining({ model: 'ModerationPolicy' }),
          authority: expect.objectContaining({ classification: 'assigned' }),
        }),
      ]),
    );
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
    const operationId = catalog.operations[0]?.id;
    if (!operationId) throw new Error('Expected one compiled operation.');
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
        transports: ['workflow'],
        delegation: 'forbidden',
        impersonation: 'forbidden',
      }),
    ]);
  });

  it('rejects a task dependency that explicitly selects a non-workflow transport', () => {
    const base = graph('public');
    const catalog = compileApplicationOperationCatalog(base, {
      revision: 'catalog-task-transport',
    });
    const operationId = catalog.operations[0]?.id;
    if (!operationId) throw new Error('Expected one compiled operation.');
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
                predicates: [],
                transport: {
                  kind: 'transport',
                  bindingId: 'posts.publish.v1',
                  transport: 'event',
                },
              },
              terminal: true,
            },
          }],
          retry: {
            mode: 'boundedExponentialBackoff',
            maxAttempts: 3,
            initialDelayMs: 100,
            maxDelayMs: 1_000,
          },
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

    expect(() => compileApplicationWorkloadAuthority(workloadGraph, catalog)).toThrow(
      /function-native task operations execute with workflow authority/i,
    );
  });

  it('serializes one workload authority envelope per declared AI agent tool', () => {
    const base = graph('public');
    const catalog = compileApplicationOperationCatalog(base, {
      revision: 'catalog-agent',
    });
    const operation = catalog.operations[0];
    if (!operation) throw new Error('Expected one compiled operation.');
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
          state: {
            interface: 'TransactionalDatabase',
            nodeId: 'provider.transactional-database',
          },
          instructions: { kind: 'static', value: 'Publish only admitted posts.' },
          tools: [{
            operationId: operation.id,
            operationVersion: operation.version,
            transport: 'command',
            graphNode: { nodeId: 'model.post' },
            authority: {
              classification: 'public',
              permissionIds: [],
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
            tanstackAI: '0.45.1',
            tanstackAIClient: '0.23.3',
            tanstackAIReact: '0.19.3',
            tanstackAIPersistence: '0.1.5',
            agUi: '0.1.1-canary.beta.0',
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

  it('retains typed function-native HTTP schemas in the canonical operation catalog', () => {
    const base = graph('public');
    const input = {
      kind: 'declared' as const,
      runtime: 'arktype' as const,
      jsonSchema: {
        type: 'object',
        properties: { postId: { type: 'string' } },
        required: ['postId'],
      },
    };
    const output = {
      kind: 'declared' as const,
      runtime: 'arktype' as const,
      jsonSchema: {
        type: 'object',
        properties: { revision: { type: 'number' } },
        required: ['revision'],
      },
    };
    const catalog = compileApplicationOperationCatalog({
      ...base,
      nodes: [{
        id: 'server.api',
        kind: 'server',
        name: 'api',
        stability: 'stable',
        routes: [{
          id: 'publish-post',
          named: true,
          method: 'POST',
          path: '/posts/:id/publish',
          authority: {
            classification: 'public',
            permissionIds: [],
            grantable: false,
            delegable: false,
            scope: { kind: 'all' },
          },
          functionNative: {
            input,
            output,
            handler: { source: 'async ({ input }) => ({ revision: 1 })' },
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
      revision: 'catalog-typed-routes',
      requireClassified: true,
    });

    expect(catalog.operations).toEqual([
      expect.objectContaining({
        id: 'applik8s://http/api/operations/publish-post',
        kind: 'http.route',
        input: expect.objectContaining({ schema: input.jsonSchema }),
        output: expect.objectContaining({ schema: output.jsonSchema }),
      }),
    ]);
  });

  it('catalogs every inbound actor member with exact target identity and session-derived realtime authority', () => {
    const schema = (properties: JsonObject = {}): ApplicationMessageContractSchema => ({
      kind: 'declared' as const,
      runtime: 'arktype' as const,
      jsonSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    });
    const classified = {
      classification: 'public' as const,
      permissionIds: [],
      grantable: false,
      delegable: false,
      scope: { kind: 'all' as const },
    };
    const base = graph('public');
    const actorGraph: ApplicationGraph = {
      ...base,
      nodes: [{
        id: 'actor.workspace.v1',
        kind: 'actor',
        name: 'workspace.v1',
        stability: 'experimental',
        definition: {
          id: 'workspace.v1',
          key: schema({ key: { type: 'string' } }),
          state: schema({ title: { type: 'string' } }),
          stateVersion: 1,
          migrationDigest: 'sha256:none',
          migrations: [],
          protocol: [
            { name: 'rename', kind: 'command', input: schema({ title: { type: 'string' } }), output: schema({ revision: { type: 'number' } }), authority: classified },
            { name: 'observe', kind: 'message', input: schema({ at: { type: 'string' } }), authority: classified },
            { name: 'connect', kind: 'connection', input: schema({ client: { type: 'string' } }), authority: classified },
            { name: 'cursor', kind: 'connectionMessage', input: schema({ position: { type: 'number' } }) },
            { name: 'disconnect', kind: 'disconnection', input: schema({ reason: { type: 'string' } }) },
            { name: 'broadcast', kind: 'broadcast', input: schema({ value: { type: 'string' } }) },
            { name: 'expire', kind: 'alarm', input: schema({ revision: { type: 'number' } }), authority: classified },
          ],
          requirements: {
            durableState: true,
            serializedTurns: true,
            transactionalOutbox: true,
            durableAlarms: true,
            realtimeConnections: true,
            connectionLeases: true,
            realtimeMessages: true,
            realtimeBroadcast: true,
          },
        },
        runtime: { interface: 'ActorRuntime', nodeId: 'provider.actor-runtime' },
        actorBindings: [{
          handler: 'rename',
          alias: 'sendObservation',
          actor: { nodeId: 'actor.workspace.v1' },
          member: 'observe',
          memberKind: 'message',
        }],
        handlers: [
          { member: 'rename', callback: { source: 'async () => ({ revision: 1 })' } },
          { member: 'observe', callback: { source: 'async () => undefined' } },
          { member: 'cursor', callback: { source: 'async () => undefined' } },
          { member: 'expire', callback: { source: 'async () => undefined' } },
        ],
        semantics: { serialization: 'fullTurnPerIdentity', admission: 'idempotentReceipt', references: 'inertAddress' },
      }],
    };
    const catalog = compileApplicationOperationCatalog(actorGraph, { requireClassified: true });

    expect(catalog.operations.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'applik8s://actors/workspace.v1/operations/connect', kind: 'actor.connection' },
      { id: 'applik8s://actors/workspace.v1/operations/cursor', kind: 'actor.connection-message' },
      { id: 'applik8s://actors/workspace.v1/operations/disconnect', kind: 'actor.disconnection' },
      { id: 'applik8s://actors/workspace.v1/operations/expire', kind: 'actor.alarm' },
      { id: 'applik8s://actors/workspace.v1/operations/observe', kind: 'actor.message' },
      { id: 'applik8s://actors/workspace.v1/operations/rename', kind: 'actor.command' },
    ]);
    expect(catalog.operations.find(({ name }) => name === 'cursor')).toMatchObject({
      authority: { classification: 'application-policy', transports: ['http'] },
      placement: { runtime: 'actor-runtime' },
    });
    expect(catalog.operations.find(({ name }) => name === 'rename')?.target?.identity.schema).toEqual(schema({ key: { type: 'string' } }).jsonSchema);
    const workloadAuthority = compileApplicationWorkloadAuthority(actorGraph, catalog);
    expect(workloadAuthority.filter(({ workloadIdentity }) =>
      workloadIdentity.subject === 'actor.workspace.v1:rename')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'applik8s://actors/workspace.v1/operations/rename',
          transports: ['direct'],
        }),
        expect.objectContaining({
          operationId: 'applik8s://actors/workspace.v1/operations/observe',
          transports: ['direct'],
        }),
        expect.objectContaining({
          operationId: 'applik8s://actors/workspace.v1/operations/expire',
          transports: ['control-plane'],
        }),
      ]),
    );
  });
});
