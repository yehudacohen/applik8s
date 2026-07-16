// typecast-file-boundary: Vite exposes environment-specific plugin/output generics that are narrowed to the build hooks used here.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import {
  applicationFacadeManifest,
  discoverApplicationGraph,
  generatedApplicationFacadeSource,
  generatedApplicationFetchGatewayModules,
  type ApplicationFacadeManifest,
} from '@applik8s/compiler';
import type { PluginOption } from 'vite';

export interface Applik8sViteOptions {
  readonly application?: string;
  readonly compositionName?: string;
  readonly artifactManifest?: string;
}

interface ViteOutputChunkLike {
  readonly type: 'chunk';
  readonly fileName: string;
  readonly isEntry?: boolean;
  readonly code: string;
  readonly modules: Readonly<Record<string, unknown>>;
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
  configResolved(config: { readonly root: string; readonly build: { readonly outDir: string; readonly ssr?: boolean | string } }): void;
  buildStart(): Promise<void>;
  resolveId(source: string, importer?: string, options?: { readonly ssr?: boolean }): string | undefined;
  load(id: string): string | undefined;
  generateBundle(options: { readonly dir?: string }, bundle: Readonly<Record<string, ViteOutputLike>>): Promise<void>;
  closeBundle(): Promise<void>;
}

const forbiddenBrowserPackages = [
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
  let root = process.cwd();
  let outDir = 'dist';
  let ssr = false;
  let application = resolve(root, options.application ?? 'src/application.ts');
  let facade: ApplicationFacadeManifest | undefined;
  const browserFacadeId = '\0applik8s:browser-facade';
  const serverFacadeId = '\0applik8s:server-facade';
  const plugin: Applik8sVitePlugin = {
    name: '@applik8s/vite',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      ssr = Boolean(config.build.ssr);
      application = resolve(root, options.application ?? 'src/application.ts');
    },
    async buildStart() {
      await readFile(application, 'utf8').catch((cause) => {
        throw new Error(`Applik8s Vite could not read application entrypoint ${application}: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
      const discovered = await discoverApplicationGraph(application, options.compositionName ?? 'app');
      if (!discovered.ok) throw new Error(`Applik8s Vite could not discover the ApplicationGraph: ${discovered.error.message}`);
      facade = applicationFacadeManifest(discovered.value);
      const metadataPath = resolve(root, '.applik8s/application-facade.json');
      await mkdir(dirname(metadataPath), { recursive: true });
      await writeFile(metadataPath, `${JSON.stringify(facade, null, 2)}\n`);
      const generatedRoot = resolve(root, '.applik8s/generated');
      await rm(generatedRoot, { recursive: true, force: true });
      const gateway = generatedApplicationFetchGatewayModules(discovered.value);
      if (gateway) {
        await mkdir(generatedRoot, { recursive: true });
        await Promise.all(Object.entries(gateway.files).map(([path, source]) => writeFile(resolve(generatedRoot, path), source)));
      }
    },
    resolveId(source, importer, resolveOptions) {
      if (!importer || source.startsWith('\0')) return undefined;
      const resolved = resolveImport(source, importer);
      if (resolved !== application) return undefined;
      return resolveOptions?.ssr ? serverFacadeId : browserFacadeId;
    },
    load(id) {
      if (id !== browserFacadeId && id !== serverFacadeId) return undefined;
      if (!facade) throw new Error('Applik8s Vite facade was requested before ApplicationGraph discovery completed.');
      return generatedApplicationFacadeSource(facade, id === serverFacadeId ? 'server' : 'browser');
    },
    async generateBundle(outputOptions, bundle) {
      const files = Object.values(bundle)
        .filter((file) => !(ssr && file.type === 'asset' && file.fileName.endsWith('.css')))
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      if (!ssr && isBrowserOutput(outputOptions, files)) assertBrowserDependencyZone(files);
      await writeArtifactManifest(root, application, outDir, options.artifactManifest, ssr ? 'server' : 'browser', files);
    },
    async closeBundle() {
      const nitroRoot = resolve(root, '.output');
      const entrypoint = resolve(nitroRoot, 'server/index.mjs');
      if (!existsSync(entrypoint)) return;
      const files = await Promise.all((await recursiveFiles(nitroRoot)).map(async (path) => ({
        type: 'asset' as const,
        fileName: relative(nitroRoot, path),
        source: await readFile(path),
      })));
      await writeArtifactManifest(root, application, '.output', options.artifactManifest, 'server', files, 'server/index.mjs');
    },
  };
  return plugin as unknown as PluginOption;
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
  const path = resolve(root, configuredPath ?? '.applik8s/start-artifact.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    apiVersion: 'applik8s.startArtifact/v1alpha1',
    application: relative(root, application),
    output,
    target,
    digest: `sha256:${digest}`,
    ...(entrypoint ? { entrypoint } : {}),
    artifacts,
  }, null, 2)}\n`);
}

function resolveImport(source: string, importer: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const base = resolve(dirname(importer), source);
  const candidates = extname(base) ? [base] : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate));
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
  if (directory?.includes('/.output/server') || directory?.endsWith('/server')) return false;
  return !files.some((file) => file.fileName.endsWith('.mjs') || file.fileName.startsWith('_libs/') || file.fileName.startsWith('_ssr/'));
}

function assertBrowserDependencyZone(files: readonly ViteOutputLike[]): void {
  for (const file of files) {
    if (file.type !== 'chunk') continue;
    for (const forbidden of forbiddenBrowserPackages) {
      if (Object.keys(file.modules).some((moduleId) => moduleId.includes(`/node_modules/${forbidden}/`) || moduleId.includes(`/${forbidden}/`))) {
        throw new Error(`Applik8s browser dependency-zone violation: ${file.fileName} contains server-only package ${forbidden}.`);
      }
    }
  }
}

function outputContent(file: ViteOutputLike): string | Uint8Array {
  return file.type === 'chunk' ? file.code : file.source;
}

function outputBytes(file: ViteOutputLike): number {
  const content = outputContent(file);
  return typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;
}
