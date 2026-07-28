import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	v06ClusterEvidenceSuites,
	v06ReleaseEvidenceContract,
} from "./v06-release-evidence-contract.mjs";

const commit =
	process.env.GITHUB_SHA ??
	execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const context = required(
	process.env.APPLIK8S_E2E_CONTEXT,
	"APPLIK8S_E2E_CONTEXT",
);
const output = resolve(
	argumentValue("--out") ?? "dist/applik8s-v0.6-live-evidence.json",
);
const evidenceDirectory = resolve(
	argumentValue("--evidence-dir") ?? ".applik8s-tmp/evidence/v0.6",
);
const execution =
	process.env.APPLIK8S_EVIDENCE_EXECUTION ??
	(process.env.GITHUB_SERVER_URL &&
	process.env.GITHUB_REPOSITORY &&
	process.env.GITHUB_RUN_ID
		? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
		: `local-maintainer:${context}`);

const suites = [];
for (const [suite, requiredAssertions] of Object.entries(
	v06ReleaseEvidenceContract,
)) {
	const path = join(evidenceDirectory, `${suite}.json`);
	const bytes = readFileSync(path);
	const receipt = JSON.parse(bytes.toString("utf8"));
	validateReceipt(receipt, suite, requiredAssertions);
	suites.push({
		suite,
		receiptSchemaVersion: 3,
		completedAt: receipt.completedAt,
		sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
		assertions: [...receipt.assertions].sort(),
	});
}

const attestation = {
	schemaVersion: 2,
	releaseLine: "v0.6",
	commit,
	execution,
	context,
	suite: "check:v06:prerelease",
	generatedAt: new Date().toISOString(),
	gates: [
		"check:v06:local",
		"test:v06:datastores-live",
		"test:v06:live",
		"deploy:v06:chirp-twice",
		"test:v06:chirp-live",
		"test:v06:chirp-browser",
		"check:v06:scorecard --require-live --require-chirp",
	],
	suites,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(attestation, null, 2)}\n`, {
	mode: 0o600,
});
console.log(
	`Wrote complete v0.6 exact-commit live evidence for ${commit} to ${output}.`,
);

function validateReceipt(receipt, suite, requiredAssertions) {
	if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
		throw new Error(`${suite} evidence is not an object.`);
	if (receipt.schemaVersion !== 3 || receipt.suite !== suite)
		throw new Error(`${suite} evidence is not a schema-v3 ${suite} receipt.`);
	if (
		receipt.candidate?.git?.commit !== commit ||
		receipt.candidate?.git?.dirty !== false
	) {
		throw new Error(
			`${suite} evidence is not bound to clean exact commit ${commit}.`,
		);
	}
	if (
		v06ClusterEvidenceSuites.includes(suite) &&
		receipt.candidate?.cluster?.context !== context
	) {
		throw new Error(
			`${suite} evidence is not bound to Kubernetes context ${context}.`,
		);
	}
	if (!Array.isArray(receipt.assertions))
		throw new Error(`${suite} evidence has no assertion list.`);
	const assertions = new Set(receipt.assertions);
	const missing = requiredAssertions.filter(
		(assertion) => !assertions.has(assertion),
	);
	if (missing.length > 0)
		throw new Error(
			`${suite} evidence is missing assertions: ${missing.join(", ")}.`,
		);
	if (
		!Array.isArray(receipt.assertionEvidence) ||
		receipt.assertionEvidence.length !== receipt.assertions.length
	) {
		throw new Error(`${suite} evidence has incomplete assertion provenance.`);
	}
	const assertionEvidence = new Map();
	for (const evidence of receipt.assertionEvidence) {
		if (
			!evidence ||
			typeof evidence !== "object" ||
			typeof evidence.assertion !== "string" ||
			typeof evidence.test !== "string" ||
			!evidence.test.trim() ||
			evidence.runId !== receipt.run?.id ||
			!Number.isFinite(Date.parse(evidence.observedAt ?? "")) ||
			assertionEvidence.has(evidence.assertion)
		) {
			throw new Error(`${suite} evidence has invalid assertion provenance.`);
		}
		assertionEvidence.set(evidence.assertion, evidence);
	}
	if (
		receipt.assertions.some((assertion) => !assertionEvidence.has(assertion))
	) {
		throw new Error(`${suite} evidence does not prove every asserted result.`);
	}
	const completedAt = Date.parse(receipt.completedAt);
	if (
		!Number.isFinite(completedAt) ||
		Date.now() - completedAt > 24 * 60 * 60 * 1_000 ||
		completedAt > Date.now() + 60_000
	) {
		throw new Error(`${suite} evidence is stale or future-dated.`);
	}
}

function required(value, name) {
	if (!value?.trim()) throw new Error(`${name} is required.`);
	return value.trim();
}

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${name} requires a value.`);
	return value;
}
