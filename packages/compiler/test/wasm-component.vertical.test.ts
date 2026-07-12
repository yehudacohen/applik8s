import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

  it('keeps the generated Kubernetes client inside the WASM bundle and routes HTTP through fetch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-kubernetes-componentize-'));
    const originalFetch = globalThis.fetch;

    try {
      const entrypoint = join(dir, 'kubernetes-handler.ts');
      await writeFile(
        entrypoint,
        `import * as k8s from '@kubernetes/client-node';

export async function handle(inputJson: string): Promise<string> {
  JSON.parse(inputJson);
  const config = new k8s.KubeConfig();
  config.loadFromOptions({
    clusters: [{ name: 'cluster', server: 'http://kubernetes.default.svc' }],
    users: [{ name: 'runtime' }],
    contexts: [{ name: 'runtime', cluster: 'cluster', user: 'runtime' }],
    currentContext: 'runtime',
  });
  const core = config.makeApiClient(k8s.CoreV1Api);
  const result = await core.listNamespace({ limit: 1 });
  return JSON.stringify({ operations: [{ kind: 'status', status: { phase: 'Ready', count: result.items.length, name: result.items[0]?.metadata?.name } }] });
}
`
      );

      const bundle = await bundleHandlerEntrypoint({
        entrypoint,
        outDir: join(dir, 'bundle'),
        portability: { allowNetworkAccess: true },
      });
      const wit = await emitHandlerWitArtifact({ outDir: join(dir, 'contract') });
      expect(bundle.ok).toBe(true);
      expect(wit.ok).toBe(true);
      if (!bundle.ok || !wit.ok) return;

      const bundleSource = await readFile(bundle.value.javascriptBundlePath, 'utf8');
      // typecast: esbuild owns this JSON artifact and the test only consumes its documented inputs map.
      const metafile = JSON.parse(await readFile(bundle.value.metafilePath, 'utf8')) as {
        readonly inputs: Readonly<Record<string, unknown>>;
      };
      const inputs = Object.keys(metafile.inputs);
      expect(inputs.some((input) => input.endsWith('/gen/apis/CoreV1Api.js'))).toBe(true);
      expect(inputs.some((input) => input.endsWith('/config.js'))).toBe(false);
      expect(inputs.some((input) => input.endsWith('/attach.js'))).toBe(false);
      expect(Buffer.byteLength(bundleSource)).toBeLessThan(5_000_000);

      // typecast: the fixture implements the fetch call shape used by the generated Kubernetes client.
      globalThis.fetch = (async (_input, init) => {
        new Headers(init?.headers);
        return new Response(JSON.stringify({ apiVersion: 'v1', kind: 'NamespaceList', metadata: {}, items: [{ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'fixture' }, spec: {}, status: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;
      // static-import-exception: runtime-created proof artifact; typecast: its generated module has the stable string-in/string-out handle contract.
      const imported = await import(`${pathToFileURL(bundle.value.javascriptBundlePath).href}?proof=${Date.now()}`) as {
        readonly handle: (input: string) => Promise<string>;
      };
      expect(JSON.parse(await imported.handle(JSON.stringify({ reconcile: 'fixture' })))).toEqual({ operations: [{ kind: 'status', status: { phase: 'Ready', count: 1, name: 'fixture' } }] });
      expect(bundleSource).not.toContain('fixture-token-that-must-not-enter-artifacts');

      const component = await emitWasmComponentArtifact({
        javascriptBundlePath: bundle.value.javascriptBundlePath,
        witPath: wit.value.path,
        outDir: join(dir, 'wasm'),
      });
      expect(component.ok).toBe(true);
      if (component.ok) {
        expect((await stat(component.value.path)).size).toBeGreaterThan(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
