import { AI } from "@applik8s/ai";
import {
	actor,
	app,
	applicationGraphFor,
	event,
	IdentityProvider,
	Lakehouse,
	LakehouseDataset,
	LakehouseQuery,
	ObjectStorage,
	Observability,
} from "@applik8s/applik8s";
import { entity, type } from "@applik8s/applik8s/dsl";
import {
	type ApplicationDeterministicIdentityOptions,
	createDeterministicApplicationAdmission,
} from "@applik8s/identity";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	applicationFacadeManifest,
	generatedApplicationFacadeSource,
} from "../src/application-facade/index.js";
import { applicationGraphWithEntrypointPublicSurface } from "../src/application-facade/public-surface.js";
import { generatedApplicationFetchGatewayModules } from "../src/application-fetch-gateway/index.js";

describe("application host Fetch gateway", () => {
	it("installs local and AWS lakehouse providers from one fluent target binding", () => {
		const application = app("portable-lakehouse-host");
		const History = LakehouseDataset.named("history");
		const Queries = LakehouseQuery.named("history-queries");
		application.provide(History)
			.local(() => Lakehouse.duckdbDataset({ root: ".applik8s/state/history" }))
			.aws(() => Lakehouse.s3Dataset({ bucket: "managed", prefix: "history", catalog: "history", region: "us-east-1" }));
		application.provide(Queries)
			.local(() => Lakehouse.duckdbQueries())
			.aws(() => Lakehouse.athenaQueries({ workgroup: "history", region: "us-east-1", resultLocation: "s3://managed/results/" }));
		const Changed = event("history.changed.v1", { payload: type({ id: "string", value: "number" }) });
		const publication = Changed.publish(History, type({ id: "string", value: "number" }), (change, output) => output.append(change));
		const base = applicationGraphFor(application.composition);
		if (!base) throw new Error("Expected portable lakehouse graph.");
		const graph = applicationGraphWithEntrypointPublicSurface(base, { operationIds: [], modelNames: [], lakehousePublications: [publication.graphNode] });
		const source = generatedApplicationFetchGatewayModules(graph)?.files["gateway.generated.ts"] ?? "";
		expect(source).toContain("createDuckDbApplicationLakehouseRuntime");
		expect(source).toContain("createAwsApplicationLakehouseDatasetRuntime");
		expect(source).toContain("createAwsApplicationLakehouseQueryRuntime");
		expect(source).toContain('"targets":["local"]');
		expect(source).toContain('"targets":["aws"]');
		expect(source).toContain("process.env.APPLIK8S_DEPLOYMENT_TARGET === 'aws-local'");
	});
	it("installs one local DuckDB authority and internal event admission for typed lakehouse publications", () => {
		const application = app("lakehouse-host");
		const History = LakehouseDataset.named("history");
		application.provide(
			History,
			Lakehouse.duckdbDataset({
				root: ".applik8s/state/history",
				cursorSecretEnvironment: "HISTORY_CURSOR_SECRET",
				schemaRevision: "v2",
			}),
		);
		const Changed = event("history.changed.v1", {
			payload: type({ id: "string", value: "number" }),
		});
		const publication = Changed.publish(
			History,
			type({ id: "string", value: "number" }),
			(change, output) => output.append(change),
		);
		const base = applicationGraphFor(application.composition);
		if (!base) throw new Error("Expected lakehouse application graph.");
		const graph = applicationGraphWithEntrypointPublicSurface(base, {
			operationIds: [],
			modelNames: [],
			lakehousePublications: [publication.graphNode],
		});
		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			] ?? "";
		expect(source).toContain("createDuckDbApplicationLakehouseRuntime");
		expect(source).toContain("installApplicationLakehousePublicationRuntimeResolver");
		expect(source).toContain("/__applik8s/v1/internal/lakehouse/events");
		expect(source).toContain('cursorKey: requiredEnv(dataset.cursorSecretEnvironment)');
		expect(source).toContain('"cursorSecretEnvironment":"HISTORY_CURSOR_SECRET"');
		expect(source).toContain('"schemaRevision":"v2"');
	});

	it("reconstructs actor definitions and installs the persistent local runtime automatically", () => {
		const application = app("actor-host");
		const Counter = application.actor("counter.v1", {
			key: type("string"),
			state: type({ count: "number.integer >= 0" }),
			protocol: {
				increment: actor.command({
					input: type({ by: "number.integer > 0" }),
					output: type({ count: "number.integer >= 0" }),
				}),
			},
		});
		Counter.on.initialize(() => ({ count: 0 }));
		Counter.on.increment(async (current, input) => {
			const state = await current.state();
			const next = { count: state.count + input.by };
			await current.setState(next);
			return next;
		});
		const graph = applicationGraphFor(application.composition);
		if (!graph) throw new Error("Expected actor application graph.");
		const source = generatedApplicationFetchGatewayModules(graph)?.files["gateway.generated.ts"] ?? "";
		expect(source).toContain("createPersistentLocalApplicationActorRuntime");
		expect(source).toContain("installApplicationActorRuntimeResolver");
		expect(source).toContain("runtimeActorKeySchema");
		expect(source).toContain("/__applik8s/v1/internal/actors/invoke");
		expect(source).toContain("executeApplicationActorInvocation");
		expect(source).toContain("invocation.telemetry");
		expect(source).toContain("alarm.attempt");
		expect(source).toContain("authorizeInternalApplicationActor");
		expect(source).toContain("operationAuthority.authorize");
		expect(source).toContain("Invalid or expired internal actor execution principal");
		expect(source).toContain('binding.on["increment"]');
		expect(source).toContain(".applik8s/state/actors.json");
	});

	it("publishes only exported actors through signed canonical-authority admission", () => {
		const application = app("actor-browser");
		const authorityTable = pgTable("actor_authority", { id: text("id").primaryKey() });
		const database = application.database.postgres("application", { schema: { authorityTable } });
		application.model(authorityTable, { name: "ActorAuthority", database });
		application.provide(IdentityProvider, IdentityProvider.deterministic(identityOptions("member")));
		const Workspace = application.actor("workspace.v1", {
			key: type("string"),
			state: type({ title: "string" }),
			protocol: {
				rename: actor.command({ input: type({ title: "string" }), output: type({ title: "string" }) }),
				observe: actor.message(type({ at: "string" })),
				connect: actor.connection(type({ agent: "string" })),
				cursor: actor.connectionMessage(type({ position: "number.integer >= 0" })),
				disconnect: actor.disconnection(type({ agent: "string" })),
				updated: actor.broadcast(type({ title: "string" })),
			},
		});
		Workspace.rename.public();
		Workspace.observe.send.public();
		Workspace.connect.public();
		Workspace.on.initialize(() => ({ title: "Untitled" }));
		Workspace.on.rename(async (turn, input) => { await turn.setState(input); return input; });
		Workspace.on.observe(() => undefined);
		Workspace.on.cursor(() => undefined);
		const base = applicationGraphFor(application.composition);
		if (!base) throw new Error("Expected actor application graph.");
		const graph = applicationGraphWithEntrypointPublicSurface(base, { operationIds: [], modelNames: [], actorIds: [Workspace.id] });
		const actorExports = [{ name: "Workspace", actorId: Workspace.id }];
		const source = generatedApplicationFetchGatewayModules(graph, { actorExports })?.files["gateway.generated.ts"] ?? "";
		expect(source).toContain("signCelldActorConnectionTicket");
		expect(source).toContain("authorizePublicApplicationActor");
		expect(source).toContain("APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY");
		expect(source).toContain("publicActorWebSocketUrl(new URL(request.url).origin");
		expect(source).not.toContain("APPLIK8S_ACTOR_PUBLIC_ENDPOINT");
		expect(source).toContain("applik8s://actors/");
		expect(source).toContain("operationAuthority.authorizeExecution");
		expect(source).toContain("operationAuthority.revalidate");
		expect(source).toContain("authorizeDeliveredApplicationActorRealtime");
		expect(source).toContain("authorizationReceipt: admission.receipt");
		expect(source).toContain("authorizationReceipt: authorization.receipt");
		expect(source).toContain("validateApplicationAuthorizationReceipt(connectionReceipt)");
		expect(source).toContain("transport: 'control-plane'");
		expect(source).not.toContain("authorizationReceiptId: admission.receipt.id,");
		expect(source).toContain("Actor alarm authority does not match the persisted target and input");
		expect(source).toContain("installApplicationActorInvocationAuthorityResolver");
		expect(source).toContain("applicationCausalPrincipalContext");
		expect(source).toContain("actorWorkloadEnvelopes");
		expect(source).toContain("executionKind: 'actor'");
		expect(source).toContain("principal: actorAuthorization.principal");
		expect(source).toContain("request.phase === 'enqueue'");
		expect(source).toContain("return createApplicationActorTurnAuthority({");
		expect(source).not.toContain("connectionSigningKey:");
		const manifest = applicationFacadeManifest(graph, { actorExports });
		expect(manifest.actors).toEqual([expect.objectContaining({ id: "workspace.v1", exportNames: ["Workspace"] })]);
		expect(generatedApplicationFacadeSource(manifest, "browser")).toContain("createApplicationActorClient");
	});

	it("automatically installs the selected OpenTelemetry runtime around HTTP boundaries", () => {
		const application = app("observed", { namespace: "observed-system" });
		application.provide(IdentityProvider, IdentityProvider.deterministic(identityOptions("member")));
		application.provide(Observability, Observability.local());
		const graph = applicationGraphFor(application.composition);
		if (!graph) throw new Error("Expected observed application graph.");
		const source = generatedApplicationFetchGatewayModules(graph)?.files["gateway.generated.ts"];
		expect(source).toContain("startApplicationOpenTelemetryRuntime");
		expect(source).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
		expect(source).toContain("installApplicationTelemetryRuntimeResolver");
		expect(source).toContain("runApplicationTelemetryBoundary");
		expect(source).toContain("applicationGatewayCore.handle(request)");
		expect(source).toContain('service: process.env.APPLIK8S_SERVICE_NAME ?? "application-fetch-gateway"');
		expect(source).toContain("await closeApplicationTelemetryRuntime()");
	});

	it("publishes exported typed HTTP closures as direct browser callables while keeping sibling routes private", () => {
		const assistant = app("assistant", { namespace: "assistant-system" });
		assistant.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("visitor")),
		);
		const http = assistant.http("public-assistant");
		http.post(
			"internal",
			"/internal",
			{ input: type({}), output: type({ ok: "boolean" }) },
			async () => ({ ok: true }),
		);
		http.webhook(
			"provider-event",
			"/webhooks/provider",
			{
				event: type({ id: "string > 0" }),
				output: type({ received: "true" }),
				authenticate: async (request) => ({
					id: new TextDecoder().decode(request.body),
				}),
			},
				async () => ({ received: true }) satisfies { readonly received: true },
		);
		const ask = http.post(
			"ask",
			"/ask",
			{
				input: type({ question: "string > 0" }),
				output: type({ answer: "string" }),
			},
			async ({ input }) => ({ answer: input.question }),
		);
		ask.public();
		const base = applicationGraphFor(assistant.composition);
		if (!base) throw new Error("Expected typed HTTP application graph.");
		const operationId = "applik8s://http/public-assistant/operations/ask";
		const graph = applicationGraphWithEntrypointPublicSurface(base, {
			operationIds: [operationId],
			modelNames: [],
		});
		const manifest = applicationFacadeManifest(graph, {
			operationExports: [{ name: "PublicAssistant", operationId }],
		});
		expect(manifest.operations).toEqual([
			expect.objectContaining({
				id: operationId,
				name: "ask",
				owner: "public-assistant",
				exportNames: ["PublicAssistant"],
			}),
		]);
		const facade = generatedApplicationFacadeSource(manifest, "browser");
		expect(facade).toContain("export const PublicAssistant = createApplicationRuntimeOperation");
		const gateway =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(gateway).toContain(`runtime:${operationId}`);
		expect(gateway).not.toContain(
			"applik8s://http/public-assistant/operations/internal",
		);
		expect(gateway).toContain(
			'["webhook:/webhooks/provider","http://public-assistant.assistant-system.svc:80","APPLIK8S_RUNTIME_ENDPOINT_',
		);
		expect(gateway).toContain(
			"remoteRoutes.has('webhook:' + pathname)",
		);
		expect(gateway).toContain(
			"http://public-assistant.assistant-system.svc:80",
		);
		expect(gateway).toContain('"path":"/readyz"');
	});

	it("generates a provider-neutral public session facade for an identity-only application", () => {
		const account = app("account", { namespace: "account-system" });
		account.provide(
			IdentityProvider,
			IdentityProvider.deterministic({
				...identityOptions("member"),
				roles: ["workspace-owner"],
				trustedContext: {
					workspaceId: "workspace-private",
				},
			}),
		);
		const graph = applicationGraphFor(account.composition);
		if (!graph) throw new Error("Expected account application graph.");

		const modules = generatedApplicationFetchGatewayModules(graph);
		const source = modules?.files["gateway.generated.ts"];
		expect(modules).toBeDefined();
		expect(source).toContain(
			"import { createApplicationIdentitySessionHandler } from '@applik8s/identity/server';",
		);
		expect(source).toContain(
			"url.pathname === '/__applik8s/v1/identity/session'",
		);
		expect(source).toContain(
			"const applicationIdentitySession = createApplicationIdentitySessionHandler({",
		);
		expect(source).not.toContain("roles: principal.roles");
		expect(source).not.toContain("attributes: principal.attributes");
		expect(source).not.toContain(
			"trustedContextDigest: principal.trustedContextDigest",
		);
		expect(source).not.toContain("catalogRevision: principal.catalogRevision");
		expect(source).not.toContain(
			"authorityRevision: principal.authorityRevision",
		);
	});

	it("re-admits identity-provider roles through canonical application-operator grants", () => {
		const account = app("operator-account", { namespace: "operator-system" });
		const records = pgTable("operator_records", {
			id: text("id").primaryKey(),
		});
		const database = account.database.postgres("application", {
			schema: { records },
		});
		const Record = account.model(records, { name: "Record", database });
		account.provide(
			IdentityProvider,
			IdentityProvider.deterministic({
				...identityOptions("local-developer"),
				roles: ["application-operator"],
			}),
		);
		account.role("application-operator")
			.can(Record.delete.all())
			.bootstrap({
				id: "identity:deterministic:local-developer",
				kind: "human",
				issuer: "applik8s://operator-account/identity/deterministic",
				subject: "local-developer",
			});
		const graph = applicationGraphFor(account.composition);
		if (!graph) throw new Error("Expected operator application graph.");

		const source = generatedApplicationFetchGatewayModules(graph)?.files[
			"gateway.generated.ts"
		];
		expect(source).toContain(
			"import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';",
		);
		expect(source).toContain(
			"postgres(requiredEnv(\"APPLIK8S_DATABASE_APPLICATION_URL\")",
		);
		expect(source).toContain("async function admitApplicationIdentity(request)");
		expect(source).toContain("const admittedPrincipal = await operationAuthority.admitPrincipal({");
		expect(source).toContain('observeApplicationCapability');
		expect(source).toContain("source: 'application-fetch-gateway'");
		expect(source).toContain("'identity:provider'");
		expect(source).toContain("roleBootstraps");
		expect(source).toContain("authenticate: (request) => admitApplicationIdentity(request)");
	});

	it("routes the complete framework identity protocol through the selected provider callback", () => {
		const account = app("account-http", { namespace: "account-system" });
		account.provide(
			IdentityProvider,
			{
				...IdentityProvider.deterministic(identityOptions("member")),
				handle: async () =>
					Response.json({
						protocol: "applik8s.identityHttp/v1alpha1",
						kind: "account",
					}),
			},
		);
		const graph = applicationGraphFor(account.composition);
		if (!graph) throw new Error("Expected account application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			"url.pathname.startsWith('/__applik8s/v1/identity/')",
		);
		expect(source).toContain("identity-http");
	});

	it("generates authenticated logical object-store routes without exposing provider credentials", () => {
		const chirp = app("chirp", {
			apiVersion: "applications.chirp.dev/v1alpha1",
			kind: "ChirpInstallation",
			spec: type({ name: "string", features: { media: "boolean" } }),
			status: type({ ready: "boolean" }),
			namespace: (spec) => spec.name,
		});
		chirp.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("viewer")),
		);
		chirp.provide(
			ObjectStorage,
			ObjectStorage.s3({
				name: "media",
				bucket: "chirp-media",
				region: "us-east-1",
				endpoint: "http://rook-rgw.chirp.svc:80",
				forcePathStyle: true,
				credentialsSecret: {
					apiVersion: "v1",
					kind: "Secret",
					name: "chirp-media",
					namespace: "chirp",
				},
				ownership: "external",
			}),
		);
		chirp.objectStore("attachments", {
			maxObjectBytes: 25_000_000,
			contentTypes: ["image/png"],
			mode: "immutable",
			enabled: chirp.installation.spec.features.media,
			browser: { upload: "signed", download: "signed", ttlSeconds: 600 },
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp object-store graph.");
		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			"createS3ApplicationObjectStorageRuntime",
		);
		expect(source).toContain('name: "attachments"');
		expect(source).toContain(
			'installationBoolean("${schema.spec.features.media}", "attachments")',
		);
		expect(source).toContain(
			"JSON.parse(requiredEnv('APPLIK8S_INSTALLATION_SPEC'))",
		);
		expect(source).toContain("route?.startsWith('object:')");
		expect(source).toContain(
			"bucket: requiredEnv('APPLIK8S_OBJECT_STORAGE_BUCKET')",
		);
		expect(source).not.toContain("chirp-media");
		expect(source).not.toContain("AWS_SECRET_ACCESS_KEY");
	});

	it("uses the unqualified identity binding without counting its named profile source twice", () => {
		const research = app("research", { namespace: "research-system" });
		research.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("researcher")),
		);
		research.provide(
			ObjectStorage,
			ObjectStorage.s3({
				name: "objects",
				bucket: "research-objects",
				region: "us-east-1",
				endpoint: "https://objects.example.test",
				credentialsSecret: {
					apiVersion: "v1",
					kind: "Secret",
					name: "object-credentials",
					namespace: "research-system",
				},
				ownership: "external",
			}),
		);
		research.objectStore("artifacts", {
			maxObjectBytes: 1024,
			contentTypes: ["application/json"],
			mode: "immutable",
			browser: { upload: "signed", download: "signed" },
		});
		const baseGraph = applicationGraphFor(research.composition);
		if (!baseGraph) throw new Error("Expected research application graph.");
		const identity = baseGraph.nodes.find(
			(node) =>
				node.kind === "provider"
				&& node.interface === "IdentityProvider",
		);
		if (!identity || identity.kind !== "provider") {
			throw new Error("Expected research identity provider.");
		}
		const graph = {
			...baseGraph,
			nodes: [
				...baseGraph.nodes,
				{
					...identity,
					id: "provider.identity-provider.v1alpha1.primary",
					config: {
						...identity.config,
						qualification: {
							apiVersion: "applik8s.providerQualification/v1alpha1",
							capability: "IdentityProvider",
							name: "primary",
							compatibilityRevision: "v1alpha1",
							key: "IdentityProvider@v1alpha1:primary",
						},
					},
				},
			],
		};

		expect(
			graph.nodes.filter(
				(node) =>
					node.kind === "provider"
					&& node.interface === "IdentityProvider",
			),
		).toHaveLength(2);
		expect(
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			],
		).toContain("createS3ApplicationObjectStorageRuntime");
	});

	it("selects profiled identity authentication in the generated web host", () => {
		const research = app("profiled-research", {
			namespace: "research-system",
		});
		research.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("researcher")),
		);
		research.provide(
			ObjectStorage,
			ObjectStorage.s3({
				name: "objects",
				bucket: "research-objects",
				region: "us-east-1",
				endpoint: "https://objects.example.test",
				credentialsSecret: {
					apiVersion: "v1",
					kind: "Secret",
					name: "object-credentials",
					namespace: "research-system",
				},
				ownership: "external",
			}),
		);
		research.objectStore("artifacts", {
			maxObjectBytes: 1024,
			contentTypes: ["application/json"],
			mode: "immutable",
			browser: { upload: "signed", download: "signed" },
		});
		const baseGraph = applicationGraphFor(research.composition);
		if (!baseGraph) throw new Error("Expected profiled research graph.");
		const graph = {
			...baseGraph,
			nodes: baseGraph.nodes.map((node) =>
				node.kind === "provider"
				&& node.interface === "IdentityProvider"
				? {
						...node,
						config: {
							...node.config,
							identity: {
								authenticationProfile: {
									selector: "schema.spec.profile",
									cases: {
										starter: {
											authenticationSource:
												'async () => ({ principal: { id: "starter" } })',
										},
										dedicated: {
											authenticationSource:
												'async () => ({ principal: { id: "dedicated" } })',
										},
									},
									default: {
										authenticationSource:
											'async () => ({ principal: { id: "external" } })',
									},
								},
							},
						},
					}
				: node,
			),
		};

		const modules = generatedApplicationFetchGatewayModules(graph);
		const source = modules?.files["gateway.generated.ts"];
		expect(source).toContain("APPLIK8S_PROFILE_VARIANT");
		expect(source).toContain('"starter"');
		expect(source).toContain('"dedicated"');
		expect(Object.values(modules?.files ?? {}).join("\n")).toContain(
			'principal: { id: "external" }',
		);
	});

	it("routes relational operations to their generated internal gateway behind the same origin", () => {
		const posts = pgTable("posts", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", { namespace: "chirp" });
		const database = chirp.database.postgres("chirp", { schema: { posts } });
		const Post = chirp.model(posts, { name: "Post", database });
		const TimelinePost = Post.view("timeline", {
			input: type({}),
			output: type({
				id: "string",
				body: "string",
				revision: "string",
			}).array(),
			database,
			authorize: () => true,
			run: async () => [],
		});
		chirp.gateway("web", {
			queries: [TimelinePost.timeline],
			commands: [Post.create, Post.update, Post.delete],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () => createDeterministicApplicationAdmission(identityOptions("viewer")),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const modules = generatedApplicationFetchGatewayModules(graph);
		expect(modules).toBeDefined();
		expect(modules?.files["gateway.generated.ts"]).toContain(
			'["query:Post.timeline","http://chirp-web.chirp.svc:8080","APPLIK8S_RUNTIME_ENDPOINT_',
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"url.pathname.slice('/__applik8s/v1'.length)",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"url.pathname === '/__applik8s/v1/healthz'",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"JSON.stringify({ live: true })",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"fetch(new URL(path, baseUrl))",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"dependencies: remoteResults",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain("catch (error)");
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"proxyApplicationQueryMultiplex(request",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"remoteRoutes.get(`query:${query}`)",
		);
		expect(modules?.files["gateway.generated.ts"]).toContain(
			"forwardRemoteRequest(targetRequest, remoteBaseUrl)",
		);
		expect(modules?.files["gateway.generated.ts"]).not.toContain(
			"createApplik8sKubernetesGateway({",
		);
	});

	it("routes both replay and action requests for a gateway-owned durable signal", () => {
		const chirp = app("chirp", { namespace: "chirp" });
		chirp.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("moderator")),
		);
		chirp.database.postgres("chirp", { schema: {} });
		const ReviewDecision = chirp.workflow.signal(
			"review-decision.v1",
			{
				input: type({ postId: "string" }),
				actions: {
					approve: type({ "comment?": "string" }),
					reject: type({ reason: "string" }),
				},
			},
		);
		const ReviewRequests = ReviewDecision.subscribe("review-requests", {
			delivery: "sse",
			authorize: ({ principal }) =>
				principal.identity.subject === "moderator",
		});
		chirp.gateway("moderation", {
			subscriptions: [ReviewRequests],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () =>
					createDeterministicApplicationAdmission(
						identityOptions("moderator"),
					),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp signal graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			'["stream:review-requests","http://chirp-moderation.chirp.svc:8080","APPLIK8S_RUNTIME_ENDPOINT_',
		);
		expect(source).toContain(
			'["signal:review-decision.v1","http://chirp-moderation.chirp.svc:8080","APPLIK8S_RUNTIME_ENDPOINT_',
		);
		expect(source).toContain(
			"if (parts[0] === 'signals' && parts[1])",
		);
	});

	it("routes authenticated TanStack AI requests through a signed per-run agent admission", () => {
		const notes = pgTable("research_notes", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
		});
		const research = app("research", { namespace: "research-system" });
		research.provide(
			IdentityProvider,
			IdentityProvider.deterministic({
				...identityOptions("researcher"),
				application: "research",
				audience: ["research"],
			}),
		);
		research.provide(
			AI,
			AI.deterministic({ fixture: { response: "ready" } }),
		);
		research.provide(Observability, Observability.local());
		const database = research.database.postgres("application", {
			schema: { notes },
		});
		const Note = research.model(notes, { name: "Note", database });
		const identity = research.serviceIdentity("researcher");
		research.agent(
			"researcher",
			{
				identity,
				model: AI.model("fast", {
					capabilities: [AI.chat, AI.tools, AI.streaming],
				}),
				instructions: "Use the declared note operation.",
				tools: [Note.create],
			},
			async (request, context) => ({
				threadId: request.threadId,
				runId: context.runId,
			}),
		);
		identity.can(Note.create);
		research.gateway("agent-tools", {
			commands: [Note.create, Note.update, Note.delete],
			authorizeCommand: () => true,
			deployment: {
				namespace: "research-system",
				cursorSecret: { name: "research-cursor", key: "key" },
				authenticate: async () =>
					createDeterministicApplicationAdmission({
						...identityOptions("researcher"),
						application: "research",
						audience: ["research"],
					}),
			},
		});
		const graph = applicationGraphFor(research.composition);
		if (!graph) throw new Error("Expected research application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			"createApplicationAIAgentGateway",
		);
		expect(source).toContain("captureApplicationTelemetryContext");
		expect(source).toContain(
			"captureTelemetry: () => captureApplicationTelemetryContext()",
		);
		expect(source).toContain(
			"http://researcher.research-system.svc:3000",
		);
		expect(source).toContain(
			"identity:research:workload:aiAgent.researcher",
		);
		expect(source).toContain(
			"requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET')",
		);
		expect(source).not.toContain("applicationAdmittedContextDigest");
		expect(source).toContain(
			"return { ...admission, trustedContext: admission.trustedContext ?? {} };",
		);
		expect(source).toContain(
			"agentGateway.handle(request.clone())",
		);
		expect(source).toContain("observeAdmission: observeRequestAdmission");
		expect(source).toContain("id: 'request-admission:' + observation.transport");
		expect(source).toContain("authority: 'canonical'");
		expect(source).toContain("expiresAt: new Date(observationTime + 90_000).toISOString()");
		expect(source).toContain(
			"path: '/readyz'",
		);
		expect(source).not.toContain("Bearer ");
	});

	it("does not duplicate remotely assigned Kubernetes queries in the web host", () => {
		const chirp = app("chirp", { namespace: "chirp" });
		chirp.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("moderator")),
		);
		const PolicyResource = chirp.crd(
			entity("ModerationPolicy", {
				spec: type({ maxRisk: "number" }),
				status: type({ "phase?": "'Ready' | 'Invalid'" }),
			}),
			{ apiVersion: "chirp.example/v1alpha1" },
		);
		const Policy = PolicyResource.view("current", {
			input: type({}),
			output: type({ name: "string", maxRisk: "number" }).array(),
			authorize: ({ principal }) => principal.identity.subject === "moderator",
			kubernetes: {
				namespace: "chirp",
				project: ({ value }) => ({
					name: value.metadata.name,
					maxRisk: value.spec.maxRisk,
				}),
				pageSize: 10,
				maxPages: 2,
				maxItems: 10,
			},
			budgets: { maxRows: 10, maxResultBytes: 16_000, timeoutMs: 2_000 },
		});
		chirp.gateway("administration", {
			queries: [Policy.current],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () => createDeterministicApplicationAdmission(identityOptions("moderator")),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			'["query:ModerationPolicy.current","http://chirp-administration.chirp.svc:8080","APPLIK8S_RUNTIME_ENDPOINT_',
		);
		expect(source).not.toContain("@applik8s/server/kubernetes-gateway");
		expect(source).toContain("const localGateway = undefined;");
	});

	it("bounds request-derived Kubernetes model namespaces to the ApplicationHost namespace", () => {
		const guestbook = app("guestbook", { namespace: "guestbook" });
		guestbook.provide(
			IdentityProvider,
			IdentityProvider.deterministic(identityOptions("author", { namespace: "guestbook" })),
		);
		const Entries = guestbook.crd(
			entity("GuestBookEntry", {
				spec: type({ message: "string" }),
				status: type({ "phase?": "'Published'" }),
			}),
			{
				apiVersion: "guestbook.example/v1alpha1",
				create: {
					authorize: () => true,
					place: ({ context }) => ({
						namespace: String(context.namespace),
						generateName: "entry-",
					}),
				},
			},
		);
		Entries.view(
			{
				input: type({}),
				output: type({ message: "string" }).array(),
				authorize: () => true,
				select: {
					namespace: (_input, { context }) => String(context.namespace),
					where: (entry) => entry.status?.phase === "Published",
					limit: () => 20,
				},
			},
			function published(entry) {
				return { message: entry.spec.message };
			},
		);
		const graph = applicationGraphFor(guestbook.composition);
		if (!graph) throw new Error("Expected GuestBook application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain("allowedNamespaces: [requiredRuntimeNamespace()]");
		expect(source).toContain(
			"const runtimeNamespace = process.env.APPLIK8S_NAMESPACE",
		);
		expect(source).toContain("commands: [{");
		expect(source).toContain("queries: [{");
		expect(source).toContain(
			"Applik8s Kubernetes application-host request failed",
		);
		expect(source).toContain(
			"(request.input, { input: request.input, context: request.context })",
		);
		expect(source).toContain(
			"(request.value, { input: request.input, context: request.context })",
		);
	});

	it("resolves installation-scoped gateway namespaces from the runtime environment", () => {
		const posts = pgTable("posts", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", {
			apiVersion: "applications.chirp.dev/v1alpha1",
			kind: "ChirpInstallation",
			spec: type({ name: "string" }),
			status: type({ ready: "boolean" }),
			namespace: (spec) => spec.name,
		});
		const database = chirp.database.postgres("chirp", { schema: { posts } });
		const Post = chirp.model(posts, { name: "Post", database });
		const TimelinePost = Post.view("timeline", {
			input: type({}),
			output: type({
				id: "string",
				body: "string",
				revision: "string",
			}).array(),
			database,
			authorize: () => true,
			run: async () => [],
		});
		chirp.gateway("web", {
			queries: [TimelinePost.timeline],
			commands: [Post.create, Post.update, Post.delete],
			authorizeCommand: () => true,
			deployment: {
				namespace: chirp.installation.spec.name,
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () => createDeterministicApplicationAdmission(identityOptions("viewer")),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph)
			throw new Error("Expected installable Chirp application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			"http://chirp-web.__APPLIK8S_RUNTIME_NAMESPACE__.svc:8080",
		);
		expect(source).toContain(
			"const runtimeNamespace = process.env.APPLIK8S_NAMESPACE",
		);
		expect(source).toContain(
			'selected.replaceAll("__APPLIK8S_RUNTIME_NAMESPACE__", runtimeNamespace)',
		);
		expect(source).not.toContain("__KUBERNETES_REF___schema___spec.name__");
	});

	it("keeps an unassigned model view out of the public application host and facade", () => {
		const posts = pgTable("posts", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", { namespace: "chirp" });
		const database = chirp.database.postgres("chirp", { schema: { posts } });
		const Post = chirp.model(posts, { name: "Post", database });
		Post.view("timeline", {
			input: type({}),
			output: type({
				id: "string",
				body: "string",
				revision: "string",
			}).array(),
			database,
			authorize: () => true,
			run: async () => [],
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source ?? "").not.toContain("query:Post.timeline");
		expect(applicationFacadeManifest(graph).models).toEqual([]);
	});

	it("keeps an unassigned custom model command out of the public application host and facade", () => {
		const posts = pgTable("posts", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", { namespace: "chirp" });
		const database = chirp.database.postgres("chirp", { schema: { posts } });
			const Post = chirp.model(posts, { name: "Post", database });
		chirp.gateway("web", {
			commands: [Post.create, Post.update, Post.delete],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () => createDeterministicApplicationAdmission(identityOptions("viewer")),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).not.toContain("command:posts.publish.v1");
		expect(
			applicationFacadeManifest(graph)
				.models.find((model) => model.name === "Post")
				?.operations.map((operation) => operation.name),
		).toEqual(["create", "delete", "update"]);
	});

	it("materializes an internal gateway without publishing its routes or model facade", () => {
		const receipts = pgTable("receipts", {
			id: text("id").primaryKey(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", { namespace: "chirp" });
		const database = chirp.database.postgres("chirp", {
			schema: { receipts },
		});
		const Receipt = chirp.model(receipts, {
			name: "EngagementBatch",
			database,
		});
		chirp.gateway("system", {
			visibility: "internal",
			commands: [Receipt.create],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () =>
					createDeterministicApplicationAdmission(
						identityOptions("processor"),
					),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "gateway",
					name: "system",
					visibility: "internal",
					materialization: "generatedDeployment",
				}),
			]),
		);
		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source ?? "").not.toContain("chirp-system.chirp.svc");
		expect(source ?? "").not.toContain("command:EngagementBatch.create");
		const publishedSource = generatedApplicationFetchGatewayModules(graph, {
			modelExports: [{
				name: "EngagementBatch",
				modelName: "EngagementBatch",
			}],
		})?.files["gateway.generated.ts"];
		expect(publishedSource).toContain("chirp-system.chirp.svc:8080");
		expect(publishedSource).toContain(
			"command:models.EngagementBatch.create.v1",
		);
		expect(applicationFacadeManifest(graph).models).toEqual([]);
		expect(
			applicationFacadeManifest(graph, {
				modelExports: [{
					name: "EngagementBatch",
					modelName: "EngagementBatch",
				}],
			}).models,
		).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "EngagementBatch",
				operations: expect.arrayContaining([
					expect.objectContaining({
						id: "models.EngagementBatch.create.v1",
						name: "create",
					}),
				]),
			}),
		]));
	});
});

function identityOptions(
	subject: string,
	trustedContext: Record<string, string> = {},
): ApplicationDeterministicIdentityOptions {
	return {
		mode: "starter",
		application: "test",
		subject,
		catalogRevision: "catalog-test-v1",
		authorityRevision: "authority-test-v1",
		trustedContext,
		admittedAt: "2026-01-01T00:00:00.000Z",
	};
}
