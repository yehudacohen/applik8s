import {
	app,
	applicationGraphFor,
	command,
	ObjectStorage,
	RequestIdentity,
} from "@applik8s/applik8s";
import { entity, type } from "@applik8s/applik8s/dsl";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { generatedApplicationFetchGatewayModules } from "../src/application-fetch-gateway/index.js";

describe("application host Fetch gateway", () => {
	it("generates authenticated logical object-store routes without exposing provider credentials", () => {
		const chirp = app("chirp", {
			apiVersion: "applications.chirp.dev/v1alpha1",
			kind: "ChirpInstallation",
			spec: type({ name: "string", features: { media: "boolean" } }),
			status: type({ ready: "boolean" }),
			namespace: (spec) => spec.name,
		});
		chirp.provide(
			RequestIdentity,
			RequestIdentity.from(async () => ({
				principal: { id: "viewer" },
				trustedContext: {},
				authorizationVersion: "v1",
			})),
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
			"createApplicationFetchGateway, createS3ApplicationObjectStorageRuntime",
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
				authenticate: async () => ({
					principal: { id: "viewer" },
					trustedContext: {},
					authorizationVersion: "v1",
				}),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const modules = generatedApplicationFetchGatewayModules(graph);
		expect(modules).toBeDefined();
		expect(modules?.files["gateway.generated.ts"]).toContain(
			'["query:Post.timeline","http://chirp-web.chirp.svc:8080"]',
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
			"fetch(new URL('/ready', baseUrl))",
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

	it("does not duplicate remotely assigned Kubernetes queries in the web host", () => {
		const chirp = app("chirp", { namespace: "chirp" });
		chirp.provide(
			RequestIdentity,
			RequestIdentity.from(async () => ({
				principal: { id: "moderator", claims: { role: "moderator" } },
				trustedContext: {},
				authorizationVersion: "v1",
			})),
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
			authorize: ({ principal }) => principal.claims?.role === "moderator",
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
				authenticate: async () => ({
					principal: { id: "moderator", claims: { role: "moderator" } },
					trustedContext: {},
					authorizationVersion: "v1",
				}),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		const source =
			generatedApplicationFetchGatewayModules(graph)?.files[
				"gateway.generated.ts"
			];
		expect(source).toContain(
			'["query:ModerationPolicy.current","http://chirp-administration.chirp.svc:8080"]',
		);
		expect(source).not.toContain("@applik8s/server/kubernetes-gateway");
		expect(source).toContain("const localGateway = undefined;");
	});

	it("bounds request-derived Kubernetes model namespaces to the ApplicationHost namespace", () => {
		const guestbook = app("guestbook", { namespace: "guestbook" });
		guestbook.provide(
			RequestIdentity,
			RequestIdentity.from(async () => ({
				principal: { id: "author" },
				trustedContext: { namespace: "guestbook" },
				authorizationVersion: "v1",
			})),
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
		Entries.view("published", {
			input: type({}),
			output: type({ message: "string" }).array(),
			authorize: () => true,
			kubernetes: {
				namespace: ({ context }) => String(context.namespace),
				project: ({ value }) => ({ message: value.spec.message }),
			},
		});
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
				authenticate: async () => ({
					principal: { id: "viewer" },
					trustedContext: {},
					authorizationVersion: "v1",
				}),
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
			'baseUrl.replaceAll("__APPLIK8S_RUNTIME_NAMESPACE__", runtimeNamespace)',
		);
		expect(source).not.toContain("__KUBERNETES_REF___schema___spec.name__");
	});

	it("fails before deployment when a generated model facade view has no gateway route", () => {
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

		expect(() => generatedApplicationFetchGatewayModules(graph)).toThrow(
			"Generated application facade query Post.timeline is not exposed by a generated gateway. Add Post.timeline to exactly one app.gateway(...).queries list.",
		);
	});

	it("fails before deployment when a generated model facade command has no gateway route", () => {
		const posts = pgTable("posts", {
			id: text("id").primaryKey(),
			body: text("body").notNull(),
			revision: text("revision").notNull(),
		});
		const chirp = app("chirp", { namespace: "chirp" });
		const database = chirp.database.postgres("chirp", { schema: { posts } });
		const BasePost = chirp.model(posts, { name: "Post", database });
		const Publish = command("posts.publish.v1", {
			input: type({ postId: "string" }),
			output: type({ published: "boolean" }),
		});
		const Post = BasePost.command(
			"publish",
			Publish,
			{ key: ({ postId }) => postId },
			async () => ({ published: true }),
		);
		chirp.gateway("web", {
			commands: [Post.create, Post.update, Post.delete],
			authorizeCommand: () => true,
			deployment: {
				namespace: "chirp",
				port: 8080,
				cursorSecret: { name: "chirp-cursor", key: "key" },
				authenticate: async () => ({
					principal: { id: "viewer" },
					trustedContext: {},
					authorizationVersion: "v1",
				}),
			},
		});
		const graph = applicationGraphFor(chirp.composition);
		if (!graph) throw new Error("Expected Chirp application graph.");

		expect(() => generatedApplicationFetchGatewayModules(graph)).toThrow(
			"Generated application facade command posts.publish.v1 is not exposed by a generated gateway. Add Post.publish to exactly one app.gateway(...).commands list.",
		);
	});
});
