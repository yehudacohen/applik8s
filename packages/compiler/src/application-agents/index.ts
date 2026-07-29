import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApplicationAIAgentNode,
  ApplicationGraph,
  ApplicationHandlerDependencies,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationProviderNode,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import { build } from 'esbuild';
import {
  emitGeneratedApplicationContainer,
  type GeneratedApplicationContainerArtifact,
} from '../application-containers/index.js';
import {
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
  readonly application: string;
  readonly agent: ApplicationAIAgentNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: JsonObject;
  readonly operationCatalog: ApplicationOperationCatalog;
  readonly tools: readonly {
    readonly operation: ApplicationOperationDescriptor;
    readonly transport: ApplicationAIAgentNode['tools'][number]['transport'];
    readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
  }[];
  readonly namespace: string;
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
    return { operation, transport: tool.transport, workloadAuthority: authority };
  });
  const namespace = graph.metadata.namespace ?? stringValue(providerConfig.namespace) ?? 'default';
  return {
    application: graph.metadata.name,
    agent,
    provider,
    providerConfig,
    operationCatalog,
    tools,
    namespace,
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
    lineLimit: 120,
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
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
  return `
import { createServer } from 'node:http';
import { createApplicationAIAgentRequestHandler } from '@applik8s/runtime-ai';
import { callback as handler } from './handler.generated.js';
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
    tools: contract.tools,
    budgets: contract.agent.budgets,
    deployment: contract.agent.deployment,
  })};

// Principal admission, durable attempt reservation, and canonical operation
// invocation remain fail-closed until their provider runtimes are attached.
// They are deliberately not inferred from client-supplied JSON.
const unavailable = (capability) => async () => {
  throw new Error('Generated agent ' + contract.name + ' requires ' + capability + '.');
};
const handle = createApplicationAIAgentRequestHandler({
  name: contract.name,
  logicalModel: contract.model.name,
  instructions: ${instructions},
  provider: contract.provider.kind === 'ai-deterministic'
    ? { kind: 'deterministic', response: typeof contract.provider.fixture?.response === 'string' ? contract.provider.fixture.response : undefined, latencyMs: contract.provider.latencyMs }
    : {
        kind: 'openai-compatible',
        name: contract.provider.name ?? 'envoy-ai-gateway',
        baseUrl: process.env.APPLIK8S_AI_GATEWAY_URL ?? 'http://envoy-ai-gateway.default.svc',
        apiKey: process.env.APPLIK8S_AI_GATEWAY_API_KEY ?? 'gateway-managed',
        model: contract.model.name,
      },
  tools: contract.tools,
  persistence: Object.freeze({ kind: 'pending-tanstack-server-persistence' }),
  timeoutMs: contract.budgets.timeoutMs,
  maximumConcurrency: contract.deployment.maximumConcurrency,
  admit: unavailable('canonical execution-principal admission'),
  reserveAttempt: unavailable('durable AI attempt storage'),
  invoke: unavailable('canonical operation invocation'),
  handler,
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? 'localhost'));
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
let stopping = false;
server.listen(contract.deployment.port, '0.0.0.0');
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolveShutdown) => server.close(resolveShutdown));
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
`;
}

function generatedAgentResources(
  contract: ApplicationAgentCompilerContract,
  image: string,
  digest: string,
): readonly GeneratedApplicationAgentResource[] {
  const name = kubernetesName(contract.agent.name);
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
