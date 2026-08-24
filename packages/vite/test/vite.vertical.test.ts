// typecast-file-boundary: Vite plugin tests use minimal structural doubles for the hooks exercised by the generic adapter.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Applik8sVitePlugin, applik8sVite } from '../src/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('framework-neutral Applik8s Vite integration', () => {
  it('injects a selection-scoped Builder toolbar only into supervised development HTML', () => {
    const names = ['APPLIK8S_DEV_PORTAL_ORIGIN', 'APPLIK8S_DEV_BRIDGE_TOKEN', 'APPLIK8S_DEV_REVISION'] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.APPLIK8S_DEV_PORTAL_ORIGIN = 'http://127.0.0.1:3418';
      process.env.APPLIK8S_DEV_BRIDGE_TOKEN = 'selection-capability';
      process.env.APPLIK8S_DEV_REVISION = 'sha256:revision';
      const development = adapter();
      development.config({}, { command: 'serve' });
      const transformed = development.transformIndexHtml('<html><body><main>Product</main></body></html>');
      expect(transformed).toContain('data-applik8s-development-only="true"');
      expect(transformed).toContain("'/v1/selections'");
      expect(transformed).toContain('selection-capability');
      expect(transformed).not.toContain('sessionToken');

      const production = adapter();
      production.config({}, { command: 'build' });
      expect(production.transformIndexHtml('<html><body>Product</body></html>')).toBe('<html><body>Product</body></html>');
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  it('hydrates framework-owned local runtime values for serve without overriding explicit environment', async () => {
    const names = [
      'APPLIK8S_APPLICATION_NAME',
      'APPLIK8S_NAMESPACE',
      'APPLIK8S_PROFILE_VARIANT',
      'APPLIK8S_CURSOR_SECRET',
      'APPLIK8S_INTERNAL_OPERATION_SECRET',
      'APPLIK8S_OBJECT_STORAGE_ENABLED',
      'APPLIK8S_OBJECT_STORAGE_BUCKET',
      'APPLIK8S_OBJECT_STORAGE_REGION',
      'APPLIK8S_INSTALLATION_SPEC',
    ] as const;
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      process.env.APPLIK8S_CURSOR_SECRET = 'explicit-cursor-secret-that-is-long-enough';
      const plugin = adapter();
      plugin.config({}, { command: 'serve' });
      await plugin.configResolved({
        root: fixtureRoot,
        build: { outDir: 'dist/client' },
      });
      await plugin.buildStart();
      expect(process.env.APPLIK8S_APPLICATION_NAME).toBe('vite-facade-fixture');
      expect(process.env.APPLIK8S_NAMESPACE).toBe('vite-facade-fixture-system');
      expect(process.env.APPLIK8S_PROFILE_VARIANT).toBe('starter');
      expect(process.env.APPLIK8S_CURSOR_SECRET).toBe(
        'explicit-cursor-secret-that-is-long-enough',
      );
      expect(process.env.APPLIK8S_INTERNAL_OPERATION_SECRET).toHaveLength(64);
      expect(process.env.APPLIK8S_OBJECT_STORAGE_ENABLED).toBe('false');
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 120_000);

  it('discovers the ApplicationGraph and generates facades without source regex parsing', async () => {
    const plugin = adapter();
    expect(plugin.config({}, { command: 'serve' })).toMatchObject({
      ssr: { external: ['@duckdb/node-api'] },
      optimizeDeps: { exclude: ['@duckdb/node-api'] },
    });
    await mkdir(join(fixtureRoot, '.applik8s/generated'), { recursive: true });
    await writeFile(join(fixtureRoot, '.applik8s/generated/stale.generated.ts'), 'throw new Error("stale");\n');
    await writeFile(join(fixtureRoot, '.applik8s/generated/adapter-owned.generated.ts'), 'export const adapter = true;\n');
    await writeFile(join(fixtureRoot, '.applik8s/generated/applik8s-vite-files.json'), '["stale.generated.ts"]\n');
    await plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/client' } });
    await expect(readFile(join(fixtureRoot, '.applik8s/generated/gateway.generated.ts'), 'utf8')).resolves.toContain(
      "from '@applik8s/server/kubernetes-gateway'",
    );
    await plugin.buildStart();
    const importer = join(fixtureRoot, 'routes/index.tsx');
    const context = { resolve: async () => ({ id: join(fixtureRoot, 'application.ts') }) };
    expect(await plugin.resolveId.call(context, '#/application', importer, { ssr: false })).toBe('\0applik8s:browser-facade');
    expect(await plugin.resolveId.call(context, '#/application', importer, { ssr: true })).toBe('\0applik8s:server-facade');
    const source = plugin.load('\0applik8s:browser-facade') ?? '';
    expect(source).toContain('GuestBookEntry');
    expect(source).toContain('"create": createApplicationMutationOperation');
    expect(source).toContain('export const CreateEntry = GuestBookEntry["create"]');
    expect(source).toContain('"published": createApplicationQueryOperation');
    expect(source).toContain('export const GuestBookEntryPublished = GuestBookEntry["published"]');
    expect(source).toContain('export const PublishedEntries = GuestBookEntry["published"]');
    expect(source).not.toContain('@applik8s/applik8s');
    const manifest = JSON.parse(await readFile(join(fixtureRoot, '.applik8s/application-facade.json'), 'utf8'));
    expect(manifest.models).toEqual([
      expect.objectContaining({
        name: 'GuestBookEntry',
        operations: [
          expect.objectContaining({
            id: 'GuestBookEntry.create',
            name: 'create',
            exportNames: ['CreateEntry'],
          }),
          expect.objectContaining({
            id: 'GuestBookEntry.published',
            name: 'published',
            exportNames: ['PublishedEntries'],
          }),
        ],
      }),
    ]);
    const gateway = await readFile(join(fixtureRoot, '.applik8s/generated/gateway.generated.ts'), 'utf8');
    expect(gateway).toContain("from '@applik8s/server/kubernetes-gateway'");
    expect(gateway).toContain('"GuestBookEntry.create"');
    expect(gateway).toContain('query:GuestBookEntry.published');
    const generatedFiles = await readdir(join(fixtureRoot, '.applik8s/generated'));
    expect(generatedFiles).not.toContain('stale.generated.ts');
    expect(generatedFiles).toContain('adapter-owned.generated.ts');
    const identityFile = generatedFiles.find((file) => file.startsWith('identity-'));
    expect(identityFile).toBeDefined();
    const identitySource = await readFile(join(fixtureRoot, '.applik8s/generated', identityFile ?? ''), 'utf8');
    expect(identitySource).toContain('fixtureAdmission');
    expect(identitySource).toContain('/packages/vite/test/fixtures/identity');
  }, 60_000);

  it('includes exported durable scheduling in the generated hosted gateway before the server artifact exists', async () => {
    const plugin = adapter({ application: 'schedule-application.ts' });
    plugin.config({}, { command: 'build' });
    await plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/server', ssr: true } });
    await plugin.buildStart();
    const source = await readFile(
      join(fixtureRoot, '.applik8s/generated/gateway.generated.ts'),
      'utf8',
    );
    expect(source).toContain('workflow-start.tenant.rebuild.v1');
    expect(source).toContain('startScheduledWorkflow');
    expect(source).toContain('tenant.rebuild.v1');
    expect(source).toContain("purpose: 'applik8s.workflow-gateway-admission/v1'");
  }, 60_000);

  it('emits immutable build metadata and rejects browser server-dependency capture', async () => {
    const plugin = adapter();
    await plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/client' } });
    await plugin.buildStart();
    await plugin.generateBundle({}, {
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: 'export const app=true;', modules: { [`${fixtureRoot}/application.ts`]: {} } },
    });
    const artifact = JSON.parse(await readFile(join(fixtureRoot, '.applik8s/web-artifacts/browser.json'), 'utf8'));
    expect(artifact).toMatchObject({ apiVersion: 'applik8s.webArtifact/v1alpha1', target: 'browser' });
    await plugin.generateBundle({ dir: join(fixtureRoot, 'node_modules/.nitro/vite/services/ssr') }, {
      'index.js': { type: 'chunk', fileName: 'index.js', code: 'export const server=true;', modules: { [`${fixtureRoot}/server.ts`]: {} } },
    });
    const serverArtifact = JSON.parse(await readFile(join(fixtureRoot, '.applik8s/web-artifacts/server.json'), 'utf8'));
    expect(serverArtifact).toMatchObject({ apiVersion: 'applik8s.webArtifact/v1alpha1', target: 'server' });
    expect(JSON.parse(await readFile(join(fixtureRoot, '.applik8s/web-artifacts/browser.json'), 'utf8'))).toEqual(artifact);
    await expect(plugin.generateBundle({}, {
      'assets/app.js': {
        type: 'chunk',
        fileName: 'assets/app.js',
        code: '',
        modules: {
          [`${fixtureRoot}/node_modules/@applik8s/core/dist/canonical-json.js`]: {},
        },
      },
    })).resolves.toBeUndefined();
    await expect(plugin.generateBundle({}, {
      'assets/app.js': {
        type: 'chunk',
        fileName: 'assets/app.js',
        code: '',
        modules: {
          [join(fixtureRoot, '../../../core/dist/canonical-json.js')]: {},
        },
      },
    })).resolves.toBeUndefined();
    await expect(plugin.generateBundle({}, {
      'assets/app.js': {
        type: 'chunk',
        fileName: 'assets/app.js',
        code: '',
        modules: {
          [`${fixtureRoot}/node_modules/@applik8s/core/dist/index.js`]: {},
        },
      },
    })).rejects.toThrow(/server-only package @applik8s\/core/);
    await expect(plugin.generateBundle({}, {
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: '', modules: { [`${fixtureRoot}/node_modules/@kubernetes/client-node/dist/index.js`]: {} } },
    })).rejects.toThrow(/browser dependency-zone violation/);
    await expect(plugin.generateBundle({}, {
      'assets/app.js': {
        type: 'chunk',
        fileName: 'assets/app.js',
        code: '',
        modules: {
          [join(fixtureRoot, '../../../ai/dist/operation-executor.js')]: {},
        },
      },
    })).rejects.toThrow(/server-only package @applik8s\/ai/);
  }, 60_000);

  it('configures browser authority before generated operations and defers an absent nested server artifact to application compilation', async () => {
    const plugin = adapter({
      browserBaseUrl: '/internal/applik8s',
      browserAdapterModule: '@applik8s/react',
      serverArtifact: { outputDirectory: '.missing-output', entrypoint: 'server/index.mjs' },
    });
    await plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/server', ssr: true } });
    await plugin.buildStart();
    const source = plugin.load('\0applik8s:browser-facade') ?? '';
    expect(source).toContain("import \"@applik8s/react\";");
    expect(source.indexOf('import "@applik8s/react";')).toBeLessThan(
      source.indexOf('export const GuestBookEntry'),
    );
    expect(source.indexOf('configureDefaultApplicationBrowserRuntime')).toBeLessThan(source.indexOf('export const GuestBookEntry'));
    expect(source).toContain("baseUrl: \"/internal/applik8s\"");
    await expect(plugin.closeBundle()).resolves.toBeUndefined();
  }, 60_000);

  it('does not snapshot a previous Nitro output while the current nested build is replacing hashed assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-vite-nitro-snapshot-'));
    try {
      const output = join(root, '.output');
      const entrypoint = join(output, 'server/index.mjs');
      const manifest = join(root, '.applik8s/web-artifact.json');
      await mkdir(dirname(entrypoint), { recursive: true });
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(entrypoint, 'export const oldBuild = true;\n');
      await writeFile(manifest, '{"sentinel":"previous-build"}\n');
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Constructing the adapter marks the beginning of the current build. The
      // entrypoint above is therefore stale and must not authorize a snapshot.
      const plugin = applik8sVite({
        application: 'application.ts',
        serverArtifact: { outputDirectory: '.output', entrypoint: 'server/index.mjs' },
      }) as unknown as Applik8sVitePlugin;
      await plugin.configResolved({ root, build: { outDir: '.output/server', ssr: true } });
      await plugin.closeBundle();
      expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({ sentinel: 'previous-build' });

      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFile(entrypoint, 'export const currentBuild = true;\n');
      await plugin.closeBundle();
      expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
        apiVersion: 'applik8s.webArtifact/v1alpha1',
        target: 'server',
        entrypoint: 'server/index.mjs',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records a reproducible Nitro server artifact without wall-clock build metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-vite-nitro-reproducible-'));
    try {
      const output = join(root, '.output');
      const entrypoint = join(output, 'server/index.mjs');
      await mkdir(dirname(entrypoint), { recursive: true });
      const plugin = applik8sVite({
        application: 'application.ts',
        serverArtifact: { outputDirectory: '.output', entrypoint: 'server/index.mjs' },
      }) as unknown as Applik8sVitePlugin;
      await plugin.configResolved({ root, build: { outDir: '.output/server', ssr: true } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFile(entrypoint, `//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {
  "/z.js": {"mtime":"2026-07-20T12:34:56.789Z"},
  "/a.js": {"mtime":"2026-07-20T12:34:56.789Z"}
};
//#endregion
`);
      await writeFile(join(output, 'nitro.json'), '{"date":"2026-07-20T12:34:56.789Z"}\n');
      await plugin.closeBundle();
      const first = await readFile(join(root, '.applik8s/web-artifacts/server.json'), 'utf8');
      const canonicalEntrypoint = await readFile(entrypoint, 'utf8');
      expect(canonicalEntrypoint).toContain('"mtime": "1970-01-01T00:00:00.000Z"');
      expect(canonicalEntrypoint.indexOf('"/a.js"')).toBeLessThan(canonicalEntrypoint.indexOf('"/z.js"'));
      expect(JSON.parse(first).artifacts).not.toContainEqual(expect.objectContaining({ path: 'nitro.json' }));

      await writeFile(entrypoint, `//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {
  "/a.js": {"mtime":"2026-07-20T12:35:57.890Z"},
  "/z.js": {"mtime":"2026-07-20T12:35:57.890Z"}
};
//#endregion
`);
      await writeFile(join(output, 'nitro.json'), '{"date":"2026-07-20T12:35:57.890Z"}\n');
      await plugin.closeBundle();
      expect(await readFile(join(root, '.applik8s/web-artifacts/server.json'), 'utf8')).toBe(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function adapter(options: Parameters<typeof applik8sVite>[0] = {}): Applik8sVitePlugin {
  return applik8sVite({ application: 'application.ts', ...options }) as unknown as Applik8sVitePlugin;
}
