import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApplicationCommandHandlerNode, ApplicationCommandNode, ApplicationEventNode, ApplicationGraph, ApplicationModelNode, ApplicationOperationCatalog, ApplicationProcessorNode, ApplicationProviderNode, ApplicationStaticAuthorityManifest } from '@applik8s/core';
import { build } from 'esbuild';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { applicationGraphStringValue } from '../application-installation-values.js';
import { applicationStaticAuthorityManifest, compileApplicationOperationCatalog } from '../application-operations/index.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import { generatedProcessorCapacity, generatedProcessorDisruptionResource, generatedProcessorPodScheduling } from './capacity.js';

const DEFAULT_GENERATED_PROCESSOR_RUNTIME_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationProcessorArtifact {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationProcessorResource[];
}

export interface GeneratedApplicationProcessorResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export async function emitGeneratedApplicationProcessors(options: {
  readonly graph: ApplicationGraph;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly outDir: string;
  readonly entrypoint: string;
}): Promise<readonly GeneratedApplicationProcessorArtifact[]> {
  const operationCatalog = options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const processors = options.graph.nodes.filter((node): node is ApplicationProcessorNode => node.kind === 'processor');
  if (processors.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationProcessorArtifact[] = [];
  const emittedEventLogStreams = new Set<string>();
  for (const processor of processors) {
    const eventLogId = processor.eventLog?.nodeId ?? '';
    const ownsStream = !emittedEventLogStreams.has(eventLogId);
    if (eventLogId) emittedEventLogStreams.add(eventLogId);
    artifacts.push(await emitProcessor(options.graph, processor, operationCatalog, options.outDir, ownsStream));
  }
  return artifacts;
}

async function emitProcessor(graph: ApplicationGraph, processor: ApplicationProcessorNode, operationCatalog: ApplicationOperationCatalog, outDir: string, ownsStream: boolean): Promise<GeneratedApplicationProcessorArtifact> {
  const name = kubernetesName(processor.name);
  const processorDir = join(outDir, name);
  const generatedEntrypoint = join(processorDir, 'processor.generated.ts');
  const sourcePath = join(processorDir, 'processor.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(processorDir, 'processor.manifest.json');
  const metafilePath = join(processorDir, 'processor.esbuild-meta.json');
  await mkdir(processorDir, { recursive: true });
  const contract = processorContract(graph, processor, operationCatalog, ownsStream);
  await writeFile(generatedEntrypoint, generatedProcessorSource(contract));
  const result = await build({
    entryPoints: [generatedEntrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minify: true,
    lineLimit: 120,
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    supported: { 'template-literal': false },
    plugins: [applik8sWorkspaceSourcePlugin()],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: graph.metadata.name,
    workloadName: name,
    role: 'command-processor',
    artifactDir: processorDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/processor.mjs',
    baseImage: processor.runtimeImage ?? DEFAULT_GENERATED_PROCESSOR_RUNTIME_IMAGE,
    sourceDigest: digest,
  });
  const resources = processorResources(contract, container.image, digest);
  const manifest = {
    apiVersion: 'applik8s.processor/v1alpha1',
    kind: 'GeneratedCommandProcessor',
    metadata: { name },
    spec: {
      graph: graph.metadata.name,
      processor: processor.id,
      handlers: contract.handlers.map((handler) => handler.node.id),
      runtime: { entrypoint: sourcePath, sourceMap: sourceMapPath, digest, sizeBytes, distribution: 'ociImage', packageManagerAtStartup: false, image: container.image, baseImage: container.baseImage },
      container,
      resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })),
      guarantees: { delivery: 'atLeastOnce', authority: 'catalogReceiptAndPostgresPreCommit', acknowledgement: 'afterTransactionCommit', externalEffectsWhileLocked: 'forbidden' },
      capacity: generatedProcessorCapacity(processor),
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return { name, sourcePath, sourceMapPath, manifestPath, metafilePath, digest, sizeBytes, container, resources };
}

interface ProcessorContract {
  readonly graphName: string;
  readonly operationCatalog: ApplicationOperationCatalog;
  readonly authorityManifest?: ApplicationStaticAuthorityManifest;
  readonly processor: ApplicationProcessorNode;
  readonly provider: ApplicationProviderNode;
  readonly namespace?: string;
  readonly servers: readonly string[];
  readonly stream: string;
  readonly streamResourceName: string;
  readonly provisionStream: boolean;
  readonly streamReplicas: number;
  readonly subjectPrefix: string;
  readonly consumer: string;
  readonly connectionSecret?: { readonly name: string; readonly namespace?: string; readonly authMode: 'token' | 'userPassword'; readonly tokenKey: string; readonly userKey: string; readonly passwordKey: string };
  readonly retention: {
    readonly bindingIds: readonly string[];
    readonly auditWindowSeconds: number;
    readonly publishedOutboxWindowSeconds: number;
    readonly cleanupIntervalSeconds: number;
    readonly cleanupBatchSize: number;
  };
  readonly handlers: readonly {
    readonly node: ApplicationCommandHandlerNode;
    readonly model: ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
    readonly models: readonly (ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> })[];
    readonly command: ApplicationCommandNode['contract'];
    readonly operation: ApplicationOperationCatalog['operations'][number];
    readonly events: readonly { readonly identifier: string; readonly definition: { readonly kind: 'applik8sEvent'; readonly id: string; readonly name: string; readonly version: string }; readonly schema: ApplicationEventNode['contract']['payload']['jsonSchema'] }[];
    readonly commands: readonly { readonly identifier: string; readonly definition: { readonly kind: 'applik8sCommand'; readonly id: string; readonly name: string; readonly version: string; readonly input: object; readonly output: object; readonly errors: object }; readonly schema: ApplicationCommandNode['contract']['input']['jsonSchema'] }[];
  }[];
}

function processorContract(graph: ApplicationGraph, processor: ApplicationProcessorNode, operationCatalog: ApplicationOperationCatalog, ownsStream: boolean): ProcessorContract {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const provider = nodes.get(processor.eventLog?.nodeId ?? '');
  if (provider?.kind !== 'provider' || provider.interface !== 'EventLog') throw new Error(`Generated processor ${processor.id} requires one resolved EventLog provider node.`);
  const handlers = processor.handlers.map((reference) => {
    const node = nodes.get(reference.nodeId);
    if (node?.kind !== 'commandHandler') throw new Error(`Generated processor ${processor.id} references missing command handler ${reference.nodeId}.`);
    const model = nodes.get(node.model.nodeId);
    if (model?.kind !== 'model' || !model.runtime) throw new Error(`Generated processor ${processor.id} handler ${node.id} requires a model runtime contract.`);
    const commandNode = nodes.get(node.command.nodeId);
    if (commandNode?.kind !== 'command') throw new Error(`Generated processor ${processor.id} handler ${node.id} requires a command contract.`);
    const transportId = `${commandNode.contract.name}.${commandNode.contract.version}`;
    const operation = operationCatalog.operations.find((candidate) =>
      candidate.transports.some((transport) => transport.id === transportId));
    if (!operation) throw new Error(`Generated processor ${processor.id} command ${transportId} has no canonical operation-catalog entry.`);
    const events = (node.eventBindings ?? []).map((binding) => {
      const event = nodes.get(binding.event.nodeId);
      if (event?.kind !== 'event') throw new Error(`Generated processor ${processor.id} handler ${node.id} has an invalid event binding ${binding.identifier}.`);
      return { identifier: binding.identifier, definition: eventDefinition(event), schema: event.contract.payload.jsonSchema };
    });
    const commands = (node.commandBindings ?? []).map((binding) => {
      const emitted = nodes.get(binding.command.nodeId);
      if (emitted?.kind !== 'command') throw new Error(`Generated processor ${processor.id} handler ${node.id} has an invalid command binding ${binding.identifier}.`);
      return { identifier: binding.identifier, definition: commandDefinition(emitted), schema: emitted.contract.input.jsonSchema };
    });
    const models = node.transaction.models.map((reference) => {
      const participant = nodes.get(reference.nodeId);
      if (participant?.kind !== 'model' || !participant.runtime) throw new Error(`Generated processor ${processor.id} handler ${node.id} has an invalid transaction model ${reference.nodeId}.`);
      // typecast: the preceding graph guard proves this participant has the runtime contract required by generated execution.
      return participant as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
    });
    // typecast: the preceding runtime guard narrows the graph model more precisely than TypeScript preserves through the collection callback.
    return { node, model: model as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> }, models, command: commandNode.contract, operation, events, commands };
  });
  const authorityDatabases = new Set(handlers.map(({ model }) => model.runtime.connectionEnvName));
  if (authorityDatabases.size > 1) {
    throw new Error(`Generated processor ${processor.id} spans multiple transactional authority databases. Bind one explicit AuthorizationAuthority database before combining these handlers.`);
  }
  const config = provider.config ?? {};
  const namespace = applicationGraphStringValue(handlers[0]?.model.runtime.secretNamespace) || applicationGraphStringValue(config.namespace) || undefined;
  const serviceName = stringConfig(config.name) || 'applik8s-events';
  const configuredServers = Array.isArray(config.servers) ? config.servers.filter((value): value is string => typeof value === 'string') : [];
  const runtimeBinding = graph.providerBindings.find((binding) => graph.providerRequirements.some((requirement) => requirement.id === binding.requirement && requirement.consumer.nodeId === processor.id));
  const secretRef = runtimeBinding?.runtime.secretRefs?.[0];
  const secretNamespace = applicationGraphStringValue(secretRef?.namespace);
  const processorNamespace = namespace ?? 'default';
  if (secretNamespace && secretNamespace !== processorNamespace) {
    throw new Error(`Generated processor ${processor.id} cannot read EventLog Secret ${secretNamespace}/${secretRef?.name} from namespace ${processorNamespace}. Kubernetes Secret env references must be in the processor namespace.`);
  }
  const configuredAuthMode = stringConfig(config.authMode);
  if (configuredAuthMode && configuredAuthMode !== 'token' && configuredAuthMode !== 'userPassword') {
    throw new Error(`Generated processor ${processor.id} EventLog authMode must be token or userPassword.`);
  }
  const authMode: 'token' | 'userPassword' = configuredAuthMode === 'userPassword' ? 'userPassword' : 'token';
  const authorityManifest = applicationStaticAuthorityManifest(graph);
  return {
    graphName: graph.metadata.name,
    operationCatalog,
    ...(authorityManifest ? { authorityManifest } : {}),
    processor,
    provider,
    ...(namespace ? { namespace } : {}),
    servers: configuredServers.length > 0 ? configuredServers : [`nats://${serviceName}${applicationGraphStringValue(config.namespace) ? `.${applicationGraphStringValue(config.namespace)}` : ''}.svc:4222`],
    stream: stringConfig(config.stream) || 'APPLIK8S_EVENTS',
    streamResourceName: kubernetesName(serviceName),
    provisionStream: ownsStream && config.provision !== false,
    streamReplicas: numberConfig(config.replicas, 1),
    subjectPrefix: stringConfig(config.subjectPrefix) || 'applik8s',
    consumer: kubernetesName(processor.name),
    ...(secretRef?.name ? { connectionSecret: { name: secretRef.name, ...(secretNamespace ? { namespace: secretNamespace } : {}), authMode, tokenKey: stringConfig(config.tokenKey) || 'token', userKey: stringConfig(config.userKey) || 'user', passwordKey: stringConfig(config.passwordKey) || 'password' } } : {}),
    retention: {
      bindingIds: handlers.map((handler) => handler.node.name),
      auditWindowSeconds: Math.max(...handlers.map((handler) => handler.node.retention.auditWindowSeconds)),
      publishedOutboxWindowSeconds: Math.max(...handlers.map((handler) => handler.node.retention.publishedOutboxWindowSeconds)),
      cleanupIntervalSeconds: Math.min(...handlers.map((handler) => handler.node.retention.cleanupIntervalSeconds)),
      cleanupBatchSize: Math.max(...handlers.map((handler) => handler.node.retention.cleanupBatchSize)),
    },
    handlers,
  };
}

function generatedProcessorSource(contract: ProcessorContract): string {
  const bindingSources = contract.handlers.map((handler) => generatedBindingSource(handler)).join(',\n');
  return `
import { rm, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { canonicalApplicationCommandKey, cleanupPostgresCommandData, executePostgresModelCommand, observePostgresOutboxLag, recordPostgresModelCommandTerminalFailure, relayPostgresCommandOutbox, relayPostgresEventOutbox } from '@applik8s/applik8s/processor-runtime';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import { createJetStreamEventLog } from '@applik8s/runtime-nats/event-log';
import { startJetStreamCommandProcessor } from '@applik8s/runtime-nats/command-processor';

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function requiredIntegerEnv(name, minimum, maximum) { const value = Number(requiredEnv(name)); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum + '.'); return value; }
const eventLogServers = JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS'));
if (!Array.isArray(eventLogServers) || eventLogServers.some((server) => typeof server !== 'string' || server.length === 0)) throw new Error('APPLIK8S_NATS_SERVERS must be a JSON array of non-empty URLs.');
const processorConcurrency = requiredIntegerEnv('APPLIK8S_PROCESSOR_CONCURRENCY', 1, 64);
const operationAuthoritySql = postgres(requiredEnv('DATABASE_URL'), { max: Math.max(4, processorConcurrency + 2), idle_timeout: 20, connect_timeout: 10, prepare: false });
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(contract.graphName)},
  catalog: ${JSON.stringify(contract.operationCatalog)},
  ${contract.authorityManifest ? `authorityManifest: ${JSON.stringify(contract.authorityManifest)},` : ''}
});
await operationAuthority.prepare();

const bindings = [
${bindingSources}
];

const heartbeatPath = '/tmp/applik8s-processor-heartbeat';
await writeFile(heartbeatPath, String(Date.now()));
async function retryStartup(dependency, operation, timeoutMs = 600_000) {
  const startedAt = Date.now();
  let delayMs = 250;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) throw new Error('applik8s-processor-startup-timeout: ' + dependency + ' was not ready after ' + attempt + ' attempts', { cause: error });
      console.error(JSON.stringify({ event: 'applik8s-command-processor-startup-wait', dependency, attempt, error: error instanceof Error ? error.message : String(error) }));
      await writeFile(heartbeatPath, String(Date.now()));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(5_000, delayMs * 2);
    }
  }
}

await retryStartup('PostgreSQL', () => observePostgresOutboxLag(process.env.DATABASE_URL));
const eventLog = await retryStartup('JetStream event log', async () => {
  const candidate = createJetStreamEventLog({
    servers: eventLogServers,
    stream: ${JSON.stringify(contract.stream)},
    subjectPrefix: ${JSON.stringify(contract.subjectPrefix)},
    connectionName: ${JSON.stringify(`applik8s-${contract.consumer}-outbox`)},
    token: process.env.APPLIK8S_NATS_TOKEN,
    user: process.env.APPLIK8S_NATS_USER,
    pass: process.env.APPLIK8S_NATS_PASSWORD,
  });
  try {
    await candidate.verify();
    return candidate;
  } catch (error) {
    await candidate.drain().catch(() => undefined);
    throw error;
  }
});
const processor = await retryStartup('JetStream command consumer', () => startJetStreamCommandProcessor({
  servers: eventLogServers,
  stream: ${JSON.stringify(contract.stream)},
  consumer: ${JSON.stringify(contract.consumer)},
  subjectPrefix: ${JSON.stringify(contract.subjectPrefix)},
  bindings,
  concurrency: processorConcurrency,
  databaseUrl: process.env.DATABASE_URL,
  token: process.env.APPLIK8S_NATS_TOKEN,
  user: process.env.APPLIK8S_NATS_USER,
  pass: process.env.APPLIK8S_NATS_PASSWORD,
  logger: (record) => console.log(JSON.stringify(record)),
}));
let relayStopping = false;
let lastCleanupAt = 0;
const relayClosed = (async () => {
  while (!relayStopping) {
    try {
      const result = await relayPostgresEventOutbox({ databaseUrl: process.env.DATABASE_URL, eventLog, limit: 100 });
      if (result.published > 0) console.log(JSON.stringify({ event: 'applik8s-event-outbox-relayed', ...result }));
      const commandResult = await relayPostgresCommandOutbox({ databaseUrl: process.env.DATABASE_URL, eventLog, limit: 100 });
      if (commandResult.published > 0) console.log(JSON.stringify({ event: 'applik8s-command-outbox-relayed', ...commandResult }));
      const now = Date.now();
      if (now - lastCleanupAt >= ${contract.retention.cleanupIntervalSeconds * 1_000}) {
        const cleanup = await cleanupPostgresCommandData({ databaseUrl: process.env.DATABASE_URL, ...${JSON.stringify(contract.retention)} });
        const databaseLag = await observePostgresOutboxLag(process.env.DATABASE_URL);
        const consumerLag = await eventLog.consumerLag(${JSON.stringify(contract.consumer)});
        console.log(JSON.stringify({ event: 'applik8s-command-processor-observation', cleanup, databaseLag, consumerLag }));
        lastCleanupAt = now;
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'applik8s-event-outbox-relay-failure', error: error instanceof Error ? error.message : String(error) }));
    }
    await writeFile(heartbeatPath, String(Date.now()));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
})();
await writeFile('/tmp/applik8s-processor-ready', 'ready\\n');
await writeFile(heartbeatPath, String(Date.now()));
let draining = false;
const drain = async (signal) => {
  if (draining) return;
  draining = true;
  console.log(JSON.stringify({ event: 'applik8s-command-processor-draining', signal }));
  await rm('/tmp/applik8s-processor-ready', { force: true });
  relayStopping = true;
  await processor.drain();
  await relayClosed;
  await eventLog.drain();
  await operationAuthoritySql.end({ timeout: 5 });
};
const terminate = (signal) => {
  void drain(signal).then(
    () => process.exit(0),
    (error) => {
      console.error(JSON.stringify({ event: 'applik8s-command-processor-drain-failure', signal, error: error instanceof Error ? error.message : String(error) }));
      process.exit(1);
    },
  );
};
process.once('SIGTERM', () => terminate('SIGTERM'));
process.once('SIGINT', () => terminate('SIGINT'));
await processor.closed;
`.trimStart();
}

function generatedBindingSource(handler: ProcessorContract['handlers'][number]): string {
  const eventDeclarations = handler.events.map((event) => `const ${event.identifier} = ${JSON.stringify(event.definition)};`).join('\n      ');
  const commandDeclarations = handler.commands.map((command) => `const ${command.identifier} = ${JSON.stringify(command.definition)};`).join('\n      ');
  const outbox = handler.events.map((event) => event.identifier).join(', ');
  const commands = handler.commands.map((command) => command.identifier).join(', ');
  const keySource = handler.node.key.source;
  const idempotencySource = handler.node.idempotencyKey?.source;
  return `  {
    bindingId: ${JSON.stringify(handler.node.name)},
    contract: ${JSON.stringify(handler.command)},
    async revalidateAuthorization(receipt, boundary, delivery) {
      return operationAuthority.revalidate(
        receipt,
        boundary,
        delivery.context?.digest ?? receipt.trustedContextDigest,
      );
    },
    async execute(input, delivery) {
      ${eventDeclarations}
      ${commandDeclarations}
      const targetKey = delivery.targetKey ?? canonicalApplicationCommandKey((${keySource})(input));
      const idempotencyKey = delivery.idempotencyKey ?? ${idempotencySource ? `(${idempotencySource})(input)` : 'delivery.id'};
      return executePostgresModelCommand({
        bindingId: ${JSON.stringify(handler.node.name)},
        command: ${JSON.stringify(handler.command)},
        errors: ${JSON.stringify(handler.command.errors.map((error) => error.name))},
        schemas: ${JSON.stringify({ input: handler.command.input.jsonSchema, output: handler.command.output.jsonSchema, errors: Object.fromEntries(handler.command.errors.map((error) => [error.name, error.schema.jsonSchema])), events: Object.fromEntries(handler.events.map((event) => [event.definition.id, event.schema])), commands: Object.fromEntries(handler.commands.map((command) => [command.definition.id, command.schema])) })},
        model: ${JSON.stringify(handler.model.runtime)},
        models: ${JSON.stringify(handler.models.map((model) => model.runtime))},
        selfRead: ${String(handler.node.transaction.selfRead === true)},
        historyModels: ${JSON.stringify(handler.node.transaction.history.map((reference) => handler.models.find((model) => model.id === reference.nodeId)?.name).filter(Boolean))},
        retry: ${JSON.stringify(handler.node.retry)},
        message: { ...delivery, input, targetKey, idempotencyKey },
        history: ${String(handler.node.transaction.history.some((reference) => reference.nodeId === handler.model.id))},
        outbox: [${outbox}],
        commands: [${commands}],
        ordering: ${JSON.stringify(handler.node.ordering)},
        ${handler.node.missingRoute ? `missingRoute: ${JSON.stringify(handler.node.missingRoute)},` : ''}
        ${handler.node.initializeSource ? `initialize: (${handler.node.initializeSource}),` : ''}
        handler: (${handler.node.handlerSource}),
        revalidateAuthorization: (receipt, boundary, context) =>
          operationAuthority.revalidate(receipt, boundary, context.trustedContextDigest, context.transaction),
        databaseUrl: delivery.databaseUrl,
      });
    },
    async recordTerminalFailure(input, delivery, failure) {
      const targetKey = delivery.targetKey ?? canonicalApplicationCommandKey((${keySource})(input));
      const idempotencyKey = delivery.idempotencyKey ?? ${idempotencySource ? `(${idempotencySource})(input)` : 'delivery.id'};
      return recordPostgresModelCommandTerminalFailure({
        bindingId: ${JSON.stringify(handler.node.name)},
        command: ${JSON.stringify(handler.command)},
        model: ${JSON.stringify(handler.model.runtime)},
        message: { ...delivery, input, targetKey, idempotencyKey },
        databaseUrl: delivery.databaseUrl,
      }, failure);
    },
  }`;
}

function processorResources(contract: ProcessorContract, image: string, digest: string): readonly GeneratedApplicationProcessorResource[] {
  const labels = { 'app.kubernetes.io/name': contract.consumer, 'app.kubernetes.io/component': 'command-processor', 'app.kubernetes.io/managed-by': 'applik8s' };
  const metadata = { name: contract.consumer, ...(contract.namespace ? { namespace: contract.namespace } : {}), labels };
  const model = contract.handlers[0]?.model.runtime;
  if (!model) throw new Error(`Generated processor ${contract.processor.id} has no model runtime.`);
  const env: unknown[] = [
    { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
    { name: 'APPLIK8S_NATS_SERVERS', value: JSON.stringify(contract.servers) },
    { name: 'APPLIK8S_PROCESSOR_CONCURRENCY', value: processorEnvironmentInteger(contract.processor.deployment.concurrency) },
    { name: model.connectionEnvName, valueFrom: { secretKeyRef: { name: model.secretName, key: model.secretKey } } },
  ];
  if (model.connectionEnvName !== 'DATABASE_URL') env.push({ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: model.secretName, key: model.secretKey } } });
  if (contract.connectionSecret) {
    if (contract.connectionSecret.authMode === 'token') {
      env.push({ name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.tokenKey, optional: false } } });
    } else {
      env.push(
        { name: 'APPLIK8S_NATS_USER', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.userKey, optional: false } } },
        { name: 'APPLIK8S_NATS_PASSWORD', valueFrom: { secretKeyRef: { name: contract.connectionSecret.name, key: contract.connectionSecret.passwordKey, optional: false } } },
      );
    }
  }
  const filterSubjects = contract.handlers.map((handler) => `${contract.subjectPrefix}.commands.${subjectToken(handler.command.name)}.${subjectToken(handler.command.version)}.>`);
  const disruptionResource = generatedProcessorDisruptionResource(contract.processor, metadata, labels);
  return [
    ...(contract.provisionStream ? [{
      apiVersion: 'jetstream.nats.io/v1beta2',
      kind: 'Stream',
      metadata: { ...metadata, name: contract.streamResourceName, labels: { ...labels, 'app.kubernetes.io/component': 'event-log' } },
      spec: {
        name: contract.stream,
        subjects: [`${contract.subjectPrefix}.>`],
        retention: 'limits',
        storage: 'file',
        replicas: contract.streamReplicas,
        duplicateWindow: '2m',
        servers: contract.servers,
      },
    }] : []),
    {
      apiVersion: 'jetstream.nats.io/v1beta2',
      kind: 'Consumer',
      metadata,
      spec: {
        durableName: contract.consumer,
        streamName: contract.stream,
        ackPolicy: 'explicit',
        ackWait: '30s',
        maxDeliver: 5,
        maxAckPending: contract.processor.deployment.maxAckPending,
        filterSubjects,
        servers: contract.servers,
      },
    },
    ...(disruptionResource ? [disruptionResource] : []),
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress', 'Egress'],
        egress: [
          {
            to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } }, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }],
            ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
          },
          { ports: [{ protocol: 'TCP', port: 4222 }, { protocol: 'TCP', port: 5432 }] },
        ],
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata,
      spec: {
        replicas: contract.processor.deployment.replicas,
        progressDeadlineSeconds: 600,
        revisionHistoryLimit: 3,
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/runtime-digest': digest } },
          spec: {
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 60,
            ...generatedProcessorPodScheduling(contract.processor, labels),
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              fsGroupChangePolicy: 'OnRootMismatch',
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [{
              name: 'processor',
              image,
              imagePullPolicy: 'IfNotPresent',
              command: ['node', '/app/processor.mjs'],
              env,
              securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
              resources: contract.processor.deployment.resources,
              readinessProbe: { exec: { command: ['test', '-f', '/tmp/applik8s-processor-ready'] }, periodSeconds: 5, timeoutSeconds: 2, failureThreshold: 3 },
              livenessProbe: { exec: { command: ['node', '-e', "const { mtimeMs } = require('node:fs').statSync('/tmp/applik8s-processor-heartbeat'); process.exit(Date.now() - mtimeMs < 60000 ? 0 : 1)"] }, periodSeconds: 20, timeoutSeconds: 2, failureThreshold: 3 },
              volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
            }],
            volumes: [{ name: 'tmp', emptyDir: { sizeLimit: '16Mi' } }],
          },
        },
      },
    },
  ];
}

function eventDefinition(event: ApplicationEventNode): { readonly kind: 'applik8sEvent'; readonly id: string; readonly name: string; readonly version: string } {
  return { kind: 'applik8sEvent', id: event.name, name: event.contract.name, version: event.contract.version };
}

function commandDefinition(command: ApplicationCommandNode): { readonly kind: 'applik8sCommand'; readonly id: string; readonly name: string; readonly version: string; readonly input: object; readonly output: object; readonly errors: object } {
  return {
    kind: 'applik8sCommand',
    id: command.name,
    name: command.contract.name,
    version: command.contract.version,
    input: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.name}.input` }, schema: command.contract.input.jsonSchema },
    output: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.name}.output` }, schema: command.contract.output.jsonSchema },
    errors: Object.fromEntries(command.contract.errors.map((error) => [error.name, { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.name}.${error.name}` }, schema: error.schema.jsonSchema }])),
  };
}

function stringConfig(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function processorEnvironmentInteger(value: number | string): string {
  if (typeof value === 'number') return String(value);
  const expression = /^\$\{(.+)\}$/.exec(value)?.[1];
  if (!expression) throw new Error(`Processor capacity must be an integer or serialized installation expression, received ${JSON.stringify(value)}.`);
  return `\${string(${expression})}`;
}

function kubernetesName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'processor';
}

function subjectToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'value';
}
