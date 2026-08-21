// typecast-file-boundary: Local authority tests narrow untyped Kubernetes-shaped transport responses to the exact fields under assertion.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startApplik8sLocalResourceAuthority } from '../src/local-resource-authority.js';
import { createApplik8sLocalResourceClients } from '../src/local-resource.js';

describe('local resource authority', () => {
  it('persists and exposes Kubernetes-shaped create, get, page, and watch semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-local-resources-'));
    const statePath = join(root, 'resources.json');
    const token = 'isolated-local-resource-test-token';
    const authority = await startApplik8sLocalResourceAuthority({ statePath, token });
    const clients = createApplik8sLocalResourceClients({ baseUrl: authority.origin, token });
    try {
      await clients.readiness();
      let resolveWatch!: (value: { readonly phase: string; readonly object: unknown }) => void;
      let rejectWatch!: (cause: unknown) => void;
      const watched = new Promise<{ readonly phase: string; readonly object: unknown }>((resolve, reject) => {
        resolveWatch = resolve;
        rejectWatch = reject;
      });
      const watchController = await clients.watch.watch(
          '/apis/guestbook.example/v1alpha1/namespaces/demo/guestbookentries',
          { resourceVersion: '0' },
          (phase, object) => resolveWatch({ phase, object }),
          (cause) => cause && rejectWatch(cause),
      );
      const created = await clients.objects.createNamespacedCustomObject({
        group: 'guestbook.example',
        version: 'v1alpha1',
        namespace: 'demo',
        plural: 'guestbookentries',
        body: { apiVersion: 'guestbook.example/v1alpha1', kind: 'GuestBookEntry', metadata: { name: 'first', labels: { tenant: 'one' } }, spec: { message: 'hello' } },
      }) as { readonly metadata: { readonly uid: string; readonly resourceVersion: string } };
      expect(created.metadata.uid).toMatch(/^[a-f0-9-]{36}$/u);
      expect(created.metadata.resourceVersion).toBe('1');
      await expect(watched).resolves.toMatchObject({ phase: 'ADDED', object: { metadata: { name: 'first' } } });
      watchController.abort();

      const listed = await clients.objects.listNamespacedCustomObject({
        group: 'guestbook.example', version: 'v1alpha1', namespace: 'demo', plural: 'guestbookentries',
        allowWatchBookmarks: true, limit: 1, labelSelector: 'tenant=one',
      }) as { readonly items: readonly unknown[]; readonly metadata: { readonly resourceVersion: string } };
      expect(listed.items).toHaveLength(1);
      expect(listed.metadata.resourceVersion).toBe('1');
      await expect(clients.objects.getNamespacedCustomObject({
        group: 'guestbook.example', version: 'v1alpha1', namespace: 'demo', plural: 'guestbookentries', name: 'first',
      })).resolves.toMatchObject({ spec: { message: 'hello' } });
      expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ revision: 1, resources: [{ metadata: { name: 'first' } }] });
    } finally {
      await authority.close();
    }
  });

  it('fails closed for invalid credentials and stale pagination cursors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-local-resources-'));
    const authority = await startApplik8sLocalResourceAuthority({ statePath: join(root, 'resources.json'), token: 'correct-token' });
    try {
      const invalid = createApplik8sLocalResourceClients({ baseUrl: authority.origin, token: 'wrong-token' });
      await expect(invalid.readiness()).rejects.toMatchObject({ code: 401 });
      const clients = createApplik8sLocalResourceClients({ baseUrl: authority.origin, token: 'correct-token' });
      for (const name of ['first', 'second']) await clients.objects.createNamespacedCustomObject({
        group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets',
        body: { apiVersion: 'example.dev/v1', kind: 'Widget', metadata: { name } },
      });
      const first = await clients.objects.listNamespacedCustomObject({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', allowWatchBookmarks: true, limit: 1 }) as { readonly metadata: { readonly _continue: string } };
      await clients.objects.createNamespacedCustomObject({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', body: { apiVersion: 'example.dev/v1', kind: 'Widget', metadata: { name: 'third' } } });
      await expect(clients.objects.listNamespacedCustomObject({ group: 'example.dev', version: 'v1', namespace: 'demo', plural: 'widgets', allowWatchBookmarks: true, limit: 1, _continue: first.metadata._continue })).rejects.toMatchObject({ code: 410 });
    } finally {
      await authority.close();
    }
  });
});
