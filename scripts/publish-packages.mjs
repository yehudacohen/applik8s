import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const npmCache = resolve('node_modules/.cache/applik8s-npm-publish');
await mkdir(npmCache, { recursive: true });

const packageDirs = [
  'packages/core',
  'packages/runtime-contract',
  'packages/typetainer',
  'packages/sdk',
  'packages/compiler',
  'packages/testing',
  'packages/runtime',
  'packages/typekro-adapter',
  'packages/client',
  'packages/react',
  'packages/tanstack-start',
  'packages/applik8s',
];

const dryRun = process.argv.includes('--dry-run');

async function publishPackage(packageDir) {
  const args = ['publish', '--access', 'public'];
  if (dryRun) {
    args.push('--dry-run');
  }

  try {
    const { stdout, stderr } = await execFileAsync('npm', args, { cwd: packageDir, env: { ...process.env, npm_config_cache: npmCache }, maxBuffer: 10 * 1024 * 1024 });
    return { packageDir, status: 'passed', stdout, stderr };
  } catch (error) {
    return {
      packageDir,
      status: 'failed',
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error),
    };
  }
}

async function packageIdentity(packageDir) {
  const manifest = JSON.parse(await readFile(`${packageDir}/package.json`, 'utf8'));
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '.'], { cwd: packageDir, env: { ...process.env, npm_config_cache: npmCache }, maxBuffer: 10 * 1024 * 1024 });
  const [pack] = JSON.parse(stdout);
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || typeof pack?.integrity !== 'string') {
    throw new Error(`${packageDir}: package identity or packed integrity is missing.`);
  }
  return { packageDir, name: manifest.name, version: manifest.version, integrity: pack.integrity };
}

async function publishedIntegrity(identity) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', `${identity.name}@${identity.version}`, 'dist.integrity', '--json'], { env: { ...process.env, npm_config_cache: npmCache }, maxBuffer: 10 * 1024 * 1024 });
    const integrity = JSON.parse(stdout);
    if (typeof integrity !== 'string' || integrity.length === 0) throw new Error(`${identity.name}@${identity.version}: registry response has no dist.integrity.`);
    return integrity;
  } catch (error) {
    const diagnostic = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error instanceof Error ? error.message : String(error)}`;
    if (/E404|not found/i.test(diagnostic)) return undefined;
    throw error;
  }
}

const identities = [];
if (!dryRun) {
  // Preflight every immutable version before mutating the registry. Existing
  // packages are recoverable only when their bytes match this release exactly.
  for (const packageDir of packageDirs) identities.push(await packageIdentity(packageDir));
}

const publicationPlan = [];
for (const packageDir of packageDirs) {
  if (dryRun) {
    publicationPlan.push({ packageDir, action: 'publish' });
    continue;
  }
  const identity = identities.find((candidate) => candidate.packageDir === packageDir);
  const existing = await publishedIntegrity(identity);
  if (existing && existing !== identity.integrity) {
    throw new Error(`${identity.name}@${identity.version} already exists with integrity ${existing}, but this release packs as ${identity.integrity}. Refusing an ambiguous partial-release recovery.`);
  }
  publicationPlan.push({ packageDir, action: existing ? 'skip' : 'publish', identity });
}

const results = [];
for (const item of publicationPlan) {
  if (item.action === 'skip') {
    results.push({ packageDir: item.packageDir, status: 'passed', stdout: `Already published with matching integrity: ${item.identity.name}@${item.identity.version}\n`, stderr: '' });
  } else {
    // Dependency order is the packageDirs order above. Sequential publication
    // makes failures resumable and never exposes dependents before prerequisites.
    const result = await publishPackage(item.packageDir);
    results.push(result);
    if (result.status === 'failed') break;
  }
}

for (const { packageDir, status, stdout, stderr } of results) {
  console.log(`${dryRun ? 'Dry-run publish' : 'Publish'} ${status}: ${packageDir}`);
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

const failed = results.filter((result) => result.status === 'failed');
if (failed.length > 0) {
  console.error(`Failed to ${dryRun ? 'dry-run publish' : 'publish'} ${failed.length} package(s):`);
  for (const { packageDir } of failed) {
    console.error(`- ${packageDir}`);
  }
  process.exit(1);
}
