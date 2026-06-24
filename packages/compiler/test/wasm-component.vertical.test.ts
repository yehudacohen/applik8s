import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { bundleHandlerEntrypoint, emitHandlerWitArtifact, emitWasmComponentArtifact } from '../src/index.js';

describe('ComponentizeJS WASM artifact emission', () => {
  it('turns a bundled handler module into a WebAssembly component artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-componentize-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `export function handle(inputJson: string): string {
  return inputJson;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });
      const wit = await emitHandlerWitArtifact({ outDir: join(dir, 'contract') });

      expect(bundle.ok).toBe(true);
      expect(wit.ok).toBe(true);
      if (!bundle.ok || !wit.ok) {
        return;
      }

      const component = await emitWasmComponentArtifact({
        javascriptBundlePath: bundle.value.javascriptBundlePath,
        witPath: wit.value.path,
        outDir: join(dir, 'wasm'),
      });

      expect(component.ok).toBe(true);
      if (component.ok) {
        const bytes = await readFile(component.value.path);

        expect(component.value.backend).toBe('componentize-js');
        expect(component.value.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect((await stat(component.value.path)).size).toBeGreaterThan(0);
        expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
