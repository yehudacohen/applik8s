import { readFile } from 'node:fs/promises';

const failures = [];

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const script of ['applik8s', 'build:imagejob', 'test:imagejob', 'test:readme-live']) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json: missing ${script} script used by public docs.`);
  }
}

const source = await read('examples/imagejob.ts');
const readme = await read('README.md');
const requiredSnippets = [
  'const output = job.k8s.ConfigMap({',
  'job.apply(output);',
  "job.events.normal('ImageJobAccepted'",
  "job.requeue({ afterSeconds: 30, reason: 'WaitingForResizeOutputs' });",
  'job.delete(job.k8s.ConfigMap({',
];

for (const snippet of requiredSnippets) {
  requireContains('examples/imagejob.ts', source, snippet);
  requireContains('README.md', readme, snippet);
}

const publicDocs = [
  'README.md',
  'docs/first-run.md',
  'docs/imagejob-golden-path.md',
  'docs/generated-artifacts.md',
  'docs/api-reference.md',
  'docs/typekro-golden-path.md',
  'docs/runtime-diagnostics.md',
  'docs/replay-debugging.md',
  'docs/runtime-image.md',
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
