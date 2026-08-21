// typecast-file-boundary: Supervisor fixtures preserve exact plan discriminants and inspect optional binding arrays after asserting their fixture shape.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalSupervisorPlan } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import {
  type LocalSupervisorDriver,
  startLocalSupervisor,
} from '../src/local-supervisor.js';
import { readLocalRuntimeArtifacts } from '../src/local-development-command.js';

describe('local supervisor', () => {
  it('admits only digest-verified compiler runtime artifacts inside the build root', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-artifacts-'));
    const artifactDirectory = join(root, 'processors', 'example');
    await mkdir(artifactDirectory, { recursive: true });
    const source = join(artifactDirectory, 'processor.mjs');
    const contents = 'export const ready = true;\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{ name: 'example', nodeId: 'processor.example', source, digest }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([{
      name: 'example', nodeId: 'processor.example', role: 'processor', source, digest,
    }]);
    await writeFile(source, 'export const ready = false;\n');
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/digest mismatch/u);

    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{ name: 'escape', nodeId: 'processor.escape', source: join(root, '..', 'escape.mjs'), digest }] },
    }));
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/escapes its build root/u);
  });

  it('selects paired local artifacts only for local execution and rejects partial local variants', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-variant-'));
    const artifactDirectory = join(root, 'lakehouse', 'example');
    await mkdir(artifactDirectory, { recursive: true });
    const cloudSource = join(artifactDirectory, 'publisher.mjs');
    const localSource = join(artifactDirectory, 'publisher.local.mjs');
    const cloudContent = 'export const provider = "s3";\n';
    const localContent = 'export const provider = "duckdb";\n';
    await writeFile(cloudSource, cloudContent);
    await writeFile(localSource, localContent);
    const cloudDigest = `sha256:${createHash('sha256').update(cloudContent).digest('hex')}`;
    const localDigest = `sha256:${createHash('sha256').update(localContent).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    const bundle = (overrides: Record<string, unknown> = {}) => ({
      apiVersion: 'applik8s.dev/v1alpha1',
      kind: 'TypeKroCompositionBundle',
      spec: {
        lakehousePublishers: [{
          name: 'example', nodeId: 'lakehouse.example', source: cloudSource, digest: cloudDigest,
          localSource, localDigest, ...overrides,
        }],
      },
    });
    await writeFile(manifest, JSON.stringify(bundle()));

    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).resolves.toEqual([
      expect.objectContaining({ source: localSource, digest: localDigest, role: 'lakehouse' }),
    ]);
    await expect(readLocalRuntimeArtifacts(manifest, root, 'aws')).resolves.toEqual([
      expect.objectContaining({ source: cloudSource, digest: cloudDigest, role: 'lakehouse' }),
    ]);

    await writeFile(manifest, JSON.stringify(bundle({ localDigest: undefined })));
    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).rejects.toThrow(/localSource and localDigest together/u);
    await writeFile(manifest, JSON.stringify(bundle({ localDigest: 'sha256:not-a-digest' })));
    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).rejects.toThrow(/invalid local runtime artifact/u);
  });

  it('admits and normalizes compiler-owned container recipes for target planning', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-runtime-container-'));
    const artifactDirectory = join(root, 'processors', 'example');
    const context = join(artifactDirectory, 'container');
    await mkdir(context, { recursive: true });
    const source = join(artifactDirectory, 'processor.mjs');
    const contents = 'export const ready = true;\n';
    await writeFile(source, contents);
    await writeFile(join(context, 'Dockerfile'), 'FROM node:22.20.0-bookworm-slim\n');
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{
        name: 'example', nodeId: 'processor.example', source, digest,
        container: {
          image: 'applik8s/example:generated', imageName: 'example', tag: 'generated', baseImage: 'node:22.20.0-bookworm-slim',
          contextPath: context, dockerfilePath: join(context, 'Dockerfile'), entrypoint: '/app/processor.mjs', command: ['node', '/app/processor.mjs'],
          sourceDigest: `sha256:${'b'.repeat(64)}`,
        },
      }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([expect.objectContaining({
      nodeId: 'processor.example', role: 'processor', digest,
      container: expect.objectContaining({ contextPath: context, dockerfilePath: join(context, 'Dockerfile') }),
    })]);
  });

  it('admits digest-bound operator dispatchers and their manifests as one local authority artifact', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-operator-'));
    const typekro = join(root, 'typekro');
    const operator = join(root, 'operators', 'example');
    await mkdir(typekro, { recursive: true });
    await mkdir(join(operator, 'bundle'), { recursive: true });
    const source = join(operator, 'bundle', 'handler.js');
    const contents = 'export async function handle() { return JSON.stringify({ operations: [] }); }\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const operatorManifest = join(operator, 'operator-manifest.json');
    await writeFile(operatorManifest, JSON.stringify({
      apiVersion: 'applik8s.operator/v1alpha1', kind: 'OperatorBundle',
      spec: { bundle: { artifacts: [{ kind: 'javascript-bundle', path: source, digest }] } },
    }));
    const manifest = join(typekro, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { operators: [{ name: 'example', manifest: operatorManifest, outDir: operator }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([{
      name: 'example', nodeId: 'operator.example', role: 'operator', source, manifest: operatorManifest, digest,
    }]);
  });

  it('persists public evidence, isolates credentials, and rejects concurrent ownership', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-supervisor-'));
    const events: string[] = [];
    const driver = fakeDriver(events);
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const first = await startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });

    expect(first.state.resources).toEqual([
      { resourceId: 'database', runtimeId: 'runtime:database', kind: 'container' },
      { resourceId: 'web', runtimeId: 'runtime:web', kind: 'process', pid: 4242 },
    ]);
    expect(JSON.stringify(first.state)).not.toContain('generated-secret');
    const credentials = await readFile(join(root, 'state', 'credentials.json'), 'utf8');
    expect(credentials).toMatch(/credential:database:password/);
    expect(credentials).toContain('resolved-worker-token');
    expect(events).toContain('worker-token:resolved-worker-token');
    await expect(startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() })).rejects.toThrow(/already active/);

    await first.stop();
    expect(events).toEqual(expect.arrayContaining(['healthy:database', 'healthy:web', 'stop:runtime:web', 'stop:runtime:database']));
    expect(events).toContain('schedule-state:web:schedules.json');
  });

  it('stops already-started resources when a later dependency fails health', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-supervisor-failure-'));
    const events: string[] = [];
    const driver = fakeDriver(events, 'web');
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };

    await expect(startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() })).rejects.toThrow('web failed health');
    expect(events).toEqual(expect.arrayContaining(['stop:runtime:web', 'stop:runtime:database']));
  });
});

function fakeDriver(events: string[], failHealth?: string): LocalSupervisorDriver {
  return {
    async startContainer(resource) { events.push(`start:${resource.id}`); return { resourceId: resource.id, runtimeId: `runtime:${resource.id}`, kind: 'container' }; },
    async startProcess(resource, environment) {
      events.push(`start:${resource.id}`);
      if (environment.APPLIK8S_SCHEDULE_STATE_PATH) events.push(`schedule-state:${resource.id}:${environment.APPLIK8S_SCHEDULE_STATE_PATH.split('/').at(-1)}`);
      if (environment.WORKER_TOKEN) events.push(`worker-token:${environment.WORKER_TOKEN}`);
      return { resourceId: resource.id, runtimeId: `runtime:${resource.id}`, kind: 'process', pid: 4242 };
    },
    async waitHealthy(resource) { if (resource.id === failHealth) throw new Error(`${resource.id} failed health`); events.push(`healthy:${resource.id}`); },
    async stop(resource) { events.push(`stop:${resource.runtimeId}`); },
    async remove(resource) { events.push(`remove:${resource.runtimeId}`); },
    async resolveBindings(resource) {
      return resource.readyOutputs?.length ? { [resource.readyOutputs[0]!.binding]: 'resolved-worker-token' } : {};
    },
  };
}

function portBroker(): () => Promise<number> {
  let port = 41_000;
  return async () => port++;
}

function plan(): LocalSupervisorPlan {
  return {
    apiVersion: 'applik8s.localSupervisor/v1alpha1', application: 'demo', target: 'local', profile: 'starter', projectDigest: 'sha256:demo', diagnostics: [],
    bindings: [
      { id: 'credential:database:password', owner: 'database', kind: 'credential', sensitivity: 'sensitive' },
      { id: 'endpoint:database:postgres', owner: 'database', kind: 'endpoint', sensitivity: 'public' },
      { id: 'workflow:database:worker-token', owner: 'database', kind: 'targetOutput', sensitivity: 'sensitive' },
      { id: 'port:web:http', owner: 'web', kind: 'port', sensitivity: 'public' },
      { id: 'endpoint:web:http', owner: 'web', kind: 'endpoint', sensitivity: 'public' },
    ],
    resources: [
      {
        id: 'web', kind: 'process', command: 'bun', args: ['run', 'dev'], cwd: '.', environment: [{ name: 'DATABASE_URL', binding: 'endpoint:database:postgres' }, { name: 'WORKER_TOKEN', binding: 'workflow:database:worker-token' }, { name: 'PORT', binding: 'port:web:http' }], watch: ['src'], reloadGroup: 'web', dependsOn: ['database'], lifecycle: { ownership: 'application', retention: 'ephemeral' }, health: { kind: 'http', portBinding: 'port:web:http', path: '/healthz', timeoutMs: 1_000 }, provenance: { graphNodeId: 'server.web' },
      },
      {
        id: 'database', kind: 'container', image: 'postgres:17-alpine', ports: [{ name: 'postgres', containerPort: 5432, protocol: 'tcp' }], environment: [{ name: 'POSTGRES_PASSWORD', binding: 'credential:database:password' }], volumes: [], readyOutputs: [{ binding: 'workflow:database:worker-token', command: ['token', 'create'], encoding: 'trimmed-stdout' }], dependsOn: [], lifecycle: { ownership: 'application', retention: 'retained' }, health: { kind: 'tcp', portBinding: 'endpoint:database:postgres', timeoutMs: 1_000 }, provenance: { graphNodeId: 'provider.database' },
      },
    ],
  };
}
