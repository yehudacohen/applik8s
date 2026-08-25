// typecast-file-boundary: Generated graph nodes are discriminated by kind before compiler-specific fields are materialized.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
	ApplicationActorNode,
	ApplicationAIAgentNode,
	ApplicationCallableProviderBinding,
	ApplicationCrdNode,
	ApplicationGatewayNode,
	ApplicationGraph,
	ApplicationLakehousePublicationNode,
	ApplicationObjectStoreNode,
	ApplicationProfiledCallbackContract,
	ApplicationProviderNode,
	ApplicationQueryNode,
	ApplicationScheduleNode,
	ApplicationSerializedCallbackContract,
	ApplicationServerNode,
	ApplicationWorkloadAuthorityEnvelope,
} from "@applik8s/core";
import { applicationOperationId } from "@applik8s/core";
import { applicationRuntimeEndpointEnvironmentName } from "@applik8s/deployment-contract";
import {
	capturedApplicationInjectFacade,
	generatedCallbackFactoryModule,
} from "../application-callback-module.js";
import { applicationGraphStringValue } from "../application-installation-values.js";
import {
	applicationGraphHasObservabilityRuntime,
	generatedApplicationTelemetryImports,
	generatedApplicationTelemetryRuntimeSource,
} from "../application-observability-runtime-source.js";
import {
	compileApplicationOperationCatalog,
	compileApplicationWorkloadAuthority,
} from "../application-operations/index.js";
import { generatedApplicationProviderOperationValue } from "../application-provider-telemetry-source.js";
import { applicationHatchetScheduleBindings } from "../application-schedule-hatchet.js";

const applicationRuntimeNamespaceMarker = "__APPLIK8S_RUNTIME_NAMESPACE__";

export interface GeneratedApplicationFetchGatewayModules {
	readonly entrypoint: string;
	readonly files: Readonly<Record<string, string>>;
}

export interface GeneratedApplicationFetchGatewayOptions {
	readonly modelExports?: readonly {
		readonly name: string;
		readonly modelName: string;
	}[];
	readonly actorExports?: readonly {
		readonly name: string;
		readonly actorId: string;
	}[];
	/** Emits only the schedule-control surface for a non-web application. */
	readonly surface?: "all" | "schedules";
	readonly scheduleHost?: {
		readonly name: string;
		readonly namespace: string;
		readonly port: number;
	};
}

interface ApplicationLakehouseDatasetBinding {
	readonly providerId: string;
	readonly qualification: string;
	readonly kind: "duckdb-dataset" | "s3-dataset";
	readonly rowSchema: unknown;
	readonly schemaRevision: string;
	readonly root: string;
	readonly cursorSecretEnvironment: string;
	readonly maximumConcurrentQueries: number;
	readonly targets?: readonly ("local" | "aws-local" | "aws" | "kubernetes")[];
	readonly bucket?: string;
	readonly prefix?: string;
	readonly region?: string;
	readonly catalog?: string;
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
	options: GeneratedApplicationFetchGatewayOptions = {},
): GeneratedApplicationFetchGatewayModules | undefined {
	const schedulesOnly = options.surface === "schedules";
	const exportedModels = new Set(
		(options.modelExports ?? []).map((model) => model.modelName),
	);
	const publishedCommandIds = new Set(
		graph.nodes.flatMap((node) =>
			(node.kind === "model" || node.kind === "crd") &&
			exportedModels.has(node.name)
				? (node.common?.operations ?? [])
						.filter((operation) => operation.transport === "command")
						.map((operation) => operation.publicId)
				: [],
		),
	);
	const commandNodes = new Map(
		graph.nodes.flatMap((node) =>
			node.kind === "command" ? [[node.id, node] as const] : [],
		),
	);
	const remoteGateways = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationGatewayNode =>
			node.kind === "gateway" &&
			node.materialization === "generatedDeployment" &&
			(node.visibility !== "internal" ||
				node.commands.some((command) => {
					const commandNode = commandNodes.get(command.command.nodeId);
					return commandNode
						? publishedCommandIds.has(commandNode.name)
						: false;
				})),
	);
	const objectStores = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationObjectStoreNode => node.kind === "objectStore",
	);
	const objectStorageProviderNames = schedulesOnly ? [] : graph.nodes.flatMap((node) =>
		node.kind === "provider" && node.interface === "ObjectStorage"
			&& !node.config?.qualification
			? [node.name]
			: [],
	);
	const gatewayObservationSubjects = schedulesOnly ? [] : graph.nodes.flatMap((node) =>
		node.kind === "gateway" || node.kind === "server" || node.kind === "exposure"
			? [node.name]
			: [],
	);
	const agents = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationAIAgentNode => node.kind === "aiAgent",
	);
	const schedules = graph.nodes.filter(
		(node): node is ApplicationScheduleNode =>
			node.kind === "schedule"
			&& (!schedulesOnly || graph.nodes.some((provider) =>
				provider.id === node.scheduler.nodeId
				&& provider.kind === "provider"
				&& provider.interface === "Scheduler"
				&& !provider.config?.qualification)),
	);
	const scheduleProviders = new Map(
		graph.nodes.flatMap((node) =>
			node.kind === "provider" && node.interface === "Scheduler"
				? [[node.id, node] as const]
				: []),
	);
	for (const schedule of schedules) {
		if (!scheduleProviders.has(schedule.scheduler.nodeId)) {
			throw new Error(
				`Schedule ${schedule.definition.id} references missing Scheduler provider ${schedule.scheduler.nodeId}.`,
			);
		}
	}
	const hatchetScheduleBindings = schedulesOnly
		? []
		: applicationHatchetScheduleBindings(graph);
	const workflowScheduleTargets = schedules.filter(
		(schedule): schedule is ApplicationScheduleNode & { readonly target: NonNullable<ApplicationScheduleNode["target"]> } =>
			schedule.target?.kind === "durableStart",
	);
	const actors = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationActorNode => node.kind === "actor",
	);
	const publicActorIds = new Set((options.actorExports ?? []).map(({ actorId }) => actorId));
	const publicActors = actors.filter((actor) =>
		actor.publication?.boundary === "entrypoint-export" && publicActorIds.has(actor.definition.id),
	);
	const lakehousePublications = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationLakehousePublicationNode =>
			node.kind === "lakehousePublication",
	);
	const lakehouseDatasets = applicationLakehouseDatasets(
		graph,
		lakehousePublications,
	);
	const lakehouseQueries = applicationLakehouseQueries(graph);
	const observability = !schedulesOnly && applicationGraphHasObservabilityRuntime(graph);
	const hasCallableProviderOperations = [...actors, ...schedules].some((node) =>
		(node.providerBindings ?? []).some((binding) => binding.operation));
	const agentTargets = applicationAgentGatewayTargets(graph, agents);
	const remoteRoutes = schedulesOnly
		? { routes: [], health: [] }
		: mergeRemoteRouteContracts(
			applicationRemoteGatewayRoutes(graph, remoteGateways),
			applicationPublishedHttpRoutes(graph),
		);
	const hasRemoteQueries = remoteRoutes.routes.some(([route]) =>
		route.startsWith("query:"),
	);
	const routed = new Set(remoteRoutes.routes.map(([route]) => route));
	// A query or command assigned to a generated gateway executes there. Keeping
	// a duplicate local Kubernetes gateway in the web host would both bypass the
	// declared workload boundary and pull the Kubernetes SDK into an otherwise
	// lean SSR image even though the route is always forwarded first.
	const queries = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationQueryNode =>
			node.kind === "query" &&
			Boolean(node.kubernetes) &&
			!routed.has(`query:${node.publicId ?? `${node.name}.${node.version}`}`),
	);
	const commands = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationCrdNode =>
			node.kind === "crd" &&
			Boolean(node.create) &&
			!routed.has(`command:${node.name}.create`),
	);
	const identityCandidates = schedulesOnly ? [] : graph.nodes.filter(
		(node): node is ApplicationProviderNode =>
			node.kind === "provider" && node.interface === "IdentityProvider",
	);
	// Qualified providers remain in the graph as selectable profile/catalog
	// entries. The Fetch gateway consumes the one unqualified application
	// binding, which may itself be a profile-selection proxy. Counting both the
	// binding and its named source makes ordinary `inject(named)` wiring appear
	// ambiguous even though the application has one effective identity.
	const identity = identityCandidates.filter(
		(node) => !node.config?.qualification,
	);
	const identityAuthorityDatabaseEnvironment = schedulesOnly
		? undefined
		: applicationFetchGatewayIdentityAuthorityDatabaseEnvironment(graph);
	const operationCatalog = identityAuthorityDatabaseEnvironment
		? compileApplicationOperationCatalog(graph)
		: undefined;
	const authorityNode = graph.nodes.find(
		(node) => node.kind === "authorityManifest",
	);
	const authorityManifest = authorityNode?.kind === "authorityManifest"
		? authorityNode.manifest
		: undefined;
	const hasApplicationSurface =
		queries.length > 0 ||
		commands.length > 0 ||
		remoteGateways.length > 0 ||
		remoteRoutes.routes.some(([route]) => route.startsWith("runtime:")) ||
		objectStores.length > 0 ||
			agents.length > 0 ||
			schedules.length > 0 ||
			actors.length > 0 ||
			lakehousePublications.length > 0;
	const requiresApplicationIdentity =
		queries.length > 0 ||
		commands.length > 0 ||
		remoteRoutes.routes.some(([route]) => route.startsWith("runtime:")) ||
		objectStores.length > 0 ||
		agents.length > 0 ||
		publicActors.length > 0;
	if (!hasApplicationSurface && identity.length === 0) return undefined;
	if (
		(requiresApplicationIdentity || identityCandidates.length > 0) &&
		identity.length !== 1
	)
		throw new Error(
			"Generated application Fetch gateway requires exactly one IdentityProvider provider.",
		);
	const hasManagedActorCallers = !schedulesOnly && graph.nodes.some((node) =>
		(node.kind === 'taskHandler' && (node.actors?.length ?? 0) > 0)
		|| (node.kind === 'aiAgent' && (node.actors?.length ?? 0) > 0)
		|| (node.kind === 'streamProcessor' && (node.actorBindings?.length ?? 0) > 0));
	if ((publicActors.length > 0 || hasManagedActorCallers) && (!operationCatalog || !identityAuthorityDatabaseEnvironment)) {
		throw new Error('Application actors require the canonical operation-authority database; actor admission cannot fall back to a shared internal credential.');
	}
	const actorWorkloadAuthority = actors.length > 0 && operationCatalog
		? compileApplicationWorkloadAuthority(graph, operationCatalog)
		: [];
	const files: Record<string, string> = {};
	const imports =
		queries.length > 0 || commands.length > 0
			? [
					"import { createApplik8sKubernetesGateway } from '@applik8s/server/kubernetes-gateway';",
					"import { createApplik8sLocalResourceClients } from '@applik8s/server/local-resource';",
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
	if (agents.length > 0)
		imports.push(
			"import { createApplicationAIAgentGateway } from '@applik8s/runtime-ai';",
		);
	if (
		queries.length > 0 ||
		commands.length > 0 ||
		objectStores.length > 0 ||
		agents.length > 0 ||
		schedules.length > 0
	)
		imports.push(
			"import { applicationAdmissionRejectionCodeV1, createApplicationAdmissionObservationV1 } from '@applik8s/core/admission';",
		);
	if (schedules.length > 0)
		imports.push(
			"import { executeApplicationScheduleAdmission, installApplicationScheduleRuntimeResolver, schedule } from '@applik8s/applik8s';",
			"import { installApplicationInvocationAdmissionResolver } from '@applik8s/client';",
			"import { installLocalApplicationScheduleRuntime } from '@applik8s/applik8s/schedule-runtime-local';",
			"import { createAwsApplicationScheduleRuntime, startAwsApplicationScheduleQueueRunner } from '@applik8s/runtime-aws';",
			"import { createKubernetesApplicationScheduleRuntime, executeKubernetesApplicationScheduleAdmission } from '@applik8s/runtime-kubernetes';",
			"import { AsyncLocalStorage } from 'node:async_hooks';",
		);
	if (hatchetScheduleBindings.length > 0)
		imports.push(
			"import { createHatchetApplicationScheduleRuntime } from '@applik8s/runtime-hatchet';",
		);
	if (workflowScheduleTargets.length > 0)
		imports.push(
			"import { readFile } from 'node:fs/promises';",
			"import { validateApplicationAdmissionContextV1 } from '@applik8s/core';",
			"import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime';",
		);
	if (actors.length > 0)
		imports.push(
			"import { actor, actorState, createApplicationActor, createApplicationActorTurnAuthority, executeApplicationActorAlarm, executeApplicationActorInvocation, executeApplicationActorRealtime, installApplicationActorInvocationAuthorityResolver, installApplicationActorRuntimeResolver, validateApplicationAuthorizationReceipt, withApplicationActorTurnAuthority } from '@applik8s/applik8s';",
			"import { applicationCausalPrincipalContext } from '@applik8s/core';",
			"import { applicationOperationInputDigest } from '@applik8s/applik8s/operation-runtime';",
			"import { createPersistentLocalApplicationActorRuntime } from '@applik8s/applik8s/actor-runtime-local';",
			"import { createApplicationEventLogPublisherFromEnvironment } from '@applik8s/applik8s/event-log-runtime';",
			"import { createCelldApplicationActorRuntime, signCelldActorConnectionTicket } from '@applik8s/runtime-celld';",
			"import { normalizeSchema } from '@applik8s/sdk';",
		);
	if (publicActors.length > 0) imports.push("import { randomUUID } from 'node:crypto';");
	if (lakehousePublications.length > 0)
		imports.push(
			"import { event, executeApplicationLakehousePublication, installApplicationLakehousePublicationRuntimeResolver, installApplicationLakehouseQueryRuntimeResolver, LakehouseDataset } from '@applik8s/applik8s';",
			"import { createDuckDbApplicationLakehouseRuntime } from '@applik8s/runtime-duckdb';",
			"import { createAwsApplicationLakehouseDatasetRuntime, createAwsApplicationLakehouseQueryRuntime } from '@applik8s/runtime-aws';",
			...(actors.length > 0
				? []
				: ["import { normalizeSchema } from '@applik8s/sdk';"]),
		);
	if (actors.length > 0 || lakehousePublications.length > 0 || schedules.length > 0)
		imports.push("import { nodeConstantTimeTextEqual } from '@applik8s/runtime/node-integrity';");
	if (observability || hasCallableProviderOperations)
		imports.push(...generatedApplicationTelemetryImports({
			boundaryRunner: observability,
			carrierCapture: agents.length > 0 || (observability && hasRemoteQueries),
			carrierTransport: observability && hasRemoteQueries,
			providerOperationInstrumentation: hasCallableProviderOperations,
			runtimeImplementation: observability,
		}));
	if (identity.length === 1)
		imports.push(
			"import { createApplicationIdentitySessionHandler } from '@applik8s/identity/server';",
		);
	if (operationCatalog && identityAuthorityDatabaseEnvironment) {
		imports.push(
			"import postgres from 'postgres';",
			"import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';",
		);
	}
	const identityConfig = objectConfig(
		objectConfig(identity[0]?.config).identity,
	);
	const scheduleSources = schedules.map((scheduleNode) => {
		const callback = scheduleNode.handler
			? graphScheduleCallback(files, imports, scheduleNode, scheduleNode.handler)
			: scheduleNode.target?.kind === "durableStart"
				? (() => {
					const target = {
						contract: `${scheduleNode.target.contract.name}.${scheduleNode.target.contract.version}`,
						endpoint: applicationScheduleWorkflowGatewayEndpoint(
							graph,
							scheduleNode,
							options.scheduleHost,
						),
					};
					if (scheduleNode.target.input.kind === "literal") {
						return `async (context) => startScheduledWorkflow(${JSON.stringify({
							...target,
							input: scheduleNode.target.input.value,
						})}, context)`;
					}
					return `async (input, context) => startScheduledWorkflow({ ...${JSON.stringify(target)}, input }, context)`;
				})()
				: (() => { throw new Error(`Schedule ${scheduleNode.id} has neither a handler nor a supported execution target.`); })();
		const definition = scheduleNode.definition;
		const overlapBy = definition.overlapBy
			? graphCallback(
					files,
					imports,
					scheduleNode.id,
					"schedule-overlap-key",
					definition.overlapBy,
				)
			: undefined;
		const scheduleOptions = {
			id: definition.id,
			...(definition.input
				? {
					input: {
						kind: "jsonSchema",
						ref: { kind: "jsonSchema", exportName: `${definition.id}.input` },
						schema: definition.input.jsonSchema,
					},
				}
				: {}),
			...(definition.cron ? { cron: definition.cron } : {}),
			...(definition.every ? { every: definition.every } : {}),
			...(definition.at ? { at: definition.at } : {}),
			timezone: definition.timezone,
			overlap: definition.overlap,
			misfires: definition.misfires,
			maximumLateness: `${definition.maximumLatenessSeconds}s`,
			...(definition.maximumCatchUp ? { maximumCatchUp: definition.maximumCatchUp } : {}),
			retry: { maxAttempts: definition.retry.maxAttempts, maximumAge: `${definition.retry.maximumAgeSeconds}s` },
			requirements: definition.requirements,
		};
		const optionsSource = overlapBy
			? `{ ...${JSON.stringify(scheduleOptions)}, overlapBy: ${overlapBy} }`
			: JSON.stringify(scheduleOptions);
		return `{ schedulerNodeId: ${JSON.stringify(scheduleNode.scheduler.nodeId)}, handle: schedule(${optionsSource}, ${callback}) }`;
	});
	const scheduleHost = schedules.length > 0
		? applicationScheduleHost(graph, options.scheduleHost)
		: undefined;
	const actorSources = actors.map((actorNode) => {
		const protocol = actorNode.definition.protocol.map((member) => {
			const input = member.input
				? `runtimeJsonSchema(${JSON.stringify(member.input.jsonSchema)}, ${JSON.stringify(`${actorNode.definition.id}.${member.name}.input`)})`
				: undefined;
			if (member.kind === "command") {
				if (!input || !member.output) throw new Error(`Actor ${actorNode.id}.${member.name} has an incomplete command contract.`);
				return `${JSON.stringify(member.name)}: actor.command({ input: ${input}, output: runtimeJsonSchema(${JSON.stringify(member.output.jsonSchema)}, ${JSON.stringify(`${actorNode.definition.id}.${member.name}.output`)}) })`;
			}
			if (!input) throw new Error(`Actor ${actorNode.id}.${member.name} has no input contract.`);
			const memberConstructor = member.kind === "message"
				? "message"
				: member.kind === "alarm"
					? "alarm"
					: member.kind === "broadcast"
						? "broadcast"
						: member.kind === "connectionMessage"
							? "connectionMessage"
							: member.kind;
			return `${JSON.stringify(member.name)}: actor.${memberConstructor}(${input})`;
		});
		const initialize = actorNode.initialize
			? graphActorCallback(
					files,
					imports,
					actorNode,
					"initialize",
					"actor-initialize",
					actorNode.initialize,
				)
			: undefined;
		const registrations = actorNode.handlers.map(({ member, callback }) => {
			const generated = graphActorCallback(
				files,
				imports,
				actorNode,
				member,
				`actor-${member}`,
				callback,
			);
			return `binding.on[${JSON.stringify(member)}](${generated});`;
		});
		const migrations = actorNode.definition.migrations.map(({ from, callback }) => {
			const generated = graphCallback(files, imports, actorNode.id, `actor-state-migration-${from}`, callback);
			return `${JSON.stringify(from)}: ${generated}`;
		});
		return `(() => {
  const binding = createApplicationActor(${JSON.stringify(actorNode.definition.id)}, {
    key: runtimeActorKeySchema(${JSON.stringify(actorNode.definition.key.jsonSchema)}, ${JSON.stringify(`${actorNode.definition.id}.key`)}),
    state: actorState({
      version: ${actorNode.definition.stateVersion},
      schema: runtimeJsonSchema(${JSON.stringify(actorNode.definition.state.jsonSchema)}, ${JSON.stringify(`${actorNode.definition.id}.state`)}),
      migrate: { ${migrations.join(", ")} },
    }),
    protocol: { ${protocol.join(", ")} },
  });
  ${initialize ? `binding.on.initialize(${initialize});` : ""}
  ${registrations.join("\n  ")}
  return binding;
})()`;
	});
	const publicActorContracts = publicActors.map((actorNode) => ({
		id: actorNode.definition.id,
		protocolRevision: `sha256:${createHash("sha256").update(JSON.stringify({
			stateVersion: actorNode.definition.stateVersion,
			migrationDigest: actorNode.definition.migrationDigest,
			protocol: actorNode.definition.protocol.map(({ name, kind, input, output }) => ({ name, kind, input: input?.jsonSchema, output: output?.jsonSchema })),
		})).digest("hex")}`,
		members: actorNode.definition.protocol.map(({ name, kind }) => ({ name, kind })),
	}));
	const lakehousePublicationSources = lakehousePublications.map((publication) => {
		const dataset = lakehouseDatasets.find(({ providerId }) =>
			providerId === publication.dataset.nodeId,
		);
		if (!dataset) {
			throw new Error(
				`Lakehouse publication ${publication.id} has no local dataset runtime contract.`,
			);
		}
		const transform = graphCallback(
			files,
			imports,
			publication.id,
			"lakehouse-transform",
			publication.transform,
		);
		const base = `event(${JSON.stringify(publication.sourceEventId)}, { payload: runtimeJsonSchema(${JSON.stringify(publication.source.jsonSchema)}, ${JSON.stringify(`${publication.sourceEventId}.payload`)}) }).publish(LakehouseDataset.named(${JSON.stringify(dataset.qualification)}), runtimeJsonSchema(${JSON.stringify(publication.row.jsonSchema)}, ${JSON.stringify(`${dataset.qualification}.row`)}), ${transform})`;
		if (!publication.partition) return base;
		const partition = graphCallback(
			files,
			imports,
			publication.id,
			"lakehouse-partition",
			publication.partition,
		);
		return `(${base}).partitionBy(${partition})`;
	});
	const authenticationProfile = profiledCallbackConfig(
		identityConfig.authenticationProfile,
		"authentication",
	);
	const identityHttpProfile = profiledCallbackConfig(
		identityConfig.identityHttpProfile,
		"identityHttp",
	);
	const authenticate =
		identity.length === 1
			? authenticationProfile
				? graphProfiledCallback(
						files,
						imports,
						identity[0]?.id ?? "IdentityProvider",
						"identity",
						authenticationProfile,
					)
				: graphCallback(
						files,
						imports,
						identity[0]?.id ?? "IdentityProvider",
						"identity",
						serializedCallbackConfig(
							identityConfig,
							"authentication",
						),
					)
			: undefined;
	const identityHttp =
		identity.length === 1
			? identityHttpProfile
				? graphProfiledCallback(
						files,
						imports,
						identity[0]?.id ?? "IdentityProvider",
						"identity-http",
						identityHttpProfile,
					)
				: stringConfig(identityConfig.identityHttpSource)
					? graphCallback(
							files,
							imports,
							identity[0]?.id ?? "IdentityProvider",
							"identity-http",
							serializedCallbackConfig(identityConfig, "identityHttp"),
						)
					: undefined
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
		const modelNative = query.kubernetes.invocation === "model-native";
		const requestCallback = (callback: string) => `${callback}(request)`;
		const inputCallback = (callback: string) =>
			modelNative
				? `${callback}(request.input, { input: request.input, context: request.context })`
				: requestCallback(callback);
		const valueCallback = (callback: string) =>
			modelNative
				? `${callback}(request.value, { input: request.input, context: request.context })`
				: requestCallback(callback);
		const compareCallback = (callback: string) =>
			modelNative
				? `${callback}(request.left, request.right, { input: request.input, context: request.context })`
				: requestCallback(callback);
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
      ${callbacks.namespace ? `namespace: (request) => ${inputCallback(callbacks.namespace)},` : ""}
      ${callbacks.labelSelector ? `labelSelector: (request) => ${inputCallback(callbacks.labelSelector)},` : ""}
      ${callbacks.fieldSelector ? `fieldSelector: (request) => ${inputCallback(callbacks.fieldSelector)},` : ""}
      ${callbacks.filter ? `filter: (request) => ${valueCallback(callbacks.filter)},` : ""}
      ${callbacks.compare ? `compare: (request) => ${compareCallback(callbacks.compare)},` : ""}
      project: (request) => ${valueCallback(callbacks.project)},
      ${callbacks.limit ? `limit: (request) => ${inputCallback(callbacks.limit)},` : ""}
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
  ...(localResourceClients ?? {}),
  authenticate: (request) => ${authenticate}(request),
  cursorSecret: requiredEnv('APPLIK8S_CURSOR_SECRET'),
  observeAdmission: observeRequestAdmission,
  ${observability ? `queryTelemetry: {
    run: (query, operation, execute) => runApplicationTelemetryBoundary({ kind: 'query', identity: query, definition: operation, relationship: 'synchronous' }, execute),
  },` : ''}
  commands: [${commandSources.join(",\n")}],
  queries: [${querySources.join(",\n")}],
  onError: (error, operation) => console.error('Applik8s Kubernetes application-host request failed', {
    ...operation,
    error,
  }),
})`
			: "undefined";
	const objectGateway =
		objectStores.length > 0 && authenticate
			? `createApplicationFetchGateway({
  identity: { kind: 'identity-provider', authenticate: (request) => ${authenticate}(request) },
  cursorSecret: requiredEnv('APPLIK8S_CURSOR_SECRET'),
  observeAdmission: observeRequestAdmission,
  objects: [${objectStores.map(objectStoreGatewaySource).join(",\n")}],
})`
			: "undefined";
const agentGateway =
		agents.length > 0 && authenticate
			? `createApplicationAIAgentGateway({
  application: ${JSON.stringify(graph.metadata.name)},
  secret: requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
  targets: ${JSON.stringify(agentTargets)}.map((target) => ({ ...target, baseUrl: materializeRemoteBaseUrl(target.baseUrl, target.endpointEnvironmentName) })),
  authenticate: async (request) => {
    const admission = await ${authenticate}(request);
    return { ...admission, trustedContext: admission.trustedContext ?? {} };
  },
  // Agent invocation is an authenticated application surface. Tool execution
  // remains independently constrained by service grants, workload envelopes,
  // and the per-run ExecutionPrincipal admitted by the agent runtime.
  authorize: ({ admission }) => admission.principal.audience.includes(${JSON.stringify(graph.metadata.name)}),
  ${observability ? 'captureTelemetry: () => captureApplicationTelemetryContext(),' : ''}
  observeAdmission: observeRequestAdmission,
  onError: (error) => console.error('Applik8s AI agent gateway admission failed', {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
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

${workflowScheduleTargets.length > 0 ? `const scheduledWorkflowAdmission = createSignedEnvelopeCodec({
  purpose: 'applik8s.workflow-gateway-admission/v1',
  keys: staticSignedEnvelopeKeyProvider({
    current: {
      id: 'application-internal-operation',
      key: signedEnvelopeUtf8Key(requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET')),
    },
  }),
  validatePayload: value => validateApplicationAdmissionContextV1(value),
  maximumEncodedBytes: 32_768,
  maximumLifetimeMs: 60_000,
});

async function scheduledWorkflowGatewayToken() {
  const value = (await readFile(
    requiredEnv('APPLIK8S_WORKFLOW_GATEWAY_TOKEN_FILE'),
    'utf8',
  )).trim();
  if (!value) throw new Error('Workflow gateway service-account token is empty.');
  return value;
}

async function startScheduledWorkflow(target, context) {
  const idempotencyKey = context.occurrenceId;
  let lastFailure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        target.endpoint + '/v1/workflows/' + encodeURIComponent(target.contract) + '/runs',
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: 'Bearer ' + await scheduledWorkflowGatewayToken(),
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            input: target.input,
            metadata: {
              idempotencyKey,
              correlationId: context.admission.correlationId,
              causationId: context.occurrenceId,
              ...(context.admission.trace?.traceparent
                ? { traceparent: context.admission.trace.traceparent }
                : {}),
              trustedContext: context.admission.trustedContext,
            },
            admission: await scheduledWorkflowAdmission.sign(
              context.admission,
              { expiresInMs: 60_000 },
            ),
          }),
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
        },
      );
      const value = await response.json().catch(() => ({}));
      if (response.ok) {
        if (!value || typeof value !== 'object' || typeof value.id !== 'string'
          || typeof value.admittedAt !== 'string') {
          throw new Error('Workflow gateway returned an invalid scheduled run reference.');
        }
        return Object.freeze({
          workflow: target.contract,
          run: value.id,
          admittedAt: value.admittedAt,
          occurrenceId: context.occurrenceId,
        });
      }
      if (![502, 503, 504].includes(response.status) || attempt === 3) {
        throw new Error(
          'Scheduled workflow gateway request failed with HTTP ' + response.status
            + ': ' + String(value?.error ?? 'request-failed'),
        );
      }
      lastFailure = new Error('Scheduled workflow gateway temporarily unavailable.');
    } catch (error) {
      if (context.signal.aborted) throw context.signal.reason ?? error;
      lastFailure = error;
      if (attempt === 3) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1_000, attempt * 100)));
  }
  throw lastFailure ?? new Error('Scheduled workflow gateway request failed.');
}` : ''}

${actors.length > 0 || lakehousePublications.length > 0 ? `function runtimeJsonSchema(schema, exportName) {
  return { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName }, schema };
}

${actors.length > 0 ? `
const actorWorkloadAuthority = new Map(${JSON.stringify(actorWorkloadAuthority.map((envelope) => [envelope.id, envelope]))});
function runtimeActorKeySchema(schema, exportName) {
  const normalized = normalizeSchema(runtimeJsonSchema(schema, exportName), exportName);
  return {
    json: schema,
    assert(value) {
      const result = normalized.validate(value);
      if (!result.ok) throw new Error(result.error.message);
      if (typeof result.value !== 'string' || result.value.length === 0) throw new Error(exportName + ' must be a non-empty string.');
      return result.value;
    },
  };
}

function internalActorPrincipal(value) {
  const principal = value?.principal;
  if (!principal || typeof principal !== 'object'
    || !['execution', 'service'].includes(principal.kind)
    || typeof principal.id !== 'string' || !principal.id.trim()
    || !principal.identity || typeof principal.identity !== 'object'
    || typeof principal.identity.id !== 'string' || !principal.identity.id.trim()
    || typeof principal.catalogRevision !== 'string' || !principal.catalogRevision.trim()
    || typeof principal.authorityRevision !== 'string' || !principal.authorityRevision.trim()
    || typeof principal.trustedContextDigest !== 'string' || !principal.trustedContextDigest.trim()
    || !Array.isArray(principal.audience) || principal.audience.some((candidate) => typeof candidate !== 'string' || !candidate.trim())
    || (principal.expiresAt !== undefined && (typeof principal.expiresAt !== 'string' || !Number.isFinite(Date.parse(principal.expiresAt)) || Date.now() >= Date.parse(principal.expiresAt)))) {
    throw new Error('Invalid or expired internal actor execution principal.');
  }
  if (principal.kind === 'execution' && (
    typeof principal.executionId !== 'string' || !principal.executionId.trim()
    || typeof principal.executionKind !== 'string' || !principal.executionKind.trim()
    || !principal.workloadIdentity || typeof principal.workloadIdentity !== 'object'
    || typeof principal.workloadIdentity.id !== 'string' || !principal.workloadIdentity.id.trim()
    || typeof principal.deadline !== 'string' || !Number.isFinite(Date.parse(principal.deadline))
    || Date.now() >= Date.parse(principal.deadline)
    || typeof principal.cancellationRevision !== 'string' || !principal.cancellationRevision.trim()
  )) throw new Error('Invalid or expired internal actor execution principal.');
  if (value.trustedContextDigest !== principal.trustedContextDigest) throw new Error('Internal actor trusted context does not match its principal.');
  if (typeof value.audience !== 'string' || !value.audience.trim()
    || (principal.kind === 'execution' && !principal.audience.includes(value.audience))) throw new Error('Invalid internal actor audience.');
  if (!['direct', 'workflow', 'event'].includes(value.transport)) throw new Error('Invalid internal actor transport.');
  return principal;
}

async function authorizeInternalApplicationActor(invocation, binding) {
  let principal = internalActorPrincipal(invocation.authority);
  const admittedKey = binding.reference(invocation.key).key;
  const declared = binding.protocol[invocation.member]?.input;
  if (!declared) throw new Error('Actor protocol member has no runtime input schema.');
  const validation = normalizeSchema(declared, invocation.actor + '.' + invocation.member + '.input').validate(invocation.input);
  if (!validation.ok) throw new Error(validation.error.message);
  const admittedInput = validation.value;
  const operationId = 'applik8s://actors/' + invocation.actor + '/operations/' + invocation.member;
  const inputDigest = applicationOperationInputDigest(admittedInput);
  const target = { kind: 'target', model: invocation.actor, identity: { key: admittedKey } };
  const targetDigest = applicationOperationInputDigest(target);
  const envelope = actorWorkloadAuthority.get(invocation.authority.workloadAuthorityId);
  if (!envelope || envelope.operationId !== operationId) throw new Error('Internal actor invocation has no exact compiled workload authority.');
  if (principal.kind !== 'execution') {
    const execution = invocation.authority.execution;
    if (!execution || typeof execution.id !== 'string' || !execution.id.trim()
      || !Number.isSafeInteger(execution.attempt) || execution.attempt < 1
      || typeof execution.deadline !== 'string' || !Number.isFinite(Date.parse(execution.deadline))
      || typeof execution.cancellationRevision !== 'string' || !execution.cancellationRevision.trim()) {
      throw new Error('Internal actor invocation has no complete managed execution identity.');
    }
    if (!envelope.serviceIdentity || principal.identity.id !== envelope.serviceIdentity.id) {
      throw new Error('Internal actor service principal does not own the workload authority envelope.');
    }
    principal = await operationAuthority.admitExecutionPrincipal({
      executionKind: execution.kind,
      executionId: execution.id,
      attempt: execution.attempt,
      workloadIdentity: envelope.workloadIdentity,
      serviceIdentity: envelope.serviceIdentity,
      causalPrincipalId: principal.causalPrincipalId ?? principal.id,
      causalPrincipal: principal.causalPrincipal ?? principal.identity,
      causalGrantIds: principal.causalGrantIds ?? [],
      envelopes: [envelope],
      trustedContextDigest: principal.trustedContextDigest,
      audience: [invocation.authority.audience],
      deadline: execution.deadline,
      cancellationRevision: execution.cancellationRevision,
    });
  }
  const authorization = await operationAuthority.authorizeExecution({
    principal,
    envelope,
    target,
    audience: invocation.authority.audience,
    transport: invocation.authority.transport,
    inputDigest,
    trustedContextDigest: principal.trustedContextDigest,
    idempotencyKey: invocation.idempotencyKey,
    targetDigest,
    currentCancellationRevision: principal.cancellationRevision,
  });
  if (!authorization.allowed) return { response: new Response(JSON.stringify({ error: authorization.code, message: authorization.message }), { status: 403, headers: { 'content-type': 'application/json' } }) };
  return {
    key: admittedKey,
    input: admittedInput,
    authority: {
      principal: { id: principal.id },
      causalPrincipal: { id: principal.causalPrincipalId ?? principal.id },
      authorizationReceipt: authorization.receipt,
      trustedContextDigest: principal.trustedContextDigest,
    },
    authorizationReceiptId: authorization.receipt.id,
  };
}

async function authorizeDeliveredApplicationActorAlarm(alarm, binding) {
  const admittedKey = binding.reference(alarm.key).key;
  const declared = binding.protocol[alarm.member]?.input;
  if (!declared) throw new Error('Actor alarm has no runtime input schema.');
  const validation = normalizeSchema(declared, alarm.actor + '.' + alarm.member + '.input').validate(alarm.input);
  if (!validation.ok) throw new Error(validation.error.message);
  const admittedInput = validation.value;
  const authority = alarm.authority;
  const receipt = authority?.authorizationReceipt;
  const operationId = 'applik8s://actors/' + alarm.actor + '/operations/' + alarm.member;
  const target = { kind: 'target', model: alarm.actor, identity: { key: admittedKey } };
  if (!receipt || receipt.apiVersion !== 'applik8s.authorizationReceipt/v1alpha1'
    || receipt.operationId !== operationId
    || receipt.inputDigest !== applicationOperationInputDigest(admittedInput)
    || applicationOperationInputDigest(receipt.target) !== applicationOperationInputDigest(target)
    || receipt.trustedContextDigest !== authority.trustedContextDigest) {
    throw new Error('Actor alarm authority does not match the persisted target and input.');
  }
  const revalidated = await operationAuthority.revalidate(
    receipt,
    'execution',
    authority.trustedContextDigest,
  );
  if (!revalidated.allowed) throw new Error(revalidated.code + ': ' + revalidated.message);
  return {
    key: admittedKey,
    input: admittedInput,
    authority,
  };
}

async function authorizeDeliveredApplicationActorRealtime(admission, binding) {
  const admittedKey = binding.reference(admission.key).key;
  const declared = binding.protocol[admission.member]?.input;
  if (!declared) throw new Error('Actor realtime member has no runtime input schema.');
  const validation = normalizeSchema(declared, admission.actor + '.' + admission.member + '.input').validate(admission.input);
  if (!validation.ok) throw new Error(validation.error.message);
  const admittedInput = validation.value;
  const connectionReceipt = admission.connection?.authorizationReceipt;
  const trustedContextDigest = admission.connection?.trustedContextDigest;
  if (!connectionReceipt || validateApplicationAuthorizationReceipt(connectionReceipt).length > 0
    || connectionReceipt.trustedContextDigest !== trustedContextDigest
    || connectionReceipt.principal.id !== admission.connection?.principal?.id) {
    throw new Error('Actor realtime callback has no complete signed connection authority.');
  }
  const connectionRevalidation = await operationAuthority.revalidate(
    connectionReceipt,
    'execution',
    trustedContextDigest,
  );
  if (!connectionRevalidation.allowed) throw new Error(connectionRevalidation.code + ': ' + connectionRevalidation.message);
  const operationId = 'applik8s://actors/' + admission.actor + '/operations/' + admission.member;
  const target = { kind: 'target', model: admission.actor, identity: { key: admittedKey } };
  const authorization = await operationAuthority.authorize({
    principal: connectionReceipt.principal,
    operationId,
    target,
    audience: ${JSON.stringify(graph.metadata.name)},
    transport: 'control-plane',
    inputDigest: applicationOperationInputDigest(admittedInput),
    trustedContextDigest,
    targetDigest: applicationOperationInputDigest(target),
  });
  if (!authorization.allowed) throw new Error(authorization.code + ': ' + authorization.message);
  return {
    key: admittedKey,
    input: admittedInput,
    connection: {
      ...admission.connection,
      principal: { id: authorization.receipt.principal.id },
      authorizationReceipt: authorization.receipt,
      trustedContextDigest,
    },
  };
}` : ""}` : ""}

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

${operationCatalog && identityAuthorityDatabaseEnvironment ? `const operationAuthoritySql = postgres(requiredEnv(${JSON.stringify(identityAuthorityDatabaseEnvironment)}), {
  max: 4,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});
const operationAuthority = createApplicationOperationAuthorityRuntime({
  sql: operationAuthoritySql,
  application: ${JSON.stringify(graph.metadata.name)},
  catalog: ${JSON.stringify(operationCatalog)},
  ${authorityManifest ? `authorityManifest: ${JSON.stringify(authorityManifest)},` : ""}
});
async function observeApplicationCapability(id, domain, subject, state, reason, evidence = {}) {
  await operationAuthority.observe({
    id,
    domain,
    subject,
    authority: 'provider',
    state,
    ...(reason ? { reason } : {}),
    source: 'application-fetch-gateway',
    evidence,
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  });
}
async function admitApplicationIdentity(request) {
  const admission = await ${authenticate}(request);
  const principal = admission.principal;
  const admittedPrincipal = await operationAuthority.admitPrincipal({
    id: principal.id,
    identity: principal.identity,
    kind: principal.kind,
    authenticationMethod: principal.authenticationMethod,
    audience: principal.audience,
    ...(principal.expiresAt ? { expiresAt: principal.expiresAt } : {}),
    ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    ...(principal.clientId ? { clientId: principal.clientId } : {}),
    ...(principal.flowId ? { flowId: principal.flowId } : {}),
    ...(principal.roles ? { roles: principal.roles } : {}),
    ...(principal.attributes ? { attributes: principal.attributes } : {}),
  }, principal.trustedContextDigest);
  await observeApplicationCapability(
    'identity:provider',
    'identity',
    ${JSON.stringify(identity[0]?.name ?? 'IdentityProvider')},
    'ready',
    undefined,
    { admitted: true },
  );
  return {
    ...admission,
    principal: admittedPrincipal,
  };
}` : `async function observeApplicationCapability() {}`}
const requestAdmissionObservationState = new Map();
async function observeRequestAdmission(observation) {
  const observationTime = Date.now();
  const previous = requestAdmissionObservationState.get(observation.transport);
  if (previous?.state === observation.state && observationTime - previous.at < 30_000) return;
  requestAdmissionObservationState.set(observation.transport, { state: observation.state, at: observationTime });
  console.info(JSON.stringify({ event: 'applik8s-request-admission', ...observation }));
  ${operationCatalog && identityAuthorityDatabaseEnvironment ? `const observedAt = new Date(observationTime);
  try {
    await operationAuthority.observe({
      id: 'request-admission:' + observation.transport,
      domain: 'gateway',
      subject: 'applik8s://request-admission/' + observation.transport,
      authority: 'canonical',
      state: observation.state === 'admitted' ? 'ready' : 'failed',
      ...(observation.rejectionCode ? { reason: observation.rejectionCode } : {}),
      source: 'applik8s-request-admission',
      evidence: observation,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observationTime + 90_000).toISOString(),
    });
  } catch (observationError) {
    console.error(JSON.stringify({
      event: 'applik8s-request-admission-observation-failed',
      error: applicationAdmissionRejectionCodeV1(observationError),
    }));
  }` : ''}
}
${authenticate ? `const applicationIdentitySession = createApplicationIdentitySessionHandler({
  authenticate: (request) => ${operationCatalog && identityAuthorityDatabaseEnvironment ? "admitApplicationIdentity" : authenticate}(request),
});` : ""}

${queries.length > 0 || commands.length > 0 ? `const localResourceClients = process.env.APPLIK8S_LOCAL_RESOURCE_URL && process.env.APPLIK8S_LOCAL_RESOURCE_TOKEN
  ? createApplik8sLocalResourceClients({
      baseUrl: process.env.APPLIK8S_LOCAL_RESOURCE_URL,
      token: process.env.APPLIK8S_LOCAL_RESOURCE_TOKEN,
    })
  : undefined;` : `const localResourceClients = undefined;`}
const localGateway = ${localGateway};
const objectGateway = ${objectGateway};
const materializeRemoteBaseUrl = (baseUrl, endpointEnvironmentName) => {
  const selected = process.env[endpointEnvironmentName] || baseUrl;
  if (!selected.includes(${JSON.stringify(applicationRuntimeNamespaceMarker)})) return selected;
  if (!runtimeNamespace) throw new Error('Missing required environment variable APPLIK8S_NAMESPACE');
  return selected.replaceAll(${JSON.stringify(applicationRuntimeNamespaceMarker)}, runtimeNamespace);
};
const remoteRoutes = new Map(${JSON.stringify(remoteRoutes.routes)}.map(([route, baseUrl, endpointEnvironmentName]) => [route, materializeRemoteBaseUrl(baseUrl, endpointEnvironmentName)]));
const remoteHealth = ${JSON.stringify(remoteRoutes.health)}.map(({ name, baseUrl, endpointEnvironmentName, path }) => ({ name, baseUrl: materializeRemoteBaseUrl(baseUrl, endpointEnvironmentName), path }));
const agentGateway = ${agentGateway};
${observability ? generatedApplicationTelemetryRuntimeSource({ application: graph.metadata.name, service: "application-fetch-gateway" }) : ""}
${actors.length > 0 ? `const applicationActors = [${actorSources.join(",\n")}];
const applicationActorEventPublisher = createApplicationEventLogPublisherFromEnvironment({
  connectionName: 'application-actor-outbox',
});
const deliverApplicationActorEvent = async (effect) => {
  await applicationActorEventPublisher.publish({
    id: effect.effectId,
    contract: { name: effect.contract.name, version: effect.contract.version },
    payload: effect.payload,
    recordedAt: effect.recordedAt,
    partitionKey: effect.partitionKey,
    causationId: effect.operationId,
  }, 'events');
};
const localActorRuntime = ['local', 'aws-local'].includes(process.env.APPLIK8S_DEPLOYMENT_TARGET ?? '') && ${actors.length > 0 ? 'true' : 'false'}
  ? await createPersistentLocalApplicationActorRuntime({
      path: optionalEnv('APPLIK8S_ACTOR_STATE_PATH') ?? '.applik8s/state/actors.json',
      deliverEvent: deliverApplicationActorEvent,
    })
  : undefined;
const celldActorEndpoint = optionalEnv('APPLIK8S_ACTOR_ENDPOINT');
const celldActorRuntime = celldActorEndpoint
  ? createCelldApplicationActorRuntime({
      endpoint: celldActorEndpoint,
      authorization: requiredEnv('APPLIK8S_ACTOR_AUTHORIZATION'),
      deliverEvent: deliverApplicationActorEvent,
    })
  : undefined;
if (!localActorRuntime && !celldActorRuntime) {
  throw new Error('Actor application requires local actor state or APPLIK8S_ACTOR_ENDPOINT.');
}
const disposeLocalActorRuntime = installApplicationActorRuntimeResolver(() => localActorRuntime ?? celldActorRuntime);
const applicationActorById = new Map(applicationActors.map((binding) => [binding.id, binding]));
${operationCatalog ? `function actorWorkloadEnvelopes(actor, member) {
  const subject = 'actor.' + actor + ':' + member;
  return [...actorWorkloadAuthority.values()].filter((envelope) => envelope.workloadIdentity.subject === subject);
}

function actorWorkloadEnvelope(principal, operationId, transport) {
  return [...actorWorkloadAuthority.values()].find((envelope) =>
    envelope.workloadIdentity.id === principal.workloadIdentity.id
    && envelope.operationId === operationId
    && envelope.transports.includes(transport));
}

function actorReceiptMatches(receipt, operationId, target, inputDigest) {
  return receipt.operationId === operationId
    && receipt.inputDigest === inputDigest
    && applicationOperationInputDigest(receipt.target) === applicationOperationInputDigest(target);
}

function boundedActorDeadline(request, sourcePrincipal) {
  if (request.phase === 'enqueue') {
    const scheduledAt = Date.parse(request.scheduledAt ?? '');
    if (!Number.isFinite(scheduledAt)) throw new Error('Actor alarm enqueue requires a valid scheduledAt.');
    const deadline = Math.max(
      scheduledAt + 24 * 60 * 60_000,
      Date.now() + 5 * 60_000,
    );
    return new Date(deadline).toISOString();
  }
  const sourceDeadline = sourcePrincipal.kind === 'execution'
    ? sourcePrincipal.deadline
    : sourcePrincipal.expiresAt;
  const maximum = Date.now() + 5 * 60_000;
  const deadline = sourceDeadline ? Math.min(maximum, Date.parse(sourceDeadline)) : maximum;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Actor source authority expired before turn admission.');
  return new Date(deadline).toISOString();
}

async function authorizeActorSource(request, sourcePrincipal, sourceReceipt, operationId, target, inputDigest) {
  if (actorReceiptMatches(sourceReceipt, operationId, target, inputDigest)) {
    const revalidated = await operationAuthority.revalidate(sourceReceipt, 'execution', request.current.trustedContextDigest);
    if (!revalidated.allowed) throw new Error(revalidated.code + ': ' + revalidated.message);
    return sourceReceipt;
  }
  if (sourcePrincipal.kind === 'execution') {
    const envelope = actorWorkloadEnvelope(sourcePrincipal, operationId, request.transport);
    if (!envelope) {
      throw new Error('Actor execution has no exact compiled authority for ' + operationId + ' over ' + request.transport + '.');
    }
    const authorized = await operationAuthority.authorizeExecution({
      principal: sourcePrincipal,
      envelope,
      target,
      audience: ${JSON.stringify(graph.metadata.name)},
      transport: request.transport,
      inputDigest,
      trustedContextDigest: request.current.trustedContextDigest,
      currentCancellationRevision: sourcePrincipal.cancellationRevision,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      targetDigest: applicationOperationInputDigest(target),
    });
    if (!authorized.allowed) throw new Error(authorized.code + ': ' + authorized.message);
    return authorized.receipt;
  }
  const authorized = await operationAuthority.authorize({
    principal: sourcePrincipal,
    operationId,
    target,
    audience: ${JSON.stringify(graph.metadata.name)},
    transport: request.transport,
    inputDigest,
    trustedContextDigest: request.current.trustedContextDigest,
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    targetDigest: applicationOperationInputDigest(target),
  });
  if (!authorized.allowed) throw new Error(authorized.code + ': ' + authorized.message);
  return authorized.receipt;
}

const disposeActorInvocationAuthority = installApplicationActorInvocationAuthorityResolver(async (request) => {
  const sourceAdmission = request.current.admission;
  const sourceReceipt = sourceAdmission?.authorizationReceipt;
  if (!sourceAdmission || !sourceReceipt
    || sourceReceipt.apiVersion !== 'applik8s.authorizationReceipt/v1alpha1'
    || validateApplicationAuthorizationReceipt(sourceReceipt).length > 0
    || sourceReceipt.principal.id !== sourceAdmission.principal.id
    || sourceReceipt.trustedContextDigest !== request.current.trustedContextDigest) {
    throw new Error('Actor effects require a complete canonical source admission and receipt.');
  }
  const operationId = 'applik8s://actors/' + request.actor + '/operations/' + request.member;
  const target = { kind: 'target', model: request.actor, identity: { key: request.key } };
  const inputDigest = applicationOperationInputDigest(request.input);
  const sourcePrincipal = sourceAdmission.principal;
  const sourceAuthorizationReceipt = await authorizeActorSource(
    request,
    sourcePrincipal,
    sourceReceipt,
    operationId,
    target,
    inputDigest,
  );
  const envelopes = actorWorkloadEnvelopes(request.actor, request.member);
  const selfEnvelope = envelopes.find((envelope) =>
    envelope.operationId === operationId && envelope.transports.includes('direct'));
  if (!selfEnvelope || envelopes.length === 0) {
    throw new Error('Actor ' + request.actor + '.' + request.member + ' has no compiled execution authority.');
  }
  const causal = applicationCausalPrincipalContext(sourcePrincipal);
  const keyDigest = applicationOperationInputDigest({ key: request.key });
  const turnId = 'actor_' + applicationOperationInputDigest({
    actor: request.actor,
    member: request.member,
    keyDigest,
    inputDigest,
    idempotencyKey: request.idempotencyKey ?? sourceAuthorizationReceipt.id,
    phase: request.phase,
    scheduledAt: request.scheduledAt,
  });
  const deadline = boundedActorDeadline(request, sourcePrincipal);
  const cancellationRevision = request.phase === 'enqueue'
    ? 'active:actor-alarm:' + turnId
    : sourceAdmission.cancellation?.revision
      ?? (sourcePrincipal.kind === 'execution'
        ? sourcePrincipal.cancellationRevision
        : 'active:actor:' + turnId);
  const executionPrincipal = await operationAuthority.admitExecutionPrincipal({
    executionKind: 'actor',
    executionId: turnId,
    attempt: 1,
    workloadIdentity: selfEnvelope.workloadIdentity,
    executionContext: {
      kind: 'actor',
      actor: request.actor,
      member: request.member,
      keyDigest,
      turnId,
    },
    causalPrincipalId: causal.id,
    causalPrincipal: causal.identity,
    causalGrantIds: causal.grantIds,
    envelopes,
    trustedContextDigest: request.current.trustedContextDigest,
    audience: [${JSON.stringify(graph.metadata.name)}],
    deadline,
    cancellationRevision,
  });
  const actorAuthorization = await operationAuthority.authorizeExecution({
    principal: executionPrincipal,
    envelope: selfEnvelope,
    target,
    audience: ${JSON.stringify(graph.metadata.name)},
    transport: 'direct',
    inputDigest,
    trustedContextDigest: request.current.trustedContextDigest,
    currentCancellationRevision: cancellationRevision,
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    targetDigest: applicationOperationInputDigest(target),
    applicationPolicyAllowed: true,
  });
  if (!actorAuthorization.allowed) throw new Error(actorAuthorization.code + ': ' + actorAuthorization.message);
  return createApplicationActorTurnAuthority({
    admission: {
      principal: actorAuthorization.principal,
      trustedContext: sourceAdmission.trustedContext.values,
    },
    operationId,
    correlationId: turnId,
    causationId: sourceAdmission.correlationId,
    deadline,
    cancellation: { revision: cancellationRevision },
    causalPrincipal: { id: causal.id },
    authorizationReceipt: actorAuthorization.receipt,
  });
});
void disposeActorInvocationAuthority;` : ''}
${publicActors.length > 0 ? `const publicApplicationActorById = new Map(${JSON.stringify(publicActorContracts)}.map((contract) => [contract.id, contract]));

async function authorizePublicApplicationActor(request, actor, key, member, input, idempotencyKey) {
  const contract = publicApplicationActorById.get(actor);
  const binding = applicationActorById.get(actor);
  const protocolMember = contract?.members.find((candidate) => candidate.name === member);
  if (!contract || !binding || !protocolMember) return { response: new Response(JSON.stringify({ error: 'unknown_actor_operation' }), { status: 404, headers: { 'content-type': 'application/json' } }) };
  let admittedKey;
  let admittedInput;
  try {
    admittedKey = binding.reference(key).key;
    const declared = binding.protocol[member]?.input;
    if (!declared) throw new Error('Actor protocol member has no runtime input schema.');
    const validation = normalizeSchema(declared, actor + '.' + member + '.input').validate(input);
    if (!validation.ok) throw new Error(validation.error.message);
    admittedInput = validation.value;
  } catch (error) {
    return { response: new Response(JSON.stringify({ error: 'invalid_actor_input', message: error instanceof Error ? error.message : String(error) }), { status: 400, headers: { 'content-type': 'application/json' } }) };
  }
  const admission = await admitApplicationIdentity(request);
  const operationId = 'applik8s://actors/' + actor + '/operations/' + member;
  const inputDigest = applicationOperationInputDigest(admittedInput);
  const targetDigest = applicationOperationInputDigest({ actor, key: admittedKey });
  const authorization = await operationAuthority.authorize({
    principal: admission.principal,
    operationId,
    target: { kind: 'target', model: actor, identity: { key: admittedKey } },
    audience: ${JSON.stringify(graph.metadata.name)},
    transport: 'http',
    inputDigest,
    trustedContextDigest: admission.principal.trustedContextDigest,
    idempotencyKey,
    targetDigest,
  });
  if (!authorization.allowed) {
    return { response: new Response(JSON.stringify({ error: authorization.code, message: authorization.message }), { status: 403, headers: { 'content-type': 'application/json' } }) };
  }
  return { contract, binding, protocolMember, key: admittedKey, input: admittedInput, principal: admission.principal, receipt: authorization.receipt };
}

function actorConnectionLeaseMilliseconds(value) {
  const match = /^(\\d+)(ms|s|m)$/.exec(value ?? '60s');
  if (!match) throw new Error('Actor connection lease must use ms, s, or m.');
  const milliseconds = Number(match[1]) * (match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 5_000 || milliseconds > 300_000) throw new Error('Actor connection lease must be from 5s through 5m.');
  return milliseconds;
}

function publicActorWebSocketUrl(endpoint, actor, key, ticket) {
  const url = new URL('/__applik8s/v1/actors/' + encodeURIComponent(actor) + '/' + encodeURIComponent(key) + '/connections', endpoint);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Actor connection origin must use HTTP(S) or WS(S).');
  url.searchParams.set('ticket', ticket);
  return url.toString();
}` : `const publicApplicationActorById = new Map();`}
void celldActorRuntime;
const disposeActorRuntime = disposeLocalActorRuntime
  ? disposeLocalActorRuntime
  : undefined;
void disposeActorRuntime;
void applicationActors;` : ""}
${lakehousePublications.length > 0 ? `const applicationLakehousePublications = [${lakehousePublicationSources.join(",\n")}];
const localLakehouseRuntimeEntries = process.env.APPLIK8S_DEPLOYMENT_TARGET === 'local'
  ? await Promise.all(${JSON.stringify(lakehouseDatasets)}.filter((dataset) => dataset.kind === 'duckdb-dataset' && (!dataset.targets || dataset.targets.includes('local'))).map(async (dataset) => [
      dataset.qualification,
      await createDuckDbApplicationLakehouseRuntime({
        datasetId: dataset.qualification,
        schemaRevision: dataset.schemaRevision,
        schema: runtimeJsonSchema(dataset.rowSchema, dataset.qualification + '.row'),
        cursorKey: requiredEnv(dataset.cursorSecretEnvironment),
        root: dataset.root,
        maximumConcurrentQueries: dataset.maximumConcurrentQueries,
        maximumRows: ${JSON.stringify(lakehouseQueries)}.find((query) => query.qualification === dataset.qualification && query.kind === 'duckdb-queries' && (!query.targets || query.targets.includes('local')))?.maximumRows,
        maximumScannedBytes: ${JSON.stringify(lakehouseQueries)}.find((query) => query.qualification === dataset.qualification && query.kind === 'duckdb-queries' && (!query.targets || query.targets.includes('local')))?.maximumScannedBytes,
      }),
    ]))
  : [];
const localLakehouseRuntimes = new Map(localLakehouseRuntimeEntries);
const localLakehouseQueryRuntime = {
  query(request) {
    const qualification = request.dataset?.qualification?.name;
    const runtime = qualification ? localLakehouseRuntimes.get(qualification) : undefined;
    if (!runtime) throw new Error('No local DuckDB lakehouse runtime is installed for dataset ' + String(qualification ?? '<unqualified>') + '.');
    return runtime.query(request);
  },
};
const disposeLocalLakehousePublicationRuntime = localLakehouseRuntimes.size > 0
  ? installApplicationLakehousePublicationRuntimeResolver((qualification) => localLakehouseRuntimes.get(qualification))
  : undefined;
const disposeLocalLakehouseQueryRuntime = localLakehouseRuntimes.size > 0
  ? installApplicationLakehouseQueryRuntimeResolver(() => localLakehouseQueryRuntime)
  : undefined;
const awsLakehouseBindingOverrides = process.env.APPLIK8S_AWS_LAKEHOUSE_BINDINGS
  ? JSON.parse(process.env.APPLIK8S_AWS_LAKEHOUSE_BINDINGS)
  : { datasets: {}, queries: {} };
const awsLakehouseRuntimeEntries = ['aws', 'aws-local', 'kubernetes'].includes(process.env.APPLIK8S_DEPLOYMENT_TARGET ?? '')
  ? ${JSON.stringify(lakehouseDatasets)}.filter((dataset) => dataset.kind === 's3-dataset' && (!dataset.targets || dataset.targets.includes(process.env.APPLIK8S_DEPLOYMENT_TARGET) || (process.env.APPLIK8S_DEPLOYMENT_TARGET === 'aws-local' && dataset.targets.includes('aws')))).map((dataset) => {
      const override = awsLakehouseBindingOverrides.datasets?.[dataset.qualification] ?? {};
      const configuration = {
        datasetId: dataset.qualification,
        bucket: override.bucket ?? dataset.bucket,
        prefix: override.prefix ?? dataset.prefix ?? ('lakehouse/' + dataset.qualification),
        region: override.region ?? dataset.region ?? process.env.AWS_REGION,
        catalogDatabase: override.catalogDatabase ?? dataset.catalog,
        schemaRevision: dataset.schemaRevision,
        schema: runtimeJsonSchema(dataset.rowSchema, dataset.qualification + '.row'),
        cursorKey: requiredEnv(dataset.cursorSecretEnvironment),
      };
      return [dataset.qualification, { configuration, runtime: createAwsApplicationLakehouseDatasetRuntime(configuration) }];
    })
  : [];
const awsLakehouseRuntimes = new Map(awsLakehouseRuntimeEntries);
const awsLakehouseQueryRuntimes = ['aws', 'aws-local', 'kubernetes'].includes(process.env.APPLIK8S_DEPLOYMENT_TARGET ?? '')
  ? new Map(${JSON.stringify(lakehouseQueries)}.filter((query) => query.kind === 'athena-queries' && (!query.targets || query.targets.includes(process.env.APPLIK8S_DEPLOYMENT_TARGET) || (process.env.APPLIK8S_DEPLOYMENT_TARGET === 'aws-local' && query.targets.includes('aws')))).map((query) => {
      const override = awsLakehouseBindingOverrides.queries?.[query.qualification] ?? {};
      return [query.qualification, createAwsApplicationLakehouseQueryRuntime({
        workgroup: override.workgroup ?? query.workgroup,
        region: override.region ?? query.region ?? process.env.AWS_REGION,
        maximumConcurrentQueries: query.maximumConcurrentQueries,
        maximumRows: query.maximumRows,
        maximumScannedBytes: query.maximumScannedBytes,
        datasets: Object.fromEntries([...awsLakehouseRuntimes].map(([name, entry]) => [name, entry.configuration])),
      })];
    }))
  : new Map();
const disposeAwsLakehousePublicationRuntime = awsLakehouseRuntimes.size > 0
  ? installApplicationLakehousePublicationRuntimeResolver((qualification) => awsLakehouseRuntimes.get(qualification)?.runtime)
  : undefined;
const disposeAwsLakehouseQueryRuntime = awsLakehouseQueryRuntimes.size > 0
  ? installApplicationLakehouseQueryRuntimeResolver((qualification) => awsLakehouseQueryRuntimes.get(qualification) ?? (awsLakehouseQueryRuntimes.size === 1 ? [...awsLakehouseQueryRuntimes.values()][0] : undefined))
  : undefined;
void disposeLocalLakehousePublicationRuntime;
void disposeLocalLakehouseQueryRuntime;
void disposeAwsLakehousePublicationRuntime;
void disposeAwsLakehouseQueryRuntime;

export async function executeApplicationLakehouseEvent(envelope) {
  const eventId = envelope?.contract?.name && envelope?.contract?.version
    ? envelope.contract.name + '.' + envelope.contract.version
    : undefined;
  if (!eventId || !envelope?.id) throw new Error('Lakehouse event admission requires an envelope id and versioned contract.');
  const matching = applicationLakehousePublications.filter((publication) => publication.event.id === eventId);
  if (matching.length === 0) throw new Error('No lakehouse publication consumes event ' + eventId + '.');
  return Promise.all(matching.map((publication) => executeApplicationLakehousePublication(publication, envelope)));
}` : ""}
${actors.length > 0 || lakehousePublications.length > 0 || schedules.length > 0 ? `function authorizedInternalAdmission(request) {
  const authorization = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;
  return nodeConstantTimeTextEqual(
    authorization.slice(prefix.length),
    requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
  );
}` : ""}
const applicationScheduleBindings = [${scheduleSources.join(",\n")}];
const applicationSchedules = applicationScheduleBindings.map((entry) => entry.handle);
const defaultApplicationScheduleBindings = applicationScheduleBindings.filter((entry) => entry.schedulerNodeId === 'provider.scheduler');
const defaultApplicationSchedules = defaultApplicationScheduleBindings.map((entry) => entry.handle);
const scheduleInvocationScope = new AsyncLocalStorage();
installApplicationInvocationAdmissionResolver(() => scheduleInvocationScope.getStore());
let scheduleAdmissionObservationState;
let scheduleAdmissionObservationAt = 0;
async function observeScheduleAdmission(state, admission, error) {
  const observationTime = Date.now();
  if (state === scheduleAdmissionObservationState && observationTime - scheduleAdmissionObservationAt < 30_000) return;
  scheduleAdmissionObservationState = state;
  scheduleAdmissionObservationAt = observationTime;
  const evidence = createApplicationAdmissionObservationV1({
    state,
    boundary: 'execution',
    ...(admission ? { admission } : { transport: 'schedule' }),
    ...(error ? { rejectionCode: applicationAdmissionRejectionCodeV1(error) } : {}),
  });
  console.info(JSON.stringify({ event: 'applik8s-schedule-admission', ...evidence }));
  ${operationCatalog && identityAuthorityDatabaseEnvironment ? `const observedAt = new Date();
  try {
    await operationAuthority.observe({
      id: 'schedule-admission',
      domain: 'workflow',
      subject: admission?.operation?.id ?? 'applik8s://schedules/admission',
      authority: 'canonical',
      state: state === 'admitted' ? 'ready' : 'failed',
      ...(evidence.rejectionCode ? { reason: evidence.rejectionCode } : {}),
      source: 'applik8s-schedule-admission',
      evidence,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + 90_000).toISOString(),
    });
  } catch (observationError) {
    console.error(JSON.stringify({
      event: 'applik8s-schedule-admission-observation-failed',
      error: applicationAdmissionRejectionCodeV1(observationError),
    }));
  }` : ''}
}
const scheduleAdmissionRunner = Object.freeze({
  async run(admission, invoke) {
    await observeScheduleAdmission('admitted', admission);
    return scheduleInvocationScope.run(admission, invoke);
  },
});
const fixedSchedules = defaultApplicationSchedules.filter((entry) => entry.definition.configuration === 'fixed');
const localScheduleRuntime = process.env.APPLIK8S_DEPLOYMENT_TARGET === 'local' && defaultApplicationSchedules.length > 0
  ? await installLocalApplicationScheduleRuntime({
      applicationId: ${JSON.stringify(graph.metadata.name)},
      schedulerNodeId: 'provider.scheduler',
      environmentId: process.env.APPLIK8S_ENVIRONMENT_ID ?? 'local',
      schedules: fixedSchedules,
      admissionRunner: scheduleAdmissionRunner,
      onError: (error) => console.error('Applik8s local schedule runtime failed', error),
    })
  : undefined;
void localScheduleRuntime;
const awsScheduleConfiguration = process.env.APPLIK8S_DEPLOYMENT_TARGET === 'aws' && defaultApplicationSchedules.length > 0
  ? {
      applicationId: process.env.APPLIK8S_APPLICATION_NAME ?? ${JSON.stringify(graph.metadata.name)},
      environmentId: process.env.APPLIK8S_ENVIRONMENT_ID ?? 'default',
      region: process.env.AWS_REGION,
      queueUrl: process.env.APPLIK8S_AWS_SCHEDULE_QUEUE_URL ?? '',
      queueArn: process.env.APPLIK8S_AWS_SCHEDULE_QUEUE_ARN ?? '',
      deadLetterQueueArn: process.env.APPLIK8S_AWS_SCHEDULE_DLQ_ARN ?? '',
      groupName: process.env.APPLIK8S_AWS_SCHEDULE_GROUP ?? '',
      executionRoleArn: process.env.APPLIK8S_AWS_SCHEDULE_ROLE_ARN ?? '',
      databaseUrl: process.env.APPLIK8S_SCHEDULE_DATABASE_URL ?? '',
    }
  : undefined;
const awsScheduleRuntime = awsScheduleConfiguration
  ? await createAwsApplicationScheduleRuntime(awsScheduleConfiguration, { admissionRunner: scheduleAdmissionRunner })
  : undefined;
const disposeAwsScheduleRuntime = awsScheduleRuntime
  ? installApplicationScheduleRuntimeResolver((schedulerNodeId) => schedulerNodeId === 'provider.scheduler' ? awsScheduleRuntime : undefined)
  : undefined;
void disposeAwsScheduleRuntime;
const awsScheduleRunner = awsScheduleConfiguration
  ? await startAwsApplicationScheduleQueueRunner({
      configuration: awsScheduleConfiguration,
      execute: async (admission, signal) => {
        const handle = defaultApplicationSchedules.find((candidate) => candidate.definition.id === admission.definitionId);
        if (!handle) throw new Error('AWS Scheduler admitted unknown definition ' + admission.definitionId + '.');
        return executeApplicationScheduleAdmission(handle, admission, signal, scheduleAdmissionRunner);
      },
      onError: (error) => {
        void observeScheduleAdmission('rejected', undefined, error);
        console.error(JSON.stringify({
          event: 'applik8s-aws-schedule-admission-failed',
          error: applicationAdmissionRejectionCodeV1(error),
        }));
      },
    })
  : undefined;
void awsScheduleRunner;
const kubernetesScheduleRuntime = process.env.APPLIK8S_DEPLOYMENT_TARGET === 'kubernetes' && defaultApplicationSchedules.length > 0
  ? await createKubernetesApplicationScheduleRuntime({
      applicationId: process.env.APPLIK8S_APPLICATION_NAME ?? ${JSON.stringify(graph.metadata.name)},
      environmentId: process.env.APPLIK8S_ENVIRONMENT_ID ?? process.env.APPLIK8S_NAMESPACE ?? 'default',
      namespace: process.env.APPLIK8S_NAMESPACE ?? ${JSON.stringify(scheduleHost?.namespace ?? graph.metadata.namespace ?? 'default')},
      admissionEndpoint: ${JSON.stringify(scheduleHost?.admissionEndpoint ?? '')},
      authorizationSecretName: ${JSON.stringify(`${kubernetesName(graph.metadata.name)}-internal-operation`)},
      databaseUrl: process.env.APPLIK8S_SCHEDULE_DATABASE_URL ?? '',
      admissionRunner: scheduleAdmissionRunner,
    })
  : undefined;
const disposeKubernetesScheduleRuntime = kubernetesScheduleRuntime
  ? installApplicationScheduleRuntimeResolver((schedulerNodeId) => schedulerNodeId === 'provider.scheduler' ? kubernetesScheduleRuntime : undefined)
  : undefined;
void disposeKubernetesScheduleRuntime;
const hatchetScheduleRuntimeEntries = await Promise.all(${JSON.stringify(hatchetScheduleBindings)}.map(async (binding) => {
  const handles = applicationScheduleBindings
    .filter((entry) => entry.schedulerNodeId === binding.providerId)
    .map((entry) => entry.handle);
  if (handles.length !== binding.scheduleIds.length) {
    throw new Error('Hatchet Scheduler ' + binding.providerId + ' could not resolve its complete generated schedule set.');
  }
  const tlsStrategy = process.env[binding.tlsEnvironment] ?? binding.tlsStrategy;
  if (tlsStrategy !== 'tls' && tlsStrategy !== 'none') {
    throw new Error('Hatchet Scheduler ' + binding.providerId + ' has invalid TLS strategy ' + JSON.stringify(tlsStrategy) + '.');
  }
  const runtime = await createHatchetApplicationScheduleRuntime({
    applicationId: process.env.APPLIK8S_APPLICATION_NAME ?? ${JSON.stringify(graph.metadata.name)},
    environmentId: process.env.APPLIK8S_ENVIRONMENT_ID ?? process.env.APPLIK8S_NAMESPACE ?? 'default',
    schedulerNodeId: binding.providerId,
    databaseUrl: process.env.APPLIK8S_SCHEDULE_DATABASE_URL ?? '',
    ...(process.env.APPLIK8S_DEPLOYMENT_TARGET === 'kubernetes'
      ? { tokenFile: binding.tokenFile }
      : { token: process.env[binding.tokenEnvironment] ?? process.env.HATCHET_CLIENT_TOKEN }),
    provider: {
      kind: 'hatchet-scheduler',
      workflowEngine: {
        kind: 'hatchet',
        hostPort: process.env[binding.hostPortEnvironment] ?? binding.hostPort,
        apiUrl: process.env[binding.apiUrlEnvironment] ?? binding.apiUrl,
        tls: tlsStrategy === 'tls',
      },
    },
    admissionRunner: scheduleAdmissionRunner,
  }, handles);
  return [binding.providerId, runtime];
}));
const hatchetScheduleRuntimes = new Map(hatchetScheduleRuntimeEntries);
const disposeHatchetScheduleRuntime = hatchetScheduleRuntimes.size > 0
  ? installApplicationScheduleRuntimeResolver((schedulerNodeId) => hatchetScheduleRuntimes.get(schedulerNodeId))
  : undefined;
void disposeHatchetScheduleRuntime;
const agentHealth = ${JSON.stringify(agentTargets)}.map(({ name, baseUrl, endpointEnvironmentName }) => ({ name: \`agent:\${name}\`, baseUrl: materializeRemoteBaseUrl(baseUrl, endpointEnvironmentName) }));

const applicationGatewayCore = {
  async handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__applik8s/v1/healthz') {
      // Liveness answers only whether this process can serve requests. Coupling
      // it to downstream gateways turns a dependency outage into a restart
      // storm and prevents those dependencies from recovering under pressure.
      return new Response(JSON.stringify({ live: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/__applik8s/v1/readyz') {
      const remoteResults = await Promise.all([
        ...remoteHealth,
        ...agentHealth.map(({ name, baseUrl }) => ({ name, baseUrl, path: '/readyz' })),
      ].map(async ({ name, baseUrl, path }) => {
        try {
          const response = await fetch(new URL(path, baseUrl));
          return { name, ready: response.ok };
        } catch (error) {
          return { name, ready: false, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      let localReady = true;
      let objectStorageReady = true;
      try {
        localReady = !localGateway || (await localGateway.handle(request.clone())).ok;
        await objectGateway?.ready();
      } catch {
        localReady = false;
        objectStorageReady = false;
      }
      const ready = localReady && remoteResults.every((dependency) => dependency.ready);
      await Promise.all([
        ...${JSON.stringify(objectStorageProviderNames)}.map((subject) => observeApplicationCapability(
          'object-storage-provider:' + subject,
          'objectStore',
          subject,
          objectStorageReady ? 'ready' : 'degraded',
          objectStorageReady ? undefined : 'readiness-check-failed',
        )),
        ...${JSON.stringify(objectStores.map((store) => store.name))}.map((subject) => observeApplicationCapability(
          'object-store:' + subject,
          'objectStore',
          subject,
          objectStorageReady ? 'ready' : 'degraded',
          objectStorageReady ? undefined : 'readiness-check-failed',
        )),
        ...${JSON.stringify(gatewayObservationSubjects)}.map((subject) => observeApplicationCapability(
          'gateway:' + subject,
          'gateway',
          subject,
          ready ? 'ready' : 'degraded',
          ready ? undefined : 'dependency-not-ready',
        )),
      ]);
      return new Response(JSON.stringify({ ready, dependencies: remoteResults }), { status: ready ? 200 : 503, headers: { 'content-type': 'application/json' } });
    }
    ${publicActors.length > 0 ? `const publicActorOperationMatch = /^\\/__applik8s\\/v1\\/actors\\/([^/]+)\\/([^/]+)\\/operations\\/([^/]+)$/.exec(url.pathname);
    if (publicActorOperationMatch && request.method === 'POST') {
      try {
        const authorizationRequest = request.clone();
        const actorId = decodeURIComponent(publicActorOperationMatch[1]);
        const actorKey = decodeURIComponent(publicActorOperationMatch[2]);
        const member = decodeURIComponent(publicActorOperationMatch[3]);
        const body = await request.json();
        const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey ? body.idempotencyKey : randomUUID();
        const admission = await authorizePublicApplicationActor(authorizationRequest, actorId, actorKey, member, body?.input, idempotencyKey);
        if (admission.response) return admission.response;
        if (admission.protocolMember.kind !== 'command' && admission.protocolMember.kind !== 'message') {
          return new Response(JSON.stringify({ error: 'actor_operation_transport_mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        const callable = admission.binding[member];
        const turnAuthority = {
          principal: { id: admission.principal.id },
          causalPrincipal: { id: admission.principal.kind === 'execution' && admission.principal.causalPrincipalId ? admission.principal.causalPrincipalId : admission.principal.id },
          authorizationReceipt: admission.receipt,
          trustedContextDigest: admission.principal.trustedContextDigest,
        };
        if (admission.protocolMember.kind === 'command') {
          if (typeof callable !== 'function') throw new Error('Generated actor command is unavailable.');
          const result = await withApplicationActorTurnAuthority(turnAuthority, () => callable(admission.key, admission.input, { idempotencyKey }));
          return new Response(JSON.stringify({ result, authorizationReceiptId: admission.receipt.id }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (!callable || typeof callable.send !== 'function') throw new Error('Generated actor message is unavailable.');
        const receipt = await withApplicationActorTurnAuthority(turnAuthority, () => callable.send(admission.key, admission.input, { idempotencyKey }));
        return new Response(JSON.stringify({ receipt, authorizationReceiptId: admission.receipt.id }), { status: 202, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        console.error('Applik8s public actor operation failed', error);
        return new Response(JSON.stringify({ error: 'actor_operation_failed', message: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }
    const publicActorConnectionMatch = /^\\/__applik8s\\/v1\\/actors\\/([^/]+)\\/([^/]+)\\/connections$/.exec(url.pathname);
    if (publicActorConnectionMatch && request.method === 'POST') {
      try {
        if (!celldActorRuntime) return new Response(JSON.stringify({ error: 'actor_realtime_provider_unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
        const authorizationRequest = request.clone();
        const actorId = decodeURIComponent(publicActorConnectionMatch[1]);
        const actorKey = decodeURIComponent(publicActorConnectionMatch[2]);
        const body = await request.json();
        const member = typeof body?.member === 'string' ? body.member : '';
        const idempotencyKey = randomUUID();
        const admission = await authorizePublicApplicationActor(authorizationRequest, actorId, actorKey, member, body?.input, idempotencyKey);
        if (admission.response) return admission.response;
        if (admission.protocolMember.kind !== 'connection') {
          return new Response(JSON.stringify({ error: 'actor_connection_transport_mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        const disconnectMember = typeof body?.disconnect?.member === 'string' ? body.disconnect.member : '';
        const disconnectContract = admission.contract.members.find((candidate) => candidate.name === disconnectMember && candidate.kind === 'disconnection');
        const disconnectSchema = admission.binding.protocol[disconnectMember]?.input;
        if (!disconnectContract || !disconnectSchema) return new Response(JSON.stringify({ error: 'invalid_actor_disconnection_member' }), { status: 400, headers: { 'content-type': 'application/json' } });
        const disconnectValidation = normalizeSchema(disconnectSchema, actorId + '.' + disconnectMember + '.input').validate(body?.disconnect?.input);
        if (!disconnectValidation.ok) return new Response(JSON.stringify({ error: 'invalid_actor_disconnection_input', message: disconnectValidation.error.message }), { status: 400, headers: { 'content-type': 'application/json' } });
        const leaseMilliseconds = actorConnectionLeaseMilliseconds(body?.lease);
        const issuedAt = new Date();
        const expiresAt = new Date(Math.min(issuedAt.getTime() + 60_000, admission.principal.expiresAt ? Date.parse(admission.principal.expiresAt) : Number.POSITIVE_INFINITY));
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= issuedAt.getTime()) return new Response(JSON.stringify({ error: 'actor_connection_principal_expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
        const connectionId = randomUUID();
        const ticket = await signCelldActorConnectionTicket({
          schemaVersion: 'applik8s.actorConnectionTicket/v1alpha1',
          actor: actorId,
          key: admission.key,
          connectionId,
          connect: { member, input: admission.input },
          disconnect: { member: disconnectMember, input: disconnectValidation.value },
          protocolRevision: admission.contract.protocolRevision,
          causalPrincipalId: admission.principal.kind === 'execution' && admission.principal.causalPrincipalId ? admission.principal.causalPrincipalId : admission.principal.id,
          authorizationReceipt: admission.receipt,
          trustedContextDigest: admission.principal.trustedContextDigest,
          leaseMilliseconds,
          nonce: randomUUID(),
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }, requiredEnv('APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY'));
        return new Response(JSON.stringify({
          connectionId,
          url: publicActorWebSocketUrl(new URL(request.url).origin, actorId, admission.key, ticket),
          expiresAt: expiresAt.toISOString(),
        }), { status: 201, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      } catch (error) {
        console.error('Applik8s public actor connection admission failed', error);
        return new Response(JSON.stringify({ error: 'actor_connection_admission_failed', message: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${lakehousePublications.length > 0 ? `if (url.pathname === '/__applik8s/v1/internal/lakehouse/events' && request.method === 'POST') {
      if (!authorizedInternalAdmission(request)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      try {
        const manifests = await executeApplicationLakehouseEvent(await request.json());
        return new Response(JSON.stringify({ accepted: true, snapshots: manifests.map(({ snapshotId }) => snapshotId) }), { status: 202, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        console.error('Applik8s lakehouse publication admission failed', error);
        return new Response(JSON.stringify({ error: 'lakehouse_publication_failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${schedules.length > 0 ? `if (url.pathname === '/__applik8s/v1/internal/schedules/occurrences' && request.method === 'POST') {
      if (!authorizedInternalAdmission(request)) {
        await observeScheduleAdmission('rejected', undefined, Object.assign(new Error('Schedule internal authorization was rejected.'), { code: 'SCHEDULE_INTERNAL_AUTHORIZATION_REJECTED' }));
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      try {
        const admission = await request.json();
        const handle = applicationSchedules.find((candidate) => candidate.definition.id === admission?.definitionId);
        if (!handle) throw Object.assign(new Error('Schedule admission references an unknown definition.'), { code: 'SCHEDULE_DEFINITION_UNKNOWN', status: 404 });
        const receipt = await executeKubernetesApplicationScheduleAdmission({
          databaseUrl: requiredEnv('APPLIK8S_SCHEDULE_DATABASE_URL'),
          handle,
          admission,
          ...(admission.deleteAfterCompletion && admission.providerResourceName && kubernetesScheduleRuntime
            ? { removeCompletedOneTime: () => kubernetesScheduleRuntime.removeResource(admission.providerResourceName) }
            : {}),
          admissionRunner: scheduleAdmissionRunner,
        });
        return new Response(JSON.stringify({ accepted: receipt.state !== 'failed', receipt }), { status: receipt.state === 'failed' ? 500 : 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        const busy = error?.code === 'SCHEDULE_OCCURRENCE_BUSY';
        const unknown = error?.code === 'SCHEDULE_DEFINITION_UNKNOWN';
        await observeScheduleAdmission('rejected', undefined, error);
        console.error(JSON.stringify({
          event: 'applik8s-kubernetes-schedule-admission-failed',
          error: applicationAdmissionRejectionCodeV1(error),
        }));
        return new Response(JSON.stringify({ error: busy ? 'schedule_occurrence_busy' : unknown ? 'unknown_schedule' : 'schedule_admission_failed' }), { status: busy ? 409 : unknown ? 404 : 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${actors.length > 0 ? `if (url.pathname === '/__applik8s/v1/internal/actors/alarms' && request.method === 'POST') {
      if (!authorizedInternalAdmission(request)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      try {
        const alarm = await request.json();
        const binding = applicationActorById.get(alarm?.actor);
        if (!binding) return new Response(JSON.stringify({ error: 'unknown_actor' }), { status: 404, headers: { 'content-type': 'application/json' } });
        const admission = await authorizeDeliveredApplicationActorAlarm(alarm, binding);
        const receipt = await executeApplicationActorAlarm(binding, {
          member: alarm.member,
          key: admission.key,
          input: admission.input,
          idempotencyKey: alarm.idempotencyKey ?? alarm.alarmId,
          authority: admission.authority,
          ...(alarm.telemetry ? { telemetry: alarm.telemetry } : {}),
          ...(alarm.attempt === undefined ? {} : { attempt: alarm.attempt }),
        });
        return new Response(JSON.stringify({ accepted: true, receipt }), { status: 202, headers: { 'content-type': 'application/json' } });
      } catch {
        console.error(JSON.stringify({ event: 'applik8s-actor-alarm-admission-failed', error: 'actor_alarm_failed' }));
        return new Response(JSON.stringify({ error: 'actor_alarm_failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${actors.length > 0 ? `if (url.pathname === '/__applik8s/v1/internal/actors/invoke' && request.method === 'POST') {
      if (!authorizedInternalAdmission(request)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      try {
        const invocation = await request.json();
        const binding = applicationActorById.get(invocation?.actor);
        if (!binding) return new Response(JSON.stringify({ error: 'unknown_actor' }), { status: 404, headers: { 'content-type': 'application/json' } });
        const member = binding.protocol?.[invocation?.member];
        const expectedKind = invocation?.memberKind === 'command'
          ? 'actorCommand'
          : invocation?.memberKind === 'message'
            ? 'actorMessage'
            : invocation?.memberKind === 'alarm'
              ? 'actorAlarm'
              : undefined;
        if (!expectedKind || member?.kind !== expectedKind) return new Response(JSON.stringify({ error: 'actor_operation_transport_mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
        if (typeof invocation?.idempotencyKey !== 'string' || !invocation.idempotencyKey.trim()) return new Response(JSON.stringify({ error: 'actor_idempotency_key_required' }), { status: 400, headers: { 'content-type': 'application/json' } });
        const admission = await authorizeInternalApplicationActor(invocation, binding);
        if (admission.response) return admission.response;
        if (expectedKind === 'actorAlarm' && (typeof invocation.scheduledAt !== 'string' || !Number.isFinite(Date.parse(invocation.scheduledAt)))) return new Response(JSON.stringify({ error: 'invalid_actor_alarm_timestamp' }), { status: 400, headers: { 'content-type': 'application/json' } });
        const executed = await executeApplicationActorInvocation(binding, {
          member: invocation.member,
          memberKind: invocation.memberKind,
          key: admission.key,
          input: admission.input,
          idempotencyKey: invocation.idempotencyKey,
          ...(invocation.scheduledAt ? { scheduledAt: invocation.scheduledAt } : {}),
          authority: admission.authority,
          ...(invocation.telemetry ? { telemetry: invocation.telemetry } : {}),
        });
        return new Response(JSON.stringify({
          ...(expectedKind === 'actorCommand' ? { result: executed.result } : { receipt: executed.receipt }),
          authorizationReceiptId: admission.authorizationReceiptId,
        }), { status: expectedKind === 'actorCommand' ? 200 : 202, headers: { 'content-type': 'application/json' } });
      } catch {
        console.error(JSON.stringify({ event: 'applik8s-internal-actor-invocation-failed', error: 'actor_invocation_failed' }));
        return new Response(JSON.stringify({ error: 'actor_invocation_failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${actors.length > 0 ? `if (url.pathname === '/__applik8s/v1/internal/actors/realtime' && request.method === 'POST') {
      if (!authorizedInternalAdmission(request)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
      try {
        const admission = await request.json();
        const binding = applicationActorById.get(admission?.actor);
        if (!binding) return new Response(JSON.stringify({ error: 'unknown_actor' }), { status: 404, headers: { 'content-type': 'application/json' } });
        const authorized = await authorizeDeliveredApplicationActorRealtime(admission, binding);
        const receipt = await executeApplicationActorRealtime(binding, {
          kind: admission.kind,
          member: admission.member,
          key: authorized.key,
          input: authorized.input,
          connection: authorized.connection,
          idempotencyKey: admission.idempotencyKey,
        });
        return new Response(JSON.stringify({ accepted: true, receipt }), { status: 202, headers: { 'content-type': 'application/json' } });
      } catch {
        console.error(JSON.stringify({ event: 'applik8s-actor-realtime-admission-failed', error: 'actor_realtime_failed' }));
        return new Response(JSON.stringify({ error: 'actor_realtime_failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }` : ""}
    ${authenticate ? `if (url.pathname === '/__applik8s/v1/identity/session' && request.method === 'GET') {
      return applicationIdentitySession(request);
    }` : ""}
    ${identityHttp ? `if (url.pathname.startsWith('/__applik8s/v1/identity/')) {
      return ${identityHttp}(request);
    }` : ""}
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
    const agentResponse = agentGateway ? await agentGateway.handle(request.clone()) : undefined;
    if (agentResponse) return agentResponse;
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

export const gateway = ${observability ? `{
  handle(request) {
    const url = new URL(request.url);
    const route = applicationGatewayRoute(url.pathname) ?? (url.pathname.startsWith('/__applik8s/') ? 'framework' : 'unmatched');
    const boundaryKind = route.startsWith('command:') || route.startsWith('runtime:') || route.startsWith('object:') ? 'operation'
      : route.startsWith('webhook:') || route.startsWith('stream:') || route.startsWith('signal:') ? 'event'
      : 'http';
    return runApplicationTelemetryBoundary({
      kind: boundaryKind,
      identity: route === 'unmatched' || route === 'framework' ? request.method.toLowerCase() + ':' + route : route,
      attributes: { 'http.request.method': request.method, 'url.path': url.pathname.slice(0, 512) },
    }, () => applicationGatewayCore.handle(request));
  },
}` : "applicationGatewayCore"};

function applicationGatewayRoute(pathname) {
  if (remoteRoutes.has('webhook:' + pathname)) return 'webhook:' + pathname;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === '__applik8s' && parts[1] === 'v1') parts.splice(0, 2);
  if (parts[0] === 'queries' && parts[1]) return \`query:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'commands' && parts[1]) return \`command:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'streams' && parts[1]) return \`stream:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'signals' && parts[1]) return \`signal:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'runtime' && parts[1]?.startsWith('objectStore.')) return \`object:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'runtime' && parts[1]) return \`runtime:\${decodeURIComponent(parts[1])}\`;
  if (parts[0] === 'objects' && parts[1]) return \`object:\${decodeURIComponent(parts[1])}\`;
  return undefined;
}

function forwardRemoteRequest(request, remoteBaseUrl) {
  const url = new URL(request.url);
  const remotePath = (url.pathname.startsWith('/__applik8s/v1') ? url.pathname.slice('/__applik8s/v1'.length) : url.pathname) || '/';
  ${observability && hasRemoteQueries ? `const forwarded = new Request(new URL(remotePath + url.search, remoteBaseUrl), request);
  forwarded.headers.delete(applicationTelemetryCarrierHeaderName);
  const telemetry = captureApplicationTelemetryContext();
  const encodedTelemetry = telemetry ? encodeApplicationTelemetryCarrier(telemetry) : undefined;
  if (encodedTelemetry) forwarded.headers.set(applicationTelemetryCarrierHeaderName, encodedTelemetry);
  return fetch(forwarded);` : `return fetch(new Request(new URL(remotePath + url.search, remoteBaseUrl), request));`}
}

export const handleApplik8sRequest = (request) => gateway.handle(request);
${schedules.length > 0 || observability ? `export async function closeApplik8sGateway() {
  ${schedules.length > 0 ? `
  disposeAwsScheduleRuntime?.();
  disposeKubernetesScheduleRuntime?.();
  disposeHatchetScheduleRuntime?.();
  await Promise.all([
    ...(localScheduleRuntime ? [localScheduleRuntime.stop()] : []),
    ...(awsScheduleRunner ? [awsScheduleRunner.stop()] : []),
    ...(awsScheduleRuntime ? [awsScheduleRuntime.close()] : []),
    ...(kubernetesScheduleRuntime ? [kubernetesScheduleRuntime.close()] : []),
    ...[...hatchetScheduleRuntimes.values()].map((runtime) => runtime.close()),
  ]);
  ` : ""}
  ${observability ? "await closeApplicationTelemetryRuntime();" : ""}
}` : "export async function closeApplik8sGateway() {}"}
`;
	return { entrypoint: "gateway.generated.ts", files };
}

function applicationRemoteGatewayRoutes(
	graph: ApplicationGraph,
	gateways: readonly ApplicationGatewayNode[],
): {
	readonly routes: readonly (readonly [string, string, string])[];
	readonly health: readonly ApplicationRemoteHealthContract[];
} {
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const routes = new Map<string, { readonly baseUrl: string; readonly endpointEnvironmentName: string }>();
	const health: ApplicationRemoteHealthContract[] = [];
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
		const endpointEnvironmentName = applicationRuntimeEndpointEnvironmentName(gateway.id);
		health.push({ name: gateway.name, baseUrl, endpointEnvironmentName, path: "/ready" });
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
			const stream = nodes.get(node.source.nodeId);
			if (stream?.kind !== "stream")
				throw new Error(
					`Generated application gateway ${gateway.id} subscription ${node.id} references missing stream ${node.source.nodeId}.`,
				);
			if (stream.signal) {
				add(`signal:${stream.signal.id}`, baseUrl, gateway.id);
			}
		}
	}
	return {
		routes: [...routes.entries()].map(([route, target]) => [route, target.baseUrl, target.endpointEnvironmentName] as const).sort(([left], [right]) =>
			left.localeCompare(right),
		),
		health: health.sort((left, right) => left.name.localeCompare(right.name)),
	};

	function add(route: string, baseUrl: string, owner: string): void {
		const existing = routes.get(route);
		if (existing && existing.baseUrl !== baseUrl)
			throw new Error(
				`Generated application route ${route} is exposed by multiple gateways, including ${owner}.`,
			);
		routes.set(route, { baseUrl, endpointEnvironmentName: applicationRuntimeEndpointEnvironmentName(owner) });
	}
}

function applicationPublishedHttpRoutes(
	graph: ApplicationGraph,
): {
	readonly routes: readonly (readonly [string, string, string])[];
	readonly health: readonly ApplicationRemoteHealthContract[];
} {
	const routes: (readonly [string, string, string])[] = [];
	const health = new Map<
		string,
		ApplicationRemoteHealthContract
	>();
	for (const server of graph.nodes.filter(
		(node): node is ApplicationServerNode => node.kind === "server",
	)) {
		const exposed = server.routes.filter(
			(route) =>
				route.functionNative?.publication?.boundary === "entrypoint-export"
				|| Boolean(route.functionNative?.webhookAuthentication),
		);
		if (exposed.length === 0) continue;
		const namespace = applicationGatewayRuntimeNamespace(
			server.deployment?.namespace ??
				graph.metadata.namespace ??
				applicationFetchServerNamespace(server) ??
				"default",
			server.id,
		);
		const baseUrl = `http://${kubernetesName(server.name)}.${namespace}.svc:${server.deployment?.port ?? 80}`;
		const endpointEnvironmentName = applicationRuntimeEndpointEnvironmentName(server.id);
		health.set(server.id, {
			name: `http:${server.name}`,
			baseUrl,
			endpointEnvironmentName,
			path: "/readyz",
		});
		for (const route of exposed) {
			if (route.functionNative?.webhookAuthentication) {
				routes.push([`webhook:${route.path}`, baseUrl, endpointEnvironmentName]);
				continue;
			}
			const id = applicationOperationId({
				domain: "http",
				owner: server.name,
				operation: route.id,
			});
			routes.push([`runtime:${id}`, baseUrl, endpointEnvironmentName]);
		}
	}
	return {
		routes: routes.sort(([left], [right]) => left.localeCompare(right)),
		health: [...health.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		),
	};
}

function mergeRemoteRouteContracts(
	...contracts: readonly {
		readonly routes: readonly (readonly [string, string, string])[];
		readonly health: readonly ApplicationRemoteHealthContract[];
	}[]
): {
	readonly routes: readonly (readonly [string, string, string])[];
	readonly health: readonly ApplicationRemoteHealthContract[];
} {
	const routes = new Map<string, { readonly baseUrl: string; readonly endpointEnvironmentName: string }>();
	const health = new Map<string, ApplicationRemoteHealthContract>();
	for (const contract of contracts) {
		for (const [route, baseUrl, endpointEnvironmentName] of contract.routes) {
			const existing = routes.get(route);
			if (existing && (existing.baseUrl !== baseUrl || existing.endpointEnvironmentName !== endpointEnvironmentName)) {
				throw new Error(
					`Generated application route ${route} resolves to both ${existing} and ${baseUrl}.`,
				);
			}
			routes.set(route, { baseUrl, endpointEnvironmentName });
		}
		for (const dependency of contract.health) {
			health.set(`${dependency.name}\0${dependency.baseUrl}`, dependency);
		}
	}
	return {
		routes: [...routes.entries()].map(([route, target]) => [route, target.baseUrl, target.endpointEnvironmentName] as const).sort(([left], [right]) =>
			left.localeCompare(right),
		),
		health: [...health.values()].sort((left, right) =>
			`${left.name}\0${left.baseUrl}`.localeCompare(
				`${right.name}\0${right.baseUrl}`,
			),
		),
	};
}

interface ApplicationRemoteHealthContract {
	readonly name: string;
	readonly baseUrl: string;
	readonly endpointEnvironmentName: string;
	readonly path: "/ready" | "/readyz";
}

function applicationFetchServerNamespace(
	server: ApplicationServerNode,
): string | undefined {
	const workload = server.generatedResources?.find(
		(candidate) => candidate.role === "workload",
	)?.resource;
	return workload &&
		"namespace" in workload &&
		typeof workload.namespace === "string"
		? workload.namespace
		: undefined;
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

function applicationAgentGatewayTargets(
	graph: ApplicationGraph,
	agents: readonly ApplicationAIAgentNode[],
): readonly {
	readonly name: string;
	readonly nodeId: string;
	readonly baseUrl: string;
	readonly endpointEnvironmentName: string;
	readonly workloadIdentityId: string;
	readonly serviceIdentityId: string;
	readonly audience: readonly string[];
	readonly timeoutMs: number;
}[] {
	if (agents.length === 0) return [];
	const catalog = compileApplicationOperationCatalog(graph);
	const authority = compileApplicationWorkloadAuthority(graph, catalog);
	return agents
		.map((agent) => {
			const envelopes = authority.filter(
				(envelope): envelope is ApplicationWorkloadAuthorityEnvelope =>
					envelope.workloadIdentity.subject === agent.id &&
					envelope.serviceIdentity?.id === agent.serviceIdentity.id,
			);
			const workloadIdentities = new Set(
				envelopes.map((envelope) => envelope.workloadIdentity.id),
			);
			if (envelopes.length === 0 || workloadIdentities.size !== 1) {
				throw new Error(
					`Generated application agent gateway ${agent.id} requires one compiled workload identity.`,
				);
			}
			const provider = graph.nodes.find(
				(node): node is ApplicationProviderNode =>
					node.kind === "provider" && node.id === agent.inference.nodeId,
			);
			const providerConfig = objectConfig(provider?.config?.ai);
			const namespace = applicationGatewayRuntimeNamespace(
				graph.metadata.namespace ?? providerConfig.namespace ?? "default",
				agent.id,
			);
			return {
				name: agent.name,
				nodeId: agent.id,
				baseUrl: `http://${kubernetesName(agent.name)}.${namespace}.svc:${agent.deployment.port}`,
				endpointEnvironmentName: applicationRuntimeEndpointEnvironmentName(agent.id),
				workloadIdentityId: [...workloadIdentities][0]!,
				serviceIdentityId: agent.serviceIdentity.id,
				audience: [
					...new Set(
						envelopes.flatMap((envelope) => envelope.audiences),
					),
				].sort(),
				timeoutMs: agent.budgets.timeoutMs,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

function applicationFetchGatewayNamespaceSource(namespace: string): string {
	return namespace === "${schema.spec.name}"
		? "requiredRuntimeNamespace()"
		: JSON.stringify(namespace);
}

function applicationFetchGatewayIdentityAuthorityDatabaseEnvironment(
	graph: ApplicationGraph,
): string | undefined {
	const providerIds = new Set<string>();
	for (const node of graph.nodes) {
		if (node.kind !== "provider" || node.interface !== "IdentityProvider")
			continue;
		const runtime = objectConfig(node.config?.identityRuntime);
		const database = objectConfig(runtime.databaseProvider);
		const nodeId = stringConfig(database.nodeId);
		if (nodeId) providerIds.add(nodeId);
	}
	if (providerIds.size === 0) {
		const applicationEnvironments = new Set(
			graph.nodes.flatMap((node) =>
				node.kind === "model"
				&& node.runtime?.authorityName === "application"
					? [node.runtime.connectionEnvName]
					: [],
			),
		);
		if (applicationEnvironments.size === 0) return undefined;
		if (applicationEnvironments.size !== 1) {
			throw new Error(
				`Generated application Fetch gateway resolves ${applicationEnvironments.size} canonical authority database environments; exactly one is required.`,
			);
		}
		return [...applicationEnvironments][0];
	}
	if (providerIds.size !== 1) {
		throw new Error(
			`Generated application Fetch gateway identity resolves ${providerIds.size} authority databases; exactly one is required.`,
		);
	}
	const providerId = [...providerIds][0]!;
	const consumerIds = new Set(
		graph.providerRequirements
			.filter(
				(requirement) =>
					requirement.interface === "TransactionalDatabase" &&
					requirement.provider?.nodeId === providerId,
			)
			.map((requirement) => requirement.consumer.nodeId),
	);
	const environments = new Set(
		graph.nodes.flatMap((node) =>
			node.kind === "model" && consumerIds.has(node.id) && node.runtime
				? [node.runtime.connectionEnvName]
				: [],
		),
	);
	if (environments.size !== 1) {
		throw new Error(
			`Generated application Fetch gateway identity authority resolves ${environments.size} database environments; exactly one is required.`,
		);
	}
	return [...environments][0];
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

function applicationScheduleHost(
	graph: ApplicationGraph,
	override?: {
		readonly name: string;
		readonly namespace: string;
		readonly port: number;
	},
): { readonly namespace: string; readonly admissionEndpoint: string } {
	if (override) {
		return {
			namespace: override.namespace,
			admissionEndpoint: `http://${kubernetesName(override.name)}.${override.namespace}.svc:${override.port}/__applik8s/v1/internal/schedules/occurrences`,
		};
	}
	const provider = graph.nodes.find((node): node is ApplicationProviderNode =>
		node.kind === "provider" && node.interface === "ApplicationHost" && !node.config?.qualification,
	);
	const host = objectConfig(provider?.config?.host);
	const namespace = applicationGraphStringValue(host.namespace)
		?? applicationGraphStringValue(graph.metadata.namespace)
		?? "default";
	const name = kubernetesName(stringConfig(host.name) || `${graph.metadata.name}-app`);
	const port = typeof host.port === "number" && Number.isSafeInteger(host.port) && host.port > 0 ? host.port : 3000;
	return {
		namespace,
		admissionEndpoint: `http://${name}.${namespace}.svc:${port}/__applik8s/v1/internal/schedules/occurrences`,
	};
}

function applicationScheduleWorkflowGatewayEndpoint(
	graph: ApplicationGraph,
	schedule: ApplicationScheduleNode,
	hostOverride?: {
		readonly name: string;
		readonly namespace: string;
		readonly port: number;
	},
): string {
	if (schedule.target?.kind !== "durableStart") {
		throw new Error(`Schedule ${schedule.definition.id} has no workflow execution target.`);
	}
	const targetId = schedule.target.durable.nodeId;
	const handlers = graph.nodes.filter(
		(node) => schedule.target?.kind === "durableStart"
			&& (schedule.target.durable.kind === "workflow"
				? node.kind === "workflowHandler" && node.workflow.nodeId === targetId
				: node.kind === "taskHandler" && node.task.nodeId === targetId),
	);
	const handlerIds = new Set(handlers.map(({ id }) => id));
	const workers = graph.nodes.filter(
		(node) => node.kind === "workflowWorker"
			&& node.handlers.some((handler) => handlerIds.has(handler.nodeId)),
	);
	if (workers.length !== 1) {
		throw new Error(
			`Schedule ${schedule.definition.id} workflow target ${targetId} must resolve to exactly one workflow worker; found ${workers.length}.`,
		);
	}
	const worker = workers[0];
	if (!worker || worker.kind !== "workflowWorker") {
		throw new Error(`Schedule ${schedule.definition.id} workflow target ${targetId} has no workflow worker.`);
	}
	const provider = graph.nodes.find((node) => node.id === worker.workflowEngine.nodeId);
	const providerNamespace = provider?.kind === "provider"
		? applicationGraphStringValue(provider.config?.namespace)
		: undefined;
	const host = applicationScheduleHost(graph, hostOverride);
	const namespace = providerNamespace ?? host.namespace;
	if (namespace !== host.namespace) {
		throw new Error(
			`Schedule ${schedule.definition.id} runs in ${host.namespace}, but workflow ${targetId} runs in ${namespace}; the private workflow gateway requires a shared namespace.`,
		);
	}
	return `http://${kubernetesName(worker.name)}.${namespace}.svc:${worker.deployment.healthPort + 1}`;
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

function graphActorCallback(
	files: Record<string, string>,
	imports: string[],
	actor: ApplicationActorNode,
	member: string,
	role: string,
	callback: ApplicationSerializedCallbackContract,
): string {
	const prefix = `${member}:`;
	const providerBindings = (actor.providerBindings ?? [])
		.filter((binding) => binding.identifier.startsWith(prefix))
		.map((binding) => ({
			...binding,
			identifier: binding.identifier.slice(prefix.length),
		}));
	if (providerBindings.length === 0) {
		return graphCallback(files, imports, actor.id, role, callback);
	}
	return graphManagedProviderCallback(
		files,
		imports,
		actor.id,
		role,
		callback,
		providerBindings,
		`Application actor ${actor.definition.id}.${member}`,
	);
}

function graphScheduleCallback(
	files: Record<string, string>,
	imports: string[],
	schedule: ApplicationScheduleNode,
	callback: ApplicationSerializedCallbackContract,
): string {
	const providerBindings = (schedule.providerBindings ?? []).filter(
		(binding) =>
			binding.operation !== undefined
			|| !(
				binding.placement === 'objectStore'
				&& binding.provider.interface === 'ObjectStorage'
			),
	);
	if (providerBindings.length === 0) {
		return graphCallback(files, imports, schedule.id, 'schedule', callback);
	}
	return graphManagedProviderCallback(
		files,
		imports,
		schedule.id,
		'schedule',
		callback,
		providerBindings,
		`Application schedule ${schedule.definition.id}`,
	);
}

function graphManagedProviderCallback(
	files: Record<string, string>,
	imports: string[],
	owner: string,
	role: string,
	callback: ApplicationSerializedCallbackContract,
	providerBindings: readonly ApplicationCallableProviderBinding[],
	label: string,
): string {
	const injected = providerBindings.map((binding) =>
		providerOperationBinding(imports, label, binding));
	const injectedIdentifiers = injected
		.map(({ path }) => path.split('.')[0])
		.filter((identifier): identifier is string => Boolean(identifier))
		.filter((identifier, index, values) => values.indexOf(identifier) === index);
	const replacedCapturedIdentifiers = injectedIdentifiers.filter((identifier) =>
		injected.some(({ path }) => path === identifier)
		|| capturedApplicationInjectFacade(
			callback.dependencies?.source,
			identifier,
		));
	const digest = createHash("sha256")
		.update(`${owner}:${role}`)
		.digest("hex")
		.slice(0, 12);
	const file = `${role}-${digest}.generated.ts`;
	const factory = `createCallback_${role.replace(/[^A-Za-z0-9_$]+/g, "_")}_${digest}`;
	files[file] = generatedCallbackFactoryModule({
		source: callback.source,
		...(callback.dependencies ? { dependencies: callback.dependencies } : {}),
		injectedIdentifiers,
		injectedBindingPaths: injected.map(({ path }) => path),
		replacedCapturedIdentifiers,
		exportName: "createCallback",
	});
	imports.push(
		`import { createCallback as ${factory} } from './${file.replace(/\.ts$/, ".js")}';`,
	);
	return `${factory}(${nestedProviderBindingsSource(injected, label)})`;
}

function providerOperationBinding(
	imports: string[],
	label: string,
	binding: ApplicationCallableProviderBinding,
): { readonly path: string; readonly value: string } {
	const runtime = binding.operation?.runtime;
	if (!binding.operation || !runtime) {
		throw new Error(
			`${label} provider binding ${binding.identifier} has no public static runtime operation. Define the operation in the provider runtime contract; generated workers never replay authoring-time provider selection.`,
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
			`${label} provider binding ${binding.identifier} has an invalid public runtime export ${runtime.module}#${runtime.export}.`,
		);
	}
	const segments = binding.identifier.split('.');
	if (
		segments.length === 0
		|| segments.some((segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment))
	) {
		throw new Error(
			`${label} provider binding ${binding.identifier} is not a static JavaScript binding path.`,
		);
	}
	const variable = `providerOperation_${createHash("sha256")
		.update(`${runtime.module}:${runtime.export}`)
		.digest("hex")
		.slice(0, 12)}`;
	const statement = `import { ${runtime.export} as ${variable} } from ${JSON.stringify(runtime.module)};`;
	if (!imports.includes(statement)) imports.push(statement);
	return {
		path: binding.identifier,
		value: generatedApplicationProviderOperationValue(binding, variable),
	};
}

function nestedProviderBindingsSource(
	entries: readonly { readonly path: string; readonly value: string }[],
	label: string,
): string {
	interface BindingTree {
		direct?: string;
		readonly children: Map<string, BindingTree>;
	}
	const roots = new Map<string, BindingTree>();
	for (const entry of entries) {
		const segments = entry.path.split('.');
		let siblings = roots;
		let node: BindingTree | undefined;
		for (const segment of segments) {
			node = siblings.get(segment);
			if (!node) {
				node = { children: new Map() };
				siblings.set(segment, node);
			}
			siblings = node.children;
		}
		if (!node) throw new Error(`${label} provider binding ${entry.path} is empty.`);
		if (node.direct && node.direct !== entry.value) {
			throw new Error(`${label} provider binding ${entry.path} resolves to multiple runtime operations.`);
		}
		node.direct = entry.value;
	}
	return render(roots);

	function render(nodes: ReadonlyMap<string, BindingTree>): string {
		return `{ ${[...nodes.entries()].map(([key, node]) => {
			if (node.direct && node.children.size > 0) {
				throw new Error(`${label} provider binding ${key} is both a callable and an object namespace.`);
			}
			return `${JSON.stringify(key)}: ${node.direct ?? render(node.children)}`;
		}).join(', ')} }`;
	}
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

function graphProfiledCallback(
	files: Record<string, string>,
	imports: string[],
	owner: string,
	role: string,
	profile: ApplicationProfiledCallbackContract,
): string {
	const branches = Object.entries(profile.cases).map(
		([variant, callback]) =>
			[
				variant,
				graphCallback(
					files,
					imports,
					owner,
					`${role}-${variant}`,
					callback,
				),
			] as const,
	);
	const fallback = graphCallback(
		files,
		imports,
		owner,
		`${role}-default`,
		profile.default,
	);
	return branches.reduceRight(
		(otherwise, [variant, callback]) =>
			`(process.env.APPLIK8S_PROFILE_VARIANT === ${JSON.stringify(variant)} ? ${callback} : ${otherwise})`,
		fallback,
	);
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

function applicationLakehouseDatasets(
	graph: ApplicationGraph,
	publications: readonly ApplicationLakehousePublicationNode[],
): readonly ApplicationLakehouseDatasetBinding[] {
	const datasets = new Map<string, ApplicationLakehouseDatasetBinding>();
	for (const publication of publications) {
		const provider = graph.nodes.find(
			(candidate): candidate is ApplicationProviderNode =>
				candidate.kind === "provider" && candidate.id === publication.dataset.nodeId,
		);
		if (!provider || provider.interface !== "LakehouseDataset") {
			throw new Error(
				`Lakehouse publication ${publication.id} references missing LakehouseDataset provider ${publication.dataset.nodeId}.`,
			);
		}
		const qualification = stringConfig(
			objectConfig(provider.config?.qualification).name,
		);
		if (!qualification) {
			throw new Error(
				`Lakehouse publication ${publication.id} requires a named LakehouseDataset provider.`,
			);
		}
			const configurations = applicationProviderRuntimeConfigurations(provider, "lakehouseDataset");
			if (configurations.length === 0) throw new Error(`Generated Fetch gateway cannot materialize LakehouseDataset ${qualification} without a target provider branch.`);
			for (const selected of configurations) {
			const configuration = selected.configuration;
			const kind = stringConfig(configuration.kind);
			if (kind !== "duckdb-dataset" && kind !== "s3-dataset") throw new Error(`Generated Fetch gateway cannot materialize LakehouseDataset ${qualification} from provider ${kind || "<unknown>"}.`);
		const cursorSecretEnvironment =
			stringConfig(configuration.cursorSecretEnvironment) ||
			"APPLIK8S_CURSOR_SECRET";
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(cursorSecretEnvironment)) {
			throw new Error(
				`LakehouseDataset ${qualification} cursorSecretEnvironment is not an environment variable name.`,
			);
		}
		const maximumConcurrentQueriesValue =
			typeof configuration.maximumConcurrentQueries === "number"
				? configuration.maximumConcurrentQueries
				: 4;
		if (
			!Number.isSafeInteger(maximumConcurrentQueriesValue) ||
			maximumConcurrentQueriesValue < 1
		) {
			throw new Error(
				`LakehouseDataset ${qualification} maximumConcurrentQueries must be a positive integer.`,
			);
		}
		const rowSchema = publication.row.jsonSchema;
			const key = `${provider.id}:${kind}:${JSON.stringify(configuration)}`;
			const existing = datasets.get(key);
			if (existing) {
			if (JSON.stringify(existing.rowSchema) !== JSON.stringify(rowSchema)) {
				throw new Error(
					`LakehouseDataset ${qualification} receives incompatible row schemas from multiple publications.`,
				);
			}
			continue;
		}
				datasets.set(key, {
			providerId: provider.id,
			qualification,
			kind,
			rowSchema,
			schemaRevision: stringConfig(configuration.schemaRevision) || "v1",
			root:
				stringConfig(configuration.root) ||
				`.applik8s/state/lakehouse/${qualification.replace(/[^a-z0-9._-]+/giu, "-")}`,
			cursorSecretEnvironment,
				maximumConcurrentQueries: maximumConcurrentQueriesValue,
				...(selected.targets ? { targets: selected.targets } : {}),
			...(kind === "s3-dataset" ? {
				bucket: stringConfig(configuration.bucket),
				prefix: stringConfig(configuration.prefix) || `lakehouse/${qualification}`,
				region: stringConfig(configuration.region),
				catalog: stringConfig(configuration.catalog),
			} : {}),
			});
			}
		}
		return [...datasets.values()].sort((left, right) =>
			left.qualification.localeCompare(right.qualification) || left.kind.localeCompare(right.kind),
		);
}

function applicationLakehouseQueries(graph: ApplicationGraph): readonly {
	readonly qualification: string;
	readonly kind: string;
	readonly workgroup?: string;
	readonly region?: string;
	readonly resultLocation?: string;
	readonly maximumConcurrentQueries: number;
	readonly maximumRows?: number;
	readonly maximumScannedBytes?: number;
	readonly targets?: readonly ("local" | "aws-local" | "aws" | "kubernetes")[];
}[] {
	return graph.nodes.flatMap((provider) => {
		if (provider.kind !== "provider" || provider.interface !== "LakehouseQuery") return [];
		const qualification = stringConfig(objectConfig(provider.config?.qualification).name);
		if (!qualification) return [];
			return applicationProviderRuntimeConfigurations(provider, "lakehouseQuery").map(({ configuration: query, targets }) => {
			const maximum = typeof query.maximumConcurrentQueries === "number" && Number.isSafeInteger(query.maximumConcurrentQueries) && query.maximumConcurrentQueries > 0
			? query.maximumConcurrentQueries
			: 4;
			const maximumRows = typeof query.maximumRows === "number" && Number.isSafeInteger(query.maximumRows) && query.maximumRows > 0
				? query.maximumRows
				: undefined;
			const maximumScannedBytes = typeof query.maximumScannedBytes === "number" && Number.isSafeInteger(query.maximumScannedBytes) && query.maximumScannedBytes > 0
				? query.maximumScannedBytes
				: undefined;
			return {
			qualification,
			kind: stringConfig(query.kind),
			...(stringConfig(query.workgroup) ? { workgroup: stringConfig(query.workgroup) } : {}),
			...(stringConfig(query.region) ? { region: stringConfig(query.region) } : {}),
			...(stringConfig(query.resultLocation) ? { resultLocation: stringConfig(query.resultLocation) } : {}),
				maximumConcurrentQueries: maximum,
				...(maximumRows ? { maximumRows } : {}),
				...(maximumScannedBytes ? { maximumScannedBytes } : {}),
				...(targets ? { targets } : {}),
			};
			});
		}).sort((left, right) => left.qualification.localeCompare(right.qualification));
}

function applicationProviderRuntimeConfigurations(
	provider: ApplicationProviderNode,
	configurationKey: string,
): readonly {
	readonly configuration: Readonly<Record<string, unknown>>;
	readonly targets?: readonly ("local" | "aws-local" | "aws" | "kubernetes")[];
}[] {
	const targetSelection = objectConfig(provider.config?.targetSelection);
	const targets = objectConfig(targetSelection.targets);
	if (Object.keys(targets).length === 0) return [{ configuration: objectConfig(provider.config?.[configurationKey]) }];
	const byConfiguration = new Map<string, { configuration: Readonly<Record<string, unknown>>; targets: Array<"local" | "aws-local" | "aws" | "kubernetes"> }>();
	for (const [target, rawBranch] of Object.entries(targets)) {
		if (!isApplicationDeploymentTarget(target)) continue;
		const branch = objectConfig(rawBranch);
		const configuration = objectConfig(branch.configuration);
		const identity = JSON.stringify(configuration);
		const prior = byConfiguration.get(identity);
		if (prior) prior.targets.push(target);
		else byConfiguration.set(identity, { configuration, targets: [target] });
	}
	return [...byConfiguration.values()];
}

function isApplicationDeploymentTarget(value: string): value is "local" | "aws-local" | "aws" | "kubernetes" {
	return value === "local" || value === "aws-local" || value === "aws" || value === "kubernetes";
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

function profiledCallbackConfig(
	value: unknown,
	prefix: string,
): ApplicationProfiledCallbackContract | undefined {
	const profile = objectConfig(value);
	if (Object.keys(profile).length === 0) return undefined;
	const selector = stringConfig(profile.selector);
	const cases = objectConfig(profile.cases);
	const fallback = objectConfig(profile.default);
	if (!selector || Object.keys(cases).length === 0 || Object.keys(fallback).length === 0) {
		throw new Error(
			`Generated application Fetch gateway ${prefix} profile is incomplete.`,
		);
	}
	return {
		selector,
		cases: Object.fromEntries(
			Object.entries(cases).map(([variant, callback]) => [
				variant,
				serializedCallbackConfig(
					objectConfig(callback),
					prefix,
				),
			]),
		),
		default: serializedCallbackConfig(fallback, prefix),
	};
}
