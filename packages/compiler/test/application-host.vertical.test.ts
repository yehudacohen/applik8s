import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationHost } from '../src/application-host/index.js';

describe('generated ApplicationHost', () => {
  it('lowers an immutable Start artifact into Kubernetes workload resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-'));
    await mkdir(join(root, '.applik8s'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("guestbook");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/start-artifact.json'), JSON.stringify({
      apiVersion: 'applik8s.startArtifact/v1alpha1',
      application: 'src/application.ts',
      output: 'dist/server',
      target: 'server',
      digest: `sha256:${'a'.repeat(64)}`,
      entrypoint: 'server/index.mjs',
      artifacts: [{ path: 'server/index.mjs', bytes: source.length, digest: createHash('sha256').update(source).digest('hex') }],
    }));
    await mkdir(join(root, 'host/context'), { recursive: true });
    await writeFile(join(root, 'host/context/stale.mjs'), 'throw new Error("stale");\n');
    const resources = await emitGeneratedApplicationHost({
      graph: hostGraph(),
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    });
    expect(resources.map((resource) => resource.kind)).toEqual([
      'ServiceAccount',
      'ClusterRole',
      'ClusterRoleBinding',
      'Deployment',
      'Service',
      'NetworkPolicy',
      'PodDisruptionBudget',
    ]);
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      metadata: { namespace: 'guestbook', annotations: { 'applik8s.dev/start-artifact-digest': `sha256:${'a'.repeat(64)}` } },
      spec: {
        replicas: 2,
        template: {
          spec: {
            containers: [expect.objectContaining({
              image: expect.stringMatching(/^applik8s\.local\/guestbook-web:sha256-/),
              imagePullPolicy: 'Never',
              command: ['node', '/app/server/index.mjs'],
              startupProbe: { httpGet: { path: '/__applik8s/v1/healthz', port: 'http' }, periodSeconds: 2, failureThreshold: 30 },
              readinessProbe: { httpGet: { path: '/__applik8s/v1/readyz', port: 'http' }, periodSeconds: 5, failureThreshold: 6 },
              env: expect.arrayContaining([
                { name: 'APPLIK8S_NAMESPACE', value: 'guestbook' },
                { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: 'guestbook-web-gateway-cursor', key: 'key' } } },
              ]),
            })],
          },
        },
      },
    });
    expect(resources.find((resource) => resource.kind === 'ClusterRole')).toMatchObject({
      rules: [expect.objectContaining({ apiGroups: ['guestbook.applik8s.dev'], resources: ['guestbookentries'], verbs: ['create', 'get'] })],
    });
    expect(resources.find((resource) => resource.kind === 'ClusterRoleBinding')).toMatchObject({
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'guestbook-web' },
      subjects: [{ kind: 'ServiceAccount', name: 'guestbook-web', namespace: 'guestbook' }],
    });
    await expect(readFile(join(root, 'host', 'Dockerfile.applik8s-host'), 'utf8')).resolves.toContain('COPY --chown=node:node context/ /app/');
    await expect(readFile(join(root, 'host', 'context/server/index.mjs'), 'utf8')).resolves.toBe(source);
    await expect(readFile(join(root, 'host', 'context/stale.mjs'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'host', 'application-host.json'), 'utf8')).resolves.toContain('ApplicationHostArtifact');
  });

  it('fails closed when the Start artifact has not been built', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-missing-'));
    await expect(emitGeneratedApplicationHost({
      graph: hostGraph(),
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    })).rejects.toThrow(/requires a Vite Start artifact manifest/);
  });
});

function hostGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'guestbook', namespace: 'guestbook' },
    nodes: [{
      id: 'provider.ApplicationHost',
      kind: 'provider',
      name: 'ApplicationHost',
      stability: 'stable',
      interface: 'ApplicationHost',
      implementation: 'kubernetes-application-host',
      config: { host: { kind: 'kubernetes-application-host', namespace: 'guestbook', replicas: 2, port: 3000 } },
    }, {
      id: 'crd.GuestBookEntry',
      kind: 'crd',
      name: 'GuestBookEntry',
      stability: 'stable',
      resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBookEntry', plural: 'guestbookentries', scope: 'Namespaced' },
      materialization: 'kubernetes-crd',
      create: {
        kind: 'kubernetes-create',
        input: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
        authorize: { source: '() => true' },
        place: { source: "() => ({ namespace: 'guestbook', generateName: 'entry-' })" },
      },
    }],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
