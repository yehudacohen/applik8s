import { execFileSync } from 'node:child_process';

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const sha = process.env.APPLIK8S_RELEASE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const maximumAgeDays = Number(process.env.APPLIK8S_LIVE_EVIDENCE_MAX_AGE_DAYS ?? '14');

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

console.log(`Verified exact-commit v0.4 live evidence: artifact ${artifact.id}, run ${run.html_url}, sha ${sha}.`);

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
  console.log('Exact-commit v0.4 live-evidence verifier self-test passed.');
}
