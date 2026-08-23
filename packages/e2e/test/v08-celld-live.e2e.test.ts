// typecast-file-boundary: Docker and celld HTTP responses are admitted only
// after exact process, protocol, and actor-result assertions in this live gate.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type ApplicationActorTurnAuthority,
  actor,
  app,
  executeApplicationActorAlarm,
  installApplicationActorRuntimeResolver,
  type,
  withApplicationActorTurnAuthority,
} from '@applik8s/applik8s';
import { emitApplicationDeploymentGraph } from '@applik8s/compiler';
import type { ApplicationGraph } from '@applik8s/core';
import { createCelldApplicationActorRuntime } from '@applik8s/runtime-celld';
import { afterAll, describe, expect, test } from 'vitest';
import { createActorLiveAuthority } from './actor-live-authority.js';

const live = process.env.APPLIK8S_E2E_CELLD === '1' ? describe : describe.skip;
const run = promisify(execFile);
const celldImage = 'ghcr.io/denoland/celld@sha256:7a4380721b6400073f2a26afe70a828410169f658d31b5ef61383e648ca0c530';
const seaweedImage = 'docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d';
const cleanupActions: Array<() => Promise<void>> = [];

afterAll(async () => {
  const failures: string[] = [];
  while (cleanupActions.length > 0) {
    try { await cleanupActions.pop()?.(); } catch (cause) { failures.push(errorMessage(cause)); }
  }
  if (failures.length > 0) throw new Error(`celld live cleanup failed:\n${failures.join('\n')}`);
});

live('v0.8 distributed celld actor qualification', () => {
  test('deploys the generated Worker and preserves serialized state, receipts, and alarms across node loss', async () => {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`.toLowerCase();
    const network = `applik8s-v08-celld-${suffix}`;
    const storage = `${network}-storage`;
    const nodeA = `${network}-a`;
    const nodeB = `${network}-b`;
    const nodeC = `${network}-c`;
    const image = `applik8s-v08-celld-runtime:${suffix}`;
    const bucket = `applik8s-v08-celld-${suffix}`;
    const authorization = `actor-authority-${randomUUID()}-${randomUUID()}`;
    const applicationAuthorization = `application-authority-${randomUUID()}-${randomUUID()}`;
    const connectionSigningKey = `connection-signing-${randomUUID()}-${randomUUID()}`;
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-v08-celld-live-'));
    cleanupActions.push(() => rm(directory, { recursive: true, force: true }));

    const artifact = await generatedCelldArtifact(directory);
    await preflightCelldDockerLifecycle({
      network,
      image,
      containers: [storage, nodeA, nodeB, nodeC],
    });
    await docker(['network', 'create', network]);
    cleanupActions.push(() => removeDockerNetwork(network));
    cleanupActions.push(() => removeDockerImage(image));
    for (const container of [storage, nodeA, nodeB, nodeC]) {
      cleanupActions.push(() => removeDockerContainer(container));
    }

    await docker(['build', '--tag', image, '--file', String(artifact.sourceDescriptor.dockerfilePath), String(artifact.sourceDescriptor.contextPath)], 300_000);
    expect(await docker(['image', 'inspect', image, '--format', '{{.RepoDigests}}'])).toBeDefined();

    await docker([
      'run', '--detach', '--name', storage, '--network', network,
      '-p', '127.0.0.1::8333', '-e', `S3_BUCKET=${bucket}`,
      seaweedImage, 'mini', '-dir=/data', `-bucket=${bucket}`,
    ]);
    const storagePort = await publishedPort(storage, 8333);
    await waitForHttp(`http://127.0.0.1:${storagePort}/`, 90_000, () => true);
    await createS3Bucket(`http://127.0.0.1:${storagePort}`, bucket);

    await docker([
      'run', '--rm', '--network', network,
      ...storageEnvironment(), image,
      'deploy', '/app', '--bucket', `s3://${bucket}`,
      '--endpoint', `http://${storage}:8333`, '--region', 'us-east-1',
    ], 180_000);

    const Counter = app(`celld-live-${suffix}`).actor(`celld-live-counter-${suffix}.v1`, {
      key: type('string'),
      state: type({ count: 'number.integer >= 0', expired: 'boolean' }),
      protocol: {
        increment: actor.command({
          input: type({ by: 'number.integer > 0', 'pauseMilliseconds?': 'number.integer >= 0' }),
          output: type({ count: 'number.integer >= 0' }),
        }),
        read: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0', expired: 'boolean' }) }),
        expire: actor.alarm(type({ expectedCount: 'number.integer >= 0' })),
      },
    });
    Counter.on.initialize(() => ({ count: 0, expired: false }));
    Counter.on.increment(async (turn, input) => {
      const current = await turn.state();
      if (input.pauseMilliseconds) await delay(input.pauseMilliseconds);
      const count = current.count + input.by;
      await turn.setState({ count, expired: current.expired });
      return { count };
    });
    Counter.on.read(turn => turn.state());
    Counter.on.expire(async (turn, input) => {
      const current = await turn.state();
      if (current.count === input.expectedCount) await turn.setState({ ...current, expired: true });
    });
    const admitted = <T>(member: string, key: string, input: object, callback: () => Promise<T>) =>
      withApplicationActorTurnAuthority(createActorLiveAuthority(`celld-live-${suffix}`, Counter.id, member, key, input), callback);

    let activeRuntime = createCelldApplicationActorRuntime({ endpoint: 'http://127.0.0.1:1', authorization });
    const uninstallRuntime = installApplicationActorRuntimeResolver(() => activeRuntime);
    cleanupActions.push(async () => { uninstallRuntime(); });
    const callback = await actorCallbackServer(Counter as never, applicationAuthorization);
    cleanupActions.push(() => closeServer(callback.server));

    await startCelldNode({ name: nodeA, network, image, bucket, storage, authorization, applicationAuthorization, connectionSigningKey, applicationPort: callback.port });
    await startCelldNode({ name: nodeB, network, image, bucket, storage, authorization, applicationAuthorization, connectionSigningKey, applicationPort: callback.port });
    const portA = await publishedPort(nodeA, 8080);
    const portB = await publishedPort(nodeB, 8080);
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${portA}/healthz`, 90_000),
      waitForHttp(`http://127.0.0.1:${portB}/healthz`, 90_000),
    ]);

    activeRuntime = createCelldApplicationActorRuntime({
      endpoint: `http://127.0.0.1:${portA}`,
      authorization,
      leaseDuration: '10s',
      heartbeatInterval: '2s',
      admissionTimeout: '45s',
    });
    const concurrent = await Promise.all([
      admitted('increment', 'workspace-one', { by: 1, pauseMilliseconds: 250 }, () => Counter.increment('workspace-one', { by: 1, pauseMilliseconds: 250 }, { idempotencyKey: 'increment-one' })),
      admitted('increment', 'workspace-one', { by: 1 }, () => Counter.increment('workspace-one', { by: 1 }, { idempotencyKey: 'increment-two' })),
    ]);
    expect(concurrent.map(({ count }) => count).sort((left, right) => left - right)).toEqual([1, 2]);
    await expect(admitted('increment', 'workspace-one', { by: 1 }, () => Counter.increment('workspace-one', { by: 1 }, { idempotencyKey: 'increment-two' }))).resolves.toEqual({ count: 2 });

    await docker(['stop', '--time', '0', nodeA], 30_000);
    activeRuntime = createCelldApplicationActorRuntime({
      endpoint: `http://127.0.0.1:${portB}`,
      authorization,
      leaseDuration: '10s',
      heartbeatInterval: '2s',
      admissionTimeout: '60s',
      retryDelay: '250ms',
    });
    await expectEventually(
      () => admitted('increment', 'workspace-one', { by: 3 }, () => Counter.increment('workspace-one', { by: 3 }, { idempotencyKey: 'increment-after-node-loss' })),
      { count: 5 },
      90_000,
    );
    await expect(admitted('read', 'workspace-one', {}, () => Counter.read('workspace-one', {}, { idempotencyKey: 'read-after-node-loss' }))).resolves.toEqual({ count: 5, expired: false });

    await admitted('expire', 'workspace-one', { expectedCount: 5 }, () => Counter.alarms.expire.schedule(
        'workspace-one',
        new Date(Date.now() + 1_500),
        { expectedCount: 5 },
        { idempotencyKey: 'expire-after-node-loss' },
      ));
    await expectEventually(
      () => admitted('read', 'workspace-one', {}, () => Counter.read('workspace-one', {}, { idempotencyKey: `read-alarm-${randomUUID()}` })),
      { count: 5, expired: true },
      60_000,
    );
    expect(callback.deliveries()).toBeGreaterThanOrEqual(1);

    await startCelldNode({ name: nodeC, network, image, bucket, storage, authorization, applicationAuthorization, connectionSigningKey, applicationPort: callback.port });
    const portC = await publishedPort(nodeC, 8080);
    await waitForHttp(`http://127.0.0.1:${portC}/healthz`, 90_000);
    activeRuntime = createCelldApplicationActorRuntime({ endpoint: `http://127.0.0.1:${portC}`, authorization, admissionTimeout: '45s' });
    await expectEventually(
      () => admitted('read', 'workspace-one', {}, () => Counter.read('workspace-one', {}, { idempotencyKey: `read-rejoined-${randomUUID()}` })),
      { count: 5, expired: true },
      60_000,
    );

    const diagnosis = await diagnoseCelldFleet({
      network,
      image,
      bucket,
      storage,
      timeout: 90_000,
    });
    expect(diagnosis).not.toMatch(/unreachable|malformed|incompatible|failed/iu);
  }, 900_000);
});

async function generatedCelldArtifact(directory: string) {
  const bundlePath = join(directory, 'typekro-bundle.json');
  await writeFile(bundlePath, JSON.stringify({ spec: {} }));
  await writeFile(join(directory, 'resources.json'), JSON.stringify([{
    apiVersion: 'kro.run/v1alpha1',
    kind: 'ResourceGraphDefinition',
    metadata: { name: 'celld-live' },
    spec: {
      schema: {
        apiVersion: 'v1alpha1',
        kind: 'CelldLive',
        spec: { name: 'string', namespace: 'string' },
        status: { ready: 'boolean' },
      },
      resources: [{
        id: 'celldLiveHttp',
        template: {
          apiVersion: 'v1', kind: 'Service',
          metadata: { name: 'celld-live-http', namespace: 'celld-live', labels: { 'app.kubernetes.io/component': 'typed-http' } },
          spec: { ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
        },
      }],
    },
  }]));
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath,
    projectRoot: directory,
    graph: celldGraph(),
    sourceGraphDigest: `sha256:${'a'.repeat(64)}`,
    compilerVersion: '0.8.0',
    context: 'orbstack',
    controlPlaneNamespace: 'celld-live',
    instance: 'celld-live',
    profile: 'test',
    strategy: 'direct',
    installationSpec: { name: 'celld-live', namespace: 'celld-live' },
  });
  const artifact = emitted.graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
  if (artifact?.kind !== 'artifact') throw new Error('The compiler did not emit the celld runtime artifact.');
  const dockerfile = await readFile(String(artifact.spec.sourceDescriptor.dockerfilePath), 'utf8');
  expect(dockerfile).toContain(celldImage);
  expect(dockerfile).toContain('esbuild@0.28.1');
  return artifact.spec;
}

function celldGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'celld-live', namespace: 'celld-live' },
    nodes: [{
      id: 'provider.ActorRuntime', kind: 'provider', name: 'ActorRuntime', stability: 'experimental',
      interface: 'ActorRuntime', implementation: 'celld-actors',
      config: { actorRuntime: { kind: 'celld-actors', replicas: 2, stateStore: {
        kind: 's3', bucket: 'celld-live', region: 'us-east-1', endpoint: 'http://storage:8333',
        forcePathStyle: true, credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'celld-live', namespace: 'celld-live' },
      } } },
    }],
    edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}

async function startCelldNode(options: {
  readonly name: string;
  readonly network: string;
  readonly image: string;
  readonly bucket: string;
  readonly storage: string;
  readonly authorization: string;
  readonly applicationAuthorization: string;
  readonly connectionSigningKey: string;
  readonly applicationPort: number;
}): Promise<void> {
  await docker([
    'run', '--detach', '--name', options.name, '--network', options.network,
    '-p', '127.0.0.1::8080',
    ...storageEnvironment(),
    '-e', `CELLD_VAR_APPLIK8S_ACTOR_AUTHORIZATION=${options.authorization}`,
    '-e', `CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION=${options.applicationAuthorization}`,
    '-e', `CELLD_VAR_APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY=${options.connectionSigningKey}`,
    '-e', `CELLD_VAR_APPLIK8S_ACTOR_APPLICATION_ENDPOINT=http://host.docker.internal:${options.applicationPort}`,
    '-e', 'CELLD_WATCH=/tmp/celld',
    options.image, '--bucket', `s3://${options.bucket}`,
    '--endpoint', `http://${options.storage}:8333`, '--region', 'us-east-1',
    '--listen', '0.0.0.0:8080', '--internal-listen', '0.0.0.0:8081',
    '--advertise', `${options.name}:8081`,
  ]);
}

function storageEnvironment(): string[] {
  return ['-e', 'AWS_ACCESS_KEY_ID=applik8s-live', '-e', 'AWS_SECRET_ACCESS_KEY=applik8s-live-secret', '-e', 'AWS_REGION=us-east-1'];
}

async function publishedPort(container: string, port: number): Promise<number> {
  const output = await docker(['port', container, `${port}/tcp`]);
  const match = /127\.0\.0\.1:(\d+)/u.exec(output);
  if (!match?.[1]) throw new Error(`Docker did not publish ${container}:${port}: ${output}`);
  return Number(match[1]);
}

async function actorCallbackServer(actorHandle: Parameters<typeof executeApplicationActorAlarm>[0], authorization: string): Promise<{
  readonly server: Server;
  readonly port: number;
  deliveries(): number;
}> {
  let deliveryCount = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/__applik8s/v1/internal/actors/alarms') {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${authorization}`) {
        response.writeHead(403).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const alarm = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        readonly actor?: string;
        readonly key?: string;
        readonly member?: string;
        readonly input?: object;
        readonly idempotencyKey?: string;
        readonly authority?: ApplicationActorTurnAuthority;
      };
      if (alarm.actor !== actorHandle.id || !alarm.key || !alarm.member || !alarm.input || !alarm.idempotencyKey || !alarm.authority) {
        throw new Error('celld alarm callback was incomplete.');
      }
      await executeApplicationActorAlarm(actorHandle, {
        member: alarm.member,
        key: alarm.key,
        input: alarm.input,
        idempotencyKey: alarm.idempotencyKey,
        authority: alarm.authority,
      });
      deliveryCount += 1;
      response.writeHead(202, { 'content-type': 'application/json' }).end('{"accepted":true}');
    } catch (cause) {
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: errorMessage(cause) }));
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '0.0.0.0', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Actor callback server did not bind a TCP port.');
  return { server, port: address.port, deliveries: () => deliveryCount };
}

async function waitForHttp(url: string, timeout: number, accepted: (response: Response) => boolean = response => response.ok): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      latest = `HTTP ${response.status}`;
      if (accepted(response)) return;
    } catch (cause) { latest = errorMessage(cause); }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${latest}`);
}

async function diagnoseCelldFleet(options: {
  readonly network: string;
  readonly image: string;
  readonly bucket: string;
  readonly storage: string;
  readonly timeout: number;
}): Promise<string> {
  const deadline = Date.now() + options.timeout;
  let latest: unknown = new Error('fleet diagnosis was not attempted');
  while (Date.now() < deadline) {
    try {
      return await docker([
        'run', '--rm', '--network', options.network,
        ...storageEnvironment(), options.image,
        'diagnose', '--bucket', `s3://${options.bucket}`,
        '--endpoint', `http://${options.storage}:8333`, '--region', 'us-east-1',
      ], 60_000);
    } catch (cause) {
      latest = cause;
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for celld fleet convergence: ${errorMessage(latest)}`);
}

async function expectEventually<T>(operation: () => Promise<T>, expected: T, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest: unknown;
  while (Date.now() < deadline) {
    try {
      latest = await operation();
      expect(latest).toEqual(expected);
      return;
    } catch (cause) { latest = cause; }
    await delay(500);
  }
  throw new Error(`Timed out waiting for distributed actor convergence: ${errorMessage(latest)}`);
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
}

async function docker(args: readonly string[], timeout = 120_000): Promise<string> {
  const { stdout } = await run('docker', [...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout });
  return stdout.trim();
}

async function preflightCelldDockerLifecycle(options: {
  readonly network: string;
  readonly image: string;
  readonly containers: readonly string[];
}): Promise<void> {
  await docker(['version', '--format', '{{.Server.Version}}'], 30_000);
  await run('aws', ['--version'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  for (const sourceImage of [celldImage, seaweedImage]) {
    if (!await dockerResourceExists(['image', 'inspect', sourceImage])) {
      await docker(['pull', sourceImage], 300_000);
    }
    if (!await dockerResourceExists(['image', 'inspect', sourceImage])) {
      throw new Error(`celld live preflight could not resolve pinned image ${sourceImage}.`);
    }
  }
  if (await dockerResourceExists(['network', 'inspect', options.network])) {
    throw new Error(`celld live preflight found conflicting Docker network ${options.network}.`);
  }
  if (await dockerResourceExists(['image', 'inspect', options.image])) {
    throw new Error(`celld live preflight found conflicting generated image ${options.image}.`);
  }
  for (const container of options.containers) {
    if (await dockerResourceExists(['container', 'inspect', container])) {
      throw new Error(`celld live preflight found conflicting container ${container}.`);
    }
  }
}

async function removeDockerContainer(name: string): Promise<void> {
  if (await dockerResourceExists(['container', 'inspect', name])) {
    await docker(['rm', '--force', name], 60_000);
  }
  if (await dockerResourceExists(['container', 'inspect', name])) {
    throw new Error(`celld live cleanup retained container ${name}.`);
  }
}

async function removeDockerImage(name: string): Promise<void> {
  if (await dockerResourceExists(['image', 'inspect', name])) {
    await docker(['image', 'rm', '--force', name], 60_000);
  }
  if (await dockerResourceExists(['image', 'inspect', name])) {
    throw new Error(`celld live cleanup retained image ${name}.`);
  }
}

async function removeDockerNetwork(name: string): Promise<void> {
  if (await dockerResourceExists(['network', 'inspect', name])) {
    await docker(['network', 'rm', name], 60_000);
  }
  if (await dockerResourceExists(['network', 'inspect', name])) {
    throw new Error(`celld live cleanup retained network ${name}.`);
  }
}

async function dockerResourceExists(args: readonly string[]): Promise<boolean> {
  try {
    await docker(args, 30_000);
    return true;
  } catch (cause) {
    if (/No such (?:container|image|network|object)|not found/iu.test(errorMessage(cause))) {
      return false;
    }
    throw cause;
  }
}

async function createS3Bucket(endpoint: string, bucket: string): Promise<void> {
  try {
    await run('aws', [
      '--endpoint-url', endpoint,
      's3api', 'create-bucket', '--bucket', bucket,
      '--region', 'us-east-1', '--output', 'json',
    ], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: 'applik8s-live',
        AWS_SECRET_ACCESS_KEY: 'applik8s-live-secret',
        AWS_REGION: 'us-east-1',
      },
    });
  } catch (cause) {
    if (/BucketAlreadyOwnedByYou/u.test(errorMessage(cause))) return;
    throw cause;
  }
}

function delay(milliseconds: number): Promise<void> { return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds)); }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
