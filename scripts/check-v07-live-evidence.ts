// typecast-file-boundary: release receipts are untrusted JSON and are decoded at this gate.
import { readFile } from 'node:fs/promises';
import {
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  type V06ClusterIdentity,
  type V06EvidenceReceipt,
  type V06GitIdentity,
} from './v06-evidence';
import {
  v07EvidencePath,
  v07ReleaseEvidenceContract,
  v07ReleaseEvidenceSuites,
} from './v07-release-evidence-contract';

const maximumReceiptAgeMs = 24 * 60 * 60 * 1_000;
const selfTest = process.argv.includes('--self-test');

if (selfTest) {
  runSelfTest();
} else {
  const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
  const [git, cluster] = await Promise.all([
    collectV06GitIdentity(),
    collectV06ClusterIdentity(context),
  ]);
  const findings: string[] = [];

  for (const suite of v07ReleaseEvidenceSuites) {
    const path = v07EvidencePath(suite);
    const receipt = await readReceipt(path);
    const requiredAssertions = requiredAssertionsFor(suite);
    const expectedCluster =
      suite === 'postgres' || suite === 'clickhouse' ? undefined : cluster;
    findings.push(
      ...validateV07ReleaseReceipt({
        receipt,
        suite,
        requiredAssertions,
        expectedGit: git,
        expectedCluster,
        now: Date.now(),
        path,
      }),
    );
  }

  if (findings.length > 0) {
    throw new Error(
      `v0.7 live evidence failed:\n${findings
        .map((finding) => `- ${finding}`)
        .join('\n')}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        release: 'v0.7',
        candidate: { git, cluster },
        suites: v07ReleaseEvidenceSuites.length,
        assertions: v07ReleaseEvidenceSuites.reduce(
          (total, suite) =>
            total + requiredAssertionsFor(suite).length,
          0,
        ),
      },
      null,
      2,
    ),
  );
}

function requiredAssertionsFor(suite: string): readonly string[] {
  const assertions = v07ReleaseEvidenceContract[suite];
  if (!assertions) {
    throw new Error(`v0.7 evidence suite ${suite} has no assertion contract.`);
  }
  return assertions;
}

interface ValidateReceiptOptions {
  readonly receipt: V06EvidenceReceipt | undefined;
  readonly suite: string;
  readonly requiredAssertions: readonly string[];
  readonly expectedGit: V06GitIdentity;
  readonly expectedCluster: V06ClusterIdentity | undefined;
  readonly now: number;
  readonly path: string;
}

export function validateV07ReleaseReceipt(
  options: ValidateReceiptOptions,
): readonly string[] {
  const {
    receipt,
    suite,
    requiredAssertions,
    expectedGit,
    expectedCluster,
    now,
    path,
  } = options;
  if (!receipt) return [`${suite}: missing or malformed receipt ${path}.`];

  const findings: string[] = [];
  if (receipt.schemaVersion !== 3) {
    findings.push(`${suite}: receipt schemaVersion must be 3.`);
  }
  if (receipt.suite !== suite) {
    findings.push(
      `${suite}: receipt declares suite ${JSON.stringify(receipt.suite)}.`,
    );
  }
  if (!sameIdentity(receipt.candidate?.git, expectedGit)) {
    findings.push(`${suite}: receipt does not identify the exact working tree.`);
  }
  if (
    expectedCluster
    && !sameIdentity(receipt.candidate?.cluster, expectedCluster)
  ) {
    findings.push(`${suite}: receipt does not identify the current cluster.`);
  }

  const completedAt = Date.parse(receipt.completedAt);
  const startedAt = Date.parse(receipt.run?.startedAt ?? '');
  if (
    !Number.isFinite(completedAt)
    || !Number.isFinite(startedAt)
    || completedAt < startedAt
    || completedAt > now + 60_000
    || now - completedAt > maximumReceiptAgeMs
  ) {
    findings.push(`${suite}: receipt is stale or has an invalid run interval.`);
  }
  if (
    !receipt.run?.id
    || receipt.run.completedAt !== receipt.completedAt
  ) {
    findings.push(`${suite}: receipt run identity is incomplete.`);
  }

  const assertions = new Set(receipt.assertions);
  if (assertions.size !== receipt.assertions.length) {
    findings.push(`${suite}: receipt contains duplicate assertions.`);
  }
  const missing = requiredAssertions.filter(
    (assertion) => !assertions.has(assertion),
  );
  if (missing.length > 0) {
    findings.push(`${suite}: missing assertions ${missing.join(', ')}.`);
  }
  const unexpected = [...assertions].filter(
    (assertion) => !requiredAssertions.includes(assertion),
  );
  if (unexpected.length > 0) {
    findings.push(
      `${suite}: unclassified assertions ${unexpected.join(', ')}.`,
    );
  }

  const evidenceByAssertion = new Map(
    receipt.assertionEvidence.map((entry) => [entry.assertion, entry]),
  );
  if (
    evidenceByAssertion.size !== receipt.assertionEvidence.length
    || receipt.assertionEvidence.length !== receipt.assertions.length
  ) {
    findings.push(
      `${suite}: assertion evidence must map one-to-one to assertions.`,
    );
  }
  for (const assertion of requiredAssertions) {
    const evidence = evidenceByAssertion.get(assertion);
    const observedAt = Date.parse(evidence?.observedAt ?? '');
    if (
      !evidence
      || evidence.runId !== receipt.run?.id
      || !evidence.test.trim()
      || !Number.isFinite(observedAt)
      || observedAt < startedAt
      || observedAt > completedAt + 1_000
    ) {
      findings.push(
        `${suite}: assertion ${assertion} lacks valid run-bound evidence.`,
      );
    }
  }

  return findings;
}

async function readReceipt(
  path: string,
): Promise<V06EvidenceReceipt | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    return value as V06EvidenceReceipt;
  } catch {
    return undefined;
  }
}

function sameIdentity(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function runSelfTest(): void {
  const now = Date.parse('2026-08-02T12:00:00.000Z');
  const git = {
    commit: 'abc123',
    dirty: true,
    workingTreeDigest: 'sha256:candidate',
  } as const;
  const cluster = { context: 'orbstack', uid: 'cluster-uid' } as const;
  const requiredAssertions = ['apply', 'destroy'] as const;
  const run = {
    id: 'run-1',
    startedAt: '2026-08-02T11:58:00.000Z',
    completedAt: '2026-08-02T11:59:00.000Z',
  } as const;
  const receipt = {
    schemaVersion: 3,
    suite: 'fixture',
    run,
    completedAt: run.completedAt,
    candidate: { git, cluster },
    environment: {},
    assertions: requiredAssertions,
    assertionEvidence: requiredAssertions.map((assertion) => ({
      assertion,
      test: `fixture ${assertion}`,
      runId: run.id,
      observedAt: run.completedAt,
    })),
  } satisfies V06EvidenceReceipt;
  const base = {
    suite: 'fixture',
    requiredAssertions,
    expectedGit: git,
    expectedCluster: cluster,
    now,
    path: 'fixture.json',
  } as const;

  assertFindings('valid receipt', [], {
    ...base,
    receipt,
  });
  assertFinding('stale working tree', 'exact working tree', {
    ...base,
    receipt: {
      ...receipt,
      candidate: {
        ...receipt.candidate,
        git: { ...git, workingTreeDigest: 'sha256:stale' },
      },
    },
  });
  assertFinding('wrong cluster', 'current cluster', {
    ...base,
    receipt: {
      ...receipt,
      candidate: {
        ...receipt.candidate,
        cluster: { ...cluster, uid: 'other-cluster' },
      },
    },
  });
  assertFinding('missing assertion', 'missing assertions destroy', {
    ...base,
    receipt: {
      ...receipt,
      assertions: ['apply'],
      assertionEvidence: receipt.assertionEvidence.slice(0, 1),
    },
  });
  assertFinding('stale receipt', 'stale or has an invalid run interval', {
    ...base,
    now: now + maximumReceiptAgeMs + 60_001,
    receipt,
  });
  assertFinding('unbound evidence', 'valid run-bound evidence', {
    ...base,
    receipt: {
      ...receipt,
      assertionEvidence: receipt.assertionEvidence.map((entry) =>
        entry.assertion === 'destroy'
          ? { ...entry, runId: 'wrong-run' }
          : entry,
      ),
    },
  });

  console.log('v0.7 live evidence self-test passed.');
}

function assertFinding(
  label: string,
  expected: string,
  options: ValidateReceiptOptions,
): void {
  const findings = validateV07ReleaseReceipt(options);
  if (!findings.some((finding) => finding.includes(expected))) {
    throw new Error(
      `${label} did not produce ${JSON.stringify(expected)}: ${findings.join('; ')}`,
    );
  }
}

function assertFindings(
  label: string,
  expected: readonly string[],
  options: ValidateReceiptOptions,
): void {
  const findings = validateV07ReleaseReceipt(options);
  if (JSON.stringify(findings) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(findings)}.`,
    );
  }
}
