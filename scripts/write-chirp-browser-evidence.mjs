import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  collectV06ArtifactIdentity,
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  collectV06InstallationIdentity,
  createV06AssertionEvidence,
  writeV06EvidenceReceipt,
} from './v06-evidence.ts';

const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.6');
const resultsPath = join(directory, 'chirp-browser-results.json');
const report = JSON.parse(await readFile(resultsPath, 'utf8'));
const passedTests = new Map();
collectPassedTests(report.suites, passedTests);

const assertionsByTest = new Map([
  ['registers a new admitted principal without accepting a browser-owned account id', [
    'principal-derived-registration',
  ]],
  ['publishes, renders through live requery, and bookmarks a post without a page reload', [
    'no-reload-publication',
    'authoritative-engagement-toggle',
    'authoritative-repost-toggle',
    'typed-reply-publication',
    'typed-quote-publication',
    'bookmark-create-remove',
    'browser-console-clean',
  ]],
  ['uploads provider-verified media without exposing object-store credentials', [
    'provider-verified-media-roundtrip',
  ]],
  ['rejects media whose bytes do not match its declared content type', [
    'provider-rejected-media-signature-mismatch',
  ]],
  ['hydrates and navigates the principal flagship routes accessibly', [
    'accessible-route-hydration',
  ]],
  ['hydrates and toggles the authenticated viewer follow relationship', [
    'principal-derived-follow-toggle',
    'principal-derived-mute-toggle',
    'principal-derived-block-toggle',
  ]],
  ['updates the authenticated profile and configures an idempotent disclosed automation', [
    'profile-update',
    'automation-configure-update-suspend',
  ]],
  ['administratively stops and resumes every automated publication through durable product state', [
    'automation-administrator-stop-resume',
  ]],
  ['reports, moderates, and removes a post through durable product state', [
    'report-triage-resolution',
    'moderated-post-removal',
  ]],
]);

for (const title of assertionsByTest.keys()) {
  if (!passedTests.has(title)) throw new Error(`Playwright did not record a successful Chirp browser test: ${title}`);
}
if (passedTests.size !== assertionsByTest.size) {
  const unexpected = [...passedTests.keys()].filter((title) => !assertionsByTest.has(title));
  throw new Error(`Chirp browser evidence contains unclassified tests: ${unexpected.join(', ')}`);
}

const runId = randomUUID();
const timestamps = [...passedTests.values()];
const startedAt = new Date(Math.min(...timestamps.map((entry) => entry.startedAt))).toISOString();
const completedAt = new Date(Math.max(...timestamps.map((entry) => entry.completedAt))).toISOString();
const assertionEvidence = createV06AssertionEvidence(
  [...assertionsByTest].flatMap(([test, assertions]) => assertions.map((assertion) => ({
    assertion,
    test,
    observedAt: new Date(passedTests.get(test).completedAt).toISOString(),
  }))),
  runId,
);
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const controlPlaneNamespace = process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? 'chirp-control';
const installationName = process.env.APPLIK8S_CHIRP_INSTANCE ?? 'chirp';
const imageEvidencePath = join(process.cwd(), 'examples/chirp-start/.applik8s/deploy/typekro/application-image-evidence.json');
const [git, cluster, installation, artifacts] = await Promise.all([
  collectV06GitIdentity(),
  collectV06ClusterIdentity(context),
  collectV06InstallationIdentity({ context, resource: `chirpinstallation/${installationName}`, namespace: controlPlaneNamespace }),
  collectV06ArtifactIdentity(imageEvidencePath),
]);
await writeV06EvidenceReceipt(join(directory, 'chirp-browser.json'), {
  suite: 'chirp-browser',
  run: { id: runId, startedAt, completedAt },
  candidate: { git, cluster, installation, artifacts },
  environment: {
    context,
    controlPlaneNamespace,
    installation: installationName,
    endpoint: process.env.APPLIK8S_CHIRP_BASE_URL ?? 'http://127.0.0.1:30080',
  },
  assertionEvidence,
});

console.log(`Recorded Chirp browser evidence at ${join(directory, 'chirp-browser.json')}.`);

function collectPassedTests(suites, output) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
      const passed = spec.ok === true && results.length > 0 && results.every((result) => result.status === 'passed');
      if (!passed) continue;
      const starts = results.map((result) => Date.parse(result.startTime)).filter(Number.isFinite);
      if (starts.length !== results.length) throw new Error(`Playwright result lacks startTime for ${spec.title}.`);
      output.set(spec.title, {
        startedAt: Math.min(...starts),
        completedAt: Math.max(...results.map((result, index) => starts[index] + Number(result.duration ?? 0))),
      });
    }
    collectPassedTests(suite.suites, output);
  }
}
