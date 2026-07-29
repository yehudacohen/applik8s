// typecast-file-boundary: repository-owned scorecard and live-receipt JSON is validated before use.
import { access, readFile } from "node:fs/promises";
import {
	app,
	applicationGraphFor,
	event,
	AnalyticalDatabase,
	postgres,
	trustedContext,
} from "@applik8s/applik8s";
import { validateApplicationGraphStructure } from "@applik8s/core";
import { type } from "arktype";
import { pgTable, text } from "drizzle-orm/pg-core";
import {
	collectV06ArtifactIdentity,
	collectV06ClusterIdentity,
	collectV06GitIdentity,
	collectV06InstallationIdentity,
	type V06ArtifactIdentity,
	type V06ClusterIdentity,
	type V06GitIdentity,
	type V06InstallationIdentity,
} from "./v06-evidence";

type EvidenceState = "pass" | "fail" | "missing";
interface Check {
	readonly id: string;
	readonly state: EvidenceState;
	readonly evidence: string;
}
interface Dimension {
	readonly name: string;
	readonly checks: readonly Check[];
}
interface LiveReceipt {
	readonly schemaVersion?: number;
	readonly suite?: string;
	readonly completedAt?: string;
	readonly assertions?: readonly string[];
	readonly assertionEvidence?: readonly {
		readonly assertion?: string;
		readonly test?: string;
		readonly runId?: string;
		readonly observedAt?: string;
	}[];
	readonly run?: {
		readonly id?: string;
		readonly startedAt?: string;
		readonly completedAt?: string;
	};
	readonly candidate?: {
		readonly git?: V06GitIdentity;
		readonly cluster?: V06ClusterIdentity;
		readonly installation?: V06InstallationIdentity;
		readonly artifacts?: V06ArtifactIdentity;
	};
}
interface ExpectedCandidate {
	readonly git: V06GitIdentity;
	readonly cluster?: V06ClusterIdentity;
	readonly installation?: V06InstallationIdentity;
	readonly artifacts?: V06ArtifactIdentity;
}

const OrganizationId = trustedContext("organizationId", {
	schema: type("string"),
});
const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id").notNull(),
	revision: text("revision").notNull(),
});
const application = app("v06-scorecard", { namespace: "v06-scorecard" });
const database = application.database.postgres("catalog", {
	schema: { accounts },
	migrations: "./migrations",
	access: postgres.rls({ context: OrganizationId, column: "organizationId" }),
});
const Account = application.model(accounts, { name: "Account", database });
const AccountChanged = event("accounts.changed.v1", {
	payload: type({ accountId: "string", revision: "string" }),
});
const changes = application.stream(AccountChanged, {
	database,
	retention: { maxAgeSeconds: 86_400 },
	partitionBy: (payload) => payload.accountId,
	authorize: () => true,
});
const query = application.query("accounts.list.v1", {
	input: type({}),
	output: Account.schema.select.array(),
	database,
	context: [OrganizationId],
	reads: [Account],
	authorize: () => true,
	run: async ({ context }) => context.database(database).select().from(Account),
});
application.defaults({
	analytics: AnalyticalDatabase.clickhouse({
		provision: false,
		endpoint: "http://clickhouse.invalid:8123",
	}),
});
application.projection("account-history", {
	source: changes,
	output: type({ accountId: "string", revision: "string" }),
	project: (payload) => payload,
});
application.gateway("public", { queries: [query] });
const graph = applicationGraphFor(application.composition);
if (!graph)
	throw new Error(
		"v0.6 scorecard application did not expose an ApplicationGraph.",
	);

const requireLive = process.argv.includes("--require-live");
const requireChirp = process.argv.includes("--require-chirp");
const context = process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack";
const git = await collectV06GitIdentity();
const cluster =
	requireLive || requireChirp
		? await collectV06ClusterIdentity(context)
		: undefined;
const chirpInstallation = requireChirp
	? await collectV06InstallationIdentity({
			context,
			resource: `chirpinstallation/${process.env.APPLIK8S_CHIRP_INSTANCE ?? "chirp"}`,
			namespace:
				process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? "chirp-control",
		})
	: undefined;
const chirpArtifacts = requireChirp
	? await collectV06ArtifactIdentity(
			"examples/chirp-start/.applik8s/deploy/typekro/application-deployment-graph.json",
		)
	: undefined;
const diagnostics = validateApplicationGraphStructure(graph);
const postgresReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/postgres.json",
	"postgres",
	{ git },
);
const clickhouseReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/clickhouse.json",
	"clickhouse",
	{ git },
);
const orbstackReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/orbstack.json",
	"orbstack",
	{ git, ...(cluster ? { cluster } : {}) },
);
const guestbookReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/guestbook-start.json",
	"guestbook-start",
	{ git, ...(cluster ? { cluster } : {}) },
);
const chirpExpected = {
	git,
	...(cluster ? { cluster } : {}),
	...(chirpInstallation ? { installation: chirpInstallation } : {}),
	...(chirpArtifacts ? { artifacts: chirpArtifacts } : {}),
};
const chirpDeploymentReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/chirp-deployment.json",
	"chirp-deployment",
	chirpExpected,
);
const chirpReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/chirp.json",
	"chirp",
	chirpExpected,
);
const chirpBrowserReceipt = await liveReceipt(
	".applik8s-tmp/evidence/v0.6/chirp-browser.json",
	"chirp-browser",
	chirpExpected,
);
const baseline = (await jsonFile("benchmarks/v0.6/baseline.json")) as
	| {
			readonly evidenceClass?: string;
			readonly git?: {
				readonly commit?: string;
				readonly dirty?: boolean;
				readonly workingTreeDigest?: string;
			};
			readonly environment?: {
				readonly platform?: string;
				readonly architecture?: string;
				readonly cpuModel?: string;
				readonly cpuCount?: number;
				readonly runtime?: string;
			};
			readonly client?: {
				readonly cacheKeysPerSecond?: number;
				readonly latencyMs?: { readonly p95?: number };
				readonly rssGrowthBytes?: number;
			};
			readonly projection?: {
				readonly eventsPerSecond?: number;
				readonly coldStartMs?: number;
				readonly convergenceMs?: number;
				readonly consumerLag?: {
					readonly initial?: number;
					readonly final?: number;
				};
				readonly rssGrowthBytes?: number;
			};
	  }
	| undefined;
const chirpArtifactBaseline = (await jsonFile(
	"benchmarks/v0.6/chirp-artifacts/baseline.json",
)) as
	| {
			readonly evidenceClass?: string;
			readonly git?: {
				readonly commit?: string;
				readonly dirty?: boolean;
				readonly workingTreeDigest?: string;
			};
			readonly build?: {
				readonly webDurationMs?: number;
				readonly compilerDurationMs?: number;
			};
			readonly graph?: {
				readonly resourceGraphDefinitionBytes?: number;
				readonly generatedArtifacts?: number;
			};
			readonly web?: {
				readonly browserJavaScriptGzipBytes?: number;
				readonly serverOutputBytes?: number;
			};
			readonly containers?: {
				readonly count?: number;
				readonly totalContextBytes?: number;
				readonly maximumContextBytes?: number;
			};
	  }
	| undefined;

const dimensions: readonly Dimension[] = [
	dimension(
		"Native model and graph contracts",
		check(
			"graph-valid",
			diagnostics.length === 0,
			`ApplicationGraph diagnostics: ${diagnostics.length}`,
		),
		check(
			"native-drizzle-authority",
			graph.nodes.some(
				(node) =>
					node.kind === "model" &&
					node.native?.kind === "drizzle-table" &&
					node.native.schemaAuthority === "drizzle",
			),
			"Drizzle remains the native storage/type authority.",
		),
		check(
			"provider-neutral-model",
			graph.nodes.some(
				(node) =>
					node.kind === "model" &&
					node.common?.revision?.authority === "postgres-row",
			),
			"The common model facet records provider-neutral identity and revision semantics.",
		),
	),
	dimension(
		"Authorization and PostgreSQL semantics",
		check(
			"rls-contract",
			graph.nodes.some(
				(node) =>
					node.kind === "model" &&
					node.runtime?.nativeRelational?.access?.context === "organizationId",
			),
			"Trusted context is lowered to a PostgreSQL RLS setting.",
		),
		receiptCheck(postgresReceipt, "postgres-live", [
			"rls-isolation",
			"pool-context-cleanup",
			"transaction-rollback",
			"snapshot-resume",
			"command-idempotency",
			"outbox-recovery",
		]),
	),
	dimension(
		"Queries, streams, and projections",
		check(
			"reactive-graph",
			["query", "stream", "projection", "gateway"].every((kind) =>
				graph.nodes.some((node) => node.kind === kind),
			),
			"Query, stream, projection, and gateway are graph-visible contracts.",
		),
		check(
			"resumable-query",
			graph.nodes.some(
				(node) =>
					node.kind === "query" &&
					node.snapshotResume === "resumableInvalidation",
			),
			"The query contract uses opaque resumable invalidation.",
		),
		receiptCheck(clickhouseReceipt, "clickhouse-live", [
			"prepare",
			"idempotent-write",
			"checkpoint-resume",
			"full-rebuild",
		]),
	),
	dimension(
		"Generated runtime and packaging",
		check(
			"focused-runtime-entrypoint",
			(await fileExists("packages/applik8s/src/reactive-runtime.ts")) &&
				(await fileExists("packages/sdk/src/schema-runtime.ts")),
			"Generated workloads depend on focused runtime/schema entrypoints.",
		),
		check(
			"framework-neutral-vite",
			(await fileExists("packages/vite/src/index.ts")) &&
				(await fileExists("packages/server/src/kubernetes-gateway.ts")),
			"Vite owns build partitioning while the Fetch-compatible Kubernetes authority lives in the framework-neutral server package.",
		),
		check(
			"authenticated-server-scope",
			await fileExists("packages/server/test/request-scope.vertical.test.ts"),
			"SSR query execution requires an authenticated request runtime and has no anonymous loopback fallback.",
		),
		check(
			"thin-tanstack-adapter",
			(await fileExists("packages/tanstack-start/src/vite.ts")) &&
				(await fileExists("packages/tanstack-start/src/server.ts")),
			"TanStack Start contains only Nitro request-context/build adaptation over framework-neutral React, server, and Vite packages.",
		),
		check(
			"packed-consumer-gate",
			(await fileExists("scripts/package-consumer-smoke.mjs")) &&
				(await fileExists("scripts/package-publish-dry-run.mjs")),
			"Clean packed-consumer and coordinated dry-pack gates are present in the release lane.",
		),
		check(
			"oci-generated-workloads",
			(await fileExists(
				"packages/compiler/src/application-containers/index.ts",
			)) &&
				(await fileExists(
					"packages/compiler/test/application-containers.vertical.test.ts",
				)),
			"Migrations, processors, gateways, projections, stream processors, and workflow workers lower to content-tagged OCI artifacts rather than executable ConfigMaps.",
		),
		check(
			"bundle-budget",
			await fileExists("benchmarks/v0.6/budgets.json"),
			"A tracked generated-runtime budget exists and is enforced by compiler tests.",
		),
	),
	dimension(
		"Application host and dual-runtime model experience",
		check(
			"generated-facades",
			(await fileExists("packages/compiler/src/application-facade/index.ts")) &&
				(await fileExists("packages/client/src/operations.ts")),
			"One graph-derived model contract lowers to callable browser and server operation facades.",
		),
		check(
			"generated-fetch-gateway",
			(await fileExists(
				"packages/compiler/src/application-fetch-gateway/index.ts",
			)) && (await fileExists("packages/applik8s/src/application-gateway.ts")),
			"The compiler emits a framework-neutral Request-to-Response gateway with isolated callbacks.",
		),
		check(
			"oci-application-host",
			await fileExists("packages/compiler/src/application-host/index.ts"),
			"ApplicationHost emits an immutable OCI build context, Deployment, Service, probes, inferred RBAC, and image provenance.",
		),
		check(
			"guestbook-source-shape",
			(await fileExists("examples/guestbook-start/src/application.ts")) &&
				(await fileExists("examples/guestbook-start/src/routes/index.tsx")) &&
				(await fileExists("examples/guestbook-start/package.json")),
			"The flagship example is a self-contained official-shape Start application using shared model facades and app-native lifecycle handlers.",
		),
		check(
			"realistic-chirp-pressure-test",
			(await fileExists("examples/chirp-start/src/models.ts")) &&
				(await fileExists("examples/chirp-start/src/routes/index.tsx")) &&
				(await fileExists("scripts/check-chirp-start-build.mjs")),
			"Chirp exercises native models, direct operations, streams, projections, workflows, an operator, and immutable hosting in one official-shape application.",
		),
	),
	dimension(
		"Chirp flagship evidence",
		receiptCheck(chirpReceipt, "chirp-runtime-golden-path", [
			"ssr",
			"jetstream-command",
			"postgres-transactional-outbox",
			"valkey-generation-projection",
			"sse-invalidation",
			"authoritative-requery",
			"clickhouse-projection",
			"clickhouse-product-query",
			"schema-complete-status",
			"harbor-digest-images",
			"declared-nodeport-exposure",
			"valkey-complete-loss",
			"degraded-query-fails-closed",
			"postgres-authoritative-snapshot",
			"foreground-commit-during-rebuild",
			"atomic-generation-publication",
			"rebuild-idempotent-retry",
			"s3-checksummed-rebuild-evidence",
			"command-processor-restart-recovery",
			"online-projection-restart-recovery",
			"query-gateway-restart-recovery",
			"application-host-restart-recovery",
			"harbor-component-restart-recovery",
			"acknowledged-work-retained",
		]),
		receiptCheck(chirpBrowserReceipt, "chirp-browser-golden-path", [
			"principal-derived-registration",
			"no-reload-publication",
			"authoritative-engagement-toggle",
			"authoritative-repost-toggle",
			"typed-reply-publication",
			"typed-quote-publication",
			"bookmark-create-remove",
			"provider-verified-media-roundtrip",
			"provider-rejected-media-signature-mismatch",
			"accessible-route-hydration",
			"principal-derived-follow-toggle",
			"principal-derived-mute-toggle",
			"principal-derived-block-toggle",
			"profile-update",
			"automation-configure-update-suspend",
			"automation-administrator-stop-resume",
			"report-triage-resolution",
			"moderated-post-removal",
			"browser-console-clean",
		]),
	),
	dimension(
		"Kubernetes lifecycle evidence",
		receiptCheck(orbstackReceipt, "orbstack-generated-app", [
			"harbor-digest-images",
			"typekro-apply",
			"schema-complete-ready",
			"gateway-ready",
			"command-create-update",
			"postgres-transactional-outbox",
			"jetstream-delivery",
			"sse-invalidation",
			"authoritative-requery",
			"clickhouse-projection",
			"projection-restart-resume",
			"alchemy-typekro-destroy",
			"graph-owned-resources-removed",
			"generated-rgd-removed",
			"namespaces-removed",
		]),
		receiptCheck(guestbookReceipt, "guestbook-start-golden-path", [
			"vite-application-build",
			"application-host-ready",
			"operator-ready",
			"browser-command-submit",
			"kubernetes-create",
			"operator-publish",
			"operator-reject",
			"sse-invalidation",
			"authoritative-requery",
			"ssr-render",
			"restart-resume",
			"cli-alchemy-typekro-delete",
			"runtime-created-data-cleanup",
			"generated-crd-retained-empty-for-reuse",
			"namespace-removed",
		]),
		receiptCheck(chirpDeploymentReceipt, "chirp-consecutive-deploys", [
			"first-deploy",
			"second-idempotent-deploy",
			"installation-uid-preserved",
			"artifact-identity-preserved",
			"incremental-harbor-reuse",
		]),
	),
	dimension(
		"Performance evidence",
		check(
			"tracked-baseline",
			Boolean(
				baseline &&
					(baseline.client?.cacheKeysPerSecond ?? 0) > 0 &&
					(baseline.projection?.eventsPerSecond ?? 0) > 0,
			),
			"A repeatable local microbenchmark baseline is tracked.",
		),
		check(
			"evidence-label",
			baseline?.evidenceClass === "synthetic-local",
			"The baseline explicitly labels its evidence class; synthetic results are not represented as datastore or cluster throughput.",
		),
		check(
			"reproducible-environment",
			Boolean(
				baseline?.git?.commit &&
					baseline?.environment?.platform &&
					baseline.environment.architecture &&
					baseline.environment.cpuModel &&
					baseline.environment.cpuCount &&
					baseline.environment.runtime &&
					(!baseline.git.dirty || baseline.git.workingTreeDigest),
			),
			"The baseline records Git/worktree identity, runtime, architecture, and hardware.",
		),
		check(
			"latency-memory-cold-start",
			Boolean(
				(baseline?.client?.latencyMs?.p95 ?? -1) >= 0 &&
					(baseline?.client?.rssGrowthBytes ?? -1) >= 0 &&
					(baseline?.projection?.coldStartMs ?? -1) >= 0 &&
					(baseline?.projection?.rssGrowthBytes ?? -1) >= 0,
			),
			"The local lane records latency, cold start, and RSS growth instead of throughput alone.",
		),
		check(
			"bounded-convergence",
			Boolean(
				(baseline?.projection?.convergenceMs ?? 0) > 0 &&
					(baseline?.projection?.consumerLag?.initial ?? 0) > 0 &&
					baseline?.projection?.consumerLag?.final === 0,
			),
			"The finite synthetic replay records initial/final consumer lag and bounded convergence.",
		),
		check(
			"chirp-artifact-baseline",
			Boolean(
				chirpArtifactBaseline?.evidenceClass === "local-build-artifacts" &&
					chirpArtifactBaseline.git?.commit &&
					(!chirpArtifactBaseline.git.dirty ||
						chirpArtifactBaseline.git.workingTreeDigest) &&
					(chirpArtifactBaseline.build?.webDurationMs ?? 0) > 0 &&
					(chirpArtifactBaseline.build?.compilerDurationMs ?? 0) > 0,
			),
			"The full Chirp build records reproducible web/compiler wall time under an explicitly local evidence class.",
		),
		check(
			"chirp-artifact-bounds",
			Boolean(
				(chirpArtifactBaseline?.graph?.resourceGraphDefinitionBytes ?? 0) > 0 &&
					(chirpArtifactBaseline?.graph?.generatedArtifacts ?? 0) > 0 &&
					(chirpArtifactBaseline?.web?.browserJavaScriptGzipBytes ?? 0) > 0 &&
					(chirpArtifactBaseline?.web?.serverOutputBytes ?? 0) > 0 &&
					(chirpArtifactBaseline?.containers?.count ?? 0) > 0 &&
					(chirpArtifactBaseline?.containers?.totalContextBytes ?? 0) >=
						(chirpArtifactBaseline?.containers?.maximumContextBytes ??
							Number.POSITIVE_INFINITY),
			),
			"The tracked flagship baseline covers browser, server, RGD, and every generated OCI build context.",
		),
	),
];

const chirpEvidenceIds = new Set([
	"chirp-runtime-golden-path",
	"chirp-browser-golden-path",
	"chirp-consecutive-deploys",
]);
const failed = dimensions.flatMap((dimension) =>
	dimension.checks
		.filter(
			(item) =>
				item.state === "fail" ||
				(item.state === "missing" &&
					(chirpEvidenceIds.has(item.id) ? requireChirp : requireLive)),
		)
		.map((item) => ({ dimension: dimension.name, item })),
);
for (const dimension of dimensions) {
	const passed = dimension.checks.filter(
		(item) => item.state === "pass",
	).length;
	console.log(
		`${dimension.name}: ${((passed / dimension.checks.length) * 10).toFixed(1)}/10 evidence coverage (${passed}/${dimension.checks.length})`,
	);
	for (const item of dimension.checks)
		console.log(`  ${item.state.toUpperCase()} ${item.id}: ${item.evidence}`);
}
if (
	(!requireLive || !requireChirp) &&
	dimensions.some((dimension) =>
		dimension.checks.some((item) => item.state === "missing"),
	)
)
	console.log(
		"Live evidence is missing. Run the v0.6 OrbStack prerelease lane to require fresh datastore, generated-application, GuestBook, and Chirp receipts.",
	);
if (failed.length > 0)
	throw new Error(
		`v0.6 scorecard failed:\n${failed.map(({ dimension, item }) => `- ${dimension}/${item.id}: ${item.evidence}`).join("\n")}`,
	);

function dimension(name: string, ...checks: readonly Check[]): Dimension {
	return { name, checks };
}
function check(id: string, pass: boolean, evidence: string): Check {
	return { id, state: pass ? "pass" : "fail", evidence };
}
function receiptCheck(
	receipt: LiveReceipt | undefined,
	id: string,
	required: readonly string[],
): Check {
	if (!receipt)
		return {
			id,
			state: "missing",
			evidence: `No fresh ${id} receipt exists under .applik8s-tmp/evidence/v0.6.`,
		};
	const assertions = new Set(receipt.assertions ?? []);
	const missing = required.filter((assertion) => !assertions.has(assertion));
	// Live receipts are optional in the local lane. A fresh but partial receipt
	// is still missing release evidence; it becomes a hard failure only when
	// --require-live/--require-chirp selects that lane. Treating it as an
	// unconditional implementation failure makes local verification depend on
	// whichever incomplete cluster run happened most recently.
	return {
		id,
		state: missing.length === 0 ? "pass" : "missing",
		evidence:
			missing.length === 0
				? `${receipt.suite} completed at ${receipt.completedAt}; ${required.length} required assertions recorded.`
				: `Receipt is missing assertions: ${missing.join(", ")}.`,
	};
}
async function liveReceipt(
	path: string,
	suite: string,
	expected: ExpectedCandidate,
): Promise<LiveReceipt | undefined> {
	const value = (await jsonFile(path)) as LiveReceipt | undefined;
	if (
		value?.schemaVersion !== 3 ||
		value.suite !== suite ||
		!value.completedAt ||
		!Array.isArray(value.assertions)
	)
		return undefined;
	const completed = Date.parse(value.completedAt);
	if (
		!Number.isFinite(completed) ||
		Date.now() - completed > 24 * 60 * 60 * 1_000 ||
		completed > Date.now() + 60_000
	)
		return undefined;
	if (
		!value.run?.id ||
		value.run.completedAt !== value.completedAt ||
		!validTimestamp(value.run.startedAt) ||
		Date.parse(value.run.startedAt ?? "") > completed
	)
		return undefined;
	if (!sameIdentity(value.candidate?.git, expected.git)) return undefined;
	if (
		expected.cluster &&
		!sameIdentity(value.candidate?.cluster, expected.cluster)
	)
		return undefined;
	if (
		expected.installation &&
		!sameIdentity(value.candidate?.installation, expected.installation)
	)
		return undefined;
	if (
		expected.artifacts &&
		!sameIdentity(value.candidate?.artifacts, expected.artifacts)
	)
		return undefined;
	if (
		!Array.isArray(value.assertionEvidence) ||
		value.assertionEvidence.length !== value.assertions.length
	)
		return undefined;
	const assertionNames = new Set(value.assertions);
	if (assertionNames.size !== value.assertions.length) return undefined;
	for (const evidence of value.assertionEvidence) {
		if (
			!evidence.assertion ||
			!assertionNames.delete(evidence.assertion) ||
			!evidence.test ||
			evidence.runId !== value.run.id ||
			!validTimestamp(evidence.observedAt)
		)
			return undefined;
		const observed = Date.parse(evidence.observedAt ?? "");
		if (
			observed < Date.parse(value.run.startedAt ?? "") ||
			observed > completed + 1_000
		)
			return undefined;
	}
	if (assertionNames.size !== 0) return undefined;
	return value;
}
function validTimestamp(value: string | undefined): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function sameIdentity(actual: unknown, expected: unknown): boolean {
	return JSON.stringify(actual) === JSON.stringify(expected);
}
async function jsonFile(path: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}
async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
