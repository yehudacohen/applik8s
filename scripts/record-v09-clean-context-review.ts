// typecast-file-boundary: an independent review report is untrusted JSON until
// this recorder validates its exact assertion and clean-context contract.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';
import {
  v09EvidencePath,
  v09ReleaseEvidenceContract,
} from './v09-release-evidence-contract';

const reportPath = Bun.argv[2];
if (!reportPath) {
  throw new Error('Usage: bun scripts/record-v09-clean-context-review.ts <review-report.json>');
}

const suite = 'v09-clean-context-review';
const expectedAssertions = v09ReleaseEvidenceContract[suite];
if (!expectedAssertions) throw new Error(`Missing ${suite} evidence contract.`);
const report = jsonObject(JSON.parse(await readFile(reportPath, 'utf8')));
if (report.context !== 'fresh' || report.conversationHistory !== 'none') {
  throw new Error('The clean-context reviewer must declare context=fresh and conversationHistory=none.');
}
if (!Array.isArray(report.findings) || report.findings.length !== 0) {
  throw new Error('Refusing to record a clean-context review with unresolved findings.');
}
const evidence = Array.isArray(report.assertionEvidence)
  ? report.assertionEvidence.map(jsonObject)
  : [];
const evidenceByAssertion = new Map(evidence.map(item => [stringField(item, 'assertion'), item]));
if (
  evidenceByAssertion.size !== expectedAssertions.length
  || expectedAssertions.some(assertion => !evidenceByAssertion.has(assertion))
) {
  throw new Error(`Review evidence must cover exactly: ${expectedAssertions.join(', ')}.`);
}

const runId = `${suite}-${randomUUID()}`;
const completedAt = new Date().toISOString();
const evidencePath = v09EvidencePath(suite);
await discardV06Evidence(evidencePath);
await writeV06EvidenceReceipt(evidencePath, {
  suite,
  run: {
    id: runId,
    startedAt: stringField(report, 'startedAt'),
    completedAt,
  },
  candidate: {
    git: await collectV06GitIdentity(process.cwd(), { exclude: ['.applik8s-tmp/'] }),
  },
  environment: { kind: 'local' },
  assertionEvidence: createV06AssertionEvidence(
    expectedAssertions.map(assertion => ({
      assertion,
      test: stringField(evidenceByAssertion.get(assertion) ?? {}, 'test'),
      observedAt: completedAt,
    })),
    runId,
  ),
  review: {
    context: 'fresh',
    conversationHistory: 'none',
    reviewer: stringField(report, 'reviewer'),
    summary: stringField(report, 'summary'),
    findings: [],
  },
});

console.log(`Recorded exact-candidate independent review at ${evidencePath}.`);

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Independent review report must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function stringField(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`Independent review report field ${field} must be a non-empty string.`);
  }
  return candidate;
}
