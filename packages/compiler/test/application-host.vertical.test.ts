// typecast-file-boundary: host compiler fixtures inspect generated Kubernetes structures after asserting their kinds and paths.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  applicationGraphWithInferredApplicationHost,
  emitGeneratedApplicationHost,
} from '../src/application-host/index.js';

describe('generated ApplicationHost', () => {
  it('infers one host from a built Start server artifact without overriding an authored host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-inference-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await writeFile(
      join(root, '.applik8s/web-artifacts/server.json'),
      JSON.stringify({
        apiVersion: 'applik8s.webArtifact/v1alpha1',
        application: 'src/application.ts',
        output: 'dist/server',
        target: 'server',
        digest: `sha256:${'f'.repeat(64)}`,
        entrypoint: 'server/index.mjs',
        artifacts: [],
      }),
    );
    const withoutHost = {
      ...hostGraph(),
      nodes: hostGraph().nodes.filter(
        (node) => node.kind !== 'provider'
          || node.interface !== 'ApplicationHost',
      ),
    };
    const inferred = await applicationGraphWithInferredApplicationHost(
      withoutHost,
      join(root, 'src/application.ts'),
    );
    expect(
      inferred.nodes.filter(
        (node) => node.kind === 'provider'
          && node.interface === 'ApplicationHost',
      ),
    ).toEqual([expect.objectContaining({
      id: 'provider.ApplicationHost',
      implementation: 'managed-application-host',
      config: {
        host: {
          kind: 'managed-application-host',
          name: 'guestbook-app',
          namespace: 'guestbook',
          replicas: 1,
          port: 3000,
        },
      },
    })]);

    const authored = hostGraph();
    expect(
      await applicationGraphWithInferredApplicationHost(
        authored,
        join(root, 'src/application.ts'),
      ),
    ).toBe(authored);
  });

  it('lowers an immutable web artifact into Kubernetes workload resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("guestbook");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1',
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
      'Role',
      'RoleBinding',
      'Deployment',
      'Service',
      'NetworkPolicy',
      'PodDisruptionBudget',
    ]);
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      metadata: { namespace: 'guestbook', annotations: { 'applik8s.dev/web-artifact-digest': `sha256:${'a'.repeat(64)}` } },
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
                { name: 'APPLIK8S_APPLICATION_NAME', value: 'guestbook' },
                { name: 'APPLIK8S_NAMESPACE', value: 'guestbook' },
                { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: 'guestbook-web-gateway-cursor', key: 'key' } } },
              ]),
            })],
          },
        },
      },
    });
    expect(resources.find((resource) => resource.kind === 'Role')).toMatchObject({
      metadata: { namespace: 'guestbook' },
      rules: [expect.objectContaining({ apiGroups: ['guestbook.applik8s.dev'], resources: ['guestbookentries'], verbs: ['create', 'get'] })],
    });
    expect(resources.find((resource) => resource.kind === 'RoleBinding')).toMatchObject({
      metadata: { namespace: 'guestbook' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'guestbook-web' },
      subjects: [{ kind: 'ServiceAccount', name: 'guestbook-web', namespace: 'guestbook' }],
    });
    await expect(readFile(join(root, 'host', 'Dockerfile.applik8s-host'), 'utf8')).resolves.toContain('COPY --chown=node:node context/ /app/');
    await expect(readFile(join(root, 'host', 'context/server/index.mjs'), 'utf8')).resolves.toBe(source);
    await expect(readFile(join(root, 'host', 'context/stale.mjs'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'host', 'application-host.json'), 'utf8')).resolves.toContain('ApplicationHostArtifact');
  });

  it('fails closed when the web artifact has not been built', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-missing-'));
    await expect(emitGeneratedApplicationHost({
      graph: hostGraph(),
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    })).rejects.toThrow(/requires a Vite web artifact manifest/);
  });

  it('keeps the generated host Service cluster-local when exposure owns a separate NodePort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-node-port-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("guestbook");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1', application: 'src/application.ts', output: 'dist/server', target: 'server',
      digest: `sha256:${'b'.repeat(64)}`, entrypoint: 'server/index.mjs',
      artifacts: [{ path: 'server/index.mjs', bytes: source.length, digest: createHash('sha256').update(source).digest('hex') }],
    }));
    const resources = await emitGeneratedApplicationHost({
      graph: hostGraph(true),
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    });
    expect(resources.find((resource) => resource.kind === 'Service')).toMatchObject({
      metadata: { name: 'guestbook-web', namespace: 'guestbook' },
      spec: { ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
    });
    expect(resources.find((resource) => resource.kind === 'Service')?.spec).not.toHaveProperty('type');
  });

  it('injects object-store coordinates and Secret keys only into the server host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-objects-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("guestbook");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1', application: 'src/application.ts', output: 'dist/server', target: 'server',
      digest: `sha256:${'c'.repeat(64)}`, entrypoint: 'server/index.mjs',
      artifacts: [{ path: 'server/index.mjs', bytes: source.length, digest: createHash('sha256').update(source).digest('hex') }],
    }));
    const baseGraph = hostGraph(false, true, true, true);
    const graph: ApplicationGraph = { ...baseGraph, nodes: [...baseGraph.nodes, {
      id: 'gateway.account', kind: 'gateway', name: 'account', stability: 'stable', visibility: 'public', materialization: 'generatedDeployment',
      queries: [], commands: [], subscriptions: [],
      deployment: { namespace: 'guestbook', image: 'gateway', replicas: 1, port: 8080 },
      cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'guestbook-shared-runtime', namespace: 'guestbook', key: 'signing-key' },
    } as unknown as ApplicationGraph['nodes'][number], {
      id: 'gateway.agent-tools', kind: 'gateway', name: 'agent-tools', stability: 'stable', visibility: 'internal', materialization: 'generatedDeployment',
      queries: [], commands: [], subscriptions: [],
      deployment: { namespace: 'guestbook', image: 'agent-tools', replicas: 1, port: 8080 },
      cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'guestbook-agent-tools', namespace: 'guestbook', key: 'key' },
    } as unknown as ApplicationGraph['nodes'][number]] };
    const resources = await emitGeneratedApplicationHost({ graph, entrypoint: join(root, 'src/application.ts'), outDir: join(root, 'host') });
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: { template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_OBJECT_STORAGE_ENABLED', value: 'true' },
        { name: 'APPLIK8S_OBJECT_STORAGE_BUCKET', value: 'guestbook-media' },
        { name: 'APPLIK8S_OBJECT_STORAGE_REGION', value: 'us-east-1' },
        { name: 'APPLIK8S_OBJECT_STORAGE_HOST', valueFrom: { configMapKeyRef: { name: 'guestbook-media', key: 'BUCKET_HOST' } } },
        { name: 'APPLIK8S_OBJECT_STORAGE_PORT', valueFrom: { configMapKeyRef: { name: 'guestbook-media', key: 'BUCKET_PORT' } } },
        { name: 'APPLIK8S_OBJECT_STORAGE_ENDPOINT', value: 'http://$(APPLIK8S_OBJECT_STORAGE_HOST):$(APPLIK8S_OBJECT_STORAGE_PORT)' },
        { name: 'APPLIK8S_CURSOR_SECRET', valueFrom: { secretKeyRef: { name: 'guestbook-shared-runtime', key: 'signing-key' } } },
        { name: 'AWS_ACCESS_KEY_ID', valueFrom: { secretKeyRef: { name: 'guestbook-media', key: 'AWS_ACCESS_KEY_ID' } } },
        { name: 'AWS_SECRET_ACCESS_KEY', valueFrom: { secretKeyRef: { name: 'guestbook-media', key: 'AWS_SECRET_ACCESS_KEY' } } },
      ]) })] } } },
    });
  });

  it('stringifies installation-derived scalar values used as container environment variables', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-object-expressions-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("guestbook");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1', application: 'src/application.ts', output: 'dist/server', target: 'server',
      digest: `sha256:${'d'.repeat(64)}`, entrypoint: 'server/index.mjs',
      artifacts: [{ path: 'server/index.mjs', bytes: source.length, digest: createHash('sha256').update(source).digest('hex') }],
    }));
    const resources = await emitGeneratedApplicationHost({
      graph: hostGraph(false, true, '${schema.spec.features.media}'),
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    });
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: { template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_OBJECT_STORAGE_ENABLED', value: '${string(schema.spec.features.media)}' },
      ]) })] } } },
    });
  });

  it('injects the internal-operation authority into an agentic application host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-agentic-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("agentic");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1',
      application: 'src/application.ts',
      output: 'dist/server',
      target: 'server',
      digest: `sha256:${'e'.repeat(64)}`,
      entrypoint: 'server/index.mjs',
      artifacts: [{
        path: 'server/index.mjs',
        bytes: source.length,
        digest: createHash('sha256').update(source).digest('hex'),
      }],
    }));
    const base = hostGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'aiAgent.researcher',
          kind: 'aiAgent',
          name: 'researcher',
          stability: 'stable',
        } as unknown as ApplicationGraph['nodes'][number],
      ],
    };
    const resources = await emitGeneratedApplicationHost({
      graph,
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    });
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: { template: { spec: { containers: [expect.objectContaining({
        env: expect.arrayContaining([{
          name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
          valueFrom: {
            secretKeyRef: {
              name: 'guestbook-internal-operation',
              key: 'key',
            },
          },
        }]),
      })] } } },
    });
  });

  it('materializes fixed schedules as bounded CronJobs and wires dynamic schedule authority into the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-schedules-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("schedules");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1', application: 'src/application.ts', output: 'dist/server', target: 'server',
      digest: `sha256:${'9'.repeat(64)}`, entrypoint: 'server/index.mjs',
      artifacts: [{ path: 'server/index.mjs', bytes: source.length, digest: createHash('sha256').update(source).digest('hex') }],
    }));
    const base = hostGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [...base.nodes, {
        id: 'provider.scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable', interface: 'Scheduler', implementation: 'target-selected', config: {},
      }, {
        id: 'model.Note', kind: 'model', name: 'Note', stability: 'stable', native: 'relational', source: { kind: 'drizzle', tableName: 'notes', exportName: 'notes' },
        schema: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } }, relationships: [], operations: [], events: [],
        database: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
        runtime: { connectionEnvName: 'DATABASE_URL', database: 'app', secretName: 'guestbook-db-app', secretKey: 'uri' },
      }, {
        id: 'schedule.cleanup.v1', kind: 'schedule', name: 'cleanup.v1', stability: 'stable', scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
        definition: { id: 'cleanup.v1', configuration: 'fixed', every: '15m', timezone: 'UTC', overlap: 'skip', misfires: 'latest', maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3600 }, requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' } },
        handler: { source: 'async () => undefined' }, functionNative: true,
      }] as ApplicationGraph['nodes'],
    };
    const resources = await emitGeneratedApplicationHost({ graph, entrypoint: join(root, 'src/application.ts'), outDir: join(root, 'host') });
    expect(resources.map(({ kind }) => kind)).toContain('CronJob');
    expect(resources.find(({ kind }) => kind === 'CronJob')).toMatchObject({
      metadata: { namespace: 'guestbook' },
      spec: { schedule: '*/15 * * * *', timeZone: 'UTC', concurrencyPolicy: 'Forbid', jobTemplate: { spec: { backoffLimit: 3 } } },
    });
    expect(JSON.stringify(resources.find(({ kind }) => kind === 'CronJob'))).toContain('/__applik8s/v1/internal/schedules/occurrences');
    expect(resources.find(({ kind }) => kind === 'Deployment')).toMatchObject({
      spec: { template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_INTERNAL_OPERATION_SECRET', valueFrom: { secretKeyRef: { name: 'guestbook-internal-operation', key: 'key' } } },
        { name: 'APPLIK8S_SCHEDULE_DATABASE_URL', valueFrom: { secretKeyRef: { name: 'guestbook-db-app', key: 'uri', optional: false } } },
      ]) })] } } },
    });
    expect(resources.find(({ kind }) => kind === 'Role')).toMatchObject({
      rules: expect.arrayContaining([{ apiGroups: ['batch'], resources: ['cronjobs'], verbs: ['create', 'delete', 'get', 'update'] }]),
    });
  });

  it('projects only a declared identity-admission database binding into the server host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-host-identity-db-'));
    await mkdir(join(root, '.applik8s/web-artifacts'), { recursive: true });
    await mkdir(join(root, 'dist/server/server'), { recursive: true });
    const source = 'console.log("identity");\n';
    await writeFile(join(root, 'dist/server/server/index.mjs'), source);
    await writeFile(join(root, '.applik8s/web-artifacts/server.json'), JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1',
      application: 'src/application.ts',
      output: 'dist/server',
      target: 'server',
      digest: `sha256:${'f'.repeat(64)}`,
      entrypoint: 'server/index.mjs',
      artifacts: [{
        path: 'server/index.mjs',
        bytes: source.length,
        digest: createHash('sha256').update(source).digest('hex'),
      }],
    }));
    const base = hostGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'provider.identity-provider',
          kind: 'provider',
          name: 'IdentityProvider',
          stability: 'stable',
          interface: 'IdentityProvider',
          implementation: 'identity-provider',
          config: {
            identityRuntime: {
              databaseProvider: {
                interface: 'TransactionalDatabase',
                nodeId: 'provider.transactional-database.primary',
              },
            },
          },
        },
        {
          id: 'model.workspace',
          kind: 'model',
          name: 'Workspace',
          stability: 'stable',
          runtime: {
            provider: 'postgres',
            authorityName: 'application',
            name: 'Workspace',
            database: 'guestbook',
            clusterName: 'guestbook-db',
            secretName: 'guestbook-db-app',
            secretNamespace: 'guestbook',
            secretKey: 'uri',
            connectionEnvName: 'APPLIK8S_DATABASE_APPLICATION_URL',
            storageShape: 'native-relational',
            tableName: 'workspaces',
            constraints: [],
            indexes: [],
            retention: { mode: 'retain' },
            nativeRelational: {
              identity: { property: 'id', column: 'id' },
              columns: [{ property: 'id', column: 'id' }],
            },
          },
        },
      ] as ApplicationGraph['nodes'],
      providerRequirements: [{
        id: 'requirement.model.workspace.database',
        interface: 'TransactionalDatabase',
        consumer: { nodeId: 'model.workspace' },
        provider: {
          interface: 'TransactionalDatabase',
          nodeId: 'provider.transactional-database.primary',
        },
        required: true,
        purpose: 'transactionalDatabase',
        diagnostics: {
          missing: 'missing',
          ambiguous: 'ambiguous',
        },
      }],
    };
    const resources = await emitGeneratedApplicationHost({
      graph,
      entrypoint: join(root, 'src/application.ts'),
      outDir: join(root, 'host'),
    });
    expect(resources.find((resource) => resource.kind === 'Deployment')).toMatchObject({
      spec: {
        template: {
          spec: {
            containers: [expect.objectContaining({
              env: expect.arrayContaining([{
                name: 'APPLIK8S_DATABASE_APPLICATION_URL',
                valueFrom: {
                  secretKeyRef: {
                    name: 'guestbook-db-app',
                    key: 'uri',
                    optional: false,
                  },
                },
              }]),
            })],
          },
        },
      },
    });
  });
});

function hostGraph(
  nodePort = false,
  objects = false,
  objectStorageEnabled: boolean | string = true,
  objectBucketClaim = false,
): ApplicationGraph {
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
    }, ...(objects ? [{
      id: 'provider.ObjectStorage',
      kind: 'provider' as const,
      name: 'ObjectStorage',
      stability: 'stable' as const,
      interface: 'ObjectStorage' as const,
      implementation: 's3',
      config: { objectStorage: {
        kind: 's3',
        enabled: objectStorageEnabled,
        bucket: 'guestbook-media',
        region: 'us-east-1',
        ...(objectBucketClaim
          ? {
              ownership: 'direct-provisioned',
              provisioning: {
                kind: 'object-bucket-claim',
                claimName: 'guestbook-media',
                storageClassName: 'rook-ceph-bucket',
              },
            }
          : { endpoint: 'http://rook-rgw.guestbook.svc:80' }),
        forcePathStyle: true,
        credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'guestbook-media', namespace: 'guestbook' },
      } },
    }, {
      id: 'objectStore.attachments',
      kind: 'objectStore' as const,
      name: 'attachments',
      stability: 'stable' as const,
      provider: { interface: 'ObjectStorage' as const, nodeId: 'provider.ObjectStorage' },
      objectMode: 'immutable' as const,
      maxObjectBytes: 25_000_000,
      contentTypes: ['image/png'],
      browserAccess: { upload: 'signed' as const, download: 'signed' as const, downloadAccess: 'owner' as const, ttlSeconds: 600 },
      integrity: 'sha256' as const,
      credentials: 'server-only' as const,
      deletion: 'explicit' as const,
    }] : []), ...(nodePort ? [{
      id: 'exposure.web',
      kind: 'exposure' as const,
      name: 'web',
      stability: 'stable' as const,
      provider: { interface: 'HttpExposure' as const, nodeId: 'provider.HttpExposure' },
      service: 'guestbook-web',
      hostnames: ['guestbook.localhost'],
      tlsIntent: { mode: 'disabled' as const },
      dnsIntent: { mode: 'disabled' as const },
      publicUrl: 'http://127.0.0.1:30080',
      transport: { kind: 'node-port' as const, host: '127.0.0.1', nodePort: 30_080 },
      readiness: { ingress: 'notRequested' as const, service: 'resourceApplied' as const, loadBalancer: 'notRequested' as const, certificate: 'notRequested' as const, dns: 'notRequested' as const, publicUrl: 'derived' as const },
      generatedResources: [],
    }] : [])],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
