import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const fileArgument = argumentValue('--file');
const requestedCommit = argumentValue('--commit');
const maximumAgeDays = Number(process.env.APPLIK8S_LIVE_EVIDENCE_MAX_AGE_DAYS ?? '14');
if (fileArgument) {
  const evidence = JSON.parse(readFileSync(fileArgument, 'utf8'));
  validateEvidence(evidence, requestedCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  console.log(`Validated maintainer-run exact-commit v0.4 live evidence for ${evidence.commit}.`);
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const sha = process.env.APPLIK8S_RELEASE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

if (!repository || !token) {
  throw new Error('Exact-commit live-evidence verification requires GITHUB_REPOSITORY and GITHUB_TOKEN. Run it in the release workflow.');
}

const artifactName = `applik8s-v0.4-live-${sha}`;
const artifacts = await github(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`);
const artifact = matchingArtifact(artifacts.artifacts, artifactName, sha);
if (!artifact) {
  throw new Error(`No unexpired ${artifactName} artifact proves the exact release commit. Run Release Evidence with run_live_e2e=true on ${sha}, then retry the tag/recovery workflow without changing the commit.`);
}

const run = await github(`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`);
if (!successfulEvidenceRun(run, sha)) {
  throw new Error(`Artifact ${artifact.id} is not attached to a successful manual Release Evidence run for ${sha}.`);
}
const ageMs = Date.now() - new Date(artifact.created_at).getTime();
if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumAgeDays * 86_400_000) {
  throw new Error(`Live evidence artifact ${artifact.id} is older than the ${maximumAgeDays}-day release window.`);
}

const evidence = await downloadEvidence(artifact);
validateEvidence(evidence, sha);

console.log(`Verified exact-commit v0.4 live evidence: artifact ${artifact.id}, run ${run.html_url}, sha ${sha}.`);

export function validateEvidence(evidence, sha, now = Date.now(), maximumAge = maximumAgeDays) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Live evidence must be a JSON object.');
  if (evidence.schemaVersion !== 1) throw new Error('Live evidence schemaVersion must be 1.');
  if (evidence.releaseLine !== 'v0.4') throw new Error('Live evidence releaseLine must be v0.4.');
  if (evidence.commit !== sha) throw new Error(`Live evidence commit ${evidence.commit ?? '<missing>'} does not match ${sha}.`);
  if (evidence.suite !== 'check:v04:prerelease') throw new Error('Live evidence suite must be check:v04:prerelease.');
  if (typeof evidence.context !== 'string' || evidence.context.trim().length === 0) throw new Error('Live evidence must name the tested Kubernetes context.');
  if (typeof evidence.execution !== 'string' || evidence.execution.trim().length === 0) throw new Error('Live evidence must identify the execution that produced it.');
  const generatedAt = new Date(evidence.generatedAt).getTime();
  const evidenceAgeMs = now - generatedAt;
  if (!Number.isFinite(evidenceAgeMs) || evidenceAgeMs < 0 || evidenceAgeMs > maximumAge * 86_400_000) {
    throw new Error(`Live evidence is older than the ${maximumAge}-day release window.`);
  }
  return evidence;
}

export function matchingArtifact(artifacts, name, sha) {
  return artifacts?.find((candidate) => !candidate.expired && candidate.name === name && candidate.workflow_run?.head_sha === sha);
}

export function successfulEvidenceRun(run, sha) {
  return run.head_sha === sha && run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' && run.name === 'Release Evidence' && run.path === '.github/workflows/release-evidence.yml';
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path} failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function downloadEvidence(artifact) {
  const response = await fetch(artifact.archive_download_url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`Downloading live evidence artifact ${artifact.id} failed with ${response.status}: ${await response.text()}`);
  const directory = mkdtempSync(join(tmpdir(), 'applik8s-live-evidence-'));
  const archive = join(directory, 'evidence.zip');
  try {
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const json = execFileSync('unzip', ['-p', archive, 'applik8s-v0.4-live-evidence.json'], { encoding: 'utf8' });
    return JSON.parse(json);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function runSelfTest() {
  const sha = 'a'.repeat(40);
  const name = `applik8s-v0.4-live-${sha}`;
  const valid = { id: 1, name, expired: false, workflow_run: { id: 2, head_sha: sha } };
  const invalid = [
    { ...valid, expired: true },
    { ...valid, name: 'applik8s-v0.4-live-other' },
    { ...valid, workflow_run: { id: 2, head_sha: 'b'.repeat(40) } },
  ];
  if (matchingArtifact([...invalid, valid], name, sha) !== valid) throw new Error('Artifact selection self-test failed.');
  const run = { head_sha: sha, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', name: 'Release Evidence', path: '.github/workflows/release-evidence.yml' };
  if (!successfulEvidenceRun(run, sha)) throw new Error('Successful run self-test failed.');
  for (const field of ['head_sha', 'event', 'status', 'conclusion', 'name', 'path']) {
    if (successfulEvidenceRun({ ...run, [field]: 'invalid' }, sha)) throw new Error(`Run rejection self-test failed for ${field}.`);
  }
  const now = Date.now();
  const evidence = { schemaVersion: 1, releaseLine: 'v0.4', commit: sha, context: 'orbstack', suite: 'check:v04:prerelease', execution: 'local://orbstack/test', generatedAt: new Date(now).toISOString() };
  validateEvidence(evidence, sha, now, 14);
  for (const invalidEvidence of [
    { ...evidence, commit: 'b'.repeat(40) },
    { ...evidence, suite: 'check:other' },
    { ...evidence, generatedAt: new Date(now - 15 * 86_400_000).toISOString() },
  ]) {
    try {
      validateEvidence(invalidEvidence, sha, now, 14);
      throw new Error('Evidence rejection self-test failed.');
    } catch (error) {
      if (error instanceof Error && error.message === 'Evidence rejection self-test failed.') throw error;
    }
  }
  console.log('Exact-commit v0.4 live-evidence verifier self-test passed.');
}
