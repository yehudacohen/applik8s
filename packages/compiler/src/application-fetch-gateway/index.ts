import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
	ApplicationCrdNode,
	ApplicationGatewayNode,
	ApplicationGraph,
	ApplicationObjectStoreNode,
	ApplicationProviderNode,
	ApplicationQueryNode,
	ApplicationSerializedCallbackContract,
} from "@applik8s/core";
import { applicationGraphStringValue } from "../application-installation-values.js";

const applicationRuntimeNamespaceMarker = "__APPLIK8S_RUNTIME_NAMESPACE__";

export interface GeneratedApplicationFetchGatewayModules {
	readonly entrypoint: string;
	readonly files: Readonly<Record<string, string>>;
}

/**
 * Generates a framework-neutral Fetch gateway from graph metadata.
 *
 * Each callback is isolated in its own module so transitive captures can be
 * bundled without helper-name collisions. The browser facade never imports
 * these modules.
 */
export function generatedApplicationFetchGatewayModules(
	graph: ApplicationGraph,
): GeneratedApplicationFetchGatewayModules | undefined {
	const remoteGateways = graph.nodes.filter(
		(node): node is ApplicationGatewayNode =>
			node.kind === "gateway" && node.materialization === "generatedDeployment",
	);
	const objectStores = graph.nodes.filter(
		(node): node is ApplicationObjectStoreNode => node.kind === "objectStore",
	);
	const remoteRoutes = applicationRemoteGatewayRoutes(graph, remoteGateways);
	const hasRemoteQueries = remoteRoutes.routes.some(([route]) =>
		route.startsWith("query:"),
	);
	const routed = new Set(remoteRoutes.routes.map(([route]) => route));
	// A query or command assigned to a generated gateway executes there. Keeping
	// a duplicate local Kubernetes gateway in the web host would both bypass the
	// declared workload boundary and pull the Kubernetes SDK into an otherwise
	// lean SSR image even though the route is always forwarded first.
	const queries = graph.nodes.filter(
		(node): node is ApplicationQueryNode =>
			node.kind === "query" &&
			Boolean(node.kubernetes) &&
			!routed.has(`query:${node.publicId ?? `${node.name}.${node.version}`}`),
	);
	const commands = graph.nodes.filter(
		(node): node is ApplicationCrdNode =>
			node.kind === "crd" &&
			Boolean(node.create) &&
			!routed.has(`command:${node.name}.create`),
	);
	if (
		queries.length === 0 &&
		commands.length === 0 &&
		remoteGateways.length === 0 &&
		objectStores.length === 0
	)
		return undefined;
	const identity = graph.nodes.filter(
		(node): node is ApplicationProviderNode =>
			node.kind === "provider" && node.interface === "IdentityProvider",
	);
	if (
		(queries.length > 0 || commands.length > 0 || objectStores.length > 0) &&
		identity.length !== 1
	)
		throw new Error(
			"Generated application Fetch gateway requires exactly one IdentityProvider provider.",
		);
	const files: Record<string, string> = {};
	const imports =
		queries.length > 0 || commands.length > 0
			? [
					"import { createApplik8sKubernetesGateway } from '@applik8s/server/kubernetes-gateway';",
				]
			: [];
	if (hasRemoteQueries)
		imports.push(
			"import { proxyApplicationQueryMultiplex } from '@applik8s/applik8s/query-runtime';",
		);
	if (objectStores.length > 0)
		imports.push(
			"import { createApplicationFetchGateway } from '@applik8s/applik8s/reactive-runtime';",
			"import { createS3ApplicationObjectStorageRuntime } from '@applik8s/runtime-s3';",
		);
	const authenticate =
		(queries.length > 0 || commands.length > 0 || objectStores.length > 0) &&
		identity.length === 1
			? graphCallback(
					files,
					imports,
					identity[0]?.id ?? "IdentityProvider",
					"identity",
					serializedCallbackConfig(
						objectConfig(objectConfig(identity[0]?.config).identity),
						"authentication",
					),
				)
			: undefined;
	const querySources = queries.map((query) => {
		if (!query.kubernetes)
			throw new Error(
				`Application query ${query.id} lost its Kubernetes authority.`,
			);
		const callbacks = {
			authorize: graphCallback(files, imports, query.id, "authorize", {
				source: query.authorizationSource,
				...(query.authorizationDependencies
					? { dependencies: query.authorizationDependencies }
					: {}),
				...(query.authorizationLocation
					? { location: query.authorizationLocation }
					: {}),
				...(query.authorizationUnresolved
					? { unresolved: query.authorizationUnresolved }
					: {}),
			}),
			namespace: query.kubernetes.namespaceResolver
				? graphCallback(
						files,
						imports,
						query.id,
						"namespace",
						query.kubernetes.namespaceResolver,
					)
				: undefined,
			labelSelector: query.kubernetes.labelSelector
				? graphCallback(
						files,
						imports,
						query.id,
						"label-selector",
						query.kubernetes.labelSelector,
					)
				: undefined,
			fieldSelector: query.kubernetes.fieldSelector
				? graphCallback(
						files,
						imports,
						query.id,
						"field-selector",
						query.kubernetes.fieldSelector,
					)
				: undefined,
			filter: query.kubernetes.filter
				? graphCallback(
						files,
						imports,
						query.id,
						"filter",
						query.kubernetes.filter,
					)
				: undefined,
			compare: query.kubernetes.compare
				? graphCallback(
						files,
						imports,
						query.id,
						"compare",
						query.kubernetes.compare,
					)
				: undefined,
			project: graphCallback(
				files,
				imports,
				query.id,
				"project",
				query.kubernetes.project,
			),
			limit: query.kubernetes.limit
				? graphCallback(
						files,
						imports,
						query.id,
						"limit",
						query.kubernetes.limit,
					)
				: undefined,
		};
		const model = requiredCrd(graph, query.kubernetes.model.nodeId, query.id);
		const fixedNamespace = query.kubernetes.namespace
			? applicationFetchGatewayNamespaceSource(query.kubernetes.namespace)
			: undefined;
		const allowedNamespace =
			query.kubernetes.resource.scope === "Namespaced"
				? (fixedNamespace ??
					(callbacks.namespace ? "requiredRuntimeNamespace()" : undefined))
				: undefined;
		if (query.kubernetes.resource.scope === "Namespaced" && !allowedNamespace) {
			throw new Error(
				`Application query ${query.id} must declare a fixed namespace or a namespace resolver bounded to the ApplicationHost namespace.`,
			);
		}
		return `{
      id: ${JSON.stringify(query.publicId ?? `${query.name}.${query.version}`)},
      model: ${JSON.stringify(model.name)},
      resource: ${JSON.stringify(query.kubernetes.resource)},
      inputSchema: ${JSON.stringify(query.input.jsonSchema)},
      outputSchema: ${JSON.stringify(query.output.jsonSchema)},
      budgets: ${JSON.stringify(query.budgets)},
      bounds: ${JSON.stringify({ pageSize: query.kubernetes.pageSize, maxPages: query.kubernetes.maxPages, maxItems: query.kubernetes.maxItems })},
      ${allowedNamespace ? `allowedNamespaces: [${allowedNamespace}],` : ""}
      authorize: (request) => ${callbacks.authorize}(request),
      ${fixedNamespace ? `fixedNamespace: ${fixedNamespace},` : ""}
      ${callbacks.namespace ? `namespace: (request) => ${callbacks.namespace}(request),` : ""}
      ${callbacks.labelSelector ? `labelSelector: (request) => ${callbacks.labelSelector}(request),` : ""}
      ${callbacks.fieldSelector ? `fieldSelector: (request) => ${callbacks.fieldSelector}(request),` : ""}
      ${callbacks.filter ? `filter: (request) => ${callbacks.filter}(request),` : ""}
      ${callbacks.compare ? `compare: (request) => ${callbacks.compare}(request),` : ""}
      project: (request) => ${callbacks.project}(request),
      ${callbacks.limit ? `limit: (request) => ${callbacks.limit}(request),` : ""}
    }`;
	});
	const commandSources = commands.map((model) => {
		if (!model.create)
			throw new Error(
				`Kubernetes model ${model.id} lost its create authority.`,
			);
		const authorize = graphCallback(
			files,
			imports,
			model.id,
			"create-authorize",
			model.create.authorize,
		);
		const place = graphCallback(
			files,
			imports,
			model.id,
			"create-place",
			model.create.place,
		);
		return `{
      id: ${JSON.stringify(`${model.name}.create`)},
      model: ${JSON.stringify(model.name)},
      resource: ${JSON.stringify(model.resource)},
      inputSchema: ${JSON.stringify(model.create.input.jsonSchema)},
      ${model.resource.scope === "Namespaced" ? "allowedNamespaces: [requiredRuntimeNamespace()]," : ""}
      authorize: (request) => ${authorize}(request),
      place: (request) => ${place}(request),
    }`;
	});
	const localGateway =
		authenticate && (queries.length > 0 || commands.length > 0)
			? `createApplik8sKubernetesGateway({
  authenticate: (request) => ${authenticate}(request),
  cursorSecret: requiredEnv('APPLIK8S_CURSOR_SECRET'),
  commands: [${commandSources.join(",\n")}],
  queries: [${querySources.join(",\n")}],
})`
			: "undefined";
	const objectGateway =
		objectStores.length > 0 && authenticate
			? `createApplicationFetchGateway({
  identity: { kind: 'identity-provider', authenticate: (request) => ${authenticate}(request) },
  cursorSecret: requiredEnv('APPLIK8S_CURSOR_SECRET'),
  objects: [${objectStores.map(objectStoreGatewaySource).join(",\n")}],
})`
			: "undefined";
	files["gateway.generated.ts"] = `${imports.join("\n")}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`Missing required environment variable \${name}\`);
  return value;
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

let installationSpec: unknown;
function installationBoolean(value, label) {
  if (typeof value === 'boolean') return value;
  const match = /^\\$\\{schema\\.spec\\.([A-Za-z0-9_.]+)\\}$/.exec(value);
  if (!match?.[1]) throw new Error(\`Generated application object store \${label} has an unsupported enabled expression: \${value}\`);
  installationSpec ??= JSON.parse(requiredEnv('APPLIK8S_INSTALLATION_SPEC'));
  let current = installationSpec;
  for (const segment of match[1].split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      throw new Error(\`Generated application object store \${label} enabled path \${match[1]} is missing from APPLIK8S_INSTALLATION_SPEC.\`);
    }
    current = current[segment];
  }
  if (typeof current !== 'boolean') throw new Error(\`Generated application object store \${label} enabled path \${match[1]} is not boolean.\`);
  return current;
}

const objectStorageProvider = () => ({
  kind: 's3',
  bucket: requiredEnv('APPLIK8S_OBJECT_STORAGE_BUCKET'),
  region: requiredEnv('APPLIK8S_OBJECT_STORAGE_REGION'),
  ...(optionalEnv('APPLIK8S_OBJECT_STORAGE_PREFIX') ? { prefix: optionalEnv('APPLIK8S_OBJECT_STORAGE_PREFIX') } : {}),
  ...(optionalEnv('APPLIK8S_OBJECT_STORAGE_ENDPOINT') ? { endpoint: optionalEnv('APPLIK8S_OBJECT_STORAGE_ENDPOINT') } : {}),
  forcePathStyle: optionalEnv('APPLIK8S_OBJECT_STORAGE_FORCE_PATH_STYLE') === 'true',
});

const runtimeNamespace = process.env.APPLIK8S_NAMESPACE;
function requiredRuntimeNamespace() {
  if (!runtimeNamespace) throw new Error('Missing required environment variable APPLIK8S_NAMESPACE');
  return runtimeNamespace;
}

const localGateway = ${localGateway};
const objectGateway = ${objectGateway};
const materializeRemoteBaseUrl = (baseUrl) => {
  if (!baseUrl.includes(${JSON.stringify(applicationRuntimeNamespaceMarker)})) return baseUrl;
  if (!runtimeNamespace) throw new Error('Missing required environment variable APPLIK8S_NAMESPACE');
  return baseUrl.replaceAll(${JSON.stringify(applicationRuntimeNamespaceMarker)}, runtimeNamespace);
};
const remoteRoutes = new Map(${JSON.stringify(remoteRoutes.routes)}.map(([route, baseUrl]) => [route, materializeRemoteBaseUrl(baseUrl)]));
const remoteHealth = ${JSON.stringify(remoteRoutes.health)}.map(({ name, baseUrl }) => ({ name, baseUrl: materializeRemoteBaseUrl(baseUrl) }));

export const gateway = {
  async handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__applik8s/v1/healthz') {
      // Liveness answers only whether this process can serve requests. Coupling
      // it to downstream gateways turns a dependency outage into a restart
      // storm and prevents those dependencies from recovering under pressure.
      return new Response(JSON.stringify({ live: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/__applik8s/v1/readyz') {
      const remoteResults = await Promise.all(remoteHealth.map(async ({ name, baseUrl }) => {
        try {
          const response = await fetch(new URL('/ready', baseUrl));
          return { name, ready: response.ok };
        } catch (error) {
          return { name, ready: false, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      let localReady = true;
      try {
        localReady = !localGateway || (await localGateway.handle(request.clone())).ok;
        await objectGateway?.ready();
      } catch {
        localReady = false;
      }
      const ready = localReady && remoteResults.every((dependency) => dependency.ready);
      return new Response(JSON.stringify({ ready, dependencies: remoteResults }), { status: ready ? 200 : 503, headers: { 'content-type': 'application/json' } });
    }
    ${
			hasRemoteQueries
				? `const multiplexResponse = await proxyApplicationQueryMultiplex(request, {
      resolve(query) {
        const remoteBaseUrl = remoteRoutes.get(\`query:\${query}\`);
        if (remoteBaseUrl) return { id: \`remote:\${remoteBaseUrl}\`, handle: (targetRequest) => forwardRemoteRequest(targetRequest, remoteBaseUrl) };
        if (localGateway) return { id: 'local', handle: (targetRequest) => localGateway.handle(targetRequest) };
        return undefined;
      },
      onUpstreamError(error, targets) { console.error('Applik8s query multiplex upstream failure', { error, targets }); },
    });
    if (multiplexResponse) return multiplexResponse;`
				: ""
		}
    const route = applicationGatewayRoute(url.pathname);
    if (objectGateway && route?.startsWith('object:')) return objectGateway.handle(request);
    const remoteBaseUrl = route ? remoteRoutes.get(route) : undefined;
    if (remoteBaseUrl) {
      return forwardRemoteRequest(request, remoteBaseUrl);
    }
    if (localGateway) return localGateway.handle(request);
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  },
};

function applicationGatewayRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === '__applik8s' && parts[1] === 'v1') parts.splice(0, 2);
  if (parts[0] === 'queries' && parts[1]) return \`query:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'commands' && parts[1]) return \`command:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'streams' && parts[1]) return \`stream:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'runtime' && parts[1]?.startsWith('objectStore.')) return \`object:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'objects' && parts[1]) return \`object:\${decodeURIComponent(parts[1])}\`;
  return undefined;
}

function forwardRemoteRequest(request, remoteBaseUrl) {
  const url = new URL(request.url);
  const remotePath = (url.pathname.startsWith('/__applik8s/v1') ? url.pathname.slice('/__applik8s/v1'.length) : url.pathname) || '/';
  return fetch(new Request(new URL(remotePath + url.search, remoteBaseUrl), request));
}

export const handleApplik8sRequest = (request) => gateway.handle(request);
`;
	return { entrypoint: "gateway.generated.ts", files };
}

function applicationRemoteGatewayRoutes(
	graph: ApplicationGraph,
	gateways: readonly ApplicationGatewayNode[],
): {
	readonly routes: readonly (readonly [string, string])[];
	readonly health: readonly {
		readonly name: string;
		readonly baseUrl: string;
	}[];
} {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const routes = new Map<string, string>();
	const health: { readonly name: string; readonly baseUrl: string }[] = [];
	for (const gateway of gateways) {
		if (!gateway.deployment)
			throw new Error(
				`Generated application gateway ${gateway.id} has no deployment contract.`,
			);
		const service = kubernetesName(`${graph.metadata.name}-${gateway.name}`);
		const namespace = applicationGatewayRuntimeNamespace(
			gateway.deployment.namespace,
			gateway.id,
		);
		const baseUrl = `http://${service}.${namespace}.svc:${gateway.deployment.port}`;
		health.push({ name: gateway.name, baseUrl });
		for (const query of gateway.queries) {
			const node = nodes.get(query.nodeId);
			if (node?.kind !== "query")
				throw new Error(
					`Generated application gateway ${gateway.id} references missing query ${query.nodeId}.`,
				);
			add(
				`query:${node.publicId ?? `${node.name}.${node.version}`}`,
				baseUrl,
				gateway.id,
			);
		}
		for (const command of gateway.commands) {
			const node = nodes.get(command.command.nodeId);
			if (node?.kind !== "command")
				throw new Error(
					`Generated application gateway ${gateway.id} references missing command ${command.command.nodeId}.`,
				);
			add(`command:${node.name}`, baseUrl, gateway.id);
		}
		for (const subscription of gateway.subscriptions) {
			const node = nodes.get(subscription.nodeId);
			if (node?.kind !== "subscription")
				throw new Error(
					`Generated application gateway ${gateway.id} references missing subscription ${subscription.nodeId}.`,
				);
			add(`stream:${node.name}`, baseUrl, gateway.id);
		}
	}
	for (const node of graph.nodes) {
		if (node.kind !== "query" || !node.modelOperation || node.kubernetes)
			continue;
		const publicId = node.publicId ?? `${node.name}.${node.version}`;
		if (!routes.has(`query:${publicId}`)) {
			const model = graph.nodes.find(
				(candidate) => candidate.id === node.modelOperation?.model.nodeId,
			);
			const operation = `${model?.kind === "model" || model?.kind === "crd" ? model.name : node.modelOperation.model.nodeId}.${node.modelOperation.name}`;
			throw new Error(
				`Generated application facade query ${publicId} is not exposed by a generated gateway. Add ${operation} to exactly one app.gateway(...).queries list.`,
			);
		}
	}
	for (const node of graph.nodes) {
		if (node.kind !== "model" && node.kind !== "crd") continue;
		for (const operation of node.common?.operations ?? []) {
			if (
				operation.transport !== "command" ||
				operation.authorization === "undeclared"
			)
				continue;
			if (
				node.kind === "crd" &&
				operation.operation === "create" &&
				node.create
			)
				continue;
			if (!routes.has(`command:${operation.publicId}`)) {
				throw new Error(
					`Generated application facade command ${operation.publicId} is not exposed by a generated gateway. Add ${node.name}.${operation.name} to exactly one app.gateway(...).commands list.`,
				);
			}
		}
	}
	return {
		routes: [...routes.entries()].sort(([left], [right]) =>
			left.localeCompare(right),
		),
		health: health.sort((left, right) => left.name.localeCompare(right.name)),
	};

	function add(route: string, baseUrl: string, owner: string): void {
		const existing = routes.get(route);
		if (existing && existing !== baseUrl)
			throw new Error(
				`Generated application route ${route} is exposed by multiple gateways, including ${owner}.`,
			);
		routes.set(route, baseUrl);
	}
}

function applicationGatewayRuntimeNamespace(
	value: unknown,
	gatewayId: string,
): string {
	const namespace = applicationGraphStringValue(value);
	if (!namespace)
		throw new Error(
			`Generated application gateway ${gatewayId} has no deployment namespace.`,
		);
	if (namespace === "${schema.spec.name}")
		return applicationRuntimeNamespaceMarker;
	if (namespace.startsWith("${")) {
		throw new Error(
			`Generated application gateway ${gatewayId} uses unsupported dynamic namespace ${namespace}; installation-scoped gateways must use app.installation.spec.name.`,
		);
	}
	return namespace;
}

function applicationFetchGatewayNamespaceSource(namespace: string): string {
	return namespace === "${schema.spec.name}"
		? "requiredRuntimeNamespace()"
		: JSON.stringify(namespace);
}

function kubernetesName(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/g, "");
	if (!normalized)
		throw new Error(
			`Generated application service name ${JSON.stringify(value)} is invalid.`,
		);
	return normalized;
}

function objectStoreGatewaySource(store: ApplicationObjectStoreNode): string {
	return `{
    name: ${JSON.stringify(store.name)},
    enabled: process.env.APPLIK8S_OBJECT_STORAGE_ENABLED !== 'false' && installationBoolean(${JSON.stringify(store.enabled ?? true)}, ${JSON.stringify(store.name)}),
    mode: ${JSON.stringify(store.objectMode)},
    maxObjectBytes: ${JSON.stringify(store.maxObjectBytes)},
    contentTypes: ${JSON.stringify(store.contentTypes)},
    browser: ${JSON.stringify(store.browserAccess)},
    runtime: createS3ApplicationObjectStorageRuntime({ store: ${JSON.stringify(store.name)}, provider: objectStorageProvider() }),
  }`;
}

function graphCallback(
	files: Record<string, string>,
	imports: string[],
	owner: string,
	role: string,
	callback: ApplicationSerializedCallbackContract,
): string {
	if (
		callback.unresolved &&
		callback.unresolved.length > 0 &&
		!callback.dependencies
	) {
		throw new Error(
			`Generated application Fetch gateway ${owner} ${role} callback has unresolved captures: ${callback.unresolved.join(", ")}.`,
		);
	}
	const digest = createHash("sha256")
		.update(`${owner}:${role}`)
		.digest("hex")
		.slice(0, 12);
	const file = `${role}-${digest}.generated.ts`;
	const variable = `callback_${role.replace(/[^A-Za-z0-9_$]+/g, "_")}_${digest}`;
	const dependencies = callback.dependencies?.source
		? absoluteDependencyImports(
				callback.dependencies.source,
				callback.dependencies.resolveDir,
			)
		: "";
	files[file] =
		`${dependencies}${dependencies ? "\n\n" : ""}export const callback = (${callback.source});\n`;
	imports.push(
		`import { callback as ${variable} } from './${file.replace(/\.ts$/, ".js")}';`,
	);
	return variable;
}

function requiredCrd(
	graph: ApplicationGraph,
	id: string,
	owner: string,
): ApplicationCrdNode {
	const node = graph.nodes.find(
		(candidate): candidate is ApplicationCrdNode =>
			candidate.kind === "crd" && candidate.id === id,
	);
	if (!node)
		throw new Error(
			`Generated application Fetch gateway ${owner} references missing Kubernetes model ${id}.`,
		);
	return node;
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
			(
				_match,
				line: string,
				prefix: string,
				specifier: string,
				suffix: string,
			) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`,
		);
}

function objectConfig(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === "object" && !Array.isArray(value)
		// typecast: the object/array guard establishes the compiler-owned JSON configuration record boundary.
		? (value as Readonly<Record<string, unknown>>)
		: {};
}

function stringConfig(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function serializedCallbackConfig(
	config: Readonly<Record<string, unknown>>,
	prefix: string,
): ApplicationSerializedCallbackContract {
	const source = stringConfig(config[`${prefix}Source`]);
	if (!source)
		throw new Error(
			`Generated application Fetch gateway ${prefix} callback has no serialized source.`,
		);
	const dependencies = objectConfig(config[`${prefix}Dependencies`]);
	const location = objectConfig(config[`${prefix}Location`]);
	const unresolved = config[`${prefix}Unresolved`];
	return {
		source,
		...(stringConfig(dependencies.source) &&
		stringConfig(dependencies.resolveDir)
			? {
					dependencies: {
						source: stringConfig(dependencies.source),
						resolveDir: stringConfig(dependencies.resolveDir),
					},
				}
			: {}),
		...(stringConfig(location.file) &&
		Number.isSafeInteger(location.line) &&
		Number.isSafeInteger(location.column)
			? {
					location: {
						file: stringConfig(location.file),
						line: Number(location.line),
						column: Number(location.column),
					},
				}
			: {}),
		...(Array.isArray(unresolved) &&
		unresolved.every((value) => typeof value === "string")
			? { unresolved }
			: {}),
	};
}
