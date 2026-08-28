// typecast-file-boundary: npm-packed public modules, generated package manifests,
// npm receipts, and local supervisor state are external JSON/module boundaries
// validated by this end-to-end receipt before their consumed fields are used.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../../..');
const enabled = process.env.APPLIK8S_E2E_DOCKER === '1';
const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

describe.runIf(enabled)('v0.8 packed local application lifecycle', () => {
  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    children.clear();
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    }
  });

  it('generates, reloads, reconciles, recovers, restarts, retains data, and resets from packed entrypoints', async () => {
    // Keep the receipt inside the source workspace so Vite recognizes linked
    // package dependencies as members of the same workspace. The generated
    // application still consumes npm-packed Start and CLI artifacts, while
    // avoiding a test-only server.fs.allow escape hatch that a real registry
    // installation would never need.
    const receiptRoot = join(root, 'tmp');
    await mkdir(receiptRoot, { recursive: true });
    const workspace = await mkdtemp(join(receiptRoot, 'applik8s-packed-local-'));
    temporaryDirectories.push(workspace);
    const packedStart = await packPackage('packages/start-agentic', join(workspace, 'packed-start'));
    const packedCli = await packPackage('packages/cli', join(workspace, 'packed-cli'));
    await symlink(join(root, 'packages/start-agentic/node_modules'), join(packedStart, 'node_modules'), 'dir');
    await symlink(join(root, 'packages/cli/node_modules'), join(packedCli, 'node_modules'), 'dir');

    // static-import-exception: this receipt must exercise the npm-packed Start, not its workspace source entrypoint.
    const { createApplicationAgenticStart } = await import(
      pathToFileURL(join(packedStart, 'dist/index.js')).href
    ) as {
      createApplicationAgenticStart(options: Record<string, unknown>): Promise<unknown>;
    };
    const application = join(workspace, 'application');
    await createApplicationAgenticStart({
      targetDirectory: application,
      projectName: 'packed-local-proof',
      applik8sVersion: '0.8.0',
      install: false,
      async run(command: { readonly executable: string; readonly arguments: readonly string[] }) {
        expect(command.executable).toBe('bunx');
        expect(command.arguments[0]).toBe('@tanstack/cli@0.70.1');
        await writeOfficialScaffold(application);
      },
    });
    // typecast: the generator owns this package manifest and the assertions
    // below validate every field consumed by this receipt.
    const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    await installGeneratedDependencies(application, manifest);
    expect(manifest.scripts.dev).toBe('vite');
    for (const dependency of [
      '@applik8s/client',
      '@applik8s/core',
      '@applik8s/runtime',
      '@applik8s/runtime-ai',
      '@applik8s/runtime-aws',
      '@applik8s/runtime-kubernetes',
      '@applik8s/runtime-s3',
    ]) expect(manifest.dependencies[dependency]).toBe('0.8.0');
    expect(manifest.devDependencies['@applik8s/compiler']).toBeUndefined();
    expect(manifest.devDependencies.typekro).toBeUndefined();
    await expect(access(join(application, 'node_modules/@applik8s/compiler'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(application, 'node_modules/typekro'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(application, 'node_modules/esbuild'))).rejects.toMatchObject({ code: 'ENOENT' });

    const applicationPath = join(application, 'src/application.ts');
    await writeFile(applicationPath, localApplicationSource(false));
    await execFileAsync(join(root, 'node_modules/.bin/tsr'), ['generate'], {
      cwd: application,
      maxBuffer: 20 * 1024 * 1024,
    });

    const cli = join(packedCli, 'dist/bin.js');
    const first = startCli(cli, application);
    const firstReady = await waitForOutput(first, /Local application ready at (http:\/\/[0-9.]+:[0-9]+)/u, 180_000);
    const firstUrl = firstReady.match?.[1];
    if (!firstUrl) throw new Error('Packed local supervisor did not report its application URL.');
    await expect(fetch(`${firstUrl}/-/healthz`).then((response) => response.json())).resolves.toMatchObject({
      ok: true,
      component: 'applik8s-start',
    });

    const statePath = await findOnlyStatePath(application);
    let state = await readState(statePath);
    const objectStore = state.resources.find((resource) => resource.resourceId.includes('provider.object-storage'));
    if (!objectStore || objectStore.kind !== 'container') throw new Error('Packed local state omitted the object-store container.');
    expect(objectStore?.volumes?.some(({ retained }) => retained)).toBe(true);
    await execFileAsync('docker', ['exec', objectStore.runtimeId, 'sh', '-c', 'printf retained > /data/applik8s-packed-proof']);

    await writeFile(join(application, 'src/brand.ts'), `${await readFile(join(application, 'src/brand.ts'), 'utf8')}\n// packed reload proof\n`);
    await waitForOutput(first, /Reloaded local groups:/u, 180_000);

    await writeFile(applicationPath, localApplicationSource(true));
    await waitForOutput(first, /Reconciled local supervisor plan/u, 180_000);
    state = await readState(statePath);
    expect(state.resources.some((resource) => resource.resourceId.includes('provider.observability'))).toBe(true);
    expect(Object.values(state.bindings)).toContain(firstUrl);

    const web = state.resources.find((resource) => resource.resourceId.startsWith('process:'));
    if (!web || web.kind !== 'process') throw new Error('Packed local state omitted the application process.');
    process.kill(Number(web.runtimeId), 'SIGKILL');
    await waitForOutput(first, /exited unexpectedly and recovered on attempt 1/u, 90_000);
    await expect(fetch(`${firstUrl}/-/healthz`).then((response) => response.status)).resolves.toBe(200);

    first.kill('SIGKILL');
    await waitForExit(first, 15_000);
    const second = startCli(cli, application);
    const secondReady = await waitForOutput(second, /Local application ready at (http:\/\/[0-9.]+:[0-9]+)/u, 180_000);
    expect(secondReady.match?.[1]).toBe(firstUrl);
    state = await readState(statePath);
    const restartedObjectStore = state.resources.find((resource) => resource.resourceId === objectStore.resourceId);
    if (!restartedObjectStore || restartedObjectStore.kind !== 'container') throw new Error('Restarted local state omitted the object-store container.');
    expect(restartedObjectStore?.runtimeId).not.toBe(objectStore?.runtimeId);
    const retained = await execFileAsync('docker', ['exec', restartedObjectStore.runtimeId, 'cat', '/data/applik8s-packed-proof']);
    expect(retained.stdout).toBe('retained');

    second.kill('SIGTERM');
    await waitForExit(second, 30_000);
    await execFileAsync(process.execPath, [cli, 'dev', 'src/application.ts', '--target', 'local', '--profile', 'starter', '--no-portal', '--reset'], {
      cwd: application,
      env: processEnvironment(),
      maxBuffer: 20 * 1024 * 1024,
    });
    await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    for (const volume of restartedObjectStore?.volumes ?? []) {
      if (!volume.retained) continue;
      const inspected = await execFileAsync('docker', ['volume', 'inspect', volume.id]).then(() => true, () => false);
      expect(inspected).toBe(false);
    }
  }, 360_000);
});

interface PackedState {
  readonly bindings: Readonly<Record<string, string | number>>;
  readonly resources: readonly {
    readonly resourceId: string;
    readonly kind: 'process' | 'container';
    readonly runtimeId: string;
    readonly volumes?: readonly { readonly id: string; readonly retained: boolean }[];
  }[];
}

async function packPackage(packagePath: string, destination: string): Promise<string> {
  const packDirectory = join(destination, 'pack');
  const packageDirectory = join(destination, 'package');
  await mkdir(packDirectory, { recursive: true });
  await mkdir(packageDirectory, { recursive: true });
  const packed = await execFileAsync('npm', ['pack', '--json', '--pack-destination', packDirectory, '.'], {
    cwd: join(root, packagePath),
    env: { ...process.env, npm_config_cache: join(destination, 'npm-cache') },
    maxBuffer: 10 * 1024 * 1024,
  });
  // typecast: npm pack owns this JSON receipt; filename is validated before use.
  const [result] = JSON.parse(packed.stdout) as [{ readonly filename?: unknown }];
  if (!result || typeof result.filename !== 'string' || result.filename.length === 0) {
    throw new Error(`${packagePath}: npm pack did not return a tarball filename.`);
  }
  await execFileAsync('tar', ['-xzf', join(packDirectory, result.filename), '-C', packageDirectory, '--strip-components=1']);
  return packageDirectory;
}

async function installGeneratedDependencies(
  application: string,
  manifest: {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  },
): Promise<void> {
  const modules = join(application, 'node_modules');
  await mkdir(modules, { recursive: true });
  const names = [...new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ])].sort();
  for (const name of names) {
    const source = name.startsWith('@applik8s/')
      ? join(root, 'packages', name.slice('@applik8s/'.length))
      : await firstExisting([
        join(root, 'examples/identity-start/node_modules', ...name.split('/')),
        join(root, 'node_modules', ...name.split('/')),
        join(root, 'packages/start-agentic/node_modules', ...name.split('/')),
        join(root, 'packages/cli/node_modules', ...name.split('/')),
      ]);
    if (!source) throw new Error(`Packed local receipt cannot locate installed dependency ${name}.`);
    const destination = join(modules, ...name.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await symlink(source, destination, 'dir');
  }
}

async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  return undefined;
}

async function writeOfficialScaffold(target: string): Promise<void> {
  await mkdir(join(target, 'src/routes'), { recursive: true });
  await writeFile(join(target, 'package.json'), `${JSON.stringify({
    name: 'upstream-scaffold',
    type: 'module',
    scripts: { dev: 'vite --port 3000' },
    dependencies: {
      '@tanstack/react-start': '1.168.28',
      '@tanstack/react-router': '1.168.28',
      react: '^19.1.0',
      'react-dom': '^19.1.0',
    },
    devDependencies: { '@vitejs/plugin-react': '^5.0.4', vite: '^7.1.7' },
  })}\n`);
  await writeFile(join(target, 'src/routes/index.tsx'), 'export const upstreamScaffold = true;\n');
  await writeFile(join(target, 'src/routes/__root.tsx'), `import { createRootRoute, Outlet } from '@tanstack/react-router';
export const Route = createRootRoute({ component: () => <Outlet /> });
`);
  await writeFile(join(target, 'src/router.tsx'), `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() { return createRouter({ routeTree }); }
`);
  await writeFile(join(target, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true,
    },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.ts'],
  })}\n`);
}

function localApplicationSource(observability: boolean): string {
  return `import { ApplicationHost, app, ObjectStorage${observability ? ', Observability' : ''} } from '@applik8s/applik8s';
const application = app('packed-local-proof', { namespace: 'packed-local-proof' });
application.provide(ApplicationHost, ApplicationHost.managed({ replicas: 1, port: 3000 }));
application.provide(ObjectStorage, ObjectStorage.s3({
  name: 'objects',
  bucket: 'packed-local-proof',
  region: 'us-east-1',
  ownership: 'direct-provisioned',
  credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'packed-local-proof-objects', namespace: 'packed-local-proof' },
  provisioning: { kind: 'local-s3', enabled: true, name: 'packed-local-proof-objects', storageSize: '1Gi' },
}));
${observability ? 'application.provide(Observability, Observability.local());' : ''}
export { application };
`;
}

function startCli(cli: string, cwd: string): ChildProcess {
  const child = spawn(process.execPath, [cli, 'dev', 'src/application.ts', '--target', 'local', '--profile', 'starter', '--no-portal'], {
    cwd,
    env: processEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  return child;
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
  };
}

async function waitForOutput(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<{ readonly output: string; readonly match?: RegExpMatchArray }> {
  let output = '';
  return await new Promise((resolveWait, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${pattern}:\n${output}`)), timeoutMs);
    const append = (chunk: Buffer | string): void => {
      output += String(chunk);
      const match = output.match(pattern);
      if (match) finish(undefined, match);
    };
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => finish(new Error(`Process exited (${code ?? signal}) while waiting for ${pattern}:\n${output}`));
    const finish = (error?: Error, match?: RegExpMatchArray): void => {
      clearTimeout(timeout);
      child.stdout?.off('data', append);
      child.stderr?.off('data', append);
      child.off('exit', exit);
      if (error) reject(error); else resolveWait({ output, ...(match ? { match } : {}) });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('exit', exit);
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveWait, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for process exit.')), timeoutMs);
    child.once('exit', () => { clearTimeout(timeout); resolveWait(); });
  });
}

async function findOnlyStatePath(application: string): Promise<string> {
  const localRoot = join(application, '.applik8s/local/local');
  const entries = await readdir(localRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
  expect(directories).toHaveLength(1);
  const [directory] = directories;
  if (!directory) throw new Error(`Local state root ${localRoot} has no target directory.`);
  return join(localRoot, directory, 'state.json');
}

async function readState(path: string): Promise<PackedState> {
  // typecast: state.json is emitted by the local supervisor and every consumed
  // resource/binding field is checked by the lifecycle assertions above.
  return JSON.parse(await readFile(path, 'utf8')) as PackedState;
}
