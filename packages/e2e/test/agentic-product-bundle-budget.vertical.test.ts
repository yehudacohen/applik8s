import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAgenticProductBundles } from '../../../scripts/check-agentic-product-bundles.js';

describe('Agentic Start bundle budget', () => {
  it('measures generated assets and rejects an oversized chunk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-bundle-budget-'));
    const assets = join(root, '.output/public/assets');
    const server = join(root, '.output/server');
    await mkdir(assets, { recursive: true });
    await mkdir(server, { recursive: true });
    await writeFile(join(assets, 'entry.js'), 'export const ready = true;');
    await writeFile(join(assets, 'app.css'), 'body{display:block}');
    await writeFile(join(server, 'index.mjs'), 'export const handler = true;');
    const budget = join(root, 'budget.json');
    await writeFile(budget, JSON.stringify({
      apiVersion: 'applik8s.agenticStartBundleBudget/v1alpha1',
      client: {
        maximumJavaScriptBytes: 100,
        maximumJavaScriptGzipBytes: 100,
        maximumChunkBytes: 10,
        maximumChunkGzipBytes: 100,
        maximumCssBytes: 100,
        maximumCssGzipBytes: 100,
      },
      server: {
        maximumJavaScriptBytes: 100,
        maximumJavaScriptGzipBytes: 100,
        maximumChunkBytes: 100,
        maximumChunkGzipBytes: 100,
      },
    }));
    await expect(checkAgenticProductBundles(root, budget)).rejects.toThrow('largest chunk entry.js');
  });
});
