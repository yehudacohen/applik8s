import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const buildRoot = join(root, '.package-build');
const packages = ['applik8s', 'core', 'sdk', 'compiler', 'runtime-contract', 'runtime', 'testing', 'typekro-adapter', 'typetainer'];

await rm(buildRoot, { recursive: true, force: true });
await execFileAsync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', join(root, 'tsconfig.json'), '--rootDir', root, '--outDir', buildRoot, '--declaration', '--declarationMap', 'false', '--sourceMap', 'false', '--noEmit', 'false'], {
  cwd: root,
  maxBuffer: 20 * 1024 * 1024,
});

for (const packageName of packages) {
  const packageRoot = join(root, 'packages', packageName);
  const dist = join(packageRoot, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(join(buildRoot, 'packages', packageName, 'src'), dist, { recursive: true });
}

await cp(join(root, 'packages/applik8s/src/node-build-runner.mjs'), join(root, 'packages/applik8s/dist/node-build-runner.mjs'));
await chmod(join(root, 'packages/applik8s/dist/cli.js'), 0o755);
