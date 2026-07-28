import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const request = JSON.parse(process.argv[2] ?? '{}');
const cwd = resolve(request.cwd ?? process.cwd());
const sourceEntrypoint = resolve(cwd, request.entrypoint ?? '');
const options = request.options ?? {};
const command = request.command === 'delete' ? 'delete' : 'deploy';

process.chdir(cwd);

const cli = await resolveNodeCliEntrypoint();
const registerTypescript = join(
  dirname(fileURLToPath(import.meta.url)),
  'node-register-typescript.mjs',
);
const deployArgs = [
  '--enable-source-maps',
  '--import', pathToFileURL(registerTypescript).href,
  cli,
  'deploy',
  sourceEntrypoint,
  '--context', String(options.context ?? ''),
  '--out-dir', String(options.outDir ?? '.applik8s/deploy'),
  '--composition-name', String(options.compositionName ?? 'app'),
  '--runtime-entrypoint', sourceEntrypoint,
  ...(options.connectionBindings ? ['--connection-bindings', resolve(cwd, String(options.connectionBindings))] : []),
  ...(options.instance ? ['--instance', resolve(cwd, String(options.instance))] : []),
  ...(options.skipAppBuild ? ['--skip-app-build'] : []),
  ...(options.skipImageBuild ? ['--skip-image-build'] : []),
  ...(options.planOnly ? ['--plan-only'] : []),
];
const deleteArgs = [
  '--enable-source-maps',
  '--import', pathToFileURL(registerTypescript).href,
  cli,
  'delete',
  sourceEntrypoint,
  '--context', String(options.context ?? ''),
  '--out-dir', String(options.outDir ?? '.applik8s/deploy'),
  '--composition-name', String(options.compositionName ?? 'app'),
  ...(options.instanceName ? ['--instance-name', String(options.instanceName)] : []),
  ...(options.controlPlaneNamespace ? ['--control-plane-namespace', String(options.controlPlaneNamespace)] : []),
];
process.exitCode = await run(process.execPath, command === 'delete' ? deleteArgs : deployArgs);

async function resolveNodeCliEntrypoint() {
  const runnerDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(runnerDirectory, 'bin.js'),
    join(runnerDirectory, '..', 'dist', 'bin.js'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source or installed-package layout.
    }
  }
  throw new Error(
    'The Applik8s Node CLI build is missing. Run the workspace/package build before deploying an application.',
  );
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        APPLIK8S_DISABLE_NODE_DEPLOY_HANDOFF: '1',
        APPLIK8S_DISABLE_NODE_DELETE_HANDOFF: '1',
      },
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}
