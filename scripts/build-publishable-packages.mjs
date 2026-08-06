import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { publishablePackageNames } from './publishable-packages.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const buildRoot = join(root, '.package-build');

await rm(buildRoot, { recursive: true, force: true });
await execFileAsync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', join(root, 'tsconfig.publish.json'), '--rootDir', root, '--outDir', buildRoot, '--declaration', '--declarationMap', 'false', '--sourceMap', 'false', '--noEmit', 'false'], {
  cwd: root,
  maxBuffer: 20 * 1024 * 1024,
});

for (const packageName of publishablePackageNames) {
  const packageRoot = join(root, 'packages', packageName);
  const dist = join(packageRoot, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(join(buildRoot, 'packages', packageName, 'src'), dist, { recursive: true });
}

await cp(
  join(root, 'packages/start-agentic/src/templates'),
  join(root, 'packages/start-agentic/dist/templates'),
  { recursive: true },
);

await cp(join(root, 'packages/cli/src/node-build-runner.mjs'), join(root, 'packages/cli/dist/node-build-runner.mjs'));
await cp(join(root, 'packages/cli/src/node-deploy-runner.mjs'), join(root, 'packages/cli/dist/node-deploy-runner.mjs'));
await cp(join(root, 'packages/cli/src/node-typescript-loader.mjs'), join(root, 'packages/cli/dist/node-typescript-loader.mjs'));
await cp(join(root, 'packages/cli/src/node-register-typescript.mjs'), join(root, 'packages/cli/dist/node-register-typescript.mjs'));
await chmod(join(root, 'packages/cli/dist/bin.js'), 0o755);
await chmod(join(root, 'packages/create-applik8s/dist/bin.js'), 0o755);
