import { access, readFile } from 'node:fs/promises';

const publishablePackages = [
  'packages/applik8s/package.json',
  'packages/core/package.json',
  'packages/sdk/package.json',
  'packages/compiler/package.json',
  'packages/runtime-contract/package.json',
  'packages/runtime/package.json',
  'packages/testing/package.json',
  'packages/typekro-adapter/package.json',
  'packages/typetainer/package.json',
];

const requiredDocs = [
  'README.md',
  'LICENSE',
  'RELEASE_NOTES.md',
  'BACKLOG.md',
  'character-test-roadmap.md',
  'RECONCILIATION_CONTRACT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/ISSUE_TEMPLATE/security_coordination.md',
  'docs/stabilization-boundary.md',
  'docs/typekro-golden-path.md',
  'docs/api-reference.md',
  'docs/first-run.md',
  'docs/troubleshooting.md',
  'docs/release-gates.md',
  'docs/runtime-image.md',
  'docs/scale-boundaries.md',
  'docs/positioning.md',
  'docs/future-surface.md',
  'docs/decisions.md',
  'docs/maintainer-policy.md',
  'docs/release-evidence-v0.1.md',
  'docs/kubernetes-compatibility.md',
];

const publicReleaseFiles = [
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.character.config.ts',
  'vitest.e2e.config.ts',
  'scripts/check-local-gates.mjs',
  'scripts/check-prerelease-gates.mjs',
  'scripts/check-docs-consistency.mjs',
  'scripts/package-publish-dry-run.mjs',
  'scripts/publish-packages.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/release-evidence.yml',
  ...publishablePackages,
  ...requiredDocs,
  'docs/imagejob-golden-path.md',
  'docs/generated-artifacts.md',
  'docs/replay-debugging.md',
  'docs/runtime-diagnostics.md',
  'docs/security-model.md',
  'docs/leader-election.md',
  'docs/schema-evolution.md',
  'docs/contract-evolution.md',
  'examples/imagejob.ts',
  'examples/test/product-stories.character.test.ts',
];

const privateBrand = ['ska', 'tes'].join('');
const privatePatterns = [
  new RegExp(`@${privateBrand}/`, 'i'),
  new RegExp(`${privateBrand}-operator`, 'i'),
  new RegExp(`${privateBrand} operator`, 'i'),
  new RegExp(`${privateBrand} dogfood`, 'i'),
  new RegExp(`${privateBrand} portability`, 'i'),
  new RegExp(`${privateBrand}\\.dev`, 'i'),
  new RegExp(`${privateBrand}\\.run`, 'i'),
  new RegExp(`${privateBrand}-run`, 'i'),
  /WorkloadBoundary/,
  /WorkloadReplica/,
  /cross-cluster migration/i,
  new RegExp(['virtual', 'iz'].join(''), 'i'),
];

const disallowedPublicPaths = [
  `packages/${privateBrand}-operator`,
  'packages/private-research',
];

const failures = [];

for (const path of publishablePackages) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  requireField(path, manifest, 'name');
  requireField(path, manifest, 'version');
  requireField(path, manifest, 'description');
  requireField(path, manifest, 'license');
  requireField(path, manifest, 'type');
  requireField(path, manifest, 'exports');
  requireField(path, manifest, 'files');
  requireField(path, manifest, 'publishConfig');
  requireField(path, manifest, 'repository');

  if (manifest.private === true) {
    failures.push(`${path}: publishable package must not set private: true.`);
  }
  if (manifest.version !== '0.1.0') {
    failures.push(`${path}: expected version 0.1.0, got ${manifest.version}.`);
  }
  if (manifest.license !== 'Apache-2.0') {
    failures.push(`${path}: expected Apache-2.0 license, got ${manifest.license}.`);
  }
  if (manifest.publishConfig?.access !== 'public') {
    failures.push(`${path}: publishConfig.access must be public.`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes('src')) {
    failures.push(`${path}: files must include src.`);
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof range === 'string' && range.startsWith('file:')) {
      failures.push(`${path}: dependency ${name} uses local file: range ${range}.`);
    }
  }
}

for (const path of requiredDocs) {
  try {
    await readFile(path, 'utf8');
  } catch {
    failures.push(`${path}: required v0.1 release document is missing.`);
  }
}

for (const path of disallowedPublicPaths) {
  try {
    await access(path);
    failures.push(`${path}: internal-only package path must not be present in the public v0.1 tree.`);
  } catch {
    // Missing is expected.
  }
}

for (const path of publicReleaseFiles) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of privatePatterns) {
    if (pattern.test(contents)) {
      failures.push(`${path}: public release file contains private reference matching ${pattern}.`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Release readiness check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exitCode = 1;
}

function requireField(path, manifest, field) {
  if (manifest[field] === undefined) {
    failures.push(`${path}: missing ${field}.`);
  }
}
