import { access, readFile } from 'node:fs/promises';
import { publishablePackageManifestPaths } from './publishable-packages.mjs';

const publishablePackages = publishablePackageManifestPaths;

const expectedVersion = process.env.APPLIK8S_RELEASE_VERSION ?? '0.7.0';
const releaseLabel = `v${expectedVersion}`;
const publishablePackageNames = new Set();
const publishableManifests = new Map();

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
  'docs/v0.3-first-run.md',
  'docs/troubleshooting.md',
  'docs/release-gates.md',
  'docs/runtime-image.md',
  'docs/build-supply-chain.md',
  'docs/scale-boundaries.md',
  'docs/positioning.md',
  'docs/future-surface.md',
  'docs/decisions.md',
  'docs/maintainer-policy.md',
  'docs/release-evidence-v0.2.md',
  'docs/release-evidence-v0.3.md',
  'docs/release-evidence-v0.4.md',
  'docs/release-evidence-v0.4.1.md',
  'docs/release-evidence-v0.4.2.md',
  'docs/release-evidence-v0.4.3.md',
  'docs/release-evidence-v0.5.md',
  'docs/release-evidence-v0.6.md',
  'docs/commands.md',
  'docs/npm-first-run.md',
  'docs/v0.4-scorecard.md',
  'docs/v0.5-scorecard.md',
  'docs/v0.6-scorecard.md',
  'docs/v0.7-scorecard.md',
  'docs/packages.md',
  'docs/charter-v07-agentic-platform.md',
  'docs/v07-agentic-start-capability-map.md',
  'docs/v07-product-baseline.json',
  'docs/v0.6-foundation.md',
  'docs/native-models-and-live-queries.md',
  'docs/workflows.md',
  'docs/guestbook-show-hn.md',
  'docs/kubernetes-connections.md',
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
  'scripts/check-package-catalog.mjs',
  'scripts/build-publishable-packages.mjs',
  'scripts/package-publish-dry-run.mjs',
  'scripts/package-consumer-smoke.mjs',
  'scripts/check-package-audit.mjs',
  'scripts/published-release-orbstack-smoke.mjs',
  'scripts/check-v04-scorecard.ts',
  'scripts/check-v05-scorecard.ts',
  'scripts/benchmark-v05.ts',
  'scripts/check-v06-scorecard.ts',
  'scripts/check-v07-scorecard.ts',
  'scripts/check-v07-product-baseline.mjs',
  'scripts/write-v07-release-attestation.mjs',
  'scripts/benchmark-v06.ts',
  'scripts/verify-v04-live-evidence.mjs',
  'scripts/publish-packages.mjs',
  'security/npm-audit-baseline.json',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/operator-host-image.yml',
  '.github/workflows/release-evidence.yml',
  ...publishablePackages,
  ...requiredDocs,
  'docs/imagejob-golden-path.md',
  'docs/generated-artifacts.md',
  'docs/replay-debugging.md',
  'docs/runtime-diagnostics.md',
  'docs/commands.md',
  'docs/npm-first-run.md',
  'docs/v0.4-scorecard.md',
  'docs/v0.5-scorecard.md',
  'docs/v0.6-scorecard.md',
  'docs/workflows.md',
  'docs/guestbook-show-hn.md',
  'docs/release-evidence-v0.4.md',
  'docs/release-evidence-v0.4.1.md',
  'docs/release-evidence-v0.4.2.md',
  'docs/release-evidence-v0.4.3.md',
  'docs/release-evidence-v0.5.md',
  'docs/release-evidence-v0.6.md',
  'docs/kubernetes-connections.md',
  'docs/security-model.md',
  'docs/build-supply-chain.md',
  'docs/leader-election.md',
  'docs/schema-evolution.md',
  'docs/contract-evolution.md',
  'examples/imagejob.ts',
  'examples/guestbook.ts',
  'examples/tenant-platform.ts',
  'examples/chirp-start/src/app.ts',
  'examples/chirp-start/src/models.ts',
  'examples/chirp-start/src/application.ts',
  'examples/chirp-start/src/routes/index.tsx',
  'examples/chirp-start/README.md',
  'examples/guestbook-minimal.ts',
  'examples/test/product-stories.character.test.ts',
  'packages/e2e/test/typekro-guestbook.e2e.test.ts',
  'packages/e2e/test/tenant-platform-live.e2e.test.ts',
  'packages/e2e/test/kubernetes-sdk-wasm-live.e2e.test.ts',
];

const privateBrand = ['ska', 'tes'].join('');
const privateProductBrands = [
  ['va', 'sco'].join(''),
  ['st', 'imp'].join(''),
  ['open-', 'arti', 'swarm'].join(''),
];
const privatePatterns = [
  new RegExp(`@${privateBrand}/`, 'i'),
  new RegExp(`${privateBrand}-operator`, 'i'),
  new RegExp(`${privateBrand} operator`, 'i'),
  new RegExp(`${privateBrand} dogfood`, 'i'),
  new RegExp(`${privateBrand} portability`, 'i'),
  new RegExp(`\\b${privateBrand}\\b`, 'i'),
  new RegExp(`${privateBrand}\\.dev`, 'i'),
  new RegExp(`${privateBrand}\\.run`, 'i'),
  new RegExp(`${privateBrand}-run`, 'i'),
  /WorkloadBoundary/,
  /WorkloadReplica/,
  /cross-cluster migration/i,
  new RegExp(['virtual', 'iz'].join(''), 'i'),
  ...privateProductBrands.map((brand) => new RegExp(`\\b${brand}\\b`, 'i')),
];

const disallowedPublicPaths = [
  `packages/${privateBrand}-operator`,
  'packages/private-research',
];

const failures = [];

for (const path of publishablePackages) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  publishableManifests.set(manifest.name, { path, manifest });
  if (typeof manifest.name === 'string') {
    publishablePackageNames.add(manifest.name);
  }
}

const requiredGeneratedRuntimeDependencies = {
  '@applik8s/vite': ['@applik8s/compiler', '@applik8s/server'],
  '@applik8s/tanstack-start': ['@applik8s/client', '@applik8s/server', '@applik8s/vite'],
};
for (const [packageName, dependencies] of Object.entries(requiredGeneratedRuntimeDependencies)) {
  const entry = publishableManifests.get(packageName);
  for (const dependency of dependencies) {
    if (entry?.manifest.dependencies?.[dependency] !== expectedVersion) {
      failures.push(`${entry?.path ?? packageName}: generated runtime dependency ${dependency} must be declared at ${expectedVersion}.`);
    }
  }
}

for (const path of ['package.json', ...publishablePackages]) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (publishablePackageNames.has(name) && range !== expectedVersion) {
      failures.push(`${path}: dependency ${name} must use ${expectedVersion}, got ${range}.`);
    }
  }
}

for (const path of publishablePackages) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  requireField(path, manifest, 'name');
  requireField(path, manifest, 'version');
  requireField(path, manifest, 'description');
  requireField(path, manifest, 'license');
  requireField(path, manifest, 'type');
  // Executable-only create-* packages intentionally expose a bin without an
  // importable module. Requiring a synthetic export would make importing the
  // package execute the CLI as a side effect.
  if (manifest.bin === undefined) requireField(path, manifest, 'exports');
  requireField(path, manifest, 'files');
  requireField(path, manifest, 'publishConfig');
  requireField(path, manifest, 'repository');

  if (manifest.private === true) {
    failures.push(`${path}: publishable package must not set private: true.`);
  }
  if (manifest.version !== expectedVersion) {
    failures.push(`${path}: expected version ${expectedVersion}, got ${manifest.version}.`);
  }
  if (manifest.license !== 'Apache-2.0') {
    failures.push(`${path}: expected Apache-2.0 license, got ${manifest.license}.`);
  }
  if (manifest.publishConfig?.access !== 'public') {
    failures.push(`${path}: publishConfig.access must be public.`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) {
    failures.push(`${path}: files must include compiled dist output.`);
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
    failures.push(`${path}: required ${releaseLabel} release document is missing.`);
  }
}

for (const path of disallowedPublicPaths) {
  try {
    await access(path);
      failures.push(`${path}: internal-only package path must not be present in the public ${releaseLabel} tree.`);
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
