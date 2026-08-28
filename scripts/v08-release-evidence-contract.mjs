export const v08ReleaseEvidenceContract = Object.freeze({
	"real-aws": Object.freeze([
		"aws-create-update-drift-delete",
		"aws-iam-network-encryption",
		"aws-bounded-cost-and-cleanup",
		"provider-guarantees-real-aws",
		"runtime-access-allow-deny-no-wildcards",
		"cloudwatch-causal-telemetry-redaction",
		"eventbridge-recurring-one-time-retry-dlq-drift",
		"athena-glue-s3-publication-query-cancellation-retention",
	]),
	"kubernetes-cilium": Object.freeze([
		"per-execution-service-account-and-secret-projection",
		"declared-peer-and-dns-access",
		"sibling-secret-wrong-port-and-wrong-host-denial",
		"pod-restart-policy-continuity",
		"policy-drift-repair",
		"uid-safe-owned-cleanup",
	]),
	"kubernetes-platform": Object.freeze([
		"clickstack-causal-telemetry-redaction",
		"cronjob-and-job-exact-scheduled-time",
		"hatchet-fixed-dynamic-one-time-recovery",
		"celld-fleet-create-update-node-loss-restore",
		"celld-operator-restart-upgrade-rollback-finalization",
		"retained-actor-data-and-leak-free-teardown",
	]),
	"celld-operator-image": Object.freeze([
		"exact-commit-image",
		"immutable-manifest-digest",
		"linux-amd64",
		"linux-arm64",
		"anonymous-pull-verification",
	]),
	"agentic-product-browser": Object.freeze([
		"fresh-packed-generated-product",
		"historical-usage-publication",
		"immutable-duckdb-query",
		"browser-transport-and-authoritative-render",
		"workspace-admission-isolation",
		"graph-backed-cleanup",
	]),
});

export const v08ReleaseEvidenceSuites = Object.freeze(
	Object.keys(v08ReleaseEvidenceContract),
);
