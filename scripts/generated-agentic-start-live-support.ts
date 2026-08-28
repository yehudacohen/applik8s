// typecast-file-boundary: Generated package manifests are validated for the
// fields this qualification helper consumes before restoring their typed view.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { publishablePackageDirectories } from './publishable-packages.mjs';

const execFileAsync = promisify(execFile);

interface PackageManifest {
  readonly name?: unknown;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
}

async function readManifest(path: string): Promise<PackageManifest> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object') {
    throw new Error(`Expected ${path} to contain a package manifest object.`);
  }
  return value as PackageManifest;
}

/**
 * Materialize the local packages declared by a generated application's
 * `workspace:*` dependencies.
 *
 * Generated products deliberately live outside the repository workspace so
 * their lifecycle state can be removed independently. Bun therefore cannot
 * install their workspace ranges itself. Release qualification links every
 * declared local package explicitly and fails closed on an unknown package;
 * package-consumer-smoke separately proves the packed npm artifacts.
 */
export async function materializeGeneratedWorkspaceDependencies(options: {
  readonly workspaceRoot: string;
  readonly targetDirectory: string;
}): Promise<readonly string[]> {
  const packages = new Map<string, string>();
  for (const packageDirectory of publishablePackageDirectories) {
    const absoluteDirectory = join(options.workspaceRoot, packageDirectory);
    const manifest = await readManifest(join(absoluteDirectory, 'package.json'));
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${packageDirectory} does not declare a publishable package name.`);
    }
    if (packages.has(manifest.name)) {
      throw new Error(`Duplicate publishable package name ${manifest.name}.`);
    }
    packages.set(manifest.name, absoluteDirectory);
  }

  const manifest = await readManifest(join(options.targetDirectory, 'package.json'));
  const dependencySections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  const requested = new Set<string>();
  for (const section of dependencySections) {
    if (!section) continue;
    for (const [name, version] of Object.entries(section)) {
      if (version === 'workspace:*') requested.add(name);
    }
  }

  const linked: string[] = [];
  for (const name of [...requested].sort()) {
    const packageDirectory = packages.get(name);
    if (!packageDirectory) {
      throw new Error(
        `Generated application declares unresolved workspace dependency ${name}. `
        + 'Every workspace dependency must name a publishable Applik8s package.',
      );
    }
    const link = join(options.targetDirectory, 'node_modules', ...name.split('/'));
    await mkdir(dirname(link), { recursive: true });
    await rm(link, { recursive: true, force: true });
    await symlink(relative(dirname(link), packageDirectory), link, 'junction');
    linked.push(name);
  }

  if (linked.length === 0) {
    throw new Error('Generated application did not declare any workspace dependencies to materialize.');
  }
  return linked;
}

/**
 * Install the built, publishable package artifacts into a generated product.
 * This deliberately mirrors the npm package boundary rather than exposing
 * workspace source through symlinks. Third-party dependencies are linked from
 * the already frozen repository installation so qualification remains
 * deterministic and does not require registry access.
 */
export async function materializePackedGeneratedWorkspaceDependencies(options: {
  readonly workspaceRoot: string;
  readonly targetDirectory: string;
}): Promise<readonly string[]> {
  const generatedManifest = await readManifest(
    join(options.targetDirectory, 'package.json'),
  );
  const packageEntries: Array<{
    readonly name: string;
    readonly directory: string;
    readonly manifest: PackageManifest;
  }> = [];
  const packageNames = new Set<string>();
  for (const packageDirectory of publishablePackageDirectories) {
    const directory = join(options.workspaceRoot, packageDirectory);
    const manifest = await readManifest(join(directory, 'package.json'));
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${packageDirectory} does not declare a publishable package name.`);
    }
    packageEntries.push({ name: manifest.name, directory, manifest });
    packageNames.add(manifest.name);
  }

  for (const section of [
    generatedManifest.dependencies,
    generatedManifest.devDependencies,
    generatedManifest.peerDependencies,
    generatedManifest.optionalDependencies,
  ]) {
    if (!section) continue;
    for (const [name, version] of Object.entries(section)) {
      if (version === 'workspace:*' && !packageNames.has(name)) {
        throw new Error(
          `Generated application declares unresolved workspace dependency ${name}. `
          + 'Every workspace dependency must name a publishable Applik8s package.',
        );
      }
    }
  }

  const workDirectory = await mkdtemp(join(tmpdir(), 'applik8s-generated-packs-'));
  const packDirectory = join(workDirectory, 'packs');
  const npmCache = join(workDirectory, 'npm-cache');
  const modules = join(options.targetDirectory, 'node_modules');
  await rm(modules, { recursive: true, force: true });
  await mkdir(packDirectory, { recursive: true });

  try {
    for (const entry of packageEntries) {
      const { stdout } = await execFileAsync(
        'npm',
        ['pack', '--json', '--pack-destination', packDirectory, '.'],
        {
          cwd: entry.directory,
          env: { ...process.env, npm_config_cache: npmCache },
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const value: unknown = JSON.parse(stdout);
      const result = Array.isArray(value) ? value[0] : undefined;
      const filename = result && typeof result === 'object'
        ? Reflect.get(result, 'filename')
        : undefined;
      if (typeof filename !== 'string' || filename.length === 0) {
        throw new Error(`${entry.name}: npm pack did not return a tarball filename.`);
      }
      const installDirectory = join(modules, ...entry.name.split('/'));
      await mkdir(installDirectory, { recursive: true });
      await execFileAsync(
        'tar',
        [
          '-xzf',
          join(packDirectory, filename),
          '-C',
          installDirectory,
          '--strip-components=1',
        ],
      );
    }

    const externalDependencies = new Map<string, string>();
    for (const entry of packageEntries) {
      for (const section of [
        entry.manifest.dependencies,
        entry.manifest.peerDependencies,
        entry.manifest.optionalDependencies,
      ]) {
        if (!section) continue;
        for (const name of Object.keys(section)) {
          if (packageNames.has(name)) continue;
          const local = join(entry.directory, 'node_modules', ...name.split('/'));
          const root = join(options.workspaceRoot, 'node_modules', ...name.split('/'));
          externalDependencies.set(name, existsSync(local) ? local : root);
        }
      }
    }
    for (const section of [
      generatedManifest.dependencies,
      generatedManifest.devDependencies,
      generatedManifest.peerDependencies,
      generatedManifest.optionalDependencies,
    ]) {
      if (!section) continue;
      for (const name of Object.keys(section)) {
        if (packageNames.has(name)) continue;
        externalDependencies.set(
          name,
          join(options.workspaceRoot, 'node_modules', ...name.split('/')),
        );
      }
    }

    for (const [name, source] of externalDependencies) {
      if (!existsSync(source)) continue;
      const link = join(modules, ...name.split('/'));
      if (existsSync(link)) continue;
      await mkdir(dirname(link), { recursive: true });
      await symlink(source, link, 'junction');
    }
    await symlink(
      join(options.workspaceRoot, 'node_modules/.bin'),
      join(modules, '.bin'),
      'junction',
    );
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }

  return packageEntries.map((entry) => entry.name).sort();
}

/**
 * Deterministic stand-in for the official TanStack CLI scaffold.
 *
 * Generator contract tests separately execute and pin the official CLI. Live
 * release qualification avoids a network dependency while preserving the
 * exact files onto which the maintained Start templates are overlaid.
 */
export async function writeOfficialTanStackScaffold(
  directory: string,
  projectName: string,
): Promise<void> {
  await mkdir(join(directory, 'src/routes'), { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({
      name: projectName,
      type: 'module',
      scripts: { dev: 'vite --port 3000' },
      dependencies: {
        '@tanstack/react-start': '1.168.28',
        '@tanstack/react-router': '1.168.28',
        react: '^19.1.0',
        'react-dom': '^19.1.0',
      },
      devDependencies: {
        '@vitejs/plugin-react': '^5.0.4',
        vite: '^7.1.7',
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(directory, 'src/routes/index.tsx'),
    'export const upstreamScaffold = true;\n',
  );
  await writeFile(
    join(directory, 'src/routes/__root.tsx'),
    `import { createRootRoute, Outlet } from '@tanstack/react-router';
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
  );
  await writeFile(
    join(directory, 'src/router.tsx'),
    `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}
`,
  );
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: [
        'src/**/*.ts',
        'src/**/*.tsx',
        'vite.config.ts',
        'drizzle.config.ts',
      ],
    }, null, 2)}\n`,
  );
}
