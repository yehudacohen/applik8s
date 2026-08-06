import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApplicationAIAgentNode,
  ApplicationGraph,
  ApplicationHandlerDependencies,
  ApplicationModelNode,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationProviderNode,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import {
  applicationOptionalDeploymentOutputReference,
} from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import {
  emitGeneratedApplicationContainer,
  type GeneratedApplicationContainerArtifact,
} from '../application-containers/index.js';
import { applicationGraphStringValue } from '../application-installation-values.js';
import {
  type ApplicationOperationPlacementReceiver,
  compileApplicationOperationPlacementReceiver,
} from '../application-mcp/planner.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../application-operations/index.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';

const DEFAULT_GENERATED_AGENT_RUNTIME_IMAGE =
  'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationAgentArtifact {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationAgentResource[];
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
  readonly agent: ApplicationAIAgentNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: JsonObject;
  readonly operationCatalog: ApplicationOperationCatalog;
  readonly tools: readonly {
    readonly operation: ApplicationOperationDescriptor;
    readonly transport: ApplicationAIAgentNode['tools'][number]['transport'];
    readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
    readonly receiver?: ApplicationOperationPlacementReceiver;
    readonly local?: NonNullable<ApplicationAIAgentNode['tools'][number]['local']>;
  }[];
  readonly namespace: string;
  readonly state: NonNullable<ApplicationModelNode['runtime']>;
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
  const namespace = graph.metadata.namespace ?? stringValue(providerConfig.namespace) ?? 'default';
  return {
    graph,
    application: graph.metadata.name,
    agent,
    provider,
    providerConfig,
    operationCatalog,
    tools,
    namespace,
    state: stateRuntime,
    route: applicationAgentRoute(agent, providerConfig),
  };
}

async function emitAgent(
  contract: ApplicationAgentCompilerContract,
  outDir: string,
): Promise<GeneratedApplicationAgentArtifact> {
  const name = kubernetesName(contract.agent.name);
  const agentDir = join(outDir, name);
  const generatedEntrypoint = join(agentDir, 'agent.generated.ts');
  const sourcePath = join(agentDir, 'agent.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(agentDir, 'agent.manifest.json');
  const metafilePath = join(agentDir, 'agent.esbuild-meta.json');
  await mkdir(agentDir, { recursive: true });
  await writeCallbackModule(
    agentDir,
    'handler',
    contract.agent.handlerSource,
    contract.agent.handlerDependencies,
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
    nodePaths: [join(process.cwd(), 'node_modules')],
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
    supported: { 'template-literal': false },
    plugins: [applik8sWorkspaceSourcePlugin()],
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
  const resources = generatedAgentResources(contract, container.image, digest);
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
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
  };
}

function generatedAgentSource(contract: ApplicationAgentCompilerContract): string {
  const instructions = contract.agent.instructions.kind === 'static'
    ? JSON.stringify(contract.agent.instructions.value)
    : 'instructions';
  const workloadIdentity = contract.tools[0]?.workloadAuthority.workloadIdentity;
  if (!workloadIdentity) {
    throw new Error(`Application agent ${contract.agent.id} has no workload identity.`);
  }
  const audiences = [
    ...new Set(
      contract.tools.flatMap((tool) => tool.workloadAuthority.audiences),
    ),
  ].sort();
  const routeEntries = contract.tools.filter(
    (tool): tool is typeof tool & { readonly receiver: ApplicationOperationPlacementReceiver } =>
      Boolean(tool.receiver),
  ).map((tool) =>
    `[${JSON.stringify(tool.operation.id)}, ${JSON.stringify({
      url: tool.receiver.url,
      maximumResponseBytes: 10_485_760,
    })}]`,
  ).join(',\n');
  const localToolImports = contract.tools.flatMap((tool, index) =>
    tool.local
      ? [`import { createTool as createLocalTool${index} } from ${JSON.stringify(`./${localAgentToolModuleFile(index)}`)};`]
      : []).join('\n');
  const localToolRuntime = generatedLocalAgentToolRuntime(contract);
  return `
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { createApplicationAIAttemptRuntime } from '@applik8s/ai';
import { createApplicationAIAgentConversationPersistence, createPostgresApplicationConversationStore } from '@applik8s/conversations/runtime';
import { createApplicationOperationAuthorityRuntime, decodeApplicationExecutionAdmission } from '@applik8s/operations';
import { createApplicationAIAgentRequestHandler, createApplicationAIOperationExecutor, createPostgresApplicationAIAttemptStore } from '@applik8s/runtime-ai';
import { callback as handler } from './handler.generated.js';
${localToolImports}
${contract.tools.some((tool) => tool.local)
    ? "import { normalizeSchema } from '@applik8s/sdk/schema-runtime';\nimport { applicationRequestContextValues, createApplicationFunctionNativeEventHandle, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';"
    : ''}
${contract.agent.instructions.kind === 'closure'
    ? "import { callback as instructions } from './instructions.generated.js';"
    : ''}

const contract = ${JSON.stringify({
    application: contract.application,
    name: contract.agent.name,
    nodeId: contract.agent.id,
    serviceIdentity: contract.agent.serviceIdentity,
    model: contract.agent.model,
    provider: contract.providerConfig,
    route: contract.route,
    state: contract.state,
    tools: contract.tools,
    budgets: contract.agent.budgets,
    executionPolicy: contract.agent.executionPolicy,
    deployment: contract.agent.deployment,
  })};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable ' + name);
  return value;
}
function selectedProfileValue(value) {
  if (value?.kind !== 'application-provider-selection') return value;
  const variant = requiredEnv('APPLIK8S_PROFILE_VARIANT');
  const selected = value.cases?.[variant] ?? value.default;
  if (!selected || typeof selected !== 'object') {
    throw new Error('The active profile has no AI provider configuration.');
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
const selectedProvider = materializeInstallationValue(selectedProfileValue(contract.provider));
const selectedRoute = materializeInstallationValue(selectedProfileValue(contract.route));
const selectedModelRoute = selectedProvider?.models?.[contract.model.name];
const selectedBackend = Array.isArray(selectedModelRoute?.backends)
  ? selectedModelRoute.backends[0]
  : undefined;
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
const conversationStore = createPostgresApplicationConversationStore({ sql });
const conversationPersistence = createApplicationAIAgentConversationPersistence({
  store: conversationStore,
});
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql,
  application: contract.application,
  catalog: ${JSON.stringify(contract.operationCatalog)},
  ${applicationStaticAuthorityManifest(contract.graph) ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(contract.graph))},` : ''}
});
${localToolRuntime}
const placementRoutes = new Map([${routeEntries}]);
const invokeOperation = createApplicationAIOperationExecutor({
  authority: operationAuthority,
  attemptRuntime,
  envelopes: contract.tools.map((tool) => tool.workloadAuthority),
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
      const response = await fetch(route.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-applik8s-internal-invocation': invocationToken,
        },
        body: JSON.stringify({ operationId: operation.id, input }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > route.maximumResponseBytes) {
        throw new Error('AI placement response exceeded its configured bound.');
      }
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (!response.ok || !value || typeof value !== 'object' || !('value' in value)) {
        throw new Error('AI placement invocation failed without exposing internal details.');
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
  timeoutMs: contract.budgets.timeoutMs,
  maximumConcurrency: contract.deployment.maximumConcurrency,
  async admit(request, body) {
    const token = request.headers.get('x-applik8s-execution-admission');
    if (!token) throw new Error('Agent execution admission is required.');
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
    const principal = await operationAuthority.admitExecutionPrincipal({
      executionKind: 'agent',
      executionId: invocation.executionId,
      attempt: invocation.attempt,
      workloadIdentity: ${JSON.stringify(workloadIdentity)},
      serviceIdentity: contract.serviceIdentity,
      causalPrincipal: invocation.admission.principal.identity,
      causalGrantIds: invocation.causalGrantIds,
      envelopes: contract.tools.map((tool) => tool.workloadAuthority),
      trustedContextDigest: invocation.admission.principal.trustedContextDigest,
      audience: invocation.audience,
      deadline: invocation.expiresAt,
      cancellationRevision: invocation.cancellationRevision,
    });
    return {
      principal,
      trustedContext: invocation.admission.trustedContext,
    };
  },
  async reserveAttempt({ principal, threadId, runId, logicalModel, request }) {
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
    return {
      action: decision.action,
      runId,
      invocationId,
      attemptId: decision.attempt.id,
      version: decision.attempt.version,
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
            confidence: 'provider-reported',
          }
        : undefined;
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
      );
      return { ...reservation, version: attempt.version };
    },
    async fail(reservation, failure) {
      if (failure.classification === 'cancelled') {
        await attemptRuntime.cancel(
          reservation.invocationId,
          failure.reason,
        );
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
      return { ...reservation, version: attempt.version };
    },
  },
  invoke: (operation, input, invocation, admission) =>
    invokeOperation(operation, input, {
      ...invocation,
      admission,
    }),
  handler,
});
let ready = false;
let stopping = false;
let lastDependencyError;
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
});
server.listen(contract.deployment.port, '0.0.0.0');
const initializationTask = initializeDependencies();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  initializationController.abort();
  await new Promise((resolveShutdown) => server.close(resolveShutdown));
  await initializationTask;
  await sql.end({ timeout: 5 });
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
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
      const result = await withApplicationNativeModelTransactionRuntime(
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
                values: applicationRequestContextValues(
                  context.principal,
                  context.principal.authorityRevision,
                  context.trustedContext,
                ),
                digest: context.principal.trustedContextDigest,
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
        () => authored(validInput),
      );
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
    const root = localAgentToolBindingRoot(binding.identifier);
    const previous = entries.get(root);
    if (previous && previous.target !== model.id) {
      throw new Error(
        `Local agent tool binding ${root} is ambiguous between ${previous.target} and ${model.id}.`,
      );
    }
    entries.set(root, {
      target: model.id,
      value: `localToolModelHandle(${JSON.stringify(model.name)})`,
    });
  }
  for (const binding of local.functionNativeTransaction.eventBindings ?? []) {
    const event = graphNodes.get(binding.event.nodeId);
    if (event?.kind !== 'event') {
      throw new Error(
        `Local agent tool binding ${binding.identifier} references missing event ${binding.event.nodeId}.`,
      );
    }
    const root = localAgentToolBindingRoot(binding.identifier);
    const previous = entries.get(root);
    if (previous && previous.target !== event.id) {
      throw new Error(
        `Local agent tool binding ${root} is ambiguous between ${previous.target} and ${event.id}.`,
      );
    }
    entries.set(root, {
      target: event.id,
      value: `createApplicationFunctionNativeEventHandle(${JSON.stringify(`${event.contract.name}.${event.contract.version}`)}, { payload: localToolSchema(${JSON.stringify(event.contract.payload.jsonSchema)}, ${JSON.stringify(`${event.name}.payload`)}) })`,
    });
  }
  return `{ ${[...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, binding]) =>
      `${JSON.stringify(root)}: ${binding.value}`)
    .join(', ')} }`;
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

function generatedAgentResources(
  contract: ApplicationAgentCompilerContract,
  image: string,
  digest: string,
): readonly GeneratedApplicationAgentResource[] {
  const name = kubernetesName(contract.agent.name);
  const credentialSecret = applicationAgentCredentialSecret(
    contract.providerConfig,
    contract.agent.model.name,
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
                env: [
                  { name: 'NODE_ENV', value: 'production' },
                  { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
                  ...(applicationAgentProfileSelector(contract.providerConfig)
                    ? [{
                        name: 'APPLIK8S_PROFILE_VARIANT',
                        value: applicationAgentProfileSelector(
                          contract.providerConfig,
                        ),
                      }]
                    : []),
                  ...(applicationAgentHasManagedEnvoy(
                    contract.providerConfig,
                  )
                    ? [{
                        name: 'APPLIK8S_AI_GATEWAY_MANAGED_URL',
                        value:
                          applicationOptionalDeploymentOutputReference(
                            `direct.${contract.provider.id}.envoy-ai-gateway`,
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
                  {
                    name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
                    valueFrom: {
                      secretKeyRef: {
                        name:
                          `${kubernetesName(contract.graph.metadata.name)}-internal-operation`,
                        key: 'key',
                        optional: false,
                      },
                    },
                  },
                ],
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
