// typecast-file-boundary: individual evidence receipts are untrusted JSON until aggregate exact-candidate validation succeeds before the attestation is written.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { V06EvidenceReceipt } from './v06-evidence.js';
import {
  v09EvidencePath,
  v09ReleaseEvidenceSuites,
} from './v09-release-evidence-contract.js';
import { validateV09AggregateEvidence } from './verify-v09-live-evidence.js';

const output = argumentValue('--out') ?? 'dist/applik8s-v0.9-live-evidence.json';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const receipts = await Promise.all(v09ReleaseEvidenceSuites.map(async suite => {
  const source = await readFile(v09EvidencePath(suite), 'utf8');
  return JSON.parse(source) as V06EvidenceReceipt;
}));
const evidence = {
  schemaVersion: 1 as const,
  releaseLine: 'v0.9' as const,
  commit,
  execution: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : `local://write-v09-release-attestation/${commit}`,
  generatedAt: new Date().toISOString(),
  receipts,
};
const findings = validateV09AggregateEvidence(evidence, commit);
if (findings.length > 0) {
  throw new Error(`Cannot write v0.9 attestation:\n${findings.map(finding => `- ${finding}`).join('\n')}`);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Wrote exact-candidate v0.9 evidence to ${output}.`);

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}
