// typecast-file-boundary: normalized reactive graph nodes are discriminator-checked before generated runtime contracts regain their specific shapes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ApplicationCommandHandlerNode, ApplicationCommandNode, ApplicationGatewayNode, ApplicationGraph, ApplicationHandlerDependencies, ApplicationModelNode, ApplicationOperationCatalog, ApplicationProjectionNode, ApplicationProviderNode, ApplicationQueryNode, ApplicationReactiveDatabaseRuntimeContract, ApplicationSerializedCallbackContract, ApplicationStreamNode, ApplicationStreamProcessorNode, ApplicationSubscriptionNode } from '@applik8s/core';
import { build } from 'esbuild';
import ts from 'typescript';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { applicationGraphAllConditions, applicationGraphBooleanCondition, applicationGraphNumberValue, applicationGraphServiceHost, applicationGraphStringValue } from '../application-installation-values.js';
import type { ApplicationMcpPlacementRoute } from '../application-mcp/index.js';
import { compileApplicationMcpPlacementRoutes } from '../application-mcp/index.js';
import { applicationStaticAuthorityManifest, compileApplicationOperationCatalog } from '../application-operations/index.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';

const DEFAULT_NODE_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationReactiveResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly rules?: readonly Readonly<Record<string, unknown>>[];
  readonly subjects?: readonly Readonly<Record<string, unknown>>[];
  readonly roleRef?: Readonly<Record<string, unknown>>;
}

export interface GeneratedApplicationReactiveArtifact {
  readonly name: string;
  readonly kind: 'queryGateway' | 'projectionWorker' | 'streamProcessorWorker';
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationReactiveResource[];
}

const DEFAULT_REACTIVE_WORKER_CONTAINERS_PER_POD = 8;

/**
 * Co-locates compatible background runtimes without erasing their artifact,
 * process, checkpoint, retry, or health identities. HTTP gateways retain
 * dedicated Pods because they own Services and may own distinct RBAC.
 */
export function consolidateGeneratedApplicationReactiveResources(options: {
  readonly graphName: string;
  readonly artifacts: readonly GeneratedApplicationReactiveArtifact[];
  readonly maxContainersPerPod?: number;
}): readonly GeneratedApplicationReactiveResource[] {
  const maxContainersPerPod = options.maxContainersPerPod
    ?? DEFAULT_REACTIVE_WORKER_CONTAINERS_PER_POD;
  if (!Number.isInteger(maxContainersPerPod) || maxContainersPerPod < 1 || maxContainersPerPod > 16) {
    throw new Error('Reactive worker co-location requires maxContainersPerPod to be an integer between 1 and 16.');
  }
  const gateways = options.artifacts.filter((artifact) => artifact.kind === 'queryGateway');
  const dedicated = gateways
    .filter(reactiveArtifactOwnsRbac)
    .flatMap((artifact) => artifact.resources);
  const gatewayGroups = reactiveArtifactGroups(
    gateways.filter((artifact) => !reactiveArtifactOwnsRbac(artifact)),
  );
  const consolidatedGateways = [...gatewayGroups.values()].flatMap((group) => {
    const sorted = [...group].sort((left, right) => left.name.localeCompare(right.name));
    const chunks: GeneratedApplicationReactiveArtifact[][] = [];
    for (let index = 0; index < sorted.length; index += maxContainersPerPod) {
      chunks.push(sorted.slice(index, index + maxContainersPerPod));
    }
    return chunks.flatMap((chunk) => chunk.length === 1
      ? chunk[0]!.resources
      : consolidatedReactiveGatewayResources(options.graphName, chunk));
  });
  const groups = reactiveArtifactGroups(options.artifacts.filter((entry) => entry.kind !== 'queryGateway'));
  const consolidatedWorkers = [...groups.values()]
    .flatMap((group) => {
      const sorted = [...group].sort((left, right) => left.name.localeCompare(right.name));
      const chunks: GeneratedApplicationReactiveArtifact[][] = [];
      for (let index = 0; index < sorted.length; index += maxContainersPerPod) {
        chunks.push(sorted.slice(index, index + maxContainersPerPod));
      }
      return chunks.flatMap((chunk) => chunk.length === 1
        ? chunk[0]!.resources
        : consolidatedReactiveWorkerResources(options.graphName, chunk));
    });
  return [...dedicated, ...consolidatedGateways, ...consolidatedWorkers];
}

function reactiveArtifactGroups(
  artifacts: readonly GeneratedApplicationReactiveArtifact[],
): ReadonlyMap<string, readonly GeneratedApplicationReactiveArtifact[]> {
  const groups = new Map<string, GeneratedApplicationReactiveArtifact[]>();
  for (const artifact of artifacts) {
    const deployment = reactiveArtifactDeployment(artifact);
    const metadata = recordValue(deployment.metadata);
    const spec = recordValue(deployment.spec);
    const annotations = recordValue(metadata.annotations);
    const key = JSON.stringify({
      namespace: metadata.namespace,
      replicas: spec.replicas,
      includeWhen: annotations['applik8s.dev/include-when'],
    });
    const group = groups.get(key) ?? [];
    group.push(artifact);
    groups.set(key, group);
  }
  return groups;
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

interface GatewayOnlineProjectionContract {
  readonly query: ApplicationQueryNode;
  readonly projection: ApplicationProjectionNode & { readonly online: NonNullable<ApplicationProjectionNode['online']> };
  readonly stream: ApplicationStreamNode;
  readonly provider: ApplicationProviderNode;
  readonly config: Readonly<Record<string, unknown>>;
}

interface GatewayAnalyticalProjectionContract {
  readonly query: ApplicationQueryNode;
  readonly projection: ApplicationProjectionNode;
  readonly stream: ApplicationStreamNode;
  readonly provider: ApplicationProviderNode;
  readonly config: Readonly<Record<string, unknown>>;
}

interface GatewayKubernetesPermission {
  readonly apiGroup: string;
  readonly resource: string;
  readonly scope: 'Namespaced' | 'Cluster';
  readonly namespace?: string;
}

/** Lowers deployable v0.6 query gateways and analytical/online projections into immutable Node workloads. */
export async function emitGeneratedApplicationReactive(options: { readonly graph: ApplicationGraph; readonly operationCatalog?: ApplicationOperationCatalog; readonly outDir: string; readonly entrypoint: string }): Promise<readonly GeneratedApplicationReactiveArtifact[]> {
  const operationCatalog = options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const mcpRoutes = compileApplicationMcpPlacementRoutes(
    options.graph,
    operationCatalog,
  );
  const gateways = options.graph.nodes.filter((node): node is ApplicationGatewayNode => node.kind === 'gateway' && node.materialization === 'generatedDeployment');
  const projections = options.graph.nodes.filter((node): node is ApplicationProjectionNode => node.kind === 'projection');
  const streamProcessors = options.graph.nodes.filter((node): node is ApplicationStreamProcessorNode => node.kind === 'streamProcessor');
  if (gateways.length === 0 && projections.length === 0 && streamProcessors.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  return [
    ...await Promise.all(gateways.map((gateway) => emitGateway(
      options.graph,
      gateway,
      operationCatalog,
      mcpRoutes.filter((route) => route.receiver.nodeId === gateway.id),
      options.outDir,
    ))),
    ...await Promise.all(projections.map((projection) => emitProjection(options.graph, projection, options.outDir))),
    ...await Promise.all(streamProcessors.map((processor) => emitStreamProcessor(options.graph, processor, options.outDir))),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

async function emitGateway(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  operationCatalog: ApplicationOperationCatalog,
  mcpRoutes: readonly ApplicationMcpPlacementRoute[],
  outDir: string,
): Promise<GeneratedApplicationReactiveArtifact> {
  if (!gateway.deployment || !gateway.cursorSecret || !gateway.authenticationSource) throw new Error(`Generated application gateway ${gateway.id} is missing deployment, cursor Secret, or authentication source.`);
  const gatewayNamespace = applicationGraphStringValue(gateway.deployment.namespace) ?? 'default';
  assertResolved(gateway.id, 'authentication', gateway.authenticationUnresolved);
  assertResolved(gateway.id, 'identity readiness', gateway.identityReadinessUnresolved);
  assertResolved(gateway.id, 'authorization readiness', gateway.authorizationReadinessUnresolved);
  const nodes = graphNodes(graph);
  const queries = gateway.queries.map((reference) => requiredNode(nodes, reference.nodeId, 'query', gateway.id));
  if (serializedInstallationExpression(gatewayNamespace)
    && queries.some((query) => query.kubernetes?.resource.scope === 'Cluster')) {
    throw new Error(`Generated application gateway ${gateway.id} is installation-scoped and cannot own fixed-name cluster RBAC for a cluster-scoped Kubernetes query. Use a separately owned shared gateway or a namespaced resource authority.`);
  }
  const subscriptions = gateway.subscriptions.map((reference): GatewayStreamSubscriptionContract => {
    const subscription = requiredNode(nodes, reference.nodeId, 'subscription', gateway.id);
    const source = nodes.get(subscription.source.nodeId);
    if (source?.kind !== 'stream') throw new Error(`Generated application gateway ${gateway.id} subscription ${subscription.id} must consume a public stream; query subscriptions use the query's existing snapshot/SSE route directly.`);
    assertResolved(subscription.id, 'authorization', subscription.authorizationUnresolved);
    assertResolved(source.id, 'authorization', source.authorizationUnresolved);
    assertSecretNamespace(source.database, gatewayNamespace, `gateway ${gateway.id} stream subscription`);
    return { subscription, stream: source };
  });
  const commands = gateway.commands.map((reference): GatewayCommandContract => {
    const handler = requiredNode(nodes, reference.handler.nodeId, 'commandHandler', gateway.id);
    const command = requiredNode(nodes, reference.command.nodeId, 'command', gateway.id);
    const model = requiredNode(nodes, handler.model.nodeId, 'model', handler.id);
    if (!model.runtime) throw new Error(`Generated application gateway ${gateway.id} command ${command.id} has no model runtime.`);
    assertResourceNamespace(model.runtime.secretNamespace, gatewayNamespace, `Gateway ${gateway.id} command database Secret ${model.runtime.secretName}`);
    // typecast: the runtime guard above establishes the model runtime required by generated command observation.
    return { handler, command, model: model as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> } };
  });
  const commandAuthorityDatabases = new Set(commands.map(({ model }) => model.runtime.connectionEnvName));
  if (commandAuthorityDatabases.size > 1) {
    throw new Error(`Generated application gateway ${gateway.id} commands span multiple transactional authority databases. Bind one explicit AuthorizationAuthority database before exposing a cross-database command gateway.`);
  }
  const eventLog = commands.length > 0 ? gatewayEventLog(nodes, gateway.id) : undefined;
  if (commands.length > 0 && !operationCatalog) {
    throw new Error(`Generated application gateway ${gateway.id} requires its compiled operation catalog.`);
  }
  if (
    mcpRoutes.length > 0
    && !gatewayAuthorityDatabaseEnvironment(queries, commands, subscriptions)
  ) {
    throw new Error(
      `Generated application gateway ${gateway.id} requires one transactional operation-authority database before it can receive MCP placement invocations.`,
    );
  }
  if (eventLog) {
    const connectionSecret = objectConfig(eventLog.config?.connectionSecret);
    assertResourceNamespace(connectionSecret.namespace, gatewayNamespace, `Gateway ${gateway.id} EventLog Secret`);
  }
  for (const query of queries) {
    assertResolved(query.id, 'authorization', query.authorizationUnresolved);
    if (query.kubernetes) {
      for (const [property, callback] of kubernetesQueryCallbacks(query)) assertResolved(query.id, `Kubernetes ${property}`, callback.unresolved);
    } else {
      assertResolved(query.id, 'handler', query.handlerUnresolved);
      if (!query.database) throw new Error(`Generated application gateway ${gateway.id} query ${query.id} has no PostgreSQL or Kubernetes snapshot authority.`);
      assertSecretNamespace(query.database, gatewayNamespace, `gateway ${gateway.id}`);
    }
    if (query.projection) {
      if (query.projection.storage === 'online') {
        const online = gatewayOnlineProjectionContract(graph, query);
        const authentication = objectConfig(online.config.authentication);
        const passwordSecret = objectConfig(authentication.secret);
        assertResourceNamespace(passwordSecret.namespace, gatewayNamespace, `Gateway ${gateway.id} query ${query.id} Valkey password Secret`);
      } else {
        const analytical = gatewayAnalyticalProjectionContract(graph, query);
        const credentials = objectConfig(analytical.config.credentialsSecret);
        assertResourceNamespace(credentials.namespace, gatewayNamespace, `Gateway ${gateway.id} query ${query.id} ClickHouse credentials Secret`);
      }
    }
  }
  assertResourceNamespace(gateway.cursorSecret.namespace, gatewayNamespace, `Gateway ${gateway.id} cursor Secret`);
  const name = kubernetesName(`${graph.metadata.name}-${gateway.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'authentication', gateway.authenticationSource, gateway.authenticationDependencies);
  if (gateway.identityReadinessSource) await writeCallbackModule(artifactDir, 'identity-readiness', gateway.identityReadinessSource, gateway.identityReadinessDependencies);
  if (gateway.authorizationReadinessSource) await writeCallbackModule(artifactDir, 'authorization-readiness', gateway.authorizationReadinessSource, gateway.authorizationReadinessDependencies);
  if (commands.length > 0 && gateway.commandAuthorizationSource) await writeGatewayCommandAuthorizationModule(artifactDir, gateway.commandAuthorizationSource, gateway.commandAuthorizationDependencies, graph);
  for (const { subscription, stream } of subscriptions) {
    await writeCallbackModule(artifactDir, callbackName(subscription.id, 'authorize'), subscription.authorizationSource, subscription.authorizationDependencies);
    await writeCallbackModule(artifactDir, callbackName(stream.id, 'authorize-stream'), stream.authorizationSource, stream.authorizationDependencies);
  }
  for (const query of queries) {
    await writeQueryCallbackModule(artifactDir, callbackName(query.id, 'authorize'), query.authorizationSource, query.authorizationDependencies, query, graph);
    if (query.kubernetes) {
      for (const [property, callback] of kubernetesQueryCallbacks(query)) {
        await writeQueryCallbackModule(artifactDir, callbackName(query.id, kubernetesCallbackRole(property)), callback.source, callback.dependencies, query, graph);
      }
    } else {
      await writeQueryCallbackModule(artifactDir, callbackName(query.id, 'run'), query.handlerSource, query.handlerDependencies, query, graph);
    }
  }
  const entrypoint = join(artifactDir, 'gateway.generated.ts');
  await writeFile(entrypoint, generatedGatewaySource(
    graph,
    gateway,
    queries,
    commands,
    subscriptions,
    operationCatalog,
    eventLog,
    mcpRoutes,
  ));
  return bundleReactive({
    graphName: graph.metadata.name, name, kind: 'queryGateway', namespace: gatewayNamespace,
    image: gateway.deployment.image || DEFAULT_NODE_IMAGE,
    replicas: applicationGraphNumberValue(gateway.deployment.replicas) ?? 1,
    port: gateway.deployment.port, entrypoint, artifactDir,
    env: gatewayEnvironment(
      graph,
      gateway,
      queries,
      commands,
      subscriptions,
      eventLog,
      mcpRoutes.length > 0,
    ),
    permissions: gatewayKubernetesPermissions(queries, gatewayNamespace),
  });
}

async function emitProjection(graph: ApplicationGraph, projection: ApplicationProjectionNode, outDir: string): Promise<GeneratedApplicationReactiveArtifact> {
  assertResolved(projection.id, 'handler', projection.handlerUnresolved);
  const nodes = graphNodes(graph);
  const stream = requiredNode(nodes, projection.source.nodeId, 'stream', projection.id);
  assertResolved(stream.id, 'partition', stream.partitionUnresolved);
  assertResolved(stream.id, 'authorization', stream.authorizationUnresolved);
  const provider = requiredProvider(nodes, projection.provider.nodeId, projection.id);
  if (projection.storage === 'online' || projection.online) return emitOnlineProjection(graph, projection, stream, provider, outDir);
  if (provider.interface !== 'AnalyticalDatabase' || provider.implementation !== 'clickhouse') throw new Error(`Generated analytical projection ${projection.id} requires one ClickHouse AnalyticalDatabase provider.`);
  const config = provider.config ?? {};
  const namespace = applicationGraphStringValue(config.namespace) || applicationGraphStringValue(stream.database.secretNamespace) || applicationGraphStringValue(graph.metadata.namespace) || 'default';
  assertSecretNamespace(stream.database, namespace, `projection ${projection.id}`);
  const credentials = objectConfig(config.credentialsSecret);
  assertResourceNamespace(credentials.namespace, namespace, `Projection ${projection.id} ClickHouse credentials Secret`);
  const name = kubernetesName(`${graph.metadata.name}-${projection.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'project', projection.handlerSource, projection.handlerDependencies);
  const entrypoint = join(artifactDir, 'projection.generated.ts');
  await writeFile(entrypoint, generatedProjectionSource(projection, stream, provider));
  const env = projectionEnvironment(stream, config);
  const includeWhen = applicationGraphBooleanCondition(config.enabled);
  return bundleReactive({
    graphName: graph.metadata.name,
    name,
    kind: 'projectionWorker',
    namespace,
    image: DEFAULT_NODE_IMAGE,
    replicas: 1,
    port: 8080,
    entrypoint,
    artifactDir,
    env,
    ...(includeWhen !== undefined ? { includeWhen } : {}),
  });
}

async function emitOnlineProjection(
  graph: ApplicationGraph,
  projection: ApplicationProjectionNode,
  stream: ApplicationStreamNode,
  provider: ApplicationProviderNode,
  outDir: string,
): Promise<GeneratedApplicationReactiveArtifact> {
  if (!projection.online) throw new Error(`Generated online projection ${projection.id} is missing its online semantics.`);
  if (provider.interface !== 'IndexStore' || provider.implementation !== 'valkey') throw new Error(`Generated online projection ${projection.id} requires one Valkey-compatible IndexStore provider.`);
  for (const [label, unresolved] of [
    ['partition', projection.online.partitionUnresolved], ['key', projection.online.keyUnresolved],
    ['score', projection.online.scoreUnresolved], ['value', projection.online.valueUnresolved],
    ['remove', projection.online.removeUnresolved],
  ] as const) assertResolved(projection.id, label, unresolved);
  const config = objectConfig(provider.config?.indexStore);
  const namespace = applicationGraphStringValue(config.namespace) || applicationGraphStringValue(stream.database.secretNamespace) || applicationGraphStringValue(graph.metadata.namespace) || 'default';
  assertSecretNamespace(stream.database, namespace, `online projection ${projection.id}`);
  const authentication = objectConfig(config.authentication);
  const passwordSecret = objectConfig(authentication.secret);
  assertResourceNamespace(passwordSecret.namespace, namespace, `Online projection ${projection.id} Valkey password Secret`);
  const name = kubernetesName(`${graph.metadata.name}-${projection.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'project', projection.handlerSource, projection.handlerDependencies);
  await writeCallbackModule(artifactDir, 'partition', projection.online.partitionSource, projection.online.partitionDependencies);
  await writeCallbackModule(artifactDir, 'key', projection.online.keySource, projection.online.keyDependencies);
  await writeCallbackModule(artifactDir, 'score', projection.online.scoreSource, projection.online.scoreDependencies);
  await writeCallbackModule(artifactDir, 'value', projection.online.valueSource, projection.online.valueDependencies);
  if (projection.online.removeSource) await writeCallbackModule(artifactDir, 'remove', projection.online.removeSource, projection.online.removeDependencies);
  const entrypoint = join(artifactDir, 'projection.generated.ts');
  await writeFile(entrypoint, generatedValkeyProjectionSource(graph.metadata.name, projection, stream, config));
  const environment = onlineProjectionEnvironment(stream, authentication, config, graph.metadata.name);
  return bundleReactive({ graphName: graph.metadata.name, name, kind: 'projectionWorker', namespace, image: DEFAULT_NODE_IMAGE, replicas: 1, port: 8080, entrypoint, artifactDir, env: environment });
}

async function emitStreamProcessor(graph: ApplicationGraph, processor: ApplicationStreamProcessorNode, outDir: string): Promise<GeneratedApplicationReactiveArtifact> {
  assertResolved(processor.id, 'handler', processor.handlerUnresolved);
  const nodes = graphNodes(graph);
  const stream = requiredNode(nodes, processor.source.nodeId, 'stream', processor.id);
  assertResolved(stream.id, 'partition', stream.partitionUnresolved);
  assertResolved(stream.id, 'authorization', stream.authorizationUnresolved);
  const namespace = applicationGraphStringValue(processor.database.secretNamespace) || applicationGraphStringValue(graph.metadata.namespace) || 'default';
  assertSecretNamespace(processor.database, namespace, `stream processor ${processor.id}`);
  const workflow = streamProcessorWorkflowContract(graph, processor, namespace);
  const name = kubernetesName(`${graph.metadata.name}-${processor.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeCallbackModule(artifactDir, 'handle', processor.handlerSource, processor.handlerDependencies);
  const entrypoint = join(artifactDir, 'stream-processor.generated.ts');
  await writeFile(entrypoint, generatedStreamProcessorSource(processor, stream, workflow));
  const includeWhen = applicationGraphAllConditions(processor.enabled, workflow?.provider.config?.enabled);
  return bundleReactive({
    graphName: graph.metadata.name,
    name,
    kind: 'streamProcessorWorker',
    namespace,
    image: DEFAULT_NODE_IMAGE,
    replicas: processor.deployment.replicas,
    port: 8080,
    entrypoint,
    artifactDir,
    env: [
      { name: processor.database.connectionEnvName, valueFrom: { secretKeyRef: { name: processor.database.secretName, key: processor.database.secretKey } } },
      { name: 'APPLIK8S_PROCESSOR_CONCURRENCY', value: reactiveEnvironmentInteger(processor.deployment.concurrency) },
      { name: 'APPLIK8S_PROCESSOR_MAX_ACK_PENDING', value: reactiveEnvironmentInteger(processor.deployment.maxAckPending) },
      ...streamProcessorScheduleEnvironment(workflow),
    ],
    ...(workflow ? { workflowToken: streamProcessorWorkflowCredential(workflow) } : {}),
    ...(includeWhen !== undefined ? { includeWhen } : {}),
  });
}

interface StreamProcessorWorkflowContract {
  readonly provider: ApplicationProviderNode;
  readonly schedules: NonNullable<ApplicationStreamProcessorNode['schedules']>;
  readonly tasks: NonNullable<ApplicationStreamProcessorNode['tasks']>;
}

function streamProcessorWorkflowContract(graph: ApplicationGraph, processor: ApplicationStreamProcessorNode, namespace: string): StreamProcessorWorkflowContract | undefined {
  const schedules = processor.schedules ?? [];
  const tasks = processor.tasks ?? [];
  if (schedules.length + tasks.length === 0) return undefined;
  const nodes = graphNodes(graph);
  const provider = requiredProvider(nodes, processor.workflowEngine?.nodeId ?? '', processor.id);
  if (provider.interface !== 'WorkflowEngine' || provider.implementation !== 'hatchet') throw new Error(`Generated stream processor ${processor.id} durable tasks and recurring schedules require the Hatchet WorkflowEngine adapter.`);
  const config = provider.config ?? {};
  for (const binding of schedules) {
    const target = nodes.get(binding.target.nodeId);
    if (target?.kind !== 'task' && target?.kind !== 'workflow') throw new Error(`Generated stream processor ${processor.id} schedule ${binding.alias} references missing task/workflow ${binding.target.nodeId}.`);
    if (target.contract.name !== binding.contract.name || target.contract.version !== binding.contract.version) throw new Error(`Generated stream processor ${processor.id} schedule ${binding.alias} contract drifted from ${binding.target.nodeId}.`);
  }
	for (const binding of tasks) {
		const target = nodes.get(binding.target.nodeId);
		if (target?.kind !== 'task') throw new Error(`Generated stream processor ${processor.id} task ${binding.alias} references missing task ${binding.target.nodeId}.`);
		if (target.contract.name !== binding.contract.name || target.contract.version !== binding.contract.version || JSON.stringify(target.contract.input) !== JSON.stringify(binding.contract.input) || JSON.stringify(target.contract.output) !== JSON.stringify(binding.contract.output)) throw new Error(`Generated stream processor ${processor.id} task ${binding.alias} contract drifted from ${binding.target.nodeId}.`);
	}
  const worker = objectConfig(config.workerTokenSecret);
  assertResourceNamespace(worker.namespace, namespace, `Stream processor ${processor.id} WorkflowEngine worker Secret`);
  return { provider, schedules, tasks };
}

async function bundleReactive(options: { readonly graphName: string; readonly name: string; readonly kind: GeneratedApplicationReactiveArtifact['kind']; readonly namespace: string; readonly image: string; readonly replicas: number | string; readonly port: number; readonly entrypoint: string; readonly artifactDir: string; readonly env: readonly Record<string, unknown>[]; readonly includeWhen?: string; readonly permissions?: readonly GatewayKubernetesPermission[]; readonly workflowToken?: { readonly secretName: string; readonly key: string } }): Promise<GeneratedApplicationReactiveArtifact> {
  const sourcePath = join(options.artifactDir, 'runtime.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const metafilePath = join(options.artifactDir, 'runtime.esbuild-meta.json');
  const manifestPath = join(options.artifactDir, 'runtime.manifest.json');
  const result = await build({
    entryPoints: [options.entrypoint], outfile: sourcePath, bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: true,
    legalComments: 'none', sourcemap: 'external', sourcesContent: false, metafile: true, nodePaths: [join(process.cwd(), 'node_modules')], plugins: [applik8sWorkspaceSourcePlugin()],
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: options.graphName,
    workloadName: options.name,
    role: options.kind,
    artifactDir: options.artifactDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/runtime.mjs',
    baseImage: options.image,
    sourceDigest: digest,
  });
  const resources = reactiveResources(options, container.image, digest);
  const manifestKind = options.kind === 'queryGateway' ? 'GeneratedQueryGateway' : options.kind === 'projectionWorker' ? 'GeneratedProjectionWorker' : 'GeneratedStreamProcessorWorker';
  await writeFile(manifestPath, `${JSON.stringify({ apiVersion: 'applik8s.reactive/v1alpha1', kind: manifestKind, metadata: { name: options.name }, spec: { graph: options.graphName, digest, sizeBytes, distribution: 'ociImage', image: container.image, baseImage: container.baseImage, container, namespace: options.namespace, resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })) } }, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return { name: options.name, kind: options.kind, sourcePath, sourceMapPath, manifestPath, metafilePath, digest, sizeBytes, container, resources };
}

function generatedGatewaySource(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  subscriptions: readonly GatewayStreamSubscriptionContract[],
  operationCatalog: ApplicationOperationCatalog,
  eventLog: ApplicationProviderNode | undefined,
  mcpRoutes: readonly ApplicationMcpPlacementRoute[],
): string {
  const gatewayNamespace = applicationGraphStringValue(gateway.deployment?.namespace) ?? 'default';
  const relationalQueries = queries.filter((query) => !query.kubernetes);
  const kubernetesQueries = queries.filter((query) => Boolean(query.kubernetes));
  const onlineSources = relationalQueries.flatMap((query) => query.projection?.storage === 'online' ? [gatewayOnlineProjectionContract(graph, query)] : []);
  const analyticalSources = relationalQueries.flatMap((query) => query.projection?.storage === 'analytical' ? [gatewayAnalyticalProjectionContract(graph, query)] : []);
  const imports = [
    "import { createServer } from 'node:http';",
    "import postgres from 'postgres';",
    "import { drizzle } from 'drizzle-orm/postgres-js';",
    "import { normalizeSchema } from '@applik8s/sdk/schema-runtime';",
    `import { applicationRequestContextValues, createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationRelationalContext, createApplicationSubscriptionLimiter${relationalQueries.length > 0 && kubernetesQueries.length > 0 ? ', proxyApplicationQueryMultiplex' : ''} } from '@applik8s/applik8s/query-runtime';`,
    "import { verifyApplicationTaskQueryAdmission } from '@applik8s/applik8s/task-query-runtime';",
    ...(onlineSources.length > 0 ? ["import { createValkeyOnlineProjectionReader } from '@applik8s/applik8s/projection-worker-runtime';"] : []),
    ...(analyticalSources.length > 0 ? ["import { createClickHouseAnalyticalProjectionReader } from '@applik8s/applik8s/projection-worker-runtime';"] : []),
    ...(commands.length > 0 ? ["import { createApplicationCommandGateway } from '@applik8s/applik8s/command-gateway-runtime';", "import { createJetStreamEventLog } from '@applik8s/runtime-nats/event-log';"] : []),
    ...(gatewayAuthorityDatabaseEnvironment(queries, commands, subscriptions)
      ? ["import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';"]
      : []),
    ...(mcpRoutes.length > 0
      ? ["import { createApplicationInternalOperationHandler } from '@applik8s/operations';"]
      : []),
    ...(subscriptions.length > 0 ? ["import { applicationAdmittedContextDigest, createApplicationStreamSubscriptionGateway, createPostgresApplicationStream } from '@applik8s/applik8s/subscription-runtime';"] : []),
    ...(kubernetesQueries.length > 0 ? ["import { createApplik8sKubernetesGateway } from '@applik8s/server/kubernetes-gateway';"] : []),
    "import { callback as authenticateRequest } from './authentication.generated.js';",
    ...(gateway.identityReadinessSource ? ["import { callback as verifyIdentityReadiness } from './identity-readiness.generated.js';"] : []),
    ...(gateway.authorizationReadinessSource ? ["import { callback as verifyAuthorizationReadiness } from './authorization-readiness.generated.js';"] : []),
    ...queries.flatMap((query) => [
      `import { callback as ${callbackVariable(query.id, 'authorize')} } from './${callbackName(query.id, 'authorize')}.generated.js';`,
      ...(!query.kubernetes ? [`import { callback as ${callbackVariable(query.id, 'run')} } from './${callbackName(query.id, 'run')}.generated.js';`] : []),
      ...kubernetesQueryCallbacks(query).map(([property]) => {
        const role = kubernetesCallbackRole(property);
        return `import { callback as ${callbackVariable(query.id, role)} } from './${callbackName(query.id, role)}.generated.js';`;
      }),
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
  const onlineSourceDeclarations = onlineSources.map((contract) => generatedGatewayOnlineProjectionSource(graph.metadata.name, contract)).join('\n');
  const analyticalSourceDeclarations = analyticalSources.map(generatedGatewayAnalyticalProjectionSource).join('\n');
  const projectionSourceByQuery = new Map([
    ...onlineSources.map((contract) => [contract.query.id, projectionQuerySourceVariable(contract.query.id)] as const),
    ...analyticalSources.map((contract) => [contract.query.id, projectionQuerySourceVariable(contract.query.id)] as const),
  ]);
  const queryDeclarations = relationalQueries.map((query) => generatedQueryBinding(query, graphReadNames(graph, query), projectionSourceByQuery.get(query.id))).join(',\n');
  const kubernetesQueryDeclarations = kubernetesQueries.map((query) => generatedKubernetesQueryBinding(query, graph, gatewayNamespace)).join(',\n');
  const authorityDatabaseEnvironment = gatewayAuthorityDatabaseEnvironment(queries, commands, subscriptions);
  const operationAuthority = authorityDatabaseEnvironment
    ? generatedGatewayOperationAuthority(graph, authorityDatabaseEnvironment, operationCatalog)
    : '';
  const commandGateway = commands.length > 0 && eventLog && operationCatalog
    ? generatedCommandGateway(graph, gateway, commands, operationCatalog, eventLog)
    : 'const commandGateway = undefined;';
  const streamGateway = generatedStreamSubscriptionGateway(
    graph,
    gateway,
    subscriptions,
    operationCatalog,
    Boolean(authorityDatabaseEnvironment),
  );
  const internalOperationHandler = generatedGatewayInternalOperationHandler(
    graph,
    gateway,
    queries,
    commands,
    operationCatalog,
    mcpRoutes,
    Boolean(authorityDatabaseEnvironment),
  );
  const mixedQueryMultiplex = relationalQueries.length > 0 && kubernetesQueries.length > 0
    ? `const relationalQueryIds = new Set(${JSON.stringify(relationalQueries.map((query) => query.publicId ?? `${query.name}.${query.version}`))});
const kubernetesQueryIds = new Set(${JSON.stringify(kubernetesQueries.map((query) => query.publicId ?? `${query.name}.${query.version}`))});
async function handleMixedQueryMultiplex(request) {
  return proxyApplicationQueryMultiplex(request, {
    resolve: (query) => relationalQueryIds.has(query)
      ? { id: 'relational', handle }
      : kubernetesQueryIds.has(query)
        ? { id: 'kubernetes', handle: (targetRequest) => kubernetesGateway.handle(prefixKubernetesRequest(targetRequest)) }
        : undefined,
    onUpstreamError: (error, targets) => console.error('Mixed query multiplex upstream failed for ' + targets.join(', ') + ':', error),
  });
}`
    : 'async function handleMixedQueryMultiplex() { return undefined; }';
  return `${imports}

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function requiredIntegerEnv(name, minimum, maximum) { const value = Number(requiredEnv(name)); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum + '.'); return value; }
function schema(json, name) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name); const validate = (value) => { const result = normalized.validate(value); return result.ok ? result.value : { summary: result.error.message }; }; validate.toJsonSchema = () => json; return validate; }
function strictSchema(json, name) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name); return (value) => { const result = normalized.validate(value); if (!result.ok) throw new Error(name + ' validation failed.'); return result.value; }; }
${databaseDeclarations}
${onlineSourceDeclarations}
${analyticalSourceDeclarations}
${operationAuthority}
${authorityDatabaseEnvironment ? `async function admitGatewayPrincipal(admission, trustedContextDigest) {
  return operationAuthority.admitPrincipal({
    id: admission.principal.id,
    identity: admission.principal.identity,
    kind: admission.principal.kind,
    authenticationMethod: admission.principal.authenticationMethod,
    audience: [${JSON.stringify(gateway.id)}],
    ...(admission.principal.expiresAt ? { expiresAt: admission.principal.expiresAt } : {}),
    ...(admission.principal.sessionId ? { sessionId: admission.principal.sessionId } : {}),
    ...(admission.principal.clientId ? { clientId: admission.principal.clientId } : {}),
    ...(admission.principal.flowId ? { flowId: admission.principal.flowId } : {}),
  }, trustedContextDigest);
}` : ''}
const queries = [${queryDeclarations}];
const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');
const subscriptionLimiter = createApplicationSubscriptionLimiter(${JSON.stringify(gateway.subscriptionLimits)});
async function admitRequest(request) { const admitted = await authenticateRequest(request); if (!admitted || typeof admitted !== 'object') throw new Error('Gateway authentication returned no admission.'); return admitted; }
async function admitQuery(request, query, input) { const internal = verifyApplicationTaskQueryAdmission({ request, cursorSecret, audience: ${JSON.stringify(gateway.id)}, query: query.id, input }); return internal ?? admitRequest(request); }
const gateway = queries.length > 0 ? createApplicationQueryGateway({
  queries,
  cursorSecret,
  subscriptionLimits: ${JSON.stringify(gateway.subscriptionLimits)},
  subscriptionLimiter,
  authenticate: async (request, query, input) => {
    const admitted = await admitQuery(request, query, input);
    const trustedContext = admitted.trustedContext ?? {};
    const trustedContextDigest = applicationAdmittedContextDigest({ values: trustedContext, digestSecret: cursorSecret });
    const principal = ${authorityDatabaseEnvironment ? 'await admitGatewayPrincipal(admitted, trustedContextDigest)' : 'admitted.principal'};
    return {
      principal,
      admittedContext: {
        values: applicationRequestContextValues(principal, principal.authorityRevision, trustedContext),
        digestSecret: cursorSecret,
      },
    };
  },
  ${authorityDatabaseEnvironment ? generatedQueryAuthority(graph, gateway, relationalQueries, operationCatalog) : ''}
  context: (identity) => createApplicationRelationalContext({ databases: [${databases.map((database) => `{ binding: ${databaseVariable(database.name)}Binding, db: ${databaseVariable(database.name)}Db }`).join(', ')}], admittedContext: identity.admittedContext }),
}) : undefined;
const kubernetesGateway = ${kubernetesQueries.length > 0 ? `createApplik8sKubernetesGateway({
  authenticate: async (request, operation) => operation?.kind === 'query' ? admitQuery(request, operation, operation.input) : admitRequest(request),
  cursorSecret,
  queries: [${kubernetesQueryDeclarations}],
  subscriptionLimits: ${JSON.stringify(gateway.subscriptionLimits)},
})` : 'undefined'};
${commandGateway}
${streamGateway}
${internalOperationHandler}
const handle = gateway ? createApplicationQueryGatewayHttpHandler(gateway, { basePath: ${JSON.stringify(gateway.routes.snapshots.split('/:query/')[0]?.replace(/^\//, '') || 'queries')} }) : undefined;
${mixedQueryMultiplex}
let ready = false; let stopping = false; let lastDependencyError; let degradedDependencyError;
const dependencyMonitor = new AbortController();
const server = createServer(async (incoming, outgoing) => { const requestController = new AbortController(); const abortRequest = () => requestController.abort(); incoming.once('aborted', abortRequest); outgoing.once('close', abortRequest); try { if (incoming.url === '/live' || incoming.url === '/ready') { const ok = incoming.url === '/live' || (ready && !stopping); outgoing.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ ready, stopping, lastDependencyError, degradedDependencyError })); return; } const request = await webRequest(incoming, requestController.signal); const internalResponse = internalOperationHandler ? await internalOperationHandler(request.clone()) : undefined; const multiplexResponse = internalResponse || await handleMixedQueryMultiplex(request.clone()); const commandResponse = multiplexResponse || !commandGateway ? undefined : await commandGateway.handle(request.clone()); const streamResponse = multiplexResponse || commandResponse || !streamGateway ? undefined : await streamGateway.handle(request.clone()); const kubernetesResponse = multiplexResponse || commandResponse || streamResponse || !kubernetesGateway ? undefined : await kubernetesGateway.handle(prefixKubernetesRequest(request.clone())); const relationalResponse = multiplexResponse || commandResponse || streamResponse || (kubernetesResponse && kubernetesResponse.status !== 404) || !handle ? undefined : await handle(request); await writeResponse(outgoing, internalResponse ?? multiplexResponse ?? commandResponse ?? streamResponse ?? (kubernetesResponse?.status !== 404 ? kubernetesResponse : undefined) ?? relationalResponse ?? new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })); } catch (error) { if (!requestController.signal.aborted) { console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'internal_error' })); } } finally { incoming.removeListener('aborted', abortRequest); outgoing.removeListener('close', abortRequest); } });
server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? '${gateway.deployment?.port ?? 8080}'), '0.0.0.0');
async function monitorDependencies() { while (!stopping) { try { await Promise.all([${authorityDatabaseEnvironment ? 'prepareOperationAuthority(),' : ''}${databases.map((database) => `${databaseVariable(database.name)}Sql.unsafe('SELECT 1 AS applik8s_ready')`).join(', ')}, ...(commandGateway ? [commandGateway.ready()] : []), ...(kubernetesGateway ? [kubernetesGateway.ready()] : []), ${gateway.identityReadinessSource ? 'verifyIdentityReadiness()' : 'Promise.resolve()'}, ${gateway.authorizationReadinessSource ? 'verifyAuthorizationReadiness()' : 'Promise.resolve()'}]); const degraded = (await Promise.all([${[...onlineSources, ...analyticalSources].map((contract) => `recoverableProjectionReadiness(() => ${projectionQuerySourceVariable(contract.query.id)}.revision())`).join(', ')}])).filter(Boolean); ready = true; lastDependencyError = undefined; degradedDependencyError = degraded[0]; } catch (error) { ready = false; lastDependencyError = providerReadinessError(error); degradedDependencyError = undefined; if (!stopping) console.error(lastDependencyError); } await abortableSleep(5000, dependencyMonitor.signal); } }
const dependencyMonitorTask = monitorDependencies();
function providerReadinessError(error) { return error instanceof Error ? error.message : 'Application provider readiness failed closed.'; }
async function recoverableProjectionReadiness(check) { try { await check(); } catch (error) { if (!isRecoverableProjectionReadinessError(error)) throw error; return error instanceof Error ? error.message : String(error); } }
function isRecoverableProjectionReadinessError(error) { if (!error || typeof error !== 'object') return false; const code = Reflect.get(error, 'code'); return code === 'APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE' || code === 'APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED'; }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
async function webRequest(request, signal) { const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await new Promise((resolve, reject) => { const chunks = []; request.on('data', (chunk) => chunks.push(chunk)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); return new Request('http://' + (request.headers.host ?? 'localhost') + (request.url ?? '/'), { method: request.method, headers: Object.entries(request.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value === undefined ? [] : [[key, value]]), signal, ...(body ? { body, duplex: 'half' } : {}) }); }
function prefixKubernetesRequest(request) { const url = new URL(request.url); url.pathname = '/__applik8s/v1' + (url.pathname.startsWith('/') ? url.pathname : '/' + url.pathname); return new Request(url, request); }
async function writeResponse(response, web) { response.writeHead(web.status, Object.fromEntries(web.headers)); if (!web.body) { response.end(); return; } const reader = web.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once('drain', resolve)); } response.end(); }
async function shutdown() { if (stopping) return; stopping = true; ready = false; dependencyMonitor.abort(); await new Promise((resolve) => server.close(resolve)); await dependencyMonitorTask; await Promise.all([${databases.map((database) => `${databaseVariable(database.name)}Sql.end({ timeout: 5 })`).join(', ')}${operationAuthority ? ', operationAuthoritySql.end({ timeout: 5 })' : ''}, ...(commandGateway ? [commandGateway.close()] : []), ...(kubernetesGateway ? [kubernetesGateway.close()] : [])]); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
`;
}

function generatedQueryBinding(query: ApplicationQueryNode, modelNames: readonly string[], projectionSource?: string): string {
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const database = query.database;
  if (!database) throw new Error(`Generated query ${query.id} has no database runtime.`);
  const contexts = query.trustedContext.map((name) => {
    const access = database.access?.context === name ? database.access : undefined;
    if (!access) throw new Error(`Generated query ${query.id} trusted context ${name} has no serializable database access schema.`);
    return `{ kind: 'applicationTrustedContext', name: ${JSON.stringify(name)}, schema: schema(${JSON.stringify(access.contextSchema)}, ${JSON.stringify(name)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(access.contextSchema)} } }`;
  });
  return `{ kind: 'applicationQuery', id: ${JSON.stringify(id)}, name: ${JSON.stringify(query.name)}, version: ${JSON.stringify(query.version)}, input: schema(${JSON.stringify(query.input.jsonSchema)}, ${JSON.stringify(`${id}.input`)}), output: schema(${JSON.stringify(query.output.jsonSchema)}, ${JSON.stringify(`${id}.output`)}), database: ${databaseVariable(database.name)}Binding, ${projectionSource ? `sourceRuntime: ${projectionSource},` : ''} trustedContext: [${contexts.join(', ')}], reads: ${JSON.stringify(modelNames.map((name) => ({ $model: { name } })))}, budgets: ${JSON.stringify(query.budgets)}, authorize: async (principal, input, context = {}) => ${callbackVariable(query.id, 'authorize')}({ principal, context, input }), run: async (context, principal, input, source) => ${callbackVariable(query.id, 'run')}({ context, principal, input${projectionSource ? ', source' : ''} }) }`;
}

function generatedKubernetesQueryBinding(query: ApplicationQueryNode, graph: ApplicationGraph, gatewayNamespace: string): string {
  const authority = query.kubernetes;
  if (!authority) throw new Error(`Generated query ${query.id} lost its Kubernetes authority.`);
  const model = requiredNode(graphNodes(graph), authority.model.nodeId, 'crd', query.id);
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const callback = (property: string) => callbackVariable(query.id, kubernetesCallbackRole(property));
  const fixedNamespace = authority.namespace
    ? serializedInstallationExpression(authority.namespace)
      ? `requiredEnv(${JSON.stringify(kubernetesQueryNamespaceEnvironmentName(query.id))})`
      : JSON.stringify(authority.namespace)
    : undefined;
  const allowedNamespace = authority.resource.scope === 'Namespaced'
    ? fixedNamespace ?? (authority.namespaceResolver ? "requiredEnv('APPLIK8S_NAMESPACE')" : undefined)
    : undefined;
  if (authority.resource.scope === 'Namespaced' && !allowedNamespace) {
    throw new Error(`Generated query ${query.id} must declare a fixed namespace or a namespace resolver bounded to gateway namespace ${gatewayNamespace}.`);
  }
  return `{
    id: ${JSON.stringify(id)},
    model: ${JSON.stringify(model.name)},
    resource: ${JSON.stringify(authority.resource)},
    inputSchema: ${JSON.stringify(query.input.jsonSchema)},
    outputSchema: ${JSON.stringify(query.output.jsonSchema)},
    budgets: ${JSON.stringify(query.budgets)},
    bounds: ${JSON.stringify({ pageSize: authority.pageSize, maxPages: authority.maxPages, maxItems: authority.maxItems })},
    ${allowedNamespace ? `allowedNamespaces: [${allowedNamespace}],` : ''}
    authorize: (request) => ${callbackVariable(query.id, 'authorize')}(request),
    ${fixedNamespace ? `fixedNamespace: ${fixedNamespace},` : ''}
    ${authority.namespaceResolver ? `namespace: (request) => ${callback('namespaceResolver')}(request),` : ''}
    ${authority.labelSelector ? `labelSelector: (request) => ${callback('labelSelector')}(request),` : ''}
    ${authority.fieldSelector ? `fieldSelector: (request) => ${callback('fieldSelector')}(request),` : ''}
    ${authority.filter ? `filter: (request) => ${callback('filter')}(request),` : ''}
    ${authority.compare ? `compare: (request) => ${callback('compare')}(request),` : ''}
    project: (request) => ${callback('project')}(request),
    ${authority.limit ? `limit: (request) => ${callback('limit')}(request),` : ''}
  }`;
}

function kubernetesQueryCallbacks(query: ApplicationQueryNode): readonly (readonly [string, ApplicationSerializedCallbackContract])[] {
  const authority = query.kubernetes;
  if (!authority) return [];
  const candidates: readonly (readonly [string, ApplicationSerializedCallbackContract | undefined])[] = [
    ['namespaceResolver', authority.namespaceResolver],
    ['labelSelector', authority.labelSelector],
    ['fieldSelector', authority.fieldSelector],
    ['filter', authority.filter],
    ['compare', authority.compare],
    ['project', authority.project],
    ['limit', authority.limit],
  ];
  const callbacks: (readonly [string, ApplicationSerializedCallbackContract])[] = [];
  for (const [property, callback] of candidates) if (callback) callbacks.push([property, callback]);
  return callbacks;
}

function kubernetesCallbackRole(property: string): string {
  return `kubernetes${property.slice(0, 1).toUpperCase()}${property.slice(1)}`;
}

function gatewayKubernetesPermissions(queries: readonly ApplicationQueryNode[], gatewayNamespace: string): readonly GatewayKubernetesPermission[] {
  const permissions = new Map<string, GatewayKubernetesPermission>();
  for (const query of queries) {
    const authority = query.kubernetes;
    if (!authority) continue;
    const [apiGroup = ''] = authority.resource.apiVersion.includes('/') ? authority.resource.apiVersion.split('/') : [''];
    const namespace = authority.resource.scope === 'Namespaced'
      ? authority.namespace ?? (authority.namespaceResolver ? gatewayNamespace : undefined)
      : undefined;
    if (authority.resource.scope === 'Namespaced' && !namespace) {
      throw new Error(`Generated query ${query.id} must declare a fixed namespace or a namespace resolver bounded to gateway namespace ${gatewayNamespace}.`);
    }
    const permission: GatewayKubernetesPermission = {
      apiGroup,
      resource: authority.resource.plural,
      scope: authority.resource.scope,
      ...(namespace ? { namespace } : {}),
    };
    permissions.set(`${permission.scope}:${permission.namespace ?? '*'}:${permission.apiGroup}:${permission.resource}`, permission);
  }
  return [...permissions.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function gatewayOnlineProjectionContract(graph: ApplicationGraph, query: ApplicationQueryNode): GatewayOnlineProjectionContract {
  if (query.projection?.storage !== 'online') throw new Error(`Generated query ${query.id} declares an unsupported non-online projection authority.`);
  const nodes = graphNodes(graph);
  const projection = requiredNode(nodes, query.projection.nodeId, 'projection', query.id);
  if (projection.storage !== 'online' || !projection.online) throw new Error(`Generated query ${query.id} projection authority ${projection.id} is not an online projection.`);
  const stream = requiredNode(nodes, projection.source.nodeId, 'stream', projection.id);
  const provider = requiredProvider(nodes, projection.provider.nodeId, projection.id);
  if (provider.interface !== 'IndexStore' || provider.implementation !== 'valkey') throw new Error(`Generated query ${query.id} online authority requires a Valkey-compatible IndexStore provider.`);
  const config = objectConfig(provider.config?.indexStore);
  return {
    query,
    // typecast: the explicit online guard establishes the required online contract.
    projection: projection as ApplicationProjectionNode & { readonly online: NonNullable<ApplicationProjectionNode['online']> },
    stream,
    provider,
    config,
  };
}

function generatedGatewayOnlineProjectionSource(graphName: string, contract: GatewayOnlineProjectionContract): string {
  const authentication = objectConfig(contract.config.authentication);
  const dynamicAuthentication = applicationGraphBooleanCondition(authentication.mode);
  const password = stringConfig(authentication.mode) === 'password'
    ? `, password: requiredEnv(${JSON.stringify(valkeyPasswordEnvironmentName(contract.provider.id))})`
    : dynamicAuthentication
      ? `, ...(process.env[${JSON.stringify(valkeyPasswordEnvironmentName(contract.provider.id))}] ? { password: process.env[${JSON.stringify(valkeyPasswordEnvironmentName(contract.provider.id))}] } : {})`
    : '';
  return `const ${projectionQuerySourceVariable(contract.query.id)} = createValkeyOnlineProjectionReader({ host: requiredEnv(${JSON.stringify(valkeyHostEnvironmentName(contract.provider.id))}), port: Number(requiredEnv(${JSON.stringify(valkeyPortEnvironmentName(contract.provider.id))}))${password}, prefix: ${JSON.stringify(kubernetesName(graphName))}, projection: ${JSON.stringify(contract.projection.name)}, stream: ${JSON.stringify(`${contract.stream.name}.${contract.stream.version}`)}, valueSchema: schema(${JSON.stringify(contract.projection.output.jsonSchema)}, ${JSON.stringify(`${contract.projection.name}.value`)}) });`;
}

function gatewayAnalyticalProjectionContract(graph: ApplicationGraph, query: ApplicationQueryNode): GatewayAnalyticalProjectionContract {
  if (query.projection?.storage !== 'analytical') throw new Error(`Generated query ${query.id} does not declare an analytical projection authority.`);
  const nodes = graphNodes(graph);
  const projection = requiredNode(nodes, query.projection.nodeId, 'projection', query.id);
  if (projection.storage !== 'analytical') throw new Error(`Generated query ${query.id} projection authority ${projection.id} is not analytical.`);
  const stream = requiredNode(nodes, projection.source.nodeId, 'stream', projection.id);
  const provider = requiredProvider(nodes, projection.provider.nodeId, projection.id);
  if (provider.interface !== 'AnalyticalDatabase' || provider.implementation !== 'clickhouse') throw new Error(`Generated query ${query.id} analytical authority requires a ClickHouse-compatible AnalyticalDatabase provider.`);
  return { query, projection, stream, provider, config: provider.config ?? {} };
}

function generatedGatewayAnalyticalProjectionSource(contract: GatewayAnalyticalProjectionContract): string {
  const table = kubernetesName(contract.projection.name).replace(/-/g, '_');
  const endpointEnvironment = clickHouseGatewayEnvironmentName(contract.provider.id, 'ENDPOINT');
  const databaseEnvironment = clickHouseGatewayEnvironmentName(contract.provider.id, 'DATABASE');
  const usernameEnvironment = clickHouseGatewayEnvironmentName(contract.provider.id, 'USERNAME');
  const passwordEnvironment = clickHouseGatewayEnvironmentName(contract.provider.id, 'PASSWORD');
  const enabledEnvironment = clickHouseGatewayEnvironmentName(contract.provider.id, 'ENABLED');
  return `const ${projectionQuerySourceVariable(contract.query.id)} = createClickHouseAnalyticalProjectionReader({ endpoint: requiredEnv(${JSON.stringify(endpointEnvironment)}), database: requiredEnv(${JSON.stringify(databaseEnvironment)}), table: ${JSON.stringify(table)}, projection: ${JSON.stringify(contract.projection.name)}, schema: schema(${JSON.stringify(contract.projection.output.jsonSchema)}, ${JSON.stringify(`${contract.projection.name}.value`)}), enabled: process.env[${JSON.stringify(enabledEnvironment)}] !== 'false', ...(process.env[${JSON.stringify(usernameEnvironment)}] ? { username: process.env[${JSON.stringify(usernameEnvironment)}], password: process.env[${JSON.stringify(passwordEnvironment)}] ?? '' } : {}) });`;
}

function generatedCommandGateway(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  commands: readonly GatewayCommandContract[],
  operationCatalog: ApplicationOperationCatalog,
  eventLog: ApplicationProviderNode,
): string {
  const config = eventLog.config ?? {};
  const commandContracts = commands.map(({ handler, command, model }) => {
    const transportId = `${command.contract.name}.${command.contract.version}`;
    const operation = operationCatalog.operations.find((candidate) =>
      candidate.transports.some((transport) => transport.id === transportId));
    if (!operation) {
      throw new Error(`Generated command ${transportId} has no canonical operation-catalog entry.`);
    }
    return `{ id: ${JSON.stringify(transportId)}, application: ${JSON.stringify(graph.metadata.name)}, bindingId: ${JSON.stringify(handler.name)}, model: ${JSON.stringify(model.name)}, operationId: ${JSON.stringify(operation.id)}, operationVersion: ${JSON.stringify(operation.version)}, inputSchema: ${JSON.stringify(command.contract.input.jsonSchema)}, databaseUrl: requiredEnv(${JSON.stringify(model.runtime.connectionEnvName)}), key: (${handler.key.source})${handler.idempotencyKey ? `, idempotencyKey: (${handler.idempotencyKey.source})` : ''} }`;
  }).join(',\n');
  return `const commandGateway = createApplicationCommandGateway({
  commands: [${commandContracts}],
  authenticate: admitRequest,
  admitPrincipal: ({ admission, trustedContextDigest }) =>
    admitGatewayPrincipal(admission, trustedContextDigest),
  authorizeOperation: async ({ principal, authorizationVersion, trustedContext, command, input, commandId, idempotencyKey, targetKey, targetDigest, trustedContextDigest, inputDigest }) => {
    const applicationPolicyAllowed = await authorizeCommand({
      principal,
      authorizationVersion,
      trustedContext,
      command: command.id,
      input,
    });
    return operationAuthority.authorize({
      principal,
      operationId: command.operationId,
      target: { kind: 'target', model: command.model, identity: { key: targetKey } },
      audience: ${JSON.stringify(gateway.id)},
      transport: 'http',
      inputDigest,
      trustedContextDigest,
      idempotencyKey,
      commandId,
      targetDigest,
      applicationPolicyAllowed,
    });
  },
  revalidateOperation: ({ receipt, boundary, trustedContextDigest }) =>
    operationAuthority.revalidate(receipt, boundary, trustedContextDigest),
  cursorSecret,
  eventLogPublisher: createJetStreamEventLog({ servers: JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS')), stream: ${JSON.stringify(stringConfig(config.stream) || 'APPLIK8S_EVENTS')}, subjectPrefix: ${JSON.stringify(stringConfig(config.subjectPrefix) || 'applik8s')}, connectionName: ${JSON.stringify('applik8s-query-command-gateway')}, ...(process.env.APPLIK8S_NATS_TOKEN ? { token: process.env.APPLIK8S_NATS_TOKEN } : {}), ...(process.env.APPLIK8S_NATS_USER ? { user: process.env.APPLIK8S_NATS_USER, pass: process.env.APPLIK8S_NATS_PASSWORD ?? '' } : {}) }),
});`;
}

function generatedGatewayInternalOperationHandler(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  operationCatalog: ApplicationOperationCatalog,
  routes: readonly ApplicationMcpPlacementRoute[],
  hasOperationAuthority: boolean,
): string {
  if (routes.length === 0) {
    return 'const internalOperationHandler = undefined;';
  }
  if (!hasOperationAuthority) {
    throw new Error(
      `Generated gateway ${gateway.id} cannot receive MCP operations without canonical operation authority.`,
    );
  }
  const byOperation = new Map<
    string,
    {
      readonly operation: ApplicationOperationCatalog['operations'][number];
      readonly audience: string;
      readonly invoke: string;
    }
  >();
  for (const route of routes) {
    const operation = operationCatalog.operations.find(
      (candidate) => candidate.id === route.operationId,
    );
    if (!operation) {
      throw new Error(
        `Generated gateway ${gateway.id} MCP route references unavailable operation ${route.operationId}.`,
      );
    }
    const existing = byOperation.get(operation.id);
    if (existing) {
      if (existing.audience !== route.audience) {
        throw new Error(
          `Generated gateway ${gateway.id} cannot receive ${operation.id} from multiple MCP audiences (${existing.audience}, ${route.audience}) through one placement binding.`,
        );
      }
      continue;
    }
    const command = commands.find(
      (candidate) =>
        candidate.handler.id === operation.placement.nodeId,
    );
    const query = queries.find((candidate) =>
      candidate.id === operation.placement.nodeId
      || (
        operation.target?.model
        && candidate.modelOperation?.model.nodeId
          === operation.placement.nodeId
        && candidate.modelOperation.name === operation.name
      ),
    );
    if (!command && !query) {
      throw new Error(
        `Generated gateway ${gateway.id} has no existing runtime binding for MCP operation ${operation.id}.`,
      );
    }
    const invoke = command
      ? `commandGateway.invoke({ operationId: operation.id, input, invocation, ...(signal ? { signal } : {}) })`
      : `gateway.invoke({ query: ${JSON.stringify(query!.publicId ?? `${query!.name}.${query!.version}`)}, input, invocation })`;
    byOperation.set(operation.id, {
      operation,
      audience: route.audience,
      invoke,
    });
  }
  const bindings = [...byOperation.values()]
    .sort((left, right) => left.operation.id.localeCompare(right.operation.id))
    .map(({ operation, audience, invoke }) => `{
      operation: ${JSON.stringify(operation)},
      audience: ${JSON.stringify(audience)},
      validateInput: strictSchema(${JSON.stringify(operation.input.schema)}, ${JSON.stringify(`${operation.id}.input`)}),
      validateOutput: strictSchema(${JSON.stringify(operation.output.schema)}, ${JSON.stringify(`${operation.id}.output`)}),
      invoke: (input, { invocation, signal }) => ${invoke},
    }`)
    .join(',\n');
  return `const internalOperationHandler = createApplicationInternalOperationHandler({
  secret: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
  bindings: [${bindings}],
  revalidate: async ({ invocation, receipt }) => {
    const result = await operationAuthority.revalidate(
      receipt,
      'execution',
      invocation.admission.principal.trustedContextDigest,
    );
    return result.allowed;
  },
});`;
}

function generatedGatewayOperationAuthority(
  graph: ApplicationGraph,
  databaseEnvironment: string,
  operationCatalog: ApplicationOperationCatalog,
): string {
  return `const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(databaseEnvironment)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(graph.metadata.name)},
  catalog: ${JSON.stringify(operationCatalog)},
  ${applicationStaticAuthorityManifest(graph) ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(graph))},` : ''}
});
let operationAuthorityPrepared = false;
async function prepareOperationAuthority() {
  if (operationAuthorityPrepared) return;
  await operationAuthority.prepare();
  operationAuthorityPrepared = true;
}`;
}

function gatewayAuthorityDatabaseEnvironment(
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  subscriptions: readonly GatewayStreamSubscriptionContract[],
): string | undefined {
  const candidates = new Set([
    ...commands.map(({ model }) => model.runtime.connectionEnvName),
    ...queries.flatMap((query) => query.database ? [query.database.connectionEnvName] : []),
    ...subscriptions.map(({ stream }) => stream.database.connectionEnvName),
  ]);
  if (candidates.size > 1) {
    throw new Error(`Generated gateway spans multiple transactional authority databases (${[...candidates].sort().join(', ')}). Bind an explicit AuthorizationAuthority provider before distributing operation receipts across stores.`);
  }
  return [...candidates][0];
}

function generatedQueryAuthority(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  operationCatalog: ApplicationOperationCatalog,
): string {
  const contracts = queries.map((query) => {
    const transportId = query.publicId ?? query.name;
    const operation = operationCatalog.operations.find((candidate) =>
      candidate.transports.some((transport) => transport.id === transportId));
    if (!operation) {
      throw new Error(`Generated query ${transportId} has no canonical operation-catalog entry.`);
    }
    return `${JSON.stringify(query.publicId ?? `${query.name}.${query.version}`)}: { operationId: ${JSON.stringify(operation.id)}, target: ${JSON.stringify(operation.authority.defaultScope)} }`;
  }).join(', ');
  return `authorizeOperation: async ({ query, identity, inputDigest, trustedContextDigest }) => {
    const contract = ({ ${contracts} })[query.id];
    if (!contract) return false;
    const result = await operationAuthority.authorize({
      principal: identity.principal,
      operationId: contract.operationId,
      target: contract.target,
      audience: ${JSON.stringify(gateway.id)},
      transport: 'http',
      inputDigest,
      trustedContextDigest,
      applicationPolicyAllowed: true,
    });
    return result.allowed ? result.receipt : false;
  },`;
}

function generatedStreamSubscriptionGateway(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  subscriptions: readonly GatewayStreamSubscriptionContract[],
  operationCatalog: ApplicationOperationCatalog | undefined,
  hasOperationAuthority: boolean,
): string {
  if (subscriptions.length === 0) return 'const streamGateway = undefined;';
  const bindings = subscriptions.map(({ subscription, stream }) => {
    const streamId = `${stream.name}.${stream.version}`;
    return `{ name: ${JSON.stringify(subscription.name)}, stream: { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(streamId)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}, ${JSON.stringify(`${streamId}.payload`)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database: ${databaseBindingSource(stream.database)}, partition: () => { throw new Error('Subscription replay never repartitions persisted events.'); }, authorize: async (principal, action) => ${callbackVariable(stream.id, 'streamAuthorize')}({ principal, action }) }, authorize: async (principal) => ${callbackVariable(subscription.id, 'authorize')}({ principal }), open: (identity) => createPostgresApplicationStream({ stream: streamSubscriptions[${JSON.stringify(subscription.name)}].stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: identity.principal, contextDigest: identity.contextDigest }) }`;
  }).join(',\n');
  const index = subscriptions.map(({ subscription }, position) => `${JSON.stringify(subscription.name)}: streamSubscriptionBindings[${position}]`).join(', ');
  const operationContracts = operationCatalog && hasOperationAuthority
    ? subscriptions.map(({ subscription }) => {
      const operation = operationCatalog.operations.find((candidate) =>
        candidate.transports.some((transport) => transport.id === subscription.id));
      if (!operation) {
        throw new Error(`Generated stream subscription ${subscription.id} has no canonical operation-catalog entry.`);
      }
      return `${JSON.stringify(subscription.name)}: { operationId: ${JSON.stringify(operation.id)}, target: ${JSON.stringify(operation.authority.defaultScope)} }`;
    }).join(', ')
    : '';
  return `const streamSubscriptionBindings = [${bindings}];
const streamSubscriptions = { ${index} };
const streamGateway = createApplicationStreamSubscriptionGateway({
  subscriptions: streamSubscriptionBindings,
  cursorSecret,
  subscriptionLimiter,
  authenticate: async (request) => {
    const admitted = await admitRequest(request);
    const trustedContext = admitted.trustedContext ?? {};
    const contextDigest = applicationAdmittedContextDigest({ values: trustedContext, digestSecret: cursorSecret });
    const principal = ${operationCatalog && hasOperationAuthority ? 'await admitGatewayPrincipal(admitted, contextDigest)' : 'admitted.principal'};
    return { principal, contextDigest };
  },
  ${operationCatalog && hasOperationAuthority ? `authorizeOperation: async ({ subscription, identity, inputDigest, trustedContextDigest }) => {
    const contract = ({ ${operationContracts} })[subscription.name];
    if (!contract) return false;
    const result = await operationAuthority.authorize({
      principal: identity.principal,
      operationId: contract.operationId,
      target: contract.target,
      audience: ${JSON.stringify(gateway.id)},
      transport: 'http',
      inputDigest,
      trustedContextDigest,
      applicationPolicyAllowed: true,
    });
    return result.allowed ? result.receipt : false;
  },` : ''}
});`;
}

function generatedProjectionSource(projection: ApplicationProjectionNode, stream: ApplicationStreamNode, _provider: ApplicationProviderNode): string {
  const table = kubernetesName(projection.name).replace(/-/g, '_');
  return `import { createServer } from 'node:http';
import { createClickHouseAnalyticalProjectionWriter, createPostgresApplicationStream, enforcePostgresApplicationStreamRetention, runApplicationProjection } from '@applik8s/applik8s/projection-worker-runtime';
import { callback as project } from './project.generated.js';
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function schema(json) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:projection' }, schema: json }; }
const database = ${databaseBindingSource(stream.database)};
const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database, partition: () => { throw new Error('Projection replay never repartitions persisted events.'); }, authorize: async () => false };
const source = createPostgresApplicationStream({ stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} }, internalConsumer: { kind: 'projection', name: ${JSON.stringify(projection.name)} } });
const store = createClickHouseAnalyticalProjectionWriter({ endpoint: requiredEnv('APPLIK8S_CLICKHOUSE_ENDPOINT'), database: requiredEnv('APPLIK8S_CLICKHOUSE_DATABASE'), table: ${JSON.stringify(table)}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, schema: schema(${JSON.stringify(projection.output.jsonSchema)}), ...(process.env.APPLIK8S_CLICKHOUSE_USERNAME ? { username: process.env.APPLIK8S_CLICKHOUSE_USERNAME, password: process.env.APPLIK8S_CLICKHOUSE_PASSWORD ?? '' } : {}) });
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const ok = live || (ready && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready, stopping, checkpoint, processed, lastError })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { let prepared = false; while (!stopping) { try { if (!prepared) { await store.prepare(); prepared = true; } const result = await runApplicationProjection({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, project, batchSize: 250, maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; await enforcePostgresApplicationStreamRetention({ stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), batchSize: 1000 }); lastError = undefined; ready = true; await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; if (!stopping) console.error(error); await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await source.close(); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

function generatedValkeyProjectionSource(graphName: string, projection: ApplicationProjectionNode, stream: ApplicationStreamNode, _config: Readonly<Record<string, unknown>>): string {
  if (!projection.online) throw new Error(`Generated online projection ${projection.id} is missing its online contract.`);
  return `import { createServer } from 'node:http';
import { createPostgresApplicationStream, createValkeyOnlineProjectionWriter, enforcePostgresApplicationStreamRetention, runApplicationProjection } from '@applik8s/applik8s/projection-worker-runtime';
import { callback as project } from './project.generated.js';
import { callback as partitionBy } from './partition.generated.js';
import { callback as key } from './key.generated.js';
import { callback as score } from './score.generated.js';
import { callback as value } from './value.generated.js';
${projection.online.removeSource ? "import { callback as removeWhen } from './remove.generated.js';" : 'const removeWhen = undefined;'}
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function schema(json) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:online-projection' }, schema: json }; }
const database = ${databaseBindingSource(stream.database)};
const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database, partition: () => { throw new Error('Projection replay never repartitions persisted events.'); }, authorize: async () => false };
const databaseUrl = requiredEnv(${JSON.stringify(stream.database.connectionEnvName)});
const source = createPostgresApplicationStream({ stream, databaseUrl, principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} }, internalConsumer: { kind: 'projection', name: ${JSON.stringify(projection.name)} } });
const store = createValkeyOnlineProjectionWriter({ host: requiredEnv('APPLIK8S_VALKEY_HOST'), port: Number(requiredEnv('APPLIK8S_VALKEY_PORT')), ...(process.env.APPLIK8S_VALKEY_PASSWORD ? { password: process.env.APPLIK8S_VALKEY_PASSWORD } : {}), prefix: ${JSON.stringify(kubernetesName(graphName))}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, valueSchema: schema(${JSON.stringify(projection.output.jsonSchema)}), partitionBy, key, score, scoreUnit: ${JSON.stringify(projection.online.scoreUnit)}, value, ...(removeWhen ? { removeWhen } : {}), retention: ${JSON.stringify(projection.online.retention)}, initialGeneration: 'live' });
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0; let generation = 'unknown';
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const ok = live || (ready && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready, stopping, checkpoint, processed, generation, lastError })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { let prepared = false; while (!stopping) { try { if (!prepared) { await store.prepare(); prepared = true; } const result = await runApplicationProjection({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, project, batchSize: 250, maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; generation = await store.activeGeneration(); await enforcePostgresApplicationStreamRetention({ stream, databaseUrl, batchSize: 1000 }); lastError = undefined; ready = true; await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; if (!stopping) console.error(error); await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await source.close(); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

function generatedStreamProcessorSource(processor: ApplicationStreamProcessorNode, stream: ApplicationStreamNode, workflow: StreamProcessorWorkflowContract | undefined): string {
  const workflowImport = workflow ? "import { createHatchetWorkflowRuntime } from '@applik8s/runtime-hatchet';\nimport { normalizeSchema } from '@applik8s/sdk/schema-runtime';" : '';
  const workflowDeclarations = workflow ? `
const workflowRuntime = createHatchetWorkflowRuntime({ kind: 'hatchet', tls: process.env.HATCHET_CLIENT_TLS_STRATEGY === 'tls' });
function validateWorkflowValue(schema, value, name, role) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name + ':' + role }, schema }, name + '.' + role); const result = normalized.validate(value); if (!result.ok) throw new Error('applik8s-workflow-' + role + '-invalid: ' + name + ': ' + result.error.message); return result.value; }
const schedules = Object.freeze({
${workflow.schedules.map((binding) => `  ${JSON.stringify(binding.alias)}: Object.freeze({ reconcile: (schedule, metadata) => workflowRuntime.reconcileSchedule(${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, { ...schedule, input: validateWorkflowValue(${JSON.stringify(binding.contract.input.jsonSchema)}, schedule?.input, ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, 'input') }, metadata) }),`).join('\n')}
});
function processorTasks(context) { return Object.freeze({
${workflow.tasks.map((binding) => `  ${JSON.stringify(binding.alias)}: async (input, metadata) => { const name = ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}; const callerKey = metadata?.idempotencyKey; const invocationMetadata = { ...metadata, idempotencyKey: context.idempotencyKey + ${JSON.stringify(`:${binding.alias}`)} + (callerKey ? ':' + callerKey : ''), causationId: context.event.id, ...(!context.event.contextDigest ? {} : { trustedContext: { values: context.trustedContext, digest: context.event.contextDigest } }) }; const output = await workflowRuntime.run(name, validateWorkflowValue(${JSON.stringify(binding.contract.input.jsonSchema)}, input, name, 'input'), invocationMetadata, { signal: context.signal, timeoutMs: ${processor.budgets.timeoutMs} }); return validateWorkflowValue(${JSON.stringify(binding.contract.output.jsonSchema)}, output, name, 'output'); },`).join('\n')}
}); }
const invokeHandler = (payload, context) => handleEvent(payload, { ...context, schedules, tasks: processorTasks(context) });` : 'const invokeHandler = handleEvent;';
  return `import { createServer } from 'node:http';
import { createPostgresApplicationStream, createPostgresApplicationStreamProcessorStore, enforcePostgresApplicationStreamRetention, runApplicationStreamProcessor } from '@applik8s/applik8s/stream-worker-runtime';
${workflowImport}
import { callback as handleEvent } from './handle.generated.js';
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function requiredIntegerEnv(name, minimum, maximum) { const value = Number(requiredEnv(name)); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum + '.'); return value; }
function schema(json) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:stream-processor' }, schema: json }; }
const database = ${databaseBindingSource(stream.database)};
const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database, partition: () => { throw new Error('Processor replay never repartitions persisted events.'); }, authorize: async () => false };
const databaseUrl = requiredEnv(${JSON.stringify(stream.database.connectionEnvName)});
const source = createPostgresApplicationStream({ stream, databaseUrl, principal: { id: ${JSON.stringify(`applik8s:processor:${processor.name}`)} }, includeTrustedContext: true, internalConsumer: { kind: 'processor', name: ${JSON.stringify(processor.name)} } });
const store = createPostgresApplicationStreamProcessorStore({ databaseUrl });
const processorConcurrency = requiredIntegerEnv('APPLIK8S_PROCESSOR_CONCURRENCY', 1, 64);
const processorMaxAckPending = requiredIntegerEnv('APPLIK8S_PROCESSOR_MAX_ACK_PENDING', processorConcurrency, 65536);
${workflowDeclarations}
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0; let deadLettered = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const ok = live || (ready && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready, stopping, checkpoint, processed, deadLettered, lastError })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { while (!stopping) { try { const result = await runApplicationStreamProcessor({ processor: ${JSON.stringify(processor.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, handle: invokeHandler, concurrency: processorConcurrency, retry: ${JSON.stringify(processor.retry)}, failure: ${JSON.stringify(processor.failure)}, timeoutMs: ${processor.budgets.timeoutMs}, maxInputBytes: ${processor.budgets.maxInputBytes}, batchSize: Math.min(1000, processorMaxAckPending), maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; deadLettered += result.deadLettered; await enforcePostgresApplicationStreamRetention({ stream, databaseUrl, batchSize: 1000 }); lastError = undefined; ready = true; await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; if (!stopping) console.error(error); await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await Promise.all([source.close(), store.close()]); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

async function writeCallbackModule(directory: string, name: string, source: string, dependencies?: ApplicationHandlerDependencies): Promise<void> {
  const dependencySource = dependencies?.source ? absoluteDependencyImports(dependencies.source, dependencies.resolveDir) : '';
  await writeFile(join(directory, `${name}.generated.ts`), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

async function writeQueryCallbackModule(directory: string, name: string, source: string, dependencies: ApplicationHandlerDependencies | undefined, query: ApplicationQueryNode, graph: ApplicationGraph): Promise<void> {
  const rewritten = dependencies?.source ? rewriteQueryRuntimeDependencies(dependencies.source, query, graph, dependencies.resolveDir) : '';
  const focused = removeUnusedBoundImports(rewritten, source);
  const dependencySource = focused ? absoluteDependencyImports(focused, dependencies?.resolveDir ?? process.cwd()) : '';
  assertSupportedQueryRuntimeFacetCapture(dependencySource, query.id);
  await writeFile(join(directory, `${name}.generated.ts`), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

/**
 * Command admission is allowed to compare the requested command with a model's
 * public operation descriptor. Importing that model's authoring module into a
 * generated gateway would replay all app registrations and provider setup at
 * runtime, so lower those imports to the smallest immutable descriptor needed
 * by the callback.
 */
async function writeGatewayCommandAuthorizationModule(
  directory: string,
  source: string,
  dependencies: ApplicationHandlerDependencies | undefined,
  graph: ApplicationGraph,
): Promise<void> {
  const rewritten = dependencies?.source ? rewriteGatewayCommandRuntimeDependencies(dependencies.source, graph) : '';
  const focused = removeUnusedBoundImports(rewritten, source);
  const dependencySource = focused ? absoluteDependencyImports(focused, dependencies?.resolveDir ?? process.cwd()) : '';
  await writeFile(join(directory, 'command-authorization.generated.ts'), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

function rewriteGatewayCommandRuntimeDependencies(source: string, graph: ApplicationGraph): string {
  const operationsByModel = new Map<string, Record<string, { readonly operation: { readonly id: string } }>>();
  for (const model of graph.nodes.filter((node): node is ApplicationModelNode => node.kind === 'model')) {
    const operations = Object.fromEntries((model.common?.operations ?? []).filter((operation) => operation.transport === 'command').map((operation) => [operation.name, { operation: { id: operation.publicId } }]));
    if (Object.keys(operations).length > 0) operationsByModel.set(model.name, operations);
  }
  const file = ts.createSourceFile('command-authorization-dependencies.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    if (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@applik8s/applik8s') {
      const runtimeSafe = new Set(['verifyApplicationObjectCompletionReceipt']);
      const elements = statement.importClause.namedBindings.elements;
      if (elements.length > 0 && elements.every((element) => !element.isTypeOnly && runtimeSafe.has(element.propertyName?.text ?? element.name.text))) {
        edits.push({ start: statement.moduleSpecifier.getStart(file), end: statement.moduleSpecifier.getEnd(), replacement: JSON.stringify('@applik8s/applik8s/reactive-runtime') });
        continue;
      }
    }
    const retained: string[] = [];
    const descriptors: string[] = [];
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const operations = operationsByModel.get(imported);
      if (!element.isTypeOnly && operations) descriptors.push(`const ${element.name.text} = Object.freeze(${JSON.stringify(operations)});`);
      else retained.push(element.getText(file));
    }
    if (descriptors.length === 0) continue;
    const moduleSpecifier = statement.moduleSpecifier.getText(file);
    const importPrefix = statement.importClause.isTypeOnly ? 'import type' : 'import';
    const replacement = [
      ...(retained.length > 0 ? [`${importPrefix} { ${retained.join(', ')} } from ${moduleSpecifier};`] : []),
      ...descriptors,
    ].join('\n');
    edits.push({ start: statement.getFullStart(), end: statement.getEnd(), replacement });
  }
  let rewritten = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  return rewritten.trim();
}

/**
 * Closure discovery intentionally captures enough top-level context to be
 * correct before compiler lowering. Once app/database/model declarations are
 * replaced, some imports become dead. Keeping even one of those imports can
 * execute the complete authoring graph inside a focused runtime, so remove
 * wholly unused bound imports before bundling.
 */
function removeUnusedBoundImports(source: string, callbackSource: string): string {
  if (!source.trim()) return '';
  const file = ts.createSourceFile('focused-runtime-dependencies.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = file.statements.filter(ts.isImportDeclaration);
  if (imports.length === 0) return source.trim();
  let executable = source;
  for (const statement of [...imports].sort((left, right) => right.getFullStart() - left.getFullStart())) {
    executable = `${executable.slice(0, statement.getFullStart())}${executable.slice(statement.getEnd())}`;
  }
  const referencedSource = `${executable}\n${callbackSource}`;
  const edits: { readonly start: number; readonly end: number }[] = [];
  for (const statement of imports) {
    const clause = statement.importClause;
    if (!clause) continue;
    const bindings = [
      ...(clause.name ? [clause.name.text] : []),
      ...(clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? [clause.namedBindings.name.text] : []),
      ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text) : []),
    ];
    if (bindings.length > 0 && bindings.every((name) => !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(referencedSource))) {
      edits.push({ start: statement.getFullStart(), end: statement.getEnd() });
    }
  }
  let focused = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) focused = `${focused.slice(0, edit.start)}${focused.slice(edit.end)}`;
  return focused.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces authoring-only app/database/model declarations with focused runtime equivalents. */
function rewriteQueryRuntimeDependencies(source: string, query: ApplicationQueryNode, graph: ApplicationGraph, resolveDir: string): string {
  if (!query.database) return source;
  const importedDatabasesRewritten = rewriteImportedQueryDatabaseBindings(source, query.database, resolveDir);
  const importedModelsRewritten = rewriteImportedQueryModelBindings(importedDatabasesRewritten, graph, resolveDir);
  const file = ts.createSourceFile('query-dependencies.ts', importedModelsRewritten, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
      const facet = queryRuntimeModelFacet(model);
      edits.push({ start: initializer.getStart(file), end: initializer.getEnd(), replacement: `Object.assign(${table}, { $model: ${JSON.stringify(facet)} })` });
    }
  }
  let rewritten = importedModelsRewritten;
  for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  return rewritten.trim();
}

interface ImportedQueryModelExport {
  readonly modelName?: string;
  readonly tableExport: string;
  readonly tableModulePath: string;
}

/**
 * A domain module may export one promoted model and query modules may import it
 * directly. Follow that local export to its raw Drizzle table and synthesize a
 * runtime-safe facet instead of bundling the authoring module and replaying the
 * application graph in every gateway process.
 */
function rewriteImportedQueryModelBindings(source: string, graph: ApplicationGraph, resolveDir: string): string {
  const file = ts.createSourceFile('query-model-imports.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const models = graph.nodes.filter((node): node is ApplicationModelNode => node.kind === 'model' && node.runtime?.storageShape === 'native-relational');
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const modulePath = resolveTypeScriptImport(resolveDir, statement.moduleSpecifier.text);
    if (!modulePath) continue;
    const exportedModels = queryModelExports(modulePath);
    if (exportedModels.size === 0) continue;
    const retained: string[] = [];
    const lowered: string[] = [];
    for (const element of clause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const exported = !element.isTypeOnly ? exportedModels.get(imported) : undefined;
      if (!exported) {
        retained.push(element.getText(file));
        continue;
      }
      const model = (exported.modelName ? models.find((candidate) => candidate.name === exported.modelName) : undefined)
        ?? models.find((candidate) => candidate.runtime?.tableName === exported.tableExport);
      if (!model) throw new Error(`Generated query cannot map imported promoted model ${imported} from ${modulePath} to its application graph node.`);
      const tableAlias = `__applik8s_${element.name.text}_table`;
      lowered.push(`import { ${exported.tableExport} as ${tableAlias} } from ${JSON.stringify(exported.tableModulePath)};`);
      lowered.push(`const ${element.name.text} = Object.assign(${tableAlias}, { $model: ${JSON.stringify(queryRuntimeModelFacet(model))} });`);
    }
    if (lowered.length === 0) continue;
    const replacement = [
      ...(retained.length > 0 ? [`import { ${retained.join(', ')} } from ${statement.moduleSpecifier.getText(file)};`] : []),
      ...lowered,
    ].join('\n');
    edits.push({ start: statement.getFullStart(), end: statement.getEnd(), replacement });
  }
  let rewritten = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  return rewritten;
}

function queryModelExports(modulePath: string): ReadonlyMap<string, ImportedQueryModelExport> {
  const source = readFileSync(modulePath, 'utf8');
  const file = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tableImports = new Map<string, { readonly imported: string; readonly modulePath: string }>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const importedModule = resolveTypeScriptImport(dirname(modulePath), statement.moduleSpecifier.text);
    if (!importedModule) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      tableImports.set(element.name.text, { imported: element.propertyName?.text ?? element.name.text, modulePath: importedModule });
    }
  }
  const exports = new Map<string, ImportedQueryModelExport>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (!/\.model$/.test(declaration.initializer.expression.getText(file))) continue;
      const tableArgument = declaration.initializer.arguments[0];
      if (!tableArgument || !ts.isIdentifier(tableArgument)) continue;
      const tableImport = tableImports.get(tableArgument.text);
      if (!tableImport) continue;
      const modelName = objectLiteralStringProperty(declaration.initializer.arguments[1], 'name');
      exports.set(declaration.name.text, {
        ...(modelName ? { modelName } : {}),
        tableExport: tableImport.imported,
        tableModulePath: tableImport.modulePath,
      });
    }
  }
  return exports;
}

function queryRuntimeModelFacet(model: ApplicationModelNode): Readonly<Record<string, unknown>> {
  return { name: model.name, native: 'drizzle-table', database: model.runtime?.database, identity: model.common?.identity, revision: model.common?.revision, relationships: model.common?.relationships ?? [] };
}

/**
 * A thin domain module commonly imports its one app.database(...) binding from
 * a shared database module. Generated query callbacks need only the focused
 * runtime descriptor, not that module's application/provider side effects.
 */
function rewriteImportedQueryDatabaseBindings(source: string, database: ApplicationReactiveDatabaseRuntimeContract, resolveDir: string): string {
  const file = ts.createSourceFile('query-imports.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const modulePath = resolveTypeScriptImport(resolveDir, statement.moduleSpecifier.text);
    if (!modulePath) continue;
    const exports = queryDatabaseExports(readFileSync(modulePath, 'utf8'), database.name);
    if (exports.size === 0) continue;
    const databaseImports: { readonly local: string }[] = [];
    const retained: string[] = [];
    for (const element of clause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && exports.has(imported)) databaseImports.push({ local: element.name.text });
      else retained.push(element.getText(file));
    }
    if (databaseImports.length === 0) continue;
    const replacement = [
      ...(retained.length > 0 ? [`import { ${retained.join(', ')} } from ${JSON.stringify(statement.moduleSpecifier.text)};`] : []),
      ...databaseImports.map(({ local }) => `const ${local} = ${queryDatabaseCaptureSource(database)};`),
    ].join('\n');
    edits.push({ start: statement.getFullStart(), end: statement.getEnd(), replacement });
  }
  let rewritten = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  return rewritten;
}

function queryDatabaseExports(source: string, databaseName: string): ReadonlySet<string> {
  const file = ts.createSourceFile('database-module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (!/\.database\.postgres$/.test(declaration.initializer.expression.getText(file))) continue;
      const name = declaration.initializer.arguments[0];
      if (name && ts.isStringLiteral(name) && name.text === databaseName) names.add(declaration.name.text);
    }
  }
  return names;
}

function resolveTypeScriptImport(resolveDir: string, specifier: string): string | undefined {
  const base = resolve(resolveDir, specifier);
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
    base.replace(/\.m?js$/, '.ts'), base.replace(/\.cjs$/, '.cts'),
    join(base, 'index.ts'), join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
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

function consolidatedReactiveGatewayResources(
  graphName: string,
  artifacts: readonly GeneratedApplicationReactiveArtifact[],
): readonly GeneratedApplicationReactiveResource[] {
  const firstDeployment = reactiveArtifactDeployment(artifacts[0]!);
  const firstMetadata = recordValue(firstDeployment.metadata);
  const firstSpec = recordValue(firstDeployment.spec);
  const firstTemplate = recordValue(firstSpec.template);
  const firstPodSpec = recordValue(firstTemplate.spec);
  const namespace = String(firstMetadata.namespace ?? 'default');
  const includeWhen = recordValue(firstMetadata.annotations)['applik8s.dev/include-when'];
  const memberNames = artifacts.map((artifact) => artifact.name).sort();
  const envelopeIdentity = reactiveEnvelopeIdentity({
    graphName,
    namespace,
    replicas: firstSpec.replicas,
    role: 'query-gateway',
    members: memberNames,
  });
  const rolloutDigest = reactiveEnvelopeRolloutDigest(artifacts);
  const name = kubernetesName(`${graphName}-gateways-${envelopeIdentity}`);
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'query-gateway',
    'applik8s.dev/graph': graphName,
    'applik8s.dev/workload-envelope': envelopeIdentity,
  };
  const annotations = reactiveEnvelopeAnnotations(rolloutDigest, memberNames);
  const metadata = reactiveEnvelopeMetadata(name, namespace, labels, includeWhen);
  const ports = artifacts.map((_artifact, index) => 8080 + index);
  const containers = artifacts.map((artifact, index) => {
    const original = reactiveArtifactContainer(artifact);
    const portName = `http-${index}`;
    return {
      ...original,
      name: kubernetesName(artifact.name),
      env: [
        ...arrayValue(original.env),
        { name: 'APPLIK8S_HTTP_PORT', value: String(ports[index]) },
      ],
      ports: [{ name: portName, containerPort: ports[index] }],
      readinessProbe: reactiveProbeWithPort(original.readinessProbe, portName),
      livenessProbe: reactiveProbeWithPort(original.livenessProbe, portName),
    };
  });
  const resources: GeneratedApplicationReactiveResource[] = [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata,
      spec: {
        replicas: firstSpec.replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
        template: {
          metadata: { labels, annotations },
          spec: {
            terminationGracePeriodSeconds: firstPodSpec.terminationGracePeriodSeconds ?? 30,
            containers,
          },
        },
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress'],
        ingress: [{ ports: ports.map((port) => ({ protocol: 'TCP', port })) }],
      },
    },
  ];
  for (const [index, artifact] of artifacts.entries()) {
    const service = artifact.resources.find((resource) => resource.apiVersion === 'v1'
      && resource.kind === 'Service');
    if (!service) throw new Error(`Generated query gateway ${artifact.name} has no Service to co-locate.`);
    const serviceSpec = recordValue(service.spec);
    const servicePort = recordValue(arrayValue(serviceSpec.ports)[0]);
    resources.push({
      ...service,
      spec: {
        ...serviceSpec,
        selector: labels,
        ports: [{
          ...servicePort,
          targetPort: `http-${index}`,
        }],
      },
    });
  }
  resources.push(...reactiveEnvelopeDisruptionBudget(firstSpec.replicas, metadata, labels));
  return resources;
}

function consolidatedReactiveWorkerResources(
  graphName: string,
  artifacts: readonly GeneratedApplicationReactiveArtifact[],
): readonly GeneratedApplicationReactiveResource[] {
  const firstDeployment = reactiveArtifactDeployment(artifacts[0]!);
  const firstMetadata = recordValue(firstDeployment.metadata);
  const firstSpec = recordValue(firstDeployment.spec);
  const firstTemplate = recordValue(firstSpec.template);
  const firstPodSpec = recordValue(firstTemplate.spec);
  const namespace = String(firstMetadata.namespace ?? 'default');
  const includeWhen = recordValue(firstMetadata.annotations)['applik8s.dev/include-when'];
  const memberNames = artifacts.map((artifact) => artifact.name).sort();
  const envelopeIdentity = reactiveEnvelopeIdentity({
    graphName,
    namespace,
    replicas: firstSpec.replicas,
    role: 'background-worker',
    members: memberNames,
  });
  const rolloutDigest = reactiveEnvelopeRolloutDigest(artifacts);
  const name = kubernetesName(`${graphName}-reactive-${envelopeIdentity}`);
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'reactive-worker',
    'applik8s.dev/graph': graphName,
    'applik8s.dev/workload-envelope': envelopeIdentity,
  };
  const annotations = reactiveEnvelopeAnnotations(rolloutDigest, memberNames);
  const metadata = reactiveEnvelopeMetadata(name, namespace, labels, includeWhen);
  const healthPorts = artifacts.map((_artifact, index) => 8080 + index);
  const volumes = consolidatedReactivePodVolumes(artifacts);
  const containers = artifacts.map((artifact, index) => {
    const original = reactiveArtifactContainer(artifact);
    const healthPortName = `health-${index}`;
    return {
      ...original,
      name: kubernetesName(artifact.name),
      env: [
        ...arrayValue(original.env),
        { name: 'APPLIK8S_HEALTH_PORT', value: String(healthPorts[index]) },
      ],
      ports: [{ name: healthPortName, containerPort: healthPorts[index] }],
      readinessProbe: reactiveProbeWithPort(original.readinessProbe, healthPortName),
      livenessProbe: reactiveProbeWithPort(original.livenessProbe, healthPortName),
    };
  });
  const resources: GeneratedApplicationReactiveResource[] = [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata,
      spec: {
        replicas: firstSpec.replicas,
        selector: { matchLabels: labels },
        strategy: { type: 'Recreate' },
        template: {
          metadata: { labels, annotations },
          spec: {
            terminationGracePeriodSeconds: firstPodSpec.terminationGracePeriodSeconds ?? 30,
            containers,
            ...(volumes.length > 0 ? { volumes } : {}),
          },
        },
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress'],
        ingress: [{ ports: healthPorts.map((port) => ({ protocol: 'TCP', port })) }],
      },
    },
  ];
  resources.push(...reactiveEnvelopeDisruptionBudget(firstSpec.replicas, metadata, labels));
  return resources;
}

function consolidatedReactivePodVolumes(
  artifacts: readonly GeneratedApplicationReactiveArtifact[],
): readonly Record<string, unknown>[] {
  const volumes = new Map<string, Record<string, unknown>>();
  for (const artifact of artifacts) {
    const deployment = reactiveArtifactDeployment(artifact);
    const podSpec = recordValue(recordValue(recordValue(deployment.spec).template).spec);
    for (const rawVolume of arrayValue(podSpec.volumes)) {
      const volume = recordValue(rawVolume);
      const name = String(volume.name ?? '');
      if (!name) throw new Error(`Generated reactive artifact ${artifact.name} has an unnamed Pod volume.`);
      const previous = volumes.get(name);
      if (previous && JSON.stringify(previous) !== JSON.stringify(volume)) {
        throw new Error(`Generated reactive artifacts contain conflicting Pod volume ${name}.`);
      }
      volumes.set(name, volume);
    }
  }
  return [...volumes.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function reactiveArtifactOwnsRbac(artifact: GeneratedApplicationReactiveArtifact): boolean {
  return artifact.resources.some((resource) => resource.kind === 'ServiceAccount'
    || resource.apiVersion === 'rbac.authorization.k8s.io/v1');
}

function reactiveArtifactContainer(
  artifact: GeneratedApplicationReactiveArtifact,
): Record<string, unknown> {
  const deployment = reactiveArtifactDeployment(artifact);
  const spec = recordValue(deployment.spec);
  const template = recordValue(spec.template);
  const podSpec = recordValue(template.spec);
  const container = recordValue(arrayValue(podSpec.containers)[0]);
  if (Object.keys(container).length === 0) {
    throw new Error(`Generated reactive artifact ${artifact.name} has no runtime container to co-locate.`);
  }
  return container;
}

function reactiveEnvelopeIdentity(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function reactiveEnvelopeRolloutDigest(
  artifacts: readonly GeneratedApplicationReactiveArtifact[],
): string {
  return `sha256:${createHash('sha256')
    .update(artifacts.map((artifact) => `${artifact.name}:${artifact.digest}`).sort().join('\n'))
    .digest('hex')}`;
}

function reactiveEnvelopeAnnotations(
  digest: string,
  members: readonly string[],
): Readonly<Record<string, string>> {
  return {
    'applik8s.dev/digest': digest,
    'applik8s.dev/workload-members': members.join(','),
  };
}

function reactiveEnvelopeMetadata(
  name: string,
  namespace: string,
  labels: Readonly<Record<string, string>>,
  includeWhen: unknown,
): Readonly<Record<string, unknown>> {
  return {
    name,
    namespace,
    labels,
    ...(typeof includeWhen === 'string'
      ? { annotations: { 'applik8s.dev/include-when': includeWhen } }
      : {}),
  };
}

function reactiveProbeWithPort(probe: unknown, port: string): Readonly<Record<string, unknown>> {
  const value = recordValue(probe);
  return {
    ...value,
    httpGet: {
      ...recordValue(value.httpGet),
      port,
    },
  };
}

function reactiveEnvelopeDisruptionBudget(
  replicas: unknown,
  metadata: Readonly<Record<string, unknown>>,
  labels: Readonly<Record<string, string>>,
): readonly GeneratedApplicationReactiveResource[] {
  if (typeof replicas === 'number' && replicas > 1) {
    return [{
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata,
      spec: { minAvailable: 1, selector: { matchLabels: labels } },
    }];
  }
  if (typeof replicas === 'string') {
    return [{
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata,
      spec: { maxUnavailable: reactiveMaxUnavailable(replicas), selector: { matchLabels: labels } },
    }];
  }
  return [];
}

function reactiveArtifactDeployment(
  artifact: GeneratedApplicationReactiveArtifact,
): GeneratedApplicationReactiveResource {
  const deployment = artifact.resources.find((resource) => resource.apiVersion === 'apps/v1'
    && resource.kind === 'Deployment');
  if (!deployment) throw new Error(`Generated reactive artifact ${artifact.name} has no Deployment to co-locate.`);
  return deployment;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function reactiveResources(options: { readonly graphName: string; readonly name: string; readonly kind: GeneratedApplicationReactiveArtifact['kind']; readonly namespace: string; readonly image: string; readonly replicas: number | string; readonly port: number; readonly env: readonly Record<string, unknown>[]; readonly includeWhen?: string; readonly permissions?: readonly GatewayKubernetesPermission[]; readonly workflowToken?: { readonly secretName: string; readonly key: string } }, image: string, digest: string): GeneratedApplicationReactiveResource[] {
  const component = options.kind === 'queryGateway' ? 'query-gateway' : options.kind === 'projectionWorker' ? 'projection-worker' : 'stream-processor';
  const labels = { 'app.kubernetes.io/name': options.name, 'app.kubernetes.io/component': component, 'applik8s.dev/graph': options.graphName };
  const metadata = (name: string) => ({
    name,
    namespace: options.namespace,
    labels,
    ...(options.includeWhen ? { annotations: { 'applik8s.dev/include-when': options.includeWhen } } : {}),
  });
  // Projection and stream workers currently have one checkpoint authority and
  // must not overlap generations. HTTP gateways can roll without surge so a
  // bounded cluster never needs spare pod capacity merely to apply an update.
  const strategy = options.kind === 'queryGateway'
    ? { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } }
    : { type: 'Recreate' };
  const permissions = options.permissions ?? [];
  const resources: GeneratedApplicationReactiveResource[] = [
    ...(permissions.length > 0 ? [{ apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(options.name) }] : []),
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: metadata(options.name), spec: { replicas: options.replicas, selector: { matchLabels: labels }, strategy, template: { metadata: { labels, annotations: { 'applik8s.dev/digest': digest } }, spec: { ...(permissions.length > 0 ? { serviceAccountName: options.name } : {}), terminationGracePeriodSeconds: 30, containers: [{ name: 'runtime', image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/runtime.mjs'], env: options.env, ...(options.workflowToken ? { volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }] } : {}), ports: [{ name: 'http', containerPort: options.port }], readinessProbe: { httpGet: { path: '/ready', port: 'http' }, periodSeconds: 5, failureThreshold: 6 }, livenessProbe: { httpGet: { path: '/live', port: 'http' }, periodSeconds: 10, failureThreshold: 6 }, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } } }], ...(options.workflowToken ? { volumes: [{ name: 'workflow-token', secret: { secretName: options.workflowToken.secretName, items: [{ key: options.workflowToken.key, path: 'token' }] } }] } : {}) } } } },
    { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(options.name), spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port: options.port }] }] } },
  ];
  resources.push(...gatewayKubernetesRbacResources(options, permissions, labels));
  if (options.kind === 'queryGateway') resources.push({ apiVersion: 'v1', kind: 'Service', metadata: metadata(options.name), spec: { selector: labels, ports: [{ name: 'http', port: options.port, targetPort: 'http' }] } });
  if (typeof options.replicas === 'number' && options.replicas > 1) resources.push({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: metadata(options.name), spec: { minAvailable: 1, selector: { matchLabels: labels } } });
  if (typeof options.replicas === 'string') resources.push({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: metadata(options.name), spec: { maxUnavailable: reactiveMaxUnavailable(options.replicas), selector: { matchLabels: labels } } });
  return resources;
}

function gatewayKubernetesRbacResources(
  options: { readonly name: string; readonly namespace: string; readonly includeWhen?: string },
  permissions: readonly GatewayKubernetesPermission[],
  labels: Readonly<Record<string, string>>,
): readonly GeneratedApplicationReactiveResource[] {
  if (permissions.length === 0) return [];
  const annotations = options.includeWhen ? { 'applik8s.dev/include-when': options.includeWhen } : undefined;
  const resources: GeneratedApplicationReactiveResource[] = [];
  const fixedNamespaces = new Map<string, GatewayKubernetesPermission[]>();
  const clusterPermissions: GatewayKubernetesPermission[] = [];
  for (const permission of permissions) {
    if (permission.scope === 'Namespaced' && permission.namespace) {
      const values = fixedNamespaces.get(permission.namespace) ?? [];
      values.push(permission);
      fixedNamespaces.set(permission.namespace, values);
    } else clusterPermissions.push(permission);
  }
  for (const [namespace, scoped] of fixedNamespaces) {
    const suffix = namespace === options.namespace ? '' : `-${createHash('sha256').update(namespace).digest('hex').slice(0, 8)}`;
    const name = `${options.name}${suffix}`.slice(0, 63).replace(/-+$/g, '');
    resources.push({
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role',
      metadata: { name, namespace, labels, ...(annotations ? { annotations } : {}) },
      rules: kubernetesPermissionRules(scoped),
    });
    resources.push({
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding',
      metadata: { name, namespace, labels, ...(annotations ? { annotations } : {}) },
      subjects: [{ kind: 'ServiceAccount', name: options.name, namespace: options.namespace }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name },
    });
  }
  if (clusterPermissions.length > 0) {
    resources.push({
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole',
      metadata: { name: options.name, labels, ...(annotations ? { annotations } : {}) },
      rules: kubernetesPermissionRules(clusterPermissions),
    });
    resources.push({
      apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding',
      metadata: { name: options.name, labels, ...(annotations ? { annotations } : {}) },
      subjects: [{ kind: 'ServiceAccount', name: options.name, namespace: options.namespace }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: options.name },
    });
  }
  return resources;
}

function kubernetesPermissionRules(permissions: readonly GatewayKubernetesPermission[]) {
  const grouped = new Map<string, { apiGroups: string[]; resources: string[]; verbs: string[] }>();
  for (const permission of permissions) {
    const key = permission.apiGroup;
    const rule = grouped.get(key) ?? { apiGroups: [permission.apiGroup], resources: [], verbs: ['get', 'list', 'watch'] };
    if (!rule.resources.includes(permission.resource)) rule.resources.push(permission.resource);
    grouped.set(key, rule);
  }
  return [...grouped.values()].map((rule) => ({ ...rule, resources: rule.resources.sort() }));
}

function reactiveMaxUnavailable(replicas: string): string {
  const match = /^\$\{(.+)\}$/.exec(replicas);
  if (!match?.[1]) throw new Error(`Reactive workload replicas must be a serialized installation expression, received ${JSON.stringify(replicas)}.`);
  return `\${(${match[1]}) > 1 ? 1 : 0}`;
}

function reactiveEnvironmentInteger(value: number | string): string {
  if (typeof value === 'number') return String(value);
  const expression = /^\$\{(.+)\}$/.exec(value)?.[1];
  if (!expression) throw new Error(`Reactive processor capacity must be an integer or serialized installation expression, received ${JSON.stringify(value)}.`);
  return `\${string(${expression})}`;
}

function gatewayEnvironment(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  subscriptions: readonly GatewayStreamSubscriptionContract[],
  eventLog: ApplicationProviderNode | undefined,
  receivesInternalOperations: boolean,
): readonly Record<string, unknown>[] {
  if (!gateway.cursorSecret) return [];
  const onlineProviders = queries.flatMap((query) => query.projection?.storage === 'online' ? [gatewayOnlineProjectionContract(graph, query)] : []);
  const analyticalProviders = queries.flatMap((query) => query.projection?.storage === 'analytical' ? [gatewayAnalyticalProjectionContract(graph, query)] : []);
  return uniqueEnvironment([
    { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: gateway.cursorSecret.name, key: gateway.cursorSecret.key } } },
    ...(receivesInternalOperations
      ? [{
          name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
          valueFrom: {
            secretKeyRef: {
              name: `${kubernetesName(graph.metadata.name)}-internal-operation`,
              key: 'key',
            },
          },
        }]
      : []),
    { name: 'APPLIK8S_NAMESPACE', value: applicationGraphStringValue(gateway.deployment?.namespace) ?? 'default' },
    ...queries.flatMap((query) => query.kubernetes?.namespace && serializedInstallationExpression(query.kubernetes.namespace)
      ? [{ name: kubernetesQueryNamespaceEnvironmentName(query.id), value: query.kubernetes.namespace }]
      : []),
    ...uniqueDatabaseRuntimes(queries.map((query) => query.database).filter((database): database is ApplicationReactiveDatabaseRuntimeContract => Boolean(database))).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueCommandDatabases(commands).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueDatabaseRuntimes(subscriptions.map(({ stream }) => stream.database)).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...onlineProviders.flatMap((contract) => gatewayOnlineProjectionEnvironment(contract)),
    ...analyticalProviders.flatMap((contract) => gatewayAnalyticalProjectionEnvironment(contract)),
    ...eventLogEnvironment(eventLog),
  ]);
}

function kubernetesQueryNamespaceEnvironmentName(queryId: string): string {
  return `APPLIK8S_KUBERNETES_QUERY_${createHash('sha256').update(queryId).digest('hex').slice(0, 12).toUpperCase()}_NAMESPACE`;
}

function serializedInstallationExpression(value: string): boolean {
  return value.startsWith('${') && value.endsWith('}');
}

function projectionEnvironment(stream: ApplicationStreamNode, config: Readonly<Record<string, unknown>>): readonly Record<string, unknown>[] {
  const credentials = objectConfig(config.credentialsSecret);
  const credentialName = stringConfig(credentials.name);
  return [
    { name: stream.database.connectionEnvName, valueFrom: { secretKeyRef: { name: stream.database.secretName, key: stream.database.secretKey } } },
    { name: 'APPLIK8S_CLICKHOUSE_ENDPOINT', value: clickHouseEndpoint(config) },
    { name: 'APPLIK8S_CLICKHOUSE_DATABASE', value: applicationGraphStringValue(config.database) || 'default' },
    ...(credentialName ? [
      { name: 'APPLIK8S_CLICKHOUSE_USERNAME', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.usernameKey) || 'username' } } },
      { name: 'APPLIK8S_CLICKHOUSE_PASSWORD', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.passwordKey) || 'password' } } },
    ] : []),
  ];
}

function onlineProjectionEnvironment(stream: ApplicationStreamNode, authentication: Readonly<Record<string, unknown>>, config: Readonly<Record<string, unknown>>, graphName: string): readonly Record<string, unknown>[] {
  const secret = objectConfig(authentication.secret);
  const name = stringConfig(secret.name);
  const dynamicAuthentication = applicationGraphBooleanCondition(authentication.mode);
  return [
    { name: stream.database.connectionEnvName, valueFrom: { secretKeyRef: { name: stream.database.secretName, key: stream.database.secretKey } } },
    { name: 'APPLIK8S_VALKEY_HOST', value: valkeyHost(config, graphName, stream) },
    { name: 'APPLIK8S_VALKEY_PORT', value: reactiveEnvironmentInteger(applicationGraphNumberValue(config.port) ?? 6379) },
    ...((stringConfig(authentication.mode) === 'password' || dynamicAuthentication) && name
      ? [{ name: 'APPLIK8S_VALKEY_PASSWORD', valueFrom: { secretKeyRef: { name, key: stringConfig(authentication.key) || 'password', ...(dynamicAuthentication ? { optional: true } : {}) } } }]
      : []),
  ];
}

function gatewayOnlineProjectionEnvironment(contract: GatewayOnlineProjectionContract): readonly Record<string, unknown>[] {
  const authentication = objectConfig(contract.config.authentication);
  const secret = objectConfig(authentication.secret);
  const name = stringConfig(secret.name);
  const dynamicAuthentication = applicationGraphBooleanCondition(authentication.mode);
  return [
    { name: valkeyHostEnvironmentName(contract.provider.id), value: valkeyHost(contract.config, contract.provider.name, contract.stream) },
    { name: valkeyPortEnvironmentName(contract.provider.id), value: reactiveEnvironmentInteger(applicationGraphNumberValue(contract.config.port) ?? 6379) },
    ...((stringConfig(authentication.mode) === 'password' || dynamicAuthentication) && name ? [{
      name: valkeyPasswordEnvironmentName(contract.provider.id),
      valueFrom: { secretKeyRef: { name, key: stringConfig(authentication.key) || 'password', ...(dynamicAuthentication ? { optional: true } : {}) } },
    }] : []),
  ];
}

function gatewayAnalyticalProjectionEnvironment(contract: GatewayAnalyticalProjectionContract): readonly Record<string, unknown>[] {
  const credentials = objectConfig(contract.config.credentialsSecret);
  const name = stringConfig(credentials.name);
  const enabled = applicationGraphBooleanCondition(contract.config.enabled);
  const enabledValue = enabled?.startsWith('${') && enabled.endsWith('}')
    ? `\${string(${enabled.slice(2, -1)})}`
    : enabled ?? 'true';
  return [
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'ENDPOINT'), value: clickHouseEndpoint(contract.config) },
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'DATABASE'), value: applicationGraphStringValue(contract.config.database) || 'default' },
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'ENABLED'), value: enabledValue },
    ...(name ? [
      { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'USERNAME'), valueFrom: { secretKeyRef: { name, key: stringConfig(contract.config.usernameKey) || 'username' } } },
      { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'PASSWORD'), valueFrom: { secretKeyRef: { name, key: stringConfig(contract.config.passwordKey) || 'password' } } },
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
function assertResolved(owner: string, callback: string, unresolved?: readonly string[]): void { if (unresolved?.length) throw new Error(`${owner} ${callback} callback cannot be emitted because it captures unresolved local identifier(s): ${unresolved.map((identifier) => JSON.stringify(identifier)).join(', ')}. Move them to module scope or keep this declaration runtime-only.`); }
function assertSecretNamespace(database: ApplicationReactiveDatabaseRuntimeContract, namespace: string, owner: string): void { assertResourceNamespace(database.secretNamespace, namespace, `${owner} PostgreSQL Secret ${database.secretName}`); }
function assertResourceNamespace(resourceNamespace: unknown, workloadNamespace: unknown, owner: string): void { const resource = applicationGraphStringValue(resourceNamespace); const workload = applicationGraphStringValue(workloadNamespace); if (resource && workload && resource !== workload) throw new Error(`${owner} is in namespace ${resource}, but its generated workload is in ${workload}. Kubernetes cannot mount cross-namespace Secrets.`); }
function uniqueDatabaseRuntimes(databases: readonly ApplicationReactiveDatabaseRuntimeContract[]): readonly ApplicationReactiveDatabaseRuntimeContract[] { const result = new Map<string, ApplicationReactiveDatabaseRuntimeContract>(); for (const database of databases) { const previous = result.get(database.name); if (previous && JSON.stringify(previous) !== JSON.stringify(database)) throw new Error(`Generated reactive runtimes contain conflicting database contracts named ${database.name}.`); result.set(database.name, database); } return [...result.values()].sort((left, right) => left.name.localeCompare(right.name)); }
function uniqueCommandDatabases(commands: readonly GatewayCommandContract[]): readonly NonNullable<ApplicationModelNode['runtime']>[] { const result = new Map<string, NonNullable<ApplicationModelNode['runtime']>>(); for (const command of commands) result.set(command.model.runtime.connectionEnvName, command.model.runtime); return [...result.values()]; }
// typecast: the exact-one guard and provider type predicate establish a present EventLog provider.
function gatewayEventLog(nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>, owner: string): ApplicationProviderNode { const providers = [...nodes.values()].filter((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'EventLog'); if (providers.length !== 1) throw new Error(`Generated gateway ${owner} commands require exactly one EventLog provider.`); return providers[0] as ApplicationProviderNode; }
function eventLogEnvironment(provider?: ApplicationProviderNode): readonly Record<string, unknown>[] { if (!provider) return []; const config = provider.config ?? {}; const secret = objectConfig(config.connectionSecret); const name = stringConfig(secret.name); const connection = [{ name: 'APPLIK8S_NATS_SERVERS', value: JSON.stringify(eventLogServers(config)) }]; if (!name) return connection; const mode = stringConfig(config.authMode) || 'token'; return mode === 'userPassword' ? [...connection, { name: 'APPLIK8S_NATS_USER', valueFrom: { secretKeyRef: { name, key: stringConfig(config.userKey) || 'user' } } }, { name: 'APPLIK8S_NATS_PASSWORD', valueFrom: { secretKeyRef: { name, key: stringConfig(config.passwordKey) || 'password' } } }] : [...connection, { name: 'APPLIK8S_NATS_TOKEN', valueFrom: { secretKeyRef: { name, key: stringConfig(config.tokenKey) || 'token' } } }]; }
function streamProcessorScheduleEnvironment(contract: StreamProcessorWorkflowContract | undefined): readonly Record<string, unknown>[] {
  if (!contract) return [];
  const config = contract.provider.config ?? {};
  const namespace = applicationGraphStringValue(config.namespace) || 'default';
  const engineName = kubernetesName(stringConfig(config.name) || 'applik8s-hatchet');
  const { secretName, key: tokenKey } = streamProcessorWorkflowCredential(contract);
  return [
    { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: secretName, key: tokenKey } } },
    { name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' },
    { name: 'HATCHET_CLIENT_HOST_PORT', value: applicationGraphStringValue(config.hostPort) || `${engineName}-engine.${namespace}.svc:7070` },
    { name: 'HATCHET_CLIENT_API_URL', value: applicationGraphStringValue(config.apiUrl) || `http://${engineName}-api.${namespace}.svc:8080` },
    { name: 'HATCHET_CLIENT_TLS_STRATEGY', value: reactiveWorkflowTlsStrategy(config.tls) },
  ];
}
function streamProcessorWorkflowCredential(contract: StreamProcessorWorkflowContract): { readonly secretName: string; readonly key: string } {
  const config = contract.provider.config ?? {};
  const engineName = kubernetesName(stringConfig(config.name) || 'applik8s-hatchet');
  const worker = objectConfig(config.workerTokenSecret);
  return {
    secretName: applicationGraphStringValue(worker.name) || (config.provision === false ? `${engineName}-worker` : 'hatchet-client-config'),
    key: stringConfig(config.tokenKey) || (applicationGraphStringValue(worker.name) || config.provision !== false ? 'HATCHET_CLIENT_TOKEN' : 'token'),
  };
}
function reactiveWorkflowTlsStrategy(value: unknown): string {
  if (value === true) return 'tls';
  if (value === false || value === undefined) return 'none';
  const condition = applicationGraphBooleanCondition(value);
  if (!condition) throw new Error('Generated stream processor WorkflowEngine tls must be boolean or an installation expression.');
  const expression = /^\$\{(.+)\}$/.exec(condition)?.[1];
  return expression ? `\${(${expression}) ? "tls" : "none"}` : condition === 'true' ? 'tls' : 'none';
}
function uniqueEnvironment(entries: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] { const result = new Map<string, Record<string, unknown>>(); for (const entry of entries) { const name = stringConfig(entry.name); const previous = result.get(name); if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`Generated reactive workload has conflicting environment bindings for ${name}.`); result.set(name, entry); } return [...result.values()]; }
function callbackName(id: string, role: string): string { return `${role}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function callbackVariable(id: string, role: string): string { return `callback_${role}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function databaseVariable(name: string): string { return `database_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`; }
function projectionQuerySourceVariable(id: string): string { return `projection_source_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function valkeyHostEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_HOST_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function valkeyPortEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_PORT_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function valkeyPasswordEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_PASSWORD_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function clickHouseGatewayEnvironmentName(providerId: string, suffix: 'ENDPOINT' | 'DATABASE' | 'USERNAME' | 'PASSWORD' | 'ENABLED'): string { return `APPLIK8S_CLICKHOUSE_${suffix}_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function clickHouseEndpoint(config: Readonly<Record<string, unknown>>): string { const explicit = applicationGraphStringValue(config.endpoint); if (explicit) return explicit; const name = stringConfig(config.name) || 'applik8s-analytics'; return `http://${applicationGraphServiceHost(`clickhouse-${name}`, config.namespace)}:8123`; }
function valkeyHost(config: Readonly<Record<string, unknown>>, graphName: string, stream: ApplicationStreamNode): string { const explicit = applicationGraphStringValue(config.host); if (explicit) return explicit; const name = stringConfig(config.name) || `${kubernetesName(graphName)}-index`; return applicationGraphServiceHost(name, applicationGraphStringValue(config.namespace) || applicationGraphStringValue(stream.database.secretNamespace) || 'default'); }
function eventLogServers(config: Readonly<Record<string, unknown>>): readonly string[] { const configured = Array.isArray(config.servers) ? config.servers.map(applicationGraphStringValue).filter((value): value is string => Boolean(value)) : []; if (configured.length > 0) return configured; const name = stringConfig(config.name) || 'applik8s-events'; const namespace = applicationGraphStringValue(config.namespace); return [`nats://${name}${namespace ? `.${namespace}` : ''}.svc:4222`]; }
function absoluteDependencyImports(source: string, resolveDir: string): string { return source.replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`).replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`); }
// typecast: the object and non-array guards establish the read-only configuration record boundary.
function objectConfig(value: unknown): Readonly<Record<string, unknown>> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}; }
function stringConfig(value: unknown): string { return typeof value === 'string' ? value : ''; }
function kubernetesName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'; }
