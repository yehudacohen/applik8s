import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const packageDirs = [
  'packages/core',
  'packages/runtime-contract',
  'packages/typetainer',
  'packages/sdk',
  'packages/compiler',
  'packages/testing',
  'packages/runtime',
  'packages/typekro-adapter',
  'packages/applik8s',
];

const dryRun = process.argv.includes('--dry-run');

async function publishPackage(packageDir) {
  const args = ['publish', '--access', 'public'];
  if (dryRun) {
    args.push('--dry-run');
  }

  try {
    const { stdout, stderr } = await execFileAsync('npm', args, { cwd: packageDir, maxBuffer: 10 * 1024 * 1024 });
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

const results = await Promise.all(packageDirs.map((packageDir) => publishPackage(packageDir)));

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
