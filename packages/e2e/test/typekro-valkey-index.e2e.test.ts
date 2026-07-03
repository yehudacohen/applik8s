import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage } from '@applik8s/compiler';
import type { OperatorManifest } from '@applik8s/core';
import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-valkey-index-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const group = `cachednotes${process.pid}.applik8s.dev`;
const operatorName = 'cached-note-controller';
const stackName = `cached-note-stack-${process.pid}`;
const stackKind = `CachedNoteStack${process.pid}`;
const serverName = 'notes-web';
const serviceName = `${serverName}-svc`;
const indexerName = `${serverName}-indexer`;
const valkeyName = 'notes-valkey';
const bookPartition = 'main';

let tempDir: string | undefined;
let outDir: string | undefined;

describeLive('live TypeKro Valkey-backed cached indexes', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-valkey-index-'));
    await applyValkeyWorkload();
    await rolloutStatusWithDiagnostics(valkeyName);

    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'cached-index-live.ts');
    await writeFile(entrypoint, liveEntrypointSource());
    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'cachedNoteStack', '--out-dir', outDir], process.cwd());

    for (const manifestPath of await nestedOperatorManifestPaths()) {
      const image = await buildImplicitRuntimeImage({ manifest: await readOperatorManifest(manifestPath) });
      if (!image.ok) {
        throw new Error(image.error.message);
      }
    }
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `cachednotes.${group}`, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `cachednotestacks.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('serves request-path index queries from Valkey without CRD list RBAC on the server', async () => {
    await runGeneratedTypeKroApplyScript();

    await kubectl(['wait', `crd/cachednotes.${group}`, '--for=condition=Established', '--timeout=90s']);
    await rolloutStatusWithDiagnostics(operatorName);
    await rolloutStatusWithDiagnostics(serverName);
    await rolloutStatusWithDiagnostics(indexerName);

    const serverVerbs = await serverCrdVerbs();
    expect(serverVerbs).toEqual('create');

    const portForward = await startPortForward(['--namespace', namespace, `service/${serviceName}`, '0:80']);
    try {
      await postNote(portForward.endpoint, 'first cached note');
      await sleep(1_100);
      await postNote(portForward.endpoint, 'second cached note');

      const payload = await waitForCachedNotes(portForward.endpoint, ['first cached note', 'second cached note']);
      const messages = payload.items.map((item) => item.spec.message);
      expect(messages).toContain('first cached note');
      expect(messages).toContain('second cached note');
      expect(messages.indexOf('second cached note')).toBeLessThan(messages.indexOf('first cached note'));
    } finally {
      await portForward.close();
    }
  }, 360_000);
});

interface CachedNoteListPayload {
  readonly items: readonly { readonly spec: { readonly message: string } }[];
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function ensureKroRuntime(): Promise<void> {
  try {
    await kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']);
    return;
  } catch {
    await ensureNamespace(runtimeNamespace);
    const bootstrap = typeKroRuntimeBootstrap({ namespace: runtimeNamespace, kroVersion: '0.9.0' });
    const factory = bootstrap.factory('direct', { namespace: runtimeNamespace, waitForReady: true, timeout: 300_000 });
    await factory.deploy({ namespace: runtimeNamespace });
    await kubectl(['wait', 'crd/resourcegraphdefinitions.kro.run', '--for=condition=Established', '--timeout=180s']);
  }
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', 'namespace', name]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function applyValkeyWorkload(): Promise<void> {
  if (!tempDir) {
    throw new Error('Temporary directory was not initialized.');
  }
  const manifestPath = join(tempDir, 'valkey.yaml');
  await writeFile(manifestPath, valkeyYaml());
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-valkey-index-e2e', '--filename', manifestPath]);
}

async function nestedOperatorManifestPaths(): Promise<readonly string[]> {
  const manifestPath = join(requiredOutDir(), 'typekro', 'typekro-composition.json');
  // typecast: composition bundle JSON is generated by applik8s; this test validates only the operator manifest references it needs.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly spec?: { readonly operators?: readonly { readonly manifest?: string }[] } };
  const paths = manifest.spec?.operators?.map((operator) => operator.manifest).filter((path): path is string => typeof path === 'string') ?? [];
  if (paths.length === 0) {
    throw new Error(`TypeKro composition manifest did not reference nested operator manifests: ${manifestPath}`);
  }
  return paths;
}

async function readOperatorManifest(path: string): Promise<OperatorManifest> {
  // typecast: nested operator manifest JSON is generated by the compiler and consumed immediately by the runtime image builder.
  return JSON.parse(await readFile(path, 'utf8')) as OperatorManifest;
}

async function runGeneratedTypeKroApplyScript(): Promise<void> {
  await exec('sh', [join(requiredOutDir(), 'typekro', 'apply.sh')], process.cwd());
}

async function rolloutStatusWithDiagnostics(deployment: string): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${deployment}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function serverCrdVerbs(): Promise<string> {
  return (await kubectl([
    'get',
    `role/${serverName}`,
    '--namespace',
    namespace,
    `--output=jsonpath={.rules[?(@.resources[0]=="cachednotes")].verbs[*]}`,
  ])).stdout.trim();
}

async function postNote(endpoint: string, message: string): Promise<void> {
  const response = await fetch(`${endpoint}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message }),
  });
  expect(response.status).toBe(200);
}

async function waitForCachedNotes(endpoint: string, expectedMessages: readonly string[]): Promise<CachedNoteListPayload> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(`${endpoint}/notes`, { headers: { 'cache-control': 'no-store' } });
      lastOutput = await response.text();
      if (response.ok) {
        // typecast: generated server returns the typed JSON payload produced by the route under test.
        const payload = JSON.parse(lastOutput) as CachedNoteListPayload;
        const messages = payload.items.map((item) => item.spec.message);
        if (expectedMessages.every((message) => messages.includes(message))) {
          return payload;
        }
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `cachednotes.${group}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${serverName}`, '--all-containers=true', '--tail=300']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${indexerName}`, '--all-containers=true', '--tail=500']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${valkeyName}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected cached notes ${expectedMessages.join(', ')}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function startPortForward(args: readonly string[]): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', ...args], { cwd: process.cwd(), env: process.env });
  let output = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out starting kubectl port-forward.\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) -> (?:80|8080)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl port-forward exited with code ${code}.\n${output}`));
    });
  });
  return { endpoint, close: () => closePortForward(child) };
}

async function closePortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
  });
}

function requiredOutDir(): string {
  if (!outDir) {
    throw new Error('Valkey index e2e output directory was not initialized.');
  }
  return outDir;
}

function liveEntrypointSource(): string {
  return `import { sdk } from '@applik8s/applik8s';
import { label, metadata, type } from '@applik8s/applik8s/dsl';

export const Note = sdk.crd({
  apiVersion: ${JSON.stringify(`${group}/v1alpha1`)},
  kind: 'CachedNote',
  plural: 'cachednotes',
  spec: type({ message: 'string' }),
  status: type({ phase: 'string?' }),
});

export const byBook = Note.index('byBook', {
  partitionBy: label('notes.applik8s.dev/book'),
  orderBy: metadata.creationTimestamp.desc(),
});

export const noteController = sdk.operator({
  name: ${JSON.stringify(operatorName)},
  deployment: { namespace: ${JSON.stringify(namespace)}, replicas: 1 },
  resources: { Note },
  handlers: [
    Note.on.reconcile((note) => {
      note.status.phase = 'Observed';
    }),
  ],
});

export const cachedNoteStack = sdk.kubernetesComposition({
  name: ${JSON.stringify(stackName)},
  apiVersion: ${JSON.stringify(`${group}/v1alpha1`)},
  kind: ${JSON.stringify(stackKind)},
  spec: type({}),
  status: type({ ready: 'boolean', phase: 'string' }),
}, (_spec, app) => {
  app.operator(noteController, { namespace: ${JSON.stringify(namespace)}, replicas: 1 });
  const web = app.server('web', {
    namespace: ${JSON.stringify(namespace)},
    resourceName: ${JSON.stringify(serverName)},
    serviceName: ${JSON.stringify(serviceName)},
    resources: { Note },
    indexes: { byBook },
    cache: [byBook],
    indexBackend: { kind: 'valkey', host: ${JSON.stringify(`${valkeyName}.${namespace}.svc.cluster.local`)}, provision: false },
    permissions: [{ apiGroups: [${JSON.stringify(group)}], resources: ['cachednotes'], verbs: ['create'] }],
    service: { port: 80 },
  }, (server) => {
    server.get('/notes', async () => byBook.query(${JSON.stringify(bookPartition)}, {
      limit: 10,
      namespace: process.env.APPLIK8S_SERVER_NAMESPACE ?? 'default',
    }));
    server.post('/notes', async (request) => {
      const form = await request.formData();
      const namespace = process.env.APPLIK8S_SERVER_NAMESPACE ?? 'default';
      const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'note';
      const suffix = (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)).toLowerCase();
      await Note.create({
        name: safeName('cached-note-' + suffix),
        namespace,
        labels: { 'notes.applik8s.dev/book': ${JSON.stringify(bookPartition)} },
        spec: { message: form.string('message').trim().replace(/ +/g, ' ').slice(0, 200) },
      });
      return { ok: true };
    });
  });
  const { deployment: notesWebDeployment } = web;
  const ready = notesWebDeployment.status.availableReplicas >= notesWebDeployment.spec.replicas;
  return { ready, phase: ready ? 'Ready' : 'Installing' };
});
`;
}

function valkeyYaml(): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${valkeyName}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${valkeyName}
    app.kubernetes.io/component: cache
    app.kubernetes.io/managed-by: applik8s
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${valkeyName}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${valkeyName}
    spec:
      containers:
        - name: valkey
          image: valkey/valkey:8.1-alpine
          args: ["valkey-server", "--save", "", "--appendonly", "no"]
          ports:
            - name: valkey
              containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: ${valkeyName}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${valkeyName}
    app.kubernetes.io/component: cache
    app.kubernetes.io/managed-by: applik8s
spec:
  selector:
    app.kubernetes.io/name: ${valkeyName}
  ports:
    - name: valkey
      port: 6379
      targetPort: 6379
`;
}
