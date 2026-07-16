// typecast-file-boundary: Vite plugin tests use minimal structural doubles for the hooks exercised by the generic adapter.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applik8sVite, type Applik8sVitePlugin } from '../src/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('framework-neutral Applik8s Vite integration', () => {
  it('discovers the ApplicationGraph and generates facades without source regex parsing', async () => {
    const plugin = adapter();
    plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/client' } });
    await mkdir(join(fixtureRoot, '.applik8s/generated'), { recursive: true });
    await writeFile(join(fixtureRoot, '.applik8s/generated/stale.generated.ts'), 'throw new Error("stale");\n');
    await plugin.buildStart();
    const importer = join(fixtureRoot, 'routes/index.tsx');
    expect(plugin.resolveId('../application', importer, { ssr: false })).toBe('\0applik8s:browser-facade');
    expect(plugin.resolveId('../application', importer, { ssr: true })).toBe('\0applik8s:server-facade');
    const source = plugin.load('\0applik8s:browser-facade') ?? '';
    expect(source).toContain('GuestBookEntry');
    expect(source).toContain('"create": createApplicationMutationOperation');
    expect(source).toContain('"published": createApplicationQueryOperation');
    expect(source).not.toContain('@applik8s/applik8s');
    const manifest = JSON.parse(await readFile(join(fixtureRoot, '.applik8s/application-facade.json'), 'utf8'));
    expect(manifest.models).toEqual([
      expect.objectContaining({
        name: 'GuestBookEntry',
        operations: [
          expect.objectContaining({ id: 'GuestBookEntry.create', name: 'create' }),
          expect.objectContaining({ id: 'GuestBookEntry.published', name: 'published' }),
        ],
      }),
    ]);
    const gateway = await readFile(join(fixtureRoot, '.applik8s/generated/gateway.generated.ts'), 'utf8');
    expect(gateway).toContain('createApplik8sKubernetesGateway');
    expect(gateway).toContain('"GuestBookEntry.create"');
    expect(gateway).toContain('"GuestBookEntry.published"');
    const generatedFiles = await readdir(join(fixtureRoot, '.applik8s/generated'));
    expect(generatedFiles).not.toContain('stale.generated.ts');
    const identityFile = generatedFiles.find((file) => file.startsWith('identity-'));
    expect(identityFile).toBeDefined();
    const identitySource = await readFile(join(fixtureRoot, '.applik8s/generated', identityFile ?? ''), 'utf8');
    expect(identitySource).toContain('fixtureAdmission');
    expect(identitySource).toContain('/packages/vite/test/fixtures/identity');
  }, 15_000);

  it('emits immutable build metadata and rejects browser server-dependency capture', async () => {
    const plugin = adapter();
    plugin.configResolved({ root: fixtureRoot, build: { outDir: 'dist/client' } });
    await plugin.buildStart();
    await plugin.generateBundle({}, {
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: 'export const app=true;', modules: { [`${fixtureRoot}/application.ts`]: {} } },
    });
    const artifact = JSON.parse(await readFile(join(fixtureRoot, '.applik8s/start-artifact.json'), 'utf8'));
    expect(artifact).toMatchObject({ apiVersion: 'applik8s.startArtifact/v1alpha1', target: 'browser' });
    await expect(plugin.generateBundle({}, {
      'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: '', modules: { [`${fixtureRoot}/node_modules/@kubernetes/client-node/dist/index.js`]: {} } },
    })).rejects.toThrow(/browser dependency-zone violation/);
  }, 15_000);
});

function adapter(): Applik8sVitePlugin {
  return applik8sVite({ application: 'application.ts', compositionName: 'app' }) as unknown as Applik8sVitePlugin;
}
