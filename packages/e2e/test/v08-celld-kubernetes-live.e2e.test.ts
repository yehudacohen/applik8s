// typecast-file-boundary: live Kubernetes observations are narrowed only after
// exact namespace, kind, readiness, and actor-protocol assertions.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actor,
  app,
  installApplicationActorRuntimeResolver,
  type,
} from '@applik8s/applik8s';
import { emitApplicationDeploymentGraph } from '@applik8s/compiler';
import type { ApplicationGraph } from '@applik8s/core';
import {
  createApplicationAlchemyGraphDeployment,
  type ApplicationAlchemyDeployment,
} from '@applik8s/deployment-alchemy';
import type { ApplicationTypeKroCompositionSource } from '@applik8s/deployment-typekro';
import { createCelldApplicationActorRuntime } from '@applik8s/runtime-celld';
import { kubernetesComposition } from 'typekro';
import { expect, it } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  kubectl,
  sleep,
} from './live-e2e-helpers.js';

const celldImage = 'ghcr.io/denoland/celld@sha256:7a4380721b6400073f2a26afe70a828410169f658d31b5ef61383e648ca0c530';

describeLive('v0.8 Celld Kubernetes/TypeKro lifecycle on OrbStack', () => {
  it('builds, orders, reconciles, survives pod loss and rolling update, repairs drift, and destroys through Alchemy', async () => {
    await assertExpectedKubectlContext();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const application = `v08-celld-k8s-${suffix}`;
    const namespace = application;
    const instance = 'qualification';
    const projectRoot = await mkdtemp(join(tmpdir(), 'applik8s-v08-celld-k8s-'));
    const stateRoot = join(projectRoot, '.alchemy-state');
    const source = actorLifecycleSource(application);
    let deployment: ApplicationAlchemyDeployment | undefined;
    let portForward: PortForward | undefined;
    let uninstallRuntime: (() => void) | undefined;
    const builtImages = new Set<string>();
    let destroyed = false;

    try {
      const initialGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 2,
      });
      expect(initialGraph.edges).toContainEqual({
        from: 'direct.provider.ObjectStorage.local-s3',
        to: 'direct.provider.ActorRuntime.celld',
        relationship: 'requiresReady',
      });
      deployment = await actorLifecycleDeployment({
        graph: initialGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const applied = await deployment.apply();
      for (const artifact of applied.artifacts) {
        builtImages.add(artifact.taggedReference);
      }

      await waitForJson(
        ['get', `deployment/${application}-objects`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 1,
        180_000,
        'local S3 Deployment readiness',
      );
      await waitForJson(
        ['get', `job/${application}-actors-worker-deployment`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'succeeded') === 1,
        240_000,
        'Celld Worker deployment Job completion',
      );
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        240_000,
        'two-node Celld StatefulSet readiness',
      );
      await expectKubernetesResource(namespace, 'service', `${application}-actors`);
      await expectKubernetesResource(namespace, 'service', `${application}-actors-peers`);
      await expectKubernetesResource(namespace, 'networkpolicy', `${application}-actors-private`);

      const authorization = await secretValue(
        namespace,
        `${application}-actors-authorization`,
        'authorization',
      );
      portForward = await startPortForward(
        namespace,
        `service/${application}-actors`,
        8080,
      );
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);

      const Counter = app(application).actor(`${application}-counter.v1`, {
        key: type('string'),
        state: type({ count: 'number.integer >= 0' }),
        protocol: {
          increment: actor.command({
            input: type({ by: 'number.integer > 0' }),
            output: type({ count: 'number.integer >= 0' }),
          }),
          read: actor.command({
            input: type({}),
            output: type({ count: 'number.integer >= 0' }),
          }),
        },
      });
      Counter.on.initialize(() => ({ count: 0 }));
      Counter.on.increment(async (turn, input) => {
        const current = await turn.state();
        const count = current.count + input.by;
        await turn.setState({ count });
        return { count };
      });
      Counter.on.read(turn => turn.state());
      uninstallRuntime = installApplicationActorRuntimeResolver(() =>
        createCelldApplicationActorRuntime({
          endpoint: portForward?.endpoint ?? 'http://127.0.0.1:1',
          authorization,
          leaseDuration: '10s',
          heartbeatInterval: '2s',
          admissionTimeout: '60s',
          retryDelay: '250ms',
        }));

      await expect(Counter.increment('workspace-a', { by: 2 }, {
        idempotencyKey: 'initial-increment',
      })).resolves.toEqual({ count: 2 });
      await expect(Counter.increment('workspace-a', { by: 2 }, {
        idempotencyKey: 'initial-increment',
      })).resolves.toEqual({ count: 2 });

      await kubectl([
        'delete', 'pod', `${application}-actors-0`, '--namespace', namespace,
        '--wait=true', '--timeout=120s',
      ]);
      await expectEventually(
        () => Counter.increment('workspace-a', { by: 3 }, {
          idempotencyKey: 'after-pod-loss',
        }),
        { count: 5 },
        120_000,
      );
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        180_000,
        'Celld StatefulSet recovery after pod loss',
      );

      const updatedGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 1,
      });
      deployment = await actorLifecycleDeployment({
        graph: updatedGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const updatePlan = await deployment.plan();
      expect(updatePlan.changes.some(({ action }) =>
        action === 'update' || action === 'replace')).toBe(true);
      const updated = await deployment.apply();
      for (const artifact of updated.artifacts) {
        builtImages.add(artifact.taggedReference);
      }
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedNumber(value, 'spec', 'replicas') === 1
          && nestedNumber(value, 'status', 'readyReplicas') === 1,
        240_000,
        'one-node Celld rolling update',
      );
      await expectEventually(
        () => Counter.read('workspace-a', {}, {
          idempotencyKey: `read-after-rollout-${randomUUID()}`,
        }),
        { count: 5 },
        120_000,
      );

      await kubectl([
        'patch', `statefulset/${application}-actors`, '--namespace', namespace,
        '--type=merge', '--patch', JSON.stringify({ spec: { replicas: 2 } }),
      ]);
      const driftPlan = await deployment.plan();
      expect(driftPlan.changes.some(({ action }) => action === 'update')).toBe(true);
      await deployment.apply();
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'spec', 'replicas') === 1,
        180_000,
        'Celld StatefulSet drift repair',
      );

      await deployment.destroy();
      destroyed = true;
      await waitForAbsent('namespace', namespace, 300_000);
      expect((await kubectl([
        'get', 'statefulset,job,service,networkpolicy,pvc,secret',
        '--namespace', namespace, '--ignore-not-found=true', '--output=name',
      ])).stdout.trim()).toBe('');
    } finally {
      uninstallRuntime?.();
      if (portForward) await portForward.close();
      if (deployment && !destroyed) {
        await deployment.destroy().catch(() => undefined);
      }
      for (const image of builtImages) {
        await removeDockerImage(image);
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 1_200_000);
});

async function emitActorLifecycleGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly projectRoot: string;
  readonly replicas: number;
}) {
  const bundlePath = join(options.projectRoot, 'typekro-bundle.json');
  await writeFile(bundlePath, JSON.stringify({ spec: {} }));
  await writeFile(join(options.projectRoot, 'resources.json'), JSON.stringify([{
    apiVersion: 'kro.run/v1alpha1',
    kind: 'ResourceGraphDefinition',
    metadata: { name: options.application },
    spec: {
      schema: {
        apiVersion: 'v1alpha1',
        kind: actorLifecycleKind(options.application),
        spec: { name: 'string', namespace: 'string' },
        status: { ready: true },
      },
      resources: [{
        id: 'qualificationHttp',
        template: {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: `${options.application}-api`,
            namespace: options.namespace,
            labels: { 'app.kubernetes.io/component': 'typed-http' },
          },
          spec: { ports: [{ name: 'http', port: 8080, targetPort: 8080 }] },
        },
      }],
    },
  }]));
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath,
    projectRoot: options.projectRoot,
    graph: actorLifecycleGraph(options),
    sourceGraphDigest: `sha256:${'b'.repeat(64)}`,
    compilerVersion: '0.8.0',
    context: process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack',
    controlPlaneNamespace: 'default',
    instance: 'qualification',
    profile: 'starter',
    strategy: 'direct',
    installationSpec: { name: 'qualification', namespace: options.namespace },
  });
  const artifact = emitted.graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
  if (artifact?.kind !== 'artifact') {
    throw new Error('Celld lifecycle compilation did not emit artifact.celld-runtime.');
  }
  expect(JSON.stringify(artifact.spec.sourceDescriptor)).toContain(celldImage);
  return emitted.graph;
}

function actorLifecycleGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly replicas: number;
}): ApplicationGraph {
  const credentials = {
    apiVersion: 'v1',
    kind: 'Secret',
    name: `${options.application}-objects-credentials`,
    namespace: options.namespace,
  } as const;
  const stateStore = {
    kind: 's3',
    enabled: true,
    name: `${options.application}-objects`,
    endpoint: `http://${options.application}-objects.${options.namespace}.svc.cluster.local:8333`,
    ownership: 'direct-provisioned',
    bucket: `${options.application}-actors`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentialsSecret: credentials,
    provisioning: {
      kind: 'local-s3',
      enabled: true,
      name: `${options.application}-objects`,
      storageSize: '1Gi',
    },
  } as const;
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: options.application, namespace: options.namespace },
    nodes: [
      {
        id: 'provider.ObjectStorage',
        kind: 'provider',
        name: 'ObjectStorage',
        stability: 'stable',
        interface: 'ObjectStorage',
        implementation: 's3',
        config: { objectStorage: stateStore },
      },
      {
        id: 'provider.ActorRuntime',
        kind: 'provider',
        name: 'ActorRuntime',
        stability: 'stable',
        interface: 'ActorRuntime',
        implementation: 'celld-actors',
        config: {
          actorRuntime: {
            kind: 'celld-actors',
            replicas: options.replicas,
            stateStore,
          },
        },
      },
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function actorLifecycleSource(application: string): ApplicationTypeKroCompositionSource<
  { readonly name: string; readonly namespace: string },
  { readonly ready: boolean }
> {
  const definition = {
    name: application,
    apiVersion: 'qualification.applik8s.dev/v1alpha1',
    kind: actorLifecycleKind(application),
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  };
  const source = kubernetesComposition(definition, () => ({ ready: true }));
  Object.defineProperty(source, '__applik8sTypeKroDefinition', {
    value: definition,
    enumerable: false,
  });
  return source;
}

async function actorLifecycleDeployment(options: {
  readonly graph: Awaited<ReturnType<typeof emitActorLifecycleGraph>>;
  readonly source: ReturnType<typeof actorLifecycleSource>;
  readonly stateRoot: string;
  readonly instance: string;
  readonly namespace: string;
}): Promise<ApplicationAlchemyDeployment> {
  return createApplicationAlchemyGraphDeployment({
    graph: options.graph,
    source: options.source,
    spec: {
      name: options.instance,
      namespace: options.namespace,
    },
    stateRoot: options.stateRoot,
    stage: 'qualification',
    owner: `v08-celld-kubernetes-${process.pid}`,
    artifactRegistry: { type: 'orbstack' },
    factory: {
      namespace: 'default',
      waitForReady: true,
      timeout: 300_000,
    },
  });
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function startPortForward(
  namespace: string,
  resource: string,
  remotePort: number,
): Promise<PortForward> {
  const child = spawn('kubectl', [
    'port-forward', '--namespace', namespace, resource, `0:${remotePort}`,
  ], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  const port = await waitForForwardingPort(child, () => output, 30_000);
  return {
    endpoint: `http://127.0.0.1:${port}`,
    close: () => closeChild(child),
  };
}

async function waitForForwardingPort(
  child: ChildProcess,
  output: () => string,
  timeout: number,
): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = /Forwarding from (?:127\.0\.0\.1|\[::1\]):(\d+)/u.exec(output());
    if (match?.[1]) return Number(match[1]);
    if (child.exitCode !== null) {
      throw new Error(`kubectl port-forward exited with code ${child.exitCode}: ${output()}`);
    }
    await sleep(100);
  }
  throw new Error(`Timed out starting kubectl port-forward: ${output()}`);
}

async function closeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function secretValue(
  namespace: string,
  name: string,
  key: string,
): Promise<string> {
  const value = (await kubectl([
    'get', `secret/${name}`, '--namespace', namespace,
    '--output', `jsonpath={.data.${key}}`,
  ])).stdout.trim();
  if (!value) throw new Error(`Secret ${namespace}/${name} has no ${key}.`);
  return Buffer.from(value, 'base64').toString('utf8');
}

async function expectKubernetesResource(
  namespace: string,
  kind: string,
  name: string,
): Promise<void> {
  expect((await kubectl([
    'get', `${kind}/${name}`, '--namespace', namespace, '--output=name',
  ])).stdout.trim()).toBe(`${kind.includes('.') ? kind : `${kind}.networking.k8s.io`}/${name}`.replace('service.networking.k8s.io', 'service').replace('networkpolicy.networking.k8s.io', 'networkpolicy.networking.k8s.io'));
}

async function waitForJson(
  args: readonly string[],
  accepted: (value: Readonly<Record<string, unknown>>) => boolean,
  timeout: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = 'not observed';
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse((await kubectl(args)).stdout) as Readonly<Record<string, unknown>>;
      latest = JSON.stringify(value.status ?? value.spec ?? value);
      if (accepted(value)) return;
    } catch (cause) {
      latest = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}: ${latest}`);
}

async function waitForAbsent(
  kind: string,
  name: string,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = '';
  while (Date.now() < deadline) {
    latest = (await kubectl([
      'get', `${kind}/${name}`, '--ignore-not-found=true', '--output=name',
    ])).stdout.trim();
    if (!latest) return;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${kind}/${name} deletion: ${latest}`);
}

async function waitForHttp(url: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      latest = `HTTP ${response.status}`;
      if (response.ok) return;
    } catch (cause) {
      latest = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${latest}`);
}

async function expectEventually<T>(
  operation: () => Promise<T>,
  expected: T,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest: unknown;
  while (Date.now() < deadline) {
    try {
      latest = await operation();
      expect(latest).toEqual(expected);
      return;
    } catch (cause) {
      latest = cause;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for actor convergence: ${latest instanceof Error ? latest.message : String(latest)}`);
}

function nestedNumber(
  value: Readonly<Record<string, unknown>>,
  parent: string,
  field: string,
): number | undefined {
  const object = value[parent];
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const candidate = Reflect.get(object, field);
  return typeof candidate === 'number' ? candidate : undefined;
}

async function removeDockerImage(reference: string): Promise<void> {
  await new Promise<void>(resolve => {
    const child = spawn('docker', ['image', 'rm', '--force', reference], {
      stdio: 'ignore',
    });
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
}

function actorLifecycleKind(application: string): string {
  return `V08Celld${application.replace(/[^a-z0-9]/giu, '').slice(-16)}`;
}
