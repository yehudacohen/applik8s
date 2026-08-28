import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	v08ReleaseEvidenceContract,
	v08ReleaseEvidenceSuites,
} from "./v08-release-evidence-contract.mjs";

const releaseLine = "v0.8";
const maximumAgeDays = Number(
	process.env.APPLIK8S_LIVE_EVIDENCE_MAX_AGE_DAYS ?? "14",
);

if (process.argv.includes("--self-test")) {
	runSelfTest();
	process.exit(0);
}

const fileArgument = argumentValue("--file");
const requestedCommit = argumentValue("--commit");
const sha =
	requestedCommit ??
	process.env.APPLIK8S_RELEASE_SHA ??
	execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

if (fileArgument) {
	const evidence = JSON.parse(readFileSync(fileArgument, "utf8"));
	validateV08ReleaseEvidence(evidence, sha);
	console.log(`Validated exact-commit v0.8 live evidence for ${sha}.`);
	process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) {
	throw new Error(
		"Exact-commit v0.8 live-evidence verification requires GITHUB_REPOSITORY and GITHUB_TOKEN.",
	);
}

const artifactName = `applik8s-${releaseLine}-live-${sha}`;
const artifacts = await github(
	`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`,
);
const artifact = artifacts.artifacts?.find(
	(candidate) =>
		!candidate.expired &&
		candidate.name === artifactName &&
		candidate.workflow_run?.head_sha === sha,
);
if (!artifact) {
	throw new Error(
		`No unexpired ${artifactName} artifact proves the exact release commit. Run Release Evidence for ${sha} and retry without changing the commit.`,
	);
}
const run = await github(`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`);
if (
	run.head_sha !== sha ||
	run.event !== "workflow_dispatch" ||
	run.status !== "completed" ||
	run.conclusion !== "success" ||
	run.name !== "Release Evidence" ||
	run.path !== ".github/workflows/release-evidence.yml"
) {
	throw new Error(
		`Artifact ${artifact.id} is not attached to a successful manual Release Evidence run for ${sha}.`,
	);
}
const evidence = await downloadEvidence(artifact);
validateV08ReleaseEvidence(evidence, sha);
console.log(
	`Verified exact-commit v0.8 live evidence: artifact ${artifact.id}, run ${run.html_url}, sha ${sha}.`,
);

export function validateV08ReleaseEvidence(
	evidence,
	sha,
	now = Date.now(),
	maximumAge = maximumAgeDays,
) {
	if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
		throw new Error("v0.8 live evidence must be a JSON object.");
	}
	if (evidence.schemaVersion !== 1) {
		throw new Error("v0.8 live evidence schemaVersion must be 1.");
	}
	if (evidence.releaseLine !== releaseLine) {
		throw new Error("v0.8 live evidence releaseLine must be v0.8.");
	}
	if (evidence.commit !== sha) {
		throw new Error(
			`v0.8 live evidence commit ${evidence.commit ?? "<missing>"} does not match ${sha}.`,
		);
	}
	if (typeof evidence.execution !== "string" || !evidence.execution.trim()) {
		throw new Error("v0.8 live evidence must identify its aggregation execution.");
	}
	const generatedAt = Date.parse(evidence.generatedAt ?? "");
	if (
		!Number.isFinite(generatedAt) ||
		generatedAt > now + 60_000 ||
		now - generatedAt > maximumAge * 86_400_000
	) {
		throw new Error(
			`v0.8 live evidence is stale, future-dated, or older than ${maximumAge} days.`,
		);
	}
	if (!Array.isArray(evidence.receipts)) {
		throw new Error("v0.8 live evidence must contain suite receipts.");
	}
	const names = evidence.receipts.map((receipt) => receipt?.suite);
	assertExactStringSet(names, v08ReleaseEvidenceSuites, "suite receipts");
	for (const suite of v08ReleaseEvidenceSuites) {
		const receipt = evidence.receipts.find((candidate) => candidate.suite === suite);
		validateReceipt(receipt, suite, sha, generatedAt, now, maximumAge);
	}
	return evidence;
}

function validateReceipt(receipt, suite, sha, generatedAt, now, maximumAge) {
	if (receipt.commit !== sha) {
		throw new Error(`v0.8 ${suite} receipt does not identify the exact commit.`);
	}
	if (!receipt.environment || typeof receipt.environment !== "object") {
		throw new Error(`v0.8 ${suite} receipt has no environment identity.`);
	}
	for (const field of ["kind", "identity"]) {
		if (typeof receipt.environment[field] !== "string" || !receipt.environment[field].trim()) {
			throw new Error(`v0.8 ${suite} receipt environment lacks ${field}.`);
		}
	}
	if (!/^sha256:[a-f0-9]{64}$/u.test(receipt.sha256 ?? "")) {
		throw new Error(`v0.8 ${suite} receipt has no valid content digest.`);
	}
	const startedAt = Date.parse(receipt.startedAt ?? "");
	const completedAt = Date.parse(receipt.completedAt ?? "");
	if (
		!Number.isFinite(startedAt) ||
		!Number.isFinite(completedAt) ||
		completedAt < startedAt ||
		completedAt > now + 60_000 ||
		now - completedAt > maximumAge * 86_400_000 ||
		completedAt > generatedAt + 60_000
	) {
		throw new Error(`v0.8 ${suite} receipt has an invalid run interval.`);
	}
	assertExactStringSet(
		receipt.assertions,
		v08ReleaseEvidenceContract[suite],
		`${suite} assertions`,
	);
	if (receipt.cleanup?.verified !== true || receipt.cleanup?.leakedResources !== 0) {
		throw new Error(`v0.8 ${suite} receipt does not prove leak-free cleanup.`);
	}
	if (receipt.cost?.bounded !== true) {
		throw new Error(`v0.8 ${suite} receipt does not attest bounded cost.`);
	}
}

function assertExactStringSet(actual, expected, label) {
	if (
		!Array.isArray(actual) ||
		actual.some((value) => typeof value !== "string") ||
		new Set(actual).size !== actual.length ||
		actual.length !== expected.length ||
		!expected.every((value) => actual.includes(value))
	) {
		throw new Error(`v0.8 live evidence ${label} is incomplete or contains unrecognized values.`);
	}
}

async function github(path) {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${path} failed with ${response.status}: ${await response.text()}`);
	}
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
	if (!response.ok) {
		throw new Error(`Downloading v0.8 evidence artifact ${artifact.id} failed with ${response.status}.`);
	}
	const directory = mkdtempSync(join(tmpdir(), "applik8s-v08-live-evidence-"));
	const archive = join(directory, "evidence.zip");
	try {
		writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
		return JSON.parse(
			execFileSync("unzip", ["-p", archive, "applik8s-v0.8-live-evidence.json"], {
				encoding: "utf8",
			}),
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
	return value;
}

function runSelfTest() {
	const now = Date.parse("2026-08-27T12:00:00.000Z");
	const sha = "a".repeat(40);
	const evidence = {
		schemaVersion: 1,
		releaseLine,
		commit: sha,
		execution: "local://v0.8-release-aggregation",
		generatedAt: new Date(now).toISOString(),
		receipts: v08ReleaseEvidenceSuites.map((suite, index) => ({
			suite,
			commit: sha,
			environment: { kind: suite, identity: `fixture-${index}` },
			startedAt: new Date(now - 120_000).toISOString(),
			completedAt: new Date(now - 60_000).toISOString(),
			sha256: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
			assertions: v08ReleaseEvidenceContract[suite],
			cleanup: { verified: true, leakedResources: 0 },
			cost: { bounded: true },
		})),
	};
	validateV08ReleaseEvidence(evidence, sha, now, 14);
	for (const invalid of [
		{ ...evidence, commit: "b".repeat(40) },
		{ ...evidence, receipts: evidence.receipts.slice(1) },
		{
			...evidence,
			receipts: evidence.receipts.map((receipt, index) =>
				index === 0 ? { ...receipt, assertions: receipt.assertions.slice(1) } : receipt,
			),
		},
		{
			...evidence,
			receipts: evidence.receipts.map((receipt, index) =>
				index === 0 ? { ...receipt, cleanup: { verified: false, leakedResources: 1 } } : receipt,
			),
		},
	]) {
		let rejected = false;
		try {
			validateV08ReleaseEvidence(invalid, sha, now, 14);
		} catch {
			rejected = true;
		}
		if (!rejected) throw new Error("v0.8 evidence verifier accepted an invalid fixture.");
	}
	console.log("v0.8 live evidence verifier self-test passed.");
}
