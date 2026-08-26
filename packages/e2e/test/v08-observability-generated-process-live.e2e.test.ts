// typecast-file-boundary: Live PostgreSQL, NATS, generated-process, and OTLP
// payloads are narrowed at their authoritative protocol boundaries below.
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  ApplicationGraph,
  ApplicationModelNode,
} from '@applik8s/core';
import { build } from 'esbuild';
import {
  AckPolicy,
  connect,
  RetentionPolicy,
  StorageType,
} from 'nats';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationRuntimeModelContract } from '../../applik8s/src/application-models.js';
import { generatedApplicationFetchGatewayModules } from '../../compiler/src/application-fetch-gateway/index.js';
import { emitGeneratedApplicationLakehousePublishers } from '../../compiler/src/application-lakehouse-publishers/index.js';
import { emitGeneratedApplicationMigrations } from '../../compiler/src/application-migrations/index.js';
import { emitGeneratedApplicationProcessors } from '../../compiler/src/application-processors/index.js';
import { emitGeneratedApplicationReactive } from '../../compiler/src/application-reactive/index.js';
import { applik8sWorkspaceSourcePlugin } from '../../compiler/src/bundling/index.js';
import { discoverApplicationGraphWithExports } from '../../compiler/src/pipeline/index.js';
import { applicationRuntimeEndpointEnvironmentName } from '../../deployment-contract/src/runtime-artifact.js';

const databaseUrl = process.env.APPLIK8S_V08_OBSERVABILITY_PROCESS_DATABASE_URL;
const natsUrl = process.env.APPLIK8S_V08_OBSERVABILITY_PROCESS_NATS_URL;
const fixture = new URL(
  './fixtures/v08-observability-generated-process/app.ts',
  import.meta.url,
).pathname;
const execFileAsync = promisify(execFile);

describe('v0.8 generated process observability chain', () => {
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopProcess(child, 'SIGKILL')));
    children.clear();
  });

  it.skipIf(!databaseUrl || !natsUrl)(
    'links front-gateway queries, model/outbox, JetStream retry, process restart, cancellation, and one lakehouse effect',
    async () => {
      const selectedDatabaseUrl = databaseUrl;
      const selectedNatsUrl = natsUrl;
      if (!selectedDatabaseUrl || !selectedNatsUrl) {
        throw new Error('Generated process live evidence requires PostgreSQL and NATS endpoints.');
      }
      const suffix = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const organizationId = '00000000-0000-0000-0000-000000000801';
      const observationId = '10000000-0000-0000-0000-000000000801';
      const stream = `V08_OBSERVABILITY_${suffix.replaceAll('-', '_').toUpperCase()}`;
      // Consumer filters are compiled from the provider contract. The stream
      // itself is uniquely named for isolation, while its subject prefix must
      // remain the exact compiled provider value used by every generated role.
      const subjectPrefix = 'applik8s';
      const sensitiveSegment = `credential-private-terminal-${suffix}`;
      const root = join(tmpdir(), sensitiveSegment);
      const displacedRoot = `${root}.displaced`;
      const generatedRoot = join(process.cwd(), '.applik8s-tmp');
      await mkdir(generatedRoot, { recursive: true });
      // The generated local publisher deliberately externalizes DuckDB's native
      // bindings. Keep the ephemeral source beneath the workspace so ordinary
      // Node package resolution reaches this clean checkout's node_modules.
      const outDir = await mkdtemp(join(generatedRoot, 'v08-observed-process-'));
      const collector = await startOtlpReceiver();
      const sql = postgres(selectedDatabaseUrl, {
        max: 6,
        idle_timeout: 5,
        connect_timeout: 5,
        prepare: false,
        onnotice: () => undefined,
      });
      const nats = await connect({ servers: [selectedNatsUrl] });
      const manager = await nats.jetstreamManager();
      let graph: ApplicationGraph | undefined;
      let model: ApplicationRuntimeModelContract | undefined;
      let commandProcessorName = '';
      let commandBindingName = '';
      let publisherName = '';
      let sourceEventId = '';
      const outputs: Array<() => string> = [];

      process.env.APPLIK8S_V08_OBSERVABILITY_LAKEHOUSE_ROOT = root;
      try {
        const discovered = await discoverApplicationGraphWithExports(
          fixture,
          'v08ObservabilityGeneratedProcess',
        );
        expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
        if (!discovered.ok) return;
        graph = discovered.value.graph;
        expect(JSON.stringify(graph)).toContain(root);
        const createHandler = graph.nodes.find(
          (node) => node.kind === 'commandHandler'
            && node.command.nodeId === 'command.models.observation.create.v1',
        );
        if (!createHandler) throw new Error('Observed process graph has no generated Observation.create handler.');
        commandBindingName = createHandler.name;
        const modelNode = graph.nodes.find(
          (node): node is ApplicationModelNode =>
            node.kind === 'model' && node.name === 'Observation',
        );
        if (!modelNode?.runtime) throw new Error('Observed process graph has no Observation model runtime.');
        model = modelNode.runtime;
        const [migration] = await emitGeneratedApplicationMigrations({
          graph,
          entrypoint: fixture,
          outDir: join(outDir, 'migrations'),
        });
        if (!migration) throw new Error('Observed process graph emitted no native migration artifact.');
        await execFileAsync(
          'psql',
          [selectedDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', migration.sourcePath],
          { env: process.env },
        );

        const [gateway] = (await emitGeneratedApplicationReactive({
          graph,
          outDir: join(outDir, 'reactive'),
          entrypoint: fixture,
          executionTarget: 'local',
        })).filter((artifact) => artifact.kind === 'queryGateway');
        const [commandProcessor] = await emitGeneratedApplicationProcessors({
          graph,
          outDir: join(outDir, 'processors'),
          entrypoint: fixture,
          executionTarget: 'local',
        });
        const [publisher] = await emitGeneratedApplicationLakehousePublishers({
          graph,
          outDir: join(outDir, 'lakehouse'),
          executionTarget: 'local',
        });
        if (!gateway || !commandProcessor || !publisher) {
          throw new Error('Observed process graph did not emit its gateway, command processor, and lakehouse publisher.');
        }
        const frontGatewaySourcePath = await emitGeneratedFetchGatewayProcess(
          graph,
          join(outDir, 'front-gateway'),
        );
        const remoteGatewayEndpointEnvironment = applicationRuntimeEndpointEnvironmentName(
          gateway.nodeId,
        );
        commandProcessorName = commandProcessor.name;
        publisherName = publisher.name;
        const commandFilters = consumerFilters(commandProcessor.resources);

        await manager.streams.add({
          name: stream,
          subjects: [`${subjectPrefix}.>`],
          retention: RetentionPolicy.Limits,
          storage: StorageType.Memory,
          max_msgs: 10_000,
          max_age: 3_600_000_000_000,
          duplicate_window: 120_000_000_000,
        });
        await addConsumer(
          manager,
          stream,
          commandProcessorName,
          commandFilters,
          30_000_000_000,
        );
        await addConsumer(
          manager,
          stream,
          publisherName,
          consumerFilters(publisher.resources),
          60_000_000_000,
        );

        const commonEnvironment = {
          APPLIK8S_APPLICATION_NAME: graph.metadata.name,
          APPLIK8S_DEPLOYMENT_TARGET: 'local',
          APPLIK8S_ENVIRONMENT_ID: 'generated-process-live',
          APPLIK8S_NAMESPACE: graph.metadata.namespace as string,
          APPLIK8S_NATS_SERVERS: JSON.stringify([selectedNatsUrl]),
          APPLIK8S_NATS_STREAM: stream,
          APPLIK8S_NATS_SUBJECT_PREFIX: subjectPrefix,
          APPLIK8S_EVENT_TRANSPORT: 'nats',
          APPLIK8S_EVENT_LOG_PROVIDER: 'nats-jetstream',
          APPLIK8S_CURSOR_SECRET: 'cursor-key-v08-observability-process'.repeat(2),
          APPLIK8S_CONTEXT_SECRET: 'context-key-v08-observability-process'.repeat(2),
          APPLIK8S_INTERNAL_OPERATION_SECRET: 'operation-key-v08-observability-process'.repeat(2),
          APPLIK8S_PROCESSOR_CONCURRENCY: '1',
          APPLIK8S_CURSOR_SECRET_OBSERVATION_HISTORY: 'lakehouse-key-v08-observability-process'.repeat(2),
          DATABASE_URL: selectedDatabaseUrl,
          [model.connectionEnvName]: selectedDatabaseUrl,
          OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint,
        };

        const command = startProcess(commandProcessor.sourcePath, commonEnvironment);
        children.add(command.child);
        outputs.push(command.output);
        await waitForConsumer(manager, stream, commandProcessorName, command);

        const firstPublisher = startProcess(
          publisher.localSourcePath,
          commonEnvironment,
        );
        children.add(firstPublisher.child);
        outputs.push(firstPublisher.output);
        let datasetRoot = '';
        // DuckDB may create its database file lazily, but the provider creates
        // its hashed private dataset directory and objects subdirectory only
        // after the runtime is initialized. Resolve the provider-owned identity
        // from that durable structure instead of duplicating its private hash
        // algorithm in the test.
        await waitFor(async () => {
          const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
          const candidates = entries.filter((entry) => entry.isDirectory());
          if (candidates.length !== 1 || !candidates[0]) return false;
          const candidate = join(root, candidates[0].name);
          const ready = await access(join(candidate, 'objects')).then(() => true).catch(() => false);
          if (ready) datasetRoot = candidate;
          return ready;
        }, firstPublisher);
        if (!datasetRoot) throw new Error('DuckDB dataset runtime did not publish its private root.');
        await waitForConsumer(manager, stream, publisherName, firstPublisher);

        await rename(datasetRoot, displacedRoot);
        await writeFile(datasetRoot, 'intentionally blocks the first durable publication attempt');

        const gatewayPort = await availablePort();
        let gatewayProcess = startProcess(gateway.sourcePath, {
          ...commonEnvironment,
          APPLIK8S_HTTP_PORT: String(gatewayPort),
        });
        children.add(gatewayProcess.child);
        outputs.push(gatewayProcess.output);
        const endpoint = `http://127.0.0.1:${gatewayPort}`;
        await waitForHttp(`${endpoint}/ready`, gatewayProcess);

        const frontGatewayPort = await availablePort();
        const frontGateway = startProcess(frontGatewaySourcePath, {
          ...commonEnvironment,
          APPLIK8S_HTTP_PORT: String(frontGatewayPort),
          [remoteGatewayEndpointEnvironment]: endpoint,
        });
        children.add(frontGateway.child);
        outputs.push(frontGateway.output);
        const publicEndpoint = `http://127.0.0.1:${frontGatewayPort}/__applik8s/v1`;
        await waitForHttp(
          `http://127.0.0.1:${frontGatewayPort}/ready`,
          frontGateway,
        );

        const operation = 'models.Observation.create.v1';
        const submissionId = `v08-observed-${suffix}`;
        const submission = await postJson(
          `${endpoint}/commands/${operation}/submit`,
          {
            input: {
              id: observationId,
              organizationId,
              label: 'one durable effect',
            },
            commandId: submissionId,
            idempotencyKey: submissionId,
          },
          identityHeaders(organizationId),
        );
        const completed = await waitForCommand(
          endpoint,
          operation,
          stringField(submission, 'progressCursor'),
          organizationId,
          command,
          async () => {
            const streamInfo = await manager.streams.info(stream);
            const consumerInfo = await manager.consumers.info(
              stream,
              commandProcessorName,
            );
            const subjects: string[] = [];
            for (
              let sequence = streamInfo.state.first_seq;
              sequence <= streamInfo.state.last_seq;
              sequence += 1
            ) {
              const message = await manager.streams
                .getMessage(stream, { seq: sequence })
                .catch(() => undefined);
              if (message) subjects.push(message.subject);
            }
            return JSON.stringify({ commandFilters, consumerInfo, subjects });
          },
        );
        expect(completed).toMatchObject({
          durableResult: 'succeeded',
          modelRevision: expect.any(String),
        });

        await waitFor(
          async () => firstPublisher.output().includes('"event":"applik8s-event-retry"'),
          firstPublisher,
        );
        expect(firstPublisher.output()).toContain('"attempt":1');
        expect(firstPublisher.output()).toMatch(/"errorType":"[A-Za-z][A-Za-z0-9_.-]*"/u);
        expect(firstPublisher.output()).not.toContain('"error":');
        expect(firstPublisher.output()).not.toContain(sensitiveSegment);
        expect(await stopProcess(firstPublisher.child, 'SIGTERM')).toBe(true);
        children.delete(firstPublisher.child);

        await rm(datasetRoot, { force: true });
        await rename(displacedRoot, datasetRoot);

        const secondPublisher = startProcess(
          publisher.localSourcePath,
          commonEnvironment,
        );
        children.add(secondPublisher.child);
        outputs.push(secondPublisher.output);
        await waitFor(
          async () => secondPublisher.output().includes('"event":"applik8s-event-consumed"'),
          secondPublisher,
        );
        expect(secondPublisher.output()).toContain('"attempt":2');
        expect(await stopProcess(secondPublisher.child, 'SIGTERM')).toBe(true);
        children.delete(secondPublisher.child);

        const authority = jsonObject(await readFile(join(datasetRoot, 'authority.json'), 'utf8'));
        const manifests = arrayField(authority, 'manifests');
        expect(manifests).toHaveLength(1);
        const manifest = objectValue(manifests[0]);
        const frontier = arrayField(manifest, 'frontier');
        expect(frontier).toHaveLength(1);
        if (typeof frontier[0] !== 'string' || !frontier[0]) {
          throw new Error(`Expected one non-empty string lakehouse frontier: ${JSON.stringify(frontier)}`);
        }
        sourceEventId = frontier[0];
        expect(arrayField(manifest, 'objects')).toHaveLength(1);

        const thirdPublisher = startProcess(
          publisher.localSourcePath,
          commonEnvironment,
        );
        children.add(thirdPublisher.child);
        outputs.push(thirdPublisher.output);
        await waitForConsumer(manager, stream, publisherName, thirdPublisher);
        await delay(750);
        expect(thirdPublisher.output()).not.toContain('applik8s-event-consumed');
        expect(await stopProcess(thirdPublisher.child, 'SIGTERM')).toBe(true);
        children.delete(thirdPublisher.child);

        const query = 'observations.for-organization.v1';
        const queryInput = { organizationId };
        const firstSnapshot = await postJson(
          `${publicEndpoint}/queries/${query}/snapshot`,
          { input: queryInput },
          {
            ...identityHeaders(organizationId),
            'x-applik8s-telemetry': `malformed-private-carrier-${suffix}`,
          },
        );
        expect(firstSnapshot).toMatchObject({
          kind: 'snapshot',
          query,
          value: [expect.objectContaining({ id: observationId, organizationId })],
        });

        expect(await stopProcess(gatewayProcess.child, 'SIGTERM')).toBe(true);
        children.delete(gatewayProcess.child);
        gatewayProcess = startProcess(gateway.sourcePath, {
          ...commonEnvironment,
          APPLIK8S_HTTP_PORT: String(gatewayPort),
        });
        children.add(gatewayProcess.child);
        outputs.push(gatewayProcess.output);
        await waitForHttp(`${endpoint}/ready`, gatewayProcess);
        const restartedSnapshot = await postJson(
          `${publicEndpoint}/queries/${query}/snapshot`,
          { input: queryInput },
          identityHeaders(organizationId),
        );
        expect(restartedSnapshot).toMatchObject({
          kind: 'snapshot',
          query,
          value: [expect.objectContaining({ id: observationId, organizationId })],
        });

        const multiplexController = new AbortController();
        const multiplexRequest = fetch(`${publicEndpoint}/queries/multiplex`, {
          method: 'POST',
          headers: identityHeaders(organizationId),
          body: JSON.stringify({
            subscriptions: [{
              id: 'observations',
              query,
              input: queryInput,
              cursor: stringField(restartedSnapshot, 'cursor'),
            }],
          }),
          signal: multiplexController.signal,
        });
        await delay(250);
        multiplexController.abort();
        const multiplexResult = await multiplexRequest.then(
          (response) => ({ response }),
          (error: unknown) => ({ error }),
        );
        if ('response' in multiplexResult) {
          expect(
            multiplexResult.response.status,
            await multiplexResult.response.clone().text(),
          ).toBe(200);
          expect(multiplexResult.response.headers.get('content-type')).toContain(
            'text/event-stream',
          );
          await multiplexResult.response.body?.cancel().catch(() => undefined);
        } else {
          expect(objectValue(multiplexResult.error).name).toBe('AbortError');
        }
        await delay(100);

        const afterCancellation = await postJson(
          `${publicEndpoint}/queries/${query}/snapshot`,
          { input: queryInput },
          identityHeaders(organizationId),
        );
        expect(afterCancellation).toMatchObject({
          kind: 'snapshot',
          query,
          value: [expect.objectContaining({ id: observationId, organizationId })],
        });
        expect(frontGateway.output()).not.toContain('query multiplex upstream failure');

        expect(await stopProcess(gatewayProcess.child, 'SIGTERM')).toBe(true);
        children.delete(gatewayProcess.child);
        expect(await stopProcess(frontGateway.child, 'SIGTERM')).toBe(true);
        children.delete(frontGateway.child);
        expect(await stopProcess(command.child, 'SIGTERM')).toBe(true);
        children.delete(command.child);
        await collector.waitForTraces();

        const activeModel = model;
        if (!activeModel) throw new Error('Observed process model runtime was unavailable during verification.');
        const accessBinding = activeModel.nativeRelational?.access;
        if (!accessBinding) throw new Error('Observed process model lost its native PostgreSQL access binding.');
        const counts = await sql.begin(async (transaction) => {
          await transaction.unsafe(
            'SELECT set_config($1, $2, true)',
            [accessBinding.setting, organizationId],
          );
          const [row] = await transaction.unsafe(
            `SELECT
               (SELECT count(*)::int FROM ${quoteIdentifier(activeModel.tableName)} WHERE id = $1) AS models,
               (SELECT count(*)::int FROM applik8s_event_outbox WHERE contract_name = 'observations.created' AND contract_version = 'v1') AS outbox`,
            [observationId],
          );
          return row;
        });
        expect({
          models: Number(counts?.models),
          outbox: Number(counts?.outbox),
        }).toEqual({ models: 1, outbox: 1 });

        const spans = collector.spans();
        const modelSpans = spans.filter((span) =>
          attribute(span, 'applik8s.boundary.kind') === 'model'
          && attribute(span, 'applik8s.operation') === commandBindingName);
        const eventSpans = spans.filter((span) =>
          attribute(span, 'applik8s.boundary.kind') === 'event'
          && attribute(span, 'applik8s.execution') === `event:${publisherName}:${sourceEventId}`);
        const querySpans = spans.filter((span) =>
          attribute(span, 'applik8s.boundary.kind') === 'query'
          && attribute(span, 'applik8s.operation') === query);
        const spanSummary = spans.map((span) => ({
          name: span.name,
          kind: attribute(span, 'applik8s.boundary.kind'),
          operation: attribute(span, 'applik8s.operation'),
          execution: attribute(span, 'applik8s.execution'),
          attempt: attribute(span, 'applik8s.attempt'),
        }));
        expect(modelSpans, JSON.stringify(spanSummary)).toHaveLength(1);
        expect(eventSpans).toHaveLength(2);
        expect(querySpans.length).toBeGreaterThanOrEqual(4);
        expect(new Set(querySpans.map((span) => span.traceId)).size).toBeGreaterThanOrEqual(4);
        for (const querySpan of querySpans) {
          expect(spans.some((span) =>
            span.traceId === querySpan.traceId
            && attribute(span, 'applik8s.boundary.kind') === 'http'),
          JSON.stringify(spanSummary)).toBe(true);
        }
        expect(eventSpans.map((span) => Number(attribute(span, 'applik8s.attempt')))).toEqual([1, 2]);
        expect(eventSpans.map((span) => attribute(span, 'applik8s.invocation.kind'))).toEqual(['live', 'retry']);
        expect(new Set(eventSpans.map((span) => attribute(span, 'applik8s.execution')))).toEqual(
          new Set([`event:${publisherName}:${sourceEventId}`]),
        );
        const producer = modelSpans[0];
        if (!producer) throw new Error('Model telemetry was not exported.');
        for (const eventSpan of eventSpans) {
          expect(eventSpan.links).toEqual(expect.arrayContaining([
            expect.objectContaining({
              traceId: producer.traceId,
              spanId: producer.spanId,
            }),
          ]));
        }
        const exported = JSON.stringify(collector.payloads());
        expect(exported).not.toContain(sensitiveSegment);
        expect(exported).not.toContain(`malformed-private-carrier-${suffix}`);
        expect(outputs.map((output) => output()).join('\n')).not.toContain(sensitiveSegment);
      } finally {
        delete process.env.APPLIK8S_V08_OBSERVABILITY_LAKEHOUSE_ROOT;
        await Promise.all([...children].map((child) => stopProcess(child, 'SIGKILL')));
        children.clear();
        if (graph && commandProcessorName) {
          await manager.consumers.delete(stream, commandProcessorName).catch(() => undefined);
        }
        if (graph && publisherName) {
          await manager.consumers.delete(stream, publisherName).catch(() => undefined);
        }
        await manager.streams.delete(stream).catch(() => undefined);
        await nats.drain().catch(() => undefined);
        if (model) {
          await sql.unsafe('DELETE FROM applik8s_command_inbox WHERE binding_id LIKE $1', ['Observation-%']).catch(() => undefined);
          await sql.unsafe("DELETE FROM applik8s_event_outbox WHERE contract_name = 'observations.created' AND contract_version = 'v1'").catch(() => undefined);
          await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(model.tableName)}`).catch(() => undefined);
        }
        await sql.end({ timeout: 5 }).catch(() => undefined);
        await collector.close();
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
        await rm(displacedRoot, { recursive: true, force: true }).catch(() => undefined);
        await rm(outDir, { recursive: true, force: true });
      }
    },
    300_000,
  );
});

interface ProcessHandle {
  readonly child: ChildProcess;
  readonly output: () => string;
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly name?: string;
  readonly attributes?: readonly OtlpAttribute[];
  readonly links?: readonly { readonly traceId?: string; readonly spanId?: string }[];
}

interface OtlpAttribute {
  readonly key?: string;
  readonly value?: Readonly<Record<string, unknown>>;
}

interface OtlpReceiver {
  readonly endpoint: string;
  payloads(): readonly unknown[];
  spans(): readonly OtlpSpan[];
  waitForTraces(): Promise<void>;
  close(): Promise<void>;
}

async function emitGeneratedFetchGatewayProcess(
  graph: ApplicationGraph,
  directory: string,
): Promise<string> {
  // This receipt qualifies the remotely owned relational gateway. The
  // separately qualified publisher owns the local dataset process in this
  // fixture, so do not start a second DuckDB authority in the front gateway.
  const gatewayGraph = {
    ...graph,
    nodes: graph.nodes.filter((node) => node.kind !== 'lakehousePublication'),
  };
  const generated = generatedApplicationFetchGatewayModules(gatewayGraph);
  if (!generated) {
    throw new Error('Observed process graph emitted no application-host Fetch gateway.');
  }
  await Promise.all(Object.entries(generated.files).map(async ([path, source]) => {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }));
  const entrypoint = join(directory, 'process.generated.ts');
  const sourcePath = join(directory, 'runtime.mjs');
  await writeFile(entrypoint, generatedFetchGatewayProcessSource());
  await build({
    entryPoints: [entrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    keepNames: true,
    legalComments: 'none',
    nodePaths: [join(process.cwd(), 'node_modules')],
    external: [
      '@duckdb/node-api',
      '@duckdb/node-bindings',
      '@duckdb/node-bindings-*',
    ],
    plugins: [applik8sWorkspaceSourcePlugin()],
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
  });
  return sourcePath;
}

function generatedFetchGatewayProcessSource(): string {
  return `import { createServer } from 'node:http';
import { closeApplik8sGateway, handleApplik8sRequest } from './gateway.generated.js';

const maximumBodyBytes = 1_048_576;
let stopping = false;

const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Application-host request disconnected.'));
  incoming.once('aborted', abort);
  outgoing.once('close', abort);
  try {
    const request = await webRequest(incoming, controller.signal);
    const url = new URL(request.url);
    if (url.pathname === '/live') url.pathname = '/__applik8s/v1/healthz';
    if (url.pathname === '/ready') url.pathname = '/__applik8s/v1/readyz';
    await writeWebResponse(outgoing, await handleApplik8sRequest(new Request(url, request)));
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Applik8s application-host request failed', error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'application_host_failed' }));
    }
  } finally {
    incoming.removeListener('aborted', abort);
    outgoing.removeListener('close', abort);
  }
});

server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? '8080'), '127.0.0.1');

async function webRequest(incoming, signal) {
  const chunks = [];
  let size = 0;
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > maximumBodyBytes) throw new Error('Application-host request body exceeds 1 MiB.');
      chunks.push(chunk);
    }
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request('http://' + (incoming.headers.host ?? 'localhost') + (incoming.url ?? '/'), {
    method: incoming.method,
    headers: Object.entries(incoming.headers).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => [key, item]) : value === undefined ? [] : [[key, value]]),
    signal,
    ...(body ? { body, duplex: 'half' } : {}),
  });
}

async function writeWebResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!outgoing.write(Buffer.from(value))) {
      await new Promise((resolve) => outgoing.once('drain', resolve));
    }
  }
  outgoing.end();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => server.closeAllConnections?.(), 15_000);
  force.unref?.();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(force);
  await closeApplik8sGateway();
}

process.once('SIGTERM', () => { void shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { void shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
`;
}

function startProcess(
  sourcePath: string,
  environment: Readonly<Record<string, string>>,
): ProcessHandle {
  let output = '';
  const child = spawn(process.execPath, [sourcePath], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  return { child, output: () => output };
}

async function stopProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill(signal);
  const stopped = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    delay(15_000).then(() => false),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return true;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return false;
}

async function addConsumer(
  manager: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>['jetstreamManager']>>,
  stream: string,
  durableName: string,
  filters: readonly string[],
  ackWait: number,
): Promise<void> {
  if (filters.length === 0) throw new Error(`Generated consumer ${durableName} has no subjects.`);
  await manager.consumers.add(stream, {
    durable_name: durableName,
    ack_policy: AckPolicy.Explicit,
    ack_wait: ackWait,
    max_deliver: 5,
    max_ack_pending: 16,
    filter_subjects: [...filters],
  });
}

function consumerFilters(
  resources: readonly { readonly kind: string; readonly spec?: Readonly<Record<string, unknown>> }[],
): readonly string[] {
  const resource = resources.find(({ kind }) => kind === 'Consumer');
  const filters = resource?.spec?.filterSubjects;
  if (!Array.isArray(filters) || filters.some((value) => typeof value !== 'string')) {
    throw new Error('Generated Consumer has no concrete filterSubjects.');
  }
  return filters;
}

async function waitForConsumer(
  manager: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>['jetstreamManager']>>,
  stream: string,
  consumer: string,
  processHandle: ProcessHandle,
): Promise<void> {
  await waitFor(async () => {
    const info = await manager.consumers.info(stream, consumer);
    return info.num_waiting > 0;
  }, processHandle);
}

async function waitFor(
  predicate: () => Promise<boolean>,
  processHandle: ProcessHandle,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
      throw new Error(`Generated process exited before its condition became true:\n${processHandle.output()}`);
    }
    try {
      if (await predicate()) return;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for generated process. ${lastError}\n${processHandle.output()}`);
}

async function waitForHttp(url: string, processHandle: ProcessHandle): Promise<void> {
  await waitFor(async () => {
    const response = await fetch(url).catch(() => undefined);
    return response?.ok === true;
  }, processHandle);
}

async function waitForCommand(
  endpoint: string,
  command: string,
  cursor: string,
  organizationId: string,
  commandProcessor: ProcessHandle,
  diagnostics: () => Promise<string>,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    if (
      commandProcessor.child.exitCode !== null
      || commandProcessor.child.signalCode !== null
    ) {
      throw new Error(
        `Generated command processor exited while ${command} remained pending:\n${commandProcessor.output()}`,
      );
    }
    last = await postJson(
      `${endpoint}/commands/${command}/progress`,
      { cursor },
      identityHeaders(organizationId),
    );
    if (last.durableResult === 'succeeded') return last;
    if (last.durableResult === 'rejected' || last.durableResult === 'failed') {
      throw new Error(
        `Generated command terminated: ${JSON.stringify(last)}\n${commandProcessor.output()}`,
      );
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${command}: ${JSON.stringify(last)}\n${await diagnostics()}\n${commandProcessor.output()}`,
  );
}

function identityHeaders(organizationId: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-principal': organizationId,
    'x-organization': organizationId,
    'x-authorization-version': 'v1',
  };
}

async function postJson(
  url: string,
  body: object,
  headers: HeadersInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return jsonObject(text);
}

async function startOtlpReceiver(): Promise<OtlpReceiver> {
  const payloads: unknown[] = [];
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        payloads.push(body ? JSON.parse(body) : {});
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"error":"invalid-json"}');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    payloads: () => payloads,
    spans: () => payloads.flatMap(otlpSpans),
    async waitForTraces() {
      const started = Date.now();
      while (Date.now() - started < 30_000) {
        if (payloads.flatMap(otlpSpans).length > 0) return;
        await delay(50);
      }
      throw new Error('Local OTLP receiver did not observe exported traces.');
    },
    close: () => closeServer(server),
  };
}

function otlpSpans(payload: unknown): OtlpSpan[] {
  if (!payload || typeof payload !== 'object') return [];
  const resourceSpans = Reflect.get(payload, 'resourceSpans');
  if (!Array.isArray(resourceSpans)) return [];
  return resourceSpans.flatMap((resource) => {
    const scopeSpans = resource && typeof resource === 'object'
      ? Reflect.get(resource, 'scopeSpans')
      : undefined;
    if (!Array.isArray(scopeSpans)) return [];
    return scopeSpans.flatMap((scope) => {
      const spans = scope && typeof scope === 'object' ? Reflect.get(scope, 'spans') : undefined;
      return Array.isArray(spans)
        ? spans.filter((span): span is OtlpSpan => Boolean(span && typeof span === 'object'))
        : [];
    });
  });
}

function attribute(span: OtlpSpan, key: string): string | number | boolean | undefined {
  const value = span.attributes?.find((candidate) => candidate.key === key)?.value;
  if (!value) return undefined;
  for (const field of ['stringValue', 'intValue', 'doubleValue', 'boolValue'] as const) {
    const candidate = value[field];
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
      return candidate;
    }
  }
  return undefined;
}

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await closeServer(server);
  return port;
}

function closeServer(server: Server | ReturnType<typeof createNetServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function jsonObject(source: string): Record<string, unknown> {
  return objectValue(JSON.parse(source));
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected an object, received ${JSON.stringify(value)}.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const selected = value[field];
  if (typeof selected !== 'string' || !selected) {
    throw new Error(`Expected non-empty string field ${field}: ${JSON.stringify(value)}`);
  }
  return selected;
}

function arrayField(value: Record<string, unknown>, field: string): readonly unknown[] {
  const selected = value[field];
  if (!Array.isArray(selected)) {
    throw new Error(`Expected array field ${field}: ${JSON.stringify(value)}`);
  }
  return selected;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
