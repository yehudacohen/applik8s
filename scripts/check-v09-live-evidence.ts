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
  v09EvidencePath,
  v09EvidenceEnvironment,
  v09ReleaseEvidenceContract,
  v09ReleaseEvidenceSuites,
} from './v09-release-evidence-contract';

const maximumReceiptAgeMs = 24 * 60 * 60 * 1_000;
const selfTest = process.argv.includes('--self-test');
const selectedSuite = process.argv.find(argument => argument.startsWith('--suite='))?.slice('--suite='.length);

if (import.meta.main && selfTest) {
  runSelfTest();
} else if (import.meta.main) {
  const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
  if (selectedSuite && !v09ReleaseEvidenceContract[selectedSuite]) {
    throw new Error(`Unknown v0.9 evidence suite ${selectedSuite}.`);
  }
  const suites = selectedSuite ? [selectedSuite] : v09ReleaseEvidenceSuites;
  const git = await collectV06GitIdentity();
  const cluster = suites.some(suite => v09EvidenceEnvironment(suite) === 'kubernetes')
    ? await collectV06ClusterIdentity(context)
    : undefined;
  const findings: string[] = [];

  for (const suite of suites) {
    const path = v09EvidencePath(suite);
    const receipt = await readReceipt(path);
    const requiredAssertions = requiredAssertionsFor(suite);
    const expectedCluster = v09EvidenceEnvironment(suite) === 'kubernetes'
      ? cluster
      : undefined;
    findings.push(
      ...validateV09ReleaseReceipt({
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
      `v0.9 live evidence failed:\n${findings
        .map((finding) => `- ${finding}`)
        .join('\n')}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        release: 'v0.9',
        candidate: { git, cluster },
        suites: suites.length,
        assertions: suites.reduce(
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
  const assertions = v09ReleaseEvidenceContract[suite];
  if (!assertions) {
    throw new Error(`v0.9 evidence suite ${suite} has no assertion contract.`);
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

export function validateV09ReleaseReceipt(
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
  const expectedEnvironment = v09EvidenceEnvironment(suite);
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
  if (suite.startsWith('v09-') && receipt.environment?.kind !== expectedEnvironment) {
    findings.push(`${suite}: receipt environment kind must be ${expectedEnvironment}.`);
  }
  if (suite === 'aws-core-smoke') {
    const environment = receipt.environment as Readonly<Record<string, unknown>>;
    const teardown = Reflect.get(receipt, 'teardown') as Readonly<Record<string, unknown>> | undefined;
    const inventory = Reflect.get(receipt, 'inventory');
    if (environment.kind !== 'aws') {
      findings.push(`${suite}: receipt environment kind must be aws.`);
    }
    if (!/^\d{12}$/u.test(String(environment.accountId ?? '')) || !String(environment.region ?? '').trim()) {
      findings.push(`${suite}: AWS account and region identity are incomplete.`);
    }
    if (!Number.isFinite(Number(environment.maxEstimatedCostUsd)) || Number(environment.maxEstimatedCostUsd) > 1) {
      findings.push(`${suite}: AWS cost boundary must be present and no greater than USD 1.`);
    }
    const expiresAt = Date.parse(String(environment.expiresAt ?? ''));
    if (!Number.isFinite(expiresAt) || expiresAt < completedAt) {
      findings.push(`${suite}: AWS scope expiry must be valid through test completion.`);
    }
    if (teardown?.complete !== true || teardown.authority !== 'createApplicationAwsDeployment.destroy') {
      findings.push(`${suite}: AWS teardown is not bound to the public deployment owner.`);
    }
    const inventoryTypes = Array.isArray(inventory)
      ? inventory.map(item => item && typeof item === 'object' ? Reflect.get(item, 'type') : undefined).sort()
      : [];
    if (
      !Array.isArray(inventory)
      || inventory.length !== 3
      || JSON.stringify(inventoryTypes) !== JSON.stringify(['AWS.Kinesis.Stream', 'AWS.S3.Bucket', 'AWS.SQS.Queue'])
    ) {
      findings.push(`${suite}: AWS inventory must contain the exact three-resource bounded slice.`);
    }
  }
  if (suite === 'v09-clean-context-review') {
    const review = Reflect.get(receipt, 'review') as Readonly<Record<string, unknown>> | undefined;
    if (review?.context !== 'fresh' || review.conversationHistory !== 'none') {
      findings.push(`${suite}: review must declare a fresh context with no conversation history.`);
    }
    if (!Array.isArray(review?.findings) || review.findings.length !== 0) {
      findings.push(`${suite}: review retains unresolved findings.`);
    }
  }

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
  const awsInventory = [
    { type: 'AWS.S3.Bucket' },
    { type: 'AWS.SQS.Queue' },
    { type: 'AWS.Kinesis.Stream' },
  ] as const;
  const awsReceipt = {
    ...receipt,
    suite: 'aws-core-smoke',
    candidate: { git },
    environment: {
      kind: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
      maxEstimatedCostUsd: 1,
      expiresAt: '2026-08-02T13:00:00.000Z',
    },
    inventory: awsInventory,
    teardown: {
      authority: 'createApplicationAwsDeployment.destroy',
      complete: true,
    },
  } as V06EvidenceReceipt;
  assertFindings('valid AWS receipt', [], {
    ...base,
    suite: 'aws-core-smoke',
    expectedCluster: undefined,
    receipt: awsReceipt,
  });
  assertFinding('broad AWS inventory', 'exact three-resource', {
    ...base,
    suite: 'aws-core-smoke',
    expectedCluster: undefined,
    receipt: {
      ...awsReceipt,
      inventory: [...awsInventory, { type: 'AWS.RDS.DBCluster' }],
    } as V06EvidenceReceipt,
  });

  const cleanReviewReceipt = {
    ...receipt,
    suite: 'v09-clean-context-review',
    candidate: { git },
    environment: { kind: 'local' },
    review: {
      context: 'fresh',
      conversationHistory: 'none',
      findings: [],
    },
  } as V06EvidenceReceipt;
  assertFindings('valid clean-context review', [], {
    ...base,
    suite: 'v09-clean-context-review',
    expectedCluster: undefined,
    receipt: cleanReviewReceipt,
  });
  assertFinding('context-polluted review', 'fresh context', {
    ...base,
    suite: 'v09-clean-context-review',
    expectedCluster: undefined,
    receipt: {
      ...cleanReviewReceipt,
      review: { context: 'inherited', conversationHistory: 'all', findings: [] },
    } as V06EvidenceReceipt,
  });

  console.log('v0.9 live evidence self-test passed.');
}

function assertFinding(
  label: string,
  expected: string,
  options: ValidateReceiptOptions,
): void {
  const findings = validateV09ReleaseReceipt(options);
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
  const findings = validateV09ReleaseReceipt(options);
  if (JSON.stringify(findings) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(findings)}.`,
    );
  }
}
