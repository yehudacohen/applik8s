// typecast-file-boundary: graph fixtures use closed literals and deliberate negative shapes to test compiler lowering.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationGraph, ApplicationGraphNode, JsonObject } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationReactive } from '../src/application-reactive/index.js';
import { compileTypeKroComposition } from '../src/pipeline/index.js';
import { applicationGraphFor } from '@applik8s/applik8s';
import { nativeQueryApplication } from './fixtures/v06-native-query-app.js';

const database = { name: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog' } as const;

describe('generated v0.6 reactive workloads', () => {
  it('preserves module-local Drizzle captures through CLI-style discovery and singleton-owns shared ClickHouse infrastructure', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-v06-discovery-'));
    const previousNamespace = process.env.APPLIK8S_E2E_NAMESPACE;
    const previousStackName = process.env.APPLIK8S_E2E_STACK_NAME;
    process.env.APPLIK8S_E2E_NAMESPACE = 'v06-compiler-proof';
    process.env.APPLIK8S_E2E_STACK_NAME = 'v06-compiler-proof';
    try {
      const result = await compileTypeKroComposition({
        entrypoint: join(process.cwd(), 'packages/e2e/test/fixtures/v06-generated-app/app.ts'),
        compositionName: 'v06GeneratedApp',
        outDir,
        runtimeVersionRange: '^0.6.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.reactiveArtifacts.map((artifact) => artifact.kind).sort()).toEqual(['projectionWorker', 'queryGateway']);
      const gatewayArtifact = result.value.artifacts.reactiveArtifacts.find((artifact) => artifact.kind === 'queryGateway');
      const gatewaySource = await readFile(gatewayArtifact?.sourcePath ?? '', 'utf8');
      expect(gatewaySource).toMatch(/reads:\[\{\$model:\{name:"Card"\}\}\]/);
      expect(gatewaySource).not.toMatch(/reads:\[\{\$model:\{name:"card"\}\}\]/);
      const root = result.value.artifacts.resources.find((resource) => resource.kind === 'ResourceGraphDefinition' && resource.metadata?.name === 'v06-compiler-proof');
      const serialized = JSON.stringify(root);
      expect(serialized).toContain('ClickHouseOperatorBootstrap');
      expect(serialized).toContain('externalRef');
      expect(serialized).toContain('NetworkPolicy');
      expect(serialized).toContain('projection-worker');
      expect(serialized).toContain('clickhouse.altinity.com/chi');
      expect(serialized).toContain('"from"');
      expect(serialized).not.toContain('"_from"');
      expect(serialized).not.toContain('"kind":"Namespace","metadata":{"name":"clickhouse-system"');
      expect(result.value.artifacts.instanceYamlPaths.some((path) => path.includes('clickhouseoperatorbootstrap'))).toBe(true);
      expect(result.value.artifacts.instanceYamlPaths.some((path) => path.includes('clickhousehelmrepository'))).toBe(true);
      const operatorInstancePath = result.value.artifacts.instanceYamlPaths.find((path) => path.includes('clickhouseoperatorbootstrap')) ?? '';
      const operatorInstance = await readFile(operatorInstancePath, 'utf8');
      expect(operatorInstance).toContain('config.yaml:');
      expect(operatorInstance).toContain('include:');
      expect(operatorInstance).toContain('.*');
      expect(operatorInstance).toContain('networksIP:');
      expect(operatorInstance).toContain('0.0.0.0/0');
      expect(operatorInstance).toContain('::/0');
      expect(operatorInstance).toContain('applyset.kubernetes.io/part-of');
      expect(operatorInstance).toContain('kro.run/owned');
      const applyScript = await readFile(result.value.artifacts.applyScriptPath, 'utf8');
      expect(applyScript).toContain("wait_for_api_resource 'kro.run' 'ClickHouseHelmRepository'");
      expect(applyScript).toContain("wait_for_api_resource 'kro.run' 'ClickHouseOperatorBootstrap'");
      expect(applyScript).toContain('metadata.deletionTimestamp');
      expect(applyScript).toContain('Waiting for terminating resource');
    } finally {
      if (previousNamespace === undefined) delete process.env.APPLIK8S_E2E_NAMESPACE; else process.env.APPLIK8S_E2E_NAMESPACE = previousNamespace;
      if (previousStackName === undefined) delete process.env.APPLIK8S_E2E_STACK_NAME; else process.env.APPLIK8S_E2E_STACK_NAME = previousStackName;
    }
  }, 120_000);

  it('bundles a normal app-scoped Drizzle query without an example-only graph fixture', async () => {
    const graph = applicationGraphFor(nativeQueryApplication.composition);
    if (!graph) throw new Error('Native query fixture did not expose its ApplicationGraph.');
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-native-query-gateway-'));

    const [artifact] = await emitGeneratedApplicationReactive({ graph, outDir, entrypoint: new URL('./fixtures/v06-native-query-app.ts', import.meta.url).pathname });

    expect(artifact).toMatchObject({ kind: 'queryGateway', name: 'native-query-fixture-public' });
    expect(artifact?.sizeBytes).toBeLessThan(550_000);
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('cards');
    expect(source).not.toContain('typekro');
  });

  it('fails closed when a generated query captures authoring-only model facet behavior', async () => {
    const graph = applicationGraphFor(nativeQueryApplication.composition);
    if (!graph) throw new Error('Native query fixture did not expose its ApplicationGraph.');
    const query = graph.nodes.find((node) => node.kind === 'query');
    if (query?.kind !== 'query') throw new Error('Native query fixture did not expose its query node.');
    const unsafeGraph: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === query.id ? {
        ...query,
        handlerDependencies: {
          source: 'const unsafeRuntimeSchema = cards.$model.schema;',
          resolveDir: process.cwd(),
        },
      } : node),
    };

    await expect(emitGeneratedApplicationReactive({
      graph: unsafeGraph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-native-query-facet-')),
      entrypoint: new URL('./fixtures/v06-native-query-app.ts', import.meta.url).pathname,
    })).rejects.toThrow(/authoring-only model facet member.*schema/);
  });

  it('bundles an authenticated HTTP/SSE gateway with Secret-backed PostgreSQL and cursor authority', async () => {
    const graph = reactiveGraph([
      { id: 'provider.event-log', kind: 'provider', name: 'EventLog', stability: 'stable', interface: 'EventLog', implementation: 'nats-jetstream', config: { name: 'events', namespace: 'catalog', stream: 'APPLIK8S_EVENTS', subjectPrefix: 'applik8s', provision: false }, contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'EventLog', version: 'v1alpha1', requirements: [], guarantees: [], implementation: { name: 'nats-jetstream' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] } },
      { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', common: { relationships: [{ source: 'Card', name: 'set', target: 'sets', cardinality: 'one', integrity: 'foreign-key', fields: ['setId'], references: ['id'] }] }, native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'model.set', kind: 'model', name: 'Set', stability: 'stable', native: { artifact: { name: 'sets' } }, runtime: { name: 'Set', tableName: 'sets', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'command.cards.rename.v1', kind: 'command', name: 'cards.rename.v1', stability: 'stable', contract: { name: 'cards.rename', version: 'v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { changed: { type: 'boolean' } }, required: ['changed'] }), errors: [] } },
      { id: 'command-handler.card-rename', kind: 'commandHandler', name: 'Card-cards.rename.v1', stability: 'stable', model: { nodeId: 'model.card' }, command: { nodeId: 'command.cards.rename.v1' }, key: { kind: 'function', source: '(input) => input.cardId' }, ordering: 'serial', missing: 'reject', transaction: { models: [{ nodeId: 'model.card' }], history: [], outbox: [] }, retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, retention: { replayWindowSeconds: 3600, auditWindowSeconds: 7200, publishedOutboxWindowSeconds: 3600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 }, effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: '() => ({ changed: true })', projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' } },
      { id: 'query.cards.list.v1', kind: 'query', name: 'cards.list', version: 'v1', stability: 'stable', input: schema({ type: 'object', properties: {}, required: [] }), output: schema({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }), reads: [{ model: { nodeId: 'model.card' }, relationship: 'set' }], authorization: 'application-defined', trustedContext: [], budgets: { timeoutMs: 1000, maxResultBytes: 10000, maxRows: 100 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped', database, authorizationSource: '({ principal }) => principal.id.length > 0', handlerSource: 'async () => []' },
      { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' },
      { id: 'subscription.card-events', kind: 'subscription', name: 'card-events', stability: 'stable', source: { nodeId: 'stream.cards.changed.v1' }, delivery: 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: '({ principal }) => principal.id === "generated-stream-subscription-proof"', retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 250, maxDelayMs: 30000 }, suspension: 'bounded-failures' },
      { id: 'gateway.public', kind: 'gateway', name: 'public', stability: 'stable', queries: [{ nodeId: 'query.cards.list.v1' }], commands: [{ command: { nodeId: 'command.cards.rename.v1' }, handler: { nodeId: 'command-handler.card-rename' } }], subscriptions: [{ nodeId: 'subscription.card-events' }], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: { perPrincipal: 10, total: 100 }, routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation', materialization: 'generatedDeployment', authenticationSource: 'async () => ({ principal: { id: "test" }, trustedContext: {}, authorizationVersion: "v1" })', commandAuthorizationSource: '() => true', cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: 'catalog', key: 'secret' }, deployment: { namespace: 'catalog', image: 'node:22-alpine', replicas: 2, port: 8080 } },
    ] as unknown as ApplicationGraphNode[]);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-reactive-gateway-'));
    const [artifact] = await emitGeneratedApplicationReactive({ graph, outDir, entrypoint: import.meta.filename });
    expect(artifact).toMatchObject({ kind: 'queryGateway', name: 'reactive-test-public' });
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual(['ConfigMap', 'Deployment', 'NetworkPolicy', 'Service', 'PodDisruptionBudget']);
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_CURSOR_SECRET');
    expect(source).toContain('applik8s.command/v1alpha1');
    expect(source).toContain('generated-stream-subscription-proof');
    expect(source).toContain('applik8s.stream/v1alpha1');
    expect(source).toMatch(/reads:\[\{\$model:\{name:"Card"\}\},\{\$model:\{name:"Set"\}\}\]/);
    expect(artifact?.sizeBytes).toBeLessThan(550_000);
  });

  it('bundles a durable PostgreSQL-to-ClickHouse projection and fails closed on unresolved callbacks', async () => {
    const provider = { id: 'provider.projection-store', kind: 'provider', name: 'ProjectionStore', stability: 'stable', interface: 'ProjectionStore', implementation: 'clickhouse', contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'ProjectionStore', version: 'v1alpha1', requirements: [], guarantees: [], implementation: { name: 'clickhouse' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }, config: { namespace: 'catalog', endpoint: 'http://clickhouse.catalog.svc:8123', database: 'analytics' } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => { throw new Error("projection-stream-authorization-proof"); }' } as const;
    const projection = { id: 'projection.cards', kind: 'projection', name: 'cards', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'ProjectionStore', nodeId: provider.id }, rebuildable: true, checkpoint: 'idempotent', output: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload' } as const;
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-reactive-projection-'));
    const [artifact] = await emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, projection] as unknown as ApplicationGraphNode[]), outDir, entrypoint: import.meta.filename });
    expect(artifact).toMatchObject({ kind: 'projectionWorker', name: 'reactive-test-cards' });
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_PROJECTION_RETENTION_GAP');
    expect(source).toContain('applik8s:projection:cards');
    expect(source).toContain('projection-stream-authorization-proof');
    await expect(emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, { ...projection, handlerUnresolved: ['localHelper'] }] as unknown as ApplicationGraphNode[]), outDir: join(outDir, 'invalid'), entrypoint: import.meta.filename })).rejects.toThrow(/unresolved local identifier/);
  });
});

function schema(jsonSchema: JsonObject) { return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema }; }
function reactiveGraph(nodes: readonly ApplicationGraphNode[]): ApplicationGraph { return { apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'reactive-test', namespace: 'catalog' }, nodes, edges: [], providerRequirements: [], providerBindings: [], compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] } }; }
