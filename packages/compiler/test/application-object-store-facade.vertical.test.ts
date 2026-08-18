import { describe, expect, it } from 'vitest';
import {
  applicationFacadeManifest,
  generatedApplicationFacadeSource,
} from '../src/application-facade/index.js';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';

describe('application object-store facade exports', () => {
  it('preserves the authored entrypoint alias in the browser facade', async () => {
    const discovered = await discoverApplicationGraphWithExports(
      new URL('./fixtures/v07-object-store-app.ts', import.meta.url).pathname,
      'objectStoreProof',
    );
    expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
    if (!discovered.ok) return;
    expect(discovered.value.objectStoreExports).toEqual([
      { name: 'ArtifactObjects', objectStoreName: 'agentic-artifacts' },
    ]);
    const manifest = applicationFacadeManifest(discovered.value.graph, {
      objectStoreExports: discovered.value.objectStoreExports,
    });
    expect(manifest.objectStores[0]).toMatchObject({
      name: 'agentic-artifacts',
      exportName: 'AgenticArtifacts',
      exportNames: ['AgenticArtifacts', 'ArtifactObjects'],
    });
    expect(generatedApplicationFacadeSource(manifest, 'browser')).toContain(
      'export const ArtifactObjects = AgenticArtifacts;',
    );
  }, 30_000);
});
