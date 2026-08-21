// typecast-file-boundary: Runtime-access fixtures assemble exact graph discriminants to exercise ambiguity and least-privilege lowering.
import type { ApplicationGraph } from '@applik8s/core';
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
    expect(kubernetes.executions[0]?.kubernetes).toEqual({
      serviceAccountName: 'notes-operator-notes',
      namespace: 'notes',
      rules: [{ apiGroups: [''], resources: ['secrets'], resourceNames: ['signing'], verbs: ['get'] }],
    });
    expect(kubernetes.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('lowers object access to an exact AWS bucket prefix and fails closed when the bucket is unresolved', () => {
    const graph = awsObjectAccessGraph('application-objects');
    const aws = compileApplicationRuntimeAccessPlan({ graph, target: 'aws' });
    expect(aws.diagnostics).toEqual([]);
    expect(aws.executions[0]?.aws).toMatchObject({
      roleName: 'objects-operator.objects',
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
});

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
