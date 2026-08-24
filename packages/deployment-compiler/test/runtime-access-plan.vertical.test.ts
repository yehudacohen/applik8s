// typecast-file-boundary: Runtime-access fixtures assemble exact graph discriminants to exercise ambiguity and least-privilege lowering.
import { applicationRuntimeAccessRequirement, deriveApplicationGraphFoundation, type ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { compileApplicationRuntimeAccessPlan } from '../src/index.js';

describe('v0.8 runtime-access lowering', () => {
  it('issues exact local grants and resource-name-bounded Kubernetes Secret access per execution identity', () => {
    const graph = accessGraph();
    const local = compileApplicationRuntimeAccessPlan({ graph, target: 'local' });
    expect(local.diagnostics).toEqual([]);
    expect(local.executions).toHaveLength(1);
    expect(local.executions[0]).toMatchObject({
      nodeId: 'operator.notes',
      local: { grants: expect.arrayContaining([expect.objectContaining({ operation: 'secret.read', scope: { kind: 'resource', resourceId: 'secret.signing' } })]) },
    });
    const kubernetes = compileApplicationRuntimeAccessPlan({ graph, target: 'kubernetes', namespace: 'notes' });
    expect(kubernetes.diagnostics).toEqual([]);
    expect(kubernetes.executions[0]?.kubernetes).toMatchObject({
      serviceAccountName: expect.stringMatching(/^notes-operator-notes-[a-f0-9]{10}$/u),
      bindings: [{
        kind: 'Role',
        namespace: 'notes',
        rules: [{ apiGroups: [''], resources: ['secrets'], resourceNames: ['signing'], verbs: ['get'] }],
      }],
      credentialResources: ['secret.signing'],
      networkConnections: [],
    });
    expect(kubernetes.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('lowers object access to an exact AWS bucket prefix and fails closed when the bucket is unresolved', () => {
    const graph = awsObjectAccessGraph('application-objects');
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws).toMatchObject({
      roleName: expect.stringMatching(/^objects-operator\.objects-[a-f0-9]{10}$/u),
      statements: [
        {
          effect: 'Allow',
          actions: ['s3:AbortMultipartUpload', 's3:PutObject'],
          resources: ['arn:aws:s3:::application-objects/tenants/*'],
        },
      ],
    });
    expect(JSON.stringify(aws.executions[0]?.aws)).not.toContain('"Resource":"*"');

    const unresolved = compileApplicationRuntimeAccessPlan({ graph: awsObjectAccessGraph(undefined), target: 'aws' });
    expect(unresolved.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED' }),
    ]);
  });

  it('resolves a processor event requirement through its exact bound EventLog', () => {
    const graph = eventAccessGraph(['provider.events']);
    const aws = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'aws',
      targetResources: { 'provider.events': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/events' } },
    });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws?.statements).toEqual([{
      effect: 'Allow',
      actions: ['kinesis:DescribeStreamSummary', 'kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:ListShards', 'kinesis:PutRecord', 'kinesis:PutRecords'],
      resources: ['arn:aws:kinesis:us-east-1:123456789012:stream/events'],
    }]);
  });

  it('does not invent Kinesis authority for a database-backed application stream', () => {
    const graph: ApplicationGraph = {
      ...emptyGraph('outbox-stream'),
      nodes: [
        { id: 'event.changed', kind: 'stream', name: 'changed', version: 'v1', stability: 'stable', payload: declaredSchema(), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3_600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database: { name: 'application', connectionEnvName: 'APPLIK8S_DATABASE_APPLICATION_URL', secretName: 'application-app', secretKey: 'uri' }, partitionSource: '() => "all"', authorizationSource: '() => true' },
        { id: 'subscription.changed', kind: 'subscription', name: 'changed', stability: 'stable', source: { nodeId: 'event.changed' }, delivery: 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: '() => true', retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, suspension: 'bounded-failures' },
      ],
    };
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws?.statements).toEqual([]);
  });

  it('fails closed rather than selecting an arbitrary event provider', () => {
    const graph = eventAccessGraph(['provider.events-a', 'provider.events-b']);
    const aws = compileApplicationRuntimeAccessPlan({
      graph,
      target: 'aws',
      targetResources: {
        'provider.events-a': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/a' },
        'provider.events-b': { streamArn: 'arn:aws:kinesis:us-east-1:123456789012:stream/b' },
      },
    });
    expect(aws.diagnostics).toHaveLength(2);
    expect(aws.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED' }),
    ]));
    expect(aws.executions[0]?.aws?.statements).toEqual([]);
  });

  it('separates cross-namespace Roles from cluster-scoped access without broadening either', () => {
    const plan = compileApplicationRuntimeAccessPlan({
      graph: kubernetesScopeGraph(),
      target: 'kubernetes',
      namespace: 'control-plane',
    });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.executions[0]?.kubernetes?.bindings).toEqual([
      expect.objectContaining({
        kind: 'ClusterRole',
        rules: [{ apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get'] }],
      }),
      expect.objectContaining({
        kind: 'Role',
        namespace: 'team-a',
        rules: [{ apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'] }],
      }),
      expect.objectContaining({
        kind: 'Role',
        namespace: 'team-b',
        rules: [{ apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'] }],
      }),
    ]);
  });

  it('uses collision-resistant workload identities after Kubernetes/AWS normalization', () => {
    const graph = collisionGraph();
    const kubernetes = compileApplicationRuntimeAccessPlan({ graph, target: 'kubernetes' });
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(new Set(kubernetes.executions.map(({ kubernetes: plan }) => plan?.serviceAccountName)).size).toBe(2);
    expect(new Set(aws.executions.map(({ aws: plan }) => plan?.roleName)).size).toBe(2);
  });

  it('rejects wildcard Kubernetes resources rather than emitting broad RBAC', () => {
    const graph = kubernetesScopeGraph();
    const permission = graph.nodes.find((node) => node.kind === 'permission');
    if (!permission || permission.kind !== 'permission') throw new Error('Expected permission fixture.');
    const broad: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === permission.id
        ? { ...permission, rules: [{ apiGroups: ['example.dev'], resources: ['*'], verbs: ['get'] }] }
        : node),
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph: broad, target: 'kubernetes' });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN' }));
    expect(plan.executions.flatMap(({ kubernetes }) => kubernetes?.bindings ?? [])).toEqual([]);
  });

  it('explains redundant, widened, and unused explicit access without losing source provenance', () => {
    const graph = accessGraph();
    const derived = deriveApplicationGraphFoundation(graph);
    const inferred = derived.runtimeAccess.find(({ target }) => target.operation === 'secret.read');
    if (!inferred) throw new Error('Expected inferred Secret access.');
    const explicit = (operation: typeof inferred.target.operation, scope: typeof inferred.target.scope) => applicationRuntimeAccessRequirement({
      ...inferred,
      target: { ...inferred.target, operation, scope },
      origin: 'explicit',
    });
    const withExplicit: ApplicationGraph = {
      ...graph,
      foundation: {
        ...derived,
        runtimeAccess: [
          explicit('secret.read', inferred.target.scope),
          explicit('secret.read', { kind: 'namespace', namespace: 'other' }),
          explicit('object.delete', { kind: 'external', responsibility: 'security-team' }),
        ],
      },
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph: withExplicit, target: 'local' });
    expect(plan.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'RUNTIME_ACCESS_EXPLICIT_UNUSED',
      'RUNTIME_ACCESS_EXPLICIT_WIDENING',
      'RUNTIME_ACCESS_EXPLICIT_REDUNDANT',
    ]));
    expect(plan.diagnostics).toHaveLength(3);
    expect(plan.executions[0]?.requirements.every(({ provenance }) => provenance.length > 0)).toBe(true);
    expect(plan.sourceGraphDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(plan.executions[0]?.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('fails closed when the selected provider has no target runtime-access guarantee', () => {
    const graph: ApplicationGraph = {
      ...emptyGraph('provider-access'),
      nodes: [
        {
          id: 'provider.acquisition',
          kind: 'provider',
          name: 'AcquisitionProvider',
          stability: 'stable',
          interface: 'AcquisitionProvider',
          implementation: 'custom-http',
        },
        {
          id: 'server.api',
          kind: 'server',
          name: 'api',
          stability: 'stable',
          routes: [{
            id: 'acquire',
            method: 'POST',
            path: '/acquire',
            diagnostics: routeDiagnostics(),
            functionNative: {
              input: declaredSchema(),
              output: declaredSchema(),
              handler: { source: 'async input => input' },
              providerBindings: [{
                identifier: 'Acquisition.acquire',
                provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
                operation: {
                  member: 'acquire',
                  runtime: {
                    module: '@fixture/acquisition',
                    export: 'acquire',
                    access: { kind: 'provider', operations: ['connection.use'] },
                  },
                },
              }],
              idempotency: { source: 'http-idempotency-key', contextScoped: true },
              requestBoundary: { durableValues: 'schema-normalized-only', rawRequestCapture: 'rejected', principal: 'framework-authenticated' },
            },
          }],
          resources: [],
          indexes: [],
          observability: serverObservability(),
        },
      ],
      providerRequirements: [{
        id: 'requirement.acquisition',
        interface: 'AcquisitionProvider',
        consumer: { nodeId: 'server.api' },
        provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
        required: true,
        purpose: 'acquisition',
        diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
      }],
      providerBindings: [{
        requirement: 'requirement.acquisition',
        provider: { interface: 'AcquisitionProvider', nodeId: 'provider.acquisition' },
        generatedResources: [],
        runtime: {},
      }],
    };
    const plan = compileApplicationRuntimeAccessPlan({ graph, target: 'local' });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'RUNTIME_ACCESS_PROVIDER_GUARANTEE_UNSUPPORTED',
    }));
    expect(plan.executions[0]?.lowerings).toContainEqual(expect.objectContaining({
      operation: 'connection.use',
      fidelity: 'unsupported',
      providerGuarantee: {
        providerId: 'provider.acquisition',
        disposition: 'unsupported',
        evidenceLevel: 'none',
      },
    }));
  });
});

function routeDiagnostics() {
  return {
    routeFailureEvent: 'applik8s-server-route-failure' as const,
    actionFailureEvent: 'applik8s-route-action-failure' as const,
    failurePolicy: 'failClosed' as const,
    partialEffects: 'unknownAfterActionStarted' as const,
    sourceMaps: 'required' as const,
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'] as const,
  };
}

function serverObservability() {
  return {
    health: { mode: 'http' as const, readinessPath: '/readyz', livenessPath: '/healthz' },
    logs: { format: 'json' as const, component: 'api', failureEvents: [] },
    metrics: { mode: 'none' as const, names: [] },
    events: [],
    sourceMaps: 'required' as const,
    replayArtifacts: [],
    diagnosticsArtifact: { kind: 'routeDiagnostics' as const, name: 'api-diagnostics' },
  };
}

function kubernetesScopeGraph(): ApplicationGraph {
  return {
    ...emptyGraph('scopes'),
    nodes: [
      { id: 'operator.scopes', kind: 'operator', name: 'scopes', stability: 'stable', resources: [], watches: [] },
      { id: 'crd.widgets', kind: 'crd', name: 'Widget', stability: 'stable', materialization: 'kubernetes-crd', resource: { apiVersion: 'example.dev/v1', kind: 'Widget', plural: 'widgets', scope: 'Namespaced' } },
      { id: 'crd.clusterwidgets', kind: 'crd', name: 'ClusterWidget', stability: 'stable', materialization: 'kubernetes-crd', resource: { apiVersion: 'example.dev/v1', kind: 'ClusterWidget', plural: 'clusterwidgets', scope: 'Cluster' } },
      {
        id: 'permission.scopes', kind: 'permission', name: 'scopes', stability: 'stable', owner: { nodeId: 'operator.scopes' }, mode: 'inferred',
        rules: [
          { apiGroups: ['example.dev'], resources: ['widgets'], verbs: ['get', 'list', 'watch'], namespaces: ['team-b', 'team-a'] },
          { apiGroups: ['example.dev'], resources: ['clusterwidgets'], verbs: ['get'] },
        ],
      },
    ],
  };
}

function collisionGraph(): ApplicationGraph {
  return {
    ...emptyGraph('collisions'),
    nodes: [
      { id: 'operator.a_b', kind: 'operator', name: 'a_b', stability: 'stable', resources: [], watches: [] },
      { id: 'operator.a-b', kind: 'operator', name: 'a-b', stability: 'stable', resources: [], watches: [] },
      { id: 'secret.one', kind: 'secret', name: 'one', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'value', redaction: 'required', generatedResources: [] },
      { id: 'secret.two', kind: 'secret', name: 'two', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'value', redaction: 'required', generatedResources: [] },
    ],
    edges: [
      { from: { nodeId: 'operator.a_b' }, to: { nodeId: 'secret.one' }, relationship: 'reads' },
      { from: { nodeId: 'operator.a-b' }, to: { nodeId: 'secret.two' }, relationship: 'reads' },
    ],
  };
}

function eventAccessGraph(providerIds: readonly string[]): ApplicationGraph {
  return {
    ...emptyGraph('event-access'),
    nodes: [
      ...providerIds.map((id) => ({ id, kind: 'provider' as const, name: id, stability: 'stable' as const, interface: 'EventLog', implementation: 'nats-jetstream' })),
      { id: 'handler.changed', kind: 'commandHandler', name: 'changed', stability: 'stable', model: { nodeId: 'model.record' }, command: { nodeId: 'command.change' }, key: { kind: 'field', source: 'input.id' }, ordering: 'serial', missing: 'reject', transaction: { models: [], history: [], outbox: [] }, retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, retention: { replayWindowSeconds: 3_600, auditWindowSeconds: 7_200, publishedOutboxWindowSeconds: 3_600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 }, effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: 'async () => ({})', projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' } },
      { id: 'processor.events', kind: 'processor', name: 'events', stability: 'stable', handlers: [{ nodeId: 'handler.changed' }], runtime: 'node', deployment: { replicas: 1, concurrency: 1, maxAckPending: 1, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } }, disruption: { maxUnavailable: 1 } }, inference: 'generated', lifecycle: 'longLived' },
    ],
    edges: [{ from: { nodeId: 'processor.events' }, to: { nodeId: 'handler.changed' }, relationship: 'owns' }],
    providerRequirements: providerIds.map((providerId, index) => ({ id: `requirement.events.${index}`, consumer: { nodeId: 'processor.events' }, interface: 'EventLog', provider: { interface: 'EventLog', nodeId: providerId }, required: true, purpose: 'event processing', diagnostics: { missing: 'missing event provider', ambiguous: 'ambiguous event provider' } })),
    providerBindings: providerIds.map((providerId, index) => ({ requirement: `requirement.events.${index}`, provider: { interface: 'EventLog', nodeId: providerId }, generatedResources: [], runtime: {} })),
  };
}

function declaredSchema() {
  return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: { type: 'object', properties: {}, required: [] } };
}

function emptyGraph(name: string): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name }, nodes: [], edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function accessGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'notes', namespace: 'notes' },
    nodes: [
      { id: 'operator.notes', kind: 'operator', name: 'notes', stability: 'stable', resources: [], watches: [], sourceLocation: { file: 'src/operator.ts', line: 1, column: 1 } },
      { id: 'secret.signing', kind: 'secret', name: 'signing', stability: 'stable', provider: 'Secret', ownership: 'external', key: 'key', redaction: 'required', generatedResources: [] },
    ],
    edges: [{ from: { nodeId: 'operator.notes' }, to: { nodeId: 'secret.signing' }, relationship: 'reads' }],
    providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

function awsObjectAccessGraph(bucket: string | undefined): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'objects' },
    nodes: [
      { id: 'operator.objects', kind: 'operator', name: 'objects', stability: 'stable', resources: [], watches: [], sourceLocation: { file: 'src/operator.ts', line: 1, column: 1 } },
      {
        id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable', interface: 'ObjectStorage', implementation: 's3',
        config: { objectStorage: { kind: 's3', prefix: 'tenants', ...(bucket ? { bucket } : {}) } },
      },
      {
        id: 'objectStore.attachments', kind: 'objectStore', name: 'attachments', stability: 'stable',
        provider: { interface: 'ObjectStorage', nodeId: 'provider.ObjectStorage' }, objectMode: 'immutable', maxObjectBytes: 1024,
        contentTypes: ['application/octet-stream'],
        browserAccess: { upload: 'signed', download: 'signed', downloadAccess: 'owner', ttlSeconds: 60 }, integrity: 'sha256', credentials: 'server-only', deletion: 'explicit',
      },
    ],
    edges: [{ from: { nodeId: 'operator.objects' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'writes' }],
    providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
