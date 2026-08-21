import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Applik8sLocalResourceStore } from '../src/local-resource-authority.js';
import { startApplik8sLocalOperatorRuntime } from '../src/local-operator-runtime.js';

describe('local operator runtime', () => {
  it('executes the digest-bound dispatcher, hydrates local reads, and converges status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-local-operator-runtime-'));
    const bundle = join(root, 'bundle');
    await mkdir(bundle, { recursive: true });
    const source = join(bundle, 'handler.js');
    const code = `export async function handle(inputJson) {
  const input = JSON.parse(inputJson);
  return JSON.stringify({ operations: [{ kind: 'status', status: { phase: 'Ready', observedName: input.object.metadata.name } }] });
}\n`;
    await writeFile(source, code);
    const digest = `sha256:${createHash('sha256').update(code).digest('hex')}`;
    const manifest = join(root, 'operator-manifest.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.operator/v1alpha1', kind: 'OperatorBundle', metadata: { name: 'widgets' },
      spec: {
        handlerAbi: 'applik8s.handler/v1alpha1',
        handlerExports: [{ handlerId: 'Widget.reconcile.0', exportName: 'handle', resource: { apiVersion: 'example.dev/v1', kind: 'Widget' }, event: 'reconcile' }],
        watches: [{ apiVersion: 'example.dev/v1', kind: 'Widget', plural: 'widgets', scope: 'Namespaced', handlers: ['Widget.reconcile.0'] }],
        bundle: { artifacts: [{ kind: 'javascript-bundle', path: source, digest }] },
      },
    }));
    const store = new Applik8sLocalResourceStore(join(root, 'resources.json'));
    await store.load();
    const runtime = await startApplik8sLocalOperatorRuntime([{ name: 'widgets', manifest, source, digest }], store);
    try {
      await store.create({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets' }, {
        apiVersion: 'example.dev/v1', kind: 'Widget', metadata: { name: 'first' }, spec: { value: 'one' },
      });
      await expect.poll(() => store.get({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', name: 'first' }).status).toEqual({ phase: 'Ready', observedName: 'first' });
      const revision = store.get({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', name: 'first' }).metadata.resourceVersion;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(store.get({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', name: 'first' }).metadata.resourceVersion).toBe(revision);
    } finally {
      runtime.close();
    }
  });
});
