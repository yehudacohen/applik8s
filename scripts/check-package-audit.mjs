import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import { satisfies } from 'semver';
import { publishablePackageNames } from './publishable-packages.mjs';

const auditTimeoutMs = Number(process.env.APPLIK8S_PACKAGE_AUDIT_TIMEOUT_MS ?? 120_000);
const root = resolve(process.cwd());
const manifest = JSON.parse(await readFile(join(root, 'packages/applik8s/package.json'), 'utf8'));
const baseline = JSON.parse(await readFile(join(root, 'security/npm-audit-baseline.json'), 'utf8'));
const lock = parseJsonc(await readFile(join(root, 'bun.lock'), 'utf8'));
const workspaceByName = new Map(
  Object.entries(lock.workspaces ?? {}).map(([key, workspace]) => [workspace.name, { key, workspace }]),
);
const packageByKey = new Map(Object.entries(lock.packages ?? {}));
const packageKeysByName = new Map();

function packageIdentity(entry) {
  const identity = entry?.[0];
  if (typeof identity !== 'string' || identity.includes('@workspace:')) return undefined;
  const separator = identity.lastIndexOf('@');
  if (separator <= 0) return undefined;
  return { name: identity.slice(0, separator), version: identity.slice(separator + 1) };
}

for (const [key, entry] of packageByKey) {
  const identity = packageIdentity(entry);
  if (!identity) continue;
  const keys = packageKeysByName.get(identity.name) ?? [];
  keys.push(key);
  packageKeysByName.set(identity.name, keys);
}

function productionEdges(packageMetadata) {
  const edges = new Set([
    ...Object.keys(packageMetadata.dependencies ?? {}),
    ...Object.keys(packageMetadata.optionalDependencies ?? {}),
  ]);
  const optionalPeers = new Set(packageMetadata.optionalPeers ?? []);
  for (const name of Object.keys(packageMetadata.peerDependencies ?? {})) {
    if (!optionalPeers.has(name)) edges.add(name);
  }
  return [...edges];
}

function versionMatches(version, range) {
  if (typeof range !== 'string' || range === '*' || range.startsWith('workspace:')) return true;
  const normalized = range.startsWith('npm:') ? range.slice(range.lastIndexOf('@') + 1) : range;
  try {
    return satisfies(version, normalized, { includePrerelease: true, loose: true });
  } catch {
    return true;
  }
}

function dependencyPackageKeys(sourceKey, dependencyName, range) {
  const effectiveRange = lock.overrides?.[dependencyName] ?? range;
  const candidates = [];
  if (sourceKey) candidates.push(`${sourceKey}/${dependencyName}`);
  candidates.push(dependencyName);
  for (const key of candidates) {
    const entry = packageByKey.get(key);
    const identity = packageIdentity(entry);
    if (identity && versionMatches(identity.version, effectiveRange)) return [key];
  }
  return (packageKeysByName.get(dependencyName) ?? []).filter((key) => {
    const identity = packageIdentity(packageByKey.get(key));
    return identity && versionMatches(identity.version, effectiveRange);
  });
}

const visitedPackages = new Set();
const visitedWorkspaces = new Set();
const installedVersions = new Map();

function visitExternalPackage(key, context) {
  if (visitedPackages.has(key)) return;
  visitedPackages.add(key);
  const entry = packageByKey.get(key);
  const identity = packageIdentity(entry);
  if (!identity) throw new Error(`Invalid external package identity at bun.lock key ${key} (${context}).`);
  const versions = installedVersions.get(identity.name) ?? new Set();
  versions.add(identity.version);
  installedVersions.set(identity.name, versions);
  const metadata = entry?.[2] ?? {};
  for (const dependencyName of productionEdges(metadata)) {
    visitDependency(key, dependencyName, metadata.dependencies?.[dependencyName]
      ?? metadata.optionalDependencies?.[dependencyName]
      ?? metadata.peerDependencies?.[dependencyName], `${context} > ${dependencyName}`);
  }
}

function visitDependency(sourceKey, dependencyName, range, context) {
  const workspace = workspaceByName.get(dependencyName);
  if (workspace) {
    visitWorkspace(workspace.key, workspace.workspace);
    return;
  }
  const keys = dependencyPackageKeys(sourceKey, dependencyName, range);
  if (keys.length === 0) throw new Error(`bun.lock does not resolve required production dependency ${context}.`);
  for (const key of keys) visitExternalPackage(key, context);
}

function visitWorkspace(key, workspace) {
  if (visitedWorkspaces.has(key)) return;
  visitedWorkspaces.add(key);
  for (const dependencyName of productionEdges(workspace)) {
    visitDependency(undefined, dependencyName, workspace.dependencies?.[dependencyName]
      ?? workspace.optionalDependencies?.[dependencyName]
      ?? workspace.peerDependencies?.[dependencyName], `${workspace.name} > ${dependencyName}`);
  }
}

for (const packageDir of publishablePackageNames) {
  const key = `packages/${packageDir}`;
  const workspace = lock.workspaces?.[key];
  if (!workspace) throw new Error(`Publishable workspace ${key} is missing from bun.lock.`);
  visitWorkspace(key, workspace);
}

const auditRequest = Object.fromEntries(
  [...installedVersions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, versions]) => [name, [...versions].sort()]),
);

let report;
for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(auditRequest),
      signal: AbortSignal.timeout(auditTimeoutMs),
    });
    if (!response.ok) throw new Error(`npm advisory service returned HTTP ${response.status}`);
    report = await response.json();
    break;
  } catch (error) {
    if (attempt === 2) {
      throw new Error(`Unable to query npm advisories for the frozen production graph: ${error?.message ?? error}`, {
        cause: error,
      });
    }
    await delay(2_000);
  }
}

const observed = new Map();
for (const [dependency, advisories] of Object.entries(report ?? {})) {
  for (const advisory of advisories) {
    const id = advisory.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
    if (id) observed.set(id, { dependency, severity: advisory.severity, title: advisory.title });
  }
}

const allowed = new Map(Object.entries(baseline.advisories ?? {}));
const unexpected = [...observed.keys()].filter((id) => !allowed.has(id));
const stale = [...allowed.keys()].filter((id) => !observed.has(id));
const today = new Date().toISOString().slice(0, 10);
const expired = [...observed.keys()].filter((id) => allowed.get(id)?.expires < today);
const mismatched = [...observed].filter(([id, advisory]) => {
  const expected = allowed.get(id);
  return expected && (expected.dependency !== advisory.dependency || expected.severity !== advisory.severity);
});

const failures = [
  ...unexpected.map((id) => {
    const advisory = observed.get(id);
    const versions = [...(installedVersions.get(advisory?.dependency) ?? [])].join(', ');
    return `unreviewed advisory ${id} in ${advisory?.dependency}@${versions}: ${advisory?.title}`;
  }),
  ...stale.map((id) => `baseline advisory ${id} is no longer observed; remove it after verifying the dependency change`),
  ...expired.map((id) => `review for ${id} expired on ${allowed.get(id)?.expires}`),
  ...mismatched.map(([id, advisory]) =>
    `baseline metadata for ${id} no longer matches ${advisory.dependency}/${advisory.severity}`),
];
if (failures.length > 0) {
  throw new Error(`npm audit baseline check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
}

console.log(
  `Reviewed npm audit baseline passed for the @applik8s/* ${manifest.version} candidate: `
  + `${installedVersions.size} frozen production dependencies, ${observed.size} source advisories.`,
);
