// typecast-file-boundary: Package manifests and Kubernetes mount types are
// validated at this local-filesystem development adapter boundary.
import { Buffer } from 'node:buffer';
import { access, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import type { V1Volume, V1VolumeMount } from '@kubernetes/client-node';

const DEVELOPMENT_SOURCE_PATHS = [
  ['src', 'Directory'],
  ['public', 'Directory'],
  ['drizzle', 'Directory'],
  ['patches', 'Directory'],
  ['package.json', 'File'],
  ['bun.lock', 'File'],
  ['tsconfig.json', 'File'],
  ['vite.config.ts', 'File'],
  ['vitest.config.ts', 'File'],
  ['drizzle.config.ts', 'File'],
] as const;

interface LocalWorkspacePackage {
  readonly name: string;
  readonly path: string;
  readonly manifest: PackageManifest;
}

interface PackageManifest {
  readonly name?: string;
  readonly workspaces?: readonly string[] | {
    readonly packages?: readonly string[];
  };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface ApplicationDevelopmentWorkspace {
  readonly applicationRoot: string;
  readonly installCommand: readonly string[];
  readonly volumes: readonly V1Volume[];
  readonly volumeMounts: readonly V1VolumeMount[];
  readonly workspaceBacked: boolean;
}

/**
 * Creates a closed mount plan. Repository dogfood mounts only the transitive
 * local package closure into an ephemeral workspace; repository roots and
 * environment files never enter the pod.
 */
export async function applicationDevelopmentWorkspace(
  projectRoot: string,
): Promise<ApplicationDevelopmentWorkspace> {
  const sources = await existingDevelopmentSources(projectRoot);
  if (!sources.some((source) => source.path === 'src')) {
    throw new Error(
      `Development project ${projectRoot} has no src directory to mount.`,
    );
  }
  const packages = await localWorkspacePackages(projectRoot);
  const workspaceBacked = packages.length > 0;
  const projectManifest = workspaceBacked
    ? await readPackageManifest(join(projectRoot, 'package.json'))
    : undefined;
  const manifest = projectManifest
    ? Buffer.from(
        JSON.stringify({
          private: true,
          workspaces: ['app', 'packages/*'],
          dependencies: syntheticWorkspaceDependencies(
            projectManifest,
            packages,
          ),
        }),
      ).toString('base64')
    : undefined;
  const applicationRoot = workspaceBacked
    ? '/applik8s-dev-root/app'
    : '/workspace';
  const sourceVolumes = sources.map((source, index) => ({
    name: `applik8s-source-${index}`,
    hostPath: {
      path: join(projectRoot, source.path),
      type: source.type,
    },
  }));
  const sourceMounts = sources.map((source, index) => ({
    name: `applik8s-source-${index}`,
    mountPath: `${applicationRoot}/${source.path}`,
    readOnly: source.type === 'File',
  }));
  const packageVolumes = packages.map((entry, index) => ({
    name: `applik8s-workspace-package-${index}`,
    hostPath: { path: entry.path, type: 'Directory' as const },
  }));
  const packageMounts = packages.map((_entry, index) => ({
    name: `applik8s-workspace-package-${index}`,
    mountPath: `/applik8s-workspace-sources/${index}`,
    readOnly: true,
  }));
  const copyCommands = packages.map((entry, index) => {
    const destination =
      `/applik8s-dev-root/packages/${index}-${basename(entry.path)}`;
    return (
      `mkdir -p ${destination}; `
      + `(cd /applik8s-workspace-sources/${index} && tar --exclude='./node_modules' --exclude='./.git' --exclude='./.env' --exclude='./.env.*' -cf - .) `
      + `| (cd ${destination} && tar -xf -)`
    );
  });
  const installCommand = workspaceBacked
    ? [
        ...copyCommands,
        'cd /applik8s-dev-root',
        `printf '%s' '${manifest}' | base64 -d > package.json`,
        'npx --yes bun@1.3.13 install',
        'cd app',
      ]
    : [
        'cd /workspace',
        'npx --yes bun@1.3.13 install --frozen-lockfile',
      ];
  return {
    applicationRoot,
    installCommand,
    volumes: [...sourceVolumes, ...packageVolumes],
    volumeMounts: [...sourceMounts, ...packageMounts],
    workspaceBacked,
  };
}

async function localWorkspacePackages(
  projectRoot: string,
): Promise<readonly LocalWorkspacePackage[]> {
  const projectManifest = await readPackageManifest(
    join(projectRoot, 'package.json'),
  );
  const requested = workspaceDependencyNames(projectManifest);
  if (requested.length === 0) return [];
  const root = await findWorkspaceRoot(projectRoot, requested);
  if (!root) {
    throw new Error(
      `Development project ${projectRoot} uses workspace:* dependencies, but neither the project nor an ancestor workspace provides ${requested.join(', ')}.`,
    );
  }
  const available = await workspacePackageMap(root);
  const selected = new Map<string, LocalWorkspacePackage>();
  const pending = [...requested];
  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || selected.has(name)) continue;
    const entry = available.get(name);
    if (!entry) {
      throw new Error(
        `Development workspace ${root} does not provide required package ${name}.`,
      );
    }
    await assertNoEnvironmentFiles(entry.path);
    selected.set(name, entry);
    pending.push(
      ...dependencyNames(entry.manifest).filter((dependency) =>
        available.has(dependency),
      ),
    );
  }
  return [...selected.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function findWorkspaceRoot(
  start: string,
  requiredNames: readonly string[],
): Promise<string | undefined> {
  let directory = resolve(start);
  while (true) {
    const manifest = await readPackageManifestIfPresent(
      join(directory, 'package.json'),
    );
    if (workspacePatterns(manifest).length > 0) {
      const packages = await workspacePackageMap(directory);
      if (requiredNames.every((name) => packages.has(name))) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) {
      return undefined;
    }
    directory = parent;
  }
}

async function workspacePackageMap(
  root: string,
): Promise<Map<string, LocalWorkspacePackage>> {
  const rootManifest = await readPackageManifest(join(root, 'package.json'));
  const paths = await expandWorkspacePaths(root, workspacePatterns(rootManifest));
  const packages = new Map<string, LocalWorkspacePackage>();
  for (const path of paths) {
    const manifest = await readPackageManifestIfPresent(
      join(path, 'package.json'),
    );
    if (!manifest?.name) continue;
    if (packages.has(manifest.name)) {
      throw new Error(
        `Development workspace ${root} contains duplicate package name ${manifest.name}.`,
      );
    }
    packages.set(manifest.name, {
      name: manifest.name,
      path,
      manifest,
    });
  }
  return packages;
}

async function expandWorkspacePaths(
  root: string,
  patterns: readonly string[],
): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      paths.push(resolve(root, pattern));
      continue;
    }
    if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) {
      throw new Error(
        `Development workspace pattern ${pattern} is unsupported; use exact package paths or a single trailing /*.`,
      );
    }
    const parent = resolve(root, pattern.slice(0, -2));
    const entries = await readdir(parent, { withFileTypes: true }).catch(
      () => [],
    );
    paths.push(
      ...entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(parent, entry.name)),
    );
  }
  return paths;
}

function workspacePatterns(
  manifest: PackageManifest | undefined,
): readonly string[] {
  if (!manifest?.workspaces) return [];
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return (
    manifest.workspaces as { readonly packages?: readonly string[] }
  ).packages ?? [];
}

function workspaceDependencyNames(
  manifest: PackageManifest,
): readonly string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].flatMap((dependencies) =>
    Object.entries(dependencies ?? {}).flatMap(([name, version]) =>
      version.startsWith('workspace:') ? [name] : [],
    ),
  );
}

function dependencyNames(manifest: PackageManifest): readonly string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].flatMap((dependencies) => Object.keys(dependencies ?? {}));
}

function syntheticWorkspaceDependencies(
  projectManifest: PackageManifest,
  packages: readonly LocalWorkspacePackage[],
): Readonly<Record<string, string>> {
  const workspaceNames = new Set(packages.map((entry) => entry.name));
  const external = Object.fromEntries(
    packages.flatMap((entry) =>
      [
        entry.manifest.dependencies,
        entry.manifest.optionalDependencies,
      ].flatMap((dependencies) =>
        Object.entries(dependencies ?? {}).filter(
          ([name]) => !workspaceNames.has(name),
        ),
      ),
    ),
  );
  return {
    ...external,
    ...Object.fromEntries(
      packages.map((entry) => [entry.name, 'workspace:*']),
    ),
    ...projectManifest.dependencies,
    ...projectManifest.devDependencies,
    ...projectManifest.optionalDependencies,
  };
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  const manifest = await readPackageManifestIfPresent(path);
  if (!manifest) {
    throw new Error(`Development package manifest ${path} does not exist.`);
  }
  return manifest;
}

async function readPackageManifestIfPresent(
  path: string,
): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageManifest;
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

async function assertNoEnvironmentFiles(root: string): Promise<void> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        (entry.name === '.env' || entry.name.startsWith('.env.'))
        && !['.env.example', '.env.sample', '.env.template'].includes(entry.name)
      ) {
        throw new Error(
          `Development workspace package ${root} contains ${entry.name}; package-directory mounts must not expose environment files.`,
        );
      }
      if (
        entry.isDirectory()
        && !['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)
      ) {
        pending.push(join(directory, entry.name));
      }
    }
  }
}

async function existingDevelopmentSources(
  projectRoot: string,
): Promise<readonly {
  readonly path: string;
  readonly type: 'Directory' | 'File';
}[]> {
  const entries = await Promise.all(
    DEVELOPMENT_SOURCE_PATHS.map(async ([path, type]) => ({
      path,
      type,
      exists: await access(join(projectRoot, path))
        .then(() => true)
        .catch(() => false),
    })),
  );
  const patches = entries.find(
    (entry) => entry.path === 'patches' && entry.exists,
  );
  if (patches) {
    await assertNoEnvironmentFiles(join(projectRoot, patches.path));
  }
  return entries
    .filter((entry) => entry.exists)
    .map(({ path, type }) => ({ path, type }));
}
