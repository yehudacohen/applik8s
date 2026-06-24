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

for (const packageDir of packageDirs) {
  const args = ['publish', '--access', 'public'];
  if (dryRun) {
    args.push('--dry-run');
  }

  console.log(`${dryRun ? 'Dry-run publishing' : 'Publishing'} ${packageDir}`);
  const { stdout, stderr } = await execFileAsync('npm', args, { cwd: packageDir, maxBuffer: 10 * 1024 * 1024 });
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}
