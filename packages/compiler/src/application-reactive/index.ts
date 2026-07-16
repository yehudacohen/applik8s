import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ApplicationCommandHandlerNode, ApplicationCommandNode, ApplicationGatewayNode, ApplicationGraph, ApplicationHandlerDependencies, ApplicationModelNode, ApplicationProjectionNode, ApplicationProviderNode, ApplicationQueryNode, ApplicationReactiveDatabaseRuntimeContract, ApplicationStreamNode, ApplicationSubscriptionNode } from '@applik8s/core';
import { build } from 'esbuild';
import ts from 'typescript';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';

const DEFAULT_NODE_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationReactiveResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export interface GeneratedApplicationReactiveArtifact {
  readonly name: string;
  readonly kind: 'queryGateway' | 'projectionWorker';
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly resources: readonly GeneratedApplicationReactiveResource[];
}

interface GatewayCommandContract {
  readonly handler: ApplicationCommandHandlerNode;
  readonly command: ApplicationCommandNode;
  readonly model: ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
}

interface GatewayStreamSubscriptionContract {
  readonly subscription: ApplicationSubscriptionNode;
  readonly stream: ApplicationStreamNode;
}

/** Lowers deployable v0.6 query gateways and analytical projections into immutable Node workloads. */
export async function emitGeneratedApplicationReactive(options: { readonly graph: ApplicationGraph; readonly outDir: string; readonly entrypoint: string }): Promise<readonly GeneratedApplicationReactiveArtifact[]> {
  const gateways = options.graph.nodes.filter((node): node is ApplicationGatewayNode => node.kind === 'gateway' && node.materialization === 'generatedDeployment');
  const projections = options.graph.nodes.filter((node): node is ApplicationProjectionNode => node.kind === 'projection');
  if (gateways.length === 0 && projections.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  return [
    ...await Promise.all(gateways.map((gateway) => emitGateway(options.graph, gateway, options.outDir))),
    ...await Promise.all(projections.map((projection) => emitProjection(options.graph, projection, options.outDir))),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

async function emitGateway(graph: ApplicationGraph, gateway: ApplicationGatewayNode, outDir: string): Promise<GeneratedApplicationReactiveArtifact> {
  if (!gateway.deployment || !gateway.cursorSecret || !gateway.authenticationSource) throw new Error(`Generated application gateway ${gateway.id} is missing deployment, cursor Secret, or authentication source.`);
  assertResolved(gateway.id, 'authentication', gateway.authenticationUnresolved);
  const nodes = graphNodes(graph);
  const queries = gateway.queries.map((reference) => requiredNode(nodes, reference.nodeId, 'query', gateway.id));
  const subscriptions = gateway.subscriptions.map((reference): GatewayStreamSubscriptionContract => {
    const subscription = requiredNode(nodes, reference.nodeId, 'subscription', gateway.id);
    const source = nodes.get(subscription.source.nodeId);
    if (source?.kind !== 'stream') throw new Error(`Generated application gateway ${gateway.id} subscription ${subscription.id} must consume a public stream; query subscriptions use the query's existing snapshot/SSE route directly.`);
    assertResolved(subscription.id, 'authorization', subscription.authorizationUnresolved);
    assertResolved(source.id, 'authorization', source.authorizationUnresolved);
    assertSecretNamespace(source.database, gateway.deployment?.namespace ?? '', `gateway ${gateway.id} stream subscription`);
    return { subscription, stream: source };
  });
  const commands = gateway.commands.map((reference): GatewayCommandContract => {
    const handler = requiredNode(nodes, reference.handler.nodeId, 'commandHandler', gateway.id);
    const command = requiredNode(nodes, reference.command.nodeId, 'command', gateway.id);
    const model = requiredNode(nodes, handler.model.nodeId, 'model', handler.id);
    if (!model.runtime) throw new Error(`Generated application gateway ${gateway.id} command ${command.id} has no model runtime.`);
    assertResourceNamespace(model.runtime.secretNamespace, gateway.deployment?.namespace ?? '', `Gateway ${gateway.id} command database Secret ${model.runtime.secretName}`);
    // typecast: the runtime guard above establishes the model runtime required by generated command observation.
    return { handler, command, model: model as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> } };
  });
  const eventLog = commands.length > 0 ? gatewayEventLog(nodes, gateway.id) : undefined;
  if (eventLog) {
    const connectionSecret = objectConfig(eventLog.config?.connectionSecret);
    assertResourceNamespace(stringConfig(connectionSecret.namespace) || undefined, gateway.deployment.namespace, `Gateway ${gateway.id} EventLog Secret`);
  }
  for (const query of queries) {
    assertResolved(query.id, 'authorization', query.authorizationUnresolved);
    assertResolved(query.id, 'handler', query.handlerUnresolved);
    if (!query.database) throw new Error(`Generated application gateway ${gateway.id} query ${query.id} has no PostgreSQL snapshot authority.`);
    assertSecretNamespace(query.database, gateway.deployment.namespace, `gateway ${gateway.id}`);
  }
  assertResourceNamespace(gateway.cursorSecret.namespace, gateway.deployment.namespace, `Gateway ${gateway.id} cursor Secret`);
  const name = kubernetesName(`${graph.metadata.name}-${gateway.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'authentication', gateway.authenticationSource, gateway.authenticationDependencies);
  if (commands.length > 0 && gateway.commandAuthorizationSource) await writeCallbackModule(artifactDir, 'command-authorization', gateway.commandAuthorizationSource, gateway.commandAuthorizationDependencies);
  for (const { subscription, stream } of subscriptions) {
    await writeCallbackModule(artifactDir, callbackName(subscription.id, 'authorize'), subscription.authorizationSource, subscription.authorizationDependencies);
    await writeCallbackModule(artifactDir, callbackName(stream.id, 'authorize-stream'), stream.authorizationSource, stream.authorizationDependencies);
  }
  for (const query of queries) {
    await writeQueryCallbackModule(artifactDir, callbackName(query.id, 'authorize'), query.authorizationSource, query.authorizationDependencies, query, graph);
    await writeQueryCallbackModule(artifactDir, callbackName(query.id, 'run'), query.handlerSource, query.handlerDependencies, query, graph);
  }
  const entrypoint = join(artifactDir, 'gateway.generated.ts');
  await writeFile(entrypoint, generatedGatewaySource(graph, gateway, queries, commands, subscriptions, eventLog));
  return bundleReactive({ graphName: graph.metadata.name, name, kind: 'queryGateway', namespace: gateway.deployment.namespace, image: gateway.deployment.image || DEFAULT_NODE_IMAGE, replicas: gateway.deployment.replicas, port: gateway.deployment.port, entrypoint, artifactDir, env: gatewayEnvironment(gateway, queries, commands, subscriptions, eventLog) });
}

async function emitProjection(graph: ApplicationGraph, projection: ApplicationProjectionNode, outDir: string): Promise<GeneratedApplicationReactiveArtifact> {
  assertResolved(projection.id, 'handler', projection.handlerUnresolved);
  const nodes = graphNodes(graph);
  const stream = requiredNode(nodes, projection.source.nodeId, 'stream', projection.id);
  assertResolved(stream.id, 'partition', stream.partitionUnresolved);
  assertResolved(stream.id, 'authorization', stream.authorizationUnresolved);
  const provider = requiredProvider(nodes, projection.provider.nodeId, projection.id);
  if (provider.interface !== 'ProjectionStore' || provider.implementation !== 'clickhouse') throw new Error(`Generated projection ${projection.id} requires one ClickHouse ProjectionStore provider.`);
  const config = provider.config ?? {};
  const namespace = stringConfig(config.namespace) || stream.database.secretNamespace || graph.metadata.namespace || 'default';
  assertSecretNamespace(stream.database, namespace, `projection ${projection.id}`);
  const credentials = objectConfig(config.credentialsSecret);
  assertResourceNamespace(stringConfig(credentials.namespace) || undefined, namespace, `Projection ${projection.id} ClickHouse credentials Secret`);
  const name = kubernetesName(`${graph.metadata.name}-${projection.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'project', projection.handlerSource, projection.handlerDependencies);
  await writeCallbackModule(artifactDir, 'stream-authorization', stream.authorizationSource, stream.authorizationDependencies);
  const entrypoint = join(artifactDir, 'projection.generated.ts');
  await writeFile(entrypoint, generatedProjectionSource(projection, stream, provider));
  const env = projectionEnvironment(stream, config);
  return bundleReactive({ graphName: graph.metadata.name, name, kind: 'projectionWorker', namespace, image: DEFAULT_NODE_IMAGE, replicas: 1, port: 8080, entrypoint, artifactDir, env });
}

async function bundleReactive(options: { readonly graphName: string; readonly name: string; readonly kind: GeneratedApplicationReactiveArtifact['kind']; readonly namespace: string; readonly image: string; readonly replicas: number; readonly port: number; readonly entrypoint: string; readonly artifactDir: string; readonly env: readonly Record<string, unknown>[] }): Promise<GeneratedApplicationReactiveArtifact> {
  const sourcePath = join(options.artifactDir, 'runtime.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const metafilePath = join(options.artifactDir, 'runtime.esbuild-meta.json');
  const manifestPath = join(options.artifactDir, 'runtime.manifest.json');
  const result = await build({
    entryPoints: [options.entrypoint], outfile: sourcePath, bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: true,
    legalComments: 'none', sourcemap: 'external', metafile: true, nodePaths: [join(process.cwd(), 'node_modules')], plugins: [applik8sWorkspaceSourcePlugin()],
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
  });
  const source = await readFile(sourcePath, 'utf8');
  const compressed = gzipSync(source, { level: 9 });
  if (compressed.byteLength > 700_000) throw new Error(`Generated ${options.kind} ${options.name} compresses to ${compressed.byteLength} bytes and exceeds the safe ConfigMap limit.`);
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const resources = reactiveResources(options, compressed.toString('base64'), digest);
  await writeFile(manifestPath, `${JSON.stringify({ apiVersion: 'applik8s.reactive/v1alpha1', kind: options.kind === 'queryGateway' ? 'GeneratedQueryGateway' : 'GeneratedProjectionWorker', metadata: { name: options.name }, spec: { graph: options.graphName, digest, sizeBytes, compressedSizeBytes: compressed.byteLength, image: options.image, namespace: options.namespace, resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })) } }, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return { name: options.name, kind: options.kind, sourcePath, sourceMapPath, manifestPath, metafilePath, digest, sizeBytes, resources };
}

function generatedGatewaySource(graph: ApplicationGraph, gateway: ApplicationGatewayNode, queries: readonly ApplicationQueryNode[], commands: readonly GatewayCommandContract[], subscriptions: readonly GatewayStreamSubscriptionContract[], eventLog?: ApplicationProviderNode): string {
  const imports = [
    "import { createServer } from 'node:http';",
    "import postgres from 'postgres';",
    "import { drizzle } from 'drizzle-orm/postgres-js';",
    "import { normalizeSchema } from '@applik8s/sdk/schema-runtime';",
    "import { applicationAdmittedContextDigest, createApplicationCommandGateway, createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationRelationalContext, createApplicationStreamSubscriptionGateway, createApplicationSubscriptionLimiter, createPostgresApplicationStream } from '@applik8s/applik8s/reactive-runtime';",
    "import { callback as authenticateRequest } from './authentication.generated.js';",
    ...queries.flatMap((query) => [
      `import { callback as ${callbackVariable(query.id, 'authorize')} } from './${callbackName(query.id, 'authorize')}.generated.js';`,
      `import { callback as ${callbackVariable(query.id, 'run')} } from './${callbackName(query.id, 'run')}.generated.js';`,
    ]),
    ...(commands.length > 0 ? ["import { callback as authorizeCommand } from './command-authorization.generated.js';"] : []),
    ...subscriptions.flatMap(({ subscription, stream }) => [
      `import { callback as ${callbackVariable(subscription.id, 'authorize')} } from './${callbackName(subscription.id, 'authorize')}.generated.js';`,
      `import { callback as ${callbackVariable(stream.id, 'streamAuthorize')} } from './${callbackName(stream.id, 'authorize-stream')}.generated.js';`,
    ]),
  ].join('\n');
  const databases = uniqueDatabaseRuntimes([
    ...queries.map((query) => query.database).filter((database): database is ApplicationReactiveDatabaseRuntimeContract => Boolean(database)),
    ...subscriptions.map(({ stream }) => stream.database),
  ]);
  const databaseDeclarations = databases.map((database) => `const ${databaseVariable(database.name)}Binding = ${databaseBindingSource(database)};\nconst ${databaseVariable(database.name)}Sql = postgres(requiredEnv(${JSON.stringify(database.connectionEnvName)}), { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: false });\nconst ${databaseVariable(database.name)}Db = drizzle(${databaseVariable(database.name)}Sql);`).join('\n');
  const queryDeclarations = queries.map((query) => generatedQueryBinding(query, graphReadNames(graph, query))).join(',\n');
  const commandGateway = commands.length > 0 && eventLog ? generatedCommandGateway(commands, eventLog) : 'const commandGateway = undefined;';
  const streamGateway = generatedStreamSubscriptionGateway(subscriptions);
  return `${imports}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function schema(json, name) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name); const validate = (value) => { const result = normalized.validate(value); return result.ok ? result.value : { summary: result.error.message }; }; validate.toJsonSchema = () => json; return validate; }
${databaseDeclarations}
const queries = [${queryDeclarations}];
const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');
const subscriptionLimiter = createApplicationSubscriptionLimiter(${JSON.stringify(gateway.subscriptionLimits)});
async function admit(request) { const admitted = await authenticateRequest(request); if (!admitted || typeof admitted !== 'object') throw new Error('Gateway authentication returned no admission.'); return admitted; }
const gateway = createApplicationQueryGateway({
  queries,
  cursorSecret,
  subscriptionLimits: ${JSON.stringify(gateway.subscriptionLimits)},
  subscriptionLimiter,
  authenticate: async (request) => { const admitted = await admit(request); return { principal: admitted.principal, admittedContext: { values: admitted.trustedContext ?? {}, digestSecret: cursorSecret }, authorizationVersion: admitted.authorizationVersion }; },
  context: (identity) => createApplicationRelationalContext({ databases: [${databases.map((database) => `{ binding: ${databaseVariable(database.name)}Binding, db: ${databaseVariable(database.name)}Db }`).join(', ')}], admittedContext: identity.admittedContext }),
});
${commandGateway}
${streamGateway}
const handle = createApplicationQueryGatewayHttpHandler(gateway, { basePath: ${JSON.stringify(gateway.routes.snapshots.split('/:query/')[0]?.replace(/^\//, '') || 'queries')} });
let ready = false; let stopping = false; let lastDependencyError;
const dependencyMonitor = new AbortController();
const server = createServer(async (incoming, outgoing) => { const requestController = new AbortController(); const abortRequest = () => requestController.abort(); incoming.once('aborted', abortRequest); outgoing.once('close', abortRequest); try { if (incoming.url === '/live' || incoming.url === '/ready') { const ok = incoming.url === '/live' || (ready && !stopping); outgoing.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ ready, stopping, lastDependencyError })); return; } const request = await webRequest(incoming, requestController.signal); const commandResponse = commandGateway ? await commandGateway.handle(request.clone()) : undefined; const streamResponse = commandResponse ? undefined : await streamGateway.handle(request.clone()); await writeResponse(outgoing, commandResponse ?? streamResponse ?? await handle(request)); } catch (error) { if (!requestController.signal.aborted) { console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'internal_error' })); } } finally { incoming.removeListener('aborted', abortRequest); outgoing.removeListener('close', abortRequest); } });
server.listen(${gateway.deployment?.port ?? 8080}, '0.0.0.0');
async function monitorDependencies() { while (!stopping) { try { await Promise.all([${databases.map((database) => `${databaseVariable(database.name)}Sql.unsafe('SELECT 1 AS applik8s_ready')`).join(', ')}, ...(commandGateway ? [commandGateway.ready()] : [])]); ready = true; lastDependencyError = undefined; } catch (error) { ready = false; lastDependencyError = error instanceof Error ? error.message : String(error); if (!stopping) console.error(error); } await abortableSleep(5000, dependencyMonitor.signal); } }
const dependencyMonitorTask = monitorDependencies();
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
async function webRequest(request, signal) { const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await new Promise((resolve, reject) => { const chunks = []; request.on('data', (chunk) => chunks.push(chunk)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); return new Request('http://' + (request.headers.host ?? 'localhost') + (request.url ?? '/'), { method: request.method, headers: Object.entries(request.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value === undefined ? [] : [[key, value]]), signal, ...(body ? { body, duplex: 'half' } : {}) }); }
async function writeResponse(response, web) { response.writeHead(web.status, Object.fromEntries(web.headers)); if (!web.body) { response.end(); return; } const reader = web.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once('drain', resolve)); } response.end(); }
async function shutdown() { if (stopping) return; stopping = true; ready = false; dependencyMonitor.abort(); await new Promise((resolve) => server.close(resolve)); await dependencyMonitorTask; await Promise.all([${databases.map((database) => `${databaseVariable(database.name)}Sql.end({ timeout: 5 })`).join(', ')}, ...(commandGateway ? [commandGateway.close()] : [])]); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
`;
}

function generatedQueryBinding(query: ApplicationQueryNode, modelNames: readonly string[]): string {
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const database = query.database;
  if (!database) throw new Error(`Generated query ${query.id} has no database runtime.`);
  const contexts = query.trustedContext.map((name) => {
    const access = database.access?.context === name ? database.access : undefined;
    if (!access) throw new Error(`Generated query ${query.id} trusted context ${name} has no serializable database access schema.`);
    return `{ kind: 'applicationTrustedContext', name: ${JSON.stringify(name)}, schema: schema(${JSON.stringify(access.contextSchema)}, ${JSON.stringify(name)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(access.contextSchema)} } }`;
  });
  return `{ kind: 'applicationQuery', id: ${JSON.stringify(id)}, name: ${JSON.stringify(query.name)}, version: ${JSON.stringify(query.version)}, input: schema(${JSON.stringify(query.input.jsonSchema)}, ${JSON.stringify(`${id}.input`)}), output: schema(${JSON.stringify(query.output.jsonSchema)}, ${JSON.stringify(`${id}.output`)}), database: ${databaseVariable(database.name)}Binding, trustedContext: [${contexts.join(', ')}], reads: ${JSON.stringify(modelNames.map((name) => ({ $model: { name } })))}, budgets: ${JSON.stringify(query.budgets)}, authorize: async (principal, input, context = {}) => ${callbackVariable(query.id, 'authorize')}({ principal, context, input }), run: async (context, principal, input) => ${callbackVariable(query.id, 'run')}({ context, principal, input }) }`;
}

function generatedCommandGateway(commands: readonly GatewayCommandContract[], eventLog: ApplicationProviderNode): string {
  const config = eventLog.config ?? {};
  const servers = Array.isArray(config.servers) ? config.servers.filter((value): value is string => typeof value === 'string') : [];
  const namespace = stringConfig(config.namespace);
  const name = stringConfig(config.name) || 'applik8s-events';
  const commandContracts = commands.map(({ handler, command, model }) => `{ id: ${JSON.stringify(`${command.contract.name}.${command.contract.version}`)}, bindingId: ${JSON.stringify(handler.name)}, model: ${JSON.stringify(model.name)}, inputSchema: ${JSON.stringify(command.contract.input.jsonSchema)}, databaseUrl: requiredEnv(${JSON.stringify(model.runtime.connectionEnvName)}), key: (${handler.key.source})${handler.idempotencyKey ? `, idempotencyKey: (${handler.idempotencyKey.source})` : ''} }`).join(',\n');
  return `const commandGateway = createApplicationCommandGateway({
  commands: [${commandContracts}],
  authenticate: admit,
  authorize: authorizeCommand,
  cursorSecret,
  eventLog: { servers: ${JSON.stringify(servers.length > 0 ? servers : [`nats://${name}${namespace ? `.${namespace}` : ''}.svc:4222`])}, stream: ${JSON.stringify(stringConfig(config.stream) || 'APPLIK8S_EVENTS')}, subjectPrefix: ${JSON.stringify(stringConfig(config.subjectPrefix) || 'applik8s')}, connectionName: ${JSON.stringify('applik8s-query-command-gateway')}, ...(process.env.APPLIK8S_NATS_TOKEN ? { token: process.env.APPLIK8S_NATS_TOKEN } : {}), ...(process.env.APPLIK8S_NATS_USER ? { user: process.env.APPLIK8S_NATS_USER, pass: process.env.APPLIK8S_NATS_PASSWORD ?? '' } : {}) },
});`;
}

function generatedStreamSubscriptionGateway(subscriptions: readonly GatewayStreamSubscriptionContract[]): string {
  const bindings = subscriptions.map(({ subscription, stream }) => {
    const streamId = `${stream.name}.${stream.version}`;
    return `{ name: ${JSON.stringify(subscription.name)}, stream: { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(streamId)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}, ${JSON.stringify(`${streamId}.payload`)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database: ${databaseBindingSource(stream.database)}, partition: () => { throw new Error('Subscription replay never repartitions persisted events.'); }, authorize: async (principal, action) => ${callbackVariable(stream.id, 'streamAuthorize')}({ principal, action }) }, authorize: async (principal) => ${callbackVariable(subscription.id, 'authorize')}({ principal }), open: (identity) => createPostgresApplicationStream({ stream: streamSubscriptions[${JSON.stringify(subscription.name)}].stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: identity.principal, contextDigest: identity.contextDigest }) }`;
  }).join(',\n');
  const index = subscriptions.map(({ subscription }, position) => `${JSON.stringify(subscription.name)}: streamSubscriptionBindings[${position}]`).join(', ');
  return `const streamSubscriptionBindings = [${bindings}];
const streamSubscriptions = { ${index} };
const streamGateway = createApplicationStreamSubscriptionGateway({
  subscriptions: streamSubscriptionBindings,
  cursorSecret,
  subscriptionLimiter,
  authenticate: async (request) => { const admitted = await admit(request); return { principal: admitted.principal, authorizationVersion: admitted.authorizationVersion, contextDigest: applicationAdmittedContextDigest({ values: admitted.trustedContext ?? {}, digestSecret: cursorSecret }) }; },
});`;
}

function generatedProjectionSource(projection: ApplicationProjectionNode, stream: ApplicationStreamNode, provider: ApplicationProviderNode): string {
  const config = provider.config ?? {};
  const endpoint = stringConfig(config.endpoint) || `http://clickhouse-${stringConfig(config.name) || 'applik8s-analytics'}.${stringConfig(config.namespace) || 'applik8s-analytics'}.svc.cluster.local:8123`;
  const database = stringConfig(config.database) || 'default';
  const table = kubernetesName(projection.name).replace(/-/g, '_');
  return `import { createServer } from 'node:http';
import { createClickHouseProjectionStore, createPostgresApplicationStream, enforcePostgresApplicationStreamRetention, runApplicationProjection } from '@applik8s/applik8s/reactive-runtime';
import { callback as project } from './project.generated.js';
import { callback as authorizeStream } from './stream-authorization.generated.js';
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function schema(json) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:projection' }, schema: json }; }
const database = ${databaseBindingSource(stream.database)};
const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database, partition: () => { throw new Error('Projection replay never repartitions persisted events.'); }, authorize: async (principal, action) => authorizeStream({ principal, action }) };
const source = createPostgresApplicationStream({ stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} } });
const store = createClickHouseProjectionStore({ endpoint: ${JSON.stringify(endpoint)}, database: ${JSON.stringify(database)}, table: ${JSON.stringify(table)}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, schema: schema(${JSON.stringify(projection.output.jsonSchema)}), ...(process.env.APPLIK8S_CLICKHOUSE_USERNAME ? { username: process.env.APPLIK8S_CLICKHOUSE_USERNAME, password: process.env.APPLIK8S_CLICKHOUSE_PASSWORD ?? '' } : {}) });
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const ok = live || (ready && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready, stopping, checkpoint, processed, lastError })); });
server.listen(8080, '0.0.0.0');
async function loop() { let prepared = false; while (!stopping) { try { if (!prepared) { await store.prepare(); prepared = true; } const result = await runApplicationProjection({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, project, batchSize: 250, maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; await enforcePostgresApplicationStreamRetention({ stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), batchSize: 1000 }); lastError = undefined; ready = true; await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; if (!stopping) console.error(error); await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await source.close(); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

async function writeCallbackModule(directory: string, name: string, source: string, dependencies?: ApplicationHandlerDependencies): Promise<void> {
  const dependencySource = dependencies?.source ? absoluteDependencyImports(dependencies.source, dependencies.resolveDir) : '';
  await writeFile(join(directory, `${name}.generated.ts`), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

async function writeQueryCallbackModule(directory: string, name: string, source: string, dependencies: ApplicationHandlerDependencies | undefined, query: ApplicationQueryNode, graph: ApplicationGraph): Promise<void> {
  const dependencySource = dependencies?.source ? absoluteDependencyImports(rewriteQueryRuntimeDependencies(dependencies.source, query, graph), dependencies.resolveDir) : '';
  assertSupportedQueryRuntimeFacetCapture(dependencySource, query.id);
  await writeFile(join(directory, `${name}.generated.ts`), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

/** Replaces authoring-only app/database/model declarations with focused runtime equivalents. */
function rewriteQueryRuntimeDependencies(source: string, query: ApplicationQueryNode, graph: ApplicationGraph): string {
  if (!query.database) return source;
  const file = ts.createSourceFile('query-dependencies.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  const models = graph.nodes.filter((node): node is ApplicationModelNode => node.kind === 'model' && node.runtime?.storageShape === 'native-relational');
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && (statement.moduleSpecifier.text === '@applik8s/applik8s' || statement.moduleSpecifier.text.startsWith('@applik8s/applik8s/'))) {
      edits.push({ start: statement.getFullStart(), end: statement.getEnd(), replacement: '' });
      continue;
    }
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (!declaration?.initializer || !ts.isIdentifier(declaration.name)) continue;
    const initializer = declaration.initializer;
    if (!ts.isCallExpression(initializer)) continue;
    const callee = initializer.expression.getText(file);
    if (callee === 'app' || callee === 'trustedContext') {
      edits.push({ start: statement.getFullStart(), end: statement.getEnd(), replacement: '' });
      continue;
    }
    if (/\.database\.postgres$/.test(callee)) {
      edits.push({ start: initializer.getStart(file), end: initializer.getEnd(), replacement: queryDatabaseCaptureSource(query.database) });
      continue;
    }
    if (/\.model$/.test(callee)) {
      const table = initializer.arguments[0]?.getText(file);
      if (!table) throw new Error(`Generated query ${query.id} contains an application model capture without a native table argument.`);
      const declaredName = objectLiteralStringProperty(initializer.arguments[1], 'name');
      const model = models.find((candidate) => candidate.name === declaredName) ?? models.find((candidate) => candidate.runtime?.tableName === table);
      if (!model) throw new Error(`Generated query ${query.id} cannot map captured model ${declaration.name.text} to a native model graph node.`);
      const facet = { name: model.name, native: 'drizzle-table', database: model.runtime?.database, identity: model.common?.identity, revision: model.common?.revision, relationships: model.common?.relationships ?? [] };
      edits.push({ start: initializer.getStart(file), end: initializer.getEnd(), replacement: `Object.assign(${table}, { $model: ${JSON.stringify(facet)} })` });
    }
  }
  let rewritten = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  return rewritten.trim();
}

function assertSupportedQueryRuntimeFacetCapture(source: string, queryId: string): void {
  const unsupported = [...source.matchAll(/\.\$model\.(schema|relations|on|ref)\b/g)].map((match) => match[1]);
  if (unsupported.length === 0) return;
  throw new Error(`Generated query ${queryId} captures authoring-only model facet member(s): ${[...new Set(unsupported)].sort().join(', ')}. Query handlers may use the native Drizzle table and the runtime-safe $model metadata (name, database, identity, revision, relationships), but schema validators, relation registries, command registration, and reference factories must remain outside the generated handler closure.`);
}

function queryDatabaseCaptureSource(database: ApplicationReactiveDatabaseRuntimeContract): string {
  return `{ kind: 'applicationDatabase', name: ${JSON.stringify(database.name)}, provider: { kind: 'postgres' }, schema: {} }`;
}

function objectLiteralStringProperty(node: ts.Expression | undefined, name: string): string | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.getText().replace(/^['"]|['"]$/g, '') !== name || !ts.isStringLiteral(property.initializer)) continue;
    return property.initializer.text;
  }
  return undefined;
}

function reactiveResources(options: { readonly graphName: string; readonly name: string; readonly kind: GeneratedApplicationReactiveArtifact['kind']; readonly namespace: string; readonly image: string; readonly replicas: number; readonly port: number; readonly env: readonly Record<string, unknown>[] }, compressed: string, digest: string): GeneratedApplicationReactiveResource[] {
  const component = options.kind === 'queryGateway' ? 'query-gateway' : 'projection-worker';
  const labels = { 'app.kubernetes.io/name': options.name, 'app.kubernetes.io/component': component, 'applik8s.dev/graph': options.graphName };
  const sourceName = `${options.name}-source`;
  const resources: GeneratedApplicationReactiveResource[] = [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: sourceName, namespace: options.namespace, labels, annotations: { 'applik8s.dev/digest': digest, 'applik8s.dev/content-encoding': 'gzip' } }, binaryData: { 'runtime.mjs.gz': compressed } },
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: options.name, namespace: options.namespace, labels }, spec: { replicas: options.replicas, selector: { matchLabels: labels }, strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }, template: { metadata: { labels, annotations: { 'applik8s.dev/digest': digest } }, spec: { terminationGracePeriodSeconds: 30, initContainers: [{ name: 'unpack-runtime', image: options.image, command: ['node', '-e', "const fs=require('node:fs');const zlib=require('node:zlib');fs.writeFileSync('/app/runtime.mjs',zlib.gunzipSync(fs.readFileSync('/bundle/runtime.mjs.gz')));"], volumeMounts: [{ name: 'source', mountPath: '/bundle', readOnly: true }, { name: 'runtime', mountPath: '/app' }] }], containers: [{ name: 'runtime', image: options.image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/runtime.mjs'], env: options.env, ports: [{ name: 'http', containerPort: options.port }], readinessProbe: { httpGet: { path: '/ready', port: 'http' }, periodSeconds: 5, failureThreshold: 6 }, livenessProbe: { httpGet: { path: '/live', port: 'http' }, periodSeconds: 10, failureThreshold: 6 }, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } }, volumeMounts: [{ name: 'runtime', mountPath: '/app', readOnly: true }] }], volumes: [{ name: 'source', configMap: { name: sourceName } }, { name: 'runtime', emptyDir: {} }] } } } },
    { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { name: options.name, namespace: options.namespace, labels }, spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port: options.port }] }] } },
  ];
  if (options.kind === 'queryGateway') resources.push({ apiVersion: 'v1', kind: 'Service', metadata: { name: options.name, namespace: options.namespace, labels }, spec: { selector: labels, ports: [{ name: 'http', port: options.port, targetPort: 'http' }] } });
  if (options.replicas > 1) resources.push({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: options.name, namespace: options.namespace, labels }, spec: { minAvailable: 1, selector: { matchLabels: labels } } });
  return resources;
}

function gatewayEnvironment(gateway: ApplicationGatewayNode, queries: readonly ApplicationQueryNode[], commands: readonly GatewayCommandContract[], subscriptions: readonly GatewayStreamSubscriptionContract[], eventLog?: ApplicationProviderNode): readonly Record<string, unknown>[] {
  if (!gateway.cursorSecret) return [];
  return uniqueEnvironment([
    { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: gateway.cursorSecret.name, key: gateway.cursorSecret.key } } },
    ...uniqueDatabaseRuntimes(queries.map((query) => query.database).filter((database): database is ApplicationReactiveDatabaseRuntimeContract => Boolean(database))).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueCommandDatabases(commands).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueDatabaseRuntimes(subscriptions.map(({ stream }) => stream.database)).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...eventLogEnvironment(eventLog),
  ]);
}

function projectionEnvironment(stream: ApplicationStreamNode, config: Readonly<Record<string, unknown>>): readonly Record<string, unknown>[] {
  const credentials = objectConfig(config.credentialsSecret);
  const credentialName = stringConfig(credentials.name);
  return [
    { name: stream.database.connectionEnvName, valueFrom: { secretKeyRef: { name: stream.database.secretName, key: stream.database.secretKey } } },
    ...(credentialName ? [
      { name: 'APPLIK8S_CLICKHOUSE_USERNAME', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.usernameKey) || 'username' } } },
      { name: 'APPLIK8S_CLICKHOUSE_PASSWORD', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.passwordKey) || 'password' } } },
    ] : []),
  ];
}

function databaseBindingSource(database: ApplicationReactiveDatabaseRuntimeContract): string {
  const access = database.access ? `{ kind: 'postgresRls', context: { kind: 'applicationTrustedContext', name: ${JSON.stringify(database.access.context)}, schema: schema(${JSON.stringify(database.access.contextSchema)}, ${JSON.stringify(database.access.context)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(database.access.contextSchema)} } }, column: ${JSON.stringify(database.access.column)}, default: 'required', setting: ${JSON.stringify(database.access.setting)} }` : 'undefined';
  return `{ kind: 'applicationDatabase', name: ${JSON.stringify(database.name)}, provider: { kind: 'postgres' }, schema: {}, ...((${access}) ? { access: ${access} } : {}) }`;
}

function graphReadNames(graph: ApplicationGraph, query: ApplicationQueryNode): readonly string[] {
  const nodes = graphNodes(graph);
  const names = new Set<string>();
  for (const read of query.reads) {
    const node = nodes.get(read.model.nodeId);
    if (node?.kind !== 'model' && node?.kind !== 'crd') throw new Error(`Generated query ${query.id} references missing readable model ${read.model.nodeId}.`);
    names.add(node.name);
    if (!read.relationship) continue;
    const relationships = node.common?.relationships ?? [];
    const relationship = relationships.find((candidate) => candidate.name === read.relationship);
    if (!relationship) throw new Error(`Generated query ${query.id} references missing relationship ${node.name}.${read.relationship}.`);
    names.add(canonicalGraphModelName(graph, relationship.target));
  }
  return [...names].sort();
}

function canonicalGraphModelName(graph: ApplicationGraph, value: string): string {
  const direct = graph.nodes.find((node) => (node.kind === 'model' || node.kind === 'crd') && node.name === value);
  if (direct) return direct.name;
  const native = graph.nodes.find((node) => {
    if (node.kind === 'model') return node.native?.artifact.name === value;
    if (node.kind === 'crd') return node.resource.plural === value || node.resource.kind === value;
    return false;
  });
  return native?.name ?? value;
}

function graphNodes(graph: ApplicationGraph): ReadonlyMap<string, ApplicationGraph['nodes'][number]> { return new Map(graph.nodes.map((node) => [node.id, node])); }
// typecast: the runtime kind equality check narrows the graph node to the requested discriminated-union member.
function requiredNode<TKind extends ApplicationGraph['nodes'][number]['kind']>(nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>, id: string, kind: TKind, owner: string): Extract<ApplicationGraph['nodes'][number], { readonly kind: TKind }> { const node = nodes.get(id); if (node?.kind !== kind) throw new Error(`${owner} references missing ${kind} ${id}.`); return node as Extract<ApplicationGraph['nodes'][number], { readonly kind: TKind }>; }
function requiredProvider(nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>, id: string, owner: string): ApplicationProviderNode { const node = nodes.get(id); if (node?.kind !== 'provider') throw new Error(`${owner} references missing provider ${id}.`); return node; }
function assertResolved(owner: string, callback: string, unresolved?: readonly string[]): void { if (unresolved?.length) throw new Error(`${owner} ${callback} callback cannot be emitted because it captures unresolved local identifier(s): ${unresolved.join(', ')}. Move them to module scope or keep this declaration runtime-only.`); }
function assertSecretNamespace(database: ApplicationReactiveDatabaseRuntimeContract, namespace: string, owner: string): void { assertResourceNamespace(database.secretNamespace, namespace, `${owner} PostgreSQL Secret ${database.secretName}`); }
function assertResourceNamespace(resourceNamespace: string | undefined, workloadNamespace: string, owner: string): void { if (resourceNamespace && resourceNamespace !== workloadNamespace) throw new Error(`${owner} is in namespace ${resourceNamespace}, but its generated workload is in ${workloadNamespace}. Kubernetes cannot mount cross-namespace Secrets.`); }
function uniqueDatabaseRuntimes(databases: readonly ApplicationReactiveDatabaseRuntimeContract[]): readonly ApplicationReactiveDatabaseRuntimeContract[] { const result = new Map<string, ApplicationReactiveDatabaseRuntimeContract>(); for (const database of databases) { const previous = result.get(database.name); if (previous && JSON.stringify(previous) !== JSON.stringify(database)) throw new Error(`Generated reactive runtimes contain conflicting database contracts named ${database.name}.`); result.set(database.name, database); } return [...result.values()].sort((left, right) => left.name.localeCompare(right.name)); }
function uniqueCommandDatabases(commands: readonly GatewayCommandContract[]): readonly NonNullable<ApplicationModelNode['runtime']>[] { const result = new Map<string, NonNullable<ApplicationModelNode['runtime']>>(); for (const command of commands) result.set(command.model.runtime.connectionEnvName, command.model.runtime); return [...result.values()]; }
// typecast: the exact-one guard and provider type predicate establish a present EventLog provider.
function gatewayEventLog(nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>, owner: string): ApplicationProviderNode { const providers = [...nodes.values()].filter((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'EventLog'); if (providers.length !== 1) throw new Error(`Generated gateway ${owner} commands require exactly one EventLog provider.`); return providers[0] as ApplicationProviderNode; }
function eventLogEnvironment(provider?: ApplicationProviderNode): readonly Record<string, unknown>[] { if (!provider) return []; const config = provider.config ?? {}; const secret = objectConfig(config.connectionSecret); const name = stringConfig(secret.name); if (!name) return []; const mode = stringConfig(config.authMode) || 'token'; return mode === 'userPassword' ? [{ name: 'APPLIK8S_NATS_USER', valueFrom: { secretKeyRef: { name, key: stringConfig(config.userKey) || 'user' } } }, { name: 'APPLIK8S_NATS_PASSWORD', valueFrom: { secretKeyRef: { name, key: stringConfig(config.passwordKey) || 'password' } } }] : [{ name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name, key: stringConfig(config.tokenKey) || 'token' } } }]; }
function uniqueEnvironment(entries: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] { const result = new Map<string, Record<string, unknown>>(); for (const entry of entries) { const name = stringConfig(entry.name); const previous = result.get(name); if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`Generated reactive workload has conflicting environment bindings for ${name}.`); result.set(name, entry); } return [...result.values()]; }
function callbackName(id: string, role: string): string { return `${role}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function callbackVariable(id: string, role: string): string { return `callback_${role}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function databaseVariable(name: string): string { return `database_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`; }
function absoluteDependencyImports(source: string, resolveDir: string): string { return source.replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`).replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`); }
// typecast: the object and non-array guards establish the read-only configuration record boundary.
function objectConfig(value: unknown): Readonly<Record<string, unknown>> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}; }
function stringConfig(value: unknown): string { return typeof value === 'string' ? value : ''; }
function kubernetesName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'; }
