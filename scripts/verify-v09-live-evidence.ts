// typecast-file-boundary: GitHub artifact metadata and release receipts are
// untrusted JSON until this exact-candidate verifier validates every field.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  V06ClusterIdentity,
  V06EvidenceReceipt,
  V06GitIdentity,
} from './v06-evidence.js';
import { validateV09ReleaseReceipt } from './check-v09-live-evidence.js';
import {
  v09EvidenceEnvironment,
  v09ReleaseEvidenceContract,
  v09ReleaseEvidenceSuites,
} from './v09-release-evidence-contract.js';

interface AggregateEvidence {
  readonly schemaVersion: 1;
  readonly releaseLine: 'v0.9';
  readonly commit: string;
  readonly execution: string;
  readonly generatedAt: string;
  readonly receipts: readonly V06EvidenceReceipt[];
}

const maximumAgeMs = Number(
  process.env.APPLIK8S_LIVE_EVIDENCE_MAX_AGE_DAYS ?? '14',
) * 86_400_000;

if (import.meta.main) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const requestedCommit = argumentValue('--commit');
    const commit = requestedCommit
      ?? process.env.APPLIK8S_RELEASE_SHA
      ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const file = argumentValue('--file');
    const evidence = file
      ? decodeAggregate(readFileSync(file, 'utf8'))
      : await downloadGitHubEvidence(commit);
    const findings = validateV09AggregateEvidence(evidence, commit);
    if (findings.length > 0) {
      throw new Error(`v0.9 exact-candidate live evidence failed:\n${findings.map(finding => `- ${finding}`).join('\n')}`);
    }
    console.log(`Validated exact-commit v0.9 live evidence for ${commit}.`);
  }
}

export function validateV09AggregateEvidence(
  evidence: AggregateEvidence,
  commit: string,
  now = Date.now(),
): readonly string[] {
  const findings: string[] = [];
  if (evidence.schemaVersion !== 1 || evidence.releaseLine !== 'v0.9') {
    findings.push('aggregate identity must be applik8s v0.9 schemaVersion 1.');
  }
  if (evidence.commit !== commit) findings.push('aggregate commit does not match the release candidate.');
  if (!evidence.execution?.trim()) findings.push('aggregate evidence has no execution identity.');
  const generatedAt = Date.parse(evidence.generatedAt);
  if (!Number.isFinite(generatedAt) || generatedAt > now + 60_000 || now - generatedAt > maximumAgeMs) {
    findings.push('aggregate evidence is stale or has an invalid generation time.');
  }
  const suites = evidence.receipts.map(receipt => receipt.suite);
  if (
    new Set(suites).size !== suites.length
    || suites.length !== v09ReleaseEvidenceSuites.length
    || !v09ReleaseEvidenceSuites.every(suite => suites.includes(suite))
  ) findings.push('aggregate evidence does not contain the exact required suite set.');

  const candidateGit = evidence.receipts[0]?.candidate.git;
  if (!candidateGit || candidateGit.commit !== commit || candidateGit.dirty) {
    findings.push('suite receipts must identify the exact clean release commit.');
  }
  const cluster = evidence.receipts.find(receipt =>
    v09EvidenceEnvironment(receipt.suite) === 'kubernetes'
  )?.candidate.cluster;
  for (const suite of v09ReleaseEvidenceSuites) {
    const receipt = evidence.receipts.find(candidate => candidate.suite === suite);
    findings.push(...validateV09ReleaseReceipt({
      receipt,
      suite,
      requiredAssertions: v09ReleaseEvidenceContract[suite] ?? [],
      expectedGit: candidateGit ?? missingGit,
      expectedCluster: v09EvidenceEnvironment(suite) === 'kubernetes'
        ? cluster ?? missingCluster
        : undefined,
      now,
      path: `aggregate:${suite}`,
    }));
  }
  return findings;
}

function decodeAggregate(source: string): AggregateEvidence {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('v0.9 aggregate evidence must be a JSON object.');
  }
  return value as AggregateEvidence;
}

async function downloadGitHubEvidence(commit: string): Promise<AggregateEvidence> {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    throw new Error('GitHub evidence lookup requires GITHUB_REPOSITORY and GITHUB_TOKEN.');
  }
  const artifactName = `applik8s-v0.9-live-${commit}`;
  const listing = await github(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`, token);
  const artifacts = Array.isArray(listing.artifacts)
    ? listing.artifacts.map(objectValue).filter(candidate => candidate !== undefined)
    : [];
  const artifact = artifacts.find(candidate =>
    candidate.name === artifactName
    && candidate.expired !== true
    && objectValue(candidate.workflow_run)?.head_sha === commit
  );
  if (!artifact) throw new Error(`No unexpired ${artifactName} artifact proves the exact release commit.`);
  const workflow = await github(`/repos/${repository}/actions/runs/${objectValue(artifact.workflow_run)?.id}`, token);
  if (
    workflow.head_sha !== commit
    || workflow.event !== 'workflow_dispatch'
    || workflow.status !== 'completed'
    || workflow.conclusion !== 'success'
    || workflow.path !== '.github/workflows/release-evidence.yml'
  ) throw new Error('v0.9 evidence artifact is not attached to a successful manual Release Evidence run.');

  const response = await fetch(String(artifact.archive_download_url), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`Downloading v0.9 evidence failed with HTTP ${response.status}.`);
  const directory = mkdtempSync(join(tmpdir(), 'applik8s-v09-live-evidence-'));
  const archive = join(directory, 'evidence.zip');
  try {
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    return decodeAggregate(execFileSync('unzip', ['-p', archive, 'applik8s-v0.9-live-evidence.json'], { encoding: 'utf8' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function github(path: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path} failed with HTTP ${response.status}.`);
  return await response.json() as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function selfTest(): void {
  const now = Date.parse('2026-09-02T12:00:00.000Z');
  const commit = 'a'.repeat(40);
  const git = { commit, dirty: false, workingTreeDigest: `sha256:${'b'.repeat(64)}` } satisfies V06GitIdentity;
  const cluster = { context: 'orbstack', uid: 'fixture-cluster' } satisfies V06ClusterIdentity;
  const receipts = v09ReleaseEvidenceSuites.map((suite, index) => {
    const completedAt = new Date(now - 60_000).toISOString();
    const assertions = v09ReleaseEvidenceContract[suite] ?? [];
    const environmentKind = v09EvidenceEnvironment(suite);
    const receipt = {
      schemaVersion: 3,
      suite,
      run: { id: `run-${index}`, startedAt: new Date(now - 120_000).toISOString(), completedAt },
      completedAt,
      candidate: {
        git,
        ...(environmentKind === 'kubernetes' ? { cluster } : {}),
      },
      environment: environmentKind === 'aws'
        ? {
            kind: environmentKind,
            accountId: '123456789012',
            region: 'us-east-1',
            maxEstimatedCostUsd: 0.01,
            expiresAt: new Date(now + 60_000).toISOString(),
          }
        : { kind: environmentKind },
      assertions,
      assertionEvidence: assertions.map(assertion => ({ assertion, test: `fixture ${assertion}`, runId: `run-${index}`, observedAt: completedAt })),
      ...(suite === 'aws-core-smoke'
        ? {
            teardown: { complete: true, authority: 'createApplicationAwsDeployment.destroy' },
            inventory: [
              { type: 'AWS.Kinesis.Stream' },
              { type: 'AWS.S3.Bucket' },
              { type: 'AWS.SQS.Queue' },
            ],
          }
        : {}),
      ...(suite === 'v09-clean-context-review'
        ? { review: { context: 'fresh', conversationHistory: 'none', findings: [] } }
        : {}),
    };
    return receipt as V06EvidenceReceipt;
  });
  const evidence: AggregateEvidence = {
    schemaVersion: 1,
    releaseLine: 'v0.9',
    commit,
    execution: 'local://self-test',
    generatedAt: new Date(now).toISOString(),
    receipts,
  };
  if (validateV09AggregateEvidence(evidence, commit, now).length > 0) throw new Error('valid v0.9 evidence fixture was rejected.');
  if (validateV09AggregateEvidence({ ...evidence, commit: 'c'.repeat(40) }, commit, now).length === 0) {
    throw new Error('mismatched v0.9 evidence commit was accepted.');
  }
  const localSuite = v09ReleaseEvidenceSuites.find(suite => v09EvidenceEnvironment(suite) === 'local');
  if (!localSuite) throw new Error('v0.9 evidence contract has no local self-test suite.');
  const localReceipt = receipts.find(receipt => receipt.suite === localSuite);
  if (!localReceipt) throw new Error('v0.9 evidence self-test could not find its local receipt.');
  const incorrectLocalCluster = {
    ...localReceipt,
    candidate: { ...localReceipt.candidate, cluster },
  };
  const localClusterEvidence = {
    ...evidence,
    receipts: receipts.map(receipt => receipt.suite === localSuite ? incorrectLocalCluster : receipt),
  };
  if (validateV09AggregateEvidence(localClusterEvidence, commit, now).length > 0) {
    throw new Error('irrelevant local-suite cluster metadata changed aggregate validation.');
  }
  console.log('v0.9 aggregate live-evidence verifier self-test passed.');
}

const missingGit: V06GitIdentity = { commit: '', dirty: true, workingTreeDigest: '' };
const missingCluster: V06ClusterIdentity = { context: '', uid: '' };
