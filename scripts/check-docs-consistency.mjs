import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const failures = [];

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const script of ['applik8s', 'build:imagejob', 'build:tenant-platform-v04', 'build:tenant-platform-v05', 'build:v06-generated-proof', 'test:imagejob', 'test:readme-live', 'check:v04:local', 'check:v04:scorecard', 'check:v04:prerelease:orbstack', 'check:v05:local', 'check:v05:scorecard', 'check:v05:prerelease:orbstack', 'check:v06:local', 'check:v06:chirp-build', 'check:v06:prerelease:orbstack', 'check:v07:local', 'check:v07:scorecard', 'check:v07:scorecard:release', 'check:v07:agentic-start:orbstack', 'test:v07:function-native-worker-live', 'test:v07:function-native-http-live', 'test:v07:signal-postgres-live', 'test:v07:lifecycle:orbstack', 'test:v07:identity-starter-live', 'test:v07:identity-dedicated-live', 'test:v07:identity-external-live', 'check:v07:prerelease:orbstack', 'benchmark:v041:record', 'benchmark:v041:live', 'check:v041:performance']) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json: missing ${script} script used by public docs.`);
  }
}
const v07Prerelease = packageJson.scripts?.['check:v07:prerelease:orbstack'] ?? '';
for (const required of [
  'test:v07:function-native-worker-live',
  'test:v07:function-native-http-live',
  'test:v07:signal-postgres-live',
  'test:v07:lifecycle:orbstack',
  'test:v06:full-live',
  'test:v07:identity-starter-live',
  'test:v07:identity-dedicated-live',
  'test:v07:identity-external-live',
  'check:v07:agentic-start:orbstack',
  'check:v07:scorecard:release',
]) {
  if (!v07Prerelease.includes(required)) {
    failures.push(
      `package.json: check:v07:prerelease:orbstack must run ${required}.`,
    );
  }
}

const source = await read('examples/imagejob.ts');
const readme = await read('README.md');
const requiredSnippets = [
  "import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';",
  'ImageJob.on.reconcile(async (job) => {',
  'const source = await readSourceObject(job.spec);',
  'const outputs = await writeFormattedOutputs(job.metadata.name, job.spec, source);',
  'const output = job.k8s.ConfigMap({',
  'job.apply(output);',
  "job.events.normal('ImageJobComplete'",
  'job.delete(job.k8s.ConfigMap({',
];

for (const snippet of requiredSnippets) {
  requireContains('examples/imagejob.ts', source, snippet);
  requireContains('README.md', readme, snippet);
}

const publicDocs = [
  'README.md',
  'docs/first-run.md',
  'docs/npm-first-run.md',
  'docs/imagejob-golden-path.md',
  'docs/generated-artifacts.md',
  'docs/api-reference.md',
  'docs/packages.md',
  'docs/typekro-golden-path.md',
  'docs/runtime-diagnostics.md',
  'docs/replay-debugging.md',
  'docs/runtime-image.md',
  'docs/commands.md',
  'docs/workflows.md',
  'docs/v0.5-scorecard.md',
  'docs/v0.6-scorecard.md',
  'docs/v0.6-foundation.md',
  'docs/charter-v07-agentic-platform.md',
  'docs/rfp-v07-agentic-start-distribution.md',
  'docs/rfp-v07-function-native-execution.md',
  'docs/v07-agentic-start-product-readiness-plan.md',
  'docs/v07-agentic-start-experience-spec.md',
  'docs/v07-agentic-start-capability-map.md',
  'docs/v0.7-scorecard.md',
  'docs/manifesto-v08-portable-stateful-development.md',
  'docs/rfp-v08-portable-local-and-aws-runtime.md',
  'docs/rfp-v08-runtime-integrity.md',
  'docs/rfp-v08-application-plan.md',
  'docs/rfp-v08-inferred-runtime-access.md',
  'docs/rfp-v08-unified-observability.md',
  'docs/rfp-v08-function-native-scheduling.md',
  'docs/rfp-v08-lakehouse-query.md',
  'docs/rfp-v08-durable-actors.md',
  'docs/rfp-v08-independent-development-environment.md',
  'docs/v0.8-scorecard.json',
  'docs/v0.8-acceptance.json',
  'docs/v0.8-target-compatibility.json',
  'docs/v0.8-aws-provider-inventory.json',
  'docs/native-models-and-live-queries.md',
  'docs/v0.4-scorecard.md',
  'docs/release-evidence-v0.4.md',
  'docs/release-evidence-v0.4.1.md',
  'docs/release-evidence-v0.6.md',
  'docs/release-evidence-v0.8.md',
  'docs/stabilization-boundary.md',
  'docs/future-surface.md',
  'docs/scale-boundaries.md',
  'RELEASE_NOTES.md',
];

for (const path of publicDocs) {
  const text = await read(path);
  rejectContains(path, text, 'packages/applik8s/src/cli.ts');
  rejectContains(path, text, 'packages/cli/src/cli.ts');
  rejectContains(path, text, 'job.batch.ConfigMap');
  rejectContains(path, text, 'createApplik8sStart');
  rejectContains(path, text, 'Applik8sAuthenticationHandler');
  rejectContains(path, text, '@applik8s/tanstack-start/testing');
  rejectContains(path, text, '@applik8s/applik8s/testing');
  rejectContains(path, text, '@applik8s/tanstack-start/react');
  rejectContains(path, text, '@applik8s/vite/server');
}

for (const path of publicDocs.filter(path => path.startsWith('docs/rfp-v08-'))) {
  const text = await read(path);
  requireContains(path, text, '**Foundation dependencies:**');
  requireContains(path, text, '**v0.8 contract integrations:**');
}

const v08Scorecard = JSON.parse(await read('docs/v0.8-scorecard.json'));
const v08Acceptance = JSON.parse(await read('docs/v0.8-acceptance.json'));
const v08TargetCompatibility = JSON.parse(await read('docs/v0.8-target-compatibility.json'));
const v08AwsProviderInventory = JSON.parse(await read('docs/v0.8-aws-provider-inventory.json'));
requireContains(
  'docs/manifesto-v08-portable-stateful-development.md',
  await read('docs/manifesto-v08-portable-stateful-development.md'),
  '### Function-native scheduling',
);
requireContains(
  'docs/rfp-v08-application-plan.md',
  await read('docs/rfp-v08-application-plan.md'),
  'Scheduler.default              -> EventBridge Scheduler',
);
requireContains(
  'docs/rfp-v08-inferred-runtime-access.md',
  await read('docs/rfp-v08-inferred-runtime-access.md'),
  'ScheduledClosure(...)          -> schedule.invoke',
);
requireContains(
  'docs/rfp-v08-unified-observability.md',
  await read('docs/rfp-v08-unified-observability.md'),
  'schedule configuration/admission/lag/misfire/retry/dead-letter behavior',
);
const v08Manifests = [v08Scorecard, v08Acceptance, v08TargetCompatibility, v08AwsProviderInventory];
for (const manifest of v08Manifests) {
  if (manifest.release !== v08Scorecard.release) {
    failures.push(`v0.8 manifest release ${manifest.release} does not match ${v08Scorecard.release}.`);
  }
}

const v08AcceptanceIds = new Set();
for (const gate of v08Acceptance.gates) {
  if (v08AcceptanceIds.has(gate.id)) {
    failures.push(`docs/v0.8-acceptance.json: duplicate gate ${gate.id}.`);
  }
  v08AcceptanceIds.add(gate.id);
}

const v08PillarIds = new Set();
for (const pillar of v08Scorecard.pillars) {
  if (v08PillarIds.has(pillar.id)) {
    failures.push(`docs/v0.8-scorecard.json: duplicate pillar ${pillar.id}.`);
  }
  v08PillarIds.add(pillar.id);
  if (!publicDocs.includes(`docs/${pillar.rfp}`)) {
    failures.push(`docs/v0.8-scorecard.json: unknown RFP ${pillar.rfp}.`);
  }
  if (!pillar.acceptance.includes('graph-provenance')) {
    failures.push(`docs/v0.8-scorecard.json: pillar ${pillar.id} does not depend on graph-provenance.`);
  }
  for (const acceptanceId of pillar.acceptance) {
    if (!v08AcceptanceIds.has(acceptanceId)) {
      failures.push(`docs/v0.8-scorecard.json: unknown acceptance gate ${acceptanceId}.`);
    }
  }
}

for (const manifest of [
  v08Scorecard.manifesto,
  v08Scorecard.acceptanceManifest,
  v08Scorecard.targetCompatibilityManifest,
  v08Scorecard.awsProviderInventory,
]) {
  if (!publicDocs.includes(`docs/${manifest}`)) {
    failures.push(`docs/v0.8-scorecard.json: unknown manifest ${manifest}.`);
  }
}

const v08CadenceIds = new Set(Object.keys(v08Acceptance.cadences));
for (const gate of v08Acceptance.gates) {
  if (!Array.isArray(gate.cadence) || gate.cadence.length === 0) {
    failures.push(`docs/v0.8-acceptance.json: gate ${gate.id} has no cadence.`);
  }
  for (const cadence of gate.cadence ?? []) {
    if (!v08CadenceIds.has(cadence)) {
      failures.push(`docs/v0.8-acceptance.json: gate ${gate.id} uses unknown cadence ${cadence}.`);
    }
  }
  const requiredEnvironments = new Set(gate.environments ?? []);
  for (const environment of gate.nonBlockingEnvironments ?? []) {
    if (requiredEnvironments.has(environment)) {
      failures.push(
        `docs/v0.8-acceptance.json: gate ${gate.id} marks ${environment} both required and nonblocking.`,
      );
    }
  }
}

const v08TargetIds = new Set(v08TargetCompatibility.targets);
const v08TargetDispositions = new Set(Object.keys(v08TargetCompatibility.dispositions));
const v08AcceptanceApplicationIds = new Set(
  v08Scorecard.acceptanceApplications.map((application) => application.id),
);
const v08VerticalIds = new Set();
for (const vertical of v08TargetCompatibility.verticals) {
  if (v08VerticalIds.has(vertical.id)) {
    failures.push(`docs/v0.8-target-compatibility.json: duplicate vertical ${vertical.id}.`);
  }
  v08VerticalIds.add(vertical.id);
  if (!v08AcceptanceApplicationIds.has(vertical.application)) {
    failures.push(
      `docs/v0.8-target-compatibility.json: vertical ${vertical.id} uses unknown acceptance application ${vertical.application}.`,
    );
  }
  for (const target of Object.keys(vertical.targets)) {
    if (!v08TargetIds.has(target)) {
      failures.push(
        `docs/v0.8-target-compatibility.json: vertical ${vertical.id} uses unknown target ${target}.`,
      );
    }
  }
  for (const target of v08TargetIds) {
    const disposition = vertical.targets[target];
    if (!v08TargetDispositions.has(disposition)) {
      failures.push(
        `docs/v0.8-target-compatibility.json: vertical ${vertical.id} has invalid ${target} disposition ${disposition}.`,
      );
    }
  }
}

const v08ActorPillar = v08Scorecard.pillars.find((pillar) => pillar.id === 'durable-actors');
const v08ActorGate = v08Acceptance.gates.find((gate) => gate.id === 'actors');
const v08ActorVertical = v08TargetCompatibility.verticals.find((vertical) => vertical.id === 'actors');
if (v08ActorPillar?.providerStrategy?.firstDistributedCandidate !== 'celld') {
  failures.push('docs/v0.8-scorecard.json: durable actors must implement celld first.');
}
if (v08ActorPillar?.providerStrategy?.secondConformanceTarget !== 'rivet') {
  failures.push('docs/v0.8-scorecard.json: durable actors must retain Rivet as the second target.');
}
if (!v08ActorGate?.environments?.includes('celld-live')) {
  failures.push('docs/v0.8-acceptance.json: actor gate must require celld-live evidence.');
}
if (!v08ActorGate?.nonBlockingEnvironments?.includes('rivet-conformance')) {
  failures.push('docs/v0.8-acceptance.json: actor gate must retain nonblocking Rivet conformance.');
}
if (v08ActorVertical?.providerQualification?.intendedFirstCandidate !== 'celld') {
  failures.push('docs/v0.8-target-compatibility.json: actor first candidate must be celld.');
}

const v08SchedulingPillar = v08Scorecard.pillars.find(
  (pillar) => pillar.id === 'function-native-scheduling',
);
const v08SchedulingGate = v08Acceptance.gates.find((gate) => gate.id === 'scheduling');
const v08SchedulingVertical = v08TargetCompatibility.verticals.find(
  (vertical) => vertical.id === 'function-native-scheduling',
);
if (v08SchedulingPillar?.rfp !== 'rfp-v08-function-native-scheduling.md') {
  failures.push('docs/v0.8-scorecard.json: function-native scheduling must own its RFP.');
}
if (!v08SchedulingPillar?.acceptance?.includes('scheduling')) {
  failures.push('docs/v0.8-scorecard.json: function-native scheduling must require scheduling evidence.');
}
if (v08SchedulingGate?.owner !== 'function-native-scheduling') {
  failures.push('docs/v0.8-acceptance.json: scheduling gate must be owned by function-native scheduling.');
}
for (const environment of [
  'deterministic-local-clock',
  'orbstack-scheduling',
  'real-aws-eventbridge-scheduler',
]) {
  if (!v08SchedulingGate?.environments?.includes(environment)) {
    failures.push(`docs/v0.8-acceptance.json: scheduling gate must require ${environment}.`);
  }
}
for (const target of ['local', 'aws', 'kubernetes']) {
  if (v08SchedulingVertical?.targets?.[target] !== 'required') {
    failures.push(
      `docs/v0.8-target-compatibility.json: scheduling must be required for ${target}.`,
    );
  }
}

const v08AwsProviderDispositions = new Set(
  Object.keys(v08AwsProviderInventory.releaseDispositions),
);
const v08AwsProviderIds = new Set();
for (const provider of v08AwsProviderInventory.providers) {
  if (v08AwsProviderIds.has(provider.id)) {
    failures.push(`docs/v0.8-aws-provider-inventory.json: duplicate provider ${provider.id}.`);
  }
  v08AwsProviderIds.add(provider.id);
  if (!v08AwsProviderDispositions.has(provider.releaseDisposition)) {
    failures.push(
      `docs/v0.8-aws-provider-inventory.json: provider ${provider.id} has invalid disposition ${provider.releaseDisposition}.`,
    );
  }
  if (!Array.isArray(provider.capabilities) || provider.capabilities.length === 0) {
    failures.push(`docs/v0.8-aws-provider-inventory.json: provider ${provider.id} has no capabilities.`);
  }
}
const v08AwsSchedulerProvider = v08AwsProviderInventory.providers.find(
  (provider) => provider.id === 'aws-scheduler',
);
if (v08AwsSchedulerProvider?.releaseDisposition !== 'stable-required') {
  failures.push('docs/v0.8-aws-provider-inventory.json: aws-scheduler must be stable-required.');
}
for (const capability of ['eventbridge-scheduler', 'sqs-admission', 'retry-dlq']) {
  if (!v08AwsSchedulerProvider?.capabilities?.includes(capability)) {
    failures.push(`docs/v0.8-aws-provider-inventory.json: aws-scheduler must include ${capability}.`);
  }
}
const v08ReleaseGate = v08Acceptance.gates.find((gate) => gate.id === 'release');
if (!v08ReleaseGate?.evidence?.includes('v07-to-v08-migration')) {
  failures.push('docs/v0.8-acceptance.json: release gate must retain v0.7 migration evidence.');
}

for (const path of await sourceFiles('examples')) {
  if (path.includes('/test/') || path.endsWith('.test.ts')) continue;
  const text = await read(path);
  if (/\.on\.(?:command|action)\s*\(/.test(text)) {
    failures.push(`${path}: public examples must use direct named model actions instead of compatibility-only .on.command/.on.action registration.`);
  }
}

requireContains('README.md', readme, 'docs/first-run.md');
requireContains('docs/typekro-golden-path.md', await read('docs/typekro-golden-path.md'), 'typeKro.composition');
requireContains('docs/generated-artifacts.md', await read('docs/generated-artifacts.md'), 'job.k8s.ConfigMap({ data })');
requireContains('examples/test/product-stories.character.test.ts', await read('examples/test/product-stories.character.test.ts'), 'typeKro.composition');

if (failures.length > 0) {
  console.error('Docs consistency check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

async function read(path) {
  return readFile(path, 'utf8');
}

async function sourceFiles(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  return (await Promise.all((await readdir(path))
    .filter((entry) => !['node_modules', 'dist', '.applik8s'].includes(entry))
    .map((entry) => sourceFiles(join(path, entry))))).flat();
}

function requireContains(path, text, snippet) {
  if (!text.includes(snippet)) {
    failures.push(`${path}: expected to contain ${snippet}`);
  }
}

function rejectContains(path, text, snippet) {
  if (text.includes(snippet)) {
    failures.push(`${path}: should not contain ${snippet}`);
  }
}
