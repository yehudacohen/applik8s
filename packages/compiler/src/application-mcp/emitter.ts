// typecast-file-boundary: MCP plans are validated before strongly typed generated-source fragments are emitted.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationMcpServerNode,
  ApplicationOperationCatalog,
  ApplicationProviderNode,
  ApplicationReactiveDatabaseRuntimeContract,
} from '@applik8s/core';
import type { ApplicationRuntimeEndpointDependency } from '@applik8s/deployment-contract';
import { build } from 'esbuild';
import {
  emitGeneratedApplicationContainer,
  type GeneratedApplicationContainerArtifact,
} from '../application-containers/index.js';
import { applicationGraphStringValue } from '../application-installation-values.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
} from '../application-operations/index.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import {
  type ApplicationMcpPlacementRoute,
  compileApplicationMcpPlacementRoutes,
} from './planner.js';

const DEFAULT_MCP_IMAGE =
  'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationMcpResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export interface GeneratedApplicationMcpArtifact {
  readonly name: string;
  readonly serverId: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationMcpResource[];
  readonly runtimeEndpoints: readonly ApplicationRuntimeEndpointDependency[];
}

interface ApplicationMcpCompilerContract {
  readonly graph: ApplicationGraph;
  readonly server: ApplicationMcpServerNode;
  readonly catalog: ApplicationOperationCatalog;
  readonly routes: readonly ApplicationMcpPlacementRoute[];
  readonly database: ApplicationReactiveDatabaseRuntimeContract;
  readonly namespace: string;
  readonly identity: {
    readonly hydraAdminUrl: string;
    readonly hydraPublicUrl: string;
    /**
     * MCP OAuth is materialized only for installation profiles whose selected
     * identity infrastructure contains Hydra. The logical MCP declaration
     * remains application-owned; unsupported profiles do not receive a
     * misleading unauthenticated transport.
     */
    readonly includeWhen?: string;
  };
  readonly deployment: {
    readonly replicas: number;
    readonly port: number;
  };
}

export async function emitGeneratedApplicationMcpServers(options: {
  readonly graph: ApplicationGraph;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly outDir: string;
}): Promise<readonly GeneratedApplicationMcpArtifact[]> {
  const servers = options.graph.nodes.filter(
    (node): node is ApplicationMcpServerNode => node.kind === 'mcpServer',
  );
  if (servers.length === 0) return [];
  const catalog =
    options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const routes = compileApplicationMcpPlacementRoutes(options.graph, catalog);
  await mkdir(options.outDir, { recursive: true });
  return Promise.all(servers.map((server) =>
    emitMcpServer(
      mcpCompilerContract(
        options.graph,
        server,
        catalog,
        routes.filter((route) => route.serverId === server.id),
      ),
      options.outDir,
    ),
  ));
}

function mcpCompilerContract(
  graph: ApplicationGraph,
  server: ApplicationMcpServerNode,
  catalog: ApplicationOperationCatalog,
  routes: readonly ApplicationMcpPlacementRoute[],
): ApplicationMcpCompilerContract {
  if (!server.resource || !server.audience) {
    throw new Error(
      `Generated MCP server ${server.id} requires a canonical resource and audience.`,
    );
  }
  if (routes.length !== server.tools.length) {
    throw new Error(
      `Generated MCP server ${server.id} resolved ${routes.length} placement routes for ${server.tools.length} tools.`,
    );
  }
  const database = mcpDatabase(graph, routes);
  const namespace =
    applicationGraphStringValue(database.secretNamespace)
    ?? applicationGraphStringValue(graph.metadata.namespace)
    ?? 'default';
  const identity = mcpOryIdentity(graph);
  return {
    graph,
    server,
    catalog,
    routes,
    database,
    namespace,
    identity,
    deployment: { replicas: 2, port: 8080 },
  };
}

async function emitMcpServer(
  contract: ApplicationMcpCompilerContract,
  outDir: string,
): Promise<GeneratedApplicationMcpArtifact> {
  const name = kubernetesName(
    `${contract.graph.metadata.name}-${contract.server.name}-mcp`,
  );
  const artifactDir = join(outDir, name);
  const entrypoint = join(artifactDir, 'mcp.generated.ts');
  const sourcePath = join(artifactDir, 'runtime.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(artifactDir, 'runtime.manifest.json');
  const metafilePath = join(artifactDir, 'runtime.esbuild-meta.json');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(entrypoint, generatedMcpSource(contract));
  const result = await build({
    entryPoints: [entrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    keepNames: true,
    legalComments: 'none',
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
    nodePaths: [join(process.cwd(), 'node_modules')],
    plugins: [applik8sWorkspaceSourcePlugin()],
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest =
    `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.graph.metadata.name,
    workloadName: name,
    role: 'mcp-server',
    artifactDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/runtime.mjs',
    baseImage: DEFAULT_MCP_IMAGE,
    sourceDigest: digest,
  });
  const resources = generatedMcpResources(contract, name, container.image, digest);
  const runtimeEndpoints = [...new Map(contract.routes.map(({ receiver }) => [
    receiver.environmentName,
    { nodeId: receiver.nodeId, environmentName: receiver.environmentName },
  ])).values()].sort((left, right) => left.environmentName.localeCompare(right.environmentName));
  await writeFile(manifestPath, `${JSON.stringify({
    apiVersion: 'applik8s.mcpArtifact/v1alpha1',
    kind: 'GeneratedApplicationMcpServer',
    metadata: { name },
    spec: {
      application: contract.graph.metadata.name,
      server: contract.server.id,
      protocolRevision: contract.server.protocol.preferred,
      operationCatalogRevision: contract.catalog.revision,
      routes: contract.routes,
      runtimeEndpoints,
      digest,
      sizeBytes,
      distribution: 'ociImage',
      image: container.image,
      container,
      namespace: contract.namespace,
      resources: resources.map((resource) => ({
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        metadata: resource.metadata,
      })),
    },
  }, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  return {
    name,
    serverId: contract.server.id,
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
    runtimeEndpoints,
  };
}

function generatedMcpSource(contract: ApplicationMcpCompilerContract): string {
  const revision = `sha256:${createHash('sha256')
    .update(JSON.stringify(contract.server))
    .digest('hex')}`;
  const routeEntries = contract.routes.map((route) =>
    `[${JSON.stringify(route.operationId)}, ${JSON.stringify({
      baseUrl: route.receiver.baseUrl,
      path: route.receiver.path,
      environmentName: route.receiver.environmentName,
      maximumRequestBytes: contract.server.transport.maximumRequestBytes,
      maximumResponseBytes: contract.server.transport.maximumResponseBytes,
    })}]`,
  ).join(',\n');
  return `import { createServer } from 'node:http';
import postgres from 'postgres';
import { applicationOAuthIdentityReference, createApplicationOAuthResourceAdmission } from '@applik8s/identity/server';
import { OryHydraOAuthAdapter } from '@applik8s/identity-ory';
import { ApplicationMcpServerRuntime, createApplicationMcpHttpHandler, createApplicationMcpPlacementExecutor } from '@applik8s/mcp/server';
import { createPostgresApplicationMcpStores } from '@applik8s/mcp/postgres';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';

function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error('Missing required environment variable ' + name); return value; }
function runtimeEndpoint(baseUrl, environmentName, path) { let selected = process.env[environmentName] || baseUrl; while (selected.endsWith('/')) selected = selected.slice(0, -1); return selected + path; }
const sql = postgres(requiredEnv(${JSON.stringify(contract.database.connectionEnvName)}), { max: 12, idle_timeout: 20, connect_timeout: 10, prepare: false });
const catalog = ${JSON.stringify(contract.catalog)};
const authority = createApplicationOperationAuthorityRuntime({
  sql,
  application: ${JSON.stringify(contract.graph.metadata.name)},
  catalog,
  ${applicationStaticAuthorityManifest(contract.graph) ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(contract.graph))},` : ''}
});
await authority.prepare();
const stores = createPostgresApplicationMcpStores({ sql, application: ${JSON.stringify(contract.graph.metadata.name)} });
await stores.prepare();
const hydra = new OryHydraOAuthAdapter({ adminUrl: requiredEnv('APPLIK8S_ORY_HYDRA_ADMIN_URL'), publicUrl: requiredEnv('APPLIK8S_ORY_HYDRA_PUBLIC_URL'), timeoutMs: 5000 });
const admitRequest = createApplicationOAuthResourceAdmission({
  provider: hydra,
  admitPrincipal: ({ introspection, context, trustedContextDigest, now }) => {
    const subject = introspection.subject ?? introspection.clientId;
    const issuer = introspection.issuer ?? new URL(requiredEnv('APPLIK8S_ORY_HYDRA_PUBLIC_URL')).origin;
    const workload = Boolean(introspection.clientId && introspection.clientId === subject);
    const identity = applicationOAuthIdentityReference({ issuer, subject, kind: workload ? 'workload' : 'human' });
    return authority.admitPrincipal({
      id: identity.id.replace(/^identity:/u, 'principal:'),
      identity,
      kind: workload ? 'workload' : 'human',
      authenticationMethod: 'oauth-token-introspection',
      audience: [context.audience],
      ...(introspection.expiresAt ? { expiresAt: new Date(introspection.expiresAt * 1000).toISOString() } : {}),
      ...(introspection.clientId ? { clientId: introspection.clientId } : {}),
    }, trustedContextDigest);
  },
});
const routes = new Map([${routeEntries}]);
const executor = createApplicationMcpPlacementExecutor({
  authority,
  transportSecret: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
  dispatch: {
    async dispatch({ operation, arguments: input, invocationToken, signal }) {
      const route = routes.get(operation.id);
      if (!route) throw new Error('MCP operation has no compiled placement route.');
      const response = await fetch(runtimeEndpoint(route.baseUrl, route.environmentName, route.path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-applik8s-internal-invocation': invocationToken,
        },
        body: JSON.stringify({ operationId: operation.id, input }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > route.maximumResponseBytes) throw new Error('MCP placement response exceeded its configured bound.');
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (!response.ok || !value || typeof value !== 'object' || !('value' in value)) {
        throw new Error('MCP placement invocation failed without exposing internal details.');
      }
      return value.value;
    },
  },
});
const runtime = new ApplicationMcpServerRuntime({
  application: ${JSON.stringify(contract.graph.metadata.name)},
  definition: {
    apiVersion: 'applik8s.mcpServer/v1alpha1',
    id: ${JSON.stringify(contract.server.name)},
    name: ${JSON.stringify(contract.server.name)},
    revision: ${JSON.stringify(revision)},
    endpoint: ${JSON.stringify(contract.server.resource)},
    resource: ${JSON.stringify(contract.server.resource)},
    audience: ${JSON.stringify(contract.server.audience)},
    authorizationServers: ${JSON.stringify(contract.server.authorizationServers)},
    scopes: ${JSON.stringify(contract.server.scopes)},
    protocolRevision: ${JSON.stringify(contract.server.protocol.preferred)},
    sessionLifetimeMs: ${contract.server.sessions.lifetimeMs},
  },
  catalog: stores.catalog,
  sessions: stores.sessions,
  executor,
});
const handle = createApplicationMcpHttpHandler({
  runtime,
  path: ${JSON.stringify(contract.server.path)},
  admitRequest,
  maximumRequestBytes: ${contract.server.transport.maximumRequestBytes},
  maximumResponseBytes: ${contract.server.transport.maximumResponseBytes},
});
let ready = false;
let stopping = false;
let lastError;
const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === '/live' || incoming.url === '/ready') {
      const ok = incoming.url === '/live' || (ready && !stopping);
      outgoing.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ ready, stopping, lastError }));
      return;
    }
    const request = await webRequest(incoming);
    await writeResponse(outgoing, await handle(request));
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'internal_error' }));
  }
});
server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? ${JSON.stringify(String(contract.deployment.port))}), '0.0.0.0');
const monitor = setInterval(async () => {
  try {
    await sql.unsafe('SELECT 1 AS applik8s_ready');
    await runtime.definition();
    await runtime.reapExpiredSessions(100);
    ready = true;
    lastError = undefined;
  } catch (error) {
    ready = false;
    lastError = error instanceof Error ? error.message : 'MCP dependency unavailable.';
  }
}, 5000);
monitor.unref();
async function webRequest(request) { const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request; return new Request('http://' + (request.headers.host ?? 'localhost') + (request.url ?? '/'), { method: request.method, headers: request.headers, ...(body ? { body, duplex: 'half' } : {}) }); }
async function writeResponse(response, web) { response.writeHead(web.status, Object.fromEntries(web.headers)); if (!web.body) { response.end(); return; } for await (const chunk of web.body) response.write(chunk); response.end(); }
async function shutdown() { if (stopping) return; stopping = true; ready = false; clearInterval(monitor); await new Promise((resolve) => server.close(resolve)); await sql.end({ timeout: 5 }); }
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
`;
}

function generatedMcpResources(
  contract: ApplicationMcpCompilerContract,
  name: string,
  image: string,
  digest: string,
): readonly GeneratedApplicationMcpResource[] {
  const inclusionAnnotations = contract.identity.includeWhen
    ? { 'applik8s.dev/include-when': contract.identity.includeWhen }
    : {};
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'mcp-server',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/graph': contract.graph.metadata.name,
  };
  const metadata = {
    name,
    namespace: contract.namespace,
    labels,
    ...(Object.keys(inclusionAnnotations).length > 0
      ? { annotations: inclusionAnnotations }
      : {}),
  };
  const env = [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
    { name: 'APPLIK8S_HTTP_PORT', value: String(contract.deployment.port) },
    {
      name: contract.database.connectionEnvName,
      valueFrom: {
        secretKeyRef: {
          name: contract.database.secretName,
          key: contract.database.secretKey,
        },
      },
    },
    {
      name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
      valueFrom: {
        secretKeyRef: {
          name: `${kubernetesName(contract.graph.metadata.name)}-internal-operation`,
          key: 'key',
        },
      },
    },
    {
      name: 'APPLIK8S_ORY_HYDRA_ADMIN_URL',
      value: contract.identity.hydraAdminUrl,
    },
    {
      name: 'APPLIK8S_ORY_HYDRA_PUBLIC_URL',
      value: contract.identity.hydraPublicUrl,
    },
  ];
  const resources: GeneratedApplicationMcpResource[] = [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        ...metadata,
        annotations: {
          ...inclusionAnnotations,
          'applik8s.dev/source-digest': digest,
        },
      },
      spec: {
        replicas: contract.deployment.replicas,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
        },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels, annotations: { 'applik8s.dev/source-digest': digest } },
          spec: {
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 30,
            securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
            containers: [{
              name: 'mcp',
              image,
              imagePullPolicy: 'IfNotPresent',
              env,
              ports: [{ name: 'http', containerPort: contract.deployment.port }],
              readinessProbe: { httpGet: { path: '/ready', port: 'http' }, periodSeconds: 5, failureThreshold: 6 },
              livenessProbe: { httpGet: { path: '/live', port: 'http' }, periodSeconds: 10, failureThreshold: 3 },
              resources: {
                requests: { cpu: '100m', memory: '128Mi' },
                limits: { cpu: '1', memory: '512Mi' },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
                capabilities: { drop: ['ALL'] },
              },
            }],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata,
      spec: {
        selector: labels,
        ports: [{ name: 'http', port: contract.deployment.port, targetPort: 'http' }],
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata,
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ['Ingress'],
        ingress: [{ ports: [{ protocol: 'TCP', port: contract.deployment.port }] }],
      },
    },
    {
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata,
      spec: { minAvailable: 1, selector: { matchLabels: labels } },
    },
  ];
  return resources;
}

function mcpDatabase(
  graph: ApplicationGraph,
  routes: readonly ApplicationMcpPlacementRoute[],
): ApplicationReactiveDatabaseRuntimeContract {
  const values: ApplicationReactiveDatabaseRuntimeContract[] = [];
  for (const route of routes) {
    const placement = graph.nodes.find(
      (node) => node.id === route.placement.nodeId,
    );
    if (placement?.kind === 'commandHandler') {
      const model = graph.nodes.find(
        (node) => node.kind === 'model' && node.id === placement.model.nodeId,
      );
      if (model?.kind === 'model' && model.runtime) values.push(model.runtime);
      continue;
    }
    if (placement?.kind === 'query' && placement.database) {
      values.push(placement.database);
      continue;
    }
    if (route.placement.runtime === 'server') {
      const modelQuery = graph.nodes.find(
        (node) =>
          node.kind === 'query'
          && node.modelOperation?.model.nodeId === route.placement.nodeId,
      );
      if (modelQuery?.kind === 'query' && modelQuery.database) {
        values.push(modelQuery.database);
      }
    }
  }
  const byConnection = new Map(
    values.map((value) => [value.connectionEnvName, value]),
  );
  if (byConnection.size !== 1) {
    throw new Error(
      `Generated MCP state and authority require exactly one transactional PostgreSQL database; resolved ${byConnection.size}.`,
    );
  }
  const database = byConnection.values().next().value;
  if (!database) {
    throw new Error(
      'Generated MCP state and authority require one transactional PostgreSQL database.',
    );
  }
  return database;
}

function mcpOryIdentity(graph: ApplicationGraph): {
  readonly hydraAdminUrl: string;
  readonly hydraPublicUrl: string;
  readonly includeWhen?: string;
} {
  const candidates = graph.nodes.filter(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === 'IdentityProvider'
      && !node.config?.qualification,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Generated MCP OAuth admission requires exactly one unqualified IdentityProvider; resolved ${candidates.length}.`,
    );
  }
  const provider = candidates[0];
  const infrastructure = objectValue(provider?.config?.identityInfrastructure);
  if (infrastructure.kind === 'application-provider-selection') {
    return mcpProfiledOryIdentity(infrastructure);
  }
  return mcpConcreteOryIdentity(infrastructure);
}

function mcpConcreteOryIdentity(
  infrastructure: Readonly<Record<string, unknown>>,
): {
  readonly hydraAdminUrl: string;
  readonly hydraPublicUrl: string;
} {
  const spec = objectValue(infrastructure.spec);
  if (infrastructure.kind !== 'ory' || infrastructure.stack !== 'platform') {
    throw new Error(
      'Generated MCP OAuth admission requires an Ory platform IdentityProvider with Hydra.',
    );
  }
  const name = applicationGraphStringValue(spec.name);
  const namespace = applicationGraphStringValue(spec.namespace);
  if (!name || !namespace) {
    throw new Error(
      'Generated MCP Ory admission requires portable identity name and namespace values.',
    );
  }
  return {
    hydraAdminUrl: `http://${name}-hydra-admin.${namespace}.svc:4445`,
    hydraPublicUrl: `http://${name}-hydra-public.${namespace}.svc:4444`,
  };
}

function mcpProfiledOryIdentity(
  selection: Readonly<Record<string, unknown>>,
): {
  readonly hydraAdminUrl: string;
  readonly hydraPublicUrl: string;
  readonly includeWhen?: string;
} {
  const selector = typeof selection.selector === 'string'
    ? selection.selector
    : undefined;
  const match = selector
    ? /^schema\.spec\.([A-Za-z_][A-Za-z0-9_.]*)$/u.exec(selector)
    : undefined;
  if (!selector || !match?.[1]) {
    throw new Error(
      'Generated MCP OAuth admission requires a direct installation profile selector.',
    );
  }
  const cases = objectValue(selection.cases);
  const supported = Object.entries(cases).flatMap(([variant, value]) => {
    const infrastructure = objectValue(value);
    if (
      infrastructure.kind !== 'ory'
      || infrastructure.stack !== 'platform'
    ) {
      return [];
    }
    return [{
      variant,
      identity: mcpConcreteOryIdentity(infrastructure),
    }];
  });
  const fallbackInfrastructure = objectValue(selection.default);
  const fallback =
    fallbackInfrastructure.kind === 'ory'
    && fallbackInfrastructure.stack === 'platform'
      ? mcpConcreteOryIdentity(fallbackInfrastructure)
      : undefined;
  if (supported.length === 0 && !fallback) {
    throw new Error(
      'Generated MCP OAuth admission requires at least one installation profile backed by an Ory platform IdentityProvider with Hydra.',
    );
  }
  const first = supported[0]?.identity ?? fallback!;
  const selectedValue = (
    property: 'hydraAdminUrl' | 'hydraPublicUrl',
  ): string => {
    if (supported.length === 1 && !fallback) {
      return supported[0]!.identity[property];
    }
    const fallbackValue = fallback?.[property] ?? first[property];
    const expression = supported.reduceRight(
      (otherwise, entry) =>
        `${selector} == ${JSON.stringify(entry.variant)} ? ${JSON.stringify(entry.identity[property])} : (${otherwise})`,
      JSON.stringify(fallbackValue),
    );
    return `\${${expression}}`;
  };
  const allCasesSupported =
    Object.keys(cases).length > 0
    && supported.length === Object.keys(cases).length
    && Boolean(fallback);
  const includeWhen = allCasesSupported
    ? undefined
    : supported.length === 0
      ? undefined
      : `\${${supported
          .map((entry) => `${selector} == ${JSON.stringify(entry.variant)}`)
          .join(' || ')}}`;
  return {
    hydraAdminUrl: selectedValue('hydraAdminUrl'),
    hydraPublicUrl: selectedValue('hydraPublicUrl'),
    ...(includeWhen ? { includeWhen } : {}),
  };
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function kubernetesName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error(`Application MCP name ${JSON.stringify(value)} is empty.`);
  if (normalized.length <= 63) return normalized;
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 10);
  return `${normalized.slice(0, 52).replace(/-+$/g, '')}-${hash}`;
}
