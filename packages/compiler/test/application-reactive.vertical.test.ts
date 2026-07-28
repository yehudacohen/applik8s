// typecast-file-boundary: graph fixtures use closed literals and deliberate negative shapes to test compiler lowering.
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applicationGraphFor } from '@applik8s/applik8s';
import type { ApplicationGraph, ApplicationGraphNode, JsonObject } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  consolidateGeneratedApplicationReactiveResources,
  emitGeneratedApplicationReactive,
} from '../src/application-reactive/index.js';
import { compileTypeKroComposition } from '../src/pipeline/index.js';
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
      expect(serialized.match(/APPLIK8S_INSTALLATION_SPEC/g)?.length ?? 0).toBeGreaterThanOrEqual(result.value.artifacts.reactiveArtifacts.length);
      expect(root?.spec).toMatchObject({
        resources: expect.arrayContaining([expect.objectContaining({
          id: 'applik8sInstallationContract',
          template: expect.objectContaining({
            kind: 'ConfigMap',
            metadata: expect.objectContaining({ name: 'v06-compiler-proof-installation-contract' }),
          }),
        })]),
      });
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
      expect(applyScript).not.toContain('APPLIK8S_FORCE_RGD_NAME');
      expect(applyScript).not.toContain('--force-conflicts');
      expect(applyScript).toContain('wait_for_resource_graph_definition "$manifest"');
      expect(applyScript).toContain('GraphAccepted');
      expect(applyScript).toContain('.observedGeneration');
    } finally {
      if (previousNamespace === undefined) delete process.env.APPLIK8S_E2E_NAMESPACE; else process.env.APPLIK8S_E2E_NAMESPACE = previousNamespace;
      if (previousStackName === undefined) delete process.env.APPLIK8S_E2E_STACK_NAME; else process.env.APPLIK8S_E2E_STACK_NAME = previousStackName;
    }
  }, 120_000);

  it('bundles a normal app-scoped Drizzle query without an example-only graph fixture', async () => {
    const graph = applicationGraphFor(nativeQueryApplication.composition);
    if (!graph) throw new Error('Native query fixture did not expose its ApplicationGraph.');
    const gateway = graph.nodes.find((node) => node.kind === 'gateway');
    if (gateway?.kind !== 'gateway') throw new Error('Native query fixture did not expose its query gateway.');
    const duplicatedGatewayGraph: ApplicationGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { ...gateway, id: 'gateway.internal', name: 'internal' },
      ],
    };
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-native-query-gateway-'));

    const artifacts = await emitGeneratedApplicationReactive({ graph: duplicatedGatewayGraph, outDir, entrypoint: new URL('./fixtures/v06-native-query-app.ts', import.meta.url).pathname });
    const artifact = artifacts.find((entry) => entry.name === 'native-query-fixture-public');

    expect(artifact).toMatchObject({ kind: 'queryGateway', name: 'native-query-fixture-public' });
    expect(artifact?.sizeBytes).toBeLessThan(550_000);
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('cards');
    expect(source).not.toContain('typekro');
    expect(source).toContain('APPLIK8S_HTTP_PORT');
    const consolidated = consolidateGeneratedApplicationReactiveResources({
      graphName: graph.metadata.name,
      artifacts,
    });
    const deployment = consolidated.find((resource) => resource.kind === 'Deployment');
    expect(consolidated.filter((resource) => resource.kind === 'Deployment')).toHaveLength(1);
    expect(consolidated.filter((resource) => resource.kind === 'Service')).toHaveLength(2);
    expect(deployment).toMatchObject({
      metadata: { labels: { 'app.kubernetes.io/component': 'query-gateway' } },
      spec: { strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } } },
    });
    expect(JSON.stringify(deployment)).toContain('"name":"APPLIK8S_HTTP_PORT","value":"8080"');
    expect(JSON.stringify(deployment)).toContain('"name":"APPLIK8S_HTTP_PORT","value":"8081"');
    expect(JSON.stringify(consolidated)).toContain('"targetPort":"http-0"');
    expect(JSON.stringify(consolidated)).toContain('"targetPort":"http-1"');
  });

  it('follows fluent view callbacks and their Drizzle dependencies through a thin imported entrypoint', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-modular-view-'));
    const result = await compileTypeKroComposition({
      entrypoint: join(process.cwd(), 'packages/compiler/test/fixtures/v06-modular-view/application.ts'),
      compositionName: 'modularViewApplication',
      outDir,
      runtimeVersionRange: '^0.6.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
    });
    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;
    const gateway = result.value.artifacts.reactiveArtifacts.find((artifact) => artifact.kind === 'queryGateway');
    const source = await readFile(gateway?.sourcePath ?? '', 'utf8');
    expect(source).toContain('Card.owned');
    expect(source).toContain('ownerId');
    expect(source).not.toContain('handlerUnresolved');
  }, 120_000);

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
      { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', common: { relationships: [{ source: 'Card', name: 'set', target: 'sets', cardinality: 'one', integrity: 'foreign-key', fields: ['setId'], references: ['id'] }], operations: [{ name: 'rename', operation: 'custom', transport: 'command', publicId: 'cards.rename.v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { changed: { type: 'boolean' } }, required: ['changed'] }), authorization: 'application-defined' }] }, native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'model.set', kind: 'model', name: 'Set', stability: 'stable', native: { artifact: { name: 'sets' } }, runtime: { name: 'Set', tableName: 'sets', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'command.cards.rename.v1', kind: 'command', name: 'cards.rename.v1', stability: 'stable', contract: { name: 'cards.rename', version: 'v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { changed: { type: 'boolean' } }, required: ['changed'] }), errors: [] } },
      { id: 'command-handler.card-rename', kind: 'commandHandler', name: 'Card-cards.rename.v1', stability: 'stable', model: { nodeId: 'model.card' }, command: { nodeId: 'command.cards.rename.v1' }, key: { kind: 'function', source: '(input) => input.cardId' }, ordering: 'serial', missing: 'reject', transaction: { models: [{ nodeId: 'model.card' }], history: [], outbox: [] }, retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, retention: { replayWindowSeconds: 3600, auditWindowSeconds: 7200, publishedOutboxWindowSeconds: 3600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 }, effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: '() => ({ changed: true })', projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' } },
      { id: 'query.cards.list.v1', kind: 'query', name: 'cards.list', version: 'v1', stability: 'stable', input: schema({ type: 'object', properties: {}, required: [] }), output: schema({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }), reads: [{ model: { nodeId: 'model.card' }, relationship: 'set' }], authorization: 'application-defined', trustedContext: [], budgets: { timeoutMs: 1000, maxResultBytes: 10000, maxRows: 100 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped', database, authorizationSource: '({ principal }) => principal.id.length > 0', handlerSource: 'async () => []', handlerDependencies: { source: 'import { unusedAuthoringApp } from "./authoring-only";', resolveDir: process.cwd() } },
      { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' },
      { id: 'subscription.card-events', kind: 'subscription', name: 'card-events', stability: 'stable', source: { nodeId: 'stream.cards.changed.v1' }, delivery: 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: '({ principal }) => principal.id === "generated-stream-subscription-proof"', retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 250, maxDelayMs: 30000 }, suspension: 'bounded-failures' },
      { id: 'gateway.public', kind: 'gateway', name: 'public', stability: 'stable', queries: [{ nodeId: 'query.cards.list.v1' }], commands: [{ command: { nodeId: 'command.cards.rename.v1' }, handler: { nodeId: 'command-handler.card-rename' } }], subscriptions: [{ nodeId: 'subscription.card-events' }], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: { perPrincipal: 10, total: 100 }, routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation', materialization: 'generatedDeployment', authenticationSource: 'async () => ({ principal: { id: "test" }, trustedContext: {}, authorizationVersion: "v1" })', identityReadinessSource: 'async () => undefined', authorizationReadinessSource: 'async () => undefined', commandAuthorizationSource: '({ command }) => command === Card.rename.operation.id', commandAuthorizationDependencies: { source: 'import { Card } from "./authoring-only";', resolveDir: process.cwd() }, cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: 'catalog', key: 'secret' }, deployment: { namespace: 'catalog', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: 2, port: 8080 } },
    ] as unknown as ApplicationGraphNode[]);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-reactive-gateway-'));
    const [artifact] = await emitGeneratedApplicationReactive({ graph, outDir, entrypoint: import.meta.filename });
    expect(artifact).toMatchObject({ kind: 'queryGateway', name: 'reactive-test-public' });
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual(['Deployment', 'NetworkPolicy', 'Service', 'PodDisruptionBudget']);
    expect(artifact?.container).toMatchObject({
      image: expect.stringMatching(/^applik8s\/reactive-test-query-gateway-reactive-test-public:sha-[0-9a-f]{64}$/),
      baseImage: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
      entrypoint: '/app/runtime.mjs',
    });
    const deployment = artifact?.resources.find((resource) => resource.kind === 'Deployment');
    expect(deployment).toMatchObject({ spec: { strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } }, template: { spec: { containers: [expect.objectContaining({ image: artifact?.container.image })] } } } });
    expect(JSON.stringify(deployment)).not.toContain('configMap');
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    const generatedSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'gateway.generated.ts'), 'utf8');
    expect(source).toContain('APPLIK8S_CURSOR_SECRET');
    expect(source).toContain('applik8s.dev/principal');
    expect(source).toContain('applik8s.dev/authorization-version');
    expect(source).toContain('applik8s.command/v1alpha1');
    expect(source).toContain('generated-stream-subscription-proof');
    expect(source).toContain('applik8s.stream/v1alpha1');
    expect(generatedSource).toContain('async function admitRequest(request)');
    expect(generatedSource).toContain('async function admitQuery(request, query, input)');
    expect(generatedSource).toContain('authenticate: admitRequest');
    expect(generatedSource).toContain('verifyIdentityReadiness()');
    expect(generatedSource).toContain('verifyAuthorizationReadiness()');
    expect(generatedSource).toContain("from './identity-readiness.generated.js'");
    expect(generatedSource).not.toContain('authenticate: admit,');
    const commandAuthorizationSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'command-authorization.generated.ts'), 'utf8');
    expect(commandAuthorizationSource).toContain('"cards.rename.v1"');
    expect(commandAuthorizationSource).not.toContain('authoring-only');
    const queryCallbackSources = await Promise.all((await readdir(dirname(artifact?.sourcePath ?? ''), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.startsWith('run-')).map((entry) => readFile(join(dirname(artifact?.sourcePath ?? ''), entry.name), 'utf8')));
    expect(queryCallbackSources.join('\n')).not.toContain('authoring-only');
    expect(source).toMatch(/reads:\[\{\$model:\{name:"Card"\}\},\{\$model:\{name:"Set"\}\}\]/);
    expect(artifact?.sizeBytes).toBeLessThan(550_000);
  });

  it('executes mixed relational and Kubernetes queries in their bounded gateway with provider-aware multiplexing and least-privilege RBAC', async () => {
    const gatewayDatabase = { ...database, secretNamespace: '${schema.spec.namespace}' } as const;
    const card = {
      id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', native: { artifact: { name: 'cards' } },
      runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: '${schema.spec.namespace}', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } },
    } as const;
    const cardQuery = {
      id: 'query.Card.list', kind: 'query', name: 'Card.list', publicId: 'Card.list', version: 'v1', stability: 'stable',
      input: schema({ type: 'object', properties: {}, required: [] }),
      output: schema({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }),
      reads: [{ model: { nodeId: card.id } }], authorization: 'application-defined', trustedContext: [],
      budgets: { timeoutMs: 2_000, maxResultBytes: 16_000, maxRows: 10 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped',
      database: gatewayDatabase, authorizationSource: '() => true', handlerSource: 'async () => []',
    } as const;
    const policy = {
      id: 'crd.moderation-policy', kind: 'crd', name: 'ModerationPolicy', stability: 'stable',
      resource: { apiVersion: 'chirp.example/v1alpha1', kind: 'ModerationPolicy', plural: 'moderationpolicies', scope: 'Namespaced' },
    } as const;
    const query = {
      id: 'query.ModerationPolicy.current', kind: 'query', name: 'ModerationPolicy.current', publicId: 'ModerationPolicy.current', version: 'v1', stability: 'stable',
      input: schema({ type: 'object', properties: {}, required: [] }),
      output: schema({ type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, maxRisk: { type: 'number' } }, required: ['name', 'maxRisk'] } }),
      reads: [{ model: { nodeId: policy.id } }], authorization: 'application-defined', trustedContext: [],
      budgets: { timeoutMs: 2_000, maxResultBytes: 16_000, maxRows: 1 }, snapshotResume: 'atomicSnapshotResume', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped',
      authorizationSource: '({ principal }) => principal.claims?.role === "moderator"',
      handlerSource: '() => { throw new Error("Kubernetes queries use their declarative authority."); }',
      kubernetes: {
        kind: 'kubernetes-list-watch', model: { nodeId: policy.id }, resource: policy.resource,
        namespace: '${schema.spec.namespace}', fieldSelector: { source: '() => "metadata.name=default"' },
        project: { source: '({ value }) => ({ name: value.metadata.name, maxRisk: value.spec.maxRisk })' },
        limit: { source: '() => 1' }, pageSize: 10, maxPages: 2, maxItems: 10,
      },
    } as const;
    const gateway = {
      id: 'gateway.administration', kind: 'gateway', name: 'administration', stability: 'stable',
      queries: [{ nodeId: cardQuery.id }, { nodeId: query.id }], commands: [], subscriptions: [], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden',
      subscriptionLimits: { perPrincipal: 10, total: 100 },
      routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' },
      resume: 'resumableInvalidation', materialization: 'generatedDeployment',
      authenticationSource: 'async () => ({ principal: { id: "moderator", claims: { role: "moderator" } }, trustedContext: {}, authorizationVersion: "v1" })',
      cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: '${schema.spec.namespace}', key: 'secret' },
      deployment: { namespace: '${schema.spec.namespace}', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: 1, port: 8080 },
    } as const;
    const [artifact] = await emitGeneratedApplicationReactive({
      graph: reactiveGraph([card, cardQuery, policy, query, gateway] as unknown as ApplicationGraphNode[]),
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-kubernetes-query-gateway-')),
      entrypoint: import.meta.filename,
    });

    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    const generatedSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'gateway.generated.ts'), 'utf8');
    expect(source).toContain('Applik8s Kubernetes gateway is stopping.');
    expect(source).toContain('metadata.name=default');
    expect(source).toContain('/__applik8s/v1');
    expect(source).toContain('APPLIK8S_KUBERNETES_QUERY_');
    expect(source).toContain('allowedNamespaces');
    expect(source).toContain('applik8s.task-query/v1alpha1');
    expect(generatedSource).toContain('proxyApplicationQueryMultiplex');
    expect(generatedSource).toContain('relationalQueryIds');
    expect(generatedSource).toContain('kubernetesQueryIds');
    expect(source).toContain('Mixed query multiplex upstream failed');
    expect(source).not.toContain('Kubernetes queries use their declarative authority.');
    expect(artifact?.resources.map((resource) => resource.kind)).toEqual([
      'ServiceAccount', 'Deployment', 'NetworkPolicy', 'Role', 'RoleBinding', 'Service',
    ]);
    expect(artifact?.resources.find((resource) => resource.kind === 'Role')).toMatchObject({
      metadata: { namespace: '${schema.spec.namespace}' },
      rules: [{ apiGroups: ['chirp.example'], resources: ['moderationpolicies'], verbs: ['get', 'list', 'watch'] }],
    });
    expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: { template: { spec: {
        serviceAccountName: 'reactive-test-administration',
        containers: [expect.objectContaining({ env: expect.arrayContaining([
          { name: 'APPLIK8S_NAMESPACE', value: '${schema.spec.namespace}' },
          expect.objectContaining({ name: expect.stringMatching(/^APPLIK8S_KUBERNETES_QUERY_/), value: '${schema.spec.namespace}' }),
        ]) })],
      } } },
    });
  }, 120_000);

  it('hydrates admitted context only inside generated server-side stream processors', async () => {
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
		const workflowProvider = { id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable', interface: 'WorkflowEngine', implementation: 'hatchet', config: { namespace: 'catalog', provision: false, workerTokenSecret: { name: 'hatchet-worker', namespace: 'catalog' }, hostPort: 'hatchet.catalog.svc:7070', apiUrl: 'http://hatchet.catalog.svc:8080', tls: false } } as const;
		const inspectTask = { id: 'task.cards.inspect.v1', kind: 'task', name: 'cards.inspect.v1', stability: 'stable', contract: { name: 'cards.inspect', version: 'v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { accepted: { type: 'boolean' } }, required: ['accepted'] }), errors: [] } } as const;
    const processor = {
      id: 'streamProcessor.card-timeline', kind: 'streamProcessor', name: 'card-timeline', stability: 'stable',
      enabled: false,
      source: { nodeId: stream.id }, database, delivery: 'at-least-once', checkpoint: 'postgres', idempotency: 'source-event-id', failure: 'pause',
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 25, maxDelayMs: 1_000, factor: 2 },
      budgets: { timeoutMs: 2_000, maxInputBytes: 64_000 },
      deployment: { replicas: 1, concurrency: 2, maxAckPending: 16, resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } }, disruption: { disabled: true } },
			tasks: [{ alias: 'inspect', target: { nodeId: inspectTask.id }, contract: inspectTask.contract }],
			workflowEngine: { interface: 'WorkflowEngine', nodeId: workflowProvider.id },
			handlerSource: 'async (payload, context) => { if (context.principal?.id && context.trustedContext.tenantId) await context.tasks.inspect({ cardId: payload.cardId }); }',
    } as const;
    const auditProcessor = { ...processor, id: 'streamProcessor.card-audit', name: 'card-audit' } as const;
    const artifacts = await emitGeneratedApplicationReactive({
			graph: reactiveGraph([workflowProvider, inspectTask, stream, processor, auditProcessor] as unknown as ApplicationGraphNode[]),
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-reactive-processor-context-')),
      entrypoint: import.meta.filename,
    });
    const artifact = artifacts.find((entry) => entry.name === 'reactive-test-card-timeline');

    expect(artifact).toMatchObject({ kind: 'streamProcessorWorker', name: 'reactive-test-card-timeline' });
    expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      metadata: { annotations: { 'applik8s.dev/include-when': 'false' } },
      spec: { strategy: { type: 'Recreate' } },
    });
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
		const generatedSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'), 'utf8');
    expect(source).toContain('must be an integer between');
    expect(source).toMatch(/includeTrustedContext:(?:true|!0)/);
    expect(source).toContain('.trustedContext.tenantId');
    expect(source).toContain('.principal?.id');
		expect(generatedSource).toContain('workflowRuntime.run');
		expect(generatedSource).toContain('context.idempotencyKey');
		expect(generatedSource).toContain('causationId: context.event.id');
		expect(generatedSource).toContain('signal: context.signal');
		expect(generatedSource).toContain('timeoutMs: 2000');
		expect(generatedSource).not.toContain('result?.signal');
		expect(generatedSource).not.toContain('metadata?.causationId');
		expect(source).toContain('tasks.inspect');
		expect(generatedSource).toContain("return validateWorkflowValue");
		expect(generatedSource).toContain("output, name, 'output'");
		expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({ spec: { template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
			{ name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'hatchet-worker', key: 'HATCHET_CLIENT_TOKEN' } } },
			{ name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' },
		]), volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }] })], volumes: [{
			name: 'workflow-token',
			secret: { secretName: 'hatchet-worker', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] },
		}] } } } });
    const consolidated = consolidateGeneratedApplicationReactiveResources({
      graphName: 'reactive-test',
      artifacts,
    });
    const consolidatedDeployment = consolidated.find((resource) => resource.kind === 'Deployment');
    expect(consolidatedDeployment).toMatchObject({
      metadata: { annotations: { 'applik8s.dev/include-when': 'false' } },
      spec: {
        template: {
          metadata: {
            annotations: {
              'applik8s.dev/workload-members': 'reactive-test-card-audit,reactive-test-card-timeline',
            },
          },
          spec: {
						containers: [
							expect.objectContaining({
								env: expect.arrayContaining([{ name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' }]),
								volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }],
							}),
							expect.objectContaining({
								env: expect.arrayContaining([{ name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' }]),
								volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }],
							}),
						],
						volumes: [{
							name: 'workflow-token',
							secret: { secretName: 'hatchet-worker', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] },
						}],
					},
        },
      },
    });
    expect(JSON.stringify((consolidatedDeployment?.spec?.template as { readonly metadata?: unknown } | undefined)?.metadata))
      .not.toContain('applik8s.dev/include-when');
  });

  it('bundles a durable PostgreSQL-to-ClickHouse projection and fails closed on unresolved callbacks', async () => {
    const provider = { id: 'provider.projection-store', kind: 'provider', name: 'ProjectionStore', stability: 'stable', interface: 'ProjectionStore', implementation: 'clickhouse', contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'ProjectionStore', version: 'v1alpha1', requirements: [], guarantees: [], implementation: { name: 'clickhouse' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }, config: { namespace: 'catalog', endpoint: 'http://clickhouse.catalog.svc:8123', database: 'analytics' } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => { throw new Error("projection-stream-authorization-proof"); }' } as const;
    const projection = { id: 'projection.cards', kind: 'projection', name: 'cards', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'ProjectionStore', nodeId: provider.id }, rebuildable: true, checkpoint: 'idempotent', output: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload' } as const;
    const summaryProjection = { ...projection, id: 'projection.card-summaries', name: 'card-summaries' } as const;
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-reactive-projection-'));
    const artifacts = await emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, projection, summaryProjection] as unknown as ApplicationGraphNode[]), outDir, entrypoint: import.meta.filename });
    const artifact = artifacts.find((entry) => entry.name === 'reactive-test-cards');
    expect(artifact).toMatchObject({ kind: 'projectionWorker', name: 'reactive-test-cards' });
    expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({ spec: { strategy: { type: 'Recreate' } } });
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_HEALTH_PORT');
    expect(source).toContain('APPLIK8S_PROJECTION_RETENTION_GAP');
    expect(source).toContain('APPLIK8S_CLICKHOUSE_DATABASE');
    expect(JSON.stringify(artifact?.resources)).toContain('"name":"APPLIK8S_CLICKHOUSE_DATABASE","value":"analytics"');
    expect(source).toContain('applik8s:projection:cards');
    expect(source).toContain('internalConsumer');
    expect(source).not.toContain('projection-stream-authorization-proof');
    const consolidated = consolidateGeneratedApplicationReactiveResources({
      graphName: 'reactive-test',
      artifacts,
    });
    const deployments = consolidated.filter((resource) => resource.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({
      metadata: {
        labels: { 'app.kubernetes.io/component': 'reactive-worker' },
      },
      spec: {
        strategy: { type: 'Recreate' },
      },
    });
    const consolidatedContainers = ((deployments[0]?.spec?.template as { readonly spec?: { readonly containers?: readonly unknown[] } } | undefined)?.spec?.containers ?? []);
    expect(consolidatedContainers).toEqual([
      expect.objectContaining({
        name: 'reactive-test-card-summaries',
        env: expect.arrayContaining([{ name: 'APPLIK8S_HEALTH_PORT', value: '8080' }]),
        readinessProbe: { httpGet: { path: '/ready', port: 'health-0' }, periodSeconds: 5, failureThreshold: 6 },
      }),
      expect.objectContaining({
        name: 'reactive-test-cards',
        env: expect.arrayContaining([{ name: 'APPLIK8S_HEALTH_PORT', value: '8081' }]),
        readinessProbe: { httpGet: { path: '/ready', port: 'health-1' }, periodSeconds: 5, failureThreshold: 6 },
      }),
    ]);
    expect(consolidated.filter((resource) => resource.kind === 'NetworkPolicy')).toHaveLength(1);
    expect(JSON.stringify(consolidated)).toContain('"port":8080');
    expect(JSON.stringify(consolidated)).toContain('"port":8081');
    await expect(emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, { ...projection, handlerUnresolved: ['localHelper'] }] as unknown as ApplicationGraphNode[]), outDir: join(outDir, 'invalid'), entrypoint: import.meta.filename })).rejects.toThrow(/unresolved local identifier/);
  });

  it('bundles a generation-scoped PostgreSQL-to-Valkey online projection with no executable ConfigMap', async () => {
    const provider = { id: 'provider.index-store', kind: 'provider', name: 'IndexStore', stability: 'stable', interface: 'IndexStore', implementation: 'valkey', config: { bindingKind: 'provided', provider: 'valkey', indexStore: { kind: 'valkey', name: 'catalog-index', namespace: 'catalog', host: 'valkey.catalog.svc', port: 6379, provision: false } } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
    const projection = {
      id: 'projection.card-timeline', kind: 'projection', name: 'card-timeline', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'IndexStore', nodeId: provider.id }, storage: 'online', rebuildable: true, checkpoint: 'idempotent',
      output: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload',
      online: { generationScoped: true, retention: { maxItemsPerPartition: 100, maxPartitions: 1_000, maxAgeSeconds: 3600 }, scoreUnit: 'epochMilliseconds', rebuild: { checkpoint: 'durable' }, partitionSource: '(row) => "viewer-1"', keySource: '(row) => row.cardId', scoreSource: '(row) => row.score', valueSource: '(row) => row', removeSource: '() => false' },
    } as const;
    const [artifact] = await emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, projection] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-online-projection-')), entrypoint: import.meta.filename });
    expect(artifact).toMatchObject({ kind: 'projectionWorker', name: 'reactive-test-card-timeline' });
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_VALKEY_HOST');
    expect(source).toContain('APPLIK8S_VALKEY_PORT');
    const serializedResources = JSON.stringify(artifact?.resources);
    expect(serializedResources).toContain('valkey.catalog.svc');
    expect(serializedResources).toContain('APPLIK8S_VALKEY_PORT');
    expect(serializedResources).toContain('"value":"6379"');
    expect(source).toContain('maxItemsPerPartition');
    expect(source).toContain('active-generation');
    expect(source).toContain("redis.call('ZADD'");
    expect(JSON.stringify(artifact?.resources)).not.toContain('ConfigMap');
    await expect(emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, stream, { ...projection, online: { ...projection.online, keyUnresolved: ['localKey'] } }] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-invalid-online-projection-')), entrypoint: import.meta.filename })).rejects.toThrow(/key callback.*unresolved/);
  });

  it('injects an online projection behind the ordinary query snapshot/SSE protocol', async () => {
    const provider = { id: 'provider.index-store', kind: 'provider', name: 'IndexStore', stability: 'stable', interface: 'IndexStore', implementation: 'valkey', config: { indexStore: { kind: 'valkey', name: 'catalog-index', namespace: 'catalog', host: 'valkey.catalog.svc', port: 6379, authentication: { mode: 'password', secret: { name: 'catalog-valkey', namespace: 'catalog' }, key: 'password' } } } } as const;
    const model = { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
    const projection = {
      id: 'projection.card-timeline', kind: 'projection', name: 'card-timeline', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'IndexStore', nodeId: provider.id }, storage: 'online', rebuildable: true, checkpoint: 'idempotent',
      output: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload',
      online: { generationScoped: true, retention: { maxItemsPerPartition: 100, maxPartitions: 1_000 }, scoreUnit: 'arbitrary', rebuild: { checkpoint: 'durable' }, partitionSource: '() => "viewer-1"', keySource: '(row) => row.cardId', scoreSource: '(row) => row.score', valueSource: '(row) => ({ cardId: row.cardId })' },
    } as const;
    const query = { id: 'query.cards.timeline.v1', kind: 'query', name: 'cards.timeline', version: 'v1', stability: 'stable', input: schema({ type: 'object', properties: {}, required: [] }), output: schema({ type: 'array', items: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] } }), reads: [{ model: { nodeId: model.id } }], authorization: 'application-defined', trustedContext: [], budgets: { timeoutMs: 1000, maxResultBytes: 10000, maxRows: 100 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped', database, projection: { nodeId: projection.id, storage: 'online' }, authorizationSource: '() => true', handlerSource: 'async ({ source }) => (await source.page({ partition: "viewer-1", limit: 20 })).items' } as const;
    const gateway = { id: 'gateway.public', kind: 'gateway', name: 'public', stability: 'stable', queries: [{ nodeId: query.id }], commands: [], subscriptions: [], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: { perPrincipal: 10, total: 100 }, routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation', materialization: 'generatedDeployment', authenticationSource: 'async () => ({ principal: { id: "test" }, trustedContext: {}, authorizationVersion: "v1" })', cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: 'catalog', key: 'secret' }, deployment: { namespace: 'catalog', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: 1, port: 8080 } } as const;
    const artifacts = await emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, model, stream, projection, query, gateway] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-online-query-')), entrypoint: import.meta.filename });
    const generatedGateway = artifacts.find((artifact) => artifact.kind === 'queryGateway');
    const source = await readFile(generatedGateway?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_VALKEY_HOST_');
    expect(source).toContain('APPLIK8S_VALKEY_PORT_');
    expect(source).toContain('sourceRuntime');
    expect(source).toContain('active-generation');
    expect(source).toContain('.revision()');
    expect(source).toContain('APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE');
    expect(source).toContain('degradedDependencyError');
    const deployment = generatedGateway?.resources.find((resource) => resource.kind === 'Deployment');
    const serializedDeployment = JSON.stringify(deployment);
    expect(serializedDeployment).toContain('valkey.catalog.svc');
    expect(serializedDeployment).toContain('catalog-valkey');
    expect(serializedDeployment).toContain('APPLIK8S_VALKEY_PORT_');
    expect(serializedDeployment).toContain('"value":"6379"');
    expect(serializedDeployment).toContain('APPLIK8S_VALKEY_PASSWORD_');
    expect(serializedDeployment).not.toContain('"optional":true');

    const dynamicProvider = {
      ...provider,
      config: {
        indexStore: {
          ...provider.config.indexStore,
          port: '${schema.spec.providers.index.port}',
          authentication: {
            ...provider.config.indexStore.authentication,
            mode: '${schema.spec.providers.index.authMode}',
          },
        },
      },
    } as const;
    const dynamicArtifacts = await emitGeneratedApplicationReactive({ graph: reactiveGraph([dynamicProvider, model, stream, projection, query, gateway] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-dynamic-online-query-')), entrypoint: import.meta.filename });
    const dynamicDeployment = dynamicArtifacts.find((artifact) => artifact.kind === 'queryGateway')?.resources.find((resource) => resource.kind === 'Deployment');
    const serializedDynamicDeployment = JSON.stringify(dynamicDeployment);
    expect(serializedDynamicDeployment).toContain('${string(schema.spec.providers.index.port)}');
    expect(serializedDynamicDeployment).toContain('"optional":true');
  });

  it('injects a bounded analytical projection behind the same query snapshot/SSE protocol', async () => {
    const provider = { id: 'provider.projection-store', kind: 'provider', name: 'ProjectionStore', stability: 'stable', interface: 'ProjectionStore', implementation: 'clickhouse', config: { name: 'catalog-analytics', namespace: 'catalog', database: 'analytics', enabled: false, credentialsSecret: { name: 'catalog-clickhouse', namespace: 'catalog' } } } as const;
    const model = { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
    const projection = { id: 'projection.card-analytics', kind: 'projection', name: 'card-analytics', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'ProjectionStore', nodeId: provider.id }, storage: 'analytical', rebuildable: true, checkpoint: 'idempotent', output: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload' } as const;
    const query = { id: 'query.cards.trending.v1', kind: 'query', name: 'cards.trending', version: 'v1', stability: 'stable', input: schema({ type: 'object', properties: {}, required: [] }), output: schema({ type: 'array', items: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] } }), reads: [{ model: { nodeId: model.id } }], authorization: 'application-defined', trustedContext: [], budgets: { timeoutMs: 1000, maxResultBytes: 10000, maxRows: 100 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped', database, projection: { nodeId: projection.id, storage: 'analytical' }, authorizationSource: '() => true', handlerSource: 'async ({ source }) => (await source.aggregate({ dimensions: ["cardId"], measures: { score: { operation: "sum", field: "score" } }, orderBy: [{ field: "score", direction: "desc" }], limit: 20 })).items' } as const;
    const gateway = { id: 'gateway.public', kind: 'gateway', name: 'public', stability: 'stable', queries: [{ nodeId: query.id }], commands: [], subscriptions: [], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: { perPrincipal: 10, total: 100 }, routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation', materialization: 'generatedDeployment', authenticationSource: 'async () => ({ principal: { id: "test" }, trustedContext: {}, authorizationVersion: "v1" })', cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: 'catalog', key: 'secret' }, deployment: { namespace: 'catalog', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: 1, port: 8080 } } as const;
    const artifacts = await emitGeneratedApplicationReactive({ graph: reactiveGraph([provider, model, stream, projection, query, gateway] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-analytical-query-')), entrypoint: import.meta.filename });
    const generatedGateway = artifacts.find((artifact) => artifact.kind === 'queryGateway');
    const source = await readFile(generatedGateway?.sourcePath ?? '', 'utf8');
    expect(source).toContain('APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED');
    expect(source).toContain('sourceRuntime');
    expect(source).toContain('card_analytics');
    expect(source).toContain('.aggregate');
    const deployment = generatedGateway?.resources.find((resource) => resource.kind === 'Deployment');
    expect(deployment).toBeDefined();
    const serialized = JSON.stringify(deployment);
    expect(serialized).toContain('clickhouse-catalog-analytics.catalog.svc');
    expect(serialized).toContain('catalog-clickhouse');
    expect(serialized).toContain('APPLIK8S_CLICKHOUSE_DATABASE_');
    expect(serialized).toContain('"value":"analytics"');
    expect(serialized).toContain('"value":"false"');

    const selectedProvider = { ...provider, config: { ...provider.config, database: '${schema.spec.providers.analytics.database}' } } as const;
    const selectedArtifacts = await emitGeneratedApplicationReactive({ graph: reactiveGraph([selectedProvider, model, stream, projection, query, gateway] as unknown as ApplicationGraphNode[]), outDir: await mkdtemp(join(tmpdir(), 'applik8s-selected-analytical-query-')), entrypoint: import.meta.filename });
    const selectedDeployment = selectedArtifacts.find((artifact) => artifact.kind === 'queryGateway')?.resources.find((resource) => resource.kind === 'Deployment');
    expect(JSON.stringify(selectedDeployment)).toContain('"value":"${schema.spec.providers.analytics.database}"');
  });
});

function schema(jsonSchema: JsonObject) { return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema }; }
function reactiveGraph(nodes: readonly ApplicationGraphNode[]): ApplicationGraph { return { apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'reactive-test', namespace: 'catalog' }, nodes, edges: [], providerRequirements: [], providerBindings: [], compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] } }; }
