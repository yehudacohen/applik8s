import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  writeV06EvidenceReceipt,
} from './v06-evidence.ts';

const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.7');
const resultsPath = join(
  directory,
  'identity-start-starter-browser-results.json',
);
const report = JSON.parse(await readFile(resultsPath, 'utf8'));
const passedTests = new Map();
collectPassedTests(report.suites, passedTests);

const browserJourney =
  'admits a typed request, delivers its durable signal, and requeries authoritative state without reload';
const agentJourney =
  'executes the exported agent through its declared typed model operation';
const assertionsByTest = new Map([
  [browserJourney, [
    'human-session-admission',
    'typed-operation',
    'signal-issuance-sse-delivery',
    'signal-resolution',
    'authoritative-requery',
  ]],
  [agentJourney, ['agent-operation']],
]);

for (const title of assertionsByTest.keys()) {
  if (!passedTests.has(title)) {
    throw new Error(
      `Playwright did not record a successful Identity Start browser test: ${title}`,
    );
  }
}
if (passedTests.size !== assertionsByTest.size) {
  const unexpected = [...passedTests.keys()].filter(
    (title) => !assertionsByTest.has(title),
  );
  throw new Error(
    `Identity Start browser evidence contains unclassified tests: ${unexpected.join(', ')}`,
  );
}

const runId = randomUUID();
const timestamps = [...passedTests.values()];
const startedAt = new Date(
  Math.min(...timestamps.map((entry) => entry.startedAt)),
).toISOString();
const completedAt = new Date(
  Math.max(...timestamps.map((entry) => entry.completedAt)),
).toISOString();
const assertionEvidence = createV06AssertionEvidence(
  [...assertionsByTest].flatMap(([test, assertions]) =>
    assertions.map((assertion) => ({
      assertion,
      test,
      observedAt: new Date(
        passedTests.get(test).completedAt,
      ).toISOString(),
    }))
  ),
  runId,
);
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const controlPlaneNamespace =
  process.env.APPLIK8S_IDENTITY_START_CONTROL_PLANE_NAMESPACE ?? 'default';
const installationName =
  process.env.APPLIK8S_IDENTITY_START_INSTANCE ?? 'identity-start';
const deploymentGraphPath = join(
  process.cwd(),
  'examples/identity-start/.applik8s/deploy/typekro/application-deployment-graph.json',
);
const [git, cluster, installation, artifacts] = await Promise.all([
  collectV06GitIdentity(),
  collectV06ClusterIdentity(context),
  collectV06InstallationIdentity({
    context,
    resource: `identitystart/${installationName}`,
    namespace: controlPlaneNamespace,
  }),
  collectV06ArtifactIdentity(deploymentGraphPath),
]);

await writeV06EvidenceReceipt(
  join(directory, 'identity-start-starter-browser.json'),
  {
    suite: 'identity-start-starter-browser',
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster, installation, artifacts },
    environment: {
      context,
      controlPlaneNamespace,
      installation: installationName,
      endpoint:
        process.env.APPLIK8S_IDENTITY_START_BASE_URL
        ?? 'http://127.0.0.1:30080',
      profile: 'starter',
    },
    assertionEvidence,
  },
);

console.log(
  `Recorded Identity Start browser evidence at ${
    join(directory, 'identity-start-starter-browser.json')
  }.`,
);

function collectPassedTests(suites, output) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).flatMap(
        (entry) => entry.results ?? [],
      );
      const passed =
        spec.ok === true
        && results.length > 0
        && results.every((result) => result.status === 'passed');
      if (!passed) continue;
      const starts = results
        .map((result) => Date.parse(result.startTime))
        .filter(Number.isFinite);
      if (starts.length !== results.length) {
        throw new Error(
          `Playwright result lacks startTime for ${spec.title}.`,
        );
      }
      output.set(spec.title, {
        startedAt: Math.min(...starts),
        completedAt: Math.max(
          ...results.map(
            (result, index) =>
              starts[index] + Number(result.duration ?? 0),
          ),
        ),
      });
    }
    collectPassedTests(suite.suites, output);
  }
}
