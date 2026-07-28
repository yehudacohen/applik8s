import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { publishablePackageNames } from './publishable-packages.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const manifest = JSON.parse(await readFile(join(root, 'packages/applik8s/package.json'), 'utf8'));
const baseline = JSON.parse(await readFile(join(root, 'security/npm-audit-baseline.json'), 'utf8'));
const workDir = await mkdtemp(join(tmpdir(), 'applik8s-npm-audit-'));

try {
  const packageManifests = [];
  const packageDirectoryByName = new Map();
  for (const packageDir of publishablePackageNames) {
    const packageManifest = JSON.parse(await readFile(join(root, 'packages', packageDir, 'package.json'), 'utf8'));
    packageManifests.push({ packageDir, packageManifest });
    packageDirectoryByName.set(packageManifest.name, packageDir);
  }

  const dependencies = {};
  for (const { packageDir, packageManifest } of packageManifests) {
    dependencies[packageManifest.name] = `file:packages/${packageDir}`;
    const packageWorkDir = join(workDir, 'packages', packageDir);
    await mkdir(packageWorkDir, { recursive: true });
    const packageDependencies = Object.fromEntries(Object.entries(packageManifest.dependencies ?? {}).map(([name, range]) => {
      const internalDirectory = packageDirectoryByName.get(name);
      return [name, internalDirectory ? `file:../${internalDirectory}` : range];
    }));
    await writeFile(join(packageWorkDir, 'package.json'), `${JSON.stringify({
      name: packageManifest.name,
      version: packageManifest.version,
      private: true,
      dependencies: packageDependencies,
      peerDependencies: packageManifest.peerDependencies,
      peerDependenciesMeta: packageManifest.peerDependenciesMeta,
    }, null, 2)}\n`);
  }
  await writeFile(join(workDir, 'package.json'), `${JSON.stringify({
    name: 'applik8s-audit-consumer',
    private: true,
    dependencies,
  }, null, 2)}\n`);
  await execFileAsync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: workDir,
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  let report;
  try {
    const result = await execFileAsync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: workDir,
      timeout: 300_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    report = JSON.parse(result.stdout);
  } catch (error) {
    if (!error?.stdout) throw error;
    report = JSON.parse(error.stdout);
  }

  const observed = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || typeof via.url !== 'string') continue;
      const id = via.url.match(/GHSA-[a-z0-9-]+/i)?.[0];
      if (id) observed.set(id, { dependency: via.name, severity: via.severity, title: via.title });
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
    ...unexpected.map((id) => `unreviewed advisory ${id}: ${observed.get(id)?.title}`),
    ...stale.map((id) => `baseline advisory ${id} is no longer observed; remove it after verifying the dependency change`),
    ...expired.map((id) => `review for ${id} expired on ${allowed.get(id)?.expires}`),
    ...mismatched.map(([id, advisory]) => `baseline metadata for ${id} no longer matches ${advisory.dependency}/${advisory.severity}`),
  ];
  if (failures.length > 0) {
    throw new Error(`npm audit baseline check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(`Reviewed npm audit baseline passed for the @applik8s/* ${manifest.version} candidate dependency graph: ${observed.size} source advisories; ${counts.total ?? 0} propagated package findings (${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate).`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
