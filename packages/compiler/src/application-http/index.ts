// typecast-file-boundary: graph discriminants and generated JSON schemas are
// validated before compiler-owned HTTP contracts cross into emitted source.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationHandlerDependencies,
  ApplicationModelNode,
  ApplicationOperationCatalog,
  ApplicationProviderNode,
  ApplicationRouteContract,
  ApplicationServerNode,
  JsonObject,
} from '@applik8s/core';
import { build } from 'esbuild';
import { generatedCallbackFactoryModule } from '../application-callback-module.js';
import {
  emitGeneratedApplicationContainer,
  type GeneratedApplicationContainerArtifact,
} from '../application-containers/index.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
} from '../application-operations/index.js';
import {
  applicationGraphInterpolate,
  applicationGraphJsonStringArray,
  applicationGraphStringValue,
} from '../application-installation-values.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import {
  generatedApplicationEventLogPublisherSource,
  type ApplicationRuntimeExecutionTarget,
} from '../application-event-log-runtime-source.js';

const DEFAULT_GENERATED_HTTP_RUNTIME_IMAGE =
  'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface GeneratedApplicationHttpArtifact {
  readonly name: string;
  readonly serverId: string;
  readonly sourcePath: string;
  readonly sourceMapPath: string;
  readonly manifestPath: string;
  readonly metafilePath: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly container: GeneratedApplicationContainerArtifact;
  readonly resources: readonly GeneratedApplicationHttpResource[];
}

export interface GeneratedApplicationHttpResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

interface HttpOperationBinding {
  readonly identifier: string;
  readonly operationId: string;
  readonly runtimeOperationId?: string;
  readonly command: Extract<
    ApplicationGraph['nodes'][number],
    { readonly kind: 'command' }
  >;
  readonly handler: Extract<
    ApplicationGraph['nodes'][number],
    { readonly kind: 'commandHandler' }
  >;
  readonly model: ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
  };
}

interface HttpRouteCompilerContract {
  readonly route: ApplicationRouteContract & {
    readonly functionNative: NonNullable<
      ApplicationRouteContract['functionNative']
    >;
  };
  readonly operation: ApplicationOperationCatalog['operations'][number];
  readonly operationBindings: readonly HttpOperationBinding[];
}

interface HttpServerCompilerContract {
  readonly graph: ApplicationGraph;
  readonly server: ApplicationServerNode;
  readonly routes: readonly HttpRouteCompilerContract[];
  readonly identity: ApplicationProviderNode;
  readonly identityConfig: Readonly<Record<string, unknown>>;
  readonly eventLog?: ApplicationProviderNode;
  readonly operationCatalog: ApplicationOperationCatalog;
  readonly executionTarget: ApplicationRuntimeExecutionTarget;
  readonly namespace: string;
  readonly replicas: number;
  readonly servicePort: number;
  readonly containerPort: number;
  readonly maximumBodyBytes: number;
  readonly mutationRateLimit: {
    readonly maxRequests: number;
    readonly windowSeconds: number;
  };
}

export async function emitGeneratedApplicationHttpServers(options: {
  readonly graph: ApplicationGraph;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly outDir: string;
  readonly executionTarget?: ApplicationRuntimeExecutionTarget;
}): Promise<readonly GeneratedApplicationHttpArtifact[]> {
  const servers = options.graph.nodes.filter(
    (node): node is ApplicationServerNode =>
      node.kind === 'server'
      && node.routes.some((route) => Boolean(route.functionNative)),
  );
  if (servers.length === 0) return [];
  const operationCatalog =
    options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  await mkdir(options.outDir, { recursive: true });
  return Promise.all(
    servers.map((server) =>
      emitHttpServer(
        applicationHttpCompilerContract(
          options.graph,
          server,
          operationCatalog,
          options.executionTarget ?? 'kubernetes',
        ),
        options.outDir,
      )),
  );
}

function applicationHttpCompilerContract(
  graph: ApplicationGraph,
  server: ApplicationServerNode,
  operationCatalog: ApplicationOperationCatalog,
  executionTarget: ApplicationRuntimeExecutionTarget,
): HttpServerCompilerContract {
  if (server.routes.some((route) => !route.functionNative)) {
    throw new Error(
      `Application server ${server.id} mixes typed app.http routes with raw app.server routes. Split them into distinct workloads.`,
    );
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const identityCandidates = graph.nodes.filter(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === 'IdentityProvider'
      && !isJsonObject(node.config?.qualification),
  );
  if (identityCandidates.length !== 1) {
    throw new Error(
      `Generated typed HTTP server ${server.id} requires exactly one unqualified IdentityProvider; resolved ${identityCandidates.length}.`,
    );
  }
  const identity = identityCandidates[0]!;
  const identityConfig = objectValue(identity.config?.identity);
  if (
    !stringValue(identityConfig.authenticationSource)
    && !isJsonObject(identityConfig.authenticationProfile)
  ) {
    throw new Error(
      `Generated typed HTTP server ${server.id} IdentityProvider has no serializable authentication callback.`,
    );
  }
  const routes = server.routes.map((route): HttpRouteCompilerContract => {
    if (!route.functionNative) {
      throw new Error(`Application server ${server.id} contains an untyped route.`);
    }
    const operation = operationCatalog.operations.find(
      (candidate) =>
        candidate.kind === 'http.route'
        && candidate.placement.nodeId === server.id
        && candidate.name === route.id,
    );
    if (!operation) {
      throw new Error(
        `Generated typed HTTP route ${server.id}.${route.id} has no canonical operation-catalog entry.`,
      );
    }
    const operationBindings = (route.functionNative.operationBindings ?? [])
      .map((binding): HttpOperationBinding => {
        const command = nodes.get(binding.command.nodeId);
        const handler = nodes.get(binding.handler.nodeId);
        if (command?.kind !== 'command' || handler?.kind !== 'commandHandler') {
          throw new Error(
            `Generated typed HTTP route ${server.id}.${route.id} operation ${binding.operationId} references a missing command or handler (${binding.command.nodeId}, ${binding.handler.nodeId}); available handlers: ${graph.nodes.filter((node) => node.kind === 'commandHandler').map((node) => node.id).join(', ')}.`,
          );
        }
        const model = nodes.get(handler.model.nodeId);
        if (model?.kind !== 'model' || !model.runtime) {
          throw new Error(
            `Generated typed HTTP route ${server.id}.${route.id} operation ${binding.operationId} has no PostgreSQL model runtime.`,
          );
        }
        return {
          identifier: binding.identifier,
          operationId: binding.operationId,
          ...(binding.runtimeOperationId
            ? { runtimeOperationId: binding.runtimeOperationId }
            : {}),
          command,
          handler,
          model: model as ApplicationModelNode & {
            readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
          },
        };
      });
    return { route: { ...route, functionNative: route.functionNative }, operation, operationBindings };
  });
  const operationHandlers = new Set(
    routes.flatMap((route) =>
      route.operationBindings.map((binding) => binding.handler.id)),
  );
  const eventLog = operationHandlers.size > 0
    ? applicationHttpEventLog(graph, operationHandlers, server.id)
    : undefined;
  const namespace =
    server.deployment?.namespace
    ?? graph.metadata.namespace
    ?? generatedServerNamespace(server)
    ?? 'default';
  return {
    graph,
    server,
    routes,
    identity,
    identityConfig,
    executionTarget,
    ...(eventLog ? { eventLog } : {}),
    operationCatalog,
    namespace,
    replicas: server.deployment?.replicas ?? 1,
    servicePort: server.deployment?.port ?? 80,
    containerPort: 8080,
    maximumBodyBytes: server.deployment?.maxRequestBodyBytes ?? 1_048_576,
    mutationRateLimit: server.deployment?.mutationRateLimit ?? {
      maxRequests: 120,
      windowSeconds: 60,
    },
  };
}

async function emitHttpServer(
  contract: HttpServerCompilerContract,
  outDir: string,
): Promise<GeneratedApplicationHttpArtifact> {
  const name = kubernetesName(contract.server.name);
  const artifactDir = join(outDir, name);
  const entrypoint = join(artifactDir, 'http.generated.ts');
  const sourcePath = join(artifactDir, 'http.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(artifactDir, 'http.manifest.json');
  const metafilePath = join(artifactDir, 'http.esbuild-meta.json');
  await mkdir(artifactDir, { recursive: true });
  await writeIdentityModule(artifactDir, contract.identityConfig);
  for (const [index, route] of contract.routes.entries()) {
    const roots = applicationHttpRouteBindingRoots(route);
    await writeFile(
      join(artifactDir, `route-${index}.generated.ts`),
      generatedCallbackFactoryModule({
        source: route.route.functionNative.handler.source,
        ...(route.route.functionNative.handler.dependencies
          ? { dependencies: route.route.functionNative.handler.dependencies }
          : {}),
        injectedIdentifiers: roots,
        injectedBindingPaths: applicationHttpRouteBindingPaths(route),
        exportName: 'createHandler',
      }),
    );
    if (route.route.functionNative.authorize) {
      await writeCallbackModule(
        artifactDir,
        `authorize-${index}`,
        route.route.functionNative.authorize.source,
        route.route.functionNative.authorize.dependencies,
      );
    }
    if (route.route.functionNative.webhookAuthentication) {
      await writeCallbackModule(
        artifactDir,
        `webhook-authenticate-${index}`,
        route.route.functionNative.webhookAuthentication.source,
        route.route.functionNative.webhookAuthentication.dependencies,
      );
    }
  }
  await writeFile(entrypoint, generatedHttpSource(contract));
  const result = await build({
    entryPoints: [entrypoint],
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
    plugins: [applik8sWorkspaceSourcePlugin()],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.graph.metadata.name,
    workloadName: name,
    role: 'typed-http',
    artifactDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/http.mjs',
    baseImage: DEFAULT_GENERATED_HTTP_RUNTIME_IMAGE,
    sourceDigest: digest,
  });
  const resources = generatedHttpResources(contract, container.image, digest);
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      apiVersion: 'applik8s.httpArtifact/v1alpha1',
      kind: 'GeneratedApplicationHttpServer',
      metadata: { name },
      spec: {
        application: contract.graph.metadata.name,
        server: contract.server.id,
        operationCatalogRevision: contract.operationCatalog.revision,
        routes: contract.routes.map((route) => ({
          id: route.route.id,
          operationId: route.operation.id,
          method: route.route.method,
          path: route.route.path,
          operations: route.operationBindings.map((binding) => binding.operationId),
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
      },
    }, null, 2)}\n`,
  );
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
  };
}

function generatedHttpSource(contract: HttpServerCompilerContract): string {
  const routeImports = contract.routes.map((route, index) =>
    `import { createHandler as createHandler${index} } from './route-${index}.generated.js';
${route.route.functionNative.authorize
    ? `import { callback as authorize${index} } from './authorize-${index}.generated.js';`
    : ''}
${route.route.functionNative.webhookAuthentication
    ? `import { callback as authenticateWebhook${index} } from './webhook-authenticate-${index}.generated.js';`
    : ''}`).join('\n');
  const hasTransactions = contract.routes.some(
    (route) => Boolean(route.route.functionNative.transaction),
  );
  const hasOperations = contract.routes.some(
    (route) => route.operationBindings.length > 0,
  );
  const eventLogPublisher = hasOperations
    ? generatedApplicationEventLogPublisherSource({
        executionTarget: contract.executionTarget,
        variableName: 'applicationEventLogPublisher',
        connectionName: `applik8s-http-${contract.server.name}`,
      })
    : undefined;
  const commandContracts = uniqueOperationBindings(contract.routes).map(
    (binding) => `{
      id: ${JSON.stringify(`${binding.command.contract.name}.${binding.command.contract.version}`)},
      bindingId: ${JSON.stringify(binding.handler.name)},
      model: ${JSON.stringify(binding.model.name)},
      inputSchema: ${JSON.stringify(binding.command.contract.input.jsonSchema)},
      databaseUrl: requiredEnv(${JSON.stringify(binding.model.runtime.connectionEnvName)}),
      key: (${binding.handler.key.source}),
      ${binding.handler.idempotencyKey
        ? `idempotencyKey: (${binding.handler.idempotencyKey.source}),`
        : ''}
    }`,
  ).join(',\n');
  const routeDefinitions = contract.routes.map((route, index) => {
    const bindings = applicationHttpRouteBindingsSource(contract.graph, route);
    const aliases = Object.fromEntries(route.operationBindings.flatMap((binding) => {
      const target = {
        commandId: `${binding.command.contract.name}.${binding.command.contract.version}`,
        operationId: binding.operationId,
        boundKeys: [],
      };
      return [
        [binding.operationId, target],
        ...(binding.runtimeOperationId
          ? [[binding.runtimeOperationId, target] as const]
          : []),
      ] as const;
    }));
    return `{
      id: ${JSON.stringify(route.route.id)},
      method: ${JSON.stringify(route.route.method)},
      path: ${JSON.stringify(route.route.path)},
      operation: ${JSON.stringify(route.operation)},
      inputSchema: ${JSON.stringify(route.route.functionNative.input.jsonSchema)},
      outputSchema: ${JSON.stringify(route.route.functionNative.output.jsonSchema)},
      createHandler: createHandler${index},
      authorize: ${route.route.functionNative.authorize ? `authorize${index}` : 'undefined'},
      authenticateWebhook: ${route.route.functionNative.webhookAuthentication ? `authenticateWebhook${index}` : 'undefined'},
      bindings: ${bindings},
      operationAliases: ${JSON.stringify(aliases)},
      transaction: ${generatedHttpTransactionContract(contract.graph, route)},
    }`;
  }).join(',\n');
  return `
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { installApplicationOperationRuntimeResolver } from '@applik8s/client';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
${hasOperations
    ? `${eventLogPublisher!.importSource}\nimport { createApplicationTaskOperationRuntime } from '@applik8s/applik8s/task-operation-runtime';`
    : ''}
${hasTransactions
    ? "import { applicationPostgresModelReadClients, applicationRelationalChangeScopes, applicationRequestContextValues, createApplicationFunctionNativeEventHandle, editApplicationNativeModelObject, executeFunctionNativePostgresModelEdit, findApplicationNativeModelObjects, getApplicationNativeModelObject, requireApplicationNativeModelObject, withApplicationNativeModelReadClients, withApplicationNativeModelTransactionRuntime } from '@applik8s/applik8s/stream-worker-runtime';"
    : ''}
import { callback as authenticate } from './identity.generated.js';
${routeImports}

const contract = ${JSON.stringify({
    application: contract.graph.metadata.name,
    serverId: contract.server.id,
    serverName: contract.server.name,
    maximumBodyBytes: contract.maximumBodyBytes,
    containerPort: contract.containerPort,
    mutationRateLimit: contract.mutationRateLimit,
    operationCatalog: contract.operationCatalog,
  })};
const routes = [${routeDefinitions}];
const routeMatchers = routes.map(route => ({
  route,
  segments: route.path.split('/').filter(Boolean),
}));
const contextSecret = requiredEnv('APPLIK8S_HTTP_CONTEXT_SECRET');
const authorityDatabaseUrl = requiredEnv(${JSON.stringify(
    applicationHttpAuthorityDatabase(contract),
  )});
const sql = postgres(authorityDatabaseUrl, {
  max: 8,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql,
  application: contract.application,
  catalog: contract.operationCatalog,
  ${applicationStaticAuthorityManifest(contract.graph)
    ? `authorityManifest: ${JSON.stringify(applicationStaticAuthorityManifest(contract.graph))},`
    : ''}
});
const directOperationScope = new AsyncLocalStorage();
installApplicationOperationRuntimeResolver(() => directOperationScope.getStore());
${hasOperations
    ? `${eventLogPublisher!.declarationSource}
const commandRuntime = createApplicationTaskOperationRuntime({
  commands: [${commandContracts}],
  cursorSecret: contextSecret,
  eventLogPublisher: applicationEventLogPublisher,
  authorizeOperation: ({ principal, operationId, target, inputDigest, trustedContextDigest, idempotencyKey, commandId, targetDigest }) =>
    operationAuthority.authorize({
      principal,
      operationId,
      target,
      audience: contract.application,
      transport: 'http',
      inputDigest,
      trustedContextDigest,
      idempotencyKey,
      commandId,
      targetDigest,
      applicationPolicyAllowed: true,
    }),
});`
    : 'const commandRuntime = undefined;'}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable ' + name);
  return value;
}
function schema(json, name) {
  return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', uri: 'generated:' + name }, schema: json };
}
function validate(json, value, name) {
  const result = normalizeSchema(schema(json, name), name).validate(value);
  if (!result.ok) throw new HttpFailure(400, 'invalid_' + name.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
  return result.value;
}
function modelSnapshot(value) {
  return value
    ? { identity: value.id, value: value.spec, ...(value.revision ? { revision: value.revision } : {}) }
    : undefined;
}
function modelHandle(name) {
  return Object.freeze({
    get: async identity => modelSnapshot(await getApplicationNativeModelObject(name, identity)),
    find: async options => (await findApplicationNativeModelObjects(name, options)).items.map(modelSnapshot),
    require: async identity => modelSnapshot(await requireApplicationNativeModelObject(name, identity)),
    edit: (identity, handler) => editApplicationNativeModelObject(name, identity, handler),
  });
}
function operationHandle(operationId) {
  return input => {
    const runtime = directOperationScope.getStore();
    if (!runtime) throw new Error('Typed HTTP operation escaped its authenticated request scope.');
    return runtime.execute({ id: operationId }, input);
  };
}
class HttpFailure extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const mutationWindows = new Map();
const maximumMutationWindows = 10_000;
function enforceMutationRateLimit(route, principal) {
  const now = Date.now();
  const windowMilliseconds = contract.mutationRateLimit.windowSeconds * 1_000;
  const bucket = Math.floor(now / windowMilliseconds);
  const key = route.id + '\\0' + principal.id;
  const current = mutationWindows.get(key);
  const count = current?.bucket === bucket ? current.count + 1 : 1;
  mutationWindows.set(key, { bucket, count });
  if (mutationWindows.size > maximumMutationWindows) {
    for (const [candidate, value] of mutationWindows) {
      if (value.bucket < bucket) mutationWindows.delete(candidate);
      if (mutationWindows.size <= maximumMutationWindows) break;
    }
  }
  if (count > contract.mutationRateLimit.maxRequests) {
    throw new HttpFailure(429, 'mutation_rate_limit_exceeded');
  }
}
function matchRoute(method, pathname) {
  if (method === 'POST') {
    const runtimeMatch = /^\\/(?:__applik8s\\/v1\\/)?runtime\\/([^/]+)$/.exec(pathname);
    if (runtimeMatch?.[1]) {
      let operationId;
      try {
        operationId = decodeURIComponent(runtimeMatch[1]);
      } catch {
        throw new HttpFailure(400, 'invalid_runtime_operation');
      }
      const route = routes.find(candidate => candidate.operation.id === operationId);
      if (route) return { route, params: Object.freeze({}), runtimeProtocol: true };
    }
  }
  const segments = pathname.split('/').filter(Boolean);
  for (const candidate of routeMatchers) {
    if (candidate.route.method !== method || candidate.segments.length !== segments.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const expected = candidate.segments[index];
      const actual = segments[index];
      if (expected.startsWith(':')) {
        try {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } catch {
          throw new HttpFailure(400, 'invalid_path_parameter');
        }
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return {
      route: candidate.route,
      params: Object.freeze(params),
      runtimeProtocol: false,
    };
  }
  return undefined;
}
function requestIdempotencyKey(request) {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value || value.length > 256) throw new HttpFailure(400, 'idempotency_key_required');
  return value;
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > contract.maximumBodyBytes) throw new HttpFailure(413, 'request_body_too_large');
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
function parseJson(body) {
  try {
    return body.byteLength === 0
      ? {}
      : JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpFailure(400, 'invalid_json');
  }
}
async function invokeRoute(route, params, request, url, runtimeProtocol) {
  const body = await readBody(request);
  let webhookEvent;
  if (route.authenticateWebhook) {
    try {
      webhookEvent = await route.authenticateWebhook(Object.freeze({
        body,
        headers: Object.freeze(Object.fromEntries(request.headers)),
        signal: request.signal,
      }));
    } catch (error) {
      const code = error && typeof error === 'object'
        ? Reflect.get(error, 'code')
        : undefined;
      if (code === 'APPLIK8S_WEBHOOK_AUTHENTICATION_FAILED') {
        throw new HttpFailure(401, 'webhook_authentication_failed');
      }
      if (code === 'APPLIK8S_WEBHOOK_EVENT_UNSUPPORTED') {
        // A valid provider event outside this route's bounded contract is
        // terminally acknowledged so the provider does not retry forever.
        throw new HttpFailure(202, 'webhook_event_unsupported');
      }
      if (code === 'APPLIK8S_WEBHOOK_PAYLOAD_INVALID') {
        throw new HttpFailure(400, 'webhook_payload_invalid');
      }
      throw error;
    }
  }
  const trustedContextDigest = webhookEvent
    ? 'sha256:' + createHash('sha256')
        .update(contract.application + '\\0' + route.id + '\\0' + String(webhookEvent.id))
        .digest('hex')
    : undefined;
  const admission = webhookEvent
    ? {
        principal: await operationAuthority.admitPrincipal({
          id: 'provider-webhook:' + contract.serverId + ':' + route.id,
          kind: 'service',
          roles: ['applik8s-provider-webhook'],
          authenticationMethod: 'provider-signed-webhook',
          audience: [contract.application],
          attributes: {
            providerEventId: String(webhookEvent.id),
          },
        }, trustedContextDigest),
        trustedContext: Object.freeze({
          providerEventId: String(webhookEvent.id),
        }),
      }
    : await authenticate(request);
  if (!admission?.principal || !admission?.trustedContext) {
    throw new HttpFailure(401, 'authentication_failed');
  }
  const principal = Object.freeze({
    ...admission.principal,
    // Identity providers authenticate the subject and trusted context. The
    // framework, not application input or provider configuration, binds that
    // admitted principal to the exact compiled operation catalog.
    catalogRevision: contract.operationCatalog.revision,
  });
  enforceMutationRateLimit(route, principal);
  const requestBody = webhookEvent ?? parseJson(body);
  if (
    runtimeProtocol
    && (
      !requestBody
      || typeof requestBody !== 'object'
      || Array.isArray(requestBody)
      || !Object.hasOwn(requestBody, 'input')
    )
  ) {
    throw new HttpFailure(400, 'invalid_runtime_envelope');
  }
  const input = validate(
    route.inputSchema,
    runtimeProtocol ? requestBody.input : requestBody,
    route.id + '.input',
  );
  const requestValue = Object.freeze({
    input,
    params,
    query: Object.freeze(Object.fromEntries(url.searchParams)),
  });
  const context = Object.freeze({
    principal,
    trustedContext: Object.freeze({ ...admission.trustedContext }),
    ...(normalizedRequestOrigin(request) ? {
      requestOrigin: normalizedRequestOrigin(request),
    } : {}),
    signal: request.signal,
  });
  const applicationPolicyAllowed = route.authorize
    ? await route.authorize(requestValue, context)
    : true;
  const idempotencyKey = webhookEvent
    ? 'provider-event:' + String(webhookEvent.id)
    : requestIdempotencyKey(request);
  const inputDigest = 'sha256:' + createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  const routeReceipt = await operationAuthority.authorize({
    principal,
    operationId: route.operation.id,
    target: {
      kind: 'target',
      model: contract.serverName,
      identity: { key: route.id },
    },
    audience: contract.application,
    transport: 'http',
    inputDigest,
    trustedContextDigest: principal.trustedContextDigest,
    idempotencyKey,
    applicationPolicyAllowed: applicationPolicyAllowed === true,
  });
  if (!routeReceipt.allowed) throw new HttpFailure(403, 'authorization_denied');
  const invocationId = 'http_' + createHash('sha256')
    .update(contract.application + '\\0' + contract.serverId + '\\0' + route.id + '\\0'
      + principal.id + '\\0' + principal.trustedContextDigest + '\\0' + idempotencyKey)
    .digest('hex');
  const operationBindings = commandRuntime
    ? commandRuntime.bind(
        route.operationAliases,
        { ...principal, trustedContext: admission.trustedContext },
        {
          invocationId,
          idempotencyKey,
          correlationId: invocationId,
          signal: request.signal,
          trustedContext: {
            values: admission.trustedContext,
            digest: principal.trustedContextDigest,
          },
        },
      )
    : {};
  const handler = route.createHandler(route.bindings);
  const execute = {
    execute(operation, operationInput) {
      const invoke = operationBindings[operation.id];
      if (!invoke) throw new Error('HTTP route attempted undeclared operation ' + operation.id + '.');
      return invoke(operationInput, { idempotencyKey: idempotencyKey + ':' + operation.id });
    },
  };
  const invoke = () => directOperationScope.run(
    execute,
    () => handler(requestValue, context),
  );
  const invokeWithModelReads = route.transaction
    ? async () => withApplicationNativeModelReadClients(
        await applicationPostgresModelReadClients(
          sql,
          route.transaction.models,
          {
            values: applicationRequestContextValues(
              principal,
              principal.authorityRevision,
              admission.trustedContext,
            ),
            digest: principal.trustedContextDigest,
            changeScopes: applicationRelationalChangeScopes({
              values: applicationRequestContextValues(
                principal,
                principal.authorityRevision,
                admission.trustedContext,
              ),
              digestSecret: contextSecret,
            }),
          },
        ),
        invoke,
      )
    : invoke;
  const result = route.transaction && route.transaction.mode !== 'read'
    ? await withApplicationNativeModelTransactionRuntime(
        Object.freeze({
          edit: modelRequest => executeFunctionNativePostgresModelEdit({
            ...route.transaction,
            databaseUrl: requiredEnv(route.transaction.model.connectionEnvName),
            delivery: {
              id: invocationId,
              idempotencyKey,
              correlationId: invocationId,
              recordedAt: new Date().toISOString(),
              context: {
                values: applicationRequestContextValues(
                  principal,
                  principal.authorityRevision,
                  admission.trustedContext,
                ),
                digest: principal.trustedContextDigest,
                changeScopes: applicationRelationalChangeScopes({
                  values: applicationRequestContextValues(
                    principal,
                    principal.authorityRevision,
                    admission.trustedContext,
                  ),
                  digestSecret: contextSecret,
                }),
              },
              authorizationReceipt: routeReceipt.receipt,
            },
            revalidateAuthorization: (receipt, boundary, authorization) =>
              operationAuthority.revalidate(
                receipt,
                boundary,
                authorization.trustedContextDigest,
                authorization.transaction,
              ),
          }, modelRequest),
        }),
        invokeWithModelReads,
      )
    : await invokeWithModelReads();
  return validate(route.outputSchema, result, route.id + '.output');
}

function normalizedRequestOrigin(request) {
  const candidate = request.headers.get('origin');
  if (!candidate) return undefined;
  try {
    const origin = new URL(candidate);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return undefined;
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return undefined;
    return origin.origin;
  } catch {
    return undefined;
  }
}

let ready = false;
let stopping = false;
let initializationError;
const server = createServer(async (nodeRequest, nodeResponse) => {
  const url = new URL(nodeRequest.url ?? '/', 'http://' + (nodeRequest.headers.host ?? 'localhost'));
  if (nodeRequest.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
    const healthy = url.pathname === '/healthz' || (ready && !stopping);
    nodeResponse.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    nodeResponse.end(JSON.stringify({ live: true, ready, stopping, ...(initializationError ? { initializationError } : {}) }));
    return;
  }
  if (!ready || stopping) {
    nodeResponse.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
    nodeResponse.end(JSON.stringify({ error: 'typed_http_dependencies_unavailable' }));
    return;
  }
  const match = matchRoute(nodeRequest.method ?? '', url.pathname);
  if (!match) {
    nodeResponse.writeHead(404, { 'content-type': 'application/json' });
    nodeResponse.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  try {
    const body = nodeRequest.method === 'GET' || nodeRequest.method === 'HEAD' ? undefined : nodeRequest;
    const request = new Request(url, {
      method: nodeRequest.method,
      headers: nodeRequest.headers,
      ...(body ? { body, duplex: 'half' } : {}),
    });
    const result = await invokeRoute(
      match.route,
      match.params,
      request,
      url,
      match.runtimeProtocol,
    );
    nodeResponse.writeHead(200, { 'content-type': 'application/json' });
    nodeResponse.end(JSON.stringify(match.runtimeProtocol
      ? {
          protocol: 'applik8s.runtime/v1alpha1',
          operation: match.route.operation.id,
          result,
        }
      : result));
  } catch (error) {
    const status = error instanceof HttpFailure ? error.status : 500;
    const code = error instanceof HttpFailure ? error.code : 'request_failed';
    if (status >= 500) console.error(JSON.stringify({ event: 'applik8s-http-route-failure', server: contract.serverId, route: match.route.id, error: error instanceof Error ? error.message : String(error) }));
    nodeResponse.writeHead(status, { 'content-type': 'application/json' });
    nodeResponse.end(JSON.stringify({ error: code }));
  }
});
async function initialize() {
  while (!stopping && !ready) {
    try {
      await operationAuthority.prepare();
      initializationError = undefined;
      ready = true;
    } catch (error) {
      initializationError = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: 'applik8s-http-startup-failure', error: initializationError }));
      await new Promise(resolveRetry => setTimeout(resolveRetry, 2_000));
    }
  }
}
const listenPort = Number(process.env.APPLIK8S_HTTP_PORT ?? contract.containerPort);
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  throw new Error('APPLIK8S_HTTP_PORT must be an integer from 1 through 65535.');
}
server.listen(listenPort, '0.0.0.0');
void initialize();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  await new Promise(resolveClose => server.close(resolveClose));
  await commandRuntime?.close();
  await sql.end({ timeout: 5 });
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
`;
}

function applicationHttpRouteBindingsSource(
  graph: ApplicationGraph,
  route: HttpRouteCompilerContract,
): string {
  const entries: { readonly path: string; readonly value: string; readonly target: string }[] = [];
  for (const binding of route.operationBindings) {
    entries.push({
      path: binding.identifier,
      value: `operationHandle(${JSON.stringify(binding.operationId)})`,
      target: binding.operationId,
    });
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const binding of route.route.functionNative.transaction?.modelBindings ?? []) {
    const model = nodes.get(binding.model.nodeId);
    if (model?.kind !== 'model') {
      throw new Error(
        `HTTP route ${route.route.id} model binding ${binding.identifier} references missing ${binding.model.nodeId}.`,
      );
    }
    const segments = binding.identifier.split('.');
    const method = segments.at(-1);
    const isRuntimeMethod =
      method !== undefined && ['get', 'find', 'require', 'edit'].includes(method);
    entries.push({
      path: binding.identifier,
      value: isRuntimeMethod
        ? `modelHandle(${JSON.stringify(model.name)})[${JSON.stringify(method)}]`
        : `modelHandle(${JSON.stringify(model.name)})`,
      target: model.id,
    });
  }
  for (const binding of route.route.functionNative.transaction?.eventBindings ?? []) {
    const event = nodes.get(binding.event.nodeId);
    if (event?.kind !== 'event') {
      throw new Error(
        `HTTP route ${route.route.id} event binding ${binding.identifier} references missing ${binding.event.nodeId}.`,
      );
    }
    entries.push({
      path: binding.identifier,
      value: `createApplicationFunctionNativeEventHandle(${JSON.stringify(`${event.contract.name}.${event.contract.version}`)}, { payload: schema(${JSON.stringify(event.contract.payload.jsonSchema)}, ${JSON.stringify(`${event.name}.payload`)}) })`,
      target: event.id,
    });
  }
  return nestedBindingsSource(entries, `HTTP route ${route.route.id}`);
}

function applicationHttpRouteBindingRoots(
  route: HttpRouteCompilerContract,
): readonly string[] {
  return applicationHttpRouteBindingPaths(route).map(bindingRoot).filter(
    (identifier, index, identifiers) => identifiers.indexOf(identifier) === index,
  );
}

function applicationHttpRouteBindingPaths(
  route: HttpRouteCompilerContract,
): readonly string[] {
  return [
    ...route.operationBindings.map((binding) => binding.identifier),
    ...(route.route.functionNative.transaction?.modelBindings ?? []).map(
      (binding) => binding.identifier,
    ),
    ...(route.route.functionNative.transaction?.eventBindings ?? []).map(
      (binding) => binding.identifier,
    ),
  ];
}

function generatedHttpTransactionContract(
  graph: ApplicationGraph,
  route: HttpRouteCompilerContract,
): string {
  const transaction = route.route.functionNative.transaction;
  if (!transaction) return 'undefined';
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const primary = nodes.get(transaction.primaryModel.nodeId);
  if (primary?.kind !== 'model' || !primary.runtime) {
    throw new Error(
      `HTTP route ${route.route.id} primary transaction model has no PostgreSQL runtime.`,
    );
  }
  const models = transaction.models.map((reference) => {
    const model = nodes.get(reference.nodeId);
    if (model?.kind !== 'model' || !model.runtime) {
      throw new Error(
        `HTTP route ${route.route.id} transaction participant ${reference.nodeId} has no PostgreSQL runtime.`,
      );
    }
    return model.runtime;
  });
  const outbox = transaction.outbox.map((reference) => {
    const event = nodes.get(reference.nodeId);
    if (event?.kind !== 'event') {
      throw new Error(
        `HTTP route ${route.route.id} transaction outbox ${reference.nodeId} is not an event.`,
      );
    }
    return {
      kind: 'applik8sEvent',
      id: `${event.contract.name}.${event.contract.version}`,
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
  return JSON.stringify({
    mode: transaction.mode ?? 'write',
    bindingId: `${route.operation.placement.nodeId}:${route.route.id}`,
    model: primary.runtime,
    models,
    outbox,
  });
}

function generatedHttpResources(
  contract: HttpServerCompilerContract,
  image: string,
  digest: string,
): readonly GeneratedApplicationHttpResource[] {
  const name = kubernetesName(contract.server.name);
  const labels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'typed-http',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const metadata = { name, namespace: contract.namespace, labels };
  const environment = [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'NODE_OPTIONS', value: '--enable-source-maps' },
    { name: 'APPLIK8S_APPLICATION_NAME', value: contract.graph.metadata.name },
    { name: 'APPLIK8S_NAMESPACE', value: contract.namespace },
    {
      name: 'APPLIK8S_HTTP_CONTEXT_SECRET',
      valueFrom: {
        secretKeyRef: {
          name: `${kubernetesName(contract.graph.metadata.name)}-context`,
          key: 'key',
          optional: false,
        },
      },
    },
    ...applicationHttpProfileEnvironment(contract.identityConfig),
    ...applicationHttpDatabaseEnvironment(contract),
    ...applicationHttpEventLogEnvironment(contract.eventLog),
  ];
  return [
    { apiVersion: 'v1', kind: 'ServiceAccount', metadata },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata,
      spec: {
        selector: labels,
        ports: [{
          name: 'http',
          port: contract.servicePort,
          targetPort: 'http',
        }],
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
        replicas: contract.replicas,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
        },
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: { 'applik8s.dev/source-digest': digest },
          },
          spec: {
            serviceAccountName: name,
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 30,
            containers: [{
              name: 'http',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'http', containerPort: contract.containerPort }],
              env: environment,
              readinessProbe: {
                httpGet: { path: '/readyz', port: 'http' },
                initialDelaySeconds: 1,
                periodSeconds: 3,
                timeoutSeconds: 2,
                failureThreshold: 10,
              },
              livenessProbe: {
                httpGet: { path: '/healthz', port: 'http' },
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
            }],
            securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
          },
        },
      },
    },
  ];
}

function applicationHttpDatabaseEnvironment(
  contract: HttpServerCompilerContract,
): readonly Record<string, unknown>[] {
  const runtimes = new Map<string, NonNullable<ApplicationModelNode['runtime']>>();
  const nodes = new Map(contract.graph.nodes.map((node) => [node.id, node]));
  for (const route of contract.routes) {
    for (const binding of route.operationBindings) {
      runtimes.set(binding.model.runtime.connectionEnvName, binding.model.runtime);
    }
    for (const reference of route.route.functionNative.transaction?.models ?? []) {
      const model = nodes.get(reference.nodeId);
      if (model?.kind !== 'model' || !model.runtime) continue;
      runtimes.set(model.runtime.connectionEnvName, model.runtime);
    }
  }
  // A typed HTTP route always persists authorization receipts, even when its
  // closure is deliberately capability-free. If the route itself reaches no
  // model, use the application's one unambiguous transactional model runtime
  // as that authority store. Multiple databases remain a fail-closed
  // configuration decision rather than an arbitrary first-match.
  if (runtimes.size === 0) {
    const applicationRuntimes = new Map<
      string,
      NonNullable<ApplicationModelNode['runtime']>
    >();
    for (const node of contract.graph.nodes) {
      if (node.kind !== 'model' || !node.runtime) continue;
      applicationRuntimes.set(node.runtime.connectionEnvName, node.runtime);
    }
    if (applicationRuntimes.size === 1) {
      const [runtime] = applicationRuntimes.values();
      if (runtime) runtimes.set(runtime.connectionEnvName, runtime);
    }
  }
  return [...runtimes.values()].sort((left, right) =>
    left.connectionEnvName.localeCompare(right.connectionEnvName))
    .map((runtime) => ({
      name: runtime.connectionEnvName,
      valueFrom: {
        secretKeyRef: {
          name: runtime.secretName,
          key: runtime.secretKey,
          optional: false,
        },
      },
    }));
}

function applicationHttpAuthorityDatabase(
  contract: HttpServerCompilerContract,
): string {
  const names = applicationHttpDatabaseEnvironment(contract).map((entry) =>
    String(entry.name));
  if (names.length !== 1) {
    throw new Error(
      `Generated typed HTTP server ${contract.server.id} requires one transactional authority database; resolved ${names.length}.`,
    );
  }
  return names[0]!;
}

function applicationHttpEventLog(
  graph: ApplicationGraph,
  handlerIds: ReadonlySet<string>,
  owner: string,
): ApplicationProviderNode {
  const selected = new Set(
    graph.nodes.flatMap((node) =>
      node.kind === 'processor'
      && node.handlers.some((handler) => handlerIds.has(handler.nodeId))
      && node.eventLog
        ? [node.eventLog.nodeId]
        : []),
  );
  const candidates = selected.size > 0
    ? graph.nodes.filter(
        (node): node is ApplicationProviderNode =>
          node.kind === 'provider' && selected.has(node.id),
      )
    : graph.nodes.filter(
        (node): node is ApplicationProviderNode =>
          node.kind === 'provider' && node.interface === 'EventLog',
      );
  if (
    candidates.length !== 1
    || candidates[0]?.interface !== 'EventLog'
    || candidates[0].implementation !== 'nats-jetstream'
  ) {
    throw new Error(
      `Generated typed HTTP server ${owner} direct model operations require exactly one NATS JetStream EventLog.`,
    );
  }
  return candidates[0];
}

function applicationHttpEventLogEnvironment(
  provider: ApplicationProviderNode | undefined,
): readonly Record<string, unknown>[] {
  if (!provider) return [];
  const config = provider.config ?? {};
  const secret = objectValue(config.connectionSecret);
  const servers = Array.isArray(config.servers)
    ? config.servers.filter(
        (value) => applicationGraphStringValue(value) !== undefined,
      )
    : [];
  const name = applicationGraphStringValue(config.name) ?? 'applik8s-events';
  const namespace = applicationGraphStringValue(config.namespace);
  const environment: Record<string, unknown>[] = [
    {
      name: 'APPLIK8S_NATS_SERVERS',
      value: applicationGraphJsonStringArray(
        servers.length > 0
          ? servers
          : [applicationGraphInterpolate(
              'nats://',
              name,
              namespace ? '.' : '',
              namespace,
              '.svc:4222',
            )],
      ),
    },
    {
      name: 'APPLIK8S_NATS_STREAM',
      value: applicationGraphStringValue(config.stream) ?? 'APPLIK8S_EVENTS',
    },
    {
      name: 'APPLIK8S_NATS_SUBJECT_PREFIX',
      value: applicationGraphStringValue(config.subjectPrefix) ?? 'applik8s',
    },
  ];
  const secretName = applicationGraphStringValue(secret.name);
  if (!secretName) return environment;
  if ((stringValue(config.authMode) ?? 'token') === 'userPassword') {
    environment.push(
      {
        name: 'APPLIK8S_NATS_USER',
        valueFrom: {
          secretKeyRef: {
            name: secretName,
            key: stringValue(config.userKey) ?? 'user',
          },
        },
      },
      {
        name: 'APPLIK8S_NATS_PASSWORD',
        valueFrom: {
          secretKeyRef: {
            name: secretName,
            key: stringValue(config.passwordKey) ?? 'password',
          },
        },
      },
    );
  } else {
    environment.push({
      name: 'APPLIK8S_NATS_TOKEN',
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: stringValue(config.tokenKey) ?? 'token',
        },
      },
    });
  }
  return environment;
}

export function applicationHttpProfileEnvironment(
  identity: Readonly<Record<string, unknown>>,
): readonly Record<string, unknown>[] {
  const profile = objectValue(identity.authenticationProfile);
  const selector = stringValue(profile.selector);
  if (!selector) return [];
  if (/^\$\{.+\}$/u.test(selector)) {
    return [{ name: 'APPLIK8S_PROFILE_VARIANT', value: selector }];
  }
  const schemaPath = /^schema\.spec\.[A-Za-z_][A-Za-z0-9_.]*$/u.exec(
    selector,
  );
  if (!schemaPath) {
    throw new Error(
      `Generated typed HTTP profile selector ${JSON.stringify(selector)} cannot be lowered to a workload environment binding.`,
    );
  }
  return [{
    name: 'APPLIK8S_PROFILE_VARIANT',
    value: `\${${selector}}`,
  }];
}

async function writeIdentityModule(
  directory: string,
  identity: Readonly<Record<string, unknown>>,
): Promise<void> {
  const profile = objectValue(identity.authenticationProfile);
  if (Object.keys(profile).length === 0) {
    const source = stringValue(identity.authenticationSource);
    if (!source) throw new Error('IdentityProvider authentication source is missing.');
    await writeCallbackModule(
      directory,
      'identity',
      source,
      handlerDependencies(identity.authenticationDependencies),
    );
    return;
  }
  const cases = objectValue(profile.cases);
  const imports: string[] = [];
  const entries: string[] = [];
  for (const [variant, raw] of Object.entries(cases)) {
    const callback = objectValue(raw);
    const suffix = createHash('sha256').update(variant).digest('hex').slice(0, 12);
    const module = `identity-profile-${suffix}`;
    await writeCallbackModule(
      directory,
      module,
      requiredString(callback.authenticationSource, `Identity profile ${variant}`),
      handlerDependencies(callback.authenticationDependencies),
    );
    imports.push(
      `import { callback as identity_${suffix} } from './${module}.generated.js';`,
    );
    entries.push(`${JSON.stringify(variant)}: identity_${suffix}`);
  }
  const fallback = objectValue(profile.default);
  await writeCallbackModule(
    directory,
    'identity-profile-default',
    requiredString(fallback.authenticationSource, 'Identity profile default'),
    handlerDependencies(fallback.authenticationDependencies),
  );
  await writeFile(
    join(directory, 'identity.generated.ts'),
    `${imports.join('\n')}
import { callback as identity_default } from './identity-profile-default.generated.js';
const callbacks = { ${entries.join(', ')} };
export const callback = (...args) => {
  const variant = process.env.APPLIK8S_PROFILE_VARIANT;
  if (!variant) throw new Error('Missing required environment variable APPLIK8S_PROFILE_VARIANT.');
  return (callbacks[variant] ?? identity_default)(...args);
};
`,
  );
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

function nestedBindingsSource(
  entries: readonly {
    readonly path: string;
    readonly value: string;
    readonly target: string;
  }[],
  owner: string,
): string {
  interface BindingNode {
    direct?: { readonly value: string; readonly target: string };
    readonly children: Map<string, BindingNode>;
  }
  const roots = new Map<string, BindingNode>();
  for (const entry of entries) {
    const segments = entry.path.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      throw new Error(`${owner} binding ${entry.path} has no serializable root.`);
    }
    const [root, ...rest] = segments as [string, ...string[]];
    const rootNode: BindingNode = roots.get(root) ?? {
      children: new Map<string, BindingNode>(),
    };
    roots.set(root, rootNode);
    let current = rootNode;
    for (const segment of rest) {
      const child: BindingNode = current.children.get(segment) ?? {
        children: new Map<string, BindingNode>(),
      };
      current.children.set(segment, child);
      current = child;
    }
    if (current.direct && current.direct.target !== entry.target) {
      throw new Error(`${owner} binding ${entry.path} is ambiguous.`);
    }
    current.direct = { value: entry.value, target: entry.target };
  }

  const sourceFor = (node: BindingNode): string => {
    if (node.direct && node.children.size === 0) return node.direct.value;
    const properties = [...node.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([property, child]) =>
        `${JSON.stringify(property)}: ${sourceFor(child)}`)
      .join(', ');
    return `{ ${node.direct ? `...${node.direct.value}, ` : ''}${properties} }`;
  };

  return `{ ${[...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, node]) => `${JSON.stringify(root)}: ${sourceFor(node)}`)
    .join(', ')} }`;
}

function uniqueOperationBindings(
  routes: readonly HttpRouteCompilerContract[],
): readonly HttpOperationBinding[] {
  const bindings = new Map<string, HttpOperationBinding>();
  for (const binding of routes.flatMap((route) => route.operationBindings)) {
    const key = `${binding.command.id}\0${binding.handler.id}`;
    const previous = bindings.get(key);
    if (previous && JSON.stringify(previous.model.runtime) !== JSON.stringify(binding.model.runtime)) {
      throw new Error(`Typed HTTP operation ${binding.operationId} resolves inconsistent model runtimes.`);
    }
    bindings.set(key, previous ?? binding);
  }
  return [...bindings.values()].sort((left, right) =>
    left.operationId.localeCompare(right.operationId));
}

function generatedServerNamespace(server: ApplicationServerNode): string | undefined {
  const resource = server.generatedResources?.find(
    (candidate) => candidate.role === 'workload',
  )?.resource;
  return resource && 'namespace' in resource
    && typeof resource.namespace === 'string'
    ? resource.namespace
    : undefined;
}

function bindingRoot(identifier: string): string {
  const root = identifier.split('.')[0]?.trim();
  if (!root || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) {
    throw new Error(`Typed HTTP callback binding ${identifier} has no serializable root.`);
  }
  return root;
}

function handlerDependencies(value: unknown): ApplicationHandlerDependencies | undefined {
  if (!isJsonObject(value)) return undefined;
  const source = stringValue(value.source);
  const resolveDir = stringValue(value.resolveDir);
  return source && resolveDir ? { source, resolveDir } : undefined;
}

function requiredString(value: unknown, owner: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(`${owner} has no serializable callback source.`);
  return result;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function kubernetesName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error(`Typed HTTP workload name ${JSON.stringify(value)} is empty.`);
  }
  if (normalized.length <= 63) return normalized;
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 10);
  return `${normalized.slice(0, 52).replace(/-+$/g, '')}-${hash}`;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return isJsonObject(value) ? value : {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
