import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, formatSettledOutput, generatedManifestPaths, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-typekro-scoped-listener-${process.pid}`;
const operatorName = 'scoped-deployment-listener';
const exactWatchedName = 'exact-api';
const exactUnwatchedName = 'exact-worker';
const finiteApiName = 'finite-api';
const finiteWorkerName = 'finite-worker';
const finiteOutsideName = 'finite-outside';
const labelMatchedName = 'label-api';
const labelUnmatchedName = 'label-worker';
const fieldMatchedName = 'field-api';
const fieldUnmatchedName = 'field-worker';
const mixedDeploymentName = 'mixed-api';
const mixedServiceName = 'mixed-api-service';
const mixedUnwatchedServiceName = 'mixed-worker-service';

let tempDir: string | undefined;
let artifactDir: string | undefined;

describeLive('live TypeKro scoped external listeners', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-scoped-listener-'));
    const entrypoint = join(tempDir, 'scoped-listener.ts');
    await writeFile(entrypoint, scopedListenerSource(namespace));

    const compiled = await createCompilerPipeline().run({
      entrypoint,
      operatorName,
      outDir: join(tempDir, 'dist'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      dispatcherMode: 'staticSerializable',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    if (!compiled.ok) {
      throw new Error(compiled.error.message);
    }

    const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
    if (!image.ok) {
      throw new Error(image.error.message);
    }

    artifactDir = join(tempDir, 'dist/kubernetes');

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-scoped-listener-e2e', '--filename', manifestPath]);
    }
    await rolloutStatusWithDiagnostics();
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('routes exact-instance TypeKro Deployment updates only to the watched object', async () => {
    await applyDeployment(exactWatchedName);
    await applyDeployment(exactUnwatchedName);
    await patchDeploymentTemplate(exactWatchedName, 'exact-watched');
    await patchDeploymentTemplate(exactUnwatchedName, 'exact-unwatched');

    await waitForObservedConfigMap(`exact-${exactWatchedName}`, exactWatchedName);
    await sleep(5_000);

    await expectMissingConfigMap(`exact-${exactUnwatchedName}`);
  }, 300_000);

  it('routes finite-instance TypeKro Deployment updates only to listed objects', async () => {
    await applyDeployment(finiteApiName);
    await applyDeployment(finiteWorkerName);
    await applyDeployment(finiteOutsideName);
    await patchDeploymentTemplate(finiteApiName, 'finite-api');
    await patchDeploymentTemplate(finiteWorkerName, 'finite-worker');
    await patchDeploymentTemplate(finiteOutsideName, 'finite-outside');

    await waitForObservedConfigMap(`finite-${finiteApiName}`, finiteApiName);
    await waitForObservedConfigMap(`finite-${finiteWorkerName}`, finiteWorkerName);
    await sleep(5_000);

    await expectMissingConfigMap(`finite-${finiteOutsideName}`);
    await expectNoHandlerNotFoundRetryNoise(finiteOutsideName);
  }, 300_000);

  it('routes label-selector TypeKro Deployment updates only to matching objects', async () => {
    await applyDeployment(labelMatchedName, { 'applik8s.dev/listener-scope': 'label' });
    await applyDeployment(labelUnmatchedName, { 'applik8s.dev/listener-scope': 'other' });
    await patchDeploymentTemplate(labelMatchedName, 'label-matched');
    await patchDeploymentTemplate(labelUnmatchedName, 'label-unmatched');

    await waitForObservedConfigMap(`label-${labelMatchedName}`, labelMatchedName);
    await sleep(5_000);

    await expectMissingConfigMap(`label-${labelUnmatchedName}`);
  }, 300_000);

  it('routes field-selector TypeKro Deployment updates only to matching objects', async () => {
    await applyDeployment(fieldMatchedName);
    await applyDeployment(fieldUnmatchedName);
    await patchDeploymentTemplate(fieldMatchedName, 'field-matched');
    await patchDeploymentTemplate(fieldUnmatchedName, 'field-unmatched');

    await waitForObservedConfigMap(`field-${fieldMatchedName}`, fieldMatchedName);
    await sleep(5_000);

    await expectMissingConfigMap(`field-${fieldUnmatchedName}`);
  }, 300_000);

  it('routes mixed TypeKro resource aggregate events by resource kind and address', async () => {
    await applyDeployment(mixedDeploymentName);
    await applyService(mixedServiceName);
    await applyService(mixedUnwatchedServiceName);
    await patchDeploymentTemplate(mixedDeploymentName, 'mixed-deployment');
    await patchServiceSelector(mixedServiceName, 'mixed-service');
    await patchServiceSelector(mixedUnwatchedServiceName, 'mixed-unwatched-service');

    await waitForObservedConfigMap(`mixed-${mixedDeploymentName}`, mixedDeploymentName);
    await waitForObservedConfigMap(`mixed-${mixedServiceName}`, mixedServiceName);
    await sleep(5_000);

    await expectMissingConfigMap(`mixed-${mixedUnwatchedServiceName}`);
  }, 300_000);

  it('rejects unsupported TypeKro watch predicates before emitting a broad live watch', async () => {
    const unsupportedTempDir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-unsupported-listener-'));
    try {
      const entrypoint = join(unsupportedTempDir, 'unsupported-listener.ts');
      await writeFile(entrypoint, unsupportedScopedListenerSource(namespace));
      const compiled = await createCompilerPipeline().run({
        entrypoint,
        operatorName: 'unsupported-scoped-listener',
        outDir: join(unsupportedTempDir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        dispatcherMode: 'staticSerializable',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: false,
          allowedHostImports: [],
          sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
        },
      });

      expect(compiled.ok).toBe(false);
      if (!compiled.ok) {
        expect(compiled.error.message).toContain('labelSelector.matchExpressions');
      }
    } finally {
      await rm(unsupportedTempDir, { recursive: true, force: true });
    }
  }, 300_000);
});

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${operatorName}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${operatorName}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForObservedConfigMap(name: string, observed: string): Promise<void> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    try {
      lastOutput = (await kubectl(['get', `configmap/${name}`, '--namespace', namespace, '--output=jsonpath={.data.observed}'])).stdout.trim();
      if (lastOutput === observed) {
        return;
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', 'deployments', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmaps', '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=500']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ConfigMap ${name} to record ${observed}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function expectMissingConfigMap(name: string): Promise<void> {
  expect((await kubectl(['get', `configmap/${name}`, '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
}

async function expectNoHandlerNotFoundRetryNoise(resourceName: string): Promise<void> {
  const logs = (await kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=500'])).stdout;
  expect(logs).not.toContain('HandlerNotFound');
  expect(logs).not.toContain('handler not found');
  expect(logs).not.toContain(`${resourceName} reconcile retry scheduled`);
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', 'namespace', name]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function applyDeployment(name: string, labels: Readonly<Record<string, string>> = {}): Promise<void> {
  if (!tempDir) {
    throw new Error('Temporary directory was not initialized.');
  }
  const path = join(tempDir, `${name}.deployment.yaml`);
  await writeFile(path, deploymentYaml(name, labels));
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-scoped-listener-e2e', '--filename', path]);
}

async function applyService(name: string, labels: Readonly<Record<string, string>> = {}): Promise<void> {
  if (!tempDir) {
    throw new Error('Temporary directory was not initialized.');
  }
  const path = join(tempDir, `${name}.service.yaml`);
  await writeFile(path, serviceYaml(name, labels));
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-scoped-listener-e2e', '--filename', path]);
}

async function patchDeploymentTemplate(name: string, value: string): Promise<void> {
  await kubectl(['annotate', `deployment/${name}`, '--namespace', namespace, `applik8s.dev/scoped-listener-patch=${value}`, '--overwrite']);
}

async function patchServiceSelector(name: string, value: string): Promise<void> {
  await kubectl([
    'patch',
    `service/${name}`,
    '--namespace',
    namespace,
    '--type=merge',
    '--patch',
    JSON.stringify({ spec: { selector: { 'app.kubernetes.io/name': name, 'applik8s.dev/scoped-listener-patch': value } } }),
  ]);
}

function deploymentYaml(name: string, labels: Readonly<Record<string, string>> = {}): string {
  const metadataLabels = yamlLabels({ 'app.kubernetes.io/name': name, ...labels }, 4);
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
${metadataLabels}
spec:
  replicas: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: placeholder
          image: busybox:1.36
          command: ["sh", "-c", "sleep 3600"]
`;
}

function serviceYaml(name: string, labels: Readonly<Record<string, string>> = {}): string {
  const metadataLabels = yamlLabels({ 'app.kubernetes.io/name': name, ...labels }, 4);
  return `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
${metadataLabels}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - name: http
      port: 80
      targetPort: 8080
`;
}

function yamlLabels(labels: Readonly<Record<string, string>>, indent: number): string {
  const prefix = ' '.repeat(indent);
  return Object.entries(labels).map(([key, value]) => `${prefix}${key}: ${JSON.stringify(value)}`).join('\n');
}

function scopedListenerSource(targetNamespace: string): string {
  return `import { type } from 'arktype';
import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { typeKro } from ${JSON.stringify(join(process.cwd(), 'packages/applik8s/src/typekro.ts'))};

const objectSchema = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'KubernetesObjectShape' },
  schema: { type: 'object', additionalProperties: true },
};

const Deployment = typeKro.resource((input: { name: string; namespace: string }) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: input.name, namespace: input.namespace },
  spec: {},
}), {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  plural: 'deployments',
  spec: objectSchema,
  status: objectSchema,
});

const Service = typeKro.resource((input: { name: string; namespace: string }) => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: input.name, namespace: input.namespace },
  spec: {},
}), {
  apiVersion: 'v1',
  kind: 'Service',
  plural: 'services',
  spec: objectSchema,
  status: objectSchema,
});

const composition = typeKro.kubernetesComposition({
  name: 'scoped-listener-stack',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'ScopedListenerStack',
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, () => {
  const exactWatched = Deployment({ name: ${JSON.stringify(exactWatchedName)}, namespace: ${JSON.stringify(targetNamespace)} });
  const finiteApi = Deployment({ name: ${JSON.stringify(finiteApiName)}, namespace: ${JSON.stringify(targetNamespace)} });
  const finiteWorker = Deployment({ name: ${JSON.stringify(finiteWorkerName)}, namespace: ${JSON.stringify(targetNamespace)} });
  const mixedDeployment = Deployment({ name: ${JSON.stringify(mixedDeploymentName)}, namespace: ${JSON.stringify(targetNamespace)} });
  const mixedService = Service({ name: ${JSON.stringify(mixedServiceName)}, namespace: ${JSON.stringify(targetNamespace)} });

  exactWatched.on.updated((deployment) => {
    deployment.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'exact-' + deployment.metadata.name, namespace: deployment.metadata.namespace },
      data: { observed: deployment.metadata.name },
    });
  });

  Deployment.instances([finiteApi, finiteWorker]).on.updated((deployment) => {
    deployment.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'finite-' + deployment.metadata.name, namespace: deployment.metadata.namespace },
      data: { observed: deployment.metadata.name },
    });
  });

  Deployment.where({ namespace: ${JSON.stringify(targetNamespace)}, labels: { 'applik8s.dev/listener-scope': 'label' } }).on.updated((deployment) => {
    deployment.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'label-' + deployment.metadata.name, namespace: deployment.metadata.namespace },
      data: { observed: deployment.metadata.name },
    });
  });

  Deployment.where({ namespace: ${JSON.stringify(targetNamespace)}, fieldSelector: ${JSON.stringify(`metadata.name=${fieldMatchedName}`)} }).on.updated((deployment) => {
    deployment.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'field-' + deployment.metadata.name, namespace: deployment.metadata.namespace },
      data: { observed: deployment.metadata.name },
    });
  });

  typeKro.resources([mixedDeployment, mixedService]).on.reconcile((resource) => {
    resource.apply({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'mixed-' + resource.metadata.name, namespace: resource.metadata.namespace },
      data: { observed: resource.metadata.name },
    });
  });
  return { ready: true };
});

export const scopedDeploymentListener = composition.listenerOperator({
  name: ${JSON.stringify(operatorName)},
  deployment: { namespace: ${JSON.stringify(targetNamespace)}, replicas: 1 },
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch'] }],
});
`;
}

function unsupportedScopedListenerSource(targetNamespace: string): string {
  return `import { type } from 'arktype';
import { typeKro } from ${JSON.stringify(join(process.cwd(), 'packages/applik8s/src/typekro.ts'))};

const objectSchema = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'KubernetesObjectShape' },
  schema: { type: 'object', additionalProperties: true },
};

const Deployment = typeKro.resource((input: { name: string; namespace: string }) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: input.name, namespace: input.namespace },
  spec: {},
}), {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  plural: 'deployments',
  spec: objectSchema,
  status: objectSchema,
});

const composition = typeKro.kubernetesComposition({
  name: 'unsupported-scoped-listener-stack',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'UnsupportedScopedListenerStack',
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, () => {
  Deployment.where({ namespace: ${JSON.stringify(targetNamespace)}, labelSelector: { matchExpressions: [{ key: 'app', operator: 'Exists' }] } }).on.updated(() => undefined);
  return { ready: true };
});

export const unsupportedScopedDeploymentListener = composition.listenerOperator({
  name: 'unsupported-scoped-listener',
  deployment: { namespace: ${JSON.stringify(targetNamespace)}, replicas: 1 },
});
`;
}
