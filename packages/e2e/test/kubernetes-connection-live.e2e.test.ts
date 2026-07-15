import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, formatSettledOutput, generatedManifestPaths, kubectl } from './live-e2e-helpers';

const suffix = `${process.pid}`;
const operatorNamespace = `applik8s-connection-operator-${suffix}`;
const destinationNamespace = `applik8s-connection-destination-${suffix}`;
const group = `connection${suffix}.applik8s.dev`;
const operatorName = 'connection-proof';
const remoteServiceAccount = 'connection-client';
const connectionSecret = 'destination-kubeconfig';
const mirrorConnectionSecret = 'mirror-kubeconfig';
const workName = 'proof';
const mirrorWorkName = 'mirror-proof';
const remoteConfigMap = 'remote-proof';
const mirrorRemoteConfigMap = 'remote-mirror-proof';
const execFileAsync = promisify(execFile);

let tempDir: string | undefined;
let artifactDir: string | undefined;
let workPath: string | undefined;
let mirrorWorkPath: string | undefined;

describeLive('v0.5 connection-scoped Kubernetes proof', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-connection-live-'));
    await createNamespaces();
    await installDestinationIdentity();
    await installConnectionSecret();

    const entrypoint = join(tempDir, 'connection-proof.ts');
    await writeFile(entrypoint, connectionOperatorSource());
    const compiled = await createCompilerPipeline().run({
      entrypoint,
      outDir: join(tempDir, 'dist'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      kubernetesConnectionBindings: {
        destination: {
          kubeconfigSecretRef: { name: connectionSecret, namespace: operatorNamespace, key: 'kubeconfig' },
          context: 'destination',
          endpointPolicy: {
            name: 'in-cluster-destination', version: '1', scheme: 'https',
            hosts: ['kubernetes.default.svc'], ports: [443], redirects: 'deny',
          },
        },
        mirror: {
          kubeconfigSecretRef: { name: mirrorConnectionSecret, namespace: operatorNamespace, key: 'kubeconfig' },
          context: 'mirror',
          endpointPolicy: {
            name: 'in-cluster-destination', version: '1', scheme: 'https',
            hosts: ['kubernetes.default.svc'], ports: [443], redirects: 'deny',
          },
        },
      },
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    if (!compiled.ok) throw new Error(compiled.error.message);
    const secretResourceNames = compiled.value.manifest.spec.permissions
      .filter((rule) => rule.apiGroups.includes('') && rule.resources.includes('secrets') && rule.verbs.includes('get'))
      .flatMap((rule) => rule.resourceNames ?? []);
    expect(secretResourceNames).toEqual(expect.arrayContaining([connectionSecret, mirrorConnectionSecret]));
    expect(compiled.value.manifest.spec.permissions).not.toContainEqual(expect.objectContaining({
      apiGroups: [''], resources: ['configmaps'],
    }));
    const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
    if (!image.ok) throw new Error(image.error.message);

    artifactDir = join(tempDir, 'dist/kubernetes');
    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-connection-e2e', '--filename', manifestPath]);
    }
    await kubectl(['wait', `crd/works.${group}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutWithDiagnostics();
    workPath = join(tempDir, 'work.yaml');
    mirrorWorkPath = join(tempDir, 'mirror-work.yaml');
    await writeFile(workPath, workYaml(workName, 'destination', remoteConfigMap, 'first'));
    await writeFile(mirrorWorkPath, workYaml(mirrorWorkName, 'mirror', mirrorRemoteConfigMap, 'mirror-first'));
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') await cleanup();
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') await rm(tempDir, { recursive: true, force: true });
  }, 600_000);

  it('uses only the bound identity for bounded reads and guarded create, update, and finalization delete', async () => {
    if (!workPath || !mirrorWorkPath) throw new Error('Connection proof fixture was not prepared.');
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-connection-e2e', '--filename', workPath]);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-connection-e2e', '--filename', mirrorWorkPath]);
    await waitForWorkStatus(workName, 'first', 'false');
    await waitForWorkStatus(mirrorWorkName, 'mirror-first', 'false');

    const uid = (await kubectl(['get', `works.${group}/${workName}`, '--namespace', operatorNamespace, '--output=jsonpath={.metadata.uid}'])).stdout.trim();
    expect((await kubectl(['get', `configmap/${remoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.data.value}'])).stdout.trim()).toBe('first');
    expect((await kubectl(['get', `configmap/${remoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.metadata.annotations.applik8s\\.dev/remote-source-uid}'])).stdout.trim()).toBe(uid);
    expect((await kubectl(['get', `configmap/${remoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.metadata.annotations.applik8s\\.dev/remote-management-identity}'])).stdout.trim()).toBe(`${operatorName}/destination/work/${uid}/config`);
    const mirrorUid = (await kubectl(['get', `works.${group}/${mirrorWorkName}`, '--namespace', operatorNamespace, '--output=jsonpath={.metadata.uid}'])).stdout.trim();
    expect((await kubectl(['get', `configmap/${mirrorRemoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.data.value}'])).stdout.trim()).toBe('mirror-first');
    expect((await kubectl(['get', `configmap/${mirrorRemoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.metadata.annotations.applik8s\\.dev/remote-management-identity}'])).stdout.trim()).toBe(`${operatorName}/mirror/work/${mirrorUid}/config`);

    await expect(canI([`--as=system:serviceaccount:${operatorNamespace}:${operatorName}-controller`, 'get', 'configmaps', '--namespace', destinationNamespace])).resolves.toBe(false);
    await expect(canI([`--as=system:serviceaccount:${destinationNamespace}:${remoteServiceAccount}`, 'get', 'secrets', '--namespace', operatorNamespace])).resolves.toBe(false);

    await writeFile(workPath, workYaml(workName, 'destination', remoteConfigMap, 'second'));
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-connection-e2e', '--filename', workPath]);
    await waitForWorkStatus(workName, 'second', 'true');
    expect((await kubectl(['get', `configmap/${remoteConfigMap}`, '--namespace', destinationNamespace, '--output=jsonpath={.data.value}'])).stdout.trim()).toBe('second');

    await kubectl(['delete', `works.${group}/${workName}`, '--namespace', operatorNamespace, '--wait=true', '--timeout=180s']);
    expect((await kubectl(['get', `configmap/${remoteConfigMap}`, '--namespace', destinationNamespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `configmap/${mirrorRemoteConfigMap}`, '--namespace', destinationNamespace, '--output=name'])).stdout.trim()).toBe(`configmap/${mirrorRemoteConfigMap}`);
    await kubectl(['delete', `works.${group}/${mirrorWorkName}`, '--namespace', operatorNamespace, '--wait=true', '--timeout=180s']);
    expect((await kubectl(['get', `configmap/${mirrorRemoteConfigMap}`, '--namespace', destinationNamespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
  }, 600_000);
});

function connectionOperatorSource(): string {
  return `import { sdk } from '@applik8s/sdk';

const Work = sdk.crd({
  apiVersion: '${group}/v1alpha1', kind: 'Work',
  spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkSpec' }, schema: { type: 'object', additionalProperties: false, required: ['value', 'connection', 'configMapName'], properties: { value: { type: 'string' }, connection: { type: 'string', enum: ['destination', 'mirror'] }, configMapName: { type: 'string' } } } },
  status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkStatus' }, schema: { type: 'object', additionalProperties: false, properties: { phase: { type: 'string' }, value: { type: 'string' }, existed: { type: 'boolean' }, observedCount: { type: 'integer' } } } },
});
const RemoteConfigMap = sdk.kubernetes.resource({ apiVersion: 'v1', kind: 'ConfigMap', plural: 'configmaps', namespaces: ['${destinationNamespace}'], access: 'connection' });
const destination = sdk.kubernetes.connection.required({
  endpointPolicy: 'in-cluster-destination',
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'list', 'create', 'patch', 'delete'], namespaces: ['${destinationNamespace}'] }],
});
const mirror = sdk.kubernetes.connection.required({
  endpointPolicy: 'in-cluster-destination',
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'list', 'create', 'patch', 'delete'], namespaces: ['${destinationNamespace}'] }],
});

export const connectionProof = sdk.operator({
  name: '${operatorName}', deployment: { namespace: '${operatorNamespace}' }, resources: { Work }, reads: { RemoteConfigMap }, capabilities: { destination, mirror },
  handlers: ({ resources }) => [
    resources.Work.on.context.reconcile(async (work, ctx) => {
      const remote = ctx.kubernetes.connection(work.spec.connection);
      const existing = await remote.read.resource(RemoteConfigMap).get({ name: work.spec.configMapName, namespace: '${destinationNamespace}' });
      const page = await remote.read.resource(RemoteConfigMap).list({ namespace: '${destinationNamespace}', limit: 10 });
      remote.resources.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: work.spec.configMapName, namespace: '${destinationNamespace}' }, data: { value: work.spec.value } }, {
        ownership: { mode: 'none' }, authority: { mode: 'managed', identity: 'work/' + work.metadata.uid + '/config', sourceUid: work.metadata.uid },
      });
      return ctx.apply({ status: { phase: 'Ready', value: work.spec.value, existed: Boolean(existing), observedCount: page.items.length } });
    }),
    resources.Work.on.context.finalize((work, ctx) => {
      ctx.kubernetes.connection(work.spec.connection).resources.delete(
        { apiVersion: 'v1', kind: 'ConfigMap', name: work.spec.configMapName, namespace: '${destinationNamespace}' },
        { authority: { mode: 'managed', identity: 'work/' + work.metadata.uid + '/config', sourceUid: work.metadata.uid } },
      );
      return ctx.noop();
    }, { finalizer: '${group}/remote-cleanup' }),
  ],
});
`;
}

function workYaml(name: string, connection: 'destination' | 'mirror', configMapName: string, value: string): string {
  return `apiVersion: ${group}/v1alpha1\nkind: Work\nmetadata:\n  name: ${name}\n  namespace: ${operatorNamespace}\nspec:\n  value: ${value}\n  connection: ${connection}\n  configMapName: ${configMapName}\n`;
}

async function createNamespaces(): Promise<void> {
  await kubectl(['create', 'namespace', operatorNamespace]);
  await kubectl(['create', 'namespace', destinationNamespace]);
}

async function installDestinationIdentity(): Promise<void> {
  const path = join(requiredTempDir(), 'destination-rbac.yaml');
  await writeFile(path, `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
rules:
  - apiGroups: ['']
    resources: [configmaps]
    verbs: [get, list, create, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${remoteServiceAccount}
subjects:
  - kind: ServiceAccount
    name: ${remoteServiceAccount}
    namespace: ${destinationNamespace}
`);
  await kubectl(['apply', '--filename', path]);
}

async function installConnectionSecret(): Promise<void> {
  const token = (await kubectl(['create', 'token', remoteServiceAccount, '--namespace', destinationNamespace, '--duration=1h'])).stdout.trim();
  const ca = (await kubectl(['get', 'configmap/kube-root-ca.crt', '--namespace', operatorNamespace, '--output=jsonpath={.data.ca\\.crt}'])).stdout;
  if (!token || !ca) throw new Error('Could not obtain the bounded destination token and cluster CA.');
  const kubeconfig = (context: 'destination' | 'mirror') => `apiVersion: v1
kind: Config
clusters:
  - name: ${context}
    cluster:
      server: https://kubernetes.default.svc:443
      certificate-authority-data: ${Buffer.from(ca).toString('base64')}
users:
  - name: ${context}
    user:
      token: ${token}
contexts:
  - name: ${context}
    context:
      cluster: ${context}
      user: ${context}
current-context: ${context}
`;
  const path = join(requiredTempDir(), 'connection-secret.yaml');
  await writeFile(path, `apiVersion: v1
kind: Secret
metadata:
  name: ${connectionSecret}
  namespace: ${operatorNamespace}
type: applik8s.dev/kubeconfig
stringData:
  kubeconfig: ${JSON.stringify(kubeconfig('destination'))}
---
apiVersion: v1
kind: Secret
metadata:
  name: ${mirrorConnectionSecret}
  namespace: ${operatorNamespace}
type: applik8s.dev/kubeconfig
stringData:
  kubeconfig: ${JSON.stringify(kubeconfig('mirror'))}
`);
  await kubectl(['apply', '--filename', path]);
}

async function waitForWorkStatus(name: string, value: string, existed: string): Promise<void> {
  try {
    await kubectl(['wait', `works.${group}/${name}`, '--namespace', operatorNamespace, `--for=jsonpath={.status.value}=${value}`, '--timeout=180s']);
    await kubectl(['wait', `works.${group}/${name}`, '--namespace', operatorNamespace, `--for=jsonpath={.status.existed}=${existed}`, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `works.${group}/${name}`, '--namespace', operatorNamespace, '--output=yaml']),
      kubectl(['get', 'all,configmaps', '--namespace', destinationNamespace, '--output=wide']),
      kubectl(['logs', '--namespace', operatorNamespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', operatorNamespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Connection reconcile failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function rolloutWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${operatorName}`, '--namespace', operatorNamespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${operatorName}`, '--namespace', operatorNamespace]),
      kubectl(['get', 'pods', '--namespace', operatorNamespace, '--output=wide']),
      kubectl(['logs', '--namespace', operatorNamespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=300']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Connection operator rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function cleanup(): Promise<void> {
  if (artifactDir) {
    await kubectl(['delete', `works.${group}/${workName}`, `works.${group}/${mirrorWorkName}`, '--namespace', operatorNamespace, '--ignore-not-found=true', '--wait=true', '--timeout=180s']);
    const remote = await kubectl(['get', `configmap/${remoteConfigMap}`, `configmap/${mirrorRemoteConfigMap}`, '--namespace', destinationNamespace, '--ignore-not-found=true', '--output=name']);
    if (remote.stdout.trim()) throw new Error(`Finalization left ${remote.stdout.trim()} behind.`);
    const manifests = await generatedManifestPaths(artifactDir);
    const crdFlags = await Promise.all(manifests.map(async (path) => /^kind:\s*CustomResourceDefinition\s*$/m.test(await readFile(path, 'utf8'))));
    const crds = manifests.filter((_path, index) => crdFlags[index]);
    for (const manifestPath of manifests.filter((path) => !crds.includes(path)).reverse()) {
      await kubectl(['delete', '--filename', manifestPath, '--ignore-not-found=true', '--wait=true', '--timeout=180s']);
    }
    for (const manifestPath of crds) await kubectl(['delete', '--filename', manifestPath, '--ignore-not-found=true', '--wait=false']);
    await waitForCrdDeletion();
  }
  await deleteDisposableNamespaceContents(operatorNamespace);
  await deleteDisposableNamespaceContents(destinationNamespace);
  await deleteTestNamespaces();
}

async function deleteDisposableNamespaceContents(namespace: string): Promise<void> {
  await kubectl([
    'delete',
    'all,configmap,secret,serviceaccount,role,rolebinding',
    '--all',
    '--namespace', namespace,
    '--ignore-not-found=true',
    '--wait=true',
    '--timeout=60s',
  ]);
  await kubectl(['delete', 'events', '--all', '--namespace', namespace, '--ignore-not-found=true', '--wait=true']);
}

async function canI(args: readonly string[]): Promise<boolean> {
  try {
    const result = await execFileAsync('kubectl', ['auth', 'can-i', ...args], { cwd: process.cwd(), env: process.env });
    return result.stdout.trim() === 'yes';
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 1) return false;
    throw cause;
  }
}

async function waitForCrdDeletion(): Promise<void> {
  const crdName = `works.${group}`;
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const result = await kubectl(['get', `crd/${crdName}`, '--ignore-not-found=true', '--output=name']);
    if (!result.stdout.trim()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const remaining = await kubectl(['get', `works.${group}`, '--all-namespaces', '--ignore-not-found=true', '--output=name']);
  if (remaining.stdout.trim()) throw new Error(`Refusing to finalize crd/${crdName}; instances remain:\n${remaining.stdout}`);
  await kubectl(['patch', `crd/${crdName}`, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
  await kubectl(['wait', '--for=delete', `crd/${crdName}`, '--timeout=30s']);
}

async function deleteTestNamespaces(): Promise<void> {
  await kubectl(['delete', 'namespace', operatorNamespace, destinationNamespace, '--ignore-not-found=true', '--wait=false']);
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const remaining = await remainingNamespaces();
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  for (const namespace of await remainingNamespaces()) await finalizeEmptyNamespace(namespace);
  const finalizeStarted = Date.now();
  while (Date.now() - finalizeStarted < 30_000) {
    const remaining = await remainingNamespaces();
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Disposable namespaces did not terminate after safe finalization: ${(await remainingNamespaces()).join(', ')}`);
}

async function remainingNamespaces(): Promise<string[]> {
  const result = await kubectl(['get', 'namespace', operatorNamespace, destinationNamespace, '--ignore-not-found=true', '--output=jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']);
  return result.stdout.split('\n').map((value) => value.trim()).filter(Boolean);
}

async function finalizeEmptyNamespace(namespace: string): Promise<void> {
  // This test owns a closed resource graph. Audit every built-in class the
  // compiler, host, or Kubernetes controllers can create for that graph;
  // querying every unrelated CRD in a shared cluster couples cleanup to
  // concurrently installed or removed APIs and can overload discovery.
  const resourceTypes = [
    'pods', 'services', 'endpoints', 'endpointslices.discovery.k8s.io',
    'deployments.apps', 'replicasets.apps', 'statefulsets.apps', 'daemonsets.apps',
    'jobs.batch', 'cronjobs.batch', 'persistentvolumeclaims',
    'configmaps', 'secrets', 'serviceaccounts', 'events',
    'roles.rbac.authorization.k8s.io', 'rolebindings.rbac.authorization.k8s.io',
    'leases.coordination.k8s.io', 'networkpolicies.networking.k8s.io',
    'ingresses.networking.k8s.io',
  ];
  const listed: PromiseSettledResult<{ readonly stdout: string; readonly stderr: string }>[] = [];
  for (let offset = 0; offset < resourceTypes.length; offset += 6) {
    const batch = resourceTypes.slice(offset, offset + 6);
    listed.push(...await Promise.allSettled(batch.map((resource) => listResourceForCleanup(resource, namespace))));
  }
  const failures = listed.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length > 0) throw new Error(`Refusing to finalize namespace/${namespace}; ${failures.length} namespaced resource queries failed.`);
  const remaining = listed
    .flatMap((result) => result.status === 'fulfilled' ? result.value.stdout.split('\n').map((value) => value.trim()).filter(Boolean) : [])
    .filter((resource) => resource !== 'configmap/kube-root-ca.crt' && resource !== 'serviceaccount/default');
  if (remaining.length > 0) throw new Error(`Refusing to finalize namespace/${namespace}; resources remain:\n${remaining.join('\n')}`);

  // Kubernetes recreates these namespace-scoped bootstrap objects while a
  // namespace is terminating. They carry no application state and are the
  // only resources permitted across this finalization boundary.
  await kubectl([
    'delete', 'configmap/kube-root-ca.crt', 'serviceaccount/default',
    '--namespace', namespace,
    '--ignore-not-found=true',
    '--wait=false',
  ]);

  // typecast: kubectl returned a core/v1 Namespace document; cleanup only mutates its finalizer list before submitting the finalize subresource.
  const namespaceDocument = JSON.parse((await kubectl(['get', `namespace/${namespace}`, '--output=json'])).stdout) as { spec?: { finalizers?: string[] } };
  namespaceDocument.spec = { ...namespaceDocument.spec, finalizers: [] };
  const path = join(requiredTempDir(), `finalize-${namespace}.json`);
  await writeFile(path, JSON.stringify(namespaceDocument));
  await kubectl(['replace', '--raw', `/api/v1/namespaces/${namespace}/finalize`, '--filename', path]);
}

async function listResourceForCleanup(
  resource: string,
  namespace: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await kubectl([
      'get', resource,
      '--namespace', namespace,
      '--ignore-not-found=true',
      '--request-timeout=10s',
      '--output=name',
    ]);
  } catch (cause) {
    // A shared integration cluster can delete a discovered CRD between
    // discovery and list. That proves this resource type cannot retain an
    // object; connectivity, authorization, and timeout failures remain fatal.
    if (cause instanceof Error && cause.message.includes("doesn't have a resource type")) {
      return { stdout: '', stderr: cause.message };
    }
    throw cause;
  }
}

function requiredTempDir(): string {
  if (!tempDir) throw new Error('Connection proof temp directory is unavailable.');
  return tempDir;
}
