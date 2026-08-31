// typecast-file-boundary: graph fixtures use closed literals and deliberate negative shapes to test compiler lowering.
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { app, applicationGraphFor, EventLog, event, IdentityProvider, Observability } from '@applik8s/applik8s';
import { bindApplicationCallableDependencies } from '@applik8s/applik8s/internal/provider-runtime';
import type { ApplicationGraph, ApplicationGraphNode, JsonObject } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationProcessors } from '../src/application-processors/index.js';
import {
  consolidateGeneratedApplicationReactiveResources,
  emitGeneratedApplicationReactive,
  kubernetesContainerName,
} from '../src/application-reactive/index.js';
import {
  compileTypeKroComposition,
  discoverApplicationGraph,
} from '../src/pipeline/index.js';

const database = { name: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog' } as const;
// Preserving authored callback names and the canonical operation-authority
// boundary are part of the function-native runtime contract. The bounded
// overhead keeps identity inference and revocable authorization correct after
// minification without relaxing the generated-runtime budget materially.
// v0.8 reserves at most 10 KiB over the previous 570 KiB ceiling for the
// canonical signed-envelope reader/writer and bounded legacy decoder. Keep in
// sync with benchmarks/v0.8/budgets.json.
// Runtime Integrity adds one shared dual-reader substrate for the public query,
// command, stream, search, object-intent, and canonical internal-operation
// protocols. benchmarks/v0.8/budgets.json fixes a 580 KB gateway budget plus at
// most 10 KB of Runtime Integrity overhead while Release-A compatibility readers
// remain present. OB-1 reserves a separate 10 KB for capturing the canonical
// telemetry carrier at durable command issuance; later release phases must lower
// these bounded compatibility costs rather than increasing either allowance.
// Includes the v0.8 provider-operation access declaration carried by the
// maintained notifications package. Keep the ceiling narrow enough that a
// dependency-graph regression remains visible.
// Includes the payload-free Runtime Integrity observer used by cursor-owning
// gateways; keep the ceiling tight enough to catch accidental authoring-graph
// or provider-runtime capture.
// Includes bounded query and signal SSE lease/reconnect support. Keep this close
// to the measured release candidate so future runtime growth remains explicit.
// v0.9's unified execution admission and schedule authority raised the measured
// gateway baseline to 623,149 bytes before the event-catalog work. Reserve less
// than 3 KiB above that baseline; catalog-only SQL must remain opt-in and must
// not consume this ordinary-gateway ceiling.
const reactiveRuntimeBundleBudgetBytes = 626_000;

describe('generated v0.6 reactive workloads', () => {
  it('preserves every physical source policy in generated public event-catalog subscriptions', async () => {
    const application = app('catalog-source-authority', {
      namespace: 'catalog-source-authority',
    });
    application.provide(
      IdentityProvider,
      IdentityProvider.deterministic({
        mode: 'starter',
        application: 'catalog-source-authority',
        subject: 'reader',
        audience: ['catalog-source-authority'],
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
      }),
    );
    const database = application.database.postgres('catalog', { schema: {} });
    const Visible = event('catalog.visible.v1', {
      payload: type({ id: 'string' }),
    });
    const Restricted = event('catalog.restricted.v1', {
      payload: type({ id: 'string' }),
    });
    application.stream(Visible, {
      database,
      retention: { maxAgeSeconds: 3_600 },
      partitionBy: ({ id }) => id,
      authorize: ({ principal }) => principal.id === 'catalog-visible-reader',
    });
    application.stream(Restricted, {
      database,
      retention: { maxAgeSeconds: 3_600 },
      partitionBy: ({ id }) => id,
      authorize: ({ principal }) => principal.id === 'catalog-restricted-reader',
    });
    const subscription = application.events
      .of(Visible, Restricted)
      .subscribe('catalog-facts', {
        authorize: ({ principal }) => principal.id === 'catalog-subscriber',
      });
    application.gateway('public', {
      subscriptions: [subscription],
      deployment: {
        namespace: 'catalog-source-authority',
        cursorSecret: { name: 'catalog-cursor', key: 'secret' },
      },
    });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected application graph.');
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-catalog-authority-'));
    const artifacts = await emitGeneratedApplicationReactive({
      graph,
      outDir,
      entrypoint: import.meta.filename,
    });
    const gateway = artifacts.find((artifact) => artifact.kind === 'queryGateway');
    const directory = dirname(gateway?.sourcePath ?? '');
    const generated = await readFile(join(directory, 'gateway.generated.ts'), 'utf8');
    const callbacks = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.startsWith('catalog-source-authorize-'))
        .map((name) => readFile(join(directory, name), 'utf8')),
    );
    expect(callbacks).toHaveLength(2);
    expect(callbacks.join('\n')).toContain('catalog-visible-reader');
    expect(callbacks.join('\n')).toContain('catalog-restricted-reader');
    expect(generated).toContain('catalogSourceAuthorize');
    expect(generated).toContain('createPostgresApplicationCatalogStream');
  }, 120_000);

  it('emits collision-safe variables for inferred dotted outbox model operations', async () => {
    const parents = pgTable('compiler_outbox_parents', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const children = pgTable('compiler_outbox_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('dotted-outbox-binding', { namespace: 'tests' });
    application.provide(EventLog, {
      kind: 'nats-jetstream',
      name: 'events',
      namespace: 'tests',
    });
    application.provide(Observability, Observability.local());
    const Database = application.database.postgres('application', {
      schema: { parents, children },
    });
    const Parent = application.model(parents, {
      name: 'CompilerParent',
      database: Database,
    });
    const Child = application.model(children, {
      name: 'CompilerChild',
      database: Database,
    });
    Parent.create.beforeCommit(
      {
        history: true,
        __generatedCalls: [Child, Child.require, Child.create],
        __generatedModelBindings: {
          Child,
          'Child.require': Child.require,
          'Child.create': Child.create,
        },
      },
      async (parent, _input, context) => {
        await Child.require(parent.identity);
        context.send(Child.create, {
          id: context.id('child'),
          parentId: parent.identity,
          revision: context.id('child-revision'),
        }, { targetKey: parent.identity });
      },
    );
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Dotted outbox fixture produced no application graph.');
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-dotted-outbox-'));
    const artifacts = await emitGeneratedApplicationProcessors({
      graph,
      outDir,
      entrypoint: import.meta.filename,
    });
    const artifact = artifacts.find((candidate) =>
      candidate.name === 'compiler-parent-commands',
    );
    expect(artifact, 'CompilerParent processor artifact').toBeDefined();
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'processor.generated.ts'),
      'utf8',
    );

    expect(generated).not.toContain('const Child.createContract');
    expect(generated).toContain('async require(identity)');
    expect(generated).toContain('"Child": Object.freeze({ ...Child, "create": callbackBinding_');
    expect(generated).toMatch(/const callbackBinding_[a-f0-9]{12}Contract = /u);
    expect(generated).toMatch(/context\.send\(callbackBinding_[a-f0-9]{12}Contract,/u);
    expect(generated).toContain("from '@applik8s/runtime-nats/event-log'");
    expect(generated).not.toContain("from '@applik8s/runtime-aws/kinesis'");
    expect(generated).toContain('startApplicationOpenTelemetryRuntime');
    expect(generated).toContain('installApplicationTelemetryRuntimeResolver');
    expect(generated).toContain('service: process.env.APPLIK8S_SERVICE_NAME ?? "command-processor:CompilerParent-commands"');
    expect(generated).toContain('closeApplicationTelemetryRuntime()');

    const awsArtifacts = await emitGeneratedApplicationProcessors({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-dotted-outbox-aws-')),
      entrypoint: import.meta.filename,
      executionTarget: 'aws',
    });
    const awsArtifact = awsArtifacts.find((candidate) =>
      candidate.name === 'compiler-parent-commands',
    );
    const awsGenerated = await readFile(
      join(dirname(awsArtifact?.sourcePath ?? ''), 'processor.generated.ts'),
      'utf8',
    );
    expect(awsGenerated).toContain("from '@applik8s/runtime-aws/kinesis'");
    expect(awsGenerated).not.toContain("from '@applik8s/runtime-nats/event-log'");
    expect(awsGenerated).not.toContain("from '@applik8s/runtime-nats/command-processor'");
  }, 120_000);

  it('generates bounded collision-resistant container names for long workload identities', () => {
    const first = kubernetesContainerName(`agentic-product-${'document-projection-'.repeat(5)}primary`);
    const second = kubernetesContainerName(`agentic-product-${'document-projection-'.repeat(5)}secondary`);

    expect(first).toMatch(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(second.length).toBeLessThanOrEqual(63);
    expect(first).not.toBe(second);
  });

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
    const graph = await nativeQueryFixtureGraph();
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
    expect(artifact?.sizeBytes).toBeLessThan(reactiveRuntimeBundleBudgetBytes);
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
  }, 120_000);

  it('emits a frozen whole-batch processor runtime instead of event-by-event delivery', async () => {
    const graph = reactiveGraph([
      {
        id: 'stream.posts.published.v1',
        kind: 'stream',
        name: 'posts.published',
        version: 'v1',
        stability: 'stable',
        payload: schema({
          type: 'object',
          properties: { postId: { type: 'string' }, authorId: { type: 'string' } },
          required: ['postId', 'authorId'],
        }),
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 86_400 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: '(event) => event.authorId',
        authorizationSource: '() => true',
      },
      {
        id: 'streamProcessor.bulk-index-posts',
        kind: 'streamProcessor',
        name: 'bulk-index-posts',
        stability: 'stable',
        source: { nodeId: 'stream.posts.published.v1' },
        database,
        handlerSource: 'async function bulkIndexPosts(batch) { globalThis.__batch = batch.id; }',
        delivery: 'at-least-once',
        invocation: 'batch',
        idempotency: 'frozen-batch-id',
        batch: {
          maxItems: 500,
          maxBytes: 4 * 1_024 * 1_024,
          maxWaitMs: 1_000,
          ordering: 'partition',
          acknowledgement: 'wholeBatch',
          membership: 'durableFrozenManifest',
        },
        checkpoint: 'postgres',
        failure: 'pause',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 5,
          initialDelayMs: 100,
          maxDelayMs: 5_000,
          factor: 2,
        },
        deployment: {
          image: 'node:22-alpine',
          replicas: 1,
          concurrency: 8,
          maxAckPending: 4_000,
          healthPort: 8_080,
          gracefulShutdownSeconds: 30,
          resources: {},
          scaling: { mode: 'fixed' },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 4 * 1_024 * 1_024 },
      },
      {
        id: 'provider.observability',
        kind: 'provider',
        name: 'Observability',
        stability: 'stable',
        interface: 'Observability',
        implementation: 'local-otel',
      },
    ] as unknown as ApplicationGraphNode[]);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-batch-processor-'));
    const [artifact] = await emitGeneratedApplicationReactive({
      graph,
      outDir,
      entrypoint: import.meta.filename,
    });

    expect(artifact).toMatchObject({
      kind: 'streamProcessorWorker',
      name: 'reactive-test-bulk-index-posts',
    });
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('runApplicationStreamBatchProcessor');
    expect(generated).toContain('concurrency: processorConcurrency');
    expect(generated).toContain('maxItems: 500');
    expect(generated).toContain('maxBytes: 4194304');
    expect(generated).toContain('result.exhausted ? 1000 : 10');
    expect(generated).toContain('const createSource = () => createPostgresApplicationStream');
    expect(generated).toContain('await source.close().catch(() => undefined)');
    expect(generated).toContain('lastSuccessfulCycleAt');
    expect(generated).toContain('async function processorAdmission');
    expect(generated).toContain('async function processorAdmissionUnchecked');
    expect(generated).toContain('admit: processorAdmission');
    expect(generated).toContain('createApplicationAdmissionObservationV1');
    expect(generated).toContain('applicationAdmissionRejectionCodeV1');
    expect(generated).toContain("event: 'applik8s-processor-admission'");
    expect(generated).toContain('processorAdmissionObservationAt < 30_000');
    expect(generated).toContain("boundary: 'delivery'");
    expect(generated).toContain('startApplicationOpenTelemetryRuntime');
    expect(generated).toContain('installApplicationTelemetryRuntimeResolver');
    expect(generated).toContain('service: process.env.APPLIK8S_SERVICE_NAME ?? "stream-processor:bulk-index-posts"');
    expect(generated).toContain('closeApplicationTelemetryRuntime()');
    expect(generated).toContain("transport: 'broker'");
    expect(generated).not.toMatch(
      /applik8s-processor-admission[^\n]*(?:envelope|payload|principal|trustedContext|message)/u,
    );
    expect(generated).toContain("transport: 'broker'");
    expect(generated).toContain(
      'processorOperationAuthority.admitExecutionPrincipal',
    );
    expect(generated).toContain(
      'Object.freeze({ id: workloadIdentity.id, identity: workloadIdentity, grantIds: Object.freeze([]) })',
    );
    expect(generated).toContain(
      'const trustedContextDigest = envelope.contextDigest ?? envelope.principal?.trustedContextDigest',
    );
    expect(generated).toContain('return Object.freeze({ ...context });');
    expect(generated).not.toContain("'batch:' + sourceId");
    expect(generated).not.toContain('runApplicationStreamProcessor({');
  });

  it('hydrates an extracted external provider operation from its portable runtime contract', async () => {
    const graph = reactiveGraph([
      {
        id: 'provider.acquisition-provider.v1alpha1.primary',
        kind: 'provider',
        name: 'AcquisitionProvider',
        stability: 'stable',
        interface: 'AcquisitionProvider',
        implementation: 'fixture',
        config: {
          callableRuntime: {
            kind: 'runtime',
            runtime: {
              env: { ACQUISITION_SOURCE: 'fixture' },
              secretEnv: {
                ACQUISITION_TOKEN: {
                  secret: {
                    apiVersion: 'v1',
                    kind: 'Secret',
                    name: 'acquisition-token',
                    namespace: 'catalog',
                  },
                  key: 'token',
                },
              },
            },
          },
        },
      },
      {
        id: 'stream.items.requested.v1',
        kind: 'stream',
        name: 'items.requested',
        version: 'v1',
        stability: 'stable',
        payload: schema({
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        }),
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 86_400 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: '(event) => event.id',
        authorizationSource: '() => true',
      },
      {
        id: 'streamProcessor.acquire-item',
        kind: 'streamProcessor',
        name: 'acquire-item',
        stability: 'stable',
        source: { nodeId: 'stream.items.requested.v1' },
        database,
        handlerSource: 'async event => acquire(event)',
        providerBindings: [{
          identifier: 'acquire',
          provider: {
            interface: 'AcquisitionProvider',
            nodeId: 'provider.acquisition-provider.v1alpha1.primary',
          },
          operation: {
            member: 'acquire',
            runtime: {
              module: '@applik8s/notifications/runtime',
              export: 'deliverApplicationNotification',
              access: {
                kind: 'provider',
                operations: ['connection.use', 'network.connect'],
              },
            },
          },
        }],
        delivery: 'at-least-once',
        invocation: 'event',
        idempotency: 'source-event-id',
        checkpoint: 'postgres',
        failure: 'deadLetter',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 5,
          initialDelayMs: 100,
          maxDelayMs: 5_000,
          factor: 2,
        },
        deployment: {
          image: 'node:22-alpine',
          replicas: 1,
          concurrency: 1,
          maxAckPending: 64,
          healthPort: 8_080,
          gracefulShutdownSeconds: 30,
          resources: {},
          scaling: { mode: 'fixed' },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
      },
    ] as unknown as ApplicationGraphNode[]);
    const [artifact] = await emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-callable-provider-')),
      entrypoint: import.meta.filename,
    });
    const directory = dirname(artifact?.sourcePath ?? '');
    const generated = await readFile(
      join(directory, 'stream-processor.generated.ts'),
      'utf8',
    );
    const callback = await readFile(
      join(directory, 'handle.generated.ts'),
      'utf8',
    );

    expect(generated).toMatch(
      /import \{ deliverApplicationNotification as providerOperation_[a-f0-9]{12} \} from "@applik8s\/notifications\/runtime";/u,
    );
    expect(generated).toMatch(
      /const functionNativeLeafBindings = Object\.freeze\(\{ "acquire": instrumentApplicationProviderOperation\(/u,
    );
    expect(generated).toContain('"interface":"AcquisitionProvider"');
    expect(generated).toContain('"member":"acquire"');
    expect(generated).toContain(
      'const invokeHandler = invokeAuthoredHandler;',
    );
    expect(callback).toContain(
      'const acquire = __applik8sBindings["acquire"]',
    );
    expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: {
        template: {
          spec: {
            containers: [expect.objectContaining({
              env: expect.arrayContaining([
                { name: 'ACQUISITION_SOURCE', value: 'fixture' },
                {
                  name: 'ACQUISITION_TOKEN',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'acquisition-token',
                      key: 'token',
                    },
                  },
                },
              ]),
            })],
          },
        },
      },
    });
  }, 120_000);

  it('emits pinned PostgreSQL catalog filtering and a pure where predicate', async () => {
    const source = {
      id: 'stream.posts.published.v1', kind: 'stream', name: 'posts.published', version: 'v1', stability: 'stable',
      payload: schema({ type: 'object', required: ['postId'], properties: { postId: { type: 'string' } } }),
      authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 86_400 },
      partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database,
      partitionSource: '(event) => event.postId', authorizationSource: '() => false',
    } as const;
    const selection = {
      ...source,
      id: 'stream.catalog.posts.v1', name: 'catalog.posts',
      payload: schema({ type: 'object', required: ['id', 'contract', 'source', 'occurredAt', 'recordedAt', 'detail'], properties: {
        id: { type: 'string' }, contract: { type: 'object' }, source: { type: 'object' }, occurredAt: { type: 'string' }, recordedAt: { type: 'string' }, detail: { type: 'object' },
      } }),
      catalog: {
        revision: 'catalog-v1', selection: 'of', lowering: 'postgres-native-filter',
        sources: [{ stream: { nodeId: source.id }, contract: { id: 'posts.published.v1', name: 'posts.published', version: 'v1' }, producer: { kind: 'event', id: 'posts.published.v1' } }],
        predicateSource: '(event) => event.contract.id === "posts.published.v1"',
      },
    } as const;
    const processor = {
      id: 'streamProcessor.audit-catalog', kind: 'streamProcessor', name: 'audit-catalog', stability: 'stable', source: { nodeId: selection.id }, database,
      handlerSource: 'async function auditCatalog(event) { globalThis.__catalogEvent = event.contract.id; }', delivery: 'at-least-once', invocation: 'event', idempotency: 'source-event-id', checkpoint: 'postgres', failure: 'pause',
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 5_000, factor: 2 },
      deployment: { image: 'node:22-alpine', replicas: 1, concurrency: 1, maxAckPending: 100, healthPort: 8_080, gracefulShutdownSeconds: 30, resources: {}, scaling: { mode: 'fixed' } },
      budgets: { timeoutMs: 30_000, maxInputBytes: 1_048_576 },
    } as const;
    const graph = reactiveGraph([source, selection, processor] as unknown as ApplicationGraphNode[]);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-event-catalog-'));
    const [artifact] = await emitGeneratedApplicationReactive({ graph, outDir, entrypoint: import.meta.filename });
    const generated = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'), 'utf8');

    expect(generated).toContain("from './catalog-predicate.generated.js'");
    expect(generated).toContain('createPostgresApplicationCatalogStream as createPostgresApplicationStream');
    expect(generated).toContain("revision: \"catalog-v1\"");
    expect(generated).toContain("id: \"posts.published.v1\"");
    expect(generated).toContain('predicate: catalogPredicate');
    expect(await readFile(join(dirname(artifact?.sourcePath ?? ''), 'catalog-predicate.generated.ts'), 'utf8')).toContain('posts.published.v1');
  }, 120_000);

  it('fails closed when a captured provider operation has no portable worker runtime', async () => {
    const graph = reactiveGraph([
      {
        id: 'provider.acquisition-provider.v1alpha1.primary',
        kind: 'provider',
        name: 'AcquisitionProvider',
        stability: 'stable',
        interface: 'AcquisitionProvider',
        implementation: 'fixture',
        config: {},
      },
      {
        id: 'stream.items.requested.v1',
        kind: 'stream',
        name: 'items.requested',
        version: 'v1',
        stability: 'stable',
        payload: schema({ type: 'object' }),
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 86_400 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: '() => "all"',
        authorizationSource: '() => true',
      },
      {
        id: 'streamProcessor.acquire-item',
        kind: 'streamProcessor',
        name: 'acquire-item',
        stability: 'stable',
        source: { nodeId: 'stream.items.requested.v1' },
        database,
        handlerSource: 'async event => acquisition.acquire(event)',
        providerBindings: [{
          identifier: 'acquisition.acquire',
          provider: {
            interface: 'AcquisitionProvider',
            nodeId: 'provider.acquisition-provider.v1alpha1.primary',
          },
          operation: { member: 'acquire' },
        }],
        delivery: 'at-least-once',
        invocation: 'event',
        idempotency: 'source-event-id',
        checkpoint: 'postgres',
        failure: 'pause',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 1,
          initialDelayMs: 100,
          maxDelayMs: 100,
          factor: 2,
        },
        deployment: {
          image: 'node:22-alpine',
          replicas: 1,
          concurrency: 1,
          maxAckPending: 1,
          healthPort: 8_080,
          gracefulShutdownSeconds: 30,
          resources: {},
          scaling: { mode: 'fixed' },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
      },
    ] as unknown as ApplicationGraphNode[]);

    await expect(
      emitGeneratedApplicationReactive({
        graph,
        outDir: await mkdtemp(join(tmpdir(), 'applik8s-callable-provider-missing-runtime-')),
        entrypoint: import.meta.filename,
      }),
    ).rejects.toThrow(/has no portable generated-worker runtime/);
  });

  it('hydrates an inferred object-store handle inside a managed stream processor', async () => {
    const graph = reactiveGraph([
      {
        id: 'provider.object-storage',
        kind: 'provider',
        name: 'ObjectStorage',
        stability: 'stable',
        interface: 'ObjectStorage',
        implementation: 's3',
        config: {
          objectStorage: {
            kind: 's3',
            bucket: 'catalog-objects',
            region: 'us-east-1',
            endpoint: 'http://objects.catalog.svc:8333',
            forcePathStyle: true,
            enabled: true,
            credentialsSecret: {
              name: 'catalog-objects',
              namespace: 'catalog',
            },
          },
        },
      },
      {
        id: 'objectStore.artifacts',
        kind: 'objectStore',
        name: 'artifacts',
        stability: 'stable',
        provider: {
          interface: 'ObjectStorage',
          nodeId: 'provider.object-storage',
        },
        objectMode: 'immutable',
        maxObjectBytes: 1_000,
        contentTypes: ['text/plain'],
        browserAccess: {
          upload: 'none',
          download: 'none',
          downloadAccess: 'owner',
          ttlSeconds: 300,
        },
        integrity: 'sha256',
        credentials: 'server-only',
        deletion: 'explicit',
      },
      {
        id: 'stream.documents.published.v1',
        kind: 'stream',
        name: 'documents.published',
        version: 'v1',
        stability: 'stable',
        payload: schema({
          type: 'object',
          properties: { documentId: { type: 'string' } },
          required: ['documentId'],
        }),
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 86_400 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: '(event) => event.documentId',
        authorizationSource: '() => false',
      },
      {
        id: 'streamProcessor.publish-document',
        kind: 'streamProcessor',
        name: 'publish-document',
        stability: 'stable',
        source: { nodeId: 'stream.documents.published.v1' },
        database,
        handlerSource: 'async event => ArtifactObjects.put({ key: event.documentId, body: "published", contentType: "text/plain" })',
        providerBindings: [{
          identifier: 'ArtifactObjects',
          provider: {
            interface: 'ObjectStorage',
            nodeId: 'provider.object-storage',
          },
          placement: 'objectStore',
          objectStore: { nodeId: 'objectStore.artifacts' },
        }],
        delivery: 'at-least-once',
        invocation: 'event',
        idempotency: 'source-event-id',
        checkpoint: 'postgres',
        failure: 'deadLetter',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 5,
          initialDelayMs: 100,
          maxDelayMs: 5_000,
          factor: 2,
        },
        deployment: {
          image: 'node:22-alpine',
          replicas: 1,
          concurrency: 1,
          maxAckPending: 64,
          healthPort: 8_080,
          gracefulShutdownSeconds: 30,
          resources: {},
          scaling: { mode: 'fixed' },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
      },
    ] as unknown as ApplicationGraphNode[]);
    const [artifact] = await emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-object-store-processor-')),
      entrypoint: import.meta.filename,
    });
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'),
      'utf8',
    );
    const resources = JSON.stringify(artifact?.resources);

    expect(generated).toContain('installApplicationObjectStorageRuntimeResolver');
    expect(generated).toContain('createS3ApplicationObjectStorageRuntime');
    expect(generated).toContain('"ArtifactObjects": createApplicationObjectStoreRuntimeHandle({"name":"artifacts"');
    expect(generated).toContain('objectStorageRuntimes.get(binding.name)');
    expect(resources).toContain('APPLIK8S_OBJECT_STORAGE_BUCKET');
    expect(resources).toContain('catalog-objects');
    expect(resources).toContain('APPLIK8S_OBJECT_STORAGE_ENDPOINT');
    expect(resources).toContain('http://objects.catalog.svc:8333');
    expect(resources).toContain('AWS_ACCESS_KEY_ID');
    expect(resources).toContain('AWS_SECRET_ACCESS_KEY');
  }, 120_000);

  it('lowers inferred Model.edit dependencies into the durable command kernel', async () => {
    const modelRuntime = (name: string, tableName: string) => ({
      name,
      tableName,
      provider: 'postgres',
      database: 'catalog',
      clusterName: 'catalog',
      secretName: 'catalog-app',
      secretKey: 'uri',
      secretNamespace: 'catalog',
      connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL',
      constraints: [],
      indexes: [],
      retention: { mode: 'retain' },
      storageShape: 'native-relational',
      nativeRelational: {
        identity: { property: 'id', column: 'id' },
        columns: [
          { property: 'id', column: 'id' },
          { property: 'state', column: 'state' },
          { property: 'revision', column: 'revision' },
        ],
        revision: { property: 'revision', column: 'revision' },
      },
    });
    const nodes = [
      {
        id: 'provider.application-host',
        kind: 'provider',
        name: 'application-host',
        stability: 'stable',
        interface: 'ApplicationHost',
        implementation: 'managed-application-host',
        config: { host: { name: 'reactive-test-app', namespace: 'catalog', port: 3_000 } },
      },
      {
        id: 'actor.workspace.v1',
        kind: 'actor',
        name: 'workspace.v1',
        stability: 'experimental',
        definition: {
          id: 'workspace.v1',
          key: schema({ type: 'string' }),
          state: schema({ type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }),
          stateVersion: 1,
          migrationDigest: 'sha256:none',
          migrations: [],
          protocol: [{
            name: 'observe',
            kind: 'message',
            input: schema({ type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] }),
          }],
          requirements: {
            durableState: true,
            serializedTurns: true,
            transactionalOutbox: true,
            durableAlarms: false,
            realtimeConnections: false,
            connectionLeases: false,
            realtimeMessages: false,
            realtimeBroadcast: false,
          },
        },
        runtime: { interface: 'ActorRuntime', nodeId: 'provider.actor-runtime' },
        handlers: [],
        semantics: { serialization: 'fullTurnPerIdentity', admission: 'idempotentReceipt', references: 'inertAddress' },
      },
      {
        id: 'model.post',
        kind: 'model',
        name: 'Post',
        stability: 'stable',
        runtime: modelRuntime('Post', 'posts'),
      },
      {
        id: 'model.account',
        kind: 'model',
        name: 'Account',
        stability: 'stable',
        runtime: modelRuntime('Account', 'accounts'),
      },
      {
        id: 'model.subscription',
        kind: 'model',
        name: 'Subscription',
        stability: 'stable',
        runtime: modelRuntime('Subscription', 'subscriptions'),
      },
      {
        id: 'event.posts.changed.v1',
        kind: 'event',
        name: 'posts.changed.v1',
        stability: 'stable',
        contract: {
          name: 'posts.changed',
          version: 'v1',
          payload: schema({
            type: 'object',
            properties: { postId: { type: 'string' } },
            required: ['postId'],
          }),
        },
      },
      {
        id: 'query.posts.pending.v1',
        kind: 'query',
        name: 'posts.pending',
        version: 'v1',
        stability: 'stable',
        input: schema({ type: 'object', properties: {}, required: [] }),
        output: schema({
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        }),
        reads: [{ model: { nodeId: 'model.post' }, relationship: 'set' }],
        authorization: 'application-defined',
        trustedContext: [],
        budgets: { timeoutMs: 1_000, maxResultBytes: 10_000, maxRows: 100 },
        snapshotResume: 'resumableInvalidation',
        incremental: 'invalidation-requery',
        cursor: 'opaque-query-version-context-scoped',
        database,
        authorizationSource: '() => true',
        handlerSource: 'async () => []',
      },
      {
        id: 'stream.posts.requested.v1',
        kind: 'stream',
        name: 'posts.requested',
        version: 'v1',
        stability: 'stable',
        payload: schema({
          type: 'object',
          properties: { postId: { type: 'string' } },
          required: ['postId'],
        }),
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 3_600 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: 'event => event.postId',
        authorizationSource: '() => false',
      },
      {
        id: 'streamProcessor.publish-post',
        kind: 'streamProcessor',
        name: 'publish-post',
        stability: 'stable',
        source: { nodeId: 'stream.posts.requested.v1' },
        database,
        handlerSource: 'async event => Post.edit(event.postId, async post => { const account = await Account.require(post.accountId); await post.update({ state: account.value.state }); await PendingPosts({}); await Workspace.observe.send(event.postId, { postId: event.postId }); PostChanged.emit({ postId: event.postId }); })',
        functionNativeTransaction: {
          primaryModel: { nodeId: 'model.post' },
          models: [
            { nodeId: 'model.account' },
            { nodeId: 'model.post' },
            { nodeId: 'model.subscription' },
          ],
          modelBindings: [
            { identifier: 'Account.require', model: { nodeId: 'model.account' }, access: 'read' },
            { identifier: 'Billing.Subscription', model: { nodeId: 'model.subscription' }, access: 'read' },
            { identifier: 'Post.edit', model: { nodeId: 'model.post' }, access: 'write' },
          ],
          eventBindings: [
            { identifier: 'PostChanged.emit', event: { nodeId: 'event.posts.changed.v1' } },
          ],
          outbox: [{ nodeId: 'event.posts.changed.v1' }],
          idempotency: 'source-event-id',
        },
        queryBindings: [
          {
            identifier: 'PendingPosts',
            query: { nodeId: 'query.posts.pending.v1' },
          },
        ],
        actorBindings: [{
          identifier: 'Workspace.observe.send',
          actor: { nodeId: 'actor.workspace.v1' },
          member: 'observe',
          memberKind: 'message',
        }],
        delivery: 'at-least-once',
        invocation: 'event',
        idempotency: 'source-event-id',
        checkpoint: 'postgres',
        failure: 'pause',
        retry: {
          mode: 'boundedExponentialBackoff',
          maxAttempts: 5,
          initialDelayMs: 100,
          maxDelayMs: 5_000,
          factor: 2,
        },
        deployment: {
          image: 'node:22-alpine',
          replicas: 1,
          concurrency: 1,
          maxAckPending: 64,
          healthPort: 8_080,
          gracefulShutdownSeconds: 30,
          resources: {},
          scaling: { mode: 'fixed' },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
      },
      {
        id: 'provider.observability',
        kind: 'provider',
        name: 'Observability',
        stability: 'stable',
        interface: 'Observability',
        implementation: 'local-otel',
      },
    ] as unknown as ApplicationGraphNode[];
    const [artifact] = await emitGeneratedApplicationReactive({
      graph: reactiveGraph(nodes),
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-function-native-model-')),
      entrypoint: import.meta.filename,
    });
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'),
      'utf8',
    );

    expect(generated).toContain(
      "from '@applik8s/applik8s/stream-worker-runtime'",
    );
    expect(generated).toContain('executeFunctionNativePostgresModelEdit');
    expect(generated).toContain('withApplicationNativeModelTransactionRuntime');
    expect(generated).toContain('functionNativeModelHandle');
    expect(generated).toContain(
      'currentFunctionNativePostgresDatabase, currentFunctionNativePostgresTransaction, editApplicationNativeModelObject',
    );
    expect(generated).toContain('activeTransaction ?? databaseUrl');
    expect(generated).toContain('delivery.context');
    expect(generated).toContain('createApplicationFunctionNativeEventHandle');
    expect(generated).toContain('currentFunctionNativePostgresDatabase()');
    expect(generated).toContain('invokeApplicationActorBinding');
    expect(generated).toContain('processorActors(authoredContext)');
    expect(generated).toContain('/__applik8s/v1/internal/actors/invoke');
    expect(generated).toContain('captureApplicationTelemetryContext()');
    expect(generated).toContain('...(telemetry ? { telemetry } : {})');
    expect(generated).toContain("transport: 'event'");
    expect(generated).toContain('principal,');
    expect(generated).toContain('workloadAuthorityId:');
    expect(generated).not.toContain("id: 'processor:' + principal.executionId");
    expect(JSON.stringify(artifact?.resources)).toContain('APPLIK8S_ACTOR_APPLICATION_ENDPOINT');
    expect(generated).toContain(
      'const runtimeDatabase = activeDatabase ?? processorQueryDb;',
    );
    expect(generated).toContain('processorQueries(context)');
    expect(generated).toContain('"name":"Post"');
    expect(generated).toContain('"name":"Account"');
    expect(generated).toContain(
      '"Billing": Object.freeze({ ...({ "Subscription": { "edit": functionNativeModelHandle("Subscription")["edit"], "find": functionNativeModelHandle("Subscription")["find"], "get": functionNativeModelHandle("Subscription")["get"], "require": functionNativeModelHandle("Subscription")["require"] } }) })',
    );
    expect(generated).toContain(
      '"Account": Object.freeze({ ...({ "require": functionNativeModelHandle("Account")["require"] }) })',
    );
    expect(generated).toContain('"id":"posts.changed.v1"');
    expect(generated).toContain('idempotencyKey: context.idempotencyKey');
    expect(generated).toContain('outbox: functionNativeOutbox');
    expect(generated).toContain(
      'changeScopes: context.event.changeScopes',
    );
  }, 120_000);

  it('fails compilation when an awaited lifecycle operation crosses database authorities', async () => {
    const parents = pgTable('cross_authority_parents', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const children = pgTable('cross_authority_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('cross-authority-lifecycle', {
      namespace: 'cross-authority-lifecycle',
    });
    const primary = application.database.postgres('primary', {
      schema: { parents },
    });
    const secondary = application.database.postgres('secondary', {
      schema: { children },
    });
    const Parent = application.model(parents, {
      name: 'CrossAuthorityParent',
      database: primary,
    });
    const Child = application.model(children, {
      name: 'CrossAuthorityChild',
      database: secondary,
    });
    async function createChild(event: { readonly identity: string }) {
      await Child.create({
        id: event.identity,
        parentId: event.identity,
        revision: event.identity,
      });
    }
    bindApplicationCallableDependencies(createChild, [
      { identifier: 'Child.create', value: Child.create },
    ]);
    Parent.on.create(createChild);
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected cross-authority application graph.');

    await expect(emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-cross-authority-')),
      entrypoint: import.meta.filename,
    })).rejects.toThrow(
      /cannot atomically call.*source transaction uses.*while CrossAuthorityChild uses.*workflow or post-commit event handler/s,
    );
  });

  it('infers a lifecycle processor service identity from its complete static authority', async () => {
    const records = pgTable('service_identity_records', {
      id: text('id').primaryKey(),
      state: text('state').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('processor-service-authority', {
      namespace: 'processor-service-authority',
    });
    const Database = application.database.postgres('application', {
      schema: { records },
    });
    const Record = application.model(records, {
      name: 'ServiceIdentityRecord',
      database: Database,
    });
    const Worker = application.serviceIdentity('record-worker');
    async function activateRecord(created: { readonly value: { readonly id: string } }) {
      await Record.update({
        identity: created.value.id,
        patch: { state: 'active' },
      });
    }
    bindApplicationCallableDependencies(activateRecord, [
      { identifier: 'Record.update', value: Record.update },
    ]);
    Record.on.create(activateRecord);
    Worker.can(Record.update);
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected processor service-authority graph.');

    const artifacts = await emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-processor-service-')),
      entrypoint: import.meta.filename,
    });
    const artifact = artifacts.find((candidate) =>
      candidate.kind === 'streamProcessorWorker',
    );
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'stream-processor.generated.ts'),
      'utf8',
    );

    expect(generated).toContain('function processorExecutionPrincipal(context)');
    expect(generated).toContain(
      '"id":"identity:processor-service-authority:service:record-worker"',
    );
    expect(generated).toContain(
      'serviceIdentity: {"id":"identity:processor-service-authority:service:record-worker"',
    );
    expect(generated).toContain(
      "const principal = processorExecutionPrincipal(context);",
    );
    expect(generated).toContain(
      'applicationCommandPrincipalValues(principal)',
    );
    expect(generated).toContain('causalPrincipalId: causal.id');
    expect(generated).toContain('const principal = context.admission?.principal');
    expect(generated).toContain(
      'handleAuthoredEvent(input, processorAuthoredContext(context))',
    );
  }, 120_000);

  it('lowers profiled identity callbacks into isolated server modules and an installation-bound dispatcher', async () => {
    const graph = await nativeQueryFixtureGraph();
    const profiledGraph: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.kind !== 'gateway') return node;
        const {
          authenticationSource: _authenticationSource,
          authenticationDependencies: _authenticationDependencies,
          authenticationLocation: _authenticationLocation,
          authenticationUnresolved: _authenticationUnresolved,
          identityReadinessSource: _identityReadinessSource,
          identityReadinessDependencies: _identityReadinessDependencies,
          identityReadinessLocation: _identityReadinessLocation,
          identityReadinessUnresolved: _identityReadinessUnresolved,
          ...gateway
        } = node;
        return {
          ...gateway,
          authenticationProfile: {
            selector: 'schema.spec.profile',
            cases: {
              starter: {
                source:
                  'async () => ({ principal: { id: "starter" }, trustedContext: {}, authorizationVersion: "starter-v1" })',
              },
              dedicated: {
                source:
                  'async () => ({ principal: { id: "dedicated" }, trustedContext: {}, authorizationVersion: "dedicated-v1" })',
              },
            },
            default: {
              source:
                'async () => ({ principal: { id: "external" }, trustedContext: {}, authorizationVersion: "external-v1" })',
            },
          },
          identityReadinessProfile: {
            selector: 'schema.spec.profile',
            cases: {
              starter: { source: 'async () => undefined' },
              dedicated: { source: 'async () => undefined' },
            },
            default: { source: 'async () => undefined' },
          },
        };
      }),
    };
    const outDir = await mkdtemp(
      join(tmpdir(), 'applik8s-profiled-identity-gateway-'),
    );

    const artifacts = await emitGeneratedApplicationReactive({
      graph: profiledGraph,
      outDir,
      entrypoint: new URL(
        './fixtures/v06-native-query-app.ts',
        import.meta.url,
      ).pathname,
    });
    const gateway = artifacts.find((artifact) => artifact.kind === 'queryGateway');
    const artifactDir = dirname(gateway?.sourcePath ?? '');
    const deployment = gateway?.resources.find(
      (resource) => resource.kind === 'Deployment',
    );
    const authenticationDispatcher = await readFile(
      join(artifactDir, 'authentication.generated.ts'),
      'utf8',
    );
    const branchSources = await Promise.all(
      (await readdir(artifactDir, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isFile()
            && entry.name.startsWith('authentication-profile-'),
        )
        .map((entry) => readFile(join(artifactDir, entry.name), 'utf8')),
    );

    expect(authenticationDispatcher).toContain(
      'APPLIK8S_PROFILE_VARIANT',
    );
    expect(authenticationDispatcher).toContain('"starter"');
    expect(authenticationDispatcher).toContain('"dedicated"');
    expect(branchSources.join('\n')).toContain('"starter"');
    expect(branchSources.join('\n')).toContain('"dedicated"');
    expect(branchSources.join('\n')).toContain('"external"');
    expect(JSON.stringify(deployment)).toContain(
      '"name":"APPLIK8S_PROFILE_VARIANT","value":"${schema.spec.profile}"',
    );
  }, 120_000);

  it('follows function-native views and direct database handles through a thin imported entrypoint', async () => {
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
    expect(source).toContain('only callable inside a managed query');
    expect(source).not.toContain('handlerUnresolved');
  }, 120_000);

  it('fails closed when a generated query captures authoring-only model facet behavior', async () => {
    const graph = await nativeQueryFixtureGraph();
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
  }, 120_000);

  it('lowers runtime-safe public helpers without replaying application authoring imports', async () => {
    const graph = await nativeQueryFixtureGraph();
    const query = graph.nodes.find((node) => node.kind === 'query');
    if (query?.kind !== 'query') throw new Error('Native query fixture did not expose its query node.');
    const causalGraph: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === query.id ? {
        ...query,
        handlerSource:
          'async (_input, context) => applicationCausalPrincipalContext(context.principal).id',
        handlerDependencies: {
          source: `import {
  applicationCausalPrincipalContext,
  type ApplicationModelViewContext,
  module,
} from '@applik8s/applik8s';`,
          resolveDir: process.cwd(),
        },
      } : node),
    };
    const artifacts = await emitGeneratedApplicationReactive({
      graph: causalGraph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-query-public-helper-')),
      entrypoint: new URL('./fixtures/v06-native-query-app.ts', import.meta.url).pathname,
    });
    const gateway = artifacts.find((artifact) => artifact.kind === 'queryGateway');
    const directory = dirname(gateway?.sourcePath ?? '');
    const generated = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.startsWith('run-') && name.endsWith('.generated.ts'))
        .map((name) => readFile(join(directory, name), 'utf8')),
    );
    const callback = generated.find((source) =>
      source.includes('applicationCausalPrincipalContext(context.principal)'),
    );
    expect(callback).toContain(
      'import { applicationCausalPrincipalContext } from "@applik8s/core";',
    );
    expect(callback).not.toContain("from \"@applik8s/applik8s\"");
    expect(callback).not.toMatch(/import\s*\{[^}]*\bmodule\b/);
  }, 120_000);

  it('bundles an authenticated HTTP/SSE gateway with Secret-backed PostgreSQL and cursor authority', async () => {
    const graph = reactiveGraph([
      { id: 'provider.event-log', kind: 'provider', name: 'EventLog', stability: 'stable', interface: 'EventLog', implementation: 'nats-jetstream', config: { name: 'events', namespace: 'catalog', stream: 'APPLIK8S_EVENTS', subjectPrefix: 'applik8s', provision: false }, contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'EventLog', version: 'v1alpha1', requirements: [], guarantees: [], implementation: { name: 'nats-jetstream' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] } },
      { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', common: { identity: { fields: ['id'], encoding: 'scalar' }, relationships: [{ source: 'Card', name: 'set', target: 'sets', cardinality: 'one', integrity: 'foreign-key', fields: ['setId'], references: ['id'] }], operations: [{ name: 'rename', operation: 'custom', transport: 'command', publicId: 'cards.rename.v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { changed: { type: 'boolean' } }, required: ['changed'] }), authorization: 'application-defined' }] }, native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'model.set', kind: 'model', name: 'Set', stability: 'stable', native: { artifact: { name: 'sets' } }, runtime: { name: 'Set', tableName: 'sets', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } },
      { id: 'command.cards.rename.v1', kind: 'command', name: 'cards.rename.v1', stability: 'stable', contract: { name: 'cards.rename', version: 'v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { changed: { type: 'boolean' } }, required: ['changed'] }), errors: [] } },
      { id: 'command-handler.card-rename', kind: 'commandHandler', name: 'Card-cards.rename.v1', stability: 'stable', model: { nodeId: 'model.card' }, command: { nodeId: 'command.cards.rename.v1' }, key: { kind: 'function', source: '(input) => input.cardId' }, ordering: 'serial', missing: 'reject', transaction: { models: [{ nodeId: 'model.card' }], history: [], outbox: [] }, retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3 }, retention: { replayWindowSeconds: 3600, auditWindowSeconds: 7200, publishedOutboxWindowSeconds: 3600, cleanupIntervalSeconds: 60, cleanupBatchSize: 100 }, effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, handlerSource: '() => ({ changed: true })', projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' } },
      { id: 'query.cards.list.v1', kind: 'query', name: 'cards.list', version: 'v1', stability: 'stable', input: schema({ type: 'object', properties: {}, required: [] }), output: schema({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }), reads: [{ model: { nodeId: 'model.card' }, relationship: 'set' }], authorization: 'application-defined', trustedContext: [], budgets: { timeoutMs: 1000, maxResultBytes: 10000, maxRows: 100 }, snapshotResume: 'resumableInvalidation', incremental: 'invalidation-requery', cursor: 'opaque-query-version-context-scoped', database, authorizationSource: '({ principal }) => principal.id.length > 0', handlerSource: 'async () => []', handlerDependencies: { source: 'import { unusedAuthoringApp } from "./authoring-only";', resolveDir: process.cwd() } },
      { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' },
      { id: 'subscription.card-events', kind: 'subscription', name: 'card-events', stability: 'stable', source: { nodeId: 'stream.cards.changed.v1' }, delivery: 'sse', cursor: 'opaque-scoped', authorization: 'application-defined', authorizationSource: '({ principal }) => principal.id === "generated-stream-subscription-proof"', retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 250, maxDelayMs: 30000 }, suspension: 'bounded-failures' },
      { id: 'gateway.public', kind: 'gateway', name: 'public', stability: 'stable', queries: [{ nodeId: 'query.cards.list.v1' }], commands: [{ command: { nodeId: 'command.cards.rename.v1' }, handler: { nodeId: 'command-handler.card-rename' } }], subscriptions: [{ nodeId: 'subscription.card-events' }], transport: 'http-sse', authentication: 'external-provider', trustedContextAdmission: 'server-validated', browserCredentials: 'forbidden', subscriptionLimits: { perPrincipal: 10, total: 100 }, routes: { snapshots: '/queries/:query/snapshot', subscriptions: '/queries/:query/subscribe', streamReplay: '/streams/:subscription/replay', streamSubscriptions: '/streams/:subscription/subscribe', commandSubmission: '/commands/:command/submit', commandProgress: '/commands/:command/progress' }, resume: 'resumableInvalidation', materialization: 'generatedDeployment', authenticationSource: 'async () => ({ principal: { id: "test" }, trustedContext: {}, authorizationVersion: "v1" })', identityReadinessSource: 'async () => undefined', authorizationReadinessSource: 'async () => undefined', commandAuthorizationSource: '({ command }) => command === Card.rename.operation.id', commandAuthorizationDependencies: { source: 'import { Card } from "./authoring-only";', resolveDir: process.cwd() }, cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'gateway-cursor', namespace: 'catalog', key: 'secret' }, deployment: { namespace: 'catalog', image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2', replicas: 2, port: 8080 } },
      {
        id: 'aiAgent.card-agent',
        kind: 'aiAgent',
        name: 'card-agent',
        stability: 'stable',
        serviceIdentity: {
          id: 'identity:reactive-test:service:card-agent',
          kind: 'service',
          issuer: 'applik8s://reactive-test',
          subject: 'card-agent',
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
        instructions: { kind: 'static', value: 'Rename admitted cards.' },
        tools: [{
          operationId: 'applik8s://models/Card/operations/rename',
          operationVersion: 'v1',
          transport: 'command',
          graphNode: { nodeId: 'model.card' },
          authority: {
            classification: 'assigned',
            permissionIds: [],
            grantable: false,
            delegable: false,
            scope: { kind: 'all' },
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
      { id: 'mcpServer.public', kind: 'mcpServer', name: 'public', stability: 'stable', protocol: { preferred: '2025-11-25', supported: ['2025-11-25'], sdk: '@modelcontextprotocol/sdk@1.30.0', extensions: ['io.modelcontextprotocol/oauth-client-credentials/v1'] }, path: '/__applik8s/mcp/public', resource: 'https://reactive.example.test/mcp', audience: 'https://reactive.example.test/mcp', authorizationServers: ['https://identity.example.test'], scopes: ['operations:invoke'], tools: [{ publicName: 'rename-card', operationId: 'applik8s://models/Card/operations/rename', schemaRevision: 'operation' }], sessions: { mode: 'stateful-pinned', catalog: 'operation-catalog-revision', authorization: 'revalidate-every-call', compatibleBindings: 'drain', incompatibleBindings: 'reinitialize', lifetimeMs: 3600000 }, transport: { kind: 'streamable-http', protectedResourceMetadata: true, tokenPassthrough: 'forbidden', maximumRequestBytes: 1048576, maximumResponseBytes: 10485760 } },
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
    expect(source).toContain('authorityRevision');
    expect(source).toContain('trustedContextDigest');
    expect(source).toContain('applik8s.command/v1alpha1');
    expect(source).toContain('generated-stream-subscription-proof');
    expect(source).toContain('applik8s.stream/v1alpha1');
    expect(generatedSource).toContain('async function admitRequest(request)');
    expect(generatedSource).toContain("from '@applik8s/runtime-nats/event-log'");
    expect(generatedSource).not.toContain("from '@applik8s/runtime-aws/kinesis'");
    expect(generatedSource).toContain('async function admitQuery(request, query, input)');
    expect(generatedSource).toContain('heartbeatMs: 15_000');
    expect(generatedSource).toContain('maxSessionMs: 20_000');
    expect(generatedSource.match(/maxSessionMs: 20_000/g)).toHaveLength(2);
    expect(generatedSource).not.toContain('verifyApplicationTaskQueryAdmission');
    expect(generatedSource).toContain('authenticate: admitRequest');
    expect(generatedSource).toContain('createApplicationOperationAuthorityRuntime');
    expect(generatedSource).toContain('applik8s://models/Card/operations/rename');
    const compressedCatalog = generatedSource.match(
      /catalog: JSON\.parse\(gunzipSync\(Buffer\.from\(("(?:[^"\\]|\\.)*"), 'base64'\)/,
    )?.[1];
    expect(compressedCatalog).toBeDefined();
    const hydratedCatalog = JSON.parse(
      gunzipSync(
        Buffer.from(JSON.parse(compressedCatalog ?? '""'), 'base64'),
      ).toString('utf8'),
    ) as { operations?: readonly { id?: string }[] };
    expect(hydratedCatalog.operations).toContainEqual(
      expect.objectContaining({
        id: 'applik8s://models/Card/operations/rename',
      }),
    );
    expect(generatedSource).toContain('authorizeOperation:');
    expect(generatedSource).toContain('revalidateOperation:');
    expect(generatedSource).toContain('createApplicationInternalOperationHandler');
    expect(generatedSource).toContain("requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET')");
    expect(generatedSource).toContain(
      'commandGateway.invoke({ operationId: "applik8s://models/Card/operations/rename"',
    );
    expect(generatedSource).not.toContain(
      'commandGateway.invoke({ operationId: operation.id',
    );
    expect(generatedSource).toContain(
      'audiences: ["https://reactive.example.test/mcp","identity:reactive-test:workload:aiAgent.card-agent"]',
    );
    expect(generatedSource).not.toContain('authorization: request.headers');
    expect(generatedSource).toContain('operationAuthority.admitPrincipal');
    expect(generatedSource).toContain(
      'async function prepareOperationAuthority()',
    );
    expect(generatedSource).toContain(
      "readinessCheck('operation-authority', () => prepareOperationAuthority())",
    );
    expect(generatedSource).not.toContain(
      '});\nawait operationAuthority.prepare();',
    );
    expect(generatedSource).toContain('verifyIdentityReadiness()');
    expect(generatedSource).toContain('verifyAuthorizationReadiness()');
    expect(generatedSource).toContain(
      "readinessCheck('operation-authority', () => prepareOperationAuthority())",
    );
    expect(generatedSource).toContain(
      "readinessCheck('identity', () => verifyIdentityReadiness())",
    );
    expect(generatedSource).toContain(
      "readinessCheck('authorization', () => verifyAuthorizationReadiness())",
    );
    expect(generatedSource).toContain(
      "async function readinessCheck(boundary, check)",
    );
    expect(generatedSource).toContain(
      "error.message + ' ' + providerReadinessError(cause)",
    );
    expect(generatedSource).toContain("from './identity-readiness.generated.js'");
    expect(generatedSource).not.toContain('authenticate: admit,');
    expect(JSON.stringify(deployment)).toContain('APPLIK8S_INTERNAL_OPERATION_SECRET');
    expect(JSON.stringify(deployment)).toContain('reactive-test-internal-operation');
    const commandAuthorizationSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'command-authorization.generated.ts'), 'utf8');
    expect(commandAuthorizationSource).toContain('"cards.rename.v1"');
    expect(commandAuthorizationSource).not.toContain('authoring-only');
    const queryCallbackSources = await Promise.all((await readdir(dirname(artifact?.sourcePath ?? ''), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.startsWith('run-')).map((entry) => readFile(join(dirname(artifact?.sourcePath ?? ''), entry.name), 'utf8')));
    expect(queryCallbackSources.join('\n')).not.toContain('authoring-only');
    expect(source).toMatch(/reads:\[\{\$model:\{name:"Card"\}\},\{\$model:\{name:"Set"\}\}\]/);
    expect(artifact?.sizeBytes).toBeLessThan(reactiveRuntimeBundleBudgetBytes);

    const [awsArtifact] = await emitGeneratedApplicationReactive({
      graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-reactive-gateway-aws-')),
      entrypoint: import.meta.filename,
      executionTarget: 'aws',
    });
    const awsGeneratedSource = await readFile(
      join(dirname(awsArtifact?.sourcePath ?? ''), 'gateway.generated.ts'),
      'utf8',
    );
    expect(awsGeneratedSource).toContain("from '@applik8s/runtime-aws/kinesis'");
    expect(awsGeneratedSource).not.toContain("from '@applik8s/runtime-nats/event-log'");
  });

  it('generates an exact-instance signal gateway and filters issuance SSE before delivery', async () => {
    const input = schema({
      type: 'object',
      properties: { postId: { type: 'string' } },
      required: ['postId'],
      additionalProperties: false,
    });
    const approve = schema({
      type: 'object',
      properties: { comment: { type: 'string' } },
      required: ['comment'],
      additionalProperties: false,
    });
    const signal = {
      id: 'review-decision.v1',
      name: 'review-decision',
      version: 'v1',
      actions: [{ name: 'approve', schema: approve }],
    } as const;
    const signalStream = {
      id: 'stream.review-decision.v1',
      kind: 'stream',
      name: 'review-decision',
      version: 'v1',
      stability: 'stable',
      payload: schema({
        type: 'object',
        properties: {
          id: { type: 'string' },
          input: input.jsonSchema,
          signal: {
            type: 'object',
            properties: {
              $type: { const: 'applik8s.signal/v1' },
              contract: { type: 'object', additionalProperties: true },
              issuance: { type: 'object', additionalProperties: true },
              expiresAt: { type: 'string' },
            },
            required: ['$type', 'contract', 'issuance', 'expiresAt'],
          },
          issuedAt: { type: 'string' },
          expiresAt: { type: 'string' },
        },
        required: ['id', 'input', 'signal', 'issuedAt', 'expiresAt'],
        additionalProperties: false,
      }),
      authority: 'postgres-outbox',
      delivery: 'at-least-once',
      replay: 'supported',
      retention: { maxAgeSeconds: 86_400 },
      partitioning: 'declared',
      compatibility: 'versioned-schema',
      authorization: 'application-defined',
      database,
      partitionSource: '(payload) => payload.id',
      authorizationSource: '() => true',
      signal,
    } as const;
    const workflowHandler = {
      id: 'workflow-handler.publish-post',
      kind: 'workflowHandler',
      name: 'publish-post',
      stability: 'stable',
      signalBindings: [{
        alias: 'ReviewDecision',
        ...signal,
        input,
      }],
    } as const;
    const subscription = {
      id: 'subscription.review-decisions',
      kind: 'subscription',
      name: 'review-decisions',
      stability: 'stable',
      source: { nodeId: signalStream.id },
      delivery: 'sse',
      cursor: 'opaque-scoped',
      authorization: 'application-defined',
      authorizationSource: '() => true',
      retry: {
        mode: 'boundedExponentialBackoff',
        maxAttempts: 5,
        initialDelayMs: 250,
        maxDelayMs: 30_000,
      },
      suspension: 'bounded-failures',
    } as const;
    const processor = {
      id: 'stream-processor.review-decision-audit',
      kind: 'streamProcessor',
      name: 'review-decision-audit',
      stability: 'stable',
      source: { nodeId: signalStream.id },
      database,
      handlerSource: 'async (event) => { if (event.input.postId === "automatic") await event.signal.approve({ comment: "policy" }); }',
      delivery: 'at-least-once',
      invocation: 'event',
      idempotency: 'source-event-id',
      checkpoint: 'postgres',
      failure: 'pause',
      retry: {
        mode: 'boundedExponentialBackoff',
        maxAttempts: 3,
        initialDelayMs: 250,
        maxDelayMs: 30_000,
        factor: 2,
      },
      deployment: {
        image: 'node:22-alpine',
        replicas: 1,
        concurrency: 1,
        maxAckPending: 64,
        healthPort: 8_080,
        gracefulShutdownSeconds: 30,
        resources: {},
        scaling: { mode: 'fixed' },
      },
      budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
    } as const;
    const gateway = {
      id: 'gateway.public',
      kind: 'gateway',
      name: 'public',
      stability: 'stable',
      queries: [],
      commands: [],
      subscriptions: [{ nodeId: subscription.id }],
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
      materialization: 'generatedDeployment',
      authenticationSource: 'async () => ({ principal: { id: "reviewer" }, trustedContext: {}, authorizationVersion: "v1" })',
      cursorSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'gateway-cursor',
        namespace: 'catalog',
        key: 'secret',
      },
      deployment: {
        namespace: 'catalog',
        image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
        replicas: 1,
        port: 8080,
      },
    } as const;
    const artifacts = await emitGeneratedApplicationReactive({
      graph: reactiveGraph([
        workflowHandler,
        signalStream,
        processor,
        subscription,
        gateway,
      ] as unknown as ApplicationGraphNode[]),
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-signal-gateway-')),
      entrypoint: import.meta.filename,
    });
    const artifact = artifacts.find((candidate) => candidate.kind === 'queryGateway');
    const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'gateway.generated.ts'),
      'utf8',
    );

    expect(source).toContain('applik8s://signals/review-decision.v1/operations/issuance.read');
    expect(source).toContain('applik8s://signals/review-decision.v1/operations/approve');
    expect(generated).toContain('createApplicationSignalGateway');
    expect(generated).toContain("basePath: '/signals'");
    expect(generated).toContain('createApplicationAuthorizedReplayableStream');
    expect(generated).toContain('authorizeSignalIssuance');
    expect(generated).toContain('applicationSignalIsActionable(signal)');
    expect(generated).toContain('signalOperationTarget');
    expect(generated).toContain('applicationPolicyAllowed: true');
    expect(generated).toContain('"postId"');
    expect(generated).not.toContain('streamAuthorize_review_decision');

    const processorArtifact = artifacts.find(
      (candidate) => candidate.kind === 'streamProcessorWorker',
    );
    const processorGenerated = await readFile(
      join(
        dirname(processorArtifact?.sourcePath ?? ''),
        'stream-processor.generated.ts',
      ),
      'utf8',
    );
    expect(processorGenerated).toContain(
      'createApplicationSignalIssuanceDecoder',
    );
    expect(processorGenerated).toContain(
      'decodePayload: decodeSignalIssuance',
    );
    expect(processorGenerated).toContain('admit: processorAdmission');
    expect(processorGenerated).toContain(
      'const executionPrincipal = context.admission.principal',
    );
    expect(processorGenerated).toContain(
      'executionPrincipal.causalPrincipalId !== durablePrincipal.id',
    );
    expect(processorGenerated).not.toContain(
      'const signalOperationAuthority',
    );
    expect(processorGenerated).toContain("transport: 'event'");
    expect(processorGenerated).toContain('APPLIK8S_SIGNAL_SUBJECT_DENIED');
    expect(processorGenerated).toContain('application-signal-runtime');
    expect(processorGenerated).toContain('terminalStatus');
  }, 120_000);

  it('guards capability-bearing projection queries without requiring a parallel signal subscription', async () => {
    const signal = {
      id: 'review-decision.v1',
      name: 'review-decision',
      version: 'v1',
      actions: [{
        name: 'approve',
        schema: schema({
          type: 'object',
          properties: { comment: { type: 'string' } },
          required: [],
          additionalProperties: false,
        }),
      }],
    } as const;
    const referenceSchema = {
      type: 'object',
      properties: {
        $type: { const: 'applik8s.signal/v1' },
        contract: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
          },
          required: ['id', 'name', 'version'],
        },
        issuance: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        expiresAt: { type: 'string' },
      },
      required: ['$type', 'contract', 'issuance', 'expiresAt'],
    } as const;
    const signalStream = {
      id: 'stream.review-decision.v1',
      kind: 'stream',
      name: 'review-decision',
      version: 'v1',
      stability: 'stable',
      payload: schema({
        type: 'object',
        properties: {
          id: { type: 'string' },
          input: {
            type: 'object',
            properties: { postId: { type: 'string' } },
            required: ['postId'],
          },
          signal: referenceSchema,
          issuedAt: { type: 'string' },
          expiresAt: { type: 'string' },
        },
        required: ['id', 'input', 'signal', 'issuedAt', 'expiresAt'],
      }),
      authority: 'postgres-outbox',
      delivery: 'at-least-once',
      replay: 'supported',
      retention: { maxAgeSeconds: 86_400 },
      partitioning: 'declared',
      compatibility: 'versioned-schema',
      authorization: 'application-defined',
      database,
      partitionSource: '(payload) => payload.id',
      authorizationSource: '() => true',
      signal,
    } as const;
    const workflowHandler = {
      id: 'workflow-handler.publish-post-capability-query',
      kind: 'workflowHandler',
      name: 'publish-post-capability-query',
      stability: 'stable',
      signalBindings: [{
        alias: 'ReviewDecision',
        ...signal,
        input: schema({
          type: 'object',
          properties: { postId: { type: 'string' } },
          required: ['postId'],
          additionalProperties: false,
        }),
      }],
    } as const;
    const provider = {
      id: 'provider.analytical-database',
      kind: 'provider',
      name: 'AnalyticalDatabase',
      stability: 'stable',
      interface: 'AnalyticalDatabase',
      implementation: 'clickhouse',
      config: {
        name: 'signal-analytics',
        namespace: 'catalog',
        database: 'analytics',
        enabled: false,
        credentialsSecret: {
          name: 'signal-clickhouse',
          namespace: 'catalog',
        },
      },
    } as const;
    const model = {
      id: 'model.pending-review',
      kind: 'model',
      name: 'PendingReview',
      stability: 'stable',
      native: { artifact: { name: 'pending_reviews' } },
      runtime: {
        name: 'PendingReview',
        tableName: 'pending_reviews',
        provider: 'postgres',
        database: 'catalog',
        clusterName: 'catalog',
        secretName: 'catalog-app',
        secretKey: 'uri',
        secretNamespace: 'catalog',
        connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL',
        constraints: [],
        indexes: [],
        retention: { mode: 'retain' },
      },
    } as const;
    const projection = {
      id: 'projection.pending-review-capabilities',
      kind: 'projection',
      name: 'pending-review-capabilities',
      stability: 'stable',
      source: { nodeId: signalStream.id },
      provider: {
        interface: 'AnalyticalDatabase',
        nodeId: provider.id,
      },
      storage: 'analytical',
      rebuildable: true,
      checkpoint: 'idempotent',
      output: schema({
        type: 'object',
        properties: {
          id: { type: 'string' },
          signal: referenceSchema,
        },
        required: ['id', 'signal'],
      }),
      capabilityFields: [{
        path: 'signal',
        kind: 'signalReference',
        contract: {
          id: signal.id,
          name: signal.name,
          version: signal.version,
        },
        visibility: 'same-as-issuance',
        maxAgeSeconds: 86_400,
      }],
      eventIdentity: 'stable-source-event-id',
      duplicateHandling: 'idempotent',
      rebuild: 'full-replay',
      handlerSource: '(event) => ({ id: event.id, signal: event.signal })',
    } as const;
    const query = {
      id: 'query.reviews.pending.v1',
      kind: 'query',
      name: 'reviews.pending',
      version: 'v1',
      stability: 'stable',
      input: schema({
        type: 'object',
        properties: {},
        required: [],
      }),
      output: schema({
        type: 'array',
        items: projection.output.jsonSchema,
      }),
      reads: [{ model: { nodeId: model.id } }],
      authorization: 'application-defined',
      trustedContext: [],
      budgets: {
        timeoutMs: 1_000,
        maxResultBytes: 10_000,
        maxRows: 100,
      },
      snapshotResume: 'resumableInvalidation',
      incremental: 'invalidation-requery',
      cursor: 'opaque-query-version-context-scoped',
      database,
      projection: {
        nodeId: projection.id,
        storage: 'analytical',
      },
      authorizationSource: '() => true',
      handlerSource: 'async () => []',
    } as const;
    const gateway = {
      id: 'gateway.public',
      kind: 'gateway',
      name: 'public',
      stability: 'stable',
      queries: [{ nodeId: query.id }],
      commands: [],
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
      materialization: 'generatedDeployment',
      authenticationSource: 'async () => ({ principal: { id: "reviewer" }, trustedContext: {}, authorizationVersion: "v1" })',
      cursorSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'gateway-cursor',
        namespace: 'catalog',
        key: 'secret',
      },
      deployment: {
        namespace: 'catalog',
        image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
        replicas: 1,
        port: 8080,
      },
    } as const;
    const artifacts = await emitGeneratedApplicationReactive({
      graph: reactiveGraph([
        workflowHandler,
        provider,
        model,
        signalStream,
        projection,
        query,
        gateway,
      ] as unknown as ApplicationGraphNode[]),
      outDir: await mkdtemp(
        join(tmpdir(), 'applik8s-signal-projection-query-'),
      ),
      entrypoint: import.meta.filename,
    });
    const artifact = artifacts.find(
      (candidate) => candidate.kind === 'queryGateway',
    );
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'gateway.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('authorizeOutputCapability:');
    expect(generated).toContain(
      'signalStore.read(capability.issuance.id)',
    );
    expect(generated).toContain('authorizeSignalOperation({');
    expect(generated).toContain('createApplicationSignalGateway');
    expect(generated).not.toContain(
      'createApplicationStreamSubscriptionGateway({',
    );
  }, 120_000);

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
    const task = {
      id: 'task.moderation.inspect.v1',
      kind: 'task',
      name: 'moderation.inspect.v1',
      stability: 'stable',
      contract: {
        name: 'moderation.inspect',
        version: 'v1',
        input: schema({ type: 'object', properties: {}, required: [] }),
        output: schema({ type: 'object', properties: {}, required: [] }),
        errors: [],
      },
    } as const;
    const taskHandler = {
      id: 'task-handler.moderation.inspect.v1',
      kind: 'taskHandler',
      name: 'moderation.inspect.v1',
      stability: 'stable',
      task: { nodeId: task.id },
      workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
      queries: [{ alias: 'current', query: { nodeId: query.id } }],
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1_000, factor: 2 },
      executionTimeoutSeconds: 30,
      scheduleTimeoutSeconds: 60,
      idempotency: { required: true, keySource: 'invocation', guarantee: 'atLeastOnceRetrySafe' },
      effectBoundary: 'externalEffectsAllowed',
      handlerSource: 'async () => ({})',
    } as const;
    const observability = {
      id: 'provider.observability.v1alpha1.primary', kind: 'provider', name: 'Observability', stability: 'stable',
      interface: 'Observability', implementation: 'local-otel', config: {},
    } as const;
    const [artifact] = await emitGeneratedApplicationReactive({
      graph: reactiveGraph([card, cardQuery, policy, query, gateway, task, taskHandler, observability] as unknown as ApplicationGraphNode[]),
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
    expect(generatedSource).toContain('verifyApplicationTaskQueryAdmission');
    expect(source).toContain('Applik8s Kubernetes query request failed');
    expect(generatedSource).toContain('proxyApplicationQueryMultiplex');
    expect(generatedSource).toContain('relationalQueryIds');
    expect(generatedSource).toContain('kubernetesQueryIds');
    expect(source).toContain('Mixed query multiplex upstream failed');
    expect(generatedSource).toContain('startApplicationOpenTelemetryRuntime');
    expect(generatedSource).toContain('service: process.env.APPLIK8S_SERVICE_NAME ?? "query-gateway:administration"');
    expect(generatedSource).toContain("kind: 'http', identity: 'query-gateway.request'");
    expect(generatedSource).toContain('decodeApplicationTelemetryCarrier(request.headers.get(applicationTelemetryCarrierHeaderName))');
    expect(generatedSource).toContain("kind: 'query', identity: query, definition: operation");
    expect(generatedSource).toContain('closeApplicationTelemetryRuntime()');
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
          { name: 'APPLIK8S_APPLICATION_NAME', value: 'reactive-test' },
          { name: 'APPLIK8S_NAMESPACE', value: '${schema.spec.namespace}' },
          expect.objectContaining({ name: expect.stringMatching(/^APPLIK8S_KUBERNETES_QUERY_/), value: '${schema.spec.namespace}' }),
        ]) })],
      } } },
    });
  }, 120_000);

  it('hydrates admitted context only inside generated server-side stream processors', async () => {
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
		const workflowProvider = { id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable', interface: 'WorkflowEngine', implementation: 'hatchet', config: { name: 'logical-workflow-provider', namespace: 'catalog', provision: true, tls: false } } as const;
		const inspectTask = { id: 'task.cards.inspect.v1', kind: 'task', name: 'cards.inspect.v1', stability: 'stable', contract: { name: 'cards.inspect', version: 'v1', input: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), output: schema({ type: 'object', properties: { accepted: { type: 'boolean' } }, required: ['accepted'] }), errors: [] } } as const;
    const processor = {
      id: 'streamProcessor.card-timeline', kind: 'streamProcessor', name: 'card-timeline', stability: 'stable',
      enabled: false,
      source: { nodeId: stream.id }, database, delivery: 'at-least-once', invocation: 'event', checkpoint: 'postgres', idempotency: 'source-event-id', failure: 'pause',
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
    expect(source).toContain('APPLIK8S_PROCESSOR_CONCURRENCY');
    expect(source).toMatch(/includeTrustedContext:(?:true|!0)/);
    expect(source).toContain('.trustedContext.tenantId');
    expect(source).toContain('.principal?.id');
		expect(generatedSource).toContain('workflowRuntime.run');
		expect(generatedSource).toContain('function mergeProcessorBindings(...sources)');
		expect(generatedSource.match(/function mergeProcessorBindings\(\.\.\.sources\)/gu)).toHaveLength(1);
		expect(generatedSource).toContain('context.idempotencyKey');
		expect(generatedSource).toContain("causationId: event?.id ?? context.batch?.id");
		expect(generatedSource).toContain("changeScopes: event.changeScopes");
		expect(generatedSource).toContain(
			'applicationCausalPrincipalContext(context.principal)',
		);
		expect(generatedSource).toContain(
			'[applicationWorkflowCausalPrincipalMetadata]: causalPrincipal',
		);
		expect(generatedSource).toContain('signal: context.signal');
		expect(generatedSource).toContain('timeoutMs: 2000');
		expect(generatedSource).not.toContain('result?.signal');
		expect(generatedSource).not.toContain('metadata?.causationId');
		expect(source).toContain('tasks.inspect');
		expect(generatedSource).toContain("return validateWorkflowValue");
		expect(generatedSource).toContain("output, name, 'output'");
		expect(artifact?.resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({ spec: { template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
			{ name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'hatchet-client-config', key: 'HATCHET_CLIENT_TOKEN' } } },
			{ name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' },
			{ name: 'HATCHET_CLIENT_HOST_PORT', value: 'hatchet-engine.catalog.svc:7070' },
			{ name: 'HATCHET_CLIENT_API_URL', value: 'http://hatchet-api.catalog.svc:8080' },
		]), volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }] })], volumes: [{
			name: 'workflow-token',
			secret: { secretName: 'hatchet-client-config', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] },
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
							secret: { secretName: 'hatchet-client-config', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] },
						}],
					},
        },
      },
    });
    expect(JSON.stringify((consolidatedDeployment?.spec?.template as { readonly metadata?: unknown } | undefined)?.metadata))
      .not.toContain('applik8s.dev/include-when');
  }, 120_000);

  it('bundles a durable PostgreSQL-to-ClickHouse projection and fails closed on unresolved callbacks', async () => {
    const provider = { id: 'provider.analytical-database', kind: 'provider', name: 'AnalyticalDatabase', stability: 'stable', interface: 'AnalyticalDatabase', implementation: 'clickhouse', contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: 'AnalyticalDatabase', version: 'v1alpha1', requirements: [], guarantees: [], implementation: { name: 'clickhouse' }, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }, config: { namespace: 'catalog', endpoint: 'http://clickhouse.catalog.svc:8123', database: 'analytics' } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => { throw new Error("projection-stream-authorization-proof"); }' } as const;
    const projection = { id: 'projection.cards', kind: 'projection', name: 'cards', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'AnalyticalDatabase', nodeId: provider.id }, rebuildable: true, checkpoint: 'idempotent', output: schema({ type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload' } as const;
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
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'projection.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('const createSource = () => createPostgresApplicationStream');
    expect(generated).toContain('await source.close().catch(() => undefined)');
    expect(generated).toContain('lastSuccessfulCycleAt');
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
    const generated = await readFile(
      join(dirname(artifact?.sourcePath ?? ''), 'projection.generated.ts'),
      'utf8',
    );
    expect(generated).toContain('const createSource = () => createPostgresApplicationStream');
    expect(generated).toContain('await source.close().catch(() => undefined)');
    expect(generated).toContain('lastSuccessfulCycleAt');
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
    const provider = { id: 'provider.analytical-database', kind: 'provider', name: 'AnalyticalDatabase', stability: 'stable', interface: 'AnalyticalDatabase', implementation: 'clickhouse', config: { name: 'catalog-analytics', namespace: 'catalog', database: 'analytics', enabled: false, credentialsSecret: { name: 'catalog-clickhouse', namespace: 'catalog' } } } as const;
    const model = { id: 'model.card', kind: 'model', name: 'Card', stability: 'stable', native: { artifact: { name: 'cards' } }, runtime: { name: 'Card', tableName: 'cards', provider: 'postgres', database: 'catalog', clusterName: 'catalog', secretName: 'catalog-app', secretKey: 'uri', secretNamespace: 'catalog', connectionEnvName: 'APPLIK8S_DATABASE_CATALOG_URL', constraints: [], indexes: [], retention: { mode: 'retain' } } } as const;
    const stream = { id: 'stream.cards.changed.v1', kind: 'stream', name: 'cards.changed', version: 'v1', stability: 'stable', payload: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), authority: 'postgres-outbox', delivery: 'at-least-once', replay: 'supported', retention: { maxAgeSeconds: 3600 }, partitioning: 'declared', compatibility: 'versioned-schema', authorization: 'application-defined', database, partitionSource: '(payload) => payload.cardId', authorizationSource: '() => true' } as const;
    const projection = { id: 'projection.card-analytics', kind: 'projection', name: 'card-analytics', stability: 'stable', source: { nodeId: stream.id }, provider: { interface: 'AnalyticalDatabase', nodeId: provider.id }, storage: 'analytical', rebuildable: true, checkpoint: 'idempotent', output: schema({ type: 'object', properties: { cardId: { type: 'string' }, score: { type: 'number' } }, required: ['cardId', 'score'] }), eventIdentity: 'stable-source-event-id', duplicateHandling: 'idempotent', rebuild: 'full-replay', handlerSource: '(payload) => payload' } as const;
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

    const profileAndTargetProvider = {
      ...provider,
      implementation: 'application-provider-selection',
      config: {
        analyticalDatabase: {
          kind: 'application-provider-selection',
          selector: 'schema.spec.profile',
          cases: {
            dedicated: {
              kind: 'application-target-provider-selection',
              targets: {
                local: { kind: 'clickhouse', name: 'local-analytics' },
                aws: { kind: 'postgres-analytics' },
                kubernetes: { kind: 'clickhouse', name: 'cluster-analytics', namespace: 'catalog', database: 'history' },
              },
            },
          },
          default: {
            kind: 'application-target-provider-selection',
            targets: {
              local: { kind: 'clickhouse', name: 'local-analytics' },
              aws: { kind: 'postgres-analytics' },
              kubernetes: { kind: 'clickhouse', name: 'starter-analytics', namespace: 'catalog', database: 'history' },
            },
          },
        },
      },
    } as const;
    const profileAndTargetArtifacts = await emitGeneratedApplicationReactive({
      graph: reactiveGraph([profileAndTargetProvider, model, stream, projection, query, gateway] as unknown as ApplicationGraphNode[]),
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-profile-target-analytical-query-')),
      entrypoint: import.meta.filename,
    });
    const profileAndTargetDeployment = profileAndTargetArtifacts.find((artifact) => artifact.kind === 'queryGateway')?.resources.find((resource) => resource.kind === 'Deployment');
    const serializedProfileAndTargetDeployment = JSON.stringify(profileAndTargetDeployment);
    expect(serializedProfileAndTargetDeployment).toContain('cluster-analytics');
    expect(serializedProfileAndTargetDeployment).toContain('starter-analytics');
    expect(serializedProfileAndTargetDeployment).not.toContain('postgres-analytics');
  });
});

async function nativeQueryFixtureGraph(): Promise<ApplicationGraph> {
  const discovered = await discoverApplicationGraph(
    new URL('./fixtures/v06-native-query-app.ts', import.meta.url).pathname,
    'nativeQueryApplication',
  );
  if (!discovered.ok) {
    throw new Error(
      `Native query fixture did not expose its ApplicationGraph: ${discovered.error.message}`,
    );
  }
  return discovered.value;
}

function schema(jsonSchema: JsonObject) { return { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema }; }
function reactiveGraph(nodes: readonly ApplicationGraphNode[]): ApplicationGraph { return { apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'reactive-test', namespace: 'catalog' }, nodes, edges: [], providerRequirements: [], providerBindings: [], compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] } }; }
