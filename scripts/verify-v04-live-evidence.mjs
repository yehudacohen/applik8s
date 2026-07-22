import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v06ReleaseEvidenceContract } from "./v06-release-evidence-contract.mjs";

const releaseLine = process.env.APPLIK8S_RELEASE_LINE ?? "v0.4";
const releaseLane = releaseLine.replace(".", "");

if (process.argv.includes("--self-test")) {
	runSelfTest();
	process.exit(0);
}

const fileArgument = argumentValue("--file");
const requestedCommit = argumentValue("--commit");
const maximumAgeDays = Number(
	process.env.APPLIK8S_LIVE_EVIDENCE_MAX_AGE_DAYS ?? "14",
);
if (fileArgument) {
	const evidence = JSON.parse(readFileSync(fileArgument, "utf8"));
	validateEvidence(
		evidence,
		requestedCommit ??
			execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	);
	console.log(
		`Validated maintainer-run exact-commit ${releaseLine} live evidence for ${evidence.commit}.`,
	);
	process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const sha =
	process.env.APPLIK8S_RELEASE_SHA ??
	execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

if (!repository || !token) {
	throw new Error(
		"Exact-commit live-evidence verification requires GITHUB_REPOSITORY and GITHUB_TOKEN. Run it in the release workflow.",
	);
}

const artifactName = `applik8s-${releaseLine}-live-${sha}`;
const artifacts = await github(
	`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`,
);
const artifact = matchingArtifact(artifacts.artifacts, artifactName, sha);
if (!artifact) {
	throw new Error(
		`No unexpired ${artifactName} artifact proves the exact release commit. Run Release Evidence with run_live_e2e=true on ${sha}, then retry the tag/recovery workflow without changing the commit.`,
	);
}

const run = await github(
	`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`,
);
if (!successfulEvidenceRun(run, sha)) {
	throw new Error(
		`Artifact ${artifact.id} is not attached to a successful manual Release Evidence run for ${sha}.`,
	);
}
const ageMs = Date.now() - new Date(artifact.created_at).getTime();
if (
	!Number.isFinite(ageMs) ||
	ageMs < 0 ||
	ageMs > maximumAgeDays * 86_400_000
) {
	throw new Error(
		`Live evidence artifact ${artifact.id} is older than the ${maximumAgeDays}-day release window.`,
	);
}

const evidence = await downloadEvidence(artifact);
validateEvidence(evidence, sha);

console.log(
	`Verified exact-commit ${releaseLine} live evidence: artifact ${artifact.id}, run ${run.html_url}, sha ${sha}.`,
);

export function validateEvidence(
	evidence,
	sha,
	now = Date.now(),
	maximumAge = maximumAgeDays,
) {
	if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
		throw new Error("Live evidence must be a JSON object.");
	if (releaseLine === "v0.6") validateV06Evidence(evidence, now, maximumAge);
	else if (evidence.schemaVersion !== 1)
		throw new Error("Live evidence schemaVersion must be 1.");
	if (evidence.releaseLine !== releaseLine)
		throw new Error(`Live evidence releaseLine must be ${releaseLine}.`);
	if (evidence.commit !== sha)
		throw new Error(
			`Live evidence commit ${evidence.commit ?? "<missing>"} does not match ${sha}.`,
		);
	if (evidence.suite !== `check:${releaseLane}:prerelease`)
		throw new Error(
			`Live evidence suite must be check:${releaseLane}:prerelease.`,
		);
	if (
		typeof evidence.context !== "string" ||
		evidence.context.trim().length === 0
	)
		throw new Error("Live evidence must name the tested Kubernetes context.");
	if (
		typeof evidence.execution !== "string" ||
		evidence.execution.trim().length === 0
	)
		throw new Error(
			"Live evidence must identify the execution that produced it.",
		);
	const generatedAt = new Date(evidence.generatedAt).getTime();
	const evidenceAgeMs = now - generatedAt;
	if (
		!Number.isFinite(evidenceAgeMs) ||
		evidenceAgeMs < 0 ||
		evidenceAgeMs > maximumAge * 86_400_000
	) {
		throw new Error(
			`Live evidence is older than the ${maximumAge}-day release window.`,
		);
	}
	return evidence;
}

function validateV06Evidence(evidence, now, maximumAge) {
	if (evidence.schemaVersion !== 2)
		throw new Error("v0.6 live evidence schemaVersion must be 2.");
	const requiredGates = [
		"check:v06:local",
		"test:v06:datastores-live",
		"test:v06:live",
		"test:v06:provider-migration-live",
		"deploy:v06:chirp-twice",
		"test:v06:chirp-live",
		"test:v06:chirp-browser",
		"check:v06:scorecard --require-live --require-chirp",
	];
	if (!exactStringSet(evidence.gates, requiredGates)) {
		throw new Error(
			"v0.6 live evidence does not attest the complete prerelease gate sequence.",
		);
	}
	if (!Array.isArray(evidence.suites))
		throw new Error("v0.6 live evidence must contain bound suite receipts.");
	const requiredSuites = Object.keys(v06ReleaseEvidenceContract);
	const suiteNames = evidence.suites.map((suite) => suite?.suite);
	if (!exactStringSet(suiteNames, requiredSuites)) {
		throw new Error(
			"v0.6 live evidence must contain each required suite exactly once and no unrecognized suites.",
		);
	}
	const suites = new Map(evidence.suites.map((suite) => [suite.suite, suite]));
	for (const [name, requiredAssertions] of Object.entries(
		v06ReleaseEvidenceContract,
	)) {
		const suite = suites.get(name);
		if (suite?.receiptSchemaVersion !== 3)
			throw new Error(
				`v0.6 live evidence is missing its schema-v3 ${name} receipt.`,
			);
		if (!/^sha256:[a-f0-9]{64}$/.test(suite.sha256 ?? ""))
			throw new Error(`v0.6 ${name} receipt has no valid content digest.`);
		const completedAt = Date.parse(suite.completedAt ?? "");
		if (!Number.isFinite(completedAt))
			throw new Error(`v0.6 ${name} receipt has no completion timestamp.`);
		if (
			completedAt > now + 60_000 ||
			now - completedAt > maximumAge * 86_400_000
		) {
			throw new Error(`v0.6 ${name} receipt is stale or future-dated.`);
		}
		if (!exactStringSet(suite.assertions, requiredAssertions))
			throw new Error(
				`v0.6 ${name} receipt must attest each required assertion exactly once and no unrecognized assertions.`,
			);
	}
}

function exactStringSet(actual, expected) {
	if (
		!Array.isArray(actual) ||
		actual.some((value) => typeof value !== "string") ||
		new Set(actual).size !== actual.length ||
		actual.length !== expected.length
	)
		return false;
	const values = new Set(actual);
	return expected.every((value) => values.has(value));
}

export function matchingArtifact(artifacts, name, sha) {
	return artifacts?.find(
		(candidate) =>
			!candidate.expired &&
			candidate.name === name &&
			candidate.workflow_run?.head_sha === sha,
	);
}

export function successfulEvidenceRun(run, sha) {
	return (
		run.head_sha === sha &&
		run.event === "workflow_dispatch" &&
		run.status === "completed" &&
		run.conclusion === "success" &&
		run.name === "Release Evidence" &&
		run.path === ".github/workflows/release-evidence.yml"
	);
}

async function github(path) {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok)
		throw new Error(
			`GitHub API ${path} failed with ${response.status}: ${await response.text()}`,
		);
	return response.json();
}

async function downloadEvidence(artifact) {
	const response = await fetch(artifact.archive_download_url, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok)
		throw new Error(
			`Downloading live evidence artifact ${artifact.id} failed with ${response.status}: ${await response.text()}`,
		);
	const directory = mkdtempSync(join(tmpdir(), "applik8s-live-evidence-"));
	const archive = join(directory, "evidence.zip");
	try {
		writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
		const json = execFileSync(
			"unzip",
			["-p", archive, `applik8s-${releaseLine}-live-evidence.json`],
			{ encoding: "utf8" },
		);
		return JSON.parse(json);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${name} requires a value.`);
	return value;
}

function runSelfTest() {
	const sha = "a".repeat(40);
	const name = `applik8s-${releaseLine}-live-${sha}`;
	const valid = {
		id: 1,
		name,
		expired: false,
		workflow_run: { id: 2, head_sha: sha },
	};
	const invalid = [
		{ ...valid, expired: true },
		{ ...valid, name: `applik8s-${releaseLine}-live-other` },
		{ ...valid, workflow_run: { id: 2, head_sha: "b".repeat(40) } },
	];
	if (matchingArtifact([...invalid, valid], name, sha) !== valid)
		throw new Error("Artifact selection self-test failed.");
	const run = {
		head_sha: sha,
		event: "workflow_dispatch",
		status: "completed",
		conclusion: "success",
		name: "Release Evidence",
		path: ".github/workflows/release-evidence.yml",
	};
	if (!successfulEvidenceRun(run, sha))
		throw new Error("Successful run self-test failed.");
	for (const field of [
		"head_sha",
		"event",
		"status",
		"conclusion",
		"name",
		"path",
	]) {
		if (successfulEvidenceRun({ ...run, [field]: "invalid" }, sha))
			throw new Error(`Run rejection self-test failed for ${field}.`);
	}
	const now = Date.now();
	const evidence =
		releaseLine === "v0.6"
			? {
					schemaVersion: 2,
					releaseLine,
					commit: sha,
					context: "orbstack",
					suite: `check:${releaseLane}:prerelease`,
					execution: "local://orbstack/test",
					generatedAt: new Date(now).toISOString(),
					gates: [
						"check:v06:local",
						"test:v06:datastores-live",
						"test:v06:live",
						"test:v06:provider-migration-live",
						"deploy:v06:chirp-twice",
						"test:v06:chirp-live",
						"test:v06:chirp-browser",
						"check:v06:scorecard --require-live --require-chirp",
					],
					suites: Object.entries(v06ReleaseEvidenceContract).map(
						([suite, assertions]) => ({
							suite,
							receiptSchemaVersion: 3,
							completedAt: new Date(now).toISOString(),
							sha256: `sha256:${"a".repeat(64)}`,
							assertions,
						}),
					),
				}
			: {
					schemaVersion: 1,
					releaseLine,
					commit: sha,
					context: "orbstack",
					suite: `check:${releaseLane}:prerelease`,
					execution: "local://orbstack/test",
					generatedAt: new Date(now).toISOString(),
				};
	validateEvidence(evidence, sha, now, 14);
	for (const invalidEvidence of [
		{ ...evidence, commit: "b".repeat(40) },
		{ ...evidence, suite: "check:other" },
		{ ...evidence, generatedAt: new Date(now - 15 * 86_400_000).toISOString() },
	]) {
		try {
			validateEvidence(invalidEvidence, sha, now, 14);
			throw new Error("Evidence rejection self-test failed.");
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === "Evidence rejection self-test failed."
			)
				throw error;
		}
	}
	if (releaseLine === "v0.6") {
		const firstSuite = evidence.suites[0];
		const malformed = [
			{ ...evidence, gates: [...evidence.gates, evidence.gates[0]] },
			{ ...evidence, suites: [...evidence.suites, firstSuite] },
			{
				...evidence,
				suites: evidence.suites.map((suite, index) =>
					index === 0
						? {
								...suite,
								completedAt: new Date(now - 15 * 86_400_000).toISOString(),
							}
						: suite,
				),
			},
			{
				...evidence,
				suites: evidence.suites.map((suite, index) =>
					index === 0
						? { ...suite, assertions: [...suite.assertions, "invented"] }
						: suite,
				),
			},
		];
		for (const invalidEvidence of malformed) {
			try {
				validateEvidence(invalidEvidence, sha, now, 14);
				throw new Error("v0.6 receipt rejection self-test failed.");
			} catch (error) {
				if (
					error instanceof Error &&
					error.message === "v0.6 receipt rejection self-test failed."
				)
					throw error;
			}
		}
	}
	console.log(
		`Exact-commit ${releaseLine} live-evidence verifier self-test passed.`,
	);
}
