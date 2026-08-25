// typecast-file-boundary: normalized reactive graph nodes are discriminator-checked before generated runtime contracts regain their specific shapes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ApplicationAIAgentNode, ApplicationCallableProviderBinding, ApplicationCallableProviderRuntimeOperation, ApplicationCommandHandlerNode, ApplicationCommandNode, ApplicationGatewayNode, ApplicationGraph, ApplicationHandlerDependencies, ApplicationIdentityReference, ApplicationIndexNode, ApplicationModelNode, ApplicationOperationCatalog, ApplicationProfiledCallbackContract, ApplicationProjectionNode, ApplicationProviderNode, ApplicationQueryNode, ApplicationReactiveDatabaseRuntimeContract, ApplicationSearchIndexPlan, ApplicationSerializedCallbackContract, ApplicationStreamNode, ApplicationStreamProcessorNode, ApplicationSubscriptionNode, ApplicationWorkloadAuthorityEnvelope, JsonObject } from '@applik8s/core';
import type { ApplicationFrameworkCredentialDependency } from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import ts from 'typescript';
import {
  applicationActorInvocationBoundary,
  generatedApplicationActorInvocationClientSource,
} from '../application-actor-invocation.js';
import { applicationCallableProviderEnvironment } from '../application-callable-provider-runtime.js';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import type { GeneratedApplicationContainerArtifact } from '../application-containers/index.js';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import { generatedApplicationEventLogPublisherSource } from '../application-event-log-runtime-source.js';
import { generatedApplicationFetchGatewayModules } from '../application-fetch-gateway/index.js';
import { applicationFrameworkCredentialDependencies } from '../application-framework-credentials.js';
import {
  applicationKubernetesFixedScheduleResources,
  applicationScheduleDatabaseEnvironment,
  applicationWorkflowScheduleEnvironment,
} from '../application-host/index.js';
import { applicationGraphAllConditions, applicationGraphBooleanCondition, applicationGraphJsonStringArray, applicationGraphNumberValue, applicationGraphServiceHost, applicationGraphStringValue } from '../application-installation-values.js';
import type { ApplicationOperationPlacementReceiver } from '../application-mcp/index.js';
import { compileApplicationMcpPlacementRoutes, compileApplicationOperationPlacementReceiver } from '../application-mcp/index.js';
import { applicationObjectStorageEnvironment } from '../application-object-storage-environment.js';
import { applicationGraphHasObservabilityRuntime, generatedApplicationTelemetryImports, generatedApplicationTelemetryRuntimeSource } from '../application-observability-runtime-source.js';
import { applicationStaticAuthorityManifest, compileApplicationOperationCatalog, compileApplicationWorkloadAuthority } from '../application-operations/index.js';
import { generatedApplicationProviderOperationValue } from '../application-provider-telemetry-source.js';
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
  readonly nodeId: string;
  readonly kind:
    | 'queryGateway'
    | 'projectionWorker'
    | 'searchProjectionWorker'
    | 'streamProcessorWorker'
    | 'scheduleControlWorker';
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationReactiveResource[];
  readonly frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[];
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
  const gateways = options.artifacts.filter((artifact) =>
    artifact.kind === 'queryGateway' || artifact.kind === 'scheduleControlWorker');
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
  const groups = reactiveArtifactGroups(options.artifacts.filter((entry) =>
    entry.kind !== 'queryGateway' && entry.kind !== 'scheduleControlWorker'));
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

interface GatewaySearchContract {
  readonly query: ApplicationQueryNode;
  readonly index: ApplicationIndexNode & {
    readonly search: ApplicationSearchIndexPlan;
  };
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly models: readonly (ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
    readonly common: NonNullable<ApplicationModelNode['common']>;
  })[];
}

interface SearchProjectionWorkItem {
  readonly contract: GatewaySearchContract;
  readonly namespace: string;
  readonly cursorSecret: NonNullable<ApplicationGatewayNode['cursorSecret']>;
  readonly profileSelector?: string;
}

interface GatewayKubernetesPermission {
  readonly apiGroup: string;
  readonly resource: string;
  readonly scope: 'Namespaced' | 'Cluster';
  readonly namespace?: string;
  readonly verbs?: readonly string[];
}

interface ReactiveProjectedServiceAccountToken {
  readonly name: string;
  readonly mountPath: string;
  readonly path: string;
  readonly audience: string;
  readonly expirationSeconds?: number;
}

interface BundleReactiveOptions {
  readonly graphName: string;
  readonly name: string;
  readonly nodeId: string;
  readonly kind: GeneratedApplicationReactiveArtifact['kind'];
  readonly namespace: string;
  readonly image: string;
  readonly replicas: number | string;
  readonly port: number;
  readonly entrypoint: string;
  readonly artifactDir: string;
  readonly env: readonly Record<string, unknown>[];
  readonly includeWhen?: string;
  readonly permissions?: readonly GatewayKubernetesPermission[];
  readonly workflowToken?: { readonly secretName: string; readonly key: string };
  readonly serviceAccountToken?: ReactiveProjectedServiceAccountToken;
  readonly caCertificates?: readonly ReactiveCaCertificate[];
  readonly extraResources?: (
    image: string,
    digest: string,
  ) => readonly GeneratedApplicationReactiveResource[];
}

interface ReactiveCaCertificate {
  readonly name: string;
  readonly key: string;
}

interface ApplicationInternalPlacementRoute {
  readonly operationId: ApplicationOperationCatalog['operations'][number]['id'];
  readonly audience: string;
  readonly receiver: ApplicationOperationPlacementReceiver;
}

/** Lowers deployable v0.6 query gateways and analytical/online projections into immutable Node workloads. */
export async function emitGeneratedApplicationReactive(options: {
  readonly graph: ApplicationGraph;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly outDir: string;
  readonly entrypoint: string;
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationReactiveArtifact[]> {
  const operationCatalog = options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const workloadAuthority = compileApplicationWorkloadAuthority(
    options.graph,
    operationCatalog,
  );
  const mcpRoutes = compileApplicationMcpPlacementRoutes(
    options.graph,
    operationCatalog,
  );
  const internalPlacementRoutes = [
    ...mcpRoutes,
    ...compileApplicationAgentPlacementRoutes(
      options.graph,
      operationCatalog,
      workloadAuthority,
    ),
  ];
  const gateways = options.graph.nodes.filter((node): node is ApplicationGatewayNode => node.kind === 'gateway' && node.materialization === 'generatedDeployment');
  const projections = options.graph.nodes.filter((node): node is ApplicationProjectionNode => node.kind === 'projection');
  const streamProcessors = options.graph.nodes.filter((node): node is ApplicationStreamProcessorNode => node.kind === 'streamProcessor');
  const searchProjections = searchProjectionWorkItems(options.graph, gateways);
  const scheduleControl = applicationNeedsScheduleControl(options.graph);
  if (gateways.length === 0 && projections.length === 0 && streamProcessors.length === 0 && searchProjections.length === 0 && !scheduleControl) return [];
  await mkdir(options.outDir, { recursive: true });
  return [
    ...await Promise.all(gateways.map((gateway) => emitGateway(
      options.graph,
      gateway,
      operationCatalog,
      internalPlacementRoutes.filter(
        (route) => route.receiver.nodeId === gateway.id,
      ),
      options.outDir,
      options.executionTarget ?? 'kubernetes',
    ))),
    ...await Promise.all(projections.map((projection) => emitProjection(options.graph, projection, options.outDir))),
    ...await Promise.all(searchProjections.map((projection) => emitSearchProjection(options.graph, projection, options.outDir))),
    ...await Promise.all(streamProcessors.map((processor) =>
      emitStreamProcessor(
        options.graph,
        processor,
        operationCatalog,
        workloadAuthority,
        options.outDir,
        options.executionTarget ?? 'kubernetes',
      ))),
    ...(scheduleControl
      ? [await emitScheduleControl(
          options.graph,
          options.outDir,
          options.executionTarget ?? 'kubernetes',
        )]
      : []),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function applicationNeedsScheduleControl(graph: ApplicationGraph): boolean {
  if (graph.nodes.some((node) =>
    node.kind === 'provider'
      && node.interface === 'ApplicationHost'
      && !node.config?.qualification)) return false;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.nodes.some((node) => {
    if (node.kind !== 'schedule') return false;
    const provider = nodes.get(node.scheduler.nodeId);
    return provider?.kind === 'provider' && !provider.config?.qualification;
  });
}

async function emitScheduleControl(
  graph: ApplicationGraph,
  outDir: string,
  executionTarget: 'kubernetes' | 'local' | 'aws-local' | 'aws',
): Promise<GeneratedApplicationReactiveArtifact> {
  const name = kubernetesName(`${graph.metadata.name}-schedule-control`);
  const namespace = applicationGraphStringValue(graph.metadata.namespace) ?? 'default';
  const port = 8080;
  const artifactDir = join(outDir, name);
  const generated = generatedApplicationFetchGatewayModules(graph, {
    surface: 'schedules',
    scheduleHost: { name, namespace, port },
  });
  if (!generated) {
    throw new Error(
      `Application ${graph.metadata.name} requires schedule control, but no unqualified schedule surface was generated.`,
    );
  }
  await mkdir(artifactDir, { recursive: true });
  await Promise.all(Object.entries(generated.files).map(async ([path, source]) => {
    const target = join(artifactDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }));
  const entrypoint = join(artifactDir, 'schedule-control.generated.ts');
  await writeFile(entrypoint, generatedScheduleControlSource());
  const durableWorkflowAccess = graph.nodes.some(
    (node) => node.kind === 'schedule' && node.target?.kind === 'durableStart',
  );
  const permissions: readonly GatewayKubernetesPermission[] = executionTarget === 'kubernetes'
    ? [{
        apiGroup: 'batch',
        resource: 'cronjobs',
        scope: 'Namespaced',
        namespace,
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      }]
    : [];
  return bundleReactive({
    graphName: graph.metadata.name,
    name,
    nodeId: `schedule-control.${graph.metadata.name}`,
    kind: 'scheduleControlWorker',
    namespace,
    image: DEFAULT_NODE_IMAGE,
    replicas: 1,
    port,
    entrypoint,
    artifactDir,
    env: [
      { name: 'APPLIK8S_HTTP_PORT', value: String(port) },
      { name: 'APPLIK8S_APPLICATION_NAME', value: graph.metadata.name },
      { name: 'APPLIK8S_DEPLOYMENT_TARGET', value: executionTarget },
      { name: 'APPLIK8S_ENVIRONMENT_ID', value: namespace },
      { name: 'APPLIK8S_NAMESPACE', value: namespace },
      {
        name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
        valueFrom: {
          secretKeyRef: {
            name: `${kubernetesName(graph.metadata.name)}-internal-operation`,
            key: 'key',
            optional: false,
          },
        },
      },
      ...applicationScheduleDatabaseEnvironment(graph, namespace),
      ...applicationWorkflowScheduleEnvironment(graph),
    ],
    permissions,
    ...(durableWorkflowAccess
      ? {
          serviceAccountToken: {
            name: 'workflow-gateway-token',
            mountPath: '/var/run/secrets/applik8s/workflow-gateway',
            path: 'token',
            audience: 'https://kubernetes.default.svc',
            expirationSeconds: 3_600,
          },
        }
      : {}),
    ...(executionTarget === 'kubernetes'
      ? {
          extraResources: (image) => applicationKubernetesFixedScheduleResources({
            graph,
            namespace,
            hostName: name,
            image,
            imagePullPolicy: 'IfNotPresent',
            internalOperationSecretName: `${kubernetesName(graph.metadata.name)}-internal-operation`,
            port,
          }),
        }
      : {}),
  });
}

function generatedScheduleControlSource(): string {
  return `import { createServer } from 'node:http';
import { closeApplik8sGateway, handleApplik8sRequest } from './gateway.generated.js';

const maximumBodyBytes = 1_048_576;
let stopping = false;

const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Schedule-control request disconnected.'));
  incoming.once('aborted', abort);
  outgoing.once('close', abort);
  try {
    if (stopping && incoming.url !== '/live') {
      await writeWebResponse(outgoing, new Response(JSON.stringify({ ready: false, stopping: true }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }));
      return;
    }
    const request = await webRequest(incoming, controller.signal);
    const url = new URL(request.url);
    if (url.pathname === '/live') url.pathname = '/__applik8s/v1/healthz';
    if (url.pathname === '/ready') url.pathname = '/__applik8s/v1/readyz';
    await writeWebResponse(outgoing, await handleApplik8sRequest(new Request(url, request)));
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Applik8s schedule-control request failed', error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'schedule_control_failed' }));
    }
  } finally {
    incoming.removeListener('aborted', abort);
    outgoing.removeListener('close', abort);
  }
});

server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? '8080'), '0.0.0.0');

async function webRequest(incoming, signal) {
  const chunks = [];
  let size = 0;
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > maximumBodyBytes) throw new Error('Schedule-control request body exceeds 1 MiB.');
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

function compileApplicationAgentPlacementRoutes(
  graph: ApplicationGraph,
  catalog: ApplicationOperationCatalog,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): readonly ApplicationInternalPlacementRoute[] {
  const operations = new Map(
    catalog.operations.map((operation) => [operation.id, operation]),
  );
  return graph.nodes
    .filter((node): node is ApplicationAIAgentNode => node.kind === 'aiAgent')
    .flatMap((agent) =>
      [
        ...agent.tools.flatMap((tool) => tool.local ? [] : [{
          operationId: tool.operationId,
          dependency: 'tool',
        } as const]),
        ...(agent.operations ?? []).map((operation) => ({
          operationId: operation.operationId,
          dependency: 'function-native operation',
        } as const)),
      ].flatMap((reference) => {
        const operation = operations.get(reference.operationId);
        if (!operation) {
          throw new Error(
            `Application agent ${agent.name} exposes unavailable ${reference.dependency} ${reference.operationId}.`,
          );
        }
        const envelope = workloadAuthority.find(
          (candidate) =>
            candidate.workloadIdentity.subject === agent.id
            && candidate.serviceIdentity?.id === agent.serviceIdentity.id
            && candidate.operationId === reference.operationId,
        );
        if (!envelope || envelope.audiences.length === 0) {
          throw new Error(
            `Application agent ${agent.name} ${reference.dependency} ${reference.operationId} has no compiler-proven internal audience.`,
          );
        }
        const receiver = compileApplicationOperationPlacementReceiver(
          graph,
          operation,
          `Application agent ${agent.name} ${reference.dependency} ${operation.id}`,
        );
        return envelope.audiences.map((audience) => ({
          operationId: operation.id,
          audience,
          receiver,
        }));
      })
    )
    .sort((left, right) =>
      `${left.receiver.nodeId}:${left.operationId}:${left.audience}`.localeCompare(
        `${right.receiver.nodeId}:${right.operationId}:${right.audience}`,
      ),
    );
}

function searchProjectionWorkItems(
  graph: ApplicationGraph,
  gateways: readonly ApplicationGatewayNode[],
): readonly SearchProjectionWorkItem[] {
  const nodes = graphNodes(graph);
  const work = new Map<string, SearchProjectionWorkItem>();
  for (const gateway of gateways) {
    if (!gateway.deployment || !gateway.cursorSecret) continue;
    const namespace = applicationGraphStringValue(gateway.deployment.namespace) ?? 'default';
    const profileSelector = applicationGatewayProfileSelector(gateway, graph);
    for (const reference of gateway.queries) {
      const query = requiredNode(nodes, reference.nodeId, 'query', gateway.id);
      if (!query.search) continue;
      const contract = gatewaySearchContract(graph, query);
      const key = contract.index.id;
      const existing = work.get(key);
      if (existing) {
        if (
          existing.namespace !== namespace
          || existing.cursorSecret.name !== gateway.cursorSecret.name
          || existing.cursorSecret.key !== gateway.cursorSecret.key
          || existing.profileSelector !== profileSelector
        ) {
          throw new Error(
            `Search projection ${contract.index.id} is exposed by gateways with incompatible namespace, cursor, or profile authority.`,
          );
        }
        continue;
      }
      work.set(key, {
        contract,
        namespace,
        cursorSecret: gateway.cursorSecret,
        ...(profileSelector ? { profileSelector } : {}),
      });
    }
  }
  return [...work.values()].sort((left, right) =>
    left.contract.index.id.localeCompare(right.contract.index.id));
}

async function emitGateway(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  operationCatalog: ApplicationOperationCatalog,
  internalPlacementRoutes: readonly ApplicationInternalPlacementRoute[],
  outDir: string,
  executionTarget: 'kubernetes' | 'local' | 'aws-local' | 'aws',
): Promise<GeneratedApplicationReactiveArtifact> {
  if (
    !gateway.deployment
    || !gateway.cursorSecret
    || (!gateway.authenticationSource && !gateway.authenticationProfile)
  ) {
    throw new Error(
      `Generated application gateway ${gateway.id} is missing deployment, cursor Secret, or authentication source.`,
    );
  }
  const gatewayNamespace = applicationGraphStringValue(gateway.deployment.namespace) ?? 'default';
  assertGatewayCallbackResolved(
    gateway.id,
    'authentication',
    gateway.authenticationProfile,
    gateway.authenticationUnresolved,
  );
  assertGatewayCallbackResolved(
    gateway.id,
    'identity readiness',
    gateway.identityReadinessProfile,
    gateway.identityReadinessUnresolved,
  );
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
  const eventLog = commands.length > 0 ? gatewayEventLog(nodes, gateway.id, commands) : undefined;
  if (commands.length > 0 && !operationCatalog) {
    throw new Error(`Generated application gateway ${gateway.id} requires its compiled operation catalog.`);
  }
  if (
    internalPlacementRoutes.length > 0
    && !gatewayAuthorityDatabaseEnvironment(queries, commands, subscriptions)
  ) {
    throw new Error(
      `Generated application gateway ${gateway.id} requires one transactional operation-authority database before it can receive internal placement invocations.`,
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
    } else if (query.search) {
      if (!query.database) {
        throw new Error(
          `Generated application gateway ${gateway.id} search ${query.id} has no committed-change database.`,
        );
      }
      gatewaySearchContract(graph, query);
      assertSecretNamespace(query.database, gatewayNamespace, `gateway ${gateway.id}`);
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
  if (gateway.authenticationProfile) {
    await writeProfiledCallbackModule(
      artifactDir,
      'authentication',
      gateway.authenticationProfile,
    );
  } else if (gateway.authenticationSource) {
    await writeCallbackModule(
      artifactDir,
      'authentication',
      gateway.authenticationSource,
      gateway.authenticationDependencies,
    );
  }
  if (gateway.identityReadinessProfile) {
    await writeProfiledCallbackModule(
      artifactDir,
      'identity-readiness',
      gateway.identityReadinessProfile,
    );
  } else if (gateway.identityReadinessSource) {
    await writeCallbackModule(
      artifactDir,
      'identity-readiness',
      gateway.identityReadinessSource,
      gateway.identityReadinessDependencies,
    );
  }
  if (gateway.authorizationReadinessSource) await writeCallbackModule(artifactDir, 'authorization-readiness', gateway.authorizationReadinessSource, gateway.authorizationReadinessDependencies);
  if (commands.length > 0 && gateway.commandAuthorizationSource) await writeGatewayCommandAuthorizationModule(artifactDir, gateway.commandAuthorizationSource, gateway.commandAuthorizationDependencies, graph);
  for (const { subscription, stream } of subscriptions) {
    await writeCallbackModule(artifactDir, callbackName(subscription.id, 'authorize'), subscription.authorizationSource, subscription.authorizationDependencies);
    if (!stream.signal) {
      await writeCallbackModule(artifactDir, callbackName(stream.id, 'authorize-stream'), stream.authorizationSource, stream.authorizationDependencies);
    }
  }
  for (const query of queries) {
    if (!query.search) {
      await writeQueryCallbackModule(artifactDir, callbackName(query.id, 'authorize'), query.authorizationSource, query.authorizationDependencies, query, graph);
    }
    if (query.kubernetes) {
      for (const [property, callback] of kubernetesQueryCallbacks(query)) {
        await writeQueryCallbackModule(artifactDir, callbackName(query.id, kubernetesCallbackRole(property)), callback.source, callback.dependencies, query, graph);
      }
    } else if (!query.search) {
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
    internalPlacementRoutes,
    executionTarget,
  ));
  return bundleReactive({
    graphName: graph.metadata.name, name, nodeId: gateway.id, kind: 'queryGateway', namespace: gatewayNamespace,
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
      internalPlacementRoutes.length > 0,
    ),
    caCertificates: gatewaySearchCaCertificates(
      graph,
      queries,
      gatewayNamespace,
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
  const config = clickHouseAnalyticalProviderConfig(
    provider,
    applicationGraphStringValue(stream.database.secretNamespace)
      || applicationGraphStringValue(graph.metadata.namespace)
      || 'default',
    `Generated analytical projection ${projection.id}`,
  );
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
    nodeId: projection.id,
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
  return bundleReactive({ graphName: graph.metadata.name, name, nodeId: projection.id, kind: 'projectionWorker', namespace, image: DEFAULT_NODE_IMAGE, replicas: 1, port: 8080, entrypoint, artifactDir, env: environment });
}

async function emitSearchProjection(
  graph: ApplicationGraph,
  work: SearchProjectionWorkItem,
  outDir: string,
): Promise<GeneratedApplicationReactiveArtifact> {
  const database = work.contract.query.database;
  if (!database) {
    throw new Error(
      `Generated search projection ${work.contract.index.id} has no committed-change database.`,
    );
  }
  assertSecretNamespace(
    database,
    work.namespace,
    `search projection ${work.contract.index.id}`,
  );
  const name = kubernetesName(
    `${graph.metadata.name}-${work.contract.index.name}-search`,
  );
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  const entrypoint = join(artifactDir, 'search-projection.generated.ts');
  await writeFile(entrypoint, generatedSearchProjectionSource(work.contract));
  return bundleReactive({
    graphName: graph.metadata.name,
    name,
    nodeId: work.contract.index.id,
    kind: 'searchProjectionWorker',
    namespace: work.namespace,
    image: DEFAULT_NODE_IMAGE,
    replicas: 1,
    port: 8080,
    entrypoint,
    artifactDir,
    env: searchProjectionEnvironment(work),
    caCertificates: searchCaCertificates(
      work.contract,
      work.namespace,
    ),
  });
}

async function emitStreamProcessor(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operationCatalog: ApplicationOperationCatalog,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
  outDir: string,
  executionTarget: 'kubernetes' | 'local' | 'aws-local' | 'aws',
): Promise<GeneratedApplicationReactiveArtifact> {
  assertResolved(processor.id, 'handler', processor.handlerUnresolved);
  const nodes = graphNodes(graph);
  const stream = requiredNode(nodes, processor.source.nodeId, 'stream', processor.id);
  assertResolved(stream.id, 'partition', stream.partitionUnresolved);
  assertResolved(stream.id, 'authorization', stream.authorizationUnresolved);
  const namespace = applicationGraphStringValue(processor.database.secretNamespace) || applicationGraphStringValue(graph.metadata.namespace) || 'default';
  assertSecretNamespace(processor.database, namespace, `stream processor ${processor.id}`);
  const workflow = streamProcessorWorkflowContract(graph, processor, namespace);
  const operations = streamProcessorOperationContracts(
    graph,
    processor,
    operationCatalog,
  );
  const queries = streamProcessorQueryContracts(graph, processor);
  const actorApplicationEndpoint = (processor.actorBindings?.length ?? 0) > 0
    ? applicationActorInvocationBoundary(
        graph,
        namespace,
        `Generated stream processor ${processor.id}`,
      ).endpoint
    : undefined;
  const serviceIdentity = inferredStreamProcessorServiceIdentity(
    graph,
    processor,
    operationCatalog,
  );
  if (processor.invocation === 'batch' && operations.length > 0) {
    throw new Error(
      `Generated batch processor ${processor.id} reaches durable model operations. Batch command authority requires an explicit per-item identity and is not inferred from one frozen batch.`,
    );
  }
  const name = kubernetesName(`${graph.metadata.name}-${processor.name}`);
  const artifactDir = join(outDir, name);
  await mkdir(artifactDir, { recursive: true });
  await writeStreamHandlerModule(artifactDir, processor, operations, queries);
  for (const binding of queries) {
    await writeQueryCallbackModule(
      artifactDir,
      callbackName(binding.query.id, 'authorize'),
      binding.query.authorizationSource,
      binding.query.authorizationDependencies,
      binding.query,
      graph,
    );
    await writeQueryCallbackModule(
      artifactDir,
      callbackName(binding.query.id, 'run'),
      binding.query.handlerSource,
      binding.query.handlerDependencies,
      binding.query,
      graph,
    );
  }
  const entrypoint = join(artifactDir, 'stream-processor.generated.ts');
  await writeFile(
    entrypoint,
    generatedStreamProcessorSource(
      graph,
      processor,
      stream,
      workflow,
      operationCatalog,
      operations,
      queries,
      serviceIdentity,
      workloadAuthority,
    ),
  );
  const includeWhen = applicationGraphAllConditions(processor.enabled, workflow?.provider.config?.enabled);
  const usesObjectStorage = streamProcessorUsesObjectStorage(processor);
  const callableProviders = streamProcessorCallableProviders(graph, processor);
  return bundleReactive({
    graphName: graph.metadata.name,
    name,
    nodeId: processor.id,
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
      ...(usesObjectStorage
        ? applicationObjectStorageEnvironment(
            graph,
            namespace,
            `Generated stream processor ${processor.id}`,
          )
        : []),
      ...streamProcessorScheduleEnvironment(workflow),
      ...applicationCallableProviderEnvironment(callableProviders, {
        target: executionTarget,
        namespace,
      }),
      ...(queries.length > 0 ? [{
        name: 'APPLIK8S_CONTEXT_SECRET',
        valueFrom: {
          secretKeyRef: {
            name: `${kubernetesName(graph.metadata.name)}-context`,
            key: 'key',
          },
        },
      }] : []),
      ...(actorApplicationEndpoint
        ? [
            {
              name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT',
              value: actorApplicationEndpoint,
            },
            {
              name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
              valueFrom: {
                secretKeyRef: {
                  name: `${kubernetesName(graph.metadata.name)}-internal-operation`,
                  key: 'key',
                  optional: false,
                },
              },
            },
          ]
        : []),
    ],
    ...(workflow ? { workflowToken: streamProcessorWorkflowCredential(workflow) } : {}),
    ...(includeWhen !== undefined ? { includeWhen } : {}),
  });
}

function streamProcessorCallableProviders(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
): readonly ApplicationProviderNode[] {
  const providers = new Map<string, ApplicationProviderNode>();
  for (const binding of processor.providerBindings ?? []) {
    if (!binding.operation) continue;
    const provider = graph.nodes.find(
      (candidate): candidate is ApplicationProviderNode =>
        candidate.kind === 'provider'
        && candidate.id === binding.provider.nodeId,
    );
    if (!provider || provider.interface !== binding.provider.interface) {
      throw new Error(
        `Stream processor ${processor.id} provider binding ${binding.identifier} references missing provider ${binding.provider.nodeId}.`,
      );
    }
    providers.set(provider.id, provider);
  }
  return [...providers.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function streamProcessorUsesObjectStorage(
  processor: ApplicationStreamProcessorNode,
): boolean {
  return (processor.providerBindings ?? []).some(
    (binding) => binding.provider.interface === 'ObjectStorage',
  );
}

interface StreamProcessorProviderRuntimeOperation {
  readonly binding: ApplicationCallableProviderBinding;
  readonly runtime: ApplicationCallableProviderRuntimeOperation;
  readonly variable: string;
}

function streamProcessorProviderRuntimeOperations(
  processor: ApplicationStreamProcessorNode,
): readonly StreamProcessorProviderRuntimeOperation[] {
  return (processor.providerBindings ?? []).flatMap((binding) => {
    if (!binding.operation) return [];
    const runtime = binding.operation.runtime;
    if (!runtime) {
      throw new Error(
        `Stream processor ${processor.id} provider operation ${binding.provider.interface}.${binding.operation.member} has no portable generated-worker runtime. Declare it on defineApplicationProvider({ runtime: { operations: ... } }).`,
      );
    }
    if (
      !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*|[a-z0-9][a-z0-9._/-]*)$/u.test(
        runtime.module,
      )
      || runtime.module.includes('..')
      || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(runtime.export)
    ) {
      throw new Error(
        `Stream processor ${processor.id} provider operation ${binding.identifier} has an invalid public runtime export ${runtime.module}#${runtime.export}.`,
      );
    }
    return [{
      binding,
      runtime,
      variable: `providerOperation_${createHash('sha256')
        .update(`${runtime.module}\0${runtime.export}`)
        .digest('hex')
        .slice(0, 12)}`,
    }];
  });
}

function streamProcessorProviderRuntimeImports(
  processor: ApplicationStreamProcessorNode,
): readonly string[] {
  return streamProcessorProviderRuntimeOperations(processor)
    .filter(
      (operation, index, operations) =>
        operations.findIndex(
          (candidate) => candidate.variable === operation.variable,
        ) === index,
    )
    .map(
      ({ runtime, variable }) =>
        `import { ${runtime.export} as ${variable} } from ${JSON.stringify(runtime.module)};`,
    );
}

interface StreamProcessorQueryContract {
  readonly identifier: string;
  readonly query: ApplicationQueryNode & {
    readonly database: NonNullable<ApplicationQueryNode['database']>;
  };
}

function streamProcessorQueryContracts(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
): readonly StreamProcessorQueryContract[] {
  const nodes = graphNodes(graph);
  return (processor.queryBindings ?? []).map((binding) => {
    const query = requiredNode(nodes, binding.query.nodeId, 'query', processor.id);
    if (!query.database || query.kubernetes || query.projection || query.search) {
      throw new Error(
        `Generated stream processor ${processor.id} view ${query.id} must use one local relational authority. Projection, search, and Kubernetes views require a generated gateway boundary.`,
      );
    }
    if (query.database.connectionEnvName !== processor.database.connectionEnvName) {
      throw new Error(
        `Generated stream processor ${processor.id} cannot call ${query.id}: the source uses ${processor.database.connectionEnvName}, while the view uses ${query.database.connectionEnvName}. Use a workflow or generated gateway across database authorities.`,
      );
    }
    assertResolved(query.id, 'authorization', query.authorizationUnresolved);
    assertResolved(query.id, 'handler', query.handlerUnresolved);
    return {
      identifier: binding.identifier,
      query: query as ApplicationQueryNode & {
        readonly database: NonNullable<ApplicationQueryNode['database']>;
      },
    };
  });
}

interface StreamProcessorOperationContract {
  readonly identifier: string;
  readonly operationId: string;
  readonly runtimeOperationId?: string;
  readonly operation: NonNullable<ApplicationStreamProcessorNode['operationBindings']>[number]['operation'];
  readonly handler: ApplicationCommandHandlerNode;
  readonly command: ApplicationCommandNode;
  readonly model: ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
  };
}

function streamProcessorOperationContracts(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operationCatalog: ApplicationOperationCatalog,
): readonly StreamProcessorOperationContract[] {
  const nodes = graphNodes(graph);
  return (processor.operationBindings ?? []).map((binding) => {
    const command = requiredNode(
      nodes,
      binding.command.nodeId,
      'command',
      processor.id,
    );
    const handler = requiredNode(
      nodes,
      binding.handler.nodeId,
      'commandHandler',
      processor.id,
    );
    const model = requiredNode(nodes, handler.model.nodeId, 'model', handler.id);
    if (!model.runtime) {
      throw new Error(
        `Generated stream processor ${processor.id} operation ${binding.operationId} has no PostgreSQL model runtime.`,
      );
    }
    if (
      model.runtime.connectionEnvName
      !== processor.database.connectionEnvName
    ) {
      throw new Error(
        `Generated stream processor ${processor.id} cannot atomically call ${binding.operationId}: the source transaction uses ${processor.database.connectionEnvName}, while ${model.name} uses ${model.runtime.connectionEnvName}. Use a workflow or post-commit event handler across database authorities.`,
      );
    }
    if (!operationCatalog.operations.some(
      (operation) => operation.id === binding.operationId,
    )) {
      throw new Error(
        `Generated stream processor ${processor.id} operation ${binding.operationId} is absent from the canonical operation catalog.`,
      );
    }
    return {
      identifier: binding.identifier,
      operationId: binding.operationId,
      ...(binding.runtimeOperationId
        ? { runtimeOperationId: binding.runtimeOperationId }
        : {}),
      operation: binding.operation,
      command,
      handler,
      model: model as ApplicationModelNode & {
        readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
      },
    };
  });
}

/**
 * Resolves the least-ceremony workload identity for a function-native event
 * handler from the authority it actually calls. Application authors declare
 * the identity once through ServiceIdentity.can(...); the compiler binds it to
 * the processor only when one service identity covers every inferred effect.
 */
function inferredStreamProcessorServiceIdentity(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operationCatalog: ApplicationOperationCatalog,
): ApplicationIdentityReference | undefined {
  const requiredOperationIds = new Set<string>([
    ...(processor.operationBindings ?? []).map((binding) => binding.operationId),
    ...(processor.actorBindings ?? []).map((binding) => {
      const actor = graph.nodes.find((candidate) => candidate.id === binding.actor.nodeId);
      if (actor?.kind !== 'actor') {
        throw new Error(`Generated stream processor ${processor.id} references missing actor ${binding.actor.nodeId}.`);
      }
      return `applik8s://actors/${actor.definition.id}/operations/${binding.member}`;
    }),
    ...(processor.queryBindings ?? []).map((binding) => {
      const operation = operationCatalog.operations.find(
        (candidate) => candidate.placement.nodeId === binding.query.nodeId,
      );
      if (!operation) {
        throw new Error(
          `Generated stream processor ${processor.id} view ${binding.query.nodeId} is absent from the operation catalog.`,
        );
      }
      return operation.id;
    }),
  ]);
  if (requiredOperationIds.size === 0) return undefined;
  const manifest = applicationStaticAuthorityManifest(graph);
  if (!manifest) return undefined;
  const serviceIdentities = manifest.identities.filter(
    (identity) => identity.kind === 'service'
      && identity.subject !== 'application-authority',
  );
  const candidates = serviceIdentities.filter((identity) => {
    const granted = new Set<string>(
      manifest.grants
        .filter((grant) => grant.identity.id === identity.id)
        .flatMap((grant) => grant.operationIds),
    );
    return [...requiredOperationIds].every((operationId) => granted.has(operationId));
  });
  if (candidates.length > 1) {
    throw new Error(
      `Generated stream processor ${processor.id} has ambiguous service authority: ${candidates.map((identity) => identity.id).join(', ')} each grant every inferred operation. Narrow the service grants so one workload identity owns this handler.`,
    );
  }
  return candidates[0];
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
		if (target?.kind !== 'task' && target?.kind !== 'workflow') throw new Error(`Generated stream processor ${processor.id} workflow ${binding.alias} references missing task/workflow ${binding.target.nodeId}.`);
		if (target.contract.name !== binding.contract.name || target.contract.version !== binding.contract.version || JSON.stringify(target.contract.input) !== JSON.stringify(binding.contract.input) || JSON.stringify(target.contract.output) !== JSON.stringify(binding.contract.output)) throw new Error(`Generated stream processor ${processor.id} workflow ${binding.alias} contract drifted from ${binding.target.nodeId}.`);
	}
  const worker = objectConfig(config.workerTokenSecret);
  assertResourceNamespace(worker.namespace, namespace, `Stream processor ${processor.id} WorkflowEngine worker Secret`);
  return { provider, schedules, tasks };
}

async function bundleReactive(options: BundleReactiveOptions): Promise<GeneratedApplicationReactiveArtifact> {
  const sourcePath = join(options.artifactDir, 'runtime.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const metafilePath = join(options.artifactDir, 'runtime.esbuild-meta.json');
  const manifestPath = join(options.artifactDir, 'runtime.manifest.json');
  const result = await build({
    entryPoints: [options.entrypoint], outfile: sourcePath, bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: true, keepNames: true,
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
  const resources = [
    ...reactiveResources(options, container.image, digest),
    ...(options.extraResources?.(container.image, digest) ?? []),
  ];
  const manifestKind = options.kind === 'queryGateway'
    ? 'GeneratedQueryGateway'
    : options.kind === 'projectionWorker'
      ? 'GeneratedProjectionWorker'
      : options.kind === 'searchProjectionWorker'
        ? 'GeneratedSearchProjectionWorker'
        : options.kind === 'scheduleControlWorker'
          ? 'GeneratedScheduleControlWorker'
          : 'GeneratedStreamProcessorWorker';
  await writeFile(manifestPath, `${JSON.stringify({ apiVersion: 'applik8s.reactive/v1alpha1', kind: manifestKind, metadata: { name: options.name }, spec: { graph: options.graphName, digest, sizeBytes, distribution: 'ociImage', image: container.image, baseImage: container.baseImage, container, namespace: options.namespace, resources: resources.map((resource) => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: resource.metadata })) } }, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  const frameworkCredentials = applicationFrameworkCredentialDependencies(source);
  return { name: options.name, nodeId: options.nodeId, kind: options.kind, sourcePath, sourceMapPath, manifestPath, metafilePath, digest, sizeBytes, container, resources, frameworkCredentials };
}

function generatedGatewaySource(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  subscriptions: readonly GatewayStreamSubscriptionContract[],
  operationCatalog: ApplicationOperationCatalog,
  eventLog: ApplicationProviderNode | undefined,
  internalPlacementRoutes: readonly ApplicationInternalPlacementRoute[],
  executionTarget: 'kubernetes' | 'local' | 'aws-local' | 'aws',
): string {
  const gatewayNamespace = applicationGraphStringValue(gateway.deployment?.namespace) ?? 'default';
  const acceptsTaskQueryAdmission = graph.nodes.some(
    (node) => node.kind === 'taskHandler'
      && (node.queries ?? []).some((binding) =>
        gateway.queries.some((query) => query.nodeId === binding.query.nodeId)),
  );
  const relationalQueries = queries.filter((query) => !query.kubernetes);
  const kubernetesQueries = queries.filter((query) => Boolean(query.kubernetes));
  const searchContracts = relationalQueries
    .filter((query) => Boolean(query.search))
    .map((query) => gatewaySearchContract(graph, query));
  const onlineSources = relationalQueries.flatMap((query) => query.projection?.storage === 'online' ? [gatewayOnlineProjectionContract(graph, query)] : []);
  const analyticalSources = relationalQueries.flatMap((query) => query.projection?.storage === 'analytical' ? [gatewayAnalyticalProjectionContract(graph, query)] : []);
  const capabilityProjectionStreams = [...onlineSources, ...analyticalSources]
    .filter(({ projection }) => (projection.capabilityFields?.length ?? 0) > 0)
    .map(({ stream }) => ({ stream }));
  const signalStreams = uniqueSignalStreams([
    ...subscriptions,
    ...capabilityProjectionStreams,
  ]);
  const eventLogPublisher = commands.length === 0
    ? undefined
    : generatedApplicationEventLogPublisherSource({
        executionTarget,
        variableName: 'applicationEventLogPublisher',
        connectionName: 'applik8s-query-command-gateway',
      });
  const imports = [
    "import { createServer } from 'node:http';",
    "import postgres from 'postgres';",
    "import { drizzle } from 'drizzle-orm/postgres-js';",
    "import { normalizeSchema } from '@applik8s/sdk/schema-runtime';",
    `import { applicationAdmittedContextDigest, applicationRequestContextValues, createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationRelationalContext, createApplicationSubscriptionLimiter, withApplicationDatabaseRuntimeResolver${relationalQueries.length > 0 && kubernetesQueries.length > 0 ? ', proxyApplicationQueryMultiplex' : ''} } from '@applik8s/applik8s/query-runtime';`,
    ...(acceptsTaskQueryAdmission
      ? ["import { verifyApplicationTaskQueryAdmission } from '@applik8s/applik8s/task-query-runtime';"]
      : []),
    ...(onlineSources.length > 0 ? ["import { createValkeyOnlineProjectionReader } from '@applik8s/applik8s/projection-worker-runtime';"] : []),
    ...(analyticalSources.length > 0 ? ["import { createClickHouseAnalyticalProjectionReader } from '@applik8s/applik8s/projection-worker-runtime';"] : []),
    ...(searchContracts.length > 0
      ? [
          "import { createPostgresApplicationSearchRuntime } from '@applik8s/applik8s/search-runtime';",
          "import { createApplicationRelationalSearchSources } from '@applik8s/search';",
          "import { createOpenSearchApplicationSearchRuntime } from '@applik8s/runtime-opensearch';",
        ]
      : []),
    ...(commands.length > 0 ? ["import { createApplicationCommandGateway } from '@applik8s/applik8s/command-gateway-runtime';", eventLogPublisher!.importSource] : []),
    ...(gatewayAuthorityDatabaseEnvironment(queries, commands, subscriptions)
      ? [
          "import { gunzipSync } from 'node:zlib';",
          "import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';",
        ]
      : []),
    ...(internalPlacementRoutes.length > 0
      ? ["import { createApplicationInternalOperationHandler } from '@applik8s/operations';"]
      : []),
    ...(subscriptions.length > 0 ? ["import { createApplicationStreamSubscriptionGateway, createPostgresApplicationStream } from '@applik8s/applik8s/subscription-runtime';"] : []),
    ...(signalStreams.length > 0
      ? [
          "import { createApplicationSignalGateway } from '@applik8s/applik8s/signal-gateway';",
          "import { applicationSignalAccessAllows, applicationSignalIsActionable, createPostgresApplicationSignalStore } from '@applik8s/applik8s/signal-runtime';",
          "import { applicationOperationInputDigest } from '@applik8s/applik8s/operation-runtime';",
          "import { createApplicationAuthorizedReplayableStream } from '@applik8s/applik8s/subscription-runtime';",
        ]
      : []),
    ...(kubernetesQueries.length > 0 ? [
      "import { createApplik8sKubernetesGateway } from '@applik8s/server/kubernetes-gateway';",
      "import { createApplik8sLocalResourceClients } from '@applik8s/server/local-resource';",
    ] : []),
    "import { callback as authenticateRequest } from './authentication.generated.js';",
    ...(gateway.identityReadinessSource || gateway.identityReadinessProfile
      ? ["import { callback as verifyIdentityReadiness } from './identity-readiness.generated.js';"]
      : []),
    ...(gateway.authorizationReadinessSource ? ["import { callback as verifyAuthorizationReadiness } from './authorization-readiness.generated.js';"] : []),
    ...queries.flatMap((query) => [
      ...(!query.search ? [`import { callback as ${callbackVariable(query.id, 'authorize')} } from './${callbackName(query.id, 'authorize')}.generated.js';`] : []),
      ...(!query.kubernetes && !query.search ? [`import { callback as ${callbackVariable(query.id, 'run')} } from './${callbackName(query.id, 'run')}.generated.js';`] : []),
      ...kubernetesQueryCallbacks(query).map(([property]) => {
        const role = kubernetesCallbackRole(property);
        return `import { callback as ${callbackVariable(query.id, role)} } from './${callbackName(query.id, role)}.generated.js';`;
      }),
    ]),
    ...(commands.length > 0 ? ["import { callback as authorizeCommand } from './command-authorization.generated.js';"] : []),
    ...subscriptions.flatMap(({ subscription, stream }) => [
      `import { callback as ${callbackVariable(subscription.id, 'authorize')} } from './${callbackName(subscription.id, 'authorize')}.generated.js';`,
      ...(!stream.signal
        ? [`import { callback as ${callbackVariable(stream.id, 'streamAuthorize')} } from './${callbackName(stream.id, 'authorize-stream')}.generated.js';`]
        : []),
    ]),
  ].join('\n');
  const databases = uniqueDatabaseRuntimes([
    ...queries.map((query) => query.database).filter((database): database is ApplicationReactiveDatabaseRuntimeContract => Boolean(database)),
    ...subscriptions.map(({ stream }) => stream.database),
  ]);
  const databaseDeclarations = databases.map((database) => `const ${databaseVariable(database.name)}Binding = ${databaseBindingSource(database)};\nconst ${databaseVariable(database.name)}Sql = postgres(requiredEnv(${JSON.stringify(database.connectionEnvName)}), { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: false });\nconst ${databaseVariable(database.name)}Db = drizzle(${databaseVariable(database.name)}Sql);`).join('\n');
  const onlineSourceDeclarations = onlineSources.map((contract) => generatedGatewayOnlineProjectionSource(graph.metadata.name, contract)).join('\n');
  const analyticalSourceDeclarations = analyticalSources.map(generatedGatewayAnalyticalProjectionSource).join('\n');
  const searchSourceDeclarations = searchContracts
    .map(generatedGatewaySearchSource)
    .join('\n');
  const projectionSourceByQuery = new Map([
    ...onlineSources.map((contract) => [contract.query.id, projectionQuerySourceVariable(contract.query.id)] as const),
    ...analyticalSources.map((contract) => [contract.query.id, projectionQuerySourceVariable(contract.query.id)] as const),
    ...searchContracts.map((contract) => [
      contract.query.id,
      searchQuerySourceVariable(contract.query.id),
    ] as const),
  ]);
  const queryDeclarations = relationalQueries.map((query) =>
    query.search
      ? generatedSearchQueryBinding(
          query,
          graphReadNames(graph, query),
          projectionSourceByQuery.get(query.id),
          gatewaySearchContract(graph, query),
        )
      : generatedQueryBinding(
          query,
          graphReadNames(graph, query),
          projectionSourceByQuery.get(query.id),
        )).join(',\n');
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
  const signalGateway = generatedSignalGateway(
    graph,
    gateway,
    signalStreams,
    operationCatalog,
    Boolean(authorityDatabaseEnvironment),
  );
  const internalOperationHandler = generatedGatewayInternalOperationHandler(
    graph,
    gateway,
    queries,
    commands,
    operationCatalog,
    internalPlacementRoutes,
    Boolean(authorityDatabaseEnvironment),
  );
  const providerReadinessChecks = [
    ...(authorityDatabaseEnvironment
      ? ["readinessCheck('operation-authority', () => prepareOperationAuthority())"]
      : []),
    ...databases.map(
      (database) =>
        `readinessCheck(${JSON.stringify(`database:${database.name}`)}, () => ${databaseVariable(database.name)}Sql.unsafe('SELECT 1 AS applik8s_ready'))`,
    ),
    ...(signalStreams.length > 0
      ? ["readinessCheck('signal-store', () => signalStore.read('__applik8s_readiness__'))"]
      : []),
    "readinessCheck('command-gateway', () => commandGateway?.ready())",
    "readinessCheck('kubernetes-gateway', () => kubernetesGateway?.ready())",
    gateway.identityReadinessSource || gateway.identityReadinessProfile
      ? "readinessCheck('identity', () => verifyIdentityReadiness())"
      : "readinessCheck('identity', () => undefined)",
    gateway.authorizationReadinessSource
      ? "readinessCheck('authorization', () => verifyAuthorizationReadiness())"
      : "readinessCheck('authorization', () => undefined)",
  ];
  const searchReadinessChecks = searchContracts.map(
    (contract) =>
      `readinessCheck(${JSON.stringify(`search:${contract.query.id}`)}, () => ${searchRuntimeVariable(contract.query.id)}.refresh())`,
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
function requiredIntegerEnv(name, minimum, maximum) { const value = Number(requiredEnv(name)); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(name + ' must be ' + minimum + '..' + maximum); return value; }
function schema(json, name) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name); const validate = (value) => { const result = normalized.validate(value); return result.ok ? result.value : { summary: result.error.message }; }; validate.toJsonSchema = () => json; return validate; }
function strictSchema(json, name) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name); return (value) => { const result = normalized.validate(value); if (!result.ok) throw new Error(name + ' validation failed.'); return result.value; }; }
const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');
const contextSecret = requiredEnv('APPLIK8S_CONTEXT_SECRET');
${eventLogPublisher?.declarationSource ?? ''}
${databaseDeclarations}
${onlineSourceDeclarations}
${analyticalSourceDeclarations}
${searchSourceDeclarations}
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
    ...(admission.principal.roles ? { roles: admission.principal.roles } : {}),
    ...(admission.principal.attributes ? { attributes: admission.principal.attributes } : {}),
  }, trustedContextDigest);
}` : ''}
const queries = [${queryDeclarations}];
const subscriptionLimiter = createApplicationSubscriptionLimiter(${JSON.stringify(gateway.subscriptionLimits)});
async function admitRequest(request) { const admitted = await authenticateRequest(request); if (!admitted || typeof admitted !== 'object') throw new Error('Gateway authentication failed.'); return admitted; }
async function admitQuery(request, query, input) { ${acceptsTaskQueryAdmission
  ? `const internal = await verifyApplicationTaskQueryAdmission({ request, cursorSecret, audience: ${JSON.stringify(gateway.id)}, query: query.id, input }); return internal ?? admitRequest(request);`
  : 'return admitRequest(request);'} }
const gateway = queries.length > 0 ? createApplicationQueryGateway({
  queries,
  cursorSecret,
  subscriptionLimits: ${JSON.stringify(gateway.subscriptionLimits)},
  subscriptionLimiter,
  authenticate: async (request, query, input) => {
    const admitted = await admitQuery(request, query, input);
    const trustedContext = admitted.trustedContext ?? {};
    const trustedContextDigest = applicationAdmittedContextDigest({ values: trustedContext, digestSecret: contextSecret });
    const principal = ${authorityDatabaseEnvironment ? 'await admitGatewayPrincipal(admitted, trustedContextDigest)' : 'admitted.principal'};
    return {
      principal,
      admittedContext: {
        values: applicationRequestContextValues(principal, principal.authorityRevision, trustedContext),
        digestSecret: contextSecret,
      },
    };
  },
  ${authorityDatabaseEnvironment ? generatedQueryAuthority(graph, gateway, relationalQueries, operationCatalog) : ''}
  ${signalStreams.length > 0 ? `authorizeOutputCapability: async ({ identity, capability }) => {
    const signal = await signalStore.read(capability.issuance.id);
    if (
      !signal
      || signal.contract.id !== capability.contract.id
      || signal.contract.name !== capability.contract.name
      || signal.contract.version !== capability.contract.version
    ) return false;
    return Boolean(await authorizeSignalOperation({
      principal: identity.principal,
      contextDigest: applicationAdmittedContextDigest(identity.admittedContext),
    }, signal, undefined, { signalId: signal.id }));
  },` : ''}
  context: (identity) => createApplicationRelationalContext({ databases: [${databases.map((database) => `{ binding: ${databaseVariable(database.name)}Binding, db: ${databaseVariable(database.name)}Db }`).join(', ')}], admittedContext: identity.admittedContext }),
}) : undefined;
${kubernetesQueries.length > 0 ? `const localResourceClients = process.env.APPLIK8S_LOCAL_RESOURCE_URL && process.env.APPLIK8S_LOCAL_RESOURCE_TOKEN
  ? createApplik8sLocalResourceClients({
      baseUrl: process.env.APPLIK8S_LOCAL_RESOURCE_URL,
      token: process.env.APPLIK8S_LOCAL_RESOURCE_TOKEN,
    })
  : undefined;` : `const localResourceClients = undefined;`}
const kubernetesGateway = ${kubernetesQueries.length > 0 ? `createApplik8sKubernetesGateway({
  ...(localResourceClients ?? {}),
  authenticate: async (request, operation) => operation?.kind === 'query' ? admitQuery(request, operation, operation.input) : admitRequest(request),
  cursorSecret,
  queries: [${kubernetesQueryDeclarations}],
  subscriptionLimits: ${JSON.stringify(gateway.subscriptionLimits)},
  onError: (error, operation) => console.error('Applik8s Kubernetes query request failed', {
    ...operation,
    error,
  }),
})` : 'undefined'};
${commandGateway}
${signalGateway}
${streamGateway}
${internalOperationHandler}
const handle = gateway ? createApplicationQueryGatewayHttpHandler(gateway, {
  basePath: ${JSON.stringify(gateway.routes.snapshots.split('/:query/')[0]?.replace(/^\//, '') || 'queries')},
  onError: (error, context) => console.error('Applik8s query request failed', {
    ...context,
    error: error instanceof Error ? error.message : String(error),
  }),
}) : undefined;
${mixedQueryMultiplex}
let ready = false; let stopping = false; let lastDependencyError; let degradedDependencyError;
const dependencyMonitor = new AbortController();
const server = createServer(async (incoming, outgoing) => { const requestController = new AbortController(); const abortRequest = () => requestController.abort(); incoming.once('aborted', abortRequest); outgoing.once('close', abortRequest); try { if (incoming.url === '/live' || incoming.url === '/ready') { const ok = incoming.url === '/live' || (ready && !stopping); outgoing.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ ready, stopping, lastDependencyError, degradedDependencyError })); return; } const request = await webRequest(incoming, requestController.signal); const internalResponse = internalOperationHandler ? await internalOperationHandler(request.clone()) : undefined; const multiplexResponse = internalResponse || await handleMixedQueryMultiplex(request.clone()); const commandResponse = multiplexResponse || !commandGateway ? undefined : await commandGateway.handle(request.clone()); const signalResponse = multiplexResponse || commandResponse || !signalGateway ? undefined : await signalGateway.handle(request.clone()); const streamResponse = multiplexResponse || commandResponse || signalResponse || !streamGateway ? undefined : await streamGateway.handle(request.clone()); const kubernetesResponse = multiplexResponse || commandResponse || signalResponse || streamResponse || !kubernetesGateway ? undefined : await kubernetesGateway.handle(prefixKubernetesRequest(request.clone())); const relationalResponse = multiplexResponse || commandResponse || signalResponse || streamResponse || (kubernetesResponse && kubernetesResponse.status !== 404) || !handle ? undefined : await handle(request); await writeResponse(outgoing, internalResponse ?? multiplexResponse ?? commandResponse ?? signalResponse ?? streamResponse ?? (kubernetesResponse?.status !== 404 ? kubernetesResponse : undefined) ?? relationalResponse ?? new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })); } catch (error) { if (!requestController.signal.aborted) { console.error(error); if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'internal_error' })); } } finally { incoming.removeListener('aborted', abortRequest); outgoing.removeListener('close', abortRequest); } });
server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? '${gateway.deployment?.port ?? 8080}'), '0.0.0.0');
async function monitorDependencies() { while (!stopping) { try { await Promise.all([${providerReadinessChecks.join(', ')}]); const degraded = (await Promise.all([${[...onlineSources, ...analyticalSources].map((contract) => `recoverableProjectionReadiness(() => ${projectionQuerySourceVariable(contract.query.id)}.revision())`).join(', ')}])).filter(Boolean); await Promise.all([${searchReadinessChecks.join(', ')}]); ready = true; lastDependencyError = undefined; degradedDependencyError = degraded[0]; } catch (error) { ready = false; lastDependencyError = providerReadinessError(error); degradedDependencyError = undefined; if (!stopping) console.error(lastDependencyError); } await abortableSleep(5000, dependencyMonitor.signal); } }
const dependencyMonitorTask = monitorDependencies();
async function readinessCheck(boundary, check) { try { return await check(); } catch (error) { throw new Error('Provider ' + boundary + ' not ready.', { cause: error }); } }
function providerReadinessError(error) { if (!(error instanceof Error)) return 'Provider readiness failed.'; const cause = error.cause; return cause === undefined || cause === error ? error.message : error.message + ' ' + providerReadinessError(cause); }
async function recoverableProjectionReadiness(check) { try { await check(); } catch (error) { if (!isRecoverableProjectionReadinessError(error)) throw error; return error instanceof Error ? error.message : String(error); } }
function isRecoverableProjectionReadinessError(error) { if (!error || typeof error !== 'object') return false; const code = Reflect.get(error, 'code'); return code === 'APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE' || code === 'APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED'; }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
async function webRequest(request, signal) { const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await new Promise((resolve, reject) => { const chunks = []; request.on('data', (chunk) => chunks.push(chunk)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); return new Request('http://' + (request.headers.host ?? 'localhost') + (request.url ?? '/'), { method: request.method, headers: Object.entries(request.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : value === undefined ? [] : [[key, value]]), signal, ...(body ? { body, duplex: 'half' } : {}) }); }
function prefixKubernetesRequest(request) { const url = new URL(request.url); url.pathname = '/__applik8s/v1' + (url.pathname.startsWith('/') ? url.pathname : '/' + url.pathname); return new Request(url, request); }
async function writeResponse(response, web) { response.writeHead(web.status, Object.fromEntries(web.headers)); if (!web.body) { response.end(); return; } const reader = web.body.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once('drain', resolve)); } response.end(); }
async function shutdown() { if (stopping) return; stopping = true; ready = false; dependencyMonitor.abort(); await new Promise((resolve) => server.close(resolve)); await dependencyMonitorTask; ${signalStreams.length > 0 ? 'await signalStore.close();' : ''} await Promise.all([${searchContracts.flatMap((contract) => [`${searchRuntimeVariable(contract.query.id)}.close()`, `${searchSourcesVariable(contract.query.id)}.close()`]).join(', ')}${searchContracts.length > 0 && databases.length > 0 ? ', ' : ''}${databases.map((database) => `${databaseVariable(database.name)}Sql.end({ timeout: 5 })`).join(', ')}${operationAuthority ? ', operationAuthoritySql.end({ timeout: 5 })' : ''}, ...(commandGateway ? [commandGateway.close()] : []), ...(kubernetesGateway ? [kubernetesGateway.close()] : [])]); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
`;
}

function generatedSearchProjectionSource(
  contract: GatewaySearchContract,
): string {
  const database = contract.query.database;
  if (!database) {
    throw new Error(
      `Generated search projection ${contract.index.id} has no committed-change database.`,
    );
  }
  return `import { createServer } from 'node:http';
import postgres from 'postgres';
import { ApplicationSearchHistoryLossError, createPostgresApplicationSearchRuntime } from '@applik8s/applik8s/search-runtime';
import { createApplicationRelationalSearchSources } from '@applik8s/search';
import { createOpenSearchApplicationSearchRuntime } from '@applik8s/runtime-opensearch';

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');
const ${databaseVariable(database.name)}Sql = postgres(requiredEnv(${JSON.stringify(database.connectionEnvName)}), { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: false });
${generatedGatewaySearchSource(contract)}
let ready = false;
let stopping = false;
let lastError;
let checkpoint = 0;
let processed = 0;
let generation = ${searchRuntimeVariable(contract.query.id)}.state().activeGeneration;
const loopController = new AbortController();
const server = createServer((request, response) => {
  const live = request.url === '/live';
  const health = live || request.url === '/ready';
  if (!health) { response.writeHead(404); response.end(); return; }
  const ok = live || (ready && !stopping);
  response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ready, stopping, checkpoint, processed, generation, lastError }));
});
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function synchronize() {
  while (!stopping) {
    try {
      const result = await ${searchRuntimeVariable(contract.query.id)}.synchronize({ batchSize: 250, maximumBatches: 100 });
      const state = await ${searchRuntimeVariable(contract.query.id)}.refresh();
      checkpoint = state.checkpoint;
      generation = state.activeGeneration;
      processed += result.applied;
      ready = state.state === 'current' && result.exhausted;
      lastError = undefined;
      await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal);
    } catch (error) {
      if (error instanceof ApplicationSearchHistoryLossError) {
        try {
          const replacement = 'rebuild-' + Date.now().toString(36);
          const rebuilt = await ${searchRuntimeVariable(contract.query.id)}.rebuild({ generation: replacement, batchSize: 500, maximumSnapshotPages: 10000, maximumCatchupBatches: 10000 });
          checkpoint = rebuilt.publishedCheckpoint;
          generation = rebuilt.generation;
          lastError = undefined;
          ready = true;
          continue;
        } catch (rebuildError) {
          error = rebuildError;
        }
      }
      lastError = error instanceof Error ? error.message : String(error);
      ready = false;
      if (!stopping) console.error(error);
      await abortableSleep(5000, loopController.signal);
    }
  }
}
function abortableSleep(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    const abort = () => done();
    function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); }
    signal.addEventListener('abort', abort, { once: true });
  });
}
const loopTask = synchronize();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  loopController.abort();
  await new Promise((resolve) => server.close(resolve));
  await loopTask;
  await Promise.all([
    ${searchRuntimeVariable(contract.query.id)}.close(),
    ${searchSourcesVariable(contract.query.id)}.close(),
    ${databaseVariable(database.name)}Sql.end({ timeout: 5 }),
  ]);
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

function generatedQueryBinding(query: ApplicationQueryNode, modelNames: readonly string[], projectionSource?: string): string {
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const database = query.database;
  if (!database) throw new Error(`Generated query ${query.id} has no database runtime.`);
  const contexts = query.trustedContext.map((name) => {
    const contextSchema = query.trustedContextSchemas?.[name]
      ?? (database.access?.context === name ? database.access.contextSchema : undefined);
    if (!contextSchema) throw new Error(`Generated query ${query.id} trusted context ${name} has no serializable admission schema.`);
    return `{ kind: 'applicationTrustedContext', name: ${JSON.stringify(name)}, schema: schema(${JSON.stringify(contextSchema)}, ${JSON.stringify(name)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(contextSchema)} } }`;
  });
  const callbackInvocation = query.handlerInvocation === 'input-context'
    ? `${callbackVariable(query.id, 'run')}(input, Object.assign(context, { principal${projectionSource ? ', source' : ''} }))`
    : `${callbackVariable(query.id, 'run')}({ context, principal, input, database: ${databaseVariable(database.name)}Binding${projectionSource ? ', source' : ''} })`;
  const invocation = `withApplicationDatabaseRuntimeResolver((binding) => context.database(binding), () => ${callbackInvocation})`;
  return `{ kind: 'applicationQuery', id: ${JSON.stringify(id)}, name: ${JSON.stringify(query.name)}, version: ${JSON.stringify(query.version)}, input: schema(${JSON.stringify(query.input.jsonSchema)}, ${JSON.stringify(`${id}.input`)}), output: schema(${JSON.stringify(query.output.jsonSchema)}, ${JSON.stringify(`${id}.output`)}), database: ${databaseVariable(database.name)}Binding, ${projectionSource ? `sourceRuntime: ${projectionSource},` : ''} trustedContext: [${contexts.join(', ')}], reads: ${JSON.stringify(modelNames.map((name) => ({ $model: { name } })))}, budgets: ${JSON.stringify(query.budgets)}, authorize: async (principal, input, context = {}) => ${callbackVariable(query.id, 'authorize')}({ principal, context, input }), run: async (context, principal, input, source) => ${invocation} }`;
}

function gatewaySearchContract(
  graph: ApplicationGraph,
  query: ApplicationQueryNode,
): GatewaySearchContract {
  if (!query.search) {
    throw new Error(`Generated query ${query.id} has no Search authority.`);
  }
  const nodes = graphNodes(graph);
  const index = requiredNode(
    nodes,
    query.search.index.nodeId,
    'index',
    query.id,
  );
  if (index.purpose !== 'searchProjection' || !index.search) {
    throw new Error(
      `Generated query ${query.id} references index ${index.id} without a search projection plan.`,
    );
  }
  const provider = requiredProvider(
    nodes,
    query.search.provider.nodeId,
    query.id,
  );
  if (provider.interface !== 'Search') {
    throw new Error(
      `Generated query ${query.id} references non-Search provider ${provider.id}.`,
    );
  }
  const providerConfig = objectConfig(provider.config?.search);
  if (Object.keys(providerConfig).length === 0) {
    throw new Error(
      `Generated query ${query.id} Search provider ${provider.id} has no portable runtime configuration.`,
    );
  }
  const sourceNames = new Set(index.search.sourceFrontiers.map(({ model }) => model));
  const models = [...nodes.values()].filter(
    (node): node is ApplicationModelNode & {
      readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
      readonly common: NonNullable<ApplicationModelNode['common']>;
    } =>
      node.kind === 'model'
      && sourceNames.has(node.name)
      && Boolean(node.runtime)
      && Boolean(node.common),
  );
  if (models.length !== sourceNames.size) {
    const present = new Set(models.map(({ name }) => name));
    const missing = [...sourceNames].filter((name) => !present.has(name));
    throw new Error(
      `Generated query ${query.id} is missing relational search source model(s): ${missing.join(', ')}.`,
    );
  }
  for (const model of models) {
    if (
      model.runtime.provider !== 'postgres'
      || model.runtime.storageShape !== 'native-relational'
      || !model.runtime.nativeRelational
    ) {
      throw new Error(
        `Generated query ${query.id} search source ${model.name} must use native relational PostgreSQL storage.`,
      );
    }
    if (
      query.database
      && model.runtime.connectionEnvName !== query.database.connectionEnvName
    ) {
      throw new Error(
        `Generated query ${query.id} search sources must share its committed-change PostgreSQL authority.`,
      );
    }
  }
  return {
    query,
    index: {
      ...index,
      search: index.search,
    },
    provider,
    providerConfig,
    models: models.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function generatedGatewaySearchSource(
  contract: GatewaySearchContract,
): string {
  const database = contract.query.database;
  if (!database) {
    throw new Error(
      `Generated search query ${contract.query.id} has no committed-change database.`,
    );
  }
  const plan = contract.index.search;
  const fields = Object.fromEntries(
    plan.fields.map((field) => [
      field.alias,
      {
        kind: field.kind,
        valueType: field.valueType,
        nullable: field.nullable,
        ...(field.boost === undefined ? {} : { boost: field.boost }),
      },
    ]),
  );
  const models = contract.models.map((model) => ({
    nodeId: model.id,
    name: model.name,
    tableName: model.runtime.tableName,
    ...(model.runtime.nativeRelational?.schema
      ? { schema: model.runtime.nativeRelational.schema }
      : {}),
    identity: model.runtime.nativeRelational!.identity,
    columns: model.runtime.nativeRelational!.columns,
    relationships: model.common.relationships,
  }));
  const digest = createHash('sha256')
    .update(contract.query.id)
    .digest('hex')
    .slice(0, 12);
  const providerVariable = `search_provider_${digest}`;
  const configurationVariable = `search_provider_configuration_${digest}`;
  const credentialsUser = `APPLIK8S_SEARCH_USERNAME_${digest.toUpperCase()}`;
  const credentialsPassword = `APPLIK8S_SEARCH_PASSWORD_${digest.toUpperCase()}`;
  return `
const ${configurationVariable} = ${JSON.stringify(contract.providerConfig)};
const ${providerVariable} = (() => {
  const configured = ${configurationVariable};
  if (configured.kind !== 'application-provider-selection') return configured;
  const variant = requiredEnv('APPLIK8S_PROFILE_VARIANT');
  return configured.cases?.[variant] ?? configured.default;
})();
const ${searchSourcesVariable(contract.query.id)} = createApplicationRelationalSearchSources({
  sql: ${databaseVariable(database.name)}Sql,
  plan: ${JSON.stringify(plan)},
  models: ${JSON.stringify(models)},
});
const ${searchRuntimeVariable(contract.query.id)} = ${providerVariable}.kind === 'postgres-search'
  ? await createPostgresApplicationSearchRuntime({
      logicalIndex: ${JSON.stringify(plan.logicalIdentity.name)},
      indexRevision: ${JSON.stringify(plan.revision.digest)},
      sql: ${databaseVariable(database.name)}Sql,
      schema: ${providerVariable}.schema,
      cursorSecret,
      fields: ${JSON.stringify(fields)},
      hydration: ${searchSourcesVariable(contract.query.id)}.hydration,
      changes: ${searchSourcesVariable(contract.query.id)}.changes,
      snapshot: ${searchSourcesVariable(contract.query.id)}.snapshot,
      fanOutCeiling: ${Math.max(...plan.inverseInvalidation.map(({ fanOutCeiling }) => fanOutCeiling), 1)},
      maximumCandidateRows: ${providerVariable}.maximumCandidateRows,
    })
  : ${providerVariable}.kind === 'opensearch'
    ? await createOpenSearchApplicationSearchRuntime({
        logicalIndex: ${JSON.stringify(plan.logicalIdentity.name)},
        indexRevision: ${JSON.stringify(plan.revision.digest)},
        endpoint: ${providerVariable}.endpoint ?? ('https://' + (${providerVariable}.name ?? ${JSON.stringify(`${plan.logicalIdentity.name}-search`)}) + '.' + (${providerVariable}.namespace ?? ${JSON.stringify(applicationGraphStringValue(database.secretNamespace) ?? 'default')}) + '.svc:9200'),
        ...(process.env[${JSON.stringify(credentialsPassword)}]
          ? { authentication: { username: process.env[${JSON.stringify(credentialsUser)}] ?? 'admin', password: process.env[${JSON.stringify(credentialsPassword)}] } }
          : {}),
        cursorSecret,
        fields: ${JSON.stringify(fields)},
        hydration: ${searchSourcesVariable(contract.query.id)}.hydration,
        changes: ${searchSourcesVariable(contract.query.id)}.changes,
        snapshot: ${searchSourcesVariable(contract.query.id)}.snapshot,
        fanOutCeiling: ${Math.max(...plan.inverseInvalidation.map(({ fanOutCeiling }) => fanOutCeiling), 1)},
      })
    : Promise.reject(new Error('Unsupported Search provider ' + String(${providerVariable}.kind)));
const ${searchQuerySourceVariable(contract.query.id)} = {
  async revision() {
    const state = await ${searchRuntimeVariable(contract.query.id)}.refresh();
    return state.indexRevision + ':' + state.activeGeneration + ':' + state.checkpoint;
  },
  async snapshot(operation) {
    const state = await ${searchRuntimeVariable(contract.query.id)}.refresh();
    const revision = state.indexRevision + ':' + state.activeGeneration + ':' + state.checkpoint;
    return {
      value: await operation({
        execute: (input, admission) => ${searchRuntimeVariable(contract.query.id)}.search(input, admission),
      }),
      revision,
    };
  },
};`;
}

function generatedSearchQueryBinding(
  query: ApplicationQueryNode,
  modelNames: readonly string[],
  sourceRuntime: string | undefined,
  contract: GatewaySearchContract,
): string {
  const database = query.database;
  if (!database || !sourceRuntime) {
    throw new Error(
      `Generated search query ${query.id} is missing its database or Search runtime.`,
    );
  }
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const contexts = query.trustedContext.map((name) => {
    const contextSchema = query.trustedContextSchemas?.[name]
      ?? (database.access?.context === name ? database.access.contextSchema : undefined);
    if (!contextSchema) throw new Error(`Generated search query ${query.id} trusted context ${name} has no serializable admission schema.`);
    return `{ kind: 'applicationTrustedContext', name: ${JSON.stringify(name)}, schema: schema(${JSON.stringify(contextSchema)}, ${JSON.stringify(name)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(contextSchema)} } }`;
  });
  const authorizationWhere = searchAuthorizationWhere(contract, database);
  return `{ kind: 'applicationQuery', id: ${JSON.stringify(id)}, name: ${JSON.stringify(query.name)}, version: ${JSON.stringify(query.version)}, input: schema(${JSON.stringify(query.input.jsonSchema)}, ${JSON.stringify(`${id}.input`)}), output: schema(${JSON.stringify(query.output.jsonSchema)}, ${JSON.stringify(`${id}.output`)}), database: ${databaseVariable(database.name)}Binding, sourceRuntime: ${sourceRuntime}, trustedContext: [${contexts.join(', ')}], reads: ${JSON.stringify(modelNames.map((name) => ({ $model: { name } })))}, budgets: ${JSON.stringify(query.budgets)}, authorize: async () => true, run: async (context, principal, input, source) => source.execute(input, { principalId: principal.id, contextDigest: applicationAdmittedContextDigest(context.admittedContext), authorizationVersion: principal.authorityRevision, where: ${authorizationWhere} }) }`;
}

function searchAuthorizationWhere(
  contract: GatewaySearchContract,
  database: ApplicationReactiveDatabaseRuntimeContract,
): string {
  const fields = contract.index.search.fields.filter(
    ({ authorizationRelevant }) => authorizationRelevant,
  );
  if (fields.length === 0) return '{}';
  const root = contract.models.find(
    ({ id }) => id === contract.index.search.root.model.nodeId,
  );
  if (!root) {
    throw new Error(
      `Generated search query ${contract.query.id} references a missing root model ${contract.index.search.root.model.nodeId}.`,
    );
  }
  const access = root.common.access ?? (database.access
    ? {
        context: database.access.context,
        providerField: database.access.column,
      }
    : root.runtime?.nativeRelational?.access
      ? {
          context: root.runtime.nativeRelational.access.context,
          providerField: root.runtime.nativeRelational.access.property,
        }
      : undefined);
  if (!access) {
    throw new Error(
      `Generated search query ${contract.query.id} marks authorization fields but its root model has no trusted access context.`,
    );
  }
  const field = fields.find(({ path }) => {
    const terminal = path.at(-1);
    return terminal?.model === root.name && terminal.field === access.providerField;
  });
  if (!field) {
    throw new Error(
      `Generated search query ${contract.query.id} must index root access field ${access.providerField} as an authorization-relevant filter.`,
    );
  }
  return `{ ${JSON.stringify(field.alias)}: context.admittedContext.values[${JSON.stringify(access.context)}] }`;
}

function generatedKubernetesQueryBinding(query: ApplicationQueryNode, graph: ApplicationGraph, gatewayNamespace: string): string {
  const authority = query.kubernetes;
  if (!authority) throw new Error(`Generated query ${query.id} lost its Kubernetes authority.`);
  const model = requiredNode(graphNodes(graph), authority.model.nodeId, 'crd', query.id);
  const id = query.publicId ?? `${query.name}.${query.version}`;
  const callback = (property: string) => callbackVariable(query.id, kubernetesCallbackRole(property));
  const modelNative = authority.invocation === 'model-native';
  const requestCallback = (property: string) => `${callback(property)}(request)`;
  const inputCallback = (property: string) => modelNative
    ? `${callback(property)}(request.input, { input: request.input, context: request.context })`
    : requestCallback(property);
  const valueCallback = (property: string) => modelNative
    ? `${callback(property)}(request.value, { input: request.input, context: request.context })`
    : requestCallback(property);
  const compareCallback = modelNative
    ? `${callback('compare')}(request.left, request.right, { input: request.input, context: request.context })`
    : requestCallback('compare');
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
    ${authority.namespaceResolver ? `namespace: (request) => ${inputCallback('namespaceResolver')},` : ''}
    ${authority.labelSelector ? `labelSelector: (request) => ${inputCallback('labelSelector')},` : ''}
    ${authority.fieldSelector ? `fieldSelector: (request) => ${inputCallback('fieldSelector')},` : ''}
    ${authority.filter ? `filter: (request) => ${valueCallback('filter')},` : ''}
    ${authority.compare ? `compare: (request) => ${compareCallback},` : ''}
    project: (request) => ${valueCallback('project')},
    ${authority.limit ? `limit: (request) => ${inputCallback('limit')},` : ''}
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
  const config = objectConfig(provider.config?.indexStore);
  if (
    provider.interface !== 'IndexStore'
    || stringConfig(config.kind) !== 'valkey'
  ) {
    throw new Error(
      `Generated query ${query.id} online authority requires a Valkey-compatible IndexStore provider; observed ${provider.interface}/${provider.implementation}.`,
    );
  }
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
  return {
    query,
    projection,
    stream,
    provider,
    config: clickHouseAnalyticalProviderConfig(
      provider,
      applicationGraphStringValue(stream.database.secretNamespace)
        || applicationGraphStringValue(graph.metadata.namespace)
        || 'default',
      `Generated query ${query.id}`,
    ),
  };
}

function clickHouseAnalyticalProviderConfig(
  provider: ApplicationProviderNode,
  defaultNamespace: string,
  subject: string,
): Readonly<Record<string, unknown>> {
  if (provider.interface !== 'AnalyticalDatabase') {
    throw new Error(
      `${subject} analytical authority requires an AnalyticalDatabase provider.`,
    );
  }
  const configured = objectConfig(
    provider.config?.analyticalDatabase ?? provider.config,
  );
  if (configured.kind !== 'application-provider-selection') {
    if (
      provider.implementation !== 'clickhouse'
      && configured.kind !== 'clickhouse'
    ) {
      throw new Error(
        `${subject} analytical authority requires a ClickHouse-compatible AnalyticalDatabase provider.`,
      );
    }
    return configured;
  }
  const selector = stringConfig(configured.selector);
  const cases = objectConfig(configured.cases);
  const fallback = objectConfig(configured.default);
  if (
    !/^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u.test(selector)
    || Object.keys(fallback).length === 0
  ) {
    throw new Error(
      `${subject} AnalyticalDatabase selection must use one direct schema.spec discriminator and declare a default provider.`,
    );
  }
  const branches = Object.fromEntries(
    Object.entries(cases).map(([name, candidate]) => [
      name,
      normalizeSelectedClickHouseCandidate(
        objectConfig(candidate),
        defaultNamespace,
        `${subject} AnalyticalDatabase branch ${name}`,
      ),
    ]),
  );
  const normalizedFallback = normalizeSelectedClickHouseCandidate(
    fallback,
    defaultNamespace,
    `${subject} AnalyticalDatabase default`,
  );
  const selection = { selector, cases: branches, default: normalizedFallback };
  const credentials = [
    ...Object.values(branches),
    normalizedFallback,
  ].map((candidate) => objectConfig(candidate.credentialsSecret));
  const hasCredentials = credentials.some(
    (reference) => typeof reference.name === 'string' && reference.name.length > 0,
  );
  return {
    kind: 'clickhouse',
    enabled: selectedAnalyticalScalar(selection, (candidate) => candidate.enabled, true),
    name: selectedAnalyticalScalar(selection, (candidate) => candidate.name, 'applik8s-analytics'),
    namespace: selectedAnalyticalScalar(selection, (candidate) => candidate.namespace, defaultNamespace),
    provision: selectedAnalyticalScalar(selection, (candidate) => candidate.provision, true),
    endpoint: selectedAnalyticalScalar(selection, (candidate) => candidate.endpoint, ''),
    database: selectedAnalyticalScalar(selection, (candidate) => candidate.database, 'default'),
    ...(hasCredentials
      ? {
          credentialsSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: selectedAnalyticalScalar(
              selection,
              (candidate) => objectConfig(candidate.credentialsSecret).name,
              'applik8s-analytical-credentials-unused',
            ),
            namespace: selectedAnalyticalScalar(
              selection,
              (candidate) =>
                objectConfig(candidate.credentialsSecret).namespace
                ?? candidate.namespace,
              defaultNamespace,
            ),
            optional: credentials.some(
              (reference) =>
                typeof reference.name !== 'string' || reference.name.length === 0,
            ),
          },
          usernameKey: selectedAnalyticalScalar(
            selection,
            (candidate) => candidate.usernameKey,
            'username',
          ),
          passwordKey: selectedAnalyticalScalar(
            selection,
            (candidate) => candidate.passwordKey,
            'password',
          ),
        }
      : {}),
  };
}

function normalizeSelectedClickHouseCandidate(
  candidate: Readonly<Record<string, unknown>>,
  defaultNamespace: string,
  subject: string,
): Readonly<Record<string, unknown>> {
  const targetCandidate = candidate.kind === 'application-target-provider-selection'
    ? objectConfig(objectConfig(candidate.targets).kubernetes)
    : candidate;
  if (targetCandidate.kind !== 'clickhouse') {
    throw new Error(`${subject} must be a ClickHouse provider.`);
  }
  const name = targetCandidate.name ?? 'applik8s-analytics';
  const namespace = targetCandidate.namespace ?? defaultNamespace;
  return {
    ...targetCandidate,
    enabled: targetCandidate.enabled ?? true,
    name,
    namespace,
    provision: targetCandidate.provision ?? true,
    endpoint:
      targetCandidate.endpoint
      ?? `http://clickhouse-${String(name)}.${String(namespace)}.svc.cluster.local:8123`,
    database: targetCandidate.database ?? 'default',
  };
}

function selectedAnalyticalScalar(
  selection: {
    readonly selector: string;
    readonly cases: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly default: Readonly<Record<string, unknown>>;
  },
  select: (candidate: Readonly<Record<string, unknown>>) => unknown,
  fallback: string | number | boolean,
): string | number | boolean {
  const branches = Object.entries(selection.cases).map(
    ([name, candidate]) => [name, select(candidate) ?? fallback] as const,
  );
  const otherwise = select(selection.default) ?? fallback;
  const serialized = [...branches.map(([, value]) => value), otherwise].map(
    analyticalScalarExpression,
  );
  if (serialized.every((value) => value === serialized[0])) {
    return otherwise as string | number | boolean;
  }
  const expression = branches.reduceRight(
    (current, [name, value]) =>
      `${selection.selector} == ${JSON.stringify(name)} ? ${analyticalScalarExpression(value)} : (${current})`,
    analyticalScalarExpression(otherwise),
  );
  return `\${${expression}}`;
}

function analyticalScalarExpression(value: unknown): string {
  if (typeof value === 'string') {
    return /^\$\{(.+)\}$/u.exec(value)?.[1] ?? JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error(
    'Profile-selected AnalyticalDatabase runtime fields must be scalar installation values.',
  );
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
  releaseOperation: ({ receipt, commandId }) =>
    operationAuthority.releaseEnvelope(receipt, commandId),
  cursorSecret,
  contextSecret,
  eventLogPublisher: applicationEventLogPublisher,
});`;
}

function generatedGatewayInternalOperationHandler(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  queries: readonly ApplicationQueryNode[],
  commands: readonly GatewayCommandContract[],
  operationCatalog: ApplicationOperationCatalog,
  routes: readonly ApplicationInternalPlacementRoute[],
  hasOperationAuthority: boolean,
): string {
  if (routes.length === 0) {
    return 'const internalOperationHandler = undefined;';
  }
  if (!hasOperationAuthority) {
    throw new Error(
      `Generated gateway ${gateway.id} cannot receive internal operations without canonical operation authority.`,
    );
  }
  const byOperation = new Map<
    string,
    {
      readonly operation: ApplicationOperationCatalog['operations'][number];
      readonly audiences: Set<string>;
      readonly invoke: string;
    }
  >();
  for (const route of routes) {
    const operation = operationCatalog.operations.find(
      (candidate) => candidate.id === route.operationId,
    );
    if (!operation) {
      throw new Error(
        `Generated gateway ${gateway.id} internal route references unavailable operation ${route.operationId}.`,
      );
    }
    const existing = byOperation.get(operation.id);
    if (existing) {
      existing.audiences.add(route.audience);
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
        `Generated gateway ${gateway.id} has no existing runtime binding for internal operation ${operation.id}.`,
      );
    }
    const invoke = command
      ? `commandGateway.invoke({ operationId: ${JSON.stringify(operation.id)}, input, invocation, ...(signal ? { signal } : {}) })`
      : `gateway.invoke({ query: ${JSON.stringify(query!.publicId ?? `${query!.name}.${query!.version}`)}, input, invocation })`;
    byOperation.set(operation.id, {
      operation,
      audiences: new Set([route.audience]),
      invoke,
    });
  }
  const bindings = [...byOperation.values()]
    .sort((left, right) => left.operation.id.localeCompare(right.operation.id))
    .map(({ operation, audiences, invoke }) => `{
      operation: ${JSON.stringify(operation)},
      audiences: ${JSON.stringify([...audiences].sort())},
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
  const authorityManifest = applicationStaticAuthorityManifest(graph);
  return `const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(databaseEnvironment)}), { max: 6, idle_timeout: 20, connect_timeout: 10, prepare: false });
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(graph.metadata.name)},
  catalog: ${compressedGeneratedJson(operationCatalog)},
  ${authorityManifest ? `authorityManifest: ${compressedGeneratedJson(authorityManifest)},` : ''}
});
let operationAuthorityPrepared = false;
async function prepareOperationAuthority() {
  if (operationAuthorityPrepared) return;
  await operationAuthority.prepare();
  operationAuthorityPrepared = true;
}`;
}

/**
 * Canonical catalogs are application-wide and can be substantially larger
 * than a focused gateway's executable code. Keep the exact declarative
 * document in every independently deployable authority runtime without
 * replaying its verbose JSON in the generated bundle.
 */
function compressedGeneratedJson(value: unknown): string {
  const encoded = gzipSync(Buffer.from(JSON.stringify(value)), {
    level: 9,
  }).toString('base64');
  return `JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(encoded)}, 'base64')).toString('utf8'))`;
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
    const streamAuthorize = stream.signal
      ? 'async () => true'
      : `async (principal, action) => ${callbackVariable(stream.id, 'streamAuthorize')}({ principal, action })`;
    const source = `createPostgresApplicationStream({ stream: streamSubscriptions[${JSON.stringify(subscription.name)}].stream, databaseUrl: requiredEnv(${JSON.stringify(stream.database.connectionEnvName)}), principal: identity.principal${stream.signal ? '' : ', contextDigest: identity.contextDigest'} })`;
    const open = stream.signal
      ? `createApplicationAuthorizedReplayableStream({ source: ${source}, authorize: (event) => authorizeSignalIssuance(identity, event) })`
      : source;
    return `{ name: ${JSON.stringify(subscription.name)}, stream: { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(streamId)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}, ${JSON.stringify(`${streamId}.payload`)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database: ${databaseBindingSource(stream.database)}, partition: () => { throw new Error('Subscription replay never repartitions persisted events.'); }, authorize: ${streamAuthorize} }, authorize: async (principal) => ${callbackVariable(subscription.id, 'authorize')}({ principal }), open: (identity) => ${open} }`;
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
    const contextDigest = applicationAdmittedContextDigest({ values: trustedContext, digestSecret: contextSecret });
    const principal = ${operationCatalog && hasOperationAuthority ? 'await admitGatewayPrincipal(admitted, contextDigest)' : 'admitted.principal'};
    return { principal, trustedContext, contextDigest };
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

function uniqueSignalStreams(
  sources: readonly {
    readonly stream: ApplicationStreamNode;
  }[],
): readonly (ApplicationStreamNode & {
  readonly signal: NonNullable<ApplicationStreamNode['signal']>;
})[] {
  const streams = new Map<
    string,
    ApplicationStreamNode & {
      readonly signal: NonNullable<ApplicationStreamNode['signal']>;
    }
  >();
  for (const { stream } of sources) {
    if (!stream.signal) continue;
    const previous = streams.get(stream.signal.id);
    if (
      previous
      && JSON.stringify(previous.signal) !== JSON.stringify(stream.signal)
    ) {
      throw new Error(
        `Generated gateway receives incompatible signal contracts for ${stream.signal.id}.`,
      );
    }
    streams.set(
      stream.signal.id,
      stream as ApplicationStreamNode & {
        readonly signal: NonNullable<ApplicationStreamNode['signal']>;
      },
    );
  }
  return [...streams.values()].sort((left, right) =>
    left.signal.id.localeCompare(right.signal.id));
}

function generatedSignalGateway(
  graph: ApplicationGraph,
  gateway: ApplicationGatewayNode,
  streams: readonly (ApplicationStreamNode & {
    readonly signal: NonNullable<ApplicationStreamNode['signal']>;
  })[],
  operationCatalog: ApplicationOperationCatalog,
  hasOperationAuthority: boolean,
): string {
  if (streams.length === 0) {
    return `const signalStore = undefined;
const signalGateway = undefined;
async function authorizeSignalIssuance() { return false; }`;
  }
  if (!hasOperationAuthority) {
    throw new Error(
      `Generated gateway ${gateway.id} exposes signals without a transactional operation-authority database.`,
    );
  }
  const databaseNames = new Set(streams.map((stream) => stream.database.name));
  if (databaseNames.size !== 1) {
    throw new Error(
      `Generated gateway ${gateway.id} exposes signals from multiple canonical stores.`,
    );
  }
  const databaseName = [...databaseNames][0]!;
  const definitions = streams.map(({ signal }) => {
    const actions = Object.fromEntries(
      signal.actions.map((action) => [
        action.name,
        {
          kind: 'jsonSchema',
          ref: {
            kind: 'jsonSchema',
            exportName: `${signal.id}.actions.${action.name}`,
          },
          schema: action.schema.jsonSchema,
        },
      ]),
    );
    return `${JSON.stringify(signal.id)}: Object.freeze({
  kind: 'applicationSignalDefinition',
  id: ${JSON.stringify(signal.id)},
  name: ${JSON.stringify(signal.name)},
  version: ${JSON.stringify(signal.version)},
  input: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: ${JSON.stringify(`${signal.id}.input`)} }, schema: ${JSON.stringify(signalInputSchema(streams.find((stream) => stream.signal.id === signal.id)!))} },
  actions: Object.freeze(${JSON.stringify(actions)}),
})`;
  }).join(',\n');
  const operationIds = Object.fromEntries(
    streams.map(({ signal }) => [
      signal.id,
      {
        read: operationCatalog.operations.find((operation) =>
          operation.id === `applik8s://signals/${signal.id}/operations/issuance.read`)?.id,
        actions: Object.fromEntries(signal.actions.map((action) => [
          action.name,
          operationCatalog.operations.find((operation) =>
            operation.id === `applik8s://signals/${signal.id}/operations/${action.name}`)?.id,
        ])),
      },
    ]),
  );
  for (const [signalId, contract] of Object.entries(operationIds)) {
    if (!contract.read || Object.values(contract.actions).some((id) => !id)) {
      throw new Error(
        `Generated gateway ${gateway.id} signal ${signalId} has an incomplete operation catalog.`,
      );
    }
  }
  return `const signalStore = createPostgresApplicationSignalStore({
  sql: ${databaseVariable(databaseName)}Sql,
});
const signalDefinitions = Object.freeze({
${definitions}
});
const signalOperations = Object.freeze(${JSON.stringify(operationIds)});
function signalOperationTarget(signal) {
  return {
    kind: 'target',
    model: signal.contract.id,
    identity: { ...signal.target, signalId: signal.id },
  };
}
async function authorizeSignalOperation(identity, signal, action, input, transaction) {
  const contract = signalOperations[signal.contract.id];
  const operationId = action ? contract?.actions?.[action] : contract?.read;
  if (!operationId) return false;
  const actor = {
    id: identity.principal.identity.id,
    ...(identity.principal.roles ? { roles: identity.principal.roles } : {}),
    ...(identity.principal.attributes ? { attributes: identity.principal.attributes } : {}),
  };
  if (!applicationSignalAccessAllows(signal, actor)) return false;
  const authorize = () => operationAuthority.authorize({
      principal: identity.principal,
      operationId,
      target: signalOperationTarget(signal),
      audience: ${JSON.stringify(gateway.id)},
      transport: 'http',
      inputDigest: applicationOperationInputDigest(input),
      trustedContextDigest: identity.contextDigest,
      applicationPolicyAllowed: true,
    });
  const result = transaction
    ? await operationAuthority.withinTransaction(transaction, authorize)
    : await authorize();
  return result.allowed ? { id: result.receipt.id } : false;
}
function signalGrantIds(signal) {
  if (signal.access.mode !== 'grant') return [];
  const subjects = Array.isArray(signal.access.subject)
    ? signal.access.subject
    : [signal.access.subject];
  return subjects.map((subject) =>
    'grant:signal:' + signal.id + ':' + subject.id);
}
async function revokeSignalGrants(signal, transaction) {
  for (const grantId of signalGrantIds(signal)) {
    await operationAuthority.revokeGrant(
      grantId,
      'Signal ' + signal.id + ' reached terminal state.',
      transaction,
    );
  }
}
const signalGateway = createApplicationSignalGateway({
  basePath: '/signals',
  store: signalStore,
  definitions: Object.values(signalDefinitions),
  authenticate: async (request) => {
    const admitted = await admitRequest(request);
    const trustedContext = admitted.trustedContext ?? {};
    const contextDigest = applicationAdmittedContextDigest({
      values: trustedContext,
      digestSecret: contextSecret,
    });
    const principal = await admitGatewayPrincipal(admitted, contextDigest);
    return {
      actor: {
        id: principal.identity.id,
        ...(principal.roles ? { roles: principal.roles } : {}),
        ...(principal.attributes ? { attributes: principal.attributes } : {}),
      },
      principal: { principal, contextDigest },
    };
  },
  authorizeRead: ({ identity, signal }) =>
    authorizeSignalOperation(identity.principal, signal, undefined, {
      signalId: signal.id,
    }),
  authorizeAction: ({ identity, signal, action, input, transaction }) =>
    authorizeSignalOperation(identity.principal, signal, action, input, transaction),
  finalizeAction: ({ signal }, { transaction }) =>
    revokeSignalGrants(signal, transaction),
});
async function authorizeSignalIssuance(identity, event) {
  const reference = event?.payload?.signal;
  const signalId = reference?.issuance?.id;
  const contractId = reference?.contract?.id;
  if (typeof signalId !== 'string' || typeof contractId !== 'string') return false;
  const signal = await signalStore.read(signalId);
  if (
    !signal
    || signal.contract.id !== contractId
    || !applicationSignalIsActionable(signal)
  ) return false;
  return Boolean(await authorizeSignalOperation(identity, signal, undefined, {
    signalId,
  }));
}`;
}

function signalInputSchema(
  stream: ApplicationStreamNode & {
    readonly signal: NonNullable<ApplicationStreamNode['signal']>;
  },
): JsonObject {
  const payload = stream.payload.jsonSchema;
  const properties = payload.properties;
  const input = properties && typeof properties === 'object'
    ? (properties as JsonObject).input
    : undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      `Signal stream ${stream.id} does not expose its authored input schema at payload.input.`,
    );
  }
  return input as JsonObject;
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
const databaseUrl = requiredEnv(${JSON.stringify(stream.database.connectionEnvName)});
const createSource = () => createPostgresApplicationStream({ stream, databaseUrl, principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} }, internalConsumer: { kind: 'projection', name: ${JSON.stringify(projection.name)} } });
let source = createSource();
const store = createClickHouseAnalyticalProjectionWriter({ endpoint: requiredEnv('APPLIK8S_CLICKHOUSE_ENDPOINT'), database: requiredEnv('APPLIK8S_CLICKHOUSE_DATABASE'), table: ${JSON.stringify(table)}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, schema: schema(${JSON.stringify(projection.output.jsonSchema)}), ...(process.env.APPLIK8S_CLICKHOUSE_USERNAME ? { username: process.env.APPLIK8S_CLICKHOUSE_USERNAME, password: process.env.APPLIK8S_CLICKHOUSE_PASSWORD ?? '' } : {}) });
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0; let lastSuccessfulCycleAt = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const fresh = lastSuccessfulCycleAt > 0 && Date.now() - lastSuccessfulCycleAt < 60_000; const ok = live || (ready && fresh && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready: ready && fresh, stopping, checkpoint, processed, lastError, lastSuccessfulCycleAt })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { let prepared = false; while (!stopping) { try { if (!prepared) { await store.prepare(); prepared = true; } const result = await runApplicationProjection({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, project, batchSize: 250, maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; await enforcePostgresApplicationStreamRetention({ stream, databaseUrl, batchSize: 1000 }); lastError = undefined; ready = true; lastSuccessfulCycleAt = Date.now(); await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; await source.close().catch(() => undefined); if (!stopping) { source = createSource(); console.error(error); } await abortableSleep(5000, loopController.signal); } } }
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
const createSource = () => createPostgresApplicationStream({ stream, databaseUrl, principal: { id: ${JSON.stringify(`applik8s:projection:${projection.name}`)} }, internalConsumer: { kind: 'projection', name: ${JSON.stringify(projection.name)} } });
let source = createSource();
const store = createValkeyOnlineProjectionWriter({ host: requiredEnv('APPLIK8S_VALKEY_HOST'), port: Number(requiredEnv('APPLIK8S_VALKEY_PORT')), ...(process.env.APPLIK8S_VALKEY_PASSWORD ? { password: process.env.APPLIK8S_VALKEY_PASSWORD } : {}), prefix: ${JSON.stringify(kubernetesName(graphName))}, projection: ${JSON.stringify(projection.name)}, stream: ${JSON.stringify(`${stream.name}.${stream.version}`)}, valueSchema: schema(${JSON.stringify(projection.output.jsonSchema)}), partitionBy, key, score, scoreUnit: ${JSON.stringify(projection.online.scoreUnit)}, value, ...(removeWhen ? { removeWhen } : {}), retention: ${JSON.stringify(projection.online.retention)}, initialGeneration: 'live' });
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0; let generation = 'unknown'; let lastSuccessfulCycleAt = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const fresh = lastSuccessfulCycleAt > 0 && Date.now() - lastSuccessfulCycleAt < 60_000; const ok = live || (ready && fresh && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready: ready && fresh, stopping, checkpoint, processed, generation, lastError, lastSuccessfulCycleAt })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { let prepared = false; while (!stopping) { try { if (!prepared) { await store.prepare(); prepared = true; } const result = await runApplicationProjection({ projection: ${JSON.stringify(projection.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, project, batchSize: 250, maxBatches: 20 }); checkpoint = result.checkpoint; processed += result.processed; generation = await store.activeGeneration(); await enforcePostgresApplicationStreamRetention({ stream, databaseUrl, batchSize: 1000 }); lastError = undefined; ready = true; lastSuccessfulCycleAt = Date.now(); await abortableSleep(result.exhausted ? 1000 : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; await source.close().catch(() => undefined); if (!stopping) { source = createSource(); console.error(error); } await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await source.close(); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

function generatedStreamProcessorSource(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  stream: ApplicationStreamNode,
  workflow: StreamProcessorWorkflowContract | undefined,
  operationCatalog: ApplicationOperationCatalog,
  operations: readonly StreamProcessorOperationContract[],
  queries: readonly StreamProcessorQueryContract[],
  serviceIdentity: ApplicationIdentityReference | undefined,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): string {
	const observability = applicationGraphHasObservabilityRuntime(graph);
  const usesObjectStorage = streamProcessorUsesObjectStorage(processor);
  const objectStorageImports = usesObjectStorage
    ? "import { installApplicationObjectStorageRuntimeResolver } from '@applik8s/applik8s/workflow-runtime-resolvers';\nimport { createS3ApplicationObjectStorageRuntime } from '@applik8s/runtime-s3';"
    : '';
  const objectStorageDeclarations = usesObjectStorage
    ? `
const objectStorageProvider = Object.freeze({
  kind: 's3',
  bucket: requiredEnv('APPLIK8S_OBJECT_STORAGE_BUCKET'),
  region: requiredEnv('APPLIK8S_OBJECT_STORAGE_REGION'),
  ...(process.env.APPLIK8S_OBJECT_STORAGE_PREFIX ? { prefix: process.env.APPLIK8S_OBJECT_STORAGE_PREFIX } : {}),
  ...(process.env.APPLIK8S_OBJECT_STORAGE_ENDPOINT ? { endpoint: process.env.APPLIK8S_OBJECT_STORAGE_ENDPOINT } : {}),
  forcePathStyle: process.env.APPLIK8S_OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
});
const objectStorageRuntimes = new Map();
installApplicationObjectStorageRuntimeResolver((binding) => {
  if (process.env.APPLIK8S_OBJECT_STORAGE_ENABLED === 'false') return undefined;
  const existing = objectStorageRuntimes.get(binding.name);
  if (existing) return existing;
  const runtime = createS3ApplicationObjectStorageRuntime({
    store: binding.name,
    provider: objectStorageProvider,
  });
  objectStorageRuntimes.set(binding.name, runtime);
  return runtime;
});
`
    : '';
  const workflowImport = workflow ? "import { AsyncLocalStorage } from 'node:async_hooks';\nimport { applicationWorkflowCausalPrincipalMetadata } from '@applik8s/applik8s/workflow-runtime';\nimport { installApplicationWorkflowRuntimeResolver } from '@applik8s/applik8s/workflow-runtime-resolvers';\nimport { createHatchetWorkflowRuntime } from '@applik8s/runtime-hatchet';\nimport { normalizeSchema } from '@applik8s/sdk/schema-runtime';" : '';
  const admissionImport = "import { applicationAdmissionInvocationView, applicationCausalPrincipalContext, createApplicationAdmissionContextV1, validateApplicationAdmissionContextV1WithoutReceipt, withApplicationAdmissionExecutionV1 } from '@applik8s/core';\nimport { applicationAdmissionRejectionCodeV1, createApplicationAdmissionObservationV1 } from '@applik8s/core/admission';";
  const postgresImport = "import postgres from 'postgres';";
  const authorityImport = "import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';";
  const hasTransactionalFunctionNativeRuntime = Boolean(
    processor.functionNativeTransaction || operations.length > 0,
  );
  const hasFunctionNativeBindings = Boolean(
    hasTransactionalFunctionNativeRuntime
    || (processor.callableBindings?.length ?? 0) > 0
    || (processor.providerBindings ?? []).some(
      (binding) => binding.operation?.runtime,
    ),
  );
  const queryImports = queries.length > 0
    ? `import { drizzle } from 'drizzle-orm/postgres-js';
import { normalizeSchema as normalizeQuerySchema } from '@applik8s/sdk/schema-runtime';
${hasTransactionalFunctionNativeRuntime ? '' : "import { applicationCommandPrincipalValues } from '@applik8s/applik8s/stream-worker-runtime';"}
import { createApplicationRelationalContext, withApplicationDatabaseRuntimeResolver } from '@applik8s/applik8s/query-runtime';`
    : '';
  const queryCallbackImports = [...new Map(
    queries.map(({ query }) => [query.id, query] as const),
  ).values()].flatMap((query) => [
    `import { callback as ${callbackVariable(query.id, 'authorize')} } from './${callbackName(query.id, 'authorize')}.generated.js';`,
    `import { callback as ${callbackVariable(query.id, 'run')} } from './${callbackName(query.id, 'run')}.generated.js';`,
  ]).join('\n');
  const functionNativeImport = hasTransactionalFunctionNativeRuntime
    ? "import { applicationCommandPrincipalValues, applicationPostgresModelReadClients, createApplicationFunctionNativeEventHandle, createApplicationFunctionNativeOperationHandle, currentFunctionNativePostgresDatabase, currentFunctionNativePostgresTransaction, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, executeFunctionNativePostgresTransaction, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelReadClients, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';\nimport { runApplicationModelBeforeCommit } from '@applik8s/applik8s/processor-runtime';"
    : '';
  const callableImports = [
    ...((processor.callableBindings ?? []).some(
      (binding) => binding.runtime === 'notifications.request.v1',
    )
      ? ["import { createApplicationNotificationRequestCallable } from '@applik8s/notifications';"]
      : []),
    ...streamProcessorProviderRuntimeImports(processor),
  ].join('\n');
  const workflowDeclarations = workflow ? `
const workflowRuntime = createHatchetWorkflowRuntime({ kind: 'hatchet', tls: process.env.HATCHET_CLIENT_TLS_STRATEGY === 'tls' });
const directWorkflowScope = new AsyncLocalStorage();
installApplicationWorkflowRuntimeResolver(() => directWorkflowScope.getStore());
function validateWorkflowValue(schema, value, name, role) { const normalized = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name + ':' + role }, schema }, name + '.' + role); const result = normalized.validate(value); if (!result.ok) throw new Error('applik8s-workflow-' + role + '-invalid: ' + name + ': ' + result.error.message); return result.value; }
const schedules = Object.freeze({
${workflow.schedules.map((binding) => `  ${JSON.stringify(binding.alias)}: Object.freeze({ reconcile: (schedule, metadata) => workflowRuntime.reconcileSchedule(${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, { ...schedule, input: validateWorkflowValue(${JSON.stringify(binding.contract.input.jsonSchema)}, schedule?.input, ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, 'input') }, metadata) }),`).join('\n')}
});
function processorWorkflows(context) { return Object.freeze({
${workflow.tasks.map((binding) => `  ${JSON.stringify(binding.alias)}: Object.assign(async (input, metadata) => { const name = ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}; const output = await workflowRuntime.run(name, validateWorkflowValue(${JSON.stringify(binding.contract.input.jsonSchema)}, input, name, 'input'), directWorkflowMetadata(context, ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, metadata), { signal: context.signal, timeoutMs: ${processor.budgets.timeoutMs} }); return validateWorkflowValue(${JSON.stringify(binding.contract.output.jsonSchema)}, output, name, 'output'); }, {
    start: (input, metadata) => directWorkflowRuntime(context).start(${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, input, metadata),
    schedule: (input, at, metadata) => directWorkflowRuntime(context).schedule(${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, input, at, metadata),
    reconcile: (schedule, metadata) => workflowRuntime.reconcileSchedule(${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, schedule, directWorkflowMetadata(context, ${JSON.stringify(`${binding.contract.name}.${binding.contract.version}`)}, metadata)),
  }),`).join('\n')}
}); }
const directWorkflowContracts = new Set(${JSON.stringify(workflow.tasks.map((binding) => `${binding.contract.name}.${binding.contract.version}`))});
function directWorkflowMetadata(context, contract, metadata) { const callerKey = metadata?.idempotencyKey; const event = context.event; const causalPrincipal = context.principal ? applicationCausalPrincipalContext(context.principal) : undefined; return { ...metadata, idempotencyKey: context.idempotencyKey + ':' + contract + (callerKey ? ':' + callerKey : ''), causationId: event?.id ?? context.batch?.id, ...(!event?.contextDigest ? {} : { trustedContext: { values: context.trustedContext, digest: event.contextDigest, ...(event.changeScopes ? { changeScopes: event.changeScopes } : {}) } }), ...(causalPrincipal ? { [applicationWorkflowCausalPrincipalMetadata]: causalPrincipal } : {}) }; }
function directWorkflowRuntime(context) { const requireContract = (contract) => { if (!directWorkflowContracts.has(contract)) throw new Error('Stream processor attempted to call undeclared workflow ' + JSON.stringify(contract)); return contract; }; return {
  run: (contract, input, metadata, result) => workflowRuntime.run(requireContract(contract), input, directWorkflowMetadata(context, contract, metadata), { signal: context.signal, timeoutMs: ${processor.budgets.timeoutMs}, ...result }),
  start: (contract, input, metadata) => workflowRuntime.start(requireContract(contract), input, directWorkflowMetadata(context, contract, metadata)),
  schedule: (contract, input, at, metadata) => workflowRuntime.schedule(requireContract(contract), input, at, directWorkflowMetadata(context, contract, metadata)),
  reconcileSchedule: (contract, schedule, metadata) => workflowRuntime.reconcileSchedule(requireContract(contract), schedule, directWorkflowMetadata(context, contract, metadata)),
  signal: (contract, runId, name, payload, metadata) => workflowRuntime.signal(requireContract(contract), runId, name, payload, directWorkflowMetadata(context, contract, metadata)),
}; }
` : '';
  const functionNativeDeclarations = generatedFunctionNativeStreamTransaction(
    graph,
    processor,
    operations,
    serviceIdentity,
  );
  const queryDeclarations = generatedStreamProcessorQueries(
    graph,
    processor,
    queries,
    hasTransactionalFunctionNativeRuntime,
  );
  const executionPrincipal = generatedStreamProcessorExecutionPrincipal(
    graph,
    processor,
    serviceIdentity,
    workloadAuthority.filter((candidate) =>
      candidate.workloadIdentity.subject === processor.id),
  );
  const actorDeclarations = generatedStreamProcessorActors(
    processor,
    queries.length > 0,
    workloadAuthority,
  );
  const authoredHandlerInvocation =
    generatedStreamProcessorAuthoredHandlerInvocation(
      Boolean(workflow),
      hasFunctionNativeBindings,
      hasTransactionalFunctionNativeRuntime,
      queries.length > 0,
      (processor.actorBindings?.length ?? 0) > 0,
    );
  const runtimeFunction = processor.invocation === 'batch'
    ? 'runApplicationStreamBatchProcessor'
    : 'runApplicationStreamProcessor';
  const runtimeOptions = processor.invocation === 'batch'
    ? `concurrency: processorConcurrency, maxItems: ${processor.batch?.maxItems}, maxBytes: ${processor.batch?.maxBytes}, maxBatches: 20`
    : 'concurrency: processorConcurrency, batchSize: Math.min(1000, processorMaxAckPending), maxBatches: 20';
  const exhaustedWaitMs = processor.invocation === 'batch'
    ? processor.batch?.maxWaitMs ?? 1_000
    : 1_000;
  const signalImports = stream.signal
    ? `import { applicationOperationInputDigest } from '@applik8s/applik8s/operation-runtime';
import { applicationSignalAccessAllows, createApplicationSignalIssuanceDecoder, createPostgresApplicationSignalStore } from '@applik8s/applik8s/signal-runtime';`
    : '';
  const signalRuntime = generatedStreamProcessorSignalRuntime(
    graph,
    processor,
    stream,
    operationCatalog,
  );
  return `import { createServer } from 'node:http';
import { createPostgresApplicationStream, createPostgresApplicationStreamProcessorStore, enforcePostgresApplicationStreamRetention, ${runtimeFunction} } from '@applik8s/applik8s/stream-worker-runtime';
${observability || streamProcessorProviderRuntimeOperations(processor).length > 0 ? generatedApplicationTelemetryImports({ providerOperationInstrumentation: streamProcessorProviderRuntimeOperations(processor).length > 0, runtimeImplementation: observability }).join('\n') : ''}
${postgresImport}
${admissionImport}
${authorityImport}
${workflowImport}
${queryImports}
${functionNativeImport}
${callableImports}
${signalImports}
${objectStorageImports}
import { createCallback as createHandleEvent } from './handle.generated.js';
${queryCallbackImports}
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function requiredIntegerEnv(name, minimum, maximum) { const value = Number(requiredEnv(name)); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(name + ' must be ' + minimum + '..' + maximum); return value; }
function schema(json) { return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:stream-processor' }, schema: json }; }
const database = ${databaseBindingSource(stream.database)};
const stream = { kind: 'applicationStream', definition: { kind: 'stream', id: ${JSON.stringify(`${stream.name}.${stream.version}`)}, name: ${JSON.stringify(stream.name)}, version: ${JSON.stringify(stream.version)}, payload: schema(${JSON.stringify(stream.payload.jsonSchema)}) }, retention: ${JSON.stringify(stream.retention)}, authority: 'postgres-outbox', replay: 'supported', database, partition: () => { throw new Error('Processor replay never repartitions persisted events.'); }, authorize: async () => false };
const databaseUrl = requiredEnv(${JSON.stringify(stream.database.connectionEnvName)});
const processorAuthoritySql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
const processorOperationAuthority = createApplicationOperationAuthorityRuntime({
  sql: processorAuthoritySql,
  application: ${JSON.stringify(graph.metadata.name)},
  catalog: ${JSON.stringify(operationCatalog)},
  ${applicationStaticAuthorityManifest(graph) ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(graph))},` : ''}
});
${observability ? generatedApplicationTelemetryRuntimeSource({ application: graph.metadata.name, service: `stream-processor:${processor.name}` }) : ''}
const createSource = () => createPostgresApplicationStream({ stream, databaseUrl, principal: { id: ${JSON.stringify(`applik8s:processor:${processor.name}`)} }, includeTrustedContext: true, internalConsumer: { kind: 'processor', name: ${JSON.stringify(processor.name)} } });
let source = createSource();
const store = createPostgresApplicationStreamProcessorStore({ databaseUrl });
${objectStorageDeclarations}
${signalRuntime.declarations}
const processorConcurrency = requiredIntegerEnv('APPLIK8S_PROCESSOR_CONCURRENCY', 1, 64);
const processorMaxAckPending = requiredIntegerEnv('APPLIK8S_PROCESSOR_MAX_ACK_PENDING', processorConcurrency, 65536);
${workflowDeclarations}
${executionPrincipal}
${queryDeclarations}
${actorDeclarations}
${functionNativeDeclarations}
${authoredHandlerInvocation}
let ready = false; let stopping = false; let lastError; let checkpoint = 0; let processed = 0; let deadLettered = 0; let lastSuccessfulCycleAt = 0;
const loopController = new AbortController();
const server = createServer((request, response) => { const live = request.url === '/live'; const health = live || request.url === '/ready'; if (!health) { response.writeHead(404); response.end(); return; } const fresh = lastSuccessfulCycleAt > 0 && Date.now() - lastSuccessfulCycleAt < 60_000; const ok = live || (ready && fresh && !stopping); response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ready: ready && fresh, stopping, checkpoint, processed, deadLettered, lastError, lastSuccessfulCycleAt })); });
server.listen(Number(process.env.APPLIK8S_HEALTH_PORT ?? '8080'), '0.0.0.0');
async function loop() { while (!stopping) { try { const result = await ${runtimeFunction}({ processor: ${JSON.stringify(processor.name)}, streamName: ${JSON.stringify(`${stream.name}.${stream.version}`)}, source, store, handle: invokeHandler, admit: processorAdmission, ${signalRuntime.runtimeOption}${runtimeOptions}, retry: ${JSON.stringify(processor.retry)}, failure: ${JSON.stringify(processor.failure)}, timeoutMs: ${processor.budgets.timeoutMs}, maxInputBytes: ${processor.budgets.maxInputBytes} }); checkpoint = result.checkpoint; processed += result.processed; deadLettered += result.deadLettered; await enforcePostgresApplicationStreamRetention({ stream, databaseUrl, batchSize: 1000 }); lastError = undefined; ready = true; lastSuccessfulCycleAt = Date.now(); await abortableSleep(result.exhausted ? ${exhaustedWaitMs} : 10, loopController.signal); } catch (error) { lastError = error instanceof Error ? error.message : String(error); ready = false; await source.close().catch(() => undefined); if (!stopping) { source = createSource(); console.error(error); } await abortableSleep(5000, loopController.signal); } } }
function abortableSleep(ms, signal) { if (signal.aborted) return Promise.resolve(); return new Promise((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(); } signal.addEventListener('abort', abort, { once: true }); }); }
const loopTask = loop();
async function shutdown() { if (stopping) return; stopping = true; ready = false; loopController.abort(); await new Promise((resolve) => server.close(resolve)); await loopTask; await Promise.all([source.close(), store.close(), processorAuthoritySql.end({ timeout: 5 })${queries.length > 0 ? ', processorQuerySql.end({ timeout: 5 })' : ''}${signalRuntime.shutdown}${observability ? ', closeApplicationTelemetryRuntime()' : ''}]); }
process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
await loopTask;
`;
}

function generatedFunctionNativeStreamTransaction(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operations: readonly StreamProcessorOperationContract[],
  serviceIdentity: ApplicationIdentityReference | undefined,
): string {
  const transaction = processor.functionNativeTransaction;
  if (!transaction && operations.length === 0) {
    const hasPortableBindings =
      (processor.callableBindings?.length ?? 0) > 0
      || streamProcessorProviderRuntimeOperations(processor).length > 0;
    if (!hasPortableBindings) {
      return 'const functionNativeBindings = Object.freeze({});';
    }
    return `const functionNativeLeafBindings = Object.freeze(${streamProcessorCallbackBindingsSource(graph, processor, operations)});
${streamProcessorCallableBindingsSource(processor)}`;
  }
  const nodes = graphNodes(graph);
  const executableOperations = uniqueStreamProcessorRuntimeOperations(
    processor,
    operations,
  );
  const primary = transaction
    ? requiredNode(
        nodes,
        transaction.primaryModel.nodeId,
        'model',
        processor.id,
      )
    : operations[0]?.model;
  if (!primary) {
    throw new Error(
      `Function-native stream processor ${processor.id} has no transaction authority model.`,
    );
  }
  if (!primary.runtime) {
    throw new Error(
      `Function-native stream processor ${processor.id} primary model ${primary.id} has no PostgreSQL runtime contract.`,
    );
  }
  const models = [...new Map([
    ...(transaction?.models ?? []).map((reference) => {
      const model = requiredNode(nodes, reference.nodeId, 'model', processor.id);
      if (!model.runtime) {
        throw new Error(
          `Function-native stream processor ${processor.id} participant ${model.id} has no PostgreSQL runtime contract.`,
        );
      }
      return [model.runtime.name, model.runtime] as const;
    }),
    ...operations.map(({ model }) => [model.runtime.name, model.runtime] as const),
  ]).values()];
  const outbox = (transaction?.outbox ?? []).map((reference) => {
    const event = requiredNode(nodes, reference.nodeId, 'event', processor.id);
    return {
      kind: 'applik8sEvent',
      id: event.name,
      name: event.contract.name,
      version: event.contract.version,
      payload: {
        kind: 'jsonSchema',
        ref: {
          kind: 'jsonSchema',
          uri: `generated:${event.name}.payload`,
        },
        schema: event.contract.payload.jsonSchema,
      },
    };
  });
  return `
const functionNativePrimaryModel = Object.freeze(${JSON.stringify(primary.runtime)});
const functionNativeModels = Object.freeze(${JSON.stringify(models)});
const functionNativeOutbox = Object.freeze(${JSON.stringify(outbox)});
${streamProcessorNestedOperationsSource(graph, processor, executableOperations)}
const functionNativeCommands = Object.freeze(${JSON.stringify(executableOperations.map(({ command }) => ({
    kind: 'applik8sCommand',
    id: `${command.contract.name}.${command.contract.version}`,
    name: command.contract.name,
    version: command.contract.version,
    input: {
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', uri: `generated:${command.id}.input` },
      schema: command.contract.input.jsonSchema,
    },
    output: {
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', uri: `generated:${command.id}.output` },
      schema: command.contract.output.jsonSchema,
    },
    errors: Object.fromEntries(command.contract.errors.map((error) => [
      error.name,
      {
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', uri: `generated:${command.id}.errors.${error.name}` },
        schema: error.schema.jsonSchema,
      },
    ])),
  })))});
function functionNativeModelSnapshot(value) { return value ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) } : undefined; }
function functionNativeModelHandle(name) { return Object.freeze({
  get: async identity => functionNativeModelSnapshot(await getApplicationNativeModelObject(name, identity)),
  find: async options => (await findApplicationNativeModelObjects(name, options)).items.map(functionNativeModelSnapshot),
  require: async identity => functionNativeModelSnapshot(await requireApplicationNativeModelObject(name, identity)),
  edit: (identity, handler) => editApplicationNativeModelObject(name, identity, handler),
}); }
const functionNativeLeafBindings = Object.freeze(${streamProcessorCallbackBindingsSource(graph, processor, operations)});
${streamProcessorCallableBindingsSource(processor)}
function functionNativeDelivery(context) {
  const sourceId = context.event?.id ?? context.batch?.id;
  if (!sourceId) throw new Error('Function-native transaction requires a durable source event or frozen batch identity.');
  const principal = processorExecutionPrincipal(context);
  return {
    id: sourceId,
    idempotencyKey: context.idempotencyKey,
    correlationId: sourceId,
    causationId: sourceId,
    recordedAt: context.event?.recordedAt ?? context.batch?.recordedAt,
    ...(context.event?.contextDigest ? {
      context: {
        values: { ...context.trustedContext, ...(principal ? applicationCommandPrincipalValues(principal) : {}) },
        digest: context.event.contextDigest,
        ...(context.event.changeScopes ? { changeScopes: context.event.changeScopes } : {}),
      },
    } : {}),
  };
}

function functionNativeRuntime(context) {
  return Object.freeze({
    edit: request => executeFunctionNativePostgresModelEdit({
      bindingId: ${JSON.stringify(processor.id)},
      model: functionNativePrimaryModel,
      models: functionNativeModels,
      outbox: functionNativeOutbox,
      commands: functionNativeCommands,
      atomicOperations: functionNativeOperations,
      databaseUrl,
      delivery: functionNativeDelivery(context),
    }, request),
  });
}
const invokeWithModelReads = async (input, context) => {
  const delivery = functionNativeDelivery(context);
  const activeTransaction = currentFunctionNativePostgresTransaction();
  const clients = await applicationPostgresModelReadClients(
    activeTransaction ?? databaseUrl,
    functionNativeModels,
    delivery.context,
  );
  return withApplicationNativeModelReadClients(
    clients,
    () => invokeAuthoredHandler(input, context),
  );
};
const invokeHandler = (input, context) =>
  ${operations.length > 0 && transaction?.mode !== 'write'
    ? `executeFunctionNativePostgresTransaction({ bindingId: ${JSON.stringify(processor.id)}, databaseUrl, connectionModel: functionNativePrimaryModel, operations: functionNativeOperations, delivery: functionNativeDelivery(context), retry: ${JSON.stringify(processor.retry)} }, () => invokeWithModelReads(input, context))`
    : transaction?.mode === 'read' ? 'invokeWithModelReads(input, context)' : `withApplicationNativeModelTransactionRuntime(
    functionNativeRuntime(context),
    () => invokeWithModelReads(input, context),
  )`};`;
}

function streamProcessorCallableBindingsSource(
  processor: ApplicationStreamProcessorNode,
): string {
  const callables = processor.callableBindings ?? [];
  if (callables.length === 0) {
    return 'const functionNativeBindings = functionNativeLeafBindings;';
  }
  const declarations = callables.map((binding) => {
    const segments = binding.identifier.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      throw new Error(
        `Stream processor ${processor.id} callable binding ${binding.identifier} must be a serializable property path.`,
      );
    }
    const factory = binding.runtime === 'notifications.request.v1'
      ? 'createApplicationNotificationRequestCallable'
      : undefined;
    if (!factory) {
      throw new Error(
        `Stream processor ${processor.id} callable binding ${binding.identifier} uses unsupported runtime ${String(binding.runtime)}.`,
      );
    }
    return `hydrateApplicationCallable(functionNativeBindingsMutable, ${JSON.stringify(segments)}, ${factory}(functionNativeLeafBindings));`;
  }).join('\n');
  return `const functionNativeBindingsMutable = { ...functionNativeLeafBindings };
function hydrateApplicationCallable(root, path, callable) {
  if (typeof callable !== 'function') throw new Error('Portable callable factory did not return a function.');
  let target = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const existing = target[segment];
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      throw new Error('Portable callable binding collides with runtime handle ' + path.slice(0, index + 1).join('.'));
    }
    target[segment] = { ...(existing ?? {}) };
    target = target[segment];
  }
  const leaf = path[path.length - 1];
  if (Object.hasOwn(target, leaf)) throw new Error('Portable callable binding collides with runtime handle ' + path.join('.'));
  target[leaf] = callable;
}
${declarations}
const functionNativeBindings = Object.freeze(functionNativeBindingsMutable);`;
}

function uniqueStreamProcessorRuntimeOperations(
  processor: ApplicationStreamProcessorNode,
  operations: readonly StreamProcessorOperationContract[],
): readonly StreamProcessorOperationContract[] {
  const unique = new Map<string, StreamProcessorOperationContract>();
  for (const operation of operations) {
    const runtimeId = operation.runtimeOperationId ?? operation.operationId;
    const existing = unique.get(runtimeId);
    if (!existing) {
      unique.set(runtimeId, operation);
      continue;
    }
    if (
      existing.handler.id !== operation.handler.id
      || existing.command.id !== operation.command.id
      || existing.model.id !== operation.model.id
    ) {
      throw new Error(
        `Stream processor ${processor.id} resolves runtime operation ${runtimeId} to both ${existing.handler.id} and ${operation.handler.id}.`,
      );
    }
  }
  return [...unique.values()];
}

function streamProcessorNestedOperationsSource(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operations: readonly StreamProcessorOperationContract[],
): string {
  const nodes = graphNodes(graph);
  const imports = operations.flatMap(({ handler }) => {
    if (!handler.beforeCommit) return [];
    const suffix = createHash('sha256').update(handler.id).digest('hex').slice(0, 12);
    return [
      `import { createCallback as createNestedBeforeCommit_${suffix} } from './nested-before-commit-${suffix}.generated.js';`,
    ];
  });
  const sources = operations.map((operation) => {
    const { handler, command, model } = operation;
    const eventBindings = (handler.eventBindings ?? []).map((binding) => {
      const event = requiredNode(nodes, binding.event.nodeId, 'event', handler.id);
      return {
        identifier: binding.identifier,
        event,
        variable: nestedCallbackVariable(binding.identifier),
      };
    });
    const commandBindings = (handler.commandBindings ?? []).map((binding) => {
      const nestedCommand = requiredNode(nodes, binding.command.nodeId, 'command', handler.id);
      const owner = graph.nodes.find(
        (candidate): candidate is ApplicationCommandHandlerNode =>
          candidate.kind === 'commandHandler'
          && candidate.command.nodeId === nestedCommand.id,
      );
      return {
        identifier: binding.identifier,
        command: nestedCommand,
        owner,
        variable: nestedCallbackVariable(binding.identifier),
      };
    });
    const modelBindings = (handler.transaction.modelBindings ?? []).map((binding) => {
      const participant = requiredNode(nodes, binding.model.nodeId, 'model', handler.id);
      if (!participant.runtime) {
        throw new Error(
          `Generated nested operation ${operation.operationId} model binding ${binding.identifier} has no PostgreSQL runtime.`,
        );
      }
      return {
        identifier: binding.identifier,
        model: participant,
        variable: nestedCallbackVariable(binding.identifier),
      };
    });
    const participantModels = handler.transaction.models.map((reference) => {
      const participant = requiredNode(nodes, reference.nodeId, 'model', handler.id);
      if (!participant.runtime) {
        throw new Error(
          `Generated nested operation ${operation.operationId} participant ${participant.id} has no PostgreSQL runtime.`,
        );
      }
      if (
        participant.runtime.connectionEnvName
        !== processor.database.connectionEnvName
      ) {
        throw new Error(
          `Generated nested operation ${operation.operationId} participant ${participant.name} crosses from ${processor.database.connectionEnvName} to ${participant.runtime.connectionEnvName}. Use a workflow or post-commit event handler across database authorities.`,
        );
      }
      return participant;
    });
    const eventDeclarations = eventBindings.map(({ event, variable }) =>
      `const ${variable}Contract = Object.freeze(${JSON.stringify(nestedEventDefinition(event))});\n      const ${variable} = Object.freeze({ ...${variable}Contract, emit: payload => context.emit(${variable}Contract, payload) });`,
    ).join('\n      ');
    const modelDeclarations = modelBindings.map(({ model: participant, variable }) =>
      `const ${variable} = Object.freeze({
        async get(identity) { const value = await context.models[${JSON.stringify(participant.name)}].get({ id: String(identity) }); return value ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) } : undefined; },
        async find(options) { const page = await context.models[${JSON.stringify(participant.name)}].query(options); return page.items.map(value => ({ identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) })); },
      });`,
    ).join('\n      ');
    const commandDeclarations = commandBindings.map(({ command: nestedCommand, owner, variable }) => {
      if (!owner) {
        return `const ${variable} = () => { throw new Error(${JSON.stringify(`Nested operation ${operation.operationId} references outbound command ${nestedCommand.id} without a local owning handler.`)}); };`;
      }
      return `const ${variable}Contract = Object.freeze(${JSON.stringify(nestedCommandDefinition(nestedCommand))});
      const ${variable} = Object.assign(
        input => {
          const idempotencyKey = ${owner.idempotencyKey ? `(${owner.idempotencyKey.source})(input)` : `context.id(${JSON.stringify(`nested-command:${nestedCommand.id}`)})`};
          context.send(${variable}Contract, input, { targetKey: (${owner.key.source})(input, undefined, idempotencyKey), idempotencyKey });
        },
        ${variable}Contract,
      );`;
    }).join('\n      ');
    const bindingEntries = [
      ...modelBindings.map(({ identifier, variable }) => ({ path: identifier, value: variable })),
      ...eventBindings.map(({ identifier, variable }) => ({ path: identifier, value: variable })),
      ...commandBindings.map(({ identifier, variable }) => ({ path: identifier, value: variable })),
    ];
    const beforeCommit = handler.beforeCommit
      ? (() => {
          const suffix = createHash('sha256').update(handler.id).digest('hex').slice(0, 12);
          return `const __applik8sBeforeCommit = createNestedBeforeCommit_${suffix}(${nestedCallbackObjectSource(bindingEntries)});`;
        })()
      : '';
    const outbox = handler.transaction.outbox.map((reference) => {
      const event = requiredNode(nodes, reference.nodeId, 'event', handler.id);
      return nestedEventDefinition(event);
    });
    const completionEvent = handler.completionEvent
      ? nestedEventDefinition(requiredNode(nodes, handler.completionEvent.nodeId, 'event', handler.id))
      : undefined;
    return `Object.freeze({
      operationId: ${JSON.stringify(operation.runtimeOperationId ?? operation.operationId)},
      bindingId: ${JSON.stringify(handler.name)},
      operation: ${JSON.stringify(nestedModelOperation(operation))},
      command: ${JSON.stringify({ name: command.contract.name, version: command.contract.version })},
      errors: ${JSON.stringify(command.contract.errors.map(({ name }) => name))},
      schemas: ${JSON.stringify({
        input: command.contract.input.jsonSchema,
        output: command.contract.output.jsonSchema,
        errors: Object.fromEntries(command.contract.errors.map((error) => [error.name, error.schema.jsonSchema])),
        events: Object.fromEntries(eventBindings.map(({ event }) => [`${event.contract.name}.${event.contract.version}`, event.contract.payload.jsonSchema])),
        commands: Object.fromEntries(commandBindings.map(({ command: nestedCommand }) => [`${nestedCommand.contract.name}.${nestedCommand.contract.version}`, nestedCommand.contract.input.jsonSchema])),
      })},
      model: ${JSON.stringify(model.runtime)},
      models: ${JSON.stringify(participantModels.map(({ runtime }) => runtime))},
      selfRead: ${String(handler.transaction.selfRead === true)},
      historyModels: ${JSON.stringify(handler.transaction.history.map((reference) => participantModels.find(({ id }) => id === reference.nodeId)?.name).filter(Boolean))},
      retry: ${JSON.stringify(handler.retry)},
      history: ${String(handler.transaction.history.some((reference) => reference.nodeId === model.id))},
      outbox: ${JSON.stringify(outbox)},
      ${completionEvent ? `completionEvent: ${JSON.stringify(completionEvent)},` : ''}
      commands: ${JSON.stringify(commandBindings.map(({ command: nestedCommand }) => nestedCommandDefinition(nestedCommand)))},
      ordering: ${JSON.stringify(handler.ordering)},
      ${handler.missingRoute ? `missingRoute: ${JSON.stringify(handler.missingRoute)},` : ''}
      ${handler.initializeSource ? `initialize: (${handler.initializeSource}),` : ''}
      handler: async (model, input, context) => {
        ${eventDeclarations}
        ${modelDeclarations}
        ${commandDeclarations}
        ${handler.beforeCommit ? 'const __applik8sRunBeforeCommit = runApplicationModelBeforeCommit;' : ''}
        ${beforeCommit}
        return (${handler.handlerSource})(model, input, context);
      },
    })`;
  });
  return `${imports.join('\n')}
const functionNativeOperations = Object.freeze([${sources.join(',\n')}]);`;
}

function nestedModelOperation(
  operation: StreamProcessorOperationContract,
): 'create' | 'update' | 'delete' | 'custom' {
  if (operation.operation.operation === 'create') return 'create';
  if (operation.operation.operation === 'update') return 'update';
  if (operation.operation.operation === 'delete') return 'delete';
  return 'custom';
}

function nestedEventDefinition(event: import('@applik8s/core').ApplicationEventNode) {
  return {
    kind: 'applik8sEvent' as const,
    id: `${event.contract.name}.${event.contract.version}`,
    name: event.contract.name,
    version: event.contract.version,
    payload: {
      kind: 'jsonSchema' as const,
      ref: { kind: 'jsonSchema' as const, uri: `generated:${event.id}.payload` },
      schema: event.contract.payload.jsonSchema,
    },
  };
}

function nestedCommandDefinition(command: ApplicationCommandNode) {
  return {
    kind: 'applik8sCommand' as const,
    id: `${command.contract.name}.${command.contract.version}`,
    name: command.contract.name,
    version: command.contract.version,
    input: {
      kind: 'jsonSchema' as const,
      ref: { kind: 'jsonSchema' as const, uri: `generated:${command.id}.input` },
      schema: command.contract.input.jsonSchema,
    },
    output: {
      kind: 'jsonSchema' as const,
      ref: { kind: 'jsonSchema' as const, uri: `generated:${command.id}.output` },
      schema: command.contract.output.jsonSchema,
    },
    errors: Object.fromEntries(command.contract.errors.map((error) => [
      error.name,
      {
        kind: 'jsonSchema' as const,
        ref: { kind: 'jsonSchema' as const, uri: `generated:${command.id}.errors.${error.name}` },
        schema: error.schema.jsonSchema,
      },
    ])),
  };
}

function nestedCallbackVariable(identifier: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
    ? identifier
    : `nestedBinding_${createHash('sha256').update(identifier).digest('hex').slice(0, 12)}`;
}

function nestedCallbackObjectSource(
  entries: readonly { readonly path: string; readonly value: string }[],
): string {
  interface NestedCallbackNode {
    direct?: string;
    readonly children: Map<string, NestedCallbackNode>;
  }
  const root: NestedCallbackNode = { children: new Map() };
  for (const entry of entries) {
    const segments = entry.path.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      continue;
    }
    let current = root;
    for (const segment of segments) {
      const child = current.children.get(segment) ?? {
        children: new Map<string, NestedCallbackNode>(),
      };
      current.children.set(segment, child);
      current = child;
    }
    current.direct = entry.value;
  }
  const render = (node: NestedCallbackNode): string => {
    if (node.direct && node.children.size === 0) return node.direct;
    const values = [
      ...(node.direct ? [`...(${node.direct})`] : []),
      ...[...node.children.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([property, child]) => `${JSON.stringify(property)}: ${render(child)}`,
        ),
    ];
    return `{ ${values.join(', ')} }`;
  };
  return render(root);
}

function streamProcessorCallbackBindingsSource(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  operations: readonly StreamProcessorOperationContract[],
): string {
  interface StreamCallbackRootBinding {
      readonly model?: { readonly id: string; readonly name: string };
      readonly event?: {
        readonly id: string;
        readonly name: string;
        readonly version: string;
        readonly schema: JsonObject;
      };
      readonly operations: Map<string, StreamProcessorOperationContract>;
      readonly providerRootOperation?: string;
      readonly providerOperations: Map<string, string>;
  }
  const emptyRootBinding = (): StreamCallbackRootBinding => ({
    operations: new Map<string, StreamProcessorOperationContract>(),
    providerOperations: new Map<string, string>(),
  });
  const roots = new Map<string, StreamCallbackRootBinding>();
  for (const { identifier, model } of functionNativeModelRuntimeBindings(
    graph,
    processor,
  )) {
    const root = functionNativeCallbackBindingRoot(identifier, processor.id);
    const existing = roots.get(root) ?? emptyRootBinding();
    if (existing.model && existing.model.id !== model.id) {
      throw new Error(
        `Stream processor ${processor.id} callback root ${root} is ambiguous between ${existing.model.id} and ${model.id}.`,
      );
    }
    roots.set(root, {
      ...existing,
      model: { id: model.id, name: model.name },
    });
  }
  for (const { identifier, event } of functionNativeEventRuntimeBindings(
    graph,
    processor,
  )) {
    const root = functionNativeCallbackBindingRoot(identifier, processor.id);
    const existing = roots.get(root) ?? emptyRootBinding();
    if (existing.model || existing.event) {
      throw new Error(
        `Stream processor ${processor.id} callback root ${root} cannot hydrate as both an event and another runtime handle.`,
      );
    }
    roots.set(root, {
      ...existing,
      event: {
        id: event.id,
        name: event.contract.name,
        version: event.contract.version,
        schema: event.contract.payload.jsonSchema,
      },
    });
  }
  for (const operation of operations) {
    const segments = operation.identifier.split('.');
    const root = functionNativeCallbackBindingRoot(
      operation.identifier,
      processor.id,
    );
    if (
      segments.length < 2
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      throw new Error(
        `Stream processor ${processor.id} operation binding ${operation.identifier} must identify a promoted-model method through a serializable property path.`,
      );
    }
    const existing = roots.get(root) ?? emptyRootBinding();
    if (existing.event) {
      throw new Error(
        `Stream processor ${processor.id} callback root ${root} cannot hydrate as both an event and an operation.`,
      );
    }
    const operationPath = segments.slice(1).join('.');
    const previous = existing.operations.get(operationPath);
    if (previous && previous.operationId !== operation.operationId) {
      throw new Error(
        `Stream processor ${processor.id} operation binding ${operation.identifier} is ambiguous.`,
      );
    }
    existing.operations.set(operationPath, operation);
    roots.set(root, existing);
  }
  for (const providerOperation of streamProcessorProviderRuntimeOperations(
    processor,
  )) {
    const providerBinding = providerOperation.binding;
    const segments = providerBinding.identifier.split('.');
    if (segments.some(
      (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
    )) {
      throw new Error(
        `Stream processor ${processor.id} provider binding ${providerBinding.identifier} must identify a callable operation through a serializable property path.`,
      );
    }
    const provider = graph.nodes.find(
      (node): node is ApplicationProviderNode =>
        node.kind === 'provider' && node.id === providerBinding.provider.nodeId,
    );
    if (!provider || provider.interface !== providerBinding.provider.interface) {
      throw new Error(
        `Stream processor ${processor.id} provider binding ${providerBinding.identifier} references missing provider ${providerBinding.provider.nodeId}.`,
      );
    }
    if (providerBinding.operation?.member.length === 0) {
      throw new Error(
        `Stream processor ${processor.id} provider binding ${providerBinding.identifier} has no stable provider member.`,
      );
    }
    const root = functionNativeCallbackBindingRoot(
      providerBinding.identifier,
      processor.id,
    );
    const existing = roots.get(root) ?? emptyRootBinding();
    const operationPath = segments.slice(1).join('.');
    if (segments.length === 1) {
      if (
        existing.model
        || existing.event
        || existing.operations.size > 0
        || existing.providerOperations.size > 0
        || (existing.providerRootOperation
          && existing.providerRootOperation !== providerOperation.variable)
      ) {
        throw new Error(
          `Stream processor ${processor.id} callback root ${root} is ambiguous between an extracted provider operation and another runtime binding.`,
        );
      }
      roots.set(root, {
        ...existing,
        providerRootOperation: generatedApplicationProviderOperationValue(
          providerBinding,
          providerOperation.variable,
        ),
      });
      continue;
    }
    if (
      existing.providerRootOperation
      || existing.event
      || existing.operations.has(operationPath)
    ) {
      throw new Error(
        `Stream processor ${processor.id} callback root ${root}.${operationPath} is ambiguous between provider and application runtime bindings.`,
      );
    }
    const previous = existing.providerOperations.get(operationPath);
    if (previous && previous !== providerOperation.variable) {
      throw new Error(
        `Stream processor ${processor.id} provider binding ${providerBinding.identifier} is ambiguous.`,
      );
    }
    existing.providerOperations.set(
      operationPath,
      generatedApplicationProviderOperationValue(
        providerBinding,
        providerOperation.variable,
      ),
    );
    roots.set(root, existing);
  }
  return `{ ${[...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, binding]) => {
      if (binding.providerRootOperation) {
        return `${JSON.stringify(root)}: ${binding.providerRootOperation}`;
      }
      if (binding.event) {
        return `${JSON.stringify(root)}: createApplicationFunctionNativeEventHandle(${JSON.stringify(`${binding.event.name}.${binding.event.version}`)}, { payload: schema(${JSON.stringify(binding.event.schema)}) })`;
      }
      const operationEntries = [...binding.operations.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, operation]) => ({
          path,
          value: `createApplicationFunctionNativeOperationHandle({ operation: ${JSON.stringify(operation.operation)}, command: { id: ${JSON.stringify(`${operation.command.contract.name}.${operation.command.contract.version}`)} }, key: (${operation.handler.key.source})${operation.handler.idempotencyKey ? `, idempotencyKey: (${operation.handler.idempotencyKey.source})` : ''} })`,
        }));
      const operationObject = nestedCallbackObjectSource(operationEntries);
      const providerOperationEntries = [...binding.providerOperations.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, value]) => ({ path, value }));
      const providerOperationObject = nestedCallbackObjectSource(
        providerOperationEntries,
      );
      const properties = [
        ...(binding.model
          ? [`...functionNativeModelHandle(${JSON.stringify(binding.model.name)})`]
          : []),
        ...(operationEntries.length > 0 ? [`...(${operationObject})`] : []),
        ...(providerOperationEntries.length > 0
          ? [`...(${providerOperationObject})`]
          : []),
      ];
      return `${JSON.stringify(root)}: Object.freeze({ ${properties.join(', ')} })`;
    })
    .join(', ')} }`;
}

function generatedStreamProcessorExecutionPrincipal(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  serviceIdentity: ApplicationIdentityReference | undefined,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): string {
  const service = serviceIdentity
    ? `serviceIdentity: ${JSON.stringify(serviceIdentity)},`
    : '';
  const actorAudiences = [...new Set(workloadAuthority.flatMap((envelope) => envelope.audiences))];
  const actorWorkloadIdentity = workloadAuthority[0]?.workloadIdentity;
  if (workloadAuthority.some((envelope) => envelope.workloadIdentity.id !== actorWorkloadIdentity?.id)) {
    throw new Error(`Generated stream processor ${processor.id} resolves multiple workload identities.`);
  }
  const workloadIdentity = actorWorkloadIdentity ?? {
    id: `identity:${graph.metadata.name}:workload:${processor.id}`,
    kind: 'workload',
    issuer: `applik8s://${graph.metadata.name}`,
    subject: processor.id,
  };
  const authoredContext = processor.invocation === 'batch'
    ? 'return Object.freeze({ ...context });'
    : 'return Object.freeze({ ...context, principal: processorExecutionPrincipal(context) });';
  return `
const processorAdmissionOperationId = ${JSON.stringify(`applik8s://processors/${encodeURIComponent(processor.id)}/operations/deliver`)};
let processorAdmissionObservationState;
let processorAdmissionObservationAt = 0;
async function observeProcessorAdmission(state, admission, error) {
  const observationTime = Date.now();
  if (state === processorAdmissionObservationState && observationTime - processorAdmissionObservationAt < 30_000) return;
  processorAdmissionObservationState = state;
  processorAdmissionObservationAt = observationTime;
  const evidence = createApplicationAdmissionObservationV1({
    state,
    boundary: 'delivery',
    ...(admission ? { admission } : { transport: 'broker' }),
    ...(error ? { rejectionCode: applicationAdmissionRejectionCodeV1(error) } : {}),
  });
  console.info(JSON.stringify({ event: 'applik8s-processor-admission', ...evidence }));
  const observedAt = new Date();
  try {
    await processorOperationAuthority.observe({
      id: ${JSON.stringify(`processor-admission:${processor.id}`)},
      domain: 'eventConsumer',
      subject: processorAdmissionOperationId,
      authority: 'canonical',
      state: state === 'admitted' ? 'ready' : 'failed',
      ...(evidence.rejectionCode ? { reason: evidence.rejectionCode } : {}),
      source: 'applik8s-processor-admission',
      evidence,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + 90_000).toISOString(),
    });
  } catch (observationError) {
    console.error(JSON.stringify({
      event: 'applik8s-processor-admission-observation-failed',
      error: applicationAdmissionRejectionCodeV1(observationError),
    }));
  }
}
async function processorAdmission(request) {
  try {
    const admission = await processorAdmissionUnchecked(request);
    await observeProcessorAdmission('admitted', admission);
    return admission;
  } catch (error) {
    await observeProcessorAdmission('rejected', undefined, error);
    throw error;
  }
}
async function processorAdmissionUnchecked({ envelope, attempt, signal }) {
  if (signal.aborted) throw Object.assign(new Error('Processor delivery was cancelled.'), { code: 'APPLIK8S_PROCESSOR_DELIVERY_CANCELLED' });
  const trustedContextDigest = envelope.contextDigest ?? envelope.principal?.trustedContextDigest;
  if (!trustedContextDigest) throw Object.assign(new Error('Processor delivery requires trusted context.'), { code: 'APPLIK8S_PROCESSOR_TRUSTED_CONTEXT_REQUIRED' });
  const workloadIdentity = Object.freeze(${JSON.stringify(workloadIdentity)});
  const causal = envelope.principal
    ? applicationCausalPrincipalContext(envelope.principal)
    : Object.freeze({ id: workloadIdentity.id, identity: workloadIdentity, grantIds: Object.freeze([]) });
  const executionId = ${JSON.stringify(processor.id)} + ':' + envelope.id;
  const deadline = new Date(Date.now() + ${processor.budgets.timeoutMs}).toISOString();
  const cancellationRevision = 'active:' + executionId;
  const principal = await processorOperationAuthority.admitExecutionPrincipal({
    executionKind: 'processor',
    executionId,
    attempt,
    workloadIdentity,
    ${service}
    causalPrincipalId: causal.id,
    causalPrincipal: causal.identity,
    causalGrantIds: causal.grantIds,
    envelopes: ${JSON.stringify(workloadAuthority)},
    trustedContextDigest,
    audience: ${JSON.stringify([...new Set([processor.id, ...actorAudiences])])},
    deadline,
    cancellationRevision,
    authenticationMethod: 'applik8s-postgres-stream-delivery/v1',
  });
  if (signal.aborted) throw Object.assign(new Error('Processor delivery was cancelled.'), { code: 'APPLIK8S_PROCESSOR_DELIVERY_CANCELLED' });
  const context = validateApplicationAdmissionContextV1WithoutReceipt(
    withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission: { principal, trustedContext: envelope.trustedContext ?? {} },
        operation: {
          id: processorAdmissionOperationId,
          transport: 'broker',
        },
        correlationId: envelope.id,
      }),
      {
        causationId: envelope.id,
        deadline,
        cancellation: { revision: cancellationRevision },
        delivery: {
          id: envelope.id,
          source: ${JSON.stringify(`stream:${processor.source.nodeId}`)},
        },
      },
    ),
  );
  return applicationAdmissionInvocationView(context);
}
function processorExecutionPrincipal(context) {
  const principal = context.admission?.principal;
  const sourceId = context.event?.id;
  const executionId = sourceId ? ${JSON.stringify(processor.id)} + ':' + sourceId : undefined;
  if (!principal || principal.kind !== 'execution'
    || principal.executionKind !== 'processor'
    || principal.executionId !== executionId
    || principal.attempt !== context.attempt) {
    throw new Error('applik8s-processor-execution-admission-required');
  }
  return principal;
}
function processorAuthoredContext(context) {
  ${authoredContext}
}`;
}

function generatedStreamProcessorQueries(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  bindings: readonly StreamProcessorQueryContract[],
  functionNative: boolean,
): string {
  if (bindings.length === 0) {
    return 'const processorQueries = () => Object.freeze({});';
  }
  if (processor.invocation === 'batch') {
    throw new Error(
      `Generated batch processor ${processor.id} calls application views, but one frozen batch has no single principal for query authorization. Move the read into a per-event handler or a durable workflow.`,
    );
  }
  const uniqueQueries = [...new Map(
    bindings.map((binding) => [binding.query.id, binding.query] as const),
  ).values()];
  const database = uniqueQueries[0]?.database;
  if (!database) {
    throw new Error(`Generated stream processor ${processor.id} has no relational query database.`);
  }
  const queryContracts = uniqueQueries.map((query) => {
    const id = query.publicId ?? `${query.name}.${query.version}`;
    const invocation = query.handlerInvocation === 'input-context'
      ? `${callbackVariable(query.id, 'run')}(input, Object.assign(relational, { principal }))`
      : `${callbackVariable(query.id, 'run')}({ context: relational, principal, input, database: processorQueryDatabaseBinding })`;
    return `${JSON.stringify(query.id)}: Object.freeze({
      id: ${JSON.stringify(id)},
      input: processorQuerySchema(${JSON.stringify(query.input.jsonSchema)}, ${JSON.stringify(`${id}.input`)}),
      output: processorQuerySchema(${JSON.stringify(query.output.jsonSchema)}, ${JSON.stringify(`${id}.output`)}),
      budgets: ${JSON.stringify(query.budgets)},
      authorize: ${callbackVariable(query.id, 'authorize')},
      run: (input, relational, principal) => withApplicationDatabaseRuntimeResolver((binding) => relational.database(binding), () => ${invocation}),
    })`;
  }).join(',\n');
  const callbackEntries = bindings.map((binding) => ({
    path: binding.identifier,
    value: `(input) => runProcessorQuery(${JSON.stringify(binding.query.id)}, input, context)`,
  }));
  return `
const processorQueryDatabaseBinding = ${databaseBindingSource(database)};
const processorQuerySql = postgres(requiredEnv(${JSON.stringify(database.connectionEnvName)}), { max: Math.max(2, processorConcurrency), idle_timeout: 20, connect_timeout: 10, prepare: false });
const processorQueryDb = drizzle(processorQuerySql);
const processorQueryContextSecret = requiredEnv('APPLIK8S_CONTEXT_SECRET');
function processorQuerySchema(json, name) {
  const normalized = normalizeQuerySchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json }, name);
  return value => {
    const result = normalized.validate(value);
    if (!result.ok) throw new Error('applik8s-processor-query-schema-invalid: ' + name + ': ' + result.error.message);
    return result.value;
  };
}
const processorQueryContracts = Object.freeze({ ${queryContracts} });
async function runProcessorQuery(id, rawInput, context) {
  const contract = processorQueryContracts[id];
  if (!contract) throw new Error('applik8s-processor-query-undeclared: ' + id);
  const input = contract.input(rawInput);
  const principal = processorExecutionPrincipal(context);
  const allowed = await contract.authorize({ principal, context: context.trustedContext, input });
  if (!allowed) throw new Error('applik8s-processor-query-denied: ' + contract.id);
  const activeDatabase = ${functionNative ? 'currentFunctionNativePostgresDatabase()' : 'undefined'};
  const runtimeDatabase = activeDatabase ?? processorQueryDb;
  const relational = createApplicationRelationalContext({
    databases: [{ binding: processorQueryDatabaseBinding, db: runtimeDatabase }],
    admittedContext: {
      values: { ...context.trustedContext, ...applicationCommandPrincipalValues(principal) },
      digestSecret: processorQueryContextSecret,
    },
  });
  let timeout;
  try {
    const result = await Promise.race([
      relational.run(processorQueryDatabaseBinding, () => contract.run(input, relational, principal)),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('applik8s-processor-query-timeout: ' + contract.id)), contract.budgets.timeoutMs); }),
    ]);
    const output = contract.output(result);
    if (Array.isArray(output) && output.length > contract.budgets.maxRows) throw new Error('applik8s-processor-query-row-limit: ' + contract.id);
    const bytes = Buffer.byteLength(JSON.stringify(output));
    if (bytes > contract.budgets.maxResultBytes) throw new Error('applik8s-processor-query-result-too-large: ' + contract.id);
    return output;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
function mergeProcessorBindings(...sources) {
  const output = {};
  const merge = (target, source, path = []) => {
    for (const [key, value] of Object.entries(source)) {
      const previous = target[key];
      if (previous === undefined) { target[key] = value; continue; }
      if (previous && value && typeof previous === 'object' && typeof value === 'object' && !Array.isArray(previous) && !Array.isArray(value)) {
        merge(previous, value, [...path, key]);
        continue;
      }
      if (previous !== value) throw new Error('Processor runtime binding collision at ' + [...path, key].join('.'));
    }
    return target;
  };
  for (const source of sources) merge(output, source);
  return Object.freeze(output);
}
function processorQueries(context) { return ${nestedCallbackObjectSource(callbackEntries)}; }
`;
}

function generatedStreamProcessorAuthoredHandlerInvocation(
  workflow: boolean,
  functionNativeBindings: boolean,
  transactionalFunctionNative: boolean,
  queries: boolean,
  actors: boolean,
): string {
  const bindings = functionNativeBindings
    ? 'functionNativeBindings'
    : 'Object.freeze({})';
  if (!workflow && !queries && !actors) {
    return `const handleAuthoredEvent = createHandleEvent(${bindings});
const invokeAuthoredHandler = (input, context) => handleAuthoredEvent(input, processorAuthoredContext(context));
${transactionalFunctionNative ? '' : 'const invokeHandler = invokeAuthoredHandler;'}`;
  }
  if (!workflow) {
    return `const invokeAuthoredHandler = (input, context) => { const authoredContext = processorAuthoredContext(context); return createHandleEvent(mergeProcessorBindings(${bindings}${queries ? ', processorQueries(authoredContext)' : ''}${actors ? ', processorActors(authoredContext)' : ''}))(input, authoredContext); };
${transactionalFunctionNative ? '' : 'const invokeHandler = invokeAuthoredHandler;'}`;
  }
  return `const invokeAuthoredHandler = (input, context) => {
  const authoredContext = processorAuthoredContext(context);
  const workflows = processorWorkflows(authoredContext);
  const handleEvent = createHandleEvent(mergeProcessorBindings(${bindings}${queries ? ', processorQueries(authoredContext)' : ''}${actors ? ', processorActors(authoredContext)' : ''}, workflows));
  return directWorkflowScope.run(
    directWorkflowRuntime(authoredContext),
    () => handleEvent(input, { ...authoredContext, schedules, workflows, tasks: workflows }),
  );
};
${transactionalFunctionNative ? '' : 'const invokeHandler = invokeAuthoredHandler;'}`;
}

function generatedStreamProcessorActors(
  processor: ApplicationStreamProcessorNode,
  mergeAlreadyDeclared: boolean,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): string {
  const bindings = processor.actorBindings ?? [];
  if (bindings.length === 0) return 'const processorActors = () => Object.freeze({});';
  const entries = bindings.map((binding) => {
    const actorId = binding.actor.nodeId.replace(/^actor\./u, '');
    const operationId = `applik8s://actors/${actorId}/operations/${binding.member}`;
    const authority = workloadAuthority.find((candidate) =>
      candidate.workloadIdentity.subject === processor.id
      && candidate.operationId === operationId);
    if (!authority) throw new Error(`Generated stream processor ${processor.id} actor ${binding.identifier} has no workload-authority envelope for ${operationId}.`);
    const audience = authority.audiences[0];
    if (!audience) throw new Error(`Generated stream processor ${processor.id} actor ${binding.identifier} has no workload-authority audience.`);
    return {
    path: binding.identifier,
    value: `(key, ...args) => {
      const alarm = ${JSON.stringify(binding.memberKind)} === 'alarm';
      const at = alarm ? args[0] : undefined;
      const input = alarm ? args[1] : args[0];
      const options = alarm ? args[2] : args[1];
      const ordinal = actorOrdinal++;
      const principal = processorExecutionPrincipal(context);
      return invokeApplicationActorBinding(
        ${JSON.stringify({
          actor: actorId,
          member: binding.member,
          memberKind: binding.memberKind,
        })},
        key,
        input,
        alarm ? { ...options, scheduledAt: at instanceof Date ? at.toISOString() : at } : options,
        {
          idempotencyKey: context.idempotencyKey + ':actor:' + ordinal + ':' + ${JSON.stringify(binding.member)},
          envelope: {
            principal,
            causalPrincipal: { id: principal.causalPrincipalId ?? principal.id },
            trustedContextDigest: principal.trustedContextDigest,
            transport: 'event',
            audience: ${JSON.stringify(audience)},
            workloadAuthorityId: ${JSON.stringify(authority.id)},
          },
        },
        context.signal,
      );
    }`,
  };
  });
  return `${mergeAlreadyDeclared ? '' : processorBindingMergeSource()}
${generatedApplicationActorInvocationClientSource()}
function processorActors(context) {
  let actorOrdinal = 0;
  return ${nestedCallbackObjectSource(entries)};
}`;
}

function processorBindingMergeSource(): string {
  return `function mergeProcessorBindings(...sources) {
  const output = {};
  const merge = (target, source, path = []) => {
    for (const [key, value] of Object.entries(source)) {
      const previous = target[key];
      if (previous === undefined) { target[key] = value; continue; }
      if (previous && value && typeof previous === 'object' && typeof value === 'object' && !Array.isArray(previous) && !Array.isArray(value)) {
        merge(previous, value, [...path, key]);
        continue;
      }
      if (previous !== value) throw new Error('Processor runtime binding collision at ' + [...path, key].join('.'));
    }
    return target;
  };
  for (const source of sources) merge(output, source);
  return Object.freeze(output);
}`;
}

function functionNativeModelRuntimeBindings(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
): readonly {
  readonly identifier: string;
  readonly model: ApplicationModelNode;
}[] {
  const transaction = processor.functionNativeTransaction;
  if (!transaction) return [];
  const nodes = graphNodes(graph);
  const bindings = new Map<string, ApplicationModelNode>();
  for (const binding of transaction.modelBindings) {
    const identifier = functionNativeCallbackBindingRoot(
      binding.identifier,
      processor.id,
    );
    const model = requiredNode(
      nodes,
      binding.model.nodeId,
      'model',
      processor.id,
    );
    const existing = bindings.get(identifier);
    if (existing && existing.id !== model.id) {
      throw new Error(
        `Function-native stream processor ${processor.id} callback identifier ${identifier} is ambiguous between ${existing.id} and ${model.id}.`,
      );
    }
    bindings.set(identifier, model);
  }
  return [...bindings.entries()]
    .map(([identifier, model]) => ({ identifier, model }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function functionNativeEventRuntimeBindings(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
): readonly {
  readonly identifier: string;
  readonly event: Extract<ApplicationGraph['nodes'][number], { readonly kind: 'event' }>;
}[] {
  const transaction = processor.functionNativeTransaction;
  if (!transaction) return [];
  const nodes = graphNodes(graph);
  const bindings = new Map<
    string,
    Extract<ApplicationGraph['nodes'][number], { readonly kind: 'event' }>
  >();
  const modelIdentifiers = new Set(
    functionNativeModelRuntimeBindings(graph, processor).map(
      (binding) => binding.identifier,
    ),
  );
  for (const binding of transaction.eventBindings ?? []) {
    const identifier = functionNativeCallbackBindingRoot(
      binding.identifier,
      processor.id,
    );
    if (modelIdentifiers.has(identifier)) {
      throw new Error(
        `Function-native stream processor ${processor.id} callback identifier ${identifier} cannot hydrate as both a model and an event.`,
      );
    }
    const event = requiredNode(
      nodes,
      binding.event.nodeId,
      'event',
      processor.id,
    );
    const existing = bindings.get(identifier);
    if (existing && existing.id !== event.id) {
      throw new Error(
        `Function-native stream processor ${processor.id} callback identifier ${identifier} is ambiguous between ${existing.id} and ${event.id}.`,
      );
    }
    bindings.set(identifier, event);
  }
  return [...bindings.entries()]
    .map(([identifier, event]) => ({ identifier, event }))
    .sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function functionNativeCallbackBindingRoot(
  identifier: string,
  owner: string,
): string {
  const root = identifier.split('.')[0]?.trim();
  if (!root || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) {
    throw new Error(
      `Function-native callback ${owner} binding ${JSON.stringify(identifier)} does not have a serializable root identifier.`,
    );
  }
  return root;
}

function generatedStreamProcessorSignalRuntime(
  graph: ApplicationGraph,
  processor: ApplicationStreamProcessorNode,
  stream: ApplicationStreamNode,
  operationCatalog: ApplicationOperationCatalog,
): {
  readonly declarations: string;
  readonly runtimeOption: string;
  readonly shutdown: string;
} {
  if (!stream.signal) {
    return { declarations: '', runtimeOption: '', shutdown: '' };
  }
  const input = signalInputSchema(
    stream as ApplicationStreamNode & {
      readonly signal: NonNullable<ApplicationStreamNode['signal']>;
    },
  );
  const actionOperations = Object.fromEntries(
    stream.signal.actions.map((action) => {
      const id = `applik8s://signals/${stream.signal?.id}/operations/${action.name}`;
      if (!operationCatalog.operations.some((operation) => operation.id === id)) {
        throw new Error(
          `Signal processor ${processor.id} action ${action.name} has no canonical operation.`,
        );
      }
      return [action.name, id];
    }),
  );
  return {
    declarations: `const signalSql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
const signalStore = createPostgresApplicationSignalStore({ sql: signalSql });
const signalDefinition = Object.freeze({
  kind: 'applicationSignalDefinition',
  id: ${JSON.stringify(stream.signal.id)},
  name: ${JSON.stringify(stream.signal.name)},
  version: ${JSON.stringify(stream.signal.version)},
  input: schema(${JSON.stringify(input)}),
  actions: Object.freeze(${JSON.stringify(Object.fromEntries(
    stream.signal.actions.map((action) => [
      action.name,
      {
        kind: 'jsonSchema',
        ref: {
          kind: 'jsonSchema',
          uri: `generated:${stream.signal?.id}.actions.${action.name}`,
        },
        schema: action.schema.jsonSchema,
      },
    ]),
  ))}),
});
const signalActionOperations = Object.freeze(${JSON.stringify(actionOperations)});
function signalGrantIds(signal) {
  if (signal.access.mode !== 'grant') return [];
  const subjects = Array.isArray(signal.access.subject)
    ? signal.access.subject
    : [signal.access.subject];
  return subjects.map((subject) =>
    'grant:signal:' + signal.id + ':' + subject.id);
}
async function revokeSignalGrants(signal, transaction) {
  for (const grantId of signalGrantIds(signal)) {
    await processorOperationAuthority.revokeGrant(
      grantId,
      'Signal ' + signal.id + ' reached terminal state.',
      transaction,
    );
  }
}
const decodeSignalIssuance = createApplicationSignalIssuanceDecoder({
  store: signalStore,
  definition: signalDefinition,
  admit: async (issuance, context) => {
    const executionPrincipal = context.admission.principal;
    const durablePrincipal = context.principal;
    if (executionPrincipal.kind !== 'execution'
      || executionPrincipal.executionKind !== 'processor'
      || !durablePrincipal
      || executionPrincipal.causalPrincipalId !== durablePrincipal.id
      || executionPrincipal.causalPrincipal?.id !== durablePrincipal.identity.id) {
      throw new Error('APPLIK8S_SIGNAL_EXECUTION_IDENTITY_REQUIRED');
    }
    const actor = {
      id: durablePrincipal.identity.id,
      ...(durablePrincipal.roles ? { roles: durablePrincipal.roles } : {}),
      ...(durablePrincipal.attributes ? { attributes: durablePrincipal.attributes } : {}),
    };
    return {
      actor,
      authorizeAction: async ({ signal, action, input, transaction }) => {
        if (!applicationSignalAccessAllows(signal, actor)) {
          throw new Error('APPLIK8S_SIGNAL_SUBJECT_DENIED');
        }
        const operationId = signalActionOperations[action];
        if (!operationId) throw new Error('APPLIK8S_SIGNAL_ACTION_UNDECLARED');
        const authorize = () => processorOperationAuthority.authorize({
            principal: durablePrincipal,
            operationId,
            target: {
              kind: 'target',
              model: signal.contract.id,
              identity: { ...signal.target, signalId: signal.id },
            },
            audience: ${JSON.stringify(processor.id)},
            transport: 'event',
            inputDigest: applicationOperationInputDigest(input),
            trustedContextDigest: context.admission.trustedContext.digest,
          });
        const result = transaction
          ? await processorOperationAuthority.withinTransaction(transaction, authorize)
          : await authorize();
        if (!result.allowed) throw new Error(result.code + ': ' + result.message);
        return { id: result.receipt.id };
      },
      finalizeAction: async ({ signal, terminal }, { transaction }) => {
        await revokeSignalGrants(signal, transaction);
        await processorOperationAuthority.observe({
          id: 'signal:' + signal.id,
          domain: 'workflow',
          subject: signal.contract.id,
          authority: 'canonical',
          state: terminal.status === 'resolved' ? 'succeeded' : 'cancelled',
          reason: terminal.status === 'resolved' ? terminal.action : 'expired',
          source: 'application-signal-runtime',
          causalId: signal.id,
          evidence: {
            signalId: signal.id,
            contractId: signal.contract.id,
            terminalStatus: terminal.status,
            ...(terminal.status === 'resolved' ? { action: terminal.action } : {}),
          },
          observedAt: terminal.status === 'resolved' ? terminal.decidedAt : terminal.expiredAt,
        }, transaction);
      },
    };
  },
});`,
    runtimeOption: 'decodePayload: decodeSignalIssuance, ',
    shutdown: ', signalStore.close(), signalSql.end({ timeout: 5 })',
  };
}

async function writeStreamHandlerModule(
  directory: string,
  processor: ApplicationStreamProcessorNode,
  operations: readonly StreamProcessorOperationContract[],
  queries: readonly StreamProcessorQueryContract[],
): Promise<void> {
  const identifiers = [
    ...(processor.tasks ?? []).map((binding) => binding.alias),
    ...(processor.functionNativeTransaction?.modelBindings ?? []).map(
      (binding) => binding.identifier,
    ),
    ...(processor.functionNativeTransaction?.eventBindings ?? []).map(
      (binding) => binding.identifier,
    ),
    ...(processor.operationBindings ?? []).map(
      (binding) => binding.identifier,
    ),
    ...queries.map((binding) => binding.identifier),
    ...(processor.callableBindings ?? []).map(
      (binding) => binding.identifier,
    ),
    ...(processor.providerBindings ?? []).map(
      (binding) => binding.identifier,
    ),
  ]
    .map((identifier) => identifier.split('.')[0] ?? identifier)
    .filter(
      (identifier, index, values) =>
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
        && values.indexOf(identifier) === index,
    );
  await Promise.all([
    writeFile(
      join(directory, 'handle.generated.ts'),
      generatedCallbackFactoryModule({
        source: processor.handlerSource,
        ...(processor.handlerDependencies
          ? { dependencies: processor.handlerDependencies }
          : {}),
        injectedIdentifiers: identifiers,
        exportName: 'createCallback',
      }),
    ),
    ...operations.flatMap(({ handler }) => {
      if (!handler.beforeCommit) return [];
      const suffix = createHash('sha256').update(handler.id).digest('hex').slice(0, 12);
      const beforeCommitIdentifiers = [
        ...(handler.transaction.modelBindings ?? []).map(({ identifier }) => identifier),
        ...(handler.eventBindings ?? []).map(({ identifier }) => identifier),
        ...(handler.commandBindings ?? []).map(({ identifier }) => identifier),
      ]
        .map((identifier) => identifier.split('.')[0] ?? identifier)
        .filter(
          (identifier, index, values) =>
            /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
            && values.indexOf(identifier) === index,
        );
      return [
        writeFile(
          join(directory, `nested-before-commit-${suffix}.generated.ts`),
          generatedCallbackFactoryModule({
            source: handler.beforeCommit.source,
            ...(handler.beforeCommit.dependencies
              ? { dependencies: handler.beforeCommit.dependencies }
              : {}),
            injectedIdentifiers: beforeCommitIdentifiers,
            exportName: 'createCallback',
          }),
        ),
      ];
    }),
  ]);
}

async function writeCallbackModule(directory: string, name: string, source: string, dependencies?: ApplicationHandlerDependencies): Promise<void> {
  const dependencySource = dependencies?.source ? absoluteDependencyImports(dependencies.source, dependencies.resolveDir) : '';
  await writeFile(join(directory, `${name}.generated.ts`), `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`);
}

async function writeProfiledCallbackModule(
  directory: string,
  name: string,
  profile: ApplicationProfiledCallbackContract,
): Promise<void> {
  const entries = Object.entries(profile.cases);
  const modules = entries.map(([variant, callback]) => {
    const suffix = createHash('sha256').update(variant).digest('hex').slice(0, 12);
    return {
      variant,
      callback,
      moduleName: `${name}-profile-${suffix}`,
      variable: `profile_${suffix}`,
    };
  });
  await Promise.all([
    ...modules.map((entry) =>
      writeCallbackModule(
        directory,
        entry.moduleName,
        entry.callback.source,
        entry.callback.dependencies,
      ),
    ),
    writeCallbackModule(
      directory,
      `${name}-profile-default`,
      profile.default.source,
      profile.default.dependencies,
    ),
  ]);
  const imports = [
    ...modules.map(
      (entry) =>
        `import { callback as ${entry.variable} } from './${entry.moduleName}.generated.js';`,
    ),
    `import { callback as profile_default } from './${name}-profile-default.generated.js';`,
  ].join('\n');
  const cases = modules
    .map(
      (entry) => `${JSON.stringify(entry.variant)}: ${entry.variable}`,
    )
    .join(',\n');
  await writeFile(
    join(directory, `${name}.generated.ts`),
    `${imports}

const callbacks = {
${cases}
};

export const callback = (...args) => {
  const variant = process.env.APPLIK8S_PROFILE_VARIANT;
  if (!variant) {
    throw new Error('Missing required environment variable APPLIK8S_PROFILE_VARIANT.');
  }
  return (callbacks[variant] ?? profile_default)(...args);
};
`,
  );
}

function assertGatewayCallbackResolved(
  gatewayId: string,
  label: string,
  profile: ApplicationProfiledCallbackContract | undefined,
  unresolved: readonly string[] | undefined,
): void {
  assertResolved(gatewayId, label, unresolved);
  if (!profile) return;
  for (const [variant, callback] of [
    ...Object.entries(profile.cases),
    ['default', profile.default] as const,
  ]) {
    assertResolved(
      gatewayId,
      `${label} profile ${variant}`,
      callback.unresolved,
    );
  }
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
      edits.push({
        start: statement.getFullStart(),
        end: statement.getEnd(),
        replacement: focusedQueryRuntimeImport(statement),
      });
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
    if (/\.database\.(?:postgres|bind)$/.test(callee)) {
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
  const focused = rewritten.trim();
  return focused.includes('applicationDatabaseHandle(')
    ? `import { applicationDatabaseHandle } from '@applik8s/applik8s/query-runtime';\n${focused}`
    : focused;
}

/**
 * Author callbacks may import the cohesive public surface while generated
 * query workers must avoid evaluating its application-authoring exports. Keep
 * type-only imports (which erase during bundling) and lower the small set of
 * admitted runtime helpers to their focused implementation package.
 */
function focusedQueryRuntimeImport(
  statement: ts.ImportDeclaration,
): string {
  if (
    !ts.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== '@applik8s/applik8s'
  ) return '';
  const clause = statement.importClause;
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return '';
  }
  const typeImports: string[] = [];
  const focusedImports = new Map<string, string[]>();
  const runtimeModules = new Map<string, string>([
    ['applicationCausalPrincipalContext', '@applik8s/core'],
  ]);
  for (const element of clause.namedBindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    const binding = element.propertyName
      ? `${element.propertyName.text} as ${element.name.text}`
      : element.name.text;
    if (clause.isTypeOnly || element.isTypeOnly) {
      typeImports.push(binding);
      continue;
    }
    const runtimeModule = runtimeModules.get(imported);
    if (!runtimeModule) continue;
    const bindings = focusedImports.get(runtimeModule) ?? [];
    bindings.push(binding);
    focusedImports.set(runtimeModule, bindings);
  }
  return [
    ...(typeImports.length > 0
      ? [`import type { ${typeImports.join(', ')} } from ${JSON.stringify(statement.moduleSpecifier.text)};`]
      : []),
    ...[...focusedImports.entries()].map(
      ([specifier, bindings]) =>
        `import { ${bindings.join(', ')} } from ${JSON.stringify(specifier)};`,
    ),
  ].join('\n');
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
      if (
        !/\.database\.(?:postgres|bind)$/.test(
          declaration.initializer.expression.getText(file),
        )
      ) {
        continue;
      }
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
  return `applicationDatabaseHandle({ kind: 'applicationDatabase', name: ${JSON.stringify(database.name)}, provider: { kind: 'postgres' }, schema: {} })`;
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
  const volumes = consolidatedReactivePodVolumes(artifacts);
  const containers = artifacts.map((artifact, index) => {
    const original = reactiveArtifactContainer(artifact);
    const portName = `http-${index}`;
    return {
      ...original,
      name: kubernetesContainerName(artifact.name),
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
      name: kubernetesContainerName(artifact.name),
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

function reactiveResources(options: BundleReactiveOptions, image: string, digest: string): GeneratedApplicationReactiveResource[] {
  const component = options.kind === 'queryGateway'
    ? 'query-gateway'
    : options.kind === 'scheduleControlWorker'
      ? 'schedule-control'
    : options.kind === 'projectionWorker'
      ? 'projection-worker'
      : options.kind === 'searchProjectionWorker'
        ? 'search-projection-worker'
        : 'stream-processor';
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
  const strategy = options.kind === 'queryGateway' || options.kind === 'scheduleControlWorker'
    ? { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } }
    : { type: 'Recreate' };
  const permissions = options.permissions ?? [];
  const certificates = uniqueCaCertificates(options.caCertificates ?? []);
  if (certificates.length > 1) {
    throw new Error(
      `Generated reactive artifact ${options.name} currently supports one trust bundle; project multiple authorities into one Secret before compilation.`,
    );
  }
  const certificate = certificates[0];
  const caVolumeName = certificate
    ? `search-ca-${createHash('sha256').update(`${certificate.name}/${certificate.key}`).digest('hex').slice(0, 8)}`
    : undefined;
  const volumeMounts = [
    ...(options.workflowToken
      ? [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }]
      : []),
    ...(options.serviceAccountToken
      ? [{
          name: options.serviceAccountToken.name,
          mountPath: options.serviceAccountToken.mountPath,
          readOnly: true,
        }]
      : []),
    ...(certificate && caVolumeName
      ? [{ name: caVolumeName, mountPath: '/var/run/secrets/applik8s/search-ca', readOnly: true }]
      : []),
  ];
  const volumes = [
    ...(options.workflowToken
      ? [{ name: 'workflow-token', secret: { secretName: options.workflowToken.secretName, items: [{ key: options.workflowToken.key, path: 'token' }] } }]
      : []),
    ...(options.serviceAccountToken
      ? [{
          name: options.serviceAccountToken.name,
          projected: {
            defaultMode: 0o400,
            sources: [{
              serviceAccountToken: {
                path: options.serviceAccountToken.path,
                audience: options.serviceAccountToken.audience,
                expirationSeconds: options.serviceAccountToken.expirationSeconds ?? 3_600,
              },
            }],
          },
        }]
      : []),
    ...(certificate && caVolumeName
      ? [{
          name: caVolumeName,
          secret: {
            secretName: certificate.name,
            optional: true,
            items: [{ key: certificate.key, path: 'ca.crt' }],
          },
        }]
      : []),
  ];
  const environment = [
    ...options.env,
    ...(certificate
      ? [{
          name: 'NODE_EXTRA_CA_CERTS',
          value: '/var/run/secrets/applik8s/search-ca/ca.crt',
        }]
      : []),
  ];
  const ownsServiceAccount = permissions.length > 0 || Boolean(options.serviceAccountToken);
  const resources: GeneratedApplicationReactiveResource[] = [
    ...(ownsServiceAccount ? [{ apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(options.name) }] : []),
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: metadata(options.name), spec: { replicas: options.replicas, selector: { matchLabels: labels }, strategy, template: { metadata: { labels, annotations: { 'applik8s.dev/digest': digest } }, spec: { ...(ownsServiceAccount ? { serviceAccountName: options.name } : {}), terminationGracePeriodSeconds: 30, containers: [{ name: 'runtime', image, imagePullPolicy: 'IfNotPresent', command: ['node', '/app/runtime.mjs'], env: environment, ...(volumeMounts.length > 0 ? { volumeMounts } : {}), ports: [{ name: 'http', containerPort: options.port }], readinessProbe: { httpGet: { path: '/ready', port: 'http' }, periodSeconds: 5, failureThreshold: 6 }, livenessProbe: { httpGet: { path: '/live', port: 'http' }, periodSeconds: 10, failureThreshold: 6 }, resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } } }], ...(volumes.length > 0 ? { volumes } : {}) } } } },
    { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(options.name), spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress'], ingress: [{ ports: [{ protocol: 'TCP', port: options.port }] }] } },
  ];
  resources.push(...gatewayKubernetesRbacResources(options, permissions, labels));
  if (options.kind === 'queryGateway' || options.kind === 'scheduleControlWorker') resources.push({ apiVersion: 'v1', kind: 'Service', metadata: metadata(options.name), spec: { selector: labels, ports: [{ name: 'http', port: options.port, targetPort: 'http' }] } });
  if (typeof options.replicas === 'number' && options.replicas > 1) resources.push({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: metadata(options.name), spec: { minAvailable: 1, selector: { matchLabels: labels } } });
  if (typeof options.replicas === 'string') resources.push({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: metadata(options.name), spec: { maxUnavailable: reactiveMaxUnavailable(options.replicas), selector: { matchLabels: labels } } });
  return resources;
}

function uniqueCaCertificates(
  certificates: readonly ReactiveCaCertificate[],
): readonly ReactiveCaCertificate[] {
  const values = new Map<string, ReactiveCaCertificate>();
  for (const certificate of certificates) {
    values.set(`${certificate.name}/${certificate.key}`, certificate);
  }
  return [...values.values()].sort((left, right) =>
    `${left.name}/${left.key}`.localeCompare(`${right.name}/${right.key}`));
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
    const rule = grouped.get(key) ?? { apiGroups: [permission.apiGroup], resources: [], verbs: [] };
    if (!rule.resources.includes(permission.resource)) rule.resources.push(permission.resource);
    for (const verb of permission.verbs ?? ['get', 'list', 'watch']) {
      if (!rule.verbs.includes(verb)) rule.verbs.push(verb);
    }
    grouped.set(key, rule);
  }
  return [...grouped.values()].map((rule) => ({
    ...rule,
    resources: rule.resources.sort(),
    verbs: rule.verbs.sort(),
  }));
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
  const profileSelector = applicationGatewayProfileSelector(gateway, graph);
  const onlineProviders = queries.flatMap((query) => query.projection?.storage === 'online' ? [gatewayOnlineProjectionContract(graph, query)] : []);
  const analyticalProviders = queries.flatMap((query) => query.projection?.storage === 'analytical' ? [gatewayAnalyticalProjectionContract(graph, query)] : []);
  const searchProviders = queries.flatMap((query) =>
    query.search ? [gatewaySearchContract(graph, query)] : []);
  return uniqueEnvironment([
    { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: gateway.cursorSecret.name, key: gateway.cursorSecret.key } } },
    {
      name: 'APPLIK8S_CONTEXT_SECRET',
      valueFrom: {
        secretKeyRef: {
          name: `${kubernetesName(graph.metadata.name)}-context`,
          key: 'key',
        },
      },
    },
    ...(profileSelector
      ? [{ name: 'APPLIK8S_PROFILE_VARIANT', value: profileSelector }]
      : []),
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
    { name: 'APPLIK8S_APPLICATION_NAME', value: graph.metadata.name },
    { name: 'APPLIK8S_NAMESPACE', value: applicationGraphStringValue(gateway.deployment?.namespace) ?? 'default' },
    ...queries.flatMap((query) => query.kubernetes?.namespace && serializedInstallationExpression(query.kubernetes.namespace)
      ? [{ name: kubernetesQueryNamespaceEnvironmentName(query.id), value: query.kubernetes.namespace }]
      : []),
    ...uniqueDatabaseRuntimes(queries.map((query) => query.database).filter((database): database is ApplicationReactiveDatabaseRuntimeContract => Boolean(database))).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueCommandDatabases(commands).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...uniqueDatabaseRuntimes(subscriptions.map(({ stream }) => stream.database)).map((database) => ({ name: database.connectionEnvName, valueFrom: { secretKeyRef: { name: database.secretName, key: database.secretKey } } })),
    ...onlineProviders.flatMap((contract) => gatewayOnlineProjectionEnvironment(contract)),
    ...analyticalProviders.flatMap((contract) => gatewayAnalyticalProjectionEnvironment(contract)),
    ...searchProviders.flatMap((contract) =>
      searchProviderCredentialEnvironment(contract, gateway.deployment?.namespace ?? 'default')),
    ...eventLogEnvironment(eventLog),
  ]);
}

function applicationGatewayProfileSelector(
  gateway: ApplicationGatewayNode,
  graph?: ApplicationGraph,
): string | undefined {
  const selectors = [
    gateway.authenticationProfile?.selector,
    gateway.identityReadinessProfile?.selector,
    ...(graph
      ? gateway.queries.flatMap((reference) => {
          const query = graphNodes(graph).get(reference.nodeId);
          if (query?.kind !== 'query' || !query.search) return [];
          const selection = objectConfig(
            gatewaySearchContract(graph, query).providerConfig,
          );
          return selection.kind === 'application-provider-selection'
            && typeof selection.selector === 'string'
            ? [selection.selector]
            : [];
        })
      : []),
  ].filter((selector): selector is string => Boolean(selector));
  if (selectors.length === 0) return undefined;
  if (!selectors.every((selector) => selector === selectors[0])) {
    throw new Error(
      `Generated application gateway ${gateway.id} has incompatible profiled identity selectors.`,
    );
  }
  const selector = selectors[0]!;
  const match = /^schema\.spec\.([A-Za-z_][A-Za-z0-9_.]*)$/u.exec(selector);
  if (!match?.[1]) {
    throw new Error(
      `Generated application gateway ${gateway.id} identity selector ${JSON.stringify(selector)} cannot be lowered to a workload profile binding.`,
    );
  }
  return `\${schema.spec.${match[1]}}`;
}

function searchProjectionEnvironment(
  work: SearchProjectionWorkItem,
): readonly Record<string, unknown>[] {
  const database = work.contract.query.database;
  if (!database) return [];
  return uniqueEnvironment([
    {
      name: 'APPLIK8S_CURSOR_SECRET',
      valueFrom: {
        secretKeyRef: {
          name: work.cursorSecret.name,
          key: work.cursorSecret.key,
        },
      },
    },
    {
      name: database.connectionEnvName,
      valueFrom: {
        secretKeyRef: {
          name: database.secretName,
          key: database.secretKey,
        },
      },
    },
    ...(work.profileSelector
      ? [{ name: 'APPLIK8S_PROFILE_VARIANT', value: work.profileSelector }]
      : []),
    ...searchProviderCredentialEnvironment(
      work.contract,
      work.namespace,
    ),
  ]);
}

function gatewaySearchCaCertificates(
  graph: ApplicationGraph,
  queries: readonly ApplicationQueryNode[],
  workloadNamespace: string,
): readonly ReactiveCaCertificate[] {
  return uniqueCaCertificates(
    queries.flatMap((query) =>
      query.search
        ? searchCaCertificates(
            gatewaySearchContract(graph, query),
            workloadNamespace,
          )
        : []),
  );
}

function searchCaCertificates(
  contract: GatewaySearchContract,
  workloadNamespace: string,
): readonly ReactiveCaCertificate[] {
  const reference = selectedSearchCaReference(
    contract.providerConfig,
    contract.index.search.logicalIdentity.name,
  );
  if (!reference) return [];
  if (
    reference.namespace
    && applicationGraphStringValue(reference.namespace)
      !== applicationGraphStringValue(workloadNamespace)
  ) {
    throw new Error(
      `Generated search ${contract.query.id} cannot mount OpenSearch CA Secret ${reference.name} from namespace ${reference.namespace}; project trust into the workload namespace.`,
    );
  }
  return [{ name: reference.name, key: reference.key }];
}

function searchProviderCredentialEnvironment(
  contract: GatewaySearchContract,
  workloadNamespace: string,
): readonly Record<string, unknown>[] {
  const digest = createHash('sha256')
    .update(contract.query.id)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  const reference = selectedSearchCredentialReference(
    contract.providerConfig,
    contract.index.search.logicalIdentity.name,
  );
  if (!reference) return [];
  if (
    reference.namespace
    && applicationGraphStringValue(reference.namespace) !== applicationGraphStringValue(workloadNamespace)
  ) {
    throw new Error(
      `Generated search ${contract.query.id} cannot mount OpenSearch credential Secret ${reference.name} from namespace ${reference.namespace}; deploy the gateway/worker there or project an application-owned Secret.`,
    );
  }
  return [
    {
      name: `APPLIK8S_SEARCH_USERNAME_${digest}`,
      valueFrom: {
        secretKeyRef: {
          name: reference.name,
          key: 'username',
          optional: true,
        },
      },
    },
    {
      name: `APPLIK8S_SEARCH_PASSWORD_${digest}`,
      valueFrom: {
        secretKeyRef: {
          name: reference.name,
          key: 'password',
          optional: true,
        },
      },
    },
  ];
}

function selectedSearchCaReference(
  configuration: Readonly<Record<string, unknown>>,
  fallbackName: string,
): { readonly name: string; readonly key: string; readonly namespace?: string } | undefined {
  if (configuration.kind !== 'application-provider-selection') {
    return searchCaReference(configuration, fallbackName);
  }
  const selector = typeof configuration.selector === 'string'
    ? configuration.selector
    : undefined;
  const cases = objectConfig(configuration.cases);
  const fallback = objectConfig(configuration.default);
  if (!selector) {
    throw new Error('Profiled Search provider is missing its selector.');
  }
  const branches = Object.entries(cases).map(([variant, value]) => [
    variant,
    searchCaReference(objectConfig(value), fallbackName),
  ] as const);
  const fallbackReference = searchCaReference(fallback, fallbackName);
  const references = [
    ...branches.map(([, reference]) => reference),
    fallbackReference,
  ].filter((reference): reference is { readonly name: string; readonly key: string; readonly namespace?: string } => Boolean(reference));
  if (references.length === 0) return undefined;
  const fallbackSecret = fallbackReference?.name ?? 'applik8s-search-ca-unused';
  const nameExpression = branches.reduceRight(
    (otherwise, [variant, reference]) =>
      `${selector} == ${JSON.stringify(variant)} ? ${installationCelStringOperand(reference?.name ?? 'applik8s-search-ca-unused')} : (${otherwise})`,
    installationCelStringOperand(fallbackSecret),
  );
  const keys = new Set(references.map((reference) => reference.key));
  const namespaces = new Set(
    references.map((reference) => reference.namespace).filter(Boolean),
  );
  if (keys.size > 1 || namespaces.size > 1) {
    throw new Error(
      'Profiled Search CA Secrets must use one key and be projected into one workload namespace.',
    );
  }
  return {
    name: `\${${nameExpression}}`,
    key: [...keys][0] ?? 'ca.crt',
    ...([...namespaces][0] ? { namespace: [...namespaces][0] } : {}),
  };
}

function searchCaReference(
  configuration: Readonly<Record<string, unknown>>,
  fallbackName: string,
): { readonly name: string; readonly key: string; readonly namespace?: string } | undefined {
  if (configuration.kind !== 'opensearch') return undefined;
  const tls = objectConfig(configuration.tls);
  const source = stringConfig(tls.source)
    || (configuration.provision === false ? undefined : 'generated');
  if (!source) return undefined;
  const name = source === 'generated'
    ? `${stringConfig(configuration.name) || fallbackName}-http-cert`
    : stringConfig(tls.secretName);
  if (!name) {
    throw new Error(
      `OpenSearch ${source} TLS requires a concrete CA-bearing Secret.`,
    );
  }
  const namespace = stringConfig(configuration.namespace);
  return {
    name,
    key: 'ca.crt',
    ...(namespace ? { namespace } : {}),
  };
}

function selectedSearchCredentialReference(
  configuration: Readonly<Record<string, unknown>>,
  fallbackName: string,
): { readonly name: string; readonly namespace?: string } | undefined {
  if (configuration.kind !== 'application-provider-selection') {
    return searchCredentialReference(configuration, fallbackName);
  }
  const selector = typeof configuration.selector === 'string'
    ? configuration.selector
    : undefined;
  const cases = objectConfig(configuration.cases);
  const fallback = objectConfig(configuration.default);
  if (!selector) {
    throw new Error('Profiled Search provider is missing its selector.');
  }
  const branches = Object.entries(cases).map(([variant, value]) => [
    variant,
    searchCredentialReference(objectConfig(value), fallbackName),
  ] as const);
  const fallbackReference = searchCredentialReference(fallback, fallbackName);
  const references = [
    ...branches.map(([, reference]) => reference),
    fallbackReference,
  ].filter((reference): reference is { readonly name: string; readonly namespace?: string } => Boolean(reference));
  if (references.length === 0) return undefined;
  const fallbackSecret = fallbackReference?.name ?? 'applik8s-search-credentials-unused';
  const nameExpression = branches.reduceRight(
    (otherwise, [variant, reference]) =>
      `${selector} == ${JSON.stringify(variant)} ? ${installationCelStringOperand(reference?.name ?? 'applik8s-search-credentials-unused')} : (${otherwise})`,
    installationCelStringOperand(fallbackSecret),
  );
  const namespaces = new Set(
    references.map((reference) => reference.namespace).filter(Boolean),
  );
  if (namespaces.size > 1) {
    throw new Error(
      'Profiled Search credential Secrets must be projected into one workload namespace.',
    );
  }
  return {
    name: `\${${nameExpression}}`,
    ...([...namespaces][0] ? { namespace: [...namespaces][0] } : {}),
  };
}

function searchCredentialReference(
  configuration: Readonly<Record<string, unknown>>,
  fallbackName: string,
): { readonly name: string; readonly namespace?: string } | undefined {
  if (configuration.kind !== 'opensearch') return undefined;
  const explicit = objectConfig(configuration.adminCredentialsSecret);
  const name = stringConfig(explicit.name)
    || (configuration.provision === false
      ? undefined
      : `${stringConfig(configuration.name) || fallbackName}-admin-password`);
  if (!name) return undefined;
  const namespace = stringConfig(explicit.namespace)
    || stringConfig(configuration.namespace);
  return { name, ...(namespace ? { namespace } : {}) };
}

function kubernetesQueryNamespaceEnvironmentName(queryId: string): string {
  return `APPLIK8S_KUBERNETES_QUERY_${createHash('sha256').update(queryId).digest('hex').slice(0, 12).toUpperCase()}_NAMESPACE`;
}

function serializedInstallationExpression(value: string): boolean {
  return value.startsWith('${') && value.endsWith('}');
}

function installationCelStringOperand(value: string): string {
  return serializedInstallationExpression(value)
    ? `(${value.slice(2, -1)})`
    : JSON.stringify(value);
}

function projectionEnvironment(stream: ApplicationStreamNode, config: Readonly<Record<string, unknown>>): readonly Record<string, unknown>[] {
  const credentials = objectConfig(config.credentialsSecret);
  const credentialName = stringConfig(credentials.name);
  const optionalCredentials = credentials.optional === true;
  return [
    { name: stream.database.connectionEnvName, valueFrom: { secretKeyRef: { name: stream.database.secretName, key: stream.database.secretKey } } },
    { name: 'APPLIK8S_CLICKHOUSE_ENDPOINT', value: clickHouseEndpoint(config) },
    { name: 'APPLIK8S_CLICKHOUSE_DATABASE', value: applicationGraphStringValue(config.database) || 'default' },
    ...(credentialName ? [
      { name: 'APPLIK8S_CLICKHOUSE_USERNAME', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.usernameKey) || 'username', ...(optionalCredentials ? { optional: true } : {}) } } },
      { name: 'APPLIK8S_CLICKHOUSE_PASSWORD', valueFrom: { secretKeyRef: { name: credentialName, key: stringConfig(config.passwordKey) || 'password', ...(optionalCredentials ? { optional: true } : {}) } } },
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
  const optionalCredentials = credentials.optional === true;
  const enabled = applicationGraphBooleanCondition(contract.config.enabled);
  const enabledValue = enabled?.startsWith('${') && enabled.endsWith('}')
    ? `\${string(${enabled.slice(2, -1)})}`
    : enabled ?? 'true';
  return [
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'ENDPOINT'), value: clickHouseEndpoint(contract.config) },
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'DATABASE'), value: applicationGraphStringValue(contract.config.database) || 'default' },
    { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'ENABLED'), value: enabledValue },
    ...(name ? [
      { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'USERNAME'), valueFrom: { secretKeyRef: { name, key: stringConfig(contract.config.usernameKey) || 'username', ...(optionalCredentials ? { optional: true } : {}) } } },
      { name: clickHouseGatewayEnvironmentName(contract.provider.id, 'PASSWORD'), valueFrom: { secretKeyRef: { name, key: stringConfig(contract.config.passwordKey) || 'password', ...(optionalCredentials ? { optional: true } : {}) } } },
    ] : []),
  ];
}

function databaseBindingSource(database: ApplicationReactiveDatabaseRuntimeContract): string {
  const access = database.access ? `{ kind: 'postgresRls', context: { kind: 'applicationTrustedContext', name: ${JSON.stringify(database.access.context)}, schema: schema(${JSON.stringify(database.access.contextSchema)}, ${JSON.stringify(database.access.context)}), contract: { source: 'identity-provider', trust: 'server-admitted', jsonSchema: ${JSON.stringify(database.access.contextSchema)} } }, column: ${JSON.stringify(database.access.column)}, default: ${JSON.stringify(database.access.default ?? 'required')}, setting: ${JSON.stringify(database.access.setting)} }` : 'undefined';
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
function assertResourceNamespace(resourceNamespace: unknown, workloadNamespace: unknown, owner: string): void {
  const resource = applicationGraphStringValue(resourceNamespace);
  const workload = applicationGraphStringValue(workloadNamespace);
  if (!resource || !workload || resource === workload) return;
  const possible = serializedInstallationLiteralResults(resource);
  if (possible && possible.every((candidate) => candidate === null || candidate === workload)) return;
  throw new Error(`${owner} is in namespace ${resource}, but its generated workload is in ${workload}. Kubernetes cannot mount cross-namespace Secrets.`);
}

/**
 * Proves the result set of the narrow conditional form emitted by profiled
 * provider selection. Conditions are deliberately ignored; only terminal
 * JSON-string/null branches are admitted. Any reference, function, malformed
 * expression, or other value fails closed at the mount boundary.
 */
function serializedInstallationLiteralResults(value: string): readonly (string | null)[] | undefined {
  if (!serializedInstallationExpression(value)) return undefined;
  return conditionalLiteralResults(value.slice(2, -1).trim());
}

function conditionalLiteralResults(source: string): readonly (string | null)[] | undefined {
  const expression = stripBalancedParentheses(source);
  const conditional = topLevelConditional(expression);
  if (conditional) {
    const consequent = conditionalLiteralResults(conditional.consequent);
    const alternate = conditionalLiteralResults(conditional.alternate);
    return consequent && alternate ? [...consequent, ...alternate] : undefined;
  }
  if (expression === 'null') return [null];
  if (expression.startsWith('"') && expression.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(expression);
      return typeof parsed === 'string' ? [parsed] : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function stripBalancedParentheses(source: string): string {
  let result = source.trim();
  while (result.startsWith('(') && result.endsWith(')') && matchingClosingParenthesis(result, 0) === result.length - 1) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function topLevelConditional(source: string): { readonly consequent: string; readonly alternate: string } | undefined {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let question = -1;
  let nestedQuestions = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return undefined;
      continue;
    }
    if (depth !== 0) continue;
    if (character === '?') {
      if (question < 0) question = index;
      else nestedQuestions += 1;
      continue;
    }
    if (character === ':' && question >= 0) {
      if (nestedQuestions > 0) {
        nestedQuestions -= 1;
        continue;
      }
      return {
        consequent: source.slice(question + 1, index).trim(),
        alternate: source.slice(index + 1).trim(),
      };
    }
  }
  return undefined;
}

function matchingClosingParenthesis(source: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
function uniqueDatabaseRuntimes(databases: readonly ApplicationReactiveDatabaseRuntimeContract[]): readonly ApplicationReactiveDatabaseRuntimeContract[] { const result = new Map<string, ApplicationReactiveDatabaseRuntimeContract>(); for (const database of databases) { const previous = result.get(database.name); if (previous && serializedDatabaseRuntime(previous) !== serializedDatabaseRuntime(database)) throw new Error(`Generated reactive runtimes contain conflicting database contracts named ${database.name}.`); result.set(database.name, database); } return [...result.values()].sort((left, right) => left.name.localeCompare(right.name)); }

function serializedDatabaseRuntime(database: ApplicationReactiveDatabaseRuntimeContract): string {
  return JSON.stringify({
    ...database,
    ...(database.access
      ? { access: { ...database.access, default: database.access.default ?? 'required' } }
      : {}),
  });
}
function uniqueCommandDatabases(commands: readonly GatewayCommandContract[]): readonly NonNullable<ApplicationModelNode['runtime']>[] { const result = new Map<string, NonNullable<ApplicationModelNode['runtime']>>(); for (const command of commands) result.set(command.model.runtime.connectionEnvName, command.model.runtime); return [...result.values()]; }
// typecast: the exact-one guard and provider type predicate establish a present EventLog provider.
function gatewayEventLog(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  owner: string,
  commands: readonly GatewayCommandContract[],
): ApplicationProviderNode {
  const handlerIds = new Set(commands.map(({ handler }) => handler.id));
  const selectedIds = new Set(
    [...nodes.values()].flatMap((node) =>
      node.kind === 'processor'
      && node.handlers.some((handler) => handlerIds.has(handler.nodeId))
      && node.eventLog
        ? [node.eventLog.nodeId]
        : []),
  );
  if (selectedIds.size === 0) {
    const providers = [...nodes.values()].filter(
      (node): node is ApplicationProviderNode =>
        node.kind === 'provider' && node.interface === 'EventLog',
    );
    if (providers.length === 1) return providers[0]!;
  }
  if (selectedIds.size !== 1) {
    throw new Error(`Generated gateway ${owner} commands require exactly one EventLog authority; found ${selectedIds.size}.`);
  }
  const provider = nodes.get([...selectedIds][0]!);
  if (provider?.kind !== 'provider' || provider.interface !== 'EventLog') {
    throw new Error(`Generated gateway ${owner} references missing EventLog provider ${[...selectedIds][0]}.`);
  }
  return provider;
}
function eventLogEnvironment(provider?: ApplicationProviderNode): readonly Record<string, unknown>[] {
  if (!provider) return [];
  const config = provider.config ?? {};
  const secret = objectConfig(config.connectionSecret);
  const name = stringConfig(secret.name);
  const connection = [
    {
      name: 'APPLIK8S_NATS_SERVERS',
      value: applicationGraphJsonStringArray(eventLogServers(config)),
    },
    {
      name: 'APPLIK8S_NATS_STREAM',
      value: applicationGraphStringValue(config.stream) || 'APPLIK8S_EVENTS',
    },
    {
      name: 'APPLIK8S_NATS_SUBJECT_PREFIX',
      value: applicationGraphStringValue(config.subjectPrefix) || 'applik8s',
    },
  ];
  if (!name) return connection;
  const mode = stringConfig(config.authMode) || 'token';
  return mode === 'userPassword'
    ? [
        ...connection,
        {
          name: 'APPLIK8S_NATS_USER',
          valueFrom: {
            secretKeyRef: {
              name,
              key: stringConfig(config.userKey) || 'user',
            },
          },
        },
        {
          name: 'APPLIK8S_NATS_PASSWORD',
          valueFrom: {
            secretKeyRef: {
              name,
              key: stringConfig(config.passwordKey) || 'password',
            },
          },
        },
      ]
    : [
        ...connection,
        {
          name: 'APPLIK8S_NATS_TOKEN',
          valueFrom: {
            secretKeyRef: {
              name,
              key: stringConfig(config.tokenKey) || 'token',
            },
          },
        },
      ];
}
function streamProcessorScheduleEnvironment(contract: StreamProcessorWorkflowContract | undefined): readonly Record<string, unknown>[] {
  if (!contract) return [];
  const config = contract.provider.config ?? {};
  const namespace = applicationGraphStringValue(config.namespace) || 'default';
  const { secretName, key: tokenKey } = streamProcessorWorkflowCredential(contract);
  return [
    { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: secretName, key: tokenKey } } },
    { name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' },
    // The provider name is a logical application identity. The TypeKro Hatchet
    // composition intentionally gives its chart services stable names, so
    // deriving a DNS name from config.name points consumers at a Service that
    // does not exist. External providers supply both endpoints explicitly.
    { name: 'HATCHET_CLIENT_HOST_PORT', value: applicationGraphStringValue(config.hostPort) || `hatchet-engine.${namespace}.svc:7070` },
    { name: 'HATCHET_CLIENT_API_URL', value: applicationGraphStringValue(config.apiUrl) || `http://hatchet-api.${namespace}.svc:8080` },
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
function searchRuntimeVariable(id: string): string { return `search_runtime_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function searchSourcesVariable(id: string): string { return `search_sources_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function searchQuerySourceVariable(id: string): string { return `search_query_source_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`; }
function valkeyHostEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_HOST_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function valkeyPortEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_PORT_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function valkeyPasswordEnvironmentName(providerId: string): string { return `APPLIK8S_VALKEY_PASSWORD_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function clickHouseGatewayEnvironmentName(providerId: string, suffix: 'ENDPOINT' | 'DATABASE' | 'USERNAME' | 'PASSWORD' | 'ENABLED'): string { return `APPLIK8S_CLICKHOUSE_${suffix}_${createHash('sha256').update(providerId).digest('hex').slice(0, 12).toUpperCase()}`; }
function clickHouseEndpoint(config: Readonly<Record<string, unknown>>): string { const explicit = applicationGraphStringValue(config.endpoint); if (explicit) return explicit; const name = stringConfig(config.name) || 'applik8s-analytics'; return `http://${applicationGraphServiceHost(`clickhouse-${name}`, config.namespace)}:8123`; }
function valkeyHost(config: Readonly<Record<string, unknown>>, graphName: string, stream: ApplicationStreamNode): string { const explicit = applicationGraphStringValue(config.host); if (explicit) return explicit; const name = stringConfig(config.name) || `${kubernetesName(graphName)}-index`; return applicationGraphServiceHost(name, applicationGraphStringValue(config.namespace) || applicationGraphStringValue(stream.database.secretNamespace) || 'default'); }
function eventLogServers(config: Readonly<Record<string, unknown>>): readonly string[] { const configured = Array.isArray(config.servers) ? config.servers.map(applicationGraphStringValue).filter((value): value is string => Boolean(value)) : []; if (configured.length > 0) return configured; const name = applicationGraphStringValue(config.name) || 'applik8s-events'; const namespace = applicationGraphStringValue(config.namespace); return [`nats://${name}${namespace ? `.${namespace}` : ''}.svc:4222`]; }
function absoluteDependencyImports(source: string, resolveDir: string): string { return source.replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`).replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`); }
// typecast: the object and non-array guards establish the read-only configuration record boundary.
function objectConfig(value: unknown): Readonly<Record<string, unknown>> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}; }
function stringConfig(value: unknown): string { return typeof value === 'string' ? value : ''; }
function kubernetesName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'; }

export function kubernetesContainerName(value: string): string {
  const normalized = kubernetesName(value);
  if (normalized.length <= 63) return normalized;
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  const prefix = normalized.slice(0, 54).replace(/[-.]+$/g, '');
  return `${prefix}-${digest}`;
}
