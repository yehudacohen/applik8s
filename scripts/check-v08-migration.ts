// typecast-file-boundary: Git fixtures and generated JSON are validated before
// they are accepted as v0.7-to-v0.8 migration evidence.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateApplicationGraph, type ApplicationGraph } from '@applik8s/core';

const execFileAsync = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const releaseTag = 'v0.7.1';
const temporaryRoot = resolve(root, '.applik8s-tmp');
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(join(temporaryRoot, 'v08-migration-'));

try {
  const packagePaths = await gitLines(['ls-tree', '-r', '--name-only', releaseTag, 'packages']);
  const legacyManifests = packagePaths.filter((path) => /^packages\/[^/]+\/package\.json$/u.test(path));
  const removedPackages: string[] = [];
  const removedExports: string[] = [];
  let publicPackagesChecked = 0;
  for (const path of legacyManifests) {
    const previous = JSON.parse(await gitShow(`${releaseTag}:${path}`)) as { readonly private?: boolean; readonly name?: string; readonly exports?: Readonly<Record<string, unknown>> };
    if (previous.private || !previous.name?.startsWith('@applik8s/')) continue;
    publicPackagesChecked += 1;
    const currentPath = resolve(root, path);
    const current = await readFile(currentPath, 'utf8').then((value) => JSON.parse(value) as { readonly exports?: Readonly<Record<string, unknown>> }).catch(() => undefined);
    if (!current) { removedPackages.push(previous.name); continue; }
    for (const key of Object.keys(previous.exports ?? {})) {
      if (!(key in (current.exports ?? {}))) removedExports.push(`${previous.name}${key === '.' ? '' : key.slice(1)}`);
    }
  }
  if (removedPackages.length > 0 || removedExports.length > 0) {
    throw new Error(`v0.7 public surface is not preserved:\n${[
      ...removedPackages.map((name) => `- removed package ${name}`),
      ...removedExports.map((name) => `- removed export ${name}`),
    ].join('\n')}`);
  }

  const guestBookPaths = await gitLines([
    'ls-tree', '-r', '--name-only', releaseTag, 'examples/guestbook-start',
  ]);
  for (const path of guestBookPaths) {
    const relative = path.slice('examples/guestbook-start/'.length);
    if (!relative || relative.startsWith('.applik8s/') || relative.startsWith('.output/')) continue;
    const output = resolve(fixtureRoot, relative);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, await gitShow(`${releaseTag}:${path}`), 'utf8');
  }
  const legacyTsconfig = JSON.parse(await readFile(resolve(fixtureRoot, 'tsconfig.json'), 'utf8')) as {
    extends?: string;
    compilerOptions?: Record<string, unknown>;
  };
  await writeFile(resolve(fixtureRoot, 'tsconfig.json'), `${JSON.stringify({
    ...legacyTsconfig,
    extends: '../../tsconfig.json',
    compilerOptions: {
      ...legacyTsconfig.compilerOptions,
      baseUrl: '.',
      paths: { '#/*': ['src/*'], '@/*': ['src/*'] },
    },
  }, null, 2)}\n`, 'utf8');
  await execFileAsync(resolve(root, 'node_modules/.bin/vite'), ['build'], {
    cwd: fixtureRoot,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    timeout: 300_000,
    maxBuffer: 40 * 1024 * 1024,
  });
  const outDir = resolve(fixtureRoot, 'compiled');
  await execFileAsync('node', [
    resolve(root, 'packages/cli/dist/bin.js'),
    'build', resolve(fixtureRoot, 'src/application.ts'),
    '--typekro', '--composition-name', 'app', '--out-dir', outDir,
  ], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const graph = JSON.parse(await readFile(resolve(outDir, 'typekro/application-graph.json'), 'utf8')) as ApplicationGraph;
  const diagnostics = validateApplicationGraph(graph);
  if (diagnostics.length > 0) throw new Error(`v0.7 GuestBook graph is invalid under v0.8: ${diagnostics.map(({ code, message }) => `${code}: ${message}`).join('; ')}`);
  const preservedCrdIdentities = ['GuestBook', 'GuestBookEntry'] as const;
  for (const expected of preservedCrdIdentities) {
    if (!graph.nodes.some((node) => node.kind === 'crd'
      && node.name === expected
      && node.resource.apiVersion === 'guestbook.applik8s.dev/v1alpha1'
      && node.resource.kind === expected)) {
      throw new Error(`v0.7 GuestBook Kubernetes identity ${expected} was not preserved. Actual nodes: ${graph.nodes.map(({ id, kind }) => `${id} (${kind})`).join(', ')}`);
    }
  }
  const serialized = JSON.stringify(graph);
  if (serialized.includes('coding-agent') || serialized.includes('development-daemon')) {
    throw new Error('v0.7 application migration acquired production development-agent machinery.');
  }
  const bundle = JSON.parse(await readFile(resolve(outDir, 'typekro/typekro-composition.json'), 'utf8')) as {
    readonly apiVersion?: string;
    readonly spec?: { readonly resourceCount?: number };
  };
  if (bundle.apiVersion !== 'applik8s.dev/v1alpha1'
    || !Number.isInteger(bundle.spec?.resourceCount)
    || (bundle.spec?.resourceCount ?? 0) < preservedCrdIdentities.length) {
    throw new Error('v0.7 TypeKro application resources were not retained by v0.8 compilation.');
  }

  console.log(JSON.stringify({
    release: '0.8.0',
    source: releaseTag,
    publicPackagesChecked,
    graphNodes: graph.nodes.length,
    preservedIdentities: preservedCrdIdentities,
    evidenceClass: 'source-upgrade-fixture',
    limitations: [
      'This per-PR gate proves public export and compiler compatibility without mutating a live cluster.',
      'Retained relational/object data and persisted Alchemy/TypeKro ownership remain OrbStack release-candidate evidence.',
    ],
  }, null, 2));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function gitLines(args: readonly string[]): Promise<readonly string[]> {
  const { stdout } = await execFileAsync('git', [...args], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function gitShow(object: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', object], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}
