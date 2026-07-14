import { readFile } from 'node:fs/promises';

const failures = [];

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const script of ['applik8s', 'build:imagejob', 'build:tenant-platform-v04', 'build:tenant-platform-v05', 'test:imagejob', 'test:readme-live', 'check:v04:local', 'check:v04:scorecard', 'check:v04:prerelease:orbstack', 'check:v05:local', 'check:v05:scorecard', 'check:v05:prerelease:orbstack', 'benchmark:v041:record', 'benchmark:v041:live', 'check:v041:performance']) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json: missing ${script} script used by public docs.`);
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
  'docs/typekro-golden-path.md',
  'docs/runtime-diagnostics.md',
  'docs/replay-debugging.md',
  'docs/runtime-image.md',
  'docs/commands.md',
  'docs/workflows.md',
  'docs/v0.5-scorecard.md',
  'docs/v0.4-scorecard.md',
  'docs/release-evidence-v0.4.md',
  'docs/release-evidence-v0.4.1.md',
  'docs/stabilization-boundary.md',
  'docs/future-surface.md',
  'docs/scale-boundaries.md',
  'RELEASE_NOTES.md',
];

for (const path of publicDocs) {
  const text = await read(path);
  rejectContains(path, text, 'packages/applik8s/src/cli.ts');
  rejectContains(path, text, 'job.batch.ConfigMap');
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
