// typecast-file-boundary: Vite exposes environment-specific plugin/output generics that are narrowed to the build hooks used here.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import {
  type ApplicationFacadeManifest,
  applicationFacadeManifest,
  discoverApplicationGraphWithExports,
  generatedApplicationFacadeSource,
  generatedApplicationFetchGatewayModules,
} from '@applik8s/compiler';
import type { PluginOption } from 'vite';

export interface Applik8sViteOptions {
  readonly application?: string;
  readonly compositionName?: string;
  readonly artifactManifest?: string;
  /** Same-origin by default; configure when browser route loaders use a mounted or external gateway path. */
  readonly browserBaseUrl?: string;
  /**
   * Optional framework adapter imported by the generated browser facade before
   * operation handles are created. Framework-neutral Vite leaves this unset.
   */
  readonly browserAdapterModule?: string;
  /** Records a framework adapter's final server bundle after its nested build completes. */
  readonly serverArtifact?: { readonly outputDirectory: string; readonly entrypoint: string };
}

interface ViteOutputChunkLike {
  readonly type: 'chunk';
  readonly fileName: string;
  readonly isEntry?: boolean;
  readonly code: string;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
}

interface ViteOutputAssetLike {
  readonly type: 'asset';
  readonly fileName: string;
  readonly source: string | Uint8Array;
}

type ViteOutputLike = ViteOutputChunkLike | ViteOutputAssetLike;

export interface Applik8sVitePlugin {
  readonly name: '@applik8s/vite';
  readonly enforce: 'pre';
  config(config: unknown, environment: { readonly command: 'build' | 'serve' }): void;
  configResolved(config: { readonly root: string; readonly build: { readonly outDir: string; readonly ssr?: boolean | string } }): Promise<void>;
  buildStart(): Promise<void>;
  resolveId(this: { resolve(source: string, importer?: string, options?: { readonly skipSelf?: boolean; readonly ssr?: boolean }): Promise<{ readonly id: string } | null> }, source: string, importer?: string, options?: { readonly ssr?: boolean }): Promise<string | undefined>;
  load(id: string): string | undefined;
  generateBundle(options: { readonly dir?: string }, bundle: Readonly<Record<string, ViteOutputLike>>): Promise<void>;
  closeBundle(): Promise<void>;
}

const forbiddenBrowserPackages = [
  '@applik8s/applik8s',
  '@applik8s/ai',
  '@applik8s/compiler',
  '@applik8s/core',
  '@applik8s/runtime',
  '@applik8s/runtime-contract',
  '@applik8s/operations',
  '@applik8s/sdk',
  '@applik8s/server',
  '@applik8s/testing',
  '@applik8s/typekro-adapter',
  '@applik8s/typetainer',
  '@kubernetes/client-node',
  'typekro',
  'drizzle-orm/node-postgres',
  'drizzle-orm/postgres-js',
  'postgres',
  '@hatchet-dev/typescript-sdk',
  'node:fs',
  'node:child_process',
] as const;

/** Pure Vite adapter: discovers graph metadata, partitions facades, and records immutable artifacts without deploying. */
export function applik8sVite(options: Applik8sViteOptions = {}): PluginOption {
  const buildStartedAt = Date.now();
  let root = process.cwd();
  let outDir = 'dist';
  let application = resolve(root, options.application ?? 'src/application.ts');
  let developmentServer = false;
  const managedDevelopmentEnvironment = new Set<string>();
  let facade: ApplicationFacadeManifest | undefined;
  let discovery: Promise<void> | undefined;
  const browserFacadeId = '\0applik8s:browser-facade';
  const serverFacadeId = '\0applik8s:server-facade';
  const plugin: Applik8sVitePlugin = {
    name: '@applik8s/vite',
    enforce: 'pre',
    config(_config, environment) {
      developmentServer = environment.command === 'serve';
      if (developmentServer) {
        // Nitro may import the generated gateway before Vite reaches
        // buildStart. Seed only framework-owned, non-production values here;
        // graph discovery replaces the adapter-owned identity below.
        installApplicationViteDevelopmentEnvironment(
          basename(process.cwd()),
          process.cwd(),
          managedDevelopmentEnvironment,
        );
      }
    },
    async configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      application = resolve(root, options.application ?? 'src/application.ts');
      // Nitro resolves its configured handlers while Vite is constructing the
      // development server, before buildStart is guaranteed to run. Generate
      // the gateway at the first hook where the final application root is known
      // so a clean workspace cannot briefly serve a handler with a missing
      // sibling import.
      if (developmentServer) {
        discovery ??= discoverAndGenerate();
        await discovery;
      }
    },
    async buildStart() {
      discovery ??= discoverAndGenerate();
      await discovery;
    },
    async resolveId(source, importer, resolveOptions) {
      if (!importer || source.startsWith('\0')) return undefined;
      const viteResolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
      const resolved = viteResolved ? cleanResolvedId(viteResolved.id) : resolveImport(source, importer);
      if (resolved !== application) return undefined;
      return resolveOptions?.ssr ? serverFacadeId : browserFacadeId;
    },
    load(id) {
      if (id !== browserFacadeId && id !== serverFacadeId) return undefined;
      if (!facade) throw new Error('Applik8s Vite facade was requested before ApplicationGraph discovery completed.');
      return generatedApplicationFacadeSource(
        facade,
        id === serverFacadeId ? 'server' : 'browser',
        {
          ...(options.browserBaseUrl
            ? { browserBaseUrl: options.browserBaseUrl }
            : {}),
          ...(options.browserAdapterModule
            ? { browserAdapterModule: options.browserAdapterModule }
            : {}),
        },
      );
    },
    async generateBundle(outputOptions, bundle) {
      const allFiles = Object.values(bundle);
      const browser = isBrowserOutput(outputOptions, allFiles);
      const files = allFiles
        .filter((file) => !(!browser && file.type === 'asset' && file.fileName.endsWith('.css')))
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      if (browser) assertBrowserDependencyZone(files);
      const outputDirectory = outputOptions.dir
        ? relative(root, resolve(root, outputOptions.dir)) || '.'
        : outDir;
      await writeArtifactManifest(root, application, outputDirectory, options.artifactManifest, browser ? 'browser' : 'server', files);
    },
    async closeBundle() {
      if (!options.serverArtifact) return;
      const nitroRoot = resolve(root, options.serverArtifact.outputDirectory);
      const entrypoint = resolve(nitroRoot, options.serverArtifact.entrypoint);
      // Multi-environment frameworks invoke closeBundle before their nested server
      // build as well as after it. The application compiler owns the definitive
      // missing-artifact diagnostic once the framework build has completed.
      if (!existsSync(entrypoint)) return;
      const entrypointStat = await stat(entrypoint).catch(() => undefined);
      // A prior build's entrypoint can still exist when the browser closeBundle
      // hook runs. Capturing that tree races the nested Nitro build as it replaces
      // hashed client assets, producing a manifest that briefly names absent files.
      // Only the entrypoint written by this build authorizes the final snapshot.
      if (!entrypointStat || entrypointStat.mtimeMs < buildStartedAt) return;
      const files = await Promise.all((await recursiveFiles(nitroRoot))
        // Nitro build metadata contains a wall-clock timestamp and is not
        // required by the deployed Node server. Excluding it keeps the OCI
        // application artifact about executable/runtime inputs only.
        .filter((path) => relative(nitroRoot, path) !== 'nitro.json')
        .map(async (path) => {
          const fileName = relative(nitroRoot, path);
          const source = fileName === options.serverArtifact?.entrypoint
            ? await canonicalizeNitroEntrypoint(path)
            : await readFile(path);
          return { type: 'asset' as const, fileName, source };
        }));
      await writeArtifactManifest(root, application, options.serverArtifact.outputDirectory, options.artifactManifest, 'server', files, options.serverArtifact.entrypoint);
    },
  };
  return plugin as unknown as PluginOption;

  async function discoverAndGenerate(): Promise<void> {
    await readFile(application, 'utf8').catch((cause) => {
      throw new Error(`Applik8s Vite could not read application entrypoint ${application}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    const discovered = await discoverApplicationGraphWithExports(
      application,
      options.compositionName,
    );
    if (!discovered.ok) throw new Error(`Applik8s Vite could not discover the ApplicationGraph: ${discovered.error.message}`);
    if (developmentServer) {
      installApplicationViteDevelopmentEnvironment(
        discovered.value.graph.metadata.name,
        root,
        managedDevelopmentEnvironment,
      );
    }
    facade = applicationFacadeManifest(discovered.value.graph, {
      operationExports: discovered.value.operationExports,
      modelExports: discovered.value.modelExports,
      signalExports: discovered.value.signalExports,
      agentExports: discovered.value.agentExports,
      objectStoreExports: discovered.value.objectStoreExports,
    });
    const metadataPath = resolve(root, '.applik8s/application-facade.json');
    await mkdir(dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(facade, null, 2)}\n`);
    const generatedRoot = resolve(root, '.applik8s/generated');
    const ownedFilesPath = resolve(generatedRoot, 'applik8s-vite-files.json');
    const gateway = generatedApplicationFetchGatewayModules(discovered.value.graph, {
      modelExports: discovered.value.modelExports,
    });
    const files = gateway?.files ?? {};
    const previous = await readFile(ownedFilesPath, 'utf8')
      .then((value) => JSON.parse(value) as unknown)
      .catch(() => []);
    const previousFiles = Array.isArray(previous) ? previous.filter((value): value is string => typeof value === 'string') : [];
    const currentFiles = Object.keys(files).sort();
    await Promise.all(previousFiles
      .filter((path) => !currentFiles.includes(path))
      .map((path) => rm(ownedGeneratedPath(generatedRoot, path), { force: true })));
    await mkdir(generatedRoot, { recursive: true });
    await Promise.all(Object.entries(files).map(async ([path, source]) => {
      const target = ownedGeneratedPath(generatedRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }));
    await writeFile(ownedFilesPath, `${JSON.stringify(currentFiles, null, 2)}\n`);
  }
}

function installApplicationViteDevelopmentEnvironment(
  applicationName: string,
  root: string,
  managed: Set<string>,
): void {
  const namespace = applicationName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  if (!namespace) {
    throw new Error(
      `Applik8s Vite cannot derive a local Kubernetes namespace from application ${JSON.stringify(applicationName)}.`,
    );
  }
  const localSecret = (purpose: string) => createHash('sha256')
    .update(`applik8s:vite-development:${purpose}:${root}:${applicationName}`)
    .digest('hex');
  const defaults = {
    APPLIK8S_APPLICATION_NAME: applicationName,
    APPLIK8S_NAMESPACE: `${namespace}-system`,
    APPLIK8S_PROFILE_VARIANT: 'starter',
    APPLIK8S_CURSOR_SECRET: localSecret('cursor'),
    APPLIK8S_INTERNAL_OPERATION_SECRET: localSecret('internal-operation'),
    APPLIK8S_OBJECT_STORAGE_ENABLED: 'false',
    // The generated object runtime is constructed eagerly, while the disabled
    // binding rejects every object operation before provider I/O. These values
    // are deliberately non-secret and cannot name a production bucket.
    APPLIK8S_OBJECT_STORAGE_BUCKET: 'applik8s-local-disabled',
    APPLIK8S_OBJECT_STORAGE_REGION: 'local',
    APPLIK8S_INSTALLATION_SPEC: '{}',
  } as const;
  for (const [name, value] of Object.entries(defaults)) {
    if (managed.has(name) || !process.env[name]?.trim()) {
      process.env[name] = value;
      managed.add(name);
    }
  }
}

async function canonicalizeNitroEntrypoint(path: string): Promise<Buffer> {
  const source = await readFile(path, 'utf8');
  // Nitro snapshots public-asset mtimes into the server entrypoint for HTTP
  // Last-Modified handling. Those mtimes change on every otherwise identical
  // build. A fixed valid timestamp preserves the HTTP contract and makes the
  // emitted application image reproducible.
  const stableAssetOrder = canonicalizeNitroPublicAssets(source);
  const canonical = stableAssetOrder.replace(
    /("mtime"\s*:\s*")\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z(")/g,
    '$11970-01-01T00:00:00.000Z$2',
  );
  if (canonical !== source) await writeFile(path, canonical);
  return Buffer.from(canonical);
}

function canonicalizeNitroPublicAssets(source: string): string {
  if (!source.includes('//#region #nitro/virtual/public-assets-data')) return source;
  const match = /var public_assets_data_default = (\{[\s\S]*?\});\n\/\/#endregion/.exec(source);
  if (!match?.[1]) throw new Error('Applik8s could not canonicalize Nitro public-asset metadata.');
  const parsed = JSON.parse(match[1]) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Applik8s expected Nitro public-asset metadata to be an object.');
  }
  const sorted = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
  );
  return source.replace(match[0], `var public_assets_data_default = ${JSON.stringify(sorted, null, '\t')};\n//#endregion`);
}

function ownedGeneratedPath(root: string, path: string): string {
  const target = resolve(root, path);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath.startsWith('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    throw new Error(`Applik8s refused generated path outside ${root}: ${path}`);
  }
  return target;
}

async function writeArtifactManifest(
  root: string,
  application: string,
  output: string,
  configuredPath: string | undefined,
  target: 'browser' | 'server',
  files: readonly ViteOutputLike[],
  explicitEntrypoint?: string,
): Promise<void> {
  const artifacts = files.map((file) => ({
    path: file.fileName,
    bytes: outputBytes(file),
    digest: createHash('sha256').update(outputContent(file)).digest('hex'),
  }));
  const entrypoint = explicitEntrypoint ?? (target === 'server'
    ? files.find((file) => file.type === 'chunk' && file.isEntry)?.fileName
      ?? files.find((file) => file.type === 'chunk')?.fileName
    : undefined);
  const digest = createHash('sha256').update(JSON.stringify(artifacts)).digest('hex');
  const path = resolve(root, configuredPath ?? `.applik8s/web-artifacts/${target}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    apiVersion: 'applik8s.webArtifact/v1alpha1',
    application: relative(root, application),
    output,
    target,
    digest: `sha256:${digest}`,
    ...(entrypoint ? { entrypoint } : {}),
    artifacts,
  }, null, 2)}\n`);
  if (!configuredPath && target === 'server') {
    await writeFile(resolve(root, '.applik8s/web-artifact.json'), `${JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1', application: relative(root, application), output, target,
      digest: `sha256:${digest}`, ...(entrypoint ? { entrypoint } : {}), artifacts,
    }, null, 2)}\n`);
  }
}

function resolveImport(source: string, importer: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const base = resolve(dirname(importer), source);
  const candidates = extname(base) ? [base] : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate));
}

function cleanResolvedId(id: string): string {
  const clean = id.split('?', 1)[0] ?? id;
  return clean.startsWith('/@fs/') ? clean.slice('/@fs'.length) : clean;
}

async function recursiveFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : Promise.resolve([path] as readonly string[]);
  }));
  return files.flat().sort();
}

function isBrowserOutput(outputOptions: { readonly dir?: string }, files: readonly ViteOutputLike[]): boolean {
  const directory = outputOptions.dir?.replaceAll('\\', '/');
  if (directory?.includes('/.output/server') || directory?.endsWith('/server') || directory?.endsWith('/ssr') || directory === 'ssr') return false;
  return !files.some((file) => file.fileName.endsWith('.mjs') || file.fileName.startsWith('_libs/') || file.fileName.startsWith('_ssr/'));
}

function assertBrowserDependencyZone(files: readonly ViteOutputLike[]): void {
  for (const file of files) {
    if (file.type !== 'chunk') continue;
    for (const forbidden of forbiddenBrowserPackages) {
      const moduleIds = Object.keys(file.modules);
      const offending = moduleIds.filter((moduleId) =>
        isForbiddenBrowserModule(moduleId, forbidden));
      if (offending.length > 0) {
        const local = moduleIds
          .filter((moduleId) =>
            moduleId.includes('/src/')
            || moduleId.includes('/packages/'))
          .slice(0, 20);
        const importers = files
          .filter((candidate): candidate is ViteOutputChunkLike =>
            candidate.type === 'chunk'
            && Boolean(
              candidate.imports?.includes(file.fileName)
              || candidate.dynamicImports?.includes(file.fileName)
            ))
          .map((candidate) => candidate.fileName);
        const importerDetails = files
          .filter((candidate): candidate is ViteOutputChunkLike =>
            candidate.type === 'chunk'
            && importers.includes(candidate.fileName))
          .map((candidate) => {
            const relevant = Object.keys(candidate.modules)
              .filter((moduleId) =>
                moduleId.includes('/examples/')
                || moduleId.includes('/packages/')
                || moduleId.includes('/node_modules/.bun/typekro@'))
              .slice(0, 20);
            return `${candidate.fileName}[${relevant.join(', ')}]`;
          });
        const traces = browserChunkImportTraces(files, file.fileName)
          .slice(0, 5)
          .map((trace) => trace.join(' -> '));
        throw new Error(
          `Applik8s browser dependency-zone violation: ${file.fileName} contains server-only package ${forbidden}.`
          + ` Offending modules: ${offending.join(', ')}.`
          + ` Importing chunks: ${importers.join(', ') || 'none'}.`
          + ` Importer modules: ${importerDetails.join('; ') || 'none'}.`
          + ` Import traces: ${traces.join('; ') || 'none'}.`
          + ` Local chunk modules: ${local.join(', ')}.`,
        );
      }
    }
  }
}

function browserChunkImportTraces(
  files: readonly ViteOutputLike[],
  target: string,
): readonly (readonly string[])[] {
  const chunks = files.filter(
    (file): file is ViteOutputChunkLike => file.type === 'chunk',
  );
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const parents = new Map<string, string[]>();
  for (const chunk of chunks) {
    for (const dependency of [
      ...(chunk.imports ?? []),
      ...(chunk.dynamicImports ?? []),
    ]) {
      const entries = parents.get(dependency) ?? [];
      entries.push(chunk.fileName);
      parents.set(dependency, entries);
    }
  }
  const traces: string[][] = [];
  const visit = (name: string, suffix: readonly string[], seen: Set<string>) => {
    if (seen.has(name) || traces.length >= 5) return;
    const chunk = byName.get(name);
    if (chunk?.isEntry) {
      traces.push([name, ...suffix]);
      return;
    }
    const next = parents.get(name) ?? [];
    if (next.length === 0) {
      traces.push([name, ...suffix]);
      return;
    }
    const visited = new Set(seen);
    visited.add(name);
    for (const parent of next) visit(parent, [name, ...suffix], visited);
  };
  visit(target, [], new Set());
  return traces;
}

function isForbiddenBrowserModule(
  moduleId: string,
  forbidden: (typeof forbiddenBrowserPackages)[number],
): boolean {
  const normalized = moduleId.replaceAll('\\', '/');
  if (
    normalized.includes(`/node_modules/${forbidden}/`)
    || normalized.includes(`/${forbidden}/`)
  ) {
    return true;
  }
  if (!forbidden.startsWith('@applik8s/')) return false;
  const workspacePackage = forbidden.slice('@applik8s/'.length);
  return normalized.includes(`/packages/${workspacePackage}/`);
}

function outputContent(file: ViteOutputLike): string | Uint8Array {
  return file.type === 'chunk' ? file.code : file.source;
}

function outputBytes(file: ViteOutputLike): number {
  const content = outputContent(file);
  return typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;
}
