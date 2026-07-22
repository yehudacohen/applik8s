import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const request = JSON.parse(process.argv[2] ?? '{}');
const cwd = resolve(request.cwd ?? process.cwd());
const entrypoint = resolve(cwd, request.entrypoint ?? '');
const options = request.options ?? {};
const tempDir = join(cwd, '.applik8s-tmp', `cli-delete-${process.pid}`);
const bundledEntrypoint = join(tempDir, 'entrypoint.mjs');

process.chdir(cwd);
await mkdir(tempDir, { recursive: true });

try {
  await build({
    entryPoints: [entrypoint],
    outfile: bundledEntrypoint,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // Keep runtime-sensitive packages native while bundling workspace-private
    // dependencies such as drizzle-arktype. Bun's workspace layout does not
    // guarantee those transitive packages are resolvable beside this temporary
    // Node entrypoint.
    external: [
      'typekro',
      'typekro/*',
      '@kubernetes/client-node',
      'arktype',
      '@hatchet-dev/typescript-sdk/*',
    ],
    // Some bundled CommonJS dependencies retain dynamic require calls. The
    // ESM handoff must provide Node's real require rather than esbuild's
    // unsupported fallback.
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
    sourcemap: false,
  });

  const cli = await resolveNodeCliEntrypoint();
  const args = [
    cli,
    'delete',
    bundledEntrypoint,
    '--context', String(options.context ?? ''),
    '--out-dir', String(options.outDir ?? '.applik8s/deploy'),
    '--composition-name', String(options.compositionName ?? 'app'),
    ...(options.instanceName ? ['--instance-name', String(options.instanceName)] : []),
    ...(options.controlPlaneNamespace ? ['--control-plane-namespace', String(options.controlPlaneNamespace)] : []),
    ...(options.keepDirectPreparation ? ['--keep-direct-preparation'] : []),
  ];
  process.exitCode = await run(process.execPath, args);
} finally {
  if (process.env.APPLIK8S_KEEP_TMP !== '1') {
    await rm(tempDir, { recursive: true, force: true });
  }
}

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
  throw new Error('The Applik8s Node CLI build is missing. Run the workspace/package build before deleting an application.');
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, APPLIK8S_DISABLE_NODE_DELETE_HANDOFF: '1' } });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}
