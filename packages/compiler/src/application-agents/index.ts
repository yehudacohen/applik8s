// typecast-file-boundary: Agent compilation narrows validated graph/config records into provider-specific source contracts at the generation boundary.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApplicationAIAgentNode,
  ApplicationCallableProviderBinding,
  ApplicationCallableProviderRuntimeOperation,
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationHandlerDependencies,
  ApplicationModelNode,
  ApplicationModelRuntimeContract,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationProviderNode,
  ApplicationQueryNode,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import { applicationOperationId } from '@applik8s/core';
import {
  type ApplicationFrameworkCredentialDependency,
  type ApplicationRuntimeEndpointDependency,
  applicationOptionalDeploymentOutputReference,
  applicationRuntimeEndpointEnvironmentName,
} from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import {
  applicationActorInvocationBoundary,
  generatedApplicationActorInvocationClientSource,
} from '../application-actor-invocation.js';
import { applicationCallableProviderEnvironment } from '../application-callable-provider-runtime.js';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import {
  emitGeneratedApplicationContainer,
  type GeneratedApplicationContainerArtifact,
} from '../application-containers/index.js';
import { applicationFrameworkCredentialDependencies } from '../application-framework-credentials.js';
import { generatedRuntimeNodePaths } from '../node-module-resolution.js';
import { applicationGraphStringValue } from '../application-installation-values.js';
import {
  type ApplicationOperationPlacementReceiver,
  compileApplicationOperationPlacementReceiver,
} from '../application-mcp/planner.js';
import {
  applicationGraphHasObservabilityRuntime,
  generatedApplicationTelemetryImports,
  generatedApplicationTelemetryRuntimeSource,
} from '../application-observability-runtime-source.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../application-operations/index.js';
import { generatedApplicationProviderOperationValue } from '../application-provider-telemetry-source.js';
import { generatedAgentWorkerResources } from '../application-workload-resources.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import { handlerSourceMetadataPlugin } from '../pipeline/entrypoint-handler-instrumentation.js';

const DEFAULT_GENERATED_AGENT_RUNTIME_IMAGE =
  'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationAgentArtifact {
  readonly name: string;
  readonly agentId: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationAgentResource[];
  readonly runtimeEndpoints: readonly ApplicationRuntimeEndpointDependency[];
  readonly frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[];
}

export interface GeneratedApplicationAgentResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

interface ApplicationAgentCompilerContract {
  readonly graph: ApplicationGraph;
  readonly application: string;
  readonly observability: boolean;
  readonly agent: ApplicationAIAgentNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: JsonObject;
  readonly callableProviders: readonly ApplicationProviderNode[];
  readonly callableProviderProfileSelector?: string;
  readonly operationCatalog: ApplicationOperationCatalog;
  readonly tools: readonly {
    readonly operation: ApplicationOperationDescriptor;
    readonly transport: ApplicationAIAgentNode['tools'][number]['transport'];
    readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
    readonly receiver?: ApplicationOperationPlacementReceiver;
    readonly local?: NonNullable<ApplicationAIAgentNode['tools'][number]['local']>;
  }[];
  readonly operations: readonly {
    readonly alias: string;
    readonly authoringOperationId: string;
    readonly operation: ApplicationOperationDescriptor;
    readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
    readonly receiver: ApplicationOperationPlacementReceiver;
  }[];
  readonly queries: readonly {
    readonly alias: string;
    readonly query: ApplicationQueryNode;
    readonly gateway: ApplicationGatewayNode & {
      readonly deployment: NonNullable<ApplicationGatewayNode['deployment']>;
      readonly cursorSecret: NonNullable<ApplicationGatewayNode['cursorSecret']>;
    };
    readonly endpoint: string;
    readonly endpointBaseUrl: string;
    readonly endpointPath: string;
    readonly endpointEnvironmentName: string;
  }[];
  readonly actors: readonly {
    readonly alias: string;
    readonly actor: string;
    readonly member: string;
    readonly memberKind: 'command' | 'message' | 'alarm';
    readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
  }[];
  readonly actorApplicationEndpoint?: string;
  readonly queryCursorSecret?: { readonly name: string; readonly key: string };
  readonly namespace: string;
  readonly state: NonNullable<ApplicationModelNode['runtime']>;
  readonly conversationAccess?: {
    readonly setting: string;
  };
  readonly usage?: {
    readonly model: ApplicationModelRuntimeContract;
    readonly operation: ApplicationOperationDescriptor;
    readonly event: {
      readonly id: string;
      readonly name: string;
      readonly version: string;
      readonly payload: JsonObject;
    };
  };
  readonly route: JsonObject;
}

export async function emitGeneratedApplicationAgents(options: {
  readonly graph: ApplicationGraph;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly workloadAuthority?: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly outDir: string;
  readonly entrypoint: string;
}): Promise<readonly GeneratedApplicationAgentArtifact[]> {
  const agents = options.graph.nodes.filter(
    (node): node is ApplicationAIAgentNode => node.kind === 'aiAgent',
  );
  if (agents.length === 0) return [];
  const operationCatalog =
    options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const workloadAuthority =
    options.workloadAuthority
    ?? compileApplicationWorkloadAuthority(options.graph, operationCatalog);
  await mkdir(options.outDir, { recursive: true });
  return await Promise.all(
    agents.map((agent) =>
      emitAgent(
        applicationAgentCompilerContract(
          options.graph,
          agent,
          operationCatalog,
          workloadAuthority,
        ),
        options.outDir,
        options.entrypoint,
      )),
  );
}

function applicationAgentCompilerContract(
  graph: ApplicationGraph,
  agent: ApplicationAIAgentNode,
  operationCatalog: ApplicationOperationCatalog,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): ApplicationAgentCompilerContract {
  const provider = graph.nodes.find(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider' && node.id === agent.inference.nodeId,
  );
  if (provider?.interface !== 'AI') {
    throw new Error(
      `Application agent ${agent.id} requires one resolved AI provider node ${agent.inference.nodeId}.`,
    );
  }
  const providerConfig = provider.config?.ai;
  if (!isJsonObject(providerConfig)) {
    throw new Error(
      `Application agent ${agent.id} resolved AI provider ${provider.id} without a portable provider configuration.`,
    );
  }
  const callableProviders = (agent.providerBindings ?? []).map((binding) => {
    const callableProvider = graph.nodes.find(
      (node): node is ApplicationProviderNode =>
        node.kind === 'provider' && node.id === binding.provider.nodeId,
    );
    if (
      !callableProvider
      || callableProvider.interface !== binding.provider.interface
    ) {
      throw new Error(
        `Application agent ${agent.id} references missing callable provider ${binding.provider.nodeId}.`,
      );
    }
    return callableProvider;
  }).filter(
    (candidate, index, providers) =>
      providers.findIndex((provider) => provider.id === candidate.id) === index,
  );
  const callableProviderProfileSelector =
    applicationCallableProviderProfileSelector(agent, callableProviders);
  const operations = new Map(
    operationCatalog.operations.map((operation) => [operation.id, operation]),
  );
  const envelopes = new Map(
    workloadAuthority
      .filter(
        (envelope) =>
          envelope.workloadIdentity.subject === agent.id
          && envelope.serviceIdentity?.id === agent.serviceIdentity.id,
      )
      .map((envelope) => [envelope.operationId, envelope]),
  );
  const tools = agent.tools.map((tool) => {
    const operation = operations.get(tool.operationId);
    const authority = envelopes.get(tool.operationId);
    if (!operation) {
      throw new Error(
        `Application agent ${agent.id} tool ${tool.operationId} is absent from operation catalog ${operationCatalog.revision}.`,
      );
    }
    if (!authority) {
      throw new Error(
        `Application agent ${agent.id} tool ${tool.operationId} has no workload-authority envelope.`,
      );
    }
    if (operation.input.digest !== authority.inputSchemaDigest) {
      throw new Error(
        `Application agent ${agent.id} tool ${tool.operationId} authority input schema is stale.`,
      );
    }
    return {
      operation,
      transport: tool.transport,
      workloadAuthority: authority,
      ...(tool.local
        ? { local: tool.local }
        : {
            receiver: compileApplicationOperationPlacementReceiver(
              graph,
              operation,
              `Application agent ${agent.name} tool ${operation.id}`,
            ),
          }),
    };
  });
  const directOperations = (agent.operations ?? []).map((dependency) => {
    const operation = operations.get(dependency.operationId);
    const authority = envelopes.get(dependency.operationId);
    if (!operation) {
      throw new Error(
        `Application agent ${agent.id} function-native operation ${dependency.operationId} is absent from operation catalog ${operationCatalog.revision}.`,
      );
    }
    if (!authority) {
      throw new Error(
        `Application agent ${agent.id} function-native operation ${dependency.operationId} has no workload-authority envelope.`,
      );
    }
    if (operation.input.digest !== authority.inputSchemaDigest) {
      throw new Error(
        `Application agent ${agent.id} function-native operation ${dependency.operationId} authority input schema is stale.`,
      );
    }
    return {
      alias: dependency.alias,
      authoringOperationId: dependency.authoringOperationId,
      operation,
      workloadAuthority: authority,
      receiver: compileApplicationOperationPlacementReceiver(
        graph,
        operation,
        `Application agent ${agent.name} function-native operation ${operation.id}`,
      ),
    };
  });
  const stateModels = graph.nodes.filter(
    (
      node,
    ): node is ApplicationModelNode & {
      readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
    } =>
      node.kind === 'model'
      && node.database.nodeId === agent.state.nodeId
      && Boolean(node.runtime),
  );
  const stateRuntime = stateModels[0]?.runtime;
  if (!stateRuntime) {
    throw new Error(
      `Application agent ${agent.id} durable provider ${agent.state.nodeId} has no provider-native relational model runtime. Declare Conversation/Run/Attempt models on that database before compilation.`,
    );
  }
  const stateIdentities = new Set(
    stateModels.map((model) =>
      JSON.stringify({
        connectionEnvName: model.runtime.connectionEnvName,
        secretName: model.runtime.secretName,
        secretKey: model.runtime.secretKey,
        secretNamespace: model.runtime.secretNamespace,
      })),
  );
  if (stateIdentities.size > 1) {
    throw new Error(
      `Application agent ${agent.id} durable provider ${agent.state.nodeId} resolves inconsistent connection secrets.`,
    );
  }
  const conversationRuntime = stateModels.find(
    model => model.common?.runtimeRoles?.includes(
      'applik8s.conversation-state/v1',
    ) === true,
  )?.runtime;
  const conversationAccess = conversationRuntime?.nativeRelational?.access;
  const namespace = graph.metadata.namespace ?? stringValue(providerConfig.namespace) ?? 'default';
  const queryRuntime = applicationAgentQueryRuntime(graph, agent, namespace);
  const actors = (agent.actors ?? []).map((binding) => {
    const actor = graph.nodes.find((candidate) => candidate.id === binding.actor.nodeId);
    if (actor?.kind !== 'actor') {
      throw new Error(`Application agent ${agent.id} actor ${binding.alias} references missing actor ${binding.actor.nodeId}.`);
    }
    const member = actor.definition.protocol.find((candidate) => candidate.name === binding.member);
    if (!member || member.kind !== binding.memberKind) {
      throw new Error(`Application agent ${agent.id} actor ${binding.alias} references incompatible member ${actor.definition.id}.${binding.member}.`);
    }
    const operationId = applicationOperationId({
      domain: 'actors',
      owner: actor.definition.id,
      operation: binding.member,
    });
    const authority = envelopes.get(operationId);
    if (!authority) {
      throw new Error(
        `Application agent ${agent.id} actor ${binding.alias} has no workload-authority envelope for ${operationId}.`,
      );
    }
    return {
      alias: binding.alias,
      actor: actor.definition.id,
      member: binding.member,
      memberKind: binding.memberKind,
      workloadAuthority: authority,
    };
  });
  const actorApplicationEndpoint = actors.length > 0
    ? applicationActorInvocationBoundary(graph, namespace, `Application agent ${agent.id}`).endpoint
    : undefined;
  const usageModel = graph.nodes.find(
    (node): node is ApplicationModelNode & { readonly runtime: ApplicationModelRuntimeContract } =>
      node.kind === 'model'
      && node.database.nodeId === agent.state.nodeId
      && node.runtime?.tableName === 'applik8s_usage_facts',
  );
  const usageOperationId = usageModel
    ? applicationOperationId({
        domain: 'models',
        owner: usageModel.name,
        operation: 'create',
      })
    : undefined;
  const usageOperation = usageOperationId
    ? operations.get(usageOperationId)
    : undefined;
  const usageEvent = usageModel
    ? graph.nodes.find(
        (node) =>
          node.kind === 'event'
          && node.contract.name === `models.${usageModel.name}.created`
          && node.contract.version === 'v1',
      )
    : undefined;
  if (usageModel && (!usageOperation || usageEvent?.kind !== 'event')) {
    throw new Error(
      `Application agent ${agent.id} usage model ${usageModel.name} has no compiled observable create operation and lifecycle event.`,
    );
  }
  const usage = usageModel && usageOperation && usageEvent?.kind === 'event'
    ? {
        model: usageModel.runtime,
        operation: usageOperation,
        event: {
          id: `${usageEvent.contract.name}.${usageEvent.contract.version}`,
          name: usageEvent.contract.name,
          version: usageEvent.contract.version,
          payload: usageEvent.contract.payload.jsonSchema,
        },
      }
    : undefined;
  return {
    graph,
    application: graph.metadata.name,
    observability: applicationGraphHasObservabilityRuntime(graph),
    agent,
    provider,
    providerConfig,
    callableProviders,
    ...(callableProviderProfileSelector
      ? { callableProviderProfileSelector }
      : {}),
    operationCatalog,
    tools,
    operations: directOperations,
    queries: queryRuntime.queries,
    actors,
    ...(actorApplicationEndpoint ? { actorApplicationEndpoint } : {}),
    ...(queryRuntime.cursorSecret
      ? { queryCursorSecret: queryRuntime.cursorSecret }
      : {}),
    namespace,
    state: stateRuntime,
    ...(conversationAccess
      ? { conversationAccess: { setting: conversationAccess.setting } }
      : {}),
    ...(usage ? { usage } : {}),
    route: applicationAgentRoute(agent, providerConfig),
  };
}

function applicationAgentQueryRuntime(
  graph: ApplicationGraph,
  agent: ApplicationAIAgentNode,
  namespace: string,
): {
  readonly queries: ApplicationAgentCompilerContract['queries'];
  readonly cursorSecret?: { readonly name: string; readonly key: string };
} {
  if ((agent.queries?.length ?? 0) === 0) return { queries: [] };
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const queries: ApplicationAgentCompilerContract['queries'][number][] = [];
  const cursorSecrets = new Map<string, { readonly name: string; readonly key: string }>();
  for (const reference of agent.queries ?? []) {
    const query = nodes.get(reference.query.nodeId);
    if (query?.kind !== 'query') {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} references missing query ${reference.query.nodeId}.`,
      );
    }
    const gateways = graph.nodes.filter(
      (candidate): candidate is ApplicationGatewayNode =>
        candidate.kind === 'gateway'
        && candidate.materialization === 'generatedDeployment'
        && candidate.queries.some((entry) => entry.nodeId === query.id),
    );
    if (gateways.length !== 1) {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} must be exposed by exactly one generated gateway; found ${gateways.length}.`,
      );
    }
    const candidate = gateways[0];
    const deployment = candidate?.deployment;
    const cursorSecret = candidate?.cursorSecret;
    if (!candidate || !deployment || !cursorSecret) {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} gateway has no deployment cursor Secret.`,
      );
    }
    const gateway = { ...candidate, deployment, cursorSecret };
    const gatewayNamespace = applicationGraphStringValue(
      deployment.namespace,
    ) || namespace;
    if (gatewayNamespace !== namespace) {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} gateway ${candidate.id} is in ${gatewayNamespace}, but the agent is in ${namespace}.`,
      );
    }
    const secretNamespace = applicationGraphStringValue(
      cursorSecret.namespace,
    );
    if (secretNamespace && secretNamespace !== namespace) {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} cursor Secret is in ${secretNamespace}, but the agent is in ${namespace}.`,
      );
    }
    const secretName = applicationGraphStringValue(gateway.cursorSecret.name);
    if (!secretName || !gateway.cursorSecret.key) {
      throw new Error(
        `Application agent ${agent.id} query ${reference.alias} gateway cursor Secret is not concrete.`,
      );
    }
    cursorSecrets.set(`${secretName}\0${gateway.cursorSecret.key}`, {
      name: secretName,
      key: gateway.cursorSecret.key,
    });
    const publicId = query.publicId ?? `${query.name}.${query.version}`;
    const route = gateway.routes.snapshots.replace(
      ':query',
      encodeURIComponent(publicId),
    );
    const serviceName = kubernetesName(`${graph.metadata.name}-${candidate.name}`);
    queries.push({
      alias: reference.alias,
      query,
      gateway,
      endpoint: `http://${serviceName}:${gateway.deployment.port}${route}`,
      endpointBaseUrl: `http://${serviceName}:${gateway.deployment.port}`,
      endpointPath: route,
      endpointEnvironmentName: applicationRuntimeEndpointEnvironmentName(gateway.id),
    });
  }
  if (cursorSecrets.size !== 1) {
    throw new Error(
      `Application agent ${agent.id} calls queries backed by ${cursorSecrets.size} cursor Secrets. Use one application query context authority per agent.`,
    );
  }
  const cursorSecret = [...cursorSecrets.values()][0];
  if (!cursorSecret) {
    throw new Error(`Application agent ${agent.id} query cursor Secret is absent.`);
  }
  return { queries, cursorSecret };
}

async function emitAgent(
  contract: ApplicationAgentCompilerContract,
  outDir: string,
  applicationEntrypoint: string,
): Promise<GeneratedApplicationAgentArtifact> {
  const name = kubernetesName(contract.agent.name);
  const agentDir = join(outDir, name);
  const generatedEntrypoint = join(agentDir, 'agent.generated.ts');
  const sourcePath = join(agentDir, 'agent.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(agentDir, 'agent.manifest.json');
  const metafilePath = join(agentDir, 'agent.esbuild-meta.json');
  await mkdir(agentDir, { recursive: true });
  const providerOperations = agentProviderRuntimeOperations(contract.agent);
  const providerBindingPaths = providerOperations.map(
    ({ binding }) => binding.identifier,
  );
  const providerBindingRoots = providerBindingPaths
    .map((identifier) => identifier.split('.')[0])
    .filter((identifier): identifier is string => Boolean(identifier))
    .filter(
      (identifier, index, identifiers) =>
        identifiers.indexOf(identifier) === index,
    );
  const ordinaryBindingRoots = contract.queries
    .map(({ alias }) => alias.split('.')[0] ?? alias)
    .concat(contract.actors.map(({ alias }) => alias.split('.')[0] ?? alias));
  await writeFile(
    join(agentDir, 'handler.generated.ts'),
    generatedCallbackFactoryModule({
      source: contract.agent.handlerSource,
      ...(contract.agent.handlerDependencies
        ? { dependencies: contract.agent.handlerDependencies }
        : {}),
      injectedIdentifiers: ordinaryBindingRoots
        .concat(providerBindingRoots)
        .filter(
          (identifier, index, values) =>
            /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
            && values.indexOf(identifier) === index,
        ),
      injectedBindingPaths: [
        ...ordinaryBindingRoots,
        ...providerBindingPaths,
      ],
      // The semantic graph has already admitted these exact callable leaves.
      // Replaying their captured provide/profile/inject module would execute
      // application authoring setup inside the generated agent worker.
      replacedCapturedIdentifiers: providerBindingRoots,
      exportName: 'createHandler',
    }),
  );
  for (const [index, tool] of contract.tools.entries()) {
    if (!tool.local) continue;
    await writeFile(
      join(agentDir, localAgentToolModuleFile(index)),
      generatedCallbackFactoryModule({
        source: tool.local.handlerSource,
        ...(tool.local.handlerDependencies
          ? { dependencies: tool.local.handlerDependencies }
          : {}),
        injectedIdentifiers: localAgentToolBindingRoots(tool.local),
        exportName: 'createTool',
      }),
    );
  }
  if (contract.agent.instructions.kind === 'closure') {
    await writeCallbackModule(
      agentDir,
      'instructions',
      contract.agent.instructions.source,
      contract.agent.instructions.dependencies,
    );
  }
  await writeFile(generatedEntrypoint, generatedAgentSource(contract));
  const result = await build({
    entryPoints: [generatedEntrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minify: true,
    keepNames: true,
    lineLimit: 120,
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
    nodePaths: [...generatedRuntimeNodePaths()],
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
    supported: { 'template-literal': false },
    plugins: [
      handlerSourceMetadataPlugin(applicationEntrypoint, { includeMaintainedPackages: false }),
      applik8sWorkspaceSourcePlugin(),
    ],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.application,
    workloadName: name,
    role: 'ai-agent',
    artifactDir: agentDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/agent.mjs',
    baseImage: DEFAULT_GENERATED_AGENT_RUNTIME_IMAGE,
    sourceDigest: digest,
  });
  const frameworkCredentials = applicationFrameworkCredentialDependencies(source)
    .filter((credential) =>
      credential.kind !== 'agent-query-context'
      || contract.queryCursorSecret !== undefined
    );
  const resources = generatedAgentResources(
    contract,
    container.image,
    digest,
    frameworkCredentials,
  );
  const runtimeEndpoints = uniqueRuntimeEndpoints([
    ...contract.tools.flatMap((tool) => tool.receiver ? [{ nodeId: tool.receiver.nodeId, environmentName: tool.receiver.environmentName }] : []),
    ...contract.operations.map(({ receiver }) => ({ nodeId: receiver.nodeId, environmentName: receiver.environmentName })),
    ...contract.queries.map(({ gateway, endpointEnvironmentName }) => ({ nodeId: gateway.id, environmentName: endpointEnvironmentName })),
  ]);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        apiVersion: 'applik8s.aiAgentArtifact/v1alpha1',
        kind: 'GeneratedApplicationAgent',
        metadata: { name },
        spec: {
          application: contract.application,
          agent: contract.agent.id,
          model: contract.agent.model,
          compatibility: contract.agent.compatibility,
          operationCatalogRevision: contract.operationCatalog.revision,
          runtimeEndpoints,
          tools: contract.tools.map((tool) => ({
            operationId: tool.operation.id,
            transport: tool.transport,
            workloadAuthorityId: tool.workloadAuthority.id,
          })),
          runtime: {
            entrypoint: sourcePath,
            sourceMap: sourceMapPath,
            digest,
            sizeBytes,
            distribution: 'ociImage',
            packageManagerAtStartup: false,
            image: container.image,
            baseImage: container.baseImage,
          },
          container,
          resources: resources.map((resource) => ({
            apiVersion: resource.apiVersion,
            kind: resource.kind,
            metadata: resource.metadata,
          })),
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return {
    name,
    agentId: contract.agent.id,
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
    runtimeEndpoints,
    frameworkCredentials,
  };
}

function uniqueRuntimeEndpoints(
  endpoints: readonly ApplicationRuntimeEndpointDependency[],
): readonly ApplicationRuntimeEndpointDependency[] {
  return [...new Map(endpoints.map((endpoint) => [endpoint.environmentName, endpoint])).values()]
    .sort((left, right) => left.environmentName.localeCompare(right.environmentName));
}

function generatedAgentSource(contract: ApplicationAgentCompilerContract): string {
  const providerOperations = agentProviderRuntimeOperations(contract.agent);
  const providerRuntimeImports = uniqueAgentProviderRuntimeOperations(
    contract.agent,
  ).map(
    ({ runtime, variable }) =>
      `import { ${runtime.export} as ${variable} } from ${JSON.stringify(runtime.module)};`,
  ).join('\n');
  const instructions = contract.agent.instructions.kind === 'static'
    ? JSON.stringify(contract.agent.instructions.value)
    : 'instructions';
  const workloadIdentity = [
    ...contract.tools,
    ...contract.operations,
    ...contract.actors,
  ][0]?.workloadAuthority.workloadIdentity;
  if (!workloadIdentity) {
    throw new Error(`Application agent ${contract.agent.id} has no workload identity.`);
  }
  const audiences = [
    ...new Set(
      [...contract.tools, ...contract.operations, ...contract.actors].flatMap((dependency) => dependency.workloadAuthority.audiences),
    ),
  ].sort();
  const routeEntries = [...contract.tools, ...contract.operations].filter(
    (tool): tool is typeof tool & { readonly receiver: ApplicationOperationPlacementReceiver } =>
      Boolean(tool.receiver),
  ).map((tool) =>
    `[${JSON.stringify(tool.operation.id)}, ${JSON.stringify({
      baseUrl: tool.receiver.baseUrl,
      path: tool.receiver.path,
      environmentName: tool.receiver.environmentName,
      maximumResponseBytes: 10_485_760,
    })}]`,
  ).join(',\n');
  const localToolImports = contract.tools.flatMap((tool, index) =>
    tool.local
      ? [`import { createTool as createLocalTool${index} } from ${JSON.stringify(`./${localAgentToolModuleFile(index)}`)};`]
      : []).join('\n');
  const localToolRuntime = generatedLocalAgentToolRuntime(contract);
  const telemetryImports = contract.observability
    ? generatedApplicationTelemetryImports({
        boundaryRunner: true,
        carrierCapture: contract.actors.length > 0,
        providerOperationInstrumentation: providerOperations.length > 0,
      })
    : providerOperations.length > 0
      ? generatedApplicationTelemetryImports({
          providerOperationInstrumentation: true,
          runtimeImplementation: false,
        })
      : [];
  return `
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { installApplicationInvocationAdmissionResolver, installApplicationOperationRuntimeResolver } from '@applik8s/client';
import { createApplicationAIAttemptRuntime } from '@applik8s/ai';
import { applicationAIConversationPrincipalScope, createApplicationAIAgentConversationPersistence, createApplicationTanStackConversationPersistence, createPostgresApplicationConversationStore } from '@applik8s/conversations/runtime';
import { applicationCausalPrincipalContext, validateApplicationAdmissionContextV1 } from '@applik8s/core';
import { applicationAdmissionRejectionCodeV1, createApplicationAdmissionObservationV1 } from '@applik8s/core/admission';
import { createApplicationOperationAuthorityRuntime, decodeApplicationExecutionAdmission } from '@applik8s/operations';
import { createApplicationAIAgentRequestHandler, createApplicationAIOperationExecutor, createPostgresApplicationAIAttemptStore, decodeApplicationAIAgentTelemetry } from '@applik8s/runtime-ai';
import { createApplicationTaskQueryRuntime } from '@applik8s/applik8s/task-query-runtime';
import { createHandler } from './handler.generated.js';
${telemetryImports.join('\n')}
${providerRuntimeImports}
${localToolImports}
${contract.tools.some((tool) => tool.local) || contract.usage || contract.agent.invocation
    ? "import { normalizeSchema } from '@applik8s/sdk/schema-runtime';\nimport { applicationPostgresModelReadClients, applicationRelationalChangeScopes, applicationRequestContextValues, createApplicationFunctionNativeEventHandle, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, executePostgresModelCommand, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelReadClients, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';"
    : ''}
${contract.agent.instructions.kind === 'closure'
    ? "import { callback as instructions } from './instructions.generated.js';"
    : ''}

${contract.observability
    ? generatedApplicationTelemetryRuntimeSource({
        application: contract.application,
        service: `ai-agent-${contract.agent.name}`,
      })
    : ''}

const contract = ${JSON.stringify({
    application: contract.application,
    name: contract.agent.name,
    nodeId: contract.agent.id,
    serviceIdentity: contract.agent.serviceIdentity,
    ...(contract.agent.scope ? { scope: contract.agent.scope } : {}),
    model: contract.agent.model,
    provider: contract.providerConfig,
    route: contract.route,
    state: contract.state,
    ...(contract.agent.invocation ? { invocation: contract.agent.invocation } : {}),
    ...(contract.conversationAccess
      ? { conversationAccess: contract.conversationAccess }
      : {}),
    ...(contract.usage ? { usage: contract.usage } : {}),
    tools: contract.tools,
    operations: contract.operations,
    queries: contract.queries.map(({ alias, query, gateway, endpoint, endpointBaseUrl, endpointPath, endpointEnvironmentName }) => ({
      alias,
      id: query.publicId ?? `${query.name}.${query.version}`,
      audience: gateway.id,
      endpoint,
      endpointBaseUrl,
      endpointPath,
      endpointEnvironmentName,
      inputSchema: query.input.jsonSchema,
      outputSchema: query.output.jsonSchema,
      timeoutMs: query.budgets.timeoutMs,
      maxResultBytes: query.budgets.maxResultBytes,
    })),
    actors: contract.actors,
    budgets: contract.agent.budgets,
    executionPolicy: contract.agent.executionPolicy,
    deployment: contract.agent.deployment,
  })};
const usageCreatedEvent = contract.usage
  ? Object.freeze({
      kind: 'applik8sEvent',
      ...contract.usage.event,
      emit() {
        throw new Error('AI usage lifecycle events are emitted only by the durable model transaction.');
      },
    })
  : undefined;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable ' + name);
  return value;
}
function runtimeEndpoint(baseUrl, environmentName, path = '') {
  let selected = process.env[environmentName] || baseUrl;
  while (selected.endsWith('/')) selected = selected.slice(0, -1);
  return selected + path;
}
function applicationAgentDurableScope(principal, trustedContext) {
  const contextName = contract.scope?.kind === 'trustedContext'
    ? contract.scope.name
    : undefined;
  const selected = contextName ? trustedContext?.[contextName] : undefined;
  if (selected !== undefined) {
    if (typeof selected !== 'string' || !selected.trim()) {
      throw new Error('Agent durable scope ' + contextName + ' must be a non-empty admitted string.');
    }
    return selected;
  }
  return applicationAIConversationPrincipalScope(principal, trustedContext ?? {});
}
function selectedProviderValue(value) {
  let selected = value;
  while (selected?.kind === 'application-provider-selection'
    || selected?.kind === 'application-target-provider-selection') {
    if (selected.kind === 'application-provider-selection') {
      const variant = requiredEnv('APPLIK8S_PROFILE_VARIANT');
      selected = selected.cases?.[variant] ?? selected.default;
    } else {
      const target = requiredEnv('APPLIK8S_DEPLOYMENT_TARGET');
      selected = selected.targets?.[target];
    }
    if (!selected || typeof selected !== 'object') {
      throw new Error('The active profile and deployment target have no AI provider configuration.');
    }
  }
  return selected;
}
let installationSpec;
function installationSpecValue(path) {
  installationSpec ??= JSON.parse(requiredEnv('APPLIK8S_INSTALLATION_SPEC'));
  let current = installationSpec;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      throw new Error('Generated AI provider installation path schema.spec.' + path + ' is absent from APPLIK8S_INSTALLATION_SPEC.');
    }
    current = current[segment];
  }
  return current;
}
function materializeInstallationValue(value) {
  if (typeof value === 'string') {
    const reference = /^\\$\\{schema\\.spec\\.([A-Za-z_][A-Za-z0-9_.]*)\\}$/.exec(value);
    return reference?.[1] ? installationSpecValue(reference[1]) : value;
  }
  if (Array.isArray(value)) return value.map(materializeInstallationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, materializeInstallationValue(nested)]),
  );
}
const selectedProvider = materializeInstallationValue(selectedProviderValue(contract.provider));
const selectedRoute = materializeInstallationValue(selectedProviderValue(contract.route));
const selectedModelRoute = selectedProvider?.models?.[contract.model.name];
const selectedBackend = Array.isArray(selectedModelRoute?.backends)
  ? selectedModelRoute.backends[0]
  : undefined;
const runtimeQueries = contract.queries.map((query) => ({
  ...query,
  endpoint: runtimeEndpoint(
    query.endpointBaseUrl,
    query.endpointEnvironmentName,
    query.endpointPath,
  ),
}));
const agentQueryRuntime = runtimeQueries.length > 0
  ? createApplicationTaskQueryRuntime({
      queries: runtimeQueries,
      cursorSecret: requiredEnv('APPLIK8S_AGENT_QUERY_CONTEXT_SECRET'),
    })
  : undefined;
const directOperationScope = new AsyncLocalStorage();
installApplicationOperationRuntimeResolver(() => directOperationScope.getStore());
installApplicationInvocationAdmissionResolver(() => directOperationScope.getStore()?.admission);
const directOperations = new Map(
  contract.operations.flatMap((dependency) => [
    [dependency.operation.id, dependency.operation],
    [dependency.authoringOperationId, dependency.operation],
  ]),
);
const providerBindings = Object.freeze({
${providerOperations.map(({ binding, variable }) =>
    `  ${JSON.stringify(binding.identifier)}: ${generatedApplicationProviderOperationValue(binding, variable)},`).join('\n')}
});
function focusedAgentBindings(flat) {
  const bindings = {};
  for (const [path, value] of Object.entries(flat)) {
    const segments = path.split('.');
    let current = bindings;
    for (const segment of segments.slice(0, -1)) {
      current = current[segment] ??= {};
    }
    const leaf = segments.at(-1);
    if (!leaf) throw new Error('Agent runtime binding path is empty.');
    if (Object.hasOwn(current, leaf)) {
      throw new Error('Agent runtime binding collides at ' + path + '.');
    }
    current[leaf] = value;
  }
  return bindings;
}
const handler = (request, context) => {
  if (contract.invocation) {
    const normalized = normalizeSchema(
      { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: contract.name + '.input' }, schema: contract.invocation.input.jsonSchema },
      contract.name + '.input',
    ).validate(request.input);
    if (!normalized.ok) throw normalized.error;
    request = { ...request, input: normalized.value };
  }
  let directOperationOrdinal = 0;
  let directActorOrdinal = 0;
  const runtime = Object.freeze({
    admission: context.admission,
    execute(operation, input) {
      const descriptor = directOperations.get(operation.id);
      if (!descriptor) {
        throw new Error('Agent callback attempted undeclared function-native operation ' + operation.id + '.');
      }
      const providerToolCallId = 'handler-' + directOperationOrdinal + '-' + operation.id;
      directOperationOrdinal += 1;
      return invokeOperation(descriptor, input, {
        context: context.admission,
        invocationId: context.invocationId,
        attemptId: context.attemptId,
        providerToolCallId,
        signal: context.signal,
      });
    },
  });
  const queryBindings = agentQueryRuntime?.bind(
      Object.fromEntries(contract.queries.map((query) => [query.alias, query.id])),
      {
        id: contract.serviceIdentity.id,
        identity: contract.serviceIdentity,
        kind: 'service',
        authenticationMethod: 'workload-identity',
        authorizationVersion: context.principal.authorityRevision,
        trustedContext: context.trustedContext,
      },
      {
        correlationId: context.runId,
        causationId: context.invocationId,
      },
    ) ?? {};
  const actorBindings = Object.fromEntries(contract.actors.map((binding) => [binding.alias, async (key, ...args) => {
    const alarm = binding.memberKind === 'alarm';
    const at = alarm ? args[0] : undefined;
    const input = alarm ? args[1] : args[0];
    const options = alarm ? args[2] : args[1];
    const invocationOrdinal = directActorOrdinal++;
    const idempotencyKey = 'agent:' + context.attemptId + ':' + invocationOrdinal + ':' + binding.actor + ':' + binding.member;
    const audience = binding.workloadAuthority.audiences[0];
    if (!audience) throw new Error('Actor workload authority has no audience for ' + binding.actor + '.' + binding.member);
    return invokeApplicationActorBinding(
      binding,
      key,
      input,
      alarm ? { ...options, scheduledAt: at instanceof Date ? at.toISOString() : at } : options,
      {
        idempotencyKey,
        envelope: {
          principal: context.principal,
          causalPrincipal: { id: context.principal.causalPrincipalId ?? context.principal.id },
          trustedContextDigest: context.principal.trustedContextDigest,
          transport: 'direct',
          audience,
          workloadAuthorityId: binding.workloadAuthority.id,
        },
      },
      context.signal,
      ${contract.observability ? 'captureApplicationTelemetryContext()' : 'undefined'},
    );
  }]));
  const result = directOperationScope.run(runtime, () => createHandler(
    focusedAgentBindings({ ...providerBindings, ...queryBindings, ...actorBindings }),
  )(request, context));
  if (!contract.invocation) return result;
  return Promise.resolve(result).then((value) => {
    const normalized = normalizeSchema(
      { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: contract.name + '.output' }, schema: contract.invocation.output.jsonSchema },
      contract.name + '.output',
    ).validate(value);
    if (!normalized.ok) throw normalized.error;
    return normalized.value;
  });
};
${generatedApplicationActorInvocationClientSource()}
function requiredProviderString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Selected AI provider is missing ' + label + '.');
  }
  return value;
}
function managedOpenAICompatibleBaseUrl(value) {
  const endpoint = new URL(requiredProviderString(value, 'the managed gateway endpoint'));
  const pathname = endpoint.pathname.replace(/\\/+$/u, '');
  if (!pathname.endsWith('/v1')) {
    endpoint.pathname = (pathname || '') + '/v1';
  }
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\\/$/u, '');
}
const sql = postgres(requiredEnv(${JSON.stringify(contract.state.connectionEnvName)}), {
  max: Math.max(4, contract.deployment.maximumConcurrency + 2),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});
const attemptStore = createPostgresApplicationAIAttemptStore({ sql });
const attemptRuntime = createApplicationAIAttemptRuntime({ store: attemptStore });
const conversationStore = createPostgresApplicationConversationStore({
  sql,
  ...(contract.conversationAccess
    ? { access: { setting: contract.conversationAccess.setting } }
    : {}),
});
const conversationPersistence = createApplicationAIAgentConversationPersistence({
  store: conversationStore,
  scope: ({ principal, trustedContext }) => applicationAgentDurableScope(principal, trustedContext),
});
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql,
  application: contract.application,
  catalog: ${JSON.stringify(contract.operationCatalog)},
  ${applicationStaticAuthorityManifest(contract.graph) ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(contract.graph))},` : ''}
});
let agentAdmissionObservationState;
let agentAdmissionObservationAt = 0;
async function observeAgentAdmission(state, admission, error) {
  const observationTime = Date.now();
  if (state === agentAdmissionObservationState && observationTime - agentAdmissionObservationAt < 30_000) return;
  agentAdmissionObservationState = state;
  agentAdmissionObservationAt = observationTime;
  const evidence = createApplicationAdmissionObservationV1({
    state,
    boundary: 'execution',
    ...(admission ? { admission } : { transport: 'framework' }),
    ...(error ? { rejectionCode: applicationAdmissionRejectionCodeV1(error) } : {}),
  });
  console.info(JSON.stringify({ event: 'applik8s-agent-admission', ...evidence }));
  const observedAt = new Date();
  try {
    await operationAuthority.observe({
      id: 'agent-admission:' + contract.nodeId,
      domain: 'ai',
      subject: contract.name,
      authority: 'canonical',
      state: state === 'admitted' ? 'ready' : 'failed',
      ...(evidence.rejectionCode ? { reason: evidence.rejectionCode } : {}),
      source: 'applik8s-agent-admission',
      evidence,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + 90_000).toISOString(),
    });
  } catch (observationError) {
    console.error(JSON.stringify({
      event: 'applik8s-agent-admission-observation-failed',
      error: applicationAdmissionRejectionCodeV1(observationError),
    }));
  }
}
async function recordUsageFact(reservation, usage) {
  if (!contract.usage || !usage) return;
  if (!reservation.principalScope) {
    throw new Error('AI usage requires the admitted causal principal scope.');
  }
  const pricingRevision = usage.pricingRevision
    ?? selectedRoute.pricingRevision
    ?? 'provider-unpriced';
  const row = {
    id: 'ai:' + reservation.attemptId + ':' + pricingRevision,
    principalScope: reservation.principalScope,
    operationId: 'agent:' + contract.name,
    invocationId: reservation.invocationId,
    protocolRunId: reservation.runId,
    attemptId: reservation.attemptId,
    provider: selectedBackend?.name ?? selectedProvider.name ?? selectedProvider.kind,
    backend: selectedBackend?.endpoint ?? selectedBackend?.name ?? selectedProvider.name ?? selectedProvider.kind,
    logicalModel: contract.model.name,
    ...(Number.isInteger(usage.inputTokens) ? { inputTokens: usage.inputTokens } : {}),
    ...(Number.isInteger(usage.outputTokens) ? { outputTokens: usage.outputTokens } : {}),
    ...(Number.isInteger(usage.cachedInputTokens) ? { cachedInputTokens: usage.cachedInputTokens } : {}),
    ...(Number.isInteger(usage.reasoningTokens) ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(Number.isInteger(usage.costMicrounits) ? { costMicrounits: usage.costMicrounits } : {}),
    pricingRevision,
    confidence: usage.confidence,
    dimensions: {
      agent: contract.name,
      providerClass: selectedProvider.kind,
      route: selectedBackend?.name ?? selectedProvider.name ?? selectedProvider.kind,
      protocolRunId: reservation.runId,
    },
    occurredAt: new Date().toISOString(),
  };
  row.recordedAt = row.occurredAt;
  const admission = reservation.executionAdmission;
  if (!admission) {
    throw new Error('AI usage recording requires the retained server-admitted execution context.');
  }
  const durableContextValues = applicationRequestContextValues(
    admission.principal,
    admission.authorityRevision,
    admission.trustedContext.values,
  );
  const changeScopes = applicationRelationalChangeScopes({
    values: durableContextValues,
    digestSecret: requiredEnv('APPLIK8S_CONTEXT_SECRET'),
  });
  const deliveryId = 'ai-usage:' + reservation.attemptId + ':' + pricingRevision;
  await executePostgresModelCommand({
    bindingId: 'framework.ai-usage.' + contract.name,
    operation: 'create',
    command: {
      name: 'models.' + contract.usage.model.name + '.create',
      version: contract.usage.operation.version,
    },
    errors: Object.keys(contract.usage.operation.errors),
    schemas: {
      input: contract.usage.operation.input.schema,
      output: contract.usage.operation.output.schema,
      errors: Object.fromEntries(
        Object.entries(contract.usage.operation.errors).map(([name, descriptor]) => [name, descriptor.schema]),
      ),
      events: { [usageCreatedEvent.id]: contract.usage.event.payload },
      commands: {},
    },
    model: contract.usage.model,
    message: {
      id: deliveryId,
      input: row,
      targetKey: row.id,
      idempotencyKey: deliveryId,
      correlationId: admission.correlationId,
      causationId: reservation.invocationId,
      recordedAt: row.occurredAt,
      context: {
        values: durableContextValues,
        digest: admission.trustedContext.digest,
        changeScopes,
      },
    },
    history: true,
    outbox: [usageCreatedEvent],
    databaseUrl: requiredEnv(contract.usage.model.connectionEnvName),
    initialize: input => input,
    async handler(target, _input, context) {
      const created = {
        operation: 'create',
        identity: target.identity,
        value: target.value,
      };
      context.emit(usageCreatedEvent, created);
      return { identity: target.identity, value: target.value };
    },
  });
}
${localToolRuntime}
const placementRoutes = new Map([${routeEntries}]);
const workloadEnvelopes = [...new Map(
  [
    ...[...contract.tools, ...contract.operations].map((dependency) => [dependency.operation.id, dependency.workloadAuthority]),
    ...contract.actors.map((dependency) => [dependency.workloadAuthority.operationId, dependency.workloadAuthority]),
  ],
).values()];
const invokeOperation = createApplicationAIOperationExecutor({
  authority: operationAuthority,
  attemptRuntime,
  envelopes: workloadEnvelopes,
  transportSecret: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
  dispatch: {
    async dispatch({ operation, arguments: input, invocationToken, invocationId, idempotencyKey, principal, authorizationReceipt, trustedContext, signal }) {
      const local = localAgentTools.get(operation.id);
      if (local) {
        return local.invoke(input, {
          invocationId,
          idempotencyKey,
          principal,
          authorizationReceipt,
          trustedContext,
          signal,
        });
      }
      const route = placementRoutes.get(operation.id);
      if (!route) throw new Error('AI operation has no compiled placement route.');
      const response = await fetch(runtimeEndpoint(route.baseUrl, route.environmentName, route.path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operationId: operation.id,
          input,
          invocation: invocationToken,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > route.maximumResponseBytes) {
        throw new Error('AI placement response exceeded its configured bound.');
      }
      const responseText = new TextDecoder().decode(bytes);
      let value;
      try {
        value = responseText ? JSON.parse(responseText) : undefined;
      } catch (error) {
        console.error(JSON.stringify({
          event: 'applik8s-ai-operation-placement-response-invalid',
          operationId: operation.id,
          status: response.status,
          contentType: response.headers.get('content-type'),
          responseBytes: bytes.byteLength,
          responseExcerpt: responseText.slice(0, 512),
          error: error instanceof Error ? error.message : String(error),
        }));
        throw new Error(
          'AI placement invocation returned invalid JSON (' + response.status + ').',
          { cause: error },
        );
      }
      if (!response.ok || !value || typeof value !== 'object' || !('value' in value)) {
        const placementError = value && typeof value === 'object'
          && typeof value.error === 'string'
          ? value.error
          : 'invalid_response';
        console.error(JSON.stringify({
          event: 'applik8s-ai-operation-placement-error',
          operationId: operation.id,
          status: response.status,
          error: placementError,
        }));
        throw new Error(
          'AI placement invocation failed (' + response.status + ', ' + placementError + ').',
        );
      }
      return value.value;
    },
  },
});
const handle = createApplicationAIAgentRequestHandler({
  name: contract.name,
  logicalModel: contract.model.name,
  instructions: ${instructions},
  provider: selectedProvider.kind === 'ai-deterministic'
    ? {
        kind: 'deterministic',
        response: typeof selectedProvider.fixture?.response === 'string'
          ? selectedProvider.fixture.response
          : undefined,
        structuredResponse: selectedProvider.fixture?.structuredResponse,
        latencyMs: selectedProvider.latencyMs,
        ...(selectedProvider.fixture?.tool
          ? { tool: selectedProvider.fixture.tool }
          : {}),
      }
    : {
        kind: 'openai-compatible',
        name: selectedBackend?.name ?? selectedProvider.name ?? 'envoy-ai-gateway',
        baseUrl: selectedProvider.provision === false
          ? requiredProviderString(
              selectedBackend?.endpoint,
              'the external backend endpoint',
            )
          : managedOpenAICompatibleBaseUrl(
              requiredEnv('APPLIK8S_AI_GATEWAY_MANAGED_URL'),
            ),
        ...(process.env.APPLIK8S_AI_GATEWAY_API_KEY
          ? { apiKey: process.env.APPLIK8S_AI_GATEWAY_API_KEY }
          : {}),
        allowInsecureHttp:
          selectedProvider.provision !== false
          || selectedBackend?.allowInsecureHttp === true,
        model: selectedProvider.provision === false
          ? requiredProviderString(
              selectedBackend?.model ?? selectedRoute?.concreteModel,
              'the external backend model',
            )
          : contract.model.name,
      },
  tools: contract.tools,
  persistence: conversationPersistence,
  tanstackPersistence({ principal, trustedContext }) {
    return createApplicationTanStackConversationPersistence({
      store: conversationStore,
      principalScope: applicationAgentDurableScope(principal, trustedContext),
    });
  },
  timeoutMs: contract.budgets.timeoutMs,
  maximumConcurrency: contract.deployment.maximumConcurrency,
  ${contract.observability ? 'telemetry: { run: runApplicationTelemetryBoundary },' : ''}
  async admit(request, body) {
    try {
      const telemetry = decodeApplicationAIAgentTelemetry(request.headers);
      const token = request.headers.get('x-applik8s-execution-admission');
      if (!token) throw Object.assign(new Error('Agent execution admission is required.'), { code: 'AGENT_EXECUTION_ADMISSION_REQUIRED' });
      const invocation = decodeApplicationExecutionAdmission(
        requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
        token,
        {
          executionKind: 'agent',
          workloadIdentityId: ${JSON.stringify(workloadIdentity.id)},
          serviceIdentityId: ${JSON.stringify(contract.agent.serviceIdentity.id)},
          audience: ${JSON.stringify(audiences)},
          binding: {
            agentId: contract.nodeId,
            threadId: body.threadId,
            runId: body.runId,
          },
        },
      );
      const causalPrincipal = applicationCausalPrincipalContext(
        invocation.context.principal,
      );
      const principal = await operationAuthority.admitExecutionPrincipal({
        executionKind: 'agent',
        executionId: invocation.executionId,
        attempt: invocation.attempt,
        workloadIdentity: ${JSON.stringify(workloadIdentity)},
        serviceIdentity: contract.serviceIdentity,
        executionContext: {
          kind: 'agent',
          threadId: body.threadId,
          runId: body.runId,
        },
        causalPrincipalId: causalPrincipal.id,
        causalPrincipal: causalPrincipal.identity,
        causalGrantIds: [
          ...new Set([
            ...causalPrincipal.grantIds,
            ...invocation.causalGrantIds,
          ]),
        ],
        envelopes: workloadEnvelopes,
        trustedContextDigest: invocation.context.trustedContext.digest,
        audience: invocation.audience,
        deadline: invocation.expiresAt,
        cancellationRevision: invocation.cancellationRevision,
      });
      const context = validateApplicationAdmissionContextV1({
        ...invocation.context,
        principal,
        authorityRevision: principal.authorityRevision,
        trustedContext: {
          values: invocation.context.trustedContext.values,
          digest: principal.trustedContextDigest,
        },
      });
      await observeAgentAdmission('admitted', context);
      return { context, ...(telemetry ? { telemetry } : {}) };
    } catch (error) {
      await observeAgentAdmission('rejected', undefined, error);
      throw error;
    }
  },
  async reserveAttempt({ principal, admission, trustedContext, threadId, runId, logicalModel, request, telemetry }) {
    const invocationId = 'invocation_' + createHash('sha256')
      .update(contract.application)
      .update('\\0')
      .update(contract.nodeId)
      .update('\\0')
      .update(principal.id)
      .update('\\0')
      .update(runId)
      .digest('hex');
    await attemptRuntime.reserveInvocation({
      invocationId,
      conversationId: threadId,
      protocolRunId: runId,
      agentRunId: principal.executionId,
      logicalModel,
      request,
      admittedPrincipal: principal,
      admission,
      telemetry,
    });
    const decision = await attemptRuntime.reserveAttempt({
      invocationId,
      redactedRequestMetadata: {
        threadId,
        runId,
        messageCount: request.messages.length,
      },
      route: selectedRoute,
      retry: contract.executionPolicy.uncertainCompletion === 'retry-if-replay-safe'
        ? 'if-replay-safe'
        : 'never',
    });
    await operationAuthority.observe({
      id: ${JSON.stringify(`ai-agent:${contract.agent.id}`)},
      domain: 'ai',
      subject: contract.name,
      authority: 'canonical',
      state: 'running',
      source: 'application-ai-attempt-runtime',
      causalId: invocationId,
      evidence: {
        logicalModel,
        invocationId,
        attemptId: decision.attempt.id,
        recovery: decision.attempt.recovery,
        quarantine: false,
      },
      observedAt: new Date().toISOString(),
    });
    return {
      action: decision.action,
      runId,
      invocationId,
      attemptId: decision.attempt.id,
      ordinal: decision.attempt.ordinal,
      version: decision.attempt.version,
      principalScope: applicationAgentDurableScope(principal, trustedContext),
      executionAdmission: admission,
      ...(decision.invocation.telemetry
        ? { telemetry: decision.invocation.telemetry }
        : {}),
    };
  },
  recovery: {
    observe: (invocationId) => attemptRuntime.observe(invocationId),
    timeoutMs: contract.budgets.timeoutMs,
  },
  attemptLifecycle: {
    async dispatching(reservation) {
      const attempt = await attemptRuntime.transition(
        reservation.invocationId,
        reservation.attemptId,
        reservation.version,
        { state: 'dispatching', recovery: 'joinable' },
      );
      return { ...reservation, version: attempt.version };
    },
    async append(reservation, event) {
      await attemptRuntime.appendDelta(
        reservation.invocationId,
        reservation.attemptId,
        event,
      );
      return { ...reservation, version: reservation.version + 1 };
    },
    async completeProvider(reservation, terminal) {
      const usage = terminal.usage
        ? {
            apiVersion: 'applik8s.aiUsage/v1alpha1',
            invocationId: reservation.invocationId,
            attemptId: reservation.attemptId,
            ...(Number.isInteger(terminal.usage.promptTokens)
              ? { inputTokens: terminal.usage.promptTokens }
              : {}),
            ...(Number.isInteger(terminal.usage.completionTokens)
              ? { outputTokens: terminal.usage.completionTokens }
              : {}),
            ...(Number.isInteger(terminal.usage.cachedInputTokens)
              ? { cachedInputTokens: terminal.usage.cachedInputTokens }
              : {}),
            ...(Number.isInteger(terminal.usage.reasoningTokens)
              ? { reasoningTokens: terminal.usage.reasoningTokens }
              : {}),
            ...(Number.isInteger(terminal.usage.costMicrounits)
              ? { costMicrounits: terminal.usage.costMicrounits }
              : {}),
            ...(typeof terminal.usage.pricingRevision === 'string'
              && terminal.usage.pricingRevision
              ? { pricingRevision: terminal.usage.pricingRevision }
              : {}),
            confidence: terminal.usage.confidence === 'calculated'
              ? 'calculated'
              : terminal.usage.confidence === 'unknown'
              ? 'unknown'
              : 'provider-reported',
          }
        : contract.usage
          ? {
              apiVersion: 'applik8s.aiUsage/v1alpha1',
              invocationId: reservation.invocationId,
              attemptId: reservation.attemptId,
              inputTokens: Number.isInteger(terminal.estimatedInputTokens)
                ? terminal.estimatedInputTokens
                : 1,
              outputTokens: Number.isInteger(terminal.estimatedOutputTokens)
                ? terminal.estimatedOutputTokens
                : 1,
              confidence: 'calculated',
            }
          : undefined;
      await recordUsageFact(reservation, usage);
      const attempt = await attemptRuntime.transition(
        reservation.invocationId,
        reservation.attemptId,
        reservation.version,
        {
          state: 'provider-completed',
          recovery: 'terminal',
          ...(usage ? { usage } : {}),
        },
      );
      return { ...reservation, version: attempt.version };
    },
    async commitCanonical(reservation, terminal) {
      const attempt = await attemptRuntime.commitCanonicalResult(
        reservation.invocationId,
        reservation.attemptId,
        terminal.messageId,
        ${contract.agent.invocation ? 'JSON.parse(terminal.content)' : 'undefined'},
      );
      await operationAuthority.observe({
        id: ${JSON.stringify(`ai-agent:${contract.agent.id}`)},
        domain: 'ai',
        subject: contract.name,
        authority: 'canonical',
        state: 'succeeded',
        source: 'application-ai-attempt-runtime',
        causalId: reservation.invocationId,
        evidence: {
          logicalModel: contract.model.name,
          invocationId: reservation.invocationId,
          attemptId: reservation.attemptId,
          canonicalMessageId: terminal.messageId,
          quarantine: false,
        },
        observedAt: new Date().toISOString(),
      });
      return { ...reservation, version: attempt.version };
    },
    async fail(reservation, failure) {
      if (failure.classification === 'cancelled') {
        await attemptRuntime.cancel(
          reservation.invocationId,
          failure.reason,
        );
        await operationAuthority.observe({
          id: ${JSON.stringify(`ai-agent:${contract.agent.id}`)},
          domain: 'ai',
          subject: contract.name,
          authority: 'canonical',
          state: 'cancelled',
          reason: 'cancelled',
          source: 'application-ai-attempt-runtime',
          causalId: reservation.invocationId,
          evidence: {
            logicalModel: contract.model.name,
            invocationId: reservation.invocationId,
            attemptId: reservation.attemptId,
            quarantine: false,
          },
          observedAt: new Date().toISOString(),
        });
        return { ...reservation, version: reservation.version + 1 };
      }
      const attempt = await attemptRuntime.transition(
        reservation.invocationId,
        reservation.attemptId,
        reservation.version,
        {
          state: failure.classification,
          recovery: failure.classification === 'completion-uncertain'
            ? 'uncertain'
            : 'terminal',
          terminalReason: failure.reason,
        },
      );
      await operationAuthority.observe({
        id: ${JSON.stringify(`ai-agent:${contract.agent.id}`)},
        domain: 'ai',
        subject: contract.name,
        authority: 'canonical',
        state: failure.classification === 'completion-uncertain'
          ? 'degraded'
          : 'failed',
        reason: failure.classification,
        source: 'application-ai-attempt-runtime',
        causalId: reservation.invocationId,
        evidence: {
          logicalModel: contract.model.name,
          invocationId: reservation.invocationId,
          attemptId: reservation.attemptId,
          recovery: failure.classification === 'completion-uncertain'
            ? 'operator-review-required'
            : 'terminal',
          quarantine: failure.classification === 'completion-uncertain',
        },
        observedAt: new Date().toISOString(),
      });
      return { ...reservation, version: attempt.version };
    },
  },
  invoke: (operation, input, invocation, admission) =>
    invokeOperation(operation, input, {
      ...invocation,
      context: admission.context,
    }),
  handler,
});
let ready = false;
let stopping = false;
let lastDependencyError;
const activeRequestControllers = new Set();
const initializationController = new AbortController();
async function initializeDependencies() {
  let attempt = 0;
  let delayMs = 250;
  while (!stopping) {
    attempt += 1;
    try {
      await attemptStore.prepare();
      await conversationStore.prepare();
      await operationAuthority.prepare();
      ready = true;
      lastDependencyError = undefined;
      return;
    } catch (error) {
      ready = false;
      lastDependencyError = error instanceof Error
        ? error.message
        : 'Application agent dependency initialization failed.';
      console.error(JSON.stringify({
        event: 'applik8s-agent-startup-wait',
        agent: contract.name,
        attempt,
        error: lastDependencyError,
      }));
      await abortableSleep(delayMs, initializationController.signal);
      delayMs = Math.min(5_000, delayMs * 2);
    }
  }
}
function abortableSleep(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveSleep) => {
    const timeout = setTimeout(done, ms);
    const abort = () => done();
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolveSleep();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
const server = createServer(async (request, response) => {
  const requestController = new AbortController();
  let responseCompleted = false;
  const abortRequest = () => {
    if (!responseCompleted) {
      requestController.abort(new Error('Application agent request disconnected.'));
    }
  };
  activeRequestControllers.add(requestController);
  request.once('aborted', abortRequest);
  response.once('close', abortRequest);
  try {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? 'localhost'));
  if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
    const healthy = url.pathname === '/healthz' || (ready && !stopping);
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      live: true,
      ready,
      stopping,
      ...(lastDependencyError ? { lastDependencyError } : {}),
    }));
    return;
  }
  if (!ready || stopping) {
    response.writeHead(503, {
      'content-type': 'application/json',
      'retry-after': '1',
    });
    response.end(JSON.stringify({ error: 'agent_dependencies_unavailable' }));
    return;
  }
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : request;
  const webRequest = new Request(url, {
    method: request.method,
    headers: request.headers,
    signal: requestController.signal,
    ...(body ? { body, duplex: 'half' } : {}),
  });
  const result = await handle(webRequest);
  response.writeHead(result.status, Object.fromEntries(result.headers));
  if (!result.body) {
    response.end();
    return;
  }
  for await (const chunk of result.body) response.write(chunk);
  response.end();
  } catch (error) {
    if (!requestController.signal.aborted) {
      console.error('Applik8s application agent request failed', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: 'agent_request_failed' }));
    }
  } finally {
    responseCompleted = true;
    activeRequestControllers.delete(requestController);
    request.removeListener('aborted', abortRequest);
    response.removeListener('close', abortRequest);
  }
});
server.listen(contract.deployment.port, '0.0.0.0');
const initializationTask = initializeDependencies();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  initializationController.abort();
  const force = setTimeout(() => {
    for (const controller of activeRequestControllers) {
      controller.abort(new Error('Application agent graceful shutdown expired.'));
    }
    server.closeAllConnections?.();
  }, contract.deployment.gracefulShutdownSeconds * 1_000);
  force.unref?.();
  server.closeIdleConnections?.();
  await new Promise((resolveShutdown) => server.close(resolveShutdown));
  clearTimeout(force);
  await initializationTask;
  await sql.end({ timeout: 5 });
  ${contract.observability ? 'await closeApplicationTelemetryRuntime();' : ''}
}
function terminate(signal) {
  const deadline = setTimeout(() => {
    console.error('Application agent exceeded its bounded shutdown deadline', { signal });
    process.exit(1);
  }, (contract.deployment.gracefulShutdownSeconds + 10) * 1_000);
  deadline.unref?.();
  void shutdown().then(
    () => {
      clearTimeout(deadline);
      process.exit(0);
    },
    (error) => {
      clearTimeout(deadline);
      console.error('Application agent shutdown failed', error);
      process.exit(1);
    },
  );
}
process.once('SIGTERM', () => terminate('SIGTERM'));
process.once('SIGINT', () => terminate('SIGINT'));
`;
}

function generatedLocalAgentToolRuntime(
  contract: ApplicationAgentCompilerContract,
): string {
  const localTools = contract.tools.flatMap((tool, index) =>
    tool.local ? [{ tool, local: tool.local, index }] : []);
  if (localTools.length === 0) {
    return 'const localAgentTools = new Map();';
  }
  const graphNodes = new Map(
    contract.graph.nodes.map((node) => [node.id, node]),
  );
  const declarations = localTools.map(({ tool, local, index }) => {
    const transaction = local.functionNativeTransaction;
    const primary = graphNodes.get(transaction.primaryModel.nodeId);
    if (primary?.kind !== 'model' || !primary.runtime) {
      throw new Error(
        `Application agent ${contract.agent.id} local tool ${tool.operation.id} primary model ${transaction.primaryModel.nodeId} has no PostgreSQL runtime.`,
      );
    }
    const models = transaction.models.map((reference) => {
      const model = graphNodes.get(reference.nodeId);
      if (model?.kind !== 'model' || !model.runtime) {
        throw new Error(
          `Application agent ${contract.agent.id} local tool ${tool.operation.id} participant ${reference.nodeId} has no PostgreSQL runtime.`,
        );
      }
      return model.runtime;
    });
    const outbox = transaction.outbox.map((reference) => {
      const event = graphNodes.get(reference.nodeId);
      if (event?.kind !== 'event') {
        throw new Error(
          `Application agent ${contract.agent.id} local tool ${tool.operation.id} outbox ${reference.nodeId} is not an event.`,
        );
      }
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
    const bindings = localAgentToolBindingsSource(
      contract.graph,
      local,
    );
    return `
{
  const bindings = ${bindings};
  const authored = createLocalTool${index}(bindings);
  localAgentTools.set(${JSON.stringify(tool.operation.id)}, Object.freeze({
    async invoke(input, context) {
      const validInput = validateLocalToolValue(${JSON.stringify(local.input.jsonSchema)}, input, ${JSON.stringify(`${tool.operation.id}.input`)});
      const durableContextValues = applicationRequestContextValues(
        context.principal,
        context.principal.authorityRevision,
        context.trustedContext,
      );
      const changeScopes = applicationRelationalChangeScopes({
        values: durableContextValues,
        digestSecret: requiredEnv('APPLIK8S_CONTEXT_SECRET'),
      });
      const invokeWithModelReads = async () => withApplicationNativeModelReadClients(
        await applicationPostgresModelReadClients(
          requiredEnv(${JSON.stringify(primary.runtime.connectionEnvName)}),
          ${JSON.stringify(models)},
          {
            values: durableContextValues,
            digest: context.principal.trustedContextDigest,
            changeScopes,
          },
        ),
        () => authored(validInput),
      );
      const result = await ${transaction.mode === 'read' ? 'invokeWithModelReads()' : `withApplicationNativeModelTransactionRuntime(
        Object.freeze({
          edit: request => executeFunctionNativePostgresModelEdit({
            bindingId: ${JSON.stringify(`${contract.agent.id}:${tool.operation.id}`)},
            model: ${JSON.stringify(primary.runtime)},
            models: ${JSON.stringify(models)},
            outbox: ${JSON.stringify(outbox)},
            databaseUrl: requiredEnv(${JSON.stringify(primary.runtime.connectionEnvName)}),
            delivery: {
              id: context.idempotencyKey,
              idempotencyKey: context.idempotencyKey,
              correlationId: context.invocationId,
              causationId: context.invocationId,
              recordedAt: new Date().toISOString(),
              context: {
                values: durableContextValues,
                digest: context.principal.trustedContextDigest,
                changeScopes,
              },
              authorizationReceipt: context.authorizationReceipt,
            },
            revalidateAuthorization: (receipt, boundary, authorization) =>
              operationAuthority.revalidate(
                receipt,
                boundary,
                authorization.trustedContextDigest,
                authorization.transaction,
              ),
          }, request),
        }),
        invokeWithModelReads,
      )`};
      return validateLocalToolValue(${JSON.stringify(local.output.jsonSchema)}, result, ${JSON.stringify(`${tool.operation.id}.output`)});
    },
  }));
}`;
  }).join('\n');
  return `
function localToolSchema(json, name) {
  return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json };
}
function validateLocalToolValue(json, value, name) {
  const normalized = normalizeSchema(localToolSchema(json, name), name);
  const result = normalized.validate(value);
  if (!result.ok) throw new Error('Application agent local tool ' + name + ' failed schema validation: ' + result.error.message);
  return result.value;
}
function localToolModelSnapshot(value) {
  return value ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) } : undefined;
}
function localToolModelHandle(name) {
  return Object.freeze({
    get: async identity => localToolModelSnapshot(await getApplicationNativeModelObject(name, identity)),
    find: async options => (await findApplicationNativeModelObjects(name, options)).items.map(localToolModelSnapshot),
    require: async identity => localToolModelSnapshot(await requireApplicationNativeModelObject(name, identity)),
    edit: (identity, handler) => editApplicationNativeModelObject(name, identity, handler),
  });
}
const localAgentTools = new Map();
${declarations}`;
}

function localAgentToolBindingsSource(
  graph: ApplicationGraph,
  local: NonNullable<ApplicationAIAgentNode['tools'][number]['local']>,
): string {
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const entries = new Map<
    string,
    { readonly target: string; readonly value: string }
  >();
  for (const binding of local.functionNativeTransaction.modelBindings) {
    const model = graphNodes.get(binding.model.nodeId);
    if (model?.kind !== 'model') {
      throw new Error(
        `Local agent tool binding ${binding.identifier} references missing model ${binding.model.nodeId}.`,
      );
    }
    const segments = localAgentToolBindingSegments(binding.identifier);
    const method = segments.at(-1);
    const runtimeMethod = method !== undefined
      && ['get', 'find', 'require', 'edit'].includes(method);
    const methods: readonly string[] = runtimeMethod && method
      ? [method]
      : ['get', 'find', 'require', 'edit'];
    for (const runtimeMethodName of methods) {
      const path = runtimeMethod
        ? binding.identifier
        : `${binding.identifier}.${runtimeMethodName}`;
      const previous = entries.get(path);
      if (previous && previous.target !== model.id) {
        throw new Error(
          `Local agent tool binding ${path} is ambiguous between ${previous.target} and ${model.id}.`,
        );
      }
      entries.set(path, {
        target: model.id,
        value: `localToolModelHandle(${JSON.stringify(model.name)})[${JSON.stringify(runtimeMethodName)}]`,
      });
    }
  }
  for (const binding of local.functionNativeTransaction.eventBindings ?? []) {
    const event = graphNodes.get(binding.event.nodeId);
    if (event?.kind !== 'event') {
      throw new Error(
        `Local agent tool binding ${binding.identifier} references missing event ${binding.event.nodeId}.`,
      );
    }
    const segments = localAgentToolBindingSegments(binding.identifier);
    const path = segments.at(-1) === 'emit'
      ? binding.identifier
      : `${binding.identifier}.emit`;
    const previous = entries.get(path);
    if (previous && previous.target !== event.id) {
      throw new Error(
        `Local agent tool binding ${path} is ambiguous between ${previous.target} and ${event.id}.`,
      );
    }
    entries.set(path, {
      target: event.id,
      value: `createApplicationFunctionNativeEventHandle(${JSON.stringify(`${event.contract.name}.${event.contract.version}`)}, { payload: localToolSchema(${JSON.stringify(event.contract.payload.jsonSchema)}, ${JSON.stringify(`${event.name}.payload`)}) }).emit`,
    });
  }
  return localAgentToolBindingObjectSource(
    [...entries.entries()].map(([path, binding]) => ({
      path,
      value: binding.value,
    })),
  );
}

function localAgentToolBindingObjectSource(
  entries: readonly { readonly path: string; readonly value: string }[],
): string {
  interface Node {
    direct?: string;
    readonly children: Map<string, Node>;
  }
  const root: Node = { children: new Map() };
  for (const entry of entries) {
    const segments = localAgentToolBindingSegments(entry.path);
    let current = root;
    for (const segment of segments) {
      const child = current.children.get(segment) ?? {
        children: new Map<string, Node>(),
      };
      current.children.set(segment, child);
      current = child;
    }
    if (current.direct && current.direct !== entry.value) {
      throw new Error(
        `Local agent tool binding ${entry.path} resolves to multiple runtime values.`,
      );
    }
    current.direct = entry.value;
  }
  const render = (node: Node): string => {
    if (node.direct && node.children.size === 0) return node.direct;
    return `{ ${[...node.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => `${JSON.stringify(name)}: ${render(child)}`)
      .join(', ')} }`;
  };
  return render(root);
}

function localAgentToolBindingRoot(identifier: string): string {
  const root = identifier.split('.')[0]?.trim();
  if (!root || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) {
    throw new Error(
      `Local agent tool callback binding ${JSON.stringify(identifier)} does not have a serializable root identifier.`,
    );
  }
  return root;
}

function localAgentToolBindingSegments(identifier: string): readonly string[] {
  const segments = identifier.split('.').map((segment) => segment.trim());
  if (
    segments.length === 0
    || segments.some(
      (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
    )
  ) {
    throw new Error(
      `Local agent tool callback binding ${JSON.stringify(identifier)} is not a serializable property path.`,
    );
  }
  return segments;
}

function localAgentToolBindingRoots(
  local: NonNullable<ApplicationAIAgentNode['tools'][number]['local']>,
): readonly string[] {
  return [
    ...local.functionNativeTransaction.modelBindings.map(
      (binding) => localAgentToolBindingRoot(binding.identifier),
    ),
    ...(local.functionNativeTransaction.eventBindings ?? []).map(
      (binding) => localAgentToolBindingRoot(binding.identifier),
    ),
  ].filter(
    (identifier, index, values) =>
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
      && values.indexOf(identifier) === index,
  );
}

function localAgentToolModuleFile(index: number): string {
  return `tool-${index}.generated.ts`;
}

function generatedAgentFrameworkCredentialEnvironment(
  contract: ApplicationAgentCompilerContract,
  credentials: readonly ApplicationFrameworkCredentialDependency[],
): readonly Readonly<Record<string, unknown>>[] {
  const applicationName = kubernetesName(contract.graph.metadata.name);
  return credentials.map((credential) => {
    const secretKeyRef = (() => {
      switch (credential.kind) {
        case 'agent-query-context':
          if (!contract.queryCursorSecret) {
            throw new Error(
              `Generated agent ${contract.agent.id} consumes ${credential.environmentName} without a query cursor Secret contract.`,
            );
          }
          return {
            name: contract.queryCursorSecret.name,
            key: contract.queryCursorSecret.key,
            optional: false,
          };
        case 'context':
          return {
            name: `${applicationName}-context`,
            key: 'key',
            optional: false,
          };
        case 'internal-operation':
          return {
            name: `${applicationName}-internal-operation`,
            key: 'key',
            optional: false,
          };
        default:
          throw new Error(
            `Generated agent ${contract.agent.id} consumes unsupported framework credential ${credential.kind} (${credential.environmentName}).`,
          );
      }
    })();
    return {
      name: credential.environmentName,
      valueFrom: { secretKeyRef },
    };
  });
}

function generatedAgentResources(
  contract: ApplicationAgentCompilerContract,
  image: string,
  digest: string,
  frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[],
): readonly GeneratedApplicationAgentResource[] {
  const name = kubernetesName(contract.agent.name);
  const deploymentProvider = applicationAgentProviderForTarget(
    contract.providerConfig,
    'kubernetes',
  );
  const credentialSecret = applicationAgentCredentialSecret(
    deploymentProvider,
    contract.agent.model.name,
  );
  const profileSelector = compatibleAgentProfileSelector(
    contract.agent,
    applicationAgentProfileSelector(deploymentProvider),
    contract.callableProviderProfileSelector,
  );
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'ai-agent',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const metadata = { name, namespace: contract.namespace, labels };
  return [
    {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata,
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata,
      spec: {
        selector: labels,
        ports: [
          {
            name: 'http',
            port: contract.agent.deployment.port,
            targetPort: 'http',
          },
        ],
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        ...metadata,
        annotations: { 'applik8s.dev/source-digest': digest },
      },
      spec: {
        replicas: contract.agent.deployment.replicas,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
        },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/source-digest': digest } },
          spec: {
            serviceAccountName: name,
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds:
              contract.agent.deployment.gracefulShutdownSeconds,
            containers: [
              {
                name: 'agent',
                image,
                imagePullPolicy: 'IfNotPresent',
                ports: [
                  {
                    name: 'http',
                    containerPort: contract.agent.deployment.port,
                  },
                ],
                env: uniqueAgentEnvironment([
                  { name: 'NODE_ENV', value: 'production' },
                  { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
                  { name: 'APPLIK8S_DEPLOYMENT_TARGET', value: 'kubernetes' },
                  ...(profileSelector
                    ? [{
                        name: 'APPLIK8S_PROFILE_VARIANT',
                        value: profileSelector,
                      }]
                    : []),
                  ...(applicationAgentHasManagedEnvoy(
                    deploymentProvider,
                  )
                    ? [{
                        name: 'APPLIK8S_AI_GATEWAY_MANAGED_URL',
                        value:
                          applicationOptionalDeploymentOutputReference(
                            `direct.${applicationAgentPhysicalProviderId(contract.graph, contract.provider)}.envoy-ai-gateway`,
                            'endpoint',
                          ),
                      }]
                    : []),
                  ...(credentialSecret
                    ? [{
                        name:
                          credentialSecret.environmentName
                          ?? 'APPLIK8S_AI_GATEWAY_API_KEY',
                        valueFrom: {
                          secretKeyRef: {
                            name: credentialSecret.name,
                            key: credentialSecret.key,
                            optional: credentialSecret.optional,
                          },
                        },
                      }]
                    : []),
                  {
                    name: contract.state.connectionEnvName,
                    valueFrom: {
                      secretKeyRef: {
                        name: contract.state.secretName,
                        key: contract.state.secretKey,
                        optional: false,
                      },
                    },
                  },
                  ...generatedAgentFrameworkCredentialEnvironment(
                    contract,
                    frameworkCredentials,
                  ),
                  ...(contract.actorApplicationEndpoint
                    ? [{
                        name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT',
                        value: contract.actorApplicationEndpoint,
                      }]
                    : []),
                  ...applicationCallableProviderEnvironment(
                    contract.callableProviders,
                    { target: 'kubernetes', namespace: contract.namespace },
                  ),
                ]),
                readinessProbe: {
                  httpGet: {
                    path: '/readyz',
                    port: 'http',
                  },
                  initialDelaySeconds: 1,
                  periodSeconds: 3,
                  timeoutSeconds: 2,
                  failureThreshold: 10,
                },
                livenessProbe: {
                  httpGet: {
                    path: '/healthz',
                    port: 'http',
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                  failureThreshold: 3,
                },
                resources: generatedAgentWorkerResources(),
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  capabilities: { drop: ['ALL'] },
                },
              },
            ],
            securityContext: {
              seccompProfile: { type: 'RuntimeDefault' },
            },
          },
        },
      },
    },
  ];
}

interface AgentProviderRuntimeOperation {
  readonly binding: ApplicationCallableProviderBinding;
  readonly runtime: ApplicationCallableProviderRuntimeOperation;
  readonly variable: string;
}

function agentProviderRuntimeOperations(
  agent: ApplicationAIAgentNode,
): readonly AgentProviderRuntimeOperation[] {
  return (agent.providerBindings ?? []).flatMap((binding) => {
    if (!binding.operation) {
      if (
        binding.placement === 'objectStore'
        && binding.provider.interface === 'ObjectStorage'
      ) return [];
      throw new Error(
        `Application agent ${agent.id} provider binding ${binding.identifier} has no callable operation metadata. Provider placement without an exact operation cannot hydrate a generated agent worker.`,
      );
    }
    const runtime = binding.operation.runtime;
    if (!runtime) {
      throw new Error(
        `Application agent ${agent.id} provider binding ${binding.identifier} has no public static runtime operation. Define the operation in the provider runtime contract; generated agent workers never replay authoring-time provider selection.`,
      );
    }
    if (
      !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*|[a-z0-9][a-z0-9._/-]*)$/u.test(
        runtime.module,
      )
      || runtime.module.includes('..')
      || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(runtime.export)
    ) {
      throw new Error(
        `Application agent ${agent.id} provider binding ${binding.identifier} has an invalid public runtime export ${runtime.module}#${runtime.export}.`,
      );
    }
    const segments = binding.identifier.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment),
      )
    ) {
      throw new Error(
        `Application agent ${agent.id} provider binding ${binding.identifier} is not a static JavaScript binding path.`,
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

function uniqueAgentProviderRuntimeOperations(
  agent: ApplicationAIAgentNode,
): readonly AgentProviderRuntimeOperation[] {
  return agentProviderRuntimeOperations(agent).filter(
    (operation, index, operations) =>
      operations.findIndex(
        (candidate) => candidate.variable === operation.variable,
      ) === index,
  );
}

function uniqueAgentEnvironment(
  entries: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  const result = new Map<string, Readonly<Record<string, unknown>>>();
  for (const entry of entries) {
    const name = String(entry.name ?? '');
    if (!name) throw new Error('Generated agent environment entry has no name.');
    const previous = result.get(name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(
        `Generated agent workload declares conflicting environment ${name}.`,
      );
    }
    result.set(name, entry);
  }
  return [...result.values()];
}

async function writeCallbackModule(
  directory: string,
  name: string,
  source: string,
  dependencies?: ApplicationHandlerDependencies,
): Promise<void> {
  const dependencySource = dependencies?.source
    ? absoluteDependencyImports(dependencies.source, dependencies.resolveDir)
    : '';
  await writeFile(
    join(directory, `${name}.generated.ts`),
    `${dependencySource}${dependencySource ? '\n\n' : ''}export const callback = (${source});\n`,
  );
}

function absoluteDependencyImports(source: string, resolveDir: string): string {
  return source
    .replace(
      /(\bfrom\s+['"])(\.[^'"]+)(['"])/g,
      (_match, prefix: string, specifier: string, suffix: string) =>
        `${prefix}${resolve(resolveDir, specifier)}${suffix}`,
    )
    .replace(
      /(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g,
      (_match, line: string, prefix: string, specifier: string, suffix: string) =>
        `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`,
    );
}

function kubernetesName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error(`Application agent name ${JSON.stringify(value)} is empty.`);
  if (normalized.length <= 63) return normalized;
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 10);
  return `${normalized.slice(0, 52).replace(/-+$/g, '')}-${hash}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function applicationAgentRoute(
  agent: ApplicationAIAgentNode,
  provider: JsonObject,
): JsonObject {
  if (provider.kind === 'application-target-provider-selection') {
    const targets = isJsonObject(provider.targets) ? provider.targets : {};
    const routes = Object.fromEntries(
      Object.entries(targets).map(([target, candidate]) => {
        if (!isJsonObject(candidate)) {
          throw new Error(
            `Application agent ${agent.id} target ${target} has no portable AI provider configuration.`,
          );
        }
        return [target, applicationAgentRoute(agent, candidate)];
      }),
    );
    if (Object.keys(routes).length === 0) {
      throw new Error(
        `Application agent ${agent.id} AI provider selection has no deployment-target branches.`,
      );
    }
    return {
      kind: 'application-target-provider-selection',
      targets: routes,
    };
  }
  if (provider.kind === 'application-provider-selection') {
    const selector = stringValue(provider.selector);
    if (!selector) {
      throw new Error(
        `Application agent ${agent.id} AI provider selection has no stable profile selector.`,
      );
    }
    const cases = isJsonObject(provider.cases) ? provider.cases : {};
    const routes = Object.fromEntries(
      Object.entries(cases).map(([variant, candidate]) => {
        if (!isJsonObject(candidate)) {
          throw new Error(
            `Application agent ${agent.id} profile ${variant} has no portable AI provider configuration.`,
          );
        }
        return [variant, applicationAgentRoute(agent, candidate)];
      }),
    );
    if (Object.keys(routes).length === 0) {
      throw new Error(
        `Application agent ${agent.id} AI provider selection has no profile branches.`,
      );
    }
    const fallback = isJsonObject(provider.default)
      ? applicationAgentRoute(agent, provider.default)
      : undefined;
    return {
      kind: 'application-provider-selection',
      selector,
      cases: routes,
      ...(fallback ? { default: fallback } : {}),
    };
  }
  const policyRevision = `sha256:${createHash('sha256')
    .update(JSON.stringify(provider))
    .digest('hex')}`;
  if (provider.kind === 'ai-deterministic') {
    return {
      policyRevision,
      logicalModel: agent.model.name,
      providerClass: 'deterministic',
      backend: 'deterministic',
      concreteModel: 'deterministic',
      capabilities: [...agent.model.capabilities],
      route: `deterministic/${agent.model.name}`,
      fallbackChain: [],
    };
  }
  if (provider.kind !== 'envoy-ai-gateway') {
    throw new Error(
      `Application agent ${agent.id} uses unsupported AI provider ${String(provider.kind)}.`,
    );
  }
  const models = isJsonObject(provider.models) ? provider.models : undefined;
  const modelRouteCandidate = models?.[agent.model.name];
  const modelRoute = isJsonObject(modelRouteCandidate)
    ? modelRouteCandidate
    : undefined;
  const backends: JsonObject[] = modelRoute && Array.isArray(modelRoute.backends)
    ? modelRoute.backends.filter(isJsonObject)
    : [];
  const selected = backends[0];
  if (!selected
    || typeof selected.name !== 'string'
    || typeof selected.providerClass !== 'string'
    || typeof selected.model !== 'string') {
    throw new Error(
      `Application agent ${agent.id} logical model ${agent.model.name} has no valid Envoy AI Gateway backend route.`,
    );
  }
  return {
    policyRevision,
    logicalModel: agent.model.name,
    providerClass: selected.providerClass,
    backend: selected.name,
    concreteModel: selected.model,
    capabilities: Array.isArray(selected.capabilities)
      ? selected.capabilities
      : [...agent.model.capabilities],
    route: `envoy-ai-gateway/${agent.model.name}`,
    fallbackChain: backends
      .slice(1)
      .map((backend) => backend.name)
      .filter((name): name is string => typeof name === 'string'),
  };
}

function applicationAgentProfileSelector(provider: JsonObject): string | undefined {
  if (
    provider.kind !== 'application-provider-selection'
    || typeof provider.selector !== 'string'
  ) {
    return undefined;
  }
  const match = /^schema\.spec\.([A-Za-z_][A-Za-z0-9_.]*)$/u.exec(
    provider.selector,
  );
  if (!match?.[1]) {
    throw new Error(
      `Application AI provider selector ${JSON.stringify(provider.selector)} cannot be lowered to a workload profile binding.`,
    );
  }
  return `\${schema.spec.${match[1]}}`;
}

function applicationCallableProviderProfileSelector(
  agent: ApplicationAIAgentNode,
  providers: readonly ApplicationProviderNode[],
): string | undefined {
  const selectors = new Set(
    providers.flatMap((provider) => {
      const profile = isJsonObject(provider.config?.profile)
        ? provider.config.profile
        : undefined;
      const selectedBy = profile && typeof profile.selectedBy === 'string'
        ? profile.selectedBy.trim()
        : '';
      if (!selectedBy) return [];
      const expression = selectedBy.startsWith('${') && selectedBy.endsWith('}')
        ? selectedBy.slice(2, -1)
        : selectedBy;
      const match = /^schema\.spec\.([A-Za-z_][A-Za-z0-9_.]*)$/u.exec(expression);
      if (!match?.[1]) {
        throw new Error(
          `Application agent ${agent.id} callable provider ${provider.id} selector ${JSON.stringify(selectedBy)} cannot be lowered to a workload profile binding.`,
        );
      }
      return [`\${schema.spec.${match[1]}}`];
    }),
  );
  if (selectors.size > 1) {
    throw new Error(
      `Application agent ${agent.id} reaches callable providers selected by incompatible profiles: ${[...selectors].sort().join(', ')}.`,
    );
  }
  return [...selectors][0];
}

function compatibleAgentProfileSelector(
  agent: ApplicationAIAgentNode,
  inferenceSelector: string | undefined,
  callableSelector: string | undefined,
): string | undefined {
  if (
    inferenceSelector
    && callableSelector
    && inferenceSelector !== callableSelector
  ) {
    throw new Error(
      `Application agent ${agent.id} inference and callable providers use incompatible profile selectors ${JSON.stringify(inferenceSelector)} and ${JSON.stringify(callableSelector)}.`,
    );
  }
  return inferenceSelector ?? callableSelector;
}

function applicationAgentProviderForTarget(
  provider: JsonObject,
  target: 'local' | 'aws-local' | 'aws' | 'kubernetes',
): JsonObject {
  if (provider.kind === 'application-target-provider-selection') {
    const targets = isJsonObject(provider.targets) ? provider.targets : {};
    const selected = targets[target];
    if (!isJsonObject(selected)) {
      throw new Error(
        `Application AI provider has no ${target} deployment-target branch.`,
      );
    }
    return applicationAgentProviderForTarget(selected, target);
  }
  if (provider.kind !== 'application-provider-selection') return provider;
  const cases = isJsonObject(provider.cases) ? provider.cases : {};
  return {
    ...provider,
    cases: Object.fromEntries(
      Object.entries(cases).map(([variant, candidate]) => {
        if (!isJsonObject(candidate)) {
          throw new Error(
            `Application AI profile ${variant} has no portable provider configuration.`,
          );
        }
        return [variant, applicationAgentProviderForTarget(candidate, target)];
      }),
    ),
    ...(isJsonObject(provider.default)
      ? { default: applicationAgentProviderForTarget(provider.default, target) }
      : {}),
  };
}

function applicationAgentHasManagedEnvoy(provider: JsonObject): boolean {
  if (provider.kind === 'envoy-ai-gateway') {
    return provider.provision !== false;
  }
  if (provider.kind !== 'application-provider-selection') return false;
  const cases = isJsonObject(provider.cases) ? Object.values(provider.cases) : [];
  return [...cases, provider.default].some(
    (candidate) =>
      isJsonObject(candidate)
      && candidate.kind === 'envoy-ai-gateway'
      && candidate.provision !== false,
  );
}

function applicationAgentPhysicalProviderId(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode,
): string {
  const providers = new Map(
    graph.nodes.flatMap((node) =>
      node.kind === 'provider' ? [[node.id, node] as const] : []),
  );
  let current = provider;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current.id)) {
      throw new Error(`Application AI provider alias cycle includes ${current.id}.`);
    }
    visited.add(current.id);
    const aliasOf = typeof current.config?.aliasOf === 'string'
      ? current.config.aliasOf
      : undefined;
    if (!aliasOf) return current.id;
    const target = providers.get(aliasOf);
    if (!target || target.interface !== provider.interface) {
      throw new Error(
        `Application AI provider ${current.id} aliases missing or incompatible provider ${aliasOf}.`,
      );
    }
    current = target;
  }
}

function applicationAgentCredentialSecret(
  provider: JsonObject,
  modelName: string,
): Readonly<{
  environmentName?: string;
  name: string;
  key: string;
  optional: boolean;
}> | undefined {
  if (provider.kind !== 'application-provider-selection') {
    const secret = applicationAgentExternalCredential(provider, modelName);
    if (!secret) return undefined;
    const name = applicationGraphStringValue(secret.name);
    if (!name) {
      throw new Error(
        'Application AI external credential Secret name must be a concrete or graph-derived string.',
      );
    }
    return {
      name,
      key: applicationGraphStringValue(secret.key) ?? 'apiKey',
      optional: false,
    };
  }
  const selector = typeof provider.selector === 'string'
    ? provider.selector
    : undefined;
  const cases = isJsonObject(provider.cases)
    ? Object.entries(provider.cases)
    : [];
  const fallback = isJsonObject(provider.default)
    ? provider.default
    : {};
  if (!selector || !/^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u.test(selector)) {
    throw new Error(
      'Application AI credential selection requires a direct schema.spec discriminator.',
    );
  }
  const candidates = [
    ...cases.map(([, candidate]) => isJsonObject(candidate) ? candidate : {}),
    fallback,
  ];
  const secrets = candidates.map((candidate) =>
    applicationAgentExternalCredential(candidate, modelName)
  );
  if (secrets.every((secret) => secret === undefined)) return undefined;
  const selected = (
    read: (secret: Readonly<{ name: unknown; key: unknown }>) => unknown,
    absent: string,
  ): string => {
    const serialize = (
      candidate: Readonly<{ name: unknown; key: unknown }> | undefined,
    ): string => applicationAgentScalarExpression(
      candidate ? read(candidate) : absent,
    );
    const otherwise = serialize(secrets.at(-1));
    const expression = cases.reduceRight(
      (current, [variant], index) =>
        `${selector} == ${JSON.stringify(variant)} ? ${serialize(secrets[index])} : (${current})`,
      otherwise,
    );
    return `\${${expression}}`;
  };
  return {
    environmentName: selected(
      () => 'APPLIK8S_AI_GATEWAY_API_KEY',
      'APPLIK8S_UNUSED_AI_CREDENTIAL',
    ),
    name: selected((secret) => secret.name, 'applik8s-ai-credentials-unused'),
    key: selected((secret) => secret.key, 'apiKey'),
    optional: true,
  };
}

function applicationAgentExternalCredential(
  provider: JsonObject,
  modelName: string,
): Readonly<{ name: unknown; key: unknown }> | undefined {
  if (
    provider.kind !== 'envoy-ai-gateway'
    || provider.provision !== false
    || !isJsonObject(provider.models)
  ) {
    return undefined;
  }
  const model = provider.models[modelName];
  if (!isJsonObject(model) || !Array.isArray(model.backends)) return undefined;
  const backend = model.backends.find(isJsonObject);
  if (!backend || !isJsonObject(backend.credentials)) return undefined;
  const name = backend.credentials.name;
  if (name === undefined) return undefined;
  return {
    name,
    key: backend.credentials.key ?? 'apiKey',
  };
}

function applicationAgentScalarExpression(value: unknown): string {
  const serialized = applicationGraphStringValue(value);
  if (serialized !== undefined) {
    const expression = /^\$\{(.+)\}$/u.exec(serialized)?.[1];
    return expression ?? JSON.stringify(serialized);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error(
    'Application AI selected credential fields must be scalar installation values.',
  );
}
