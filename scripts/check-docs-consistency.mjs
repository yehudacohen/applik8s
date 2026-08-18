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
  'docs/native-models-and-live-queries.md',
  'docs/v0.4-scorecard.md',
  'docs/release-evidence-v0.4.md',
  'docs/release-evidence-v0.4.1.md',
  'docs/release-evidence-v0.6.md',
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
