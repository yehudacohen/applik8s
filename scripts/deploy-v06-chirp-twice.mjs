import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
	collectV06ArtifactIdentity,
	collectV06ClusterIdentity,
	collectV06GitIdentity,
	collectV06InstallationIdentity,
	createV06AssertionEvidence,
	discardV06Evidence,
	writeV06EvidenceReceipt,
} from "./v06-evidence.ts";

const run = promisify(execFile);
const context = process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack";
const namespace =
	process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? "chirp-control";
const instance = process.env.APPLIK8S_CHIRP_INSTANCE ?? "chirp";
const evidencePath = ".applik8s-tmp/evidence/v0.6/chirp-deployment.json";
const startedAt = new Date().toISOString();
const runId = randomUUID();
await discardV06Evidence(evidencePath);

await deploy();
const first = await candidate();
await deploy();
const second = await candidate();
if (first.installation.uid !== second.installation.uid)
	throw new Error(
		"The second Chirp deploy replaced the installation instead of converging it in place.",
	);
if (JSON.stringify(first.artifacts) !== JSON.stringify(second.artifacts))
	throw new Error(
		`The second Chirp deploy changed immutable application artifact identity: ${JSON.stringify({ first: first.artifacts, second: second.artifacts })}`,
	);

const completedAt = new Date().toISOString();
await writeV06EvidenceReceipt(evidencePath, {
	suite: "chirp-deployment",
	run: { id: runId, startedAt, completedAt },
	candidate: second,
	environment: {
		context,
		namespace,
		installation: instance,
		firstGeneration: first.installation.generation,
		secondGeneration: second.installation.generation,
	},
	assertionEvidence: createV06AssertionEvidence(
		[
			"first-deploy",
			"second-idempotent-deploy",
			"installation-uid-preserved",
			"artifact-identity-preserved",
		].map((assertion) => ({
			assertion,
			test: "Chirp consecutive deployment convergence",
			observedAt: completedAt,
		})),
		runId,
	),
});

async function deploy() {
	await execute([
		"run",
		"--cwd",
		"examples/chirp-start",
		"deploy:local",
	]);
}

async function candidate() {
	const [git, cluster, installation, artifacts] = await Promise.all([
		collectV06GitIdentity(),
		collectV06ClusterIdentity(context),
		collectV06InstallationIdentity({
			context,
			resource: `chirpinstallation/${instance}`,
			namespace,
		}),
		collectV06ArtifactIdentity(
			"examples/chirp-start/.applik8s/deploy/typekro/application-image-evidence.json",
		),
	]);
	return { git, cluster, installation, artifacts };
}

async function execute(args) {
	const child = run("bun", args, {
		cwd: process.cwd(),
		env: process.env,
		maxBuffer: 100 * 1024 * 1024,
	});
	const result = await child;
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
}
